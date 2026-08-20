// ==================================================================================================
// PrimitivesSheet — every primitive, on one sheet, so both themes can be checked BY LOOKING
// ==================================================================================================
// Dev scaffolding, not a product surface. It exists because WP 0.2's acceptance is partly visual —
// "reads correctly in both themes, with a screenshot each" — and a claim about how something looks
// is worth nothing without something to look at. WP 0.3 ships the real `/illustrations` gallery off
// the registry, and this sheet is superseded then.
//
// It is drawn with the package's own primitives and nothing else, so it doubles as the first proof
// that the vocabulary is usable: if a tile below needed a bespoke `<path>` to look right, the
// primitive it demonstrates is not finished.
//
// It lives in the PACKAGE rather than in `apps/web` on purpose. The app's preview page and the
// standalone HTML the screenshots come from render the SAME component, so a screenshot cannot drift
// from what the app shows.

import type { IllustrationConnectorKind } from "@mcp-token-footprint/shared";
import type { ReactElement, ReactNode } from "react";
import { ISO_UNIT, type IsoBox, type ScreenPoint, fmt, isoEllipse, project } from "../iso-math.js";
import { ILLUS_STROKE_DETAIL, ILLUS_STROKE_DETAIL_FINE, ILLUS_TEXT } from "../line-system.js";
import { Layer } from "../layers.js";
import { CalibrationCube } from "../primitives/CalibrationCube.js";
import { CalloutCard } from "../primitives/CalloutCard.js";
import { Connector } from "../primitives/Connector.js";
import { ConstructionGhost } from "../primitives/ConstructionGhost.js";
import { EntityRoot, type EntityMeta } from "../primitives/EntityRoot.js";
import { GlyphFrame } from "../primitives/GlyphFrame.js";
import { IsoHousing } from "../primitives/IsoHousing.js";
import { IsoPlatform, platformHeight } from "../primitives/IsoPlatform.js";
import { PaperStage } from "../primitives/PaperStage.js";
import { PrincipleCard } from "../primitives/PrincipleCard.js";
import { StationHeader } from "../primitives/StationHeader.js";

const TILE_WIDTH = 268;
const TILE_HEIGHT = 306;
const TILE_GAP = 12;
const MARGIN = 20;
const HEADER = 66;
const COLUMNS = 5;

/** Where a tile's own drawing sits inside it, so every tile lines up on the same ground. */
const TILE_GROUND: ScreenPoint = { x: TILE_WIDTH / 2, y: 196 };

/**
 * The stand-in an `EntityRoot` tile wraps. NOT an entity and NOT a registry entry — WP 0.2 ships
 * neither. It is a platform, a housing, a ghost and a face panel, which is the smallest composition
 * that shows the wrapper doing its five jobs.
 */
const SUBJECT_META: EntityMeta = {
  id: "preview-subject",
  title: "Preview subject",
  description:
    "A stand-in solid composed only of WP 0.2 primitives: a two-tier platform, a housing, a construction ghost and a face panel on the gaze side.",
  ports: {
    top: { title: "Top", side: "top" },
    bottom: { title: "Bottom", side: "bottom" },
    "context-in": { title: "Context in", side: "left" },
    "result-out": { title: "Result out", side: "right" },
  },
};

const SUBJECT_PLATFORM_TIERS = 2;
const SUBJECT_FLOOR = platformHeight(SUBJECT_PLATFORM_TIERS);
const SUBJECT_HOUSING: IsoBox = {
  cx: 0,
  cy: 0,
  w: 3,
  d: 3,
  z0: SUBJECT_FLOOR,
  h: 1.8,
};
const SUBJECT_HEIGHT = SUBJECT_FLOOR + SUBJECT_HOUSING.h;

function PreviewSubject(): ReactElement {
  return (
    <>
      <ConstructionGhost width={6} depth={6} />
      <IsoPlatform tiers={SUBJECT_PLATFORM_TIERS} footprint="m" />
      <IsoHousing
        width={SUBJECT_HOUSING.w}
        depth={SUBJECT_HOUSING.d}
        height={SUBJECT_HOUSING.h}
        z0={SUBJECT_HOUSING.z0}
      />
      <GlyphFrame face="gaze" box={SUBJECT_HOUSING}>
        <rect
          x={7}
          y={9}
          width={28}
          height={14}
          rx={3}
          strokeWidth={ILLUS_STROKE_DETAIL_FINE}
          style={{ fill: "var(--illus-surface-sunken)", stroke: "var(--illus-ink)" }}
        />
        <circle cx={15} cy={16} r={2.4} style={{ fill: "var(--illus-ink)" }} />
        <circle cx={27} cy={16} r={2.4} style={{ fill: "var(--illus-ink)" }} />
      </GlyphFrame>
    </>
  );
}

