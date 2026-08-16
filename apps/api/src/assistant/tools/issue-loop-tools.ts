// Observability WP5.4 (D-OB20) — the ASSISTANT ISSUE LOOP toolset: analyze → fix draft → regression
// test → prove-with-a-fork-rerun, all OWNER-INITIATED from the issue detail's "Analyze with assistant".
//
// This module adds SIX tools in the SAME one-import-one-spread pattern as `action-tools.ts`:
//
//   READ (auto-allowed — added to `read-tool-names.ts`'s ASSISTANT_READ_TOOL_NAMES like every read):
//     - issues_get          — one fleet/rating issue incl. its cluster identity + bounded occurrences
//     - issues_list         — the fleet-issue registry, filterable (target / status / lifecycle / run)
//     - issues_linked_runs  — an issue's contributing runs + any recorded VERIFICATION runs
//
//   GATED WRITE/ACTION (classify as `write` via the D-AS4 classifier's default fallthrough — UNTOUCHED —
//   so every one is approval-gated exactly like the existing action tools; they are cross-entity ACTIONS
//   reachable from the unpinned issue dock, so they ride the SAME scope EXEMPTION the existing action
//   tools do — see {@link ASSISTANT_ISSUE_LOOP_ACTION_TOOL_NAMES} + `isIssueLoopActionTool`, OR'd into
//   `session-manager.ts`'s handlePermission alongside `isScopeExemptActionTool`):
//     - issues_update       — lifecycle transition (resolve / reopen / ignore) + note on ONE issue
//     - tests_create_draft  — the WP4.1 promote-to-test path, parameterized: draft a regression test
//                             from a linked run into a chosen collection (a DRAFT — never auto-runs)
//     - runs_rerun          — fork a linked run (the WP3.3 rerun endpoint) to PROVE a fix, and record
//                             the derived run back on the issue as a VERIFICATION run (a link annotation
//                             only — the run is a normal, gradeable run; D-OB15/AR6 keep it out of grades)
//
// STUB-ABLE end to end: the write/action tools delegate to the SAME app services the routes use (issue
// repository, the WP4.1 `promoteRunToTest` builder, the run service's `rerun`), all injected — a test
// swaps a fake run launcher / seeded repos, never a real run or SDK child (WP5.4 hard constraint).
//
// NOTHING here weakens the D-AS4 protocol: the tools are classified GATED by the EXISTING classifier and
// still go through the normal approval / auto-accept round-trip. NO scheduled/unattended analysis — the
// loop only ever starts from the owner's button (D-OB20).
import { tool } from "@anthropic-ai/claude-agent-sdk";
import {
  RATING_ISSUE_LIFECYCLES,
  RATING_ISSUE_STATUSES,
  RATING_ISSUE_TARGET_KINDS,
  type RunRerunRequest,
} from "@mcp-token-footprint/shared";
import { z } from "zod";
import type { CollectionRepository } from "../../collections/repository.js";
import { promoteRunToTest } from "../../watch/promote.js";
import type { IssueVerificationStore } from "../../grading/issue-verification.js";
import type { RatingIssueRepository } from "../../grading/issue-repository.js";
import type { RunRepository } from "../../testing/run-repository.js";
import type { TestRepository } from "../../testing/test-repository.js";
import type { TestService } from "../../testing/test-service.js";
import { boundText, jsonResult, safeTool, truncate } from "./util.js";

/**
 * The GATED write/action tools' bare names — the issue-loop actions that are scope-EXEMPT (reachable from
 * the unpinned issue dock) but STILL approval-gated. Exported so `session-manager.ts` (via
 * {@link isIssueLoopActionTool}) and the tests can reason about the exemption WITHOUT restating strings.
 *
 * WHY a SEPARATE apps/api-local set (not shared's `SCOPE_EXEMPT_ACTION_TOOLS`): WP5.4 is SHARED-FREE (a
 * parallel WP owns `packages/shared`), and the shared exemption set is kept set-equal to the OTHER action
 * tools by a test — so the issue-loop actions get their exemption from THIS local predicate instead, OR'd
 * into the same handlePermission scope check. They are still `write`-classified + gated identically.
 */
