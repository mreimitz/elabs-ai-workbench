import { useMemo, useState } from "react";
import type {
  GuardrailConfig,
  RunStep,
  SessionAssistantIdentity,
  SessionCapabilities,
} from "@mcp-token-footprint/shared";
import {
  Context,
  ContextContent,
  ContextContentBody,
  ContextContentFooter,
  ContextContentHeader,
  ContextTrigger,
} from "@brand/ai";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Descriptions,
  DescriptionsItem,
  MetricCard,
  Text,
} from "@brand/ui";
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  Clock,
  Coins,
  Flame,
  Gauge,
  IdCard,
  MessageSquare,
  TrendingUp,
  Wrench,
} from "lucide-react";
import { formatCostUsd, formatDuration, formatNumber } from "../../lib/format";
import { SubscriptionCostMarker } from "../../components/SubscriptionCostMarker";
import type { RunKpis } from "./use-run-stream";
import { derivePerStepEconomics, type StepCumulativeKpi } from "./analytics-derive";
import { deriveHotspots, type Hotspot, type HotspotKind } from "./hotspots";

/**
 * KPI rail (UI §4 Zone A / inspector doc 12 §2 "KPI strip"): a compact 2-up band of `MetricCard`s
 * carrying the run's **live scalar metrics**.
 *
 * WP 3.2 (Unified Sessions, D-US4) — the tile list is built DECLARATIVELY from the run's
 * {@link SessionCapabilities} manifest instead of forking on `providerKind`:
 *   - the **Context** tile shows iff `capabilities.contextWindow`, UNLESS `capabilities.identity` is
 *     present — a first-class named assistant (Qlik) gets the {@link AnswersIdentityCard} in that
 *     slot instead (there is no meaningful context window to show alongside a named assistant);
 *   - the **Tokens ↑ / ↓** tiles show unless `capabilities.tokens === "none"`; `"estimated"` fidelity
 *     marks their description "(estimated)" instead of "(provider-actual)";
 *   - the **Est. cost** tile hides entirely when `capabilities.costBasis === "none"`; its VALUE is
 *     unit-aware — a dollar figure for `api_exact`/`subscription_reference` (the latter also carries
 *     the shared {@link SubscriptionCostMarker} "est." badge), or the raw `<N> questions` count for
 *     `"questions"` (Qlik's real cost unit — the tenant's shared monthly quota, not currency);
 *   - the **Tool calls** tile shows iff `capabilities.toolCalls`;
 *   - **Turns** always shows (no capability gates it).
 *
 * Every current backend (the five chat-completions kinds, `claude_subscription`, `qlik_answers`)
 * renders exactly the tile set its declared manifest implies; a FUTURE backend with a new capability
 * combination renders correctly with zero new branches here — the whole point of D-US4.
 *
 * Observability (roadmap/observability/, WP 3.2 — a DIFFERENT plan/WP than the D-US4 tile logic above,
 * despite the coincidentally identical "WP 3.2" number) ADDS ONLY the {@link HotspotsStrip} below the
 * tile grid — up to three jump-links to the run's true extremes (slowest / costliest / largest
 * context-window jump step), themselves capability-gated via `deriveHotspots` (`./hotspots.ts`) rather
 * than any new `providerKind` fork. Nothing above this addition was rewritten.
 */
