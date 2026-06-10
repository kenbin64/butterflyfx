// manifold-ai/js/code-agent.js
// Three transports for read/write/debug:
//   A. Browser sandbox  — Pyodide (Python) and JS eval, in-page only.
//   B. Local folder     — File System Access API (Chrome/Edge/Opera).
//   C. MCP bridge       — WebSocket/SSE to a user-run local MCP server.
//
// Each transport registers tools onto a single registry the LLM can call.

export class ToolRegistry {
  constructor() { this.tools = new Map(); this.transports = new Set(); }
  register(name, schema, handler) {
    this.tools.set(name, { schema, handler });
  }
  list() { return Array.from(this.tools.keys()); }
  async call(name, args) {
    const t = this.tools.get(name);
    if (!t) throw new Error(`unknown tool: ${name}`);
    return await t.handler(args || {});
  }
}

// ── A. Browser sandbox ──────────────────────────────────────────────
export class SandboxTransport {
  constructor() { this.pyodide = null; }
  async ensurePyodide() {
    if (this.pyodide) return this.pyodide;
    const mod = await import('https://cdn.jsdelivr.net/pyodide/v0.26.4/full/pyodide.mjs');
    this.pyodide = await mod.loadPyodide({
      indexURL: 'https://cdn.jsdelivr.net/pyodide/v0.26.4/full/'
    });
    return this.pyodide;
  }
  register(reg) {
    this.transports = 'sandbox';
    reg.register('code_exec',
      { lang: 'python|javascript', code: 'string' },
      async ({ lang, code }) => {
        if (lang === 'python') {
          const py = await this.ensurePyodide();
          try {
            const out = await py.runPythonAsync(code);
            return { ok: true, stdout: String(out ?? ''), engine: 'pyodide' };
          } catch (e) {
            return { ok: false, error: String(e), engine: 'pyodide' };
          }
        }
        if (lang === 'javascript' || lang === 'js') {
          // QuickJS in a Worker would be ideal; for v1 use Function in a closure.
          // SECURITY: this runs in the page; only invoke on user confirmation.
          try {
            const fn = new Function(`"use strict"; return (async()=>{ ${code} })()`);
            const out = await fn();
            return { ok: true, stdout: String(out ?? ''), engine: 'js-eval' };
          } catch (e) {
            return { ok: false, error: String(e), engine: 'js-eval' };
          }
        }
        return { ok: false, error: `unsupported lang: ${lang}` };
      }
    );
  }
}

// ── B. Local folder via File System Access API ──────────────────────
// Hard rule: every read/write is scoped to the granted root. Paths
// containing `..` or absolute paths are rejected. The user may opt
// into `autoAllowWrites` for the current root to skip per-write
// confirms; this flag resets on every new `grant()`.
export class FolderTransport {
  constructor() {
    this.root = null;
    this.autoAllowWrites = false;
    this.onScopeChange = null;  // optional hook: (rootName|null) => void
  }
  supported() { return 'showDirectoryPicker' in window; }
  async grant() {
    if (!this.supported()) throw new Error('File System Access API not supported in this browser. Use Chrome/Edge/Opera.');
    this.root = await window.showDirectoryPicker({ mode: 'readwrite' });
    // Switching roots resets the trust state — new scope, new decisions.
    this.autoAllowWrites = false;
    if (typeof this.onScopeChange === 'function') {
      try { this.onScopeChange(this.root.name); } catch (_) { }
    }
    return this.root.name;
  }
  setAutoAllow(flag) { this.autoAllowWrites = !!flag; }
  _sanitize(path) {
    const raw = String(path == null ? '' : path);
    if (/^[A-Za-z]:[\\/]/.test(raw) || raw.startsWith('/') || raw.startsWith('\\')) {
      throw new Error(`absolute paths are not allowed (got ${raw})`);
    }
    const parts = raw.split(/[\\/]+/).filter(Boolean);
    if (parts.some(p => p === '..' || p === '.')) {
      throw new Error(`path may not contain '..' or '.' segments (got ${raw})`);
    }
    return parts;
  }
  async resolve(path) {
    if (!this.root) throw new Error('no folder granted');
    const parts = this._sanitize(path);
    if (parts.length === 0) throw new Error('empty path');
    let dir = this.root;
    for (let i = 0; i < parts.length - 1; i++) {
      dir = await dir.getDirectoryHandle(parts[i], { create: false });
    }
    return { dir, name: parts[parts.length - 1], parts };
  }
  register(reg) {
    reg.register('fs_read', { path: 'string' }, async ({ path }) => {
      const { dir, name } = await this.resolve(path);
      const fh = await dir.getFileHandle(name);
      const file = await fh.getFile();
      return { ok: true, path, size: file.size, content: await file.text() };
    });
    reg.register('fs_write', { path: 'string', content: 'string' }, async ({ path, content }) => {
      const parts = this._sanitize(path);
      if (parts.length === 0) return { ok: false, error: 'empty path' };
      const scope = this.root ? this.root.name : '(no root)';
      if (!this.autoAllowWrites) {
        const ok = window.confirm(
          `Manifold AI wants to write ${content.length} chars to:\n  ${parts.join('/')}\n\n` +
          `Scope: ${scope} (root only)\n\nAllow this write?`
        );
        if (!ok) return { ok: false, error: 'user denied write' };
      }
      let dir = this.root;
      for (let i = 0; i < parts.length - 1; i++) {
        dir = await dir.getDirectoryHandle(parts[i], { create: true });
      }
      const fh = await dir.getFileHandle(parts[parts.length - 1], { create: true });
      const w = await fh.createWritable();
      await w.write(content);
      await w.close();
      return { ok: true, path: parts.join('/'), written: content.length, scope };
    });
    reg.register('fs_list', { path: 'string' }, async ({ path }) => {
      const parts = this._sanitize(path || '');
      let dir = this.root;
      for (const p of parts) dir = await dir.getDirectoryHandle(p, { create: false });
      const entries = [];
      for await (const [name, handle] of dir.entries()) {
        entries.push({ name, kind: handle.kind });
      }
      return { ok: true, path: parts.join('/') || '/', entries };
    });
  }
}

