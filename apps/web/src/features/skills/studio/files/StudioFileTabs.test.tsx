import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { TooltipProvider } from "@elabs-ai/components-ui";
import { StudioFileTabs, studioTabDomId, studioTabPanelDomId } from "./StudioFileTabs";
import { SKILL_MD } from "./file-ops";
import type { WorkEntry } from "../../workspace/workspace-model";

// ── The file strip's OWN contract (owner decision 2026-08-22) ─────────────────────────────────────
// The strip used to be Radix `Tabs`, which gave it roving tabindex / arrow keys / Home-End for free
// but made a per-tab × impossible (a button inside a button). Replacing Radix with a hand-composed
// strip means this file now owns that keyboard contract, so it is pinned here rather than assumed.
//
// NOT covered, and it cannot be from jsdom: the tooltip on each × never OPENS (jsdom has no layout,
// so Radix's positioning/pointer machinery does not run) and nothing here is a visual check — the
// underline, the ×'s always-visible-ness and the two themes are eyes-only.

const entryFor = (path: string, over: Partial<WorkEntry> = {}): WorkEntry => ({
  id: path,
  path,
  originalPath: path,
  isBinary: false,
  ...over,
});

const TABS = [
  { path: "references/api.md", entry: entryFor("references/api.md") },
  { path: "scripts/run.py", entry: entryFor("scripts/run.py") },
];

function renderTabs(over: Partial<Parameters<typeof StudioFileTabs>[0]> = {}) {
  const onSelect = vi.fn();
  const onClose = vi.fn();
  const view = render(
    <TooltipProvider>
      <StudioFileTabs
        tabs={TABS}
        active={SKILL_MD}
        onSelect={onSelect}
        onClose={onClose}
        manifestDirty={false}
        {...over}
      />
    </TooltipProvider>,
  );
  return { onSelect, onClose, ...view };
}

const strip = () => screen.getByRole("tablist", { name: "Open files" });
const tabNames = () =>
  within(strip())
    .getAllByRole("tab")
    .map((tab) => tab.getAttribute("id"));

describe("the Studio file strip — ARIA wiring", () => {
  test("one tablist, one tab per open file, SKILL.md pinned first", () => {
    renderTabs();
    expect(tabNames()).toEqual([
      studioTabDomId(SKILL_MD),
      studioTabDomId("references/api.md"),
      studioTabDomId("scripts/run.py"),
    ]);
  });

  test("exactly one tab is aria-selected, and it points at ITS panel", () => {
    renderTabs({ active: "references/api.md" });
    const tabs = within(strip()).getAllByRole("tab");
    const selected = tabs.filter((tab) => tab.getAttribute("aria-selected") === "true");
    expect(selected).toHaveLength(1);
    expect(selected[0]).toHaveAttribute("id", studioTabDomId("references/api.md"));
    expect(selected[0]).toHaveAttribute(
      "aria-controls",
      studioTabPanelDomId("references/api.md"),
    );
    // Every tab names a DISTINCT panel — a shared id would make the whole strip point at one pane.
    const controls = tabs.map((tab) => tab.getAttribute("aria-controls"));
    expect(new Set(controls).size).toBe(controls.length);
  });
});

describe("the Studio file strip — roving tabindex", () => {
  test("only the ACTIVE tab is in the page tab order", () => {
    renderTabs({ active: "scripts/run.py" });
    const tabs = within(strip()).getAllByRole("tab");
    expect(tabs.map((tab) => tab.getAttribute("tabindex"))).toEqual(["-1", "-1", "0"]);
  });

  test("the strip is TWO tab stops however many files are open — the active tab and its ×", () => {
    renderTabs({ active: "references/api.md" });
    const controls = [
      ...within(strip()).getAllByRole("tab"),
      ...within(strip()).getAllByRole("button", { name: /^Close/ }),
    ];
    expect(controls).toHaveLength(5); // 3 tabs + 2 closes
    const reachable = controls.filter((node) => node.getAttribute("tabindex") !== "-1");
    expect(
      reachable.map((node) => node.getAttribute("id") ?? node.getAttribute("aria-label")),
    ).toEqual([studioTabDomId("references/api.md"), "Close api.md"]);
  });
});

