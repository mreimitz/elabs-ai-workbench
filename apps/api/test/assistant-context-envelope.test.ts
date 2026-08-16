import assert from "node:assert/strict";
import { test } from "node:test";
import type { AssistantContextEnvelope } from "@mcp-token-footprint/shared";
import { appendContextEnvelope, renderContextEnvelope } from "../src/assistant/context-envelope.js";

// Assistant (WP 1.2) — the per-message context envelope renderer (00-plan.md §3.2). PURE function
// tests: no DB, no session — just the rendering contract WP 1.1's session manager depends on.

test("renderContextEnvelope renders the route alone when no entity/tab is pinned", () => {
  const envelope: AssistantContextEnvelope = { route: "/testing/runs" };
  const rendered = renderContextEnvelope(envelope);
  assert.match(rendered, /<app-context>/);
  assert.match(rendered, /Current page: \/testing\/runs/);
  assert.match(rendered, /<\/app-context>/);
  assert.doesNotMatch(rendered, /Pinned entity/);
  assert.doesNotMatch(rendered, /Active tab/);
});

test("renderContextEnvelope renders the pinned entity kind + id together", () => {
  const envelope: AssistantContextEnvelope = {
    route: "/testing/runs/run-abc123",
    entityKind: "run",
    entityId: "run-abc123",
  };
  const rendered = renderContextEnvelope(envelope);
  assert.match(rendered, /Pinned entity: run run-abc123/);
});

test("renderContextEnvelope renders entity KIND alone when no id is pinned", () => {
  const envelope: AssistantContextEnvelope = {
    route: "/testing/environments",
    entityKind: "scenario",
  };
  const rendered = renderContextEnvelope(envelope);
  assert.match(rendered, /Pinned entity kind: scenario/);
  assert.doesNotMatch(rendered, /Pinned entity:/); // the "kind + id" variant must not also fire
});

test("renderContextEnvelope renders the active tab when present", () => {
  const envelope: AssistantContextEnvelope = {
    route: "/skills/skill-1",
    entityKind: "skill",
    entityId: "skill-1",
    tab: "design",
  };
  const rendered = renderContextEnvelope(envelope);
  assert.match(rendered, /Active tab: design/);
});

test("R1.1: a pinned envelope carries the WRITE-SCOPE instruction (writes confined to this entity)", () => {
  const rendered = renderContextEnvelope({
    route: "/skills/skill-1",
    entityKind: "skill",
    entityId: "skill-1",
  });
  // Still resolves vague references…
  assert.match(rendered, /resolve vague references/i);
  // …and now SETS the write scope (an instruction, not a hint).
  assert.match(rendered, /write scope/i);
  assert.match(rendered, /only create\/update\/delete/i);
  assert.match(rendered, /denied/i);
  // Reads stay broad.
  assert.match(rendered, /read broadly/i);
});

test("R1.1: an UNPINNED envelope declares read-only (every write disabled until an entity is opened)", () => {
  const rendered = renderContextEnvelope({ route: "/dashboard" });
  assert.match(rendered, /read-only/i);
  assert.match(rendered, /every write is disabled/i);
});

test("renderContextEnvelope returns empty string for an envelope with no route", () => {
  const rendered = renderContextEnvelope({ route: "" } as AssistantContextEnvelope);
  assert.equal(rendered, "");
});

test("appendContextEnvelope appends the rendered block after a blank line", () => {
  const text = "Why did this run fail?";
  const out = appendContextEnvelope(text, {
    route: "/testing/runs/run-1",
    entityKind: "run",
    entityId: "run-1",
  });
  assert.ok(out.startsWith(`${text}\n\n<app-context>`));
  assert.match(out, /Pinned entity: run run-1/);
});

test("appendContextEnvelope returns the original text unchanged when there is no envelope", () => {
  const text = "General question, no pinned entity.";
  assert.equal(appendContextEnvelope(text, undefined), text);
});

test("appendContextEnvelope returns the original text unchanged when the envelope renders empty", () => {
  const text = "Edge case.";
  assert.equal(appendContextEnvelope(text, { route: "" } as AssistantContextEnvelope), text);
});
