import { useRef } from "react";
import { DataTable } from "@elabs-ai/components-data";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import {
  actionsCol,
  applyColumnHeaderScope,
  clickableRowTableProps,
  col,
  navCol,
  pinnedCellClass,
  RESPONSIVE_TABLE_SCROLL_CLASS,
  rowMenuTriggerClass,
  shouldPaginate,
  stickyScrollTableProps,
  TableCaption,
  tableCaptionProps,
  useTableColumnHeaderScope,
} from "./table";

/** Class-name guard for ui-wave U7 (owner feedback): matches a SOLID surface utility at rest
 *  (`bg-card`, `bg-primary`, …) but not variant-prefixed ones like `hover:bg-accent`. */
const SOLID_BG_AT_REST = /(?:^|\s)bg-(?:card|background|primary|secondary|accent|muted)\b/;

// Render a column's header / cell in isolation. @elabs-ai/components-data hands the cell a
// `{ row: { original } }` context and the header a header context we don't read here.
function renderHeader(column: { header?: unknown }) {
  const header = column.header as (ctx: unknown) => JSX.Element;
  return render(header({}));
}
function renderCell<T>(column: { cell?: unknown }, original: T) {
  const cell = column.cell as (ctx: { row: { original: T } }) => JSX.Element;
  return render(cell({ row: { original } }));
}

describe("shouldPaginate — single-page tables hide pagination (S10)", () => {
  test("false when the row count fits one page", () => {
    expect(shouldPaginate(0, 25)).toBe(false);
    expect(shouldPaginate(25, 25)).toBe(false);
  });
  test("true only when rows overflow the page", () => {
    expect(shouldPaginate(26, 25)).toBe(true);
    expect(shouldPaginate(1000, 25)).toBe(true);
  });
  test("guards a zero/negative page size", () => {
    expect(shouldPaginate(10, 0)).toBe(false);
  });
});

describe("stickyScrollTableProps — sticky header via virtualization (S22)", () => {
  test("opts into virtualization with a bounded body height", () => {
    expect(stickyScrollTableProps()).toEqual({
      enableRowVirtualization: true,
      maxBodyHeight: "100%",
    });
  });
  test("honors overrides", () => {
    expect(stickyScrollTableProps({ maxBodyHeight: "32rem", estimateRowHeight: 48 })).toEqual({
      enableRowVirtualization: true,
      maxBodyHeight: "32rem",
      estimateRowHeight: 48,
    });
  });
});

describe("pinnedCellClass — first/last column stays put while the table scrolls (S2)", () => {
  test("left edge, body cell", () => {
    const c = pinnedCellClass("left");
    expect(c).toContain("sticky");
    expect(c).toContain("left-0");
    expect(c).toContain("bg-card");
    expect(c).toContain("z-20");
  });
  test("right edge, header cell sits above the sticky header row", () => {
    const c = pinnedCellClass("right", { header: true });
    expect(c).toContain("right-0");
    expect(c).toContain("z-30");
  });
  test("U7: a caller-supplied bg replaces the opaque default (the pinning.ts gap)", () => {
    const c = pinnedCellClass("left", { bg: "bg-transparent" });
    expect(c).toContain("bg-transparent");
    expect(c).not.toContain("bg-card");
  });
});

