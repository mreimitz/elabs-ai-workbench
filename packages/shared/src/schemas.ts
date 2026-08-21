import { z } from "zod";
import {
  ADVISOR_EVIDENCE_KINDS,
  ADVISOR_SAVINGS_UNITS,
  ADVISOR_SCOPE_KINDS,
  ADVISOR_SEVERITIES,
  ANSWER_VALIDATION_VERDICTS,
  ASSERTION_RESULT_STATUSES,
  ASSISTANT_AUTH_SOURCES,
  ASSISTANT_ENTITY_KINDS,
  ASSISTANT_OAUTH_TOKEN_PREFIX,
  COLLECTION_FILE_FORMAT_VERSION,
  CONTEXT_SEGMENTS,
  DASHBOARD_CHART_MAX_MEASURES,
  DASHBOARD_CHART_NAME_MAX_LENGTH,
  DASHBOARD_CHART_SCAN_MEASURE_UNITS,
  DASHBOARD_CHART_SCAN_MEASURES,
  DASHBOARD_CHART_TYPES,
  DEFAULT_TOKEN_PROFILE,
  DEFAULT_TOOL_LOADING_MODE,
  DIGEST_SCHEDULE_MODES,
  DIGEST_WINDOW_KINDS,
  ERROR_FINDING_CATEGORIES,
  FIX_TARGETS,
  GITHUB_REPO_NAME_PATTERN,
  GRADE_FEEDBACK_NOTE_MAX_LENGTH,
  GRADE_FEEDBACK_VERDICTS,
  GRADE_KINDS,
  GRADE_STATUSES,
  GRADER_IDS,
  HUB_ACTOR_KINDS,
  HUB_AGENT_NAME_MAX_LENGTH,
  HUB_APPROVAL_OPTION_KINDS,
  HUB_APPROVAL_RESOLUTIONS,
  HUB_ARTIFACT_EXPORT_FORMATS,
  HUB_ARTIFACT_KINDS,
  HUB_AUDIT_KINDS,
  HUB_AUTONOMY_LEVELS,
  HUB_CONFIDENCE_LEVELS,
  HUB_CREW_COLORS,
  HUB_CREW_NAME_MAX_LENGTH,
  HUB_ELICITATION_ACTIONS,
  HUB_ELICITATION_MODES,
  HUB_EVENT_TYPES,
  HUB_FILE_LINK_ROLES,
  HUB_FILE_LINK_TARGETS,
  HUB_LIMIT_RETRY_SOURCES,
  HUB_MEMORY_KINDS,
  HUB_MEMORY_SCOPES,
  HUB_MEMORY_SOURCES,
  HUB_MEMORY_STATUSES,
  HUB_MESSAGE_PART_TYPES,
  HUB_MISSION_STATUSES,
  HUB_PINNED_FILE_FILENAME_MAX_LENGTH,
  HUB_PINNED_FILE_MAX_BYTES,
  HUB_PROJECT_NAME_MAX_LENGTH,
  HUB_REVIEW_COMMENT_DECISIONS,
  HUB_REVIEW_STATUSES,
  HUB_SESSION_KINDS,
  HUB_SESSION_MODES,
  HUB_SESSION_TITLE_MAX_LENGTH,
  HUB_SKILL_INVOCATION_MODES,
  HUB_TASK_STATUSES,
  HUB_TITLE_STATES,
  HUB_TOOL_PART_STATES,
  HUB_TOOL_SOURCES,
  HUB_TOPOLOGIES,
  HUB_USAGE_GROUP_BYS,
  HUB_WORKSPACE_CHANGE_KINDS,
  INSIGHT_SURPLUS_VERDICTS,
  ISSUE_ASSIST_PRIORITIES,
  METRICS_BUCKETS,
  NOTIFICATION_LIST_MAX_LIMIT,
  PROVIDER_KINDS,
  QUALITY_SEVERITIES,
  RATING_ISSUE_LIFECYCLES,
  RATING_ISSUE_OCCURRENCE_CATEGORIES,
  RATING_ISSUE_SEVERITIES,
  RATING_STATES,
  RATING_ISSUE_STATUSES,
  RATING_ISSUE_TARGET_KINDS,
  REFERENCE_LOGIC_KINDS,
  REVIEW_RUBRIC_INSTRUCTIONS_MAX_LENGTH,
  REVIEW_RUBRIC_KEY_DESCRIPTION_MAX_LENGTH,
  REVIEW_RUBRIC_KEY_KINDS,
  REVIEW_RUBRIC_KEY_NAME_MAX_LENGTH,
  REVIEW_RUBRIC_MAX_KEYS,
  REVIEW_RUBRIC_NAME_MAX_LENGTH,
  ROOT_CAUSE_BUCKETS,
  RUN_METRICS_GROUP_BY,
  RUN_METRICS_MEASURE_UNITS,
  RUN_METRICS_MEASURES,
  RUN_MODES,
  RUN_OUTCOMES,
  RUN_PHASES,
  RUN_PLAN_SOURCES,
  RUN_PLAN_TURN_BASES,
  RUN_SORT_DIRECTIONS,
  RUN_SORT_FIELDS,
  RUN_STATUSES,
  RUN_VIEW_NAME_MAX_LENGTH,
  RUN_VIEW_PRESENTATION_MAX_BYTES,
  SERVER_AUTH_TYPES,
  SERVER_TYPE_STATUSES,
  SESSION_COST_BASES,
  SESSION_LIVE_REASONING,
  SESSION_TOKEN_ACCOUNTING,
  SKILL_FILE_ENCODINGS,
  SKILL_FILE_KINDS,
  SKILL_GATE_EXPECTATIONS,
  SKILL_GRAPH_SOURCES,
  SKILL_VERSION_MODES,
  SKILLFLOW_STATIC_SUGGESTION_RULES,
  SKILLFLOW_SUGGESTION_RULES,
  SPAN_KINDS,
  STOP_REASON_CODES,
  SUITE_DEFAULT_CONCURRENCY,
  SUITE_DEFAULT_REPETITIONS,
  SUITE_MAX_CONCURRENCY,
  SUITE_MAX_REPETITIONS,
  SUITE_RUN_STATUSES,
  TEST_DIFFICULTIES,
  TOKEN_PROFILES,
  TOOL_CANDIDATE_CONFIDENCE,
  TOOL_DIAGNOSTIC_KINDS,
  TOOL_HYGIENE_SEVERITIES,
  TOOL_LOADING_MODES,
  TRACE_SOURCES,
  TRACE_VERDICT_CONFIDENCE,
  TRACE_VERDICT_STATUSES,
  TRANSPORT_TYPES,
  TRIGGER_KINDS,
  WAITING_INPUT_REASONS,
  WATCH_COOLDOWN_MAX_MINUTES,
  WATCH_MIN_INTERVAL_MAX_MINUTES,
  WATCH_NO_DATA_POLICIES,
  WATCH_NOTIFY_SEVERITIES,
  WATCH_PREVIEW_MAX_WINDOWS,
  WATCH_RULE_MAX_ACTIONS,
  WATCH_RULE_NAME_MAX_LENGTH,
  WATCH_RULE_TRIGGERS,
  WATCH_TEMPLATE_MAX_BYTES,
  WATCH_WINDOW_DURATIONS,
  WATCH_WINDOW_OPS,
} from "./constants.js";
import { HUB_ICON_MAX_LENGTH } from "./hub-icon.js";
// AM-OB10 — the ONE warn-vs-alert predicate, shared with the API evaluator and the web editor.
import { validateWatchThresholds } from "./watch-state.js";
// AM-OB11 — the `workflow_dispatch` action's field rules live in ONE module, shared with the API
// dispatcher, so the wire's 400 and the dispatcher's refusal can never diverge.
import {
  isWatchWorkflowFile,
  isWatchWorkflowOwner,
  isWatchWorkflowRef,
  isWatchWorkflowRepo,
  validateWorkflowDispatchTarget,
} from "./watch-workflow-dispatch.js";
// Type-only imports for the recursive schemas — a `z.lazy` needs an explicit `z.ZodType<T>` annotation
// (the generative-UI catalog node, and — crew nesting WP0.1 / D-CN5 — the self-referencing agent
// report). `import type` is erased at build and introduces no runtime cycle (types.ts does not import
// schemas.ts).
import type { HubAgentReport, HubGenUiNode } from "./types.js";

export const tokenProfileSchema = z.enum(TOKEN_PROFILES).default(DEFAULT_TOKEN_PROFILE);

export const transportTypeSchema = z.enum(TRANSPORT_TYPES);

export const serverAuthTypeSchema = z.enum(SERVER_AUTH_TYPES);

export const serverTypeStatusSchema = z.enum(SERVER_TYPE_STATUSES);

// Server types (planning/Roadmap/completed/RM-21-server-types, D-ST1/D-ST2): a named group of servers sharing one tool
// surface; lifecycle status lives on the type. No secrets, no connection config.
export const serverTypeInputSchema = z.object({
  name: z.string().trim().min(1),
  status: serverTypeStatusSchema.default("production"),
  description: z.string().trim().optional(),
});

export const serverTypeUpdateSchema = z.object({
  name: z.string().trim().min(1).optional(),
  status: serverTypeStatusSchema.optional(),
  description: z.string().trim().nullable().optional(),
});

export const serverAuthInputSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("none") }),
  z.object({
    type: z.literal("bearer"),
    token: z.string().optional(),
  }),
  z.object({
    type: z.literal("api_key"),
    headerName: z.string().trim().min(1),
    key: z.string().optional(),
  }),
  z.object({
    type: z.literal("oauth"),
    clientId: z.string().trim().optional(),
    clientSecret: z.string().optional(),
  }),
  z.object({
    type: z.literal("custom_headers"),
    headers: z.record(z.string()).default({}),
  }),
]);

export const serverConfigInputSchema = z
  .object({
    name: z.string().trim().min(1),
    transport: transportTypeSchema,
    command: z.string().trim().optional(),
    args: z.array(z.string()).default([]),
    env: z.record(z.string()).default({}),
    url: z.string().trim().url().optional(),
    headers: z.record(z.string()).default({}),
    auth: serverAuthInputSchema.optional(),
    // Server type assignment (planning/Roadmap/completed/RM-21-server-types, additive — D-ST5). Null clears on update.
    typeId: z.string().trim().min(1).nullable().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.transport === "stdio" && !value.command) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["command"],
        message: "Command is required for stdio servers",
      });
    }

    if (value.transport === "streamable_http" && !value.url) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["url"],
        message: "URL is required for streamable HTTP servers",
      });
    }
  });

export const serverConfigUpdateSchema = z.object({
  name: z.string().trim().min(1).optional(),
  transport: transportTypeSchema.optional(),
  command: z.string().trim().optional(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string()).optional(),
  url: z.string().trim().url().optional(),
  headers: z.record(z.string()).optional(),
  auth: serverAuthInputSchema.optional(),
  typeId: z.string().trim().min(1).nullable().optional(),
});

export const scanRequestSchema = z.object({
  tokenProfile: tokenProfileSchema.optional(),
});

export const serverProbeRequestSchema = z.object({
  name: z.string().trim().optional(),
  url: z.string().trim().url(),
  auth: serverAuthInputSchema.optional(),
});

export const oauthClientInputSchema = z.object({
  clientId: z.string().trim().optional(),
  clientSecret: z.string().optional(),
});

export const oauthStartRequestSchema = z.object({
  serverId: z.string().trim().min(1),
  oauthClient: oauthClientInputSchema.optional(),
});

export const toolCallRequestSchema = z.object({
  arguments: z.record(z.unknown()).default({}),
  tokenProfile: tokenProfileSchema.optional(),
});

export const resourceReadRequestSchema = z.object({
  uri: z.string().min(1),
  tokenProfile: tokenProfileSchema.optional(),
});

export const promptGetRequestSchema = z.object({
  arguments: z.record(z.string()).default({}),
  tokenProfile: tokenProfileSchema.optional(),
});

// --- Testing (runs) contract ---------------------------------------------------------------

export const providerKindSchema = z.enum(PROVIDER_KINDS);

export const runModeSchema = z.enum(RUN_MODES);

export const tokenProfileRefSchema = z.enum(TOKEN_PROFILES);

export const providerCredentialInputSchema = z.object({
  kind: providerKindSchema,
  label: z.string().trim().min(1),
  baseUrl: z.string().trim().url().optional(),
  apiKey: z.string().optional(),
});

export const providerCredentialUpdateSchema = z.object({
  kind: providerKindSchema.optional(),
  label: z.string().trim().min(1).optional(),
  baseUrl: z.string().trim().url().optional(),
  apiKey: z.string().optional(),
});

export const modelParamsSchema = z.object({
  temperature: z.number().min(0).optional(),
  maxOutputTokens: z.number().int().positive().optional(),
  topP: z.number().min(0).max(1).optional(),
  reasoningEffort: z.enum(["low", "medium", "high"]).optional(),
});

export const guardrailConfigSchema = z.object({
  maxTurns: z.number().int().positive().optional(),
  maxToolCalls: z.number().int().positive().optional(),
  maxTokens: z.number().int().positive().optional(),
  maxContextTokens: z.number().int().positive().optional(),
  maxCostUsd: z.number().positive().optional(),
  // Overall run wall-clock cap (ms). Time-based safety cap enforced in the run loop (issue #10).
  maxRunDurationMs: z.number().int().positive().optional(),
});

export const allowedServerSchema = z.object({
  serverId: z.string().trim().min(1),
  allowedTools: z.array(z.string().trim().min(1)).nullable(), // null = all tools
});

// Per-scenario MCP tool-loading strategy. Defaults to the historical `eager` behavior so existing
// inputs (and the meaning of past runs) are unchanged; `deferred` opts into Anthropic tool search.
export const toolLoadingModeSchema = z.enum(TOOL_LOADING_MODES).default(DEFAULT_TOOL_LOADING_MODE);

// Skill version-selection mode for a scenario attachment (Phase 2 — WP 2.1).
export const skillVersionModeSchema = z.enum(SKILL_VERSION_MODES);

// One skill attached to a scenario. `pinned` requires a `pinnedVersionId`; `latest` resolves at run
// time. `scenarioInputSchema` gains `allowedSkills: z.array(allowedSkillSchema).default([])` (WP 2.1).
export const allowedSkillSchema = z
  .object({
    skillId: z.string().trim().min(1),
    versionMode: skillVersionModeSchema,
    pinnedVersionId: z.string().trim().min(1).optional(),
    // Eager toggle (WP 2.3): inline the full SKILL.md body up front. Additive — defaults false so
    // existing scenario inputs/clients that omit it keep validating unchanged.
    eager: z.boolean().default(false),
  })
  .superRefine((value, ctx) => {
    if (value.versionMode === "pinned" && !value.pinnedVersionId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["pinnedVersionId"],
        message: "Pin a version or choose latest",
      });
    }
  });

export const scenarioInputSchema = z
  .object({
    name: z.string().trim().min(1),
    providerId: z.string().trim().min(1),
    model: z.string().trim().min(1),
    params: modelParamsSchema.default({}),
    systemPrompt: z.string().default(""),
    allowedServers: z.array(allowedServerSchema).default([]),
    // Additive (WP 2.1): existing scenarios/tests/clients that omit this keep working via `[]`.
    allowedSkills: z.array(allowedSkillSchema).default([]),
    defaultProfiles: z.array(tokenProfileRefSchema).default([]),
    guardrails: guardrailConfigSchema.default({}),
    toolLoadingMode: toolLoadingModeSchema,
  })
  .superRefine((value, ctx) => {
    if (value.model.trim().length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["model"],
        message: "Model is required",
      });
    }

    if (value.providerId.trim().length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["providerId"],
        message: "Provider is required",
      });
    }
  });

// --- SkillFlow validation-gate assertions (WP 5.1) — the `tests.assertions_json` payload ---------
// Validated at test CRUD (a malformed shape is a 400). IDs are NOT checked against a graph here — the
// graph is version-dependent, only known at run time; a stale/unknown id surfaces as an `unevaluable`
// assertion result when the run is evaluated, never a CRUD-time rejection.

export const skillGateExpectationSchema = z.enum(SKILL_GATE_EXPECTATIONS);

export const testSkillGateSchema = z.object({
  skillId: z.string().trim().min(1),
  nodeId: z.string().trim().min(1),
  expect: skillGateExpectationSchema,
});

export const testSkillRouteSchema = z.object({
  skillId: z.string().trim().min(1),
  gatekeeperId: z.string().trim().min(1),
  expectedEdgeId: z.string().trim().min(1),
});

/** The reserved `tests.assertions_json` payload — all fields optional/additive. */
export const testAssertionsSchema = z.object({
  skillGates: z.array(testSkillGateSchema).optional(),
  skillRoutes: z.array(testSkillRouteSchema).optional(),
  noFractures: z.boolean().optional(),
});

/** An assertion echoed on its result — discriminated union on `kind`. */
export const assertionRefSchema = z.discriminatedUnion("kind", [
  testSkillGateSchema.extend({ kind: z.literal("skillGate") }),
  testSkillRouteSchema.extend({ kind: z.literal("skillRoute") }),
  z.object({ kind: z.literal("noFractures") }),
]);

/** One assertion's evaluation result (WP 5.1). */
export const assertionResultSchema = z.object({
  assertion: assertionRefSchema,
  status: z.enum(ASSERTION_RESULT_STATUSES),
  reason: z.string(),
  evidence: z.array(z.number().int().nonnegative()).optional(),
  confidence: z.enum(TRACE_VERDICT_CONFIDENCE).optional(),
});

// --- Benchmarks — graded-tests contract (WP 1.1, B1–B5) --------------------------------------
// Additive-only. A malformed shape is rejected here (400); a missing block behaves exactly as today.

/** Reference logic handed to a judge as a DOCUMENT — never executed (B15). `kind` outside the enum → 400. */
export const referenceLogicSchema = z.object({
  kind: z.enum(REFERENCE_LOGIC_KINDS),
  language: z.string().optional(),
  body: z.string(),
});

/** B1 ground-truth block on a Test — every facet optional. */
export const testExpectationsSchema = z.object({
  expectedInsight: z.string().optional(),
  expectedValue: z.unknown().optional(),
  referenceLogic: referenceLogicSchema.optional(),
  answerable: z.boolean().optional(),
  rubricOverride: z.string().optional(),
});

/** B3 default judge — references only, NEVER key material. */
export const judgeSettingsSchema = z.object({
  providerCredentialId: z.string().nullable(),
  model: z.string().nullable(),
});

/** The resolved judge source (Auto-Rating WP 2.3, AR3). */
export const resolvedJudgeSourceSchema = z.enum(["claude_cli", "provider", "none"]);

/** `GET/PUT /api/grading/judge-settings` response (WP 2.3) — provider settings + resolved source. */
export const judgeSettingsResolvedSchema = z.object({
  settings: judgeSettingsSchema,
  cliAvailable: z.boolean(),
  cliModel: z.string(),
  resolvedSource: resolvedJudgeSourceSchema,
});

/**
 * `PUT /api/grading/judge-settings` body (WP 2.3) — the provider judge settings, plus an OPTIONAL
 * `cliModel` that persists the Claude-CLI judge model. Additive over {@link judgeSettingsSchema}: a
 * caller that sends only the provider fields (today's web) keeps working.
 */
export const judgeSettingsUpdateSchema = judgeSettingsSchema.extend({
  cliModel: z.string().trim().min(1).optional(),
});

/** One finding from the tool_hygiene grader (WP 2.1), carried in a grade's evidence. */
export const toolHygieneFindingSchema = z.object({
  checkId: z.string(),
  severity: z.enum(TOOL_HYGIENE_SEVERITIES),
  stepIdx: z.number().int().nonnegative(),
  message: z.string(),
});

/** A persisted grade row (B2/B4/B5) — validated on the way out (WP 1.2). */
export const runGradeSchema = z.object({
  id: z.string(),
  runId: z.string(),
  graderId: z.enum(GRADER_IDS),
  kind: z.enum(GRADE_KINDS),
  status: z.enum(GRADE_STATUSES),
  score: z.number().nullable(),
  rawScore: z.number().nullable(),
  method: z.string(),
  reasoning: z.string().nullable(),
  evidence: z.unknown().nullable(),
  judgeProviderId: z.string().nullable(),
  judgeModel: z.string().nullable(),
  judgeTokensIn: z.number().int().nonnegative(),
  judgeTokensOut: z.number().int().nonnegative(),
  judgeCostUsd: z.number(),
  gradingVersion: z.number().int().nonnegative(),
  createdAt: z.string(),
});

// --- Benchmarks — grade feedback & calibration set (Phase 6 WP 6.1) --------------------------
// A human verdict ON a grade row. `.strict()` so an unknown key is a ZodError -> 400 — and in
// particular so a caller can never smuggle a `score` in and have it quietly persisted: this table
// stores a two-valued verdict and a note, never a number that could be mistaken for a grade (AR6).
// The API layer additionally REFUSES to update or delete a row (append-only) — see
// `apps/api/src/grading/grade-feedback-repository.ts`.

/** A human's verdict on ONE grade row (`agree` | `disagree`). */
export const gradeFeedbackVerdictSchema = z.enum(GRADE_FEEDBACK_VERDICTS);

/** `POST /api/grades/:gradeId/feedback` body — one appended verdict, with an optional bounded note. */
export const gradeFeedbackInputSchema = z
  .object({
    verdict: gradeFeedbackVerdictSchema,
    note: z.string().trim().min(1).max(GRADE_FEEDBACK_NOTE_MAX_LENGTH).optional(),
  })
  .strict();

/** One persisted `grade_feedback` row — validated on the way out. */
export const gradeFeedbackSchema = z.object({
  id: z.string(),
  gradeId: z.string(),
  runId: z.string(),
  verdict: gradeFeedbackVerdictSchema,
  note: z.string().optional(),
  createdAt: z.string(),
});

// --- Auto-Rating — mandatory post-run rating contract (WP 1.1, AR1–AR16) ----------------------
// planning/Roadmap/RM-06-auto-rating/item.md. Additive-only, mirrors the TS shapes in types.ts exactly (same
// optionality). Reuses `runGradeSchema`/`assertionResultSchema` above rather than re-declaring them.

/**
 * One `error_forensics` finding — every finding must cite at least one step or event (AR4/AR9),
 * enforced below (a finding with both arrays empty is rejected, not silently accepted).
 */
export const errorFindingSchema = z
  .object({
    id: z.string(),
    description: z.string(),
    category: z.enum(ERROR_FINDING_CATEGORIES),
    bucket: z.enum(ROOT_CAUSE_BUCKETS),
    fixTarget: z.enum(FIX_TARGETS),
    draftFix: z.string(),
    // Concrete failure evidence lifted from the run's redacted step payloads (all optional, bounded).
    toolName: z.string().optional(),
    sentArguments: z.string().optional(),
    errorMessage: z.string().optional(),
    evidenceSteps: z.array(z.number().int().nonnegative()),
    evidenceEventIds: z.array(z.string()),
    truncated: z.boolean().optional(),
  })
  .refine((finding) => finding.evidenceSteps.length > 0 || finding.evidenceEventIds.length > 0, {
    message: "an error_forensics finding must cite at least one evidence step or event id",
    path: ["evidenceSteps"],
  });

/** The `answer_validation` base grader's evidence (AR1) — `score` null is honest (unevaluable), never a 0. */
export const answerValidationEvidenceSchema = z.object({
  verdict: z.enum(ANSWER_VALIDATION_VERDICTS),
  score: z.number().min(0).max(1).nullable(),
  quotes: z.array(z.string()),
  citedSteps: z.array(z.number().int().nonnegative()),
});

/** The `insight_surplus` base grader's evidence (AR8, double-edged) — `surplusTokens` names the padding cost. */
export const insightSurplusEvidenceSchema = z.object({
  verdict: z.enum(INSIGHT_SURPLUS_VERDICTS),
  score: z.number().min(0).max(1).nullable(),
  quotes: z.array(z.string()),
  citedSteps: z.array(z.number().int().nonnegative()),
  surplusTokens: z.number().int().nonnegative().optional(),
});

/** The three base graders' verdicts/evidence, grouped as one dimension (AR6 — kept separate from expectation grades). */
export const runBaseRatingSchema = z.object({
  answerValidation: answerValidationEvidenceSchema,
  insightSurplus: insightSurplusEvidenceSchema,
  errorForensics: z.array(errorFindingSchema),
});

/**
 * RM-33 (D-CT5) — the four terms behind one `costUsd`, plus `savedVsUncachedUsd`. Mirrors
 * {@link CostBreakdown}. `.strict()` on purpose: this shape is produced by exactly one function
 * (`computeCostBreakdown`), so an unexpected key means a caller hand-rolled it — which is the thing
 * D-CT5 exists to prevent. Note `savedVsUncachedUsd` is a plain `z.number()`, NOT `.nonnegative()`:
 * a cache write costs 1.25x, so a write-heavy record legitimately "saves" a negative amount.
 */
