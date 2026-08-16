import assert from "node:assert/strict";
import { test } from "node:test";
import type { CompatibilitySeverity } from "@mcp-token-footprint/shared";
import { getCatalog, getTest } from "../src/compatibility/catalog.js";
import { listModelIds } from "../src/compatibility/dataset.js";
import { resolveSeverity } from "../src/compatibility/resolve.js";

// --- Fixture parity with the Python reference resolve_model_severity.py demo output --------------
// Locks the TS port to the reference so rule-authoring stays validated against one implementation.

type Expect = {
  severity: CompatibilitySeverity | "na";
  rationale: string;
  evField?: string;
  evValue?: string | number | null;
  evConf?: string;
};

const FIXTURES: Record<string, Record<string, Expect>> = {
  SERVER_TOOL_COUNT_HARD: {
    "gemini-3.5-flash": {
      severity: "blocker",
      rationale: "Google Gemini's per-request cap is 512 tools;",
      evField: "tools_mcp.max_tools_hard",
      evValue: 512,
      evConf: "high",
    },
    "gpt-5.5": {
      severity: "blocker",
      rationale: "OpenAI (GPT)'s per-request cap is 128 tools;",
      evField: "tools_mcp.max_tools_hard",
      evValue: 128,
      evConf: "high",
    },
    "claude-opus-4-8": {
      severity: "na",
      rationale: "Anthropic has no fixed per-request tool-count cap,",
      evField: "tools_mcp.max_tools_hard",
      evValue: null,
      evConf: "medium",
    },
    "microsoft/phi-4": {
      severity: "na",
      rationale: "Microsoft Phi has no fixed per-request tool-count cap,",
      evField: "tools_mcp.max_tools_hard",
      evValue: null,
      evConf: "high",
    },
    "Qwen/Qwen3.6-27B": {
      severity: "na",
      rationale: "Alibaba (Qwen) has no fixed per-request tool-count cap,",
      evField: "tools_mcp.max_tools_hard",
      evValue: null,
      evConf: "medium",
    },
  },
  TOOL_SCHEMA_UNSUPPORTED_KEYWORDS: {
    "gemini-3.5-flash": {
      severity: "medium",
      rationale: "Gemini supports more keywords than OpenAI strict but still rejects",
      evField: "tools_mcp.tool_schema_limits_notes",
    },
    "gpt-5.5": {
      severity: "blocker",
      rationale: "OpenAI strict function schemas reject unsupported keywords (oneOf/$ref);",
      evField: "tools_mcp.tool_schema_limits_notes",
    },
    "claude-opus-4-8": {
      severity: "low",
      rationale: "Anthropic is permissive about schema keywords,",
      evField: "tools_mcp.tool_schema_limits_notes",
    },
    "microsoft/phi-4": { severity: "low", rationale: "(default — no rule matched)" },
    "Qwen/Qwen3.6-27B": { severity: "low", rationale: "(default — no rule matched)" },
  },
  SERVER_DEFINITION_FOOTPRINT: {
    "gemini-3.5-flash": {
      severity: "low",
      rationale: "Google Gemini's 1,048,576-token window absorbs typical footprints;",
      evField: "context.context_window_tokens",
      evValue: 1048576,
      evConf: "high",
    },
    "gpt-5.5": {
      severity: "low",
      rationale: "OpenAI (GPT)'s 1,050,000-token window absorbs typical footprints;",
      evField: "context.context_window_tokens",
      evValue: 1050000,
      evConf: "high",
    },
    "claude-opus-4-8": {
      severity: "low",
      rationale: "Anthropic's 1,000,000-token window absorbs typical footprints;",
      evField: "context.context_window_tokens",
      evValue: 1000000,
      evConf: "high",
    },
    "microsoft/phi-4": {
      severity: "blocker",
      rationale: "Microsoft Phi's 16,384-token window is small;",
      evField: "context.context_window_tokens",
      evValue: 16384,
      evConf: "high",
    },
    "Qwen/Qwen3.6-27B": {
      severity: "low",
      rationale: "Alibaba (Qwen)'s 262,144-token window absorbs typical footprints;",
      evField: "context.context_window_tokens",
      evValue: 262144,
      evConf: "high",
    },
  },
};

test("resolver reproduces the Python reference demo (severity + rationale + evidence)", () => {
  for (const [testId, perModel] of Object.entries(FIXTURES)) {
    const t = getTest(testId);
    assert.ok(t, `${testId} missing from catalog`);
    for (const [modelId, exp] of Object.entries(perModel)) {
      const r = resolveSeverity(t, modelId);
      assert.equal(r.severity, exp.severity, `${testId} / ${modelId} severity`);
      assert.ok(
        r.rationale.startsWith(exp.rationale),
        `${testId} / ${modelId} rationale:\n  expected start: ${exp.rationale}\n  got: ${r.rationale}`,
      );
      if (exp.evField) {
        const ev = r.evidence[0];
        assert.ok(ev, `${testId} / ${modelId} expected evidence`);
        assert.equal(ev.field, exp.evField, `${testId} / ${modelId} evidence field`);
        if (exp.evValue !== undefined)
          assert.equal(ev.value, exp.evValue, `${testId} / ${modelId} evidence value`);
        if (exp.evConf !== undefined)
          assert.equal(ev.confidence, exp.evConf, `${testId} / ${modelId} evidence confidence`);
      } else {
        assert.equal(
          r.evidence.length,
          0,
          `${testId} / ${modelId} expected no evidence (default branch)`,
        );
      }
    }
  }
});

// --- Catalog QA: full catalog × full roster resolves without crashing -----------------------------

test("every test resolves a valid severity for every model (39 × 33, no crash)", () => {
  const catalog = getCatalog();
  const models = listModelIds();
  const allowed = new Set<CompatibilitySeverity | "na">(["blocker", "high", "medium", "low", "na"]);
  assert.equal(catalog.tests.length, 39);
  assert.equal(models.length, 33);
  let resolved = 0;
  for (const t of catalog.tests) {
    for (const modelId of models) {
      const r = resolveSeverity(t, modelId);
      assert.ok(allowed.has(r.severity), `${t.id}/${modelId} bad severity ${r.severity}`);
      assert.equal(typeof r.rationale, "string");
      assert.ok(Array.isArray(r.evidence));
      resolved++;
    }
  }
  assert.equal(resolved, 39 * 33);
});

test("models with no documented context window resolve window tests to na (is_scorable gate)", () => {
  // Llama-4-Behemoth has weights unreleased → no context_window_tokens.value.
  const footprint = getTest("SERVER_DEFINITION_FOOTPRINT");
  assert.ok(footprint);
  const r = resolveSeverity(footprint, "meta-llama/Llama-4-Behemoth-288B-16E");
  assert.equal(r.severity, "na");
  assert.match(r.rationale, /insufficient data/);
});
