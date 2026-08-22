// Pure, framework-free derivation helpers + display data for the server compatibility report.
// These were extracted from `apps/web/src/features/reports/reportRender.tsx` + `features/compatibility/meta.ts`
// so BOTH the web renderer (PDF) and the API markdown builder share ONE source of truth. Nothing here
// touches React or brand-ui — the colour/label *variant* maps (SEVERITY_META/OUTCOME_META) stay in web's
// meta.ts; this module owns only the logic (severity ordering, the detail filter, per-model grouping)
// and the plain text/data the report is built from. `reportRender.tsx` re-exports these symbols so the
// web's existing `./reportRender` imports are unchanged.

import type {
  CompatibilityResult,
  CompatibilitySeverity,
  CompatibilityTestEntry,
} from "./types.js";
import { formatBytes } from "./format.js";
import type { SeverityRampStep } from "./severity-ramp.js";

export type StatusKey = "pass" | "na" | CompatibilitySeverity;

export const FINDING_SEVERITIES: CompatibilitySeverity[] = ["blocker", "high", "medium", "low"];
export const STATUS_ORDER: StatusKey[] = ["blocker", "high", "medium", "low", "pass", "na"];

// ── Detail-level filter (which findings get a full detail block in the report) ─────────────────────
// `all` details every finding; the others gate detail at a minimum severity so only the tests that
// surfaced something serious get their own page — lower-severity findings stay in the ledger + the
// tool summary. Chosen in the export dialog; applied at render time (PDF) / serialization time (MD).

export type DetailLevel = "all" | "medium" | "high" | "blocker";

export const DETAIL_OPTIONS: { value: DetailLevel; label: string }[] = [
  { value: "all", label: "All findings" },
  { value: "medium", label: "Within limit & above" },
  { value: "high", label: "Near limit & above" },
  { value: "blocker", label: "Exceeds limit only" },
];

// ── RM-37 WP 0.5 (action 7) · compatibility severities, in LIMIT language ────────────────────────
//
// The wire values are frozen — `blocker`/`high`/`medium`/`low` still travel on `CompatibilityResult`,
// still weight the score in `apps/api/src/compatibility/runner.ts`, still gate the heatmap band.
// Only the WORDS change, and they change because the old ones described a mood rather than a
// measurement: "Blocker" told an operator to panic, where what the check actually established is
// that a number crossed a published model limit. "Exceeds limit" says the same thing and can be
// checked against the number printed beside it.
//
// The tones are NOT declared here. They come from `severity-ramp.ts`, so an "Exceeds limit" chip is
// the same red as a Critical chip elsewhere and a "Near limit" chip is the same amber as a High —
// which is the whole point of having one ramp.

/** The word for a compatibility severity. Wire value in, operator-facing phrase out. */
export const COMPATIBILITY_SEVERITY_LABEL: Record<CompatibilitySeverity, string> = {
  blocker: "Exceeds limit",
  high: "Near limit",
  medium: "Within limit",
  low: "Advice",
};

/** Compatibility severity → its step on the app's one {@link SEVERITY_RAMP}. */
export const COMPATIBILITY_SEVERITY_RAMP_STEP: Record<CompatibilitySeverity, SeverityRampStep> = {
  blocker: "critical",
  high: "high",
  medium: "medium",
  low: "low",
};

export const SEVERITY_RANK: Record<CompatibilitySeverity, number> = {
  blocker: 4,
  high: 3,
  medium: 2,
  low: 1,
};
const DETAIL_MIN_RANK: Record<DetailLevel, number> = { all: 1, medium: 2, high: 3, blocker: 4 };

/** Does a finding of `worst` severity warrant a full detail block at the chosen `level`? */
export function isDetailed(worst: CompatibilitySeverity, level: DetailLevel): boolean {
  return SEVERITY_RANK[worst] >= DETAIL_MIN_RANK[level];
}

/** A result's single legend outcome (mirrors the server-side tally in service.ts `buildEntries`). */
export function outcomeKey(result: CompatibilityResult): StatusKey {
  if (result.verdict === "pass") return "pass";
  if (result.verdict === "na") return "na";
  return result.severity;
}

/** The most severe finding (fail/warn) outcome across a test's models, or null if none. */
export function worstSeverity(
  counts: CompatibilityTestEntry["statusCounts"],
): CompatibilitySeverity | null {
  for (const s of FINDING_SEVERITIES) if ((counts[s] ?? 0) > 0) return s;
  return null;
}

