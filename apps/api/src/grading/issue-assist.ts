import crypto from "node:crypto";
import {
  CLAUDE_CLI_PROVIDER_ID,
  ISSUE_ASSIST_MAX_CANDIDATES,
  ISSUE_ASSIST_STATE_KEY,
  type IssueAssistGroup,
  type IssueAssistLedger,
  issueAssistJudgeOutputSchema,
  type IssueAssistPriority,
  type IssueAssistResult,
  type IssueAssistState,
  type IssueAssistUnmergeResult,
  type JudgeSettings,
  type RatingIssue,
} from "@mcp-token-footprint/shared";
import { estimateCost, isModelPriced } from "../providers/pricing.js";
import { AsyncSemaphore, type ConcurrencyGate } from "../testing/subscription-concurrency.js";
import { httpError } from "../utils/errors.js";
import type { RatingIssueRepository } from "./issue-repository.js";
import {
  DEFAULT_JUDGE_QUEUE_BACKSTOP_MS,
  type JudgeGenerate,
  type JudgeGenerateResult,
} from "./judge.js";

/**
 * LLM assist for issue clustering (Observability WP5.2, D-OB20) — the OPT-IN pass OVER the
 * deterministic fleet clusters (WP5.1). It NEVER changes the deterministic substrate: the cluster
 * keys keep accruing to their own `rating_issues` rows underneath (see {@link IssueSweepService}),
 * and this module only ADDS a reversible OVERLAY on top — near-duplicate fleet issues merged into a
 * merge-link, an AI-written title/summary, and a SUGGESTED priority. Owner-locked invariants:
 *
 *   - **OFF by default.** No pass runs unless the manual refine endpoint is called or
 *     `ISSUE_ASSIST_AFTER_SWEEP=true` (default false) is set; the deterministic sweep is untouched
 *     and NEVER blocked ({@link maybeRunAfterSweep} is fully guarded).
 *   - **Own concurrency + own setting** (the unified Q7 lesson) — the pass acquires its OWN
 *     {@link ConcurrencyGate} (`ISSUE_ASSIST_MAX_CONCURRENCY`), NOT the Auto-Rating CLI-judge budget.
 *   - **Same CLI-first judge chain** — resolution + provenance ride the SAME `resolveJudge`/`generate`
 *     the graders use (AR2); an unpriced PROVIDER model is refused (the CLI subscription is exempt),
 *     mirroring the error-forensics / triage guard.
 *   - **Own cost ledger** (B5 discipline) — assist LLM cost is recorded to the SEPARATE assist ledger
 *     (an `app_settings` JSON document), apart from run cost AND from grade cost; surfaced in issue
 *     settings. A CLI (subscription) call records real tokens at cost 0 (AR13).
 *   - **Schema-constrained + safe degradation** — the judge output is ZOD-validated
 *     ({@link issueAssistJudgeOutputSchema}); a malformed response degrades to a SKIP (no group
 *     applied), never a corrupted issue. A proposed member id not in the shown candidate set is
 *     DROPPED (an invented id is never trusted).
 *   - **Marked + reversible** — AI-written text is stamped (`aiAssisted:true`, model, timestamp); the
 *     deterministic per-issue fallback text ALWAYS stays on the row; the suggested priority is
 *     SURFACED only (the issue rows' `severity` is untouched); an unmerge drops the group and restores
 *     the originals (which were never mutated).
 *
 * Offline-testable via the SAME seam as the other grading services: `resolveJudge`/`generate` are
 * injected, the OWN gate is injectable, and the merge-link/ledger store is a thin wrapper over the
 * generic KV — tests inject a FAKE judge; no real CLI/provider is ever contacted.
 */

/** Longest AI-written title persisted (a runaway generation never bloats the overlay). */
const MAX_TITLE_CHARS = 120;
/** Longest AI-written summary / rationale persisted. */
const MAX_TEXT_CHARS = 2000;
/** Longest occurrence / issue-field excerpt fed into the prompt. */
const MAX_SNIPPET_CHARS = 400;
/** How many most-recent occurrences of each issue are shown to the judge as forensics summaries. */
const TOP_OCCURRENCES_PER_ISSUE = 3;

