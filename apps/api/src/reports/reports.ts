import type {
  AllowedServer,
  AssertionResult,
  ContextSegment,
  ContextSnapshot,
  CostBasis,
  CostBreakdown,
  ErrorFinding,
  GuardrailConfig,
  ModelParams,
  RunDetail,
  RunGrade,
  RunReport,
  RunReportHumanFeedback,
  RunReportStatistics,
  RunStep,
  ScanDetail,
  Scenario,
  SecurityPostureSection,
  TestAttachment,
  Test,
  TokenProfileRef,
  TokenUsageActual,
} from "@mcp-token-footprint/shared";
import {
  CONTEXT_SEGMENTS,
  MODEL_CONTEXT_LIMITS,
  usageSplitKind,
} from "@mcp-token-footprint/shared";
import { buildRunKpiByStep, type RunKpis } from "./run-kpi-by-step.js";
// RM-20 WP 2.2 — the ONE posture-section derivation. Both scan exports call it; neither renders the
// section itself. The import is one-directional on purpose: `security-section.ts` reaches only for
// `@mcp-token-footprint/shared`, so this file can depend on it without a value-level cycle.
import { renderSecuritySection } from "./security-section.js";

/**
 * `security` is the RM-20 WP 2.2 posture section, and it is **optional and additive** (D-SP24): when
 * it is absent the returned object is byte-identical to what this function returned before, which is
 * what keeps the workbench MCP server's `workbench://reports/scan/{id}/json` resource unchanged. A
 * present section is either the analyzer's own report or an honest reason there is none.
 */
export function createJsonReport(scan: ScanDetail, security?: SecurityPostureSection) {
  return {
    generatedAt: new Date().toISOString(),
    scan,
    ...(security === undefined ? {} : { security }),
  };
}

export function createMarkdownReport(scan: ScanDetail, security?: SecurityPostureSection): string {
  const lines = [
    "# MCP Token Footprint Report",
    "",
    `Server: ${scan.serverName}`,
    `Scan date: ${scan.scannedAt}`,
    `Token profile: ${scan.tokenProfile}`,
    "",
    "## Summary",
    "",
    `- Total tools: ${scan.totalTools}`,
    `- Total startup tokens: ${scan.totalTokens}`,
    `- Average per tool: ${Math.round(scan.averageTokensPerTool)}`,
    `- Largest tool: ${scan.largestToolName ?? "n/a"}, ${scan.largestToolTokens} tokens`,
    `- Raw tools/list bytes: ${scan.totalRawBytes}`,
    "",
  ];

  // Directly under the summary, because posture is a headline fact about a server rather than an
  // appendix — a reviewer who reads only the top of this document should still see it. `undefined`
  // contributes NO lines, so a caller that asked for no posture gets the document it always got.
  lines.push(...renderSecuritySection(security));

  lines.push(
    "## Top Tools",
    "",
    "| Rank | Tool | Tokens | Description | Schema | Contribution |",
    "|---:|---|---:|---:|---:|---:|",
  );

  scan.tools.slice(0, 25).forEach((tool, index) => {
    lines.push(
      `| ${index + 1} | ${escapeMarkdownTable(tool.toolName)} | ${tool.totalTokens} | ${tool.descriptionTokens} | ${tool.schemaTokens} | ${tool.contributionPercent.toFixed(1)}% |`,
    );
  });

  // Resources + templates share one table (the `kind` column distinguishes them); rendered only
  // when the server exposed any (mirrors the events-only-if-any pattern below).
  if (scan.resources.length > 0) {
    lines.push(
      "",
      "## Resources",
      "",
      "| Rank | URI / Name | Kind | Tokens | Contribution |",
      "|---:|---|---|---:|---:|",
    );
    scan.resources.slice(0, 25).forEach((resource, index) => {
      const label = resource.name ?? resource.uri;
      lines.push(
        `| ${index + 1} | ${escapeMarkdownTable(label)} | ${resource.kind} | ${resource.totalTokens} | ${resource.contributionPercent.toFixed(1)}% |`,
      );
    });
  }

  if (scan.prompts.length > 0) {
    lines.push(
      "",
      "## Prompts",
      "",
      "| Rank | Name | Tokens | Contribution |",
      "|---:|---|---:|---:|",
    );
    scan.prompts.slice(0, 25).forEach((prompt, index) => {
      lines.push(
        `| ${index + 1} | ${escapeMarkdownTable(prompt.promptName)} | ${prompt.totalTokens} | ${prompt.contributionPercent.toFixed(1)}% |`,
      );
    });
  }

  if (scan.events.length > 0) {
    lines.push("", "## Scan Events", "");
    for (const event of scan.events) {
      lines.push(`- ${event.createdAt} [${event.level}] ${event.message}`);
    }
  }

  return `${lines.join("\n")}\n`;
}

export function escapeMarkdownTable(value: string): string {
  return value.replaceAll("|", "\\|");
}

/**
 * Sanitize a short label for inline use in a heading or list item: collapse newlines (which would
 * break the single-line construct) and escape pipes so it's also safe if reused in a table cell.
 */
export function escapeText(value: string): string {
  return value.replaceAll(/[\r\n]+/g, " ").replaceAll("|", "\\|");
}

