import { z } from "zod";
import { formatNumber, formatPercent } from "./format.js";
import { SECURITY_SEVERITIES, type SecuritySeverity } from "./security-posture.js";
import type { RunPlanSource, SuiteRunStatus, TokenProfileId } from "./types.js";

// ==================================================================================================
// CI assertions contract — the `mcpfp.assert.json` document, the rule vocabulary, and the itemized
// report the API returns (planning/Roadmap/RM-08-ci/, WP 1.3)
// ==================================================================================================
// **Assertions are evaluated SERVER-SIDE and the CLI only renders the result** (the
// `planning/Roadmap/RM-08-ci/item.md` invariant). That is why the document shape, the rule union and the report
// live here rather than in `apps/cli`: one declaration, imported by both ends, so neither can drift
// into re-deriving the other's shape from prose. `apps/cli` cannot import `zod` at all (its only
// runtime dependency is this package — D-C5), so the schema it validates a gate file with has to
// live in a package that already depends on zod. This one does.
//
// Locked decisions this module encodes (2026-08-19, `planning/Roadmap/RM-08-ci/wp-1.3-assertions.md`):
//
//   • **D-C3 — baseline semantics: symbolic in, concrete out.** A baseline may be named symbolically
//     (`"previous"`) or as an explicit scan id; either way the API resolves it to exactly ONE
//     concrete scan and echoes that id (plus its `scannedAt`) in {@link AssertionReport.baseline}, so
//     the artifact records what was actually compared and the same gate can be re-run against the
//     same pair later.
//   • **D-C7 — exit codes.** `mcpfp assert` is the only thing in the repo that may emit `1`. A rule
//     that FAILED is a `1`; a gate that could not RUN (bad file, unresolvable target, transport,
//     non-2xx, an incomparable baseline) is a `2`. Those two must never collapse into one code.
//   • **D-C8 — an unevaluable rule is never a silent pass.** See {@link AssertionRuleResult.skipReason}:
//     "there is no earlier scan yet" is a `skipped` + exit 0; "you named a baseline that does not
//     resolve" and "the two scans are not on the same scale" are both errors (exit 2), because a
//     suppressed-to-zero delta would pass a `max-scan-delta` rule every single time.
//   • **D-C9 — `assert` never runs a scan.** It evaluates an already-persisted one. Scanning is
//     `mcpfp scan`; a CI job chains the two, which is what keeps the exit codes honest.
//
// Locked decisions WP 2.2 adds (2026-08-20, `planning/Roadmap/RM-08-ci/wp-2.2-suite-assertions-artifact.md`). Every
// one of them is ADDITIVE — {@link ASSERTIONS_VERSION} stays 1 and every v1 document that validated
// yesterday still validates today:
//
//   • **D-C13 — a gate document stays SINGLE-FAMILY: one target, one family of rules.** A footprint
//     gate (`{server}`/`{scan}` + the six scan rules) and a quality gate (`{suite}`/`{suiteRun}` +
//     the two suite rules) are two files, run as two `mcpfp assert` invocations — which is also what
//     keeps the two exit codes readable in a build log. Enforced by
//     {@link assertionDocumentSchema}'s refinement, which names the offending rule INDEX.
//   • **D-C14 — a NAMED baseline is always resolved and always echoed, even when no rule needs one.**
//     The PR artifact's whole value is the delta sentence, and both suite rules are absolute, so a
//     suite gate would otherwise produce an artifact with nothing to compare. In the same change the
//     report's identity fields widen to the discriminated {@link AssertionSubjectRef}, so every
//     consumer is forced by the compiler to handle both subject kinds.
//   • **D-C15 — the PR-comment body is ONE pure function, {@link renderAssertionMarkdown}, rendered
//     from the report alone.** Not a second API endpoint (evaluation is server-side, formatting is
//     the client's job — D-C6) and not a private copy in `apps/cli` (WP 2.3's workflow would
//     re-derive it). It carries no credential, no absolute path and no filesystem detail.
//   • **D-C16 — a suite gate refuses a suite run that is not `completed` and settled.** Enforced in
//     the API, not here; see `apps/api/src/assertions/service.ts`. A half-graded matrix read as a
//     mean score would report a quality regression that is really just grading latency.
//
// Locked decisions WP 3.1 adds (2026-08-20, `planning/Roadmap/RM-08-ci/wp-3.1-no-new-security-findings.md`). All
// three are ADDITIVE — {@link ASSERTIONS_VERSION} stays 1, and every v1 document still validates:
//
//   • **D-C20 — "new" is set membership by (ruleId, anchor), never a count.** The comparison is
//     `securityFindingIdentity` from `security-posture.ts` (declared there because WP 1.4's posture
//     diff needs the same notion of "the same finding"), so a release that RESOLVED one finding and
//     INTRODUCED a different one fails — which a count comparison would pass. Evidence text is
//     deliberately outside the identity: a reworded description that still trips the same rule on the
//     same tool is the same finding.
//   • **D-C21 — `minSeverity` defaults to {@link NO_NEW_SECURITY_FINDINGS_DEFAULT_MIN_SEVERITY}
//     (`"warning"`).** `error` and `warning` gate; `info` findings are hygiene, and a gate that goes
//     red on day one for hygiene is a gate that gets deleted. It is an OPTIONAL field with a named
//     constant rather than a zod `.default()`, so the default is a decision somebody wrote down.
//   • **D-C22 — an analyzer-version mismatch between the two reports is an ERROR, not a pass.**
//     Enforced in the API; the exact shape of D-C8's `deltasComparable` guard.

