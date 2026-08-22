import { describe, expect, test } from "vitest";
import {
  activeTab,
  closeTab,
  DESIGNER_TAB,
  liveTabs,
  openTab,
  remapPath,
  remapTabs,
} from "./tab-model";

// ── RM-30 WP 7.4 — the two things every tabbed editor gets wrong ──────────────────────────────────
// 1. closing the ACTIVE tab: what becomes active, and does closing a background tab steal focus?
// 2. renaming an open file: does its tab survive, and does the URL follow it?
// Both are pure here, so they are asserted without a DOM.
//
// RM-30 WP 7.9 moved the pin: the DESIGNER is the unclosable first tab, and `SKILL.md` became an
// ordinary file tab. Every assertion below that used to name SKILL.md as the pin now names the
// Designer, and SKILL.md is asserted to behave like a file.

const paths = (...values: string[]) => new Set(values);

describe("openTab", () => {
  test("appends, keeps order, never duplicates", () => {
    expect(openTab([], "a.md")).toEqual(["a.md"]);
    expect(openTab(["a.md"], "b.md")).toEqual(["a.md", "b.md"]);
    expect(openTab(["a.md", "b.md"], "a.md")).toEqual(["a.md", "b.md"]);
  });

  test("the Designer is pinned — it is never added to the open set", () => {
    expect(openTab(["a.md"], DESIGNER_TAB)).toEqual(["a.md"]);
  });

  test("SKILL.md IS an openable tab now (WP 7.9) — it is the manifest's source", () => {
    expect(openTab(["a.md"], "SKILL.md")).toEqual(["a.md", "SKILL.md"]);
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

  test("falls back to the pinned Designer when nothing is left", () => {
    expect(closeTab(["a.md"], "a.md")).toEqual({ open: [], next: DESIGNER_TAB });
  });

  test("closing SKILL.md is allowed and hands back to the Designer", () => {
    expect(closeTab(["SKILL.md"], "SKILL.md")).toEqual({ open: [], next: DESIGNER_TAB });
  });

  test("closing something that is not open is a no-op set", () => {
    expect(closeTab(["a.md"], "gone.md")).toEqual({ open: ["a.md"], next: DESIGNER_TAB });
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
  test("no param ⇒ the pinned Designer (the zero-param landing surface, D-TB10)", () => {
    expect(activeTab(null, paths("a.md"))).toBe(DESIGNER_TAB);
  });

  test("a live file ⇒ that file", () => {
    expect(activeTab("a.md", paths("a.md"))).toBe("a.md");
  });

  test("SKILL.md ⇒ SKILL.md, because it is in the working tree like any other file", () => {
    expect(activeTab("SKILL.md", paths("SKILL.md", "a.md"))).toBe("SKILL.md");
  });

  test("a file that no longer exists ⇒ the Designer, never a blank surface", () => {
    expect(activeTab("deleted.md", paths("a.md"))).toBe(DESIGNER_TAB);
  });

  test("the Designer named explicitly ⇒ the Designer (it is not a working-tree path)", () => {
    expect(activeTab(DESIGNER_TAB, paths())).toBe(DESIGNER_TAB);
  });
});

describe("DESIGNER_TAB", () => {
  test("is not spellable as a posix path a skill version could hold", () => {
    // A working-tree path never carries a colon-prefixed scheme; if this ever became a legal path a
    // file could collide with the pinned tab's identity.
    expect(DESIGNER_TAB.startsWith("studio:")).toBe(true);
  });
});
