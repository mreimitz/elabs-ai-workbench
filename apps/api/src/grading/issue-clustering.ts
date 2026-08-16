import crypto from "node:crypto";
import {
  AUTO_RATING_VERSION,
  CLUSTER_KEY_VERSION,
  type ErrorFinding,
  type IssueRebuildResult,
  type IssueSweepResult,
  type RatingIssueAffected,
  type RatingIssueSeverity,
  type RatingIssueTargetKind,
  type RootCauseBucket,
  type RunDetail,
  type RunGrade,
} from "@mcp-token-footprint/shared";
import type { FleetIssueInsert, RatingIssueRepository } from "./issue-repository.js";
import type { RatingIssueOccurrenceInsert } from "./issue-repository.js";
import { latestForensicsFindings } from "./issue-service.js";

/**
 * Fleet issue aggregation (Observability WP5.1, D-OB20) — the DETERMINISTIC clustering layer on top of
 * the v26 rating-issues registry. It turns recurring `error_forensics` findings into first-class FLEET
 * issues: one issue per distinct {@link buildClusterKey cluster key} per target, folding every
 * contributing terminal run as an occurrence, and maintaining an open/resolved/regressed lifecycle
 * (auto-`regressed` + one notification when a resolved cluster reappears).
 *
 * NO LLM anywhere here (that is the opt-in WP5.2). The clustering is a pure function of the persisted
 * runs + their `error_forensics` grades — so the {@link IssueSweepService.rebuild} path (drop the
 * derived fleet issues, re-sweep ALL history) reproduces byte-identical issues, which is the
 * derived-once proof. It shares the v26 `rating_issue_occurrences` link table (its UNIQUE
 * (issue_id, run_id, finding_digest) key gives the sweep idempotency); the per-run auto-rating pipeline
 * ({@link import("./issue-service.js").RatingIssueService}) is UNTOUCHED — its issues keep a NULL
 * `cluster_key` and its occurrence digests live in a DIFFERENT namespace than the sweep's (see
 * {@link sweepOccurrenceDigest}), so the two never interfere.
 */

/** Longest normalized error signature folded into a cluster key (keeps keys bounded + index-friendly). */
const MAX_SIGNATURE_CHARS = 120;

/** Longest occurrence-message / summary excerpt persisted (mirrors the AR pipeline's discipline). */
const MAX_SNIPPET_CHARS = 400;

// ── The deterministic error-signature normalizer (documented, table-tested) ──────────────────────────

/**
 * Collapse the run-to-run VARIANCE in an error string so the SAME underlying failure clusters across
 * runs. Ordered, documented transforms (each proven by the table-driven unit test); order matters —
 * ids/paths are collapsed BEFORE generic numbers so a UUID / path is not first shredded into `<n>`s:
 *
 *   1. lowercase
 *   2. URLs                          → `<url>`   (`https://host/a/b?x=1` → `<url>`)
 *   3. UUIDs                         → `<id>`
 *   4. long opaque ids (≥12 chars mixing letters+digits, e.g. nanoids) and long hex (≥12) → `<id>`
 *   5. filesystem paths (≥2 segments, POSIX or Windows) → `<path>`
 *   6. hex literals (`0x…`)          → `<n>`
 *   7. numbers (ints/decimals/grouped, e.g. `404`, `3000`, `12,345`, `9.99`) → `<n>`
 *   8. collapse whitespace + trim, then bound to {@link MAX_SIGNATURE_CHARS}
 *
 * So `"timeout after 3000ms at /v1/apps/9f2a"` and `"timeout after 12ms at /v1/apps/be71"` both
 * normalize to `"timeout after <n>ms at <path>"`. Deterministic + side-effect-free.
 */
