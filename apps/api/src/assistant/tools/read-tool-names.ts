// Assistant (WP 2.1) — the canonical list of WP 1.2 READ tool names, kept in a DELIBERATELY SDK-free
// module so the session manager (session-manager.ts, which must never statically import
// `@anthropic-ai/claude-agent-sdk`) can import it for the permission classifier without pulling the
// SDK into the fake-driver test path. `tools/index.ts` (which DOES import the SDK) builds the actual
// tool definitions; a gate test cross-checks that its definitions' names set-equal this list, so a
// read tool added there without updating this list fails the build rather than being silently GATED
// at runtime (fail-safe: an out-of-sync read tool would merely prompt for approval, never auto-write).
//
// The permission classifier (permission-classifier.ts) treats every tool NOT in this set — and not a
// `ui_`/`ui.` navigation tool — as a WRITE that must be gated. So this is the auto-allow allowlist:
// its members are the only app-data tools the agent may call without an approval round-trip.

/** Every WP 1.2 read tool's bare (unprefixed) name — the auto-allow allowlist (see the module banner). */
export const ASSISTANT_READ_TOOL_NAMES = [
  "runs_get",
  "runs_list",
  "runs_search",
  "run_report_markdown",
  "suite_runs_get",
  "suite_runs_list",
  "skills_get",
  "skills_versions",
  "skills_files",
  "skills_file_content",
  "skills_diff",
  "scans_get",
  "scans_list",
  "scans_tools",
  "servers_list",
  "compare_run",
  "compatibility_heatmap",
  "tests_list",
  "tests_get",
  "environments_list",
  "environments_get",
  "collections_list",
  "collections_get",
  // Cross-entity ACTION read tools (see `action-tools.ts`). Auto-allowed like every other read: a live
  // MCP `tools/list` and a rating-issues listing are both side-effect-free lookups. (Their WRITE-shaped
  // siblings `mcp_tool_call`/`rating_issue_file` are NOT here — they stay gated.)
  "mcp_tools_list",
  "rating_issues_list",
  // Observability WP5.4 issue-loop READ tools (see `issue-loop-tools.ts`). Auto-allowed like every other
  // read: reading a fleet issue, listing issues, and reading an issue's linked/verification runs are all
  // side-effect-free lookups. (Their gated siblings `issues_update`/`tests_create_draft`/`runs_rerun` are
  // NOT here — they stay approval-gated.)
  "issues_get",
  "issues_list",
  "issues_linked_runs",
  // Assistant-operability WP 3.1 Hub read tools (see `hub-read-tools.ts`). Auto-allowed like every
  // other read: listing the agent-role library / saved crews / the usage rollup are all
  // side-effect-free lookups over `HubRepository` — no writes, no `ASSISTANT_ENTITY_KINDS` change
  // (D-AO3). They back the route-keyed `agents`/`hub` starter chips added in WP 2.1.
  "hub_agents_list",
  "hub_crews_list",
  "hub_usage_summary",
] as const;

/** O(1) membership set over {@link ASSISTANT_READ_TOOL_NAMES} for the classifier's hot path. */
export const ASSISTANT_READ_TOOL_NAME_SET: ReadonlySet<string> = new Set(ASSISTANT_READ_TOOL_NAMES);
