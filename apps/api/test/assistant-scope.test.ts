import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ASSISTANT_ENTITY_KINDS,
  INTENTIONALLY_UNSCOPED_WRITE_TOOLS,
  SCOPE_EXEMPT_ACTION_TOOLS,
  SCOPE_WRITE_TOOLS,
  WRITE_TOOL_TARGETS,
  deriveAssistantScope,
  describeScopeDenial,
  isScopeExemptActionTool,
  isWriteToolInScope,
  type AssistantContextEnvelope,
  type AssistantScope,
} from "@mcp-token-footprint/shared";
import { ASSISTANT_ACTION_WRITE_TOOL_NAMES } from "../src/assistant/tools/action-tools.js";
import { ASSISTANT_HUB_WRITE_TOOL_NAMES } from "../src/assistant/tools/hub-write-tools.js";
import { ASSISTANT_NATIVE_WRITE_TOOL_NAMES } from "../src/assistant/permission-classifier.js";
import { ASSISTANT_WRITE_TOOL_NAMES } from "../src/assistant/tools/write-tools.js";
import { ASSISTANT_WORKSPACE_TOOL_NAMES } from "../src/assistant/tools/workspace-tools.js";

// Assistant Refinement R1 (WP R1.1) — the pure, SDK-free page-scope helpers (D-AS19). These are the
// authoritative predicate the API's per-message `canUseTool` guard calls; the session-manager
// end-to-end proof lives in `assistant-permission.test.ts`.

// ── The complete write/workspace tool inventory (the SoT for coverage) ────────────────────────────
// Sourced from the ACTUAL registered tool-name constants, so a future write tool is caught by the
// coverage test below unless it is ALSO mapped into SCOPE_WRITE_TOOLS.
const ALL_WRITE_TOOLS = [...ASSISTANT_WRITE_TOOL_NAMES, ...ASSISTANT_WORKSPACE_TOOL_NAMES];

function scope(
  entityKind: NonNullable<AssistantScope>["entityKind"],
  entityId: string,
): AssistantScope {
  return { entityKind, entityId };
}

// ── deriveAssistantScope ──────────────────────────────────────────────────────────────────────────

test("deriveAssistantScope returns the {kind,id} pair only when BOTH are pinned", () => {
  const env: AssistantContextEnvelope = {
    route: "/skills/s1",
    entityKind: "skill",
    entityId: "s1",
  };
  assert.deepEqual(deriveAssistantScope(env), { entityKind: "skill", entityId: "s1" });
});

test("deriveAssistantScope returns null for undefined / kind-only / id-only / empty-id envelopes", () => {
  assert.equal(deriveAssistantScope(undefined), null);
  assert.equal(
    deriveAssistantScope({ route: "/testing/environments", entityKind: "scenario" }),
    null,
  );
  assert.equal(
    deriveAssistantScope({ route: "/x", entityId: "id-only" } as AssistantContextEnvelope),
    null,
  );
  assert.equal(deriveAssistantScope({ route: "/x", entityKind: "skill", entityId: "" }), null);
});

// ── SCOPE_WRITE_TOOLS shape + coverage ────────────────────────────────────────────────────────────

test("SCOPE_WRITE_TOOLS has an entry for every one of the 9 entity kinds", () => {
  for (const kind of ASSISTANT_ENTITY_KINDS) {
    assert.ok(
      Array.isArray(SCOPE_WRITE_TOOLS[kind]),
      `missing SCOPE_WRITE_TOOLS entry for "${kind}"`,
    );
  }
  assert.deepEqual(Object.keys(SCOPE_WRITE_TOOLS).sort(), [...ASSISTANT_ENTITY_KINDS].sort());
});

test("the read-only surfaces (run, scan, compare, suite_run) allow NO writes", () => {
  assert.deepEqual(SCOPE_WRITE_TOOLS.run, []);
  assert.deepEqual(SCOPE_WRITE_TOOLS.scan, []);
  assert.deepEqual(SCOPE_WRITE_TOOLS.compare, []);
  // R1.1 review finding 1: suite_run is a RUN of a suite (analysis surface), not the suite definition,
  // so it writes nothing — suites_* are intentionally unreachable until a `suite` entity kind exists.
  assert.deepEqual(SCOPE_WRITE_TOOLS.suite_run, []);
});