type Tile = {
  caption: string;
  content: ReactNode;
  /** Drop the tile's own grid, so a tile demonstrating the STAGE is not drawn on top of one. */
  plain?: boolean;
};

function subjectTile(caption: string, props: Record<string, unknown>): Tile {
  return {
    caption,
    content: (
      <EntityRoot meta={SUBJECT_META} size="m" heightUnits={SUBJECT_HEIGHT} {...props}>
        <PreviewSubject />
      </EntityRoot>
    ),
  };
}

const CONNECTOR_RUN_LEFT = -104;
const CONNECTOR_RUN_RIGHT = 104;

function connectorTile(caption: string, kinds: readonly IllustrationConnectorKind[]): Tile {
  return {
    caption,
    content: (
      <g transform={`translate(0 ${-104})`}>
        {kinds.map((kind, index) => (
          <Connector
            key={kind}
            kind={kind}
            from={{ x: CONNECTOR_RUN_LEFT, y: index * 46 }}
            to={{ x: CONNECTOR_RUN_RIGHT, y: index * 46 }}
            label={kind}
          />
        ))}
      </g>
    ),
  };
}

function TILES(): Tile[] {
  return [
    {
      caption: "paper stage · grid, crosshair, registration",
      plain: true,
      content: (
        <Layer name="stage">
          <PaperStage width={TILE_WIDTH - 56} height={200} x={-(TILE_WIDTH - 56) / 2} y={-160} />
        </Layer>
      ),
    },
    { caption: "calibration cube · the standing reference", content: <CalibrationCube /> },
    {
      caption: "iso housing · three faces, one light rule",
      content: <IsoHousing width={3} depth={3} height={2.5} />,
    },
    {
      caption: "glyph frame · top, left and right faces",
      content: <GlyphFaceDemo />,
    },
    {
      caption: "construction ghost · the dashed echo",
      content: <ConstructionGhost width={6} depth={6} />,
    },
    { caption: "platform · S, one tier", content: <IsoPlatform tiers={1} footprint="s" /> },
    { caption: "platform · M, two tiers", content: <IsoPlatform tiers={2} footprint="m" /> },
    { caption: "platform · L, three tiers", content: <IsoPlatform tiers={3} footprint="l" /> },
    {
      caption: "station header · screen-aligned, numbered",
      content: (
        <g transform={`translate(${-TILE_WIDTH / 2 + 34} ${-80})`}>
          <StationHeader at={{ x: 0, y: 0 }} seq={1} title="Discover" caption="tools/list" />
          <StationHeader
            at={{ x: 0, y: 62 }}
            seq={2}
            title="Measure"
            caption="token footprint"
            accent
          />
        </g>
      ),
    },
    connectorTile("connectors · flow, read, write", ["flow", "read", "write"]),
    connectorTile("connectors · publish, loop, signal", ["publish", "loop", "signal"]),
    {
      caption: "callout card · leader elbows at 30/90/150",
      content: (
        <CalloutCard
          at={{ x: -118, y: -152 }}
          title="Definition tokens"
          lines={["Counted from the serialized", "provider payload, not summed."]}
          width={200}
          anchor={{ x: -34, y: 44 }}
        />
      ),
    },
    {
      caption: "principle card · the standing note",
      content: (
        <PrincipleCard
          at={{ x: -118, y: -152 }}
          title="The loop principle"
          items={["Execute with context", "Measure what it cost", "Feed the result back"]}
          width={236}
          accent
        />
      ),
    },
    subjectTile("EntityRoot · idle", { state: "idle" }),
    subjectTile("EntityRoot · active", { state: "active" }),
    subjectTile("EntityRoot · highlight", { state: "highlight" }),
    subjectTile("EntityRoot · dimmed", { state: "dimmed" }),
    subjectTile("EntityRoot · error", { state: "error" }),
    subjectTile("EntityRoot · ports overlay", { showPorts: true }),
    subjectTile("EntityRoot · facing downstream", { facing: "downstream", label: "downstream" }),
  ];
}

