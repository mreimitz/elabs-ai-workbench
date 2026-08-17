import { useState } from "react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import type { Collection, ScanSummary, ServerConfig, Skill } from "@mcp-token-footprint/shared";
import type { ThemePreference } from "../../lib/theme";
import { CommandPalette } from "./CommandPalette";

const SERVER: ServerConfig = {
  id: "srv1",
  name: "GitHub MCP",
  transport: "streamable_http",
  createdAt: "2026-07-01T00:00:00.000Z",
  updatedAt: "2026-07-01T00:00:00.000Z",
  hasEnvSecrets: false,
  hasHeaderSecrets: false,
  authType: "none",
};

const SKILL: Skill = {
  id: "skl1",
  name: "pdf-filler",
  displayName: "PDF Filler",
  slug: "pdf-filler",
  sourceType: "upload",
  versionCount: 3,
  createdAt: "2026-07-01T00:00:00.000Z",
  updatedAt: "2026-07-01T00:00:00.000Z",
};

const COLLECTION: Collection = {
  id: "col1",
  name: "Local",
  isDefault: true,
  repoUrl: null,
  repoPath: null,
  branch: null,
  hasPat: false,
  createdAt: "2026-07-01T00:00:00.000Z",
  updatedAt: "2026-07-01T00:00:00.000Z",
};

const SCAN: ScanSummary = {
  id: "scn1",
  serverId: "srv2",
  // Deliberately a DIFFERENT server name than SERVER, so searching a server name doesn't also match
  // this scan row (a server and its own scan legitimately share a name — the fixtures avoid it).
  serverName: "Payments API",
  tokenProfile: "generic_o200k",
  scannedAt: "2026-07-10T12:00:00.000Z",
  status: "success",
  totalTools: 12,
  totalTokens: 3456,
  totalRawBytes: 8000,
  averageTokensPerTool: 288,
  largestToolTokens: 900,
  totalResources: 0,
  totalResourceTemplates: 0,
  totalPrompts: 0,
  totalResourceTokens: 0,
  totalPromptTokens: 0,
  largestResourceTokens: 0,
  largestPromptTokens: 0,
  countingVersion: 2,
};

/** Reflects the current route (path + search) so navigation from the palette is observable. */
function LocationProbe() {
  const location = useLocation();
  return (
    <div data-testid="location">
      {location.pathname}
      {location.search}
    </div>
  );
}

function renderPalette(
  overrides: Partial<Parameters<typeof CommandPalette>[0]> = {},
  { initialOpen = true }: { initialOpen?: boolean } = {},
) {
  const onAddServer = vi.fn();
  const onAddSkill = vi.fn();
  const onThemePreferenceChange = vi.fn<(preference: ThemePreference) => void>();

  function Harness() {
    const [open, setOpen] = useState(initialOpen);
    return (
      <>
        <LocationProbe />
        <CommandPalette
          open={open}
          onOpenChange={setOpen}
          servers={[SERVER]}
          scans={[SCAN]}
          skills={[SKILL]}
          collections={[COLLECTION]}
          themePreference="light"
          onThemePreferenceChange={onThemePreferenceChange}
          onAddServer={onAddServer}
          onAddSkill={onAddSkill}
          {...overrides}
        />
      </>
    );
  }

  render(
    <MemoryRouter initialEntries={["/dashboard"]}>
      <Routes>
        <Route path="*" element={<Harness />} />
      </Routes>
    </MemoryRouter>,
  );

  return { onAddServer, onAddSkill, onThemePreferenceChange };
}

/** Type into the palette's search box (cmdk filters in an effect, so callers `await` results). */
function typeSearch(value: string) {
  fireEvent.change(screen.getByPlaceholderText("Search or jump to…"), { target: { value } });
}

