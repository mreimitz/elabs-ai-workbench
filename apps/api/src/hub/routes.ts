// Assistant Hub (planning/Roadmap/RM-03-assistant-hub/, WP1.2, §1.4) — the Sessions API + SSE surface over WP1.1's
// `HubSessionService`/`HubRepository`. This is the ONLY hub file this WP owns; every other `hub/*`
// module is READ, never modified.
//
// Besides the Fastify routes, this file also builds the three small pieces `index.ts` wires at
// construction time (kept here, not in `index.ts`, so index.ts's edit stays an additive import + a
// service construction + a mount line):
//   - `createHubModelResolver` — the PRODUCTION `HubModelResolver` (WP1.1's DI seam) over the real
//     `ProviderRepository`. The design gap this note used to flag — `HubSession.model` was a bare string
//     with NO paired credential id (unlike Testing's `Scenario.providerId` + `Scenario.model` pair), so
//     the resolver had to GUESS the provider from the model NAME — is closed by model-identity WP1.1/2.1
//     (D-MI1): `providerCredentialId` is now an additive optional field on the session/agent/message
//     shapes, persisted on `hub_sessions`/`hub_agents` (migration v55), and when present it is
//     AUTHORITATIVE — the resolver uses exactly that credential and never re-infers. That is what makes a
//     `claude_subscription` session actually run on the subscription: `inferHubModelKind`'s return type
//     structurally excludes `claude_subscription`, and the subscription reports Anthropic's CANONICAL
//     model ids on purpose, so the heuristic could only ever pick the metered API key ("your credit
//     balance is too low"). Absent/NULL (every pre-v55 row) ⇒ the unchanged NAME-PREFIX heuristic
//     (`claude-`→anthropic, `gpt-`/`o<digit>`→openai, `gemini-`→google), preferring a non-broken match,
//     falling back to the first eligible credential — now with a `log.warn` so the guess is visible. It
//     409s when no hub-eligible credential exists at all, and (WP2.2, D-MI9) when a pin IS supplied but
//     is unknown / not hub-eligible / auth-broken: an explicit choice is honoured or refused, never
//     quietly swapped for a different credential.
//   - `reconcileOrphanHubSessions` / `reconcileOrphanHubMissions` (WP4.3) — startup orphan
//     reconciliation (the `index.ts` pattern every other feature follows: scans/runs/assistant
//     threads/suite runs) — sessions AND missions mid-flight at boot both settle to honest interrupted
//     terminals; see each function's own doc for why a mission needs its own pass.
//   - `assertHubProviderConfigured` — the 409 gate mirroring the Assistant dock's `assertConfigured()`
//     posture, checked at the route before any model resolution is attempted.
//
// SSE design note: unlike `testing/routes.ts`'s `RunManager` (which needs a BOUNDED in-memory replay
// buffer because a run's live event stream can outrun what's cheap to keep), a hub session's settled
// events are ALWAYS durable — `HubSessionService`/`runHubTurn` persist every settled event via
// `HubRepository.appendEvent` BEFORE forwarding it to the sink (turn-engine.ts's `persist` choke point).
// So a reconnecting client can always get its full history straight from `listEvents`; the small
// `HubChannelRegistry` below exists only to fan out events/deltas that happen WHILE a client is
// connected, plus a `closed` signal (session ended/deleted) — no buffer, no eviction policy needed.
// Streaming text/reasoning deltas (`HubStreamDelta`) are deliberately NOT part of the persisted
// `HubEvent` union (turn-engine.ts's own doc), so they're wrapped in a session-local `stream_delta` wire
// frame for this SSE surface — WP1.3's client is the first real consumer of that shape.
//
// `POST .../messages` mirrors `POST /api/runs`'s fire-and-forget kickoff (202 + a streamUrl), NOT the
// Assistant dock's awaited `sendMessage` — `HubSessionService.dispatchMessage` runs the WHOLE turn to
// completion before its promise resolves (`runHubTurn` is awaited inside it), so blocking the response
// on it would hold the HTTP request open for the turn's full duration. A synchronous
// `repository.getSession` existence check runs BEFORE the async kickoff so an unknown session id still
// surfaces as a real 404 on the POST, not a swallowed background rejection.
//
// `POST .../branch` (v1 scope): copies the CONVERSATIONAL event types only (user/assistant messages,
// reasoning, tool calls/results) into a new session, optionally cut off at a `seq`. Mission/artifact/
// review/memory events are deliberately NOT copied — those entities are not session-scoped clones and
// real branch semantics for them is a later WP's job (the execution plan's dependency graph has WP2.5
// "Composer power features" build the branch UI on top of this route).
//
// WP1.6 (§1.4, R-UX13) adds the ARTIFACT REST surface below `registerHubArtifactRoutes`: list/create,
// list versions + append a version (the direct-UI-edit path — the `artifacts.create`/`.update` BUILT-INS
// from WP0.5 already cover the MODEL's path, authored `authorKind: "assistant"`; these routes are the
// USER's path, always authored `authorKind: "user"`), and export (`md`/`html`/`json` + the distinct,
// self-contained `share.html` action). Export/share render is entirely LOCAL (see the
// "Artifact export rendering" section below) — the API has no markdown-parser dependency, so it's a
// small, dependency-free block-level renderer (headings, paragraphs, lists, blockquotes, fenced code,
// GFM-ish pipe tables, and `[^n]`/`[^n]: …` footnotes) rather than pulling in a new package. `format=`
// only ever takes `md|html|json` (`HUB_ARTIFACT_EXPORT_FORMATS`, shared) — `share.html` is a SEPARATE
// one-click route per the shared constant's own doc, not a fourth format value.
import crypto, { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import fastifyMultipart from "@fastify/multipart";
import {
  DEFAULT_TOKEN_PROFILE,
  hubAgentRoleInputSchema,
  hubAgentRolePatchSchema,
  hubAgentSteerInputSchema,
  hubAnswerRequestSchema,
  hubApprovalDecisionInputSchema,
  hubArtifactExportFormatSchema,
  hubArtifactKindSchema,
  hubAuditKindSchema,
  hubAutonomyPatchSchema,
  hubCrewInputSchema,
  hubCrewPatchSchema,
  hubElicitationResponseInputSchema,
  hubFileLinkRoleSchema,
  hubMemoryInputSchema,
  hubMemoryKindSchema,
  hubMemoryPatchSchema,
  hubMemoryScopeSchema,
  hubMemoryStatusSchema,
  hubProjectInputSchema,
  hubProjectPatchSchema,
  hubProjectPinnedFileInputSchema,
  hubResourceAttachInputSchema,
  hubReviewStatusSchema,
  hubSendMessageInputSchema,
  hubSessionCreateInputSchema,
  hubSessionKindSchema,
  hubSessionPatchSchema,
  hubSessionSkillsInputSchema,
  hubUiStateInputSchema,
  hubUsageGroupBySchema,
  HUB_ARTIFACT_TITLE_MAX_LENGTH,
  HUB_GENUI_SPEC_VERSION,
  HUB_REVIEW_MAX_COMMENTS,
  MODEL_CONTEXT_LIMITS,
  providerKindLabel,
  type HubAgentRole,
  type HubArtifact,
  type HubArtifactExportFormat,
  type HubArtifactKind,
  type HubArtifactVersion,
  type HubEvent,
  type HubOpenQuestion,
  type HubFile,
  type HubMcpServerStatusEntry,
  type HubReview,
  type HubReviewAnchor,
  type HubReviewComment,
  type HubReviewDecisionResult,
  type HubServerToolGrant,
  type HubSession,
  type HubSessionDetail,
  type HubSessionKind,
  type HubSessionSkillsView,
  type HubToolGrants,
  type HubUsageAggregates,
  type HubUsageRow,
  type HubUsageSummary,
  type NormalizedToolDefinition,
  type ProviderCredential,
} from "@mcp-token-footprint/shared";
import { generateObject } from "ai";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { modelFor } from "../providers/registry.js";
import type { ProviderRepository } from "../providers/repository.js";
import type { ScanRepository } from "../scans/repository.js";
import type { ScanService } from "../scans/service.js";
import type { ServerRepository } from "../servers/repository.js";
import { isTerminalStatus } from "../testing/run-manager.js";
import { terminalFor } from "../testing/session-terminal.js";
import { getTokenCounter } from "../token-counting/profiles.js";
import type { TokenCounter } from "../token-counting/types.js";
import { httpError, toErrorMessage } from "../utils/errors.js";
import { listHubAudit } from "./audit.js";
import { HUB_MODEL_KINDS, isHubModelKind, type HubAiSdkModelKind } from "./capabilities.js";
import {
  assertCrewMemberCredentials,
  orList,
  resolveExplicitHubCredential,
} from "./credential-guard.js";
import {
  buildHubContextInspector,
  type HubContextMcpCatalogProvider,
  type HubSessionContextPayload,
} from "./context-inspector.js";
import { assertHubUploadCap, DEFAULT_HUB_FILE_CAPS, type HubFileCaps } from "./files/caps.js";
import {
  buildPlannerServerCatalog,
  isTerminalMissionStatus,
  pinForModel,
  registerHubMissionRoutes,
  type HubMissionService,
} from "./missions/index.js";
import { summarizeBudgets } from "./missions/shared.js";
import { modeAddendumLayer, safetyLayer } from "./prompting/index.js";
import { extractResourceAnnotations, reconstructAttachedResources } from "./resources.js";
import type { HubEventInput, HubRepository } from "./repository.js";
import {
  buildHubSessionJsonReport,
  buildHubSessionMarkdownReport,
} from "./session-report.js";
import {
  computeSessionSkillUsage,
  computeSkillListing,
  invocationOrderFromLoads,
  reconstructLoadedSkills,
  resolveHubSkillAttachments,
  type HubSkillReader,
} from "./skill-attachments.js";
import type { HubModelResolution, HubModelResolver, HubSessionService } from "./session-service.js";
import { unionRosterServersIntoScope } from "./roster-scope.js";
import {
  DEFAULT_CHAT_BUILTIN_NAMES,
  type HubMcpServerCatalog,
  type HubToolLoadingPreference,
} from "./tools/index.js";
import {
  isBudgetTripStopReason,
  wrapSinkForWaitingInputNotify,
  type HubNotifySink,
  type HubStreamDelta,
  type HubTurnSink,
} from "./turn-engine.js";
import {
  buildHubUsageAggregates,
  buildHubUsageRollup,
  buildHubUsageSummary,
  createHubUsageProviderResolver,
} from "./usage.js";
import {
  createWorkspaceSnapshot,
  ensureHubWorkspaceRoot,
  listWorkspaceSnapshots,
  listWorkspaceTree,
  readWorkspaceTextFile,
  restoreWorkspaceSnapshot,
} from "./workspace.js";

// ── Production `HubModelResolver` over the real provider-credential store ──────────────────────────

const NO_PROVIDER_MESSAGE =
  "The Assistant is not configured. Add a provider credential " +
  `(${orList(HUB_MODEL_KINDS.map((kind) => providerKindLabel(kind)))}) in Settings first.`;

/** Hub-eligible credentials only (D-AH4) — `acme_answers` is never a hub model. */
export function hubEligibleCredentials(providers: ProviderRepository): ProviderCredential[] {
  return providers.list().filter((credential) => isHubModelKind(credential.kind));
}

export function hasHubProviderCredential(providers: ProviderRepository): boolean {
  return hubEligibleCredentials(providers).length > 0;
}

/** 409 gate mirroring the Assistant dock's `assertConfigured()` posture — checked at the route, before
 *  any model resolution is attempted, so a missing credential always surfaces as a clean 409. */
export function assertHubProviderConfigured(providers: ProviderRepository): void {
  if (!hasHubProviderCredential(providers)) throw httpError(409, NO_PROVIDER_MESSAGE);
}

/**
 * A crude but effective model-id → provider-kind hint — see the module doc's design-gap note.
 *
 * Exported (WP4.1) so `hub/usage.ts`'s provider rollups reuse this SAME heuristic rather than
 * re-deriving one. **model-identity WP3.3 correction:** the older claim here — that the heuristic and
 * the credential that actually runs a turn always match — is only true for an UNPINNED session. Since
 * WP2.1 a session may persist an explicit `provider_credential_id` (D-MI1), and for a pinned session
 * the two can genuinely disagree: the return type below is `HubAiSdkModelKind | undefined`, a union
 * that structurally EXCLUDES `claude_subscription`, so it can never name the subscription even when
 * that is demonstrably the credential running the turn. Usage attribution therefore reads the
 * persisted column first and calls this only for a NULL one (`createHubUsageProviderResolver`).
 */
export function inferHubModelKind(modelId: string): HubAiSdkModelKind | undefined {
  const lower = modelId.toLowerCase();
  if (lower.startsWith("claude")) return "anthropic";
  if (lower.startsWith("gpt-") || /^o[1-9]/.test(lower)) return "openai";
  if (lower.startsWith("gemini")) return "google";
  return undefined;
}

/** model-identity WP2.1 — the minimal structured-logger shape the resolver needs to make an UNPINNED
 *  (heuristic) resolution visible. Fastify's own `app.log`/`server.log` satisfies it directly; a test or
 *  a bare construction may omit it entirely. Never `console.log`, and never a decrypted secret — only the
 *  model id, the chosen credential's id, and its kind. */
export type HubModelResolverLogger = {
  warn: (context: Record<string, unknown>, message: string) => void;
};

// model-identity WP2.1/WP2.2 (D-MI1/D-MI9) — `resolveExplicitHubCredential` used to live here. WP6.1
// (F5) moved it, with `orList`/`describeHubCredential`, to `./credential-guard.ts` so the surfaces that
// were BYPASSING it — the crew routes below and the dock's Hub write tools — enforce the same 409
// posture with the same error vocabulary, instead of each route file owning a private copy.

/**
 * Build the production {@link HubModelResolver}.
 *
 * **With an explicit `providerCredentialId` (model-identity WP2.1, D-MI1): that credential is
 * AUTHORITATIVE.** It is validated (exists · hub-eligible · not auth-broken) and used as-is — the name
 * heuristic never runs, so a `claude_subscription` credential resolves to `providerKind:
 * "claude_subscription"` **with no `buildModel`**, which is what routes the turn to the subscription
 * executor instead of the metered Anthropic API key. This is the whole defect: `inferHubModelKind`'s
 * return type structurally excludes `claude_subscription`, so before this WP the subscription branch was
 * dead code for every model the subscription offers (it reports Anthropic's canonical ids on purpose).
 *
 * **With an UNUSABLE explicit one (model-identity WP2.2, D-MI9): a 409, never a re-pick.** Unknown,
 * not hub-eligible, or auth-broken ⇒ {@link resolveExplicitHubCredential} throws. Degrading to the
 * heuristic here would reproduce the original defect on the request path — the operator pins one
 * credential, another one runs (and bills) the turn, and nothing says so.
 *
 * **Without one:** the historical behavior, byte-identical — pick a hub-eligible credential (D-AH4),
 * preferring a name-hinted kind match among NON-BROKEN credentials, falling back to any eligible one —
 * plus a `log.warn` naming the model and the credential it guessed, so the guess is visible in the log
 * instead of silent. Absent is NOT an error: every pre-v55 row is unpinned and must keep replaying.
 * Either way it 409s when no hub-eligible credential exists at all (the module's `NO_PROVIDER_MESSAGE`
 * gate).
 */
export function createHubModelResolver(
  providers: ProviderRepository,
  logger?: HubModelResolverLogger,
): HubModelResolver {
  return (modelId: string, providerCredentialId?: string): HubModelResolution => {
    const eligible = hubEligibleCredentials(providers);
    if (eligible.length === 0) throw httpError(409, NO_PROVIDER_MESSAGE);

    let chosen: ProviderCredential;
    if (providerCredentialId) {
      // ── The EXPLICIT path: the pin wins, nothing is re-inferred, and an unusable pin is a 409. ──
      chosen = resolveExplicitHubCredential(providers, providerCredentialId, modelId);
    } else {
      // ── The HEURISTIC path (unchanged): a legacy/unpinned row — reached ONLY with no pin at all. ──
      const usable = eligible.filter((credential) => credential.authBroken !== true);
      const pool = usable.length > 0 ? usable : eligible;
      const hinted = inferHubModelKind(modelId);
      // Split out (rather than inlined behind `??`) so the log can distinguish a real name-hint match
      // from the UNTYPED first-eligible fallback — the path that makes a subscription-only install
      // "work by accident", and the one most likely to be quietly wrong on a mixed install.
      const hintMatch = hinted ? pool.find((credential) => credential.kind === hinted) : undefined;
      const guessed = hintMatch ?? pool[0];
      if (!guessed) throw httpError(409, NO_PROVIDER_MESSAGE);
      chosen = guessed;
      logger?.warn(
        {
          modelId,
          credentialId: chosen.id,
          credentialKind: chosen.kind,
          hintedKind: hinted ?? null,
          heuristic: hintMatch ? "name_hint_match" : "first_eligible",
          eligibleCount: eligible.length,
        },
        hintMatch
          ? "hub model resolution: no provider credential was pinned — guessed one from the model name (a claude_subscription credential can never be guessed this way)"
          : "hub model resolution: no provider credential was pinned and the model name matched no eligible credential kind — falling back to the FIRST eligible credential (a claude_subscription credential can never be guessed this way)",
      );
    }

    const providerKind = chosen.kind;
    const contextWindow = MODEL_CONTEXT_LIMITS[modelId] ?? 0;
    // model-identity WP6.1 (F6, D-MI11) — MAKE THE DATA GAP LOUD.
    //
    // A `0` here is not cosmetic: `hub/compaction.ts` gates on a positive window, so compaction is
    // DISABLED, and every "% of context used" surface becomes meaningless. That is the owner's
    // original secondary defect, and until now it happened in total silence — no log, no flag.
    //
    // It cannot be closed by a test alone, and the WP1.3 tests that claimed to ("locks the invariant
    // so the gap cannot silently reopen when a new model joins the roster") could not: they iterate
    // the STATIC `ASSISTANT_DEFAULT_MODEL_ROSTER`, while the live ids come from the SDK
    // (`providers/subscription-models.ts` `mapModels` → `model.resolvedModel`) and never join that
    // constant. An id that does not exist yet cannot be asserted about. A runtime warning CAN name it
    // the first time it is actually resolved — which is what this is.
    if (contextWindow <= 0) {
      logger?.warn(
        { modelId, credentialId: chosen.id, credentialKind: chosen.kind },
        "hub model resolution: no known context window for this model — compaction is DISABLED and " +
          "every context-usage surface will read as meaningless for this session. Add the id to " +
          "ROSTER_GAP_MODEL_CONTEXT_LIMITS (packages/shared/src/constants.ts), or refresh the model " +
          "dataset and regenerate (pnpm build:data-pack)",
      );
    }
    if (providerKind === "claude_subscription") {
      return { providerKind, modelId, contextWindow };
    }
    const decrypted = providers.getDecrypted(chosen.id);
    return {
      providerKind,
      modelId,
      contextWindow,
      buildModel: () => modelFor(decrypted, modelId),
    };
  };
}

// ── WP3.5 review-critic model call (D-AH12, D-AH7) ──────────────────────────────────────────────────
//
// A review request "spawns a critic agent" (execution-plan §2 WP3.5) — but a review isn't a MISSION
// (`hub_reviews` carries no `mission_id`, no plan/approval/budget apparatus; it's a single synchronous
// structured-output pass over one artifact version, not a multi-agent fan-out). So this seam mirrors
// `missions/orchestrator.ts`'s `createStructuredAgentRunner` (a `generateObject` call built from
// `deps.providers`) rather than reusing `HubMissionService` itself — no `index.ts` wiring is needed
// (`HubRouteDeps.reviewAgentRunner` defaults to the production implementation below, built from the
// SAME `providers` the route deps already carry), and tests inject a stub exactly like
// `HubRouteDeps.missionService` lets `hub-missions.test.ts` inject a stub `runAgent`.
//
// The prompt is hand-assembled rather than routed through `assembleRolePrompt`/`roleTemplateLayer`
// (Appendix A, `prompting/layers/role-template.ts`): that layer's closing line hardcodes the MISSION
// agent's report contract (`findings`/`artifacts`/`confidence`/`open_questions`) — feeding it here would
// tell the model to return the WRONG shape for `hubReviewCommentsProposalSchema`. Two of the D-AH14
// layers genuinely DO apply to a critic pass and are reused verbatim: `modeAddendumLayer.render("critic")`
// (the adversarial-critique lens the mission critic sub-mode already uses) and `safetyLayer.render()`
// (the untrusted-content boundary — artifact content is exactly the kind of data that layer covers).
// `toolsLayer`/`citationsLayer`/`selfCheckLayer` are skipped: the critic is granted no tools at all
// (a pure text-review pass), so claiming tool/citation/GenUI capabilities it doesn't have would mislead
// the model (the tools layer's own doc: "these are the ONLY tools available").

/** The model's structured-output shape for one proposed comment — see `hubReviewCommentProposalSchema`
 *  below (this is the request-only, un-stamped counterpart to the wire {@link HubReviewComment}: no
 *  `id`/`decision`/`authorKind`/`createdAt` — the route stamps those, mirroring how the mission
 *  orchestrator re-stamps `agentSessionId`/`roleName`/`agentRef` onto a {@link HubAgentReport}). */
export type HubReviewCommentProposal = {
  body: string;
  anchor?: { quote?: string };
  suggestedEdit?: string;
};

export type HubReviewAgentInput = {
  systemPrompt: string;
  brief: string;
  model: string;
  /** model-identity WP2.1 (D-MI1) — the credential that owns {@link model}. The critic's model comes from
   *  the request body or the picked role's `defaultModel`, so the nearest authoritative source is that
   *  role's own `providerCredentialId`. Absent ⇒ the unchanged name heuristic. */
  providerCredentialId?: string;
};
export type HubReviewAgentResult = { comments: HubReviewCommentProposal[] };

/** The critic model-call DI seam — production wraps `generateObject`; tests inject a deterministic
 *  stub via `HubRouteDeps.reviewAgentRunner`. */
export type HubReviewAgentRunner = (input: HubReviewAgentInput) => Promise<HubReviewAgentResult>;

const hubReviewCommentProposalSchema = z.object({
  body: z.string().trim().min(1),
  anchor: z
    .object({ quote: z.string().trim().min(1).optional() })
    .strict()
    .optional(),
  suggestedEdit: z.string().optional(),
});

const hubReviewCommentsProposalSchema = z
  .object({ comments: z.array(hubReviewCommentProposalSchema).max(HUB_REVIEW_MAX_COMMENTS) })
  .strict();

/** Production {@link HubReviewAgentRunner}: resolves `input.model` through the SAME production model
 *  resolver every other hub model call uses, then a plain `generateObject` structured-output call
 *  (no tool loop — a critic pass is a single pure text-in/comments-out call). A subscription model
 *  (no AI-SDK `buildModel`) 400s with a clear message (mirrors `index.ts`'s `hubBuildModel` for
 *  missions) rather than silently doing nothing; a failed/timed-out provider call 502s (mirrors
 *  `grading/failure-buckets.ts`'s judge-call error handling) — never a hang, never a fake result. */
function createDefaultReviewAgentRunner(
  providers: ProviderRepository,
  logger?: HubModelResolverLogger,
): HubReviewAgentRunner {
  const resolveModel = createHubModelResolver(providers, logger);
  return async (input) => {
    const resolution = await resolveModel(input.model, input.providerCredentialId);
    if (!resolution.buildModel) {
      throw httpError(
        400,
        `Model "${input.model}" cannot run a review (no AI-SDK model builder — e.g. a subscription ` +
          "model). Pick an API-keyed model.",
      );
    }
    try {
      const { object } = await generateObject({
        model: resolution.buildModel(),
        schema: hubReviewCommentsProposalSchema,
        system: input.systemPrompt,
        prompt: input.brief,
      });
      return { comments: object.comments };
    } catch (error) {
      throw httpError(502, `Critic review failed: ${toErrorMessage(error)}`);
    }
  };
}

function line(value: string | undefined, fallback: string): string {
  return value && value.trim().length > 0 ? value.trim() : fallback;
}

/** The critic's identity/brief/output-contract block — see the section doc above for why this is
 *  hand-assembled rather than `assembleRolePrompt`. `role` is an existing role-library entry
 *  (D-AH7, optional) or absent for the built-in default critic persona. */
function buildCriticRoleText(role: HubAgentRole | undefined): string {
  const name = line(role?.name, "Critic");
  const target = line(
    role?.target,
    "Review the artifact below for correctness, clarity, and completeness.",
  );
  const expectedOutcome = line(
    role?.expectedOutcome,
    "Anchored comments — cite the exact text you are commenting on and, where you have a concrete " +
      "fix, a suggested replacement.",
  );
  const budget = summarizeBudgets(role?.budgets);
  const brief = role?.systemPrompt?.trim() ? `\n${role.systemPrompt.trim()}\n` : "";
  return `You are ${name}, reviewing ONE artifact for its author. You do not see any conversation — only the artifact content below and this brief.
${brief}
Target: ${target}
Expected outcome: ${expectedOutcome}
Budget: ${budget}

Return ONLY the review-comment contract: a \`comments\` array (0 to ${HUB_REVIEW_MAX_COMMENTS} items), each with \`body\` (your note), an optional \`anchor.quote\` (copied VERBATIM, character-for-character, from the artifact content below — this is how your comment gets located; omit it for a general comment with no single anchor point), and an optional \`suggestedEdit\` (the exact replacement text for the quoted span — only when you have a concrete fix, not a vague direction). No preamble, no markdown fencing.`;
}

function buildCriticSystemPrompt(role: HubAgentRole | undefined): string {
  const sections: Array<{ title: string; text: string }> = [
    { title: "Role", text: buildCriticRoleText(role) },
    { title: "Critique lens", text: modeAddendumLayer.render("critic") },
    { title: "Safety & honesty", text: safetyLayer.render() },
  ];
  return sections.map((s) => `## ${s.title}\n\n${s.text}`).join("\n\n");
}

function buildCriticBrief(artifact: HubArtifact, version: HubArtifactVersion): string {
  return `Artifact: "${artifact.title}" (${artifact.kind}, version ${version.version} of ${artifact.latestVersion})\n\n${version.content}`;
}

/** Locate a quote UNIQUELY (exactly one occurrence) in `content` — `undefined` when absent or
 *  ambiguous (appears more than once). Used both to enrich a freshly-proposed comment's anchor with
 *  numeric offsets (best-effort, for the diff/highlight UI) and, authoritatively, to gate whether an
 *  accepted suggestion can be auto-applied against the artifact's CURRENT content (which may have
 *  drifted since the comment was proposed — see `applyReviewSuggestion`). */
function locateQuote(content: string, quote: string): { start: number; end: number } | undefined {
  const start = content.indexOf(quote);
  if (start === -1) return undefined;
  if (content.indexOf(quote, start + 1) !== -1) return undefined; // ambiguous — more than one match
  return { start, end: start + quote.length };
}

/** Stamp the model's proposals into persisted {@link HubReviewComment}s (id/decision/authorKind/
 *  authorRef/createdAt — the route's job, mirroring the mission orchestrator's report re-stamping).
 *  A locatable `anchor.quote` is enriched with numeric offsets; an unlocatable one keeps the quote
 *  as given (still a valid, reviewable comment — see `applyReviewSuggestion` for why non-locatability
 *  only matters again at ACCEPT time, against then-current content). */
function stampReviewComments(
  proposals: HubReviewCommentProposal[],
  content: string,
  authorRef: string,
): HubReviewComment[] {
  const now = new Date().toISOString();
  return proposals.slice(0, HUB_REVIEW_MAX_COMMENTS).map((proposal) => {
    const quote = proposal.anchor?.quote;
    const located = quote ? locateQuote(content, quote) : undefined;
    const anchor: HubReviewAnchor | undefined = quote
      ? { quote, ...(located ? { startOffset: located.start, endOffset: located.end } : {}) }
      : undefined;
    return {
      id: crypto.randomUUID(),
      ...(anchor ? { anchor } : {}),
      body: proposal.body,
      ...(proposal.suggestedEdit !== undefined ? { suggestedEdit: proposal.suggestedEdit } : {}),
      decision: "pending",
      authorKind: "agent",
      authorRef,
      createdAt: now,
    };
  });
}

/** Apply an ACCEPTED comment's `suggestedEdit` against the artifact's CURRENT content — re-locates the
 *  quote NOW (never trusts a stale offset computed when the comment was proposed: an earlier accepted
 *  comment in the same review may have already shifted the text). Throws a clean 409 when the quote
 *  can't be uniquely re-located (content drifted, or the comment carries no anchor at all) — never
 *  silently no-ops and never guesses at a fuzzy match (the project's "never fake results" rule). */
function applyReviewSuggestion(content: string, comment: HubReviewComment): string {
  if (comment.suggestedEdit === undefined) {
    throw httpError(400, `"${comment.body}" has no suggested edit to apply.`);
  }
  const quote = comment.anchor?.quote;
  if (!quote) {
    throw httpError(
      409,
      `"${comment.body}" has no anchored quote to locate in the artifact's current content — resolve it with a direct edit instead.`,
    );
  }
  const located = locateQuote(content, quote);
  if (!located) {
    throw httpError(
      409,
      `Could not uniquely locate the anchored text for "${comment.body}" in the artifact's current content (it may already have changed) — resolve it with a direct edit instead.`,
    );
  }
  return content.slice(0, located.start) + comment.suggestedEdit + content.slice(located.end);
}

// ── Startup orphan reconciliation (the index.ts pattern: scans/runs/assistant threads/suite runs) ──

/**
 * Any hub session left `running` at boot lost its in-memory turn (the process is gone) — reconcile it
 * to an honest terminal (`aborted`, no live event to forward since nothing is listening yet) with a
 * settled `error` event explaining why, mirroring `RunRepository.abortOrphanedRuns` (a direct status
 * flip, no synthetic `TerminalCause` invented) + `AssistantRepository.reconcileOrphanThreads`'s message.
 */
export function reconcileOrphanHubSessions(repository: HubRepository): number {
  const orphans = repository.listSessions().filter((session) => session.status === "running");
  for (const session of orphans) {
    repository.setSessionLifecycle(session.id, { status: "aborted", phase: null });
    repository.appendEvent(session.id, {
      type: "error",
      message: "This session was interrupted by a server restart.",
      recoverable: false,
    });
  }
  return orphans.length;
}

/**
 * WP4.3 — any MISSION left `approved`/`running`/`synthesizing` at boot lost its in-memory orchestrator
 * (`HubMissionService.runMission`'s async loop — the process is gone), mirroring the session-level case
 * just above. A plain `status === 'running'` session sweep alone would MISS an orphan here: `approve()`
 * writes `status:'approved'` and spawns each agent child (`status:'pending'`) BEFORE `runMission` ever
 * reaches its own `status:'running'` write (`missions/orchestrator.ts`), so a crash in that window
 * leaves the mission at `approved` with `pending` (never-started) children — and `synthesizing` has NO
 * agent left `running` at all (they already settled before synthesis began). This reconciles the
 * mission itself to an honest `failed` terminal (it never produced a real result — `completed`/
 * `stopped` would be dishonest) with a settled `error` event on its PARENT (chat) session log, and
 * aborts any of its agent children that never reached a terminal disposition of their own (`pending` OR
 * `running` — {@link isTerminalStatus}, the SAME shared `RunStatus` vocabulary a hub session's status
 * already reuses verbatim, D-AH3). Call BEFORE {@link reconcileOrphanHubSessions} at boot — a child
 * still `running` gets its OWN error event here; the generic sweep then finds nothing left to touch.
 */
export function reconcileOrphanHubMissions(repository: HubRepository): number {
  const orphans = repository
    .listMissions()
    .filter((mission) => mission.status !== "proposed" && !isTerminalMissionStatus(mission.status));
  const now = new Date().toISOString();
  for (const mission of orphans) {
    for (const child of repository.listMissionAgentSessions(mission.id)) {
      if (isTerminalStatus(child.status)) continue;
      repository.setSessionLifecycle(child.id, { status: "aborted", phase: null });
      repository.appendEvent(child.id, {
        type: "error",
        message: "This agent was interrupted by a server restart.",
        recoverable: false,
      });
    }
    repository.updateMission(mission.id, { status: "failed", endedAt: now });
    repository.appendEvent(mission.sessionId, {
      type: "error",
      message: "This mission was interrupted by a server restart.",
      recoverable: false,
    });
  }
  return orphans.length;
}

// ── Live SSE fan-out (no bounded buffer — see the module doc) ──────────────────────────────────────

const HUB_LIVE_EVENT = "event";
const HUB_LIVE_DELTA = "delta";
const HUB_LIVE_CLOSED = "closed";

/** A streaming delta wrapped for the wire — NOT a {@link HubEvent} member (never persisted). */
export type HubStreamDeltaFrame = { type: "stream_delta" } & HubStreamDelta;

type HubSseFrame = HubEvent | HubStreamDeltaFrame;

class HubChannelRegistry {
  private readonly channels = new Map<string, { emitter: EventEmitter; subscribers: number }>();

  private ensure(sessionId: string): { emitter: EventEmitter; subscribers: number } {
    let channel = this.channels.get(sessionId);
    if (!channel) {
      channel = { emitter: new EventEmitter(), subscribers: 0 };
      channel.emitter.setMaxListeners(0); // many concurrent SSE subscribers is expected, not a leak
      this.channels.set(sessionId, channel);
    }
    return channel;
  }

  /** The {@link HubTurnSink} a dispatched turn forwards its settled events + deltas through. */
  sinkFor(sessionId: string): HubTurnSink {
    const channel = this.ensure(sessionId);
    return {
      onEvent: (event) => channel.emitter.emit(HUB_LIVE_EVENT, event),
      onDelta: (delta) => channel.emitter.emit(HUB_LIVE_DELTA, delta),
    };
  }

  /** Subscribe to a session's live frames + its `closed` signal. Returns an unsubscribe that GCs the
   *  channel once the last subscriber leaves. */
  subscribe(
    sessionId: string,
    onFrame: (frame: HubSseFrame) => void,
    onClosed: () => void,
  ): () => void {
    const channel = this.ensure(sessionId);
    channel.subscribers += 1;
    const onEvent = (event: HubEvent): void => onFrame(event);
    const onDelta = (delta: HubStreamDelta): void => onFrame({ type: "stream_delta", ...delta });
    channel.emitter.on(HUB_LIVE_EVENT, onEvent);
    channel.emitter.on(HUB_LIVE_DELTA, onDelta);
    channel.emitter.on(HUB_LIVE_CLOSED, onClosed);
    return () => {
      channel.emitter.off(HUB_LIVE_EVENT, onEvent);
      channel.emitter.off(HUB_LIVE_DELTA, onDelta);
      channel.emitter.off(HUB_LIVE_CLOSED, onClosed);
      channel.subscribers = Math.max(0, channel.subscribers - 1);
      if (channel.subscribers === 0) this.channels.delete(sessionId);
    };
  }

  /** Tell every live subscriber to close (the session ended/was deleted mid-stream). */
  closeAll(sessionId: string): void {
    const channel = this.channels.get(sessionId);
    if (!channel) return;
    channel.emitter.emit(HUB_LIVE_CLOSED);
    this.channels.delete(sessionId);
  }
}

// ── SSE wire plumbing (mirrors testing/routes.ts's streamRun template: id:<seq>, Last-Event-ID, ping) ──

/** Heartbeat cadence — a `let` so tests can shrink it (mirrors `testing/routes.ts`'s own seam). */
let SSE_HEARTBEAT_MS = 15_000;

/** Test-only seam: override the SSE heartbeat cadence; returns the previous value to restore later. */
export function setHubSseHeartbeatMsForTesting(ms: number): number {
  const previous = SSE_HEARTBEAT_MS;
  SSE_HEARTBEAT_MS = ms;
  return previous;
}

function writeSseHead(reply: FastifyReply): void {
  reply.hijack();
  reply.raw.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive",
    "x-accel-buffering": "no",
  });
  // Flush now so the client connects immediately even for a session with no history yet.
  reply.raw.flushHeaders();
}

