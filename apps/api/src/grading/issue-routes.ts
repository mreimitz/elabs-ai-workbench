import {
  type IssueAssistResult,
  type IssueAssistState,
  type IssueAssistUnmergeResult,
  type IssueRebuildResult,
  issueLifecycleActionSchema,
  issueSweepRequestSchema,
  type IssueSweepResult,
  type RatingIssue,
  ratingIssueExportQuerySchema,
  type RatingIssueOccurrence,
  ratingIssuesQuerySchema,
  type RatingIssueTargetKind,
  ratingIssueUpdateSchema,
} from "@mcp-token-footprint/shared";
import type { FastifyInstance } from "fastify";
import { httpError } from "../utils/errors.js";
import type { RunRepository } from "../testing/run-repository.js";
import type { IssueSweepService } from "./issue-clustering.js";
import type { IssueAssistService } from "./issue-assist.js";
import type { RatingIssueRepository } from "./issue-repository.js";
import type { IssueVerificationLink, IssueVerificationStore } from "./issue-verification.js";

/**
 * Observability WP5.4 — one issue⇆run VERIFICATION link, hydrated with the derived run's live status.
 * apps/api-local (SHARED-FREE — the web feature carries a structurally-identical local type). The link
 * itself is a plain annotation over `app_settings` (no schema change); `status`/`outcome` are read
 * best-effort from the run row and omitted when the run is gone.
 */
export type IssueVerificationRunView = IssueVerificationLink & {
  status?: string;
  outcome?: string;
};

/**
 * Rating Issues registry routes (Auto-Rating follow-on + Observability WP5.1 fleet aggregation). The
 * READ routes never execute a run/tool or trigger a judge call. The WP5.1 lifecycle writes + the
 * sweep/rebuild routes are DETERMINISTIC (no LLM) and additive — issue CREATION happens in the
 * post-rating hook / re-grade path (per-run AR issues) or the sweep (clustered fleet issues).
 *
 * `GET  /api/issues`                    → filtered list ({ issues }) — targetKind? / targetId? / status? / lifecycle? / lastSeenFrom? / lastSeenTo?
 * `GET  /api/issues/:id`                → one issue incl. occurrences (+ fleet block when clustered) (404 unknown)
 * `PATCH /api/issues/:id`               → manual resolve / re-open ({ status }) — the legacy AR status write
 * `POST /api/issues/sweep`              → fold terminal runs into fleet issues (IssueSweepResult) — idempotent
 * `POST /api/issues/rebuild`            → drop + re-derive every fleet issue from runs (IssueRebuildResult)
 * `POST /api/issues/:id/{resolve,ignore,reopen}` → fleet lifecycle transitions ({ note? }) — regressed auto-reopens
 * `GET  /api/skills/:id/issues`         → the skill's issues ({ issues }, occurrences included)
 * `GET  /api/servers/:id/issues`        → the server's issues ({ issues }, occurrences included)
 * `GET  /api/issues/export/markdown`    → developer-facing Markdown doc for ONE target (attachment)
 * `GET  /api/issues/export/json`        → the same issues as a JSON attachment
 *
 * LLM assist (WP5.2, OPT-IN) — wired only when the assist service is present. The refine endpoints are
 * what the issues UI's "Refine with AI" calls; they run the OPT-IN schema-constrained judge pass on its
 * OWN concurrency/ledger, apply reversible merge-links, and NEVER mutate the deterministic issue rows:
 * `GET  /api/issues/assist`             → the assist overlay ({ groups, ledger }) for the settings surface
 * `POST /api/issues/assist/refine`      → refine ALL open fleet issues (IssueAssistResult)
 * `POST /api/issues/assist/:groupId/unmerge` → undo a merge (restores the originals; IssueAssistUnmergeResult)
 * `POST /api/issues/:id/assist/refine`  → refine ONE fleet issue + its same-target near-dups (IssueAssistResult)
 */