describe("col — sortable data column", () => {
  test("is sortable and carries its id", () => {
    const c = col<{ n: number }>({ id: "n", header: "N", value: (r) => r.n, numeric: true });
    expect(c.enableSorting).toBe(true);
    expect(c.id).toBe("n");
  });
  test("numeric cell right-aligns and formats integers", () => {
    const c = col<{ n: number }>({ id: "n", header: "N", value: (r) => r.n, numeric: true });
    renderCell(c, { n: 1234 });
    expect(screen.getByText("1,234")).toHaveClass("text-right", "tabular-nums");
  });
  test("pin adds sticky classes to header and cell", () => {
    const c = col<{ s: string }>({ id: "s", header: "S", value: (r) => r.s, pin: "left" });
    renderHeader(c);
    expect(screen.getByText("S")).toHaveClass("sticky", "left-0");
  });
  test("U7: a pinned list cell paints NO opaque patch over the zebra rows", () => {
    const c = col<{ s: string }>({ id: "s", header: "S", value: (r) => r.s, pin: "left" });
    const { container } = renderCell(c, { s: "alpha" });
    const cell = container.firstElementChild as HTMLElement;
    expect(cell.className).toContain("bg-transparent");
    expect(cell.className).not.toMatch(SOLID_BG_AT_REST);
  });

  // Label-in-Name (WCAG 2.5.3 — critique 2026-07-25T20-00-10Z item 1): @elabs-ai/components-data's sort button
  // falls back to `column.id` for its accessible name whenever `columnDef.header` isn't a literal
  // string. See the vendored `data-table.tsx`'s `headerLabel` computation.
  test("Label-in-Name: an unpinned column's header is a plain STRING — @elabs-ai/components-data can read it as the sort button's real name", () => {
    const c = col<{ n: number }>({ id: "lastScan", header: "Last scan", value: (r) => r.n });
    expect(c.header).toBe("Last scan");
  });

  test("Label-in-Name: a PINNED column keeps the JSX header (needed for sticky/bg classes) — a documented, narrow gap", () => {
    const c = col<{ n: number }>({
      id: "lastScan",
      header: "Last scan",
      value: (r) => r.n,
      pin: "left",
    });
    expect(typeof c.header).toBe("function");
  });

  test("Label-in-Name end-to-end: the real @elabs-ai/components-data sort button announces the visible header, not the column id", () => {
    const columns = [col<{ n: number }>({ id: "lastScan", header: "Last scan", value: (r) => r.n })];
    render(<DataTable columns={columns} data={[{ n: 1 }]} />);
    expect(screen.getByRole("button", { name: "Sort by Last scan, not sorted" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /sort by lastscan\b/i })).not.toBeInTheDocument();
  });
});

describe("actionsCol — no sort UI, empty header (S15)", () => {
  test("is not sortable and defaults its id to 'actions'", () => {
    const c = actionsCol<{ id: string }>({ cell: () => <span>go</span> });
    expect(c.enableSorting).toBe(false);
    expect(c.enableGlobalFilter).toBe(false);
    expect(c.id).toBe("actions");
  });
  test("renders an empty (aria-hidden) header when unlabeled", () => {
    const c = actionsCol<{ id: string }>({ cell: () => <span>go</span> });
    const { container } = renderHeader(c);
    expect(container.querySelector("[aria-hidden]")).toBeTruthy();
    expect(container.textContent).toBe("");
  });
  test("renders a visually-hidden label when provided", () => {
    const c = actionsCol<{ id: string }>({ header: "Row actions", cell: () => <span>go</span> });
    renderHeader(c);
    expect(screen.getByText("Row actions")).toHaveClass("sr-only");
  });
});

describe("navCol — full-cell row-click navigation slot", () => {
  test("clicking the cell selects the row", () => {
    const onSelect = vi.fn();
    const c = navCol<{ id: string; name: string }>({
      id: "name",
      header: "Name",
      value: (r) => r.name,
      onSelect,
      cell: (r) => <span>{r.name}</span>,
    });
    renderCell(c, { id: "a", name: "alpha" });
    fireEvent.click(screen.getByRole("button", { name: /alpha/i }));
    expect(onSelect).toHaveBeenCalledWith({ id: "a", name: "alpha" });
  });
  test("marks the active row with aria-current", () => {
    const c = navCol<{ id: string; name: string }>({
      id: "name",
      header: "Name",
      value: (r) => r.name,
      onSelect: () => {},
      isActive: (r) => r.id === "a",
      cell: (r) => <span>{r.name}</span>,
    });
    renderCell(c, { id: "a", name: "alpha" });
    expect(screen.getByRole("button")).toHaveAttribute("aria-current", "true");
  });
  test("U7: the cell button is a transparent delegation target — data-row-nav, no solid bg, no own hover wash", () => {
    const c = navCol<{ id: string; name: string }>({
      id: "name",
      header: "Name",
      value: (r) => r.name,
      onSelect: () => {},
      cell: (r) => <span>{r.name}</span>,
    });
    renderCell(c, { id: "a", name: "alpha" });
    const button = screen.getByRole("button", { name: /alpha/i });
    expect(button).toHaveAttribute("data-row-nav");
    expect(button.className).not.toMatch(SOLID_BG_AT_REST);
    // The row-level hover (clickableRowTableProps) is the ONE hover surface; the button's ghost
    // hover must be merged away so the title doesn't float as a pill inside the hovered row.
    expect(button.className).toContain("hover:bg-transparent");
    expect(button.className).not.toContain("hover:bg-accent");
  });

  test("Label-in-Name: an unpinned navCol's header is a plain STRING too", () => {
    const c = navCol<{ id: string; name: string }>({
      id: "name",
      header: "Name",
      value: (r) => r.name,
      onSelect: () => {},
      cell: (r) => <span>{r.name}</span>,
    });
    expect(c.header).toBe("Name");
  });
});

