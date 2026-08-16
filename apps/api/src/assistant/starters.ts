// Assistant Refinement R3 (WP R3.1) — the DATA-AWARE half of `GET /api/assistant/starters`
// (D-AS27/D-AS28/D-AS29). The shared catalog (`packages/shared/src/assistant-starters.ts`) owns the
// STATIC text; this module resolves the current surface, computes which `[?cond]` conditionals hold
// from CHEAP, READ-ONLY, deterministic repository reads, and assembles the final list — modeled on
// the `deriveNextSteps` rule engine (`apps/web/src/features/testing/compare/next-steps/`): each rule
// fires only when the data actually supports it, and the whole function is pure given its `deps` +
// query (no LLM, no writes, no migration — see the R3 plan's hard rules).
//
// Scope-consistent (D-AS29): every `kind: "action"` starter is scope-filtered against
// `SCOPE_WRITE_TOOLS[surface]` before the response leaves this function — belt-and-braces on top of
// the fact that the catalog is already authored to only place an action where it's in scope (proven
// by `apps/api/test/assistant-starters-catalog.test.ts`'s catalog + conditional-registry cross-check).
// Non-entity surfaces (`global`, `compatibility`) have no `SCOPE_WRITE_TOOLS` entry at all, so EVERY
// action starter is dropped for them unconditionally.
//
// Every conditional this service emits is pulled from the shared `ASSISTANT_CONDITIONAL_STARTERS`
// registry via {@link conditional} (never a loose named import), so a conditional it can emit is
// necessarily in that registry — which the catalog test walks. That's the structural guarantee a new
// conditional action starter can't escape the scope check.
import {
  ASSISTANT_CONDITIONAL_STARTERS,
  ASSISTANT_ENTITY_KINDS,
  ASSISTANT_STARTER_CATALOG,
  ASSISTANT_STARTERS_VERSION,
  SCOPE_WRITE_TOOLS,
  SKILL_TAB_STARTERS,
  buildGlobalDebugFailedScansStarter,
  resolveStarterSurface,
  type AssistantEntityKind,
  type AssistantStarter,
  type AssistantStartersQueryInput,
  type AssistantStartersResponse,
  type AssistantStarterSurface,
} from "@mcp-token-footprint/shared";
import type { ScanRepository } from "../scans/repository.js";
import type { ServerRepository } from "../servers/repository.js";
import type { SkillRepository } from "../skills/repository.js";
import type { SuiteRunRepository } from "../suites/suite-run-repository.js";
import type { RunRepository } from "../testing/run-repository.js";

/**
 * The (small) subset of repository handles + config values `deriveStarters` actually reads. A
 * narrower bag than `AssistantToolDeps` (the read-toolset's dependency bag in `tools/index.ts`) on
 * purpose — this service only ever does cheap point/list reads, never the tool-shaped adapters.
 */
export interface StarterDeps {
  scans: ScanRepository;
  servers: ServerRepository;
  runs: RunRepository;
  suiteRuns: SuiteRunRepository;
  skills: SkillRepository;
  /** Skill IDE quality-engine L2 (body) token ceiling — `config.skillQualityL2TokenCeiling`. Used
   *  ONLY by the cheap "L2 over budget" conditional; see the quality-conditional skip note below. */
  skillQualityL2TokenCeiling: number;
}

/** The catalog shape `deriveStarters` reads its base sets from — the real
 *  {@link ASSISTANT_STARTER_CATALOG} in production, override only in tests (see the `catalog` param). */
export type StarterCatalog = Readonly<Record<AssistantStarterSurface, readonly AssistantStarter[]>>;

// ── Tunable thresholds for the "low pass rate" conditionals ──────────────────────────────────────
// The plan names the conditions ("recent run pass-rate low", "pass-rate low") but does not pin exact
// numbers; these are this WP's documented choices, not a re-derivation of an existing constant.

/** Below this fraction of terminal runs/cells completing successfully, a pass-rate is "low". */
const LOW_PASS_RATE_THRESHOLD = 0.5;
/** Global "recent run pass-rate low" needs at least this many TERMINAL runs in the recent window to
 *  fire — avoids a single failed run flagging a false "drop" with no real trend behind it. */
const MIN_TERMINAL_RUNS_FOR_PASS_RATE = 5;
/** How many of the most-recent runs (bounded at the SQL level via `listRuns({ limit })`) count as
 *  "recent" for the global pass-rate conditional. Bounded so the read stays cheap regardless of the
 *  total run history size. */
