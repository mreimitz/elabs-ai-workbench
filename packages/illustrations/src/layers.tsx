// ==================================================================================================
// Layered rendering (D-IL16) — z-order belongs to the LAYER, never to an object
// ==================================================================================================
// Borrowed from architectural iso practice (grid, then structure, then entourage, then annotation).
// The consequence that matters is social rather than technical: because a component cannot lift
// itself above another one, two scenes drawn from the same parts look like the same hand drew them,
// no matter what order their authors happened to write the JSX in.
//
// A primitive declares the layer it belongs to ONCE, as a static on the component
// (`Connector.illusLayer = "connectors"`), so a call site cannot forget and cannot argue. Anything
// else — an entity's own shapes, a one-off — can be wrapped in `<Layer name="detail">`. Everything
// that declares nothing lands in `structure`, which is where a solid belongs.

import { Children, isValidElement } from "react";
import type { ReactElement, ReactNode } from "react";

/**
 * The fixed paint order. The array IS the z-order: index 0 is painted first and sits furthest back.
 * Adding a layer is a D-IL8-style grammar change, not a local decision.
 */
export const ILLUSTRATION_LAYERS = [
  "stage",
  "shadows",
  "structure",
  "detail",
  "connectors",
  "annotations",
  "labels",
] as const;

export type IllustrationLayer = (typeof ILLUSTRATION_LAYERS)[number];

/** Where an undeclared child goes: a solid, drawn above its shadow and below its detail. */
export const DEFAULT_ILLUSTRATION_LAYER: IllustrationLayer = "structure";

/** A component that knows which layer it paints into. */
export type LayeredComponent = { illusLayer?: IllustrationLayer };

export type LayerProps = {
  name: IllustrationLayer;
  children?: ReactNode;
};

/**
 * An explicit layer wrapper, for content that is not a primitive with its own declaration. Rendered
 * on its own (outside an `EntityRoot`) it is just a labelled group; collected by `collectLayers` it
 * is unwrapped and its children are merged into that layer's group.
 */
export function Layer({ name, children }: LayerProps): ReactElement {
  return <g data-illus-layer={name}>{children}</g>;
}

function declaredLayer(child: ReactNode): IllustrationLayer | undefined {
  if (!isValidElement(child)) return undefined;
  if (child.type === Layer) {
    const props = child.props as LayerProps;
    return props.name;
  }
  if (typeof child.type === "function") {
    return (child.type as LayeredComponent).illusLayer;
  }
  return undefined;
}

function unwrap(child: ReactNode): ReactNode {
  if (isValidElement(child) && child.type === Layer) {
    return (child.props as LayerProps).children;
  }
  return child;
}

/**
 * Sort children into the fixed layer order. Stable within a layer, so two solids written in
 * back-to-front order stay in it — the rule is that a layer cannot be jumped, not that authoring
 * order stops mattering at all.
 */
export function collectLayers(children: ReactNode): Record<IllustrationLayer, ReactNode[]> {
  const buckets = Object.fromEntries(
    ILLUSTRATION_LAYERS.map((layer) => [layer, [] as ReactNode[]]),
  ) as Record<IllustrationLayer, ReactNode[]>;

  for (const child of Children.toArray(children)) {
    // `Children.toArray` already drops null/undefined/booleans; an empty string survives it and
    // would otherwise create an empty layer group.
    if (child === "") continue;
    const layer = declaredLayer(child) ?? DEFAULT_ILLUSTRATION_LAYER;
    buckets[layer].push(unwrap(child));
  }
  return buckets;
}

/**
 * The collected children as `<g data-illus-layer="...">` groups, in paint order. Empty layers are
 * dropped rather than emitted as empty groups: an illustration's markup should read like the drawing
 * it is, and seven empty groups around one cube does not.
 */
export function renderLayers(children: ReactNode): ReactElement[] {
  const buckets = collectLayers(children);
  const groups: ReactElement[] = [];
  for (const layer of ILLUSTRATION_LAYERS) {
    const contents = buckets[layer];
    if (contents.length === 0) continue;
    groups.push(
      <g key={layer} data-illus-layer={layer}>
        {contents}
      </g>,
    );
  }
  return groups;
}
