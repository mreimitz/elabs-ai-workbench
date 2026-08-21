import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { TooltipProvider } from "@elabs-ai/components-ui";
import type { BoundTool, ServerType, SkillServerBinding } from "@mcp-token-footprint/shared";
import { ServersField } from "./ServersField";

// ── RM-30 WP 7.3 — the settings panel's SERVERS field ─────────────────────────────────────────────
// Two things are pinned here.
//
// 1. The type-vs-server chip distinction (server-types WP 3.2 A). That assertion used to live on the
//    Tools palette; WP 7.3 moved the binding surface into the settings panel, so the coverage moved
//    with it rather than being deleted. A type-resolved binding still renders its TYPE name, a "Type"
//    indicator and the type's lifecycle status; a plain server binding still renders as an ordinary
//    chip.
// 2. The thing WP 7.3 actually changed: bind and unbind STAGE on the draft. Nothing here may POST.

const BINDINGS: SkillServerBinding[] = [
  { serverName: "Acme-SaaS", serverId: "s-rep", typeId: "t-saas", resolvedVia: "type" },
  { serverName: "files", serverId: "s-files" },
];

const TYPES: ServerType[] = [
  {
    id: "t-saas",
    name: "Acme-SaaS",
    status: "production",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    memberCount: 2,
  },
];

const SERVERS = [
  { id: "s-rep", name: "Acme Prod B", transport: "stdio", typeId: "t-saas" },
  { id: "s-files", name: "files", transport: "stdio" },
  { id: "s-new", name: "never-scanned", transport: "stdio" },
];

const SCANS = [
  {
    serverId: "s-rep",
    status: "success",
    scannedAt: "2026-02-01T00:00:00.000Z",
    totalTools: 3,
  },
  { serverId: "s-files", status: "success", scannedAt: "2026-02-01T00:00:00.000Z", totalTools: 1 },
];

const BOUND_TOOLS: BoundTool[] = [
  {
    serverId: "s-files",
    serverName: "files",
    toolName: "read_file",
    schemaParams: [],
    definitionTokens: 20,
  },
];

const apiPostSpy = vi.fn(async (_path: string, _body?: unknown): Promise<unknown> => ({}));

vi.mock("../../skills-inspector-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../skills-inspector-api")>();
  return {
    ...actual,
    fetchSkillBindings: vi.fn(async () => BINDINGS),
    getBoundTools: vi.fn(async () => BOUND_TOOLS),
  };
});

vi.mock("../../../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../lib/api")>();
  return {
    ...actual,
    apiGet: vi.fn(async (url: string) =>
      url === "/api/servers" ? SERVERS : url === "/api/scans" ? SCANS : [],
    ),
    apiPost: (...args: unknown[]) => apiPostSpy(...(args as Parameters<typeof apiPostSpy>)),
    listServerTypes: vi.fn(async () => TYPES),
  };
});

// jsdom omits matchMedia / ResizeObserver (Radix reads them).
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

function renderField(
  overrides: Partial<Parameters<typeof ServersField>[0]> = {},
): { onBind: ReturnType<typeof vi.fn>; onUnbind: ReturnType<typeof vi.fn> } {
  const onBind = vi.fn();
  const onUnbind = vi.fn();
  render(
    <MemoryRouter>
      <TooltipProvider>
        <ServersField
          skillId="sk-1"
          versionId="ver-1"
          declaredServers={["Acme-SaaS", "files"]}
          onBind={onBind}
          onUnbind={onUnbind}
          blockedReason={null}
          {...overrides}
        />
      </TooltipProvider>
    </MemoryRouter>,
  );
  return { onBind, onUnbind };
}

describe("ServersField — chips (the WP 3.2 A distinction, moved from the palette)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiPostSpy.mockClear();
  });

  test("a type-bound entry renders its type name, a Type indicator, and the lifecycle status", async () => {
    renderField();
    expect(await screen.findByText("Acme-SaaS")).toBeTruthy();
    expect(await screen.findByText("Type")).toBeTruthy();
    expect(await screen.findByText("Production")).toBeTruthy();
  });

  test("a plain server binding still renders as an ordinary server chip", async () => {
    renderField();
    expect(await screen.findByText("files")).toBeTruthy();
    const typeLabels = await screen.findAllByText("Type");
    expect(typeLabels).toHaveLength(1);
  });
});

describe("ServersField — binding STAGES on the draft (D-UX18 closed)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiPostSpy.mockClear();
  });

  test("binding a server calls onBind and POSTs nothing", async () => {
    const { onBind } = renderField({ declaredServers: [] });
    fireEvent.click(await screen.findByTestId("settings-bind-server"));
    // One bindable row per registered server; pick the never-scanned one to prove an unscanned
    // server is still bindable (binding is a declaration, not a connection).
    const bindButtons = await screen.findAllByRole("button", { name: "Bind" });
    expect(bindButtons.length).toBeGreaterThan(0);
    fireEvent.click(bindButtons[bindButtons.length - 1] as HTMLElement);
    await waitFor(() => expect(onBind).toHaveBeenCalledTimes(1));
    // The whole point of the WP: no immediate save.
    expect(apiPostSpy).not.toHaveBeenCalled();
  });

  test("unbinding goes through a confirm and then calls onUnbind — still no POST", async () => {
    const { onUnbind } = renderField();
    fireEvent.click(await screen.findByRole("button", { name: "Unbind server files" }));
    fireEvent.click(await screen.findByRole("button", { name: "Unbind" }));
    await waitFor(() => expect(onUnbind).toHaveBeenCalledWith("files"));
    expect(apiPostSpy).not.toHaveBeenCalled();
  });

  test("an older version makes the field read-only: no bind action, no unbind ×", async () => {
    renderField({ blockedReason: "This is an older version." });
    expect(await screen.findByText("This is an older version.")).toBeTruthy();
    expect((screen.getByTestId("settings-bind-server") as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole("button", { name: "Unbind server files" })).toBeNull();
  });
});

describe("ServersField — inline Scan now (audit SI1)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiPostSpy.mockClear();
  });

  test("a never-scanned row offers Scan now, and it is the ONLY thing here that reaches a server", async () => {
    apiPostSpy.mockResolvedValueOnce({ status: "success", totalTools: 2, totalTokens: 100 });
    renderField({ declaredServers: [] });
    fireEvent.click(await screen.findByTestId("settings-bind-server"));

    // Exactly one row has no completed scan in the fixture, so exactly one "Scan now" is offered.
    const scanButtons = await screen.findAllByRole("button", { name: /Scan now/ });
    expect(scanButtons).toHaveLength(1);

    fireEvent.click(scanButtons[0] as HTMLElement);
    await waitFor(() => expect(apiPostSpy).toHaveBeenCalledTimes(1));
    expect(apiPostSpy.mock.calls[0]?.[0]).toBe("/api/servers/s-new/scan");
  });
});
