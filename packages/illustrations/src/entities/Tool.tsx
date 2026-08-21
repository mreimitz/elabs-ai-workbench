// ==================================================================================================
// Tool — a socketed module (tier 1, entity `mcp_tool_scans`)
// ==================================================================================================
// One entry in an MCP server's advertised surface: a name, a description and an input schema, which
// together are the thing this app measures. Research 5 calls it "a small socketed module on the
// server", and the word that does the work is MODULE — a tool is a PART, not a machine. So it gets
// a one-tier ground pad rather than the two-tier plinth every station stands on, no rack slots and
// no status column: the whole read is "this plugs into something else".
//
// THE JOINT (WP 1.2's "get the geometry honest now"). `plug` here and `mcp-server`'s `bus` are the
// same joint seen from two sides, and that is stated where a scene can actually use it: both are
// declared on the `bottom` side at the same `-1.8` offset, so the connector router leaves both
// bodies from the same edge at the same place along it. `Tool.test.tsx` asserts the two entries
// against each other rather than against a number written twice.
//
// The drawn plug is a CARD-EDGE CONNECTOR on the front face, not a spigot standing at the port's
// world coordinate. That is D-IL7 taken seriously: a drawing never publishes a coordinate, so the
// joint lives in the entry and the drawing only has to READ as a thing that sockets in. A spigot
// pinned to x = -1.8 would also be 5 px wide at `s` and lost inside the pad at `l`, which is what
// happens whenever a drawing tries to be a coordinate.
//
// FACELESS (D-IL17): a module has a connector edge, not a gaze. The connector names the `left` face
// outright, so a request to face downstream leaves it exactly where it is.

import type { IllustrationRegistryEntry, IllustrationSize } from "@mcp-token-footprint/shared";
import type { ReactElement } from "react";
import { type IsoBox, faceExtent, fmt, footprintUnits } from "../iso-math.js";
import { ILLUS_STROKE_DETAIL_FINE } from "../line-system.js";
import { ConstructionGhost } from "../primitives/ConstructionGhost.js";
import { EntityRoot } from "../primitives/EntityRoot.js";
import { GlyphFrame } from "../primitives/GlyphFrame.js";
import { IsoHousing } from "../primitives/IsoHousing.js";
import { IsoPlatform, platformHeight } from "../primitives/IsoPlatform.js";
import type { EntityComponentProps } from "./entity-props.js";

/**
 * `plug` carries the joint (see the header). `invoke-in` and `result-out` are the pair a scene
 * actually draws through a tool — a call goes in, a result comes back — and both sit at a 1.4-unit
 * offset so the gallery's port overlay does not stack them on the plain `left`/`right` cardinals.
 * 1.4 is inside the footprint at every size (the smallest, `s`, has a half-extent of 2).
 */
export const toolMeta: IllustrationRegistryEntry = {
  id: "tool",
  title: "Tool",
  entity: "mcp_tool_scans",
  tier: 1,
  keywords: ["tool", "module", "socket", "schema", "definition", "invoke", "surface"],
  variants: [],
  states: ["idle", "active", "highlight", "dimmed", "error"],
  ports: {
    top: { title: "Top", side: "top" },
    bottom: { title: "Bottom", side: "bottom" },
    left: { title: "Left", side: "left" },
    right: { title: "Right", side: "right" },
    // The same side and the same offset as `mcp-server`'s `bus` — one joint, two sides of it.
    plug: { title: "Plug", side: "bottom", offset: -1.8 },
    "invoke-in": { title: "Invoke in", side: "left", offset: -1.4 },
    "result-out": { title: "Result out", side: "right", offset: 1.4 },
  },
  sizes: ["s", "m", "l"],
  since: "0.1.0",
  description:
    "A tool: a low module on a ground pad, its front face a keyed card-edge connector — the part that sockets into the tool bus of an MCP server.",
};

export type ToolProps = EntityComponentProps;

