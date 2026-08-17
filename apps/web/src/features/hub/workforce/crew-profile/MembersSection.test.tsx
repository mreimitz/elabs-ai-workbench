// Crew nesting (WP4.1, D-CN1/D-CN4/D-CN5/D-CN8) — the crew profile modal's Members section gains a
// SECOND add path (a saved sub-crew, alongside a library role) plus a kind-branched accordion. This
// suite covers the standalone section (mirrors how `CrewProfileModal.test.tsx` exercises the Members
// section indirectly, but focused just on this component's own contract): adding a sub-crew member,
// the cycle/depth-filtered picker + its explanatory caption, and correct sub-crew rendering (never the
// role's "(deleted role · …)" fallback or the agent-only overrides).

import type { HubAgentRole, HubCrew, HubCrewMember } from "@mcp-token-footprint/shared";
import { TooltipProvider } from "@elabs-ai/components-ui";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { beforeAll, describe, expect, test, vi } from "vitest";

// `RoleAvatar` imports `ModelSelectorLogo` from `@elabs-ai/components-ai` — mocked exactly like
// `CrewProfileModal.test.tsx` (and every other suite that renders `RoleAvatar`) does.
vi.mock("@elabs-ai/components-ai", () => import("../../test-support/brand-ai-mock"));

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

import { MembersSection } from "./MembersSection";

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
    id: "some-crew",
    name: "Some Crew",
    topology: "parallel",
    members: [],
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    ...overrides,
  };
}

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname}</div>;
}

