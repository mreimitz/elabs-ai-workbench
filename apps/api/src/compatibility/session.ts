// WP 5.6 — Session-level compatibility evaluators. For a completed (or partial) run + a model, score
// the 8 `level: "session"` catalog tests against REAL execution data: the cumulative-context series,
// per-tool result size + latency, per-turn tool-call / parallel-call counts, the static cache prefix,
// observed token totals (→ cost), and the session token rate.
//
// Mirrors `runner.ts`: catalog test → measure → resolve a threshold from `model.detail` / cross-cutting
// → verdict bands → `resolveSeverity`, assembled into the shared `CompatibilityResult`. It does NOT
// touch `runner.ts` (the static engine); it is the live-run counterpart. The `run` input is a small,
// engine-agnostic shape so this is unit-testable without an LLM in the loop — the route adapts a
// persisted `RunDetail` into it.

import type {
  CompatibilityResult,
  CompatibilitySeverity,
  CompatibilityVerdict,
  RunDetail,
  RunStep,
  TokenUsageActual,
} from "@mcp-token-footprint/shared";
import { estimateCost } from "../providers/pricing.js";
import { getCatalog, type CatalogTest } from "./catalog.js";
import { getCrossCutting, getModel } from "./dataset.js";
import type { FlatModel } from "@mcp-token-footprint/shared";
import { resolveSeverity } from "./resolve.js";

/** One MCP tool result, sized + timed (for SESSION_TOOL_RESULT_SIZE / SESSION_TOOL_TIMEOUT). */
export type SessionToolResult = {
  toolName: string;
  tokens: number;
  bytes?: number;
  durationMs: number;
};

/** Per-turn tool-call breakdown (for SESSION_CALLS_PER_TURN / SESSION_PARALLEL_CALLS). */
export type SessionTurn = { toolCallCount: number; parallelCallCount: number };

/**
 * The lightweight run input the session evaluators read. All fields come from the run engine's
 * accounting (see `apps/api/src/testing/accounting.ts` `SessionStats`) or are derived from the
 * persisted `run_steps`. Kept engine-agnostic so it is trivially constructible in a unit test.
 */
export type SessionRun = {
  /** Run id (becomes the result `subjectId`). */
  runId: string;
  /** Peak cumulative context tokens across the session (SESSION_CONTEXT_HIGHWATER). */
  peakContextTokens: number;
  /** Per-turn tool-call / parallel-call counts. */
  turns: SessionTurn[];
  /** Per-call result size + latency. */
  toolResults: SessionToolResult[];
  /** Static prefix = system-prompt tokens + tool-definition tokens (SESSION_CACHE_ELIGIBILITY). */
  systemPromptTokens: number;
  toolDefTokens: number;
  /** Provider-actual token totals across the run (SESSION_COST_PER_TASK). */
  totals: TokenUsageActual;
  /** Session token rate (input+output tokens per minute) (SESSION_RATE_LIMIT_THROUGHPUT). */
  tokensPerMinute: number;
};

export type SessionRunOpts = {
  /** Host/client id for client-scoped thresholds (e.g. `claude_desktop`, `m365_copilot`). */
  client?: string;
  /** Optional per-task budget (USD) — turns SESSION_COST_PER_TASK from informational to a warn gate. */
  costBudgetUsd?: number;
};

type Verdict = {
  verdict: CompatibilityVerdict;
  measured: CompatibilityResult["measured"];
  threshold: CompatibilityResult["threshold"];
};

const NA: Verdict = { verdict: "na", measured: { value: null }, threshold: { value: null } };

// --- shared helpers (kept local; runner.ts has its own copies — do not import across) -------------

function getPath(obj: unknown, dotted: string): unknown {
  let cur: unknown = obj;
  for (const seg of dotted.split(".")) {
    if (cur && typeof cur === "object" && seg in (cur as Record<string, unknown>)) {
      cur = (cur as Record<string, unknown>)[seg];
    } else {
      return undefined;
    }
  }
  return cur;
}

/** Lower-is-better band against an absolute fail level + fractional warn (warnFrac × failAt). */
function bandFraction(
  value: number,
  capacity: number,
  warnFrac: number,
  failFrac: number,
): CompatibilityVerdict {
  if (capacity <= 0) return "na";
  const frac = value / capacity;
  if (frac >= failFrac) return "fail";
  if (frac >= warnFrac) return "warn";
  return "pass";
}

function passFail(ok: boolean): CompatibilityVerdict {
  return ok ? "pass" : "fail";
}