describe("TableCaption / tableCaptionProps — the <caption> stand-in (critique 2026-07-25T20-00-10Z item 3)", () => {
  test("TableCaption renders a visually-hidden, ided label", () => {
    render(<TableCaption id="scans-table-caption">Scan history</TableCaption>);
    const caption = screen.getByText("Scan history");
    expect(caption).toHaveClass("sr-only");
    expect(caption).toHaveAttribute("id", "scans-table-caption");
  });

  test("tableCaptionProps pairs role=region with aria-labelledby", () => {
    expect(tableCaptionProps("scans-table-caption")).toEqual({
      role: "region",
      "aria-labelledby": "scans-table-caption",
    });
  });

  test("end-to-end: a DataTable wrapped with tableCaptionProps resolves as a named region", () => {
    const columns = [col<{ n: number }>({ id: "n", header: "N", value: (r) => r.n })];
    render(
      <>
        <TableCaption id="t-caption">Scan history</TableCaption>
        <DataTable columns={columns} data={[{ n: 1 }]} {...tableCaptionProps("t-caption")} />
      </>,
    );
    expect(screen.getByRole("region", { name: "Scan history" })).toBeInTheDocument();
  });
});

describe("applyColumnHeaderScope / useTableColumnHeaderScope — scope=col on header cells (critique item 3)", () => {
  test("sets scope=col on every real DataTable th, and never touches a td cell", () => {
    const columns = [
      col<{ n: number }>({ id: "n", header: "N", value: (r) => r.n }),
      col<{ n: number }>({ id: "m", header: "M", value: (r) => r.n }),
    ];
    const { container } = render(<DataTable columns={columns} data={[{ n: 1 }]} />);
    applyColumnHeaderScope(container);
    const heads = container.querySelectorAll("th");
    expect(heads).toHaveLength(2);
    for (const th of heads) expect(th).toHaveAttribute("scope", "col");
    expect(container.querySelector("td")).not.toHaveAttribute("scope");
  });

  test("a null container is a no-op (never throws)", () => {
    expect(() => applyColumnHeaderScope(null)).not.toThrow();
  });

  test("the hook applies scope=col on mount against a real DataTable ref", () => {
    function Harness() {
      const ref = useRef<HTMLDivElement | null>(null);
      const columns = [col<{ n: number }>({ id: "n", header: "N", value: (r) => r.n })];
      useTableColumnHeaderScope(ref, [columns]);
      return <DataTable ref={ref} columns={columns} data={[{ n: 1 }]} />;
    }
    const { container } = render(<Harness />);
    expect(container.querySelector("th")).toHaveAttribute("scope", "col");
  });
});