test("EVERY registered write/workspace tool is either mapped into a scope OR intentionally unscoped (forgotten-tool guard)", () => {
  const mapped = new Set(Object.values(SCOPE_WRITE_TOOLS).flat());
  const deliberatelyUnscoped = new Set(INTENTIONALLY_UNSCOPED_WRITE_TOOLS);
  for (const name of ALL_WRITE_TOOLS) {
    assert.ok(
      mapped.has(name) || deliberatelyUnscoped.has(name),
      `write tool "${name}" is neither in a SCOPE_WRITE_TOOLS entry nor INTENTIONALLY_UNSCOPED_WRITE_TOOLS — it would silently escape the scope lock`,
    );
  }
  // The exact 17-name inventory the R1.1 brief enumerates (2 workspace + 15 app-data writes).
  assert.equal(ALL_WRITE_TOOLS.length, 17);
  // Every intentionally-unscoped name is a REAL write tool (no stale exemptions) and is NOT also mapped
  // (an exemption that's also mapped would be a contradiction hiding a live grant).
  for (const name of INTENTIONALLY_UNSCOPED_WRITE_TOOLS) {
    assert.ok(
      ALL_WRITE_TOOLS.includes(name),
      `INTENTIONALLY_UNSCOPED_WRITE_TOOLS names non-tool "${name}"`,
    );
    assert.ok(
      !mapped.has(name),
      `"${name}" is both scope-mapped and intentionally-unscoped — pick one`,
    );
  }
});

test("no registered write tool collides with a native file-write tool name (Edit/Write/MultiEdit)", () => {
  // R1.1 review finding 4: the scope guard exempts the SDK native writes (Edit/Write/MultiEdit) from the
  // entity-scope allowlist. If an in-process MCP write tool were ever named identically, it would inherit
  // that exemption and bypass the scope lock. Assert the two name spaces never intersect.
  for (const name of ALL_WRITE_TOOLS) {
    assert.ok(
      !ASSISTANT_NATIVE_WRITE_TOOL_NAMES.has(name),
      `write tool "${name}" collides with a native file-write tool name`,
    );
  }
});

test("no SCOPE_WRITE_TOOLS entry names a tool that isn't a real registered write/workspace tool", () => {
  const known = new Set<string>(ALL_WRITE_TOOLS);
  for (const [kind, tools] of Object.entries(SCOPE_WRITE_TOOLS)) {
    for (const name of tools) {
      assert.ok(known.has(name), `SCOPE_WRITE_TOOLS.${kind} names unknown tool "${name}"`);
    }
  }
});

// ── SCOPE_EXEMPT_ACTION_TOOLS (the cross-entity action tools) ────────────────────────────────────────

// The full scope-exempt WRITE inventory (apps/api): the cross-entity action tools UNION the WP 5.1
// Hub write action tools (D-AO7). This is the SoT the shared exemption allowlist must match exactly.
const ALL_SCOPE_EXEMPT_WRITE_TOOLS = [
  ...ASSISTANT_ACTION_WRITE_TOOL_NAMES,
  ...ASSISTANT_HUB_WRITE_TOOL_NAMES,
];

test("SCOPE_EXEMPT_ACTION_TOOLS set-equals the registered action + Hub WRITE tool names (union)", () => {
  // The exemption allowlist (shared) must match the actual gated action-tool inventory (apps/api) — so a
  // new action/Hub write tool can't silently get the scope-exemption, and a stale exemption can't linger.
  assert.deepEqual(
    [...SCOPE_EXEMPT_ACTION_TOOLS].sort(),
    [...ALL_SCOPE_EXEMPT_WRITE_TOOLS].sort(),
  );
});

test("isScopeExemptActionTool is true for the action + Hub write tools and false for every entity-config write tool", () => {
  for (const name of ALL_SCOPE_EXEMPT_WRITE_TOOLS) {
    assert.ok(isScopeExemptActionTool(name), `${name} should be scope-exempt`);
  }
  // The exemption must NOT leak to the entity-config writes (they stay page-scope-locked).
  for (const name of ALL_WRITE_TOOLS) {
    assert.ok(!isScopeExemptActionTool(name), `${name} must NOT be scope-exempt`);
  }
});

test("a scope-exempt action tool is not an entity-config write (kept out of SCOPE_WRITE_TOOLS / native writes)", () => {
  const mapped = new Set(Object.values(SCOPE_WRITE_TOOLS).flat());
  for (const name of ALL_SCOPE_EXEMPT_WRITE_TOOLS) {
    assert.ok(!mapped.has(name), `${name} must not be page-scoped — it is exempt, not entity-locked`);
    assert.ok(!ASSISTANT_NATIVE_WRITE_TOOL_NAMES.has(name), `${name} collides with a native write name`);
    assert.ok(!ALL_WRITE_TOOLS.includes(name), `${name} must not be in the app-data write inventory`);
  }
});

