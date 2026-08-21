// ==================================================================================================
// CredentialsVault — a sealed column (tier 3, no entity binding)
// ==================================================================================================
// Everything the app holds that must never come back out to the browser: MCP env and header secrets,
// OAuth material, provider API keys, service-token digests. Research 5 calls it a "key vault", and
// WP 1.3 attaches a hard constraint to the drawing — NEVER a drawn key or a keyhole detailed enough
// to look like real material. So there is no key, no keyhole, no shackle and no borrowed padlock
// glyph. What is drawn is a sealed door plate with a dial boss and two bolt heads: the vocabulary of
// something CLOSED, which is the honest thing to depict, rather than the vocabulary of something
// that can be opened with the right object.
//
// NO ENTITY BINDING, on purpose and not by omission. The secrets live across several tables
// (`mcp_oauth_credentials`, `provider_credentials`, `assistant_credentials`, `api_tokens`) plus a key
// file on disk, and there is no single one an operator would point at and call "the vault". WP 1.3
// says to omit rather than stretch.
//
// THE PROPORTION IS THE POINT. `mcp-server` and `provider` already occupy "a box roughly as wide as
// it is tall, on a two-tier plinth"; a stout safe would have been the third. This is deliberately
// SLIM AND TALL with an overhanging cap — a stele rather than a cabinet — so that in the whole-cast
// row it is the one silhouette nothing else can be confused with.
//
// FACELESS (D-IL17): the door plate names the `left` face outright. A vault has no gaze.

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
 * `issue` and `revoke`, and nothing that reads. That asymmetry is the drawing agreeing with the
 * code: the API hands a credential OUT to the process that needs it and takes it back, but it never
 * hands one to the browser — a `read` port here would have depicted a route that does not exist.
 */
export const credentialsVaultMeta: IllustrationRegistryEntry = {
  id: "credentials-vault",
  title: "Credentials Vault",
  entity: null,
  tier: 3,
  keywords: ["credentials", "secrets", "vault", "encryption", "oauth", "token", "sealed"],
  variants: [],
  states: ["idle", "active", "highlight", "dimmed", "error"],
  ports: {
    top: { title: "Top", side: "top" },
    bottom: { title: "Bottom", side: "bottom" },
    left: { title: "Left", side: "left" },
    right: { title: "Right", side: "right" },
    issue: { title: "Issue", side: "right", offset: 1.4 },
    revoke: { title: "Revoke", side: "left", offset: -1.4 },
  },
  sizes: ["s", "m", "l"],
  since: "0.1.0",
  description:
    "The credentials vault: a slim sealed column under an overhanging cap, its door plate carrying a dial boss and two bolt heads — closed, with no keyhole to depict.",
};

export type CredentialsVaultProps = EntityComponentProps;

const PLATFORM_TIERS = 2;
const FLOOR = platformHeight(PLATFORM_TIERS);

// Fractions of the footprint, so S/M/L are one drawing at three scales.
const COLUMN_SIDE = 0.34;
const COLUMN_HEIGHT = 0.58;
const CAP_SIDE = 0.44;
const CAP_HEIGHT = 0.08;

function columnBox(footprint: number): IsoBox {
  const side = footprint * COLUMN_SIDE;
  return { cx: 0, cy: 0, w: side, d: side, z0: FLOOR, h: footprint * COLUMN_HEIGHT };
}

function capBox(footprint: number): IsoBox {
  const column = columnBox(footprint);
  const side = footprint * CAP_SIDE;
  return { cx: 0, cy: 0, w: side, d: side, z0: column.z0 + column.h, h: footprint * CAP_HEIGHT };
}

export function credentialsVaultHeightUnits(size: IllustrationSize): number {
  return FLOOR + footprintUnits(size) * (COLUMN_HEIGHT + CAP_HEIGHT);
}

