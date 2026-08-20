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
// ── SCOPE: this is WP 0.1's STUB, and the looseness below is deliberate ─────────────────────────────
// WP 0.1 fixes the ENVELOPE — `version`, `registryVersion`, `id`, the required `title` + `summary`,
// and `canvas` — so that nothing downstream invents a second one while Phase 0 is still drawing
// boxes. The `bands` / `nodes` / `connectors` / `annotations` / `steps` arrays are typed, and their
// enums are already closed, but they are otherwise PERMISSIVE: most fields are optional, and NOTHING
// here cross-references anything.
//
// Specifically, **WP 2.1 owns** — and this module must not be mistaken for — all of the following:
//
//   • resolving `node.component` against the live registry, and `connector.from` / `.to` against the
//     ports the referenced component actually declares (this module checks the *shape* of a port
//     reference, never its existence);
//   • checking that `band` names a declared band, that `steps[].focus` names declared nodes, and
//     that `steps[].connectors` names declared connectors;
//   • the layout semantics of each band kind, including the `cycle` band;
//   • deciding which of the optional arrays become required once the layout engine exists.
//
// Anyone tightening this file is doing WP 2.1, not WP 0.1. Anyone LOOSENING it is undoing D-IL10.
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

export type IllustrationSceneBand = {
  id: string;
  kind: IllustrationBandKind;
  /** Optional screen-aligned heading for the band. */
  title?: string;
};

export const illustrationSceneBandSchema = z
  .object({
    id: illustrationIdSchema,
    kind: illustrationBandKindSchema,
    title: z.string().min(1).optional(),
  })
  .strict();

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
   * The ONE place a scene may speak in coordinates (D-IL7): a per-node override, in grid units,
   * that opts this node out of its band's distribution. Connector endpoints are never coordinates.
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
  bands?: IllustrationSceneBand[];
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
    bands: z.array(illustrationSceneBandSchema).optional(),
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