test("WP 5.1 (D-AO7) — the four Hub write tools are scope-exempt but NOT new entity kinds / scoped writes", () => {
  // The whole point of D-AO7: reachable from the unpinned /assistant/agents page (scope-exempt), while
  // the frozen ASSISTANT_ENTITY_KINDS / SCOPE_WRITE_TOOLS security vocabulary stays untouched (D-AO3).
  const mapped = new Set(Object.values(SCOPE_WRITE_TOOLS).flat());
  for (const name of ASSISTANT_HUB_WRITE_TOOL_NAMES) {
    assert.ok(isScopeExemptActionTool(name), `${name} must be scope-exempt (reachable while unpinned)`);
    assert.ok(!mapped.has(name), `${name} must NOT be a SCOPE_WRITE_TOOLS entry (not an entity-config write)`);
    assert.ok(
      !(ASSISTANT_ENTITY_KINDS as readonly string[]).includes(name),
      `${name} must NOT be an ASSISTANT_ENTITY_KIND — agents/crews are not scoped entity kinds (D-AO3)`,
    );
  }
  // "agent"/"crew" were never added as entity kinds (D-AO3/D-AO7 — the deferred upgrade done the low-risk way).
  assert.ok(!(ASSISTANT_ENTITY_KINDS as readonly string[]).includes("agent"));
  assert.ok(!(ASSISTANT_ENTITY_KINDS as readonly string[]).includes("crew"));
});

test("every write tool has a WRITE_TOOL_TARGETS entry, and vice versa", () => {
  for (const name of ALL_WRITE_TOOLS) {
    assert.ok(WRITE_TOOL_TARGETS[name], `WRITE_TOOL_TARGETS missing "${name}"`);
  }
  for (const name of Object.keys(WRITE_TOOL_TARGETS)) {
    assert.ok(ALL_WRITE_TOOLS.includes(name), `WRITE_TOOL_TARGETS has stale entry "${name}"`);
  }
});

// ── isWriteToolInScope — unscoped = read-only ─────────────────────────────────────────────────────

test("unscoped (scope === null) denies EVERY write/workspace tool", () => {
  for (const name of ALL_WRITE_TOOLS) {
    assert.equal(
      isWriteToolInScope(name, null, {
        skillId: "s1",
        environmentId: "e",
        testId: "t",
        serverId: "sv",
        collectionId: "c",
        suiteId: "su",
      }),
      false,
      `${name} must be denied when unscoped`,
    );
  }
});

// ── isWriteToolInScope — out-of-scope (wrong page) ────────────────────────────────────────────────

test("a write not in the current scope's allowlist is denied (out of scope)", () => {
  const skill = scope("skill", "s1");
  assert.equal(isWriteToolInScope("environments_update", skill, { environmentId: "e1" }), false);
  assert.equal(isWriteToolInScope("tests_create", skill, {}), false);
  assert.equal(isWriteToolInScope("servers_update_config", skill, { serverId: "s1" }), false);
  assert.equal(isWriteToolInScope("suites_create", skill, {}), false);
  assert.equal(
    isWriteToolInScope("collections_modify", skill, {
      action: "update_metadata",
      collectionId: "s1",
    }),
    false,
  );
});

// ── isWriteToolInScope — strict id-match (self-referential same-kind) ──────────────────────────────

test("skill scope: workspace tools require input.skillId === scope.entityId (strict id-match)", () => {
  const s1 = scope("skill", "s1");
  for (const name of ["skills_open_workspace", "skills_commit_workspace"]) {
    assert.equal(isWriteToolInScope(name, s1, { skillId: "s1" }), true, `${name} same-id allowed`);
    assert.equal(
      isWriteToolInScope(name, s1, { skillId: "s2" }),
      false,
      `${name} id-mismatch denied`,
    );
    assert.equal(isWriteToolInScope(name, s1, {}), false, `${name} missing id fails closed`);
    assert.equal(
      isWriteToolInScope(name, s1, { skillId: 123 }),
      false,
      `${name} non-string id fails closed`,
    );
    assert.equal(isWriteToolInScope(name, s1, null), false, `${name} null input fails closed`);
  }
});

test("server scope: servers_update_config id-matches serverId", () => {
  const sv = scope("server", "srv-1");
  assert.equal(isWriteToolInScope("servers_update_config", sv, { serverId: "srv-1" }), true);
  assert.equal(isWriteToolInScope("servers_update_config", sv, { serverId: "srv-2" }), false);
  assert.equal(isWriteToolInScope("servers_update_config", sv, {}), false);
});

