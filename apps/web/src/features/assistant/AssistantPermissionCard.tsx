import { Alert, AlertDescription, AlertTitle, Badge, Button, Text } from "@elabs-ai/components-ui";
import { ToolInput } from "@elabs-ai/components-ai";
import { Check, ShieldAlert, X } from "lucide-react";
import { CodeSnippet } from "../testing/CodeSnippet";
import type { AssistantTimelinePermission } from "./use-assistant-stream";

/**
 * A write-approval round-trip (WP 2.1, D-AS4) rendered in the dock transcript. Composed from `@elabs-ai/components-*`
 * primitives (`Alert`/`Button`/`Badge`/`Text` + `@elabs-ai/components-ai` `ToolInput`) rather than `@elabs-ai/components-ai`'s
 * `ApprovalCard` — that component is wired to the AI-SDK `useChat` `ToolUIPart` approval STATE MACHINE
 * (specific `state` strings like `"approval-responded"`), which this app doesn't use: the dock drives its
 * own `AssistantEvent` model over SSE. Same compose-from-primitives reasoning as `AssistantToolCallCard`;
 * every element is still a `@elabs-ai/components-*` component.
 *
 * Two states, keyed off whether the `permission_decision` has settled:
 *  - PENDING (no `decision`) → an actionable card: tool name + argument summary + an optional diff
 *    preview, with **Allow** / **Deny**. The tool is BLOCKED server-side until the owner decides.
 *  - SETTLED (`decision` present) → an inert resolved chip (allowed/denied). This is also what a REPLAYED
 *    request renders as — the decision already happened, so it's never re-actionable.
 */
export function AssistantPermissionCard({
  permission,
  onDecide,
  deciding,
}: {
  permission: AssistantTimelinePermission;
  /** Post the owner's decision for this request. */
  onDecide: (requestId: string, behavior: "allow" | "deny") => void;
  /** This request's decision POST is in flight — disable both buttons so it can't be double-sent. */
  deciding: boolean;
}) {
  if (permission.decision) return <ResolvedPermission permission={permission} />;

  return (
    <Alert variant="warning" className="min-w-0">
      <ShieldAlert aria-hidden />
      <AlertTitle className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        <span className="shrink-0">Approve write</span>
        <Text
          variant="code"
          as="span"
          className="min-w-0 truncate font-medium"
          title={permission.toolName}
        >
          {permission.toolName}
        </Text>
      </AlertTitle>
      <AlertDescription className="flex min-w-0 flex-col gap-3">
        <Text variant="caption" tone="muted" className="text-pretty">
          The assistant wants to run this write. Review the arguments, then allow or deny — nothing
          runs until you decide.
        </Text>
        <ToolInput input={permission.input} className="min-w-0 overflow-x-auto" />
        {permission.diffPreview ? (
          <CodeSnippet
            value={permission.diffPreview}
            label="Proposed change"
            ariaLabel={`Proposed change for ${permission.toolName}`}
          />
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          {/* Approval gates are visually neutral (P1) — Allow used to be the solid/primary button
              next to an outline Deny, so "yes" visually dominated the exact moment the system should
              stay neutral. Both are `outline`, same size and weight; only the icon/label differ. */}
          <Button
            size="sm"
            variant="outline"
            onClick={() => onDecide(permission.id, "allow")}
            disabled={deciding}
          >
            <Check aria-hidden className="size-4" />
            <span>Allow</span>
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => onDecide(permission.id, "deny")}
            disabled={deciding}
          >
            <X aria-hidden className="size-4" />
            <span>Deny</span>
          </Button>
        </div>
      </AlertDescription>
    </Alert>
  );
}

/** A settled decision — the inert transcript record (also what a replayed request renders as). */
function ResolvedPermission({ permission }: { permission: AssistantTimelinePermission }) {
  const allowed = permission.decision?.behavior === "allow";
  return (
    <Alert className="min-w-0">
      {allowed ? <Check aria-hidden /> : <X aria-hidden />}
      <AlertTitle className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        <Badge variant={allowed ? "success" : "secondary"} className="shrink-0 font-normal">
          {allowed ? "Allowed" : "Denied"}
        </Badge>
        <Text
          variant="code"
          as="span"
          className="min-w-0 truncate font-medium"
          title={permission.toolName}
        >
          {permission.toolName}
        </Text>
      </AlertTitle>
      <AlertDescription>
        <Text variant="caption" tone="muted">
          {allowed ? "This write was approved for this thread." : "This write was declined."}
        </Text>
      </AlertDescription>
    </Alert>
  );
}
