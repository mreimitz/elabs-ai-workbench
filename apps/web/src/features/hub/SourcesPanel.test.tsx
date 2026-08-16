// Assistant Hub (WP1.4, §1.7 / R-UX5) — the citation surfaces (inline `[n]` chips + per-message Sources
// + session rail). Rendered with the REAL `@brand/ai` citation vocabulary (light HoverCard/Collapsible —
// no Streamdown/shiki), which is the point: the chips resolve, and an unresolved marker never becomes a
// chip (the UI half of the resolve-test).

import type { HubCitation } from "@mcp-token-footprint/shared";
import { fireEvent, render as rtlRender, screen, within } from "@testing-library/react";
import { TooltipProvider } from "@brand/ui";
import { describe, expect, test } from "vitest";
import {
  citationMarkdownComponents,
  InlineCitationChip,
  MessageSources,
  orderCitations,
  renderCitedText,
  SessionSourceRail,
} from "./SourcesPanel";

// Test harness (toolbar-reach Phase 3): a shared control here now mounts a Radix Tooltip via
// `IconButton`; the app root supplies `TooltipProvider`, so inject it for every render in this file.
const render = (
  ui: Parameters<typeof rtlRender>[0],
  options?: Parameters<typeof rtlRender>[1],
) => rtlRender(<TooltipProvider>{ui}</TooltipProvider>, options);

function citation(id: string, over: Partial<HubCitation> = {}): HubCitation {
  return { id, title: `Source ${id}`, url: `https://example.com/${id}`, ...over };
}

describe("orderCitations", () => {
  test("dedups by id and sorts by the stable citation number", () => {
    const ordered = orderCitations([citation("3"), citation("1"), citation("1"), citation("2")]);
    expect(ordered.map((c) => c.id)).toEqual(["1", "2", "3"]);
  });
});

describe("renderCitedText (R-UX5 inline chips)", () => {
  test("leaves text untouched when there are no citations", () => {
    expect(renderCitedText("Paris is the capital[1].", [])).toBe("Paris is the capital[1].");
  });

  test("weaves a resolvable [n] into a chip and keeps an orphan marker as plain text", () => {
    const cites = [citation("1", { title: "France — Wikipedia" })];
    render(<div>{renderCitedText("Paris[1] is the capital. Made up[7].", cites)}</div>);
    // [1] resolved → an accessible citation chip.
    expect(screen.getByLabelText("Source 1: France — Wikipedia")).toBeInTheDocument();
    // [7] has no source → it stays literal text, never a chip.
    expect(screen.queryByLabelText(/Source 7/)).not.toBeInTheDocument();
    expect(screen.getByText(/Made up\[7\]\./)).toBeInTheDocument();
  });
});

describe("InlineCitationChip", () => {
  test("shows the marker and carries the source on an accessible label", () => {
    render(
      <InlineCitationChip
        citation={citation("2", { title: "MCP spec", url: "https://modelcontextprotocol.io/spec" })}
      />,
    );
    const chip = screen.getByLabelText("Source 2: MCP spec");
    expect(chip).toHaveTextContent("[2]");
    expect(chip).toHaveAttribute("title", "MCP spec — https://modelcontextprotocol.io/spec");
  });

  // WP3.1 acceptance — "sanitization unchanged (no raw-HTML injection via citation titles)". A
  // citation's `title` is server/tool-provided (untrusted, R-MCP12) and flows straight into JSX text
  // interpolation (never `dangerouslySetInnerHTML`), so React escapes it by construction — this proves
  // that holds even for a title crafted to look like a tag or an event-handler attribute.
  test("a hostile citation title never becomes a real element — it renders as inert escaped text", () => {
    const hostile = '<img src=x onerror=alert(1)>&lt;script&gt;alert(1)&lt;/script&gt;';
    render(<InlineCitationChip citation={citation("3", { title: hostile })} />);
    // No actual <img>/<script> element was created anywhere in the document.
    expect(document.querySelector("img")).toBeNull();
    expect(document.querySelector("script[data-hostile]")).toBeNull();
    expect(document.getElementsByTagName("script")).toHaveLength(0);
    // The literal (escaped) text is what's on the page, both in the accessible label and the title attr.
    const chip = screen.getByLabelText(`Source 3: ${hostile}`);
    expect(chip).toHaveAttribute("title", expect.stringContaining(hostile));
  });
});

