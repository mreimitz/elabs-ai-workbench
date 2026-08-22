/**
 * no-mode-axis.guardrail.test.ts — RM-30 WP 7.9 acceptance #1 and #2, pinned by a SOURCE WALK.
 *
 * D-UX19 #2 is "Designer = visual, Files = source — the mode switch dies, both edit one draft". A
 * deletion is the one kind of change a behavioural test cannot hold: you can assert that a control
 * does not render in the one tree a test happens to mount, and still leave the control alive behind
 * a prop, a branch, or a second host nobody mounted. So this walks every source file under
 * `apps/web/src/features/skills/**` and fails on the vocabulary of the deleted axis.
 *
 * It is deliberately NARROW. It does not ban the English word "split" (`String.prototype.split`,
 * `splitLines`, "Split out of the Overview tab" are all legitimate and unrelated); it bans the
 * things that could only exist if the axis were still there:
 *
 *   · a QUOTED `split` — the mode literal, in a union, a comparison, or a prop value;
 *   · the deleted control's accessible names, which are what a user would actually see;
 *   · `hideModeToggle`, the prop that existed only to suppress a second copy of that control;
 *   · reads and writes of a `mode` query param.
 *
 * SCOPE: PRODUCTION source only. `*.test.ts(x)` is excluded, and this file with it — a test that
 * asserts the control does not render, or that a stale `mode` bookmark still opens a usable
 * workbench, has to name the thing it is asserting the absence of. Naming it in an assertion is not
 * the same as offering it as an editor mode, which is what the acceptance forbids.
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

const HERE = path.dirname(fileURLToPath(import.meta.url));
/** `apps/web/src/features/skills` — the whole Studio + editor surface this WP owns. */
const SKILLS_ROOT = path.resolve(HERE, "..");

const isTest = (name: string): boolean => /\.test\.(ts|tsx)$/.test(name);

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (/\.(ts|tsx)$/.test(entry.name) && !isTest(entry.name)) out.push(full);
  }
  return out;
}

const FILES = walk(SKILLS_ROOT).map((file) => ({
  rel: path.relative(SKILLS_ROOT, file),
  text: readFileSync(file, "utf8"),
}));

/** Each ban is a named pattern so a failure says WHICH piece of the deleted axis came back. */
const BANNED: { what: string; pattern: RegExp; why: string }[] = [
  {
    what: 'the "split" editor mode',
    pattern: /["'`]split["'`]/i,
    why: "two views of one document side by side is the affordance D-UX19 #2 removed",
  },
  {
    what: "the view control's group label",
    pattern: /Editor view/,
    why: "the segmented Flow/Code/Split control was deleted, not relabelled",
  },
  {
    what: "the view control's item labels",
    pattern: /Show flow|Show code|Split view/,
    why: "there is no control to pick a view with — the open tab decides the surface",
  },
  {
    what: "the hideModeToggle prop",
    pattern: /hideModeToggle/,
    why: "a prop with one possible value is a lie about the API; the toggle is gone from both hosts",
  },
  {
    what: "a mode query param",
    pattern: /\?mode=|get\(\s*["'`]mode["'`]\s*\)|set\(\s*["'`]mode["'`]/,
    why: "?file= alone decides the surface; a legacy ?mode= is ignored, never read or written",
  },
];

describe("RM-30 WP 7.9 — the editor mode axis is DELETED, not hidden", () => {
  test("the walk actually sees the surface it claims to guard (non-vacuity)", () => {
    // If a refactor moved these files, the bans below would pass by scanning nothing.
    expect(FILES.length).toBeGreaterThan(50);
    expect(FILES.every((file) => !file.rel.includes(".test."))).toBe(true);
    expect(FILES.map((file) => file.rel)).toContain(path.join("design", "UnifiedEditor.tsx"));
    expect(FILES.map((file) => file.rel)).toContain(path.join("studio", "StudioShell.tsx"));
  });

  for (const ban of BANNED) {
    test(`no file names ${ban.what} — ${ban.why}`, () => {
      const offenders = FILES.filter((file) => ban.pattern.test(file.text)).map((file) => file.rel);
      expect(offenders).toEqual([]);
    });
  }

  test("EditorMode is exactly the two surfaces, declared once", () => {
    const source = readFileSync(path.join(SKILLS_ROOT, "design", "UnifiedEditor.tsx"), "utf8");
    const matches = source.match(/export type EditorMode = [^;]+;/g) ?? [];
    expect(matches).toEqual(['export type EditorMode = "flow" | "code";']);
  });

  test("the Studio's URL state carries no mode member", () => {
    const source = readFileSync(path.join(SKILLS_ROOT, "studio", "studio-url.ts"), "utf8");
    expect(source).not.toMatch(/StudioMode|STUDIO_MODES|STUDIO_DEFAULT_MODE|isStudioMode/);
    // The state type is the exhaustive list of what the URL decides — `mode` is not in it.
    const state = source.match(/export type StudioUrlState = \{[^}]+\}/)?.[0] ?? "";
    expect(state).not.toBe("");
    expect(state).not.toMatch(/\bmode\b/);
  });
});
