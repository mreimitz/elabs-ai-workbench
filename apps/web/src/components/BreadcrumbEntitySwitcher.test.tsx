import { fireEvent, render, screen, within } from "@testing-library/react";
import { Badge } from "@elabs-ai/components-ui";
import { describe, expect, test, vi } from "vitest";
import {
  BreadcrumbEntitySwitcher,
  type BreadcrumbSwitcherGroup,
} from "./BreadcrumbEntitySwitcher";

const groups: BreadcrumbSwitcherGroup[] = [
  {
    key: "prod",
    label: "PROD",
    items: [
      { id: "a", label: "barc-benchmark", badge: <Badge>Healthy</Badge>, meta: "https://a" },
      { id: "b", label: "qlik-saas" },
    ],
  },
  { key: "untyped", label: "Untyped", items: [{ id: "c", label: "mcp-sqlite" }] },
];

function mount(overrides?: Partial<React.ComponentProps<typeof BreadcrumbEntitySwitcher>>) {
  const onSelect = vi.fn();
  const onViewAll = vi.fn();
  const onCreate = vi.fn();
  render(
    <BreadcrumbEntitySwitcher
      groups={groups}
      activeId="a"
      triggerLabel="barc-benchmark"
      switchLabel="Switch server"
      noun={["server", "servers"]}
      onSelect={onSelect}
      onViewAll={onViewAll}
      onCreate={onCreate}
      {...overrides}
    />,
  );
  return { onSelect, onViewAll, onCreate };
}

function open(): void {
  fireEvent.click(screen.getByRole("button", { name: "Switch server" }));
}

describe("BreadcrumbEntitySwitcher", () => {
  test("the trigger carries the entity name and an accessible switch label", () => {
    mount();
    const trigger = screen.getByRole("button", { name: "Switch server" });
    expect(trigger.textContent).toContain("barc-benchmark");
  });

  test("opening leads with the active entity, then the grouped list", () => {
    mount();
    open();
    const popover = screen.getByTestId("entity-switcher-popover");
    expect(within(popover).getByText("This server")).toBeTruthy();
    expect(
      within(popover)
        .getAllByRole("region")
        .map((section) => section.getAttribute("aria-label")),
    ).toEqual(["PROD", "Untyped"]);
  });

  test("searching filters rows and drops the groups it empties", () => {
    mount();
    open();
    fireEvent.change(screen.getByLabelText("Search servers"), { target: { value: "sqlite" } });
    expect(
      screen.getAllByRole("region").map((section) => section.getAttribute("aria-label")),
    ).toEqual(["Untyped"]);
  });

  test("a zero-match search names the query and offers Clear", () => {
    mount();
    open();
    fireEvent.change(screen.getByLabelText("Search servers"), { target: { value: "zzz" } });
    expect(screen.getByText(/No servers match/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Clear filter" }));
    expect(screen.getAllByRole("region")).toHaveLength(2);
  });

  test("picking a row selects it and closes the popover", () => {
    const { onSelect } = mount();
    open();
    fireEvent.click(screen.getByRole("button", { name: /qlik-saas/ }));
    expect(onSelect).toHaveBeenCalledWith("b");
    expect(screen.queryByTestId("entity-switcher-popover")).toBeNull();
  });

  test("the active row is marked aria-current", () => {
    mount();
    open();
    expect(screen.getByRole("button", { name: /barc-benchmark/ })).toHaveAttribute(
      "aria-current",
      "true",
    );
  });

  test("View all returns to the overview and closes", () => {
    const { onViewAll } = mount();
    open();
    fireEvent.click(screen.getByRole("button", { name: /View all servers/ }));
    expect(onViewAll).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("entity-switcher-popover")).toBeNull();
  });

  test("the create action is absent when no onCreate is given", () => {
    mount({ onCreate: undefined });
    open();
    expect(screen.queryByRole("button", { name: "New server" })).toBeNull();
  });

  test("loading shows loading copy, never an empty state", () => {
    mount({ loading: true, groups: [], triggerLabel: undefined, activeId: null });
    expect(screen.getByRole("button", { name: "Switch server" }).textContent).toContain(
      "Loading servers…",
    );
    open();
    expect(screen.getByText("Loading servers…", { selector: "p" })).toBeTruthy();
    expect(screen.queryByText("No servers yet.")).toBeNull();
  });

  test("a single unlabelled group renders flat, with no bare header", () => {
    mount({ groups: [{ key: "all", label: "", items: [{ id: "a", label: "only" }] }] });
    open();
    expect(screen.queryAllByRole("region")).toHaveLength(0);
    expect(screen.getByRole("button", { name: "only" })).toBeTruthy();
  });
});