/** Frames the judge as a fleet-issue triage analyst deduplicating clusters + writing operator copy. */
export const ISSUE_ASSIST_SYSTEM =
  "You are a meticulous reliability analyst curating a registry of recurring fleet issues (deterministic " +
  "failure clusters) for the skills and MCP servers exercised by automated test runs. Given a set of " +
  "open fleet issues and their linked-run forensics, you group near-duplicate issues that describe the " +
  "SAME underlying problem, write a crisp developer-facing title and summary for each group, and suggest " +
  "an operational priority. You respond with ONLY the requested raw JSON object.";

/** The empty assist overlay — the defensive default when the KV is absent/corrupt. */
export function emptyAssistState(): IssueAssistState {
  return {
    groups: [],
    ledger: { calls: 0, tokensIn: 0, tokensOut: 0, costUsd: 0, lastProviderId: null, lastModel: null, lastAt: null },
  };
}

/**
 * The assist overlay store — a thin, defensive read/modify/write wrapper over the generic `app_settings`
 * KV (a deliberate NON-migration, WP5.2). Holds the applied merge groups + the separate cost ledger as
 * ONE JSON document under {@link ISSUE_ASSIST_STATE_KEY}. Every read repairs a missing/corrupt document
 * to {@link emptyAssistState}; every write is a full-document upsert (last write wins — this is a
 * single-owner local tool). The deterministic `rating_issues` rows are NEVER touched here.
 */
export class IssueAssistStore {
  constructor(private readonly settings: { get(key: string): unknown; put(key: string, value: unknown): void }) {}

  /** The persisted overlay, repaired to {@link emptyAssistState} on any absence/corruption. */
  read(): IssueAssistState {
    const raw = this.settings.get(ISSUE_ASSIST_STATE_KEY);
    return normalizeState(raw);
  }

  /** Overwrite the overlay (full-document upsert). */
  write(state: IssueAssistState): void {
    this.settings.put(ISSUE_ASSIST_STATE_KEY, state);
  }
}

/** Injected dependencies — structural where possible so tests stub without heavyweight wiring. */
export type IssueAssistServiceDeps = {
  /** The rating-issue repository — READ methods only (`listAll`, `get`); issue rows are never mutated. */
  issues: RatingIssueRepository;
  /** The overlay store (merge-links + the separate cost ledger). */
  store: IssueAssistStore;
  /** The SAME chain resolver every LLM grading surface uses (`chainJudgeResolver` in index.ts). */
  resolveJudge: () => JudgeSettings | null;
  /** The SAME chain generate (`createJudgeChainGenerate` in index.ts); tests inject a FAKE. */
  generate: JudgeGenerate;
  /**
   * The OWN concurrency gate for assist PASSES (`ISSUE_ASSIST_MAX_CONCURRENCY`) — DELIBERATELY separate
   * from the Auto-Rating CLI-judge budget (the Q7 lesson). Defaults to a private `AsyncSemaphore(1)`.
   */
  gate?: ConcurrencyGate;
  /** Run the pass automatically after each sweep (`ISSUE_ASSIST_AFTER_SWEEP`). Default false (OFF). */
  enabledAfterSweep?: boolean;
  /** Outer bound on one assist judge call (incl. queue wait); defaults to {@link DEFAULT_JUDGE_QUEUE_BACKSTOP_MS}. */
  timeoutMs?: number;
  /** The clock (defaults to `Date.now`); a test injects a fixed one. */
  now?: () => number;
};

export class IssueAssistService {
  private readonly gate: ConcurrencyGate;
  private readonly enabledAfterSweep: boolean;
  private readonly timeoutMs: number;
  private readonly now: () => number;

  constructor(private readonly deps: IssueAssistServiceDeps) {
    this.gate = deps.gate ?? new AsyncSemaphore(1);
    this.enabledAfterSweep = deps.enabledAfterSweep ?? false;
    this.timeoutMs = deps.timeoutMs ?? DEFAULT_JUDGE_QUEUE_BACKSTOP_MS;
    this.now = deps.now ?? Date.now;
  }

  /** The persisted overlay (applied merge groups + the separate cost ledger) — for the settings surface. */
  getState(): IssueAssistState {
    return this.deps.store.read();
  }

  /**
   * Refine EVERY open fleet issue in one pass: the judge proposes merge groups over the open clusters
   * (bounded to {@link ISSUE_ASSIST_MAX_CANDIDATES}), which are validated + applied as reversible
   * merge-links. Deterministic issue rows are never mutated.
   */
  async refineList(): Promise<IssueAssistResult> {
    const open = this.openFleetIssues();
    return this.refineOver(open, open);
  }

