import type {
  ProviderCredential,
  RunGrade,
  RunSkill,
  RunSummary,
  Scenario,
  ScanSummary,
  Test,
  ToolLoadingMode,
} from "@mcp-token-footprint/shared";
import { apiGet, getRunGrades } from "../../../lib/api";
import { chartSeriesColor } from "../../../lib/chart-colors";
import { runStatusBadgeView } from "../RunBar";

/**
 * Shared domain for the Compare Workspace (audit §H). Every Phase-4 WP under `compare/` imports its
 * types + helpers from here so the parallel mode files (Summary/Flow/Metrics/Suite) never re-derive
 * the run set, the letter identity, or the comparability caveats. Kept JSX-free so it can be unit
 * tested and imported by any mode without pulling React.
 *
 * The workspace's identity system is the **letter** (Ⓐ/Ⓑ/Ⓒ …), assigned by a run's position in the
 * `?ids=` list — never the environment + wall-clock string the old view used (T9g). A run keeps its
 * letter (and its {@link runColor} series colour) across the bar, the verdict band, the matrix and
 * every chart.
 */

// ── Modes ────────────────────────────────────────────────────────────────────────────────────────

/** The content modes the workspace switches between. `suite` is entered via the `?suiteRunIds=` seam
 * (the Runs feed's suite multi-select), not the Summary|Flow|Metrics segmented control. */
export const COMPARE_MODES = ["summary", "flow", "metrics", "suite"] as const;
export type CompareMode = (typeof COMPARE_MODES)[number];

/** The three modes offered on the compare bar's segmented control (suite is a separate entry). */
export const RUN_COMPARE_MODES = ["summary", "flow", "metrics"] as const;
export type RunCompareMode = (typeof RUN_COMPARE_MODES)[number];

/**
 * Modes whose content isn't built yet (D2, compare-redesign §3.4). Drives the `soon` `Badge` the
 * compare bar's `ModeToggle` renders beside a mode's label, and the mode's own honest "coming soon"
 * empty state ({@link MetricsMode}). A "soon" mode is NOT hidden or disabled — its tab stays fully
 * clickable and its URL (`?mode=`) stays a valid deep link; only the badge + the empty state signal
 * it isn't real content yet, so a click is never a surprise.
 */
export const MODE_SOON: Readonly<Record<RunCompareMode, boolean>> = {
  summary: false,
  flow: false,
  metrics: true,
};

export function isCompareMode(value: string | null | undefined): value is CompareMode {
  return value != null && (COMPARE_MODES as readonly string[]).includes(value);
}

// ── Letter + colour identity ──────────────────────────────────────────────────────────────────────

/** Letter labels in comparison order. Runs beyond this cap are refused by the bar. */
export const COMPARE_LETTERS = ["A", "B", "C", "D", "E", "F"] as const;

/** The maximum comparison-set size (bounded by the letter alphabet; the 12-token chart ramp is
 *  comfortably wider, so a run's colour is unique across a full comparison set). */
export const MAX_COMPARE_RUNS = COMPARE_LETTERS.length;

/** The letter for a run at a given comparison index (A, B, C, …); empty past the cap. */
export function letterForIndex(index: number): string {
  return COMPARE_LETTERS[index] ?? "";
}

/** A run's stable series colour token, by its comparison index — shared across the bar's letter
 * badge, the matrix and every chart so a run reads as one colour everywhere. Cycling the full
 * 12-token ramp matters here: the old `% 5` gave run F the SAME colour as run A, in a view whose
 * entire job is telling runs apart. */
export function runColor(index: number): string {
  return chartSeriesColor(index);
}

// ── The resolved comparison set ────────────────────────────────────────────────────────────────────

