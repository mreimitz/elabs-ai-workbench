import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { TooltipProvider } from "@brand/ui";
import type { BoundTool, ServerType, SkillGraph, SkillServerBinding } from "@mcp-token-footprint/shared";
import { SkillBindingHostContext } from "./bind-server-context";
import { ToolsPalette } from "./ToolsPalette";

// Server-types WP 3.2 (A) — the palette renders a TYPE-resolved binding distinctly from a plain server
// binding: the type name + a "Type" indicator + the type's lifecycle status + the resolved
// representative, next to an ordinary server chip. Fetches are mocked at the module seam (never a real
// network / MCP call). The pure classification is locked in binding-display.test.ts; this asserts the
// rendered distinction.

const SKILL_MD = [
  "---",
  "name: demo",
  "description: A demo skill for the palette render test.",
  "servers:",
  "  - Acme-SaaS",
  "  - files",
  "---",
  "",
  "# Demo",
  "",
  "Body.",
  "",
].join("\n");

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
  { id: "s-rep", name: "Acme Prod B" },
  { id: "s-files", name: "files" },
];

vi.mock("../skills-inspector-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../skills-inspector-api")>();
  return {
    ...actual,
    getSkill: vi.fn(async () => ({}) as never),
    getSkillFile: vi.fn(async () => ({ path: "SKILL.md", isBinary: false, text: SKILL_MD }) as never),
    fetchSkillBindings: vi.fn(async () => BINDINGS),
  };
});

vi.mock("../../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/api")>();
  return {
    ...actual,
    apiGet: vi.fn(async (url: string) => (url === "/api/servers" ? SERVERS : [])),
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

const graph: SkillGraph = { nodes: [], edges: [], warnings: [] };

// The representative's tools (grouped under its own name — how WP 3.1 bound-tools reports them).
const boundTools: BoundTool[] = [
  {
    serverId: "s-rep",
    serverName: "Acme Prod B",
    toolName: "get_app",
    schemaParams: [],
    definitionTokens: 40,
  },
  {
    serverId: "s-files",
    serverName: "files",
    toolName: "read_file",
    schemaParams: [],
    definitionTokens: 20,
  },
];

function renderPalette() {
  return render(
    <MemoryRouter>
      <TooltipProvider>
        <SkillBindingHostContext.Provider
          value={{ skillId: "sk-1", versionId: "ver-1", editorDirty: false }}
        >
          <ToolsPalette
            graph={graph}
            boundTools={boundTools}
            loading={false}
            editMode={false}
            canInsert={false}
            onInsertTool={() => {}}
          />
        </SkillBindingHostContext.Provider>
      </TooltipProvider>
    </MemoryRouter>,
  );
}

describe("ToolsPalette — type-vs-server chips (WP 3.2 A)", () => {
  beforeEach(() => vi.clearAllMocks());

  test("a type-bound entry renders its type name, a Type indicator, and the lifecycle status", async () => {
    renderPalette();
    // The type chip carries the TYPE name + a "Type" indicator + the "Production" status badge.
    expect(await screen.findByText("Acme-SaaS")).toBeTruthy();
    expect(await screen.findByText("Type")).toBeTruthy();
    expect(await screen.findByText("Production")).toBeTruthy();
  });

  test("a plain server binding still renders as an ordinary server chip", async () => {
    renderPalette();
    // "files" is a plain server binding — present, and NOT labeled a Type (only one "Type" indicator).
    expect(await screen.findByText("files")).toBeTruthy();
    const typeLabels = await screen.findAllByText("Type");
    expect(typeLabels).toHaveLength(1);
  });
});
