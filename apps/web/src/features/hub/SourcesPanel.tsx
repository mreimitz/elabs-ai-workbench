// Assistant Hub (roadmap/assistant-hub/, WP1.4, §1.7 / R-UX5) — the citation surfaces: inline `[n]`
// chips woven into an answer, a per-message `Sources` panel, and a session-wide source rail. All three
// resolve against the settled message's `citations[]` (the API post-pass guarantees every `[n]` a real
// source — `hub/citations.ts`), so a marker with no matching citation renders as PLAIN TEXT, never a
// dangling chip (the resolve-test's UI half).
//
// Composition note (library-first): `@elabs-ai/components-ai` ships `InlineCitation*`/`Sources*` sugar, but its
// `InlineCitationCardTrigger` renders a DOMAIN chip, not the numbered `[n]` R-UX5 mandates, and the
// `@elabs-ai/components-ai` barrel pulls `@xyflow/react`'s CSS (which the Vitest/node loader can't parse). So these
// surfaces are composed from the SAME underlying `@elabs-ai/components-ui` primitives those wrappers use — `HoverCard`
// for the inline chip, `Collapsible` for the panels — giving a real `[n]` label and mock-free tests.
//
// WP3.1 (RC4) — `citationMarkdownComponents` is the OTHER half: a Streamdown `components` override map
// (the same mechanism `AssistantMessageBody.tsx`'s dock uses to re-route `a`) that weaves `[n]` markers
// INLINE inside real rendered markdown, instead of `renderCitedText`'s old whole-string array (which
// forced `ConversationPane` to bail out of markdown entirely — see that function's own doc comment).
// Every block-level tag that can carry leaf prose (`p`/`li`/`blockquote`/headings/table cells) gets a
// thin wrapper that walks its OWN top-level `children` and replaces a resolvable `[n]` STRING run with
// an `InlineCitationChip`; nested elements (`strong`/`em`/`a`/`code`) pass through untouched — a marker
// literally nested inside emphasis is the one case this doesn't weave, an acceptable, documented limit
// given the live synthesis shape never does that. `table`/`thead`/`tbody`/`tr` are also re-pointed at
// `@elabs-ai/components-ui` `Table*` (brand-ui-only — Streamdown's own built-in table chrome is a second UI kit) using
// the SAME styling `ChatMarkdown.tsx` uses for its table override, kept independent here rather than
// importing it (a citation-bearing table needs the weave-then-style compose that a straight re-export
// can't express). ui-wave U2 (owner feedback): the cited `table` override now ALSO wraps in
// `ExpandableTable`, so a citation-bearing table carries the same download/expand toolbar as every
// other rendered table — expand opens the app's normal Dialog, never Streamdown's raw fullscreen —
// and `ConversationPane`'s UNCITED path rides `ChatMarkdown`'s exported `MD_TABLE_COMPONENTS` for the
// same reason (superseding WP3.1's byte-identical-when-uncited stance).

import {
  Badge,
  cn,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Text,
} from "@elabs-ai/components-ui";
import type { MessageResponse } from "@elabs-ai/components-ai";
import type { HubCitation } from "@mcp-token-footprint/shared";
import { ChevronDown, ExternalLink, Quote } from "lucide-react";
import { createElement, type ComponentProps, type ReactNode } from "react";
import { ExpandableTable } from "../testing/ExpandableTable";

/** Only http(s) URLs are ever turned into a real link target (R-MCP12 — server-provided URLs are
 *  untrusted; nothing else is auto-linked, nothing is prefetched). */
function safeHref(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:"
      ? parsed.toString()
      : undefined;
  } catch {
    return undefined;
  }
}

/** A short label for a source: its title, falling back to its URL host. */
export function citationLabel(citation: HubCitation): string {
  if (citation.title.trim()) return citation.title.trim();
  const href = safeHref(citation.url);
  if (href) {
    try {
      return new URL(href).host;
    } catch {
      return href;
    }
  }
  return `Source ${citation.id}`;
}