function writeHubFrame(reply: FastifyReply, frame: HubSseFrame): void {
  if (reply.raw.writableEnded) return;
  const id = "seq" in frame && frame.seq !== undefined ? `id: ${frame.seq}\n` : "";
  reply.raw.write(`${id}data: ${JSON.stringify(frame)}\n\n`);
}

/** Parse a reconnecting client's `Last-Event-ID` header; `undefined` for a plain connect or a bad value. */
function parseLastEventId(request: FastifyRequest): number | undefined {
  const raw = request.headers["last-event-id"];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (value === undefined || value.trim() === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

/**
 * Stream a session's frames: durable replay (cursor-filtered) then live, forever — a hub session has no
 * per-request terminal status (it's a long-lived thread across many turns, like the Assistant dock's
 * `streamThread`, not a one-shot `testing` run), so the stream stays open until the client disconnects
 * or the session ends/is deleted (`HubChannelRegistry.closeAll`).
 */
async function streamHubSession(
  request: FastifyRequest,
  reply: FastifyReply,
  repository: HubRepository,
  channels: HubChannelRegistry,
  sessionId: string,
): Promise<void> {
  const cursor = parseLastEventId(request);
  writeSseHead(reply);

  await new Promise<void>((resolve) => {
    let settled = false;
    let unsubscribe: (() => void) | undefined;
    let lastWrittenSeq = cursor ?? -1;
    const heartbeat = setInterval(() => writeHubFrame(reply, { type: "ping" }), SSE_HEARTBEAT_MS);

    const close = (): void => {
      if (settled) return;
      settled = true;
      clearInterval(heartbeat);
      unsubscribe?.();
      if (!reply.raw.writableEnded) reply.raw.end();
      resolve();
    };

    // The single write choke point for this connection: dedupes by seq (a plain connect's cursor of -1
    // lets everything through), so the replay-then-live handoff below is zero-loss AND zero-dupe.
    const forward = (frame: HubSseFrame): void => {
      if ("seq" in frame && frame.seq !== undefined) {
        if (frame.seq <= lastWrittenSeq) return;
        lastWrittenSeq = frame.seq;
      }
      writeHubFrame(reply, frame);
    };

    // 1) Durable replay — a hub session's full history is always in `hub_events` (R-SES1); no in-memory
    //    buffer/DB-fallback split is needed here (unlike RunManager) since nothing can fall out of the DB.
    for (const event of repository.listEvents(sessionId)) forward(event);

    // 2) Live subscribe — NO `await` between the replay above and this attach (synchronous JS, single
    //    thread), so nothing appended between the snapshot and the subscribe can be lost or duplicated.
    unsubscribe = channels.subscribe(sessionId, forward, close);
    if (settled) return;

    request.raw.on("close", close);
  });
}

// ── Artifact export rendering (WP1.6, R-UX13) — dependency-free markdown→HTML ──────────────────────
//
// No new dependency: the API has no markdown-parser package (the web's `MarkdownView`/`react-markdown`
// live in `apps/web`, out of reach across the package boundary), so this is a small, deliberately
// conservative block-level renderer covering: ATX headings, paragraphs, blockquotes, fenced code (```),
// unordered/ordered lists, a horizontal rule, GFM-ish pipe tables, and `[^n]` footnote refs / `[^n]: …`
// definitions (rendered as a numbered list at the end with back-links) — the "citation footnotes
// preserved" half of R-UX13. Every character is HTML-escaped BEFORE any markdown construct is matched,
// so the renderer can never emit an unescaped `<`/`>`/`&` from artifact content; the only markup it ever
// emits is markup IT wrote. `html`-kind artifact content is the one exception (it already IS HTML) —
// `sanitizeHtmlFragment` strips `<script>` tags and inline event-handler/`javascript:` attributes before
// embedding it, so an export can never carry a live script even if the artifact's own content does.

const HUB_ARTIFACT_HTML_STYLE = `
:root { color-scheme: light dark; }
body { font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; max-width: 860px; margin: 2.5rem auto; padding: 0 1.5rem; line-height: 1.6; color: #1f2328; background: #ffffff; }
@media (prefers-color-scheme: dark) { body { color: #e6edf3; background: #0d1117; } a { color: #58a6ff; } pre, code { background: #161b22; } blockquote { border-color: #30363d; color: #9198a1; } hr { border-color: #30363d; } table, th, td { border-color: #30363d; } thead { background: #161b22; } }
h1, h2, h3, h4, h5, h6 { line-height: 1.25; }
pre { background: #f6f8fa; padding: 0.75rem 1rem; border-radius: 6px; overflow-x: auto; }
code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.9em; }
pre code { background: none; padding: 0; }
blockquote { border-left: 3px solid #d0d7de; margin: 0; padding: 0.1rem 1rem; color: #57606a; }
table { border-collapse: collapse; width: 100%; margin: 1rem 0; }
th, td { border: 1px solid #d0d7de; padding: 0.4rem 0.6rem; text-align: left; }
thead { background: #f6f8fa; }
.hub-share-meta { font-size: 0.85rem; color: #57606a; border-bottom: 1px solid #d0d7de; padding-bottom: 0.75rem; margin-bottom: 1.5rem; }
.footnotes { font-size: 0.9rem; border-top: 1px solid #d0d7de; margin-top: 2rem; padding-top: 1rem; }
`.trim();

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** `html`-kind content is real HTML, not markdown — strip the one thing "no script" (R-UX13) forbids:
 *  executable script, inline or referenced, plus inline event-handler attributes and `javascript:` URIs. */
function sanitizeHtmlFragment(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<script\b[^>]*\/?>/gi, "")
    .replace(/\son\w+\s*=\s*"[^"]*"/gi, "")
    .replace(/\son\w+\s*=\s*'[^']*'/gi, "")
    .replace(/\son\w+\s*=\s*[^\s>]+/gi, "")
    .replace(/(href|src)\s*=\s*"javascript:[^"]*"/gi, '$1="#"')
    .replace(/(href|src)\s*=\s*'javascript:[^']*'/gi, "$1='#'");
}

/** Inline markdown spans (code/link/bold/italic/footnote-ref) applied to an ALREADY-escaped text chunk.
 *  Code spans are masked out first so `**`/`_`/`[…]` inside a code span is never re-interpreted. */
function renderInline(text: string): string {
  const codeSpans: string[] = [];
  let out = text.replace(/`([^`]+)`/g, (_match, code: string) => {
    const index = codeSpans.push(`<code>${code}</code>`) - 1;
    return `@@CS@@CODE${index}@@CS@@`;
  });
  // Links: http(s) only — any other scheme (incl. `javascript:`) is left as literal escaped text.
  out = out.replace(
    /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
    (_match, label: string, url: string) =>
      `<a href="${url}" rel="noopener noreferrer">${label}</a>`,
  );
  // Footnote references `[^id]` (definitions are stripped at the block level before this ever runs).
  out = out.replace(
    /\[\^([A-Za-z0-9_-]+)\]/g,
    (_match, id: string) => `<sup id="fnref-${id}"><a href="#fn-${id}">${id}</a></sup>`,
  );
  out = out.replace(/\*\*([^*]+?)\*\*/g, (_match, s: string) => `<strong>${s}</strong>`);
  out = out.replace(/(?<!\*)\*([^*\n]+?)\*(?!\*)/g, (_match, s: string) => `<em>${s}</em>`);
  out = out.replace(/(?<!_)_([^_\n]+?)_(?!_)/g, (_match, s: string) => `<em>${s}</em>`);
  out = out.replace(
    /@@CS@@CODE(\d+)@@CS@@/g,
    (_match, index: string) => codeSpans[Number(index)] ?? "",
  );
  return out;
}

function splitTableRow(line: string): string[] {
  let trimmed = line.trim();
  if (trimmed.startsWith("|")) trimmed = trimmed.slice(1);
  if (trimmed.endsWith("|")) trimmed = trimmed.slice(0, -1);
  return trimmed.split("|").map((cell) => cell.trim());
}

function isTableSeparatorLine(line: string): boolean {
  if (!line.includes("|") && !/^:?-+:?$/.test(line.trim())) return false;
  const cells = splitTableRow(line);
  return cells.length > 0 && cells.every((cell) => /^:?-+:?$/.test(cell));
}

function tableCellAlign(spec: string): string {
  const left = spec.startsWith(":");
  const right = spec.endsWith(":");
  if (left && right) return ' style="text-align:center"';
  if (right) return ' style="text-align:right"';
  if (left) return ' style="text-align:left"';
  return "";
}

/** Block-level markdown → HTML. Returns the body markup plus a separately-rendered footnotes section
 *  (kept apart so callers — a `<share.html>` document vs. an inline preview — can place it deliberately). */
function renderMarkdownToHtml(markdown: string): { bodyHtml: string; footnotesHtml: string } {
  const lines = escapeHtml(markdown).replace(/\r\n/g, "\n").split("\n");
  const footnotes: Array<{ id: string; text: string }> = [];
  const blocks: string[] = [];
  let paragraph: string[] = [];
  let listItems: string[] = [];
  let listOrdered = false;
  let inList = false;
  let codeBuffer: string[] | null = null;
  let codeLang = "";

  const flushParagraph = (): void => {
    if (paragraph.length > 0) {
      blocks.push(`<p>${renderInline(paragraph.join(" "))}</p>`);
      paragraph = [];
    }
  };
  const flushList = (): void => {
    if (inList) {
      const tag = listOrdered ? "ol" : "ul";
      blocks.push(`<${tag}>${listItems.join("")}</${tag}>`);
      listItems = [];
      inList = false;
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";

    if (codeBuffer !== null) {
      if (/^```\s*$/.test(line)) {
        blocks.push(
          `<pre><code${codeLang ? ` class="language-${codeLang}"` : ""}>${codeBuffer.join("\n")}</code></pre>`,
        );
        codeBuffer = null;
        codeLang = "";
      } else {
        codeBuffer.push(line);
      }
      continue;
    }
    const fence = line.match(/^```\s*([\w+-]*)\s*$/);
    if (fence) {
      flushParagraph();
      flushList();
      codeBuffer = [];
      codeLang = fence[1] ?? "";
      continue;
    }

    const fnDef = line.match(/^\[\^([A-Za-z0-9_-]+)\]:\s?(.*)$/);
    if (fnDef) {
      flushParagraph();
      flushList();
      footnotes.push({ id: fnDef[1] ?? "", text: fnDef[2] ?? "" });
      continue;
    }

    if (line.trim() === "") {
      flushParagraph();
      flushList();
      continue;
    }

    // GFM-ish pipe table: this line looks like a row AND the next line is a valid separator.
    const next = lines[i + 1];
    if (line.includes("|") && next !== undefined && isTableSeparatorLine(next)) {
      flushParagraph();
      flushList();
      const headerCells = splitTableRow(line);
      const aligns = splitTableRow(next).map(tableCellAlign);
      const headerHtml = headerCells
        .map((cell, cellIndex) => `<th${aligns[cellIndex] ?? ""}>${renderInline(cell)}</th>`)
        .join("");
      const bodyRows: string[] = [];
      let cursor = i + 2;
      while (cursor < lines.length) {
        const rowLine = lines[cursor];
        if (rowLine === undefined || rowLine.trim() === "" || !rowLine.includes("|")) break;
        const cells = splitTableRow(rowLine);
        bodyRows.push(
          `<tr>${cells.map((cell, cellIndex) => `<td${aligns[cellIndex] ?? ""}>${renderInline(cell)}</td>`).join("")}</tr>`,
        );
        cursor++;
      }
      blocks.push(
        `<table><thead><tr>${headerHtml}</tr></thead><tbody>${bodyRows.join("")}</tbody></table>`,
      );
      i = cursor - 1;
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      flushParagraph();
      flushList();
      const level = (heading[1] ?? "#").length;
      blocks.push(`<h${level}>${renderInline((heading[2] ?? "").trim())}</h${level}>`);
      continue;
    }

    if (/^(-{3,}|\*{3,}|_{3,})$/.test(line.trim())) {
      flushParagraph();
      flushList();
      blocks.push("<hr />");
      continue;
    }

    const quote = line.match(/^>\s?(.*)$/);
    if (quote) {
      flushParagraph();
      flushList();
      blocks.push(`<blockquote><p>${renderInline(quote[1] ?? "")}</p></blockquote>`);
      continue;
    }

    const ul = line.match(/^[-*+]\s+(.*)$/);
    if (ul) {
      flushParagraph();
      if (inList && listOrdered) flushList();
      inList = true;
      listOrdered = false;
      listItems.push(`<li>${renderInline(ul[1] ?? "")}</li>`);
      continue;
    }
    const ol = line.match(/^\d+\.\s+(.*)$/);
    if (ol) {
      flushParagraph();
      if (inList && !listOrdered) flushList();
      inList = true;
      listOrdered = true;
      listItems.push(`<li>${renderInline(ol[1] ?? "")}</li>`);
      continue;
    }

    flushList();
    paragraph.push(line.trim());
  }
  flushParagraph();
  flushList();
  if (codeBuffer !== null) {
    // An unterminated fence — flush what was collected rather than silently dropping it.
    blocks.push(`<pre><code>${(codeBuffer as string[]).join("\n")}</code></pre>`);
  }

  let footnotesHtml = "";
  if (footnotes.length > 0) {
    const items = footnotes
      .map(
        ({ id, text }) =>
          `<li id="fn-${id}">${renderInline(text)} <a href="#fnref-${id}">↩</a></li>`,
      )
      .join("");
    footnotesHtml = `<section class="footnotes"><hr /><ol>${items}</ol></section>`;
  }

  return { bodyHtml: blocks.join("\n"), footnotesHtml };
}

function tryPrettyJson(content: string): string {
  try {
    return JSON.stringify(JSON.parse(content), null, 2);
  } catch {
    return content;
  }
}

/** `title` → a filesystem/URL-safe slug for export filenames; falls back to `"artifact"` for a title
 *  that slugs down to nothing (e.g. all punctuation). */
function artifactSlug(artifact: HubArtifact): string {
  const slug = artifact.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "artifact";
}

function artifactExportBaseName(artifact: HubArtifact, version: HubArtifactVersion): string {
  return `${artifactSlug(artifact)}-v${version.version}`;
}

/** The kind-aware body rendered to HTML — everything except the document shell (used by both the plain
 *  `format=html` export and the self-contained `share.html`, so the two can never visually diverge). */
function renderArtifactBody(
  artifact: HubArtifact,
  version: HubArtifactVersion,
): { bodyHtml: string; footnotesHtml: string } {
  if (artifact.kind === "code") {
    return {
      bodyHtml: `<pre><code>${escapeHtml(version.content)}</code></pre>`,
      footnotesHtml: "",
    };
  }
  if (artifact.kind === "json") {
    return {
      bodyHtml: `<pre><code class="language-json">${escapeHtml(tryPrettyJson(version.content))}</code></pre>`,
      footnotesHtml: "",
    };
  }
  if (artifact.kind === "html") {
    return {
      bodyHtml: `<div class="hub-artifact-html">${sanitizeHtmlFragment(version.content)}</div>`,
      footnotesHtml: "",
    };
  }
  return renderMarkdownToHtml(version.content); // markdown | table
}

/**
 * The full standalone HTML document — self-contained (one inlined `<style>`, no external `<link>`/
 * `<script>`/font/CDN reference, no network dependency) for BOTH `format=html` and `share.html`
 * (R-UX13's "styles inlined, no app or network dependency" is the whole point of `share.html`; there's
 * no reason for the plain `html` export to be any less self-contained, so both share this builder).
 * `share` only changes the meta line's wording, not the structure or styling.
 */
function buildArtifactHtmlDocument(
  artifact: HubArtifact,
  version: HubArtifactVersion,
  share: boolean,
): string {
  const { bodyHtml, footnotesHtml } = renderArtifactBody(artifact, version);
  const title = escapeHtml(artifact.title);
  const exportedAt = new Date().toISOString();
  const metaLine = `${artifact.kind} artifact · version ${version.version} of ${artifact.latestVersion}${
    share ? " · shared from MCP Token Footprint — Assistant Hub, for reading without the app" : ""
  } · exported ${exportedAt}`;
  return [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8" />',
    '<meta name="viewport" content="width=device-width, initial-scale=1" />',
    `<title>${title} — v${version.version}</title>`,
    `<style>${HUB_ARTIFACT_HTML_STYLE}</style>`,
    "</head>",
    "<body>",
    `<div class="hub-share-meta">${escapeHtml(metaLine)}</div>`,
    `<h1>${title}</h1>`,
    bodyHtml,
    footnotesHtml,
    "</body>",
    "</html>",
    "",
  ].join("\n");
}

/** `format=md`: `markdown`/`table`/`html`-kind content is returned as-is (already markdown, or raw HTML
 *  a Markdown document is allowed to embed verbatim); `code`/`json` are wrapped in a fenced block so the
 *  export is still a valid, readable Markdown document rather than bare unmarked text. */
function artifactMarkdownExport(artifact: HubArtifact, version: HubArtifactVersion): string {
  if (artifact.kind === "code") return `\`\`\`\n${version.content}\n\`\`\`\n`;
  if (artifact.kind === "json") return `\`\`\`json\n${tryPrettyJson(version.content)}\n\`\`\`\n`;
  return version.content;
}

