import {
  type AssertionResult,
  CLAUDE_CLI_PROVIDER_ID,
  type ErrorFinding,
  type ErrorFindingCategory,
  errorFindingSchema,
  FIX_TARGETS,
  type FixTarget,
  type JudgeSettings,
  ROOT_CAUSE_BUCKETS,
  type RootCauseBucket,
  type RunDetail,
} from "@mcp-token-footprint/shared";
import { estimateCost, isModelPriced } from "../providers/pricing.js";
import { toErrorMessage } from "../utils/errors.js";
import type { GradeContext, Grader, GraderResult } from "./grader.js";
import type { JudgeGenerate, JudgeGenerateResult, JudgeProvenance, JudgeUsage } from "./judge.js";

/**
 * Auto-Rating WP 1.3 (AR4/AR9/AR11/AR13/AR15) — the `error_forensics` base-rating grader (id
 * `error_forensics`, kind `llm`, MANDATORY). It runs on EVERY terminal run and works in two phases:
 *
 *   1. **Deterministic inventory (ALWAYS runs).** Scans the persisted run (read-only) and extracts
 *      every error signal into the six {@link ERROR_FINDING_CATEGORIES}: failed tool calls, error
 *      events, MCP connection failures, guardrail stops, context overflow, and failed assertions.
 *      Each inventory finding cites the evidence that produced it (a `RunStep.index` and/or a stable
 *      event pointer — see {@link runLevelEvidence}). This NEVER executes anything (B15/AR11) — it
 *      reads only `ctx.run` (a {@link RunDetail}: steps, events, status, outcome, assertionResults).
 *
 *   2. **LLM root-cause classification (best-effort, only when a priced judge is configured).** ONE
 *      schema-constrained judge call classifies each inventory finding into a {@link RootCauseBucket},
 *      assigns a mandatory {@link FixTarget}, and drafts a concrete `draftFix`. The parsed output is
 *      merged with the TRUSTED deterministic fields (id, category, evidence are NEVER taken from the
 *      model) and validated against {@link errorFindingSchema}; anything invalid is repaired to the
 *      deterministic default (never trusted). Judge cost lands in the SEPARATE judge ledger (B5/AR13)
 *      via {@link estimateCost} — NEVER folded into run cost.
 *
 * Honest degradation (never a silent 0, AR11):
 *   - **Clean run** (no error signals) → `graded`, score `1.0`, `evidence: []`, NO judge call. A
 *     clean run is a positive operational-health signal, not an absence of ground truth, so it is
 *     reported as `graded` (score 1.0) rather than `unevaluable` — see the SCORE note below.
 *   - **Signals present but no / unpriced / failed judge** → the inventory STILL produces findings,
 *     each stamped with a DETERMINISTIC default bucket ({@link DEFAULT_BUCKET_BY_CATEGORY}),
 *     `fixTarget:"none"`, and a generic `draftFix`; method `error_forensics_v1_inventory_only`. No
 *     judge call is made (or a failed call is swallowed) → the judge ledger stays 0. When the judge
 *     runs, it REFINES bucket/fixTarget + writes the real `draftFix`; method `error_forensics_v1`.
 *   - The grader NEVER throws — a defensive internal failure yields an `error` verdict (score null).
 *
 * SCORE semantics (this is a base-rating DIMENSION, AR6 — kept separate from the expectation graders'
 * quality scores; it never enters `meanGrade`/`passRateAt05`/the quality×cost scatter): the score is a
 * deterministic OPERATIONAL-HEALTH signal in [0,1], NOT a correctness/quality grade. It is `1.0` for a
 * clean run and decreases as error findings accumulate, weighted by category severity
 * ({@link SEVERITY_PENALTY_BY_CATEGORY}), flooring at `0.0` for a run dominated by terminal failures.
 * It is derived from the DETERMINISTIC inventory ALONE — so the score is identical whether or not a
 * judge runs (the judge refines *why* / *how to fix*, never *whether* errors occurred).
 *
 * Offline-testable via the same seam as {@link import("./judge.js").createOutcomeJudge} /
 * {@link import("./failure-buckets.js").FailureBucketService}: `resolveJudge` + `generate` are injected.
 */

export const ERROR_FORENSICS_ID = "error_forensics";

