// Assistant Hub (planning/Roadmap/RM-03-assistant-hub/, WP1.7, §1.4) — the MISSION REST surface, mounted additively
// from `hub/routes.ts` (like WP1.6's `registerHubArtifactRoutes`). All events are fanned out over the
// PARENT session's SSE channel (`channels.sinkFor(mission.sessionId)`) — the same replay-then-live
// stream the conversation already uses; no new transport.
//
// Routes:
//   POST /api/hub/sessions/:id/mission            — propose (the in-band planner turn — see the note)
//   PATCH /api/hub/missions/:id                   — edit the (still-proposed) plan
//   POST /api/hub/missions/:id/approve            — approve + run the mission
//   POST /api/hub/missions/:id/stop               — stop the mission (partial synthesis)
//   POST /api/hub/missions/:id/agents/:agentId/stop — stop one agent
//
// NOTE on the propose route: the execution-plan's minimal WP1.7 route list enumerates the operations
// ON an existing mission (approve/stop/PATCH/agent-stop). A mission must first be CREATED, and §1.4
// says mission planning is IN-BAND (the planner turn emits `plan_proposed`). WP1.1's `dispatchMessage`
// runs a CHAT turn for a mission-mode session (it maps `mission`→`chat`, deferring the planner to this
// WP), and WP1.7 does not own that path. So this dedicated propose route IS the in-band planner
// entry-point: it runs the mission-planner prompt explicitly + deterministically and emits
// `plan_proposed` into the parent session log. (The steer route is WP2.3.)

import type { HubSession } from "@mcp-token-footprint/shared";
import { hubMissionPlanSchema, hubMissionProposeInputSchema } from "@mcp-token-footprint/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { httpError } from "../../utils/errors.js";
import type { HubRepository } from "../repository.js";
import type { HubNotifySink, HubTurnSink } from "../turn-engine.js";
import { isTerminalMissionStatus, type HubMissionService } from "./orchestrator.js";
import { clampGrantsToCatalog, type HubPlannerServerCatalog } from "./planner.js";
import { pinForModel } from "./topologies.js";

/** The minimal live-fan-out surface the mission routes need (the parent `HubChannelRegistry` satisfies
 *  it structurally — no import of the private class). */
export type HubMissionChannels = { sinkFor(sessionId: string): HubTurnSink };