export function CredentialsVault({
  size = "m",
  state = "idle",
  facing = "upstream",
  detail = "standard",
  variant,
  label,
  showPorts = false,
  idPrefix,
}: CredentialsVaultProps): ReactElement {
  const footprint = footprintUnits(size);
  const column = columnBox(footprint);
  const cap = capBox(footprint);
  const accent = state === "error" ? "var(--illus-error)" : "var(--illus-accent)";

  return (
    <EntityRoot
      meta={credentialsVaultMeta}
      size={size}
      state={state}
      facing={facing}
      detail={detail}
      variant={variant}
      label={label}
      heightUnits={credentialsVaultHeightUnits(size)}
      showPorts={showPorts}
      idPrefix={idPrefix}
    >
      <ConstructionGhost width={footprint} depth={footprint} />
      <IsoPlatform tiers={PLATFORM_TIERS} footprint={size} />
      <IsoHousing width={column.w} depth={column.d} height={column.h} z0={column.z0} />
      <DoorPlate box={column} accent={accent} />
      <IsoHousing width={cap.w} depth={cap.d} height={cap.h} z0={cap.z0} weight="detail" />
    </EntityRoot>
  );
}

CredentialsVault.illusLayer = "structure" as const;
CredentialsVault.entityHeightUnits = credentialsVaultHeightUnits;

/**
 * The door: a recessed plate, a dial boss at its centre, two bolt heads down its hinge edge, and a
 * seal bar across the top that is the entity's single accent moment (D-IL6).
 *
 * The DIAL is a plain `<circle>` in flat face art with a single index notch, and the notch is what
 * keeps it a dial rather than a dot: a mechanism with a setting. It is emphatically not a keyhole —
 * a keyhole implies a key, a key implies a thing that could be drawn convincingly, and WP 1.3 rules
 * that out in as many words.
 */
function DoorPlate({ box, accent }: { box: IsoBox; accent: string }): ReactElement {
  const { width, height } = faceExtent(box, "left");
  const plateWidth = width * 0.72;
  const plateHeight = height * 0.78;
  const x = (width - plateWidth) / 2;
  const y = (height - plateHeight) / 2;
  const dial = Math.min(plateWidth, plateHeight) * 0.2;
  const cx = x + plateWidth * 0.58;
  const cy = y + plateHeight * 0.54;
  const sealHeight = Math.max(2.2, plateHeight * 0.07);

  return (
    <GlyphFrame face="left" box={box}>
      <rect
        x={fmt(x)}
        y={fmt(y)}
        width={fmt(plateWidth)}
        height={fmt(plateHeight)}
        rx={fmt(Math.min(4, plateWidth / 8))}
        strokeWidth={ILLUS_STROKE_DETAIL}
        style={{ fill: "var(--illus-surface-sunken)", stroke: "var(--illus-ink)" }}
      />
      <rect
        data-illus-mark="seal"
        x={fmt(x + plateWidth * 0.16)}
        y={fmt(y + plateHeight * 0.12)}
        width={fmt(plateWidth * 0.68)}
        height={fmt(sealHeight)}
        rx={fmt(sealHeight / 2)}
        style={{ fill: accent }}
      />
      <circle
        data-illus-mark="dial"
        cx={fmt(cx)}
        cy={fmt(cy)}
        r={fmt(dial)}
        strokeWidth={ILLUS_STROKE_DETAIL_FINE}
        style={{ fill: "var(--illus-surface)", stroke: "var(--illus-ink)" }}
      />
      <line
        data-illus-mark="dial-index"
        x1={fmt(cx)}
        y1={fmt(cy - dial * 0.9)}
        x2={fmt(cx)}
        y2={fmt(cy - dial * 0.25)}
        strokeWidth={ILLUS_STROKE_DETAIL_FINE}
        strokeLinecap="round"
        style={{ stroke: "var(--illus-ink-muted)" }}
      />
      {[0.32, 0.72].map((at) => (
        <circle
          key={`bolt-${at}`}
          data-illus-mark="bolt"
          cx={fmt(x + plateWidth * 0.14)}
          cy={fmt(y + plateHeight * at)}
          r={fmt(Math.max(1.3, dial * 0.28))}
          style={{ fill: "var(--illus-ink-muted)" }}
        />
      ))}
    </GlyphFrame>
  );
}
