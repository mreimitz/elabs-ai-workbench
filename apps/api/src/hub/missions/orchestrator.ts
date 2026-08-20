// Assistant Hub (planning/Roadmap/RM-03-assistant-hub/, WP1.7, §1.4/§1.5 · D-AH6/D-AH8/D-AH9) — the mission
// ORCHESTRATOR (`HubMissionService`): the flagship propose → approve → run → synthesize flow.
//
// Composition, not a fork: mission agents are CHILD HUB SESSIONS (`kind:'agent'`, parent+mission
// linkage) that reuse `HubRepository`/`hub_events` — the same session machinery, never a parallel
// `runs` path. Everything is EVENT-SOURCED into the parent session's append-only log (`plan_proposed`,
// `plan_updated`, `plan_approved`, `mission_started`, `agent_spawned`, `agent_report`,
// `mission_synthesis`), so the whole mission board replays INERT from `hub_events` alone (R-SES1). The
// service NEVER touches the testing tables.
//
// Isolation (D-AH9): each agent gets ONLY its role prompt + curated brief (`missions/shared.ts`
// role-template assembly) as its input — NEVER the parent transcript. The brief is the child session's
// sole `user_message`; the parent's messages never enter a child's context.
//
// Hard budgets (D-AH9, server-side regardless of the autonomy dial): the plan is clamped to the env
// caps (`planner.clampPlanToBudgets`) at propose/edit time; at run time `maxParallel` bounds
// concurrency (the rest queue) and `maxCostUsd` bounds total spend — a tripped budget stops launching
// + aborts in-flight agents cleanly and synthesizes PARTIALLY, honestly marked.
//
// Model calls live behind DI seams (`HubPlanner` / `HubAgentRunner` / `HubSynthesizer`) — the whole
// orchestration is gate-tested with STUBS; the production seams (`createStructuredPlanner`,
// `createStructuredAgentRunner`, `createTextSynthesizer`) wrap AI-SDK `generateObject`/`generateText`
// and are NOT live-verified (owner-acceptance).

import type {
  HubAgentFinding,
  HubAgentReport,
  HubAgentRole,
  HubAutonomyLevel,
  HubBudgets,
  HubCitation,
  HubConfidence,
  HubCrew,
  HubEvent,
  HubMission,
  HubMissionPlan,
  HubPlannedAgent,
  HubServerToolGrant,
  HubSession,
  HubSessionRoster,
  HubToolGrants,
  ProviderKind,
} from "@mcp-token-footprint/shared";
import {
  HUB_MISSION_MAX_DEPTH,
  HUB_MISSION_MAX_TOTAL_AGENTS,
  hubAgentReportSchema,
} from "@mcp-token-footprint/shared";
import { generateObject, type LanguageModel } from "ai";
import { nanoid } from "nanoid";
import { estimateCost } from "../../providers/pricing.js";
import { httpError } from "../../utils/errors.js";
import { reconstructCitationBaseline } from "../citations.js";
import { assembleRolePrompt, type HubRoleTemplateInjection } from "../prompting/index.js";
import {
  hubDeterministicTitle,
  type HubAgentTurnInput,
  type HubAgentTurnResult,
} from "../session-service.js";
import type { HubEventInput, HubRepository } from "../repository.js";
import { effectiveAgentGrants } from "../tools/grants.js";
import type { HubMcpServerCatalog } from "../tools/index.js";
import type { HubTurnSink } from "../turn-engine.js";
import {
  buildAgentReportContractInstruction,
  noteProjectedReport,
  parseAgentReportContract,
} from "./agent-report-contract.js";
import {
  allocateChildBudget,
  buildMissionPlannerPrompt,
  buildPlannerRosterCatalog,
  buildPlannerServerCatalog,
  buildPlannerSessionContext,
  clampPlannedCredentials,
  clampPlanToBudgets,
  type HubMissionCaps,
  type HubPlanner,
  type HubPlannerRosterCatalog,
  type HubPlannerServerCatalog,
  normalizePlannedModels,
  notePlanPricingGaps,
  summarizeMissionTree,
} from "./planner.js";
import { isStructuredOutputModel, pickSynthesisModel, type HubModelRef } from "./roster.js";
import {
  buildMissionDigest,
  collectMissionFollowups,
  mergeAgentCitations,
  synthesizeMission,
  type HubSynthesizer,
  type HubSynthesisTurn,
} from "./synthesis.js";
import {
  agentToolSignatures,
  plannedAgentLabel,
  renderReportText,
  summarizeBudgets,
} from "./shared.js";
import {
  hydratePlannedAgentFromRole,
  instantiateAgentsPlan,
  instantiateCrewPlan,
  pinForModel,
  runTopology,
  type HubJudge,
  type TopologySlot,
} from "./topologies.js";

/** WP2.2 — a saved crew (D-AH7) resolved to its member roles, for deterministic instantiation. */
export type HubResolvedCrew = { crew: HubCrew; roles: HubAgentRole[] };

/** The inputs an agent runner (the model call) receives — the ISOLATED brief + role prompt ONLY, never
 *  the parent transcript (D-AH9). Everything here is CURATED by the orchestrator from the frozen plan. */
export type HubAgentRunInput = {
  agentSessionId: string;
  missionId: string;
  key: string;
  roleName: string;
  model: string;
  /** hub-fixes (Defect 2) — the model for the bounded report-EXTRACTION `generateObject` (SESSION runner
   *  only). The orchestrator sets it to the PARENT/mission model so a facade agent-`model` (a Acme-Answers
   *  assistant with no structured-output mode) never runs the extraction call itself; a structured-
   *  incapable extraction model falls back to {@link projectTranscriptToReport}. Absent ⇒ `model`. */
  extractionModel?: string;
  /** model-identity WP4.2 (D-MI1) — the credential that owns {@link extractionModel}, so the extraction
   *  call resolves on the provider the orchestrator chose rather than re-guessing from the model name.
   *  Absent ⇒ the unchanged heuristic (a pre-WP4.2 caller behaves byte-identically). */
  extractionProviderCredentialId?: string;
  /** model-identity WP4.2 (D-MI1) — the credential that owns {@link model}. */
  providerCredentialId?: string;
  /**
   * model-identity WP4.2 (**D-MI4**) — this agent runs on a transport with NO structured-output mode
   * (the `claude_subscription` Agent-SDK child), so its report comes from the PROMPT-ENFORCED contract
   * (`agent-report-contract.ts`) parsed out of its own settled prose, not from a `generateObject`
   * extraction call. The orchestrator sets it after resolving the planned agent's credential; the
   * SESSION runner switches its report source on it. Absent/false ⇒ the extraction path, unchanged.
   */
  reportContract?: boolean;
  /** The assembled role-agent system prompt (identity REPLACED — a specialist, not the Assistant). Used
   *  as-is by the STRUCTURED (one-shot) runner. */
  systemPrompt: string;
  /** hub-fixes WP2.1 (RC2, additive) — the raw role-template PARTS, so the SESSION runner can re-assemble
   *  the role prompt WITH the child turn's REAL resolved tool listing (identity replaced §8.4 + honest
   *  granted-tools guidance). Absent ⇒ the structured runner's `systemPrompt` is authoritative. */
  roleTemplate?: HubRoleTemplateInjection;
  /** The curated brief (target · inputs · expected outcome) — the agent's ONLY task input. */
  brief: string;
  expectedOutcome: string;
  budgets?: HubBudgets;
  abortSignal: AbortSignal;
  /** hub-fixes WP2.5 (D-HF6) — the mission's approval policy for this child turn (autonomy + the
   *  always_ask timeout + the shared timeout ledger). The SESSION runner threads it into `runAgentTurn`;
   *  the structured runner ignores it (no gated tool calls on the tool-less one-shot path). */
  missionApproval?: HubAgentTurnInput["missionApproval"];
  /** hub-fixes WP2.5 (D-HF6) — the BOARD-APPROVAL MIRROR sink (only an `always_ask` mission sets it):
   *  the SESSION runner passes it into `runAgentTurn` so the child turn's `approval_requested`/
   *  `approval_responded` events are mirrored onto the parent (board) log as `agent_approval_*` events. */
  sink?: HubTurnSink;
};

/** The structured outcome of one agent run. `report` absent ⇒ the agent was aborted before producing
 *  one (a budget trip / stop) — it counts toward a PARTIAL mission. */
export type HubAgentRunResult = {
  report?: HubAgentReport;
  costUsd: number;
  tokensIn: number;
  tokensOut: number;
  aborted?: boolean;
};

/** The agent-runner DI seam (the model call). Production wraps `generateObject` over the report schema
 *  ({@link createStructuredAgentRunner}); tests inject a deterministic stub. */
export type HubAgentRunner = (input: HubAgentRunInput) => Promise<HubAgentRunResult>;

/**
 * model-identity WP4.2 (**D-MI4**) — a mission agent that RAN but whose report could not be trusted.
 *
 * Thrown by the SESSION runner's prompt-enforced-contract path when the child emitted a report block
 * that cannot be parsed or repaired, or produced nothing at all to project. It exists so the
 * orchestrator can settle the child with the REAL cause instead of the generic *"The agent failed to
 * produce a report."* — the exact string D-MI4 charters this WP to replace. The message is composed by
 * the runner from the parse outcome and carries NO model output, only the shape of the failure.
 */
export class HubAgentReportContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HubAgentReportContractError";
  }
}

/** hub-fixes (Defect 1c) — whether an MCP server can be used by a HEADLESS mission agent this run.
 *  `serverName` (when known) is used for a human-readable "authenticate X" message. */
export type HubServerRunReadiness = { ready: boolean; serverName?: string };

export type HubMissionServiceConfig = HubMissionCaps & {
  /** The default autonomy dial when the session sets none (env `HUB_DEFAULT_AUTONOMY`, default ask). */
  defaultAutonomy: HubAutonomyLevel;
  /** hub-fixes WP2.1 (RC2, D-HF7 rollback seam, env `HUB_AGENT_RUNNER`). `session` runs each agent as a
   *  REAL child hub session through the turn engine (`runOneAgent`'s session branch); `structured` keeps
   *  the OLD tool-less one-shot orchestration (brief + synthetic report message written HERE), byte-
   *  compatible. Absent ⇒ `structured` (so an existing construction / a stub-`runAgent` test — which
   *  returns a report directly and does NOT drive a child turn — keeps its exact prior behavior). */
  agentRunnerMode?: "session" | "structured";
  /** hub-fixes WP2.5 (D-HF6, env `HUB_MISSION_APPROVAL_TIMEOUT_S`) — the auto-deny budget (ms) for an
   *  `always_ask` mission's board approval cards: a card left unanswered this long is auto-denied so the
   *  mission always terminates (a silent stall is a defect). Absent ⇒ {@link DEFAULT_MISSION_APPROVAL_TIMEOUT_MS}. */
  missionApprovalTimeoutMs?: number;
  /** hub-fixes WP3.2 (RC4, D-HF4, env `HUB_SYNTHESIS_MODE`) — the mission-synthesis path. `turn` (default)
   *  runs the synthesis as a REAL turn of the parent session with GenUI tools available (needs the
   *  `runSynthesisTurn` dep wired); `text` forces the pre-fix tool-less `generateText` synthesizer. Absent
   *  ⇒ `turn` when `runSynthesisTurn` is wired, else the text path. */
  synthesisMode?: "turn" | "text";
  /** hub-fixes (Defect 2, env `HUB_MISSION_EXTRACTION_MODEL`) — override the model used for a mission
   *  agent's bounded report-EXTRACTION call. Absent ⇒ the PARENT/mission session model (structured-
   *  capable, since it ran the planner), so a facade agent-model never runs the extraction itself. */
  missionExtractionModel?: string;
  /** assistant-hub v1-fixes (F1, env `HUB_MISSION_SYNTHESIS_MODEL`) — override the model that runs the
   *  mission SYNTHESIS turn. Absent ⇒ `pickSynthesisModel`: the parent session's model when structured-
   *  capable, else the first structured-capable plan model — never an `assistant|…` facade model, which
   *  drops the system prompt that carries the reports digest (the root cause of the blind synthesis in
   *  planning/Roadmap/RM-03-assistant-hub/mission-session-analysis-2026-07-20.md §1). */
  missionSynthesisModel?: string;
  /** hub-fixes (Defect 4, env `HUB_MISSION_AGENT_MAX_DURATION_S`) — an OVERALL per-agent wall cap (ms) for
   *  a mission slot (the child turn PLUS its report-extraction). A wedged agent is aborted so it can't stall
   *  the whole parallel join; it then settles with no report (partial). 0/absent ⇒ no overall cap (the turn
   *  engine's own per-turn `maxDurationMs`/stall net + the extraction timeout still apply). */
  agentMaxDurationMs?: number;
};

/** hub-fixes WP2.5 — fallback approval timeout (5 min) when the config omits `missionApprovalTimeoutMs`
 *  (mirrors `config/env.ts`'s own `HUB_MISSION_APPROVAL_TIMEOUT_S` default, so a service construction
 *  that doesn't thread it through still bounds an always_ask mission). */
export const DEFAULT_MISSION_APPROVAL_TIMEOUT_MS = 300_000;

/** Crew nesting (WP2.2 / D-CN3, Design D) — the open-question line appended to a crew-ref's rolled-up report
 *  when its sub-mission stopped early (its own budget tripped, or an ancestor aborted it, or it was skipped
 *  for a 0 allocation). Surfaces the truncation honestly instead of a silently short sub-report. */
export const SUB_CREW_TRUNCATION_NOTE =
  "Sub-crew stopped early — budget exhausted; findings are partial.";

/**
 * Crew nesting (WP2.2 / D-CN3) — build ONE level's {@link LevelBudget}. `cap` is the level's own hard cap
 * (the root's `budgetCap`, or the {@link allocateChildBudget} slice for a nested level). `isTripped` is
 * COMPOSED — this level's own soft trip OR the shared root ceiling OR any ancestor level's trip — so a
 * nested strategy stops the instant an ancestor exhausts its allocation (never re-reads an env cap here).
 */
function makeLevelBudget(
  cap: number,
  sharedRootTripped: () => boolean,
  parentIsTripped: () => boolean,
): LevelBudget {
  const budget: LevelBudget = {
    cap,
    reservable: cap,
    spent: 0,
    tripped: false,
    childPartial: false,
    isTripped: () => false,
  };
  budget.isTripped = () => budget.tripped || sharedRootTripped() || parentIsTripped();
  return budget;
}

