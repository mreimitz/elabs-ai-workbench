// ==================================================================================================
// Collection — a cabinet with one drawer pulled out (tier 2, entity `collections`)
// ==================================================================================================
// Where tests live. Since the testing-IA consolidation a collection is the HOME of a test, not a
// folder somebody optionally made: there is always a default "Local" one, and binding it to git is
// the extra rather than the point. Research 5 calls the entity a "drawer/binder", and the drawing
// picks the drawer — a binder is a slab, and the catalog already has one of those (`skill`).
//
// THE PULLED DRAWER IS THE SILHOUETTE. Five of WP 1.3's eight entities are, structurally, "a box on
// a platform", and a closed cabinet would have been the third one in this cast alone. Pulling one
// drawer out breaks the box into an L: a step protruding toward the viewer at low level, which is
// legible at `s` and from across a scene, where a front-panel detail would not be.
//
// THE VARIANT MOVES THE ACCENT rather than adding one (D-IL6, the `mcp-server` precedent). A `local`
// collection's one lit mark is the tab on the open drawer — the thing you are working in. A
// `git-bound` one grows a coupling block on its far flank and the light moves there, because what is
// interesting about a bound collection is the binding.
//
// FACELESS (D-IL17): the drawer fronts name the `left` face outright. A cabinet has no gaze.

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
 * `hold` is what the collection keeps (its members); `sync` is the git binding, which is optional in
 * the domain and therefore a port rather than a second entity. A `local` collection still declares
 * `sync` — the port is the collection's capability, not a statement that it is currently bound.
 */
export const collectionMeta: IllustrationRegistryEntry = {
  id: "collection",
  title: "Collection",
  entity: "collections",
  tier: 2,
  keywords: ["collection", "drawer", "cabinet", "library", "git", "repository", "membership"],
  variants: ["local", "git-bound"],
  states: ["idle", "active", "highlight", "dimmed", "error"],
  ports: {
    top: { title: "Top", side: "top" },
    bottom: { title: "Bottom", side: "bottom" },
    left: { title: "Left", side: "left" },
    right: { title: "Right", side: "right" },
    hold: { title: "Hold", side: "left", offset: -1.4 },
    sync: { title: "Sync", side: "right", offset: 1.4 },
  },
  sizes: ["s", "m", "l"],
  since: "0.1.0",
  description:
    "A collection: a filing cabinet with one drawer pulled out and divided, growing a coupling block on its flank when it is bound to a remote.",
};

export const COLLECTION_VARIANTS = ["local", "git-bound"] as const;
export type CollectionVariant = (typeof COLLECTION_VARIANTS)[number];

export type CollectionProps = EntityComponentProps;

function resolveVariant(variant: string | undefined): CollectionVariant {
  return COLLECTION_VARIANTS.includes(variant as CollectionVariant)
    ? (variant as CollectionVariant)
    : "local";
}

const PLATFORM_TIERS = 1;
const FLOOR = platformHeight(PLATFORM_TIERS);

// Fractions of the footprint, so S/M/L are one drawing at three scales.
const BODY_WIDTH = 0.46;
const BODY_DEPTH = 0.66;
const BODY_HEIGHT = 0.46;
const BODY_CX = -0.1;

const DRAWER_WIDTH = 0.3;
const DRAWER_DEPTH = 0.54;
const DRAWER_HEIGHT = 0.18;
const DRAWER_CX = 0.28;
const DRAWER_Z = 0.07;

const COUPLING_WIDTH = 0.1;
const COUPLING_DEPTH = 0.24;
const COUPLING_HEIGHT = 0.26;
const COUPLING_CX = -0.4;

function bodyBox(footprint: number): IsoBox {
  return {
    cx: footprint * BODY_CX,
    cy: 0,
    w: footprint * BODY_WIDTH,
    d: footprint * BODY_DEPTH,
    z0: FLOOR,
    h: footprint * BODY_HEIGHT,
  };
}

function drawerBox(footprint: number): IsoBox {
  return {
    cx: footprint * DRAWER_CX,
    cy: 0,
    w: footprint * DRAWER_WIDTH,
    d: footprint * DRAWER_DEPTH,
    z0: FLOOR + footprint * DRAWER_Z,
    h: footprint * DRAWER_HEIGHT,
  };
}

function couplingBox(footprint: number): IsoBox {
  return {
    cx: footprint * COUPLING_CX,
    cy: 0,
    w: footprint * COUPLING_WIDTH,
    d: footprint * COUPLING_DEPTH,
    z0: FLOOR,
    h: footprint * COUPLING_HEIGHT,
  };
}

/**
 * The cabinet body decides the height, in BOTH variants: the coupling is deliberately shorter than
 * the body, so binding a collection to git cannot move a connector attached to its `top` port
 * (D-IL7 — `heightUnits` is what every anchor is measured against).
 */
export function collectionHeightUnits(size: IllustrationSize): number {
  return FLOOR + footprintUnits(size) * BODY_HEIGHT;
}

