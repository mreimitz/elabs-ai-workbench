import type { FleetIssue } from "./issue-lib";
import { BUCKET_LABELS } from "./issue-lib";

/**
 * Observability WP5.4 (D-OB20) — the "Triage this issue" STARTER + its issue CONTEXT ENVELOPE.
 *
 * The owner-initiated issue loop opens the assistant dock with this prefilled (still-editable, NEVER
 * auto-sent) prompt via `openAssistant({ prompt })`. Because WP5.4 is SHARED-FREE (a parallel WP owns
 * `packages/shared`, and "issue" is deliberately NOT added to the frozen 9-kind `AssistantEntityKind`
 * vocabulary), the issue context is delivered as this structured PROMPT BLOCK rather than a new
 * pinned-entity envelope — the dock stays UNPINNED (read-only page scope), which is exactly right: the
 * assistant reads broadly, and its three issue-loop ACTION tools (`issues_update`, `tests_create_draft`,
 * `runs_rerun`) are scope-EXEMPT + approval-gated, so they work from here without any entity pin.
 *
 * The block documents everything the API brief asks the envelope to carry — issue summary, cluster-key
 * parts, top linked-run ids, forensics fix targets + drafted fix, affected skill/server ids — so the
 * agent can resolve "this issue" and start the analyze → fix-draft → regression-test → prove loop.
 *
 * PURE + deterministic (no fetch, no React) so acceptance #1's "documented envelope" is a fixture assert.
 */

/** The starter's short label — the "Triage this issue" template the WP5.4 brief calls for. */
export const ISSUE_TRIAGE_STARTER_LABEL = "Triage this issue";

/** How many linked-run ids to embed (the top/most-recent contributing runs — the agent can read the
 *  rest via `issues_linked_runs`). Bounded so a hot cluster doesn't bloat the opener. */
const MAX_LINKED_RUNS = 8;

function targetLabel(issue: FleetIssue): string {
  return issue.targetKind === "skill" ? "skill" : "MCP server";
}

function affectedLine(issue: FleetIssue): string {
  const { servers, skills, tests, models } = issue.fleet.affected;
  const parts: string[] = [];
  if (skills.length > 0) parts.push(`skills: ${skills.join(", ")}`);
  if (servers.length > 0) parts.push(`servers: ${servers.join(", ")}`);
  if (tests.length > 0) parts.push(`tests: ${tests.join(", ")}`);
  if (models.length > 0) parts.push(`models: ${models.join(", ")}`);
  return parts.length > 0 ? parts.join(" · ") : "none recorded";
}

/**
 * Build the "Triage this issue" prompt for one fleet issue. The result is a self-contained brief: an
 * `<issue-context>` block (identity + cluster + fix targets + drafted fix + affected + linked runs) plus
 * an ordered plan for the loop. The assistant is told to draft the fix through the EXISTING approval-gated
 * write protocol (skill edits via the skill-workspace path on the skill's page; MCP-server config as a
 * chat suggestion), propose a regression test, prove it with a fork re-run, and only THEN resolve.
 */
export function buildIssueTriagePrompt(issue: FleetIssue): string {
  const runIds = issue.occurrences.map((o) => o.runId).slice(0, MAX_LINKED_RUNS);
  const runsLine =
    runIds.length > 0
      ? `${runIds.join(", ")}${issue.occurrences.length > runIds.length ? ", …" : ""}`
      : "none recorded";

  const contextLines = [
    "<issue-context>",
    `Issue id: ${issue.id}`,
    `Title: ${issue.title}`,
    `Target: ${targetLabel(issue)} "${issue.targetName}" (${issue.targetId})`,
    `Lifecycle: ${issue.fleet.lifecycle} · severity: ${issue.severity} · seen: ${issue.fleet.occurrenceCount}× (first ${issue.fleet.firstSeenAt.slice(0, 10)}, last ${issue.fleet.lastSeenAt.slice(0, 10)})`,
    `Root cause: ${BUCKET_LABELS[issue.bucket]} · fix target: ${issue.fixTarget}`,
    `Cluster key: ${issue.fleet.clusterKey}`,
    `Summary: ${issue.summary}`,
    ...(issue.draftFix ? [`Drafted fix: ${issue.draftFix}`] : []),
    ...(issue.skillVersionId ? [`First seen on skill version: ${issue.skillVersionId}`] : []),
    `Affected: ${affectedLine(issue)}`,
    `Top linked runs: ${runsLine}`,
    "</issue-context>",
  ];

  const plan = [
    `Triage this recurring fleet issue and close the loop. Steps:`,
    `1. Read the issue and its evidence with issues_get / issues_linked_runs; confirm the root cause.`,
    `2. Draft the fix through the EXISTING write protocol — for a skill, open its page and edit via the skill workspace (a new immutable version on approval); for an MCP server, propose the config change as a suggestion in chat (no server write happens automatically).`,
    `3. Propose a regression test from a representative linked run with tests_create_draft (into a collection — default "Local"); it lands as a reviewable draft that never auto-runs.`,
    `4. Prove the fix with runs_rerun on a linked run, pinning the fixed skill version via overrides.skillVersionId; the derived run is recorded as a verification run on this issue.`,
    `5. Once a verification run actually passes, resolve the issue with issues_update (a resolved cluster that reappears later auto-reopens on its own — you do not need to watch it).`,
    `Every write and the fork re-run are approval-gated — I will see each before it happens.`,
  ];

  return `${contextLines.join("\n")}\n\n${plan.join("\n")}`;
}
