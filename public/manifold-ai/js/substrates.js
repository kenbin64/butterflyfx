// manifold-ai/js/substrates.js
// Five operations as queryable lenses. The AI's DNA.
// Each is a different way the manifold manifests:
//
//   zynxy  — gather: z = x · y    (cocoon form, unite)
//   zxny   — explode: z = x / y   (bloom, decompose)
//   zxnyy  — accelerate: z = x · y²  (spin, square gather)
//   zxny2  — gravity: z = x / y²   (collapse, square explode)
//   schwarz — lattice: Schwarz Diamond TPMS (bridge between dimensions)
//
// A point is a collapsed dimension between 1 and >0 (never zero).
// 1 is the event horizon. The shell around zero is the perpendicular
// realm of fractals, decimals, and imaginary numbers.

export const SUBSTRATES = {
  // ── GATHER: z = x · y ──────────────────────────────────
  // The cocoon forms around the void. Identity + modifier unite.
  // Multiplication uniteth. The point emerges as a stable form.
  // Event horizon at 1, approaching 0 asymptotically.
  zynxy: {
    id: 'zynxy',
    glyph: '◈',
    name: 'gather',
    desc: 'Point cocoon forms around void. x·y unites identity and modifier. z→0+ but z≠0',
    canonical: false,
    expr: (x, y) => {
      const z = x * y;
      return Math.abs(z) < 0.001 ? 0.001 : z;
    },
    keywords: [
      'gather', 'unite', 'cocoon', 'form', 'identity', 'seed', 'observer',
      'exact', 'canonical', 'manifold', 'rule', 'definition', 'axiom',
      'specification', 'schema', 'contract', 'stable', 'point'
    ],
    bestFor: 'Gathering / uniting / forming stable points. The cocoon phase.',
    lensColor: '#7df9ff'
  },

  // ── EXPLODE: z = x / y ─────────────────────────────────
  // The cocoon opens. Division explodeth. Bloom expansion.
  // As y→0+, z→∞. Perpendicular bloom from the point.
  zxny: {
    id: 'zxny',
    glyph: '◆',
    name: 'explode',
    desc: 'Cocoon expansion. z=x/y — as y→0+, z→∞. Perpendicular bloom from the point.',
    canonical: false,
    expr: (x, y) => {
      const safeY = Math.abs(y) < 0.001 ? 0.001 : y;
      const z = x / safeY;
      return Math.abs(z) < 0.001 ? 0.001 : z;
    },
    keywords: [
      'explode', 'decompose', 'bloom', 'expand', 'divide', 'unfold',
      'release', 'emerge', 'open', 'unfurl', 'spread', 'diverge',
      'fractal', 'branch', 'split', 'perpendicular'
    ],
    bestFor: 'Exploding / decomposing / blooming from a point. The unfold phase.',
    lensColor: '#ff8a80'
  },

  // ── ACCELERATE: z = x · y² ─────────────────────────────
  // Square gathering. Cocoon spin. Acceleration of the point.
  // The squared modifier creates faster convergence/divergence.
  zxnyy: {
    id: 'zxnyy',
    glyph: '◈',
    name: 'accelerate',
    desc: 'Point bloom squared. z=x·y² — spin acceleration. Cocoon rotation in imaginary plane.',
    canonical: false,
    expr: (x, y) => {
      const z = x * y * y;
      return Math.abs(z) < 0.001 ? 0.001 : z;
    },
    keywords: [
      'accelerate', 'spin', 'square', 'quadratic', 'fast', 'rapid',
      'momentum', 'inertia', 'gyrate', 'rotate', 'twist', 'angular',
      'centrifugal', 'boost', 'amplify', 'magnify'
    ],
    bestFor: 'Acceleration / spinning / quadratic growth. The momentum phase.',
    lensColor: '#ffd166'
  },

  // ── GRAVITY: z = x / y² ────────────────────────────────
  // Square explosion. Gravity well. Collapse toward center.
  // The point draws to its center, never reaching zero.
  zxny2: {
    id: 'zxny2',
    glyph: '◉',
    name: 'gravity',
    desc: 'Collapse squared. z=x/y² — draw to center, never touch zero. Event horizon preserved.',
    canonical: false,
    expr: (x, y) => {
      const yy = y * y;
      const safeYY = Math.abs(yy) < 0.000001 ? 0.000001 : yy;
      const z = x / safeYY;
      return Math.abs(z) < 0.001 ? 0.001 : z;
    },
    keywords: [
      'gravity', 'collapse', 'center', 'attract', 'pull', 'draw',
      'converge', 'sink', 'fall', 'inward', 'core', 'nucleus',
      'event horizon', 'singularity', 'well', 'trap', 'bind'
    ],
    bestFor: 'Gravity / collapsing toward center / binding. The event horizon phase.',
    lensColor: '#b07dff'
  },

  // ── SCHWARZ DIAMOND: Lattice Bridge ────────────────────
  // The fabric between dimensions. Schwarz Diamond TPMS.
  // Every point is a lattice node. The bridge between dimensions.
  schwarz: {
    id: 'schwarz',
    glyph: '⬥',
    name: 'schwarz',
    desc: 'Fabric of space. Lattice bridge between dimensions. Every point is a node.',
    canonical: false,
    expr: (x, y, phase = 0) => {
      const z = x * y;
      const sdf = Math.sin(x * Math.PI) * Math.cos(y * Math.PI) +
                  Math.sin(y * Math.PI) * Math.cos(z * Math.PI) +
                  Math.sin(z * Math.PI) * Math.cos(x * Math.PI + phase);
      return Math.tanh(sdf);
    },
    keywords: [
      'lattice', 'schwarz', 'diamond', 'tpms', 'fabric', 'bridge',
      'between', 'dimension', 'weave', 'mesh', 'grid', 'net',
      'channel', 'portal', 'conduit', 'interface', 'boundary',
      'surface', 'minimal', 'triply periodic'
    ],
    bestFor: 'Lattice fabric / bridging dimensions / TPMS surfaces.',
    lensColor: '#4dffb0'
  }
};