export const costBreakdownSchema = z
  .object({
    uncachedUsd: z.number(),
    cacheReadUsd: z.number(),
    cacheWriteUsd: z.number(),
    outputUsd: z.number(),
    totalUsd: z.number(),
    savedVsUncachedUsd: z.number(),
    priced: z.boolean(),
    split: z.enum(["exact", "merged", "none"]),
  })
  .strict();

/**
 * RM-33 WP 3.2 — the run export's per-step cumulative KPI snapshot ({@link RunReportStepKpi}).
 * `.strict()`: one builder (`apps/api/src/reports/run-kpi-by-step.ts`) produces it, so an unexpected
 * key means somebody hand-rolled the shape instead of importing it.
 */
export const runReportStepKpiSchema = z
  .object({
    turns: z.number().int().nonnegative(),
    toolCalls: z.number().int().nonnegative(),
    tokensIn: z.number().int().nonnegative(),
    tokensOut: z.number().int().nonnegative(),
    contextTokens: z.number().int().nonnegative(),
    costUsd: z.number(),
    // RM-33 (D-CT6) — absent means UNKNOWN (a pre-migration run / a merged-only turn), never zero.
    cachedTokens: z.number().int().nonnegative().optional(),
    cacheReadTokens: z.number().int().nonnegative().optional(),
    cacheWriteTokens: z.number().int().nonnegative().optional(),
  })
  .strict();

/** The peak context snapshot's per-segment composition — every `ContextSegment`, no extras. */
const peakContextSegmentsSchema = z
  .object(
    Object.fromEntries(CONTEXT_SEGMENTS.map((segment) => [segment, z.number()])) as Record<
      (typeof CONTEXT_SEGMENTS)[number],
      z.ZodNumber
    >,
  )
  .strict();

/**
 * RM-33 WP 3.2 — the run export's `statistics` block ({@link RunReportStatistics}).
 *
 * `.strict()` is the point of the schema, not a detail: this block was an untyped API-local literal
 * that `apps/web` re-declared by hand, so the two could drift with nothing to catch it. A key the
 * contract does not name is now a test failure on both sides.
 */
export const runReportStatisticsSchema = z
  .object({
    turns: z.number().int().nonnegative(),
    toolCalls: z.number().int().nonnegative(),
    tokensIn: z.number().int().nonnegative(),
    tokensOut: z.number().int().nonnegative(),
    cachedTokens: z.number().int().nonnegative(),
    // D-CT6 — absent means UNKNOWN, never zero.
    cacheReadTokens: z.number().int().nonnegative().optional(),
    cacheWriteTokens: z.number().int().nonnegative().optional(),
    peakContextTokens: z.number().int().nonnegative(),
    contextLimit: z.number().int().positive().nullable(),
    endStateContextTokens: z.number().int().nonnegative().optional(),
    estimatedCostUsd: z.number(),
    costBasis: z.enum(["api_exact", "subscription_reference"]).optional(),
    costBreakdown: costBreakdownSchema.optional(),
    peakContextSegments: peakContextSegmentsSchema.nullable(),
  })
  .strict();

/**
 * The composed, on-demand run rating + grading surface (AR1) — `GET /api/runs/:id/report`. `kpis`
 * mirrors the `Pick<RunSummary, …>` in types.ts; `judgeProvenance` mirrors the
 * `Pick<RunGrade, 'judgeProviderId' | 'judgeModel'>` there.
 */
export const runReportSchema = z.object({
  runId: z.string(),
  status: z.enum(RUN_STATUSES),
  outcome: z.enum(RUN_OUTCOMES).optional(),
  baseRating: runBaseRatingSchema,
  expectationGrades: z.array(runGradeSchema),
  assertionResults: z.array(assertionResultSchema),
  kpis: z.object({
    turns: z.number().int().nonnegative(),
    toolCalls: z.number().int().nonnegative(),
    peakContextTokens: z.number().int().nonnegative(),
    tokensIn: z.number().int().nonnegative(),
    tokensOut: z.number().int().nonnegative(),
    // RM-33 — absent means UNKNOWN (a pre-migration run), never zero.
    cachedTokens: z.number().int().nonnegative().optional(),
    cacheReadTokens: z.number().int().nonnegative().optional(),
    cacheWriteTokens: z.number().int().nonnegative().optional(),
    costUsd: z.number(),
    durationMs: z.number().int().nonnegative().optional(),
  }),
  judgeProvenance: z.object({
    judgeProviderId: z.string().nullable(),
    judgeModel: z.string().nullable(),
  }),
  ratingVersion: z.number().int().nonnegative(),
  generatedAt: z.string(),
});

/** Mean + standard deviation for one numeric dimension across a test-group's member runs (WP 4.1). */
export const suiteReportVarianceSchema = z.object({
  mean: z.number().nullable(),
  stdDev: z.number().nullable(),
});

/** AR10 — one LLM agreement call's verdict for a test-group (exactly one call per group, never pairwise). */
export const suiteTestGroupAgreementSchema = z.object({
  summary: z.string(),
  agreeCount: z.number().int().nonnegative(),
  totalCount: z.number().int().nonnegative(),
  contradicts: z.boolean(),
});

/** Deterministic + LLM-agreement analytics for one test's member runs within a suite run (WP 4.1/4.2). */
export const suiteReportTestGroupSchema = z.object({
  testId: z.string(),
  runIds: z.array(z.string()),
  score: suiteReportVarianceSchema,
  costUsd: suiteReportVarianceSchema,
  turns: suiteReportVarianceSchema,
  toolPathVariance: z.number().nonnegative(),
  agreement: suiteTestGroupAgreementSchema,
  // Suite-report enrichment (additive) — deterministic, evidence-grounded highlight sentences.
  findings: z.array(z.string()).optional(),
});

/** One test's current-minus-baseline deltas (suite-report enrichment). Null when either side is null. */
export const suiteReportBaselinePerTestSchema = z.object({
  testId: z.string(),
  scoreMeanDelta: z.number().nullable(),
  costMeanDelta: z.number().nullable(),
  turnsMeanDelta: z.number().nullable(),
  agreementFlipped: z.boolean(),
});

/** Cross-suite-run baseline deltas against the most recent earlier comparable suite run's report. */
export const suiteReportBaselineSchema = z.object({
  suiteRunId: z.string(),
  generatedAt: z.string(),
  perTest: z.array(suiteReportBaselinePerTestSchema),
});

/** One cross-run root-cause roll-up entry (WP 4.2) — reuses the `error_forensics` taxonomy. */
export const suiteRootCauseRollupEntrySchema = z.object({
  bucket: z.enum(ROOT_CAUSE_BUCKETS),
  fixTarget: z.enum(FIX_TARGETS),
  draftFix: z.string(),
  frequency: z.number().int().nonnegative(),
  memberRunIds: z.array(z.string()),
});

/**
 * The persisted `suite_run_reports.report_json` payload (WP 4.1/4.2/4.3) — append-only, latest wins.
 * Generated only for suite runs with ≥2 members (AR7); `errorClustering` reuses the existing
 * `FailureBucket` shape (no separate schema existed for it — declared here for reuse below).
 */
export const failureBucketSchema = z.object({
  label: z.string(),
  description: z.string(),
  memberRunIds: z.array(z.string()),
  share: z.number(),
});

export const suiteReportSchema = z.object({
  suiteRunId: z.string(),
  testGroups: z.array(suiteReportTestGroupSchema),
  errorClustering: z.array(failureBucketSchema),
  rootCauseRollup: z.array(suiteRootCauseRollupEntrySchema),
  narrative: z.string(),
  judgeProvenance: z.object({
    judgeProviderId: z.string().nullable(),
    judgeModel: z.string().nullable(),
  }),
  ratingVersion: z.number().int().nonnegative(),
  generatedAt: z.string(),
  // Suite-report enrichment (additive) — the persisted row's status, stamped at generation time and
  // echoed at read time; the baseline delta is omitted when no comparable earlier run exists.
  status: z.enum(["ready", "partial", "error"]).optional(),
  baseline: suiteReportBaselineSchema.optional(),
});

// --- Benchmarks — suites (WP 3.1, B7) --------------------------------------------------------
// Contract-first zod mirroring the suite TS types. A malformed suite input is a 400. The WP 3.2
// orchestrator consumes `suiteConfigSchema`; suite CRUD (this WP) consumes `suiteInputSchema`.

/** WP 5.1 skill-effect variant — overrides skill attachments on a base scenario. */
export const suiteVariantSchema = z.object({
  label: z.string().trim().min(1),
  scenarioId: z.string().trim().min(1),
  skillOverrides: z.object({
    attach: z
      .array(
        z.object({
          skillId: z.string().trim().min(1),
          // A pinned version id, or the literal "latest" (resolved at run time by WP 3.2).
          versionId: z.union([z.literal("latest"), z.string().trim().min(1)]),
        }),
      )
      .optional(),
    detach: z.array(z.string().trim().min(1)).optional(),
  }),
});

/** A suite's execution config — repetitions/concurrency bounded + defaulted; cost cap/judge/variants optional. */
export const suiteConfigSchema = z.object({
  repetitions: z
    .number()
    .int()
    .min(1)
    .max(SUITE_MAX_REPETITIONS)
    .default(SUITE_DEFAULT_REPETITIONS),
  maxConcurrency: z
    .number()
    .int()
    .min(1)
    .max(SUITE_MAX_CONCURRENCY)
    .default(SUITE_DEFAULT_CONCURRENCY),
  aggregateCostCapUsd: z.number().positive().optional(),
  judgeOverride: judgeSettingsSchema.optional(),
  variants: z.array(suiteVariantSchema).optional(),
});

/** Create/update payload for a suite. `config` fills its bounded defaults via `suiteConfigSchema`. */
export const suiteInputSchema = z.object({
  name: z.string().trim().min(1),
  description: z.string().optional(),
  config: suiteConfigSchema,
  testIds: z.array(z.string()),
  scenarioIds: z.array(z.string()),
  // Testing IA (WP 2.3) — same collection-membership semantics as {@link testInputSchema} (provided →
  // validate + set; absent-on-create → default "Local"; absent-on-update → preserve). Never serialized.
  collectionId: z.string().trim().min(1).optional(),
});

// --- Benchmarks — collections & on-disk file format (WP 4.1, B10/B12) -------------------------
// Contract-first zod. `collectionInputSchema` validates the CRUD body (PAT write-only, never
// returned). The on-disk `testFileSchema`/`suiteFileSchema` validate REMOTE files on read (WP 4.2 git
// engine): a malformed shape OR an unknown `formatVersion` fails cleanly here, before it can touch the
// DB (`formatVersion` is a strict literal so a future format is rejected rather than half-parsed).

/**
 * Create/update payload for a collection. `pat` is write-only (encrypted server-side, never returned).
 *
 * Testing IA (WP 1.1) — the repo binding is now an OPTIONAL GROUP: either all of `repoUrl` + `repoPath`
 * + `branch` are present (a git-bound collection) or all are absent (a local/unbound collection).
 * A partial binding is rejected. `pat` is only valid WITH a binding (a PAT without a repo is meaningless).
 * Relaxing-only + additive: an old full-binding payload still validates unchanged; a binding-less payload
 * newly validates. The `repoUrl` validation itself (`.url()`) is unchanged from before.
 */
export const collectionInputSchema = z
  .object({
    name: z.string().trim().min(1),
    // repoPath keeps `z.string()` (empty string = repo root) but is now optional so it can be absent
    // for an unbound collection; branch keeps its prior min(1) validation, made optional.
    // repoUrl now reuses the shared `safeRepoUrlSchema` (https-only + blocked-host list) so a bound
    // collection is held to the SAME SSRF guard as skills imports (H-1): `http://169.254.169.254/…`,
    // `git://`, `ssh://`, `file://` are rejected at the route/service/repository boundary. The git
    // module skips non-https URLs relying on exactly this guard. Wrapped in `z.lazy` because
    // `safeRepoUrlSchema` is declared LATER in this module — lazy defers the reference to parse time
    // (avoids the const temporal-dead-zone at import).
    repoUrl: z.lazy(() => safeRepoUrlSchema).optional(),
    repoPath: z.string().optional(),
    branch: z.string().trim().min(1).optional(),
    pat: z.string().optional(),
  })
  .superRefine((value, ctx) => {
    // Presence is by `!== undefined` so an intentional `repoPath: ""` (repo root) still counts as bound.
    const present = [value.repoUrl, value.repoPath, value.branch].filter(
      (f) => f !== undefined,
    ).length;
    const bound = present === 3;
    const unbound = present === 0;
    if (!bound && !unbound) {
      // A partial binding — flag each missing field so the caller can complete (or drop) the binding.
      if (value.repoUrl === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["repoUrl"],
          message: "Provide repoUrl, repoPath, and branch together, or omit all three.",
        });
      }
      if (value.repoPath === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["repoPath"],
          message: "Provide repoUrl, repoPath, and branch together, or omit all three.",
        });
      }
      if (value.branch === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["branch"],
          message: "Provide repoUrl, repoPath, and branch together, or omit all three.",
        });
      }
    }
    if (value.pat !== undefined && !bound) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["pat"],
        message: "A PAT requires a repo binding (repoUrl, repoPath, and branch).",
      });
    }
  });

/** The ON-DISK test file — no local ids/secrets; `externalKey` is the cross-system identity. */
export const testFileSchema = z.object({
  formatVersion: z.literal(COLLECTION_FILE_FORMAT_VERSION),
  externalKey: z.string().min(1),
  name: z.string(),
  userPrompt: z.string(),
  systemPromptOverride: z.string().optional(),
  expectations: testExpectationsSchema.optional(),
  category: z.string().optional(),
  difficulty: z.enum(TEST_DIFFICULTIES).optional(),
  tags: z.array(z.string()),
  addedProfiles: z.array(tokenProfileRefSchema),
  warnings: z.array(z.string()).optional(),
});

/** The ON-DISK suite file — ordered member refs BY externalKey + config; scenario names are hints only. */
export const suiteFileSchema = z.object({
  formatVersion: z.literal(COLLECTION_FILE_FORMAT_VERSION),
  externalKey: z.string().min(1),
  name: z.string(),
  description: z.string().optional(),
  config: suiteConfigSchema,
  testExternalKeys: z.array(z.string()),
  scenarioHints: z.array(z.string()).optional(),
});

// --- Testing IA — inline run plan (WP 1.1) ---------------------------------------------------
// One execution engine: a suite-run, a collection run, and an interactive/ad-hoc run all describe a
// PLAN executed as a suite-run through `apps/api/src/suites/orchestrator.ts` (never a second mass-run
// path). `runPlanInputSchema` is the body of the two-path launcher (WP 2.x); the discriminated union on
// `source` guarantees exactly ONE source shape validates. Response types reuse the existing suite-run
// shapes (additive `source` field on the summary — see `SuiteRun` in types.ts).

// Optional plan-time overrides — the same knobs a suite carries in its `config`, but all OPTIONAL here
// (absent ⇒ the suite's own config for `source:'suite'`, or the system defaults for collection/adhoc).
// Names/bounds mirror `suiteConfigSchema` exactly so a plan can only tune what a suite already exposes.
const runPlanOverridesShape = {
  repetitions: z.number().int().min(1).max(SUITE_MAX_REPETITIONS).optional(),
  maxConcurrency: z.number().int().min(1).max(SUITE_MAX_CONCURRENCY).optional(),
  aggregateCostCapUsd: z.number().positive().optional(),
  judgeOverride: judgeSettingsSchema.optional(),
  variants: z.array(suiteVariantSchema).optional(),
};

/**
 * Inline run-plan input — discriminated on `source` so exactly one shape validates:
 *  - `suite`      → runs a saved suite by id (its stored membership + config; overrides tune it).
 *  - `collection` → runs every test in a collection against the given scenarios (min 1).
 *  - `adhoc`      → runs the given tests (min 1) against the given scenarios (min 1) with no saved suite.
 * All three accept the optional {@link runPlanOverridesShape} knobs.
 */
export const runPlanInputSchema = z.discriminatedUnion("source", [
  z.object({
    source: z.literal("suite"),
    suiteId: z.string().trim().min(1),
    ...runPlanOverridesShape,
  }),
  z.object({
    source: z.literal("collection"),
    collectionId: z.string().trim().min(1),
    scenarioIds: z.array(z.string().trim().min(1)).min(1),
    ...runPlanOverridesShape,
  }),
  z.object({
    source: z.literal("adhoc"),
    testIds: z.array(z.string().trim().min(1)).min(1),
    scenarioIds: z.array(z.string().trim().min(1)).min(1),
    ...runPlanOverridesShape,
  }),
]);

/** The parsed run-plan body (inferred from {@link runPlanInputSchema}). */
export type RunPlanInput = z.infer<typeof runPlanInputSchema>;

export const testInputSchema = z.object({
  name: z.string().trim().min(1),
  userPrompt: z.string().min(1),
  systemPromptOverride: z.string().optional(),
  addedProfiles: z.array(tokenProfileRefSchema).default([]),
  // WP 5.1 — validation-gate assertions (reserved `assertions_json` column). Additive/optional; a
  // malformed shape is rejected here (400), but ids are only checked against a graph at run time.
  assertions: testAssertionsSchema.optional(),
  // WP 1.1 (Benchmarks) — ground-truth/grading block + analytics metadata. All additive/optional; a
  // malformed shape (bad referenceLogic.kind / difficulty) is rejected here (400). `tags` defaults to [].
  expectations: testExpectationsSchema.optional(),
  category: z.string().optional(),
  difficulty: z.enum(TEST_DIFFICULTIES).optional(),
  tags: z.array(z.string()).default([]),
  // Testing IA (WP 2.3) — the local collection to create/move this test into. Provided → validated
  // (404 if unknown) + set; absent on create → the default "Local" collection; absent on update →
  // membership preserved. NEVER serialized to the on-disk repo file (membership is local identity).
  collectionId: z.string().trim().min(1).optional(),
  // Observability (WP4.1) — a draft test (only minted by a watch rule's `promote_to_test` action
  // today). Additive/optional; a draft never auto-runs. Defaults to absent (a normal test).
  draft: z.boolean().optional(),
});

export const attachmentKindSchema = z.enum(["file", "image", "text"]);

// v1 attachment upload: base64-in-JSON (no @fastify/multipart — owner-gated new dep; see WP 2.1).
export const testAttachmentInputSchema = z.object({
  kind: attachmentKindSchema,
  name: z.string().trim().min(1),
  contentBase64: z.string().min(1),
});

// Auto-Rating (AR11) — the post-run review axis carried additively on RunSummary/SuiteRun and as the
// `rating` member of the RunEvent/SuiteRunEvent SSE unions. Orthogonal to RUN_STATUSES/
// SUITE_RUN_STATUSES: never a new member of either status vocabulary.
export const ratingStateSchema = z.enum(RATING_STATES);

export const runStartSchema = z.object({
  testId: z.string().trim().min(1),
  scenarioId: z.string().trim().min(1),
  mode: runModeSchema,
});

export const runTurnSchema = z.object({
  text: z.string().min(1),
});

