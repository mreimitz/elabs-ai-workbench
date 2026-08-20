import type {
  IllustrationFacing,
  IllustrationRegistryEntry,
  IllustrationSize,
  IllustrationState,
} from "@mcp-token-footprint/shared";
import {
  ILLUSTRATION_COMPONENTS,
  PaperStage,
  entityViewBox,
} from "@mcp-token-footprint/illustrations";

/**
 * One illustration, framed.
 *
 * An entity renders a `<g>` around the world origin rather than its own `<svg>` — that is what lets
 * the same component be dropped into a scene later (RM-14 WP 2.3) — so something has to supply the
 * frame when it is drawn alone. This is that something, and it is the ONLY place in `apps/web` that
 * does it, so a card, a matrix cell and a future export all crop identically.
 *
 * `frameSize` is the reason it is a component and not three lines inlined at each call site. In the
 * states x sizes matrix, every cell must be framed against the SAME box — otherwise each cell is
 * scaled to fill its own frame and the small footprint renders exactly as large as the large one,
 * which makes the `size` prop look decorative when it is not.
 *
 * The drawing is CONTENT (D-IL14), not a control: inline SVG here does not conflict with
 * `.claude/rules/brand-ui-only.md`, and every piece of chrome around it — the card, the toolbar, the
 * dialog — is `@elabs-ai/components-*`.
 */
export function IllustrationCanvas(props: {
  entry: IllustrationRegistryEntry;
  size: IllustrationSize;
  /** Frame against this footprint instead of `size`, so a row of sizes shares one scale. */
  frameSize?: IllustrationSize;
  state?: IllustrationState;
  variant?: string;
  facing?: IllustrationFacing;
  showPorts?: boolean;
  /** Rendered width in px; the height follows the frame's aspect ratio. */
  width: number;
  /**
   * The accessible name for THIS tile. Required, not optional, so a call site has to decide — the
   * same forcing function `IconButton`'s `label` applies to icon-only controls. A matrix of cells
   * that differ only by state needs "…, error" in the name to be navigable at all; a card whose
   * title sits beside the drawing only needs the title.
   */
  alt: string;
  className?: string;
}) {
  const Component = ILLUSTRATION_COMPONENTS[props.entry.id];
  if (Component === undefined) return null;

  const frameSize = props.frameSize ?? props.size;
  const frame = entityViewBox(frameSize, Component.entityHeightUnits(frameSize));
  const height = Math.round(props.width * (frame.height / frame.width));

  return (
    <svg
      viewBox={frame.viewBox}
      width={props.width}
      height={height}
      className={props.className}
      // The FRAME is what a screen reader meets first, so it carries the accessible name. The entity
      // inside still carries its own `<title>`/`<desc>` from the registry entry, because D-IL12 makes
      // that the COMPONENT's contract and a scene that places it supplies a different frame — but an
      // `img` is a leaf, so only `alt` is announced here and the drawing is never read out twice.
      role="img"
      aria-label={props.alt}
      focusable="false"
    >
      <PaperStage
        x={frame.x}
        y={frame.y}
        width={frame.width}
        height={frame.height}
        crosshair={false}
        registration={false}
      />
      <Component
        size={props.size}
        state={props.state}
        variant={props.variant}
        facing={props.facing}
        showPorts={props.showPorts}
      />
    </svg>
  );
}
