// Assistant Hub — the agent/crew avatar icon encoding (`parseHubIcon` / `hubLucideIconValue`).

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  HUB_ICON_LUCIDE_PREFIX,
  HUB_ICON_MAX_LENGTH,
  hubLucideIconValue,
  parseHubIcon,
} from "./hub-icon.js";
import { hubAgentRoleInputSchema, hubCrewInputSchema } from "./schemas.js";

test("parseHubIcon — empty / whitespace / nullish is 'none'", () => {
  for (const value of [undefined, null, "", "   "]) {
    assert.deepEqual(parseHubIcon(value), { kind: "none" });
  }
});

test("parseHubIcon — a data: URI is an image", () => {
  const src = "data:image/png;base64,AAAA";
  assert.deepEqual(parseHubIcon(src), { kind: "image", src });
  // Surrounding whitespace is trimmed but the data URI is preserved.
  assert.deepEqual(parseHubIcon(`  ${src}  `), { kind: "image", src });
});

test("parseHubIcon — a lucide: prefix names a glyph; a bare prefix falls back to none", () => {
  assert.deepEqual(parseHubIcon("lucide:database"), { kind: "lucide", name: "database" });
  assert.deepEqual(parseHubIcon(`${HUB_ICON_LUCIDE_PREFIX}search`), {
    kind: "lucide",
    name: "search",
  });
  assert.deepEqual(parseHubIcon("lucide:"), { kind: "none" });
  assert.deepEqual(parseHubIcon("lucide:   "), { kind: "none" });
});

test("parseHubIcon — a legacy bare token is treated as a lucide name best-effort", () => {
  assert.deepEqual(parseHubIcon("search"), { kind: "lucide", name: "search" });
  assert.deepEqual(parseHubIcon("data"), { kind: "lucide", name: "data" });
});

test("hubLucideIconValue round-trips through parseHubIcon", () => {
  const value = hubLucideIconValue("brain");
  assert.equal(value, "lucide:brain");
  assert.deepEqual(parseHubIcon(value), { kind: "lucide", name: "brain" });
});

test("the shared schemas cap an oversized icon (both role + crew)", () => {
  const oversized = "data:image/png;base64," + "A".repeat(HUB_ICON_MAX_LENGTH);
  const roleBase = {
    name: "Analyst",
    systemPrompt: "You analyze.",
    defaultModel: "claude-sonnet-4-5",
    target: "Analyze",
    expectedOutcome: "A report",
  };
  assert.ok(hubAgentRoleInputSchema.safeParse({ ...roleBase, icon: "lucide:brain" }).success);
  assert.equal(hubAgentRoleInputSchema.safeParse({ ...roleBase, icon: oversized }).success, false);

  const crewBase = { name: "Team", topology: "parallel" as const, members: [] };
  assert.ok(hubCrewInputSchema.safeParse({ ...crewBase, icon: "lucide:users" }).success);
  assert.equal(hubCrewInputSchema.safeParse({ ...crewBase, icon: oversized }).success, false);
});
