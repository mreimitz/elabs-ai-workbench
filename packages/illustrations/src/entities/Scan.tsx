// ==================================================================================================
// Scan — a scanner arch (tier 2, entity `mcp_scans`)
// ==================================================================================================
// One discovery pass over an MCP server: `initialize`, `tools/list`, `resources/list`,
// `prompts/list`, and the token accounting over what came back. Research 5 calls it a "scanner arch
// over a server", and WP 1.2 turns that into the drawing's one hard requirement: AN ARCH IS A HOLE.
// This is the only entity in the catalog that has to read correctly with ANOTHER entity standing
// inside it, so the opening has to be real at all three footprints rather than implied.
//
// TWO CONSEQUENCES, both deliberate and both unlike every other entity so far:
//
//   • NO PLATFORM. Every other entity stands on an `IsoPlatform`; this one cannot, because the
//     ground under the opening is where the subject stands. A plinth here would either hold the
//     subject up off its own plinth or be drawn straight through by it. The legs stand on the
//     ground plane, which is what "straddling" means.
//   • THE CLEARANCE IS PUBLISHED. {@link scanClearance} is a pure function of the size, exported
//     so a scene can ask what fits under this arch instead of eyeballing it, and so
//     `Scan.test.tsx` can measure it against `mcp-server`'s real footprint and height rather than
//     against a number copied into the test. Phase 2's layout engine is the other consumer.
//
// THE FOOTPRINT FINDING, reported rather than fudged (WP 1.2 asks for exactly this). The legs must
// live inside the arch's own quantized footprint, so the clear span is the footprint MINUS two legs
// — 0.8 of it. A same-size subject therefore never fits: at `l` the arch's span is 6.4 units and an
// `l` server's bottom plinth tier is 8. What DOES fit at `l` is an `l` server's rack (4 units) and
// its full height (4.8 against 5.6 of headroom), and an `m` server ENTIRELY (bottom tier 6 < 6.4).
// The rule that follows is a scene-layout rule, not a drawing one: draw a scan one size tier above
// its subject. That is a Phase 2 finding, and shrinking the subject to make the picture work would
// have hidden it.
//
// FACELESS (D-IL17): an arch is symmetric about the axis its subject travels along, so there is no
// front to mount and nothing for `facing` to move.

import type { IllustrationRegistryEntry, IllustrationSize } from "@mcp-token-footprint/shared";
import type { ReactElement } from "react";
import { fmt, footprintUnits, project } from "../iso-math.js";
import { ILLUS_STROKE_DETAIL } from "../line-system.js";
import { ConstructionGhost } from "../primitives/ConstructionGhost.js";
import { EntityRoot } from "../primitives/EntityRoot.js";
import { IsoHousing } from "../primitives/IsoHousing.js";
import { platformHeight } from "../primitives/IsoPlatform.js";
import type { EntityComponentProps } from "./entity-props.js";

/**
 * `subject-under` is where the thing being scanned stands, and `result-out` is where the report
 * leaves. Both carry an offset so the gallery's port overlay does not stack them on the plain
 * `bottom`/`right` cardinals — `subject-under` is nudged along the front edge for that reason alone,
 * and the true centre of the opening is {@link scanClearance}'s business, not a port's (D-IL7: a
 * drawing never publishes a coordinate). 1.4 is inside the footprint at every size.
 */
export const scanMeta: IllustrationRegistryEntry = {
  id: "scan",
  title: "Scan",
  entity: "mcp_scans",
  tier: 2,
  keywords: ["scan", "discovery", "arch", "gantry", "inventory", "measure", "footprint"],
  variants: [],
  states: ["idle", "active", "highlight", "dimmed", "error"],
  ports: {
    top: { title: "Top", side: "top" },
    bottom: { title: "Bottom", side: "bottom" },
    left: { title: "Left", side: "left" },
    right: { title: "Right", side: "right" },
    "subject-under": { title: "Subject under", side: "bottom", offset: 1.4 },
    "result-out": { title: "Result out", side: "right", offset: 1.4 },
  },
  sizes: ["s", "m", "l"],
  since: "0.1.0",
  description:
    "A scan: a gantry arch straddling the ground plane, its head unit casting a lit measuring line across the opening — the pass that takes the whole surface of a server at once.",
};

export type ScanProps = EntityComponentProps;

