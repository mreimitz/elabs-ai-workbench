import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DEFAULT_SKILL_FLOW_ID,
  DEFAULT_SKILL_QUALITY_L1_TOKEN_CEILING,
  DEFAULT_SKILL_QUALITY_L2_TOKEN_CEILING,
  QUALITY_ENGINE_VERSION,
  QUALITY_SEVERITY_WEIGHTS,
  SKILL_EDIT_OP_TYPES,
  TOOL_VALIDATION_VERSION,
  type PublishToGithubInput,
  type QualityReport,
  type SkillEditOp,
  type SkillGraph,
  type ToolDiagnostic,
  type TriggerCollision,
  publishToGithubInputSchema,
  publishToGithubResultSchema,
  qualityReportSchema,
  skillEditOpSchema,
  skillGraphSchema,
  toolDiagnosticSchema,
  toolDiagnosticsReportSchema,
  triggerCollisionSchema,
  triggerSurfaceSchema,
} from "@mcp-token-footprint/shared";
import { validateEditOps } from "../src/skillflow/edit-ops.js";

// WP 1.1 — the additive Skill IDE contract v2. Mirrors apps/api/test/skillflow-contract.test.ts in
// style: schema round-trips (parse → deepEqual) + targeted rejection cases, plus a backward-compat
// lock that a pre-IDE SkillFlow graph (no flowId anywhere) still parses byte-identically.

// --- (1) entry_point node + flow'd graph -------------------------------------------------------

test("skillGraphSchema round-trips an entry_point node + a flowId'd graph with flows", () => {
  const graph: SkillGraph = {
    nodes: [
      {
        id: "n_report_entry",
        kind: "entry_point",
        label: "/report",
        source: "inferred",
        flowId: "n_report_entry",
        trigger: { type: "command", value: "/report" },
        anchor: { headingPath: ["/report daily"], startLine: 12, endLine: 12 },
      },
      {
        id: "n_report_body",
        kind: "subroutine",
        label: "/report daily",
        source: "inferred",
        flowId: "n_report_entry",
        anchor: { headingPath: ["/report daily"], startLine: 12, endLine: 30 },
      },
      {
        id: "n_kw_entry",
        kind: "entry_point",
        label: "weekly digest",
        source: "annotated",
        flowId: DEFAULT_SKILL_FLOW_ID,
        trigger: { type: "keyword", value: "weekly digest" },
        anchor: { headingPath: [], startLine: 3, endLine: 3 },
      },
    ],
    edges: [{ id: "e1", from: "n_report_entry", to: "n_report_body", flowId: "n_report_entry" }],
    warnings: [],
    flows: [
      { id: DEFAULT_SKILL_FLOW_ID, label: "Main" },
      { id: "n_report_entry", label: "/report", entryNodeId: "n_report_entry" },
    ],
  };

  const parsed = skillGraphSchema.parse(graph);
  assert.deepEqual(parsed, graph);
});

test("skillGraphSchema rejects an entry_point node with a bad trigger type", () => {
  const result = skillGraphSchema.safeParse({
    nodes: [
      {
        id: "n_bad",
        kind: "entry_point",
        label: "/x",
        source: "inferred",
        trigger: { type: "regex", value: "/x" }, // not command|keyword
        anchor: { headingPath: [], startLine: 1, endLine: 1 },
      },
    ],
    edges: [],
    warnings: [],
  });
  assert.equal(result.success, false);
});

// --- (2) backward-compat lock: a pre-IDE graph (no flowId anywhere) still parses ---------------

test("skillGraphSchema still parses a pre-IDE SkillFlow graph with no flowId/flows/entry_point", () => {
  const legacy: SkillGraph = {
    nodes: [
      {
        id: "n_gather",
        kind: "subroutine",
        label: "Gather inputs",
        source: "inferred",
        anchor: { headingPath: ["Gather inputs"], startLine: 10, endLine: 24 },
      },
      {
        id: "n_template",
        kind: "asset",
        label: "template.html",
        source: "inferred",
        path: "assets/template.html",
        fileKind: "asset",
        anchor: { headingPath: ["Generate report"], startLine: 30, endLine: 30 },
      },
    ],
    edges: [{ id: "e1", from: "n_gather", to: "n_template" }],
    warnings: [],
  };

  const parsed = skillGraphSchema.parse(legacy);
  // Byte-identical: no additive field is injected onto a legacy graph (flowId/flows stay absent).
  assert.deepEqual(parsed, legacy);
  assert.equal("flows" in parsed, false);
  assert.equal("flowId" in parsed.nodes[0]!, false);
  assert.equal("flowId" in parsed.edges[0]!, false);
});

// --- (3) each new edit-op member: a valid round-trip + a targeted rejection --------------------