/**
 * Default OUTER bound (ms) on the classification-call invocation — includes the CLI judge's AR14 queue
 * wait, so it mirrors {@link import("./judge.js").DEFAULT_JUDGE_QUEUE_BACKSTOP_MS} (the tight per-call
 * bounds live inside the chain's legs). A genuinely stuck call falls back to inventory-only, never a hang.
 */
export const DEFAULT_FORENSICS_TIMEOUT_MS = 15 * 60_000;

/** Method stamp when the LLM refined every finding's bucket/fixTarget/draftFix (AR15). */
export const METHOD_FORENSICS_CLASSIFIED = "error_forensics_v1";
/** Method stamp when only the deterministic inventory ran (no/unpriced/failed judge) (AR15). */
export const METHOD_FORENSICS_INVENTORY_ONLY = "error_forensics_v1_inventory_only";
/** Method stamp for a defensive internal failure of the grader itself. */
export const METHOD_FORENSICS_ERROR = "error_forensics_v1_error";

/** Longest single description/message snippet fed into the classification prompt (keeps it bounded). */
const MAX_SNIPPET_CHARS = 400;

/** Terminal run statuses (a status event carrying one of these pins a run-level outcome). */
const TERMINAL_STATUSES: ReadonlySet<string> = new Set([
  "completed",
  "stopped",
  "error",
  "aborted",
]);

/**
 * The category→default-bucket heuristic used on the inventory-only path (and as the repair fallback
 * when the judge's classification is missing/invalid). A best-effort first guess the judge refines.
 */
export const DEFAULT_BUCKET_BY_CATEGORY: Record<ErrorFindingCategory, RootCauseBucket> = {
  error_event: "model_behavior",
  failed_tool_call: "mcp_server",
  guardrail_stop: "model_behavior",
  context_overflow: "model_behavior",
  mcp_connection_failure: "provider_infra",
  assertions_failed: "skill",
};

/**
 * Per-category severity penalty subtracted from the 1.0 health score for each finding. Terminal
 * failures (context overflow, guardrail stop) weigh most; a recoverable tool failure weighs least.
 * The summed penalty is clamped so a badly-broken run floors at 0.0.
 */
export const SEVERITY_PENALTY_BY_CATEGORY: Record<ErrorFindingCategory, number> = {
  context_overflow: 1,
  guardrail_stop: 1,
  mcp_connection_failure: 0.5,
  error_event: 0.5,
  assertions_failed: 0.25,
  failed_tool_call: 0.25,
};

/** Frames the judge as a root-cause analyst producing one classification per inventory finding. */
export const FORENSICS_SYSTEM =
  "You are a meticulous reliability engineer performing root-cause analysis on a failed automated " +
  "test run. For each error finding you are given, you assign the single most likely root-cause " +
  "bucket, a concrete fix target, and a specific, actionable drafted fix. You respond with ONLY the " +
  "requested JSON.";

/**
 * One entry in the deterministic inventory — the raw signal BEFORE LLM classification. `bucket` /
 * `fixTarget` / `draftFix` are filled in later (by the judge, or by the deterministic defaults). The
 * `id`, `category`, and evidence are TRUSTED (grader-owned) and are never taken from the model.
 */
export type InventoryFinding = {
  id: string;
  description: string;
  category: ErrorFindingCategory;
  evidenceSteps: number[];
  evidenceEventIds: string[];
  /** Concrete failure evidence lifted from the run's (already-redacted) step payloads — see {@link ErrorFinding}. */
  toolName?: string;
  sentArguments?: string;
  errorMessage?: string;
};

/** Dependencies for {@link createErrorForensicsGrader} — mirrors `createOutcomeJudge`/`FailureBucketService`. */
export type ErrorForensicsDeps = {
  /** The configured default judge (same resolver as the outcome/trajectory judges), or null when unset. */
  resolveJudge: () => JudgeSettings | null;
  /** The one provider round-trip (production: `createProviderJudgeGenerate`; tests: a stub). */
  generate: JudgeGenerate;
  /** Bound on the single classification call; defaults to {@link DEFAULT_FORENSICS_TIMEOUT_MS}. */
  timeoutMs?: number;
};

// ── Phase 1 — deterministic inventory (pure, read-only, never executes) ────────────────────────────

