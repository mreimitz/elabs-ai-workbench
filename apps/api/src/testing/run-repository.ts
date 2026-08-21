import { nanoid } from "nanoid";
import {
  isSettledRatingState,
  sessionCapabilitiesSchema,
  type AssertionResult,
  type CompareRow,
  type ContextSnapshot,
  type CostBasis,
  type ProviderKind,
  type RatingState,
  type RunCandidateScore,
  type RunDeletionResult,
  type RunDetail,
  type RunEvent,
  type RunFilter,
  type RunFilterCandidate,
  type RunForkRef,
  type RunMode,
  type RunOpenQuestion,
  type RunOutcome,
  type RunPhase,
  type RunPinResult,
  type RunPruneResult,
  type RunRetentionPolicy,
  type RunSort,
  type RunSortField,
  type RunStatus,
  type RunSkill,
  type RunStep,
  type RunStepType,
  type RunSummary,
  type SessionCapabilities,
  type SpanKind,
  type StopReasonCode,
  type TokenProfileRef,
  type TokenUsageActual,
} from "@mcp-token-footprint/shared";
import type { AppDatabase } from "../db/database.js";
import type { RunEventRow, RunRow, RunSkillRow, RunStepRow } from "../db/rows.js";
import { fetchRunFeedbackSummaries } from "../observability/feedback.js";
import { buildFtsMatch, fetchSnippets, RunSearchIndex } from "../observability/search.js";
import { httpError } from "../utils/errors.js";
import { parseJsonObject, stableStringify } from "../utils/json.js";
import type { RunEmitMeta, RunPersistenceSink } from "./run-manager.js";
import { isTerminalStatus } from "./run-manager.js";

/**
 * WP 1.6 — Run persistence (full replay). Mirrors {@link import("../scans/repository.js").ScanRepository}
 * layering: this repository OWNS all SQL (inserts/selects) + the row→contract mappers; the run service
 * orchestrates. It is the {@link RunPersistenceSink} fed every {@link RunEvent} by the {@link RunManager}
 * fan-out, so the entire run is written **as the loop emits** (decision #8 — a crash still yields a
 * partial, openable record), not just at the end.
 *
 * Per-run write path:
 *   - {@link createRun} inserts the `runs` row at start (`status:"running"`).
 *   - {@link onEvent} appends a `run_events` row (ordered `idx`) for EVERY event (exact replay) and, for
 *     `step` events, a `run_steps` row with `profile_tokens_json` / `usage_actual_json` /
 *     `context_snapshot_json` / **redacted** `payload_json`.
 *   - the terminal `status` event finalizes the `runs` totals (turns, tool_calls, peak context, tokens,
 *     cost, duration, status, outcome, stop_reason).
 *
 * Security (mandatory acceptance): `payload_json` is redacted (known-secret tool-argument fields are
 * stripped) and very large payloads are truncated with a `"+N bytes"` marker so the DB doesn't bloat.
 * Provider API keys and MCP secrets are never written to `runs`/`run_steps`/`run_events`.
 */
export class RunRepository implements RunPersistenceSink {
  // Per-run write cursors (process-local; the app is a single container). `idx` is the strict event
  // ordering used for exact replay; `kpi` accumulates the latest rolled-up KPIs to finalize totals.
  private readonly cursors = new Map<string, RunCursor>();

  // Observability (WP1.3, D-OB16) — the full-text index writer. DERIVED state: every index write is a
  // best-effort side-effect of the authoritative run write (wrapped in `indexSafely`), so an index
  // failure NEVER breaks run persistence — the index is fully rebuildable via reindex.
  private readonly search: RunSearchIndex;

  constructor(private readonly db: AppDatabase) {
    this.search = new RunSearchIndex(db);
  }

  /** Run a full-text index side-effect without letting it break the authoritative run write path. */
  private indexSafely(fn: () => void): void {
    try {
      fn();
    } catch {
      // The FTS index is DERIVED (conventions §1) — a write failure is recoverable by reindex; never
      // let it surface into the run persistence path.
    }
  }