test("skillEditOpSchema round-trips every new IDE edit-op member", () => {
  const ops: SkillEditOp[] = [
    {
      op: "add_command",
      command: "/report",
      title: "Daily report",
      body: "Steps…",
      afterFlowId: "main",
    },
    { op: "rename_command", nodeId: "n_entry", command: "/summary" },
    { op: "delete_command", nodeId: "n_entry" },
    { op: "set_keywords", keywords: ["weekly digest", "status update"] },
    {
      op: "connect_asset",
      nodeId: "n_body",
      path: "assets/template.html",
      sentence: "Use the template.",
    },
    { op: "disconnect_asset", nodeId: "n_body", path: "assets/template.html" },
    { op: "add_file", path: "references/spec.md", content: "# Spec", encoding: "utf8" },
    { op: "update_file", path: "references/spec.md", content: "AAAA", encoding: "base64" },
    { op: "rename_file", from: "references/old.md", to: "references/new.md" },
    { op: "delete_file", path: "references/old.md" },
  ];

  for (const op of ops) {
    assert.deepEqual(skillEditOpSchema.parse(op), op);
  }

  // Every new op type is a member of the SKILL_EDIT_OP_TYPES vocabulary constant.
  const covered = new Set(ops.map((o) => o.op));
  for (const t of [
    "add_command",
    "rename_command",
    "delete_command",
    "set_keywords",
    "connect_asset",
    "disconnect_asset",
    "add_file",
    "update_file",
    "rename_file",
    "delete_file",
  ] as const) {
    assert.ok(SKILL_EDIT_OP_TYPES.includes(t), `${t} missing from SKILL_EDIT_OP_TYPES`);
    assert.ok(covered.has(t), `${t} not exercised by the round-trip fixture`);
  }
});

test("skillEditOpSchema rejects a bad command token (add_command)", () => {
  const result = skillEditOpSchema.safeParse({ op: "add_command", command: "report daily" });
  assert.equal(result.success, false);
});

test("skillEditOpSchema rejects an empty path (add_file)", () => {
  const result = skillEditOpSchema.safeParse({ op: "add_file", path: "", content: "x" });
  assert.equal(result.success, false);
});

test("skillEditOpSchema rejects a bad encoding (update_file)", () => {
  const result = skillEditOpSchema.safeParse({
    op: "update_file",
    path: "a.md",
    content: "x",
    encoding: "utf-16", // not utf8|base64
  });
  assert.equal(result.success, false);
});

// --- (3b) edit-ops v2: the command/keyword/asset ops now carry semantics (Skill IDE WP 2.1) -----
// (superseded the WP 1.1 "not-yet-implemented" stub guard, whose message named this WP.)

test("validateEditOps accepts a valid add_command but rejects a duplicate /command token (WP 2.1)", () => {
  // A valid add_command on an empty graph is now applicable (no error) — the stub is gone.
  const empty: SkillGraph = { nodes: [], edges: [], warnings: [] };
  assert.deepEqual(validateEditOps(empty, [{ op: "add_command", command: "/report" }]), []);

  // A /command token must be unique: adding one that already exists is rejected.
  const graph: SkillGraph = {
    nodes: [
      {
        id: "report",
        kind: "entry_point",
        label: "/report",
        anchor: { headingPath: ["/report"], startLine: 1, endLine: 2 },
        source: "inferred",
        flowId: "report",
        trigger: { type: "command", value: "/report" },
      },
    ],
    edges: [],
    warnings: [],
    flows: [
      { id: DEFAULT_SKILL_FLOW_ID, label: "Main flow" },
      { id: "report", label: "/report", entryNodeId: "report" },
    ],
  };
  const errors = validateEditOps(graph, [{ op: "add_command", command: "/report" }]);
  assert.equal(errors.length, 1);
  assert.match(errors[0]!, /already exists/);
});

// --- (4) quality shapes -----------------------------------------------------------------------

test("qualityReportSchema round-trips a report whose score follows QUALITY_SEVERITY_WEIGHTS", () => {
  // One error (15) + one warning (5) + one info (1) = 21 penalty → 79.
  const expectedScore =
    100 -
    (QUALITY_SEVERITY_WEIGHTS.error +
      QUALITY_SEVERITY_WEIGHTS.warning +
      QUALITY_SEVERITY_WEIGHTS.info);
  const report: QualityReport = {
    findings: [
      {
        ruleId: "manifest-completeness",
        severity: "error",
        message: "Missing description.",
        anchor: { headingPath: [], startLine: 1, endLine: 1 },
        fix: [{ op: "update_section_body", nodeId: "n_intro", body: "…" }],
      },
      { ruleId: "token-budget-l2", severity: "warning", message: "Body over the L2 ceiling." },
      {
        ruleId: "trigger-hygiene",
        severity: "info",
        message: "Consider a more specific description.",
      },
    ],
    score: expectedScore,
    ruleCounts: { "manifest-completeness": 1, "token-budget-l2": 1, "trigger-hygiene": 1 },
    qualityEngineVersion: QUALITY_ENGINE_VERSION,
  };

  const parsed = qualityReportSchema.parse(report);
  assert.deepEqual(parsed, report);
  assert.equal(parsed.score, 79);
});

