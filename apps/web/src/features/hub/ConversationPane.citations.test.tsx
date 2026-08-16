import type { ReactNode } from "react";
import type { HubCitation, HubSession } from "@mcp-token-footprint/shared";
import { render as rtlRender, screen, within } from "@testing-library/react";
import { TooltipProvider } from "@brand/ui";
import { describe, expect, test, vi } from "vitest";

/**
 * WP3.1 (RC4) regression — the live synthesis SHAPE (`analysis.md` §2/§3.RC4: a mission synthesis
 * `parts[0].text` starting `## Synthesis:`, `[1]` markers, `citations:[{id:"1",…}]`, plus a markdown
 * table) rendering as REAL markdown WITH inline citation chips, not raw `##`/`[1]`/`|—|` text.
 *
 * `ConversationPane.test.tsx`'s shared `test-support/brand-ai-mock` stubs `MessageResponse` to a bare
 * `<div>{children}</div>` passthrough (like every other hub suite — real Streamdown can't load in
 * jsdom, see that mock's own doc comment) — which would swallow the `components` override entirely and
 * prove nothing about the actual weave. This file composes a FAITHFUL `MessageResponse` on top of that
 * same shared mock (only `MessageResponse` differs): it parses ATX headings, blank-line paragraphs, and
 * a GFM table out of the markdown text itself, and — like the real Streamdown — looks up each tag in
 * the `components` override map it's handed, falling back to the native DOM tag when a tag has no
 * override. That means the REAL `citationMarkdownComponents` (`SourcesPanel.tsx`) production code runs
 * for real here, including its `@brand/ui` `Table*` styling — this file is not re-testing a fake.
 */
