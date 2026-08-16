import { describe, expect, test } from "vitest";
import {
  ALL_FLEET_FIXTURES,
  NON_FLEET_ISSUE,
  OPEN_FLEET_ISSUE,
  REGRESSED_FLEET_ISSUE,
  SPARSE_RESOLVED_FLEET_ISSUE,
} from "./issue-fixtures";
import {
  buildIssueRunFilter,
  distinctAffectedEntityIds,
  filterFleetIssues,
  isFleetIssue,
  issueAiAssisted,
  matchesIssueQuery,
  sortFleetIssues,
  sparklineValues,
} from "./issue-lib";

describe("isFleetIssue", () => {
  test("admits an issue carrying a fleet block", () => {
    expect(isFleetIssue(OPEN_FLEET_ISSUE)).toBe(true);
  });

  test("excludes a plain per-run auto-rating issue (fleet undefined)", () => {
    expect(isFleetIssue(NON_FLEET_ISSUE)).toBe(false);
  });
});

describe("sortFleetIssues", () => {
  test("regressed sorts first, then open, then resolved; ties break by occurrence count desc", () => {
    const shuffled = [SPARSE_RESOLVED_FLEET_ISSUE, OPEN_FLEET_ISSUE, REGRESSED_FLEET_ISSUE];
    const sorted = sortFleetIssues(shuffled);
    expect(sorted.map((i) => i.id)).toEqual([
      REGRESSED_FLEET_ISSUE.id,
      OPEN_FLEET_ISSUE.id,
      SPARSE_RESOLVED_FLEET_ISSUE.id,
    ]);
  });

  test("does not mutate the input array", () => {
    const input = [SPARSE_RESOLVED_FLEET_ISSUE, REGRESSED_FLEET_ISSUE];
    const copy = [...input];
    sortFleetIssues(input);
    expect(input).toEqual(copy);
  });
});

describe("filterFleetIssues", () => {
  test("empty filters impose no constraint", () => {
    expect(filterFleetIssues(ALL_FLEET_FIXTURES, { lifecycle: [], entity: [] })).toHaveLength(3);
  });

  test("narrows by lifecycle", () => {
    const result = filterFleetIssues(ALL_FLEET_FIXTURES, { lifecycle: ["regressed"], entity: [] });
    expect(result.map((i) => i.id)).toEqual([REGRESSED_FLEET_ISSUE.id]);
  });

  test("narrows by entity (server or skill id in fleet.affected)", () => {
    const result = filterFleetIssues(ALL_FLEET_FIXTURES, { lifecycle: [], entity: ["skill-1"] });
    expect(result.map((i) => i.id)).toEqual([REGRESSED_FLEET_ISSUE.id]);
  });

  test("narrows by lastSeenAt window", () => {
    const result = filterFleetIssues(ALL_FLEET_FIXTURES, {
      lifecycle: [],
      entity: [],
      lastSeenFrom: "2026-07-10T00:00:00.000Z",
      lastSeenTo: "2026-07-12T00:00:00.000Z",
    });
    expect(result.map((i) => i.id)).toEqual([OPEN_FLEET_ISSUE.id]);
  });

  test("combines filters with AND", () => {
    const result = filterFleetIssues(ALL_FLEET_FIXTURES, {
      lifecycle: ["regressed"],
      entity: ["srv-1"], // REGRESSED_FLEET_ISSUE only affects skill-1, not srv-1
    });
    expect(result).toHaveLength(0);
  });
});

describe("matchesIssueQuery", () => {
  test("empty query matches everything", () => {
    expect(matchesIssueQuery(OPEN_FLEET_ISSUE, "")).toBe(true);
  });

  test("matches title case-insensitively", () => {
    expect(matchesIssueQuery(OPEN_FLEET_ISSUE, "RUN_QUERY")).toBe(true);
  });

  test("matches summary", () => {
    expect(matchesIssueQuery(OPEN_FLEET_ISSUE, "schema-validation")).toBe(true);
  });

  test("no match returns false", () => {
    expect(matchesIssueQuery(OPEN_FLEET_ISSUE, "nonexistent-xyz")).toBe(false);
  });
});

describe("issueAiAssisted", () => {
  test("reads true when the wire carries aiAssisted:true", () => {
    const flagged = { ...OPEN_FLEET_ISSUE, aiAssisted: true } as typeof OPEN_FLEET_ISSUE;
    expect(issueAiAssisted(flagged)).toBe(true);
  });

  test("defaults to false when the field is absent (pre-WP5.2 payload)", () => {
    expect(issueAiAssisted(OPEN_FLEET_ISSUE)).toBe(false);
  });

  test("defaults to false when the field is explicitly false", () => {
    const explicit = { ...OPEN_FLEET_ISSUE, aiAssisted: false } as typeof OPEN_FLEET_ISSUE;
    expect(issueAiAssisted(explicit)).toBe(false);
  });
});

describe("buildIssueRunFilter", () => {
  test("carries the exact affected dimensions + observed window", () => {
    expect(buildIssueRunFilter(OPEN_FLEET_ISSUE)).toEqual({
      dateFrom: "2026-07-01T09:00:00.000Z",
      dateTo: "2026-07-10T09:00:00.000Z",
      serverId: ["srv-1"],
      testId: ["test-1"],
      model: ["claude-opus-4"],
    });
  });

  test("uses skillId for a skill-targeted issue and omits empty dimensions", () => {
    expect(buildIssueRunFilter(REGRESSED_FLEET_ISSUE)).toEqual({
      dateFrom: "2026-06-01T09:00:00.000Z",
      dateTo: "2026-07-15T09:00:00.000Z",
      skillId: ["skill-1"],
      testId: ["test-2"],
      model: ["claude-sonnet-4"],
    });
  });
});

describe("distinctAffectedEntityIds", () => {
  test("dedupes across servers and skills", () => {
    const ids = distinctAffectedEntityIds(ALL_FLEET_FIXTURES);
    expect(ids.sort()).toEqual(["skill-1", "srv-1", "srv-2"]);
  });
});

describe("sparklineValues", () => {
  test("returns the unpadded day counts oldest-first", () => {
    expect(sparklineValues(OPEN_FLEET_ISSUE)).toEqual([1, 1]);
  });

  test("a sparse single-point trend stays a single point (never zero-padded)", () => {
    expect(sparklineValues(SPARSE_RESOLVED_FLEET_ISSUE)).toEqual([1]);
  });
});
