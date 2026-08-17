// Assistant Hub — the full session-log export (JSON + Markdown). Proves the builders render EVERY event
// in order (every input and output — the append-only log IS the transcript), the JSON carries the raw
// log verbatim, and the Markdown renders the conversational spine richly while never silently dropping a
// structural event. Pure functions — no DB, no model.

import assert from "node:assert/strict";
import { test } from "node:test";
import type { HubEvent, HubSession } from "@mcp-token-footprint/shared";
import {
  buildHubSessionJsonReport,
  buildHubSessionMarkdownReport,
} from "../src/hub/session-report.js";

const NOW = "2026-07-20T00:00:00.000Z";

function session(): HubSession {
  return {
    id: "sess-1",
    kind: "chat",
    title: "Top RMs in 2026",
    titleState: "final",
    mode: "auto",
    model: "acme-answers:fast",
    status: "completed",
    costUsd: 0.0123,
    tokensIn: 100,
    tokensOut: 42,
    createdAt: "2026-07-19T10:00:00.000Z",
    updatedAt: "2026-07-19T10:05:00.000Z",
  };
}

/** A representative spine: user → question → answer → assistant, plus one structural event. */
function events(): HubEvent[] {
  return [
    { type: "user_message", messageId: "m1", text: "who are my top 3 RMs?", seq: 1 },
    {
      type: "question",
      questionId: "q1",
      prompt: "Which app should I use?",
      options: [{ label: "MCP Sales", description: "the demo assistant" }, { label: "HSBC" }],
      allowOther: true,
      seq: 2,
    },
    { type: "question_resolved", questionId: "q1", answer: "MCP Sales", seq: 3 },
    {
      type: "assistant_message",
      messageId: "m2",
      model: "acme-answers:fast",
      parts: [{ type: "text", text: "Your top 3 RMs are A, B, C." }],
      citations: [],
      artifactsTouched: [],
      costUsd: 0.01,
      seq: 4,
    },
    { type: "turn_done", seq: 5 },
    // A structural event (not part of the spine) — must still appear, never silently dropped.
    { type: "memory_saved", memoryId: "mem-1", scope: "profile", content: "prefers metric units", seq: 6 },
  ] as HubEvent[];
}

test("JSON report carries the full ordered event log verbatim + session metadata", () => {
  const report = buildHubSessionJsonReport(session(), events(), NOW);
  assert.equal(report.kind, "hub_session_report");
  assert.equal(report.version, 1);
  assert.equal(report.generatedAt, NOW);
  assert.equal(report.eventCount, 6);
  assert.equal(report.events.length, 6);
  // Order preserved, nothing dropped.
  assert.deepEqual(
    report.events.map((e) => e.type),
    ["user_message", "question", "question_resolved", "assistant_message", "turn_done", "memory_saved"],
  );
  assert.equal(report.session.id, "sess-1");
});

