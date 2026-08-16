import crypto from "node:crypto";
import {
  AUTO_RATING_VERSION,
  CLAUDE_CLI_PROVIDER_ID,
  type ErrorFinding,
  errorFindingSchema,
  type JudgeSettings,
  RATING_ISSUE_SEVERITIES,
  type RatingIssue,
  type RatingIssueSeverity,
  type RatingIssueTargetKind,
  type RunDetail,
  type RunGrade,
} from "@mcp-token-footprint/shared";
import { isModelPriced } from "../providers/pricing.js";
import { ERROR_FORENSICS_ID } from "./error-forensics.js";
import type { RatingIssueOccurrenceInsert, RatingIssueRepository } from "./issue-repository.js";
import {
  DEFAULT_JUDGE_QUEUE_BACKSTOP_MS,
  type JudgeGenerate,
  type JudgeGenerateResult,
} from "./judge.js";

/**
 * Rating Issues registry (Auto-Rating follow-on) — turns a rated run's `error_forensics` findings into
 * DISTINCT, deduplicated, persistent issues against the CONCRETE skills / MCP servers the run used,
 * linking every contributing run as an occurrence. Runs after EVERY run rating (the run-service
 * post-`gradeRun` hook + the manual re-grade route). Owner-locked behavior:
 *
 *   - **CLI-first judge chain** — dedup/triage is ONE schema-constrained judge call per finding-target
 *     pair through the SAME `resolveChainJudge`/`judgeChainGenerate` instances every other LLM grading
 *     surface uses (AR2); the AR14 semaphore inside the chain already serializes CLI calls, and the
 *     outer bound here is the generous {@link DEFAULT_JUDGE_QUEUE_BACKSTOP_MS} backstop.
 *   - **Never lose a finding** — no judge / a failed call / an unparseable response falls back to a
 *     DETERMINISTIC match on (bucket, fixTarget) per target, else a templated new issue.
 *   - **No duplicates** — a judge `matchIssueId` is validated against the fetched candidate list (an
 *     invented id is treated as "no match" → new issue); reprocessing a run is a strict no-op via the
 *     per-(target, run, finding-digest) occurrence key.
 *   - **open → resolved → automatic re-open** — a resolved issue seen again re-opens.
 *   - **Fully guarded** — {@link processRun} NEVER throws to its caller and NEVER affects run
 *     completion or grading (it only reads the persisted run + its grades, and writes issue rows).
 *     It never executes skills/tools — read-only over run data (B15/AR11).
 */

/** How many existing issues (open first) are shown to the dedup judge per finding-target pair. */
export const MAX_JUDGE_ISSUE_CANDIDATES = 20;

/** Longest snippet of any finding/message content fed into the judge prompt or persisted as an excerpt. */
const MAX_SNIPPET_CHARS = 400;

/** Bounds on judge-authored fields (a runaway generation never bloats a row). */
const MAX_TITLE_CHARS = 120;
const MAX_TEXT_CHARS = 2000;

/** Frames the judge as a dedup/triage analyst maintaining the issue registry. */
export const ISSUE_TRIAGE_SYSTEM =
  "You are a meticulous triage analyst maintaining a deduplicated issue registry for the skills and " +
  "MCP servers exercised by automated test runs. Given one new error finding and the target's " +
  "existing issues, you decide whether the finding is a NEW distinct underlying problem or another " +
  "sighting of an existing issue, and you write a crisp developer-facing title, summary, and drafted " +
  "fix. You respond with ONLY the requested raw JSON object.";

/** Severity rank for the max-wins enhance rule. */
const SEVERITY_RANK: Record<RatingIssueSeverity, number> = { low: 0, medium: 1, high: 2 };

/** A concrete issue target resolved from the run (a skill the run loaded / a server it called). */
export type ResolvedIssueTarget = {
  kind: RatingIssueTargetKind;
  id: string;
  name: string;
  skillVersionId?: string;
};

/** The validated judge triage verdict (all fields already bounded/sanitized). */
type TriageVerdict = {
  matchIssueId: string | null;
  title?: string;
  summary?: string;
  draftFix?: string;
  severity?: RatingIssueSeverity;
  judgeProviderId: string | null;
  judgeModel: string | null;
};

/**
 * Injected dependencies — STRUCTURAL types so tests stub them without heavyweight wiring, and so this
 * module (like every grading module) never imports an execution surface. Production wires the real
 * repositories/services and the SAME judge-chain instances built in `index.ts`.
 */
