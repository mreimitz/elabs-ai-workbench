// Assistant Hub (hub-fixes WP2.2, RC2.4) — the plan card's grant CHIPS, per-agent grant EDITOR (reusing
// `ToolGrantPicker`, constrained to the parent's catalog), and half-configured-role WARNING badge. The
// heavy `@brand/ai` `Plan*` surface is stubbed via the shared hub mock; `@brand/ui` (Badge/Dialog) and
// `ToolGrantPicker` render for real, so the picker's own `../../lib/api` reads are stubbed too.

import type {
  HubCrew,
  HubMissionPlan,
  HubPlannedAgent,
  ScanDetail,
  ServerConfig,
} from "@mcp-token-footprint/shared";
import { TooltipProvider } from "@brand/ui";
import { fireEvent, render as rtlRender, screen, waitFor, within } from "@testing-library/react";
import type { ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("@brand/ai", () => import("./test-support/brand-ai-mock"));
vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return { ...actual, listServers: vi.fn(), apiGet: vi.fn() };
});

import * as api from "../../lib/api";
import { buildMissionCrewLookup } from "./lib/mission-agent-icon";
import { MissionPlanCard } from "./MissionPlanCard";
import { rolePlaceholderSystemPrompt, ROLE_PLACEHOLDER_TARGET } from "./mission-role-placeholders";

// MissionPlanCard renders `IconButton`s (D-TB5), which wrap every control in a Radix `Tooltip` —
// that throws without an ancestor `TooltipProvider` (the app root mounts one; this file's many
// render() call sites don't get it automatically), so `render` here is rebound to always supply one.
function render(ui: ReactElement) {
  return rtlRender(<TooltipProvider>{ui}</TooltipProvider>);
}

function agent(over: Partial<HubPlannedAgent> & { key: string }): HubPlannedAgent {
  return {
    name: over.name ?? over.key,
    systemPrompt: "You are a specialist.",
    model: "gpt-4o",
    toolGrants: { servers: {}, builtins: [] },
    skillIds: [],
    brief: `Brief ${over.key}`,
    target: `Target ${over.key}`,
    expectedOutcome: "A report.",
    ...over,
  };
}

function plan(agents: HubPlannedAgent[], over: Partial<HubMissionPlan> = {}): HubMissionPlan {
  return { topology: "parallel", autonomy: "always_ask", agents, ...over };
}

/** crew-nesting WP4.3 (D-CN5) — a saved crew fixture for `PlannedCrewCard`'s resolution. */
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

function server(overrides: Partial<ServerConfig> = {}): ServerConfig {
  return {
    id: "srv-1",
    name: "Server",
    transport: "stdio",
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    hasEnvSecrets: false,
    hasHeaderSecrets: false,
    authType: "none",
    ...overrides,
  };
}