/**
 * Extract every error signal on the persisted run into the six {@link ERROR_FINDING_CATEGORIES}.
 * Pure + side-effect-free (unit-testable). Evidence policy: a step-sourced finding cites the real
 * `RunStep.index`; an event-sourced finding cites a stable REPLAY-ORDINAL pointer (`event:<i>`, `i` =
 * the event's position in `run.events`, which is ordered by the persisted `run_events.idx`) — the
 * {@link RunDetail} replay projection does not surface the underlying `run_events.id` column, so the
 * ordinal is the stable, resolvable pointer available to a grader. A run-level outcome with no discrete
 * event/step is cited via {@link runLevelEvidence} (terminal status/error event → last step → an
 * `outcome:<outcome>` sentinel). Every finding therefore satisfies `errorFindingSchema`'s "at least one
 * evidence" rule.
 */
export function extractErrorInventory(run: RunDetail): InventoryFinding[] {
  const findings: InventoryFinding[] = [];
  let seq = 0;
  const nextId = (): string => `ef-${seq++}`;

  const steps = Array.isArray(run.steps) ? run.steps : [];
  const events = Array.isArray(run.events) ? run.events : [];

  // Index every tool_call step's ARGUMENTS by its `toolCallId` (the args live on the `tool_call`
  // step, but the FAILURE is on the sibling `tool_result` step — see engine.ts). Redacted already.
  const argsByCallId = new Map<string, unknown>();
  for (const step of steps) {
    if (step.type !== "tool_call") continue;
    const id = toolCallId(step.payload);
    if (id && !argsByCallId.has(id) && hasArgs(step.payload))
      argsByCallId.set(id, (step.payload as { args?: unknown }).args);
  }

  // 1. failed_tool_call — a settled tool_call/tool_result step whose status is `error`. Enrich each
  //    with the EXACT error text (from the failing step's payload) and the ARGUMENTS actually sent
  //    (from the sibling call step) so the finding shows the real wrong call, not just a category.
  for (const step of steps) {
    if (step.status !== "error") continue;
    if (step.type !== "tool_call" && step.type !== "tool_result") continue;
    const tool =
      typeof step.toolName === "string" && step.toolName ? step.toolName : "(unknown tool)";
    const onServer =
      typeof step.serverId === "string" && step.serverId ? ` on ${step.serverId}` : "";
    const errorMessage = toolErrorMessage(step.payload);
    const callId = toolCallId(step.payload);
    const sentArgs =
      callId && argsByCallId.has(callId)
        ? argsExcerpt(argsByCallId.get(callId))
        : hasArgs(step.payload)
          ? argsExcerpt((step.payload as { args?: unknown }).args)
          : undefined;
    findings.push({
      id: nextId(),
      description: errorMessage
        ? `Tool call failed: ${tool}${onServer} — ${snippet(errorMessage)}`
        : `Tool call failed: ${tool}${onServer}.`,
      category: "failed_tool_call",
      evidenceSteps: typeof step.index === "number" ? [step.index] : [],
      evidenceEventIds: [],
      ...(step.toolName ? { toolName: tool } : {}),
      ...(sentArgs ? { sentArguments: sentArgs } : {}),
      ...(errorMessage ? { errorMessage: snippet(errorMessage) } : {}),
    });
  }

  // 2. error_event + mcp_connection_failure — from `type:"error"` run events. An error event carrying
  //    `serverIds` is a server/connection failure; otherwise it is a generic run error event.
  let sawErrorEvent = false;
  events.forEach((event, ordinal) => {
    if (event.type !== "error") return;
    sawErrorEvent = true;
    const serverIds = Array.isArray(event.serverIds)
      ? event.serverIds.filter((s): s is string => typeof s === "string" && s.length > 0)
      : [];
    const message = typeof event.message === "string" ? event.message : "";
    if (serverIds.length > 0) {
      const auth = event.authRequired ? " (auth required)" : "";
      findings.push({
        id: nextId(),
        description: `MCP connection failure${auth} on ${serverIds.join(", ")}: ${snippet(message)}`,
        category: "mcp_connection_failure",
        evidenceSteps: [],
        evidenceEventIds: [eventPointer(ordinal)],
        ...(message ? { errorMessage: snippet(message) } : {}),
      });
    } else {
      findings.push({
        id: nextId(),
        description: `Run error event: ${snippet(message)}`,
        category: "error_event",
        evidenceSteps: [],
        evidenceEventIds: [eventPointer(ordinal)],
        ...(message ? { errorMessage: snippet(message) } : {}),
      });
    }
  });

  // 3. run-level outcomes — guardrail stop + context overflow.
  const runEvidence = runLevelEvidence(run);
  if (run.outcome === "stopped_guardrail") {
    findings.push({
      id: nextId(),
      description: "Run stopped by a guardrail (a cost / tool-count / context cap was hit).",
      category: "guardrail_stop",
      ...runEvidence,
    });
  }
  if (run.outcome === "context_overflow") {
    findings.push({
      id: nextId(),
      description: "Run hit the model context-window limit (context overflow).",
      category: "context_overflow",
      ...runEvidence,
    });
  }

  // 4. assertions_failed — one finding per failed assertion (with its own cited evidence), or a single
  //    run-level finding when the outcome says assertions failed but no per-assertion detail exists.
  const failedAssertions = (Array.isArray(run.assertionResults) ? run.assertionResults : []).filter(
    (a) => a.status === "fail",
  );
  if (failedAssertions.length > 0) {
    for (const assertion of failedAssertions) {
      const cited = Array.isArray(assertion.evidence)
        ? assertion.evidence.filter((n) => typeof n === "number" && Number.isInteger(n) && n >= 0)
        : [];
      findings.push({
        id: nextId(),
        description: `Assertion failed (${assertionLabel(assertion)}): ${snippet(assertion.reason)}`,
        category: "assertions_failed",
        evidenceSteps: cited,
        // Fall back to the run-level pointer only when the assertion cited no trace evidence.
        evidenceEventIds: cited.length > 0 ? [] : runEvidence.evidenceEventIds,
        ...(assertion.reason ? { errorMessage: snippet(assertion.reason) } : {}),
      });
    }
  } else if (run.outcome === "assertions_failed") {
    findings.push({
      id: nextId(),
      description: "Run outcome is assertions_failed but no failing-assertion detail was recorded.",
      category: "assertions_failed",
      ...runEvidence,
    });
  }

  // 5. Abnormal-termination catch-all — a run that FAILED (`error`) with NO discrete failure signal
  //    captured above still gets one run-level `error_event` finding (never miss a broken run). An
  //    INTENTIONAL stop (`aborted` — a user stopping an interactive session, or the wall-clock cap) is
  //    NOT a failure and is deliberately EXCLUDED (see isAbnormalTermination): stopping is not an error.
  const hasFailureSignal = findings.some((f) =>
    [
      "error_event",
      "failed_tool_call",
      "mcp_connection_failure",
      "context_overflow",
      "guardrail_stop",
    ].includes(f.category),
  );
  if (!hasFailureSignal && !sawErrorEvent && isAbnormalTermination(run)) {
    const outcomePart = run.outcome ? `, outcome ${run.outcome}` : "";
    findings.push({
      id: nextId(),
      description: `Run terminated abnormally (status ${run.status}${outcomePart}) with no discrete error signal.`,
      category: "error_event",
      ...runEvidence,
    });
  }

  return findings;
}

