// Assistant Hub (planning/Roadmap/RM-03-assistant-hub/, WP0.5, §1.6) — the annotation-informed approval-policy CORE
// (R-MCP3), output-size warn/cap + spill (R-MCP7), and structured-output validation + the isError
// fold (R-MCP6).
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";
import { resolveApprovalPolicy } from "../src/hub/tools/approval-policy.js";
import { applyOutputCap } from "../src/hub/tools/output-caps.js";
import { foldMcpResultForModel, validateStructuredOutput } from "../src/hub/tools/structured-output.js";
import { getTokenCounter } from "../src/token-counting/profiles.js";
import { ensureHubWorkspaceRoot, readWorkspaceTextFile } from "../src/hub/workspace.js";

const tempDirs: string[] = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function tempWorkspace(): string {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "hub-policy-test-"));
  tempDirs.push(dataDir);
  return ensureHubWorkspaceRoot(dataDir, "sess-policy");
}

// ── Approval policy core (R-MCP3) ────────────────────────────────────────────────────────────────

test("built-in/skill/genui sources are always auto-eligible — no approval, no external side effect", () => {
  for (const source of ["builtin", "skill", "genui"] as const) {
    const decision = resolveApprovalPolicy({ source });
    assert.equal(decision.autoEligible, true);
    assert.equal(decision.requiresApproval, false);
  }
});

test("mcp + readOnlyHint:true + owner-trusted server → auto-eligible", () => {
  const decision = resolveApprovalPolicy({
    source: "mcp",
    annotations: { readOnlyHint: true },
    serverTrusted: true,
  });
  assert.equal(decision.autoEligible, true);
  assert.equal(decision.requiresApproval, false);
});

test("mcp + readOnlyHint:true + UNTRUSTED server → still asks (annotations can't loosen policy)", () => {
  const decision = resolveApprovalPolicy({
    source: "mcp",
    annotations: { readOnlyHint: true },
    serverTrusted: false,
  });
  assert.equal(decision.autoEligible, false);
  assert.equal(decision.requiresApproval, true);
  assert.match(decision.reason, /untrusted server can only make policy stricter/);
});

test("mcp + destructiveHint:true ALWAYS asks, even on a trusted server", () => {
  const decision = resolveApprovalPolicy({
    source: "mcp",
    annotations: { readOnlyHint: false, destructiveHint: true },
    serverTrusted: true,
  });
  assert.equal(decision.autoEligible, false);
  assert.equal(decision.requiresApproval, true);
  assert.match(decision.reason, /destructiveHint/);
});

test("mcp + no annotations at all + trusted server → the SAFE DEFAULT is to ask", () => {
  const decision = resolveApprovalPolicy({ source: "mcp", serverTrusted: true });
  assert.equal(decision.autoEligible, false);
  assert.equal(decision.requiresApproval, true);
  assert.match(decision.reason, /No annotations declared/);
});

test("mcp + readOnlyHint:false + trusted server → asks (readOnly is required, trust alone isn't enough)", () => {
  const decision = resolveApprovalPolicy({
    source: "mcp",
    annotations: { readOnlyHint: false },
    serverTrusted: true,
  });
  assert.equal(decision.autoEligible, false);
});

// ── Output caps + workspace spill (R-MCP7) ──────────────────────────────────────────────────────

test("a small result passes through untouched (status ok)", async () => {
  const root = tempWorkspace();
  const outcome = await applyOutputCap(
    { hello: "world" },
    "call-1",
    root,
    getTokenCounter("raw_json_rough"),
    { warnTokens: 100, capTokens: 1000 },
  );
  assert.equal(outcome.status, "ok");
  assert.deepEqual(outcome.modelContent, { hello: "world" });
  assert.equal(outcome.artifact, undefined);
});

