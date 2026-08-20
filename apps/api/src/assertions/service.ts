// The CI assertions engine (roadmap/ci/, WP 1.3) — evaluates a `mcpfp.assert.json` document against
// a scan the workbench has ALREADY persisted and returns an itemized `AssertionReport`.
//
// Three properties this file exists to hold:
//
//   • **D-C9 — it never runs a scan.** Scanning is `mcpfp scan`; a CI job chains the two, which is
//     what keeps the exit codes honest (a scan that could not run is that command's `2`, not this
//     one's `1`). Nothing here opens an MCP connection, spawns a child, or touches a secret.
//   • **D-MCP4 — re-project, don't reimplement.** Every baseline question is answered by
//     `buildComparison` (the exact→normalized→fuzzy matcher and the `deltasComparable` guard already
//     exist and are tested). There is no second differ in this workstream.
//   • **D-C8 — an unevaluable rule is never a silent pass.** "There is no earlier scan yet" is a
//     `skipped` (the CLI warns and exits 0). "You named a baseline that does not resolve" and "the
//     two scans are not on the same scale" are both **400s** — because a `max-scan-delta` measured
//     against a suppressed-to-zero delta would pass every single time, which is the exact failure a
//     footprint gate exists to prevent.
//
// WP 2.2 adds the SUITE family beside the scan family, under three more decisions:
//
//   • **D-C13 — a gate document is SINGLE-FAMILY.** Enforced in the shared schema, not here; this
//     file may therefore assume the rules it is handed match the target it resolved. The suite
//     evaluators still carry a defensive throw, because "unreachable" is a claim about today's
//     schema and a silent pass is the one outcome a gate must never produce.
//   • **D-C14 — a NAMED baseline is always resolved and always echoed, even when no rule needs one.**
//     That single boolean (`needsBaseline || requestedBaseline !== undefined`) is the whole
//     behavioural change to WP 1.3's engine; D-C8's three outcomes are untouched.
//   • **D-C16 — a suite gate refuses a suite run that is not `completed` AND settled.** A `running`,
//     `pending`, `capped`, `stopped` or `error` run, and a `completed` one whose `ratingState` has
//     not settled, are all **400s**. Reading a half-graded matrix as a mean score would report a
//     quality regression that is really just grading latency — the same silent-wrong-answer D-C8
//     exists to prevent, and the same spirit as WP 1.3's refusal to assert a `failed` scan.

import {
  ASSERTION_BASELINE_PREVIOUS,
  ASSERTIONS_VERSION,
  type AssertionEvaluateRequest,
  type AssertionReport,
  type AssertionRule,
  type AssertionRuleKind,
  type AssertionRuleResult,
  type AssertionScanRef,
  type AssertionSubjectRef,
  type AssertionSuiteRunRef,
  type AssertionTarget,
  assertionRuleNeedsBaseline,
  assertionTargetFamily,
  capAssertionDetails,
  DEFAULT_COMPARE_THRESHOLD,
  formatNumber,
  isSettledRatingState,
  type ScanComparison,
  type ScanDetail,
  type ScanSummary,
  type ServerConfig,
  type Suite,
  type SuiteAggregates,
  type SuiteRun,
} from "@mcp-token-footprint/shared";
import { buildComparison } from "../compare/service.js";
import { httpError } from "../utils/errors.js";

/**
 * The narrow read ports this engine needs. Deliberately structural rather than the real repository
 * classes: this WP adds **no repository and no migration**, and a test can hand it three functions
 * instead of a database.
 */
export type AssertionPorts = {
  scans: {
    getDetail: (scanId: string) => ScanDetail;
    listSummariesByServer: (serverId: string) => ScanSummary[];
  };
  servers: {
    list: () => ServerConfig[];
  };
  /**
   * WP 2.2 — the suite family's read ports. `listRuns`/`getRun` are the two reads
   * `GET /api/suite-runs` already uses; this WP adds NO repository and NO query.
   */
  suites: {
    list: () => Suite[];
  };
  suiteRuns: {
    getRun: (id: string) => SuiteRun;
    listRuns: (suiteId?: string) => SuiteRun[];
  };
  /** Injectable so a test can pin `evaluatedAt`. */
  now?: () => Date;
};

/** Only a `success` scan may take part: a failed or in-flight scan has a partial tool list. */
const USABLE_STATUS = "success";

/** **D-C16** — the only suite-run status a gate may be measured against. */
const USABLE_SUITE_RUN_STATUS = "completed";

