import type { AssistantContextEnvelope, AssistantEntityKind } from "./types.js";

// ==================================================================================================
// Assistant Refinement R1 (WP R1.1) — the PAGE-SCOPE write lock (D-AS19)
// ==================================================================================================
// The SECURITY BOUNDARY for agent-driven WRITES. A thread's writes are confined to the ONE entity the
// owner currently has open (its context envelope's `entityKind`+`entityId`); reads stay unrestricted.
// This module is the single, pure, SDK-free source of truth for that rule, imported by BOTH sides:
//   - `apps/api/src/assistant/session-manager.ts` (`handlePermission`, the `canUseTool` choke point)
//     calls `isWriteToolInScope` PER MESSAGE using the CURRENT envelope's scope, BEFORE the approval /
//     auto-accept branch — so an out-of-scope write is hard-denied and CANNOT be rescued by auto-accept
//     or an owner "allow". Tools are built once per session, so build-time filtering alone is NOT
//     enough; the per-message runtime guard here is the authoritative one.
//   - `apps/web/src/features/assistant/assistant-context.tsx` derives the same envelope client-side.
//
// Why the write-tool inventory lives here (and not only in apps/api): both ends need to reason about
// "is this write allowed on this page" without importing the SDK-bound tool factory. The apps/api tool
// registry (`ASSISTANT_WRITE_TOOL_NAMES` + `ASSISTANT_WORKSPACE_TOOL_NAMES`) is tied back to this map by
// a test (`apps/api/test/assistant-scope.test.ts`) so a future write tool that is forgotten here fails
// LOUDLY rather than silently escaping the scope lock.
//
// VERIFIED against the real tool schemas at R1.1 time (not assumed from the plan):
//   - `apps/api/src/assistant/tools/write-tools.ts` — the 15 app-data write tools + their exact zod
//     input field names (`testId`, `environmentId`, `serverId`, `collectionId`, `suiteId`).
//   - `apps/api/src/assistant/tools/workspace-tools.ts` — the 2 skill-workspace tools (`skillId`).

/**
 * A thread's derived write scope: the single entity its writes are confined to, or `null` when no
 * entity is pinned (read-only). DERIVED from the current message's context envelope — never persisted
 * (no migration; the scope is recomputed every message from the envelope the client sends).
 */
export type AssistantScope = { entityKind: AssistantEntityKind; entityId: string } | null;

/**
 * For EACH of the 9 {@link ASSISTANT_ENTITY_KINDS}, the WRITE/workspace tools allowed when a page of
 * that entity kind is the current scope. Grounded in the ACTUAL tool names (verified against
 * `write-tools.ts` / `workspace-tools.ts`). The analysis-only surfaces (`run`, `scan`, `compare`) get
 * an EMPTY list — they are read-only by design, so every write is denied there (belt-and-braces on top
 * of the fact that no write tool self-references those kinds anyway).
 *
 * `scenario` is the WIRE name for what the UI labels "Environment" (Testing-IA rename is UI-label-only,
 * wire frozen — see CLAUDE.md §1). `tests_create` belongs to `scenario` scope (it makes a NEW test in
 * an environment), NOT `test` scope (a test-scoped page edits THAT test).
 *
 * `suite_run` is DELIBERATELY read-only (empty), and the `suites_*` write tools are therefore
 * INTENTIONALLY UNREACHABLE — see {@link INTENTIONALLY_UNSCOPED_WRITE_TOOLS}. A `suite_run` page shows a
 * RUN of a suite (an analysis surface), not the suite DEFINITION; a suite_run's entityId is a suite-RUN
 * id, not a suite id, so mapping `suites_*` here would let the agent create/update/DELETE *any* suite
 * from a read-only run page — an out-of-entity write the R1.1 review (finding 1) flagged as a real
 * scope-lock breach (and `suites_update` is auto-accept-eligible → could run silently). Editing a suite
 * via the assistant is deferred until a proper `suite` entity kind + id-matched pin exists (a change to
 * the frozen `ASSISTANT_ENTITY_KINDS` vocabulary — a D-AS7 decision, owner-gated).
 */
