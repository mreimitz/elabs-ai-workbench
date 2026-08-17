import { useLayoutEffect, type MouseEventHandler, type ReactNode, type RefObject } from "react";
import type { ColumnDef } from "@elabs-ai/components-data";
import { Button, cn } from "@elabs-ai/components-ui";

const numberFormat = new Intl.NumberFormat("en-US");

/** Which edge a column is pinned to inside a horizontally-scrolling table. */
export type PinSide = "left" | "right";

/** Concise column helper for @elabs-ai/components-data DataTable.
 *  `value` is the raw sortable/filterable key (return a number for numeric columns so sorting is
 *  numeric); `cell` overrides display. Numeric columns right-align, use tabular-nums, and
 *  auto-format integers when no `cell` is given. `pin` keeps the column stuck to the left/right
 *  edge while the rest of the table scrolls horizontally (see `pinnedCellClass`). */
export function col<T>(opts: {
  id: string;
  header: string;
  value: (row: T) => string | number;
  cell?: (row: T) => ReactNode;
  numeric?: boolean;
  pin?: PinSide;
}): ColumnDef<T> {
  const right = Boolean(opts.numeric);
  const pinCell = opts.pin ? pinnedCellClass(opts.pin, { bg: LIST_PIN_BG }) : undefined;
  const pinHead = opts.pin
    ? pinnedCellClass(opts.pin, { header: true, bg: LIST_PIN_BG })
    : undefined;
  return {
    id: opts.id,
    accessorFn: (row) => opts.value(row),
    enableSorting: true,
    // Label-in-Name (WCAG 2.5.3 — critique 2026-07-25T20-00-10Z item 1): @elabs-ai/components-data's sort <button>
    // announces `Sort by ${headerLabel}`, and `headerLabel` falls back to the raw `column.id` (e.g.
    // "lastScan") whenever `columnDef.header` ISN'T a literal string — see the vendored
    // `data-table.tsx`'s `headerLabel = typeof header.column.columnDef.header === "string" ? … :
    // header.column.id`. A plain STRING header fixes this (`Sort by Last scan` matches the visible
    // "Last scan" label) with ZERO visual change for a non-pinned column: the wrapper div this used to
    // always return is a flex ITEM inside that vendor `<button>` (`inline-flex items-center gap-1`),
    // so it never stretches to the button's full width and `text-right` was already inert there — only
    // the CELL's own div (below) does real work, because a `<td>` is a block container a div DOES
    // stretch inside. Pinned columns are the one case that still needs the JSX wrapper: the sticky/
    // background classes have to live on a rendered element, so those keep the old form (and, with it,
    // the `column.id` fallback for that specific column — a documented, narrow gap, not a regression).
    header: opts.pin
      ? () => <div className={cn(right ? "text-right" : undefined, pinHead)}>{opts.header}</div>
      : opts.header,
    cell: ({ row }) => {
      const raw = opts.value(row.original);
      const display = opts.cell
        ? opts.cell(row.original)
        : right && typeof raw === "number"
          ? numberFormat.format(Math.round(raw))
          : String(raw);
      return (
        <div className={cn(right ? "text-right tabular-nums" : "min-w-0", pinCell)}>{display}</div>
      );
    },
  };
}

/** A row-level actions column (S15): no sort affordance, no global-filter participation, and a
 *  right-aligned cell for controls. The header is empty by default (a bare "↕" sort glyph on an
 *  unlabeled column is the exact noise the audit flags); pass `header` for a visually-hidden label
 *  that assistive tech still announces.
 *
 *  a11y (critique 2026-07-25T20-00-10Z item 3): do NOT put a second "open this row" affordance (a
 *  bare chevron / "Open X" button) in this column on a table whose rows already use `navCol` +
 *  `clickableRowTableProps` — that gives every row TWO controls with the same accessible name inside
 *  a row that is ALSO itself clickable. Reserve `actionsCol` for controls `navCol` doesn't already
 *  cover (edit/delete/duplicate, a real overflow menu) on a table that has row-level actions distinct
 *  from "open"; a table whose only per-row action IS "open" needs no `actionsCol` at all — the row
 *  click + the `navCol` button already do that job. */
