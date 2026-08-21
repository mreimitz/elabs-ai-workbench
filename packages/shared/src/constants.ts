import { GENERATED_MODEL_CONTEXT_LIMITS } from "./model-data.generated.js";

export const TRANSPORT_TYPES = ["stdio", "streamable_http"] as const;

export const SERVER_AUTH_TYPES = ["none", "bearer", "api_key", "oauth", "custom_headers"] as const;

// Server types (planning/Roadmap/completed/RM-21-server-types, D-ST1): lifecycle status lives ON the type (a named group of
// servers sharing one tool surface), not on individual servers. Ordered by "productionness".
export const SERVER_TYPE_STATUSES = [
  "production",
  "release_candidate",
  "beta",
  "deprecated",
] as const;

export const TOKEN_PROFILES = [
  // Real tiktoken BPE encodings (js-tiktoken, ranks bundled — encoding-accurate, offline).
  "generic_o200k", // o200k_base (GPT-4o / GPT-4.1 / o-series family)
  "generic_cl100k", // cl100k_base (GPT-4 / GPT-3.5 family)
  // Heuristics — explicitly named so nothing carrying a real-encoding name uses an estimate (#8).
  "generic_estimate", // lexical/byte-ratio estimate; a rough, tokenizer-agnostic approximation
  "raw_json_rough", // bytes/4 rough estimate over the stable-JSON serialization
] as const;

export const DEFAULT_TOKEN_PROFILE = "generic_o200k" as const;

// Token-counting methodology version, stamped onto every scan so a later change to HOW tokens are
// counted is detectable (scans with different versions are not directly comparable). Bump this
// whenever the counting method changes. History:
//   1 — pre-#8: byte-ratio/regex heuristic; per-tool total = SUM of isolated name/desc/schema facets.
//   2 — #8: real tiktoken BPE for the encoding profiles; per-tool total = tokens of the SERIALIZED
//       tool object (provider envelope + JSON structure), not the sum of isolated fields.
export const TOKEN_COUNTING_VERSION = 2;

// --- Cross-server / tool-level compare (north-star #4) ---------------------------------------

// Default fuzzy-match cutoff (0..1 Jaccard similarity over name+description tokens). Pairs at or
// above this score are treated as the "same" tool across two scans; below it they fall through to
// only-in-A / only-in-B. Shared so the API default and the web UI's slider agree.
export const DEFAULT_COMPARE_THRESHOLD = 0.6;

// --- Testing (runs) contract ---------------------------------------------------------------

// `claude_subscription` (planning/Roadmap/RM-09-claude-subscription/, WP 0.1) — the one kind that is NOT
// chat-completions-shaped: a selectable "model" that never goes through `modelFor()`/the AI-SDK loop, only through a dedicated
// executor (`claude-subscription-executor`, later WP) that branches at `RunService.execute()`. Auth
// resolves from the owner's SIGNED-IN Claude subscription (`assistant_credentials` — the same
// sign-in the embedded Assistant dock uses), never a `provider_credentials` API key. Cost is a
// reference estimate, not a metered charge (D-CS8: real token counts x Anthropic list price, "est. ·
// subscription" — see {@link CostBasis} in `types.ts`). D-CS6 naming lock: this literal is exactly
// `"claude_subscription"` — never bare `"assistant"` (collides with `apps/api/src/assistant/*`, the
// embedded dock) and never `"claude_cli"` (already `CLAUDE_CLI_PROVIDER_ID`, the Auto-Rating
// judge-chain provider id).
export const PROVIDER_KINDS = [
  "anthropic",
  "openai",
  "google",
  "openai_compatible",
  "ollama",
  "claude_subscription",
] as const;

// --- Provider-kind presentation (D-MI6, `planning/Roadmap/RM-16-model-identity/`) -----------------------------
// THE single source of truth for how a {@link ProviderKind} is shown to a human. Before this, five
// vocabularies disagreed — three `Record<ProviderKind, string>` maps (Settings, the Dashboard's
// testing metrics, the Hub's own `HUB_FAMILY_LABELS`) plus two views rendering the RAW kind literal —
// so the same provider read differently depending on which screen you were on.
//
// `billing` is the operator-facing answer to "does using this cost me money per token?" — the question
// behind the defect this workstream fixes (a subscription session silently billed to an API key). It is
// presentation only: it drives a badge, never a pricing calculation (that stays `pricing.ts`).

/** How usage of a provider kind is paid for — drives the model-picker billing badge (D-MI7). */
export const PROVIDER_KIND_BILLINGS = [
  /** Metered per token against an API key the owner supplies. */
  "metered_api_key",
  /** Covered by the owner's signed-in Claude subscription; marginal per-token cost is $0 (D-CS8). */
  "subscription",
  /** Runs on the owner's own hardware — no per-token charge. */
  "local",
] as const;

export type ProviderKindBilling = (typeof PROVIDER_KIND_BILLINGS)[number];

/** Structurally identical to `ProviderKind` in `types.ts`, derived locally because the dependency runs
 *  `types.ts -> constants.ts` (importing the type back would be a cycle). Both resolve to the same
 *  union, so a `Record<ProviderKind, …>` and a `Record<ProviderKindLocal, …>` are interchangeable. */
type ProviderKindLocal = (typeof PROVIDER_KINDS)[number];

export type ProviderKindMeta = {
  /** Full display name — nav, Settings cards, picker group headings. */
  label: string;
  /** Compact form for badges/chips where the full label would wrap. */
  shortLabel: string;
  /** `ModelSelectorLogo`'s `provider` slug (`@elabs-ai/components-ai`). It accepts a closed set of known slugs plus
   *  an arbitrary fallback string, so an unrecognized value renders a generic glyph rather than
   *  throwing. `claude_subscription` reuses the Anthropic mark — it IS Claude. */
  logoProvider: string;
  billing: ProviderKindBilling;
};

/**
 * Exhaustive `Record<ProviderKind, …>` **by design**: a newly-added {@link ProviderKind} must fail
 * `pnpm typecheck` here until it is classified. That is precisely what the old
 * `Record<string, string>` in `apps/api/src/hub/usage.ts` could not do — which is why
 * `claude_subscription` fell through it silently and subscription spend was reported as "Anthropic".
 *
 * **D-MI5 (owner decision, 2026-07-27):** `claude_subscription` is labelled **"Anthropic CLI"**.
 * Because "CLI" is also reserved for `CLAUDE_CLI_PROVIDER_ID` (the Auto-Rating judge provider — a
 * genuinely different thing, see the note above {@link PROVIDER_KINDS}), that judge's own display
 * string is qualified to **"Claude CLI judge"** at its call sites so the two never read as one
 * provider. The `claude_subscription` vs `claude_cli` IDENTIFIER lock is untouched by this — it is a
 * display-label decision only.
 */
export const PROVIDER_KIND_META: Record<ProviderKindLocal, ProviderKindMeta> = {
  anthropic: {
    label: "Anthropic",
    shortLabel: "Anthropic",
    logoProvider: "anthropic",
    billing: "metered_api_key",
  },
  openai: {
    label: "OpenAI",
    shortLabel: "OpenAI",
    logoProvider: "openai",
    billing: "metered_api_key",
  },
  google: {
    label: "Google",
    shortLabel: "Google",
    logoProvider: "google",
    billing: "metered_api_key",
  },
  openai_compatible: {
    label: "OpenAI-compatible",
    shortLabel: "Compatible",
    logoProvider: "openai_compatible",
    billing: "metered_api_key",
  },
  ollama: {
    label: "Ollama",
    shortLabel: "Ollama",
    logoProvider: "ollama",
    billing: "local",
  },
  claude_subscription: {
    label: "Anthropic CLI",
    shortLabel: "CLI",
    logoProvider: "anthropic",
    billing: "subscription",
  },
};

/** The display name for a provider kind — the ONE function every surface calls. */
export function providerKindLabel(kind: ProviderKindLocal): string {
  return PROVIDER_KIND_META[kind].label;
}

/** Short badge/chip form for a provider kind. */
export function providerKindShortLabel(kind: ProviderKindLocal): string {
  return PROVIDER_KIND_META[kind].shortLabel;
}

/** How a provider kind is paid for — drives the picker's billing badge, never a price calculation. */
export function providerKindBilling(kind: ProviderKindLocal): ProviderKindBilling {
  return PROVIDER_KIND_META[kind].billing;
}

/** Human label for a billing basis — the model picker's badge text. */
export const PROVIDER_KIND_BILLING_LABELS: Record<ProviderKindBilling, string> = {
  metered_api_key: "Metered",
  subscription: "Subscription",
  local: "Local",
};

export const RUN_MODES = ["automated", "interactive"] as const;

// --- Tool-loading mode (per-scenario MCP tool-footprint strategy) -----------------------------
// `eager`    — every allow-listed tool definition is loaded into the prompt prefix up front (the
//              classic full footprint; the only mode supported before this setting existed).
// `deferred` — tool definitions are withheld from the prefix and discovered on demand via an
//              Anthropic tool-search tool (per-tool `defer_loading`), so the resident `tool_defs`
//              footprint is ~0 until a tool is actually needed. Tool search is Anthropic-only and
//              not available on Haiku; for any other provider/model a deferred scenario transparently
//              falls back to eager at run time (the run surfaces a notice — it never fails).
export const TOOL_LOADING_MODES = ["eager", "deferred"] as const;

// Default for new scenarios. `eager` preserves the pre-setting behavior (and the meaning of every
// historical run, whose tools were always loaded eagerly); deferred is an explicit opt-in.
export const DEFAULT_TOOL_LOADING_MODE = "eager" as const;

export const RUN_STATUSES = [
  "pending",
  "running",
  "completed",
  "stopped",
  "error",
  "aborted",
  // Unified Sessions (planning/Roadmap/completed/RM-29-unified-sessions/, WP1.1, D-US2) — the terminal status of an INTERACTIVE
  // session the operator deliberately closed via the "End session" action. Additive + appended (never
  // reordered): an interactive session ends as `ended` (paired with outcome `ended`, stopReasonCode
  // `session_ended`), never fake-`completed` and never `aborted`. Every run persisted before this member
  // existed keeps its meaning; only the new End-session affordance produces it.
  "ended",
] as const;

export const RUN_OUTCOMES = [
  "completed",
  "stopped_guardrail",
  "context_overflow",
  "error",
  "aborted",
  // Additive (SkillFlow WP 5.1 follow-up, owner decision 2026-07-03): the run completed normally but
  // at least one skill-gate assertion failed. Engine outcomes above are never masked by it.
  "assertions_failed",
  // Unified Sessions (planning/Roadmap/completed/RM-29-unified-sessions/, WP1.1, D-US2) — the outcome partner of the `ended`
  // status: the operator ended an interactive session cleanly. Additive + appended.
  "ended",
] as const;

// --- Unified Sessions — session contract (planning/Roadmap/completed/RM-29-unified-sessions/, WP1.1) --------------------
// One shared lifecycle vocabulary every run backend (AI-SDK engine, Claude-subscription child) maps
// to, so the same cause ends the same way everywhere. All additive: old
// persisted runs/events carry none of these and replay unchanged.

// The MACHINE-READABLE terminal reason (closed union), carried alongside the existing HUMAN
// `stopReason` text on the `status` {@link RunEvent} member and persisted in `runs.stop_reason_code`
// (WP1.6). It retires `guardrailFromReason`'s string-sniffing (WP3.1) and is the single output the
// shared {@link terminalFor} table stamps. Membership is 1:1 with the executor-facing `TerminalCause`
// (apps/api/src/testing/session-terminal.ts). Additive/optional everywhere it appears.
export const STOP_REASON_CODES = [
  "user_stop", // operator pressed Stop → status `aborted`
  "session_ended", // operator ended an interactive session → status `ended`
  "max_duration", // opt-in wall cap elapsed → guardrail stop
  "stalled", // stall detector: no events for the stall window while running → guardrail stop
  "wait_expired", // wait budget exhausted while `waiting_input` → guardrail stop ("Expired")
  "max_turns", // budget meter
  "max_tokens", // budget meter
  "max_context_tokens", // budget meter
  "max_cost", // budget meter
  "context_overflow", // context window exceeded → outcome `context_overflow`
  "provider_error", // provider/transport failure → status `error`
  "auth", // auth/credential failure → status `error`
  "rate_limit", // 429 / rate limit → status `error`
  // WP1.7 — closes the WP1.1 contract gap flagged by `guardrails.ts`/`engine.ts`'s
  // `GUARDRAIL_TRIP_CAUSES`: the `maxToolCalls` budget meter previously had NO dedicated code (only
  // max_turns/max_tokens/max_context_tokens/max_cost did), so its guardrail stop carried no machine-
  // readable reason. Additive/appended, like every member above it.
  "max_tool_calls", // budget meter
] as const;

// A run's queryable, orthogonal lifecycle PHASE (D-US1) — persisted (nullable) in `runs.phase` (WP1.6)
// AND emitted as the additive `{type:"phase"}` {@link RunEvent} member. Running/terminal remain
// STATUSES; phase layers on top of them (a `running` run can be `waiting_input` or `stopping`, a
// `pending` run can be `queued`). Absent/null means "no distinct phase" (the plain status stands).
export const RUN_PHASES = [
  "queued", // pending, awaiting a concurrency permit (detail: queue position)
  "starting", // permit acquired, session spinning up
  "waiting_input", // running but paused on the operator (detail: next_turn | question); the clock pauses here
  "stopping", // terminal verdict written, child/stream being torn down
] as const;

// The `waiting_input` phase-detail discriminator: the session is blocked either awaiting the operator's
// next conversational turn, or awaiting an answer to an agent-initiated `ask_user` question.
export const WAITING_INPUT_REASONS = [
  "next_turn",
  "question",
  // Assistant Hub (WP2.3, R-MCP3/R-MCP4/R-UX1) — the two live HITL waits. `approval` = the session is
  // paused on an approval-gated tool call's `ApprovalCard`; `elicitation` = paused on an MCP
  // `elicitation/create` form/URL. Additive to the Unified-Sessions vocabulary (D-US7): both pause the
  // stall clock and arm the wait budget exactly like `next_turn`/`question`; older consumers that only
  // switch on the first two simply treat these as a generic `waiting_input`.
  "approval",
  "elicitation",
] as const;

// --- SessionCapabilities facet vocabularies (D-US4) --------------------------------------------
// A capability manifest is declared statically per backend adapter (apps/api/src/testing/
// session-capabilities.ts), runtime-verifiable, persisted as `capabilities_json` (WP1.6) and emitted
// at start, so the console renders what a run CAN DO instead of forking on `providerKind`.

// Whether/how a backend surfaces model reasoning: none or a raw text stream.
export const SESSION_LIVE_REASONING = ["none", "raw"] as const;

// Token-accounting fidelity: provider-reported exact, or not measurable.
export const SESSION_TOKEN_ACCOUNTING = ["exact", "none"] as const;

// How a run's cost figure should be read. Superset of {@link CostBasis} (the 2-member cost-derivation
// marker on runs/kpi events) plus the session-only basis `none` (no cost basis). Kept SEPARATE from
// `CostBasis` (which stays 2 members — its exhaustive consumers are unaffected);
// {@link SessionCostBasis} references it in `types.ts`.
export const SESSION_COST_BASES = ["api_exact", "subscription_reference", "none"] as const;

// Auto-Rating (AR11) — the post-run REVIEW axis: a NEW, additive dimension ORTHOGONAL to
// `RUN_STATUSES` / `SUITE_RUN_STATUSES` (rating never blocks or mutates a terminal status, so it is
// NEVER a new member of either status vocabulary). Applies to runs AND suite runs:
//   `pending` = terminal not reached yet, or terminal but the review has not started;
//   `rating`  = the post-terminal review (assertions + graders + issue folding / suite report) is running;
//   `rated`   = the review settled (its grade/report rows, where any apply, are persisted);
//   `failed`  = the review chain threw (swallowed — the run/suite result itself is untouched);
//   `skipped` = the review was not performed (auto-rating disabled / no grade service or suite-report
//               hook wired / the review was orphaned by a restart).
export const RATING_STATES = ["pending", "rating", "rated", "failed", "skipped"] as const;

