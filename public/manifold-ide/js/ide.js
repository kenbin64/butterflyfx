// manifold-ide/js/ide.js
// Manifold IDE main controller - FULLY ACTIVATED
// Reuses manifold-ai's engines, dimensional paradigm, and code-agent transports.

import { createEngine, parseManifoldOutput } from '../../manifold-ai/js/engine.js';
import { SUBSTRATES, routeSubstrate } from '../../manifold-ai/js/substrates.js';
import { VOID, ladderPosition, FIB, PHI } from '../../manifold-ai/js/dimensional.js';
import { ToolRegistry, SandboxTransport, FolderTransport, MCPTransport } from '../../manifold-ai/js/code-agent.js';
import { Runner } from './runner.js';
import { DimensionalDebugger } from './debugger.js';
import Secrets from './secrets.js';
import GitTransport from './git-transport.js';
import Indexer from './indexer.js';

// Public mode - skip auth gate
if (window.kgAuth?.ensureAuthed) {
  await window.kgAuth.ensureAuthed();
} else {
  window.__kgAuthed = true;
  window.__kgToken = null;
  window.__allowServerHandshake = true;
}

const MONACO_BASE = 'https://cdn.jsdelivr.net/npm/monaco-editor@0.50.0/min/vs';
const $ = (s, r = document) => r.querySelector(s);

// ────────────────────────────────────────────────────────────
// UI Elements
// ────────────────────────────────────────────────────────────
const ui = {
  filePath: $('#filePath'), langSelect: $('#langSelect'), engineSelect: $('#engineSelect'),
  runBtn: $('#runBtn'), debugBtn: $('#debugBtn'), deployBtn: $('#deployBtn'),
  folderBtn: $('#grantFolderBtn'), mcpBtn: $('#connectMcpBtn'), gitBtn: $('#gitBtn'),
  newFileBtn: $('#newFileBtn'), examplesBtn: $('#examplesBtn'), ingestBtn: $('#ingestBtn'),
  aiDiagBtn: $('#aiDiagBtn'), secretBtn: $('#secretBtn'), addDeployBtn: $('#addDeployBtn'),
  dimIndicator: $('#dimIndicator'), scopeRoot: $('#scopeRoot'), allowAllBtn: $('#allowAllBtn'),
  tree: $('#tree'), tabBar: $('#tabBar'), tabsList: $('#tabsList'), editorHost: $('#editorHost'),
  bottom: $('#bottom'), paneConsole: $('#paneConsole'), paneDebug: $('#paneDebug'),
  paneManifold: $('#paneManifold'), panePreview: $('#panePreview'), previewFrame: $('#previewFrame'),
  clearConsole: $('#clearConsoleBtn'), bottomToggle: $('#bottomToggle'),
  aiPage: $('#aiPage'), aiPrevBtn: $('#aiPrevBtn'), aiNextBtn: $('#aiNextBtn'),
  aiLatestBtn: $('#aiLatestBtn'), aiPageInd: $('#aiPageIndicator'), aiProgress: $('#aiProgress'),
  aiPrompt: $('#aiPrompt'), aiForm: $('#aiForm'), aiStatus: $('#aiStatus'),
  toolList: $('#toolList'), ideStatus: $('#ideStatus'), cursorPos: $('#cursorPos'),
  deployList: $('#deployList'), secretPanel: $('#secretPanel'),
  secretPass: $('#secretPass'), secretUnlockBtn: $('#secretUnlockBtn'), secretCreateBtn: $('#secretCreateBtn'),
  secretLockBtn: $('#secretLockBtn'), secretLocalOnlyToggle: $('#secretLocalOnlyToggle'),
  secretOwnerAccessToggle: $('#secretOwnerAccessToggle'), secretBridgeUrl: $('#secretBridgeUrl'),
  secretBridgeSave: $('#secretBridgeSave'), secretBridgeConnect: $('#secretBridgeConnect'),
  secretBridgeSSH: $('#secretBridgeSSH'), secretExportBtn: $('#secretExportBtn'), secretImportBtn: $('#secretImportBtn'),
  gitPanel: $('#gitPanel'), gitFilesList: $('#gitFilesList'), gitCommitMsg: $('#gitCommitMsg'),
  gitCommitBtn: $('#gitCommitBtn'), gitStageAllBtn: $('#gitStageAllBtn'), gitCloseBtn: $('#gitCloseBtn')
};

const EXAMPLE_LIST = [
  { id: 'collapse_demo.py', label: 'Python: collapse_demo (repo)', path: '/dimensionalprogramming/examples/collapse_demo.py' },
  { id: 'benchmark_demo.py', label: 'Python: benchmark_demo (repo)', path: '/dimensionalprogramming/examples/benchmark_demo.py' },
  { id: 'js_point', label: 'JavaScript: point demo', path: null },
  { id: 'manifold_lens', label: '3D: z=xy Manifold Lens', path: null },
];

// ────────────────────────────────────────────────────────────
// State
// ────────────────────────────────────────────────────────────
const state = {
  monaco: null, editor: null, models: new Map(), active: null, dirty: new Set(),
  folder: new FolderTransport(), tree: null,
  reg: new ToolRegistry(), sandbox: new SandboxTransport(), mcp: null,
  instant: createEngine('deterministic'), engine: null, enginePromise: null,
  preferred: 'transformers', lastPoint: VOID, history: [], pages: [], pageIndex: -1, pinLatest: true,
  runner: new Runner(), debugger: null, bottomPane: 'console', fileCount: 0,
  deployAllow: new Set(), lastDeployTarget: null, git: new GitTransport(),
  lastProgress: null, progressSubs: new Set()
};