test("collection scope: collections_modify id-matches collectionId WHEN PRESENT; absent (remove_*) is allowlist-guarded", () => {
  const c1 = scope("collection", "col-1");
  assert.equal(
    isWriteToolInScope("collections_modify", c1, {
      action: "update_metadata",
      collectionId: "col-1",
    }),
    true,
  );
  assert.equal(
    isWriteToolInScope("collections_modify", c1, {
      action: "assign_test",
      collectionId: "col-2",
      testId: "t1",
    }),
    false,
    "modifying a different collection is denied",
  );
  // remove_test / remove_suite carry no collectionId — allowlist-guarded (documented child-ownership caveat).
  assert.equal(
    isWriteToolInScope("collections_modify", c1, { action: "remove_test", testId: "t1" }),
    true,
  );
  assert.equal(
    isWriteToolInScope("collections_modify", c1, { action: "remove_suite", suiteId: "su1" }),
    true,
  );
});

test("scenario scope: the environmentId-bearing tools id-match the scenario id", () => {
  const env = scope("scenario", "env-1");
  for (const name of [
    "environments_update",
    "environments_delete",
    "environments_attach_skill",
    "environments_detach_skill",
  ]) {
    assert.equal(
      isWriteToolInScope(name, env, { environmentId: "env-1" }),
      true,
      `${name} same-id allowed`,
    );
    assert.equal(
      isWriteToolInScope(name, env, { environmentId: "env-2" }),
      false,
      `${name} id-mismatch denied`,
    );
    assert.equal(isWriteToolInScope(name, env, {}), false, `${name} missing id fails closed`);
  }
  // environments_create has no id — allowlist-guarded (a create can't target an existing entity).
  assert.equal(isWriteToolInScope("environments_create", env, { name: "new" }), true);
});

test("scenario scope: child TEST tools are allowlist-guarded only (NOT id-matched against the scenario id)", () => {
  const env = scope("scenario", "env-1");
  // A test's id never equals the scenario id, but these are allowed by the allowlist (their child-id
  // ownership is a documented defense-in-depth follow-up, not a scope hole for an out-of-KIND tool).
  assert.equal(isWriteToolInScope("tests_create", env, { name: "t" }), true);
  assert.equal(isWriteToolInScope("tests_update", env, { testId: "t-99" }), true);
  assert.equal(isWriteToolInScope("tests_delete", env, { testId: "t-99" }), true);
  assert.equal(
    isWriteToolInScope("expectations_set", env, { testId: "t-99", expectations: {} }),
    true,
  );
  assert.equal(
    isWriteToolInScope("attachments_manage", env, { testId: "t-99", action: "add" }),
    true,
  );
});

test("test scope: tests_update/delete/expectations_set/attachments_manage id-match the test id", () => {
  const t = scope("test", "t-1");
  for (const name of ["tests_update", "tests_delete", "expectations_set", "attachments_manage"]) {
    assert.equal(isWriteToolInScope(name, t, { testId: "t-1" }), true, `${name} same-id allowed`);
    assert.equal(
      isWriteToolInScope(name, t, { testId: "t-2" }),
      false,
      `${name} id-mismatch denied`,
    );
    assert.equal(isWriteToolInScope(name, t, {}), false, `${name} missing id fails closed`);
  }
});

test("suite_run scope is read-only: suites_* are denied (R1.1 review finding 1 — a run page can't edit any suite)", () => {
  const sr = scope("suite_run", "sr-1");
  // A suite_run's id is a suite-RUN id, not a suiteId; allowing suites_* here let the agent create/update/
  // DELETE ANY suite from a read-only run page (and suites_update is auto-accept-eligible → silent). Now denied.
  assert.equal(isWriteToolInScope("suites_create", sr, { name: "s" }), false);
  assert.equal(isWriteToolInScope("suites_update", sr, { suiteId: "any-suite" }), false);
  assert.equal(isWriteToolInScope("suites_delete", sr, { suiteId: "any-suite" }), false);
});

test("run / scan / compare scopes deny every write (read-only surfaces)", () => {
  for (const kind of ["run", "scan", "compare"] as const) {
    const s = scope(kind, "id-1");
    for (const name of ALL_WRITE_TOOLS) {
      assert.equal(
        isWriteToolInScope(name, s, {
          skillId: "x",
          environmentId: "x",
          testId: "x",
          serverId: "x",
          collectionId: "x",
          suiteId: "x",
        }),
        false,
        `${name} must be denied in ${kind} scope`,
      );
    }
  }
});

// ── describeScopeDenial — the model-visible reason ────────────────────────────────────────────────

test("describeScopeDenial names read-only when unscoped, and the scope+tool when out of scope", () => {
  const unscoped = describeScopeDenial("environments_update", null);
  assert.match(unscoped, /read-only/i);
  assert.match(unscoped, /environments_update/);

  const outOfScope = describeScopeDenial("environments_update", scope("skill", "s1"));
  assert.match(outOfScope, /out of scope/i);
  assert.match(outOfScope, /skill s1/);
  assert.match(outOfScope, /environments_update/);
});