  /** Insert the `runs` row at run start (`status:"running"`) and start the write cursor. */
  createRun(runId: string, input: CreateRunInput): RunSummary {
    const startedAt = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO runs (id, test_id, scenario_id, mode, status, started_at, derived_from_run_id, fork_step_id)
         VALUES (@id, @testId, @scenarioId, @mode, 'running', @startedAt, @derivedFromRunId, @forkStepId)`,
      )
      .run({
        id: runId,
        testId: input.testId,
        scenarioId: input.scenarioId,
        mode: input.mode,
        startedAt,
        // WP3.3 (D-OB18) — fork lineage stamped ATOMICALLY at INSERT (a derived run is derived from the
        // instant it exists → hidden from the feed + absent from suite aggregates with no visible window).
        derivedFromRunId: input.derivedFromRunId ?? null,
        forkStepId: input.forkStepId ?? null,
      });

    this.cursors.set(runId, {
      idx: 0,
      stepIdx: 0,
      startedAtMs: Date.now(),
      stepIdByEmittedId: new Map(),
    });
    // Observability (WP1.3) — the run's static meta + opener prompt are searchable immediately (the run
    // row + its test/scenario now exist, so the join resolves).
    this.indexSafely(() => this.search.indexRunMeta(runId));
    return this.getSummary(runId);
  }

  /**
   * Benchmarks (WP 3.2, B8) — stamp a started run's SUITE linkage. The suite orchestrator calls this
   * right after {@link RunService.start} creates the row, to denormalize which suite run (and which
   * 1-based repetition ordinal within its matrix cell) produced this run. ADDITIVE + idempotent-safe:
   * `suite_run_id`/`repetition` are a plain denormalized reference (NOT an FK — run history outlives the
   * suite run), and a run that was deleted mid-flight simply updates 0 rows rather than throwing, so the
   * orchestrator never fails a cell over a raced delete. Never touches any existing run column.
   */
  linkRunToSuite(runId: string, suiteRunId: string, repetition: number): void {
    this.db
      .prepare(
        "UPDATE runs SET suite_run_id = @suiteRunId, repetition = @repetition WHERE id = @runId",
      )
      .run({ runId, suiteRunId, repetition });
  }

  /**
   * The persistence sink. Called by the {@link RunManager} for every emitted {@link RunEvent}, in order.
   * Appends the ordered `run_events` row, writes a `run_steps` row for `step` events, tracks the latest
   * `kpi`, and finalizes the `runs` totals on the terminal `status` event.
   *
   * It MUST be resilient: a run whose `runs` row is missing (e.g. an event arriving before
   * {@link createRun}, or after restart cleanup) is skipped rather than throwing — the manager isolates
   * sink errors, but a silent no-op keeps the live stream and the DB consistent.
   *
   * `meta` (Unified Sessions, WP1.6, D-US3) is the optional {@link RunEmitMeta} duration side-channel
   * threaded verbatim from {@link RunManager.emit} — see {@link finalize}.
   */
  onEvent(runId: string, event: RunEvent, meta?: RunEmitMeta): void {
    const cursor = this.cursors.get(runId);
    if (!cursor) return;

    const idx = cursor.idx++;
    this.appendEvent(runId, idx, event);

    if (event.type === "step") {
      // Stamp `run_steps.idx` from a per-run monotonic counter (emission order), NOT `step.index`:
      // `step.index` comes from three independent per-component counters (engine, accounting, the MCP
      // sink) each starting at 0, so it is not globally ordered (it duplicates). This keeps the stored
      // step ordering gapless + strictly increasing so `getRun().steps` is a deterministic replay
      // (WP 3.6/3.7). The engine's source ordinal is still preserved inside the stored RunStep payload.
      this.appendStep(runId, cursor.stepIdx++, event.step, cursor);
      // Track peak context + cumulative cached tokens across steps — the rolled-up `kpi` carries the
      // *latest* context total and no cached count, so finalize the run from these instead.
      const total = event.step.context?.total;
      if (typeof total === "number") {
        cursor.peakContextTokens = Math.max(cursor.peakContextTokens ?? 0, total);
      }
      const cached = event.step.usageActual?.cachedInputTokens;
      if (typeof cached === "number") {
        cursor.cachedTokens = (cursor.cachedTokens ?? 0) + cached;
      }
      // RM-33 — the split, accumulated separately. Each half is tracked on its own presence so a
      // provider that reports only reads (OpenAI: writes are free and unreported) records a real read
      // total and leaves the write side UNKNOWN rather than claiming it was zero.
      const cacheRead = event.step.usageActual?.cacheReadTokens;
      if (typeof cacheRead === "number") {
        cursor.cacheReadTokens = (cursor.cacheReadTokens ?? 0) + cacheRead;
      }
      const cacheWrite = event.step.usageActual?.cacheWriteTokens;
      if (typeof cacheWrite === "number") {
        cursor.cacheWriteTokens = (cursor.cacheWriteTokens ?? 0) + cacheWrite;
      }
    } else if (event.type === "kpi") {
      cursor.kpi = event;
      // The kpi rail also surfaces the live context total — fold it into the peak.
      cursor.peakContextTokens = Math.max(cursor.peakContextTokens ?? 0, event.contextTokens);
    } else if (event.type === "status") {
      if (isTerminalStatus(event.status)) {
        this.finalize(runId, cursor, event, meta);
        // The cursor is KEPT past the terminal status (AR11): the post-terminal review still appends
        // its `rating` events to the replay log through this sink. It is dropped below, when the
        // settled rating event lands (the run service guarantees one after every terminal status).
      } else {
        // A non-terminal status ("running", "pending") just keeps the runs row in sync.
        this.db.prepare("UPDATE runs SET status = ? WHERE id = ?").run(event.status, runId);
      }
    } else if (event.type === "phase") {
      // Unified Sessions (WP1.6, D-US1) — the run's queryable lifecycle phase mirrors the last
      // `{type:"phase"}` event that passed through the RunManager choke point. NULL-safe: a run that
      // never emits one (every executor as of WP1.6) simply never writes this column.
      this.setPhase(runId, event.phase);
    } else if (event.type === "rating" && isSettledRatingState(event.state)) {
      // The review is over — the settled rating event was already appended above; drop the cursor
      // (the manager cleans its state up on the same event).
      this.cursors.delete(runId);
    }
  }

  /** Append one ordered `run_events` row (the exact replay log). Payload is JSON-redacted/truncated. */
  private appendEvent(runId: string, idx: number, event: RunEvent): void {
    this.db
      .prepare(
        `INSERT INTO run_events (id, run_id, idx, type, payload_json, created_at)
         VALUES (@id, @runId, @idx, @type, @payloadJson, @createdAt)`,
      )
      .run({
        id: nanoid(),
        runId,
        idx,
        type: event.type,
        payloadJson: stableStringify(redactValue(event)),
        createdAt: new Date().toISOString(),
      });
  }

  /**
   * Write one `run_steps` row for a `step` RunEvent, redacting the payload before persisting. `idx` is
   * the per-run monotonic ordinal (emission order) — see {@link onEvent}; do NOT use `step.index`,
   * which is a per-component counter and not globally ordered.
   *
   * Observability (WP3.1, D-OB17) — step-hierarchy metadata: `span_kind` is persisted verbatim, and
   * `parent_step_id` is RESOLVED through `cursor.stepIdByEmittedId` from the EMITTED parent id an emitter
   * set (`step.parentStepId`) to the PERSISTED parent row id. Because that map holds only steps written
   * EARLIER in this run's emission order, a dangling or FORWARD reference resolves to NULL → the step
   * renders flat (the WP's "reference an earlier step of the same run, validate at persist" invariant).
   * Live subscribers keep the emitter's ids; a replayed run carries the persisted ids — each tree is
   * internally consistent. NEVER reorders: `idx` stays exactly the emission-order ordinal.
   */
  private appendStep(runId: string, idx: number, step: RunStep, cursor: RunCursor): void {
    // Compute the REDACTED persistence shape ONCE, then use it for BOTH the row write and the full-text
    // index — so the live-indexed content is byte-identical to what a later backfill/reindex reads back
    // from the persisted row (D-OB16 "identical results"), and the index NEVER carries a secret the row
    // strips.
    const persistedAssistant =
      step.assistantText === undefined ? null : truncateString(step.assistantText);
    const redactedPayload = redactValue(step.payload);
    const persistedId = nanoid();
    // Resolve the emitted parent id → the persisted parent row id (only earlier-in-this-run steps are in
    // the map, so a dangling/forward reference falls through to null — validation by construction).
    const parentStepId =
      step.parentStepId !== undefined
        ? (cursor.stepIdByEmittedId.get(step.parentStepId) ?? null)
        : null;
    this.db
      .prepare(
        `INSERT INTO run_steps (
           id, run_id, idx, type, label, status, duration_ms, server_id, tool_name,
           profile_tokens_json, usage_actual_json, context_snapshot_json, cumulative_tokens,
           assistant_text, reasoning_text, turn_index, result_bytes, started_at, ended_at, payload_json,
           parent_step_id, span_kind
         ) VALUES (
           @id, @runId, @idx, @type, @label, @status, @durationMs, @serverId, @toolName,
           @profileTokensJson, @usageActualJson, @contextSnapshotJson, @cumulativeTokens,
           @assistantText, @reasoningText, @turnIndex, @resultBytes, @startedAt, @endedAt, @payloadJson,
           @parentStepId, @spanKind
         )`,
      )
      .run({
        id: persistedId,
        runId,
        idx,
        type: step.type,
        label: step.label,
        status: step.status,
        durationMs: step.durationMs ?? null,
        serverId: step.serverId ?? null,
        toolName: step.toolName ?? null,
        profileTokensJson: stableStringify(step.profileTokens ?? {}),
        usageActualJson: step.usageActual === undefined ? null : stableStringify(step.usageActual),
        contextSnapshotJson: step.context === undefined ? null : stableStringify(step.context),
        // WP 5.6 — running cumulative context tokens (null on steps that don't carry one).
        cumulativeTokens: step.cumulativeTokens ?? null,
        // F2 — per-turn assistant prose + reasoning. Run through the SAME redaction path (scrub
        // provider-key-shaped substrings + truncate over-long strings) since prose can be large and
        // could contain secret-shaped text. Null on steps that carry none.
        assistantText: persistedAssistant,
        reasoningText: step.reasoningText === undefined ? null : truncateString(step.reasoningText),
        turnIndex: step.turnIndex ?? null,
        // Byte size of a tool_call result payload (null on steps that carry none).
        resultBytes: step.resultBytes ?? null,
        // Track E — per-step wall-clock timing (ISO; null on steps that carry none). Pure timestamps,
        // no redaction needed.
        startedAt: step.startedAt ?? null,
        endedAt: step.endedAt ?? null,
        // REDACTED + size-bounded: strip known-secret tool-argument fields, never write secrets.
        payloadJson: stableStringify(redactedPayload),
        // WP3.1 — step-hierarchy metadata (both null on pre-WP3.1 / unlinked steps).
        parentStepId,
        spanKind: step.spanKind ?? null,
      });
    // Register this step's EMITTED id → its PERSISTED row id so a LATER child of this run (emitted after
    // it) can resolve `parentStepId` to the persisted parent. Keyed on the emitter-supplied `step.id`
    // (always present in practice); last-writer-wins on the astronomically-unlikely id collision.
    if (step.id) cursor.stepIdByEmittedId.set(step.id, persistedId);
    // Observability (WP1.3) — index this step's searchable content from the SAME redacted values.
    this.indexSafely(() =>
      this.search.indexStep(runId, idx, {
        type: step.type,
        toolName: step.toolName,
        label: step.label,
        assistantText: persistedAssistant,
        payload: redactedPayload,
      }),
    );
  }

  /**
   * Finalize `runs` totals from the accumulated KPI + the terminal status event.
   *
   * Unified Sessions (WP1.6) additions: `stop_reason_code` mirrors the event's machine-readable
   * {@link StopReasonCode} (NULL for an executor that hasn't adopted `terminalFor` yet); `ended_at`
   * is stamped NOW for EVERY terminal disposition (not just `ended` — "the session was ended/closed",
   * per the `RunSummary.endedAt` doc); `active_duration_ms`/`total_duration_ms` come from the optional
   * emit-path `meta` (see {@link RunEmitMeta}) and stay NULL until an executor supplies them.
   *
   * WP1.R (B1/B3 fix) — `phase = NULL` on every terminal write. A `{type:"phase"}` emit (e.g. the
   * engine SessionClock `onFire` stamping `'stopping'` right before the terminal status, or a run
   * left at `'waiting_input'` when `/end` finalizes it) has no guaranteed later clearing emit — the
   * engine's own `{phase:null}` after a clock-fired terminal is a no-op once `detachActiveRun` has
   * already removed the run from the manager. Clearing `phase` centrally here, on the ONE write every
   * terminal disposition goes through regardless of executor, means a terminal run never reports a
   * stale in-flight phase. This does not affect the mid-run `{phase:null}` emits on
   * `resumeFromWaiting` (a run CONTINUING after a wait) — those still go through {@link setPhase} via
   * the normal event path while the run is non-terminal.
   */
  private finalize(
    runId: string,
    cursor: RunCursor,
    event: TerminalStatusEvent,
    meta?: RunEmitMeta,
  ): void {
    const kpi = cursor.kpi;
    this.db
      .prepare(
        `UPDATE runs SET
           status = @status,
           outcome = @outcome,
           stop_reason = @stopReason,
           stop_reason_code = @stopReasonCode,
           phase = NULL,
           duration_ms = @durationMs,
           ended_at = @endedAt,
           active_duration_ms = COALESCE(@activeDurationMs, active_duration_ms),
           total_duration_ms = COALESCE(@totalDurationMs, total_duration_ms),
           turns = @turns,
           tool_calls = @toolCalls,
           peak_context_tokens = @peakContextTokens,
           tokens_in = @tokensIn,
           tokens_out = @tokensOut,
           cached_tokens = @cachedTokens,
           cache_read_tokens = @cacheReadTokens,
           cache_write_tokens = @cacheWriteTokens,
           cost_usd = @costUsd,
           cost_basis = @costBasis
         WHERE id = @runId`,
      )
      .run({
        runId,
        status: event.status,
        outcome: event.outcome ?? null,
        stopReason: event.stopReason ?? null,
        stopReasonCode: event.stopReasonCode ?? null,
        durationMs: Date.now() - cursor.startedAtMs,
        endedAt: new Date().toISOString(),
        // Unified Sessions (WP1.7) — COALESCE onto the EXISTING column instead of unconditionally
        // writing NULL when this terminal event carries no `meta`: the claude-subscription executor
        // records its durations via the SEPARATE `recordDurations` DI seam (a direct, synchronous
        // `RunRepository.recordDurations` call — see its doc), NOT via this event's `meta`, and that
        // call always lands BEFORE this finalize's deferred persistence microtask runs (same
        // synchronous call stack, no `await` between them at every current call site). Without the
        // COALESCE this write would silently clobber that already-recorded value back to NULL. Every
        // OTHER kind (the engine) threads real durations through `meta` here directly, so this is a
        // no-op change for them (COALESCE picks the provided value when non-null, same as before).
        activeDurationMs: meta?.activeDurationMs ?? null,
        totalDurationMs: meta?.totalDurationMs ?? null,
        turns: kpi?.turns ?? 0,
        toolCalls: kpi?.toolCalls ?? 0,
        peakContextTokens: cursor.peakContextTokens ?? 0,
        tokensIn: kpi?.tokensIn ?? 0,
        tokensOut: kpi?.tokensOut ?? 0,
        cachedTokens: cursor.cachedTokens ?? 0,
        // RM-33 (D-CT3) — prefer the kpi event (it now carries the split), fall back to the per-step
        // re-accumulation, and write a real NULL when NEITHER saw a cache slice. `?? null`, never
        // `?? 0`: a zero here would tell the metrics layer this run demonstrably had no cache, which
        // is a different and stronger claim than "this backend never told us".
        cacheReadTokens: kpi?.cacheReadTokens ?? cursor.cacheReadTokens ?? null,
        cacheWriteTokens: kpi?.cacheWriteTokens ?? cursor.cacheWriteTokens ?? null,
        costUsd: kpi?.costUsd ?? 0,
        // Claude subscription (WP 3.1, D-CS4/D-CS8) — persist the run's cost BASIS from the terminal
        // kpi (the same event `cost_usd` is derived from) so the Runs feed + Compare, which read the
        // `runs` row (not the live event stream), can mark a subscription run's shadow-priced cost
        // "est. · subscription". A run whose kpi carried no basis (every ordinary API-keyed run, or a
        // subscription run only stamped `"api_exact"`) writes NULL → absent/`api_exact`.
        costBasis: kpi?.costBasis ?? null,
      });
    // Observability (WP1.3) — index the terminal disposition's human stop-reason (error class).
    this.indexSafely(() => this.search.indexTerminal(runId, event.stopReason ?? null));
  }

  /**
   * WP 2.1 — record which skill VERSION this run resolved for each attached skill (one row per
   * resolved attachment). Called by the run service right after `resolveAllowedSkills` at run start.
   * Written in one transaction (createRun itself is a single INSERT, not a transaction, so these rows
   * are NOT in the run row's transaction — they're a follow-on write inside the async run-config
   * resolution, matching the existing incremental-write style). `ON CONFLICT DO NOTHING` keeps it
   * idempotent (a resolution is written once per run). A run with no resolved skills writes nothing.
   */
  recordRunSkills(runId: string, rows: RunSkillInput[]): void {
    if (rows.length === 0) return;
    const insert = this.db.prepare(
      `INSERT INTO run_skills (run_id, skill_id, skill_version_id, version_label, eager)
       VALUES (@runId, @skillId, @skillVersionId, @versionLabel, @eager)
       ON CONFLICT(run_id, skill_id) DO NOTHING`,
    );
    const writeAll = this.db.transaction((items: RunSkillInput[]) => {
      for (const item of items) {
        insert.run({
          runId,
          skillId: item.skillId,
          skillVersionId: item.skillVersionId,
          versionLabel: item.versionLabel ?? "",
          eager: item.eager ? 1 : 0,
        });
      }
    });
    writeAll(rows);
  }

  /**
   * WP 5.1 — persist the validation-gate assertion results evaluated from the run's trace alignment on
   * completion. A standalone additive UPDATE of `runs.assertion_results_json` ONLY — it never touches
   * `outcome`/`status`/totals (those are owned by {@link finalize}), so it is safe to call after the
   * run has already been finalized and can never race the terminal-status write. A no-op (skips the
   * write) for an unknown run. `outcome` is deliberately left untouched by assertion failure — the
   * results array carries the pass/fail signal (see the run-service hook + WP 5.1 outcome decision).
   */
  saveAssertionResults(runId: string, results: AssertionResult[]): void {
    this.db
      .prepare("UPDATE runs SET assertion_results_json = @json WHERE id = @runId")
      .run({ runId, json: stableStringify(results) });
  }

  /**
   * WP 5.1 follow-up (owner decision 2026-07-03) — flip a cleanly-completed run's outcome to
   * `assertions_failed`. The precedence guard lives in the `WHERE`: the update ONLY fires on a run
   * that finished `status = 'completed'` AND still carries `outcome = 'completed'`, so an engine
   * outcome (`stopped_guardrail`/`context_overflow`/`error`/`aborted`) can never be masked and the
   * flip is idempotent. Totals/status/results are untouched (owned by {@link finalize} /
   * {@link saveAssertionResults}). The caller decides WHETHER any assertion failed; this is the
   * additive write.
   */
  markAssertionsFailedOutcome(runId: string): void {
    this.db
      .prepare(
        "UPDATE runs SET outcome = 'assertions_failed' WHERE id = ? AND status = 'completed' AND outcome = 'completed'",
      )
      .run(runId);
  }

  /**
   * Auto-Rating (AR11) — transition the run's REVIEW axis (`rating_state`). A standalone additive
   * UPDATE ONLY: it never touches `status`/`outcome`/totals (owned by {@link finalize}), so it is safe
   * at any point after the terminal write and can never mask an engine result. A no-op (0 rows) for a
   * run deleted mid-review — the review transitions must never throw into the settled done-chain.
   */
  setRatingState(runId: string, state: RatingState): void {
    this.db
      .prepare("UPDATE runs SET rating_state = @state WHERE id = @runId")
      .run({ runId, state });
  }

  /**
   * Auto-Rating (AR11) — append a `rating` RunEvent to the persisted replay log OUTSIDE the live
   * write cursor. The live path persists rating events through {@link onEvent} (the manager fan-out);
   * this exists for the RE-RATE path (`POST /api/runs/:id/grade`), where the run's live channel is
   * long gone but a later replayed stream should still converge on the review's transitions. `idx`
   * continues after the stored log (MAX+1) so replay order is preserved. No-op for an unknown run.
   */
  appendRatingEvent(runId: string, state: RatingState): void {
    const exists = this.db.prepare("SELECT 1 FROM runs WHERE id = ?").get(runId);
    if (!exists) return;
    const next = this.db
      .prepare("SELECT COALESCE(MAX(idx) + 1, 0) AS idx FROM run_events WHERE run_id = ?")
      .get(runId) as { idx: number };
    this.appendEvent(runId, next.idx, { type: "rating", state });
  }

  /**
   * Observability (WP3.1, D-OB17) — append a DERIVED step (a `rating`/`judge_call`/… span) to a run's
   * persisted `run_steps` OUTSIDE the live write cursor, and return its new persisted id. This is the
   * post-terminal emit path (e.g. the auto-rating pipeline in {@link import("../grading/grade-service.js").
   * GradeService}, which runs after the run's live channel has settled): `idx` continues after the stored
   * steps (MAX+1) so the step lands AFTER the execution steps and `getRun().steps` order stays a
   * deterministic replay — the tree is a rendering of `parentStepId` links, NEVER a reordering.
   *
   * `parentStepId` here is an ALREADY-PERSISTED `run_steps.id` (the caller emits a parent then its
   * children); it is VALIDATED to reference an existing step of the SAME run — a dangling or cross-run
   * reference is dropped to NULL (the child renders flat). FORWARD-ONLY + ADDITIVE: it only ever INSERTs a
   * new step, never touches an existing one, and no-ops (returning a fresh id without writing) for an
   * unknown/deleted run so the review chain never throws.
   */
  appendDerivedStep(runId: string, input: DerivedStepInput): string {
    const id = nanoid();
    const exists = this.db.prepare("SELECT 1 FROM runs WHERE id = ?").get(runId);
    if (!exists) return id; // defensive no-op (matches appendRatingEvent) — never throw into the review
    const next = this.db
      .prepare("SELECT COALESCE(MAX(idx) + 1, 0) AS idx FROM run_steps WHERE run_id = ?")
      .get(runId) as { idx: number };
    // Validate the parent link: it must be an EXISTING step of the SAME run (else drop to null → flat).
    let parentStepId: string | null = null;
    if (input.parentStepId !== undefined) {
      const parent = this.db
        .prepare("SELECT 1 FROM run_steps WHERE id = ? AND run_id = ?")
        .get(input.parentStepId, runId);
      if (parent) parentStepId = input.parentStepId;
    }
    this.db
      .prepare(
        `INSERT INTO run_steps (
           id, run_id, idx, type, label, status, duration_ms, profile_tokens_json, payload_json,
           parent_step_id, span_kind
         ) VALUES (
           @id, @runId, @idx, @type, @label, @status, @durationMs, '{}', @payloadJson,
           @parentStepId, @spanKind
         )`,
      )
      .run({
        id,
        runId,
        idx: next.idx,
        type: input.type ?? "context_event",
        label: input.label,
        status: input.status ?? "ok",
        durationMs: input.durationMs ?? null,
        // REDACTED like every other persisted payload (never write a secret-shaped string).
        payloadJson: stableStringify(redactValue(input.payload ?? {})),
        parentStepId,
        spanKind: input.spanKind,
      });
    return id;
  }

  // ── Unified Sessions (planning/Roadmap/completed/RM-29-unified-sessions/, WP1.6) — session-lifecycle write primitives ────
  // Standalone additive UPDATEs (the `setRatingState`/`saveAssertionResults` pattern above): each
  // touches ONLY its own column(s), never `status`/`outcome`/totals (owned by `finalize`), so they are
  // safe to call at any point in a run's lifecycle and can never mask an engine result. All are no-ops
  // (0 rows, never throw) for an unknown/deleted run. These are the methods the executors (WP1.3 engine,
  // WP1.4 subscription) wire to once they adopt SessionClock/capabilities/`terminalFor`.

  /**
   * Persist the backend's {@link SessionCapabilities} manifest for this run (D-US4). Call once, at
   * session start (after {@link createRun}), from the executor that knows its own capabilities.
   */
  setCapabilities(runId: string, capabilities: SessionCapabilities): void {
    this.db
      .prepare("UPDATE runs SET capabilities_json = @json WHERE id = @runId")
      .run({ runId, json: stableStringify(capabilities) });
  }

  /**
   * Persist the run's current queryable lifecycle {@link RunPhase} (D-US1). Called internally by
   * {@link onEvent} when a `{type:"phase"}` event passes through the RunManager choke point, and
   * directly callable by an executor that wants to set it outside the emit path. `phase: null` clears
   * it (no distinct phase — the plain status stands).
   */
  setPhase(runId: string, phase: RunPhase | null): void {
    this.db.prepare("UPDATE runs SET phase = @phase WHERE id = @runId").run({ runId, phase });
  }

  /**
   * Persist the SessionClock-derived durations (D-US3) independently of a terminal write. {@link
   * finalize} already folds `meta` (see {@link RunEmitMeta}) into its own single UPDATE when a terminal
   * event carries them; this is for a caller (e.g. a future executor) that wants to record/update them
   * OUTSIDE the terminal emit path. Either field omitted writes NULL for that column.
   */
  recordDurations(
    runId: string,
    durations: { activeDurationMs?: number; totalDurationMs?: number },
  ): void {
    this.db
      .prepare(
        "UPDATE runs SET active_duration_ms = @activeDurationMs, total_duration_ms = @totalDurationMs WHERE id = @runId",
      )
      .run({
        runId,
        activeDurationMs: durations.activeDurationMs ?? null,
        totalDurationMs: durations.totalDurationMs ?? null,
      });
  }

  /**
   * Stamp `ended_at` NOW (D-US2), independent of the terminal-status write ({@link finalize} already
   * sets it for EVERY terminal disposition — see the `runs` DDL comment). A defensive, explicit
   * primitive: the `/end` route calls this SYNCHRONOUSLY alongside emitting the terminal event through
   * the RunManager choke point (whose persistence dispatch is a deferred microtask), so `ended_at` is
   * guaranteed to be set the moment "End session" is handled, not just once the async write lands.
   */
  markEnded(runId: string): void {
    this.db
      .prepare("UPDATE runs SET ended_at = @endedAt WHERE id = @runId")
      .run({ runId, endedAt: new Date().toISOString() });
  }

  /**
   * Mark this run as opened/acknowledged by the operator (D-US1, the needs-attention feed WP3.3
   * builds). Called by `POST /api/runs/:id/seen`. Idempotent.
   */
  markSeen(runId: string): void {
    this.db.prepare("UPDATE runs SET seen = 1 WHERE id = @runId").run({ runId });
  }

  /**
   * Pin (or unpin) a run (WP1.6, retention classes) — a pinned run is NEVER a `pruneRuns` victim,
   * regardless of policy. Called by `POST`/`DELETE /api/runs/:id/pin`. Idempotent; 404s if unknown.
   */
  setPinned(runId: string, pinned: boolean): RunPinResult {
    const exists = this.db.prepare("SELECT 1 FROM runs WHERE id = ?").get(runId);
    if (!exists) throw httpError(404, "Run not found");
    this.db
      .prepare("UPDATE runs SET pinned = @pinned WHERE id = @runId")
      .run({ runId, pinned: pinned ? 1 : 0 });
    return { runId, pinned };
  }

  /** The skill-version rows a run resolved (WP 2.1) — drives the trace route's version disambiguation. */
  getRunSkills(runId: string): RunSkillRow[] {
    return this.db
      .prepare("SELECT * FROM run_skills WHERE run_id = ? ORDER BY skill_id ASC")
      .all(runId) as RunSkillRow[];
  }

  /**
   * Enriched skill summaries for a run: each resolved skill (`run_skills`) joined to its version's token
   * subtotals + current name, plus the realized read-only disclosure usage scanned from this run's
   * steps. Powers {@link RunDetail.skills} and `GET /api/runs/:id/skills` (the run-console Skills panel),
   * answering "was it loaded, was it used, what did it cost". A run with no resolved skills returns `[]`.
   *
   * `LEFT JOIN`s keep a row even when the skill or its resolved version was deleted after the run (the
   * immutable resolution history survives — name falls back to the id, `footprint` becomes `null`).
   */
  listRunSkillSummaries(runId: string): RunSkill[] {
    const rows = this.db
      .prepare(
        `SELECT rs.skill_id            AS skillId,
                rs.skill_version_id    AS skillVersionId,
                rs.version_label       AS versionLabel,
                rs.eager               AS eager,
                s.name                 AS skillName,
                sv.l1_metadata_tokens  AS l1,
                sv.l2_body_tokens      AS l2,
                sv.l3_resource_tokens  AS l3,
                sv.total_tokens        AS total
           FROM run_skills rs
           LEFT JOIN skills s          ON s.id  = rs.skill_id
           LEFT JOIN skill_versions sv ON sv.id = rs.skill_version_id
          WHERE rs.run_id = ?
          ORDER BY rs.skill_id ASC`,
      )
      .all(runId) as RunSkillSummaryRow[];
    if (rows.length === 0) return [];

    // Per-skill realized disclosure: a settled `read_skill_file` step is tagged `serverId = skill://<id>`
    // by the skill-context meter (testing/skill-context.ts). Sum those reads + their result tokens per
    // skill. `skill://*` steps (the list-all tool + refused reads) aren't attributable to one skill.
    const disclosure = this.db
      .prepare(
        `SELECT server_id AS serverId, profile_tokens_json AS profileTokens
           FROM run_steps
          WHERE run_id = ?
            AND type = 'tool_call'
            AND status IN ('ok', 'error')
            AND server_id LIKE 'skill://%'`,
      )
      .all(runId) as Array<{ serverId: string; profileTokens: string }>;

    const readsBySkill = new Map<string, { reads: number; tokens: number }>();
    for (const step of disclosure) {
      const skillId = step.serverId.slice("skill://".length);
      if (skillId === "*") continue;
      const bucket = readsBySkill.get(skillId) ?? { reads: 0, tokens: 0 };
      bucket.reads += 1;
      bucket.tokens += primaryProfileTokens(step.profileTokens);
      readsBySkill.set(skillId, bucket);
    }

    return rows.map((row) => {
      const used = readsBySkill.get(row.skillId) ?? { reads: 0, tokens: 0 };
      const footprint: RunSkill["footprint"] =
        row.total != null && row.l1 != null
          ? {
              l1MetadataTokens: row.l1,
              l2BodyTokens: row.l2 ?? 0,
              l3ResourceTokens: row.l3 ?? 0,
              totalTokens: row.total,
            }
          : null;
      return {
        skillId: row.skillId,
        name: row.skillName ?? row.skillId,
        versionLabel: row.versionLabel ?? "—",
        skillVersionId: row.skillVersionId,
        eager: row.eager === 1,
        footprint,
        disclosureReads: used.reads,
        disclosureTokens: used.tokens,
      };
    });
  }

