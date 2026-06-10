// manifold-ide/js/runner.js
// Multi-language runner. JS in a sandboxed worker, Python via Pyodide.
// All client-side, all free, all unmetered.

const PYODIDE_URL = 'https://cdn.jsdelivr.net/pyodide/v0.26.4/full/pyodide.mjs';

class JSWorkerRunner {
  constructor() { this.worker = null; }

  async run(code, onLog) {
    this._kill();
    const blob = new Blob([this._workerSource()], { type: 'application/javascript' });
    const url = URL.createObjectURL(blob);
    this.worker = new Worker(url, { type: 'module' });

    return new Promise((resolve) => {
      const start = performance.now();
      this.worker.onmessage = (e) => {
        const { type, level, args, result, error } = e.data;
        if (type === 'log') onLog?.(level, args.join(' '));
        else if (type === 'done') {
          this._kill();
          URL.revokeObjectURL(url);
          resolve({ ok: true, result, ms: Math.round(performance.now() - start) });
        }
        else if (type === 'error') {
          this._kill();
          URL.revokeObjectURL(url);
          resolve({ ok: false, error, ms: Math.round(performance.now() - start) });
        }
      };
      this.worker.onerror = (e) => {
        this._kill();
        URL.revokeObjectURL(url);
        resolve({ ok: false, error: e.message, ms: Math.round(performance.now() - start) });
      };
      this.worker.postMessage({ code });

      // Hard timeout — protects against infinite loops.
      setTimeout(() => {
        if (this.worker) {
          onLog?.('warn', '⏱ killed after 10s timeout');
          this._kill();
          URL.revokeObjectURL(url);
          resolve({ ok: false, error: 'timeout', ms: 10000 });
        }
      }, 10000);
    });
  }

  _kill() { if (this.worker) { this.worker.terminate(); this.worker = null; } }

  _workerSource() {
    return `
      const post = (type, data) => self.postMessage({ type, ...data });
      ['log','info','warn','error','debug'].forEach(level => {
        const orig = console[level];
        console[level] = (...args) => {
          post('log', { level, args: args.map(a => {
            try { return typeof a === 'string' ? a : JSON.stringify(a); }
            catch(_) { return String(a); }
          }) });
          orig?.(...args);
        };
      });
      self.onmessage = async (e) => {
        try {
          const fn = new Function('return (async () => { ' + e.data.code + ' })();');
          const result = await fn();
          post('done', { result: result === undefined ? undefined : String(result) });
        } catch (err) {
          post('error', { error: (err && err.stack) || String(err) });
        }
      };
    `;
  }
}

class PythonRunner {
  constructor() { this.pyodide = null; this._loading = null; }

  async _ensure(onLog) {
    if (this.pyodide) return this.pyodide;
    if (!this._loading) {
      this._loading = (async () => {
        onLog?.('dim', '⟳ loading Pyodide (first run only, ~10 MB)…');
        const mod = await import(PYODIDE_URL);
        const py = await mod.loadPyodide({
          indexURL: 'https://cdn.jsdelivr.net/pyodide/v0.26.4/full/'
        });
        py.setStdout({ batched: (s) => onLog?.('log', s) });
        py.setStderr({ batched: (s) => onLog?.('err', s) });
        onLog?.('ok', '✓ Pyodide ready');
        this.pyodide = py;
        return py;
      })();
    }
    return this._loading;
  }

  async run(code, onLog) {
    const start = performance.now();
    try {
      const py = await this._ensure(onLog);
      // Re-bind stdout for this invocation so logs flow to current onLog.
      py.setStdout({ batched: (s) => onLog?.('log', s) });
      py.setStderr({ batched: (s) => onLog?.('err', s) });
      const result = await py.runPythonAsync(code);
      return {
        ok: true, result: result === undefined ? undefined : String(result),
        ms: Math.round(performance.now() - start)
      };
    } catch (err) {
      return { ok: false, error: String(err), ms: Math.round(performance.now() - start) };
    }
  }
}

export class Runner {
  constructor() {
    this.js = new JSWorkerRunner();
    this.py = new PythonRunner();
  }
  supports(lang) {
    return ['javascript', 'typescript', 'python'].includes(lang);
  }
  async run(lang, code, onLog) {
    if (lang === 'python') return this.py.run(code, onLog);
    if (lang === 'javascript') return this.js.run(code, onLog);
    if (lang === 'typescript') {
      // Naive TS strip — enough for ad-hoc scripts. For real TS use a worker compiler.
      const stripped = code
        .replace(/:\s*[A-Za-z_$][\w$<>,[\]\s|&?]*(?=[=,)\];])/g, '')
        .replace(/\binterface\s+\w+\s*\{[^}]*\}/g, '')
        .replace(/\btype\s+\w+\s*=\s*[^;]+;/g, '')
        .replace(/\bas\s+[A-Za-z_$][\w$<>,[\]\s|&?]*/g, '');
      return this.js.run(stripped, onLog);
    }
    onLog?.('warn', `no in-browser runner for ${lang}. Try: javascript, typescript, python.`);
    return { ok: false, error: `unsupported lang: ${lang}`, ms: 0 };
  }
}
