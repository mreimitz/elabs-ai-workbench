import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ASSISTANT_CONDITIONAL_STARTERS,
  ASSISTANT_ENTITY_KINDS,
  ASSISTANT_STARTER_CATALOG,
  INTENTIONALLY_UNSCOPED_WRITE_TOOLS,
  SCOPE_WRITE_TOOLS,
  SKILL_TAB_STARTERS,
  buildGlobalDebugFailedScansStarter,
  resolveStarterSurface,
  type AssistantStarter,
  type AssistantStarterSurface,
} from "@mcp-token-footprint/shared";

// Assistant Refinement R3 (WP R3.1) — the REQUIRED D-AS29 guard: EVERY action starter — base sets,
// skill tab overrides, AND the data-aware conditional-starter registry (`ASSISTANT_CONDITIONAL_STARTERS`,
// which the service consumes) — must name a `writeTool` that is actually in scope for its surface, per
// `SCOPE_WRITE_TOOLS`. This is a pure cross-check over `packages/shared` exports — no DB, no fixture —
// so it lives here (packages/shared has no test runner of its own; see `assistant-scope.test.ts`, the
// existing precedent for exactly this pattern). Because `allActionStarters()` walks the conditional
// registry too, a NEW conditional action starter is auto-covered the moment it's added to the registry
// (and the service can only emit registry entries — see `deriveStarters`), so none can escape (FIX 1).

const ALL_SURFACES: AssistantStarterSurface[] = [
  "global",
  "compatibility",
  "hub",
  "agents",
  ...ASSISTANT_ENTITY_KINDS,
];

function allActionStarters(): Array<{ surface: string; starter: AssistantStarter }> {
  const out: Array<{ surface: string; starter: AssistantStarter }> = [];
  for (const surface of ALL_SURFACES) {
    for (const starter of ASSISTANT_STARTER_CATALOG[surface]) {
      if (starter.kind === "action") out.push({ surface, starter });
    }
  }
  for (const [tab, starters] of Object.entries(SKILL_TAB_STARTERS)) {
    for (const starter of starters) {
      if (starter.kind === "action") out.push({ surface: `skill.tab.${tab}`, starter });
    }
  }
  // The standalone data-aware conditional starters (their surface is carried on the registry entry, not
  // derivable from a catalog key) — including the two `kind:"action"` ones that live nowhere else.
  for (const { surface, starter } of ASSISTANT_CONDITIONAL_STARTERS) {
    if (starter.kind === "action") out.push({ surface: `conditional:${surface}`, starter });
  }
  return out;
}

test("ASSISTANT_STARTER_CATALOG has an entry for every AssistantStarterSurface (9 entity kinds + global + compatibility + hub + agents)", () => {
  const keys = Object.keys(ASSISTANT_STARTER_CATALOG).sort();
  assert.deepEqual(keys, [...ALL_SURFACES].sort());
});

/** The real SCOPE_WRITE_TOOLS entity kind behind a walk label (`skill.tab.<x>` → skill,
 *  `conditional:<kind>` → kind, otherwise the label IS the surface). */
function surfaceEntityKind(surface: string): string {
  if (surface.startsWith("skill.tab.")) return "skill";
  if (surface.startsWith("conditional:")) return surface.slice("conditional:".length);
  return surface;
}

test("D-AS29: every action starter (base + tab overrides + conditional registry) has a writeTool in scope for its surface", () => {
  for (const { surface, starter } of allActionStarters()) {
    assert.ok(
      starter.writeTool,
      `${surface}/${starter.id} is kind:"action" but carries no writeTool`,
    );
    const entityKind = surfaceEntityKind(surface);
    assert.ok(
      (entityKind as string) in SCOPE_WRITE_TOOLS,
      `${surface}/${starter.id}: "${entityKind}" has no SCOPE_WRITE_TOOLS entry at all (must be an entity kind)`,
    );
    const allowed = SCOPE_WRITE_TOOLS[entityKind as keyof typeof SCOPE_WRITE_TOOLS];
    assert.ok(
      allowed.includes(starter.writeTool as string),
      `${surface}/${starter.id}: writeTool "${starter.writeTool}" is not in SCOPE_WRITE_TOOLS.${entityKind} (${JSON.stringify(allowed)})`,
    );
  }
});

