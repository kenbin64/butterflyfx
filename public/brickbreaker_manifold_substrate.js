/**
 * ═══════════════════════════════════════════════════════════════════
 * 🜂 BRICKBREAKER 3D MANIFOLD SUBSTRATE  v1.1
 *
 * INSTRUMENT METAPHOR
 * ───────────────────
 * The manifold is the PIANO. The surface z = x · y over [0,1]²
 * already holds every note, every tone, every scale, every interval,
 * every sound this game can produce. Nothing is generated: every
 * outcome is *already there*, latent in the surface.
 *
 * A LENS is a MUSICIAN. It cannot produce a tone on its own. It must
 * STRIKE the manifold by *giving* it a coordinate (x, y): a chosen
 * pair of normalised game dimensions. Only then does the manifold
 * answer with the tone z that was always sitting at that point.
 *
 *      give (x, y)  →  [ M A N I F O L D ]  →  receive z
 *      ─────────────                          ─────────
 *      keystroke                              tone
 *
 * Five lenses, five strikes:
 *   GameStateLens  strikes (level_progress × brick_density) → tension
 *   PhysicsLens    strikes (ball_speed     × tension)       → weight
 *   GraphicsLens   strikes (ball_advance   × threat)        → glow
 *   AudioLens      strikes (event_impact   × tension)       → power
 *   ScoreLens      strikes (combo_factor   × brick_value)   → bloom
 *
 * Rule: a lens never *computes* a value. It only *offers* coordinates
 * and *receives* the tone the manifold returns.
 * ═══════════════════════════════════════════════════════════════════
 */
