// ==================================================================================================
// Prompt — a speech bubble on a display plinth (tier 1, entity `tests`)
// ==================================================================================================
// What starts a run: the message an operator writes, or the standing instruction the harness sends
// ahead of it. Research 5 calls it "speech bubble on a display", and the display half matters as
// much as the bubble — a prompt in this app is a SAVED thing (a `tests` row), not a passing remark,
// so it is mounted on a post rather than floating.
//
// FACELESS (D-IL17). This one is the closest call in WP 1.1's five: a board obviously has a front.
// But `facing` is about GAZE — a character turning to look at the work — and a mounted placard does
// not turn. WP 1.1's table puts `prompt` with the faceless entities, so the board names the `left`
// face outright and a request to face downstream leaves it where it is. Its own contract test pins
// that, exactly as `McpServer`'s does.
//
// Both variants stand the same height. `heightUnits` is what every port anchor is measured against
// (D-IL7); the tail on the `user` variant hangs BELOW the board on the same face plane, which is
// where a speech-bubble tail belongs and is not part of the declared height.

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
 * `emit` is the one semantic port: a prompt has nothing coming in, only something going out. It sits
 * at a 1.4-unit offset so the gallery's port overlay does not stack it on the `right` cardinal.
 */
export const promptMeta: IllustrationRegistryEntry = {
  id: "prompt",
  title: "Prompt",
  entity: "tests",
  tier: 1,
  keywords: ["prompt", "message", "instruction", "speech bubble", "input", "user", "system"],
  variants: ["user", "system"],
  states: ["idle", "active", "highlight", "dimmed", "error"],
  ports: {
    top: { title: "Top", side: "top" },
    bottom: { title: "Bottom", side: "bottom" },
    left: { title: "Left", side: "left" },
    right: { title: "Right", side: "right" },
    emit: { title: "Emit", side: "right", offset: 1.4 },
  },
  sizes: ["s", "m", "l"],
  since: "0.1.0",
  description:
    "A prompt: a message board raised on a display post, spoken with a tail when it comes from a person and bracketed like a fixed placard when it is a standing system instruction.",
};

export const PROMPT_VARIANTS = ["user", "system"] as const;
export type PromptVariant = (typeof PROMPT_VARIANTS)[number];

export type PromptProps = EntityComponentProps;

function resolveVariant(variant: string | undefined): PromptVariant {
  return PROMPT_VARIANTS.includes(variant as PromptVariant) ? (variant as PromptVariant) : "user";
}

const PLATFORM_TIERS = 2;
const FLOOR = platformHeight(PLATFORM_TIERS);

// Fractions of the footprint, so S/M/L are one drawing at three scales.
const POST_WIDTH = 0.14;
const POST_HEIGHT = 0.19;
const BOARD_WIDTH = 0.6;
/** The board is a BOARD: thin along y, so its wide face is the one the message is printed on. */
const BOARD_DEPTH = 0.14;
const BOARD_HEIGHT = 0.3;

function postBox(footprint: number): IsoBox {
  const side = footprint * POST_WIDTH;
  return { cx: 0, cy: 0, w: side, d: side, z0: FLOOR, h: footprint * POST_HEIGHT };
}

function boardBox(footprint: number): IsoBox {
  const post = postBox(footprint);
  return {
    cx: 0,
    cy: 0,
    w: footprint * BOARD_WIDTH,
    d: footprint * BOARD_DEPTH,
    z0: post.z0 + post.h,
    h: footprint * BOARD_HEIGHT,
  };
}

export function promptHeightUnits(size: IllustrationSize): number {
  const board = boardBox(footprintUnits(size));
  return board.z0 + board.h;
}

