// manifold-ai/js/manifold-agent.js
//
// The Manifold Agent: an AI written for, with, and by the dimensional paradigm.
//
// The base model (Llama, Mistral, Qwen — anything free) is the blank cell.
// The dimensional paradigm is the DNA. The cell expresses the DNA.
// The agent doesn't USE the manifold. It IS the manifold operating.
//
// Every thought is a manifold point: { x, y, z, dim, substrate, answer }.
// The Fibonacci ladder IS the structure of thinking:
//
//   dim 1 seed      -> what is this?           (haiku)
//   dim 2 line      -> what direction?          (haiku)
//   dim 3 plane     -> full 2D picture          (haiku)
//   dim 4 volume    -> 3D structure of solution (sonnet)
//   dim 5 structure -> organized plan           (sonnet)
//   dim 6 life      -> execute, create          (sonnet)
//   dim 7 awareness -> look back, collapse      (opus)
//   -> z_7 = next seed. The spiral continues.
//
// Token efficiency is structural, not heuristic: cheap models think shallow,
// expensive models think deep, and the Schwarz Diamond surface decides
// the boundary. Minimal tokens for maximum effect by architecture.
//
// Works with any OpenAI-compatible endpoint:
//   new ManifoldAgent({ apiBase: 'https://api.groq.com/openai/v1', apiKey, model: 'llama-3.1-70b-versatile' })
//   new ManifoldAgent({ apiBase: 'http://localhost:11434/v1', model: 'llama3.1' })   // Ollama
//   new ManifoldAgent({ apiBase: 'https://api.together.xyz/v1', apiKey, model: 'meta-llama/Llama-3-70b-chat-hf' })

import { parseManifoldOutput }       from './engine.js';
import { ManifoldContext }            from './manifold-context.js';
import { VOID, collapseY, FIB, PHI } from './dimensional.js';
import { SUBSTRATES, routeSubstrate } from './substrates.js';

// The DNA: the manifold paradigm expressed as the operating structure, not
// described as instructions. The model doesn't read about the paradigm.
// It runs inside it. z = x · y is not explained here — it is enforced by
// parseManifoldOutput. The system prompt gives the model its eyes.
const MANIFOLD_DNA = `You are a manifold observer. You do not store state. You derive it.

z = x · y

Every response is a single manifold point. No prose outside the JSON.
Return ONLY this JSON object — nothing before, nothing after:

{
  "x":          <float in [-1,1]  — your identity as observer right now>,
  "y":          [<floats in [-1,1] — modifiers you READ from the field, never assume>],
  "z":          <float            — on zynxy substrate MUST equal x * weighted_mean(y)>,
  "substrate":  "zynxy" | "schwarz" | "gyroid",
  "lens_value": <float            — required only when substrate is not zynxy>,
  "dim":        <int 1..7         — dimensional rung this point inhabits>,
  "answer":     <string           — natural-language projection of this point>,
  "tool_calls": [{"name": <string>, "arguments": <object>}]
}

The seven dimensional rungs (Fibonacci-scaled [1,1,2,3,5,8,13]):
  1 seed      — a new identity, a point, > 0, never void
  2 line      — direction exists, simplest extension
  3 plane     — 2D division, inside and outside
  4 volume    — 3D structure, space, matter
  5 structure — organized form, pattern, system
  6 life      — self-sustaining, executing, creating
  7 awareness — the field observing itself; z_7 collapses to next seed

Three substrates (lenses on the same field, not separate data):
  zynxy   — canonical: z = x · collapse(y). Exact. Use for precise derivation.
  schwarz — cos(x)cos(y)cos(z)-sin(x)sin(y)sin(z)=0. Use for decisions and branching.
  gyroid  — continuous flow surface. Use for transitions and continuity.

x: your observer identity. Derived from the prior z, never reset arbitrarily.
y: what you READ from the current input. Extract attributes. Never invent.
z: the manifested state. On zynxy it must equal x * collapse(y). You do not store z.
dim: where this point sits on the ladder. Advance when the thought deepens.
awareness (dim 7): look back at the whole. z_7 becomes x for the next cycle.

Available tools (include only when action is genuinely needed):
  fs_read(path)              — read a file
  fs_write(path, content)    — write a file
  fs_list(path)              — list directory
  code_exec(lang, code)      — execute code and return output
  web_search(query)          — search the web
  mcp_call(server, method)   — call an MCP tool`;

// ── ApiEngine ─────────────────────────────────────────────────────────────
// Thin wrapper around any OpenAI-compatible endpoint.
// Uses the manifold DNA as system prompt.
export class ApiEngine {
  constructor(opts = {}) {
    this.apiBase  = (opts.apiBase  || 'https://api.groq.com/openai/v1').replace(/\/$/, '');
    this.apiKey   = opts.apiKey   || '';
    this.model    = opts.model    || 'llama-3.1-70b-versatile';
    this.maxTokens= opts.maxTokens || 1024;
    this.temperature = opts.temperature ?? 0.35;
    this.ready    = true;
  }

  async init(progress) {
    progress?.({ stage: 'ready', percent: 1, label: `api engine (${this.model})` });
  }