// ── Run report (C4 — complete session-log dump) ─────────────────────────────────────────────────────
// A FINISHED testing run, dumped as a full session log (NOT the old thin overview). The document reads
// insights-first (most important → reference material), in five sections:
//   1. Rating & verdict — the composed Auto-Rating block (answer validation, insight surplus, error
//      forensics + draft fixes, expectation grades, assertions, judge provenance). ALWAYS rendered:
//      an honest one-liner stands in when no rating was passed (stakeholder-facing completeness).
//   2. Summary — a compact run identity + one-line KPI row (derived from data already passed in).
//   3. Statistics overview — rolled-up totals, peak/end-state context, the peak segment breakdown.
//   4. Session setup — run lifecycle + the verbatim Test and Scenario config (reference material).
//   5. Step-by-step breakdown in `idx` order — each step is its own sub-block (heading + stats + the
//      context-window state at that step + the cumulative KPIs in effect), grouped by `turnIndex`.
//
// Both builders are PURE (no DB) so they are unit-testable over a fixture `RunDetail` + its enrichment.
// The run record only carries IDs, not names/model, so the route resolves the enrichment (test +
// scenario) and hands it in. Honors redaction END-TO-END: the report is built from the ALREADY-redacted
// `RunDetail` — the assistant prose (`assistantText`/`reasoningText`), the per-step `payload` blobs, and
// the per-event counts are all redacted/bounded on persistence. We never re-dump secrets; large strings
// are length-bounded here as a second belt so a report stays readable.

export type RunReportEnrichment = {
  test: Test;
  scenario: Scenario;
  /**
   * RM-33 WP 3.2 — the four terms behind the run's cost, so a reader can see WHY a 958k-token run
   * billed $0.80 rather than $3.00.
   *
   * It arrives through the enrichment rather than being computed here ON PURPOSE: pricing a model
   * goes through `resolvePrice`, which may consult the pricing-editor table in the database, and
   * these two builders are PURE by contract (see the module header). The impure assembly layer
   * (`./run-report-assembly.ts` — the one place that already fetches the run, the test and the
   * environment) computes it with `computeCostBreakdown`, the app's single cost formula (D-CT5).
   *
   * OPTIONAL and ADDITIVE: a caller that omits it gets exactly the document it got before this WP.
   */
  costBreakdown?: CostBreakdown;
};

/** Bound a (already-redacted) string blob so a report stays readable; appends a truncation marker. */
const MAX_PROSE_CHARS = 4000;
const MAX_PAYLOAD_CHARS = 2000;

/**
 * `rating` (Auto-Rating WP 1.5) is OPTIONAL and ADDITIVE: omit it and the export carries no `rating`
 * key at all (never a null placeholder). When passed, it is the composed {@link RunReport} for this
 * SAME run — the caller (`../reports/routes.ts`) fetches it via the SAME `RunReportService.compose`
 * the `GET /api/runs/:id/report` endpoint uses, so the export and the endpoint can never disagree.
 * This builder stays PURE (no DB) — it only shapes what it's handed.
 */
export function createRunJsonReport(
  run: RunDetail,
  enrich: RunReportEnrichment,
  rating?: RunReport,
  humanFeedback?: RunReportHumanFeedback,
) {
  const { test, scenario } = enrich;
  const limit = MODEL_CONTEXT_LIMITS[scenario.model];
  const kpiByStep = buildRunKpiByStep(run);

  // Key insertion order is insights-first (rating → summary/config → statistics → the raw dump last)
  // so the serialized document reads top-down like the Markdown export. Every key keeps its existing
  // name and shape — only the order changed (consumers address keys by name, never by position).
  return {
    generatedAt: new Date().toISOString(),
    // Rating & verdict (Auto-Rating WP 1.5) — the composed rating/grades block, FIRST when present;
    // absent when the caller didn't pass one (e.g. an older caller, or Auto-Rating disabled and no
    // report was composable).
    ...(rating ? { rating } : {}),
    // Human feedback (RM-17 Phase 6, AM-OB2) — a SIBLING of `rating`, never a member of it: the
    // rating is what the JUDGES said, this is what a PERSON said, and D-OB15/AR6 keeps the two
    // ledgers apart. Omitted entirely when the caller supplied no feedback source (unknown);
    // `{ entries: [] }` when the run genuinely has none.
    ...(humanFeedback ? { humanFeedback } : {}),
    // Session setup — the verbatim test + scenario config the run executed under.
    test: {
      id: test.id,
      name: test.name,
      userPrompt: test.userPrompt,
      ...(test.systemPromptOverride !== undefined
        ? { systemPromptOverride: test.systemPromptOverride }
        : {}),
      addedProfiles: test.addedProfiles,
      attachments: test.attachments,
    },
    scenario: {
      id: scenario.id,
      name: scenario.name,
      providerId: scenario.providerId,
      model: scenario.model,
      contextLimit: limit ?? null,
      params: scenario.params,
      systemPrompt: scenario.systemPrompt,
      guardrails: scenario.guardrails,
      effectiveProfiles: effectiveProfiles(scenario, test),
      allowedServers: scenario.allowedServers,
    },
    // Statistics overview — the ONE derivation, shared with Markdown §3 so the two exports can never
    // disagree about the same run.
    statistics: buildRunStatistics(run, enrich, limit),
    // Per-step cumulative KPI snapshot keyed by step id (the figure steps don't carry: cost).
    stepKpis: Object.fromEntries(kpiByStep),
    // Full embedded run (steps + events) — the raw source of truth for the session log, LAST (appendix).
    run,
  };
}

/**
 * See {@link createRunJsonReport}'s `rating` doc for where the rating comes from. Unlike the JSON
 * export, the Markdown document ALWAYS opens with the "Rating & verdict" section — when no rating was
 * passed it renders an honest one-liner instead of omitting the section (stakeholder completeness).
 */
