import type { ElementType } from "react";
import { fireEvent, render as rtlRender, screen, within } from "@testing-library/react";
import { TooltipProvider } from "@brand/ui";
import { beforeAll, describe, expect, test, vi } from "vitest";

/**
 * WP 6.1 — the markdown-table override now wraps its `@brand/ui` `Table` in `ExpandableTable`, so a
 * markdown table gains the shared download/expand toolbar. `@brand/ai`'s Streamdown (`MessageResponse`)
 * can't load in jsdom, so we mock it to a minimal renderer that drives the `components.table` override
 * with a synthetic GFM table — exercising the real ChatMarkdown wrap without the markdown engine.
 */
vi.mock("@brand/ai", () => ({
  MessageResponse: ({ components }: { components?: Record<string, ElementType> }) => {
    const C = components ?? {};
    const T = C.table ?? "table";
    const THead = C.thead ?? "thead";
    const TBody = C.tbody ?? "tbody";
    const TR = C.tr ?? "tr";
    const TH = C.th ?? "th";
    const TD = C.td ?? "td";
    return (
      <T>
        <THead>
          <TR>
            <TH>Name</TH>
            <TH>Value</TH>
          </TR>
        </THead>
        <TBody>
          <TR>
            <TD>Alpha</TD>
            <TD>1</TD>
          </TR>
        </TBody>
      </T>
    );
  },
}));

import { ChatMarkdown } from "./ChatMarkdown";

// Test harness (toolbar-reach Phase 3): the markdown table now mounts a Radix Tooltip via `IconButton`
// (ExpandableTable toolbar); the app root supplies `TooltipProvider`, so inject it for every render.
const render = (
  ui: Parameters<typeof rtlRender>[0],
  options?: Parameters<typeof rtlRender>[1],
) => rtlRender(<TooltipProvider>{ui}</TooltipProvider>, options);

beforeAll(() => {
  // The @brand/ui Dialog (Radix) reads matchMedia + ResizeObserver on open, which jsdom lacks.
  if (!window.matchMedia) {
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })) as unknown as typeof window.matchMedia;
  }
  if (!("ResizeObserver" in globalThis)) {
    (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
});

describe("ChatMarkdown markdown table", () => {
  const MD_TABLE = ["| Name | Value |", "| --- | --- |", "| Alpha | 1 |"].join("\n");

  test("a markdown table gains the download + expand toolbar", () => {
    render(<ChatMarkdown text={MD_TABLE} />);
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Download table as CSV" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Expand table" })).toBeInTheDocument();
  });

  test("expand opens a Dialog re-rendering the same table", () => {
    render(<ChatMarkdown text={MD_TABLE} />);
    fireEvent.click(screen.getByRole("button", { name: "Expand table" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("table")).toBeInTheDocument();
    expect(within(dialog).getByRole("cell", { name: "Alpha" })).toBeInTheDocument();
  });
});