export function evaluateAssertions(
  ports: AssertionPorts,
  request: AssertionEvaluateRequest,
): AssertionReport {
  // Flag overrides sit ON TOP of the document, matching the CLI's config precedence (flag > file).
  const target = request.target ?? request.document.target;
  const requestedBaseline = request.baseline ?? request.document.baseline;
  const rules = request.document.rules;

  const subject = resolveSubject(ports, target);

  // **D-C14 — the one behavioural change to WP 1.3's engine.** WP 1.3 resolved a baseline only when
  // a baseline-DEPENDENT rule existed; it now also resolves whenever the document (or `--baseline`)
  // NAMES one, because the PR artifact's whole value is the delta sentence and both suite rules are
  // absolute. Everything else is unchanged: an UNNAMED baseline with no baseline-dependent rule
  // still resolves nothing, and D-C8's three outcomes are untouched.
  const needsBaseline = rules.some((rule) => assertionRuleNeedsBaseline(rule.rule));
  const resolution: BaselineResolution =
    needsBaseline || requestedBaseline !== undefined
      ? resolveBaseline(ports, subject, requestedBaseline ?? ASSERTION_BASELINE_PREVIOUS)
      : { baseline: null, requested: undefined, skipReason: undefined };

  const context = buildContext(subject, resolution);

  // EVERY rule is evaluated — no short-circuit on the first failure. A CI log that lists one problem
  // at a time costs a round trip per problem.
  const results = rules.map((rule) => evaluateRule(rule, context));

  const failed = results.filter((result) => result.status === "fail").length;
  const skipped = results.filter((result) => result.status === "skipped").length;

  const report: AssertionReport = {
    assertionsVersion: ASSERTIONS_VERSION,
    evaluatedAt: (ports.now?.() ?? new Date()).toISOString(),
    subject: toSubjectRef(subject),
    baseline:
      resolution.baseline === null
        ? null
        : {
            requested: resolution.requested ?? ASSERTION_BASELINE_PREVIOUS,
            scan: toSubjectRef(resolution.baseline),
          },
    results,
    counts: {
      total: results.length,
      passed: results.length - failed - skipped,
      failed,
      skipped,
    },
    passed: failed === 0,
  };
  // Present ONLY when a baseline was asked for and resolved to nothing, so the artifact can say WHY
  // there is no delta sentence. A report that resolved one, and one that named none, are byte-for-
  // byte what WP 1.3 produced.
  if (resolution.baseline === null && resolution.skipReason !== undefined) {
    report.baselineSkipReason = resolution.skipReason;
  }
  return report;
}

/**
 * Assemble the evaluators' view of the world. The two families get two shapes on purpose: the six
 * scan evaluators are untouched by this WP and keep reading a `ScanDetail` + a `ScanComparison`,
 * while the two suite evaluators see a suite run's aggregates and nothing else.
 */
function buildContext(subject: Subject, resolution: BaselineResolution): AnyEvaluationContext {
  if (subject.kind === "scan") {
    const baseline = resolution.baseline?.kind === "scan" ? resolution.baseline.scan : null;
    return {
      subject: subject.scan,
      baseline,
      comparison:
        baseline === null
          ? null
          : buildComparison(baseline, subject.scan, DEFAULT_COMPARE_THRESHOLD),
      skipReason: resolution.skipReason,
    };
  }
  return {
    subject,
    baseline: resolution.baseline?.kind === "suite_run" ? resolution.baseline : null,
    skipReason: resolution.skipReason,
  };
}

// ── Subject + baseline resolution ───────────────────────────────────────────────────────────────

/**
 * A resolved subject, discriminated by family. A suite subject carries its aggregates already
 * unwrapped: a `completed` suite run always has them cached, and checking once at resolution keeps
 * the two evaluators total.
 */
type Subject =
  | { kind: "scan"; scan: ScanDetail }
  | { kind: "suite_run"; run: SuiteRun; suiteName: string; aggregates: SuiteAggregates };

/** The two scan-family target shapes, and the two suite-family ones. */
type ScanTarget = Extract<AssertionTarget, { server: string } | { scan: string }>;
type SuiteTarget = Extract<AssertionTarget, { suite: string } | { suiteRun: string }>;

/**
 * **D-C13** — the family is decided ONCE, by the shared `assertionTargetFamily`, so the API and the
 * document refinement can never disagree about what a `{ suiteRun }` target is. The two casts are
 * the price of that single source of truth (a boolean-returning helper cannot narrow a union); they
 * are at the branch point, where the mapping is one line of code away from being read.
 */
function resolveSubject(ports: AssertionPorts, target: AssertionTarget): Subject {
  return assertionTargetFamily(target) === "suite"
    ? { kind: "suite_run", ...resolveSuiteRunSubject(ports, target as SuiteTarget) }
    : { kind: "scan", scan: resolveScanSubject(ports, target as ScanTarget) };
}

