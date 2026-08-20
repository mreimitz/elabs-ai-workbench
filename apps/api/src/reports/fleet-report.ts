// ── Fleet report composer (Advisor WP 2.2) ──────────────────────────────────────────────────────
// The aggregate, on-demand report behind `GET /api/reports/fleet/{json,markdown}`: what the whole
// install looks like right now — servers + scan drift, environment costs, suite grades, a posture
// summary when one exists — with the fleet-scope `AdvisorReport` attached.
//
// THE DERIVED-ONCE INVARIANT (the same one `digest.ts` holds): every number here is READ, or merely
// ARRANGED (summed, counted, subtracted), from something the app already computed. Drift comes from
// `compare/service.ts`'s `buildComparison` — the exact matcher the Compare workspace uses — and the
// suite figures come straight off each suite run's persisted `aggregates`. Nothing in this file
// re-implements arithmetic that exists elsewhere, so the fleet report can never quietly disagree
// with the page an operator drills into.
//
// DETERMINISM (roadmap/advisor/conventions.md, invariant 2): every list imposes its own total order
// (never the repository's `ORDER BY`, which ties freely), and `generatedAt` comes from the advisor
// context's INJECTED clock — so the same inputs under the same clock serialize byte-identically.
//
// HONEST GAPS (invariant 3): a section, or an entry, with nothing to say carries a `gap` naming what
// is missing. "No runs yet" and "runs that cost $0.00" are different facts and the report says
// which; a structural zero is never published as a measurement.

import {
  ADVISOR_VERSION,
  DEFAULT_COMPARE_THRESHOLD,
  FLEET_REPORT_SUITE_RUN_LIMIT,
  type FleetAdvisorSection,
  type FleetEnvironmentEntry,
  type FleetEnvironmentsSection,
  type FleetPostureSection,
  type FleetPostureSummary,
  type FleetReport,
  type FleetScanRef,
  type FleetServerDrift,
  type FleetServerEntry,
  type FleetServersSection,
  type FleetSuiteEntry,
  type FleetSuitesSection,
  type RunSummary,
  type ScanDetail,
  type ScanSummary,
  type Suite,
  type SuiteRun,
} from "@mcp-token-footprint/shared";
import { compareStrings } from "../advisor/rules/shared.js";
import { buildAdvisorReport } from "../advisor/service.js";
import type { AdvisorContext } from "../advisor/types.js";
import { buildComparison } from "../compare/service.js";
import { isSubscriptionCostBasis } from "./reports.js";

// ── Ports ───────────────────────────────────────────────────────────────────────────────────────
// Narrow read slices, exactly like the advisor's own ports: the composer is testable with plain
// fakes, and it physically cannot reach past the read model into a write, an MCP connection or a
// secret. The concrete `SuiteRunRepository` / `SuiteService` satisfy these structurally.

export type FleetSuiteRunPort = {
  listRuns(suiteId?: string): SuiteRun[];
};

export type FleetSuitePort = {
  list(): Suite[];
};

/**
 * A security-posture roll-up provider.
 *
 * `planning/Roadmap/RM-20-security-posture/` — the analyzer that would implement this — is NOT built (every WP in
 * its ledger is open), so nothing supplies one today and the posture section renders its honest gap.
 * The seam exists so that plan can feed the report without reopening this file, and so the populated
 * rendering is exercisable by a test rather than being unreachable prose.
 */
export type FleetPostureProvider = {
  summarize(): FleetPostureSummary | null;
};

export type FleetReportDeps = {
  /** The advisor's read model + the report's clock (`createAdvisorContext`). */
  advisor: AdvisorContext;
  suiteRuns: FleetSuiteRunPort;
  suites: FleetSuitePort;
  /** Absent until a posture analyzer exists — see {@link FleetPostureProvider}. */
  posture?: FleetPostureProvider;
};

// ── Servers + drift ─────────────────────────────────────────────────────────────────────────────

function toScanRef(scan: ScanSummary): FleetScanRef {
  return {
    scanId: scan.id,
    scannedAt: scan.scannedAt,
    tokenProfile: scan.tokenProfile,
    countingVersion: scan.countingVersion,
    totalTools: scan.totalTools,
    totalTokens: scan.totalTokens,
  };
}

