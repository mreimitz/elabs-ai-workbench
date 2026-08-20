import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, test } from "vitest";
import { useEntityBrowserState } from "./use-entity-browser-state";
import type { EntityGroupBy } from "./types";

type Row = { id: string };

const byType: EntityGroupBy<Row> = {
  id: "type",
  label: "Type",
  fallbackLabel: "Untyped",
  groupOf: () => ({ key: "k", label: "K" }),
};
const bySource: EntityGroupBy<Row> = {
  id: "source",
  label: "Source",
  fallbackLabel: "Other",
  groupOf: () => ({ key: "s", label: "S" }),
};

function Harness(props: { groupBys: EntityGroupBy<Row>[]; defaultGroupById?: string }) {
  const state = useEntityBrowserState<Row>({
    storageKey: "test",
    groupBys: props.groupBys,
    ...(props.defaultGroupById !== undefined ? { defaultGroupById: props.defaultGroupById } : {}),
  });
  const location = useLocation();
  return (
    <div>
      <span data-testid="mode">{state.viewMode}</span>
      <span data-testid="group">{state.groupById}</span>
      <span data-testid="group-resolved">{state.groupBy?.id ?? "null"}</span>
      <span data-testid="options">{state.groupByOptions.map((o) => o.id).join(",")}</span>
      <span data-testid="search">{state.search}</span>
      <span data-testid="url">{location.search}</span>
      <button type="button" onClick={() => state.setViewMode("table")}>
        table
      </button>
      <button type="button" onClick={() => state.setViewMode("grid")}>
        grid
      </button>
      <button type="button" onClick={() => state.setGroupById("none")}>
        ungroup
      </button>
      <button type="button" onClick={() => state.setSearch("q")}>
        search
      </button>
    </div>
  );
}

function mount(options?: { url?: string; groupBys?: EntityGroupBy<Row>[]; defaultGroupById?: string }) {
  return render(
    <MemoryRouter initialEntries={[options?.url ?? "/things"]}>
      <Harness
        groupBys={options?.groupBys ?? [byType, bySource]}
        {...(options?.defaultGroupById !== undefined
          ? { defaultGroupById: options.defaultGroupById }
          : {})}
      />
    </MemoryRouter>,
  );
}

describe("useEntityBrowserState", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  test("defaults to the grid and the first grouping", () => {
    mount();
    expect(screen.getByTestId("mode").textContent).toBe("grid");
    expect(screen.getByTestId("group").textContent).toBe("type");
  });

  test("a ?view= param wins over the stored preference", () => {
    window.localStorage.setItem("mcp-token-footprint.entity-browser.test.view", "grid");
    mount({ url: "/things?view=table" });
    expect(screen.getByTestId("mode").textContent).toBe("table");
  });

  test("an unrecognised ?view= value is ignored, not an error", () => {
    mount({ url: "/things?view=nonsense" });
    expect(screen.getByTestId("mode").textContent).toBe("grid");
  });

  test("the stored preference wins over the default when no param is present", () => {
    window.localStorage.setItem("mcp-token-footprint.entity-browser.test.view", "table");
    mount();
    expect(screen.getByTestId("mode").textContent).toBe("table");
  });

  test("selecting a mode writes BOTH the URL and the stored preference", () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: "table" }));
    expect(screen.getByTestId("mode").textContent).toBe("table");
    expect(screen.getByTestId("url").textContent).toContain("view=table");
    expect(window.localStorage.getItem("mcp-token-footprint.entity-browser.test.view")).toBe("table");
  });

  test("the group-by choice persists and offers a None sentinel", () => {
    mount();
    expect(screen.getByTestId("options").textContent).toBe("type,source,none");
    fireEvent.click(screen.getByRole("button", { name: "ungroup" }));
    expect(screen.getByTestId("group-resolved").textContent).toBe("null");
    expect(window.localStorage.getItem("mcp-token-footprint.entity-browser.test.group-by")).toBe(
      "none",
    );
  });

  test("a stored grouping that no longer exists falls back instead of grouping by nothing", () => {
    window.localStorage.setItem("mcp-token-footprint.entity-browser.test.group-by", "retired");
    mount({ groupBys: [bySource] });
    expect(screen.getByTestId("group").textContent).toBe("source");
  });

  test("no grouping dimensions means no picker at all", () => {
    mount({ groupBys: [] });
    expect(screen.getByTestId("options").textContent).toBe("");
    expect(screen.getByTestId("group-resolved").textContent).toBe("null");
  });

  test("search is plain local state", () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: "search" }));
    expect(screen.getByTestId("search").textContent).toBe("q");
  });
});