function resolveScanSubject(ports: AssertionPorts, target: ScanTarget): ScanDetail {
  if ("scan" in target) {
    const scan = loadScan(ports, target.scan, "The target scan");
    if (scan.status !== USABLE_STATUS) {
      // Asserting against a failed/in-flight scan would gate on a partial tool list — a budget rule
      // would "pass" a server that could not even be reached.
      throw httpError(
        400,
        `Scan ${scan.id} has status "${scan.status}", so it cannot be asserted against. Name a completed scan.`,
      );
    }
    return scan;
  }

  const server = resolveServerRef(ports, target.server);
  // The repository already returns newest-first, but `ORDER BY scanned_at DESC` alone is not a total
  // order: two scans in the same millisecond (a CI job that scans twice) would otherwise pick
  // whichever row SQLite happened to return first. Re-sorting with the id tie-break makes "the
  // newest scan" mean the same thing on every run.
  const newest = ports.scans
    .listSummariesByServer(server.id)
    .filter((summary) => summary.status === USABLE_STATUS)
    .sort(newestFirst)[0];
  if (!newest) {
    throw httpError(
      400,
      `No completed scan for server "${server.name}" (${server.id}) — run \`mcpfp scan ${server.id}\` first.`,
    );
  }
  return ports.scans.getDetail(newest.id);
}

/** A server id OR its exact name. An ambiguous name names both ids rather than picking one. */
function resolveServerRef(ports: AssertionPorts, ref: string): ServerConfig {
  const servers = ports.servers.list();
  const byId = servers.find((server) => server.id === ref);
  if (byId) return byId;

  const byName = servers.filter((server) => server.name === ref);
  if (byName.length === 1) return byName[0] as ServerConfig;
  if (byName.length > 1) {
    throw httpError(
      400,
      `"${ref}" matches ${byName.length} registered servers (${byName
        .map((server) => server.id)
        .join(", ")}) — name one by id instead.`,
    );
  }
  throw httpError(400, `No registered server with the id or exact name "${ref}".`);
}

/**
 * Newest first, with the id as tie-break — a TOTAL order, unlike `ORDER BY <instant> DESC` alone.
 * "Which is the subject" and "which is the baseline" both go through it, for scans and for suite
 * runs alike, so a gate re-run against an unchanged database always compares the same pair.
 *
 * One implementation, two comparators: writing a second sort for suite runs is exactly how the two
 * families would end up with two different tie-breaks and one of them would stop being total.
 */
function byNewestFirst<T>(
  instantOf: (item: T) => string,
  idOf: (item: T) => string,
): (a: T, b: T) => number {
  return (a, b) =>
    instantOf(a) === instantOf(b)
      ? idOf(b).localeCompare(idOf(a))
      : instantOf(b).localeCompare(instantOf(a));
}

const newestFirst = byNewestFirst<ScanSummary>(
  (summary) => summary.scannedAt,
  (summary) => summary.id,
);

const newestSuiteRunFirst = byNewestFirst<SuiteRun>(
  (run) => run.startedAt,
  (run) => run.id,
);

/**
 * **D-C16** — a suite run may take part in a gate only when it is `completed` AND its post-run
 * review has settled. A `running`/`pending` matrix has half its cells; a `capped`/`stopped`/`error`
 * one has a partial matrix it never intended to finish; and a `completed` one still `pending`/
 * `rating` has a mean grade that is a snapshot of grading latency rather than of quality.
 *
 * An ABSENT `ratingState` counts as unsettled on purpose: the column is `NOT NULL` and backfilled by
 * migration v27, so every real server sends one. Fail closed.
 */
function isUsableSuiteRun(run: SuiteRun): boolean {
  return (
    run.status === USABLE_SUITE_RUN_STATUS && isSettledRatingState(run.ratingState ?? "pending")
  );
}

/** The D-C16 refusal, worded so an operator knows which half of the pair was not ready. */
function refuseUnusableSuiteRun(run: SuiteRun, role: string): never {
  const rating = run.ratingState ?? "pending";
  throw httpError(
    400,
    run.status === USABLE_SUITE_RUN_STATUS
      ? `${role} ${run.id} is "completed" but its review has not settled (rating state "${rating}"), so its mean grade would measure grading latency rather than quality. Wait for the run to finish rating, then re-run the gate.`
      : `${role} ${run.id} has status "${run.status}", so it cannot be asserted against. Name a completed suite run.`,
  );
}

type BaselineResolution = {
  /** The resolved baseline SUBJECT — a scan, or a suite run — or `null`. */
  baseline: Subject | null;
  requested: string | undefined;
  /** Set only when `baseline` is null — the D-C8 case-1 skip reason, echoed onto each affected rule. */
  skipReason: string | undefined;
};

/**
 * **D-C3 — symbolic in, concrete out.** `"previous"` resolves to the newest earlier succeeded scan
 * of the SUBJECT'S OWN server; anything else is treated as an explicit scan id. Either way the
 * caller gets one concrete scan, echoed into the report so the artifact records what was compared.
 */
function resolveBaseline(
  ports: AssertionPorts,
  subject: Subject,
  requested: string,
): BaselineResolution {
  return subject.kind === "scan"
    ? resolveScanBaseline(ports, subject.scan, requested)
    : resolveSuiteRunBaseline(ports, subject, requested);
}