export type HubMissionRouteDeps = {
  repository: HubRepository;
  missionService: HubMissionService;
  /** The 409-when-no-provider gate (wired from `hub/routes.ts`, mirroring the messages route). */
  assertConfigured: () => void;
  /**
   * model-identity WP6.1 (F7/F8, D-MI9) — validate ONE explicit `providerCredentialId` against the
   * credential store, throwing the shared 409 when it is unknown / not hub-eligible / auth-broken.
   * Wired from `hub/routes.ts` over `resolveExplicitHubCredential`, so these routes refuse in the SAME
   * vocabulary as the session and agent routes rather than growing a second one.
   *
   * It is called SYNCHRONOUSLY, before the propose route's 202 and before `editPlan` persists — which
   * is the whole point on both hops. Propose fire-and-forgets into a `.catch(log.warn)`, so a refusal
   * raised later would reach nobody (the WP4.4 class of defect); and `editPlan` used to persist an
   * unvalidated pin whose only consequence surfaced at spawn time as a raw `SQLITE_CONSTRAINT` → 500,
   * the exact failure WP2.2 rewrote `createSession` to avoid.
   *
   * Absent ⇒ no validation (graceful-degrade, mirroring the other optional deps here).
   */
  assertPinUsable?: (providerCredentialId: string, modelId: string) => void;
  /**
   * mission-planner-guard (2026-07-27) — assert the effective (model × credential) pair can actually
   * BACK THE PLANNER TURN, throwing a 400 when it resolves to no AI-SDK model builder (a
   * `claude_subscription` credential, by design — those turns route through the Agent SDK executor,
   * which the planner's structured-output call cannot use).
   *
   * This closes a real, reproducible dead end. A mission-mode session pinned to a subscription
   * credential accepted the operator's ask, persisted it as a `user_message`, answered **202** — and
   * then `hubBuildModel` threw inside the planner promise, straight into the `.catch(log.warn)` below.
   * The session sat at `status: "pending"` with a dangling, un-answered message and no mission row,
   * forever, while the console showed a turn that looked live. Nothing anywhere refused the pin,
   * because {@link assertPinUsable} validates the CREDENTIAL (exists · hub-eligible · not auth-broken)
   * and never asks whether it can build a model.
   *
   * Like `assertPinUsable` it runs SYNCHRONOUSLY, before the 202, for exactly the reason that dep's own
   * doc gives — a refusal raised later reaches nobody. (The `.catch` below now settles over the sink
   * too, but that is the backstop for what cannot be predicted; a wrong pin is knowable up front, and
   * an HTTP error is what the composer can actually act on.)
   *
   * Absent ⇒ no validation (graceful-degrade, mirroring the other optional deps here).
   */
  assertPlannerModelUsable?: (modelId: string, providerCredentialId?: string) => void;
  /** WP4.3 (R-SES9/R-UX11) — fired once `approve()`'s run-to-completion promise settles the mission to
   *  a REAL terminal status (`completed`/`stopped`/`failed` — `approve()` never resolves otherwise).
   *  Absent ⇒ no notification (the SAME optional hook `hub/routes.ts` threads here from `HubRouteDeps`). */
  notify?: HubNotifySink;
  /** hub-fixes WP2.2 (RC2.4) — resolve the parent session's grantable MCP servers (the SAME scope-aware
   *  catalog `resolveHubMcpGrants` reads), so a plan EDIT strips grants to unknown/unreachable servers
   *  LOUDLY (a `plan.rationale` note) before persisting — instead of `resolveMcpGrants`'s silent
   *  turn-time drop. Absent ⇒ the edit round-trips unchanged (graceful-degrade, mirroring every other
   *  optional dep here). Wired from `hub/routes.ts` over `deps.servers`/`deps.scans`. */
  mcpServerCatalog?: (session: HubSession) => Promise<HubPlannerServerCatalog> | HubPlannerServerCatalog;
};

// model-identity WP6.1 (F7) — the propose body now lives in `packages/shared` (contract-first) because
// it grew the composer's `model` + `providerCredentialId`. It stays `.strict()`, which is exactly why
// they had to be added here rather than just sent: an extra field was a 400, not an ignored key.
const editPlanBodySchema = z.object({ plan: hubMissionPlanSchema }).strict();