state.sandbox.register(state.reg);
state.mcp = state.sandbox;
state.debugger = new DimensionalDebugger(state.runner, () => {});
await state.instant.init(() => {});

// ────────────────────────────────────────────────────────────
// AI Tool Registration - so the chatbox can actually read/write/run
// ────────────────────────────────────────────────────────────
state.reg.register('file_read', { path: 'string' }, async ({ path }) => {
  const model = state.models.get(path) || state.models.get(`inmemory:///${path}`);
  if (model) return { ok: true, content: model.getValue(), source: 'memory' };
  try {
    const r = await state.reg.call('fs_read', { path });
    return { ok: true, content: r.content, source: 'fs' };
  } catch (e) { return { ok: false, error: e.message }; }
});

state.reg.register('file_write', { path: 'string', content: 'string' }, async ({ path, content }) => {
  try {
    const r = await state.reg.call('fs_write', { path, content });
    return { ok: true, result: r };
  } catch (e) {
    return { ok: false, error: 'no-folder-or-denied', detail: e.message };
  }
});

state.reg.register('file_list', { path: 'string?' }, async ({ path }) => {
  try {
    const r = await state.reg.call('fs_list', { path: path || '' });
    return { ok: true, entries: r.entries };
  } catch (e) { return { ok: false, error: e.message }; }
});

state.reg.register('run_code', { lang: 'string', path: 'string?' }, async ({ lang, path }) => {
  try {
    let code = null;
    if (path) {
      const model = state.models.get(path) || state.models.get(`inmemory:///${path}`);
      if (model) code = model.getValue();
      else {
        const r = await state.reg.call('fs_read', { path });
        code = r.content;
      }
    } else return { ok: false, error: 'no-path-specified' };
    if (!state.runner.supports(lang)) return { ok: false, error: `no-runner-for-${lang}` };
    const onLog = (level, text) => logTo('console', level, `[run:${path||'inline'}] ${text}`);
    return await state.runner.run(lang, code, onLog);
  } catch (e) { return { ok: false, error: e.message }; }
});

state.reg.register('list_open', {}, async () => ({ ok: true, open: Array.from(state.models.keys()) }));

// ────────────────────────────────────────────────────────────
// Monaco Loader
// ────────────────────────────────────────────────────────────
async function loadMonaco() {
  if (state.monaco) return state.monaco;
  setStatus('loading editor…', 'loading');
  await new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = `${MONACO_BASE}/loader.js`;
    s.onload = resolve; s.onerror = reject;
    document.head.appendChild(s);
  });
  await new Promise((resolve) => {
    window.require.config({ paths: { vs: MONACO_BASE } });
    window.MonacoEnvironment = {
      getWorkerUrl: () => `data:text/javascript;charset=utf-8,${encodeURIComponent(`
        self.MonacoEnvironment = { baseUrl: '${MONACO_BASE}/' };
        importScripts('${MONACO_BASE}/base/worker/workerMain.js');`)}`
    };
    window.require(['vs/editor/editor.main'], () => resolve());
  });
  state.monaco = window.monaco;
  state.monaco.editor.defineTheme('manifold-dark', {
    base: 'vs-dark', inherit: true,
    rules: [
      { token: 'comment', foreground: '5b6a85', fontStyle: 'italic' },
      { token: 'keyword', foreground: '7df9ff' },
      { token: 'string', foreground: 'ffd9a8' },
      { token: 'number', foreground: 'b07dff' },
    ],
    colors: {
      'editor.background': '#05060a', 'editor.foreground': '#e8eef8',
      'editorLineNumber.foreground': '#3a4660', 'editorLineNumber.activeForeground': '#7df9ff',
      'editorCursor.foreground': '#7df9ff', 'editor.selectionBackground': '#2a3850',
      'editor.lineHighlightBackground': '#0a0e16', 'editorIndentGuide.background': '#1a2030',
    }
  });
  setStatus('editor ready');
  return state.monaco;
}

// ────────────────────────────────────────────────────────────
// File/Editor Core
// ────────────────────────────────────────────────────────────
async function openFile(path, content, lang) {
  await loadMonaco();
  if (!state.editor) {
    state.editor = state.monaco.editor.create(ui.editorHost, {
      value: '', language: lang || 'javascript', theme: 'manifold-dark',
      fontSize: 13.5, minimap: { enabled: false }, automaticLayout: true,
      scrollBeyondLastLine: false, tabSize: 2, wordWrap: 'on'
    });
    state.editor.onDidChangeCursorPosition((e) => {
      ui.cursorPos.textContent = `Ln ${e.position.lineNumber}, Col ${e.position.column}`;
    });
    state.editor.onDidChangeModelContent(() => {
      if (state.active) state.dirty.add(state.active);
      renderTabs();
    });
    bindShortcuts();
  }

  let model = state.models.get(path);
  if (!model) {
    const guessed = lang || guessLang(path);
    model = state.monaco.editor.createModel(content || '', guessed,
      state.monaco.Uri.parse(`inmemory:///${path}`));
    state.models.set(path, model);
  } else if (content!= null && content!== model.getValue()) {
    model.setValue(content);
  }

  state.editor.setModel(model);
  state.active = path;
  ui.filePath.textContent = path;
  ui.langSelect.value = model.getLanguageId();
  state.dirty.delete(path);
  renderTabs();
  state.fileCount = state.models.size;
  updateDim();
}