type ArtifactExportPayload = { body: string; contentType: string; filename: string };

function buildArtifactExport(
  artifact: HubArtifact,
  version: HubArtifactVersion,
  format: HubArtifactExportFormat,
): ArtifactExportPayload {
  const base = artifactExportBaseName(artifact, version);
  if (format === "json") {
    return {
      body: JSON.stringify({ artifact, version }, null, 2),
      contentType: "application/json; charset=utf-8",
      filename: `${base}.json`,
    };
  }
  if (format === "md") {
    return {
      body: artifactMarkdownExport(artifact, version),
      contentType: "text/markdown; charset=utf-8",
      filename: `${base}.md`,
    };
  }
  return {
    body: buildArtifactHtmlDocument(artifact, version, false),
    contentType: "text/html; charset=utf-8",
    filename: `${base}.html`,
  };
}

/** Resolves the version an export/share request targets: an explicit `?version=` (404 if that version
 *  doesn't exist), or the artifact's current version, or — the belt-and-braces fallback for the
 *  structurally-impossible case where `current_version_id` is somehow unset — its highest version. */
function resolveArtifactVersion(
  repository: HubRepository,
  artifact: HubArtifact,
  requested: number | undefined,
): HubArtifactVersion {
  if (requested !== undefined) {
    const versions = repository.listArtifactVersions(artifact.id);
    const found = versions.find((v) => v.version === requested);
    if (!found) throw httpError(404, `Artifact version ${requested} not found`);
    return found;
  }
  if (artifact.currentVersionId) return repository.getArtifactVersion(artifact.currentVersionId);
  const versions = repository.listArtifactVersions(artifact.id);
  const latest = versions.at(-1);
  if (!latest) throw httpError(404, "This artifact has no versions");
  return latest;
}

// ── Local (non-shared) request schemas — see the module doc for why these aren't in packages/shared ──

// WP1.4 (D-HUX4, P4) — `topLevelOnly` (the Sessions table excludes mission-agent children) mirrors
// `hubAgentListQuerySchema`'s own `"true"|"false"` literal-transform pattern. `includeArchived` stays
// TRI-STATE (present "true"/"false", or ABSENT) — see `HubRepository.listSessions`'s doc for why: this
// route is the ONE `GET /api/hub/sessions` every caller shares (the AssistantView switcher, `usage.ts`/
// `audit.ts` rollups via the repository directly), and only the Sessions table passes this param at all.
const hubSessionListQuerySchema = z.object({
  project: z.string().trim().min(1).optional(),
  kind: hubSessionKindSchema.optional(),
  topLevelOnly: z
    .union([z.literal("true"), z.literal("false")])
    .optional()
    .transform((value) => value === "true"),
  includeArchived: z.union([z.literal("true"), z.literal("false")]).optional(),
});

function parseHubSessionListQuery(query: unknown): {
  projectId?: string;
  kind?: HubSessionKind;
  topLevelOnly?: boolean;
  includeArchived?: boolean;
} {
  const parsed = hubSessionListQuerySchema.parse(query ?? {});
  return {
    ...(parsed.project ? { projectId: parsed.project } : {}),
    ...(parsed.kind ? { kind: parsed.kind } : {}),
    ...(parsed.topLevelOnly ? { topLevelOnly: true } : {}),
    ...(parsed.includeArchived !== undefined
      ? { includeArchived: parsed.includeArchived === "true" }
      : {}),
  };
}

const hubBranchInputSchema = z
  .object({
    /** Cut the copied history off at this `seq` (inclusive); omitted = copy the full history so far. */
    atSeq: z.number().int().nonnegative().optional(),
    /** The new session's title; defaults to `"<source title> (branch)"`. */
    label: z.string().trim().min(1).max(200).optional(),
  })
  .strict();

/** Event types copied by `POST .../branch` (v1 scope — see the module doc). */
const BRANCHABLE_EVENT_TYPES = new Set<HubEvent["type"]>([
  "user_message",
  "queued_user_message",
  "assistant_message",
  "reasoning",
  "tool_call",
  "tool_result",
]);

// Artifacts (WP1.6, §1.4) — local request schemas. `packages/shared` carries the WIRE shapes
// (`HubArtifact`/`HubArtifactVersion`/`hubArtifactKindSchema`/`hubArtifactExportFormatSchema`) but not a
// create/update REQUEST body — mirrors `hubBranchInputSchema` above: this is a request-only shape, not
// something any consumer reads back off the wire, so it stays local rather than growing `shared`.

const hubArtifactListQuerySchema = z.object({
  session: z.string().trim().min(1).optional(),
  project: z.string().trim().min(1).optional(),
});