export type RatingIssueServiceDeps = {
  issues: RatingIssueRepository;
  /** `RunRepository.getRun` — the persisted run detail (steps carry `serverId`; `skills` the resolutions). */
  runs: { getRun(runId: string): RunDetail };
  /** `GradeRepository.latestByGrader` — the run's newest grade per grader (error_forensics evidence). */
  grades: { latestByGrader(runId: string): RunGrade[] };
  /** `ScenarioService.get` — the `allowedServers` fallback when the run has no tool-call evidence. */
  scenarios: { get(id: string): { allowedServers: Array<{ serverId: string }> } };
  /** `ServerRepository.getPublic` — server display names (redacted config; only `name` is read). */
  servers: { getPublic(id: string): { name: string } };
  /** The SAME chain resolver every LLM grading surface uses (`chainJudgeResolver` in index.ts). */
  resolveJudge: () => JudgeSettings | null;
  /** The SAME chain generate (`createJudgeChainGenerate` in index.ts); tests inject a stub. */
  generate: JudgeGenerate;
  /** Outer bound on one triage call (incl. CLI queue wait); defaults to {@link DEFAULT_JUDGE_QUEUE_BACKSTOP_MS}. */
  timeoutMs?: number;
};

export class RatingIssueService {
  private readonly timeoutMs: number;

  constructor(private readonly deps: RatingIssueServiceDeps) {
    this.timeoutMs = deps.timeoutMs ?? DEFAULT_JUDGE_QUEUE_BACKSTOP_MS;
  }

  /**
   * Fold the run's LATEST `error_forensics` findings into the issue registry. FULLY GUARDED — never
   * throws to the caller (mirrors the run-service `gradeRun` hook's crash-safety), never touches the
   * run/grades, never executes anything. A per-(target, finding) failure loses only that pair.
   */
  async processRun(runId: string): Promise<void> {
    try {
      const run = this.deps.runs.getRun(runId);
      const findings = latestForensicsFindings(this.deps.grades.latestByGrader(runId));
      const actionable = findings.filter(
        (f) => f.fixTarget === "skill" || f.fixTarget === "mcp_server",
      );
      if (actionable.length === 0) return;

      for (const finding of actionable) {
        const digest = findingDigest(finding);
        const targets = this.resolveTargets(run, finding.fixTarget as RatingIssueTargetKind);
        for (const target of targets) {
          try {
            await this.applyFinding(run, finding, target, digest);
          } catch {
            // Never lose the REST of the findings/targets over one failed pair.
          }
        }
      }
    } catch {
      // Crash safety (HARD rule): issue processing must NEVER affect run completion or grading.
    }
  }

  // ── target resolution ─────────────────────────────────────────────────────────────────────────

  /**
   * Resolve a finding's fix target to the CONCRETE entity/entities of THIS run:
   *   - `skill` → every skill the run resolved/loaded (`run_skills` → {@link RunDetail.skills}),
   *     pinning the resolved version id.
   *   - `mcp_server` → the distinct servers whose tools the run actually exercised (tool steps'
   *     `serverId`), falling back to the scenario's `allowedServers` when no tool-step evidence exists
   *     (e.g. a connection failure before the first call).
   * An empty result means the finding has no concrete target on this run → it is skipped (no issue).
   */
  private resolveTargets(run: RunDetail, kind: RatingIssueTargetKind): ResolvedIssueTarget[] {
    if (kind === "skill") {
      const skills = Array.isArray(run.skills) ? run.skills : [];
      return skills.map((s) => ({
        kind: "skill" as const,
        id: s.skillId,
        name: s.name || s.skillId,
        ...(s.skillVersionId ? { skillVersionId: s.skillVersionId } : {}),
      }));
    }

    const serverIds = new Set<string>();
    for (const step of Array.isArray(run.steps) ? run.steps : []) {
      if (step.type !== "tool_call" && step.type !== "tool_result") continue;
      if (typeof step.serverId === "string" && step.serverId) serverIds.add(step.serverId);
    }
    if (serverIds.size === 0) {
      // No tool-step evidence → the scenario's allow-list is the honest fallback.
      try {
        for (const allowed of this.deps.scenarios.get(run.scenarioId).allowedServers) {
          if (allowed.serverId) serverIds.add(allowed.serverId);
        }
      } catch {
        // Scenario deleted after the run → no fallback evidence; skip.
      }
    }
    return [...serverIds].map((id) => ({
      kind: "mcp_server" as const,
      id,
      name: this.serverName(id),
    }));
  }

