import { DecorationProvider, type DecorationLevel } from "@elabs-ai/components-tokens";
import { cn } from "@elabs-ai/components-ui";
import { PanelRight } from "lucide-react";
import type { ReactNode } from "react";
import { IconButton } from "../../components/IconButton";
import {
  CANVAS_GRID_OPACITY,
  CHAT_CANVAS_DECORATION_LEVEL,
  canvasGridBackgroundStyle,
  canvasGridMaskStyle,
} from "./lib/hub-ux";

/**
 * Assistant Hub (WP1.3, D-HUX12) — the chat workspace's canvas: a quiet dot-grid texture layer
 * BEHIND the transcript, plus the transcript region itself. Purely a wrapper — it owns no session
 * state and renders no composer (the docked `Composer` is a sibling the caller renders below this,
 * and the CENTERED composer for a fresh session lives in `EmptySessionIntro`, layered on top of
 * this same canvas by the caller — see that component's doc for the split rationale).
 *
 * The grid is one non-scrolling CSS layer (`canvasGridBackgroundStyle` + `canvasGridMaskStyle` from
 * `./lib/hub-ux`, both riding the semantic `--canvas-grid` token — no raw colors) sitting BEHIND
 * `children` (`z-0` vs `z-10`); `children` renders its own scroll region exactly as before (this
 * component adds no scroll container of its own — one scroll owner stays the transcript's).
 *
 * Decoration-gated per D-HUX12 ("off at minimal"): the grid is wrapped in a LOCAL `DecorationProvider`
 * (`@elabs-ai/components-tokens`'s scoped `data-decoration` override, not the document-level `useDecoration()`
 * setting — see `CHAT_CANVAS_DECORATION_LEVEL`'s doc for why a local override is the right tool
 * here) and is not rendered at all when `decorationLevel` is `0` ("minimal") — a real DOM removal,
 * not just a CSS fade, so a decoration-minimal caller (or a future decoration-density setting) can
 * rely on it being fully gone.
 */
export interface ChatCanvasProps {
  /** The transcript region (typically `ConversationPane`) — it owns its own scroll; ChatCanvas adds
   *  none of its own. */
  children: ReactNode;
  /** D-HUX12 — the LOCAL decoration ambient (0–10) for the dot-grid layer. Defaults to
   *  {@link CHAT_CANVAS_DECORATION_LEVEL} ("normal" — the grid shows). Pass `0` ("minimal") to
   *  remove the grid entirely. */
  decorationLevel?: DecorationLevel;
  /** When the meta rail is collapsed AND {@link onShowRail} is supplied, the canvas floats a small
   *  expand control in its top-right corner (above the transcript, `z-20`) so the rail can be
   *  reopened without a toolbar toggle. Both must be set for the control to render. */
  railHidden?: boolean;
  onShowRail?: () => void;
  className?: string;
}

export function ChatCanvas({
  children,
  decorationLevel = CHAT_CANVAS_DECORATION_LEVEL,
  railHidden,
  onShowRail,
  className,
}: ChatCanvasProps) {
  return (
    <div className={cn("relative flex min-h-0 flex-1 flex-col", className)}>
      {decorationLevel > 0 ? (
        <DecorationProvider
          level={decorationLevel}
          aria-hidden="true"
          data-testid="chat-canvas-grid"
          className="pointer-events-none absolute inset-0 z-0"
          style={{
            ...canvasGridBackgroundStyle(),
            ...canvasGridMaskStyle(),
            opacity: CANVAS_GRID_OPACITY,
          }}
        />
      ) : null}
      <div className="relative z-10 flex min-h-0 flex-1 flex-col">{children}</div>
      {railHidden && onShowRail ? (
        <IconButton
          variant="outline"
          size="icon-sm"
          onClick={onShowRail}
          label="Show the rail"
          className="absolute top-3 right-3 z-20 bg-card shadow-sm"
        >
          <PanelRight aria-hidden className="size-4" />
        </IconButton>
      ) : null}
    </div>
  );
}