/** Compact model label for a chip (drops provider boilerplate). */
export function shortModelName(displayName: string): string {
  return displayName
    .replace("Claude ", "")
    .replace(" Instruct", "")
    .replace("Microsoft 365 Copilot", "M365 Copilot");
}

export function formatLimit(value: string | number | boolean | null, unit?: string): string {
  if (value === null) return "";
  // Humanize raw byte counts (e.g. 524288 → "512 KB") instead of "524,288 bytes".
  if (unit === "bytes" && typeof value === "number") return formatBytes(value);
  const base =
    typeof value === "number"
      ? new Intl.NumberFormat("en-US").format(value)
      : typeof value === "boolean"
        ? value
          ? "yes"
          : "no"
        : value;
  return unit ? `${base} ${unit}` : base;
}

/** Strip developer-facing prefixes the resolver emits so the report reads as prose. */
export function cleanRationale(rationale: string): string {
  if (!rationale || rationale === "(default — no rule matched)") return "";
  return rationale.replace(/^\(model-invariant\)\s*/, "");
}

export function formatEvidenceValue(value: string | number | boolean | null): string {
  if (value === null) return "—";
  if (typeof value === "boolean") return value ? "yes" : "no";
  if (typeof value === "number") return new Intl.NumberFormat("en-US").format(value);
  return value;
}

// ── Per-model reasoning (grouped) ─────────────────────────────────────────────────────────────────

export type Explanation = { outcome: StatusKey; rep: CompatibilityResult; modelIds: string[] };

/** Group a test's per-model results by identical explanation (outcome + rationale + measured + limit +
 *  evidence + affected tools) so models that break the same way are shown once. Worst-first. */
export function groupExplanations(results: CompatibilityResult[]): Explanation[] {
  const order: string[] = [];
  const map = new Map<string, Explanation>();
  for (const r of results) {
    const key = [
      outcomeKey(r),
      cleanRationale(r.rationale),
      formatLimit(r.measured.value, r.measured.unit),
      formatLimit(r.threshold.value, r.threshold.unit),
      r.evidence.map((e) => `${e.field}=${formatEvidenceValue(e.value)}`).join(","),
      (r.affectedTools ?? []).map((t) => t.toolName).join(","),
    ].join("|");
    const existing = map.get(key);
    if (existing) existing.modelIds.push(r.modelId);
    else {
      map.set(key, { outcome: outcomeKey(r), rep: r, modelIds: [r.modelId] });
      order.push(key);
    }
  }
  return order
    .map((k) => map.get(k)!)
    .sort((a, b) => STATUS_ORDER.indexOf(a.outcome) - STATUS_ORDER.indexOf(b.outcome));
}

// ── Host-client targets + manual-review concerns (plain display data) ──────────────────────────────

/** Host-client targets that enable the client-layer tests (one of the engine's `cross.clients.*`). */
export const CLIENT_OPTIONS: { value: string; label: string }[] = [
  { value: "cursor", label: "Cursor" },
  { value: "claude_desktop", label: "Claude Desktop" },
  { value: "vscode_github_copilot", label: "VS Code · GitHub Copilot" },
  { value: "chatgpt", label: "ChatGPT" },
  { value: "m365_copilot", label: "Microsoft 365 Copilot" },
];

/** The human label for a host-client value (or the raw value if it isn't a known target). */
export function clientLabel(client?: string): string | null {
  if (!client) return null;
  return CLIENT_OPTIONS.find((c) => c.value === client)?.label ?? client;
}

/**
 * Concerns the static report deliberately does NOT cover (so it can't over-claim coverage). These
 * 6 need a human review — they aren't evaluable from a static tool surface + a model dataset.
 * Source: the compatibility suite's `excluded_from_automation` set.
 */
export const MANUAL_REVIEW_CONCERNS: { title: string; detail: string }[] = [
  {
    title: "OAuth / token-audience binding",
    detail:
      "Whether access tokens are correctly audience-scoped to this server can't be inferred statically.",
  },
  {
    title: "Input sanitization / prompt injection",
    detail:
      "Tool descriptions + results are untrusted; injection resistance needs a behavioural review.",
  },
  {
    title: "PII handling",
    detail: "What personal data a tool returns or logs is a data-flow question, not a schema one.",
  },
  {
    title: "DNS rebinding / certificate validation",
    detail: "Transport-layer hardening of the server's HTTP endpoint is out of static scope.",
  },
  {
    title: "Hardcoded secrets",
    detail:
      "Secrets embedded in the server implementation aren't visible from its tool definitions.",
  },
  {
    title: "Workflows, not endpoints",
    detail: "Whether the tool set composes into a safe end-to-end workflow is a design judgement.",
  },
];