function scanWith(serverId: string, toolNames: string[]): ScanDetail {
  return {
    id: `scan-${serverId}`,
    serverId,
    status: "success",
    tokenProfile: "generic_o200k",
    countingVersion: 2,
    totalTools: toolNames.length,
    totalTokens: 0,
    createdAt: "2026-07-01T00:00:00.000Z",
    tools: toolNames.map((name, index) => ({
      id: `${serverId}-tool-${index}`,
      scanId: `scan-${serverId}`,
      toolName: name,
      totalTokens: 0,
      nameTokens: 0,
      descriptionTokens: 0,
      schemaTokens: 0,
      contributionPercent: 0,
    })),
    resources: [],
    prompts: [],
    events: [],
  } as unknown as ScanDetail;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("MissionPlanCard — grant chips (WP2.2, RC2.4)", () => {
  test("renders one chip per granted server + a built-ins chip; 'reasoning only' when none", () => {
    render(
      <MissionPlanCard
        missionId="m1"
        plan={plan([
          agent({
            key: "a",
            name: "Analyst",
            toolGrants: { servers: { acme: "all", files: ["read_file", "list_dir"] }, builtins: ["files.read"] },
          }),
          agent({ key: "b", name: "Idler" }),
        ])}
      />,
    );
    expect(screen.getByText("acme · all")).toBeInTheDocument();
    expect(screen.getByText("files · 2 tools")).toBeInTheDocument();
    expect(screen.getByText("1 built-in")).toBeInTheDocument();
    expect(screen.getByText("reasoning only")).toBeInTheDocument();
  });
});

describe("MissionPlanCard — unconfigured-role warning (WP2.2, RC2.4)", () => {
  test("warns per agent carrying a placeholder systemPrompt / target, and not for a configured one", () => {
    render(
      <MissionPlanCard
        missionId="m1"
        plan={plan([
          agent({ key: "a", name: "Halfbaked", systemPrompt: rolePlaceholderSystemPrompt("Halfbaked") }),
          agent({ key: "b", name: "Blank", target: ROLE_PLACEHOLDER_TARGET }),
          agent({ key: "c", name: "Ready" }),
        ])}
      />,
    );
    expect(screen.getAllByText("Not fully configured")).toHaveLength(2);
  });
});

describe("MissionPlanCard — per-agent grant editor (WP2.2, RC2.4)", () => {
  test("Edit access opens a picker constrained to the parent catalog; Save persists grants via onEditPlan", async () => {
    vi.mocked(api.listServers).mockResolvedValue([
      server({ id: "acme-x", name: "Acme" }),
      server({ id: "other", name: "Other" }),
    ]);
    vi.mocked(api.apiGet).mockImplementation(async (path: string) => {
      if (path === "/api/servers/acme-x/latest-scan") return scanWith("acme-x", ["search", "list_apps"]);
      if (path === "/api/servers/other/latest-scan") return scanWith("other", ["x"]);
      throw new Error(`unexpected apiGet(${path})`);
    });
    const onEditPlan = vi.fn();
    render(
      <MissionPlanCard
        missionId="m1"
        onEditPlan={onEditPlan}
        catalogServerIds={["acme-x"]}
        plan={plan([agent({ key: "a", name: "Analyst" })])}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /edit access for analyst/i }));
    const dialog = await screen.findByRole("dialog");

    // Constrained to the parent catalog: only Acme is offered, never Other.
    await waitFor(() => expect(within(dialog).getByText("Acme")).toBeInTheDocument());
    expect(within(dialog).queryByText("Other")).not.toBeInTheDocument();

    // Grant all of Acme, then Save → the plan round-trips through onEditPlan with the new grants.
    fireEvent.click(within(dialog).getByText("Acme"));
    await waitFor(() =>
      expect(within(dialog).getByRole("checkbox", { name: "All tools" })).toBeInTheDocument(),
    );
    fireEvent.click(within(dialog).getByRole("checkbox", { name: "All tools" }));
    fireEvent.click(within(dialog).getByRole("button", { name: /save access/i }));

    expect(onEditPlan).toHaveBeenCalledTimes(1);
    const [, edited] = onEditPlan.mock.calls[0]!;
    expect((edited as HubMissionPlan).agents[0]!.toolGrants.servers).toEqual({ "acme-x": "all" });
  });
});