// The SETTLED subset of `RATING_STATES` — once one of these is persisted + emitted, the review is
// over. The run/suite SSE streams close only after the terminal status AND a settled rating event.
export const SETTLED_RATING_STATES = ["rated", "failed", "skipped"] as const;

/** True when the rating axis has SETTLED (`rated` | `failed` | `skipped`). */
export function isSettledRatingState(state: (typeof RATING_STATES)[number]): boolean {
  return (SETTLED_RATING_STATES as readonly string[]).includes(state);
}

export const RUN_STEP_TYPES = [
  "llm_request",
  "llm_response",
  "tool_call",
  "tool_result",
  "context_event",
  // F6 — a user turn in the conversation stream (the opener prompt + each interactive follow-up).
  // Additive: lets the run console show the operator's own inputs, which were previously invisible.
  "user_message",
] as const;

// --- Observability — step-hierarchy span kinds (planning/Roadmap/RM-17-observability/, WP3.1, D-OB17) ------------
// A step's ROLE in the run's step TREE — a SEPARATE, additive classifier from {@link RUN_STEP_TYPES}
// (the wire/DB step `type`, which is UNCHANGED). `spanKind` is OPTIONAL on every step: a step persisted
// before WP3.1 carries none and renders FLAT (no backfill). Two families make up the union:
//   • roles of the EXISTING execution steps that act as tree PARENTS / grouping context —
//     `turn` (an assistant turn grouping its `llm_*`/`tool_*` steps), `tool_call` (the existing MCP
//     tool-call step that owns `tool_io` detail), `context_event` (a control/context step);
//   • the NEW child/span kinds this WP's emitters introduce — `tool_io` (per-call MCP request/response
//     detail under its `tool_call` step), `rating` (the auto-rating REVIEW span), `judge_call` (one LLM
//     judge invocation under a `rating` span), `probe` (a compatibility probe span).
// The tree is ALWAYS a rendering of `parentStepId` links over the flat, monotonic `index`/`idx`
// ordering — never a reordering. See {@link RunStep.parentStepId} / {@link RunStep.spanKind}.
export const SPAN_KINDS = [
  "turn",
  "tool_call",
  "tool_io",
  "rating",
  "judge_call",
  "probe",
  "context_event",
] as const;

export const CONTEXT_SEGMENTS = [
  "system",
  "tool_defs",
  "history",
  "tool_results",
  "output",
] as const;

// --- Observability — RunFilter grammar (planning/Roadmap/RM-17-observability/, WP1.1, D-OB1) -----------------
// The one serializable filter object the runs feed, saved views, chart drill-downs, watch rules and
// (later) the CLI all share. The TYPE + zod live in types.ts / schemas.ts; the parse/serialize +
// the pure `matchesRunFilter` predicate live in `run-filter.ts`. These constants pin the wire vocabulary.

// Canonical URL param carrying the JSON-serialized RunFilter (zod-parsed on the server). Web URL
// state and the API agree byte-for-byte by routing both through the `run-filter.ts` helper.
export const RUN_FILTER_PARAM = "filter" as const;

// Ergonomic scalar aliases: the common quick-filters may be passed as their own flat query params
// (comma-joined or repeated for the array fields) INSTEAD of the full `filter=` JSON. Anything the
// aliases don't cover is always expressible through `filter=`. Alias values overlay the JSON base.
export const RUN_FILTER_ALIAS_KEYS = [
  "testId",
  "scenarioId",
  "status",
  "suiteId",
  "suiteRunId",
  "collectionId",
  "q",
] as const;

// Sortable columns for `GET /api/runs?sort=<field>[:<asc|desc>]`. Each maps to a safe run column in
// the repository's SQL builder — NEVER string-interpolated from user input (indexes deferred to WP1.2).
// `tokens` = tokens_in + tokens_out; `durationMs` = the ACTIVE duration (activeDurationMs ??
// totalDurationMs, D-US3). Default sort stays `startedAt` DESC (today's behavior).
export const RUN_SORT_FIELDS = [
  "startedAt",
  "costUsd",
  "tokens",
  "durationMs",
  "peakContextTokens",
] as const;

export const RUN_SORT_DIRECTIONS = ["asc", "desc"] as const;

// --- Observability — metrics endpoints (planning/Roadmap/RM-17-observability/, WP1.2, D-OB13/D-OB14) ----------
// The time-axis aggregation vocabulary shared by `GET /api/metrics/runs` + `GET /api/metrics/scans`
// (computed ON DEMAND, no rollup cache). The wire TYPES live in types.ts; the query zod in schemas.ts.

// Time-bucket granularity. Buckets are floored in UTC (D-OB14 timezone honesty — see METRICS_TIMEZONE):
// `week` starts Monday 00:00:00 UTC (ISO-8601 week).
export const METRICS_BUCKETS = ["hour", "day", "week"] as const;

// The timezone every metrics bucket is floored in. Fixed to UTC so a day/week boundary is deterministic
// and reproducible regardless of server locale (acceptance #1 — timezone-safe day buckets).
export const METRICS_TIMEZONE = "UTC" as const;

// `GET /api/metrics/runs?groupBy=…` dimensions. `environment` is the UI label for the frozen `scenarioId`
// wire (runs.scenario_id); `provider` = the provider CREDENTIAL id; `providerKind` = its kind; `server`
// + `skill` FAN OUT (a run contributes to each of its servers/skills); a run lacking the group dimension
// (e.g. a standalone run grouped by `suite`) is OMITTED from that grouped result, never bucketed as null.
export const RUN_METRICS_GROUP_BY = [
  "model",
  "provider",
  "providerKind",
  "server",
  "environment",
  "suite",
  "test",
  "skill",
  "stopReasonCode",
] as const;

// `GET /api/metrics/runs?measures=…`. `p*DurationMs` are over the ACTIVE duration (activeDurationMs ??
// totalDurationMs, D-US3) — a series that fell back to totalDurationMs is MARKED (`durationFallback`).
// `feedbackRate` has NO backing store until
// WP1.5 — requesting it lists it in `unavailableMeasures` and emits no series (never a fake 0).
export const RUN_METRICS_MEASURES = [
  "count",
  "errorRate",
  "guardrailRate",
  "p50DurationMs",
  "p95DurationMs",
  "tokensIn",
  "tokensOut",
  "costUsd",
  "meanScore",
  "feedbackRate",
  // RM-33 (planning/Roadmap/RM-33-cache-aware-token-accounting/, WP 2.2) — the prompt-cache composition of
  // `tokensIn`, which stays GROSS. Before these, cached tokens could not be charted at all: the only
  // cache-aware surface in the app was a single per-run chart, so "is our cache hit rate degrading"
  // was an unanswerable question. Backed by the nullable v59 `runs` columns — a run whose split is
  // UNKNOWN is EXCLUDED from a bucket, never counted as zero (D-CT6).
  "cacheReadTokens",
  "cacheWriteTokens",
  "cacheHitRate",
] as const;

// D-OB14 (chart honesty) — the token/cost measures whose values must NEVER be blended across capability
// classes. Each returns ONE labelled series per capability class (`tokens` class for tokensIn/tokensOut;
// `costBasis` class for costUsd). The
// capability class is read from the run's persisted `capabilities_json` (a legacy run with none falls
// back to the STATIC per-kind manifest — never a `providerKind === …` fork in the aggregation).
export const CAPABILITY_SPLIT_MEASURES = [
  "tokensIn",
  "tokensOut",
  "costUsd",
  // RM-33 — token measures in the same `tokens` capability class as tokensIn/tokensOut, so D-OB14's
  // no-blending rule applies to them identically. `cacheHitRate` is deliberately NOT here: it is a
  // ratio, and follows the `errorRate` precedent of a single unlabelled series.
  "cacheReadTokens",
  "cacheWriteTokens",
] as const;

// --- Observability — custom chart composer (planning/Roadmap/RM-17-observability/, WP2.7, D-OB22) --------------
// User-defined charts on the Testing dashboard (`dashboard_charts`, migration v45): measure(s) +
// filter + group-by + chart type, persisted + cloneable. The config surface is DELIBERATELY SMALL
// (this is not a BI tool) and renders ONLY what the WP1.2 metrics services (`computeRunMetrics`/
// `computeScanMetrics`, called UNMODIFIED) already return — no client-side aggregation.

export const DASHBOARD_CHART_TYPES = ["line", "bar", "stacked"] as const;
export const DASHBOARD_CHART_SOURCES = ["runs", "scans"] as const;
export const DASHBOARD_CHART_NAME_MAX_LENGTH = 200;
// A chart may carry more than one measure ONLY when every measure shares the same UNIT (see the two
// *_MEASURE_UNITS maps below) — the same-unit constraint (D-OB14's honesty companion: never imply a
// shared axis across incompatible units, e.g. tokens + a USD cost). Capped small on top of that —
// this isn't a BI tool.
export const DASHBOARD_CHART_MAX_MEASURES = 4;

// The `source: "scans"` measure vocabulary — the `ScanMetricsPoint` fields a chart may plot
// (`computeScanMetrics`, called unmodified). No `groupBy`: `computeScanMetrics` is already grouped by
// (server, tokenProfile); a scans chart may optionally scope to one `serverId` instead.
export const DASHBOARD_CHART_SCAN_MEASURES = [
  "scanCount",
  "failureRate",
  "totalTokens",
  "toolTokens",
  "resourceTokens",
  "promptTokens",
  "totalTools",
  "totalResources",
  "totalResourceTemplates",
  "totalPrompts",
] as const;

// The UNIT each `source: "runs"` measure belongs to — the same-unit constraint: a multi-measure chart
// is valid only when every selected measure maps to the SAME unit here. Mixed-unit combos (e.g.
// `tokensIn` + `costUsd`) are rejected at write with a 400 (never a fabricated shared axis). Note this
// is INDEPENDENT of D-OB14's capability-class split (`tokensIn`/`tokensOut`/`costUsd`/`questions` keep
// splitting into their own labelled series regardless of chart config — enforced by the API, not here).
export const RUN_METRICS_MEASURE_UNITS: Record<(typeof RUN_METRICS_MEASURES)[number], string> = {
  count: "count",
  errorRate: "rate",
  guardrailRate: "rate",
  p50DurationMs: "ms",
  p95DurationMs: "ms",
  tokensIn: "tokens",
  tokensOut: "tokens",
  costUsd: "usd",
  meanScore: "score",
  feedbackRate: "rate",
  cacheReadTokens: "tokens",
  cacheWriteTokens: "tokens",
  cacheHitRate: "rate",
};

// The UNIT each `source: "scans"` measure belongs to — same-unit constraint, mirrors
// RUN_METRICS_MEASURE_UNITS above.
export const DASHBOARD_CHART_SCAN_MEASURE_UNITS: Record<
  (typeof DASHBOARD_CHART_SCAN_MEASURES)[number],
  string
> = {
  scanCount: "count",
  failureRate: "rate",
  totalTokens: "tokens",
  toolTokens: "tokens",
  resourceTokens: "tokens",
  promptTokens: "tokens",
  totalTools: "count",
  totalResources: "count",
  totalResourceTemplates: "count",
  totalPrompts: "count",
};

// --- Observability — full-text search (planning/Roadmap/RM-17-observability/, WP1.3, D-OB16) -------------------
// The FTS5 index over run content (`run_search`) is populated at persistence time, backfilled once,
// queried through the RunFilter `q` field, and rebuildable via `POST /api/maintenance/reindex-search`.
// It is DERIVED state (conventions §1) — every indexed document is reconstructable from
// `runs`/`run_steps`/`run_grades`, so losing it never loses truth (reindex restores it fully).

// The content classes indexed per run (D-OB16). The `kind` column each `run_search` row carries, and
// the `matchKind` returned alongside a search hit's snippet:
//   • prompt      — user prompts (the test opener + each interactive `user_message` turn)
//   • assistant   — assistant / answer prose (per-turn `llm_response` text)
//   • tool        — tool name + serialized call arguments
//   • tool_result — tool result TEXT only (base64 / binary payloads are skipped, see below)
//   • error       — the human `stopReason` + tool-level error strings
//   • rating      — the judge verdict text + forensics summaries / fix targets (from `run_grades`)
//   • meta        — run title (test name), environment (scenario) name, model id
export const SEARCH_CONTENT_CLASSES = [
  "prompt",
  "assistant",
  "tool",
  "tool_result",
  "error",
  "rating",
  "meta",
] as const;

// Per-class truncation caps (CHARACTERS) applied before a document is written to the FTS index — so a
// pathologically large field indexes only its cap, never bloating the index (D-OB16). `prompt`/
// `assistant` are ≤2 kB/field; `tool`/`tool_result` are ≤1 kB; `error`/`rating` get the 2 kB budget;
// `meta` is small. The caps live HERE (the wire contract) so the API and any future consumer agree.
export const SEARCH_CONTENT_LIMITS: Record<(typeof SEARCH_CONTENT_CLASSES)[number], number> = {
  prompt: 2048,
  assistant: 2048,
  tool: 1024,
  tool_result: 1024,
  error: 2048,
  rating: 2048,
  meta: 512,
};

// Stamp for the one-shot backfill marker (persisted in `app_settings` under `search_index`). Bump this
// when the indexed CONTENT shape changes so the next startup re-backfills existing runs once.
export const SEARCH_INDEX_VERSION = 1;

// --- Observability — saved views (planning/Roadmap/RM-17-observability/, WP1.4) --------------------------------
// A saved view names a {@link RunFilter} for reuse (the runs feed, WP2.3, and deep links). Only the
// name + filter carry API-enforced semantics (uniqueness, the RunFilter zod); `columns`/`sort` are
// opaque presentation hints the web UI owns — the API bounds their SERIALIZED byte size (a zip-bomb-
// style guard, the SKILL_MAX_* pattern) without interpreting their shape.
export const RUN_VIEW_NAME_MAX_LENGTH = 200;
// Cap on each of the serialized `columns`/`sort` JSON blobs (independently), generous for a column
// list / sort spec while rejecting an accidental (or abusive) multi-MB payload.
export const RUN_VIEW_PRESENTATION_MAX_BYTES = 20 * 1024; // 20 KB

// --- Observability — watch rules (planning/Roadmap/RM-17-observability/, WP4.1, D-OB19/D-OB21) ------------------
// "When a run matches filter F, do action A", evaluated at the ONE post-terminal choke point. The
// action `type`s are a CLOSED set; the trigger + severity vocabularies are frozen enums. Rules are
// strictly post-hoc OBSERVERS — see the {@link WatchRule} type doc.
export const WATCH_RULE_TRIGGERS = ["on_terminal", "windowed"] as const;
export const WATCH_NOTIFY_SEVERITIES = ["info", "warning", "critical"] as const;
export const WATCH_ACTION_TYPES = [
  "notify",
  "pin",
  "add_to_collection",
  "promote_to_test",
  "run_grader",
  "webhook",
] as const;
// A rule name length guard + a cap on the number of actions a single rule may carry (defensive; a
// rule with hundreds of actions is almost certainly a mistake and would fan out audit rows).
export const WATCH_RULE_NAME_MAX_LENGTH = 200;
export const WATCH_RULE_MAX_ACTIONS = 20;
// A generous cap on a webhook JSON `template` string (rejects an accidental multi-MB payload).
export const WATCH_TEMPLATE_MAX_BYTES = 16 * 1024; // 16 KB
// The bounded timeout (ms) for a webhook POST — a slow/hung endpoint can never stall the run
// pipeline (the post-terminal review awaits the observer; this keeps that wait bounded).
export const WATCH_WEBHOOK_TIMEOUT_MS = 10_000;

