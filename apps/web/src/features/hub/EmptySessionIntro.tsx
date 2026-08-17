import { useReducedMotion } from "@elabs-ai/components-tokens";
import { Suggestion, Suggestions } from "@elabs-ai/components-ai";
import { Heading, Text, cn } from "@elabs-ai/components-ui";
import { type ReactNode, useEffect, useRef } from "react";
import { CognitiveRing } from "./CognitiveRing";
import { HUB_STARTER_SUGGESTIONS } from "./ConversationPane";
import {
  CHAT_READING_COLUMN_CLASS,
  CHOREOGRAPHY_CENTER_TO_DOCK_OFFSET_PX,
  choreographyTransitionClass,
} from "./lib/hub-ux";

/** The two choreography states a fresh session's intro moves between (D-HUX13). */
export type ComposerDockState = "centered" | "docked";

export interface EmptySessionIntroProps {
  /** The invitation heading (D-HUX13's "What should we dig into?"). */
  title?: string;
  /** The supporting line under the heading. */
  subtitle?: string;
  /** Starter prompt chips, rendered as `Suggestion` chips. Defaults to the same catalog
   *  `ConversationPane`'s own (now-suppressed) generic empty state used to. */
  starters?: readonly string[];
  /** Fired when a starter chip is clicked — the caller decides whether that fills the composer or
   *  sends immediately (mirrors `ConversationPane`'s existing `onStarterSelect` contract). */
  onSelectStarter: (text: string) => void;
  /**
   * Render-prop for the composer element, invoked with the CURRENT resolved dock position so the
   * caller's `<Composer dockPosition={…} />` always matches this component's own visual state (no
   * caller-side bookkeeping to keep the two in sync). See `Composer.tsx`'s `dockPosition` prop.
   */
  composer: (dockPosition: ComposerDockState) => ReactNode;
  /**
   * D-HUX13 — "centered" (default): the fresh-session invitation. "docked": the ONE-TIME
   * transition target, set by the caller exactly once (right when the first message sends) or from
   * the very first render (a reopened session with existing history — D-HUX13's "sessions with
   * history start docked", no animation since there is no prior state to transition FROM within
   * this mount). Once this component has rendered "docked" it STAYS docked even if the prop later
   * reports "centered" again — the choreography runs once per session, not a toggle.
   */
  dockState?: ComposerDockState;
  /**
   * WP4.2 (WP1.R-C) — reports the docked composer's measured height (px, border-box) whenever it
   * changes (a `ResizeObserver` on the composer wrap: multi-line growth, attachment chips, the
   * running Stop button). The caller (`AssistantView`) turns this into the transcript's bottom
   * clearance (`composerClearancePx`) so a tall composer never covers the last message — the fixed
   * `h-40` reserve WP1.8 used under-reserves. Optional: a caller that doesn't float a composer over
   * a scrolling transcript (or a test) simply omits it and no observer is wired.
   */
  onComposerHeightChange?: (heightPx: number) => void;
  className?: string;
}

/**
 * Assistant Hub (WP1.3, D-HUX13) — the fresh-session invitation: a centered greeting, starter
 * `Suggestions` chips, and the composer itself, all sliding/fading together to the docked position
 * on the first send. Meant to be layered ON TOP of `ChatCanvas` (which supplies the dot-grid
 * background behind it and the transcript region below it) by the caller — this component paints
 * no background of its own, so the canvas's grid shows through the space around it.
 *
 * Layout: the greeting cluster (welcome emblem + heading + subtitle) is centered in the UPPER region
 * of the canvas, DECOUPLED from the composer, so the emblem can be large and sit high up. The
 * composer + its starter chips are a separate block pinned near the bottom.
 *
 * Motion spec (matches the concept's live demo): ONE property carries the composer's position — a
 * `transform: translateY(…)` on the composer block, ~240 ms on the app's standard transition
 * (`choreographyTransitionClass`, transform-only, compositor friendly) — while the greeting cluster
 * and chips ALSO fade via `opacity` over 200 ms so they visually settle away as the composer moves
 * (the greeting fades in place up top; the composer glides down beneath it).
 *
 * `motion-reduce` is a hard rule, not a nicety (D-HUX13) — but it governs ANIMATION ONLY, never
 * CONTENT: `useReducedMotion` (`@elabs-ai/components-tokens`, provider-optional) drops the transform/opacity
 * transitions (the slide + fade play instantly instead of over ~240/200ms) while leaving the dock
 * STATE exactly as it would otherwise be — a fresh reduced-motion session still opens with the
 * greeting + starter chips (visible, interactive, never `aria-hidden`), just with no glide; a
 * history session still starts docked instantly, same as always. `EmptySessionIntro` is the SOLE
 * host of the greeting + starters (the caller suppresses `ConversationPane`'s own generic empty
 * state once this is wired in — see `hideGenericEmptyState`), so hiding content here on top of
 * suppressing it there would leave a reduced-motion user with nothing at all — a real a11y defect,
 * not just a missed animation.
 */