export type KpiRailProps = {
  /** Latest KPI snapshot, or `null` before the first `kpi` event. */
  kpis: RunKpis | null;
  /** The model's context window (tokens), 0 when unknown. Drives the headline utilisation %. */
  contextLimit: number;
  /** Scenario guardrails — caps shown as the `x / max` denominators. */
  guardrails: GuardrailConfig;
  /**
   * The single canonical current-context-tokens value (latest `ContextSnapshot.total`, falling back
   * to the turn-0 baseline) — shared with `ContextChart` so the headline Context % matches the chart.
   */
  currentContextTokens?: number;
  /**
   * WP 3.2 (D-US4) — the run's resolved session capability manifest. Always provided by the caller:
   * `RunConsoleRoute` resolves it from the persisted run (`capabilities_json`) or, for a run that
   * predates this contract (or hasn't started yet), a credential-derived fallback — the ONLY place in
   * the console that still consults `providerKind`. Drives every kind-aware facet of the rail below.
   */
  capabilities: SessionCapabilities;
  /**
   * Live count of "questions" consumed so far — the run's real cost unit when
   * `capabilities.costBasis === "questions"` (Qlik's shared monthly quota; summed by the caller off
   * each settled `llm_response` step's `AnswersStepPayload.questionsConsumed`). NOT part of the static
   * capability manifest (a live, per-run figure), so it rides as a separate prop; ignored for every
   * other `costBasis`.
   */
  questionsConsumed?: number;
  /**
   * Observability (WP 3.2) — the run's steps, read ONLY to derive the "hotspots" strip (jump-links to
   * the slowest step, the costliest step, and the largest single context-window jump — up to one per
   * kind, capability-gated, never a `providerKind` fork). Omit (or pass an empty array) to hide the
   * strip — e.g. a pre-run console with no steps yet.
   */
  steps?: RunStep[];
  /**
   * Observability (WP 3.2) — cumulative per-step KPI snapshots (the console's REPLAY-only
   * `kpiByStepId`), keyed by step id — the SAME source `StepLog`'s per-step economics chips read.
   * Powers the costliest hotspot's per-step cost delta; omitted (or `null`) while unavailable (a
   * still-live run), which simply drops the costliest hotspot rather than showing a stale/zero pick.
   */
  kpiByStepId?: ReadonlyMap<string, StepCumulativeKpi> | null;
  /**
   * Jump to a hotspot's step — opens the `PacketInspector`, the SAME evidence-link mechanic
   * `GradePanel`'s cited-step links use. Required for the hotspots strip to render at all (with no
   * jump target, a "hotspot" is just an inert readout, not a link).
   */
  onSelectStep?: (stepId: string | null) => void;
};

