import type {
  ProviderCredential,
  RunFilter,
  RunSummary,
  Scenario,
  Suite,
  SuiteRun,
  Test,
} from "@mcp-token-footprint/shared";
import {
  apiGet,
  listScenarios,
  listSuiteRuns,
  listSuites,
  listTests,
  queryRunsFiltered,
} from "../../../lib/api";
import { isEmptyRunFilter } from "./run-filter-url";

/**
 * The unified Runs feed model (Testing IA WP 3.2). ONE feed carries two row kinds — standalone single
 * runs and suite-run **summaries** — merged newest-first. A suite run rolls its child runs up into a
 * summary row that expands to the member list and links to the existing suite-run console; its member
 * runs each drill into the single run console.
 *
 * The derivation here is PURE ({@link buildRunsFeed}) so it is unit-testable without React or the
 * network; {@link loadRunsFeed} is the thin loader that fetches the existing endpoints and folds them
 * through it. No new API is introduced — the feed is assembled client-side from
 * `GET /api/runs` + `GET /api/suite-runs` (+ suites/tests/scenarios/providers for labels).
 */

/** A standalone single run — a run NOT produced by a suite matrix (no `suiteRunId`). */
export type FeedRunItem = {
  kind: "run";
  /** `startedAt` in epoch ms — the merge sort key across both row kinds. */
  sortMs: number;
  run: RunSummary;
};

/** A suite run rolled up into a summary row, with its resolved member runs + axis counts. */
export type FeedSuiteItem = {
  kind: "suite";
  /** `startedAt` in epoch ms — the merge sort key across both row kinds. */
  sortMs: number;
  suiteRun: SuiteRun;
  /** The saved suite's name for a `source:'suite'` run; `null` for a `collection`/`adhoc` plan. */
  suiteName: string | null;
  /** Child runs (each `RunSummary.suiteRunId === suiteRun.id`), newest first. */
  members: RunSummary[];
  /** Distinct tests exercised (member-derived; falls back to the saved suite's membership). */
  testCount: number;
  /** Distinct environments (scenarios) exercised (member-derived; falls back to the suite). */
  environmentCount: number;
  /** Planned repetitions per cell, from the frozen config snapshot. */
  repetitions: number;
};

export type FeedItem = FeedRunItem | FeedSuiteItem;

export type RunsFeedData = {
  items: FeedItem[];
  tests: Test[];
  scenarios: Scenario[];
  providers: ProviderCredential[];
  /** Every suite (not just those with a run) — feeds the WP2.3 filter bar's Suite picker options. */
  suites: Suite[];
  testsById: Map<string, Test>;
  scenariosById: Map<string, Scenario>;
};

/** Distinct count of ids, ignoring falsy entries. */
function distinctCount(ids: string[]): number {
  return new Set(ids.filter(Boolean)).size;
}

