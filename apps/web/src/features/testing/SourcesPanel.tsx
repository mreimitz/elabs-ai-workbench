import { useEffect, useState } from "react";
import type {
  AnswersSnapshot,
  AnswersSnapshotField,
  AnswersSource,
  AnswersStepPayload,
  RunSummary,
} from "@mcp-token-footprint/shared";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  ScrollArea,
  Text,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@brand/ui";
import { Sources, SourcesContent, SourcesTrigger } from "@brand/ai";
import { ChevronRight, History, MessageSquareText, ShieldOff } from "lucide-react";
import { IconButton } from "../../components/IconButton";
import { apiGet, getRun } from "../../lib/api";
import { answersPayloadOf } from "./use-run-stream";
import { AnswersSnapshotData } from "./AnswersSnapshotData";
import { consoleAnchor, insightAnchorValue } from "./console-anchors";

/**
 * WP 3.1 · WP 7.1 — the answer step's DOCUMENT citation trail + assistant-version drift, rendered on a
 * `qlik_answers` `llm_response` step (`ConversationPane.tsx`'s `AssistantTurn`, which passes
 * `turn.answersPayload`). PAYLOAD-DRIVEN throughout: a rejected answer reads as a prompt-declined
 * notice (never an empty answer); an answer with sources gets a collapsible citations panel; an answer
 * with a version renders it plainly, upgraded to a drift badge once a previous run of the SAME
 * test × environment is found with a DIFFERENT version. Only ever called for a SETTLED `llm_response`
 * step (the payload only exists once the step closes), so this never flashes mid-stream.
 *
 * WP 7.1 (DE-DUP) — the `Qlik.Snapshot` INSIGHTS roll-up moved ENTIRELY to the monitoring rail
 * ({@link RailInsightsPanel}, via the exported {@link InsightRow}); the chat keeps its inline snapshot
 * insets + citation chips ({@link AnswersAnswerView}). So this panel is now Sources + version ONLY,
 * and a snapshot-only answer (no document sources, no version) renders NOTHING here — the rail owns
 * that evidence, shown exactly once.
 */
export function SourcesPanel({
  payload,
  testId,
  runId,
}: {
  payload: AnswersStepPayload;
  /** The current run's test — half of the "same test × environment" drift key. */
  testId: string;
  /** The current run's id — used to resolve its own environment (`scenarioId`) for the lookup. */
  runId: string | null;
}) {
  const drift = useVersionDrift(testId, runId, payload.assistantVersion);

  if (payload.rejected) {
    return (
      <Alert variant="warning" className="min-w-0">
        <ShieldOff aria-hidden className="size-4" />
        <AlertTitle>Prompt declined</AlertTitle>
        <AlertDescription>
          The tenant assistant's own guardrail rejected this prompt — it produced no answer.
        </AlertDescription>
      </Alert>
    );
  }

  const sources = payload.sources ?? [];
  const hasSources = sources.length > 0;
  const hasVersion = Boolean(payload.assistantVersion);
  // WP 7.1 (DE-DUP) — Insights moved to the rail; this panel is Sources + version only. A
  // snapshot-only answer therefore renders nothing here (the rail's RailInsightsPanel owns it).
  if (!hasSources && !hasVersion) return null;

  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      {hasSources ? <SourcesList sources={sources} /> : null}
      {hasVersion ? (
        <VersionBadge current={payload.assistantVersion as string} drift={drift} />
      ) : null}
    </div>
  );
}

/**
 * One insight row (Phase 5 · WP 7.1, D-QA9/D-QA10/D-QA13) — the SHARED evidence row for one
 * `Qlik.Snapshot`. Since WP 7.1's DE-DUP it lives ONLY in the monitoring rail ({@link RailInsightsPanel}
 * renders an `<ol>` of these across every turn); the chat keeps its inline snapshot insets + citation
 * chips. EXPORTED for that reuse.
 *
 * Structure (a11y): the header is a flex row of SIBLINGS — the chevron + ordinal + title, the
 * `reason` as PLAIN wrapping `Text`, an optional "Turn N" chip, and an optional ghost "Show in answer"
 * `Button`. `reason` and the buttons are NEVER nested inside the disclosure trigger (no nested
 * interactives, a clean accessible name). BRANCHED at the row root: when the snapshot HAS data or
 * expressions, the title becomes a `CollapsibleTrigger` (default-open) that discloses the DATA face —
 * the shared {@link AnswersSnapshotData} (`variant="panel"`, a `MetricCard` for a 1×1 hypercube else a
 * compact table) plus the demoted "Definition" set-analysis expressions; when it has NEITHER, the row
 * is a PLAIN non-interactive header (no `Collapsible` at all — so Radix can't emit a dangling
 * `aria-expanded`/`aria-controls` to an omitted content region). The always-mounted `<li>` carries the
 * FORWARD scroll target ({@link insightAnchorValue}, TURN-QUALIFIED) in BOTH branches, so a citation
 * chip in the answer always lands here.
 */