export function normalizeErrorSignature(input: string): string {
  let s = (input ?? "").toLowerCase();
  // 2. URLs
  s = s.replace(/https?:\/\/\S+/g, "<url>");
  // 3. UUIDs
  s = s.replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/g, "<id>");
  // 4. long opaque ids (letters+digits mixed, ≥12) and long hex (≥12)
  s = s.replace(/\b(?=[a-z0-9_-]*[a-z])(?=[a-z0-9_-]*[0-9])[a-z0-9_-]{12,}\b/g, "<id>");
  s = s.replace(/\b[0-9a-f]{12,}\b/g, "<id>");
  // 5. filesystem paths (POSIX ≥2 segments, then Windows drive paths)
  s = s.replace(/(?:\/[\w.%@-]+){2,}\/?/g, "<path>");
  s = s.replace(/[a-z]:\\[\w\\.%@-]+/g, "<path>");
  // 6. hex literals
  s = s.replace(/\b0x[0-9a-f]+\b/g, "<n>");
  // 7. numbers (ints, decimals, grouped)
  s = s.replace(/\d[\d.,]*/g, "<n>");
  // 8. collapse + bound
  s = s.replace(/\s+/g, " ").trim();
  if (s.length > MAX_SIGNATURE_CHARS) s = s.slice(0, MAX_SIGNATURE_CHARS);
  return s || "(no signature)";
}

// ── The deterministic cluster key ────────────────────────────────────────────────────────────────────

/** The components that identify one recurring failure (see {@link buildClusterKey}). */
export type ClusterKeyComponents = {
  bucket: string;
  targetKind: RatingIssueTargetKind;
  targetId: string;
  /** The failing tool (finer than the server — distinct tools on one server cluster apart). */
  toolName?: string;
  signature: string;
};

/**
 * The VERSIONED, human-readable cluster key:
 *   `v{CLUSTER_KEY_VERSION} | {bucket} | {targetKind}:{targetId} | {toolName|-} | {normalizedSignature}`
 *
 * Mapping to the WP's `bucket | fixTargetKind:fixTargetId | serverOrSkill | normalizedErrorSignature`
 * shape: the fix target (`targetKind:targetId`) IS the concrete server/skill; the "serverOrSkill" slot
 * is realized as the failing TOOL (a finer discriminator so two different tools on one server never
 * collapse). The leading `v{V}` namespaces the key by construction version so a future key change never
 * silently merges pre-existing history with newly-keyed runs.
 */
export function buildClusterKey(c: ClusterKeyComponents): string {
  const tool = c.toolName && c.toolName.length > 0 ? c.toolName : "-";
  return [`v${CLUSTER_KEY_VERSION}`, c.bucket, `${c.targetKind}:${c.targetId}`, tool, c.signature].join(
    " | ",
  );
}

/**
 * The occurrence idempotency digest for a fleet issue — a stable hash of the cluster key in a DISTINCT
 * `sweep-v{V}|…` namespace (so it can never collide with the auto-rating pipeline's finding digests and
 * trip its `hasOccurrence` short-circuit). It depends ONLY on the cluster key, so combined with the run
 * id in the occurrence table's UNIQUE (issue_id, run_id, finding_digest) key it yields exactly ONE
 * occurrence per (cluster, run): a fleet issue's `occurrences` count is its number of DISTINCT runs.
 */
export function sweepOccurrenceDigest(clusterKey: string): string {
  return crypto
    .createHash("sha256")
    .update(`sweep-v${CLUSTER_KEY_VERSION}|${clusterKey}`)
    .digest("hex")
    .slice(0, 24);
}

/**
 * The signature source for a finding: a guardrail/context stop clusters on its machine-readable
 * {@link RunDetail.stopReasonCode} (there is no per-tool error text); every other finding clusters on
 * its normalized error message (falling back to the description, then the category).
 */
export function findingSignature(run: RunDetail, finding: ErrorFinding): string {
  if (
    (finding.category === "guardrail_stop" || finding.category === "context_overflow") &&
    typeof run.stopReasonCode === "string" &&
    run.stopReasonCode
  ) {
    return `stop:${run.stopReasonCode}`;
  }
  return normalizeErrorSignature(finding.errorMessage ?? finding.description ?? finding.category);
}

// ── Target resolution + affected entities (mirrors the AR pipeline's resolveTargets, standalone) ──────