const hubArtifactCreateBodySchema = z
  .object({
    sessionId: z.string().trim().min(1).optional(),
    projectId: z.string().trim().min(1).optional(),
    kind: hubArtifactKindSchema,
    title: z.string().trim().min(1).max(HUB_ARTIFACT_TITLE_MAX_LENGTH),
    content: z.string(),
    note: z.string().trim().min(1).optional(),
  })
  .strict();

const hubArtifactVersionBodySchema = z
  .object({
    content: z.string(),
    note: z.string().trim().min(1).optional(),
  })
  .strict();

const hubArtifactExportQuerySchema = z.object({
  format: hubArtifactExportFormatSchema,
  version: z.coerce.number().int().positive().optional(),
});

const hubArtifactShareQuerySchema = z.object({
  version: z.coerce.number().int().positive().optional(),
});

// Memory (WP3.2, §1.4 / D-AH11) — local request schemas. `packages/shared` already carries the full
// wire contract from WP0.1/WP0.2 (`HubMemory`/`hubMemoryInputSchema`/`hubMemoryPatchSchema`) — these
// two are request-only shapes (list filters; the accept-flow's session hint), mirroring the artifact
// local schemas above.
//
// `scope`/`scopeId` (WP2.4, D-HUX11) — additive list filters exposing `HubRepository.listMemory`'s
// scope filtering (already used internally by `memory-resolver.ts`'s per-layer resolver) on the
// public route, so a crew/agent/project profile's read-only Memory section can ask for exactly its
// own scope's rows instead of fetching everything and filtering client-side. An omitted `scope` still
// returns every scope (unchanged default — existing callers are unaffected).
const hubMemoryListQuerySchema = z.object({
  status: hubMemoryStatusSchema.optional(),
  kind: hubMemoryKindSchema.optional(),
  scope: hubMemoryScopeSchema.optional(),
  scopeId: z.string().trim().min(1).optional(),
});

/** `?sessionId=` on `PATCH .../memory/:id` (optional — see `registerHubMemoryRoutes`'s doc): the
 *  ConversationPane passes the session the proposal chip is showing in so a proposed→active accept can
 *  append the discrete `memory_saved` event (§1.3) to THAT session's log; the standalone Memory panel
 *  omits it (an edit/accept/archive made there still fully persists, it just has no session log). */
const hubMemoryAcceptQuerySchema = z.object({
  sessionId: z.string().trim().min(1).optional(),
});

// WP3.4 (D-AH12, R-SES6, R-MCP9) — local request schemas (mirrors the artifact block above: these are
// REQUEST-only shapes, never read back off the wire, so they stay local rather than growing `shared`).

const hubFileUploadQuerySchema = z.object({
  sessionId: z.string().trim().min(1).optional(),
  projectId: z.string().trim().min(1).optional(),
  role: hubFileLinkRoleSchema.optional(),
});

const hubWorkspacePathQuerySchema = z.object({ path: z.string().optional() });

const hubWorkspacePromoteBodySchema = z
  .object({
    path: z.string().trim().min(1),
    title: z.string().trim().min(1).max(HUB_ARTIFACT_TITLE_MAX_LENGTH).optional(),
  })
  .strict();

const hubFilePromoteBodySchema = z
  .object({ title: z.string().trim().min(1).max(HUB_ARTIFACT_TITLE_MAX_LENGTH).optional() })
  .strict();

const hubSnapshotCreateBodySchema = z
  .object({ label: z.string().trim().min(1).max(200).optional() })
  .strict();

const hubResourceCatalogQuerySchema = z.object({ server: z.string().trim().min(1) });

// Audit (WP4.2, §1.4 / D-AH13) — local request schema (mirrors the memory/file blocks above): the
// WIRE response shape (`HubAuditEntry`/`HubAuditPage`/`hubAuditKindSchema`) lives in `packages/shared`;
// this list-query filter is request-only, so it stays local.
const hubAuditQuerySchema = z.object({
  sessionId: z.string().trim().min(1).optional(),
  kind: hubAuditKindSchema.optional(),
  tool: z.string().trim().min(1).optional(),
  since: z.string().trim().min(1).optional(),
  until: z.string().trim().min(1).optional(),
  limit: z.coerce.number().int().positive().optional(),
  before: z.string().trim().min(1).optional(),
});

// Reviews (WP3.5, D-AH12, D-AH7) — local request schemas (mirrors the artifact block above): the WIRE
// shapes (`HubReview`/`HubReviewComment`/`hubReviewStatusSchema`) live in `packages/shared`; these
// REQUEST bodies never cross to a second consumer, so they stay local. `hubReviewCommentProposalSchema`/
// `hubReviewCommentsProposalSchema` live above (next to `createDefaultReviewAgentRunner`) for the same
// reason — they're a `generateObject` SCHEMA the model fills in, never a shape the browser reads back.

const hubReviewRequestBodySchema = z
  .object({
    /** The base version to review; defaults to the artifact's current/latest version. */
    version: z.number().int().positive().optional(),
    /** An existing role-library entry (D-AH7) to run as the critic — supplies systemPrompt/target/
     *  expectedOutcome/budgets/defaultModel. Omit to use the built-in default critic persona (then
     *  `model` is required). */
    roleId: z.string().trim().min(1).optional(),
    /** Overrides the role's `defaultModel` (or supplies one when no `roleId` is given). */
    model: z.string().trim().min(1).optional(),
    /**
     * model-identity WP6.1 (F9) — the credential owning {@link model} (D-MI1). Without it a free-text
     * `model` could NEVER name a credential, so a critic run with no `roleId` was structurally
     * incapable of using the subscription: the resolver only ever saw a bare model id and fell to the
     * name heuristic. The schema is `.strict()`, so this had to be added, not merely sent.
     *
     * Kept route-local (mirrored by `HubReviewRequestInput` in `apps/web/src/lib/api.ts`) to match the
     * standing convention for these request-only bodies — see the block comment above.
     */
    providerCredentialId: z.string().trim().min(1).optional(),
  })
  .strict();

const HUB_REVIEW_DECISION_VALUES = ["accepted", "rejected"] as const;

const hubReviewPatchBodySchema = z
  .object({
    status: hubReviewStatusSchema.optional(),
    decision: z
      .object({
        commentId: z.string().trim().min(1),
        decision: z.enum(HUB_REVIEW_DECISION_VALUES),
      })
      .strict()
      .optional(),
  })
  .strict()
  .refine((body) => body.status !== undefined || body.decision !== undefined, {
    message: "Provide `status` and/or `decision`.",
  });

const hubArtifactVersionRevertParamsSchema = z.object({
  id: z.string(),
  version: z.coerce.number().int().positive(),
});

// ── Route registration ──────────────────────────────────────────────────────────────────────────────

export type HubRouteDeps = {
  repository: HubRepository;
  sessionService: HubSessionService;
  providers: ProviderRepository;
  /** WP1.7 — the mission orchestrator (propose → approve → run → synthesize). Optional so the routes
   *  layer degrades gracefully if a build wires the hub without missions (the routes simply aren't
   *  mounted); index.ts always supplies it. */
  missionService?: HubMissionService;
  /** WP2.4 — the Skills registry reader the session-skills routes resolve attachments against
   *  (the SAME `SkillRepository` instance `hub/session-service.ts`'s `skillCatalogProvider` uses).
   *  Optional so existing route tests that don't exercise skills keep working unchanged; absent →
   *  `GET/PUT .../skills` still work, but every attachment resolves to `[]` (nothing to show). */
  skillReader?: HubSkillReader;
  /** WP2.4 — `HUB_SKILL_LISTING_BUDGET_FRACTION`/`HUB_SKILL_ENTRY_MAX_CHARS`; default 0.01/1536 when
   *  absent (mirrors `config/env.ts`'s own defaults). */
  skillListingBudgetFraction?: number;
  skillEntryMaxChars?: number;
  /** WP2.4 — the counter the listing measures against (the SAME instance `hub/session-service.ts`
   *  uses, `getTokenCounter(config.defaultTokenProfile)`) — default profile when absent. */
  tokenCounter?: TokenCounter;
  /** WP3.4 — the `/data` volume root (`config.dataDirectory`), needed to resolve a session's workspace
   *  root (`hub/workspace.ts`). Optional so existing route tests that don't exercise the workspace
   *  surface keep working unchanged; absent → the workspace tree/snapshot routes simply aren't mounted
   *  (mirrors the `missionService` precedent above), never a 500. */
  dataDir?: string;
  /** WP3.4 (R-MCP9) — the scan repository (server catalogs) + scan service (live `resources/read` +
   *  measurement) the resource-attachment picker resolves against. Both optional together; absent →
   *  the resource-attachment routes simply aren't mounted (same precedent). index.ts always supplies
   *  the SAME `scans`/`scanService` instances the MVP scan feature already constructs. */
  scans?: ScanRepository;
  scanService?: ScanService;
  /** WP3.4 (D-AH12) — the upload size cap (`hub/files/caps.ts`); defaults to
   *  {@link DEFAULT_HUB_FILE_CAPS} when absent. */
  fileCaps?: HubFileCaps;
  /** WP3.5 — the critic model-call DI seam (D-AH12, D-AH7); defaults to
   *  {@link createDefaultReviewAgentRunner} (built from `providers` above — no separate `index.ts`
   *  wiring needed) when absent. Tests inject a deterministic stub. */
  reviewAgentRunner?: HubReviewAgentRunner;
  /** WP4.1 (R-SES7) — the registered-server catalog the context inspector's `tools` layer snapshots
   *  (the SAME `ServerRepository` instance the MVP scan feature + `index.ts`'s `resolveHubMcpGrants`
   *  use). Paired with `scans` (already optional above) — either absent ⇒ the inspector's `tools`
   *  layer reports built-ins only (never fabricated). */
  servers?: ServerRepository;
  /** WP4.1 — `HUB_TOOL_LOADING_DEFAULT`/`HUB_TOOL_SEARCH_AUTO_FRACTION`, the SAME config the turn
   *  engine resolves tool loading with (`HubSessionServiceConfig.toolLoadingDefault`/`autoFraction`) —
   *  defaults mirror `config/env.ts`'s own ("deferred" / 0.1) when absent. */
  toolLoadingDefault?: HubToolLoadingPreference;
  toolSearchAutoFraction?: number;
  /** WP4.1 — mirrors `HubSessionServiceConfig.projectContextMaxChars`; default 8000 when absent (the
   *  SAME {@link HUB_DEFAULT_PROJECT_CONTEXT_MAX_CHARS} the turn engine falls back to). */
  projectContextMaxChars?: number;
  /** WP4.3 (R-SES9/R-UX11) — the notification-center hook. Fired for `waiting_input` (a `phase` event
   *  entering the wait, from `.../messages`' turn) and `session_budget_trip` (a settled turn whose
   *  `stopReasonCode` tripped a budget meter, also from `.../messages`); `mission_terminal` is fired
   *  from `hub/missions/routes.ts`'s `/approve`, threaded the SAME instance below. Absent ⇒ no
   *  notification — every pre-WP4.3 caller/test keeps working unchanged (the established "honest
   *  not-yet-actionable" degrade this file already uses throughout). */
  notify?: HubNotifySink;
  /** hub-fixes WP1.3 (RC3.4) — force-evict a server's cached hub MCP session (`index.ts`'s
   *  `hubMcpSessions` pool), so the next turn opens a fresh connection instead of reusing a broken/
   *  stale one. Absent ⇒ `POST /api/hub/servers/:id/reconnect` isn't mounted (the same "absent optional
   *  dep ⇒ route absent" precedent every other optional dep above already follows). */
  evictHubMcpSession?: (serverId: string) => Promise<void> | void;
};

export async function registerHubRoutes(app: FastifyInstance, deps: HubRouteDeps): Promise<void> {
  const channels = new HubChannelRegistry();
  registerHubProjectRoutes(app, deps.repository);
  registerHubSessionRoutes(app, deps, channels);
  registerHubSessionSkillRoutes(app, deps);
  registerHubArtifactRoutes(app, deps.repository, channels);
  // WP2.1 — the role library + saved crews (D-AH7), plain CRUD (no session/SSE involvement).
  registerHubAgentRoutes(app, deps.repository, deps.providers);
  registerHubCrewRoutes(app, deps.repository, deps.providers);
  // WP3.2 — the memory store (D-AH11a): CRUD + the propose→explicit-save accept flow.
  registerHubMemoryRoutes(app, deps.repository, channels);
  // WP3.5 — artifact review (D-AH12): critic-run create, list/get, per-comment decide (→ a new
  // immutable version on accept), and the version-revert undo (R-UX7). Always mounted (DB-only reads/
  // decisions never touch a model; only the critic-run POST self-gates on `assertHubProviderConfigured`).
  registerHubReviewRoutes(app, deps, channels);
  // WP1.7 — missions (propose/edit/approve/stop + agent-stop), fanned out over the parent SSE channel.
  if (deps.missionService) {
    // hub-fixes WP2.2 (RC2.4) — give the mission EDIT route the parent session's grantable-server
    // catalog so it can strip grants to unknown/unreachable servers loudly. Built from the SAME
    // `servers`/`scans` repos (scope-aware) the context inspector's `tools` layer reads; absent both ⇒
    // the dep is omitted and the edit route degrades to the pre-WP2.2 pass-through.
    const mcpCatalogServers = deps.servers;
    const mcpCatalogScans = deps.scans;
    registerHubMissionRoutes(
      app,
      {
        repository: deps.repository,
        missionService: deps.missionService,
        assertConfigured: () => assertHubProviderConfigured(deps.providers),
        // model-identity WP6.1 (F7/F8, D-MI9) — the SAME validator the session + agent + crew routes
        // use, so a pin the composer sends on propose, or one an operator types into a plan edit, is a
        // 409 here rather than a silently-persisted value that 500s at spawn time.
        assertPinUsable: (providerCredentialId, modelId) => {
          resolveExplicitHubCredential(deps.providers, providerCredentialId, modelId);
        },
        // mission-planner-guard (2026-07-27) — the planner turn is a `generateObject` call, so it needs
        // an AI-SDK `buildModel`; a `claude_subscription` resolution has none by design (see this
        // module's `createHubModelResolver` doc). Resolved through the SAME production resolver every
        // other hub model call uses, so "can this model run here?" is answered once, consistently.
        // Message shape mirrors `createDefaultReviewAgentRunner`'s sibling refusal above.
        assertPlannerModelUsable: (modelId, providerCredentialId) => {
          const resolution = createHubModelResolver(deps.providers, app.log)(
            modelId,
            providerCredentialId,
          ) as HubModelResolution;
          if (!resolution.buildModel) {
            throw httpError(
              400,
              `Model "${modelId}" cannot plan a mission (no AI-SDK model builder — e.g. a subscription ` +
                "model). Pick an API-keyed model for this session, or send this message with one.",
            );
          }
        },
        ...(deps.notify ? { notify: deps.notify } : {}),
        ...(mcpCatalogServers && mcpCatalogScans
          ? {
              mcpServerCatalog: async (session: HubSession) => {
                const { catalog } = await buildHubContextMcpCatalogProvider(
                  mcpCatalogServers,
                  mcpCatalogScans,
                  session.toolScope ?? null,
                )();
                return buildPlannerServerCatalog(catalog);
              },
            }
          : {}),
      },
      channels,
    );
  }
  // WP2.3 — live HITL decision routes + autonomy dial + mission-agent steering.
  registerHubHitlRoutes(app, deps, channels);
  // WP3.4 — uploads/promote (always mounted — DB-only), workspace tree/snapshots (needs `dataDir`),
  // MCP resource attachment (needs `scans`/`scanService`).
  await registerHubFileRoutes(app, deps);
  if (deps.dataDir) {
    registerHubWorkspaceRoutes(app, deps, deps.dataDir);
  }
  if (deps.scans && deps.scanService) {
    registerHubResourceRoutes(app, deps.repository, deps.scans, deps.scanService);
  }
  // WP4.1 (R-UX6/R-UX8/R-SES7) — usage rollups (always mounted, DB-only) + the per-session context
  // inspector (its `tools` layer needs `servers`+`scans`; absent → built-ins-only, never a 500).
  registerHubUsageRoutes(app, deps);
  registerHubContextRoutes(app, deps);
  // WP4.2 — the global, filterable Audit timeline (D-AH13). Always mounted (DB-only reads).
  registerHubAuditRoutes(app, deps.repository);
  // hub-fixes WP1.3 (RC3.4) — the rail's Retry action (needs `evictHubMcpSession`; absent → not mounted).
  registerHubMcpReconnectRoute(app, deps);
}

// ── hub-fixes WP1.3 (RC3.4) — MCP reconnect ─────────────────────────────────────────────────────────

/**
 * `POST /api/hub/servers/:id/reconnect` — evict `id`'s cached hub MCP session (`index.ts`'s
 * `HubResourcePool`), best-effort closing whatever it resolved to, so the session's NEXT turn opens a
 * fresh connection instead of reusing a broken/stale one. Deliberately does NOT re-open the connection
 * synchronously here (that would block the request on a potentially-slow/interactive OAuth reopen, and
 * duplicate `resolveHubMcpGrants`'s own turn-time logic) — "next turn reopens" is the documented
 * contract (WP-1.3 spec). Idempotent: evicting a serverId with nothing cached is a harmless no-op, so
 * this never needs to validate the id against the server registry.
 */
function registerHubMcpReconnectRoute(app: FastifyInstance, deps: HubRouteDeps): void {
  if (!deps.evictHubMcpSession) return;
  const evict = deps.evictHubMcpSession;
  app.post("/api/hub/servers/:id/reconnect", async (request, reply) => {
    const { id } = request.params as { id: string };
    await evict(id);
    return reply.code(202).send({ ok: true });
  });
}

// ── WP4.1 usage ──────────────────────────────────────────────────────────────────────────────────────
//
// `GET /api/hub/usage` — spend/token rollups (R-UX8's "rollups in Usage") + the mission list + the
// R-UX6 plan-acceptance metric. Query params are optional and unvalidated beyond trimming (a bad
// `from`/`to` simply matches nothing — no 400 needed for a read-only filter). `GET .../context` is the
// per-session context inspector (R-SES7, "the flagship dogfood surface") — see `hub/context-inspector.ts`
// for the shape's reasoning; its `tools` layer needs a REAL granted-MCP-catalog snapshot, built here
// (not in `context-inspector.ts`, which stays DB/MCP-agnostic) from `deps.servers`/`deps.scans` — the
// SAME two repositories `index.ts`'s `resolveHubMcpGrants` reads, minus the live-session half (this
// route only MEASURES tool definitions, it never opens an MCP connection or calls a tool).

const hubUsageQuerySchema = z
  .object({
    from: z.string().trim().min(1).optional(),
    to: z.string().trim().min(1).optional(),
    projectId: z.string().trim().min(1).optional(),
  })
  .strict();

// WP1.6 (D-HUX10) — the workforce Usage tab's group-by rollup query: `groupBy` is required (the caller
// always picks one dimension), `from`/`to`/`projectId` are the SAME optional read-only filters as
// `GET /api/hub/usage` above.
const hubUsageRollupQuerySchema = z
  .object({
    groupBy: hubUsageGroupBySchema,
    from: z.string().trim().min(1).optional(),
    to: z.string().trim().min(1).optional(),
    projectId: z.string().trim().min(1).optional(),
  })
  .strict();