function closeFile(path) {
  const model = state.models.get(path);
  if (model) model.dispose();
  state.models.delete(path);
  state.dirty.delete(path);
  if (state.active === path) {
    const next = [...state.models.keys()][0];
    if (next) openFile(next);
    else { state.editor?.setModel(null); state.active = null; ui.filePath.textContent = 'untitled'; }
  }
  renderTabs();
}

function guessLang(path) {
  const ext = (path.split('.').pop() || '').toLowerCase();
  return ({ js: 'javascript', mjs: 'javascript', ts: 'typescript', py: 'python',
    html: 'html', css: 'css', json: 'json', md: 'markdown', rs: 'rust', go: 'go', sh: 'shell' })[ext] || 'plaintext';
}

function extForLang(lang) {
  return ({ javascript: 'js', typescript: 'ts', python: 'py', html: 'html',
    css: 'css', json: 'json', markdown: 'md', rust: 'rs', go: 'go', shell: 'sh' })[lang] || 'txt';
}

function renderTabs() {
  ui.tabBar.innerHTML = '';
  ui.tabsList.innerHTML = '';
  for (const path of state.models.keys()) {
    const tab = document.createElement('div');
    tab.className = 'tab' + (path === state.active? ' active' : '') + (state.dirty.has(path)? ' dirty' : '');
    const label = document.createElement('span');
    label.textContent = path.split('/').pop();
    label.title = path;
    label.onclick = () => openFile(path);
    const x = document.createElement('span');
    x.className = 'x'; x.textContent = '✕';
    x.onclick = (e) => { e.stopPropagation(); closeFile(path); };
    tab.append(label, x);
    ui.tabBar.appendChild(tab);
  }
}

// ────────────────────────────────────────────────────────────
// Console / Status
// ────────────────────────────────────────────────────────────
function logTo(pane, level, text) {
  const el = pane === 'debug'? ui.paneDebug : pane === 'manifold'? ui.paneManifold : ui.paneConsole;
  const span = document.createElement('span');
  span.className = level || '';
  span.textContent = text + '\n';
  el.appendChild(span);
  el.scrollTop = el.scrollHeight;
  showBottom();
}
function clearPane(pane) { (pane === 'debug'? ui.paneDebug : pane === 'manifold'? ui.paneManifold : ui.paneConsole).innerHTML = ''; }
function setBottomPane(name) {
  state.bottomPane = name;
  document.querySelectorAll('.bt-tab').forEach(b => b.classList.toggle('active', b.dataset.pane === name));
  document.querySelectorAll('.pane').forEach(p => p.classList.toggle('active', p.classList.contains('pane-' + name)));
}
function showBottom() { ui.bottom.classList.remove('collapsed'); ui.bottomToggle.textContent = '▾'; }
function toggleBottom() {
  ui.bottom.classList.toggle('collapsed');
  ui.bottomToggle.textContent = ui.bottom.classList.contains('collapsed')? '▴' : '▾';
}
function setStatus(text, cls = '') {
  ui.ideStatus.textContent = text;
  ui.ideStatus.className = 'status ' + cls;
}
function refreshTools() { ui.toolList.textContent = 'tools: ' + state.reg.list().join(', '); }
function updateDim() {
  const step = Math.max(0, state.fileCount - 1);
  const ladder = ladderPosition(step);
  ui.dimIndicator.textContent = `◇ dim ${ladder.dim} (${ladder.label}, F=${ladder.rung})`;
}

// ────────────────────────────────────────────────────────────
// Run / Debug / Save / Deploy
// ────────────────────────────────────────────────────────────
async function runActive() {
  if (!state.editor) return setStatus('no file open', 'error');
  const code = state.editor.getValue();
  const lang = state.editor.getModel().getLanguageId();
  if (!state.runner.supports(lang)) return logTo('console', 'warn', `no in-browser runner for ${lang}`);
  setBottomPane('console'); clearPane('console');
  logTo('console', 'acc', `▶ run · ${lang} · ${state.active || 'untitled'}`);
  setStatus('running…', 'loading');
  const onLog = (level, text) => logTo('console', level, text);
  const result = await state.runner.run(lang, code, onLog);
  if (result.ok) {
    logTo('console', 'ok', `✓ done in ${result.ms} ms`);
    if (result.result!== undefined) logTo('console', 'dim', ` return: ${result.result}`);
    setStatus(`ran in ${result.ms} ms`);
    if (lang === 'html') { ui.previewFrame.srcdoc = code; setBottomPane('preview'); }
  } else {
    logTo('console', 'err', `✗ ${result.error}`);
    setStatus(`run error`, 'error');
  }
}

async function debugActive() {
  if (!state.editor) return;
  const code = state.editor.getValue();
  const lang = state.editor.getModel().getLanguageId();
  if (!state.runner.supports(lang)) return logTo('debug', 'warn', `no debugger for ${lang}`);
  setBottomPane('debug'); clearPane('debug');
  setStatus('debugging…', 'loading');
  const onLog = (level, text) => logTo('debug', level, text);
  const result = await state.debugger.debug(lang, code, onLog);
  setStatus(result.ok? `debug · ${result.steps} steps · finalZ=${result.finalZ.toFixed(3)}` : 'debug error', result.ok? '' : 'error');
}

