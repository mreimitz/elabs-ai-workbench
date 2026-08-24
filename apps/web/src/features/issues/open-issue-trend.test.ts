import type { RatingIssue } from "@mcp-token-footprint/shared";
import { describe, expect, test } from "vitest";
import { seriesGaps } from "../../lib/chart-series";
import { buildOpenIssueTrend, openIssueTrendRows } from "./open-issue-trend";

function issue(over: Partial<RatingIssue>): RatingIssue {
  return {
    id: "i1",
    targetKind: "mcp_server",
    targetId: "s1",
    targetName: "server",
    title: "t",
    summary: "s",
    bucket: "tool_contract",
    fixTarget: "mcp_server",
    draftFix: "",
    severity: "medium",
    status: "open",
    timesSeen: 1,
    firstSeenAt: "2026-07-01T00:00:00.000Z",
    lastSeenAt: "2026-07-01T00:00:00.000Z",
    ratingVersion: 1,
    judgeProviderId: null,
    judgeModel: null,
    occurrences: [],
    ...over,
  } as RatingIssue;
}

const TODAY = new Date("2026-07-05T12:00:00.000Z");

describe("buildOpenIssueTrend", () => {
  test("steps up on the day an issue is first seen and holds", () => {
    const rows = buildOpenIssueTrend(
      [issue({ id: "a", firstSeenAt: "2026-07-02T09:00:00.000Z" })],
      TODAY,
    );
    expect(rows.map((r) => `${r.day}=${r.open}`)).toEqual([
      "2026-07-02=1",
      "2026-07-03=1",
      "2026-07-04=1",
      "2026-07-05=1",
    ]);
  });

  test("steps down on the day an issue is resolved", () => {
    const rows = buildOpenIssueTrend(
      [
        issue({ id: "a", firstSeenAt: "2026-07-01T00:00:00.000Z" }),
        issue({
          id: "b",
          firstSeenAt: "2026-07-02T00:00:00.000Z",
          status: "resolved",
          resolvedAt: "2026-07-04T00:00:00.000Z",
        }),
      ],
      TODAY,
    );
    expect(rows.map((r) => r.open)).toEqual([1, 2, 2, 1, 1]);
  });

  test("carries the line to TODAY, not to the last event — 'still open, weeks on' is the point", () => {
    const rows = buildOpenIssueTrend(
      [issue({ id: "a", firstSeenAt: "2026-07-01T00:00:00.000Z" })],
      new Date("2026-08-01T00:00:00.000Z"),
    );
    expect(rows).toHaveLength(32);
    expect(rows[rows.length - 1]).toMatchObject({ day: "2026-08-01", open: 1 });
  });

  test("every row carries a real Date — the time-scale axis throws on anything else", () => {
    const rows = buildOpenIssueTrend([issue({ firstSeenAt: "2026-07-03T00:00:00.000Z" })], TODAY);
    for (const row of rows) {
      expect(row.x).toBeInstanceOf(Date);
      expect(Number.isNaN(row.x.getTime())).toBe(false);
    }
  });

  test("no issues, and an unparseable timestamp, both yield nothing to plot", () => {
    expect(buildOpenIssueTrend([], TODAY)).toEqual([]);
    expect(buildOpenIssueTrend([issue({ firstSeenAt: "not-a-date" })], TODAY)).toEqual([]);
  });

  test("the count never goes negative, even if a resolve predates its own first-seen", () => {
    const rows = buildOpenIssueTrend(
      [
        issue({
          id: "a",
          firstSeenAt: "2026-07-04T00:00:00.000Z",
          status: "resolved",
          resolvedAt: "2026-07-02T00:00:00.000Z",
        }),
      ],
      TODAY,
    );
    expect(rows.every((r) => r.open >= 0)).toBe(true);
  });
});

describe("openIssueTrendRows", () => {
  test("hands the chart no holes — a missing key is plotted at the TOP of the plot, not as a gap", () => {
    const rows = openIssueTrendRows(
      [
        issue({ id: "a", firstSeenAt: "2026-07-01T00:00:00.000Z" }),
        issue({ id: "b", firstSeenAt: "2026-07-03T00:00:00.000Z" }),
      ],
      TODAY,
    );
    expect(rows.length).toBeGreaterThan(1);
    expect(seriesGaps(rows, ["open"])).toEqual([]);
  });
});