/** The item with the largest `key`; `undefined` only for an empty list. */
function maxBy<T>(items: T[], key: (item: T) => number): T | undefined {
  let best: T | undefined;
  let bestKey = -Infinity;
  for (const item of items) {
    const k = key(item);
    if (k > bestKey) {
      bestKey = k;
      best = item;
    }
  }
  return best;
}

/** The largest `key` over the list (0 for an empty list). */
function maxOf<T>(items: T[], key: (item: T) => number): number {
  let max = 0;
  for (const item of items) max = Math.max(max, key(item));
  return max;
}

/**
 * The cross-cutting `providers.*` block keys providers by an underscore id (`google_gemini`,
 * `xai_grok`, `microsoft_copilot`) that differs from the dataset `provider.id` (`google-gemini`,
 * `xai`, `microsoft-copilot`). Map dataset → cross-cutting so `cross.providers.<provider>.*` resolves.
 */
const PROVIDER_ID_TO_CROSS: Record<string, string> = {
  anthropic: "anthropic",
  openai: "openai",
  "google-gemini": "google_gemini",
  xai: "xai_grok",
  mistral: "mistral",
  "microsoft-copilot": "microsoft_copilot",
};

function crossProvider(model: FlatModel): Record<string, unknown> | undefined {
  const key = PROVIDER_ID_TO_CROSS[model.provider_id];
  if (!key) return undefined;
  const providers = getPath(getCrossCutting(), "providers");
  const node =
    providers && typeof providers === "object"
      ? (providers as Record<string, unknown>)[key]
      : undefined;
  return node && typeof node === "object" ? (node as Record<string, unknown>) : undefined;
}

function crossClient(client: string): Record<string, unknown> | undefined {
  const clients = getPath(getCrossCutting(), "clients");
  const node =
    clients && typeof clients === "object"
      ? (clients as Record<string, unknown>)[client]
      : undefined;
  return node && typeof node === "object" ? (node as Record<string, unknown>) : undefined;
}

/** A plain finite number, or null (objects / strings / nullish all → null). */
function asNumber(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** Leading integer from a value that may be a number or a free-text note (e.g. "~20 tool calls"). */
function leadingNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const m = /(\d[\d,]*)/.exec(v);
    if (m && m[1]) return Number(m[1].replace(/,/g, ""));
  }
  return null;
}

const BYTE_MULTIPLIER: Record<string, number> = {
  B: 1,
  BYTE: 1,
  BYTES: 1,
  KB: 1024,
  MB: 1_048_576,
  GB: 1_073_741_824,
};

/**
 * Parse a documented byte size into bytes. The dataset writes the same cap two ways — as one string
 * ("512KB") or as a `value`/`unit` pair (`512` + `"KB"`, which is what the 2026-08-19 refresh
 * normalized OpenAI to) — so the numeric form MUST be scaled by the node's own unit. Reading a bare
 * `512` as 512 bytes would flag every tool result over half a kilobyte.
 */
function sizeToBytes(v: unknown, unitHint = ""): number | null {
  const hint = BYTE_MULTIPLIER[unitHint.trim().toUpperCase()];
  if (typeof v === "number" && Number.isFinite(v)) return v * (hint ?? 1);
  if (typeof v !== "string") return null;
  const m = /^([\d.]+)\s*(B|KB|MB|GB)?$/i.exec(v.trim());
  if (!m || !m[1]) return null;
  const n = Number(m[1]);
  // An explicit suffix on the string wins; otherwise fall back to the node's unit, then bytes.
  const mul = m[2] ? BYTE_MULTIPLIER[m[2].toUpperCase()] : (hint ?? 1);
  return n * (mul ?? 1);
}

/**
 * The documented tool-result size cap as BYTES, or null when it isn't byte-denominated. Reads the
 * full `max_tool_result_size` node so the `unit` is honored: only a byte unit (B/KB/MB/GB, e.g.
 * OpenAI's "512KB") is a byte cap. An `items` unit (M365's "25 items") or `tokens` is NOT a byte
 * cap — returning null routes those to the window-share budget instead of mistaking 25 items for
 * 25 bytes (which would fail every normal result).
 */