  /** Display name of a server (falls back to the id when the server was deleted after the run). */
  private serverName(serverId: string): string {
    try {
      return this.deps.servers.getPublic(serverId).name || serverId;
    } catch {
      return serverId;
    }
  }

  // ── per-(finding, target) create-or-enhance ───────────────────────────────────────────────────

  private async applyFinding(
    run: RunDetail,
    finding: ErrorFinding,
    target: ResolvedIssueTarget,
    digest: string,
  ): Promise<void> {
    // Idempotency short-circuit: this exact sighting was already folded in (reprocessing a run after a
    // re-grade with unchanged findings) → strict no-op, no judge call, no counter bump.
    if (this.deps.issues.hasOccurrence(target.kind, target.id, run.id, digest)) return;

    const existing = this.deps.issues.listByTarget(
      target.kind,
      target.id,
      undefined,
      MAX_JUDGE_ISSUE_CANDIDATES,
    );
    const occurrence: RatingIssueOccurrenceInsert = {
      runId: run.id,
      suiteRunId: run.suiteRunId ?? null,
      findingDigest: digest,
      category: finding.category,
      message: snippet(finding.description),
      // Carry the finding's CONCRETE failure evidence onto the occurrence so the issue shows the real
      // wrong call + exact error (not just a category). Already redacted + bounded upstream.
      ...(finding.toolName ? { toolName: finding.toolName } : {}),
      ...(finding.sentArguments ? { sentArguments: snippet(finding.sentArguments) } : {}),
      ...(finding.errorMessage ? { errorMessage: snippet(finding.errorMessage) } : {}),
    };

    const verdict = await this.tryJudgeTriage(finding, target, existing);
    if (verdict) {
      // `matchIssueId` is only honored when it names one of the CANDIDATES WE SHOWED the judge — an
      // invented/hallucinated id is treated as "no match" (a new issue), never trusted.
      const match = verdict.matchIssueId
        ? existing.find((issue) => issue.id === verdict.matchIssueId)
        : undefined;
      if (match) {
        this.enhance(match, occurrence, {
          ...(verdict.summary ? { summary: verdict.summary } : {}),
          ...(verdict.draftFix ? { draftFix: verdict.draftFix } : {}),
          severity: maxSeverity(match.severity, verdict.severity ?? match.severity),
          judgeProviderId: verdict.judgeProviderId,
          judgeModel: verdict.judgeModel,
        });
        return;
      }
      this.deps.issues.insert({
        targetKind: target.kind,
        targetId: target.id,
        targetName: target.name,
        skillVersionId: target.skillVersionId ?? null,
        title: verdict.title ?? templatedTitle(finding, target),
        summary: verdict.summary ?? snippet(finding.description),
        bucket: finding.bucket,
        fixTarget: finding.fixTarget,
        draftFix: verdict.draftFix ?? finding.draftFix,
        severity: verdict.severity ?? "medium",
        ratingVersion: AUTO_RATING_VERSION,
        judgeProviderId: verdict.judgeProviderId,
        judgeModel: verdict.judgeModel,
        occurrence,
      });
      return;
    }

    // DETERMINISTIC fallback (no judge / failed / unparseable) — never lose a finding: fold into the
    // target's existing issue with the same (bucket, fixTarget) key, else create a templated one.
    const match = existing.find(
      (issue) => issue.bucket === finding.bucket && issue.fixTarget === finding.fixTarget,
    );
    if (match) {
      this.enhance(match, occurrence, {});
      return;
    }
    this.deps.issues.insert({
      targetKind: target.kind,
      targetId: target.id,
      targetName: target.name,
      skillVersionId: target.skillVersionId ?? null,
      title: templatedTitle(finding, target),
      summary: snippet(finding.description),
      bucket: finding.bucket,
      fixTarget: finding.fixTarget,
      draftFix: finding.draftFix,
      severity: "medium",
      ratingVersion: AUTO_RATING_VERSION,
      judgeProviderId: null,
      judgeModel: null,
      occurrence,
    });
  }