// Observability (planning/Roadmap/RM-17-observability/, WP3.3, D-OB18) — body of `POST /api/runs/:id/rerun`. Fork a
// TERMINAL run into a NEW, fully-persisted, gradeable derived run. ALL fields optional/additive:
//  * `fromStepId` — the parent step to fork AT (its conversation prefix ≤ this step is reconstructed +
//    seeded into the new run). OMITTED ⇒ a whole-run re-launch with the overrides (works for EVERY kind).
//    A mid-run fork (`fromStepId` present) is CAPABILITY-gated server-side (422 for a kind whose session
//    manifest can't seed a reconstructed chat-completions prefix).
//  * `overrides` — edited launch params: a replacement final user `prompt`, `model` (must resolve for the
//    SAME provider kind as the parent's environment), `temperature`, and a `skillVersionId` (pins the
//    environment's attached skill to a specific version). Each absent field inherits the parent value.
// `.strict()` so a mistyped key surfaces as a ZodError -> 400.
export const runRerunSchema = z
  .object({
    fromStepId: z.string().trim().min(1).optional(),
    overrides: z
      .object({
        prompt: z.string().trim().min(1).optional(),
        model: z.string().trim().min(1).optional(),
        temperature: z.number().min(0).max(2).optional(),
        skillVersionId: z.string().trim().min(1).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

// Body of `POST /api/runs/:id/answers` — the operator's answer to a live agent `question`.
// Mirrors `runTurnSchema`; `questionId` correlates the answer to the emitted `question` event.
export const runAnswerSchema = z.object({
  questionId: z.string().trim().min(1),
  answer: z.string().min(1),
});

// --- Observability — RunFilter grammar (planning/Roadmap/RM-17-observability/, WP1.1, D-OB1) ------------------
// The zod validator for the shared {@link RunFilter} type (types.ts). Consumed by both the
// `run-filter.ts` parse helper (URL `filter=` JSON + aliases) and any endpoint accepting a filter.
// `.strict()` so an unknown/mistyped key surfaces as a ZodError -> 400 (acceptance #2). Every field
// is optional + AND-combined; array fields match ANY of their values. See the type doc for the
// forward-compatible fields (`pinned`/`derived`/`feedback`) and the frozen `scenarioId` wire name.
export const runFeedbackFilterSchema = z
  .object({
    key: z.string().min(1).optional(),
    hasScore: z.boolean().optional(),
  })
  .strict();

export const runFilterSchema = z
  .object({
    status: z.array(z.enum(RUN_STATUSES)).optional(),
    outcome: z.array(z.enum(RUN_OUTCOMES)).optional(),
    // Inline enums (not the later `stopReasonCodeSchema`/`runPhaseSchema` consts) — those are declared
    // further down the file, so referencing them here would be a use-before-declaration.
    stopReasonCode: z.array(z.enum(STOP_REASON_CODES)).optional(),
    phase: z.array(z.enum(RUN_PHASES)).optional(),
    seen: z.boolean().optional(),
    providerKind: z.array(providerKindSchema).optional(),
    model: z.array(z.string().min(1)).optional(),
    serverId: z.array(z.string().min(1)).optional(),
    scenarioId: z.array(z.string().min(1)).optional(),
    suiteId: z.string().min(1).optional(),
    suiteRunId: z.string().min(1).optional(),
    testId: z.array(z.string().min(1)).optional(),
    skillId: z.array(z.string().min(1)).optional(),
    collectionId: z.string().min(1).optional(),
    interactiveOnly: z.boolean().optional(),
    needsAttention: z.boolean().optional(),
    pinned: z.boolean().optional(),
    derived: z.boolean().optional(),
    scoreGte: z.number().optional(),
    scoreLte: z.number().optional(),
    grader: z.string().min(1).optional(),
    costUsdGte: z.number().optional(),
    costUsdLte: z.number().optional(),
    tokensGte: z.number().optional(),
    tokensLte: z.number().optional(),
    durationMsGte: z.number().optional(),
    durationMsLte: z.number().optional(),
    dateFrom: z.string().min(1).optional(),
    dateTo: z.string().min(1).optional(),
    feedback: runFeedbackFilterSchema.optional(),
    q: z.string().min(1).optional(),
    hasError: z.boolean().optional(),
    // Auto-rating dimensions (RM-17 Phase 6, AM-OB12) — the FROZEN RM-06 vocabularies, reused
    // verbatim. Array fields in the same style as `status`/`outcome`/`stopReasonCode`; still
    // `.strict()`, so a misspelt key (or an invented `hallucinated` boolean) is a 400, not a
    // silently ignored filter. See the {@link RunFilter} doc for the latest-wins / absent-is-not-a-
    // value semantics both SQL translations and `matchesRunFilter` implement.
    answerVerdict: z.array(z.enum(ANSWER_VALIDATION_VERDICTS)).optional(),
    insightVerdict: z.array(z.enum(INSIGHT_SURPLUS_VERDICTS)).optional(),
    errorBucket: z.array(z.enum(ROOT_CAUSE_BUCKETS)).optional(),
    errorFixTarget: z.array(z.enum(FIX_TARGETS)).optional(),
  })
  .strict();

// `GET /api/runs?sort=<field>[:<asc|desc>]` — the sortable-column allowlist + direction. Parsed by
// the `run-filter.ts` helper; the repository maps each field to a safe column (never interpolated).
export const runSortFieldSchema = z.enum(RUN_SORT_FIELDS);
export const runSortDirectionSchema = z.enum(RUN_SORT_DIRECTIONS);
export const runSortSchema = z.object({
  field: runSortFieldSchema,
  direction: runSortDirectionSchema,
});

// --- Observability — human feedback (planning/Roadmap/RM-17-observability/, WP1.5, D-OB15) ---------------------
// The zod validator for `POST /api/runs/:id/feedback` — an UPSERT keyed on (run, step, key,
// source='human'; see {@link RunFeedbackInput}). `.strict()` so an unknown key is a ZodError -> 400.
// At least one of `score`/`comment` is required (a feedback row with neither carries no signal).
export const runFeedbackSourceSchema = z.enum(["human", "auto"]);

export const runFeedbackInputSchema = z
  .object({
    stepId: z.string().trim().min(1).optional(),
    key: z.string().trim().min(1).optional(),
    score: z.number().finite().optional(),
    comment: z.string().trim().min(1).optional(),
  })
  .strict()
  .refine((value) => value.score !== undefined || value.comment !== undefined, {
    message: "At least one of `score`/`comment` is required",
    path: ["score"],
  });

// --- Observability — model pricing editor (planning/Roadmap/RM-17-observability/, WP2.6, D-OB22) ----------------
// `POST /api/pricing` / `PATCH /api/pricing/:id`. Prices are USD per 1M tokens (`.nonnegative()` — a
// negative price is nonsense and would corrupt the spend cap). `modelMatch` is bounded (a bound that
// also caps regex-source length as a light ReDoS guardrail — see pricing-repository.ts). When
// `isRegex`, the pattern is COMPILE-CHECKED here (a nicer message) AND authoritatively in the
// repository over the effective value, so a malformed pattern is a 400 at write on both create and
// patch. `.strict()` so an unknown key is a ZodError -> 400.
const modelPricePerMTokSchema = z.number().finite().nonnegative();

const modelPricingBaseSchema = z.object({
  provider: z.string().trim().min(1).max(60),
  modelMatch: z.string().trim().min(1).max(200),
  isRegex: z.boolean().optional(),
  inputPerMTok: modelPricePerMTokSchema,
  outputPerMTok: modelPricePerMTokSchema,
  cacheReadPerMTok: modelPricePerMTokSchema.optional(),
  cacheWritePerMTok: modelPricePerMTokSchema.optional(),
  // Requires UTC 'Z' (no offset) — normalized to canonical ISO on write so `effective_from`
  // comparisons stay lexicographic == chronological.
  effectiveFrom: z.string().datetime().optional(),
});

/** Compile a regex-source `modelMatch` when `isRegex` is set + both fields are present (a nicer
 *  message than the repository's authoritative 400; the repo re-checks the effective value). */
function refineRegex(
  value: { isRegex?: boolean; modelMatch?: string },
  ctx: z.RefinementCtx,
): void {
  if (value.isRegex === true && typeof value.modelMatch === "string") {
    try {
      // eslint-disable-next-line no-new
      new RegExp(value.modelMatch);
    } catch (error) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["modelMatch"],
        message: `Invalid regular expression: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }
}

export const modelPricingInputSchema = modelPricingBaseSchema.strict().superRefine(refineRegex);
export const modelPricingPatchSchema = modelPricingBaseSchema
  .partial()
  .strict()
  .superRefine(refineRegex);

// --- Observability — saved views (planning/Roadmap/RM-17-observability/, WP1.4) --------------------------------
// `POST /api/run-views` / `PATCH /api/run-views/:id`. `filter` reuses `runFilterSchema` (the SAME
// validator `GET /api/runs`/`GET /api/metrics/*` apply — a stored filter re-executes identically);
// `columns`/`sort` are opaque web-owned presentation hints, bounded only by SERIALIZED byte size
// (`RUN_VIEW_PRESENTATION_MAX_BYTES`) — the API never interprets their shape.
const runViewPresentationHintSchema = z
  .unknown()
  .optional()
  .refine(
    (value) =>
      value === undefined ||
      new TextEncoder().encode(JSON.stringify(value)).length <= RUN_VIEW_PRESENTATION_MAX_BYTES,
    { message: `Presentation hint exceeds ${RUN_VIEW_PRESENTATION_MAX_BYTES} bytes` },
  );

export const runViewInputSchema = z
  .object({
    name: z.string().trim().min(1).max(RUN_VIEW_NAME_MAX_LENGTH),
    filter: runFilterSchema,
    columns: runViewPresentationHintSchema,
    sort: runViewPresentationHintSchema,
  })
  .strict();

// A real partial update — every field optional; an omitted field keeps its stored value (unlike the
// full-replace `runViewInputSchema`).
export const runViewPatchSchema = z
  .object({
    name: z.string().trim().min(1).max(RUN_VIEW_NAME_MAX_LENGTH).optional(),
    filter: runFilterSchema.optional(),
    columns: runViewPresentationHintSchema,
    sort: runViewPresentationHintSchema,
  })
  .strict();

// --- Observability — watch rules (planning/Roadmap/RM-17-observability/, WP4.1, D-OB19/D-OB21) ------------------
// `POST /api/watch-rules` / `PATCH /api/watch-rules/:id`. `filter` reuses `runFilterSchema` (the SAME
// validator the feed uses — a rule's filter is evaluated by the pure `matchesRunFilter` predicate at
// the post-terminal choke point). The action set is a CLOSED discriminated union; the `webhook`
// variant accepts the plaintext `url` (the API mints a secretRef + encrypts it — never persisted or
// returned). `.strict()` everywhere so an unknown/mistyped key is a ZodError -> 400.
const watchTemplateSchema = z
  .string()
  .refine((v) => new TextEncoder().encode(v).length <= WATCH_TEMPLATE_MAX_BYTES, {
    message: `template exceeds ${WATCH_TEMPLATE_MAX_BYTES} bytes`,
  })
  .optional();

export const watchNotifySeveritySchema = z.enum(WATCH_NOTIFY_SEVERITIES);
export const watchRuleTriggerSchema = z.enum(WATCH_RULE_TRIGGERS);

// AM-OB11 — the typed GitHub Actions dispatch. INPUT and STORED are the SAME shape (there is no
// credential to swap for a handle: the token is the app-wide connected GitHub account, read
// server-side at dispatch time), so ONE factory builds the variant for both unions below — zod
// object instances are not reusable across two discriminated unions without re-creating them, and
// a factory keeps "the wire accepts exactly what storage returns" true by construction.
//
// Every field-level rule DELEGATES to `watch-workflow-dispatch.ts` — the SAME predicates the API
// dispatcher re-asserts before it builds a URL — so a 400 here and a refusal there can never
// disagree. The refinements are per-FIELD (not a `superRefine` on the object) deliberately:
// `z.discriminatedUnion` requires each option to be a ZodObject, and an object-level effect would
// make it a ZodEffects and fail to compile into the union.
function watchWorkflowDispatchActionSchema() {
  return z
    .object({
      type: z.literal("workflow_dispatch"),
      owner: z
        .string()
        .trim()
        .refine(isWatchWorkflowOwner, { message: "invalid GitHub owner" }),
      repo: z.string().trim().refine(isWatchWorkflowRepo, { message: "invalid repository name" }),
      workflow: z
        .string()
        .trim()
        .refine(isWatchWorkflowFile, { message: "invalid workflow file name or id" }),
      ref: z.string().trim().refine(isWatchWorkflowRef, { message: "invalid git ref" }),
      inputs: z
        .record(z.string())
        .refine(
          (inputs) =>
            validateWorkflowDispatchTarget({
              // Only the `inputs` half is under test here; the other three fields are checked by
              // their own refinements above, so this probe uses values known to pass them.
              owner: "o",
              repo: "r",
              workflow: "w.yml",
              ref: "main",
              inputs,
            }).ok,
          { message: "invalid workflow inputs" },
        )
        .optional(),
    })
    .strict();
}

// The INPUT action union (what the wire accepts). `webhook` carries the plaintext `url`.
export const watchActionInputSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("notify"),
      severity: watchNotifySeveritySchema,
      template: watchTemplateSchema,
    })
    .strict(),
  z.object({ type: z.literal("pin") }).strict(),
  z
    .object({ type: z.literal("add_to_collection"), collectionId: z.string().trim().min(1) })
    .strict(),
  z.object({ type: z.literal("promote_to_test"), collectionId: z.string().trim().min(1) }).strict(),
  z.object({ type: z.literal("run_grader"), graderId: z.string().trim().min(1) }).strict(),
  z
    .object({
      type: z.literal("webhook"),
      url: z.string().trim().url(),
      template: watchTemplateSchema,
    })
    .strict(),
  watchWorkflowDispatchActionSchema(),
]);

// The STORED/RETURNED action union (`webhook` carries only the opaque `secretRef`). Used to validate
// `actions_json` on read and to shape responses — the URL never appears here.
export const watchActionSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("notify"),
      severity: watchNotifySeveritySchema,
      template: watchTemplateSchema,
    })
    .strict(),
  z.object({ type: z.literal("pin") }).strict(),
  z
    .object({ type: z.literal("add_to_collection"), collectionId: z.string().trim().min(1) })
    .strict(),
  z.object({ type: z.literal("promote_to_test"), collectionId: z.string().trim().min(1) }).strict(),
  z.object({ type: z.literal("run_grader"), graderId: z.string().trim().min(1) }).strict(),
  z
    .object({
      type: z.literal("webhook"),
      secretRef: z.string().trim().min(1),
      template: watchTemplateSchema,
    })
    .strict(),
  watchWorkflowDispatchActionSchema(),
]);

const watchActionsInputSchema = z.array(watchActionInputSchema).min(1).max(WATCH_RULE_MAX_ACTIONS);
const watchSampleSchema = z.number().min(0).max(1).optional();
// AM-OB10 — an `on_terminal` rule's minimum minutes between action dispatches. 0 is accepted and
// means "no limit", identical to omitting it (so a form that always sends a number stays honest).
const watchMinIntervalSchema = z
  .number()
  .int()
  .min(0)
  .max(WATCH_MIN_INTERVAL_MAX_MINUTES)
  .optional();

// WP4.2 windowed threshold config. The measure/groupBy/bucket vocabularies reuse the WP1.2 metrics
// enums DIRECTLY (via the shared constants — those `z.enum` schemas are defined later in this file, so
// referencing them here would be a use-before-definition). `.strict()` so an unknown key is a
// ZodError -> 400. Present only on a `windowed` rule; the on-terminal engine never reads it.
// AM-OB10 adds two OPTIONAL fields — `warnThreshold` (a WARNING level strictly less severe than the
// alert one) and `noData` (what an EMPTY window means). Both absent = the shipped single-threshold
// shape, so every stored rule re-validates unchanged. The warn-vs-alert relation is a CROSS-FIELD
// rule, so it rides a `superRefine` over the ONE shared predicate (`validateWatchThresholds`) — the
// editor calls the same function, so the client pre-check and the 400 can never disagree.
export const watchWindowConfigSchema = z
  .object({
    measure: z.enum(RUN_METRICS_MEASURES),
    grader: z.string().trim().min(1).optional(),
    groupBy: z.enum(RUN_METRICS_GROUP_BY).optional(),
    bucket: z.enum(METRICS_BUCKETS),
    window: z.enum(WATCH_WINDOW_DURATIONS),
    op: z.enum(WATCH_WINDOW_OPS),
    threshold: z.number().finite(),
    warnThreshold: z.number().finite().optional(),
    noData: z.enum(WATCH_NO_DATA_POLICIES).optional(),
    cooldownMinutes: z.number().int().min(0).max(WATCH_COOLDOWN_MAX_MINUTES),
  })
  .strict()
  .superRefine((config, ctx) => {
    const check = validateWatchThresholds(config);
    if (!check.ok) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["warnThreshold"], message: check.message });
    }
  });
const watchWindowSchema = watchWindowConfigSchema.optional();

export const watchRuleInputSchema = z
  .object({
    name: z.string().trim().min(1).max(WATCH_RULE_NAME_MAX_LENGTH),
    enabled: z.boolean().optional().default(true),
    trigger: watchRuleTriggerSchema,
    filter: runFilterSchema,
    sample: watchSampleSchema,
    window: watchWindowSchema,
    minIntervalMinutes: watchMinIntervalSchema,
    actions: watchActionsInputSchema,
  })
  .strict();

// A real partial update — every field optional; an omitted field keeps its stored value. Supplying
// `actions` REPLACES the whole set (and rotates webhook secrets in the service).
export const watchRulePatchSchema = z
  .object({
    name: z.string().trim().min(1).max(WATCH_RULE_NAME_MAX_LENGTH).optional(),
    enabled: z.boolean().optional(),
    trigger: watchRuleTriggerSchema.optional(),
    filter: runFilterSchema.optional(),
    sample: watchSampleSchema,
    window: watchWindowSchema,
    minIntervalMinutes: watchMinIntervalSchema,
    // AM-OB10 — `null` CLEARS the pause (resume); a timestamp sets it; omitted keeps the stored
    // value, the same "omitted keeps" rule every other field on this patch follows.
    pausedUntil: z.string().datetime({ offset: true }).nullable().optional(),
    actions: watchActionsInputSchema.optional(),
  })
  .strict();

// WP4.2 — `POST /api/watch-rules/preview` body: score a window config against history WITHOUT saving a
// rule. `filter` reuses the SAME runFilterSchema; `window` is the typed config; `windows` (trailing
// windows to score) is bounded; `asOf` anchors "now" for a deterministic preview. `.strict()`.
export const watchWindowPreviewRequestSchema = z
  .object({
    filter: runFilterSchema,
    window: watchWindowConfigSchema,
    windows: z.number().int().min(1).max(WATCH_PREVIEW_MAX_WINDOWS).optional(),
    asOf: z.string().datetime({ offset: true }).optional(),
  })
  .strict();

// --- Observability — notification center (planning/Roadmap/RM-17-observability/, WP4.3) -------------------------
// `GET /api/notifications` query filters, parsed from string query params by the route (booleans/
// numbers coerced there) THEN validated here — a malformed `severity`/out-of-range `limit` is a
// ZodError -> 400, same discipline as every other wire input. `.strict()` so an unknown key 400s.
export const notificationListQuerySchema = z
  .object({
    unread: z.boolean().optional(),
    severity: watchNotifySeveritySchema.optional(),
    since: z.string().datetime({ offset: true }).optional(),
    until: z.string().datetime({ offset: true }).optional(),
    limit: z.number().int().min(1).max(NOTIFICATION_LIST_MAX_LIMIT).optional(),
    offset: z.number().int().min(0).optional(),
  })
  .strict();

// --- Observability — retention classes (planning/Roadmap/RM-17-observability/, WP1.6) --------------------------
// The `GET`/`PUT /api/maintenance/run-retention-policy` body + the optional override
// `POST /api/maintenance/prune-runs` accepts. Keyed by RunStatus so an unknown/mistyped key is a
// ZodError -> 400; the repository additionally ignores any non-terminal status entry (pending/running
// can never be pruned) even though the schema accepts one syntactically.
export const runRetentionStatusRuleSchema = z
  .object({
    olderThanDays: z.number().int().positive().optional(),
    keepNewest: z.number().int().nonnegative().optional(),
  })
  .strict();

export const runRetentionPolicySchema = z
  .object({
    byStatus: z.record(z.enum(RUN_STATUSES), runRetentionStatusRuleSchema).optional().default({}),
  })
  .strict();

// --- Observability — scheduled digest report (planning/Roadmap/RM-17-observability/, WP5.5, D-OB22) --------------
// `GET`/`PUT /api/reports/digest/schedule` body + the `?window=` query `POST /api/reports/digest/
// generate` accepts. `.strict()` so an unknown key 400s, mirroring every other settings body here.

export const digestWindowKindSchema = z.enum(DIGEST_WINDOW_KINDS);

export const digestScheduleSchema = z
  .object({
    mode: z.enum(DIGEST_SCHEDULE_MODES),
    hourUtc: z.number().int().min(0).max(23),
  })
  .strict();

/** `POST /api/reports/digest/generate?window=daily|weekly` — the cadence to generate on demand. */
export const digestGenerateQuerySchema = z.object({
  window: digestWindowKindSchema,
});

/** `GET /api/reports/digest?kind=&limit=` — an optional cadence filter + a bounded page size. */
export const digestListQuerySchema = z.object({
  kind: digestWindowKindSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

// Cross-server / tool-level compare (north-star #4): `GET /api/compare?a=&b=&threshold=`.
// `a`/`b` are scan ids (any two scans, same or different server). `threshold` is the optional
// fuzzy-match cutoff (0..1); query strings arrive as text so it is coerced.
export const compareQuerySchema = z.object({
  a: z.string().trim().min(1),
  b: z.string().trim().min(1),
  threshold: z.coerce.number().min(0).max(1).optional(),
});

// --- MCP × Model compatibility heatmap (Phase 5) ---------------------------------------------
// `models` is a comma-separated list of dataset model ids; omit to use the server's default set.
export const compatibilityHeatmapQuerySchema = z.object({
  models: z
    .string()
    .trim()
    .optional()
    .transform((s) =>
      s
        ? s
            .split(",")
            .map((m) => m.trim())
            .filter(Boolean)
        : undefined,
    ),
  view: z.enum(["server", "tool"]).default("server"),
  rollup: z.enum(["worst-tool", "average-tool"]).default("worst-tool"),
  client: z.string().trim().min(1).optional(),
  // Optional extra scan ids (comma-separated) to fold into the aggregate "environment" totals.
  envScans: z
    .string()
    .trim()
    .optional()
    .transform((s) =>
      s
        ? s
            .split(",")
            .map((m) => m.trim())
            .filter(Boolean)
        : undefined,
    ),
});

// --- Skills (Agent Skill registry + versioning) — Phase 1 contract ---------------------------
// Contract-first zod for the Skills feature (mirrors the TS types 1:1). The API validates request
// bodies with these; the GitHub PAT (`auth.token`) is accepted here but never echoed back (the
// `Skill` view is redacted to `hasAuth: boolean`). Source: planning/Research/RS-02-skill-registry/outputs/05-api-surface.md + 08.

/**
 * SSRF guard for a user-supplied git repo URL. The URL is handed straight to `git clone`, so an
 * attacker could otherwise reach internal services (`http://169.254.169.254/…`), the local
 * filesystem (`file:///etc/passwd`), or other schemes (`git://`, `ssh://`). We therefore accept
 * ONLY `https://` and reject loopback / link-local / private (RFC 1918) hosts.
 */
export function isBlockedRepoHost(rawHost: string): boolean {
  const host = rawHost.trim().toLowerCase().replace(/^\[/, "").replace(/\]$/, "");
  if (!host) return true;
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) return true;
  // Any LITERAL IP host (v4 or v6) is checked against the shared range guard — the SAME function the
  // git-service applies to DNS-RESOLVED addresses, so a literal private IP and a public name that
  // resolves to one are treated identically (defense in depth against DNS-rebinding SSRF).
  return isBlockedIp(host);
}

/**
 * True when a concrete IP address (IPv4 or IPv6 — e.g. a DNS-resolved address) falls in a range we
 * refuse to let `git clone` / `ls-remote` reach: loopback, unspecified, RFC-1918 private, link-local
 * (incl. the cloud metadata endpoint `169.254.169.254`), IPv6 link-local (`fe80::/10`) / unique-local
 * (`fc00::/7`), or an IPv4-mapped IPv6 (`::ffff:a.b.c.d`) of any of the above. Shared by the literal
 * host check ({@link isBlockedRepoHost}) AND the git-service's pre-clone DNS-resolution guard, so a
 * public hostname that RESOLVES to a private address is rejected too. Non-IP strings return `false`
 * (a hostname is only blocked via the name rules in {@link isBlockedRepoHost}).
 */
export function isBlockedIp(rawAddr: string): boolean {
  const addr = rawAddr.trim().toLowerCase().replace(/^\[/, "").replace(/\]$/, "");
  if (!addr) return true;
  // IPv6 (contains a colon): loopback / unspecified / link-local / unique-local, or IPv4-mapped.
  if (addr.includes(":")) {
    if (addr === "::" || addr === "::1") return true;
    if (addr.startsWith("fe80:") || /^f[cd][0-9a-f]{0,2}:/.test(addr)) return true;
    // IPv4-mapped IPv6 (e.g. ::ffff:127.0.0.1) — strip the prefix and re-check as IPv4.
    const mapped = addr.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
    if (mapped) return isBlockedIp(mapped[1]!);
    return false;
  }
  const m = addr.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    if (a === 127 || a === 10 || a === 0) return true; // loopback, 10/8, 0/8
    if (a === 169 && b === 254) return true; // 169.254/16 link-local (incl. 169.254.169.254 metadata)
    if (a === 192 && b === 168) return true; // 192.168/16
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16/12
  }
  return false;
}

/**
 * A repo URL that is safe to pass to `git clone`: a valid `https://` URL whose host is not
 * loopback / link-local / private. Shared by the discover (probe) and import schemas.
 */
export const safeRepoUrlSchema = z
  .string()
  .trim()
  .url()
  .superRefine((value, ctx) => {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Repository URL is not a valid URL." });
      return;
    }
    if (url.protocol !== "https:") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Repository URL must use the https:// scheme.",
      });
    }
    if (isBlockedRepoHost(url.hostname)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Repository URL host is not allowed (loopback, link-local, or private address).",
      });
    }
  });

/**
 * True when `value` is safe to join onto a git checkout root without escaping it: no absolute path
 * (a leading `/` or `\`, or a Windows drive letter) and no `..` path segment (posix- or backslash-
 * separated). Empty string ("repo root") is always safe. `subpath` is documented as posix-relative,
 * but a backslash-separated traversal attempt is rejected too (defense in depth).
 */
function isSafeSubpath(value: string): boolean {
  if (value === "") return true;
  if (value.startsWith("/") || value.startsWith("\\")) return false;
  if (/^[a-zA-Z]:/.test(value)) return false; // Windows drive-letter absolute (e.g. "C:\...")
  return value.split(/[/\\]/).every((segment) => segment !== "..");
}

/**
 * A GitHub-import subpath that cannot escape the checkout root (M2 — path traversal: an unvalidated
 * `subpath="../../../../etc"` would otherwise be joined straight onto the temp checkout dir in
 * `git-service.ts`, reading host files into the stored skill). Shared by the import and update
 * schemas; `git-service.ts` ALSO asserts the resolved checkout path stays contained within the
 * checkout root before reading any files (defense in depth — mirrors the DNS-rebinding guard layered
 * on top of `safeRepoUrlSchema`'s literal-host check above).
 */
export const safeSubpathSchema = z.string().trim().refine(isSafeSubpath, {
  message: 'Subpath must be relative to the repository root and must not contain ".." segments.',
});

// GitHub import: create a skill from a repo/ref/subpath. `auth.token` is a PAT for private repos.
export const githubImportSchema = z.object({
  source: z.literal("github"),
  repoUrl: safeRepoUrlSchema,
  ref: z.string().trim().min(1).default("main"),
  subpath: safeSubpathSchema.default(""), // '' = repo root; else the chosen skill dir
  auth: z.object({ token: z.string().min(1) }).optional(), // PAT for private repos
  displayName: z.string().trim().optional(),
});

// Upload import: the metadata that travels as multipart fields alongside the uploaded zip part.
export const uploadImportSchema = z.object({
  source: z.literal("upload"),
  displayName: z.string().trim().optional(),
});

// Blank import (SkillFlow D3): scaffold a minimal spec-valid SKILL.md from a name + description and
// register it as version 1 through the existing ingest path. A first-class third create source next
// to Upload and GitHub — additive, so existing upload/github callers are unaffected.
export const blankImportSchema = z.object({
  source: z.literal("blank"),
  name: z.string().trim().min(1),
  displayName: z.string().trim().optional(),
  description: z.string().trim().min(1),
});

// Create a skill from any source (upload uses multipart fields; GitHub + blank use JSON). Extended
// additively with the `blank` member (WP 1.0) — existing `upload`/`github` bodies still validate.
export const skillImportSchema = z.discriminatedUnion("source", [
  githubImportSchema,
  uploadImportSchema,
  blankImportSchema,
]);

// Update a skill: rename, and (GitHub-bound skills) retarget the repo URL / ref / subpath or
// set/clear the PAT (`auth: null` clears it; omitting `auth` leaves it unchanged). Retargeting the
// repo/ref/subpath only changes what pull/upstream/push track — existing versions are untouched.
export const skillUpdateSchema = z.object({
  displayName: z.string().trim().min(1).optional(),
  github: z
    .object({
      repoUrl: safeRepoUrlSchema.optional(),
      ref: z.string().trim().min(1).optional(),
      subpath: safeSubpathSchema.optional(), // '' = repo root
      auth: z
        .object({ token: z.string().min(1) })
        .nullable()
        .optional(),
    })
    .optional(),
});

// Probe a repo/ref for SKILL.md dirs before creating a skill (no persistence).
export const skillRepoProbeSchema = z.object({
  repoUrl: safeRepoUrlSchema,
  ref: z.string().trim().min(1).default("main"),
  auth: z.object({ token: z.string().min(1) }).optional(),
});

// Scaffold a new skill from a server's tool surface (Skill IDE WP 8.4 / I9.4). `name` is the skill's
// manifest name/slug (further validated against the Agent Skills name rules server-side); `tools` are
// the selected tool names from the server's latest completed scan (≥1). The route resolves the server
// and reads the scan itself — the client never sends tool descriptions/token costs.
// Server-types WP 3.2 (B): the optional additive `bindTypeName` — when present, the scaffolded skill's
// frontmatter `servers:` names the TYPE (the `serverId` is its D-ST3 representative, used only for the
// tool surface). Omit it for a plain scaffold-from-server (byte-compatible with every existing caller).
export const scaffoldFromServerSchema = z.object({
  serverId: z.string().trim().min(1),
  name: z.string().trim().min(1),
  displayName: z.string().trim().optional(),
  description: z.string().trim().min(1).optional(),
  tools: z.array(z.string().trim().min(1)).min(1),
  bindTypeName: z.string().trim().min(1).optional(),
});