export const SCOPE_WRITE_TOOLS: Record<AssistantEntityKind, readonly string[]> = {
  skill: ["skills_open_workspace", "skills_commit_workspace"],
  scenario: [
    "environments_create",
    "environments_update",
    "environments_delete",
    "environments_attach_skill",
    "environments_detach_skill",
    "tests_create",
    "tests_update",
    "tests_delete",
    "expectations_set",
    "attachments_manage",
  ],
  test: ["tests_update", "tests_delete", "expectations_set", "attachments_manage"],
  server: ["servers_update_config"],
  collection: ["collections_modify"],
  suite_run: [],
  run: [],
  scan: [],
  compare: [],
} as const;

/**
 * Write tools that are DELIBERATELY not mapped into any {@link SCOPE_WRITE_TOOLS} entry, so they are
 * unreachable in EVERY scope (the agent can never invoke them until a suitable pin exists). This is a
 * FAIL-CLOSED gap, not an oversight: it lets the "forgotten-tool" coverage test stay strict (every
 * registered write tool must be either mapped OR listed here) while `suites_*` wait for a `suite`
 * entity kind (see {@link SCOPE_WRITE_TOOLS}'s note). Removing a name from here without adding it to a
 * scope map makes the coverage test fail loudly — exactly the intended guardrail.
 */
export const INTENTIONALLY_UNSCOPED_WRITE_TOOLS: readonly string[] = [
  "suites_create",
  "suites_update",
  "suites_delete",
] as const;

/**
 * Cross-entity ACTION tools that are DELIBERATELY exempt from the page-scope write lock — they are
 * reachable from ANY page (or with no entity pinned), unlike the entity-CONFIG write tools above.
 * They are still `write`-classified, so they still go through the normal approval / auto-accept
 * round-trip ({@link import("../../apps/api/src/assistant/session-manager.js")} `handlePermission`);
 * only the scope hard-deny is skipped for them.
 *
 * The rationale for the exemption (owner-decided — the "narrow exemption" option): these are not edits
 * to the open entity's configuration but external / append-only / library ACTIONS whose usefulness
 * depends on being available while the owner is looking at a DIFFERENT entity (or none at all):
 *   - `mcp_tool_call` — invoke a registered MCP server's tool (measured, output untrusted). The owner
 *     analyzing a run must be able to exercise the server the run used, not only from the server's page.
 *   - `rating_issue_file` — file a rating issue AGAINST the skill / MCP server a run used. The canonical
 *     flow is "analyze this session → file an issue against the skill it loaded", which is inherently
 *     cross-entity (the pinned page is the run, the target is the skill). Append-only + reversible
 *     (issues resolve), never a config mutation.
 *   - `hub_agent_create` / `hub_agent_update` / `hub_crew_create` / `hub_crew_update` (WP 5.1, D-AO7) —
 *     create/edit an Assistant Hub agent role or saved crew. The owner-hit trigger is `/assistant/agents`,
 *     a DELIBERATELY unpinned Hub page (agents/crews are NOT one of the frozen `ASSISTANT_ENTITY_KINDS`,
 *     D-AO3), so without an exemption every such write hard-denies. These join the two above as
 *     page-scope-lock-exempt but STILL approval-gated (create/update only — no Hub delete tool exists,
 *     per D-AS4's "deletes always ask"). See `apps/api/src/assistant/tools/hub-write-tools.ts`.
 *
 * These are NOT in {@link SCOPE_WRITE_TOOLS} / {@link WRITE_TOOL_TARGETS} (they target no single fixed
 * entity id) and NOT in the app-data write inventory the scope-coverage test walks; see
 * `apps/api/src/assistant/tools/action-tools.ts` (`ASSISTANT_ACTION_WRITE_TOOL_NAMES`) and
 * `hub-write-tools.ts` (`ASSISTANT_HUB_WRITE_TOOL_NAMES`), whose UNION is kept set-equal to this by a test.
 */