/** One tier: a part sits on a pad, not on a monument. */
const PLATFORM_TIERS = 1;
const FLOOR = platformHeight(PLATFORM_TIERS);

// Fractions of the footprint, so S/M/L are one drawing at three scales.
const MODULE_WIDTH = 0.44;
const MODULE_HEIGHT = 0.2;

function moduleBox(footprint: number): IsoBox {
  const side = footprint * MODULE_WIDTH;
  return { cx: 0, cy: 0, w: side, d: side, z0: FLOOR, h: footprint * MODULE_HEIGHT };
}

export function toolHeightUnits(size: IllustrationSize): number {
  return FLOOR + footprintUnits(size) * MODULE_HEIGHT;
}

export function Tool({
  size = "m",
  state = "idle",
  facing = "upstream",
  detail = "standard",
  variant,
  label,
  showPorts = false,
  idPrefix,
}: ToolProps): ReactElement {
  const footprint = footprintUnits(size);
  const shell = moduleBox(footprint);
  const accent = state === "error" ? "var(--illus-error)" : "var(--illus-accent)";

  return (
    <EntityRoot
      meta={toolMeta}
      size={size}
      state={state}
      facing={facing}
      detail={detail}
      variant={variant}
      label={label}
      heightUnits={toolHeightUnits(size)}
      showPorts={showPorts}
      idPrefix={idPrefix}
    >
      <ConstructionGhost width={footprint} depth={footprint} />
      <IsoPlatform tiers={PLATFORM_TIERS} footprint={size} />
      <IsoHousing width={shell.w} depth={shell.d} height={shell.h} z0={shell.z0} />
      <EdgeConnector box={shell} accent={accent} />
    </EntityRoot>
  );
}

Tool.illusLayer = "structure" as const;
Tool.entityHeightUnits = toolHeightUnits;

/**
 * The module's front face: a row of contact fingers with a KEY standing proud of them. The key is
 * the entity's ONE accent moment (D-IL6) — it is the part that says which way round the module goes
 * in, which is the whole reason a card edge is keyed, and lighting the fingers as well would turn
 * one part into six places for the eye to go.
 */
function EdgeConnector({ box, accent }: { box: IsoBox; accent: string }): ReactElement {
  const { width, height } = faceExtent(box, "left");
  const inset = Math.min(width, height) * 0.16;
  const innerWidth = width - inset * 2;
  const fingers = [0, 1, 2, 3, 4];
  const fingerGap = innerWidth / fingers.length;
  const fingerWidth = fingerGap * 0.62;
  const fingerHeight = height * 0.3;
  const fingerTop = height - inset - fingerHeight;
  const keyWidth = fingerGap * 0.46;

  return (
    <GlyphFrame face="left" box={box}>
      {/* The seam the module's shell parts along — an interior edge, so the finest weight. */}
      <line
        x1={fmt(inset)}
        y1={fmt(fingerTop - height * 0.14)}
        x2={fmt(width - inset)}
        y2={fmt(fingerTop - height * 0.14)}
        strokeWidth={ILLUS_STROKE_DETAIL_FINE}
        style={{ stroke: "var(--illus-ink-muted)" }}
      />
      {fingers.map((finger) => (
        <rect
          key={`finger-${finger}`}
          x={fmt(inset + finger * fingerGap + (fingerGap - fingerWidth) / 2)}
          y={fmt(fingerTop)}
          width={fmt(fingerWidth)}
          height={fmt(fingerHeight)}
          style={{ fill: "var(--illus-ink-muted)" }}
        />
      ))}
      <rect
        data-illus-mark="connector-key"
        x={fmt(inset + fingerGap * 2 + (fingerGap - keyWidth) / 2)}
        y={fmt(fingerTop - fingerHeight * 0.34)}
        width={fmt(keyWidth)}
        height={fmt(fingerHeight * 1.34)}
        rx={fmt(keyWidth / 2)}
        style={{ fill: accent }}
      />
    </GlyphFrame>
  );
}