export type HubMissionServiceDeps = {
  repository: HubRepository;
  config: HubMissionServiceConfig;
  planner: HubPlanner;
  runAgent: HubAgentRunner;
  synthesizer: HubSynthesizer;
  /** hub-fixes WP3.2 (RC4, D-HF4) — the synthesis-TURN seam (`hubSessionService.runSynthesisTurn`). When
   *  wired AND `config.synthesisMode` is not `"text"`, the mission's final answer runs as a REAL turn of
   *  the parent session with GenUI `present` tools available; the answer can then use widgets plus prose.
   *  Absent ⇒ the pre-WP3.2 tool-less `generateText` synthesizer (`synthesizer`) is used unchanged. */
  runSynthesisTurn?: HubSynthesisTurn;
  /** Optional pre-formatted model roster injected into the planner prompt (LAYER 8). Async so the
   *  provider store can be enumerated live at propose time (index.ts caches it); a sync value is also
   *  accepted (tests). Absent/empty ⇒ the orchestration layer renders its tier placeholder, and the
   *  {@link normalizePlannedModels} guard still prevents a tier label reaching a child session. */
  roster?: () => Promise<string | undefined> | string | undefined;
  /**
   * model-identity WP4.2 (**D-MI4**) — EVERY provider credential (all kinds, not just the hub-eligible
   * ones), as `id → kind`.
   *
   * The orchestrator needs ONE fact the model id can never carry: which PROVIDER will actually run a
   * planned agent. A subscription-pinned agent runs on a canonical Anthropic id (`claude-sonnet-5`,
   * frozen by §3), so nothing about the id distinguishes it from the metered API twin — and the
   * consequence is not cosmetic: the Agent-SDK subscription child has no `generateObject`, so the
   * report must come from the prompt-enforced contract instead of the extraction call, and the
   * synthesis / best-of-N judge must not be routed onto it blind.
   *
   * **Why ALL kinds, not the hub-eligible subset.** The map doubles as the known-id set
   * {@link clampPlannedCredentials} strips against, and stripping means "fall back to the heuristic" —
   * the very silent re-pick D-MI9 forbids. Narrowing the map to hub-eligible kinds would therefore turn
   * a deliberate-but-ineligible pin (a `acme_answers` credential) into a silent swap instead of the
   * honest 409 the resolver owes it. Only a genuinely UNKNOWN id — a planner hallucination, or a
   * credential deleted out from under a JSON blob no FK protects (D-MI2) — may be stripped; every
   * existing credential is left for the resolver to accept or refuse at turn time.
   *
   * Deliberately a KIND MAP, not a resolver call: it must never throw (a plan-time D-MI9 409 would
   * abort a propose that should still be allowed to run and fail honestly at turn time).
   *
   * Absent (existing constructions, tests) ⇒ every agent is treated as AI-SDK-backed and no pin is
   * stripped: byte-identical pre-WP4.2 behaviour.
   */
  providerCredentialKinds?: () => ReadonlyMap<string, ProviderKind>;
  /**
   * WP2.4/R-SK3 — resolve a planned agent's `skillIds` (bare ids, ad-hoc per mission) to their FULL L2
   * bodies, formatted for `HubRoleTemplateInjection.roleSkillsContent` (the "subagent-skills pattern":
   * role-level skills preload complete, up front — no catalog, no on-demand `skills.load`, no user in
   * the loop to slash-invoke, unlike session-level attachment). Absent/empty `skillIds` ⇒
   * `roleSkillsContent` stays the layer's own "(none)" default. Injected by index.ts over the SAME
   * `SkillRepository` the session-level catalog resolves from; a stub in tests.
   */
  resolveRoleSkills?: (skillIds: readonly string[]) => string | Promise<string>;
  /**
   * WP2.2 — the BLIND judge seam for the `best_of_n` topology (D-AH6). Absent ⇒ best_of_n falls back to
   * the deterministic winner ({@link deterministicWinner}). The judge only ever receives anonymized
   * attempts (label + body, never the authoring model/role — R-SK7).
   */
  judge?: HubJudge;
  /**
   * WP2.2 — resolve a SAVED CREW (D-AH7) + its member roles for deterministic instantiation. When a
   * mission is proposed with a `crewId` (or the session carries one), the crew is expanded into the plan
   * here instead of running the planner model. Absent/unresolvable ⇒ the planner path is used.
   */
  resolveCrew?: (crewId: string) => HubResolvedCrew | undefined;
  /**
   * End-user UX pass — resolve the session's Agents & Crews ROSTER (the new-session "Agents & Crews"
   * tab) into the concrete saved roles + resolved crews it references. Fed to the planner as a PREFERRED
   * POOL (owner decision): the roster catalog is injected into the planner prompt (`buildPlannerRosterCatalog`)
   * and, after the planner returns, any agent it reused (`roleId` set) is HYDRATED from the saved role
   * ({@link hydratePlannedAgentFromRole}). Absent/empty roster ⇒ the planner path is unchanged (invents a
   * team from scratch). Unlike `resolveCrew`, this is NON-deterministic — the roster only biases the
   * planner, it does not replace it. A deleted role/crew is silently dropped (resolution parity).
   */
  resolveRoster?: (roster: HubSessionRoster) => { roles: HubAgentRole[]; crews: HubResolvedCrew[] };
  /**
   * End-user UX pass — resolve an EXPLICIT list of saved-agent ids (the prompt's `@`-mentions) to their
   * `HubAgentRole`s for a deterministic team handoff (order preserved, deleted/unknown ids dropped). Like
   * `resolveCrew` this is deterministic (it REPLACES the planner), unlike `resolveRoster` which only
   * biases it. Absent ⇒ `proposePlan` cannot honor an `agentIds` handoff (400).
   */
  resolveAgents?: (agentIds: readonly string[]) => HubAgentRole[];
  /**
   * hub-fixes WP2.3 (RC2.4 propose-path carry-forward) — resolve the parent session's REACHABLE
   * MCP-server catalog (the SAME scope-aware `{serverId → {serverName, tools}}` snapshot
   * `resolveHubMcpGrants`/the mission-EDIT route's own `mcpServerCatalog` dep read — see
   * `missions/routes.ts`). `proposePlan` projects it once, up front, via `buildPlannerServerCatalog`
   * into the compact {@link HubPlannerServerCatalog}, then (i) injects it into the planner prompt
   * (`buildMissionPlannerPrompt`'s "Grantable MCP servers" section, WP2.2) and (ii) hands it to the
   * INITIAL `clampPlanToBudgets` so a hallucinated/unreachable server id is stripped at PROPOSE time —
   * WP2.2 only caught this at EDIT time. Absent ⇒ the propose path is unchanged (pre-WP2.3 behavior: no
   * catalog section, no propose-time strip — the planner prompt still says "no MCP tools are granted").
   */
  mcpCatalog?: (
    session: HubSession,
  ) => Promise<ReadonlyMap<string, HubMcpServerCatalog>> | ReadonlyMap<string, HubMcpServerCatalog>;
  /**
   * hub-fixes (Defect 1c) — is an MCP server READY to be used by a HEADLESS mission agent this run?
   * `ready:false` when the server is unregistered/deleted OR is an OAuth streamable-HTTP server with no
   * valid token (a background mission child cannot complete the interactive OAuth dance, so its tools
   * would be stripped and the agent would run tool-less — the pre-run gate blocks that instead of silently
   * running a Acme agent with no Acme). Absent ⇒ NO gating (the pre-fix best-effort behavior). Injected by
   * index.ts over `servers` + `oauthService` so the orchestrator stays MCP/OAuth-free (the runtime boundary).
   */
  isServerRunReady?: (serverId: string) => HubServerRunReadiness;
  /** Injectable clock (tests pin `now`). */
  now?: () => string;
  logger?: { warn?: (msg: string) => void };
};

/** In-flight mission control for stop/steer: the mission-level abort + per-agent aborts. */
type RunningMission = {
  missionAbort: AbortController;
  agentAborts: Map<string, AbortController>;
};

/**
 * Crew nesting (WP2.1 / D-CN3) — a tiny async counting semaphore. Created ONCE at the root with the root
 * mission's `maxParallel`, then SHARED across every nested level so global concurrent leaf model calls can
 * never exceed the root's parallelism (never minted fresh per level — the R1 concurrency-multiplication
 * trap). A crew slot delegates without taking a permit; only a LEAF run acquires one, so the tree can never
 * deadlock (leaves always make progress and release). No timers, no I/O — fully deterministic + stub-safe.
 */
export type ConcurrencyLimiter = { acquire: () => Promise<void>; release: () => void };

export function createConcurrencyLimiter(max: number): ConcurrencyLimiter {
  const limit = Math.max(1, Math.floor(Number.isFinite(max) ? max : 1));
  let active = 0;
  const waiters: Array<() => void> = [];
  return {
    acquire: () =>
      new Promise<void>((resolve) => {
        if (active < limit) {
          active++;
          resolve();
        } else {
          waiters.push(resolve);
        }
      }),
    release: () => {
      const next = waiters.shift();
      // Hand the permit straight to the next waiter (active stays == limit); else free it.
      if (next) next();
      else active--;
    },
  };
}

/**
 * Crew nesting (WP2.1 / D-CN3) — the SHARED run-time threaded through EVERY level of a mission tree (root +
 * sub-missions), created once at the root `runMission`. Its shared pieces are the ceiling guarantees:
 *   • `control` — the ROOT {@link RunningMission} registered in `this.running` under the root mission id. WP2.3:
 *     each nested sub-mission registers its OWN control under its own id too, so `stopAgent`/`steerAgent` reach
 *     a nested agent; a top-level `stop(rootId)` still halts the whole tree via the downward missionAbort cascade;
 *   • `cost` — the cumulative LEAF spend across the whole tree (each leaf branch adds to it; a crew slot does
 *     NOT re-add its rolled-up cost — the no-double-count rule);
 *   • `budget` + `tripBudget` — the shared cost cap (the ROOT's, D-CN3 monotonicity — never re-read below the
 *     root) + the trip that aborts every in-flight leaf tree-wide the instant aggregate spend crosses it;
 *   • `leafAborts` — the TREE-WIDE set of in-flight leaf aborts a budget trip iterates (WP2.3): a trip must
 *     abort every in-flight leaf at EVERY level WITHOUT touching a `missionAbort` (a trip is an honest PARTIAL,
 *     never a "stopped"), and under WP2.3's per-level controls no single `agentAborts` map holds them all;
 *   • `limiter` — the shared {@link ConcurrencyLimiter} (root `maxParallel`);
 *   • `leafCount` — the running count of DIRECT leaf agents spawned tree-wide, backstopping `maxTotalAgents`;
 *   • `rootMissionId`/`maxParallel` — pinned root values (`root_mission_id` for child lineage; the per-level
 *     scheduling width falls back to this).
 */
type MissionRunRuntime = {
  control: RunningMission;
  cost: { total: number };
  budget: { tripped: boolean; cap: number };
  tripBudget: () => void;
  limiter: ConcurrencyLimiter;
  leafCount: { total: number };
  leafAborts: Set<AbortController>;
  rootMissionId: string;
  maxParallel: number;
};

/**
 * Crew nesting (WP2.2 / D-CN3) — ONE level's own budget ledger in the cascading meter. The SHARED root
 * ceiling (`runtime.budget` + `tripBudget`, WP2.1) still bounds aggregate tree spend and aborts everything;
 * THIS is the per-level subdivision layered on top so a nested sub-mission trips on its OWN allocation
 * (leaving budget for siblings) and an honest-partial answer surfaces even when the whole-tree cap is not
 * reached. Never re-reads an env cap below the root — `cap` is the root's own cap (root level) or the
 * {@link allocateChildBudget} slice handed down (nested).
 */
type LevelBudget = {
  /** This level's hard cap: the root's `budgetCap` (root) or the allocated `childCap` subdivision (nested). */
  cap: number;
  /** The pool this level may still hand DOWN to crew-ref children — starts at `cap`, decremented at each
   *  crew-ref reservation (at SPAWN, so `sum(child caps) ≤ cap` regardless of parallelism). */
  reservable: number;
  /** This level's OWN subtree spend (its leaves + its crew-ref children's rolled-up subtotals). */
  spent: number;
  /** Set once this level's `spent` crosses `cap` — a SOFT trip that stops launching more slots at this level
   *  (the SHARED root trip, not this, is what aborts in-flight agents tree-wide). */
  tripped: boolean;
  /** A nested crew-ref settled PARTIAL (its own budget tripped / an ancestor aborted it / it was skipped for
   *  a 0 allocation) → this level is honestly partial too, so its synthesis carries `PARTIAL_PREFIX` even
   *  when the parent topology's own produced-count looks complete (a crew-ref still produces ONE report). */
  childPartial: boolean;
  /** Composed predicate (D-CN3): true once THIS level tripped, OR the shared root ceiling tripped, OR any
   *  ANCESTOR level tripped — so a nested strategy stops the instant an ancestor exhausts its allocation. */
  isTripped: () => boolean;
};

/** Crew nesting (WP2.1/WP2.2/WP2.3) — one level's position in the nested tree: its depth (root = 0), the set
 *  of crewIds already on the path from the root (the run-time cycle guard, D-CN4), its own budget ledger (the
 *  cascading meter, WP2.2), its own run-CONTROL (WP2.3 — the {@link RunningMission} registered in `this.running`
 *  under this level's mission id; the root shares `runtime.control`, a nested level gets a fresh one whose
 *  `missionAbort` is chained DOWNWARD from the enclosing abort), and its INJECTED `parentScope` (WP2.3 / D-CN9 —
 *  the already-effective grants that bound this level's child spawns: the root chat session's scope at the root,
 *  the enclosing crew-ref slot's `L1 ∩ L0 …` at a nested level, NEVER re-derived from the D-CN6 root session). */
type MissionLevel = {
  depth: number;
  visitedCrewIds: ReadonlySet<string>;
  budget: LevelBudget;
  control: RunningMission;
  parentScope: HubToolGrants | null;
  /** Crew nesting (WP3.1 / D-CN7, R-SES1) — this level's own event parent-linkage, stamped onto every
   *  `agent_spawned` this level emits so the board reducer can reconstruct the tree from `hub_events`
   *  alone. Absent at the root (⇒ root spawns read as top-level); set to the expanding mission id + the
   *  crew-node slot's `key` at a nested level (see `runSubCrew`). */
  parentMissionId?: string;
  parentAgentKey?: string;
};

/** Crew nesting (WP2.1) — what one mission LEVEL hands back to its caller: the settled mission row (the root
 *  returns it; a sub-crew reads its rolled-up cost), the reports the synthesis composed from (for a parent
 *  crew-ref projection), the honest partial flag, the synthesis cost + message id (the sub-synthesis prose is
 *  read back by id), and whether the level was stopped. */
type MissionLevelOutcome = {
  mission: HubMission;
  synthesisReports: HubAgentReport[];
  partial: boolean;
  synthCost: number;
  synthesisMessageId: string;
  aborted: boolean;
};

/** The "no provider identity known" map — one frozen instance so the absent-seam path allocates nothing
 *  and every identity check below degrades to its documented pre-WP4.2 answer. */
const EMPTY_CREDENTIAL_KINDS: ReadonlyMap<string, ProviderKind> = new Map();

export class HubMissionService {
  private readonly running = new Map<string, RunningMission>();

  constructor(private readonly deps: HubMissionServiceDeps) {}

  private nowIso(): string {
    return this.deps.now?.() ?? new Date().toISOString();
  }

  private get caps(): HubMissionCaps {
    return this.deps.config;
  }

  // ── model-identity WP4.2 (D-MI4) — provider identity, the one fact a model id cannot carry ────────

  /** The hub-eligible credentials as `id → kind`. Never throws and never partially fails: an absent or
   *  misbehaving seam yields an empty map, which every caller below reads as "no provider identity is
   *  known", i.e. exactly pre-WP4.2 behaviour. */
  private credentialKinds(): ReadonlyMap<string, ProviderKind> {
    try {
      return this.deps.providerCredentialKinds?.() ?? EMPTY_CREDENTIAL_KINDS;
    } catch {
      return EMPTY_CREDENTIAL_KINDS;
    }
  }

  /** Whether a model + pin will run on the Claude-subscription (Agent-SDK) executor — the one transport
   *  with no `generateObject`. An UNPINNED ref is never subscription-backed: the name heuristic's return
   *  type structurally excludes `claude_subscription` (README §1), which is the original defect. */
  private isSubscriptionRef(ref: HubModelRef, kinds = this.credentialKinds()): boolean {
    if (!ref.providerCredentialId) return false;
    return kinds.get(ref.providerCredentialId) === "claude_subscription";
  }

  /** The credential-aware {@link isStructuredOutputModel} — the predicate every "can this model run the
   *  auxiliary structured call?" decision in this file goes through (D-MI4). */
  private canStructureOutput(ref: HubModelRef, kinds = this.credentialKinds()): boolean {
    const kind = ref.providerCredentialId ? kinds.get(ref.providerCredentialId) : undefined;
    return isStructuredOutputModel(ref.model, kind);
  }

  /** The plan's agent models as credential-carrying refs, in plan order (crew-ref placeholders — which
   *  carry no model of their own — dropped). */
  private planModelRefs(plan: HubMissionPlan): HubModelRef[] {
    return plan.agents
      .filter((agent) => (agent.model ?? "").trim() !== "")
      .map((agent) => ({
        model: agent.model,
        ...(agent.providerCredentialId ? { providerCredentialId: agent.providerCredentialId } : {}),
      }));
  }

  /** The parent (mission) session as a ref — its model plus its persisted pin (v55). */
  private sessionModelRef(sessionId: string): HubModelRef {
    const session = this.deps.repository.getSession(sessionId);
    return {
      model: session.model,
      ...(session.providerCredentialId ? { providerCredentialId: session.providerCredentialId } : {}),
    };
  }

  /**
   * The model an AUXILIARY structured call (a mission agent's report extraction, the best-of-N judge)
   * should run on: the parent session's own model when it can do structured output, else the first plan
   * model that can, else the session model anyway — where the caller's documented fallback
   * (deterministic projection / deterministic winner) still yields an honest result. Reuses
   * {@link pickSynthesisModel}'s preference order deliberately, so "which model runs the side call" is
   * decided in ONE place for all three side calls.
   */
  private pickAuxiliaryModel(plan: HubMissionPlan, sessionId: string): HubModelRef {
    const kinds = this.credentialKinds();
    return pickSynthesisModel({
      session: this.sessionModelRef(sessionId),
      planModels: this.planModelRefs(plan),
      isStructured: (ref) => this.canStructureOutput(ref, kinds),
    });
  }

  // ── Propose (in-band planner turn) ──────────────────────────────────────────────────────────────