// --- Observability — windowed watch rules (planning/Roadmap/RM-17-observability/, WP4.2, D-OB19) ----------------
// A `windowed` rule (`WatchRuleTrigger` = "windowed") carries a `WatchWindowConfig`: a threshold
// over a trailing, grid-ALIGNED time window ("error rate > 30% over 6h", "cost today > $5"). The
// measure vocabulary is the SINGLE SOURCE (RUN_METRICS_MEASURES) — there is NO second aggregation
// path; the windowed evaluator calls the WP1.2 metrics SERVICE (computeRunMetrics) and reads back one
// point per window (each window is aligned so it collapses to exactly ONE metrics bucket → the value
// is the service's own, correct even for percentiles).
//
// The four supported trailing-window widths. Each aligns to a UTC grid so a completed window maps to a
// single metrics bucket: 1h → the hour grid (bucket "hour"); 6h → the 0/6/12/18 UTC grid (bucket
// "day"); 24h → the day grid (bucket "day"); 7d → the ISO-week grid, Monday 00:00 UTC (bucket "week").
export const WATCH_WINDOW_DURATIONS = ["1h", "6h", "24h", "7d"] as const;
// The comparison a windowed threshold uses: value `op` threshold → breach. `>=` (e.g. error rate,
// cost, duration exceeded) and `<=` (e.g. meanScore dropped to/below a floor).
export const WATCH_WINDOW_OPS = [">=", "<="] as const;
// The scheduler ticker's default evaluation cadence (every 5 minutes). Overridable per-instance (a
// test injects a fake timer + drives ticks directly, so it never waits real time).
export const WATCH_SCHEDULER_DEFAULT_INTERVAL_MS = 5 * 60_000;
// Preview (`POST /api/watch-rules/preview`): how many trailing completed windows to score by default,
// and the hard cap (bounds the metrics calls a single preview makes).
export const WATCH_PREVIEW_DEFAULT_WINDOWS = 24;
export const WATCH_PREVIEW_MAX_WINDOWS = 168; // e.g. a week of hourly windows
// Boot catch-up bound (D-OB19): if the app was away long enough that MORE than this many windows
// completed, evaluate only the most recent this-many — the older gap is still recorded (audit shows
// the gap), never silently pretended-continuous.
export const WATCH_CATCHUP_MAX_WINDOWS = 168;
// Guard on a windowed rule's cooldown (minutes) — 0 = re-fire every breaching window; capped so an
// accidental huge value can't be stored. A week is plenty for a "remind me again" cadence.
export const WATCH_COOLDOWN_MAX_MINUTES = 7 * 24 * 60;

// --- Observability — watch-rule severity / state semantics (RM-17 Phase 6, AM-OB10) ---------------
// Three gaps the shipped WP4.1/WP4.2 engine left open, closed additively:
//   (a) ONE threshold with no severity on it → an optional WARNING threshold BELOW the ALERT one;
//   (b) an EMPTY window scored as `breached:false` and therefore recorded as RECOVERY — a bench that
//       goes silent while a rule is firing read as good news → an explicit NO-DATA outcome + policy;
//   (c) an `on_terminal` rule had NO suppression at all (50 failing runs → 50 notifications) → an
//       optional minimum interval between action dispatches.
// Nothing here adds a second severity vocabulary: `WATCH_NOTIFY_SEVERITIES` above stays the only one.

/** What a windowed rule does when its window contained NO runs at all.
 *  - `hold`   — neither fire nor recover; the rule keeps whatever state it was in (the DEFAULT, and
 *               the only policy that cannot lie in either direction);
 *  - `ok`     — treat an empty window as "below threshold" (the pre-AM-OB10 behaviour, kept as an
 *               EXPLICIT opt-in rather than as an accident);
 *  - `notify` — an empty window IS the signal; dispatch the rule's actions (subject to the same
 *               arm/cooldown machine a breach uses). */
export const WATCH_NO_DATA_POLICIES = ["hold", "ok", "notify"] as const;
/** The policy an existing rule (and any rule that does not choose) resolves to. */
export const WATCH_DEFAULT_NO_DATA_POLICY = "hold";
/** The two severity LEVELS a threshold crossing can reach. `alert` is the rule's `threshold`; `warn`
 *  is the optional, strictly-less-severe `warnThreshold`. This is NOT a severity vocabulary — it is
 *  resolved INTO `WATCH_NOTIFY_SEVERITIES` (a `warn` crossing demotes the action's severity by one). */
export const WATCH_WINDOW_LEVELS = ["warn", "alert"] as const;
/** The outcome of scoring ONE window — what the evaluator decided and what the preview reports. */
export const WATCH_WINDOW_STATES = ["no_data", "ok", "warn", "alert"] as const;
/** Guard on an `on_terminal` rule's minimum interval between action dispatches (minutes); mirrors
 *  {@link WATCH_COOLDOWN_MAX_MINUTES}, which is the windowed equivalent. */
export const WATCH_MIN_INTERVAL_MAX_MINUTES = 7 * 24 * 60;
/** The pause durations the rules list offers ("stop telling me until…", 1h / 4h / 24h). A pause is a
 *  timestamp, so it expires on its own — there is no sweep and no state to un-stick. */
export const WATCH_PAUSE_PRESET_MINUTES = [60, 240, 1440] as const;

/** Audit markers this WP adds beside the shipped `window_fire`/`window_recover`/`window_catchup`/
 *  `sampled_out`/`test_fire`/`error` rows. `watch_rule_events.action` is deliberately NOT
 *  CHECK-constrained (see `db/schema.ts`), so a new marker is a zero-migration change — and
 *  {@link WATCH_MARKER_WINDOW_NO_DATA} is deliberately NOT one of the two markers the repository's
 *  `getWindowState` re-seeds from, which is what makes the `hold` policy hold. */
export const WATCH_MARKER_WINDOW_NO_DATA = "window_no_data";
/** Recorded when a PAUSED rule reached the point where it would have dispatched actions. */
export const WATCH_MARKER_PAUSED = "paused";
/** Recorded when an `on_terminal` rule matched but its minimum interval had not elapsed. */
export const WATCH_MARKER_RATE_LIMITED = "rate_limited";

// --- Observability — notification center (planning/Roadmap/RM-17-observability/, WP4.3, D-OB19) -----------------
// The persistent in-app notification center the `notify` watch action (WP4.1, unblocked here) writes
// to — the bell in the AppShell reads/streams these. Severities are the SAME closed vocabulary as
// `WATCH_NOTIFY_SEVERITIES` above (a notification's severity IS the firing action's severity — no
// second enum). `GET /api/notifications` is paged; these bound one call's page size.
export const NOTIFICATION_LIST_DEFAULT_LIMIT = 50;
export const NOTIFICATION_LIST_MAX_LIMIT = 200;
// Default retention for `POST /api/maintenance/prune-notifications` (`?days=` overrides). Only READ
// notifications older than this are pruned — an UNREAD notification is never a prune victim regardless
// of age (an operator must see an alert at least once before it can be swept).
export const NOTIFICATION_RETENTION_DAYS_DEFAULT = 30;

// --- Observability — scheduled digest report (planning/Roadmap/RM-17-observability/, WP5.5, D-OB22) --------------
// The "since your last visit" briefing: a daily/weekly window-over-window comparison persisted as a
// report artifact (JSON + Markdown), delivered as a quiet `info` notification. RIDES the WP4.2
// scheduler (an additive `onDigest` tick) — settings live in `app_settings` under
// {@link APP_SETTING_DIGEST_SCHEDULE_KEY}, mirroring how the WP1.3 judge default is stored.

/** The two supported digest cadences — each aligns its window to a UTC calendar boundary (daily =
 *  midnight UTC; weekly = Monday 00:00 UTC, the SAME Monday-start the metrics `week` bucket uses). */
export const DIGEST_WINDOW_KINDS = ["daily", "weekly"] as const;
/** The persisted schedule's mode — `off` disables the scheduler tick entirely (manual generation via
 *  `POST /api/reports/digest/generate` still works). */
export const DIGEST_SCHEDULE_MODES = ["off", ...DIGEST_WINDOW_KINDS] as const;
/** The `app_settings` key the digest schedule (mode + hourUtc) is stored under. */
export const APP_SETTING_DIGEST_SCHEDULE_KEY = "digest_schedule";
/** Default trigger hour (UTC) when no schedule has been saved yet — a digest for a completed
 *  calendar day/week becomes due this many hours past the boundary (gives the day's last runs time
 *  to land before the digest is generated). */
export const DIGEST_SCHEDULE_DEFAULT_HOUR_UTC = 8;
/** Boot catch-up bound (mirrors {@link WATCH_CATCHUP_MAX_WINDOWS}, D-OB19) — if the app was away long
 *  enough that more than this many digest windows completed, generate only the most recent this-many
 *  (each flagged `late`); the older gap is never silently backfilled. Kept small — a digest is a much
 *  heavier artifact than a notification. */
export const DIGEST_CATCHUP_MAX_WINDOWS = 8;
/** How many entries each "top movers" list (issues / server-model-suite movers / notable runs) carries
 *  in a digest — a briefing, not a dashboard dump (WP5.5 NOTES). */
export const DIGEST_TOP_N = 5;
/** Default retention for `POST /api/maintenance/prune-digests` (`?days=` overrides), mirroring
 *  `NOTIFICATION_RETENTION_DAYS_DEFAULT`'s convention. */
export const DIGEST_RETENTION_DAYS_DEFAULT = 180;

// --- Skills (Agent Skill registry + versioning) — Phase 1 contract ---------------------------
// A skill comes either from a direct zip upload or a GitHub repo/ref/subpath pull.
export const SKILL_SOURCE_TYPES = ["upload", "github"] as const;

// How a file inside a skill is classified (drives the file tree + token accounting levels):
// `skill_md` = the SKILL.md manifest body (L2); `reference` = other text docs (L3); `script` =
// executable helpers (surfaced but never run); `asset` = binary/media; `other` = anything else.
export const SKILL_FILE_KINDS = ["skill_md", "reference", "script", "asset", "other"] as const;

// How an attached skill (Phase 2 scenario attachment) selects its version: track `latest` (resolves
// at run time to the skill's current version) or `pinned` (a fixed, reproducible version id).
export const SKILL_VERSION_MODES = ["latest", "pinned"] as const;

// Ingest size caps (zip-bomb guard). Enforced at import time — the app never executes skill content.
export const SKILL_MAX_FILE_BYTES = 5 * 1024 * 1024; // 5 MB per file
export const SKILL_MAX_TOTAL_BYTES = 50 * 1024 * 1024; // 50 MB per skill version (whole tree)
export const SKILL_MAX_FILES = 2000; // file-count cap per skill version

// --- SkillFlow (graph IR + trace vocabulary + session-trace) — Phase 1 contract (WP 1.0) ------
// The three shared shapes SkillFlow hangs off. SkillFlow is process-mining for Agent Skills: a
// design-time graph projected from SKILL.md is conformance-checked against a session event log.
// Everything here is a wire/contract vocabulary; projection + alignment (deterministic, no model
// calls) land in later WPs. See planning/Roadmap/RM-23-skillflow/00-architecture.md ("The three schemas") + D2/D6/D8.

// Node kinds for the skill graph IR. Aligned with (not a parallel taxonomy to) `SKILL_FILE_KINDS`
// (D8): `subroutine` = an ordered heading/section; `asset` = a bundled-file reference; `gatekeeper`
// = an explicit decision/branch; `validation_gate` = a script + exit-code/verification check;
// `loop_guard` = a repeat/retry construct with an iteration ceiling; `entry_point` = the head of a
// flow (a /command or a keyword trigger — Skill IDE WP 1.1/I1). `entry_point` is additive: existing
// zero-command skills still project one `main` flow with no entry-point node (no regression).
// `tool_ref` (Skill IDE WP 8.1/I9.2) = an accessory leaf citing an MCP tool a section references,
// projected from TEXT EVIDENCE ALONE (the conservative extraction heuristic — never a scan read);
// additive, so a skill with zero tool references projects with no `tool_ref` node (regression-locked).
export const SKILL_GRAPH_NODE_KINDS = [
  "gatekeeper",
  "subroutine",
  "asset",
  "validation_gate",
  "loop_guard",
  "entry_point",
  "tool_ref",
] as const;

// How a node/edge entered the graph: `inferred` from document structure/prose (the D2 inference-first
// default — every skill yields a graph with zero markup), or `annotated` from an in-file
// `<!-- skillflow:… -->` HTML comment that refines the inference (never required, inert to the agent).
export const SKILL_GRAPH_SOURCES = ["inferred", "annotated"] as const;

// The normalized trace-event vocabulary (D6) — the alphabet the trace normalizer speaks over this
// app's own internal `run_steps` (Phase 2). A `skill_file_read` is a read of a bundled file (drives
// asset-node visits); a `script_result` carries an exit code (drives validation-gate verdicts); a
// `marker` is the optional breadcrumb an agent emits at a gatekeeper. The vocabulary is deliberately
// source-agnostic — a `script_result`/`subagent_spawn`/`marker` may be synthesized by tests/fixtures.
export const TRACE_EVENT_TYPES = [
  "turn",
  "tool_call",
  "tool_result",
  "skill_file_read",
  "script_result",
  "subagent_spawn",
  "marker",
  "user_message",
] as const;

// A per-node / per-edge conformance verdict from the aligner: `ok` = executed as designed;
// `fracture` = a conformance break (failed gate, misroute, loop over threshold); `unvisited` = the
// design node/edge was never reached in this session.
export const TRACE_VERDICT_STATUSES = ["ok", "fracture", "unvisited"] as const;

// WP 3.2 — a verdict's evidentiary confidence: `exact` when its evidence cites a `marker` or
// `script_result` event (deterministic hard evidence — an explicit breadcrumb naming the gate/route,
// or an observed script exit code), `inferred` otherwise (downstream-implication gatekeeper reasoning,
// asset/tool-error degradation, or any verdict on a marker-less trace). Additive on `TraceVerdict`.
export const TRACE_VERDICT_CONFIDENCE = ["exact", "inferred"] as const;

// Where a trace came from. Trace Mode sources are ONLY this app's own test runs (scenarios with the
// skill attached) — owner decision 2026-07-03 removed external session-JSONL upload. Kept as a
// single-member union (rather than inlining the `"run"` literal) so re-adding an app-internal source
// later stays a one-line additive change to this contract.
export const TRACE_SOURCES = ["run"] as const;

// --- SkillFlow validation-gate assertions (WP 5.1) — `tests.assertions_json` vocabulary (D8) ----
// Gate expectations become first-class test assertions, evaluated ONLY from a run's trace alignment
// (D4: zero new execution surface). Reuses the reserved `tests.assertions_json` column, not a
// parallel assertion format.

// What a `skillGates` assertion expects of the referenced node's alignment verdict: `pass` = the node
// executed as designed (verdict `ok`, and — for a validation_gate — genuinely reached, not merely
// unvisited); `visited` = the node was reached at all (verdict != `unvisited`).
export const SKILL_GATE_EXPECTATIONS = ["pass", "visited"] as const;

// Per-assertion evaluation status: `pass`/`fail` are honest verdicts derived from the alignment;
// `unevaluable` marks a MISCONFIGURED assertion (skill not attached to the run, or a node/edge id not
// present in that version's graph) — surfaced, never silently passed or failed, and never fails a run.
export const ASSERTION_RESULT_STATUSES = ["pass", "fail", "unevaluable"] as const;

// The assertion kinds a `TestAssertions` can carry (the discriminant of an `AssertionResult`'s echoed
// `assertion`): a per-node gate expectation, a gatekeeper route expectation, or the run-wide
// no-fractures check.
export const ASSERTION_KINDS = ["skillGate", "skillRoute", "noFractures"] as const;

// Version stamps mirroring `TOKEN_COUNTING_VERSION`: alignments computed under different projector /
// aligner algorithm versions are never silently compared (bump when the algorithm changes).
export const SKILLFLOW_PROJECTOR_VERSION = 4;
// Bumped 1 -> 2 in WP 3.2: every verdict now carries the additive `confidence` field ('exact' vs
// 'inferred') and gatekeeper verdicts are exact-matched against breadcrumb markers end-to-end (both
// normalizers now emit `marker` events) — a real change to what a `TraceAlignment`'s verdicts MEAN,
// not just a wire-shape addition, so alignments computed under v1 (no confidence) must never be
// silently compared against v2 ones (conventions.md's stamping rule).
export const SKILLFLOW_ALIGNER_VERSION = 2;
// Bumped -> 3 in Skill IDE WP 1.2: the projector now emits per-command `entry_point` nodes, assigns
// every node/edge a `flowId` (each /command owns a flow; the body stays `'main'`), populates
// `SkillGraph.flows`, and projects frontmatter `keywords:` as keyword entry points on the main flow.
// Flow semantics change what a graph MEANS, so graphs projected under an older version must never be
// silently compared. A zero-command skill still projects identically modulo the additive
// `flowId:'main'`/`flows:[main]` delta (regression-locked in skill-ide-projector.test.ts).
// Bumped -> 4 in Skill IDE WP 8.1 (I9.2): sections that reference an MCP tool (the conservative
// text-extraction heuristic, shared with WP 5.1's validator) now project an accessory `tool_ref` leaf
// node + a `calls` edge from the referencing section — TEXT EVIDENCE ONLY (the projector never reads
// scans). A skill with zero tool references projects IDENTICALLY to v3 (no new nodes/edges), so the
// bump only guards graphs that actually cite tools (regression-locked in skill-ide-projector.test.ts).

