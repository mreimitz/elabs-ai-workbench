import { z } from "zod";
import {
  illustrationConnectorKindSchema,
  illustrationDetailLevelSchema,
  illustrationFacingSchema,
  illustrationIdSchema,
  illustrationSizeSchema,
  illustrationStateSchema,
  illustrationVersionSchema,
  type IllustrationConnectorKind,
  type IllustrationDetailLevel,
  type IllustrationFacing,
  type IllustrationSize,
  type IllustrationState,
} from "./illustration-registry.js";

// ==================================================================================================
// Illustration scene spec — the ONLY composition path (planning/Roadmap/RM-14-illustrations/, WP 0.1)
// ==================================================================================================
// **This module renders nothing.** It is the envelope every producer emits and every consumer reads:
// the assistant's `illustrations_compose_scene` (D-IL13), the in-repo explainer scenes, the explain-
// mode step player (D-IL11), the export path, and any future canvas authoring. There is no second
// composition path — that is the whole point of D-IL10, and it is why the shape lives here rather
// than in `packages/illustrations`: the API validates an authored spec WITHOUT importing React.
//
// It imports `zod` and its sibling `illustration-registry.js`, and nothing else — no `node:*`, no
// filesystem, no network, no React. The sibling import is deliberate: connector kinds, states, sizes
// and detail levels are ONE closed vocabulary (D-IL8), and a second copy of them in this file is
// precisely the drift the decision exists to prevent.
//
// ── SCOPE: the SHAPE lives here, the RESOLUTION does not (WP 0.1, tightened by WP 2.1) ─────────────
// WP 0.1 fixed the ENVELOPE — `version`, `registryVersion`, `id`, the required `title` + `summary`,
// and `canvas`. WP 2.1 tightened the composition arrays around the layout engine it was written for:
// `bands` became REQUIRED (a scene with nodes and no band has nowhere to put them), the band shape
// became a DISCRIMINATED UNION so a `cycle` carries the four fields a ring needs and a `lane` cannot
// carry them, and a node gained `attach` — pinned to a neighbour instead of sequenced.
//
// What still does NOT live here, and deliberately: every question that needs the live registry or a
// cross-reference within the spec. This module checks the SHAPE of a port reference, never that the
// port exists; the SHAPE of a band id on a node, never that the band was declared. Those are
// `validateScene(spec, registry)` in `@mcp-token-footprint/illustrations`
// (`src/scene/spec-validate.ts`), which is where the registry can be seen — and it returns a LIST of
// path-tagged errors rather than throwing, because an authoring surface needs every problem at once.
//
// The split is D-IL10's, not a convenience: `packages/shared` is imported by the API, which must
// validate an authored spec's shape without importing React, and the registry lives in the React
// package. Anyone moving a registry lookup into this file is breaking that.
//
// Locked decisions this module encodes:
//
//   • **D-IL10 — the spec is the only composition path, and a11y is schema-enforced.** `title` and
//     `summary` are REQUIRED, non-empty, at the top level, and every step carries a `caption`. The
//     text alternative is therefore not a thing an author can forget; it is a thing the parser
//     refuses to go without.
//   • **D-IL8 — a spec cannot express a raw style.** There is no `color`, no `stroke`, no `width`,
//     no `className` anywhere in this shape, and `.strict()` means adding one at a call site is a
//     rejection rather than an ignored key. Kinds map to `--illus-*` tokens inside the illustrations
//     package; a scene picks a MEANING and the package picks the pixels.
//   • **D-IL7 — connectors attach to ports.** An endpoint is the string `nodeId.port`, never a
//     coordinate. The one place raw coordinates appear is {@link IllustrationSceneNode.at}, the
//     documented per-node layout override.
//   • **D-IL9 — `registryVersion` is stamped into every spec**, so a scene whose components have
//     since moved is flagged rather than silently mis-rendered.

/**
 * The spec FORMAT's version, distinct from {@link ILLUSTRATION_REGISTRY_VERSION}: this one moves
 * when the envelope changes, that one when a component's contract does. A stored scene carries both,
 * and a reader needs both to know whether it can render what it just read.
 */
export const ILLUSTRATION_SCENE_SPEC_VERSION = 1;

/**
 * Canvas aspect, spelled exactly as `01-system-design.md` §4 spells it: `hero_wide` is 16:9,
 * `ultra` the wide banner, `square` the tile. Closed (D-IL8) — a scene picks a format, never a
 * pixel size, so the renderer stays free to choose a viewBox.
 */
export const ILLUSTRATION_CANVAS_FORMATS = ["hero_wide", "ultra", "square"] as const;
export type IllustrationCanvasFormat = (typeof ILLUSTRATION_CANVAS_FORMATS)[number];

