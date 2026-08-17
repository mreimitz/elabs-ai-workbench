// Assistant Hub — shared contract (WP0.1) round-trip + additivity lock.
//
// Exhaustive: every new `Hub*` schema parses a valid sample and rejects an invalid one; the
// discriminated unions (events, message parts) cover EVERY variant via a `Record<…Type, …>` fixture
// so a forgotten variant is a compile error, not a silent gap. The session lifecycle facets prove the
// Unified-Sessions contract is REUSED (a RunStatus/RunPhase/StopReasonCode/SessionCapabilities parse
// through `hubSessionSchema`), and the closed unions reject unknown members while wire objects stay
// additively parseable.

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  HUB_APPROVAL_OPTION_KINDS,
  HUB_APPROVAL_RESOLUTIONS,
  HUB_ARTIFACT_KINDS,
  HUB_AUTONOMY_LEVELS,
  HUB_CONFIDENCE_LEVELS,
  HUB_CREW_COLORS,
  HUB_EVENT_TYPES,
  HUB_MEMORY_KINDS,
  HUB_MEMORY_SCOPES,
  HUB_MESSAGE_PART_TYPES,
  HUB_MISSION_MAX_DEPTH,
  HUB_MISSION_MAX_TOTAL_AGENTS,
  HUB_MISSION_STATUSES,
  HUB_SESSION_KINDS,
  HUB_SESSION_MODES,
  HUB_TASK_STATUSES,
  HUB_TOOL_PART_STATES,
  HUB_TOPOLOGIES,
  HUB_USAGE_GROUP_BYS,
  RUN_PHASES,
  RUN_STATUSES,
  STOP_REASON_CODES,
} from "./constants.js";
import {
  hubAgentReportSchema,
  hubAgentRoleInputSchema,
  hubAgentRolePatchSchema,
  hubAgentRoleSchema,
  hubArtifactSchema,
  hubArtifactVersionSchema,
  hubCitationSchema,
  hubCrewColorSchema,
  hubCrewInputSchema,
  hubCrewMemberSchema,
  hubCrewPatchSchema,
  hubCrewSchema,
  hubEffectiveMemoryEntrySchema,
  hubEffectiveMemoryLayerSummarySchema,
  hubEffectiveMemoryOverrideSchema,
  hubEffectiveMemorySchema,
  hubEventSchema,
  hubEventTypeSchema,
  hubFileLinkSchema,
  hubFileSchema,
  hubGenerativeUiPartSchema,
  hubGenUiNodeSchema,
  hubMemoryInputSchema,
  hubMemoryPatchSchema,
  hubMemorySchema,
  hubMemoryScopeSchema,
  hubMessagePartSchema,
  hubMissionPlanSchema,
  hubMissionSchema,
  hubPlannedAgentSchema,
  hubProjectInputSchema,
  hubReviewDecisionResultSchema,
  hubReviewSchema,
  hubSessionCreateInputSchema,
  hubSessionDetailSchema,
  hubSessionPatchSchema,
  hubSessionSchema,
  hubTaskItemSchema,
  hubToolGrantsSchema,
  hubToolPartSchema,
  hubUsageGroupBySchema,
  hubUsageRowSchema,
  hubUsageSummarySchema,
} from "./schemas.js";
import type {
  HubAgentReport,
  HubAgentRole,
  HubCitation,
  HubCrew,
  HubEffectiveMemory,
  HubEvent,
  HubEventType,
  HubGenUiNode,
  HubMemory,
  HubMessagePart,
  HubMessagePartType,
  HubMission,
  HubMissionPlan,
  HubSession,
  HubToolGrants,
  HubToolPart,
  HubUsageRow,
  HubUsageSummary,
} from "./types.js";

// ── Shared fixtures ──────────────────────────────────────────────────────────────────────────────
const citation: HubCitation = {
  id: "c1",
  title: "MCP spec",
  url: "https://example.com/spec",
  snippet: "…numbered inline citations…",
  toolCallRef: "tc-1",
  agentRef: "agent-2",
};

const grants: HubToolGrants = {
  servers: { "srv-a": "all", "srv-b": ["search", "fetch"] },
  builtins: ["files.read", "artifacts.create", "tasks.create"],
};

const toolPart: HubToolPart = {
  type: "tool_call",
  toolCallId: "tc-1",
  toolName: "srv-a__search",
  source: "mcp",
  serverId: "srv-a",
  title: "Search",
  state: "output-available",
  args: { q: "mcp" },
  argsText: '{"q":"mcp"}',
  annotations: { readOnlyHint: true, destructiveHint: false },
  approval: {
    options: ["allow-once", "always"],
    grants: ["srv-a:search"],
    isAutomatic: false,
    resolution: "allow-once",
  },
  progress: { progressToken: "p1", progress: 1, total: 1, cancellable: true },
  modelContent: { rows: 3 }, // model-visible channel (R-GUI3)
  artifact: { kind: "table", data: [{ a: 1 }], spillPath: undefined }, // UI-visible channel (R-GUI3)
  isError: false,
  citationIds: ["c1"],
  metering: { requestTokens: 10, responseTokens: 40, durationMs: 120 },
};

const agentReport: HubAgentReport = {
  agentSessionId: "sess-agent-1",
  roleName: "Researcher",
  summary: "Found three sources.",
  findings: [{ summary: "A", detail: "detail", citationIds: ["c1"], confidence: "high" }],
  citations: [citation],
  artifacts: [{ artifactId: "art-1", versionId: "v1", version: 1, title: "Notes" }],
  confidence: "medium",
  openQuestions: ["What about latency?"],
};

const missionPlan: HubMissionPlan = {
  topology: "parallel",
  autonomy: "always_ask",
  agents: [
    {
      key: "a1",
      roleId: "role-1",
      name: "Researcher",
      systemPrompt: "You research.",
      model: "claude-opus-4",
      toolGrants: grants,
      skillIds: ["skill-1"],
      brief: "Investigate X (isolated context).",
      target: "Find evidence for X",
      expectedOutcome: "A structured report",
      budgets: { maxTurns: 8, maxCostUsd: 0.5 },
      rationale: "because your prompt asks about X",
      estimatedCostUsd: 0.4,
    },
  ],
  rationale: "Split into research + synthesis.",
  estimatedCostUsd: 1.2,
  budgets: { maxAgents: 3, maxParallel: 2, maxCostUsd: 2, perAgent: { maxTokens: 50_000 } },
};