/**
 * The version of the {@link assertionDocumentSchema} below. Bumped **only** for a breaking change to
 * the document's shape — adding a rule kind is additive and leaves this at 1.
 *
 * A document declaring a HIGHER version is refused with a sentence naming both versions rather than
 * best-effort parsed: a gate written for a workbench that understands more rules than this one would
 * otherwise appear to pass while silently ignoring the rules it could not read.
 */
export const ASSERTIONS_VERSION = 1;

/** The file `mcpfp assert` reads when none is named, found by walking UP from the cwd. */
export const MCPFP_ASSERT_FILE_NAME = "mcpfp.assert.json";

/**
 * How many itemized lines a single {@link AssertionRuleResult.details} may carry before the rest are
 * collapsed into a final `…and N more`. A server that added 300 tools must not produce a 300-line CI
 * log or a megabyte of JSON.
 */
export const ASSERTION_DETAIL_LIMIT = 20;

/**
 * The rule vocabulary. WP 1.3 froze the six SCAN rules; WP 2.2 APPENDED the two SUITE rules; WP 3.1
 * APPENDED `no-new-security-findings` (the order here is the `mcpfp help assert` table's order). A
 * new kind is one member here, one schema below, one {@link ASSERTION_RULE_META} entry, and one
 * evaluator in the API's dispatch map — nothing above it moves.
 */
export const ASSERTION_RULE_KINDS = [
  "max-server-tokens",
  "max-tool-tokens",
  "max-tool-count",
  "no-new-tools",
  "no-removed-tools",
  "max-scan-delta",
  "min-suite-score",
  "max-suite-cost",
  "no-new-security-findings",
] as const;

export type AssertionRuleKind = (typeof ASSERTION_RULE_KINDS)[number];

/**
 * **D-C13** — which kind of subject a rule can be measured against. A gate document is
 * SINGLE-FAMILY: its target's family and every one of its rules' families must agree, so a file
 * cannot half-assert a scan and half-assert a suite run and quietly skip the half that does not fit.
 * A repo that wants both keeps two files and runs `mcpfp assert` twice.
 */
export type AssertionRuleFamily = "scan" | "suite";

/**
 * One sentence per rule kind. Reused verbatim by `mcpfp help assert` and by the user guide's rule
 * table, so the prose an operator reads cannot drift from the schema that validates their file.
 */
export const ASSERTION_RULE_META: Record<
  AssertionRuleKind,
  {
    readonly summary: string;
    readonly needsBaseline: boolean;
    /** **D-C13** — the subject family this rule can be measured against. */
    readonly family: AssertionRuleFamily;
  }
