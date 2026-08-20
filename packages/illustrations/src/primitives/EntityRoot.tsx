// ==================================================================================================
// EntityRoot — the wrapper every entity is built inside
// ==================================================================================================
// It does five things no entity should have to do for itself, which is exactly why they are here and
// not copied into each entity:
//
//   1. ACCESSIBILITY (D-IL12). `role="img"` with a `<title>` and a `<desc>` taken from the registry
//      entry, so an illustration is never an unlabelled blob in a screen reader.
//   2. STATE (D-IL8). All five states are applied HERE, in one place, so `active` looks the same on
//      an agent as on a server. An entity may add its own accent on top; it never reinvents the set.
//   3. LAYERS (D-IL16). Children are sorted into the fixed paint order. An entity cannot lift itself
//      above the connectors layer by writing its JSX in a different order.
//   4. PORTS (D-IL7). The registry declares a SIDE; this resolves it against the footprint, exposes
//      the anchors, and can draw the dev overlay the gallery uses.
//   5. FRAME (D-IL17). Size, state, variant, facing and footprint go into context, so a `GlyphFrame`
//      deep inside an entity can mount on the gaze face without being handed `facing` by hand.
//
// It renders a `<g>`, not an `<svg>` — an entity has to be placeable inside a scene. The exemplar
// (examples/Agent.example.tsx) renders its own `<svg>` with its own viewBox because it is a
// standalone file with nothing to be placed in; that is the one structural divergence from it, and
// it is the reason WP 0.3's gallery supplies the frame.

import type {
  IllustrationDetailLevel,
  IllustrationFacing,
  IllustrationPortDef,
  IllustrationSize,
  IllustrationState,
} from "@mcp-token-footprint/shared";
import { useId } from "react";
import type { ReactElement, ReactNode } from "react";
import {
  ISO_ELLIPSE_RATIO,
  ISO_KX,
  ISO_KY,
  type IsoPoint,
  type ScreenPoint,
  fmt,
  footprintUnits,
  isoEllipse,
  portAnchor,
  project,
  projectPoint,
} from "../iso-math.js";
import { ILLUS_DASH, ILLUS_STROKE_DETAIL, ILLUS_TEXT } from "../line-system.js";
import { Layer, renderLayers } from "../layers.js";
import { EntityFrameContext, type EntityFrame } from "./entity-frame.js";

/**
 * What `EntityRoot` needs from a registry entry. A full `IllustrationRegistryEntry` satisfies it, so
 * WP 0.3's entities can pass their entry straight through; declaring the narrow shape here means the
 * registry can grow fields without this component caring.
 */
export type EntityMeta = {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly ports: Readonly<Record<string, IllustrationPortDef>>;
};

export type EntityRootProps = {
  meta: EntityMeta;
  size?: IllustrationSize;
  state?: IllustrationState;
  facing?: IllustrationFacing;
  detail?: IllustrationDetailLevel;
  variant?: string;
  /** Screen-aligned, drawn below the entity. Overrides the `<title>` when given. */
  label?: string;
  /** How tall the entity stands, in units — used for port anchoring and the state affordances. */
  heightUnits?: number;
  /** The gallery's port overlay (D-IL7 made visible). */
  showPorts?: boolean;
  /**
   * A stable prefix for the `<title>`/`<desc>` ids. Defaults to React's `useId`, which is unique per
   * instance; pass one explicitly when byte-identical output across trees matters (the export path).
   */
  idPrefix?: string;
  children?: ReactNode;
};

/** How far a state affordance spreads, as a fraction of the footprint's on-screen half-width. */
const SHADOW_SPREAD = 1.4;
const HIGHLIGHT_SPREAD = 1.95;

export function EntityRoot({
  meta,
  size = "m",
  state = "idle",
  facing = "upstream",
  detail = "standard",
  variant,
  label,
  heightUnits = 3,
  showPorts = false,
  idPrefix,
  children,
}: EntityRootProps): ReactElement {
  const generated = useId();
  // React's generated ids carry punctuation that reads badly in an `id` attribute; the alphanumeric
  // part is still unique per instance, which is all that is needed.
  const base = idPrefix ?? `illus-${generated.replace(/[^a-zA-Z0-9]/g, "")}-${meta.id}`;
  const titleId = `${base}-title`;
  const descId = `${base}-desc`;

  const footprint = footprintUnits(size);
  const frame: EntityFrame = { size, state, facing, detail, variant, footprint, heightUnits };

  const ground = project(0.25, 0.25, 0);
  const halfWidth = footprint * ISO_KX;
  const frontY = footprint * ISO_KY;

  return (
    <EntityFrameContext.Provider value={frame}>
      {/* biome-ignore lint/a11y/noInteractiveElementToNoninteractiveRole: an SVG <g> is a grouping
          container, not an interactive element — Biome's rule is written for HTML. `role="img"`
          plus `aria-labelledby` is exactly how SVG-in-ARIA says to expose a drawing with a title
          and a description, and D-IL12 requires every entity to carry both. */}
      <g
        role="img"
        aria-labelledby={`${titleId} ${descId}`}
        data-illus-entity={meta.id}
        data-illus-state={state}
        data-illus-size={size}
        data-illus-facing={facing}
        data-illus-detail={detail}
        data-illus-variant={variant}
        // `dimmed` is the one state that touches the whole entity rather than adding to it: the
        // explain-mode step player uses it as the background tone (D-IL11).
        opacity={state === "dimmed" ? 0.32 : undefined}
      >
        <title id={titleId}>{label ?? meta.title}</title>
        <desc id={descId}>{meta.description}</desc>
        {renderLayers([
          <Layer key="entity-state" name="shadows">
            {groundShadow(ground, halfWidth)}
            {stateAffordance(state, ground, halfWidth)}
          </Layer>,
          children,
          showPorts ? (
            <Layer key="entity-ports" name="annotations">
              {portOverlay(meta.ports, footprint, heightUnits)}
            </Layer>
          ) : null,
          label ? (
            <Layer key="entity-label" name="labels">
              <text
                x={0}
                y={fmt(frontY + 24)}
                fontSize={ILLUS_TEXT.label}
                fontWeight={600}
                textAnchor="middle"
                style={{ fill: "var(--illus-ink)" }}
              >
                {label}
              </text>
            </Layer>
          ) : null,
        ])}
      </g>
    </EntityFrameContext.Provider>
  );
}

