// Assistant Hub (WP2.6, R-GUI2/3/4) — the transcript entry point for one generative-UI surface. Given a
// GenUI `tool_call` part (source "genui" — the `present`/`prompt_user` emission) OR a settled
// `generative-ui` message part, it RE-VALIDATES the raw spec at render time (the security boundary — it
// never trusts that the server validated it), then decides:
//   • root renderable      → render the sanitized widget (valid portions only — R-GUI4)
//   • repair exhausted     → an honest recovery card (R-GUI4)
//   • settled output-error → nothing (the model is repairing, or fell back to markdown text)
//   • still streaming      → a shimmer placeholder (R-GUI3 streaming-tolerant)
//
// It NEVER throws and NEVER renders an unknown component/prop/unsafe URL (the shared `validateGenuiSpec`
// + the allowlisted registry guarantee this).

import { Shimmer } from "@brand/ai";
import { validateGenuiSpec, type HubToolPart } from "@mcp-token-footprint/shared";
import { GenUiNode } from "./GenUiNode.js";
import { GenuiRecoveryCard } from "./RecoveryCard.js";
import { useGenuiWidgetState, type GenuiWidgetHandlers } from "./use-genui-state.js";

/** Pull the root node out of a `present` tool call's args (`{ root: node }`), tolerating a bare node. */
function extractRoot(args: unknown): unknown {
  if (args && typeof args === "object" && !Array.isArray(args)) {
    const obj = args as Record<string, unknown>;
    if (obj.root !== undefined) return obj.root;
    if (typeof obj.$type === "string") return obj; // already the node
  }
  return args;
}

/** The exhausted-repair recovery signal the present tool writes into its result `modelContent` (R-GUI4). */
function isExhaustedRecovery(part: HubToolPart | undefined): boolean {
  const mc = part?.modelContent as { recovery?: unknown } | undefined;
  return mc?.recovery === "exhausted";
}

export type GenUiPartProps = {
  /** For a `generative-ui` message part: the spec node directly. */
  spec?: unknown;
  /** For a `tool_call` part (source "genui"): the merged part (args = `{root}`, state, modelContent). */
  toolPart?: HubToolPart;
  messageId?: string;
  /** Stable per-widget key within the message (the toolCallId, or the part key) — scopes `ui_state`. */
  widgetKey?: string;
  /** The replayed latest `ui_state` for this widget (R-GUI5 rehydration). */
  uiState?: unknown;
  /** Interactivity handlers (persist ui_state / submit). Absent ⇒ read-only (e.g. a regenerate variant). */
  handlers?: GenuiWidgetHandlers;
  /** True while the owning turn is still streaming (R-GUI3). */
  streaming?: boolean;
};

export function GenUiPart({
  spec,
  toolPart,
  messageId,
  widgetKey,
  uiState,
  handlers,
  streaming,
}: GenUiPartProps) {
  const { ctx } = useGenuiWidgetState({
    ...(messageId ? { messageId } : {}),
    ...(widgetKey ? { widgetKey } : {}),
    ...(uiState !== undefined ? { initialState: uiState } : {}),
    ...(handlers ? { handlers } : {}),
  });

  if (isExhaustedRecovery(toolPart)) {
    return <GenuiRecoveryCard reason="the assistant couldn't produce a valid widget after repair attempts" />;
  }

  const raw = toolPart ? extractRoot(toolPart.args) : spec;
  const result = validateGenuiSpec(raw);

  if (result.rootRenderable && result.sanitized) {
    return (
      <section className="min-w-0 rounded-md border border-border bg-card p-3" aria-label="Generated widget">
        <GenUiNode node={result.sanitized} ctx={ctx} />
      </section>
    );
  }

  // Root not renderable. A settled tool error means the model is repairing (or gave up to markdown) —
  // render nothing so the retry / the assistant's text carries the answer.
  if (toolPart?.state === "output-error") return null;

  // Still arriving (partial/streaming args) — a layout-stable shimmer, never a collapsed spinner (R-GUI3).
  const stillStreaming =
    streaming || toolPart?.state === "input-streaming" || toolPart?.state === "input-available";
  if (stillStreaming) {
    return (
      <div className="min-w-0 rounded-md border border-dashed border-border p-3 text-caption text-muted-foreground">
        <Shimmer>Preparing a widget…</Shimmer>
      </div>
    );
  }
  return null;
}