> = {
  "max-server-tokens": {
    summary:
      "The whole server's tool definitions must cost at most `max` tokens in the scan under test.",
    needsBaseline: false,
    family: "scan",
  },
  "max-tool-tokens": {
    summary:
      "Every tool must cost at most `max` tokens; with `tool`, only that one — and a named tool that is missing FAILS.",
    needsBaseline: false,
    family: "scan",
  },
  "max-tool-count": {
    summary: "The server must expose at most `max` tools.",
    needsBaseline: false,
    family: "scan",
  },
  "no-new-tools": {
    summary: "No tool may appear that the baseline scan did not have.",
    needsBaseline: true,
    family: "scan",
  },
  "no-removed-tools": {
    summary: "No tool the baseline scan had may have disappeared.",
    needsBaseline: true,
    family: "scan",
  },
  "max-scan-delta": {
    summary:
      "The token change against the baseline must stay within `maxTokens` and/or `maxPercent` — both are absolute magnitudes, so a large DROP fails too.",
    needsBaseline: true,
    family: "scan",
  },
  // WP 2.2 — the two SUITE rules. Both are ABSOLUTE (they need no baseline); a suite gate that also
  // wants the delta sentence in its PR comment names a `baseline`, which D-C14 resolves anyway.
  "min-suite-score": {
    summary:
      "The suite run's mean grade must be at least `min` (0–1); a completed run whose mean grade is null FAILS, because a gate that demanded a score and got none has not been satisfied.",
    needsBaseline: false,
    family: "suite",
  },
  "max-suite-cost": {
    summary:
      "The suite run's execution + judge cost must be at most `maxUsd`; both halves are named in the message, because a judge that blew the budget and a matrix that blew the budget are different problems.",
    needsBaseline: false,
    family: "suite",
  },
  // WP 3.1 — the posture rule. SCAN-family (D-C13), so it composes with the six footprint rules in
  // ONE gate file: a repo gates its MCP server's surface and its posture in a single document.
  "no-new-security-findings": {
    summary:
      'No security finding may appear that the baseline scan did not have; a finding is the same finding when its rule id and its anchor (tool, parameter, or the server) match, whatever the wording, and only findings at or above `minSeverity` (default "warning") gate.',
    needsBaseline: true,
    family: "scan",
  },
};

/** Whether a rule kind can only be evaluated against a baseline scan. */
export function assertionRuleNeedsBaseline(kind: AssertionRuleKind): boolean {
  return ASSERTION_RULE_META[kind].needsBaseline;
}

/** **D-C13** — which subject family a rule kind belongs to. */
export function assertionRuleFamily(kind: AssertionRuleKind): AssertionRuleFamily {
  return ASSERTION_RULE_META[kind].family;
}

/** The symbolic baseline: "the newest earlier succeeded scan of the subject's own server". */
export const ASSERTION_BASELINE_PREVIOUS = "previous";

// ── The document ────────────────────────────────────────────────────────────────────────────────
// `.strict()` at EVERY level is the point: a typo'd key must be a loud `2` naming the field, never a
// rule that is silently dropped from a gate somebody believes is protecting them.

/**
 * What to assert against. Four shapes, two families (**D-C13**):
 *
 *   • `{ server }` — a server id or its exact name; its newest succeeded scan is used.
 *   • `{ scan }`   — one exact scan.
 *   • `{ suite }`  — a suite id or its exact name; its newest **completed + settled** suite run is used.
 *   • `{ suiteRun }` — one exact suite run.
 *
 * Expressed as a union of strict objects, so naming two of them is a validation error rather than a
 * silent precedence rule nobody remembers.
 */
export const assertionTargetSchema = z.union([
  z.object({ server: z.string().min(1) }).strict(),
  z.object({ scan: z.string().min(1) }).strict(),
  z.object({ suite: z.string().min(1) }).strict(),
  z.object({ suiteRun: z.string().min(1) }).strict(),
]);

export type AssertionTarget = z.infer<typeof assertionTargetSchema>;

/**
 * **D-C13** — which family a target belongs to. Exported so the API's subject resolution and the
 * document refinement below share ONE answer rather than each re-deriving it from the key names.
 */
export function assertionTargetFamily(target: AssertionTarget): AssertionRuleFamily {
  return "suite" in target || "suiteRun" in target ? "suite" : "scan";
}

const budget = z.number().int().nonnegative();

export const maxServerTokensRuleSchema = z
  .object({ rule: z.literal("max-server-tokens"), max: budget })
  .strict();