function toolResultByteCap(model: FlatModel): number | null {
  const node = getPath(model.detail, "tools_mcp.max_tool_result_size");
  if (!node || typeof node !== "object") return null;
  const n = node as Record<string, unknown>;
  const unit = (typeof n.unit === "string" ? n.unit : "").toLowerCase();
  const BYTE_UNITS = new Set(["b", "kb", "mb", "gb", "bytes", "byte"]);
  // A bare numeric value with no/empty unit is ambiguous; only treat it as bytes when it is a byte
  // string ("512KB") or carries an explicit byte unit.
  if (unit && !BYTE_UNITS.has(unit)) return null;
  if (!unit && typeof n.value === "number") return null; // unitless number → not a byte cap
  return sizeToBytes(n.value, unit);
}

/**
 * Resolve a provider's minimum cacheable prefix tokens across the shapes the dataset uses: a plain
 * number (OpenAI 1024), a model-family-keyed object (Anthropic {…:1024, haiku_3x:2048}), or Google's
 * nested implicit-cache block (`prompt_cache_implicit.min_tokens.{family}` = 2048). Takes the lowest
 * documented minimum (the most permissive "caching can trigger" floor). Null when undocumented.
 */
function resolveCacheMinTokens(provider: Record<string, unknown> | undefined): number | null {
  if (!provider) return null;
  const direct = asNumber(provider.prompt_cache_min_tokens);
  if (direct !== null) return direct;
  const lowestOf = (node: unknown): number | null => {
    if (!node || typeof node !== "object") return null;
    const vals = Object.values(node as Record<string, unknown>)
      .map(asNumber)
      .filter((v): v is number => v !== null);
    return vals.length ? Math.min(...vals) : null;
  };
  return (
    lowestOf(provider.prompt_cache_min_tokens) ??
    lowestOf(getPath(provider, "prompt_cache_implicit.min_tokens"))
  );
}

// --- per-test evaluation ------------------------------------------------------------------------

