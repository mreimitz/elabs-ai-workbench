// Assistant Hub — provider tool-name boundary (P0 fix). The hub grants tools under DOTTED internal keys
// (`files.write`, `artifacts.create`, `memory.propose_save`, …) and bridged MCP tools can carry
// dots/colons/other separators or exceed 128 chars — all of which providers (notably Anthropic) reject
// with `tools.0.custom.name: String should match pattern ^[a-zA-Z0-9_-]{1,128}$`. This locks the
// sanitizer's contract: safe re-keying, a total bijection under collisions, the 128-char cap, and a
// round-trip back to the internal name — so a regression to the raw dotted names is caught here.

import assert from "node:assert/strict";
import { test } from "node:test";
import { tool, type Tool } from "ai";
import { z } from "zod";
import {
  PROVIDER_TOOL_NAME_PATTERN,
  sanitizeToolNamesForProvider,
} from "../src/hub/tools/provider-tool-names.js";

const PATTERN = /^[a-zA-Z0-9_-]{1,128}$/;

/** A minimal real AI-SDK tool, tagged so re-keying can be proven to preserve the SAME value. */
function makeTool(tag: string): Tool {
  return tool({
    description: tag,
    inputSchema: z.object({ x: z.string() }),
    execute: async () => tag,
  }) as Tool;
}

test("dotted internal built-in names become underscore provider names (files.write -> files_write)", () => {
  const tools: Record<string, Tool> = {
    "files.list": makeTool("t-list"),
    "files.read": makeTool("t-read"),
    "files.write": makeTool("t-write"),
    "artifacts.create": makeTool("t-artifact"),
    "memory.propose_save": makeTool("t-memory"),
    "mission.propose_plan": makeTool("t-mission"),
  };
  const { providerTools, toInternalName } = sanitizeToolNamesForProvider(tools);

  // Each dotted internal name maps to its dot->underscore provider form.
  const names = Object.keys(providerTools);
  assert.ok(names.includes("files_write"), "files.write -> files_write");
  assert.ok(names.includes("artifacts_create"), "artifacts.create -> artifacts_create");
  assert.ok(names.includes("memory_propose_save"), "an existing underscore is preserved");

  // Every emitted provider name matches the provider contract.
  for (const name of names) {
    assert.match(name, PATTERN, `provider name "${name}" must match the pattern`);
  }
  // The exported pattern is the same contract used here.
  assert.equal(PROVIDER_TOOL_NAME_PATTERN.source, PATTERN.source);

  // Round-trip: provider -> internal is exact; an unknown name is identity.
  assert.equal(toInternalName("files_write"), "files.write");
  assert.equal(toInternalName("artifacts_create"), "artifacts.create");
  assert.equal(toInternalName("never.issued"), "never.issued");

  // The re-keyed value is the SAME Tool object (not a copy).
  assert.equal(providerTools.files_write, tools["files.write"]);
  assert.equal(providerTools.artifacts_create, tools["artifacts.create"]);

  // Bijection: one provider name per internal name, no losses.
  assert.equal(Object.keys(providerTools).length, Object.keys(tools).length);
});

test("MCP-style names with colons/slashes and a >128-char name are capped to a valid <=128 pattern match", () => {
  const longRaw = `mcp__server::${"tool.name/with:bad-chars.".repeat(40)}`; // well over 128 chars
  assert.ok(longRaw.length > 128, "the raw name is intentionally over the cap");
  const tools: Record<string, Tool> = {
    "server:tool": makeTool("t-colon"),
    "a/b/c": makeTool("t-slash"),
    [longRaw]: makeTool("t-long"),
    "   ": makeTool("t-blank"), // only-disallowed chars -> the "tool" fallback
  };
  const { providerTools, toInternalName } = sanitizeToolNamesForProvider(tools);

  for (const name of Object.keys(providerTools)) {
    assert.match(name, PATTERN, `"${name}" must be a valid, <=128-char provider name`);
    assert.ok(name.length <= 128, `"${name}" length ${name.length} exceeds the 128 cap`);
  }

  // The blank/all-disallowed name falls back to a non-empty safe base ("tool").
  const blankProvider = Object.keys(providerTools).find((n) => toInternalName(n) === "   ");
  assert.ok(blankProvider, "the all-disallowed name still produced a provider name");
  assert.match(blankProvider ?? "", PATTERN);

  // Every internal name round-trips back exactly.
  for (const internal of Object.keys(tools)) {
    const provider = Object.keys(providerTools).find((n) => toInternalName(n) === internal);
    assert.ok(provider, `internal "${internal}" has a provider name`);
    assert.equal(toInternalName(provider ?? ""), internal, "round-trips to the exact internal name");
  }
});

test("colliding safe bases stay a bijection: no tool is lost and no two internals collapse onto one name", () => {
  // Three DIFFERENT internal names that all collapse to the same safe base `files_write`, plus a
  // pre-existing `files_write` — four internals, four DISTINCT provider names.
  const tools: Record<string, Tool> = {
    "files.write": makeTool("a"),
    "files/write": makeTool("b"),
    "files:write": makeTool("c"),
    files_write: makeTool("d"),
  };
  const { providerTools, toInternalName } = sanitizeToolNamesForProvider(tools);

  const providerNames = Object.keys(providerTools);
  assert.equal(providerNames.length, 4, "one provider name per internal name (nothing merged/dropped)");
  assert.equal(new Set(providerNames).size, 4, "all four provider names are distinct");
  for (const name of providerNames) assert.match(name, PATTERN);

  // The reverse map is total and injective: each provider name maps to a DISTINCT internal name, and
  // every internal name is reachable.
  const reversed = providerNames.map(toInternalName);
  assert.equal(new Set(reversed).size, 4, "each provider name reverses to a distinct internal name");
  assert.deepEqual([...reversed].sort(), Object.keys(tools).sort());

  // The first-claimed base keeps the bare `files_write`; the collisions take deterministic suffixes.
  assert.ok(providerNames.includes("files_write"), "the first entry claims the bare safe base");
  assert.ok(
    providerNames.some((n) => /^files_write_\d+$/.test(n)),
    "collisions disambiguate with a numeric suffix",
  );
});

test("deterministic: the same input map always produces the same provider names and reverse mapping", () => {
  const build = (): Record<string, Tool> => ({
    "files.write": makeTool("a"),
    "files/write": makeTool("b"),
    "files:write": makeTool("c"),
    "artifacts.create": makeTool("d"),
  });
  const first = sanitizeToolNamesForProvider(build());
  const second = sanitizeToolNamesForProvider(build());
  assert.deepEqual(Object.keys(first.providerTools), Object.keys(second.providerTools));
  for (const name of Object.keys(first.providerTools)) {
    assert.equal(first.toInternalName(name), second.toInternalName(name));
  }
});

test("an already-valid toolset is passed through unchanged (no needless renaming)", () => {
  const tools: Record<string, Tool> = {
    echo: makeTool("a"),
    mcp__srv__list_items: makeTool("b"),
    "read-file": makeTool("c"),
  };
  const { providerTools, toInternalName } = sanitizeToolNamesForProvider(tools);
  assert.deepEqual(Object.keys(providerTools).sort(), Object.keys(tools).sort());
  for (const name of Object.keys(tools)) assert.equal(toInternalName(name), name);
});
