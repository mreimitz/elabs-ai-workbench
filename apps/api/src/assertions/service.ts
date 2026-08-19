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

import {
  ASSERTION_BASELINE_PREVIOUS,
  ASSERTIONS_VERSION,
  type AssertionEvaluateRequest,
  type AssertionReport,
  type AssertionRule,
  type AssertionRuleKind,
  type AssertionRuleResult,
  type AssertionScanRef,
  type AssertionTarget,
  assertionRuleNeedsBaseline,
  capAssertionDetails,
  DEFAULT_COMPARE_THRESHOLD,
  formatNumber,
  type ScanComparison,
  type ScanDetail,
  type ScanSummary,
  type ServerConfig,
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
  /** Injectable so a test can pin `evaluatedAt`. */
  now?: () => Date;
};

/** Only a `success` scan may take part: a failed or in-flight scan has a partial tool list. */
const USABLE_STATUS = "success";

export function evaluateAssertions(
  ports: AssertionPorts,
  request: AssertionEvaluateRequest,
): AssertionReport {
  // Flag overrides sit ON TOP of the document, matching the CLI's config precedence (flag > file).
  const target = request.target ?? request.document.target;
  const requestedBaseline = request.baseline ?? request.document.baseline;
  const rules = request.document.rules;

  const subject = resolveSubject(ports, target);

  // The baseline is resolved ONLY when a rule actually needs it — a footprint-only gate must not
  // fail on a server that has never been scanned twice.
  const needsBaseline = rules.some((rule) => assertionRuleNeedsBaseline(rule.rule));
  const resolution: BaselineResolution = needsBaseline
    ? resolveBaseline(ports, subject, requestedBaseline ?? ASSERTION_BASELINE_PREVIOUS)
    : { scan: null, requested: undefined, skipReason: undefined };

  const context: EvaluationContext = {
    subject,
    baseline: resolution.scan,
    comparison:
      resolution.scan === null
        ? null
        : buildComparison(resolution.scan, subject, DEFAULT_COMPARE_THRESHOLD),
    skipReason: resolution.skipReason,
  };

  // EVERY rule is evaluated — no short-circuit on the first failure. A CI log that lists one problem
  // at a time costs a round trip per problem.
  const results = rules.map((rule) => evaluateRule(rule, context));

  const failed = results.filter((result) => result.status === "fail").length;
  const skipped = results.filter((result) => result.status === "skipped").length;

  return {
    assertionsVersion: ASSERTIONS_VERSION,
    evaluatedAt: (ports.now?.() ?? new Date()).toISOString(),
    subject: toScanRef(subject),
    baseline:
      resolution.scan === null
        ? null
        : {
            requested: resolution.requested ?? ASSERTION_BASELINE_PREVIOUS,
            scan: toScanRef(resolution.scan),
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
}

// ── Subject + baseline resolution ───────────────────────────────────────────────────────────────

function resolveSubject(ports: AssertionPorts, target: AssertionTarget): ScanDetail {
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
 * Newest first, with the scan id as tie-break — a TOTAL order, unlike `ORDER BY scanned_at DESC`
 * alone. Both "which scan is the subject" and "which scan is the baseline" go through it, so a gate
 * re-run against an unchanged database always compares the same pair.
 */
function newestFirst(a: ScanSummary, b: ScanSummary): number {
  return a.scannedAt === b.scannedAt
    ? b.id.localeCompare(a.id)
    : b.scannedAt.localeCompare(a.scannedAt);
}

type BaselineResolution = {
  scan: ScanDetail | null;
  requested: string | undefined;
  /** Set only when `scan` is null — the D-C8 case-1 skip reason, echoed onto each affected rule. */
  skipReason: string | undefined;
};

/**
 * **D-C3 — symbolic in, concrete out.** `"previous"` resolves to the newest earlier succeeded scan
 * of the SUBJECT'S OWN server; anything else is treated as an explicit scan id. Either way the
 * caller gets one concrete scan, echoed into the report so the artifact records what was compared.
 */
function resolveBaseline(
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
        scan: null,
        requested,
        skipReason: `No earlier completed scan of "${subject.serverName}" — ${subject.id} is the first one, so there is nothing to compare against.`,
      };
    }
    return { scan: ports.scans.getDetail(newest.id), requested, skipReason: undefined };
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
  return { scan: baseline, requested, skipReason: undefined };
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

// ── Rule evaluation ─────────────────────────────────────────────────────────────────────────────
// One small pure function per kind, dispatched from a map, so WP 2.2's suite/grade rules and WP
// 3.1's `no-new-security-findings` are one map entry each.

/** Everything an evaluator may look at. Assembled once per request. */
type EvaluationContext = {
  subject: ScanDetail;
  /** The resolved baseline, or `null` when no rule needed one / there is no earlier scan. */
  baseline: ScanDetail | null;
  /** `buildComparison(baseline, subject, …)` — **A is the baseline, B is the subject**. */
  comparison: ScanComparison | null;
  skipReason: string | undefined;
};

type RuleEvaluator<K extends AssertionRuleKind> = (
  rule: Extract<AssertionRule, { rule: K }>,
  context: EvaluationContext,
) => AssertionRuleResult;

function evaluateRule(rule: AssertionRule, context: EvaluationContext): AssertionRuleResult {
  if (assertionRuleNeedsBaseline(rule.rule) && context.comparison === null) {
    return {
      rule: rule.rule,
      status: "skipped",
      message: `${rule.rule} could not be evaluated without a baseline.`,
      skipReason: context.skipReason ?? "No baseline scan was resolved.",
    };
  }
  // The map is keyed by the discriminant, so this is the ONE place the union is narrowed; each
  // evaluator below is written against its own rule type.
  const evaluator = EVALUATORS[rule.rule] as RuleEvaluator<AssertionRuleKind>;
  return evaluator(rule as never, context);
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
              removed.map((tool) => `- ${tool.toolName} (${formatNumber(tool.totalTokens)} tokens)`),
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
};

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
