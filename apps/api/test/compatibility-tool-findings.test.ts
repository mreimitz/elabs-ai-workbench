import assert from "node:assert/strict";
import { test } from "node:test";
import type { CompatibilitySeverity, ScanDetail, ToolScan } from "@mcp-token-footprint/shared";
import { buildServerTestReport, buildToolFindings } from "../src/compatibility/service.js";

// Same fixtures style as compatibility-test-report.test.ts. `tool()` makes a *minimal* tool that is
// otherwise fine but, by design, leaves the design-quality heuristics (naming/description/pagination/
// output-format/annotations) free to fire — so callers control severity by name/tokens/schema.
function tool(name: string, totalTokens: number, over: Partial<ToolScan> = {}): ToolScan {
  return {
    id: `t_${name}`,
    scanId: "scan_1",
    toolName: name,
    description: "Does a thing.",
    inputSchema: { type: "object", properties: { q: { type: "string" } } },
    annotations: undefined,
    rawTool: {},
    contributionPercent: 0,
    totalTokens,
    nameTokens: 2,
    descriptionTokens: 8,
    schemaTokens: Math.max(0, totalTokens - 10),
    annotationsTokens: 0,
    rawBytes: totalTokens * 4,
    ...over,
  };
}

// A tool that passes every tool-level test the engine evaluates through buildToolFindings: snake_case
// verb name, a substantial description with a usage cue, coherent annotations (now forwarded by
// toToolInput), a pagination control (`limit`) and an output-shaping control (`fields`) → no findings
// at all (floor is total 0).
function cleanTool(name = "search_documents", totalTokens = 300): ToolScan {
  return {
    id: `t_${name}`,
    scanId: "scan_1",
    toolName: name,
    description:
      "Search the document index for matching records. Use this when you need to find documents by " +
      "keyword; returns a ranked list of results.",
    inputSchema: {
      type: "object",
      properties: {
        q: { type: "string" },
        limit: { type: "number" },
        fields: { type: "array", items: { type: "string" } },
      },
    },
    annotations: { readOnlyHint: true },
    rawTool: {},
    contributionPercent: 0,
    totalTokens,
    nameTokens: 2,
    descriptionTokens: 25,
    schemaTokens: 50,
    annotationsTokens: 5,
    rawBytes: totalTokens * 4,
  };
}

function makeScan(tools: ToolScan[], serverName = "Demo Server"): ScanDetail {
  const totalTokens = tools.reduce((a, t) => a + t.totalTokens, 0);
  return {
    id: "scan_1",
    serverId: "srv_1",
    serverName,
    tokenProfile: "generic_o200k",
    scannedAt: new Date(0).toISOString(),
    status: "success",
    totalTools: tools.length,
    totalTokens,
    totalRawBytes: totalTokens * 4,
    averageTokensPerTool: tools.length ? totalTokens / tools.length : 0,
    largestToolTokens: tools.reduce((m, t) => Math.max(m, t.totalTokens), 0),
    tools,
    events: [],
  };
}

// Models with a documented tool-name cap (OpenAI/Anthropic = 64) so TOOL_NAME_LENGTH and the
// namespaced-length check produce real `over: true` offenders; phi-4 has no cap (na for those).
const MODELS = ["gpt-5.5", "claude-opus-4-8", "microsoft/phi-4"];
const SEVERITY_WEIGHT: Record<CompatibilitySeverity, number> = {
  blocker: 4,
  high: 3,
  medium: 2,
  low: 1,
};

// A name long enough that even WITHOUT the namespace prefix it blows the 64-char tool-name cap.
const LONG_NAME = `search_${"x".repeat(70)}`; // 77 chars

test("buildToolFindings: one byTool entry per tool, counts sum to total", () => {
  const report = buildToolFindings(
    makeScan([tool("search", 300), tool("fetch", 200), tool("read", 150)]),
    MODELS,
  );

  assert.equal(report.scanId, "scan_1");
  assert.equal(report.models.length, 3, "one report model per known requested model");
  assert.equal(report.byTool.length, 3, "exactly one byTool entry per tool");
  assert.deepEqual(
    report.byTool.map((b) => b.toolName),
    ["search", "fetch", "read"],
    "byTool preserves scan tool order",
  );

  for (const b of report.byTool) {
    const sum = Object.values(b.counts).reduce((a, n) => a + (n ?? 0), 0);
    assert.equal(sum, b.total, `${b.toolName}: counts must sum to total`);
    // counts are keyed only by real severities (pass/na are excluded from findings).
    for (const key of Object.keys(b.counts)) {
      assert.ok(
        ["blocker", "high", "medium", "low"].includes(key),
        `${b.toolName}: unexpected count key ${key}`,
      );
    }
  }
});

test("buildToolFindings: a content-clean, annotated tool produces no findings", () => {
  const report = buildToolFindings(makeScan([cleanTool()]), MODELS);
  const entry = report.byTool[0];
  assert.ok(entry, "byTool entry present");
  assert.equal(entry.toolName, "search_documents");

  // A well-formed, annotated tool passes every tool-level test → no findings at all (now that
  // annotations are forwarded and an absent-annotations tool is treated as coherent).
  assert.deepEqual(entry.counts, {}, "a clean tool has no findings");
  assert.equal(entry.total, 0);
  assert.equal(report.byTest.length, 0, "no tool-level test has an offender for a clean tool");
});