export function actionsCol<T>(opts: {
  id?: string;
  header?: string;
  cell: (row: T) => ReactNode;
  /** Pin the column to the right edge so controls stay reachable when a wide table scrolls. */
  pin?: boolean;
}): ColumnDef<T> {
  const pinCell = opts.pin ? pinnedCellClass("right", { bg: LIST_PIN_BG }) : undefined;
  const pinHead = opts.pin ? pinnedCellClass("right", { header: true, bg: LIST_PIN_BG }) : undefined;
  return {
    id: opts.id ?? "actions",
    enableSorting: false,
    enableGlobalFilter: false,
    header: () =>
      opts.header ? (
        <span className={cn("sr-only", pinHead)}>{opts.header}</span>
      ) : (
        <span className={cn("block", pinHead)} aria-hidden />
      ),
    cell: ({ row }) => (
      <div className={cn("flex items-center justify-end gap-1", pinCell)}>
        {opts.cell(row.original)}
      </div>
    ),
  };
}

/** A name/entity column that doubles as the row-click navigation slot (@elabs-ai/components-data's DataTable has
 *  no `onRowClick`, so a full-cell click target is the house pattern). Renders a ghost Button that
 *  fills the cell; `onSelect` fires on click, `isActive` marks the current row (`aria-current`).
 *  `cell` renders the button's inner content (e.g. a two-line name + meta).
 *
 *  ui-wave U7 (owner feedback): pair every navCol table with `clickableRowTableProps()` so the WHOLE
 *  row is the click target. The button stays the one semantic, keyboard-focusable control (Enter/
 *  Space work natively — no `role="link"` div re-implementation needed); it is stamped
 *  `data-row-nav` so the row-level delegation can re-dispatch to it, and its own hover wash is
 *  suppressed — the row's single `hover:bg-accent/50` is the feedback, so the title no longer
 *  floats as a separate pill inside the hovered row. */
export function navCol<T>(opts: {
  id: string;
  header: string;
  value: (row: T) => string | number;
  onSelect: (row: T) => void;
  cell: (row: T) => ReactNode;
  isActive?: (row: T) => boolean;
  ariaLabel?: (row: T) => string;
  pin?: PinSide;
}): ColumnDef<T> {
  const pinCell = opts.pin ? pinnedCellClass(opts.pin, { bg: LIST_PIN_BG }) : undefined;
  const pinHead = opts.pin
    ? pinnedCellClass(opts.pin, { header: true, bg: LIST_PIN_BG })
    : undefined;
  return {
    id: opts.id,
    accessorFn: (row) => opts.value(row),
    enableSorting: true,
    // Label-in-Name — same fix and same rationale as `col()` above: a plain string header (no
    // visual change for a non-pinned column — `min-w-0` alone is inert on a flex item with no
    // sibling to shrink against) gets the sort button's real accessible name from @elabs-ai/components-data
    // instead of falling back to `column.id`.
    header: opts.pin ? () => <div className={cn("min-w-0", pinHead)}>{opts.header}</div> : opts.header,
    cell: ({ row }) => {
      const active = opts.isActive?.(row.original) ?? false;
      return (
        <div className={cn("min-w-0", pinCell)}>
          <Button
            variant="ghost"
            size="sm"
            className={cn(
              "h-auto w-full flex-col items-start gap-0.5 px-1.5 py-1 text-left",
              // U7: an active row keeps its solid marker; otherwise the button's own ghost
              // hover is turned OFF (`cn` tailwind-merges it over `hover:bg-accent`) so the
              // row hover from `clickableRowTableProps` is the one and only hover surface.
              active ? "bg-accent text-accent-foreground" : "hover:bg-transparent",
            )}
            data-row-nav=""
            onClick={() => opts.onSelect(row.original)}
            aria-current={active ? "true" : undefined}
            aria-label={opts.ariaLabel?.(row.original)}
          >
            {opts.cell(row.original)}
          </Button>
        </div>
      );
    },
  };
}

