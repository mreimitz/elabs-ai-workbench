// ==================================================================================================
// Provider — the neutral logo-slot housing (tier 1, entity `provider_credentials`)
// ==================================================================================================
// Who serves the model: Anthropic, OpenAI, Google, Ollama, a vendor assistant. The drawing is a
// standing cartouche board on a two-tier plinth, and the cartouche is EMPTY.
//
// THE EMPTY SLOT IS THE DESIGN, not a placeholder somebody forgot to fill. A vendor mark is a colour
// literal's cousin: it dates the moment a brand refreshes, it implies an endorsement nobody agreed
// to, it cannot be themed (a wordmark has its own fixed colours, which is exactly what D-IL5 closes
// off), and it turns one catalogued component into one component per vendor. So the component draws
// the SLOT — the shape a mark would sit in — and a scene says which provider it is in the screen-
// aligned label `EntityRoot` already renders below the entity.
//
// It is FACELESS: the cartouche names the `left` face outright rather than `gaze`, so a request to
// face downstream leaves it exactly where it is (D-IL17). `McpServer` does the same, and `Agent` and
// `Validator` do the opposite; the pair is what makes the decision testable rather than decorative.

import type { IllustrationRegistryEntry, IllustrationSize } from "@mcp-token-footprint/shared";
import type { ReactElement } from "react";
import { type IsoBox, faceExtent, fmt, footprintUnits } from "../iso-math.js";
import { ILLUS_STROKE_DETAIL, ILLUS_STROKE_DETAIL_FINE } from "../line-system.js";
import { ConstructionGhost } from "../primitives/ConstructionGhost.js";
import { EntityRoot } from "../primitives/EntityRoot.js";
import { GlyphFrame } from "../primitives/GlyphFrame.js";
import { IsoHousing } from "../primitives/IsoHousing.js";
import { IsoPlatform, platformHeight } from "../primitives/IsoPlatform.js";
import type { EntityComponentProps } from "./entity-props.js";

/**
 * NO VARIANTS, and that is the same decision as the empty cartouche stated a second way: the thing
 * that differs between one provider and the next is a mark this component refuses to draw, so there
 * is nothing left for a variant to switch. `variants: []` is legal in the WP 0.1 schema and the
 * contract harness handles it — it renders the entity once with `variant: undefined` instead of
 * looping, and skips the "draws every variant differently" assertion.
 *
 * `serves` is the one semantic port: what leaves a provider is service, and it leaves toward the
 * model it serves. It sits at a 1.4-unit offset so the port overlay does not stack it on `right`.
 */
export const providerMeta: IllustrationRegistryEntry = {
  id: "provider",
  title: "Provider",
  entity: "provider_credentials",
  tier: 1,
  keywords: ["provider", "vendor", "api key", "endpoint", "account", "credential", "quota"],
  variants: [],
  states: ["idle", "active", "highlight", "dimmed", "error"],
  ports: {
    top: { title: "Top", side: "top" },
    bottom: { title: "Bottom", side: "bottom" },
    left: { title: "Left", side: "left" },
    right: { title: "Right", side: "right" },
    serves: { title: "Serves", side: "right", offset: 1.4 },
  },
  sizes: ["s", "m", "l"],
  since: "0.1.0",
  description:
    "A model provider: a standing board on a two-tier plinth carrying a deliberately blank cartouche — the slot a vendor mark would occupy, never the mark itself.",
};

export type ProviderProps = EntityComponentProps;

const PLATFORM_TIERS = 2;
const FLOOR = platformHeight(PLATFORM_TIERS);

// Fractions of the footprint, so S/M/L are one drawing at three scales.
const BOARD_WIDTH = 0.5;
const BOARD_DEPTH = 0.5;
const BOARD_HEIGHT = 0.44;

/** The four corners of the slot, as unit coordinates — read by the crop marks below. */
const CORNERS = [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 0, y: 1 },
  { x: 1, y: 1 },
] as const;

function boardBox(footprint: number): IsoBox {
  return {
    cx: 0,
    cy: 0,
    w: footprint * BOARD_WIDTH,
    d: footprint * BOARD_DEPTH,
    z0: FLOOR,
    h: footprint * BOARD_HEIGHT,
  };
}