export function createRunMarkdownReport(
  run: RunDetail,
  enrich: RunReportEnrichment,
  rating?: RunReport,
  humanFeedback?: RunReportHumanFeedback,
): string {
  const { test, scenario } = enrich;
  const limit = MODEL_CONTEXT_LIMITS[scenario.model];
  const kpiByStep = buildRunKpiByStep(run);

  const lines: string[] = ["# MCP Token Footprint Run Report", ""];

  // Insights first, raw session log last: rating → summary → statistics → setup (reference) → steps.
  renderRating(lines, rating);
  // AM-OB2 — deliberately UNNUMBERED and placed right after the rating: it is the human counterpart
  // to §1's judge verdicts, and numbering it would renumber §2–§5 in every previously exported
  // document. Omitted entirely when the caller supplied no feedback source, exactly like the JSON key.
  renderHumanFeedback(lines, humanFeedback);
  renderSummary(lines, run, test, scenario, limit);
  renderStatistics(lines, run, enrich, limit);
  renderSessionHeader(lines, run, test, scenario, limit);
  renderSteps(lines, run, scenario, kpiByStep);

  return `${lines.join("\n")}\n`;
}

// ── Section 2 — Summary (compact identity + one-line KPI row) ───────────────────────────────────────
// Everything here is DERIVED from data the builder is already handed — a stakeholder can read this
// section alone and know what ran, how it ended, and what it cost. Full detail follows in §3–§5.

function renderSummary(
  lines: string[],
  run: RunDetail,
  test: Test,
  scenario: Scenario,
  limit: number | undefined,
): void {
  // Claude subscription (WP 3.2, D-CS4/D-CS8) — a short pointer to the full accuracy footnote in §3;
  // absent for an ordinary (`api_exact`/absent) run, so its KPI line stays byte-identical to before.
  const subscriptionSuffix = isSubscriptionCostBasis(run.costBasis)
    ? " (subscription reference — see §3)"
    : "";
  lines.push(
    "## 2. Summary",
    "",
    `- Run: ${run.id} · status ${run.status} · outcome ${run.outcome ?? "n/a"} · stop reason ${stopReason(run) ?? "n/a"}`,
    `- Test: ${escapeText(test.name)}`,
    `- Scenario: ${escapeText(scenario.name)} · model ${scenario.model}${limit ? ` (context limit ${limit} tokens)` : ""}`,
    `- Started: ${run.startedAt} · duration ${formatDuration(run.durationMs)}`,
    // Cost is provider-priced and approximate — always label it estimated.
    `- KPIs: turns ${run.turns} · tool calls ${run.toolCalls} · tokens in ${run.tokensIn} · tokens out ${run.tokensOut} · est. cost $${run.costUsd.toFixed(4)}${subscriptionSuffix}`,
    "",
  );
}

// ── Section 4 — Session setup (static reference material) ───────────────────────────────────────────

function renderSessionHeader(
  lines: string[],
  run: RunDetail,
  test: Test,
  scenario: Scenario,
  limit: number | undefined,
): void {
  lines.push(
    "## 4. Session setup",
    "",
    `- Run ID: ${run.id}`,
    `- Scenario ID: ${run.scenarioId}`,
    `- Test ID: ${run.testId}`,
    `- Mode: ${run.mode}`,
    `- Status: ${run.status}`,
    `- Outcome: ${run.outcome ?? "n/a"}`,
    `- Stop reason: ${stopReason(run) ?? "n/a"}`,
    `- Started: ${run.startedAt}`,
    `- Finished: ${finishedAt(run) ?? "n/a"}`,
    `- Duration: ${formatDuration(run.durationMs)}`,
    "",
  );

  // Test config (verbatim).
  lines.push("### Test", "", `- Name: ${test.name}`, "", "User prompt:", "");
  pushFenced(lines, test.userPrompt);
  if (test.systemPromptOverride !== undefined) {
    lines.push("", "System prompt override:", "");
    pushFenced(lines, test.systemPromptOverride);
  }
  if (test.attachments.length > 0) {
    lines.push(
      "",
      "Attachments:",
      "",
      "| Name | Kind | Bytes |",
      "|---|---|---:|",
      ...test.attachments.map(
        (a: TestAttachment) =>
          `| ${escapeMarkdownTable(a.name)} | ${escapeMarkdownTable(a.kind)} | ${a.bytes} |`,
      ),
    );
  }
  lines.push("");

  // Scenario config (verbatim).
  lines.push(
    "### Scenario",
    "",
    `- Name: ${scenario.name}`,
    `- Provider: ${scenario.providerId}`,
    `- Model: ${scenario.model}${limit ? ` (context limit ${limit} tokens)` : " (context limit unknown)"}`,
    `- Params: ${formatParams(scenario.params)}`,
    `- Effective token profiles: ${effectiveProfiles(scenario, test).join(", ") || "none"}`,
    `- Guardrails: ${formatGuardrails(scenario.guardrails)}`,
    "",
    "System prompt:",
    "",
  );
  pushFenced(lines, scenario.systemPrompt);

  lines.push("", "Allowed servers:", "");
  if (scenario.allowedServers.length === 0) {
    lines.push("- none");
  } else {
    for (const server of scenario.allowedServers) {
      lines.push(`- ${escapeMarkdownTable(server.serverId)}: ${formatAllowedTools(server)}`);
    }
  }
  lines.push("");
}

// ── Section 3 — Statistics overview ─────────────────────────────────────────────────────────────────

/**
 * The ONE `statistics` derivation. Both exports call it, so §3 of the Markdown and the JSON block can
 * never disagree about the same run — which they could before, since each recomputed its own figures.
 *
 * RM-33 WP 3.2 adds the cache split and the {@link CostBreakdown} beside the existing merged
 * `cachedTokens`, each OMITTED when it cannot be known (D-CT6). `cachedTokens` itself keeps its
 * pre-RM-33 derivation (`sumCachedTokens`) so an existing consumer's number does not move.
 */
