import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TooltipProvider,
} from "@elabs-ai/components-ui";

// Spy on the download side-effect while keeping the pure `toCsv` real, so we can assert the exact CSV
// each path (structured vs DOM-extraction) hands to the util.
vi.mock("../../lib/csv", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/csv")>();
  return { ...actual, downloadCsv: vi.fn() };
});

import { downloadCsv, toCsv } from "../../lib/csv";
import { ExpandableTable } from "./ExpandableTable";

/**
 * WP 6.1 — the one clean `@elabs-ai/components-*` table wrapper carrying the CSV-download + expand-to-modal
 * affordances. Proven: it renders its children inline; the toolbar exposes keyboard-reachable,
 * accessibly-named download + expand buttons; expand opens a Dialog re-rendering the same table;
 * download serializes the STRUCTURED data when given AND falls back to extracting the rendered
 * table's DOM when it isn't. ui-wave U2 (owner feedback): expand is the app's NORMAL modal dialog —
 * a real `role="dialog"` that Escape closes — and the download action stays available inside it.
 */

beforeAll(() => {
  // The @elabs-ai/components-ui Dialog (Radix) reads matchMedia + ResizeObserver on open, which jsdom lacks.
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

/** A tiny structured `@elabs-ai/components-ui` table used by the structured-path cases. */
function StructuredTable() {
  return (
    // The toolbar's download/expand controls are `IconButton`s (D-TB5), which render a Radix
    // `Tooltip` that needs a `TooltipProvider` ancestor (the app root mounts one).
    <TooltipProvider delayDuration={0}>
      <ExpandableTable
        title="Carrier flights"
        downloadName="Carrier flights"
        csv={{
          columns: ["Carrier", "Flights"],
          rows: [
            ["AA", 100],
            ["UA", 250],
          ],
        }}
      >
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Carrier</TableHead>
              <TableHead>Flights</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow>
              <TableCell>AA</TableCell>
              <TableCell>100</TableCell>
            </TableRow>
            <TableRow>
              <TableCell>UA</TableCell>
              <TableCell>250</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </ExpandableTable>
    </TooltipProvider>
  );
}

/** A children-only table (no `csv` prop) — the markdown-table override path. */
function DomOnlyTable() {
  return (
    <TooltipProvider delayDuration={0}>
      <ExpandableTable title="Markdown table">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Note</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow>
              <TableCell>Alpha</TableCell>
              <TableCell>needs, quotes</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </ExpandableTable>
    </TooltipProvider>
  );
}

describe("ExpandableTable", () => {
  beforeEach(() => {
    vi.mocked(downloadCsv).mockClear();
  });

  test("renders its table content inline", () => {
    render(<StructuredTable />);
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Carrier" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "AA" })).toBeInTheDocument();
  });

  test("the toolbar exposes accessibly-named download + expand buttons", () => {
    render(<StructuredTable />);
    expect(screen.getByRole("button", { name: "Download table as CSV" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Expand table" })).toBeInTheDocument();
  });

  test("expand opens a Dialog that re-renders the same table with the title", () => {
    render(<StructuredTable />);
    // Closed by default — no dialog mounted.
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Expand table" }));

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Carrier flights")).toBeInTheDocument();
    // The same table is re-rendered inside the modal (its cells are reachable within the dialog).
    expect(within(dialog).getByRole("table")).toBeInTheDocument();
    expect(within(dialog).getByRole("cell", { name: "UA" })).toBeInTheDocument();
  });

  test("Escape closes the expand dialog (ui-wave U2 — Radix Dialog, not a raw takeover)", () => {
    render(<StructuredTable />);
    fireEvent.click(screen.getByRole("button", { name: "Expand table" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    // Radix's DismissableLayer listens for Escape at the document level (mirrors AuditView.test.tsx).
    fireEvent.keyDown(document.body, { key: "Escape" });

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    // The inline table is still there — closing the modal never loses the content.
    expect(screen.getByRole("table")).toBeInTheDocument();
  });

  test("the download action stays available INSIDE the open dialog (ui-wave U2)", () => {
    render(<StructuredTable />);
    fireEvent.click(screen.getByRole("button", { name: "Expand table" }));

    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Download table as CSV" }));

    expect(downloadCsv).toHaveBeenCalledTimes(1);
    expect(downloadCsv).toHaveBeenCalledWith(
      "carrier-flights.csv",
      toCsv(["Carrier", "Flights"], [["AA", 100], ["UA", 250]]),
    );
  });

  test("download (structured path) serializes the given data with the slugged filename", () => {
    render(<StructuredTable />);
    fireEvent.click(screen.getByRole("button", { name: "Download table as CSV" }));

    expect(downloadCsv).toHaveBeenCalledTimes(1);
    expect(downloadCsv).toHaveBeenCalledWith(
      "carrier-flights.csv",
      toCsv(["Carrier", "Flights"], [["AA", 100], ["UA", 250]]),
    );
  });

  test("download (DOM path, no csv prop) extracts headers + cells from the rendered table", () => {
    render(<DomOnlyTable />);
    fireEvent.click(screen.getByRole("button", { name: "Download table as CSV" }));

    // The comma-bearing cell must round-trip through the escaping.
    const expected = toCsv(["Name", "Note"], [["Alpha", "needs, quotes"]]);
    expect(downloadCsv).toHaveBeenCalledWith("markdown-table.csv", expected);
  });
});
