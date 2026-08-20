import type { SecuritySeverity } from "@mcp-token-footprint/shared";
import { StatusBadge } from "../../components/StatusBadge";
import type { StatusTone, StatusView } from "../../lib/status";

/**
 * FindingSeverityBadge — a finding's severity as the app's ONE status chip.
 * =============================================================================================
 * `error` → danger (red filled), `warning` → warning (amber outline), `info` → info (blue outline),
 * straight onto `lib/status.ts`'s existing tone buckets. No new colour, no new chip, no tone of its
 * own — which is also why both themes are already correct.
 *
 * A finding's severity is its RULE's severity and nothing else (D-SP5), so this component reads the
 * value off the finding and never asks how bad the message sounds.
 */

const SEVERITY_TONE: Record<SecuritySeverity, StatusTone> = {
  error: "danger",
  warning: "warning",
  info: "info",
};

const SEVERITY_LABEL: Record<SecuritySeverity, string> = {
  error: "Error",
  warning: "Warning",
  info: "Info",
};

export function severityLabel(severity: SecuritySeverity): string {
  return SEVERITY_LABEL[severity];
}

export function severityView(severity: SecuritySeverity): StatusView {
  return {
    kind: "chip",
    label: SEVERITY_LABEL[severity],
    tone: SEVERITY_TONE[severity],
    spinner: false,
    dashed: false,
  };
}

export function FindingSeverityBadge({
  severity,
  className,
}: {
  severity: SecuritySeverity;
  className?: string;
}) {
  return <StatusBadge view={severityView(severity)} className={className} />;
}