export async function registerRatingIssueRoutes(
  app: FastifyInstance,
  issues: RatingIssueRepository,
  sweep?: IssueSweepService,
  assist?: IssueAssistService,
  // Observability WP5.4 — the assistant-loop verification-run link store (+ the run repo to hydrate each
  // linked run's live status). Optional so a route-only test that never exercises the loop can omit them;
  // the `GET /api/issues/:id/verification-runs` route is registered only when the store is wired.
  verification?: IssueVerificationStore,
  runs?: RunRepository,
): Promise<void> {
  app.get("/api/issues", async (request): Promise<{ issues: RatingIssue[] }> => {
    const query = ratingIssuesQuerySchema.parse(request.query ?? {});
    return { issues: issues.listAll(query) };
  });

  // Fleet aggregation (WP5.1) — the deterministic sweep + the derived-once rebuild. Static segments,
  // registered before the `:id` lifecycle routes (Fastify prefers the static path anyway). Both are
  // additive; neither runs an LLM. Registered only when the sweep service is wired (always in
  // production; a route-only test that never sweeps may omit it).
  if (sweep) {
    app.post("/api/issues/sweep", async (request): Promise<IssueSweepResult> => {
      const body = issueSweepRequestSchema.parse(request.body ?? {});
      return sweep.runSweep(body.since !== undefined ? { since: body.since } : {});
    });

    app.post("/api/issues/rebuild", async (): Promise<IssueRebuildResult> => {
      return sweep.rebuild();
    });
  }

  // LLM assist (WP5.2, OPT-IN) — wired only when the assist service is present. The `assist` segment is
  // STATIC, so Fastify prefers it over the `:id` param (no ambiguity with `/api/issues/:id`). All three
  // are additive; the deterministic issue rows are never mutated by them.
  if (assist) {
    app.get("/api/issues/assist", async (): Promise<IssueAssistState> => {
      return assist.getState();
    });

    app.post("/api/issues/assist/refine", async (): Promise<IssueAssistResult> => {
      return assist.refineList();
    });

    app.post("/api/issues/assist/:groupId/unmerge", async (request): Promise<IssueAssistUnmergeResult> => {
      const { groupId } = request.params as { groupId: string };
      if (!groupId) throw httpError(400, "Assist group id is required");
      return assist.unmerge(groupId);
    });

    app.post("/api/issues/:id/assist/refine", async (request): Promise<IssueAssistResult> => {
      const { id } = request.params as { id: string };
      if (!id) throw httpError(400, "Issue id is required");
      return assist.refineIssue(id);
    });
  }

  // Static export paths are registered alongside `/api/issues/:id` — Fastify always prefers the
  // static segment (`export`) over the param, so there is no ambiguity.
  app.get("/api/issues/export/markdown", async (request, reply): Promise<string> => {
    const { targetKind, targetId } = ratingIssueExportQuerySchema.parse(request.query ?? {});
    const list = issues.listByTarget(targetKind, targetId);
    reply.header("content-type", "text/markdown; charset=utf-8");
    reply.header(
      "content-disposition",
      `attachment; filename="rating-issues-${targetKind}-${sanitizeFilePart(targetId)}.md"`,
    );
    return createIssuesMarkdownReport(targetKind, targetId, list);
  });

  app.get("/api/issues/export/json", async (request, reply) => {
    const { targetKind, targetId } = ratingIssueExportQuerySchema.parse(request.query ?? {});
    const list = issues.listByTarget(targetKind, targetId);
    reply.header("content-type", "application/json; charset=utf-8");
    reply.header(
      "content-disposition",
      `attachment; filename="rating-issues-${targetKind}-${sanitizeFilePart(targetId)}.json"`,
    );
    return {
      target: {
        kind: targetKind,
        id: targetId,
        name: list[0]?.targetName ?? targetId,
      },
      exportedAt: new Date().toISOString(),
      issues: list,
    };
  });

  // Observability WP5.4 — an issue's VERIFICATION runs (fork re-runs launched via the assistant loop to
  // prove a fix), each hydrated best-effort with its live run status/outcome. `/:id/verification-runs` is
  // a distinct suffix from the bare `/:id`, so Fastify routes it unambiguously. Registered only when the
  // link store is wired. The links are annotations only — a verification run is a normal, gradeable run
  // (D-OB15/AR6), and reading them here never touches a grade.
  if (verification) {
    app.get(
      "/api/issues/:id/verification-runs",
      async (request): Promise<{ runs: IssueVerificationRunView[] }> => {
        const { id } = request.params as { id: string };
        if (!id) throw httpError(400, "Issue id is required");
        issues.get(id); // typed 404 so an unknown issue id is a clean 404, not an empty list
        const links = verification.list(id);
        const hydrated: IssueVerificationRunView[] = links.map((link) => {
          if (!runs) return link;
          try {
            const summary = runs.getSummary(link.runId);
            return {
              ...link,
              status: summary.status,
              ...(summary.outcome ? { outcome: summary.outcome } : {}),
            };
          } catch {
            // The derived run was deleted — surface the link without live status (best-effort hydration).
            return link;
          }
        });
        return { runs: hydrated };
      },
    );
  }

  app.get("/api/issues/:id", async (request): Promise<RatingIssue> => {
    const { id } = request.params as { id: string };
    if (!id) throw httpError(400, "Issue id is required");
    return issues.get(id);
  });

  app.patch("/api/issues/:id", async (request): Promise<RatingIssue> => {
    const { id } = request.params as { id: string };
    if (!id) throw httpError(400, "Issue id is required");
    const { status } = ratingIssueUpdateSchema.parse(request.body);
    return issues.setStatus(id, status);
  });

  // Fleet lifecycle transitions (WP5.1). `resolve` marks the recurring issue fixed (records the note);
  // `ignore` is a "won't-fix" dismissal (a resolve variant — the 3-state lifecycle
  // open|resolved|regressed has no distinct ignored state, so it resolves with a note); `reopen`
  // returns it to `open`. A resolved/ignored cluster that reappears in a later run auto-`regressed`s
  // via the sweep (independent of these manual writes).
  app.post("/api/issues/:id/resolve", async (request): Promise<RatingIssue> => {
    const { id } = request.params as { id: string };
    if (!id) throw httpError(400, "Issue id is required");
    const { note } = issueLifecycleActionSchema.parse(request.body ?? {});
    return issues.setLifecycle(id, "resolved", note ?? null);
  });

  app.post("/api/issues/:id/ignore", async (request): Promise<RatingIssue> => {
    const { id } = request.params as { id: string };
    if (!id) throw httpError(400, "Issue id is required");
    const { note } = issueLifecycleActionSchema.parse(request.body ?? {});
    return issues.setLifecycle(id, "resolved", note ?? "Ignored");
  });

  app.post("/api/issues/:id/reopen", async (request): Promise<RatingIssue> => {
    const { id } = request.params as { id: string };
    if (!id) throw httpError(400, "Issue id is required");
    // Parse the (optional) body for a consistent 400 on a malformed payload; reopen clears the note.
    issueLifecycleActionSchema.parse(request.body ?? {});
    return issues.setLifecycle(id, "open", null);
  });

  app.get("/api/skills/:id/issues", async (request): Promise<{ issues: RatingIssue[] }> => {
    const { id } = request.params as { id: string };
    if (!id) throw httpError(400, "Skill id is required");
    return { issues: issues.listByTarget("skill", id) };
  });

  app.get("/api/servers/:id/issues", async (request): Promise<{ issues: RatingIssue[] }> => {
    const { id } = request.params as { id: string };
    if (!id) throw httpError(400, "Server id is required");
    return { issues: issues.listByTarget("mcp_server", id) };
  });
}

