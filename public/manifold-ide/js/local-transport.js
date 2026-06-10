// manifold-ide/js/local-transport.js
// Client-side transport that routes IDE operations through the local server.
//
// When the IDE is served from localhost (local-server.js), all file system
// operations, code execution, and API proxy calls go through the local
// server's /api/ endpoints. Credentials stay in ~/.manifold/config.json
// and never touch the browser or any remote server.
//
// When served from a remote host (butterflyfx.us), falls back to the
// browser File System Access API and sandboxed workers.
//
// Usage (ide.js already uses the code-agent transport pattern):
//   import { createTransport } from './local-transport.js';
//   const transport = createTransport();   // auto-detects local vs remote
//   await transport.fs.read('src/main.js');
//   await transport.exec('python3', 'print("z = x * y")');
//   await transport.proxy('groq', { model: '...', messages: [...] });

const LOCAL_BASE = 'http://localhost:3131';
const isLocal    = () => window.location.hostname === 'localhost'
                      || window.location.hostname === '127.0.0.1';

// ── Fetchers ─────────────────────────────────────────────────────────────────
async function apiFetch(path, opts = {}) {
  const res = await fetch(`${window.location.origin}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...opts
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `API error ${res.status}`);
  }
  return res.json();
}

function get(path)       { return apiFetch(path); }
function post(path, body){ return apiFetch(path, { method: 'POST', body: JSON.stringify(body) }); }

// ── File system transport ─────────────────────────────────────────────────────
export const LocalFS = {
  async list(dirPath) {
    const r = await get(`/api/fs/list?path=${encodeURIComponent(dirPath)}`);
    return r.entries || [];
  },

  async read(filePath) {
    const r = await get(`/api/fs/read?path=${encodeURIComponent(filePath)}`);
    return r.content;
  },

  async write(filePath, content) {
    await post('/api/fs/write', { path: filePath, content });
  },

  async exists(filePath) {
    try { await LocalFS.read(filePath); return true; }
    catch { return false; }
  }
};

// ── Code execution transport ──────────────────────────────────────────────────
export const LocalExec = {
  async run(lang, code, opts = {}) {
    return post('/api/exec', { lang, code, timeout: opts.timeout || 10000 });
  }
};

// ── AI proxy transport ────────────────────────────────────────────────────────
// Routes AI API calls through the local server so API keys stay local.
// The browser never sees the key.
export const LocalProxy = {
  async call(provider, body, endpoint = '/chat/completions') {
    return post(`/api/proxy/${provider}`, { endpoint, body });
  },

  // Convenience: OpenAI-compatible chat completion.
  async chat(provider, model, messages, opts = {}) {
    return LocalProxy.call(provider, {
      model,
      messages,
      temperature:     opts.temperature  ?? 0.35,
      max_tokens:      opts.max_tokens   ?? 1024,
      response_format: opts.jsonMode !== false ? { type: 'json_object' } : undefined,
      stream:          false,
    });
  },

  // For Anthropic Messages API (different format).
  async anthropic(model, messages, system, opts = {}) {
    return LocalProxy.call('anthropic',
      {
        model,
        max_tokens:  opts.max_tokens ?? 1024,
        system:      system || '',
        messages,
      },
      '/messages'
    );
  }
};

// ── Config transport ──────────────────────────────────────────────────────────
export const LocalConfig = {
  async read() { return get('/api/config'); },
  async update(patch) { return post('/api/config', patch); },

  // Get the list of configured (non-empty) sources.
  async activeSources() {
    const cfg = await LocalConfig.read();
    return Object.entries(cfg)
      .filter(([k, v]) => !k.startsWith('_') && Object.values(v).some(Boolean))
      .map(([k]) => k);
  }
};

// ── Health check ──────────────────────────────────────────────────────────────
export async function checkLocalServer() {
  try {
    const r = await get('/api/health');
    return { available: true, sources: r.sources };
  } catch {
    return { available: false, sources: {} };
  }
}

// ── Auto-detecting transport factory ─────────────────────────────────────────
// Returns the right transport based on where the IDE is running.
// Local: uses the local server API (full file system + real execution).
// Remote: falls back to browser File System Access API + sandboxed workers.
export function createTransport() {
  if (!isLocal()) {
    // Remote mode: browser-native fallback.
    return {
      mode: 'browser',
      fs:   BrowserFS,
      exec: BrowserExec,
      proxy: RemoteProxy,
      config: null,
    };
  }

  return {
    mode:   'local',
    fs:     LocalFS,
    exec:   LocalExec,
    proxy:  LocalProxy,
    config: LocalConfig,
  };
}

// ── Browser fallbacks (remote / no local server) ──────────────────────────────
// These use the browser File System Access API and sandboxed workers.
// Credentials are NOT available here — the proxy falls through to the engine.
const BrowserFS = {
  _root: null,

  async _ensureRoot() {
    if (!BrowserFS._root) BrowserFS._root = await window.showDirectoryPicker?.();
    return BrowserFS._root;
  },

  async read(filePath) {
    const root   = await BrowserFS._ensureRoot();
    const parts  = filePath.split('/').filter(Boolean);
    let handle   = root;
    for (let i = 0; i < parts.length - 1; i++) {
      handle = await handle.getDirectoryHandle(parts[i]);
    }
    const fh   = await handle.getFileHandle(parts[parts.length - 1]);
    const file = await fh.getFile();
    return file.text();
  },

  async write(filePath, content) {
    const root   = await BrowserFS._ensureRoot();
    const parts  = filePath.split('/').filter(Boolean);
    let handle   = root;
    for (let i = 0; i < parts.length - 1; i++) {
      handle = await handle.getDirectoryHandle(parts[i], { create: true });
    }
    const fh     = await handle.getFileHandle(parts[parts.length - 1], { create: true });
    const writer = await fh.createWritable();
    await writer.write(content);
    await writer.close();
  },

  async list(dirPath) {
    const root  = await BrowserFS._ensureRoot();
    const parts = dirPath.split('/').filter(Boolean);
    let handle  = root;
    for (const p of parts) handle = await handle.getDirectoryHandle(p);
    const entries = [];
    for await (const [name, h] of handle) {
      entries.push({ name, kind: h.kind, path: `${dirPath}/${name}` });
    }
    return entries;
  }
};

const BrowserExec = {
  async run(lang, code) {
    // Delegate to the existing sandboxed worker runner in the IDE.
    if (window.__kgRunner) return window.__kgRunner.run(lang, code);
    return { ok: false, error: 'No local server and no runner available.' };
  }
};

const RemoteProxy = {
  async call(provider, body) {
    // No local server: AI calls go directly from browser.
    // Only works if the provider allows browser CORS (Groq does, Anthropic doesn't).
    const base = { groq: 'https://api.groq.com/openai/v1',
                   together: 'https://api.together.xyz/v1' }[provider];
    if (!base) throw new Error(`Provider ${provider} requires local server (CORS blocked).`);
    const res = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body.body || body)
    });
    return res.json();
  }
};