  /**
   * Run the planner turn for a mission-mode session's prompt: persist the ask, produce a structured
   * plan (clamped to the hard caps), create the `hub_missions` row, and emit `plan_proposed`. Resolves
   * the autonomy dial: `auto` (or `threshold` under its ceilings) AUTO-APPROVES + runs the mission here
   * (awaiting the whole flow); otherwise it settles the planning turn and waits for explicit approval.
   */
  async proposePlan(input: {
    sessionId: string;
    text: string;
    sink: HubTurnSink;
    /** WP2.2 — instantiate a SAVED CREW (D-AH7) into the plan instead of running the planner model. Falls
     *  back to the session's own `crewId`; absent/unresolvable ⇒ the planner path. */
    crewId?: string;
    /** End-user UX pass — an EXPLICIT list of saved-agent ids (the prompt's `@`-mentions) to hand the
     *  task to, deterministically (no planner). Takes PRECEDENCE over `crewId`/the planner, and is
     *  allowed in ANY session mode (unlike the planner path, which needs mission/auto). */
    agentIds?: string[];
    /** hub-fixes WP6.1 (RC7) — whether to persist + forward the user's ask as a `user_message` here.
     *  Default `true` (the mission-mode route path: the ask has not been recorded yet). The `auto`-mode
     *  post-turn BRIDGE (`session-service.dispatchMessage`) passes `false` because `dispatchMessage`
     *  already persisted the user's ask before running the routing turn — echoing it again would
     *  double it in the transcript. */
    echoUserMessage?: boolean;
    /** model-identity WP6.1 (F7) — the composer's per-request model override for the PLANNER turn (and
     *  the substitution fallback below). Absent ⇒ `session.model`, byte-identical to before. */
    model?: string;
    /** The credential owning {@link model} — resolved against the session's pin by `pinForModel`, so a
     *  model override with no pin of its own does NOT inherit a pin chosen for a different model. */
    providerCredentialId?: string;
  }): Promise<HubMission> {
    const session = this.deps.repository.getSession(input.sessionId);
    // hub-fixes WP6.1 (RC7) — `auto` sessions may propose too (the model routes a mission-shaped ask via
    // the `mission.propose_plan` builtin; the session-service bridge calls this). `mission` mode is
    // unchanged; `chat`/`research` still cannot propose via the planner path. End-user UX pass: an
    // EXPLICIT `@`-mention handoff (`agentIds`) is allowed from ANY mode — the user named the team, so
    // there is no planner-routing to gate on mode.
    if (
      !(input.agentIds && input.agentIds.length > 0) &&
      session.mode !== "mission" &&
      session.mode !== "auto"
    ) {
      throw httpError(400, "Missions can only be proposed in a mission-mode or auto-mode session.");
    }
    if (session.kind !== "chat") {
      throw httpError(400, "A mission can only be proposed from a top-level chat session.");
    }
    const existing = this.deps.repository.getMissionBySession(input.sessionId);
    if (existing && !isTerminalMissionStatus(existing.status)) {
      throw httpError(409, "This session already has a mission in progress. Stop it before proposing another.");
    }

    const autonomy: HubAutonomyLevel = session.autonomy ?? this.deps.config.defaultAutonomy;

    // model-identity WP6.1 (F7) — the model/credential THIS propose runs on: the composer's explicit
    // pick when it sent one, else the session's own. `pinForModel` applies the pin-staleness rule, so
    // overriding the model without naming a pin drops the session's (chosen for a different model)
    // rather than silently pairing it with the new one.
    const effectiveModel = input.model?.trim() || session.model;
    const effectivePin = pinForModel(effectiveModel, [
      { model: input.model?.trim(), pin: input.providerCredentialId },
      { model: session.model, pin: session.providerCredentialId },
    ]);

    // Deterministic auto-title from the mission ask (R-SES5) — only while the title is still pending
    // (a manual/auto title is never clobbered). The LLM refine is a later WP's concern.
    if (session.titleState === "pending") {
      const title = hubDeterministicTitle(input.text);
      if (title) this.deps.repository.setAutoTitle(input.sessionId, title);
    }

    // Persist + forward the user's mission ask (a real user turn in the transcript). hub-fixes WP6.1
    // (RC7): the `auto`-mode bridge already persisted the ask before its routing turn, so it passes
    // `echoUserMessage: false` to avoid doubling the message.
    if (input.echoUserMessage !== false) {
      const userEvent = this.deps.repository.appendEvent(input.sessionId, {
        type: "user_message",
        messageId: nanoid(),
        text: input.text,
      });
      input.sink.onEvent(userEvent);
    }

    // hub-fixes WP2.3 (RC2.4 carry-forward) — the parent's grantable-server catalog, built ONCE so both
    // the planner prompt injection (`runPlanner`) and the initial clamp below see the identical snapshot.
    // Absent `mcpCatalog` dep ⇒ undefined (pre-WP2.3 propose path, unchanged).
    const serverCatalog: HubPlannerServerCatalog | undefined = this.deps.mcpCatalog
      ? buildPlannerServerCatalog(await this.deps.mcpCatalog(session))
      : undefined;

    // ── Produce the raw plan: from EXPLICIT `@`-mentioned agents (end-user UX pass, deterministic — no
    //    model call, takes precedence), else from a SAVED CREW when one is named (D-AH7, deterministic),
    //    else from the planner model (structured output behind the DI seam). Either way it is HARD-CLAMPED
    //    to the caps below (D-AH9). On the planner path, the session's Agents & Crews ROSTER (end-user UX
    //    pass) is a PREFERRED POOL: it seeds the planner prompt and any saved role the planner reuses is
    //    hydrated from the library.
    const crewId = input.crewId ?? session.crewId ?? undefined;
    let rawPlan: HubMissionPlan;
    if (input.agentIds && input.agentIds.length > 0) {
      rawPlan = this.instantiateAgents(input.agentIds, input.text, autonomy);
    } else if (crewId !== undefined) {
      rawPlan = this.instantiateCrew(crewId, input.text, autonomy);
    } else {
      const resolvedRoster =
        session.roster && this.deps.resolveRoster
          ? this.deps.resolveRoster(session.roster)
          : undefined;
      const rosterCatalog =
        resolvedRoster && (resolvedRoster.roles.length > 0 || resolvedRoster.crews.length > 0)
          ? buildPlannerRosterCatalog(resolvedRoster)
          : undefined;
      rawPlan = await this.runPlanner(
        session,
        input.text,
        serverCatalog,
        rosterCatalog,
        effectiveModel,
        effectivePin,
      );
      if (resolvedRoster) rawPlan = hydrateRosterRoles(rawPlan, resolvedRoster);
    }
    // The "balanced" guard (owner decision): before the clamp, replace any agent model that is a bare
    // tier label or empty with the session's own model so a non-resolvable model can never reach a
    // child session — recorded loudly on the plan card. Applies to the crew path too (a no-op when
    // every model is concrete). Runs BEFORE the clamp so its note survives the clamp's own note strip.
    // model-identity WP6.1 (F12) — the substituted model is the one THIS propose runs on, so the
    // credential that owns it is that pair's pin; passing it stops the safety net re-routing a
    // subscription-pinned parent's agent to the metered twin. Absent ⇒ the substituted agent is
    // unpinned ⇒ the unchanged heuristic.
    rawPlan = normalizePlannedModels(rawPlan, effectiveModel, effectivePin).plan;
    // model-identity WP4.2 (D-MI1/D-MI9) — strip any `providerCredentialId` that names a credential
    // which does not exist. The roster now SHOWS a `pin=` for a colliding model id (so the planner can
    // say "the subscription Sonnet" without namespacing the id), and anything a model can copy it can
    // also invent — while D-MI9 turns an unresolvable pin into a 409 at turn time. Stripping mirrors
    // `clampGrantsToCatalog`'s treatment of an invented server id. Runs BEFORE the clamp so the note
    // survives the clamp's own strip, exactly like the model-check note above.
    rawPlan = clampPlannedCredentials(rawPlan, new Set(this.credentialKinds().keys())).plan;
    // model-identity WP6.1 (F6, D-MI11) — the UNPRICED-BY-DESIGN path: name any agent whose model has
    // no published price in a loud `⚠ Price check:` note ("not priced", never a silent $0), and record
    // that the cost estimate is INCOMPLETE so the autonomy threshold below refuses to compare planned
    // spend against a meaningless total. Runs before the clamp so the note survives its strip.
    const pricing = notePlanPricingGaps(rawPlan);
    rawPlan = pricing.plan;
    const costEstimateComplete = pricing.unpriced.length === 0;
    const plan = clampPlanToBudgets(rawPlan, this.caps, autonomy, serverCatalog);

    const mission = this.deps.repository.createMission({
      sessionId: input.sessionId,
      topology: plan.topology,
      autonomy,
      plan,
      ...(plan.budgets ? { budgets: plan.budgets } : {}),
    });

    const proposed = this.deps.repository.appendEvent(input.sessionId, {
      type: "plan_proposed",
      missionId: mission.id,
      plan,
    });
    input.sink.onEvent(proposed);

    // Crew nesting (WP2.2 / D-CN3, closing R4/R1) — the auto-approve/estimate/agent-count gate is a
    // WHOLE-TREE decision: resolve the fully nested crew tree ONCE (transitive leaf count, deepest crew
    // level, allocation-bounded cost) and gate on THAT, not the root's direct-member view — so a crew whose
    // two `crewId` members hide hundreds of transitive agents can never auto-launch on a small root count.
    // The root allocation is the ALREADY-CLAMPED `plan.budgets.maxCostUsd` (= min(rootRequested,
    // caps.maxBudgetUsd)); reading it here re-derives NO env cap below the root (D-CN3 monotonicity).
    const tree = summarizeMissionTree(
      {
        agents: plan.agents,
        rootAllocationUsd: plan.budgets?.maxCostUsd ?? 0,
        resolveCrew: (crewId) => this.deps.resolveCrew?.(crewId),
      },
      this.caps,
    );
    const maxTotalAgents = this.caps.maxTotalAgents ?? HUB_MISSION_MAX_TOTAL_AGENTS;
    // D-CN4 whole-tree total-agent backstop at PROPOSE — a tree over the cap throws LOUDLY (never a silent
    // subtree drop). The run-time backstop (`runSubCrew`) still defends a graph mutated after this check.
    if (tree.transitiveAgentCount > maxTotalAgents) {
      throw httpError(
        400,
        `This mission would run ${tree.transitiveAgentCount} agents across its nested crews — over the limit of ${maxTotalAgents}. Trim the crew tree before running it.`,
      );
    }
    // Defensive depth backstop (the primary run-time depth guard is the recursion engine's): the walk is
    // itself depth-capped, so this holds unless a resolver bug slips a too-deep branch through.
    const maxDepth = this.caps.maxDepth ?? HUB_MISSION_MAX_DEPTH;
    if (tree.maxDepth > maxDepth) {
      throw httpError(
        400,
        `This mission's crew nesting is ${tree.maxDepth} levels deep — over the limit of ${maxDepth}.`,
      );
    }
    if (
      shouldAutoApprove(autonomy, tree.transitiveAgentCount, tree.estimatedCostUsd, this.caps, {
        costEstimateComplete,
      })
    ) {
      await this.approve({ missionId: mission.id, sink: input.sink, auto: true });
    } else {
      // Settle the planning turn so the composer frees while the operator reviews the plan.
      const settle = this.deps.repository.appendEvent(input.sessionId, { type: "turn_done" });
      input.sink.onEvent(settle);
    }
    return this.deps.repository.getMission(mission.id);
  }

  /**
   * Run the planner model (structured output behind the DI seam) to produce a raw plan.
   *
   * hub-fixes WP2.3 (RC2.4 carry-forward) — `serverCatalog`, when supplied by the caller
   * ({@link proposePlan}, built once from `deps.mcpCatalog`), is injected into the planner prompt's
   * "Grantable MCP servers" section (WP2.2's `buildMissionPlannerPrompt`) so the planner proposes REAL
   * grants for real reachable servers instead of the pre-fix "no MCP tools are granted" fallback.
   */
  private async runPlanner(
    session: HubSession,
    text: string,
    serverCatalog?: HubPlannerServerCatalog,
    rosterCatalog?: HubPlannerRosterCatalog,
    /** model-identity WP6.1 (F7) — the effective model/pin for THIS propose (the composer's override,
     *  else the session's own). Optional so every existing caller/test is unchanged. */
    modelOverride?: string,
    providerCredentialIdOverride?: string,
  ): Promise<HubMissionPlan> {
    const rosterText = this.deps.roster ? await this.deps.roster() : undefined;
    const systemPrompt = buildMissionPlannerPrompt({
      session,
      caps: this.caps,
      ...(rosterText ? { roster: rosterText } : {}),
      now: this.nowIso().slice(0, 10),
      ...(serverCatalog ? { serverCatalog } : {}),
      ...(rosterCatalog ? { rosterCatalog } : {}),
    });
    // assistant-hub v1-fixes (F7) — seed the planner with read-only session context (the latest mission
    // digest + recent turns) so a FOLLOW-UP mission's briefs build on what the previous agents actually
    // found instead of replanning from the bare ask. Bounded + pure (`buildPlannerSessionContext`).
    const context = buildPlannerSessionContext(this.deps.repository.listEvents(session.id), {
      currentAsk: text,
    });
    // model-identity WP4.2 (D-MI1) — the planner runs on the PARENT session's model; carry its
    // persisted pin so the resolver honours (or honestly refuses) the operator's provider choice rather
    // than silently routing the plan onto the metered twin of the same model name.
    //
    // WP6.1 (F7) — the caller (`proposePlan`) has ALREADY resolved the effective pair through
    // `pinForModel`, so the overrides are used verbatim rather than re-deriving the staleness rule here
    // (one rule, one place). Both absent ⇒ the session's own pair, byte-identical to before.
    const plannerModel = modelOverride ?? session.model;
    const plannerPin = modelOverride
      ? providerCredentialIdOverride
      : (session.providerCredentialId ?? undefined);
    return this.deps.planner({
      systemPrompt,
      userText: text,
      model: plannerModel,
      ...(plannerPin ? { providerCredentialId: plannerPin } : {}),
      ...(context ? { context } : {}),
    });
  }

  /**
   * WP2.2 — expand a SAVED CREW (D-AH7) into a raw plan deterministically (no model call). Throws a 404 if
   * the crew is unresolvable (`resolveCrew` absent/returns undefined) so a bad `crewId` fails loudly
   * rather than silently falling back to an unrelated planner run. `instantiateCrewPlan` skips
   * deleted-role members and 400s an empty crew; the clamp then applies the caps.
   */
  private instantiateCrew(crewId: string, text: string, autonomy: HubAutonomyLevel): HubMissionPlan {
    const resolved = this.deps.resolveCrew?.(crewId);
    if (!resolved) {
      throw httpError(404, "That saved crew could not be found.");
    }
    return instantiateCrewPlan({
      crew: resolved.crew,
      roles: resolved.roles,
      ask: text,
      autonomy,
      // Crew nesting (WP2.1 / D-CN2) — resolve a nested-crew member's real display name for the plan card
      // (the recursion engine re-resolves it when it expands the sub-mission; the label is cosmetic here).
      resolveCrewName: (id) => this.deps.resolveCrew?.(id)?.crew.name,
    });
  }

  /**
   * End-user UX pass — turn the prompt's `@`-mentioned agent ids into a raw plan deterministically (no
   * model call). Resolves ids via `resolveAgents` (order preserved, deleted/unknown ids dropped); a 404
   * if the dep is absent, a 400 (via `instantiateAgentsPlan`) if nothing resolves. One agent = a single
   * direct handoff, N = a parallel team; the clamp then applies the caps.
   */
  private instantiateAgents(agentIds: string[], text: string, autonomy: HubAutonomyLevel): HubMissionPlan {
    const roles = this.deps.resolveAgents?.(agentIds);
    if (!roles) {
      throw httpError(404, "Agent handoff is not available.");
    }
    return instantiateAgentsPlan({ roles, ask: text, autonomy });
  }

  // ── Edit the plan (only while proposed) ─────────────────────────────────────────────────────────

  /** Replace a still-`proposed` mission's plan (the editable Plan card / `PATCH`). Re-clamps to the
   *  hard caps and emits `plan_updated`. 409 once the mission is approved/running (the plan is frozen). */
  editPlan(input: { missionId: string; plan: HubMissionPlan; sink: HubTurnSink }): HubMission {
    const mission = this.deps.repository.getMission(input.missionId);
    if (mission.status !== "proposed") {
      throw httpError(409, "This mission's plan is frozen — it has already been approved.");
    }
    const clamped = clampPlanToBudgets(input.plan, this.caps, mission.autonomy);
    const updated = this.deps.repository.updateMission(input.missionId, {
      plan: clamped,
      ...(clamped.budgets ? { budgets: clamped.budgets } : {}),
    });
    const event = this.deps.repository.appendEvent(mission.sessionId, {
      type: "plan_updated",
      missionId: mission.id,
      plan: clamped,
      editedBy: "user",
    });
    input.sink.onEvent(event);
    return updated;
  }

  // ── Approve + run ───────────────────────────────────────────────────────────────────────────────

  /**
   * Approve a `proposed` mission and RUN it to completion (spawn parallel child sessions honoring the
   * caps → collect structured reports → synthesize). Awaited by tests; the route fire-and-forgets it.
   * 409 if the mission is not `proposed`.
   */
  async approve(input: { missionId: string; sink: HubTurnSink; auto?: boolean }): Promise<HubMission> {
    const mission = this.deps.repository.getMission(input.missionId);
    if (mission.status !== "proposed") {
      throw httpError(409, `This mission cannot be approved (status: ${mission.status}).`);
    }
    // hub-fixes (Defect 1c) — pre-run readiness gate: never spawn a mission agent whose granted MCP server
    // is unauthenticated/unreachable (it would run tool-less). Block with a recoverable, actionable error
    // and leave the mission `proposed` so it can be re-approved once the server is connected.
    const unready = this.missionUnreadyServers(mission);
    if (unready.length > 0) {
      const names = unready.map((s) => s.serverName ?? s.serverId).join(", ");
      const errorEvent = this.deps.repository.appendEvent(mission.sessionId, {
        type: "error",
        message: `Connect ${names} before running this mission — an MCP server this plan grants is not authenticated. Authenticate it in Settings, then approve the plan again.`,
        authRequired: true,
        serverIds: unready.map((s) => s.serverId),
      });
      input.sink.onEvent(errorEvent);
      // Under an AUTO approval the planning turn is still open (proposePlan skipped its own turn_done) —
      // settle it so the composer frees. A MANUAL approve already settled the planning turn at propose time.
      if (input.auto) {
        const settle = this.deps.repository.appendEvent(mission.sessionId, { type: "turn_done" });
        input.sink.onEvent(settle);
      }
      return mission; // still `proposed` — re-approvable once the server is authenticated
    }
    const approved = this.deps.repository.appendEvent(mission.sessionId, {
      type: "plan_approved",
      missionId: mission.id,
      autonomy: mission.autonomy,
      approvedBy: input.auto ? "system" : "user",
      auto: input.auto === true,
    });
    input.sink.onEvent(approved);
    this.deps.repository.updateMission(mission.id, { status: "approved" });
    return this.runMission(mission.id, input.sink);
  }

