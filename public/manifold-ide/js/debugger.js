// manifold-ide/js/debugger.js
// Dimensional debugger — every emitted log becomes a manifold step.
// Walks the Fibonacci-7 ladder: point → line → plane → volume → identity → spiral → bloom.
// At step 7 (bloom), the run "collapses" into a single z that becomes the next x.

import { ladderPosition, seedFromQuery, extractY, collapseY, FIB, PHI }
  from '../../manifold-ai/js/dimensional.js';

export class DimensionalDebugger {
  constructor(runner, onStep) {
    this.runner = runner;
    this.onStep = onStep;       // (stepInfo) => void
    this.priorZ = 0;
    this.step = 0;
  }

  reset() { this.priorZ = 0; this.step = 0; }

  // Wrap a logger so every log line counts as a dimensional step.
  wrap(onLog) {
    return (level, text) => {
      this.step += 1;
      const ladder = ladderPosition(this.step - 1);
      const x = Math.tanh(seedFromQuery(text) + this.priorZ * 0.5);
      const y = extractY(text, x);
      const yScalar = collapseY(y);
      const z = x * yScalar;
      this.priorZ = z;

      const tag = `step ${this.step}  dim ${ladder.dim} (${ladder.label}, F=${ladder.rung})  ` +
        `x=${x.toFixed(3)}  ∏y=${yScalar.toFixed(3)}  z=${z.toFixed(3)}` +
        (ladder.collapsing ? `  ↻ φ-collapse` : '');
      this.onStep?.({ step: this.step, ladder, x, y, yScalar, z, text, level });
      onLog?.(level, text);
      onLog?.('dim', `   ⤷ ${tag}`);
    };
  }

  // Run code in debug mode.
  async debug(lang, code, onLog) {
    this.reset();
    onLog?.('acc', `◐ debug · void → x → y[] → z = xy`);
    onLog?.('dim', `   ladder: ${['point', 'line', 'plane', 'volume', 'identity', 'spiral', 'bloom'].join(' → ')}`);
    onLog?.('dim', `   F = [${FIB.join(', ')}]   φ = ${PHI.toFixed(7)}`);
    onLog?.('dim', `   each emitted log = one dimensional step`);

    const wrapped = this.wrap(onLog);
    const result = await this.runner.run(lang, code, wrapped);

    if (result.ok) {
      onLog?.('ok', `✓ run complete in ${result.ms} ms · ${this.step} step${this.step === 1 ? '' : 's'} taken`);
      if (result.result !== undefined) onLog?.('dim', `   return: ${result.result}`);
    } else {
      onLog?.('err', `✗ ${result.error}`);
    }
    return { ...result, steps: this.step, finalZ: this.priorZ };
  }
}