export function InsightRow({
  snap,
  index,
  turnIndex,
  onCite,
  showTurn = false,
}: {
  snap: AnswersSnapshot;
  /** 0-based snapshot index WITHIN its turn (matches the citation chip's 1-based label). */
  index: number;
  /** The insight's owning assistant turn — makes the anchor unique across a multi-turn run. */
  turnIndex: number;
  /** REVERSE link (rail → chat): reveal this insight's citation chip in the answer. Omitted in-chat. */
  onCite?: () => void;
  /** Multi-turn rail list only — a "Turn N" chip so a flat row keeps its turn provenance. */
  showTurn?: boolean;
}) {
  const title = snap.title?.trim() || `Analysis ${index + 1}`;
  const measures = snap.measures ?? [];
  const dimensions = snap.dimensions ?? [];
  const hasDefinition = measures.length > 0 || dimensions.length > 0;
  const hasData = Boolean(
    snap.data && (snap.data.columns?.length ?? 0) > 0 && (snap.data.rows?.length ?? 0) > 0,
  );
  const hasDisclosure = hasData || hasDefinition;

  // The always-mounted `<li>` FORWARD anchor is identical in both branches.
  const anchor = consoleAnchor(insightAnchorValue(turnIndex, index));
  const meta = (
    <InsightRowMeta snap={snap} turnIndex={turnIndex} onCite={onCite} showTurn={showTurn} />
  );

  // Nothing to disclose → a PLAIN, non-interactive header (no Collapsible → no dangling aria).
  if (!hasDisclosure) {
    return (
      <li className="min-w-0 rounded-md border border-border bg-card" {...anchor}>
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 px-2.5 py-1.5">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            {/* spacer where the disclosure chevron sits on disclosable rows — keeps titles aligned */}
            <span aria-hidden className="size-3.5 shrink-0" />
            <InsightRowLabel index={index} title={title} />
          </div>
          {meta}
        </div>
      </li>
    );
  }

  return (
    <li className="min-w-0 rounded-md border border-border bg-card" {...anchor}>
      <Collapsible defaultOpen className="group/insrow min-w-0">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 px-2.5 py-1.5">
          {/* Title/chevron only — the disclosure control. `reason` + the buttons are SIBLINGS, never
              nested here (no nested interactives). */}
          <CollapsibleTrigger className="flex min-w-0 flex-1 items-center gap-2 rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <ChevronRight
              className="size-3.5 shrink-0 text-muted-foreground transition-transform group-data-[state=open]/insrow:rotate-90"
              aria-hidden
            />
            <InsightRowLabel index={index} title={title} />
          </CollapsibleTrigger>
          {meta}
        </div>
        <CollapsibleContent>
          <div className="flex min-w-0 flex-col gap-1.5 border-t border-border px-2.5 py-2">
            <AnswersSnapshotData snapshot={snap} variant="panel" />
            {hasDefinition ? (
              <InsightDefinition dimensions={dimensions} measures={measures} />
            ) : null}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </li>
  );
}

/** The ordinal badge + title — shared between the disclosable trigger and the plain-header branch. */
function InsightRowLabel({ index, title }: { index: number; title: string }) {
  return (
    <>
      <Badge variant="secondary" className="shrink-0 tabular-nums">
        {index + 1}
      </Badge>
      <Text as="span" className="min-w-0 truncate font-medium" title={title}>
        {title}
      </Text>
    </>
  );
}

/**
 * The shared trailing header siblings — an optional "Turn N" chip, the optional ghost "Show in answer"
 * button (the REVERSE link), and the always-visible `reason` line (a full-width wrap). Kept identical
 * across the disclosable and plain rows, and always OUTSIDE the disclosure trigger (no nested
 * interactives).
 */