describe("clickableRowTableProps — the whole row is the click target (ui-wave U7, owner feedback)", () => {
  function renderDelegatedTable(onSelect: () => void, onMenu: () => void) {
    const props = clickableRowTableProps();
    // Mirrors the DOM @elabs-ai/components-data's DataTable renders around our column cells: a wrapper div
    // (which receives the spread props) containing thead/tbody rows. The wrapper is not itself
    // interactive — the delegated handler only re-dispatches to the row's own semantic button —
    // so a bare div matches production shape.
    return render(
      <div {...props}>
        <table>
          <tbody>
            <tr>
              <td>
                <button type="button" data-row-nav="" onClick={onSelect}>
                  alpha
                </button>
              </td>
              <td>
                <span>plain cell</span>
              </td>
              <td>
                <button type="button" onClick={onMenu} aria-label="More actions for alpha" />
              </td>
            </tr>
          </tbody>
        </table>
      </div>,
    );
  }

  test("rows get the pointer cursor and the single accent hover wash", () => {
    const { className } = clickableRowTableProps("min-h-0");
    expect(className).toContain("[&_tbody_tr:has([data-row-nav])]:cursor-pointer");
    expect(className).toContain("[&_tbody_tr:has([data-row-nav]):hover]:bg-accent/50");
    // Extra layout classes fold in instead of being clobbered by the spread.
    expect(className).toContain("min-h-0");
  });

  test("a click on a non-interactive cell delegates to the row's nav control", () => {
    const onSelect = vi.fn();
    const onMenu = vi.fn();
    renderDelegatedTable(onSelect, onMenu);
    fireEvent.click(screen.getByText("plain cell"));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onMenu).not.toHaveBeenCalled();
  });

  test("a click on another interactive element (the row menu) does NOT trigger navigation", () => {
    const onSelect = vi.fn();
    const onMenu = vi.fn();
    renderDelegatedTable(onSelect, onMenu);
    fireEvent.click(screen.getByRole("button", { name: /more actions/i }));
    expect(onMenu).toHaveBeenCalledTimes(1);
    expect(onSelect).not.toHaveBeenCalled();
  });

  test("a click on the nav control itself fires onSelect exactly once (no double dispatch)", () => {
    const onSelect = vi.fn();
    const onMenu = vi.fn();
    renderDelegatedTable(onSelect, onMenu);
    fireEvent.click(screen.getByRole("button", { name: /^alpha$/ }));
    expect(onSelect).toHaveBeenCalledTimes(1);
  });
});

describe("RESPONSIVE_TABLE_SCROLL_CLASS — P0 mobile audit T4 (the DataTable inner box scrolls below lg)", () => {
  test("overrides the vendored inner box's overflow-hidden to overflow-x-auto below `lg`, important", () => {
    expect(RESPONSIVE_TABLE_SCROLL_CLASS).toContain("[&>div:first-child]:overflow-x-auto!");
  });

  test("reverts to overflow-hidden at `lg` and up — desktop clip-not-blow-out is unchanged", () => {
    expect(RESPONSIVE_TABLE_SCROLL_CLASS).toContain("lg:[&>div:first-child]:overflow-hidden!");
  });

  test("composes into clickableRowTableProps() without clobbering its own click-target classes", () => {
    const { className } = clickableRowTableProps(RESPONSIVE_TABLE_SCROLL_CLASS);
    expect(className).toContain("[&_tbody_tr:has([data-row-nav])]:cursor-pointer");
    expect(className).toContain("[&>div:first-child]:overflow-x-auto!");
    expect(className).toContain("lg:[&>div:first-child]:overflow-hidden!");
  });
});

describe("rowMenuTriggerClass — quiet reveal-on-demand row menu (ui-wave U7, owner feedback)", () => {
  test("hidden at rest, revealed on row hover / focus / open menu, never a solid surface", () => {
    expect(rowMenuTriggerClass).toContain("opacity-0");
    expect(rowMenuTriggerClass).toContain("focus-visible:opacity-100");
    expect(rowMenuTriggerClass).toContain("[tr:hover_&]:opacity-100");
    expect(rowMenuTriggerClass).toContain("data-[state=open]:opacity-100");
    expect(rowMenuTriggerClass).toContain("text-muted-foreground");
    expect(rowMenuTriggerClass).not.toMatch(SOLID_BG_AT_REST);
  });
});