// Route a query to the best substrate.
// Returns { substrate, score, runners }.
export function routeSubstrate(query) {
  const q = String(query || '').toLowerCase();
  const tokens = q.match(/[a-z][a-z0-9_-]+/g) || [];
  const tset = new Set(tokens);

  const scored = Object.values(SUBSTRATES).map(s => {
    let hits = 0;
    for (const k of s.keywords) if (tset.has(k)) hits++;
    // Default bias toward gather (zynxy) when nothing matches.
    const bias = s.id === 'zynxy' ? 0.5 : 0;
    return { substrate: s, score: hits + bias };
  }).sort((a, b) => b.score - a.score);

  return {
    substrate: scored[0].substrate,
    score: scored[0].score,
    runners: scored.slice(1).map(r => ({ id: r.substrate.id, score: r.score }))
  };
}

// Validate a manifold point against its substrate.
export function validateManifoldPoint(point) {
  const errors = [];
  if (!point || typeof point !== 'object') {
    return { ok: false, errors: ['point must be an object'] };
  }
  const { x, y, z, substrate, lens_value } = point;
  if (typeof x !== 'number' || !Number.isFinite(x)) errors.push('x must be a finite number');
  if (typeof y !== 'number' || !Number.isFinite(y)) errors.push('y must be a finite number');
  const sub = SUBSTRATES[substrate];
  if (!sub) errors.push(`unknown substrate: ${substrate}`);

  if (sub) {
    // For all substrates, validate the expression (no substrate is canonical anymore)
    // since each produces a different z from the same x,y
    if (typeof z !== 'number') errors.push(`z must be a number for ${sub.id}`);
    if (sub.id === 'schwarz' && typeof lens_value !== 'number') {
      errors.push('schwarz substrate requires numeric lens_value');
    }
  }

  return { ok: errors.length === 0, errors };
}

// Project a free-form query into a manifold seed.
// x = identity hash of the query (stable, observer-defined).
export function seedX(query) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < query.length; i++) {
    h ^= query.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  const raw = ((h / 0xffffffff) * 2) - 1;
  return Math.abs(raw) < 0.001 ? 0.001 : raw;
}
