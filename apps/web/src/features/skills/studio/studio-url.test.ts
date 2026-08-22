import { describe, expect, test } from "vitest";
import {
  isStudioRail,
  readStudioUrlState,
  resolveStudioRail,
  skillStudioPath,
  STUDIO_DEFAULT_RAIL,
  writeStudioUrlState,
} from "./studio-url";

// ── RM-30 WP 7.1 acceptance: "URL round-trips file/rail/selection" ────────────────────────────────
// The carry-forward this WP closes is that the skill inspector kept its sub-view in COMPONENT state,
// so a reload lost it and a link couldn't carry it. These tests pin the round-trip at the level that
// decides it — the pure reader/writer the shell drives — so a regression is a red test, not a
// hand-noticed one.
//
// RM-30 WP 7.9 removed the `mode` member (D-UX19 #2): the surface follows the open tab, so `?file=`
// alone decides it and a legacy `?mode=` is ignored rather than honoured.

describe("readStudioUrlState", () => {
  test("an empty query is the usable default view (D-TB10: a route works with zero params)", () => {
    expect(readStudioUrlState("")).toEqual({
      rail: STUDIO_DEFAULT_RAIL,
      file: null,
      sel: null,
    });
  });

  test("reads every param", () => {
    expect(readStudioUrlState("?rail=settings&file=references/api.md&sel=sec-2")).toEqual({
      rail: "settings",
      file: "references/api.md",
      sel: "sec-2",
    });
  });

  test("an EMPTY file/sel param reads as absent, not as an empty selection", () => {
    expect(readStudioUrlState("?file=&sel=")).toEqual({
      rail: STUDIO_DEFAULT_RAIL,
      file: null,
      sel: null,
    });
  });

  test("accepts a URLSearchParams as well as a string", () => {
    const params = new URLSearchParams({ file: "SKILL.md", sel: "sec-1" });
    expect(readStudioUrlState(params)).toEqual({
      rail: STUDIO_DEFAULT_RAIL,
      file: "SKILL.md",
      sel: "sec-1",
    });
  });
});

// ── RM-30 WP 7.9 — the deleted axis ──────────────────────────────────────────────────────────────
// A stale bookmark is the whole reason this is a test and not a deletion note: someone has a
// `?mode=` URL in a chat message, and it must still open a usable workbench.

describe("the deleted `mode` axis (WP 7.9, D-UX19 #2)", () => {
  test("a legacy ?mode= is IGNORED, not honoured and not an error", () => {
    for (const legacy of ["flow", "code", "split", "nonsense"]) {
      const state = readStudioUrlState(`?mode=${legacy}`);
      // No `file` means the Designer — the zero-param landing surface, which is what a stale link
      // must degrade to.
      expect(state).toEqual({ rail: STUDIO_DEFAULT_RAIL, file: null, sel: null });
      expect(Object.keys(state)).not.toContain("mode");
    }
  });

  test("a legacy ?mode= alongside real params leaves the real ones intact", () => {
    expect(readStudioUrlState("?mode=split&rail=settings&file=SKILL.md")).toEqual({
      rail: "settings",
      file: "SKILL.md",
      sel: null,
    });
  });

  test("the writer never emits a mode param, and carries an existing one through untouched", () => {
    // Untouched, not deleted: the writer only owns the params it knows, and silently rewriting a
    // stranger's query string is how deep links break.
    const written = writeStudioUrlState("?mode=split", { file: "SKILL.md" });
    expect(written.get("file")).toBe("SKILL.md");
    expect(writeStudioUrlState("", { file: "SKILL.md" }).has("mode")).toBe(false);
  });
});

describe("writeStudioUrlState", () => {
  test("round-trips every field through read", () => {
    const written = writeStudioUrlState("", {
      rail: "settings",
      file: "scripts/run.py",
      sel: "sec-7",
    });
    expect(readStudioUrlState(written)).toEqual({
      rail: "settings",
      file: "scripts/run.py",
      sel: "sec-7",
    });
  });

  test("null CLEARS a key rather than leaving an empty value on the URL", () => {
    const written = writeStudioUrlState("?rail=settings&file=a.md&sel=n1", {
      file: null,
      sel: null,
    });
    expect(written.has("file")).toBe(false);
    expect(written.has("sel")).toBe(false);
    expect(written.get("rail")).toBe("settings");
  });

  test("an omitted field is left untouched", () => {
    const written = writeStudioUrlState("?rail=tools&file=a.md&sel=n1", { sel: "n2" });
    expect(written.get("rail")).toBe("tools");
    expect(written.get("file")).toBe("a.md");
    expect(written.get("sel")).toBe("n2");
  });

  test("params the Studio does not own ride through unchanged", () => {
    const written = writeStudioUrlState("?tab=quality&baseline=v1", { file: "SKILL.md" });
    expect(written.get("tab")).toBe("quality");
    expect(written.get("baseline")).toBe("v1");
    expect(written.get("file")).toBe("SKILL.md");
  });

  test("SKILL.md is written EXPLICITLY — it is a file like any other now (WP 7.9)", () => {
    expect(writeStudioUrlState("", { file: "SKILL.md" }).toString()).toBe("file=SKILL.md");
  });
});