export function KpiRail({
  kpis,
  contextLimit,
  guardrails,
  currentContextTokens = 0,
  capabilities,
  questionsConsumed = 0,
  steps = [],
  kpiByStepId = null,
  onSelectStep,
}: KpiRailProps) {
  // One current-context source for the headline (shared with the chart's utilisation badge — S1).
  const effectiveContext = currentContextTokens;
  const utilization = contextLimit > 0 ? (effectiveContext / contextLimit) * 100 : null;

  const tokensIn = kpis?.tokensIn ?? 0;
  const tokensOut = kpis?.tokensOut ?? 0;
  const toolCalls = kpis?.toolCalls ?? 0;
  const turns = kpis?.turns ?? 0;
  const costUsd = kpis?.costUsd ?? 0;

  const isSubscriptionCost = capabilities.costBasis === "subscription_reference";
  const isQuestionsCost = capabilities.costBasis === "questions";
  // The identity card takes the Context slot whenever the backend has a first-class named assistant —
  // even a hypothetical future kind with BOTH an identity AND a real context window would show the
  // identity card here (the assistant's identity is the more useful headline for that kind of run).
  const showIdentity = capabilities.identity != null;
  const showContext = !showIdentity && capabilities.contextWindow;
  const showTokens = capabilities.tokens !== "none";
  const showCost = capabilities.costBasis !== "none";
  const showToolCalls = capabilities.toolCalls;

  const contextValue = useMemo(() => {
    if (utilization == null) return "n/a";
    return `${Math.round(utilization)}%`;
  }, [utilization]);

  const contextDescription =
    contextLimit > 0
      ? `${formatNumber(effectiveContext)} / ${formatNumber(contextLimit)}`
      : `${formatNumber(effectiveContext)} tokens · limit unknown`;

  const turnsValue = guardrails.maxTurns
    ? `${formatNumber(turns)} / ${formatNumber(guardrails.maxTurns)}`
    : formatNumber(turns);

  // The cost tile's lead description word: subscription runs are honestly a shadow-price REFERENCE
  // (never a billed charge, D-CS8); every other basis (incl. "questions") is our own estimate.
  const costLead = isSubscriptionCost ? "subscription reference" : "estimated";
  const costDescription = guardrails.maxCostUsd
    ? `${costLead} · of ${formatCostUsd(guardrails.maxCostUsd)} cap`
    : costLead;
  const questionsValue = `${formatNumber(questionsConsumed)} question${questionsConsumed === 1 ? "" : "s"}`;

  // High utilisation is *bad* — flip the delta-direction semantics so a rising headline reads as risk.
  const headlineDirection: "up" | "neutral" = utilization != null && utilization >= 90 ? "up" : "neutral";

  const tokenFidelityLabel = capabilities.tokens === "estimated" ? "estimated" : "provider-actual";

  // Observability (WP 3.2) — the hotspots strip. Capability-gated inside `deriveHotspots` (never a
  // `providerKind` fork): the costliest hotspot needs a real per-step cost basis, the context-jump
  // hotspot needs a meaningful context window; the slowest hotspot is always derivable from
  // `RunStep.durationMs` alone, so a run with neither cost nor context data still gets a duration-only
  // strip rather than an empty one.
  const perStepEconomics = useMemo(
    () => derivePerStepEconomics(steps, kpiByStepId),
    [steps, kpiByStepId],
  );
  const hotspots = useMemo(
    () => deriveHotspots(steps, kpiByStepId ? perStepEconomics : null, capabilities),
    [steps, kpiByStepId, perStepEconomics, capabilities],
  );

  // T10 ("numbers that do not reconcile") — up to four figures render here (Context, Tokens ↑,
  // Tokens ↓, Est. cost) with no stated relationship between them, which reads as a silent
  // contradiction against any aggregate shown elsewhere (e.g. a runs-list total). State it: only
  // the tiles actually visible are mentioned, so a kind that hides Context never gets a clause about
  // it.
  const relationshipNote = figureRelationshipNote({ showContext, showTokens, showCost });

  return (
    <section aria-label="Run KPIs">
      <div className="grid grid-cols-2 gap-3">
        {showIdentity && capabilities.identity ? (
          <AnswersIdentityCard identity={capabilities.identity} />
        ) : showContext ? (
          <MetricCard
            className="min-w-0"
            emphasis="headline"
            icon={<Gauge aria-hidden />}
            label="Context"
            value={<span className="tabular-nums">{contextValue}</span>}
            description={
              // The `@brand/ai` `Context` breakdown backs the tile's description whenever the limit is
              // known — the tile stays the grid's MetricCard; the description becomes the
              // expand/collapse trigger for the usage breakdown (%, used/max, progress bar, token
              // rows, est. cost).
              contextLimit > 0 ? (
                <ContextBreakdown
                  usedTokens={effectiveContext}
                  maxTokens={contextLimit}
                  description={contextDescription}
                  tokensIn={tokensIn}
                  tokensOut={tokensOut}
                  costUsd={costUsd}
                />
              ) : (
                <span className="tabular-nums">{contextDescription}</span>
              )
            }
            delta={utilization != null && utilization >= 90 ? "near limit" : undefined}
            deltaDirection={headlineDirection}
            positiveIsGood={false}
          />
        ) : null}
        {showCost ? (
          <MetricCard
            className="min-w-0"
            icon={<Coins aria-hidden />}
            label="Est. cost"
            value={
              isQuestionsCost ? (
                <span className="tabular-nums">{questionsValue}</span>
              ) : isSubscriptionCost ? (
                <span className="inline-flex items-center gap-1.5">
                  <span className="tabular-nums">{formatCostUsd(costUsd)}</span>
                  <SubscriptionCostMarker />
                </span>
              ) : (
                <span className="tabular-nums">{formatCostUsd(costUsd)}</span>
              )
            }
            description={
              <Text variant="meta" tone="muted">
                {costDescription}
              </Text>
            }
          />
        ) : null}
        {showTokens ? (
          <>
            <MetricCard
              className="min-w-0"
              icon={<ArrowUp aria-hidden />}
              label="Tokens ↑"
              value={<span className="tabular-nums">{formatNumber(tokensIn)}</span>}
              description={`sent (${tokenFidelityLabel})`}
            />
            <MetricCard
              className="min-w-0"
              icon={<ArrowDown aria-hidden />}
              label="Tokens ↓"
              value={<span className="tabular-nums">{formatNumber(tokensOut)}</span>}
              description={`received (${tokenFidelityLabel})`}
            />
          </>
        ) : null}
        {showToolCalls ? (
          <MetricCard
            className="min-w-0"
            icon={<Wrench aria-hidden />}
            label="Tool calls"
            value={<span className="tabular-nums">{formatNumber(toolCalls)}</span>}
          />
        ) : null}
        <MetricCard
          className="min-w-0"
          icon={<MessageSquare aria-hidden />}
          label="Turns"
          value={<span className="tabular-nums">{turnsValue}</span>}
          description={guardrails.maxTurns ? "of guardrail cap" : undefined}
        />
      </div>
      {relationshipNote ? (
        <Text variant="meta" tone="muted" className="mt-2 block">
          {relationshipNote}
        </Text>
      ) : null}
      {onSelectStep && hotspots.length > 0 ? (
        <HotspotsStrip hotspots={hotspots} onSelectStep={onSelectStep} />
      ) : null}
    </section>
  );
}