test("buildToolFindings: a >64-char tool name surfaces as a TOOL_NAME_LENGTH blocker in byTool and byTest", () => {
  const report = buildToolFindings(makeScan([cleanTool(), tool(LONG_NAME, 300)]), MODELS);

  // --- byTool: the offending tool carries the blocker; the clean tool does not. ---
  const offender = report.byTool.find((b) => b.toolName === LONG_NAME);
  const clean = report.byTool.find((b) => b.toolName === "search_documents");
  assert.ok(offender, "offending tool present in byTool");
  assert.ok(clean, "clean tool present in byTool");
  assert.equal(offender.counts.blocker, 1, "long-name tool has exactly one blocker finding");
  assert.ok(!clean.counts.blocker, "clean tool has no blocker");
  assert.equal(
    offender.total,
    Object.values(offender.counts).reduce((a, n) => a + (n ?? 0), 0),
    "counts sum to total",
  );

  // --- byTest: TOOL_NAME_LENGTH entry lists the offender at blocker severity, and only it. ---
  const nameLen = report.byTest.find((e) => e.testId === "TOOL_NAME_LENGTH");
  assert.ok(nameLen, "TOOL_NAME_LENGTH appears in byTest (it has an offender)");
  assert.equal(nameLen.worstSeverity, "blocker");
  assert.equal(nameLen.tools.length, 1, "only the long-named tool offends the name-length cap");
  assert.deepEqual(nameLen.tools[0], { toolName: LONG_NAME, severity: "blocker" });
  // The catalog metadata is carried through onto the entry.
  assert.equal(nameLen.techName, "tool.name.length");
  assert.equal(nameLen.userFacingName, "Tool name length");
  assert.ok(nameLen.recommendation.length > 0, "recommendation copied from the catalog");

  // --- byTest is sorted worst-severity first. ---
  for (let i = 1; i < report.byTest.length; i++) {
    const prev = SEVERITY_WEIGHT[report.byTest[i - 1]!.worstSeverity];
    const cur = SEVERITY_WEIGHT[report.byTest[i]!.worstSeverity];
    assert.ok(prev >= cur, "byTest entries are ordered worst-severity first");
  }
  // A blocker test must sort ahead of a low-severity design finding (the long-named tool also trips
  // low-severity design checks like description quality, since `tool()` has a terse description).
  const idxBlocker = report.byTest.findIndex((e) => e.testId === "TOOL_NAME_LENGTH");
  const idxLow = report.byTest.findIndex((e) => e.testId === "TOOL_DESCRIPTION_QUALITY");
  assert.notEqual(idxLow, -1, "a low-severity design finding is present");
  assert.ok(
    idxBlocker >= 0 && idxBlocker < idxLow,
    "the blocker test sorts before the low-severity test",
  );
});

test("buildToolFindings: each byTest entry's tools are sorted worst-severity first", () => {
  // Two heavy tools both trip TOOL_DEFINITION_TOKENS. Worst-across-models severity is driven by phi-4
  // (small window → it resolves this test to `blocker`), so both land at blocker here; the assertion
  // is on the ordering invariant + the worst-tool/worstSeverity tie, which must hold regardless.
  const report = buildToolFindings(
    makeScan([tool("heavy_one", 5000), tool("heavy_two", 2500)]),
    MODELS,
  );
  const defTokens = report.byTest.find((e) => e.testId === "TOOL_DEFINITION_TOKENS");
  assert.ok(defTokens, "TOOL_DEFINITION_TOKENS present");
  assert.ok(defTokens.tools.length >= 2, "both heavy tools are offenders");
  for (let i = 1; i < defTokens.tools.length; i++) {
    const prev = SEVERITY_WEIGHT[defTokens.tools[i - 1]!.severity];
    const cur = SEVERITY_WEIGHT[defTokens.tools[i]!.severity];
    assert.ok(prev >= cur, "offending tools within an entry are worst-first");
  }
  assert.equal(
    defTokens.worstSeverity,
    defTokens.tools[0]!.severity,
    "worstSeverity matches the first (worst) tool",
  );
});

test("buildToolFindings: phi-4 alone (no tool-name cap) does not produce a TOOL_NAME_LENGTH finding", () => {
  // The long name is a hard blocker on capped models but `na` where no cap is documented.
  const capped = buildToolFindings(makeScan([tool(LONG_NAME, 300)]), ["gpt-5.5"]);
  const uncapped = buildToolFindings(makeScan([tool(LONG_NAME, 300)]), ["microsoft/phi-4"]);
  assert.ok(
    capped.byTest.some((e) => e.testId === "TOOL_NAME_LENGTH"),
    "capped model flags the long name",
  );
  assert.ok(
    !uncapped.byTest.some((e) => e.testId === "TOOL_NAME_LENGTH"),
    "uncapped model has no name-length finding",
  );
});