  /**
   * WP 2.1 — runs that RESOLVED the given skill version, joined via `run_skills`, newest first. Powers
   * `GET /api/skills/:id/versions/:vid/runs` (Trace Mode's "runs that exercised this skill version").
   */
  listRunsForSkillVersion(skillVersionId: string): RunSummary[] {
    const rows = this.db
      .prepare(
        `SELECT r.* FROM runs r
           JOIN run_skills rs ON rs.run_id = r.id
          WHERE rs.skill_version_id = ?
          ORDER BY r.started_at DESC`,
      )
      .all(skillVersionId) as RunRow[];
    return rows.map(toRunSummary);
  }

  // ── Read side ───────────────────────────────────────────────────────────────────────────────

  /**
   * A run + its steps + events, both ordered by `idx` (enough to drive replay — WP 3.7).
   *
   * Unified Sessions (WP1.6, D-US1) — `openQuestions` is reconstructed from the event log (not a
   * stored column): still-open agent-initiated `question`s whose `questionId` has no matching later
   * `question_resolved`, so a reopened/replayed interactive session can re-render a pending prompt
   * without replaying the live stream.
   */
  getRun(runId: string): RunDetail {
    const summary = this.getSummary(runId);
    const stepRows = this.db
      .prepare("SELECT * FROM run_steps WHERE run_id = ? ORDER BY idx ASC")
      .all(runId) as RunStepRow[];
    const eventRows = this.db
      .prepare("SELECT * FROM run_events WHERE run_id = ? ORDER BY idx ASC")
      .all(runId) as RunEventRow[];
    const events = eventRows.map(toRunEvent);

    return {
      ...summary,
      steps: stepRows.map(toRunStep),
      events,
      skills: this.listRunSkillSummaries(runId),
      openQuestions: reconstructOpenQuestions(events),
      // Observability (WP3.3, D-OB18) — the derived runs forked FROM this run (parent → child lineage),
      // so the console can render a "forks" indicator + link out. Empty for a run nobody forked.
      forks: this.listForksOf(runId),
    };
  }

