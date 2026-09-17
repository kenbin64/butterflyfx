/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * 🦋 ButterflyFx: universal harness
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Wrap any logic you already have; change nothing about how it computes; get a
 * manifold-compliant entity that is reproducible, auditable, testable, and
 * tamper-evident: security as a property of the architecture, not an add-on.
 *
 * The only contract is the shape every framework already has underneath
 * (reducers, event handlers, step functions, state machines):
 *
 *     reduce(state, action, ctx) -> state          // pure, no side effects
 *
 * with `state === null` returning the initial state. Express a transition by
 * returning a NEW state; reject one by returning the input unchanged. That is
 * the whole adapter surface: your existing code goes inside `reduce`.
 *
 * What the harness then guarantees, by construction:
 *   - REPRODUCIBLE   state = fold(reduce) over (seed, action-log). Same seed +
 *                    same actions ⇒ byte-identical state, on any machine.
 *   - AUDITABLE      the action-log IS the full ordered history; time-travel to
 *                    any prefix with at(n); nothing happens off the log.
 *   - SECURE-BY-ARCH state is always DERIVED, never stored or mutated, so there
 *                    is no shared mutable state to corrupt; the only mutation
 *                    surface is dispatch(), which only logs actions that the
 *                    reducer actually accepted (rejected actions never enter
 *                    the record).
 *   - TAMPER-EVIDENT the log is hash-chained (each entry binds the previous
 *                    hash + the action + the resulting state). Altering ANY
 *                    past action changes head(); verify() re-derives from
 *                    scratch and detects it. The head hash is a Merkle-style
 *                    root anyone holding it can check.
 *
 * Honest boundary: this makes any DETERMINISTIC, reducer-shaped logic manifold-
 * compliant. Frameworks with hidden non-determinism (clocks, network, RNG, I/O)
 * become compliant by LIFTING those effects into actions (record the drawn
 * card, the timestamp, the response): the same discipline event sourcing and
 * deterministic-simulation testing use. Nothing here is magic; it is a small,
 * principled kernel that gives those guarantees for free once your transitions
 * are pure.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
'use strict';

(function (root, factory) {
  const codec = (typeof require === 'function') ? require('./manifold-codec.js') : (root && root.ManifoldCodec);
  const mod = factory(codec);
  if (typeof module !== 'undefined' && module.exports) module.exports = mod;
  if (root) root.ButterflyFx = mod;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (codec) {

  const canon = (v) => JSON.stringify(v === undefined ? null : v);
  const eq = (a, b) => canon(a) === canon(b);
  const _fallbackHash = (s) => { let h = 0x811c9dc5 >>> 0; const str = String(s); for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i) & 0xff; h = Math.imul(h, 0x01000193) >>> 0; } return (h >>> 0).toString(16).padStart(8, '0'); };
  const hash = (s) => (codec && codec.idFromSeed) ? codec.idFromSeed(String(s)) : _fallbackHash(s);

  // Forge a manifold-compliant entity around your reduce().
  //   spec = { seed?, create?(seed)->ctx, reduce(state,action,ctx)->state }
  function forge(spec) {
    if (!spec || typeof spec.reduce !== 'function') {
      throw new Error('ButterflyFx.forge: { reduce(state, action, ctx) } is required');
    }
    const seed = spec.seed != null ? String(spec.seed) : ('x-' + hash(canon(spec) + ':' + (forge._n = (forge._n || 0) + 1)));
    const create = typeof spec.create === 'function' ? spec.create : ((s) => ({ seed: s }));
    const reduce = spec.reduce;
    const ctx = create(seed);
    const initial = () => reduce(null, { type: '@@init' }, ctx);
    const genesisHash = hash('genesis|' + seed);

    const log = [];   // [{ action, hash }]: append-only, hash-chained

    const deriveTo = (n) => { let s = initial(); const k = Math.max(0, Math.min(n, log.length)); for (let i = 0; i < k; i++) s = reduce(s, log[i].action, ctx); return s; };
    const headHash = () => (log.length ? log[log.length - 1].hash : genesisHash);

    const entity = {
      get seed() { return seed; },
      ctx() { return ctx; },
      // z: always derived, never stored
      state() { return deriveTo(log.length); },
      at(n) { return deriveTo(n); },                 // time-travel / audit
      view(fn) { const s = this.state(); return typeof fn === 'function' ? fn(s, ctx) : s; },

      // the only mutation surface: append a validated action
      dispatch(action) {
        const cur = this.state();
        const next = reduce(cur, action, ctx);
        if (eq(next, cur)) return { ok: false, rejected: true, state: cur };   // reducer declined → never logged
        const h = hash(headHash() + '|' + canon(action) + '|' + canon(next));
        log.push({ action, hash: h });
        return { ok: true, state: next };
      },

      log() { return log.map((e, i) => ({ n: i, action: e.action, hash: e.hash })); },
      head() { return headHash(); },                 // Merkle-style root of the whole history

      // re-derive + re-chain from (seed, log); detect any tampering of an action
      verify() {
        let s = initial(), prev = genesisHash;
        for (let i = 0; i < log.length; i++) {
          const next = reduce(s, log[i].action, ctx);
          const h = hash(prev + '|' + canon(log[i].action) + '|' + canon(next));
          if (h !== log[i].hash) return { ok: false, reason: `tamper detected at action ${i}` };
          s = next; prev = h;
        }
        return { ok: true };
      },

      serialize() { return { seed, actions: log.map((e) => e.action), head: headHash() }; },
      fork() { const f = forge({ ...spec, seed }); for (const e of log) f.dispatch(e.action); return f; },
      _replay(actions) { for (const a of (actions || [])) this.dispatch(a); return this; },
    };
    return entity;
  }

  // Reconstruct an entity from a serialized snapshot and the same spec, then
  // (optionally) check it against the snapshot's claimed head.
  function load(snapshot, spec) {
    const e = forge({ ...spec, seed: snapshot.seed })._replay(snapshot.actions);
    e.snapshotValid = !snapshot.head || (e.head() === snapshot.head);   // tamper check vs a trusted head
    return e;
  }

  return { forge, load, hash, version: '0.1.0' };
});
