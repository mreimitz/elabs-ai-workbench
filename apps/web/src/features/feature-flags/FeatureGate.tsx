import type { AppFeatureId } from "@mcp-token-footprint/shared";
import type { ReactNode } from "react";
import { FeatureDisabledView } from "./FeatureDisabledView";
import { useFeatureEnabled } from "./feature-flags-context";

/**
 * Route wrapper for a feature that can be switched off in Settings › Features.
 *
 * The `<Route path="…">` literal is deliberately UNCHANGED — only the element swaps — for two
 * reasons: the route stays deep-linkable and self-explaining while the feature is off, and the
 * `assistant-route-operability` gate (`.claude/rules/assistant-operability.md`) keeps its
 * byte-identical string-set equality between `App.tsx`'s paths and `ASSISTANT_ROUTE_MANIFEST`.
 */
export function FeatureGate({
  feature,
  children,
}: {
  feature: AppFeatureId;
  children: ReactNode;
}) {
  const enabled = useFeatureEnabled(feature);
  if (!enabled) return <FeatureDisabledView feature={feature} />;
  return <>{children}</>;
}