/** A concrete cluster target resolved from a run (a skill it loaded / a server it exercised). */
type ResolvedTarget = { kind: RatingIssueTargetKind; id: string; name: string; skillVersionId?: string };

/** Dependencies of the sweep — STRUCTURAL types so tests stub them with no execution surface. */
export type IssueSweepDeps = {
  issues: RatingIssueRepository;
  /** `RunRepository.getRun` — the persisted run detail (steps carry `serverId`; `skills` the resolutions). */
  runs: { getRun(runId: string): RunDetail };
  /** `GradeRepository.latestByGrader` — the run's newest grade per grader (error_forensics evidence). */
  grades: { latestByGrader(runId: string): RunGrade[] };
  /** `ScenarioService.get` — the model + `allowedServers` fallback when the run has no tool-call evidence. */
  scenarios: { get(id: string): { model?: string; allowedServers: Array<{ serverId: string }> } };
  /** `ServerRepository.getPublic` — server display names (redacted config; only `name` is read). */
  servers: { getPublic(id: string): { name: string } };
  /** Emit ONE notification when a resolved cluster regresses (wired to the WP4.3 notification sink). */
  notifyRegression: (notice: IssueRegressionNotice) => void;
  /** The clock (defaults to `Date.now`); a test injects a fixed one. */
  now?: () => number;
};

/** The regression signal handed to the notification sink (see {@link IssueSweepDeps.notifyRegression}). */
export type IssueRegressionNotice = {
  issueId: string;
  title: string;
  targetKind: RatingIssueTargetKind;
  targetName: string;
  clusterKey: string;
  runId: string;
};

export class IssueSweepService {
  private readonly now: () => number;

  constructor(private readonly deps: IssueSweepDeps) {
    this.now = deps.now ?? Date.now;
  }

  /**
   * Fold every terminal run since the last sweep watermark (or since `opts.since`, or ALL of history
   * when `since` is null) into the fleet registry, then advance the watermark. FULLY IDEMPOTENT: a
   * re-sweep of the same window changes nothing (the occurrence INSERT-OR-IGNORE dedupes). Never throws
   * — a bad run loses only itself. Rides both the on-demand route and the scheduler tick.
   */
  runSweep(opts: { since?: string | null; nowMs?: number } = {}): IssueSweepResult {
    const nowMs = opts.nowMs ?? this.now();
    const until = new Date(nowMs).toISOString();
    const since =
      opts.since !== undefined ? opts.since : this.deps.issues.getSweepWatermark();
    const runs = this.deps.issues.listTerminalRunsForSweep(since, until);
    let occurrencesAdded = 0;
    let issuesOpened = 0;
    let issuesRegressed = 0;
    for (const run of runs) {
      const res = this.foldRun(run.id, run.terminalAt);
      occurrencesAdded += res.occurrencesAdded;
      issuesOpened += res.issuesOpened;
      issuesRegressed += res.issuesRegressed;
    }
    this.deps.issues.setSweepWatermark(until);
    return {
      runsScanned: runs.length,
      occurrencesAdded,
      issuesOpened,
      issuesRegressed,
      sweptThrough: until,
    };
  }

  /**
   * The derived-once PROOF: drop every fleet issue + its occurrences and re-sweep ALL terminal runs,
   * reproducing byte-identical derived caches (occurrences / first-last-seen / affected / trend). NOTE:
   * a FULL rebuild also resets the operator-driven lifecycle (resolve/ignore + any resulting
   * `regressed`) — those are NOT derived, so a from-scratch recompute has no resolution history to
   * replay; every rebuilt cluster starts `open`. The DERIVED caches are what a rebuild guarantees.
   */
  rebuild(): IssueRebuildResult {
    this.deps.issues.deleteAllFleetIssues();
    const result = this.runSweep({ since: null, nowMs: this.now() });
    const counts = this.deps.issues.countFleet();
    return {
      issueCount: counts.issues,
      occurrenceCount: counts.occurrences,
      runsScanned: result.runsScanned,
    };
  }

  // ── per-run folding (guarded) ─────────────────────────────────────────────────────────────────

