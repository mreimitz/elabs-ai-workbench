import { MemoryRouter } from "react-router-dom";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import type { ServerConfig } from "@mcp-token-footprint/shared";

// jsdom omits matchMedia/ResizeObserver — Radix (Dialog/Tabs/Tooltip) and @brand/data's DataTable
// read them.
if (typeof window.matchMedia !== "function") {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false
  })) as unknown as typeof window.matchMedia;
}
if (typeof window.ResizeObserver !== "function") {
  window.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof window.ResizeObserver;
}

// `@brand/charts` (the scan-trend AreaChart) pulls in `@visx/*`, which doesn't resolve cleanly under
// vitest's ESM loader (see `components-smoke.test.tsx`'s note — heavy chart/editor surfaces are
// deliberately stubbed rather than exercised). This view only renders it when there are ≥2 successful
// scans, which this suite never has, but the STATIC import still needs to resolve.
vi.mock("@brand/charts", () => ({
  AreaChart: () => null,
  Area: () => null,
  Grid: () => null,
  XAxis: () => null,
  ChartTooltip: () => null
}));
// `@brand/editor`'s `CodeEditor` (used by the Tools tab's detail panel + resource/prompt run
// dialogs, both imported by ServersView) bundles Monaco/Milkdown — same stubbing convention as
// `LiveSkillWorkspaceView.test.tsx`. Never rendered in this suite (no scan → no tool selected).
vi.mock("@brand/editor", () => ({
  CodeEditor: () => null
}));

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return {
    ...actual,
    probeServerAnswers: vi.fn(),
    getAssistantAuthStatus: vi.fn().mockResolvedValue({ signedIn: false, fallbackConfigured: false, models: [] })
  };
});

import { TooltipProvider } from "@brand/ui";
import { probeServerAnswers } from "../../lib/api";
import { AssistantProvider } from "../assistant/assistant-context";
import { ServersView } from "./ServersView";

const SERVER: ServerConfig = {
  id: "server-1",
  name: "Acme tenant",
  transport: "streamable_http",
  url: "https://acme.us.qlikcloud.com/mcp",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  hasEnvSecrets: false,
  hasHeaderSecrets: false,
  authType: "none"
};

function renderServersView() {
  return render(
    <MemoryRouter initialEntries={[`/servers/${SERVER.id}`]}>
      <TooltipProvider>
        <AssistantProvider>
          <ServersView
            isBusy={() => false}
            latestScan={null}
            scanHistory={[]}
            selectedServer={SERVER}
            onAddServer={() => {}}
            onEditServer={() => {}}
            onExportReport={() => {}}
            onRunScan={() => {}}
            onTestServer={() => {}}
          />
        </AssistantProvider>
      </TooltipProvider>
    </MemoryRouter>
  );
}

describe("ServersView — Qlik Answers badge + CTA (WP 2.2)", () => {
  test("shows the 'Answers available' badge and a CTA when the probe reports answersAvailable", async () => {
    vi.mocked(probeServerAnswers).mockResolvedValue({
      origin: "https://acme.us.qlikcloud.com",
      answersAvailable: true,
      assistantCount: 3
    });

    renderServersView();

    await waitFor(() => expect(probeServerAnswers).toHaveBeenCalledWith("server-1"));
    expect(await screen.findByText("Answers available")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /set up qlik answers/i })).toBeInTheDocument();
  });

  test("opens the setup dialog from the CTA (consent-gated — nothing created just by opening)", async () => {
    vi.mocked(probeServerAnswers).mockResolvedValue({
      origin: "https://acme.us.qlikcloud.com",
      answersAvailable: true,
      assistantCount: 2
    });

    renderServersView();
    await screen.findByText("Answers available");
    fireEvent.click(screen.getByRole("button", { name: /set up qlik answers/i }));

    expect(await screen.findByText(/tenant with 2 Qlik Answers assistants/i)).toBeInTheDocument();
  });

  test("shows no badge/CTA when the probe reports answersAvailable:false", async () => {
    vi.mocked(probeServerAnswers).mockResolvedValue({
      origin: "https://example.com",
      answersAvailable: false,
      assistantCount: 0
    });

    renderServersView();

    await waitFor(() => expect(probeServerAnswers).toHaveBeenCalledWith("server-1"));
    expect(screen.queryByText("Answers available")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /set up qlik answers/i })).not.toBeInTheDocument();
  });
});

// TB.2 — the toolbar standard (toolbar-standard-2026-07-11.md §2, D-TB1/D-TB3/D-TB4): the detail
// pane renders ONE `ViewToolbar` row (last-scan StatusBadge + transport/auth chips + endpoint meta,
// with the Scan-now + icon actions), no in-page name title as chrome, no debug-assistant hook, and
// no separate chrome stat strip (its scan-result metrics move into the Overview body).
describe("ServersView — one-row toolbar (TB.2)", () => {
  test("renders the toolbar (Scan now + transport chip), no debug hook, no chrome stat strip", async () => {
    vi.mocked(probeServerAnswers).mockResolvedValue({
      origin: "https://acme.us.qlikcloud.com",
      answersAvailable: false,
      assistantCount: 0
    });

    renderServersView();
    await waitFor(() => expect(probeServerAnswers).toHaveBeenCalledWith("server-1"));

    // Toolbar right actions + left status/context cluster.
    expect(screen.getByRole("button", { name: /scan now/i })).toBeInTheDocument();
    expect(screen.getByText("streamable_http")).toBeInTheDocument();

    // D-TB3 — the "Debug connectivity" assistant hook is gone from the toolbar (dock-only now).
    expect(screen.queryByRole("button", { name: /debug connectivity/i })).not.toBeInTheDocument();

    // D-TB4 — the chrome stat strip is gone; the scan-only headline metrics (which now live in the
    // Overview body) never render as chrome, so with no scan they are absent entirely.
    expect(screen.queryByText("Startup tokens")).not.toBeInTheDocument();
    expect(screen.queryByText("Top 3 share")).not.toBeInTheDocument();
  });
});
