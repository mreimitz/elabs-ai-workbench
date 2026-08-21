/**
 * Runs feed — column visibility + preview-cell preference (Observability WP 2.3). Pure, React-free.
 *
 * Name and Actions are pinned identity/action columns and are never hideable; the Grade column keeps
 * its EXISTING auto-visibility rule (`shouldShowGradeColumn`, `runs-table-model.ts` — shown only when
 * something in view is graded) and is intentionally NOT part of the user-toggleable set either. Every
 * other column in {@link RUN_TABLE_COLUMNS} can be hidden via {@link RunColumnChooser}.
 *
 * This is the shape a saved {@link import("@mcp-token-footprint/shared").RunView}'s `columns` field
 * carries — OPAQUE to the API (it only bounds the serialized byte size), so `normalizeColumnsPreference`
 * is the sole place that gives it meaning, defensively (a malformed/foreign blob — an older client, a
 * hand-edited view — falls back to {@link DEFAULT_RUN_COLUMNS_PREFERENCE} rather than throwing).
 */

export const RUN_TABLE_COLUMNS = [
  "type",
  "environment",
  "status",
  "turns",
  "tools",
  "tokens",
  // RM-33 — the cache-read share of this run's GROSS input. Opt-in and hidden by default, exactly as
  // `tokens` is: it answers a specific question ("which runs are re-paying for context they already
  // sent?") rather than one every operator needs on every row.
  "cacheHitRate",
  "cost",
  "started",
  "duration",
] as const;

/**
 * Sessions lens (Observability WP 2.4) — additive session-only columns, kept as a SEPARATE vocabulary
 * from {@link RUN_TABLE_COLUMNS} rather than merged into it: the general column set is reused
 * verbatim by the suite-run console's Runs tab (`SuiteMembersTab`/`TestGroupRow`) with an implicit
 * "show every column" default, and those columns have no session-specific meaning there. Keeping them
 * separate means the general table's default shape (and every consumer that doesn't opt in) is
 * byte-unchanged; only the "Sessions" preset ({@link import("./run-filter-url").RUN_VIEW_PRESETS})
 * turns them on, via {@link SESSION_COLUMNS_PREFERENCE}. Not offered in {@link RunColumnChooser} (a
 * general-table control) — they're preset-managed, not individually toggled.
 */
export const SESSION_ONLY_COLUMNS = ["kind", "activeDuration", "waiting", "lastActivity", "seen"] as const;

export type RunTableColumnKey = (typeof RUN_TABLE_COLUMNS)[number] | (typeof SESSION_ONLY_COLUMNS)[number];

/** Every recognized column key (base + session-only) — the membership set `normalizeColumnsPreference`
 *  validates a saved/preset `visible` list against. */
export const ALL_RUN_TABLE_COLUMNS: readonly RunTableColumnKey[] = [
  ...RUN_TABLE_COLUMNS,
  ...SESSION_ONLY_COLUMNS,
];

export const RUN_TABLE_COLUMN_LABELS: Record<RunTableColumnKey, string> = {
  type: "Type",
  environment: "Environment",
  status: "Status",
  turns: "Turns",
  tools: "Tools",
  tokens: "Tokens",
  cacheHitRate: "Cache hit",
  cost: "Cost",
  started: "Started",
  duration: "Duration",
  kind: "Kind",
  activeDuration: "Active",
  waiting: "Waiting",
  lastActivity: "Last activity",
  seen: "Seen",
};

/** The Sessions lens column set (Observability WP 2.4 DESIGN): environment, model/kind chip, turn
 *  count, active duration, waiting time, last activity, phase/status chip (carries the feedback chip
 *  too, WP2.5), seen marker, cost. Order here is membership-only — actual left-to-right order is the
 *  fixed JSX sequence in `RunsTableHead`/`RunTableRow`/`SuiteTableRows`. */
export const SESSION_TABLE_COLUMNS: RunTableColumnKey[] = [
  "environment",
  "kind",
  "activeDuration",
  "waiting",
  "lastActivity",
  "seen",
  "status",
  "turns",
  "cost",
];

/** Applying the "Sessions" preset switches wholesale to this column set (never merged with whatever
 *  the operator had visible before — a deliberate lens swap, mirroring the preset's own filter swap). */
export const SESSION_COLUMNS_PREFERENCE: RunColumnsPreference = {
  visible: SESSION_TABLE_COLUMNS,
  previewMode: "none",
};

