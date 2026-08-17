import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import type { RunDetail, RunGrade, RunSkill, RunStep } from "@mcp-token-footprint/shared";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Popover,
  PopoverContent,
  PopoverTrigger,
  StatePanel,
  Text,
  ToggleGroup,
  ToggleGroupItem,
} from "@elabs-ai/components-ui";
import {
  AlertTriangle,
  ArrowRight,
  BarChart3,
  Cpu,
  GitCompareArrows,
  Layers,
  LineChart as LineChartIcon,
  Package,
} from "lucide-react";
import { getRun, getRunGrades } from "../../../lib/api";
import { VerdictBand } from "./VerdictBand";
import { DeltaMatrix } from "./matrix/DeltaMatrix";
import { DeltaBarPanel } from "./matrix/DeltaBarPanel";
import { ContextCurves } from "./matrix/ContextCurves";
import { summaryFormatters } from "./matrix/summary-format";
import { NextSteps } from "./next-steps/NextSteps";
import { deriveNextSteps } from "./next-steps/next-steps-derive";
import {
  deriveCaveats,
  deriveChangeMarkers,
  type ChangeMarker,
  type ChangeMarkerKind,
  type CompareCaveat,
  type RunModeProps,
} from "./compare-runs";
import { buildSummaryRuns, deriveVerdict, shouldShowCurves } from "./summary-derive";

/**
 * Summary mode (audit §H3 / §G13.2–4; reordered per compare-redesign §3.3) — answers "which setup
 * wins, by how much, can I trust it, what changed, and what should I do about it" in that order, in
 * the first viewport. Ordered by QUESTION, not by component:
 *
 *   1. the **verdict** (H3) — a computed recommendation + token-slice reasons, rendered via the
 *      {@link VerdictBand}'s `verdict` slot, with a `⚠ n` comparability-caveat chip inline beside the
 *      headline (§3.3.1) — computed locally via {@link deriveCaveats} so `compare-runs.ts` stays
 *      untouched. Suppressed (no verdict row) when the set isn't cleanly comparable, so the
 *      workspace's blocking caveats lead instead of a fake winner (acceptance T9h);
 *   2. **"What changed"** — the H6 change-marker chips, re-homed here from the interim strip
 *      {@link CompareWorkspace} rendered above every mode (compare-redesign step 6) — Summary is their
 *      primary home now (a Flow marker row is deferred, see step 6's spec);
 *   3. the **Environment matrix** ({@link DeltaMatrix}, the evidence) — value + Δ% vs baseline;
 *   4. the two honest charts, side by side ≥1400px — the grouped **{@link DeltaBarPanel}** + the
 *      **{@link ContextCurves}** (only when a run has > 2 turns), zero-information metrics collapsed
 *      to text;
 *   5. **{@link NextSteps} last** — action cards read as a footer ("now do X"), minus the export card
 *      (S2 — the compare bar's `Export` split button is the one canonical export action).
 *
 * The matrix/verdict/curves/markers need each run's step trace (context snapshots, tool errors),
 * grades, and resolved skill versions, which Summary loads here (existing `GET /api/runs/:id` +
 * `/grades` — no new API, no new fetch for markers: `skillsById` already carries `RunDetail.skills`).
 * Summary values that live on the run summary (tokens/cost/turns) render immediately; the
 * trace-derived columns (peak-context %, quality, slice reasons, markers) fill in when details arrive.
 */