// ── Enum vocabularies round-trip through their schemas ─────────────────────────────────────────────
test("HUB_EVENT_TYPES is the 26 §1.3 members + annex-mandated + WP2.3 HITL + WP3.3 compaction + WP3.4 resource + WP2.5 board-approval events", () => {
  // 26 sketch members + queued_user_message (R-SES3) + ui_state (R-GUI5) + the 4 WP2.3 live-HITL
  // events (approval_requested/responded, elicitation_requested/responded — R-MCP3/R-MCP4/R-UX1) +
  // compaction (WP3.3 / R-SES8) + the 2 WP3.4 resource-attachment events (resource_attached/removed —
  // R-MCP9) + the 2 hub-fixes WP2.5 board-mirror approval events (agent_approval_requested/responded —
  // D-HF6) + the 2 assistant-hub v1-fixes mission-memory events (mission_digest/mission_followups —
  // F2/F7).
  assert.equal(HUB_EVENT_TYPES.length, 41);
  const set = new Set<string>(HUB_EVENT_TYPES);
  for (const t of [
    "user_message",
    "assistant_message",
    "reasoning",
    "tool_call",
    "tool_result",
    "phase",
    "plan_proposed",
    "plan_updated",
    "plan_approved",
    "mission_started",
    "agent_spawned",
    "agent_report",
    "mission_synthesis",
    "artifact_created",
    "artifact_updated",
    "review_opened",
    "review_decided",
    "memory_proposed",
    "memory_saved",
    "file_uploaded",
    "workspace_file_changed",
    "branch_created",
    "limit_error",
    "error",
    "turn_done",
    "ping",
  ]) {
    assert.ok(set.has(t), `§1.3 member ${t} must be present`);
  }
  assert.ok(set.has("queued_user_message"), "R-SES3 queued event must be present");
  assert.ok(set.has("ui_state"), "R-GUI5 per-message UI-state event must be present");
  for (const t of [
    "approval_requested",
    "approval_responded",
    "elicitation_requested",
    "elicitation_responded",
  ]) {
    assert.ok(set.has(t), `WP2.3 live-HITL event ${t} must be present`);
  }
  for (const t of ["question", "question_resolved"]) {
    assert.ok(set.has(t), `interactive ask_user event ${t} must be present`);
  }
  assert.ok(set.has("compaction"), "WP3.3 compaction event (R-SES8) must be present");
  for (const t of ["resource_attached", "resource_removed"]) {
    assert.ok(set.has(t), `WP3.4 R-MCP9 resource-attachment event ${t} must be present`);
  }
  for (const t of ["agent_approval_requested", "agent_approval_responded"]) {
    assert.ok(set.has(t), `hub-fixes WP2.5 D-HF6 board-approval event ${t} must be present`);
  }
  for (const t of HUB_EVENT_TYPES) assert.equal(hubEventTypeSchema.parse(t), t);
});

test("hubEventTypeSchema rejects an unknown event type", () => {
  assert.equal(hubEventTypeSchema.safeParse("not_an_event").success, false);
});

test("R-UX1 tool-part state machine covers every canonical state and rejects an out-of-union state", () => {
  assert.deepEqual(
    [...HUB_TOOL_PART_STATES],
    [
      "input-streaming",
      "input-available",
      "approval-requested",
      "approval-responded",
      "output-available",
      "output-error",
      "output-denied",
    ],
  );
  for (const state of HUB_TOOL_PART_STATES) {
    assert.doesNotThrow(() => hubToolPartSchema.parse({ ...toolPart, state }));
  }
  assert.equal(hubToolPartSchema.safeParse({ ...toolPart, state: "made-up" }).success, false);
});

// ── Message parts — every variant parses; union closed ─────────────────────────────────────────────
test("every HubMessagePart variant parses and the union rejects an unknown part type", () => {
  const partSamples: Record<HubMessagePartType, HubMessagePart> = {
    text: { type: "text", text: "hello" },
    reasoning: { type: "reasoning", text: "thinking" },
    tool_call: toolPart,
    citation: { type: "citation", citationId: "c1" },
    artifact_ref: { type: "artifact_ref", artifactId: "art-1", versionId: "v1", version: 1 },
    "generative-ui": {
      type: "generative-ui",
      key: "w1",
      specVersion: "1",
      spec: {
        $type: "Stack",
        $key: "root",
        props: { gap: 2 },
        children: [
          { $type: "Text", $key: "t1", props: { value: "hi" } },
          { $type: "Table", $key: "tbl", props: { rows: [] } },
        ],
      },
      args: { partial: true },
      argsText: '{"partial":true}',
      state: { fieldA: "typed" },
    },
  };
  // Exhaustive: `Record<HubMessagePartType, …>` forces one sample per part type.
  assert.deepEqual(new Set(Object.keys(partSamples)), new Set(HUB_MESSAGE_PART_TYPES));
  for (const [type, part] of Object.entries(partSamples)) {
    assert.equal(part.type, type);
    assert.doesNotThrow(() => hubMessagePartSchema.parse(part), `part ${type} should parse`);
  }
  assert.equal(hubMessagePartSchema.safeParse({ type: "widget", text: "x" }).success, false);
});

test("the recursive generative-UI node round-trips (children recursion) and requires $type", () => {
  const node: HubGenUiNode = {
    $type: "Card",
    children: [{ $type: "Text", props: { value: "a" }, children: [{ $type: "Badge" }] }],
  };
  assert.deepEqual(hubGenUiNodeSchema.parse(node), node);
  assert.equal(hubGenUiNodeSchema.safeParse({ $key: "no-type" }).success, false);
  // A generative-ui part carries args + raw argsText (R-GUI3).
  assert.doesNotThrow(() =>
    hubGenerativeUiPartSchema.parse({ type: "generative-ui", spec: node, argsText: "{" }),
  );
});

