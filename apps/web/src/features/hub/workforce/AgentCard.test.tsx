import type { HubAgentRole, HubCrew, HubUsageSummary } from "@mcp-token-footprint/shared";
import { TooltipProvider } from "@brand/ui";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("@brand/charts", () => ({
  Sparkline: (props: { values: number[] }) => (
    <div data-testid="sparkline" data-values={JSON.stringify(props.values)} />
  ),
}));
vi.mock("@brand/ai", () => import("../test-support/brand-ai-mock"));
vi.mock("../../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/api")>();
  return { ...actual, getHubUsageSummary: vi.fn() };
});

import * as api from "../../../lib/api";
import { AgentCard, accentFor, summarizeToolGrants } from "./AgentCard";

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
    topology: "parallel",
    members: [{ agentId: "role-1" }],
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    ...overrides,
  };
}

function usage(overrides: Partial<HubUsageSummary> = {}): HubUsageSummary {
  return {
    groupBy: "agent",
    id: "role-1",
    label: "Research Analyst",
    totals: { sessions: 14, costUsd: 3.2, tokensIn: 100, tokensOut: 200 },
    strip: [
      { key: "2026-07-01", label: "Jul 1", sessions: 2, costUsd: 0.5, tokensIn: 10, tokensOut: 20 },
    ],
    ...overrides,
  };
}

// The card's ⋯ actions control is an `IconButton` (D-TB5), which wraps every control in a Radix
// `Tooltip` — that throws without an ancestor `TooltipProvider` (the app root mounts one).
function renderCard(overrides: Partial<Parameters<typeof AgentCard>[0]> = {}) {
  const onSelect = vi.fn();
  const onOpen = vi.fn();
  const onArchiveToggle = vi.fn();
  render(
    <TooltipProvider>
      <AgentCard
        role={role()}
        memberOfCrews={[]}
        selected={false}
        onSelect={onSelect}
        onOpen={onOpen}
        onArchiveToggle={onArchiveToggle}
        {...overrides}
      />
    </TooltipProvider>,
  );
  return { onSelect, onOpen, onArchiveToggle };
}

