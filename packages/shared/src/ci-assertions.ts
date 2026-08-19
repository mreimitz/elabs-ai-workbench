import { z } from "zod";
import type { TokenProfileId } from "./types.js";

// ==================================================================================================
// CI assertions contract — the `mcpfp.assert.json` document, the rule vocabulary, and the itemized
// report the API returns (roadmap/ci/, WP 1.3)
// ==================================================================================================
// **Assertions are evaluated SERVER-SIDE and the CLI only renders the result** (the
// `roadmap/ci/README.md` invariant). That is why the document shape, the rule union and the report
// live here rather than in `apps/cli`: one declaration, imported by both ends, so neither can drift
// into re-deriving the other's shape from prose. `apps/cli` cannot import `zod` at all (its only
// runtime dependency is this package — D-C5), so the schema it validates a gate file with has to
// live in a package that already depends on zod. This one does.
//
// Locked decisions this module encodes (2026-08-19, `roadmap/ci/wp-1.3-assertions.md`):
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
 * The rule vocabulary this WP freezes. WP 2.2 (suite/grade rules) and WP 3.1
 * (`no-new-security-findings`) extend it additively — a new kind is one member here, one schema
 * below, and one evaluator in the API's dispatch map.
 */
export const ASSERTION_RULE_KINDS = [
  "max-server-tokens",
  "max-tool-tokens",
  "max-tool-count",
  "no-new-tools",
  "no-removed-tools",
  "max-scan-delta",
] as const;

export type AssertionRuleKind = (typeof ASSERTION_RULE_KINDS)[number];

/**
 * One sentence per rule kind. Reused verbatim by `mcpfp help assert` and by the user guide's rule
 * table, so the prose an operator reads cannot drift from the schema that validates their file.
 */
export const ASSERTION_RULE_META: Record<
  AssertionRuleKind,
  { readonly summary: string; readonly needsBaseline: boolean }
> = {
  "max-server-tokens": {
    summary:
      "The whole server's tool definitions must cost at most `max` tokens in the scan under test.",
    needsBaseline: false,
  },
  "max-tool-tokens": {
    summary:
      "Every tool must cost at most `max` tokens; with `tool`, only that one — and a named tool that is missing FAILS.",
    needsBaseline: false,
  },
  "max-tool-count": {
    summary: "The server must expose at most `max` tools.",
    needsBaseline: false,
  },
  "no-new-tools": {
    summary: "No tool may appear that the baseline scan did not have.",
    needsBaseline: true,
  },
  "no-removed-tools": {
    summary: "No tool the baseline scan had may have disappeared.",
    needsBaseline: true,
  },
  "max-scan-delta": {
    summary:
      "The token change against the baseline must stay within `maxTokens` and/or `maxPercent` — both are absolute magnitudes, so a large DROP fails too.",
    needsBaseline: true,
  },
};

/** Whether a rule kind can only be evaluated against a baseline scan. */
export function assertionRuleNeedsBaseline(kind: AssertionRuleKind): boolean {
  return ASSERTION_RULE_META[kind].needsBaseline;
}

/** The symbolic baseline: "the newest earlier succeeded scan of the subject's own server". */
export const ASSERTION_BASELINE_PREVIOUS = "previous";

// ── The document ────────────────────────────────────────────────────────────────────────────────
// `.strict()` at EVERY level is the point: a typo'd key must be a loud `2` naming the field, never a
// rule that is silently dropped from a gate somebody believes is protecting them.

/**
 * What to assert against: a server (its newest succeeded scan is used) **or** one exact scan.
 * Expressed as a union of two strict objects, so naming both is a validation error rather than a
 * silent precedence rule nobody remembers.
 */
export const assertionTargetSchema = z.union([
  z.object({ server: z.string().min(1) }).strict(),
  z.object({ scan: z.string().min(1) }).strict(),
]);

export type AssertionTarget = z.infer<typeof assertionTargetSchema>;

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

export const assertionRuleSchema = z.discriminatedUnion("rule", [
  maxServerTokensRuleSchema,
  maxToolTokensRuleSchema,
  maxToolCountRuleSchema,
  noNewToolsRuleSchema,
  noRemovedToolsRuleSchema,
  maxScanDeltaRuleSchema,
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
    /** `"previous"` or an explicit scan id. Only resolved when a rule actually needs it. */
    baseline: z.string().min(1).optional(),
    rules: assertionRulesSchema,
  })
  .strict();

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

/** One side of the evaluation — enough to reproduce it, never enough to leak anything. */
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

export type AssertionReport = {
  assertionsVersion: number;
  /** ISO 8601 instant the API evaluated the gate. */
  evaluatedAt: string;
  subject: AssertionScanRef;
  /**
   * **D-C3** — what was ASKED for (`"previous"` or an explicit id), and the single concrete scan it
   * RESOLVED to. `null` when no rule needed a baseline, or when there is no earlier scan yet (in
   * which case the baseline-dependent results carry a `skipReason`).
   */
  baseline: { requested: string; scan: AssertionScanRef } | null;
  results: AssertionRuleResult[];
  counts: { total: number; passed: number; failed: number; skipped: number };
  /** False iff at least one result is `"fail"`. A report with only passes and skips is `true`. */
  passed: boolean;
};

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