// ── Events — every variant parses; union closed; wire stays additive ───────────────────────────────
test("every HubEvent variant parses; the closed union rejects unknown discriminants + malformed members", () => {
  const eventSamples: Record<HubEventType, HubEvent> = {
    user_message: {
      type: "user_message",
      messageId: "m1",
      text: "hi",
      attachmentFileIds: ["f1"],
      seq: 0,
    },
    queued_user_message: {
      type: "queued_user_message",
      queuedMessageId: "q1",
      text: "steer",
      seq: 1,
    },
    assistant_message: {
      type: "assistant_message",
      messageId: "m2",
      model: "claude-opus-4",
      parts: [
        { type: "text", text: "answer [1]" },
        toolPart,
        { type: "citation", citationId: "c1" },
      ],
      usage: { tokensIn: 100, tokensOut: 50, contextTokens: 400 },
      citations: [citation],
      artifactsTouched: [{ artifactId: "art-1", version: 1 }],
      promptVersion: "hub-1",
      costUsd: 0.01,
      costBasis: "api_exact",
      finishReason: "stop",
      variant: { variantGroupId: "g1", variantIndex: 0, variantCount: 2 },
      seq: 2,
    },
    reasoning: { type: "reasoning", messageId: "m2", text: "summary", seq: 3 },
    tool_call: { type: "tool_call", messageId: "m2", part: toolPart, seq: 4 },
    tool_result: {
      type: "tool_result",
      toolCallId: "tc-1",
      state: "output-available",
      modelContent: { ok: true },
      artifact: { kind: "table", data: [] },
      citations: [citation],
      metering: { responseTokens: 40 },
      seq: 5,
    },
    ui_state: {
      type: "ui_state",
      messageId: "m2",
      key: "w1",
      state: { fieldA: 1 },
      source: "user",
      seq: 6,
    },
    phase: { type: "phase", phase: "waiting_input", detail: { reason: "next_turn" }, seq: 7 },
    turn_done: {
      type: "turn_done",
      messageId: "m2",
      usage: { tokensIn: 1, tokensOut: 2 },
      costUsd: 0,
      seq: 8,
    },
    plan_proposed: { type: "plan_proposed", missionId: "mis-1", plan: missionPlan, seq: 9 },
    plan_updated: {
      type: "plan_updated",
      missionId: "mis-1",
      plan: missionPlan,
      editedBy: "user",
      seq: 10,
    },
    plan_approved: {
      type: "plan_approved",
      missionId: "mis-1",
      autonomy: "threshold",
      approvedBy: "user",
      auto: false,
      seq: 11,
    },
    mission_started: {
      type: "mission_started",
      missionId: "mis-1",
      agentSessionIds: ["s1", "s2"],
      seq: 12,
    },
    agent_spawned: {
      type: "agent_spawned",
      missionId: "mis-1",
      agentSessionId: "s1",
      key: "a1",
      roleName: "Researcher",
      model: "claude-opus-4",
      brief: "Investigate X",
      index: 0,
      seq: 13,
    },
    agent_report: {
      type: "agent_report",
      missionId: "mis-1",
      agentSessionId: "s1",
      report: agentReport,
      seq: 14,
    },
    mission_synthesis: {
      type: "mission_synthesis",
      missionId: "mis-1",
      messageId: "m3",
      partial: false,
      agentReportRefs: ["s1"],
      seq: 15,
    },
    mission_digest: {
      type: "mission_digest",
      missionId: "mis-1",
      text: "Mission results digest — analyst (confidence high): finding A. Open questions: Q1?",
      agentReportRefs: ["s1"],
      seq: 151,
    },
    mission_followups: {
      type: "mission_followups",
      missionId: "mis-1",
      followups: [{ question: "Q1?", agentSessionId: "s1", roleName: "analyst" }],
      seq: 152,
    },
    artifact_created: {
      type: "artifact_created",
      artifactId: "art-1",
      kind: "markdown",
      title: "Notes",
      versionId: "v1",
      version: 1,
      seq: 16,
    },
    artifact_updated: {
      type: "artifact_updated",
      artifactId: "art-1",
      versionId: "v2",
      version: 2,
      note: "edit",
      seq: 17,
    },
    review_opened: {
      type: "review_opened",
      reviewId: "rev-1",
      artifactId: "art-1",
      baseVersion: 2,
      seq: 18,
    },
    review_decided: {
      type: "review_decided",
      reviewId: "rev-1",
      artifactId: "art-1",
      status: "resolved",
      commentId: "cm-1",
      decision: "accepted",
      resultingVersionId: "v3",
      resultingVersion: 3,
      seq: 19,
    },
    memory_proposed: {
      type: "memory_proposed",
      kind: "preference",
      content: "Prefers concise answers",
      seq: 20,
    },
    memory_saved: {
      type: "memory_saved",
      memoryId: "mem-1",
      kind: "preference",
      content: "Prefers concise answers",
      source: "assistant_proposed",
      seq: 21,
    },
    file_uploaded: {
      type: "file_uploaded",
      fileId: "f1",
      filename: "a.txt",
      mime: "text/plain",
      bytes: 123,
      role: "upload",
      seq: 22,
    },
    workspace_file_changed: {
      type: "workspace_file_changed",
      path: "out/report.md",
      change: "created",
      bytes: 200,
      sha256: "abc",
      seq: 23,
    },
    resource_attached: {
      type: "resource_attached",
      id: "res-1",
      serverId: "srv-a",
      serverName: "Server A",
      uri: "file:///reports/q3.csv",
      name: "q3.csv",
      title: "Q3 report",
      description: "Quarterly numbers",
      mimeType: "text/csv",
      audience: ["assistant"],
      priority: 0.8,
      lastModified: "2026-07-01T00:00:00.000Z",
      tokens: 420,
      seq: 32,
    },
    resource_removed: { type: "resource_removed", id: "res-1", seq: 33 },
    branch_created: {
      type: "branch_created",
      branchSessionId: "sess-b",
      fromSessionId: "sess-a",
      fromSeq: 12,
      fromMessageId: "m2",
      label: "what-if",
      seq: 24,
    },
    limit_error: {
      type: "limit_error",
      message: "rate limited",
      retrySources: ["api_key", "other_model"],
      limitKind: "rate_limit",
      provider: "anthropic",
      seq: 25,
    },
    error: {
      type: "error",
      message: "reauth needed",
      authRequired: true,
      serverIds: ["srv-a"],
      recoverable: true,
      seq: 26,
    },
    ping: { type: "ping", seq: 27 },
    approval_requested: {
      type: "approval_requested",
      toolCallId: "tc-1",
      toolName: "mcp__srv__delete",
      messageId: "m2",
      source: "mcp",
      serverId: "srv-a",
      annotations: { destructiveHint: true },
      options: ["allow-once"],
      isAutomatic: false,
      autonomy: "always_ask",
      seq: 28,
    },
    approval_responded: {
      type: "approval_responded",
      toolCallId: "tc-1",
      resolution: "allow-once",
      isAutomatic: false,
      seq: 29,
    },
    elicitation_requested: {
      type: "elicitation_requested",
      elicitationId: "el-1",
      serverId: "srv-a",
      serverName: "Server A",
      toolCallId: "tc-2",
      message: "Confirm the branch to deploy",
      mode: "form",
      requestedSchema: { type: "object", properties: { branch: { type: "string" } } },
      seq: 30,
    },
    elicitation_responded: {
      type: "elicitation_responded",
      elicitationId: "el-1",
      action: "accept",
      seq: 31,
    },
    question: {
      type: "question",
      questionId: "q-1",
      prompt: "Which environment should I target?",
      options: [{ label: "staging", description: "the shared preview tenant" }, { label: "prod" }],
      allowOther: true,
      seq: 32,
    },
    question_resolved: {
      type: "question_resolved",
      questionId: "q-1",
      answer: "staging",
      seq: 33,
    },
    compaction: {
      type: "compaction",
      summaryId: "sum-1",
      uptoSeq: 8,
      summary: "Earlier turns summarized. User required: use metric units.",
      summaryTokens: 42,
      clearedToolOutputs: 3,
      clearedToolOutputTokens: 900,
      windowBefore: 120000,
      windowAfter: 30000,
      reattachedSkillIds: ["skill-a"],
      userAim: "Keep the deployment constraints",
      seq: 32,
    },
    agent_approval_requested: {
      type: "agent_approval_requested",
      missionId: "mis-1",
      agentSessionId: "sess-child-1",
      roleName: "Researcher A",
      toolCallId: "tc-9",
      toolName: "mcp__srv__write",
      source: "mcp",
      serverId: "srv-a",
      annotations: { destructiveHint: true },
      options: ["allow-once"],
      seq: 33,
    },
    agent_approval_responded: {
      type: "agent_approval_responded",
      missionId: "mis-1",
      agentSessionId: "sess-child-1",
      toolCallId: "tc-9",
      resolution: "deny",
      reason: "timeout",
      seq: 34,
    },
  };
  // Exhaustive: `Record<HubEventType, …>` forces one sample per event type.
  assert.deepEqual(new Set(Object.keys(eventSamples)), new Set(HUB_EVENT_TYPES));
  for (const [type, ev] of Object.entries(eventSamples)) {
    assert.equal(ev.type, type);
    assert.doesNotThrow(() => hubEventSchema.parse(ev), `event ${type} should parse`);
  }

  // Closed union: an unknown discriminant is rejected.
  assert.equal(hubEventSchema.safeParse({ type: "totally_new_event" }).success, false);
  // Malformed member: assistant_message MUST carry citations + artifactsTouched arrays.
  assert.equal(
    hubEventSchema.safeParse({ type: "assistant_message", messageId: "m", model: "x", parts: [] })
      .success,
    false,
  );
  // A bad phase value is rejected (phase reuses the Unified-Sessions RunPhase vocabulary).
  assert.equal(hubEventSchema.safeParse({ type: "phase", phase: "flying" }).success, false);
});