export function SummaryMode({ runs, data, focus: _focus }: RunModeProps) {
  const [stepsById, setStepsById] = useState<Map<string, RunStep[]>>(new Map());
  const [gradesById, setGradesById] = useState<Map<string, RunGrade[]>>(new Map());
  const [skillsById, setSkillsById] = useState<Map<string, RunSkill[]>>(new Map());
  const [perTurnMode, setPerTurnMode] = useState(false);
  const [, setSearchParams] = useSearchParams();

  const idsKey = useMemo(() => runs.map((r) => r.id).join(","), [runs]);

  useEffect(() => {
    const ids = idsKey.split(",").filter(Boolean);
    if (ids.length === 0) return;
    let active = true;
    // Best-effort per-run detail + grades; a failed fetch simply leaves that run's trace-derived
    // columns empty (the honest "—"/ungraded fallback), never a crash. The detail also carries the
    // run's steps (tool errors → next-steps R2) and resolved skills (unused-skill → next-steps R3,
    // and the "skill version differs" change marker below).
    void Promise.all(
      ids.map((id) =>
        Promise.allSettled([getRun(id), getRunGrades(id)]).then(
          ([detail, grades]) =>
            [
              id,
              detail.status === "fulfilled" ? (detail.value as RunDetail).steps : undefined,
              grades.status === "fulfilled" ? grades.value.latest : undefined,
              detail.status === "fulfilled" ? (detail.value as RunDetail).skills : undefined,
            ] as const,
        ),
      ),
    ).then((entries) => {
      if (!active) return;
      const nextSteps = new Map<string, RunStep[]>();
      const nextGrades = new Map<string, RunGrade[]>();
      const nextSkills = new Map<string, RunSkill[]>();
      for (const [id, steps, grades, skills] of entries) {
        if (steps) nextSteps.set(id, steps);
        if (grades) nextGrades.set(id, grades);
        if (skills) nextSkills.set(id, skills);
      }
      setStepsById(nextSteps);
      setGradesById(nextGrades);
      setSkillsById(nextSkills);
    });
    return () => {
      active = false;
    };
  }, [idsKey]);

  // A verdict reason → Flow drill (closes H3's level-1 "reason → flow" link). The reason carries a
  // Flow focus token; opening it must switch to Flow mode AND set `?focus=` in ONE URL write (two
  // separate setSearchParams calls in one handler would clobber each other — react-router reads the
  // pre-render params snapshot), so this writes both keys atomically instead of via `onFocus`.
  const openReasonInFlow = useCallback(
    (token: string) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set("mode", "flow");
          next.set("focus", token);
          return next;
        },
        { replace: false },
      );
    },
    [setSearchParams],
  );

  const summaryRuns = useMemo(
    () => buildSummaryRuns(runs, stepsById, gradesById),
    [runs, stepsById, gradesById],
  );

  const verdict = useMemo(() => deriveVerdict(summaryRuns, summaryFormatters()), [summaryRuns]);

  // The comparability caveats (T9h), computed LOCALLY (compare-runs.ts stays untouched) so the ⚠ chip
  // can render inline beside the verdict headline (§3.3.1) instead of only in the bar's popover.
  const caveats = useMemo(() => deriveCaveats(runs, gradesById), [runs, gradesById]);

  // "What changed" (H6) — re-homed from the interim strip above every mode into Summary's ordered
  // layout (compare-redesign step 6). Reuses the `skillsById` this mode already fetches — no new call.
  const markers = useMemo(
    () => deriveChangeMarkers(runs, data, skillsById),
    [runs, data, skillsById],
  );

  const nextSteps = useMemo(
    () => deriveNextSteps({ workspaceRuns: runs, summaryRuns, data, stepsById, skillsById }),
    [runs, summaryRuns, data, stepsById, skillsById],
  );

  // One run selected → the H8 single-column hint (no fake deltas).
  if (summaryRuns.length < 2) {
    return (
      <StatePanel
        kind="empty"
        title="Add a second run to compare"
        description="The baseline-Δ matrix, verdict, and charts appear once at least two runs are selected. Use the test picker or “+ Add run” above."
      />
    );
  }

  const showCurves = shouldShowCurves(summaryRuns);
  // Δ tones are only trustworthy when every run completed cleanly — a run that aborted/errored early
  // has smaller totals because it STOPPED, not because it was more efficient. When any run ended
  // abnormally, the matrix + bars show the Δ magnitude but in a neutral tone (the ⚠ caveat band above
  // carries the "why"), so the page never implies a fake winner (T9h).
  const comparable = summaryRuns.every((r) => !r.abnormal);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto pb-6">
      {/* 1. The positive verdict (H3), with the comparability-caveat chip inline beside its headline
          (§3.3.1). Suppressed entirely when no verdict was computed — a blocking (mixed-test) caveat
          already leads above every mode; this row only appears once there is a headline to sit beside. */}
      {verdict ? (
        <div className="flex flex-wrap items-start gap-2">
          <div className="min-w-0 flex-1">
            <VerdictBand caveats={[]} verdict={verdict} onFocus={openReasonInFlow} />
          </div>
          <VerdictCaveatChip caveats={caveats} />
        </div>
      ) : null}

      {/* 2. "What changed" — the H6 change-marker chips, now content inside Summary (not pinned chrome). */}
      {markers.length > 0 ? <ChangeMarkersStrip markers={markers} /> : null}

      {/* 3. Environment matrix (the evidence). */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
          <CardTitle>Environment matrix</CardTitle>
          <PerTurnToggle perTurn={perTurnMode} onChange={setPerTurnMode} />
        </CardHeader>
        <CardContent>
          <DeltaMatrix runs={summaryRuns} perTurn={perTurnMode} comparable={comparable} />
        </CardContent>
      </Card>

      {/* 4. Δ vs baseline + Context curves side by side ≥1400px (stacks to one column below). */}
      <div className="grid grid-cols-1 gap-4 min-[1400px]:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BarChart3 aria-hidden className="size-4" />Δ vs baseline
            </CardTitle>
          </CardHeader>
          <CardContent>
            <DeltaBarPanel runs={summaryRuns} perTurn={perTurnMode} comparable={comparable} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <LineChartIcon aria-hidden className="size-4" />
              Context-window curves
            </CardTitle>
          </CardHeader>
          <CardContent>
            {showCurves ? (
              <ContextCurves runs={summaryRuns} />
            ) : (
              <Text variant="meta" tone="muted" className="text-pretty">
                Context-window curves appear once a run runs more than two turns — these runs are
                too short to plot a meaningful shape.
              </Text>
            )}
          </CardContent>
        </Card>
      </div>

      {/* 5. Next steps LAST — actions read as a footer, once the evidence above has made the case. */}
      <NextSteps steps={nextSteps} />
    </div>
  );
}

