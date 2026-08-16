import type { HubTaskStatus, HubToolPart } from "@mcp-token-footprint/shared";

/**
 * Assistant Hub (WP1.3) — pure adapters between the hub's wire shapes ({@link HubToolPart},
 * {@link HubTaskStatus}) and the `@brand/ai` component contracts (`Tool*`/`ApprovalCard`/`TaskItem`),
 * kept import-light (no components) so they unit-test in a plain node environment — mirrors
 * `features/testing/tool-call-view.ts`.
 */

/** Strip the SDK's `mcp__<server>__` namespace from an MCP tool name for display (`runs_get`, not
 *  `mcp__assistant-app__runs_get`). Hub built-ins (`tasks.create`, `workspace.read`, …) and any
 *  already-bare name pass through unchanged. Mirrors `features/assistant/AssistantToolCallCard.tsx`. */
export function prettyToolName(name: string): string {
  return name.replace(/^mcp__.+?__/, "");
}

/**
 * The `@brand/ai` `ApprovalCard`/`Confirmation` `approval` prop, built from a {@link HubToolPart}'s
 * {@link HubToolApproval} (R-MCP3/R-UX1). Only a SETTLED resolution carries `approved`/`reason` — the
 * AI-SDK `ToolUIPartApproval` union's pending shape is `{id}` alone (no `reason` until a decision
 * exists), so `note` is surfaced only once `resolution` is set. Returns `undefined` when the part
 * carries no approval at all (every non-approval-gated state).
 */
export function toolUiPartApproval(
  part: HubToolPart,
):
  | { id: string }
  | { id: string; approved: true; reason?: string }
  | { id: string; approved: false; reason?: string }
  | undefined {
  const approval = part.approval;
  if (!approval) return undefined;
  const id = part.toolCallId;
  if (approval.resolution === "deny") {
    return approval.note ? { id, approved: false, reason: approval.note } : { id, approved: false };
  }
  if (approval.resolution === "allow-once" || approval.resolution === "always") {
    return approval.note ? { id, approved: true, reason: approval.note } : { id, approved: true };
  }
  return { id };
}

/** True while a tool part is in a state an approval card is relevant for (R-UX1's approval leg) —
 *  guards whether `ApprovalCard` should even mount (it renders `null` for the other four states, but
 *  callers that also want to skip building the approval prop can check this first). */
export function isApprovalRelevantState(state: HubToolPart["state"]): boolean {
  return (
    state === "approval-requested" || state === "approval-responded" || state === "output-denied"
  );
}

/** `TaskItem`'s `status` prop (`@brand/ui`'s closed 7-state `Status`) mapped from the R-SES4 task
 *  vocabulary. `blocked`/`cancelled` both read as `skipped` (closest semantic — not actively being
 *  worked, distinct from `failed`); the task's own title/note carries the finer distinction. */
export function taskStatusToStatus(
  status: HubTaskStatus,
): "pending" | "running" | "complete" | "skipped" {
  switch (status) {
    case "pending":
      return "pending";
    case "in_progress":
      return "running";
    case "completed":
      return "complete";
    case "blocked":
    case "cancelled":
      return "skipped";
    default: {
      const _exhaustive: never = status;
      return _exhaustive;
    }
  }
}
