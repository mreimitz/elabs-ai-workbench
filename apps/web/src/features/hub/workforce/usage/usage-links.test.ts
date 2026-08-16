import type { HubUsageRow } from "@mcp-token-footprint/shared";
import { describe, expect, test } from "vitest";
import { drillDestinationFor, sessionsHrefForFilter } from "./usage-links";

function row(over: Partial<HubUsageRow> = {}): HubUsageRow {
  return {
    groupBy: "agent",
    key: "id_1",
    label: "Row",
    sessions: 1,
    costUsd: 1,
    tokensIn: 0,
    tokensOut: 0,
    ...over,
  };
}

describe("usage-links — drillDestinationFor (WP2.6 acceptance: drill path total → entity → sessions works)", () => {
  test("a project row narrows in-tab (the only dimension /rollup can filter by)", () => {
    const dest = drillDestinationFor(row({ groupBy: "project", key: "proj_1" }));
    expect(dest).toEqual({ kind: "narrow", projectId: "proj_1" });
  });

  test("an agent row opens the entity's own profile Usage sub-page, staying on the Usage tab", () => {
    const dest = drillDestinationFor(row({ groupBy: "agent", key: "role_1" }));
    expect(dest.kind).toBe("profile");
    expect(dest).toMatchObject({ href: "/assistant/agents/agent/role_1?tab=usage&settings=usage" });
  });

  test("a crew row opens the crew's own profile Usage sub-page", () => {
    const dest = drillDestinationFor(row({ groupBy: "crew", key: "crew_1" }));
    expect(dest).toMatchObject({
      kind: "profile",
      href: "/assistant/agents/crew/crew_1?tab=usage&settings=usage",
    });
  });

  test("a model row links to Sessions filtered by model", () => {
    const dest = drillDestinationFor(row({ groupBy: "model", key: "claude-sonnet-5" }));
    expect(dest).toEqual({
      kind: "sessions",
      href: "/assistant/sessions?model=claude-sonnet-5",
      filtered: true,
    });
  });

  test("a mode row links to Sessions filtered by mode", () => {
    const dest = drillDestinationFor(row({ groupBy: "mode", key: "research" }));
    expect(dest).toEqual({
      kind: "sessions",
      href: "/assistant/sessions?mode=research",
      filtered: true,
    });
  });

  test("the unattributed bucket (key: null) links to Sessions UNFILTERED, honestly labeled", () => {
    const dest = drillDestinationFor(
      row({ groupBy: "crew", key: null, unattributed: true, label: "No crew" }),
    );
    expect(dest).toEqual({ kind: "sessions", href: "/assistant/sessions", filtered: false });
  });

  test("every HubUsageGroupBy dimension is handled (exhaustiveness)", () => {
    const groupBys: HubUsageRow["groupBy"][] = ["agent", "crew", "model", "project", "mode"];
    for (const groupBy of groupBys) {
      expect(() => drillDestinationFor(row({ groupBy, key: "x" }))).not.toThrow();
    }
  });
});

describe("usage-links — sessionsHrefForFilter", () => {
  test("no project narrow → the plain Sessions route", () => {
    expect(sessionsHrefForFilter({})).toBe("/assistant/sessions");
  });

  test("a project narrow carries projectId", () => {
    expect(sessionsHrefForFilter({ projectId: "proj_1" })).toBe(
      "/assistant/sessions?projectId=proj_1",
    );
  });
});