export function Prompt({
  size = "m",
  state = "idle",
  facing = "upstream",
  detail = "standard",
  variant,
  label,
  showPorts = false,
  idPrefix,
}: PromptProps): ReactElement {
  const resolved = resolveVariant(variant);
  const footprint = footprintUnits(size);
  const post = postBox(footprint);
  const board = boardBox(footprint);
  const accent = state === "error" ? "var(--illus-error)" : "var(--illus-accent)";

  return (
    <EntityRoot
      meta={promptMeta}
      size={size}
      state={state}
      facing={facing}
      detail={detail}
      variant={resolved}
      label={label}
      heightUnits={promptHeightUnits(size)}
      showPorts={showPorts}
      idPrefix={idPrefix}
    >
      <ConstructionGhost width={footprint} depth={footprint} />
      <IsoPlatform tiers={PLATFORM_TIERS} footprint={size} />
      <IsoHousing
        width={post.w}
        depth={post.d}
        height={post.h}
        z0={post.z0}
        weight="detail-fine"
      />
      <IsoHousing width={board.w} depth={board.d} height={board.h} z0={board.z0} />
      <Message box={board} variant={resolved} accent={accent} />
    </EntityRoot>
  );
}

Prompt.illusLayer = "structure" as const;
Prompt.entityHeightUnits = promptHeightUnits;

/**
 * The message printed on the board's front face: a heading bar — the entity's ONE accent moment
 * (D-IL6) — and two body rules standing in for text. Text is never set on an iso face (D-IL2), the
 * way a drafting elevation shows a hatched block rather than lettering.
 *
 * The variant changes how the message is ATTACHED, which is the honest difference between the two:
 *
 *   `user`    a tail hangs off the bottom edge — somebody said this.
 *   `system`  two corner brackets clamp the top edge — this is mounted, and it does not speak.
 *
 * Both are drawn on the same face plane, so neither changes the board or the declared height.
 */
function Message({
  box,
  variant,
  accent,
}: {
  box: IsoBox;
  variant: PromptVariant;
  accent: string;
}): ReactElement {
  const { width, height } = faceExtent(box, "left");
  const inset = Math.min(width, height) * 0.17;
  const innerWidth = width - inset * 2;
  const headingHeight = Math.max(2.2, (height - inset * 2) * 0.2);
  const ruleHeight = Math.max(1.4, headingHeight * 0.42);
  const ruleGap = (height - inset * 2 - headingHeight - ruleHeight * 2) / 3;
  const tailWidth = innerWidth * 0.2;
  const bracket = Math.max(4, innerWidth * 0.16);

  return (
    <GlyphFrame face="left" box={box}>
      <rect
        x={fmt(inset)}
        y={fmt(inset)}
        width={fmt(innerWidth * 0.58)}
        height={fmt(headingHeight)}
        rx={fmt(headingHeight / 2)}
        style={{ fill: accent }}
      />
      {[0, 1].map((rule) => (
        <rect
          key={`rule-${rule}`}
          x={fmt(inset)}
          y={fmt(inset + headingHeight + ruleGap * (rule + 1) + ruleHeight * rule)}
          width={fmt(innerWidth * (rule === 0 ? 1 : 0.66))}
          height={fmt(ruleHeight)}
          rx={fmt(ruleHeight / 2)}
          style={{ fill: "var(--illus-ink-muted)" }}
        />
      ))}
      {variant === "user" ? (
        <polygon
          data-illus-mark="speech-tail"
          points={[
            [inset, height],
            [inset + tailWidth, height],
            [inset + tailWidth * 0.35, height + tailWidth * 0.8],
          ]
            .map(([px, py]) => `${fmt(px as number)},${fmt(py as number)}`)
            .join(" ")}
          strokeWidth={ILLUS_STROKE_DETAIL}
          strokeLinejoin="round"
          style={{ fill: "var(--illus-face-left)", stroke: "var(--illus-ink)" }}
        />
      ) : (
        (["start", "end"] as const).map((corner) => (
          <polyline
            key={`bracket-${corner}`}
            data-illus-mark="placard-bracket"
            points={[
              [corner === "start" ? inset * 0.4 + bracket : width - inset * 0.4 - bracket, inset * 0.4],
              [corner === "start" ? inset * 0.4 : width - inset * 0.4, inset * 0.4],
              [corner === "start" ? inset * 0.4 : width - inset * 0.4, inset * 0.4 + bracket],
            ]
              .map(([px, py]) => `${fmt(px as number)},${fmt(py as number)}`)
              .join(" ")}
            fill="none"
            strokeWidth={ILLUS_STROKE_DETAIL_FINE}
            strokeLinecap="round"
            style={{ stroke: "var(--illus-ink-muted)" }}
          />
        ))
      )}
    </GlyphFrame>
  );
}
