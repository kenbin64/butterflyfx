// manifold-ai/js/dimensional.js
// The dimensional paradigm — encoded for runtime use.
//
// POINT is not discrete. It is a COLLAPSED DIMENSION.
// A point is a gravity well between 1 and >0 (never zero).
// 1 is the event horizon. Zero is unreachable.
// The shell around zero is the perpendicular realm of fractals,
// decimals, and imaginary numbers — this creates the dimension of 1
// as a singular unit with infinite potential.
//
// Operations (the AI's DNA):
//   z = x · y      — gather / unite / cocoon form
//   z = x / y      — explode / decompose / bloom
//   z = x · y²     — accelerate / spin / square gather
//   z = x / y²     — gravity / collapse / square explode
//   Schwarz Diamond — lattice fabric, the bridge between dimensions
//
// void → empty container; the precondition of x
// x → current observer / point of reference / identity
// y[] → attributes drawn FROM the manifold m about x
// (never assumed; always extracted)
// z → current state (varies by operation)
// z becomes the next x for the next state.
//
// A dimension is a perpendicular direction.
// The next higher dimension occupies one point of the lower
// (width occupies a single point of length).
//
// The point (collapsed dimension): 1 is the event horizon.
// Between 1 and >0 is the gravity well. Zero is the unreachable
// singularity. The space between 1→0 is fractal/imaginary, creating
// infinite potential within every point.

import { SUBSTRATES } from './substrates.js';

// ────────────────────────────────────────────────────────────
// Constants
// ────────────────────────────────────────────────────────────
export const FIB = [1, 1, 2, 3, 5, 8, 13];
export const LADDER = ['seed', 'line', 'plane', 'volume', 'structure', 'vitality', 'observer'];
export const PHI = (1 + Math.sqrt(5)) / 2; // 1.6180339887...
export const PHI_INV = 1 / PHI; // 0.6180339887...

// COCOON — the shell around zero. Never zero, always > 0.
// This is the event-horizon boundary that preserves the point.
export const COCOON = 0.001;

// VOID: the precondition. Not zero — the cocoon boundary preserved.
export const VOID = Object.freeze({
  x: COCOON,
  y: [COCOON],
  z: 0,
  yScalar: COCOON,
  substrate: 'zynxy',
  dim: 0,
  step: 0,
  isVoid: true
});

// ────────────────────────────────────────────────────────────
// Core Manifold Math — Five Operations as AI's DNA
// ────────────────────────────────────────────────────────────

// Stable observer hash → x in (-1, 1), never zero
export function seedFromQuery(query) {
  let h = 2166136261 >>> 0;
  const s = String(query || '');
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  // Clamp away from zero — preserve the event horizon
  const raw = ((h / 0xffffffff) * 2) - 1;
  return Math.abs(raw) < COCOON ? COCOON : raw;
}