// Per-test report query (the "Tests" tab). `models` is an optional comma-separated id list; omit for
// the full roster.
export const compatibilityTestsQuerySchema = z.object({
  models: z
    .string()
    .trim()
    .optional()
    .transform((s) =>
      s
        ? s
            .split(",")
            .map((m) => m.trim())
            .filter(Boolean)
        : undefined,
    ),
});

// Minimum finding severity that earns a full detail block in the report. Mirrors `DetailLevel` in
// report-derive.ts (kept as a literal here, not imported, to avoid a schemas → report-derive cycle).
export const DETAIL_LEVELS = ["all", "medium", "high", "blocker"] as const;

// Server-level Export Report query. `models` is an optional comma-separated id list (omit → the
// report's default representative set); `client` is an optional host-client target enabling the
// client-gated tests (one of the engine's `cross.clients.*`); `detail` is the min-severity filter
// used by the MARKDOWN route at serialization time (the JSON/PDF route filters client-side and
// ignores it — additive, backward-compatible).
export const serverReportQuerySchema = z.object({
  models: z
    .string()
    .trim()
    .optional()
    .transform((s) =>
      s
        ? s
            .split(",")
            .map((m) => m.trim())
            .filter(Boolean)
        : undefined,
    ),
  client: z.string().trim().min(1).optional(),
  detail: z.enum(DETAIL_LEVELS).default("all"),
});

// Suite-run Export Report query. `grader` selects the score dimension (validated further by
// `parseGraderQuery`; default = primary-grader priority). `embed` controls how much of each member
// run the report carries: `summary` (default) enriches every cell with its tokens/cost/status/score
// (cheap — one indexed row per cell); `full` additionally embeds each member's FULL run report
// (steps/events/statistics) so the export shows what actually happened inside every run, not just
// links (heavy — N full run loads; opt-in). Additive/backward-compatible.
export const SUITE_RUN_REPORT_EMBED_LEVELS = ["summary", "full"] as const;
export const suiteRunReportQuerySchema = z.object({
  grader: z.string().trim().optional(),
  embed: z.enum(SUITE_RUN_REPORT_EMBED_LEVELS).default("summary"),
});

// --- SkillFlow (graph IR + trace vocabulary + session-trace) — Phase 1 contract (WP 1.0) ------
// Contract-first zod mirroring the SkillFlow TS types 1:1. These are the ONE locked contract every
// later SkillFlow WP consumes (projector, aligner, routes, web) — later changes are additive fields
// only. Source of truth: planning/Roadmap/RM-23-skillflow/00-architecture.md ("The three schemas", D2/D6/D7/D8).

/** File-kind enum reused by asset nodes (D8 — no parallel taxonomy). */
export const skillFileKindSchema = z.enum(SKILL_FILE_KINDS);

// --- (1) Skill graph IR ---

/** A node/edge anchor back into the markdown (heading path + line range). */
export const skillGraphAnchorSchema = z.object({
  headingPath: z.array(z.string()),
  startLine: z.number().int().nonnegative(),
  endLine: z.number().int().nonnegative(),
});

// Fields common to every node kind — spread into each discriminated-union member below. `flowId`
// (Skill IDE WP 1.1/I1) is ADDITIVE/optional: absent ⇒ the default `'main'` flow — a pre-IDE graph
// with no `flowId` anywhere still parses.
const skillGraphNodeCommonShape = {
  id: z.string().trim().min(1),
  label: z.string(),
  anchor: skillGraphAnchorSchema,
  source: z.enum(SKILL_GRAPH_SOURCES),
  flowId: z.string().trim().min(1).optional(),
};

/** An entry point's trigger (Skill IDE I1) — a `/command` or a keyword phrase heading a flow. */
export const skillTriggerSchema = z.object({
  type: z.enum(TRIGGER_KINDS),
  value: z.string().trim().min(1),
});

/** A skill graph node — discriminated on `kind`, with kind-specific fields (D8, Skill IDE I1). */
export const skillGraphNodeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("gatekeeper"), ...skillGraphNodeCommonShape }),
  z.object({ kind: z.literal("subroutine"), ...skillGraphNodeCommonShape }),
  z.object({
    kind: z.literal("asset"),
    ...skillGraphNodeCommonShape,
    path: z.string().trim().min(1),
    fileKind: skillFileKindSchema,
  }),
  z.object({
    kind: z.literal("validation_gate"),
    ...skillGraphNodeCommonShape,
    script: z.string().trim().min(1),
    expectation: z.string(),
  }),
  z.object({
    kind: z.literal("loop_guard"),
    ...skillGraphNodeCommonShape,
    maxIterations: z.number().int().positive().optional(),
  }),
  z.object({
    kind: z.literal("entry_point"),
    ...skillGraphNodeCommonShape,
    trigger: skillTriggerSchema,
  }),
  // Skill IDE WP 8.1 (I9.2) — a text-projected tool reference (accessory leaf). `toolName` is the
  // backticked reference verbatim; `serverName` is set only later by the validation overlay / binding.
  z.object({
    kind: z.literal("tool_ref"),
    ...skillGraphNodeCommonShape,
    toolName: z.string().trim().min(1),
    serverName: z.string().trim().min(1).optional(),
  }),
]);

/**
 * A directed graph edge (`condition` labels a gatekeeper branch; `anchor` optional). `flowId`
 * (Skill IDE WP 1.1/I1) is ADDITIVE/optional — absent ⇒ the default `'main'` flow.
 */
export const skillGraphEdgeSchema = z.object({
  id: z.string().trim().min(1),
  from: z.string().trim().min(1),
  to: z.string().trim().min(1),
  condition: z.string().optional(),
  anchor: skillGraphAnchorSchema.optional(),
  flowId: z.string().trim().min(1).optional(),
});

/** One flow in a graph (Skill IDE I1): its id/label + the entry-point node heading it (if any). */
export const skillFlowSchema = z.object({
  id: z.string().trim().min(1),
  label: z.string(),
  entryNodeId: z.string().trim().min(1).optional(),
});

/**
 * The skill graph IR: nodes + edges + projector warnings. `flows` (Skill IDE WP 1.1/I1) is
 * ADDITIVE/optional — absent ⇒ a single implicit `main` flow (a pre-IDE graph still parses).
 */
export const skillGraphSchema = z.object({
  nodes: z.array(skillGraphNodeSchema),
  edges: z.array(skillGraphEdgeSchema),
  warnings: z.array(z.string()).default([]),
  flows: z.array(skillFlowSchema).optional(),
});

// --- (2) Trace-event vocabulary ---

// The event `idx` (0-based position in the trace) and optional ISO `at` timestamp, shared by every
// event type. `idx` is a non-negative integer — a negative index is rejected.
const traceEventBaseShape = {
  idx: z.number().int().nonnegative(),
  at: z.string().trim().min(1).optional(),
};

/** A normalized trace event — discriminated on `type`, with a per-type payload (D6). */
export const traceEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("turn"),
    ...traceEventBaseShape,
    payload: z.object({
      role: z.enum(["assistant", "user"]).optional(),
      text: z.string().optional(),
    }),
  }),
  z.object({
    type: z.literal("tool_call"),
    ...traceEventBaseShape,
    payload: z.object({ tool: z.string().min(1), args: z.unknown().optional() }),
  }),
  z.object({
    type: z.literal("tool_result"),
    ...traceEventBaseShape,
    payload: z.object({
      tool: z.string().optional(),
      status: z.string().optional(),
      bytes: z.number().int().nonnegative().optional(),
      result: z.unknown().optional(),
    }),
  }),
  z.object({
    type: z.literal("skill_file_read"),
    ...traceEventBaseShape,
    payload: z.object({
      skill: z.string().min(1),
      path: z.string().min(1),
      bytes: z.number().int().nonnegative().optional(),
    }),
  }),
  z.object({
    type: z.literal("script_result"),
    ...traceEventBaseShape,
    payload: z.object({
      script: z.string().optional(),
      exitCode: z.number().int(),
      stdout: z.string().optional(),
      stderr: z.string().optional(),
    }),
  }),
  z.object({
    type: z.literal("subagent_spawn"),
    ...traceEventBaseShape,
    payload: z.object({ label: z.string().optional(), prompt: z.string().optional() }),
  }),
  z.object({
    type: z.literal("marker"),
    ...traceEventBaseShape,
    payload: z.object({
      raw: z.string(),
      gateId: z.string().optional(),
      routeId: z.string().optional(),
    }),
  }),
  z.object({
    type: z.literal("user_message"),
    ...traceEventBaseShape,
    payload: z.object({ text: z.string() }),
  }),
]);

// --- (3) Session-trace shape ---

/**
 * A conformance verdict — at least one of `nodeId`/`edgeId` must be present (a verdict with neither
 * is rejected). `evidence` cites the trace-event `idx`s justifying it.
 */
export const traceVerdictSchema = z
  .object({
    nodeId: z.string().trim().min(1).optional(),
    edgeId: z.string().trim().min(1).optional(),
    status: z.enum(TRACE_VERDICT_STATUSES),
    reason: z.string(),
    evidence: z.array(z.number().int().nonnegative()).default([]),
    // WP 3.2 — additive: 'exact' when the evidence includes a marker/script_result, else 'inferred'.
    confidence: z.enum(TRACE_VERDICT_CONFIDENCE).optional(),
  })
  .superRefine((value, ctx) => {
    if (!value.nodeId && !value.edgeId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "A verdict must reference at least one of nodeId or edgeId.",
      });
    }
  });

/** The trace-vs-graph alignment: visit/traversal counts, verdicts, unmatched events, version stamps. */
export const traceAlignmentSchema = z.object({
  nodeVisits: z.record(z.number().int().nonnegative()).default({}),
  edgeTraversals: z.record(z.number().int().nonnegative()).default({}),
  verdicts: z.array(traceVerdictSchema).default([]),
  unmatchedEvents: z.array(z.number().int().nonnegative()).default([]),
  projectorVersion: z.number().int().nonnegative(),
  alignerVersion: z.number().int().nonnegative(),
});

/** A trace: source + ref + resolved skill version + normalized events + alignment. */
export const sessionTraceSchema = z.object({
  source: z.enum(TRACE_SOURCES),
  ref: z.string().trim().min(1),
  skillVersionId: z.string().trim().min(1),
  events: z.array(traceEventSchema).default([]),
  alignment: traceAlignmentSchema,
});

// --- Route request/response bodies later WPs need (kept minimal) ---

/** Graph route response (`GET /api/skills/:id/versions/:vid/graph`): graph + projector-version stamp. */
export const skillGraphResponseSchema = z.object({
  graph: skillGraphSchema,
  projectorVersion: z.number().int().nonnegative(),
});

/** Trace route response (`…/versions/:vid/trace`): the aligned session trace. */
export const skillTraceResponseSchema = sessionTraceSchema;

/**
 * WP 2.1 — response of `GET /api/runs/:runId/trace`: the normalized run-step event stream WITHOUT an
 * alignment yet (the aligner lands in a later WP). Deliberately a LIGHTER shape than
 * {@link sessionTraceSchema} (whose `alignment` is required) — a run→trace normalizer produces events
 * only. Additive; nothing consumes it before this WP. `source` is fixed to `"run"` (the only source a
 * persisted run has).
 */
export const runTraceResponseSchema = z.object({
  source: z.literal("run"),
  ref: z.string().trim().min(1),
  skillVersionId: z.string().trim().min(1),
  events: z.array(traceEventSchema).default([]),
});

// --- SkillFlow Phase 4 (WP 4.1) — graph-level edit ops → SKILL.md round-trip ------------------

/**
 * One graph-level edit operation — discriminated on `op`, mirroring `SkillEditOp` 1:1. Section ops
 * name a node id; `set_edge_condition` names an edge id; `afterNodeId: null` means "at the start"
 * (reorder) / "at the document end" (add_subroutine).
 */
export const skillEditOpSchema = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("rename_node"),
    nodeId: z.string().trim().min(1),
    label: z.string().trim().min(1),
  }),
  z.object({
    op: z.literal("update_section_body"),
    nodeId: z.string().trim().min(1),
    body: z.string(),
  }),
  z.object({
    op: z.literal("add_subroutine"),
    afterNodeId: z.string().trim().min(1).nullable(),
    title: z.string().trim().min(1),
    body: z.string().optional(),
  }),
  z.object({ op: z.literal("remove_node"), nodeId: z.string().trim().min(1) }),
  z.object({
    op: z.literal("reorder"),
    nodeId: z.string().trim().min(1),
    afterNodeId: z.string().trim().min(1).nullable(),
  }),
  z.object({
    op: z.literal("set_edge_condition"),
    edgeId: z.string().trim().min(1),
    condition: z.string().trim().min(1),
  }),
  z.object({
    op: z.literal("add_asset_ref"),
    nodeId: z.string().trim().min(1),
    path: z.string().trim().min(1),
    sentence: z.string().optional(),
  }),
  z.object({
    op: z.literal("set_gate_expectation"),
    nodeId: z.string().trim().min(1),
    expectation: z.string().trim().min(1),
  }),
  z.object({
    op: z.literal("set_annotation"),
    nodeId: z.string().trim().min(1),
    kind: z.enum(["gatekeeper", "gate"]),
    id: z.string().trim().min(1),
  }),
  // --- Skill IDE WP 1.1 (I2/I3) — IDE op vocabulary (shapes only; semantics in later WPs) --------
  // A /command token is `/word[…]` — one leading slash + a non-space token (validated as a token,
  // not a path). `title`/`body` seed the new command's section; `afterFlowId` places its flow.
  z.object({
    op: z.literal("add_command"),
    command: z
      .string()
      .trim()
      .regex(/^\/\S+$/, "A command must be a single /token (e.g. /report)."),
    title: z.string().trim().min(1).optional(),
    body: z.string().optional(),
    afterFlowId: z.string().trim().min(1).optional(),
  }),
  z.object({
    op: z.literal("rename_command"),
    nodeId: z.string().trim().min(1),
    command: z
      .string()
      .trim()
      .regex(/^\/\S+$/, "A command must be a single /token (e.g. /report)."),
  }),
  z.object({ op: z.literal("delete_command"), nodeId: z.string().trim().min(1) }),
  // Keyword trigger set (I7) — each keyword non-empty; the array itself may be emptied.
  z.object({
    op: z.literal("set_keywords"),
    keywords: z.array(z.string().trim().min(1)),
  }),
  z.object({
    op: z.literal("connect_asset"),
    nodeId: z.string().trim().min(1),
    path: z.string().trim().min(1),
    sentence: z.string().optional(),
  }),
  z.object({
    op: z.literal("disconnect_asset"),
    nodeId: z.string().trim().min(1),
    path: z.string().trim().min(1),
  }),
  // Tree/file ops (I3) — `path`/`from`/`to` are non-empty posix paths; `encoding` absent ⇒ utf8.
  z.object({
    op: z.literal("add_file"),
    path: z.string().trim().min(1),
    content: z.string(),
    encoding: z.enum(SKILL_FILE_ENCODINGS).optional(),
  }),
  z.object({
    op: z.literal("update_file"),
    path: z.string().trim().min(1),
    content: z.string(),
    encoding: z.enum(SKILL_FILE_ENCODINGS).optional(),
  }),
  z.object({
    op: z.literal("rename_file"),
    from: z.string().trim().min(1),
    to: z.string().trim().min(1),
  }),
  z.object({ op: z.literal("delete_file"), path: z.string().trim().min(1) }),
  // Skill IDE WP 8.1 (I9.3) — reference a bound server's tool from a section (shape only; a 400-stub
  // in `validateEditOps` until WP 8.3 lands the anchored-splice semantics). `server`/`tool` are the
  // bound server name + tool name; `sentence` optionally overrides the default reference sentence.
  z.object({
    op: z.literal("add_tool_ref"),
    nodeId: z.string().trim().min(1),
    server: z.string().trim().min(1),
    tool: z.string().trim().min(1),
    sentence: z.string().optional(),
  }),
]);

/**
 * Body of `POST /api/skills/:id/versions/:vid/edits` (WP 4.1). `baseTreeSha` is the stale-anchor
 * precondition: it must equal the target version's `tree_sha` or the route rejects with 409.
 */
export const skillEditsRequestSchema = z.object({
  baseTreeSha: z.string().trim().min(1),
  ops: z.array(skillEditOpSchema),
  note: z.string().trim().min(1).optional(),
});

// --- Skill IDE Phase 9 (WP 9.1, I10) — live-draft engine: previews + content-canonical save --------

/**
 * A `SkillFileNode` — the optional `files` the stateless preview endpoints accept so the live
 * projection resolves asset/gate references EXACTLY as the persisted projection does (WP 9.1). Every
 * non-path field defaults so a caller can send a lean `{ path, kind }` list.
 */
export const skillFileNodeSchema = z.object({
  path: z.string().trim().min(1),
  size: z.number().int().nonnegative().default(0),
  isBinary: z.boolean().default(false),
  isSkillMd: z.boolean().default(false),
  kind: skillFileKindSchema,
  tokenTotal: z.number().int().nonnegative().default(0),
});

/** Body of `POST /api/skillflow/apply-preview` (I10.1) — the stateless splice: `content` + ops → text. */
export const applyPreviewRequestSchema = z.object({
  content: z.string(),
  ops: z.array(skillEditOpSchema),
  files: z.array(skillFileNodeSchema).optional(),
});

/** Response of apply-preview: the edited content (byte-identical to the persisted splice) + warnings. */
export const applyPreviewResponseSchema = z.object({
  content: z.string(),
  warnings: z.array(z.string()).default([]),
});

/** Body of `POST /api/skillflow/project-preview` (I10.2) — project `content` into a live graph. */
export const projectPreviewRequestSchema = z.object({
  content: z.string(),
  files: z.array(skillFileNodeSchema).optional(),
});

/** Response of project-preview: graph + warnings + the projector-version stamp. */
export const projectPreviewResponseSchema = z.object({
  graph: skillGraphSchema,
  warnings: z.array(z.string()).default([]),
  projectorVersion: z.number().int().nonnegative(),
});

/** One op INTENT-LOG entry (I10.3) — the staged op + optional human summary + staging timestamp. */
export const skillIntentLogEntrySchema = z.object({
  op: skillEditOpSchema,
  summary: z.string().optional(),
  at: z.string().optional(),
});

/**
 * Body of `POST /api/skills/:id/save-draft` (I10.3) — the content-canonical save. `baseVersionId` is
 * the head the draft forked from (409 when the head moved); `content` is the final SKILL.md; `treeOps`
 * are pending file/tree ops applied to the base tree; `intentLog` is the op audit → version metadata.
 */
export const saveSkillDraftRequestSchema = z.object({
  baseVersionId: z.string().trim().min(1),
  content: z.string(),
  treeOps: z.array(skillEditOpSchema).default([]),
  intentLog: z.array(skillIntentLogEntrySchema).default([]),
  note: z.string().trim().min(1).optional(),
});

/**
 * Body of `POST /api/skills/:id/versions/:vid/restore` — restore an OLDER version as the new latest.
 * The version to restore FROM is `:vid` in the path; the only body field is an optional `note` that
 * overrides the auto-generated "Restored from v{seq}". The restore is non-destructive: the chosen
 * version's tree is copied into a NEW head version, leaving the in-between versions intact.
 */
export const restoreSkillVersionRequestSchema = z.object({
  note: z.string().trim().min(1).optional(),
});

// --- SkillFlow Phase 5 (WP 5.2) — fracture verdicts → suggested edits ---------------------------

/** The verdict a suggestion was derived from — at least one of `nodeId`/`edgeId` must be present. */
export const skillSuggestionVerdictRefSchema = z
  .object({
    nodeId: z.string().trim().min(1).optional(),
    edgeId: z.string().trim().min(1).optional(),
    status: z.enum(TRACE_VERDICT_STATUSES),
  })
  .superRefine((value, ctx) => {
    if (!value.nodeId && !value.edgeId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "A suggestion's verdictRef must reference at least one of nodeId or edgeId.",
      });
    }
  });

/**
 * One deterministic suggestion — `ops: []` marks an ADVISORY suggestion (a rationale worth
 * surfacing, but nothing the deterministic engine will draft on the author's behalf).
 */
export const skillSuggestionSchema = z.object({
  id: z.string().trim().min(1),
  verdictRef: skillSuggestionVerdictRefSchema,
  rule: z.enum(SKILLFLOW_SUGGESTION_RULES),
  rationale: z.string().trim().min(1),
  ops: z.array(skillEditOpSchema).default([]),
});

/**
 * One static (trace-less) optimization suggestion (WP 4.2) — shares the `SkillEditOp[]` fix-op
 * vocabulary; `ops: []` marks an ADVISORY suggestion. `target` optionally anchors it to a section
 * node / file path.
 */
export const skillStaticSuggestionSchema = z.object({
  id: z.string().trim().min(1),
  rule: z.enum(SKILLFLOW_STATIC_SUGGESTION_RULES),
  rationale: z.string().trim().min(1),
  ops: z.array(skillEditOpSchema).default([]),
  target: z
    .object({
      nodeId: z.string().trim().min(1).optional(),
      path: z.string().trim().min(1).optional(),
    })
    .optional(),
});

/**
 * Response of `GET /api/skills/:id/versions/:vid/suggestions`: the trace list + the version stamps,
 * plus the optional `staticSuggestions` returned when the route is called WITHOUT a `runId` (WP 4.2).
 */
export const skillSuggestionsResponseSchema = z.object({
  suggestions: z.array(skillSuggestionSchema).default([]),
  staticSuggestions: z.array(skillStaticSuggestionSchema).optional(),
  projectorVersion: z.number().int().nonnegative(),
  alignerVersion: z.number().int().nonnegative(),
});

// --- Skill IDE Phase 1 (WP 1.1) — quality / tool-validation / trigger / publish zod --------------
// Contract-first zod mirroring the Skill IDE TS types 1:1. The ENGINES producing these land in later
// WPs; WP 1.1 freezes + round-trip-tests the shapes. Source: planning/Roadmap/RM-22-skill-ide/00-architecture.md.

/** A single deterministic quality finding (I4): rule id, severity, message, optional anchor + fix. */
export const qualityFindingSchema = z.object({
  ruleId: z.string().trim().min(1),
  severity: z.enum(QUALITY_SEVERITIES),
  message: z.string(),
  anchor: skillGraphAnchorSchema.optional(),
  fix: z.array(skillEditOpSchema).optional(),
});

/**
 * A skill version's quality report (I4): findings + a 0–100 INTEGER score (derived from
 * `QUALITY_SEVERITY_WEIGHTS`) + a per-rule tally + the engine-version stamp. `score` is bounded here
 * — a value outside 0–100 or non-integer is rejected.
 */
export const qualityReportSchema = z.object({
  findings: z.array(qualityFindingSchema).default([]),
  score: z.number().int().min(0).max(100),
  ruleCounts: z.record(z.number().int().nonnegative()).default({}),
  qualityEngineVersion: z.number().int().nonnegative(),
});

/** A close-match candidate for an unknown/stale tool reference (I5). */
export const toolDiagnosticCandidateSchema = z.object({
  server: z.string().trim().min(1),
  tool: z.string().trim().min(1),
  confidence: z.enum(TOOL_CANDIDATE_CONFIDENCE),
});

/** One MCP tool-reference diagnostic (I5): kind + referenced name + optional anchor + candidates. */
export const toolDiagnosticSchema = z.object({
  kind: z.enum(TOOL_DIAGNOSTIC_KINDS),
  name: z.string().trim().min(1),
  anchor: skillGraphAnchorSchema.optional(),
  candidates: z.array(toolDiagnosticCandidateSchema).default([]),
});

/** The tool-reference validation report (I5): diagnostics + the `toolValidationVersion` stamp. */
export const toolDiagnosticsReportSchema = z.object({
  diagnostics: z.array(toolDiagnosticSchema).default([]),
  toolValidationVersion: z.number().int().nonnegative(),
  // Scoped registered servers with no completed scan (WP 5.1); optional/additive — omitted when all
  // scoped servers have at least one completed scan.
  unscannedServers: z.array(z.string()).optional(),
});

/** A skill's trigger surface (I7): description + keywords + commands (value/nodeId/flowId each). */
export const triggerSurfaceSchema = z.object({
  description: z.string(),
  keywords: z.array(z.string().trim().min(1)).default([]),
  commands: z
    .array(
      z.object({
        value: z.string().trim().min(1),
        nodeId: z.string().trim().min(1),
        flowId: z.string().trim().min(1),
      }),
    )
    .default([]),
});

/** A cross-skill trigger collision (I7): a value of a given kind claimed by ≥ 2 skills. */
export const triggerCollisionSchema = z.object({
  value: z.string().trim().min(1),
  kind: z.enum(TRIGGER_KINDS),
  skillIds: z.array(z.string().trim().min(1)),
});

