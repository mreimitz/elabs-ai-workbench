import { describe, expect, test } from "vitest";
import {
  isStudioMode,
  readStudioUrlState,
  skillStudioPath,
  STUDIO_DEFAULT_MODE,
  writeStudioUrlState,
} from "./studio-url";

// ── RM-30 WP 7.1 acceptance: "URL round-trips mode/file/selection" ────────────────────────────────
// The carry-forward this WP closes is that the skill inspector kept its sub-view in COMPONENT state,
// so a reload lost it and a link couldn't carry it. These tests pin the round-trip at the level that
// decides it — the pure reader/writer the shell drives — so a regression is a red test, not a
// hand-noticed one.

describe("readStudioUrlState", () => {
  test("an empty query is the usable default view (D-TB10: a route works with zero params)", () => {
    expect(readStudioUrlState("")).toEqual({ mode: STUDIO_DEFAULT_MODE, file: null, sel: null });
  });

  test("reads all three params", () => {
    expect(readStudioUrlState("?mode=split&file=references/api.md&sel=sec-2")).toEqual({
      mode: "split",
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
      file: null,
      sel: null,
    });
  });

  test("accepts a URLSearchParams as well as a string", () => {
    const params = new URLSearchParams({ mode: "code", sel: "sec-1" });
    expect(readStudioUrlState(params)).toEqual({ mode: "code", file: null, sel: "sec-1" });
  });
});

describe("writeStudioUrlState", () => {
  test("round-trips every field through read", () => {
    const written = writeStudioUrlState("", {
      mode: "code",
      file: "scripts/run.py",
      sel: "sec-7",
    });
    expect(readStudioUrlState(written)).toEqual({
      mode: "code",
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