export const maxToolTokensRuleSchema = z
  .object({
    rule: z.literal("max-tool-tokens"),
    max: budget,
    /** Exact tool name. Omitted, the budget applies to EVERY tool in the scan. */
    tool: z.string().min(1).optional(),
  })
  .strict();

export const maxToolCountRuleSchema = z
  .object({ rule: z.literal("max-tool-count"), max: budget })
  .strict();

export const noNewToolsRuleSchema = z.object({ rule: z.literal("no-new-tools") }).strict();

export const noRemovedToolsRuleSchema = z.object({ rule: z.literal("no-removed-tools") }).strict();

export const maxScanDeltaRuleSchema = z
  .object({
    rule: z.literal("max-scan-delta"),
    /** Absolute token magnitude. `|subject − baseline|`, so a large DROP fails too. */
    maxTokens: budget.optional(),
    /** Absolute percentage magnitude, compared against `Math.abs(totalsDeltaPercent)`. */
    maxPercent: z.number().nonnegative().optional(),
  })
  .strict();

// WP 2.2 — the two SUITE rules (D-C13 family `"suite"`). Both read the suite run's `aggregates` and
// nothing else, and both are absolute: neither needs a baseline.

export const minSuiteScoreRuleSchema = z
  .object({
    rule: z.literal("min-suite-score"),
    /** The floor the suite run's `aggregates.meanGrade` must clear. A grade is a 0–1 fraction. */
    min: z.number().min(0).max(1),
  })
  .strict();

export const maxSuiteCostRuleSchema = z
  .object({
    rule: z.literal("max-suite-cost"),
    /** The ceiling for `aggregates.execCostUsd + aggregates.judgeCostUsd`. A budget of 0 is not a budget. */
    maxUsd: z.number().positive(),
  })
  .strict();

// WP 3.1 — the POSTURE rule (D-C13 family `"scan"`). It carries no threshold of its own beyond a
// severity floor: everything it measures comes from the security-posture analyzer, which owns every
// heuristic, every severity and the score. There is no rule id, no regex and no weight here.

/**
 * **D-C21** — the severity floor `no-new-security-findings` uses when the rule does not name one.
 *
 * `error` and `warning` findings gate; `info` findings (an undescribed parameter, an unmarked
 * open-world tool, an unconstrained `additionalProperties`) are hygiene. A posture gate that goes red
 * on its first run because a third-party server left three parameters undescribed is a gate somebody
 * deletes that afternoon — so the strict posture is opt-in, written as `"minSeverity": "info"`.
 *
 * A named constant rather than a zod `.default()`, so the default reads as a decision in the one
 * place a reader looks for it, and a test can pin it.
 */
export const NO_NEW_SECURITY_FINDINGS_DEFAULT_MIN_SEVERITY: SecuritySeverity = "warning";

export const noNewSecurityFindingsRuleSchema = z
  .object({
    rule: z.literal("no-new-security-findings"),
    /**
     * The severity floor. Omitted ⇒ {@link NO_NEW_SECURITY_FINDINGS_DEFAULT_MIN_SEVERITY}. The three
     * values are `SECURITY_SEVERITIES` itself — restating them here would let the gate's vocabulary
     * drift from the analyzer's.
     */
    minSeverity: z.enum(SECURITY_SEVERITIES).optional(),
  })
  .strict();

export const assertionRuleSchema = z.discriminatedUnion("rule", [
  maxServerTokensRuleSchema,
  maxToolTokensRuleSchema,
  maxToolCountRuleSchema,
  noNewToolsRuleSchema,
  noRemovedToolsRuleSchema,
  maxScanDeltaRuleSchema,
  minSuiteScoreRuleSchema,
  maxSuiteCostRuleSchema,
  noNewSecurityFindingsRuleSchema,
]);

export type AssertionRule = z.infer<typeof assertionRuleSchema>;

/**
 * The rules array. Non-empty, because a gate file that asserts nothing and exits 0 is worse than no
 * gate at all — it looks like protection.
 *
 * The `superRefine` carries the one cross-field rule the discriminated union cannot express itself:
 * `max-scan-delta` needs at least one bound. (A refinement on the member would make it a
 * `ZodEffects`, which zod v3 refuses as a `discriminatedUnion` option — so it lives here, where the
 * issue path still points at the offending rule index.)
 */