  /** One more sighting: touch (times_seen+1, judge patch), AUTOMATIC re-open if resolved, link the run. */
  private enhance(
    issue: RatingIssue,
    occurrence: RatingIssueOccurrenceInsert,
    patch: Parameters<RatingIssueRepository["touch"]>[1],
  ): void {
    this.deps.issues.touch(issue.id, patch);
    if (issue.status === "resolved") this.deps.issues.setStatus(issue.id, "open");
    this.deps.issues.addOccurrence(issue.id, occurrence);
  }

  // ── the ONE dedup/triage judge call ───────────────────────────────────────────────────────────

  /**
   * ONE schema-constrained judge call for this finding-target pair, through the SAME CLI-first chain
   * every LLM grading surface uses. Returns `null` (→ deterministic fallback) when: no judge is
   * resolvable, the configured PROVIDER model is unpriced (the CLI subscription is exempt, mirroring
   * the error-forensics guard), the call fails/times out, or the response is unparseable.
   */
  private async tryJudgeTriage(
    finding: ErrorFinding,
    target: ResolvedIssueTarget,
    existing: RatingIssue[],
  ): Promise<TriageVerdict | null> {
    const settings = this.deps.resolveJudge();
    if (!settings || !settings.providerCredentialId || !settings.model) return null;
    const isCli = settings.providerCredentialId === CLAUDE_CLI_PROVIDER_ID;
    if (!isCli && !isModelPriced(settings.model)) return null;

    let gen: JudgeGenerateResult;
    try {
      gen = await callWithTimeout(
        (signal) =>
          this.deps.generate(settings, buildTriagePrompt(finding, target, existing), {
            system: ISSUE_TRIAGE_SYSTEM,
            signal,
          }),
        this.timeoutMs,
      );
    } catch {
      return null;
    }

    const obj = extractJsonObject(gen.text);
    if (!obj) return null;
    const matchIssueId =
      typeof obj.matchIssueId === "string" && obj.matchIssueId ? obj.matchIssueId : null;
    const title = asBoundedString(obj.title, MAX_TITLE_CHARS);
    const summary = asBoundedString(obj.summary, MAX_TEXT_CHARS);
    const draftFix = asBoundedString(obj.draftFix, MAX_TEXT_CHARS);
    const severity = asSeverity(obj.severity);
    return {
      matchIssueId,
      ...(title ? { title } : {}),
      ...(summary ? { summary } : {}),
      ...(draftFix ? { draftFix } : {}),
      ...(severity ? { severity } : {}),
      // Provenance: the chain's actual-source override is PREFERRED (a CLI row reads claude_cli).
      judgeProviderId: gen.judgeProviderId ?? settings.providerCredentialId,
      judgeModel: gen.judgeModel ?? settings.model,
    };
  }
}

// ── manual issue filing (Assistant `rating_issue_file` action) ──────────────────────────────────────

/** Input to {@link fileManualRatingIssue} — an owner-filed issue (via the Assistant, not the pipeline). */
export type ManualRatingIssueInput = {
  targetKind: RatingIssueTargetKind;
  targetId: string;
  targetName: string;
  title: string;
  summary: string;
  severity: RatingIssueSeverity;
  draftFix?: string;
  /** The run being analyzed — its occurrence provides the (NOT NULL) contributing-run link. */
  runId: string;
  suiteRunId?: string | null;
  /** Pin the skill version the issue was filed against (skill targets only). */
  skillVersionId?: string | null;
};

/**
 * File a MANUAL rating issue against a skill / MCP server — the Assistant's `rating_issue_file` action,
 * DISTINCT from the auto-rating `error_forensics` pipeline ({@link RatingIssueService.processRun}). No
 * judge call (the owner authored the title/summary). Light dedup mirroring the service's deterministic
 * fallback: an EXISTING issue for the same (target, normalized title) is ENHANCED (one more occurrence,
 * `times_seen + 1`, re-opened if it was resolved) rather than duplicated; otherwise a new issue is
 * created. `bucket`/`fixTarget` are set to the target kind (`skill`/`mcp_server` — both valid enum
 * values). Returns the created/enhanced issue. Never throws for a benign reason — surfaces repository
 * 404s (e.g. a bad target) so the caller's `safeTool` reports them.
 */
