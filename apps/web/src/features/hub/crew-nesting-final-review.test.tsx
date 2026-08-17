// Crew nesting (roadmap/crew-nesting/, WP5.R · D-CN10 refute doctrine · README §6 invariants) — the WEB
// half of the FINAL, whole-feature adversarial refute-review. Two probes only reachable in the browser
// layer:
//   • P-CYC4 — the UI cycle-reject UX (D-CN8): the crew profile modal's author-time cycle/over-depth
//     guard. `validateCrewProfileForm` blocks a SAVE that would create a cycle/over-depth `crewId`
//     member, and `MembersSection`'s sub-crew picker DISABLES/omits a candidate that would close a cycle
//     or breach the max depth — a loud, visible reject, never a silent accept.
//   • P-REP1 (web half) — the web `MissionBoard` reducer `reconstructMissionBoard` (D-CN7) rebuilds a
//     NESTED mission tree from `hub_events` ALONE (each sub-crew slot's own sub-mission attached as
//     `childBoard`, cost rolled per level), with a defensive cycle/depth guard so a corrupt/cyclic replay
//     log can never hang the tab; a FLAT mission reconstructs byte-shaped as before.
//
// This is NOT a summary pass — each probe is a concrete ATTACK (a graph mutated into a cycle, an
// over-depth candidate, a cyclic parent-linkage event log) that either fails to break the invariant
// (REFUTED) or succeeds (a FINDING kept as a `.skip`). Verdicts recorded in
// `roadmap/crew-nesting/phase-5-close/5.R-review.md`. NOTE: the both-theme + keyboard-focus visual walk
// of the cycle-reject UX + nested board stays OWNER-ACCEPTANCE (a rendered-app check an agent cannot do)
// — seeded into the residual-risk summary; this suite proves the LOGIC + the DOM affordance, not pixels.

import type {
  HubAgentReport,
  HubCrew,
  HubEvent,
  HubMissionPlan,
  HubPlannedAgent,
} from "@mcp-token-footprint/shared";
import { HUB_MISSION_MAX_DEPTH } from "@mcp-token-footprint/shared";
import { TooltipProvider } from "@elabs-ai/components-ui";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeAll, describe, expect, test, vi } from "vitest";

// `RoleAvatar` (rendered by MembersSection) imports `ModelSelectorLogo` from `@elabs-ai/components-ai` — mocked exactly
// as every other suite that renders `RoleAvatar` does.
vi.mock("@elabs-ai/components-ai", () => import("./test-support/brand-ai-mock"));

beforeAll(() => {
  if (typeof window.matchMedia !== "function") {
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
  }
});

import { MembersSection } from "./workforce/crew-profile/MembersSection";
import {
  crewReachable,
  crewSubtreeDepth,
  evaluateCrewNesting,
  validateCrewProfileForm,
  type CrewProfileFormValue,
} from "./workforce/crew-profile/crew-profile-form";
import { reconstructMissionBoard } from "./MissionBoard";

// ── Fixtures ────────────────────────────────────────────────────────────────────────────────────────

function crew(over: Partial<HubCrew> & { id: string }): HubCrew {
  return {
    name: over.id,
    topology: "parallel",
    members: [],
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    ...over,
  };
}

function formValue(over: Partial<CrewProfileFormValue> = {}): CrewProfileFormValue {
  return {
    name: "Host Crew",
    description: "",
    color: null,
    icon: "",
    topology: "parallel",
    members: [],
    ...over,
  };
}

function agent(over: Partial<HubPlannedAgent> & { key: string }): HubPlannedAgent {
  return {
    name: over.name ?? over.key,
    systemPrompt: "sys",
    model: "gpt-4o",
    toolGrants: { servers: {}, builtins: [] },
    skillIds: [],
    brief: `Brief for ${over.key}`,
    target: `Target ${over.key}`,
    expectedOutcome: "A report",
    ...over,
  };
}

function report(over: Partial<HubAgentReport> = {}): HubAgentReport {
  return { findings: [{ summary: "A finding" }], citations: [], artifacts: [], confidence: "high", openQuestions: [], ...over };
}