export function buildRunStatistics(
  run: RunDetail,
  enrich: RunReportEnrichment,
  limit: number | undefined,
): RunReportStatistics {
  const peak = peakContextSnapshot(run.steps);
  const endState = endStateContextTotal(run.steps);
  const usage = aggregateRunUsage(run);
  return {
    turns: run.turns,
    toolCalls: run.toolCalls,
    tokensIn: run.tokensIn,
    tokensOut: run.tokensOut,
    cachedTokens: sumCachedTokens(run.steps),
    // RM-33 (D-CT2/D-CT6) — the two halves of the merged figure above. Absent means the run cannot
    // answer read-vs-write, which is a different statement from "there was no cache".
    ...(usage.cacheReadTokens === undefined ? {} : { cacheReadTokens: usage.cacheReadTokens }),
    ...(usage.cacheWriteTokens === undefined ? {} : { cacheWriteTokens: usage.cacheWriteTokens }),
    peakContextTokens: run.peakContextTokens,
    contextLimit: limit ?? null,
    ...(endState === undefined ? {} : { endStateContextTokens: endState }),
    estimatedCostUsd: run.costUsd,
    // Claude subscription (planning/Roadmap/RM-09-claude-subscription/, WP 3.2, D-CS4/D-CS8) — a machine-readable
    // marker for HOW `estimatedCostUsd` was derived, mirroring {@link RunSummary.costBasis}. Present
    // ONLY for a `claude_subscription` run (`"subscription_reference"` — a shadow reference estimate,
    // marginal cost $0, never a billed charge); absent for every ordinary run, so this report stays
    // byte-identical to before this WP.
    ...(run.costBasis ? { costBasis: run.costBasis } : {}),
    ...(enrich.costBreakdown ? { costBreakdown: enrich.costBreakdown } : {}),
    peakContextSegments: peak?.segments ?? null,
  };
}

function renderStatistics(
  lines: string[],
  run: RunDetail,
  enrich: RunReportEnrichment,
  limit: number | undefined,
): void {
  const peak = peakContextSnapshot(run.steps);
  const stats = buildRunStatistics(run, enrich, limit);
  const subscriptionReference = isSubscriptionCostBasis(run.costBasis);

  lines.push(
    "## 3. Statistics",
    "",
    `- Turns: ${stats.turns}`,
    `- Tool calls: ${stats.toolCalls}`,
    `- Tokens in: ${stats.tokensIn}`,
    `- Tokens out: ${stats.tokensOut}`,
    `- Cached tokens: ${stats.cachedTokens}`,
    ...renderCacheSplitLines(stats),
    `- Peak context: ${formatPeakContext(stats.peakContextTokens, limit)}`,
    `- End-state context: ${stats.endStateContextTokens === undefined ? "n/a" : `${stats.endStateContextTokens} tokens`}`,
    // Cost is provider-priced and approximate — always label it estimated. A `claude_subscription`
    // run's cost is additionally flagged "subscription reference" (WP 3.2, D-CS4) — the footnote right
    // below spells out the full accuracy story.
    `- Estimated cost: $${stats.estimatedCostUsd.toFixed(4)} (estimated)${subscriptionReference ? " · subscription reference" : ""}`,
    ...renderCostBreakdownLines(stats.costBreakdown),
    "",
  );

  renderSubscriptionCostFootnote(lines, run.costBasis);

  lines.push("Context segment breakdown at peak:", "");
  if (!peak) {
    lines.push("- n/a (no per-step context snapshots)");
  } else {
    lines.push("| Segment | Tokens |", "|---|---:|");
    for (const segment of CONTEXT_SEGMENTS) {
      lines.push(`| ${segment} | ${peak.segments[segment]} |`);
    }
  }
  lines.push("");
}

// ── RM-33 WP 3.2 — the cache lines of §3 ───────────────────────────────────────────────────────────
// The wording is the one this workstream settled on and uses everywhere (console, dashboard): a cache
// READ is billed "~0.1x" — a discount — and a cache WRITE is billed "1.25x" — a PREMIUM. They are
// never merged into one "cached" figure in a NEW surface (D-CT2), because a single number that mixes
// them reads as a saving when it may be an extra charge.

/** Cache read / cache write beside the merged `Cached tokens` line, or an honest caveat instead. */
function renderCacheSplitLines(stats: RunReportStatistics): string[] {
  if (stats.cacheReadTokens !== undefined || stats.cacheWriteTokens !== undefined) {
    return [
      `- Cache read: ${stats.cacheReadTokens ?? 0} (billed ~0.1x input — a discount)`,
      `- Cache write: ${stats.cacheWriteTokens ?? 0} (billed 1.25x input — a premium, not a saving)`,
    ];
  }
  // Nothing to split: a run that reported no cache at all says so by its `0`, and adding a caveat
  // there would invent doubt. A run that reported a MERGED figure genuinely cannot answer, and must
  // say so rather than let the reader assume the whole slice was a discount.
  if (stats.cachedTokens <= 0) return [];
  return [
    "- Cache read/write split: unavailable for this run — the whole cached slice above is priced as a cache read",
  ];
}

