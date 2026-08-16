import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ASSISTANT_NATIVE_WRITE_TOOL_NAMES,
  autoAcceptEligible,
  bareToolName,
  classifyTool,
  isDeleteTool,
  requiresApproval,
} from "../src/assistant/permission-classifier.js";
import { ASSISTANT_READ_TOOL_NAMES } from "../src/assistant/tools/read-tool-names.js";
import { ASSISTANT_HUB_WRITE_TOOL_NAMES } from "../src/assistant/tools/hub-write-tools.js";
import {
  ASSISTANT_ISSUE_LOOP_ACTION_TOOL_NAMES,
  ASSISTANT_ISSUE_LOOP_READ_TOOL_NAMES,
  isIssueLoopActionTool,
} from "../src/assistant/tools/issue-loop-tools.js";

// Assistant (WP 2.1) — the write-permission classifier: pure, SDK-free. This is the choke point every
// gated write flows through, so it's exercised at the unit level exhaustively (the round-trip is
// tested separately in assistant-permission.test.ts).

test("bareToolName strips the SDK's mcp__<server>__ prefix, preserving single underscores in the tool name", () => {
  assert.equal(bareToolName("mcp__assistant-app__runs_get"), "runs_get");
  assert.equal(bareToolName("mcp__assistant-app__skills_file_content"), "skills_file_content");
  // A server key that itself contains an underscore (non-greedy match stops at the first `__` boundary).
  assert.equal(bareToolName("mcp__plugin_docs__doc_export"), "doc_export");
  // A name with no MCP prefix (a built-in, or a bare name from the fake test driver) is unchanged.
  assert.equal(bareToolName("runs_get"), "runs_get");
  assert.equal(bareToolName("ui_navigate"), "ui_navigate");
});

test("every WP 1.2 read tool classifies as `read` (auto-allow), prefixed or bare", () => {
  for (const name of ASSISTANT_READ_TOOL_NAMES) {
    assert.equal(classifyTool(name), "read", `${name} bare should be read`);
    assert.equal(
      classifyTool(`mcp__assistant-app__${name}`),
      "read",
      `${name} prefixed should be read`,
    );
  }
});

test("ui_* / ui.* navigation tools classify as `ui` (auto-allow)", () => {
  assert.equal(classifyTool("ui_navigate"), "ui");
  assert.equal(classifyTool("ui.open_run_turn"), "ui");
  assert.equal(classifyTool("mcp__assistant-app__ui_open_skill"), "ui");
});

test("an unknown/create/update tool classifies as `write` (gated by default)", () => {
  assert.equal(classifyTool("mcp__assistant-app__skills_commit_workspace"), "write");
  assert.equal(classifyTool("mcp__assistant-app__tests_create"), "write");
  assert.equal(classifyTool("mcp__assistant-app__environments_update"), "write");
  // A tool nobody has seen before is a write — gated, never silently allowed.
  assert.equal(classifyTool("mcp__assistant-app__totally_new_tool"), "write");
});

test("the cross-entity action WRITE tools classify as `write` (gated, auto-accept-eligible), not delete", () => {
  for (const name of ["mcp_tool_call", "rating_issue_file"]) {
    assert.equal(classifyTool(`mcp__assistant-app__${name}`), "write", `${name} should be write`);
    assert.equal(classifyTool(name), "write");
    assert.equal(isDeleteTool(name), false, `${name} must not trip the destructive-verb net`);
    assert.equal(autoAcceptEligible(classifyTool(name)), true, `${name} should be auto-accept-eligible`);
    assert.equal(requiresApproval(classifyTool(name)), true, `${name} should require approval`);
  }
});