test("Markdown report renders the spine in order + every structural event (nothing dropped)", () => {
  const md = buildHubSessionMarkdownReport(session(), events(), NOW);
  // Header metadata.
  assert.match(md, /# Assistant session transcript/);
  assert.match(md, /Top RMs in 2026/);
  assert.match(md, /acme-answers:fast/);
  // The conversational spine, in order.
  assert.match(md, /### 1 · User[\s\S]*who are my top 3 RMs\?/);
  assert.match(md, /### 2 · Question[\s\S]*Which app should I use\?/);
  assert.match(md, /- MCP Sales — the demo assistant/);
  assert.match(md, /### 3 · Answer[\s\S]*MCP Sales/);
  assert.match(md, /### 4 · Assistant[\s\S]*Your top 3 RMs are A, B, C\./);
  // The structural event is labeled + dumped, never omitted.
  assert.match(md, /### 6 · memory_saved/);
  assert.match(md, /prefers metric units/);
  // Ordering: user before question before answer before assistant.
  assert.ok(md.indexOf("### 1 · User") < md.indexOf("### 2 · Question"));
  assert.ok(md.indexOf("### 2 · Question") < md.indexOf("### 3 · Answer"));
  assert.ok(md.indexOf("### 3 · Answer") < md.indexOf("### 4 · Assistant"));
});

test("Markdown renders a null answer honestly (stopped without answering)", () => {
  const md = buildHubSessionMarkdownReport(session(), [
    { type: "question", questionId: "q1", prompt: "Pick one", seq: 1 },
    { type: "question_resolved", questionId: "q1", answer: null, seq: 2 },
  ] as HubEvent[], NOW);
  assert.match(md, /stopped without answering/);
});

// ── Crew nesting (WP3.2 · D-CN7) — the additive `## Mission trace` / `missionTraces` surface ──────────

/** A 2-level mission tree — `mission-1` (root, a leaf + a crew-ref slot) whose crew-ref expands into
 *  `mission-2` (the nested sub-mission) — layered onto the same representative spine `events()` uses. */
function missionEvents(): HubEvent[] {
  return [
    ...events(),
    {
      type: "plan_proposed",
      missionId: "mission-1",
      plan: {
        topology: "parallel",
        autonomy: "auto",
        agents: [
          {
            key: "l1",
            name: "Leaf One",
            systemPrompt: "You are l1.",
            model: "gpt-4o",
            toolGrants: { servers: {}, builtins: [] },
            skillIds: [],
            brief: "Do the work.",
            target: "Target l1",
            expectedOutcome: "A structured report.",
          },
          {
            key: "cc",
            name: "Child Crew",
            systemPrompt: "You are cc.",
            model: "gpt-4o",
            toolGrants: { servers: {}, builtins: [] },
            skillIds: [],
            brief: "Do the work.",
            target: "Target cc",
            expectedOutcome: "A structured report.",
            crewId: "crewC",
          },
        ],
      },
      seq: 7,
    },
    { type: "plan_approved", missionId: "mission-1", autonomy: "auto", auto: true, seq: 8 },
    { type: "mission_started", missionId: "mission-1", agentSessionIds: ["s-l1", "s-cc"], seq: 9 },
    { type: "agent_spawned", missionId: "mission-1", agentSessionId: "s-l1", key: "l1", roleName: "Leaf One", model: "gpt-4o", index: 0, seq: 10 },
    { type: "agent_spawned", missionId: "mission-1", agentSessionId: "s-cc", key: "cc", roleName: "Child Crew", model: "gpt-4o", index: 1, seq: 11 },
    {
      type: "agent_report",
      missionId: "mission-1",
      agentSessionId: "s-l1",
      report: { findings: [], citations: [], artifacts: [], confidence: "medium", openQuestions: [] },
      costUsd: 0.1,
      seq: 12,
    },
    {
      type: "plan_proposed",
      missionId: "mission-2",
      plan: {
        topology: "parallel",
        autonomy: "auto",
        agents: [
          {
            key: "m1",
            name: "Member One",
            systemPrompt: "You are m1.",
            model: "gpt-4o",
            toolGrants: { servers: {}, builtins: [] },
            skillIds: [],
            brief: "Do the work.",
            target: "Target m1",
            expectedOutcome: "A structured report.",
          },
        ],
      },
      parentMissionId: "mission-1",
      parentAgentKey: "cc",
      seq: 13,
    },
    { type: "mission_started", missionId: "mission-2", agentSessionIds: ["s-m1"], seq: 14 },
    {
      type: "agent_spawned",
      missionId: "mission-2",
      agentSessionId: "s-m1",
      key: "m1",
      roleName: "Member One",
      model: "gpt-4o",
      index: 0,
      parentMissionId: "mission-1",
      parentAgentKey: "cc",
      seq: 15,
    },
    {
      type: "agent_report",
      missionId: "mission-2",
      agentSessionId: "s-m1",
      report: { findings: [], citations: [], artifacts: [], confidence: "medium", openQuestions: [] },
      costUsd: 0.2,
      seq: 16,
    },
    {
      type: "mission_synthesis",
      missionId: "mission-2",
      messageId: "msg-sub",
      partial: false,
      agentReportRefs: ["s-m1"],
      seq: 17,
    },
    {
      type: "agent_report",
      missionId: "mission-1",
      agentSessionId: "s-cc",
      report: { findings: [], citations: [], artifacts: [], confidence: "medium", openQuestions: [], subMissionId: "mission-2" },
      costUsd: 0.77,
      seq: 18,
    },
    {
      type: "mission_synthesis",
      missionId: "mission-1",
      messageId: "msg-root",
      partial: false,
      agentReportRefs: ["s-l1", "s-cc"],
      seq: 19,
    },
  ] as HubEvent[];
}

test("JSON report carries the nested missionTraces forest; version stays 1", () => {
  const report = buildHubSessionJsonReport(session(), missionEvents(), NOW);
  assert.equal(report.version, 1, "version stays 1 — an additive optional field, not a breaking change");
  assert.ok(report.missionTraces, "a mission-bearing session's JSON carries missionTraces");
  assert.equal(report.missionTraces!.length, 1);
  assert.equal(report.missionTraces![0]!.missionId, "mission-1");
  assert.equal(report.missionTraces![0]!.children.length, 1);
  assert.equal(
    report.missionTraces![0]!.children[0]!.missionId,
    "mission-2",
    "the nested sub-mission appears as the root's child",
  );
  // Every PRE-EXISTING assertion above (unmodified) still passing proves the event log itself renders
  // exactly as before — this is purely additive.
});

test("Markdown report carries a ## Mission trace section with mission-2 nested deeper than mission-1", () => {
  const md = buildHubSessionMarkdownReport(session(), missionEvents(), NOW);
  assert.match(md, /## Mission trace/);
  // The section renders BEFORE the transcript.
  assert.ok(md.indexOf("## Mission trace") < md.indexOf("## Transcript"));
  assert.match(md, /Mission `mission-1`/);
  assert.match(md, /Mission `mission-2`/);
  assert.ok(
    md.indexOf("Mission `mission-1`") < md.indexOf("Mission `mission-2`"),
    "the root renders before its nested child",
  );
  // mission-2's block is indented DEEPER (2 extra leading spaces) than mission-1's own bullet line.
  const rootLine = md.split("\n").find((line) => line.includes("Mission `mission-1`"))!;
  const childLine = md.split("\n").find((line) => line.includes("Mission `mission-2`"))!;
  const rootIndent = rootLine.match(/^\s*/)![0].length;
  const childIndent = childLine.match(/^\s*/)![0].length;
  assert.ok(
    childIndent > rootIndent,
    `mission-2's line (indent ${childIndent}) must be indented deeper than mission-1's (indent ${rootIndent})`,
  );
});

test("a session with no mission at all: missionTraces is absent and no ## Mission trace heading appears", () => {
  const report = buildHubSessionJsonReport(session(), events(), NOW);
  assert.equal(report.missionTraces, undefined, "no mission -> missionTraces is absent, not an empty array");
  const md = buildHubSessionMarkdownReport(session(), events(), NOW);
  assert.doesNotMatch(md, /## Mission trace/);
});