  /**
   * Refine ONE fleet issue: the judge sees that issue plus the OTHER open fleet issues on the SAME
   * target (the only candidates a merge is ever allowed to span), and may merge near-duplicates into
   * it. The refined group is applied (reversibly). 404 on an unknown id; a non-fleet (per-run AR) issue
   * is not refinable (skip).
   */
  async refineIssue(issueId: string): Promise<IssueAssistResult> {
    const issue = this.deps.issues.get(issueId); // typed 404 on an unknown id
    if (!issue.fleet) return skip("issue is not a deterministically-clustered fleet issue");
    const sameTarget = this.openFleetIssues().filter(
      (i) => i.targetKind === issue.targetKind && i.targetId === issue.targetId,
    );
    // Ensure the requested issue is present even if it is not `open` (e.g. `regressed` still qualifies,
    // but a `resolved` one the operator explicitly refines should still be shown).
    const shown = sameTarget.some((i) => i.id === issue.id) ? sameTarget : [issue, ...sameTarget];
    return this.refineOver(shown, shown);
  }

  /**
   * Run the assist pass automatically after a sweep — ONLY when `ISSUE_ASSIST_AFTER_SWEEP` is enabled
   * (default OFF). FULLY GUARDED: it NEVER throws and NEVER blocks the sweep (observer discipline), so
   * an assist error can never break the deterministic clustering. Returns the pass result (or a skip).
   */
  async maybeRunAfterSweep(): Promise<IssueAssistResult> {
    if (!this.enabledAfterSweep) return skip("assist-after-sweep is disabled");
    try {
      return await this.refineList();
    } catch {
      // An assist failure must NEVER affect the sweep (isolation) — swallow + report a skip.
      return skip("assist pass errored (isolated from the sweep)");
    }
  }

  /**
   * Undo a merge: drop the group from the overlay and restore the originals (which were never mutated —
   * the deterministic rows keep accruing underneath). 404 on an unknown group id.
   */
  unmerge(groupId: string): IssueAssistUnmergeResult {
    const state = this.deps.store.read();
    const removed = state.groups.find((g) => g.id === groupId);
    if (!removed) throw httpError(404, "Assist merge group not found");
    this.deps.store.write({
      ...state,
      groups: state.groups.filter((g) => g.id !== groupId),
    });
    return { removed, restoredIssueIds: [...removed.issueIds] };
  }

  // ── the ONE assist judge call + apply ─────────────────────────────────────────────────────────

  /**
   * The shared pass body: resolve the judge, guard an unpriced provider model, make ONE
   * schema-constrained call under the OWN gate, validate + apply the proposed groups, and record the
   * call's cost to the SEPARATE ledger. `candidates` are the issues the proposed member ids are
   * validated against (never trusts an invented id); `shown` are the issues put in the prompt.
   */
  private async refineOver(shown: RatingIssue[], candidates: RatingIssue[]): Promise<IssueAssistResult> {
    if (shown.length === 0) return skip("no open fleet issues to refine");

    const settings = this.deps.resolveJudge();
    if (!settings || !settings.providerCredentialId || !settings.model) {
      return skip("no judge is available (neither the Claude CLI nor a provider judge is configured)");
    }
    const isCli = settings.providerCredentialId === CLAUDE_CLI_PROVIDER_ID;
    if (!isCli && !isModelPriced(settings.model)) {
      return skip(`the configured provider judge model "${settings.model}" has no known pricing`);
    }

    // ONE judge call, under the OWN gate (bounds concurrent assist PASSES — NOT the CLI-judge budget).
    let gen: JudgeGenerateResult;
    await this.gate.acquire();
    try {
      gen = await callWithTimeout(
        (signal) =>
          this.deps.generate(settings, buildAssistPrompt(shown), {
            system: ISSUE_ASSIST_SYSTEM,
            signal,
          }),
        this.timeoutMs,
      );
    } catch {
      // A failed/timed-out call (the chain already exhausted its CLI→provider→throw fallback) → SKIP.
      // No usage → nothing is recorded to the ledger (mirrors the judge.ts error-row discipline).
      return skip("assist judge call failed or timed out");
    } finally {
      this.gate.release();
    }

    // The call completed → record its cost honestly, whatever the parse outcome (tokens were spent).
    const judgeModel = gen.judgeModel ?? settings.model;
    const judgeProviderId = gen.judgeProviderId ?? settings.providerCredentialId;
    const costUsd =
      gen.judgeCostUsd ??
      (judgeModel ? estimateCost(judgeModel, { inputTokens: gen.usage.inputTokens, outputTokens: gen.usage.outputTokens }) : 0);
    const cost = {
      judgeProviderId,
      judgeModel,
      tokensIn: gen.usage.inputTokens,
      tokensOut: gen.usage.outputTokens,
      costUsd,
    };

    const parsed = issueAssistJudgeOutputSchema.safeParse(extractJsonObject(gen.text));
    if (!parsed.success) {
      // A malformed LLM response degrades SAFELY (no group applied) — never a corrupted issue. The call
      // still spent tokens, so the cost is recorded honestly; `ran:true` (a judge did run).
      this.recordCost(cost);
      return { ran: true, skipReason: "malformed judge response (schema-invalid)", applied: [], cost };
    }

    const applied = this.buildGroups(parsed.data.groups, candidates, judgeModel);
    this.applyGroupsAndCost(applied, cost);
    return { ran: true, applied, cost };
  }

