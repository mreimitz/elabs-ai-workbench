// ==================================================================================================
// Validator — the shield figure (tier 1, entity `run_grades`)
// ==================================================================================================
// What checks the work: the auto-rating judge, a grader, a guardrail. Research 5 calls it "shield
// agent", and that is exactly what it is — the same standing figure `Agent` draws, carrying a shield
// on its gaze face instead of the agent's chest plates and antenna.
//
// WP 1.1 §3 asked whether this should be its own component at all, or a `variant` on `agent`. It is
// its own component, for a reason that is about the CATALOG rather than the drawing: the registry is
// what the gallery lists, what the scene validator resolves `node.component` against, and what the
// assistant searches. "Validator" is a thing an operator names and looks for; a costume the agent
// wears would be findable only by somebody who already knew to look under "agent". The shared
// silhouette went into `primitives/IsoFigure.tsx` instead, and `Agent` was refactored onto it — see
// that file's header for what actually moved and what deliberately did not.
//
// It HAS A FACE, so it declares `facing` and honours it (D-IL17): visor and shield both mount on
// `face="gaze"`, so in a left-to-right scene the validator looks toward the work arriving to be
// judged rather than away from it.

import type { IllustrationRegistryEntry, IllustrationSize } from "@mcp-token-footprint/shared";
import type { ReactElement } from "react";
import { type IsoBox, faceExtent, fmt, footprintUnits } from "../iso-math.js";
import { ILLUS_STROKE_DETAIL, ILLUS_STROKE_DETAIL_FINE } from "../line-system.js";
import { ConstructionGhost } from "../primitives/ConstructionGhost.js";
import { EntityRoot } from "../primitives/EntityRoot.js";
import { GlyphFrame } from "../primitives/GlyphFrame.js";
import { IsoFigure, figureBoxes } from "../primitives/IsoFigure.js";
import { IsoPlatform, platformHeight } from "../primitives/IsoPlatform.js";
import type { EntityComponentProps } from "./entity-props.js";

/**
 * `subject-in` -> `verdict-out` is the sentence this entity exists to draw: something arrives to be
 * judged, a verdict leaves. Both sit at a 1.4-unit offset, clear of the plain `left`/`right`
 * cardinals, so the gallery's port overlay never stacks two dots on one point.
 *
 * The `entity` binding is `run_grades` — the table a verdict is actually written to — rather than
 * the rating-issues registry or the judge settings, both of which are about CONFIGURING a validator
 * rather than being one.
 */
export const validatorMeta: IllustrationRegistryEntry = {
  id: "validator",
  title: "Validator",
  entity: "run_grades",
  tier: 1,
  keywords: ["validator", "grader", "guardrail", "judge", "verdict", "shield", "quality gate"],
  variants: ["grader", "guardrail"],
  states: ["idle", "active", "highlight", "dimmed", "error"],
  ports: {
    top: { title: "Top", side: "top" },
    bottom: { title: "Bottom", side: "bottom" },
    left: { title: "Left", side: "left" },
    right: { title: "Right", side: "right" },
    "subject-in": { title: "Subject in", side: "left", offset: -1.4 },
    "verdict-out": { title: "Verdict out", side: "right", offset: 1.4 },
  },
  sizes: ["s", "m", "l"],
  since: "0.1.0",
  description:
    "A validator: a standing figure on a two-tier plinth carrying a shield on its gaze face — a score mark for a grader, a barrier for a guardrail.",
};

export const VALIDATOR_VARIANTS = ["grader", "guardrail"] as const;
export type ValidatorVariant = (typeof VALIDATOR_VARIANTS)[number];

export type ValidatorProps = EntityComponentProps;

function resolveVariant(variant: string | undefined): ValidatorVariant {
  return VALIDATOR_VARIANTS.includes(variant as ValidatorVariant)
    ? (variant as ValidatorVariant)
    : "grader";
}

const PLATFORM_TIERS = 2;
const FLOOR = platformHeight(PLATFORM_TIERS);

/** The figure's own crown — there is no mast above it, so this IS the entity's height. */
export function validatorHeightUnits(size: IllustrationSize): number {
  return figureBoxes(footprintUnits(size), FLOOR).crown;
}

