#!/usr/bin/env node
// manifold-ide/local-server.js
//
// Local server for the Manifold IDE.
// Each user runs their own instance on their own machine.
// Credentials never leave the machine.
//
// Zero dependencies — pure Node.js built-ins only.
//
// Usage:
//   node local-server.js            # start on default port 3131
//   node local-server.js --port 4000
//   node local-server.js --no-open  # don't open browser automatically
//
// On first run, creates ~/.manifold/config.json for credentials.
// Edit that file to add API keys (Groq, Together, Anthropic, etc.).
//
// What this server provides:
//   GET  /*                         serve IDE static files
//   GET  /api/config                read credentials config (keys redacted)
//   POST /api/config                update credentials config
//   GET  /api/fs/list?path=...      list directory
//   GET  /api/fs/read?path=...      read file
//   POST /api/fs/write              write file { path, content }
//   POST /api/exec                  execute code { lang, code } -> { ok, output }
//   POST /api/proxy/:provider       proxy an API call with stored credentials
//   GET  /api/health                server status + connected sources
//
// Connect to any source by adding credentials to ~/.manifold/config.json:
//   { "groq": { "apiKey": "..." },
//     "together": { "apiKey": "..." },
//     "anthropic": { "apiKey": "..." },
//     "ollama": { "apiBase": "http://localhost:11434/v1" },
//     "vps": { "wsUrl": "wss://kensgames.com/ws", "token": "..." },
//     "github": { "token": "..." } }

'use strict';

const http   = require('http');
const https  = require('https');
const fs     = require('fs');
const path   = require('path');
const os     = require('os');
const cp     = require('child_process');
const crypto = require('crypto');
const url    = require('url');

// ── Config ─────────────────────────────────────────────────────────────────
const DEFAULT_PORT  = 3131;
const CONFIG_DIR    = path.join(os.homedir(), '.manifold');
const CONFIG_FILE   = path.join(CONFIG_DIR, 'config.json');
const IDE_ROOT      = __dirname;
const SESSION_TOKEN = crypto.randomBytes(16).toString('hex');

const args      = process.argv.slice(2);
const portIdx   = args.indexOf('--port');
const PORT      = portIdx >= 0 ? parseInt(args[portIdx + 1], 10) : DEFAULT_PORT;
const NOOPEN    = args.includes('--no-open');

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css',   '.json': 'application/json', '.svg': 'image/svg+xml',
  '.png': 'image/png',  '.jpg': 'image/jpeg', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf',
  '.map': 'application/json', '.wasm': 'application/wasm',
};

// Provider proxy map: name -> default base URL.
const PROVIDERS = {
  // Local GPU — Qwen via Ollama. Install: https://ollama.com
  // Pull a model: ollama pull qwen2.5:7b
  // Fibonacci tier sizes: 1.5b  3b  7b  14b  32b  72b
  ollama:    'http://localhost:11434/v1',

  // Free API tiers (Qwen available on both)
  groq:       'https://api.groq.com/openai/v1',
  together:   'https://api.together.xyz/v1',
  openrouter: 'https://openrouter.ai/api/v1',

  // Paid
  anthropic: 'https://api.anthropic.com/v1',
  openai:    'https://api.openai.com/v1',
};

// ── Credential config ───────────────────────────────────────────────────────
function ensureConfig() {
  if (!fs.existsSync(CONFIG_DIR)) fs.mkdirSync(CONFIG_DIR, { recursive: true });
  if (!fs.existsSync(CONFIG_FILE)) {
    const defaultCfg = {
      _note: 'Add your API keys here. This file never leaves your machine.',
      groq:       { apiKey: '' },
      together:   { apiKey: '' },
      anthropic:  { apiKey: '' },
      openai:     { apiKey: '' },
      ollama:     { apiBase: 'http://localhost:11434/v1' },
      openrouter: { apiKey: '' },
      vps:        { wsUrl: '', token: '' },
      github:     { token: '' },
    };
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(defaultCfg, null, 2), 'utf8');
    console.log(`Created config: ${CONFIG_FILE}`);
    console.log('Add your API keys to that file to connect to AI providers.');
  }
}

function readConfig() {
  try { return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); }
  catch { return {}; }
}

