// Assistant (WP 2.1) — the write-permission CLASSIFIER (D-AS4). Pure + SDK-free so it unit-tests
// trivially and the session manager can import it without pulling in the SDK. This is the single
// source of truth for "does this tool need an approval round-trip?" — the choke point every gated
// write flows through. Future write tools (WP 2.2 skill-workspace edits, WP 2.3 app-data writes) are
// gated BY DEFAULT: a tool is only ever auto-allowed if it is explicitly a WP 1.2 read tool or a
// `ui_`/`ui.` navigation tool (WP 3.1). Everything else → `write` (or `delete`) → gate.
//
// Classification bands (see {@link ToolPermissionClass}):
//   read   → a WP 1.2 read tool (ASSISTANT_READ_TOOL_NAME_SET) OR one of the SDK's native file-READ
//            tools (ASSISTANT_NATIVE_READ_TOOL_NAMES, WP 2.2). Auto-allow, never a prompt/event.
//   ui     → a `ui_*`/`ui.*` client-side navigation tool. Auto-allow, never a prompt/event.
//   delete → a destructive tool (name matches the `_delete`/`.delete` convention, or an explicit
//            override). ALWAYS asks — even with per-thread auto-accept ON (D-AS4).
//   write  → everything else. A create/update-style write: gated, but auto-accept ON may auto-allow it.
//            Covers WP 2.2's app-data workspace tools (skills_open_workspace/skills_commit_workspace)
//            AND the SDK's native file-WRITE tools (ASSISTANT_NATIVE_WRITE_TOOL_NAMES) — both fall
//            through to this band by the SAME fail-safe default, not a special case.
import { ASSISTANT_READ_TOOL_NAME_SET } from "./tools/read-tool-names.js";

/**
 * WP 2.2 (D-AS13) — the Agent SDK's built-in FILE READ tools, verified against the installed SDK's
 * `sdk-tools.d.ts` @0.3.206 (`FileReadInput`/`GlobInput`/`GrepInput`). NOTE a drift from the WP 2.2
 * brief: this SDK version has NO separate `LS` tool — directory listing is done via `Glob` (e.g.
 * `{pattern: "*", path: dir}`), so `LS` is deliberately absent here (adding it would be a harmless
 * dead entry, but keeping the set exact-matched to reality is the point of documenting it). These
 * tools are confined by the SDK itself to the session's cwd + `additionalDirectories` (never app
 * source/DB/secrets — see `session-manager.ts`'s `startSession`), so they're as safe to auto-allow as
 * a WP 1.2 read tool.
 */
export const ASSISTANT_NATIVE_READ_TOOL_NAMES: ReadonlySet<string> = new Set([
  "Read",
  "Glob",
  "Grep",
]);

/**
 * WP 2.2 (D-AS13) — the Agent SDK's built-in FILE WRITE tools: `Edit`/`Write` have their own schemas
 * in `sdk-tools.d.ts` (`FileEditInput`/`FileWriteInput`); `MultiEdit` has no separate schema in this
 * SDK version but IS still a real, separately-dispatched tool name (confirmed against the installed
 * native CLI binary's string table alongside `Edit`/`Write`/`Bash` — see the WP 2.2 handback notes).
 * These are the agent's skill-workspace edit mechanism: same cwd+`additionalDirectories` confinement
 * as the read set above, but they MUTATE files, so they classify as an ordinary create/update `write`
 * (gated by default; auto-accept-eligible) — the SAME band a WP 1.2 app-data write gets. This set is
 * NOT consulted by {@link classifyTool} (rule 4's fallthrough already puts them in `write` — nothing
 * in {@link ASSISTANT_READ_TOOL_NAME_SET} or {@link ASSISTANT_NATIVE_READ_TOOL_NAMES} claims them, and
 * none is delete- or `ui_`-named); it exists purely so the classification is DOCUMENTED and testable
 * rather than an unlabeled accident of the fail-safe default.
 */
export const ASSISTANT_NATIVE_WRITE_TOOL_NAMES: ReadonlySet<string> = new Set([
  "Edit",
  "Write",
  "MultiEdit",
]);

/** The permission band a tool falls into — see the module banner for what each means. */
export type ToolPermissionClass = "read" | "ui" | "write" | "delete";

/**
 * Tools that ARE destructive but whose name doesn't match the {@link DESTRUCTIVE_VERB} net below. An
 * explicit, AUTHORITATIVE escape hatch so a future destructive tool can be force-classified as a
 * delete (→ always-ask) even under auto-accept. **WP 2.2/2.3 MUST add each destructive tool here (as
 * its BARE name)** — the verb net is only a defensive backstop, not the source of truth.
 *
 * WP 2.3 (D-AS3) — the five app-data delete tools (`tools/write-tools.ts`). Each ALSO matches the
 * `DESTRUCTIVE_VERB` net on its own (every name ends `_delete`), so this set is redundant-by-design
 * for these five specifically — they're still listed explicitly per the WP brief's instruction to make
 * this set authoritative rather than relying solely on the verb-net backstop. Every one of these
 * cascades real data loss on delete (verified against `db/schema.ts`'s FKs): `tests_delete` /
 * `environments_delete` cascade-delete every RUN recorded against the test/scenario;
 * `suites_delete` cascade-deletes the suite's saved membership + every suite_runs aggregate row
 * (member runs themselves are NOT deleted — `runs.suite_run_id` is deliberately not an FK).
 *
 * Deliberately NOT listed here (WP 2.3 judgment call — see `write-tools.ts`'s module banner):
 * `environments_detach_skill` and `collections_modify`'s `remove_test`/`remove_suite` actions are
 * REVERSIBLE membership/relationship changes, not data loss (the skill/test/suite itself is untouched,
 * only re-homed or unlinked) — they classify as an ordinary auto-accept-eligible `write`, same as any
 * other update.
 */