/**
 * The developer-facing Markdown export for ONE target: header + status/severity/times-seen overview
 * table, then one section per issue with its summary, drafted fix, and the linked contributing runs.
 * Written to be handed to the MCP server's / skill's developers as-is. Pure (exported for tests).
 */
export function createIssuesMarkdownReport(
  targetKind: RatingIssueTargetKind,
  targetId: string,
  issues: readonly RatingIssue[],
): string {
  const targetName = issues[0]?.targetName ?? targetId;
  const kindLabel = targetKind === "skill" ? "Skill" : "MCP server";
  const open = issues.filter((i) => i.status === "open").length;
  const resolved = issues.length - open;

  const lines: string[] = [
    `# Rating issues — ${targetName}`,
    "",
    `> ${kindLabel} \`${targetId}\` · exported ${new Date().toISOString()} · ` +
      `${issues.length} issue${issues.length === 1 ? "" : "s"} (${open} open · ${resolved} resolved)`,
    "",
  ];

  if (issues.length === 0) {
    lines.push("_No rating issues recorded for this target._", "");
    return lines.join("\n");
  }

  lines.push(
    "| # | Issue | Severity | Status | Seen | First seen | Last seen |",
    "| --- | --- | --- | --- | ---: | --- | --- |",
  );
  issues.forEach((issue, i) => {
    lines.push(
      `| ${i + 1} | ${escapeCell(issue.title)} | ${issue.severity} | ${issue.status} | ` +
        `${issue.timesSeen}× | ${issue.firstSeenAt.slice(0, 10)} | ${issue.lastSeenAt.slice(0, 10)} |`,
    );
  });
  lines.push("");

  issues.forEach((issue, i) => {
    lines.push(
      `## ${i + 1}. ${issue.title}`,
      "",
      `- **Status:** ${issue.status}${issue.resolvedAt ? ` (resolved ${issue.resolvedAt.slice(0, 10)})` : ""}`,
      `- **Severity:** ${issue.severity}`,
      `- **Root cause:** ${issue.bucket} · **Fix target:** ${issue.fixTarget}`,
      `- **Seen:** ${issue.timesSeen}× (first ${issue.firstSeenAt.slice(0, 10)}, last ${issue.lastSeenAt.slice(0, 10)})`,
      ...(issue.skillVersionId ? [`- **First seen on skill version:** \`${issue.skillVersionId}\``] : []),
      ...(issue.judgeModel ? [`- **Triage judge:** ${issue.judgeModel}`] : []),
      "",
      "### Summary",
      "",
      issue.summary,
      "",
      "### Draft fix",
      "",
      issue.draftFix,
      "",
      "### Contributing runs",
      "",
      ...renderOccurrences(issue.occurrences),
      "",
    );
  });

  return lines.join("\n");
}