/** The four terms behind the cost, plus the signed cache effect (which can be a PREMIUM). */
function renderCostBreakdownLines(breakdown: CostBreakdown | undefined): string[] {
  if (!breakdown) return [];
  if (!breakdown.priced) {
    return ["- Cost breakdown: n/a (no price on file for this model — the cost above is $0 because"
      + " it could not be priced, not because the run was free)"];
  }
  const lines = [
    `- Cost breakdown: uncached input $${breakdown.uncachedUsd.toFixed(4)} · cache read` +
      ` $${breakdown.cacheReadUsd.toFixed(4)} · cache write $${breakdown.cacheWriteUsd.toFixed(4)} ·` +
      ` output $${breakdown.outputUsd.toFixed(4)} = $${breakdown.totalUsd.toFixed(4)}`,
  ];
  // Signed on purpose (D-CT5): a write-heavy run genuinely cost MORE than the same tokens uncached,
  // and rendering that as "saved -$0.02" would be a lie dressed as a saving.
  lines.push(
    breakdown.savedVsUncachedUsd >= 0
      ? `- Cache effect: saved $${breakdown.savedVsUncachedUsd.toFixed(4)} versus billing every input token at the full rate`
      : `- Cache effect: cost $${Math.abs(breakdown.savedVsUncachedUsd).toFixed(4)} MORE than billing every input token at the full rate (cache writes are a 1.25x premium)`,
  );
  // A merged record has one number and no way to tell a discount from a premium, so the two lines
  // above are a FLOOR, not a measurement — the pricing function prices the whole slice as a read
  // because that is the only safe reading of a merged figure. Say so; do not let it read as precise.
  if (breakdown.split === "merged") {
    lines.push(
      "- Cost breakdown caveat: this run reported only a merged cached figure, so the whole cached" +
        " slice above is priced as a cache read. Any part of it that was actually a cache write cost" +
        " 1.25x input, so the real bill was at least this much and possibly higher.",
    );
  }
  return lines;
}

// ── Claude subscription accuracy footnote (WP 3.2, D-CS4/D-CS8) ────────────────────────────────────
// A `claude_subscription` run's `costUsd` is a SHADOW REFERENCE (exact tokens × the Anthropic list
// price; marginal subscription cost is $0), not a billed charge — mirroring the web
// `SubscriptionCostMarker` tooltip. This constant is the ONE wording both the run report (below) and
// the suite-run report (`./suite-run-report.ts`, which embeds/links member run reports) render from, so
// the accuracy story reads identically everywhere. Renders nothing for an ordinary run.

/** True when a run's {@link CostBasis} means its `costUsd` is a subscription shadow-price estimate. */
export function isSubscriptionCostBasis(costBasis: CostBasis | undefined): boolean {
  return costBasis === "subscription_reference";
}

/** The shared footnote body (no leading `>` / blank lines — callers wrap it for their own context). */
export const SUBSCRIPTION_COST_FOOTNOTE =
  "This run executed on the Claude subscription; the marginal cost was $0. The cost figure above is " +
  "a REFERENCE ESTIMATE — exact token counts × the Anthropic list price for the model — not a billed " +
  "charge. Token counts are provider-exact; per-tool/skill metering and context-window granularity " +
  "are estimates. Logprob-weighted outcome judging is unavailable for this run (falls back to a " +
  "single sample).";

/** Renders the shared footnote as a blockquote, only when `costBasis` flags a subscription run. */
function renderSubscriptionCostFootnote(lines: string[], costBasis: CostBasis | undefined): void {
  if (!isSubscriptionCostBasis(costBasis)) return;
  lines.push(`> **Cost note — subscription reference.** ${SUBSCRIPTION_COST_FOOTNOTE}`, "");
}

// ── Section 5 — Step-by-step breakdown (idx order, grouped by turnIndex) ─────────────────────────────

function renderSteps(
  lines: string[],
  run: RunDetail,
  scenario: Scenario,
  kpiByStep: Map<string, RunKpis>,
): void {
  lines.push("## 5. Steps", "");

  if (run.steps.length === 0) {
    lines.push("_No steps recorded for this run._", "");
    return;
  }

  // `idx` order — `getRun` returns steps already ordered by the gapless persisted `idx` (= `step.index`),
  // but sort defensively so the report is order-independent of the caller.
  const steps = [...run.steps].sort((a, b) => a.index - b.index);

  let lastTurn: number | undefined;
  steps.forEach((step, position) => {
    // Annotate turn boundaries so the reader sees the turn structure.
    if (step.turnIndex !== undefined && step.turnIndex !== lastTurn) {
      lines.push(`### Turn ${step.turnIndex + 1}`, "");
      lastTurn = step.turnIndex;
    }

    const label = step.toolName ?? step.label;
    lines.push(
      `#### Step ${position + 1} — ${step.type} · ${escapeText(label)} · ${step.status} · ${formatDuration(step.durationMs)}`,
      "",
    );

    // Stats line: tok up/down (provider-actual or the primary profile lens), cached + reasoning tokens.
    lines.push(`- Stats: ${formatStepStats(step)}`);

    // Running cumulative KPIs in effect at this step (the figure steps don't carry: cost).
    const kpis = kpiByStep.get(step.id);
    if (kpis) {
      lines.push(
        `- Cumulative KPIs: turns ${kpis.turns}, toolCalls ${kpis.toolCalls}, tokensIn ${kpis.tokensIn}, tokensOut ${kpis.tokensOut}, cost $${kpis.costUsd.toFixed(4)}`,
      );
    }

    // Context-window development at this step (table follows the bullet stats, with its own blank line).
    if (step.context) {
      renderStepContext(lines, step.context, step.cumulativeTokens);
    } else if (step.cumulativeTokens !== undefined) {
      lines.push(`- Cumulative context tokens: ${step.cumulativeTokens}`);
    }

    // Conversation / tool content (all from the already-redacted RunDetail).
    renderStepContent(lines, step);
    lines.push("");
  });
}

function renderStepContext(
  lines: string[],
  context: ContextSnapshot,
  cumulativeTokens?: number,
): void {
  lines.push(
    `- Context window: ${context.total} / ${context.limit} tokens` +
      (cumulativeTokens !== undefined ? ` (cumulative ${cumulativeTokens})` : ""),
  );
  // Blank line so the table isn't glued to the preceding bullet; trailing blank closes the table block.
  lines.push("", "| Segment | Tokens |", "|---|---:|");
  for (const segment of CONTEXT_SEGMENTS) {
    lines.push(`| ${segment} | ${context.segments[segment as ContextSegment]} |`);
  }
  lines.push("");
}