describe("the Studio file strip — keyboard movement", () => {
  test("ArrowRight / ArrowLeft move and activate, wrapping at both ends", () => {
    const { onSelect } = renderTabs({ active: SKILL_MD });
    const [manifest, api, run] = within(strip()).getAllByRole("tab");

    fireEvent.keyDown(manifest as HTMLElement, { key: "ArrowRight" });
    expect(onSelect).toHaveBeenLastCalledWith("references/api.md");
    expect(document.activeElement).toBe(api);

    fireEvent.keyDown(manifest as HTMLElement, { key: "ArrowLeft" });
    expect(onSelect).toHaveBeenLastCalledWith("scripts/run.py"); // wraps to the last tab
    expect(document.activeElement).toBe(run);

    fireEvent.keyDown(run as HTMLElement, { key: "ArrowRight" });
    expect(onSelect).toHaveBeenLastCalledWith(SKILL_MD); // …and forward off the end, back to first
    expect(document.activeElement).toBe(manifest);
  });

  test("Home / End jump to the ends", () => {
    const { onSelect } = renderTabs({ active: "references/api.md" });
    const api = within(strip()).getAllByRole("tab")[1] as HTMLElement;

    fireEvent.keyDown(api, { key: "End" });
    expect(onSelect).toHaveBeenLastCalledWith("scripts/run.py");

    fireEvent.keyDown(api, { key: "Home" });
    expect(onSelect).toHaveBeenLastCalledWith(SKILL_MD);
  });

  test("a key the strip does not own is left alone", () => {
    const { onSelect, onClose } = renderTabs();
    const manifest = within(strip()).getAllByRole("tab")[0] as HTMLElement;
    fireEvent.keyDown(manifest, { key: "ArrowDown" });
    expect(onSelect).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("the Studio file strip — closing", () => {
  test("EVERY file tab carries its own ×, acting on THAT tab, not the active one", () => {
    const { onClose } = renderTabs({ active: SKILL_MD });
    // The background tab's × closes the background tab — the whole point of the change.
    fireEvent.click(within(strip()).getByRole("button", { name: "Close run.py" }));
    expect(onClose).toHaveBeenCalledWith("scripts/run.py");

    fireEvent.click(within(strip()).getByRole("button", { name: "Close api.md" }));
    expect(onClose).toHaveBeenLastCalledWith("references/api.md");
  });

  test("SKILL.md has NO × at all, and Delete on it is inert", () => {
    const { onClose } = renderTabs({ active: SKILL_MD });
    expect(within(strip()).queryByRole("button", { name: /Close SKILL\.md/ })).toBeNull();
    expect(within(strip()).getAllByRole("button", { name: /^Close/ })).toHaveLength(2);

    fireEvent.keyDown(within(strip()).getAllByRole("tab")[0] as HTMLElement, { key: "Delete" });
    expect(onClose).not.toHaveBeenCalled();
  });

  test("Delete on a focused FILE tab closes it", () => {
    const { onClose } = renderTabs({ active: "references/api.md" });
    fireEvent.keyDown(within(strip()).getAllByRole("tab")[1] as HTMLElement, { key: "Delete" });
    expect(onClose).toHaveBeenCalledWith("references/api.md");
  });
});

describe("the Studio file strip — dirty markers", () => {
  test("the manifest's marker follows `manifestDirty`; a file's follows its entry", () => {
    const { rerender } = renderTabs({
      manifestDirty: true,
      tabs: [
        { path: "references/api.md", entry: entryFor("references/api.md", { originalPath: null }) },
      ],
    });
    // Both carry a marker: the manifest is dirty, and a file with no original is brand new.
    expect(within(strip()).getByRole("tab", { name: /SKILL\.md \(unsaved\)/ })).toBeTruthy();
    expect(within(strip()).getByRole("tab", { name: /api\.md \(new\)/ })).toBeTruthy();

    rerender(
      <TooltipProvider>
        <StudioFileTabs
          tabs={[{ path: "references/api.md", entry: entryFor("references/api.md") }]}
          active={SKILL_MD}
          onSelect={vi.fn()}
          onClose={vi.fn()}
          manifestDirty={false}
        />
      </TooltipProvider>,
    );
    expect(within(strip()).queryByRole("tab", { name: /\(unsaved\)/ })).toBeNull();
    expect(within(strip()).queryByRole("tab", { name: /\(new\)/ })).toBeNull();
  });
});