// WP1.6 (D-HUX10) — a per-entity usage summary query: `groupBy` + the entity `id` are required; `days`
// (default 30 in `usage.ts`) sizes the trailing daily strip — bounded [1, 90] so a card sparkline can't
// be abused into an unbounded scan.
const hubUsageSummaryQuerySchema = z
  .object({
    groupBy: hubUsageGroupBySchema,
    id: z.string().trim().min(1),
    days: z.coerce.number().int().min(1).max(90).optional(),
  })
  .strict();

function registerHubUsageRoutes(app: FastifyInstance, deps: HubRouteDeps): void {
  app.get("/api/hub/usage", async (request): Promise<HubUsageAggregates> => {
    const query = hubUsageQuerySchema.parse(request.query ?? {});
    // model-identity WP3.3 (D-MI10) — attribute by the session's PERSISTED credential; the model-name
    // heuristic serves NULL (pre-v55) rows only. See `usage.ts`'s attribution banner.
    return buildHubUsageAggregates(
      deps.repository,
      query,
      createHubUsageProviderResolver(deps.providers, inferHubModelKind),
    );
  });

  app.get("/api/hub/usage/rollup", async (request): Promise<HubUsageRow[]> => {
    const { groupBy, ...query } = hubUsageRollupQuerySchema.parse(request.query ?? {});
    return buildHubUsageRollup(deps.repository, groupBy, query);
  });

  app.get("/api/hub/usage/summary", async (request): Promise<HubUsageSummary> => {
    const { groupBy, id, days } = hubUsageSummaryQuerySchema.parse(request.query ?? {});
    return buildHubUsageSummary(deps.repository, groupBy, id, { days });
  });
}

/** Builds the context inspector's `mcpCatalogProvider` for ONE request: applies `scope` — the
 *  session's `toolScope` — exactly like `index.ts`'s `resolveHubMcpGrants` does (hub-fixes WP1.2,
 *  RC3.1): `scope` present ("scoped") ⇒ only its listed servers, each narrowed to its own
 *  `HubServerToolGrant` allowlist; `scope` `null` ("auto", the pre-WP1.2 default) ⇒ every registered
 *  server with a latest scan, granted "all". Mirrors `index.ts`'s catalog construction, deliberately
 *  WITHOUT its live-session half (nothing here calls `openSession` — a definition snapshot for
 *  measurement needs no live connection). */
function buildHubContextMcpCatalogProvider(
  servers: ServerRepository,
  scans: ScanRepository,
  scope: HubToolGrants | null,
): HubContextMcpCatalogProvider {
  return async () => {
    const catalog = new Map<string, HubMcpServerCatalog>();
    const grantServers: Record<string, HubServerToolGrant> = {};
    for (const summary of servers.list()) {
      const grant: HubServerToolGrant | undefined = scope ? scope.servers[summary.id] : "all";
      if (grant === undefined) continue; // scoped-out server (auto always yields "all")
      const defs = scans.getLatestForServer(summary.id)?.tools ?? [];
      if (defs.length === 0) continue; // never scanned / no tools → nothing to grant
      catalog.set(summary.id, {
        serverName: summary.name,
        tools: defs.map(
          (t): NormalizedToolDefinition => ({
            name: t.toolName,
            ...(t.description !== undefined ? { description: t.description } : {}),
            ...(t.inputSchema !== undefined ? { inputSchema: t.inputSchema } : {}),
            ...(t.annotations !== undefined ? { annotations: t.annotations } : {}),
            raw: t.rawTool,
          }),
        ),
      });
      grantServers[summary.id] = grant;
    }
    // hub-fixes WP1.2 (RC3.5) — honor the scope's builtins selection here too, mirroring `index.ts`'s
    // `resolveHubMcpGrants`: an absent scope OR an explicit empty list both fall back to the full
    // default set (an empty `builtins: []` must never brick a session down to zero built-ins).
    const builtins =
      scope && scope.builtins.length > 0 ? scope.builtins : DEFAULT_CHAT_BUILTIN_NAMES;
    return {
      grants: { servers: grantServers, builtins },
      catalog,
    };
  };
}

/** hub-fixes WP1.3 (RC3.4) — the LATEST `mcp_server_status` per server, folded from the session's
 *  persisted event log ("last one wins" per serverId, in event order — dedup already happened at
 *  emission time, `HubSessionService` only appends when the status actually changed). Read here (not
 *  `context-inspector.ts`, which stays event-log-status agnostic) — mirrors the `scopeMode` post-process
 *  right below. Empty when the session has never had a status event (a pre-WP1.3 session, or one that
 *  hasn't dispatched a turn with MCP grants yet). */
function latestHubMcpServerStatuses(events: readonly HubEvent[]): HubMcpServerStatusEntry[] {
  const byServer = new Map<string, HubMcpServerStatusEntry>();
  for (const event of events) {
    if (event.type !== "mcp_server_status") continue;
    byServer.set(event.serverId, {
      serverId: event.serverId,
      serverName: event.serverName,
      status: event.status,
      ...(event.message !== undefined ? { message: event.message } : {}),
      ...(event.authRequired ? { authRequired: true } : {}),
    });
  }
  return [...byServer.values()];
}

/** Reconstruct the still-open agent-initiated questions from the append-only event log: every `question`
 *  with no later `question_resolved` of the same id. Mirrors how `HubSteeringQueue.reconstructPending`
 *  derives live state purely from replay — the SSE stream is the primary recovery path, this is the
 *  additive convenience for a non-streaming `GET`. */
function reconstructOpenHubQuestions(events: readonly HubEvent[]): HubOpenQuestion[] {
  const open = new Map<string, HubOpenQuestion>();
  for (const event of events) {
    if (event.type === "question") {
      open.set(event.questionId, {
        questionId: event.questionId,
        prompt: event.prompt,
        ...(event.options && event.options.length > 0 ? { options: event.options } : {}),
        ...(event.allowOther !== undefined ? { allowOther: event.allowOther } : {}),
      });
    } else if (event.type === "question_resolved") {
      open.delete(event.questionId);
    }
  }
  return [...open.values()];
}

function registerHubContextRoutes(app: FastifyInstance, deps: HubRouteDeps): void {
  const tokenCounter = deps.tokenCounter ?? getTokenCounter(DEFAULT_TOKEN_PROFILE);

  app.get("/api/hub/sessions/:id/context", async (request): Promise<HubSessionContextPayload> => {
    const { id } = request.params as { id: string };
    // hub-fixes WP1.2 (RC3) — the session's scope varies per request, so the catalog provider is
    // built HERE (not once at route-registration time like before WP1.2) from its `toolScope`. This
    // also 404s up front for an unknown session, exactly like `buildHubContextInspector`'s own
    // internal `repository.getSession` would (same error, called again there — a cheap, harmless
    // duplicate read, not a second source of truth).
    const session = deps.repository.getSession(id);
    const scope = session.toolScope ?? null;
    const mcpCatalogProvider =
      deps.servers && deps.scans
        ? buildHubContextMcpCatalogProvider(deps.servers, deps.scans, scope)
        : undefined;
    const result = await buildHubContextInspector(
      {
        repository: deps.repository,
        tokenCounter,
        skillReader: deps.skillReader,
        skillListingBudgetFraction: deps.skillListingBudgetFraction ?? 0.01,
        skillEntryMaxChars: deps.skillEntryMaxChars ?? 1536,
        toolLoadingDefault: deps.toolLoadingDefault ?? "deferred",
        toolSearchAutoFraction: deps.toolSearchAutoFraction ?? 0.1,
        ...(deps.projectContextMaxChars !== undefined
          ? { projectContextMaxChars: deps.projectContextMaxChars }
          : {}),
        ...(mcpCatalogProvider ? { mcpCatalogProvider } : {}),
      },
      id,
    );
    // The payload says whether this snapshot is "scoped" or "auto" (RC3's display half) — computed
    // here (not in `context-inspector.ts`, which stays session/scope-agnostic; it only consumes
    // whatever `mcpCatalogProvider` hands it). hub-fixes WP1.3 (RC3.4) adds `serverStatuses` alongside
    // it, the SAME cheap-duplicate-read pattern (a second `listEvents` call, not a second source of
    // truth) — the rail's per-server chip data.
    const serverStatuses = latestHubMcpServerStatuses(deps.repository.listEvents(id));
    return {
      ...result,
      tools: {
        ...result.tools,
        scopeMode: scope ? "scoped" : "auto",
        ...(serverStatuses.length > 0 ? { serverStatuses } : {}),
      },
    };
  });
}

// ── WP4.2 audit (planning/Roadmap/RM-03-assistant-hub/, §1.4 / D-AH13, R-UX7) ─────────────────────────────────────
//
// One route: `GET /api/hub/audit` — a filterable (session/kind/tool/time), paginated (limit/before)
// window over `hub/audit.ts`'s `listHubAudit` projection. Read-only; the projection itself documents
// the correlation/deep-link/scale contract — this function is intentionally thin.
function registerHubAuditRoutes(app: FastifyInstance, repository: HubRepository): void {
  app.get("/api/hub/audit", async (request) => {
    const query = hubAuditQuerySchema.parse(request.query ?? {});
    if (query.sessionId) repository.getSession(query.sessionId); // 404 on an unknown session filter
    return listHubAudit(repository, query);
  });
}

// ── WP2.3 autonomy/HITL ─────────────────────────────────────────────────────────────────────────────
//
// The live human-in-the-loop surface (the owner-folded GAP-A/GAP-B seam) — appended additively, touching
// no earlier block. Four routes:
//   POST  /api/hub/sessions/:id/approvals    — decide a pending approval-gated tool call (R-MCP3/R-UX1)
//   POST  /api/hub/sessions/:id/elicitation  — respond to a pending MCP elicitation (R-MCP4)
//   PATCH /api/hub/sessions/:id/autonomy      — set the session's autonomy dial (D-AH6)
//   POST  /api/hub/missions/:id/agents/:agentSessionId/steer — steer a running mission agent (R-SES3/R-UX4)
//
// The approval/elicitation resolutions unblock a turn that is PAUSED in its tool wrapper / elicitation
// responder (turn-engine.ts): the wrapper resumes, executes-or-denies, and the settled `tool_result` /
// `elicitation_responded` (+ `approval_responded`) events flow back over the session's existing SSE
// stream — no new transport. A 409 means nothing is pending for that id (the decision arrived after the
// turn already resolved it, e.g. a Stop, or a duplicate click). The autonomy PATCH is a plain
// client-writable field write (the generic session PATCH also accepts `autonomy`; this dedicated route
// is the dial UI's focused seam). Steering is fanned out on the CHILD agent session's channel.
function registerHubHitlRoutes(
  app: FastifyInstance,
  deps: HubRouteDeps,
  channels: HubChannelRegistry,
): void {
  const { repository, sessionService, missionService } = deps;

  // Decide a pending approval-gated tool call (R-MCP3 / R-UX1).
  app.post("/api/hub/sessions/:id/approvals", async (request, reply) => {
    const { id } = request.params as { id: string };
    repository.getSession(id); // 404 if unknown
    const { toolCallId, resolution } = hubApprovalDecisionInputSchema.parse(request.body);
    const applied = sessionService.decideApproval(id, toolCallId, resolution);
    if (!applied) {
      throw httpError(
        409,
        "No approval is pending for that tool call (it may have already resolved).",
      );
    }
    return reply.code(202).send({ ok: true });
  });

  // Respond to a pending MCP elicitation (R-MCP4). `accept` requires flat-primitive `content`.
  app.post("/api/hub/sessions/:id/elicitation", async (request, reply) => {
    const { id } = request.params as { id: string };
    repository.getSession(id); // 404 if unknown
    const { elicitationId, action, content } = hubElicitationResponseInputSchema.parse(
      request.body,
    );
    const applied = sessionService.respondElicitation(id, elicitationId, {
      action,
      ...(content ? { content } : {}),
    });
    if (!applied) {
      throw httpError(409, "No elicitation is pending for that id (it may have already resolved).");
    }
    return reply.code(202).send({ ok: true });
  });

  // Answer a pending agent-initiated `ask_user` question. Unblocks the paused tool, which emits
  // `question_resolved` over the session's existing SSE (no new transport).
  app.post("/api/hub/sessions/:id/answers", async (request, reply) => {
    const { id } = request.params as { id: string };
    repository.getSession(id); // 404 if unknown
    const { questionId, answer } = hubAnswerRequestSchema.parse(request.body);
    const applied = sessionService.answerQuestion(id, questionId, answer);
    if (!applied) {
      throw httpError(409, "No question is pending for that id (it may have already resolved).");
    }
    return reply.code(202).send({ ok: true });
  });

  // Persist a per-message generative-UI client-state snapshot (WP2.6, R-GUI5). A client-side interaction
  // (filter/toggle/field edit) that must NOT re-enter the model but MUST replay-rehydrate is written as
  // the closed-union `ui_state` event (source "user") and forwarded live so other viewers of the session
  // see the same widget state. Deliberately additive: a to-ASSISTANT action (Form submit / send Button)
  // is a normal `POST .../messages` with a dual-audience text, NOT this route.
  app.post("/api/hub/sessions/:id/ui-state", async (request, reply) => {
    const { id } = request.params as { id: string };
    repository.getSession(id); // 404 if unknown
    const { messageId, key, state } = hubUiStateInputSchema.parse(request.body);
    const settled = repository.appendEvent(id, {
      type: "ui_state",
      messageId,
      ...(key ? { key } : {}),
      state,
      source: "user",
      specVersion: HUB_GENUI_SPEC_VERSION,
    });
    channels.sinkFor(id).onEvent(settled);
    return reply.code(202).send({ ok: true });
  });

  // Set the session's autonomy dial (D-AH6) — the dial UI's focused write.
  app.patch("/api/hub/sessions/:id/autonomy", async (request) => {
    const { id } = request.params as { id: string };
    const { autonomy } = hubAutonomyPatchSchema.parse(request.body);
    return repository.updateSession(id, { autonomy }); // 404 if unknown
  });

  // Steer a running mission agent — inject a durable steering message into its child session (R-SES3).
  app.post("/api/hub/missions/:id/agents/:agentSessionId/steer", async (request, reply) => {
    if (!missionService) throw httpError(404, "Missions are not enabled.");
    const { id, agentSessionId } = request.params as { id: string; agentSessionId: string };
    const { text } = hubAgentSteerInputSchema.parse(request.body);
    const event = missionService.steerAgent(id, agentSessionId, text);
    channels.sinkFor(agentSessionId).onEvent(event); // fan out on the CHILD session's own channel
    return reply.code(202).send({ ok: true });
  });
}

// ── WP3.1 projects ──────────────────────────────────────────────────────────────────────────────
// Project CRUD (list/create/patch/delete) was scaffolded in WP0.2; this WP adds `GET .../:id` (the
// new Projects view's editor pane wants a direct lookup, mirroring `registerHubAgentRoutes`'s own
// `GET .../:id` note) and the project's PINNED FILES surface — small, user-typed/pasted TEXT
// snippets pinned to a project that every member session inherits via the LAYER 6b prompt injection
// (`prompting/layers/project.ts`, populated by `hub/turn-engine.ts`) and that the web project-
// settings view + per-session context panel both read. This is DELIBERATELY narrower than the
// general upload surface WP3.4 owns (`Files POST /api/hub/files …`, execution-plan §1.4) — no
// binary upload, no multipart — but reuses the SAME WP0.2 `hub_files`/`hub_file_links` tables
// (role `"pinned"`, targetKind `"project"`) that already carry that general shape, so WP3.4's own
// generic surface can read these same rows later without a migration.
function registerHubProjectRoutes(app: FastifyInstance, repository: HubRepository): void {
  app.get("/api/hub/projects", async () => repository.listProjects());

  app.post("/api/hub/projects", async (request, reply) => {
    const input = hubProjectInputSchema.parse(request.body);
    const project = repository.createProject(input);
    return reply.code(201).send(project);
  });

  app.get("/api/hub/projects/:id", async (request) => {
    const { id } = request.params as { id: string };
    return repository.getProject(id); // 404 if unknown
  });

  app.patch("/api/hub/projects/:id", async (request) => {
    const { id } = request.params as { id: string };
    const patch = hubProjectPatchSchema.parse(request.body);
    return repository.updateProject(id, patch);
  });

  app.delete("/api/hub/projects/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    repository.deleteProject(id); // 404 if unknown
    return reply.code(204).send();
  });

  // Pinned files — metadata-only listing (content is fetched per-file, mirroring `HubFile`'s own
  // "content is fetched via GET, not on the wire object" contract).
  app.get("/api/hub/projects/:id/files", async (request) => {
    const { id } = request.params as { id: string };
    repository.getProject(id); // 404 if unknown
    return listProjectPinnedFiles(repository, id).map(({ file }) => file);
  });

  app.post("/api/hub/projects/:id/files", async (request, reply) => {
    const { id } = request.params as { id: string };
    repository.getProject(id); // 404 if unknown
    const input = hubProjectPinnedFileInputSchema.parse(request.body);
    const content = Buffer.from(input.content, "utf8");
    const sha256 = createHash("sha256").update(content).digest("hex");
    const file = repository.createFile({
      sha256,
      mime: "text/plain",
      filename: input.filename,
      content,
    });
    repository.linkFile({ fileId: file.id, role: "pinned", targetKind: "project", targetId: id });
    return reply.code(201).send(file);
  });

  app.get("/api/hub/projects/:id/files/:fileId", async (request) => {
    const { id, fileId } = request.params as { id: string; fileId: string };
    assertPinnedProjectFile(repository, id, fileId);
    const file = repository.getFile(fileId);
    const content = repository.getFileContent(fileId).toString("utf8");
    return { ...file, content };
  });

  app.delete("/api/hub/projects/:id/files/:fileId", async (request, reply) => {
    const { id, fileId } = request.params as { id: string; fileId: string };
    assertPinnedProjectFile(repository, id, fileId);
    repository.deleteFile(fileId); // cascades the hub_file_links row (ON DELETE CASCADE)
    return reply.code(204).send();
  });
}

/** Every `"pinned"` file linked to a project, oldest-first (link creation order). Mirrors the tiny
 *  filter `hub/turn-engine.ts`'s OWN project-context assembly does directly over `HubRepository`
 *  (turn-engine stays independent of this HTTP-layer module — see that module's doc note). */
function listProjectPinnedFiles(
  repository: HubRepository,
  projectId: string,
): { file: HubFile; linkId: string }[] {
  return repository
    .listFileLinksForTarget("project", projectId)
    .filter((link) => link.role === "pinned")
    .map((link) => ({ file: repository.getFile(link.fileId), linkId: link.id }));
}

/** 404s unless `fileId` is actually a `"pinned"` file linked to `projectId` — guards the per-file
 *  GET/DELETE routes against a file id that belongs to a different project (or isn't pinned at all,
 *  once WP3.4's general upload surface can attach `"upload"`-role files to a project too). */
function assertPinnedProjectFile(
  repository: HubRepository,
  projectId: string,
  fileId: string,
): void {
  repository.getProject(projectId); // 404 if the project itself doesn't exist
  const pinned = repository
    .listFileLinksForTarget("project", projectId)
    .some((link) => link.role === "pinned" && link.fileId === fileId);
  if (!pinned) throw httpError(404, "Hub file not found");
}