/**
 * T10 — the single place that states how the rail's figures relate (or explicitly don't). Context is
 * a SNAPSHOT of this run's current conversation size; Tokens ↑/↓ are CUMULATIVE sums across every
 * turn so far — the two measure different things and never sum to each other. Neither is a
 * fleet-wide/aggregate figure (e.g. a runs-list total) — every number on this rail is THIS run only.
 * Pure + exported for testing; built only from the tiles actually visible so it never references a
 * hidden one.
 */
export function figureRelationshipNote(opts: {
  showContext: boolean;
  showTokens: boolean;
  showCost: boolean;
}): string | null {
  const clauses: string[] = [];
  if (opts.showTokens) {
    clauses.push("Tokens ↑/↓ are cumulative sends/receives across this run's turns so far");
  }
  if (opts.showContext) {
    clauses.push(
      "Context is this run's current conversation size — a different quantity, not their sum",
    );
  }
  if (opts.showCost) {
    clauses.push("Est. cost is this run's own estimate, not a fleet total");
  }
  return clauses.length > 0 ? `${clauses.join("; ")}.` : null;
}

/** Per-kind icon + short label for the hotspots strip. */
const HOTSPOT_META: Record<HotspotKind, { label: string; Icon: typeof Clock }> = {
  slowest: { label: "Slowest step", Icon: Clock },
  costliest: { label: "Costliest step", Icon: Coins },
  contextJump: { label: "Largest context jump", Icon: TrendingUp },
};

/** The hotspot's magnitude, formatted for display (never a raw unformatted number). */
function hotspotValueLabel(hotspot: Hotspot): string {
  switch (hotspot.kind) {
    case "slowest":
      return formatDuration(hotspot.durationMs);
    case "costliest":
      return formatCostUsd(hotspot.costUsdDelta);
    case "contextJump":
      return `+${formatNumber(hotspot.deltaTokens)}`;
  }
}

/**
 * Observability (WP 3.2) — up to THREE jump-links (one per kind) to the run's true extremes: the
 * slowest step, the costliest step, and the largest single context-window jump. Mirrors `TurnIndex`'s
 * clickable-list pattern (a `Button` per row, full-width, ghost). Clicking a row selects that step —
 * the SAME `onSelectStep` mechanic `StepLog`/`GradePanel` use, opening the `PacketInspector`.
 */