/** ui-wave U7 (owner feedback): the fill `col`/`navCol`/`actionsCol` pass to `pinnedCellClass`.
 *  The old hard-coded `bg-card` painted an opaque patch over @elabs-ai/components-data's zebra/tinted rows, which
 *  read as a floating white pill around the title and the row menu. Below `lg` a plain list table now
 *  DOES scroll horizontally (`RESPONSIVE_TABLE_SCROLL_CLASS` below fixes the P0 mobile defect this
 *  comment used to describe — 8 of 9 columns silently unreachable at 390px); at `lg` and up it still
 *  doesn't (by design — see that constant's doc), so the opaque fill still buys nothing there and the
 *  pins keep their sticky geometry and go transparent. A table that genuinely scrolls sideways over
 *  opaque rows AT EVERY WIDTH passes its own matching `bg` (see `features/testing/runs/pinning.ts` for
 *  the surface-matched variant, and `CompatibilityView`, which keeps the opaque default below). */
const LIST_PIN_BG = "bg-transparent";

/**
 * P0 mobile audit T4 (2026-07-25 critique, `.impeccable/critique/2026-07-25T20-00-10Z__127-0-0-1.md`):
 * fixes the PLAIN (non-virtualized) `@elabs-ai/components-data` DataTable's own inner scroll box, which is hard-coded
 * `overflow-hidden` — see the doc on `LIST_PIN_BG` above. Below `lg`, that doesn't just block
 * scrolling — it SILENTLY DELETES every column that doesn't fit (measured: the Issues triage table had
 * 8 of 9 columns gone at 390px inside a `clientWidth: 336` wrapper — not scrollable, just clipped, with
 * no visual hint anything was missing; the dashboard footprint table lost Δ vs previous / Largest tool
 * / Last scan / Open server the same way).
 *
 * `@elabs-ai/components-data` exposes no prop for that inner box's own classes (`DataTableProps`' `className`/`rest`
 * only reach the OUTER wrapper div — see `apps/web/node_modules/@elabs-ai/components-data/src/data-table/data-table.tsx`,
 * which is vendored and must not be edited, `vendor/brand/brand-data-1.9.0.tgz`). This reaches the
 * inner box via a Tailwind arbitrary-variant descendant selector on the outer wrapper instead — the
 * same "target the vendor component's own internal div" technique already used for `RunConsole`'s
 * `ScrollArea` (`[&>[data-radix-scroll-area-viewport]>div]:block!`) and `RunsView`'s `Table` height cap
 * (`[&>div]:h-full`). The trailing `!` (Tailwind v4 important) makes the override win regardless of
 * Tailwind's internal utility-ordering, matching the `RunConsole.tsx` precedent — relying on plain
 * class-order tiebreaking here would be fragile since both the vendor's `overflow-hidden` and this
 * selector are generated into the SAME app stylesheet (the `@source` scan in `app.css`).
 *
 * `:first-child` (not a bare `[&>div]`) scopes the override to the table's own scroll box specifically
 * — a paginated table (`enablePagination`) renders a SECOND sibling div (the Previous/Next controls)
 * after it, which this must not also touch.
 *
 * Pass as the `className` argument to `clickableRowTableProps()` (or merge with `cn()` directly) on any
 * PLAIN DataTable whose columns can genuinely run wider than a phone screen — this is what makes the
 * `pin: "left" | "right"` columns above actually reachable below `lg`, instead of just keeping their
 * sticky geometry over content nobody could scroll to. Desktop (`lg` and up) is untouched: the wrapper
 * reverts to `overflow-hidden`, the same clip-not-blow-out safety net it had before (a table that
 * somehow still ends up wider than its box on a large screen still clips rather than pushing the page).
 *
 * Do NOT apply this to a DataTable that also uses `stickyScrollTableProps()` (row virtualization,
 * `ScansView`'s combo) — that recipe's own scroll box is ALREADY `overflow-auto` at every width (it
 * must scroll to virtualize); forcing it back to `overflow-hidden` at `lg` would break its desktop
 * scroll. `clickableRowTableProps()` itself deliberately does NOT bake this in for exactly that reason
 * — apply it per call site instead.
 */
