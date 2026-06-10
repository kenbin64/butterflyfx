// manifold-ai/js/manifold-context.js
// ManifoldContext: stores conversation state as manifold points.
//
// A point is a collapsed identity: x (observer), y[] (modifiers read from
// the field), z = x * collapse(y) (manifested state). It lives in the
// imaginary fractal plane between void (0) and unity (1) -- never zero,
// never unbounded. Nature stores information this way. So do we.
//
// Instead of sending 50k tokens of raw history to every model call,
// compress to the N nearest points. Pass points as context.
// The model derives what it needs. Fewer tokens, same meaning.
//
// Every response from engine.js is already a manifold point (it outputs
// strict JSON: x, y, z, substrate, dim, answer). This class stores them,
// finds the nearest ones for a new query, and reconstructs minimal context.
//
// Proximity metric: Schwarz Diamond surface distance in (x, z, dim) space.
// Points on the same surface sheet are topologically close -- they share
// conceptual neighborhood. Points far away on the surface are unrelated
// and can be pruned without loss.

import { VOID, FIB, PHI } from './dimensional.js';

const TAU = 2 * Math.PI;

// Schwarz Diamond SDF: cos(x)cos(y)cos(z) - sin(x)sin(y)sin(z) = 0.
// Used as a proximity kernel: |F(delta)| small = points are near on the surface.
function schwarzD(x, y, z) {
  return (
    Math.sin(x) * Math.sin(y) * Math.sin(z) +
    Math.sin(x) * Math.cos(y) * Math.cos(z) +
    Math.cos(x) * Math.sin(y) * Math.cos(z) +
    Math.cos(x) * Math.cos(y) * Math.sin(z)
  );
}

// Collapse y[] to a scalar via the Fibonacci-weighted inner product.
// FIB = [1,1,2,3,5,8,13], one weight per dimensional rung.
function collapseY(yArr) {
  if (!Array.isArray(yArr) || yArr.length === 0) return 0;
  const weights = FIB || [1, 1, 2, 3, 5, 8, 13];
  let sum = 0, wSum = 0;
  for (let i = 0; i < yArr.length; i++) {
    const w = weights[i % weights.length] || 1;
    sum += (Number(yArr[i]) || 0) * w;
    wSum += w;
  }
  return wSum > 0 ? sum / wSum : 0;
}

// Manifold distance between two points in (x, z, dim) space.
// Weights: identity x is most important, state z is next, dimensional rung is least.
// Returns a scalar in [0, sqrt(0.6 + 0.3 + 0.1)] = [0, 1].
function manifoldDistance(a, b) {
  const dx = (a.x || 0) - (b.x || 0);
  const dz = (a.z || 0) - (b.z || 0);
  const dd = (Math.abs((a.dim || 1) - (b.dim || 1))) / 7;
  // Schwarz D surface value at the delta: measures topological closeness.
  const F = schwarzD(dx * Math.PI, dz * Math.PI, dd * TAU);
  // Combine Euclidean and surface term.
  const euclidean = Math.sqrt(dx * dx * 0.6 + dz * dz * 0.3 + dd * dd * 0.1);
  return euclidean * 0.7 + Math.abs(F) * 0.3;
}

// Rough token estimate: 1 token ~= 4 chars of text.
function estimateTokens(point) {
  if (point.tokens != null) return point.tokens;
  const text = (point.answer || '') + JSON.stringify(point.y || []);
  return Math.ceil(text.length / 4) + 12;
}

// Fibonacci weight for a dimensional rung. The seven rungs of the ladder:
//   1 seed, 2 line, 3 plane, 4 volume, 5 structure, 6 life, 7 awareness.
// A dim-7 point carries weight 13; a dim-1 point carries weight 1.
// A single insight at awareness outweighs thirteen raw observations.
// Used to bias retrieval toward higher rungs and prune lower rungs first.
function fibWeight(dim) {
  const d = Math.max(1, Math.min(7, Math.round(dim) || 1));
  return (FIB || [1, 1, 2, 3, 5, 8, 13])[d - 1];
}

// Effective distance, weighted by the point's dimensional rung.
// Higher-rung points are pulled "closer" (divided by their weight) so they
// survive pruning and win retrieval slots. This is the Fibonacci expansion
// applied to memory: deeper points persist, shallow points fade.
function weightedDistance(query, point) {
  const raw = manifoldDistance(query, point);
  const w = fibWeight(point.dim || 1);
  // Normalize by sqrt(weight) so the effect is strong but not overwhelming.
  return raw / Math.sqrt(w);
}

// Format a point as compact context text for passing to a model.
// Keeps it small: just the answer plus minimal coordinates for orientation.
function pointToContext(point, idx) {
  const sub = point.substrate || 'zynxy';
  const dim = point.dim || 1;
  const role = point.role || 'assistant';
  return `[${idx} ${role} dim=${dim} x=${(point.x || 0).toFixed(3)} z=${(point.z || 0).toFixed(3)} @${sub}]\n${point.answer || ''}`;
}

export class ManifoldContext {
  /**
   * @param {object} opts
   * @param {number} [opts.capacity=128]    Max points stored. Oldest pruned first.
   * @param {number} [opts.pruneThreshold=1.2] Distance beyond which points are pruned
   *                                           when the current identity shifts far enough.
   * @param {number} [opts.maxContextTokens=3000] Token budget for buildContext().
   */
  constructor(opts = {}) {
    this._capacity = opts.capacity || 128;
    this._pruneThreshold = opts.pruneThreshold || 1.2;
    this._maxContextTokens = opts.maxContextTokens || 3000;
    this._points = [];    // ring buffer, newest last
    this._current = null; // current identity point (the x we're at right now)
  }