  /**
   * hub-fixes (Defect 1c) + Crew nesting (WP2.3 / D-CN9) — the distinct MCP servers a mission's WHOLE crew
   * tree grants (each agent's EFFECTIVE grants = plan grants ∩ the transitively-intersected parent scope down
   * its path) that are NOT ready to run headlessly (unregistered, or an OAuth server with no token). Empty when
   * the readiness dep is absent (no gating) or every reachable server is ready. Deduped by serverId; each
   * checked once. `approve()` blocks the WHOLE tree with the actionable auth-required error naming a NESTED
   * server too — WP2.2 only caught it if the ROOT plan named it directly.
   *
   * The walk recurses a crew-ref unit via the WP1.1 cycle-safe `resolveCrew` + `instantiateCrewPlan`, under the
   * SAME run-time visited-set + depth guard the recursion engine uses (D-CN4 belt-and-suspenders — a mutated/
   * cyclic graph can never loop the gate). A server dropped by intersection at ANY level is unreachable and
   * correctly NOT flagged; an over-depth / cyclic / unresolvable / unusable crew branch is skipped here (the
   * run rejects it loudly — it is not a readiness concern).
   */
  private missionUnreadyServers(mission: HubMission): { serverId: string; serverName?: string }[] {
    const isReady = this.deps.isServerRunReady;
    if (!isReady) return [];
    const rootScope: HubToolGrants | null =
      this.deps.repository.getSession(mission.sessionId).toolScope ?? null;
    const maxDepth = this.caps.maxDepth ?? HUB_MISSION_MAX_DEPTH;
    const serverIds = new Set<string>();

    const collect = (
      agents: readonly HubPlannedAgent[],
      parentScope: HubToolGrants | null,
      depth: number,
      visitedCrewIds: ReadonlySet<string>,
    ): void => {
      for (const planned of agents) {
        if (planned.crewId === undefined) {
          // Leaf — its effective server grants intersect this path's already-composed parent scope.
          const effective = effectiveAgentGrants(planned.toolGrants, parentScope);
          for (const serverId of Object.keys(effective.servers)) serverIds.add(serverId);
          continue;
        }
        // Crew-ref — recurse under the depth (root=0, +1 per crewId; `>= maxDepth` rejects, mirroring
        // `runSubCrew`) + path-cycle guard. A branch the run would reject is not a readiness concern.
        const crewId = planned.crewId;
        if (depth + 1 >= maxDepth || visitedCrewIds.has(crewId)) continue;
        const resolved = this.deps.resolveCrew?.(crewId);
        if (!resolved) continue;
        let childPlan: HubMissionPlan;
        try {
          childPlan = instantiateCrewPlan({
            crew: resolved.crew,
            roles: resolved.roles,
            ask: "",
            autonomy: mission.autonomy,
            resolveCrewName: (id) => this.deps.resolveCrew?.(id)?.crew.name,
          });
        } catch {
          continue; // an unusable crew (e.g. every role deleted) — the run rejects it, not the gate
        }
        collect(
          childPlan.agents,
          subCrewParentScope(planned.toolGrants, parentScope),
          depth + 1,
          new Set([...visitedCrewIds, crewId]),
        );
      }
    };
    collect(mission.plan.agents, rootScope, 0, new Set<string>());

    const unready: { serverId: string; serverName?: string }[] = [];
    for (const serverId of serverIds) {
      const readiness = isReady(serverId);
      if (!readiness.ready) {
        unready.push({
          serverId,
          ...(readiness.serverName ? { serverName: readiness.serverName } : {}),
        });
      }
    }
    return unready;
  }

  // ── Stop ────────────────────────────────────────────────────────────────────────────────────────

  /** Stop a mission: abort a RUNNING mission (in-flight agents settle → partial synthesis, R-UX9); a
   *  still-`proposed` one is simply cancelled to `stopped`. Idempotent no-op once terminal. */
  stop(missionId: string): void {
    const running = this.running.get(missionId);
    if (running) {
      running.missionAbort.abort();
      return;
    }
    const mission = this.deps.repository.getMission(missionId);
    if (!isTerminalMissionStatus(mission.status) && mission.status === "proposed") {
      this.deps.repository.updateMission(missionId, { status: "stopped", endedAt: this.nowIso() });
    }
  }

  /** Stop ONE agent mid-flight (the per-agent card's stop). The agent settles with no report (→ the
   *  mission ends partial); the others continue. */
  stopAgent(missionId: string, agentSessionId: string): void {
    this.running.get(missionId)?.agentAborts.get(agentSessionId)?.abort();
  }

  /**
   * WP2.3 (R-SES3 / R-UX4) — steer ONE running mission agent: persist a DURABLE `queued_user_message`
   * on its CHILD session (survives restart; losing it is a bug), the same steering-queue event a chat
   * turn injects at a step boundary. Returns the settled event.
   *
   * v1 honesty (flagged): the production agent runner is a ONE-SHOT structured-output call
   * (`createStructuredAgentRunner` — `generateObject`), so it does NOT re-read this message mid-flight;
   * the message is durably queued on the child and surfaces in the child session's replay, ready for a
   * future iterative (turn-engine-based) agent runner to drain via `HubSteeringQueue.seedFromEvents`.
   * The fully-live steering path is a CHAT/research session (WP1.1's `HubSteeringQueue`).
   */
  steerAgent(missionId: string, agentSessionId: string, text: string): HubEvent {
    const mission = this.deps.repository.getMission(missionId); // 404 if unknown
    if (!this.running.has(missionId)) {
      throw httpError(409, "This mission is not running — there is no agent to steer.");
    }
    const child = this.deps.repository.getSession(agentSessionId); // 404 if unknown
    if (child.kind !== "agent" || child.missionId !== mission.id) {
      throw httpError(400, "That session is not an agent of this mission.");
    }
    if (child.status !== "running") {
      throw httpError(409, "That agent is no longer running — it cannot be steered.");
    }
    return this.deps.repository.appendEvent(agentSessionId, {
      type: "queued_user_message",
      queuedMessageId: nanoid(),
      text,
    });
  }

  isRunning(missionId: string): boolean {
    return this.running.has(missionId);
  }

  // ── The run flow (spawn → pool with caps + budget → synthesize) ─────────────────────────────────