/** Render the conversation/tool content for a step, fenced + bounded (already redacted upstream). */
function renderStepContent(lines: string[], step: RunStep): void {
  if (step.type === "user_message") {
    const text = payloadText(step.payload);
    if (text !== undefined) {
      lines.push("", "User:", "");
      pushFenced(lines, boundString(text, MAX_PROSE_CHARS));
    }
    return;
  }

  if (step.type === "llm_response") {
    if (step.reasoningText) {
      lines.push("", "Assistant reasoning:", "");
      pushFenced(lines, boundString(step.reasoningText, MAX_PROSE_CHARS));
    }
    if (step.assistantText) {
      lines.push("", "Assistant:", "");
      pushFenced(lines, boundString(step.assistantText, MAX_PROSE_CHARS));
    }
    return;
  }

  if (step.type === "tool_call" || step.type === "tool_result") {
    const args = payloadField(step.payload, "args");
    const result = payloadField(step.payload, "result");
    if (args !== undefined) {
      lines.push("", "Args (redacted):", "");
      pushFencedJson(lines, args);
    }
    if (result !== undefined) {
      lines.push("", "Result (redacted):", "");
      pushFencedJson(lines, result);
    }
  }
}

// ── Section 1 — Rating & verdict (Auto-Rating WP 1.5) ───────────────────────────────────────────────
// The report LEADS with this — it is the highest-value insight for a stakeholder. Renders the composed
// `RunReport` the caller fetched via the SAME `RunReportService.compose` the `GET /api/runs/:id/report`
// endpoint uses. Base-rating verdicts are their OWN dimension (AR6) — never mixed into the
// expectation-grades table. The section ALWAYS renders: when no rating was passed, an honest one-liner
// stands in rather than silently omitting the section (stakeholder-facing completeness).

function renderRating(lines: string[], rating: RunReport | undefined): void {
  lines.push("## 1. Rating & verdict", "");

  if (!rating) {
    lines.push("_No rating available for this run._", "");
    return;
  }

  lines.push(
    "### Base rating",
    "",
    `- Answer validation: verdict **${rating.baseRating.answerValidation.verdict}**, score ${formatGradeScore(rating.baseRating.answerValidation.score)}`,
    `- Insight surplus: verdict **${rating.baseRating.insightSurplus.verdict}**, score ${formatGradeScore(rating.baseRating.insightSurplus.score)}` +
      (rating.baseRating.insightSurplus.surplusTokens !== undefined
        ? ` (surplus ${rating.baseRating.insightSurplus.surplusTokens} tokens)`
        : ""),
    "",
  );
  renderErrorForensics(lines, rating.baseRating.errorForensics);

  lines.push("### Expectation grades", "");
  renderExpectationGrades(lines, rating.expectationGrades);

  lines.push("### Assertions", "");
  renderAssertionResults(lines, rating.assertionResults);

  lines.push(
    "### Provenance",
    "",
    `- Judge: ${rating.judgeProvenance.judgeProviderId ?? "none"}${rating.judgeProvenance.judgeModel ? ` (${rating.judgeProvenance.judgeModel})` : ""}`,
    `- Rating version: ${rating.ratingVersion}`,
    `- Generated: ${rating.generatedAt}`,
    "",
  );
}

// ── Human feedback (RM-17 Phase 6, AM-OB2) ──────────────────────────────────────────────────────────
// What a PERSON said about this run, beside §1's judge verdicts and deliberately never inside them
// (D-OB15/AR6). The corrected answer gets its own labelled sub-block, distinct from the verdict and
// from any free-text note, because it is the one piece of feedback with a downstream consumer: it
// pre-fills the expectation of a test promoted from this run.
//
// The three honest states, matching the JSON key exactly:
//   - `humanFeedback` undefined      → no section at all (the caller carried no feedback source).
//   - `entries: []`                  → the section renders "No human feedback was recorded…".
//   - no `correctedOutput`           → "No corrected answer was captured." NOT "the answer was fine".

function renderHumanFeedback(
  lines: string[],
  humanFeedback: RunReportHumanFeedback | undefined,
): void {
  if (!humanFeedback) return;
  lines.push("## Human feedback", "");

  lines.push("### Corrected answer", "");
  if (humanFeedback.correctedOutput !== undefined) {
    // Fenced: operator-authored prose is untrusted Markdown and must not restyle the document.
    pushFenced(lines, boundString(humanFeedback.correctedOutput, MAX_PROSE_CHARS));
    lines.push("");
  } else {
    // Absence is not a verdict — say which absence this is.
    lines.push("_No corrected answer was captured for this run._", "");
  }

  lines.push("### Recorded feedback", "");
  if (humanFeedback.entries.length === 0) {
    lines.push("_No human feedback was recorded for this run._", "");
    return;
  }
  lines.push(
    "| Key | Scope | Score | Note | Source | Recorded |",
    "|---|---|---|---|---|---|",
    ...humanFeedback.entries.map(
      (entry) =>
        `| ${escapeMarkdownTable(entry.key)} | ${entry.stepId ? `step ${escapeMarkdownTable(entry.stepId)}` : "run"} | ${entry.score ?? "—"} | ${escapeMarkdownTable(entry.comment ?? "—")} | ${entry.source} | ${entry.createdAt} |`,
    ),
    "",
  );
}