/** One run in the comparison, resolved to everything the workspace renders about it. */
export type WorkspaceRun = {
  id: string;
  /** Comparison index (0-based); drives the letter + colour. */
  index: number;
  /** Display letter (A, B, C …). */
  letter: string;
  /** Series colour token (`var(--chart-N)`). */
  color: string;
  /** Whether this run is the baseline every Δ is measured against. */
  isBaseline: boolean;
  run: RunSummary;
  /** Resolved environment (scenario) name, or a placeholder when the scenario was deleted. */
  scenarioName: string;
  /** The scenario's model id (e.g. `gemma-4-12b`), or "—". */
  model: string;
  /** The provider label backing the scenario, or "". */
  providerLabel: string;
  /** Terminal-state label via the shared S3 vocabulary (never a raw literal). */
  statusLabel: string;
};

/** The reference data the workspace loads once to resolve any run id into a {@link WorkspaceRun}. */
export type CompareData = {
  runs: RunSummary[];
  runsById: Map<string, RunSummary>;
  testsById: Map<string, Test>;
  scenariosById: Map<string, Scenario>;
  providers: ProviderCredential[];
  /** Every server scan (all servers), newest-first isn't guaranteed — {@link deriveChangeMarkers}
   * sorts. Backs the H6 "server scan differs" change marker (the run→scan linkage isn't persisted, so
   * the marker is derived from the scan timeline vs each run's start time — see the marker doc). */
  scans: ScanSummary[];
};

/** Load every list the workspace needs to resolve run chips (no new API — the existing catalogues). */
export async function loadCompareData(): Promise<CompareData> {
  const [runs, tests, scenarios, providers, scans] = await Promise.all([
    apiGet<RunSummary[]>("/api/runs"),
    apiGet<Test[]>("/api/tests"),
    apiGet<Scenario[]>("/api/scenarios"),
    apiGet<ProviderCredential[]>("/api/providers"),
    // Best-effort: the scan catalogue backs the "server re-scanned" change marker (H6). A failure just
    // suppresses that one marker — the workspace still resolves runs.
    apiGet<ScanSummary[]>("/api/scans").catch(() => [] as ScanSummary[]),
  ]);
  return {
    runs,
    runsById: new Map(runs.map((run) => [run.id, run])),
    testsById: new Map(tests.map((test) => [test.id, test])),
    scenariosById: new Map(scenarios.map((scenario) => [scenario.id, scenario])),
    providers,
    scans,
  };
}

/** Best-effort latest-per-grader grades for a set of runs (a fetch failure yields no grades — the
 * ungraded caveat then fires honestly). Used by the verdict band's comparability check. */
export async function loadGradesForRuns(ids: string[]): Promise<Map<string, RunGrade[]>> {
  const entries = await Promise.all(
    ids.map((id) =>
      getRunGrades(id)
        .then((response) => [id, response.latest] as const)
        .catch(() => [id, [] as RunGrade[]] as const),
    ),
  );
  return new Map(entries);
}

/**
 * Resolve the ordered `ids` into the comparison set. Ids that no longer resolve to a run are dropped
 * (a deleted run simply leaves the comparison). The letter + colour follow the surviving order, so Ⓐ
 * is always the first live run. `baselineId` marks the baseline; when it is missing or unresolvable
 * the first run is the baseline.
 */
export function buildWorkspaceRuns(
  ids: string[],
  baselineId: string | null,
  data: CompareData,
): WorkspaceRun[] {
  const resolvedBaseline = baselineId && data.runsById.has(baselineId) ? baselineId : null;
  const out: WorkspaceRun[] = [];
  for (const id of ids) {
    const run = data.runsById.get(id);
    if (!run) continue;
    const index = out.length;
    const scenario = data.scenariosById.get(run.scenarioId);
    out.push({
      id,
      index,
      letter: letterForIndex(index),
      color: runColor(index),
      isBaseline: resolvedBaseline ? id === resolvedBaseline : index === 0,
      run,
      scenarioName: scenario?.name ?? "Unknown environment",
      model: scenario?.model ?? "—",
      providerLabel: scenario ? providerLabelFor(scenario, data.providers) : "",
      // AR11 — review-aware: a terminal run still being rated reads "Reviewing…". WP3.fix (D-US5) —
      // threads `stopReasonCode`/`phase` too, so this is the SAME precise locked-table label every
      // other run-status chip renders (e.g. "Expired", not "Stopped (guardrail)").
      statusLabel: runStatusBadgeView(
        run.status,
        run.outcome,
        run.ratingState,
        run.stopReasonCode,
        run.phase,
      ).label,
    });
  }
  return out;
}

