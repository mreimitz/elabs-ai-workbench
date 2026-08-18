import type { AdvisorReport } from "@mcp-token-footprint/shared";
import { TooltipProvider } from "@elabs-ai/components-ui";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

const getAdvisorReport = vi.fn();
const listServers = vi.fn();
const listScenarios = vi.fn();

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return {
    ...actual,
    getAdvisorReport: (...args: unknown[]) => getAdvisorReport(...args),
    listServers: () => listServers(),
    listScenarios: () => listScenarios(),
  };
});

import { AdvisorView } from "./AdvisorView";

const emptyReport: AdvisorReport = {
  advisorVersion: 1,
  generatedAt: "2026-08-18T09:00:00.000Z",
  scope: { kind: "fleet" },
  recommendations: [],
  insufficientData: [],
};

function renderView(initialEntry: string) {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <TooltipProvider>
        <AdvisorView />
      </TooltipProvider>
    </MemoryRouter>,
  );
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("AdvisorView — the route's URL contract (D-TB10)", () => {
  it("renders something genuinely useful with ZERO query params: the fleet report", async () => {
    getAdvisorReport.mockResolvedValue(emptyReport);
    listServers.mockResolvedValue([]);
    listScenarios.mockResolvedValue([]);

    renderView("/advisor");

    await screen.findByText("No recommendations");
    expect(getAdvisorReport).toHaveBeenCalledWith({ scope: "fleet" });
  });

  it("asks the operator to pick an entity when the scope names none — it never silently reports on the whole fleet instead", async () => {
    listServers.mockResolvedValue([{ id: "srv_1", name: "GitHub" }]);
    listScenarios.mockResolvedValue([]);

    renderView("/advisor?scope=server");

    expect(await screen.findByText("Pick an MCP server")).toBeTruthy();
    expect(getAdvisorReport).not.toHaveBeenCalled();
  });

  it("reports on the scoped entity named in the URL", async () => {
    getAdvisorReport.mockResolvedValue({ ...emptyReport, scope: { kind: "server", id: "srv_1" } });
    listServers.mockResolvedValue([{ id: "srv_1", name: "GitHub" }]);
    listScenarios.mockResolvedValue([]);

    renderView("/advisor?scope=server&id=srv_1");

    await screen.findByText("No recommendations");
    expect(getAdvisorReport).toHaveBeenCalledWith({ scope: "server", id: "srv_1" });
  });

  it("surfaces a failed picker load instead of showing an empty picker that reads as 'you have none'", async () => {
    listServers.mockRejectedValue(new Error("network down"));
    listScenarios.mockResolvedValue([]);

    renderView("/advisor?scope=server");

    expect(await screen.findByText("Couldn’t load MCP servers")).toBeTruthy();
    expect(screen.getByText("network down")).toBeTruthy();
  });

  it("keeps the page a named heading for assistive tech while the breadcrumb owns identity (D-TB1)", async () => {
    getAdvisorReport.mockResolvedValue(emptyReport);
    listServers.mockResolvedValue([]);
    listScenarios.mockResolvedValue([]);

    renderView("/advisor");

    expect(await screen.findByRole("heading", { level: 1, name: "Advisor" })).toBeTruthy();
  });
});
