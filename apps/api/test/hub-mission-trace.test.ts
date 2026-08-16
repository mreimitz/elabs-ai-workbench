// Crew nesting (roadmap/crew-nesting/, WP3.2 · D-CN7, R-SES1) — the hub RUN-REPORT's hierarchical
// execution trace. These tests build raw `hub_events` BY HAND (no service, no DB, no provider, no MCP)
// and feed them straight to the pure `buildMissionTraceForest`, asserting:
//   • a 2-level tree groups into ONE root node whose `children` holds the nested sub-mission at depth 1;
//   • per-level rollup is a MONOTONE sum — a node's rollup = its own leaf agents' totals PLUS the
//     recursive sum of every child's rollup (cost AND tokens, not just a smoke check);
//   • `durationMs` derives from `mission_started.at` -> the terminal `mission_synthesis.at`, and is
//     ABSENT (never fabricated) when the mission never started;
//   • a FLAT (un-nested) mission — today's only shape — collapses to exactly ONE root node with
//     `children: []` (the legacy-render regression lock);
//   • a session with no mission at all yields an EMPTY forest.

import assert from "node:assert/strict";
import { test } from "node:test";
import type {
  HubAgentReport,
  HubEvent,
  HubMissionPlan,
  HubPlannedAgent,
  HubToolGrants,
  HubTopology,
} from "@mcp-token-footprint/shared";
import { buildMissionTraceForest } from "../src/hub/mission-trace.js";

// ── minimal, self-contained builders (mirrors hub-crew-nesting-board-replay.test.ts's fixtures) ───────

const EMPTY_GRANTS: HubToolGrants = { servers: {}, builtins: [] };

function plannedAgent(over: Partial<HubPlannedAgent> & { key: string }): HubPlannedAgent {
  return {
    name: over.name ?? over.key,
    systemPrompt: `You are ${over.key}.`,
    model: "gpt-4o",
    toolGrants: EMPTY_GRANTS,
    skillIds: [],
    brief: `Do the work for ${over.key}.`,
    target: `Target ${over.key}`,
    expectedOutcome: "A structured report.",
    ...over,
  };
}

function plan(agents: HubPlannedAgent[], topology: HubTopology = "parallel"): HubMissionPlan {
  return { topology, autonomy: "auto", agents };
}

function report(over: Partial<HubAgentReport> = {}): HubAgentReport {
  return {
    findings: [{ summary: "A finding." }],
    citations: [],
    artifacts: [],
    confidence: "medium",
    openQuestions: [],
    ...over,
  };
}

const ROOT = "mission-1";
const SUB = "mission-2";
const L1 = "s-l1"; // root leaf session
const CC = "s-cc"; // root crew-node CONTAINER session
const M1 = "s-m1"; // sub-mission member 1 session
const M2 = "s-m2"; // sub-mission member 2 session

/** The canonical 2-level tree: root has a leaf + a crew-ref slot ("cc") that expands into `SUB`. Carries
 *  `.at` timestamps on the root's `mission_started`/`mission_synthesis` so duration derivation is testable. */