function renderErrorForensics(lines: string[], findings: readonly ErrorFinding[]): void {
  lines.push("Error forensics:", "");
  if (findings.length === 0) {
    lines.push("- No findings (operationally clean).", "");
    return;
  }
  lines.push(
    "| Bucket | Fix target | Description | Sent arguments | Exact error | Draft fix |",
    "|---|---|---|---|---|---|",
    ...findings.map(
      (finding) =>
        `| ${finding.bucket} | ${finding.fixTarget} | ${escapeMarkdownTable(finding.description)} | ${escapeMarkdownTable(finding.sentArguments ?? "—")} | ${escapeMarkdownTable(finding.errorMessage ?? "—")} | ${escapeMarkdownTable(finding.draftFix)} |`,
    ),
    "",
  );
}

function renderExpectationGrades(lines: string[], grades: readonly RunGrade[]): void {
  if (grades.length === 0) {
    lines.push("_No expectation graders ran for this run._", "");
    return;
  }
  lines.push(
    "| Grader | Status | Score | Method |",
    "|---|---|---:|---|",
    ...grades.map(
      (grade) =>
        `| ${grade.graderId} | ${grade.status} | ${formatGradeScore(grade.score)} | ${escapeMarkdownTable(grade.method)} |`,
    ),
    "",
  );
}

function renderAssertionResults(lines: string[], results: readonly AssertionResult[]): void {
  if (results.length === 0) {
    lines.push("_No assertions declared for this run's test._", "");
    return;
  }
  lines.push(
    "| Assertion | Status | Reason |",
    "|---|---|---|",
    ...results.map(
      (result) =>
        `| ${result.assertion.kind} | ${result.status} | ${escapeMarkdownTable(result.reason)} |`,
    ),
    "",
  );
}

/** A 0–1 grade score to two decimals, or "n/a" when null (never fabricate a 0 for an ungraded facet). */
function formatGradeScore(score: number | null): string {
  return score === null ? "n/a" : score.toFixed(2);
}

// ── Step-stat helpers ───────────────────────────────────────────────────────────────────────────────

/** A compact per-step stats line: tok↑/tok↓ (provider-actual or primary lens), cached + reasoning. */
function formatStepStats(step: RunStep): string {
  const parts: string[] = [];
  parts.push(`tok↑ ${formatCell(stepTokensUp(step))}`);
  parts.push(`tok↓ ${formatCell(stepTokensDown(step))}`);
  const usage = step.usageActual;
  const cached = usage?.cachedInputTokens;
  if (cached !== undefined && cached > 0) parts.push(`cached ${cached}`);
  // RM-33 WP 3.2 — when this turn reported the split, name the halves right after the merged figure.
  // A merged-only turn is left alone: it has one number and cannot honestly be decomposed (D-CT2).
  if (usage && usageSplitKind(usage) === "exact") {
    parts.push(`cache read ${usage.cacheReadTokens ?? 0}`);
    parts.push(`cache write ${usage.cacheWriteTokens ?? 0}`);
  }
  const reasoning = usage?.reasoningTokens;
  if (reasoning !== undefined && reasoning > 0) parts.push(`reasoning ${reasoning}`);
  return parts.join(", ");
}

/** The peak-context step snapshot (the one whose `context.total` is highest); undefined if none carry it. */
function peakContextSnapshot(steps: RunStep[]): ContextSnapshot | undefined {
  let peak: ContextSnapshot | undefined;
  for (const step of steps) {
    if (step.context && (!peak || step.context.total > peak.total)) peak = step.context;
  }
  return peak;
}

/** The end-state context total = the last (highest-index) step that carries a context snapshot. */
function endStateContextTotal(steps: RunStep[]): number | undefined {
  let end: number | undefined;
  let endIndex = -1;
  for (const step of steps) {
    if (step.context && step.index > endIndex) {
      end = step.context.total;
      endIndex = step.index;
    }
  }
  return end;
}

// ── Formatting + payload helpers ──────────────────────────────────────────────────────────────────────

function formatParams(params: ModelParams): string {
  const parts: string[] = [];
  if (params.temperature !== undefined) parts.push(`temp ${params.temperature}`);
  if (params.maxOutputTokens !== undefined) parts.push(`maxOut ${params.maxOutputTokens}`);
  if (params.topP !== undefined) parts.push(`topP ${params.topP}`);
  if (params.reasoningEffort !== undefined) parts.push(`reasoning ${params.reasoningEffort}`);
  return parts.length > 0 ? parts.join(", ") : "defaults";
}

/** All guardrails, each shown so an absent one reads "—" rather than vanishing. */
function formatGuardrails(g: GuardrailConfig): string {
  const cell = (v: number | undefined) => (v === undefined ? "—" : String(v));
  return (
    `maxTurns ${cell(g.maxTurns)}, maxToolCalls ${cell(g.maxToolCalls)}, ` +
    `maxTokens ${cell(g.maxTokens)}, maxContextTokens ${cell(g.maxContextTokens)}, ` +
    `maxCostUsd ${g.maxCostUsd === undefined ? "—" : `$${g.maxCostUsd}`}`
  );
}

/** Effective token profiles = scenario.defaultProfiles ∪ test.addedProfiles (dedup, order-stable). */
function effectiveProfiles(scenario: Scenario, test: Test): TokenProfileRef[] {
  const seen = new Set<TokenProfileRef>();
  const out: TokenProfileRef[] = [];
  for (const p of [...scenario.defaultProfiles, ...test.addedProfiles]) {
    if (!seen.has(p)) {
      seen.add(p);
      out.push(p);
    }
  }
  return out;
}

function formatAllowedTools(server: AllowedServer): string {
  if (server.allowedTools === null) return "all tools";
  if (server.allowedTools.length === 0) return "no tools";
  return server.allowedTools.map((t) => escapeText(t)).join(", ");
}

