import { type ReactNode, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  cn,
} from "@elabs-ai/components-ui";
import { Download, Maximize2 } from "lucide-react";
import { IconButton } from "../../components/IconButton";
import { downloadCsv, toCsv } from "../../lib/csv";

/**
 * Acme Answers (WP 6.1) — the ONE clean `@elabs-ai/components-*` data table used everywhere in the answer surface,
 * carrying the two affordances the streaming Streamdown table had (CSV download + expand) but the
 * settled `@elabs-ai/components-*` tables lacked. It wraps a caller's `@elabs-ai/components-ui` `Table*` subtree, rendering it
 * INLINE unchanged, and floats a small toolbar over its top-right corner — a **download** button
 * (CSV of the table's data) and an **expand** button (opens the SAME table in a `Dialog` MODAL, not
 * a fullscreen takeover). WP 6.2 routes the live-reasoning tables through this too, so it becomes the
 * single table everywhere. ui-wave U2 (owner feedback): the modal is the app's normal `@elabs-ai/components-ui`
 * Dialog — max-w-5xl / max-h-[85vh], titled, Escape-to-close — and repeats the download action in its
 * header so the CSV stays reachable while the inline toolbar is behind the overlay.
 *
 * Toolbar reveal + a11y: the toolbar is opacity-hidden and appears on pointer hover OR keyboard focus
 * (`group-hover` + `focus-within`, mirroring `ConversationPane`'s `CopyMessageAction`), so it never
 * clutters the inline table yet stays keyboard-reachable. Both buttons are `IconButton` (D-TB5 — a
 * Radix tooltip whose text equals the `aria-label`, the app root's `TooltipProvider` covers every
 * mount of this leaf, chat shell included).
 *
 * Two CSV inputs, ONE API:
 *   - **structured** (`csv={{ columns, rows }}`) — callers that hold the data (`AnswersSnapshotData`,
 *     `AnswersReasoning`) pass it; the download serializes it directly (numbers stay ungrouped, exact);
 *   - **DOM/children** (`csv` omitted) — the `ChatMarkdown` markdown-table override has no structured
 *     data, so the download reads the rendered `<table>` via a ref (`thead th` headers + `tbody tr>td`
 *     cells). The expand MODAL always re-renders the same `children`, so both paths show one table.
 */
export type ExpandableTableProps = {
  /**
   * The `@elabs-ai/components-ui` `Table*` subtree to show. Rendered inline as-is (no look change) AND re-rendered
   * inside the expand modal. Pass the raw `<Table>…</Table>` (or a caller-owned scroll wrapper via
   * {@link ExpandableTableProps.scrollClassName}); the `<table>` DOM it produces is what the
   * DOM/children CSV path reads.
   */
  children: ReactNode;
  /** Human title for the expand modal's `DialogTitle` (e.g. a snapshot title). Falls back to "Table". */
  title?: string;
  /** Base name (no extension) for the downloaded file. Falls back to a slug of `title`, else "table". */
  downloadName?: string;
  /**
   * Structured data for the CSV. When present the download serializes it directly; when omitted the
   * CSV is extracted from the rendered `<table>` DOM (the markdown-table path with no structured data).
   */
  csv?: { columns: string[]; rows: (string | number)[][] };
  /**
   * Layout class for the INLINE scroll container that holds `children` (border/background/rounded/
   * max-height — e.g. `AnswersSnapshotData`'s capped inset). The modal uses its own taller container,
   * so the same `children` read larger there.
   */
  scrollClassName?: string;
  /** Layout class on the outer (non-scrolling) wrapper that anchors the floating toolbar. */
  className?: string;
};