export function providerHeightUnits(size: IllustrationSize): number {
  return FLOOR + footprintUnits(size) * BOARD_HEIGHT;
}

export function Provider({
  size = "m",
  state = "idle",
  facing = "upstream",
  detail = "standard",
  variant,
  label,
  showPorts = false,
  idPrefix,
}: ProviderProps): ReactElement {
  const footprint = footprintUnits(size);
  const board = boardBox(footprint);
  const accent = state === "error" ? "var(--illus-error)" : "var(--illus-accent)";

  return (
    <EntityRoot
      meta={providerMeta}
      size={size}
      state={state}
      facing={facing}
      detail={detail}
      variant={variant}
      label={label}
      heightUnits={providerHeightUnits(size)}
      showPorts={showPorts}
      idPrefix={idPrefix}
    >
      <ConstructionGhost width={footprint} depth={footprint} />
      <IsoPlatform tiers={PLATFORM_TIERS} footprint={size} />
      <IsoHousing width={board.w} depth={board.d} height={board.h} z0={board.z0} />
      <Cartouche box={board} accent={accent} />
    </EntityRoot>
  );
}

Provider.illusLayer = "structure" as const;
Provider.entityHeightUnits = providerHeightUnits;

/**
 * The blank slot and the rule under it. The rule is the entity's ONE accent moment (D-IL6) — a
 * brand line without a brand — and `error` recolours it rather than adding a second mark.
 *
 * The slot's inner plate is `--illus-surface-sunken` with an ink outline: a recess, drawn the way
 * every other recess in this package is drawn (the rack's drive slots, the figure's visor), so the
 * emptiness reads as a fitting rather than as a missing asset.
 */
function Cartouche({ box, accent }: { box: IsoBox; accent: string }): ReactElement {
  const { width, height } = faceExtent(box, "left");
  const inset = Math.min(width, height) * 0.18;
  const slotWidth = width - inset * 2;
  const slotHeight = (height - inset * 2) * 0.62;
  const ruleHeight = Math.max(1.6, height * 0.045);
  const ruleY = inset + slotHeight + (height - inset * 2 - slotHeight - ruleHeight) / 2;

  return (
    <GlyphFrame face="left" box={box}>
      <rect
        x={fmt(inset)}
        y={fmt(inset)}
        width={fmt(slotWidth)}
        height={fmt(slotHeight)}
        rx={fmt(Math.min(5, slotHeight / 5))}
        strokeWidth={ILLUS_STROKE_DETAIL}
        style={{ fill: "var(--illus-surface-sunken)", stroke: "var(--illus-ink)" }}
      />
      {/* CROP MARKS, one per corner of the slot — the drafting idiom for "artwork is placed here,
          to these edges". An earlier cut drew two vertical ticks in the middle instead, which at
          tile size read as a pause glyph: a mark, which is exactly what this component must not
          show. Corner marks say the same thing without ever becoming a symbol. */}
      {CORNERS.map((corner) => {
        const x = inset + (corner.x === 0 ? 0 : slotWidth);
        const y = inset + (corner.y === 0 ? 0 : slotHeight);
        const arm = Math.min(slotWidth, slotHeight) * 0.16;
        return (
          <polyline
            key={`crop-${corner.x}-${corner.y}`}
            data-illus-mark="crop"
            points={[
              [x + (corner.x === 0 ? arm : -arm), y],
              [x, y],
              [x, y + (corner.y === 0 ? arm : -arm)],
            ]
              .map(([px, py]) => `${fmt(px as number)},${fmt(py as number)}`)
              .join(" ")}
            fill="none"
            strokeWidth={ILLUS_STROKE_DETAIL_FINE}
            strokeLinecap="round"
            style={{ stroke: "var(--illus-ink-muted)" }}
          />
        );
      })}
      <rect
        x={fmt(inset)}
        y={fmt(ruleY)}
        width={fmt(slotWidth * 0.54)}
        height={fmt(ruleHeight)}
        rx={fmt(ruleHeight / 2)}
        style={{ fill: accent }}
      />
    </GlyphFrame>
  );
}