/**
 * A server's SUCCESSFUL scans, newest first (scan id as the tie-break so two scans stamped the same
 * instant still have one defined order).
 *
 * Successful only, deliberately: a failed or still-running scan row carries zeroed totals, and a
 * drift computed against one would report a collapse in the tool surface that never happened.
 */
function successfulScansNewestFirst(ctx: AdvisorContext, serverId: string): ScanSummary[] {
  return ctx.scans
    .listSummariesByServer(serverId)
    .filter((scan) => scan.status === "success")
    .sort((a, b) => {
      const byTime = compareStrings(b.scannedAt, a.scannedAt);
      return byTime !== 0 ? byTime : compareStrings(a.id, b.id);
    });
}

/**
 * Drift between the two most recent successful scans of one server, `previous` → `latest`.
 *
 * The comparison itself is `buildComparison` — the same exact→normalized→fuzzy matcher and the same
 * comparability guard the Compare workspace runs — at `DEFAULT_COMPARE_THRESHOLD`, so a drift figure
 * in this report and the diff an operator opens are the same computation, not two that agree by
 * coincidence. When the two scans are not on a comparable counting scale, `buildComparison` suppresses
 * its token deltas to `0`; a `0` that means "we refuse to subtract these" would read here as "nothing
 * moved", so both delta fields are reported as `null` instead, with `deltasComparable: false` saying
 * why. The tool counts stay valid either way — matching pairs by name/description never touches counts.
 */
function buildDrift(previous: ScanDetail, latest: ScanDetail): FleetServerDrift {
  const comparison = buildComparison(previous, latest, DEFAULT_COMPARE_THRESHOLD);
  const toolsChanged = comparison.matched.filter(
    (match) =>
      match.definitionDelta.descriptionChanged ||
      match.definitionDelta.schemaChanged ||
      match.definitionDelta.annotationsChanged,
  ).length;

  return {
    previousScan: toScanRef(previous),
    toolsAdded: comparison.counts.onlyInB,
    toolsRemoved: comparison.counts.onlyInA,
    toolsChanged,
    deltaTokens: comparison.deltasComparable ? comparison.totalsDeltaTokens : null,
    deltaPercent: comparison.deltasComparable ? comparison.totalsDeltaPercent : null,
    deltasComparable: comparison.deltasComparable,
  };
}

function buildServersSection(ctx: AdvisorContext): FleetServersSection {
  const servers = [...ctx.servers.list()].sort((a, b) => {
    const byName = compareStrings(a.name, b.name);
    return byName !== 0 ? byName : compareStrings(a.id, b.id);
  });

  if (servers.length === 0) {
    return { entries: [], gap: "No MCP server is registered, so there is no fleet to report on." };
  }

  const entries: FleetServerEntry[] = servers.map((server) => {
    const scans = successfulScansNewestFirst(ctx, server.id);
    const latestSummary = scans[0];
    if (!latestSummary) {
      return {
        serverId: server.id,
        serverName: server.name,
        transport: server.transport,
        latestScan: null,
        drift: null,
        gap: "Never scanned successfully — no footprint has been measured for this server.",
      };
    }

    const previousSummary = scans[1];
    if (!previousSummary) {
      return {
        serverId: server.id,
        serverName: server.name,
        transport: server.transport,
        latestScan: toScanRef(latestSummary),
        drift: null,
        gap: "Only one successful scan — there is nothing earlier to measure drift against.",
      };
    }

    return {
      serverId: server.id,
      serverName: server.name,
      transport: server.transport,
      latestScan: toScanRef(latestSummary),
      drift: buildDrift(
        ctx.scans.getDetail(previousSummary.id),
        ctx.scans.getDetail(latestSummary.id),
      ),
    };
  });

  const scanned = entries.filter((entry) => entry.latestScan !== null).length;
  if (scanned === 0) {
    return {
      entries,
      gap: `None of the ${entries.length} registered ${entries.length === 1 ? "server has" : "servers have"} a successful scan, so no footprint or drift could be measured.`,
    };
  }
  return { entries };
}

// ── Environment costs ───────────────────────────────────────────────────────────────────────────

/**
 * One environment's spend, summed over EVERY persisted run of it — not only the completed ones,
 * because a run that errored or was stopped still burned the tokens it burned. `completedRuns` is
 * reported alongside so the mix is visible rather than assumed.
 *
 * Billed and subscription-reference costs are summed SEPARATELY and never added: a
 * `claude_subscription` run's `costUsd` is a shadow list price, not a charge (see
 * `SUBSCRIPTION_COST_FOOTNOTE` in `reports.ts`, the one place that wording lives), so a single total
 * spanning both would be a number that corresponds to nothing anyone was invoiced for.
 */