test("D-AS29: no catalog action starter names a write tool from INTENTIONALLY_UNSCOPED_WRITE_TOOLS", () => {
  for (const { surface, starter } of allActionStarters()) {
    assert.ok(
      !INTENTIONALLY_UNSCOPED_WRITE_TOOLS.includes(starter.writeTool as string),
      `${surface}/${starter.id} names "${starter.writeTool}", which is deliberately unreachable in every scope`,
    );
  }
});

test("D-AS29: the non-entity surfaces (global, compatibility, hub, agents) carry ZERO action starters", () => {
  for (const surface of ["global", "compatibility", "hub", "agents"] as const) {
    const actions = ASSISTANT_STARTER_CATALOG[surface].filter((s) => s.kind === "action");
    assert.deepEqual(
      actions,
      [],
      `${surface} must be analysis-only (no entity to scope a write to)`,
    );
  }
});

test("D-AS29: the read-only entity surfaces (run, scan, compare, suite_run) carry ZERO action starters", () => {
  for (const kind of ["run", "scan", "compare", "suite_run"] as const) {
    const actions = ASSISTANT_STARTER_CATALOG[kind].filter((s) => s.kind === "action");
    assert.deepEqual(
      actions,
      [],
      `SCOPE_WRITE_TOOLS.${kind} is empty, so ${kind} must offer no action starters`,
    );
  }
});

test("D-AS29 (FIX 1): the conditional-starter registry's action starters are scope-checked, and cover the two known skill actions", () => {
  const conditionalActions = ASSISTANT_CONDITIONAL_STARTERS.filter(
    (e) => e.starter.kind === "action",
  );
  // The two authored conditional action starters live ONLY in the registry (not in any catalog base
  // set / tab override), so this is where they get scope-checked. Guard against them silently vanishing.
  const ids = conditionalActions.map((e) => e.starter.id).sort();
  assert.deepEqual(ids, ["skill.fix-quality-findings", "skill.split-oversized-body"]);
  for (const { surface, starter } of conditionalActions) {
    assert.equal(
      surface,
      "skill",
      `${starter.id} conditional action must sit on an entity surface with matching write scope`,
    );
    assert.ok(
      SCOPE_WRITE_TOOLS.skill.includes(starter.writeTool as string),
      `${starter.id}: writeTool "${starter.writeTool}" not in SCOPE_WRITE_TOOLS.skill`,
    );
    assert.ok(
      !INTENTIONALLY_UNSCOPED_WRITE_TOOLS.includes(starter.writeTool as string),
      `${starter.id} names an intentionally-unscoped tool`,
    );
  }
});

test("every conditional-registry entry sits on a surface that owns starters and carries a unique id vs the whole catalog", () => {
  const validSurfaces = new Set<string>(ALL_SURFACES);
  for (const { surface } of ASSISTANT_CONDITIONAL_STARTERS) {
    assert.ok(
      validSurfaces.has(surface),
      `conditional registry references unknown surface "${surface}"`,
    );
  }
  // Conditional ids must not collide with each other (a duplicate would make the service's registry
  // Map silently drop one).
  const ids = ASSISTANT_CONDITIONAL_STARTERS.map((e) => e.starter.id);
  assert.equal(new Set(ids).size, ids.length, "duplicate conditional starter id");
});

test("every action starter's writeTool is a non-empty string and every analysis starter carries none", () => {
  for (const surface of ALL_SURFACES) {
    for (const starter of ASSISTANT_STARTER_CATALOG[surface]) {
      if (starter.kind === "action") {
        assert.ok(
          typeof starter.writeTool === "string" && starter.writeTool.length > 0,
          `${starter.id} action starter needs a writeTool`,
        );
      } else {
        assert.equal(
          starter.writeTool,
          undefined,
          `${starter.id} is analysis-only but carries a writeTool`,
        );
      }
    }
  }
});

