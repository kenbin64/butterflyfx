// manifold-ide/js/context-integration.js
// Wires ManifoldContext into the IDE's AI query flow.
//
// The IDE already produces manifold points from every model response
// via parseManifoldOutput(). This module stores those points and
// replaces raw history with compressed context once the history grows
// past a token threshold -- keeping every call cheap.
//
// Add two lines to the bottom of ide.js state init:
//   import { createContextIntegration } from './context-integration.js';
//   state.ctx = createContextIntegration(state);
//
// Then in sendQuery(), after each state.lastPoint = point:
//   state.ctx.onPoint(point, role);
//
// And replace the state.history slice passed to generate() with:
//   state.ctx.historyFor(state.history, currentPoint)
//
// That's the full integration. The rest is automatic.

import { ManifoldContext } from '../../manifold-ai/js/manifold-context.js';

// Token budget before we switch from raw history to compressed context.
// Below this, raw history is fine and cheaper. Above it, compression saves money.
const RAW_HISTORY_TOKEN_THRESHOLD = 4000;
const COMPRESSED_CONTEXT_BUDGET   = 2400;

// Rough token count for a history message array.
function historyTokens(history) {
  if (!Array.isArray(history)) return 0;
  return history.reduce((s, m) => s + Math.ceil((m.content || '').length / 4), 0);
}

// Format compressed context as a synthetic history entry the model can read.
function contextAsHistoryEntry(contextText) {
  return {
    role: 'user',
    content: '[Prior conversation compressed to manifold points]\n\n' + contextText,
  };
}

export function createContextIntegration(state, opts = {}) {
  const ctx = new ManifoldContext({
    capacity:          opts.capacity          || 128,
    pruneThreshold:    opts.pruneThreshold    || 1.4,
    maxContextTokens:  COMPRESSED_CONTEXT_BUDGET,
  });

  // Call after every parseManifoldOutput() result.
  // role: 'user' | 'assistant'
  function onPoint(point, role = 'assistant') {
    if (!point || point.x == null) return;
    ctx.push(ctx.fromEngineResponse ? ctx.fromEngineResponse(point, role) : { ...point, role });
  }

  // Call before engine.generate() to get the right history to pass.
  // If history is small: return it as-is (cheap, no compression needed).
  // If history is large: return [systemEntry, compressedContext, latestUserMsg].
  // The model gets full context either way, but at a fraction of the token cost.
  function historyFor(history, currentPoint) {
    if (!Array.isArray(history) || history.length === 0) return history;

    const tokens = historyTokens(history);
    if (tokens <= RAW_HISTORY_TOKEN_THRESHOLD) return history;

    // History is large. Compress the middle; keep system + last user message.
    const system    = history.filter(m => m.role === 'system');
    const lastUser  = history.filter(m => m.role === 'user').slice(-1);
    const queryPt   = currentPoint || ctx.current || { x: 0, y: [], z: 0, dim: 1 };
    const ctxText   = ctx.buildContext(queryPt, COMPRESSED_CONTEXT_BUDGET);

    const stats = ctx.savings();

    // Log to console if state has a logTo function.
    if (typeof state.logTo === 'function') {
      state.logTo('console', 'dim',
        `manifold context: ${stats.pointCount} points, ` +
        `${stats.raw} raw tokens -> ${ctxText.length > 0 ? Math.ceil(ctxText.length / 4) : 0} compressed ` +
        `(${Math.round(stats.ratio * 100)}% reduction)`
      );
    }

    if (!ctxText) return [...system, ...lastUser];
    return [...system, contextAsHistoryEntry(ctxText), ...lastUser];
  }

  // Add a user message as a point (before the model responds).
  function onUserMessage(text) {
    const pt = ctx.makePoint(text, 'user');
    ctx.push(pt);
  }

  // Token savings summary for display in the IDE status bar.
  function stats() {
    return ctx.savings();
  }

  // Evict context when the conversation is reset.
  function reset() {
    ctx._points = [];
    ctx._current = null;
  }

  return { onPoint, historyFor, onUserMessage, stats, reset, _ctx: ctx };
}