test("a result over warnTokens but under capTokens passes through with status warn (content unchanged)", async () => {
  const root = tempWorkspace();
  // raw_json_rough ~= bytes/4. Build a string sized to land strictly between warn=100 and cap=1000
  // tokens (~400 bytes → ~100 tokens; use ~800 bytes → ~200 tokens).
  const payload = { text: "x".repeat(800) };
  const outcome = await applyOutputCap(payload, "call-2", root, getTokenCounter("raw_json_rough"), {
    warnTokens: 100,
    capTokens: 1000,
  });
  assert.equal(outcome.status, "warn");
  assert.deepEqual(outcome.modelContent, payload);
});

test("a result over capTokens spills to the workspace as a file + a reference; modelContent is a compact pointer", async () => {
  const root = tempWorkspace();
  const payload = { text: "y".repeat(20_000) }; // ~5000+ tokens under raw_json_rough — well over a 50-token cap
  const outcome = await applyOutputCap(payload, "call-3", root, getTokenCounter("raw_json_rough"), {
    warnTokens: 10,
    capTokens: 50,
  });
  assert.equal(outcome.status, "capped");
  assert.equal(typeof outcome.modelContent, "string");
  assert.match(outcome.modelContent as string, /spilled to the session workspace file/);
  assert.equal(outcome.artifact?.kind, "spill");
  assert.ok(outcome.artifact?.spillPath?.includes("call-3"));

  const spilled = readWorkspaceTextFile(root, outcome.artifact!.spillPath!);
  const parsed = JSON.parse(spilled) as { text: string };
  assert.equal(parsed.text, payload.text, "the FULL result is recoverable from the spill file");
});

// ── Structured-output validation + isError fold (R-MCP6) ───────────────────────────────────────

test("validateStructuredOutput: no outputSchema declared → nothing to validate against, always valid", () => {
  const result = validateStructuredOutput(undefined, { anything: true });
  assert.equal(result.valid, true);
  assert.deepEqual(result.violations, []);
});

test("validateStructuredOutput: a structuredContent violating outputSchema is caught", () => {
  const schema = { type: "object", required: ["count"], properties: { count: { type: "number" } } };
  const result = validateStructuredOutput(schema, { count: "not-a-number" });
  assert.equal(result.valid, false);
  assert.ok(result.violations.length > 0);
});

test("foldMcpResultForModel: isError:true is DATA, never a session error — modelContent still populated", () => {
  const folded = foldMcpResultForModel({
    isError: true,
    content: [{ type: "text", text: "tool failed: rate limited" }],
  });
  assert.equal(folded.isError, true);
  assert.equal(folded.errorText, "tool failed: rate limited");
});

test("foldMcpResultForModel: structuredContent matching outputSchema passes through as modelContent", () => {
  const schema = { type: "object", required: ["count"], properties: { count: { type: "number" } } };
  const folded = foldMcpResultForModel({
    structuredContent: { count: 3 },
    outputSchema: schema,
    isError: false,
  });
  assert.equal(folded.isError, false);
  assert.deepEqual(folded.modelContent, { count: 3 });
});

test("foldMcpResultForModel: a structuredContent/outputSchema MISMATCH is surfaced to the model as a self-correction error, not silently accepted", () => {
  const schema = { type: "object", required: ["count"], properties: { count: { type: "number" } } };
  const folded = foldMcpResultForModel({
    structuredContent: { count: "oops" },
    outputSchema: schema,
    content: [{ type: "text", text: "raw fallback" }],
    isError: false,
  });
  assert.equal(folded.isError, true);
  assert.match(folded.errorText ?? "", /outputSchema validation/);
  const modelContent = folded.modelContent as { validationError: string };
  assert.match(modelContent.validationError, /does not match outputSchema/);
});

test("foldMcpResultForModel: no structuredContent falls back to raw content, isError passthrough", () => {
  const folded = foldMcpResultForModel({ content: "plain text result", isError: false });
  assert.equal(folded.modelContent, "plain text result");
  assert.equal(folded.isError, false);
});