function resolveScanBaseline(
  ports: AssertionPorts,
  subject: ScanDetail,
  requested: string,
): BaselineResolution {
  if (requested === ASSERTION_BASELINE_PREVIOUS) {
    const candidates = ports.scans
      .listSummariesByServer(subject.serverId)
      .filter(
        (summary) =>
          summary.status === USABLE_STATUS &&
          summary.id !== subject.id &&
          summary.scannedAt < subject.scannedAt,
      )
      .sort(newestFirst);

    const newest = candidates[0];
    if (!newest) {
      // D-C8 case 1: a first-ever scan must not fail a pipeline for having no history.
      return {
        baseline: null,
        requested,
        skipReason: `No earlier completed scan of "${subject.serverName}" — ${subject.id} is the first one, so there is nothing to compare against.`,
      };
    }
    return {
      baseline: { kind: "scan", scan: ports.scans.getDetail(newest.id) },
      requested,
      skipReason: undefined,
    };
  }

  // D-C8 case 2: a NAMED baseline that does not resolve is an error, never a quiet degradation into
  // case 1 — a typo'd scan id must not turn a gate into a no-op.
  const baseline = loadScan(ports, requested, "The baseline scan");
  if (baseline.serverId !== subject.serverId) {
    throw httpError(
      400,
      `Baseline scan ${baseline.id} belongs to server "${baseline.serverName}" (${baseline.serverId}), not to the subject's server "${subject.serverName}" (${subject.serverId}).`,
    );
  }
  if (baseline.status !== USABLE_STATUS) {
    throw httpError(
      400,
      `Baseline scan ${baseline.id} has status "${baseline.status}", so it cannot be a baseline. Name a completed scan.`,
    );
  }
  return { baseline: { kind: "scan", scan: baseline }, requested, skipReason: undefined };
}

/**
 * The suite mirror of {@link resolveScanBaseline}, outcome for outcome: `"previous"` is the newest
 * EARLIER completed+settled run of the subject's OWN suite, anything else is an explicit suite-run
 * id, and D-C8's three cases are unchanged.
 */
function resolveSuiteRunBaseline(
  ports: AssertionPorts,
  subject: Extract<Subject, { kind: "suite_run" }>,
  requested: string,
): BaselineResolution {
  if (requested === ASSERTION_BASELINE_PREVIOUS) {
    if (subject.run.suiteId === undefined) {
      // A collection/adhoc plan runs as a suite run but owns no saved Suite row, so "the previous
      // run of this suite" names nothing. That is D-C8 case 1, not an error: the gate can still
      // evaluate its absolute rules, and the artifact says why there is no delta sentence.
      return {
        baseline: null,
        requested,
        skipReason: `Suite run ${subject.run.id} belongs to no saved suite (it was launched as a ${subject.run.source ?? "plan"}), so there is no earlier run of the same suite to compare against.`,
      };
    }
    const newest = ports.suiteRuns
      .listRuns(subject.run.suiteId)
      .filter(
        (run) =>
          isUsableSuiteRun(run) && run.id !== subject.run.id && run.startedAt < subject.run.startedAt,
      )
      .sort(newestSuiteRunFirst)[0];
    if (!newest) {
      return {
        baseline: null,
        requested,
        skipReason: `No earlier completed suite run of "${subject.suiteName}" — ${subject.run.id} is the first one, so there is nothing to compare against.`,
      };
    }
    return {
      baseline: toSuiteRunSubject(ports, newest, "The baseline suite run"),
      requested,
      skipReason: undefined,
    };
  }

  // D-C8 case 2, unchanged in spirit: a NAMED baseline that does not resolve is an error.
  const baseline = loadSuiteRun(ports, requested, "The baseline suite run");
  if (baseline.suiteId !== subject.run.suiteId) {
    throw httpError(
      400,
      `Baseline suite run ${baseline.id} belongs to suite "${baseline.suiteId ?? "(none)"}", not to the subject's suite "${subject.run.suiteId ?? "(none)"}".`,
    );
  }
  if (!isUsableSuiteRun(baseline)) refuseUnusableSuiteRun(baseline, "Baseline suite run");
  return {
    baseline: toSuiteRunSubject(ports, baseline, "The baseline suite run"),
    requested,
    skipReason: undefined,
  };
}

/** `getDetail` throws the repository's 404; a gate that names a missing scan is a config error (400). */
function loadScan(ports: AssertionPorts, scanId: string, label: string): ScanDetail {
  try {
    return ports.scans.getDetail(scanId);
  } catch (error) {
    if ((error as { statusCode?: number }).statusCode === 404) {
      throw httpError(400, `${label} "${scanId}" does not exist on this workbench.`);
    }
    throw error;
  }
}

