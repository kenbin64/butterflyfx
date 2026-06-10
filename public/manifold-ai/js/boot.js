// manifold-ai/js/boot.js
// Paged reader UX. Each Q+A is a page. Arrows / ←→ keys / swipe nav.
// Composer stays large at the bottom; engine boots lazily on first send.

import { SUBSTRATES, routeSubstrate } from './substrates.js';
import { createEngine, parseManifoldOutput } from './engine.js';
import { VOID } from './dimensional.js';
import { ToolRegistry, SandboxTransport, FolderTransport, MCPTransport }
  from './code-agent.js';

// Gate AI until the user is authenticated (server-verified).
if (!window.kgAuth || typeof window.kgAuth.ensureAuthed !== 'function') {
  throw new Error('auth-gate missing: window.kgAuth.ensureAuthed not found');
}
await window.kgAuth.ensureAuthed();

// Always-available instant engine for first-paint answers.
const instant = createEngine('deterministic');
await instant.init(() => { });

const $ = (sel) => document.querySelector(sel);
const ui = {
  reader: $('#reader'),
  helloPage: $('#helloPage'),
  pageIndicator: $('#pageIndicator'),
  prevBtn: $('#prevBtn'),
  nextBtn: $('#nextBtn'),
  composer: $('#composer'),
  prompt: $('#prompt'),
  sendBtn: $('#sendBtn'),
  status: $('#engineStatus'),
  lens: $('#substrateIndicator'),
  engineSelect: $('#engineSelect'),
  folderBtn: $('#grantFolderBtn'),
  mcpBtn: $('#connectMcpBtn'),
  toolList: $('#toolList'),
  chips: document.querySelectorAll('#exampleChips .chip'),
};

const state = {
  engine: null, enginePromise: null, engineKind: null,
  reg: new ToolRegistry(),
  sandbox: new SandboxTransport(),
  folder: new FolderTransport(),
  mcp: new MCPTransport(),
  history: [],
  ready: false,
  preferred: 'auto',
  pages: [],         // [{el, query, answerEl, toolHost, sub, point}]
  current: -1,       // -1 = hello
  lastPoint: VOID,   // dimensional state — z becomes next x
};
state.sandbox.register(state.reg);
refreshToolList();

// ─── Engine selection ─────────────────────────────────────
function pickAutoEngine() {
  if ('gpu' in navigator) return 'webllm';
  return 'transformers';
}

function refreshToolList() {
  ui.toolList.textContent = 'tools: ' + state.reg.list().join(', ');
}
function setStatus(text, cls = '') {
  ui.status.textContent = text;
  ui.status.className = 'status ' + cls;
}
function setLens(sub, runners = []) {
  const others = runners.map(r => r.id[0]).join(' · ');
  ui.lens.textContent = `${sub.glyph} ${sub.id}${others ? '  ·  ' + others : ''}`;
  ui.lens.style.borderColor = sub.lensColor;
  ui.lens.style.color = sub.lensColor;
}

// ─── Page management ─────────────────────────────────────
function buildPage(query, sub) {
  const article = document.createElement('article');
  article.className = 'page';

  const q = document.createElement('div');
  q.className = 'question';
  const qText = document.createElement('span');
  qText.textContent = '› ' + query;
  const qLens = document.createElement('span');
  qLens.className = 'lens-tag';
  qLens.textContent = `${sub.glyph} ${sub.id}`;
  q.append(qText, qLens);

  const answer = document.createElement('div');
  answer.className = 'answer thinking';
  answer.innerHTML = `<span class="typing"><span></span><span></span><span></span></span>`;

  const upgradeBar = document.createElement('div');
  upgradeBar.className = 'upgrade-bar hidden';
  upgradeBar.innerHTML = `
    <div class="upgrade-label"><span class="u-text">loading model…</span><span class="u-pct">0%</span></div>
    <div class="upgrade-track"><div class="upgrade-fill"></div></div>`;

  const meta = document.createElement('div');
  meta.className = 'meta-line';
  meta.textContent = '…';

  const toolHost = document.createElement('div');
  toolHost.className = 'tool-host';

  article.append(q, answer, upgradeBar, meta, toolHost);
  ui.reader.appendChild(article);

  state.pages.push({ el: article, answer, meta, toolHost, upgradeBar, sub, query });
  return state.pages.length - 1;
}

