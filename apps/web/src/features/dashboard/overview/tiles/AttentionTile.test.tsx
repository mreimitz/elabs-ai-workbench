import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, test, vi } from "vitest";
import { TooltipProvider } from "@elabs-ai/components-ui";
import type { AttentionData, AttentionItem, SectionEnvelope } from "../overview-contract";
import { AttentionTile } from "./AttentionTile";

// Fixtures are LOCAL on purpose (WP 1.3): the hook that fills `OverviewData` is WP 1.1, built in
// parallel — this suite pins the tile against the committed CONTRACT, never against a producer.

function item(overrides: Partial<AttentionItem> = {}): AttentionItem {
  return {
    kind: "scan_failed",
    label: "Alpha",
    detail: "Latest scan failed: connection refused",
    href: "/servers/srv-a",
    serverId: "srv-a",
    ...overrides,
  };
}

function ready(items: AttentionItem[], total = items.length): SectionEnvelope<AttentionData> {
  return { state: "ready", data: { items, total }, error: null };
}

function renderTile(
  section: SectionEnvelope<AttentionData>,
  props: { onRunScan?: (serverId: string) => void; onRetry?: () => void } = {},
) {
  return render(
    <MemoryRouter>
      <TooltipProvider>
        <AttentionTile section={section} {...props} />
      </TooltipProvider>
    </MemoryRouter>,
  );
}

describe("AttentionTile — the empty decision (WP 1.3 hard requirement 1)", () => {
  test("SELF-HIDES when the section is `empty` — nothing was measured, so there is nothing to claim", () => {
    const { container } = renderTile({ state: "empty", data: null, error: null });
    expect(container).toBeEmptyDOMElement();
  });

  test("SELF-HIDES when the section settled `ready` with no data at all", () => {
    const { container } = renderTile({ state: "ready", data: null, error: null });
    expect(container).toBeEmptyDOMElement();
  });

  test("RENDERS an all-clear when the section RAN and found nothing — the one deliberate exception", () => {
    renderTile(ready([]));
    expect(screen.getByText("Needs you")).toBeInTheDocument();
    expect(screen.getByText(/Nothing needs you/)).toBeInTheDocument();
    // The all-clear is a positive measured result, never an empty box: no queue is rendered.
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });

  test("an ERROR is never dressed up as an all-clear", () => {
    renderTile({ state: "error", data: null, error: "metrics timed out" });
    expect(screen.getByText(/Couldn’t load what needs you/)).toBeInTheDocument();
    expect(screen.getByText("metrics timed out")).toBeInTheDocument();
    expect(screen.queryByText(/Nothing needs you/)).not.toBeInTheDocument();
  });

  test("loading renders a layout-shaped placeholder, not a spinner and not an all-clear", () => {
    const { container } = renderTile({ state: "loading", data: null, error: null });
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(screen.queryByText(/Nothing needs you/)).not.toBeInTheDocument();
  });
});

describe("AttentionTile — rows", () => {
  test("each row carries the contract's own href and a status chip with TEXT", () => {
    renderTile(
      ready([
        item({ label: "Alpha", href: "/servers/srv-a", kind: "scan_failed" }),
        item({
          label: "Beta",
          href: "/servers/srv-b",
          kind: "server_unscanned",
          detail: null,
          serverId: "srv-b",
        }),
        item({
          label: "Tool call keeps timing out",
          href: "/testing/issues/issue-1",
          kind: "issue_regressed",
          detail: "Seen 12 times since Monday",
          serverId: null,
        }),
        item({
          label: "Unhandled provider error",
          href: "/testing/issues/issue-2",
          kind: "issue_open",
          detail: null,
          serverId: null,
        }),
      ]),
    );

    expect(screen.getByRole("link", { name: "Alpha" })).toHaveAttribute("href", "/servers/srv-a");
    expect(screen.getByRole("link", { name: "Beta" })).toHaveAttribute("href", "/servers/srv-b");
    expect(screen.getByRole("link", { name: "Tool call keeps timing out" })).toHaveAttribute(
      "href",
      "/testing/issues/issue-1",
    );

    // Chips come from the app's ONE status vocabulary — each states its meaning in words.
    expect(screen.getByText("Failed")).toBeInTheDocument();
    expect(screen.getByText("Pending")).toBeInTheDocument();
    expect(screen.getByText("Regressed")).toBeInTheDocument();
    expect(screen.getByText("Open")).toBeInTheDocument();

    expect(screen.getByText("Latest scan failed: connection refused")).toBeInTheDocument();
    expect(screen.getByText("Seen 12 times since Monday")).toBeInTheDocument();
  });

  test("the header count badge states the section TOTAL, not the visible row count", () => {
    renderTile(ready([item({ label: "Alpha" })], 9));
    expect(screen.getByText("9")).toBeInTheDocument();
  });

  test("more items than the tile lists → the remainder is stated, never silently dropped", () => {
    const many = Array.from({ length: 12 }, (_, i) =>
      item({ label: `Server ${i}`, href: `/servers/srv-${i}`, serverId: `srv-${i}` }),
    );
    renderTile(ready(many, 12));
    expect(screen.getAllByRole("listitem")).toHaveLength(8);
    expect(screen.getByText("+4 more")).toBeInTheDocument();
  });

  test("long labels truncate rather than overflow the narrow tile", () => {
    renderTile(ready([item({ label: "A very long MCP server name that will not fit this tile" })]));
    const link = screen.getByRole("link", {
      name: "A very long MCP server name that will not fit this tile",
    });
    const span = link.querySelector("span");
    expect(span?.className).toContain("truncate");
    expect(span?.className).toContain("min-w-0");
  });
});

describe("AttentionTile — the inline scan action", () => {
  test("a server row exposes an IconButton whose accessible name NAMES the server, and it fires", () => {
    const onRunScan = vi.fn();
    renderTile(ready([item({ label: "Alpha", serverId: "srv-a" })]), { onRunScan });

    const button = screen.getByRole("button", { name: "Scan Alpha now" });
    // D-TB5: the affordance is the tooltip == aria-label, never a native `title`.
    expect(button).not.toHaveAttribute("title");

    fireEvent.click(button);
    expect(onRunScan).toHaveBeenCalledWith("srv-a");
  });

  test("a row with no server (an issue) gets no scan action", () => {
    renderTile(ready([item({ label: "An issue", serverId: null, kind: "issue_open" })]), {
      onRunScan: vi.fn(),
    });
    expect(screen.queryByRole("button", { name: /^Scan / })).not.toBeInTheDocument();
  });

  test("no `onRunScan` handler → no scan action at all (the row is still a working link)", () => {
    renderTile(ready([item({ label: "Alpha", serverId: "srv-a" })]));
    expect(screen.queryByRole("button", { name: /^Scan / })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Alpha" })).toBeInTheDocument();
  });
});