test("wire events stay additively parseable — an unknown extra field is tolerated + seq/at envelope parses", () => {
  assert.doesNotThrow(() =>
    hubEventSchema.parse({ type: "ping", seq: 5, at: "2026-07-17T00:00:00.000Z", futureField: 1 }),
  );
  assert.doesNotThrow(() => hubEventSchema.parse({ type: "ping" } satisfies HubEvent));
});

// ── Citations (§1.7) — title required ──────────────────────────────────────────────────────────────
test("hubCitationSchema round-trips and requires a title", () => {
  assert.deepEqual(hubCitationSchema.parse(citation), citation);
  assert.equal(hubCitationSchema.safeParse({ id: "c", url: "https://x" }).success, false);
});

// ── Tool grants (D-AH7) — server→all|[tools] + builtins ────────────────────────────────────────────
test("hubToolGrantsSchema accepts server→all|allowlist + builtins; rejects a bad grant", () => {
  assert.deepEqual(hubToolGrantsSchema.parse(grants), grants);
  assert.equal(hubToolGrantsSchema.safeParse({ servers: { s: 5 }, builtins: [] }).success, false);
  assert.equal(hubToolGrantsSchema.safeParse({ servers: {} }).success, false); // builtins required
});

// ── Task widget (R-SES4) ───────────────────────────────────────────────────────────────────────────
test("hubTaskItemSchema round-trips status + dependencies and covers every task status", () => {
  for (const status of HUB_TASK_STATUSES) {
    assert.doesNotThrow(() =>
      hubTaskItemSchema.parse({ id: "t1", title: "do X", status, dependsOn: ["t0"] }),
    );
  }
  assert.equal(
    hubTaskItemSchema.safeParse({ id: "t1", title: "x", status: "queued" }).success,
    false,
  );
});

// ── Structured agent report (D-AH9) ────────────────────────────────────────────────────────────────
test("hubAgentReportSchema round-trips findings/citations/artifacts/confidence/openQuestions", () => {
  assert.deepEqual(hubAgentReportSchema.parse(agentReport), agentReport);
  for (const confidence of HUB_CONFIDENCE_LEVELS) {
    assert.doesNotThrow(() => hubAgentReportSchema.parse({ ...agentReport, confidence }));
  }
  // confidence is required + closed.
  assert.equal(
    hubAgentReportSchema.safeParse({ ...agentReport, confidence: "certain" }).success,
    false,
  );
});

// ── Roles, crews, missions ─────────────────────────────────────────────────────────────────────────
test("role/crew/mission schemas round-trip and reject bad enums", () => {
  const role = {
    id: "role-1",
    name: "Researcher",
    systemPrompt: "You research.",
    defaultModel: "claude-opus-4",
    toolGrants: grants,
    skills: [{ skillId: "skill-1", versionMode: "latest", invocationMode: "model_invocable" }],
    target: "Find evidence",
    expectedOutcome: "A report",
    budgets: { maxTurns: 8 },
    createdAt: "2026-07-17T00:00:00.000Z",
    updatedAt: "2026-07-17T00:00:00.000Z",
    archivedAt: null,
  };
  assert.doesNotThrow(() => hubAgentRoleSchema.parse(role));

  assert.doesNotThrow(() =>
    hubAgentRoleInputSchema.parse({
      name: "R",
      systemPrompt: "p",
      defaultModel: "m",
      target: "t",
      expectedOutcome: "o",
    }),
  );
  // Inputs are strict — an unknown key is rejected.
  assert.equal(
    hubAgentRoleInputSchema.safeParse({
      name: "R",
      systemPrompt: "p",
      defaultModel: "m",
      target: "t",
      expectedOutcome: "o",
      surprise: true,
    }).success,
    false,
  );

  const crew = {
    id: "crew-1",
    name: "Research crew",
    topology: "pipeline" as const,
    members: [{ agentId: "role-1", model: "override-model" }],
    createdAt: "2026-07-17T00:00:00.000Z",
    updatedAt: "2026-07-17T00:00:00.000Z",
  };
  assert.doesNotThrow(() => hubCrewSchema.parse(crew));
  assert.doesNotThrow(() =>
    hubCrewInputSchema.parse({ name: "C", topology: "debate", members: [{ agentId: "role-1" }] }),
  );
  assert.equal(
    hubCrewInputSchema.safeParse({ name: "C", topology: "roundtable", members: [] }).success,
    false,
  );

  assert.deepEqual(hubMissionPlanSchema.parse(missionPlan), missionPlan);
  const mission: HubMission = {
    id: "mis-1",
    sessionId: "sess-parent",
    status: "running",
    topology: "parallel",
    autonomy: "always_ask",
    plan: missionPlan,
    budgets: missionPlan.budgets,
    costUsd: 0.3,
    agentSessionIds: ["s1"],
    startedAt: "2026-07-17T00:00:00.000Z",
    endedAt: null,
    createdAt: "2026-07-17T00:00:00.000Z",
    updatedAt: "2026-07-17T00:00:00.000Z",
  };
  assert.doesNotThrow(() => hubMissionSchema.parse(mission));
  assert.equal(hubMissionSchema.safeParse({ ...mission, status: "paused" }).success, false);
});