/**
 * Evidence for a run-level outcome (guardrail stop / context overflow / assertions_failed / abnormal
 * termination): the terminal status + error events cited by replay ordinal, else the last step's index,
 * else a stable `outcome:<outcome>` sentinel — so a run-level finding ALWAYS cites something.
 */
export function runLevelEvidence(run: RunDetail): {
  evidenceSteps: number[];
  evidenceEventIds: string[];
} {
  const events = Array.isArray(run.events) ? run.events : [];
  const eventIds: string[] = [];
  events.forEach((event, ordinal) => {
    if (event.type === "error") eventIds.push(eventPointer(ordinal));
    else if (event.type === "status" && TERMINAL_STATUSES.has(event.status))
      eventIds.push(eventPointer(ordinal));
  });
  if (eventIds.length > 0) return { evidenceSteps: [], evidenceEventIds: eventIds };

  const steps = Array.isArray(run.steps) ? run.steps : [];
  const last = steps[steps.length - 1];
  if (last && typeof last.index === "number" && last.index >= 0) {
    return { evidenceSteps: [last.index], evidenceEventIds: [] };
  }
  return { evidenceSteps: [], evidenceEventIds: [`outcome:${run.outcome ?? run.status}`] };
}

/**
 * The deterministic operational-health score (see the module doc). 1.0 for a clean inventory; each
 * finding subtracts its {@link SEVERITY_PENALTY_BY_CATEGORY}; clamped to [0,1]. Judge-independent.
 */