  /**
   * Observability (WP3.3, D-OB18) — the DERIVED runs forked FROM `parentRunId` (the parent → child
   * lineage direction; the child → parent direction is each derived run's own `derivedFromRunId`).
   * Newest first. Read-only; `[]` when nothing forked this run. Uses the v42 `idx_runs_derived_from`
   * covering index.
   */
  listForksOf(parentRunId: string): RunForkRef[] {
    const rows = this.db
      .prepare(
        `SELECT id, fork_step_id, status, started_at
           FROM runs WHERE derived_from_run_id = ? ORDER BY started_at DESC, id DESC`,
      )
      .all(parentRunId) as Array<{
      id: string;
      fork_step_id: string | null;
      status: string;
      started_at: string;
    }>;
    return rows.map((row) => ({
      runId: row.id,
      ...(row.fork_step_id ? { forkStepId: row.fork_step_id } : {}),
      status: row.status as RunStatus,
      startedAt: row.started_at,
    }));
  }

  /** Run history for the Runs list + Compare (WP 3.8). Filterable by test/scenario/status, and (R3.1)
   *  optionally bounded by `limit` so a "most recent N" reader (e.g. the Assistant's starters service)
   *  never SELECTs + maps the whole `runs` table. `limit` is applied at the SQL level (`LIMIT`), is a
   *  bound param (no injection), and is a no-op unless it's a positive integer — every existing caller
   *  omits it and gets the full, unbounded history unchanged.
   *
   *  This is the LEGACY scalar-filter list (kept for the internal callers: startup stop-active, the
   *  Assistant tools, the H-2 live-run guard). The richer Observability RunFilter grammar lands in
   *  {@link queryRuns} — `GET /api/runs` routes there when any filter/sort/pagination param is present. */
  listRuns(filter: ListRunsFilter = {}): RunSummary[] {
    const where: string[] = [];
    const params: Record<string, string | number> = {};
    if (filter.testId) {
      where.push("test_id = @testId");
      params.testId = filter.testId;
    }
    if (filter.scenarioId) {
      where.push("scenario_id = @scenarioId");
      params.scenarioId = filter.scenarioId;
    }
    if (filter.status) {
      where.push("status = @status");
      params.status = filter.status;
    }
    const clause = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
    let limitClause = "";
    if (typeof filter.limit === "number" && Number.isInteger(filter.limit) && filter.limit > 0) {
      limitClause = " LIMIT @limit";
      params.limit = filter.limit;
    }
    const rows = this.db
      .prepare(`SELECT * FROM runs ${clause} ORDER BY started_at DESC${limitClause}`)
      .all(params) as RunRow[];
    return this.attachFeedback(rows.map(toRunSummary));
  }

  /**
   * Observability (planning/Roadmap/RM-17-observability/, WP1.1, D-OB1) — translate the shared {@link RunFilter}
   * grammar to a parameterized `SELECT * FROM runs` and return the matching {@link RunSummary}s. Powers
   * `GET /api/runs` with a filter/sort/pagination. Additive: `queryRuns({})` (empty filter, default
   * sort, no pagination) is byte-identical to `listRuns()` — the no-param feed path stays unchanged.
   *
   * Every value is BOUND (never string-interpolated); only the sort COLUMN + direction come from a
   * validated allowlist ({@link RUN_SORT_COLUMNS}). Joins reuse existing tables via correlated
   * subqueries (scenarios/provider_credentials/scenario_servers/run_skills/suite_runs/tests/suites/
   * run_grades) so the SELECT stays single-table (no row fan-out, no DISTINCT) and NO denormalization
   * is added. Semantics MIRROR the pure `matchesRunFilter` predicate in shared/run-filter.ts (kept in
   * lockstep by the API cross-check test).
   *
   * DEFERRED to WP1.2 — deliberate indexes for the hot filter columns/joins (e.g. on
   * `runs(scenario_id)` [exists], `runs(suite_run_id, started_at)` [v19], `runs(started_at)`,
   * `runs(status)`, `run_skills(skill_id)`, `run_grades(run_id, grader_id, created_at)`,
   * `scenario_servers(server_id)`). This WP adds NO index/migration; note the targets, measure in 1.2.
   */
  queryRuns(
    filter: RunFilter,
    opts: { sort?: RunSort; limit?: number; offset?: number } = {},
  ): RunSummary[] {
    const { clauses, params } = buildRunFilterWhere(filter);

    // Observability (WP1.3, D-OB16) — full-text `q` composes with every other filter field: the FTS5
    // match is an `id IN (SELECT run_id FROM run_search WHERE run_search MATCH …)` subquery ANDed into
    // the WHERE, so the normal sort + pagination still apply to `runs`. `snippet()` can only run in a
    // DIRECT MATCH query (never in a join), so the per-hit snippet/kind is fetched in a SECOND direct
    // query over just the returned page (see below). A `q` that tokenizes to nothing matches nothing.
    let match: string | null = null;
    if (filter.q !== undefined) {
      match = buildFtsMatch(filter.q);
      if (match === null) return [];
      params.__q = match;
      clauses.push("id IN (SELECT run_id FROM run_search WHERE run_search MATCH @__q)");
    }

    const whereClause = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    const orderClause = buildRunOrderBy(opts.sort);

    let pagination = "";
    const hasLimit =
      typeof opts.limit === "number" && Number.isInteger(opts.limit) && opts.limit > 0;
    const hasOffset =
      typeof opts.offset === "number" && Number.isInteger(opts.offset) && opts.offset > 0;
    if (hasLimit) {
      params.__limit = opts.limit as number;
      params.__offset = hasOffset ? (opts.offset as number) : 0;
      pagination = " LIMIT @__limit OFFSET @__offset";
    } else if (hasOffset) {
      // SQLite requires a LIMIT before OFFSET; `-1` means "no limit" (offset-only pagination).
      params.__offset = opts.offset as number;
      pagination = " LIMIT -1 OFFSET @__offset";
    }

    const rows = this.db
      .prepare(`SELECT * FROM runs ${whereClause} ${orderClause}${pagination}`)
      .all(params) as RunRow[];
    const summaries = this.attachFeedback(rows.map(toRunSummary));

    if (match !== null && rows.length > 0) {
      // Attach the best-match snippet + kind for the returned page only (bounded work).
      const hits = fetchSnippets(
        this.db,
        match,
        rows.map((r) => r.id),
      );
      for (const summary of summaries) {
        const hit = hits.get(summary.id);
        if (hit) {
          summary.searchMatchKind = hit.kind;
          summary.searchSnippet = hit.snippet;
        }
      }
    }
    return summaries;
  }

