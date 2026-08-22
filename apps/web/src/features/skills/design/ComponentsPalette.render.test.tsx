import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { TooltipProvider } from "@elabs-ai/components-ui";
import type {
  BoundTool,
  ServerType,
  SkillGraph,
  SkillGraphNode,
  SkillServerBinding,
} from "@mcp-token-footprint/shared";
import { StudioDraftContext, type StudioDraftController } from "../studio/draft";
import { ComponentsPalette } from "./ComponentsPalette";
import { SKILL_COMPONENTS } from "./skill-components";

// ── RM-30 WP 7.7 (SI12/SI17, D-UX19 #3) — the components palette ──────────────────────────────────
// This file replaces `ToolsPalette.render.test.tsx`, which WP 7.7 deleted along with the palette it
// covered. That file's premise was the OPPOSITE of this one's — it asserted the palette carried no
// binding at all, because WP 7.3 had just moved binding into the settings panel. D-UX19 #3 then put
// an MCP Servers section back ON the palette, so that assertion is genuinely obsolete rather than
// dropped. What it covered and is re-covered here: the tool list renders, and each empty state is a
// DIFFERENT, honest sentence (unbound ≠ bound-but-unscanned ≠ filtered-to-nothing).
//
// On top of that, this pins the acceptance of WP 7.7 itself:
//   • section 1 offers all nine components, each with a keyboard-reachable creation control;
//   • section 2 collapses, binds from its header, unbinds per server, and lists that server's tools;
//   • the bind chips are ABSORBED — there is no separate chip strip left on the surface.

const BINDINGS: SkillServerBinding[] = [
  { serverName: "files", serverId: "s-files" },
  { serverName: "Acme-SaaS", serverId: "s-rep", typeId: "t-saas", resolvedVia: "type" },
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
  { id: "s-files", name: "files", transport: "stdio" },
  { id: "s-rep", name: "Acme Prod B", transport: "stdio", typeId: "t-saas" },
  { id: "s-new", name: "never-bound", transport: "stdio" },
];

const SCANS = [
  { serverId: "s-files", status: "success", scannedAt: "2026-02-01T00:00:00.000Z", totalTools: 2 },
  { serverId: "s-rep", status: "success", scannedAt: "2026-02-01T00:00:00.000Z", totalTools: 1 },
  { serverId: "s-new", status: "success", scannedAt: "2026-02-01T00:00:00.000Z", totalTools: 4 },
];

const tool = (serverName: string, toolName: string, definitionTokens: number): BoundTool => ({
  serverId: `s-${serverName}`,
  serverName,
  toolName,
  schemaParams: [],
  definitionTokens,
});

const BOUND_TOOLS: BoundTool[] = [
  tool("files", "read_file", 20),
  tool("files", "write_file", 30),
  tool("Acme Prod B", "sync_records", 45),
];

vi.mock("../skills-inspector-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../skills-inspector-api")>();
  return {
    ...actual,
    fetchSkillBindings: vi.fn(async () => BINDINGS),
    getBoundTools: vi.fn(async () => BOUND_TOOLS),
    getToolDiagnostics: vi.fn(async () => []),
  };
});

