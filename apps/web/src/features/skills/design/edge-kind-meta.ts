import { SKILL_EDGE_KINDS, type SkillEdgeKind } from "@mcp-token-footprint/shared";

/**
 * RM-30 WP 7.8 — how each of the five edge kinds DRAWS, and what it is called.
 *
 * The five kinds must be tellable apart on the canvas, and **not by colour alone**. This repo has
 * already locked that principle once — D-DB4, where the dashboard's footprint lines were made
 * distinguishable by stroke pattern rather than hue — and it applies here for the same reason: a
 * colour-only distinction disappears for a colour-blind reader, in a screenshot, and on a projector.
 *
 * So each kind carries THREE independent signals:
 *   1. a stroke DASH PATTERN (solid · dotted · long-dash · short-dash),
 *   2. a stroke WIDTH,
 *   3. a spoken NAME on the edge's accessible label, and the same name in the legend.
 * Colour is a fourth, weakest signal and only ever a semantic token — `--flow-edge` for the spine of
 * the flow, `--muted-foreground` for the things a step merely reaches for.
 *
 * `explainerId` points into the ONE explainer registry (`code-intel/explainers.ts`) so the legend, a
 * refused connection and a code hover all teach an edge kind with the same words and the same guide
 * link. It is never re-worded here.
 */
export type EdgeKindMeta = {
  /** Short human name, e.g. "Then". Used on the canvas legend and in refusal messages. */
  label: string;
  /** One line of what it MEANS at read time — the flow-view legend's second column. */
  meaning: string;
  /** SVG `stroke-dasharray`, or `undefined` for a solid line. THE primary non-colour signal. */
  dash: string | undefined;
  /** SVG `stroke-width`. The secondary non-colour signal. */
  width: number;
  /** A semantic token reference for the stroke — never a raw colour literal. */
  stroke: string;
  /** The `code-intel/explainers.ts` id that teaches this kind (title, teaching line, guide anchor). */
  explainerId: string;
};

// A Map, not a plain object. One of the five kinds is literally named `then`, and an object carrying a
// `then` key is a THENABLE — `await`ing it anywhere would call into this table instead of resolving
// it, which is exactly the trap Biome's `noThenProperty` guards. A Map cannot be mistaken for a
// promise, so the hazard is removed rather than suppressed. Read it through {@link edgeKindMeta}.
export const EDGE_KIND_META: ReadonlyMap<SkillEdgeKind, EdgeKindMeta> = new Map([
  [
    "triggers",
    {
      label: "Triggers",
      meaning: "This input is what causes the model to read the target at all.",
      dash: undefined,
      width: 2.5,
      stroke: "var(--flow-edge)",
      explainerId: "edge:triggers",
    },
  ],
  [
    "then",
    {
      label: "Then",
      meaning: "Having finished the source, the model reads the target next. Always read.",
      dash: undefined,
      width: 1.5,
      stroke: "var(--flow-edge)",
      explainerId: "edge:then",
    },
  ],
  [
    "contains",
    {
      label: "Contains",
      meaning: "The target is part of the source. Reading the parent means reading this.",
      dash: "1 5",
      width: 2,
      stroke: "var(--flow-edge)",
      explainerId: "edge:contains",
    },
  ],
  [
    "branch",
    {
      label: "Branch",
      meaning: "The model reads exactly one of these, whichever condition holds.",
      dash: "9 5",
      width: 1.5,
      stroke: "var(--flow-edge)",
      explainerId: "edge:branch",
    },
  ],
  [
    "uses",
    {
      label: "Uses",
      meaning: "The model may open this file or call this tool — it costs tokens only if it does.",
      dash: "3 4",
      width: 1.5,
      stroke: "var(--muted-foreground)",
      explainerId: "edge:uses",
    },
  ],
]);

/** An edge whose kind is absent (a graph projected before WP 7.8) draws as an honest unknown: the
 *  muted short-dash of a "maybe", never borrowed from a kind we cannot prove it has. */
export const UNKNOWN_EDGE_META: EdgeKindMeta = {
  label: "Connection",
  meaning: "Projected before edge kinds existed — its meaning is unknown.",
  dash: "3 4",
  width: 1.5,
  stroke: "var(--muted-foreground)",
  explainerId: "edge:uses",
};

/** The drawing + naming for an edge kind, falling back to the honest unknown. */
export function edgeKindMeta(kind: SkillEdgeKind | undefined): EdgeKindMeta {
  return (kind ? EDGE_KIND_META.get(kind) : undefined) ?? UNKNOWN_EDGE_META;
}

/** The five kinds in reading order — the legend iterates this, so it can never miss one. */
export const EDGE_KIND_ORDER: readonly SkillEdgeKind[] = SKILL_EDGE_KINDS;