  getSummary(runId: string): RunSummary {
    const row = this.db.prepare("SELECT * FROM runs WHERE id = ?").get(runId) as RunRow | undefined;
    if (!row) {
      throw httpError(404, "Run not found");
    }
    const summary = toRunSummary(row);
    this.attachFeedback([summary]); // mutates `summary` in place (see the helper's doc)
    return summary;
  }

  /**
   * Observability (WP4.1) — materialize the {@link RunFilterCandidate} for ONE run so a watch rule's
   * {@link RunFilter} can be evaluated by the SHARED pure `matchesRunFilter` predicate (NO SQL
   * translation of the filter — the WP1.1 reuse path). The repository owns the join knowledge, so the
   * ENRICHED (normally-joined) fields are read here with the SAME access paths `buildRunFilterWhere`
   * uses (scenarios/provider_credentials/scenario_servers/run_skills/suite_runs/suites/tests/run_grades/
   * run_feedback) — kept in agreement with the SQL translation by the watch tests. Returns `undefined`
   * for an unknown run. Read-only + deterministic; touches no run state.
   */
  buildFilterCandidate(runId: string): RunFilterCandidate | undefined {
    const row = this.db.prepare("SELECT * FROM runs WHERE id = ?").get(runId) as RunRow | undefined;
    if (!row) return undefined;
    const summary = toRunSummary(row);

    const scen = this.db
      .prepare(
        `SELECT s.model AS model, pc.kind AS kind
           FROM scenarios s LEFT JOIN provider_credentials pc ON pc.id = s.provider_id
          WHERE s.id = ?`,
      )
      .get(row.scenario_id) as { model: string | null; kind: string | null } | undefined;

    const serverIds = (
      this.db
        .prepare("SELECT server_id FROM scenario_servers WHERE scenario_id = ?")
        .all(row.scenario_id) as Array<{ server_id: string }>
    ).map((r) => r.server_id);

    const skillIds = (
      this.db
        .prepare("SELECT DISTINCT skill_id FROM run_skills WHERE run_id = ?")
        .all(runId) as Array<{ skill_id: string }>
    ).map((r) => r.skill_id);

    // suiteId + collection membership (via the suite) — mirrors the correlated subqueries in the SQL
    // translation: a run belongs to a collection through its TEST's membership OR its SUITE's.
    let suiteId: string | undefined;
    const collectionIds = new Set<string>();
    if (row.suite_run_id) {
      const sr = this.db
        .prepare(
          `SELECT sr.suite_id AS suite_id, su.collection_id AS collection_id
             FROM suite_runs sr LEFT JOIN suites su ON su.id = sr.suite_id
            WHERE sr.id = ?`,
        )
        .get(row.suite_run_id) as
        | { suite_id: string | null; collection_id: string | null }
        | undefined;
      if (sr?.suite_id) suiteId = sr.suite_id;
      if (sr?.collection_id) collectionIds.add(sr.collection_id);
    }
    const testColl = this.db
      .prepare("SELECT collection_id FROM tests WHERE id = ?")
      .get(row.test_id) as { collection_id: string | null } | undefined;
    if (testColl?.collection_id) collectionIds.add(testColl.collection_id);

    // Latest-per-grader score (score IS NOT NULL), mirroring the SQL EXISTS clause's MAX(created_at).
    const gradeRows = this.db
      .prepare(
        `SELECT g.grader_id AS grader_id, g.score AS score
           FROM run_grades g
          WHERE g.run_id = ? AND g.score IS NOT NULL
            AND g.created_at = (SELECT MAX(g2.created_at) FROM run_grades g2
                                 WHERE g2.run_id = g.run_id AND g2.grader_id = g.grader_id)`,
      )
      .all(runId) as Array<{ grader_id: string; score: number }>;
    const scores: RunCandidateScore[] = [];
    const seenGraders = new Set<string>();
    for (const g of gradeRows) {
      if (seenGraders.has(g.grader_id)) continue; // a created_at tie could return two rows — keep one
      seenGraders.add(g.grader_id);
      scores.push({ grader: g.grader_id, score: g.score });
    }

    // Human feedback keys (run- OR step-level) + whether any carries a score — mirrors the SQL EXISTS.
    const feedbackKeys = (
      this.db
        .prepare("SELECT DISTINCT key FROM run_feedback WHERE run_id = ?")
        .all(runId) as Array<{ key: string }>
    ).map((r) => r.key);
    const hasFeedbackScore = Boolean(
      this.db
        .prepare("SELECT 1 FROM run_feedback WHERE run_id = ? AND score IS NOT NULL LIMIT 1")
        .get(runId),
    );

    return {
      status: summary.status,
      ...(summary.outcome !== undefined ? { outcome: summary.outcome } : {}),
      ...(summary.stopReasonCode !== undefined ? { stopReasonCode: summary.stopReasonCode } : {}),
      ...(summary.phase !== undefined ? { phase: summary.phase } : {}),
      seen: summary.seen ?? false,
      mode: summary.mode,
      scenarioId: summary.scenarioId,
      testId: summary.testId,
      ...(summary.suiteRunId !== undefined ? { suiteRunId: summary.suiteRunId } : {}),
      costUsd: summary.costUsd,
      tokensIn: summary.tokensIn,
      tokensOut: summary.tokensOut,
      ...(summary.activeDurationMs !== undefined
        ? { activeDurationMs: summary.activeDurationMs }
        : {}),
      ...(summary.totalDurationMs !== undefined
        ? { totalDurationMs: summary.totalDurationMs }
        : {}),
      startedAt: summary.startedAt,
      ...(scen?.kind ? { providerKind: scen.kind as ProviderKind } : {}),
      ...(scen?.model ? { model: scen.model } : {}),
      serverIds,
      skillIds,
      ...(suiteId !== undefined ? { suiteId } : {}),
      collectionIds: [...collectionIds],
      scores,
      feedbackKeys,
      hasFeedbackScore,
      pinned: summary.pinned ?? false,
      // Observability (WP3.3, D-OB18) — fork lineage as a boolean facet (mirrors the SQL translation's
      // `derived_from_run_id IS [NOT] NULL`); the shared `matchesRunFilter` default-excludes it.
      derived: row.derived_from_run_id !== null,
    };
  }

  /**
   * Observability (WP1.5, D-OB15) — attach the MINIMAL run-level human-feedback aggregate chip
   * (`RunSummary.feedback`) to a batch of summaries, one query for the whole page (mirrors
   * `fetchSnippets` above). A run with no run-level feedback is left untouched (the field stays
   * absent, never `[]`) — the "queryRuns({}) equals listRuns()" byte-identity invariant holds
   * whether or not any feedback exists, because BOTH callers route through this same helper.
   * Mutates and returns the SAME array (so call sites can inline it).
   */
  private attachFeedback(summaries: RunSummary[]): RunSummary[] {
    if (summaries.length === 0) return summaries;
    const byRun = fetchRunFeedbackSummaries(
      this.db,
      summaries.map((s) => s.id),
    );
    for (const summary of summaries) {
      const rows = byRun.get(summary.id);
      if (rows && rows.length > 0) summary.feedback = rows;
    }
    return summaries;
  }

  /**
   * Auto-Rating (WP 4.1) — the ORDERED tool-call SHAPE of a run: the tool names of its `tool_call`
   * steps in trace order (`run_steps.idx ASC`), so the suite report can count distinct tool-path shapes
   * across a test group (`toolPathVariance`). Read-only + deterministic; a deleted run yields `[]` (no
   * throw). Falls back to the step `label` when a step carries no `tool_name`.
   */
  getToolCallSequence(runId: string): string[] {
    const rows = this.db
      .prepare(
        "SELECT tool_name, label FROM run_steps WHERE run_id = ? AND type = 'tool_call' ORDER BY idx ASC",
      )
      .all(runId) as Array<{ tool_name: string | null; label: string }>;
    return rows.map((row) => row.tool_name ?? row.label);
  }

  /**
   * Compare rows for the given run ids (WP 2.2 → consumed by WP 3.8). Each row is the run's
   * {@link RunSummary} enriched with its scenario name + model (joined from `scenarios`) so the UI can
   * label the columns. Unknown ids are skipped (the result only contains rows that exist). Order
   * follows `started_at DESC` like the history list. Typically these are one test's runs across
   * scenarios, but no test-scoping is enforced here — the caller selects the ids.
   */
  compareRuns(runIds: string[]): CompareRow[] {
    if (runIds.length === 0) return [];
    const placeholders = runIds.map(() => "?").join(", ");
    const rows = this.db
      .prepare(
        `SELECT r.*, s.name AS scenario_name, s.model AS scenario_model
           FROM runs r
           JOIN scenarios s ON s.id = r.scenario_id
          WHERE r.id IN (${placeholders})
          ORDER BY r.started_at DESC`,
      )
      .all(...runIds) as Array<RunRow & { scenario_name: string; scenario_model: string }>;
    return rows.map((row) => ({
      ...toRunSummary(row),
      scenarioName: row.scenario_name,
      model: row.scenario_model,
    }));
  }