/** The suite mirror of {@link loadScan}: the repository's 404 becomes the caller's 400. */
function loadSuiteRun(ports: AssertionPorts, suiteRunId: string, label: string): SuiteRun {
  try {
    return ports.suiteRuns.getRun(suiteRunId);
  } catch (error) {
    if ((error as { statusCode?: number }).statusCode === 404) {
      throw httpError(400, `${label} "${suiteRunId}" does not exist on this workbench.`);
    }
    throw error;
  }
}

function toScanRef(scan: ScanDetail): AssertionScanRef {
  return {
    scanId: scan.id,
    serverId: scan.serverId,
    serverName: scan.serverName,
    scannedAt: scan.scannedAt,
    tokenProfile: scan.tokenProfile,
    countingVersion: scan.countingVersion,
    totalTokens: scan.totalTokens,
    totalTools: scan.totalTools,
  };
}

/**
 * **D-C14** — the report's identity fields, as the discriminated `AssertionSubjectRef`. The scan
 * variant is WP 1.3's ref plus the `kind` discriminant, so an existing report's JSON is unchanged
 * save for that one added key.
 */
function toSubjectRef(subject: Subject): AssertionSubjectRef {
  return subject.kind === "scan"
    ? { kind: "scan", ...toScanRef(subject.scan) }
    : { kind: "suite_run", ...toSuiteRunRef(subject) };
}

/** Nothing here can carry a secret: no provider key, no model credential, no path. */
function toSuiteRunRef(subject: Extract<Subject, { kind: "suite_run" }>): AssertionSuiteRunRef {
  const { run, suiteName, aggregates } = subject;
  const ref: AssertionSuiteRunRef = {
    suiteRunId: run.id,
    suiteName,
    startedAt: run.startedAt,
    status: run.status,
    cellsTotal: aggregates.cellsTotal,
    cellsCompleted: aggregates.cellsCompleted,
    meanGrade: aggregates.meanGrade,
    execCostUsd: aggregates.execCostUsd,
    judgeCostUsd: aggregates.judgeCostUsd,
  };
  // Optional on the wire because they are optional on the row: a collection/adhoc plan has no
  // `suiteId`, and a pre-Testing-IA row has no `source`.
  if (run.suiteId !== undefined) ref.suiteId = run.suiteId;
  if (run.source !== undefined) ref.source = run.source;
  if (run.endedAt !== undefined) ref.endedAt = run.endedAt;
  return ref;
}

// ── The suite family's resolution ───────────────────────────────────────────────────────────────
// The exact mirror of the scan family above: id-or-exact-name for the collection target (an
// ambiguous name names both ids, never picks), newest-first with the SAME total-order tie-break, and
// D-C16's completed+settled filter on every candidate.

function resolveSuiteRunSubject(
  ports: AssertionPorts,
  target: SuiteTarget,
): Omit<Extract<Subject, { kind: "suite_run" }>, "kind"> {
  if ("suiteRun" in target) {
    const run = loadSuiteRun(ports, target.suiteRun, "The target suite run");
    if (!isUsableSuiteRun(run)) refuseUnusableSuiteRun(run, "Suite run");
    return toSuiteRunSubjectFields(ports, run, "The target suite run");
  }

  const suite = resolveSuiteRef(ports, target.suite);
  const newest = ports.suiteRuns
    .listRuns(suite.id)
    .filter(isUsableSuiteRun)
    .sort(newestSuiteRunFirst)[0];
  if (!newest) {
    throw httpError(
      400,
      `No completed suite run for suite "${suite.name}" (${suite.id}) — run \`mcpfp suite run ${suite.id}\` first.`,
    );
  }
  return toSuiteRunSubjectFields(ports, newest, "The target suite run");
}

/** A suite id OR its exact name. An ambiguous name names both ids rather than picking one. */
function resolveSuiteRef(ports: AssertionPorts, ref: string): Suite {
  const suites = ports.suites.list();
  const byId = suites.find((suite) => suite.id === ref);
  if (byId) return byId;

  const byName = suites.filter((suite) => suite.name === ref);
  if (byName.length === 1) return byName[0] as Suite;
  if (byName.length > 1) {
    throw httpError(
      400,
      `"${ref}" matches ${byName.length} saved suites (${byName
        .map((suite) => suite.id)
        .join(", ")}) — name one by id instead.`,
    );
  }
  throw httpError(400, `No saved suite with the id or exact name "${ref}".`);
}

function toSuiteRunSubject(ports: AssertionPorts, run: SuiteRun, label: string): Subject {
  return { kind: "suite_run", ...toSuiteRunSubjectFields(ports, run, label) };
}

/**
 * Unwrap the aggregates ONCE, here, so the two evaluators are total. A `completed` suite run always
 * carries them (`finalize` caches them with the terminal status); a 400 rather than a crash on the
 * impossible case, because the operator can act on "this run has no rolled-up numbers".
 */