let seq = 0;
function ev<T extends HubEvent["type"]>(e: Extract<HubEvent, { type: T }>): HubEvent {
  return { ...e, seq: ++seq } as HubEvent;
}

function renderSection(props: Partial<Parameters<typeof MembersSection>[0]> = {}) {
  const onChange = vi.fn();
  render(
    <TooltipProvider>
      <MemoryRouter initialEntries={["/assistant/agents/crew/host-crew"]}>
        <MembersSection
          members={[]}
          roles={[]}
          rolesLoading={false}
          crews={[]}
          crewsLoading={false}
          crewId="host-crew"
          onChange={onChange}
          {...props}
        />
      </MemoryRouter>
    </TooltipProvider>,
  );
  return onChange;
}

// ══════════════════════════════════════════════════════════════════════════════════════════════════════
//  P-CYC4 — UI cycle-reject UX (D-CN8, author-time client-side half).  Attack: (a) a SAVE whose members
//  include a `crewId` that transitively reaches the host (a cycle) OR nests past HUB_MISSION_MAX_DEPTH;
//  (b) the sub-crew picker offering a candidate that would close a cycle. Assert the SAVE is blocked with a
//  named error and the picker OMITS/disables the offending candidate — a loud, visible reject.
//  Anchors: validateCrewProfileForm crew-profile-form.ts:164-196; evaluateCrewNesting:144-156;
//  MembersSection availableCrews filter MembersSection.tsx:80-90.
// ══════════════════════════════════════════════════════════════════════════════════════════════════════