// ── Crew nesting (WP0.1 / D-CN5) — `crewId` member (exactly-one + `.strict()`), recursive report, ──
// nesting fields on mission/planned-agent, and the computed-on-read crew counts. ────────────────────
test("hubCrewMemberSchema: legacy agent parses; a nested crewId member parses + round-trips (no strip); exactly-one + strict reject", () => {
  // A legacy `{agentId}` member (pre-WP0.1 shape) still validates — the required→optional widening is
  // backward-compatible (wire-additive, not an /api/v2 break).
  assert.doesNotThrow(() => hubCrewMemberSchema.parse({ agentId: "role-1" }));
  assert.doesNotThrow(() =>
    hubCrewMemberSchema.parse({ agentId: "role-1", model: "m", budgets: { maxTurns: 3 } }),
  );

  // A nested-crew member validates AND round-trips with `crewId` PRESENT — proving `.strict()` stops the
  // silent-strip trap (a plain stripping z.object would drop the un-declared `crewId` on write-then-read).
  const nested = { crewId: "crew-child" };
  const parsed = hubCrewMemberSchema.parse(nested) as { crewId?: string; agentId?: string };
  assert.equal(parsed.crewId, "crew-child");
  assert.equal(parsed.agentId, undefined);
  assert.deepEqual(parsed, nested);

  // Exactly-one of {agentId, crewId}: BOTH present rejects; NEITHER present rejects.
  assert.equal(
    hubCrewMemberSchema.safeParse({ agentId: "role-1", crewId: "crew-1" }).success,
    false,
  );
  assert.equal(hubCrewMemberSchema.safeParse({}).success, false);

  // `.strict()` — an unknown member key rejects.
  assert.equal(hubCrewMemberSchema.safeParse({ agentId: "role-1", surprise: true }).success, false);

  // The crew-level shapes inherit the exactly-one rule via `z.array(hubCrewMemberSchema)`.
  assert.equal(
    hubCrewInputSchema.safeParse({
      name: "C",
      topology: "parallel",
      members: [{ agentId: "role-1", crewId: "crew-1" }],
    }).success,
    false,
  );
  assert.doesNotThrow(() =>
    hubCrewInputSchema.parse({
      name: "C",
      topology: "pipeline",
      members: [{ crewId: "crew-child" }],
    }),
  );
});

test("hubAgentReportSchema: a nested childReports tree round-trips (self-referencing z.lazy) + flat still parses", () => {
  const nestedReport: HubAgentReport = {
    ...agentReport,
    subMissionId: "mis-child",
    topology: "pipeline",
    depth: 1,
    childReports: [
      { ...agentReport, depth: 2 },
      {
        ...agentReport,
        depth: 2,
        subMissionId: "mis-grandchild",
        childReports: [{ ...agentReport, depth: 3 }],
      },
    ],
  };
  assert.deepEqual(hubAgentReportSchema.parse(nestedReport), nestedReport);
  // A flat report (no nesting fields) still round-trips — the fields are additive.
  assert.deepEqual(hubAgentReportSchema.parse(agentReport), agentReport);
  // The nesting fields are validated: a bad topology is rejected.
  assert.equal(
    hubAgentReportSchema.safeParse({ ...agentReport, topology: "roundtable" }).success,
    false,
  );
});

test("hub nesting: HubMission parentMissionId/depth, HubPlannedAgent crewId, HubCrew counts all round-trip", () => {
  // HubPlannedAgent gains an optional `crewId` (the nested-crew marker; read in WP2.1).
  const plannedWithCrew = { ...missionPlan.agents[0]!, crewId: "crew-child" };
  assert.deepEqual(hubPlannedAgentSchema.parse(plannedWithCrew), plannedWithCrew);

  // HubMission gains optional `parentMissionId` + `depth` (present on a nested mission, absent on root).
  const childMission: HubMission = {
    id: "mis-2",
    sessionId: "sess-parent",
    status: "running",
    topology: "parallel",
    autonomy: "always_ask",
    plan: missionPlan,
    agentSessionIds: ["s1"],
    createdAt: "2026-07-26T00:00:00.000Z",
    updatedAt: "2026-07-26T00:00:00.000Z",
    parentMissionId: "mis-1",
    depth: 1,
  };
  const parsedMission = hubMissionSchema.parse(childMission);
  assert.equal(parsedMission.parentMissionId, "mis-1");
  assert.equal(parsedMission.depth, 1);
  assert.deepEqual(parsedMission, childMission);

  // HubCrew gains the computed-on-read counts on the READ shape (the `ServerType.memberCount` precedent).
  const crewWithCounts: HubCrew = {
    id: "crew-1",
    name: "Nested crew",
    topology: "pipeline",
    members: [{ agentId: "role-1" }, { crewId: "crew-child" }],
    createdAt: "t",
    updatedAt: "t",
    memberCrewIds: ["crew-child"],
    memberAgentCount: 1,
    memberCrewCount: 1,
    totalAgentCount: 4,
  };
  assert.deepEqual(hubCrewSchema.parse(crewWithCounts), crewWithCounts);
  // The counts are READ-only — the strict input shape rejects them (they're never on the write wire).
  assert.equal(
    hubCrewInputSchema.safeParse({
      name: "C",
      topology: "pipeline",
      members: [{ agentId: "role-1" }],
      totalAgentCount: 4,
    }).success,
    false,
  );

  // The two aggregate-bound caps ship with their D-CN10 defaults.
  assert.equal(HUB_MISSION_MAX_DEPTH, 2);
  assert.equal(HUB_MISSION_MAX_TOTAL_AGENTS, 24);
});

// ── Artifacts, reviews, files, memory ──────────────────────────────────────────────────────────────
test("artifact/review/file/memory schemas round-trip + reject bad enums", () => {
  assert.doesNotThrow(() =>
    hubArtifactSchema.parse({
      id: "art-1",
      kind: "markdown",
      title: "Notes",
      latestVersion: 2,
      currentVersionId: "v2",
      createdAt: "t",
      updatedAt: "t",
    }),
  );
  assert.equal(
    hubArtifactSchema.safeParse({
      id: "a",
      kind: "pdf",
      title: "x",
      latestVersion: 1,
      createdAt: "t",
      updatedAt: "t",
    }).success,
    false,
  );
  for (const kind of HUB_ARTIFACT_KINDS) {
    assert.doesNotThrow(() =>
      hubArtifactVersionSchema.parse({
        id: "v1",
        artifactId: "art-1",
        version: 1,
        content: `x:${kind}`,
        authorKind: "assistant",
        createdAt: "t",
      }),
    );
  }

  assert.doesNotThrow(() =>
    hubReviewSchema.parse({
      id: "rev-1",
      artifactId: "art-1",
      baseVersion: 1,
      status: "open",
      reviewerKind: "agent",
      comments: [
        {
          id: "cm-1",
          anchor: { quote: "foo", startOffset: 0, endOffset: 3 },
          body: "reword",
          suggestedEdit: "bar",
          decision: "pending",
          authorKind: "agent",
          createdAt: "t",
        },
      ],
      createdAt: "t",
      updatedAt: "t",
    }),
  );

  // WP3.5 — the `PATCH /api/hub/reviews/:id` response envelope: `resultingVersion` is present only
  // when the decision just applied produced a new immutable artifact version.
  const sampleReview = {
    id: "rev-1",
    artifactId: "art-1",
    baseVersion: 1,
    status: "open" as const,
    reviewerKind: "agent" as const,
    comments: [],
    createdAt: "t",
    updatedAt: "t",
  };
  assert.doesNotThrow(() => hubReviewDecisionResultSchema.parse({ review: sampleReview }));
  assert.doesNotThrow(() =>
    hubReviewDecisionResultSchema.parse({
      review: sampleReview,
      resultingVersion: {
        id: "v2",
        artifactId: "art-1",
        version: 2,
        content: "patched",
        authorKind: "agent",
        createdAt: "t",
      },
    }),
  );

  assert.doesNotThrow(() =>
    hubFileSchema.parse({ id: "f1", sha256: "abc", mime: "text/plain", bytes: 10, createdAt: "t" }),
  );
  assert.doesNotThrow(() =>
    hubFileLinkSchema.parse({
      id: "l1",
      fileId: "f1",
      role: "pinned",
      targetKind: "session",
      targetId: "sess-1",
      createdAt: "t",
    }),
  );
  assert.equal(
    hubFileLinkSchema.safeParse({
      id: "l",
      fileId: "f",
      role: "attached",
      targetKind: "session",
      targetId: "s",
      createdAt: "t",
    }).success,
    false,
  );

  for (const kind of HUB_MEMORY_KINDS) {
    assert.doesNotThrow(() =>
      hubMemorySchema.parse({
        id: "mem-1",
        kind,
        content: "x",
        source: "user",
        status: "active",
        createdAt: "t",
        updatedAt: "t",
      }),
    );
  }
  assert.doesNotThrow(() =>
    hubMemoryInputSchema.parse({ kind: "instruction", content: "Always cite" }),
  );
  assert.equal(
    hubMemoryInputSchema.safeParse({ kind: "instruction", content: "   " }).success,
    false,
  );
});