// Fractions of the footprint, so S/M/L are one drawing at three scales.
/** The posts, thin enough to keep the opening wide and thick enough to read as structure. */
const LEG_THICKNESS = 0.1;
/** The head unit spanning them; slightly wider than a post so it caps them rather than meeting. */
const BEAM_WIDTH = 0.13;
const BEAM_HEIGHT = 0.1;
/**
 * How far the head unit is lifted above the ground, in units: the same two-tier plinth every
 * station stands on, plus 0.55 of the footprint. That 0.55 is deliberately more than the 0.45 an
 * `mcp-server`'s rack takes, so a same-size server clears the beam with room to spare — the height
 * is the one dimension where a same-size subject DOES fit.
 */
const HEADROOM_BASE = platformHeight(2);
const HEADROOM_PER_UNIT = 0.55;

function headroomUnits(footprint: number): number {
  return HEADROOM_BASE + footprint * HEADROOM_PER_UNIT;
}

export type ScanClearance = {
  /** The clear gap between the legs' inner faces, in grid units. */
  readonly span: number;
  /** The clear height under the head unit, in grid units. */
  readonly headroom: number;
};

/**
 * What fits under a scan of this size. Exported because the alternative — a scene author measuring
 * an arch by looking at it — is how a subject ends up drawn through a leg, and because it is the
 * honest way to state the footprint finding in the header as something a test can check.
 */
export function scanClearance(size: IllustrationSize): ScanClearance {
  const footprint = footprintUnits(size);
  return {
    span: footprint - footprint * LEG_THICKNESS * 2,
    headroom: headroomUnits(footprint),
  };
}

export function scanHeightUnits(size: IllustrationSize): number {
  const footprint = footprintUnits(size);
  return headroomUnits(footprint) + footprint * BEAM_HEIGHT;
}

export function Scan({
  size = "m",
  state = "idle",
  facing = "upstream",
  detail = "standard",
  variant,
  label,
  showPorts = false,
  idPrefix,
}: ScanProps): ReactElement {
  const footprint = footprintUnits(size);
  const legThickness = footprint * LEG_THICKNESS;
  const headroom = headroomUnits(footprint);
  const accent = state === "error" ? "var(--illus-error)" : "var(--illus-accent)";
  // The legs sit flush inside the footprint's two extremes along y, so the arch's silhouette is
  // exactly the footprint it declares and a scene can place it like any other station.
  const legCentre = footprint / 2 - legThickness / 2;

  return (
    <EntityRoot
      meta={scanMeta}
      size={size}
      state={state}
      facing={facing}
      detail={detail}
      variant={variant}
      label={label}
      heightUnits={scanHeightUnits(size)}
      showPorts={showPorts}
      idPrefix={idPrefix}
    >
      <ConstructionGhost width={footprint} depth={footprint} />
      {/* Back leg first, front leg second: they are both `structure`, so layer order cannot separate
          them and document order has to. The head unit is entirely above both, so it never has to
          compete with either. */}
      {([-1, 1] as const).map((sign) => (
        <IsoHousing
          key={`leg-${sign}`}
          width={legThickness}
          depth={legThickness}
          height={headroom}
          cy={sign * legCentre}
          z0={0}
        />
      ))}
      <IsoHousing
        width={footprint * BEAM_WIDTH}
        depth={footprint}
        height={footprint * BEAM_HEIGHT}
        z0={headroom}
      />
      <MeasuringLine footprint={footprint} headroom={headroom} accent={accent} />
    </EntityRoot>
  );
}

Scan.illusLayer = "structure" as const;
Scan.entityHeightUnits = scanHeightUnits;

/**
 * The lit line the head unit casts straight down the opening — the entity's ONE accent moment
 * (D-IL6), and the only mark that distinguishes a scanner from a doorway. It runs between the legs'
 * inner faces at the beam's underside, so it is exactly as wide as {@link scanClearance} says the
 * arch is clear: the accent and the geometry are the same statement.
 *
 * A `<line>` rather than a glyph on a face, because it is not printed ON anything — it hangs in the
 * opening, which is a place no `GlyphFrame` describes.
 */
function MeasuringLine({
  footprint,
  headroom,
  accent,
}: {
  footprint: number;
  headroom: number;
  accent: string;
}): ReactElement {
  const reach = footprint / 2 - footprint * LEG_THICKNESS;
  const from = project(0, -reach, headroom);
  const to = project(0, reach, headroom);
  return (
    <line
      data-illus-mark="measuring-line"
      x1={fmt(from.x)}
      y1={fmt(from.y)}
      x2={fmt(to.x)}
      y2={fmt(to.y)}
      strokeWidth={ILLUS_STROKE_DETAIL}
      strokeLinecap="round"
      style={{ stroke: accent }}
    />
  );
}

/** It is a mark cast by the structure, not part of it — so it paints in the detail layer (D-IL16). */
MeasuringLine.illusLayer = "detail" as const;