/** The absolute↔per-turn toggle (T9h) — per-turn compares unequal-length runs honestly. */
function PerTurnToggle({
  perTurn,
  onChange,
}: { perTurn: boolean; onChange: (perTurn: boolean) => void }) {
  return (
    <ToggleGroup
      type="single"
      value={perTurn ? "perTurn" : "absolute"}
      aria-label="Metric basis"
      onValueChange={(next) => {
        if (next === "absolute" || next === "perTurn") onChange(next === "perTurn");
      }}
      className="w-fit"
    >
      <ToggleGroupItem value="absolute" aria-label="Absolute totals">
        Absolute
      </ToggleGroupItem>
      <ToggleGroupItem value="perTurn" aria-label="Per turn">
        Per turn
      </ToggleGroupItem>
    </ToggleGroup>
  );
}

/** The `⚠ n` comparability-caveat chip (§3.3.1) — a popover beside the verdict headline, mirroring the
 *  compare bar's own caveat chip (`CompareBar.tsx`'s `CaveatChip`, out of this WP's file domain) so the
 *  same information reads consistently in both places. Renders nothing for a cleanly comparable set. */
function VerdictCaveatChip({ caveats }: { caveats: CompareCaveat[] }) {
  const [open, setOpen] = useState(false);
  if (caveats.length === 0) return null;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="h-7 shrink-0 gap-1.5 px-2 font-normal"
          aria-label={`${caveats.length} comparability caveat${caveats.length === 1 ? "" : "s"} — these runs are not directly comparable`}
        >
          <AlertTriangle aria-hidden className="size-3.5 text-warning" />
          <span className="tabular-nums">{caveats.length}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80">
        <div className="flex items-center gap-2">
          <AlertTriangle aria-hidden className="size-4 shrink-0 text-warning" />
          <Text className="font-medium">Not directly comparable</Text>
        </div>
        <ul className="mt-2 flex flex-col gap-1.5">
          {caveats.map((caveat, index) => (
            <li key={`${caveat.kind}-${index}`}>
              <Text variant="meta" className="text-pretty">
                {caveat.text}
              </Text>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

const MARKER_ICON: Record<ChangeMarkerKind, typeof GitCompareArrows> = {
  "server-scan": GitCompareArrows,
  "skill-version": Package,
  model: Cpu,
  loading: Layers,
};

/**
 * The "What changed" strip (compare-redesign §3.1, re-homed into Summary by step 6/§3.3) — the H6
 * change markers as content between the verdict and the matrix, shown only when the compared runs
 * differ in a versioned input (server scan, skill version, model, tool-loading mode). For the
 * reference case (same test/model) `markers` is empty and nothing renders. A marker with a destination
 * is a link chip (pre-filled diff / editor); otherwise a static chip.
 */
function ChangeMarkersStrip({ markers }: { markers: ChangeMarker[] }) {
  return (
    <section
      aria-label="What changed between these runs"
      className="flex shrink-0 flex-wrap items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-2"
    >
      <Text variant="meta" tone="muted" className="mr-0.5 shrink-0 font-medium">
        What changed
      </Text>
      <ul className="flex min-w-0 flex-wrap items-center gap-1.5">
        {markers.map((marker, index) => (
          <li key={`${marker.kind}-${index}`}>
            <ChangeMarkerChip marker={marker} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function ChangeMarkerChip({ marker }: { marker: ChangeMarker }) {
  const Icon = MARKER_ICON[marker.kind];
  const inner = (
    <>
      <Icon aria-hidden className="size-3.5 shrink-0" />
      <span className="min-w-0 truncate">{marker.label}</span>
      {marker.href ? <ArrowRight aria-hidden className="size-3 shrink-0 opacity-70" /> : null}
    </>
  );
  if (marker.href) {
    return (
      <Button
        variant="outline"
        size="sm"
        className="h-7 max-w-xs gap-1.5 px-2 font-normal"
        title={marker.detail}
        asChild
      >
        <Link to={marker.href} aria-label={marker.detail}>
          {inner}
        </Link>
      </Button>
    );
  }
  return (
    <Badge variant="outline" className="max-w-xs gap-1.5 font-normal" title={marker.detail}>
      {inner}
    </Badge>
  );
}