export const ASSISTANT_ISSUE_LOOP_ACTION_TOOL_NAMES = [
  "issues_update",
  "tests_create_draft",
  "runs_rerun",
] as const;

/** The READ tools' bare names — auto-allowed (also listed in `read-tool-names.ts`'s allowlist). */
export const ASSISTANT_ISSUE_LOOP_READ_TOOL_NAMES = [
  "issues_get",
  "issues_list",
  "issues_linked_runs",
] as const;

/** Every issue-loop tool's bare name (read + action) — for the tool-inventory sanity test's expected union. */
export const ASSISTANT_ISSUE_LOOP_TOOL_NAMES = [
  ...ASSISTANT_ISSUE_LOOP_READ_TOOL_NAMES,
  ...ASSISTANT_ISSUE_LOOP_ACTION_TOOL_NAMES,
] as const;

const ISSUE_LOOP_ACTION_TOOL_NAME_SET: ReadonlySet<string> = new Set(
  ASSISTANT_ISSUE_LOOP_ACTION_TOOL_NAMES,
);

/**
 * True when a BARE tool name is an issue-loop ACTION tool that bypasses the page-scope write lock (still
 * approval-gated). The apps/api-local twin of shared's `isScopeExemptActionTool` — OR'd into
 * `session-manager.ts`'s handlePermission so an issue-loop action, reachable while the owner is on the
 * (unpinned) issue detail, isn't hard-denied by the scope lock. The tools are still `write`-classified.
 */
export function isIssueLoopActionTool(bareToolName: string): boolean {
  return ISSUE_LOOP_ACTION_TOOL_NAME_SET.has(bareToolName);
}

/**
 * The minimal run-launcher surface the fork-rerun tool needs — satisfied structurally by
 * `RunService` (its `rerun(parentRunId, request)` returns a `RunHandle` with `runId` + `done`). A test
 * injects a fake so NO real run is ever launched (WP5.4 hard constraint).
 */
export interface IssueLoopRunLauncher {
  rerun(parentRunId: string, request: RunRerunRequest): { runId: string; done?: Promise<unknown> };
}

/** The dependencies the issue-loop tools need — existing app services/repositories, reused not recreated. */
export interface IssueLoopToolDeps {
  issues: RatingIssueRepository;
  runs: RunRepository;
  /** `TestRepository` (the read/attachment-record side `promoteRunToTest` needs for the carry-over). */
  tests: TestRepository;
  /** `TestService` (blob-aware create the draft is persisted through). */
  testService: TestService;
  collections: CollectionRepository;
  runService: IssueLoopRunLauncher;
  verification: IssueVerificationStore;
}

// ── Compaction defaults (mirror action-tools.ts's discipline: cap + explicit truncated marker) ────────
const DEFAULT_ISSUE_LIST_LIMIT = 50;
const MAX_ISSUE_LIST_LIMIT = 200;
const MAX_OCCURRENCES = 50;
const MAX_TEXT_CHARS = 600;