function twoLevelTree(): HubEvent[] {
  const rootPlan = plan([
    plannedAgent({ key: "l1", name: "Leaf One" }),
    plannedAgent({ key: "cc", name: "Child Crew", crewId: "crewC" }),
  ]);
  const subPlan = plan([
    plannedAgent({ key: "m1", name: "Member One" }),
    plannedAgent({ key: "m2", name: "Member Two" }),
  ]);
  return [
    { type: "plan_proposed", missionId: ROOT, plan: rootPlan },
    { type: "plan_approved", missionId: ROOT, autonomy: "auto", auto: true },
    { type: "mission_started", missionId: ROOT, agentSessionIds: [L1, CC], at: "2026-07-27T10:00:00.000Z" },
    { type: "agent_spawned", missionId: ROOT, agentSessionId: L1, key: "l1", roleName: "Leaf One", model: "gpt-4o", index: 0 },
    { type: "agent_spawned", missionId: ROOT, agentSessionId: CC, key: "cc", roleName: "Child Crew", model: "gpt-4o", index: 1 },
    {
      type: "agent_report",
      missionId: ROOT,
      agentSessionId: L1,
      report: report({ summary: "L1" }),
      costUsd: 0.1,
      tokensIn: 100,
      tokensOut: 20,
    },
    // The crew-ref expands into its own sub-mission — a LATER `plan_proposed` carrying parent-linkage.
    { type: "plan_proposed", missionId: SUB, plan: subPlan, parentMissionId: ROOT, parentAgentKey: "cc" },
    { type: "mission_started", missionId: SUB, agentSessionIds: [M1, M2] },
    {
      type: "agent_spawned",
      missionId: SUB,
      agentSessionId: M1,
      key: "m1",
      roleName: "Member One",
      model: "gpt-4o",
      index: 0,
      parentMissionId: ROOT,
      parentAgentKey: "cc",
    },
    {
      type: "agent_spawned",
      missionId: SUB,
      agentSessionId: M2,
      key: "m2",
      roleName: "Member Two",
      model: "gpt-4o",
      index: 1,
      parentMissionId: ROOT,
      parentAgentKey: "cc",
    },
    {
      type: "agent_report",
      missionId: SUB,
      agentSessionId: M1,
      report: report({ summary: "M1" }),
      costUsd: 0.2,
      tokensIn: 200,
      tokensOut: 40,
    },
    {
      type: "agent_report",
      missionId: SUB,
      agentSessionId: M2,
      report: report({ summary: "M2" }),
      costUsd: 0.3,
      tokensIn: 300,
      tokensOut: 60,
    },
    { type: "mission_synthesis", missionId: SUB, messageId: "msg-sub", partial: false, agentReportRefs: [M1, M2] },
    // The crew node's PROJECTED report on the ROOT log — a DISTINCT 0.77/999/999 (not the real 0.50
    // subtotal) so the rollup test proves the reducer/rollup ignores it and sums the CHILDREN instead.
    {
      type: "agent_report",
      missionId: ROOT,
      agentSessionId: CC,
      report: report({ summary: "Sub-crew rollup", subMissionId: SUB }),
      costUsd: 0.77,
      tokensIn: 999,
      tokensOut: 999,
    },
    {
      type: "mission_synthesis",
      missionId: ROOT,
      messageId: "msg-root",
      partial: false,
      agentReportRefs: [L1, CC],
      at: "2026-07-27T10:05:00.000Z",
    },
  ];
}

// ── (1) nested-tree grouping ─────────────────────────────────────────────────────────────────────────

test("a 2-level tree groups into one root node whose children holds the nested sub-mission at depth 1", () => {
  const forest = buildMissionTraceForest(twoLevelTree());
  assert.equal(forest.length, 1, "exactly one root tree");
  const root = forest[0]!;
  assert.equal(root.missionId, ROOT);
  assert.equal(root.depth, 0);
  assert.equal(root.topology, "parallel");
  assert.equal(root.phase, "done");
  assert.equal(root.roleName, undefined, "the root has no parent slot, so no roleName");

  assert.equal(root.children.length, 1, "the crew-ref slot expanded into exactly one child mission");
  const child = root.children[0]!;
  assert.equal(child.missionId, SUB);
  assert.equal(child.depth, 1);
  assert.equal(child.roleName, "Child Crew", "the child is labeled by its slot's roleName in the parent's plan");
  assert.equal(child.children.length, 0, "the sub-mission itself has no further nested crew");

  // The root's own `agents` is LEAF-ONLY — the crew-node "cc" is represented by `children[0]` instead.
  assert.deepEqual(
    root.agents.map((a) => a.key),
    ["l1"],
    "the crew-node agent is excluded from `agents` (it is represented as a child mission node)",
  );
  assert.deepEqual(child.agents.map((a) => a.key), ["m1", "m2"]);
});

// ── (2) per-level rollup is a MONOTONE sum (cost AND tokens) ────────────────────────────────────────────

test("rollup = this level's own agents PLUS the recursive sum of every child's rollup (monotone, not a smoke check)", () => {
  const forest = buildMissionTraceForest(twoLevelTree());
  const root = forest[0]!;
  const child = root.children[0]!;

  // The child's rollup = its own two leaf members (0.2+0.3 cost, 200+300 tokensIn, 40+60 tokensOut).
  assert.ok(Math.abs(child.rollup.costUsd - 0.5) < 1e-9, `child rollup cost = 0.50 (got ${child.rollup.costUsd})`);
  assert.equal(child.rollup.tokensIn, 500);
  assert.equal(child.rollup.tokensOut, 100);

  // The root's rollup = its own leaf (l1: 0.1/100/20) PLUS the child's rollup (0.5/500/100) = 0.6/600/120.
  // NOT the crew node's projected 0.77/999/999, and NOT a double-count (1.27/1099/1099).
  assert.ok(Math.abs(root.rollup.costUsd - 0.6) < 1e-9, `root rollup cost = 0.60 (got ${root.rollup.costUsd})`);
  assert.equal(root.rollup.tokensIn, 600, `root rollup tokensIn = 600 (got ${root.rollup.tokensIn})`);
  assert.equal(root.rollup.tokensOut, 120, `root rollup tokensOut = 120 (got ${root.rollup.tokensOut})`);
});