EntityRoot.illusLayer = "structure" as const;

/**
 * Resolve every declared port to a world point. Exported because the gallery and, later, the scene
 * router both need it, and because a port that only exists inside a render function is a port
 * nothing can attach to.
 */
export function entityPortAnchors(
  ports: Readonly<Record<string, IllustrationPortDef>>,
  size: IllustrationSize,
  heightUnits: number,
): Record<string, IsoPoint> {
  const footprint = footprintUnits(size);
  const resolved: Record<string, IsoPoint> = {};
  for (const [name, port] of Object.entries(ports)) {
    resolved[name] = portAnchor(port, footprint, heightUnits);
  }
  return resolved;
}

/** The ground shadow: ink at ~7% alpha, flattened by the iso-ellipse rule (research 3.3). */
function groundShadow(at: ScreenPoint, halfWidth: number): ReactElement {
  const ellipse = isoEllipse("top", halfWidth * SHADOW_SPREAD);
  return (
    <ellipse
      data-illus-mark="ground-shadow"
      cx={fmt(at.x)}
      cy={fmt(at.y)}
      rx={fmt(ellipse.rx)}
      ry={fmt(ellipse.ry)}
      style={{ fill: "var(--illus-shadow)" }}
    />
  );
}

/**
 * The four non-default states, each a distinct mark rather than a colour swap, so they survive a
 * greyscale export and a low-quality screen. `dimmed` is handled on the group itself above.
 */
function stateAffordance(
  state: IllustrationState,
  at: ScreenPoint,
  halfWidth: number,
): ReactElement | null {
  if (state === "active") {
    const ellipse = isoEllipse("top", halfWidth * SHADOW_SPREAD * 1.15);
    return (
      <ellipse
        data-illus-mark="active-glow"
        cx={fmt(at.x)}
        cy={fmt(at.y)}
        rx={fmt(ellipse.rx)}
        ry={fmt(ellipse.ry)}
        fillOpacity={0.16}
        style={{ fill: "var(--illus-accent)" }}
      />
    );
  }
  if (state === "highlight") {
    const ellipse = isoEllipse("top", halfWidth * HIGHLIGHT_SPREAD);
    return (
      <ellipse
        data-illus-mark="highlight-spot"
        cx={fmt(at.x)}
        cy={fmt(at.y + 6)}
        rx={fmt(ellipse.rx)}
        ry={fmt(ellipse.ry)}
        fillOpacity={0.28}
        style={{ fill: "var(--illus-accent)" }}
      />
    );
  }
  if (state === "error") {
    const ellipse = isoEllipse("top", halfWidth * SHADOW_SPREAD * 1.1);
    return (
      <ellipse
        data-illus-mark="error-ring"
        cx={fmt(at.x)}
        cy={fmt(at.y)}
        rx={fmt(ellipse.rx)}
        ry={fmt(ellipse.ry)}
        fill="none"
        strokeWidth={ILLUS_STROKE_DETAIL}
        strokeDasharray={ILLUS_DASH.construction}
        style={{ stroke: "var(--illus-error)" }}
      />
    );
  }
  return null;
}

/** The dev/gallery port overlay, drawn from registry metadata — never measured from the DOM. */
function portOverlay(
  ports: Readonly<Record<string, IllustrationPortDef>>,
  footprint: number,
  heightUnits: number,
): ReactElement[] {
  // Each side gets its own label placement, because four labels around one footprint all sitting
  // below their dot is four labels on top of each other.
  const PLACEMENT: Record<
    IllustrationPortDef["side"],
    { dx: number; dy: number; anchor: "start" | "middle" | "end" }
  > = {
    top: { dx: 0, dy: -10, anchor: "middle" },
    bottom: { dx: 0, dy: 16, anchor: "middle" },
    left: { dx: -8, dy: 3.5, anchor: "end" },
    right: { dx: 8, dy: 3.5, anchor: "start" },
  };

  return Object.entries(ports).map(([name, port]) => {
    const at = projectPoint(portAnchor(port, footprint, heightUnits));
    const placement = PLACEMENT[port.side];
    return (
      <g key={name} data-illus-port={name}>
        <circle
          cx={fmt(at.x)}
          cy={fmt(at.y)}
          r={4}
          strokeWidth={1.4}
          style={{ fill: "var(--illus-accent)", stroke: "var(--illus-paper)" }}
        />
        <text
          x={fmt(at.x + placement.dx)}
          y={fmt(at.y + placement.dy)}
          fontSize={ILLUS_TEXT.port}
          textAnchor={placement.anchor}
          paintOrder="stroke"
          strokeWidth={3}
          strokeLinejoin="round"
          style={{ fill: "var(--illus-ink)", stroke: "var(--illus-paper)" }}
        >
          {name}
        </text>
      </g>
    );
  });
}

/** Exported for the gallery's overlay and for tests: the ellipse ratio a shadow is flattened by. */
export const ENTITY_SHADOW_RATIO = ISO_ELLIPSE_RATIO;