export function Validator({
  size = "m",
  state = "idle",
  facing = "upstream",
  detail = "standard",
  variant,
  label,
  showPorts = false,
  idPrefix,
}: ValidatorProps): ReactElement {
  const resolved = resolveVariant(variant);
  const footprint = footprintUnits(size);
  const { torso } = figureBoxes(footprint, FLOOR);
  const accent = state === "error" ? "var(--illus-error)" : "var(--illus-accent)";

  return (
    <EntityRoot
      meta={validatorMeta}
      size={size}
      state={state}
      facing={facing}
      detail={detail}
      variant={resolved}
      label={label}
      heightUnits={validatorHeightUnits(size)}
      showPorts={showPorts}
      idPrefix={idPrefix}
    >
      <ConstructionGhost width={footprint} depth={footprint} />
      <IsoPlatform tiers={PLATFORM_TIERS} footprint={size} />
      <IsoFigure footprint={footprint} floor={FLOOR} />
      <Shield box={torso} variant={resolved} accent={accent} />
    </EntityRoot>
  );
}

Validator.illusLayer = "structure" as const;
Validator.entityHeightUnits = validatorHeightUnits;

/**
 * The shield, on the figure's GAZE face, and the entity's ONE accent moment (D-IL6) — the mark
 * inside it, not the shield body, which stays a recessed plate like every other recess here.
 *
 * The variant changes the MARK and nothing else: a grader scores (a chevron, the tick of a passing
 * verdict), a guardrail stops (a bar across the shield). Same shield, same height, same ports — what
 * differs is what the figure is holding it up for.
 *
 * The shield outline is a `<polygon>`, which is a shape element and not a `<path>`: WP 0.3's
 * contract test forbids a hand-drawn path in an entity, and a five-point shield is a polygon in the
 * plainest sense. `faceExtent` is asked for the LEFT face because every box the figure draws is
 * square, so both side faces have identical on-screen extents; `GlyphFrame` decides which one the
 * art actually lands on.
 */
function Shield({
  box,
  variant,
  accent,
}: {
  box: IsoBox;
  variant: ValidatorVariant;
  accent: string;
}): ReactElement {
  const { width, height } = faceExtent(box, "left");
  const shieldWidth = width * 0.62;
  const shieldHeight = height * 0.82;
  const x = (width - shieldWidth) / 2;
  const y = (height - shieldHeight) / 2;
  // A shield: square shoulders, straight flanks to 62% of the height, then a point.
  const shoulder = y + shieldHeight * 0.62;
  const outline = [
    [x, y],
    [x + shieldWidth, y],
    [x + shieldWidth, shoulder],
    [x + shieldWidth / 2, y + shieldHeight],
    [x, shoulder],
  ]
    .map(([px, py]) => `${fmt(px as number)},${fmt(py as number)}`)
    .join(" ");

  const markWidth = shieldWidth * 0.58;
  const markThickness = Math.max(1.8, shieldHeight * 0.11);
  const markX = x + (shieldWidth - markWidth) / 2;
  const markY = y + shieldHeight * 0.34;

  return (
    <GlyphFrame face="gaze" box={box}>
      <polygon
        data-illus-mark="shield"
        points={outline}
        strokeWidth={ILLUS_STROKE_DETAIL}
        strokeLinejoin="round"
        style={{ fill: "var(--illus-surface-sunken)", stroke: "var(--illus-ink)" }}
      />
      {variant === "grader" ? (
        <polygon
          data-illus-mark="score-chevron"
          points={[
            [markX, markY],
            [markX + markWidth / 2, markY + markThickness * 1.5],
            [markX + markWidth, markY],
            [markX + markWidth, markY + markThickness],
            [markX + markWidth / 2, markY + markThickness * 2.5],
            [markX, markY + markThickness],
          ]
            .map(([px, py]) => `${fmt(px as number)},${fmt(py as number)}`)
            .join(" ")}
          style={{ fill: accent }}
        />
      ) : (
        <rect
          data-illus-mark="barrier"
          x={fmt(markX)}
          y={fmt(markY + markThickness * 0.5)}
          width={fmt(markWidth)}
          height={fmt(markThickness)}
          rx={fmt(markThickness / 2)}
          style={{ fill: accent }}
        />
      )}
      {/* A guardrail also carries its two posts — the barrier is mounted, not floating. */}
      {variant === "guardrail"
        ? (["start", "end"] as const).map((post) => (
            <line
              key={`post-${post}`}
              x1={fmt(post === "start" ? markX : markX + markWidth)}
              y1={fmt(markY + markThickness * 0.5)}
              x2={fmt(post === "start" ? markX : markX + markWidth)}
              y2={fmt(markY + markThickness * 2.6)}
              strokeWidth={ILLUS_STROKE_DETAIL_FINE}
              strokeLinecap="round"
              style={{ stroke: "var(--illus-ink-muted)" }}
            />
          ))
        : null}
    </GlyphFrame>
  );
}