function providerLabelFor(scenario: Scenario, providers: ProviderCredential[]): string {
  return (
    providers.find((provider) => provider.id === scenario.providerId)?.label ?? scenario.providerId
  );
}

/** The single testId every run in the set shares, or `null` when the set spans multiple tests. */
export function sharedTestId(runs: WorkspaceRun[]): string | null {
  const ids = new Set(runs.map((run) => run.run.testId));
  return ids.size === 1 ? [...ids][0]! : null;
}

/** A run's compact chip identity: `Environment · model · relative time` (T9g — never wall-clock only). */
export function runChipLabel(run: WorkspaceRun): string {
  const parts = [run.scenarioName];
  if (run.model && run.model !== "—") parts.push(run.model);
  parts.push(relativeTime(run.run.startedAt));
  return parts.join(" · ");
}

// ── Comparability caveats (H3 / T9h) ───────────────────────────────────────────────────────────────

export type CompareCaveatKind = "mixed-test" | "status" | "turns" | "grade";

/**
 * One comparability caveat — a plain sentence. Surfaced on the compare bar as a `⚠ n` chip + popover
 * (compare-redesign §3.1 C2); a `blocking` caveat ALSO renders a persistent {@link VerdictBand} Alert
 * band (mixed tests genuinely invalidate the comparison), while informational ones live only in the
 * chip. `blocking` is a CLIENT-side classification (not a wire field).
 */
export type CompareCaveat = {
  kind: CompareCaveatKind;
  text: string;
  /** Mixed tests are blocking (the runs aren't the same task); everything else is informational. */
  blocking?: boolean;
};

/**
 * The comparability guardrails (T9h), computed from the run summaries (+ optional grades). When runs
 * aren't comparable the verdict band leads with these instead of fake precision. This ships in WP 4.1;
 * the positive VERDICT sentences (token-slice decomposition, recommendation) are wired in WP 4.2/4.5
 * — see {@link CompareVerdict}.
 */
export function deriveCaveats(
  runs: WorkspaceRun[],
  gradesByRun?: Map<string, RunGrade[]>,
): CompareCaveat[] {
  if (runs.length < 2) return [];
  const caveats: CompareCaveat[] = [];

  // Mixed tests — the set spans more than one test (allowed, but the comparison is approximate).
  // BLOCKING: the runs answered different prompts, so a verdict would compare apples to oranges.
  if (sharedTestId(runs) == null) {
    caveats.push({
      kind: "mixed-test",
      blocking: true,
      text: "These runs are from different tests, so the comparison is approximate — matched metrics still line up, but the task itself differs.",
    });
  }

  // Outcome mismatch — runs ended differently, or all ended abnormally. Deltas then reflect where each
  // run stopped, not efficiency.
  const outcomes = new Set(runs.map((run) => run.run.outcome ?? run.run.status));
  const allAbnormal = runs.every((run) => isAbnormal(run.run.status, run.run.outcome));
  if (allAbnormal) {
    caveats.push({
      kind: "status",
      text: `All runs ended abnormally (${runs
        .map((run) => `${run.letter} ${run.statusLabel.toLowerCase()}`)
        .join(", ")}) — differences reflect where each run stopped, not efficiency.`,
    });
  } else if (outcomes.size > 1) {
    caveats.push({
      kind: "status",
      text: `Runs ended differently (${runs
        .map((run) => `${run.letter} ${run.statusLabel.toLowerCase()}`)
        .join(", ")}) — compare their outcomes before trusting the metric deltas.`,
    });
  }

  // Turn-count mismatch — totals across very different turn counts mislead; per-turn compares fairer.
  const turns = runs.map((run) => run.run.turns);
  const minTurns = Math.min(...turns);
  const maxTurns = Math.max(...turns);
  if (maxTurns - minTurns >= 2 && (minTurns === 0 || maxTurns / Math.max(1, minTurns) >= 1.5)) {
    caveats.push({
      kind: "turns",
      text: `Runs ran different numbers of turns (${runs
        .map((run) => `${run.letter} ${run.run.turns}`)
        .join(", ")}) — per-turn metrics compare more fairly than totals.`,
    });
  }

  // Ungraded — quality can't be compared until at least one grade exists on every run.
  if (gradesByRun) {
    const ungraded = runs.filter((run) => (gradesByRun.get(run.id)?.length ?? 0) === 0);
    if (ungraded.length > 0) {
      caveats.push({
        kind: "grade",
        text:
          ungraded.length === runs.length
            ? "No runs are graded, so output quality can't be compared — enable grading to add a quality verdict."
            : `Some runs are ungraded (${ungraded
                .map((run) => run.letter)
                .join(", ")}), so quality can't be compared across the set.`,
      });
    }
  }

  return caveats;
}