  /** The open (open|regressed) FLEET issues, bounded — the deterministic clusters the pass refines. */
  private openFleetIssues(): RatingIssue[] {
    return this.deps.issues
      .listAll({})
      .filter((i) => i.fleet && (i.fleet.lifecycle === "open" || i.fleet.lifecycle === "regressed"))
      .slice(0, ISSUE_ASSIST_MAX_CANDIDATES);
  }

  /**
   * Validate + realize the judge's proposed groups into applied merge-links. A member id not among the
   * shown candidates is DROPPED (never trusted); members must share ONE target (a cross-target member is
   * dropped); a group with no surviving member is skipped. The group id is DETERMINISTIC (a stable hash
   * of the sorted member ids) so re-running with the same membership is idempotent (a stable unmerge id).
   */
  private buildGroups(
    proposed: Array<{ issueIds: string[]; title: string; summary: string; suggestedPriority: IssueAssistPriority; rationale: string }>,
    candidates: RatingIssue[],
    model: string | null,
  ): IssueAssistGroup[] {
    const byId = new Map(candidates.map((i) => [i.id, i]));
    const assistedAt = new Date(this.now()).toISOString();
    const out: IssueAssistGroup[] = [];
    const claimed = new Set<string>(); // an issue can belong to at most one applied group per pass
    for (const g of proposed) {
      // Resolve + dedup members against the SHOWN candidates only (drop invented ids + already-claimed).
      const members: RatingIssue[] = [];
      const seen = new Set<string>();
      for (const rawId of g.issueIds) {
        const issue = byId.get(rawId);
        if (!issue || seen.has(issue.id) || claimed.has(issue.id)) continue;
        seen.add(issue.id);
        members.push(issue);
      }
      if (members.length === 0) continue;
      // A merge never spans targets: keep only members on the FIRST valid member's target.
      const target = { kind: members[0]?.targetKind, id: members[0]?.targetId };
      const kept = members.filter((m) => m.targetKind === target.kind && m.targetId === target.id);
      if (kept.length === 0) continue;
      for (const m of kept) claimed.add(m.id);
      const issueIds = kept.map((m) => m.id).sort();
      out.push({
        id: groupId(issueIds),
        issueIds,
        primaryIssueId: pickPrimary(kept),
        title: boundedString(g.title, MAX_TITLE_CHARS) ?? "Recurring issue",
        summary: boundedString(g.summary, MAX_TEXT_CHARS) ?? "",
        suggestedPriority: g.suggestedPriority,
        rationale: boundedString(g.rationale, MAX_TEXT_CHARS) ?? "",
        aiAssisted: true,
        model,
        assistedAt,
      });
    }
    return out;
  }

  /** Persist the applied groups (removing any overlapping prior group) + accrue the ledger in ONE write. */
  private applyGroupsAndCost(applied: IssueAssistGroup[], cost: RecordedCost): void {
    const state = this.deps.store.read();
    // Remove any existing group that shares a member with a newly-applied one (coherent re-refine), then add.
    const newMembers = new Set(applied.flatMap((g) => g.issueIds));
    const kept = state.groups.filter((g) => !g.issueIds.some((id) => newMembers.has(id)));
    this.deps.store.write({
      groups: [...kept, ...applied],
      ledger: accrue(state.ledger, cost, new Date(this.now()).toISOString()),
    });
  }