export const assertionRulesSchema = z
  .array(assertionRuleSchema)
  .min(1, "a gate needs at least one rule")
  .superRefine((rules, ctx) => {
    rules.forEach((rule, index) => {
      if (rule.rule !== "max-scan-delta") return;
      if (rule.maxTokens === undefined && rule.maxPercent === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [index],
          message: "max-scan-delta needs at least one of maxTokens or maxPercent",
        });
      }
    });
  });

export const assertionDocumentSchema = z
  .object({
    version: z
      .number()
      .int()
      .superRefine((value, ctx) => {
        if (value === ASSERTIONS_VERSION) return;
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `this file was written for assertions v${value}; this workbench speaks v${ASSERTIONS_VERSION}`,
        });
      }),
    target: assertionTargetSchema,
    /**
     * `"previous"` or an explicit id of the target's own kind (a scan id, or a suite-run id).
     *
     * **D-C14** — resolved whenever it is NAMED, not only when a rule needs it. WP 1.3 resolved it
     * lazily; the PR artifact's whole value is the delta sentence, and both suite rules are
     * absolute, so a suite gate would otherwise produce an artifact with nothing to compare. An
     * UNNAMED baseline with no baseline-dependent rule still resolves nothing.
     */
    baseline: z.string().min(1).optional(),
    rules: assertionRulesSchema,
  })
  .strict()
  // **D-C13 — one target, one family of rules.** The refinement lives at the DOCUMENT level because
  // it is the one cross-field rule that needs both halves; the issue path points at
  // `["rules", index]` so the operator is told exactly which rule is the odd one out rather than
  // being handed "this document is invalid".
  .superRefine((document, ctx) => {
    const targetFamily = assertionTargetFamily(document.target);
    document.rules.forEach((rule, index) => {
      const ruleFamily = assertionRuleFamily(rule.rule);
      if (ruleFamily === targetFamily) return;
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["rules", index],
        message: `"${rule.rule}" is a ${ruleFamily} rule, but this document's target is a ${targetFamily} target. A gate file asserts ONE family — keep the ${ruleFamily} rules in their own file and run \`mcpfp assert\` twice.`,
      });
    });
  });

export type AssertionDocument = z.infer<typeof assertionDocumentSchema>;

/**
 * The request body of `POST /api/assertions/evaluate`: the document, plus the CLI flag overrides
 * applied over the document's own `target`/`baseline` (`--scan`/`--server`/`--baseline`).
 */
export const assertionEvaluateSchema = z
  .object({
    document: assertionDocumentSchema,
    target: assertionTargetSchema.optional(),
    baseline: z.string().min(1).optional(),
  })
  .strict();

export type AssertionEvaluateRequest = z.infer<typeof assertionEvaluateSchema>;

// ── The result ──────────────────────────────────────────────────────────────────────────────────

export type AssertionStatus = "pass" | "fail" | "skipped";

/**
 * The outcome of ONE rule.
 *
 * Named `AssertionRuleResult` rather than the WP spec's `AssertionResult` because that name is
 * already taken, in this same package, by the **test-gate** assertions of the Benchmarks/SkillFlow
 * workstream (`types.ts` — `AssertionRef` / `ASSERTION_KINDS`, a completely different concept: a
 * per-run gate on a skill route). Two different things cannot share one exported name through
 * `index.ts`; the suffix also reads correctly next to {@link AssertionRuleKind}.
 */
export type AssertionRuleResult = {
  rule: AssertionRuleKind;
  status: AssertionStatus;
  /** One operator-facing sentence, e.g. "Server tokens 2,224 within budget 3,000." */
  message: string;
  /** What the rule measured, when it measured a number. */
  observed?: number;
  /** The bound it was measured against. */
  limit?: number;
  /**
   * Rule-specific itemization: the tools added/removed, the tools over budget. Capped at
   * {@link ASSERTION_DETAIL_LIMIT} entries plus a final `…and N more`.
   */
  details?: string[];
  /** Present only on `skipped`: WHY it could not be evaluated (D-C8 case 1). */
  skipReason?: string;
};

/**
 * One SCAN side of the evaluation — enough to reproduce it, never enough to leak anything.
 *
 * Unchanged since WP 1.3, deliberately: {@link AssertionSubjectRef} adds a `kind` discriminant
 * ALONGSIDE these members rather than reshaping them, so a WP 1.3 consumer that destructured a scan
 * ref still compiles and a WP 1.3 report's JSON still reads.
 */
