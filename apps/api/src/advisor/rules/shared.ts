// Helpers shared by the four deterministic advisor rules (WP 1.2).
//
// Everything here reads ONLY through the {@link AdvisorContext} ports — no DB handle, no MCP, no
// secrets (planning/Roadmap/RM-01-advisor/conventions.md, runtime boundary). Every helper that returns a list
// imposes its OWN total order rather than trusting the repository's `ORDER BY`, because the report's
// determinism contract (engine.ts) is only as strong as the order of the data the rules walk:
// `ServerRepository.list()` orders by `updated_at DESC`, which ties freely, and SQLite makes no
// promise about the order of tied rows.

import type {
  AdvisorScope,
  RunSummary,
  ScanDetail,
  ScanSummary,
  Scenario,
  ServerConfig,
  ToolScan,
} from "@mcp-token-footprint/shared";
import type { AdvisorContext } from "../types.js";

// The evidence caps, the severity bands and every other advisor threshold live in
// `data-pack/advisor/thresholds.json` since RM-38 WP 2.2 — read them through `advisorThresholds()`
// from `../../data-pack/thresholds.js`. There is deliberately NO compiled fallback: the pack's JSON
// Schema marks every key required and the loader refuses a pack that omits one, so a missing
// threshold is a refused pack rather than a silently disabled band.
//
// (What used to be here: `EVIDENCE_TOOL_LIMIT = 10` — how many `tool_scan` evidence refs a single
// recommendation may carry, because a server can expose hundreds of tools and an unbounded evidence
// array would bloat every report for no extra insight; and `EVIDENCE_RUN_LIMIT = 3`, the same
// reasoning for `run` refs.)

/** Ascending string compare with no locale in play — `localeCompare` is locale-sensitive and would
 *  make report ordering depend on the machine's ICU data, which the determinism contract forbids. */
export function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Digit grouping that does not go through `toLocaleString` (same ICU-independence reasoning). */
export function formatCount(value: number): string {
  const rounded = Math.round(value);
  const negative = rounded < 0;
  const digits = Math.abs(rounded).toString();
  let grouped = "";
  for (let i = 0; i < digits.length; i += 1) {
    if (i > 0 && (digits.length - i) % 3 === 0) grouped += ",";
    grouped += digits[i];
  }
  return negative ? `-${grouped}` : grouped;
}

/** A fraction in [0,1] rendered as a one-decimal percentage (`0.6125` → `"61.3%"`). */
export function formatPercent(fraction: number): string {
  if (!Number.isFinite(fraction)) return "n/a";
  return `${(fraction * 100).toFixed(1)}%`;
}

/** Guarded division: `0` denominators yield `0` rather than `Infinity`/`NaN`, so a savings figure
 *  can never leave a rule as a non-finite number (which the engine would reject anyway). */
export function ratio(numerator: number, denominator: number): number {
  if (denominator === 0) return 0;
  const value = numerator / denominator;
  return Number.isFinite(value) ? value : 0;
}

export function sumBy<T>(items: readonly T[], pick: (item: T) => number): number {
  let total = 0;
  for (const item of items) total += pick(item);
  return total;
}

/**
 * The most recent SUCCESSFUL scan of a server, fully hydrated — or `null` when the server has never
 * been scanned successfully.
 *
 * Deliberately NOT `ScanPort.getLatestForServer`: that returns the newest scan of ANY status, so a
 * server whose last scan failed (or is still running) would hand a rule a row with zeroed totals,
 * and a rule reading `totalTokens = 0` off a failed scan would publish a fabricated measurement.
 */
export function latestSuccessfulScan(ctx: AdvisorContext, serverId: string): ScanDetail | null {
  const summaries = [...ctx.scans.listSummariesByServer(serverId)]
    .filter((scan) => scan.status === "success")
    .sort(compareScansNewestFirst);
  const newest = summaries[0];
  return newest ? ctx.scans.getDetail(newest.id) : null;
}

/** Newest first, with the scan id as the tie-break so two scans stamped the same instant still have
 *  one defined order. */
function compareScansNewestFirst(a: ScanSummary, b: ScanSummary): number {
  const byTime = compareStrings(b.scannedAt, a.scannedAt);
  return byTime !== 0 ? byTime : compareStrings(a.id, b.id);
}

/** Every configured server keyed by id. Rules resolve names through this instead of `getPublic`,
 *  which throws a 404 for an id that no longer exists — a rule reports a gap, it does not throw. */
export function serversById(ctx: AdvisorContext): Map<string, ServerConfig> {
  const map = new Map<string, ServerConfig>();
  for (const server of ctx.servers.list()) map.set(server.id, server);
  return map;
}

