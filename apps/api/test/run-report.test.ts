import assert from "node:assert/strict";
import { test } from "node:test";
import {
  AUTO_RATING_VERSION,
  type RunDetail,
  type RunReport,
  type Scenario,
  type Test,
} from "@mcp-token-footprint/shared";
import { createRunJsonReport, createRunMarkdownReport } from "../src/reports/reports.js";

// C4 — Run export as a COMPLETE session-log dump. Unit-tests the PURE report builders (no DB, no API
// key) over a fixture `RunDetail` + its `{ test, scenario }` enrichment. The run record only carries
// IDs, so the route resolves names/model and hands them in; the builders shape the JSON / Markdown
// session log insights-first: (1) rating & verdict (an honest one-liner when none), (2) compact
// summary, (3) statistics overview, (4) session setup (verbatim test/scenario config), (5) ordered
// per-step breakdown with per-step context + cumulative KPIs, grouped by turn.

// Sentinels that would be secrets if the report ever dumped a step's redacted text/payload verbatim
// past its bound. The fixture's prose/payloads stay short, so these must appear (the report DOES dump
// the already-redacted prose now) — but the API-side payload redaction strips real secrets first. The
// dedicated leak test below proves the builder never invents a payload field the run didn't carry.
const PAYLOAD_SECRET = "sk-ant-NEVER-IN-A-REPORT-0001";

function fixtureTest(): Test {
  return {
    id: "test-1",
    name: "List files test",
    userPrompt: "Use the tools, then answer.",
    systemPromptOverride: "Override: be terse.",
    addedProfiles: ["generic_cl100k"],
    attachments: [
      {
        id: "att-1",
        kind: "image",
        name: "screenshot.png",
        bytes: 5120,
        createdAt: "2026-06-20T00:00:00.000Z",
      },
    ],
    createdAt: "2026-06-20T00:00:00.000Z",
    updatedAt: "2026-06-20T00:00:00.000Z",
  };
}

function fixtureScenario(): Scenario {
  return {
    id: "scn-1",
    name: "Baseline scenario",
    providerId: "prov-1",
    model: "claude-sonnet-4",
    params: { temperature: 0.2, maxOutputTokens: 1024 },
    systemPrompt: "You are a test harness.",
    allowedServers: [{ serverId: "srv", allowedTools: ["alpha", "beta"] }],
    defaultProfiles: ["generic_o200k"],
    guardrails: { maxTurns: 10, maxCostUsd: 1 },
    createdAt: "2026-06-20T00:00:00.000Z",
    updatedAt: "2026-06-20T00:00:00.000Z",
  };
}

function fixtureRun(): RunDetail {
  const steps: RunDetail["steps"] = [
    {
      id: "step-user",
      runId: "run-1",
      index: 0,
      type: "user_message",
      label: "user",
      status: "ok",
      turnIndex: 0,
      profileTokens: {},
      payload: { text: "Use the tools, then answer." },
    },
    {
      id: "step-tool-call",
      runId: "run-1",
      index: 1,
      type: "tool_call",
      label: "alpha",
      status: "ok",
      durationMs: 50,
      serverId: "srv",
      toolName: "alpha",
      turnIndex: 0,
      profileTokens: { generic_o200k: 40 },
      payload: { toolCallId: "call-1", args: { path: "/tmp" } },
    },
    {
      id: "step-tool-result",
      runId: "run-1",
      index: 2,
      type: "tool_result",
      label: "alpha",
      status: "ok",
      durationMs: 12,
      serverId: "srv",
      toolName: "alpha",
      turnIndex: 0,
      profileTokens: {},
      payload: { toolCallId: "call-1", result: { files: ["a.txt", "b.txt"] } },
    },
    {
      id: "step-llm",
      runId: "run-1",
      index: 3,
      type: "llm_response",
      label: "claude-sonnet-4",
      status: "ok",
      durationMs: 800,
      turnIndex: 0,
      profileTokens: { generic_o200k: 130 },
      usageActual: {
        inputTokens: 137,
        outputTokens: 23,
        cachedInputTokens: 11,
        reasoningTokens: 7,
      },
      context: {
        total: 20000,
        limit: 200000,
        segments: { system: 100, tool_defs: 200, history: 300, tool_results: 400, output: 500 },
      },
      cumulativeTokens: 20000,
      assistantText: "Found 2 files: a.txt and b.txt.",
      reasoningText: "I should list the directory first.",
      // A raw payload that WOULD leak a secret if the report dumped the whole payload — it must not.
      payload: { deltas: {}, snapshot: {}, apiKey: PAYLOAD_SECRET },
    },
  ];

  return {
    id: "run-1",
    testId: "test-1",
    scenarioId: "scn-1",
    mode: "automated",
    status: "completed",
    outcome: "completed",
    startedAt: "2026-06-20T00:00:00.000Z",
    durationMs: 4200,
    turns: 1,
    toolCalls: 1,
    peakContextTokens: 20000, // 10% of claude-sonnet-4's 200k limit
    tokensIn: 137,
    tokensOut: 23,
    costUsd: 0.0123,
    steps,
    events: [
      { type: "status", status: "running" },
      { type: "step", step: steps[0]! },
      { type: "step", step: steps[1]! },
      { type: "step", step: steps[2]! },
      { type: "step", step: steps[3]! },
      // The trailing `kpi` carries the per-step cumulative cost the steps themselves don't.
      {
        type: "kpi",
        turns: 1,
        toolCalls: 1,
        tokensIn: 137,
        tokensOut: 23,
        contextTokens: 20000,
        costUsd: 0.0123,
      },
      { type: "status", status: "completed", outcome: "completed", stopReason: "model_stop" },
    ],
  };
}

