/**
 * assistant-flag-split.guardrail.test.ts — pins the TWO assistant feature flags apart.
 *
 * WHAT IT GUARDS. Settings › Features carries two independent switches (see
 * `packages/shared/src/feature-flags.ts`):
 *
 *   • `assistant`     — the full-page Assistant WORKSPACE: the sidebar group, the `/assistant/*`
 *                       routes, `/api/hub`.
 *   • `app_assistant` — the right-hand App-assistant DOCK: its toggle, its split column, its
 *                       starter chips, `/api/assistant/*`.
 *
 * They share nothing. Yet `App.tsx` gated `dockAvailable` (and the starters fetch) on the
 * WORKSPACE's flag, so switching the workspace off took the unrelated dock with it — the exact bug
 * the split was created to end. `AppShell.feature-flags.test.tsx` could not see it: that test passes
 * `dockAvailable` in by hand, so the seam where the wrong flag was chosen sat outside its reach.
 *
 * WHY A SOURCE SCAN. The defect is a one-word identifier swap in a prop expression. It typechecks
 * (both flags are `AppFeatureId`), it lints, and every unit test stays green — the only witness is a
 * running app with one switch flipped. So this asserts the OWNERSHIP rule directly on the source:
 * the workspace flag is read only where the workspace is enforced, and every dock-owning module
 * reads the dock's own flag.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const WEB_SRC = join(__dirname, "..");

/** Every non-test `.ts`/`.tsx` file under `apps/web/src`, as repo-ish relative paths. */
function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "dist") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      sourceFiles(full, out);
      continue;
    }
    if (!/\.tsx?$/.test(entry)) continue;
    if (/\.(test|spec)\.tsx?$/.test(entry)) continue;
    if (/\.guardrail\.tsx?$/.test(entry)) continue;
    out.push(full);
  }
  return out;
}

const FILES = sourceFiles(WEB_SRC);
const rel = (full: string) => relative(WEB_SRC, full).split("\\").join("/");
const read = (full: string) => readFileSync(full, "utf8");

/** Reads the WORKSPACE flag — allowed ONLY in modules that gate the workspace's own surfaces. */
const WORKSPACE_FLAG_READ = /useFeatureEnabled\(\s*["']assistant["']\s*\)/;
/** Reads the DOCK's flag. */
const DOCK_FLAG_READ = /useFeatureEnabled\(\s*["']app_assistant["']\s*\)/;

/**
 * The only modules permitted to read `assistant`. `AppShell.tsx` gates the sidebar's Assistant nav
 * group (and reads BOTH flags, each for its own surface). Adding a file here is a deliberate claim
 * that it gates the WORKSPACE — never the dock.
 */
const WORKSPACE_FLAG_READERS = new Set(["components/AppShell.tsx"]);

/** Modules that own a piece of the dock and must therefore gate on the dock's own flag. */
const DOCK_FLAG_READERS = [
  "components/AppShell.tsx",
  "features/assistant/assistant-context.tsx",
  "features/assistant/use-assistant-starters.ts",
];

describe("assistant workspace vs. App-assistant dock — one flag each", () => {
  it("reads the workspace flag only where the workspace is gated", () => {
    const readers = FILES.filter((f) => WORKSPACE_FLAG_READ.test(read(f))).map(rel).sort();
    expect(readers).toEqual([...WORKSPACE_FLAG_READERS].sort());
  });

  it("gates every dock-owning module on `app_assistant`", () => {
    for (const path of DOCK_FLAG_READERS) {
      expect(DOCK_FLAG_READ.test(read(join(WEB_SRC, path))), `${path} must read app_assistant`).toBe(
        true,
      );
    }
  });

  it("never gates the dock's availability on a feature flag read in App.tsx", () => {
    const app = read(join(WEB_SRC, "App.tsx"));
    // The regression in the literal shape it took: `dockAvailable={assistant.authConfigured && <flag>}`.
    const match = app.match(/dockAvailable=\{([^}]*)\}/);
    expect(match, "App.tsx must pass `dockAvailable` to AppShell").toBeTruthy();
    const expression = match?.[1] ?? "";
    expect(expression).not.toMatch(/Enabled/);
    expect(expression).not.toMatch(/useFeatureEnabled/);
    // And the flag must not be read anywhere in App.tsx at all: the dock's gate belongs to the two
    // modules that ENFORCE it (AppShell + the starters hook), not to the route table.
    expect(app).not.toMatch(/useFeatureEnabled\(/);
  });

  it("keeps the starters fetch on the dock's flag, read inside the hook", () => {
    const hook = read(join(WEB_SRC, "features/assistant/use-assistant-starters.ts"));
    expect(hook).toMatch(DOCK_FLAG_READ);
    expect(hook).not.toMatch(WORKSPACE_FLAG_READ);
    // No caller may pass the feature switch in — that is how the wrong flag arrived last time.
    const app = read(join(WEB_SRC, "App.tsx"));
    expect(app).not.toMatch(/enabled:\s*\w*[Aa]ssistantEnabled/);
  });
});