/**
 * Body of the publish-to-GitHub route (I6). `repoName` must match GitHub's naming rules
 * (`GITHUB_REPO_NAME_PATTERN`) and is additionally refused when it is the git-reserved `.`/`..`.
 * `token` (a PAT) is accepted but never echoed back (redacted, argv-only — like `SkillGitService`).
 */
export const publishToGithubInputSchema = z.object({
  repoName: z
    .string()
    .trim()
    .regex(
      GITHUB_REPO_NAME_PATTERN,
      "Repo name may only contain letters, digits, '.', '-', '_' (1–100 chars).",
    )
    .refine((name) => name !== "." && name !== "..", {
      message: "Repo name cannot be '.' or '..'.",
    }),
  private: z.boolean(),
  token: z.string().min(1).optional(),
  bindAsSource: z.boolean(),
});

/** Result of publish-to-GitHub (I6): the created repo URL + whether it was bound as the source. */
export const publishToGithubResultSchema = z.object({
  repoUrl: z.string().trim().url(),
  bound: z.boolean(),
});

/**
 * A git branch name that is safe to pass as an argv ref: no leading '-' (option injection), no '..',
 * no control/space characters, no '~^:?*[\' or '@{', no trailing '/' or '.lock'. A pragmatic subset
 * of `git check-ref-format` — used by the push-to-GitHub head-branch input.
 */
export const safeBranchNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .refine(
    (name) =>
      /^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(name) &&
      !name.includes("..") &&
      !name.includes("//") &&
      !name.includes("@{") &&
      !name.endsWith("/") &&
      !name.endsWith(".") &&
      !name.endsWith(".lock"),
    { message: "Not a valid git branch name." },
  );

/**
 * Body of the push-to-GitHub route: push a skill version BACK to its bound source repo, either as a
 * direct commit to the tracked ref or as a new head branch + pull request. `token` is a PAT override
 * (falls back to the skill's stored auth; accepted here, never returned).
 */
export const skillPushToGithubInputSchema = z.object({
  mode: z.enum(["direct", "pr"]),
  commitMessage: z.string().trim().min(1).max(500).optional(),
  branch: safeBranchNameSchema.optional(),
  prTitle: z.string().trim().min(1).max(300).optional(),
  prBody: z.string().max(20_000).optional(),
  token: z.string().min(1).optional(),
});

/**
 * Body of `PUT /api/github/client-id` — the owner-registered GitHub OAuth App's client id (public
 * configuration, not a secret; the device flow needs no client secret).
 */
export const githubClientIdInputSchema = z.object({
  clientId: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .regex(/^[A-Za-z0-9._-]+$/, "Not a valid OAuth App client id."),
});

/** Body of `POST /api/github/device/poll` — the server-side flow handle from `device/start`. */
export const githubDevicePollInputSchema = z.object({
  flowId: z.string().trim().min(1),
});

/** Result of push-to-GitHub (see `SkillPushToGithubResult`). */
export const skillPushToGithubResultSchema = z.object({
  mode: z.enum(["direct", "pr"]),
  repoUrl: z.string().trim().url(),
  branch: z.string(),
  unchanged: z.boolean(),
  commitSha: z.string().optional(),
  prUrl: z.string().url().optional(),
  prNumber: z.number().int().positive().optional(),
});

// --- Skill IDE WP 8.1 (I9.1) — server binding shapes --------------------------------------------

/**
 * One skill→server binding: a portable `serverName` + the resolved `serverId` (null when unbound).
 * Server-types WP 3.1 (D-ST3) adds the additive, strictly-optional `typeId`/`resolvedVia` metadata the
 * resolver stamps onto a TYPE-resolved binding. Both are OPTIONAL so a PUT body may continue to send
 * just `{ serverName, serverId }` (the resolver derives type metadata on read; the persisted table is
 * unchanged and ignores these fields).
 */
export const skillServerBindingSchema = z.object({
  serverName: z.string().trim().min(1),
  serverId: z.string().trim().min(1).nullable(),
  typeId: z.string().trim().min(1).nullable().optional(),
  resolvedVia: z.enum(["server", "type"]).optional(),
});

/** Body of `PUT /api/skills/:id/bindings` — the full binding set to upsert (REPLACE semantics). */
export const skillBindingsInputSchema = z.object({
  bindings: z.array(skillServerBindingSchema),
});

// --- Skill IDE WP 8.2 (I9.3) — bound-tools response shapes --------------------------------------

/** One top-level input-schema parameter of a bound tool (name + JSON-schema type + required flag). */
export const boundToolParamSchema = z.object({
  name: z.string(),
  type: z.string(),
  required: z.boolean(),
});

/**
 * One tool from a resolved binding's latest completed scan (the `GET …/bound-tools` element). The
 * route reads persisted scans only — this schema is the additive response contract, never validates
 * a request body (the route takes no body).
 */
export const boundToolSchema = z.object({
  serverId: z.string(),
  serverName: z.string(),
  toolName: z.string(),
  description: z.string().optional(),
  schemaParams: z.array(boundToolParamSchema),
  definitionTokens: z.number(),
});

// --- UX overhaul WP 3.5 (G7, D-UX12) — run-plan cost preview query ------------------------------
// `GET /api/estimate/run-plan?testIds=a,b&environmentIds=x,y&repetitions=2`. Read-only, advisory.
// Ids arrive comma-separated (the launcher builds them); each list is split, trimmed and de-blanked.
const csvIdList = z.string().transform((raw) =>
  raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
);

export const runPlanEstimateQuerySchema = z.object({
  testIds: csvIdList.pipe(z.array(z.string().min(1)).min(1)),
  environmentIds: csvIdList.pipe(z.array(z.string().min(1)).min(1)),
  repetitions: z.coerce
    .number()
    .int()
    .min(1)
    .max(SUITE_MAX_REPETITIONS)
    .default(SUITE_DEFAULT_REPETITIONS),
});

export type RunPlanEstimateQuery = z.infer<typeof runPlanEstimateQuerySchema>;

// --- RM-33 WP 2.1 — the run-plan estimate RESPONSE shape ----------------------------------------
// The endpoint's answer had a type (`RunPlanEstimate`) but no zod mirror, so an additive field could
// be added on one side and forgotten on the other with nothing to notice. These `.strict()` schemas
// are the wire contract: a contract test parses the live route's body through them, so an undeclared
// key is a failure rather than an undocumented extra. Nothing PARSES a request with them — the
// request contract is `runPlanEstimateQuerySchema` above.

export const estimateRangeSchema = z
  .object({ low: z.number(), mid: z.number(), high: z.number() })
  .strict();

// RM-34 WP 1.1 — the measured turn model that produced an environment's token band. `sampleSize` is
// the honest companion of `basis`: `"default"` always carries 0, and a measured basis carries the
// completed-run count behind it, so a band read off 3 runs is never mistaken for one read off 51.
export const runPlanTurnProfileSchema = z
  .object({
    basis: z.enum(RUN_PLAN_TURN_BASES),
    sampleSize: z.number().int().nonnegative(),
    turns: estimateRangeSchema,
    outputTokensPerTurn: z.number().nonnegative(),
  })
  .strict();

export const runPlanEstimateEnvironmentSchema = z
  .object({
    environmentId: z.string(),
    name: z.string(),
    model: z.string(),
    priced: z.boolean(),
    reason: z.string().optional(),
    footprintTokens: z.number(),
    hasCostCap: z.boolean(),
    tokens: estimateRangeSchema,
    costUsd: estimateRangeSchema.optional(),
    /** RM-33 WP 2.1 — whether this environment's `costUsd.low` models prompt caching. */
    cachingAssumed: z.boolean().optional(),
    /** RM-34 WP 1.1 — the turn model behind `tokens`, and the basis it was measured on. */
    turnProfile: runPlanTurnProfileSchema.optional(),
  })
  .strict();

export const runPlanEstimateSchema = z
  .object({
    testCount: z.number(),
    environmentCount: z.number(),
    repetitions: z.number(),
    totalRuns: z.number(),
    tokens: estimateRangeSchema,
    costUsd: estimateRangeSchema,
    unpricedEnvironmentCount: z.number(),
    uncappedEnvironmentCount: z.number(),
    /** RM-33 WP 2.1 — whether ANY priced environment's low end models prompt caching. */
    cachingAssumed: z.boolean().optional(),
    environments: z.array(runPlanEstimateEnvironmentSchema),
  })
  .strict();

// --- UX overhaul WP 3.3 (G11/S20) — skill usage response shape ----------------------------------
// `GET /api/skills/:id/usage` → the environments a skill is attached to + its recent runs. Read-only
// over `scenario_skills` + `run_skills`. Additive response contract; validates no request body.
export const skillUsageEnvironmentSchema = z.object({
  scenarioId: z.string(),
  name: z.string(),
  versionMode: skillVersionModeSchema,
  pinnedVersionId: z.string().optional(),
  eager: z.boolean(),
});

export const skillUsageRunSchema = z.object({
  runId: z.string(),
  status: z.enum(RUN_STATUSES),
  outcome: z.enum(RUN_OUTCOMES).optional(),
  startedAt: z.string(),
  versionLabel: z.string(),
  scenarioId: z.string(),
  scenarioName: z.string().optional(),
});

export const skillUsageSchema = z.object({
  skillId: z.string(),
  environments: z.array(skillUsageEnvironmentSchema),
  runs: z.array(skillUsageRunSchema),
});

// ==================================================================================================
// Assistant (WP 0.1) — request contract
// ==================================================================================================
// Embedded Claude agent chat (planning/Roadmap/RM-02-assistant/00-plan.md). These are the request-body schemas for
// the routes WP 0.2/1.1/2.1 implement; see types.ts for the response-side wire shapes
// (AssistantThread/AssistantEvent/AssistantAuthStatus/AssistantContextEnvelope).

/**
 * The per-message context envelope (D-AS7) — current route/entity/tab, appended to every message so
 * "this run"/"this skill" resolves without the user pasting ids. `route` is always known (the dock
 * reads the current URL); the rest is optional.
 */
export const assistantContextEnvelopeSchema = z
  .object({
    route: z.string().trim().min(1),
    entityKind: z.enum(ASSISTANT_ENTITY_KINDS).optional(),
    entityId: z.string().trim().min(1).optional(),
    tab: z.string().trim().min(1).optional(),
  })
  // An entity pin is a pair: either both `entityKind` and `entityId` are present (a real pin) or
  // both are absent (global-dock context). A half-formed pin is meaningless and never resolves.
  .refine((value) => (value.entityKind === undefined) === (value.entityId === undefined), {
    message: "entityKind and entityId must be provided together",
    path: ["entityId"],
  });

/** Body of `POST /api/assistant/threads/:id/messages` (WP 1.1). */
export const assistantMessageSchema = z.object({
  text: z.string().trim().min(1),
  envelope: assistantContextEnvelopeSchema.optional(),
});

/**
 * Body of `POST /api/assistant/threads/:id/permission` (WP 2.1) — the `canUseTool` choke point's
 * request/decision round-trip. `updatedInput` lets the owner edit a write's arguments before
 * allowing it; omitted on a plain allow/deny.
 */
export const assistantPermissionDecisionSchema = z.object({
  requestId: z.string().trim().min(1),
  behavior: z.enum(["allow", "deny"]),
  updatedInput: z.unknown().optional(),
});

/**
 * Body of `POST /api/assistant/threads` (WP 1.1). `title` defaults to a generated label when
 * omitted; `model` defaults to the roster's default (latest Sonnet, D-AS10) when omitted;
 * `authSource` defaults to the thread's configured primary source (subscription when signed in).
 */
export const assistantThreadCreateSchema = z
  .object({
    title: z.string().trim().min(1).optional(),
    entityKind: z.enum(ASSISTANT_ENTITY_KINDS).optional(),
    entityId: z.string().trim().min(1).optional(),
    model: z.string().trim().min(1).optional(),
    authSource: z.enum(ASSISTANT_AUTH_SOURCES).optional(),
    // Optional initial write mode (defaults OFF). Lets the dock (re)create a thread ALREADY carrying
    // auto-accept when the active thread's server row is gone and its PATCH 404s (mirrors how `model`
    // is set at create time), so toggling the write mode never dead-ends on a stale thread.
    autoAccept: z.boolean().optional(),
  })
  // An entity pin is a pair (see assistantContextEnvelopeSchema): both present or both absent.
  .refine((value) => (value.entityKind === undefined) === (value.entityId === undefined), {
    message: "entityKind and entityId must be provided together",
    path: ["entityId"],
  });

/**
 * Body of `PATCH /api/assistant/threads/:id` (WP 1.1) — title/model/auto-accept only. `status` and
 * `sdkSessionId` are session-manager-owned and never client-writable. At least one field required.
 */
export const assistantThreadUpdateSchema = z
  .object({
    title: z.string().trim().min(1).optional(),
    model: z.string().trim().min(1).optional(),
    autoAccept: z.boolean().optional(),
  })
  .refine(
    (value) =>
      value.title !== undefined || value.model !== undefined || value.autoAccept !== undefined,
    {
      message: "At least one of title, model, autoAccept must be provided",
    },
  );

/**
 * Body of `POST /api/assistant/threads/:id/retry-source` (WP 3.3, D-AS14) — the ONLY way a thread's
 * `authSource` ever changes: an explicit owner action after a `limit_error`, never a silent fallback.
 * `source` is the TARGET to switch to; the route 400s if it matches the thread's current source and
 * 409s if that target isn't actually configured (no fallback key / not signed in).
 */
export const assistantRetrySourceSchema = z.object({
  source: z.enum(ASSISTANT_AUTH_SOURCES),
});

/**
 * Query of `GET /api/assistant/starters` (WP R3.1, D-AS27/D-AS28). Additive to the plan's
 * `?entityKind&entityId&tab` shape: `route` is ALSO accepted so a surface with no URL-derivable
 * entity pin (`compare`, `compatibility` — see `resolveEntityPin`'s doc in
 * `apps/web/src/features/assistant/assistant-context.tsx`) can still resolve its starter surface
 * without a hacked/fabricated entity pin — `resolveStarterSurface` (`./assistant-starters.js`) falls
 * back to matching `route` only when `entityKind` is absent. Every field optional: an omitted query
 * resolves to the `"global"` surface.
 */
export const assistantStartersQuerySchema = z.object({
  entityKind: z.enum(ASSISTANT_ENTITY_KINDS).optional(),
  entityId: z.string().trim().min(1).optional(),
  tab: z.string().trim().min(1).optional(),
  route: z.string().trim().min(1).optional(),
});

export type AssistantContextEnvelopeInput = z.infer<typeof assistantContextEnvelopeSchema>;
export type AssistantMessageInput = z.infer<typeof assistantMessageSchema>;
export type AssistantPermissionDecisionInput = z.infer<typeof assistantPermissionDecisionSchema>;
export type AssistantThreadCreateInput = z.infer<typeof assistantThreadCreateSchema>;
export type AssistantThreadUpdateInput = z.infer<typeof assistantThreadUpdateSchema>;
export type AssistantRetrySourceInput = z.infer<typeof assistantRetrySourceSchema>;
export type AssistantStartersQueryInput = z.infer<typeof assistantStartersQuerySchema>;

// --- Assistant (WP 0.2) — Claude sign-in request contract (additive) -----------------------------
// The auth routes: PTY sign-in (start → complete → cancel), the manual token paste, and the API-key
// fallback pointer. The token itself is captured/stored server-side and NEVER returned; these are the
// request bodies only. See types.ts for AssistantAuthStatus / AssistantAuthStartResponse.

/**
 * Body of `POST /api/assistant/auth/oauth/complete`. `flowId` scopes the pasted code to the exact
 * single-flight PTY flow that produced the URL; `code` is what the owner pasted from their browser
 * (an authorization code, or the full redirect URL — written verbatim to the CLI, never parsed here).
 */
export const assistantAuthCompleteSchema = z.object({
  flowId: z.string().trim().min(1),
  code: z.string().trim().min(1),
});

/** Body of `POST /api/assistant/auth/oauth/cancel`. `flowId` optional — omitted cancels the current flow. */
export const assistantAuthCancelSchema = z.object({
  flowId: z.string().trim().min(1).optional(),
});

/**
 * Body of `POST /api/assistant/auth/token` (manual paste path, D-AS2). Shape-validates the
 * `sk-ant-oat01-…` prefix so an obviously-wrong paste is rejected before storage; no SDK validation
 * ping here (deferred to the WP 1.1 session driver) — a well-formed token is simply stored encrypted.
 */
export const assistantTokenPasteSchema = z.object({
  token: z
    .string()
    .trim()
    .min(ASSISTANT_OAUTH_TOKEN_PREFIX.length + 8)
    .startsWith(ASSISTANT_OAUTH_TOKEN_PREFIX, {
      message: `Token must be a Claude subscription OAuth token (starts with ${ASSISTANT_OAUTH_TOKEN_PREFIX}).`,
    }),
});

/**
 * Body of `PUT /api/assistant/auth/fallback` (D-AS14). `providerCredentialId` MUST reference an
 * existing anthropic-kind `provider_credentials` row (validated server-side → 400 otherwise); `null`
 * clears the fallback. The key is never duplicated — only the reference is stored.
 */
export const assistantFallbackSchema = z.object({
  providerCredentialId: z.string().trim().min(1).nullable(),
});

export type AssistantAuthCompleteInput = z.infer<typeof assistantAuthCompleteSchema>;
export type AssistantAuthCancelInput = z.infer<typeof assistantAuthCancelSchema>;
export type AssistantTokenPasteInput = z.infer<typeof assistantTokenPasteSchema>;
export type AssistantFallbackInput = z.infer<typeof assistantFallbackSchema>;

// --- Rating Issues registry (Auto-Rating follow-on) — additive, mirrors types.ts exactly ----------

/** One contributing run of a rating issue (see `RatingIssueOccurrence` in types.ts). */
export const ratingIssueOccurrenceSchema = z.object({
  runId: z.string(),
  suiteRunId: z.string().optional(),
  category: z.enum(RATING_ISSUE_OCCURRENCE_CATEGORIES),
  message: z.string(),
  // Concrete failure evidence carried through from the contributing finding (all optional, bounded).
  toolName: z.string().optional(),
  sentArguments: z.string().optional(),
  errorMessage: z.string().optional(),
  createdAt: z.string(),
});

/** One day's failure count for a fleet issue's trend (see `RatingIssueTrendPoint` in types.ts). */
export const ratingIssueTrendPointSchema = z.object({
  day: z.string(),
  count: z.number().int().nonnegative(),
});

/** The distinct entities a fleet issue spans (see `RatingIssueAffected` in types.ts). */
export const ratingIssueAffectedSchema = z.object({
  servers: z.array(z.string()),
  skills: z.array(z.string()),
  tests: z.array(z.string()),
  models: z.array(z.string()),
});

/** The fleet block on a fleet issue (see `RatingIssueFleet` in types.ts) — Observability WP5.1. */
export const ratingIssueFleetSchema = z.object({
  clusterKey: z.string(),
  clusterKeyVersion: z.number().int(),
  lifecycle: z.enum(RATING_ISSUE_LIFECYCLES),
  occurrenceCount: z.number().int().nonnegative(),
  firstSeenAt: z.string(),
  lastSeenAt: z.string(),
  affected: ratingIssueAffectedSchema,
  trend: z.array(ratingIssueTrendPointSchema),
  resolutionNote: z.string().optional(),
  resolvedAt: z.string().optional(),
});

/** One distinct, persistent issue against a skill / MCP server (see `RatingIssue` in types.ts). */
export const ratingIssueSchema = z.object({
  id: z.string(),
  targetKind: z.enum(RATING_ISSUE_TARGET_KINDS),
  targetId: z.string(),
  targetName: z.string(),
  skillVersionId: z.string().optional(),
  title: z.string(),
  summary: z.string(),
  bucket: z.enum(ROOT_CAUSE_BUCKETS),
  fixTarget: z.enum(FIX_TARGETS),
  draftFix: z.string(),
  severity: z.enum(RATING_ISSUE_SEVERITIES),
  status: z.enum(RATING_ISSUE_STATUSES),
  timesSeen: z.number().int().positive(),
  firstSeenAt: z.string(),
  lastSeenAt: z.string(),
  resolvedAt: z.string().optional(),
  ratingVersion: z.number().int(),
  judgeProviderId: z.string().nullable(),
  judgeModel: z.string().nullable(),
  occurrences: z.array(ratingIssueOccurrenceSchema),
  // Fleet aggregation (WP5.1) — present only on a clustered fleet issue; absent on a per-run AR issue.
  fleet: ratingIssueFleetSchema.optional(),
});

/** Body of `PATCH /api/issues/:id` — manual resolve / re-open. */
export const ratingIssueUpdateSchema = z.object({
  status: z.enum(RATING_ISSUE_STATUSES),
});

/**
 * Query of `GET /api/issues` — every filter optional. `runId` filters to issues the run contributed
 * to. The additive fleet filters (WP5.1) narrow to CLUSTERED fleet issues: `lifecycle` matches the
 * fleet lifecycle (implies a fleet issue), and `lastSeenFrom`/`lastSeenTo` bound the last-seen date.
 */
export const ratingIssuesQuerySchema = z.object({
  targetKind: z.enum(RATING_ISSUE_TARGET_KINDS).optional(),
  targetId: z.string().trim().min(1).optional(),
  status: z.enum(RATING_ISSUE_STATUSES).optional(),
  runId: z.string().trim().min(1).optional(),
  lifecycle: z.enum(RATING_ISSUE_LIFECYCLES).optional(),
  lastSeenFrom: z.string().trim().min(1).optional(),
  lastSeenTo: z.string().trim().min(1).optional(),
});

/** Query of `GET /api/issues/export/{markdown,json}` — one concrete target, both required. */
export const ratingIssueExportQuerySchema = z.object({
  targetKind: z.enum(RATING_ISSUE_TARGET_KINDS),
  targetId: z.string().trim().min(1),
});

/** Body of `POST /api/issues/:id/{resolve,ignore,reopen}` — the optional operator note. */
export const issueLifecycleActionSchema = z.object({
  note: z.string().trim().max(2000).optional(),
});

/** Body of `POST /api/issues/sweep` — an optional explicit lower bound (else the stored watermark). */
export const issueSweepRequestSchema = z.object({
  since: z.string().trim().min(1).nullable().optional(),
});

export type RatingIssueUpdateInput = z.infer<typeof ratingIssueUpdateSchema>;
export type RatingIssuesQueryInput = z.infer<typeof ratingIssuesQuerySchema>;
export type RatingIssueExportQueryInput = z.infer<typeof ratingIssueExportQuerySchema>;
export type IssueLifecycleActionInput = z.infer<typeof issueLifecycleActionSchema>;
export type IssueSweepRequestInput = z.infer<typeof issueSweepRequestSchema>;

// --- LLM assist for issue clustering (Observability WP5.2, D-OB20, OPT-IN) ---------------------

/**
 * The SCHEMA-CONSTRAINED assist judge output (mirrors the error-forensics prompt discipline): one
 * pass proposes zero or more merge groups over the shown fleet issues. Each group carries the member
 * `issueIds` (validated against the shown candidates by the service — an invented id is dropped) plus
 * the AI-written `title`/`summary`/`suggestedPriority`/`rationale`. A malformed response fails this
 * parse and the pass degrades safely (skip) — it never corrupts an issue. The API-side wrapper adds
 * the reversible merge-link + `aiAssisted` provenance; this is only the model's raw proposal shape.
 */
export const issueAssistJudgeOutputSchema = z.object({
  groups: z
    .array(
      z.object({
        issueIds: z.array(z.string().trim().min(1)).min(1),
        title: z.string().trim().min(1),
        summary: z.string().trim().min(1),
        suggestedPriority: z.enum(ISSUE_ASSIST_PRIORITIES),
        rationale: z.string().trim().default(""),
      }),
    )
    .default([]),
});

export type IssueAssistJudgeOutput = z.infer<typeof issueAssistJudgeOutputSchema>;

// --- Unified Sessions — session contract (planning/Roadmap/completed/RM-29-unified-sessions/, WP1.1) --------------------
// Zod partners of the `types.ts` session contract. All additive (new exports). `sessionCapabilities-
// Schema` parses the persisted `capabilities_json` (WP1.6); `runEventSchema` is a faithful (loose on
// the heavy `step`/`kpi` payloads) parser for the SSE/replay `RunEvent` union — its `session-contract`
// backward-compat test proves that old persisted events (no `phase`/`ping`/`stopReasonCode`) still
// parse against the additively-extended union.

export const stopReasonCodeSchema = z.enum(STOP_REASON_CODES);
// Observability (WP3.1, D-OB17) — the step-hierarchy span-kind classifier (see {@link SpanKind}).
export const spanKindSchema = z.enum(SPAN_KINDS);
export const runPhaseSchema = z.enum(RUN_PHASES);
export const waitingInputReasonSchema = z.enum(WAITING_INPUT_REASONS);
export const sessionLiveReasoningSchema = z.enum(SESSION_LIVE_REASONING);
export const sessionTokenAccountingSchema = z.enum(SESSION_TOKEN_ACCOUNTING);
export const sessionCostBasisSchema = z.enum(SESSION_COST_BASES);