test("createRunJsonReport carries the full session header, statistics, and per-step KPIs", () => {
  const report = createRunJsonReport(fixtureRun(), {
    test: fixtureTest(),
    scenario: fixtureScenario(),
  });

  assert.ok(typeof report.generatedAt === "string", "generatedAt is an ISO timestamp");
  assert.ok(!Number.isNaN(Date.parse(report.generatedAt)), "generatedAt parses as a date");
  assert.equal(report.run.id, "run-1", "the run is embedded");
  assert.equal(report.run.steps.length, 4, "the run's steps are embedded");

  // Insights-first key order (names/shapes unchanged; the raw run dump comes last).
  assert.deepEqual(
    Object.keys(report),
    ["generatedAt", "test", "scenario", "statistics", "stepKpis", "run"],
    "key insertion order reads insights-first, raw run last",
  );

  // Session setup — carries the verbatim test + scenario config.
  assert.equal(report.test.name, "List files test", "test name");
  assert.equal(report.test.userPrompt, "Use the tools, then answer.", "verbatim user prompt");
  assert.equal(report.test.systemPromptOverride, "Override: be terse.", "system prompt override");
  assert.equal(report.test.attachments.length, 1, "attachments embedded");
  assert.equal(report.scenario.name, "Baseline scenario", "scenario name");
  assert.equal(report.scenario.providerId, "prov-1", "provider resolved");
  assert.equal(report.scenario.model, "claude-sonnet-4", "model resolved");
  assert.equal(
    report.scenario.contextLimit,
    200000,
    "context limit resolved from MODEL_CONTEXT_LIMITS",
  );
  assert.equal(report.scenario.systemPrompt, "You are a test harness.", "scenario system prompt");
  assert.deepEqual(
    report.scenario.effectiveProfiles,
    ["generic_o200k", "generic_cl100k"],
    "effective profiles = scenario.defaultProfiles ∪ test.addedProfiles (deduped, ordered)",
  );
  assert.equal(report.scenario.allowedServers.length, 1, "allowed servers carried");

  // Section 2 — statistics.
  assert.equal(report.statistics.turns, 1, "turns");
  assert.equal(report.statistics.cachedTokens, 11, "cached tokens summed");
  assert.equal(
    report.statistics.endStateContextTokens,
    20000,
    "end-state context from last snapshot",
  );
  assert.equal(report.statistics.estimatedCostUsd, 0.0123, "estimated cost");
  assert.ok(report.statistics.peakContextSegments, "peak segment breakdown present");
  assert.equal(report.statistics.peakContextSegments!.history, 300, "peak segment value");

  // Section 3 — per-step cumulative KPI snapshot (cost recovered from the `kpi` event).
  assert.ok(report.stepKpis["step-llm"], "the llm step has a cumulative KPI snapshot");
  assert.equal(
    report.stepKpis["step-llm"]!.costUsd,
    0.0123,
    "cumulative cost stamped from the kpi event",
  );
});