export type AssertionScanRef = {
  scanId: string;
  serverId: string;
  serverName: string;
  scannedAt: string;
  tokenProfile: TokenProfileId;
  countingVersion: number;
  totalTokens: number;
  totalTools: number;
};

/**
 * One SUITE-RUN side of the evaluation (WP 2.2) — the mirror of {@link AssertionScanRef}: enough to
 * reproduce the comparison and to write the artifact's delta sentence, and nothing more. There is no
 * provider key here, no model credential, no filesystem path — a PR comment built from this cannot
 * leak one.
 */
export type AssertionSuiteRunRef = {
  suiteRunId: string;
  /** Absent for a `collection`/`adhoc` plan, which runs as a suite run but owns no saved Suite row. */
  suiteId?: string;
  /** The saved suite's name, or an honest label when the run belongs to no saved suite. */
  suiteName: string;
  source?: RunPlanSource;
  startedAt: string;
  endedAt?: string;
  status: SuiteRunStatus;
  cellsTotal: number;
  cellsCompleted: number;
  /** `null` when no member run produced a graded score. A rule that wanted one FAILS on that. */
  meanGrade: number | null;
  execCostUsd: number;
  judgeCostUsd: number;
};

/**
 * **D-C14** — what a report identifies, as a DISCRIMINATED union, so every consumer is forced by the
 * compiler to handle both subject kinds rather than reading `scanId` off a suite run and getting
 * `undefined`.
 *
 * The scan variant is byte-identical to WP 1.3's plus the `kind` discriminant, so an existing report
 * stays valid under the "additive response fields only" rule.
 */
export type AssertionSubjectRef =
  | ({ kind: "scan" } & AssertionScanRef)
  | ({ kind: "suite_run" } & AssertionSuiteRunRef);

export type AssertionReport = {
  assertionsVersion: number;
  /** ISO 8601 instant the API evaluated the gate. */
  evaluatedAt: string;
  subject: AssertionSubjectRef;
  /**
   * **D-C3** — what was ASKED for (`"previous"` or an explicit id), and the single concrete subject
   * it RESOLVED to. `null` when no baseline was named and no rule needed one, or when there is
   * nothing earlier to compare against (in which case {@link AssertionReport.baselineSkipReason}
   * says so).
   *
   * The member is named `scan` for WIRE COMPATIBILITY — it is the baseline *subject*, and since
   * WP 2.2 it may be a suite run. Renaming it would break WP 1.3's renderer and its tests for no
   * gain.
   */
  baseline: { requested: string; scan: AssertionSubjectRef } | null;
  /**
   * **D-C14** — present only when a baseline WAS named (or defaulted-because-needed) and resolved to
   * nothing: this is the server's first scan / the suite's first run. Optional and additive, so a
   * report that resolved a baseline, and one that named none, are byte-identical to WP 1.3's.
   *
   * It exists because {@link renderAssertionMarkdown} must be able to say WHY there is no delta
   * sentence, and "the gate named none" and "there is nothing earlier yet" are different answers.
   */
  baselineSkipReason?: string;
  results: AssertionRuleResult[];
  counts: { total: number; passed: number; failed: number; skipped: number };
  /** False iff at least one result is `"fail"`. A report with only passes and skips is `true`. */
  passed: boolean;
  /**
   * RM-38 D-DP8 — the reference data pack the gate was evaluated against. A CI verdict that cannot
   * name its data version is not reproducible: `no-new-security-findings` re-projects the security
   * analyzer, whose whole rule table now ships in the pack.
   */
  dataPackVersion?: string;
};

/** The id of whichever subject kind this is — the scan id, or the suite-run id. */
export function assertionSubjectId(ref: AssertionSubjectRef): string {
  return ref.kind === "scan" ? ref.scanId : ref.suiteRunId;
}

/** The ISO instant this subject was captured: a scan's `scannedAt`, a suite run's `startedAt`. */
export function assertionSubjectInstant(ref: AssertionSubjectRef): string {
  return ref.kind === "scan" ? ref.scannedAt : ref.startedAt;
}

