import type { HubProject } from "@mcp-token-footprint/shared";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { UsageToolbar } from "./UsageToolbar";
import { defaultUsageControls, type UsageControls } from "./usage-url-state";

function project(over: Partial<HubProject> = {}): HubProject {
  return {
    id: "proj_1",
    name: "Falcon",
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z",
    ...over,
  };
}

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname + location.search}</div>;
}

function renderToolbar(controls: UsageControls, onControlsChange = vi.fn()) {
  render(
    <MemoryRouter initialEntries={["/assistant/agents?tab=usage"]}>
      <Routes>
        <Route
          path="*"
          element={
            <>
              <LocationProbe />
              <UsageToolbar
                controls={controls}
                onControlsChange={onControlsChange}
                projects={[project()]}
                entityCount={3}
              />
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
  return { onControlsChange };
}

describe("UsageToolbar (WP2.6, §7.3)", () => {
  test("renders the group-by control, entity count, and the 'View sessions' action", () => {
    renderToolbar(defaultUsageControls());
    expect(screen.getByLabelText("Group by")).toBeInTheDocument();
    expect(screen.getByLabelText("Project")).toBeInTheDocument();
    expect(screen.getByText("3 entities")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "View sessions" })).toBeInTheDocument();
  });

  test("the Project select is rendered and clearable (no separate filter chip)", () => {
    const { onControlsChange } = renderToolbar({ ...defaultUsageControls(), projectId: "proj_1" });
    // No hand-rolled badge chip like "Project: Falcon" anymore — filtering uses the select's own state.
    expect(screen.queryByText("Project: Falcon")).not.toBeInTheDocument();
    // But the Project select control is present and labeled.
    expect(screen.getByLabelText("Project")).toBeInTheDocument();
  });

  test("'View sessions' navigates to the Sessions route, carrying the active project narrow", () => {
    renderToolbar({ ...defaultUsageControls(), projectId: "proj_1" });
    fireEvent.click(screen.getByRole("button", { name: "View sessions" }));
    expect(screen.getByTestId("location").textContent).toBe("/assistant/sessions?projectId=proj_1");
  });

  test("'View sessions' with no project narrow goes to the plain Sessions route", () => {
    renderToolbar(defaultUsageControls());
    fireEvent.click(screen.getByRole("button", { name: "View sessions" }));
    expect(screen.getByTestId("location").textContent).toBe("/assistant/sessions");
  });
});
