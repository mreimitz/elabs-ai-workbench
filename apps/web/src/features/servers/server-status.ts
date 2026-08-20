import type { ScanSummary, ServerAuthType } from "@mcp-token-footprint/shared";
import type { StatusView } from "../../lib/status";

/**
 * A server's HEALTH — one resolved state derived from its latest scan (RM-32; lifted verbatim out of
 * the deleted `ServerRail` so nothing was lost with the rail).
 *
 * Two rules this encodes, both from the original audit finding (T7): a failure was carried by COLOUR
 * ALONE, and a never-scanned server looked identical to a healthy one. So every state has a token dot
 * AND, for the states that need attention, a labelled chip — the state is never colour-only and is
 * always in the row's or card's accessible name.
 *
 * Named `deriveServerHealth`, not `serverHealth`: `lib/optimize.ts` already exports a `serverHealth`
 * that means something entirely different (a token-footprint quality read of a scan's tools).
 */
export type HealthTone = "success" | "danger" | "warning" | "info" | "neutral";

export type ServerHealth = {
  label: string;
  dotTone: HealthTone;
  /** Show the labelled chip (the attention states); healthy/scanning carry only the aria-labelled dot. */
  showChip: boolean;
  view: StatusView;
};

/** Filled token dot per tone; never-scanned reads as a dashed hollow ring (not "just another colour"). */
export const HEALTH_DOT_CLASS: Record<HealthTone, string> = {
  success: "bg-success",
  danger: "bg-destructive",
  warning: "bg-warning",
  info: "bg-info",
  neutral: "border border-dashed border-muted-foreground/60 bg-transparent",
};

export function deriveServerHealth(latestScan: ScanSummary | undefined): ServerHealth {
  const make = (
    label: string,
    tone: HealthTone,
    opts?: { dashed?: boolean; showChip?: boolean },
  ): ServerHealth => ({
    label,
    dotTone: tone,
    showChip: opts?.showChip ?? true,
    view: { kind: "chip", label, tone, spinner: tone === "info", dashed: opts?.dashed ?? false },
  });
  if (!latestScan) return make("Not scanned", "neutral", { dashed: true });
  if (latestScan.status === "running") return make("Scanning…", "info", { showChip: false });
  if (latestScan.status === "failed") {
    // `authRequired` is only ever set for an oauth-HTTP server whose token needs interactive sign-in.
    return latestScan.authRequired ? make("Auth expired", "warning") : make("Scan failed", "danger");
  }
  return make("Healthy", "success", { showChip: false });
}

export const AUTH_LABELS: Record<ServerAuthType, string> = {
  none: "No auth",
  bearer: "Bearer",
  api_key: "API key",
  oauth: "OAuth",
  custom_headers: "Headers",
};