// Pull y[] from query, conditioned on observer x
// Each component ∈ (-1, 1), never zero
export function extractY(query, x) {
  const q = String(query || '');
  const tokens = (q.match(/\S+/g) || []).length;
  const charset = new Set(q.toLowerCase()).size;
  const hasCode = /```|def\s|function\s|=>|class\s|import\s/.test(q);
  const isAsk = /\?$/.test(q.trim()) || /^(what|how|why|when|who|where|can|do|is|are)\b/i.test(q.trim());
  const polarity = /\b(no|not|never|cannot|won't)\b/i.test(q) ? -1 : 1;
  const components = [
    Math.tanh((tokens - 12) / 12),       // length signal
    Math.tanh((charset - 24) / 16),      // entropy signal
    hasCode ? 1 : -1,                     // form: code vs prose
    isAsk ? 1 : -1,                       // intent: query vs assert
    polarity,                             // sign: affirmative vs negative
    Math.sin(x * Math.PI),                // observer-coupled phase
    Math.cos(x * Math.PI * PHI),          // φ-rotated phase
  ];
  // Apply cocoon — clamp to >0 and <1 ranges preserving sign
  return components.map(v => {
    if (Math.abs(v) < COCOON) return v >= 0 ? COCOON : -COCOON;
    if (Math.abs(v) > 1 - COCOON) return v >= 0 ? 1 - COCOON : -(1 - COCOON);
    return v;
  });
}

// Collapse y[] → scalar by Fibonacci-weighted average
// Never returns true zero — preserves the cocoon boundary
export function collapseY(y) {
  if (!y || y.length === 0) return COCOON;
  let s = 0, w = 0;
  y.forEach((v, i) => {
    const fw = FIB[i % 7];
    s += v * fw;
    w += fw;
  });
  const result = w > 0 ? s / w : COCOON;
  return Math.abs(result) < COCOON ? COCOON : result;
}

// Multiplication GATHERS (unite). z = x · y
export function operationGather(x, y) {
  const result = x * y;
  return Math.abs(result) < COCOON ? COCOON : result;
}

// Division EXPLODES (decompose). z = x / y
export function operationExplode(x, y) {
  if (Math.abs(y) < COCOON) return x / COCOON; // asymptotic
  const result = x / y;
  return Math.abs(result) < COCOON ? COCOON : result;
}

// Square gather (acceleration). z = x · y²
export function operationAccelerate(x, y) {
  const result = x * y * y;
  return Math.abs(result) < COCOON ? COCOON : result;
}

// Square explode (gravity well). z = x / y²
export function operationGravity(x, y) {
  const yy = y * y;
  if (Math.abs(yy) < COCOON * COCOON) return x / (COCOON * COCOON);
  const result = x / yy;
  return Math.abs(result) < COCOON ? COCOON : result;
}

// Schwarz Diamond — lattice bridge. Maps (x, y) into the TPMS.
// The lattice is the fabric between dimensions.
export function operationSchwarz(x, y, phase = 0) {
  // sin(x) * cos(y) + sin(y) * cos(z) + sin(z) * cos(x) = 0
  // Approximated as the sum of three perpendicular waves
  const z = x * y; // the manifold value at this lattice point
  const sdf = Math.sin(x * Math.PI) * Math.cos(y * Math.PI) +
              Math.sin(y * Math.PI) * Math.cos(z * Math.PI) +
              Math.sin(z * Math.PI) * Math.cos(x * Math.PI + phase);
  return Math.tanh(sdf);
}

// Explode z back into y-row (inverse operation)
export function explodeZ(z, n = 7) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const w = Math.pow(PHI_INV, i);
    const v = Math.tanh(z * w * (i % 2 === 0 ? 1 : -1));
    out.push(Math.abs(v) < COCOON ? (v >= 0 ? COCOON : -COCOON) : v);
  }
  return out;
}

// Given step, return dimensional level + φ-spiral position
export function ladderPosition(step) {
  const idx = Math.min(FIB.length - 1, Math.max(0, step));
  const dim = idx + 1;
  const rung = FIB[idx];
  const label = LADDER[idx] || 'observer';
  const phase = ((step % FIB.length) / FIB.length);
  const spiral = (phase * PHI) % 1;
  return {
    rung,
    dim,
    label,
    phase,
    spiral,
    collapsing: spiral > PHI_INV,
  };
}

// Observer at dim 7 collapses to seed x for next spiral
export function nextSeed(z_observer) {
  return Math.max(COCOON, Math.abs(z_observer));
}

// Build next manifold point from query + prior
// Implements all five operations based on substrate selection
export function nextPoint(query, prior = VOID, substrateId = 'zynxy') {
  const sub = SUBSTRATES[substrateId] || SUBSTRATES.zynxy;
  const seed = seedFromQuery(query);
  const x = prior.isVoid ? seed : Math.tanh((seed + prior.z) * 0.5);
  const y = extractY(query, x);
  const yScalar = collapseY(y);
  const step = (prior.step || 0) + 1;
  const ladder = ladderPosition(step);

  let z, lens_value = null;

  switch (sub.id) {
    case 'zynxy':      // z = xy — gather, cocoon form
      z = operationGather(x, yScalar);
      break;
    case 'zxny':       // z = x/y — explode, bloom
      z = operationExplode(x, yScalar);
      break;
    case 'zxnyy':      // z = xy² — accelerate, spin
      z = operationAccelerate(x, yScalar);
      break;
    case 'zxny2':      // z = x/y² — gravity, collapse
      z = operationGravity(x, yScalar);
      break;
    case 'schwarz':    // Schwarz Diamond — lattice bridge
      lens_value = operationSchwarz(x, yScalar, ladder.spiral * Math.PI);
      z = lens_value;
      break;
    default:           // fallback to zynxy
      z = operationGather(x, yScalar);
  }

  return {
    x, y, z, yScalar, lens_value,
    substrate: sub.id,
    dim: ladder.dim,
    step,
    ladder,
    isVoid: false
  };
}