  // Add a point. Engine responses are already manifold points.
  // For user messages, call makePoint() first.
  push(point) {
    if (!point || point.x == null) return;
    this._points.push({ ...point, _ts: Date.now() });
    if (this._points.length > this._capacity) this._points.shift();
    this._current = point;
    return this;
  }

  // Create a point from raw text (for user messages, before model response).
  // x is derived from a simple hash of the text normalized to [-1, 1].
  // The model will later provide the "true" point via its JSON response.
  makePoint(text, role = 'user') {
    const x = this._hashToX(text);
    return {
      x,
      y: [],
      z: 0,
      substrate: 'zynxy',
      dim: 1,
      answer: text,
      role,
      tokens: Math.ceil(text.length / 4),
    };
  }

  // Create a point from a model JSON response (engine.js output).
  fromEngineResponse(json, role = 'assistant') {
    return {
      x: json.x || 0,
      y: json.y || [],
      z: json.z || 0,
      substrate: json.substrate || 'zynxy',
      dim: json.dim || 1,
      answer: json.answer || '',
      role,
      tokens: estimateTokens({ answer: json.answer, y: json.y }),
    };
  }

  // Find the n nearest points to a query point.
  // Closer on the Schwarz Diamond surface = more topologically relevant.
  // Distance is Fibonacci-weighted: higher-rung points (structure, life,
  // awareness) are pulled closer so they win retrieval over raw seed points.
  nearest(queryPoint, n = 6, maxDimDelta = 6) {
    return this._points
      .filter(p => Math.abs((p.dim || 1) - (queryPoint.dim || 1)) <= maxDimDelta)
      .map(p => ({ point: p, dist: weightedDistance(queryPoint, p) }))
      .sort((a, b) => a.dist - b.dist)
      .slice(0, n)
      .map(({ point }) => point);
  }

  // Build a context string from nearest points within the token budget.
  // This replaces raw history. Pass the result as the `context` field
  // in a broker call instead of full conversation text.
  buildContext(queryPoint, tokenBudget) {
    const budget = tokenBudget || this._maxContextTokens;
    const candidates = this.nearest(queryPoint, this._capacity);
    const selected = [];
    let used = 0;

    for (const p of candidates) {
      const cost = estimateTokens(p);
      if (used + cost > budget) break;
      selected.push(p);
      used += cost;
    }

    if (selected.length === 0) return '';

    // Sort chronologically so the model reads them in order.
    selected.sort((a, b) => (a._ts || 0) - (b._ts || 0));

    const header = `[manifold context: ${selected.length} points, ~${used} tokens]\n`;
    return header + selected.map((p, i) => pointToContext(p, i)).join('\n\n');
  }

  // Collapse all stored points to a single summary point.
  // The summary x is the weighted centroid; y is the union; z = x * collapse(y).
  compress() {
    if (this._points.length === 0) return null;
    const weights = this._points.map((_, i) => (i + 1)); // newer = heavier
    const wSum = weights.reduce((s, w) => s + w, 0);
    const x = this._points.reduce((s, p, i) => s + (p.x || 0) * weights[i], 0) / wSum;
    const allY = this._points.flatMap(p => p.y || []);
    const z = x * collapseY(allY);
    const maxDim = Math.max(...this._points.map(p => p.dim || 1));
    const answers = this._points.map(p => p.answer || '').filter(Boolean);
    const answer = answers[answers.length - 1] || '';

    return {
      x, y: allY, z,
      substrate: 'zynxy',
      dim: Math.min(maxDim + 1, 7),
      answer,
      role: 'compressed',
      tokens: estimateTokens({ answer, y: allY }),
      _compressed: true,
      _count: this._points.length,
    };
  }

  // Prune points that are too far from the current identity.
  // When the conversation shifts topic, old points exceed pruneThreshold
  // and are released -- like forgetting what's no longer relevant.
  //
  // The threshold is scaled by each point's Fibonacci weight: a dim-7
  // awareness point tolerates ~3.6x the distance of a dim-1 seed before it
  // is dropped. Deep insights persist across topic shifts; raw observations
  // fade quickly. This is the ladder applied to forgetting.
  prune(currentPoint) {
    const ref = currentPoint || this._current;
    if (!ref) return this;
    this._points = this._points.filter(p => {
      const dist = manifoldDistance(ref, p);
      const tolerance = this._pruneThreshold * Math.sqrt(fibWeight(p.dim || 1));
      return dist <= tolerance;
    });
    return this;
  }

  // Token savings vs raw history: actual tokens stored vs tokens in points.
  savings() {
    const rawTokens = this._points.reduce((s, p) => s + estimateTokens(p), 0);
    const compressed = this.compress();
    const compressedTokens = compressed ? estimateTokens(compressed) : 0;
    return {
      raw: rawTokens,
      compressed: compressedTokens,
      ratio: rawTokens > 0 ? (1 - compressedTokens / rawTokens) : 0,
      pointCount: this._points.length,
    };
  }

  get size() { return this._points.length; }
  get current() { return this._current; }

  // Simple deterministic hash: maps a string to a float in [-1, 1].
  _hashToX(text) {
    let h = 0x811c9dc5;
    for (let i = 0; i < Math.min(text.length, 128); i++) {
      h ^= text.charCodeAt(i);
      h = (h * 0x01000193) >>> 0;
    }
    return ((h % 100000) / 50000) - 1;
  }
}