function isAbnormal(status: RunSummary["status"], outcome: RunSummary["outcome"]): boolean {
  if (status === "error" || status === "aborted" || status === "stopped") return true;
  if (outcome && outcome !== "completed") return true;
  return false;
}

// ── The positive verdict (typed slot; wired in WP 4.2/4.5) ─────────────────────────────────────────

export type CompareVerdictTone = "recommend" | "neutral" | "caution";

/** One verdict reason — a sentence that (in WP 4.3+) links into Flow mode at `focus`. */
export type CompareVerdictReason = {
  text: string;
  /** Opaque focus token (e.g. `B@t1`) the drill loop restores; unused until Flow mode lands. */
  focus?: string;
};

/**
 * The computed verdict sentence + its top reasons (H3). This is the EXTENSION POINT for WP 4.2/4.5:
 * they compute a {@link CompareVerdict} from the token-slice decomposition + grades and hand it to the
 * {@link VerdictBand} via its `verdict` prop. WP 4.1 always passes `null` (caveats only).
 */
export type CompareVerdict = {
  tone: CompareVerdictTone;
  headline: string;
  reasons: CompareVerdictReason[];
};

// ── Mode contracts (the props each mode file receives) ─────────────────────────────────────────────

/**
 * The stable prop contract every RUN mode (Summary / Flow / Metrics) receives from the workspace. WP
 * 4.1 ships each mode as a typed stub against THIS shape so WP 4.2 (Summary) and WP 4.3 (Flow) fill
 * disjoint files without touching the frame. `focus`/`onFocus` back the drill loop (H5, WP 4.4).
 */
export type RunModeProps = {
  /** The resolved comparison set, in letter order (Ⓐ first). */
  runs: WorkspaceRun[];
  /** The baseline run every Δ is measured against (already reflected in `runs[i].isBaseline`). */
  baselineId: string | null;
  /** The shared reference data (tests/scenarios/providers/all-runs) for any further lookups. */
  data: CompareData;
  /** The current opaque focus token from the URL (Flow position / step drawer), or null. */
  focus: string | null;
  /** Set/clear the focus token (writes `&focus=` without scrolling the page). */
  onFocus: (focus: string | null) => void;
};

/** The prop contract for the suite-compare mode (WP 4.6), entered via the `?suiteRunIds=` seam. */
export type SuiteModeProps = {
  /** The selected suite-run ids from the Runs feed's suite multi-select (WP 2.4). */
  suiteRunIds: string[];
  data: CompareData;
};

// ── Change markers (H6) — "why did these runs differ?" ──────────────────────────────────────────────

