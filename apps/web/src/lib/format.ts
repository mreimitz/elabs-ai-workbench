// The figure formatters (number/percent/date/bytes) now live in @mcp-token-footprint/shared so the
// web UI (PDF report) and the API's Markdown report format figures identically — re-exported here so
// the ~30 existing `lib/format` importers are unchanged. App-only helpers stay below.
export {
  formatNumber,
  formatPercent,
  formatDateTime,
  formatBytes,
} from "@mcp-token-footprint/shared";

/** Wall-clock HH:MM:SS for a step's `startedAt` (the trace timeline's right-aligned timestamp). */
export function formatClock(value: string | undefined): string {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(d);
}

/**
 * Human-readable duration from milliseconds. Canonical replacement for the ~6 hand-rolled
 * `durationLabel`/`formatDuration` copies that used to live in the run-console/analytics views.
 * Sub-second → `"<n> ms"`; under a minute → seconds (2dp under 10 s for sub-second precision on
 * short tool calls, else 1dp); minutes → `"<m>m <s>s"`; hours → `"<h>h <m>m"`. `tabular-nums`
 * friendly (only digits + fixed unit suffixes). Callers own their empty/undefined sentinel
 * (`"—"`, `null`, …) — pass a real number here.
 */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "0 ms";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 2 : 1)} s`;
  const totalSeconds = Math.round(seconds);
  const minutes = Math.floor(totalSeconds / 60);
  const remSeconds = totalSeconds % 60;
  if (minutes < 60) return `${minutes}m ${remSeconds}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

/**
 * Money formatter for USD costs, `$`-prefixed and `tabular-nums` friendly (grouped thousands via
 * `Intl.NumberFormat`, matching `formatNumber`). Defaults to 2dp for headline costs; pass
 * `{ precision: 4 }` only where sub-cent precision is genuinely meaningful (per-turn / per-node
 * costs are fractions of a cent, so 2dp would collapse them all to `$0.00`).
 */
export function formatCostUsd(value: number, opts?: { precision?: number }): string {
  const precision = opts?.precision ?? 2;
  const safe = Number.isFinite(value) ? value : 0;
  return `$${new Intl.NumberFormat("en-US", {
    minimumFractionDigits: precision,
    maximumFractionDigits: precision,
  }).format(safe)}`;
}

export function safeJson(value: unknown): string {
  return JSON.stringify(value ?? null, null, 2);
}

/**
 * Human-relative time for a thread's `updatedAt`/`createdAt` (Assistant R2.1, D-AS24/D-AS26's render
 * half — the switcher row date + the header's active-thread date). Deliberately coarse, not a
 * live-ticking clock: "just now" under 45s, `"<n>m ago"` under an hour, `"<n>h ago"` under a day,
 * `"yesterday"` for the next calendar-agnostic day band, `"<n>d ago"` up to a week, then a short
 * absolute date (year included only when it differs from `now`'s). Pure — takes `now` so it's
 * deterministic under test; defaults to the real clock. An unparsable `iso` returns `""` (the caller's
 * empty-state, not a thrown error).
 */
export function formatRelativeTime(iso: string, now: Date = new Date()): string {
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return "";
  const diffMs = now.getTime() - then.getTime();
  if (diffMs < 45_000) return "just now";
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(diffMs / 3_600_000);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(diffMs / 86_400_000);
  if (days === 1) return "yesterday";
  if (days < 7) return `${days}d ago`;
  const sameYear = then.getFullYear() === now.getFullYear();
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: sameYear ? undefined : "numeric",
  }).format(then);
}