/** Mirrors {@link SessionCapabilities} — persisted `capabilities_json`, emitted at session start. */
export const sessionCapabilitiesSchema = z.object({
  liveText: z.boolean(),
  liveReasoning: sessionLiveReasoningSchema,
  toolCalls: z.boolean(),
  contextWindow: z.boolean(),
  tokens: sessionTokenAccountingSchema,
  costBasis: sessionCostBasisSchema,
  followUps: z.boolean(),
  askUser: z.boolean(),
  waitBudgetMs: z.number().int().nonnegative().optional(),
});

// The phase-detail bag on the `{type:"phase"}` event (see the `RunEvent` `phase` member in types.ts).
const phaseEventDetailSchema = z.object({
  position: z.number().int().nonnegative().optional(),
  reason: waitingInputReasonSchema.optional(),
  deadlineAt: z.string().optional(),
});

// The predefined-choice shape offered by an `ask_user` `question` (mirrors {@link RunQuestionOption}).
const runQuestionOptionSchema = z.object({
  label: z.string(),
  description: z.string().optional(),
});

/**
 * The full {@link RunEvent} discriminated union as a zod schema (additive/new). Heavy payloads (`step`,
 * `kpi`) are validated on their identifying core and left `.passthrough()` for the many additive
 * optional facets, so it stays a faithful-but-durable parser rather than a second source of truth for
 * every step field. The `seq` intersection mirrors the `& { seq?: number }` on the type.
 */
export const runEventSchema = z
  .discriminatedUnion("type", [
    z.object({
      type: z.literal("status"),
      status: z.enum(RUN_STATUSES),
      outcome: z.enum(RUN_OUTCOMES).optional(),
      stopReason: z.string().optional(),
      stopReasonCode: stopReasonCodeSchema.optional(),
    }),
    z.object({ type: z.literal("rating"), state: ratingStateSchema }),
    z.object({
      type: z.literal("step"),
      step: z
        .object({
          id: z.string(),
          runId: z.string(),
          index: z.number(),
          type: z.string(),
          label: z.string(),
          status: z.enum(["ok", "error", "running"]),
          // Observability (WP3.1) — step-hierarchy metadata, both OPTIONAL/additive (a pre-WP3.1 step
          // carries neither). `.passthrough()` already tolerates them; naming them here documents the
          // wire + validates their shape when present.
          parentStepId: z.string().optional(),
          spanKind: spanKindSchema.optional(),
        })
        .passthrough(),
    }),
    z.object({
      type: z.literal("delta"),
      channel: z.enum(["text", "reasoning"]),
      text: z.string(),
      turnIndex: z.number().int().nonnegative().optional(),
    }),
    z
      .object({
        type: z.literal("kpi"),
        turns: z.number(),
        toolCalls: z.number(),
        tokensIn: z.number(),
        tokensOut: z.number(),
        contextTokens: z.number(),
        costUsd: z.number(),
        costBasis: z.enum(["api_exact", "subscription_reference"]).optional(),
        // RM-33 — the cache composition of `tokensIn` (which stays gross). Omitted when the run has
        // seen no cache slice, so a non-caching backend's event is unchanged.
        cachedTokens: z.number().optional(),
        cacheReadTokens: z.number().optional(),
        cacheWriteTokens: z.number().optional(),
      })
      .passthrough(),
    z.object({
      type: z.literal("error"),
      message: z.string(),
      authRequired: z.boolean().optional(),
      serverIds: z.array(z.string()).optional(),
    }),
    z.object({
      type: z.literal("question"),
      questionId: z.string(),
      prompt: z.string(),
      options: z.array(runQuestionOptionSchema).optional(),
      allowOther: z.boolean().optional(),
    }),
    z.object({
      type: z.literal("question_resolved"),
      questionId: z.string(),
      answer: z.string().nullable(),
    }),
    // Additive (WP1.1) — the two new members.
    // WP1.7 — `phase` additively widened to accept `null` (clears the transient phase back to "no
    // distinct phase"); see the `RunEvent` `phase` member's doc in types.ts.
    z.object({
      type: z.literal("phase"),
      phase: runPhaseSchema.nullable(),
      detail: phaseEventDetailSchema.optional(),
    }),
    z.object({ type: z.literal("ping") }),
  ])
  .and(z.object({ seq: z.number().int().nonnegative().optional() }));

// Mirrors {@link SuiteCell} — validated on its identifying core, `.passthrough()` for additive facets
// (the same treatment `runEventSchema` gives its heavier `step`/`kpi` payloads).
const suiteCellEventSchema = z
  .object({
    testId: z.string(),
    scenarioId: z.string(),
    variantLabel: z.string().optional(),
    repetition: z.number(),
    runId: z.string().optional(),
    status: z.string(),
    score: z.number().nullable().optional(),
  })
  .passthrough();

// Mirrors {@link SuiteAggregates} — same core-validated + passthrough treatment.
const suiteAggregatesEventSchema = z
  .object({
    cellsTotal: z.number(),
    cellsCompleted: z.number(),
    meanGrade: z.number().nullable(),
    gradeStdDev: z.number().nullable(),
    passRateAt05: z.number().nullable(),
    totalTokens: z.number(),
    // RM-33 — absent when ANY member run's split is unknown (a partial sum would understate).
    cacheReadTokens: z.number().optional(),
    cacheWriteTokens: z.number().optional(),
    execCostUsd: z.number(),
    judgeCostUsd: z.number(),
  })
  .passthrough();

/**
 * The full {@link SuiteRunEvent} discriminated union as a zod schema (additive/new, WP2.3). Mirrors
 * `runEventSchema`'s "faithful-but-durable" shape: `cell`/`aggregates` are validated on their
 * identifying core and left `.passthrough()` for additive facets, `status` reuses
 * {@link SUITE_RUN_STATUSES}, `rating` reuses {@link ratingStateSchema}, and the `seq` intersection
 * mirrors `runEventSchema`'s. The new `ping` member (WP2.3, D-US8 follow-up — suite-stream ping parity
 * with {@link runEventSchema}'s `ping`) is additive: every event shape emitted before this WP still
 * parses unchanged (see the `suite-run-event-contract` backward-compat test).
 */
export const suiteRunEventSchema = z
  .discriminatedUnion("type", [
    z.object({ type: z.literal("cell"), cell: suiteCellEventSchema }),
    z.object({ type: z.literal("aggregates"), aggregates: suiteAggregatesEventSchema }),
    z.object({ type: z.literal("status"), status: z.enum(SUITE_RUN_STATUSES) }),
    z.object({ type: z.literal("rating"), state: ratingStateSchema }),
    // WP2.3, D-US8 follow-up — mirrors `runEventSchema`'s `ping` EXACTLY: no payload beyond `type`, no
    // `seq` (see the `seq` intersection below — a keepalive never advances a client's resume cursor).
    z.object({ type: z.literal("ping") }),
  ])
  .and(z.object({ seq: z.number().int().nonnegative().optional() }));

// --- Observability — metrics endpoints (planning/Roadmap/RM-17-observability/, WP1.2, D-OB13/D-OB14) ----------
// Query-param zod for `GET /api/metrics/{runs,scans}`. The RunFilter itself is parsed by the shared
// `parseRunFilterFromQuery` helper (run-filter.ts); these validate the metrics-specific axes on top.

export const metricsBucketSchema = z.enum(METRICS_BUCKETS);
export const runMetricsGroupBySchema = z.enum(RUN_METRICS_GROUP_BY);
export const runMetricsMeasureSchema = z.enum(RUN_METRICS_MEASURES);

/** A comma-joined or repeated `measures=` list → a de-duplicated, validated {@link RunMetricsMeasure}[]. */
export const runMetricsMeasuresSchema = z
  .array(runMetricsMeasureSchema)
  .nonempty("At least one measure is required");

// --- Observability — custom chart composer (planning/Roadmap/RM-17-observability/, WP2.7, D-OB22) ----------------
// `POST /api/dashboard-charts` / `PATCH /api/dashboard-charts/:id` / `POST
// /api/dashboard-charts/reorder`. Reuses the metrics endpoints' OWN vocabulary directly
// (`runMetricsMeasureSchema`/`runMetricsGroupBySchema`/`metricsBucketSchema`, defined just above) and
// the SAME `runFilterSchema` `GET /api/runs`/`GET /api/metrics/runs` apply — a stored config's `filter`
// re-executes identically. The same-unit constraint (a chart's `measures` must all map to ONE unit,
// never a mixed axis like tokens + a USD cost) is enforced by a `superRefine` against the shared
// *_MEASURE_UNITS maps, so the SAME rule is authoritative for both the `runs` and `scans` variants.

export const dashboardChartTypeSchema = z.enum(DASHBOARD_CHART_TYPES);
export const dashboardChartScanMeasureSchema = z.enum(DASHBOARD_CHART_SCAN_MEASURES);

/** Build a `superRefine` that rejects a `measures` array whose members don't all map to ONE unit in
 *  `units` (the same-unit constraint) — the zod issue names the two conflicting measures + their units
 *  so a 400's `issues[]` is actionable, not just "invalid". */
function sameUnitMeasures<M extends string>(
  units: Record<M, string>,
): (measures: M[], ctx: z.RefinementCtx) => void {
  return (measures, ctx) => {
    const firstMeasure = measures[0];
    if (firstMeasure === undefined) return; // `.min(1)` on the array already covers emptiness
    const firstUnit = units[firstMeasure];
    for (const measure of measures) {
      if (units[measure] !== firstUnit) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Mixed units: "${firstMeasure}" (${firstUnit}) and "${measure}" (${units[measure]}) cannot share a chart — same-unit measures only`,
        });
        return;
      }
    }
  };
}

const dashboardChartRunsConfigSchema = z
  .object({
    source: z.literal("runs"),
    measures: z
      .array(runMetricsMeasureSchema)
      .min(1, "At least one measure is required")
      .max(DASHBOARD_CHART_MAX_MEASURES)
      .superRefine(sameUnitMeasures(RUN_METRICS_MEASURE_UNITS)),
    filter: runFilterSchema,
    groupBy: runMetricsGroupBySchema.optional(),
    bucket: metricsBucketSchema,
    chartType: dashboardChartTypeSchema,
  })
  .strict();

const dashboardChartScansConfigSchema = z
  .object({
    source: z.literal("scans"),
    measures: z
      .array(dashboardChartScanMeasureSchema)
      .min(1, "At least one measure is required")
      .max(DASHBOARD_CHART_MAX_MEASURES)
      .superRefine(sameUnitMeasures(DASHBOARD_CHART_SCAN_MEASURE_UNITS)),
    serverId: z.string().trim().min(1).optional(),
    bucket: metricsBucketSchema,
    chartType: dashboardChartTypeSchema,
  })
  .strict();

export const dashboardChartConfigSchema = z.discriminatedUnion("source", [
  dashboardChartRunsConfigSchema,
  dashboardChartScansConfigSchema,
]);

export const dashboardChartInputSchema = z
  .object({
    name: z.string().trim().min(1).max(DASHBOARD_CHART_NAME_MAX_LENGTH),
    config: dashboardChartConfigSchema,
  })
  .strict();

// A real partial update — every field optional; an omitted field keeps its stored value (unlike the
// full-replace `dashboardChartInputSchema`). Never carries `position` — reordering is a SEPARATE call.
export const dashboardChartPatchSchema = z
  .object({
    name: z.string().trim().min(1).max(DASHBOARD_CHART_NAME_MAX_LENGTH).optional(),
    config: dashboardChartConfigSchema.optional(),
  })
  .strict();

// `POST /api/dashboard-charts/reorder` — the FULL current chart id set in the desired order; the
// repository 400s if it isn't EXACTLY the current set (no partial reorder).
export const dashboardChartReorderInputSchema = z
  .object({
    orderedIds: z.array(z.string().trim().min(1)).min(1),
  })
  .strict();

// --- Review queue lite (planning/Roadmap/RM-17-observability/, WP4.5, D-OB22) ----------------------------------
// `POST /api/review-rubrics` / `PATCH /api/review-rubrics/:id`. `.strict()` throughout so an unknown
// key is a ZodError -> 400. Keys are re-validated on every READ too (mirrors run_views/dashboard_charts'
// toPublic discipline) — a stored rubric always re-renders identically.
export const reviewRubricKeyKindSchema = z.enum(REVIEW_RUBRIC_KEY_KINDS);

export const reviewRubricKeyDefSchema = z
  .object({
    key: z.string().trim().min(1).max(REVIEW_RUBRIC_KEY_NAME_MAX_LENGTH),
    description: z.string().trim().min(1).max(REVIEW_RUBRIC_KEY_DESCRIPTION_MAX_LENGTH).optional(),
    kind: reviewRubricKeyKindSchema,
  })
  .strict();

/** At least one key, capped, and — since each key becomes the `run_feedback.key` a reviewer's answer
 *  is written under — unique (case-insensitive) within the rubric; a duplicate would silently collide
 *  writes onto the SAME feedback row. */
const reviewRubricKeysSchema = z
  .array(reviewRubricKeyDefSchema)
  .min(1, "At least one key is required")
  .max(REVIEW_RUBRIC_MAX_KEYS)
  .superRefine((keys, ctx) => {
    const seen = new Set<string>();
    for (const entry of keys) {
      const normalized = entry.key.toLowerCase();
      if (seen.has(normalized)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Duplicate rubric key: "${entry.key}"`,
        });
        return;
      }
      seen.add(normalized);
    }
  });

export const reviewRubricInputSchema = z
  .object({
    name: z.string().trim().min(1).max(REVIEW_RUBRIC_NAME_MAX_LENGTH),
    instructions: z.string().trim().min(1).max(REVIEW_RUBRIC_INSTRUCTIONS_MAX_LENGTH).optional(),
    keys: reviewRubricKeysSchema,
  })
  .strict();

// A real partial update — every field optional; an omitted field keeps its stored value (unlike the
// full-replace `reviewRubricInputSchema`). Supplying `keys` REPLACES the whole array.
export const reviewRubricPatchSchema = z
  .object({
    name: z.string().trim().min(1).max(REVIEW_RUBRIC_NAME_MAX_LENGTH).optional(),
    instructions: z.string().trim().min(1).max(REVIEW_RUBRIC_INSTRUCTIONS_MAX_LENGTH).optional(),
    keys: reviewRubricKeysSchema.optional(),
  })
  .strict();

// ==================================================================================================
// Assistant Hub — zod partners of the types.ts contract (planning/Roadmap/RM-03-assistant-hub/, WP0.1)
// ADDITIVE ONLY (all new exports). The Unified-Sessions schemas declared ABOVE are REUSED verbatim
// (D-AH3): `runPhaseSchema`, `waitingInputReasonSchema`, `stopReasonCodeSchema`,
// `sessionCapabilitiesSchema`, `sessionCostBasisSchema`, and `z.enum(RUN_STATUSES)` — never re-declared.
// `.strict()` guards request-INPUT objects (reject unknown keys); wire event/entity objects stay
// NON-strict so additive fields parse (the same discipline `runEventSchema` uses).
// ==================================================================================================

// --- Enum schemas ---------------------------------------------------------------------------------
export const hubSessionModeSchema = z.enum(HUB_SESSION_MODES);
export const hubSessionKindSchema = z.enum(HUB_SESSION_KINDS);
export const hubTopologySchema = z.enum(HUB_TOPOLOGIES);
export const hubAutonomyLevelSchema = z.enum(HUB_AUTONOMY_LEVELS);
export const hubTitleStateSchema = z.enum(HUB_TITLE_STATES);
export const hubEventTypeSchema = z.enum(HUB_EVENT_TYPES);
/** WP4.2 (D-AH13) — the audit timeline's coarse kind filter (`?kind=`). */
export const hubAuditKindSchema = z.enum(HUB_AUDIT_KINDS);
export const hubToolPartStateSchema = z.enum(HUB_TOOL_PART_STATES);
export const hubToolSourceSchema = z.enum(HUB_TOOL_SOURCES);
export const hubApprovalOptionKindSchema = z.enum(HUB_APPROVAL_OPTION_KINDS);
export const hubApprovalResolutionSchema = z.enum(HUB_APPROVAL_RESOLUTIONS);
export const hubElicitationActionSchema = z.enum(HUB_ELICITATION_ACTIONS);
export const hubElicitationModeSchema = z.enum(HUB_ELICITATION_MODES);
export const hubTaskStatusSchema = z.enum(HUB_TASK_STATUSES);
export const hubMessagePartTypeSchema = z.enum(HUB_MESSAGE_PART_TYPES);
export const hubActorKindSchema = z.enum(HUB_ACTOR_KINDS);
export const hubMissionStatusSchema = z.enum(HUB_MISSION_STATUSES);
export const hubConfidenceSchema = z.enum(HUB_CONFIDENCE_LEVELS);
export const hubArtifactKindSchema = z.enum(HUB_ARTIFACT_KINDS);
export const hubArtifactExportFormatSchema = z.enum(HUB_ARTIFACT_EXPORT_FORMATS);
export const hubReviewStatusSchema = z.enum(HUB_REVIEW_STATUSES);
export const hubReviewCommentDecisionSchema = z.enum(HUB_REVIEW_COMMENT_DECISIONS);
export const hubFileLinkRoleSchema = z.enum(HUB_FILE_LINK_ROLES);
export const hubFileLinkTargetSchema = z.enum(HUB_FILE_LINK_TARGETS);
export const hubWorkspaceChangeKindSchema = z.enum(HUB_WORKSPACE_CHANGE_KINDS);
export const hubMemoryKindSchema = z.enum(HUB_MEMORY_KINDS);
export const hubMemorySourceSchema = z.enum(HUB_MEMORY_SOURCES);
export const hubMemoryStatusSchema = z.enum(HUB_MEMORY_STATUSES);
export const hubLimitRetrySourceSchema = z.enum(HUB_LIMIT_RETRY_SOURCES);
// Assistant Hub UX (planning/Roadmap/completed/RM-04-assistant-hub-ux/, WP0.1) — additive enum schemas (D-HUX8/10/11/16).
export const hubMemoryScopeSchema = z.enum(HUB_MEMORY_SCOPES);
export const hubCrewColorSchema = z.enum(HUB_CREW_COLORS);
export const hubUsageGroupBySchema = z.enum(HUB_USAGE_GROUP_BYS);

// --- Shared value shapes --------------------------------------------------------------------------
export const hubUsageSchema = z.object({
  tokensIn: z.number(),
  tokensOut: z.number(),
  contextTokens: z.number().optional(),
  reasoningTokens: z.number().optional(),
  cacheReadTokens: z.number().optional(),
  cacheWriteTokens: z.number().optional(),
  // hub-fixes WP5.1 (RC5, D-HF2) — provider-native web-search call count for the turn (additive).
  webSearches: z.number().optional(),
});

export const hubCitationSchema = z.object({
  id: z.string(),
  title: z.string(),
  url: z.string().optional(),
  snippet: z.string().optional(),
  toolCallRef: z.string().optional(),
  agentRef: z.string().optional(),
  fileRef: z.string().optional(),
});

export const hubBudgetsSchema = z.object({
  maxTurns: z.number().int().nonnegative().optional(),
  maxTokens: z.number().int().nonnegative().optional(),
  maxToolCalls: z.number().int().nonnegative().optional(),
  maxCostUsd: z.number().nonnegative().optional(),
  maxDurationMs: z.number().int().nonnegative().optional(),
});

export const hubMissionBudgetsSchema = z.object({
  maxAgents: z.number().int().positive().optional(),
  maxParallel: z.number().int().positive().optional(),
  maxCostUsd: z.number().nonnegative().optional(),
  perAgent: hubBudgetsSchema.optional(),
});

export const hubServerToolGrantSchema = z.union([z.literal("all"), z.array(z.string())]);

export const hubToolGrantsSchema = z.object({
  servers: z.record(hubServerToolGrantSchema),
  builtins: z.array(z.string()),
});

export const hubToolAnnotationsSchema = z.object({
  readOnlyHint: z.boolean().optional(),
  destructiveHint: z.boolean().optional(),
  idempotentHint: z.boolean().optional(),
  openWorldHint: z.boolean().optional(),
  title: z.string().optional(),
  icon: z.string().optional(),
});

export const hubToolApprovalSchema = z.object({
  options: z.array(hubApprovalOptionKindSchema),
  grants: z.array(z.string()).optional(),
  isAutomatic: z.boolean().optional(),
  resolution: hubApprovalResolutionSchema.optional(),
  note: z.string().optional(),
});

export const hubToolProgressSchema = z.object({
  progressToken: z.string().optional(),
  progress: z.number().optional(),
  total: z.number().optional(),
  message: z.string().optional(),
  cancellable: z.boolean().optional(),
  cancelled: z.boolean().optional(),
});

export const hubCallMeteringSchema = z.object({
  requestTokens: z.number().optional(),
  responseTokens: z.number().optional(),
  requestBytes: z.number().optional(),
  responseBytes: z.number().optional(),
  durationMs: z.number().optional(),
});

export const hubToolArtifactSchema = z.object({
  kind: z.string(),
  data: z.unknown().optional(),
  text: z.string().optional(),
  mimeType: z.string().optional(),
  spillPath: z.string().optional(),
  fileRef: z.string().optional(),
  artifactRef: z.string().optional(),
});

export const hubToolPartSchema = z.object({
  type: z.literal("tool_call"),
  toolCallId: z.string(),
  toolName: z.string(),
  source: hubToolSourceSchema,
  serverId: z.string().optional(),
  title: z.string().optional(),
  state: hubToolPartStateSchema,
  args: z.unknown().optional(),
  argsText: z.string().optional(),
  annotations: hubToolAnnotationsSchema.optional(),
  approval: hubToolApprovalSchema.optional(),
  progress: hubToolProgressSchema.optional(),
  modelContent: z.unknown().optional(),
  artifact: hubToolArtifactSchema.optional(),
  isError: z.boolean().optional(),
  errorText: z.string().optional(),
  citationIds: z.array(z.string()).optional(),
  metering: hubCallMeteringSchema.optional(),
});

/** The ONE recursive schema — the flat generative-UI catalog node (R-GUI2). `z.lazy` needs the explicit
 *  {@link HubGenUiNode} annotation so the self-reference type-checks. */
export const hubGenUiNodeSchema: z.ZodType<HubGenUiNode> = z.lazy(() =>
  z.object({
    $type: z.string(),
    $key: z.string().optional(),
    props: z.record(z.unknown()).optional(),
    children: z.array(hubGenUiNodeSchema).optional(),
  }),
);

export const hubGenerativeUiPartSchema = z.object({
  type: z.literal("generative-ui"),
  key: z.string().optional(),
  spec: hubGenUiNodeSchema,
  specVersion: z.string().optional(),
  args: z.unknown().optional(),
  argsText: z.string().optional(),
  state: z.unknown().optional(),
});

export const hubTextPartSchema = z.object({ type: z.literal("text"), text: z.string() });
export const hubReasoningPartSchema = z.object({ type: z.literal("reasoning"), text: z.string() });
export const hubCitationPartSchema = z.object({
  type: z.literal("citation"),
  citationId: z.string(),
});

export const hubArtifactRefSchema = z.object({
  artifactId: z.string(),
  versionId: z.string().optional(),
  version: z.number().int().optional(),
  title: z.string().optional(),
});

export const hubArtifactRefPartSchema = z.object({
  type: z.literal("artifact_ref"),
  artifactId: z.string(),
  versionId: z.string().optional(),
  version: z.number().int().optional(),
  title: z.string().optional(),
});

/** The ordered typed message-part union (R-SES2) — a discriminated union on `type`. */
export const hubMessagePartSchema = z.discriminatedUnion("type", [
  hubTextPartSchema,
  hubReasoningPartSchema,
  hubToolPartSchema,
  hubCitationPartSchema,
  hubArtifactRefPartSchema,
  hubGenerativeUiPartSchema,
]);

export const hubMessageVariantRefSchema = z.object({
  variantGroupId: z.string(),
  variantIndex: z.number().int().nonnegative(),
  variantCount: z.number().int().nonnegative().optional(),
});

export const hubBranchRefSchema = z.object({
  branchSessionId: z.string(),
  fromSessionId: z.string(),
  fromSeq: z.number().int().nonnegative().optional(),
  fromMessageId: z.string().optional(),
  label: z.string().optional(),
});

export const hubTaskItemSchema = z.object({
  id: z.string(),
  title: z.string(),
  status: hubTaskStatusSchema,
  dependsOn: z.array(z.string()).optional(),
  note: z.string().optional(),
});

// --- Structured agent report (D-AH9) --------------------------------------------------------------
export const hubAgentFindingSchema = z.object({
  summary: z.string(),
  detail: z.string().optional(),
  citationIds: z.array(z.string()).optional(),
  confidence: hubConfidenceSchema.optional(),
});