function registerHubSessionRoutes(
  app: FastifyInstance,
  deps: HubRouteDeps,
  channels: HubChannelRegistry,
): void {
  const { repository, sessionService, providers } = deps;

  app.get("/api/hub/sessions", async (request) => {
    const filter = parseHubSessionListQuery(request.query);
    return repository.listSessions(filter);
  });

  app.post("/api/hub/sessions", async (request, reply) => {
    assertHubProviderConfigured(providers);
    const input = hubSessionCreateInputSchema.parse(request.body);
    const session = await sessionService.createSession(input);
    return reply.code(201).send(session);
  });

  // Replay: the session row + its full settled event log (R-SES1) + its mission, if it started one.
  app.get("/api/hub/sessions/:id", async (request): Promise<HubSessionDetail> => {
    const { id } = request.params as { id: string };
    const session = repository.getSession(id); // 404 if unknown
    const events = repository.listEvents(id);
    const mission = repository.getMissionBySession(id);
    const openQuestions = reconstructOpenHubQuestions(events);
    return {
      session,
      events,
      ...(mission ? { mission } : {}),
      ...(openQuestions.length > 0 ? { openQuestions } : {}),
    };
  });

  // Full session-log export — the complete ordered `hub_events` transcript (every input and output in
  // sequence), rendered as downloadable JSON or Markdown. Backs the Context rail's "Export session"
  // dropdown; the JSON carries the raw event log verbatim, the Markdown a human-readable rendering.
  app.get("/api/hub/sessions/:id/report/json", async (request, reply) => {
    const { id } = request.params as { id: string };
    const session = repository.getSession(id); // 404 if unknown
    const events = repository.listEvents(id);
    reply.header("content-type", "application/json; charset=utf-8");
    reply.header("content-disposition", `attachment; filename="hub-session-${id}.json"`);
    return buildHubSessionJsonReport(session, events, new Date().toISOString());
  });

  app.get("/api/hub/sessions/:id/report/markdown", async (request, reply) => {
    const { id } = request.params as { id: string };
    const session = repository.getSession(id); // 404 if unknown
    const events = repository.listEvents(id);
    reply.header("content-type", "text/markdown; charset=utf-8");
    reply.header("content-disposition", `attachment; filename="hub-session-${id}.md"`);
    return buildHubSessionMarkdownReport(session, events, new Date().toISOString());
  });

  // Client-writable fields only (title/model/autonomy/toolScope/mode — hub-fixes WP1.2 added
  // toolScope [RC3's write-once-trap fix], WP6.2 adds mode [RC7's composer-clarity fix]) — lifecycle
  // fields are engine-owned.
  app.patch("/api/hub/sessions/:id", async (request) => {
    const { id } = request.params as { id: string };
    const patch = hubSessionPatchSchema.parse(request.body);
    if (patch.mode !== undefined) {
      const current = repository.getSession(id); // 404 if unknown
      // hub-fixes WP6.2 (RC7) — mission<->auto is the one mode swap that can race a LIVE mission: the
      // orchestrator reads `session.mode` at several points (the auto-routing gate, mode-addenda
      // selection for the session's NEXT turn), and a mission is anchored to its session by
      // `hub_missions.session_id` (not the other way — `HubSession.missionId` is only ever set on an
      // agent CHILD), so flipping the field mid-mission would desync the two. Every other mode swap
      // (auto<->chat<->research) is unconditional; `mission` is never an offered SWITCH TARGET from the
      // composer's mode chip in the first place (entering it keeps its existing create-time/crew
      // semantics — see `Composer.tsx`'s `SessionModeChip`), so in practice this guard only ever fires
      // for the `mission` -> `auto` "step down" once a mission ends (or a defensive `auto` -> `mission`
      // flip, refused the same way).
      const isMissionAutoSwap =
        (current.mode === "mission" && patch.mode === "auto") ||
        (current.mode === "auto" && patch.mode === "mission");
      if (isMissionAutoSwap) {
        const mission = repository.getMissionBySession(id);
        if (mission && !isTerminalMissionStatus(mission.status)) {
          throw httpError(
            409,
            "This session's mission is still running — stop or wait for it to finish before switching mode.",
          );
        }
      }
    }
    // model-identity WP2.2 (D-MI9) — a RE-PIN gets the SAME refusal the resolver applies, before the
    // write. `updateSession` persists `provider_credential_id` straight through with no resolver call, so
    // without this an unknown id died on the foreign key (a 500 — the create-path defect again) and a
    // NON-ELIGIBLE or AUTH-BROKEN id was written with no error at all, deferring the failure to the next
    // turn. That silent accept is the worse half: it is exactly the mis-routing this workstream closes,
    // and README §1's blast-radius row 2 ("Session model patch … Re-pinning is impossible") is why the
    // field exists on this schema at all.
    //
    // The three-way convention is preserved exactly: ABSENT ⇒ the pin is unchanged and nothing is
    // validated (a title-only patch must not become a credential check); `null` ⇒ a deliberate UNPIN back
    // to the heuristic (D-MI1), which is a legitimate value and must never 409; an id ⇒ validated. The
    // model passed is the POST-patch one (a patch may move `model`, the pin, or both), so the refusal
    // message names what the session will actually be rather than a stale row. The reused validator is
    // the whole point — a second copy here would be the next thing to drift.
    if (patch.providerCredentialId !== undefined && patch.providerCredentialId !== null) {
      const current = repository.getSession(id); // 404 if unknown
      resolveExplicitHubCredential(
        providers,
        patch.providerCredentialId,
        patch.model ?? current.model,
      );
    }
    // hub-fixes (Defect 1a) — after a scope or roster edit, keep the roster's server grants reachable so a
    // server-bound role scoped into the session never silently loses its MCP server. Effective scope/roster
    // = the patched value when present, else the current session's.
    if (patch.toolScope !== undefined || patch.roster !== undefined) {
      const current = repository.getSession(id); // 404 if unknown
      const nextScope = patch.toolScope !== undefined ? patch.toolScope : current.toolScope;
      const nextRoster = patch.roster !== undefined ? patch.roster : current.roster;
      const unioned = unionRosterServersIntoScope(repository, nextScope, nextRoster);
      if (unioned && unioned !== nextScope) patch.toolScope = unioned;
    }
    return repository.updateSession(id, patch); // 404 if unknown
  });

  app.delete("/api/hub/sessions/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    repository.getSession(id); // 404 if unknown
    sessionService.stop(id); // best-effort: abort any live turn before the row disappears
    repository.deleteSession(id);
    channels.closeAll(id); // end any open SSE stream cleanly (mirrors the Assistant dock's delete)
    return reply.code(204).send();
  });

  // Fire-and-forget dispatch (mirrors POST /api/runs — see the module doc for why this can't be
  // `HubSessionService.dispatchMessage`'s full turn awaited here). 409 while no provider is configured;
  // 404 if the session id is unknown (checked synchronously, before the async kickoff).
  //
  // model-identity WP4.4 — the 202 is unchanged, and so is this `.catch`; what changed is what reaches
  // it. A MODEL-RESOLUTION refusal (the WP2.2/D-MI9 409 on an unusable per-message `providerCredentialId`
  // — exactly what WP4.3's "retry on the other auth source" action sends) no longer rejects into this
  // log-and-drop: `dispatchMessage` now settles it as `error` + `turn_done` over the live sink and
  // resolves `{ kind: "failed" }`, so the operator sees the refusal instead of a 202 followed by nothing.
  // The `.catch` remains the backstop for everything that still throws after kickoff (the active-session
  // cap 409, an unexpected engine fault).
  app.post("/api/hub/sessions/:id/messages", async (request, reply) => {
    const { id } = request.params as { id: string };
    assertHubProviderConfigured(providers);
    const input = hubSendMessageInputSchema.parse(request.body);
    repository.getSession(id); // 404 if unknown

    // WP4.3 (R-SES9/R-UX11) — wrap the sink to catch the turn entering `waiting_input` (an approval/
    // elicitation/question wait); `notify` absent ⇒ a plain passthrough, zero behavior change for every
    // pre-WP4.3 caller (see `wrapSinkForWaitingInputNotify`'s own doc).
    const sink = wrapSinkForWaitingInputNotify(channels.sinkFor(id), id, deps.notify);
    void sessionService
      .dispatchMessage(id, input, sink)
      .then((outcome) => {
        if (outcome.kind === "ran" && isBudgetTripStopReason(outcome.result.stopReasonCode)) {
          deps.notify?.({
            kind: "session_budget_trip",
            sessionId: id,
            stopReasonCode: outcome.result.stopReasonCode,
          });
        }
      })
      .catch((error) => {
        request.log.warn({ err: error, sessionId: id }, "hub dispatchMessage failed after kickoff");
      });

    return reply.code(202).send({ sessionId: id, streamUrl: `/api/hub/sessions/${id}/stream` });
  });

  app.get("/api/hub/sessions/:id/stream", async (request, reply) => {
    const { id } = request.params as { id: string };
    repository.getSession(id); // 404 BEFORE hijacking the socket
    return streamHubSession(request, reply, repository, channels, id);
  });

  app.post("/api/hub/sessions/:id/stop", async (request, reply) => {
    const { id } = request.params as { id: string };
    repository.getSession(id); // 404 if unknown
    sessionService.stop(id); // idempotent no-op when nothing is running
    return reply.code(202).send({ ok: true });
  });

  // Unified Sessions "End session" (D-US2), scoped to what's SAFE here: the turn engine has no external
  // verdict-override hook (it always resolves its OWN terminal via `terminalFor` once aborted), so
  // ending a session with a turn CURRENTLY running would race the engine's own eventual write — refused
  // with a 409 telling the caller to Stop first. Ending an already-idle/pending session is race-free.
  //
  // NOTE: unlike a Testing run, `hub_sessions.status` is a PER-TURN disposition, not a whole-session
  // terminal — `runHubTurn` sets it to `completed`/`stopped`/`error`/`aborted` after EVERY turn (the
  // session stays perfectly usable for the next message; `dispatchMessage` never gates on `status`). So
  // the idempotency guard here checks specifically for `status === "ended"` (this route's OWN prior
  // write), not the broader `isTerminalStatus` set testing/run-manager.ts uses for its one-shot runs —
  // that would wrongly refuse to end a session whose last turn merely `completed`/`aborted`/etc.
  app.post("/api/hub/sessions/:id/end", async (request, reply) => {
    const { id } = request.params as { id: string };
    const session = repository.getSession(id); // 404 if unknown
    if (session.status === "ended") {
      throw httpError(409, "This session has already ended.");
    }
    if (sessionService.isRunning(id)) {
      throw httpError(409, "Stop the running turn before ending this session.");
    }
    const verdict = terminalFor("session_ended");
    const updated = repository.setSessionLifecycle(id, {
      status: verdict.status,
      phase: null,
      stopReasonCode: verdict.stopReasonCode,
      endedAt: new Date().toISOString(),
    });
    channels.closeAll(id); // an ended session closes any open stream (mirrors delete)
    return reply.code(200).send(updated);
  });

  app.post("/api/hub/sessions/:id/seen", async (request, reply) => {
    const { id } = request.params as { id: string };
    repository.getSession(id); // 404 if unknown
    repository.markSeen(id);
    return reply.code(202).send({ ok: true });
  });

  // Fork the conversation into a new session (v1 scope — see the module doc + BRANCHABLE_EVENT_TYPES).
  app.post("/api/hub/sessions/:id/branch", async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = hubBranchInputSchema.parse(request.body ?? {});
    const source = repository.getSession(id); // 404 if unknown
    const cutoff = body.atSeq;
    const kept = repository
      .listEvents(id)
      .filter((event) => BRANCHABLE_EVENT_TYPES.has(event.type))
      .filter((event) => cutoff === undefined || (event.seq ?? 0) <= cutoff);

    // Through `sessionService.createSession` (not a bare `repository.createSession`) so the branch gets
    // its capability manifest resolved + persisted immediately (D-US4) — the same as any session created
    // via `POST /api/hub/sessions`, rather than sitting with `capabilities: null` until its first message.
    const forked = await sessionService.createSession({
      mode: source.mode,
      model: source.model,
      // model-identity WP6.1 (F3) — carry the SOURCE's pin onto the fork. Omitting it made every branch
      // unpinned, and regenerate is `branchHubSession(...)` → `sendHubMessage(forked.id, {text, model})`:
      // with no pin on the fork and none on the message, a regenerated turn fell all the way back to the
      // NAME HEURISTIC (the metered key), not to the session pin as the ledger recorded. A branch is a
      // continuation of this conversation — it must run on the same credential, not re-guess one.
      // `source.providerCredentialId` is `null` on a legacy/unpinned session ⇒ omitted ⇒ heuristic, so
      // historical replay is unchanged. A credential deleted since is already NULL here (ON DELETE SET
      // NULL, D-MI2), so this can never resurrect a dead id into a D-MI9 409.
      ...(source.providerCredentialId ? { providerCredentialId: source.providerCredentialId } : {}),
      title: body.label ?? `${source.title} (branch)`,
      ...(source.projectId ? { projectId: source.projectId } : {}),
      ...(source.topology ? { topology: source.topology } : {}),
      ...(source.autonomy ? { autonomy: source.autonomy } : {}),
      ...(source.crewId ? { crewId: source.crewId } : {}),
    });
    for (const event of kept) {
      // Strip the envelope (`seq`/`at`) the source log stamped — `appendEvent` re-stamps both for the
      // new session's own log. Structurally this is a distributive Omit<HubEvent,"seq"|"at"> per
      // variant (HubEventInput's own doc), which a plain object-rest can't express to the type checker.
      const { seq: _seq, at: _at, ...rest } = event;
      repository.appendEvent(forked.id, rest as HubEventInput);
    }
    const branchEvent = repository.appendEvent(id, {
      type: "branch_created",
      branchSessionId: forked.id,
      fromSessionId: id,
      ...(cutoff !== undefined ? { fromSeq: cutoff } : {}),
      ...(body.label ? { label: body.label } : {}),
    });
    channels.sinkFor(id).onEvent(branchEvent);

    return reply.code(201).send(forked);
  });
}

// ── WP2.4 skills ─────────────────────────────────────────────────────────────────────────────────────
//
// Session-level skill attachment (R-SK1…R-SK3/R-SK5/R-SK8): read the resolved attachments + the CURRENT
// L1 listing (budget + per-entry state) + session-true usage (`GET`), or replace the attachment list
// wholesale (`PUT`, delete-then-reinsert — mirrors the Testing feature's scenario-skill upsert). Role-
// level attachment rides the existing agents CRUD (WP2.1's routes; `HubAgentRoleInput.skills` already
// carries the same `HubSkillAttachment` shape — no separate route needed here).
//
// `contextWindow` for the listing budget uses the SAME `MODEL_CONTEXT_LIMITS[session.model] ?? 0`
// lookup `createHubModelResolver` uses above — a session with an unknown model's context window simply
// gets budgetTokens=0 (every entry demotes to name-only immediately; an honest degrade, never a crash).
function registerHubSessionSkillRoutes(app: FastifyInstance, deps: HubRouteDeps): void {
  const { repository, skillReader } = deps;
  const listingBudgetFraction = deps.skillListingBudgetFraction ?? 0.01;
  const entryMaxChars = deps.skillEntryMaxChars ?? 1536;
  const tokenCounter = deps.tokenCounter ?? getTokenCounter(DEFAULT_TOKEN_PROFILE);

  async function buildSkillsView(id: string): Promise<HubSessionSkillsView> {
    const session = repository.getSession(id); // 404 if unknown
    const attachments = repository.listSessionSkills(id);
    const resolved = skillReader ? resolveHubSkillAttachments(skillReader, attachments) : [];
    const loaded = reconstructLoadedSkills(repository.listEvents(id));
    const contextWindow = MODEL_CONTEXT_LIMITS[session.model] ?? 0;
    const { listing } = await computeSkillListing(resolved, {
      tokenCounter,
      contextWindow,
      budgetFraction: listingBudgetFraction,
      entryMaxChars,
      invocationOrder: invocationOrderFromLoads(loaded),
    });
    const usage = computeSessionSkillUsage(resolved, listing, loaded);
    return { attachments: resolved, listing, usage };
  }

  app.get("/api/hub/sessions/:id/skills", async (request) => {
    const { id } = request.params as { id: string };
    return buildSkillsView(id);
  });

  app.put("/api/hub/sessions/:id/skills", async (request) => {
    const { id } = request.params as { id: string };
    repository.getSession(id); // 404 if unknown
    const input = hubSessionSkillsInputSchema.parse(request.body ?? []);
    repository.replaceSessionSkills(id, input);
    return buildSkillsView(id);
  });
}

// ── Artifacts (WP1.6, §1.4 / R-UX13) ────────────────────────────────────────────────────────────────
//
// List/create + versions + export. `POST .../artifacts` and `POST .../versions` are the DIRECT-UI-EDIT
// path (`authorKind: "user"`, always) — the MODEL's path is the `artifacts.create`/`artifacts.update`
// BUILT-INS from WP0.5 (`hub/tools/builtins/artifacts.ts`, `authorKind: "assistant"`), unchanged here.
// `GET .../export` covers `format=md|html|json`; `GET .../share` is the DISTINCT `share.html` action
// (never a fourth `format=` value — see `HUB_ARTIFACT_EXPORT_FORMATS`'s own doc in `packages/shared`).
//
// A session-scoped create/update also appends the discrete `artifact_created`/`artifact_updated` event
// (§1.3) to that session's log and forwards it live via `channels` — mirroring the built-ins' OWN event
// emission (`hub/tools/builtins/artifacts.ts`) so a session reconstructed purely from `hub_events`
// (R-SES1) sees a direct-UI edit exactly the same way it sees a model-driven one, regardless of which
// path produced it. A project-only (session-less) artifact has no session log to append to — skipped.
function registerHubArtifactRoutes(
  app: FastifyInstance,
  repository: HubRepository,
  channels: HubChannelRegistry,
): void {
  const emitSessionArtifactEvent = (
    sessionId: string | null | undefined,
    event: HubEventInput,
  ): void => {
    if (!sessionId) return;
    const settled = repository.appendEvent(sessionId, event);
    channels.sinkFor(sessionId).onEvent(settled);
  };

  app.get("/api/hub/artifacts", async (request) => {
    const query = hubArtifactListQuerySchema.parse(request.query ?? {});
    return repository.listArtifacts({
      ...(query.session ? { sessionId: query.session } : {}),
      ...(query.project ? { projectId: query.project } : {}),
    });
  });

  app.post("/api/hub/artifacts", async (request, reply) => {
    const input = hubArtifactCreateBodySchema.parse(request.body);
    const artifact = repository.createArtifact({
      ...(input.sessionId ? { sessionId: input.sessionId } : {}),
      ...(input.projectId ? { projectId: input.projectId } : {}),
      kind: input.kind,
      title: input.title,
      content: input.content,
      ...(input.note ? { note: input.note } : {}),
      authorKind: "user",
    });
    if (artifact.currentVersionId) {
      emitSessionArtifactEvent(artifact.sessionId, {
        type: "artifact_created",
        artifactId: artifact.id,
        kind: artifact.kind,
        title: artifact.title,
        versionId: artifact.currentVersionId,
        version: artifact.latestVersion,
      });
    }
    return reply.code(201).send(artifact);
  });

  app.get("/api/hub/artifacts/:id", async (request) => {
    const { id } = request.params as { id: string };
    return repository.getArtifact(id); // 404 if unknown
  });

  app.get("/api/hub/artifacts/:id/versions", async (request) => {
    const { id } = request.params as { id: string };
    repository.getArtifact(id); // 404 if unknown
    return repository.listArtifactVersions(id);
  });

  // The direct-UI-edit "update" route (§ WP1.6 owned surface note above): appends a new IMMUTABLE
  // version — mirrors `artifacts.update`'s built-in semantics exactly, just `authorKind: "user"`.
  app.post("/api/hub/artifacts/:id/versions", async (request, reply) => {
    const { id } = request.params as { id: string };
    const artifact = repository.getArtifact(id); // 404 if unknown
    const input = hubArtifactVersionBodySchema.parse(request.body);
    const version = repository.addArtifactVersion(id, {
      content: input.content,
      ...(input.note ? { note: input.note } : {}),
      authorKind: "user",
    });
    emitSessionArtifactEvent(artifact.sessionId, {
      type: "artifact_updated",
      artifactId: version.artifactId,
      versionId: version.id,
      version: version.version,
      ...(version.note ? { note: version.note } : {}),
    });
    return reply.code(201).send(version);
  });

  app.get("/api/hub/artifacts/:id/export", async (request, reply) => {
    const { id } = request.params as { id: string };
    const query = hubArtifactExportQuerySchema.parse(request.query ?? {});
    const artifact = repository.getArtifact(id); // 404 if unknown
    const version = resolveArtifactVersion(repository, artifact, query.version); // 404 on a bad ?version=
    const { body, contentType, filename } = buildArtifactExport(artifact, version, query.format);
    reply.header("content-type", contentType);
    reply.header("content-disposition", `attachment; filename="${filename}"`);
    return reply.send(body);
  });

  // The distinct, self-contained `share.html` one-click action (R-UX13): styles inlined, no app or
  // network dependency, version-pinned (the meta line names the exact version), citation footnotes
  // preserved (the markdown renderer's `[^n]`/`[^n]: …` handling) — always a forced download, since
  // that's the point (send this file to someone without the app).
  app.get("/api/hub/artifacts/:id/share", async (request, reply) => {
    const { id } = request.params as { id: string };
    const query = hubArtifactShareQuerySchema.parse(request.query ?? {});
    const artifact = repository.getArtifact(id); // 404 if unknown
    const version = resolveArtifactVersion(repository, artifact, query.version); // 404 on a bad ?version=
    const html = buildArtifactHtmlDocument(artifact, version, true);
    reply.header("content-type", "text/html; charset=utf-8");
    reply.header(
      "content-disposition",
      `attachment; filename="${artifactExportBaseName(artifact, version)}.share.html"`,
    );
    return reply.send(html);
  });
}