test("qualityReportSchema rejects a score out of the 0–100 range", () => {
  const result = qualityReportSchema.safeParse({
    findings: [],
    score: 140,
    ruleCounts: {},
    qualityEngineVersion: QUALITY_ENGINE_VERSION,
  });
  assert.equal(result.success, false);
});

test("qualityFindingSchema (via report) rejects a bad severity", () => {
  const result = qualityReportSchema.safeParse({
    findings: [{ ruleId: "x", severity: "critical", message: "no" }], // not error|warning|info
    score: 100,
    ruleCounts: {},
    qualityEngineVersion: QUALITY_ENGINE_VERSION,
  });
  assert.equal(result.success, false);
});

// --- (5) tool-validation shapes ---------------------------------------------------------------

test("toolDiagnosticsReportSchema round-trips diagnostics with candidates + the version stamp", () => {
  const diagnostic: ToolDiagnostic = {
    kind: "unknown_tool",
    name: "queery_data",
    anchor: { headingPath: ["Run the query"], startLine: 20, endLine: 20 },
    candidates: [
      { server: "qlik", tool: "query_data", confidence: "normalized" },
      { server: "qlik", tool: "query", confidence: "fuzzy" },
    ],
  };
  assert.deepEqual(toolDiagnosticSchema.parse(diagnostic), diagnostic);

  const report = {
    diagnostics: [diagnostic],
    toolValidationVersion: TOOL_VALIDATION_VERSION,
  };
  assert.deepEqual(toolDiagnosticsReportSchema.parse(report), report);
});

test("toolDiagnosticSchema rejects a bad candidate confidence", () => {
  const result = toolDiagnosticSchema.safeParse({
    kind: "stale_tool",
    name: "old_tool",
    candidates: [{ server: "s", tool: "t", confidence: "maybe" }], // not exact|normalized|fuzzy
  });
  assert.equal(result.success, false);
});

// --- (6) trigger shapes -----------------------------------------------------------------------

test("triggerSurfaceSchema round-trips a description + keywords + commands", () => {
  const surface = {
    description: "Generates daily and weekly reports.",
    keywords: ["weekly digest"],
    commands: [{ value: "/report", nodeId: "n_report_entry", flowId: "n_report_entry" }],
  };
  assert.deepEqual(triggerSurfaceSchema.parse(surface), surface);
});

test("triggerCollisionSchema round-trips a cross-skill collision", () => {
  const collision: TriggerCollision = {
    value: "/report",
    kind: "command",
    skillIds: ["skill_a", "skill_b"],
  };
  assert.deepEqual(triggerCollisionSchema.parse(collision), collision);
});

test("triggerCollisionSchema rejects a bad trigger kind", () => {
  const result = triggerCollisionSchema.safeParse({
    value: "/report",
    kind: "slash", // not command|keyword
    skillIds: ["a"],
  });
  assert.equal(result.success, false);
});

// --- (7) publish shapes -----------------------------------------------------------------------

test("publishToGithubInputSchema round-trips a valid input + result round-trips", () => {
  const input: PublishToGithubInput = {
    repoName: "my-skill.v2_final",
    private: true,
    token: "ghp_secret",
    bindAsSource: true,
  };
  assert.deepEqual(publishToGithubInputSchema.parse(input), input);

  const result = { repoUrl: "https://github.com/me/my-skill", bound: true };
  assert.deepEqual(publishToGithubResultSchema.parse(result), result);
});

test("publishToGithubInputSchema rejects a bad repoName", () => {
  for (const bad of ["has space", "bad/slash", "with#hash", "", ".", ".."]) {
    const result = publishToGithubInputSchema.safeParse({
      repoName: bad,
      private: false,
      bindAsSource: false,
    });
    assert.equal(result.success, false, `repoName "${bad}" should be rejected`);
  }
});

// --- (8) constant sanity: token ceilings + version stamps -------------------------------------

test("Skill IDE constants have sane values", () => {
  assert.equal(QUALITY_ENGINE_VERSION, 1);
  assert.equal(TOOL_VALIDATION_VERSION, 1);
  assert.equal(DEFAULT_SKILL_FLOW_ID, "main");
  assert.ok(DEFAULT_SKILL_QUALITY_L1_TOKEN_CEILING > 0);
  assert.ok(
    DEFAULT_SKILL_QUALITY_L2_TOKEN_CEILING > DEFAULT_SKILL_QUALITY_L1_TOKEN_CEILING,
    "the L2 body ceiling should exceed the tiny always-resident L1 metadata ceiling",
  );
  assert.deepEqual(QUALITY_SEVERITY_WEIGHTS, { error: 15, warning: 5, info: 1 });
});
