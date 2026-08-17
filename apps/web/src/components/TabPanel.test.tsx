import { useState } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeAll, describe, expect, test } from "vitest";
import { Button } from "@elabs-ai/components-ui";
import { TabPanel, TabPanelContent } from "./TabPanel";
import { SplitPane, SplitPanePanel } from "./SplitPane";
import { TabEmptyState } from "./TabEmptyState";

// Behaviour lock for the tab-shell contract (audit §S4/§S21/§S22). These pin the load-bearing
// invariants — the stable frame, the single scroll container per tab, the aligned split-pane
// headers, and the centred empty state — so a later refactor can't silently reintroduce the
// ~200px strip jump or the lone-card-around-a-table anti-pattern.

// `SplitPane` -> `AdaptivePanelGroup` -> `useIsMobile` reads `matchMedia`, which jsdom omits.
beforeAll(() => {
  if (typeof window.matchMedia !== "function") {
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
  }
});

// Radix tabs activate on mouseDown (primary button), not a synthetic `click`.
function activateTab(name: RegExp | string) {
  fireEvent.mouseDown(screen.getByRole("tab", { name }), { button: 0 });
}

function Harness({ initial = "overview" }: { initial?: string }) {
  const [tab, setTab] = useState(initial);
  return (
    <TabPanel
      value={tab}
      onValueChange={setTab}
      header={<div data-testid="stable-frame">Server identity + compact strip</div>}
      tabs={[
        { value: "overview", label: "Overview" },
        { value: "tools", label: "Tools", count: 5 },
        { value: "prompts", label: "Prompts", count: 0, disabled: false },
      ]}
    >
      <TabPanelContent value="overview">
        <div data-testid="overview-body">overview cards</div>
      </TabPanelContent>
      <TabPanelContent
        value="tools"
        scroll={false}
        description="Inspect a tool."
        actions={<Button>Act</Button>}
      >
        <div data-testid="tools-body">tools split</div>
      </TabPanelContent>
      <TabPanelContent value="prompts">
        <div data-testid="prompts-body">prompts</div>
      </TabPanelContent>
    </TabPanel>
  );
}

describe("TabPanel — stable frame", () => {
  test("renders every trigger, the header once, and only the active tab's body", () => {
    render(<Harness />);
    expect(screen.getByRole("tab", { name: "Overview" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Tools/ })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Prompts/ })).toBeInTheDocument();
    expect(screen.getByTestId("stable-frame")).toBeInTheDocument();
    expect(screen.getByTestId("overview-body")).toBeInTheDocument();
    expect(screen.queryByTestId("tools-body")).not.toBeInTheDocument();
  });

  test("the header (strip) lives OUTSIDE every tab panel — so switching tabs cannot move it", () => {
    render(<Harness />);
    const frame = screen.getByTestId("stable-frame");
    // No tabpanel is an ancestor of the stable frame: it is a fixed sibling above the content.
    for (const panel of screen.queryAllByRole("tabpanel")) {
      expect(panel.contains(frame)).toBe(false);
    }
  });

  test("switching tabs keeps the SAME header node mounted and swaps only the body", () => {
    render(<Harness />);
    const frameBefore = screen.getByTestId("stable-frame");
    activateTab(/Tools/);
    expect(screen.getByTestId("tools-body")).toBeInTheDocument();
    expect(screen.queryByTestId("overview-body")).not.toBeInTheDocument();
    // Identity preserved — the frame was never unmounted/remounted across the tab change.
    expect(screen.getByTestId("stable-frame")).toBe(frameBefore);
  });

  test("count suffix is rendered value-neutral (a 0 shows as a muted 0, not a state colour)", () => {
    render(<Harness />);
    const promptsTab = screen.getByRole("tab", { name: /Prompts/ });
    const zero = within(promptsTab).getByText("0");
    expect(zero).toHaveClass("text-muted-foreground");
  });
});

describe("TabPanelContent — per-tab row + one scroll container", () => {
  test("scroll=true body is the tab's single overflow container; the description row is pinned outside it", () => {
    render(
      <TabPanel value="a" onValueChange={() => {}} tabs={[{ value: "a", label: "A" }]}>
        <TabPanelContent value="a" description="one muted line" actions={<Button>New</Button>}>
          <div data-testid="body">rows</div>
        </TabPanelContent>
      </TabPanel>,
    );
    const panel = screen.getByRole("tabpanel");
    const scrollers = panel.querySelectorAll(".overflow-y-auto");
    expect(scrollers).toHaveLength(1);
    expect(scrollers[0]?.contains(screen.getByTestId("body"))).toBe(true);
    // The per-tab description + action row is a pinned sibling, NOT inside the scroll region.
    expect(scrollers[0]?.contains(screen.getByText("one muted line"))).toBe(false);
    expect(scrollers[0]?.contains(screen.getByRole("button", { name: "New" }))).toBe(false);
  });

  test("scroll=false leaves the child to own its scroll (no overflow-y-auto wrapper)", () => {
    render(
      <TabPanel value="a" onValueChange={() => {}} tabs={[{ value: "a", label: "A" }]}>
        <TabPanelContent value="a" scroll={false}>
          <div>canvas</div>
        </TabPanelContent>
      </TabPanel>,
    );
    expect(screen.getByRole("tabpanel").querySelector(".overflow-y-auto")).toBeNull();
  });
});

describe("SplitPane — aligned two-pane recipe", () => {
  test("renders both panes and a labelled resize handle (the visible divider)", () => {
    render(
      <SplitPane
        handleLabel="Resize tool list and detail"
        start={
          <SplitPanePanel title="Tool inventory" count={5}>
            <div>list</div>
          </SplitPanePanel>
        }
        end={
          <SplitPanePanel title="Tool detail">
            <div>detail</div>
          </SplitPanePanel>
        }
      />,
    );
    expect(screen.getByText("list")).toBeInTheDocument();
    expect(screen.getByText("detail")).toBeInTheDocument();
    expect(
      screen.getByRole("separator", { name: "Resize tool list and detail" }),
    ).toBeInTheDocument();
  });

  test("both panel headers use the SAME fixed height class (h-12) so they align across the divider", () => {
    const { container } = render(
      <SplitPane
        start={
          <SplitPanePanel title="Tool inventory">
            <div />
          </SplitPanePanel>
        }
        end={
          <SplitPanePanel title="Tool detail">
            <div />
          </SplitPanePanel>
        }
      />,
    );
    const headers = container.querySelectorAll(".h-12");
    expect(headers.length).toBe(2);
  });
});

describe("SplitPanePanel — header", () => {
  test("shows title + a plain count, and a filtered count as 'count / total'", () => {
    const { rerender } = render(
      <SplitPanePanel title="Tool inventory" count={5}>
        <div />
      </SplitPanePanel>,
    );
    expect(screen.getByText("Tool inventory")).toBeInTheDocument();
    expect(screen.getByText("5")).toBeInTheDocument();

    rerender(
      <SplitPanePanel title="Tool inventory" count={3} countTotal={5}>
        <div />
      </SplitPanePanel>,
    );
    expect(screen.getByText("3 / 5")).toBeInTheDocument();
  });
});

describe("TabEmptyState", () => {
  test("renders the empty state with title/description/actions inside a centring frame", () => {
    render(
      <TabEmptyState
        title="No prompts"
        description="This server exposes no MCP prompts."
        actions={<Button>Run scan</Button>}
      />,
    );
    expect(screen.getByText("No prompts")).toBeInTheDocument();
    expect(screen.getByText("This server exposes no MCP prompts.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Run scan" })).toBeInTheDocument();
  });
});