export function registerHubMissionRoutes(
  app: FastifyInstance,
  deps: HubMissionRouteDeps,
  channels: HubMissionChannels,
): void {
  const {
    repository,
    missionService,
    assertConfigured,
    notify,
    mcpServerCatalog,
    assertPinUsable,
    assertPlannerModelUsable,
  } = deps;

  /**
   * mission-planner-guard (2026-07-27) — SETTLE a post-kickoff propose failure over the parent
   * session's live sink (`error` + `turn_done`) instead of only logging it.
   *
   * `proposePlan` persists the operator's ask as a `user_message` before it does anything else, so a
   * later throw left a dangling, un-answered message and a session stuck mid-turn — the client had
   * been handed a 202 and a stream that then said nothing at all. This is the same settle
   * `HubSessionService.dispatchMessage` performs for a failed `@`-mention handoff and for a refused
   * model resolution ("so the client isn't left with a dangling, un-answered user message"), and it
   * pairs with the success path's own closing `turn_done` ("Settle the planning turn so the composer
   * frees while the operator reviews the plan") — a propose now always settles, either way.
   *
   * Both events are append-only, so a client that reconnects replays the refusal. Deliberately a
   * BACKSTOP, not the primary mechanism: what is knowable before the 202 (an unusable pin, a planner
   * model that cannot build) is refused there, as a real HTTP error. This catches the rest — the
   * whole-tree agent-count and nesting-depth caps, which `proposePlan` throws AFTER `plan_proposed`,
   * and any unexpected engine fault.
   *
   * Its own failure is swallowed: this runs inside a `.catch`, so throwing here would produce an
   * unhandled rejection and take the process down over a logging concern.
   */
  const settleFailedPropose = (sessionId: string, error: unknown): void => {
    const message =
      error instanceof Error
        ? error.message
        : "The mission could not be planned. Check the session's model and try again.";
    try {
      const sink = channels.sinkFor(sessionId);
      sink.onEvent(repository.appendEvent(sessionId, { type: "error", message }));
      sink.onEvent(repository.appendEvent(sessionId, { type: "turn_done" }));
    } catch {
      // Already logged by the caller; a failure to record the failure must not escalate.
    }
  };

  // ── Propose (in-band planner turn) — fire-and-forget (the planner is a model call), like /messages.
  app.post("/api/hub/sessions/:id/mission", async (request, reply) => {
    const { id } = request.params as { id: string };
    assertConfigured();
    const { text, crewId, model, providerCredentialId } = hubMissionProposeInputSchema.parse(
      request.body,
    );
    const session = repository.getSession(id); // 404 if unknown
    if (session.mode !== "mission") {
      throw httpError(400, "Missions can only be proposed in a mission-mode session.");
    }
    if (session.kind !== "chat") {
      throw httpError(400, "A mission can only be proposed from a top-level chat session.");
    }
    const existing = repository.getMissionBySession(id);
    if (existing && !isTerminalMissionStatus(existing.status)) {
      throw httpError(409, "This session already has a mission in progress. Stop it before proposing another.");
    }

    // D-MI9 SYNCHRONOUSLY, before the 202: this route fire-and-forgets, so a refusal raised inside the
    // planner promise would land in the `.catch(log.warn)` below and reach the operator through nothing.
    if (providerCredentialId) {
      assertPinUsable?.(providerCredentialId, model ?? session.model);
    }

    // mission-planner-guard (2026-07-27) — and, for the same reason, refuse a model that cannot BUILD.
    // Scoped to the path that actually runs the planner: with a crew named here or pinned on the
    // session, `proposePlan` takes the deterministic `instantiateCrew` branch and makes no model call
    // at all, so guarding it would refuse a propose that would have succeeded.
    //
    // The pair checked is the one `proposePlan` will itself compute — the composer's override when it
    // sent one, else the session's — resolved through the SAME `pinForModel` staleness rule, so this
    // guard and the planner can never disagree about which credential is in force.
    const plannerPath = (crewId ?? session.crewId ?? undefined) === undefined;
    if (plannerPath && assertPlannerModelUsable) {
      const effectiveModel = model?.trim() || session.model;
      assertPlannerModelUsable(
        effectiveModel,
        pinForModel(effectiveModel, [
          { model: model?.trim(), pin: providerCredentialId },
          { model: session.model, pin: session.providerCredentialId },
        ]),
      );
    }

    const sink = channels.sinkFor(id);
    void missionService
      .proposePlan({
        sessionId: id,
        text,
        sink,
        ...(crewId ? { crewId } : {}),
        // model-identity WP6.1 (F7) — carry the composer's explicit pick into the planner turn instead
        // of silently using the session's. Absent ⇒ the session's own model + pin, byte-identical.
        ...(model ? { model } : {}),
        ...(providerCredentialId ? { providerCredentialId } : {}),
      })
      .catch((error) => {
        request.log.warn({ err: error, sessionId: id }, "hub proposePlan failed after kickoff");
        settleFailedPropose(id, error);
      });
    return reply.code(202).send({ sessionId: id, streamUrl: `/api/hub/sessions/${id}/stream` });
  });

  // ── Edit the plan (synchronous — no model call).
  app.patch("/api/hub/missions/:id", async (request) => {
    const { id } = request.params as { id: string };
    const { plan } = editPlanBodySchema.parse(request.body);
    const mission = repository.getMission(id); // 404 if unknown
    const sink = channels.sinkFor(mission.sessionId);
    // model-identity WP6.1 (F8, D-MI9) — validate every EDITED planned-agent pin before it is persisted.
    // `hubPlannedAgentSchema` happily parses a `providerCredentialId`, and `editPlan` ran neither
    // `clampPlannedCredentials` nor the resolver, so an unknown id was written straight into
    // `plan_json` — a blob no foreign key protects — and only surfaced at approve time, when the child
    // spawn's raw `repository.createSession` hit `foreign_keys = ON` and produced a **500** that failed
    // the whole mission. Unlike the planner's own output (stripped at propose, because a model can
    // invent an id), an edit is an operator ASSERTION, so D-MI9's refusal is the right posture — and
    // PATCH is synchronous, so the 409 is visible where the propose route's would not have been.
    if (assertPinUsable) {
      for (const agent of plan.agents) {
        if (agent.providerCredentialId) {
          assertPinUsable(agent.providerCredentialId, agent.model);
        }
      }
    }
    // WP2.2 (RC2.4) — validate the edited grants against the parent's reachable servers: strip a grant
    // to an unknown/unreachable server LOUDLY (a plan-check note) rather than persist it silently. The
    // budget hard-caps + note preservation happen in `editPlan`'s own re-clamp (catalog-less, so the
    // strip note survives). Absent dep ⇒ the plan round-trips unchanged.
    let nextPlan = plan;
    if (mcpServerCatalog) {
      const session = repository.getSession(mission.sessionId);
      const catalog = await mcpServerCatalog(session);
      nextPlan = clampGrantsToCatalog(plan, catalog).plan;
    }
    return missionService.editPlan({ missionId: id, plan: nextPlan, sink }); // 409 if not proposed
  });

  // ── Approve + run — fire-and-forget (spawns agents + synthesizes over SSE).
  app.post("/api/hub/missions/:id/approve", async (request, reply) => {
    const { id } = request.params as { id: string };
    assertConfigured();
    const mission = repository.getMission(id); // 404 if unknown
    if (mission.status !== "proposed") {
      throw httpError(409, `This mission cannot be approved (status: ${mission.status}).`);
    }
    const sink = channels.sinkFor(mission.sessionId);
    void missionService
      .approve({ missionId: id, sink })
      .then((settled) => {
        // WP4.3 — `approve()` resolves with a REAL terminal (completed/stopped/failed); `runMission`'s own
        // catch path also lands here after marking the mission `failed`. hub-fixes (Defect 1c): the pre-run
        // readiness gate can resolve it still `proposed` (blocked before running) — don't fire a terminal
        // notification for that non-terminal outcome.
        if (isTerminalMissionStatus(settled.status)) {
          notify?.({
            kind: "mission_terminal",
            missionId: settled.id,
            sessionId: settled.sessionId,
            status: settled.status,
          });
        }
      })
      .catch((error) => {
        request.log.warn({ err: error, missionId: id }, "hub mission approve failed after kickoff");
      });
    return reply.code(202).send({ missionId: id, streamUrl: `/api/hub/sessions/${mission.sessionId}/stream` });
  });

  // ── Stop the mission (idempotent) — a running mission synthesizes partially.
  app.post("/api/hub/missions/:id/stop", async (request, reply) => {
    const { id } = request.params as { id: string };
    repository.getMission(id); // 404 if unknown
    missionService.stop(id);
    return reply.code(202).send({ ok: true });
  });

  // ── Stop one agent (idempotent).
  app.post("/api/hub/missions/:id/agents/:agentSessionId/stop", async (request, reply) => {
    const { id, agentSessionId } = request.params as { id: string; agentSessionId: string };
    repository.getMission(id); // 404 if unknown
    missionService.stopAgent(id, agentSessionId);
    return reply.code(202).send({ ok: true });
  });
}