test("WP 5.1 (D-AO7) — the four Hub WRITE tools classify as gated `write` (approval-required), never read/ui/delete", () => {
  // The security posture: these are scope-EXEMPT (reachable from the unpinned Hub page) but must STILL go
  // through the D-AS4 approval round-trip. They are NOT in ASSISTANT_READ_TOOL_NAMES (adding them there
  // would auto-allow a write — a hole), not `ui_`-prefixed, and no create/update verb trips the delete
  // net — so the classifier's fail-safe default fallthrough classifies each as `write`.
  const readSet = new Set<string>(ASSISTANT_READ_TOOL_NAMES);
  for (const name of ASSISTANT_HUB_WRITE_TOOL_NAMES) {
    assert.equal(readSet.has(name), false, `${name} must NOT be in the read auto-allow allowlist`);
    assert.equal(classifyTool(`mcp__assistant-app__${name}`), "write", `${name} prefixed should be write`);
    assert.equal(classifyTool(name), "write", `${name} bare should be write`);
    assert.notEqual(classifyTool(name), "read", `${name} must not auto-allow as a read`);
    assert.notEqual(classifyTool(name), "ui", `${name} is not a navigation tool`);
    assert.equal(isDeleteTool(name), false, `${name} must not trip the destructive-verb net`);
    assert.equal(requiresApproval(classifyTool(name)), true, `${name} requires approval`);
    assert.equal(autoAcceptEligible(classifyTool(name)), true, `${name} is auto-accept-eligible like any write`);
  }
});

test("WP5.4 — the issue-loop READ tools auto-allow; its ACTION tools are gated `write` (approval-required, not delete)", () => {
  // The three read tools are in ASSISTANT_READ_TOOL_NAMES, so the read-classification sweep above already
  // covers them; assert explicitly here too so the loop's read/write split is documented in one place.
  for (const name of ASSISTANT_ISSUE_LOOP_READ_TOOL_NAMES) {
    assert.equal(classifyTool(name), "read", `${name} should auto-allow`);
    assert.equal(classifyTool(`mcp__assistant-app__${name}`), "read");
    assert.equal(isIssueLoopActionTool(name), false, `${name} is a read, not a scope-exempt action`);
  }
  // The three gated action tools classify as ordinary `write` via the D-AS4 default fallthrough — gated
  // + auto-accept-eligible, NEVER delete. `runs_rerun`/`issues_update`/`tests_create_draft` must not trip
  // the destructive-verb net (no `delete`/`remove`/… segment).
  for (const name of ASSISTANT_ISSUE_LOOP_ACTION_TOOL_NAMES) {
    assert.equal(classifyTool(`mcp__assistant-app__${name}`), "write", `${name} should be a gated write`);
    assert.equal(classifyTool(name), "write");
    assert.equal(isDeleteTool(name), false, `${name} must not trip the destructive-verb net`);
    assert.equal(requiresApproval(classifyTool(name)), true, `${name} requires approval`);
    assert.equal(isIssueLoopActionTool(name), true, `${name} is a scope-exempt issue-loop action`);
  }
});

test("delete-named tools classify as `delete` (always ask, even under auto-accept)", () => {
  assert.equal(classifyTool("mcp__assistant-app__skills_delete"), "delete");
  assert.equal(classifyTool("mcp__assistant-app__delete_scan"), "delete");
  assert.equal(classifyTool("scan.delete"), "delete");
  assert.equal(classifyTool("delete"), "delete");
});

test("isDeleteTool matches the _delete/.delete convention but not lookalikes", () => {
  assert.equal(isDeleteTool("skills_delete"), true);
  assert.equal(isDeleteTool("delete_skill"), true);
  assert.equal(isDeleteTool("skill.delete"), true);
  assert.equal(isDeleteTool("delete"), true);
  // Lookalikes that are NOT destructive-by-name must not be force-classified as deletes.
  assert.equal(isDeleteTool("deleted_at"), false);
  assert.equal(isDeleteTool("undelete_run"), false);
  assert.equal(isDeleteTool("runs_get"), false);
  assert.equal(isDeleteTool("removed_count"), false);
});

test("isDeleteTool is case-insensitive and catches destructive synonyms (W5 review — fail-safe net)", () => {
  // Case-insensitive: an uppercase delete tool can't dodge the always-ask guard.
  assert.equal(isDeleteTool("skills_DELETE"), true);
  assert.equal(isDeleteTool("Delete_Scan"), true);
  // Destructive synonyms beyond the `delete` convention.
  for (const name of [
    "purge_workspace",
    "skill.destroy",
    "wipe_all",
    "remove_member",
    "drop_index",
  ]) {
    assert.equal(isDeleteTool(name), true, `${name} should be a delete`);
  }
  // Still bounded — a synonym embedded in a larger word is not destructive.
  assert.equal(isDeleteTool("removed_count"), false);
  assert.equal(isDeleteTool("dropdown_config"), false);
});