// ── Inline `[n]` chip (hover card + quote) ────────────────────────────────────────────────────────────

/**
 * One inline citation marker: a `[n]` badge that reveals the source (title · link · quoted snippet) on
 * hover. The accessible label + native `title` carry the source on the trigger itself, so the
 * association is reachable by keyboard/screen-reader and testable without opening the (portalled) card.
 */
export function InlineCitationChip({ citation }: { citation: HubCitation }) {
  const href = safeHref(citation.url);
  const label = citationLabel(citation);
  return (
    <HoverCard openDelay={80} closeDelay={0}>
      <HoverCardTrigger asChild>
        <Badge
          variant="outline"
          className="mx-0.5 cursor-default rounded-full px-1.5 align-baseline text-caption tabular-nums"
          aria-label={`Source ${citation.id}: ${label}`}
          title={href ? `${label} — ${href}` : label}
        >
          [{citation.id}]
        </Badge>
      </HoverCardTrigger>
      <HoverCardContent className="flex w-80 min-w-0 flex-col gap-2">
        {href ? (
          <a
            href={href}
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex min-w-0 items-center gap-1 text-caption font-medium text-primary underline-offset-2 hover:underline"
          >
            <span className="min-w-0 truncate">{label}</span>
            <ExternalLink aria-hidden className="size-3 shrink-0" />
          </a>
        ) : (
          <Text className="min-w-0 truncate text-caption font-medium">{label}</Text>
        )}
        {href ? (
          <Text tone="muted" className="min-w-0 break-all text-caption">
            {href}
          </Text>
        ) : null}
        {citation.snippet ? (
          <div className="flex items-start gap-1.5 border-l-2 border-border pl-2 text-caption text-muted-foreground">
            <Quote aria-hidden className="mt-0.5 size-3 shrink-0" />
            <span className="min-w-0">{citation.snippet}</span>
          </div>
        ) : null}
      </HoverCardContent>
    </HoverCard>
  );
}

/** Matches a numbered citation marker like `[1]` or `[42]` — shared by every weaver below. */
const CITATION_MARKER_RE = /\[(\d{1,4})\]/g;

/**
 * The shared split: walk ONE run of plain text, turning every marker that resolves against `byId`
 * into an {@link InlineCitationChip} and leaving an orphan marker as literal text in the surrounding
 * run. `nextKey` is a shared counter (closed over by the caller) so chips stay uniquely keyed across
 * every run in a message, not just within one. Always returns an array — `[text]` unchanged when
 * there is nothing to weave, so callers can splice it flat into a larger children list.
 */
function weaveMarkerRun(
  text: string,
  byId: ReadonlyMap<string, HubCitation>,
  nextKey: () => number,
): ReactNode[] {
  if (!text.includes("[")) return [text];
  const nodes: ReactNode[] = [];
  const regex = new RegExp(CITATION_MARKER_RE);
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    const citation = byId.get(match[1] ?? "");
    if (!citation) continue; // orphan marker → leave it in the surrounding text run
    if (match.index > lastIndex) nodes.push(text.slice(lastIndex, match.index));
    nodes.push(<InlineCitationChip key={`cite-${nextKey()}`} citation={citation} />);
    lastIndex = match.index + match[0].length;
  }
  if (nodes.length === 0) return [text];
  if (lastIndex < text.length) nodes.push(text.slice(lastIndex));
  return nodes;
}

/**
 * Weave an answer's `[n]` markers into inline citation chips (R-UX5). Splits on `[n]`; a marker that
 * resolves to a citation becomes an {@link InlineCitationChip}, one that does NOT resolve stays as its
 * literal text — the UI never renders a chip that points nowhere. Returns the original string untouched
 * when there is nothing to weave (so a caller rendering plain, non-markdown text has a clean fallback).
 *
 * WP3.1 — `ConversationPane` no longer uses this for message BODIES (that bypassed markdown entirely,
 * RC4); it stays exported for the `SourcesPanel` preview surfaces and keeps its exact prior behavior/
 * signature (verified by its own tests). See {@link citationMarkdownComponents} for the markdown path.
 */