function HotspotsStrip({
  hotspots,
  onSelectStep,
}: {
  hotspots: Hotspot[];
  onSelectStep: (stepId: string | null) => void;
}) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle>
          <span className="flex items-center gap-2">
            <Flame aria-hidden className="size-4" />
            Hotspots
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        <ul className="flex flex-col gap-1">
          {hotspots.map((hotspot) => {
            const meta = HOTSPOT_META[hotspot.kind];
            const Icon = meta.Icon;
            return (
              <li key={hotspot.kind}>
                <Button
                  variant="ghost"
                  className="h-auto w-full justify-start gap-2 rounded-md px-2 py-1.5 text-left font-normal"
                  onClick={() => onSelectStep(hotspot.stepId)}
                  title={`Jump to ${hotspot.label}`}
                >
                  <span className="flex w-full min-w-0 items-center gap-2">
                    <Icon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 truncate">{meta.label}</span>
                    <span className="ml-auto shrink-0 tabular-nums text-muted-foreground">
                      {hotspotValueLabel(hotspot)}
                    </span>
                  </span>
                </Button>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}

/**
 * WP 3.2 (D-US4) — replaces the Context tile for a backend with a first-class named assistant
 * (`capabilities.identity` present — today only `qlik_answers`) with the run's actual identity:
 * name, the bound Qlik Sense app (when app-backed), the assistant's version (an Etag-based drift
 * signal), and the environment's transport override. Composed from `MetricCard` (the same header
 * rhythm as every other rail tile) with a compact `Descriptions` block in its `evidence` slot for the
 * secondary facts. Any field the manifest hasn't settled yet is simply omitted — never a
 * permanently-unfulfilled placeholder.
 */
function AnswersIdentityCard({ identity }: { identity: SessionAssistantIdentity }) {
  const transportLabel =
    identity.transport === "stream"
      ? "Streaming"
      : identity.transport === "invoke"
        ? "Invoke"
        : undefined;
  const displayName = identity.name ?? identity.assistantId;
  const hasDetail = Boolean(identity.appId || identity.version || transportLabel);

  return (
    <MetricCard
      className="min-w-0"
      icon={<IdCard aria-hidden />}
      label="Assistant"
      value={
        <span className="block min-w-0 break-words" title={displayName}>
          {displayName}
        </span>
      }
      evidence={
        hasDetail ? (
          <Descriptions columns={1} layout="horizontal" className="gap-y-1">
            {identity.appId ? (
              <DescriptionsItem label="App">{identity.appId}</DescriptionsItem>
            ) : null}
            {identity.version ? (
              <DescriptionsItem label="Version">{identity.version}</DescriptionsItem>
            ) : null}
            {transportLabel ? (
              <DescriptionsItem label="Transport">{transportLabel}</DescriptionsItem>
            ) : null}
          </Descriptions>
        ) : undefined
      }
    />
  );
}

/**
 * The Context tile's usage-breakdown popover — the `@brand/ai` `Context` component (2026-07-12
 * brand-ui alignment): the canonical token-usage surface (`ContextContentHeader` renders the %,
 * `used / max` and a progress bar off the same `usedTokens`/`maxTokens` the tile shows, so the two
 * can never disagree). **Expandable/collapsible by owner requirement:** the hover card is CONTROLLED —
 * the description-line trigger toggles it on click (`aria-expanded` + rotating chevron) and Radix's
 * own hover/focus/Escape handling still opens and closes it. The body rows are custom (tokens only):
 * the library defaults derive a cost from ITS OWN public-model price table, which would contradict
 * the app's `pricing.ts`-backed estimate — the footer carries the app's real `costUsd` instead.
 */
function ContextBreakdown({
  usedTokens,
  maxTokens,
  description,
  tokensIn,
  tokensOut,
  costUsd,
}: {
  usedTokens: number;
  maxTokens: number;
  /** The tile's existing `used / max` description line — now doubling as the trigger's face. */
  description: string;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Context open={open} onOpenChange={setOpen} usedTokens={usedTokens} maxTokens={maxTokens}>
      <ContextTrigger>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-expanded={open}
          aria-label="Context usage breakdown"
          onClick={() => setOpen((value) => !value)}
          className="-mx-1.5 h-6 gap-1 px-1.5 font-normal text-muted-foreground"
        >
          <span className="tabular-nums">{description}</span>
          <ChevronDown
            aria-hidden
            className={`size-3 shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
          />
        </Button>
      </ContextTrigger>
      <ContextContent>
        <ContextContentHeader />
        <ContextContentBody className="space-y-2 p-3">
          <div className="flex items-center justify-between gap-3">
            <Text variant="caption" tone="muted" as="span">
              Tokens ↑ (sent)
            </Text>
            <Text variant="caption" as="span" className="tabular-nums">
              {formatNumber(tokensIn)}
            </Text>
          </div>
          <div className="flex items-center justify-between gap-3">
            <Text variant="caption" tone="muted" as="span">
              Tokens ↓ (received)
            </Text>
            <Text variant="caption" as="span" className="tabular-nums">
              {formatNumber(tokensOut)}
            </Text>
          </div>
        </ContextContentBody>
        <ContextContentFooter>
          <Text variant="caption" tone="muted" as="span">
            Est. cost
          </Text>
          <Text variant="caption" as="span" className="tabular-nums">
            {formatCostUsd(costUsd)}
          </Text>
        </ContextContentFooter>
      </ContextContent>
    </Context>
  );
}