  private foldRun(
    runId: string,
    terminalAt: string,
  ): { occurrencesAdded: number; issuesOpened: number; issuesRegressed: number } {
    let occurrencesAdded = 0;
    let issuesOpened = 0;
    let issuesRegressed = 0;
    try {
      const run = this.deps.runs.getRun(runId);
      const observedAt = run.endedAt ?? terminalAt ?? run.startedAt;
      const findings = latestForensicsFindings(this.deps.grades.latestByGrader(runId));
      const actionable = findings.filter(
        (f) => f.fixTarget === "skill" || f.fixTarget === "mcp_server",
      );
      for (const finding of actionable) {
        const targets = this.resolveTargets(run, finding.fixTarget as RatingIssueTargetKind);
        for (const target of targets) {
          try {
            const r = this.applyFinding(run, finding, target, observedAt);
            if (r.added) occurrencesAdded += 1;
            if (r.opened) issuesOpened += 1;
            if (r.regressed) issuesRegressed += 1;
          } catch {
            // Never lose the rest of the findings/targets over one bad pair.
          }
        }
      }
    } catch {
      // Never lose the sweep over one bad run.
    }
    return { occurrencesAdded, issuesOpened, issuesRegressed };
  }

  private applyFinding(
    run: RunDetail,
    finding: ErrorFinding,
    target: ResolvedTarget,
    observedAt: string,
  ): { added: boolean; opened: boolean; regressed: boolean } {
    const signature = findingSignature(run, finding);
    const clusterKey = buildClusterKey({
      bucket: finding.bucket,
      targetKind: target.kind,
      targetId: target.id,
      ...(finding.toolName ? { toolName: finding.toolName } : {}),
      signature,
    });
    const occurrence: RatingIssueOccurrenceInsert = {
      runId: run.id,
      suiteRunId: run.suiteRunId ?? null,
      findingDigest: sweepOccurrenceDigest(clusterKey),
      category: finding.category,
      message: snippet(finding.description),
      ...(finding.toolName ? { toolName: finding.toolName } : {}),
      ...(finding.sentArguments ? { sentArguments: finding.sentArguments } : {}),
      ...(finding.errorMessage ? { errorMessage: finding.errorMessage } : {}),
    };
    const affected = this.buildAffected(run, target);

    const existing = this.deps.issues.findFleetIssueByClusterKey(clusterKey, CLUSTER_KEY_VERSION);
    if (!existing) {
      const insert: FleetIssueInsert = {
        clusterKey,
        clusterKeyVersion: CLUSTER_KEY_VERSION,
        targetKind: target.kind,
        targetId: target.id,
        targetName: target.name,
        skillVersionId: target.skillVersionId ?? null,
        title: clusterTitle(finding, target),
        summary: clusterSummary(finding, target),
        bucket: finding.bucket,
        fixTarget: finding.fixTarget,
        draftFix: finding.draftFix,
        severity: severityForFinding(finding),
        ratingVersion: AUTO_RATING_VERSION,
        affected,
        occurrence,
        observedAt,
      };
      this.deps.issues.insertFleetIssue(insert);
      return { added: true, opened: true, regressed: false };
    }

    const added = this.deps.issues.addFleetOccurrence(existing.id, occurrence, observedAt);
    if (!added) return { added: false, opened: false, regressed: false }; // idempotent no-op

    this.deps.issues.mergeAffected(existing.id, affected);
    this.deps.issues.recomputeFleetDerived(existing.id);

    let regressed = false;
    if (existing.fleet?.lifecycle === "resolved") {
      this.deps.issues.setLifecycle(existing.id, "regressed");
      regressed = true;
      try {
        this.deps.notifyRegression({
          issueId: existing.id,
          title: existing.title,
          targetKind: target.kind,
          targetName: target.name,
          clusterKey,
          runId: run.id,
        });
      } catch {
        // A notification hiccup must never break the sweep (observer discipline).
      }
    }
    return { added: true, opened: false, regressed };
  }

