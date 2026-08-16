// Assistant Hub (WP0.5, §1.6) — the planner-only `mission.propose_plan` built-in.
//
// DESIGN NOTE (read before touching this file): this is deliberately a VALIDATE-AND-ECHO builtin, not
// a persisting one. Creating the actual `hub_missions` row (`HubRepository.createMission`, which
// WP0.2 already built) and emitting the `plan_proposed` event is left to the mission orchestrator
// (WP1.7, `apps/api/src/hub/missions/**`), which owns the approval-flow context this plumbing-only
// builtin doesn't have (autonomy resolution, the parent session's mission-per-session invariant
// D-AH8, event `messageId`/`seq` sequencing). WP0.5's job is only to give the planner turn a
// schema-validated, structured way to EMIT a plan — reusing the shared `hubMissionPlanSchema`
// directly (so the tool's input schema and the wire contract can never drift) — and hand back a
// clean confirmation the model can narrate. If WP1.7 finds this split wrong, that's an implementation
// call for it to revise, not a locked decision — see the WP0.5 report.
import { hubMissionPlanSchema } from "@mcp-token-footprint/shared";
import type { HubBuiltinTool } from "../types.js";

export const missionProposePlan: HubBuiltinTool = {
  name: "mission.propose_plan",
  source: "builtin",
  description:
    "Planner-only: emit the structured mission plan (topology, agents, budgets, rationale) for operator approval. Does not itself launch anything.",
  inputSchema: hubMissionPlanSchema,
  annotations: { readOnlyHint: true },
  async execute(input) {
    const plan = hubMissionPlanSchema.parse(input);
    return { modelContent: plan, artifact: { kind: "mission_plan", data: plan } };
  },
};

export const MISSION_BUILTINS: HubBuiltinTool[] = [missionProposePlan];