function toSuiteRunSubjectFields(
  ports: AssertionPorts,
  run: SuiteRun,
  label: string,
): Omit<Extract<Subject, { kind: "suite_run" }>, "kind"> {
  if (run.aggregates === undefined) {
    throw httpError(
      400,
      `${label} ${run.id} carries no rolled-up aggregates, so there is nothing to measure. Re-run the suite.`,
    );
  }
  return { run, suiteName: suiteNameFor(ports, run), aggregates: run.aggregates };
}

/**
 * The saved suite's name, or an honest label when there is no saved suite to name: a
 * collection/adhoc plan runs through the same orchestrator but creates no Suite row, and a suite
 * deleted after its run leaves an id that resolves to nothing. Inventing a name for either would be
 * worse than saying what happened.
 */
function suiteNameFor(ports: AssertionPorts, run: SuiteRun): string {
  if (run.suiteId === undefined) return `(no saved suite — ${run.source ?? "adhoc"} plan)`;
  const suiteId = run.suiteId;
  const suite = ports.suites.list().find((candidate) => candidate.id === suiteId);
  return suite?.name ?? `(deleted suite ${suiteId})`;
}

// ── Rule evaluation ─────────────────────────────────────────────────────────────────────────────
// One small pure function per kind, dispatched from a map, so WP 2.2's suite/grade rules and WP
// 3.1's `no-new-security-findings` are one map entry each.

/** Everything a SCAN-family evaluator may look at. Assembled once per request. */
type EvaluationContext = {
  subject: ScanDetail;
  /** The resolved baseline, or `null` when no rule needed one / there is no earlier scan. */
  baseline: ScanDetail | null;
  /** `buildComparison(baseline, subject, …)` — **A is the baseline, B is the subject**. */
  comparison: ScanComparison | null;
  skipReason: string | undefined;
};

/**
 * Everything a SUITE-family evaluator may look at (WP 2.2). Deliberately narrower than the scan
 * context: the two suite rules read `aggregates` and nothing else, and there is no differ here —
 * D-MCP4's one differ is `buildComparison`, which compares scans.
 */
type SuiteEvaluationContext = {
  subject: Extract<Subject, { kind: "suite_run" }>;
  baseline: Extract<Subject, { kind: "suite_run" }> | null;
  skipReason: string | undefined;
};

type AnyEvaluationContext = EvaluationContext | SuiteEvaluationContext;

/** The two suite-family rule kinds, derived from the shared meta rather than re-listed here. */
type SuiteRuleKind = "min-suite-score" | "max-suite-cost";

/**
 * An evaluator sees the context of ITS OWN family — which is what lets the six WP 1.3 evaluators
 * below stay byte-for-byte unchanged while the two new ones see a suite run.
 */
type RuleEvaluator<K extends AssertionRuleKind> = K extends SuiteRuleKind
  ? (
      rule: Extract<AssertionRule, { rule: K }>,
      context: SuiteEvaluationContext,
    ) => AssertionRuleResult
  : (rule: Extract<AssertionRule, { rule: K }>, context: EvaluationContext) => AssertionRuleResult;

function evaluateRule(rule: AssertionRule, context: AnyEvaluationContext): AssertionRuleResult {
  if (assertionRuleNeedsBaseline(rule.rule) && !hasComparison(context)) {
    return {
      rule: rule.rule,
      status: "skipped",
      message: `${rule.rule} could not be evaluated without a baseline.`,
      skipReason: context.skipReason ?? "No baseline scan was resolved.",
    };
  }
  // The map is keyed by the discriminant, so this is the ONE place the union is narrowed; each
  // evaluator below is written against its own rule type and its own family's context.
  const evaluator = EVALUATORS[rule.rule] as unknown as (
    rule: AssertionRule,
    context: AnyEvaluationContext,
  ) => AssertionRuleResult;
  return evaluator(rule, context);
}

/** Only a scan context has one; every baseline-dependent rule today is scan-family. */
function hasComparison(context: AnyEvaluationContext): boolean {
  return "comparison" in context && context.comparison !== null;
}