function evalSession(
  test: CatalogTest,
  run: SessionRun,
  model: FlatModel,
  opts: SessionRunOpts,
): Verdict {
  const window = model.context_window_tokens;
  switch (test.id) {
    case "SESSION_CONTEXT_HIGHWATER": {
      // Peak cumulative tokens vs the window: warn ≥80%, fail ≥100% (overflow).
      if (window === null) return NA;
      const verdict = bandFraction(run.peakContextTokens, window, 0.8, 1);
      return {
        verdict,
        measured: { value: run.peakContextTokens, unit: "tokens" },
        threshold: {
          value: window,
          unit: "tokens",
          source: "model.context.context_window_tokens (warn 80% / fail 100%)",
        },
      };
    }

    case "SESSION_TOOL_RESULT_SIZE": {
      // Worst single tool result vs the documented byte cap, else a window-share budget (warn 10% / fail 25%).
      const worst = maxBy(run.toolResults, (r) => r.tokens);
      if (!worst) return NA;
      const byteCap = toolResultByteCap(model);
      if (byteCap !== null && worst.bytes !== undefined) {
        return {
          verdict: passFail(worst.bytes <= byteCap),
          measured: { value: worst.bytes, unit: "bytes" },
          threshold: {
            value: byteCap,
            unit: "bytes",
            source: "model.tools_mcp.max_tool_result_size",
          },
        };
      }
      if (window === null) return NA;
      const verdict = bandFraction(worst.tokens, window, 0.1, 0.25);
      return {
        verdict,
        measured: { value: worst.tokens, unit: "tokens" },
        threshold: {
          value: Math.round(0.25 * window),
          unit: "tokens",
          source: "window share (warn 10% / fail 25%)",
        },
      };
    }

    case "SESSION_TOOL_TIMEOUT": {
      // Worst single tool latency vs the host timeout (client > SDK default 60s): warn ≥70%, fail ≥100%.
      const slowest = maxBy(run.toolResults, (r) => r.durationMs);
      if (!slowest) return NA;
      const client = opts.client ? crossClient(opts.client) : undefined;
      const sdkDefault = asNumber(
        getPath(
          getCrossCutting(),
          "sdk_defaults.mcp_typescript_sdk_v2.DEFAULT_REQUEST_TIMEOUT_MSEC",
        ),
      );
      const timeout = asNumber(client?.tool_call_timeout_ms) ?? sdkDefault ?? 60_000;
      const source =
        asNumber(client?.tool_call_timeout_ms) !== null
          ? `cross.clients.${opts.client}.tool_call_timeout_ms`
          : "cross.sdk_defaults.mcp_typescript_sdk_v2 (fallback 60000)";
      const verdict = bandFraction(slowest.durationMs, timeout, 0.7, 1);
      return {
        verdict,
        measured: { value: Math.round(slowest.durationMs), unit: "ms" },
        threshold: { value: timeout, unit: "ms", source },
      };
    }

    case "SESSION_CALLS_PER_TURN": {
      // Max tool calls in any single turn vs the provider/SDK agent-loop cap: warn ≥80%, fail > cap.
      const provider = crossProvider(model);
      const cap = leadingNumber(provider?.agent_loop_default_turns);
      if (cap === null) return NA;
      const peak = maxOf(run.turns, (t) => t.toolCallCount);
      const verdict = peak > cap ? "fail" : peak >= 0.8 * cap ? "warn" : "pass";
      return {
        verdict,
        measured: { value: peak, unit: "calls" },
        threshold: {
          value: cap,
          unit: "calls",
          source: "cross.providers.<provider>.agent_loop_default_turns",
        },
      };
    }

    case "SESSION_PARALLEL_CALLS": {
      // Max parallel calls in any turn vs a documented numeric cap; NA where unspecified (the norm).
      const cap = asNumber(getPath(model.detail, "tools_mcp.max_parallel_tool_calls_count.value"));
      if (cap === null) return NA;
      const peak = maxOf(run.turns, (t) => t.parallelCallCount);
      return {
        verdict: passFail(peak <= cap),
        measured: { value: peak, unit: "calls" },
        threshold: {
          value: cap,
          unit: "calls",
          source: "model.tools_mcp.max_parallel_tool_calls_count",
        },
      };
    }

    case "SESSION_CACHE_ELIGIBILITY": {
      // Static prefix (tool defs + system) vs the provider prompt-cache minimum. NA when the model has
      // no prompt caching; warn when the prefix is below the minimum (caching won't trigger), else pass.
      if (model.prompt_caching !== true) return NA;
      const provider = crossProvider(model);
      const min = resolveCacheMinTokens(provider) ?? 1024;
      const prefix = run.toolDefTokens + run.systemPromptTokens;
      return {
        verdict: prefix >= min ? "pass" : "warn",
        measured: { value: prefix, unit: "tokens" },
        threshold: {
          value: min,
          unit: "tokens",
          source: "cross.providers.<provider>.prompt_cache_min_tokens (fallback 1024)",
        },
      };
    }

    case "SESSION_COST_PER_TASK": {
      // Unified pricing (Decision 1): the dataset-derived `estimateCost` over the observed token mix.
      // Informational unless a per-task budget is set (then warn above it). NA for self-hosted models.
      if (model.input_per_mtok_usd === null || model.output_per_mtok_usd === null) return NA;
      const cost = estimateCost(model.model_id, run.totals);
      const rounded = Number(cost.toFixed(6));
      const budget = opts.costBudgetUsd;
      const verdict: CompatibilityVerdict = budget !== undefined && cost > budget ? "warn" : "pass";
      return {
        verdict,
        measured: { value: rounded, unit: "USD" },
        threshold: {
          value: budget ?? null,
          unit: budget !== undefined ? "USD" : undefined,
          source: budget !== undefined ? "user budget per task" : "informational (dataset pricing)",
        },
      };
    }

    case "SESSION_RATE_LIMIT_THROUGHPUT": {
      // Session token rate vs the provider input-TPM tier: warn ≥80%, fail > tier. NA when no tier modelled.
      const provider = crossProvider(model);
      const tier = asNumber(provider?.input_tpm_tier);
      if (tier === null) return NA;
      const rate = Math.round(run.tokensPerMinute);
      const verdict = rate > tier ? "fail" : rate >= 0.8 * tier ? "warn" : "pass";
      return {
        verdict,
        measured: { value: rate, unit: "tokens/min" },
        threshold: {
          value: tier,
          unit: "tokens/min",
          source: "cross.providers.<provider>.input_tpm_tier",
        },
      };
    }

    default:
      return NA;
  }
}

// --- result assembly (mirrors runner.ts `toResult`) ----------------------------------------------

function toResult(
  test: CatalogTest,
  run: SessionRun,
  modelId: string,
  v: Verdict,
  opts: SessionRunOpts,
): CompatibilityResult {
  const resolved = resolveSeverity(test, modelId, opts.client);
  const severity: CompatibilitySeverity | "na" = v.verdict === "na" ? "na" : resolved.severity;
  return {
    testId: test.id,
    techName: test.tech_name,
    userFacingName: test.user_facing_name,
    findingName: test.finding_name,
    level: test.level,
    subjectType: "session",
    subjectId: run.runId,
    modelId,
    verdict: v.verdict,
    severity,
    failureMode: test.impact.failure_mode,
    measured: v.measured,
    threshold: v.threshold,
    message: test.what_it_does,
    recommendation: test.recommendation,
    rationale: resolved.rationale,
    evidence: resolved.evidence,
  };
}