/** `"Everything" (srv_1)` / `"Nightly" (ste_1)` — the operator-facing name of whatever was asserted. */
export function assertionSubjectLabel(ref: AssertionSubjectRef): string {
  return ref.kind === "scan"
    ? `${ref.serverName} (${ref.serverId})`
    : `${ref.suiteName}${ref.suiteId === undefined ? "" : ` (${ref.suiteId})`}`;
}

/**
 * Cap an itemization at {@link ASSERTION_DETAIL_LIMIT}, appending `…and N more` when it bit. Shared
 * so the API's rules and any later renderer agree on the one cap.
 */
export function capAssertionDetails(lines: string[]): string[] {
  if (lines.length <= ASSERTION_DETAIL_LIMIT) return lines;
  const kept = lines.slice(0, ASSERTION_DETAIL_LIMIT);
  kept.push(`…and ${lines.length - ASSERTION_DETAIL_LIMIT} more`);
  return kept;
}

// ── The PR-comment artifact (D-C15) ─────────────────────────────────────────────────────────────
//
// **ONE pure function, rendered from the report alone.** Not a second API endpoint (the *evaluation*
// is server-side; *formatting* is the client's job — D-C6) and not a private copy in `apps/cli`
// (WP 2.3's workflow, and anything else that later wants the same comment, would re-derive it).
//
// Two properties this section exists to hold:
//
//   • **Deterministic.** Everything it prints comes out of the report; a byte-for-byte re-render of
//     the same report is identical. Instants are echoed as the report's own ISO strings rather than
//     localized, so the artifact does not change when the runner's timezone does.
//   • **Leak-free.** No credential, no absolute local path, no filesystem detail — the report's own
//     identity refs carry none, and nothing here reads an environment.

/** How the verdict reads at the top of the comment. */
const VERDICT_ICON: Record<AssertionStatus, string> = {
  pass: "✅",
  fail: "❌",
  skipped: "⚠️",
};

/**
 * Render the pull-request comment body for one {@link AssertionReport}.
 *
 * The sections, in order and with nothing else: the verdict heading · the identity line · the delta
 * sentence (or an honest line saying why there is none) · the rules table · a collapsed `<details>`
 * block per failing rule that itemized something · a footer naming the assertions version and the
 * evaluation instant.
 */
export function renderAssertionMarkdown(report: AssertionReport): string {
  const sections = [
    renderVerdictHeading(report),
    renderIdentityLine(report),
    renderDeltaSentence(report),
    renderRulesTable(report),
    ...renderFailureDetails(report),
    // RM-38 D-DP8 — the footer names the reference data pack beside the assertions version, because
    // a gate verdict is only reproducible if a reader can obtain the same rule tables and
    // thresholds. Appended to the existing footer rather than given a section of its own: the
    // document's shape is a contract (D-C15/WP 1.3's tests grep it).
    `<sub>mcpfp assertions v${report.assertionsVersion}${
      report.dataPackVersion === undefined ? "" : ` · data pack ${report.dataPackVersion}`
    } · evaluated ${report.evaluatedAt}</sub>`,
  ];
  // One blank line between sections, one trailing newline: a comment body, not a document.
  return `${sections.join("\n\n")}\n`;
}

function renderVerdictHeading(report: AssertionReport): string {
  const verdict = report.passed ? "✅ mcpfp gate passed" : "❌ mcpfp gate failed";
  const skipped = report.counts.skipped;
  // A skip is not a pass and not a failure — it is "this rule did not actually run", and it belongs
  // in the one line a reviewer is guaranteed to read.
  return `## ${verdict}${skipped > 0 ? ` — ${formatNumber(skipped)} skipped` : ""}`;
}

function renderIdentityLine(report: AssertionReport): string {
  const subject = report.subject;
  const what = subject.kind === "scan" ? "scan" : "suite run";
  return `**${assertionSubjectLabel(subject)}** · ${what} \`${assertionSubjectId(subject)}\` · captured ${assertionSubjectInstant(subject)}`;
}