describe("skillStudioPath", () => {
  test("bare path with no state", () => {
    expect(skillStudioPath("sk-1")).toBe("/skills/sk-1/studio");
  });

  test("carries the named state and encodes the id", () => {
    expect(skillStudioPath("sk 1", { file: "SKILL.md" })).toBe(
      "/skills/sk%201/studio?file=SKILL.md",
    );
  });

  test("state that clears everything produces no query string at all", () => {
    expect(skillStudioPath("sk-1", { file: null, sel: null })).toBe("/skills/sk-1/studio");
  });
});

// ── RM-30 WP 7.3 — the rail tab joins the URL ─────────────────────────────────────────────────────
// The palette's empty state deep-links the Settings tab, so which tab is showing has to be
// addressable. It is also the one param with a DEFAULT that is deliberately NOT written, so a
// zero-param Studio URL stays byte-clean (D-TB10).

describe("the rail tab in the URL (WP 7.3)", () => {
  test("an unrecognised rail degrades to the default instead of throwing", () => {
    expect(readStudioUrlState("?rail=nonsense").rail).toBe(STUDIO_DEFAULT_RAIL);
  });

  test("writing the DEFAULT rail leaves the URL clean; a non-default one is written", () => {
    expect(writeStudioUrlState("", { rail: STUDIO_DEFAULT_RAIL }).toString()).toBe("");
    expect(writeStudioUrlState("", { rail: "settings" }).toString()).toBe("rail=settings");
  });

  test("switching back to the default REMOVES an existing rail param", () => {
    const opened = writeStudioUrlState("", { rail: "settings" });
    expect(writeStudioUrlState(opened, { rail: STUDIO_DEFAULT_RAIL }).toString()).toBe("");
  });

  test("skillStudioPath can deep-link the settings rail", () => {
    expect(skillStudioPath("sk-1", { rail: "settings" })).toBe("/skills/sk-1/studio?rail=settings");
  });

  test("isStudioRail narrows exactly the three CURRENT tabs", () => {
    expect(isStudioRail("files")).toBe(true);
    expect(isStudioRail("components")).toBe(true);
    expect(isStudioRail("settings")).toBe(true);
    expect(isStudioRail("problems")).toBe(false);
    // The pre-7.9 spelling is not a current value — it is an alias, resolved separately below.
    expect(isStudioRail("tools")).toBe(false);
    expect(isStudioRail(null)).toBe(false);
  });
});

// ── RM-30 WP 7.9 — `rail=tools` → `rail=components`, with the old link still working ──────────────
// WP 7.7 shipped the panel as "Components" while its tab and this param still said "tools". Renaming
// the param is the honest half of paying that debt; keeping the old spelling READABLE is the half
// that stops a link someone already pasted into a chat from silently opening the wrong tab.

describe("the rail rename (WP 7.9)", () => {
  test("a legacy ?rail=tools still opens the Components tab", () => {
    expect(readStudioUrlState("?rail=tools").rail).toBe("components");
    expect(resolveStudioRail("tools")).toBe("components");
  });

  test("the CURRENT spelling reads as itself", () => {
    expect(readStudioUrlState("?rail=components").rail).toBe("components");
  });

  test("the alias is READ-only — a write always emits the current vocabulary", () => {
    expect(writeStudioUrlState("", { rail: "components" }).get("rail")).toBe("components");
    // Re-writing any other field over a legacy URL leaves the stale value alone rather than
    // rewriting a param this call was not asked to change…
    expect(writeStudioUrlState("?rail=tools", { file: "SKILL.md" }).get("rail")).toBe("tools");
    // …and it still READS as the Components tab, which is what the author sees.
    expect(readStudioUrlState(writeStudioUrlState("?rail=tools", { file: "SKILL.md" })).rail).toBe(
      "components",
    );
  });

  test("an unknown value is still not an alias — it degrades to the default", () => {
    expect(resolveStudioRail("palette")).toBeNull();
    expect(readStudioUrlState("?rail=palette").rail).toBe(STUDIO_DEFAULT_RAIL);
  });

  test("skillStudioPath deep-links the Components tab by its current name", () => {
    expect(skillStudioPath("sk-1", { rail: "components" })).toBe(
      "/skills/sk-1/studio?rail=components",
    );
  });
});