export function fileManualRatingIssue(
  issues: RatingIssueRepository,
  input: ManualRatingIssueInput,
): RatingIssue {
  const title = asBoundedString(input.title, MAX_TITLE_CHARS) ?? "Manually filed issue";
  const summary = asBoundedString(input.summary, MAX_TEXT_CHARS) ?? snippet(input.summary);
  const draftFix = input.draftFix ? (asBoundedString(input.draftFix, MAX_TEXT_CHARS) ?? "") : "";
  const digest = manualFindingDigest(input.targetKind, input.targetId, title);
  const occurrence: RatingIssueOccurrenceInsert = {
    runId: input.runId,
    suiteRunId: input.suiteRunId ?? null,
    findingDigest: digest,
    category: "manual",
    message: summary,
  };

  const normalizedTitle = normalizeForMatch(title);
  const existing = issues
    .listByTarget(input.targetKind, input.targetId, undefined, MAX_JUDGE_ISSUE_CANDIDATES)
    .find((issue) => normalizeForMatch(issue.title) === normalizedTitle);
  if (existing) {
    issues.touch(existing.id, {
      summary,
      ...(draftFix ? { draftFix } : {}),
      severity: maxSeverity(existing.severity, input.severity),
    });
    if (existing.status === "resolved") issues.setStatus(existing.id, "open");
    issues.addOccurrence(existing.id, occurrence);
    return issues.get(existing.id);
  }

  return issues.insert({
    targetKind: input.targetKind,
    targetId: input.targetId,
    targetName: input.targetName,
    skillVersionId: input.skillVersionId ?? null,
    title,
    summary,
    bucket: input.targetKind, // "skill" | "mcp_server" — both valid ROOT_CAUSE_BUCKETS
    fixTarget: input.targetKind, // "skill" | "mcp_server" — both valid FIX_TARGETS
    draftFix,
    severity: input.severity,
    ratingVersion: AUTO_RATING_VERSION,
    judgeProviderId: null,
    judgeModel: null,
    occurrence,
  });
}

/** The manual-issue occurrence digest: a stable hash of target + normalized title (dedup idempotency key). */
function manualFindingDigest(
  targetKind: RatingIssueTargetKind,
  targetId: string,
  title: string,
): string {
  return crypto
    .createHash("sha256")
    .update(`manual|${targetKind}|${targetId}|${normalizeForMatch(title)}`)
    .digest("hex")
    .slice(0, 24);
}

/** Lowercase + whitespace-collapse + trim, for title-equality dedup (mirrors the finding-digest normalization). */
function normalizeForMatch(text: string): string {
  return (text ?? "").toLowerCase().replace(/\s+/g, " ").trim();
}

// ── pure helpers (exported for unit tests) ─────────────────────────────────────────────────────────

/** The run's latest `error_forensics` findings, each schema-validated (invalid entries dropped). */
export function latestForensicsFindings(latestGrades: RunGrade[]): ErrorFinding[] {
  const grade = latestGrades.find((g) => g.graderId === ERROR_FORENSICS_ID);
  if (!grade || grade.status !== "graded" || !Array.isArray(grade.evidence)) return [];
  const findings: ErrorFinding[] = [];
  for (const entry of grade.evidence) {
    const parsed = errorFindingSchema.safeParse(entry);
    if (parsed.success) findings.push(parsed.data as ErrorFinding);
  }
  return findings;
}

/**
 * The deterministic per-finding digest: a stable hash of category + bucket + fixTarget + the
 * NORMALIZED message (lowercased, whitespace-collapsed, bounded). Together with the run id it forms
 * the occurrence idempotency key — reprocessing a run never duplicates an occurrence.
 */
