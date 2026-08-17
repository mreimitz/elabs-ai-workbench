import { useMemo, type ComponentProps } from "react";
import {
  Badge,
  Button,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  cn,
} from "@elabs-ai/components-ui";
import { MessageResponse } from "@elabs-ai/components-ai";
import { ChevronRight } from "lucide-react";
import { ExpandableTable } from "./ExpandableTable";

/**
 * Render the assistant's markdown the way a real Claude session renders a reply: ONE CONTINUOUS
 * MESSAGE with typographic headings — not a stack of boxed section cards. (The previous version
 * wrapped every `h2`–`h6` section in its own bordered `Card`, which fragmented an answer into
 * widget-looking boxes and clipped `ol` markers against the card's `overflow-hidden`.)
 *
 * What this keeps doing on top of plain Streamdown (`@elabs-ai/components-ai` `MessageResponse`):
 *
 *  1. RESPONSIVE TABLES (no Streamdown chrome): a `components` override maps `table`/`thead`/… onto
 *     `@elabs-ai/components-ui` `Table*`, replacing Streamdown's bordered table-block + copy/download/fullscreen
 *     toolbar with a clean, token-styled, horizontally-scrolling table.
 *  2. CHAT-SCALE TYPOGRAPHY: {@link MD_PROSE} re-targets the raw tags Streamdown emits — headings
 *     step down proportionately (`h1` a step above body, `h2+` bold body-size) with breathing room
 *     above, lists keep their padding so markers never clip, numbers stay `tabular-nums` in tables.
 *  3. CATALOG FOLD ONLY: the ONE structural intervention left. A section whose body is a genuine
 *     multi-dozen-row dump (> {@link CATALOG_TABLE_ROWS} table rows / > {@link CATALOG_LIST_ITEMS}
 *     list items — the "Available Tools" catalog) folds behind a default-closed disclosure labelled
 *     with its heading + a count Badge. Everything else flows inline.
 *
 * Streaming-safe: {@link splitSections} tolerates an unterminated final section, and the catalog
 * fold is gated on `complete` (another heading follows, or the stream has finished), so a trailing
 * in-flight section renders as plain flowing markdown with no flicker as a table fills in.
 */
export function ChatMarkdown({
  text,
  streaming,
  components,
}: {
  text: string;
  streaming?: boolean;
  /** ADDITIVE Streamdown component overrides, merged over the built-in table mapping — e.g. the
   *  assistant dock's internal-route `a` override. Callers must pass a STABLE reference. */
  components?: MdComponents;
}) {
  const blocks = useMemo(() => splitBlocks(text, streaming === true), [text, streaming]);
  const mergedComponents = useMemo(
    () => (components ? { ...MD_TABLE_COMPONENTS, ...components } : MD_TABLE_COMPONENTS),
    [components],
  );

  if (blocks.length === 1 && blocks[0]?.kind === "prose") {
    return <Prose markdown={blocks[0].markdown} components={mergedComponents} />;
  }

  return (
    <div className="flex min-w-0 flex-col gap-2">
      {blocks.map((block) =>
        block.kind === "prose" ? (
          <Prose key={block.key} markdown={block.markdown} components={mergedComponents} />
        ) : (
          <CatalogFold key={block.key} block={block} components={mergedComponents} />
        ),
      )}
    </div>
  );
}

/** The flowing-markdown block: one Streamdown render at chat scale. */
function Prose({ markdown, components }: { markdown: string; components: MdComponents }) {
  return (
    <div className={cn("flex min-w-0 flex-col text-sm", MD_PROSE)}>
      <MessageResponse components={components}>{markdown}</MessageResponse>
    </div>
  );
}

/**
 * A genuine multi-dozen-row catalog: its heading stays visible as a normal heading, the dump folds
 * behind a default-closed disclosure with a row/item count. The one place a border is warranted —
 * it marks "content withheld", matching the tool rows' disclosure idiom.
 */
