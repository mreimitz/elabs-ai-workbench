import { useEffect, useState } from "react";
import { META_RAIL_SHEET_BREAKPOINT_PX, META_RAIL_WIDTH_PX } from "../lib/hub-ux";

/**
 * Assistant Hub UX (WP1.2, D-HUX3) — "below ~1100 px of CONTENT width, the rail demotes to a right
 * `Sheet`". The rail itself has no reliable way to measure the CONVERSATION region's content width
 * from inside its own 360 px column (a fixed-width sibling can't observe its neighbor's size without
 * a shared ancestor ref) — that ref belongs to the two-column workspace layout, which is WP1.1's
 * `AssistantView.tsx`, out of this WP's scope. Until that wiring lands, this hook approximates with
 * the VIEWPORT width via `matchMedia`: viewport narrower than the breakpoint plus the rail's own
 * width is a reasonable stand-in for "the content column would drop under ~1100 px if the rail stayed
 * inline". `MetaRail`'s `isNarrow` prop lets an integrator override this with a real container-width
 * measurement without changing this hook's contract.
 */
export function useMetaRailNarrow(
  breakpointPx: number = META_RAIL_SHEET_BREAKPOINT_PX + META_RAIL_WIDTH_PX,
): boolean {
  const query = `(max-width: ${breakpointPx}px)`;
  const [narrow, setNarrow] = useState<boolean>(() => matchesNow(query));

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const media = window.matchMedia(query);
    const apply = () => setNarrow(media.matches);
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [query]);

  return narrow;
}

function matchesNow(query: string): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia(query).matches;
}