  private async runMission(missionId: string, sink: HubTurnSink): Promise<HubMission> {
    const mission = this.deps.repository.getMission(missionId);
    const plan = mission.plan;
    const control: RunningMission = { missionAbort: new AbortController(), agentAborts: new Map() };
    // The ROOT control is registered under the root id; each nested sub-mission registers its OWN control
    // under its own id (WP2.3, in `runSubCrew`) so `stopAgent`/`steerAgent(subMissionId, …)` reach a nested
    // agent, while a top-level `stop(rootId)` still halts the whole tree via the downward missionAbort cascade.
    this.running.set(missionId, control);

    // Crew nesting (WP2.3) — the TREE-WIDE set of in-flight LEAF aborts a budget trip iterates. A trip must
    // abort every in-flight leaf across ALL levels WITHOUT touching any level's `missionAbort` (a trip is an
    // honest PARTIAL, never a "stopped"); under WP2.3's per-level controls no single `agentAborts` holds them
    // all, so the trip target is this shared set (a root-only mission's set == the root leaves — byte-identical).
    const leafAborts = new Set<AbortController>();

    // ── The SHARED run-time (WP2.1 / D-CN3) — created ONCE at the root, threaded through every level so the
    //    cost cap, abort, concurrency and leaf-count ceilings are enforced tree-wide, never minted per level.
    //    The cap + maxParallel are read from the ROOT plan/caps ONLY (D-CN3 monotonicity — never below root).
    const budgetCap = plan.budgets?.maxCostUsd ?? this.caps.defaultBudgetUsd;
    const maxParallel = plan.budgets?.maxParallel ?? this.caps.maxParallel;
    const budget = { tripped: false, cap: budgetCap };
    const tripBudget = (): void => {
      budget.tripped = true;
      for (const ab of leafAborts) ab.abort();
    };
    const runtime: MissionRunRuntime = {
      control,
      cost: { total: 0 },
      budget,
      tripBudget,
      limiter: createConcurrencyLimiter(maxParallel),
      leafCount: { total: 0 },
      leafAborts,
      rootMissionId: missionId,
      maxParallel,
    };

    try {
      const ask = firstUserText(this.deps.repository, mission.sessionId);
      // Crew nesting (WP2.2 / D-CN3) — the ROOT level budget: cap = the root `budgetCap`, `reservableUsd`
      // = budgetCap (the per-mission ledger, decremented as each crew-ref is allocated). Its `isTripped`
      // is the shared root trip; nested levels compose their own soft trip ON TOP of it (via
      // `makeLevelBudget`), never re-reading an env cap below the root.
      const rootBudget = makeLevelBudget(
        budgetCap,
        () => runtime.budget.tripped,
        () => false,
      );
      // Crew nesting (WP2.3) — the ROOT level shares `runtime.control` (its `this.running[rootId]` entry) and
      // its `parentScope` is the ROOT chat session's own scope — exactly what the pre-WP2.3 `runMissionLevel`
      // read from `getSession(mission.sessionId).toolScope`, so the top-level mission is byte-identical.
      const outcome = await this.runMissionLevel(
        mission,
        runtime,
        {
          depth: 0,
          visitedCrewIds: new Set<string>(),
          budget: rootBudget,
          control,
          parentScope: this.deps.repository.getSession(mission.sessionId).toolScope ?? null,
        },
        ask,
        sink,
      );
      return outcome.mission;
    } catch (error) {
      this.deps.logger?.warn?.(
        `[hub mission ${missionId}] run failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      this.deps.repository.updateMission(missionId, { status: "failed", endedAt: this.nowIso() });
      const event = this.deps.repository.appendEvent(mission.sessionId, {
        type: "error",
        message: "The mission failed to run to completion.",
        recoverable: false,
      });
      sink.onEvent(event);
      return this.deps.repository.getMission(missionId);
    } finally {
      this.running.delete(missionId);
    }
  }

  /**
   * Crew nesting (WP2.1 / D-CN2) — run ONE mission LEVEL (the root, or a sub-mission) end to end: spawn a
   * child hub session per planned unit, dispatch the level's TOPOLOGY strategy through the SHARED `runSlot`
   * (which branches leaf-vs-sub-crew), settle skipped children, synthesise, and stamp the level's mission row.
   * This is the exact former `runMission` body, made recursion-safe: it closes over the SHARED `runtime`
   * (abort/cost/limiter/trip/leaf-count) rather than minting per-level state, and it takes `ask` explicitly
   * (the root passes the first user turn; a sub-mission passes its curated brief — D-CN9 isolation, no parent
   * transcript). Returns the level's synth outcome so a parent crew-ref can project it into one report.
   */
  private async runMissionLevel(
    mission: HubMission,
    runtime: MissionRunRuntime,
    level: MissionLevel,
    ask: string,
    sink: HubTurnSink,
  ): Promise<MissionLevelOutcome> {
    const plan = mission.plan;
    const missionAbort = level.control.missionAbort;
    const costBefore = runtime.cost.total;

    // Crew nesting (WP2.3 / D-CN9) — the scope that bounds every child's effective grants at THIS level is the
    // level's INJECTED `parentScope`: the ROOT chat session's own scope at the root, and each nested level's
    // enclosing crew-ref slot's already-effective grants (`L1 ∩ L0 …`). It is NEVER re-derived from
    // `getSession(mission.sessionId).toolScope` below the root — `mission.sessionId` is the ROOT chat session at
    // every depth (D-CN6), so reading it would RE-WIDEN a nested spawn back to level-0 (the R6 escalation).
    // `effectiveAgentGrants`: plan grants ∩ parent scope; `null` parent/"auto" ⇒ pass-through.
    const parentScope: HubToolGrants | null = level.parentScope;

    // Spawn a child hub session per planned unit (kind:'agent', parent+mission linkage) — a crew-ref unit
    // gets a CONTAINER child session too (the sub-mission's rolled-up report is stamped onto it). Then emit
    // `agent_spawned` for each + `mission_started` — all into the PARENT log (the board's home).
    const spawned = plan.agents.map((planned, index) => {
      const effectiveGrants = effectiveAgentGrants(planned.toolGrants, parentScope);
      const child = this.deps.repository.createSession({
        mode: "chat",
        model: planned.model,
        kind: "agent",
        parentSessionId: mission.sessionId,
        missionId: mission.id,
        title: plannedAgentLabel(planned),
        toolScope: effectiveGrants,
        // model-identity WP2.1 (D-MI1) — carry the planned agent's credential onto its child session, so
        // `runAgentTurn` resolves against the credential the plan actually chose instead of re-guessing
        // from the model name. Absent on the plan ⇒ NULL ⇒ the unchanged heuristic.
        ...(planned.providerCredentialId
          ? { providerCredentialId: planned.providerCredentialId }
          : {}),
      });
      return { planned, effectiveGrants, child, index };
    });
    const agentSessionIds = spawned.map((s) => s.child.id);
    this.deps.repository.updateMission(mission.id, {
      status: "running",
      startedAt: this.nowIso(),
      agentSessionIds,
    });
    for (const { planned, effectiveGrants, child, index } of spawned) {
      const narrowingNote = describeGrantNarrowing(planned.toolGrants, effectiveGrants);
      const event = this.deps.repository.appendEvent(mission.sessionId, {
        type: "agent_spawned",
        missionId: mission.id,
        agentSessionId: child.id,
        key: planned.key,
        roleName: plannedAgentLabel(planned),
        model: planned.model,
        brief: narrowingNote ? `${planned.brief}\n\n${narrowingNote}` : planned.brief,
        index,
        // Crew nesting (WP3.1 / D-CN7, R-SES1) — a nested level stamps its parent-linkage on every spawn
        // (the belt-and-suspenders mirror of the sub-mission's `plan_proposed`); the root leaves it absent.
        ...(level.parentMissionId ? { parentMissionId: level.parentMissionId } : {}),
        ...(level.parentAgentKey ? { parentAgentKey: level.parentAgentKey } : {}),
      });
      sink.onEvent(event);
    }
    const started = this.deps.repository.appendEvent(mission.sessionId, {
      type: "mission_started",
      missionId: mission.id,
      agentSessionIds,
    });
    sink.onEvent(started);

    // Crew nesting (WP2.1 / D-CN4) — count THIS level's DIRECT leaf agents (crew-refs expand + are counted
    // when THEY run) into the shared running total, the belt-and-suspenders `maxTotalAgents` backstop.
    runtime.leafCount.total += plan.agents.filter((agent) => agent.crewId === undefined).length;

    // ── Dispatch to this level's TOPOLOGY strategy through the SHARED `runSlot`. `maxParallel` here is the
    //    level's own scheduling width, but the shared limiter (root maxParallel) is the true global bound.
    const runSlot = this.buildRunSlot(mission, runtime, level, sink);
    // model-identity WP4.2 (D-MI4) — the model the strategy's OWN call (the best-of-N blind judge) runs
    // on. The old pick was `plan.agents[0].model`, which on a subscription-pinned first agent hands the
    // judge a model with no `generateObject` at all: `hubBuildModel` throws, the judge is skipped, and
    // best-of-N silently degrades to the deterministic winner. `pickAuxiliaryModel` prefers a model that
    // can actually structure output and carries its credential (so the judge resolves on it, not on a
    // name guess); when nothing can, the deterministic winner is still the documented, LOGGED fallback.
    const resolutionRef = this.pickAuxiliaryModel(plan, mission.sessionId);
    const resolutionModel = resolutionRef.model;
    const slots: TopologySlot[] = spawned.map(({ planned, child, index }) => ({ planned, child, index }));
    const outcome = await runTopology(plan.topology, {
      slots,
      maxParallel: plan.budgets?.maxParallel ?? runtime.maxParallel,
      missionAbort: missionAbort.signal,
      runSlot,
      // Crew nesting (WP2.2 / D-CN3) — the COMPOSED predicate: this level's own soft trip OR the shared root
      // ceiling OR any ancestor's trip, so a nested strategy stops the instant an ANCESTOR exhausts its
      // allocation, not only when this level's own subdivision is spent.
      isBudgetTripped: level.budget.isTripped,
      ...(this.deps.judge ? { judge: this.deps.judge } : {}),
      ask,
      resolutionModel,
      ...(resolutionRef.providerCredentialId
        ? { resolutionProviderCredentialId: resolutionRef.providerCredentialId }
        : {}),
      // hub-fixes WP4.4 (D-HF3) — the plan's debate round count (only `runDebate` reads it; clamped there).
      ...(plan.debateRounds !== undefined ? { debateRounds: plan.debateRounds } : {}),
      ...(this.deps.logger ? { logger: this.deps.logger } : {}),
    });
    // The best_of_n judge's own model-call cost joins the shared accumulator (parity with the pre-WP2.1 root:
    // added to the running total, no trip check after — the trip only fires inside the leaf branch).
    runtime.cost.total += outcome.extraCostUsd;

    // Any spawned child never run (skipped by a budget trip / stop / a halted pipeline / a rejected crew-ref)
    // settles honestly — idempotent for any already-terminal child (a completed leaf / crew-ref, a rejected error).
    for (const { child } of spawned) this.settleSkippedChild(child);

    // Crew nesting (WP2.2 / D-CN3, Design D) — this level is honestly partial when its own topology says so,
    // the mission was aborted, OR a nested crew-ref settled partial (its own budget tripped / an ancestor
    // aborted it / it was skipped for a 0 allocation). A crew-ref still PRODUCES one report, so the parent
    // topology's produced-count alone would miss a truncated sub-crew — `level.budget.childPartial` carries
    // it up so the synthesis is marked PARTIAL, never silently truncated.
    const partial = outcome.partial || missionAbort.signal.aborted || level.budget.childPartial;

    // ── Synthesize (cites the agent reports; preserves their citations — §1.7 / R-UX9). The SHARED abort is
    //    passed explicitly so a sub-mission's synthesis is aborted by the root Stop (its own id is not
    //    registered in `this.running`); the root passes the same signal it already used (byte-identical).
    this.deps.repository.updateMission(mission.id, { status: "synthesizing" });
    const synth = await this.synthesize(
      mission,
      ask,
      outcome.synthesisReports,
      partial,
      sink,
      missionAbort.signal,
    );

    // This level's own subtree agent spend (leaf + judge, shared-accumulator delta) + its synthesis cost.
    const totalCost = runtime.cost.total - costBefore + synth.costUsd;
    const finalStatus = missionAbort.signal.aborted ? "stopped" : "completed";
    this.deps.repository.updateMission(mission.id, {
      status: finalStatus,
      costUsd: totalCost,
      endedAt: this.nowIso(),
    });
    return {
      mission: this.deps.repository.getMission(mission.id),
      synthesisReports: outcome.synthesisReports,
      partial,
      synthCost: synth.costUsd,
      synthesisMessageId: synth.messageId,
      aborted: missionAbort.signal.aborted,
    };
  }

  /**
   * Crew nesting (WP2.1 / D-CN3, WP2.3) — build the level's `runSlot` closing over the SHARED `runtime` (cost/
   * limiter/trip/leaf-count) AND this level's OWN `control` (its `agentAborts` map + `missionAbort` — the root
   * shares `runtime.control`, a nested level its fresh sub-control) and `depth`/`visitedCrewIds`. It
   * short-circuits on the level's abort/trip, then branches:
   *   • a `crewId` slot → the crew branch: {@link runSubCrew} (a whole nested sub-mission → ONE report). It
   *     does NOT take a limiter permit (a crew delegates, it does not itself call a model) and does NOT re-add
   *     its rolled-up cost to the shared accumulator (its nested leaves already accrued — no double count).
   *   • a leaf slot → register a per-agent abort into THIS level's `agentAborts` (so `stopAgent`/`steerAgent`
   *     reach it by this level's mission id) AND the tree-wide `runtime.leafAborts` (the budget-trip target),
   *     take a limiter permit, run `runOneAgent`, then add the spend and trip the cap on crossing. The
   *     permit-on-leaf-only rule bounds global concurrent model calls to the root `maxParallel` and cannot deadlock.
   */
  private buildRunSlot(
    mission: HubMission,
    runtime: MissionRunRuntime,
    level: MissionLevel,
    sink: HubTurnSink,
  ): (slot: TopologySlot, briefOverride?: string) => Promise<HubAgentRunResult> {
    const control = level.control;
    const missionAbort = control.missionAbort;
    const agentMaxMs = this.deps.config.agentMaxDurationMs;
    return async (slot, briefOverride) => {
      // Crew nesting (WP2.2 / D-CN3) — short-circuit on the COMPOSED trip (this level OR the shared root OR
      // any ancestor), so a slot never launches once an ancestor exhausts its allocation between the
      // strategy's own between-launch check and here.
      if (missionAbort.signal.aborted || level.budget.isTripped()) {
        return { report: undefined, costUsd: 0, tokensIn: 0, tokensOut: 0, aborted: true };
      }

      // ── Crew branch (D-CN2): expand a nested saved crew into its own sub-mission → ONE report. Register an
      //    abort for the CONTAINER child so `stopAgent` on the crew-ref reaches the delegation; take NO permit
      //    (the sub-crew's own leaves take permits from the shared limiter — a crew slot must not block one).
      if (slot.planned.crewId !== undefined) {
        const agentAbort = new AbortController();
        control.agentAborts.set(slot.child.id, agentAbort);
        const onMissionAbort = (): void => agentAbort.abort();
        missionAbort.signal.addEventListener("abort", onMissionAbort, { once: true });
        try {
          return await this.runSubCrew(mission, slot, runtime, level, agentAbort.signal, sink);
        } finally {
          missionAbort.signal.removeEventListener("abort", onMissionAbort);
          control.agentAborts.delete(slot.child.id);
        }
      }

      // ── Leaf branch (the pre-WP2.1 per-agent semantics, now under the SHARED limiter + accumulator).
      const agentAbort = new AbortController();
      control.agentAborts.set(slot.child.id, agentAbort);
      // Crew nesting (WP2.3) — a LEAF also joins the tree-wide `leafAborts` set so a budget TRIP (which must
      // not touch a `missionAbort`) can abort every in-flight leaf at every level, and a top-level stop reaches
      // it through this level's `missionAbort` chaining above.
      runtime.leafAborts.add(agentAbort);
      const onMissionAbort = (): void => agentAbort.abort();
      missionAbort.signal.addEventListener("abort", onMissionAbort, { once: true });
      // Take a global permit BEFORE running the model call — bounds concurrent leaf runs to root `maxParallel`.
      await runtime.limiter.acquire();
      // hub-fixes (Defect 4) — an OVERALL per-agent wall cap (turn + extraction), started after the permit so
      // it clocks the RUN, not the queue wait. Off by default; the belt-and-suspenders overall ceiling.
      const softTimer =
        agentMaxMs && agentMaxMs > 0 ? setTimeout(() => agentAbort.abort(), agentMaxMs) : undefined;
      let result: HubAgentRunResult;
      try {
        result = await this.runOneAgent(
          mission,
          slot.planned,
          slot.child,
          slot.index,
          sink,
          agentAbort.signal,
          briefOverride,
        );
      } finally {
        if (softTimer) clearTimeout(softTimer);
        runtime.limiter.release();
        runtime.leafAborts.delete(agentAbort);
        missionAbort.signal.removeEventListener("abort", onMissionAbort);
        control.agentAborts.delete(slot.child.id);
      }
      runtime.cost.total += result.costUsd;
      level.budget.spent += result.costUsd;
      // The SHARED root ceiling (WP2.1, PRESERVED) — the whole-tree HARD cap + the global abort of every
      // in-flight agent. Guarantees aggregate tree spend ≤ the root's min(requested, maxBudgetUsd).
      if (runtime.budget.cap > 0 && runtime.cost.total >= runtime.budget.cap) runtime.tripBudget();
      // This level's OWN subdivision (WP2.2 / D-CN3) — a SOFT trip that stops launching more slots at this
      // level (no abort; the shared trip owns that), so a nested sub-mission that exhausts ITS allocation
      // stops without waiting for the whole tree to hit the root cap — leaving budget for its siblings.
      if (level.budget.cap > 0 && level.budget.spent >= level.budget.cap) level.budget.tripped = true;
      return result;
    };
  }

  /**
   * Crew nesting (WP2.1 / D-CN2) — THE RECURSION. Expand a crew-ref slot into its OWN sub-mission, run it
   * under the child crew's topology with the SHARED runtime, and project its synthesised answer into ONE
   * stamped {@link HubAgentReport} returned through {@link HubAgentRunResult} — so the parent topology stays
   * agnostic about whether the slot was a leaf agent or a whole sub-crew. Two-layer run-time guard (D-CN4):
   * over-depth + path-cycle are rejected LOUDLY (a warn + a failed container + an honest partial branch) —
   * never an infinite loop, silent skip, or whole-tree crash. The sub-mission row is created DIRECTLY by this
   * engine via `repository.createMission`, NEVER via `proposePlan`/`approve`/HITL (D-CN1), with `session_id`
   * = the ROOT chat session (D-CN6).
   */
  private async runSubCrew(
    mission: HubMission,
    slot: TopologySlot,
    runtime: MissionRunRuntime,
    level: MissionLevel,
    abortSignal: AbortSignal,
    sink: HubTurnSink,
  ): Promise<HubAgentRunResult> {
    const crewId = slot.planned.crewId as string;
    const crewRoleName = plannedAgentLabel(slot.planned);

    // Individually stopped (via `stopAgent` on the container) before we start ⇒ settle skipped, no report.
    if (abortSignal.aborted) {
      this.settleSkippedChild(slot.child);
      return { report: undefined, costUsd: 0, tokensIn: 0, tokensOut: 0, aborted: true };
    }

    const childDepth = level.depth + 1;
    const maxDepth = this.caps.maxDepth ?? HUB_MISSION_MAX_DEPTH;
    const maxTotalAgents = this.caps.maxTotalAgents ?? HUB_MISSION_MAX_TOTAL_AGENTS;

    // (1) over-depth (D-CN4 run-time half). root = 0, each crewId member steps +1 — `>= maxDepth` rejects.
    if (childDepth >= maxDepth) {
      return this.rejectSubCrew(
        slot,
        `Crew nesting exceeded the maximum depth of ${maxDepth} — the nested crew "${crewRoleName}" (depth ${childDepth}) was not run.`,
      );
    }
    // (2) run-time cycle (D-CN4) — the crewId is already on the path from the root (mutated after WP1.1's
    //     author-time check). The path set ∪ the depth cap jointly guarantee termination.
    if (level.visitedCrewIds.has(crewId)) {
      return this.rejectSubCrew(
        slot,
        `Circular crew reference to "${crewRoleName}" on the run path — the nested crew was not run.`,
      );
    }

    try {
      // (3) resolve the IMMEDIATE child crew level-by-level (D-CN2) — never the full transitive tree.
      const resolved = this.deps.resolveCrew?.(crewId);
      if (!resolved) {
        return this.rejectSubCrew(
          slot,
          `The nested crew "${crewId}" could not be resolved — it may have been deleted.`,
        );
      }

      // (4) build the child plan (the sub-mission's own agents), normalise placeholder models + clamp to the
      //     caps (agent-count/server clamp; the min(requested, parentRemaining) budget subdivision is WP2.2 —
      //     2.1's ceiling guarantee is the shared accumulator + shared trip). A crew with no usable roles
      //     throws (400) — caught below as a loud reject, never a whole-tree crash.
      const rootSession = this.deps.repository.getSession(mission.sessionId);
      const sessionModel = rootSession.model;
      let childPlan = instantiateCrewPlan({
        crew: resolved.crew,
        roles: resolved.roles,
        ask: slot.planned.brief,
        autonomy: mission.autonomy,
        resolveCrewName: (id) => this.deps.resolveCrew?.(id)?.crew.name,
      });
      // model-identity WP6.1 (F12) — as at the root: the placeholder a crew-ref carries is backfilled
      // from the ROOT session, so its pin comes from there too rather than being left unpinned.
      childPlan = normalizePlannedModels(
        childPlan,
        sessionModel,
        rootSession.providerCredentialId ?? undefined,
      ).plan;
      // model-identity WP4.2 — the nested plan is instantiated from SAVED crew members, whose pins ride
      // `hub_crews.members_json` (a JSON blob with no FK, D-MI2). A member pinned to a since-deleted
      // credential therefore cannot degrade via `ON DELETE SET NULL` and would 409 at turn time; strip
      // it here for the same reason the root path does, so the nested agent runs on the heuristic
      // instead of failing. (A pin that still exists is left for the resolver to validate — D-MI9.)
      childPlan = clampPlannedCredentials(childPlan, new Set(this.credentialKinds().keys())).plan;
      childPlan = clampPlanToBudgets(childPlan, this.caps, mission.autonomy);

      // (4b) belt-and-suspenders total-agent backstop (D-CN4): would this child's DIRECT leaves push the
      //      shared running leaf count past `maxTotalAgents`? Reject the over-cap branch (the propose-time
      //      whole-tree estimate is WP2.2).
      const directLeaves = childPlan.agents.filter((agent) => agent.crewId === undefined).length;
      if (runtime.leafCount.total + directLeaves > maxTotalAgents) {
        return this.rejectSubCrew(
          slot,
          `Crew nesting exceeded the maximum of ${maxTotalAgents} total agents — the nested crew "${crewRoleName}" was not run.`,
        );
      }

      // (4c) RESERVE this sub-crew's budget from the PARENT level's pool (WP2.2 / D-CN3 — the monotone
      //      subdivision). The crew-ref member's own named budget is the request; a crew that names none
      //      inherits the parent's remaining (NEVER a fresh env default — `allocateChildBudget` takes no
      //      `caps`, so it cannot re-read one). The reservation is SYNCHRONOUS here (single-threaded ⇒ atomic
      //      before the awaited nested run), so `sum(sibling childCaps) ≤ parentCap` regardless of parallelism.
      const childRequested = slot.planned.budgets?.maxCostUsd;
      const childCap =
        childRequested !== undefined && childRequested > 0
          ? allocateChildBudget(childRequested, level.budget.reservable)
          : Math.max(0, level.budget.reservable);
      level.budget.reservable -= childCap;
      // R3c (D-CN3) — a 0-allocation crew-ref is EXHAUSTED, not unlimited: because the cascade always hands
      //      an explicit numeric `childCap`, a `0` below the root unambiguously means the pool is spent (an
      //      earlier sibling took it), never "unbounded". Settle it as a skipped/partial contributor and
      //      NEVER spawn it — closing the `budgetCap > 0 ⇒ unlimited` inversion at the child level.
      if (childCap <= 0) {
        this.settleSkippedChild(slot.child);
        level.budget.childPartial = true;
        this.deps.logger?.warn?.(
          `[hub mission] the nested crew "${crewRoleName}" was skipped — the mission budget was already exhausted (0 allocation).`,
        );
        return { report: undefined, costUsd: 0, tokensIn: 0, tokensOut: 0, aborted: false };
      }

      // (5) create the sub-mission row DIRECTLY (D-CN1 — never proposePlan/approve/HITL): `session_id` = the
      //     ROOT chat session (D-CN6), `parent_mission_id` = the expanding mission, `depth` = childDepth,
      //     `root_mission_id` = the pinned root id (threaded via the shared runtime).
      const childMission = this.deps.repository.createMission({
        sessionId: mission.sessionId,
        topology: resolved.crew.topology,
        autonomy: mission.autonomy,
        plan: childPlan,
        ...(childPlan.budgets ? { budgets: childPlan.budgets } : {}),
        parentMissionId: mission.id,
        depth: childDepth,
        rootMissionId: runtime.rootMissionId,
      });

      // (5a) Crew nesting (WP3.1 / D-CN7, R-SES1) — EVENT-SOURCE the sub-mission's plan into the ROOT
      //      session log with parent-linkage, so the mission TREE reconstructs from `hub_events` alone.
      //      Still created DIRECTLY by the engine (D-CN1) — this is a `plan_proposed` EVENT, NOT the
      //      `proposePlan` gate: no `plan_approved` follows (no HITL). `parentMissionId` = the expanding
      //      mission; `parentAgentKey` = the crew-node slot that expanded into this sub-mission.
      const subProposed = this.deps.repository.appendEvent(mission.sessionId, {
        type: "plan_proposed",
        missionId: childMission.id,
        plan: childPlan,
        parentMissionId: mission.id,
        parentAgentKey: slot.planned.key,
      });
      sink.onEvent(subProposed);

      // (5b) Crew nesting (WP2.3) — register the sub-mission's OWN run-control under its id so
      //      `stopAgent`/`steerAgent(childMission.id, agentId)` reach a nested agent (a nested agent's
      //      `child.missionId` IS this sub-mission id) with NO change to those methods. Its `missionAbort` is
      //      chained DOWNWARD from the enclosing crew-ref abort (`abortSignal` — the container's per-agent
      //      abort, itself chained to the enclosing level's missionAbort), so a top-level `stop` cascades IN,
      //      but stopping THIS sub-mission never reaches back up to a parent/sibling. Deleted in `finally`.
      const subControl: RunningMission = { missionAbort: new AbortController(), agentAborts: new Map() };
      this.running.set(childMission.id, subControl);
      if (abortSignal.aborted) subControl.missionAbort.abort();
      else abortSignal.addEventListener("abort", () => subControl.missionAbort.abort(), { once: true });

      // (5c) Crew nesting (WP2.3 / D-CN9) — the transitive `parentScope` threaded DOWN to the sub-mission:
      //      the enclosing crew-ref's OWN grants intersected down the enclosing scope (already `L1 ∩ L0 …`),
      //      NEVER re-derived from the D-CN6 root session (that is the R6 re-widen). A crew-ref with no explicit
      //      grants imposes no extra narrowing and passes the enclosing scope through — see `subCrewParentScope`.
      const childParentScope = subCrewParentScope(slot.planned.toolGrants, level.parentScope);

      // (6) run the sub-mission as its own level with the SHARED runtime + the extended path visited-set, its
      //     OWN control (WP2.3) + budget ledger capped at `childCap` (the cascading meter, WP2.2): its
      //     `isTripped` is composed with the parent's, so an ancestor trip halts it and its own exhaustion trips
      //     only it. Its leaves accrue into the shared accumulator. Once it returns, the sub-mission is DONE —
      //     drop its `this.running` control in the `finally` (no leak) BEFORE the projection; a mutated branch
      //     throwing frees it too and re-throws into the outer catch (a loud reject, never a whole-tree crash).
      let outcome: MissionLevelOutcome;
      try {
        outcome = await this.runMissionLevel(
          childMission,
          runtime,
          {
            depth: childDepth,
            visitedCrewIds: new Set([...level.visitedCrewIds, crewId]),
            budget: makeLevelBudget(childCap, () => runtime.budget.tripped, level.budget.isTripped),
            control: subControl,
            parentScope: childParentScope,
            // Crew nesting (WP3.1 / D-CN7) — this sub-mission's event parent-linkage, stamped on its own
            // per-member `agent_spawned`s (the mirror of the `plan_proposed` above).
            parentMissionId: mission.id,
            parentAgentKey: slot.planned.key,
          },
          slot.planned.brief,
          sink,
        );
      } finally {
        this.running.delete(childMission.id);
      }

      // No sub-report produced (fully aborted / nothing ran) ⇒ settle the container skipped, honest partial.
      if (outcome.synthesisReports.length === 0) {
        this.settleSkippedChild(slot.child);
        return { report: undefined, costUsd: 0, tokensIn: 0, tokensOut: 0, aborted: true };
      }

      // (7) project the sub-mission → ONE report: summary = the sub-synthesis prose; citations = the merged
      //     member citations; confidence = most-conservative across members; openQuestions = deduped union;
      //     the WP0.1 nesting envelope (subMissionId/topology/childReports/depth). `stampReport` re-stamps
      //     identity onto the CONTAINER child so the parent synthesis remaps it like any leaf.
      //     WP2.2 / D-CN3 (Design D) — HONEST-PARTIAL propagation: when the sub-mission stopped early (its own
      //     budget tripped, or an ancestor aborted it), lower this rolled-up report's confidence to `low` and
      //     append the truncation open-question, AND flag `level.budget.childPartial` so the PARENT synthesis
      //     is marked PARTIAL (a crew-ref still produces one report, so the topology's produced-count alone
      //     would miss it) — never a silent truncation.
      const subPartial = outcome.partial;
      if (subPartial) level.budget.childPartial = true;
      const merged = mergeAgentCitations(outcome.synthesisReports);
      const projected: HubAgentReport = {
        summary: this.synthesisProse(mission.sessionId, outcome.synthesisMessageId),
        findings: [],
        citations: merged.citations,
        artifacts: [],
        confidence: subPartial ? "low" : mostConservativeConfidence(outcome.synthesisReports),
        openQuestions: subPartial
          ? [...dedupeOpenQuestions(outcome.synthesisReports), SUB_CREW_TRUNCATION_NOTE]
          : dedupeOpenQuestions(outcome.synthesisReports),
        subMissionId: childMission.id,
        topology: resolved.crew.topology,
        childReports: outcome.synthesisReports,
        depth: childDepth,
      };
      const stamped = this.stampReport(projected, slot.child, crewRoleName);

      // (8) roll the sub-tree subtotal (the child mission's own settled total) onto the CONTAINER session +
      //     emit ONE `agent_report` into the PARENT (expanding mission's) log, so the parent topology sees the
      //     whole sub-crew as one normal `agent_report` (board tree-awareness is WP3.1). No token rollup here
      //     (the real tokens live on the nested leaf sessions; per-level attribution is WP3.2).
      const subtotal = outcome.mission.costUsd ?? 0;
      this.deps.repository.setSessionLifecycle(slot.child.id, {
        status: "completed",
        phase: null,
        costUsd: subtotal,
        tokensIn: 0,
        tokensOut: 0,
        endedAt: this.nowIso(),
      });
      const event = this.deps.repository.appendEvent(mission.sessionId, {
        type: "agent_report",
        missionId: mission.id,
        agentSessionId: slot.child.id,
        report: stamped,
        costUsd: subtotal,
        tokensIn: 0,
        tokensOut: 0,
      });
      sink.onEvent(event);

      // (9) the child mission row's per-level attribution (status/cost/endedAt) was already set by its own
      //     `runMissionLevel` (the shared body) — no redundant re-write. Do NOT add `subtotal` to the SHARED
      //     accumulator (its nested leaves already did — the no-double-count rule). WP2.2 / D-CN3: DO account
      //     the crew-ref's actual spend against the PARENT level's own budget ledger (the parent allocated it),
      //     so a parent whose crew-ref children run it dry trips its own soft cap and stops launching more.
      level.budget.spent += subtotal;
      if (level.budget.cap > 0 && level.budget.spent >= level.budget.cap) level.budget.tripped = true;
      return { report: stamped, costUsd: subtotal, tokensIn: 0, tokensOut: 0, aborted: outcome.aborted };
    } catch (error) {
      // A mutated / corrupt branch must never crash the whole tree — settle the container failed + partial.
      return this.rejectSubCrew(
        slot,
        `The nested crew "${crewRoleName}" failed to run: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /** Crew nesting (WP2.1 / D-CN4) — the LOUD reject for a sub-crew: settle the container child as FAILED with
   *  a clear message + a warn log, and return an honest partial branch (no report, not counted as stopped) so
   *  one bad nested branch never loops, silently skips, or crashes the whole tree. */
  private rejectSubCrew(slot: TopologySlot, message: string): HubAgentRunResult {
    this.settleFailedChild(slot.child, message);
    this.deps.logger?.warn?.(`[hub mission] ${message}`);
    return { report: undefined, costUsd: 0, tokensIn: 0, tokensOut: 0, aborted: false };
  }

  /** Crew nesting (WP2.1) — read a sub-mission's settled synthesis prose back from the ROOT session log by its
   *  message id (every sub-synthesis `assistant_message` lands in the root session, D-CN6), for the projected
   *  crew-ref report summary. */
  private synthesisProse(sessionId: string, messageId: string): string {
    for (const event of this.deps.repository.listEvents(sessionId)) {
      if (event.type === "assistant_message" && event.messageId === messageId) {
        return event.parts
          .filter((p): p is Extract<(typeof event.parts)[number], { type: "text" }> => p.type === "text")
          .map((p) => p.text)
          .join("")
          .trim();
      }
    }
    return "";
  }

  /** hub-fixes WP2.1 (D-HF7) — the runner mode in force. `session` (production default) drives real child
   *  turns; `structured` keeps the old one-shot orchestration. Absent config ⇒ `structured`, so an
   *  existing construction / a stub-`runAgent` test keeps its exact prior behavior. */
  private get agentRunnerMode(): "session" | "structured" {
    return this.deps.config.agentRunnerMode ?? "structured";
  }

  /**
   * Run ONE agent as its child hub session, then emit the `agent_report` board event into the PARENT log.
   * On abort (budget trip / stop) the child settles with no report (→ partial mission).
   *
   * hub-fixes WP2.1 (RC2, D-HF7): two runner modes share this entry point —
   *   • `session` (production default): the runner drives a REAL child turn through the turn engine
   *     (`session-service.runAgentTurn`) — granted MCP tools callable, tool calls + usage persisted into
   *     the CHILD log — then extracts the structured report; this method only re-stamps identity + emits
   *     the board event (the child lifecycle/brief/settled message are the turn engine's).
   *   • `structured` (byte-compatible fallback): the OLD tool-less one-shot — this method writes the
   *     child's lifecycle + isolated brief + synthetic report message itself around a `generateObject`.
   *
   * `briefOverride` (WP2.2) supplies the pipeline/debate HAND-OFF brief — the planned brief enriched with
   * the earlier stages' settled reports (STRUCTURED agent output, not the parent transcript, so isolation
   * holds). Absent ⇒ the planned brief is the child's sole input, exactly as before.
   */
  private async runOneAgent(
    mission: HubMission,
    planned: HubPlannedAgent,
    child: HubSession,
    _index: number,
    sink: HubTurnSink,
    abortSignal: AbortSignal,
    briefOverride?: string,
  ): Promise<HubAgentRunResult> {
    const roleName = plannedAgentLabel(planned);
    const brief = briefOverride ?? planned.brief;
    // If already aborted before we even start, settle the child and skip the model call.
    if (abortSignal.aborted) {
      this.settleSkippedChild(child);
      return { report: undefined, costUsd: 0, tokensIn: 0, tokensOut: 0, aborted: true };
    }

    // The role-template parts, shared by both modes: the STRUCTURED runner consumes `systemPrompt`
    // (assembled here, tool-signatures-only), the SESSION runner consumes `roleTemplate` (re-assembling
    // WITH the child turn's real resolved tool listing).
    //
    // hub-fixes WP2.3 (D-HF5) — the signatures line tells the agent about `child.toolScope` (the
    // EFFECTIVE, parent-scope-intersected grants it actually got, WP2.1's spawn seam), never the raw
    // `planned.toolGrants` a crew role's Access tab promised — otherwise a narrowed agent would be told
    // it can reach a server the intersection just dropped.
    // model-identity WP4.2 (D-MI4) — resolve WHICH PROVIDER runs this agent before assembling anything.
    // A `claude_subscription` pin routes the child to the Agent-SDK executor, which has no
    // `generateObject`: its report must come from the prompt-enforced contract it is about to be given,
    // not from the post-turn extraction call. Nothing else about the agent changes.
    const plannedRef: HubModelRef = {
      model: planned.model,
      ...(planned.providerCredentialId
        ? { providerCredentialId: planned.providerCredentialId }
        : {}),
    };
    const needsReportContract = this.isSubscriptionRef(plannedRef);
    // The model the post-turn report EXTRACTION runs on (unused when the contract path is taken).
    const auxiliaryModel = this.pickAuxiliaryModel(mission.plan, mission.sessionId);

    const roleSkillsContent = await this.deps.resolveRoleSkills?.(planned.skillIds);
    const roleTemplate: HubRoleTemplateInjection = {
      roleName,
      roleSystemPrompt: planned.systemPrompt,
      briefTarget: planned.target,
      briefInputs: brief,
      expectedOutcome: planned.expectedOutcome,
      agentBudget: summarizeBudgets(planned.budgets),
      agentToolSignatures: agentToolSignatures(child.toolScope ?? planned.toolGrants),
      ...(roleSkillsContent ? { roleSkillsContent } : {}),
      ...(needsReportContract
        ? {
            reportContract: buildAgentReportContractInstruction({
              expectedOutcome: planned.expectedOutcome,
            }),
          }
        : {}),
    };
    const rolePrompt = assembleRolePrompt({ role: roleTemplate });

    // hub-fixes WP2.5 (D-HF6) — the child turn's approval policy is governed by the MISSION autonomy
    // (`mission.autonomy`, frozen at propose time). `always_ask` additionally wires the board-approval
    // MIRROR sink (child `approval_*` → parent `agent_approval_*`, so the board queue reconstructs from
    // the parent log alone, R-SES1) + the shared timeout ledger the mirror reads for the timeout marker.
    // `auto`/`threshold` need no mirror (gated calls auto-decline silently — no board card).
    const timedOut = new Set<string>();
    const missionApproval: HubAgentTurnInput["missionApproval"] = {
      autonomy: mission.autonomy,
      approvalTimeoutMs:
        this.deps.config.missionApprovalTimeoutMs ?? DEFAULT_MISSION_APPROVAL_TIMEOUT_MS,
      timedOut,
    };
    const boardApprovalSink =
      mission.autonomy === "always_ask"
        ? this.buildBoardApprovalSink(mission, child.id, roleName, sink, timedOut)
        : undefined;

    const runInput: HubAgentRunInput = {
      agentSessionId: child.id,
      missionId: mission.id,
      key: planned.key,
      roleName,
      model: planned.model,
      ...(planned.providerCredentialId
        ? { providerCredentialId: planned.providerCredentialId }
        : {}),
      // hub-fixes (Defect 2) — the extraction model. model-identity WP4.2: the parent session's model is
      // still the default, but it is now chosen through `pickAuxiliaryModel`, which prefers a model that
      // can ACTUALLY do structured output (a subscription-pinned parent cannot) and carries the chosen
      // model's own credential so the extraction call resolves on it instead of re-guessing by name.
      ...(this.deps.config.missionExtractionModel
        ? { extractionModel: this.deps.config.missionExtractionModel }
        : {
            extractionModel: auxiliaryModel.model,
            ...(auxiliaryModel.providerCredentialId
              ? { extractionProviderCredentialId: auxiliaryModel.providerCredentialId }
              : {}),
          }),
      // model-identity WP4.2 (D-MI4) — a subscription child has no `generateObject`: its report is the
      // contract block it was just told to emit, parsed out of its own prose by the SESSION runner.
      ...(needsReportContract ? { reportContract: true } : {}),
      systemPrompt: rolePrompt.text,
      roleTemplate,
      // v1-fixes (F8) — an `assistant|…` facade model never receives the system prompt (single-shot
      // Q&A), so anything essential must ride the QUESTION itself: fold the role's own instructions +
      // the report expectations into the brief for facade agents. Non-facade agents keep the clean
      // brief (their role prompt carries all of this in the system prompt). A subscription agent is NOT
      // a facade: the Agent-SDK child does receive a system prompt, so it keeps the clean brief — this
      // is deliberately keyed on the bare-id facade test, not on the credential-aware one.
      brief: isStructuredOutputModel(planned.model)
        ? brief
        : [
            cleanRoleInstruction(planned.systemPrompt)
              ? `Role instructions: ${cleanRoleInstruction(planned.systemPrompt)}`
              : "",
            brief,
            "In your answer, name the data sources you used and end with any open questions your analysis raises.",
          ]
            .filter((part) => part.length > 0)
            .join("\n\n"),
      expectedOutcome: planned.expectedOutcome,
      ...(planned.budgets ? { budgets: planned.budgets } : {}),
      abortSignal,
      missionApproval,
      ...(boardApprovalSink ? { sink: boardApprovalSink } : {}),
    };

    return this.agentRunnerMode === "session"
      ? this.runAgentViaSession(mission, child, roleName, runInput, sink, abortSignal)
      : this.runAgentStructured(mission, planned, child, roleName, runInput, sink, abortSignal);
  }

  /**
   * hub-fixes WP2.5 (D-HF6) — the BOARD-APPROVAL MIRROR sink for an `always_ask` mission's child turn.
   * The turn engine calls this sink for every persisted child event; it MIRRORS only the child's gated
   * `approval_requested` (non-automatic — a real pending card) and `approval_responded` onto the PARENT
   * (mission board) log as `agent_approval_requested` / `agent_approval_responded`, so the board's
   * approval queue reconstructs from the parent event log ALONE (R-SES1) and clears when the operator
   * (or the timeout) resolves the card. `reason` is `timeout` iff the shared `timedOut` ledger — which
   * the mission-agent HITL populates BEFORE the turn engine emits `approval_responded` — carries this
   * toolCallId. The decision itself is made on the board and routed to the CHILD session's own
   * `/approvals` route (`agentSessionId` + `toolCallId`); this sink is display-only. Every mirror is
   * appended to the parent log AND fanned out on the parent's live channel (`missionSink`).
   */
  private buildBoardApprovalSink(
    mission: HubMission,
    agentSessionId: string,
    roleName: string,
    missionSink: HubTurnSink,
    timedOut: ReadonlySet<string>,
  ): HubTurnSink {
    const emit = (event: HubEventInput): void => {
      const settled = this.deps.repository.appendEvent(mission.sessionId, event);
      missionSink.onEvent(settled);
    };
    return {
      onEvent: (event) => {
        if (event.type === "approval_requested") {
          // An automatic (session-scoped "always") run is not a pending card — never queue it.
          if (event.isAutomatic) return;
          emit({
            type: "agent_approval_requested",
            missionId: mission.id,
            agentSessionId,
            roleName,
            toolCallId: event.toolCallId,
            toolName: event.toolName,
            source: event.source,
            ...(event.serverId ? { serverId: event.serverId } : {}),
            ...(event.annotations ? { annotations: event.annotations } : {}),
            options: event.options,
          });
        } else if (event.type === "approval_responded") {
          emit({
            type: "agent_approval_responded",
            missionId: mission.id,
            agentSessionId,
            toolCallId: event.toolCallId,
            resolution: event.resolution,
            reason: timedOut.has(event.toolCallId) ? "timeout" : "decided",
          });
        }
      },
      onDelta: () => undefined,
    };
  }

  /**
   * hub-fixes WP2.1 (RC2) — the SESSION path. The injected `runAgent` (production: `createSessionAgentRunner`)
   * drives the child turn through the turn engine, so the child's lifecycle, phase events, isolated brief
   * user_message, tool calls, settled assistant_message and terminal are ALL written by the turn engine
   * into the child log; this method only re-stamps identity + emits the board `agent_report`. It never
   * writes a synthetic report message — the real turn is the child's settled message.
   */
  private async runAgentViaSession(
    mission: HubMission,
    child: HubSession,
    roleName: string,
    runInput: HubAgentRunInput,
    sink: HubTurnSink,
    abortSignal: AbortSignal,
  ): Promise<HubAgentRunResult> {
    let result: HubAgentRunResult;
    try {
      result = await this.deps.runAgent(runInput);
    } catch (error) {
      // model-identity WP4.2 (D-MI4) — settle by NAME with the real cause. The old generic string
      // ("The agent failed to produce a report.") was the only thing an operator saw for every failure
      // on this path: a report-contract parse failure, a provider outage, and — since D-MI9 — a 409 for
      // a credential pinned inside a JSON blob no FK protects (`hub_missions.plan_json` /
      // `hub_crews.members_json`, D-MI2) all read identically, so none of them was diagnosable.
      const message = describeAgentFailure(roleName, child, error);
      this.deps.logger?.warn?.(`[hub mission ${mission.id}] agent ${child.id}: ${message}`);
      this.settleFailedChild(child, message);
      return { report: undefined, costUsd: 0, tokensIn: 0, tokensOut: 0, aborted: false };
    }
    if (!result.report || abortSignal.aborted) {
      this.settleSkippedChild(child);
      return { ...result, report: undefined, aborted: true };
    }
    const report = this.stampReport(result.report, child, roleName);
    // hub-fixes WP2.4 (cost/budget integrity) — `result.costUsd/tokensIn/tokensOut` is the agent's FULL
    // real total (the child turn's own accumulated usage PLUS the report-extraction call's,
    // `createSessionAgentRunner`), but the turn engine only ever persisted the TURN's own slice onto the
    // child session row — it has no visibility into the extraction call the orchestrator makes here. True
    // the row up to the runner's full total so every downstream view that reads the session row (usage
    // rollups, the workforce Usage tab) agrees with what the board/mission actually charge for this agent.
    this.deps.repository.setSessionLifecycle(child.id, {
      costUsd: result.costUsd,
      tokensIn: result.tokensIn,
      tokensOut: result.tokensOut,
    });
    const event = this.deps.repository.appendEvent(mission.sessionId, {
      type: "agent_report",
      missionId: mission.id,
      agentSessionId: child.id,
      report,
      costUsd: result.costUsd,
      tokensIn: result.tokensIn,
      tokensOut: result.tokensOut,
    });
    sink.onEvent(event);
    return { ...result, report };
  }

  /**
   * hub-fixes WP2.1 (D-HF7) — the STRUCTURED (one-shot) path, BYTE-COMPATIBLE with the pre-WP2.1 runner:
   * this method itself writes the child's lifecycle + isolated brief + synthetic report message around the
   * tool-less `generateObject` runner. Selected by `HUB_AGENT_RUNNER=structured` (or an unset config).
   */
  private async runAgentStructured(
    mission: HubMission,
    planned: HubPlannedAgent,
    child: HubSession,
    roleName: string,
    runInput: HubAgentRunInput,
    sink: HubTurnSink,
    abortSignal: AbortSignal,
  ): Promise<HubAgentRunResult> {
    // Child lifecycle: running + a starting phase (into the CHILD log only — no parent forwarding).
    this.deps.repository.setSessionLifecycle(child.id, { status: "running", phase: "starting" });
    this.deps.repository.appendEvent(child.id, { type: "phase", phase: "starting" });
    this.deps.repository.appendEvent(child.id, { type: "phase", phase: null });

    // ── ISOLATION (D-AH9): the brief is the child's SOLE user turn. The parent conversation never
    //    enters the child's context. This is the isolation invariant a test asserts against.
    this.deps.repository.appendEvent(child.id, {
      type: "user_message",
      messageId: nanoid(),
      text: runInput.brief,
    });

    let result: HubAgentRunResult;
    try {
      result = await this.deps.runAgent(runInput);
    } catch (error) {
      // model-identity WP4.2 (D-MI4) — the same by-name settle the session path uses (see there).
      const message = describeAgentFailure(roleName, child, error);
      this.deps.logger?.warn?.(`[hub mission ${mission.id}] agent ${child.id}: ${message}`);
      this.settleFailedChild(child, message);
      return { report: undefined, costUsd: 0, tokensIn: 0, tokensOut: 0, aborted: false };
    }

    if (!result.report || abortSignal.aborted) {
      this.settleSkippedChild(child);
      return { ...result, report: undefined, aborted: true };
    }

    const report = this.stampReport(result.report, child, roleName);

    // The child's settled message (readable report prose) + turn settle + completed terminal.
    this.deps.repository.appendEvent(child.id, {
      type: "assistant_message",
      messageId: nanoid(),
      model: planned.model,
      parts: [{ type: "text", text: renderReportText(report, { heading: roleName }) }],
      usage: { tokensIn: result.tokensIn, tokensOut: result.tokensOut },
      citations: report.citations,
      artifactsTouched: [],
      costUsd: result.costUsd,
      costBasis: "api_exact",
      finishReason: "stop",
    });
    this.deps.repository.appendEvent(child.id, { type: "turn_done", costUsd: result.costUsd });
    this.deps.repository.setSessionLifecycle(child.id, {
      status: "completed",
      phase: null,
      costUsd: result.costUsd,
      tokensIn: result.tokensIn,
      tokensOut: result.tokensOut,
      endedAt: this.nowIso(),
    });

    // The board event — into the PARENT log (the mission board's home; replay-inert, R-SES1). The child
    // row above already carries the runner's exact total (WP2.4), so the event just mirrors it.
    const event = this.deps.repository.appendEvent(mission.sessionId, {
      type: "agent_report",
      missionId: mission.id,
      agentSessionId: child.id,
      report,
      costUsd: result.costUsd,
      tokensIn: result.tokensIn,
      tokensOut: result.tokensOut,
    });
    sink.onEvent(event);

    return { ...result, report };
  }

  /** Stamp authoritative provenance on a raw agent report: the child session id + role name + per-citation
   *  `agentRef`, so the synthesizer can preserve + re-number citations by agent (§1.7). */
  private stampReport(raw: HubAgentReport, child: HubSession, roleName: string): HubAgentReport {
    return {
      ...raw,
      agentSessionId: child.id,
      roleName,
      citations: raw.citations.map((c: HubCitation) => ({ ...c, agentRef: child.id })),
    };
  }

  private async synthesize(
    mission: HubMission,
    userText: string,
    reports: HubAgentReport[],
    partial: boolean,
    sink: HubTurnSink,
    // Crew nesting (WP2.1) — the abort to use for the synthesis TURN. A sub-mission passes the SHARED root
    // abort (its own id is not registered in `this.running`); absent ⇒ the root's own `this.running` lookup,
    // so the ROOT synthesis path is byte-identical to the pre-WP2.1 code.
    abortSignal?: AbortSignal,
  ): Promise<{ costUsd: number; messageId: string }> {
    // assistant-hub v1-fixes (F1) — the synthesis model must actually RECEIVE system prompts: the whole
    // synthesizer instruction (reports digest + numbered sources) rides the system override, which the
    // OpenAI-compatible facade (`assistant|…`) drops. The pre-fix pick (`plan.agents[0].model`) produced
    // a synthesis generated from the bare ask, blind to every agent report. See `pickSynthesisModel`.
    //
    // model-identity WP4.2 (D-MI4) — the same preference order, now over credential-carrying refs: the
    // pick must skip a model that CANNOT run the synthesis turn (a subscription-pinned one — the
    // Agent-SDK path is not wired into `runSynthesisTurn`), and the winner's own credential must travel
    // with it so `runSynthesisTurn` resolves on the provider the mission chose instead of re-guessing.
    const kinds = this.credentialKinds();
    const modelRef = pickSynthesisModel({
      session: this.sessionModelRef(mission.sessionId),
      planModels: this.planModelRefs(mission.plan),
      isStructured: (ref) => this.canStructureOutput(ref, kinds),
      ...(this.deps.config.missionSynthesisModel
        ? { override: this.deps.config.missionSynthesisModel }
        : {}),
    });
    const model = modelRef.model;
    // …and when the winner is SUBSCRIPTION-backed, nothing in the mission can run the synthesis at all:
    // `runSynthesisTurn` refuses a non-AI-SDK kind and `createTextSynthesizer`'s `buildModel` throws for
    // it, so today both calls fail in sequence and `synthesizeMission` lands on `deterministicSynthesis`
    // with only a log line to show for it — the silent degrade D-MI4 forbids. Say it in the ANSWER.
    //
    // Deliberately scoped to the subscription case and NOT to a FACADE winner: an `assistant|…` model is
    // a real AI-SDK model that genuinely runs (poorly — that is F1's problem, owned by `pickSynthesisModel`,
    // not this WP), so short-circuiting it here would change behaviour WP4.2 has no mandate to change.
    const synthesisDegraded = this.isSubscriptionRef(modelRef, kinds)
      ? "No model in this mission can run the synthesis turn — every candidate is backed by the Anthropic CLI subscription, which has no structured/tool-calling turn path here, so the answer below is composed mechanically from the agents' reports."
      : undefined;
    // hub-fixes WP3.2 (D-HF4) — the synthesis turn is aborted by the mission's own abort (a Stop during
    // synthesis), so a stopped mission never leaves a synthesis turn running. Crew nesting (WP2.1): a
    // sub-mission passes the SHARED root abort explicitly; the root passes none ⇒ the SAME `this.running`
    // signal it always used (byte-identical).
    const missionAbort = abortSignal ?? this.running.get(mission.id)?.missionAbort.signal;
    // The synthesizer runs its own turn; its cost is folded into the mission total (the agent costs are
    // added by the caller). Cost also lives on the settled synthesis `assistant_message` (api_exact).
    const result = await synthesizeMission(
      {
        repository: this.deps.repository,
        synthesizer: this.deps.synthesizer,
        // hub-fixes WP3.2 (RC4, D-HF4) — prefer the turn path (GenUI-capable synthesis) when wired + not
        // forced to text; else the pre-fix `generateText` synthesizer is used unchanged.
        ...(this.deps.runSynthesisTurn ? { runSynthesisTurn: this.deps.runSynthesisTurn } : {}),
        ...(this.deps.config.synthesisMode ? { synthesisMode: this.deps.config.synthesisMode } : {}),
        ...(this.deps.logger ? { logger: this.deps.logger } : {}),
      },
      {
        mission,
        sessionId: mission.sessionId,
        userText,
        model,
        ...(modelRef.providerCredentialId
          ? { providerCredentialId: modelRef.providerCredentialId }
          : {}),
        reports,
        partial,
        sink,
        ...(synthesisDegraded ? { degradedNote: synthesisDegraded } : {}),
        ...(missionAbort ? { abortSignal: missionAbort } : {}),
        now: this.nowIso().slice(0, 10),
      },
    );

    // assistant-hub v1-fixes (F2/F7) — persist the mission's MODEL-VISIBLE memory after the synthesis:
    // a compact `mission_digest` (folded into every later turn's reconstructed context, so the parent
    // can always quote its agents) + the deduped `mission_followups` (the UI's one-click follow-up
    // affordance and the planner's seed). Emitted even when the synthesis fell back deterministically.
    const agentReportRefs = reports
      .map((r) => r.agentSessionId)
      .filter((id): id is string => !!id);
    const digestText = buildMissionDigest(reports, { partial });
    if (digestText) {
      const digestEvent = this.deps.repository.appendEvent(mission.sessionId, {
        type: "mission_digest",
        missionId: mission.id,
        text: digestText,
        ...(agentReportRefs.length > 0 ? { agentReportRefs } : {}),
      });
      sink.onEvent(digestEvent);
    }
    const followups = collectMissionFollowups(reports);
    if (followups.length > 0) {
      const followupsEvent = this.deps.repository.appendEvent(mission.sessionId, {
        type: "mission_followups",
        missionId: mission.id,
        followups,
      });
      sink.onEvent(followupsEvent);
    }
    return { costUsd: result.costUsd, messageId: result.messageId };
  }

  /** Settle a spawned-but-never-run child (skipped by a budget trip / stop / a halted pipeline) to an
   *  honest interrupted terminal — it produced no report. Idempotent for ANY already-terminal child
   *  (completed / aborted / error) so the bulk end-of-run pass never clobbers a child that already
   *  settled (e.g. a failed agent's `error`, WP2.2 — the pass now runs over every slot). */
  private settleSkippedChild(child: HubSession): void {
    const fresh = this.deps.repository.getSession(child.id);
    if (fresh.status === "aborted" || fresh.status === "completed" || fresh.status === "error") return;
    this.deps.repository.setSessionLifecycle(child.id, {
      status: "aborted",
      phase: null,
      endedAt: this.nowIso(),
    });
  }

  private settleFailedChild(child: HubSession, message: string): void {
    this.deps.repository.appendEvent(child.id, { type: "error", message, recoverable: false });
    this.deps.repository.setSessionLifecycle(child.id, {
      status: "error",
      phase: null,
      endedAt: this.nowIso(),
    });
  }
}

// ── Pure helpers ──────────────────────────────────────────────────────────────────────────────────

/** Bound the cause text folded into a child's terminal `error` event — an operator-facing sentence, not
 *  a stack dump, and short enough that the board card stays readable. */
const AGENT_FAILURE_CAUSE_MAX_CHARS = 400;

/**
 * model-identity WP4.2 (**D-MI4**) — the honest, BY-NAME settle message for a mission agent that could
 * not produce a report.
 *
 * It replaces the single generic string every failure on this path used to collapse into
 * (*"The agent failed to produce a report."*), which made four genuinely different problems
 * indistinguishable: a prompt-contract parse failure on the subscription path, a provider outage, a
 * D-MI9 **409** for a credential pinned inside a JSON blob no FK protects (D-MI2), and an
 * unwired-executor 501. The message names the AGENT (its role + its model, which is what the operator
 * picked) and carries the underlying cause verbatim — the resolver's 409 text already names the
 * credential by its REDACTED label and says which check failed (`routes.ts#resolveExplicitHubCredential`),
 * and the subscription executor's messages are name-only by construction, so no secret can ride here
 * (`.claude/rules/mcp-and-security.md`). Nothing about the cause is interpreted or re-classified — it is
 * not routed into a `STOP_REASON_CODES`/`TerminalCause` bucket, which stays frozen (§3).
 */
function describeAgentFailure(roleName: string, child: HubSession, error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const cause = raw.trim().replace(/\s+/g, " ");
  const clipped =
    cause.length > AGENT_FAILURE_CAUSE_MAX_CHARS
      ? `${cause.slice(0, AGENT_FAILURE_CAUSE_MAX_CHARS)}…`
      : cause;
  const who = `Agent “${roleName}” (${child.model})`;
  return clipped ? `${who} could not complete: ${clipped}` : `${who} could not complete (no cause reported).`;
}

/** A mission is terminal once it has completed, stopped, or failed (a new mission may then be proposed). */
export function isTerminalMissionStatus(status: HubMission["status"]): boolean {
  return status === "completed" || status === "stopped" || status === "failed";
}

/** Resolve the autonomy dial to an auto-approve decision (D-AH6): `auto` always; `threshold` only
 *  at/under BOTH the agent-count and estimated-cost ceilings; `always_ask` never. HARD caps still
 *  apply regardless — this only decides whether the operator must click Approve. */
export function shouldAutoApprove(
  autonomy: HubAutonomyLevel,
  agentCount: number,
  estCostUsd: number,
  caps: Pick<HubMissionCaps, "askAboveAgents" | "askAboveUsd">,
  /** model-identity WP6.1 (F6 / D-MI11) — additive and optional; absent ⇒ unchanged behaviour. */
  opts?: { costEstimateComplete?: boolean },
): boolean {
  if (autonomy === "auto") return true;
  if (autonomy === "always_ask") return false;
  // model-identity WP6.1 (F6) — the `threshold` dial compares planned spend against `askAboveUsd`.
  // An UNPRICED model contributes $0 to that figure (`estimateCost` returns 0 when it has no pricing
  // entry at all), so a mission of unpriced agents sails under any ceiling and auto-launches: the cap
  // is not merely wrong, it is inapplicable — silently. When the estimate is known-incomplete, ASK.
  // That is the conservative direction and it makes the gap visible, which is what D-MI11 asked for.
  if (opts?.costEstimateComplete === false) return false;
  return agentCount <= caps.askAboveAgents && estCostUsd <= caps.askAboveUsd;
}

/**
 * End-user UX pass — HYDRATE a planner-proposed plan against the session's resolved roster: for every
 * planned agent whose `roleId` matches a saved role the user scoped in (a standalone agent OR a crew
 * member), replace the model's paraphrased config with the saved role's REAL config
 * ({@link hydratePlannedAgentFromRole}). A planner-invented role (no matching `roleId`) is left untouched
 * — this is a "preferred pool," not a replacement of the planner. Pure; the clamp runs afterward.
 */
function hydrateRosterRoles(
  plan: HubMissionPlan,
  resolvedRoster: { roles: readonly HubAgentRole[]; crews: readonly HubResolvedCrew[] },
): HubMissionPlan {
  const roleById = new Map<string, HubAgentRole>();
  for (const role of resolvedRoster.roles) roleById.set(role.id, role);
  for (const { roles } of resolvedRoster.crews) for (const role of roles) roleById.set(role.id, role);
  if (roleById.size === 0) return plan;
  const agents = plan.agents.map((agent) => {
    const role = agent.roleId ? roleById.get(agent.roleId) : undefined;
    return role ? hydratePlannedAgentFromRole(agent, role) : agent;
  });
  return { ...plan, agents };
}

/** The first user message text of a session (the mission's original ask) for the synthesizer prompt. */
function firstUserText(repository: HubRepository, sessionId: string): string {
  for (const event of repository.listEvents(sessionId)) {
    if (event.type === "user_message") return event.text;
  }
  return "";
}

/** Crew nesting (WP2.1 / D-CN2) — the MOST-CONSERVATIVE confidence across a sub-mission's member reports
 *  (`low` < `medium` < `high`), for the rolled-up crew-ref report. Empty ⇒ `low` (a sub-crew that produced
 *  no report claims no confidence). */
function mostConservativeConfidence(reports: readonly HubAgentReport[]): HubConfidence {
  const rank: Record<HubConfidence, number> = { low: 1, medium: 2, high: 3 };
  let worst: HubConfidence | undefined;
  for (const report of reports) {
    if (worst === undefined || rank[report.confidence] < rank[worst]) worst = report.confidence;
  }
  return worst ?? "low";
}

/** Crew nesting (WP2.1 / D-CN2) — the DEDUPED union of a sub-mission's member open questions (order
 *  preserved, case/whitespace-insensitive de-dupe), for the rolled-up crew-ref report. */
function dedupeOpenQuestions(reports: readonly HubAgentReport[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const report of reports) {
    for (const raw of report.openQuestions) {
      const question = raw.trim();
      const key = question.toLowerCase().replace(/\s+/g, " ");
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(question);
    }
  }
  return out;
}

/**
 * Crew nesting (WP2.3 / D-CN9) — the `parentScope` threaded DOWN into a sub-mission when the recursion seam
 * (`runSubCrew`) or the readiness gate (`missionUnreadyServers`) expands a crew-ref slot. Transitive
 * non-escalation composes by intersecting the enclosing (already-effective `L1 ∩ L0 …`) scope with the
 * crew-ref member's OWN grants — so a nested plan can only ever NARROW, never re-widen (the R6 escalation).
 *
 * The one subtlety: a crew-ref planned unit carries NO grants of its own by DEFAULT — `crewRefToPlannedAgent`
 * fills an empty `{ servers:{}, builtins:[] }` placeholder for a member that set no explicit override. Feeding
 * that placeholder through {@link effectiveAgentGrants} as a bound would DROP every server for the whole
 * sub-crew (an empty parent-servers map means "drop all", the R-MCP1 absent-means-none rule) — turning a mere
 * delegation container into a tool-strip, and making a level-2 agent's scope NOT the transitive intersection
 * (it would be ∅, not `L2 ∩ L0`). So an ENTIRELY-EMPTY crew-ref grant is read as "no additional restriction"
 * and passes the enclosing scope through UNCHANGED (mirroring effectiveAgentGrants' own empty-builtins-means-
 * unset convention). A crew-ref that names ANY explicit server/built-in is a real narrowing and is intersected
 * normally, so a crew-ref that deliberately scopes its sub-crew down still binds. Pure; never mutates inputs.
 */
function subCrewParentScope(
  crewRefGrants: HubToolGrants,
  enclosingScope: HubToolGrants | null,
): HubToolGrants | null {
  const hasExplicitGrant =
    Object.keys(crewRefGrants.servers).length > 0 || crewRefGrants.builtins.length > 0;
  if (!hasExplicitGrant) return enclosingScope; // a placeholder crew-ref imposes no extra narrowing
  return effectiveAgentGrants(crewRefGrants, enclosingScope);
}

/**
 * hub-fixes WP2.3 (D-HF5) — describe what the parent-scope intersection removed from a planned agent's
 * raw grants, for the board note appended to `agent_spawned.brief` (an EXISTING free-text channel — see
 * `runMission`'s spawn loop). Returns `undefined` when the intersection removed nothing (the common case
 * — an unscoped/"auto" parent, or a scoped parent whose bounds already cover the plan's own grants), so
 * the board note is added ONLY when there is something to explain.
 */
function describeGrantNarrowing(planGrants: HubToolGrants, effectiveGrants: HubToolGrants): string | undefined {
  const droppedServers = Object.keys(planGrants.servers).filter((id) => !(id in effectiveGrants.servers));
  const narrowedServers = Object.keys(effectiveGrants.servers).filter((id) => {
    const before = planGrants.servers[id] as HubServerToolGrant;
    const after = effectiveGrants.servers[id] as HubServerToolGrant;
    return before === "all" ? after !== "all" : Array.isArray(after) && after.length < before.length;
  });
  const droppedBuiltins = planGrants.builtins.filter((name) => !effectiveGrants.builtins.includes(name));
  if (droppedServers.length === 0 && narrowedServers.length === 0 && droppedBuiltins.length === 0) {
    return undefined;
  }
  const bits: string[] = [];
  if (droppedServers.length > 0) bits.push(`removed access to ${droppedServers.join(", ")}`);
  if (narrowedServers.length > 0) bits.push(`narrowed the tools granted on ${narrowedServers.join(", ")}`);
  if (droppedBuiltins.length > 0) bits.push(`removed built-ins ${droppedBuiltins.join(", ")}`);
  return `⚠ This agent's access was reduced by the session's own tool scope — ${bits.join("; ")}.`;
}

// ── Production DI seams (NOT gate-verified — no live provider; owner-acceptance) ────────────────────

/** Production agent runner: a `generateObject` structured-output call over the shared report schema.
 *  The orchestrator re-stamps `agentSessionId`/`roleName`/`agentRef`, so the model only supplies the
 *  substance (findings/citations/confidence/open questions). hub-fixes WP2.1 (D-HF7): kept as the
 *  `HUB_AGENT_RUNNER=structured` rollback path — tool-less, hardcodes `costUsd: 0` (the honest cost of a
 *  single structured-output call is folded into the mission total by the orchestrator either way). */
export function createStructuredAgentRunner(deps: {
  /** model-identity WP4.2 — widened to take the credential that owns the model (D-MI1). Additive. */
  buildModel: (modelId: string, providerCredentialId?: string) => LanguageModel;
}): HubAgentRunner {
  return async (input) => {
    const { object, usage } = await generateObject({
      model: deps.buildModel(input.model, input.providerCredentialId),
      schema: hubAgentReportSchema,
      system: input.systemPrompt,
      prompt: input.brief,
      abortSignal: input.abortSignal,
    });
    return {
      report: object as HubAgentReport,
      costUsd: 0,
      tokensIn: usage?.inputTokens ?? 0,
      tokensOut: usage?.outputTokens ?? 0,
    };
  };
}

/** hub-fixes WP2.1 (RC2) — the stable marker planted verbatim in {@link AGENT_REPORT_EXTRACTION_SYSTEM}, so
 *  the deterministic e2e stub LLM (`e2e/fixtures/hub-stub-llm-server.ts`, which cannot read a JSON schema
 *  off the wire) can tell the per-agent REPORT-EXTRACTION structured call apart from the mission-PLAN one.
 *  The stub carries a copy of this exact literal (kept in sync by this comment). */
export const HUB_AGENT_REPORT_EXTRACTION_MARKER = "[[hub-agent-report-extraction]]";

const AGENT_REPORT_EXTRACTION_SYSTEM = `${HUB_AGENT_REPORT_EXTRACTION_MARKER} You extract a STRUCTURED mission-agent report from a specialist agent's COMPLETED work transcript. Read the transcript below — its task, the tools it called and their results, and its conclusions — and produce the report contract: a short \`summary\`, \`findings\` (each cited to the sources it actually used), \`artifacts\`, a calibrated \`confidence\`, and \`openQuestions\`. Report ONLY what the transcript supports — never invent a fact, a tool result, or a source the agent did not obtain. Citation floor (v1-fixes F9): when the transcript names the data system, app, or dataset the agent queried but lists no explicit sources, emit ONE citation naming that system (title only, no URL) — a report whose transcript shows where its numbers came from must not return an empty \`citations\` list.`;

/**
 * hub-fixes WP2.1 (RC2, D-HF7 — the production default) — the SESSION agent runner: run the planned agent
 * as a REAL child hub session through the turn engine (`runAgentTurn` — granted MCP tools callable, tool
 * calls + usage persisted into the CHILD log), then extract a schema-guaranteed {@link HubAgentReport} from
 * the settled transcript via a bounded `generateObject`. Returns the child turn's REAL accumulated
 * usage/cost PLUS the extraction call's — never a hardcoded zero. Any non-read-only MCP tool the minimal
 * mission-`auto` policy auto-declined is noted on the report's open questions.
 */
export function createSessionAgentRunner(deps: {
  runAgentTurn: (input: HubAgentTurnInput) => Promise<HubAgentTurnResult>;
  repository: Pick<HubRepository, "listEvents">;
  /** model-identity WP4.2 — widened to take the credential that owns the model (D-MI1), so the report
   *  EXTRACTION call resolves on the provider the orchestrator picked. Additive: a one-argument stub
   *  still satisfies this type, so every existing construction compiles unchanged. */
  buildModel: (modelId: string, providerCredentialId?: string) => LanguageModel;
  /** hub-fixes (Defect 4) — bound the post-turn report-EXTRACTION `generateObject` so a hung provider call
   *  can't freeze the mission's parallel join (the extraction runs AFTER the child turn's clock has
   *  stopped, so nothing else caps it — the concrete permanent-freeze site). On timeout the runner falls
   *  back to the deterministic prose projection, so the agent still produces a report. 0/absent ⇒ no cap. */
  extractionTimeoutMs?: number;
}): HubAgentRunner {
  return async (input) => {
    if (!input.roleTemplate) {
      throw new Error("The session agent runner requires `roleTemplate` on the run input (WP2.1).");
    }
    const { result, deniedToolCalls, timedOutToolCalls } = await deps.runAgentTurn({
      agentSessionId: input.agentSessionId,
      roleTemplate: input.roleTemplate,
      brief: input.brief,
      ...(input.budgets ? { budgets: input.budgets } : {}),
      abortSignal: input.abortSignal,
      // hub-fixes WP2.5 (D-HF6) — the mission-autonomy approval policy + the board-mirror sink (only an
      // always_ask mission sets a sink; the mission approval carries the autonomy + timeout ledger).
      ...(input.missionApproval ? { missionApproval: input.missionApproval } : {}),
      ...(input.sink ? { sink: input.sink } : {}),
    });

    // Aborted before/while running ⇒ no report (partial mission); still surface the REAL turn usage.
    if (input.abortSignal.aborted) {
      return {
        report: undefined,
        costUsd: result.costUsd,
        tokensIn: result.tokensIn,
        tokensOut: result.tokensOut,
        aborted: true,
      };
    }

    // Extract the structured report from the child's settled transcript (bounded structured output).
    // hub-fixes (Defect 2) — extract with the PARENT/mission model (`input.extractionModel`), NEVER the
    // agent's own `model`: a facade agent-model (a Acme-Answers assistant) can't produce structured
    // output, so running the extraction on it threw and wrongly failed an agent that had real findings. A
    // structured-incapable extraction model — or a transient extraction failure — falls back to a
    // DETERMINISTIC prose projection, so an agent that produced real work is never dropped from synthesis.
    const events = deps.repository.listEvents(input.agentSessionId);
    const transcript = renderAgentTranscript(events);
    const extractionModel = input.extractionModel ?? input.model;
    let report: HubAgentReport | undefined;
    let extractionTokensIn = 0;
    let extractionTokensOut = 0;
    let extractionCost = 0;
    if (input.reportContract) {
      // ── model-identity WP4.2 (D-MI4) — the PROMPT-ENFORCED contract path. This agent ran on the
      //    Agent-SDK subscription child, which has no structured-output mode, so there is nothing to
      //    call `generateObject` on: the report is the block the role prompt told it to emit, parsed
      //    (and narrowly repaired) out of its own settled prose. Costs nothing — no second model call.
      //
      //    Three outcomes, none of which fabricates a report (see `agent-report-contract.ts`):
      //      parsed   → the agent's own structured report;
      //      absent   → the SAME deterministic prose projection every structured-incapable model gets,
      //                 marked visibly so a thin report is explainable rather than mysterious;
      //      unusable → an honest THROW, which the orchestrator settles BY NAME with this cause.
      // Over ALL settled assistant prose in order, not just the final message: a child that called tools
      // emits several settled blocks, and the contract block rides whichever one ended its work. The
      // parser already prefers the LAST match, so scanning more text cannot let an earlier "here is the
      // shape I'll use" example shadow the real block.
      const parsed = parseAgentReportContract(allSettledAssistantProse(events));
      if (parsed.outcome === "parsed") {
        report = noteGatedDenials(parsed.report, deniedToolCalls, timedOutToolCalls ?? 0);
      } else if (parsed.outcome === "absent") {
        const projected = projectTranscriptToReport(events);
        if (!projected) {
          throw new HubAgentReportContractError(
            "it produced no report block and no answer to fall back on (the subscription child returned an empty transcript)",
          );
        }
        report = noteGatedDenials(
          noteProjectedReport(projected),
          deniedToolCalls,
          timedOutToolCalls ?? 0,
        );
      } else {
        throw new HubAgentReportContractError(parsed.reason);
      }
    } else if (isStructuredOutputModel(extractionModel)) {
      // hub-fixes (Defect 4) — bound the extraction so a hung provider call can't freeze the parallel join
      // (it runs after the child turn's clock has stopped). A timeout aborts it and we fall back to the
      // deterministic projection below, exactly like any other extraction failure.
      const controller = new AbortController();
      const onAbort = (): void => controller.abort();
      input.abortSignal.addEventListener("abort", onAbort, { once: true });
      const timeoutMs = deps.extractionTimeoutMs;
      const timer = timeoutMs && timeoutMs > 0 ? setTimeout(() => controller.abort(), timeoutMs) : undefined;
      try {
        const extraction = await generateObject({
          model: deps.buildModel(extractionModel, input.extractionProviderCredentialId),
          schema: hubAgentReportSchema,
          system: AGENT_REPORT_EXTRACTION_SYSTEM,
          prompt: transcript,
          abortSignal: controller.signal,
        });
        extractionTokensIn = extraction.usage?.inputTokens ?? 0;
        extractionTokensOut = extraction.usage?.outputTokens ?? 0;
        extractionCost = estimateCost(extractionModel, {
          inputTokens: extractionTokensIn,
          outputTokens: extractionTokensOut,
        });
        report = noteGatedDenials(extraction.object as HubAgentReport, deniedToolCalls, timedOutToolCalls ?? 0);
      } catch (error) {
        // Extraction failed or TIMED OUT — salvage the agent's prose deterministically rather than fail an
        // agent that produced real work; only a genuinely empty transcript has nothing to salvage.
        const projected = projectTranscriptToReport(events);
        if (!projected) throw error;
        report = noteGatedDenials(projected, deniedToolCalls, timedOutToolCalls ?? 0);
      } finally {
        if (timer) clearTimeout(timer);
        input.abortSignal.removeEventListener("abort", onAbort);
      }
    } else {
      // A structured-incapable extraction model (a facade assistant): skip the guaranteed-to-fail,
      // billable structured call and project the child's prose deterministically (report undefined ⇒ an
      // honest skip when the transcript has no usable prose).
      const projected = projectTranscriptToReport(events);
      report = projected ? noteGatedDenials(projected, deniedToolCalls, timedOutToolCalls ?? 0) : undefined;
    }
    return {
      // REAL usage/cost: the child turn's accumulated tokens/cost (the turn engine priced + persisted
      // them) PLUS this extraction call's (zero when we projected deterministically) — no hardcoded zero.
      report,
      costUsd: result.costUsd + extractionCost,
      tokensIn: result.tokensIn + extractionTokensIn,
      tokensOut: result.tokensOut + extractionTokensOut,
    };
  };
}

/** Render a mission agent's settled child-session event log into a compact plain-text transcript for the
 *  report-extraction call — the task, the tools it called + their results, and its own prose. Bounded so a
 *  runaway transcript can't blow the extraction prompt (the extraction is a cheap secondary call). */
function renderAgentTranscript(events: readonly HubEvent[]): string {
  const MAX_CHARS = 24_000;
  const lines: string[] = [];
  for (const event of events) {
    if (event.type === "user_message") {
      lines.push(`Task:\n${event.text}`);
    } else if (event.type === "assistant_message") {
      const text = event.parts
        .filter((p): p is Extract<(typeof event.parts)[number], { type: "text" }> => p.type === "text")
        .map((p) => p.text)
        .join("")
        .trim();
      if (text) lines.push(`Agent: ${text}`);
    } else if (event.type === "tool_call") {
      const args = event.part.args !== undefined ? ` ${JSON.stringify(event.part.args)}` : "";
      lines.push(`Tool call: ${event.part.toolName}${args}`);
    } else if (event.type === "tool_result") {
      const label =
        event.state === "output-denied"
          ? "denied (approval declined)"
          : event.state === "output-error"
            ? `error: ${event.errorText ?? "tool failed"}`
            : truncate(stringifyResult(event.modelContent), 1_000);
      lines.push(`Tool result: ${label}`);
    }
  }
  return truncate(lines.join("\n\n"), MAX_CHARS);
}

/**
 * hub-fixes (Defect 2/3) — the DETERMINISTIC fallback for report extraction: project a child agent's
 * SETTLED prose into a schema-valid {@link HubAgentReport}. Used when the extraction model can't produce
 * structured output (a Acme-Answers facade model with no JSON-schema mode) or the extraction call fails,
 * so an agent that produced REAL work is never dropped from the mission's synthesis. Citations the agent
 * actually surfaced are carried through via {@link reconstructCitationBaseline} so they survive into the
 * cited synthesis. Returns `undefined` only when the transcript has no usable assistant prose (nothing to
 * salvage — an honest skip, not a failure).
 */
export function projectTranscriptToReport(events: readonly HubEvent[]): HubAgentReport | undefined {
  const prose = settledAssistantProse(events);
  if (!prose) return undefined;
  const citations = reconstructCitationBaseline(events);
  const citationIds = citations.map((c) => c.id);
  const finding: HubAgentFinding = {
    summary: truncate(firstParagraph(prose), 1_000),
    ...(prose.length > 1_000 ? { detail: truncate(prose, 4_000) } : {}),
    ...(citationIds.length > 0 ? { citationIds } : {}),
    confidence: "low",
  };
  return {
    summary: truncate(prose, 600),
    findings: [finding],
    citations,
    artifacts: [],
    confidence: "low",
    openQuestions: [],
  };
}

/** model-identity WP4.2 — EVERY settled assistant text block, in order, for the prompt-enforced report
 *  contract's parse (see the call site). Distinct from {@link settledAssistantProse}, which deliberately
 *  keeps only the LAST block because a prose PROJECTION should summarize the conclusion, not the whole
 *  transcript. */
function allSettledAssistantProse(events: readonly HubEvent[]): string {
  const blocks: string[] = [];
  for (const event of events) {
    if (event.type !== "assistant_message") continue;
    const text = event.parts
      .filter((p): p is Extract<(typeof event.parts)[number], { type: "text" }> => p.type === "text")
      .map((p) => p.text)
      .join("")
      .trim();
    if (text) blocks.push(text);
  }
  return blocks.join("\n\n");
}

/** The child's final settled assistant prose (the concatenated text parts of the LAST non-empty
 *  `assistant_message`) — the substance a fallback report is projected from. */
function settledAssistantProse(events: readonly HubEvent[]): string {
  let prose = "";
  for (const event of events) {
    if (event.type !== "assistant_message") continue;
    const text = event.parts
      .filter((p): p is Extract<(typeof event.parts)[number], { type: "text" }> => p.type === "text")
      .map((p) => p.text)
      .join("")
      .trim();
    if (text) prose = text;
  }
  return prose;
}

/** The first paragraph of a block of prose (up to the first blank line), for a compact finding summary. */
function firstParagraph(text: string): string {
  const [first] = text.split(/\n\s*\n/, 1);
  return (first ?? text).trim();
}

function stringifyResult(value: unknown): string {
  if (value === undefined || value === null) return "(no content)";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}…`;
}

/** hub-fixes WP2.5 (D-HF6) — append honest open-question note(s) when the mission-autonomy approval
 *  policy DENIED one or more tool calls this turn: auto-declined (auto/threshold gated a
 *  destructive/unannotated call, or an always_ask operator denied it) and/or auto-denied by the approval
 *  TIMEOUT (a board card left unanswered — a distinct, visible transcript note that the mission had to
 *  terminate without that work). `timedOutToolCalls` is a subset of `deniedToolCalls`. */
function noteGatedDenials(
  report: HubAgentReport,
  deniedToolCalls: number,
  timedOutToolCalls = 0,
): HubAgentReport {
  if (deniedToolCalls <= 0) return report;
  const notes: string[] = [];
  const decided = deniedToolCalls - Math.min(timedOutToolCalls, deniedToolCalls);
  if (decided > 0) {
    notes.push(
      `${decided} tool call${decided === 1 ? "" : "s"} required approval and ${decided === 1 ? "was" : "were"} auto-declined under the mission's autonomy policy — that work could not be completed autonomously.`,
    );
  }
  if (timedOutToolCalls > 0) {
    notes.push(
      `${timedOutToolCalls} tool call${timedOutToolCalls === 1 ? "" : "s"} timed out waiting for board approval and ${timedOutToolCalls === 1 ? "was" : "were"} auto-denied so the mission could terminate.`,
    );
  }
  return { ...report, openQuestions: [...report.openQuestions, ...notes] };
}

/** v1-fixes (F8) — a role `systemPrompt` that is empty or a workforce-profile placeholder ("Not yet
 *  configured — …") folds to nothing when built into a facade agent's brief. */
function cleanRoleInstruction(value: string | undefined): string {
  const t = value?.trim() ?? "";
  return /^not yet configured\b/i.test(t) ? "" : t;
}