/**
 * Adapt a persisted {@link RunDetail} into the lightweight {@link SessionRun} the evaluators read.
 * Derives per-turn tool-call batches from the ordered steps (tool calls issued between two LLM
 * responses belong to the turn that requested them), the per-call result size + latency from each
 * `tool_call` step (`profileTokens` carries the result size, `durationMs` the latency), the static
 * prefix from the first snapshot's `system` + `tool_defs` segments, the token totals from the summed
 * provider-actual usage (falling back to the finalized summary), and the token rate from the run
 * duration. Pure + engine-agnostic so the route stays thin.
 */
export function sessionRunFromDetail(detail: RunDetail): SessionRun {
  const steps = detail.steps;

  // Collapse the TWO persisted `tool_call` steps the engine writes per LOGICAL call into one: the
  // stream step (carries `turnIndex` + zero tokens) and the MCP-bridge step (carries `serverId` +
  // `durationMs` + the real result size/bytes) share `payload.toolCallId`. Without this collapse
  // every count + per-turn batch is doubled, flipping SESSION_CALLS_PER_TURN / SESSION_PARALLEL_CALLS.
  const calls = collapseToolCalls(steps);

  // Per-turn batches. Real runs carry an engine-authored `turnIndex` (one ordinal per assistant
  // message) → group by it so calls in ONE message form a parallel batch and calls across messages
  // are separate sequential turns. Legacy/synthetic runs (no turnIndex) fall back to step order: each
  // call belongs to the open `llm_response` turn.
  const turns: SessionTurn[] = calls.some((c) => c.turnIndex !== undefined)
    ? turnsByIndex(calls)
    : turnsByOrder(steps);

  const toolResults: SessionToolResult[] = calls.map((c) => ({
    toolName: c.toolName,
    tokens: c.tokens,
    bytes: c.bytes,
    durationMs: c.durationMs,
  }));

  // Static prefix from the first step that carries a context snapshot (segments are fixed per run).
  const withContext = steps.find((s) => s.context !== undefined);
  const systemPromptTokens = withContext?.context?.segments.system ?? 0;
  const toolDefTokens = withContext?.context?.segments.tool_defs ?? 0;

  // Token totals: sum provider-actual usage across LLM steps; fall back to the finalized summary so a
  // pre-WP-5.6 run (steps without per-step usage) still has input/output totals.
  const summed = steps.reduce<TokenUsageActual>(
    (acc, s) => {
      const u = s.usageActual;
      if (!u) return acc;
      acc.inputTokens += u.inputTokens;
      acc.outputTokens += u.outputTokens;
      acc.cachedInputTokens = (acc.cachedInputTokens ?? 0) + (u.cachedInputTokens ?? 0);
      acc.reasoningTokens = (acc.reasoningTokens ?? 0) + (u.reasoningTokens ?? 0);
      return acc;
    },
    { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, reasoningTokens: 0 },
  );
  const totals: TokenUsageActual =
    summed.inputTokens > 0 || summed.outputTokens > 0
      ? summed
      : { inputTokens: detail.tokensIn, outputTokens: detail.tokensOut };

  // Peak cumulative tokens: prefer the per-step cumulative series (WP 5.6), else the finalized peak.
  const peakFromSteps = steps.reduce(
    (m, s) => Math.max(m, s.cumulativeTokens ?? s.context?.total ?? 0),
    0,
  );
  const peakContextTokens = Math.max(peakFromSteps, detail.peakContextTokens);

  // Token rate: total billed tokens over the run wall-clock (minutes). Unknown/zero duration → 0.
  const totalTokens = totals.inputTokens + totals.outputTokens;
  const durationMs = detail.durationMs ?? 0;
  const tokensPerMinute = durationMs > 0 ? (totalTokens * 60_000) / durationMs : 0;

  return {
    runId: detail.id,
    peakContextTokens,
    turns,
    toolResults,
    systemPromptTokens,
    toolDefTokens,
    totals,
    tokensPerMinute,
  };
}

/** The tool-result size a `tool_call` step carries (the first/primary profile-token entry). */
function primaryProfileTokens(step: RunStep): number {
  for (const v of Object.values(step.profileTokens ?? {})) {
    if (typeof v === "number") return v;
  }
  return 0;
}

