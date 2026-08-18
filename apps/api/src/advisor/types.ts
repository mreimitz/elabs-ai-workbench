// The advisor rule-engine's INTERNAL contract (WP 1.1). The wire shapes live in
// `packages/shared` (`AdvisorReport` & friends); this file describes what a rule *is* and what it
// is allowed to read.
//
// Runtime-boundary rule (roadmap/advisor/conventions.md): a rule NEVER opens its own DB handle.
// It reads the narrow, read-only ports on {@link AdvisorContext}, which the real repositories
// satisfy structurally — so the engine is testable with plain fakes, and a rule physically cannot
// reach past the read model into writes, MCP connections, or secrets.

import type {
  AdvisorInsufficientData,
  AdvisorRecommendation,
  AdvisorScope,
  AllowedServer,
  RunDetail,
  RunSummary,
  ScanDetail,
  ScanSummary,
  Scenario,
  ServerConfig,
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
};

/** Everything a rule may read, plus the engine's clock. There is deliberately no `db` here. */
export type AdvisorContext = {
  readonly servers: AdvisorServerPort;
  readonly scans: AdvisorScanPort;
  readonly scenarios: AdvisorScenarioPort;
  readonly runs: AdvisorRunPort;
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