export const SCOPE_EXEMPT_ACTION_TOOLS: ReadonlySet<string> = new Set<string>([
  "mcp_tool_call",
  "rating_issue_file",
  // WP 5.1 (D-AO7) — Hub create/update action tools (page-scope-lock exempt, still approval-gated).
  "hub_agent_create",
  "hub_agent_update",
  "hub_crew_create",
  "hub_crew_update",
]);

/** True when a write tool bypasses the page-scope lock (still approval-gated). See {@link SCOPE_EXEMPT_ACTION_TOOLS}. */
export function isScopeExemptActionTool(bareToolName: string): boolean {
  return SCOPE_EXEMPT_ACTION_TOOLS.has(bareToolName);
}

/**
 * Per write tool: the entity KIND it targets and (when it carries one) the input field holding THAT
 * entity's own id. A strict id-match — `input[idField] === scope.entityId` — is enforced ONLY when a
 * tool's `kind` equals the current scope's kind (a self-referential, same-kind write). This is what
 * stops an id-mismatch attack: on `skill X`, `skills_commit_workspace{skillId: Y}` is denied because
 * `Y !== X`; `skills_commit_workspace{skillId: X}` reaches the normal approval path.
 *
 * A CHILD-kind tool inside a scope (e.g. `tests_*` / `expectations_set` / `attachments_manage` under
 * `scenario` scope, whose id field is a child TEST id, not the scenario id) is intentionally NOT
 * id-matched — its `kind` (`test`) differs from the scope's (`scenario`), so the allowlist alone is its
 * guard. Full ownership verification (does this test actually belong to this scenario?) needs a DB read
 * and is out of scope for this pure shared helper — a documented defense-in-depth follow-up, NOT a hole
 * that lets an out-of-KIND tool through (the allowlist still bars, say, `servers_update_config` under
 * `scenario` scope).
 *
 * `idOptional` (only `collections_modify`): its `collectionId` is optional in the tool schema — present
 * for `update_metadata`/`assign_*` (which DO target a specific collection → id-matched), absent for
 * `remove_test`/`remove_suite` (which move a child test/suite by its own id → allowlist-guarded, same
 * child-ownership caveat as above).
 */
type WriteToolTarget = {
  kind: AssistantEntityKind;
  idField?: string;
  /** When true, a MISSING id field passes (present-only match); otherwise a missing id fails closed. */
  idOptional?: boolean;
};

export const WRITE_TOOL_TARGETS: Record<string, WriteToolTarget> = {
  // Skill workspace (WP 2.2) — self-referential same-kind, strict id-match on skillId.
  skills_open_workspace: { kind: "skill", idField: "skillId" },
  skills_commit_workspace: { kind: "skill", idField: "skillId" },
  // Servers (WP 2.3) — strict id-match on serverId.
  servers_update_config: { kind: "server", idField: "serverId" },
  // Collections (WP 2.3) — strict id-match on collectionId WHEN PRESENT (see idOptional above).
  collections_modify: { kind: "collection", idField: "collectionId", idOptional: true },
  // Environments/scenarios (WP 2.3) — the four tools carrying `environmentId` (the scenario's OWN id)
  // strict-id-match under scenario scope; `environments_create` has no id (allowlist-guarded).
  environments_create: { kind: "scenario" },
  environments_update: { kind: "scenario", idField: "environmentId" },
  environments_delete: { kind: "scenario", idField: "environmentId" },
  environments_attach_skill: { kind: "scenario", idField: "environmentId" },
  environments_detach_skill: { kind: "scenario", idField: "environmentId" },
  // Tests (WP 2.3) — target kind `test`. Under `test` scope these id-match `testId`; under `scenario`
  // scope (a different kind) they are allowlist-guarded child writes. `tests_create` has no id.
  tests_create: { kind: "test" },
  tests_update: { kind: "test", idField: "testId" },
  tests_delete: { kind: "test", idField: "testId" },
  expectations_set: { kind: "test", idField: "testId" },
  attachments_manage: { kind: "test", idField: "testId" },
  // Suites (WP 2.3) — INTENTIONALLY UNREACHABLE (see INTENTIONALLY_UNSCOPED_WRITE_TOOLS): no scope maps
  // them, so `isWriteToolInScope` never consults these targets. They are kept here only so the
  // WRITE_TOOL_TARGETS ↔ tool-inventory consistency test stays exhaustive (every registered write tool
  // has a target entry). `kind: "suite_run"` records the closest existing pin; there is no suite-DEFINITION
  // entity kind to id-match against yet (a D-AS7 change — see SCOPE_WRITE_TOOLS's note).
  suites_create: { kind: "suite_run" },
  suites_update: { kind: "suite_run" },
  suites_delete: { kind: "suite_run" },
};

