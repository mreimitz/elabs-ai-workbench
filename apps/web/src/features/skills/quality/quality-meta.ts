import type { QualitySeverity } from "@mcp-token-footprint/shared";
import { Info, ShieldAlert, TriangleAlert } from "lucide-react";
import type { LucideIcon } from "lucide-react";

/**
 * Per-severity presentation for the Quality tab — the badge variant + a lucide glyph + the human label,
 * in ONE place so the score card and the finding list never drift. `error`/`warning` reuse the
 * semantic destructive/warning badge tokens (both themes); `info` is a neutral secondary.
 */
export const SEVERITY_META: Record<
  QualitySeverity,
  { label: string; badgeVariant: "destructive" | "warning" | "secondary"; icon: LucideIcon }
> = {
  error: { label: "Error", badgeVariant: "destructive", icon: ShieldAlert },
  warning: { label: "Warning", badgeVariant: "warning", icon: TriangleAlert },
  info: { label: "Info", badgeVariant: "secondary", icon: Info },
};

/** Fixed severity order (worst-first) for stable rendering of the breakdown + the findings list. */
export const SEVERITY_ORDER: QualitySeverity[] = ["error", "warning", "info"];

/**
 * The authoring-guide anchor for a rule id (WP 4.3). Mirrors the server's `qualityGuideAnchor` exactly
 * — `QualityFinding` carries no `guideAnchor` field, so the web DERIVES it. There is no in-app docs
 * route yet (a future platform WP), so the UI surfaces this as the repo file path/anchor reference.
 */
export function guideAnchorFor(ruleId: string): string {
  return `docs/skill-authoring.md#${ruleId}`;
}