async function saveActive() {
  if (!state.editor ||!state.active) return;
  const content = state.editor.getValue();
  if (state.folder.root) {
    try {
      const rootName = state.folder.root.name + '/';
      const rel = state.active.startsWith(rootName)? state.active.slice(rootName.length) : state.active;
      await state.reg.call('fs_write', { path: rel, content });
      state.dirty.delete(state.active);
      renderTabs();
      setStatus(`saved ${rel}`);
    } catch (e) { setStatus(`save failed: ${e.message}`, 'error'); }
  } else {
    const blob = new Blob([content], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = state.active.split('/').pop();
    a.click();
    URL.revokeObjectURL(a.href);
    state.dirty.delete(state.active);
    renderTabs();
    setStatus('downloaded');
  }
}

async function deployActive() {
  if (!state.active) return setStatus('open a file first', 'error');
  const code = state.editor.getValue();
  const suggested = state.lastDeployTarget || state.active;
  const target = window.prompt(`Deploy target on MCP bridge.\nOnly targets you approve here are allowed.`, suggested);
  if (!target) return;
  if (!state.deployAllow.has(target)) {
    const ok = window.confirm(`"${target}" is not in your deploy allowlist.\nApprove this target?`);
    if (!ok) return setStatus('deploy cancelled', 'error');
    state.deployAllow.add(target);
    renderDeployList();
  }
  state.lastDeployTarget = target;
  setBottomPane('console');
  logTo('console', 'acc', `☁ deploy · ${target}`);
  setStatus('deploying…', 'loading');
  try {
    const r = await state.reg.call('mcp_call', {
      server: 'deploy', method: 'deploy_file',
      params: { path: target, content: code, lang: state.editor.getModel().getLanguageId() }
    });
    if (r?.ok) {
      logTo('console', 'ok', `✓ deployed: ${JSON.stringify(r.result || r)}`);
      setStatus('deployed');
    } else {
      logTo('console', 'err', `✗ deploy failed: ${JSON.stringify(r)}`);
      setStatus('deploy failed', 'error');
    }
  } catch (e) {
    logTo('console', 'err', `✗ deploy failed: ${e.message}`);
    setStatus('deploy failed', 'error');
  }
}

// ────────────────────────────────────────────────────────────
// Folder Tree
// ────────────────────────────────────────────────────────────
async function grantFolder() {
  try {
    const name = await state.folder.grant();
    state.folder.register(state.reg);
    refreshTools();
    state.tree = await buildTree(state.folder.root);
    renderTree();
    state.deployAllow = new Set();
    renderDeployList();
    updateScopeUI();
    setStatus(`scope → ${name}`);
  } catch (e) { setStatus(`folder failed: ${e.message}`, 'error'); }
}

async function buildTree(handle, path = '') {
  const node = { name: handle.name, kind: 'dir', handle, path: path || handle.name, children: [] };
  for await (const [name, child] of handle.entries()) {
    if (name.startsWith('.') || name === 'node_modules') continue;
    const childPath = `${node.path}/${name}`;
    if (child.kind === 'directory') node.children.push(await buildTree(child, childPath));
    else node.children.push({ name, kind: 'file', handle: child, path: childPath });
  }
  node.children.sort((a, b) => (a.kind === b.kind)? a.name.localeCompare(b.name) : a.kind === 'dir'? -1 : 1);
  return node;
}

function renderTree() {
  ui.tree.innerHTML = '';
  if (!state.tree) {
    ui.tree.innerHTML = '<div class="tree-empty">no folder granted<br><small>click 📁 folder above</small></div>';
    return;
  }
  ui.tree.appendChild(renderTreeNode(state.tree, true));
}

function renderTreeNode(node, isRoot = false) {
  const wrap = document.createElement('div');
  const row = document.createElement('div');
  row.className = 'tree-node ' + node.kind;
  if (state.active === node.path) row.classList.add('active');
  const ico = document.createElement('span');
  ico.className = 'ico'; ico.textContent = node.kind === 'dir'? '▸' : '·';
  const lbl = document.createElement('span'); lbl.textContent = node.name;
  row.append(ico, lbl); wrap.appendChild(row);

  if (node.kind === 'dir') {
    const children = document.createElement('div');
    children.className = 'tree-children';
    if (!isRoot) children.style.display = 'none';
    node.children.forEach(c => children.appendChild(renderTreeNode(c, false)));
    wrap.appendChild(children);
    row.onclick = () => {
      const open = children.style.display!== 'none';
      children.style.display = open? 'none' : '';
      ico.textContent = open? '▸' : '▾';
    };
    if (isRoot) ico.textContent = '▾';
  } else {
    row.onclick = async () => {
      try {
        const file = await node.handle.getFile();
        const text = await file.text();
        await openFile(node.path, text, guessLang(node.path));
        renderTree();
      } catch (e) { setStatus(`open failed: ${e.message}`, 'error'); }
    };
  }
  return wrap;
}

function updateScopeUI() {
  const root = state.folder.root;
  if (root) {
    ui.scopeRoot.textContent = root.name;
    ui.scopeRoot.classList.remove('none');
  } else {
    ui.scopeRoot.textContent = '(no root — writes disabled)';
    ui.scopeRoot.classList.add('none');
  }
  const on =!!state.folder.autoAllowWrites;
  ui.allowAllBtn.setAttribute('aria-pressed', on? 'true' : 'false');
  ui.allowAllBtn.textContent = on? '🔓 allow all in root' : '🔒 confirm each';
}

function renderDeployList() {
  ui.deployList.innerHTML = '';
  if (state.deployAllow.size === 0) {
    ui.deployList.innerHTML = '<div class="tree-empty"><small>no targets · ☁ deploy will ask first</small></div>';
    return;
  }
  for (const t of state.deployAllow) {
    const row = document.createElement('div');
    row.className = 'dp-item';
    row.innerHTML = `<span class="dp-ico">☁</span><span class="dp-path" title="${t}">${t}</span><span class="dp-rm" title="remove">✕</span>`;
    row.querySelector('.dp-path').onclick = () => { state.lastDeployTarget = t; setStatus(`deploy default → ${t}`); };
    row.querySelector('.dp-rm').onclick = () => { state.deployAllow.delete(t); renderDeployList(); };
    ui.deployList.appendChild(row);
  }
}

// ────────────────────────────────────────────────────────────
// Manifold AI Chatbox - Client-side models
// ────────────────────────────────────────────────────────────
function pickAutoEngine() { return ('gpu' in navigator)? 'webllm' : 'transformers'; }

function getSelectedEngineKind() {
  return ui.engineSelect?.value || state.preferred || 'deterministic';
}

async function ensureEngine(onProgress) {
  // Always read the current dropdown value — this is what makes engine selection work
  const kind = getSelectedEngineKind();
  state.preferred = kind;

  // If it's already loaded with this kind, reuse it
  if (state.enginePromise && state.engineKind === kind) {
    if (onProgress && state.lastProgress) onProgress(state.lastProgress);
    return state.enginePromise;
  }

  // Clear any previous engine and create a new one
  state.enginePromise = null;
  state.engineKind = kind;

  if (kind === 'auto') {
    const auto = pickAutoEngine();
    state.engine = createEngine(auto);
    state.engineKind = auto;
  } else {
    state.engine = createEngine(kind);
  }

  ui.aiStatus.textContent = `loading ${state.engineKind}…`;
  state.enginePromise = state.engine.init(onProgress).then(() => {
    ui.aiStatus.textContent = `${state.engineKind} ready`;
  }).catch((e) => {
    ui.aiStatus.textContent = `${state.engineKind} failed → deterministic`;
    state.preferred = 'deterministic';
    state.engineKind = 'deterministic';
    state.engine = state.instant;
    state.enginePromise = null;
    throw e;
  });
  return state.enginePromise;
}

function aiAddMessage(role, text, opts = {}) {
  const div = document.createElement('div');
  div.className = `ai-msg ${role}` + (opts.provisional? ' provisional' : '');
  const body = document.createElement('div');
  body.className = 'body'; body.textContent = text;
  div.appendChild(body);
  if (opts.meta) {
    const m = document.createElement('div');
    m.className = 'meta'; m.textContent = opts.meta;
    div.appendChild(m);
  }
  if (opts.patch) {
    const actions = document.createElement('div');
    actions.className = 'patch-actions';
    const apply = document.createElement('button');
    apply.className = 'patch-btn'; apply.textContent = '↳ apply patch';
    apply.onclick = () => applyPatch(opts.patch);
    actions.appendChild(apply); div.appendChild(actions);
  }
  const page = { role, text, opts, container: div, body };
  state.pages.push(page);
  if (state.pinLatest || state.pageIndex === state.pages.length - 2) {
    state.pageIndex = state.pages.length - 1;
  }
  renderPage();
  return page;
}

function updateMessage(page, text, opts = {}) {
  if (!page) return;
  page.text = text;
  if (opts && Object.keys(opts).length) page.opts = {...page.opts,...opts };
  const fresh = document.createElement('div');
  fresh.className = `ai-msg ${page.role}`;
  const body = document.createElement('div');
  body.className = 'body'; body.textContent = text;
  fresh.appendChild(body);
  if (page.opts.meta) {
    const m = document.createElement('div');
    m.className = 'meta'; m.textContent = page.opts.meta;
    fresh.appendChild(m);
  }
  page.container.replaceWith(fresh);
  page.container = fresh; page.body = body;
  if (state.pages[state.pageIndex] === page) renderPage();
}

function renderPage() {
  const total = state.pages.length;
  ui.aiPage.innerHTML = '';
  if (total === 0) {
    ui.aiPage.classList.add('ai-page-empty');
    ui.aiPage.innerHTML = '<div class="ai-empty-hint">No messages yet — ask the manifold below.</div>';
  } else {
    ui.aiPage.classList.remove('ai-page-empty');
    const idx = Math.max(0, Math.min(state.pageIndex, total - 1));
    state.pageIndex = idx;
    ui.aiPage.appendChild(state.pages[idx].container);
    ui.aiPage.scrollTop = 0;
  }
  ui.aiPageInd.textContent = total === 0? '0 / 0' : `${state.pageIndex + 1} / ${total}`;
  ui.aiPrevBtn.disabled = state.pageIndex <= 0;
  ui.aiNextBtn.disabled = state.pageIndex >= total - 1;
  ui.aiLatestBtn.disabled = state.pinLatest && state.pageIndex === total - 1;
}

function gotoPage(idx) {
  if (!state.pages.length) return;
  state.pageIndex = Math.max(0, Math.min(idx, state.pages.length - 1));
  state.pinLatest = state.pageIndex === state.pages.length - 1;
  renderPage();
}

function applyPatch(text) {
  if (!state.editor) return;
  const m = text.match(/```[\w-]*\n([\s\S]+?)\n```/);
  const newCode = m? m[1] : text;
  const oldCode = state.editor.getValue();
  const delta = newCode.length - oldCode.length;
  const ok = window.confirm(`Apply patch to ${state.active || 'editor'}?\n\nOld: ${oldCode.length} chars\nNew: ${newCode.length} chars (${delta >= 0? '+' : ''}${delta})\n\nThis only changes the in-editor buffer.`);
  if (!ok) return setStatus('patch declined');
  state.editor.setValue(newCode);
  if (state.active) state.dirty.add(state.active);
  renderTabs();
  setStatus('patch applied (unsaved)');
}

function buildCodeContext() {
  if (!state.editor) return '';
  const code = state.editor.getValue();
  const lang = state.editor.getModel().getLanguageId();
  const path = state.active || 'untitled';
  const cap = code.length > 4000? code.slice(0, 4000) + '\n…[truncated]' : code;
  return `file: ${path}\nlang: ${lang}\n\`\`\`${lang}\n${cap}\n\`\`\``;
}

async function askAI(query) {
  const q = String(query || '').trim();
  if (!q) return;
  ui.aiPrompt.value = '';
  const ctx = state.editor? buildCodeContext() : '';
  const fullQuery = ctx? `${q}\n\n--- code context ---\n${ctx}` : q;
  aiAddMessage('user', q);
  state.history.push({ role: 'user', content: fullQuery });
  const route = routeSubstrate(fullQuery);

  let asMsg = aiAddMessage('assistant', '…', { provisional: true });
  try {
    const raw = await state.instant.generate(state.history, { substrate: route.substrate, prior: state.lastPoint });
    const point = parseManifoldOutput(raw, route.substrate, state.lastPoint);
    updateMessage(asMsg, point.answer || '(no answer)', {
      provisional: true,
      meta: `${route.substrate.glyph} ${route.substrate.id} · z=${(+point.z).toFixed(3)}`
    });
    state.lastPoint = point;
  } catch (_) {}

  const wantedKind = state.preferred === 'auto'? pickAutoEngine() : state.preferred;
  if (wantedKind === 'deterministic') {
    if (state.lastPoint?.tool_calls) {
      for (const tc of state.lastPoint.tool_calls) {
        try {
          const r = await state.reg.call(tc.name, tc.arguments);
          aiAddMessage('assistant', `↳ ${tc.name}: ${JSON.stringify(r).slice(0, 400)}`, { meta: 'tool result' });
        } catch (e) { aiAddMessage('assistant', `↳ ${tc.name} failed: ${e.message}`); }
      }
    }
    return;
  }

  ui.aiProgress.classList.remove('hidden');
  const uText = ui.aiProgress.querySelector('.u-text');
  const uPct = ui.aiProgress.querySelector('.u-pct');
  const uFill = ui.aiProgress.querySelector('.upgrade-fill');
  const onProg = (p) => {
    const pct = Math.round((p.percent || 0) * 100);
    uText.textContent = p.label || 'loading';
    uPct.textContent = pct + '%';
    uFill.style.width = pct + '%';
  };

  try { await ensureEngine(onProg); }
  catch (e) {
    ui.aiProgress.classList.add('hidden');
    aiAddMessage('assistant', `model unavailable (${e.message}). Showing instant answer.`);
    return;
  }
  ui.aiProgress.classList.add('hidden');

  let raw;
  try {
    raw = await state.engine.generate(state.history, { substrate: route.substrate, prior: state.lastPoint });
  } catch (e) { aiAddMessage('assistant', `model error: ${e.message}`); return; }

  const point = parseManifoldOutput(raw, route.substrate, state.lastPoint);
  state.history.push({ role: 'assistant', content: raw });
  state.lastPoint = point;
  aiAddMessage('assistant', point.answer || '(no answer)', {
    meta: `${route.substrate.glyph} ${route.substrate.id} · z=${(+point.z).toFixed(3)}`,
    patch: /```[\w-]*\n[\s\S]+?\n```/.test(point.answer)? point.answer : null
  });

  if (Array.isArray(point.tool_calls)) {
    for (const tc of point.tool_calls) {
      try {
        const r = await state.reg.call(tc.name, tc.arguments);
        aiAddMessage('assistant', `↳ ${tc.name}: ${JSON.stringify(r).slice(0, 400)}`, { meta: 'tool result' });
      } catch (e) { aiAddMessage('assistant', `↳ ${tc.name} failed: ${e.message}`); }
    }
  }
}

// ────────────────────────────────────────────────────────────
// Misc Features: Git, Examples, Ingest, Diagnostics
// ────────────────────────────────────────────────────────────
async function startIngest() {
  if (!state.folder.root) return alert('No folder granted. Click 📁 to grant a folder first.');
  setBottomPane('console'); clearPane('console');
  logTo('console', 'acc', 'Starting Markdown ingest...');
  try {
    const docs = await Indexer.ingestAll(state.reg, (doc) => logTo('console', 'ok', `indexed: ${doc.path}`));
    logTo('console', 'ok', `ingest complete: ${docs.length} docs`);
    setStatus('ingest complete');
  } catch (e) {
    logTo('console', 'err', 'ingest failed: ' + e.message);
    setStatus('ingest failed', 'error');
  }
}

async function runAiDiagnostics() {
  setBottomPane('console'); clearPane('console');
  logTo('console', 'acc', 'AI diagnostics starting...');
  logTo('console', '', `Registered tools: ${state.reg.list().join(', ')}`);
  try {
    if (!state.instant.ready) await state.instant.init(() => {});
    const raw = await state.instant.generate([{ role: 'user', content: 'ping' }], {});
    logTo('console', 'ok', 'deterministic generate ok: ' + String(raw).slice(0, 400));
  } catch (e) { logTo('console', 'err', 'deterministic generate failed: ' + e.message); }
  const wanted = state.preferred === 'auto'? pickAutoEngine() : state.preferred;
  if (wanted!== 'deterministic') {
    try {
      await ensureEngine((p) => logTo('console', '', `progress: ${p.label} ${Math.round((p.percent||0)*100)}%`));
      logTo('console', 'ok', `${wanted} engine initialized`);
      const out = await state.engine.generate([{ role: 'user', content: 'ping' }], {});
      logTo('console', 'ok', `${wanted} generate ok: ${String(out).slice(0,400)}`);
    } catch (e) { logTo('console', 'warn', `engine init failed: ${e.message}`); }
  }
  logTo('console', 'acc', 'AI diagnostics complete');
}

async function openExamplesMenu() {
  const choice = window.prompt('Examples:\n1) Python: collapse_demo\n2) Python: benchmark_demo\n3) JavaScript: point demo\n4) 3D: z=xy Manifold Lens\n\nEnter 1-4', '1');
  if (!choice) return;
  const ex = EXAMPLE_LIST[parseInt(choice) - 1];
  if (!ex) return;
  if (ex.path) {
    try {
      const res = await fetch(ex.path);
      if (!res.ok) throw new Error('fetch failed: ' + res.status);
      const text = await res.text();
      await openFile(`examples/${ex.id}`, text, ex.id.endsWith('.py')? 'python' : 'plaintext');
      setStatus(`inserted ${ex.label}`);
      if (ex.id.endsWith('.py')) await runActive();
    } catch (e) { setStatus('example insert failed: ' + e.message, 'error'); }
  } else if (ex.id === 'js_point') {
    const js = `// examples/point.js\nasync function main() {\n const x = 4, y = 6;\n

  console.log('point product =', x * y);\n}\nmain();\`;
      await openFile('examples/point.js', js, 'javascript');
      setStatus('inserted JavaScript point demo');
      await runActive();
    } else if (ex.id === 'manifold_lens') {
      setStatus('loading Manifold Lens...', 'loading');
      loadPreview('../manifold-lens.html');
      setBottomPane('preview');
      logTo('console', 'ok', 'Manifold Lens loaded in PREVIEW pane.');
    }
  } catch (e) { setStatus('example insert failed: ' + e.message, 'error'); }
}

function loadPreview(url) {
  if (ui.previewFrame) ui.previewFrame.src = url;
}

// ────────────────────────────────────────────────────────────
// Init — wire everything up
// ────────────────────────────────────────────────────────────
initSecretUI();
maybeShowSecretButton();
initPublicBanner();
updateScopeUI();
renderDeployList();

const WELCOME = \`// Manifold IDE · z = xy
// Type code below or ask the AI panel on the right.
// Ctrl+Enter to run, Ctrl+S to save, 💡 for examples.

console.log('Hello from the Manifold IDE!');
const x = 4, y = 6;
// Point is a collapsed dimension. 1 is event horizon. Zero unreachable.
// z = x · y — gather (cocoon form)
// z = x / y — explode (bloom)
// z = x · y² — accelerate (spin)
// z = x / y² — gravity (collapse)
// ⬥ schwarz — lattice (bridge between dimensions)
console.log('z =', x * y, '← gathered state');
\`;

await openFile('welcome.js', WELCOME, 'javascript');

ui.runBtn.onclick = runActive;
ui.debugBtn.onclick = debugActive;
ui.deployBtn.onclick = deployActive;
ui.folderBtn.onclick = grantFolder;
ui.allowAllBtn.onclick = () => {
  state.folder.autoAllowWrites = !state.folder.autoAllowWrites;
  updateScopeUI();
};
ui.newFileBtn.onclick = () => {
  const lang = ui.langSelect.value;
  const ext = extForLang(lang);
  const name = window.prompt('New file name:', \`untitled.\${ext}\`);
  if (name) openFile(name, '', lang);
};
ui.mcpBtn.onclick = () => {
  const url = window.prompt('MCP WebSocket URL:', sessionStorage.getItem('mcp.url') || 'ws://localhost:8765');
  if (url) connectToMcp(url, sessionStorage.getItem('mcp.token') || '');
};
ui.aiDiagBtn.onclick = runAiDiagnostics;
ui.ingestBtn.onclick = startIngest;

ui.engineSelect.onchange = () => {
  const kind = getSelectedEngineKind();
  state.preferred = kind;
  state.enginePromise = null;
  state.engineKind = null;
  setStatus(\`engine set to \${kind}\`);
};

ui.aiForm.onsubmit = (e) => { e.preventDefault(); askAI(ui.aiPrompt.value); };

document.querySelectorAll('.ai-chip').forEach(chip => {
  chip.onclick = () => {
    const action = chip.dataset.action;
    const path = state.active || '';
    const prompts = {
      explain: \`Explain this code in terms of the manifold. What operation (gather/explode/accelerate/gravity/schwarz) best describes it?\`,
      refactor: \`Refactor this code using dimensional programming principles. Show the z = xy transformation.\`,
      fix: \`Find and fix bugs in this code. Explain the fix as a manifold correction.\`,
      test: \`Write tests for this code using the 5 operations of the manifold.\`,
    };
    ui.aiPrompt.value = (prompts[action] || '') + (path ? \`\\n\\nFile: \${path}\` : '');
    ui.aiForm.requestSubmit();
  };
});

function bindShortcuts() {
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.key === 'Enter') { e.preventDefault(); runActive(); }
    if (e.ctrlKey && e.key === 's') { e.preventDefault(); saveActive(); }
    if (e.ctrlKey && e.key === 'b') { document.getElementById('sideLeft')?.classList.toggle('collapsed'); }
    if (e.ctrlKey && e.key === 'j') { toggleBottom(); }
    if (e.altKey && e.key === 'ArrowLeft') { e.preventDefault(); gotoPage(state.pageIndex - 1); }
    if (e.altKey && e.key === 'ArrowRight') { e.preventDefault(); gotoPage(state.pageIndex + 1); }
  });
}

ui.aiPrevBtn.onclick = () => gotoPage(state.pageIndex - 1);
ui.aiNextBtn.onclick = () => gotoPage(state.pageIndex + 1);
ui.aiLatestBtn.onclick = () => gotoPage(state.pages.length - 1);

setStatus('Manifold IDE ready');
console.log('◇ Manifold IDE activated — five operations, one point.');

  console.log('point product =', x * y);\n}\nmain();\`;
      await openFile('examples/point.js', js, 'javascript');
      setStatus('inserted JavaScript point demo');
      await runActive();
    } else if (ex.id === 'manifold_lens') {
      setStatus('loading Manifold Lens...', 'loading');
      loadPreview('../manifold-lens.html');
      setBottomPane('preview');
      logTo('console', 'ok', 'Manifold Lens loaded in PREVIEW pane.');
    }
  } catch (e) { setStatus('example insert failed: ' + e.message, 'error'); }
}

function loadPreview(url) {
  if (ui.previewFrame) ui.previewFrame.src = url;
}

// ────────────────────────────────────────────────────────────
// Init — wire everything up
// ────────────────────────────────────────────────────────────
initSecretUI();
maybeShowSecretButton();
initPublicBanner();
updateScopeUI();
renderDeployList();

const WELCOME = \`// Manifold IDE · z = xy
// Type code below or ask the AI panel on the right.
// Ctrl+Enter to run, Ctrl+S to save, 💡 for examples.

console.log('Hello from the Manifold IDE!');
const x = 4, y = 6;
// Point is a collapsed dimension. 1 is event horizon. Zero unreachable.
// z = x · y — gather (cocoon form)
// z = x / y — explode (bloom)
// z = x · y² — accelerate (spin)
// z = x / y² — gravity (collapse)
// ⬥ schwarz — lattice (bridge between dimensions)
console.log('z =', x * y, '← gathered state');
\`;

await openFile('welcome.js', WELCOME, 'javascript');

ui.runBtn.onclick = runActive;
ui.debugBtn.onclick = debugActive;
ui.deployBtn.onclick = deployActive;
ui.folderBtn.onclick = grantFolder;
ui.allowAllBtn.onclick = () => {
  state.folder.autoAllowWrites = !state.folder.autoAllowWrites;
  updateScopeUI();
};
ui.newFileBtn.onclick = () => {
  const lang = ui.langSelect.value;
  const ext = extForLang(lang);
  const name = window.prompt('New file name:', \`untitled.\${ext}\`);
  if (name) openFile(name, '', lang);
};
ui.mcpBtn.onclick = () => {
  const url = window.prompt('MCP WebSocket URL:', sessionStorage.getItem('mcp.url') || 'ws://localhost:8765');
  if (url) connectToMcp(url, sessionStorage.getItem('mcp.token') || '');
};
ui.aiDiagBtn.onclick = runAiDiagnostics;
ui.ingestBtn.onclick = startIngest;

ui.engineSelect.onchange = () => {
  const kind = getSelectedEngineKind();
  state.preferred = kind;
  state.enginePromise = null;
  state.engineKind = null;
  setStatus(\`engine set to \${kind}\`);
};

ui.aiForm.onsubmit = (e) => { e.preventDefault(); askAI(ui.aiPrompt.value); };

document.querySelectorAll('.ai-chip').forEach(chip => {
  chip.onclick = () => {
    const action = chip.dataset.action;
    const path = state.active || '';
    const prompts = {
      explain: \`Explain this code in terms of the manifold. What operation (gather/explode/accelerate/gravity/schwarz) best describes it?\`,
      refactor: \`Refactor this code using dimensional programming principles. Show the z = xy transformation.\`,
      fix: \`Find and fix bugs in this code. Explain the fix as a manifold correction.\`,
      test: \`Write tests for this code using the 5 operations of the manifold.\`,
    };
    ui.aiPrompt.value = (prompts[action] || '') + (path ? \`\\n\\nFile: \${path}\` : '');
    ui.aiForm.requestSubmit();
  };
});

function bindShortcuts() {
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.key === 'Enter') { e.preventDefault(); runActive(); }
    if (e.ctrlKey && e.key === 's') { e.preventDefault(); saveActive(); }
    if (e.ctrlKey && e.key === 'b') { document.getElementById('sideLeft')?.classList.toggle('collapsed'); }
    if (e.ctrlKey && e.key === 'j') { toggleBottom(); }
    if (e.altKey && e.key === 'ArrowLeft') { e.preventDefault(); gotoPage(state.pageIndex - 1); }
    if (e.altKey && e.key === 'ArrowRight') { e.preventDefault(); gotoPage(state.pageIndex + 1); }
  });
}

ui.aiPrevBtn.onclick = () => gotoPage(state.pageIndex - 1);
ui.aiNextBtn.onclick = () => gotoPage(state.pageIndex + 1);
ui.aiLatestBtn.onclick = () => gotoPage(state.pages.length - 1);

setStatus('Manifold IDE ready');
console.log('◇ Manifold IDE activated — five operations, one point.');