/**
 * Derive a thread's write scope from the message's context envelope. Returns `{entityKind, entityId}`
 * ONLY when the envelope pins BOTH; otherwise `null` (unscoped = read-only). A defensive empty-string
 * id (the frozen wire type allows one) is treated as unpinned.
 */
export function deriveAssistantScope(
  envelope: AssistantContextEnvelope | undefined,
): AssistantScope {
  if (!envelope) return null;
  const { entityKind, entityId } = envelope;
  if (!entityKind || !entityId) return null;
  return { entityKind, entityId };
}

function readStringField(input: unknown, field: string): string | undefined {
  if (input === null || typeof input !== "object") return undefined;
  const value = (input as Record<string, unknown>)[field];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * THE authoritative write-scope predicate (security-critical). `bareToolName` is the tool's BARE name
 * (the caller strips the SDK's `mcp__<server>__` prefix first). `input` is the agent's RAW args
 * (`unknown` — narrowed defensively). Returns whether this write is permitted by the current scope:
 *
 *   1. `scope === null` → `false` — unscoped means read-only, ALL writes denied.
 *   2. `bareToolName ∉ SCOPE_WRITE_TOOLS[scope.entityKind]` → `false` — out of scope (wrong page).
 *   3. Id-match (when the tool is self-referential same-kind, i.e. its {@link WRITE_TOOL_TARGETS}
 *      `kind` equals the scope's kind AND it declares an `idField`): require `input[idField] ===
 *      scope.entityId`. A malformed/missing required id FAILS CLOSED (`false`). For `idOptional`
 *      tools a missing id passes (present-only match — see {@link WRITE_TOOL_TARGETS}).
 *   4. Otherwise (in the allowlist, and either no applicable id field or a child-kind/create tool) →
 *      `true`.
 *
 * NOTE this is a READS-are-never-gated helper: it is only ever consulted for the write/delete classes.
 * The classifier's read/ui path never reaches here (see `handlePermission`), so a read is ALWAYS
 * allowed regardless of scope.
 */
export function isWriteToolInScope(
  bareToolName: string,
  scope: AssistantScope,
  input: unknown,
): boolean {
  if (scope === null) return false;
  const allowed = SCOPE_WRITE_TOOLS[scope.entityKind];
  if (!allowed.includes(bareToolName)) return false;

  const target = WRITE_TOOL_TARGETS[bareToolName];
  // Self-referential same-kind write: enforce the id-match. (A child-kind tool — target.kind !==
  // scope.entityKind — or a create tool with no idField falls through to the allowlist-only default.)
  if (target?.idField && target.kind === scope.entityKind) {
    const id = readStringField(input, target.idField);
    if (id === undefined) return target.idOptional === true; // fail closed unless the id is optional
    return id === scope.entityId;
  }
  return true;
}

/**
 * A model-VISIBLE deny reason for an out-of-scope write, surfaced as the `canUseTool` deny `message` so
 * the agent self-corrects (and the owner sees WHY in the dock). Names the scope and the tool.
 */
export function describeScopeDenial(bareToolName: string, scope: AssistantScope): string {
  if (scope === null) {
    return (
      `Read-only: no entity is open, so writes are disabled. \`${bareToolName}\` was refused — ` +
      "ask the user to open the entity's page (e.g. a specific skill, environment, or server) to enable edits."
    );
  }
  return (
    `Out of scope: this session is working on ${scope.entityKind} ${scope.entityId}; \`${bareToolName}\` ` +
    "would modify a different entity, so it was refused — ask the user to open that entity's page first."
  );
}