function showPage(idx) {
  // -1 means hello (only valid if no real pages exist).
  if (state.pages.length === 0) {
    state.current = -1;
    ui.helloPage.classList.add('active');
    updateNav();
    return;
  }
  ui.helloPage.classList.remove('active');
  idx = Math.max(0, Math.min(state.pages.length - 1, idx));
  state.pages.forEach((p, i) => {
    p.el.classList.toggle('active', i === idx);
    p.el.classList.toggle('prev', i < idx);
  });
  state.current = idx;
  updateNav();
}

function updateNav() {
  if (state.pages.length === 0) {
    ui.pageIndicator.textContent = '— / —';
    ui.prevBtn.disabled = true;
    ui.nextBtn.disabled = true;
    return;
  }
  ui.pageIndicator.textContent = `${state.current + 1} / ${state.pages.length}`;
  ui.prevBtn.disabled = state.current <= 0;
  ui.nextBtn.disabled = state.current >= state.pages.length - 1;
}

function goPrev() { if (state.current > 0) showPage(state.current - 1); }
function goNext() { if (state.current < state.pages.length - 1) showPage(state.current + 1); }
ui.prevBtn.addEventListener('click', goPrev);
ui.nextBtn.addEventListener('click', goNext);

// Initial state — hello page visible.
ui.helloPage.classList.add('active');
updateNav();

// ─── Engine lazy boot ────────────────────────────────────
function ensureEngine(onProgress) {
  if (state.enginePromise) {
    if (onProgress && state.lastProgress) onProgress(state.lastProgress);
    if (onProgress) state.progressSubscribers.add(onProgress);
    return state.enginePromise;
  }
  state.progressSubscribers = new Set();
  if (onProgress) state.progressSubscribers.add(onProgress);

  let kind = state.preferred === 'auto' ? pickAutoEngine() : state.preferred;
  state.engineKind = kind;
  state.engine = createEngine(kind);
  setStatus(`loading ${kind}…`, 'loading');

  const fanout = (p) => {
    state.lastProgress = p;
    const pct = Math.round((p.percent || 0) * 100);
    setStatus(`${kind} · ${p.label} ${pct}%`, 'loading');
    state.progressSubscribers.forEach(cb => { try { cb(p); } catch (_) { } });
  };

  state.enginePromise = state.engine.init(fanout).then(() => {
    state.ready = true;
    setStatus(`${kind} ready`);
    state.lastProgress = { stage: 'ready', percent: 1, label: 'ready' };
    state.progressSubscribers.forEach(cb => { try { cb(state.lastProgress); } catch (_) { } });
  }).catch((e) => {
    setStatus(`${kind} failed → falling back to deterministic`, 'error');
    if (kind !== 'deterministic') {
      state.preferred = 'deterministic';
      state.enginePromise = null;
      state.engine = instant;
      state.ready = true;
    }
    throw e;
  });
  return state.enginePromise;
}