// The prefix that marks an in-file SkillFlow annotation, e.g. `<!-- skillflow:gate id=check-output -->`.
export const SKILLFLOW_ANNOTATION_PREFIX = "skillflow:";

// WP 3.2 — the breadcrumb marker convention (D7b, planning/Roadmap/RM-23-skillflow/breadcrumb-convention.md): a
// single bracketed line an agent emits in its own prose at a gatekeeper decision, e.g.
// `[skillflow:gate=route-input route=r-csv]`. This is the regex SOURCE (no flags — callers compile
// it with `g`/`i` as needed) so both trace normalizers (`run-trace.ts`, `session-ingest.ts`) and the
// shared matcher (`markers.ts`) parse the exact same syntax: `[skillflow:` + arbitrary inner content
// up to the closing `]`, which the matcher then splits into whitespace-separated `key=value` tokens
// (tolerant of spaces around `=`) — `gate=` -> gateId, `route=` -> routeId, any other/malformed
// content keeps the raw match with no ids (never a parse error).
export const SKILLFLOW_MARKER_PATTERN = "\\[\\s*skillflow:([^\\]]*)\\]";

// Default loop-detection threshold: how many visits to the same node before the aligner flags a
// loop-guard fracture (unless a `loop_guard` node's own `maxIterations` overrides it).
export const DEFAULT_LOOP_THRESHOLD = 3;

// The graph-level edit-operation vocabulary (Phase 4, WP 4.1 — the write half of Design Mode).
// Each op targets a projected node/edge by id and is applied to SKILL.md through the node's anchor
// (heading path + line range), preserving every untouched byte (D5). The result is always a NEW
// immutable version via the existing ingest path — never an in-place blob mutation.
export const SKILL_EDIT_OP_TYPES = [
  "rename_node",
  "update_section_body",
  "add_subroutine",
  "remove_node",
  "reorder",
  "set_edge_condition",
  "add_asset_ref",
  "set_gate_expectation",
  "set_annotation",
  // Skill IDE WP 1.1 (I2/I3) — the IDE op vocabulary. Types only land here; the SEMANTICS
  // (anchored text edits + tree ops → new immutable version) arrive in later WPs: command ops in
  // WP 2.1, trigger/keyword + asset ops in WP 3.1, file/tree ops in a later workspace WP. Until
  // then `validateEditOps` rejects them with an explicit "not yet implemented" 400 (never a silent no-op).
  "add_command",
  "rename_command",
  "delete_command",
  "set_keywords",
  "connect_asset",
  "disconnect_asset",
  "add_file",
  "update_file",
  "rename_file",
  "delete_file",
  // Skill IDE WP 8.1 (I9.3) — reference an MCP tool from a section. Types/zod land here; the SEMANTICS
  // (append a reference sentence to the target section's body → new immutable version) arrive in WP 8.3.
  // Until then `validateEditOps` rejects it with an explicit "not yet implemented" 400 (never a silent no-op).
  "add_tool_ref",
] as const;

// The `source_ref` stamped on skill versions created by the SkillFlow edits route
// (`POST /api/skills/:id/versions/:vid/edits`) — distinguishes graph edits from real uploads
// (which never set `source_ref`) and from blank scaffolds (`source_ref = 'blank'`).
export const SKILLFLOW_EDIT_SOURCE_REF = "skillflow-edit";

// The `source_ref` stamped on a version created by restoring an OLDER version as the new latest
// (`POST /api/skills/:id/versions/:vid/restore`). A restore is a NON-destructive re-point: it copies
// the chosen version's tree into a NEW head version (seq = MAX+1) and leaves every in-between version
// intact — nothing is deleted. This ref (plus the version's `note`, "Restored from v{seq}") lets the
// history distinguish a restore from an upload / GitHub pull / SkillFlow graph edit / assistant edit.
export const SKILL_RESTORE_SOURCE_REF = "restore";

// Assistant WP 2.2 (D-AS13) — the `source_ref` stamped on skill versions created by the assistant's
// `skills_commit_workspace` tool (agent edits a skill's files in a materialized workspace, then commits
// the tree). Mirrors `SKILLFLOW_EDIT_SOURCE_REF` so the version history can distinguish an assistant
// edit from an upload/GitHub pull/SkillFlow graph edit.
export const ASSISTANT_EDIT_SOURCE_REF = "assistant-edit";

// --- SkillFlow feedback loop (WP 5.2) — fracture verdicts → suggested SKILL.md edits ------------
// Deterministic rules ONLY (D7's LLM-assisted branch is owner-gated and NOT approved — no model
// calls anywhere in this feature). Each rule is keyed off verdict STRUCTURE (status/nodeId/edgeId/
// confidence), not reason-string parsing, wherever the graph/alignment already carries the needed
// datum. A rule may produce an ADVISORY suggestion (`ops: []`) when it has something useful to say
// but nothing safe to auto-draft — the UI renders those without an "apply" button. "No suggestion"
// for a verdict with no matching rule is a valid, expected output (never invented).
export const SKILLFLOW_SUGGESTION_RULES = [
  // A gatekeeper whose verdict confidence is 'inferred' (no marker evidence anywhere in the trace) —
  // suggests pinning its id (if unannotated) + appending the WP 3.2 breadcrumb instruction sentence.
  "missing-breadcrumbs",
  // A loop-guard fracture (or a non-guarded node's over-visit fracture) — suggests appending a
  // bounded-retry sentence to the governing section's body.
  "loop-detected",
  // An asset node stuck 'unvisited' while its referencing section verdict is 'ok' — advisory only.
  "asset-never-visited",
  // A validation_gate fracture backed by real exit-code (script_result) evidence — advisory only
  // (SkillFlow won't guess whether the script or the expectation is wrong).
  "gate-failed-consistently",
  // A gatekeeper fracture from a marker naming a route that matches no real outgoing edge — advisory
  // only (the named route is provably bogus; there's no deterministic candidate condition to write).
  "marker-route-mismatch",
] as const;

// --- Skill IDE WP 4.2 — STATIC (trace-less) optimization-suggestion rules -----------------------
// A SEPARATE vocabulary from the trace `SKILLFLOW_SUGGESTION_RULES` above: these fire purely from a
// version's projected graph + file tree + token footprint (no run/alignment needed), so the static
// route (`GET …/suggestions` WITHOUT runId) surfaces them. Kept distinct from the trace rules on
// purpose — a static suggestion is footprint/graph-keyed, not verdict-keyed — so the web's total
// `Record<SkillSuggestionRule, …>` over the trace rules stays exhaustive and untouched. Same
// no-corruption discipline as the trace engine: a rule with real, drafted `SkillEditOp[]` ops has
// them validated (`validateEditOps`) before emission, else it is downgraded to advisory (`ops: []`).
export const SKILLFLOW_STATIC_SUGGESTION_RULES = [
  // L2 body over the quality ceiling → move the largest section's body out to `reference/<slug>.md`
  // (real ops: `add_file` the reference + `update_section_body` to a pointer). WP 3.1 landed the tree
  // ops, so this ships with real ops, not advisory-only.
  "split-oversized-body",
  // Frontmatter `keywords:` contains duplicates (case-insensitive) → replace the set with the deduped
  // list (real op: `set_keywords`).
  "dedupe-keywords",
  // A bundled file referenced by no section / gate script → advisory only (removing a file is an
  // authoring judgment call; the UI decides, the engine won't `delete_file` on its own).
  "remove-unused-asset",
  // L1 metadata (name + description) over the quality ceiling → advisory only (tightening prose is an
  // authoring judgment call; there is no single deterministic rewrite to draft).
  "tighten-description",
] as const;

// --- Skill IDE — Phase 1 contract (WP 1.1) -----------------------------------------------------
// The additive contract layer the Skill IDE plan hangs off (planning/Roadmap/RM-22-skill-ide/00-architecture.md,
// I1–I8). Everything here is ADDITIVE — existing SkillFlow consumers compile unchanged. The engines
// that CONSUME these shapes (quality, tool validation, publisher) land in later WPs; WP 1.1 freezes
// the vocabulary + zod + version stamps.

// The default flow every node/edge belongs to when it carries no explicit `flowId` (I1). A
// zero-command skill is one `main` flow; each /command entry point owns a flow keyed by its node id.
export const DEFAULT_SKILL_FLOW_ID = "main";

// An entry point's trigger kind (I1) — also the `kind` of a cross-skill `TriggerCollision` (I7).
// `command` = a `/word` invocation (e.g. `/report`); `keyword` = a natural-language trigger phrase.
export const TRIGGER_KINDS = ["command", "keyword"] as const;

// Severity of a quality finding (I4). Drives the score (see `QUALITY_SEVERITY_WEIGHTS`) and UI band.
export const QUALITY_SEVERITIES = ["error", "warning", "info"] as const;

// The quality score formula's SINGLE SOURCE OF TRUTH (I4): per-severity penalty weight. The 0–100
// score is `clamp(100 - Σ(count(severity) * weight), 0, 100)`, rounded to an int. Exported so the
// engine (WP 4.1) and any doc/test derive the score from the same numbers — never a re-hardcoded copy.
export const QUALITY_SEVERITY_WEIGHTS: Record<(typeof QUALITY_SEVERITIES)[number], number> = {
  error: 15,
  warning: 5,
  info: 1,
};

// The quality engine's algorithm version (I4/I8), mirroring `TOKEN_COUNTING_VERSION`'s
// never-silently-compare rule: a report computed under a different engine version is not directly
// comparable. Bumped whenever the rule set or scoring changes. The engine itself lands in WP 4.1.
export const QUALITY_ENGINE_VERSION = 1;

// Quality token-budget ceilings (I4) — env-overridable via SKILL_QUALITY_L1/L2_TOKEN_CEILING
// (WP 4.1), each falling back to these shared-constant defaults (the SKILL_MAX_* pattern). Chosen
// against the Agent Skill progressive-disclosure scale: L1 = the always-resident metadata
// (frontmatter name + description) that Anthropic guidance keeps tiny (name ≤ 64 chars, description
// ≤ ~1024 chars ≈ 256 tokens) — 500 leaves headroom while still flagging a bloated description; L2 =
// the SKILL.md body loaded IN FULL on trigger, which the guidance keeps lean (~<500 lines) — 5000
// tokens (~a few hundred lines of prose) flags a body that should be split into L3 reference files.
export const DEFAULT_SKILL_QUALITY_L1_TOKEN_CEILING = 500;
export const DEFAULT_SKILL_QUALITY_L2_TOKEN_CEILING = 5000;

// MCP tool-reference validation (I5): a diagnostic's kind + its close-match candidate confidence
// (reusing the compare feature's exact→normalized→fuzzy match basis). Read-only over persisted
// `mcp_tool_scans` — validation never opens an MCP connection. The validator lands in WP 5.1.
export const TOOL_DIAGNOSTIC_KINDS = ["unknown_tool", "stale_tool"] as const;
export const TOOL_CANDIDATE_CONFIDENCE = ["exact", "normalized", "fuzzy"] as const;

// The tool-validation algorithm version (I5/I8), same never-silently-compare stamping rule as the
// quality + counting versions. Bumped when the matching/diagnostic logic changes (validator: WP 5.1).
export const TOOL_VALIDATION_VERSION = 1;

// File-content encoding for the tree edit ops (`add_file`/`update_file`) — text (`utf8`) or a binary
// blob carried as base64 (I3). Additive: absent ⇒ `utf8`.
export const SKILL_FILE_ENCODINGS = ["utf8", "base64"] as const;

// GitHub repo-name rules (I6, publish-to-GitHub): 1–100 chars of ASCII alphanumerics, hyphen,
// underscore, or period; the bare `.`/`..` names are additionally refused (git-reserved). The
// publisher (WP 6.x) validates a `PublishToGithubInput.repoName` against this before any API call.
export const GITHUB_REPO_NAME_PATTERN = /^[A-Za-z0-9._-]{1,100}$/;

// --- Benchmarks — output-quality grading contract (WP 1.1, B1–B5) -----------------------------
// The additive contract the Benchmarks plan hangs off (planning/Roadmap/RM-07-benchmarks/, B1–B15). WP 1.1 freezes
// the FULL downstream grading vocabulary (grader ids + finding shapes later graders consume) + the
// version stamp so no later WP re-touches `packages/shared`. The engines that PRODUCE grades (the
// graders, the judge, the suite runner) land in later WPs; here we only land types/zod/persistence.

// The grading algorithm version, stamped on every `run_grades` row (mirrors TOKEN_COUNTING_VERSION's
// never-silently-compare rule): scores computed under different grading versions are never directly
// compared. Bump whenever a grader's method or normalization changes.
export const GRADING_VERSION = 1;

// The full grader roster (front-loaded — later WPs BUILD each; the contract lists them all now):
// `rouge1` = ROUGE-1 lexical overlap vs `expectedInsight`; `value_match` = structured/numeric match
// vs `expectedValue`; `outcome_judge` = LLM judge of the final answer against the rubric;
// `tool_hygiene` = deterministic trajectory checks; `trajectory_judge` = LLM judge of the tool
// trajectory vs `referenceLogic`; `skillflow_conformance` = grade derived from the SkillFlow
// alignment of the run's attached skills.
//
// Auto-Rating (WP 1.1, planning/Roadmap/RM-06-auto-rating/, AR1/AR5/AR6) APPENDS three ALWAYS-ON base-rating
// graders — see {@link BASE_RATING_GRADER_IDS} — that run on every terminal run regardless of
// `test.expectations` (unlike the six above, which only run when a test declares expectations):
// `answer_validation` = does the final assistant answer address the test's initial prompt;
// `insight_surplus` = double-edged beyond-ask-insight grading (AR8 — valuable surplus scores up,
// noise/padding scores down with its token cost named); `error_forensics` = a deterministic
// error inventory + LLM root-cause classification into skill/mcp_server/model_behavior/test_setup/
// provider_infra buckets (AR4). Their scores are a SEPARATE dimension (AR6) — never folded into
// `SuiteAggregates.meanGrade`/`passRateAt05`/the quality×cost scatter; they get their own
// chip/column surfaces instead. Append-only: the original six keep their order.
export const GRADER_IDS = [
  "rouge1",
  "value_match",
  "outcome_judge",
  "tool_hygiene",
  "trajectory_judge",
  "skillflow_conformance",
  "answer_validation",
  "insight_surplus",
  "error_forensics",
] as const;

// A grade's family: `deterministic` graders run offline with no model call; `llm` graders call a
// judge model (and carry a separate `judge_*` cost ledger — B5).
export const GRADE_KINDS = ["deterministic", "llm"] as const;

// A grade's honest evaluation status: `graded` = a real score was produced; `unevaluable` = the test
// carried no ground truth this grader needs (surfaced, never silently 0); `error` = the grader/judge
// failed to run (surfaced, never silently 0).
export const GRADE_STATUSES = ["graded", "unevaluable", "error"] as const;

// How an LLM judge produced its score — an honest method stamp: `logprob_weighted` = expected value
// over the judge's token logprobs; `single_sample` = one greedy sample (no logprobs available).
export const JUDGE_METHODS = ["logprob_weighted", "single_sample"] as const;

// A test's authored difficulty band (analytics metadata; optional on a Test).
export const TEST_DIFFICULTIES = ["easy", "medium", "hard"] as const;

// A `ReferenceLogic` block's kind — `code` (a snippet in some language) or `text` (prose). Handed to
// a judge as a DOCUMENT, NEVER executed (B15).
export const REFERENCE_LOGIC_KINDS = ["code", "text"] as const;

// Severity of a `tool_hygiene` finding (WP 2.1), carried in a grade's evidence.
export const TOOL_HYGIENE_SEVERITIES = ["low", "medium", "high"] as const;