export function EmptySessionIntro({
  title = "What should we dig into?",
  subtitle = "Chat, research, or a mission. Your MCP servers and skills are ready.",
  starters = HUB_STARTER_SUGGESTIONS,
  onSelectStarter,
  composer,
  dockState = "centered",
  onComposerHeightChange,
  className,
}: EmptySessionIntroProps) {
  // The choreography runs ONCE per session: once docked, stay docked even if a caller reports
  // "centered" again later (a bug elsewhere shouldn't re-open the invitation mid-conversation).
  const dockedRef = useRef(dockState === "docked");
  if (dockState === "docked") dockedRef.current = true;

  // WP4.2 (WP1.R-C) — measure the composer wrap's real height so the caller can reserve matching
  // transcript clearance for the FLOATING docked composer. The wrap's border box is exactly the
  // composer (the greeting cluster is a separate sibling entirely, and the chips are absolutely
  // positioned OFF this box at `top-full`, so neither is in it; `translateY` doesn't change the
  // box), so its `offsetHeight` is the composer's height in either dock state. Reports once
  // synchronously on mount (the only signal under jsdom's no-op ResizeObserver polyfill) and again
  // on every observed resize.
  const composerWrapRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = composerWrapRef.current;
    if (!el || !onComposerHeightChange) return;
    const report = () => onComposerHeightChange(el.offsetHeight);
    report();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(report);
    observer.observe(el);
    return () => observer.disconnect();
  }, [onComposerHeightChange]);

  // The dock STATE is driven purely by `dockedRef` — reduced motion must never hide content, only
  // the animation that carries a state CHANGE (see `animate` below). A fresh reduced-motion session
  // therefore still renders "centered" (greeting + chips shown, interactive, not aria-hidden); a
  // history session still renders "docked" from its first paint, exactly as without this hook.
  const resolvedState: ComposerDockState = dockedRef.current ? "docked" : "centered";
  const isDocked = resolvedState === "docked";

  // Reduced motion drops ONLY the transition — no transform/opacity animation plays, so a state
  // change (centered -> docked on first send) snaps instantly instead of gliding over ~240/200ms.
  const prefersReducedMotion = useReducedMotion();
  const animate = !prefersReducedMotion;

  const composerOffset = isDocked ? 0 : -CHOREOGRAPHY_CENTER_TO_DOCK_OFFSET_PX;

  return (
    <div
      className={cn(
        "pointer-events-none absolute inset-0 flex flex-col overflow-hidden",
        className,
      )}
      data-testid="empty-session-intro"
      data-dock-state={resolvedState}
    >
      {/* Greeting cluster — DECOUPLED from the composer and centered in the UPPER region of the
          canvas (from the top down to a fixed reserve that clears the composer band). Decoupling is
          what lets the welcome emblem be BIG *and* sit high up: when the greeting was pinned directly
          above a near-bottom composer, "bigger ring" and "higher text" fought each other and the
          whole invitation sat low. It still fades out on the first send (opacity) while the composer
          glides down beneath it — the composer remains the one element whose POSITION animates
          (D-HUX13). Container is `pointer-events-none` so it never blocks the empty upper canvas;
          only the ring opts back in (for its hover flourish). Decorative — aria-hidden here, the
          greeting copy carries the meaning. */}
      <div
        className={cn(
          "pointer-events-none absolute inset-x-0 top-0 bottom-72 flex flex-col items-center justify-center px-4 text-center",
          animate && "transition-opacity duration-200",
          isDocked && "opacity-0",
        )}
        aria-hidden={isDocked}
        data-testid="empty-session-intro-greeting"
      >
        <CognitiveRing
          size="clamp(240px, 44vh, 460px)"
          paused={isDocked}
          // Only opt back into pointer events while CENTERED (for the ring's hover flourish). When
          // DOCKED the ring is opacity-0 but still painted OVER the transcript — keeping it
          // `pointer-events-auto` there makes the invisible ring swallow wheel/click events across the
          // center of the conversation, so the transcript "won't scroll" wherever the cursor sits on
          // it. `pointer-events` inherits, so `none` here also frees every inner `cr-*` layer.
          className={cn("mb-5", isDocked ? "pointer-events-none" : "pointer-events-auto")}
        />
        <Heading level={2} className="text-balance">
          {title}
        </Heading>
        <Text tone="muted" className="max-w-md text-pretty">
          {subtitle}
        </Text>
      </div>

      <div
        ref={composerWrapRef}
        className={cn(
          // `z-20` keeps the docked composer's opaque card ABOVE the transcript's bottom fade scrim
          // (`ConversationPane`, `z-10`) so its card edge stays crisp instead of being tinted by the
          // fade — the run console's `ChatShell variant="bare"` layers its composer over the scrim the
          // same way.
          "pointer-events-auto absolute inset-x-0 bottom-6 z-20 px-4",
          // Share the transcript's reading column so the composer lines up under the conversation.
          CHAT_READING_COLUMN_CLASS,
          animate && choreographyTransitionClass(),
        )}
        style={{ transform: `translateY(${composerOffset}px)` }}
        data-testid="empty-session-intro-composer-wrap"
      >
        {composer(resolvedState)}

        {/* Starter chips sit ABSOLUTELY off the composer's own box (below it) so their presence never
            shifts the composer's docked anchor at `bottom-6` — only their opacity changes. */}
        <div
          className={cn(
            "absolute inset-x-4 top-full mt-3",
            animate && "transition-opacity duration-200",
            isDocked && "pointer-events-none opacity-0",
          )}
          aria-hidden={isDocked}
        >
          <Suggestions className="justify-center">
            {starters.map((starter) => (
              <Suggestion key={starter} suggestion={starter} onClick={onSelectStarter} />
            ))}
          </Suggestions>
        </div>
      </div>
    </div>
  );
}