export function Collection({
  size = "m",
  state = "idle",
  facing = "upstream",
  detail = "standard",
  variant,
  label,
  showPorts = false,
  idPrefix,
}: CollectionProps): ReactElement {
  const resolved = resolveVariant(variant);
  const footprint = footprintUnits(size);
  const body = bodyBox(footprint);
  const drawer = drawerBox(footprint);
  const coupling = couplingBox(footprint);
  const accent = state === "error" ? "var(--illus-error)" : "var(--illus-accent)";
  const bound = resolved === "git-bound";

  return (
    <EntityRoot
      meta={collectionMeta}
      size={size}
      state={state}
      facing={facing}
      detail={detail}
      variant={resolved}
      label={label}
      heightUnits={collectionHeightUnits(size)}
      showPorts={showPorts}
      idPrefix={idPrefix}
    >
      <ConstructionGhost width={footprint} depth={footprint} />
      <IsoPlatform tiers={PLATFORM_TIERS} footprint={size} />
      {bound ? (
        <IsoHousing
          width={coupling.w}
          depth={coupling.d}
          height={coupling.h}
          cx={coupling.cx}
          z0={coupling.z0}
          weight="detail"
        />
      ) : null}
      {bound ? <CouplingMark box={coupling} accent={accent} /> : null}
      <IsoHousing
        width={body.w}
        depth={body.d}
        height={body.h}
        cx={body.cx}
        z0={body.z0}
        weight="ink"
      />
      <ClosedDrawers box={body} />
      <IsoHousing
        width={drawer.w}
        depth={drawer.d}
        height={drawer.h}
        cx={drawer.cx}
        z0={drawer.z0}
        weight="ink"
      />
      <Dividers box={drawer} accent={bound ? undefined : accent} />
    </EntityRoot>
  );
}

Collection.illusLayer = "structure" as const;
Collection.entityHeightUnits = collectionHeightUnits;

/**
 * Two closed drawer fronts on the cabinet's LEFT face, each a recessed plate with a pull. They are
 * ink-muted hardware: what makes this a collection rather than a cupboard is the drawer that is
 * OPEN, so the closed ones must not compete with it.
 */
function ClosedDrawers({ box }: { box: IsoBox }): ReactElement {
  const { width, height } = faceExtent(box, "left");
  const inset = Math.min(width, height) * 0.13;
  const fronts = [0, 1];
  const frontHeight = (height - inset * (fronts.length + 1)) / fronts.length;
  const frontWidth = width - inset * 2;

  return (
    <GlyphFrame face="left" box={box}>
      {fronts.map((front) => {
        const y = inset + front * (frontHeight + inset);
        return (
          <g key={`front-${front}`}>
            <rect
              x={fmt(inset)}
              y={fmt(y)}
              width={fmt(frontWidth)}
              height={fmt(frontHeight)}
              rx={fmt(Math.min(3, frontHeight / 5))}
              strokeWidth={ILLUS_STROKE_DETAIL_FINE}
              style={{ fill: "var(--illus-surface-sunken)", stroke: "var(--illus-ink)" }}
            />
            <rect
              data-illus-mark="pull"
              x={fmt(inset + frontWidth * 0.3)}
              y={fmt(y + frontHeight * 0.42)}
              width={fmt(frontWidth * 0.4)}
              height={fmt(Math.max(1.4, frontHeight * 0.13))}
              rx={fmt(Math.max(0.7, frontHeight * 0.065))}
              style={{ fill: "var(--illus-ink-muted)" }}
            />
          </g>
        );
      })}
    </GlyphFrame>
  );
}

/**
 * The open drawer's dividers, printed on its TOP face — three across, with the leading one carrying
 * a tab. The tab is the `local` variant's single accent moment; on `git-bound` it goes muted and the
 * light moves to the coupling, so the entity still spends exactly one.
 */
function Dividers({ box, accent }: { box: IsoBox; accent?: string }): ReactElement {
  const { width, height } = faceExtent(box, "top");
  const inset = Math.min(width, height) * 0.17;
  const dividers = [0, 1, 2];
  const step = (width - inset * 2) / dividers.length;
  const thickness = Math.max(1.4, step * 0.14);
  const tabWidth = step * 0.44;

  return (
    <GlyphFrame face="top" box={box}>
      {dividers.map((divider) => {
        const x = inset + divider * step;
        return (
          <g key={`divider-${divider}`}>
            <rect
              x={fmt(x)}
              y={fmt(inset)}
              width={fmt(thickness)}
              height={fmt(height - inset * 2)}
              style={{ fill: "var(--illus-ink-muted)" }}
            />
            {divider === 0 ? (
              <rect
                data-illus-mark="tab"
                x={fmt(x)}
                y={fmt(inset)}
                width={fmt(tabWidth)}
                height={fmt(Math.max(1.6, (height - inset * 2) * 0.24))}
                style={{ fill: accent ?? "var(--illus-ink-muted)" }}
              />
            ) : null}
          </g>
        );
      })}
    </GlyphFrame>
  );
}

/**
 * The coupling's status mark, on its TOP face: a short bar that reads as a live link. It is the
 * `git-bound` variant's one accent moment. There is no repository glyph and no branch symbol —
 * borrowing a mark from an icon set is the illustration equivalent of a color literal.
 */
function CouplingMark({ box, accent }: { box: IsoBox; accent: string }): ReactElement {
  const { width, height } = faceExtent(box, "top");
  const inset = Math.min(width, height) * 0.22;
  return (
    <GlyphFrame face="top" box={box}>
      <rect
        data-illus-mark="coupling"
        x={fmt(inset)}
        y={fmt(height / 2 - Math.max(1.6, height * 0.09))}
        width={fmt(width - inset * 2)}
        height={fmt(Math.max(3.2, height * 0.18))}
        rx={fmt(Math.max(1.6, height * 0.09))}
        style={{ fill: accent }}
      />
    </GlyphFrame>
  );
}