// Crew nesting (WP0.1 / D-CN5) — the recursive up-flow envelope. `z.lazy` + the explicit
// `z.ZodType<HubAgentReport>` annotation lets `childReports` self-reference (exactly the
// `hubGenUiNodeSchema` precedent). Additive: a flat report simply omits
// `subMissionId`/`topology`/`childReports`/`depth`. Nothing calls `.shape`/`.extend`/`.pick` on this
// schema, and it stays the same exported `z.ZodType`, so the `agent_report` event keeps working.
export const hubAgentReportSchema: z.ZodType<HubAgentReport> = z.lazy(() =>
  z.object({
    agentSessionId: z.string().optional(),
    roleName: z.string().optional(),
    summary: z.string().optional(),
    findings: z.array(hubAgentFindingSchema),
    citations: z.array(hubCitationSchema),
    artifacts: z.array(hubArtifactRefSchema),
    confidence: hubConfidenceSchema,
    openQuestions: z.array(z.string()),
    subMissionId: z.string().optional(),
    topology: hubTopologySchema.optional(),
    childReports: z.array(hubAgentReportSchema).optional(),
    depth: z.number().int().optional(),
  }),
);

// --- Skills for the hub (WP2.4, R-SK1…R-SK6/R-SK8) -------------------------------------------------
export const hubSkillInvocationModeSchema = z.enum(HUB_SKILL_INVOCATION_MODES);

// The write shape for a session/role skill attachment (§ HubSkillAttachmentInput). `versionMode`
// defaults to "latest" and `invocationMode` to "model_invocable" when omitted — the SAME
// pinned-requires-pinnedVersionId discipline as `allowedSkillSchema` (attachment parity, R-SK8).
export const hubSkillAttachmentInputSchema = z
  .object({
    skillId: z.string().trim().min(1),
    versionMode: skillVersionModeSchema.default("latest"),
    pinnedVersionId: z.string().trim().min(1).optional(),
    invocationMode: hubSkillInvocationModeSchema.default("model_invocable"),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.versionMode === "pinned" && !value.pinnedVersionId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["pinnedVersionId"],
        message: "Pin a version or choose latest",
      });
    }
  });

// Model identity (D-MI1, `planning/Roadmap/RM-16-model-identity/`) — the `provider_credentials` id a chosen model runs
// on. Adding it to the `.strict()` input schemas is MANDATORY, not cosmetic: a strict schema REJECTS an
// unknown key with a 400, so the field could not be sent at all without this. `hubPlannedAgentSchema` is
// a stripping `z.object` instead, where the failure is worse because it is silent — the same D-CN5
// silent-strip trap `hubCrewMemberSchema`'s `.strict()` was added for. See `HubProviderCredentialId`.
const hubProviderCredentialIdSchema = z.string().trim().min(1);

// --- Roles + crews (D-AH7) ------------------------------------------------------------------------
export const hubAgentRoleSchema = z.object({
  id: z.string(),
  name: z.string(),
  // WP0.1 (D-HUX8, P2) — optional persona name; the avatar reuses the existing `icon` field.
  displayName: z.string().optional(),
  description: z.string().optional(),
  icon: z.string().optional(),
  systemPrompt: z.string(),
  defaultModel: z.string(),
  providerCredentialId: hubProviderCredentialIdSchema.nullable().optional(),
  toolGrants: hubToolGrantsSchema,
  skills: z.array(hubSkillAttachmentInputSchema),
  target: z.string(),
  expectedOutcome: z.string(),
  budgets: hubBudgetsSchema.optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  archivedAt: z.string().nullable().optional(),
});

export const hubAgentRoleInputSchema = z
  .object({
    name: z.string().trim().min(1).max(HUB_AGENT_NAME_MAX_LENGTH),
    displayName: z.string().trim().max(HUB_AGENT_NAME_MAX_LENGTH).optional(),
    description: z.string().optional(),
    icon: z.string().max(HUB_ICON_MAX_LENGTH).optional(),
    systemPrompt: z.string().min(1),
    defaultModel: z.string().min(1),
    providerCredentialId: hubProviderCredentialIdSchema.optional(),
    toolGrants: hubToolGrantsSchema.optional(),
    skills: z.array(hubSkillAttachmentInputSchema).optional(),
    target: z.string().min(1),
    expectedOutcome: z.string().min(1),
    budgets: hubBudgetsSchema.optional(),
  })
  .strict();

export const hubAgentRolePatchSchema = z
  .object({
    name: z.string().trim().min(1).max(HUB_AGENT_NAME_MAX_LENGTH).optional(),
    // `null` clears the persona name back to the role-title fallback.
    displayName: z.string().trim().max(HUB_AGENT_NAME_MAX_LENGTH).nullable().optional(),
    description: z.string().nullable().optional(),
    icon: z.string().max(HUB_ICON_MAX_LENGTH).nullable().optional(),
    systemPrompt: z.string().min(1).optional(),
    defaultModel: z.string().min(1).optional(),
    // `null` explicitly UNPINS the credential (back to the heuristic); absent = no change.
    providerCredentialId: hubProviderCredentialIdSchema.nullable().optional(),
    toolGrants: hubToolGrantsSchema.optional(),
    skills: z.array(hubSkillAttachmentInputSchema).optional(),
    target: z.string().min(1).optional(),
    expectedOutcome: z.string().min(1).optional(),
    budgets: hubBudgetsSchema.nullable().optional(),
    archived: z.boolean().optional(),
  })
  .strict();

// Crew nesting (WP0.1 / D-CN5) — a member references EXACTLY ONE of an agent role (`agentId`) or a
// NESTED saved crew (`crewId`). `.strict()` is load-bearing: the member is a stripping `z.object` today,
// so without it a `crewId` would be silently dropped on write-then-read (the D-CN5 silent-strip trap).
// The `.superRefine` enforces exactly-one (the `hubSkillAttachmentInputSchema` "exactly one" precedent),
// so every stored `{agentId}` member still validates (wire-additive, not an `/api/v2` break).
export const hubCrewMemberSchema = z
  .object({
    agentId: z.string().optional(),
    crewId: z.string().optional(),
    model: z.string().optional(),
    providerCredentialId: hubProviderCredentialIdSchema.optional(),
    systemPromptOverride: z.string().optional(),
    toolGrants: hubToolGrantsSchema.optional(),
    skillIds: z.array(z.string()).optional(),
    target: z.string().optional(),
    expectedOutcome: z.string().optional(),
    budgets: hubBudgetsSchema.optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const hasAgent = value.agentId !== undefined;
    const hasCrew = value.crewId !== undefined;
    if (hasAgent === hasCrew) {
      const message =
        "A crew member must reference exactly one of an agent (agentId) or a nested crew (crewId).";
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["agentId"], message });
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["crewId"], message });
    }
  });

export const hubCrewSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  // WP0.1 (D-HUX8) — optional theme-aware accent (`--chart-1…5`); absent ⇒ no explicit accent.
  color: hubCrewColorSchema.optional(),
  // Optional avatar icon (owner request) — same encoding as the role `icon` (lucide/data-URI/none).
  icon: z.string().max(HUB_ICON_MAX_LENGTH).optional(),
  topology: hubTopologySchema,
  members: z.array(hubCrewMemberSchema),
  createdAt: z.string(),
  updatedAt: z.string(),
  // Crew nesting (WP0.1 / D-CN5) — computed-on-read crew-summary counts (the `ServerType.memberCount`
  // precedent): READ shape only (NOT input/patch, which stay `.strict()` write shapes). Populated by
  // WP1.1; absent otherwise.
  memberCrewIds: z.array(z.string()).optional(),
  memberAgentCount: z.number().int().optional(),
  memberCrewCount: z.number().int().optional(),
  totalAgentCount: z.number().int().optional(),
});

export const hubCrewInputSchema = z
  .object({
    name: z.string().trim().min(1).max(HUB_CREW_NAME_MAX_LENGTH),
    description: z.string().optional(),
    color: hubCrewColorSchema.optional(),
    icon: z.string().max(HUB_ICON_MAX_LENGTH).optional(),
    topology: hubTopologySchema,
    members: z.array(hubCrewMemberSchema),
  })
  .strict();

export const hubCrewPatchSchema = z
  .object({
    name: z.string().trim().min(1).max(HUB_CREW_NAME_MAX_LENGTH).optional(),
    description: z.string().nullable().optional(),
    // `null` clears the accent back to no explicit color.
    color: hubCrewColorSchema.nullable().optional(),
    // `null` clears the icon back to the default (member-strip / no explicit icon).
    icon: z.string().max(HUB_ICON_MAX_LENGTH).nullable().optional(),
    topology: hubTopologySchema.optional(),
    members: z.array(hubCrewMemberSchema).optional(),
  })
  .strict();

// --- Missions (D-AH6 / D-AH8 / D-AH9) -------------------------------------------------------------
export const hubPlannedAgentSchema = z.object({
  key: z.string(),
  roleId: z.string().optional(),
  name: z.string(),
  systemPrompt: z.string(),
  model: z.string(),
  // Model identity (D-MI1) — carried across the parent->child spawn so a mission child never re-guesses
  // its provider. This schema STRIPS unknown keys, so omitting it here would drop the pin silently.
  providerCredentialId: hubProviderCredentialIdSchema.optional(),
  toolGrants: hubToolGrantsSchema,
  skillIds: z.array(z.string()),
  brief: z.string(),
  target: z.string(),
  expectedOutcome: z.string(),
  budgets: hubBudgetsSchema.optional(),
  rationale: z.string().optional(),
  estimatedCostUsd: z.number().optional(),
  // Crew nesting (WP0.1 / D-CN5) — set when this plan element expands a nested saved crew; read in WP2.1.
  crewId: z.string().optional(),
});

export const hubMissionPlanSchema = z.object({
  topology: hubTopologySchema,
  autonomy: hubAutonomyLevelSchema,
  agents: z.array(hubPlannedAgentSchema),
  rationale: z.string().optional(),
  estimatedCostUsd: z.number().optional(),
  budgets: hubMissionBudgetsSchema.optional(),
  // hub-fixes WP4.4 (D-HF3) — debate round count (openings + rebuttal rounds); 1..3, default 2 at runtime.
  debateRounds: z.number().int().min(1).max(3).optional(),
});

export const hubMissionSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  status: hubMissionStatusSchema,
  topology: hubTopologySchema,
  autonomy: hubAutonomyLevelSchema,
  plan: hubMissionPlanSchema,
  budgets: hubMissionBudgetsSchema.optional(),
  costUsd: z.number().optional(),
  agentSessionIds: z.array(z.string()),
  startedAt: z.string().nullable().optional(),
  endedAt: z.string().nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  // Crew nesting (WP0.1 / D-CN5) — the parent mission that spawned this one (absent on a root) + depth
  // from the root (root = 0). Additive response-only fields.
  parentMissionId: z.string().optional(),
  depth: z.number().int().optional(),
});

// --- Projects (D-AH11c) ---------------------------------------------------------------------------
export const hubProjectSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable().optional(),
  instructions: z.string().nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  archivedAt: z.string().nullable().optional(),
});

export const hubProjectInputSchema = z
  .object({
    name: z.string().trim().min(1).max(HUB_PROJECT_NAME_MAX_LENGTH),
    description: z.string().optional(),
    instructions: z.string().optional(),
  })
  .strict();

export const hubProjectPatchSchema = z
  .object({
    name: z.string().trim().min(1).max(HUB_PROJECT_NAME_MAX_LENGTH).optional(),
    description: z.string().nullable().optional(),
    instructions: z.string().nullable().optional(),
    archived: z.boolean().optional(),
  })
  .strict();

// --- Sessions (§1.2 — Unified-Sessions lifecycle REUSED) -----------------------------------------

/** End-user UX pass — the saved Agents & Crews scoped into a session (a preferred pool for the mission
 *  planner). Both arrays default to empty so a partial `{}` still parses. See `HubSessionRoster`. */
export const hubSessionRosterSchema = z
  .object({
    crewIds: z.array(z.string()).default([]),
    agentIds: z.array(z.string()).default([]),
  })
  .strict();

export const hubSessionSchema = z.object({
  id: z.string(),
  projectId: z.string().nullable().optional(),
  kind: hubSessionKindSchema,
  parentSessionId: z.string().nullable().optional(),
  missionId: z.string().nullable().optional(),
  title: z.string(),
  titleState: hubTitleStateSchema,
  mode: hubSessionModeSchema,
  topology: hubTopologySchema.optional(),
  autonomy: hubAutonomyLevelSchema.optional(),
  crewId: z.string().nullable().optional(),
  model: z.string(),
  // Unified-Sessions contract, REUSED verbatim (D-AH3):
  status: z.enum(RUN_STATUSES),
  phase: runPhaseSchema.nullable().optional(),
  stopReasonCode: stopReasonCodeSchema.optional(),
  capabilities: sessionCapabilitiesSchema.optional(),
  budgets: hubBudgetsSchema.optional(),
  promptVersion: z.string().optional(),
  // End-user UX pass — the session's MCP tool scope (null/absent ⇒ auto/all-reachable + tool_search).
  toolScope: hubToolGrantsSchema.nullable().optional(),
  // End-user UX pass — the session's Agents & Crews roster (a preferred pool for the mission planner).
  roster: hubSessionRosterSchema.nullable().optional(),
  costUsd: z.number(),
  tokensIn: z.number(),
  tokensOut: z.number(),
  // WP0.1 (D-HUX4, P4) — additive session-list stat fields + the archive flag (all optional so an old
  // session payload still parses; the API populates them in WP1.4).
  turns: z.number().int().nonnegative().optional(),
  lastError: z.string().nullable().optional(),
  archived: z.boolean().optional(),
  activeDurationMs: z.number().int().nonnegative().optional(),
  totalDurationMs: z.number().int().nonnegative().optional(),
  waitDeadlineAt: z.string().nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  endedAt: z.string().nullable().optional(),
  seen: z.boolean(),
});

export const hubSessionCreateInputSchema = z
  .object({
    mode: hubSessionModeSchema,
    model: z.string().min(1),
    providerCredentialId: hubProviderCredentialIdSchema.optional(),
    projectId: z.string().optional(),
    title: z.string().trim().min(1).max(HUB_SESSION_TITLE_MAX_LENGTH).optional(),
    topology: hubTopologySchema.optional(),
    autonomy: hubAutonomyLevelSchema.optional(),
    crewId: z.string().optional(),
    // End-user UX pass — optional pre-configuration set once in the new-session modal (both absent ⇒
    // the Claude-Desktop default: all reachable servers via tool_search + the full skill registry).
    toolScope: hubToolGrantsSchema.optional(),
    skills: z.array(hubSkillAttachmentInputSchema).optional(),
    // End-user UX pass — optional Agents & Crews roster (the new-session modal's "Agents & Crews" tab).
    roster: hubSessionRosterSchema.optional(),
  })
  .strict();

export const hubSessionPatchSchema = z
  .object({
    title: z.string().trim().min(1).max(HUB_SESSION_TITLE_MAX_LENGTH).optional(),
    model: z.string().min(1).optional(),
    // Absent = no change; null = explicitly unpin (back to the heuristic). Mirrors `toolScope`/`roster`.
    providerCredentialId: hubProviderCredentialIdSchema.nullable().optional(),
    autonomy: hubAutonomyLevelSchema.optional(),
    // WP0.1 (P4) — archive/unarchive from the Sessions table overflow menu (no hard delete).
    archived: z.boolean().optional(),
    // hub-fixes WP1.2 (RC3) — edit the MCP tool scope after create. Absent = no change; null = clear
    // back to auto; an object = replace the scope.
    toolScope: hubToolGrantsSchema.nullable().optional(),
    // End-user UX pass — edit the Agents & Crews roster after create. Absent = no change; null = clear
    // to none; an object = replace it.
    roster: hubSessionRosterSchema.nullable().optional(),
    // hub-fixes WP6.2 (RC7) — switch the session's MODE from the composer's own mode chip (mirrors
    // `toolScope`'s absent-means-no-change convention; there is no "clear" value here — `mode` is
    // always one of the four `HUB_SESSION_MODES`, never null). The API route layers a running-mission
    // guard on top of this (mission<->auto is refused while a mission is still in flight); the schema
    // itself just validates the value is a real mode.
    mode: hubSessionModeSchema.optional(),
  })
  .strict();

export const hubSendMessageInputSchema = z
  .object({
    text: z.string(),
    model: z.string().optional(),
    providerCredentialId: hubProviderCredentialIdSchema.optional(),
    attachmentFileIds: z.array(z.string()).optional(),
    // WP3.3 / R-SES8 — a user directive that aims any compaction this turn triggers.
    compactionAim: z.string().trim().min(1).max(2000).optional(),
    // End-user UX pass — saved agents `@`-mentioned in the composer (hub_agents ids) → team handoff.
    mentionedAgentIds: z.array(z.string().trim().min(1)).optional(),
  })
  .strict();

/**
 * `POST /api/hub/sessions/:id/mission` body — see {@link HubMissionProposeInput}. Stays `.strict()`
 * (which is exactly why the composer's dropped `model` could not simply be added at the call site:
 * an extra field is a 400, not an ignored key). model-identity WP6.1 (F7) added `model` +
 * `providerCredentialId`, additively.
 */
export const hubMissionProposeInputSchema = z
  .object({
    text: z.string().trim().min(1),
    crewId: z.string().trim().min(1).optional(),
    model: z.string().trim().min(1).optional(),
    providerCredentialId: hubProviderCredentialIdSchema.optional(),
  })
  .strict();

// PUT /api/hub/sessions/:id/skills body (WP2.4) — replace-then-reinsert, mirrors `replaceSkills`'s
// scenario-attachment upsert. `[]` is a valid, meaningful body (detach every skill).
export const hubSessionSkillsInputSchema = z.array(hubSkillAttachmentInputSchema);

export const hubSessionSummarySchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  uptoSeq: z.number().int().nonnegative(),
  content: z.string(),
  tokens: z.number().int().nonnegative(),
  createdAt: z.string(),
});

// --- Artifacts + reviews + files + memory (D-AH12 / D-AH11a) --------------------------------------
export const hubArtifactVersionSchema = z.object({
  id: z.string(),
  artifactId: z.string(),
  version: z.number().int().positive(),
  content: z.string(),
  note: z.string().optional(),
  authorKind: hubActorKindSchema,
  authorRef: z.string().optional(),
  createdAt: z.string(),
});