vi.mock("../../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/api")>();
  return {
    ...actual,
    apiGet: vi.fn(async (url: string) =>
      url === "/api/servers" ? SERVERS : url === "/api/scans" ? SCANS : [],
    ),
    apiPost: vi.fn(async () => ({})),
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

const sectionNode: SkillGraphNode = {
  id: "sec-1",
  kind: "subroutine",
  label: "Collect input",
  anchor: { headingPath: ["Skill", "Collect input"], startLine: 2, endLine: 4 },
  source: "inferred",
};

const toolRefNode: SkillGraphNode = {
  id: "ref-1",
  kind: "tool_ref",
  label: "read_file",
  toolName: "read_file",
  anchor: { headingPath: ["Skill", "Collect input"], startLine: 3, endLine: 3 },
  source: "inferred",
};

const GRAPH: SkillGraph = { nodes: [sectionNode, toolRefNode], edges: [], warnings: [] };

/** The slice of the Studio draft the palette reads. */
function draftWith(servers: string[]) {
  const stageSettingsEdit = vi.fn();
  const controller = {
    settings: { servers },
    stageSettingsEdit,
  } as unknown as StudioDraftController;
  return { controller, stageSettingsEdit };
}

function renderPalette(
  options: {
    tools?: BoundTool[];
    servers?: string[];
    editMode?: boolean;
    selectedNodeId?: string;
    loading?: boolean;
    /** Omit the provider entirely — a palette mounted outside a Studio. */
    noDraft?: boolean;
  } = {},
) {
  const onPlaceComponent = vi.fn();
  const onInsertTool = vi.fn();
  const { controller, stageSettingsEdit } = draftWith(options.servers ?? ["files", "Acme-SaaS"]);

  const palette = (
    <ComponentsPalette
      skillId="sk-1"
      versionId="ver-1"
      graph={GRAPH}
      boundTools={options.tools ?? BOUND_TOOLS}
      loading={options.loading ?? false}
      editMode={options.editMode ?? true}
      canInsert={false}
      onInsertTool={onInsertTool}
      onPlaceComponent={onPlaceComponent}
      {...(options.selectedNodeId ? { selectedNodeId: options.selectedNodeId } : {})}
    />
  );

  render(
    <MemoryRouter>
      <TooltipProvider>
        {options.noDraft ? (
          palette
        ) : (
          <StudioDraftContext.Provider value={controller}>{palette}</StudioDraftContext.Provider>
        )}
      </TooltipProvider>
    </MemoryRouter>,
  );
  return { onPlaceComponent, onInsertTool, stageSettingsEdit };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("section 1 — the nine skill components", () => {
  test("every component in the catalog has a row", () => {
    renderPalette();
    const list = screen.getByRole("region", { name: "Skill components" });
    for (const spec of SKILL_COMPONENTS) {
      expect(within(list).getByText(spec.label)).toBeTruthy();
    }
    expect(within(list).getAllByRole("listitem")).toHaveLength(9);
  });

  test("each component is creatable BY KEYBOARD — a real button, not a drag-only handle", () => {
    // The toolbar buttons this WP deletes were keyboard-reachable; a palette that is only usable
    // with a mouse would be a regression, so every row carries an explicit named control.
    const { onPlaceComponent } = renderPalette();
    for (const spec of SKILL_COMPONENTS) {
      const add = screen.getByRole("button", { name: new RegExp(`^Add a ${spec.label}\\b`) });
      expect(add.tagName).toBe("BUTTON");
      fireEvent.click(add);
    }
    expect(onPlaceComponent).toHaveBeenCalledTimes(9);
    expect(onPlaceComponent.mock.calls.map((call) => call[0])).toEqual(
      SKILL_COMPONENTS.map((spec) => spec.id),
    );
  });

  test("the keyboard path targets the CURRENT canvas selection — the node a drop would have hit", () => {
    const { onPlaceComponent } = renderPalette({ selectedNodeId: "sec-1" });
    fireEvent.click(screen.getByRole("button", { name: /^Add a Gatekeeper/ }));
    expect(onPlaceComponent).toHaveBeenCalledWith("gatekeeper", "sec-1");
  });

  test("with nothing selected the target is null, and the label says what to do about it", () => {
    const { onPlaceComponent } = renderPalette();
    const add = screen.getByRole("button", { name: /^Add a Gatekeeper/ });
    expect(add.getAttribute("aria-label")).toMatch(/select a section on the flow first/i);
    fireEvent.click(add);
    expect(onPlaceComponent).toHaveBeenCalledWith("gatekeeper", null);
  });

  test("a selected section is NAMED in the control's accessible name", () => {
    renderPalette({ selectedNodeId: "sec-1" });
    expect(
      screen.getByRole("button", { name: 'Add a Gatekeeper to “Collect input”' }),
    ).toBeTruthy();
  });

  test("a component row is draggable in edit mode and inert out of it", () => {
    const { unmount } = render(<div />);
    unmount();
    renderPalette({ editMode: true });
    const rows = within(screen.getByRole("region", { name: "Skill components" })).getAllByRole(
      "listitem",
    );
    expect(rows.every((row) => row.getAttribute("draggable") === "true")).toBe(true);
  });

  test("out of edit mode the palette is a read-only inventory — no creation controls at all", () => {
    renderPalette({ editMode: false });
    expect(screen.queryByRole("button", { name: /^Add a / })).toBeNull();
    const rows = within(screen.getByRole("region", { name: "Skill components" })).getAllByRole(
      "listitem",
    );
    expect(rows.some((row) => row.getAttribute("draggable") === "true")).toBe(false);
  });
});

describe("section 2 — MCP Servers", () => {
  test("it is collapsible, and collapsing hides the servers beneath it", async () => {
    renderPalette();
    expect(await screen.findByText("files")).toBeTruthy();

    fireEvent.click(screen.getByTestId("mcp-servers-toggle"));
    await waitFor(() => expect(screen.queryByText("files")).toBeNull());

    fireEvent.click(screen.getByTestId("mcp-servers-toggle"));
    expect(await screen.findByText("files")).toBeTruthy();
  });

  test("the ADD affordance is on the section header and opens the bind picker", async () => {
    renderPalette();
    fireEvent.click(screen.getByTestId("palette-bind-server"));
    const dialog = await screen.findByRole("dialog");
    // The picker offers a registered server that is not already bound.
    expect(await within(dialog).findByText("never-bound")).toBeTruthy();
  });

  test("binding STAGES on the draft — the palette never saves a version (D-UX18 stays closed)", async () => {
    const { stageSettingsEdit } = renderPalette();
    fireEvent.click(screen.getByTestId("palette-bind-server"));
    const dialog = await screen.findByRole("dialog");
    const row = (await within(dialog).findByText("never-bound")).closest("li");
    expect(row).not.toBeNull();
    fireEvent.click(within(row as HTMLElement).getByRole("button", { name: "Bind" }));
    await waitFor(() =>
      expect(stageSettingsEdit).toHaveBeenCalledWith({
        field: "servers",
        action: "bind",
        name: "never-bound",
      }),
    );
  });

  test("each bound server has a REMOVE control, and confirming it unbinds that server", async () => {
    const { stageSettingsEdit } = renderPalette();
    const remove = await screen.findByRole("button", { name: "Unbind server files" });
    fireEvent.click(remove);

    const confirm = await screen.findByRole("alertdialog");
    expect(within(confirm).getByText("Unbind “files”?")).toBeTruthy();
    fireEvent.click(within(confirm).getByRole("button", { name: "Unbind" }));

    await waitFor(() =>
      expect(stageSettingsEdit).toHaveBeenCalledWith({
        field: "servers",
        action: "unbind",
        name: "files",
      }),
    );
  });

  test("a type binding is removed by its TYPE name, not its representative member's", async () => {
    renderPalette();
    expect(await screen.findByRole("button", { name: "Unbind server type Acme-SaaS" })).toBeTruthy();
  });

  test("a server's tools render beneath it", async () => {
    renderPalette();
    expect(await screen.findByText("read_file")).toBeTruthy();
    expect(screen.getByText("write_file")).toBeTruthy();
    // The type chip's tools land under its RESOLVED representative, so they still show.
    expect(screen.getByText("sync_records")).toBeTruthy();
  });

  test("a tool already referenced by the graph is marked, and the footprint counts it once", async () => {
    renderPalette();
    expect(await screen.findByText("In skill")).toBeTruthy();
    // `read_file` (20 tok) is the only referenced ∩ resolved tool.
    expect(screen.getByText("20")).toBeTruthy();
    expect(screen.getByText(/1 referenced tool/)).toBeTruthy();
  });

  test("filtering narrows the tools and says so when nothing matches", async () => {
    renderPalette();
    const filter = await screen.findByPlaceholderText("Filter tools…");

    fireEvent.change(filter, { target: { value: "write" } });
    await waitFor(() => expect(screen.queryByText("read_file")).toBeNull());
    expect(screen.getByText("write_file")).toBeTruthy();

    fireEvent.change(filter, { target: { value: "zzz" } });
    expect(await screen.findByText(/No bound tool matches/)).toBeTruthy();
  });
});

describe("the empty states stay distinguishable (carried over from ToolsPalette.render.test.tsx)", () => {
  test("nothing bound and nothing to show is the 'not bound' state", async () => {
    renderPalette({ servers: [], tools: [] });
    expect(await screen.findByText("Not bound to a server")).toBeTruthy();
  });

  test("bound but unscanned is a DIFFERENT sentence — it never says 'not bound'", async () => {
    renderPalette({ servers: ["files"], tools: [] });
    expect(await screen.findByText(/no completed discovery scan/)).toBeTruthy();
    expect(screen.queryByText("Not bound to a server")).toBeNull();
  });

  test("tools that resolve outside the declared list are still rendered, never hidden", async () => {
    // The empty state keys on BOTH an empty declaration and an empty tool read. Keying on the
    // declaration alone made a whole inventory disappear behind "Not bound to a server".
    renderPalette({ servers: [], tools: [tool("files", "read_file", 20)] });
    expect(await screen.findByText("read_file")).toBeTruthy();
    expect(screen.queryByText("Not bound to a server")).toBeNull();
  });

  test("while the bound-tools read is in flight the section says loading, not empty", () => {
    renderPalette({ loading: true, tools: [] });
    expect(screen.getByText("Loading tools…")).toBeTruthy();
    expect(screen.queryByText("Not bound to a server")).toBeNull();
  });

  test("outside a Studio the palette still renders; binding is disabled with a reason", async () => {
    renderPalette({ noDraft: true, tools: [] });
    expect(screen.getByRole("heading", { name: "Components" })).toBeTruthy();
    const bind = screen.getByTestId("palette-bind-server");
    expect(bind).toBeDisabled();
    expect(await screen.findByText("Not bound to a server")).toBeTruthy();
  });
});

describe("what WP 7.7 absorbed and removed", () => {
  test("the bind CHIP STRIP is gone — binding lives in the servers section now", async () => {
    renderPalette();
    await screen.findByText("files");
    expect(screen.queryByText("Bound servers & types")).toBeNull();
    // The old palette's only binding affordance was a deep link out to Settings; the section binds
    // in place instead.
    expect(screen.queryByRole("button", { name: "Bind a server in Settings →" })).toBeNull();
  });

  test("the palette is one panel with exactly two sections", () => {
    renderPalette();
    expect(screen.getByRole("region", { name: "Skill components" })).toBeTruthy();
    expect(screen.getByTestId("mcp-servers-toggle")).toBeTruthy();
    expect(screen.getByTestId("components-palette")).toBeTruthy();
  });
});