const EVALUATORS: { [K in AssertionRuleKind]: RuleEvaluator<K> } = {
  "max-server-tokens": (rule, { subject }) => {
    const observed = subject.totalTokens;
    const within = observed <= rule.max;
    return {
      rule: rule.rule,
      status: within ? "pass" : "fail",
      observed,
      limit: rule.max,
      message: within
        ? `Server tokens ${formatNumber(observed)} within budget ${formatNumber(rule.max)}.`
        : `Server tokens ${formatNumber(observed)} exceed budget ${formatNumber(rule.max)} by ${formatNumber(observed - rule.max)}.`,
    };
  },

  "max-tool-count": (rule, { subject }) => {
    const observed = subject.totalTools;
    const within = observed <= rule.max;
    return {
      rule: rule.rule,
      status: within ? "pass" : "fail",
      observed,
      limit: rule.max,
      message: within
        ? `${formatNumber(observed)} tools within the limit of ${formatNumber(rule.max)}.`
        : `${formatNumber(observed)} tools exceed the limit of ${formatNumber(rule.max)}.`,
    };
  },

  "max-tool-tokens": (rule, { subject }) => {
    if (rule.tool !== undefined) {
      const named = rule.tool;
      const tool = subject.tools.find((candidate) => candidate.toolName === named);
      if (!tool) {
        // A budget on a tool that vanished is a FINDING, not a no-op: the rule was written because
        // somebody cared about that tool, and "it is gone" is the loudest possible answer.
        return {
          rule: rule.rule,
          status: "fail",
          limit: rule.max,
          message: `Tool "${named}" is not in this scan, so its ${formatNumber(rule.max)}-token budget cannot be met.`,
        };
      }
      const within = tool.totalTokens <= rule.max;
      return {
        rule: rule.rule,
        status: within ? "pass" : "fail",
        observed: tool.totalTokens,
        limit: rule.max,
        message: within
          ? `Tool "${named}" costs ${formatNumber(tool.totalTokens)} tokens, within budget ${formatNumber(rule.max)}.`
          : `Tool "${named}" costs ${formatNumber(tool.totalTokens)} tokens, over budget ${formatNumber(rule.max)}.`,
      };
    }

    const over = subject.tools
      .filter((tool) => tool.totalTokens > rule.max)
      .sort((a, b) => b.totalTokens - a.totalTokens);
    const worst = over[0];
    return {
      rule: rule.rule,
      status: over.length === 0 ? "pass" : "fail",
      observed: worst ? worst.totalTokens : largestToolTokens(subject),
      limit: rule.max,
      message:
        over.length === 0
          ? `All ${formatNumber(subject.tools.length)} tools are within the ${formatNumber(rule.max)}-token budget.`
          : `${formatNumber(over.length)} of ${formatNumber(subject.tools.length)} tools exceed the ${formatNumber(rule.max)}-token budget.`,
      details:
        over.length === 0
          ? undefined
          : capAssertionDetails(
              over.map(
                (tool) =>
                  `${tool.toolName} — ${formatNumber(tool.totalTokens)} > ${formatNumber(rule.max)}`,
              ),
            ),
    };
  },

  // A is the baseline, B is the subject — so `onlyInB` is "new in the subject" and `onlyInA` is
  // "gone from the subject". Getting this backwards inverts both rules; a test pins the direction.
  "no-new-tools": (rule, context) => {
    const added = requireComparison(context).onlyInB;
    return {
      rule: rule.rule,
      status: added.length === 0 ? "pass" : "fail",
      observed: added.length,
      limit: 0,
      message:
        added.length === 0
          ? "No tools were added against the baseline."
          : `${formatNumber(added.length)} tool(s) were added against the baseline.`,
      details:
        added.length === 0
          ? undefined
          : capAssertionDetails(
              added.map((tool) => `+ ${tool.toolName} (${formatNumber(tool.totalTokens)} tokens)`),
            ),
    };
  },

  "no-removed-tools": (rule, context) => {
    const removed = requireComparison(context).onlyInA;
    return {
      rule: rule.rule,
      status: removed.length === 0 ? "pass" : "fail",
      observed: removed.length,
      limit: 0,
      message:
        removed.length === 0
          ? "No tools were removed against the baseline."
          : `${formatNumber(removed.length)} tool(s) were removed against the baseline.`,
      details:
        removed.length === 0
          ? undefined
          : capAssertionDetails(
              removed.map(
                (tool) => `- ${tool.toolName} (${formatNumber(tool.totalTokens)} tokens)`,
              ),
            ),
    };
  },

  "max-scan-delta": (rule, context) => {
    const diff = requireComparison(context);

    // D-C8 case 3, checked FIRST. When the two scans are not on the same scale (a different token
    // profile or a different counting version) `buildComparison` suppresses every token delta to 0.
    // A `max-scan-delta` measured against that suppressed 0 would pass every time — so this is an
    // ERROR, never a pass.
    if (!diff.deltasComparable) {
      const baseline = context.baseline as ScanDetail;
      throw httpError(
        400,
        `Cannot measure a token delta: baseline scan ${baseline.id} and subject scan ${context.subject.id} are not on the same scale ` +
          `(token profiles "${baseline.tokenProfile}" vs "${context.subject.tokenProfile}", ` +
          `counting versions ${baseline.countingVersion} vs ${context.subject.countingVersion}). ` +
          "Re-scan the server so both sides share a profile and a counting version, or drop the max-scan-delta rule.",
      );
    }

    const deltaTokens = diff.totalsDeltaTokens;
    const deltaPercent = diff.totalsDeltaPercent;
    const breaches: string[] = [];
    if (rule.maxTokens !== undefined && Math.abs(deltaTokens) > rule.maxTokens) {
      breaches.push(
        `a ${formatNumber(Math.abs(deltaTokens))}-token change exceeds the ${formatNumber(rule.maxTokens)}-token allowance`,
      );
    }
    if (rule.maxPercent !== undefined && Math.abs(deltaPercent) > rule.maxPercent) {
      breaches.push(
        `a ${Math.abs(deltaPercent).toFixed(1)}% change exceeds the ${rule.maxPercent.toFixed(1)}% allowance`,
      );
    }

    const direction = `${signed(deltaTokens)} tokens (${signedPercent(deltaPercent)}) vs baseline`;
    return {
      rule: rule.rule,
      status: breaches.length === 0 ? "pass" : "fail",
      observed: Math.abs(deltaTokens),
      limit: rule.maxTokens,
      message:
        breaches.length === 0
          ? `Scan delta ${direction} is within the allowance.`
          : `Scan delta ${direction} is out of bounds: ${breaches.join("; ")}.`,
      details: [direction],
    };
  },

  // ── WP 2.2 — the SUITE family ─────────────────────────────────────────────────────────────────
  // Both read the suite run's `aggregates` and nothing else. Both are absolute, so neither can be
  // skipped for want of a baseline; D-C16 has already refused any run whose numbers are not final.

  "min-suite-score": (rule, context) => {
    const aggregates = requireSuiteAggregates(context);
    const observed = aggregates.meanGrade;
    if (observed === null) {
      // NOT a skip. A gate that demanded a score and got none has not been satisfied — and the run
      // IS settled (D-C16), so "no score" is the final answer, not a wait.
      return {
        rule: rule.rule,
        status: "fail",
        limit: rule.min,
        message: `No member run of this suite run produced a graded score, so the required mean grade of ${rule.min.toFixed(2)} cannot be met.`,
      };
    }
    const within = observed >= rule.min;
    return {
      rule: rule.rule,
      status: within ? "pass" : "fail",
      observed,
      limit: rule.min,
      message: within
        ? `Mean grade ${observed.toFixed(2)} is at least the required ${rule.min.toFixed(2)}.`
        : `Mean grade ${observed.toFixed(2)} is below the required ${rule.min.toFixed(2)}.`,
    };
  },

  "max-suite-cost": (rule, context) => {
    const aggregates = requireSuiteAggregates(context);
    const observed = aggregates.execCostUsd + aggregates.judgeCostUsd;
    const within = observed <= rule.maxUsd;
    // Both halves are named on purpose: "the judge blew the budget" and "the matrix blew the budget"
    // are different problems with different fixes.
    const breakdown = `execution $${aggregates.execCostUsd.toFixed(2)} + judge $${aggregates.judgeCostUsd.toFixed(2)}`;
    return {
      rule: rule.rule,
      status: within ? "pass" : "fail",
      observed,
      limit: rule.maxUsd,
      message: within
        ? `Suite run cost $${observed.toFixed(2)} (${breakdown}) is within the $${rule.maxUsd.toFixed(2)} budget.`
        : `Suite run cost $${observed.toFixed(2)} (${breakdown}) exceeds the $${rule.maxUsd.toFixed(2)} budget by $${(observed - rule.maxUsd).toFixed(2)}.`,
    };
  },
};

