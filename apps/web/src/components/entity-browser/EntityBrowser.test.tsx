import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { EmptyState } from "@elabs-ai/components-ui";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { EntityBrowser } from "./EntityBrowser";
import { EntityCard } from "./EntityCard";
import { ViewModeToggle } from "./ViewModeToggle";
import { useEntityBrowserState } from "./use-entity-browser-state";
import { col } from "../../lib/table";
import type { EntityGroupBy } from "./types";

type Row = { id: string; name: string; type: string | null };

const items: Row[] = [
  { id: "1", name: "alpha", type: "prod" },
  { id: "2", name: "beta", type: "stage" },
  { id: "3", name: "gamma", type: null },
];

const byType: EntityGroupBy<Row> = {
  id: "type",
  label: "Type",
  fallbackLabel: "Untyped",
  groupOrder: ["prod", "stage"],
  groupOf: (row) => (row.type ? { key: row.type, label: row.type.toUpperCase() } : null),
};

function Harness(props: { items?: Row[]; loading?: boolean; onOpen?: (row: Row) => void }) {
  const state = useEntityBrowserState<Row>({ storageKey: "browser-test", groupBys: [byType] });
  return (
    <>
      <ViewModeToggle value={state.viewMode} onChange={state.setViewMode} />
      <button type="button" onClick={() => state.setSearch("alpha")}>
        search alpha
      </button>
      <button type="button" onClick={() => state.setSearch("zzz")}>
        search zzz
      </button>
      <button type="button" onClick={() => state.setGroupById("none")}>
        ungroup
      </button>
      <EntityBrowser<Row>
        state={state}
        items={props.items ?? items}
        itemKey={(row) => row.id}
        searchText={(row) => row.name}
        noun={["thing", "things"]}
        onOpen={(row) => props.onOpen?.(row)}
        rowLabel={(row) => row.name}
        columns={[col<Row>({ id: "name", header: "Name", value: (row) => row.name })]}
        renderCard={(row) => (
          <EntityCard
            title={row.name}
            href={`/things/${row.id}`}
            onOpen={() => props.onOpen?.(row)}
          />
        )}
        {...(props.loading !== undefined ? { loading: props.loading } : {})}
        empty={<EmptyState title="No things yet" description="Add one." />}
      />
    </>
  );
}

function mount(props?: { items?: Row[]; loading?: boolean; onOpen?: (row: Row) => void }) {
  return render(
    <MemoryRouter initialEntries={["/things"]}>
      <Harness {...props} />
    </MemoryRouter>,
  );
}

describe("EntityBrowser", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  test("grid mode renders one labelled section per group, fallback last", () => {
    mount();
    const sections = screen.getAllByRole("region");
    expect(sections.map((s) => s.getAttribute("aria-label"))).toEqual(["PROD", "STAGE", "Untyped"]);
    expect(within(sections[0] as HTMLElement).getByRole("link", { name: "alpha" })).toBeTruthy();
  });

  test("switching to table keeps the same groups, one table each", () => {
    mount();
    fireEvent.click(screen.getByRole("radio", { name: "Table view" }));
    const tables = screen.getAllByRole("table");
    expect(tables).toHaveLength(3);
    const sections = screen.getAllByRole("region");
    expect(sections.map((s) => s.getAttribute("aria-label"))).toEqual(["PROD", "STAGE", "Untyped"]);
  });

  test("group-by None renders ONE flat table with no group headers", () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: "ungroup" }));
    fireEvent.click(screen.getByRole("radio", { name: "Table view" }));
    expect(screen.getAllByRole("table")).toHaveLength(1);
    expect(screen.queryAllByRole("region")).toHaveLength(0);
  });

  test("search drops the groups it empties", () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: "search alpha" }));
    expect(screen.getAllByRole("region").map((s) => s.getAttribute("aria-label"))).toEqual(["PROD"]);
  });

  test("zero matches shows the query and a Clear control, not the zero-entity state", () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: "search zzz" }));
    expect(screen.getByText(/No things match/)).toBeTruthy();
    expect(screen.queryByText("No things yet")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Clear filter" }));
    expect(screen.getAllByRole("region")).toHaveLength(3);
  });

  test("zero entities shows the caller's empty state", () => {
    mount({ items: [] });
    expect(screen.getByText("No things yet")).toBeTruthy();
  });

  test("loading shows layout-shaped skeletons, never the empty state", () => {
    mount({ items: [], loading: true });
    expect(screen.getByTestId("entity-grid-skeleton")).toBeTruthy();
    expect(screen.queryByText("No things yet")).toBeNull();
  });

  test("a table row opens the same entity a card does", () => {
    const onOpen = vi.fn();
    mount({ onOpen });
    fireEvent.click(screen.getByRole("radio", { name: "Table view" }));
    fireEvent.click(screen.getByRole("button", { name: "alpha" }));
    expect(onOpen).toHaveBeenCalledWith(items[0]);
  });
});