test("createRunMarkdownReport renders the 5 session-log sections in insights-first order", () => {
  const md = createRunMarkdownReport(fixtureRun(), {
    test: fixtureTest(),
    scenario: fixtureScenario(),
  });

  // Section headings — insights first, raw session log last.
  assert.match(md, /^# MCP Token Footprint Run Report/m, "report title heading");
  assert.match(md, /^## 1\. Rating & verdict/m, "Section 1 heading");
  assert.match(md, /^## 2\. Summary/m, "Section 2 heading");
  assert.match(md, /^## 3\. Statistics/m, "Section 3 heading");
  assert.match(md, /^## 4\. Session setup/m, "Section 4 heading");
  assert.match(md, /^## 5\. Steps/m, "Section 5 heading");
  const order = [
    "## 1. Rating & verdict",
    "## 2. Summary",
    "## 3. Statistics",
    "## 4. Session setup",
    "## 5. Steps",
  ].map((heading) => md.indexOf(heading));
  assert.deepEqual([...order].sort((a, b) => a - b), order, "sections appear in numbered order");

  // Section 2 — the compact summary (identity + one-line KPI row, derived from data already passed).
  assert.match(
    md,
    /- Run: run-1 · status completed · outcome completed · stop reason model_stop/,
    "summary identity line",
  );
  assert.match(md, /- Test: List files test/, "summary test name");
  assert.match(
    md,
    /- Scenario: Baseline scenario · model claude-sonnet-4 \(context limit 200000 tokens\)/,
    "summary scenario + model",
  );
  assert.match(
    md,
    /- Started: 2026-06-20T00:00:00\.000Z · duration 4\.2s/,
    "summary started + duration",
  );
  assert.match(
    md,
    /- KPIs: turns 1 · tool calls 1 · tokens in 137 · tokens out 23 · est\. cost \$0\.0123/,
    "summary one-line KPI row",
  );

  // Section 4 — lifecycle + derived Finished + verbatim test/scenario config.
  assert.match(md, /- Run ID: run-1/, "run id");
  assert.match(md, /- Mode: automated/, "mode");
  assert.match(md, /- Status: completed/, "status");
  assert.match(md, /- Outcome: completed/, "outcome");
  assert.match(md, /- Stop reason: model_stop/, "stop reason from the terminal status event");
  assert.match(md, /- Started: 2026-06-20T00:00:00\.000Z/, "started");
  assert.match(md, /- Finished: 2026-06-20T00:00:04\.200Z/, "finished = started + durationMs");
  assert.match(md, /- Duration: 4\.2s/, "duration");
  assert.match(md, /Use the tools, then answer\./, "verbatim user prompt (fenced)");
  assert.match(md, /Override: be terse\./, "system prompt override rendered");
  assert.match(md, /screenshot\.png/, "attachment name in the attachments table");
  assert.match(md, /claude-sonnet-4 \(context limit 200000 tokens\)/, "model + context limit");
  assert.match(md, /generic_o200k, generic_cl100k/, "effective profiles unioned");
  assert.match(md, /maxTurns 10/, "guardrails: present value");
  assert.match(md, /maxToolCalls —/, "guardrails: absent value shown as em-dash");
  assert.match(md, /srv: alpha, beta/, "allowed servers + per-server allowed tools");

  // Section 3 — statistics + peak segment breakdown.
  assert.match(md, /- Turns: 1/, "turns total");
  assert.match(md, /- Tool calls: 1/, "tool-calls total");
  assert.match(md, /- Cached tokens: 11/, "cached tokens");
  assert.match(
    md,
    /- Peak context: 10\.0% \(20000 \/ 200000 tokens\)/,
    "peak context % vs model limit",
  );
  assert.match(md, /- End-state context: 20000 tokens/, "end-state context");
  assert.match(md, /- Estimated cost: \$0\.0123 \(estimated\)/, "cost labelled estimated");
  assert.match(md, /\| history \| 300 \|/, "peak segment breakdown row");

  // Section 5 — per-step sub-blocks (not one flat table), grouped by turn, with content.
  assert.match(md, /^### Turn 1/m, "turn boundary heading");
  assert.match(md, /^#### Step 1 — user_message · user · ok/m, "user step sub-block heading");
  assert.match(
    md,
    /^#### Step 2 — tool_call · alpha · ok · 0\.1s/m,
    "tool-call step sub-block heading",
  );
  assert.match(
    md,
    /^#### Step 4 — llm_response · claude-sonnet-4 · ok · 0\.8s/m,
    "llm step sub-block heading",
  );
  assert.match(md, /- Stats: tok↑ 137, tok↓ 23, cached 11, reasoning 7/, "per-step stats line");
  assert.match(
    md,
    /- Context window: 20000 \/ 200000 tokens \(cumulative 20000\)/,
    "per-step context window",
  );
  assert.match(
    md,
    /- Cumulative KPIs: turns 1, toolCalls 1, tokensIn 137, tokensOut 23, cost \$0\.0123/,
    "per-step cumulative KPIs incl. cost",
  );
  assert.match(
    md,
    /Found 2 files: a\.txt and b\.txt\./,
    "assistant prose rendered (now persisted)",
  );
  assert.match(md, /I should list the directory first\./, "assistant reasoning rendered");
  assert.match(md, /"path": "\/tmp"/, "tool args rendered (redacted JSON)");
  assert.match(md, /"files"/, "tool result rendered (redacted JSON)");
});

test("createRunMarkdownReport dumps only the redacted prose/payload fields, never the whole payload blob", () => {
  const md = createRunMarkdownReport(fixtureRun(), {
    test: fixtureTest(),
    scenario: fixtureScenario(),
  });
  // The report renders only the bounded args/result + the redacted assistant prose — it must NOT dump
  // the llm step's full opaque payload, which (in the fixture) also holds an apiKey sentinel.
  assert.ok(!md.includes(PAYLOAD_SECRET), "the llm step's opaque-payload secret never appears");
  assert.ok(!md.includes("apiKey"), "no opaque-payload field names leak into the report");
});

test("createRunMarkdownReport guards an unknown model limit (shows raw peak tokens)", () => {
  const scenario = { ...fixtureScenario(), model: "some-unmapped-model" };
  const md = createRunMarkdownReport(fixtureRun(), { test: fixtureTest(), scenario });
  assert.match(
    md,
    /- Peak context: 20000 tokens \(limit unknown\)/,
    "unknown limit ⇒ raw tokens, no divide-by-zero",
  );
  assert.match(
    md,
    /claude.*unknown|some-unmapped-model \(context limit unknown\)/,
    "header notes unknown limit",
  );
});

test("createRunMarkdownReport handles a run with no steps gracefully", () => {
  const run = { ...fixtureRun(), steps: [], events: [] };
  const md = createRunMarkdownReport(run, { test: fixtureTest(), scenario: fixtureScenario() });
  assert.match(md, /^## 5\. Steps/m, "Steps section still present");
  assert.match(md, /No steps recorded for this run/, "empty-state line for a stepless run");
});

// ── Auto-Rating WP 1.5 — the OPTIONAL/ADDITIVE `rating` block on both builders ────────────────────

function fixtureRating(): RunReport {
  return {
    runId: "run-1",
    status: "completed",
    outcome: "completed",
    baseRating: {
      answerValidation: {
        verdict: "answered",
        score: 0.9,
        quotes: ["Found 2 files"],
        citedSteps: [3],
      },
      insightSurplus: {
        verdict: "noise",
        score: 0.2,
        quotes: ["extra filler"],
        citedSteps: [3],
        surplusTokens: 12,
      },
      errorForensics: [
        {
          id: "f1",
          description: "the alpha tool call was slow",
          category: "failed_tool_call",
          bucket: "mcp_server",
          fixTarget: "mcp_server",
          draftFix: "server: cap `alpha`'s latency or paginate its result",
          evidenceSteps: [1],
          evidenceEventIds: [],
        },
      ],
    },
    expectationGrades: [
      {
        id: "g1",
        runId: "run-1",
        graderId: "rouge1",
        kind: "deterministic",
        status: "graded",
        score: 0.75,
        rawScore: 0.75,
        method: "rouge1_unigram_f1",
        reasoning: null,
        evidence: null,
        judgeProviderId: null,
        judgeModel: null,
        judgeTokensIn: 0,
        judgeTokensOut: 0,
        judgeCostUsd: 0,
        gradingVersion: 1,
        createdAt: "2026-06-20T00:00:01.000Z",
      },
    ],
    assertionResults: [
      { assertion: { kind: "noFractures" }, status: "pass", reason: "no fractures observed" },
    ],
    kpis: {
      turns: 1,
      toolCalls: 1,
      peakContextTokens: 20000,
      tokensIn: 137,
      tokensOut: 23,
      costUsd: 0.0123,
      durationMs: 4200,
    },
    judgeProvenance: { judgeProviderId: "claude_cli", judgeModel: "claude-sonnet-4-5" },
    ratingVersion: AUTO_RATING_VERSION,
    generatedAt: "2026-06-20T00:00:05.000Z",
  };
}

test("createRunJsonReport: omitting `rating` leaves no `rating` key (never a null placeholder)", () => {
  const report = createRunJsonReport(fixtureRun(), {
    test: fixtureTest(),
    scenario: fixtureScenario(),
  });
  assert.ok(!("rating" in report), "no rating key when the caller doesn't pass one");
});

test("createRunJsonReport: passing `rating` embeds the composed RunReport verbatim, right after generatedAt", () => {
  const rating = fixtureRating();
  const report = createRunJsonReport(
    fixtureRun(),
    { test: fixtureTest(), scenario: fixtureScenario() },
    rating,
  );
  assert.deepEqual((report as { rating: RunReport }).rating, rating);
  // Insights-first key order: the rating leads (after generatedAt), the raw run dump comes last.
  assert.deepEqual(
    Object.keys(report),
    ["generatedAt", "rating", "test", "scenario", "statistics", "stepKpis", "run"],
    "rating is inserted right after generatedAt",
  );
  // Existing fields are unchanged.
  assert.equal(report.run.id, "run-1");
  assert.equal(report.statistics.turns, 1);
});

test("createRunMarkdownReport: omitting `rating` still renders section 1 with an honest one-liner", () => {
  const md = createRunMarkdownReport(fixtureRun(), {
    test: fixtureTest(),
    scenario: fixtureScenario(),
  });
  assert.match(
    md,
    /^## 1\. Rating & verdict/m,
    "the section always renders (stakeholder completeness)",
  );
  assert.match(md, /_No rating available for this run\._/, "honest no-rating one-liner");
  assert.ok(!/### Base rating/.test(md), "no base-rating content when no rating was passed");
});

test("createRunMarkdownReport: passing `rating` renders a readable Rating & verdict section first", () => {
  const md = createRunMarkdownReport(
    fixtureRun(),
    { test: fixtureTest(), scenario: fixtureScenario() },
    fixtureRating(),
  );
  assert.match(md, /^## 1\. Rating & verdict/m, "Rating & verdict section heading");
  assert.ok(
    !/_No rating available for this run\._/.test(md),
    "no placeholder when a rating was passed",
  );
  assert.match(
    md,
    /Answer validation: verdict \*\*answered\*\*, score 0\.90/,
    "base rating: answer validation",
  );
  assert.match(
    md,
    /Insight surplus: verdict \*\*noise\*\*, score 0\.20 \(surplus 12 tokens\)/,
    "base rating: insight surplus names the surplus token cost",
  );
  assert.match(md, /mcp_server/, "error forensics finding's bucket/fixTarget rendered");
  assert.match(md, /cap `alpha`'s latency/, "error forensics finding's draft fix rendered");
  assert.match(
    md,
    /\| rouge1 \| graded \| 0\.75 \| rouge1_unigram_f1 \|/,
    "expectation grades table row",
  );
  assert.match(
    md,
    /\| noFractures \| pass \| no fractures observed \|/,
    "assertion results table row",
  );
  assert.match(md, /Judge: claude_cli \(claude-sonnet-4-5\)/, "judge provenance rendered");
  assert.match(md, new RegExp(`Rating version: ${AUTO_RATING_VERSION}`), "rating version stamped");
});

// ── Claude subscription (WP 3.2, D-CS4/D-CS8) — costBasis marker + accuracy footnote ─────────────────
// A `claude_subscription` run's `costUsd` is a shadow reference (exact tokens × Anthropic list price,
// marginal cost $0), not a billed charge. `RunDetail` already carries `costBasis` (RunSummary, WP 3.1);
// these tests prove the report builders surface it — JSON gets a machine-readable `statistics.costBasis`
// marker, Markdown gets an accuracy footnote — and that an ordinary (`api_exact`/absent) run's report
// stays byte-identical (no key, no footnote).

function fixtureSubscriptionRun(): RunDetail {
  return { ...fixtureRun(), costBasis: "subscription_reference" };
}

test("createRunJsonReport: a subscription run's statistics carry costBasis 'subscription_reference'", () => {
  const report = createRunJsonReport(fixtureSubscriptionRun(), {
    test: fixtureTest(),
    scenario: fixtureScenario(),
  });
  assert.equal(
    report.statistics.costBasis,
    "subscription_reference",
    "statistics.costBasis flags the shadow-price cost",
  );
});

test("createRunJsonReport: an ordinary run's statistics carry no costBasis key (unchanged)", () => {
  const report = createRunJsonReport(fixtureRun(), {
    test: fixtureTest(),
    scenario: fixtureScenario(),
  });
  assert.ok(
    !("costBasis" in report.statistics),
    "no costBasis key for an api_exact/absent run — report stays byte-identical",
  );
});

test("createRunMarkdownReport: a subscription run renders the accuracy footnote near the cost lines", () => {
  const md = createRunMarkdownReport(fixtureSubscriptionRun(), {
    test: fixtureTest(),
    scenario: fixtureScenario(),
  });
  assert.match(
    md,
    /- Estimated cost: \$0\.0123 \(estimated\) · subscription reference/,
    "statistics cost line flags subscription reference",
  );
  assert.match(
    md,
    /est\. cost \$0\.0123 \(subscription reference — see §3\)/,
    "summary KPI line points to the §3 footnote",
  );
  assert.match(
    md,
    /> \*\*Cost note — subscription reference\.\*\* This run executed on the Claude subscription/,
    "the full accuracy footnote renders",
  );
  assert.match(md, /a REFERENCE ESTIMATE/, "footnote states the cost is a reference estimate");
  assert.match(md, /marginal cost was \$0/, "footnote states marginal cost is $0, not a charge");
  assert.match(md, /Token counts are provider-exact/, "footnote states token counts are exact");
  assert.match(
    md,
    /per-tool\/skill metering and context-window granularity are estimates/,
    "footnote states per-tool/skill metering + context granularity are estimates",
  );
  assert.match(
    md,
    /Logprob-weighted outcome judging is unavailable for this run/,
    "footnote states logprob-weighted judging is unavailable (single-sample fallback)",
  );
});

test("createRunMarkdownReport: an ordinary run renders no subscription marker or footnote", () => {
  const md = createRunMarkdownReport(fixtureRun(), {
    test: fixtureTest(),
    scenario: fixtureScenario(),
  });
  assert.ok(!md.includes("subscription reference"), "no subscription marker for an api_exact run");
  assert.ok(!md.includes("Cost note"), "no accuracy footnote for an api_exact run");
});

test("createRunMarkdownReport: a clean base rating (no findings, no expectation grades, no assertions) renders honest empty states", () => {
  const rating: RunReport = {
    ...fixtureRating(),
    baseRating: {
      answerValidation: { verdict: "unanswered", score: null, quotes: [], citedSteps: [] },
      insightSurplus: { verdict: "none", score: null, quotes: [], citedSteps: [] },
      errorForensics: [],
    },
    expectationGrades: [],
    assertionResults: [],
  };
  const md = createRunMarkdownReport(
    fixtureRun(),
    { test: fixtureTest(), scenario: fixtureScenario() },
    rating,
  );
  assert.match(md, /score n\/a/, "a null score renders as n\\/a, never a fabricated 0");
  assert.match(md, /No findings \(operationally clean\)\./, "empty-state for error forensics");
  assert.match(
    md,
    /No expectation graders ran for this run\./,
    "empty-state for expectation grades",
  );
  assert.match(md, /No assertions declared for this run's test\./, "empty-state for assertions");
});