(function () {
  'use strict';

  // ManifoldIngestor is optional: it only RECORDS observations to a
  // global manifold log.  The instrument's geometry is self-sufficient,
  // so when MI is absent we use a silent stub.  This honours the rule
  // that the surface is the ground truth and MI is just a witness.
  const MI = (typeof window !== 'undefined' && window.ManifoldIngestor) || {
    ingest: () => null
  };

  // ── ManifoldBus: lightweight pub/sub ──────────────────────────────
  const _h = new Map();
  const ManifoldBus = {
    emit(name, data) {
      (_h.get(name) || []).forEach(fn => fn(data));
      (_h.get('*') || []).forEach(fn => fn({ name, ...data }));
    },
    on(name, fn) {
      _h.set(name, [...(_h.get(name) || []), fn]);
      return () => _h.set(name, (_h.get(name) || []).filter(f => f !== fn));
    }
  };

  // ── Live game-state cache (updated by each manifold:state-update) ──
  const Cache = {
    level: 1, maxLevel: 10,
    bricksRemaining: 0, totalBricks: 40,
    ballSpeed: 0.25, maxBallSpeed: 1.375,
    playerCount: 1,
    comboCount: 0, maxCombo: 8,
    tension: 0,         // running z from GameStateLens: master scalar
  };
  // ════════════════════════════════════════════════════════════════
  // THE INSTRUMENT: the manifold itself.
  //
  // A piano does not COMPUTE its tones. A tone exists because of
  // the shape, length, tension and material of a string: a static
  // physical property of the instrument's body. Striking a key does
  // not create the tone; it merely OBSERVES the tone that the
  // string's geometry already implies.
  //
  // The manifold here is the same. Its SHAPE is fixed in advance:
  //
  //     SURFACE :  z  =  x · y     over   (x, y) ∈ [0, 1]²
  //
  // Every (x, y) point on that surface already has a z. The whole
  // continuum of tones: every note, every interval, every scale :
  // is *already there*, baked into the geometry. A lens cannot
  // produce a tone, change a tone, or compute a tone. A lens can
  // only OBSERVE one: hand the manifold a coordinate (x, y) and
  // receive back the z that was sitting at that point all along.
  //
  //     observe(x, y)  →  z   (the natural result, never invented)
  // ════════════════════════════════════════════════════════════════
  const clamp01 = v => v < 0 ? 0 : v > 1 ? 1 : v;
  // Clamp to the FULL winki domain [-1, 1].  The single law z = x·y
  // is defined everywhere; restricting to [0,1]² (one quadrant) only
  // shows a quarter of the saddle.  Every aperture that wants the
  // full sRGB cube, the full audible spectrum, or the full sign
  // structure of the four forces must read over [-1, 1]² instead.
  const clamp11 = v => v < -1 ? -1 : v > 1 ? 1 : v;

  // The instrument's body: its fixed shape. Change this and you have
  // built a different piano. Do NOT inline this elsewhere; every tone
  // in the game must come from observing THIS surface.
  const SURFACE = (x, y) => x * y;

  // The surface's local slope is what a piano string's tension is to
  // a key: a fixed geometric property at every point. For z = x·y:
  //     ∂z/∂x = y     ∂z/∂y = x     |∇z| = √(x² + y²)  ∈ [0, √2]
  // The steeper the surface at (x, y), the "tighter" the string, the
  // shorter the wavelength, the higher the natural frequency.
  const GRAD_MAG = (x, y) => Math.sqrt(x * x + y * y);
  const GRAD_MAX = Math.SQRT2;                 // |∇z| at (1,1)

  // Audible band the instrument speaks in: four octaves above A2.
  // The body of the instrument decides this once and for all; lenses
  // never get to choose a frequency, only a coordinate.
  const FREQ_LO = 110;                          // A2  (Hz)
  const FREQ_OCTAVES = 4;                       // → A6 at the rim
  const SOUND_C = 343;                          // m/s, for wavelength

  // The instrument is fretted to A-minor pentatonic so successive
  // observations come out musical instead of microtonal.
  // Semitone offsets from A: A(0) C(3) D(5) E(7) G(10), per octave.
  const SCALE_STEPS = [0, 3, 5, 7, 10];
  const SCALE = [];
  for (let oct = 0; oct < FREQ_OCTAVES; oct++) {
    for (const s of SCALE_STEPS) {
      SCALE.push(FREQ_LO * Math.pow(2, oct + s / 12));
    }
  }

  // ── Visible-light band, in nanometres. The same surface that
  //    produces audible wavelengths also produces optical ones :
  //    they're just different windows onto the geometry.
  const LIGHT_LO_NM = 380;     // violet edge
  const LIGHT_HI_NM = 740;     // red edge
  const LIGHT_C = 299_792_458; // m/s

  // ── Printable ASCII window. Pinging (x,y) and asking "what character
  //    lives here?" lands somewhere in this contiguous range.
  const ASCII_LO = 32;   // space
  const ASCII_HI = 126;  // tilde

  // ── Compass for vector readouts (paddle, ball, flight, brick rows).
  //    The angle comes from the surface gradient direction at (x,y);
  //    nothing here picks a heading: the slope already has one.
  const TAU = Math.PI * 2;

  // ── Card deck used by the .card() interpretation. 52 fixed values
  //    arranged S/H/D/C × A..K. The deck is a property of the body,
  //    not of the dealer.
  const CARD_SUITS = ['♠', '♥', '♦', '♣'];
  const CARD_RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

  // ── Symbolic gates / decisions / rules: readouts of the surface's
  //    sign and inflection structure. For z = x·y on [0,1]² the gradient
  //    is (y, x); its components and their balance carry the logic.
  const GATES = ['LO', 'AND', 'OR', 'XOR', 'NAND', 'NOR', 'XNOR', 'HI'];
  const RULES = [
    'spawn', 'launch', 'reflect', 'split', 'absorb',
    'multiply', 'detonate', 'transmute', 'lock', 'release'
  ];
  // Which input device "fires" for a given coordinate: pure geometry,
  // not a remap table. Useful for unifying mouse/touch/controller.
  const INPUT_CHANNELS = ['mouse', 'touch', 'keyboard', 'gamepad'];
  const INPUT_BUTTONS = ['primary', 'secondary', 'tertiary', 'aux'];

  const Manifold = {
    /** The instrument's geometric law, exposed read-only. */
    surface: SURFACE,

    /** Local slope of the surface at (x,y): its "string tension". */
    slopeAt(x, y) { return GRAD_MAG(clamp01(x), clamp01(y)); },

    /**
     * Translate the surface's local geometry into a wavelength.
     * The wavelength is NOT computed from intent; it is read off the
     * shape: the same way a string's wavelength is dictated by its
     * length and tension, not by the player.
     *
     * Returns { frequency (Hz), wavelength (m), scaleIndex }
     */
    toneAt(x, y) {
      const slope = GRAD_MAG(clamp01(x), clamp01(y));
      const t = slope / GRAD_MAX;                      // ∈ [0,1]
      const idx = Math.min(SCALE.length - 1,
        Math.max(0, Math.round(t * (SCALE.length - 1))));
      const frequency = SCALE[idx];
      const wavelength = SOUND_C / frequency;          // metres
      return { frequency, wavelength, scaleIndex: idx, slope };
    },

    // ════════════════════════════════════════════════════════════
    // INTERPRETATIONS: many windows, one surface.
    //
    // None of these *generate* a value. Each one only reads the
    // surface's existing geometry through a different aperture:
    //
    //   sound, light, color, ascii, pixel, gate, decision, vector,
    //   card, rule, input
    //
    // A coordinate (x,y) is to the manifold what a struck key is to
    // a piano: every channel just reports what was already there.
    // ════════════════════════════════════════════════════════════
    interpret: {
      /** Audible wavelength: same as Manifold.toneAt(). */
      sound(x, y) { return Manifold.toneAt(x, y); },

      /** Visible-light wavelength (nm) and frequency (Hz). The optical
       *  twin of .sound: same geometry, different band. */
      light(x, y) {
        const slope = GRAD_MAG(clamp01(x), clamp01(y));
        const t = slope / GRAD_MAX;
        const wavelengthNm = LIGHT_HI_NM - t * (LIGHT_HI_NM - LIGHT_LO_NM);
        const frequency = LIGHT_C / (wavelengthNm * 1e-9);
        return { wavelengthNm, frequency };
      },

      /** Render the light-wavelength reading as an sRGB triplet + hex.
       *  Pixel rendering is just .light viewed through a CRT. */
      color(x, y) {
        const { wavelengthNm } = Manifold.interpret.light(x, y);
        const [r, g, b] = wavelengthToRGB(wavelengthNm);
        const hex = '#' + [r, g, b].map(v =>
          v.toString(16).padStart(2, '0')).join('');
        return { r, g, b, hex, wavelengthNm };
      },

      /** Same hue as .color, but with an HONEST brightness axis.
       *  Lightness = z (surface height) by default: the dim corner of
       *  the surface is genuinely dim, the peak corner is bright.
       *  Pass an explicit `lightness ∈ [0,1]` to override.
       *  This is what makes dark backgrounds, deep floors, and muted
       *  UI chrome readable straight off the manifold without picking
       *  a separate palette. */
      shade(x, y, lightness) {
        const cx = clamp01(x), cy = clamp01(y);
        const base = Manifold.interpret.color(cx, cy);
        const L = (lightness === undefined) ? SURFACE(cx, cy) : clamp01(lightness);
        const r = Math.round(base.r * L);
        const g = Math.round(base.g * L);
        const b = Math.round(base.b * L);
        const hex = '#' + [r, g, b].map(v =>
          v.toString(16).padStart(2, '0')).join('');
        return { r, g, b, hex, lightness: L, wavelengthNm: base.wavelengthNm };
      },

      /** Full HSL readout: hue from slope, lightness from z, saturation
       *  from the bloom (x/y folded to [0,1]).  Useful when a consumer
       *  wants Three.js / CSS HSL rather than RGB. */
      tone(x, y) {
        const cx = clamp01(x), cy = clamp01(y);
        const slope = GRAD_MAG(cx, cy) / GRAD_MAX;        // ∈ [0,1]
        // hue: short λ (high slope) = blue/violet, long λ (low slope) = red
        // map slope→hue so the optical and HSL apertures agree directionally
        const hue = (1 - slope);                          // 0=red ... 1=violet
        const lightness = SURFACE(cx, cy);                // z
        const bloom = cy === 0 ? 1 : cx / cy;
        const saturation = bloom > 1 ? 1 / bloom : bloom; // ∈ (0,1]
        return { hue, saturation, lightness };
      },

      /** Hue alone: a single number in [0,1] (turns of the colour
       *  wheel) read from the surface's slope direction.  Wraps so
       *  consecutive observations sweep the wheel continuously. */
      hue(x, y) {
        const cx = clamp01(x), cy = clamp01(y);
        // Use the gradient's *angle*, not its magnitude: that's the
        // direction the surface points uphill, which is the natural
        // hue axis (every direction is a different colour).
        // ∇z = (y, x); angle ∈ (-π, π].
        const angle = Math.atan2(cx, cy);                 // x is ∂z/∂y, y is ∂z/∂x
        const turns = (angle / (Math.PI * 2) + 1) % 1;    // ∈ [0,1)
        return { hue: turns, degrees: turns * 360 };
      },

      /** Saturation: how "pure" the colour is, read from the bloom
       *  (x/y).  At the diagonal x ≈ y the bloom is 1 and saturation
       *  is full; far from the diagonal it falls toward 0 (greyer). */
      saturation(x, y) {
        const cx = clamp01(x), cy = clamp01(y);
        const bloom = cy < 1e-9 ? 1 : cx / cy;
        const sat = bloom > 1 ? 1 / bloom : bloom;        // fold to (0,1]
        return { saturation: sat, bloom };
      },

      /** Alpha (opacity): read from z.  The peak of the surface is
       *  fully opaque, the dim corner is transparent.  Same shape as
       *  .shade's lightness, but expressed as α for compositing.
       *  Returns the channel as 0..1 and a uint8 0..255. */
      alpha(x, y) {
        const a = SURFACE(clamp01(x), clamp01(y));        // ∈ [0,1]
        return { alpha: a, byte: Math.round(a * 255) };
      },

      /** Gradient field: slope magnitude AND direction at (x,y).
       *  This is the optical/aesthetic twin of .vector: same numbers,
       *  but framed as a colour gradient (∂R/∂x, ∂G/∂x, ∂B/∂x …) so
       *  shaders / CSS gradients can consume it directly.
       *  Returns the two endpoints of a gradient stop drawn ALONG the
       *  surface's uphill direction from (x,y). */
      gradient(x, y) {
        const cx = clamp01(x), cy = clamp01(y);
        const dx = cy, dy = cx;                           // ∇z = (y, x)
        const mag = GRAD_MAG(cx, cy);
        const ux = mag > 0 ? dx / mag : 0;
        const uy = mag > 0 ? dy / mag : 0;
        const angle = Math.atan2(dy, dx);
        // sample the colour at the foot and at the head of the gradient
        const step = 0.15;                                // unit-square step
        const fx = clamp01(cx - ux * step), fy = clamp01(cy - uy * step);
        const hx = clamp01(cx + ux * step), hy = clamp01(cy + uy * step);
        const from = Manifold.interpret.color(fx, fy);
        const to = Manifold.interpret.color(hx, hy);
        return {
          from: from.hex, to: to.hex,
          angle, magnitude: mag,
          css: `linear-gradient(${(angle * 180 / Math.PI + 90).toFixed(1)}deg, ${from.hex}, ${to.hex})`
        };
      },

      /** Colour balance: how much of each primary the surface emits at
       *  (x,y), normalised so the three channels sum to 1.  Useful for
       *  white-balance, tinting, mixing.  rNorm + gNorm + bNorm = 1.
       *  Also returns the temperature axis: warmth = R−B in [-1,1]. */
      balance(x, y) {
        const c = Manifold.interpret.color(x, y);
        const sum = c.r + c.g + c.b;
        const r = sum > 0 ? c.r / sum : 1 / 3;
        const g = sum > 0 ? c.g / sum : 1 / 3;
        const b = sum > 0 ? c.b / sum : 1 / 3;
        const warmth = (c.r - c.b) / 255;                 // ∈ [-1,1]
        return { r, g, b, warmth, hex: c.hex };
      },

      /** Gamma: the surface's local non-linearity.  Read from the
       *  ratio of slope to surface height: γ = log(z) / log(slope01),
       *  i.e. how steeply the manifold curves at this point relative
       *  to its altitude.  Useful for tone-mapping, perceptual ramps,
       *  and exposure-style corrections.
       *  Falls back to γ = 1 (linear) where the math degenerates. */
      gamma(x, y) {
        const cx = clamp01(x), cy = clamp01(y);
        const z = SURFACE(cx, cy);
        const slopeN = GRAD_MAG(cx, cy) / GRAD_MAX;       // ∈ [0,1]
        let gamma = 1;
        if (z > 1e-6 && slopeN > 1e-6 && slopeN < 1) {
          gamma = Math.log(z) / Math.log(slopeN);
        }
        // clamp to a sane perceptual band (0.2..5)
        gamma = Math.max(0.2, Math.min(5, gamma));
        return { gamma, z, slope: slopeN };
      },

      /** ════════════════════════════════════════════════════════════
       *  COLOUR ALONG THE FIBONACCI LADDER
       *
       *  The same seven-step staircase that builds the dimensions of
       *  space also builds the dimensions of colour.  Every aperture
       *  above is a step on this ladder: colour isn't a single thing,
       *  it's a progressive embodiment built one Fibonacci value at a
       *  time, exactly like a dimension.
       *
       *    F=1   point        →  hue          (a single mark on the wheel)
       *    F=1   length       →  saturation   (one line: grey → pure)
       *    F=2   width        →  shade        (lightness adds an axis)
       *    F=3   plane        →  color        (full sRGB plane / wavelength)
       *    F=5   volume       →  tone         (full HSL volume)
       *    F=8   embodiment   →  gradient     (colour with direction & extent: a thing)
       *    F=13  rest         →  alpha        (composited; α=0 is rest/void)
       *
       *  Each step is the *sum* of all the steps before it: the same
       *  rule the Fibonacci numbers obey, the same rule the dimensions
       *  of space obey.  This is the user's insight made literal in
       *  code: "I see Fibonacci dimensions in colour too, for all the
       *  parts."
       *  ════════════════════════════════════════════════════════════ */
      colorLadder(x, y) {
        const I = Manifold.interpret;
        return {
          point: { fib: 1, reading: I.hue(x, y) },
          length: { fib: 1, reading: I.saturation(x, y) },
          width: { fib: 2, reading: I.shade(x, y) },
          plane: { fib: 3, reading: I.color(x, y) },
          volume: { fib: 5, reading: I.tone(x, y) },
          embodiment: { fib: 8, reading: I.gradient(x, y) },
          rest: { fib: 13, reading: I.alpha(x, y) }
        };
      },

      /** ════════════════════════════════════════════════════════════
       *  SOUND ALONG THE FIBONACCI LADDER
       *
       *  The diatonic octave is the same staircase as the dimensional
       *  ladder.  Seven steps fill an octave (C D E F G A B); the
       *  eighth note is C again: one octave up.  That's the same
       *  collapse-to-1 the Fibonacci climber performs at k=6: seven
       *  rungs, then a quiet return to the start of the next dimension.
       *
       *    F=1   point        →  pitch       (a single frequency)
       *    F=1   length       →  duration    (period / wavelength of one cycle)
       *    F=2   width        →  interval    (two pitches: a dyad)
       *    F=3   plane        →  chord       (three pitches: a triad fills a plane)
       *    F=5   volume       →  scale       (a key: every degree of the scale)
       *    F=8   embodiment   →  melody      (a phrase: pitches with direction in time)
       *    F=13  rest         →  octave      (silence between notes; the 8th = the 1st up high)
       *
       *  The scale used is C major (semitones 0 2 4 5 7 9 11) so the
       *  collapse is unambiguous: the eighth degree is exactly one
       *  octave above the first, the way k=6 → k=7 collapses Fibonacci
       *  back to 1 in the next dimension.
       *  ════════════════════════════════════════════════════════════ */
      pitch(x, y) {
        // A single tone: the foundation step. Same as .sound, named
        // for the ladder.
        const t = Manifold.toneAt(x, y);
        return { frequency: t.frequency, scaleIndex: t.scaleIndex };
      },

      duration(x, y) {
        // Length of one cycle of the chosen pitch: the literal
        // "length" dimension of sound. Seconds per cycle.
        const t = Manifold.toneAt(x, y);
        return { seconds: 1 / t.frequency, wavelengthMetres: t.wavelength };
      },

      interval(x, y) {
        // Two pitches (a dyad): the "width" of sound.  The second
        // pitch is found by stepping along the surface gradient by a
        // diatonic-scale-degree's worth, so the interval comes from the
        // geometry, not from a chosen ratio.
        const cx = clamp01(x), cy = clamp01(y);
        const a = Manifold.toneAt(cx, cy);
        // step distance in unit-square: one seventh (one diatonic step)
        const step = 1 / 7;
        const dx = cy / GRAD_MAX, dy = cx / GRAD_MAX;          // ∇z direction
        const b = Manifold.toneAt(clamp01(cx + dx * step), clamp01(cy + dy * step));
        const semitones = Math.round(12 * Math.log2(b.frequency / a.frequency));
        return { lower: a.frequency, upper: b.frequency, semitones };
      },

      chord(x, y) {
        // Three pitches (a triad): the "plane" of sound.  Sample the
        // surface at the point and at two more steps along the gradient.
        const cx = clamp01(x), cy = clamp01(y);
        const step = 1 / 7;
        const dx = cy / GRAD_MAX, dy = cx / GRAD_MAX;
        const root = Manifold.toneAt(cx, cy);
        const third = Manifold.toneAt(clamp01(cx + dx * step), clamp01(cy + dy * step));
        const fifth = Manifold.toneAt(clamp01(cx + dx * step * 2), clamp01(cy + dy * step * 2));
        return {
          frequencies: [root.frequency, third.frequency, fifth.frequency],
          scaleIndices: [root.scaleIndex, third.scaleIndex, fifth.scaleIndex]
        };
      },

      scale(x, y) {
        // The full diatonic scale (seven tones) anchored at the pitch
        // read from (x,y).  This is the "volume" of sound: every
        // degree available, before any one is chosen.
        // C-major intervals from the root, in semitones.
        const DEGREES = [0, 2, 4, 5, 7, 9, 11];
        const root = Manifold.toneAt(clamp01(x), clamp01(y)).frequency;
        const degrees = DEGREES.map(s => root * Math.pow(2, s / 12));
        return { root, degrees, intervals: DEGREES };
      },

      melody(x, y) {
        // A phrase: seven pitches walked along the surface gradient
        // from (x,y).  This is the "embodiment" step: a thing in time
        // with direction, not just a set of available pitches.
        const cx = clamp01(x), cy = clamp01(y);
        const dx = cy / GRAD_MAX, dy = cx / GRAD_MAX;
        const step = 1 / 7;
        const phrase = [];
        for (let i = 0; i < 7; i++) {
          const px = clamp01(cx + dx * step * i);
          const py = clamp01(cy + dy * step * i);
          phrase.push(Manifold.toneAt(px, py).frequency);
        }
        return { phrase, length: 7 };
      },

      octave(x, y) {
        // The eighth step: silence, then the first pitch one octave
        // higher.  This is "rest": the seventh rung collapses and the
        // ladder begins again in the next dimension.  Mirrors the
        // Fibonacci climber's collapse-to-1 at k=6.
        const t = Manifold.toneAt(clamp01(x), clamp01(y));
        return {
          rest: 0,                          // the silence between octaves
          nextRoot: t.frequency * 2,        // the 8th note = the 1st, octave up
          collapsedFrom: t.frequency
        };
      },

      soundLadder(x, y) {
        const I = Manifold.interpret;
        return {
          point: { fib: 1, reading: I.pitch(x, y) },
          length: { fib: 1, reading: I.duration(x, y) },
          width: { fib: 2, reading: I.interval(x, y) },
          plane: { fib: 3, reading: I.chord(x, y) },
          volume: { fib: 5, reading: I.scale(x, y) },
          embodiment: { fib: 8, reading: I.melody(x, y) },
          rest: { fib: 13, reading: I.octave(x, y) }
        };
      },

      /** ════════════════════════════════════════════════════════════
       *  THE FOUR FORCES: arithmetic on (x, y)
       *
       *  Every force in the manifold is an arithmetic operation on the
       *  same two inputs.  The surface z = x·y already IS the strong
       *  force; the other three forces are the other three operations
       *  performed on the same coordinate.
       *
       *    STRONG          z = x · y           multiplication (binding)
       *    STRONG·residual r = z − ⌊z·N⌋/N     entropy / leftover
       *    ELECTRO-MAG     e = x / y           division (ratio, polarity)
       *    WEAK +          w⁺= x + y           addition (combination)
       *    WEAK −          w⁻= x − y           subtraction (decay, asymmetry)
       *
       *  The strong pair (×, ÷) and the weak pair (+, −) exhaust the
       *  four field operations of a real algebra; the residual is the
       *  surface's own roughness: what's left over when you quantise
       *  z to a finite resolution.  That leftover IS entropy.
       *  ════════════════════════════════════════════════════════════ */
      forces(x, y) {
        const cx = clamp01(x), cy = clamp01(y);
        const strong = SURFACE(cx, cy);                      // x · y
        const QUANTA = 256;                                  // resolution
        const residual = strong - Math.floor(strong * QUANTA) / QUANTA;
        const electromagnetic = cy < 1e-9 ? Infinity : cx / cy;
        const weakPlus = cx + cy;
        const weakMinus = cx - cy;
        return {
          strong,                  // ×: binds x and y into z
          residual,                // entropy left after quantising z
          electromagnetic,         // ÷: ratio / polarity
          weakPlus,                // +: combination
          weakMinus                // −: decay / asymmetry
        };
      },

      /** ════════════════════════════════════════════════════════════
       *  RGB: the four forces, painted.
       *
       *  The pure-wavelength aperture (`color`, `shade`) can only
       *  produce SPECTRAL colours: every hue you can split out of
       *  white light with a prism.  But the world is full of
       *  non-spectral colours: pinks, magentas, warm browns, the
       *  amber of an old bar lamp.  None of those are a single
       *  wavelength; they're sums of wavelengths.
       *
       *  The manifold already knows how to sum: that's what the four
       *  forces ARE.  So paint each RGB channel with one force:
       *
       *      R  =  weakPlus / 2     (x + y, normalised)   warmth
       *      G  =  strong           (x · y)                binding
       *      B  =  |weakMinus|      (|x − y|)              polarity
       *
       *  Together those three forces span the full unit RGB cube :
       *  every colour the screen can display, including all the
       *  non-spectral ones the optical aperture can't reach.  Colour
       *  becomes a literal painting of the forces at (x, y).
       *  An optional `lightness ∈ [0,1]` multiplies all three (defaults
       *  to z, the surface height, so dim corners stay dim). */
      rgb(x, y, lightness) {
        const cx = clamp01(x), cy = clamp01(y);
        const strong = cx * cy;
        const wPlus = (cx + cy) / 2;
        const wMinus = Math.abs(cx - cy);
        const L = (lightness == null) ? SURFACE(cx, cy) : clamp01(lightness);
        const r = Math.max(0, Math.min(255, Math.round(wPlus * 255 * L * 2)));
        const g = Math.max(0, Math.min(255, Math.round(strong * 255 * L * 2)));
        const b = Math.max(0, Math.min(255, Math.round(wMinus * 255 * L * 2)));
        const hex = '#' + [r, g, b].map(v =>
          v.toString(16).padStart(2, '0')).join('');
        return { r, g, b, hex, lightness: L };
      },

      /** ════════════════════════════════════════════════════════════
       *  WINKI: the WHOLE saddle.  The single law z = x·y, but read
       *  over the FULL domain [-1, 1]² instead of just the [0,1]²
       *  corner.  This gives all four quadrants of the hyperbolic
       *  paraboloid:
       *
       *      Q1 (+,+):  z > 0   peak  NE      "warm bright"
       *      Q2 (-,+):  z < 0   valley NW     "cool bright" (cyan)
       *      Q3 (-,-):  z > 0   peak  SW      "warm dark"
       *      Q4 (+,-):  z < 0   valley SE     "cool dark" (blue)
       *
       *  The cross at the origin (z=0 along both axes) is the
       *  achromatic axis: pure greys, blacks, whites.  The two peaks
       *  saturate one diagonal of the colour cube; the two valleys
       *  saturate the other.  Together they reach EVERY non-spectral
       *  colour the screen can display, because the sign structure of
       *  the four forces now spans both signs of every channel.
       *
       *  Pass coords in [-1, 1]; pass them in [0, 1] to get the legacy
       *  Q1-only reading.  Optional lightness multiplies the result. */
      winkiRGB(x, y, lightness) {
        const cx = clamp11(x), cy = clamp11(y);
        const z = cx * cy;                       // ∈ [-1, 1]
        const strong = z;                         //   sign carries quadrant
        const wPlus = (cx + cy) / 2;             // ∈ [-1, 1]
        const wMinus = (cx - cy) / 2;             // ∈ [-1, 1]
        // Map each force to a channel using sign as a 0.5 pivot:
        //   +1 → 1.0   0 → 0.5   -1 → 0.0
        // This puts pure grey at the origin and lets the full RGB
        // cube fall out of the four quadrants.
        const toCh = v => (v + 1) / 2;            // [-1,1] → [0,1]
        // Default lightness: distance from the achromatic origin :
        // brighter farther out, dim near the cross.
        const radius = Math.min(1, Math.sqrt(cx * cx + cy * cy) / Math.SQRT2);
        const L = (lightness == null) ? radius : clamp01(lightness);
        // Lightness multiplies: L=0 collapses to enveloping black,
        // L=1 gives full chroma.  This lets the origin (mid-grey) be
        // dimmed all the way to true black for backgrounds, while the
        // saturated corners stay vivid at L=1.
        const r = Math.round(toCh(wPlus) * 255 * L);
        const g = Math.round(toCh(strong) * 255 * L);
        const b = Math.round(toCh(wMinus) * 255 * L);
        const rr = Math.max(0, Math.min(255, r));
        const gg = Math.max(0, Math.min(255, g));
        const bb = Math.max(0, Math.min(255, b));
        const hex = '#' + [rr, gg, bb].map(v =>
          v.toString(16).padStart(2, '0')).join('');
        const quadrant = (cx >= 0 && cy >= 0) ? 1
          : (cx < 0 && cy >= 0) ? 2
            : (cx < 0 && cy < 0) ? 3 : 4;
        return { r: rr, g: gg, b: bb, hex, z, quadrant, lightness: L };
      },

      /** ════════════════════════════════════════════════════════════
       *  TIME: the identity, x recurring.
       *
       *  Time isn't a separate dimension; it's x feeding itself back.
       *  The identity function f(x) = x, iterated, IS the clock:
       *
       *      t₀ = x,  t₁ = x,  t₂ = x,  …
       *
       *  Each tick is the same x: that's what makes it a tick.  The
       *  *count* of ticks is what we call duration; the *coordinate*
       *  itself never changes.  Recurrence is the whole content of t.
       *
       *  This aperture returns:
       *    - now:        the current instant (just x, the identity)
       *    - tick:       the unit of recurrence: 1 / x, periods per unit
       *    - phase:      where we are inside one recurrence (frac of x·t)
       *    - recurrence: a short window of the identity recurring,
       *                  so callers can see that "x repeating" is all
       *                  there is.
       *  ════════════════════════════════════════════════════════════ */
      time(x, y) {
        const cx = clamp01(x);
        const now = cx;                            // identity: t = x
        const tick = cx > 1e-9 ? 1 / cx : Infinity;
        // a 7-step window of x recurring (the same x, seven times) :
        // this IS time, expressed without invoking a separate axis.
        const recurrence = [cx, cx, cx, cx, cx, cx, cx];
        // phase inside one tick at the surface's local rate
        const rate = SURFACE(cx, clamp01(y));
        const phase = (rate - Math.floor(rate)) || 0;
        return { now, tick, phase, recurrence };
      },

      /** Printable ASCII character whose code-point lives at (x,y). */
      ascii(x, y) {
        const z = SURFACE(clamp01(x), clamp01(y));     // amplitude ∈ [0,1]
        const code = ASCII_LO + Math.round(z * (ASCII_HI - ASCII_LO));
        return { code, char: String.fromCharCode(code) };
      },

      /** A rendered pixel: position-as-color (same as .color), plus
       *  the screen coordinate (x,y) it occupies on a normalised canvas. */
      pixel(x, y) {
        const cx = clamp01(x), cy = clamp01(y);
        return { x: cx, y: cy, ...Manifold.interpret.color(cx, cy) };
      },

      /** Logic-gate readout from the surface's sign/inflection structure.
       *  For z = x·y the partial derivatives (y, x) decide the bin. */
      gate(x, y) {
        const cx = clamp01(x), cy = clamp01(y);
        const t = (cx + cy) * 0.5;                     // joint inflection
        const idx = Math.min(GATES.length - 1, Math.floor(t * GATES.length));
        return { name: GATES[idx], dx: cy, dy: cx };   // ∂z/∂x=y, ∂z/∂y=x
      },

      /** Boolean decision branch: useful as a deterministic root for
       *  decision trees driven by the manifold. */
      decision(x, y) {
        const z = SURFACE(clamp01(x), clamp01(y));
        const branch = z >= 0.5 ? 'high' : 'low';
        return { branch, confidence: Math.abs(z - 0.5) * 2 };
      },

      /** 2-D vector read off the surface's gradient at (x,y). The
       *  direction comes from the geometry, NOT from the caller :
       *  use this for ball, paddle, flight, brick-row, hole headings. */
      vector(x, y) {
        const cx = clamp01(x), cy = clamp01(y);
        const dx = cy;                                 // ∂z/∂x
        const dy = cx;                                 // ∂z/∂y
        const mag = GRAD_MAG(cx, cy);
        const angle = Math.atan2(dy, dx);              // ∈ (-π, π]
        const ux = mag > 0 ? dx / mag : 0;
        const uy = mag > 0 ? dy / mag : 0;
        return { x: ux, y: uy, dx, dy, magnitude: mag, angle };
      },

      /** Playing-card readout: suit and rank already at (x,y). */
      card(x, y) {
        const cx = clamp01(x), cy = clamp01(y);
        const suit = CARD_SUITS[Math.min(CARD_SUITS.length - 1,
          Math.floor(cx * CARD_SUITS.length))];
        const rank = CARD_RANKS[Math.min(CARD_RANKS.length - 1,
          Math.floor(cy * CARD_RANKS.length))];
        const value = CARD_RANKS.indexOf(rank) + 1;
        return { suit, rank, value, label: rank + suit };
      },

      /** Symbolic game rule that fires at (x,y). Rule selection is a
       *  property of the surface: designers don't pick rules, they
       *  shape the manifold and rules emerge at coordinates. */
      rule(x, y) {
        const z = SURFACE(clamp01(x), clamp01(y));
        const idx = Math.min(RULES.length - 1, Math.floor(z * RULES.length));
        return { name: RULES[idx] };
      },

      /** Input-device + button readout: unifies mouse / touch /
       *  keyboard / controller commands as one query against the body. */
      input(x, y) {
        const cx = clamp01(x), cy = clamp01(y);
        const ch = INPUT_CHANNELS[Math.min(INPUT_CHANNELS.length - 1,
          Math.floor(cx * INPUT_CHANNELS.length))];
        const btn = INPUT_BUTTONS[Math.min(INPUT_BUTTONS.length - 1,
          Math.floor(cy * INPUT_BUTTONS.length))];
        return { channel: ch, button: btn };
      }
    },

    /**
     * Observe the manifold at coordinate (x, y) and receive the tone
     * that the surface's shape already holds at that point.
     *
     * The lens GIVES (x, y): the instrument GIVES BACK:
     *   z          : the surface height at the point (the "amplitude")
     *   slope      : |∇z| there (the local string tension)
     *   wavelength : metres, derived from the geometry alone
     *   frequency  : Hz, the audible interpretation of the wavelength
     *
     * Pass `meta.channels = ['light','color','vector', ...]` to bundle
     * extra interpretations of the same point into the result.
     *
     * No tone is computed in any meaningful sense; the surface is
     * queried, exactly as a struck string is queried by the air
     * around it.
     *
     * `strike` and `observe` are the same operation under two names:
     * the actuator's view (strike) and the listener's view (observe).
     */
    observe(x, y, label, meta) {
      const cx = clamp01(x);
      const cy = clamp01(y);
      const z = SURFACE(cx, cy);                      // pre-existing height
      const tone = Manifold.toneAt(cx, cy);           // pre-existing wavelength
      // Optional extra channels: same point, more apertures.
      const channels = (meta && meta.channels) || null;
      const readings = {};
      if (channels) {
        for (const name of channels) {
          const fn = Manifold.interpret[name];
          if (fn) readings[name] = fn(cx, cy);
        }
      }
      // Record the observation on the global manifold so the rest of
      // the system can witness it too. Ingestor must NOT recompute z
      // from its own mapping: we pass the observed value through.
      MI.ingest(
        { _x: cx, _y: cy, _z: z },
        { x: '_x', y: '_y', z: '_z', label, meta: { ...meta, tone, readings } }
      );
      return {
        x: cx, y: cy, z,
        slope: tone.slope,
        wavelength: tone.wavelength,
        frequency: tone.frequency,
        scaleIndex: tone.scaleIndex,
        readings,
        label, meta
      };
    },

    /** Alias: same operation, named for the actuator side. */
    strike(x, y, label, meta) { return Manifold.observe(x, y, label, meta); }
  };

  // ── wavelength→sRGB helper (CIE-style piecewise approximation).
  //    Internal to the instrument's optics; lenses never call it.
  function wavelengthToRGB(nm) {
    let r = 0, g = 0, b = 0;
    if (nm >= 380 && nm < 440) { r = -(nm - 440) / 60; b = 1; }
    else if (nm < 490) { g = (nm - 440) / 50; b = 1; }
    else if (nm < 510) { g = 1; b = -(nm - 510) / 20; }
    else if (nm < 580) { r = (nm - 510) / 70; g = 1; }
    else if (nm < 645) { r = 1; g = -(nm - 645) / 65; }
    else if (nm <= 740) { r = 1; }
    // Fade at the visible edges
    let f = 1;
    if (nm < 420) f = 0.3 + 0.7 * (nm - 380) / 40;
    else if (nm > 700) f = 0.3 + 0.7 * (740 - nm) / 40;
    const conv = c => Math.round(255 * Math.pow(Math.max(0, c) * f, 0.8));
    return [conv(r), conv(g), conv(b)];
  }
  // ════════════════════════════════════════════════════════════════
  // LENS 1: GameStateLens
  // Strikes the manifold at (level_progress, brick_density).
  // The tone returned is the arena's tension: a note already living
  // on the surface; the lens only points at it.
  // ════════════════════════════════════════════════════════════════
  const GameStateLens = {
    strike(cache) {
      const x = cache.level / Math.max(1, cache.maxLevel);
      const destroyed = cache.totalBricks - cache.bricksRemaining;
      const y = destroyed / Math.max(1, cache.totalBricks);
      return Manifold.strike(x, y, 'arena-tension', { lens: 'GameStateLens' });
    },
    // Back-compat shim for any caller still using .focus()
    focus(cache) {
      const t = GameStateLens.strike(cache);
      return { manifold: { z: t.z }, ...t };
    }
  };

  // ════════════════════════════════════════════════════════════════
  // LENS 2: PhysicsLens: ball_speed × tension → velocity_weight
  // Controls dynamic speed modulation: ball feels "heavier" in
  // high-tension arenas without changing the base trajectory.
  // ════════════════════════════════════════════════════════════════
  const PhysicsLens = {
    strike(ballData, tension) {
      const x = (ballData.speed || 0) / Cache.maxBallSpeed;
      const y = 0.2 + tension * 0.8;   // floor weight at low tension
      const tone = Manifold.strike(x, y, 'velocity-weight', {
        lens: 'PhysicsLens', ballId: ballData.id
      });
      window.dispatchEvent(new CustomEvent('manifold:physics', {
        detail: { ballId: ballData.id, velocityWeight: tone.z }
      }));
      return tone.z;
    },
    focus(ballData, tension) { return PhysicsLens.strike(ballData, tension); }
  };

  // ════════════════════════════════════════════════════════════════
  // LENS 3: GraphicsLens: ball_advance × threat → glow_intensity
  // "Advance" = normalised y-position of ball (0 = paddle, 1 = ceiling)
  // "Threat"  = fraction of bricks remaining in top two rows
  // ════════════════════════════════════════════════════════════════
  const GraphicsLens = {
    ARENA_HEIGHT: 50,   // matches manifold.game.json params.arena_height
    strike(ballData) {
      const x = (ballData.posY || 0) / GraphicsLens.ARENA_HEIGHT;
      const threat = (ballData.threatCount || 0) / 8;
      const y = 0.15 + threat * 0.85;  // floor glow at zero threat
      const tone = Manifold.strike(x, y, 'glow-intensity', {
        lens: 'GraphicsLens', ballId: ballData.id
      });
      window.dispatchEvent(new CustomEvent('manifold:glow', {
        detail: { ballId: ballData.id, intensity: tone.z }
      }));
      return tone.z;
    },
    focus(ballData) { return GraphicsLens.strike(ballData); }
  };

  // ════════════════════════════════════════════════════════════════
  // LENS 4: AudioLens: event_impact × tension → sound_power
  // impact weights map game events to emotional magnitude [0,1]
  // ════════════════════════════════════════════════════════════════
  const AUDIO_WEIGHTS = {
    paddle_hit: 0.3, wall_hit: 0.15, brick_hit: 0.5,
    brick_destroy: 0.7, ball_lost: 0.9, level_clear: 1.0,
    powerup: 0.6, game_over: 1.0, launch: 0.25, combo: 0.8
  };
  const AudioLens = {
    strike(eventType, tension) {
      const x = AUDIO_WEIGHTS[eventType] || 0.1;
      const y = tension;
      const tone = Manifold.strike(x, y, 'sound-power', {
        lens: 'AudioLens', event: eventType
      });

      // Voice the manifold's natural wavelength as an audible pluck.
      // The frequency is NOT chosen here: it was read off the surface
      // by Manifold.observe. AudioLens only opens the listening port.
      const MA = window.ManifoldAudio;
      if (MA?.ctx && MA?.masterGain) {
        const ctx = MA.ctx;
        const now = ctx.currentTime;
        const osc = ctx.createOscillator();
        const env = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(tone.frequency, now);
        const peak = 0.05 + tone.z * 0.35;            // z = loudness envelope
        env.gain.setValueAtTime(0, now);
        env.gain.linearRampToValueAtTime(peak, now + 0.005);
        env.gain.exponentialRampToValueAtTime(0.0001, now + 0.25 + tone.z * 0.4);
        osc.connect(env).connect(MA.masterGain);
        osc.start(now);
        osc.stop(now + 0.7);

        // Also drift master gain with overall sound power, as before.
        const vol = 0.15 + tone.z * 0.75;
        MA.masterGain.gain.linearRampToValueAtTime(vol, now + 0.06);
      }

      window.dispatchEvent(new CustomEvent('manifold:audio', {
        detail: {
          event: eventType,
          power: tone.z,
          frequency: tone.frequency,
          wavelength: tone.wavelength,
          scaleIndex: tone.scaleIndex
        }
      }));

      return tone.z;
    },
    focus(eventType, tension) { return AudioLens.strike(eventType, tension); }
  };

  // ════════════════════════════════════════════════════════════════
  // LENS 5: ScoreLens: combo_factor × brick_value → score_bloom
  // z blooms the raw score multiplicatively; score = base * z
  // ════════════════════════════════════════════════════════════════
  const BRICK_VALUES = { red: 1.0, orange: 0.75, yellow: 0.5, green: 0.25 };
  const ScoreLens = {
    strike(brickColor, comboCount) {
      const x = (comboCount || 0) / Cache.maxCombo;
      const value = BRICK_VALUES[brickColor] || 0.25;
      const y = 0.25 + value * 0.75;   // floor score at low brick value
      const tone = Manifold.strike(x, y, 'score-bloom', {
        lens: 'ScoreLens', brick: brickColor
      });
      return tone.z;
    },
    focus(brickColor, comboCount) { return ScoreLens.strike(brickColor, comboCount); }
  };

  // ════════════════════════════════════════════════════════════════
  // MANIFOLD STATE LISTENER: keep Cache in sync with the game
  // ════════════════════════════════════════════════════════════════
  window.addEventListener('manifold:state-update', (e) => {
    const d = e.detail || {};
    if (d.level !== undefined) Cache.level = d.level;
    if (d.bricksRemaining !== undefined) Cache.bricksRemaining = d.bricksRemaining;
    if (d.totalBricks !== undefined) Cache.totalBricks = d.totalBricks;
    if (d.ballSpeed !== undefined) Cache.ballSpeed = d.ballSpeed;
    if (d.playerCount !== undefined) Cache.playerCount = d.playerCount;
    if (d.comboCount !== undefined) Cache.comboCount = d.comboCount;

    // Re-strike the manifold for tension on every state update
    Cache.tension = GameStateLens.strike(Cache).z;

    ManifoldBus.emit('state-updated', { ...Cache });
  });

  // ════════════════════════════════════════════════════════════════
  // PUBLIC API: consumed by game.js via window.BBManifoldSubstrate
  // ════════════════════════════════════════════════════════════════
  const BBManifoldSubstrate = {
    /** Derive arena tension from current cache. Returns z ∈ [0,1]. */
    tension() { return Cache.tension; },

    /** Derive velocity weight for a ball. ballData = { id, speed, posY, threatCount } */
    velocityWeight(ballData) { return PhysicsLens.focus(ballData, Cache.tension); },

    /** Derive glow intensity for a ball. ballData = { id, posY, threatCount } */
    glowIntensity(ballData) { return GraphicsLens.focus(ballData); },

    /** Derive audio power for a game event. */
    soundPower(eventType) { return AudioLens.focus(eventType, Cache.tension); },

    /** Derive score bloom multiplier. Returns z ∈ [0,1]. Apply: score = base * (1 + z). */
    scoreBloom(brickColor, comboCount) { return ScoreLens.focus(brickColor, comboCount); },

    /** Update the cache and re-strike for tension. Call on every game tick or state change. */
    update(patch) {
      Object.assign(Cache, patch);
      Cache.tension = GameStateLens.strike(Cache).z;
      return Cache.tension;
    },

    /** Direct access to the instrument: give (x,y), receive a tone z. */
    strike(x, y, label, meta) { return Manifold.strike(x, y, label, meta); },

    /** Same operation, named for the listener side: read the tone that
     *  already lives at (x, y) on the surface. */
    observe(x, y, label, meta) { return Manifold.observe(x, y, label, meta); },

    /** The instrument's fixed shape, exposed read-only. */
    surface: Manifold.surface,

    /** Read the wavelength/frequency the surface holds at (x,y).
     *  Pure geometry: no sound is produced. */
    toneAt(x, y) { return Manifold.toneAt(x, y); },

    /** Local slope (string-tension analogue) of the surface at (x,y). */
    slopeAt(x, y) { return Manifold.slopeAt(x, y); },

    /** All windows onto the surface: sound, light, color, ascii,
     *  pixel, gate, decision, vector, card, rule, input.
     *  Each is a pure geometric readout of the same coordinate. */
    interpret: Manifold.interpret,

    on: ManifoldBus.on.bind(ManifoldBus),
    emit: ManifoldBus.emit.bind(ManifoldBus),
    cache: Cache,
  };

  window.BBManifoldSubstrate = BBManifoldSubstrate;

  // Announce readiness to the game
  window.dispatchEvent(new CustomEvent('manifold:substrate-ready', {
    detail: { game: 'brickbreaker3d', lenses: 5 }
  }));

})();
