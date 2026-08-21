import { describe, expect, test } from "vitest";
import { activeTab, closeTab, liveTabs, openTab, remapPath, remapTabs } from "./tab-model";

// ── RM-30 WP 7.4 — the two things every tabbed editor gets wrong ──────────────────────────────────
// 1. closing the ACTIVE tab: what becomes active, and does closing a background tab steal focus?
// 2. renaming an open file: does its tab survive, and does the URL follow it?
// Both are pure here, so they are asserted without a DOM.

const paths = (...values: string[]) => new Set(values);

describe("openTab", () => {
  test("appends, keeps order, never duplicates", () => {
    expect(openTab([], "a.md")).toEqual(["a.md"]);
    expect(openTab(["a.md"], "b.md")).toEqual(["a.md", "b.md"]);
    expect(openTab(["a.md", "b.md"], "a.md")).toEqual(["a.md", "b.md"]);
  });

  test("SKILL.md is pinned — it is never added to the open set", () => {
    expect(openTab(["a.md"], "SKILL.md")).toEqual(["a.md"]);
  });
});

describe("closeTab", () => {
  test("hands over to the tab on the RIGHT", () => {
    expect(closeTab(["a.md", "b.md", "c.md"], "b.md")).toEqual({
      open: ["a.md", "c.md"],
      next: "c.md",
    });
  });

  test("falls back to the LEFT when the closed tab was last", () => {
    expect(closeTab(["a.md", "b.md"], "b.md")).toEqual({ open: ["a.md"], next: "a.md" });
  });

  test("falls back to the pinned manifest when nothing is left", () => {
    expect(closeTab(["a.md"], "a.md")).toEqual({ open: [], next: "SKILL.md" });
  });

  test("closing something that is not open is a no-op set", () => {
    expect(closeTab(["a.md"], "gone.md")).toEqual({ open: ["a.md"], next: "SKILL.md" });
  });
});

describe("remapPath / remapTabs — a rename or a move re-homes the tabs", () => {
  test("a file rename", () => {
    expect(remapPath("a.md", "a.md", "b.md")).toBe("b.md");
    expect(remapTabs(["a.md", "z.md"], "a.md", "b.md")).toEqual(["b.md", "z.md"]);
  });

  test("a folder move carries everything under it", () => {
    expect(remapPath("refs/api.md", "refs", "docs/refs")).toBe("docs/refs/api.md");
    expect(remapTabs(["refs/api.md", "other.md"], "refs", "docs/refs")).toEqual([
      "docs/refs/api.md",
      "other.md",
    ]);
  });

  test("a path that merely SHARES a prefix is not re-homed", () => {
    // "refs2" starts with "refs" as a string but is not inside that folder.
    expect(remapPath("refs2/api.md", "refs", "docs")).toBe("refs2/api.md");
  });
});

describe("liveTabs — a file that stopped existing cannot strand a tab", () => {
  test("drops tabs whose path is gone", () => {
    expect(liveTabs(["a.md", "gone.md"], paths("a.md"))).toEqual(["a.md"]);
  });

  test("keeps order", () => {
    expect(liveTabs(["b.md", "a.md"], paths("a.md", "b.md"))).toEqual(["b.md", "a.md"]);
  });
});

describe("activeTab — what `?file=` resolves to", () => {
  test("no param ⇒ the pinned manifest", () => {
    expect(activeTab(null, paths("a.md"))).toBe("SKILL.md");
  });

  test("a live file ⇒ that file", () => {
    expect(activeTab("a.md", paths("a.md"))).toBe("a.md");
  });

  test("a file that no longer exists ⇒ the manifest, never a blank surface", () => {
    expect(activeTab("deleted.md", paths("a.md"))).toBe("SKILL.md");
  });

  test("SKILL.md named explicitly ⇒ the manifest (it is not in the working-tree path check)", () => {
    expect(activeTab("SKILL.md", paths())).toBe("SKILL.md");
  });
});