export function forensicsHealthScore(inventory: readonly InventoryFinding[]): number {
  if (inventory.length === 0) return 1;
  const penalty = inventory.reduce(
    (sum, f) => sum + (SEVERITY_PENALTY_BY_CATEGORY[f.category] ?? 0.5),
    0,
  );
  return Math.min(1, Math.max(0, 1 - penalty));
}

// ── Phase 2 — LLM classification (schema-validated; the model never fabricates evidence) ───────────

/** Build the ONE classification prompt: enumerate the inventory findings with their exact ids + categories. */
export function buildForensicsPrompt(inventory: readonly InventoryFinding[]): string {
  const list = inventory
    .map((f, i) => {
      const lines = [
        `[${i + 1}] id: ${f.id}`,
        `  category: ${f.category}`,
        `  what happened: ${snippet(f.description)}`,
      ];
      // The CONCRETE failure evidence — the actual wrong call + the exact error — so the drafted fix
      // can name the specific parameter/value at fault, not a generic "review the tool call".
      if (f.toolName) lines.push(`  tool: ${f.toolName}`);
      if (f.sentArguments) lines.push(`  arguments sent: ${snippet(f.sentArguments)}`);
      if (f.errorMessage) lines.push(`  exact error: ${snippet(f.errorMessage)}`);
      return lines.join("\n");
    })
    .join("\n\n");
  return `Below are the error findings from a failed automated test run. For EACH finding, assign a root-cause bucket, a fix target, and a concrete drafted fix.

### Findings
${list}

### Instructions
* Respond with ONLY a JSON array — one object per finding above, in any order.
* Each object: { "id": "<the exact id from the list>", "bucket": <one of ${ROOT_CAUSE_BUCKETS.join(" | ")}>, "fixTarget": <one of ${FIX_TARGETS.join(" | ")}>, "draftFix": "<a specific, actionable suggestion — never auto-applied>" }.
* Only use "id" values that appear above. Do NOT invent findings.
* Choose "fixTarget" to match the actionable owner: "skill" when a SKILL.md change fixes it, "mcp_server" when the server must change, "none" when there is no actionable fix (e.g. most model_behavior / provider_infra causes).
* Make "draftFix" concrete and labeled, e.g. "add to SKILL.md: always pass \`fields=…\` to \`acme_get_app\`" or "server: \`search_docs\` rejects its own documented \`limit\` param".
* Respond with ONLY the JSON array, nothing else.
`;
}

/**
 * Parse the judge response + merge it into the TRUSTED inventory. For each inventory finding: take the
 * judge's `{ bucket, fixTarget, draftFix }` when present (dropping an invalid enum / empty draftFix),
 * else the deterministic default; the id / category / evidence are ALWAYS the grader's (never the
 * model's — mirrors the failure-buckets membership-integrity rule). The merged finding is validated
 * against {@link errorFindingSchema}; on any failure it is REPAIRED to the fully-deterministic default
 * (which is always schema-valid). Order follows the inventory (stable).
 */
export function parseAndMergeClassification(
  text: string,
  inventory: readonly InventoryFinding[],
): ErrorFinding[] {
  const byId = new Map<string, Record<string, unknown>>();
  for (const entry of extractJsonArray(text) ?? []) {
    if (typeof entry !== "object" || entry === null) continue;
    const record = entry as Record<string, unknown>;
    if (typeof record.id === "string") byId.set(record.id, record);
  }
  return inventory.map((base) => refineFinding(base, byId.get(base.id)));
}

/** Merge one judge classification onto a trusted inventory finding, coercing + schema-validating (repair on failure). */
function refineFinding(
  base: InventoryFinding,
  judged: Record<string, unknown> | undefined,
): ErrorFinding {
  const candidate: ErrorFinding = {
    id: base.id,
    description: asNonEmptyString(judged?.description) ?? base.description,
    category: base.category,
    bucket: asBucket(judged?.bucket) ?? DEFAULT_BUCKET_BY_CATEGORY[base.category],
    fixTarget: asFixTarget(judged?.fixTarget) ?? "none",
    draftFix: asNonEmptyString(judged?.draftFix) ?? defaultDraftFix(base),
    // Grader-OWNED concrete evidence — carried verbatim from the trusted inventory, never the model's.
    ...concreteEvidence(base),
    evidenceSteps: base.evidenceSteps,
    evidenceEventIds: base.evidenceEventIds,
  };
  const parsed = errorFindingSchema.safeParse(candidate);
  return parsed.success ? (parsed.data as ErrorFinding) : inventoryOnlyFinding(base);
}

