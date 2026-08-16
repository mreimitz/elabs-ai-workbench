// Framework-free figure formatters — the SINGLE SOURCE OF TRUTH for number/byte/percent/date
// formatting shared by the web UI and the API's markdown report builder. The server report's
// per-model finding grouping derives its dedup key from `formatLimit` output (see report-derive.ts),
// so the web (PDF) and api (Markdown) renderings MUST format figures identically — re-implementing
// these on one side would desync the two reports. `apps/web/src/lib/format.ts` re-exports these.

export function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-US").format(Math.round(value));
}

export function formatPercent(value: number): string {
  return `${value.toFixed(1)}%`;
}

export function formatDateTime(value: string | undefined): string {
  if (!value) return "n/a";
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}