/** Parse an ISO timestamp to epoch ms; unparseable → 0 so the row sorts last rather than crashing. */
function toMs(iso: string): number {
  const parsed = Date.parse(iso);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Fold the raw lists into the unified feed (PURE — no React/fetch). Single runs that belong to a suite
 * run (they carry a `suiteRunId`) are NESTED under that suite's summary and never surface as their own
 * top-level row; every other single run is a standalone row. Both kinds merge newest-first by
 * `startedAt`.
 */
export function buildRunsFeed(input: {
  runs: RunSummary[];
  suiteRuns: SuiteRun[];
  suites: Suite[];
  tests: Test[];
  scenarios: Scenario[];
  providers: ProviderCredential[];
  /**
   * Observability WP2.3 — the server-computed `RunFilter` match set (`GET /api/runs?filter=…`, the
   * ONLY place joined fields like model/server/skill/score/feedback and the WP1.3 FTS `q` can be
   * evaluated correctly). `null`/absent ⇒ no filter active, every run matches (today's behavior,
   * byte-unchanged). When provided: a standalone run is a top-level row iff it's IN this set (and its
   * `searchSnippet`/`searchMatchKind` — present on a `q` hit — are taken from here); a suite row is a
   * top-level row iff AT LEAST ONE of its members is (mirrors the existing facet-style "any member
   * matches" pattern `runs-table-model.ts` already uses for Environment). Suite MEMBER VISIBILITY when
   * expanded is intentionally UNFILTERED — always the complete membership, exactly as `SuiteMembersTab`/
   * the suite console render it — so a filter never silently truncates a suite's drill-down (WP2.3
   * "suite drill-down flow preserved UNTOUCHED").
   */
  matchedRuns?: RunSummary[] | null;
}): RunsFeedData {
  const { runs, suiteRuns, suites, tests, scenarios, providers, matchedRuns = null } = input;
  const suitesById = new Map(suites.map((suite) => [suite.id, suite]));
  const matchedById = matchedRuns ? new Map(matchedRuns.map((r) => [r.id, r])) : null;

  // Partition single runs: suite members (grouped by their suite run) vs. standalone.
  const membersBySuiteRun = new Map<string, RunSummary[]>();
  const standalone: RunSummary[] = [];
  for (const run of runs) {
    if (run.suiteRunId) {
      const list = membersBySuiteRun.get(run.suiteRunId);
      if (list) list.push(run);
      else membersBySuiteRun.set(run.suiteRunId, [run]);
    } else {
      standalone.push(run);
    }
  }

  const items: FeedItem[] = [];

  for (const run of standalone) {
    if (matchedById) {
      if (!matchedById.has(run.id)) continue;
    } else if (run.derivedFromRunId) {
      // Observability WP3.3 (D-OB18) — the DEFAULT (unfiltered) feed HIDES forks. When a filter is
      // active, the server-computed `matchedRuns` already applies the `derived` default-exclude (and a
      // `derived:true` "show forks" filter reveals them); this branch only covers the no-filter case,
      // whose base `/api/runs` (legacy `listRuns`) is derived-agnostic and would otherwise include them.
      continue;
    }
    // Prefer the filtered payload — it carries `searchSnippet`/`searchMatchKind` on a `q` hit.
    const resolved = matchedById?.get(run.id) ?? run;
    items.push({ kind: "run", sortMs: toMs(resolved.startedAt), run: resolved });
  }

  for (const suiteRun of suiteRuns) {
    const members = (membersBySuiteRun.get(suiteRun.id) ?? [])
      .slice()
      .sort((a, b) => toMs(b.startedAt) - toMs(a.startedAt));
    if (matchedById && !members.some((m) => matchedById.has(m.id))) continue;
    const suite = suiteRun.suiteId ? suitesById.get(suiteRun.suiteId) : undefined;
    const testCount = distinctCount(members.map((m) => m.testId)) || suite?.testIds.length || 0;
    const environmentCount =
      distinctCount(members.map((m) => m.scenarioId)) || suite?.scenarioIds.length || 0;
    items.push({
      kind: "suite",
      sortMs: toMs(suiteRun.startedAt),
      suiteRun,
      suiteName: suite?.name ?? null,
      members,
      testCount,
      environmentCount,
      repetitions: suiteRun.configSnapshot.repetitions,
    });
  }

  // Merge newest-first; ties broken by kind then id for a stable order across reloads.
  items.sort((a, b) => {
    if (b.sortMs !== a.sortMs) return b.sortMs - a.sortMs;
    const aId = a.kind === "run" ? a.run.id : a.suiteRun.id;
    const bId = b.kind === "run" ? b.run.id : b.suiteRun.id;
    return aId < bId ? 1 : aId > bId ? -1 : 0;
  });

  return {
    items,
    tests,
    scenarios,
    providers,
    suites,
    testsById: new Map(tests.map((test) => [test.id, test])),
    scenariosById: new Map(scenarios.map((scenario) => [scenario.id, scenario])),
  };
}

/**
 * Load everything the unified Runs feed needs from the EXISTING endpoints (no new API) and fold it
 * through {@link buildRunsFeed}. Fetched in parallel: single runs, suite runs, suites (names),
 * tests + scenarios (labels), and provider credentials (for the new-run picker) — PLUS, only when
 * `filter` actually narrows anything (Observability WP2.3), the server-computed filtered match set
 * (`GET /api/runs?filter=…`) that `buildRunsFeed` uses to decide top-level row visibility. An empty
 * filter (the default) skips that second call entirely, so the unfiltered feed makes the exact same
 * network calls it always has.
 */
export async function loadRunsFeed(filter: RunFilter = {}): Promise<RunsFeedData> {
  const filterActive = !isEmptyRunFilter(filter);
  const [runs, matchedRuns, suiteRuns, suites, tests, scenarios, providers] = await Promise.all([
    apiGet<RunSummary[]>("/api/runs"),
    filterActive ? queryRunsFiltered(filter) : Promise.resolve(null),
    listSuiteRuns(),
    listSuites(),
    listTests(),
    listScenarios(),
    apiGet<ProviderCredential[]>("/api/providers"),
  ]);
  return buildRunsFeed({ runs, matchedRuns, suiteRuns, suites, tests, scenarios, providers });
}