export const RESPONSIVE_TABLE_SCROLL_CLASS =
  "[&>div:first-child]:overflow-x-auto! lg:[&>div:first-child]:overflow-hidden!";

/** Sticky classes for a pinned first/last column. Uses a negative-margin bleed so the cell's
 *  background fills @elabs-ai/components-data's own `td`/`th` padding (`px-3`) — otherwise sibling cells
 *  scroll through the padding gutter. The header variant sits above body cells so the pinned
 *  header corner stays on top of both the sticky header row and the scrolling body.
 *
 *  `bg` (ui-wave U7, owner feedback): the fill token. Defaults to the opaque `bg-card` for direct
 *  callers whose tables really scroll horizontally over card-surface rows (`CompatibilityView`'s
 *  matrix); the list-table column helpers above pass `bg-transparent` so zebra/tinted rows show
 *  through instead of a white pill. This is the "optional `bg` param" gap the Runs feed's
 *  `pinning.ts` documented.
 *
 *  NOTE (upstream gap): @elabs-ai/components-data's DataTable owns its `<th>`/`<td>` and applies no column-pinning
 *  styles, so pinning is expressed from inside the cell content. It reads correctly for a name/actions
 *  column against a solid `bg-card` row; verify per wide-table adoption (Phase 2, S2). */
export function pinnedCellClass(side: PinSide, opts?: { header?: boolean; bg?: string }): string {
  return cn(
    "sticky",
    opts?.bg ?? "bg-card",
    // eat the surrounding cell padding so the fill spans the full column width
    "-my-2 py-2",
    side === "left" ? "left-0 -ml-3 pl-3" : "right-0 -mr-3 pr-3",
    // pinned header corner must clear the sticky header row (z-10) and pinned body cells (z-20)
    opts?.header ? "z-30" : "z-20",
  );
}

/** Interactive elements that own their clicks — a row-level click that starts inside one of these
 *  must NOT also trigger row navigation (ui-wave U7, owner feedback). Menus/menu items cover the
 *  row overflow menu (Radix portals its content to `document.body`, but React still bubbles the
 *  synthetic event through the component tree to the table wrapper, so the guard matters twice). */
const ROW_NAV_SUPPRESS_SELECTOR =
  "button, a, input, select, textarea, label, [role='menu'], [role='menuitem'], [role='checkbox'], [role='dialog']";

/** Delegated row click for `clickableRowTableProps` (ui-wave U7, owner feedback). @elabs-ai/components-data's
 *  DataTable owns its `<tr>`s (no `onRowClick`, no row class hook), so the wrapper div listens
 *  instead and re-dispatches a click on the row's `data-row-nav` control — the SAME semantic
 *  button `navCol` renders, so navigation targets can never drift apart. Clicks that originate on
 *  interactive elements (the title button itself, the row menu, links, form controls) are left to
 *  their own handlers, and a text-selection drag is not hijacked into a navigation. */
function delegateRowNavClick(event: Parameters<MouseEventHandler<HTMLDivElement>>[0]): void {
  if (event.defaultPrevented) return;
  const target = event.target;
  if (!(target instanceof Element)) return;
  if (target.closest(ROW_NAV_SUPPRESS_SELECTOR)) return;
  const row = target.closest("tr");
  if (!row) return;
  // A click that ends a text selection is a copy gesture, not an "open" intent.
  const selection = typeof window === "undefined" ? null : window.getSelection();
  if (selection && selection.type === "Range") return;
  row.querySelector<HTMLElement>("[data-row-nav]")?.click();
}

