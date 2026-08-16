import { describe, expect, test } from "vitest";
import {
  emptySessionsFilter,
  parseSessionsFilter,
  serializeSessionsFilter,
  type SessionsFilterState,
} from "./sessions-url-state";

const params = (query: string) => new URLSearchParams(query);

describe("sessions-url-state — parse", () => {
  test("an empty URL parses to the empty filter", () => {
    expect(parseSessionsFilter(params(""))).toEqual(emptySessionsFilter());
  });

  test("reads status / mode / projectId facets (comma-separated)", () => {
    const filter = parseSessionsFilter(params("status=running,completed&mode=research&projectId=p1"));
    expect(filter.status).toEqual(["running", "completed"]);
    expect(filter.mode).toEqual(["research"]);
    expect(filter.project).toEqual(["p1"]);
  });

  test("drops unknown status / mode values (never a bogus facet chip)", () => {
    const filter = parseSessionsFilter(params("status=running,made-up&mode=chat,nonsense"));
    expect(filter.status).toEqual(["running"]);
    expect(filter.mode).toEqual(["chat"]);
  });

  test("the `model` drill-link value seeds search when `q` is absent; `q` wins when both are set", () => {
    expect(parseSessionsFilter(params("model=claude-sonnet-5")).search).toBe("claude-sonnet-5");
    expect(parseSessionsFilter(params("q=hello&model=claude-sonnet-5")).search).toBe("hello");
  });

  test("parses a from/to date-only range into local Dates", () => {
    const { dateRange } = parseSessionsFilter(params("from=2026-07-01&to=2026-07-10"));
    expect(dateRange?.from?.getFullYear()).toBe(2026);
    expect(dateRange?.from?.getMonth()).toBe(6); // July (0-indexed)
    expect(dateRange?.from?.getDate()).toBe(1);
    expect(dateRange?.to?.getDate()).toBe(10);
  });

  test("a malformed date is ignored (no range), never a crash", () => {
    expect(parseSessionsFilter(params("from=not-a-date")).dateRange).toBeUndefined();
  });
});

describe("sessions-url-state — serialize", () => {
  test("empty state clears our keys but preserves unrelated ones", () => {
    const out = serializeSessionsFilter(params("status=running&other=keep"), emptySessionsFilter());
    expect(out.get("status")).toBeNull();
    expect(out.get("other")).toBe("keep");
  });

  test("writes each field and always drops the `model` input alias (normalised to q)", () => {
    const state: SessionsFilterState = {
      search: "hello",
      status: ["running", "completed"],
      mode: ["mission"],
      project: ["p1", "__none__"],
      dateRange: { from: new Date(2026, 6, 1), to: new Date(2026, 6, 10) },
    };
    const out = serializeSessionsFilter(params("model=claude-sonnet-5"), state);
    expect(out.get("model")).toBeNull();
    expect(out.get("q")).toBe("hello");
    expect(out.get("status")).toBe("running,completed");
    expect(out.get("mode")).toBe("mission");
    expect(out.get("projectId")).toBe("p1,__none__");
    expect(out.get("from")).toBe("2026-07-01");
    expect(out.get("to")).toBe("2026-07-10");
  });

  test("does not mutate the input params", () => {
    const input = params("status=running");
    serializeSessionsFilter(input, emptySessionsFilter());
    expect(input.get("status")).toBe("running");
  });
});

describe("sessions-url-state — round-trip", () => {
  test("parse(serialize(state)) reproduces the facet selections", () => {
    const state: SessionsFilterState = {
      search: "widget",
      status: ["running"],
      mode: ["research", "mission"],
      project: ["p1"],
      dateRange: undefined,
    };
    const round = parseSessionsFilter(serializeSessionsFilter(params(""), state));
    expect(round.search).toBe("widget");
    expect(round.status).toEqual(["running"]);
    expect(round.mode).toEqual(["research", "mission"]);
    expect(round.project).toEqual(["p1"]);
  });
});