export const hubArtifactSchema = z.object({
  id: z.string(),
  sessionId: z.string().nullable().optional(),
  projectId: z.string().nullable().optional(),
  kind: hubArtifactKindSchema,
  title: z.string(),
  latestVersion: z.number().int().nonnegative(),
  currentVersionId: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const hubReviewAnchorSchema = z.object({
  quote: z.string().optional(),
  startOffset: z.number().int().nonnegative().optional(),
  endOffset: z.number().int().nonnegative().optional(),
  startLine: z.number().int().nonnegative().optional(),
  endLine: z.number().int().nonnegative().optional(),
});

export const hubReviewCommentSchema = z.object({
  id: z.string(),
  anchor: hubReviewAnchorSchema.optional(),
  body: z.string(),
  suggestedEdit: z.string().optional(),
  decision: hubReviewCommentDecisionSchema,
  authorKind: hubActorKindSchema,
  authorRef: z.string().optional(),
  createdAt: z.string(),
});

export const hubReviewSchema = z.object({
  id: z.string(),
  artifactId: z.string(),
  baseVersion: z.number().int().nonnegative(),
  status: hubReviewStatusSchema,
  reviewerKind: hubActorKindSchema,
  reviewerRef: z.string().optional(),
  comments: z.array(hubReviewCommentSchema),
  createdAt: z.string(),
  updatedAt: z.string(),
});

// The response of `PATCH /api/hub/reviews/:id` (WP3.5) — see `HubReviewDecisionResult`'s own doc.
export const hubReviewDecisionResultSchema = z.object({
  review: hubReviewSchema,
  resultingVersion: hubArtifactVersionSchema.optional(),
});

export const hubFileSchema = z.object({
  id: z.string(),
  sha256: z.string(),
  mime: z.string(),
  bytes: z.number().int().nonnegative(),
  filename: z.string().optional(),
  createdAt: z.string(),
});

export const hubFileLinkSchema = z.object({
  id: z.string(),
  fileId: z.string(),
  role: hubFileLinkRoleSchema,
  targetKind: hubFileLinkTargetSchema,
  targetId: z.string(),
  createdAt: z.string(),
});

// POST /api/hub/projects/:id/files body (WP3.1, D-AH11c) — a pinned TEXT snippet (see
// `HUB_PINNED_FILE_MAX_BYTES`'s doc for why this is narrower than the general upload surface).
export const hubProjectPinnedFileInputSchema = z
  .object({
    filename: z.string().trim().min(1).max(HUB_PINNED_FILE_FILENAME_MAX_LENGTH),
    content: z.string().trim().min(1).max(HUB_PINNED_FILE_MAX_BYTES),
  })
  .strict();

/** WP3.4 (R-SES6) — GET .../workspace/snapshots list item. */
export const hubWorkspaceSnapshotSchema = z.object({
  id: z.string(),
  label: z.string().optional(),
  createdAt: z.string(),
  fileCount: z.number().int().nonnegative(),
  totalBytes: z.number().int().nonnegative(),
});

/** WP3.4 (R-MCP9) — GET .../resources list item (the currently-attached, event-reconstructed set). */
export const hubResourceAttachmentSchema = z.object({
  id: z.string(),
  serverId: z.string(),
  serverName: z.string().optional(),
  uri: z.string(),
  name: z.string(),
  title: z.string().optional(),
  description: z.string().optional(),
  mimeType: z.string().optional(),
  audience: z.array(z.string()).optional(),
  priority: z.number().optional(),
  lastModified: z.string().optional(),
  tokens: z.number().optional(),
  attachedAt: z.string(),
});

/** WP3.4 (R-MCP9) — POST .../resources request body: the picker already has the resource's descriptor
 *  (from a scanned or live `resources/list`), so the server re-fetches + measures rather than trusting
 *  client-supplied metadata for `tokens`. */
export const hubResourceAttachInputSchema = z
  .object({
    serverId: z.string().trim().min(1),
    uri: z.string().trim().min(1),
  })
  .strict();

export const hubMemorySchema = z.object({
  id: z.string(),
  kind: hubMemoryKindSchema,
  content: z.string(),
  source: hubMemorySourceSchema,
  status: hubMemoryStatusSchema,
  // WP0.1 (D-HUX11) — additive scope; absent ⇒ `profile` (WP1.5 migration backfills legacy rows).
  scope: hubMemoryScopeSchema.optional(),
  scopeId: z.string().nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const hubMemoryInputSchema = z
  .object({
    kind: hubMemoryKindSchema,
    content: z.string().trim().min(1),
    // Optional on the wire — the API defaults an omitted scope to `profile` (WP1.5).
    scope: hubMemoryScopeSchema.optional(),
    scopeId: z.string().optional(),
  })
  .strict();

export const hubMemoryPatchSchema = z
  .object({
    content: z.string().trim().min(1).optional(),
    status: hubMemoryStatusSchema.optional(),
    // WP2.7 (D-HUX11) — an accept/edit MAY also move the row to a different scope (the save-proposal's
    // scope picker). Additive/optional; omitted ⇒ scope unchanged.
    scope: hubMemoryScopeSchema.optional(),
    scopeId: z.string().optional(),
  })
  .strict();

// --- Effective memory (planning/Roadmap/completed/RM-04-assistant-hub-ux/, WP1.5 → WP2.7 promotion, D-HUX11) ---------------
// Mirrors the shared TS shapes in `types.ts` exactly — see that file's section doc for the reasoning.

export const hubEffectiveMemoryEntrySchema = z.object({
  id: z.string(),
  kind: hubMemoryKindSchema,
  content: z.string(),
  source: hubMemorySourceSchema,
  status: hubMemoryStatusSchema,
  scope: hubMemoryScopeSchema,
  scopeId: z.string().nullable(),
  ownerName: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const hubEffectiveMemoryOverrideSchema = hubEffectiveMemoryEntrySchema.extend({
  overriddenByScope: hubMemoryScopeSchema,
  overriddenById: z.string(),
});

export const hubEffectiveMemoryLayerSummarySchema = z.object({
  scope: hubMemoryScopeSchema,
  scopeId: z.string().nullable(),
  ownerName: z.string().optional(),
  activeCount: z.number().int().nonnegative(),
  overriddenCount: z.number().int().nonnegative(),
});

export const hubEffectiveMemorySchema = z.object({
  order: z.array(hubMemoryScopeSchema),
  entries: z.array(hubEffectiveMemoryEntrySchema),
  overridden: z.array(hubEffectiveMemoryOverrideSchema),
  layers: z.array(hubEffectiveMemoryLayerSummarySchema),
  totalActive: z.number().int().nonnegative(),
});

// --- Events (§1.3 CLOSED union, append-only) ------------------------------------------------------
// The phase-detail bag mirrors the Unified-Sessions phase-event detail (`reason` is a WaitingInputReason).
export const hubPhaseEventDetailSchema = z.object({
  position: z.number().int().nonnegative().optional(),
  reason: waitingInputReasonSchema.optional(),
  deadlineAt: z.string().optional(),
});

/**
 * The full closed hub event union (§1.3) as a discriminated union on `type`, intersected with the
 * `{ seq?, at? }` envelope (mirrors `runEventSchema`'s `& { seq? }`). Wire objects stay NON-strict so
 * additive fields parse. Members are the execution-plan §1.3 sketch PLUS `queued_user_message` (R-SES3)
 * and `ui_state` (R-GUI5), which the requirements-annex WP-impact map mandates for WP0.1.
 */
export const hubEventSchema = z
  .discriminatedUnion("type", [
    z.object({
      type: z.literal("user_message"),
      messageId: z.string(),
      text: z.string(),
      model: z.string().optional(),
      attachmentFileIds: z.array(z.string()).optional(),
    }),
    z.object({
      type: z.literal("queued_user_message"),
      queuedMessageId: z.string(),
      text: z.string(),
      model: z.string().optional(),
      // model-identity WP6.1 (F4) — the credential REQUESTED alongside the queued `model` override. A
      // record of the ask; the running turn's resolution is already fixed when the queue drains.
      providerCredentialId: hubProviderCredentialIdSchema.optional(),
      attachmentFileIds: z.array(z.string()).optional(),
    }),
    z.object({
      type: z.literal("assistant_message"),
      messageId: z.string(),
      model: z.string(),
      parts: z.array(hubMessagePartSchema),
      usage: hubUsageSchema.optional(),
      citations: z.array(hubCitationSchema),
      artifactsTouched: z.array(hubArtifactRefSchema),
      promptVersion: z.string().optional(),
      costUsd: z.number().optional(),
      costBasis: sessionCostBasisSchema.optional(),
      finishReason: z.string().optional(),
      variant: hubMessageVariantRefSchema.optional(),
    }),
    z.object({
      type: z.literal("reasoning"),
      messageId: z.string().optional(),
      text: z.string(),
    }),
    z.object({
      type: z.literal("tool_call"),
      messageId: z.string().optional(),
      part: hubToolPartSchema,
    }),
    z.object({
      type: z.literal("tool_result"),
      toolCallId: z.string(),
      state: z.enum(["output-available", "output-error", "output-denied"]),
      modelContent: z.unknown().optional(),
      artifact: hubToolArtifactSchema.optional(),
      isError: z.boolean().optional(),
      errorText: z.string().optional(),
      citations: z.array(hubCitationSchema).optional(),
      metering: hubCallMeteringSchema.optional(),
    }),
    z.object({
      type: z.literal("ui_state"),
      messageId: z.string(),
      key: z.string().optional(),
      state: z.unknown(),
      source: hubActorKindSchema.optional(),
      specVersion: z.string().optional(),
    }),
    z.object({
      type: z.literal("phase"),
      phase: runPhaseSchema.nullable(),
      detail: hubPhaseEventDetailSchema.optional(),
    }),
    z.object({
      type: z.literal("turn_done"),
      messageId: z.string().optional(),
      usage: hubUsageSchema.optional(),
      costUsd: z.number().optional(),
      costBasis: sessionCostBasisSchema.optional(),
    }),
    z.object({
      type: z.literal("plan_proposed"),
      missionId: z.string(),
      plan: hubMissionPlanSchema,
      // Crew nesting (WP3.1 / D-CN7, R-SES1) — parent-linkage for a nested sub-mission's plan_proposed;
      // absent on the root's (⇒ every pre-existing event still validates — additive, no /api/v2).
      parentMissionId: z.string().optional(),
      parentAgentKey: z.string().optional(),
    }),
    z.object({
      type: z.literal("plan_updated"),
      missionId: z.string(),
      plan: hubMissionPlanSchema,
      editedBy: hubActorKindSchema.optional(),
    }),
    z.object({
      type: z.literal("plan_approved"),
      missionId: z.string(),
      autonomy: hubAutonomyLevelSchema.optional(),
      approvedBy: hubActorKindSchema.optional(),
      auto: z.boolean().optional(),
    }),
    z.object({
      type: z.literal("mission_started"),
      missionId: z.string(),
      agentSessionIds: z.array(z.string()),
    }),
    z.object({
      type: z.literal("agent_spawned"),
      missionId: z.string(),
      agentSessionId: z.string(),
      key: z.string(),
      roleName: z.string(),
      model: z.string(),
      brief: z.string().optional(),
      index: z.number().int().nonnegative().optional(),
      // Crew nesting (WP3.1 / D-CN7) — the belt-and-suspenders parent-linkage MIRROR (see the type).
      parentMissionId: z.string().optional(),
      parentAgentKey: z.string().optional(),
    }),
    z.object({
      type: z.literal("agent_report"),
      missionId: z.string(),
      agentSessionId: z.string(),
      report: hubAgentReportSchema,
      // hub-fixes WP2.4 — the agent's real accumulated cost/tokens; see the type's own doc.
      costUsd: z.number().optional(),
      tokensIn: z.number().optional(),
      tokensOut: z.number().optional(),
    }),
    z.object({
      type: z.literal("mission_synthesis"),
      missionId: z.string(),
      messageId: z.string().optional(),
      partial: z.boolean().optional(),
      agentReportRefs: z.array(z.string()).optional(),
    }),
    // assistant-hub v1-fixes (F2/F7) — the mission's model-visible digest + structured follow-ups.
    z.object({
      type: z.literal("mission_digest"),
      missionId: z.string(),
      text: z.string(),
      agentReportRefs: z.array(z.string()).optional(),
    }),
    z.object({
      type: z.literal("mission_followups"),
      missionId: z.string(),
      followups: z.array(
        z.object({
          question: z.string(),
          agentSessionId: z.string().optional(),
          roleName: z.string().optional(),
        }),
      ),
    }),
    // hub-fixes WP2.5 (D-HF6) — a mission child agent's gated tool call mirrored to the board queue.
    z.object({
      type: z.literal("agent_approval_requested"),
      missionId: z.string(),
      agentSessionId: z.string(),
      roleName: z.string().optional(),
      toolCallId: z.string(),
      toolName: z.string(),
      source: hubToolSourceSchema,
      serverId: z.string().optional(),
      annotations: hubToolAnnotationsSchema.optional(),
      options: z.array(hubApprovalOptionKindSchema),
    }),
    z.object({
      type: z.literal("agent_approval_responded"),
      missionId: z.string(),
      agentSessionId: z.string(),
      toolCallId: z.string(),
      resolution: hubApprovalResolutionSchema,
      reason: z.enum(["decided", "timeout"]),
    }),
    z.object({
      type: z.literal("artifact_created"),
      artifactId: z.string(),
      kind: hubArtifactKindSchema,
      title: z.string(),
      versionId: z.string(),
      version: z.number().int().positive(),
    }),
    z.object({
      type: z.literal("artifact_updated"),
      artifactId: z.string(),
      versionId: z.string(),
      version: z.number().int().positive(),
      note: z.string().optional(),
    }),
    z.object({
      type: z.literal("review_opened"),
      reviewId: z.string(),
      artifactId: z.string(),
      baseVersion: z.number().int().nonnegative(),
    }),
    z.object({
      type: z.literal("review_decided"),
      reviewId: z.string(),
      artifactId: z.string(),
      status: hubReviewStatusSchema.optional(),
      commentId: z.string().optional(),
      decision: hubReviewCommentDecisionSchema.optional(),
      resultingVersionId: z.string().optional(),
      resultingVersion: z.number().int().positive().optional(),
    }),
    z.object({
      type: z.literal("memory_proposed"),
      memoryId: z.string().optional(),
      kind: hubMemoryKindSchema,
      content: z.string(),
      // WP0.1 (D-HUX11) — the scope an assistant save-proposal targets; absent ⇒ `profile`.
      scope: hubMemoryScopeSchema.optional(),
      scopeId: z.string().nullable().optional(),
    }),
    z.object({
      type: z.literal("memory_saved"),
      memoryId: z.string(),
      kind: hubMemoryKindSchema,
      content: z.string(),
      source: hubMemorySourceSchema,
      scope: hubMemoryScopeSchema.optional(),
      scopeId: z.string().nullable().optional(),
    }),
    z.object({
      type: z.literal("file_uploaded"),
      fileId: z.string(),
      filename: z.string().optional(),
      mime: z.string(),
      bytes: z.number().int().nonnegative(),
      role: hubFileLinkRoleSchema.optional(),
    }),
    z.object({
      type: z.literal("workspace_file_changed"),
      path: z.string(),
      change: hubWorkspaceChangeKindSchema,
      bytes: z.number().int().nonnegative().optional(),
      sha256: z.string().optional(),
    }),
    z.object({
      type: z.literal("resource_attached"),
      id: z.string(),
      serverId: z.string(),
      serverName: z.string().optional(),
      uri: z.string(),
      name: z.string(),
      title: z.string().optional(),
      description: z.string().optional(),
      mimeType: z.string().optional(),
      audience: z.array(z.string()).optional(),
      priority: z.number().optional(),
      lastModified: z.string().optional(),
      tokens: z.number().optional(),
    }),
    z.object({
      type: z.literal("resource_removed"),
      id: z.string(),
    }),
    z.object({
      type: z.literal("approval_requested"),
      toolCallId: z.string(),
      toolName: z.string(),
      messageId: z.string().optional(),
      source: hubToolSourceSchema,
      serverId: z.string().optional(),
      annotations: hubToolAnnotationsSchema.optional(),
      options: z.array(hubApprovalOptionKindSchema),
      isAutomatic: z.boolean().optional(),
      autonomy: hubAutonomyLevelSchema.optional(),
    }),
    z.object({
      type: z.literal("approval_responded"),
      toolCallId: z.string(),
      resolution: hubApprovalResolutionSchema,
      isAutomatic: z.boolean().optional(),
    }),
    z.object({
      type: z.literal("elicitation_requested"),
      elicitationId: z.string(),
      serverId: z.string().optional(),
      serverName: z.string().optional(),
      toolCallId: z.string().optional(),
      message: z.string(),
      mode: hubElicitationModeSchema,
      requestedSchema: z.unknown().optional(),
      url: z.string().optional(),
    }),
    z.object({
      type: z.literal("elicitation_responded"),
      elicitationId: z.string(),
      action: hubElicitationActionSchema,
      autoDeclined: z.boolean().optional(),
      reason: z.string().optional(),
    }),
    z.object({
      type: z.literal("question"),
      questionId: z.string(),
      prompt: z.string(),
      options: z.array(runQuestionOptionSchema).optional(),
      allowOther: z.boolean().optional(),
    }),
    z.object({
      type: z.literal("question_resolved"),
      questionId: z.string(),
      answer: z.string().nullable(),
    }),
    z.object({
      type: z.literal("compaction"),
      summaryId: z.string(),
      uptoSeq: z.number().int().nonnegative(),
      summary: z.string(),
      summaryTokens: z.number().int().nonnegative(),
      clearedToolOutputs: z.number().int().nonnegative(),
      clearedToolOutputTokens: z.number().int().nonnegative().optional(),
      windowBefore: z.number().int().nonnegative(),
      windowAfter: z.number().int().nonnegative(),
      reattachedSkillIds: z.array(z.string()).optional(),
      userAim: z.string().optional(),
    }),
    z.object({
      type: z.literal("branch_created"),
      branchSessionId: z.string(),
      fromSessionId: z.string(),
      fromSeq: z.number().int().nonnegative().optional(),
      fromMessageId: z.string().optional(),
      label: z.string().optional(),
    }),
    z.object({
      type: z.literal("limit_error"),
      message: z.string(),
      retrySources: z.array(hubLimitRetrySourceSchema).optional(),
      limitKind: z.string().optional(),
      provider: z.string().optional(),
    }),
    z.object({
      type: z.literal("error"),
      message: z.string(),
      authRequired: z.boolean().optional(),
      serverIds: z.array(z.string()).optional(),
      recoverable: z.boolean().optional(),
    }),
    // hub-fixes WP1.3 (RC3.4) — a granted MCP server's connection outcome (deduped on change; see
    // `HubMcpServerStatusEvent`'s own doc in `types.ts`).
    z.object({
      type: z.literal("mcp_server_status"),
      serverId: z.string(),
      serverName: z.string(),
      status: z.enum(["connected", "error"]),
      message: z.string().optional(),
      authRequired: z.boolean().optional(),
    }),
    z.object({ type: z.literal("ping") }),
  ])
  .and(z.object({ seq: z.number().int().nonnegative().optional(), at: z.string().optional() }));

/** GET /api/hub/sessions/:id — the session plus its full replay log (R-SES1). */
export const hubSessionDetailSchema = z.object({
  session: hubSessionSchema,
  events: z.array(hubEventSchema),
  mission: hubMissionSchema.optional(),
});

// --- Live HITL decision wire (WP2.3, §1.4) --------------------------------------------------------

/** POST /api/hub/sessions/:id/decisions — decide a pending approval-gated tool call (R-MCP3/R-UX1). */
export const hubApprovalDecisionInputSchema = z
  .object({
    toolCallId: z.string().trim().min(1),
    resolution: hubApprovalResolutionSchema,
  })
  .strict();

/** POST /api/hub/sessions/:id/elicitation — respond to a pending MCP elicitation (R-MCP4). `content`
 *  is flat primitives only (matching the MCP `ElicitResult.content` contract); required on `accept`. */
export const hubElicitationResponseInputSchema = z
  .object({
    elicitationId: z.string().trim().min(1),
    action: hubElicitationActionSchema,
    content: z
      .record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.array(z.string())]))
      .optional(),
  })
  .strict();

/** POST /api/hub/sessions/:id/ui-state — persist a per-message generative-UI client-state snapshot
 *  (WP2.6, R-GUI5): a client-side interaction (filter/toggle/field edit) that must NOT re-enter the
 *  model but MUST replay-rehydrate. Appended as the closed-union `ui_state` event (source "user"). */
export const hubUiStateInputSchema = z
  .object({
    messageId: z.string().trim().min(1),
    key: z.string().trim().min(1).optional(),
    state: z.unknown(),
  })
  .strict();

/** POST /api/hub/sessions/:id/answers — the operator's answer to a live `question` (the hub counterpart
 *  of `runAnswerSchema`). `questionId` correlates it to the emitted `question` event; `answer` is the
 *  chosen option label or free-typed text. */
export const hubAnswerRequestSchema = z
  .object({ questionId: z.string().trim().min(1), answer: z.string().min(1) })
  .strict();

/** PATCH /api/hub/sessions/:id/autonomy — set the session's autonomy dial (D-AH6). */
export const hubAutonomyPatchSchema = z.object({ autonomy: hubAutonomyLevelSchema }).strict();

/** POST /api/hub/missions/:id/agents/:agentSessionId/steer — inject a steering message (R-SES3/R-UX4). */
export const hubAgentSteerInputSchema = z.object({ text: z.string().trim().min(1) }).strict();

// --- Workforce Usage tab (WP0.1, D-HUX10) — zod partners of the group-by row + per-entity summary --
// The existing `HubUsageAggregates`/`HubUsageMissionSummary` response projections carry no zod (they
// are read-only rollups); this WP adds partners for the NEW workforce-Usage shapes plus a bucket
// partner reused by the summary strip.

/** Zod partner of the pre-existing {@link HubUsageBucket} (previously response-only) — reused for the
 *  per-entity summary's daily strip. */
export const hubUsageBucketSchema = z.object({
  key: z.string(),
  label: z.string(),
  sessions: z.number(),
  costUsd: z.number(),
  tokensIn: z.number(),
  tokensOut: z.number(),
});

/** One grouped usage row (D-HUX10). `key` is `null` for the explicit unattributed "no agent" bucket. */
export const hubUsageRowSchema = z.object({
  groupBy: hubUsageGroupBySchema,
  key: z.string().nullable(),
  label: z.string(),
  unattributed: z.boolean().optional(),
  sessions: z.number(),
  costUsd: z.number(),
  tokensIn: z.number(),
  tokensOut: z.number(),
});

/** A per-entity usage summary (D-HUX10) — totals + a daily strip for one agent/crew/entity. */
export const hubUsageSummarySchema = z.object({
  groupBy: hubUsageGroupBySchema,
  id: z.string(),
  label: z.string(),
  totals: z.object({
    sessions: z.number(),
    costUsd: z.number(),
    tokensIn: z.number(),
    tokensOut: z.number(),
  }),
  strip: z.array(hubUsageBucketSchema),
});

// --- Advisor — evidenced recommendations (WP 1.1) ---------------------------------------------
// zod partners of the `Advisor*` types. These are the contract's RUNTIME half: the type system
// cannot stop an empty `evidence` array or a blank `basis` string, so the schemas encode both
// invariants and the engine validates every emitted recommendation against them.

export const advisorScopeKindSchema = z.enum(ADVISOR_SCOPE_KINDS);
export const advisorEvidenceKindSchema = z.enum(ADVISOR_EVIDENCE_KINDS);
export const advisorSeveritySchema = z.enum(ADVISOR_SEVERITIES);
export const advisorSavingsUnitSchema = z.enum(ADVISOR_SAVINGS_UNITS);

export const advisorScopeSchema = z.object({
  kind: advisorScopeKindSchema,
  id: z.string().min(1).optional(),
});

export const advisorEvidenceRefSchema = z.object({
  kind: advisorEvidenceKindSchema,
  id: z.string().min(1),
  label: z.string().min(1),
});

/** `estimate` is pinned to the literal `true` and `basis` must be non-blank — a savings figure can
 *  never be emitted unlabeled, and never without the one line that makes it reproducible. */
export const advisorSavingsSchema = z.object({
  value: z.number().finite(),
  unit: advisorSavingsUnitSchema,
  estimate: z.literal(true),
  basis: z.string().trim().min(1),
});

/**
 * WP 2.1 — the grade-side provenance of a grade-aware finding. `suiteRunIds` is `.min(1)` for the
 * same reason `evidence` is: a "validated against the suite score" claim that names no suite run is
 * unverifiable. Ascending + deduped ordering is asserted by the engine, not here (zod cannot express
 * "sorted" without a refinement that would duplicate the engine's determinism check).
 */
export const advisorGradeProvenanceSchema = z.object({
  gradingVersion: z.number().int(),
  suiteRunIds: z.array(z.string().min(1)).min(1),
});

/** `evidence` is `.min(1)`: every recommendation cites at least one real entity. */
export const advisorRecommendationSchema = z.object({
  id: z.string().min(1),
  ruleId: z.string().min(1),
  title: z.string().min(1),
  detail: z.string(),
  severity: advisorSeveritySchema,
  savings: advisorSavingsSchema.optional(),
  evidence: z.array(advisorEvidenceRefSchema).min(1),
  assumptions: z.array(z.string()),
  /** WP 2.1 — present only on a grade-aware finding (see {@link advisorGradeProvenanceSchema}). */
  gradeProvenance: advisorGradeProvenanceSchema.optional(),
});

/** `reason` must name what was missing — a blank reason is not an honest gap. */
export const advisorInsufficientDataSchema = z.object({
  ruleId: z.string().min(1),
  reason: z.string().trim().min(1),
});

export const advisorReportSchema = z.object({
  advisorVersion: z.number().int(),
  generatedAt: z.string().min(1),
  scope: advisorScopeSchema,
  recommendations: z.array(advisorRecommendationSchema),
  insufficientData: z.array(advisorInsufficientDataSchema),
});

/**
 * The query of `GET /api/advisor/report` (WP 1.2). The scope is REQUIRED — there is no default,
 * because "the whole fleet" and "this one server" are different questions and guessing which one an
 * operator meant would quietly answer the wrong one.
 *
 * The id/scope pairing is validated rather than tolerated: a `server`/`scenario` report with no id
 * has nothing to report on, and a `fleet` report carrying an id would silently ignore it. Both are
 * caller bugs, so both are 400s.
 */
export const advisorReportQuerySchema = z
  .object({
    scope: advisorScopeKindSchema,
    id: z.string().trim().min(1).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.scope === "fleet") {
      if (value.id !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["id"],
          message: "The fleet scope covers everything and takes no id",
        });
      }
      return;
    }
    if (value.id === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["id"],
        message: `The ${value.scope} scope requires an id`,
      });
    }
  });

// --- Advisor — fleet report (WP 2.2) ----------------------------------------------------------
// zod partners of the `Fleet*` types. Response schemas, so the enums are used RAW (`z.enum(...)`)
// rather than through the request-side aliases that carry a `.default()` — a report states what was
// persisted, and a schema that silently fills in a default would mask a missing field instead of
// failing the contract test that guards it.

export const fleetScanRefSchema = z.object({
  scanId: z.string().min(1),
  scannedAt: z.string().min(1),
  tokenProfile: z.enum(TOKEN_PROFILES),
  countingVersion: z.number().int(),
  totalTools: z.number().int().nonnegative(),
  totalTokens: z.number().int().nonnegative(),
});

/** `deltaTokens`/`deltaPercent` are NULLABLE, not optional: "not comparable" is a stated fact about
 *  the pair of scans, so the field is present and empty rather than quietly missing. */
export const fleetServerDriftSchema = z.object({
  previousScan: fleetScanRefSchema,
  toolsAdded: z.number().int().nonnegative(),
  toolsRemoved: z.number().int().nonnegative(),
  toolsChanged: z.number().int().nonnegative(),
  deltaTokens: z.number().nullable(),
  deltaPercent: z.number().nullable(),
  deltasComparable: z.boolean(),
});

export const fleetServerEntrySchema = z.object({
  serverId: z.string().min(1),
  serverName: z.string().min(1),
  transport: z.enum(TRANSPORT_TYPES),
  latestScan: fleetScanRefSchema.nullable(),
  drift: fleetServerDriftSchema.nullable(),
  gap: z.string().trim().min(1).optional(),
});

export const fleetServersSectionSchema = z.object({
  entries: z.array(fleetServerEntrySchema),
  gap: z.string().trim().min(1).optional(),
});

export const fleetEnvironmentEntrySchema = z.object({
  scenarioId: z.string().min(1),
  name: z.string().min(1),
  model: z.string(),
  toolLoadingMode: z.enum(TOOL_LOADING_MODES),
  runs: z.number().int().nonnegative(),
  completedRuns: z.number().int().nonnegative(),
  billedCostUsd: z.number().finite(),
  billedRuns: z.number().int().nonnegative(),
  meanBilledCostUsd: z.number().finite().nullable(),
  subscriptionReferenceCostUsd: z.number().finite(),
  subscriptionReferenceRuns: z.number().int().nonnegative(),
  tokensIn: z.number().int().nonnegative(),
  tokensOut: z.number().int().nonnegative(),
  gap: z.string().trim().min(1).optional(),
});

export const fleetEnvironmentsSectionSchema = z.object({
  entries: z.array(fleetEnvironmentEntrySchema),
  gap: z.string().trim().min(1).optional(),
});

export const fleetSuiteEntrySchema = z.object({
  suiteRunId: z.string().min(1),
  suiteId: z.string().min(1).optional(),
  label: z.string().min(1),
  source: z.enum(RUN_PLAN_SOURCES).optional(),
  status: z.enum(SUITE_RUN_STATUSES),
  startedAt: z.string().min(1),
  endedAt: z.string().min(1).optional(),
  cellsTotal: z.number().int().nonnegative(),
  cellsCompleted: z.number().int().nonnegative(),
  meanGrade: z.number().finite().nullable(),
  gradeStdDev: z.number().finite().nullable(),
  passRateAt05: z.number().finite().nullable(),
  totalTokens: z.number().int().nonnegative(),
  execCostUsd: z.number().finite(),
  judgeCostUsd: z.number().finite(),
  gap: z.string().trim().min(1).optional(),
});

export const fleetSuitesSectionSchema = z.object({
  entries: z.array(fleetSuiteEntrySchema),
  totalSuiteRuns: z.number().int().nonnegative(),
  gap: z.string().trim().min(1).optional(),
});

export const fleetPostureSubjectSchema = z.object({
  kind: z.enum(["server", "skill"]),
  id: z.string().min(1),
  name: z.string().min(1),
  score: z.number().finite().nullable(),
  findings: z.number().int().nonnegative(),
});

export const fleetPostureSummarySchema = z.object({
  analyzerVersion: z.number().int(),
  score: z.number().finite().nullable(),
  findingCounts: z.array(
    z.object({ severity: z.string().min(1), count: z.number().int().nonnegative() }),
  ),
  subjects: z.array(fleetPostureSubjectSchema),
});

export const fleetPostureSectionSchema = z.object({
  summary: fleetPostureSummarySchema.nullable(),
  gap: z.string().trim().min(1).optional(),
});

export const fleetAdvisorSectionSchema = z.object({
  report: advisorReportSchema,
  gap: z.string().trim().min(1).optional(),
});

export const fleetReportSchema = z.object({
  advisorVersion: z.number().int(),
  generatedAt: z.string().min(1),
  servers: fleetServersSectionSchema,
  environments: fleetEnvironmentsSectionSchema,
  suites: fleetSuitesSectionSchema,
  posture: fleetPostureSectionSchema,
  advisor: fleetAdvisorSectionSchema,
});