/** Project one issue into a compact, agent-legible summary (drops the volatile row internals). */
function summarizeIssue(issue: {
  id: string;
  title: string;
  summary: string;
  targetKind: string;
  targetId: string;
  targetName: string;
  bucket: string;
  fixTarget: string;
  severity: string;
  status: string;
  timesSeen: number;
  draftFix: string;
  firstSeenAt: string;
  lastSeenAt: string;
  skillVersionId?: string;
  fleet?: {
    lifecycle: string;
    clusterKey: string;
    occurrenceCount: number;
    affected: { servers: string[]; skills: string[]; tests: string[]; models: string[] };
    resolutionNote?: string;
  };
}): Record<string, unknown> {
  return {
    id: issue.id,
    title: issue.title,
    summary: boundText(issue.summary, MAX_TEXT_CHARS),
    targetKind: issue.targetKind,
    targetId: issue.targetId,
    targetName: issue.targetName,
    bucket: issue.bucket,
    fixTarget: issue.fixTarget,
    severity: issue.severity,
    status: issue.status,
    timesSeen: issue.timesSeen,
    firstSeenAt: issue.firstSeenAt,
    lastSeenAt: issue.lastSeenAt,
    ...(issue.skillVersionId ? { skillVersionId: issue.skillVersionId } : {}),
    draftFix: boundText(issue.draftFix, MAX_TEXT_CHARS),
    ...(issue.fleet
      ? {
          fleet: {
            lifecycle: issue.fleet.lifecycle,
            clusterKey: boundText(issue.fleet.clusterKey, MAX_TEXT_CHARS),
            occurrenceCount: issue.fleet.occurrenceCount,
            affected: issue.fleet.affected,
            ...(issue.fleet.resolutionNote ? { resolutionNote: issue.fleet.resolutionNote } : {}),
          },
        }
      : {}),
  };
}

/**
 * Build the issue-loop toolset's raw tool definitions (pre-`createSdkMcpServer`). Exported separately so
 * tests can call `.handler(args, {})` on one definition directly (mirrors `buildActionToolDefinitions`).
 */