function CatalogFold({ block, components }: { block: CatalogBlock; components: MdComponents }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      {block.headingText ? (
        <span className="min-w-0 text-sm font-semibold text-foreground">{block.headingText}</span>
      ) : null}
      <Collapsible defaultOpen={false} className="min-w-0 rounded-md border border-border">
        <CollapsibleTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="group/disc h-auto w-full justify-start gap-2 px-2.5 py-1.5 text-left font-normal"
          >
            <ChevronRight
              className="size-3.5 shrink-0 text-muted-foreground transition-transform group-data-[state=open]/disc:rotate-90"
              aria-hidden
            />
            <span className="min-w-0 truncate text-sm text-foreground">Show catalog</span>
            <Badge variant="secondary" className="shrink-0 font-normal tabular-nums">
              {block.count} {block.noun}
            </Badge>
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div
            className={cn(
              "flex min-w-0 flex-col border-t border-border px-2.5 py-2 text-sm",
              MD_PROSE,
            )}
          >
            <MessageResponse components={components}>{block.markdown}</MessageResponse>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}

/**
 * Streamdown component overrides: render markdown tables as `@elabs-ai/components-ui` `Table*` instead of
 * Streamdown's bordered table block + copy/download/fullscreen toolbar. `Table` already wraps itself
 * in a `relative w-full overflow-auto` container, so the table scrolls horizontally on overflow with
 * no extra wrapper. `node` is react-markdown's hast node (not a DOM attribute) — strip it before
 * spreading the rest onto the component. Defined at module scope so the map identity is stable.
 */
export type MdComponents = NonNullable<ComponentProps<typeof MessageResponse>["components"]>;

/**
 * ui-wave U2 (owner feedback) — EXPORTED: Streamdown's own table block carries a "View fullscreen"
 * control that portals a raw edge-to-edge takeover (`fixed inset-0`, no backdrop/title/chrome). Every
 * surface that renders assistant markdown through a bare `MessageResponse` (hub transcript, agent
 * transcript) passes this map instead, so tables everywhere get the ONE `ExpandableTable` toolbar
 * whose expand opens the app's normal `@elabs-ai/components-ui` Dialog. Module-scope constant → stable reference
 * (`MessageResponse` callers must pass stable `components`).
 */
export const MD_TABLE_COMPONENTS: MdComponents = {
  // Acme Answers (WP 6.1) — the markdown table gains the shared download/expand toolbar. There's no
  // structured data here (Streamdown hands the header/body as React children), so `ExpandableTable`
  // extracts the CSV from the rendered `<table>` DOM. `Table`'s own `relative w-full overflow-auto`
  // wrapper keeps the responsive horizontal scroll; the toolbar anchors to the outer wrapper so it
  // never scrolls with the cells.
  table: ({ node: _node, className, ...props }) => (
    <ExpandableTable>
      <Table className={cn("text-xs tabular-nums", className)} {...props} />
    </ExpandableTable>
  ),
  thead: ({ node: _node, ...props }) => <TableHeader {...props} />,
  tbody: ({ node: _node, ...props }) => <TableBody {...props} />,
  tr: ({ node: _node, ...props }) => <TableRow {...props} />,
  th: ({ node: _node, className, ...props }) => (
    <TableHead className={cn("h-auto px-2 py-1 align-top", className)} {...props} />
  ),
  td: ({ node: _node, className, ...props }) => (
    <TableCell className={cn("px-2 py-1 align-top", className)} {...props} />
  ),
};

/**
 * Chat-scale typography for the streamed markdown — ONE continuous document, Claude-style.
 * Arbitrary-variant utilities re-target the raw tags Streamdown emits. The `!` (important) on
 * heading size/weight beats the library's own equal-specificity `[&_h2]:text-subtitle …` so a
 * heading steps down to chat scale instead of document scale. Headings breathe: margin above >
 * below (except when first). Lists KEEP their inline padding (`ps-5`) so `ol` markers render inside
 * the box — the old section Cards clipped them. Semantic tokens only (reads in both themes).
 */