function InsightRowMeta({
  snap,
  turnIndex,
  onCite,
  showTurn,
}: {
  snap: AnswersSnapshot;
  turnIndex: number;
  onCite?: () => void;
  showTurn: boolean;
}) {
  return (
    <>
      {showTurn ? (
        <Badge variant="outline" className="shrink-0 font-normal tabular-nums">
          Turn {turnIndex + 1}
        </Badge>
      ) : null}
      {onCite ? (
        <IconButton
          type="button"
          variant="ghost"
          size="icon-sm"
          className="size-6 shrink-0 text-muted-foreground"
          label="Show in answer"
          onClick={onCite}
        >
          <MessageSquareText aria-hidden className="size-3.5" />
        </IconButton>
      ) : null}
      {snap.reason ? (
        <Text variant="meta" tone="muted" className="min-w-0 basis-full text-pretty">
          {snap.reason}
        </Text>
      ) : null}
    </>
  );
}

/**
 * The collapsed "Definition" disclosure (D-QA13) — the raw Qlik set-analysis expressions behind an
 * insight's measures/dimensions, demoted here from the row's always-visible face. Default-closed:
 * the expressions stay in the payload + report (the evidence trail) but read as an opt-in detail, not
 * the headline.
 */
function InsightDefinition({
  dimensions,
  measures,
}: {
  dimensions: AnswersSnapshotField[];
  measures: AnswersSnapshotField[];
}) {
  return (
    <Collapsible
      defaultOpen={false}
      className="group/definition min-w-0 rounded-md border border-border"
    >
      <CollapsibleTrigger
        className="flex w-full min-w-0 items-center gap-1.5 rounded-md px-2 py-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label="Definition"
      >
        <ChevronRight
          className="size-3 shrink-0 text-muted-foreground transition-transform group-data-[state=open]/definition:rotate-90"
          aria-hidden
        />
        <Text variant="meta" tone="muted" as="span" className="shrink-0 font-medium">
          Definition
        </Text>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="flex min-w-0 flex-col gap-0.5 border-t border-border px-2 py-1.5">
          {dimensions.length > 0 ? <ExprLine label="By" fields={dimensions} /> : null}
          {measures.length > 0 ? <ExprLine label="Measure" fields={measures} /> : null}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

/** A labelled list of Qlik expressions (a snapshot's dimensions or measures), one per line, wrapping. */
function ExprLine({ label, fields }: { label: string; fields: AnswersSnapshotField[] }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      {fields.map((field, index) => (
        <div key={`${field.expression}-${index}`} className="flex min-w-0 items-baseline gap-1.5">
          <Text variant="meta" tone="muted" as="span" className="shrink-0">
            {label}
          </Text>
          <Text variant="code" as="span" className="min-w-0 break-words">
            {field.label ? `${field.label} · ${field.expression}` : field.expression}
          </Text>
        </div>
      ))}
    </div>
  );
}

/**
 * The collapsible citations list — the `@brand/ai` `Sources`/`SourcesTrigger`/`SourcesContent`
 * disclosure (the canonical grounding-sources fold; replaces the hand-rolled `Collapsible` + chevron
 * header, 2026-07-12 brand-ui alignment). The ROWS stay the bespoke {@link SourceRow}: an
 * `AnswersSource` is a document path + KB/datasource ids + chunk count with **no URL**, so the
 * library's `Source` (an `<a href target="_blank">`) can't model it — rows render inside
 * `SourcesContent` instead. The trigger keeps the tests' stable accessible name (`Sources · N`) via
 * `aria-label` while showing the library's own "Used N sources" face.
 */
function SourcesList({ sources }: { sources: AnswersSource[] }) {
  return (
    <Sources className="mb-0 min-w-0">
      <SourcesTrigger
        count={sources.length}
        aria-label={`Sources · ${sources.length}`}
        className="rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
      <SourcesContent className="mt-1.5 w-full">
        <ScrollArea className="max-h-56 min-w-0 rounded-md border border-border bg-card">
          <ul className="flex min-w-0 flex-col gap-2 px-3 py-2.5">
            {sources.map((source, index) => (
              <SourceRow
                key={`${source.documentId ?? source.source ?? "source"}-${index}`}
                source={source}
              />
            ))}
          </ul>
        </ScrollArea>
      </SourcesContent>
    </Sources>
  );
}

function SourceRow({ source }: { source: AnswersSource }) {
  const label = source.source?.trim() || "Untitled source";
  const chunkCount = source.chunks?.length ?? 0;
  return (
    <li className="flex min-w-0 flex-col gap-1">
      <Text variant="code" as="span" className="min-w-0 truncate" title={label}>
        {label}
      </Text>
      {source.knowledgebaseId || source.datasourceId || chunkCount > 0 ? (
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          {source.knowledgebaseId ? (
            <Badge variant="secondary" className="min-w-0 gap-1 truncate font-normal">
              KB · {source.knowledgebaseId}
            </Badge>
          ) : null}
          {source.datasourceId ? (
            <Badge variant="secondary" className="min-w-0 gap-1 truncate font-normal">
              Datasource · {source.datasourceId}
            </Badge>
          ) : null}
          {chunkCount > 0 ? (
            <Text variant="meta" tone="muted">
              {chunkCount} chunk{chunkCount === 1 ? "" : "s"}
            </Text>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

/** The lookup result for the drift marker — `null` while unresolved (loading, or no comparison found). */
type VersionDrift = { status: "same" | "changed"; previousVersion: string };

/**
 * The assistant-version (Etag) chip: plain when there's nothing to compare against, upgraded to a
 * `warning`-toned drift chip when {@link drift} says the version changed since the previous run of the
 * same test × environment.
 */
function VersionBadge({ current, drift }: { current: string; drift: VersionDrift | null }) {
  const changed = drift?.status === "changed";
  return (
    <Tooltip>
      <TooltipTrigger className="inline-flex w-fit cursor-default rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <Badge variant={changed ? "warning" : "outline"} className="min-w-0 gap-1 font-normal">
          <History aria-hidden className="size-3 shrink-0" />
          <span className="max-w-48 truncate font-mono">{current}</span>
        </Badge>
      </TooltipTrigger>
      <TooltipContent>
        {changed
          ? `Assistant version changed since the previous run of this test × environment (was ${drift.previousVersion}).`
          : drift?.status === "same"
            ? "Unchanged since the previous run of this test × environment."
            : "The tenant assistant's version (Etag) at answer time."}
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * Resolve the drift marker for {@link currentVersion} against the previous run of the SAME
 * test × environment. Deliberately minimal/data-driven, per the WP: no new API endpoint — it reads the
 * existing `GET /api/runs` history (already the Runs-feed backing list) to find this run's own
 * `scenarioId` (the "environment") and the closest earlier run sharing both `testId` and `scenarioId`,
 * then the existing `GET /api/runs/:id` replay ({@link getRun}) to pull that prior run's own
 * `assistantVersion` off its settled `llm_response` step. A cosmetic, best-effort lookup: any failure
 * (network, a deleted prior run, an old run with no payload) just leaves the marker at "no comparison"
 * rather than surfacing an error — this is a nice-to-have signal, not a run outcome.
 */
function useVersionDrift(
  testId: string,
  runId: string | null,
  currentVersion: string | undefined,
): VersionDrift | null {
  const [drift, setDrift] = useState<VersionDrift | null>(null);

  useEffect(() => {
    let alive = true;
    setDrift(null);
    if (!currentVersion || !runId) return;

    void (async () => {
      try {
        const history = await apiGet<RunSummary[]>("/api/runs");
        const mine = history.find((run) => run.id === runId);
        if (!mine) return;
        const mineStartedAt = Date.parse(mine.startedAt);
        const previous = history
          .filter(
            (run) =>
              run.id !== runId &&
              run.testId === testId &&
              run.scenarioId === mine.scenarioId &&
              Date.parse(run.startedAt) < mineStartedAt,
          )
          .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt))[0];
        if (!previous) return;

        const detail = await getRun(previous.id);
        let previousVersion: string | undefined;
        for (let i = detail.steps.length - 1; i >= 0; i -= 1) {
          const answers = answersPayloadOf(detail.steps[i]?.payload);
          if (answers?.assistantVersion) {
            previousVersion = answers.assistantVersion;
            break;
          }
        }
        if (!alive || !previousVersion) return;
        setDrift({
          status: previousVersion === currentVersion ? "same" : "changed",
          previousVersion,
        });
      } catch {
        /* cosmetic lookup — no marker on failure, never a toast (see doc comment above). */
      }
    })();

    return () => {
      alive = false;
    };
  }, [testId, runId, currentVersion]);

  return drift;
}