export function findingDigest(finding: ErrorFinding): string {
  const normalized = (finding.description ?? "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_SNIPPET_CHARS);
  return crypto
    .createHash("sha256")
    .update(`${finding.category}|${finding.bucket}|${finding.fixTarget}|${normalized}`)
    .digest("hex")
    .slice(0, 24);
}

/** The no-judge issue title: "<bucket> in <targetName>". */
export function templatedTitle(finding: ErrorFinding, target: ResolvedIssueTarget): string {
  return `${finding.bucket} in ${target.name}`;
}

/** Build the ONE triage prompt: the new finding + the target's existing issues (all content bounded). */
export function buildTriagePrompt(
  finding: ErrorFinding,
  target: ResolvedIssueTarget,
  existing: readonly RatingIssue[],
): string {
  const issueList =
    existing.length === 0
      ? "(none yet)"
      : existing
          .map(
            (issue, i) =>
              `[${i + 1}] id: ${issue.id}\n  status: ${issue.status} · severity: ${issue.severity} · seen ${issue.timesSeen}×\n  title: ${snippet(issue.title)}\n  summary: ${snippet(issue.summary)}`,
          )
          .join("\n\n");
  // The CONCRETE failure evidence (the actual wrong call + the exact error) — so the judge dedups on
  // the underlying problem and writes a summary/draftFix that names the specific parameter at fault.
  const evidenceLines = [
    finding.toolName ? `tool: ${finding.toolName}` : "",
    finding.sentArguments ? `arguments sent: ${snippet(finding.sentArguments)}` : "",
    finding.errorMessage ? `exact error: ${snippet(finding.errorMessage)}` : "",
  ].filter(Boolean);
  const evidenceBlock = evidenceLines.length > 0 ? `\n${evidenceLines.join("\n")}` : "";
  return `A rated test run produced a new error finding against the ${target.kind} "${target.name}". Decide whether it is another sighting of an EXISTING issue below or a NEW distinct underlying problem, and write the improved issue fields.

### New finding
category: ${finding.category}
root-cause bucket: ${finding.bucket}
fix target: ${finding.fixTarget}
what happened: ${snippet(finding.description)}${evidenceBlock}
drafted fix so far: ${snippet(finding.draftFix)}

### Existing issues for this ${target.kind}
${issueList}

### Instructions
* Respond with ONLY a raw JSON object: { "matchIssueId": string|null, "title": string, "summary": string, "draftFix": string, "severity": "low"|"medium"|"high" }.
* "matchIssueId": the exact id of the ONE existing issue that describes the SAME underlying problem, or null when this is a new distinct problem. Only use an id that appears above — never invent one.
* "title": a concise developer-facing issue title (max ${MAX_TITLE_CHARS} chars).
* "summary": what is wrong and its impact, written for the ${target.kind}'s developer.
* "draftFix": a concrete, actionable suggestion (never auto-applied).
* "severity": the operational severity of the underlying problem.
* Respond with ONLY the JSON object, nothing else.
`;
}

/** Max-wins severity (an enhance only ever raises severity). */
export function maxSeverity(
  a: RatingIssueSeverity,
  b: RatingIssueSeverity,
): RatingIssueSeverity {
  return SEVERITY_RANK[a] >= SEVERITY_RANK[b] ? a : b;
}

function asSeverity(value: unknown): RatingIssueSeverity | undefined {
  return typeof value === "string" &&
    (RATING_ISSUE_SEVERITIES as readonly string[]).includes(value)
    ? (value as RatingIssueSeverity)
    : undefined;
}

function asBoundedString(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.replace(/\s+/g, " ").trim();
  if (!trimmed) return undefined;
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max)}…`;
}

/** Collapse whitespace + bound a string (mirrors error-forensics' MAX_SNIPPET_CHARS discipline). */
function snippet(text: string): string {
  const collapsed = (text ?? "").replace(/\s+/g, " ").trim();
  if (!collapsed) return "(no message)";
  return collapsed.length <= MAX_SNIPPET_CHARS
    ? collapsed
    : `${collapsed.slice(0, MAX_SNIPPET_CHARS)}…`;
}

/**
 * Strip a Markdown code fence, then take the outermost `{ … }` and JSON.parse it. Null on any failure.
 * (A local copy of the suite-report-service pattern — deliberately NOT imported across layers.)
 */
function extractJsonObject(text: string): Record<string, unknown> | null {
  if (!text) return null;
  const cleaned = stripFences(text);
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    const parsed: unknown = JSON.parse(cleaned.slice(start, end + 1));
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function stripFences(text: string): string {
  const trimmed = text.trim();
  if (!trimmed.startsWith("```")) return trimmed;
  return trimmed
    .replace(/^```[a-zA-Z]*\n?/, "")
    .replace(/```\s*$/, "")
    .trim();
}

/**
 * Race `run` (given a fresh abort signal) against a timeout: on timeout the signal aborts AND the race
 * rejects, so the triage ALWAYS settles (the caller falls back to the deterministic path — never a hang).
 */
async function callWithTimeout<T>(
  run: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error(`rating-issue triage call timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });
  try {
    return await Promise.race([run(controller.signal), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