// ── Sessions — the Unified-Sessions lifecycle is REUSED, not forked ─────────────────────────────────
test("hubSessionSchema accepts a full session reusing RunStatus/RunPhase/StopReasonCode/SessionCapabilities", () => {
  const session: HubSession = {
    id: "sess-1",
    projectId: "proj-1",
    kind: "chat",
    parentSessionId: null,
    missionId: null,
    title: "Untitled",
    titleState: "pending",
    mode: "mission",
    topology: "parallel",
    autonomy: "threshold",
    crewId: null,
    model: "claude-opus-4",
    status: "running", // RUN_STATUSES member
    phase: "waiting_input", // RUN_PHASES member
    stopReasonCode: undefined,
    capabilities: {
      liveText: true,
      liveReasoning: "raw",
      toolCalls: true,
      contextWindow: true,
      tokens: "exact",
      costBasis: "api_exact",
      followUps: true,
      askUser: false,
    },
    budgets: { maxCostUsd: 2 },
    promptVersion: "hub-1",
    costUsd: 0.12,
    tokensIn: 1000,
    tokensOut: 500,
    activeDurationMs: 5000,
    totalDurationMs: 8000,
    waitDeadlineAt: "2026-07-17T00:10:00.000Z",
    createdAt: "2026-07-17T00:00:00.000Z",
    updatedAt: "2026-07-17T00:00:00.000Z",
    endedAt: null,
    seen: false,
  };
  assert.doesNotThrow(() => hubSessionSchema.parse(session));

  // Every RunStatus / RunPhase / StopReasonCode value is accepted (contract reused, not re-listed).
  for (const status of RUN_STATUSES) {
    assert.doesNotThrow(() => hubSessionSchema.parse({ ...session, status }));
  }
  for (const phase of [...RUN_PHASES, null] as const) {
    assert.doesNotThrow(() => hubSessionSchema.parse({ ...session, phase }));
  }
  for (const stopReasonCode of STOP_REASON_CODES) {
    assert.doesNotThrow(() => hubSessionSchema.parse({ ...session, stopReasonCode }));
  }
  // An out-of-union status is rejected.
  assert.equal(hubSessionSchema.safeParse({ ...session, status: "frozen" }).success, false);

  // Session-create input covers every mode + is strict.
  for (const mode of HUB_SESSION_MODES) {
    assert.doesNotThrow(() => hubSessionCreateInputSchema.parse({ mode, model: "m" }));
  }
  for (const topology of HUB_TOPOLOGIES) {
    assert.doesNotThrow(() =>
      hubSessionCreateInputSchema.parse({
        mode: "mission",
        model: "m",
        topology,
        autonomy: "auto",
      }),
    );
  }
  assert.equal(hubSessionCreateInputSchema.safeParse({ mode: "quick", model: "m" }).success, false);
  assert.equal(
    hubSessionCreateInputSchema.safeParse({ mode: "chat", model: "m", extra: 1 }).success,
    false,
  );
});

test("kind/autonomy/mission-status vocabularies are what the plan locked", () => {
  assert.deepEqual([...HUB_SESSION_KINDS], ["chat", "agent"]);
  assert.deepEqual([...HUB_AUTONOMY_LEVELS], ["always_ask", "threshold", "auto"]);
  assert.deepEqual(
    [...HUB_MISSION_STATUSES],
    ["proposed", "approved", "running", "synthesizing", "completed", "stopped", "failed"],
  );
  assert.deepEqual([...HUB_APPROVAL_OPTION_KINDS], ["allow-once", "always"]);
  assert.deepEqual([...HUB_APPROVAL_RESOLUTIONS], ["allow-once", "always", "deny"]);
});

// ── Replay: a session + its full event log reconstruct through the wire (R-SES1) ───────────────────
test("hubSessionDetailSchema round-trips a session + heterogeneous event log + mission", () => {
  const detail = {
    session: {
      id: "sess-1",
      kind: "chat" as const,
      title: "T",
      titleState: "auto" as const,
      mode: "chat" as const,
      model: "m",
      status: "completed" as const,
      costUsd: 0,
      tokensIn: 0,
      tokensOut: 0,
      createdAt: "t",
      updatedAt: "t",
      seen: true,
    },
    events: [
      { type: "user_message", messageId: "m1", text: "hi", seq: 0 },
      {
        type: "assistant_message",
        messageId: "m2",
        model: "m",
        parts: [{ type: "text", text: "hello [1]" }],
        citations: [citation],
        artifactsTouched: [],
        seq: 1,
      },
      { type: "turn_done", seq: 2 },
    ],
  };
  assert.doesNotThrow(() => hubSessionDetailSchema.parse(detail));
});

// ── Project input strictness ───────────────────────────────────────────────────────────────────────
test("hubProjectInputSchema requires a non-empty name and rejects unknown keys", () => {
  assert.doesNotThrow(() => hubProjectInputSchema.parse({ name: "My project", instructions: "…" }));
  assert.equal(hubProjectInputSchema.safeParse({ name: "" }).success, false);
  assert.equal(hubProjectInputSchema.safeParse({ name: "x", nope: 1 }).success, false);
});

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// Assistant Hub UX (roadmap/assistant-hub-ux/, WP0.1) — additive extensions (D-HUX8/10/11/16, P2/P4).
// The bar (WP0.1 acceptance): every new field is optional/additive and OLD payloads (which never
// carried them) still parse. Each block below proves both — the new shape parses AND the pre-extension
// shape parses unchanged.
// ══════════════════════════════════════════════════════════════════════════════════════════════════