describe("citationMarkdownComponents (WP3.1, RC4 — the markdown-node weaver)", () => {
  test("returns {} for no citations — a true no-op merge for an uncited message", () => {
    expect(citationMarkdownComponents([])).toEqual({});
  });

  test("p override weaves a resolvable [n] inline and leaves an orphan marker literal", () => {
    const components = citationMarkdownComponents([citation("1", { title: "Paragraph source" })]);
    const P = components.p as (props: { children?: unknown }) => JSX.Element;
    render(<P>{"Paris[1] is the capital. Made up[7]."}</P>);
    expect(screen.getByLabelText("Source 1: Paragraph source")).toBeInTheDocument();
    expect(screen.queryByLabelText(/Source 7/)).not.toBeInTheDocument();
    expect(screen.getByText(/Made up\[7\]\./)).toBeInTheDocument();
  });

  test("a heading override (h2) weaves a chip inline inside the heading element", () => {
    const components = citationMarkdownComponents([citation("1", { title: "Heading source" })]);
    const H2 = components.h2 as (props: { children?: unknown }) => JSX.Element;
    render(<H2>{"Synthesis [1]"}</H2>);
    const heading = screen.getByRole("heading", { level: 2 });
    expect(heading.tagName).toBe("H2");
    expect(within(heading).getByLabelText("Source 1: Heading source")).toBeInTheDocument();
  });

  test("table/th/td overrides render real @brand/ui Table structure with cells woven", () => {
    const components = citationMarkdownComponents([citation("1", { title: "Table source" })]);
    const Table_ = components.table as (props: { children?: unknown }) => JSX.Element;
    const Thead = components.thead as (props: { children?: unknown }) => JSX.Element;
    const Tbody = components.tbody as (props: { children?: unknown }) => JSX.Element;
    const Tr = components.tr as (props: { children?: unknown }) => JSX.Element;
    const Th = components.th as (props: { children?: unknown }) => JSX.Element;
    const Td = components.td as (props: { children?: unknown }) => JSX.Element;
    render(
      <Table_>
        <Thead>
          <Tr>
            <Th>{"Region"}</Th>
          </Tr>
        </Thead>
        <Tbody>
          <Tr>
            <Td>{"EMEA [1]"}</Td>
          </Tr>
        </Tbody>
      </Table_>,
    );
    const table = screen.getByRole("table");
    expect(within(table).getByRole("columnheader", { name: "Region" })).toBeInTheDocument();
    expect(within(table).getByLabelText("Source 1: Table source")).toBeInTheDocument();
  });

  // Same hostile-title guarantee as InlineCitationChip's own test, exercised through the NEW
  // markdown-node weave path end to end (a `[n]` marker resolved inside a `p` override's children).
  test("a hostile citation title stays inert escaped text when woven through the p override", () => {
    const hostile = "<img src=x onerror=alert(1)>";
    const components = citationMarkdownComponents([citation("1", { title: hostile })]);
    const P = components.p as (props: { children?: unknown }) => JSX.Element;
    render(<P>{"Claim[1]."}</P>);
    expect(document.querySelector("img")).toBeNull();
    expect(screen.getByLabelText(`Source 1: ${hostile}`)).toBeInTheDocument();
  });
});

describe("MessageSources (per-message grounding footer)", () => {
  test("renders a count and, once opened, the numbered source rows", () => {
    render(
      <MessageSources citations={[citation("1", { title: "A" }), citation("2", { title: "B" })]} />,
    );
    // The trigger advertises the count without expanding.
    expect(screen.getByText(/2/)).toBeInTheDocument();
    // Opening the collapsible reveals the rows (a real https link, never auto-opened).
    fireEvent.click(screen.getByRole("button"));
    const link = screen.getByRole("link", { name: /A/ });
    expect(link).toHaveAttribute("href", "https://example.com/1");
    expect(link).toHaveAttribute("rel", expect.stringContaining("noopener"));
  });

  test("renders nothing when there are no citations", () => {
    const { container } = render(<MessageSources citations={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("SessionSourceRail", () => {
  test("labels the rail and dedups sources across turns", () => {
    render(<SessionSourceRail citations={[citation("1"), citation("1"), citation("2")]} />);
    expect(screen.getByRole("region", { name: /session sources/i })).toBeInTheDocument();
  });

  test("renders nothing with no session citations", () => {
    const { container } = render(<SessionSourceRail citations={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});

// hub-fixes WP 7.R (adversarial review, INV5) — a citation's `url` is server/tool-provided and UNTRUSTED
// (R-MCP12). `safeHref` must turn ONLY http(s) into a real link target; a `javascript:`/`data:`/`vbscript:`
// URL must never become a clickable href (which would be a stored-XSS / drive-by vector). These lock that
// the source rows + inline chip refuse a hostile scheme and fall back to inert text.
describe("safeHref hostile-scheme confinement (WP 7.R / INV5)", () => {
  for (const hostile of [
    "javascript:alert(document.cookie)",
    "data:text/html,<script>alert(1)</script>",
    "vbscript:msgbox(1)",
    "  javascript:alert(1)", // leading-space evasion
  ]) {
    test(`MessageSources never links a ${hostile.trim().split(":")[0]}: citation URL`, () => {
      render(<MessageSources citations={[citation("1", { title: "Hostile", url: hostile })]} />);
      fireEvent.click(screen.getByRole("button")); // expand the collapsible
      // The source row shows the title as inert text, but NO anchor is produced for a non-http(s) scheme.
      expect(screen.queryByRole("link")).toBeNull();
      // Defensively: no element anywhere carries the hostile string as an href.
      for (const a of Array.from(document.querySelectorAll("a"))) {
        expect(a.getAttribute("href") ?? "").not.toContain(hostile.trim());
      }
      // The label still renders as readable text (honest, just not clickable).
      expect(screen.getByText("Hostile")).toBeInTheDocument();
    });
  }

  test("an inline chip on a hostile-URL citation carries the label but no URL in its title tooltip", () => {
    render(
      <InlineCitationChip citation={citation("2", { title: "Bad", url: "javascript:alert(1)" })} />,
    );
    const chip = screen.getByLabelText("Source 2: Bad");
    // title falls back to the label ALONE (no ` — <url>`), i.e. safeHref returned undefined.
    expect(chip).toHaveAttribute("title", "Bad");
    expect(chip.getAttribute("title") ?? "").not.toContain("javascript:");
  });

  test("a legitimate http(s) citation URL still links (guard is a scheme filter, not a blanket block)", () => {
    render(<MessageSources citations={[citation("1", { title: "Good", url: "https://ok.example/x" })]} />);
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByRole("link", { name: /Good/ })).toHaveAttribute("href", "https://ok.example/x");
  });
});
