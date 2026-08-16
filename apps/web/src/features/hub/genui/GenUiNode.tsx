// Assistant Hub (WP2.6, R-GUI2/3) — the recursive node renderer. Walks a SANITIZED tree and renders each
// node through the allowlisted `GENUI_RENDERERS` registry. A `$type` with no registered renderer yields
// NOTHING (the render-time allowlist — the security boundary); it is never a null hole in the layout
// because the validator already dropped unrenderable children before this component ever sees the tree
// (R-GUI3). Children are keyed by `$key` (stable list identity) with an index fallback.

import type { ReactNode } from "react";
import type { SanitizedGenuiNode } from "@mcp-token-footprint/shared";
import { GENUI_RENDERERS } from "./registry.js";
import type { GenuiRenderContext } from "./use-genui-state.js";

export function GenUiNode({ node, ctx }: { node: SanitizedGenuiNode; ctx: GenuiRenderContext }): ReactNode {
  const renderer = GENUI_RENDERERS[node.$type];
  if (!renderer) return null; // ALLOWLIST — an unknown component renders nothing (R-GUI2)
  const children =
    node.children.length > 0
      ? node.children.map((child, i) => (
          <GenUiNode key={child.$key ?? `${child.$type}-${i}`} node={child} ctx={ctx} />
        ))
      : null;
  return renderer({ node, ctx, children }) ?? null;
}