/** Makes every `navCol` row of a DataTable a full-width click target (ui-wave U7, owner feedback):
 *  spread onto the `<DataTable {...} />` of any table whose columns include a `navCol`. The row
 *  gets `cursor-pointer` plus a single `hover:bg-accent/50` wash (scoped via `:has([data-row-nav])`
 *  so header/skeleton/empty rows stay inert), and clicks anywhere in the row delegate to the
 *  `navCol` button. Keyboard users are NOT rerouted through the row: the `navCol` button remains
 *  the focusable semantic control, so Enter/Space already navigate without a `tabindex` on a `<tr>`
 *  we don't render. The selectors out-rank the DataTable's own `hover:bg-foreground/10` row wash
 *  by specificity, replacing it with the accent hover the owner asked for. */
export function clickableRowTableProps(className?: string): {
  className: string;
  onClick: MouseEventHandler<HTMLDivElement>;
} {
  return {
    className: cn(
      "[&_tbody_tr:has([data-row-nav])]:cursor-pointer",
      "[&_tbody_tr:has([data-row-nav]):hover]:bg-accent/50",
      className,
    ),
    onClick: delegateRowNavClick,
  };
}

/** Quiet reveal-on-demand classes for a row's "…" overflow-menu trigger (ui-wave U7, owner
 *  feedback) — apply to the ghost icon Button inside an `actionsCol` cell. Hidden via `opacity-0`
 *  (NOT `display`/`visibility`, so it stays in the tab order and the accessibility tree) and
 *  revealed on row hover, on any focus inside the row (keyboard users see it before reaching it),
 *  on its own focus, while its menu is open (Radix `data-state`), and permanently on coarse
 *  pointers (touch has no hover to reveal with). The `tr:*_&` variants stand in for the usual
 *  `group-hover` because @elabs-ai/components-data owns the `<tr>` — we cannot put a `group` class on it.
 *  Mirrors the `ServerRail`/`SkillRail` list-row precedent. */
export const rowMenuTriggerClass = cn(
  "text-muted-foreground",
  "opacity-0 transition-opacity",
  "focus-visible:opacity-100",
  "data-[state=open]:opacity-100",
  "[tr:hover_&]:opacity-100",
  "[tr:focus-within_&]:opacity-100",
  "pointer-coarse:opacity-100",
);

/** DataTable props that make the header row stick while the body scrolls inside a bounded region
 *  (S22 scroll contract). Row virtualization is what gives @elabs-ai/components-data its sticky `thead`, so this
 *  bundles the opt-in with a bounded body height. Spread onto a `<DataTable {...} />`. */
export function stickyScrollTableProps(opts?: {
  maxBodyHeight?: string;
  estimateRowHeight?: number;
}): {
  enableRowVirtualization: true;
  maxBodyHeight: string;
  estimateRowHeight?: number;
} {
  return {
    enableRowVirtualization: true,
    maxBodyHeight: opts?.maxBodyHeight ?? "100%",
    ...(opts?.estimateRowHeight !== undefined ? { estimateRowHeight: opts.estimateRowHeight } : {}),
  };
}

/** Whether client-side pagination chrome should show. @elabs-ai/components-data renders "Page 1 of 1" with
 *  disabled Previous/Next even for a single page (S10), so gate `enablePagination` on this: it is
 *  `true` only when the row count exceeds one page. */
export function shouldPaginate(rowCount: number, pageSize: number): boolean {
  return pageSize > 0 && rowCount > pageSize;
}