function redactConfig(cfg) {
  const out = {};
  for (const [k, v] of Object.entries(cfg)) {
    if (k.startsWith('_')) { out[k] = v; continue; }
    out[k] = {};
    for (const [kk, vv] of Object.entries(v || {})) {
      if (kk === 'apiKey' || kk === 'token') {
        out[k][kk] = vv ? '***' + vv.slice(-4) : '';
      } else {
        out[k][kk] = vv;
      }
    }
  }
  return out;
}

// ── CORS / session check ────────────────────────────────────────────────────
// Only requests from localhost are accepted.
// The session token is embedded in the served index.html so external sites
// cannot proxy requests even if they know the port.
function isLocalOrigin(req) {
  const h = req.headers.host || '';
  return h.startsWith('localhost') || h.startsWith('127.0.0.1') || h.startsWith('[::1]');
}

// ── Static file handler ─────────────────────────────────────────────────────
function serveStatic(req, res) {
  let filePath = url.parse(req.url).pathname;
  if (filePath === '/' || filePath === '') filePath = '/index.html';

  // Strip leading slash
  const rel  = filePath.replace(/^\//, '');
  const full = path.resolve(IDE_ROOT, rel);

  // Security: stay inside IDE_ROOT (and its parents for shared manifold-ai/ etc.)
  const repoRoot = path.resolve(IDE_ROOT, '..');
  if (!full.startsWith(repoRoot)) {
    res.writeHead(403); res.end('Forbidden');
    return;
  }

  if (!fs.existsSync(full) || fs.statSync(full).isDirectory()) {
    // Directory: try index.html
    const idx = path.join(full, 'index.html');
    if (fs.existsSync(idx)) { return serveFile(idx, res); }
    res.writeHead(404); res.end('Not found: ' + filePath);
    return;
  }

  serveFile(full, res);
}

function serveFile(full, res) {
  const ext  = path.extname(full).toLowerCase();
  const mime = MIME[ext] || 'application/octet-stream';
  try {
    const data = fs.readFileSync(full);
    res.writeHead(200, {
      'Content-Type': mime,
      'Cache-Control': 'no-cache',
      // Allow SharedArrayBuffer for WebAssembly threads (needed by some models)
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    });
    res.end(data);
  } catch (e) {
    res.writeHead(500); res.end(e.message);
  }
}

// ── JSON helpers ────────────────────────────────────────────────────────────
function json(res, obj, status = 200) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end',  () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString())); } catch { resolve({}); } });
    req.on('error', reject);
  });
}

// ── API handlers ─────────────────────────────────────────────────────────────
// Detect available GPU backends. Qwen via Ollama uses whichever is present.
// Returns: { nvidia: bool, apple_silicon: bool, rocm: bool, vram_gb: number|null }
async function detectGPU() {
  const gpu = { nvidia: false, apple_silicon: false, rocm: false, vram_gb: null };

  // NVIDIA: nvidia-smi
  await new Promise(r => {
    cp.exec('nvidia-smi --query-gpu=memory.total --format=csv,noheader,nounits',
      { timeout: 3000 }, (err, out) => {
        if (!err && out.trim()) {
          gpu.nvidia = true;
          const mb = parseInt(out.trim().split('\n')[0], 10);
          if (mb > 0) gpu.vram_gb = Math.round(mb / 1024);
        }
        r();
      });
  });

  // Apple Silicon: check platform + arm64
  if (!gpu.nvidia && process.platform === 'darwin') {
    await new Promise(r => {
      cp.exec('sysctl -n machdep.cpu.brand_string 2>/dev/null || sysctl -n hw.optional.arm64',
        { timeout: 2000 }, (err, out) => {
          if (!err && out && (out.includes('Apple') || out.trim() === '1')) {
            gpu.apple_silicon = true;
            // Unified memory: report physical RAM as "VRAM"
            const mem = os.totalmem();
            gpu.vram_gb = Math.round(mem / 1024 / 1024 / 1024);
          }
          r();
        });
    });
  }

  // AMD ROCm
  if (!gpu.nvidia && !gpu.apple_silicon) {
    await new Promise(r => {
      cp.exec('rocm-smi --showmeminfo vram 2>/dev/null',
        { timeout: 3000 }, (err, out) => {
          if (!err && out && out.includes('VRAM Total')) gpu.rocm = true;
          r();
        });
    });
  }

  gpu.available = gpu.nvidia || gpu.apple_silicon || gpu.rocm;

  // Recommend Qwen tier based on VRAM.
  // Fibonacci-mapped: 1.5B=1GB, 3B=2GB, 7B=5GB, 14B=10GB, 32B=20GB, 72B=45GB
  if (gpu.available && gpu.vram_gb) {
    const v = gpu.vram_gb;
    if      (v >= 45) gpu.qwen_tier = '72b';
    else if (v >= 20) gpu.qwen_tier = '32b';
    else if (v >= 10) gpu.qwen_tier = '14b';
    else if (v >=  5) gpu.qwen_tier = '7b';
    else if (v >=  2) gpu.qwen_tier = '3b';
    else              gpu.qwen_tier = '1.5b';
    gpu.qwen_model = `qwen2.5:${gpu.qwen_tier}`;
  } else if (gpu.available) {
    gpu.qwen_tier  = '7b';
    gpu.qwen_model = 'qwen2.5:7b';
  }

  return gpu;
}

