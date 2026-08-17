import type { HubAgentRole, HubCrew, HubUsageSummary } from "@mcp-token-footprint/shared";
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("@elabs-ai/components-charts", () => ({
  Sparkline: (props: { values: number[] }) => (
    <div data-testid="sparkline" data-values={JSON.stringify(props.values)} />
  ),
}));
vi.mock("@elabs-ai/components-ai", () => import("../test-support/brand-ai-mock"));
vi.mock("../../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/api")>();
  return { ...actual, getHubUsageSummary: vi.fn() };
});

import * as api from "../../../lib/api";
import { CrewCard } from "./CrewCard";

function role(overrides: Partial<HubAgentRole> = {}): HubAgentRole {
  return {
    id: "role-1",
    name: "Research Analyst",
    systemPrompt: "You research topics thoroughly.",
    defaultModel: "claude-sonnet-4-5",
    toolGrants: { servers: {}, builtins: [] },
    skills: [],
    target: "Investigate the assigned topic",
    expectedOutcome: "A structured report",
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    archivedAt: null,
    ...overrides,
  };
}

function crew(overrides: Partial<HubCrew> = {}): HubCrew {
  return {
    id: "crew-1",
    name: "Research Team",
    color: "chart-2",
    topology: "pipeline",
    members: [{ agentId: "role-1" }],
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("CrewCard", () => {
  test("shows the name, member count, topology and description", () => {
    vi.mocked(api.getHubUsageSummary).mockReturnValue(new Promise(() => {}));
    const c = crew({ description: "Digs through scan results" });
    render(<CrewCard crew={c} roles={[role()]} crews={[c]} />);
    expect(screen.getByText("Research Team")).toBeInTheDocument();
    // A flat crew's count is "N agents" (WP4.2/D-CN8's recursive formatting) — an honest plain count,
    // no visible regression for the common flat case.
    expect(screen.getByText("1 agent")).toBeInTheDocument();
    expect(screen.getByText("Pipeline")).toBeInTheDocument();
    expect(screen.getByText("Digs through scan results")).toBeInTheDocument();
  });

  // Interface Craft WP 2.1 (D-IC10, finding 10) — the clamped (`line-clamp-2`) description had no
  // recovery; mirrors AgentCard's identical D-10 fix (a plain `title`, verified untouched below).
  test("the line-clamp-2 description carries its full text as a `title` (D-IC10 recovery)", () => {
    vi.mocked(api.getHubUsageSummary).mockReturnValue(new Promise(() => {}));
    const longDescription =
      "A crew that digs through scan results, cross-references token footprints, and drafts a weekly summary for the owner.";
    const c = crew({ description: longDescription });
    render(<CrewCard crew={c} roles={[role()]} crews={[c]} />);
    expect(screen.getByText(longDescription)).toHaveAttribute("title", longDescription);
  });

  test("resolves member ids to their role for the avatar row; unresolved members are skipped, not crashed", () => {
    vi.mocked(api.getHubUsageSummary).mockReturnValue(new Promise(() => {}));
    const c = crew({ members: [{ agentId: "role-1" }, { agentId: "deleted-role" }] });
    render(<CrewCard crew={c} roles={[role()]} crews={[c]} />);
    // No crash despite a member referencing a role that no longer resolves.
    expect(screen.getByText("Research Team")).toBeInTheDocument();
  });

  test("no members yet shows an honest empty message, not a broken empty row", () => {
    vi.mocked(api.getHubUsageSummary).mockReturnValue(new Promise(() => {}));
    const c = crew({ members: [] });
    render(<CrewCard crew={c} roles={[]} crews={[c]} />);
    expect(screen.getByText("No members yet")).toBeInTheDocument();
  });

  test("shows its own 30-day usage strip once loaded", async () => {
    const usage: HubUsageSummary = {
      groupBy: "crew",
      id: "crew-1",
      label: "Research Team",
      totals: { sessions: 7, costUsd: 1.5, tokensIn: 10, tokensOut: 20 },
      strip: [],
    };
    vi.mocked(api.getHubUsageSummary).mockResolvedValue(usage);
    const c = crew();
    render(<CrewCard crew={c} roles={[role()]} crews={[c]} />);
    await waitFor(() => expect(screen.getByText(/7 runs/)).toBeInTheDocument());
    expect(screen.getByText(/\$1\.50/)).toBeInTheDocument();
    expect(api.getHubUsageSummary).toHaveBeenCalledWith({
      groupBy: "crew",
      id: "crew-1",
      days: 30,
    });
  });

  test("a failed usage fetch degrades honestly", async () => {
    vi.mocked(api.getHubUsageSummary).mockRejectedValue(new Error("network down"));
    const c = crew();
    render(<CrewCard crew={c} roles={[role()]} crews={[c]} />);
    await waitFor(() => expect(screen.getByText("Usage unavailable")).toBeInTheDocument());
  });
});

// Crew nesting (WP4.2 / D-CN8) — mixed agent + sub-crew membership.
describe("CrewCard — crew nesting (WP4.2 / D-CN8)", () => {
  test("a crew with mixed agent + sub-crew membership shows a recursive count distinguishing agents from crews, and lists the sub-crew by name", () => {
    vi.mocked(api.getHubUsageSummary).mockReturnValue(new Promise(() => {}));
    const sub = crew({
      id: "sub-1",
      name: "Business Intelligence",
      members: [{ agentId: "role-2" }],
    });
    const top = crew({
      id: "top-1",
      name: "Growth Team",
      members: [{ agentId: "role-1" }, { crewId: "sub-1" }],
    });
    render(
      <CrewCard
        crew={top}
        roles={[role({ id: "role-1" }), role({ id: "role-2", name: "Analyst" })]}
        crews={[sub, top]}
      />,
    );
    // 2 agents (1 direct + 1 via the sub-crew), 1 crew — not one ambiguous number.
    expect(screen.getByText("2 agents, 1 crew (3 total)")).toBeInTheDocument();
    // The direct sub-crew member is surfaced by name.
    expect(screen.getByText("+ Business Intelligence sub-crew")).toBeInTheDocument();
  });

  test("a crew with ONLY a sub-crew member (no direct agents) does not show the 'No members yet' empty state", () => {
    vi.mocked(api.getHubUsageSummary).mockReturnValue(new Promise(() => {}));
    const sub = crew({ id: "sub-1", name: "Business Intelligence", members: [{ agentId: "role-1" }] });
    const top = crew({ id: "top-1", name: "Growth Team", members: [{ crewId: "sub-1" }] });
    render(<CrewCard crew={top} roles={[role({ id: "role-1" })]} crews={[sub, top]} />);
    expect(screen.queryByText("No members yet")).not.toBeInTheDocument();
    expect(screen.getByText("+ Business Intelligence sub-crew")).toBeInTheDocument();
  });

  test("a dangling crewId reference (referenced crew no longer exists) does not crash and is not listed", () => {
    vi.mocked(api.getHubUsageSummary).mockReturnValue(new Promise(() => {}));
    const top = crew({
      id: "top-1",
      name: "Growth Team",
      members: [{ agentId: "role-1" }, { crewId: "ghost" }],
    });
    render(<CrewCard crew={top} roles={[role({ id: "role-1" })]} crews={[top]} />);
    expect(screen.getByText("Growth Team")).toBeInTheDocument();
    expect(screen.getByText("1 agent")).toBeInTheDocument();
  });
});