// ── New closed vocabularies are what the plan locked + round-trip + reject bad ──────────────────────
test("HUB memory-scope / crew-color / usage-group-by vocabularies are what D-HUX8/10/11 locked", () => {
  assert.deepEqual([...HUB_MEMORY_SCOPES], ["profile", "project", "agent", "crew"]);
  assert.deepEqual(
    [...HUB_CREW_COLORS],
    ["chart-1", "chart-2", "chart-3", "chart-4", "chart-5"],
  );
  assert.deepEqual([...HUB_USAGE_GROUP_BYS], ["agent", "crew", "model", "project", "mode"]);
  for (const s of HUB_MEMORY_SCOPES) assert.equal(hubMemoryScopeSchema.parse(s), s);
  for (const c of HUB_CREW_COLORS) assert.equal(hubCrewColorSchema.parse(c), c);
  for (const g of HUB_USAGE_GROUP_BYS) assert.equal(hubUsageGroupBySchema.parse(g), g);
  assert.equal(hubMemoryScopeSchema.safeParse("global").success, false);
  assert.equal(hubCrewColorSchema.safeParse("chart-6").success, false);
  // D-HUX8: a crew color is a chart TOKEN, never a raw color literal — a hex/name value is rejected.
  assert.equal(hubCrewColorSchema.safeParse("crimson").success, false);
  assert.equal(hubUsageGroupBySchema.safeParse("provider").success, false);
});

// ── Memory scope (D-HUX11) — additive `scope`/`scopeId`; the pre-scope payload still parses ─────────
test("hubMemory: an OLD (un-scoped) payload still parses; a scoped one parses; a bad scope is rejected", () => {
  // Backward-compat: the exact pre-WP0.1 memory payload (no scope/scopeId) must still parse.
  const legacyMemory = {
    id: "mem-1",
    kind: "preference",
    content: "Prefers concise answers",
    source: "user",
    status: "active",
    createdAt: "t",
    updatedAt: "t",
  };
  assert.doesNotThrow(() => hubMemorySchema.parse(legacyMemory));

  // Every scope parses on the read shape (scopeId null for profile, set for a scoped owner).
  for (const scope of HUB_MEMORY_SCOPES) {
    const scoped: HubMemory = {
      ...(legacyMemory as HubMemory),
      scope,
      scopeId: scope === "profile" ? null : `${scope}-1`,
    };
    assert.doesNotThrow(() => hubMemorySchema.parse(scoped));
  }
  assert.equal(hubMemorySchema.safeParse({ ...legacyMemory, scope: "team" }).success, false);

  // Input: still accepts the old body (scope omitted → API defaults to profile), and a scoped body.
  assert.doesNotThrow(() => hubMemoryInputSchema.parse({ kind: "instruction", content: "Always cite" }));
  assert.doesNotThrow(() =>
    hubMemoryInputSchema.parse({
      kind: "instruction",
      content: "Prefer SQL",
      scope: "project",
      scopeId: "proj-1",
    }),
  );
  // Input is still strict — an unknown key is still rejected alongside the new ones.
  assert.equal(
    hubMemoryInputSchema.safeParse({ kind: "profile", content: "x", surprise: true }).success,
    false,
  );

  // The memory events carry the proposal scope (WP1.5 populates it; shared is frozen after WP0.1).
  assert.doesNotThrow(() =>
    hubEventSchema.parse({
      type: "memory_proposed",
      kind: "preference",
      content: "Prefers concise answers",
      scope: "agent",
      scopeId: "role-1",
      seq: 0,
    } satisfies HubEvent),
  );
  assert.doesNotThrow(() =>
    hubEventSchema.parse({
      type: "memory_saved",
      memoryId: "mem-1",
      kind: "preference",
      content: "x",
      source: "assistant_proposed",
      scope: "profile",
      scopeId: null,
      seq: 1,
    } satisfies HubEvent),
  );
  // Backward-compat: a memory event WITHOUT the scope fields still parses (pre-WP0.1 shape).
  assert.doesNotThrow(() =>
    hubEventSchema.parse({ type: "memory_proposed", kind: "preference", content: "x", seq: 2 }),
  );
});

// ── Memory patch scope (WP2.7, D-HUX11) — the save-proposal scope picker's "move on accept" ──────────
test("hubMemoryPatch: an OLD (content/status-only) patch still parses; a scoped patch parses; unknown keys are rejected", () => {
  assert.doesNotThrow(() => hubMemoryPatchSchema.parse({ status: "active" }));
  assert.doesNotThrow(() => hubMemoryPatchSchema.parse({ content: "Prefers bullet points." }));
  assert.doesNotThrow(() =>
    hubMemoryPatchSchema.parse({ status: "active", scope: "project", scopeId: "proj-1" }),
  );
  assert.doesNotThrow(() => hubMemoryPatchSchema.parse({ scope: "profile" }));
  assert.equal(hubMemoryPatchSchema.safeParse({ scope: "team" }).success, false);
  assert.equal(hubMemoryPatchSchema.safeParse({ status: "active", surprise: true }).success, false);
});

// ── Effective memory (WP1.5 → WP2.7 promotion, D-HUX11) — the resolved profile→project→crew→agent
// stack, now typed in `shared` instead of local to `apps/api` ─────────────────────────────────────────
test("hubEffectiveMemory*: a resolved stack (entries + overridden + layers) round-trips through every schema", () => {
  const entry = {
    id: "mem-1",
    kind: "instruction",
    content: "Ship on Fridays.",
    source: "user",
    status: "active",
    scope: "project",
    scopeId: "proj-1",
    ownerName: "Demo Project",
    createdAt: "t1",
    updatedAt: "t1",
  };
  assert.doesNotThrow(() => hubEffectiveMemoryEntrySchema.parse(entry));

  const override = { ...entry, id: "mem-0", overriddenByScope: "project", overriddenById: "mem-1" };
  assert.doesNotThrow(() => hubEffectiveMemoryOverrideSchema.parse(override));

  const layer = {
    scope: "project",
    scopeId: "proj-1",
    ownerName: "Demo Project",
    activeCount: 1,
    overriddenCount: 1,
  };
  assert.doesNotThrow(() => hubEffectiveMemoryLayerSummarySchema.parse(layer));

  const stack: HubEffectiveMemory = {
    order: ["profile", "project"],
    entries: [entry as HubEffectiveMemory["entries"][number]],
    overridden: [override as HubEffectiveMemory["overridden"][number]],
    layers: [layer as HubEffectiveMemory["layers"][number]],
    totalActive: 1,
  };
  assert.doesNotThrow(() => hubEffectiveMemorySchema.parse(stack));

  // A profile-only stack (no owner, `scopeId: null`) — the common case for most sessions.
  const profileOnly: HubEffectiveMemory = {
    order: ["profile"],
    entries: [
      {
        id: "mem-2",
        kind: "preference",
        content: "Prefers concise answers.",
        source: "user",
        status: "active",
        scope: "profile",
        scopeId: null,
        createdAt: "t1",
        updatedAt: "t1",
      },
    ],
    overridden: [],
    layers: [{ scope: "profile", scopeId: null, activeCount: 1, overriddenCount: 0 }],
    totalActive: 1,
  };
  assert.doesNotThrow(() => hubEffectiveMemorySchema.parse(profileOnly));

  // A bad scope inside a nested entry is rejected.
  assert.equal(
    hubEffectiveMemorySchema.safeParse({ ...profileOnly, order: ["team"] }).success,
    false,
  );
});

