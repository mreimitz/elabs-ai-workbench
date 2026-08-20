import { describe, expect, test } from "vitest";
import { buildEntityGroups, filterEntities } from "./group";
import type { EntityGroupBy } from "./types";

type Row = { id: string; name: string; type: string | null };

const rows: Row[] = [
  { id: "1", name: "alpha", type: "prod" },
  { id: "2", name: "beta", type: "stage" },
  { id: "3", name: "gamma", type: null },
  { id: "4", name: "delta", type: "prod" },
];

const byType: EntityGroupBy<Row> = {
  id: "type",
  label: "Type",
  fallbackLabel: "Untyped",
  groupOf: (row) => (row.type ? { key: row.type, label: row.type.toUpperCase() } : null),
};

const search = (row: Row) => row.name;

describe("buildEntityGroups", () => {
  test("groups by the dimension and puts the fallback group last", () => {
    const groups = buildEntityGroups({ items: rows, search: "", searchText: search, groupBy: byType });
    expect(groups.map((g) => g.label)).toEqual(["PROD", "STAGE", "Untyped"]);
    expect(groups[0]?.items.map((r) => r.id)).toEqual(["1", "4"]);
    expect(groups.at(-1)?.isFallback).toBe(true);
  });

  test("honours an explicit groupOrder, then sorts the rest by label", () => {
    const ordered: EntityGroupBy<Row> = { ...byType, groupOrder: ["stage"] };
    const groups = buildEntityGroups({
      items: rows,
      search: "",
      searchText: search,
      groupBy: ordered,
    });
    expect(groups.map((g) => g.label)).toEqual(["STAGE", "PROD", "Untyped"]);
  });

  test("searches BEFORE grouping, so an emptied group is dropped rather than left as a bare header", () => {
    const groups = buildEntityGroups({
      items: rows,
      search: "beta",
      searchText: search,
      groupBy: byType,
    });
    expect(groups.map((g) => g.label)).toEqual(["STAGE"]);
  });

  test("drops the fallback group when nothing lands in it", () => {
    const typed = rows.filter((row) => row.type !== null);
    const groups = buildEntityGroups({
      items: typed,
      search: "",
      searchText: search,
      groupBy: byType,
    });
    expect(groups.some((g) => g.isFallback)).toBe(false);
  });

  test("a null groupBy yields exactly one unlabelled group holding everything", () => {
    const groups = buildEntityGroups({ items: rows, search: "", searchText: search, groupBy: null });
    expect(groups).toHaveLength(1);
    expect(groups[0]?.label).toBe("");
    expect(groups[0]?.items).toHaveLength(4);
  });

  test("zero matches yields zero groups (the caller renders the zero-match state)", () => {
    const groups = buildEntityGroups({
      items: rows,
      search: "nothing-matches",
      searchText: search,
      groupBy: byType,
    });
    expect(groups).toEqual([]);
  });

  test("keeps the first-seen header for a key even when a later item carries a different label", () => {
    const drifting: EntityGroupBy<Row> = {
      ...byType,
      groupOf: (row) => (row.type ? { key: row.type, label: `${row.type}-${row.id}` } : null),
    };
    const groups = buildEntityGroups({
      items: rows,
      search: "",
      searchText: search,
      groupBy: drifting,
    });
    const prod = groups.find((g) => g.key === "prod");
    expect(prod?.label).toBe("prod-1");
    expect(prod?.items).toHaveLength(2);
  });
});

describe("filterEntities", () => {
  test("is case-insensitive and trims the query", () => {
    expect(filterEntities(rows, "  ALPHA ", search).map((r) => r.id)).toEqual(["1"]);
  });

  test("an empty query returns everything, identity-preserved", () => {
    expect(filterEntities(rows, "   ", search)).toBe(rows);
  });
});