  /**
   * On API restart, any `runs` still marked `running` have lost their in-memory session (the process is
   * gone), so mark them `aborted`. Returns the number of rows reconciled. Wired in `index.ts` next to
   * the repo construction. The partial record stays openable read-only.
   *
   * AR11 — the same reconciliation settles an ORPHANED review: an orphaned run's rating chain will
   * never run, and a run that crashed mid-review (terminal but still `pending`/`rating`) will never
   * settle, so both land on `skipped` — keeping the invariant "a terminal row always converges on a
   * settled rating_state" that the SSE close semantics rely on.
   */
  abortOrphanedRuns(): number {
    const result = this.db
      .prepare(
        "UPDATE runs SET status = 'aborted', rating_state = 'skipped' WHERE status = 'running'",
      )
      .run();
    // A run that reached its terminal status but crashed before its review settled: settle it honestly.
    // Unified Sessions (WP1.6, D-US2) — 'ended' joins this terminal list: an interactive session the
    // operator closed via `/end` is just as terminal here as any other disposition (a crash between the
    // terminal write and the review's settled state must still converge to a settled rating).
    this.db
      .prepare(
        `UPDATE runs SET rating_state = 'skipped'
          WHERE rating_state IN ('pending','rating')
            AND status IN ('completed','stopped','error','aborted','ended')`,
      )
      .run();
    return result.changes;
  }