function buildEnvironmentEntry(
  identity: Pick<FleetEnvironmentEntry, "scenarioId" | "name" | "model" | "toolLoadingMode">,
  runs: readonly RunSummary[],
): FleetEnvironmentEntry {
  let billedCostUsd = 0;
  let billedRuns = 0;
  let subscriptionReferenceCostUsd = 0;
  let subscriptionReferenceRuns = 0;
  let completedRuns = 0;
  let tokensIn = 0;
  let tokensOut = 0;

  for (const run of runs) {
    if (run.status === "completed") completedRuns += 1;
    tokensIn += run.tokensIn;
    tokensOut += run.tokensOut;
    if (isSubscriptionCostBasis(run.costBasis)) {
      subscriptionReferenceCostUsd += run.costUsd;
      subscriptionReferenceRuns += 1;
    } else {
      billedCostUsd += run.costUsd;
      billedRuns += 1;
    }
  }

  return {
    ...identity,
    runs: runs.length,
    completedRuns,
    billedCostUsd,
    billedRuns,
    meanBilledCostUsd: billedRuns === 0 ? null : billedCostUsd / billedRuns,
    subscriptionReferenceCostUsd,
    subscriptionReferenceRuns,
    tokensIn,
    tokensOut,
    ...(runs.length === 0
      ? {
          gap: "No run has been recorded for this environment — every figure above is a structural zero, not a measurement.",
        }
      : {}),
  };
}

function buildEnvironmentsSection(ctx: AdvisorContext): FleetEnvironmentsSection {
  const scenarios = [...ctx.scenarios.list()].sort((a, b) => {
    const byName = compareStrings(a.name, b.name);
    return byName !== 0 ? byName : compareStrings(a.id, b.id);
  });

  if (scenarios.length === 0) {
    return {
      entries: [],
      gap: "No environment is configured, so no run cost has been attributed to one.",
    };
  }

  const entries = scenarios.map((scenario) =>
    buildEnvironmentEntry(
      {
        scenarioId: scenario.id,
        name: scenario.name,
        model: scenario.model,
        toolLoadingMode: scenario.toolLoadingMode,
      },
      ctx.runs.listRuns({ scenarioId: scenario.id }),
    ),
  );

  const withRuns = entries.filter((entry) => entry.runs > 0).length;
  if (withRuns === 0) {
    return {
      entries,
      gap: `None of the ${entries.length} configured ${entries.length === 1 ? "environment has" : "environments have"} been run, so no cost has been measured.`,
    };
  }
  return { entries };
}

// ── Suite grades ────────────────────────────────────────────────────────────────────────────────

/**
 * The most recent suite runs and the grades they produced, read straight off each run's persisted
 * `aggregates` (the suite orchestrator's own numbers — this file recomputes none of them).
 *
 * The list is capped at `FLEET_REPORT_SUITE_RUN_LIMIT` and always reports `totalSuiteRuns`, so a
 * truncated list can never be mistaken for the whole history.
 */
