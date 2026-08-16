import { SKILLFLOW_MARKER_PATTERN } from "@mcp-token-footprint/shared";

/**
 * WP 3.2 — the shared breadcrumb-marker matcher (roadmap/skillflow/breadcrumb-convention.md, D7b).
 * A skill instructs the agent to emit a single bracketed line at each gatekeeper decision, e.g.
 *
 *   [skillflow:gate=route-input route=r-csv]
 *
 * `extractMarkers` finds every such occurrence in a block of assistant prose and parses it into the
 * `{ raw, gateId?, routeId? }` shape the `marker` `TraceEvent` payload carries (WP 1.0). It is the
 * ONE matcher the run-trace normalizer (`run-trace.ts`) calls — the syntax is defined exactly once,
 * here.
 *
 * ## Parsing rules (tolerant, never throws)
 * - The bracket + `skillflow:` prefix must match ({@link SKILLFLOW_MARKER_PATTERN}); everything up to
 *   the closing `]` is the marker's inner content.
 * - The inner content is split into whitespace-separated `key=value` tokens, tolerant of whitespace
 *   around the `=` (`gate = X` normalizes the same as `gate=X`).
 * - `gate=<id>` -> `gateId`; `route=<id>` -> `routeId`. Both are optional per the convention (a
 *   marker naming only a section still visits it; see aligner.ts `matchMarkers`).
 * - Unknown keys, a missing `gate=` key, or content that doesn't parse as key=value pairs at all
 *   still produce a marker — just with no `gateId`/`routeId` (raw-only). A raw marker with no
 *   `gateId` matches nothing in the aligner (honest: it's surfaced as unmatched, never guessed at).
 * - Multiple markers in the same text all extract, in the order they appear.
 *
 * Pure and synchronous — no network, no filesystem, no model calls (D7).
 */
export type ExtractedMarker = {
  /** The exact matched text, e.g. `"[skillflow:gate=route-input route=r-csv]"`. */
  raw: string;
  gateId?: string;
  routeId?: string;
};

export function extractMarkers(text: string): { markers: ExtractedMarker[] } {
  const markers: ExtractedMarker[] = [];
  if (!text) return { markers };

  const pattern = new RegExp(SKILLFLOW_MARKER_PATTERN, "gi");
  let match: RegExpExecArray | null = pattern.exec(text);
  while (match !== null) {
    const raw = match[0];
    const inner = (match[1] ?? "").trim();
    const params = parseParams(inner);
    const gateId = params.gate;
    const routeId = params.route;
    markers.push({
      raw,
      ...(gateId ? { gateId } : {}),
      ...(routeId ? { routeId } : {}),
    });
    match = pattern.exec(text);
  }

  return { markers };
}

/** Parse `key=value key2=value2` tokens (whitespace-tolerant around `=`) into a lowercase-keyed record. */
function parseParams(inner: string): Record<string, string> {
  const params: Record<string, string> = {};
  const normalized = inner.replace(/\s*=\s*/g, "=");
  for (const token of normalized.split(/\s+/).filter(Boolean)) {
    const eq = token.indexOf("=");
    if (eq <= 0) continue; // no `=`, or `=` in the first position — not a key=value token
    const key = token.slice(0, eq).trim().toLowerCase();
    const value = token.slice(eq + 1).trim();
    if (key && value) params[key] = value;
  }
  return params;
}