/**
 * The change-marker system (audit §H6 — "the single highest-value connection in the app"). When the
 * compared runs differ in a versioned input — the server scan behind a shared server, a resolved skill
 * version, the model, or the tool-loading mode — a small chip on the compare bar names the change and
 * (where a destination exists) deep-links the OTHER compare system pre-filled, joining a definition
 * change to the behaviour change one click apart.
 *
 * DATA CAVEAT (verified against `apps/api/src/db/schema.ts`): a run does NOT persist the scan id it
 * ran against — `runs`/`run_steps` carry no `scan_id`. So the "server scan differs" marker is derived
 * from the SCAN TIMELINE: for a server both scenarios share, we resolve the scan that was current at
 * each run's start (the newest successful scan at-or-before `startedAt`) and mark it when those differ.
 * That is a proxy ("the server was re-scanned between these runs, so its surface may have changed"),
 * not a literal record of what each run used — phrased accordingly in the chip.
 */
export type ChangeMarkerKind = "server-scan" | "skill-version" | "model" | "loading";

export type ChangeMarker = {
  kind: ChangeMarkerKind;
  /** The compact chip label (already human — e.g. "acme-stage re-scanned (+2 tools)"). */
  label: string;
  /** The longer tooltip / aria sentence. */
  detail: string;
  /** Pre-filled in-app destination (react-router path), or null for an informational-only chip. */
  href: string | null;
};

/** The scan-compare deep link (A = earlier baseline scan, B = later scan). Mirrors the Scans view's
 *  `diffVsPreviousHref` — replicated here so this module stays JSX/React-free and node-testable. */
function scanDiffHref(serverId: string, olderScanId: string, newerScanId: string): string {
  const params = new URLSearchParams({
    serverA: serverId,
    serverB: serverId,
    scanA: olderScanId,
    scanB: newerScanId,
  });
  return `/compare/scans?${params.toString()}`;
}