function buildSuitesSection(deps: FleetReportDeps): FleetSuitesSection {
  const all = [...deps.suiteRuns.listRuns()].sort((a, b) => {
    const byTime = compareStrings(b.startedAt, a.startedAt);
    return byTime !== 0 ? byTime : compareStrings(a.id, b.id);
  });

  if (all.length === 0) {
    return {
      entries: [],
      totalSuiteRuns: 0,
      gap: "No suite run has been executed, so there are no grades to report.",
    };
  }

  const suiteNames = new Map(deps.suites.list().map((suite) => [suite.id, suite.name] as const));

  const entries: FleetSuiteEntry[] = all.slice(0, FLEET_REPORT_SUITE_RUN_LIMIT).map((run) => {
    // A `collection`/`adhoc` plan runs through the same orchestrator but creates no Suite row, so it
    // is labeled by what it was rather than by a name that does not exist (D-T5).
    const label =
      (run.suiteId === undefined ? undefined : suiteNames.get(run.suiteId)) ??
      (run.suiteId === undefined
        ? `${run.source ?? "ad-hoc"} plan`
        : `Deleted suite ${run.suiteId}`);

    const aggregates = run.aggregates;
    const base = {
      suiteRunId: run.id,
      ...(run.suiteId === undefined ? {} : { suiteId: run.suiteId }),
      label,
      ...(run.source === undefined ? {} : { source: run.source }),
      status: run.status,
      startedAt: run.startedAt,
      ...(run.endedAt === undefined ? {} : { endedAt: run.endedAt }),
    };

    if (!aggregates) {
      return {
        ...base,
        cellsTotal: 0,
        cellsCompleted: 0,
        meanGrade: null,
        gradeStdDev: null,
        passRateAt05: null,
        totalTokens: 0,
        execCostUsd: 0,
        judgeCostUsd: 0,
        gap: "This suite run carries no aggregates — the zeros beside it are placeholders, not measurements.",
      };
    }

    return {
      ...base,
      cellsTotal: aggregates.cellsTotal,
      cellsCompleted: aggregates.cellsCompleted,
      meanGrade: aggregates.meanGrade,
      gradeStdDev: aggregates.gradeStdDev,
      passRateAt05: aggregates.passRateAt05,
      totalTokens: aggregates.totalTokens,
      execCostUsd: aggregates.execCostUsd,
      judgeCostUsd: aggregates.judgeCostUsd,
      ...(aggregates.meanGrade === null
        ? { gap: "Ran, but no grader produced a score — there is no grade to read here." }
        : {}),
    };
  });

  const graded = entries.filter((entry) => entry.meanGrade !== null).length;
  if (graded === 0) {
    return {
      entries,
      totalSuiteRuns: all.length,
      gap: `None of the ${entries.length} listed suite ${entries.length === 1 ? "run" : "runs"} produced a graded score, so quality cannot be reported.`,
    };
  }
  return { entries, totalSuiteRuns: all.length };
}

// ── Posture ─────────────────────────────────────────────────────────────────────────────────────

/**
 * The posture roll-up "when available" — and it is not available yet. `planning/Roadmap/RM-20-security-posture/` is
 * planned but unstarted (its ledger has no ticked WP and no `SECURITY_ANALYZER_VERSION` exists), so
 * with no provider wired the section says exactly that, by name. It does NOT fall back to some other
 * measurement dressed up as a posture score: reusing, say, compatibility findings would put a number
 * under a "security" heading that no security rule ever produced.
 */
function buildPostureSection(deps: FleetReportDeps): FleetPostureSection {
  const summary = deps.posture?.summarize() ?? null;
  if (!summary) {
    return {
      summary: null,
      gap: "No security-posture analyzer has produced a summary — the posture analyzer (planning/Roadmap/RM-20-security-posture/) is not built yet, so this section is unmeasured rather than clean.",
    };
  }
  if (summary.findingCounts.length === 0 && summary.subjects.length === 0) {
    return {
      summary,
      gap: "The posture analyzer ran but reported no findings and no analyzed subjects.",
    };
  }
  return { summary };
}

// ── Advisor recommendations ─────────────────────────────────────────────────────────────────────

/**
 * The fleet-scope `AdvisorReport`, produced by the SAME service `GET /api/advisor/report?scope=fleet`
 * calls — so the two surfaces cannot disagree, and any rule registered later (WP 2.1's grade-aware
 * ones) appears here automatically. Nothing in this file names a rule id.
 */
function buildAdvisorSection(ctx: AdvisorContext): FleetAdvisorSection {
  const report = buildAdvisorReport(ctx, { scope: "fleet" });
  if (report.recommendations.length === 0 && report.insufficientData.length === 0) {
    return {
      report,
      gap: "The advisor produced no recommendation and reported no data gap — no registered rule found anything to say about this fleet.",
    };
  }
  return { report };
}

// ── The report ──────────────────────────────────────────────────────────────────────────────────

/**
 * Composes the whole fleet report. The clock is read ONCE, at the top, so every figure in the
 * document belongs to the same instant — and the advisor section, which stamps its own
 * `generatedAt` from the same injected clock, carries the identical timestamp.
 */
export function createFleetReport(deps: FleetReportDeps): FleetReport {
  return {
    advisorVersion: ADVISOR_VERSION,
    generatedAt: deps.advisor.now().toISOString(),
    servers: buildServersSection(deps.advisor),
    environments: buildEnvironmentsSection(deps.advisor),
    suites: buildSuitesSection(deps),
    posture: buildPostureSection(deps),
    advisor: buildAdvisorSection(deps.advisor),
  };
}
