import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { TooltipProvider } from "@elabs-ai/components-ui";
import type { BoundTool, ServerType, SkillServerBinding } from "@mcp-token-footprint/shared";
import { SkillBindingsPanel } from "./SkillBindingsPanel";

// The relocated skill↔server binding surface (out of the parked Design-tab palette, now reachable
// from Overview + Files). This locks the rendered distinctions the palette test used to cover:
// a TYPE-resolved binding renders distinctly from a plain server binding; the head-vs-non-head gate
// makes the chips read-only; and a host `blockedReason` disables the Bind action. Fetches are mocked
// at the module seam — never a real network / MCP call. The pure derivations are already covered by
// bind-server-candidates.test.ts + binding-display.test.ts.

const SKILL_MD = [
  "---",
  "name: demo",
  "description: A demo skill for the bindings-panel test.",
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

// The representative's tools (grouped under its own name — how WP 3.1 bound-tools reports them).
const BOUND_TOOLS: BoundTool[] = [
  { serverId: "s-rep", serverName: "Acme Prod B", toolName: "get_app", schemaParams: [], definitionTokens: 40 },
  { serverId: "s-files", serverName: "files", toolName: "read_file", schemaParams: [], definitionTokens: 20 },
];

vi.mock("./skills-inspector-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./skills-inspector-api")>();
  return {
    ...actual,
    getSkill: vi.fn(async () => ({}) as never),
    getSkillFile: vi.fn(async () => ({ path: "SKILL.md", isBinary: false, text: SKILL_MD }) as never),
    fetchSkillBindings: vi.fn(async () => BINDINGS),
    getBoundTools: vi.fn(async () => BOUND_TOOLS),
  };
});

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return {
    ...actual,
    apiGet: vi.fn(async (url: string) => (url === "/api/servers" ? SERVERS : [])),
    apiPost: vi.fn(async () => ({})),
    listServerTypes: vi.fn(async () => TYPES),
  };
});

// jsdom omits matchMedia (Radix Tooltip/Dialog read it).
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

function renderPanel(overrides?: {
  isHeadVersion?: boolean;
  blockedReason?: string | null;
}) {
  return render(
    <MemoryRouter>
      <TooltipProvider>
        <SkillBindingsPanel
          skillId="sk-1"
          versionId="ver-1"
          isHeadVersion={overrides?.isHeadVersion ?? true}
          skillMdText={SKILL_MD}
          blockedReason={overrides?.blockedReason ?? null}
          onVersionSaved={() => {}}
        />
      </TooltipProvider>
    </MemoryRouter>,
  );
}

describe("SkillBindingsPanel", () => {
  beforeEach(() => vi.clearAllMocks());

  test("renders a type-resolved binding distinctly (type name + Type indicator + status) with a representative", async () => {
    renderPanel();
    // Wait for the settled state (a "Type" indicator exists only once the resolved bindings land and
    // upgrade the transient server chip to a TYPE chip) before reading the rest, so an assertion never
    // captures a chip node that the resolution re-render is about to swap out.
    expect(await screen.findByText("Type")).toBeInTheDocument();
    // The type chip carries the TYPE name + the "Production" lifecycle status.
    expect(screen.getByText("Acme-SaaS")).toBeInTheDocument();
    expect(screen.getByText("Production")).toBeInTheDocument();
    // A plain server binding is present and is NOT labeled a Type (exactly one "Type" indicator).
    expect(screen.getByText("files")).toBeInTheDocument();
    expect(screen.getAllByText("Type")).toHaveLength(1);
  });

  test("head version is editable: the Bind action + per-chip unbind controls are present", async () => {
    renderPanel({ isHeadVersion: true });
    expect(await screen.findByRole("button", { name: /^Bind server/i })).toBeEnabled();
    // Each resolved chip exposes an unbind × once bindings resolve.
    expect(await screen.findByLabelText("Unbind server type Acme-SaaS")).toBeInTheDocument();
    expect(await screen.findByLabelText("Unbind server files")).toBeInTheDocument();
  });

  test("a NON-head version is read-only: no Bind action, no unbind controls, and a hint shows", async () => {
    renderPanel({ isHeadVersion: false });
    // The chips still render (wait for the type chip to resolve) …
    expect(await screen.findByText("Type")).toBeInTheDocument();
    // … but there is no Bind action and no unbind control, plus the "switch to Latest" hint.
    expect(screen.queryByRole("button", { name: /^Bind server/i })).toBeNull();
    expect(screen.queryByLabelText("Unbind server type Acme-SaaS")).toBeNull();
    expect(screen.getByText(/switch to Latest/i)).toBeInTheDocument();
  });

  test("a host blockedReason disables the Bind action and surfaces the reason inline", async () => {
    renderPanel({
      isHeadVersion: true,
      blockedReason: "Save or discard your file edits first — binding saves a new version.",
    });
    expect(await screen.findByRole("button", { name: /^Bind server/i })).toBeDisabled();
    // The reason renders inline (the warning Alert), and blocked chips expose no unbind control.
    expect(screen.getByText(/Save or discard your file edits first/i)).toBeInTheDocument();
    expect(screen.queryByLabelText("Unbind server files")).toBeNull();
  });
});
