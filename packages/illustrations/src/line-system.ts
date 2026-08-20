// ==================================================================================================
// The line system (research 3.2) — three weights, three dashes, nothing else
// ==================================================================================================
// Sketchiness in this style comes from the CONSTRUCTION layer — dashes, crosshairs, ghost outlines,
// registration marks — and never from wobbly paths. Wobble filters look cheap at small sizes, break
// under export, and cost render time; clean paths plus drafting marks keep the charm and survive
// both. So there are exactly three stroke weights, and a component picks one by NAME.

/** Silhouettes and solid edges: 2 px, round joins. */
export const ILLUS_STROKE_INK = 2;

/** Inner lines, face edges, slot marks: the 1.25-1.5 px band, taken at its top. */
export const ILLUS_STROKE_DETAIL = 1.5;

/** The finer half of the detail band, for small glyphs where 1.5 reads as heavy. */
export const ILLUS_STROKE_DETAIL_FINE = 1.25;

/** Guides, ghosts, crosshairs, leader lines: 1 px, always dashed. */
export const ILLUS_STROKE_CONSTRUCTION = 1;

/** The named weights, so a component says `weight="ink"` rather than `strokeWidth={2}`. */
export const ILLUS_STROKE_WEIGHTS = {
  ink: ILLUS_STROKE_INK,
  detail: ILLUS_STROKE_DETAIL,
  "detail-fine": ILLUS_STROKE_DETAIL_FINE,
  construction: ILLUS_STROKE_CONSTRUCTION,
} as const;

export type IllusStrokeWeight = keyof typeof ILLUS_STROKE_WEIGHTS;

/** The dash patterns. `construction` is the drafting dash; the other two belong to connectors. */
export const ILLUS_DASH = {
  construction: "4 4",
  dashed: "6 4",
  /** A zero-length dash with a round cap paints a dot, which is how `signal` reads as particles. */
  dotted: "0.1 6",
} as const;

/** Type sizes for the screen-aligned text layer. Labels are never skewed onto a face (D-IL2). */
export const ILLUS_TEXT = {
  label: 13,
  caption: 11.5,
  station: 15,
  port: 10.5,
} as const;