/** The trusted, grader-owned concrete-evidence fields of an inventory finding (spread onto an {@link ErrorFinding}). */
function concreteEvidence(base: InventoryFinding): Pick<
  ErrorFinding,
  "toolName" | "sentArguments" | "errorMessage"
> {
  return {
    ...(base.toolName ? { toolName: base.toolName } : {}),
    ...(base.sentArguments ? { sentArguments: base.sentArguments } : {}),
    ...(base.errorMessage ? { errorMessage: base.errorMessage } : {}),
  };
}

/** The fully-deterministic finding (no judge): default bucket, `fixTarget:"none"`, a generic drafted fix. */
export function inventoryOnlyFinding(base: InventoryFinding): ErrorFinding {
  return {
    id: base.id,
    description: base.description,
    category: base.category,
    bucket: DEFAULT_BUCKET_BY_CATEGORY[base.category],
    fixTarget: "none",
    draftFix: defaultDraftFix(base),
    ...concreteEvidence(base),
    evidenceSteps: base.evidenceSteps,
    evidenceEventIds: base.evidenceEventIds,
  };
}

function defaultDraftFix(base: InventoryFinding): string {
  return `No automated fix drafted (LLM root-cause classification unavailable). Review the ${base.category.replace(
    /_/g,
    " ",
  )} signal manually.`;
}

// ── The grader ─────────────────────────────────────────────────────────────────────────────────────

/**
 * Build the `error_forensics` grader from its deps. `async` + self-contained: it extracts the
 * deterministic inventory, scores operational health, and (when a priced judge is configured) makes ONE
 * timeout-bounded classification call, merges + schema-validates it, and reports the SEPARATE judge cost
 * ledger. It NEVER throws — every failure path returns an honest verdict (clean/inventory-only/error).
 */
export function createErrorForensicsGrader(deps: ErrorForensicsDeps): Grader {
  const timeoutMs = deps.timeoutMs ?? DEFAULT_FORENSICS_TIMEOUT_MS;

  return {
    id: ERROR_FORENSICS_ID,
    kind: "llm",
    mandatory: true,
    async grade(ctx: GradeContext): Promise<GraderResult> {
      try {
        const inventory = extractErrorInventory(ctx.run);
        const score = forensicsHealthScore(inventory);

        // Clean run → no findings, no judge call (a positive operational-health signal).
        if (inventory.length === 0) {
          return {
            status: "graded",
            score,
            rawScore: 0,
            method: METHOD_FORENSICS_INVENTORY_ONLY,
            reasoning: "No error signals detected in the run (operationally clean).",
            evidence: [] as ErrorFinding[],
          };
        }

        // A classification call needs a configured, PRICED judge (mirrors the re-grade / judge guards) —
        // otherwise stay on the inventory-only path (findings still produced, no spend).
        const settings = deps.resolveJudge();
        if (!settings || !settings.providerCredentialId || !settings.model) {
          return inventoryOnlyResult(inventory, score, "no default judge configured");
        }
        // CLI-AWARE pricing guard (WP 2.3): the Claude-CLI judge runs on the subscription (cost 0), so
        // the unpriced-provider guard does NOT apply to it — the chain routes the actual call + provenance.
        if (
          settings.providerCredentialId !== CLAUDE_CLI_PROVIDER_ID &&
          !isModelPriced(settings.model)
        ) {
          return inventoryOnlyResult(
            inventory,
            score,
            `judge model "${settings.model}" has no known pricing`,
          );
        }

        // ONE provider call, bounded by a timeout. A stuck/failed call falls back to inventory-only
        // (findings are never lost) — the grader never hangs and never throws.
        let gen: JudgeGenerateResult;
        try {
          gen = await callWithTimeout(
            (signal) =>
              deps.generate(settings, buildForensicsPrompt(inventory), {
                system: FORENSICS_SYSTEM,
                signal,
              }),
            timeoutMs,
          );
        } catch (error) {
          return inventoryOnlyResult(
            inventory,
            score,
            `judge classification call failed: ${toErrorMessage(error)}`,
          );
        }

        const findings = parseAndMergeClassification(gen.text, inventory);
        return {
          status: "graded",
          score,
          rawScore: inventory.length,
          method: METHOD_FORENSICS_CLASSIFIED,
          reasoning: `${summarize(inventory)}; root-cause classified by judge.`,
          evidence: findings,
          ...judgeLedger(settings, gen.usage, gen),
        };
      } catch (error) {
        // Defensive: extraction/scoring should never throw, but honor "never throws" (AR11).
        return {
          status: "error",
          score: null,
          method: METHOD_FORENSICS_ERROR,
          reasoning: toErrorMessage(error),
        };
      }
    },
  };
}