  /** Record only the cost (a completed-but-malformed call applies no group but still spent tokens). */
  private recordCost(cost: RecordedCost): void {
    const state = this.deps.store.read();
    this.deps.store.write({
      ...state,
      ledger: accrue(state.ledger, cost, new Date(this.now()).toISOString()),
    });
  }
}

// ── pure helpers (exported for unit tests where useful) ────────────────────────────────────────────

type RecordedCost = {
  judgeProviderId: string | null;
  judgeModel: string | null;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
};

/** A skip result (no judge ran / nothing applied / nothing recorded). */
function skip(reason: string): IssueAssistResult {
  return { ran: false, skipReason: reason, applied: [], cost: null };
}

/** Accrue one recorded call into the running assist ledger (B5 — separate from run + grade cost). */
function accrue(ledger: IssueAssistLedger, cost: RecordedCost, at: string): IssueAssistLedger {
  return {
    calls: ledger.calls + 1,
    tokensIn: ledger.tokensIn + cost.tokensIn,
    tokensOut: ledger.tokensOut + cost.tokensOut,
    costUsd: ledger.costUsd + cost.costUsd,
    lastProviderId: cost.judgeProviderId,
    lastModel: cost.judgeModel,
    lastAt: at,
  };
}

/** The DETERMINISTIC merge-group id — a stable hash of the sorted member ids (idempotent re-refine). */
export function groupId(sortedIssueIds: string[]): string {
  const hash = crypto.createHash("sha256").update(`assist|${sortedIssueIds.join(",")}`).digest("hex").slice(0, 20);
  return `grp-${hash}`;
}

/** The canonical (surfaced) issue of a merge group: most occurrences, then earliest first-seen, then id. */
export function pickPrimary(members: RatingIssue[]): string {
  const sorted = [...members].sort((a, b) => {
    const ao = a.fleet?.occurrenceCount ?? a.timesSeen;
    const bo = b.fleet?.occurrenceCount ?? b.timesSeen;
    if (ao !== bo) return bo - ao; // most occurrences first
    if (a.firstSeenAt !== b.firstSeenAt) return a.firstSeenAt < b.firstSeenAt ? -1 : 1; // earliest first
    return a.id < b.id ? -1 : 1; // stable id tie-break
  });
  return sorted[0]?.id ?? members[0]?.id ?? "";
}

/**
 * Build the ONE schema-constrained assist prompt (mirrors the error-forensics / triage discipline):
 * every shown fleet issue's cluster-key parts + its top-N linked-run forensics excerpts, then a strict
 * JSON output contract. All content is bounded; the model is told to merge only SAME-target issues and
 * to respond with ONLY the JSON object.
 */
export function buildAssistPrompt(issues: readonly RatingIssue[]): string {
  const blocks = issues.map((issue, i) => {
    const occ = issue.occurrences.slice(-TOP_OCCURRENCES_PER_ISSUE).map((o) => {
      const parts = [
        o.toolName ? `tool ${o.toolName}` : "",
        o.errorMessage ? `error: ${snippet(o.errorMessage)}` : "",
        !o.toolName && !o.errorMessage ? snippet(o.message) : "",
      ].filter(Boolean);
      return `    - ${parts.join(" · ") || "(no detail)"}`;
    });
    const forensics = occ.length > 0 ? `\n  recent forensics:\n${occ.join("\n")}` : "";
    return (
      `[${i + 1}] id: ${issue.id}\n` +
      `  target: ${issue.targetKind} "${issue.targetName}" (${issue.targetId})\n` +
      `  cluster: ${snippet(issue.fleet?.clusterKey ?? "-")}\n` +
      `  bucket: ${issue.bucket} · severity: ${issue.severity} · occurrences: ${issue.fleet?.occurrenceCount ?? issue.timesSeen}\n` +
      `  title: ${snippet(issue.title)}\n` +
      `  summary: ${snippet(issue.summary)}${forensics}`
    );
  });
  return `Below are the currently-open fleet issues (deterministic failure clusters), each with its cluster identity and recent linked-run forensics. Group near-duplicate issues that describe the SAME underlying problem, and for each group write an improved title, summary, and suggested priority.

### Open fleet issues
${blocks.join("\n\n")}

### Instructions
* Respond with ONLY a raw JSON object: { "groups": [ { "issueIds": string[], "title": string, "summary": string, "suggestedPriority": "low"|"medium"|"high", "rationale": string } ] }.
* Only group issues that describe the SAME underlying problem. Two issues on DIFFERENT targets are NEVER the same problem — never place them in one group.
* "issueIds": the ids (from the list above — never invent one) of the issues in this group. A group may contain a single id (a pure re-titling with no merge).
* "title": a concise developer-facing title for the group (max ${MAX_TITLE_CHARS} chars).
* "summary": what the underlying problem is and its impact, for the target's developer.
* "suggestedPriority": the operational priority — a SUGGESTION only, never applied automatically.
* "rationale": one sentence on why these issues were grouped (or why this single issue was re-titled).
* Include only issues that need a merge or a better title; omit the rest. Respond with ONLY the JSON object, nothing else.
`;
}

