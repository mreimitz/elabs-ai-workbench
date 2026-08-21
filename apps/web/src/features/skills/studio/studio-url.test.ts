import { describe, expect, test } from "vitest";
import {
  isStudioMode,
  isStudioRail,
  readStudioUrlState,
  skillStudioPath,
  STUDIO_DEFAULT_MODE,
  STUDIO_DEFAULT_RAIL,
  writeStudioUrlState,
} from "./studio-url";

// ── RM-30 WP 7.1 acceptance: "URL round-trips mode/file/selection" ────────────────────────────────
// The carry-forward this WP closes is that the skill inspector kept its sub-view in COMPONENT state,
// so a reload lost it and a link couldn't carry it. These tests pin the round-trip at the level that
// decides it — the pure reader/writer the shell drives — so a regression is a red test, not a
// hand-noticed one.

describe("readStudioUrlState", () => {
  test("an empty query is the usable default view (D-TB10: a route works with zero params)", () => {
    expect(readStudioUrlState("")).toEqual({
      mode: STUDIO_DEFAULT_MODE,
      rail: STUDIO_DEFAULT_RAIL,
      file: null,
      sel: null,
    });
  });

  test("reads every param", () => {
    expect(
      readStudioUrlState("?mode=split&rail=settings&file=references/api.md&sel=sec-2"),
    ).toEqual({
      mode: "split",
      rail: "settings",
      file: "references/api.md",
      sel: "sec-2",
    });
  });

  test("an unrecognised mode degrades to the default instead of throwing", () => {
    expect(readStudioUrlState("?mode=nonsense").mode).toBe(STUDIO_DEFAULT_MODE);
  });

  test("an EMPTY file/sel param reads as absent, not as an empty selection", () => {
    expect(readStudioUrlState("?file=&sel=")).toEqual({
      mode: STUDIO_DEFAULT_MODE,
      rail: STUDIO_DEFAULT_RAIL,
      file: null,
      sel: null,
    });
  });

  test("accepts a URLSearchParams as well as a string", () => {
    const params = new URLSearchParams({ mode: "code", sel: "sec-1" });
    expect(readStudioUrlState(params)).toEqual({
      mode: "code",
      rail: STUDIO_DEFAULT_RAIL,
      file: null,
      sel: "sec-1",
    });
  });
});

describe("writeStudioUrlState", () => {
  test("round-trips every field through read", () => {
    const written = writeStudioUrlState("", {
      mode: "code",
      rail: "settings",
      file: "scripts/run.py",
      sel: "sec-7",
    });
    expect(readStudioUrlState(written)).toEqual({
      mode: "code",
      rail: "settings",
      file: "scripts/run.py",
      sel: "sec-7",
    });
  });

  test("null CLEARS a key rather than leaving an empty value on the URL", () => {
    const written = writeStudioUrlState("?mode=split&file=a.md&sel=n1", { file: null, sel: null });
    expect(written.has("file")).toBe(false);
    expect(written.has("sel")).toBe(false);
    expect(written.get("mode")).toBe("split");
  });

  test("an omitted field is left untouched", () => {
    const written = writeStudioUrlState("?mode=code&file=a.md&sel=n1", { sel: "n2" });
    expect(written.get("mode")).toBe("code");
    expect(written.get("file")).toBe("a.md");
    expect(written.get("sel")).toBe("n2");
  });

  test("params the Studio does not own ride through unchanged", () => {
    const written = writeStudioUrlState("?tab=quality&baseline=v1", { mode: "flow" });
    expect(written.get("tab")).toBe("quality");
    expect(written.get("baseline")).toBe("v1");
    expect(written.get("mode")).toBe("flow");
  });
});

describe("skillStudioPath", () => {
  test("bare path with no state", () => {
    expect(skillStudioPath("sk-1")).toBe("/skills/sk-1/studio");
  });

  test("carries the named state and encodes the id", () => {
    expect(skillStudioPath("sk 1", { mode: "code" })).toBe("/skills/sk%201/studio?mode=code");
  });

  test("state that clears everything produces no query string at all", () => {
    expect(skillStudioPath("sk-1", { file: null, sel: null })).toBe("/skills/sk-1/studio");
  });
});

describe("isStudioMode", () => {
  test("accepts exactly the three views", () => {
    expect(isStudioMode("flow")).toBe(true);
    expect(isStudioMode("code")).toBe(true);
    expect(isStudioMode("split")).toBe(true);
    expect(isStudioMode("design")).toBe(false);
    expect(isStudioMode(null)).toBe(false);
    expect(isStudioMode(undefined)).toBe(false);
  });
});

// ── RM-30 WP 7.3 — the rail tab joins the URL ─────────────────────────────────────────────────────
// The Tools palette's empty state deep-links the Settings tab, so which tab is showing has to be
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

  test("isStudioRail narrows exactly the three tabs", () => {
    expect(isStudioRail("files")).toBe(true);
    expect(isStudioRail("tools")).toBe(true);
    expect(isStudioRail("settings")).toBe(true);
    expect(isStudioRail("problems")).toBe(false);
    expect(isStudioRail(null)).toBe(false);
  });
});