// ─── Send ─────────────────────────────────────────────────
async function send(query) {
  const q = String(query || '').trim();
  if (!q) return;
  ui.prompt.value = '';
  ui.sendBtn.disabled = true;

  const route = routeSubstrate(q);
  setLens(route.substrate, route.runners);
  const idx = buildPage(q, route.substrate);
  showPage(idx);
  state.history.push({ role: 'user', content: q });

  const page = state.pages[idx];

  // 1. INSTANT answer — render immediately, no waiting.
  let instantPoint = null;
  try {
    const raw = await instant.generate(state.history, { substrate: route.substrate, prior: state.lastPoint });
    instantPoint = parseManifoldOutput(raw, route.substrate, state.lastPoint);
    renderAnswerInto(page, instantPoint, route.substrate, /*provisional*/ true);
    state.lastPoint = instantPoint;   // z → next x
  } catch (_) { /* never fails */ }

  ui.sendBtn.disabled = false;
  ui.prompt.focus();

  // 2. If user picked deterministic, we're done.
  const wantedKind = state.preferred === 'auto' ? pickAutoEngine() : state.preferred;
  if (wantedKind === 'deterministic') {
    page.upgradeBar.classList.add('hidden');
    return;
  }

  // 3. Show progress bar for LLM upgrade on this page.
  page.upgradeBar.classList.remove('hidden');
  const uText = page.upgradeBar.querySelector('.u-text');
  const uPct = page.upgradeBar.querySelector('.u-pct');
  const uFill = page.upgradeBar.querySelector('.upgrade-fill');
  const onProgress = (p) => {
    const pct = Math.round((p.percent || 0) * 100);
    uText.textContent = p.label || 'loading';
    uPct.textContent = pct + '%';
    uFill.style.width = pct + '%';
  };

  let llmReady = true;
  try {
    await ensureEngine(onProgress);
  } catch (e) {
    llmReady = false;
    page.upgradeBar.classList.add('hidden');
    appendNote(page, `model unavailable (${e.message || e}). Showing deterministic answer.`);
  }

  if (!llmReady) return;

  // 4. Upgrade with the real LLM answer.
  page.upgradeBar.classList.add('hidden');
  let raw;
  try {
    raw = await state.engine.generate(state.history, { substrate: route.substrate, prior: state.lastPoint });
  } catch (e) {
    appendNote(page, `model error: ${e.message || e}`);
    return;
  }
  const point = parseManifoldOutput(raw, route.substrate, state.lastPoint);
  state.history.push({ role: 'assistant', content: raw });
  state.lastPoint = point;            // z → next x (LLM result wins)
  renderAnswerInto(page, point, route.substrate, /*provisional*/ false);

  if (Array.isArray(point.tool_calls)) {
    for (const tc of point.tool_calls) {
      const tool = document.createElement('div');
      tool.className = 'tool';
      try {
        const result = await state.reg.call(tc.name, tc.arguments);
        tool.textContent = `${tc.name}(${JSON.stringify(tc.arguments)})\n→ ${JSON.stringify(result, null, 2).slice(0, 2000)}`;
        state.history.push({ role: 'tool', content: JSON.stringify(result) });
      } catch (e) {
        tool.textContent = `${tc.name} failed: ${e.message || e}`;
      }
      page.toolHost.appendChild(tool);
    }
  }
}

function renderAnswerInto(page, point, fallbackSub, provisional) {
  const sub = SUBSTRATES[point.substrate] || fallbackSub;
  page.answer.classList.remove('thinking');
  page.answer.classList.toggle('provisional', !!provisional);
  page.answer.textContent = point.answer || '(no answer)';
  const ladder = point.ladder || { dim: point.dim || 1, label: '—', rung: 1, spiral: 0 };
  const yScalar = (typeof point.yScalar === 'number') ? point.yScalar : 0;
  const dimLine = `dim ${ladder.dim} (${ladder.label}, F=${ladder.rung}) · φ-spiral ${ladder.spiral.toFixed(3)}`;
  const coreLine = sub.canonical
    ? `x = ${(+point.x).toFixed(4)}   ·   ∏y = ${yScalar.toFixed(4)}   ·   z = ${(+point.z).toFixed(4)}   ·   z = xy ✓`
    : `x = ${(+point.x).toFixed(4)}   ·   ∏y = ${yScalar.toFixed(4)}   ·   ${sub.id} lens = ${(+point.lens_value).toFixed(4)}`;
  page.meta.textContent =
    (provisional ? '◌ instant · ' : '◉ model · ') +
    `${sub.glyph} ${sub.id}  ·  ${dimLine}\n${coreLine}`;
}

