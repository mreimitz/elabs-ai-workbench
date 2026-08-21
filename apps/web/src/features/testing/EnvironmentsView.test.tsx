import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { ProviderCredential, Scenario, ServerConfig } from "@mcp-token-footprint/shared";
import { TooltipProvider } from "@elabs-ai/components-ui";

// jsdom omits matchMedia/ResizeObserver — Radix (Dialog/Tooltip/DropdownMenu) reads them.
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
if (typeof window.ResizeObserver !== "function") {
  window.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof window.ResizeObserver;
}

const listScenarios = vi.fn();
const listProviders = vi.fn();
const listServerTypes = vi.fn();
const listSkills = vi.fn();
const apiGet = vi.fn();

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return {
    ...actual,
    listScenarios: () => listScenarios(),
    listProviders: () => listProviders(),
    listServerTypes: () => listServerTypes(),
    listSkills: () => listSkills(),
    apiGet: (path: string) => apiGet(path),
  };
});

// The editor pulls a live model roster and the advisor panel fetches a report; neither is under test
// here and both would make real requests.
vi.mock("./EnvironmentEditor", () => ({ EnvironmentEditor: () => null }));
vi.mock("../advisor/AdvisorPanel", () => ({ AdvisorPanel: () => null }));
vi.mock("../skills/skills-inspector-api", () => ({ listSkillVersions: vi.fn(async () => []) }));

import { EnvironmentsView } from "./EnvironmentsView";

/**
 * RM-36 WP 2.2 · P2-4 — a dangling server reference must be VISIBLE, not console-only.
 *
 * The measured defect: `GET /api/servers/<id>/latest-scan` returned 404 on every load of
 * `/testing/environments` because an environment referenced a server id that no longer resolves, and
 * the page showed no error text, no `role="alert"`, no `role="status"` and no toast. The failure
 * existed only in the browser console — which `architecture.md` and `interaction-guidelines.md` both
 * forbid ("never swallow MCP/connection errors").
 *
 * It is surfaced INLINE on the affected row, as information rather than as an error banner over the
 * page: a 404 here is a known state of the data (a server was deleted; the environment kept pointing
 * at it), not an exceptional failure.
 */

const PROVIDER: ProviderCredential = {
  id: "prov-1",
  kind: "anthropic",
  label: "Claude",
  hasKey: true,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

function serverConfig(id: string, name: string): ServerConfig {
  return {
    id,
    name,
    transport: "streamable_http",
    url: `https://${id}.example.com/mcp`,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    hasEnvSecrets: false,
    hasHeaderSecrets: false,
    authType: "none",
    typeId: null,
  };
}

function scenario(name: string, serverIds: string[]): Scenario {
  return {
    id: `scn-${name}`,
    name,
    providerId: PROVIDER.id,
    model: "claude-sonnet-4-5",
    params: {},
    systemPrompt: "",
    allowedServers: serverIds.map((serverId) => ({ serverId, allowedTools: null })),
    allowedSkills: [],
    defaultProfiles: ["generic_o200k"],
    guardrails: {},
    toolLoadingMode: "eager",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  };
}

/** The row for one environment, found via its (unique) name cell. */
function rowFor(name: string): HTMLElement {
  const row = screen.getByText(name).closest("tr");
  if (!row) throw new Error(`no row for ${name}`);
  return row;
}

async function mount(scenarios: Scenario[], servers: ServerConfig[]) {
  listScenarios.mockResolvedValue(scenarios);
  listProviders.mockResolvedValue([PROVIDER]);
  listServerTypes.mockResolvedValue([]);
  listSkills.mockResolvedValue([]);
  // `/api/servers` answers with the servers that still exist; a `…/latest-scan` for a server that
  // does not is exactly the 404 the audit saw, so it rejects here too.
  apiGet.mockImplementation(async (path: string) => {
    if (path === "/api/servers") return servers;
    if (path.endsWith("/latest-scan")) {
      const id = path.split("/")[3];
      if (servers.some((s) => s.id === id)) return { id: `scan_${id}` };
      throw new Error("Not found");
    }
    throw new Error(`unexpected path ${path}`);
  });

  render(
    <MemoryRouter initialEntries={["/testing/environments"]}>
      <TooltipProvider>
        <EnvironmentsView />
      </TooltipProvider>
    </MemoryRouter>,
  );
  await screen.findByText(scenarios[0]?.name ?? "");
}

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => {
  vi.clearAllMocks();
});

describe("EnvironmentsView — P2-4: a dangling server reference is visible (RM-36 WP 2.2)", () => {
  test("says so inline on the affected row, and stays quiet on every other row", async () => {
    await mount(
      [scenario("Dangling env", ["gone-server-id"]), scenario("Healthy env", ["srv-1"])],
      [serverConfig("srv-1", "assets")],
    );

    // The affected row says it, in words, on the page.
    expect(within(rowFor("Dangling env")).getByText("1 server no longer available")).toBeTruthy();
    // The row whose servers all resolve says nothing — the note is a signal, not decoration.
    expect(within(rowFor("Healthy env")).queryByText(/no longer available/)).toBeNull();
  });

  test("it is announced politely as a KNOWN state, never as a page-level error", async () => {
    await mount([scenario("Dangling env", ["gone-server-id"])], []);

    const note = within(rowFor("Dangling env")).getByRole("status");
    expect(note.textContent).toBe("1 server no longer available");
    // Not an alert, anywhere on the page: a deleted server is a known state of the data, not an
    // exceptional failure, so it must not paint as an error banner over the whole view.
    expect(screen.queryByRole("alert")).toBeNull();
  });

  test("counts every dangling reference, and keeps the Servers total honest", async () => {
    await mount([scenario("Dangling env", ["gone-a", "gone-b", "srv-1"])], [serverConfig("srv-1", "assets")]);

    const row = rowFor("Dangling env");
    expect(within(row).getByText("2 servers no longer available")).toBeTruthy();
    // The count column still reports what the environment REFERENCES (3), not what resolves —
    // the note explains the gap rather than the number silently shrinking.
    expect(within(row).getByText("3")).toBeTruthy();
  });

  test("an environment with no servers at all is not reported as dangling", async () => {
    await mount([scenario("Empty env", [])], []);
    expect(screen.queryByText(/no longer available/)).toBeNull();
    expect(within(rowFor("Empty env")).queryByRole("status")).toBeNull();
  });
});