test("a ui_-prefixed destructive tool is `delete` (always ask) — the delete guard runs before ui (W5 review)", () => {
  // A ui_delete_* must NOT slip through the ui auto-allow: the delete guard is checked first.
  assert.equal(classifyTool("ui_delete_thread"), "delete");
  assert.equal(classifyTool("mcp__assistant-app__ui_purge_history"), "delete");
  // A genuine navigation ui tool is still auto-allowed.
  assert.equal(classifyTool("ui_navigate"), "ui");
});

test("WP 2.2 — the SDK's native file-READ tools (Read/Glob/Grep) auto-allow, same as a WP 1.2 read tool", () => {
  for (const name of ["Read", "Glob", "Grep"]) {
    assert.equal(classifyTool(name), "read", `${name} should auto-allow`);
  }
  // Native built-ins are never MCP-prefixed by the SDK, but bareToolName is a no-op on them anyway.
  assert.equal(bareToolName("Read"), "Read");
});

test("WP 2.2 — there is no native `LS` tool in the installed SDK version (drift from the plan): it does NOT auto-allow", () => {
  // Directory listing is done via Glob in this SDK version; a stray `LS` string must fall through to
  // the fail-safe default (gated), never silently auto-allowed by an assumption that doesn't hold.
  assert.equal(classifyTool("LS"), "write");
});

test("WP 2.2 — the SDK's native file-WRITE tools (Edit/Write/MultiEdit) classify as an ordinary `write` (auto-accept-eligible, gated by default)", () => {
  for (const name of ASSISTANT_NATIVE_WRITE_TOOL_NAMES) {
    assert.equal(classifyTool(name), "write", `${name} should classify as write`);
    assert.equal(autoAcceptEligible("write"), true);
    assert.equal(requiresApproval("write"), true);
  }
});

test("WP 2.2 — the workspace tools (skills_open_workspace/skills_commit_workspace) classify as `write` like any other app-data write", () => {
  assert.equal(classifyTool("mcp__assistant-app__skills_open_workspace"), "write");
  assert.equal(classifyTool("mcp__assistant-app__skills_commit_workspace"), "write");
  assert.equal(classifyTool("skills_commit_workspace"), "write");
});

test("WP 2.3 — the three EXPLICIT_DELETE_TOOLS app-data delete tools always classify as `delete`, prefixed or bare", () => {
  // These three ALSO match the DESTRUCTIVE_VERB net on their own (every name ends `_delete`) — this
  // test proves the outcome, not which mechanism produced it (see assistant-write-tools.test.ts for a
  // fuller WP 2.3 write-toolset sweep, incl. every OTHER write tool classifying as ordinary `write`).
  for (const name of ["tests_delete", "environments_delete", "suites_delete"]) {
    assert.equal(classifyTool(name), "delete", `${name} bare should be delete`);
    assert.equal(
      classifyTool(`mcp__assistant-app__${name}`),
      "delete",
      `${name} prefixed should be delete`,
    );
    assert.equal(isDeleteTool(name), true);
  }
});

test("WP 2.3 — reversible membership/relationship writes (detach/remove) are NOT force-classified as delete", () => {
  // A deliberate judgment call (write-tools.ts's module banner): detaching a skill from an
  // Environment, or removing a test/suite from a Collection, doesn't destroy any data — the skill/
  // test/suite itself is untouched, only re-homed or unlinked — so these stay ordinary auto-accept-
  // eligible writes rather than always-ask deletes.
  assert.equal(classifyTool("environments_detach_skill"), "write");
  assert.equal(classifyTool("collections_modify"), "write");
});

test("requiresApproval / autoAcceptEligible encode the D-AS4 gating rules", () => {
  assert.equal(requiresApproval("read"), false);
  assert.equal(requiresApproval("ui"), false);
  assert.equal(requiresApproval("write"), true);
  assert.equal(requiresApproval("delete"), true);

  // Only create/update writes may be auto-accepted; deletes NEVER are.
  assert.equal(autoAcceptEligible("write"), true);
  assert.equal(autoAcceptEligible("delete"), false);
  assert.equal(autoAcceptEligible("read"), false);
  assert.equal(autoAcceptEligible("ui"), false);
});