export function renderCitedText(text: string, citations: readonly HubCitation[]): ReactNode {
  if (citations.length === 0 || !text.includes("[")) return text;
  const byId = new Map(citations.map((c) => [c.id, c]));
  let key = 0;
  const nodes = weaveMarkerRun(text, byId, () => key++);
  return nodes.length === 1 && nodes[0] === text ? text : nodes;
}

// ── Markdown component overrides (WP3.1, RC4) — chips INSIDE real rendered markdown ────────────────────

/** The Streamdown `components` override shape (mirrors `ChatMarkdown.tsx`'s own `MdComponents`). */
type MdComponents = NonNullable<ComponentProps<typeof MessageResponse>["components"]>;

type WithNode<P> = P & { node?: unknown };

/** Weave every top-level STRING child of a block element; element children (`strong`/`em`/`a`/`code`)
 *  pass through untouched — a marker nested INSIDE emphasis is the one case this doesn't reach. */
function weaveChildren(
  children: ReactNode,
  byId: ReadonlyMap<string, HubCitation>,
  nextKey: () => number,
): ReactNode {
  const list = Array.isArray(children) ? children : [children];
  const out: ReactNode[] = [];
  for (const child of list) {
    if (typeof child === "string") out.push(...weaveMarkerRun(child, byId, nextKey));
    else out.push(child);
  }
  return out;
}

const WOVEN_BLOCK_TAGS = ["p", "li", "blockquote", "h1", "h2", "h3", "h4", "h5", "h6"] as const;

/**
 * Build a Streamdown `components` override map that weaves `[n]` markers into
 * {@link InlineCitationChip}s wherever Streamdown put them — flowing prose, list items, blockquotes,
 * headings, and table cells — instead of `renderCitedText`'s old whole-message array that forced
 * `ConversationPane` out of markdown rendering entirely (RC4). Table structure is re-pointed at
 * `@elabs-ai/components-ui` `Table*` alongside the weave (brand-ui-only — Streamdown's own table chrome is a second
 * UI kit). Returns `{}` when there are no citations, so merging it into a caller's own overrides is a
 * true no-op for an uncited message (the byte-identical-before-this-WP guarantee).
 */
export function citationMarkdownComponents(citations: readonly HubCitation[]): MdComponents {
  if (citations.length === 0) return {};
  const byId = new Map(citations.map((c) => [c.id, c]));
  let key = 0;
  const nextKey = () => key++;
  const weave = (children: ReactNode) => weaveChildren(children, byId, nextKey);

  // Built as a loosely-typed record first — assigning tag-by-tag against `MdComponents` directly
  // blows up `tsc` ("union type too complex", Streamdown's `Components` is a big keyed union) — then
  // cast once at the end, the same shape `ChatMarkdown.tsx`'s own override map produces.
  const components: Record<string, (props: WithNode<{ children?: ReactNode }>) => ReactNode> = {};
  for (const tag of WOVEN_BLOCK_TAGS) {
    components[tag] = ({ node: _node, children, ...props }) =>
      createElement(tag, props, weave(children));
  }
  // ui-wave U2 (owner feedback) — the cited table gets the SAME `ExpandableTable` wrap as every other
  // rendered markdown table (download + expand-to-Dialog; no structured data, so the CSV comes from
  // the rendered DOM). The weave stays in the th/td overrides below, untouched by the wrapper.
  components.table = ({ node: _node, className, ...props }: WithNode<ComponentProps<"table">>) => (
    <ExpandableTable>
      <Table className={cn("text-caption tabular-nums", className)} {...props} />
    </ExpandableTable>
  );
  components.thead = ({ node: _node, ...props }: WithNode<ComponentProps<"thead">>) => (
    <TableHeader {...props} />
  );
  components.tbody = ({ node: _node, ...props }: WithNode<ComponentProps<"tbody">>) => (
    <TableBody {...props} />
  );
  components.tr = ({ node: _node, ...props }: WithNode<ComponentProps<"tr">>) => <TableRow {...props} />;
  components.th = ({ node: _node, className, children, ...props }: WithNode<ComponentProps<"th">>) => (
    <TableHead className={cn("h-auto px-2 py-1 align-top", className)} {...props}>
      {weave(children)}
    </TableHead>
  );
  components.td = ({ node: _node, className, children, ...props }: WithNode<ComponentProps<"td">>) => (
    <TableCell className={cn("px-2 py-1 align-top", className)} {...props}>
      {weave(children)}
    </TableCell>
  );
  return components as MdComponents;
}