export function buildIssueLoopToolDefinitions(deps: IssueLoopToolDeps) {
  return [
    // ── issues_get ──────────────────────────────────────────────────────────────────────────────────
    tool(
      "issues_get",
      "Get one fleet issue (a recurring failure cluster) or rating issue: its identity, cluster key, " +
        "root-cause bucket, drafted fix, severity/lifecycle, affected skills/servers, and its most recent " +
        "contributing-run occurrences (bounded). Use this first when the owner asks you to triage an issue.",
      { issueId: z.string().min(1) },
      async (args) =>
        safeTool(() => {
          const issue = deps.issues.get(args.issueId); // typed 404 on an unknown id
          const occ = truncate(issue.occurrences, MAX_OCCURRENCES);
          return jsonResult({
            ...summarizeIssue(issue),
            occurrences: occ.items.map((o) => ({
              runId: o.runId,
              ...(o.suiteRunId ? { suiteRunId: o.suiteRunId } : {}),
              category: o.category,
              message: boundText(o.message, MAX_TEXT_CHARS),
              ...(o.toolName ? { toolName: o.toolName } : {}),
              ...(o.errorMessage ? { errorMessage: boundText(o.errorMessage, MAX_TEXT_CHARS) } : {}),
              createdAt: o.createdAt,
            })),
            occurrencesTotal: occ.total,
            occurrencesTruncated: occ.truncated,
          });
        }),
    ),

    // ── issues_list ─────────────────────────────────────────────────────────────────────────────────
    tool(
      "issues_list",
      "List fleet/rating issues, optionally scoped to one target (skill or MCP server), status, fleet " +
        "lifecycle (open/resolved/regressed), or the run that surfaced them. Open issues first, then most " +
        "recently seen. Compact summaries — call issues_get for one issue's full occurrences.",
      {
        targetKind: z.enum(RATING_ISSUE_TARGET_KINDS).optional(),
        targetId: z.string().optional(),
        status: z.enum(RATING_ISSUE_STATUSES).optional(),
        lifecycle: z.enum(RATING_ISSUE_LIFECYCLES).optional(),
        runId: z
          .string()
          .optional()
          .describe("Only issues this run contributed at least one occurrence to."),
        limit: z.number().int().positive().max(MAX_ISSUE_LIST_LIMIT).optional(),
      },
      async (args) =>
        safeTool(() => {
          const limit = args.limit ?? DEFAULT_ISSUE_LIST_LIMIT;
          const issues = deps.issues.listAll({
            ...(args.targetKind ? { targetKind: args.targetKind } : {}),
            ...(args.targetId ? { targetId: args.targetId } : {}),
            ...(args.status ? { status: args.status } : {}),
            ...(args.lifecycle ? { lifecycle: args.lifecycle } : {}),
            ...(args.runId ? { runId: args.runId } : {}),
            limit,
          });
          return jsonResult({
            issues: issues.map(summarizeIssue),
            count: issues.length,
            truncated: issues.length >= limit,
          });
        }),
    ),

    // ── issues_linked_runs ──────────────────────────────────────────────────────────────────────────
    tool(
      "issues_linked_runs",
      "List an issue's LINKED runs (every run that contributed a sighting, with its failure evidence) " +
        "PLUS any VERIFICATION runs already recorded against it (fork re-runs launched to prove a fix). " +
        "Use this to pick a run to fork with runs_rerun, and to check whether a fix has already been " +
        "verified. Contributing runs come from the issue's occurrences; verification runs from prior " +
        "runs_rerun calls.",
      { issueId: z.string().min(1) },
      async (args) =>
        safeTool(() => {
          const issue = deps.issues.get(args.issueId); // typed 404 on an unknown id
          const occ = truncate(issue.occurrences, MAX_OCCURRENCES);
          return jsonResult({
            issueId: issue.id,
            linkedRuns: occ.items.map((o) => ({
              runId: o.runId,
              ...(o.suiteRunId ? { suiteRunId: o.suiteRunId } : {}),
              category: o.category,
              ...(o.toolName ? { toolName: o.toolName } : {}),
              ...(o.errorMessage ? { errorMessage: boundText(o.errorMessage, MAX_TEXT_CHARS) } : {}),
              createdAt: o.createdAt,
            })),
            linkedRunsTotal: occ.total,
            linkedRunsTruncated: occ.truncated,
            verificationRuns: deps.verification.list(issue.id),
          });
        }),
    ),

    // ── issues_update (GATED) ─────────────────────────────────────────────────────────────────────────
    tool(
      "issues_update",
      "Update ONE issue's lifecycle — resolve it (a fix has been made/verified), reopen it, or ignore it " +
        "(won't-fix) — with an optional note. This is an approval-gated write: the owner sees the issue, " +
        "the action, and the note before it applies. Resolve ONLY after a verification run has actually " +
        "proven the fix. A resolved cluster that reappears in a later run auto-reopens (regresses) on its " +
        "own — you do not need to watch it.",
      {
        issueId: z.string().min(1),
        action: z
          .enum(["resolve", "reopen", "ignore"])
          .describe("resolve = fixed; ignore = won't-fix (a resolve variant); reopen = back to open."),
        note: z.string().trim().max(2000).optional().describe("Why (recorded on resolve/ignore)."),
      },
      async (args) =>
        safeTool(() => {
          const issue = deps.issues.get(args.issueId); // typed 404 on an unknown id
          const isFleet = Boolean(issue.fleet);
          let updated: typeof issue;
          if (isFleet) {
            if (args.action === "resolve") {
              updated = deps.issues.setLifecycle(issue.id, "resolved", args.note ?? null);
            } else if (args.action === "ignore") {
              updated = deps.issues.setLifecycle(issue.id, "resolved", args.note ?? "Ignored");
            } else {
              updated = deps.issues.setLifecycle(issue.id, "open", null);
            }
          } else {
            // A per-run (non-clustered) issue has no 3-state lifecycle — map to the legacy open/resolved.
            updated = deps.issues.setStatus(issue.id, args.action === "reopen" ? "open" : "resolved");
          }
          return jsonResult({
            issueId: updated.id,
            action: args.action,
            status: updated.status,
            ...(updated.fleet ? { lifecycle: updated.fleet.lifecycle } : {}),
            ...(updated.fleet?.resolutionNote ? { resolutionNote: updated.fleet.resolutionNote } : {}),
          });
        }),
    ),

    // ── tests_create_draft (GATED) ───────────────────────────────────────────────────────────────────
    tool(
      "tests_create_draft",
      "Draft a REGRESSION TEST from a linked run into a chosen collection — the promote-to-test path. " +
        "The draft copies the source run's test (prompt, environment-shaping config, expectations, " +
        "attachments), is clearly marked '[Draft]', and NEVER auto-runs — the owner reviews and launches " +
        "it by hand. This is an approval-gated write. Get a good candidate run from issues_linked_runs; " +
        "get the target collection id from collections_list (default 'Local').",
      {
        runId: z.string().min(1).describe("The linked run to promote into a reusable regression test."),
        collectionId: z.string().min(1).describe("The collection the draft test lands in."),
      },
      async (args) =>
        safeTool(() => {
          deps.collections.get(args.collectionId); // typed 404 if the collection is gone
          const draftId = promoteRunToTest(
            { runs: deps.runs, tests: deps.testService, testRepo: deps.tests },
            args.runId,
            args.collectionId,
          );
          const draft = deps.testService.get(draftId);
          return jsonResult({
            testId: draft.id,
            name: draft.name,
            draft: draft.draft === true,
            collectionId: args.collectionId,
            sourceRunId: args.runId,
            link: `/testing/collections/${args.collectionId}`,
          });
        }),
    ),

    // ── runs_rerun (GATED) ────────────────────────────────────────────────────────────────────────────
    tool(
      "runs_rerun",
      "Fork a linked run to PROVE a fix — a whole-run re-run (or, with fromStepId, a mid-run fork) with " +
        "optional edited launch params (a pinned skillVersionId for the fixed skill, an edited prompt, a " +
        "model, temperature). The derived run is a normal, gradeable run and is recorded on the issue as a " +
        "VERIFICATION run so its outcome shows on the issue detail. This is an approval-gated action that " +
        "LAUNCHES a real run. Only a TERMINAL, non-suite-member run can be forked. Pin the fixed skill " +
        "version via overrides.skillVersionId to prove THE FIX, not the old behavior.",
      {
        parentRunId: z.string().min(1).describe("The linked (terminal) run to fork."),
        issueId: z.string().min(1).describe("The issue this fork run verifies (records the link)."),
        note: z.string().trim().max(500).optional().describe("What this verification run is checking."),
        fromStepId: z
          .string()
          .trim()
          .min(1)
          .optional()
          .describe("Fork AT this step (a mid-run fork). Omit for a whole-run re-run."),
        overrides: z
          .object({
            prompt: z.string().trim().min(1).optional(),
            model: z.string().trim().min(1).optional(),
            temperature: z.number().min(0).max(2).optional(),
            skillVersionId: z
              .string()
              .trim()
              .min(1)
              .optional()
              .describe("Pin the environment's attached skill to the FIXED version."),
          })
          .optional(),
      },
      async (args) =>
        safeTool(() => {
          deps.issues.get(args.issueId); // typed 404 so a bad issue id fails cleanly before launching
          const request: RunRerunRequest = {
            ...(args.fromStepId ? { fromStepId: args.fromStepId } : {}),
            ...(args.overrides ? { overrides: args.overrides } : {}),
          };
          const handle = deps.runService.rerun(args.parentRunId, request);
          // The async run surfaces as its own events/terminal status — never let the unawaited promise reject.
          handle.done?.catch(() => undefined);
          const link = deps.verification.link(args.issueId, {
            runId: handle.runId,
            sourceRunId: args.parentRunId,
            ...(args.note ? { note: args.note } : {}),
            at: new Date().toISOString(),
          });
          return jsonResult({
            runId: handle.runId,
            streamUrl: `/api/runs/${handle.runId}/stream`,
            verifiesIssueId: args.issueId,
            sourceRunId: link.sourceRunId,
            link: `/testing/runs/${handle.runId}`,
          });
        }),
    ),
  ];
}