/** One cube wearing a mark on each of its three faces — the fixed transforms, made visible. */
function GlyphFaceDemo(): ReactElement {
  const box: IsoBox = { cx: 0, cy: 0, w: 3, d: 3, z0: 0, h: 3 };
  const dial = isoEllipse("top", 26);
  return (
    <g>
      <IsoHousing width={box.w} depth={box.d} height={box.h} />
      <GlyphFrame face="top" box={box}>
        <rect
          x={9}
          y={9}
          width={30}
          height={30}
          rx={4}
          strokeWidth={ILLUS_STROKE_DETAIL}
          style={{ fill: "var(--illus-surface-sunken)", stroke: "var(--illus-ink)" }}
        />
      </GlyphFrame>
      <GlyphFrame face="left" box={box}>
        <path
          d="M 10 12 H 38 M 10 22 H 32 M 10 32 H 26"
          fill="none"
          strokeWidth={2}
          strokeLinecap="round"
          style={{ stroke: "var(--illus-ink-muted)" }}
        />
      </GlyphFrame>
      <GlyphFrame face="right" box={box}>
        <circle
          cx={24}
          cy={24}
          r={10}
          strokeWidth={ILLUS_STROKE_DETAIL}
          fill="none"
          style={{ stroke: "var(--illus-ink)" }}
        />
      </GlyphFrame>
      <ellipse
        cx={fmt(project(0, 0, 3).x)}
        cy={fmt(project(0, 0, 3).y)}
        rx={fmt(dial.rx)}
        ry={fmt(dial.ry)}
        fill="none"
        strokeWidth={ILLUS_STROKE_DETAIL_FINE}
        strokeDasharray="3 4"
        style={{ stroke: "var(--illus-accent)" }}
      />
    </g>
  );
}

export type PrimitivesSheetProps = {
  /** Shown in the sheet's own header — normally the theme being looked at. */
  subtitle?: string;
  /** Turn the tile grids off to see the drawings on plain paper. */
  grid?: boolean;
};

const TILE_COUNT = TILES().length;
const ROWS = Math.ceil(TILE_COUNT / COLUMNS);

/** The sheet's intrinsic size, so a host can lay out around it without measuring. */
export const PRIMITIVE_SHEET_SIZE = {
  width: MARGIN * 2 + COLUMNS * TILE_WIDTH + (COLUMNS - 1) * TILE_GAP,
  height: HEADER + MARGIN + ROWS * TILE_HEIGHT + (ROWS - 1) * TILE_GAP,
} as const;

export function PrimitivesSheet({ subtitle, grid = true }: PrimitivesSheetProps): ReactElement {
  const tiles = TILES();
  return (
    <svg
      viewBox={`0 0 ${PRIMITIVE_SHEET_SIZE.width} ${PRIMITIVE_SHEET_SIZE.height}`}
      width={PRIMITIVE_SHEET_SIZE.width}
      height={PRIMITIVE_SHEET_SIZE.height}
      role="img"
      aria-label="Every illustration primitive shipped by WP 0.2, drawn on one sheet"
      data-illus-sheet="primitives"
    >
      <rect
        width={PRIMITIVE_SHEET_SIZE.width}
        height={PRIMITIVE_SHEET_SIZE.height}
        style={{ fill: "var(--illus-paper)" }}
      />
      <text
        x={MARGIN + 4}
        y={34}
        fontSize={20}
        fontWeight={700}
        style={{ fill: "var(--illus-ink)" }}
      >
        {`illustration primitives — WP 0.2${subtitle ? ` · ${subtitle}` : ""}`}
      </text>
      <text
        x={MARGIN + 4}
        y={52}
        fontSize={ILLUS_TEXT.caption}
        style={{ fill: "var(--illus-ink-muted)" }}
      >
        {`true isometric · 1 unit = ${ISO_UNIT} px · every fill and stroke is an --illus-* token derived from the live theme`}
      </text>
      {tiles.map((tile, index) => {
        const column = index % COLUMNS;
        const row = Math.floor(index / COLUMNS);
        const x = MARGIN + column * (TILE_WIDTH + TILE_GAP);
        const y = HEADER + row * (TILE_HEIGHT + TILE_GAP);
        return (
          <g key={tile.caption} transform={`translate(${x} ${y})`}>
            <PaperStage
              width={TILE_WIDTH}
              height={TILE_HEIGHT}
              grid={grid && tile.plain !== true}
              crosshair={false}
              registration={tile.plain !== true}
            />
            <rect
              width={TILE_WIDTH}
              height={TILE_HEIGHT}
              rx={10}
              fill="none"
              strokeWidth={1}
              style={{ stroke: "var(--illus-guide)" }}
            />
            <g transform={`translate(${TILE_GROUND.x} ${TILE_GROUND.y})`}>{tile.content}</g>
            <text
              x={TILE_WIDTH / 2}
              y={TILE_HEIGHT - 14}
              fontSize={ILLUS_TEXT.caption}
              fontWeight={600}
              textAnchor="middle"
              style={{ fill: "var(--illus-ink)" }}
            >
              {tile.caption}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
