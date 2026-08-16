import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Toolbar-reach WP 4.1 · guardrail 3 (D-TB5) — locks the `no-title-on-icon-button` PostToolUse hook.
// ------------------------------------------------------------------------------------------------
// The hook rejects a native `title=` on a TEXT-LESS <Button>/<IconButton> (an icon-only control's
// affordance must be the IconButton tooltip, never `title` — invisible to assistive tech). It is an
// enforce-brand-ui-style nudge (exit 2). This test drives the real hook binary with crafted
// PostToolUse payloads so its "flag the bad, ignore the legitimate" contract can't silently rot — it
// is BOTH the guardrail's regression lock AND the reproducible demonstration that it fires on the
// pre-fix pattern while never false-positiving on component `title` PROPS or text-bearing buttons.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const HOOK = path.resolve(HERE, "../../../..", ".claude/hooks/no-title-on-icon-button.mjs");

/** Invoke the hook exactly as a PostToolUse Write would: JSON on stdin, read its exit status. */
function runHook(filePath: string, content: string): { status: number; stderr: string } {
  const res = spawnSync("node", [HOOK], {
    input: JSON.stringify({ tool_name: "Write", tool_input: { file_path: filePath, content } }),
    encoding: "utf8",
  });
  return { status: res.status ?? -1, stderr: res.stderr ?? "" };
}

const WEB = "/repo/mcp-token-footprint/apps/web/src/features/demo/Bar.tsx";

describe("no-title-on-icon-button hook — FLAGS a text-less <Button>/<IconButton> title (D-TB5)", () => {
  it("flags an icon-only <Button> with title (exit 2, message names D-TB5)", () => {
    const r = runHook(WEB, `<Button title="Refresh"><RefreshCw aria-hidden /></Button>`);
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/D-TB5/);
    expect(r.stderr).toMatch(/IconButton/);
  });

  it("flags a self-closing <Button title=… /> (no children at all)", () => {
    expect(runHook(WEB, `<Button title="Refresh" size="icon" />`).status).toBe(2);
  });

  it("flags an <IconButton> misused with a native title", () => {
    expect(runHook(WEB, `<IconButton title="Delete"><Trash aria-hidden /></IconButton>`).status).toBe(
      2,
    );
  });

  it("flags a multi-line icon-only button", () => {
    const src = ["<Button title=\"Export\" variant=\"ghost\">", "  <Download aria-hidden />", "</Button>"].join(
      "\n",
    );
    expect(runHook(WEB, src).status).toBe(2);
  });
});

describe("no-title-on-icon-button hook — IGNORES legitimate title (no false positives)", () => {
  it("a <Button> with a visible TEXT child (D-10 recovery carve-out)", () => {
    expect(runHook(WEB, `<Button title="Delete run">Delete</Button>`).status).toBe(0);
  });

  it("a <Button> whose child is a text expression", () => {
    expect(runHook(WEB, `<Button title="Save">{label}</Button>`).status).toBe(0);
  });

  it("a component `title` PROP on StatePanel/EmptyState/SplitPanePanel (not a button)", () => {
    expect(runHook(WEB, `<StatePanel title="No runs yet" description="…" />`).status).toBe(0);
    expect(runHook(WEB, `<EmptyState title="Nothing here"><Icon /></EmptyState>`).status).toBe(0);
    expect(runHook(WEB, `<SplitPanePanel title="Detail">{children}</SplitPanePanel>`).status).toBe(0);
  });

  it("an @brand/ai PromptInputButton (only exact Button/IconButton are targeted)", () => {
    expect(
      runHook(WEB, `<PromptInputButton title="Send"><Send aria-hidden /></PromptInputButton>`).status,
    ).toBe(0);
  });

  it("a `data-title=` attribute (not the native `title`)", () => {
    expect(runHook(WEB, `<Button data-title="x"><Icon aria-hidden /></Button>`).status).toBe(0);
  });

  it("an icon-only <Button> with NO title (nothing to flag)", () => {
    expect(runHook(WEB, `<Button size="icon"><Icon aria-hidden /></Button>`).status).toBe(0);
  });

  it("the brand-ui-allow escape hatch on the opening-tag line", () => {
    expect(
      runHook(WEB, `<Button title="Refresh"><Icon aria-hidden /></Button> // brand-ui-allow: legacy`)
        .status,
    ).toBe(0);
  });

  it("a non-web file (apps/api) is never checked", () => {
    expect(
      runHook("/repo/mcp-token-footprint/apps/api/src/x.ts", `<Button title="Refresh"><I /></Button>`)
        .status,
    ).toBe(0);
  });

  it("a test/spec fixture file is skipped (JSX-in-strings)", () => {
    expect(
      runHook(
        "/repo/mcp-token-footprint/apps/web/src/features/demo/Bar.test.tsx",
        `<Button title="Refresh"><Icon aria-hidden /></Button>`,
      ).status,
    ).toBe(0);
  });
});
