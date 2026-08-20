// ==================================================================================================
// useFaceSeparation — the dev-mode hook the gallery and the preview surface mount
// ==================================================================================================
// Runs `assertFaceSeparation` against the LIVE document once per theme change, so an upstream token
// bump that quietly flattens a solid shows up as a console warning the first time somebody looks at
// an illustration, rather than months later in an export.
//
// In a production build `assertFaceSeparation` returns `null` before touching the DOM, so this hook
// costs one effect that does nothing. Under jsdom it also returns `null` — jsdom does not evaluate
// `color-mix`, so there is nothing to measure and, deliberately, nothing to warn about.

import { useEffect, useState } from "react";
import {
  type FaceSeparationReport,
  assertFaceSeparation,
  createProbeResolver,
} from "./face-separation.js";

/**
 * @param themeKey change it when the theme changes, to re-measure. Anything stable works — the
 *        theme name, or the `data-theme` value being applied.
 */
export function useFaceSeparation(themeKey?: string): FaceSeparationReport | null {
  const [report, setReport] = useState<FaceSeparationReport | null>(null);
  useEffect(() => {
    if (typeof document === "undefined") return;
    setReport(assertFaceSeparation({ resolve: createProbeResolver(document) }));
  }, [themeKey]);
  return report;
}