const MD_PROSE = [
  // Heading scale: h1 one step above body; h2–h3 bold body; h4–h6 medium body.
  "[&_h1]:!text-base [&_h1]:!font-semibold [&_h1]:!text-foreground",
  "[&_h2]:!text-sm [&_h2]:!font-semibold [&_h2]:!text-foreground",
  "[&_h3]:!text-sm [&_h3]:!font-semibold [&_h3]:!text-foreground",
  "[&_h4]:!text-sm [&_h4]:!font-medium [&_h4]:!text-foreground",
  "[&_h5]:!text-sm [&_h5]:!font-medium [&_h5]:!text-foreground",
  "[&_h6]:!text-sm [&_h6]:!font-medium [&_h6]:!text-foreground",
  // Rhythm: air above a heading, a little below; none above the first block.
  "[&_h1]:mt-4 [&_h2]:mt-3 [&_h3]:mt-3 [&_h4]:mt-2 [&_h5]:mt-2 [&_h6]:mt-2",
  "[&_h1]:mb-1 [&_h2]:mb-1 [&_h3]:mb-1 [&_h4]:mb-0.5 [&_h5]:mb-0.5 [&_h6]:mb-0.5",
  "[&_:first-child]:mt-0",
  // Lists: keep marker padding (fixes clipped `1.`/`2.` markers), tight vertical rhythm.
  "[&_ul]:my-1 [&_ol]:my-1 [&_ul]:ps-5 [&_ol]:ps-5 [&_li]:my-0.5",
  "[&_p]:my-1.5",
  "[&_hr]:my-3",
  // Spacing only — borders/overflow/size come from @elabs-ai/components-ui Table.
  "[&_table]:my-1.5",
].join(" ");

/** A markdown table needs MORE than this many data rows to be treated as a genuine tool catalog. */
const CATALOG_TABLE_ROWS = 12;
/** A markdown list needs MORE than this many items to be treated as a genuine tool catalog. */
const CATALOG_LIST_ITEMS = 12;

type ProseBlock = { kind: "prose"; key: string; markdown: string };
type CatalogBlock = {
  kind: "catalog";
  key: string;
  headingText: string | null;
  /** The section body WITHOUT its heading line (the heading renders above the fold). */
  markdown: string;
  count: number;
  noun: string;
};
type Block = ProseBlock | CatalogBlock;

/**
 * Split the message into flowing-prose chunks and catalog folds. Sections come from
 * {@link splitSections}; contiguous non-catalog sections MERGE back into one prose chunk (so the
 * document flows as a single markdown render), and only a complete catalog section becomes a fold.
 * The trailing section is only "complete" once the stream has ended.
 */
function splitBlocks(text: string, streaming: boolean): Block[] {
  const sections = splitSections(text);
  const blocks: Block[] = [];
  let pending: string[] = [];
  let keyN = 0;

  const flushProse = () => {
    const markdown = pending.join("\n").trim();
    pending = [];
    if (markdown.length > 0) blocks.push({ kind: "prose", key: `p${keyN++}`, markdown });
  };

  sections.forEach((section, index) => {
    const isLast = index === sections.length - 1;
    const complete = !isLast || !streaming;
    const catalog = complete ? overflowOf(section) : null;
    if (catalog) {
      flushProse();
      blocks.push({
        kind: "catalog",
        key: section.key,
        headingText: section.headingText,
        markdown: stripHeading(section),
        count: catalog.count,
        noun: catalog.noun,
      });
      return;
    }
    pending.push(section.markdown);
  });
  flushProse();

  return blocks;
}

type Section = {
  key: string;
  /** The trimmed heading title, or null for the intro block. */
  headingText: string | null;
  /** The heading level (1–6), or null for the intro block. */
  headingLevel: number | null;
  /** The original markdown for this section (heading line + body), rendered verbatim by Streamdown. */
  markdown: string;
};