// --- Auto-Rating — mandatory post-run rating contract (WP 1.1, AR1–AR16) ----------------------
// planning/Roadmap/RM-06-auto-rating/item.md. Extends the Benchmarks grading system above: base rating is three
// ALWAYS-ON graders (see the {@link GRADER_IDS} roster comment) joining `run_grades` — append-only,
// latest-per-grader wins, same `GRADING_VERSION` discipline, no new per-run table (AR1). This WP
// lands only the contract (constants/types/zod); the graders themselves are later WPs.

// The auto-rating algorithm version (AR15), stamped on every composed `RunReport`/`SuiteReport` —
// mirrors `GRADING_VERSION`'s never-silently-compare rule: a rating computed under one
// `AUTO_RATING_VERSION` is never directly compared/aggregated with one computed under another.
// Individual base-grader methods are stamped e.g. `answer_validation_v1` (a `RunGrade.method`
// string, not a separate constant); the underlying `run_grades` rows still carry their own
// `gradingVersion` (`GRADING_VERSION`) — the two version stamps are independent.
export const AUTO_RATING_VERSION = 1;

// `error_forensics`' 5-bucket root-cause taxonomy (AR4) — assigned per finding by LLM
// classification, alongside the mandatory `FIX_TARGETS` split.
export const ROOT_CAUSE_BUCKETS = [
  "skill",
  "mcp_server",
  "model_behavior",
  "test_setup",
  "provider_infra",
] as const;

// Mandatory per-finding fix target (AR4/AR9) — keeps the skill-vs-server split first-class; `none`
// covers a root cause with no actionable fix (e.g. most `model_behavior`/`provider_infra` findings).
export const FIX_TARGETS = ["skill", "mcp_server", "none"] as const;

// The inventory category one `error_forensics` finding was extracted from (AR4) — which raw run
// signal produced it, BEFORE LLM classification assigns it a `ROOT_CAUSE_BUCKETS` bucket +
// `FIX_TARGETS` target.
export const ERROR_FINDING_CATEGORIES = [
  "error_event",
  "failed_tool_call",
  "guardrail_stop",
  "context_overflow",
  "mcp_connection_failure",
  "assertions_failed",
] as const;

// The `answer_validation` base grader's verdict — does the final assistant answer address the
// test's initial prompt.
export const ANSWER_VALIDATION_VERDICTS = ["answered", "partial", "unanswered"] as const;

// The `insight_surplus` base grader's verdict (AR8, double-edged) — beyond-ask insight is graded,
// not merely detected: grounded/relevant surplus is `valuable`, unrequested padding is `noise`
// (its token cost is named — see `InsightSurplusEvidence.surplusTokens`), and `none` means the
// answer stayed exactly on-ask.
export const INSIGHT_SURPLUS_VERDICTS = ["none", "valuable", "noise"] as const;

// The three always-on base-rating grader ids (AR1/AR6) — a fixed subset of `GRADER_IDS`. Kept as
// its own roster so the API grader roster and the web UI can tell base-rating scores apart from
// expectation-grader scores: base-rating scores NEVER enter `SuiteAggregates.meanGrade` /
// `passRateAt05` / the quality×cost scatter (AR6) — they get their own chip/column surfaces.
export const BASE_RATING_GRADER_IDS = [
  "answer_validation",
  "insight_surplus",
  "error_forensics",
] as const;

// Benchmarks WP 6.1 (Phase 6, judge calibration) — the two verdicts a human may record ON A GRADE.
// Deliberately two-valued and deliberately NOT a score: this is the raw material for WP 6.2's
// agreement rate (human-agree ÷ human-rated), and it never enters `run_grades`, `meanGrade`,
// `passRateAt05`, the quality×cost scatter, or any other aggregate (AR6). See `GradeFeedback`.
export const GRADE_FEEDBACK_VERDICTS = ["agree", "disagree"] as const;

// The maximum length of a human's note on a grade verdict. Bounded because it is free text the API
// stores and re-serves in an export; the cap keeps one pasted transcript from becoming the document.
export const GRADE_FEEDBACK_NOTE_MAX_LENGTH = 2000;

// The `app_settings` row key holding the default judge (JudgeSettings). WP 1.3 reads/writes it.
export const APP_SETTING_JUDGE_KEY = "judge";

// The `app_settings` row key holding the Claude-CLI judge model (a plain string; Auto-Rating WP 2.3).
// Selectable from the assistant roster in Settings; falls back to the CLI-judge default when unset.
export const APP_SETTING_JUDGE_CLI_MODEL_KEY = "judge_cli_model";

// The synthetic judge-provider id stamped on a `run_grades` row the Claude-CLI (subscription) judge
// rated (Auto-Rating WP 2.3, AR13). It is NOT a real provider-credential id — the CLI runs on the
// owner's Claude subscription, so its SEPARATE judge cost ledger reads 0 (real tokens, cost 0). The
// Report/Settings surfaces match on this to show "rated via the Claude CLI". Also the sentinel the
// mandatory LLM graders' pricing guard treats as always-runnable (the unpriced guard does NOT apply
// to the CLI model — it is a subscription, not metered provider spend).
export const CLAUDE_CLI_PROVIDER_ID = "claude_cli";

// The `app_settings` row key holding the persisted run-retention prune policy (Observability WP1.6,
// RunRetentionPolicy). Read/written by `GET`/`PUT /api/maintenance/run-retention-policy`; consumed by
// `POST /api/maintenance/prune-runs` when the request supplies no explicit override. Absent → an empty
// policy (`{ byStatus: {} }`) — pruning stays OFF until the operator configures it in Settings.
export const APP_SETTING_RUN_RETENTION_KEY = "run_retention";

// Relative tolerance for numeric `value_match` comparisons (WP 1.2 uses it): |a-b| <= tol*max(|a|,|b|).
export const VALUE_MATCH_REL_TOLERANCE = 1e-6;

// Legacy/fallback seed map of model context windows (tokens) for previous-generation model ids the
// dataset does not cover. The CURRENT-generation windows come from the research dataset via
// `GENERATED_MODEL_CONTEXT_LIMITS` (see the merge in `MODEL_CONTEXT_LIMITS` below). Treat a provider
// limit error as ground truth regardless of either map (WP 1.4).
const LEGACY_MODEL_CONTEXT_LIMITS: Record<string, number> = {
  "claude-opus-4-1": 200000,
  "claude-opus-4": 200000,
  "claude-sonnet-4-5": 200000,
  "claude-sonnet-4": 200000,
  "claude-3-7-sonnet": 200000,
  "claude-3-5-sonnet": 200000,
  "claude-3-5-haiku": 200000,
  "gpt-4o": 128000,
  "gpt-4o-mini": 128000,
  "gpt-4.1": 1047576,
  "gpt-4.1-mini": 1047576,
  "gpt-4.1-nano": 1047576,
  o3: 200000,
  "o3-mini": 200000,
  "o4-mini": 200000,
  "gemini-2.5-pro": 1048576,
  "gemini-2.5-flash": 1048576,
  "gemini-2.5-flash-lite": 1048576,
  "gemini-2.0-flash": 1048576,
  // Representative local / Ollama models (run via the openai-compatible provider). Context windows
  // are model-config-dependent (Ollama can override `num_ctx`); these are the model defaults — a
  // provider limit error is still treated as ground truth regardless of this map (WP 1.4).
  "llama3.1": 131072,
  "llama3.3": 131072,
  "qwen2.5": 32768,
  mistral: 32768,
};

// Current-generation ids the LIVE provider rosters offer but the research dataset SNAPSHOT
// (as-of 2026-06-21) predates (D-MI11, `planning/Roadmap/RM-16-model-identity/`). Distinct from
// {@link LEGACY_MODEL_CONTEXT_LIMITS} above, which back-fills *previous*-generation ids: these are
// current models the dataset simply hasn't been refreshed for yet.
//
// Why this matters beyond a cosmetic "unknown model" — a missing entry resolves to `0`, and a
// context window of `0`:
//   • disables compaction (`hub/compaction.ts` gates on a positive window), and
//   • makes every "% of context used" surface meaningless.
// The owner's failing session ran on `claude-sonnet-5`, which was absent from BOTH maps.
//
// This is a hand-maintained GAP-FILLER, not a second source of truth: it is merged BEFORE
// `GENERATED_MODEL_CONTEXT_LIMITS`, so the moment the dataset is refreshed the dataset value wins
// and the entry here becomes dead weight to be deleted. **Never hand-edit `model-data.generated.ts`**
// — regenerate it from `planning/Research/RS-01-token-context-comparison/outputs/data/**` with `pnpm build:model-data`.
//
// Dated snapshot ids are listed explicitly next to their alias because every lookup in the app is an
// EXACT-key map read (`MODEL_CONTEXT_LIMITS[modelId] ?? 0`) — there is no alias normalization, and
// `claude-haiku-4-5-20251001` is precisely the id the signed-in Claude subscription reports for Haiku.
export const ROSTER_GAP_MODEL_CONTEXT_LIMITS: Record<string, number> = {
  "claude-fable-5": 1000000,
  "claude-opus-5": 1000000,
  "claude-opus-4-7": 1000000,
  "claude-opus-4-6": 1000000,
  "claude-sonnet-5": 1000000,
  // Dated snapshot ids (same models as their aliases; the subscription/API rosters return these).
  "claude-haiku-4-5-20251001": 200000,
  "claude-sonnet-4-5-20250929": 200000,
  "claude-opus-4-1-20250805": 200000,
};

// The authoritative, dataset-derived context windows (current-generation models) take precedence;
// the legacy seed fills gaps for older ids the user might still run, and the roster-gap seed fills
// current-generation ids the dataset snapshot predates. Single source of truth:
// planning/Research/RS-01-token-context-comparison/outputs/data/** → regenerate with `pnpm build:model-data` (Decision 1).
export const MODEL_CONTEXT_LIMITS: Record<string, number> = {
  ...LEGACY_MODEL_CONTEXT_LIMITS,
  ...ROSTER_GAP_MODEL_CONTEXT_LIMITS,
  ...GENERATED_MODEL_CONTEXT_LIMITS,
};

// --- Benchmarks — suites (WP 3.1, B7) --------------------------------------------------------
// A suite is a first-class entity; a suite RUN is a test × scenario × repetition matrix executed as
// ordinary persisted runs (the orchestrator lands in WP 3.2 — NOT here). WP 3.1 freezes the FULL
// downstream suite/analytics/variant/failure-bucket contract so no later WP (3.2–3.5, 5.1)
// re-touches `packages/shared`.

// A suite run's lifecycle status. `capped` = the aggregate cost cap tripped a soft-stop (B7);
// `stopped` = an explicit operator stop; the rest mirror the run terminal vocabulary.
export const SUITE_RUN_STATUSES = [
  "pending",
  "running",
  "completed",
  "capped",
  "stopped",
  "error",
] as const;

// Repetitions per matrix cell (test × scenario). Default 1 (one run per cell); capped so a suite
// can't fan out unbounded.
export const SUITE_DEFAULT_REPETITIONS = 1;
export const SUITE_MAX_REPETITIONS = 5;

// Parallel run concurrency across the matrix (the WP 3.2 orchestrator honors it). Default 3, capped at 8.
export const SUITE_DEFAULT_CONCURRENCY = 3;
export const SUITE_MAX_CONCURRENCY = 8;

// WP 3.5 default low-score cutoff — a run scoring below this is a candidate for a failure bucket.
export const FAILURE_BUCKET_SCORE_THRESHOLD = 0.5;

// --- Benchmarks — collections & on-disk file format (WP 4.1, B10/B12) -------------------------
// A Collection is a synced set of tests/suites backed by a git repo (B10). Its members serialize to
// deterministic on-disk files (B12) whose `formatVersion` is stamped so a reader can reject/upgrade a
// future shape. The git engine (clone/commit/fetch/merge) is WP 4.2 — this WP lands only the contract,
// schema, CRUD, membership, and the DB-row ⇄ file serializers.
export const COLLECTION_FILE_FORMAT_VERSION = 1;

// --- Testing IA — collections-as-home + run plans (WP 1.1) ------------------------------------
// The reserved name of the always-present default collection: local, undeletable, NEVER repo-bound
// (D-T4). A test/suite with no explicit collection lands here so nothing is ever collection-less;
// the migration (WP 1.2) seeds exactly one such row and backfills loose members into it.
export const DEFAULT_COLLECTION_NAME = "Local";

// Typed error code returned by the git-sync/status/resolve endpoints when a collection has NO repo
// binding (an unbound/local collection). The API answers an honest 400 carrying this code instead of
// faking a sync success (git-sync trust model). Later API/web WPs surface it; WP 1.1 only reserves it.
export const REPO_NOT_BOUND_CODE = "REPO_NOT_BOUND";

// The three ways a run plan (WP 1.1 `runPlanInputSchema`) is launched — every plan executes as a
// suite-run through the one orchestrator; `source` selects which member shape validates and is also
// stamped additively on the resulting suite-run summary (read by WP 2.2/3.2 for the unified Runs feed).
export const RUN_PLAN_SOURCES = ["suite", "collection", "adhoc"] as const;

// --- UX overhaul WP 3.5 (G7, D-UX12) — advisory run-plan cost preview -------------------------
// The launcher's "≈ tokens · $X–$Y" preview is a deliberately ROUGH, advisory estimate served by
// `GET /api/estimate/run-plan` (pricing stays server-side — never embedded in the web bundle). The
// environment's tool-definition footprint (re-sent to the model every agent turn in eager mode) is
// the dominant token driver, so the low/mid/high band is mostly "how many turns will the agent
// take?". These are the turn-count assumptions that spread that band. Wide bars are expected and
// intentional — the number is labeled an estimate and blocks NOTHING.
export const RUN_PLAN_ESTIMATE_TURNS_LOW = 1;
export const RUN_PLAN_ESTIMATE_TURNS_MID = 3;
export const RUN_PLAN_ESTIMATE_TURNS_HIGH = 8;
// Rough assistant tokens produced per agent turn (reasoning + tool-call arguments + final text).
export const RUN_PLAN_ESTIMATE_OUTPUT_TOKENS_PER_TURN = 350;
// Rough chars-per-token divisor for prompt text we have but have not BPE-counted (system + user
// prompt) — matches the `raw_json_rough` bytes/4 heuristic; good enough for an advisory band.
export const RUN_PLAN_ESTIMATE_CHARS_PER_TOKEN = 4;

// --- RM-34 WP 1.1 (D-ET1…D-ET5) — the MEASURED turn model -------------------------------------
// The three constants above were never measured; they were the shape of a guess made when the
// preview shipped. Against the owner's own completed runs they are wrong in the same direction on
// both axes: turns run p10 4 / p50 6 / p90 16 against 1/3/8, and output lands at ~1,148 tokens a
// turn against 350 — so `8` is not a ceiling, it is roughly the 66th percentile, and a 19-turn run
// cannot be reproduced at any price. The app already persists the evidence (`runs.turns`,
// `runs.tokens_out`), so the band's ends move onto measured ground. The constants above STAY: they
// are the `"default"` basis a fresh install, a new environment and a never-run test all still need
// (D-ET1 — history-first, never history-only).

// Where a turn band came from, narrowest measured basis first (D-ET5). The estimate carries this so
// an operator can tell a band measured from 51 of their own runs from one the app guessed.
export const RUN_PLAN_TURN_BASES = ["pair", "environment", "global", "default"] as const;

// How many completed runs a level must hold before it is allowed to speak for itself (D-ET2). A
// level below the floor falls through WHOLE to the next one — a 2-run pair is never blended into its
// environment's 79 runs, because the blend would be a figure nobody measured.
//
// 3 is a JUDGEMENT, not a derivation. The measured (environment, test) pairs cluster at 51, 28, 16,
// 8, 5, 4 and 3 completed runs; a floor of 3 keeps every genuinely repeated pair and rejects the
// one-off, whose single turn count says more about that one afternoon than about the task.
export const RUN_PLAN_TURN_PROFILE_MIN_SAMPLES = 3;

