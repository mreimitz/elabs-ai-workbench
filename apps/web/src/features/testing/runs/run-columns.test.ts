import { describe, expect, test } from "vitest";
import {
  ALL_RUN_TABLE_COLUMNS,
  DEFAULT_RUN_COLUMNS_PREFERENCE,
  RUN_TABLE_COLUMN_LABELS,
  RUN_TABLE_COLUMNS,
  SESSION_COLUMNS_PREFERENCE,
  SESSION_ONLY_COLUMNS,
  SESSION_TABLE_COLUMNS,
  normalizeColumnsPreference,
  runTableColumnCount,
  toVisibleColumnSet,
} from "./run-columns";

describe("normalizeColumnsPreference", () => {
  test("null/non-object falls back to the default preference", () => {
    expect(normalizeColumnsPreference(null)).toEqual(DEFAULT_RUN_COLUMNS_PREFERENCE);
    expect(normalizeColumnsPreference("not an object")).toEqual(DEFAULT_RUN_COLUMNS_PREFERENCE);
    expect(normalizeColumnsPreference(42)).toEqual(DEFAULT_RUN_COLUMNS_PREFERENCE);
  });

  test("round-trips a valid preference", () => {
    const pref = { visible: ["status", "cost"], previewMode: "snippet" };
    expect(normalizeColumnsPreference(pref)).toEqual({
      visible: ["status", "cost"],
      previewMode: "snippet",
    });
  });

  test("drops an unknown column key and de-duplicates", () => {
    const pref = { visible: ["status", "bogus", "status", "cost"], previewMode: "none" };
    expect(normalizeColumnsPreference(pref).visible).toEqual(["status", "cost"]);
  });

  test("an unknown previewMode falls back to the default ('none')", () => {
    const pref = { visible: ["status"], previewMode: "bogus" };
    expect(normalizeColumnsPreference(pref).previewMode).toBe("none");
  });

  test("a missing `visible` array falls back to the default visible set", () => {
    const pref = { previewMode: "cost" };
    expect(normalizeColumnsPreference(pref).visible).toEqual(DEFAULT_RUN_COLUMNS_PREFERENCE.visible);
  });
});

describe("runTableColumnCount", () => {
  test("Name + Actions + every optional column, no Grade", () => {
    expect(runTableColumnCount(false, RUN_TABLE_COLUMNS)).toBe(2 + RUN_TABLE_COLUMNS.length);
  });

  test("adds one column for Grade", () => {
    expect(runTableColumnCount(true, RUN_TABLE_COLUMNS)).toBe(2 + RUN_TABLE_COLUMNS.length + 1);
  });

  test("shrinks with fewer visible columns", () => {
    expect(runTableColumnCount(false, ["status", "cost"])).toBe(4);
  });
});

describe("toVisibleColumnSet", () => {
  test("builds a Set with the expected membership", () => {
    const set = toVisibleColumnSet(["status", "cost"]);
    expect(set.has("status")).toBe(true);
    expect(set.has("cost")).toBe(true);
    expect(set.has("turns")).toBe(false);
    expect(set.size).toBe(2);
  });
});

/**
 * Sessions lens (Observability WP 2.4) — the additive session-only column vocabulary stays SEPARATE
 * from the general {@link RUN_TABLE_COLUMNS} (so the general table's default shape, and the suite
 * console's Runs tab, are byte-unchanged) but is still a recognized/round-trippable column key.
 */
describe("Sessions lens columns (WP 2.4)", () => {
  test("the general RUN_TABLE_COLUMNS is unchanged by the session-only addition", () => {
    // RM-33 added `cacheHitRate` to this general vocabulary (hidden by default, like `tokens`), so
    // the base set is 10. It is deliberately NOT in the session-only vocabulary: a run's cache
    // composition is a property of any run, not of a session-shaped one.
    expect(RUN_TABLE_COLUMNS).toEqual([
      "type",
      "environment",
      "status",
      "turns",
      "tools",
      "tokens",
      "cacheHitRate",
      "cost",
      "started",
      "duration",
    ]);
  });

  test("RM-33 — `cacheHitRate` is toggleable but NOT default-visible", () => {
    // It answers a specific question ("which runs re-pay for context they already sent?"), so it
    // earns a place in the chooser, not a place in every operator's default triage row.
    expect(RUN_TABLE_COLUMNS).toContain("cacheHitRate");
    expect(DEFAULT_RUN_COLUMNS_PREFERENCE.visible).not.toContain("cacheHitRate");
    expect(RUN_TABLE_COLUMN_LABELS.cacheHitRate).toBe("Cache hit");
  });

  test("DEFAULT_RUN_COLUMNS_PREFERENCE leads with the triage set (design-remediation T8) and holds NO session-only column", () => {
    // T8 (Persona "Alex") — the default no longer floods the table with every optional column
    // (which pushed Cost/Grade/Started/Duration off the right edge behind Type + Tools). It now
    // leads with the triage set: Status · Cost · Started · Duration (Name + Actions are pinned;
    // Grade auto-shows via `shouldShowGradeColumn`). The dropped columns stay toggleable.
    expect(DEFAULT_RUN_COLUMNS_PREFERENCE.visible).toEqual(["status", "cost", "started", "duration"]);
    // Every default-visible key is still a member of the toggleable base column set…
    for (const key of DEFAULT_RUN_COLUMNS_PREFERENCE.visible) {
      expect(RUN_TABLE_COLUMNS).toContain(key);
    }
    // …and Type + Tools are deliberately NOT default-on (still available via the column chooser).
    expect(DEFAULT_RUN_COLUMNS_PREFERENCE.visible).not.toContain("type");
    expect(DEFAULT_RUN_COLUMNS_PREFERENCE.visible).not.toContain("tools");
    // Session-only columns remain preset-managed, never default-on.
    for (const key of SESSION_ONLY_COLUMNS) {
      expect(DEFAULT_RUN_COLUMNS_PREFERENCE.visible).not.toContain(key);
    }
  });

  test("ALL_RUN_TABLE_COLUMNS is the union of base + session-only, with no duplicates", () => {
    expect(ALL_RUN_TABLE_COLUMNS).toHaveLength(RUN_TABLE_COLUMNS.length + SESSION_ONLY_COLUMNS.length);
    expect(new Set(ALL_RUN_TABLE_COLUMNS).size).toBe(ALL_RUN_TABLE_COLUMNS.length);
  });

  test("SESSION_COLUMNS_PREFERENCE carries exactly the SESSION_TABLE_COLUMNS set, no preview row", () => {
    expect(SESSION_COLUMNS_PREFERENCE).toEqual({ visible: SESSION_TABLE_COLUMNS, previewMode: "none" });
  });

  test("normalizeColumnsPreference recognizes session-only keys (round-trips a saved Sessions view)", () => {
    const raw = { visible: ["environment", "kind", "waiting", "bogus"], previewMode: "none" };
    expect(normalizeColumnsPreference(raw).visible).toEqual(["environment", "kind", "waiting"]);
  });

  test("runTableColumnCount + toVisibleColumnSet work identically over the session column set", () => {
    expect(runTableColumnCount(false, SESSION_TABLE_COLUMNS)).toBe(2 + SESSION_TABLE_COLUMNS.length);
    const set = toVisibleColumnSet(SESSION_TABLE_COLUMNS);
    expect(set.has("kind")).toBe(true);
    expect(set.has("tools")).toBe(false);
  });
});