const HEADING_RE = /^(#{1,6})\s+(.*)$/;

/**
 * Split markdown into heading-delimited sections, preserving original order and verbatim source.
 * Any prose BEFORE the first heading (intro) becomes a leading headingText:null section. A heading
 * starts a new section that runs until the next heading or end-of-text — so an unterminated final
 * section (still streaming) is just the last entry. Fenced code blocks are respected: a `#` inside a
 * ``` fence is NOT a heading.
 */
function splitSections(text: string): Section[] {
  const lines = text.split("\n");
  const sections: Section[] = [];
  let current: string[] = [];
  let currentHeading: string | null = null;
  let currentLevel: number | null = null;
  let started = false;
  let inFence = false;
  let keyN = 0;

  const flush = () => {
    if (!started && current.length === 0) return;
    const markdown = current.join("\n");
    // Drop a section that is only whitespace (e.g. trailing blank lines after a heading split).
    if (markdown.trim().length === 0 && currentHeading === null) return;
    sections.push({
      key: `s${keyN++}`,
      headingText: currentHeading,
      headingLevel: currentLevel,
      markdown,
    });
  };

  for (const line of lines) {
    const fence = /^\s*(```|~~~)/.test(line);
    if (fence) inFence = !inFence;

    const headingMatch = !inFence ? HEADING_RE.exec(line) : null;
    if (headingMatch) {
      flush();
      current = [line];
      // group[1] is the run of `#` (1–6) → level; group[2] is the heading text.
      currentLevel = headingMatch[1]?.length ?? null;
      currentHeading = headingMatch[2]?.trim() ?? "";
      started = true;
      continue;
    }
    current.push(line);
    started = true;
  }
  flush();

  return sections;
}

/** The section body with its leading heading line removed (the heading renders above the fold). */
function stripHeading(section: Section): string {
  const all = section.markdown.split("\n");
  return (section.headingText !== null ? all.slice(1) : all).join("\n").trim();
}

/** If a section's body is a genuine (multi-dozen-row) tool catalog, the count + noun for its Badge. */
function overflowOf(section: Section): { count: number; noun: string } | null {
  const tableRows = countTableDataRows(section.markdown);
  if (tableRows > CATALOG_TABLE_ROWS) {
    return { count: tableRows, noun: tableRows === 1 ? "row" : "rows" };
  }
  const listItems = countListItems(section.markdown);
  if (listItems > CATALOG_LIST_ITEMS) {
    return { count: listItems, noun: listItems === 1 ? "item" : "items" };
  }
  return null;
}

/**
 * Count GFM-table DATA rows (excludes the header row and the `|---|---|` delimiter row). A table is
 * recognised by a delimiter line of pipes and dashes; data rows are the contiguous pipe-rows that
 * follow it. Tolerant of a half-written final row (streaming). Code fences are skipped.
 */
function countTableDataRows(markdown: string): number {
  const lines = markdown.split("\n");
  let inFence = false;
  let best = 0;
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i] ?? "";
    if (/^\s*(```|~~~)/.test(raw)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    // A delimiter row like `|---|:--:|---|` (pipes, dashes, colons, spaces; at least one dash).
    const isDelimiter =
      /^\s*\|?[\s:|-]*-[\s:|-]*\|?\s*$/.test(raw) && raw.includes("-") && raw.includes("|");
    if (!isDelimiter) continue;
    // Count contiguous pipe-bearing rows after the delimiter as data rows.
    let count = 0;
    for (let j = i + 1; j < lines.length; j++) {
      const row = lines[j] ?? "";
      if (row.trim().length === 0) break;
      if (!row.includes("|")) break;
      count++;
    }
    if (count > best) best = count;
  }
  return best;
}

/**
 * Count top-level markdown list items (`- `, `* `, `+ `, or `N. `). Counts the largest single
 * contiguous run so an oversized list isn't diluted by unrelated short lists elsewhere in the
 * section. Code fences are skipped.
 */
function countListItems(markdown: string): number {
  const lines = markdown.split("\n");
  let inFence = false;
  let best = 0;
  let run = 0;
  for (const raw of lines) {
    if (/^\s*(```|~~~)/.test(raw)) {
      inFence = !inFence;
      run = 0;
      continue;
    }
    if (inFence) {
      run = 0;
      continue;
    }
    const isItem = /^\s*([-*+]\s+|\d+[.)]\s+)/.test(raw);
    if (isItem) {
      run++;
      if (run > best) best = run;
    } else if (raw.trim().length === 0) {
      // a blank line ends a tight list run
      run = 0;
    }
    // continuation/wrapped lines (indented, non-blank) neither extend nor reset the run.
  }
  return best;
}
