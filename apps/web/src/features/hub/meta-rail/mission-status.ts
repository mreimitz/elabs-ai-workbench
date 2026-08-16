import type { MissionBoardAgentView, MissionBoardPhase, MissionBoardView } from "../MissionBoard";

/**
 * Assistant Hub UX (WP1.2, D-HUX14) — the meta rail's Progress section renders mission/agent state
 * through the app's ONE status vocabulary (`StatusBadge`/`lib/status.ts` `deriveStatusView`), not a
 * bespoke variant table (the ad-hoc `MISSION_STATUS_VARIANT` map the now-retired `UsageView.tsx`
 * used to carry was exactly the kind of per-view reinvention D-HUX14 retires). `deriveStatusView` itself stays
 * untouched — these two pure functions are the "mapping call site this WP owns" the workstream
 * README carves out: they translate the mission board's OWN phase/agent shape into one of the raw
 * wire values `deriveStatusView` already understands (`pending`, `running`, `complete`, or a
 * currently-unmapped value that safely humanizes, e.g. `awaiting-approval`/`skipped`).
 *
 * D-HUX14's table lists six mission/agent states: pending (proposed) · awaiting-approval · running ·
 * complete · failed · skipped (stopped). This mission board's wire shape has no per-agent `failed`
 * signal (an agent either reports or it doesn't), so `failed` is intentionally unused here — a
 * defensible reading of the vocabulary, not a gap silently swallowed.
 */

/** The mission's own summary status (the rail's mission header chip). */
export function missionStatusRaw(board: Pick<MissionBoardView, "phase" | "approved">): string {
  if (board.phase === "proposed") return board.approved ? "pending" : "awaiting-approval";
  if (board.phase === "approved") return "pending";
  if (board.phase === "running" || board.phase === "synthesizing") return "running";
  if (board.phase === "done") return "complete";
  return "pending";
}

/** One agent's status within the mission (per-agent chip in the Progress rail summary). */
export function missionAgentStatusRaw(
  agent: Pick<MissionBoardAgentView, "reported">,
  phase: MissionBoardPhase,
): string {
  if (agent.reported) return "complete";
  if (phase === "running" || phase === "synthesizing") return "running";
  if (phase === "done") return "skipped"; // the mission settled; this agent never reported
  return "pending"; // proposed/approved — queued, not yet its turn
}
