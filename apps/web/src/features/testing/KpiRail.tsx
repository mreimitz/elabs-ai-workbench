import { useMemo, useState } from "react";
import type {
  GuardrailConfig,
  RunStep,
  SessionCapabilities,
} from "@mcp-token-footprint/shared";
import {
  cacheHitRate,
  usageInputSlices,
  type TokenUsageActual,
} from "@mcp-token-footprint/shared";
import {
  Context,
  ContextContent,
  ContextContentBody,
  ContextContentFooter,
  ContextContentHeader,
  ContextTrigger,
} from "@elabs-ai/components-ai";
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
} from "@elabs-ai/components-ui";
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
import { formatCostUsd, formatDuration, formatNumber, formatPercent } from "../../lib/format";
import { TokenAmount, type TokenAmountProps } from "../../components/TokenAmount";

/** The usage shape `TokenAmount` reads — named here so the rail's derivation stays typed. */
type TokenAmountUsage = NonNullable<TokenAmountProps["usage"]>;
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
 *   - the **Context** tile shows iff `capabilities.contextWindow`;
 *   - the **Tokens ↑ / ↓** tiles show unless `capabilities.tokens === "none"`;
 *   - the **Est. cost** tile hides entirely when `capabilities.costBasis === "none"`; a
 *     `subscription_reference` figure also carries the shared {@link SubscriptionCostMarker} "est." badge;
 *   - the **Tool calls** tile shows iff `capabilities.toolCalls`;
 *   - **Turns** always shows (no capability gates it).
 *
 * Every current backend (the five chat-completions kinds, `claude_subscription`)
 * renders exactly the tile set its declared manifest implies; a FUTURE backend with a new capability
 * combination renders correctly with zero new branches here — the whole point of D-US4.
 *
 * Observability (planning/Roadmap/RM-17-observability/, WP 3.2 — a DIFFERENT plan/WP than the D-US4 tile logic above,
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
  steps = [],
  kpiByStepId = null,
  onSelectStep,
}: KpiRailProps) {
  // One current-context source for the headline (shared with the chart's utilisation badge — S1).
  const effectiveContext = currentContextTokens;
  const utilization = contextLimit > 0 ? (effectiveContext / contextLimit) * 100 : null;

  const tokensIn = kpis?.tokensIn ?? 0;
  const tokensOut = kpis?.tokensOut ?? 0;

  // RM-33 (D-CT1/D-CT6) — the cache composition of `tokensIn`, shaped as the usage record
  // `TokenAmount` reads. Built ONLY when the run actually reported cache: absent fields mean the split
  // is unknown, and a `{ inputTokens, cachedInputTokens: 0 }` stand-in would silently assert "0%
  // cached" on every run whose backend simply never mentions caching.
  const tokenUsage: TokenAmountUsage | undefined =
    kpis && kpis.cachedTokens !== undefined
      ? {
          inputTokens: kpis.tokensIn,
          cachedInputTokens: kpis.cachedTokens,
          ...(kpis.cacheReadTokens === undefined ? {} : { cacheReadTokens: kpis.cacheReadTokens }),
          ...(kpis.cacheWriteTokens === undefined ? {} : { cacheWriteTokens: kpis.cacheWriteTokens }),
        }
      : undefined;
  const hitRate = tokenUsage ? cacheHitRate(tokenUsage as TokenUsageActual) : null;
  const toolCalls = kpis?.toolCalls ?? 0;
  const turns = kpis?.turns ?? 0;
  const costUsd = kpis?.costUsd ?? 0;

  const isSubscriptionCost = capabilities.costBasis === "subscription_reference";
  const showContext = capabilities.contextWindow;
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
  // (never a billed charge, D-CS8); every other basis is our own estimate.
  const costLead = isSubscriptionCost ? "subscription reference" : "estimated";
  const costDescription = guardrails.maxCostUsd
    ? `${costLead} · of ${formatCostUsd(guardrails.maxCostUsd)} cap`
    : costLead;

  // High utilisation is *bad* — flip the delta-direction semantics so a rising headline reads as risk.
  const headlineDirection: "up" | "neutral" = utilization != null && utilization >= 90 ? "up" : "neutral";

  const tokenFidelityLabel = "provider-actual";

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
  const relationshipNote = figureRelationshipNote({
    showContext,
    showTokens,
    showCost,
    cacheHitRate: hitRate,
  });

  return (
    <section aria-label="Run KPIs">
      <div className="grid grid-cols-2 gap-3">
        {showContext ? (
          <MetricCard
            className="min-w-0"
            emphasis="headline"
            icon={<Gauge aria-hidden />}
            label="Context"
            value={<span className="tabular-nums">{contextValue}</span>}
            description={
              // The `@elabs-ai/components-ai` `Context` breakdown backs the tile's description whenever the limit is
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
                  usage={tokenUsage}
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
              isSubscriptionCost ? (
                <span className="inline-flex items-center gap-1.5">
                  <span className="tabular-nums">{formatCostUsd(costUsd)}</span>
                  <SubscriptionCostMarker />
                </span>
              ) : (
                <span className="tabular-nums">{formatCostUsd(costUsd)}</span>
              )
            }
            // RM-36 P1-4 — a PLAIN STRING, never a `<Text>`. `MetricCard` already renders its
            // `description` inside `<p className="text-meta font-normal text-muted-foreground">`, so
            // wrapping this line in a `<Text>` (itself a `<p>`) put a `<p>` inside a `<p>`: invalid
            // HTML the browser silently re-parents, and a React error on EVERY run-console load. The
            // wrapper was also visually redundant — `variant="meta" tone="muted"` resolves to exactly
            // `text-meta text-muted-foreground`, a subset of the classes the wrapper `<p>` carries —
            // so the rendered line is byte-identical, wording included (D-CS4 owns that wording).
            // Every other tile on this rail already passes its description as a plain string.
            description={costDescription}
          />
        ) : null}
        {showTokens ? (
          <>
            <MetricCard
              className="min-w-0"
              icon={<ArrowUp aria-hidden />}
              label="Tokens ↑"
              // No `direction` affix: this card already says "Tokens ↑" in its label AND carries an
              // ArrowUp icon, so a third arrow on the number is noise. The tooltip is what is wanted.
              value={<TokenAmount value={tokensIn} usage={tokenUsage} />}
              // RM-33 — the answer to "why is this number so large". `hitRate` is null when the split
              // is unknown, and then the description reads exactly as it did before.
              description={
                hitRate === null
                  ? `sent (${tokenFidelityLabel})`
                  : `sent · ${formatPercent(hitRate * 100)} from cache`
              }
            />
            <MetricCard
              className="min-w-0"
              icon={<ArrowDown aria-hidden />}
              label="Tokens ↓"
              value={<TokenAmount value={tokensOut} />}
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
  /** RM-33 — the run's cache-read share, when known. `null`/absent leaves the note as it was. */
  cacheHitRate?: number | null;
}): string | null {
  const clauses: string[] = [];
  if (opts.showTokens) {
    // RM-33 — the most direct answer to "why is Tokens ↑ 958,457 when Context is 28,461?". The
    // cumulative-vs-snapshot clause below explains the shape of the gap; this explains its SIZE, and
    // that the figure is GROSS (D-CT1) rather than net of cache.
    clauses.push(
      opts.cacheHitRate === null || opts.cacheHitRate === undefined
        ? "Tokens ↑/↓ are cumulative sends/receives across this run's turns so far"
        : `Tokens ↑/↓ are cumulative sends/receives across this run's turns so far, counted gross — ` +
          `${formatPercent(opts.cacheHitRate * 100)} of what was sent was served from cache and billed at a fraction of the rate`,
    );
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

/** One indented `label … value` line inside the context popover's cache breakdown (RM-33). */
function BreakdownRow({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <Text variant="caption" tone="muted" as="span">
        {label}
      </Text>
      <Text variant="caption" tone="muted" as="span" className="tabular-nums">
        {formatNumber(value)}
      </Text>
    </div>
  );
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
 * The Context tile's usage-breakdown popover — the `@elabs-ai/components-ai` `Context` component (2026-07-12
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
  usage,
}: {
  usedTokens: number;
  maxTokens: number;
  /** The tile's existing `used / max` description line — now doubling as the trigger's face. */
  description: string;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  /** RM-33 — the cache composition of `tokensIn`; absent when this run's split is unknown. */
  usage?: TokenAmountUsage;
}) {
  const [open, setOpen] = useState(false);
  // RM-33 — the three mutually exclusive slices of `tokensIn`, or null when we cannot decompose it.
  // The popover is where an operator goes to reconcile the rail's figures, so this is exactly the
  // place the gross number gets broken down rather than merely hinted at.
  const slices = usage ? usageInputSlices(usage as TokenUsageActual) : null;
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
              Tokens ↑ (sent, gross)
            </Text>
            <Text variant="caption" as="span" className="tabular-nums">
              {formatNumber(tokensIn)}
            </Text>
          </div>
          {slices ? (
            <div className="space-y-1 border-border border-l pl-3">
              <BreakdownRow label="Uncached" value={slices.uncached} />
              <BreakdownRow label="Cache read (~0.1× rate)" value={slices.cacheRead} />
              {/* A cache WRITE is 1.25× — shown separately and named a premium, because the merged
                  "cached" number this replaces made a write look like a saving. */}
              {slices.cacheWrite > 0 ? (
                <BreakdownRow label="Cache write (1.25× rate)" value={slices.cacheWrite} />
              ) : null}
            </div>
          ) : usage ? (
            <Text variant="caption" tone="muted" as="p" className="border-border border-l pl-3">
              {formatNumber(usage.cachedInputTokens ?? 0)} cached — read/write split unavailable for
              this run.
            </Text>
          ) : null}
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
