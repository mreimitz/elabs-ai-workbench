import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveAssistantUiView } from "@mcp-token-footprint/shared";
import { buildUiToolDefinitions } from "../src/assistant/tools/ui-tools.js";

// Assistant (WP 3.1) — the ui_* navigation-only tools, exercised DIRECTLY (each tool's
// `.handler(args, {})`, no SDK session, no MCP round-trip — same unit-test convention as
// `assistant-tools.test.ts`). These tools take NO repository deps (pure route resolution against the
// shared addressable-view registry), so there is no fixture DB here.

function toolFor(name: string) {
  const def = buildUiToolDefinitions().find((d) => d.name === name);
  if (!def) throw new Error(`no ui_* tool registered named "${name}"`);
  return def;
}

type UiSuccess = { action: string; route: string; label: string; params: Record<string, unknown> };

async function call(name: string, args: Record<string, unknown>) {
  const def = toolFor(name);
  return def.handler(args as never, {});
}

async function callOk(name: string, args: Record<string, unknown>): Promise<UiSuccess> {
  const result = await call(name, args);
  assert.equal(result.isError, undefined, `${name} unexpectedly errored`);
  const block = result.content[0] as { type: "text"; text: string };
  assert.equal(block.type, "text");
  return JSON.parse(block.text) as UiSuccess;
}

async function callErr(name: string, args: Record<string, unknown>): Promise<string> {
  const result = await call(name, args);
  assert.equal(result.isError, true, `${name} should have errored on bad params`);
  const block = result.content[0] as { type: "text"; text: string };
  const parsed = JSON.parse(block.text) as { error: string };
  return parsed.error;
}

test("buildUiToolDefinitions registers exactly the four ui_* tools, no duplicates", () => {
  const names = buildUiToolDefinitions().map((d) => d.name);
  assert.deepEqual([...names].sort(), [
    "ui_navigate",
    "ui_open_diff",
    "ui_open_run_turn",
    "ui_open_skill",
  ]);
  assert.equal(new Set(names).size, names.length);
  for (const def of buildUiToolDefinitions()) {
    assert.ok(def.description.length > 10, `${def.name} needs a real description`);
  }
});

// ── ui_navigate — the general-purpose { view, params } escape valve ────────────────────────────────

test("ui_navigate resolves a registered view to its concrete route + label", async () => {
  const out = await callOk("ui_navigate", { view: "scan", params: { scanId: "scan-1" } });
  assert.equal(out.action, "navigate");
  assert.equal(out.route, "/scans/scan-1");
  assert.match(out.label, /Scan detail/);
  // `params` echoes the RAW navigate args ({view, params}) — NOT the resolved view params — so the
  // client can re-run the identical `resolveAssistantUiAction("navigate", …)` and reach /scans/scan-1.
  assert.deepEqual(out.params, { view: "scan", params: { scanId: "scan-1" } });
});

test("ui_navigate resolves settings with no params", async () => {
  const out = await callOk("ui_navigate", { view: "settings" });
  assert.equal(out.route, "/settings");
});

test("ui_navigate rejects an unregistered view — a tool error, never a navigation", async () => {
  // The `view` enum is validated by ui_navigate's OWN args schema before it ever reaches the
  // per-view registry lookup — still "a tool error, never a navigation" either way.
  const message = await callErr("ui_navigate", { view: "admin_panel" });
  assert.match(message, /Invalid params for view "navigate"/);
  assert.match(message, /admin_panel/);
});

test("ui_navigate rejects a registered view with invalid params", async () => {
  // "server" requires a non-empty serverId — an empty string must fail the shared registry's schema.
  const message = await callErr("ui_navigate", { view: "server", params: { serverId: "" } });
  assert.match(message, /Invalid params for view "server"/);
});

// ── ui_open_run_turn ─────────────────────────────────────────────────────────────────────────────

test("ui_open_run_turn resolves a run + 0-based turn anchor into a ?turn= route", async () => {
  const out = await callOk("ui_open_run_turn", { runId: "run-1", turnIndex: 3 });
  assert.equal(out.action, "open_run_turn");
  assert.equal(out.route, "/testing/runs/run-1?turn=3");
  // Label is 1-based for humans, matching the "turn N" convention.
  assert.match(out.label, /turn 4/);
});

test("ui_open_run_turn rejects a missing runId", async () => {
  const message = await callErr("ui_open_run_turn", { turnIndex: 0 });
  assert.match(message, /Invalid params for view "run"/);
});

// ── ui_open_skill ────────────────────────────────────────────────────────────────────────────────

test("ui_open_skill resolves a skill + tab + version onto /skills/:id with query params", async () => {
  const out = await callOk("ui_open_skill", { skillId: "skill-1", tab: "files", version: "v-9" });
  assert.equal(out.action, "open_skill");
  assert.equal(out.route, "/skills/skill-1?tab=files&version=v-9");
  assert.match(out.label, /files/);
});

test("ui_open_skill resolves a bare skill id with no tab/version", async () => {
  const out = await callOk("ui_open_skill", { skillId: "skill-1" });
  assert.equal(out.route, "/skills/skill-1");
});

test("ui_open_skill rejects an unknown tab", async () => {
  const message = await callErr("ui_open_skill", { skillId: "skill-1", tab: "nonexistent-tab" });
  assert.match(message, /Invalid params for view "skill"/);
});

// ── ui_open_diff ─────────────────────────────────────────────────────────────────────────────────

test("ui_open_diff resolves multiple run ids + baseline/mode/focus onto the compare workspace URL", async () => {
  const out = await callOk("ui_open_diff", {
    ids: ["run-a", "run-b", "run-c"],
    baseline: "run-a",
    mode: "flow",
    focus: "B@t3.s2",
  });
  assert.equal(out.action, "open_diff");
  assert.equal(
    out.route,
    "/testing/runs/compare?ids=run-a%2Crun-b%2Crun-c&baseline=run-a&mode=flow&focus=B%40t3.s2",
  );
  assert.match(out.label, /3 runs/);
});

test("ui_open_diff rejects an empty id list", async () => {
  const message = await callErr("ui_open_diff", { ids: [] });
  assert.match(message, /Invalid params for view "compare"/);
});

test("ui_open_diff rejects more ids than the letter-chip cap (6)", async () => {
  const ids = ["a", "b", "c", "d", "e", "f", "g"];
  const message = await callErr("ui_open_diff", { ids });
  assert.match(message, /Invalid params for view "compare"/);
});

test("ui_open_diff rejects an unknown mode", async () => {
  const message = await callErr("ui_open_diff", { ids: ["run-a"], mode: "efficiency-radar" });
  assert.match(message, /Invalid params for view "compare"/);
});

// ── The shared registry's own defensive "unknown view" guard (packages/shared) ──────────────────
// Unreachable through ui_navigate's own zod-validated `view` enum (tested above) — this exercises
// `resolveAssistantUiView` directly, as a caller outside the type system (e.g. a raw string from an
// older/foreign client) would.
test("resolveAssistantUiView rejects a view string outside the registry, called directly", () => {
  const resolution = resolveAssistantUiView("admin_panel", {});
  assert.equal(resolution.ok, false);
  if (!resolution.ok) assert.match(resolution.error, /Unknown view "admin_panel"/);
});
