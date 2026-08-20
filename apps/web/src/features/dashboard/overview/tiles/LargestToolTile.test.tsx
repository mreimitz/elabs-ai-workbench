import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import type { ScanSummary } from "@mcp-token-footprint/shared";
import { LargestToolTile } from "./LargestToolTile";

/**
 * dashboard-bento WP 2.1 — `LargestToolTile`.
 *
 * No chart stub here on purpose: this tile draws NO series, and one of the tests below locks that
 * absence in place. "Largest single tool" can be a DIFFERENT tool at every point in the history, so
 * a Δ or a sparkline would silently compare unlike things — the fabricated figure the WP forbids.
 * Everything rendered is the REAL `@elabs-ai/components-ui` (`MetricCard`, `Progress`), so the
 * assertions run against the components that actually paint.
 */

function scan(overrides: Partial<ScanSummary> & { id: string; serverId: string }): ScanSummary {
  return {
    serverName: overrides.serverId,
    tokenProfile: "generic_o200k",
    scannedAt: "2026-01-02T00:00:00Z",
    status: "success",
    totalTools: 3,
    totalTokens: 1000,
    totalRawBytes: 4000,
    averageTokensPerTool: 333,
    largestToolName: "search_repositories",
    largestToolTokens: 500,
    totalResources: 0,
    totalResourceTemplates: 0,
    totalPrompts: 0,
    totalResourceTokens: 0,
    totalPromptTokens: 0,
    largestResourceTokens: 0,
    largestPromptTokens: 0,
    countingVersion: 2,
    ...overrides,
  };
}

describe("LargestToolTile — self-hiding", () => {
  test("no scans renders NOTHING (the bento never shows an empty box)", () => {
    const { container } = render(<LargestToolTile scans={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  test("a scan that named no largest tool renders NOTHING", () => {
    const { container } = render(
      <LargestToolTile
        scans={[scan({ id: "s1", serverId: "srv-a", largestToolName: undefined })]}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  test("a FAILED scan is not a footprint — it cannot supply this figure", () => {
    const { container } = render(
      <LargestToolTile scans={[scan({ id: "s1", serverId: "srv-a", status: "failed" })]} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});

describe("LargestToolTile — the figure", () => {
  test("states the biggest single tool across the fleet, and names it", () => {
    render(
      <LargestToolTile scans={[scan({ id: "s1", serverId: "srv-a", serverName: "Alpha" })]} />,
    );
    expect(screen.getByText("Largest single tool")).toBeInTheDocument();
    expect(screen.getByText("500")).toBeInTheDocument();
    expect(screen.getByText("search_repositories")).toBeInTheDocument();
  });

  test("picks the LARGEST across servers, not the first row", () => {
    render(
      <LargestToolTile
        scans={[
          scan({ id: "a", serverId: "srv-a", serverName: "Alpha", largestToolTokens: 500 }),
          scan({
            id: "b",
            serverId: "srv-b",
            serverName: "Bravo",
            largestToolName: "create_pull_request",
            largestToolTokens: 900,
            totalTokens: 1800,
          }),
        ]}
      />,
    );
    expect(screen.getByText("900")).toBeInTheDocument();
    expect(screen.getByText("create_pull_request")).toBeInTheDocument();
  });

  test("only each server's LATEST successful scan counts — a superseded scan cannot win", () => {
    render(
      <LargestToolTile
        scans={[
          scan({
            id: "new",
            serverId: "srv-a",
            serverName: "Alpha",
            scannedAt: "2026-02-01T00:00:00Z",
            largestToolName: "list_issues",
            largestToolTokens: 120,
          }),
          scan({
            id: "old",
            serverId: "srv-a",
            serverName: "Alpha",
            scannedAt: "2026-01-01T00:00:00Z",
            largestToolName: "search_repositories",
            largestToolTokens: 900,
          }),
        ]}
      />,
    );
    expect(screen.getByText("120")).toBeInTheDocument();
    expect(screen.getByText("list_issues")).toBeInTheDocument();
    expect(screen.queryByText("search_repositories")).not.toBeInTheDocument();
  });
});

describe("LargestToolTile — the share, and what it refuses to claim", () => {
  test("states which server it belongs to and what share of that server's tool tokens it is", () => {
    render(
      <LargestToolTile
        scans={[
          scan({
            id: "s1",
            serverId: "srv-a",
            serverName: "Alpha",
            largestToolTokens: 500,
            totalTokens: 1000,
          }),
        ]}
      />,
    );
    expect(screen.getByText("50.0% of Alpha’s tool tokens")).toBeInTheDocument();
    // The bar carries the same sentence, so colour/length is never the only signal.
    expect(
      screen.getByRole("progressbar", {
        name: "search_repositories is 50.0% of Alpha’s tool tokens",
      }),
    ).toBeInTheDocument();
  });

  test("a zero tool total yields NO share and NO bar — never a meaningless 0%", () => {
    render(
      <LargestToolTile
        scans={[
          scan({
            id: "s1",
            serverId: "srv-a",
            serverName: "Alpha",
            largestToolTokens: 500,
            totalTokens: 0,
          }),
        ]}
      />,
    );
    expect(screen.getByText("On Alpha")).toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });
});

describe("LargestToolTile — no trend, deliberately", () => {
  test("even with a full history there is NO delta and NO sparkline", () => {
    // Two successful scans of one server whose largest tool CHANGED — precisely the case a trend
    // line would misrepresent as one number moving.
    const { container } = render(
      <LargestToolTile
        scans={[
          scan({
            id: "s2",
            serverId: "srv-a",
            serverName: "Alpha",
            scannedAt: "2026-01-15T00:00:00Z",
            largestToolName: "create_pull_request",
            largestToolTokens: 700,
          }),
          scan({
            id: "s1",
            serverId: "srv-a",
            serverName: "Alpha",
            scannedAt: "2026-01-01T00:00:00Z",
            largestToolName: "search_repositories",
            largestToolTokens: 500,
          }),
        ]}
      />,
    );
    expect(screen.getByText("700")).toBeInTheDocument();
    expect(container.querySelector("[data-polarity]")).toBeNull();
    expect(container.querySelector('[data-testid="sparkline"]')).toBeNull();
    expect(container.querySelector("svg[role='img']")).toBeNull();
  });
});