/** The inventory-only verdict: deterministic-default findings, no judge ledger (no spend). */
function inventoryOnlyResult(
  inventory: readonly InventoryFinding[],
  score: number,
  reason: string,
): GraderResult {
  return {
    status: "graded",
    score,
    rawScore: inventory.length,
    method: METHOD_FORENSICS_INVENTORY_ONLY,
    reasoning: `${summarize(inventory)}; inventory only — ${reason}.`,
    evidence: inventory.map(inventoryOnlyFinding),
  };
}

/**
 * The SEPARATE judge cost ledger (B5/AR13) carried on the {@link GraderResult}. `estimateCost` returns 0
 * for an unpriced model, but the caller only reaches here with a priced (or CLI-subscription) model.
 * NEVER touches run cost. The optional {@link JudgeProvenance} (Auto-Rating WP 2.3) is PREFERRED over
 * `settings` so a chain fall-through / CLI row reports the ACTUAL source it used (CLI → cost 0, real tokens).
 */
function judgeLedger(settings: JudgeSettings, usage: JudgeUsage, provenance?: JudgeProvenance) {
  const model = provenance?.judgeModel ?? settings.model;
  return {
    judgeProviderId: provenance?.judgeProviderId ?? settings.providerCredentialId,
    judgeModel: model,
    judgeTokensIn: usage.inputTokens,
    judgeTokensOut: usage.outputTokens,
    judgeCostUsd:
      provenance?.judgeCostUsd ??
      (model
        ? estimateCost(model, { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens })
        : 0),
  } as const;
}

// ── Small helpers ────────────────────────────────────────────────────────────────────────────────

/** A one-line human summary of an inventory: "3 error signals: failed_tool_call×2, guardrail_stop×1". */
function summarize(inventory: readonly InventoryFinding[]): string {
  const counts = new Map<ErrorFindingCategory, number>();
  for (const f of inventory) counts.set(f.category, (counts.get(f.category) ?? 0) + 1);
  const parts = [...counts.entries()].map(([category, n]) => `${category}×${n}`).join(", ");
  const noun = inventory.length === 1 ? "error signal" : "error signals";
  return `${inventory.length} ${noun}: ${parts}`;
}

/** A stable replay-ordinal pointer to a run event (`event:<i>`, `i` = position in `run.events`). */
function eventPointer(ordinal: number): string {
  return `event:${ordinal}`;
}

// ── concrete failure evidence from step payloads (all read-only over the redacted RunDetail) ─────────

/** The AI-SDK/MCP tool-call id a tool step carries in its (redacted) payload, when present. */
function toolCallId(payload: unknown): string | undefined {
  if (typeof payload !== "object" || payload === null) return undefined;
  const id = (payload as { toolCallId?: unknown }).toolCallId;
  return typeof id === "string" && id ? id : undefined;
}

/** True when a tool step's payload carries an `args` field (a `tool_call` step, from engine.ts). */
function hasArgs(payload: unknown): boolean {
  return (
    typeof payload === "object" && payload !== null && "args" in (payload as Record<string, unknown>)
  );
}

/**
 * The exact error text of a FAILED tool step's payload: the `error` string (a tool-level SDK error),
 * else the text content of an MCP `{ isError: true, content: [...] }` result (the `result` field).
 * Returns undefined when neither is present (an older run / a non-error payload).
 */