/** Collapse whitespace + bound a string (mirrors the AR pipeline's MAX_SNIPPET_CHARS discipline). */
function snippet(text: string): string {
  const collapsed = (text ?? "").replace(/\s+/g, " ").trim();
  if (!collapsed) return "(none)";
  return collapsed.length <= MAX_SNIPPET_CHARS ? collapsed : `${collapsed.slice(0, MAX_SNIPPET_CHARS)}…`;
}

/** Collapse whitespace + bound a judge-authored string, or `undefined` when empty. */
function boundedString(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.replace(/\s+/g, " ").trim();
  if (!trimmed) return undefined;
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max)}…`;
}

/**
 * Repair an arbitrary persisted value into a valid {@link IssueAssistState}. Every field is
 * defensively coerced (a missing/wrong-typed field falls back to the empty default), and a group
 * referencing no members is dropped — so a corrupt/legacy overlay never throws into a read.
 */
function normalizeState(raw: unknown): IssueAssistState {
  const empty = emptyAssistState();
  if (typeof raw !== "object" || raw === null) return empty;
  const obj = raw as Record<string, unknown>;
  const groups = Array.isArray(obj.groups)
    ? obj.groups.map(normalizeGroup).filter((g): g is IssueAssistGroup => g !== null)
    : [];
  return { groups, ledger: normalizeLedger(obj.ledger) };
}

function normalizeGroup(raw: unknown): IssueAssistGroup | null {
  if (typeof raw !== "object" || raw === null) return null;
  const g = raw as Record<string, unknown>;
  const issueIds = Array.isArray(g.issueIds)
    ? g.issueIds.filter((v): v is string => typeof v === "string" && v.length > 0)
    : [];
  if (issueIds.length === 0 || typeof g.id !== "string") return null;
  const priority = g.suggestedPriority;
  return {
    id: g.id,
    issueIds,
    primaryIssueId: typeof g.primaryIssueId === "string" ? g.primaryIssueId : (issueIds[0] as string),
    title: typeof g.title === "string" ? g.title : "",
    summary: typeof g.summary === "string" ? g.summary : "",
    suggestedPriority:
      priority === "low" || priority === "medium" || priority === "high" ? priority : "medium",
    rationale: typeof g.rationale === "string" ? g.rationale : "",
    aiAssisted: true,
    model: typeof g.model === "string" ? g.model : null,
    assistedAt: typeof g.assistedAt === "string" ? g.assistedAt : new Date(0).toISOString(),
  };
}

function normalizeLedger(raw: unknown): IssueAssistLedger {
  const empty = emptyAssistState().ledger;
  if (typeof raw !== "object" || raw === null) return empty;
  const l = raw as Record<string, unknown>;
  const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  return {
    calls: num(l.calls),
    tokensIn: num(l.tokensIn),
    tokensOut: num(l.tokensOut),
    costUsd: num(l.costUsd),
    lastProviderId: typeof l.lastProviderId === "string" ? l.lastProviderId : null,
    lastModel: typeof l.lastModel === "string" ? l.lastModel : null,
    lastAt: typeof l.lastAt === "string" ? l.lastAt : null,
  };
}

/**
 * Strip a Markdown code fence, then take the outermost `{ … }` and JSON.parse it. Null on any failure
 * (a local copy of the triage-service pattern — deliberately NOT imported across layers).
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
 * rejects, so the pass ALWAYS settles (the caller skips — never a hang).
 */
async function callWithTimeout<T>(run: (signal: AbortSignal) => Promise<T>, timeoutMs: number): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error(`issue-assist call timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });
  try {
    return await Promise.race([run(controller.signal), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
