// Assistant Hub (WP2.5, R-MCP8 + R-SK3 "(slash)") — the composer command catalog: pure filter/parse
// helpers + the floating list's render/select behavior. `Composer.test.tsx` covers the end-to-end
// keyboard/slash-trigger wiring; this file covers this module's OWN logic in isolation.
import type { PromptGetResult } from "@mcp-token-footprint/shared";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("@brand/ai", () => import("./test-support/brand-ai-mock"));

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return { ...actual, apiPost: vi.fn() };
});

import * as api from "../../lib/api";
import {
  ComposerCommandList,
  extractPromptMessageText,
  filterComposerCommands,
  McpPromptArgsDialog,
  parseMcpPromptArgs,
  resolvePromptText,
  slugifyServerName,
  type ComposerCommandItem,
  type McpPromptCommandItem,
  type SkillCommandItem,
} from "./ComposerCommands";

function skillItem(overrides: Partial<SkillCommandItem> = {}): SkillCommandItem {
  return { kind: "skill", id: "skill:1", slug: "graphify", label: "/graphify", ...overrides };
}

function promptItem(overrides: Partial<McpPromptCommandItem> = {}): McpPromptCommandItem {
  return {
    kind: "prompt",
    id: "prompt:srv:summarize",
    serverId: "srv",
    serverName: "My Server",
    promptName: "summarize",
    label: "/mcp__my-server__summarize",
    args: [],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("slugifyServerName", () => {
  test("lowercases and hyphenates punctuation/spaces", () => {
    expect(slugifyServerName("My Filesystem Server!")).toBe("my-filesystem-server");
  });
  test("falls back to a generic slug when nothing alphanumeric survives", () => {
    expect(slugifyServerName("***")).toBe("server");
  });
});

describe("parseMcpPromptArgs", () => {
  test("required args sort first, non-array input yields none", () => {
    const args = parseMcpPromptArgs([
      { name: "topic" },
      { name: "audience", required: true, description: "who it's for" },
    ]);
    expect(args.map((a) => a.name)).toEqual(["audience", "topic"]);
    expect(parseMcpPromptArgs(null)).toEqual([]);
    expect(parseMcpPromptArgs("nope")).toEqual([]);
  });
  test("skips malformed entries (no string name)", () => {
    expect(parseMcpPromptArgs([{ description: "no name" }, { name: 5 }])).toEqual([]);
  });
});

describe("extractPromptMessageText", () => {
  test("joins every text content block, in order, across messages", () => {
    const messages = [
      { role: "user", content: { type: "text", text: "First." } },
      { role: "assistant", content: [{ type: "text", text: "Second." }, { type: "image", url: "x" }] },
    ];
    expect(extractPromptMessageText(messages)).toBe("First.\n\nSecond.");
  });
  test("non-array input yields empty text, never a crash", () => {
    expect(extractPromptMessageText(null)).toBe("");
    expect(extractPromptMessageText("nope")).toBe("");
  });
});

describe("filterComposerCommands", () => {
  const items: ComposerCommandItem[] = [
    skillItem({ id: "s1", slug: "graphify", hint: "Turn anything into a knowledge graph" }),
    skillItem({ id: "s2", slug: "deep-research", hint: "Multi-source research harness" }),
    promptItem({ id: "p1", promptName: "summarize", serverName: "Docs" }),
  ];

  test("empty query returns every item, unfiltered", () => {
    expect(filterComposerCommands(items, "")).toHaveLength(3);
  });
  test("matches a skill by slug substring", () => {
    expect(filterComposerCommands(items, "graph").map((i) => i.id)).toEqual(["s1"]);
  });
  test("matches a skill by its hint/description text", () => {
    expect(filterComposerCommands(items, "research").map((i) => i.id)).toEqual(["s2"]);
  });
  test("matches an MCP prompt by server name", () => {
    expect(filterComposerCommands(items, "docs").map((i) => i.id)).toEqual(["p1"]);
  });
  test("is case-insensitive and unmatched query yields an empty list", () => {
    expect(filterComposerCommands(items, "GRAPH")).toHaveLength(1);
    expect(filterComposerCommands(items, "nonexistent")).toHaveLength(0);
  });
});

describe("resolvePromptText", () => {
  test("resolves ok with the extracted message text on a successful get", async () => {
    vi.mocked(api.apiPost).mockResolvedValue({
      promptName: "summarize",
      isError: false,
      durationMs: 5,
      tokenProfile: "generic_o200k",
      requestTokens: 1,
      requestBytes: 1,
      responseTokens: 1,
      responseBytes: 1,
      messages: [{ role: "user", content: { type: "text", text: "Resolved prompt text." } }],
      raw: {},
    } satisfies PromptGetResult);
    const result = await resolvePromptText(promptItem(), {});
    expect(result).toEqual({ ok: true, text: "Resolved prompt text." });
  });

  test("resolves NOT ok when the server reports isError", async () => {
    vi.mocked(api.apiPost).mockResolvedValue({
      promptName: "summarize",
      isError: true,
      errorMessage: "prompt not found",
      durationMs: 5,
      tokenProfile: "generic_o200k",
      requestTokens: 0,
      requestBytes: 0,
      responseTokens: 0,
      responseBytes: 0,
      messages: [],
      raw: {},
    } satisfies PromptGetResult);
    const result = await resolvePromptText(promptItem(), {});
    expect(result).toEqual({ ok: false, error: "prompt not found" });
  });

  test("resolves NOT ok on a network/transport failure, never throws", async () => {
    vi.mocked(api.apiPost).mockRejectedValue(new Error("network down"));
    const result = await resolvePromptText(promptItem(), {});
    expect(result.ok).toBe(false);
  });
});

describe("ComposerCommandList", () => {
  test("groups skills and MCP prompts, shows the empty state when nothing matches", () => {
    const items: ComposerCommandItem[] = [skillItem(), promptItem()];
    const onSelect = vi.fn();
    render(
      <ComposerCommandList
        query=""
        items={items}
        loading={false}
        highlightedIndex={0}
        onHighlight={vi.fn()}
        onSelect={onSelect}
      />,
    );
    expect(screen.getByText("Skills")).toBeInTheDocument();
    expect(screen.getByText("MCP prompts")).toBeInTheDocument();
    expect(screen.getByText("/graphify")).toBeInTheDocument();
    expect(screen.getByText("/mcp__my-server__summarize")).toBeInTheDocument();
  });

  test("clicking a row calls onSelect with that item", () => {
    const onSelect = vi.fn();
    render(
      <ComposerCommandList
        query=""
        items={[skillItem()]}
        loading={false}
        highlightedIndex={0}
        onHighlight={vi.fn()}
        onSelect={onSelect}
      />,
    );
    fireEvent.click(screen.getByText("/graphify"));
    expect(onSelect).toHaveBeenCalledWith(skillItem());
  });

  test("no items shows loading, then a query-aware empty message", () => {
    const { rerender } = render(
      <ComposerCommandList
        query=""
        items={[]}
        loading
        highlightedIndex={0}
        onHighlight={vi.fn()}
        onSelect={vi.fn()}
      />,
    );
    expect(screen.getByText("Loading commands…")).toBeInTheDocument();

    rerender(
      <ComposerCommandList
        query="xyz"
        items={[]}
        loading={false}
        highlightedIndex={0}
        onHighlight={vi.fn()}
        onSelect={vi.fn()}
      />,
    );
    expect(screen.getByText("No matching commands.")).toBeInTheDocument();
  });
});

describe("McpPromptArgsDialog", () => {
  test("required-field validation blocks submit; filling it in resolves and calls onResolved", async () => {
    vi.mocked(api.apiPost).mockResolvedValue({
      promptName: "summarize",
      isError: false,
      durationMs: 5,
      tokenProfile: "generic_o200k",
      requestTokens: 1,
      requestBytes: 1,
      responseTokens: 1,
      responseBytes: 1,
      messages: [{ role: "user", content: { type: "text", text: "Summarized." } }],
      raw: {},
    } satisfies PromptGetResult);

    const item = promptItem({ args: [{ name: "topic", required: true }] });
    const onResolved = vi.fn();
    render(
      <McpPromptArgsDialog item={item} open onOpenChange={vi.fn()} onResolved={onResolved} />,
    );

    fireEvent.click(screen.getByRole("button", { name: /insert/i }));
    expect(screen.getByRole("alert")).toHaveTextContent("This field is required.");
    expect(api.apiPost).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("topic", { exact: false }), {
      target: { value: "release notes" },
    });
    fireEvent.click(screen.getByRole("button", { name: /insert/i }));

    await vi.waitFor(() => expect(onResolved).toHaveBeenCalledWith("Summarized."));
    expect(api.apiPost).toHaveBeenCalledWith(
      "/api/servers/srv/prompts/summarize/get",
      { arguments: { topic: "release notes" } },
    );
  });

  test("renders nothing when no item is targeted", () => {
    const { container } = render(
      <McpPromptArgsDialog item={null} open={false} onOpenChange={vi.fn()} onResolved={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