/**
 * The stage under the drawing: `paper` is the drafting sheet with its grid and registration marks,
 * `plain` is the same stage with the grid off. This is the "grid on/off" half of the design's canvas
 * line; it is a named stage rather than a boolean so a third stage treatment never needs a second
 * flag next to it.
 */
export const ILLUSTRATION_STAGE_KINDS = ["paper", "plain"] as const;
export type IllustrationStageKind = (typeof ILLUSTRATION_STAGE_KINDS)[number];

/**
 * How a band distributes what is in it. `lane` spreads stations horizontally by `seq`, `hub` centers
 * its nodes as one shared group, `annotations` carries cards rather than entities, and `cycle` rings
 * the stations around a travel direction. **The layout semantics are WP 2.1's**; the names are fixed
 * here so a spec authored in Phase 0 or 1 does not have to be rewritten when the engine lands.
 */
export const ILLUSTRATION_BAND_KINDS = ["lane", "hub", "annotations", "cycle"] as const;
export type IllustrationBandKind = (typeof ILLUSTRATION_BAND_KINDS)[number];

/**
 * The two annotation cards the visual language has (research §2, `CalloutCard` / `PrincipleCard`).
 * Closed (D-IL8); it grows through the contribution process, not at a call site.
 */
export const ILLUSTRATION_ANNOTATION_KINDS = ["callout", "principle-card"] as const;
export type IllustrationAnnotationKind = (typeof ILLUSTRATION_ANNOTATION_KINDS)[number];

/** Where a card or a caption sits within its band. */
export const ILLUSTRATION_ALIGNMENTS = ["start", "center", "end"] as const;
export type IllustrationAlignment = (typeof ILLUSTRATION_ALIGNMENTS)[number];

/**
 * Which way a `cycle` band travels: `cw` clockwise on screen, `ccw` counter-clockwise. Closed
 * (D-IL8), and REQUIRED on a cycle band — a ring of stations with no travel direction is a circle of
 * boxes, not a loop, and the reader has no way to tell which way the process runs.
 */
export const ILLUSTRATION_CYCLE_DIRECTIONS = ["cw", "ccw"] as const;
export type IllustrationCycleDirection = (typeof ILLUSTRATION_CYCLE_DIRECTIONS)[number];

/**
 * A connector endpoint: `nodeId.port`, both halves kebab-case (D-IL7). This pattern checks the SHAPE
 * only. Whether that node exists, and whether that component declares that port, is the scene
 * validator's job in WP 2.1 — it needs the live registry, which this module deliberately cannot see.
 */
