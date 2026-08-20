// Crew nesting (planning/Roadmap/RM-10-crew-nesting/, WP3.1 · D-CN7, R-SES1) — the EVENT-SOURCED HIERARCHY proof. A
// nested-tree mission must reconstruct from `hub_events` ALONE. These tests build a 2-level tree of raw
// events BY HAND (no service, no DB, no provider, no MCP) and feed them straight to the pure API board
// reducer `reconstructMission`, asserting:
//   • root identity — a log where sub-missions emit LATER `plan_proposed`s still returns the ROOT board;
//   • the crew node's `children` are the sub-mission's members, grafted by `parentAgentKey === crewNode.key`;
//   • per-level cost roll-up — a crew node's cost = the SUM of its subtree leaf costs, the crew node's own
//     PROJECTED report cost is NOT double-counted, and the tree total = the sum of all leaf costs;
//   • crew-node completion — the node is `reported` once its sub-mission synthesized, its projected report kept;
//   • determinism (`deepEqual` across two calls) and inertness (the input event array is never mutated);
//   • a FLAT (un-nested) mission reconstructs to exactly the pre-WP3.1 shape (every agent a leaf, no children);
//   • a missing crew node (a corrupt log whose `parentAgentKey` names no parent agent) is GUARDED, not crashed;
//   • `reconstructMissionById` returns any tree-member sub-mission's own board (the WP3.2 drill primitive).

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
import { reconstructMission, reconstructMissionById } from "../src/hub/missions/board.js";

// ── minimal, self-contained builders (no service, no repository) ────────────────────────────────────

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

// ── the canonical 2-level tree of events (root: a leaf + a crew node → a sub-mission of two members) ──

const ROOT = "m-root";
const SUB = "m-sub";
const L1 = "s-l1"; // root leaf session
const CC = "s-cc"; // root crew-node CONTAINER session
const M1 = "s-m1"; // sub-mission member 1 session
const M2 = "s-m2"; // sub-mission member 2 session

/** A fresh copy of the 2-level tree each call (so a mutation-inertness test can compare against a pristine
 *  clone). Order mirrors a real run: root proposes/approves/spawns, its leaf reports, THEN the crew-ref
 *  expands into a sub-mission (its own LATER `plan_proposed` + spawns + reports + synthesis), then the
 *  crew node's PROJECTED report lands on the root log, then the root synthesizes. */
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
    { type: "plan_approved", missionId: ROOT, autonomy: "auto", approvedBy: "system", auto: true },
    { type: "mission_started", missionId: ROOT, agentSessionIds: [L1, CC] },
    { type: "agent_spawned", missionId: ROOT, agentSessionId: L1, key: "l1", roleName: "Leaf One", model: "gpt-4o", index: 0 },
    { type: "agent_spawned", missionId: ROOT, agentSessionId: CC, key: "cc", roleName: "Child Crew", model: "gpt-4o", index: 1 },
    { type: "agent_report", missionId: ROOT, agentSessionId: L1, report: report({ summary: "L1" }), costUsd: 0.1 },
    // ── the crew-ref expands into its own sub-mission: its `plan_proposed` is LATER in the log and carries
    //    parent-linkage back to the ROOT mission + the crew-node slot "cc".
    { type: "plan_proposed", missionId: SUB, plan: subPlan, parentMissionId: ROOT, parentAgentKey: "cc" },
    { type: "mission_started", missionId: SUB, agentSessionIds: [M1, M2] },
    { type: "agent_spawned", missionId: SUB, agentSessionId: M1, key: "m1", roleName: "Member One", model: "gpt-4o", index: 0, parentMissionId: ROOT, parentAgentKey: "cc" },
    { type: "agent_spawned", missionId: SUB, agentSessionId: M2, key: "m2", roleName: "Member Two", model: "gpt-4o", index: 1, parentMissionId: ROOT, parentAgentKey: "cc" },
    { type: "agent_report", missionId: SUB, agentSessionId: M1, report: report({ summary: "M1" }), costUsd: 0.2 },
    { type: "agent_report", missionId: SUB, agentSessionId: M2, report: report({ summary: "M2" }), costUsd: 0.3 },
    { type: "mission_synthesis", missionId: SUB, messageId: "msg-sub", partial: false, agentReportRefs: [M1, M2] },
    // ── the crew node's PROJECTED report on the ROOT log. Its `costUsd` is set to a DISTINCT 0.77 (NOT the
    //    real subtotal 0.50) so the roll-up test PROVES the reducer ignores it and sums the children (0.50) —
    //    never echoes 0.77 nor double-counts to 1.27.
    { type: "agent_report", missionId: ROOT, agentSessionId: CC, report: report({ summary: "Sub-crew rollup", subMissionId: SUB }), costUsd: 0.77 },
    { type: "mission_synthesis", missionId: ROOT, messageId: "msg-root", partial: false, agentReportRefs: [L1, CC] },
  ];
}