function toolErrorMessage(payload: unknown): string | undefined {
  if (typeof payload !== "object" || payload === null) return undefined;
  const p = payload as { error?: unknown; result?: unknown };
  if (typeof p.error === "string" && p.error.trim()) return p.error;
  const fromResult = mcpErrorText(p.result);
  return fromResult ?? undefined;
}

/** Join the `text` blocks of an MCP `{ content: [{ type:"text", text }] }` result (isError or not). */
function mcpErrorText(result: unknown): string | undefined {
  if (typeof result !== "object" || result === null) return undefined;
  const content = (result as { content?: unknown }).content;
  if (!Array.isArray(content)) return undefined;
  const texts: string[] = [];
  for (const part of content) {
    if (typeof part === "object" && part !== null) {
      const text = (part as { text?: unknown }).text;
      if (typeof text === "string" && text.trim()) texts.push(text.trim());
    }
  }
  const joined = texts.join(" ").trim();
  return joined ? joined : undefined;
}

/** A bounded JSON excerpt of already-redacted tool arguments (undefined for null/undefined/empty). */
function argsExcerpt(args: unknown): string | undefined {
  if (args === undefined || args === null) return undefined;
  let serialized: string;
  try {
    serialized = typeof args === "string" ? args : JSON.stringify(args);
  } catch {
    return undefined;
  }
  const collapsed = serialized.replace(/\s+/g, " ").trim();
  if (!collapsed || collapsed === "{}" || collapsed === "null") return undefined;
  return collapsed.length <= MAX_SNIPPET_CHARS
    ? collapsed
    : `${collapsed.slice(0, MAX_SNIPPET_CHARS)}…`;
}

function assertionLabel(assertion: AssertionResult): string {
  return assertion.assertion.kind;
}

/**
 * A run that terminated in a genuine FAILURE state (drives the abnormal-termination catch-all). A
 * deliberately-stopped or wall-clock-capped run (`aborted`) is an INTENTIONAL termination, not a
 * failure, so it is EXCLUDED — a user stopping an interactive session is never flagged as an error.
 * Only a real crash/failure (`error`) trips the catch-all; guardrail stops (`stopped_guardrail`) are
 * captured separately as `guardrail_stop` above, not here.
 */
function isAbnormalTermination(run: RunDetail): boolean {
  return run.outcome === "error" || run.status === "error";
}

function asBucket(value: unknown): RootCauseBucket | undefined {
  return typeof value === "string" && (ROOT_CAUSE_BUCKETS as readonly string[]).includes(value)
    ? (value as RootCauseBucket)
    : undefined;
}

function asFixTarget(value: unknown): FixTarget | undefined {
  return typeof value === "string" && (FIX_TARGETS as readonly string[]).includes(value)
    ? (value as FixTarget)
    : undefined;
}

function asNonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/** Collapse whitespace + bound a single string so a verbose message can't blow up the prompt / description. */
function snippet(text: string): string {
  const collapsed = (text ?? "").replace(/\s+/g, " ").trim();
  if (!collapsed) return "(no message)";
  return collapsed.length <= MAX_SNIPPET_CHARS
    ? collapsed
    : `${collapsed.slice(0, MAX_SNIPPET_CHARS)}…`;
}

/** Strip a Markdown code fence, then take the outermost `[ … ]` and JSON.parse it. Null on any failure. */
function extractJsonArray(text: string): unknown[] | null {
  if (!text) return null;
  const cleaned = stripFences(text);
  const start = cleaned.indexOf("[");
  const end = cleaned.lastIndexOf("]");
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    const parsed = JSON.parse(cleaned.slice(start, end + 1));
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function stripFences(text: string): string {
  const trimmed = text.trim();
  if (!trimmed.startsWith("```")) return trimmed;
  return trimmed
    .replace(/^```[a-zA-Z]*\n?/, "")
    .replace(/```\s*$/, "")
    .trim();
}

/**
 * Race `run` (given a fresh abort signal) against a timeout: on timeout the signal aborts AND the race
 * rejects, so `grade()` ALWAYS settles even if the provider ignores the abort. The timer is always
 * cleared. Mirrors the outcome/failure-bucket judges' bound (kept local so judge.ts stays untouched).
 */
async function callWithTimeout<T>(
  run: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error(`error_forensics classification call timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });
  try {
    return await Promise.race([run(controller.signal), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