function appendNote(page, text) {
  const n = document.createElement('div');
  n.className = 'tool';
  n.textContent = text;
  page.toolHost.appendChild(n);
}

// ─── Composer ─────────────────────────────────────────────
ui.composer.addEventListener('submit', (e) => { e.preventDefault(); send(ui.prompt.value); });
ui.prompt.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    ui.composer.requestSubmit();
  }
});
ui.chips.forEach(chip => chip.addEventListener('click', () => send(chip.dataset.q)));

// ─── Keyboard nav (← →) when composer not focused ───────
document.addEventListener('keydown', (e) => {
  const inField = document.activeElement === ui.prompt;
  if (e.key === 'ArrowLeft' && !inField) { goPrev(); }
  if (e.key === 'ArrowRight' && !inField) { goNext(); }
});

// ─── Touch swipe nav (on the reader) ─────────────────────
let touchStartX = null;
ui.reader.addEventListener('touchstart', (e) => {
  if (e.touches.length === 1) touchStartX = e.touches[0].clientX;
}, { passive: true });
ui.reader.addEventListener('touchend', (e) => {
  if (touchStartX === null) return;
  const dx = (e.changedTouches[0].clientX - touchStartX);
  touchStartX = null;
  if (Math.abs(dx) > 60) { dx > 0 ? goPrev() : goNext(); }
});

// ─── Header controls (engine select / folder / MCP) ────
ui.engineSelect.addEventListener('change', () => {
  const v = ui.engineSelect.value;
  state.preferred = v;
  if (state.ready || state.enginePromise) {
    setStatus(`engine "${v}" applies on next ask (reload to reset)`, 'loading');
  } else {
    setStatus(`engine: ${v}`);
  }
});

ui.folderBtn.addEventListener('click', async () => {
  try {
    const name = await state.folder.grant();
    state.folder.register(state.reg);
    refreshToolList();
    setStatus(`folder granted: ${name}`);
  } catch (e) {
    setStatus(`folder grant failed: ${e.message || e}`, 'error');
  }
});

ui.mcpBtn.addEventListener('click', async () => {
  if (state.mcp.connected && state.mcp.connected()) {
    const ok = window.confirm(
      `MCP connected to ${state.mcp.url}\n` +
      `${state.mcp.tools.length} tools available.\n\nDisconnect?`
    );
    if (ok) { state.mcp.disconnect(); refreshToolList(); setStatus('MCP disconnected'); }
    return;
  }
  const url = window.prompt(
    'MCP bridge WebSocket URL\n(start a local bridge first, e.g. `npx @kensgames/manifold-bridge`)',
    sessionStorage.getItem('mcp.url') || 'ws://localhost:8765'
  );
  if (!url) return;
  const tokenIn = window.prompt(
    `Bearer token for ${url} (blank = no auth).\n\n` +
    `Sent as WS subprotocol "bearer.<token>" and ?access_token=… so any compliant bridge can authenticate.\n` +
    `Held only in sessionStorage.`,
    sessionStorage.getItem('mcp.token') || ''
  );
  const token = tokenIn ? tokenIn.trim() : '';
  try {
    const info = await state.mcp.connect(url, token ? { token } : {});
    state.mcp.register(state.reg);
    state.mcp.onToolsChanged = () => refreshToolList();
    sessionStorage.setItem('mcp.url', url);
    if (token) sessionStorage.setItem('mcp.token', token);
    else sessionStorage.removeItem('mcp.token');
    refreshToolList();
    const sname = info?.server?.name ? ` · ${info.server.name}` : '';
    setStatus(`MCP: ${url}${sname} · ${info?.tools?.length || 0} tools${token ? ' · auth' : ''}`);
  } catch (e) {
    setStatus(`MCP connect failed: ${e.message || e}`, 'error');
  }
});

// ─── Initial UI state ────────────────────────────────────
setLens(SUBSTRATES.zynxy, [{ id: 'schwarz' }, { id: 'gyroid' }]);
const auto = pickAutoEngine();
setStatus(`ready · ${auto} on first ask`);