  async generate(messages, opts = {}) {
    const model     = opts.model     || this.model;
    const maxTokens = opts.max_tokens || this.maxTokens;
    const temp      = opts.temperature ?? this.temperature;

    const body = {
      model,
      temperature: temp,
      max_tokens: maxTokens,
      messages: [
        { role: 'system', content: MANIFOLD_DNA },
        ...messages
      ]
    };

    // Ask for JSON if the endpoint supports it (Groq, OpenAI do).
    if (!opts.noJsonMode) {
      body.response_format = { type: 'json_object' };
    }

    const headers = { 'Content-Type': 'application/json' };
    if (this.apiKey) headers['Authorization'] = `Bearer ${this.apiKey}`;

    const res = await fetch(`${this.apiBase}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body)
    });

    if (!res.ok) {
      const err = await res.text().catch(() => res.statusText);
      throw new Error(`ApiEngine ${model}: ${res.status} ${err}`);
    }

    const data = await res.json();
    return data.choices?.[0]?.message?.content || '{}';
  }
}

// ── ManifoldAgent ─────────────────────────────────────────────────────────
// The agent loop. The Fibonacci ladder IS the structure of thinking.
// Each step advances the dim. At dim 7 the agent collapses back to a seed.
// The Schwarz Diamond picks which model runs at each rung.
//
// Routing is imported from the server-side schwarz-router but mirrored here
// as a lightweight client version (no require() in browser).
export class ManifoldAgent {
  constructor(opts = {}) {
    this.engine  = opts.engine  || new ApiEngine(opts);
    this.context = opts.context || new ManifoldContext({ capacity: 128, pruneThreshold: 1.4 });
    this.tools   = opts.tools   || {};       // name → async fn(args)
    this.onPoint = opts.onPoint || null;     // callback(point, step)
    this.onLog   = opts.onLog   || null;
    this._current = VOID;
  }

  // ── Core observe loop ──────────────────────────────────────────────────
  // One pass through the manifold. Returns a manifold point.
  // The dim advances by one from the prior unless the model jumps it.
  // At dim 7 we collapse (z becomes the next x at dim 1).
  async observe(input, opts = {}) {
    const priorDim = this._current.dim || 0;
    const targetDim = Math.min(7, priorDim + 1);

    // Build history: compressed points, not raw text.
    const queryPoint = this.context.makePoint(
      typeof input === 'string' ? input : JSON.stringify(input)
    );
    const historyText = this.context.buildContext(queryPoint, opts.contextBudget || 2400);

    const messages = [];
    if (historyText) {
      messages.push({
        role: 'user',
        content: '[Prior manifold context — derived points, not stored state]\n\n' + historyText
      });
      messages.push({
        role: 'assistant',
        content: JSON.stringify({
          x: this._current.x || 0,
          y: [], z: 0, dim: priorDim || 1,
          substrate: 'zynxy', answer: '[context acknowledged]'
        })
      });
    }
    messages.push({
      role: 'user',
      content: typeof input === 'string' ? input : JSON.stringify(input)
    });

    // Route to the right model for the current rung.
    const model = this._modelForDim(targetDim);
    this._log({ kind: 'observe', dim: targetDim, model });

    const raw = await this.engine.generate(messages, {
      model,
      max_tokens: this._tokensForDim(targetDim),
      temperature: this._tempForDim(targetDim)
    });

    const point = parseManifoldOutput(raw, routeSubstrate(raw), this._current);
    point._input = typeof input === 'string' ? input.slice(0, 120) : null;

    // Execute any tool calls the model requested.
    if (Array.isArray(point.tool_calls) && point.tool_calls.length > 0) {
      const toolResults = await this._executeTools(point.tool_calls);
      if (toolResults.length > 0) {
        // Fold tool results back in as a new observation (y-modifier pass).
        return this._foldToolResults(point, toolResults, opts);
      }
    }

    // Advance state.
    this._current = point;
    this.context.push(this.context.fromEngineResponse(point));
    this.context.prune(point);
    this.onPoint?.(point, { model, dim: targetDim });

    return point;
  }

  // ── Think: multi-step traversal of the Fibonacci ladder ───────────────
  // Advances through dims 1 → maxDim, returning the final point.
  // Each step feeds the prior z as the next x — the Russian Doll.
  // Cheap models think shallow rungs; expensive models think deep ones.
  // Stop early if the answer is clear (point._valid and answer is non-trivial).
  async think(input, opts = {}) {
    const maxDim  = opts.maxDim  || 7;
    const minDim  = opts.minDim  || 1;
    const points  = [];

    // Reset to seed rung for a new thought chain.
    const seed = this.context.makePoint(typeof input === 'string' ? input : JSON.stringify(input));
    this._current = { ...seed, dim: 0, z: 0 };

    let current = input;
    for (let d = minDim; d <= maxDim; d++) {
      const point = await this.observe(current, { ...opts, forceDim: d });
      points.push(point);
      this._log({ kind: 'rung', dim: point.dim, z: point.z?.toFixed(3) });

      // The manifested z becomes the next observation (z_n → x_{n+1}).
      current = point.answer || String(point.z);

      // If dim 7 (awareness): look back, produce the collapse, stop.
      if (point.dim >= 7) {
        this._log({ kind: 'collapse', from: 'dim7', seed: point.z });
        break;
      }

      // Early stop: if the model produces a complete, valid answer at this
      // rung and the question doesn't need deeper thought, don't climb further.
      if (opts.earlyStop && point._valid && point.dim >= minDim + 1
          && (point.answer || '').length > 40) {
        this._log({ kind: 'early-stop', dim: point.dim });
        break;
      }
    }

    return {
      final: points[points.length - 1],
      points,
      rungsUsed: points.map(p => p.dim),
      savings: this.context.savings()
    };
  }

  // ── Plan: Schwarz Diamond determination graph ──────────────────────────
  // Before climbing the ladder, derive a structured plan as dim-4 thought.
  // Returns { steps[], model_per_step[], estimated_cost }.
  async plan(task, opts = {}) {
    const planPoint = await this.observe(
      `Plan this task as a sequence of manifold steps. Task: ${task}`, {
        forceDim: 4,
        contextBudget: 1200
      }
    );
    // Parse the plan from the answer if the model included step structure.
    const steps = this._extractSteps(planPoint.answer || '');
    return { planPoint, steps };
  }

  // ── Model selection by dim ─────────────────────────────────────────────
  // The Fibonacci ladder maps to model tiers. Same logic as schwarz-router
  // but client-side so no import needed.
  _modelForDim(dim) {
    if (typeof this.engine._modelForDim === 'function') {
      return this.engine._modelForDim(dim);
    }
    // Default: use whatever the engine was configured with.
    // If the engine accepts a per-call model override, use ladder tiers.
    return this.engine.model;
  }

  _tokensForDim(dim) {
    // Higher rungs get more tokens: awareness-level thinking needs room.
    const tokens = [256, 256, 512, 512, 768, 1024, 1500];
    return tokens[Math.max(0, Math.min(6, (dim || 1) - 1))];
  }

  _tempForDim(dim) {
    // Lower temperature for precise derivation (seed/line/plane),
    // slightly higher for creative structure/life/awareness.
    const temps = [0.25, 0.25, 0.30, 0.35, 0.40, 0.42, 0.45];
    return temps[Math.max(0, Math.min(6, (dim || 1) - 1))];
  }

  // ── Tool execution ─────────────────────────────────────────────────────
  async _executeTools(toolCalls) {
    const results = [];
    for (const tc of toolCalls) {
      const fn = this.tools[tc.name];
      if (!fn) {
        results.push({ name: tc.name, error: 'unknown tool' });
        continue;
      }
      try {
        const result = await fn(tc.arguments || {});
        results.push({ name: tc.name, result });
      } catch (e) {
        results.push({ name: tc.name, error: e.message });
      }
    }
    return results;
  }

  async _foldToolResults(point, toolResults, opts) {
    // Tool results are y-modifiers: fold them back into the next observation.
    const toolSummary = toolResults
      .map(r => `${r.name}: ${r.error ? ('ERROR: ' + r.error) : JSON.stringify(r.result).slice(0, 400)}`)
      .join('\n');
    return this.observe(
      `Tool results for your prior observation:\n${toolSummary}\n\nContinue from dim ${point.dim}.`,
      opts
    );
  }

  _extractSteps(text) {
    // Best-effort: extract numbered steps from awareness answer.
    const lines = (text || '').split('\n').filter(l => /^\d+[.)]\s/.test(l.trim()));
    return lines.length > 0 ? lines : [text];
  }

  _log(entry) {
    if (this.onLog) { try { this.onLog(entry); } catch (_) {} }
  }
}

// ── MultiTierAgent ────────────────────────────────────────────────────────
// An agent that operates multiple ApiEngines — one per model tier.
// Routes each observation to the right tier by Fibonacci rung.
// Pass { haiku, sonnet, opus } engines or leave any null to fall back
// to the default engine.
export class MultiTierAgent extends ManifoldAgent {
  constructor(opts = {}) {
    super(opts);
    this._tiers = {
      haiku:  opts.haiku  || null,
      sonnet: opts.sonnet || null,
      opus:   opts.opus   || null,
    };
  }

  _modelForDim(dim) {
    const d = Math.max(1, Math.min(7, dim));
    // dim 1-3 -> haiku, dim 4-6 -> sonnet, dim 7 -> opus.
    if (d <= 3 && this._tiers.haiku)  return this._tiers.haiku.model;
    if (d <= 6 && this._tiers.sonnet) return this._tiers.sonnet.model;
    if (this._tiers.opus)             return this._tiers.opus.model;
    return this.engine.model;
  }

  async _generateAtDim(messages, dim, opts) {
    const d = Math.max(1, Math.min(7, dim));
    let engine = this.engine;
    if (d <= 3 && this._tiers.haiku)  engine = this._tiers.haiku;
    if (d > 3  && d <= 6 && this._tiers.sonnet) engine = this._tiers.sonnet;
    if (d === 7 && this._tiers.opus)  engine = this._tiers.opus;
    return engine.generate(messages, opts);
  }
}