// ── Agent identity (D-HUX8, P2) — additive `displayName`; avatar reuses `icon`, no new field ────────
test("hubAgentRole: an OLD payload (no displayName) still parses; displayName parses on read/input/patch", () => {
  const legacyRole = {
    id: "role-1",
    name: "Researcher",
    systemPrompt: "You research.",
    defaultModel: "claude-opus-4",
    toolGrants: grants,
    skills: [],
    target: "Find evidence",
    expectedOutcome: "A report",
    createdAt: "t",
    updatedAt: "t",
  };
  assert.doesNotThrow(() => hubAgentRoleSchema.parse(legacyRole)); // pre-WP0.1 shape

  const withPersona: HubAgentRole = {
    ...(legacyRole as HubAgentRole),
    displayName: "Ada",
    icon: "flask", // P2: avatar reuses the existing icon field — there is NO avatar wire field
  };
  assert.doesNotThrow(() => hubAgentRoleSchema.parse(withPersona));

  assert.doesNotThrow(() =>
    hubAgentRoleInputSchema.parse({
      name: "Researcher",
      displayName: "Ada",
      systemPrompt: "p",
      defaultModel: "m",
      target: "t",
      expectedOutcome: "o",
    }),
  );
  // Patch: set a persona name, and clear it back to the title fallback with null.
  assert.doesNotThrow(() => hubAgentRolePatchSchema.parse({ displayName: "Ada" }));
  assert.doesNotThrow(() => hubAgentRolePatchSchema.parse({ displayName: null }));
  // Still strict — an avatar-ish key is rejected (P2: no avatar field was added).
  assert.equal(hubAgentRoleInputSchema.safeParse({ name: "R", systemPrompt: "p", defaultModel: "m", target: "t", expectedOutcome: "o", avatar: "x" }).success, false);
});

// ── Crew color (D-HUX8) — additive `color`; the pre-color payload still parses ──────────────────────
test("hubCrew: an OLD payload (no color) still parses; color parses on read/input; patch clears with null", () => {
  const legacyCrew = {
    id: "crew-1",
    name: "Research crew",
    topology: "pipeline" as const,
    members: [{ agentId: "role-1" }],
    createdAt: "t",
    updatedAt: "t",
  };
  assert.doesNotThrow(() => hubCrewSchema.parse(legacyCrew)); // pre-WP0.1 shape

  const tinted: HubCrew = { ...(legacyCrew as HubCrew), color: "chart-3" };
  assert.doesNotThrow(() => hubCrewSchema.parse(tinted));
  assert.doesNotThrow(() =>
    hubCrewInputSchema.parse({ name: "C", color: "chart-1", topology: "debate", members: [] }),
  );
  assert.equal(
    hubCrewInputSchema.safeParse({ name: "C", color: "purple", topology: "debate", members: [] })
      .success,
    false,
  );
  // Patch: set a color, and clear it back to no-accent with null.
  assert.doesNotThrow(() => hubCrewPatchSchema.parse({ color: "chart-5" }));
  assert.doesNotThrow(() => hubCrewPatchSchema.parse({ color: null }));
});

// ── Session stats + archive (D-HUX4, P4) — additive; the pre-extension session still parses ─────────
test("hubSession: an OLD payload (no turns/lastError/archived) still parses; the new stat fields parse", () => {
  // Backward-compat: the minimal pre-WP0.1 session (no stat fields) still parses.
  const legacySession = {
    id: "sess-1",
    kind: "chat" as const,
    title: "T",
    titleState: "auto" as const,
    mode: "chat" as const,
    model: "m",
    status: "completed" as const,
    costUsd: 0,
    tokensIn: 0,
    tokensOut: 0,
    createdAt: "t",
    updatedAt: "t",
    seen: true,
  };
  assert.doesNotThrow(() => hubSessionSchema.parse(legacySession));

  const withStats: HubSession = {
    ...(legacySession as HubSession),
    turns: 7,
    lastError: "provider timeout",
    archived: false,
  };
  assert.doesNotThrow(() => hubSessionSchema.parse(withStats));
  // lastError is nullable ("no error"); archived defaults absent.
  assert.doesNotThrow(() => hubSessionSchema.parse({ ...legacySession, lastError: null, turns: 0 }));

  // Patch gains `archived` (archive/unarchive), still strict.
  assert.doesNotThrow(() => hubSessionPatchSchema.parse({ archived: true }));
  assert.doesNotThrow(() => hubSessionPatchSchema.parse({ archived: false, title: "renamed" }));
  assert.equal(hubSessionPatchSchema.safeParse({ archived: true, nope: 1 }).success, false);
});

// ── Usage group-by rows + per-entity summaries (D-HUX10) — incl. the explicit "no agent" bucket ─────
test("hubUsageRow: a grouped row parses, including the null-key unattributed 'no agent' bucket", () => {
  const agentRow: HubUsageRow = {
    groupBy: "agent",
    key: "role-1",
    label: "Ada",
    sessions: 4,
    costUsd: 1.25,
    tokensIn: 10_000,
    tokensOut: 4_000,
  };
  assert.doesNotThrow(() => hubUsageRowSchema.parse(agentRow));

  // The explicit unattributed bucket: null key + `unattributed: true` (never a silently short total).
  const unattributed: HubUsageRow = {
    groupBy: "agent",
    key: null,
    label: "No agent",
    unattributed: true,
    sessions: 2,
    costUsd: 0.3,
    tokensIn: 900,
    tokensOut: 200,
  };
  assert.doesNotThrow(() => hubUsageRowSchema.parse(unattributed));
  // A bad group-by dimension is rejected.
  assert.equal(hubUsageRowSchema.safeParse({ ...agentRow, groupBy: "provider" }).success, false);
});

test("hubUsageSummary: a per-entity summary parses with totals + a daily strip", () => {
  const summary: HubUsageSummary = {
    groupBy: "crew",
    id: "crew-1",
    label: "Research crew",
    totals: { sessions: 12, costUsd: 3.4, tokensIn: 50_000, tokensOut: 20_000 },
    strip: [
      { key: "2026-07-16", label: "2026-07-16", sessions: 0, costUsd: 0, tokensIn: 0, tokensOut: 0 },
      { key: "2026-07-17", label: "2026-07-17", sessions: 3, costUsd: 1.1, tokensIn: 12_000, tokensOut: 5_000 },
    ],
  };
  assert.doesNotThrow(() => hubUsageSummarySchema.parse(summary));
  assert.equal(hubUsageSummarySchema.safeParse({ ...summary, groupBy: "mode-x" }).success, false);
});