// ── (1) a 2-level tree reconstructs PURELY from the events — tree, children, completion, cost roll-up ──

test("a 2-level nested mission reconstructs from hub_events alone (tree + children + crew completion)", () => {
  const events = twoLevelTree();
  const board = reconstructMission(events);
  assert.ok(board, "the mission reconstructs from events alone");

  // Root identity fix — the ROOT is returned even though the sub-mission's `plan_proposed` came LATER.
  assert.equal(board.missionId, ROOT, "the ROOT board is returned, NOT the later nested plan_proposed");
  assert.equal(board.phase, "done");
  assert.equal(board.approved, true);
  assert.equal(board.autoApproved, true);

  // Two TOP-LEVEL nodes: the leaf + the crew node (the sub-mission's members are NOT top-level).
  assert.equal(board.agents.length, 2, "the root board has two top-level agents (a leaf + a crew node)");
  const leaf = board.agents.find((a) => a.key === "l1")!;
  const crew = board.agents.find((a) => a.key === "cc")!;

  // The leaf is a plain leaf — no children, no subMissionId.
  assert.ok(leaf.children === undefined, "the leaf agent has no children");
  assert.ok(leaf.subMissionId === undefined, "the leaf agent has no subMissionId");
  assert.equal(leaf.reported, true);

  // The crew node grafts the sub-mission's TWO members as `children`, matched by parentAgentKey === "cc".
  assert.ok(crew.children, "the crew node carries its sub-mission's members as children");
  assert.equal(crew.children!.length, 2, "both sub-mission members are grafted");
  assert.deepEqual(
    crew.children!.map((c) => c.key),
    ["m1", "m2"],
    "children are the sub-mission's members, ordered by index",
  );
  assert.equal(crew.subMissionId, SUB, "the crew node names its sub-mission id");
  assert.equal(crew.reported, true, "the crew node is reported once its sub-mission synthesized");
  assert.equal(crew.report?.summary, "Sub-crew rollup", "the crew node keeps its OWN projected report");

  // ── Per-level cost roll-up (the load-bearing assertion). ──────────────────────────────────────────
  assert.equal(leaf.costUsd, 0.1, "a leaf's rolled cost = its own agent_report.costUsd");
  assert.equal(crew.children![0]!.costUsd, 0.2, "sub-member m1 keeps its own leaf cost");
  assert.equal(crew.children![1]!.costUsd, 0.3, "sub-member m2 keeps its own leaf cost");
  // The crew node's rolled cost = sum(children) = 0.50 — NOT the projected 0.77, NOT the double-count 1.27.
  assert.ok(
    Math.abs(crew.costUsd! - 0.5) < 1e-9,
    `the crew node's rolled cost = sum(children)=0.50, not the projected 0.77 nor 1.27 (got ${crew.costUsd})`,
  );
  // The whole-tree total = sum of ALL leaf costs (0.10 + 0.20 + 0.30 = 0.60).
  const treeTotal = (leaf.costUsd ?? 0) + (crew.costUsd ?? 0);
  assert.ok(Math.abs(treeTotal - 0.6) < 1e-9, `tree total = sum of all leaf costs = 0.60 (got ${treeTotal})`);

  // The root synthesis survives replay.
  assert.equal(board.synthesis?.partial, false);
  assert.deepEqual(board.synthesis?.agentReportRefs, [L1, CC]);
});

// ── (2) determinism + inertness — no I/O, no mutation of the input event array ────────────────────────

test("reconstruction is deterministic and inert (side-effect-free, R-SES1)", () => {
  const events = twoLevelTree();
  const pristine = structuredClone(events);
  const beforeLen = events.length;

  const board1 = reconstructMission(events);
  const board2 = reconstructMission(events);
  const afterLen = events.length;

  assert.deepEqual(board1, board2, "two reconstructions of the same log are deepEqual (deterministic)");
  assert.equal(afterLen, beforeLen, "the event array length is unchanged (inert)");
  assert.deepEqual(events, pristine, "the input events are NOT mutated by reconstruction (inert)");
});

// ── (3) reconstructMissionById returns the SUB-mission's own board (the WP3.2 drill primitive) ────────