// ── WP3.4 files/workspace (planning/Roadmap/RM-03-assistant-hub/, §1.3/§1.4/§1.6, D-AH12, R-SES6, R-MCP7/9) ───────
//
// Three registration functions, one theme:
//   - `registerHubFileRoutes` — content-addressed uploads (`hub_files`/`hub_file_links`, WP0.2's
//     repository CRUD): upload, metadata, raw-bytes download, delete, a session's linked files, and
//     promote-to-artifact (an uploaded/produced file becomes a versioned `hub_artifacts` entry, WP1.6).
//     Always mounted — DB-only, no `dataDir`/scan dependency.
//   - `registerHubWorkspaceRoutes` — the session workspace FileTree (`hub/workspace.ts`'s confined
//     tree/read, WP0.5) + promote-to-artifact for a WORKSPACE file (e.g. something `files.write`
//     produced) + content-addressed snapshots (R-SES6) create/list/restore. Needs `dataDir` to resolve
//     a session's workspace root — mounted only when the caller supplies one (mirrors the
//     `missionService` optional-mount precedent above).
//   - `registerHubResourceRoutes` — MCP resource attachment (R-MCP9): a catalog over a granted
//     server's LATEST SCAN (`ScanRepository.getLatestForServer` — the "scanned" half of "scanned +
//     live"; a live `resources/list` picker is a follow-up, `McpSession` doesn't expose one yet),
//     attach (re-fetches + MEASURES the resource's actual content via the existing
//     `ScanService.readResource` — the same runtime playground mechanics R-MCP7 reuses — rather than
//     trusting a client-supplied token count), list the currently-attached set (event-sourced replay),
//     and remove. Needs `scans`+`scanService`. Attaching NEVER auto-injects the resource into the
//     model's context (R-MCP9 "auto-inclusion off by default") — see `hub/resources.ts`'s module doc.
//
// Confinement (path traversal / symlink escape / size caps) is `hub/workspace.ts` (WP0.5, reused
// unmodified here) + `hub/files/caps.ts` (new, WP3.4, mirrors the skills zip-bomb-guard PATTERN) —
// see those modules' own docs; this file only calls them, it does not re-implement the guards.

/** A single-upload multipart part read into memory (mirrors `skills/routes.ts`'s `readMultipart`, kept
 *  local rather than shared — the two upload flows have different validation/caps). */
async function readHubFileUpload(
  request: FastifyRequest,
): Promise<{ buffer: Buffer; filename?: string; mime: string }> {
  let buffer: Buffer | undefined;
  let filename: string | undefined;
  let mime = "application/octet-stream";
  for await (const part of request.parts()) {
    if (part.type === "file") {
      filename = part.filename || undefined;
      mime = part.mimetype || mime;
      try {
        buffer = await part.toBuffer();
      } catch (err) {
        throw httpError(400, `Upload exceeds the size limit: ${(err as Error).message}`);
      }
    }
  }
  if (!buffer || buffer.byteLength === 0) {
    throw httpError(400, "No file part found in the upload.");
  }
  return { buffer, filename, mime };
}

/** A text file's natural artifact kind by extension/MIME, or `undefined` when it isn't text at all —
 *  promote-to-artifact refuses a binary file rather than mangling it into a bogus text artifact. */
function inferArtifactKindFromFile(mime: string, filename?: string): HubArtifactKind | undefined {
  const ext = filename?.split(".").pop()?.toLowerCase();
  if (mime === "application/json" || ext === "json") return "json";
  if (mime === "text/html" || ext === "html" || ext === "htm") return "html";
  if (mime === "text/markdown" || ext === "md" || ext === "markdown") return "markdown";
  const textLike =
    mime.startsWith("text/") ||
    mime === "application/xml" ||
    mime === "application/x-yaml" ||
    mime.endsWith("+json") ||
    mime.endsWith("+xml");
  return textLike ? "code" : undefined;
}

async function registerHubFileRoutes(app: FastifyInstance, deps: HubRouteDeps): Promise<void> {
  const { repository } = deps;
  const caps = deps.fileCaps ?? DEFAULT_HUB_FILE_CAPS;

  // `@fastify/multipart` is `fastify-plugin`-wrapped (its decorators/content-type parser are hoisted
  // onto whatever instance `.register()` was called on, breaking the usual per-`.register()` isolation)
  // — registering it a SECOND time on the same instance throws a duplicate-decorator error. Production
  // (`index.ts`) mounts the Skills routes (which already register it) on the SAME root instance before
  // the hub; a standalone test harness that mounts ONLY hub routes has no such prior registration. This
  // guard makes both cases work without the hub depending on Skills' registration order.
  if (!app.hasContentTypeParser("multipart/form-data")) {
    await app.register(fastifyMultipart, { limits: { fileSize: caps.maxBytes, files: 1 } });
  }

  app.post("/api/hub/files", async (request, reply) => {
    if (!request.isMultipart()) {
      throw httpError(400, "Expected a multipart/form-data upload.");
    }
    const query = hubFileUploadQuerySchema.parse(request.query ?? {});
    if (query.sessionId) repository.getSession(query.sessionId); // 404 if unknown

    const { buffer, filename, mime } = await readHubFileUpload(request);
    assertHubUploadCap(buffer.byteLength, caps);

    const sha256 = crypto.createHash("sha256").update(buffer).digest("hex");
    const file = repository.createFile({
      sha256,
      mime,
      content: buffer,
      ...(filename ? { filename } : {}),
    });

    if (query.sessionId) {
      const role = query.role ?? "upload";
      repository.linkFile({
        fileId: file.id,
        role,
        targetKind: "session",
        targetId: query.sessionId,
      });
      repository.appendEvent(query.sessionId, {
        type: "file_uploaded",
        fileId: file.id,
        ...(file.filename ? { filename: file.filename } : {}),
        mime: file.mime,
        bytes: file.bytes,
        role,
      });
    } else if (query.projectId) {
      repository.linkFile({
        fileId: file.id,
        role: query.role ?? "pinned",
        targetKind: "project",
        targetId: query.projectId,
      });
    }

    return reply.code(201).send(file);
  });

  app.get("/api/hub/files/:id", async (request) => {
    const { id } = request.params as { id: string };
    return repository.getFile(id); // 404 if unknown
  });

  app.get("/api/hub/files/:id/content", async (request, reply) => {
    const { id } = request.params as { id: string };
    const file = repository.getFile(id); // 404 if unknown
    const content = repository.getFileContent(id);
    reply.header("content-type", file.mime || "application/octet-stream");
    reply.header(
      "content-disposition",
      `attachment; filename="${(file.filename ?? id).replace(/"/g, "")}"`,
    );
    return reply.send(content);
  });

  app.delete("/api/hub/files/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    repository.deleteFile(id); // 404 if unknown
    return reply.code(204).send();
  });

  app.get("/api/hub/sessions/:id/files", async (request) => {
    const { id } = request.params as { id: string };
    repository.getSession(id); // 404 if unknown
    return repository
      .listFileLinksForTarget("session", id)
      .map((link) => ({ link, file: repository.getFile(link.fileId) }));
  });

  // Promote an uploaded (or model-produced — role "produced") file to a first-class, versioned
  // artifact (WP1.6's canvas). Mirrors `registerHubArtifactRoutes`'s direct-UI-edit create path
  // (`authorKind: "user"`, an `artifact_created` event appended so it's visible on replay).
  app.post("/api/hub/sessions/:id/files/:fileId/promote", async (request, reply) => {
    const { id: sessionId, fileId } = request.params as { id: string; fileId: string };
    repository.getSession(sessionId); // 404 if unknown
    const file = repository.getFile(fileId); // 404 if unknown
    const input = hubFilePromoteBodySchema.parse(request.body ?? {});
    const kind = inferArtifactKindFromFile(file.mime, file.filename);
    if (!kind) {
      throw httpError(
        400,
        `"${file.filename ?? fileId}" (${file.mime}) isn't text — only text content can be promoted to an artifact.`,
      );
    }
    const content = repository.getFileContent(fileId).toString("utf8");
    const artifact = repository.createArtifact({
      sessionId,
      kind,
      title: input.title ?? file.filename ?? "Promoted file",
      content,
      note: `Promoted from uploaded file "${file.filename ?? fileId}"`,
      authorKind: "user",
    });
    if (artifact.currentVersionId) {
      repository.appendEvent(sessionId, {
        type: "artifact_created",
        artifactId: artifact.id,
        kind: artifact.kind,
        title: artifact.title,
        versionId: artifact.currentVersionId,
        version: artifact.latestVersion,
      });
    }
    return reply.code(201).send(artifact);
  });
}

function registerHubWorkspaceRoutes(
  app: FastifyInstance,
  deps: HubRouteDeps,
  dataDir: string,
): void {
  const { repository } = deps;
  const rootFor = (sessionId: string): string => {
    repository.getSession(sessionId); // 404 if unknown
    return ensureHubWorkspaceRoot(dataDir, sessionId);
  };

  app.get("/api/hub/sessions/:id/workspace/tree", async (request) => {
    const { id } = request.params as { id: string };
    const query = hubWorkspacePathQuerySchema.parse(request.query ?? {});
    return { entries: listWorkspaceTree(rootFor(id), query.path ?? "") };
  });

  app.get("/api/hub/sessions/:id/workspace/file", async (request) => {
    const { id } = request.params as { id: string };
    const query = hubWorkspacePathQuerySchema.parse(request.query ?? {});
    if (!query.path) throw httpError(400, "?path= is required.");
    return { path: query.path, content: readWorkspaceTextFile(rootFor(id), query.path) };
  });

  // Promote a WORKSPACE file (e.g. something `files.write`/`files.edit` produced — the
  // `ProducedAssetTree`'s "promote" action) to a versioned artifact. Mirrors the uploaded-file promote
  // route above; the only difference is the content source (workspace FS vs. `hub_files`).
  app.post("/api/hub/sessions/:id/workspace/promote", async (request, reply) => {
    const { id: sessionId } = request.params as { id: string };
    const root = rootFor(sessionId);
    const input = hubWorkspacePromoteBodySchema.parse(request.body ?? {});
    const kind = inferArtifactKindFromFile("text/plain", input.path); // workspace files are text-only (files.* built-ins never write binary)
    const content = readWorkspaceTextFile(root, input.path); // 404 if unknown
    const artifact = repository.createArtifact({
      sessionId,
      kind: kind ?? "code",
      title: input.title ?? input.path,
      content,
      note: `Promoted from workspace file "${input.path}"`,
      authorKind: "user",
    });
    if (artifact.currentVersionId) {
      repository.appendEvent(sessionId, {
        type: "artifact_created",
        artifactId: artifact.id,
        kind: artifact.kind,
        title: artifact.title,
        versionId: artifact.currentVersionId,
        version: artifact.latestVersion,
      });
    }
    return reply.code(201).send(artifact);
  });

  app.post("/api/hub/sessions/:id/workspace/snapshots", async (request, reply) => {
    const { id } = request.params as { id: string };
    const input = hubSnapshotCreateBodySchema.parse(request.body ?? {});
    const snapshot = createWorkspaceSnapshot(rootFor(id), input.label);
    return reply.code(201).send(snapshot);
  });

  app.get("/api/hub/sessions/:id/workspace/snapshots", async (request) => {
    const { id } = request.params as { id: string };
    return listWorkspaceSnapshots(rootFor(id));
  });

  app.post("/api/hub/sessions/:id/workspace/snapshots/:snapshotId/restore", async (request) => {
    const { id, snapshotId } = request.params as { id: string; snapshotId: string };
    return restoreWorkspaceSnapshot(rootFor(id), snapshotId); // 404 on an unknown snapshot id
  });
}

function registerHubResourceRoutes(
  app: FastifyInstance,
  repository: HubRepository,
  scans: ScanRepository,
  scanService: ScanService,
): void {
  app.get("/api/hub/resources/catalog", async (request) => {
    const { server: serverId } = hubResourceCatalogQuerySchema.parse(request.query ?? {});
    const scan = scans.getLatestForServer(serverId);
    if (!scan) return { serverId, serverName: undefined, resources: [] };
    return {
      serverId,
      serverName: scan.serverName,
      resources: scan.resources.map((resource) => {
        const annotations = extractResourceAnnotations(resource.rawResource);
        return {
          uri: resource.uri,
          kind: resource.kind,
          name: resource.name ?? resource.uri,
          ...(annotations.title ? { title: annotations.title } : {}),
          ...(resource.description ? { description: resource.description } : {}),
          ...(resource.mimeType ? { mimeType: resource.mimeType } : {}),
          ...(annotations.audience ? { audience: annotations.audience } : {}),
          ...(annotations.priority !== undefined ? { priority: annotations.priority } : {}),
          ...(annotations.lastModified ? { lastModified: annotations.lastModified } : {}),
          definitionTokens: resource.totalTokens,
        };
      }),
    };
  });

  app.post("/api/hub/sessions/:id/resources", async (request, reply) => {
    const { id: sessionId } = request.params as { id: string };
    repository.getSession(sessionId); // 404 if unknown
    const input = hubResourceAttachInputSchema.parse(request.body);

    const scan = scans.getLatestForServer(input.serverId);
    const descriptor = scan?.resources.find((r) => r.uri === input.uri);
    if (!scan || !descriptor) {
      throw httpError(404, `No scanned resource "${input.uri}" on server "${input.serverId}".`);
    }
    const annotations = extractResourceAnnotations(descriptor.rawResource);

    // Re-fetch + MEASURE the resource's actual content (the playground mechanics R-MCP7 reuses) rather
    // than trusting the scan's definition-only footprint — a "metered context item" per R-MCP9.
    const read = await scanService.readResource(input.serverId, input.uri);
    if (read.isError) {
      throw httpError(502, read.errorMessage ?? `Failed to read resource "${input.uri}".`);
    }

    const event = repository.appendEvent(sessionId, {
      type: "resource_attached",
      id: `res-${crypto.randomUUID()}`,
      serverId: input.serverId,
      serverName: scan.serverName,
      uri: input.uri,
      name: descriptor.name ?? input.uri,
      ...(annotations.title ? { title: annotations.title } : {}),
      ...(descriptor.description ? { description: descriptor.description } : {}),
      ...(descriptor.mimeType ? { mimeType: descriptor.mimeType } : {}),
      ...(annotations.audience ? { audience: annotations.audience } : {}),
      ...(annotations.priority !== undefined ? { priority: annotations.priority } : {}),
      ...(annotations.lastModified ? { lastModified: annotations.lastModified } : {}),
      tokens: read.responseTokens,
    });
    if (event.type !== "resource_attached") throw new Error("unreachable"); // narrows for the response below
    return reply.code(201).send({
      id: event.id,
      serverId: event.serverId,
      ...(event.serverName ? { serverName: event.serverName } : {}),
      uri: event.uri,
      name: event.name,
      ...(event.title ? { title: event.title } : {}),
      ...(event.description ? { description: event.description } : {}),
      ...(event.mimeType ? { mimeType: event.mimeType } : {}),
      ...(event.audience ? { audience: event.audience } : {}),
      ...(event.priority !== undefined ? { priority: event.priority } : {}),
      ...(event.lastModified ? { lastModified: event.lastModified } : {}),
      ...(event.tokens !== undefined ? { tokens: event.tokens } : {}),
      attachedAt: event.at ?? new Date().toISOString(),
    });
  });

  app.get("/api/hub/sessions/:id/resources", async (request) => {
    const { id } = request.params as { id: string };
    repository.getSession(id); // 404 if unknown
    return reconstructAttachedResources(repository.listEvents(id));
  });

  app.delete("/api/hub/sessions/:id/resources/:resourceId", async (request, reply) => {
    const { id: sessionId, resourceId } = request.params as { id: string; resourceId: string };
    repository.getSession(sessionId); // 404 if unknown
    const attached = reconstructAttachedResources(repository.listEvents(sessionId));
    if (!attached.some((r) => r.id === resourceId)) {
      throw httpError(404, `No attached resource "${resourceId}" on this session.`);
    }
    repository.appendEvent(sessionId, { type: "resource_removed", id: resourceId });
    return reply.code(204).send();
  });
}

// ── WP2.1 agents/crews (planning/Roadmap/RM-03-assistant-hub/, §1.4 / D-AH7) ──────────────────────────────────────
//
// The role library (`hub_agents`) and saved crews (`hub_crews`) are plain CRUD resources — no session/
// SSE/turn-engine involvement (a role/crew is a reusable DEFINITION the planner and the web Agents view
// read from, not something that runs on its own). WP0.2's `HubRepository` already owns the full
// persistence + `HubAgentRole`/`HubCrew` construction (`createAgentRole`/`listAgentRoles`/
// `updateAgentRole`/`deleteAgentRole`, `createCrew`/`listCrews`/`updateCrew`/`deleteCrew`) and WP0.1
// already carries the wire contract (`hubAgentRoleInputSchema`/`hubAgentRolePatchSchema`/
// `hubCrewInputSchema`/`hubCrewPatchSchema`) — this block is pure route plumbing over both, mirroring
// `registerHubProjectRoutes`'s shape (list/create/patch/delete) plus one addition: a plain
// `GET .../:id` (the Agents view's editor pane uses it so a direct role/crew id lookup doesn't depend
// on the list already being loaded — `registerHubProjectRoutes` skips one because the web project
// picker never deep-links a single project).
//
// Archival (`HubAgentRole.archivedAt`, D-AH7 "curated, user-editable role library") is a PATCH
// `{ archived: true|false }`, not a separate route. `hub_crews` has no archive column — saved crews
// are delete-only (`HubCrew` itself carries no `archivedAt`), so `registerHubCrewRoutes` only ever
// hard-deletes.