// The band's ends as percentiles of the observed turn counts (D-ET3). Deliberately NOT min/max: the
// largest pair spans 5–19 turns over 51 runs, and one 19-turn outlier should widen the band, not
// define it. Read nearest-rank, so every end the UI shows is a turn count that actually happened.
export const RUN_PLAN_TURN_PERCENTILE_LOW = 0.1;
export const RUN_PLAN_TURN_PERCENTILE_MID = 0.5;
export const RUN_PLAN_TURN_PERCENTILE_HIGH = 0.9;

// ==================================================================================================
// Assistant (WP 0.1) — shared contract
// ==================================================================================================
// Embedded Claude agent chat (planning/Roadmap/RM-02-assistant/00-plan.md, decisions D-AS1…D-AS18 in
// planning/Roadmap/RM-02-assistant/decisions.md). This WP lands the wire + persistence CONTRACT only — the session
// engine (WP 1.1), in-process MCP toolset (WP 1.2), and dock UI (WP 1.3) build on it in later WPs.
// Wire types are AssistantThread / AssistantEvent / AssistantAuthStatus / AssistantContextEnvelope
// (types.ts); request schemas are in schemas.ts. Naming (hard rule, D-AS9): the feature is
// "Assistant" everywhere — UI copy must never say "Claude Code" (Anthropic Agent SDK policy).

/**
 * The one credential kind persisted in `assistant_credentials` today (D-AS1/D-AS2) — a Claude
 * Pro/Max OAuth token minted by `claude setup-token`. The API-key fallback is a REFERENCE to an
 * existing `provider_credentials` row (kind `anthropic`), never duplicated into this table.
 */
export const ASSISTANT_CREDENTIAL_KINDS = ["claude_oauth"] as const;

/**
 * Which auth source a thread's session draws from (D-AS14). The session env carries EXACTLY ONE of
 * `CLAUDE_CODE_OAUTH_TOKEN` (`subscription`) or `ANTHROPIC_API_KEY` (`api_key`) — never a silent
 * fallback between them; a subscription limit error surfaces an explicit "retry on API key" action.
 */
export const ASSISTANT_AUTH_SOURCES = ["subscription", "api_key"] as const;

/**
 * A thread's lifecycle state (mirrors the session engine, WP 1.1): `idle` = no live child (never
 * started, or parked after the idle timeout — resumable via the persisted SDK session id);
 * `running` = a turn is in flight; `error` = the last turn ended in an unrecoverable error.
 */
export const ASSISTANT_THREAD_STATUSES = ["idle", "running", "error"] as const;

/**
 * App entities a thread may be pinned to via its context envelope (D-AS7/D-AS15) — drives "threads
 * pinned to the current entity" in the dock's thread switcher. `scenario` is the WIRE name for what
 * the UI labels "Environment" (the Testing-IA rename is UI-label-only, wire frozen — see CLAUDE.md
 * §1 "Testing IA consolidation"); `suite_run` matches the unified Runs-feed member entity.
 */
export const ASSISTANT_ENTITY_KINDS = [
  "run",
  "scenario",
  "skill",
  "scan",
  "server",
  "test",
  "collection",
  "suite_run",
  "compare",
] as const;

/**
 * The settled `AssistantEvent` vocabulary persisted to `assistant_events` (append-only, per-thread
 * monotonic `seq`). Streaming text DELTAS are never a member of this list — only settled events are
 * persisted (00-plan.md §3.1 — "deltas are ~80% of volume; code-quest lesson"); the SSE stream
 * carries transient delta frames the dock renders live but the repository never stores.
 *
 * `source_switch` (WP 3.3, D-AS14) is the audit record of the ONE way a thread's `authSource` ever
 * changes: an explicit owner "retry on the other source" action after a `limit_error` — never a
 * silent fallback.
 */
export const ASSISTANT_EVENT_TYPES = [
  "user_message",
  "assistant_message",
  "tool_call",
  "tool_result",
  "permission_request",
  "permission_decision",
  "ui_action",
  "limit_error",
  "source_switch",
  "error",
  "turn_done",
] as const;

/**
 * Why a `limit_error` fired (WP 3.3) — mirrors the session driver's own `DriverEvent` `limit_error`
 * `kind` (`apps/api/src/assistant/session-driver.ts`, verified against the installed
 * `@anthropic-ai/claude-agent-sdk@0.3.206` `SDKAssistantMessage.error` values): `auth` means the
 * credential itself failed (expired/invalid subscription token, org not allowed, billing) — the dock
 * hints at re-signing-in; `rate_limit` means a capacity/rate limit (or a hard-rejected
 * `rate_limit_event`) — no re-auth needed, just retry (optionally on the other source, D-AS14).
 */
export const ASSISTANT_LIMIT_ERROR_KINDS = ["rate_limit", "auth"] as const;

/**
 * WP R1.3 (D-AS22) — the three TRANSIENT skill-workspace stream-frame types (`AssistantWorkspaceFrame`
 * in types.ts). Exactly like `assistant_delta` (the streaming text delta), these are NEVER persisted
 * to `assistant_events` — no migration, no `seq`, never replayed — so they are deliberately NOT a
 * member of {@link ASSISTANT_EVENT_TYPES}. They ride the same SSE channel as the settled/delta frames
 * purely as a live progress signal for the skill-workspace edit loop (D-AS13): `workspace_opened` when
 * `skills_open_workspace` materializes a skill's files, `workspace_file_changed` per successful native
 * Edit/Write/MultiEdit inside that tree, `workspace_committed` when `skills_commit_workspace` actually
 * mints a new version. The dock's conversation reducer (`use-assistant-stream.ts`) ignores them; a
 * later WP (R1.4) adds the Files-view consumer that reads them.
 */
export const ASSISTANT_WORKSPACE_FRAME_TYPES = [
  "workspace_opened",
  "workspace_file_changed",
  "workspace_committed",
] as const;

/**
 * A `workspace_file_changed` frame's change kind (WP R1.3): `created` — the native write tool's
 * target path did not exist on disk before the call; `modified` — it already did (the ordinary
 * Edit/MultiEdit case, and a `Write` that overwrote an existing file).
 */
export const ASSISTANT_WORKSPACE_CHANGE_KINDS = ["created", "modified"] as const;

// Guardrail defaults (D-AS10; env-overridable at WP 0.3 via ASSISTANT_MAX_TURNS /
// ASSISTANT_IDLE_TIMEOUT_MS / ASSISTANT_MAX_ACTIVE_SESSIONS — these are the fallback values).
/**
 * Turn cap passed to the SDK's `maxTurns` — "Maximum number of conversation turns before the query
 * stops" (verified against the installed `@anthropic-ai/claude-agent-sdk@0.3.206` `sdk.d.ts`). In this
 * app's streaming-input architecture ONE `query()` call IS a whole warm session (`session-manager.ts`'s
 * `startSession` — many `sendMessage()` calls share it until it's parked/aborted and a fresh `query()`
 * starts on resume). So this budget applies ACROSS THE WHOLE WARM SESSION, not reset per message: a
 * `maxTurns` of 50 could be exhausted by the 2nd message after 48 turns already spent on the 1st, not
 * necessarily by any single message alone. A fresh budget starts only on the NEXT park/resume (a new
 * `query()`).
 */
export const ASSISTANT_DEFAULT_MAX_TURNS = 50;
/** Idle timeout (ms) before a thread's child is parked (killed; resumable via `sdkSessionId`). */
export const ASSISTANT_DEFAULT_IDLE_TIMEOUT_MS = 600_000;
/** Max concurrently-active (non-idle) session children at once — each ≈ up to 1 GiB resident. */
export const ASSISTANT_DEFAULT_MAX_ACTIVE_SESSIONS = 2;
/**
 * How long a gated write's `permission_request` waits for an owner decision before it auto-denies
 * (WP 2.1, D-AS4). Env-overridable via `ASSISTANT_PERMISSION_TIMEOUT_MS`. A permission prompt has no
 * park deadline of its own (the SDK blocks the tool until `canUseTool` resolves), so this bound stops
 * a forgotten card from wedging a turn open forever — it fails CLOSED (deny), never open (allow).
 */
export const ASSISTANT_DEFAULT_PERMISSION_TIMEOUT_MS = 300_000;

// Claude sign-in (WP 0.2, D-AS1/D-AS2/D-AS14). The `claude setup-token` PTY flow and the manual
// paste path both yield a long-lived OAuth token that begins with this prefix (verified against the
// bundled CLI: `sk-ant-oat01…`, the same token injected as `CLAUDE_CODE_OAUTH_TOKEN`).
/** Required prefix of a Claude subscription OAuth token (`claude setup-token` output). */
export const ASSISTANT_OAUTH_TOKEN_PREFIX = "sk-ant-oat01-";
/**
 * The token is valid ~1 year. At/after this age (days) the Settings card shows an expiry warning so
 * the owner re-signs-in before it lapses (30-day heads-up before the 365-day expiry).
 */
export const ASSISTANT_TOKEN_EXPIRY_WARNING_DAYS = 335;

/**
 * The Claude-tier model roster used as the HONEST FALLBACK for the subscription's live model list.
 *
 * The Agent SDK's own live roster (`Query.supportedModels()`, confirmed in the pinned
 * `@anthropic-ai/claude-agent-sdk` `.d.ts`) is the CLI picker's real source and is now resolved live
 * through a short-lived spawn + cache (see `apps/api/src/providers/subscription-models.ts`), backing
 * BOTH the provider Model dropdown (`GET /api/providers/:id/models`) and the Assistant dock
 * (`GET /api/assistant/models`). This constant is what those surfaces fall back to on ANY
 * error/timeout/not-signed-in, and what a plain no-resolver caller returns — so the dropdown always
 * has a usable, CURRENT list even when the live probe can't run. It is env-overridable via
 * `ASSISTANT_MODEL_ROSTER` (comma-separated) for an owner who wants a different set — see
 * `apps/api/src/config/env.ts`. Kept in `packages/shared` (not apps/api) so it is the one place both a
 * web-side default and the API surfaces read from. Values kept CURRENT (2026-07): Opus 4.8, Sonnet 5,
 * Haiku 4.5, Fable 5.
 */
export const ASSISTANT_DEFAULT_MODEL_ROSTER = [
  "claude-opus-4-8",
  "claude-sonnet-5",
  "claude-haiku-4-5",
  "claude-fable-5",
] as const;

// ── Refinement R2 (D-AS25 release-on-reply · D-AS26 thread names/dates) — ADDITIVE block ───────────
// Kept in one clearly-marked place so the R2 wire additions merge-cleanly alongside R1's own block.

/**
 * The universal fallback thread title (a fresh thread with no user-supplied name). D-AS26's auto-title
 * only ever fills a title that is STILL this value — it never clobbers a user-renamed thread. Kept here
 * (not inline in the repository) so the repository's create default and the session manager's
 * "is-this-still-the-default?" guard read the exact same string from one source of truth.
 */
export const ASSISTANT_DEFAULT_THREAD_TITLE = "New thread";

/**
 * D-AS25 — grace (ms) between a turn completing and the thread's live SDK session being RELEASED
 * (parked: child killed, cap slot freed, `sdkSessionId` kept for resume). Default **0** = release the
 * moment the turn ends (normally ≤1 active session, so the "too many sessions" cap 409 disappears). A
 * few seconds keeps the child warm for instant follow-ups at the cost of holding a slot that long.
 * Env-overridable via `ASSISTANT_RELEASE_GRACE_MS`.
 */
export const ASSISTANT_DEFAULT_RELEASE_GRACE_MS = 0;

/**
 * D-AS26 — feature flag for the best-effort LLM-refined title. Default **ON**: after the first turn a
 * bounded one-shot on the cheap {@link ASSISTANT_DEFAULT_TITLE_MODEL} summarizes the first
 * message + reply into a crisp title. It is NOT registered in the live-session map and NEVER counts
 * toward the active-session cap, is hard-timeout bounded, and SILENTLY falls back to the deterministic
 * title on any error/timeout — so the deterministic title is always the guaranteed floor. Because it is
 * a real (small) SDK call it spends a little on the thread's auth source; disable via
 * `ASSISTANT_AUTO_TITLE=false` to run the deterministic title only, with no extra spend.
 */
export const ASSISTANT_DEFAULT_AUTO_TITLE = true;

/**
 * D-AS26 — the cheap model the title one-shot runs on. The last (cheapest) tier of
 * {@link ASSISTANT_DEFAULT_MODEL_ROSTER}. Env-overridable via `ASSISTANT_TITLE_MODEL`.
 */
export const ASSISTANT_DEFAULT_TITLE_MODEL = "claude-haiku-4-5";

/** D-AS26 — the deterministic title is trimmed/whitespace-collapsed and capped at this many chars
 *  (a real `…` on truncation). ~60 keeps a switcher row on one line. */
export const ASSISTANT_TITLE_MAX_LENGTH = 60;

/**
 * D-AS26 — hard timeout (ms) for the title one-shot. On timeout the one-shot is aborted and the
 * deterministic title is kept. Env-overridable via `ASSISTANT_TITLE_TIMEOUT_MS`.
 */
export const ASSISTANT_DEFAULT_TITLE_TIMEOUT_MS = 15_000;

// --- Rating Issues registry (Auto-Rating follow-on) --------------------------------------------
// Formalizes `error_forensics` findings into DISTINCT, deduplicated, persistent issues against the
// skills / MCP servers a run used (one issue per underlying problem per target; occurrences link
// every contributing run). Created/enhanced after every run rating by the CLI-first judge chain.

// What an issue is filed AGAINST — the actionable subset of `FIX_TARGETS` (`none` never files).
export const RATING_ISSUE_TARGET_KINDS = ["skill", "mcp_server"] as const;

// Lifecycle: `open` → `resolved`, with AUTOMATIC re-open when a resolved issue is seen again.
export const RATING_ISSUE_STATUSES = ["open", "resolved"] as const;

// Judge-assigned (deterministic fallback: `medium`); an enhance only ever RAISES severity (max wins).
export const RATING_ISSUE_SEVERITIES = ["low", "medium", "high"] as const;

// The category one issue OCCURRENCE was filed under. Every value of `ERROR_FINDING_CATEGORIES` (the
// auto-rating `error_forensics` provenance) PLUS `manual` — an occurrence the owner filed by hand
// (via the Assistant's `rating_issue_file` action tool), which corresponds to no automated finding
// category. Deliberately a SUPERSET of `ERROR_FINDING_CATEGORIES` (kept pure — it feeds the forensics
// grader) rather than an extension of it; the occurrence column is plain TEXT, so this needs no
// migration.
export const RATING_ISSUE_OCCURRENCE_CATEGORIES = [...ERROR_FINDING_CATEGORIES, "manual"] as const;

// --- Fleet issue aggregation (Observability WP5.1, D-OB20) -------------------------------------
// The FLEET dimension of the rating-issues registry: recurring failures deterministically clustered
// ACROSS runs (no LLM — that's the opt-in WP5.2), each carrying occurrence counts, first/last seen,
// affected entities, a per-day trend, and an open/resolved/regressed lifecycle with AUTO-reopen. A
// fleet issue is a `rating_issues` row that ALSO carries a `cluster_key` (+ the additive fleet
// columns); an ordinary per-run auto-rating issue carries a NULL `cluster_key` and is UNTOUCHED by
// the sweep (its per-run behavior + AR contracts are unchanged). Everything here is additive.

// The fleet-issue lifecycle (a SUPERSET of the per-run `RATING_ISSUE_STATUSES`): a resolved cluster
// whose signature reappears in a later run auto-transitions to `regressed` (+ one notification).
export const RATING_ISSUE_LIFECYCLES = ["open", "resolved", "regressed"] as const;

// The VERSION of the deterministic cluster-key construction (stamped on every fleet issue as
// `cluster_key_version`). Bumping it starts a fresh clustering namespace so a future key change never
// silently merges pre-existing history with newly-keyed runs. The current construction is:
//   `v{V} | {bucket} | {targetKind}:{targetId} | {toolName|-} | {normalizedErrorSignature}`
// (see `issue-clustering.ts` — the API owns the builder; this is the persisted stamp's initial value).
export const CLUSTER_KEY_VERSION = 1;

// The app_settings key under which the sweep's watermark (the ISO-8601 upper bound of the last swept
// window) is persisted. The sweep is idempotent regardless (occurrence INSERT-OR-IGNORE), so the
// watermark is a pure "don't re-scan old runs" optimization, never a correctness dependency.
export const ISSUE_SWEEP_WATERMARK_KEY = "issue_sweep_watermark";

