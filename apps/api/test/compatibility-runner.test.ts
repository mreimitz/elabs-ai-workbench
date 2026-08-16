import assert from "node:assert/strict";
import { test } from "node:test";
import { bandForScore } from "@mcp-token-footprint/shared";
import {
  runServerLevel,
  runToolLevel,
  scoreCell,
  type ScanInput,
  type ToolInput,
} from "../src/compatibility/runner.js";

function scan(over: Partial<ScanInput> = {}): ScanInput {
  return {
    scanId: "scan_1",
    serverName: "Demo Server",
    totalTools: 10,
    totalTokens: 5_000,
    totalRawBytes: 20_000,
    tools: [],
    ...over,
  };
}

const find = (results: { testId: string }[], id: string) => results.find((r) => r.testId === id);

test("hard tool-count cap: 200 tools fails on a capped model, na on an uncapped one", () => {
  const s = scan({ totalTools: 200 });
  const gpt = find(runServerLevel(s, "gpt-5.5"), "SERVER_TOOL_COUNT_HARD");
  assert.equal(gpt?.verdict, "fail");
  assert.equal(gpt?.severity, "blocker");
  assert.equal(gpt?.measured.value, 200);
  assert.equal(gpt?.threshold.value, 128);

  const claude = find(runServerLevel(s, "claude-opus-4-8"), "SERVER_TOOL_COUNT_HARD");
  assert.equal(claude?.verdict, "na", "Anthropic has no per-request hard cap → na");
});

test("aggregate cap binds Anthropic via the 10k catalog ceiling (the real gate)", () => {
  const big = scan({ totalTools: 12_000 });
  const env = find(runServerLevel(big, "claude-opus-4-8"), "ENV_AGGREGATE_TOOL_COUNT");
  assert.equal(env?.verdict, "fail");
  assert.equal(env?.threshold.value, 10_000);
});

test("definition footprint scales with the window: same server red on Phi-4, green on a 1M model", () => {
  const s = scan({ totalTokens: 10_000 });
  const phi = find(runServerLevel(s, "microsoft/phi-4"), "SERVER_DEFINITION_FOOTPRINT");
  assert.equal(phi?.verdict, "fail", "10k tokens is >50% of Phi-4's 16,384 window");
  assert.equal(phi?.severity, "blocker", "small-window footprint resolves to blocker");

  const gpt = find(runServerLevel(s, "gpt-5.5"), "SERVER_DEFINITION_FOOTPRINT");
  assert.equal(gpt?.verdict, "pass", "10k tokens is a rounding error in a 1.05M window");
});

test("duplicate tool names fail (blocker)", () => {
  const s = scan({
    totalTools: 2,
    tools: [
      { toolName: "search", descriptionTokens: 5, totalTokens: 50 },
      { toolName: "search", descriptionTokens: 5, totalTokens: 50 },
    ],
  });
  const dup = find(runServerLevel(s, "gpt-5.5"), "SERVER_TOOL_NAME_DUPLICATE");
  assert.equal(dup?.verdict, "fail");
  assert.equal(dup?.measured.value, 1);
});

test("tool-level: name length + pattern + schema property count", () => {
  const longName: ToolInput = {
    toolName: "x".repeat(70),
    descriptionTokens: 10,
    totalTokens: 100,
    description: "ok",
    inputSchema: { type: "object", properties: { a: { type: "string" } } },
  };
  const tl = runToolLevel(longName, "gpt-5.5");
  assert.equal(tl.length, 16, "16 tool-level static tests (11 limits + 5 design-quality)");
  assert.equal(find(tl, "TOOL_NAME_LENGTH")?.verdict, "fail", "70 > 64-char cap");
  assert.equal(find(tl, "TOOL_DESCRIPTION_PRESENT")?.verdict, "pass");

  const badName: ToolInput = {
    toolName: "has spaces.and.dots",
    descriptionTokens: 1,
    totalTokens: 20,
  };
  assert.equal(find(runToolLevel(badName, "gpt-5.5"), "TOOL_NAME_PATTERN")?.verdict, "fail");

  // OpenAI strict-mode property cap applies on OpenAI; na on a non-strict provider (Anthropic).
  const props: Record<string, unknown> = {};
  for (let i = 0; i < 120; i++) props[`p${i}`] = { type: "string" };
  const fat: ToolInput = {
    toolName: "fat_tool",
    descriptionTokens: 1,
    totalTokens: 50,
    inputSchema: { type: "object", properties: props },
  };
  assert.equal(
    find(runToolLevel(fat, "gpt-5.5"), "TOOL_SCHEMA_PROPERTY_COUNT")?.verdict,
    "fail",
    "120 > 100 strict cap",
  );
  assert.equal(
    find(runToolLevel(fat, "claude-opus-4-8"), "TOOL_SCHEMA_PROPERTY_COUNT")?.verdict,
    "na",
    "Anthropic is not strict-mode",
  );
});

test("cell scoring: a blocker fail gates the cell to red regardless of score", () => {
  const s = scan({ totalTools: 200, totalTokens: 10_000 });
  const results = runServerLevel(s, "microsoft/phi-4");
  const cell = scoreCell("microsoft/phi-4", results);
  assert.equal(cell.band, "red");
  assert.ok(results.some((r) => r.verdict === "fail" && r.severity === "blocker"));

  // A clean small server on a 1M model → green.
  const clean = runServerLevel(scan({ totalTools: 5, totalTokens: 3_000 }), "gpt-5.5");
  assert.equal(scoreCell("gpt-5.5", clean).band, "green");
});

