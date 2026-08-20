// ==================================================================================================
// McpServer — a rack on a plinth (tier 1, entity `mcp_servers`)
// ==================================================================================================
// The first of the three pilot entities, and the one that proves the boring half of the claim: a
// real component can be built out of WP 0.2's primitives WITHOUT authoring a single new `<path>`.
// Structure is `IsoPlatform` + `IsoHousing`; the rack front is flat art inside a `GlyphFrame`, which
// is the only sanctioned way art gets onto a face (D-IL15). Its own contract test asserts the
// rendered markup contains no `<path>` element at all.
//
// TWO DESIGN NOTES worth reading before changing anything here:
//
//   • It mounts its front panel on the LEFT face EXPLICITLY, never on `gaze`. A server has no face
//     and no gaze, and D-IL17 says a faceless entity IGNORES `facing`. `Agent` in this same folder
//     does the opposite, and the pair is the decision's proof: the agent's panel moves with
//     `facing`, this one does not.
//   • The accent moment MOVES WITH THE VARIANT, and there is still only ever one (D-IL6). On
//     `stdio` it is the status LED on the rack front; on `streamable-http` it is the antenna tip,
//     and the LED goes muted. Lighting both would be two accents on one station.

import type { IllustrationRegistryEntry, IllustrationSize } from "@mcp-token-footprint/shared";
import type { ReactElement } from "react";
import { type IsoBox, faceExtent, fmt, footprintUnits, project } from "../iso-math.js";
import { ILLUS_STROKE_DETAIL, ILLUS_STROKE_DETAIL_FINE } from "../line-system.js";
import { ConstructionGhost } from "../primitives/ConstructionGhost.js";
import { EntityRoot } from "../primitives/EntityRoot.js";
import { GlyphFrame } from "../primitives/GlyphFrame.js";
import { IsoHousing } from "../primitives/IsoHousing.js";
import { IsoPlatform, platformHeight } from "../primitives/IsoPlatform.js";
import type { EntityComponentProps } from "./entity-props.js";

/**
 * The registry entry, exported from the component's own file so the two can never be edited apart.
 * `registry.ts` collects the three metas and validates them against the WP 0.1 zod schema at module
 * load; `McpServer.test.tsx` holds the drawing to this object.
 *
 * The variant is `streamable-http`, NOT the wire's `streamable_http`. `variants` is typed
 * `illustrationIdSchema` — kebab-case — in the shared contract, and the contract is not bent for a
 * drawing. The `entity` binding still carries the snake_case domain name (`mcp_servers`), which is
 * the field that actually points at the app's own table naming.
 */
export const mcpServerMeta: IllustrationRegistryEntry = {
  id: "mcp-server",
  title: "MCP Server",
  entity: "mcp_servers",
  tier: 1,
  keywords: ["server", "mcp", "tools", "stdio", "http", "streamable", "rack", "transport"],
  variants: ["stdio", "streamable-http"],
  states: ["idle", "active", "highlight", "dimmed", "error"],
  ports: {
    top: { title: "Top", side: "top" },
    bottom: { title: "Bottom", side: "bottom" },
    left: { title: "Left", side: "left" },
    right: { title: "Right", side: "right" },
    // Offset along the front-bottom edge so the overlay does not stack it on the `bottom` cardinal.
    // -1.8 is inside the footprint at every size (the smallest, `s`, has a half-extent of 2).
    bus: { title: "Tool bus", side: "bottom", offset: -1.8 },
  },
  sizes: ["s", "m", "l"],
  since: "0.1.0",
  description:
    "An MCP server: a slotted rack on a two-tier plinth, with a status LED on its front panel — an antenna on the streamable-HTTP variant, a local process block on the stdio one.",
};

/**
 * The variants this component actually draws. `MCP_SERVER_VARIANTS` is what the registry entry's
 * `variants` list is HELD TO by the contract test — one declaration, two consumers — and
 * `resolveVariant` is why the prop stays `variant?: string`: every entity has to satisfy the one
 * `EntityComponentProps` shape, or the gallery could not render a component it has never heard of
 * and the scene renderer could not instantiate one from an id. Narrowing the prop per entity makes
 * the components mutually incompatible with that shape, so an unknown variant is DEFAULTED here
 * instead — the same "ignore what you cannot do rather than erroring" rule D-IL16 states for detail
 * levels, applied to variants.
 */
export const MCP_SERVER_VARIANTS = ["stdio", "streamable-http"] as const;
export type McpServerVariant = (typeof MCP_SERVER_VARIANTS)[number];

export type McpServerProps = EntityComponentProps;

function resolveVariant(variant: string | undefined): McpServerVariant {
  return MCP_SERVER_VARIANTS.includes(variant as McpServerVariant)
    ? (variant as McpServerVariant)
    : "stdio";
}

const PLATFORM_TIERS = 2;
/** The top of the plinth: where the rack stands. */
const FLOOR = platformHeight(PLATFORM_TIERS);

// Every dimension below is a FRACTION OF THE FOOTPRINT, which is what makes S/M/L the same drawing
// at three scales rather than three drawings. The plinth's second tier is `footprint - 1.4` wide
// (IsoPlatform's inset), so the rack's 0.5 keeps it comfortably inside at every size: at `s` the
// tier is 2.6 wide and the rack 2.0.
const RACK_WIDTH = 0.5;
const RACK_HEIGHT = 0.45;
/** The antenna on the HTTP variant, above the rack. */
const ANTENNA_HEIGHT = 0.15;
/**
 * The local-process block on the stdio variant, in UNITS rather than as a fraction of the footprint.
 * It sits in the ring between the plinth's two tiers, and `IsoPlatform`'s inset is a fixed 1.4 units
 * at every size, so that ring is 0.7 units wide whether the plinth is S, M or L. A fraction would
 * overhang at `l` and fall off the edge at `s`.
 */
