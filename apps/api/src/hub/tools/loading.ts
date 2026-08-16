// Assistant Hub (WP0.5, §1.6, R-MCP2) — deferred tool-loading resolution + MEASURED resident-vs-total
// definition tokens (the dogfood requirement: "wherever a SOTA harness manages token budgets blindly,
// the Hub shows the measured numbers"). Uses the app's OWN `TokenCounter.countToolDefinition` — the
// SAME code path the Scans feature uses to report a tool's footprint — so the "~85%-savings story" is
// backed by real numbers, not a guess.
//
// `ToolLoadingMode` (`"eager" | "deferred"`, from `TOOL_LOADING_MODES`) is the WIRE vocabulary
// (WP0.1). `"auto"` is NOT a member of that shared enum — it's a Hub-internal RESOLUTION INPUT this
// module collapses into one of the two real modes by measuring the granted catalog against a fraction
// of the model's context window. Where the actual per-session "eager/deferred/auto" preference is
// persisted (today: nowhere — WP0.2 didn't add a session column for it) is a later WP's call; this
// module only needs the preference VALUE, supplied by the caller (defaults to `config.hubToolLoadingDefault`).
import type {
  HubServerToolGrant,
  NormalizedToolDefinition,
  ToolLoadingMode,
} from "@mcp-token-footprint/shared";
import type { TokenCounter } from "../../token-counting/types.js";

/** The Hub-internal loading PREFERENCE — a superset of the wire `ToolLoadingMode` with `"auto"`. */
export type HubToolLoadingPreference = ToolLoadingMode | "auto";

/** WP1.1 (D-HF1) — the default absolute cap (tokens) on the `auto`-resolves-eager threshold, mirroring
 *  the `HUB_TOOL_EAGER_MAX_TOKENS` env default. The session-service applies it whenever the config
 *  doesn't thread an explicit override, so `auto`'s "eager under the threshold" behavior is active by
 *  default even before the env override is wired at the composition root. */
export const DEFAULT_HUB_EAGER_MAX_TOKENS = 40_000;

/** One MCP tool candidate for the loading calculation — just enough to price + pin it. Both
 *  `HubResolvedMcpTool` (mcp-bridge.ts) and a bare `{serverId, def}` satisfy this structurally. */
export type HubToolLoadingInput = { serverId: string; def: NormalizedToolDefinition };

/** Per-server/per-tool "always resident even in deferred mode" pins — same shape as
 *  `HubToolGrants.servers` (`"all"` | an explicit tool-name allowlist), keyed by serverId. */
export type HubAlwaysLoadPins = Record<string, HubServerToolGrant>;

export function isAlwaysLoaded(
  pins: HubAlwaysLoadPins | undefined,
  serverId: string,
  toolName: string,
): boolean {
  if (!pins) return false;
  const grant = pins[serverId];
  if (!grant) return false;
  return grant === "all" || grant.includes(toolName);
}

export type ToolLoadingResolution = {
  /** The RESOLVED wire mode — `"auto"` never appears here, it always collapses to one of these. */
  mode: ToolLoadingMode;
  /** Token cost if EVERY granted tool definition were resident (the full catalog, eager-equivalent). */
  totalTokens: number;
  /** Token cost of what's ACTUALLY resident given the resolved `mode` (+ alwaysLoad pins). */
  residentTokens: number;
  /** `(1 - residentTokens/totalTokens) * 100`, rounded to 1 decimal; 0 when `totalTokens` is 0. */
  savingsPercent: number;
};

export type ResolveToolLoadingOptions = {
  tokenCounter: TokenCounter;
  /** The target model's context window (tokens) — `MODEL_CONTEXT_LIMITS[modelId]`. */
  contextWindow: number;
  /** The `auto` heuristic's threshold fraction of `contextWindow` (env `HUB_TOOL_SEARCH_AUTO_FRACTION`). */
  autoFraction: number;
  /**
   * WP1.1 (D-HF1) — an ABSOLUTE upper bound (tokens) on the `auto`-resolves-eager threshold (env
   * `HUB_TOOL_EAGER_MAX_TOKENS`, default 40_000 at the call site). When set, `auto` resolves `eager`
   * iff the granted catalog fits within `min(contextWindow * autoFraction, eagerMaxTokens)` — so a huge
   * context window can never let a large catalog load eager and blow the budget. Absent ⇒ the pure
   * fraction heuristic (pre-WP1.1 behavior, unchanged).
   */
  eagerMaxTokens?: number;
  alwaysLoad?: HubAlwaysLoadPins;
};

/**
 * Resolve a loading preference into a concrete mode + MEASURED token numbers. `granted` is the
 * already grant-filtered MCP tool set (post `grants.ts`/`mcp-bridge.ts`) — this function doesn't know
 * or care about grants, only pricing + the auto heuristic + alwaysLoad pins.
 */
export async function resolveToolLoading(
  preference: HubToolLoadingPreference,
  granted: readonly HubToolLoadingInput[],
  opts: ResolveToolLoadingOptions,
): Promise<ToolLoadingResolution> {
  const perToolTokens = await Promise.all(
    granted.map((item) => opts.tokenCounter.countToolDefinition(item.def)),
  );
  const totalTokens = perToolTokens.reduce((sum, breakdown) => sum + breakdown.totalTokens, 0);

  const fractionThreshold = opts.contextWindow * opts.autoFraction;
  const autoThreshold =
    opts.eagerMaxTokens !== undefined
      ? Math.min(fractionThreshold, opts.eagerMaxTokens)
      : fractionThreshold;
  const mode: ToolLoadingMode =
    preference === "auto" ? (totalTokens <= autoThreshold ? "eager" : "deferred") : preference;

  let residentTokens: number;
  if (mode === "eager") {
    residentTokens = totalTokens;
  } else {
    residentTokens = granted.reduce((sum, item, index) => {
      const pinned = isAlwaysLoaded(opts.alwaysLoad, item.serverId, item.def.name);
      return pinned ? sum + perToolTokens[index]!.totalTokens : sum;
    }, 0);
  }

  const savingsPercent =
    totalTokens > 0 ? Math.round((1 - residentTokens / totalTokens) * 1000) / 10 : 0;

  return { mode, totalTokens, residentTokens, savingsPercent };
}