describe("MissionPlanCard — effective-grant subtitle for a scoped parent (WP2.3, D-HF5)", () => {
  test("no parentScope prop ⇒ no subtitle (pre-WP2.3 look unchanged)", () => {
    render(
      <MissionPlanCard
        missionId="m1"
        plan={plan([agent({ key: "a", name: "Analyst", toolGrants: { servers: { acme: "all" }, builtins: [] } })])}
      />,
    );
    expect(screen.queryByTestId("agent-effective-access-a")).not.toBeInTheDocument();
  });

  test("null parentScope (auto/unscoped session) ⇒ no subtitle — D-HF5 pass-through", () => {
    render(
      <MissionPlanCard
        missionId="m1"
        parentScope={null}
        plan={plan([agent({ key: "a", name: "Analyst", toolGrants: { servers: { acme: "all" }, builtins: [] } })])}
      />,
    );
    expect(screen.queryByTestId("agent-effective-access-a")).not.toBeInTheDocument();
  });

  test("a scoped parent narrowing an explicit tool list shows a literal 'N of M tools' subtitle", () => {
    render(
      <MissionPlanCard
        missionId="m1"
        parentScope={{ servers: { acme: ["search", "list_apps"] }, builtins: [] }}
        plan={plan([
          agent({
            key: "a",
            name: "Analyst",
            toolGrants: { servers: { acme: ["search", "list_apps", "delete_app"] }, builtins: [] },
          }),
        ])}
      />,
    );
    expect(screen.getByTestId("agent-effective-access-a")).toHaveTextContent(
      "2 of 3 tools after session scope",
    );
  });

  test("a scoped parent DROPPING a whole server (outside its scope) falls back to a server-count subtitle", () => {
    render(
      <MissionPlanCard
        missionId="m1"
        parentScope={{ servers: { acme: "all" }, builtins: [] }}
        plan={plan([
          agent({
            key: "a",
            name: "Analyst",
            toolGrants: { servers: { acme: "all", files: ["read_file"] }, builtins: [] },
          }),
        ])}
      />,
    );
    expect(screen.getByTestId("agent-effective-access-a")).toHaveTextContent(
      "1 of 2 servers after session scope",
    );
  });

  test("a scoped parent that covers the plan's grants exactly ⇒ no subtitle (nothing narrowed)", () => {
    render(
      <MissionPlanCard
        missionId="m1"
        parentScope={{ servers: { acme: "all" }, builtins: [] }}
        plan={plan([agent({ key: "a", name: "Analyst", toolGrants: { servers: { acme: "all" }, builtins: [] } })])}
      />,
    );
    expect(screen.queryByTestId("agent-effective-access-a")).not.toBeInTheDocument();
  });
});

// ── hub-fixes WP5.2 (RC5, D-HF2) — the web-capability notice ────────────────────────────────────────
describe("MissionPlanCard — web-capability notice (WP5.2, RC5)", () => {
  const RESEARCH_AGENT = agent({
    key: "a",
    name: "Researcher",
    brief: "Research the latest competitor pricing on the web.",
  });
  const PLAIN_AGENT = agent({ key: "a", name: "Analyst" });

  test("renders when the plan wants the web AND the catalog has no research-capable server", () => {
    render(
      <MemoryRouter>
        <MissionPlanCard missionId="m1" plan={plan([RESEARCH_AGENT])} catalogHasResearchServer={false} />
      </MemoryRouter>,
    );
    expect(screen.getByTestId("mission-web-capability-notice")).toBeInTheDocument();
    expect(screen.getByText("No research server registered")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /add mcp server/i })).toHaveAttribute("href", "/servers");
  });

  test("does NOT render when the plan never mentions the web, even with catalogHasResearchServer=false", () => {
    render(
      <MemoryRouter>
        <MissionPlanCard missionId="m1" plan={plan([PLAIN_AGENT])} catalogHasResearchServer={false} />
      </MemoryRouter>,
    );
    expect(screen.queryByTestId("mission-web-capability-notice")).not.toBeInTheDocument();
  });

  test("does NOT render when the catalog DOES have a research-capable server", () => {
    render(
      <MemoryRouter>
        <MissionPlanCard missionId="m1" plan={plan([RESEARCH_AGENT])} catalogHasResearchServer />
      </MemoryRouter>,
    );
    expect(screen.queryByTestId("mission-web-capability-notice")).not.toBeInTheDocument();
  });

  test("does NOT render when catalogHasResearchServer is unknown (absent/undefined)", () => {
    render(
      <MemoryRouter>
        <MissionPlanCard missionId="m1" plan={plan([RESEARCH_AGENT])} />
      </MemoryRouter>,
    );
    expect(screen.queryByTestId("mission-web-capability-notice")).not.toBeInTheDocument();
  });

  test("a plan-level rationale mentioning research also triggers the notice (not just an agent's brief)", () => {
    render(
      <MemoryRouter>
        <MissionPlanCard
          missionId="m1"
          plan={plan([PLAIN_AGENT], { rationale: "This mission needs to search the web for sources." })}
          catalogHasResearchServer={false}
        />
      </MemoryRouter>,
    );
    expect(screen.getByTestId("mission-web-capability-notice")).toBeInTheDocument();
  });

  test("sessionHasWebSearch=true ACKNOWLEDGES the built-in instead of suppressing the notice", () => {
    render(
      <MemoryRouter>
        <MissionPlanCard
          missionId="m1"
          plan={plan([RESEARCH_AGENT])}
          catalogHasResearchServer={false}
          sessionHasWebSearch
        />
      </MemoryRouter>,
    );
    expect(screen.getByTestId("mission-web-capability-notice")).toBeInTheDocument();
    expect(screen.getByText(/already answers with its own built-in web search/i)).toBeInTheDocument();
    // Still points at the MCP recipe as the pluralistic upgrade — never a dead end.
    expect(screen.getByRole("link", { name: /add mcp server/i })).toHaveAttribute("href", "/servers");
  });

  test("sessionHasWebSearch=false (or absent) uses the plain 'no research capability at all' copy", () => {
    render(
      <MemoryRouter>
        <MissionPlanCard missionId="m1" plan={plan([RESEARCH_AGENT])} catalogHasResearchServer={false} />
      </MemoryRouter>,
    );
    expect(screen.getByText(/none of your registered mcp servers look search\/fetch-capable/i)).toBeInTheDocument();
  });
});