const PLUG_SIDE_UNITS = 0.62;

function rackBox(footprint: number): IsoBox {
  const side = footprint * RACK_WIDTH;
  return { cx: 0, cy: 0, w: side, d: side, z0: FLOOR, h: footprint * RACK_HEIGHT };
}

/** How tall the drawn solid stands, in units — the number ports and viewBoxes are measured against. */
export function mcpServerHeightUnits(size: IllustrationSize): number {
  return FLOOR + footprintUnits(size) * RACK_HEIGHT;
}

export function McpServer({
  size = "m",
  state = "idle",
  facing = "upstream",
  detail = "standard",
  variant,
  label,
  showPorts = false,
  idPrefix,
}: McpServerProps): ReactElement {
  const resolved = resolveVariant(variant);
  const footprint = footprintUnits(size);
  const rack = rackBox(footprint);
  const height = mcpServerHeightUnits(size);
  // `error` recolours the one accent mark rather than adding a second one — the state affordance
  // itself (the dashed ring under the entity) is `EntityRoot`'s, applied identically everywhere.
  const accent = state === "error" ? "var(--illus-error)" : "var(--illus-accent)";
  const http = resolved === "streamable-http";

  return (
    <EntityRoot
      meta={mcpServerMeta}
      size={size}
      state={state}
      facing={facing}
      detail={detail}
      variant={resolved}
      label={label}
      heightUnits={height}
      showPorts={showPorts}
      idPrefix={idPrefix}
    >
      <ConstructionGhost width={footprint} depth={footprint} />
      <IsoPlatform tiers={PLATFORM_TIERS} footprint={size} />
      <IsoHousing width={rack.w} depth={rack.d} height={rack.h} z0={rack.z0} />
      <RackFront box={rack} accent={http ? "var(--illus-ink-muted)" : accent} />
      {http ? (
        <Antenna from={rack.z0 + rack.h} height={footprint * ANTENNA_HEIGHT} accent={accent} />
      ) : (
        <LocalProcess footprint={footprint} />
      )}
    </EntityRoot>
  );
}

McpServer.illusLayer = "structure" as const;
McpServer.entityHeightUnits = mcpServerHeightUnits;

/**
 * The rack's front panel: three drive slots and a three-lamp status column, drawn as flat art on the
 * LEFT face. Art coordinates are plain pixels across and down the face as viewed — `GlyphFrame`
 * supplies the matrix, so nothing here knows it is isometric.
 */
function RackFront({ box, accent }: { box: IsoBox; accent: string }): ReactElement {
  const { width, height } = faceExtent(box, "left");
  const inset = Math.min(width, height) * 0.16;
  const rowHeight = (height - inset * 2) / 3;
  const slotWidth = width * 0.52;
  const slotHeight = rowHeight * 0.46;
  const lampRadius = Math.min(width, height) * 0.052;
  const lampX = width - inset - lampRadius;

  const rows = [0, 1, 2];
  return (
    <GlyphFrame face="left" box={box}>
      {rows.map((row) => (
        <rect
          key={`slot-${row}`}
          x={fmt(inset)}
          y={fmt(inset + row * rowHeight + (rowHeight - slotHeight) / 2)}
          width={fmt(slotWidth)}
          height={fmt(slotHeight)}
          rx={fmt(slotHeight / 2)}
          strokeWidth={ILLUS_STROKE_DETAIL_FINE}
          style={{ fill: "var(--illus-surface-sunken)", stroke: "var(--illus-ink)" }}
        />
      ))}
      {rows.map((row) => (
        <circle
          key={`lamp-${row}`}
          cx={fmt(lampX)}
          cy={fmt(inset + row * rowHeight + rowHeight / 2)}
          r={fmt(lampRadius)}
          // Exactly one lamp is lit — the status lamp. The other two are dark hardware, so the
          // accent budget stays at one moment per station (D-IL6).
          style={{ fill: row === 0 ? accent : "var(--illus-ink-muted)" }}
        />
      ))}
    </GlyphFrame>
  );
}

/** The streamable-HTTP marker: a mast off the rack's top, its tip the entity's accent moment. */
function Antenna({
  from,
  height,
  accent,
}: {
  from: number;
  height: number;
  accent: string;
}): ReactElement {
  const base = project(0, 0, from);
  const tip = project(0, 0, from + height);
  return (
    <g data-illus-mark="antenna">
      <line
        x1={fmt(base.x)}
        y1={fmt(base.y)}
        x2={fmt(tip.x)}
        y2={fmt(tip.y)}
        strokeWidth={ILLUS_STROKE_DETAIL}
        strokeLinecap="round"
        style={{ stroke: "var(--illus-ink)" }}
      />
      <circle cx={fmt(tip.x)} cy={fmt(tip.y)} r={3.4} style={{ fill: accent }} />
    </g>
  );
}

/**
 * The stdio marker: a small block on the plinth's front corner — the child process the server runs
 * as. It sits in the ring between the plinth's two tiers (`footprint/2` out, `(footprint-1.4)/2`
 * in), which is free at every size, so it never rides up onto the rack's own tier.
 */
function LocalProcess({ footprint }: { footprint: number }): ReactElement {
  const side = PLUG_SIDE_UNITS;
  // Midway between the outer edge of tier 1 (footprint - 1.4)/2 and the outer edge of tier 0.
  const at = (footprint - 0.7) / 2;
  return (
    <IsoHousing
      width={side}
      depth={side}
      height={side * 0.9}
      cx={at}
      cy={at}
      z0={platformHeight(1)}
      weight="detail"
    />
  );
}