// ── Source rows + collapsible panels ──────────────────────────────────────────────────────────────────

function SourceRow({ citation }: { citation: HubCitation }) {
  const href = safeHref(citation.url);
  const label = citationLabel(citation);
  return (
    <div className="flex min-w-0 items-start gap-2 py-1">
      <Badge variant="secondary" className="shrink-0 tabular-nums text-caption">
        [{citation.id}]
      </Badge>
      <div className="flex min-w-0 flex-col">
        {href ? (
          <a
            href={href}
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex min-w-0 items-center gap-1 text-caption text-primary underline-offset-2 hover:underline"
          >
            <span className="min-w-0 truncate">{label}</span>
            <ExternalLink aria-hidden className="size-3 shrink-0" />
          </a>
        ) : (
          <Text className="min-w-0 truncate text-caption">{label}</Text>
        )}
        {citation.snippet ? (
          <Text tone="muted" className="line-clamp-2 text-caption">
            {citation.snippet}
          </Text>
        ) : null}
      </div>
    </div>
  );
}

/** The per-message grounding footer (R-UX5): a collapsible `Sources (n)` list under an answer. */
export function MessageSources({ citations }: { citations: readonly HubCitation[] }) {
  const ordered = orderCitations(citations);
  if (ordered.length === 0) return null;
  return (
    <Collapsible className="mt-1">
      <CollapsibleTrigger className="group flex items-center gap-1.5 rounded-md text-caption text-muted-foreground hover:text-foreground">
        <ChevronDown
          aria-hidden
          className="size-3.5 transition-transform group-data-[state=open]:rotate-180"
        />
        Sources ({ordered.length})
      </CollapsibleTrigger>
      <CollapsibleContent className="pt-1">
        {ordered.map((citation) => (
          <SourceRow key={citation.id} citation={citation} />
        ))}
      </CollapsibleContent>
    </Collapsible>
  );
}

/**
 * The session source rail (R-UX5): every distinct source cited across the whole session, deduped by its
 * stable id and rendered once in number order — so `[2]` means the same thing everywhere. Collapsed by
 * default to stay out of the way of the transcript.
 */
export function SessionSourceRail({ citations }: { citations: readonly HubCitation[] }) {
  const ordered = orderCitations(citations);
  if (ordered.length === 0) return null;
  return (
    <section
      aria-label="Session sources"
      className="mx-4 mb-2 rounded-md border border-border bg-card/50"
    >
      <Collapsible className="px-3 py-2">
        <CollapsibleTrigger className="group flex w-full items-center gap-1.5 text-caption font-medium text-foreground">
          <ChevronDown
            aria-hidden
            className="size-3.5 transition-transform group-data-[state=open]:rotate-180"
          />
          Session sources ({ordered.length})
        </CollapsibleTrigger>
        <CollapsibleContent className="pt-1">
          {ordered.map((citation) => (
            <SourceRow key={citation.id} citation={citation} />
          ))}
        </CollapsibleContent>
      </Collapsible>
    </section>
  );
}

/** Dedup by id and sort by the stable citation number (no drift — the numbers came from the API ledger). */
export function orderCitations(citations: readonly HubCitation[]): HubCitation[] {
  const byId = new Map<string, HubCitation>();
  for (const citation of citations) if (!byId.has(citation.id)) byId.set(citation.id, citation);
  return [...byId.values()].sort((a, b) => Number(a.id) - Number(b.id));
}
