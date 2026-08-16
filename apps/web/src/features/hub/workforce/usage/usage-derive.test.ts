import type { HubUsageBucket, HubUsageRow } from "@mcp-token-footprint/shared";
import { describe, expect, test } from "vitest";
import {
  buildStackedTimeRows,
  rankByCost,
  seriesKeyFor,
  sharePercent,
  sumUsageRows,
  topAttributedRows,
} from "./usage-derive";

function row(over: Partial<HubUsageRow> = {}): HubUsageRow {
  return {
    groupBy: "agent",
    key: "role_1",
    label: "Researcher",
    sessions: 1,
    costUsd: 1,
    tokensIn: 100,
    tokensOut: 50,
    ...over,
  };
}

describe("usage-derive — sumUsageRows (WP2.6 acceptance: numbers match 1.6's reconciliation)", () => {
  test("sums every row including the unattributed bucket — never a silently short total", () => {
    const rows: HubUsageRow[] = [
      row({ key: "a", label: "Alpha", sessions: 3, costUsd: 9, tokensIn: 100, tokensOut: 50 }),
      row({ key: "b", label: "Beta", sessions: 2, costUsd: 4, tokensIn: 40, tokensOut: 20 }),
      row({
        key: null,
        label: "No agent",
        unattributed: true,
        sessions: 1,
        costUsd: 1,
        tokensIn: 5,
        tokensOut: 2,
      }),
    ];
    expect(sumUsageRows(rows)).toEqual({ sessions: 6, costUsd: 14, tokensIn: 145, tokensOut: 72 });
  });

  test("sums to zero over an empty rollup", () => {
    expect(sumUsageRows([])).toEqual({ sessions: 0, costUsd: 0, tokensIn: 0, tokensOut: 0 });
  });
});

describe("usage-derive — rankByCost", () => {
  test("sorts descending by cost and NEVER drops the unattributed row", () => {
    const rows: HubUsageRow[] = [
      row({ key: "a", label: "Alpha", costUsd: 2 }),
      row({ key: null, label: "No agent", unattributed: true, costUsd: 10 }),
      row({ key: "b", label: "Beta", costUsd: 5 }),
    ];
    const ranked = rankByCost(rows);
    expect(ranked.map((r) => r.label)).toEqual(["No agent", "Beta", "Alpha"]);
    // The unattributed row ranks wherever its cost puts it — here, first — never filtered out.
    expect(ranked.some((r) => r.unattributed)).toBe(true);
  });
});

describe("usage-derive — topAttributedRows (feeds /api/hub/usage/summary, which needs a real id)", () => {
  test("excludes the unattributed row (key: null) — it has no id to fetch a strip for", () => {
    const rows: HubUsageRow[] = [
      row({ key: "a", label: "Alpha", costUsd: 10 }),
      row({ key: null, label: "No agent", unattributed: true, costUsd: 99 }),
      row({ key: "b", label: "Beta", costUsd: 5 }),
    ];
    const top = topAttributedRows(rows, 5);
    expect(top.map((r) => r.key)).toEqual(["a", "b"]);
  });

  test("caps at max, still ranked by cost", () => {
    const rows: HubUsageRow[] = [
      row({ key: "a", costUsd: 1 }),
      row({ key: "b", costUsd: 3 }),
      row({ key: "c", costUsd: 2 }),
    ];
    expect(topAttributedRows(rows, 2).map((r) => r.key)).toEqual(["b", "c"]);
  });
});

describe("usage-derive — buildStackedTimeRows (ComposedChart x MUST be a real Date, xDataKey='x')", () => {
  function bucket(key: string, costUsd: number): HubUsageBucket {
    return { key, label: key, sessions: 1, costUsd, tokensIn: 0, tokensOut: 0 };
  }

  test("builds one row per day with a real Date x and one field per series (index-aligned strips)", () => {
    const entries = [
      {
        row: row({ key: "a", label: "Alpha" }),
        strip: [bucket("2026-06-01", 3), bucket("2026-06-02", 4)],
      },
      {
        row: row({ key: "b", label: "Beta" }),
        strip: [bucket("2026-06-01", 1), bucket("2026-06-02", 2)],
      },
    ];
    const rows = buildStackedTimeRows(entries);
    expect(rows).toHaveLength(2);
    for (const r of rows) {
      expect(r.x).toBeInstanceOf(Date);
      expect(Number.isNaN((r.x as Date).getTime())).toBe(false);
    }
    expect(rows[0]).toMatchObject({ a: 3, b: 1 });
    expect(rows[1]).toMatchObject({ a: 4, b: 2 });
  });

  test("empty entries yields an empty chart dataset (no fabricated rows)", () => {
    expect(buildStackedTimeRows([])).toEqual([]);
  });

  test("seriesKeyFor uses the row key, falling back to 'unattributed' for key:null", () => {
    expect(seriesKeyFor({ key: "role_1" })).toBe("role_1");
    expect(seriesKeyFor({ key: null })).toBe("unattributed");
  });
});

describe("usage-derive — sharePercent", () => {
  test("computes a rounded percentage of the total", () => {
    expect(sharePercent(25, 100)).toBe(25);
    expect(sharePercent(1, 3)).toBe(33.3);
  });

  test("is 0 (never NaN/Infinity) when the total is 0", () => {
    expect(sharePercent(5, 0)).toBe(0);
    expect(sharePercent(0, 0)).toBe(0);
  });
});