describe("MissionPlanCard — debate rounds chip (WP4.4, D-HF3)", () => {
  test("a debate plan shows its round count chip; the default (unset) reads '2 rounds'", () => {
    const { rerender } = render(
      <MissionPlanCard missionId="m1" plan={plan([agent({ key: "a" })], { topology: "debate", debateRounds: 3 })} />,
    );
    expect(screen.getByTestId("mission-debate-rounds")).toHaveTextContent("3 rounds");

    // Unset debateRounds ⇒ the runtime default of 2.
    rerender(<MissionPlanCard missionId="m1" plan={plan([agent({ key: "a" })], { topology: "debate" })} />);
    expect(screen.getByTestId("mission-debate-rounds")).toHaveTextContent("2 rounds");

    // '1 round' is singular (openings only).
    rerender(
      <MissionPlanCard missionId="m1" plan={plan([agent({ key: "a" })], { topology: "debate", debateRounds: 1 })} />,
    );
    expect(screen.getByTestId("mission-debate-rounds")).toHaveTextContent("1 round");
  });

  test("a non-debate plan shows NO rounds chip", () => {
    render(<MissionPlanCard missionId="m1" plan={plan([agent({ key: "a" })], { topology: "parallel" })} />);
    expect(screen.queryByTestId("mission-debate-rounds")).not.toBeInTheDocument();
  });
});

// ── crew-nesting WP4.3 (D-CN2/D-CN5) — a `crewId`-bearing row renders as PlannedCrewCard ──────────────