/** One LOGICAL tool call, merged from its (up to two) persisted `tool_call` steps. */
type LogicalCall = {
  toolName: string;
  tokens: number;
  bytes?: number;
  durationMs: number;
  turnIndex?: number;
};

/** The AI-SDK tool-call id a step carries in its (redacted) payload, when present. */
function toolCallIdOf(step: RunStep): string | undefined {
  const p = step.payload;
  if (p && typeof p === "object" && "toolCallId" in p) {
    const id = (p as { toolCallId?: unknown }).toolCallId;
    return typeof id === "string" ? id : undefined;
  }
  return undefined;
}

/**
 * Merge the per-logical-call `tool_call` steps (engine stream + MCP bridge) into one record each,
 * keyed by the shared `payload.toolCallId`. Steps without an id (legacy/synthetic) are each their
 * own call. Takes the larger token/duration (the bridge step has the real size; the stream step is
 * zero) and fills turnIndex / result bytes / a concrete toolName from whichever step carries them.
 */
function collapseToolCalls(steps: RunStep[]): LogicalCall[] {
  const byKey = new Map<string, LogicalCall>();
  const order: LogicalCall[] = [];
  let seq = 0;
  for (const s of steps) {
    if (s.type !== "tool_call") continue;
    const key = toolCallIdOf(s) ?? `__step_${s.id}_${seq}`;
    let call = byKey.get(key);
    if (!call) {
      call = { toolName: s.toolName ?? s.label, tokens: 0, durationMs: 0 };
      byKey.set(key, call);
      order.push(call);
      seq++;
    }
    call.tokens = Math.max(call.tokens, primaryProfileTokens(s));
    call.durationMs = Math.max(call.durationMs, s.durationMs ?? 0);
    if (s.turnIndex !== undefined) call.turnIndex = s.turnIndex;
    if (s.resultBytes !== undefined) call.bytes = s.resultBytes;
    if (s.toolName) call.toolName = s.toolName;
  }
  return order;
}

/** Group logical calls by engine turn ordinal → per-turn counts (calls in one turn are parallel). */
function turnsByIndex(calls: LogicalCall[]): SessionTurn[] {
  const counts = new Map<number, number>();
  let synthetic = -1;
  for (const c of calls) {
    const k = c.turnIndex ?? synthetic--; // a call without a turnIndex is its own (sequential) turn
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, n]) => ({ toolCallCount: n, parallelCallCount: n }));
}

/** Legacy fallback: bucket by step order, de-duping the stream + bridge pair by toolCallId. */
function turnsByOrder(steps: RunStep[]): SessionTurn[] {
  const turns: SessionTurn[] = [];
  let current: SessionTurn | null = null;
  const seen = new Set<string>();
  for (const step of steps) {
    if (step.type === "llm_response") {
      current = { toolCallCount: 0, parallelCallCount: 0 };
      turns.push(current);
    } else if (step.type === "tool_call") {
      const id = toolCallIdOf(step);
      if (id !== undefined) {
        if (seen.has(id)) continue;
        seen.add(id);
      }
      if (!current) {
        current = { toolCallCount: 0, parallelCallCount: 0 };
        turns.push(current);
      }
      current.toolCallCount += 1;
      current.parallelCallCount = current.toolCallCount;
    }
  }
  return turns;
}

/**
 * Session-level compatibility results for one (run, model). Filters the catalog to `level: "session"`
 * and scores each against the run's execution data. Returns `[]` for an unknown model.
 */
export function runSessionLevel(
  run: SessionRun,
  modelId: string,
  opts: SessionRunOpts = {},
): CompatibilityResult[] {
  const model = getModel(modelId);
  if (!model) return [];
  // Two session tests are excluded as not-yet-measurable rather than emitting a permanent `na`:
  //  - SESSION_TASK_SUCCESS_RATE: the mcp-builder agent-effectiveness eval (a future eval harness).
  //  - SESSION_RATE_LIMIT_THROUGHPUT: its threshold source `cross.providers.<provider>.input_tpm_tier`
  //    is modelled NOWHERE in the dataset (TPM is an account-tier limit, not a fixed model property),
  //    so it can only ever resolve to `na`. Re-add it here once an `input_tpm_tier` is modelled.
  const EXCLUDED = new Set(["SESSION_TASK_SUCCESS_RATE", "SESSION_RATE_LIMIT_THROUGHPUT"]);
  const tests = getCatalog().tests.filter((t) => t.level === "session" && !EXCLUDED.has(t.id));
  return tests.map((t) => toResult(t, run, modelId, evalSession(t, run, model, opts), opts));
}