function handleHealth(req, res) {
  const cfg = readConfig();
  const sources = {};
  for (const [k, v] of Object.entries(cfg)) {
    if (k.startsWith('_')) continue;
    sources[k] = !!(v.apiKey || v.token || v.apiBase || v.wsUrl);
  }
  // GPU detection is async — fire and return cached result.
  detectGPU().then(gpu => {
    json(res, { ok: true, version: '1.0.0', port: PORT, sources, gpu });
  }).catch(() => {
    json(res, { ok: true, version: '1.0.0', port: PORT, sources, gpu: null });
  });
}

function handleConfigGet(req, res) {
  json(res, redactConfig(readConfig()));
}

async function handleConfigSet(req, res) {
  const body = await readBody(req);
  const cfg  = readConfig();
  for (const [k, v] of Object.entries(body)) {
    if (k.startsWith('_')) continue;
    cfg[k] = Object.assign(cfg[k] || {}, v);
  }
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2), 'utf8');
  json(res, { ok: true });
}

function handleFsList(req, res) {
  const qpath = url.parse(req.url, true).query.path || '.';
  try {
    const entries = fs.readdirSync(qpath, { withFileTypes: true }).map(e => ({
      name: e.name,
      kind: e.isDirectory() ? 'dir' : 'file',
      path: path.join(qpath, e.name),
    }));
    json(res, { ok: true, path: qpath, entries });
  } catch (e) { json(res, { ok: false, error: e.message }, 400); }
}

function handleFsRead(req, res) {
  const qpath = url.parse(req.url, true).query.path;
  if (!qpath) { json(res, { ok: false, error: 'path required' }, 400); return; }
  try {
    const content = fs.readFileSync(qpath, 'utf8');
    json(res, { ok: true, path: qpath, content });
  } catch (e) { json(res, { ok: false, error: e.message }, 400); }
}

async function handleFsWrite(req, res) {
  const { path: fpath, content } = await readBody(req);
  if (!fpath) { json(res, { ok: false, error: 'path required' }, 400); return; }
  try {
    fs.mkdirSync(path.dirname(fpath), { recursive: true });
    fs.writeFileSync(fpath, content ?? '', 'utf8');
    json(res, { ok: true, path: fpath });
  } catch (e) { json(res, { ok: false, error: e.message }, 400); }
}

async function handleExec(req, res) {
  const { lang, code, timeout: ms = 10000 } = await readBody(req);
  if (!code) { json(res, { ok: false, error: 'code required' }, 400); return; }

  const runners = {
    javascript: (c) => spawn('node', ['-e', c], ms),
    python:     (c) => spawn('python3', ['-c', c], ms),
    python3:    (c) => spawn('python3', ['-c', c], ms),
    bash:       (c) => spawn('bash', ['-c', c], ms),
    sh:         (c) => spawn('sh', ['-c', c], ms),
    ruby:       (c) => spawn('ruby', ['-e', c], ms),
  };

  const runner = runners[lang] || runners['bash'];
  try {
    const result = await runner(code);
    json(res, result);
  } catch (e) { json(res, { ok: false, error: e.message }, 500); }
}

function spawn(cmd, args, timeoutMs) {
  return new Promise((resolve) => {
    const proc = cp.spawn(cmd, args, { timeout: timeoutMs });
    const out = [], err = [];
    proc.stdout.on('data', d => out.push(d.toString()));
    proc.stderr.on('data', d => err.push(d.toString()));
    proc.on('close', code => resolve({
      ok: code === 0,
      output: out.join(''),
      stderr: err.join(''),
      exitCode: code,
    }));
    proc.on('error', e => resolve({ ok: false, error: e.message }));
  });
}