test("every starter id is globally unique across the base catalog + tab variants", () => {
  const ids = new Set<string>();
  const dupes: string[] = [];
  for (const surface of ALL_SURFACES) {
    for (const starter of ASSISTANT_STARTER_CATALOG[surface]) {
      if (ids.has(starter.id)) dupes.push(starter.id);
      ids.add(starter.id);
    }
  }
  for (const starters of Object.values(SKILL_TAB_STARTERS)) {
    for (const starter of starters) {
      if (ids.has(starter.id)) dupes.push(starter.id);
      ids.add(starter.id);
    }
  }
  assert.deepEqual(dupes, []);
});

test("every starter has a non-empty label and prompt (prefill text, never blank)", () => {
  for (const surface of ALL_SURFACES) {
    for (const starter of ASSISTANT_STARTER_CATALOG[surface]) {
      assert.ok(starter.label.trim().length > 0, `${starter.id} needs a label`);
      assert.ok(starter.prompt.trim().length > 0, `${starter.id} needs prompt text`);
    }
  }
});

test("test surface has no authored base starters (test/environment writes belong on the scenario/Environment page)", () => {
  assert.deepEqual(ASSISTANT_STARTER_CATALOG.test, []);
});

// ── resolveStarterSurface ─────────────────────────────────────────────────────────────────────────

test("resolveStarterSurface: a valid pinned entityKind wins outright, for every one of the 9 kinds", () => {
  for (const kind of ASSISTANT_ENTITY_KINDS) {
    assert.equal(resolveStarterSurface({ entityKind: kind }), kind);
  }
});

test("resolveStarterSurface: entityKind wins over a conflicting route", () => {
  assert.equal(
    resolveStarterSurface({ entityKind: "skill", route: "/testing/compatibility" }),
    "skill",
  );
  assert.equal(resolveStarterSurface({ entityKind: "server", route: "/compare/scans" }), "server");
});

test("resolveStarterSurface: an unrecognized entityKind string falls through to route/global", () => {
  assert.equal(resolveStarterSurface({ entityKind: "not-a-real-kind" }), "global");
  assert.equal(
    resolveStarterSurface({ entityKind: "not-a-real-kind", route: "/testing/compatibility" }),
    "compatibility",
  );
});

test("resolveStarterSurface: compare routes (canonical + redirect sources) resolve to compare", () => {
  for (const route of ["/compare/scans", "/compare", "/testing/runs/compare", "/testing/compare"]) {
    assert.equal(resolveStarterSurface({ route }), "compare", route);
  }
  // Trailing slash tolerated.
  assert.equal(resolveStarterSurface({ route: "/compare/scans/" }), "compare");
});

test("resolveStarterSurface: the compatibility route resolves to compatibility", () => {
  assert.equal(resolveStarterSurface({ route: "/testing/compatibility" }), "compatibility");
  assert.equal(resolveStarterSurface({ route: "/testing/compatibility/" }), "compatibility");
});

test("resolveStarterSurface: /testing/environments (no entity pin today) falls through to global, not scenario", () => {
  assert.equal(resolveStarterSurface({ route: "/testing/environments" }), "global");
});

test("resolveStarterSurface: an unmatched route, or no route/entityKind at all, resolves to global", () => {
  assert.equal(resolveStarterSurface({ route: "/servers/srv-1" }), "global");
  assert.equal(resolveStarterSurface({}), "global");
});

// ── buildGlobalDebugFailedScansStarter (the one dynamic-text conditional) ────────────────────────────

test("buildGlobalDebugFailedScansStarter pluralizes correctly and stays deterministic for the same count", () => {
  const one = buildGlobalDebugFailedScansStarter(1);
  assert.match(one.prompt, /^1 server's/);
  const three = buildGlobalDebugFailedScansStarter(3);
  assert.match(three.prompt, /^3 servers'/);
  assert.deepEqual(buildGlobalDebugFailedScansStarter(3), three);
});