describe("MissionPlanCard — nested crew-ref row (crew-nesting WP4.3)", () => {
  test("a crewId-bearing planned agent renders as PlannedCrewCard (topology preview + member count + budget); 'Edit access' never appears for it, and the plain agent row is unaffected", () => {
    const strategyCrew = crew({
      id: "crew-x",
      name: "Strategy Crew",
      topology: "pipeline",
      members: [{ agentId: "role-1" }, { agentId: "role-2" }],
    });
    render(
      <MissionPlanCard
        missionId="m1"
        onEditPlan={vi.fn()}
        crewLookup={buildMissionCrewLookup([strategyCrew])}
        plan={plan([
          agent({ key: "a", name: "Analyst" }),
          {
            ...agent({ key: "b", name: "Strategy Crew slot" }),
            crewId: "crew-x",
            budgets: { maxCostUsd: 3 },
          },
        ])}
      />,
    );
    // The crew row shows the RESOLVED crew's name, its member count, and the slot's own budget.
    expect(screen.getByText("Strategy Crew")).toBeInTheDocument();
    expect(screen.getByText("2 members")).toBeInTheDocument();
    expect(screen.getByText(/\$3/)).toBeInTheDocument();
    // A real topology preview renders (the crew's own shape) — never "Edit access" for this row (the
    // crew card's aria-label uses the RESOLVED crew's name, "Strategy Crew", not the slot's own name).
    expect(screen.getByTestId("topology-graph")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /edit access for strategy crew/i })).toBeNull();
    // The ordinary agent row is byte-for-byte unaffected — it still gets "Edit access".
    expect(screen.getByRole("button", { name: /edit access for analyst/i })).toBeInTheDocument();
  });

  test("removing the crew-ref row PATCHes the plan minus that slot, same as an ordinary agent", () => {
    const onEditPlan = vi.fn();
    render(
      <MissionPlanCard
        missionId="m1"
        onEditPlan={onEditPlan}
        crewLookup={buildMissionCrewLookup([crew({ id: "crew-x", name: "Strategy Crew" })])}
        plan={plan([
          agent({ key: "a", name: "Analyst" }),
          { ...agent({ key: "b", name: "Strategy Crew slot" }), crewId: "crew-x" },
        ])}
      />,
    );
    // The button's aria-label uses the RESOLVED crew's name ("Strategy Crew"), not the slot's own name.
    fireEvent.click(screen.getByRole("button", { name: /remove strategy crew/i }));
    expect(onEditPlan).toHaveBeenCalledTimes(1);
    const [, edited] = onEditPlan.mock.calls[0]!;
    expect((edited as HubMissionPlan).agents.map((a) => a.key)).toEqual(["a"]);
  });

  test("an unresolved crewId (deleted crew, or the library hasn't loaded) shows a not-found notice, never a fabricated preview", () => {
    render(
      <MissionPlanCard
        missionId="m1"
        plan={plan([{ ...agent({ key: "b", name: "Ghost Crew slot" }), crewId: "missing-crew" }])}
      />,
    );
    expect(screen.getByText(/could not be found/i)).toBeInTheDocument();
    expect(screen.queryByTestId("topology-graph")).not.toBeInTheDocument();
  });

  test("a plan with no crewId members renders byte-for-byte unchanged (no PlannedCrewCard, no topology preview)", () => {
    render(<MissionPlanCard missionId="m1" plan={plan([agent({ key: "a", name: "Analyst" })])} />);
    expect(screen.getByText("Analyst")).toBeInTheDocument();
    expect(screen.queryByTestId("topology-graph")).not.toBeInTheDocument();
  });
});

/**
 * Approval gates are visually neutral (design-remediation T11, P1) — Approve used to render
 * `variant="default"` (solid/primary) next to a `ghost`-variant (the WEAKEST) Cancel, so the
 * consequential action (spends budget, runs agents) visually dominated the safe/reversible one at
 * the exact moment the system should stay neutral. Both are now `outline`; this locks that neither
 * button carries the solid/primary treatment (nor the weakest `ghost` one) and that they match.
 */
describe("MissionPlanCard — approval gate is visually balanced (T11)", () => {
  test("Approve & run and Cancel render the same (outline) variant — neither dominates", () => {
    render(
      <MissionPlanCard
        missionId="m1"
        plan={plan([agent({ key: "a" })])}
        onApprove={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    const approve = screen.getByRole("button", { name: /approve & run/i });
    const cancel = screen.getByRole("button", { name: /^cancel$/i });

    // The vendored Button's solid/primary variant paints `bg-primary`; Approve may not carry it.
    expect(approve.className).not.toMatch(/\bbg-primary\b/);
    // `ghost` renders no border/background classes at rest — Cancel must not be the weakest variant.
    expect(cancel.className).toMatch(/\bborder\b/);
    // Same size + variant, no extra per-button className — their class lists match exactly.
    expect(approve.className).toBe(cancel.className);
  });
});