describe("P-CYC4 — UI cycle-reject UX (D-CN8)", () => {
  test("REFUTED — validateCrewProfileForm BLOCKS a save whose crewId member closes a cycle (host→loops→host)", () => {
    // "loops" already nests the host; adding "loops" as a member of the host would close host→loops→host.
    const host = crew({ id: "host-crew", name: "Host" });
    const loops = crew({ id: "loops", name: "Loops Back", members: [{ crewId: "host-crew" }] });
    const crews = [host, loops];

    // Sanity on the pure reachability heart the guard rests on.
    expect(crewReachable(crews, "loops", "host-crew")).toBe(true);
    const { cycle } = evaluateCrewNesting(crews, "host-crew", "loops");
    expect(cycle).toBe(true);

    const errors = validateCrewProfileForm(formValue({ members: [{ crewId: "loops" }] }), {
      crewId: "host-crew",
      crews,
    });
    expect(errors.members).toBeDefined();
    expect(errors.members).toMatch(/circular crew reference/i);
    expect(errors.members).toContain("Loops Back"); // the offending crew is NAMED, not a silent skip
  });

  test("REFUTED — validateCrewProfileForm BLOCKS a save that would breach HUB_MISSION_MAX_DEPTH", () => {
    // host → deep → grandchild would sit 3 levels deep; with maxDepth 2 the save is rejected.
    const host = crew({ id: "host-crew", name: "Host" });
    const grandchild = crew({ id: "grandchild", name: "Grandchild" });
    const deep = crew({ id: "deep", name: "Deep Crew", members: [{ crewId: "grandchild" }] });
    const crews = [host, deep, grandchild];

    expect(crewSubtreeDepth(crews, "deep")).toBe(1); // deep already nests one level
    const { cycle, overDepth } = evaluateCrewNesting(crews, "host-crew", "deep", 2);
    expect(cycle).toBe(false);
    expect(overDepth).toBe(true);

    const errors = validateCrewProfileForm(
      formValue({ members: [{ crewId: "deep" }] }),
      { crewId: "host-crew", crews, maxDepth: 2 },
    );
    expect(errors.members).toBeDefined();
    expect(errors.members).toMatch(/maximum crew nesting depth/i);
    expect(errors.members).toContain("Deep Crew");
  });

  test("REFUTED — a clean nesting passes validation (the guard is not a blanket reject)", () => {
    const host = crew({ id: "host-crew", name: "Host" });
    const nestable = crew({ id: "nestable", name: "Nestable" });
    const errors = validateCrewProfileForm(
      formValue({ members: [{ crewId: "nestable" }] }),
      { crewId: "host-crew", crews: [host, nestable], maxDepth: HUB_MISSION_MAX_DEPTH },
    );
    expect(errors.members).toBeUndefined();
  });

  test("REFUTED — the sub-crew picker OMITS a cycle-closing candidate + explains the omission (visible reject)", () => {
    const host = crew({ id: "host-crew", name: "Host" });
    const loops = crew({ id: "loops", name: "Loops Back", members: [{ crewId: "host-crew" }] });
    renderSection({ crews: [host, loops] });

    fireEvent.click(screen.getByRole("radio", { name: "Sub-crew" }));
    // "Loops Back" would close a cycle ⇒ it is the ONLY other crew and it is filtered out: the picker is
    // disabled with the "no nestable crews" placeholder, and the caption explains WHY (cycle / max depth).
    const picker = screen.getByRole("combobox", { name: "Add a sub-crew" });
    expect(picker).toBeDisabled();
    expect(screen.getByText("No nestable crews available")).toBeInTheDocument();
    expect(screen.getByText(/aren.t offered here/)).toBeInTheDocument();
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════════════
//  P-REP1 (web half) — the web MissionBoard reducer rebuilds a NESTED tree from events (D-CN7).  Attack:
//  reconstruct a 2-level nested mission from `hub_events` ALONE; assert each sub-crew slot's own sub-mission
//  is attached as `childBoard` with a rolled-up cost, a FLAT mission carries no `childBoard`, and a CYCLIC
//  parent-linkage log terminates (the defensive web-side cycle/depth guard). Anchors: reconstructMissionBoard
//  MissionBoard.tsx:410-420; buildMissionNode child recursion :340-354; MISSION_TREE_MAX_DEPTH guard :186/:346.
// ══════════════════════════════════════════════════════════════════════════════════════════════════════

const NESTED_ROOT_PLAN: HubMissionPlan = {
  topology: "parallel",
  autonomy: "always_ask",
  agents: [
    agent({ key: "lead", name: "Lead", model: "gpt-4o" }),
    { ...agent({ key: "crew-slot", name: "Strategy Crew", model: "gpt-4o" }), crewId: "crew-x" },
  ],
  budgets: { maxAgents: 6, maxParallel: 3, maxCostUsd: 5 },
};

const SUB_PLAN: HubMissionPlan = {
  topology: "pipeline",
  autonomy: "auto",
  agents: [agent({ key: "sub-a", name: "BI Analyst A", model: "gpt-4o" }), agent({ key: "sub-b", name: "BI Analyst B", model: "gpt-4o" })],
};

/** A 2-level nested tree: the root's own events PLUS the "crew-slot" agent's own sub-mission's full event
 *  stream, appended to the SAME log (D-CN6 — every mission keeps session_id = the root chat session). */
function nestedMissionLog(): HubEvent[] {
  seq = 0;
  const rootId = "mis-root";
  const childId = "mis-child";
  return [
    ev({ type: "user_message", messageId: "u1", text: "Plan strategy" }),
    ev({ type: "plan_proposed", missionId: rootId, plan: NESTED_ROOT_PLAN }),
    ev({ type: "plan_approved", missionId: rootId, autonomy: "always_ask", approvedBy: "user", auto: false }),
    ev({ type: "agent_spawned", missionId: rootId, agentSessionId: "child-lead", key: "lead", roleName: "Lead", model: "gpt-4o", index: 0 }),
    ev({ type: "agent_spawned", missionId: rootId, agentSessionId: "child-crew", key: "crew-slot", roleName: "Strategy Crew", model: "gpt-4o", index: 1 }),
    ev({ type: "mission_started", missionId: rootId, agentSessionIds: ["child-lead", "child-crew"] }),
    ev({ type: "agent_report", missionId: rootId, agentSessionId: "child-lead", report: report({ summary: "Lead summary" }), costUsd: 0.1 }),
    // The sub-mission's OWN full event stream — its `plan_proposed` carries the load-bearing parent-linkage.
    ev({ type: "plan_proposed", missionId: childId, plan: SUB_PLAN, parentMissionId: rootId, parentAgentKey: "crew-slot" }),
    ev({ type: "plan_approved", missionId: childId, auto: true }),
    ev({ type: "agent_spawned", missionId: childId, agentSessionId: "sub-a", key: "sub-a", roleName: "BI Analyst A", model: "gpt-4o", index: 0, parentMissionId: rootId, parentAgentKey: "crew-slot" }),
    ev({ type: "agent_spawned", missionId: childId, agentSessionId: "sub-b", key: "sub-b", roleName: "BI Analyst B", model: "gpt-4o", index: 1, parentMissionId: rootId, parentAgentKey: "crew-slot" }),
    ev({ type: "mission_started", missionId: childId, agentSessionIds: ["sub-a", "sub-b"] }),
    ev({ type: "agent_report", missionId: childId, agentSessionId: "sub-a", report: report({ summary: "Sub A" }), costUsd: 0.2 }),
    ev({ type: "agent_report", missionId: childId, agentSessionId: "sub-b", report: report({ summary: "Sub B" }), costUsd: 0.3 }),
    ev({ type: "mission_synthesis", missionId: childId, messageId: "sub-syn", partial: false, agentReportRefs: ["sub-a", "sub-b"] }),
    // The crew-slot's OWN projected report lands in the ROOT log with NO costUsd of its own (D-CN2) — the
    // rollup must fall back to the sub-mission's rolled cost.
    ev({ type: "agent_report", missionId: rootId, agentSessionId: "child-crew", report: report({ summary: "Crew synthesis", subMissionId: childId, topology: "pipeline" }) }),
    ev({ type: "mission_synthesis", missionId: rootId, messageId: "root-syn", partial: false, agentReportRefs: ["child-lead", "child-crew"] }),
  ];
}

/** A FLAT (non-nested) mission log — no parent-linkage anywhere. */
function flatMissionLog(): HubEvent[] {
  seq = 0;
  const missionId = "mis-flat";
  const plan: HubMissionPlan = {
    topology: "parallel",
    autonomy: "auto",
    agents: [agent({ key: "a", name: "A" }), agent({ key: "b", name: "B" })],
    budgets: { maxAgents: 6, maxParallel: 3, maxCostUsd: 2 },
  };
  return [
    ev({ type: "plan_proposed", missionId, plan }),
    ev({ type: "plan_approved", missionId, auto: true }),
    ev({ type: "agent_spawned", missionId, agentSessionId: "ca", key: "a", roleName: "A", model: "gpt-4o", index: 0 }),
    ev({ type: "agent_spawned", missionId, agentSessionId: "cb", key: "b", roleName: "B", model: "gpt-4o", index: 1 }),
    ev({ type: "mission_started", missionId, agentSessionIds: ["ca", "cb"] }),
    ev({ type: "agent_report", missionId, agentSessionId: "ca", report: report({ summary: "A" }), costUsd: 0.1 }),
    ev({ type: "agent_report", missionId, agentSessionId: "cb", report: report({ summary: "B" }), costUsd: 0.1 }),
    ev({ type: "mission_synthesis", missionId, messageId: "syn", partial: false, agentReportRefs: ["ca", "cb"] }),
  ];
}

/** A CYCLIC parent-linkage log: root → crew-slot → mis-a; mis-a → back-slot → root. If the reducer failed
 *  to guard re-entry it would recurse forever. Mirrors Mission.test.tsx's own cycle fixture. */
function cyclicMissionLog(): HubEvent[] {
  seq = 0;
  const rootPlan: HubMissionPlan = {
    topology: "parallel",
    autonomy: "auto",
    agents: [{ ...agent({ key: "toA", name: "To A" }), crewId: "crew-a" }],
    budgets: { maxAgents: 6, maxParallel: 3, maxCostUsd: 2 },
  };
  const aPlan: HubMissionPlan = {
    topology: "parallel",
    autonomy: "auto",
    agents: [{ ...agent({ key: "toRoot", name: "Back to root" }), crewId: "crew-root" }],
    budgets: { maxAgents: 6, maxParallel: 3, maxCostUsd: 2 },
  };
  return [
    ev({ type: "plan_proposed", missionId: "root", plan: rootPlan }),
    ev({ type: "agent_spawned", missionId: "root", agentSessionId: "child-toA", key: "toA", roleName: "To A", model: "gpt-4o", index: 0 }),
    ev({ type: "plan_proposed", missionId: "mis-a", plan: aPlan, parentMissionId: "root", parentAgentKey: "toA" }),
    ev({ type: "agent_spawned", missionId: "mis-a", agentSessionId: "child-toRoot", key: "toRoot", roleName: "Back to root", model: "gpt-4o", index: 0, parentMissionId: "root", parentAgentKey: "toA" }),
    // The cyclic edge: mis-a's "toRoot" slot claims to expand back into "root".
    ev({ type: "plan_proposed", missionId: "root", plan: rootPlan, parentMissionId: "mis-a", parentAgentKey: "toRoot" }),
  ];
}

describe("P-REP1 (web half) — reconstructMissionBoard rebuilds a nested tree from events (D-CN7)", () => {
  test("REFUTED — a 2-level nested log reconstructs the tree: the crew slot carries its sub-mission as childBoard", () => {
    const board = reconstructMissionBoard(nestedMissionLog());
    expect(board).toBeDefined();
    expect(board!.missionId).toBe("mis-root");
    expect(board!.agents).toHaveLength(2);

    const leaf = board!.agents.find((a) => a.key === "lead")!;
    const crewSlot = board!.agents.find((a) => a.key === "crew-slot")!;
    // The leaf has NO childBoard; the crew slot expanded into its own sub-mission board.
    expect(leaf.childBoard).toBeUndefined();
    expect(crewSlot.childBoard).toBeDefined();
    expect(crewSlot.childBoard!.missionId).toBe("mis-child");
    expect(crewSlot.childBoard!.plan.topology).toBe("pipeline"); // the sub-crew's OWN topology
    expect(crewSlot.childBoard!.agents.map((a) => a.roleName).sort()).toEqual(["BI Analyst A", "BI Analyst B"]);
  });

  test("REFUTED — per-level cost rolls up: the sub-mission's $0.20 + $0.30 shows on its childBoard even though the crew slot's own projected report carried no cost", () => {
    const board = reconstructMissionBoard(nestedMissionLog());
    const crewSlot = board!.agents.find((a) => a.key === "crew-slot")!;
    // The sub-mission's own rolled cost = 0.20 + 0.30 = 0.50 (the crew slot's projected report had no costUsd).
    expect(crewSlot.childBoard!.rollup?.costUsd).toBeCloseTo(0.5, 9);
    expect(crewSlot.childBoard!.rollup?.costKnown).toBe(true);
    // The ROOT level rolls the leaf's $0.10 + the sub-crew's rolled $0.50 = $0.60.
    expect(board!.rollup?.costUsd).toBeCloseTo(0.6, 9);
  });

  test("REFUTED — a FLAT mission reconstructs with NO childBoard on any agent (byte-shaped as pre-nesting)", () => {
    const board = reconstructMissionBoard(flatMissionLog());
    expect(board).toBeDefined();
    expect(board!.missionId).toBe("mis-flat");
    expect(board!.agents).toHaveLength(2);
    for (const a of board!.agents) expect(a.childBoard).toBeUndefined();
  });

  test("REFUTED — a CYCLIC parent-linkage log TERMINATES (the defensive web cycle/depth guard) — no hang, bounded tree", () => {
    // The test COMPLETING is itself the proof of termination (no infinite recursion / stack overflow).
    const board = reconstructMissionBoard(cyclicMissionLog());
    expect(board).toBeDefined();
    const root = board!;
    expect(root.missionId).toBe("root");
    // The recursion is bounded: walking the tree can only descend a finite number of levels before the
    // cycle guard (`pathWithSelf.has(childMissionId)`) / the depth cap stops it. Count the nodes to prove it.
    let nodes = 0;
    const walk = (agents: typeof root.agents): void => {
      for (const a of agents ?? []) {
        nodes += 1;
        if (a.childBoard) walk(a.childBoard.agents);
      }
      if (nodes > 1000) throw new Error("unbounded reconstruction — the cycle guard failed");
    };
    walk(root.agents);
    expect(nodes).toBeLessThan(1000);
  });
});
