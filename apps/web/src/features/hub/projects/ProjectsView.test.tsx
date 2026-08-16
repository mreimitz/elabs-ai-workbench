import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { TooltipProvider } from "@brand/ui";

vi.mock("../../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/api")>();
  return {
    ...actual,
    listHubProjects: vi.fn(),
    // ui-wave U6 — the panel now also fetches the sessions table dataset for its rail counts.
    listHubSessionsForTable: vi.fn(),
  };
});

import * as api from "../../../lib/api";
import { ProjectsView } from "./ProjectsView";

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.listHubProjects).mockResolvedValue([]);
  vi.mocked(api.listHubSessionsForTable).mockResolvedValue([]);
});

describe("ProjectsView", () => {
  test("renders the heading and the (empty) project library", async () => {
    // The panel's detail-header sessions link renders through react-router's `Link` — the view
    // needs a Router ancestor now that the library mounts it (ui-wave U6). The ViewToolbar `info`
    // tooltip (D-TB1 migration, WP 1.2) reads from a `TooltipProvider` — the app root mounts one;
    // wrap the render the same way the real tree does.
    render(
      <TooltipProvider>
        <MemoryRouter>
          <ProjectsView />
        </MemoryRouter>
      </TooltipProvider>,
    );
    expect(screen.getByRole("heading", { name: "Projects" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("No projects yet")).toBeInTheDocument());
  });
});