function finishedAt(run: RunDetail): string | undefined {
  if (run.durationMs === undefined) return undefined;
  const started = Date.parse(run.startedAt);
  if (Number.isNaN(started)) return undefined;
  return new Date(started + run.durationMs).toISOString();
}

/** Surface the run's stop reason from its terminal `status` event, if any. */
function stopReason(run: RunDetail): string | undefined {
  for (let i = run.events.length - 1; i >= 0; i -= 1) {
    const event = run.events[i];
    if (event && event.type === "status" && event.stopReason !== undefined) return event.stopReason;
  }
  return undefined;
}

function formatDuration(durationMs: number | undefined): string {
  if (durationMs === undefined) return "n/a";
  return `${(durationMs / 1000).toFixed(1)}s`;
}

/** Peak context as a % of the model limit; guard divide-by-zero — show raw tokens when limit unknown. */
function formatPeakContext(peakTokens: number, limit: number | undefined): string {
  if (!limit || limit <= 0) return `${peakTokens} tokens (limit unknown)`;
  return `${((peakTokens / limit) * 100).toFixed(1)}% (${peakTokens} / ${limit} tokens)`;
}

/** Sum provider-actual cached input tokens across all steps. */
function sumCachedTokens(steps: RunStep[]): number {
  return steps.reduce((sum, step) => sum + (step.usageActual?.cachedInputTokens ?? 0), 0);
}

/**
 * RM-33 WP 3.2 — the run's provider-actual usage as ONE {@link TokenUsageActual} record, so the cost
 * breakdown and the cache lines are read from a single derivation instead of three.
 *
 * Gross `inputTokens`/`outputTokens` come from the run SUMMARY, which is never redacted (the same
 * reason `withSummaryTotals` exists). The cache composition prefers the migration-59 run columns —
 * the authoritative end-state figures — and falls back to summing the per-step `usageActual`, which
 * is where the split lives for a run recorded before those columns existed.
 *
 * Only an EXACT per-step split contributes to the halves (D-CT2): a turn that reported one merged
 * figure leaves them unknowable, and counting it as a READ would show a possible 1.25x cache-write
 * premium as a 0.1x discount. A field nobody can answer is OMITTED, never zeroed (D-CT6).
 */
export function aggregateRunUsage(run: RunDetail): TokenUsageActual {
  let cachedFromSteps = 0;
  let readFromSteps = 0;
  let writeFromSteps = 0;
  let sawAnyCache = false;
  let sawExactSplit = false;
  for (const step of run.steps) {
    const usage = step.usageActual;
    if (!usage) continue;
    const kind = usageSplitKind(usage);
    if (kind === "none") continue;
    sawAnyCache = true;
    cachedFromSteps += usage.cachedInputTokens ?? 0;
    if (kind === "exact") {
      sawExactSplit = true;
      readFromSteps += usage.cacheReadTokens ?? 0;
      writeFromSteps += usage.cacheWriteTokens ?? 0;
    }
  }
  const cachedInputTokens = run.cachedTokens ?? (sawAnyCache ? cachedFromSteps : undefined);
  const cacheReadTokens = run.cacheReadTokens ?? (sawExactSplit ? readFromSteps : undefined);
  const cacheWriteTokens = run.cacheWriteTokens ?? (sawExactSplit ? writeFromSteps : undefined);
  return {
    inputTokens: run.tokensIn,
    outputTokens: run.tokensOut,
    ...(cachedInputTokens === undefined ? {} : { cachedInputTokens }),
    ...(cacheReadTokens === undefined ? {} : { cacheReadTokens }),
    ...(cacheWriteTokens === undefined ? {} : { cacheWriteTokens }),
  };
}

/** Tokens IN for a step: provider-actual input when present, else the primary profile lens. */
function stepTokensUp(step: RunStep): number | undefined {
  if (step.usageActual) return step.usageActual.inputTokens;
  return firstProfileTokens(step);
}

/** Tokens OUT for a step: provider-actual output when present, else undefined (lenses are not split). */
function stepTokensDown(step: RunStep): number | undefined {
  return step.usageActual?.outputTokens;
}

/** The first available estimator-lens token count for a step (used when there's no provider-actual). */
function firstProfileTokens(step: RunStep): number | undefined {
  for (const value of Object.values(step.profileTokens)) {
    if (typeof value === "number") return value;
  }
  return undefined;
}

function formatCell(value: number | undefined): string {
  return value === undefined ? "—" : String(value);
}

/** Pull a string `text` field off a redacted payload object (for `user_message` steps). */
function payloadText(payload: unknown): string | undefined {
  const value = (payload as { text?: unknown } | null | undefined)?.text;
  return typeof value === "string" ? value : undefined;
}

/** Pull a named field off a redacted payload object (e.g. `args`/`result` for tool steps). */
function payloadField(payload: unknown, key: string): unknown {
  if (typeof payload !== "object" || payload === null) return undefined;
  return (payload as Record<string, unknown>)[key];
}

/** Bound a string to `max` chars with an explicit truncation marker (defense-in-depth on size). */
export function boundString(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max)}\n…[truncated ${value.length - max} chars]`;
}

/** Append a fenced text block (plain), guarding against a closing-fence collision in the body. */
export function pushFenced(lines: string[], body: string): void {
  const fence = body.includes("```") ? "````" : "```";
  lines.push(fence, body, fence);
}

/** Append a fenced JSON block from an already-redacted value (bounded). */
function pushFencedJson(lines: string[], value: unknown): void {
  let serialized: string;
  try {
    serialized = JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    serialized = "[unserializable]";
  }
  const body = boundString(serialized, MAX_PAYLOAD_CHARS);
  const fence = body.includes("```") ? "````" : "```";
  lines.push(`${fence}json`, body, fence);
}