// ── (3) duration derivation ──────────────────────────────────────────────────────────────────────────

test("durationMs derives from mission_started.at -> mission_synthesis.at; absent when never started", () => {
  const forest = buildMissionTraceForest(twoLevelTree());
  const root = forest[0]!;
  const child = root.children[0]!;

  // Root carries both `.at` anchors — 10:00:00 -> 10:05:00 = 5 minutes = 300_000ms.
  assert.equal(root.rollup.durationMs, 300_000, `root duration = 300000ms (got ${root.rollup.durationMs})`);
  // The sub-mission's own mission_started/mission_synthesis carry NO `.at` in this fixture — never
  // fabricated, so its rollup.durationMs stays absent.
  assert.equal(child.rollup.durationMs, undefined, "no `.at` on the sub-mission's events -> no fabricated duration");
});

test("durationMs is absent for a mission that never started (no mission_started event)", () => {
  const events: HubEvent[] = [
    { type: "plan_proposed", missionId: "m-proposed-only", plan: plan([plannedAgent({ key: "a" })]) },
  ];
  const forest = buildMissionTraceForest(events);
  assert.equal(forest.length, 1);
  assert.equal(forest[0]!.rollup.durationMs, undefined);
});

// ── (4) the LEGACY guarantee — a flat (un-nested) mission collapses to ONE node, no children ───────────

test("a flat legacy mission (no parentMissionId anywhere) collapses to exactly one node with children: []", () => {
  const flatPlan = plan([plannedAgent({ key: "a" }), plannedAgent({ key: "b" })]);
  const events: HubEvent[] = [
    { type: "plan_proposed", missionId: "m-flat", plan: flatPlan },
    { type: "plan_approved", missionId: "m-flat", autonomy: "auto", auto: true },
    { type: "mission_started", missionId: "m-flat", agentSessionIds: ["s-a", "s-b"] },
    { type: "agent_spawned", missionId: "m-flat", agentSessionId: "s-a", key: "a", roleName: "A", model: "gpt-4o", index: 0 },
    { type: "agent_spawned", missionId: "m-flat", agentSessionId: "s-b", key: "b", roleName: "B", model: "gpt-4o", index: 1 },
    { type: "agent_report", missionId: "m-flat", agentSessionId: "s-a", report: report({ summary: "A" }), costUsd: 0.05 },
    { type: "agent_report", missionId: "m-flat", agentSessionId: "s-b", report: report({ summary: "B" }), costUsd: 0.07 },
    { type: "mission_synthesis", missionId: "m-flat", messageId: "msg", partial: false, agentReportRefs: ["s-a", "s-b"] },
  ];

  const forest = buildMissionTraceForest(events);
  assert.equal(forest.length, 1, "exactly one root node");
  const node = forest[0]!;
  assert.equal(node.missionId, "m-flat");
  assert.equal(node.depth, 0);
  assert.deepEqual(node.children, [], "no children — the legacy shape");
  assert.deepEqual(node.agents.map((a) => a.key), ["a", "b"], "both agents are plain leaves");
  assert.ok(Math.abs(node.rollup.costUsd - 0.12) < 1e-9, `rollup = sum of both leaves = 0.12 (got ${node.rollup.costUsd})`);
});

// ── (5) no mission at all -> an empty forest ────────────────────────────────────────────────────────

test("a session with no mission at all yields an empty forest", () => {
  const events: HubEvent[] = [
    { type: "user_message", messageId: "m1", text: "hello" },
    { type: "turn_done" },
  ];
  assert.deepEqual(buildMissionTraceForest(events), []);
});

// ── (6) determinism + inertness ─────────────────────────────────────────────────────────────────────

test("buildMissionTraceForest is deterministic and does not mutate its input", () => {
  const events = twoLevelTree();
  const pristine = structuredClone(events);
  const forest1 = buildMissionTraceForest(events);
  const forest2 = buildMissionTraceForest(events);
  assert.deepEqual(forest1, forest2, "two builds of the same log are deepEqual");
  assert.deepEqual(events, pristine, "the input events are not mutated");
});
