import { Badge } from "@elabs-ai/components-ui";
import { Navigation } from "lucide-react";
import { resolveAssistantUiAction } from "@mcp-token-footprint/shared";
import type { AssistantTimelineUiAction } from "./use-assistant-stream";

/**
 * WP 3.1 (D-AS8/D-AS16) — the chip a `ui_action` event renders as in the transcript. ALWAYS inert
 * (never calls `navigate()`, regardless of `uiAction.isReplay`) — the SIDE EFFECT of a live action is
 * a separate concern owned by `AssistantDock.tsx`'s executor effect (`useAssistant().executeUiAction`,
 * called once per freshly-arrived live event). This component only re-resolves `{action, params}`
 * against the SAME shared addressable-view registry the tool + executor use
 * (`packages/shared/src/assistant-ui-registry.ts`) to render a readable label ("Run console — …, turn
 * 4"); a resolution failure falls back to a generic label rather than throwing mid-render.
 */
export function AssistantUiActionChip({ uiAction }: { uiAction: AssistantTimelineUiAction }) {
  const resolution = resolveAssistantUiAction(uiAction.action, uiAction.params);
  const label = resolution.ok ? resolution.target.label : `Opened ${uiAction.action}`;
  return (
    <Badge variant="outline" className="w-fit gap-1 font-normal">
      <Navigation aria-hidden className="size-3" />
      <span>{label}</span>
    </Badge>
  );
}