// --- LLM assist for issue clustering (Observability WP5.2, D-OB20, OPT-IN) ---------------------
// An OPT-IN LLM pass OVER the deterministic fleet clusters (WP5.1): it merges near-duplicate fleet
// issues into a reversible merge-link, writes human titles/summaries, and SUGGESTS a priority — all
// through the SAME CLI-first judge chain the graders use, but on its OWN concurrency + setting and
// its OWN cost ledger. It is OFF by default and NEVER mutates the deterministic issue rows (the
// cluster keys keep accruing underneath; an unmerge fully restores). AI-written text is MARKED
// (`aiAssisted`), the deterministic fallback text is ALWAYS retained on the row, and the suggested
// priority NEVER auto-applies to the issue's `severity`.

// The priority the assist pass SUGGESTS for a merge group — surfaced, never auto-applied (the issue
// row's deterministic `severity` is untouched). Same three-value vocabulary as `RATING_ISSUE_SEVERITIES`.
export const ISSUE_ASSIST_PRIORITIES = ["low", "medium", "high"] as const;

// The app_settings key under which the assist OVERLAY (the applied merge groups + the separate assist
// judge-cost ledger) is persisted as ONE JSON document — a deliberate NON-migration store (WP5.2 is a
// planned non-migration): the deterministic `rating_issues` rows are never touched, so the overlay
// lives beside the sweep watermark in `app_settings`, and an unmerge simply drops a group (the
// originals were never mutated). A merge group referencing a since-deleted / re-derived issue id
// (e.g. after `POST /api/issues/rebuild`) is read DEFENSIVELY — the missing member is dropped.
export const ISSUE_ASSIST_STATE_KEY = "issue_assist_state";

// Max fleet issues shown to the assist judge in one pass (bounds the schema-constrained prompt).
export const ISSUE_ASSIST_MAX_CANDIDATES = 40;

// --- Review queue lite (Observability WP4.5, D-OB22) --------------------------------------------
// Structured human review WITHOUT multi-annotator/reservation machinery (single owner, D-OB22): a
// persisted, named RUBRIC (a checklist of keys, each thumbs/scale5/note) walked keyboard-first over a
// filtered set of runs. A "review session" itself is EPHEMERAL — a source RunFilter/saved view + a
// rubric picked at review time — NEVER a new persisted entity; only the rubric persists
// (`review_rubrics`, migration v46). Every verdict a reviewer records is written through the EXISTING
// WP1.5 `run_feedback` API (source='human', key = the rubric key's own name) — this table carries no
// feedback data of its own, and grading/suites/compare stay untouched (D-OB15/AR6).

/** One rubric key's answer widget. `thumbs` writes ±1 (mirrors the WP2.5 verdict convention); `scale5`
 *  writes 1..5; `note` writes a comment only (no score). */
export const REVIEW_RUBRIC_KEY_KINDS = ["thumbs", "scale5", "note"] as const;

export const REVIEW_RUBRIC_NAME_MAX_LENGTH = 200;
export const REVIEW_RUBRIC_INSTRUCTIONS_MAX_LENGTH = 4000;
export const REVIEW_RUBRIC_KEY_NAME_MAX_LENGTH = 60;
export const REVIEW_RUBRIC_KEY_DESCRIPTION_MAX_LENGTH = 300;
// A rubric is a checklist, not a form builder — capped small on purpose (mirrors
// DASHBOARD_CHART_MAX_MEASURES's "this isn't a BI tool" reasoning).
export const REVIEW_RUBRIC_MAX_KEYS = 20;

// ==================================================================================================
// Assistant Hub — shared contract vocabulary (planning/Roadmap/RM-03-assistant-hub/, WP0.1, D-AH1…20) -------------
// The full-page, multi-model, multi-agent Assistant. ADDITIVE ONLY: nothing above changes. Namespace
// `HUB_*` (D-AH2). The SESSION LIFECYCLE vocabulary is REUSED verbatim from Unified Sessions — a hub
// session's `status` is a {@link RUN_STATUSES} value, its `phase` a {@link RUN_PHASES} value, its
// terminal reason a {@link STOP_REASON_CODES} value, and its capability manifest a
// `SessionCapabilities` — never forked here (D-AH3 / §1.2). Only the hub-ONLY facets (modes, topology,
// events, parts, missions, artifacts, memory, …) are defined below. Env VALUES
// (`HUB_MAX_ACTIVE_SESSIONS`, autonomy thresholds, output caps, …) live in `apps/api/src/config/env.ts`
// (a later WP), never here — this file carries only the closed vocabularies + validation limits.
// ==================================================================================================

// Session modes, chosen at session start (D-AH5): plain multi-model chat · search-grounded
// citations-first research · the multi-agent harness (mission). Modes shape the system prompt,
// default tools and UI emphasis. hub-fixes WP6.1 (RC7) adds `auto` — the per-message router that
// answers plain asks as chat, proposes a mission when the task decomposes, and asks first with a
// GenUI clarify card when a mission is warranted but unstated. APPENDED (never reordered) so every
// existing member keeps its index and pre-fix sessions/replays are untouched.
export const HUB_SESSION_MODES = ["chat", "research", "mission", "auto"] as const;

// A session's KIND (§1.2): a user-facing `chat` thread, or an `agent` — a mission member that is a
// child hub session carrying `parent_session_id` + `mission_id` (D-AH8).
export const HUB_SESSION_KINDS = ["chat", "agent"] as const;

// Mission topologies (D-AH5): how the proposed team is wired. `parallel` (independent fan-out),
// `pipeline` (ordered hand-offs), `debate` (alternating adversarial turns + resolver), `best_of_n`
// (N attempts + a blind judge). v1 ships `parallel` (WP1.7); the rest land in WP2.2 — the union is
// closed from day one so the wire never widens for them.
export const HUB_TOPOLOGIES = ["parallel", "pipeline", "debate", "best_of_n"] as const;

// Autonomy dial per session (D-AH6): always ask before launching · ask only above a configured
// threshold (agent count / est. cost) · run automatically within policy. HARD CAPS are enforced
// server-side regardless of the dial (D-AH9).
export const HUB_AUTONOMY_LEVELS = ["always_ask", "threshold", "auto"] as const;

// Auto-title lifecycle of `hub_sessions.title` (deterministic-then-LLM-refine, D-AS26 pattern):
// not yet titled · auto-generated · user-set (manual wins, never overwritten by auto).
export const HUB_TITLE_STATES = ["pending", "auto", "manual"] as const;

// The CLOSED hub event-type union (§1.3). `hub_events` is APPEND-ONLY: a session's full state —
// transcript, mission board, task widget, artifacts, per-message UI state — is reconstructible from its
// event log ALONE (R-SES1 / the AG-UI rule). Streaming text deltas are forwarded over SSE but NOT
// persisted (settled events only — the dock's code-quest lesson).
//
// This is the execution-plan §1.3 sketch (26 members) PLUS the two the requirements annex mandates for
// WP0.1 and marks event-sourced (the annex's WP-impact map is authoritative, and both are MUST for
// WP0.1 — see the WP report's reconciliation note):
//   • `queued_user_message` — R-SES3: durable steering. Persisted when a message is typed WHILE running;
//     injected as a `user_message` at the next step boundary. Survives restart; losing one is a bug.
//   • `ui_state` — R-GUI5: per-message generative-UI state (client-side ops that never re-enter the
//     model) is event-sourced and rehydrated on replay.
// Additive-later still holds for future members; order here is not append-sensitive (nothing is
// persisted yet) and is grouped for readability.
export const HUB_EVENT_TYPES = [
  // conversation turns + streaming lifecycle
  "user_message",
  "queued_user_message",
  "assistant_message",
  "reasoning",
  "tool_call",
  "tool_result",
  "ui_state",
  "phase",
  "turn_done",
  // missions (propose → approve → run → synthesize)
  "plan_proposed",
  "plan_updated",
  "plan_approved",
  "mission_started",
  "agent_spawned",
  "agent_report",
  "mission_synthesis",
  // assistant-hub v1-fixes (F2/F7 — planning/Roadmap/RM-03-assistant-hub/mission-session-analysis-2026-07-20.md):
  // `mission_digest` persists the mission's MODEL-VISIBLE outcome record (compact per-agent findings +
  // open questions) that history reconstruction folds into every later turn's context — closing the
  // "the UI shows the reports but the model can't see them" divergence. `mission_followups` records the
  // deduped open questions so the UI can offer a one-click follow-up mission and the planner can seed
  // from them. Additive — pre-fix reducers ignore unknown members.
  "mission_digest",
  "mission_followups",
  // hub-fixes WP2.5 (D-HF6) — a mission child agent's approval-gated tool call, MIRRORED onto the
  // parent (board) log so the board's `always_ask` approval queue reconstructs from the parent event
  // log alone (R-SES1). Additive — pre-WP2.5 reducers ignore an unknown member; only emitted under an
  // `always_ask` mission (an `auto`/`threshold` mission never queues to the board).
  "agent_approval_requested",
  "agent_approval_responded",
  // artifacts + review workflow
  "artifact_created",
  "artifact_updated",
  "review_opened",
  "review_decided",
  // memory · files · workspace
  "memory_proposed",
  "memory_saved",
  "file_uploaded",
  "workspace_file_changed",
  // live HITL — approval-gated tool calls + MCP elicitation (WP2.3, R-MCP3/R-MCP4/R-UX1). Each is an
  // event so a session (and its transcript state machine) is reconstructible from `hub_events` alone
  // (R-SES1): an `approval_requested` pauses a gated tool call on its `ApprovalCard`; `approval_responded`
  // records the terminal decision; `elicitation_requested`/`elicitation_responded` bracket an MCP
  // `elicitation/create` form/URL. Additive — pre-WP2.3 replay/reducers ignore an unknown member.
  "approval_requested",
  "approval_responded",
  "elicitation_requested",
  "elicitation_responded",
  // agent-initiated interactive question (`ask_user`) — the hub reuses the Testing `ask_user` primitive
  // (NOT the SDK-native `AskUserQuestion`). A `question` pauses a foreground turn on its answer card
  // (`waiting_input`, reason `"question"`); `question_resolved` settles it (the chosen/typed answer, or
  // `null` when stopped before answering). Append-only + reconstructible (R-SES1); pre-existing reducers
  // ignore the unknown member. Exposed only on interactive foreground sessions (`SessionCapabilities.askUser`).
  "question",
  "question_resolved",
  // context management — WP3.3 (R-SES8). A `compaction` marks the point where the earlier turns are
  // now represented to the MODEL by a rolling summary (`hub_session_summaries`): clear-tool-outputs-
  // first (hot/cold split) then summarize, invoked-skill bodies re-attached within budget. Append-only
  // + reconstructible (R-SES1); the transcript renders an expandable "earlier turns compacted" marker.
  "compaction",
  // branching + terminal signals + keepalive
  "branch_created",
  "limit_error",
  "error",
  "ping",
  // WP3.4 (R-MCP9) — MCP resource @-mention/picker attachment: event-sourced (no new table) so the
  // session's currently-attached resource set is reconstructible from `hub_events` alone (R-SES1),
  // mirroring how `HubSteeringQueue.reconstructPending` derives live state purely from replay.
  "resource_attached",
  "resource_removed",
] as const;

// Assistant Hub (WP4.2, D-AH13) — the audit timeline's coarse kind taxonomy, matching D-AH13's four
// categories verbatim ("tool calls, approvals, agent spawns, model calls"). Each bucket derives from a
// closed subset of HUB_EVENT_TYPES: `tool_call` merges `tool_call`+`tool_result` (by toolCallId) into
// one row per real-world call; `approval` merges `approval_requested`+`approval_responded`; `spawn` is
// `agent_spawned` alone; `model_call` is a settled `assistant_message` alone. See `hub/audit.ts`.
export const HUB_AUDIT_KINDS = ["tool_call", "approval", "spawn", "model_call"] as const;

// Assistant Hub (WP2.3, R-MCP4) — the terminal action of an MCP elicitation (mirrors the MCP SDK's
// `ElicitResult.action`): the user submitted values (`accept`), refused (`decline`), or dismissed
// (`cancel`). A credential-shaped field auto-declines (never harvests a secret — R-MCP4/R-MCP12).
export const HUB_ELICITATION_ACTIONS = ["accept", "decline", "cancel"] as const;

// Assistant Hub (WP2.3, R-MCP4) — how an elicitation is surfaced: a schema→form (`form`, the MCP
// `requestedSchema` rendered through the existing generator) or a URL to visit (`url`, shown with
// domain emphasis, never auto-opened/prefetched).
export const HUB_ELICITATION_MODES = ["form", "url"] as const;

// R-UX1 — the canonical tool-call PART state machine, rendered INLINE in the transcript (approvals are
// transcript states, never a modal). The order is the legal progression:
//   input-streaming → input-available → (approval-requested → approval-responded) →
//   output-available | output-error | output-denied.
// A dial-approved (auto-run) call is marked via `HubToolApproval.isAutomatic`.
export const HUB_TOOL_PART_STATES = [
  "input-streaming",
  "input-available",
  "approval-requested",
  "approval-responded",
  "output-available",
  "output-error",
  "output-denied",
] as const;

// Where a tool a session can call comes from (§1.6): an in-process hub `builtin` (workspace/artifacts/
// memory/tasks/mission/genui), a bridged `mcp` tool, a `skill`-provided affordance, or the `genui`
// emission tool (`present`/`prompt_user`). Grants + loading discipline apply per source.
export const HUB_TOOL_SOURCES = ["builtin", "mcp", "skill", "genui"] as const;

// WP2.6 (R-GUI1/2) — the two silent, flat emission tools the model calls to render declarative UI: a
// display widget (`present`) and one that also asks for structured input back (`prompt_user`). Both are
// tagged `source: "genui"` (above) so their tool_call parts render as widgets, not tool cards.
export const HUB_GENUI_TOOL_NAMES = ["present", "prompt_user"] as const;

// WP2.6 (R-GUI1) — the GenUI catalog/spec version stamped on `generative-ui` parts + `ui_state` events
// (`HUB_GENUI_SPEC_VERSION`) and surfaced in the LAYER-4 prompt. Bump when the catalog shape changes so a
// replayed spec is never validated against a drifted catalog. Both the API (prompt/validator/json-schema
// compilers) and the web renderer read the SAME `HUB_GENUI_CATALOG` (see `hub-genui-catalog.ts`) — this
// version tags which catalog a given spec was produced under.
export const HUB_GENUI_SPEC_VERSION = "genui-1" as const;

// hub-fixes WP5.1 (RC5, D-HF2 revising D-AH10) — the two grantable "web" built-ins that give a hub
// session (and, via an explicit planner grant, a mission agent) real internet access:
//   • `web.search` — the SESSION MODEL'S OWN provider-native web search (Anthropic server web-search /
//     OpenAI web-search / Google search-grounding). Absent for `openai_compatible`/`ollama` (no native
//     search) — the tools prompt says why when a scope requested it. It is NOT a `HubBuiltinTool` with a
//     local `execute` (the provider runs it), so it never appears in `ALL_BUILTINS`; it is injected into
//     the toolset by the composition seam (`hub/session-service.ts`) when granted + supported.
//   • `web.fetch` — an app-level, GET-only, SSRF-guarded fetch of a public http(s) URL (a real
//     `HubBuiltinTool`). Fetched content is UNTRUSTED (`.claude/rules/mcp-and-security.md`).
// Both ride `HubToolGrants.builtins`. Neither is in `DEFAULT_CHAT_BUILTIN_NAMES` (so nothing is granted
// silently); a NEW top-level session gets them by capability-derived default only when its model
// supports search (`HUB_WEB_SEARCH_PROVIDER_KINDS`). The env kill-switch `HUB_WEB_TOOLS=off` removes both
// everywhere, including mission agents.
export const HUB_WEB_SEARCH_BUILTIN = "web.search" as const;
export const HUB_WEB_FETCH_BUILTIN = "web.fetch" as const;
export const HUB_WEB_BUILTIN_NAMES = [HUB_WEB_SEARCH_BUILTIN, HUB_WEB_FETCH_BUILTIN] as const;