const RECENT_RUNS_WINDOW = 20;

/**
 * Lookup for the data-aware conditional starters, built ONCE from the shared registry
 * ({@link ASSISTANT_CONDITIONAL_STARTERS}). The service can only emit a conditional that exists in the
 * registry (see {@link conditional}), so every conditional it emits is covered by the D-AS29 catalog
 * cross-check — the structural guarantee for FIX 1.
 */
const CONDITIONAL_STARTERS_BY_ID: ReadonlyMap<string, AssistantStarter> = new Map(
  ASSISTANT_CONDITIONAL_STARTERS.map((entry) => [entry.starter.id, entry.starter]),
);

/** Pull a conditional starter from the shared registry by id. Throws on an unknown id — a programming
 *  error (the id must name a real {@link ASSISTANT_CONDITIONAL_STARTERS} entry), never a data error. */
function conditional(id: string): AssistantStarter {
  const starter = CONDITIONAL_STARTERS_BY_ID.get(id);
  if (!starter) throw new Error(`unknown conditional starter id: ${id}`);
  return starter;
}

/**
 * Compute the starter list for one `GET /api/assistant/starters` request. Pure given `deps` (all
 * reads; no mutation) — same query + same DB state always yields the same response (deterministic,
 * per D-AS28). Never throws on a stale/missing `entityId` (a starters fetch is best-effort UI sugar,
 * not a hard entity lookup) — a conditional whose read fails is simply skipped, and the base set for
 * the resolved surface is still returned.
 *
 * `catalog` is a TEST-ONLY seam defaulting to the real {@link ASSISTANT_STARTER_CATALOG}; a test may
 * inject a crafted catalog to prove the runtime scope-filter actually strips an out-of-scope action
 * starter (FIX 2). Production callers never pass it.
 */
export function deriveStarters(
  deps: StarterDeps,
  query: AssistantStartersQueryInput,
  catalog: StarterCatalog = ASSISTANT_STARTER_CATALOG,
): AssistantStartersResponse {
  const surface = resolveStarterSurface({ entityKind: query.entityKind, route: query.route });
  const starters: AssistantStarter[] = [];
  const seenIds = new Set<string>();

  const push = (starter: AssistantStarter | undefined) => {
    if (!starter || seenIds.has(starter.id)) return;
    seenIds.add(starter.id);
    starters.push(starter);
  };

  // 1) Skill tab override — surfaced first, ahead of both conditionals and the base set.
  if (surface === "skill" && query.tab) {
    for (const tabStarter of SKILL_TAB_STARTERS[query.tab] ?? []) push(tabStarter);
  }

  // 2) Data-aware conditionals — only when an entity is actually pinned (except the two global ones,
  //    which read across servers/runs and need no single entityId).
  for (const fired of computeConditionals(deps, surface, query.entityId)) push(fired);

  // 3) The surface's base set.
  for (const base of catalog[surface]) push(base);

  // 4) Scope-filter (D-AS29 belt-and-braces): drop any action starter whose writeTool isn't actually
  //    in scope for this surface. Non-entity surfaces (global/compatibility) have no SCOPE_WRITE_TOOLS
  //    entry — every action is dropped for them.
  const allowedWriteTools = new Set(isScopableSurface(surface) ? SCOPE_WRITE_TOOLS[surface] : []);
  const scoped = starters.filter(
    (starter) => starter.kind !== "action" || allowedWriteTools.has(starter.writeTool ?? ""),
  );

  return { version: ASSISTANT_STARTERS_VERSION, surface, starters: scoped };
}

/** True only for a real {@link AssistantEntityKind} — the write-scope security boundary
 *  (`SCOPE_WRITE_TOOLS` is keyed by entity kind only, D-AO3). MUST exclude every non-entity-kind
 *  surface (`global`, `compatibility`, and the route-keyed `hub`/`agents` surfaces from
 *  assistant-operability WP 2.1) — indexing `SCOPE_WRITE_TOOLS[surface]` for any of them would be
 *  `undefined` and throw below. Previously implemented as an exclusion list (`!== "global" &&
 *  !== "compatibility"`), which silently broke the moment `hub`/`agents` were added as new
 *  non-entity-kind surfaces; checking membership in {@link ASSISTANT_ENTITY_KINDS} instead is
 *  correct-by-construction for any future non-entity-kind surface too. */