/** Environments in a fixed order (by id), regardless of the repository's `updated_at DESC`. */
export function allScenarios(ctx: AdvisorContext): Scenario[] {
  return [...ctx.scenarios.list()].sort((a, b) => compareStrings(a.id, b.id));
}

/** The scans' tools, biggest first, with the tool name as the tie-break. */
export function toolsByTokensDesc(tools: readonly ToolScan[]): ToolScan[] {
  return [...tools].sort((a, b) => {
    if (b.totalTokens !== a.totalTokens) return b.totalTokens - a.totalTokens;
    return compareStrings(a.toolName, b.toolName);
  });
}

/**
 * The tools of `scan` an environment actually exposes: `allowedTools === null` means "all of them"
 * (the `scenario_servers.allowed_tools_json` NULL convention), otherwise only the named ones. Names
 * in the allow-list that the scan does not contain are dropped — the advisor reports on tools it
 * measured, never on a name it merely saw in a config.
 */
export function allowedToolsOf(scan: ScanDetail, allowedTools: string[] | null): ToolScan[] {
  if (allowedTools === null) return toolsByTokensDesc(scan.tools);
  const allowed = new Set(allowedTools);
  return toolsByTokensDesc(scan.tools.filter((tool) => allowed.has(tool.toolName)));
}

/** An environment's COMPLETED runs, newest first (id tie-break). Only `completed` runs are evidence
 *  of behavior: a run that errored or was stopped mid-flight says nothing about which tools the
 *  model would eventually have needed. */
export function completedRuns(ctx: AdvisorContext, scenarioId: string): RunSummary[] {
  return [...ctx.runs.listRuns({ scenarioId, status: "completed" })].sort((a, b) => {
    const byTime = compareStrings(b.startedAt, a.startedAt);
    return byTime !== 0 ? byTime : compareStrings(a.id, b.id);
  });
}

/**
 * How many times each tool NAME was called across `runs`.
 *
 * Name-keyed on purpose. `run_steps` records both `server_id` and `tool_name`, but the advisor's
 * run port exposes the ordered NAME sequence, and a name is what the model actually emitted. The
 * consequence is stated as an assumption on every finding that uses this: when two of an
 * environment's servers expose the same tool name, a call counts as usage on BOTH. That errs in the
 * only safe direction — it can hide a trim, never invent one.
 */
export function toolCallCounts(
  ctx: AdvisorContext,
  runs: readonly RunSummary[],
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const run of runs) {
    for (const name of ctx.runs.getToolCallSequence(run.id)) {
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
  }
  return counts;
}

/** Whether two scans were produced by the same counting method, i.e. whether their token numbers may
 *  be added together at all (`TOKEN_COUNTING_VERSION` discipline — CLAUDE.md §7). */
export function comparablyCounted(a: ScanSummary, b: ScanSummary): boolean {
  return a.tokenProfile === b.tokenProfile && a.countingVersion === b.countingVersion;
}

/** "scan `<id>` (profile `<p>`, counting version `<v>`)" — the provenance every savings basis carries
 *  so the number can be reproduced from the exact rows it came from. */
export function scanProvenance(scan: ScanSummary): string {
  return `scan ${scan.id} (profile ${scan.tokenProfile}, counting version ${scan.countingVersion})`;
}

/** English pluralization for the one-line titles/details. */
export function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return count === 1 ? singular : pluralForm;
}

/**
 * The environments a scope covers, in a fixed order: the one named environment, every environment
 * (fleet), or none at all (a server scope has no environment attached to it — the rule simply has
 * nothing to say there, which is why the run-dependent rules do not `appliesTo` it).
 *
 * The named-environment lookup goes through the port's `get`, which throws a 404 for an unknown id —
 * safe here because the route's service resolves (and 404s) the id BEFORE the engine runs.
 */
export function scenariosInScope(ctx: AdvisorContext, scope: AdvisorScope): Scenario[] {
  if (scope.kind === "fleet") return allScenarios(ctx);
  if (scope.kind === "scenario" && scope.id !== undefined) return [ctx.scenarios.get(scope.id)];
  return [];
}

/**
 * The server ids a scope covers, ascending: the named server, an environment's allow-listed servers,
 * or every configured server (fleet).
 */
export function serverIdsInScope(ctx: AdvisorContext, scope: AdvisorScope): string[] {
  if (scope.kind === "server") return scope.id === undefined ? [] : [scope.id];
  if (scope.kind === "scenario") {
    const [scenario] = scenariosInScope(ctx, scope);
    if (!scenario) return [];
    return scenario.allowedServers.map((entry) => entry.serverId).sort(compareStrings);
  }
  return ctx.servers
    .list()
    .map((server) => server.id)
    .sort(compareStrings);
}