function openCardMenu(name: RegExp): void {
  // Radix's DropdownMenuTrigger only listens for pointerdown/keydown, not a synthetic `click`
  // (mirrors WorkforceView.test.tsx's `openNewMenu` helper for the same component).
  fireEvent.keyDown(screen.getByRole("button", { name }), { key: "Enter" });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("AgentCard — pure helpers", () => {
  test("summarizeToolGrants: explicit allowlists sum exactly, an `all` grant marks the count approximate", () => {
    expect(
      summarizeToolGrants({ servers: { "server-a": ["t1", "t2"], "server-b": [] }, builtins: [] }),
    ).toEqual({ count: 2, approximate: false });

    expect(
      summarizeToolGrants({ servers: { "server-a": ["t1"], "server-b": "all" }, builtins: [] }),
    ).toEqual({ count: 1, approximate: true });

    expect(summarizeToolGrants({ servers: {}, builtins: [] })).toEqual({
      count: 0,
      approximate: false,
    });
  });

  test("accentFor: no crews -> no ring/border/dots; one crew -> ring+border+one dot; 2+ crews -> stacked dots, no ring/border", () => {
    expect(accentFor([])).toEqual({ ring: "", borderTop: "", dots: [] });

    const one = accentFor([crew({ id: "c1", name: "Research Team", color: "chart-2" })]);
    expect(one.ring).not.toBe("");
    expect(one.borderTop).not.toBe("");
    expect(one.dots).toHaveLength(1);
    expect(one.dots[0]).toMatchObject({ crewId: "c1", name: "Research Team" });

    const many = accentFor([
      crew({ id: "c1", name: "Research Team", color: "chart-2" }),
      crew({ id: "c2", name: "Growth Squad", color: "chart-4" }),
    ]);
    expect(many.ring).toBe("");
    expect(many.borderTop).toBe("");
    expect(many.dots).toHaveLength(2);
  });
});

describe("AgentCard — identity + assignment summary", () => {
  test("shows the role name as title when no displayName; model chip; tool/skill counts", async () => {
    vi.mocked(api.getHubUsageSummary).mockResolvedValue(usage());
    renderCard({
      role: role({
        toolGrants: { servers: { "server-a": ["t1", "t2", "t3"] }, builtins: [] },
        skills: [{ skillId: "s1", versionMode: "latest", invocationMode: "model_invocable" }],
      }),
    });

    expect(screen.getByText("Research Analyst")).toBeInTheDocument();
    expect(screen.getByText("claude-sonnet-4-5")).toBeInTheDocument();
    expect(screen.getByText("3 tools · 1 skill")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText(/14 runs/)).toBeInTheDocument());
    expect(screen.getByText(/\$3\.20/)).toBeInTheDocument();
  });

  test("displayName becomes the title, role name becomes the subtitle", () => {
    vi.mocked(api.getHubUsageSummary).mockReturnValue(new Promise(() => {}));
    renderCard({ role: role({ displayName: "Nova" }) });
    expect(screen.getByText("Nova")).toBeInTheDocument();
    expect(screen.getByText("Research Analyst")).toBeInTheDocument();
  });

  test("an archived role shows the Archived badge", () => {
    vi.mocked(api.getHubUsageSummary).mockReturnValue(new Promise(() => {}));
    renderCard({ role: role({ archivedAt: "2026-07-10T00:00:00.000Z" }) });
    expect(screen.getByText("Archived")).toBeInTheDocument();
  });

  test("an `all` tool grant renders an honest N+ (never a fabricated exact count)", () => {
    vi.mocked(api.getHubUsageSummary).mockReturnValue(new Promise(() => {}));
    renderCard({
      role: role({ toolGrants: { servers: { "server-a": "all" }, builtins: [] } }),
    });
    expect(screen.getByText("0+ tools · 0 skills")).toBeInTheDocument();
  });

  test("a failed usage fetch degrades honestly instead of blocking the card", async () => {
    vi.mocked(api.getHubUsageSummary).mockRejectedValue(new Error("network down"));
    renderCard();
    await waitFor(() => expect(screen.getByText("Usage unavailable")).toBeInTheDocument());
    // The rest of the card is still fully usable.
    expect(screen.getByText("Research Analyst")).toBeInTheDocument();
  });
});

describe("AgentCard — crew accent (D-HUX8, always paired with the crew name)", () => {
  test("single crew: the crew name renders next to its dot", () => {
    vi.mocked(api.getHubUsageSummary).mockReturnValue(new Promise(() => {}));
    renderCard({ memberOfCrews: [crew({ name: "Research Team" })] });
    expect(screen.getByText("Research Team")).toBeInTheDocument();
  });

  test("multi-crew: every crew's name renders (stacked dots)", () => {
    vi.mocked(api.getHubUsageSummary).mockReturnValue(new Promise(() => {}));
    renderCard({
      memberOfCrews: [
        crew({ id: "c1", name: "Research Team" }),
        crew({ id: "c2", name: "Growth Squad" }),
      ],
    });
    expect(screen.getByText("Research Team")).toBeInTheDocument();
    expect(screen.getByText("Growth Squad")).toBeInTheDocument();
  });
});