function renderSection(props: Partial<Parameters<typeof MembersSection>[0]> = {}) {
  const onChange = vi.fn();
  render(
    <TooltipProvider>
      <MemoryRouter initialEntries={["/assistant/agents/crew/host-crew"]}>
        <LocationProbe />
        <MembersSection
          members={[]}
          roles={[role()]}
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

describe("MembersSection — add path toggle (D-CN8)", () => {
  test("defaults to the Role add path; switching to Sub-crew swaps the picker", () => {
    renderSection({ crews: [crew({ id: "host-crew" }), crew({ id: "nestable", name: "Nestable" })] });

    expect(screen.getByRole("radio", { name: "Role" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByLabelText("Add a role from the library")).toBeInTheDocument();
    expect(screen.queryByLabelText("Add a sub-crew")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("radio", { name: "Sub-crew" }));

    expect(screen.getByLabelText("Add a sub-crew")).toBeInTheDocument();
    expect(screen.queryByLabelText("Add a role from the library")).not.toBeInTheDocument();
  });
});

describe("MembersSection — adding a sub-crew (D-CN1)", () => {
  test("choosing a crew and pressing Add appends a { crewId } member (no agentId)", () => {
    const nestable = crew({ id: "nestable", name: "Nestable Crew" });
    const onChange = renderSection({
      crews: [crew({ id: "host-crew", name: "Host" }), nestable],
    });

    fireEvent.click(screen.getByRole("radio", { name: "Sub-crew" }));
    fireEvent.click(screen.getByRole("combobox", { name: "Add a sub-crew" }));
    fireEvent.click(screen.getByRole("option", { name: "Nestable Crew" }));
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    expect(onChange).toHaveBeenCalledWith([{ crewId: "nestable" }]);
  });
});

describe("MembersSection — cycle/depth-filtered sub-crew picker (D-CN4)", () => {
  test("excludes self and an already-added member; offers a clean candidate; shows the caption", () => {
    const host = crew({ id: "host-crew", name: "Host" });
    const alreadyMember = crew({ id: "already-member", name: "Already Member" });
    const nestable = crew({ id: "nestable", name: "Nestable Crew" });

    renderSection({
      members: [{ crewId: "already-member" }],
      crews: [host, alreadyMember, nestable],
    });

    fireEvent.click(screen.getByRole("radio", { name: "Sub-crew" }));
    fireEvent.click(screen.getByRole("combobox", { name: "Add a sub-crew" }));

    // Offered: the one clean candidate.
    expect(screen.getByRole("option", { name: "Nestable Crew" })).toBeInTheDocument();
    // Excluded: self (host isn't a candidate for itself) and an already-added member.
    expect(screen.queryByRole("option", { name: "Host" })).not.toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Already Member" })).not.toBeInTheDocument();

    expect(screen.getByText(/aren.t offered here/)).toBeInTheDocument();
  });

  test("excludes a candidate that would close a crew-nesting cycle", () => {
    const host = crew({ id: "host-crew", name: "Host" });
    // "cyclic" already nests "host-crew" — nesting "cyclic" back INTO host would close the loop
    // (host→cyclic→host). This unavoidably also gives "host-crew" an ANCESTOR in this snapshot
    // (it's already nested one level inside "cyclic"), so it's tested in ISOLATION — combining it
    // with an unrelated "available" candidate in the same snapshot would (correctly, per D-CN10's
    // depth cap) exclude that candidate too, since host would already sit at depth 1.
    const cyclic = crew({ id: "cyclic", name: "Cyclic Crew", members: [{ crewId: "host-crew" }] });

    renderSection({ crews: [host, cyclic] });

    fireEvent.click(screen.getByRole("radio", { name: "Sub-crew" }));

    // "Cyclic Crew" is the only other crew in the snapshot and it's excluded — the picker is left
    // with nothing to offer (disabled, "no nestable crews" placeholder) and the caption still
    // explains the omission.
    const picker = screen.getByRole("combobox", { name: "Add a sub-crew" });
    expect(picker).toBeDisabled();
    expect(screen.getByText("No nestable crews available")).toBeInTheDocument();
    expect(screen.getByText(/aren.t offered here/)).toBeInTheDocument();
  });

  test("no caption once every fetched crew is a legitimate candidate", () => {
    // Note: `crews` here does NOT include the host itself (unlike a real `listHubCrews()`
    // snapshot) precisely to exercise the "nothing was filtered out" boundary — the moment the
    // host is present in `crews` it is always self-excluded, so `availableCrews.length <
    // crews.length` (and the caption) is otherwise near-unavoidable once real data loads.
    const nestable = crew({ id: "nestable", name: "Nestable Crew" });
    renderSection({ crews: [nestable] });

    fireEvent.click(screen.getByRole("radio", { name: "Sub-crew" }));
    fireEvent.click(screen.getByRole("combobox", { name: "Add a sub-crew" }));

    expect(screen.getByRole("option", { name: "Nestable Crew" })).toBeInTheDocument();
    expect(screen.queryByText(/aren.t offered here/)).not.toBeInTheDocument();
  });
});

describe("MembersSection — accordion branches on memberKind (D-CN5/D-CN8)", () => {
  const nestedCrew: HubCrew = crew({ id: "nested-1", name: "Nested Ops Crew", icon: "lucide:brain" });

  function membersWithSubCrew(): HubCrewMember[] {
    return [{ crewId: "nested-1" }];
  }

  test("a resolvable sub-crew member shows its name, a 'Sub-crew' badge, and 'Open sub-crew' — never the role fallback or agent overrides", () => {
    renderSection({
      members: membersWithSubCrew(),
      crews: [crew({ id: "host-crew" }), nestedCrew],
    });

    // Exact accessible name (name + badge text) — a loose substring match would also catch the
    // "Move/Remove Nested Ops Crew" IconButtons, whose aria-labels contain the same substring.
    const trigger = screen.getByRole("button", { name: "Nested Ops Crew Sub-crew" });
    expect(within(trigger).getByText("Nested Ops Crew")).toBeInTheDocument();
    // Scoped to the trigger — the "Sub-crew" add-kind toggle option also renders that same text.
    expect(within(trigger).getByText("Sub-crew")).toBeInTheDocument();
    expect(screen.queryByText(/deleted role/)).not.toBeInTheDocument();

    fireEvent.click(trigger);
    expect(screen.getByRole("button", { name: "Open sub-crew" })).toBeInTheDocument();
    // Agent-only overrides must be absent for a crew member.
    expect(screen.queryByText("Model override")).not.toBeInTheDocument();
    expect(screen.queryByText("System prompt override")).not.toBeInTheDocument();
    expect(screen.queryByText("Override tool grants")).not.toBeInTheDocument();
    expect(screen.queryByText("Override skills")).not.toBeInTheDocument();
    // The budget-cascade override IS present for a sub-crew member.
    expect(screen.getByText("Override budgets")).toBeInTheDocument();
  });

  test("an UNRESOLVED crewId member renders a crew-specific fallback, never '(deleted role · …)'", () => {
    renderSection({ members: [{ crewId: "ghost-crew-id" }], crews: [crew({ id: "host-crew" })] });

    expect(screen.getByText(/missing crew · ghost-/)).toBeInTheDocument();
    expect(screen.queryByText(/deleted role/)).not.toBeInTheDocument();
  });

  test("an agentId member keeps today's exact agent render (unaffected by the crew-nesting change)", () => {
    renderSection({ members: [{ agentId: "role-1" }], roles: [role()] });

    expect(screen.getByText("Research Analyst")).toBeInTheDocument();
    // Only the add-kind toggle's own "Sub-crew" label exists — no "Sub-crew" BADGE, since this
    // member is an agent, not a nested crew.
    expect(screen.getAllByText("Sub-crew")).toHaveLength(1);

    // Exact accessible name — a loose substring match would also catch the "Move/Remove Research
    // Analyst" IconButtons.
    fireEvent.click(screen.getByRole("button", { name: "Research Analyst" }));
    expect(screen.getByText("Model override")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Open sub-crew" })).not.toBeInTheDocument();
  });

  test("'Open sub-crew' navigates to the sub-crew's own profile route (route reuse, D-CN8)", () => {
    renderSection({
      members: membersWithSubCrew(),
      crews: [crew({ id: "host-crew" }), nestedCrew],
    });

    fireEvent.click(screen.getByRole("button", { name: "Nested Ops Crew Sub-crew" }));
    fireEvent.click(screen.getByRole("button", { name: "Open sub-crew" }));

    expect(screen.getByTestId("location")).toHaveTextContent("/assistant/agents/crew/nested-1");
  });
});