test("SERVER_NAMESPACED_NAME_LENGTH carries affectedTools with over:true for offenders on a capped model", () => {
  // serverName "Demo Server" → prefix "mcp__demo_server__" (18 chars). A 77-char tool name pushes the
  // namespaced length to 95 > 64 on Anthropic/OpenAI; a short tool name stays well under.
  const scan = makeScan([tool("fetch", 200), tool(LONG_NAME, 400)]);
  const report = buildServerTestReport(scan, ["claude-opus-4-8"]);
  const entry = report.entries.find((e) => e.testId === "SERVER_NAMESPACED_NAME_LENGTH");
  assert.ok(entry, "namespaced-name-length test present");

  const result = entry.results.find((r) => r.modelId === "claude-opus-4-8");
  assert.ok(result, "result for the capped model present");
  assert.equal(result.verdict, "fail", "the namespaced length exceeds the 64-char cap → fail");
  assert.equal(result.threshold.value, 64, "Anthropic tool-name cap is 64");

  const affected = result.affectedTools;
  assert.ok(affected && affected.length > 0, "affectedTools attached");
  // Only the long tool is over the cap; the short one is not listed.
  assert.equal(affected.length, 1, "only the offending tool is listed");
  assert.equal(affected[0]?.toolName, LONG_NAME);
  assert.equal(affected[0]?.over, true, "the long tool is a genuine over-cap offender");
  assert.equal(affected[0]?.unit, "chars");
  // value = prefix(18) + name length(77) = 95.
  assert.equal(affected[0]?.value, 95, "namespaced length = prefix + tool name");
  assert.ok(
    affected.every((a, i) => i === 0 || a.value <= affected[i - 1]!.value),
    "affectedTools are sorted worst (longest) first",
  );
});

test("SERVER_NAMESPACED_NAME_LENGTH: a model with no documented cap still falls back to 64", () => {
  // phi-4 has no max_tool_name_len → the runner falls back to a 64 cap (it does not go na), so a 95-char
  // namespaced name is still flagged. Asserting the documented fallback behaviour.
  const scan = makeScan([tool(LONG_NAME, 400)]);
  const entry = buildServerTestReport(scan, ["microsoft/phi-4"]).entries.find(
    (e) => e.testId === "SERVER_NAMESPACED_NAME_LENGTH",
  );
  assert.ok(entry, "test present");
  const result = entry.results[0];
  assert.ok(result, "phi-4 result present");
  assert.equal(result.threshold.value, 64, "fallback cap is 64 when undocumented");
  assert.equal(result.verdict, "fail");
  assert.ok(
    result.affectedTools?.some((a) => a.toolName === LONG_NAME && a.over),
    "long tool flagged over the fallback cap",
  );
});

test("SERVER_DEFINITION_FOOTPRINT carries affectedTools ranked by tokens, all as contributors (over:false)", () => {
  // Mixed token sizes so ranking is observable.
  const scan = makeScan([
    tool("heavy", 5000),
    tool("fetch", 1500),
    tool("mid", 700),
    tool("small", 300),
  ]);
  const entry = buildServerTestReport(scan, ["microsoft/phi-4"]).entries.find(
    (e) => e.testId === "SERVER_DEFINITION_FOOTPRINT",
  );
  assert.ok(entry, "footprint test present");
  const result = entry.results[0];
  assert.ok(result, "footprint result present");

  const affected = result.affectedTools;
  assert.ok(affected && affected.length > 0, "affectedTools attached to the aggregate footprint");
  // Ranked by tokens, descending.
  assert.deepEqual(
    affected.map((a) => a.toolName),
    ["heavy", "fetch", "mid", "small"],
    "ranked by totalTokens desc",
  );
  for (let i = 1; i < affected.length; i++) {
    assert.ok(
      affected[i - 1]!.value >= affected[i]!.value,
      "tokens are monotonically non-increasing",
    );
  }
  // These are the biggest CONTRIBUTORS to an aggregate footprint, not tools past a per-tool cap, so
  // none is an "offender" — over is always false (the UI then labels them "Top contributors").
  assert.deepEqual(
    affected.map((a) => a.over),
    [false, false, false, false],
    "footprint contributors are never flagged 'over the limit'",
  );
  assert.ok(
    affected.every((a) => a.unit === "tokens"),
    "footprint contributions are measured in tokens",
  );
});

test("SERVER_DEFINITION_FOOTPRINT caps the affectedTools list at the top 8 contributors", () => {
  const many = Array.from({ length: 12 }, (_, i) => tool(`tool_${i}`, (i + 1) * 100));
  const entry = buildServerTestReport(makeScan(many), ["microsoft/phi-4"]).entries.find(
    (e) => e.testId === "SERVER_DEFINITION_FOOTPRINT",
  );
  const affected = entry?.results[0]?.affectedTools;
  assert.ok(affected, "affectedTools present");
  assert.equal(affected.length, 8, "only the top 8 contributors are listed");
  // The largest tool (tool_11 = 1200 tokens) leads.
  assert.equal(affected[0]?.toolName, "tool_11");
  assert.equal(affected[0]?.value, 1200);
});
