// ==================================================================================================
// Scene annotations — the two card kinds, placed by the layout, drawn from primitives (WP 2.3)
// ==================================================================================================
// `callout` and `principle-card` are the whole closed set (D-IL8,
// `illustration-scene.ts:99-103`), and both already exist as primitives from WP 0.2. This file is
// the ADAPTER between the two halves the scene engine keeps apart:
//
//   • WP 2.1's `SceneAnnotationLayout` knows WHERE a card goes — its slot's frame — and nothing
//     about what it says;
//   • `IllustrationSceneAnnotation` knows what it SAYS — title, items, body, target — and nothing
//     about where it goes.
//
// Nothing here computes a position. Every number a card is drawn at came out of `layoutScene`, and
// the one thing this file decides for itself is where a body string BREAKS — see below.
//
// No `@elabs-ai/components-*` import, and there must never be one: illustrations are content
// graphics, not UI controls (D-IL14), and this package has no such dependency to reach for.

import type { IllustrationSceneAnnotation } from "@mcp-token-footprint/shared";
import type { ReactElement } from "react";
import { ILLUS_TEXT } from "../line-system.js";
import { CARD_PADDING, CalloutCard } from "../primitives/CalloutCard.js";
import { PrincipleCard } from "../primitives/PrincipleCard.js";
import type { SceneAnnotationLayout, ScenePoint } from "./layout.js";
import { LABEL_ADVANCE_RATIO } from "./route.js";

/**
 * The fewest characters a body line may be asked to hold. A pathologically narrow slot must still
 * produce a finite wrap rather than one word per line forever.
 */
export const ANNOTATION_MIN_LINE_CHARS = 8;

/**
 * How many characters of `body` fit on one line of a card `width` px wide.
 *
 * The advance ratio is WP 2.2's {@link LABEL_ADVANCE_RATIO}, imported rather than restated: this
 * package gets ONE answer to "how wide is a character", for the same reason the router has one — a
 * measured width cannot exist in a pure function and would differ between a browser and a test
 * runner. `CalloutCard` takes PRE-BROKEN lines precisely because it refuses to measure text.
 */
export function annotationLineBudget(width: number): number {
  const usable = width - 2 * CARD_PADDING;
  const advance = ILLUS_TEXT.caption * LABEL_ADVANCE_RATIO;
  return Math.max(ANNOTATION_MIN_LINE_CHARS, Math.floor(usable / advance));
}

/**
 * Greedy word wrap at `maxChars`. Deterministic, allocation-cheap, and it never loses a word: a
 * single token longer than the budget takes a line of its own rather than being cut.
 */
export function wrapAnnotationBody(body: string, maxChars: number): readonly string[] {
  const words = body.split(/\s+/).filter((word) => word !== "");
  if (words.length === 0) return [];
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    if (current === "") {
      current = word;
      continue;
    }
    if (current.length + 1 + word.length <= maxChars) {
      current = `${current} ${word}`;
      continue;
    }
    lines.push(current);
    current = word;
  }
  lines.push(current);
  return lines;
}

export type SceneAnnotationCardProps = {
  readonly annotation: IllustrationSceneAnnotation;
  readonly layout: SceneAnnotationLayout;
  /**
   * What the callout's leader points at, already resolved to a canvas point by the caller —
   * `layout.endpoints[target]` for a `nodeId.port`, the node's own laid-out `origin` for a bare
   * `nodeId`. `null` draws a card with no leader, which is what a `principle-card` always is.
   */
  readonly anchor: ScenePoint | null;
};

/**
 * One annotation card. Returns `null` for a kind this file does not know — unreachable today
 * (`IllustrationAnnotationKind` is the closed two) and deliberately not a throw: a scene that
 * cannot draw one card should still draw the rest of itself.
 */
export function SceneAnnotationCard({
  annotation,
  layout,
  anchor,
}: SceneAnnotationCardProps): ReactElement | null {
  const at: ScenePoint = { x: layout.frame.x, y: layout.frame.y };
  const width = layout.frame.width;

  if (annotation.kind === "principle-card") {
    return (
      <PrincipleCard
        at={at}
        width={width}
        title={annotation.title ?? ""}
        items={annotation.items ?? []}
      />
    );
  }

  if (annotation.kind === "callout") {
    const body = annotation.body ?? "";
    const lines = body === "" ? [] : wrapAnnotationBody(body, annotationLineBudget(width));
    return (
      <CalloutCard
        at={at}
        width={width}
        title={annotation.title ?? ""}
        lines={lines}
        anchor={anchor ?? undefined}
      />
    );
  }

  return null;
}