// ── C. MCP bridge (WebSocket; user runs server locally) ─────────────
// JSON-RPC 2.0 client over WebSocket. Speaks the MCP `initialize` /
// `tools/list` / `tools/call` handshake when the server supports it,
// and otherwise forwards arbitrary methods verbatim. Credentials are
// passed two ways (server can accept either):
//   1. As a WebSocket subprotocol token  → `bearer.<token>`
//   2. As a query parameter              → `?access_token=<token>`
// Browsers can't set arbitrary HTTP headers on WebSocket upgrades, so
// these are the two standard escape hatches used by MCP servers.
export class MCPTransport {
  constructor() {
    this.ws = null;
    this.next = 1;
    this.pending = new Map();
    this.url = null;
    this.token = null;
    this.serverInfo = null;   // { name, version } from initialize
    this.capabilities = null; // raw capabilities object
    this.tools = [];          // [{ name, description, inputSchema }]
    this.onToolsChanged = null;
  }
  /**
   * @param {string} url   ws://host:port path
   * @param {object} [opts]
   * @param {string} [opts.token] bearer token; sent via subprotocol + query
   * @param {string} [opts.clientName='manifold-ai'] reported to server
   */
  async connect(url, opts = {}) {
    const token = opts.token ? String(opts.token) : null;
    this.token = token;
    // Append ?access_token= so servers that only read query strings still authenticate.
    let connectUrl = url;
    if (token) {
      const sep = url.includes('?') ? '&' : '?';
      connectUrl = `${url}${sep}access_token=${encodeURIComponent(token)}`;
    }
    this.url = connectUrl;
    // Subprotocol-based bearer is the most common WS auth pattern.
    const protocols = token ? [`bearer.${token}`, 'mcp'] : ['mcp'];
    await new Promise((resolve, reject) => {
      let settled = false;
      try {
        this.ws = new WebSocket(connectUrl, protocols);
      } catch (e) {
        // Some servers reject unknown subprotocols outright; retry without.
        this.ws = new WebSocket(connectUrl);
      }
      this.ws.onopen = () => { settled = true; resolve(true); };
      this.ws.onerror = () => {
        if (!settled) reject(new Error('MCP connection failed (check URL, token, and that the bridge is running)'));
      };
      this.ws.onclose = (ev) => {
        if (!settled) reject(new Error(`MCP closed before open (code ${ev.code}${ev.reason ? ': ' + ev.reason : ''})`));
      };
      this.ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data);
          if (msg.id != null && this.pending.has(msg.id)) {
            const { resolve, reject } = this.pending.get(msg.id);
            this.pending.delete(msg.id);
            if (msg.error) reject(new Error(msg.error.message || 'mcp error'));
            else resolve(msg.result);
          }
          // Server-initiated notifications (msg.method, no id) are ignored for now.
        } catch (_) { /* ignore non-JSON frames */ }
      };
    });
    // Best-effort MCP handshake. Failures are non-fatal; raw rpc still works.
    try {
      const init = await this.rpc('initialize', {
        protocolVersion: '2024-11-05',
        clientInfo: { name: opts.clientName || 'manifold-ai', version: '0.5' },
        capabilities: { tools: {}, resources: {}, prompts: {} }
      });
      this.serverInfo = init?.serverInfo || null;
      this.capabilities = init?.capabilities || null;
    } catch (_) { /* server may not implement initialize */ }
    try {
      const list = await this.rpc('tools/list', {});
      this.tools = Array.isArray(list?.tools) ? list.tools : [];
      if (typeof this.onToolsChanged === 'function') this.onToolsChanged(this.tools);
    } catch (_) { this.tools = []; }
    return { url: connectUrl, server: this.serverInfo, tools: this.tools };
  }
  disconnect() {
    try { this.ws && this.ws.close(); } catch (_) { }
    this.ws = null;
    this.tools = [];
    this.serverInfo = null;
    this.capabilities = null;
  }
  connected() { return this.ws && this.ws.readyState === 1; }
  rpc(method, params) {
    if (!this.connected()) return Promise.reject(new Error('MCP not connected'));
    const id = this.next++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }));
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`mcp timeout: ${method}`));
        }
      }, 30000);
    });
  }
  /**
   * Call a tool. If the server advertised it via tools/list we route
   * through `tools/call` (the canonical MCP shape); otherwise we send
   * `method` directly so non-MCP JSON-RPC bridges still work.
   */
  async call(method, params) {
    const isAdvertised = this.tools.some(t => t.name === method);
    if (isAdvertised) {
      return await this.rpc('tools/call', { name: method, arguments: params || {} });
    }
    return await this.rpc(method, params || {});
  }
  register(reg) {
    reg.register('mcp_list',
      {},
      async () => ({
        ok: true,
        connected: this.connected(),
        server: this.serverInfo,
        tools: this.tools.map(t => ({ name: t.name, description: t.description || '' }))
      })
    );
    reg.register('mcp_call',
      { server: 'string?', method: 'string', params: 'object?' },
      async ({ method, params }) => {
        if (!this.connected()) throw new Error('MCP not connected');
        const result = await this.call(method, params);
        return { ok: true, result };
      }
    );
  }
}
