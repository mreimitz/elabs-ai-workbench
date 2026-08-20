// The advisor rule-engine's INTERNAL contract (WP 1.1). The wire shapes live in
// `packages/shared` (`AdvisorReport` & friends); this file describes what a rule *is* and what it
// is allowed to read.
//
// Runtime-boundary rule (planning/Roadmap/RM-01-advisor/conventions.md): a rule NEVER opens its own DB handle.
// It reads the narrow, read-only ports on {@link AdvisorContext}, which the real repositories
// satisfy structurally — so the engine is testable with plain fakes, and a rule physically cannot
// reach past the read model into writes, MCP connections, or secrets.

import type {
  AdvisorInsufficientData,
  AdvisorRecommendation,
  AdvisorScope,
  AllowedServer,
  RunDetail,
  RunGrade,
  RunSummary,
  ScanDetail,
  ScanSummary,
  Scenario,
  ServerConfig,
  Skill,
  SuiteRun,
} from "@mcp-token-footprint/shared";
import type { ListRunsFilter } from "../testing/run-repository.js";

/** Read-only slice of `ServerRepository`. `getPublic` returns the REDACTED config — the advisor
 *  never sees `InternalServerConfig`, so no secret can reach a rule (mcp-and-security.md). */
export type AdvisorServerPort = {
  list(): ServerConfig[];
  getPublic(id: string): ServerConfig;
};

/** Read-only slice of `ScanRepository` — the footprint side of the read model. */
export type AdvisorScanPort = {
  listSummariesByServer(serverId: string): ScanSummary[];
  getLatestForServer(serverId: string): ScanDetail | null;
  getDetail(scanId: string): ScanDetail;
};

/** Read-only slice of `ScenarioRepository` (UI label: "Environment"; the wire name is frozen). */
export type AdvisorScenarioPort = {
  list(): Scenario[];
  get(id: string): Scenario;
  listServers(scenarioId: string): AllowedServer[];
};

/** Read-only slice of `RunRepository` — the runtime-behavior side of the read model. */
export type AdvisorRunPort = {
  listRuns(filter?: ListRunsFilter): RunSummary[];
  getRun(runId: string): RunDetail;
  getToolCallSequence(runId: string): string[];
  /** WP 2.1 — the run row WITHOUT its steps/events. A grade-aware rule walks a whole suite matrix,
   *  so it must not pay `getRun`'s full-replay hydration per member. */
  getSummary(runId: string): RunSummary;
  /** WP 2.1 — the skills a run ACTUALLY resolved (`run_skills`). This is the immutable input the
   *  benchmarks WP 5.1 variant attribution matches against; narrowed to the one column it reads so
   *  a rule cannot drift into the rest of the row. */
  getRunSkills(runId: string): { skill_id: string }[];
};

// --- WP 2.1 — the grade-aware side of the read model -------------------------------------------
// Phase 2 rules join the Phase 1 footprint/behavior model to GRADES. Three more narrow ports, in the
// same shape as the four above: read-only slices the concrete repositories satisfy structurally, so
// a rule still cannot reach a DB handle, an MCP connection, or a secret.

/** Read-only slice of `GradeRepository`. `run_grades` is APPEND-ONLY, so a rule reads the whole
 *  history and picks the latest row per grader itself (the same selection the suite analytics use). */
export type AdvisorGradePort = {
  listByRun(runId: string): RunGrade[];
};

/** Read-only slice of `SuiteRunRepository` — the executed benchmark matrices a grade-aware finding
 *  rests on, plus the child runs each one owns. */
export type AdvisorSuiteRunPort = {
  listRuns(suiteId?: string): SuiteRun[];
  listChildRunIds(suiteRunId: string): string[];
};

/** Read-only slice of `SkillRepository` — names only. Deliberately `list()` rather than `get(id)`:
 *  `getPublic` throws a 404 for a skill deleted after the run that used it, and a rule reports a gap
 *  rather than throwing (the same reason `serversById` exists). */
export type AdvisorSkillPort = {
  list(): Skill[];
};

/** What a rule may know about a model from the bundled compatibility dataset. `contextWindowTokens`
 *  is `null` when the dataset carries no window for the model — an unknown limit, never a zero. */
export type AdvisorModelInfo = {
  id: string;
  displayName: string;
  contextWindowTokens: number | null;
};

/** Read-only lookup over the bundled model dataset (`compatibility/dataset.ts`). Static JSON, not a
 *  repository — behind a port anyway so a rule is testable with a fake and the compatibility engine
 *  stays the one place that knows the dataset's shape. */
export type AdvisorModelPort = {
  /** The model, or `null` when the compatibility dataset does not know this id at all. */
  get(modelId: string): AdvisorModelInfo | null;
};

/** Everything a rule may read, plus the engine's clock. There is deliberately no `db` here. */
export type AdvisorContext = {
  readonly servers: AdvisorServerPort;
  readonly scans: AdvisorScanPort;
  readonly scenarios: AdvisorScenarioPort;
  readonly runs: AdvisorRunPort;
  /** WP 2.1 — the graded side of the read model. */
  readonly grades: AdvisorGradePort;
  readonly suiteRuns: AdvisorSuiteRunPort;
  readonly skills: AdvisorSkillPort;
  readonly models: AdvisorModelPort;
  /** The ONLY source of a report's `generatedAt`. Injected so a report is reproducible: two runs
   *  over the same inputs and the same clock are byte-identical, `generatedAt` included. */
  readonly now: () => Date;
};

/** What one rule contributes to a report. Both arrays may be empty (a rule that found nothing and
 *  was missing nothing contributes neither a recommendation nor a fabricated gap). */
export type AdvisorRuleResult = {
  recommendations: AdvisorRecommendation[];
  insufficientData: AdvisorInsufficientData[];
};

/** A deterministic advisor rule. Must be a pure function of `ctx`'s data + `scope`: same inputs,
 *  same output, every time — including the ORDER of what it returns. */
export type AdvisorRule = {
  /** Stable rule id, also stamped on every recommendation/gap the rule emits. */
  readonly id: string;
  /** One line describing what the rule looks for — used by the registry listing and docs. */
  readonly description: string;
  /** Whether this rule has anything to say about `scope`. A rule that does not apply contributes
   *  nothing at all — not even an `insufficientData` entry (a scope it was never meant to cover is
   *  not a data gap). */
  appliesTo(scope: AdvisorScope): boolean;
  run(ctx: AdvisorContext, scope: AdvisorScope): AdvisorRuleResult;
  /**
   * WP 2.1 — this rule reads GRADES. The engine then REQUIRES an `AdvisorGradeProvenance` on every
   * recommendation the rule emits (`GRADING_VERSION` + the suite-run ids read), so the Phase 2
   * invariant is enforced by the engine rather than by each rule remembering to stamp it.
   *
   * Absent/`false` on every deterministic Phase 1 rule, which reads no grades and must NOT stamp
   * grade provenance it does not have.
   */
  readonly gradeAware?: boolean;
};

/** Thrown when a rule violates the recommendation contract (no evidence, an unlabeled or
 *  basis-less savings figure, a mismatched `ruleId`). This is a PROGRAMMING error in the rule, not
 *  a data problem: the engine refuses to publish the malformed finding rather than degrade the
 *  report's guarantees, and the gate catches it. */
export class AdvisorRuleContractError extends Error {
  readonly statusCode = 500;
  constructor(
    readonly ruleId: string,
    detail: string,
  ) {
    super(`Advisor rule "${ruleId}" violated the recommendation contract: ${detail}`);
    this.name = "AdvisorRuleContractError";
  }
}