/**
 * D-C13 makes "a suite rule against a scan subject" a VALIDATION error, so this can only be reached
 * through a bug in this file — hence a 500 rather than a 400. It is still a throw and not a silent
 * pass: "unreachable" is a claim about today's schema, and a gate that quietly passes because its
 * subject was the wrong shape is the exact failure the whole workstream exists to prevent.
 */
function requireSuiteAggregates(context: SuiteEvaluationContext): SuiteAggregates {
  const subject = (context as Partial<SuiteEvaluationContext>).subject;
  if (subject?.kind !== "suite_run") {
    throw httpError(500, "A suite-family rule was evaluated against a subject that is not a suite run.");
  }
  return subject.aggregates;
}

/** The largest per-tool token count, or 0 for a scan with no tools. */
function largestToolTokens(subject: ScanDetail): number {
  return subject.tools.reduce((largest, tool) => Math.max(largest, tool.totalTokens), 0);
}

/**
 * A baseline-dependent evaluator only ever runs after {@link evaluateRule} has established there IS
 * a comparison, so this keeps the evaluators total without each one re-checking. A 500 rather than a
 * 400 on purpose: reaching it would be our bug, not the caller's.
 */
function requireComparison(context: EvaluationContext): ScanComparison {
  if (context.comparison === null || context.baseline === null) {
    throw httpError(500, "A baseline-dependent rule was evaluated without a baseline comparison.");
  }
  return context.comparison;
}

/** `+180` / `−180`, with a real minus sign, so the direction survives a copy into a CI comment. */
function signed(value: number): string {
  return value >= 0 ? `+${formatNumber(value)}` : `−${formatNumber(Math.abs(value))}`;
}

function signedPercent(value: number): string {
  return `${value >= 0 ? "+" : "−"}${Math.abs(value).toFixed(1)}%`;
}