test("reconstructMissionById reconstructs a tree-member sub-mission's own board", () => {
  const events = twoLevelTree();
  const sub = reconstructMissionById(events, SUB);
  assert.ok(sub, "the sub-mission reconstructs by id");
  assert.equal(sub.missionId, SUB);
  assert.equal(sub.phase, "done");
  assert.deepEqual(sub.agents.map((a) => a.key), ["m1", "m2"], "the sub-mission board carries its two members");
  assert.equal(sub.agents.every((a) => a.reported), true);
  // An id outside the tree returns undefined.
  assert.equal(reconstructMissionById(events, "m-nope"), undefined, "an unknown mission id → undefined");
});

// ── (4) a FLAT (un-nested) legacy mission reconstructs to exactly the pre-WP3.1 shape ─────────────────

test("a flat legacy mission (no parent-linkage) reconstructs to today's shape — every agent a leaf", () => {
  const flatPlan = plan([plannedAgent({ key: "a" }), plannedAgent({ key: "b" })]);
  const events: HubEvent[] = [
    { type: "plan_proposed", missionId: "m-flat", plan: flatPlan },
    { type: "plan_approved", missionId: "m-flat", autonomy: "auto", auto: true },
    { type: "mission_started", missionId: "m-flat", agentSessionIds: ["s-a", "s-b"] },
    { type: "agent_spawned", missionId: "m-flat", agentSessionId: "s-a", key: "a", roleName: "A", model: "gpt-4o", index: 0 },
    { type: "agent_spawned", missionId: "m-flat", agentSessionId: "s-b", key: "b", roleName: "B", model: "gpt-4o", index: 1 },
    { type: "agent_report", missionId: "m-flat", agentSessionId: "s-a", report: report({ summary: "A" }) },
    { type: "agent_report", missionId: "m-flat", agentSessionId: "s-b", report: report({ summary: "B" }) },
    { type: "mission_synthesis", missionId: "m-flat", messageId: "msg", partial: false, agentReportRefs: ["s-a", "s-b"] },
  ];

  const board = reconstructMission(events);
  assert.ok(board);
  assert.equal(board.missionId, "m-flat");
  assert.equal(board.phase, "done");
  assert.equal(board.agents.length, 2);
  // Every agent is a LEAF — no children, no subMissionId anywhere (no behavioural change).
  assert.ok(board.agents.every((a) => a.children === undefined), "no agent has children");
  assert.ok(board.agents.every((a) => a.subMissionId === undefined), "no agent has a subMissionId");
  assert.ok(board.agents.every((a) => a.reported && a.report), "every agent's report is reconstructed");
});

// ── (5) a corrupt log (parentAgentKey names no parent agent) is GUARDED — no graft, no crash ──────────

test("a sub-mission whose parentAgentKey matches no parent agent is guarded (no crash, no graft)", () => {
  const rootPlan = plan([plannedAgent({ key: "l1", name: "Leaf One" })]); // NO crew node
  const subPlan = plan([plannedAgent({ key: "m1", name: "Member One" })]);
  const events: HubEvent[] = [
    { type: "plan_proposed", missionId: ROOT, plan: rootPlan },
    { type: "plan_approved", missionId: ROOT, auto: true },
    { type: "mission_started", missionId: ROOT, agentSessionIds: [L1] },
    { type: "agent_spawned", missionId: ROOT, agentSessionId: L1, key: "l1", roleName: "Leaf One", model: "gpt-4o", index: 0 },
    // A sub-mission whose parentAgentKey "ghost" exists nowhere in the root's agents.
    { type: "plan_proposed", missionId: SUB, plan: subPlan, parentMissionId: ROOT, parentAgentKey: "ghost" },
    { type: "agent_spawned", missionId: SUB, agentSessionId: M1, key: "m1", roleName: "Member One", model: "gpt-4o", index: 0, parentMissionId: ROOT, parentAgentKey: "ghost" },
    { type: "agent_report", missionId: SUB, agentSessionId: M1, report: report({ summary: "M1" }), costUsd: 0.4 },
    { type: "mission_synthesis", missionId: SUB, messageId: "msg-sub", partial: false, agentReportRefs: [M1] },
    { type: "mission_synthesis", missionId: ROOT, messageId: "msg-root", partial: false, agentReportRefs: [L1] },
  ];

  // Must NOT throw — the guard skips the ungraftable sub-mission.
  const board = reconstructMission(events);
  assert.ok(board, "reconstruction survives a missing crew node");
  assert.equal(board.missionId, ROOT);
  assert.equal(board.agents.length, 1, "only the root's own agent remains");
  assert.ok(board.agents.every((a) => a.children === undefined), "the orphan sub-mission is NOT grafted");
});