vi.mock("@brand/ai", async () => {
  const mock = await import("./test-support/brand-ai-mock");

  type Block =
    | { kind: "heading"; level: number; text: string }
    | { kind: "paragraph"; text: string }
    | { kind: "table"; header: string[]; rows: string[][] };

  function splitRow(line: string): string[] {
    return line
      .trim()
      .replace(/^\|/, "")
      .replace(/\|$/, "")
      .split("|")
      .map((cell) => cell.trim());
  }

  function parseBlocks(markdown: string): Block[] {
    const lines = markdown.split("\n");
    const blocks: Block[] = [];
    let paraBuf: string[] = [];
    const flushPara = () => {
      const text = paraBuf.join(" ").trim();
      paraBuf = [];
      if (text) blocks.push({ kind: "paragraph", text });
    };
    let i = 0;
    while (i < lines.length) {
      const line = lines[i] ?? "";
      const headingMatch = /^(#{1,6})\s+(.*)$/.exec(line);
      if (headingMatch) {
        flushPara();
        const hashes = headingMatch[1] ?? "#";
        blocks.push({ kind: "heading", level: hashes.length, text: (headingMatch[2] ?? "").trim() });
        i++;
        continue;
      }
      const next = lines[i + 1] ?? "";
      const isDelimiter = /^\s*\|?[\s:|-]*-[\s:|-]*\|?\s*$/.test(next) && next.includes("-");
      if (line.includes("|") && isDelimiter) {
        flushPara();
        const header = splitRow(line);
        i += 2;
        const rows: string[][] = [];
        while (i < lines.length && (lines[i] ?? "").includes("|")) {
          rows.push(splitRow(lines[i] ?? ""));
          i++;
        }
        blocks.push({ kind: "table", header, rows });
        continue;
      }
      if (line.trim() === "") {
        flushPara();
        i++;
        continue;
      }
      paraBuf.push(line);
      i++;
    }
    flushPara();
    return blocks;
  }

  function FaithfulMessageResponse({
    children,
    components,
  }: {
    children?: string;
    // biome-ignore lint/suspicious/noExplicitAny: a faithful-but-loose stand-in for Streamdown's own Components map.
    components?: Record<string, any>;
  }) {
    const blocks = parseBlocks(children ?? "");
    return (
      <div data-testid="faithful-markdown">
        {blocks.map((block, i) => {
          if (block.kind === "heading") {
            const Tag = components?.[`h${block.level}`] ?? `h${block.level}`;
            return <Tag key={i}>{block.text}</Tag>;
          }
          if (block.kind === "paragraph") {
            const P = components?.p ?? "p";
            return <P key={i}>{block.text}</P>;
          }
          const TableC = components?.table ?? "table";
          const TheadC = components?.thead ?? "thead";
          const TbodyC = components?.tbody ?? "tbody";
          const TrC = components?.tr ?? "tr";
          const ThC = components?.th ?? "th";
          const TdC = components?.td ?? "td";
          return (
            <TableC key={i}>
              <TheadC>
                <TrC>
                  {block.header.map((h, hi) => (
                    <ThC key={hi}>{h}</ThC>
                  ))}
                </TrC>
              </TheadC>
              <TbodyC>
                {block.rows.map((row, ri) => (
                  <TrC key={ri}>
                    {row.map((cell, ci) => (
                      <TdC key={ci}>{cell}</TdC>
                    ))}
                  </TrC>
                ))}
              </TbodyC>
            </TableC>
          );
        })}
      </div>
    );
  }

  return { ...mock, MessageResponse: FaithfulMessageResponse };
});

import { ConversationPane } from "./ConversationPane";
import type { ConversationStream } from "./ConversationPane";
import type { HubTimelineAssistantTurn } from "./use-hub-stream";

// Test harness (toolbar-reach Phase 3): a shared control here now mounts a Radix Tooltip via
// `IconButton`; the app root supplies `TooltipProvider`, so inject it for every render in this file.
const render = (
  ui: Parameters<typeof rtlRender>[0],
  options?: Parameters<typeof rtlRender>[1],
) => rtlRender(<TooltipProvider>{ui}</TooltipProvider>, options);

function session(overrides: Partial<HubSession> = {}): HubSession {
  return {
    id: "s1",
    kind: "chat",
    title: "Untitled session",
    titleState: "pending",
    mode: "mission",
    model: "claude-sonnet-5",
    status: "running",
    costUsd: 0,
    tokensIn: 0,
    tokensOut: 0,
    createdAt: "2026-07-17T12:00:00.000Z",
    updatedAt: "2026-07-17T12:00:00.000Z",
    seen: true,
    ...overrides,
  };
}

const EMPTY_STREAM: ConversationStream = {
  events: [],
  deltaText: {},
  deltaReasoning: {},
  liveMessageId: null,
  turnRunning: false,
  phase: null,
  queuePosition: null,
  phaseDeadlineAt: null,
  waitingReason: null,
  error: null,
  authRequired: false,
  pendingElicitation: null,
  openQuestions: [],
  timeline: [],
  tasks: [],
  pendingQueued: [],
};

function turnWithText(text: string, citations: HubCitation[]): HubTimelineAssistantTurn {
  return {
    kind: "assistant_turn",
    id: "turn-1",
    messageId: "m1",
    model: "claude-sonnet-5",
    parts: [{ type: "text", text }],
    toolCalls: [],
    citations,
    streaming: false,
  };
}

// The live shape (analysis.md RC4): `## Synthesis: …` heading (with its own [1] marker), a resolved
// [1] in prose, an ORPHAN [99] with no matching citation, and a markdown table — all in one message.
const LIVE_SHAPE_TEXT = [
  "## Synthesis: Revenue Outlook [1]",
  "",
  "Revenue grew 12% year over year, driven by EMEA. An unlisted claim follows [99].",
  "",
  "| Region | Growth |",
  "| --- | --- |",
  "| EMEA | 12% |",
  "| APAC | 9% |",
  "",
  "See the breakdown above for details [1].",
].join("\n");

const CITATIONS: HubCitation[] = [
  { id: "1", title: "FY26 Revenue Report", url: "https://example.com/revenue" },
];

function renderLiveShape(citations: HubCitation[] = CITATIONS) {
  const turn = turnWithText(LIVE_SHAPE_TEXT, citations);
  const stream: ConversationStream = { ...EMPTY_STREAM, timeline: [turn] };
  return render(
    <ConversationPane
      session={session()}
      stream={stream}
      onStarterSelect={vi.fn()}
    />,
  );
}

describe("ConversationPane — WP3.1 (RC4) live-shape citation regression", () => {
  test("a real table element renders (not literal `|---|` text)", () => {
    renderLiveShape();
    const table = screen.getByRole("table");
    expect(within(table).getByRole("cell", { name: "EMEA" })).toBeInTheDocument();
    expect(within(table).getByRole("cell", { name: "12%" })).toBeInTheDocument();
    expect(within(table).getByRole("cell", { name: "APAC" })).toBeInTheDocument();
  });

  test("## headings render as real headings, not literal `##` text", () => {
    renderLiveShape();
    const heading = screen.getByRole("heading", { level: 2 });
    expect(heading).toHaveTextContent("Synthesis: Revenue Outlook");
    // No literal "##" leaks anywhere in the rendered message.
    expect(screen.queryByText(/##/)).not.toBeInTheDocument();
  });

  test("resolvable [1] markers render as inline citation chips — in the heading AND in prose", () => {
    renderLiveShape();
    const heading = screen.getByRole("heading", { level: 2 });
    // The heading's own [1] marker wove into a chip INSIDE the heading element (inline, not a
    // trailing footnote row).
    expect(within(heading).getByLabelText("Source 1: FY26 Revenue Report")).toBeInTheDocument();
    // Every resolvable [1] in the message becomes its own chip (two occurrences in the fixture: one
    // in the heading, one in the closing "See the breakdown above..." sentence).
    expect(screen.getAllByLabelText("Source 1: FY26 Revenue Report")).toHaveLength(2);
    // The closing sentence's marker is gone as literal text — the chip replaced it, not sat beside it.
    expect(screen.queryByText(/See the breakdown above for details \[1\]\./)).not.toBeInTheDocument();
    expect(screen.getByText(/See the breakdown above for details\.?/)).toBeInTheDocument();
  });

  test("orphan [99] (no matching citation) stays literal text, never a dangling chip", () => {
    renderLiveShape();
    expect(screen.queryByLabelText(/Source 99/)).not.toBeInTheDocument();
    expect(screen.getByText(/An unlisted claim follows \[99\]\./)).toBeInTheDocument();
  });

  test("an uncited turn renders through the SAME markdown path with no citation components at all", () => {
    const turn = turnWithText("## Plain heading\n\nNo citations here.", []);
    const stream: ConversationStream = { ...EMPTY_STREAM, timeline: [turn] };
    render(<ConversationPane session={session()} stream={stream} onStarterSelect={vi.fn()} />);
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("Plain heading");
    expect(screen.getByText("No citations here.")).toBeInTheDocument();
  });
});