test("T6 absence of evidence: a null-score cell is `untested`, never green", () => {
  // No applicable (non-na) result scored the cell → score null. This must read as `untested` (a gap
  // in coverage), NOT green — the two used to be indistinguishable (both green with a `—`).
  const empty = scoreCell("gpt-5.5", []);
  assert.equal(empty.score, null);
  assert.equal(empty.band, "untested", "a cell nothing scored is untested, not green");

  // The pure shared mapping is the single source of truth the runner + web guardrail both consume.
  assert.equal(bandForScore(null, { blockerFail: false, anyWarn: false }), "untested");
  // A blocker fail still gates to red (blocker gate precedes the null → untested check).
  assert.equal(bandForScore(null, { blockerFail: true, anyWarn: false }), "red");
  // Positive evidence keeps its bands.
  assert.equal(bandForScore(95, { blockerFail: false, anyWarn: false }), "green");
  assert.equal(bandForScore(50, { blockerFail: false, anyWarn: false }), "red");
  assert.equal(bandForScore(75, { blockerFail: false, anyWarn: false }), "amber");
});

test("#5 band ladder: a sub-60 score stays red even with an unrelated warn (catalog red = score < 60)", () => {
  const mk = (verdict: "pass" | "warn" | "fail", severity: "blocker" | "high" | "medium" | "low") =>
    ({
      testId: "t",
      techName: "t",
      userFacingName: "t",
      level: "tool",
      subjectType: "tool",
      subjectId: "x",
      modelId: "m",
      verdict,
      severity,
      failureMode: "none",
      measured: { value: null },
      threshold: { value: null },
      message: "",
      recommendation: "",
      rationale: "",
      evidence: [],
    }) as ReturnType<typeof runToolLevel>[number];
  // score = 0.7 (one high fail) / (0.7 + 0.2) ≈ 11 → red, and the low warn must NOT lift it to amber.
  const cell = scoreCell("m", [mk("fail", "high"), mk("warn", "low")]);
  assert.ok(cell.score !== null && cell.score < 60);
  assert.equal(cell.band, "red");
});

test("#1/#4 M365's hard aggregate tool cap scores (blocker → red), not silently na", () => {
  // microsoft-365-copilot has no documented context window; its binding limit is max_total_tools=10.
  const env = find(
    runServerLevel(scan({ totalTools: 50, totalTokens: 2_500 }), "microsoft-365-copilot"),
    "ENV_AGGREGATE_TOOL_COUNT",
  );
  assert.equal(env?.verdict, "fail");
  assert.equal(
    env?.severity,
    "blocker",
    "window-independent cap must not be na-gated for a windowless model",
  );
  assert.equal(
    scoreCell(
      "microsoft-365-copilot",
      runServerLevel(scan({ totalTools: 50, totalTokens: 2_500 }), "microsoft-365-copilot"),
    ).band,
    "red",
  );
});

test("#7/#13 M365 SERVER_REQUEST_SIZE compares the token footprint against the 4,096-token plugin budget", () => {
  const over = find(
    runServerLevel(scan({ totalTokens: 5_000 }), "microsoft-365-copilot"),
    "SERVER_REQUEST_SIZE",
  );
  assert.equal(over?.verdict, "fail");
  assert.equal(over?.measured.unit, "tokens");
  assert.equal(over?.threshold.value, 4_096);
  const under = find(
    runServerLevel(scan({ totalTokens: 2_000 }), "microsoft-365-copilot"),
    "SERVER_REQUEST_SIZE",
  );
  assert.equal(under?.verdict, "pass");
});

test("#14 TOOL_DEFINITION_TOKENS: window-share fails on a small window, only warns on a large one", () => {
  const heavy: ToolInput = { toolName: "t", descriptionTokens: 10, totalTokens: 1_700 };
  assert.equal(
    find(runToolLevel(heavy, "microsoft/phi-4"), "TOOL_DEFINITION_TOKENS")?.verdict,
    "fail",
    "1,700/16,384 > 10% window",
  );
  assert.equal(
    find(runToolLevel(heavy, "gpt-5.5"), "TOOL_DEFINITION_TOKENS")?.verdict,
    "warn",
    ">1,000 absolute but a rounding error in a 1M window",
  );
});

test("#8 TOOL_SCHEMA_NESTING_DEPTH warns at exactly the cap (depth == 5)", () => {
  const nest = (d: number): unknown =>
    d <= 0 ? { type: "string" } : { type: "object", properties: { a: nest(d - 1) } };
  const atCap: ToolInput = {
    toolName: "t",
    descriptionTokens: 1,
    totalTokens: 10,
    inputSchema: nest(4),
  }; // top object = depth 1 → 5 levels
  const r = find(runToolLevel(atCap, "gpt-5.5"), "TOOL_SCHEMA_NESTING_DEPTH");
  assert.equal(r?.measured.value, 5);
  assert.equal(r?.verdict, "warn");
});

test("#6 SERVER_NAMESPACED_NAME_LENGTH carries the namespaced string so the count reconciles", () => {
  const s = scan({
    totalTools: 1,
    tools: [{ toolName: "x".repeat(60), descriptionTokens: 1, totalTokens: 10 }],
  });
  const offender = find(runServerLevel(s, "gpt-5.5"), "SERVER_NAMESPACED_NAME_LENGTH")
    ?.affectedTools?.[0];
  assert.ok(offender);
  assert.equal(
    offender.namespacedName?.length,
    offender.value,
    "namespacedName length equals the measured char count",
  );
  assert.ok(
    offender.namespacedName?.startsWith("mcp__"),
    "the namespaced form carries the host prefix",
  );
});