/**
 * The "Contributing runs" list — one bullet per occurrence carrying its CONCRETE failure evidence
 * (the failing tool, the arguments actually sent, and the exact error) so a developer reading the
 * export sees the real wrong call, not just a run id. Falls back to the bounded finding message when
 * no structured evidence was captured (older occurrences / non-tool categories).
 */
function renderOccurrences(occurrences: readonly RatingIssueOccurrence[]): string[] {
  if (occurrences.length === 0) return ["_(none recorded)_"];
  return occurrences.map((o) => {
    const detail: string[] = [];
    if (o.toolName) detail.push(`tool \`${o.toolName}\``);
    if (o.sentArguments) detail.push(`sent \`${escapeInline(o.sentArguments)}\``);
    if (o.errorMessage) detail.push(`error: ${escapeInline(o.errorMessage)}`);
    if (detail.length === 0 && o.message) detail.push(escapeInline(o.message));
    const suffix = detail.length > 0 ? ` — ${detail.join(" · ")}` : "";
    return `- \`${o.runId}\` (${o.createdAt.slice(0, 10)})${suffix}`;
  });
}

/** Collapse whitespace + neutralize backticks so an excerpt never breaks the surrounding Markdown. */
function escapeInline(text: string): string {
  return text.replace(/`/g, "'").replace(/\s+/g, " ").trim();
}

/** Escape pipes/newlines so a title never breaks the overview table. */
function escapeCell(text: string): string {
  return text.replace(/\|/g, "\\|").replace(/\s+/g, " ").trim();
}

/** Keep exported filenames shell/browser-safe. */
function sanitizeFilePart(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_");
}