const hubAgentListQuerySchema = z.object({
  includeArchived: z
    .union([z.literal("true"), z.literal("false")])
    .optional()
    .transform((value) => value === "true"),
});

// model-identity WP2.2 (D-MI9) — `providers` is threaded in for exactly one reason: a saved role can pin
// a credential too (`hub_agents.provider_credential_id`, added by WP2.1's migration v55 so that README §1
// blast-radius row 9 — "Saved agent default model … An agent cannot be bound to the subscription" — can be
// closed), and `createAgentRole`/`updateAgentRole` write that column with no resolver call. So the role
// library had the SAME two failure modes the session routes did: an unknown id died on the foreign key
// (a 500) and a non-eligible / auth-broken id was persisted silently, surfacing only when a mission
// eventually tried to run the agent. The guard below is the SAME `resolveExplicitHubCredential` — one
// validator, one error vocabulary, three surfaces.
function registerHubAgentRoutes(
  app: FastifyInstance,
  repository: HubRepository,
  providers: ProviderRepository,
): void {
  app.get("/api/hub/agents", async (request) => {
    const { includeArchived } = hubAgentListQuerySchema.parse(request.query ?? {});
    return repository.listAgentRoles({ includeArchived });
  });

  app.post("/api/hub/agents", async (request, reply) => {
    const input = hubAgentRoleInputSchema.parse(request.body);
    // The role's model field is `defaultModel`, not `model` (the role shape does NOT mirror the session's
    // — checked, not assumed). On CREATE the field is `.optional()` but not nullable, so there is no
    // `null` case to exempt here; `undefined` simply means unpinned.
    if (input.providerCredentialId !== undefined) {
      resolveExplicitHubCredential(providers, input.providerCredentialId, input.defaultModel);
    }
    const role = repository.createAgentRole(input);
    return reply.code(201).send(role);
  });

  app.get("/api/hub/agents/:id", async (request) => {
    const { id } = request.params as { id: string };
    return repository.getAgentRole(id); // 404 if unknown
  });

  app.patch("/api/hub/agents/:id", async (request) => {
    const { id } = request.params as { id: string };
    const patch = hubAgentRolePatchSchema.parse(request.body);
    // Same three-way convention as the session PATCH: ABSENT ⇒ pin unchanged and nothing validated (a
    // rename must not become a credential check); `null` ⇒ a deliberate unpin, never a 409; an id ⇒
    // validated against the POST-patch model (`patch.defaultModel ?? current.defaultModel`).
    if (patch.providerCredentialId !== undefined && patch.providerCredentialId !== null) {
      const current = repository.getAgentRole(id); // 404 if unknown
      resolveExplicitHubCredential(
        providers,
        patch.providerCredentialId,
        patch.defaultModel ?? current.defaultModel,
      );
    }
    return repository.updateAgentRole(id, patch); // 404 if unknown
  });

  app.delete("/api/hub/agents/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    repository.deleteAgentRole(id); // 404 if unknown
    return reply.code(204).send();
  });
}

// Crew nesting (WP1.2, D-CN5) — VERIFIED, no behavior change needed here. `HubCrewMember` (and thus
// `HubCrewInput`/`HubCrewPatch`) is typed against the WP0.1-widened, `.strict()` shared schema, so a
// `crewId` member (nesting a sub-crew) round-trips through `.parse()` → `repository.createCrew`/
// `updateCrew` → the raw `HubCrew` response exactly like an `agentId` member always has — no new field,
// no new branch. And WP1.1's `assertCrewGraphValid` throws a typed `httpError(400, …)` on a cyclic/
// missing/over-depth `crewId` member from INSIDE `createCrew`/`updateCrew`; that throw propagates
// unchanged up through this handler to the app's central `setErrorHandler` (`index.ts`), which already
// honors `error.statusCode` — the SAME generic path a bad `hubCrewInputSchema` body's `ZodError` takes
// to a 400. See `hub-agent-routes.test.ts`'s cyclic-create/patch 400 assertions for the proof.
//
// model-identity WP6.1 (F5) — `providers` is threaded in for the reason the agent routes above already
// were: a crew MEMBER can pin a credential too (`HubCrewMember.providerCredentialId`), and that is a
// FIFTH write binding WP2.2's "exactly 4, all guarded" sweep missed. These handlers called
// `repository.createCrew`/`updateCrew` bare, so a `acme_answers` or auth-broken pin was accepted
// silently and an unknown one was not caught at all (members ride the `hub_crews.members_json` blob,
// which no foreign key protects). `assertCrewMemberCredentials` applies the SAME
// `resolveExplicitHubCredential` the agent + session routes use — one validator, one error vocabulary.
function registerHubCrewRoutes(
  app: FastifyInstance,
  repository: HubRepository,
  providers: ProviderRepository,
): void {
  app.get("/api/hub/crews", async () => repository.listCrews());

  app.post("/api/hub/crews", async (request, reply) => {
    const input = hubCrewInputSchema.parse(request.body);
    assertCrewMemberCredentials(providers, repository, input.members); // 409 on an unusable pin (D-MI9)
    const crew = repository.createCrew(input); // 400 (httpError) on a cyclic/missing/over-depth crewId
    return reply.code(201).send(crew);
  });

  app.get("/api/hub/crews/:id", async (request) => {
    const { id } = request.params as { id: string };
    return repository.getCrew(id); // 404 if unknown
  });

  app.patch("/api/hub/crews/:id", async (request) => {
    const { id } = request.params as { id: string };
    const patch = hubCrewPatchSchema.parse(request.body);
    // A `members` patch REPLACES the whole roster, so every pin in it is a fresh write. Absent
    // `members` ⇒ nothing to validate (a rename must not become a credential check — the same
    // absent/present convention the agent PATCH uses).
    assertCrewMemberCredentials(providers, repository, patch.members);
    return repository.updateCrew(id, patch); // 404 if unknown; 400 on a members patch that would cycle
  });

  app.delete("/api/hub/crews/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    repository.deleteCrew(id); // 404 if unknown
    return reply.code(204).send();
  });
}

// ── WP3.2 memory (planning/Roadmap/RM-03-assistant-hub/, §1.4 / D-AH11a) ──────────────────────────────────────────
//
// `hub_memory` CRUD, the standalone Memory panel's data surface (list/create/edit/archive/delete) AND
// the `memory.propose_save` built-in's "explicit save" endpoint (`hub/tools/builtins/memory.ts`
// already appends the discrete `memory_proposed` event when the model proposes; THIS PATCH route is
// where a "proposed" row becomes an owner-accepted "active" one — D-AH11's hard rule that the assistant
// may only propose, never write, holds all the way through: nothing here flips a row to `active` except
// a request the owner actually made, whether that's clicking "Save" on the transcript's proposal chip
// or accepting/editing it later from the Memory panel).
//
// A direct-UI create (`POST`) is always `source:"user"` — the model's only path to a memory row is the
// built-in (`source:"assistant_proposed"`, `status:"proposed"`); `HubRepository.createMemory` already
// enforces that split from the `source` it's given, so this route never has to choose a status itself.
//
// The optional `?sessionId=` on `PATCH .../memory/:id` (`hubMemoryAcceptQuerySchema`) lets a
// proposed→active transition append the discrete `memory_saved` event (§1.3) to that session's log —
// mirroring `registerHubArtifactRoutes`'s `emitSessionArtifactEvent` — so a session reconstructed
// purely from `hub_events` (R-SES1) shows the save inline, right after the proposal, and a live client
// (the ConversationPane it was accepted from) sees the chip flip without a refetch. Unlike the artifact
// helper's `sessionId` (always a real column pulled off the artifact row), THIS `sessionId` is a
// CLIENT-SUPPLIED hint (`hub_memory` carries no session column by design — memory is a cross-session
// store) — `appendEvent` 404s on an unknown session, so the emission is wrapped in a best-effort
// try/catch: a stale/wrong hint (e.g. the session was deleted after the chip rendered) must never fail
// the memory save itself, only skip the companion transcript event.
function registerHubMemoryRoutes(
  app: FastifyInstance,
  repository: HubRepository,
  channels: HubChannelRegistry,
): void {
  app.get("/api/hub/memory", async (request) => {
    const query = hubMemoryListQuerySchema.parse(request.query ?? {});
    return repository.listMemory({
      ...(query.status ? { status: query.status } : {}),
      ...(query.kind ? { kind: query.kind } : {}),
      ...(query.scope ? { scope: query.scope } : {}),
      ...(query.scopeId !== undefined ? { scopeId: query.scopeId } : {}),
    });
  });

  app.post("/api/hub/memory", async (request, reply) => {
    const input = hubMemoryInputSchema.parse(request.body);
    const memory = repository.createMemory({ ...input, source: "user" });
    return reply.code(201).send(memory);
  });

  app.get("/api/hub/memory/:id", async (request) => {
    const { id } = request.params as { id: string };
    return repository.getMemory(id); // 404 if unknown
  });

  app.patch("/api/hub/memory/:id", async (request) => {
    const { id } = request.params as { id: string };
    const patch = hubMemoryPatchSchema.parse(request.body);
    const { sessionId } = hubMemoryAcceptQuerySchema.parse(request.query ?? {});
    const before = repository.getMemory(id); // 404 if unknown
    const memory = repository.updateMemory(id, patch);
    const justAccepted = before.status === "proposed" && memory.status === "active";
    if (justAccepted && sessionId) {
      try {
        const settled = repository.appendEvent(sessionId, {
          type: "memory_saved",
          memoryId: memory.id,
          kind: memory.kind,
          content: memory.content,
          source: memory.source,
          // WP1.5 (D-HUX11) — the saved row's scope rides the durable event so a replay reconstructs
          // where it landed (profile/project/crew/agent). Defaults to `profile`/null for a legacy row.
          ...(memory.scope ? { scope: memory.scope } : {}),
          scopeId: memory.scopeId ?? null,
        });
        channels.sinkFor(sessionId).onEvent(settled);
      } catch {
        // Best-effort companion event only (see the module doc) — the memory save above already
        // committed regardless of whether this session hint still resolves.
      }
    }
    return memory;
  });

  app.delete("/api/hub/memory/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    repository.deleteMemory(id); // 404 if unknown
    return reply.code(204).send();
  });
}

// ── WP3.5 reviews (planning/Roadmap/RM-03-assistant-hub/, §1.4 / D-AH12, D-AH7) ───────────────────────────────────
//
// Five routes:
//   - `GET  /api/hub/artifacts/:id/reviews`         — list an artifact's reviews (newest last).
//   - `GET  /api/hub/reviews/:id`                   — a single review.
//   - `POST /api/hub/artifacts/:id/reviews`         — spawns the critic (§1.4's wire table) against a
//     version (default: current/latest); self-gates on `assertHubProviderConfigured` (409) — the ONLY
//     review route that touches a model. Comments come back `decision:"pending"`, `authorKind:"agent"`.
//   - `PATCH /api/hub/reviews/:id`                  — per-comment decisions (§1.4's wire table) and/or a
//     `status` change. An `accepted` decision on a comment carrying a `suggestedEdit` re-locates its
//     anchor against the artifact's CURRENT content and appends a new IMMUTABLE version (D-AH12);
//     `rejected` and a `suggestedEdit`-less `accepted` just record the decision. Response is the
//     `HubReviewDecisionResult` envelope (`{ review, resultingVersion? }`, shared).
//   - `POST /api/hub/artifacts/:id/versions/:version/revert` — the R-UX7 undo pairing for the above: a
//     NEW version whose content equals a historical one (never mutates history — versions stay
//     immutable). A NEW route, not a change to `registerHubArtifactRoutes` (WP1.6's own owned block).
//
// Every review/version-revert route appends the discrete `review_opened`/`review_decided`/
// `artifact_updated` event (§1.3) to the artifact's session log when it has one — mirrors
// `registerHubArtifactRoutes`'s `emitSessionArtifactEvent` (duplicated here in miniature rather than
// reaching into that function's closure, since WP1.6's block stays untouched per this WP's file-
// ownership contract) — so a session reconstructed purely from `hub_events` (R-SES1) sees a critic
// review / accepted suggestion / revert exactly like it sees any other artifact change.
function registerHubReviewRoutes(
  app: FastifyInstance,
  deps: HubRouteDeps,
  channels: HubChannelRegistry,
): void {
  const { repository, providers } = deps;
  const runReviewAgent: HubReviewAgentRunner =
    deps.reviewAgentRunner ?? createDefaultReviewAgentRunner(providers, app.log);

  const emitSessionEvent = (sessionId: string | null | undefined, event: HubEventInput): void => {
    if (!sessionId) return;
    const settled = repository.appendEvent(sessionId, event);
    channels.sinkFor(sessionId).onEvent(settled);
  };

  app.get("/api/hub/artifacts/:id/reviews", async (request) => {
    const { id } = request.params as { id: string };
    repository.getArtifact(id); // 404 if unknown
    return repository.listReviews(id);
  });

  app.get("/api/hub/reviews/:id", async (request) => {
    const { id } = request.params as { id: string };
    return repository.getReview(id); // 404 if unknown
  });

  app.post("/api/hub/artifacts/:id/reviews", async (request, reply) => {
    const { id } = request.params as { id: string };
    const artifact = repository.getArtifact(id); // 404 if unknown
    const input = hubReviewRequestBodySchema.parse(request.body);
    const version = resolveArtifactVersion(repository, artifact, input.version); // 404 on a bad ?version=

    const role = input.roleId ? repository.getAgentRole(input.roleId) : undefined; // 404 if unknown
    const modelId = input.model ?? role?.defaultModel;
    if (!modelId) {
      throw httpError(
        400,
        "Provide `model` or `roleId` (a role with a default model) to run a critic review.",
      );
    }
    assertHubProviderConfigured(providers);

    // model-identity WP6.1 (F9) — the pin follows its model (`pinForModel`, the one staleness rule).
    // Two defects this replaces: (a) a free-text `input.model` could never carry a credential, so a
    // critic run without a `roleId` was structurally unable to use the subscription; and (b) the role's
    // pin was attached WHENEVER the role had one — including when `input.model` had overridden the
    // role's model, making a credential chosen for model A authoritative for model B. The request's own
    // pin wins; a role pin survives only while the role's model is still the effective one.
    const providerCredentialId = pinForModel(modelId, [
      { model: input.model, pin: input.providerCredentialId },
      { model: role?.defaultModel, pin: role?.providerCredentialId },
    ]);
    // D-MI9 for a pin the CALLER asserted (not one we inherited): this route is synchronous, so the
    // 409 is visible. An inherited role pin is not re-validated here — the resolver still refuses it at
    // turn time, and 409-ing a saved role's pin on an unrelated review request would be surprising.
    if (input.providerCredentialId) {
      resolveExplicitHubCredential(providers, input.providerCredentialId, modelId);
    }

    const result = await runReviewAgent({
      systemPrompt: buildCriticSystemPrompt(role),
      brief: buildCriticBrief(artifact, version),
      model: modelId,
      ...(providerCredentialId ? { providerCredentialId } : {}),
    });
    const comments = stampReviewComments(result.comments, version.content, role?.id ?? "critic");

    const review = repository.createReview({
      artifactId: id,
      baseVersion: version.version,
      reviewerKind: "agent",
      reviewerRef: role?.id ?? "critic",
      comments,
    });
    emitSessionEvent(artifact.sessionId, {
      type: "review_opened",
      reviewId: review.id,
      artifactId: id,
      baseVersion: version.version,
    });
    return reply.code(201).send(review);
  });

  app.patch("/api/hub/reviews/:id", async (request) => {
    const { id } = request.params as { id: string };
    const review = repository.getReview(id); // 404 if unknown
    const body = hubReviewPatchBodySchema.parse(request.body);
    const artifact = repository.getArtifact(review.artifactId);

    let updated: HubReview = review;
    let resultingVersion: HubArtifactVersion | undefined;

    if (body.decision) {
      const comment = review.comments.find((c) => c.id === body.decision?.commentId);
      if (!comment) throw httpError(404, "Hub review comment not found");
      if (comment.decision !== "pending") {
        throw httpError(409, `This comment was already ${comment.decision}.`);
      }
      if (body.decision.decision === "accepted" && comment.suggestedEdit !== undefined) {
        const current = artifact.currentVersionId
          ? repository.getArtifactVersion(artifact.currentVersionId)
          : undefined;
        if (!current)
          throw httpError(409, "This artifact has no current version to apply the suggestion to.");
        const newContent = applyReviewSuggestion(current.content, comment);
        resultingVersion = repository.addArtifactVersion(review.artifactId, {
          content: newContent,
          note: `Accepted review suggestion: ${comment.body}`.slice(0, 500),
          authorKind: "agent",
          ...(comment.authorRef ? { authorRef: comment.authorRef } : {}),
        });
        emitSessionEvent(artifact.sessionId, {
          type: "artifact_updated",
          artifactId: resultingVersion.artifactId,
          versionId: resultingVersion.id,
          version: resultingVersion.version,
          ...(resultingVersion.note ? { note: resultingVersion.note } : {}),
        });
      }
      updated = repository.decideReviewComment(id, body.decision.commentId, body.decision.decision);
    }
    if (body.status) {
      updated = repository.updateReview(id, { status: body.status });
    }

    emitSessionEvent(artifact.sessionId, {
      type: "review_decided",
      reviewId: id,
      artifactId: review.artifactId,
      ...(body.status ? { status: body.status } : {}),
      ...(body.decision
        ? { commentId: body.decision.commentId, decision: body.decision.decision }
        : {}),
      ...(resultingVersion
        ? { resultingVersionId: resultingVersion.id, resultingVersion: resultingVersion.version }
        : {}),
    });

    const out: HubReviewDecisionResult = resultingVersion
      ? { review: updated, resultingVersion }
      : { review: updated };
    return out;
  });

  // The R-UX7 undo pairing (execution-plan §2 WP3.5): revert to a historical version by APPENDING a new
  // one with that version's content — history stays immutable (D-AH12), "undo" is itself just another
  // forward version, exactly like every other artifact edit.
  app.post("/api/hub/artifacts/:id/versions/:version/revert", async (request, reply) => {
    const params = hubArtifactVersionRevertParamsSchema.parse(request.params);
    const artifact = repository.getArtifact(params.id); // 404 if unknown
    const target = resolveArtifactVersion(repository, artifact, params.version); // 404 on a bad version
    if (target.version === artifact.latestVersion) {
      throw httpError(400, "This is already the current version.");
    }
    const reverted = repository.addArtifactVersion(params.id, {
      content: target.content,
      note: `Reverted to version ${target.version}`,
      authorKind: "user",
    });
    emitSessionEvent(artifact.sessionId, {
      type: "artifact_updated",
      artifactId: reverted.artifactId,
      versionId: reverted.id,
      version: reverted.version,
      ...(reverted.note ? { note: reverted.note } : {}),
    });
    return reply.code(201).send(reverted);
  });
}