function renderDeltaSentence(report: AssertionReport): string {
  const baseline = report.baseline;
  if (baseline === null) {
    // Honest about WHICH of the two reasons it is — that is what `baselineSkipReason` is for.
    return report.baselineSkipReason === undefined
      ? "No baseline was compared — this gate named none."
      : `No baseline was compared — ${report.baselineSkipReason}`;
  }

  const against = `against ${baseline.scan.kind === "scan" ? "scan" : "suite run"} \`${assertionSubjectId(baseline.scan)}\` (${assertionSubjectInstant(baseline.scan)}, asked for \`${baseline.requested}\`)`;

  if (report.subject.kind === "scan" && baseline.scan.kind === "scan") {
    const from = baseline.scan.totalTokens;
    const to = report.subject.totalTokens;
    return `Tokens ${formatNumber(from)} → ${formatNumber(to)} (${signedTokens(to - from)}${renderPercentSuffix(from, to)}) ${against}.`;
  }

  if (report.subject.kind === "suite_run" && baseline.scan.kind === "suite_run") {
    const gradeLine = renderGradeDelta(baseline.scan.meanGrade, report.subject.meanGrade);
    const costLine = renderCostDelta(totalCostOf(baseline.scan), totalCostOf(report.subject));
    return `${gradeLine}\n${costLine}\n\nCompared ${against}.`;
  }

  // Unreachable: D-C13 keeps a document single-family, so the two sides always share a kind. Said
  // out loud rather than crashed on, because an artifact is not the place to throw.
  return `Compared ${against}.`;
}

function renderGradeDelta(from: number | null, to: number | null): string {
  if (from === null || to === null) {
    return `Mean grade ${renderGrade(from)} → ${renderGrade(to)} (no delta — one side has no graded score).`;
  }
  return `Mean grade ${renderGrade(from)} → ${renderGrade(to)} (${signedFixed(to - from, 2)}).`;
}

function renderCostDelta(from: number, to: number): string {
  return `Cost $${from.toFixed(2)} → $${to.toFixed(2)} (${signedMoney(to - from)}).`;
}

function totalCostOf(ref: AssertionSuiteRunRef): number {
  return ref.execCostUsd + ref.judgeCostUsd;
}

function renderGrade(value: number | null): string {
  return value === null ? "none" : value.toFixed(2);
}

/** Omitted rather than divided by zero: a baseline of 0 tokens has no meaningful percentage. */
function renderPercentSuffix(from: number, to: number): string {
  if (from === 0) return "";
  const percent = ((to - from) / from) * 100;
  return `, ${percent < 0 ? "−" : "+"}${formatPercent(Math.abs(percent))}`;
}

function renderRulesTable(report: AssertionReport): string {
  const rows = report.results.map(
    (result) =>
      `| \`${result.rule}\` | ${VERDICT_ICON[result.status]} ${result.status} | ${renderMeasure(result.observed)} | ${renderMeasure(result.limit)} |`,
  );
  return ["| Rule | Status | Observed | Limit |", "| --- | --- | --- | --- |", ...rows].join("\n");
}

/**
 * A whole number is grouped with the shared {@link formatNumber}; a fraction (a 0–1 grade, a dollar
 * amount) is shown to two decimals, because rounding 0.84 to "1" would turn the table into a lie.
 */
function renderMeasure(value: number | undefined): string {
  if (value === undefined) return "—";
  return Number.isInteger(value) ? formatNumber(value) : value.toFixed(2);
}

/**
 * One collapsed block per FAILING rule that itemized something. The lines come from
 * {@link AssertionRuleResult.details}, which the API already capped at
 * {@link ASSERTION_DETAIL_LIMIT} — never re-capped here, never un-capped.
 */
function renderFailureDetails(report: AssertionReport): string[] {
  return report.results
    .filter((result) => result.status === "fail" && (result.details?.length ?? 0) > 0)
    .map((result) => {
      const lines = (result.details ?? []).map((line) => `- ${line}`).join("\n");
      return `<details>\n<summary>❌ ${result.rule} — ${result.message}</summary>\n\n${lines}\n\n</details>`;
    });
}

/** `+186` / `−186`, with a real minus sign, so the direction survives a copy into a comment. */
function signedTokens(value: number): string {
  return `${value < 0 ? "−" : "+"}${formatNumber(Math.abs(value))}`;
}

function signedFixed(value: number, digits: number): string {
  return `${value < 0 ? "−" : "+"}${Math.abs(value).toFixed(digits)}`;
}

function signedMoney(value: number): string {
  return `${value < 0 ? "−" : "+"}$${Math.abs(value).toFixed(2)}`;
}
