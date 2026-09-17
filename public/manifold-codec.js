/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * 🜂 MANIFOLD CODEC: environment-agnostic identity projections
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * One algorithm, two homes. Both the Node lobby and the in-browser FastTrack
 * lens project session seeds onto the same 6-char invite-code alphabet. No
 * crypto module, no async digest: pure synchronous arithmetic so identity
 * derivation works identically on every surface that touches the manifold.
 *
 *   server: const { codeFromSeed } = require('./manifold-codec.js');
 *   browser: const { codeFromSeed } = window.ManifoldCodec;
 *
 * Algorithm: FNV-1a 32-bit over the canonical seed JSON, mixed with xorshift,
 * then mapped onto the 32-symbol alphabet (no I, O, 0, 1: unambiguous on a
 * phone screen). Six symbols ⇒ 32^6 ≈ 1.07B distinct codes; collision odds are
 * dominated by birthday limits on the active session frontier (the only set
 * codes are scanned against), not the underlying hash.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
'use strict';

const ManifoldCodec = (() => {
  const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 32 unambiguous chars
  const FNV_OFFSET = 0x811c9dc5;
  const FNV_PRIME  = 0x01000193;

  // FNV-1a over a UTF-8 byte stream. Returns an unsigned 32-bit integer.
  function fnv1a(str) {
    let h = FNV_OFFSET;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i) & 0xff;
      h = Math.imul(h, FNV_PRIME);
    }
    return h >>> 0;
  }

  // xorshift32: deterministic mix so successive bytes don't all share the
  // same low-bit avalanche of the FNV state. Six rounds ⇒ six code chars.
  function xorshift(state) {
    let s = state | 0;
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return s >>> 0;
  }

  // Canonical JSON for any seed shape. Arrays fix order; numbers are coerced
  // to a stable string form so 1 and 1.0 hash identically across runtimes.
  function canonical(seed) {
    if (seed === null || seed === undefined) return 'null';
    if (typeof seed === 'number') return Number(seed).toString();
    if (typeof seed === 'string') return JSON.stringify(seed);
    if (Array.isArray(seed)) return '[' + seed.map(canonical).join(',') + ']';
    if (typeof seed === 'object') {
      const keys = Object.keys(seed).sort();
      return '{' + keys.map(k => JSON.stringify(k) + ':' + canonical(seed[k])).join(',') + '}';
    }
    return String(seed);
  }

  // Project any seed onto a 6-char code from the alphabet. Pure projection.
  function codeFromSeed(seed) {
    let state = fnv1a(canonical(seed));
    let out = '';
    for (let i = 0; i < 6; i++) {
      state = xorshift(state || 0xdeadbeef);
      out += ALPHABET[state & 0x1f];
    }
    return out;
  }

  // 8-hex-char identity tag for any seed/payload: used for x_id / bloom_id
  // when callers need a stable but compact handle that survives transport.
  function idFromSeed(seed) {
    const h = fnv1a(canonical(seed));
    let mixed = h;
    for (let i = 0; i < 4; i++) mixed = xorshift(mixed || 0xdeadbeef);
    // Two FNV passes folded together for full 32-bit coverage.
    const hex = ((mixed ^ h) >>> 0).toString(16).padStart(8, '0');
    return hex;
  }

  // Deterministic PRNG (mulberry32) keyed off any seed shape. Returns a
  // function that yields floats in [0, 1). The same seed produces the same
  // stream on every surface (Node lobby, browser game), so all clients in a
  // session derive identical sequences: the manifold-first cure for each
  // client materialising its own board with a private Math.random().
  function prng(seed) {
    let a = (typeof seed === 'number' ? (seed >>> 0) : fnv1a(canonical(seed))) >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Deterministic Fisher-Yates shuffle. Returns a NEW array (input untouched).
  // The same (array, seed) yields an identical ordering on every surface, so a
  // single shared seed lets every client bloom the same deck / spawn order /
  // any other RNG-derived sequence. This is THE shared shuffle for all games.
  function seededShuffle(array, seed) {
    const a = Array.isArray(array) ? array.slice() : [];
    const rand = prng(seed);
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      const t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  return { ALPHABET, fnv1a, canonical, codeFromSeed, idFromSeed, prng, seededShuffle };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = ManifoldCodec;
if (typeof window !== 'undefined') window.ManifoldCodec = ManifoldCodec;
if (typeof globalThis !== 'undefined') globalThis.ManifoldCodec = ManifoldCodec;