const EXPLICIT_DELETE_TOOLS: ReadonlySet<string> = new Set<string>([
  "tests_delete",
  "environments_delete",
  "suites_delete",
]);

/**
 * Destructive verbs that mark a tool as delete-class (→ ALWAYS ask, D-AS4). Case-insensitive and
 * word-bounded (by string start/end or `_`/`.`), so `skills_delete`, `purge_workspace`, `skill.destroy`,
 * and a bare `wipe` all match, but `undelete`, `deleted_at`, and `removed_count` do NOT. The net is
 * deliberately broad and FAIL-SAFE: over-matching a benign write only adds an approval prompt, whereas
 * under-matching a real delete could let auto-accept silently run it. Authoritative overrides for tools
 * that dodge the net live in {@link EXPLICIT_DELETE_TOOLS}.
 */
const DESTRUCTIVE_VERB = /(?:^|[_.])(?:delete|destroy|purge|wipe|remove|drop)(?:$|[_.])/i;

/**
 * Strip the `mcp__<server>__` prefix the Agent SDK prepends to an in-process MCP tool's name before
 * it reaches `canUseTool` (verified against the SDK `.d.ts`: "Fully-qualified MCP tool name, e.g.
 * `mcp__server__tool_name`" — the `<server>` segment is the `mcpServers` map key, `assistant-app`
 * here). Classification runs on the BARE suffix so the rules are independent of the server key. A
 * name with no such prefix (a built-in, or an already-bare name from the fake test driver) is
 * returned unchanged. Non-greedy `.+?__` matches the SHORTEST server segment, so a bare tool name
 * that itself contains single underscores (`skills_file_content`) is preserved intact.
 */
export function bareToolName(toolName: string): string {
  return toolName.replace(/^mcp__.+?__/, "");
}

/**
 * True when a tool is destructive per the case-insensitive {@link DESTRUCTIVE_VERB} net OR is in
 * {@link EXPLICIT_DELETE_TOOLS}. A delete ALWAYS asks (D-AS4), even under per-thread auto-accept.
 */
export function isDeleteTool(bareName: string): boolean {
  return DESTRUCTIVE_VERB.test(bareName) || EXPLICIT_DELETE_TOOLS.has(bareName);
}

/**
 * Classify a tool by the name `canUseTool` reports (prefixed or bare). `readToolNames` is the
 * auto-allow read allowlist (defaults to the WP 1.2 read toolset). ORDER IS FAIL-SAFE:
 *   1. read (exact, curated allowlist — the WP 1.2 app-data reads UNION the WP 2.2 native file-read
 *      tools) → auto-allow — a known read is safe regardless of its name.
 *   2. delete (destructive-verb net / explicit set) → ALWAYS ask — checked BEFORE ui so even a
 *      `ui_delete_*` can never auto-navigate a destructive action past the gate.
 *   3. ui (`ui_`/`ui.` navigation prefix) → auto-allow — WP 3.1's ui tools are navigation-ONLY (no
 *      app-data mutation); any `ui_`-named tool that mutates would be a WP 3.1 design error.
 *   4. everything else → write (gated by default) — covers WP 2.2's workspace tools AND the SDK's
 *      native file-write tools (Edit/Write/MultiEdit) alike.
 */
export function classifyTool(
  toolName: string,
  readToolNames: ReadonlySet<string> = ASSISTANT_READ_TOOL_NAME_SET,
): ToolPermissionClass {
  const bare = bareToolName(toolName);
  // 1. WP 1.2 read tools + the SDK's native file-read tools — the audited, exact auto-allow allowlist
  //    (none are destructive-named).
  if (readToolNames.has(bare) || ASSISTANT_NATIVE_READ_TOOL_NAMES.has(bare)) return "read";
  // 2. Destructive writes ALWAYS ask — BEFORE the ui check, so `ui_delete_*` can't slip through.
  if (isDeleteTool(bare)) return "delete";
  // 3. Client-side navigation (WP 3.1) — instant, navigation-only, no app-data side effect → auto-allow.
  if (bare.startsWith("ui_") || bare.startsWith("ui.")) return "ui";
  // 4. Everything else is a create/update-style WRITE → gated by default.
  return "write";
}

/** True when a class must go through an approval round-trip (a `permission_request`). */
export function requiresApproval(cls: ToolPermissionClass): boolean {
  return cls === "write" || cls === "delete";
}

/** True when per-thread auto-accept may resolve a gated write WITHOUT asking. Deletes never qualify. */
export function autoAcceptEligible(cls: ToolPermissionClass): boolean {
  return cls === "write";
}