describe("CommandPalette", () => {
  test("renders an accessible modal with a search box when open", () => {
    renderPalette();
    expect(screen.getByRole("dialog", { name: "Command palette" })).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Search or jump to…")).toBeInTheDocument();
  });

  test("is not rendered when closed", () => {
    renderPalette({}, { initialOpen: false });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  test("global ⌘K opens the palette", async () => {
    renderPalette({}, { initialOpen: false });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.keyDown(window, { key: "k", metaKey: true });
    expect(await screen.findByRole("dialog", { name: "Command palette" })).toBeInTheDocument();
  });

  test("global Ctrl+K opens the palette (non-Mac)", async () => {
    renderPalette({}, { initialOpen: false });
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });

  test("lists the standard destinations and top-level actions", () => {
    renderPalette();
    expect(screen.getByText("Dashboard")).toBeInTheDocument();
    expect(screen.getByText("Compatibility")).toBeInTheDocument();
    expect(screen.getByText("Add MCP server")).toBeInTheDocument();
    expect(screen.getByText("New test run")).toBeInTheDocument();
  });

  test("'New test run' opens the run launcher on the runs feed (A-2), not the dead /runs/new route", async () => {
    renderPalette();
    typeSearch("new test run");
    const option = await screen.findByRole("option", { name: /New test run/ });
    fireEvent.click(option);
    await waitFor(() =>
      expect(screen.getByTestId("location")).toHaveTextContent("/testing/runs?launch=1"),
    );
  });

  test("navigates to a destination on select", async () => {
    renderPalette();
    typeSearch("compat");
    const option = await screen.findByRole("option", { name: /Compatibility/ });
    fireEvent.click(option);
    await waitFor(() =>
      expect(screen.getByTestId("location")).toHaveTextContent("/testing/compatibility"),
    );
  });

  test("finds a server by name and navigates to its detail route", async () => {
    renderPalette();
    typeSearch("github");
    const option = await screen.findByRole("option", { name: /GitHub MCP/ });
    fireEvent.click(option);
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("/servers/srv1"));
  });

  test("finds a recent scan by server name and navigates to it", async () => {
    renderPalette();
    typeSearch("payments");
    const option = await screen.findByRole("option", { name: /Payments API/ });
    fireEvent.click(option);
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("/scans/scn1"));
  });

  test("finds a skill by display name and navigates to it", async () => {
    renderPalette();
    typeSearch("pdf");
    const option = await screen.findByRole("option", { name: /PDF Filler/ });
    fireEvent.click(option);
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("/skills/skl1"));
  });

  test("triggers the add-server action instead of navigating", async () => {
    const { onAddServer } = renderPalette();
    typeSearch("add mcp");
    const option = await screen.findByRole("option", { name: /Add MCP server/ });
    fireEvent.click(option);
    expect(onAddServer).toHaveBeenCalledTimes(1);
  });

  test("runs a theme command and marks the current theme", async () => {
    const { onThemePreferenceChange } = renderPalette();
    // The active preference is annotated as "Current".
    const brightOption = screen.getByRole("option", { name: /Switch to Bright theme/ });
    expect(within(brightOption).getByText("Current")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("option", { name: /Switch to Dark theme/ }));
    expect(onThemePreferenceChange).toHaveBeenCalledWith("dark");
  });

  test("shows an empty state when nothing matches", async () => {
    renderPalette();
    typeSearch("zzzzznotathing");
    expect(await screen.findByText("No results found.")).toBeInTheDocument();
  });

  test("omits dynamic groups when their lists are empty", () => {
    renderPalette({ servers: [], skills: [], collections: [], scans: [] });
    // Static groups remain (Dashboard is a nav destination, always present)…
    expect(screen.getByText("Dashboard")).toBeInTheDocument();
    // …but the dynamic group heading + rows are gone. ("Recent scans" is a heading unique to the
    // dynamic group; the server row would be an option, distinct from the "MCP Servers" nav label.)
    expect(screen.queryByText("Recent scans")).not.toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /GitHub MCP/ })).not.toBeInTheDocument();
  });
});
