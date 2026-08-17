import type { HubEffectiveMemory } from "@mcp-token-footprint/shared";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, test, vi } from "vitest";
import { TooltipProvider } from "@elabs-ai/components-ui";
import { EffectiveMemoryStack } from "./EffectiveMemoryStack";

function stack(overrides: Partial<HubEffectiveMemory> = {}): HubEffectiveMemory {
  return {
    order: ["profile"],
    entries: [],
    overridden: [],
    layers: [],
    totalActive: 0,
    ...overrides,
  };
}

function renderStack(ui: React.ReactElement) {
  // The scope-managed icon buttons render via `IconButton` (D-TB5), which needs an ancestor
  // `TooltipProvider` (the app-root one from `main.tsx`) — see `ViewToolbar.test.tsx` for the
  // same pattern.
  return render(
    <TooltipProvider>
      <MemoryRouter>{ui}</MemoryRouter>
    </TooltipProvider>,
  );
}

describe("EffectiveMemoryStack — D-HUX11 ordered/tagged/linked display", () => {
  test("an empty stack shows an honest 'nothing will inject' message", () => {
    renderStack(<EffectiveMemoryStack memory={stack()} />);
    expect(screen.getByText("No memory will inject into this session yet.")).toBeInTheDocument();
  });

  test("renders entries in injection order, each tagged with its scope + owner", () => {
    const memory = stack({
      order: ["profile", "project"],
      entries: [
        {
          id: "m1",
          kind: "preference",
          content: "Likes concise prose.",
          source: "user",
          status: "active",
          scope: "profile",
          scopeId: null,
          createdAt: "t",
          updatedAt: "t",
        },
        {
          id: "m2",
          kind: "instruction",
          content: "Ship weekly.",
          source: "assistant_proposed",
          status: "active",
          scope: "project",
          scopeId: "proj-1",
          ownerName: "Demo Project",
          createdAt: "t",
          updatedAt: "t",
        },
      ],
      totalActive: 2,
    });
    renderStack(<EffectiveMemoryStack memory={memory} />);

    const list = screen.getByTestId("effective-memory-stack");
    const items = list.querySelectorAll("li");
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent("Profile");
    expect(items[0]).toHaveTextContent("Likes concise prose.");
    expect(items[1]).toHaveTextContent("Project · Demo Project");
    expect(items[1]).toHaveTextContent("Ship weekly.");
    expect(items[1]).toHaveTextContent("Assistant proposed");
  });

  test("a project-scoped entry links to the Projects page; a crew-scoped entry links to its node route", () => {
    const memory = stack({
      order: ["project", "crew"],
      entries: [
        {
          id: "m1",
          kind: "instruction",
          content: "Ship weekly.",
          source: "user",
          status: "active",
          scope: "project",
          scopeId: "proj-1",
          ownerName: "Demo Project",
          createdAt: "t",
          updatedAt: "t",
        },
        {
          id: "m2",
          kind: "preference",
          content: "Debate first.",
          source: "user",
          status: "active",
          scope: "crew",
          scopeId: "crew-1",
          ownerName: "Alpha crew",
          createdAt: "t",
          updatedAt: "t",
        },
      ],
      totalActive: 2,
    });
    renderStack(<EffectiveMemoryStack memory={memory} />);

    expect(screen.getByRole("link", { name: "Open Demo Project memory" })).toHaveAttribute(
      "href",
      "/assistant/projects",
    );
    expect(screen.getByRole("link", { name: "Open Alpha crew memory" })).toHaveAttribute(
      "href",
      "/assistant/agents/crew/crew-1",
    );
  });

  test("a profile-scoped entry's link calls onManageProfile instead of navigating", () => {
    const onManageProfile = vi.fn();
    const memory = stack({
      entries: [
        {
          id: "m1",
          kind: "preference",
          content: "Prefers concise answers.",
          source: "user",
          status: "active",
          scope: "profile",
          scopeId: null,
          createdAt: "t",
          updatedAt: "t",
        },
      ],
      totalActive: 1,
    });
    renderStack(<EffectiveMemoryStack memory={memory} onManageProfile={onManageProfile} />);

    fireEvent.click(screen.getByRole("button", { name: "Manage profile memory" }));
    expect(onManageProfile).toHaveBeenCalledTimes(1);
  });

  test("overridden entries stay reachable behind a disclosure toggle — never silently dropped (D-HUX11)", () => {
    const memory = stack({
      order: ["profile", "project"],
      entries: [
        {
          id: "m2",
          kind: "instruction",
          content: "answer in german.",
          source: "user",
          status: "active",
          scope: "project",
          scopeId: "proj-1",
          ownerName: "Demo Project",
          createdAt: "t",
          updatedAt: "t",
        },
      ],
      overridden: [
        {
          id: "m1",
          kind: "instruction",
          content: "Answer in German.",
          source: "user",
          status: "active",
          scope: "profile",
          scopeId: null,
          createdAt: "t",
          updatedAt: "t",
          overriddenByScope: "project",
          overriddenById: "m2",
        },
      ],
      totalActive: 1,
    });
    renderStack(<EffectiveMemoryStack memory={memory} />);

    expect(screen.queryByTestId("effective-memory-overridden")).not.toBeInTheDocument();
    expect(screen.getByText("1 overridden by a more specific scope")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /overridden by a more specific scope/i }));
    const overriddenList = screen.getByTestId("effective-memory-overridden");
    expect(overriddenList).toHaveTextContent("Answer in German.");
    expect(overriddenList).toHaveTextContent("shadowed by Project");
  });
});