function shortDate(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "—";
  return new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/**
 * Derive the H6 change markers for the compared set. Pure so it is unit-tested without the bar.
 * `skillsByRun` is each run's resolved {@link RunSkill}s (from its `RunDetail.skills`, loaded by the
 * bar) — the authoritative source for the "skill version differs" marker. Returns `[]` for < 2 runs.
 */
export function deriveChangeMarkers(
  runs: WorkspaceRun[],
  data: CompareData,
  skillsByRun: Map<string, RunSkill[]>,
): ChangeMarker[] {
  if (runs.length < 2) return [];
  const markers: ChangeMarker[] = [];

  // Model — distinct models across the set (a token/cost delta then reflects the model change too).
  const models = [...new Set(runs.map((r) => r.model).filter((m) => m && m !== "—"))];
  if (models.length > 1) {
    markers.push({
      kind: "model",
      label: `Model ${models.join(" vs ")}`,
      detail: `These runs used different models (${models.join(", ")}) — token and cost deltas reflect the model change too.`,
      href: "/testing/environments",
    });
  }

  // Tool-loading mode — eager vs deferred across the scenarios (the H7 deferred-win comparison).
  const loadingModes = [
    ...new Set(
      runs
        .map((r) => data.scenariosById.get(r.run.scenarioId)?.toolLoadingMode)
        .filter((m): m is ToolLoadingMode => m != null),
    ),
  ];
  if (loadingModes.length > 1) {
    markers.push({
      kind: "loading",
      label: `Loading ${loadingModes.join(" → ")}`,
      detail: `Tool definitions were loaded differently across these runs (${loadingModes.join(", ")}) — a deferred run only pays for a tool's definition once the model calls it.`,
      href: "/testing/environments",
    });
  }

  markers.push(...serverScanMarkers(runs, data));
  markers.push(...skillVersionMarkers(runs, skillsByRun));
  return markers;
}

/** The scan current at a run's start: the newest successful scan at-or-before `startedAt`, or null. */
function scanAsOf(serverScansOldestFirst: ScanSummary[], startedAt: string): ScanSummary | null {
  const t = Date.parse(startedAt);
  let current: ScanSummary | null = null;
  for (const scan of serverScansOldestFirst) {
    if (Date.parse(scan.scannedAt) <= t) current = scan;
    else break;
  }
  return current;
}

function serverScanMarkers(runs: WorkspaceRun[], data: CompareData): ChangeMarker[] {
  // Servers referenced by EVERY run's scenario — the only comparable server surface.
  const serverSets = runs.map(
    (r) =>
      new Set(
        (data.scenariosById.get(r.run.scenarioId)?.allowedServers ?? []).map((s) => s.serverId),
      ),
  );
  const first = serverSets[0];
  if (!first) return [];
  const shared = [...first].filter((id) => serverSets.every((set) => set.has(id)));

  const out: ChangeMarker[] = [];
  for (const serverId of shared) {
    const serverScans = data.scans
      .filter((s) => s.serverId === serverId && s.status === "success")
      .sort((a, b) => Date.parse(a.scannedAt) - Date.parse(b.scannedAt));
    if (serverScans.length < 2) continue;

    const asOf = runs
      .map((r) => scanAsOf(serverScans, r.run.startedAt))
      .filter((s): s is ScanSummary => s != null);
    if (asOf.length < 2) continue;
    if (new Set(asOf.map((s) => s.id)).size < 2) continue; // same scan for all runs → no change

    const older = asOf.reduce((a, b) =>
      Date.parse(a.scannedAt) <= Date.parse(b.scannedAt) ? a : b,
    );
    const newer = asOf.reduce((a, b) =>
      Date.parse(a.scannedAt) >= Date.parse(b.scannedAt) ? a : b,
    );
    const toolDelta = newer.totalTools - older.totalTools;
    const name = newer.serverName || older.serverName || serverId;
    const deltaText =
      toolDelta === 0
        ? "tool set changed"
        : `${toolDelta > 0 ? "+" : "−"}${Math.abs(toolDelta)} tool${Math.abs(toolDelta) === 1 ? "" : "s"}`;
    out.push({
      kind: "server-scan",
      label: `${name} re-scanned (${deltaText})`,
      detail: `${name} was re-scanned between these runs (${shortDate(older.scannedAt)} → ${shortDate(newer.scannedAt)}): ${deltaText}. Open the scan diff to see exactly what changed.`,
      href: scanDiffHref(serverId, older.id, newer.id),
    });
  }
  return out;
}

function skillVersionMarkers(
  runs: WorkspaceRun[],
  skillsByRun: Map<string, RunSkill[]>,
): ChangeMarker[] {
  const skillIds = new Set<string>();
  for (const r of runs) for (const sk of skillsByRun.get(r.id) ?? []) skillIds.add(sk.skillId);

  const out: ChangeMarker[] = [];
  for (const skillId of skillIds) {
    const loaded = runs
      .map((r) => (skillsByRun.get(r.id) ?? []).find((sk) => sk.skillId === skillId))
      .filter((sk): sk is RunSkill => sk != null);
    if (loaded.length < 2) continue; // loaded by fewer than two runs → not comparable
    const first = loaded[0];
    if (!first) continue;
    const versions = [...new Set(loaded.map((sk) => sk.versionLabel))];
    if (versions.length < 2) continue;
    const name = first.name || skillId;
    out.push({
      kind: "skill-version",
      label: `${name} ${versions.join(" → ")}`,
      detail: `Skill "${name}" resolved to different versions across these runs (${versions.join(", ")}). Open the skill's version diff to see what changed.`,
      href: `/skills/${skillId}`,
    });
  }
  return out;
}

// ── Relative time ─────────────────────────────────────────────────────────────────────────────────

/** A compact, human relative time ("2m ago", "3h ago", "Fri", "Jul 4") for run chips. */
export function relativeTime(iso: string): string {
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return "—";
  const deltaMs = Date.now() - then;
  const min = Math.round(deltaMs / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hours = Math.round(min / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return new Date(then).toLocaleDateString(undefined, { weekday: "short" });
  return new Date(then).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