// ── Table semantics: caption + column-header scope (critique 2026-07-25T20-00-10Z item 3) ──────────
//
// @elabs-ai/components-data's DataTable owns its own `<table>`/`<thead>`/`<th>` rendering with no `caption` prop and
// no per-column head-cell hook (see the `NOTE (upstream gap)` on `pinnedCellClass` above for the same
// constraint on pinning) — so neither a real `<caption>` nor a `scope="col"` attribute can be handed
// to it as a prop. `DataTableProps` DOES extend `Omit<React.HTMLAttributes<HTMLDivElement>, "children">`
// and forward `ref`/`id`/`aria-*`/`role` straight onto its OUTERMOST wrapper div (see the vendored
// `data-table.tsx`'s own doc comment on `DataTableInner`), which is what `tableCaptionProps` below
// uses; `scope="col"` has no such passthrough seam at all, so `applyColumnHeaderScope` reaches the
// rendered `<th>`s directly, the same "target the vendor component's own internal DOM" technique
// `RESPONSIVE_TABLE_SCROLL_CLASS` already uses for the inner scroll box.
//
// NEITHER mechanism is wired into `col`/`navCol`/`actionsCol`/`DataTable` automatically — both are
// OPT-IN exports for a table's own call site to adopt (a `ref` + a rendered `<TableCaption>`), so
// existing consumers are byte-for-byte unchanged until they do. That adoption is a per-table change to
// files this task doesn't own; see this task's report for the specific tables it was verified against.

/** Visually-hidden label for a `DataTable`, standing in for the `<caption>` the vendored component has
 *  no seam to render. Pair with `tableCaptionProps(id)` spread onto the `<DataTable>` that follows it —
 *  `aria-labelledby` + `role="region"` turn the DataTable's own outer wrapper (which forwards both, see
 *  the module doc above) into a labelled landmark, giving assistive tech the same "what is this table
 *  for" context a `<caption>` would. Renders nothing visually (`sr-only`) so there is no layout change
 *  at any adoption site. */
export function TableCaption({ id, children }: { id: string; children: ReactNode }): ReactNode {
  return (
    <span id={id} className="sr-only">
      {children}
    </span>
  );
}

/** Props to spread onto a `<DataTable>` so it becomes the labelled region a paired `<TableCaption id=…>`
 *  names. See `TableCaption`'s doc for why this is a `role="region"` + `aria-labelledby` pair rather
 *  than a literal `<caption>` (the vendor has no seam for one). */
export function tableCaptionProps(id: string): { role: "region"; "aria-labelledby": string } {
  return { role: "region", "aria-labelledby": id };
}

/** Sets `scope="col"` on every header cell inside a `DataTable`'s rendered `<thead>`. Pure DOM write —
 *  safe to call repeatedly (idempotent) and cheap (bounded by column count). `container` is the ref
 *  target — @elabs-ai/components-data's `DataTable` forwards a `ref` to its OUTERMOST wrapper div (see the module
 *  doc above), so a `ref` passed straight to `<DataTable ref={...} />` is a valid container here. */
export function applyColumnHeaderScope(container: HTMLElement | null): void {
  if (!container) return;
  for (const th of container.querySelectorAll("thead th")) {
    th.setAttribute("scope", "col");
  }
}

/** Hook form of `applyColumnHeaderScope`: runs it in a `useLayoutEffect` (before paint, so assistive
 *  tech never observes an un-scoped header) whenever `deps` changes — pass the table's own `columns`
 *  array (and anything else that could re-key its header cells) so a column-set change re-applies the
 *  attribute. `ref` is the same `DataTable` ref `applyColumnHeaderScope` documents. */
export function useTableColumnHeaderScope(
  ref: RefObject<HTMLElement | null>,
  deps: readonly unknown[] = [],
): void {
  // `deps` IS the caller-supplied dependency list (this project's Biome config disables
  // `useExhaustiveDependencies` — see `biome.json` — so a generic `readonly unknown[]` is fine here).
  useLayoutEffect(() => {
    applyColumnHeaderScope(ref.current);
  }, deps);
}
