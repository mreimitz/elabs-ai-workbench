// ==================================================================================================
// Skill — a laminated document on a plinth (tier 1, entity `skills`)
// ==================================================================================================
// A registered Agent Skill: `SKILL.md` and the files around it. The drawing is a slab with a
// document glyph on its top face, and the two variants are the SAME SLAB, laminated differently —
// `plain` is one sheet, `versioned` is three thinner sheets with the current version on top.
//
// Keeping the two variants the same total height is deliberate and load-bearing. `heightUnits` is
// what every port anchor is measured against (D-IL7), so a variant that changed the height would
// silently move `version-out` — a connector in a scene would jump when somebody switched a skill
// from `plain` to `versioned`. Lamination is a detail of the solid, not a different solid.
//
// WP 1.2 REFACTOR: the lamination arithmetic that used to live in this file is now
// `primitives/IsoSheetStack.tsx`, because `file` and `feedback-report` need the same slab-divided-
// into-sheets shape and D-IL12 forbids a reusable shape living inside one entity. The drawing is
// unchanged — the primitive reproduces this file's arithmetic in the same order, on purpose, so the
// bytes are identical — and `skill` now passes the flush (unstaggered) default while `file` fans
// its pile.

import type { IllustrationRegistryEntry, IllustrationSize } from "@mcp-token-footprint/shared";
import type { ReactElement } from "react";
import { type IsoBox, faceExtent, fmt, footprintUnits } from "../iso-math.js";
import { ConstructionGhost } from "../primitives/ConstructionGhost.js";
import { EntityRoot } from "../primitives/EntityRoot.js";
import { GlyphFrame } from "../primitives/GlyphFrame.js";
import { IsoPlatform, platformHeight } from "../primitives/IsoPlatform.js";
import { IsoSheetStack, sheetStackBoxes } from "../primitives/IsoSheetStack.js";
import type { EntityComponentProps } from "./entity-props.js";

/**
 * `version-out` is the semantic port system design 2.2 names for this entity: the edge a NEW
 * immutable version leaves from. It sits on the right side with an offset, so the port overlay does
 * not stack it on top of the plain `right` cardinal.
 */
export const skillMeta: IllustrationRegistryEntry = {
  id: "skill",
  title: "Skill",
  entity: "skills",
  tier: 1,
  keywords: ["skill", "agent skill", "instructions", "manifest", "version", "registry", "document"],
  variants: ["plain", "versioned"],
  states: ["idle", "active", "highlight", "dimmed", "error"],
  ports: {
    top: { title: "Top", side: "top" },
    bottom: { title: "Bottom", side: "bottom" },
    left: { title: "Left", side: "left" },
    right: { title: "Right", side: "right" },
    "version-out": { title: "New version out", side: "right", offset: 1.6 },
  },
  sizes: ["s", "m", "l"],
  since: "0.1.0",
  description:
    "A registered Agent Skill: a document slab on a two-tier plinth, its top face carrying the manifest heading and body rules — laminated into three sheets on the versioned variant.",
};

/**
 * See the note on `MCP_SERVER_VARIANTS`: the list is what the registry entry is held to, the prop
 * stays the generic `variant?: string` so every entity satisfies one `EntityComponentProps` shape,
 * and an unrecognised variant falls back to `plain` rather than throwing.
 */
export const SKILL_VARIANTS = ["plain", "versioned"] as const;
export type SkillVariant = (typeof SKILL_VARIANTS)[number];

export type SkillProps = EntityComponentProps;

function resolveVariant(variant: string | undefined): SkillVariant {
  return SKILL_VARIANTS.includes(variant as SkillVariant) ? (variant as SkillVariant) : "plain";
}

const PLATFORM_TIERS = 2;
const FLOOR = platformHeight(PLATFORM_TIERS);

/** Fractions of the footprint, so S/M/L are one drawing at three scales. */
const SLAB_WIDTH = 0.62;
const SLAB_HEIGHT = 0.17;

/** How many sheets each variant laminates the slab into. */
const SHEETS: Record<SkillVariant, number> = { plain: 1, versioned: 3 };

function slabBox(footprint: number): IsoBox {
  const side = footprint * SLAB_WIDTH;
  return { cx: 0, cy: 0, w: side, d: side, z0: FLOOR, h: footprint * SLAB_HEIGHT };
}

export function skillHeightUnits(size: IllustrationSize): number {
  return FLOOR + footprintUnits(size) * SLAB_HEIGHT;
}

export function Skill({
  size = "m",
  state = "idle",
  facing = "upstream",
  detail = "standard",
  variant,
  label,
  showPorts = false,
  idPrefix,
}: SkillProps): ReactElement {
  const resolved = resolveVariant(variant);
  const footprint = footprintUnits(size);
  const slab = slabBox(footprint);
  const sheets = SHEETS[resolved];
  const accent = state === "error" ? "var(--illus-error)" : "var(--illus-accent)";

  // Total height is fixed; the sheets and the gaps between them divide it up (WP 1.2's
  // `IsoSheetStack`, which lifted this arithmetic out of here so `file` and `feedback-report` could
  // not redraw it slightly differently). With one sheet there are no gaps, so `plain` is exactly the
  // whole slab. The TOP sheet is the current version, and it is the one the manifest is printed on.
  const topSheet: IsoBox = sheetStackBoxes(slab, sheets).top;

  return (
    <EntityRoot
      meta={skillMeta}
      size={size}
      state={state}
      facing={facing}
      detail={detail}
      variant={resolved}
      label={label}
      heightUnits={skillHeightUnits(size)}
      showPorts={showPorts}
      idPrefix={idPrefix}
    >
      <ConstructionGhost width={footprint} depth={footprint} />
      <IsoPlatform tiers={PLATFORM_TIERS} footprint={size} />
      <IsoSheetStack box={slab} sheets={sheets} />
      <ManifestGlyph box={topSheet} accent={accent} />
    </EntityRoot>
  );
}

Skill.illusLayer = "structure" as const;
Skill.entityHeightUnits = skillHeightUnits;

/**
 * The manifest printed on the current sheet's TOP face: a heading bar (the entity's single accent
 * moment, D-IL6) and three body rules. Text is never set on a face — these are rules standing in for
 * text, exactly as a drafting elevation shows a hatched block rather than lettering (D-IL2).
 */
function ManifestGlyph({ box, accent }: { box: IsoBox; accent: string }): ReactElement {
  const { width, height } = faceExtent(box, "top");
  const inset = Math.min(width, height) * 0.2;
  const innerWidth = width - inset * 2;
  const headingHeight = Math.max(2.4, (height - inset * 2) * 0.16);
  const ruleGap = (height - inset * 2 - headingHeight) / 4;

  return (
    <GlyphFrame face="top" box={box}>
      <rect
        x={fmt(inset)}
        y={fmt(inset)}
        width={fmt(innerWidth * 0.62)}
        height={fmt(headingHeight)}
        rx={fmt(headingHeight / 2)}
        style={{ fill: accent }}
      />
      {[0, 1, 2].map((rule) => (
        <rect
          key={`rule-${rule}`}
          x={fmt(inset)}
          y={fmt(inset + headingHeight + ruleGap * (rule + 0.7))}
          width={fmt(innerWidth * (rule === 2 ? 0.55 : 1))}
          height={fmt(Math.max(1.2, headingHeight * 0.34))}
          style={{ fill: "var(--illus-ink-muted)" }}
        />
      ))}
    </GlyphFrame>
  );
}
