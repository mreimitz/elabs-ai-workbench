import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, test, vi } from "vitest";
import { TooltipProvider } from "@elabs-ai/components-ui";
import type { BoundTool, SkillGraph } from "@mcp-token-footprint/shared";
import { StudioDraftContext, type StudioDraftController } from "../studio/draft";
import { ToolsPalette } from "./ToolsPalette";

// ── RM-30 WP 7.3 — the palette is about TOOLS ─────────────────────────────────────────────────────
// WP 7.3a had put the whole binding surface in here (chips, a picker, unbind) on an immediate-save
// path. WP 7.3 moved it into the Studio's one settings panel, against the shared draft — so what is
// asserted here is that the palette carries NO binding management at all, and that its empty state
// deep-links the place that does. The type-vs-server chip coverage moved with the surface, to
// `studio/settings/ServersField.test.tsx`; it was not dropped.

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

const graph: SkillGraph = { nodes: [], edges: [], warnings: [] };

const boundTools: BoundTool[] = [
  {
    serverId: "s-files",
    serverName: "files",
    toolName: "read_file",
    schemaParams: [],
    definitionTokens: 20,
  },
];

/** The slice of the Studio draft the palette reads — only the declared `servers:` list. */
function draftWithServers(servers: string[]): StudioDraftController {
  return { settings: { servers } } as unknown as StudioDraftController;
}

function renderPalette(options: {
  tools?: BoundTool[];
  servers?: string[];
  onOpenServerSettings?: () => void;
  /** Omit the provider entirely — a palette mounted outside a Studio. */
  noDraft?: boolean;
}) {
  const palette = (
    <ToolsPalette
      graph={graph}
      boundTools={options.tools ?? []}
      loading={false}
      editMode={false}
      canInsert={false}
      onInsertTool={() => {}}
      {...(options.onOpenServerSettings
        ? { onOpenServerSettings: options.onOpenServerSettings }
        : {})}
    />
  );
  return render(
    <MemoryRouter>
      <TooltipProvider>
        {options.noDraft ? (
          palette
        ) : (
          <StudioDraftContext.Provider value={draftWithServers(options.servers ?? [])}>
            {palette}
          </StudioDraftContext.Provider>
        )}
      </TooltipProvider>
    </MemoryRouter>,
  );
}

describe("ToolsPalette — no binding management (WP 7.3 moved it to Settings)", () => {
  test("there is no bind picker, no bound-server chip list, and no unbind control", () => {
    renderPalette({ tools: boundTools, servers: ["files"] });
    expect(screen.queryByRole("button", { name: "Bind server…" })).toBeNull();
    expect(screen.queryByText("Bound servers & types")).toBeNull();
    expect(screen.queryByRole("button", { name: /^Unbind/ })).toBeNull();
  });

  test("it still lists the bound servers' tools", () => {
    renderPalette({ tools: boundTools, servers: ["files"] });
    expect(screen.getByText("read_file")).toBeTruthy();
  });
});

describe("ToolsPalette — the empty state deep-links Settings", () => {
  test("with nothing bound, the only action opens the host's server settings", () => {
    const onOpenServerSettings = vi.fn();
    renderPalette({ tools: [], servers: [], onOpenServerSettings });

    expect(screen.getByText("Not bound to a server")).toBeTruthy();
    const action = screen.getByRole("button", { name: "Bind a server in Settings →" });
    fireEvent.click(action);
    expect(onOpenServerSettings).toHaveBeenCalledTimes(1);
  });

  test("bound but unscanned is a DIFFERENT state — it never tells you to bind again", () => {
    renderPalette({ tools: [], servers: ["files"], onOpenServerSettings: vi.fn() });
    expect(screen.getByText("No tools from the bound servers")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Bind a server in Settings →" })).toBeNull();
  });

  test("with no host to deep-link to, the empty state offers no dead control", () => {
    renderPalette({ tools: [], servers: [] });
    expect(screen.getByText("Not bound to a server")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Bind a server/ })).toBeNull();
  });

  test("outside a Studio the palette still renders — it just knows of no declared servers", () => {
    renderPalette({ tools: [], noDraft: true });
    expect(screen.getByText("Not bound to a server")).toBeTruthy();
  });
});