function isScopableSurface(surface: AssistantStarterSurface): surface is AssistantEntityKind {
  return (ASSISTANT_ENTITY_KINDS as readonly string[]).includes(surface);
}

/** Every conditional this WP implements, keyed by the surface it applies to. See the module banner +
 *  the individual helpers below for what was SKIPPED and why. */
function computeConditionals(
  deps: StarterDeps,
  surface: AssistantStarterSurface,
  entityId: string | undefined,
): AssistantStarter[] {
  switch (surface) {
    case "global":
      return [globalDebugFailedScans(deps), globalWhyAreRunsFailing(deps)].filter(isDefined);
    case "server":
      return entityId ? [serverDebugFailedScan(deps, entityId)].filter(isDefined) : [];
    case "scan":
      return entityId ? [scanWhyDidItFail(deps, entityId)].filter(isDefined) : [];
    case "skill":
      return entityId ? [skillSplitOversizedBody(deps, entityId)].filter(isDefined) : [];
    case "run":
      return entityId ? runConditionals(deps, entityId) : [];
    case "suite_run":
      return entityId ? [suiteRunInvestigateFailures(deps, entityId)].filter(isDefined) : [];
    default:
      // compare, collection, compatibility, scenario, test: no conditionals authored in the R3 plan.
      return [];
  }
}

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
}

/** Swallow a lookup failure (e.g. a stale/deleted entityId — the 404 repositories throw) so one bad
 *  conditional read can never take down the whole starters response. */
function tryRead<T>(fn: () => T): T | undefined {
  try {
    return fn();
  } catch {
    return undefined;
  }
}

/** The status of a server's most-recent scan, read from a SUMMARY (no child-table hydration). Uses
 *  `listSummariesByServer(id)[0]` (ordered `scanned_at DESC`) rather than `getLatestForServer`, whose
 *  `getDetail` hydration runs 4 extra child-table queries + full tool-inventory mapping just to read
 *  one status column — wasteful on the dashboard's per-server loop (FIX 3). */
function latestScanStatus(deps: StarterDeps, serverId: string): string | undefined {
  const summaries = tryRead(() => deps.scans.listSummariesByServer(serverId));
  return summaries?.[0]?.status;
}

// ── global ────────────────────────────────────────────────────────────────────────────────────────

/** `[?any server's latest scan failed]` — cheap: one status-only summary read per server (see
 *  {@link latestScanStatus}), bounded by the number of configured servers (a local dev tool's server
 *  count, not a large fleet). The count-interpolated prompt is re-derived over the registry entry's
 *  stable id/label/kind. */
function globalDebugFailedScans(deps: StarterDeps): AssistantStarter | undefined {
  const servers = tryRead(() => deps.servers.list()) ?? [];
  let failedCount = 0;
  for (const server of servers) {
    if (latestScanStatus(deps, server.id) === "failed") failedCount += 1;
  }
  if (failedCount === 0) return undefined;
  // id/label/kind sourced from the shared registry; only the count text is interpolated (the one
  // dynamic starter — see the registry's doc), so it stays covered by the conditional-registry test.
  return {
    ...conditional("global.debug-failed-scans"),
    prompt: buildGlobalDebugFailedScansStarter(failedCount).prompt,
  };
}

/** `[?recent run pass-rate low]` — the most recent {@link RECENT_RUNS_WINDOW} runs, bounded at the SQL
 *  level via `listRuns({ limit })` (newest-first). Pass = `outcome === "completed"` among TERMINAL runs
 *  (pending/running excluded — they haven't concluded yet, so they carry no pass/fail signal). Requires
 *  at least {@link MIN_TERMINAL_RUNS_FOR_PASS_RATE} terminal runs so one bad run can't flag a false trend. */
function globalWhyAreRunsFailing(deps: StarterDeps): AssistantStarter | undefined {
  const recent = tryRead(() => deps.runs.listRuns({ limit: RECENT_RUNS_WINDOW })) ?? [];
  const terminal = recent.filter((run) => run.status !== "pending" && run.status !== "running");
  if (terminal.length < MIN_TERMINAL_RUNS_FOR_PASS_RATE) return undefined;
  const passed = terminal.filter((run) => run.outcome === "completed").length;
  const passRate = passed / terminal.length;
  return passRate < LOW_PASS_RATE_THRESHOLD
    ? conditional("global.why-are-runs-failing")
    : undefined;
}