// Proxy an AI provider call, injecting the stored credentials.
// POST /api/proxy/groq  { endpoint: '/chat/completions', body: {...} }
async function handleProxy(req, res, provider) {
  const cfg     = readConfig();
  const pCfg    = cfg[provider] || {};
  const body    = await readBody(req);
  const apiBase = pCfg.apiBase || PROVIDERS[provider] || null;

  if (!apiBase) {
    json(res, { ok: false, error: `unknown provider: ${provider}` }, 400);
    return;
  }

  const endpoint = (body.endpoint || '/chat/completions').replace(/^\//, '');
  const target   = `${apiBase}/${endpoint}`;
  const payload  = body.body || body;

  const headers = { 'Content-Type': 'application/json' };
  if (pCfg.apiKey) headers['Authorization'] = `Bearer ${pCfg.apiKey}`;
  if (provider === 'anthropic') {
    headers['x-api-key']         = pCfg.apiKey || '';
    headers['anthropic-version'] = '2023-06-01';
    delete headers['Authorization'];
  }

  const payloadStr = JSON.stringify(payload);
  const parsed     = new url.URL(target);
  const isHttps    = parsed.protocol === 'https:';
  const lib        = isHttps ? https : http;

  const options = {
    hostname: parsed.hostname,
    port:     parsed.port || (isHttps ? 443 : 80),
    path:     parsed.pathname + parsed.search,
    method:   'POST',
    headers:  { ...headers, 'Content-Length': Buffer.byteLength(payloadStr) },
  };

  const proxyReq = lib.request(options, (proxyRes) => {
    const chunks = [];
    proxyRes.on('data', c => chunks.push(c));
    proxyRes.on('end', () => {
      const raw = Buffer.concat(chunks).toString();
      res.writeHead(proxyRes.statusCode, { 'Content-Type': 'application/json' });
      res.end(raw);
    });
  });

  proxyReq.on('error', e => {
    json(res, { ok: false, error: `proxy error: ${e.message}` }, 502);
  });

  proxyReq.write(payloadStr);
  proxyReq.end();
}

// ── Router ──────────────────────────────────────────────────────────────────
async function handleRequest(req, res) {
  // CORS: only allow local origin
  res.setHeader('Access-Control-Allow-Origin', `http://localhost:${PORT}`);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
  if (!isLocalOrigin(req)) { res.writeHead(403); res.end('Forbidden'); return; }

  const pathname = url.parse(req.url).pathname;

  if (pathname === '/api/health')       return handleHealth(req, res);
  if (pathname === '/api/config' && req.method === 'GET')  return handleConfigGet(req, res);
  if (pathname === '/api/config' && req.method === 'POST') return handleConfigSet(req, res);
  if (pathname === '/api/fs/list')      return handleFsList(req, res);
  if (pathname === '/api/fs/read')      return handleFsRead(req, res);
  if (pathname === '/api/fs/write')     return handleFsWrite(req, res);
  if (pathname === '/api/exec')         return handleExec(req, res);

  // /api/proxy/:provider
  const proxyMatch = pathname.match(/^\/api\/proxy\/([a-z0-9_-]+)$/i);
  if (proxyMatch) return handleProxy(req, res, proxyMatch[1]);

  // Everything else: serve IDE static files
  serveStatic(req, res);
}

// ── Startup ─────────────────────────────────────────────────────────────────
ensureConfig();

const server = http.createServer(handleRequest);

server.listen(PORT, '127.0.0.1', () => {
  const addr = `http://localhost:${PORT}`;
  console.log('\n  Manifold IDE');
  console.log('  ─────────────────────────────────────────');
  console.log(`  Local:    ${addr}`);
  console.log(`  Config:   ${CONFIG_FILE}`);
  console.log(`  Repo:     ${IDE_ROOT}`);
  console.log('  ─────────────────────────────────────────');
  console.log('  Add API keys to config to connect sources.');
  console.log('  Press Ctrl+C to stop.\n');

  if (!NOOPEN) openBrowser(addr);
});

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} in use. Try: node local-server.js --port ${PORT + 1}`);
  } else {
    console.error('Server error:', e.message);
  }
  process.exit(1);
});

function openBrowser(url) {
  const cmds = { win32: 'start', darwin: 'open', linux: 'xdg-open' };
  const cmd = cmds[process.platform];
  if (cmd) cp.exec(`${cmd} ${url}`);
}