// The provider kinds whose native model surface can back `web.search` (capability-derived — the UI + the
// composition seam both read this rather than branching on the kind ad hoc). `openai_compatible`/`ollama`
// have no native web search and are deliberately absent; `claude_subscription` is not an
// AI-SDK turn-engine kind, so it never reaches the web-tool composition path.
export const HUB_WEB_SEARCH_PROVIDER_KINDS = ["anthropic", "openai", "google"] as const;

// Approval option kinds offered on an approval card (R-MCP3 / R-UX1): grant this call once, or `always`
// (creates a session-scoped grant). `deny` is a universal terminal action (see HUB_APPROVAL_RESOLUTIONS)
// and is not an "option kind" the card enumerates.
export const HUB_APPROVAL_OPTION_KINDS = ["allow-once", "always"] as const;

// The terminal resolution of an approval (the R-UX1 `approval-responded` state): the chosen affirmative
// option, or a denial (→ `output-denied`). Auto-run (dial-approved) is marked by
// `HubToolApproval.isAutomatic`, not a distinct resolution.
export const HUB_APPROVAL_RESOLUTIONS = ["allow-once", "always", "deny"] as const;

// R-SES4 — the live task-widget item status (the `tasks.{create,update,list}` built-ins; each item has a
// status + dependencies, reconciled by id, event-sourced). Superseded by the mission plan/board in
// mission mode (never two competing lists).
export const HUB_TASK_STATUSES = [
  "pending",
  "in_progress",
  "completed",
  "blocked",
  "cancelled",
] as const;

// R-SES2 — the ordered typed message-part kinds a settled `assistant_message` persists (NO flat
// strings; renderers switch on part type/state). `tool_call` = a tool ref/part (the R-UX1 state
// machine, {@link HubToolPart}); `citation` refs the message's `citations[]`; `artifact_ref` refs an
// artifact version; `generative-ui` is a declarative UI widget (R-GUI3 — the "data widget").
export const HUB_MESSAGE_PART_TYPES = [
  "text",
  "reasoning",
  "tool_call",
  "citation",
  "artifact_ref",
  "generative-ui",
] as const;

// The actor behind an event / artifact version / review comment / memory row (author kind). `agent` = a
// mission child session; `system` = the hub itself (e.g. an auto-terminal or reconciliation marker).
export const HUB_ACTOR_KINDS = ["user", "assistant", "agent", "system"] as const;

// Mission lifecycle (§1.3 `hub_missions`): proposed → approved → running → synthesizing →
// completed | stopped | failed. A tripped hard budget stops cleanly and synthesizes partially, honestly
// marked (D-AH9 / R-UX9).
export const HUB_MISSION_STATUSES = [
  "proposed",
  "approved",
  "running",
  "synthesizing",
  "completed",
  "stopped",
  "failed",
] as const;

// Structured agent-report confidence (D-AH9 / R-UX9) — rendered VISIBLY in mission results alongside
// open questions; partial/budget-tripped synthesis is marked.
export const HUB_CONFIDENCE_LEVELS = ["low", "medium", "high"] as const;

// Typed artifact kinds (D-AH12) — versioned, with immutable versions in a side canvas.
export const HUB_ARTIFACT_KINDS = ["markdown", "code", "html", "table", "json"] as const;

// Artifact export formats (§1.4 `GET …/export?format=`). R-UX13's self-contained `share.html` is a
// distinct one-click canvas action (WP1.6), not a member of this route-param vocabulary.
export const HUB_ARTIFACT_EXPORT_FORMATS = ["md", "html", "json"] as const;

// Artifact review status + per-comment decision (D-AH12): a critic produces anchored comments; the user
// accepts/rejects per suggestion → a new version.
export const HUB_REVIEW_STATUSES = ["open", "resolved", "cancelled"] as const;
export const HUB_REVIEW_COMMENT_DECISIONS = ["pending", "accepted", "rejected"] as const;

// Content-addressed file link roles (§1.3 `hub_file_links`): an uploaded input · a pinned
// project/session context file · a file produced by the assistant/workspace.
export const HUB_FILE_LINK_ROLES = ["upload", "pinned", "produced"] as const;

// What a file link points AT (§1.3 `hub_file_links`).
export const HUB_FILE_LINK_TARGETS = ["project", "session", "message", "artifact"] as const;

// Workspace file-change kinds carried by the `workspace_file_changed` event (§1.3; the confined
// per-session workspace — read/written, NEVER executed, D-AH12).
export const HUB_WORKSPACE_CHANGE_KINDS = ["created", "modified", "deleted"] as const;

// Memory (D-AH11): a VISIBLE, editable store. Kind, provenance, and lifecycle status. The assistant may
// PROPOSE (source `assistant_proposed`, status `proposed`) — never write silently; the user saves →
// `active`; either can be `archived`. Nothing injected is hidden (D-AH11).
export const HUB_MEMORY_KINDS = ["profile", "preference", "instruction"] as const;
export const HUB_MEMORY_SOURCES = ["user", "assistant_proposed"] as const;
export const HUB_MEMORY_STATUSES = ["proposed", "active", "archived"] as const;

// The retry affordance surfaced on a `limit_error` (D-AH17 / R-SES11): the OTHER source to retry on —
// NEVER a silent switch (mirrors D-AS14). `api_key` ↔ `subscription`; `other_model` offers a model swap.
export const HUB_LIMIT_RETRY_SOURCES = ["api_key", "subscription", "other_model"] as const;

// Skills for the hub (WP2.4, R-SK3) — per-attachment invocation control. `model_invocable` (default):
// full name+description in the L1 catalog, callable via `skills.load`. `user_only`: excluded from the
// model's L1 catalog entirely — reachable ONLY via a `/skill-name` slash invocation (WP2.5's composer
// surface); the model never sees it exists. `name_only`: name (no description) in the L1 catalog, still
// callable via `skills.load` — the SAME state the R-SK1 listing-budget algorithm demotes a
// least-recently-invoked `model_invocable` entry TO when the catalog overflows its budget, so a manual
// `name_only` attachment and an auto-demoted one render identically.
export const HUB_SKILL_INVOCATION_MODES = ["model_invocable", "user_only", "name_only"] as const;

// --- Assistant Hub UX — additive closed vocabularies (planning/Roadmap/completed/RM-04-assistant-hub-ux/, WP0.1) ----------
// ADDITIVE ONLY (D-HUX16). These three closed unions are what every later Assistant-Hub-UX WP imports;
// nothing above changes. Old payloads (which never carried these fields) still parse — the new fields
// are optional on their entities' schemas.

// Memory SCOPE (D-HUX11 / D-HUX16, P3): memory dissolves into four scopes — `profile` (global, the
// pre-existing behavior an un-scoped row keeps), `project`, `agent`, `crew`. The most-specific scope
// wins at injection time; a scoped row also carries a `scopeId` naming its owning project/agent/crew
// (`profile` has none). An un-scoped legacy row reads as `profile` — WP1.5's migration backfills that.
export const HUB_MEMORY_SCOPES = ["profile", "project", "agent", "crew"] as const;

// Crew COLOR (D-HUX8 / D-HUX16): a saved crew's optional accent maps to one of the five theme-aware
// chart tokens (`--chart-1…5`), NEVER a raw color — the app's token discipline. The color renders only
// as small accents (avatar ring, a 3px card top-border, a dot beside names, an org-chart group tint),
// always paired with the crew name, never as a fill or as text color. Absent ⇒ no explicit accent.
export const HUB_CREW_COLORS = ["chart-1", "chart-2", "chart-3", "chart-4", "chart-5"] as const;

// Usage GROUP-BY (D-HUX10 / D-HUX16): the dimensions the workforce Usage tab rolls spend/tokens up by.
// `agent`/`crew`/`project` groupings carry an explicit unattributed "no agent" bucket (spend with no
// owning entity) so a total is never silently short; `model`/`mode` never have an unattributed bucket
// (every session has a model and a mode).
export const HUB_USAGE_GROUP_BYS = ["agent", "crew", "model", "project", "mode"] as const;

// --- Assistant Hub — validation limits (NOT env; env values live in config/env.ts) ---------------
// Small caps for names/titles so a request can't wedge the DB or UI. Bodies (system prompts, artifact
// content, memory content) are metered by the app's TokenCounter at runtime, not hard-capped here.
export const HUB_PROJECT_NAME_MAX_LENGTH = 200;
export const HUB_SESSION_TITLE_MAX_LENGTH = 200;
export const HUB_AGENT_NAME_MAX_LENGTH = 200;
export const HUB_CREW_NAME_MAX_LENGTH = 200;
export const HUB_ARTIFACT_TITLE_MAX_LENGTH = 300;
// A project's PINNED FILES (WP3.1, D-AH11c) — deliberately narrower than the general upload surface
// WP3.4 owns (`Files POST /api/hub/files`, execution-plan §1.4): these are user-typed/pasted TEXT
// snippets pinned to a project (no binary upload, no multipart), reusing the WP0.2 `hub_files`/
// `hub_file_links` tables (role `"pinned"`, targetKind `"project"`). The byte cap keeps a pinned
// snippet from silently blowing the LAYER 6b project-context prompt budget (`prompting/budgets.ts`).
export const HUB_PINNED_FILE_FILENAME_MAX_LENGTH = 200;
export const HUB_PINNED_FILE_MAX_BYTES = 200_000;

// WP3.4 (D-AH12, R-MCP7) — the upload size cap (the zip-bomb-guard PATTERN reused from
// `apps/api/src/skills/caps.ts`'s `SKILL_MAX_FILE_BYTES`, a hub-scoped constant rather than a shared
// import since uploads and skill trees are different domains). One file per upload request (mirrors
// the skills registration flow's own `files:1` multipart limit) — env-overridable via
// `HUB_FILE_MAX_BYTES` (`config/env.ts`).
export const HUB_FILE_MAX_BYTES = 20 * 1024 * 1024; // 20 MB per uploaded file
// Wave-3 adversarial-review F2 — the workspace-write size cap (SAME zip-bomb-guard pattern as
// `HUB_FILE_MAX_BYTES` above, applied to `hub/workspace.ts`'s `writeWorkspaceTextFile` instead of the
// upload route): a model-driven `files.write`/`files.edit` call and the R-MCP7 output-cap spill path
// both write ARBITRARY content into the session workspace, and neither had a byte ceiling. Smaller
// than the upload cap (a workspace file is model-generated text, not a user-selected upload) —
// env-overridable via `HUB_WS_MAX_FILE_BYTES` (`config/env.ts`).
export const HUB_WS_MAX_FILE_BYTES = 5_000_000; // 5 MB per workspace file (default)
// A text attachment inlined into the model's context (WP3.4 multimodal pass-through) is truncated at
// this many characters with an explicit "(truncated)" note — never silently blown past into a huge,
// uncapped prompt. Binary/image files never inline as text (see `turn-engine.ts`'s attachment resolver).
export const HUB_ATTACHMENT_TEXT_INLINE_MAX_CHARS = 20_000;

// WP3.5 (D-AH12, D-AH7) — a critic review run's comment-count cap: bounds the review-comment-proposal
// structured-output call (`apps/api/src/hub/routes.ts`'s local `hubReviewCommentsProposalSchema`) so a
// single review request can't wedge the DB or the review panel with an unbounded comment list.
export const HUB_REVIEW_MAX_COMMENTS = 12;

// Crew nesting (WP0.1 / D-CN10) — the aggregate-bound caps for a hierarchical (runtime-recursive)
// mission. `HUB_MISSION_MAX_DEPTH` is how many nesting levels a mission tree may span: `2` = the root
// mission + one nested level; `1` reproduces today's flat, single-level semantics.
// `HUB_MISSION_MAX_TOTAL_AGENTS` caps the total agent count across the WHOLE nested tree. These are the
// SHARED validation-facing defaults; WP0.3 layers env overrides (`HUB_MISSION_MAX_DEPTH` /
// `HUB_MISSION_MAX_TOTAL_AGENTS`, via `apps/api/src/config/env.ts`) on top.
export const HUB_MISSION_MAX_DEPTH = 2;
export const HUB_MISSION_MAX_TOTAL_AGENTS = 24;

// --- Advisor — deterministic recommendation contract (WP 1.1) ---------------------------------
// planning/Roadmap/RM-01-advisor/. The advisor is a READ MODEL over data the app already persists (`mcp_scans` /
// `mcp_tool_scans`, `runs` / `run_steps`, `scenarios`, and later `run_grades`) that turns those
// measurements into evidenced recommendations. This WP lands the wire contract + the rule-engine
// seam ONLY — the four deterministic rules and `GET /api/advisor/*` are WP 1.2.

// The advisor algorithm version, stamped on every `AdvisorReport` — mirrors
// `TOKEN_COUNTING_VERSION` / `GRADING_VERSION` / `AUTO_RATING_VERSION`'s never-silently-compare
// rule: recommendations produced under different advisor versions are never directly compared,
// merged, or diffed. Bump whenever a rule's method, its savings arithmetic, or the report's
// ordering/dedup semantics change.
export const ADVISOR_VERSION = 1;

// What an `AdvisorReport` was computed over: one server, one scenario, or the whole fleet.
export const ADVISOR_SCOPE_KINDS = ["server", "scenario", "fleet"] as const;

// The entity kinds an `AdvisorEvidenceRef` may point at. Every recommendation cites at least one —
// the advisor never asserts a finding the operator cannot drill into (README invariant 1).
export const ADVISOR_EVIDENCE_KINDS = [
  "scan",
  "tool_scan",
  "run",
  "scenario",
  "server",
  "skill",
] as const;

// A recommendation's severity. **The array order IS the sort rank** (index 0 sorts first), so the
// engine's documented "severity desc" ordering derives from this one list rather than a re-hardcoded
// map — append a new severity only where its rank belongs.
export const ADVISOR_SEVERITIES = ["high", "medium", "info"] as const;

// The unit an `AdvisorSavings` estimate is expressed in. **The array order IS the sort rank**: the
// engine groups by unit before comparing values, because savings in different units are NEVER
// converted into one another (no pricing is applied behind the operator's back). Keeping the
// comparator unit-major is what makes the "savings desc" tie-break a strict total order.
export const ADVISOR_SAVINGS_UNITS = ["tokens_per_turn", "tokens", "usd_per_run"] as const;

// --- Advisor — grade-aware rules (WP 2.1) -----------------------------------------------------
// planning/Roadmap/RM-01-advisor/phase-2-grade-aware/. Phase 2 joins the deterministic read model to the graded
// side of the app (`run_grades` + `suite_runs`). Two things make that join honest:
//   * a grade-aware finding carries `AdvisorGradeProvenance` — `GRADING_VERSION` plus the suite-run
//     ids it read — so a recommendation computed under one grading version is never silently
//     compared with one computed under another (the same discipline `ADVISOR_VERSION` applies to
//     the rules themselves); and
//   * a rule that has no graded evidence emits an `insufficientData` entry, never a suggestion.

/**
 * The score a run must reach to count as "quality held" (0..1, inclusive).
 *
 * NOT a new threshold: it is the SAME 0.5 the suite aggregates already treat as passing
 * (`SuiteAggregates.passRateAt05`, computed as `score >= 0.5` in the suite orchestrator). The
 * advisor reuses that number, and its `>=` comparison, so a "clears the quality bar" claim in a
 * recommendation means exactly what a green pass-rate means everywhere else in the app.
 */
export const ADVISOR_QUALITY_BAR = 0.5;

// --- Advisor — fleet report (WP 2.2) ----------------------------------------------------------
// planning/Roadmap/RM-01-advisor/phase-2-grade-aware/WP-2.2-fleet-report.md. `GET /api/reports/fleet/{json,
// markdown}` is an aggregate of what the app has ALREADY measured — servers + scan drift,
// environment costs, suite grades, a posture summary when one exists — plus the fleet-scope advisor
// recommendations. It is stamped `ADVISOR_VERSION` (above): the report is only as reproducible as
// the advisor method that produced its advice, so the two version together.

// How many suite runs the fleet report lists (most recent first). A long-lived install accumulates
// thousands; an unbounded list would make the Markdown export unreadable and the JSON enormous. The
// report always states the FULL count alongside the truncated list, so the cap never reads as
// "that's all there is".
export const FLEET_REPORT_SUITE_RUN_LIMIT = 20;