  /** Resolve a finding's fix target to the CONCRETE skills/servers of THIS run (mirrors the AR pipeline). */
  private resolveTargets(run: RunDetail, kind: RatingIssueTargetKind): ResolvedTarget[] {
    if (kind === "skill") {
      const skills = Array.isArray(run.skills) ? run.skills : [];
      return skills.map((s) => ({
        kind: "skill" as const,
        id: s.skillId,
        name: s.name || s.skillId,
        ...(s.skillVersionId ? { skillVersionId: s.skillVersionId } : {}),
      }));
    }
    const serverIds = collectServerIds(run);
    if (serverIds.size === 0) {
      try {
        for (const allowed of this.deps.scenarios.get(run.scenarioId).allowedServers) {
          if (allowed.serverId) serverIds.add(allowed.serverId);
        }
      } catch {
        // Scenario deleted after the run → no fallback evidence; skip.
      }
    }
    return [...serverIds].map((id) => ({ kind: "mcp_server" as const, id, name: this.serverName(id) }));
  }

  /** The distinct entities THIS run spans, plus the target itself — merged into the issue's affected set. */
  private buildAffected(run: RunDetail, target: ResolvedTarget): RatingIssueAffected {
    const servers = collectServerIds(run);
    const skills = new Set<string>();
    for (const s of Array.isArray(run.skills) ? run.skills : []) {
      if (s.skillId) skills.add(s.skillId);
    }
    if (target.kind === "mcp_server") servers.add(target.id);
    else skills.add(target.id);
    const models: string[] = [];
    try {
      const model = this.deps.scenarios.get(run.scenarioId).model;
      if (typeof model === "string" && model) models.push(model);
    } catch {
      // Scenario deleted → no model dimension for this run.
    }
    return {
      servers: [...servers],
      skills: [...skills],
      tests: run.testId ? [run.testId] : [],
      models,
    };
  }

  private serverName(serverId: string): string {
    try {
      return this.deps.servers.getPublic(serverId).name || serverId;
    } catch {
      return serverId;
    }
  }
}

// ── pure helpers ─────────────────────────────────────────────────────────────────────────────────────

/** The distinct server ids a run's tool steps exercised. */
function collectServerIds(run: RunDetail): Set<string> {
  const serverIds = new Set<string>();
  for (const step of Array.isArray(run.steps) ? run.steps : []) {
    if (step.type !== "tool_call" && step.type !== "tool_result") continue;
    if (typeof step.serverId === "string" && step.serverId) serverIds.add(step.serverId);
  }
  return serverIds;
}

/** Deterministic severity from the finding category (terminal failures weigh most). No judge. */
export function severityForFinding(finding: ErrorFinding): RatingIssueSeverity {
  switch (finding.category) {
    case "context_overflow":
    case "guardrail_stop":
    case "mcp_connection_failure":
      return "high";
    default:
      return "medium";
  }
}

/** The deterministic fleet-issue title: "Recurring <bucket> on <target>[ — <tool>]". */
export function clusterTitle(finding: ErrorFinding, target: ResolvedTarget): string {
  const toolPart = finding.toolName ? ` — ${finding.toolName}` : "";
  return `Recurring ${humanize(finding.bucket)} on ${target.name}${toolPart}`;
}

/** The deterministic fleet-issue summary (no LLM): the category + target + the last exact error, if any. */
export function clusterSummary(finding: ErrorFinding, target: ResolvedTarget): string {
  const evidence = finding.errorMessage ? ` Last error: ${snippet(finding.errorMessage)}.` : "";
  return `A recurring ${humanize(finding.category)} clustered across runs on the ${target.kind} "${target.name}".${evidence}`;
}

function humanize(raw: string | RootCauseBucket): string {
  return String(raw).replace(/_/g, " ");
}

/** Collapse whitespace + bound a string (mirrors the AR pipeline's MAX_SNIPPET_CHARS discipline). */
function snippet(text: string): string {
  const collapsed = (text ?? "").replace(/\s+/g, " ").trim();
  if (!collapsed) return "(no message)";
  return collapsed.length <= MAX_SNIPPET_CHARS
    ? collapsed
    : `${collapsed.slice(0, MAX_SNIPPET_CHARS)}…`;
}
