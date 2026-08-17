import type { ReactElement } from "react";
import type { HubAgentRole, HubCrew } from "@mcp-token-footprint/shared";
import { TooltipProvider } from "@elabs-ai/components-ui";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("@elabs-ai/components-charts", () => ({
  Sparkline: () => <div data-testid="sparkline" />,
}));
vi.mock("@elabs-ai/components-ai", () => import("../test-support/brand-ai-mock"));
vi.mock("../../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/api")>();
  return { ...actual, getHubUsageSummary: vi.fn() };
});

import * as api from "../../../lib/api";
import { CrewHeaderCard } from "./CrewHeaderCard";

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

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.getHubUsageSummary).mockReturnValue(new Promise(() => {}));
});

// The disabled-Instantiate case wraps its Button in a Tooltip (an honest disabled reason) —
// `TooltipProvider` is required context for every render, not just that one test.
function renderHeader(node: ReactElement) {
  return render(<TooltipProvider>{node}</TooltipProvider>);
}

function openMenu(): void {
  fireEvent.keyDown(screen.getByRole("button", { name: "Research Team actions" }), {
    key: "Enter",
  });
}

describe("CrewHeaderCard", () => {
  test("composes CrewCard's identity treatment", () => {
    renderHeader(
      <CrewHeaderCard
        crew={crew()}
        roles={[role()]}
        crews={[crew()]}
        onOpenProfile={vi.fn()}
        onInstantiate={vi.fn()}
      />,
    );
    expect(screen.getByText("Research Team")).toBeInTheDocument();
  });

  test("the ⋯ menu's Open profile fires onOpenProfile", () => {
    const onOpenProfile = vi.fn();
    renderHeader(
      <CrewHeaderCard
        crew={crew()}
        roles={[role()]}
        crews={[crew()]}
        onOpenProfile={onOpenProfile}
        onInstantiate={vi.fn()}
      />,
    );
    openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Open profile" }));
    expect(onOpenProfile).toHaveBeenCalledTimes(1);
  });

  test("Instantiate fires onInstantiate when enabled", () => {
    const onInstantiate = vi.fn();
    renderHeader(
      <CrewHeaderCard
        crew={crew()}
        roles={[role()]}
        crews={[crew()]}
        onOpenProfile={vi.fn()}
        onInstantiate={onInstantiate}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Instantiate" }));
    expect(onInstantiate).toHaveBeenCalledTimes(1);
  });

  test("Instantiate is disabled with an honest reason when no model is resolvable", () => {
    renderHeader(
      <CrewHeaderCard
        crew={crew()}
        roles={[role()]}
        crews={[crew()]}
        onOpenProfile={vi.fn()}
        onInstantiate={vi.fn()}
        instantiateDisabledReason="No model available yet — configure a provider or a member's default model."
      />,
    );
    expect(screen.getByRole("button", { name: "Instantiate" })).toBeDisabled();
  });

  test("Instantiate shows a spinner and disables while busy", () => {
    renderHeader(
      <CrewHeaderCard
        crew={crew()}
        roles={[role()]}
        crews={[crew()]}
        onOpenProfile={vi.fn()}
        onInstantiate={vi.fn()}
        instantiateBusy
      />,
    );
    expect(screen.getByRole("button", { name: "Instantiate" })).toBeDisabled();
  });
});