/** A filename-safe slug: lowercased, non-alphanumerics → single hyphens, trimmed; empty → fallback. */
function slugify(value: string | undefined, fallback: string): string {
  const slug = (value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug.length > 0 ? slug : fallback;
}

/** One rendered table cell → its trimmed text (the DOM/children CSV path). */
function cellText(el: Element): string {
  return (el.textContent ?? "").trim();
}

export function ExpandableTable({
  children,
  title,
  downloadName,
  csv,
  scrollClassName,
  className,
}: ExpandableTableProps) {
  const [expanded, setExpanded] = useState(false);
  // The inline wrapper — read by the DOM/children CSV path to find the rendered `<table>`.
  const inlineRef = useRef<HTMLDivElement>(null);

  function handleDownload() {
    const data = csvFromSource();
    downloadCsv(`${slugify(downloadName ?? title, "table")}.csv`, data);
  }

  /** CSV from the structured data when given, else extracted from the inline `<table>` DOM. */
  function csvFromSource(): string {
    if (csv) return toCsv(csv.columns, csv.rows);
    const table = inlineRef.current?.querySelector("table");
    if (!table) return "";
    const headers = Array.from(table.querySelectorAll("thead th")).map(cellText);
    const rows = Array.from(table.querySelectorAll("tbody tr")).map((tr) =>
      Array.from(tr.querySelectorAll("td")).map(cellText),
    );
    return toCsv(headers, rows);
  }

  return (
    <div className={cn("group/xtable relative min-w-0", className)}>
      <div ref={inlineRef} className={cn("min-w-0", scrollClassName)}>
        {children}
      </div>

      {/* Floating toolbar: hidden until pointer-hover or keyboard focus (mirrors CopyMessageAction),
          so it never clutters the inline table but stays keyboard-reachable with a visible focus ring. */}
      <div className="absolute end-1 top-1 z-10 flex items-center gap-0.5 rounded-md border border-border bg-card p-0.5 opacity-0 shadow-sm transition-opacity focus-within:opacity-100 group-hover/xtable:opacity-100">
        <IconButton
          type="button"
          variant="ghost"
          size="icon-sm"
          label="Download table as CSV"
          onClick={handleDownload}
        >
          <Download aria-hidden className="size-3.5" />
        </IconButton>
        <IconButton
          type="button"
          variant="ghost"
          size="icon-sm"
          label="Expand table"
          onClick={() => setExpanded(true)}
        >
          <Maximize2 aria-hidden className="size-3.5" />
        </IconButton>
      </div>

      <Dialog open={expanded} onOpenChange={setExpanded}>
        {/* ui-wave U2 (owner feedback) — the expand target is the app's NORMAL `@elabs-ai/components-ui` Dialog
            (backdrop, rounded corners, title, close button, Escape + focus trap via Radix), never a
            raw fullscreen takeover. Sized to the owner's ask: max-w-5xl (over size="xl"'s max-w-3xl —
            wide tables are exactly what gets expanded) at max-h-[85vh], body scrolls inside. No
            description → aria-describedby opt-out (the WideDialog sanctioned escape). */}
        <DialogContent
          size="xl"
          aria-describedby={undefined}
          // Keep initial focus on the dialog container (the accessible default for a content-heavy
          // modal) rather than the header's `IconButton`: auto-focusing that button also focuses its
          // `IconButton` `Tooltip` trigger, which opens the tooltip and would swallow the FIRST Escape
          // press closing only the tooltip, not the dialog.
          onOpenAutoFocus={(event) => event.preventDefault()}
          className="flex max-h-[85vh] max-w-5xl flex-col gap-0 p-0"
        >
          <DialogHeader className="flex-none flex-row items-center gap-2 border-b border-border p-4 pe-12">
            <DialogTitle className="min-w-0 flex-1 truncate">{title ?? "Table"}</DialogTitle>
            {/* ui-wave U2 (owner feedback) — the toolbar's download stays available INSIDE the modal:
                while it is open the inline toolbar sits behind the overlay (inert), so without this
                the user would have to close the dialog again just to grab the CSV. */}
            <IconButton
              type="button"
              variant="ghost"
              size="icon-sm"
              label="Download table as CSV"
              className="shrink-0"
              onClick={handleDownload}
            >
              <Download aria-hidden className="size-3.5" />
            </IconButton>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-auto p-4">
            {/* The SAME table, re-rendered in a roomier, taller scroll region (not fullscreen). Only
                mounts while open (Radix `DialogContent`), so there's no permanent double render. */}
            <div className="min-w-0 overflow-auto rounded-md border border-border bg-card">
              {children}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