// ── server ────────────────────────────────────────────────────────────────────────────────────────

/** `[?last scan failed]` — one status-only summary read (see {@link latestScanStatus}). */
function serverDebugFailedScan(deps: StarterDeps, serverId: string): AssistantStarter | undefined {
  return latestScanStatus(deps, serverId) === "failed"
    ? conditional("server.debug-the-failed-scan")
    : undefined;
}

// ── scan ──────────────────────────────────────────────────────────────────────────────────────────

/** `[?scan failed]` — `getSummary` (not `getDetail`: the status field alone is enough, so skip the
 *  tool/resource/prompt row reads `getDetail` would also do). */
function scanWhyDidItFail(deps: StarterDeps, scanId: string): AssistantStarter | undefined {
  const summary = tryRead(() => deps.scans.getSummary(scanId));
  return summary?.status === "failed" ? conditional("scan.why-did-it-fail") : undefined;
}

// ── skill ─────────────────────────────────────────────────────────────────────────────────────────
// `[?quality score low]` is SKIPPED here (see `SKILL_FIX_QUALITY_FINDINGS_STARTER`'s doc in the
// shared catalog): `analyzeSkillQuality` needs the version's full SKILL.md parse, a graph projection,
// and an ASYNC L1/L2 token recount (`countLevels`) — real work, not a cheap per-request read, and this
// function is deliberately synchronous like the rest of the deriveNextSteps-style engine it mirrors.
// `[?L2 over budget]` stays IN because `SkillVersion` (from `SkillRepository.getVersion`) already
// carries its L2 subtotal as a plain persisted column — no recomputation needed.

/** `[?L2 over budget]` — resolve the skill's CURRENT version id (`getPublic(skillId).currentVersionId`
 *  — the envelope's entityId is the SKILL id, but the footprint lives on the VERSION), then compare
 *  its persisted `l2BodyTokens` to the configured ceiling. */
function skillSplitOversizedBody(deps: StarterDeps, skillId: string): AssistantStarter | undefined {
  const skill = tryRead(() => deps.skills.getPublic(skillId));
  const versionId = skill?.currentVersionId;
  if (!versionId) return undefined;
  const version = tryRead(() => deps.skills.getVersion(versionId));
  if (!version) return undefined;
  return version.l2BodyTokens > deps.skillQualityL2TokenCeiling
    ? conditional("skill.split-oversized-body")
    : undefined;
}

// ── run ───────────────────────────────────────────────────────────────────────────────────────────

/** `[?failed/errored]` / `[?context_overflow]` / `[?assertions_failed]` — all three read off the same
 *  `getSummary(runId)` call (status + outcome), so they're grouped into one repository read. */
function runConditionals(deps: StarterDeps, runId: string): AssistantStarter[] {
  const run = tryRead(() => deps.runs.getSummary(runId));
  if (!run) return [];
  const out: AssistantStarter[] = [];
  // "Did not finish successfully": a terminal failure status, OR an outcome the engine itself marks
  // as an error (status can still read "completed" while outcome is "error" in edge cases upstream).
  if (run.status === "error" || run.status === "aborted" || run.outcome === "error") {
    out.push(conditional("run.why-did-this-fail"));
  }
  if (run.outcome === "context_overflow") out.push(conditional("run.explain-the-overflow"));
  if (run.outcome === "assertions_failed") out.push(conditional("run.which-expectations-failed"));
  return out;
}

// ── suite_run ─────────────────────────────────────────────────────────────────────────────────────

/** `[?pass-rate low]` — `SuiteRun.aggregates.passRateAt05`, cached on the row (no recompute); only
 *  fires once at least one cell has actually completed (an all-pending suite run carries no signal). */
function suiteRunInvestigateFailures(
  deps: StarterDeps,
  suiteRunId: string,
): AssistantStarter | undefined {
  const suiteRun = tryRead(() => deps.suiteRuns.getRun(suiteRunId));
  const aggregates = suiteRun?.aggregates;
  if (
    !aggregates ||
    aggregates.cellsCompleted <= 0 ||
    aggregates.passRateAt05 === null ||
    aggregates.passRateAt05 === undefined
  ) {
    return undefined;
  }
  return aggregates.passRateAt05 < LOW_PASS_RATE_THRESHOLD
    ? conditional("suite_run.investigate-the-failures")
    : undefined;
}