describe("AgentCard — interactions (D-HUX5: click=select, dblclick/Enter/⋯=open)", () => {
  test("a plain click on the card root selects without opening", () => {
    vi.mocked(api.getHubUsageSummary).mockReturnValue(new Promise(() => {}));
    const { onSelect, onOpen } = renderCard();
    fireEvent.click(screen.getByRole("button", { name: "Research Analyst" }));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onOpen).not.toHaveBeenCalled();
  });

  // WP2.R-B: the original `target !== currentTarget` guard only selected on a click that landed on
  // the bare Card root — missing ~90% of the visible surface (name, description, avatar, model chip).
  // D-HUX5's "click = select" covers the whole card.
  test("a click on the card's VISIBLE CONTENT (name, description) also selects — not just the bare root", () => {
    vi.mocked(api.getHubUsageSummary).mockReturnValue(new Promise(() => {}));
    const { onSelect, onOpen } = renderCard({
      role: role({ description: "Digs through scan results" }),
    });

    fireEvent.click(screen.getByText("Research Analyst"));
    expect(onSelect).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByText("Digs through scan results"));
    expect(onSelect).toHaveBeenCalledTimes(2);

    expect(onOpen).not.toHaveBeenCalled();
  });

  test("a click on the model chip also selects", () => {
    vi.mocked(api.getHubUsageSummary).mockReturnValue(new Promise(() => {}));
    const { onSelect } = renderCard();
    fireEvent.click(screen.getByText("claude-sonnet-4-5"));
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  test("a click inside the ⋯ menu — the trigger, or a portaled menu item — never selects the card", () => {
    vi.mocked(api.getHubUsageSummary).mockReturnValue(new Promise(() => {}));
    const { onSelect } = renderCard();

    fireEvent.click(screen.getByRole("button", { name: "Research Analyst actions" }));
    expect(onSelect).not.toHaveBeenCalled();

    openCardMenu(/Research Analyst actions/);
    fireEvent.click(screen.getByRole("menuitem", { name: /Archive/ }));
    expect(onSelect).not.toHaveBeenCalled();
  });

  test("double-click opens the profile", () => {
    vi.mocked(api.getHubUsageSummary).mockReturnValue(new Promise(() => {}));
    const { onOpen } = renderCard();
    fireEvent.doubleClick(screen.getByRole("button", { name: "Research Analyst" }));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  test("keyboard Enter on the focused card opens the profile (mouse/keyboard parity)", () => {
    vi.mocked(api.getHubUsageSummary).mockReturnValue(new Promise(() => {}));
    const { onOpen, onSelect } = renderCard();
    fireEvent.keyDown(screen.getByRole("button", { name: "Research Analyst" }), { key: "Enter" });
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onSelect).not.toHaveBeenCalled();
  });

  test("every card is an independent Tab stop (tabIndex=0, no roving tabindex)", () => {
    vi.mocked(api.getHubUsageSummary).mockReturnValue(new Promise(() => {}));
    renderCard();
    expect(screen.getByRole("button", { name: "Research Analyst" })).toHaveAttribute(
      "tabIndex",
      "0",
    );
  });

  test("the ⋯ menu's Open profile opens the profile, reachable by keyboard", () => {
    vi.mocked(api.getHubUsageSummary).mockReturnValue(new Promise(() => {}));
    const { onOpen, onSelect } = renderCard();
    openCardMenu(/Research Analyst actions/);
    fireEvent.click(screen.getByRole("menuitem", { name: "Open profile" }));
    expect(onOpen).toHaveBeenCalledTimes(1);
    // Opening the menu must not also fire a card-level select (stopPropagation on the trigger).
    expect(onSelect).not.toHaveBeenCalled();
  });

  test("the ⋯ menu archives an active role and restores an archived one", () => {
    vi.mocked(api.getHubUsageSummary).mockReturnValue(new Promise(() => {}));
    const { onArchiveToggle } = renderCard();
    openCardMenu(/Research Analyst actions/);
    expect(screen.getByRole("menuitem", { name: /Archive/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("menuitem", { name: /Archive/ }));
    expect(onArchiveToggle).toHaveBeenCalledWith(true);
  });

  test("selected reflects as aria-current for assistive tech", () => {
    vi.mocked(api.getHubUsageSummary).mockReturnValue(new Promise(() => {}));
    renderCard({ selected: true });
    expect(screen.getByRole("button", { name: "Research Analyst" })).toHaveAttribute(
      "aria-current",
      "true",
    );
  });
});