/** The expandable per-row preview line's content source (DESIGN spec: "preview cell options: last
 *  assistant text · stopReason · error · cost · feedback chips"). `lastAssistantText` degrades to the
 *  search-hit snippet when the row's best FTS match came from the `assistant` content class (the feed
 *  carries no full per-run transcript, only WP1.3's indexed-hit snippet) — see `RunPreviewRow`.
 *  `feedback` renders the run's `RunSummary.feedback` aggregate (WP 2.5, D-OB15) as read-only chips. */
export const PREVIEW_MODES = [
  "none",
  "snippet",
  "lastAssistantText",
  "stopReason",
  "error",
  "cost",
  "feedback",
] as const;

export type PreviewMode = (typeof PREVIEW_MODES)[number];

export const PREVIEW_MODE_LABELS: Record<PreviewMode, string> = {
  none: "None",
  snippet: "Search snippet",
  lastAssistantText: "Last assistant text",
  stopReason: "Stop reason",
  error: "Error",
  cost: "Cost breakdown",
  feedback: "Feedback chips",
};

export type RunColumnsPreference = {
  /** Which OPTIONAL columns render (Name/Actions always show; Grade follows `shouldShowGradeColumn`). */
  visible: RunTableColumnKey[];
  /** The expandable preview row's content source; `"none"` renders no per-row disclosure at all. */
  previewMode: PreviewMode;
};

/**
 * The default-visible optional columns (design-remediation T8, critique §"The Testing information
 * architecture" / Persona "Alex"). The Runs table used to default to EVERY optional column, which
 * pushed the four columns an operator actually triages a run on — Cost, Grade, Started, Duration —
 * off the right edge, behind `Type` ("Single" in every row of a single-run-only feed) and `Tools`
 * ("0" in every non-tool run). The default now leads with the triage set: rendered left-to-right the
 * table reads **Name · Status · Cost · Grade? · Started · Duration** (Name + Actions are always
 * pinned; Grade auto-shows via {@link shouldShowGradeColumn} whenever anything in view is graded,
 * and sits in the fixed JSX slot right of Cost). `type`, `environment`, `turns`, `tools` and `tokens`
 * are NOT deleted — they stay fully toggleable through {@link RunColumnChooser} for anyone who wants
 * them back — they just no longer crowd out triage by default.
 */
export const DEFAULT_RUN_COLUMNS_PREFERENCE: RunColumnsPreference = {
  visible: ["status", "cost", "started", "duration"],
  previewMode: "none",
};

function isRunTableColumnKey(value: unknown): value is RunTableColumnKey {
  return typeof value === "string" && (ALL_RUN_TABLE_COLUMNS as readonly string[]).includes(value);
}

function isPreviewMode(value: unknown): value is PreviewMode {
  return typeof value === "string" && (PREVIEW_MODES as readonly string[]).includes(value);
}

/** Defensively coerce an OPAQUE `RunView.columns` blob (or anything else) into a valid
 *  {@link RunColumnsPreference}, falling back field-by-field to the default rather than throwing —
 *  a saved view from an older/foreign client never breaks the feed. */
export function normalizeColumnsPreference(raw: unknown): RunColumnsPreference {
  if (raw === null || typeof raw !== "object") return DEFAULT_RUN_COLUMNS_PREFERENCE;
  const obj = raw as Record<string, unknown>;
  const visibleRaw = obj.visible;
  const visible = Array.isArray(visibleRaw)
    ? [...new Set(visibleRaw.filter(isRunTableColumnKey))]
    : DEFAULT_RUN_COLUMNS_PREFERENCE.visible;
  const previewMode = isPreviewMode(obj.previewMode)
    ? obj.previewMode
    : DEFAULT_RUN_COLUMNS_PREFERENCE.previewMode;
  return { visible, previewMode };
}

/** Column count for the shared `colSpan` (Name + Actions + every VISIBLE optional column + Grade?). */
export function runTableColumnCount(showGrade: boolean, visible: readonly RunTableColumnKey[]): number {
  return 2 + visible.length + (showGrade ? 1 : 0);
}

/** A `Set` for O(1) `.has()` checks in the row renderers — built once per render from the preference. */
export function toVisibleColumnSet(visible: readonly RunTableColumnKey[]): Set<RunTableColumnKey> {
  return new Set(visible);
}