  /**
   * Delete a run and its child `run_steps` + `run_events` rows in one transaction, returning WHAT was
   * removed so a UI can confirm. Both child tables declare `ON DELETE CASCADE` on `runs(id)`, so the
   * parent delete removes them — counted first (while present). Also drops any live write cursor so a
   * late-arriving event for the deleted run is a no-op. 404s if the run doesn't exist.
   */
  delete(runId: string): RunDeletionResult {
    const remove = this.db.transaction((): RunDeletionResult => {
      const exists = this.db.prepare("SELECT 1 FROM runs WHERE id = ?").get(runId);
      if (!exists) throw httpError(404, "Run not found");

      const count = (table: string): number =>
        (
          this.db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE run_id = ?`).get(runId) as {
            n: number;
          }
        ).n;
      const result: RunDeletionResult = {
        runId,
        deletedSteps: count("run_steps"),
        deletedEvents: count("run_events"),
      };

      // Observability (WP1.3) — purge this run's full-text documents BEFORE the row goes: the docmap's
      // ON DELETE CASCADE would drop the map rows on the `DELETE FROM runs` below, but the FTS rows are
      // deleted by rowid via the map, so it must happen while the map still holds them.
      this.indexSafely(() => this.search.purgeRun(runId));
      // Parent delete cascades to run_steps + run_events (FK ON DELETE CASCADE).
      this.db.prepare("DELETE FROM runs WHERE id = ?").run(runId);
      this.cursors.delete(runId);
      return result;
    });
    return remove();
  }

  /**
   * Retention classes (WP1.6) — apply a {@link RunRetentionPolicy}, deleting every run it selects
   * through the SAME full cascade {@link delete} uses (steps/events/grades/skills + the WP1.3
   * full-text purge) — never a bespoke bulk `DELETE`, so a pruned run disappears from every derived
   * surface exactly like an operator-deleted one.
   *
   * A run is a candidate ONLY when its status is in {@link policy}'s `byStatus` AND that status is
   * TERMINAL ({@link isTerminalStatus} — `pending`/`running` entries are silently ignored, a
   * defense-in-depth guard: a live run must never be pruned even if misconfigured) AND `pinned = 0`
   * (a pinned run is NEVER a candidate, regardless of policy — the WP1.6 invariant). Within a
   * status's candidate set, a run qualifies as a victim when it satisfies EITHER configured bound
   * (`olderThanDays` OR beyond the `keepNewest` newest-by-`startedAt` window) — the victim set is
   * their UNION. An empty/absent policy (`byStatus: {}`, the default) prunes nothing.
   */
  pruneRuns(policy: RunRetentionPolicy): RunPruneResult {
    const prunedRunIds: string[] = [];
    let deletedSteps = 0;
    let deletedEvents = 0;
    for (const [status, rule] of Object.entries(policy.byStatus ?? {})) {
      if (!rule || (rule.olderThanDays === undefined && rule.keepNewest === undefined)) continue;
      if (!isTerminalStatus(status as RunStatus)) continue;
      const candidates = this.db
        .prepare(
          "SELECT id, started_at FROM runs WHERE status = @status AND pinned = 0 ORDER BY started_at DESC, id DESC",
        )
        .all({ status }) as Array<{ id: string; started_at: string }>;
      const victims = new Set<string>();
      if (rule.keepNewest !== undefined) {
        for (const row of candidates.slice(rule.keepNewest)) victims.add(row.id);
      }
      if (rule.olderThanDays !== undefined) {
        const cutoff = new Date(Date.now() - rule.olderThanDays * 86_400_000).toISOString();
        for (const row of candidates) {
          if (row.started_at < cutoff) victims.add(row.id);
        }
      }
      for (const id of victims) {
        const result = this.delete(id);
        prunedRunIds.push(id);
        deletedSteps += result.deletedSteps;
        deletedEvents += result.deletedEvents;
      }
    }
    return { policy, prunedRunIds, deletedSteps, deletedEvents };
  }
}

type RunCursor = {
  idx: number;
  /**
   * Per-run monotonic step ordinal for `run_steps.idx`, incremented in emission order. Distinct from
   * `idx` (which counts ALL run_events). `step.index` is NOT used because it is a per-component counter
   * (engine/accounting/MCP each start at 0) and thus not globally ordered.
   */
  stepIdx: number;
  startedAtMs: number;
  kpi?: KpiEvent;
  /** Tracked across steps so the finalized total is the run's peak, not just the last snapshot. */
  peakContextTokens?: number;
  cachedTokens?: number;
  /**
   * RM-33 (D-CT3) — the read/write halves, re-accumulated from the steps for the same reason
   * `cachedTokens` is: a run can terminate before any `kpi` event lands, and the steps are the only
   * place the split is guaranteed to exist. `undefined` (not 0) when no step reported a cache slice,
   * so finalize can write a genuine SQL NULL — "unknown", never a fabricated zero.
   */
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  /**
   * Observability (WP3.1, D-OB17) — maps each persisted step's EMITTED id (`RunStep.id`) to its
   * PERSISTED `run_steps.id`, so a later child's emitted `parentStepId` resolves to the real parent row.
   * Only earlier-in-emission-order steps are present, which is exactly the "earlier step of the same
   * run" validation the persist path needs (a forward/dangling ref simply isn't in the map → null).
   */
  stepIdByEmittedId: Map<string, string>;
};

type KpiEvent = Extract<RunEvent, { type: "kpi" }>;
type TerminalStatusEvent = Extract<RunEvent, { type: "status" }>;

export type CreateRunInput = {
  testId: string;
  scenarioId: string;
  mode: RunMode;
  /**
   * Observability (WP3.3, D-OB18) — fork lineage, set ONLY when this run is a FORK of `derivedFromRunId`
   * (created via `POST /api/runs/:id/rerun`). Stamped ATOMICALLY at INSERT (never a later UPDATE) so a
   * derived run is derived from the instant it exists — there is no window where it's visible as a plain
   * run (it must be hidden from the feed + excluded from suite aggregates from the start). `forkStepId`
   * is the parent step it was forked at (absent ⇒ a whole-run re-launch). Omitted for an ordinary run.
   */
  derivedFromRunId?: string;
  forkStepId?: string;
};

/**
 * Observability (WP3.1, D-OB17) — the input to {@link RunRepository.appendDerivedStep}: a
 * post-terminal hierarchy span (`rating`/`judge_call`/…). `type` defaults to `context_event` (a
 * control/meta step that never counts as a turn or tool-call), `status` to `ok`. `parentStepId` is an
 * already-persisted `run_steps.id` of the same run (validated).
 */
export type DerivedStepInput = {
  spanKind: SpanKind;
  label: string;
  type?: RunStepType;
  status?: RunStep["status"];
  parentStepId?: string;
  durationMs?: number;
  payload?: unknown;
};

/** One resolved skill-version a run exercised (WP 2.1) — the input to {@link RunRepository.recordRunSkills}. */
export type RunSkillInput = {
  skillId: string;
  skillVersionId: string;
  /** Denormalized display label (kept so history survives the version's later deletion). */
  versionLabel?: string;
  /** Whether the attachment was eager (WP 2.3). */
  eager?: boolean;
};

/**
 * The LEGACY scalar filter for {@link RunRepository.listRuns} (renamed from `RunFilter` in WP1.1 so the
 * shared Observability {@link RunFilter} grammar can own that name). Its internal callers (startup
 * stop-active, Assistant tools, the H-2 live-run guard) pass single scalars — never the array grammar.
 */
export type ListRunsFilter = {
  testId?: string;
  scenarioId?: string;
  status?: RunStatus;
  /** R3.1 — optional SQL-level `LIMIT` on the newest-first result (most-recent-N reads). Additive:
   *  omitted → the full, unbounded history (every pre-existing caller). A non-positive/non-integer
   *  value is ignored (treated as unbounded). */
  limit?: number;
};

// ── Observability — RunFilter → SQL translation (WP1.1, D-OB1) ────────────────────────────────────
// A pure builder of a parameterized WHERE for {@link RunRepository.queryRuns}. Every VALUE is bound
// via a generated `@pN` name (no injection); array fields expand to `IN (@p0, @p1, …)`; joins are
// correlated subqueries against existing tables (no denormalization). Its semantics mirror the shared
// `matchesRunFilter` predicate exactly (locked by the cross-check test).

/** Sortable field → safe SQL column/expression (validated allowlist; never user-interpolated). */
const RUN_SORT_COLUMNS: Record<RunSortField, string> = {
  startedAt: "started_at",
  costUsd: "cost_usd",
  tokens: "(tokens_in + tokens_out)",
  // Duration is the ACTIVE duration (activeDurationMs ?? totalDurationMs, D-US3 / conventions §4).
  durationMs: "COALESCE(active_duration_ms, total_duration_ms)",
  peakContextTokens: "peak_context_tokens",
};

/** ORDER BY for a run query. Default `started_at DESC` (today's `listRuns` order, byte-identical). A
 *  non-startedAt sort gets a stable `started_at DESC` tiebreaker. */
function buildRunOrderBy(sort?: RunSort): string {
  if (!sort) return "ORDER BY started_at DESC";
  const column = RUN_SORT_COLUMNS[sort.field];
  const direction = sort.direction === "asc" ? "ASC" : "DESC";
  if (sort.field === "startedAt") return `ORDER BY ${column} ${direction}`;
  return `ORDER BY ${column} ${direction}, started_at DESC`;
}

function buildRunFilterWhere(filter: RunFilter): {
  clauses: string[];
  params: Record<string, string | number>;
} {
  const clauses: string[] = [];
  const params: Record<string, string | number> = {};
  let seq = 0;
  // Register one bound value, return its `@pN` placeholder (referenceable more than once).
  const bind = (value: string | number): string => {
    const name = `p${seq++}`;
    params[name] = value;
    return `@${name}`;
  };
  // Register a list of values, return `@p0, @p1, …` for an `IN (…)`.
  const bindList = (values: readonly (string | number)[]): string =>
    values.map((value) => bind(value)).join(", ");
  const nonEmpty = (values?: readonly string[]): values is string[] =>
    Array.isArray(values) && values.length > 0;

  // ── Direct `runs` columns ──
  if (nonEmpty(filter.status)) clauses.push(`status IN (${bindList(filter.status)})`);
  if (nonEmpty(filter.outcome)) clauses.push(`outcome IN (${bindList(filter.outcome)})`);
  if (nonEmpty(filter.stopReasonCode)) {
    clauses.push(`stop_reason_code IN (${bindList(filter.stopReasonCode)})`);
  }
  if (nonEmpty(filter.phase)) clauses.push(`phase IN (${bindList(filter.phase)})`);
  if (filter.seen !== undefined) clauses.push(`seen = ${bind(filter.seen ? 1 : 0)}`);
  if (nonEmpty(filter.scenarioId)) clauses.push(`scenario_id IN (${bindList(filter.scenarioId)})`);
  if (nonEmpty(filter.testId)) clauses.push(`test_id IN (${bindList(filter.testId)})`);
  if (filter.suiteRunId !== undefined) clauses.push(`suite_run_id = ${bind(filter.suiteRunId)}`);
  if (filter.interactiveOnly === true) clauses.push("mode = 'interactive'");
  // "Needs attention" as a filter (owner-requested) — the unified-sessions `runNeedsAttention` rule
  // EXPOSED as a filterable property, over the existing status/phase/seen columns (no migration).
  // NULL-safe like `hasError` below: `phase` and `seen` are nullable, so `COALESCE(phase,'')` /
  // `COALESCE(seen,0)` keep the whole expression 2-valued — the negation (`needsAttention:false`) is
  // then exact, and `COALESCE(phase,'')='waiting_input'` mirrors the predicate's `phase === "waiting_input"`
  // (undefined ≠ 'waiting_input'). Mirrors the shared `runNeedsAttention` predicate AND the REPLICATED
  // copy in observability/metrics.ts EXACTLY — kept in agreement by the SQL-vs-predicate cross-check test.
  if (filter.needsAttention !== undefined) {
    const predicate =
      "((status = 'running' AND COALESCE(phase, '') = 'waiting_input') OR (COALESCE(seen, 0) = 0 AND status <> 'running'))";
    clauses.push(filter.needsAttention ? predicate : `NOT ${predicate}`);
  }
  if (filter.hasError !== undefined) {
    // NULL-safe: `outcome` is nullable, and `FALSE OR NULL = NULL` in SQL's three-valued logic would
    // otherwise drop a NULL-outcome run from `hasError:false`. COALESCE keeps it a plain boolean so the
    // negation is exact — matching the predicate's "status/outcome === 'error'" (undefined ≠ 'error').
    const predicate = "(status = 'error' OR COALESCE(outcome, '') = 'error')";
    clauses.push(filter.hasError ? predicate : `NOT ${predicate}`);
  }
  if (filter.costUsdGte !== undefined) clauses.push(`cost_usd >= ${bind(filter.costUsdGte)}`);
  if (filter.costUsdLte !== undefined) clauses.push(`cost_usd <= ${bind(filter.costUsdLte)}`);
  if (filter.tokensGte !== undefined)
    clauses.push(`(tokens_in + tokens_out) >= ${bind(filter.tokensGte)}`);
  if (filter.tokensLte !== undefined)
    clauses.push(`(tokens_in + tokens_out) <= ${bind(filter.tokensLte)}`);
  // Duration = ACTIVE duration (activeDurationMs ?? totalDurationMs, D-US3). A run with neither
  // measured (only the legacy `duration_ms`) has a NULL coalesced value → excluded by the bound (SQL
  // NULL comparison is false) — matches the predicate's "neither → cannot satisfy" rule.
  if (filter.durationMsGte !== undefined) {
    clauses.push(
      `COALESCE(active_duration_ms, total_duration_ms) >= ${bind(filter.durationMsGte)}`,
    );
  }
  if (filter.durationMsLte !== undefined) {
    clauses.push(
      `COALESCE(active_duration_ms, total_duration_ms) <= ${bind(filter.durationMsLte)}`,
    );
  }
  if (filter.dateFrom !== undefined) clauses.push(`started_at >= ${bind(filter.dateFrom)}`);
  if (filter.dateTo !== undefined) clauses.push(`started_at <= ${bind(filter.dateTo)}`);

  // ── Joined dimensions (correlated subqueries; reuse existing access paths) ──
  if (nonEmpty(filter.providerKind)) {
    clauses.push(
      `scenario_id IN (SELECT s.id FROM scenarios s JOIN provider_credentials pc ON pc.id = s.provider_id WHERE pc.kind IN (${bindList(
        filter.providerKind,
      )}))`,
    );
  }
  if (nonEmpty(filter.model)) {
    clauses.push(
      `scenario_id IN (SELECT id FROM scenarios WHERE model IN (${bindList(filter.model)}))`,
    );
  }
  if (nonEmpty(filter.serverId)) {
    clauses.push(
      `EXISTS (SELECT 1 FROM scenario_servers ss WHERE ss.scenario_id = runs.scenario_id AND ss.server_id IN (${bindList(
        filter.serverId,
      )}))`,
    );
  }
  if (nonEmpty(filter.skillId)) {
    clauses.push(
      `EXISTS (SELECT 1 FROM run_skills rk WHERE rk.run_id = runs.id AND rk.skill_id IN (${bindList(
        filter.skillId,
      )}))`,
    );
  }
  if (filter.suiteId !== undefined) {
    clauses.push(
      `suite_run_id IN (SELECT id FROM suite_runs WHERE suite_id = ${bind(filter.suiteId)})`,
    );
  }
  if (filter.collectionId !== undefined) {
    // A run belongs to a collection via its TEST's membership OR its SUITE's membership.
    const collectionParam = bind(filter.collectionId);
    clauses.push(
      `(test_id IN (SELECT id FROM tests WHERE collection_id = ${collectionParam}) OR ` +
        `suite_run_id IN (SELECT sr.id FROM suite_runs sr JOIN suites su ON su.id = sr.suite_id WHERE su.collection_id = ${collectionParam}))`,
    );
  }

  // ── Score / grader (latest grade per grader; append-only `run_grades`, latest-per-(run,grader) wins) ──
  if (
    filter.scoreGte !== undefined ||
    filter.scoreLte !== undefined ||
    filter.grader !== undefined
  ) {
    const parts = ["g.run_id = runs.id", "g.score IS NOT NULL"];
    if (filter.grader !== undefined) parts.push(`g.grader_id = ${bind(filter.grader)}`);
    if (filter.scoreGte !== undefined) parts.push(`g.score >= ${bind(filter.scoreGte)}`);
    if (filter.scoreLte !== undefined) parts.push(`g.score <= ${bind(filter.scoreLte)}`);
    parts.push(
      "g.created_at = (SELECT MAX(g2.created_at) FROM run_grades g2 WHERE g2.run_id = g.run_id AND g2.grader_id = g.grader_id)",
    );
    clauses.push(`EXISTS (SELECT 1 FROM run_grades g WHERE ${parts.join(" AND ")})`);
  }

  // Retention classes (WP1.6) — `runs.pinned` is now a REAL column (was a "match nothing" placeholder
  // through WP1.1–1.5). Mirrors the `seen` clause above exactly. Kept in agreement with the REPLICATED
  // copy in observability/metrics.ts and the pure `matchesRunFilter` predicate in shared by the SQL-vs-
  // predicate cross-check test.
  if (filter.pinned !== undefined) clauses.push(`pinned = ${bind(filter.pinned ? 1 : 0)}`);

  // Human feedback (WP1.5, D-OB15) — `run_feedback` is now a REAL table (was a "match nothing"
  // placeholder through WP1.1–1.4). Mirrors the score/grader EXISTS clause above. An EMPTY
  // `feedback: {}` imposes NO constraint (mirrors `pinned`/`seen`'s absent-field convention); a
  // present `key`/`hasScore:true` narrows via a correlated EXISTS over BOTH run- and step-level rows
  // (any matching row on the run counts — the RUN-LEVEL-only aggregate on RunSummary is a SEPARATE,
  // narrower concern). Kept in agreement with the REPLICATED copy in observability/metrics.ts and the
  // pure `matchesRunFilter` predicate in shared by the SQL-vs-predicate cross-check test.
  if (filter.feedback !== undefined) {
    const parts = ["f.run_id = runs.id"];
    if (filter.feedback.key !== undefined) parts.push(`f.key = ${bind(filter.feedback.key)}`);
    if (filter.feedback.hasScore === true) parts.push("f.score IS NOT NULL");
    if (parts.length > 1) {
      clauses.push(`EXISTS (SELECT 1 FROM run_feedback f WHERE ${parts.join(" AND ")})`);
    }
  }

  // Fork lineage (WP3.3, D-OB18) — `runs.derived_from_run_id` is now a REAL column (was a "match
  // nothing" placeholder through WP1.1–3.2). DEFAULT EXCLUDE: `derived:true` keeps ONLY forked runs;
  // absent/`derived:false` excludes them (the runs feed hides forks unless "show forks"). Mirrors the
  // pure `matchesRunFilter` predicate in shared EXACTLY (keeps a derived run out of a filtered feed the
  // same way the predicate does) and the REPLICATED copy in observability/metrics.ts — kept in agreement
  // by the SQL-vs-predicate cross-check test.
  if (filter.derived === true) clauses.push("derived_from_run_id IS NOT NULL");
  else clauses.push("derived_from_run_id IS NULL");

  return { clauses, params };
}

// ── Redaction (mandatory acceptance) ────────────────────────────────────────────────────────────

/**
 * Field names that may carry a provider API key or an MCP secret in a tool-call argument / payload.
 * Matched case-insensitively against object keys; the value is replaced with a marker. This mirrors the
 * project's secret discipline (`.claude/rules/mcp-and-security.md`): a run transcript NEVER stores a
 * provider key or MCP secret, and known-secret tool-argument fields are stripped before persisting.
 */
const SECRET_KEY_PATTERN =
  /(api[-_ ]?key|secret|password|passwd|token|authorization|auth[-_ ]?token|bearer|credential|private[-_ ]?key|access[-_ ]?key|client[-_ ]?secret|session[-_ ]?id|cookie|x[-_ ]?api[-_ ]?key)/i;

/**
 * Value-level safety net: provider-API-key shapes that must never be persisted even if they appear in
 * a benignly-named field's *value* (defense in depth on top of the key-name strip). Covers the common
 * prefixes (Anthropic `sk-ant-…`, OpenAI `sk-…`, Google `AIza…`) and bearer tokens.
 */
const SECRET_VALUE_PATTERN =
  /\b(sk-ant-[A-Za-z0-9_-]{8,}|sk-[A-Za-z0-9_-]{16,}|AIza[A-Za-z0-9_-]{16,})\b/g;

const REDACTED = "[redacted]";
/** Truncate any single string longer than this; large tool results bloat the DB (WP 1.6 note). */
const MAX_STRING_BYTES = 16 * 1024;

/**
 * Deep-redact a value before persistence: drop known-secret fields (by key name) and truncate very
 * large strings with a `"+N bytes"` marker so the DB doesn't bloat. Pure (returns a new value) and
 * cycle-safe. Used for both `run_steps.payload_json` and the `run_events` replay log.
 */
function redactValue(value: unknown, seen: WeakSet<object> = new WeakSet()): unknown {
  if (typeof value === "string") return truncateString(value);
  if (value === null || typeof value !== "object") return value;

  if (seen.has(value as object)) return "[circular]";
  seen.add(value as object);

  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item, seen));
  }

  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    // Redact a secret-named field — UNLESS its value is a number. The pattern intentionally matches
    // `token` (bearer/session tokens), which also matches the run's numeric accounting fields
    // (`tokensIn`/`tokensOut`/`contextTokens`/`inputTokens`/…). A number can never carry a secret, so
    // exempting numbers keeps real token COUNTS in the persisted KPI/usage payloads (otherwise replay
    // rebuilds NaN KPIs from `"[redacted]"`), while every string/object secret stays redacted.
    out[key] =
      SECRET_KEY_PATTERN.test(key) && typeof item !== "number" ? REDACTED : redactValue(item, seen);
  }
  return out;
}

/**
 * Scrub provider-key-shaped substrings (defense in depth) then truncate an over-long string with a
 * `"…+N bytes"` marker (UTF-8 byte budget).
 */
function truncateString(value: string): string {
  const scrubbed = value.replace(SECRET_VALUE_PATTERN, REDACTED);
  const bytes = Buffer.byteLength(scrubbed, "utf8");
  if (bytes <= MAX_STRING_BYTES) return scrubbed;
  const head = Buffer.from(scrubbed, "utf8").subarray(0, MAX_STRING_BYTES).toString("utf8");
  return `${head}…+${bytes - MAX_STRING_BYTES} bytes`;
}

// ── Mappers (row → shared contract) ──────────────────────────────────────────────────────────────

/** One `run_skills` row joined to its skill name + resolved version's token subtotals (nullable when
 *  the skill/version was deleted after the run). Shape of {@link RunRepository.listRunSkillSummaries}'s query. */
type RunSkillSummaryRow = {
  skillId: string;
  skillVersionId: string;
  versionLabel: string | null;
  eager: number;
  skillName: string | null;
  l1: number | null;
  l2: number | null;
  l3: number | null;
  total: number | null;
};

/**
 * The primary-profile token count from a step's persisted `profile_tokens_json`: the default
 * `generic_o200k` lens when present, else the first finite numeric lens, else 0. Used to attribute a
 * skill-disclosure read's realized context cost with a single, stable profile (matches the profile the
 * skill-version footprint subtotals are computed under).
 */
function primaryProfileTokens(json: string): number {
  const obj = parseJsonObject<Record<string, unknown>>(json, {});
  const preferred = obj.generic_o200k;
  if (typeof preferred === "number" && Number.isFinite(preferred)) return preferred;
  for (const value of Object.values(obj)) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return 0;
}

function toRunSummary(row: RunRow): RunSummary {
  return {
    id: row.id,
    testId: row.test_id,
    scenarioId: row.scenario_id,
    mode: row.mode as RunMode,
    status: row.status as RunStatus,
    outcome: (row.outcome ?? undefined) as RunOutcome | undefined,
    startedAt: row.started_at,
    durationMs: row.duration_ms ?? undefined,
    turns: row.turns,
    toolCalls: row.tool_calls,
    peakContextTokens: row.peak_context_tokens,
    tokensIn: row.tokens_in,
    tokensOut: row.tokens_out,
    costUsd: row.cost_usd,
    // RM-33 (D-CT1/D-CT2) — the cache composition of `tokensIn`, which stays GROSS above. Before this,
    // `runs.cached_tokens` was written on every finalize and then mapped NOWHERE: the column existed,
    // the number was correct, and no consumer could ever see it. `cached_tokens` is NOT NULL so it is
    // always sent; the two halves are nullable and a NULL means UNKNOWN (a run persisted before
    // migration v59 with no usage-bearing steps to backfill from), so they are dropped rather than
    // coalesced to 0 — a consumer must be able to tell "no cache" from "we don't know" (D-CT6).
    cachedTokens: row.cached_tokens,
    ...(row.cache_read_tokens === null ? {} : { cacheReadTokens: row.cache_read_tokens }),
    ...(row.cache_write_tokens === null ? {} : { cacheWriteTokens: row.cache_write_tokens }),
    // B7 / Testing IA — the suite run this run belongs to (denormalized reference, NOT an FK) plus its
    // 1-based repetition ordinal. Present ONLY for suite-matrix members so the unified Runs feed can
    // nest members under their suite-run summary row. Additive/optional: NULL columns → fields absent.
    suiteRunId: row.suite_run_id ?? undefined,
    repetition: row.repetition ?? undefined,
    // AR11 — the post-run review axis (NOT NULL, default 'pending'; v27 backfills). Always sent.
    ratingState: row.rating_state as RatingState,
    // Claude subscription (WP 3.1, D-CS4/D-CS8) — HOW `costUsd` was derived, so the Runs feed +
    // Compare can mark a `claude_subscription` run's shadow-priced cost "est. · subscription". NULL
    // (every ordinary run + every run persisted before v29) → the field is absent, which every
    // consumer reads as the ordinary, exactly-billed `"api_exact"` cost.
    costBasis: (row.cost_basis ?? undefined) as CostBasis | undefined,
    // WP 5.1 — validation-gate assertion results (present only when the test declared assertions AND
    // the run was evaluated on completion). Additive/optional: NULL column → field absent.
    ...(row.assertion_results_json
      ? { assertionResults: parseJsonObject<AssertionResult[]>(row.assertion_results_json, []) }
      : {}),
    // ── Unified Sessions (planning/Roadmap/completed/RM-29-unified-sessions/, WP1.6) — additive run-lifecycle surface. All
    // NULL-safe: a run persisted before this workstream carries none of these and reads exactly as it
    // always has.
    stopReasonCode: (row.stop_reason_code ?? undefined) as StopReasonCode | undefined,
    phase: (row.phase ?? undefined) as RunPhase | undefined,
    endedAt: row.ended_at ?? undefined,
    seen: row.seen === 1,
    capabilities: parseCapabilities(row.capabilities_json),
    activeDurationMs: row.active_duration_ms ?? undefined,
    totalDurationMs: row.total_duration_ms ?? undefined,
    // Observability (WP1.6) — retention classes. NOT NULL DEFAULT 0, so always sent.
    pinned: row.pinned === 1,
    // Observability (WP3.3, D-OB18) — fork lineage. Present ONLY on a derived run (both NULL columns →
    // fields absent, byte-identical to every ordinary/pre-v42 run). `forkStepId` absent even on a
    // derived run means a whole-run re-launch.
    ...(row.derived_from_run_id ? { derivedFromRunId: row.derived_from_run_id } : {}),
    ...(row.fork_step_id ? { forkStepId: row.fork_step_id } : {}),
  };
}

/**
 * Parse a persisted `capabilities_json` cell into a validated {@link SessionCapabilities}, or `undefined`
 * for an absent/malformed value (a NULL column on a pre-contract run, or a hand-edited/corrupt row) —
 * never throws. Validated (not just JSON-parsed) via {@link sessionCapabilitiesSchema} so a shape drift
 * surfaces as "absent" rather than a bad object reaching the UI.
 */
function parseCapabilities(json: string | null): SessionCapabilities | undefined {
  if (!json) return undefined;
  try {
    const parsed = sessionCapabilitiesSchema.safeParse(JSON.parse(json));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Unified Sessions (WP1.6, D-US1) — reconstruct the still-OPEN agent-initiated questions from a run's
 * full event log: every `question` whose `questionId` has no LATER matching `question_resolved` in the
 * same log. Order-preserving (first-asked-first); a run with no unresolved question returns `[]`. Pure.
 */
function reconstructOpenQuestions(events: RunEvent[]): RunOpenQuestion[] {
  const open = new Map<string, RunOpenQuestion>();
  for (const event of events) {
    if (event.type === "question") {
      open.set(event.questionId, {
        questionId: event.questionId,
        prompt: event.prompt,
        options: event.options,
        allowOther: event.allowOther,
      });
    } else if (event.type === "question_resolved") {
      open.delete(event.questionId);
    }
  }
  return [...open.values()];
}

function toRunStep(row: RunStepRow): RunStep {
  return {
    id: row.id,
    runId: row.run_id,
    index: row.idx,
    type: row.type as RunStepType,
    label: row.label,
    status: row.status as RunStep["status"],
    durationMs: row.duration_ms ?? undefined,
    serverId: row.server_id ?? undefined,
    toolName: row.tool_name ?? undefined,
    profileTokens: parseJsonObject<Partial<Record<TokenProfileRef, number>>>(
      row.profile_tokens_json,
      {},
    ),
    usageActual: row.usage_actual_json
      ? parseJsonObject<TokenUsageActual | undefined>(row.usage_actual_json, undefined)
      : undefined,
    context: row.context_snapshot_json
      ? parseJsonObject<ContextSnapshot | undefined>(row.context_snapshot_json, undefined)
      : undefined,
    cumulativeTokens: row.cumulative_tokens ?? undefined,
    // F2 — per-turn assistant prose + reasoning (already redacted on write); round-tripped for replay.
    assistantText: row.assistant_text ?? undefined,
    reasoningText: row.reasoning_text ?? undefined,
    turnIndex: row.turn_index ?? undefined,
    resultBytes: row.result_bytes ?? undefined,
    // Track E — per-step wall-clock timing, round-tripped for replay / the Gantt timeline.
    startedAt: row.started_at ?? undefined,
    endedAt: row.ended_at ?? undefined,
    // WP3.1 — step-hierarchy metadata (both undefined on pre-WP3.1 / unlinked steps → renders flat).
    parentStepId: row.parent_step_id ?? undefined,
    spanKind: (row.span_kind ?? undefined) as RunStep["spanKind"],
    payload: parseJsonObject<unknown>(row.payload_json, null),
  };
}

function toRunEvent(row: RunEventRow): RunEvent {
  // The stored payload is the redacted RunEvent itself (the exact replay log). Reconstruct it as-is.
  return parseJsonObject<RunEvent>(row.payload_json, {
    type: "error",
    message: "unparseable event",
  });
}