export const ILLUSTRATION_PORT_REF_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*\.[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const illustrationPortRefSchema = z.string().regex(ILLUSTRATION_PORT_REF_PATTERN, {
  message: "a connector endpoint is `nodeId.port`, both halves kebab-case (D-IL7)",
});

export const illustrationCanvasFormatSchema = z.enum(ILLUSTRATION_CANVAS_FORMATS);
export const illustrationStageKindSchema = z.enum(ILLUSTRATION_STAGE_KINDS);
export const illustrationBandKindSchema = z.enum(ILLUSTRATION_BAND_KINDS);
export const illustrationAnnotationKindSchema = z.enum(ILLUSTRATION_ANNOTATION_KINDS);
export const illustrationAlignmentSchema = z.enum(ILLUSTRATION_ALIGNMENTS);
export const illustrationCycleDirectionSchema = z.enum(ILLUSTRATION_CYCLE_DIRECTIONS);

// -- The pieces ------------------------------------------------------------------------------------

export type IllustrationCanvas = {
  format: IllustrationCanvasFormat;
  stage: IllustrationStageKind;
};

export const illustrationCanvasSchema = z
  .object({
    format: illustrationCanvasFormatSchema,
    stage: illustrationStageKindSchema,
  })
  .strict();

/**
 * Where the flow crosses a `cycle` band's ring, and how much of the ring is kept clear around that
 * crossing so a station is never drawn under the arrow. Both halves are optional: the layout engine
 * owns the defaults (entry on the left, exit on the right, a modest clearance either side), because
 * they are GEOMETRY and geometry does not belong in a wire contract.
 *
 * `angle` is degrees clockwise from screen-east, the same convention the ring itself is measured in.
 * A gate is not a port: it belongs to the BAND, and a connector reaches it as `bandId.entry` /
 * `bandId.exit` — which is why the endpoint pattern is satisfied without any node being involved.
 */
export type IllustrationSceneCycleGate = {
  angle?: number;
  /** Angular clearance either side of `angle`, in degrees, kept free of stations. */
  gap?: number;
};

export const illustrationSceneCycleGateSchema = z
  .object({
    angle: z.number().finite().optional(),
    gap: z.number().finite().nonnegative().optional(),
  })
  .strict();

/** The three band kinds that hold a flat row of content. */
export type IllustrationSceneRowBand = {
  id: string;
  kind: "lane" | "hub" | "annotations";
  /** Optional screen-aligned heading for the band. */
  title?: string;
};

/**
 * The ring (WP 2.1). It is a band KIND rather than an arrangement of nodes because the run-flow
 * exemplar proved the point in its own `$comment`: *"the lane/hub grammar cannot express an
 * execution loop"*. A loop needs four things a row does not have — how many stations sit on the
 * ring, which way the work travels, where the flow enters and leaves, and what one lap is CALLED
 * (`turns`, `retries`, `versions`), which is the label that turns a circle of boxes into a
 * countable process.
 */
export type IllustrationSceneCycleBand = {
  id: string;
  kind: "cycle";
  title?: string;
  /** How many station slots the ring holds. At least two: one station is not a cycle. */
  stations: number;
  direction: IllustrationCycleDirection;
  /** What one lap counts, shown beside the ring (`turns`). */
  counter?: string;
  entry?: IllustrationSceneCycleGate;
  exit?: IllustrationSceneCycleGate;
};

export type IllustrationSceneBand = IllustrationSceneRowBand | IllustrationSceneCycleBand;

export const illustrationSceneRowBandSchema = z
  .object({
    id: illustrationIdSchema,
    kind: z.enum(["lane", "hub", "annotations"]),
    title: z.string().min(1).optional(),
  })
  .strict();

export const illustrationSceneCycleBandSchema = z
  .object({
    id: illustrationIdSchema,
    kind: z.literal("cycle"),
    title: z.string().min(1).optional(),
    stations: z.number().int().min(2),
    direction: illustrationCycleDirectionSchema,
    counter: z.string().min(1).optional(),
    entry: illustrationSceneCycleGateSchema.optional(),
    exit: illustrationSceneCycleGateSchema.optional(),
  })
  .strict();

/**
 * Discriminated on `kind`, so `stations` is REQUIRED on a ring and IMPOSSIBLE on a lane. One flat
 * object with four optional fields would have let a `lane` carry a lap counter and a `cycle` omit
 * its direction — both nonsense a parser would then have waved through.
 */
export const illustrationSceneBandSchema = z.discriminatedUnion("kind", [
  illustrationSceneRowBandSchema,
  illustrationSceneCycleBandSchema,
]);

/**
 * One placed component. `component` is a registry id — resolved against the live registry by the
 * WP 2.1 validator, not here.
 */
export type IllustrationSceneNode = {
  id: string;
  component: string;
  band?: string;
  /** Position within a `lane` or `cycle` band. */
  seq?: number;
  /** Screen-aligned label above the node (D-IL2 — text is never skewed onto an iso face). */
  title?: string;
  caption?: string;
  variant?: string;
  state?: IllustrationState;
  size?: IllustrationSize;
  detail?: IllustrationDetailLevel;
  facing?: IllustrationFacing;
  /**
   * Another node's id. This node is PINNED to that one — placed relative to it rather than given a
   * slot of its own in the band's distribution — which is how the exemplar hangs a plan card off its
   * agent and a context stack off the loop station that appends to it. `seq` is ignored while
   * `attach` is set: a node cannot be both sequenced and pinned, and the pin is the stronger claim.
   */
  attach?: string;
  /**
   * The ONE place a scene may speak in coordinates (D-IL7): a per-node override, in grid units on
   * the SCREEN plane (1 unit = 16 px), that opts this node out of its band's distribution.
   * Connector endpoints are never coordinates.
   */
  at?: { x: number; y: number };
};

export const illustrationSceneNodeSchema = z
  .object({
    id: illustrationIdSchema,
    component: illustrationIdSchema,
    band: illustrationIdSchema.optional(),
    seq: z.number().int().optional(),
    title: z.string().min(1).optional(),
    caption: z.string().min(1).optional(),
    variant: illustrationIdSchema.optional(),
    state: illustrationStateSchema.optional(),
    size: illustrationSizeSchema.optional(),
    detail: illustrationDetailLevelSchema.optional(),
    facing: illustrationFacingSchema.optional(),
    attach: illustrationIdSchema.optional(),
    at: z.object({ x: z.number().finite(), y: z.number().finite() }).strict().optional(),
  })
  .strict();

export type IllustrationSceneConnector = {
  /** Optional, but a step that wants to spotlight this line needs it. */
  id?: string;
  from: string;
  to: string;
  kind: IllustrationConnectorKind;
  label?: string;
};

export const illustrationSceneConnectorSchema = z
  .object({
    id: illustrationIdSchema.optional(),
    from: illustrationPortRefSchema,
    to: illustrationPortRefSchema,
    kind: illustrationConnectorKindSchema,
    label: z.string().min(1).optional(),
  })
  .strict();

export type IllustrationSceneAnnotation = {
  kind: IllustrationAnnotationKind;
  band?: string;
  align?: IllustrationAlignment;
  title?: string;
  /** Bullet lines for a `principle-card`. */
  items?: string[];
  /** Prose for a `callout`. */
  body?: string;
  /** What the leader line points at, as `nodeId` or `nodeId.port`. */
  target?: string;
};

export const illustrationSceneAnnotationSchema = z
  .object({
    kind: illustrationAnnotationKindSchema,
    band: illustrationIdSchema.optional(),
    align: illustrationAlignmentSchema.optional(),
    title: z.string().min(1).optional(),
    items: z.array(z.string().min(1)).optional(),
    body: z.string().min(1).optional(),
    target: z.union([illustrationIdSchema, illustrationPortRefSchema]).optional(),
  })
  .strict();

/**
 * One beat of explain mode (D-IL11). `caption` is REQUIRED and non-empty because it is what the
 * `aria-live` region announces — a step with nothing to say is a step a screen-reader user
 * experiences as silence.
 */
export type IllustrationSceneStep = {
  focus: string[];
  connectors?: string[];
  caption: string;
  detail?: IllustrationDetailLevel;
};

export const illustrationSceneStepSchema = z
  .object({
    focus: z.array(illustrationIdSchema).min(1),
    connectors: z.array(illustrationIdSchema).optional(),
    caption: z.string().min(1),
    detail: illustrationDetailLevelSchema.optional(),
  })
  .strict();

// -- The envelope (fixed by WP 0.1) ----------------------------------------------------------------

export type IllustrationSceneSpec = {
  /** {@link ILLUSTRATION_SCENE_SPEC_VERSION}. */
  version: number;
  /** The registry version this scene was authored against (D-IL9). */
  registryVersion: string;
  id: string;
  /** Required, non-empty: the scene's name AND the SVG's `<title>` (D-IL10). */
  title: string;
  /** Required, non-empty: the text alternative, the SVG's `<desc>` (D-IL10). */
  summary: string;
  canvas: IllustrationCanvas;
  /**
   * REQUIRED since WP 2.1. Bands ARE the composition — a node names the band it belongs to and the
   * layout engine stacks bands vertically, so a scene with nodes and no band has nowhere to put
   * them. The previous optionality only ever meant "the engine does not exist yet".
   */
  bands: IllustrationSceneBand[];
  nodes: IllustrationSceneNode[];
  connectors?: IllustrationSceneConnector[];
  annotations?: IllustrationSceneAnnotation[];
  /** Present ⇒ the scene can be walked in explain mode (D-IL11). */
  steps?: IllustrationSceneStep[];
};

/**
 * `.strict()` at every level. A spec is authored by hand, by the assistant, and by a future canvas
 * editor; a key none of them agree on must be a rejection naming the field, never a silent drop that
 * leaves an author convinced their scene says something it does not.
 */
export const illustrationSceneSpecSchema = z
  .object({
    version: z.literal(ILLUSTRATION_SCENE_SPEC_VERSION),
    registryVersion: illustrationVersionSchema,
    id: illustrationIdSchema,
    title: z.string().min(1),
    summary: z.string().min(1),
    canvas: illustrationCanvasSchema,
    bands: z.array(illustrationSceneBandSchema).min(1),
    nodes: z.array(illustrationSceneNodeSchema).min(1),
    connectors: z.array(illustrationSceneConnectorSchema).optional(),
    annotations: z.array(illustrationSceneAnnotationSchema).optional(),
    steps: z.array(illustrationSceneStepSchema).optional(),
  })
  .strict();

/**
 * The default a scene author starts from, so "which detail level, which facing" is answered in one
 * place rather than re-decided per node. `standard` and `upstream` are the documented defaults
 * (D-IL16, D-IL17); the renderer applies them wherever a node leaves the field out.
 */
export const ILLUSTRATION_NODE_DEFAULTS: {
  readonly detail: IllustrationDetailLevel;
  readonly facing: IllustrationFacing;
  readonly state: IllustrationState;
} = {
  detail: "standard",
  facing: "upstream",
  state: "idle",
};
