// Unified Sessions (roadmap/unified-sessions/, WP3.R) — the REUSABLE session-state seed harness.
//
// It seeds one persisted `runs` row per **backend kind × new session state** DIRECTLY into a DB (the
// findings/08-runs-session-rework verification pattern — NO provider key, NO live LLM, NO engine
// needed), using the SAME `terminalFor()` table the three executors write through, so the persisted
// status/outcome/stop_reason_code triple is production-faithful. Each seeded run declares the exact
// {@link deriveRunStatusView} label + tone the LOCKED status table (execution-plan §1 / README D-US5)
// must render it as — so a consumer (the WP3.R conformance test, or WP5.1's final acceptance re-run,
// or a visual pass populating the running app) can prove the persistence → API → derivation path with
// ONE call.
//
// Kind is DELIBERATELY orthogonal to the label: the whole point of D-US5 is that the same state renders
// the same chip regardless of backend (`deriveRunStatusView` never consults `providerKind`/capabilities
// for the label). Seeding every state for every kind proves exactly that invariant. Kind only
// changes the persisted `capabilities_json` manifest (so a downstream visual pass exercises the
// capability-driven KPI rail too) and the provider/mode.

import { capabilitiesForProviderKind } from "../../src/testing/session-capabilities.js";
import { terminalFor, type TerminalCause } from "../../src/testing/session-terminal.js";
import type { AppDatabase } from "../../src/db/database.js";
import type {
  ProviderKind,
  RatingState,
  RunEvent,
  RunPhase,
  RunStatus,
} from "@mcp-token-footprint/shared";

/** Visual tone buckets, copied from `apps/web/src/lib/status.ts` (kept in sync by the conformance test's
 *  deep-equal against the real `deriveRunStatusView`). */
export type ExpectedTone = "success" | "danger" | "warning" | "info" | "neutral" | "pending";

/** The exact `StatusView` chip the locked table must render for a seeded state (mirrors the web
 *  `StatusView` "chip" variant). The conformance test asserts `deriveRunStatusView(...)` deep-equals this. */
export type ExpectedChip = {
  kind: "chip";
  label: string;
  tone: ExpectedTone;
  spinner: boolean;
  dashed: boolean;
};

function chip(
  label: string,
  tone: ExpectedTone,
  opts: { spinner?: boolean; dashed?: boolean } = {},
): ExpectedChip {
  return { kind: "chip", label, tone, spinner: opts.spinner ?? false, dashed: opts.dashed ?? false };
}

/** The backend families the console must render identically. */
export type SeedKind = "engine" | "subscription";

/** The one provider kind each family persists a run under (drives `capabilities_json` + the provider FK). */
const KIND_PROVIDER: Record<SeedKind, ProviderKind> = {
  engine: "anthropic",
  subscription: "claude_subscription",
};

const KIND_MODEL: Record<SeedKind, string> = {
  engine: "claude-sonnet-4",
  subscription: "claude-sonnet-4",
};

/** Every session state WP3.R exercises. The task's required set + the remaining LOCKED-table rows
 *  (`stopping`, `reviewing`, `assertions_failed`) so the sweep covers the whole table, not just the
 *  states in the prompt. */
export type SeedState =
  | "queued"
  | "waiting_input"
  | "stopping"
  | "ended"
  | "stalled"
  | "wait_expired"
  | "max_duration"
  | "context_overflow"
  | "assertions_failed"
  | "reviewing"
  | "completed"
  | "aborted"
  | "error";

/** How a state's persisted lifecycle columns are set, and the chip the locked table must render. */
type StateSpec = {
  mode: "automated" | "interactive";
  /** Terminal states derive their status/outcome/stop_reason_code from the SAME `terminalFor` table the
   *  executors write; NULL phase (finalize clears it). */
  terminal?: TerminalCause;
  /** Non-terminal states set status + phase directly. */
  liveStatus?: RunStatus;
  livePhase?: RunPhase | null;
  /** Override the outcome (e.g. `assertions_failed`, `completed`) when it isn't a `terminalFor` cause. */
  outcome?: string;
  /** Persisted rating axis. Terminal states settle `rated` (no "Reviewing…" overlay); `reviewing` stays
   *  `pending` on purpose so its overlay shows. */
  ratingState?: RatingState;
  /** The 1-based queue position — LIVE-only (the phase event's `detail.position`); NOT persisted on the
   *  run row, so a snapshot read of a queued run renders "Queued" WITHOUT a position. Kept here for the
   *  conformance test's separate LIVE-input assertion. */
  livePosition?: number;
  /** The chip a PERSISTED read (`GET /api/runs/:id` → `deriveRunStatusView`) must render. */
  expected: ExpectedChip;
  /** The chip the LIVE stream input (phase + queuePosition threaded) must render, when it differs from
   *  the persisted read (only `queued`, whose position is live-only). */
  expectedLive?: ExpectedChip;
};

/**
 * The state → {persisted columns, expected locked-table chip} table. Expected chips are transcribed from
 * the LOCKED status/label table (execution-plan §1) — the conformance test proves they equal the real
 * `deriveRunStatusView` output for every kind.
 */
export const SEED_STATE_SPECS: Record<SeedState, StateSpec> = {
  // ── Live (non-terminal) + phase overlays ──────────────────────────────────────────────────────
  queued: {
    mode: "interactive",
    liveStatus: "pending",
    livePhase: "queued",
    ratingState: "pending",
    livePosition: 3,
    // Persisted read: position is live-only → plain "Queued".
    expected: chip("Queued", "pending", { dashed: true }),
    // Live stream input (position threaded): "Queued — position 3".
    expectedLive: chip("Queued — position 3", "pending", { dashed: true }),
  },
  waiting_input: {
    mode: "interactive",
    liveStatus: "running",
    livePhase: "waiting_input",
    ratingState: "pending",
    expected: chip("Waiting for you", "info"),
  },
  stopping: {
    mode: "interactive",
    liveStatus: "running",
    livePhase: "stopping",
    ratingState: "pending",
    expected: chip("Stopping…", "neutral", { spinner: true }),
  },
  // ── Terminal ──────────────────────────────────────────────────────────────────────────────────
  ended: {
    mode: "interactive",
    terminal: "session_ended",
    ratingState: "rated",
    expected: chip("Ended", "success"),
  },
  stalled: {
    mode: "automated",
    terminal: "stalled",
    ratingState: "rated",
    expected: chip("Stopped — stalled", "warning"),
  },
  wait_expired: {
    mode: "interactive",
    terminal: "wait_expired",
    ratingState: "rated",
    expected: chip("Expired", "neutral"),
  },
  max_duration: {
    mode: "automated",
    terminal: "max_duration",
    ratingState: "rated",
    expected: chip("Stopped — time limit", "warning"),
  },
  context_overflow: {
    mode: "automated",
    terminal: "context_overflow",
    ratingState: "rated",
    expected: chip("Context overflow", "warning"),
  },
  assertions_failed: {
    mode: "automated",
    liveStatus: "completed",
    livePhase: null,
    outcome: "assertions_failed",
    ratingState: "rated",
    expected: chip("Assertions failed", "warning"),
  },
  reviewing: {
    mode: "automated",
    liveStatus: "completed",
    livePhase: null,
    outcome: "completed",
    ratingState: "pending",
    expected: chip("Reviewing…", "info", { spinner: true }),
  },
  // ── Legacy terminals ────────────────────────────────────────────────────────────────────────────
  completed: {
    mode: "automated",
    liveStatus: "completed",
    livePhase: null,
    outcome: "completed",
    ratingState: "rated",
    expected: chip("Completed", "success"),
  },
  aborted: {
    mode: "interactive",
    terminal: "user_stop",
    ratingState: "rated",
    expected: chip("Stopped by you", "neutral"),
  },
  error: {
    mode: "automated",
    terminal: "provider_error",
    ratingState: "rated",
    expected: chip("Failed", "danger"),
  },
};

/** The state × kind grid, in a stable order (kinds outer, states inner) so screenshots/logs are stable. */
export const SEED_STATES = Object.keys(SEED_STATE_SPECS) as SeedState[];
export const SEED_KINDS: SeedKind[] = ["engine", "subscription"];

/** States seeded UNSEEN so the "Needs attention" feed surfaces them (`pendingInput || unseen-not-running`):
 *  the two live-attention states + two representative unseen finished runs. */
const NEEDS_ATTENTION_STATES = new Set<SeedState>([
  "waiting_input",
  "queued",
  "error",
  "stalled",
]);

/** One seeded row's identity + its expected rendering, returned to the caller for assertions/logging. */
export type SeededRun = {
  runId: string;
  kind: SeedKind;
  state: SeedState;
  mode: "automated" | "interactive";
  /** The resolved persisted lifecycle columns (what `GET /api/runs/:id` returns). */
  persisted: {
    status: RunStatus;
    outcome: string | null;
    stopReasonCode: string | null;
    phase: RunPhase | null;
    ratingState: RatingState;
  };
  /** The chip a persisted read must render. */
  expected: ExpectedChip;
  /** The chip a live stream input must render (differs from `expected` only for `queued`). */
  expectedLive: ExpectedChip;
  /** Live-only queue position (undefined unless the state carries one). */
  livePosition?: number;
};

const NOW = "2026-07-16T12:00:00.000Z";

/** Resolve a spec's persisted lifecycle columns from the SAME `terminalFor` table the executors use. */
function resolveColumns(spec: StateSpec): {
  status: RunStatus;
  outcome: string | null;
  stopReasonCode: string | null;
  phase: RunPhase | null;
} {
  if (spec.terminal) {
    const v = terminalFor(spec.terminal);
    return { status: v.status, outcome: v.outcome, stopReasonCode: v.stopReasonCode, phase: null };
  }
  return {
    status: spec.liveStatus ?? "pending",
    outcome: spec.outcome ?? null,
    stopReasonCode: null,
    phase: spec.livePhase ?? null,
  };
}

/**
 * Seed the FK parents (one provider + scenario per kind, one shared test) the runs need. Idempotent by
 * fixed ids (`INSERT OR IGNORE`) so the script can re-run against an existing app DB without duplicating.
 * Returns the shared `testId` and the per-kind `scenarioId`.
 */
export function seedSessionParents(db: AppDatabase): {
  testId: string;
  scenarioIdByKind: Record<SeedKind, string>;
} {
  const testId = "us-wp3r-test";
  db.prepare(
    `INSERT OR IGNORE INTO tests (id, name, user_prompt, added_profiles_json, created_at, updated_at)
     VALUES (@id, 'WP3.R session states', 'Exercise every session state for the WP3.R review.', '[]', @now, @now)`,
  ).run({ id: testId, now: NOW });

  const scenarioIdByKind = {} as Record<SeedKind, string>;
  for (const kind of SEED_KINDS) {
    const providerId = `us-wp3r-prov-${kind}`;
    const scenarioId = `us-wp3r-env-${kind}`;
    scenarioIdByKind[kind] = scenarioId;
    // A claude_subscription row never carries an api key (D-CS7); the others get a fake ciphertext
    // marker (never decrypted here — no run is executed).
    const providerKind = KIND_PROVIDER[kind];
    const apiKey = providerKind === "claude_subscription" ? null : "enc:v1:seed";
    db.prepare(
      `INSERT OR IGNORE INTO provider_credentials (id, kind, label, base_url, api_key_encrypted, created_at, updated_at)
       VALUES (@id, @kind, @label, NULL, @apiKey, @now, @now)`,
    ).run({
      id: providerId,
      kind: providerKind,
      label: `WP3.R ${kind}`,
      apiKey,
      now: NOW,
    });
    db.prepare(
      `INSERT OR IGNORE INTO scenarios
         (id, name, provider_id, model, params_json, system_prompt, default_profiles_json, guardrails_json, created_at, updated_at)
       VALUES (@id, @name, @providerId, @model, '{}', '', '["generic_o200k"]', '{}', @now, @now)`,
    ).run({
      id: scenarioId,
      name: `WP3.R ${kind} environment`,
      providerId,
      model: KIND_MODEL[kind],
      now: NOW,
    });
  }
  return { testId, scenarioIdByKind };
}

/**
 * Seed one `runs` row per (kind × state) directly into `db` (parents seeded first). Returns the grid of
 * {@link SeededRun}s — each with the exact locked-table chip it must render. Idempotent by fixed run id
 * (`us-<kind>-<state>`): re-running REPLACES the row so a visual pass can be re-seeded freely.
 */
export function seedSessionGrid(db: AppDatabase): SeededRun[] {
  const { testId, scenarioIdByKind } = seedSessionParents(db);
  const seeded: SeededRun[] = [];

  const upsert = db.prepare(
    `INSERT OR REPLACE INTO runs (
       id, test_id, scenario_id, mode, status, outcome, stop_reason,
       started_at, ended_at, duration_ms, active_duration_ms, total_duration_ms,
       turns, tool_calls, peak_context_tokens, tokens_in, tokens_out, cost_usd,
       rating_state, cost_basis, phase, stop_reason_code, seen, capabilities_json
     ) VALUES (
       @id, @testId, @scenarioId, @mode, @status, @outcome, @stopReason,
       @startedAt, @endedAt, @durationMs, @activeMs, @totalMs,
       @turns, @toolCalls, @peakContext, @tokensIn, @tokensOut, @costUsd,
       @ratingState, @costBasis, @phase, @stopReasonCode, @seen, @capabilities
     )`,
  );
  // The console header badge reconstructs the run's status PURELY from the SSE-replayed event log
  // (`RunConsole` reads `stream.status`, not the fetched summary), so a faithful fixture must seed the
  // `run_events` log too — the findings/08 "rows + events" pattern. Clear-then-insert by run so a
  // re-seed with a different event count never leaves a stale event (run_events has no cascade from the
  // `INSERT OR REPLACE` on `runs`).
  const clearEvents = db.prepare("DELETE FROM run_events WHERE run_id = ?");
  const insertEvent = db.prepare(
    `INSERT INTO run_events (id, run_id, idx, type, payload_json, created_at)
     VALUES (@id, @runId, @idx, @type, @payload, @createdAt)`,
  );

  for (const kind of SEED_KINDS) {
    const scenarioId = scenarioIdByKind[kind];
    const providerKind = KIND_PROVIDER[kind];
    const capabilities = JSON.stringify(capabilitiesForProviderKind(providerKind));
    const costBasis = capabilitiesForProviderKind(providerKind).costBasis;
    for (const state of SEED_STATES) {
      const spec = SEED_STATE_SPECS[state];
      const cols = resolveColumns(spec);
      const ratingState = spec.ratingState ?? "rated";
      const terminal = spec.terminal != null || spec.outcome != null;
      const runId = `us-${kind}-${state}`;
      // Choose `seen` so the needs-attention feed surfaces a small, meaningful set for the visual/e2e
      // pass (the predicate is `pendingInput || (unseen && !running)`): the live `waiting_input` (paused
      // on the operator) + `queued` (unseen pending) rows, plus two representative UNSEEN finished runs
      // (`error`, `stalled`) to show the "unseen finished run" case. Every other run is marked seen so it
      // doesn't flood the section. `seen` never affects `deriveRunStatusView` (the conformance path).
      const needsAttention = NEEDS_ATTENTION_STATES.has(state);
      const seen = needsAttention ? 0 : 1;
      upsert.run({
        id: runId,
        testId,
        scenarioId,
        mode: spec.mode,
        status: cols.status,
        outcome: cols.outcome,
        stopReason: cols.stopReasonCode ? `Seeded ${cols.stopReasonCode}` : null,
        startedAt: NOW,
        endedAt: terminal ? NOW : null,
        durationMs: terminal ? 42_000 : null,
        activeMs: terminal ? 30_000 : null,
        totalMs: terminal ? 42_000 : null,
        turns: terminal ? 2 : 0,
        toolCalls: 0,
        peakContext: 0,
        tokensIn: terminal ? 1200 : 0,
        tokensOut: terminal ? 340 : 0,
        costUsd: 0,
        ratingState,
        costBasis: costBasis === "none" ? null : costBasis,
        phase: cols.phase,
        stopReasonCode: cols.stopReasonCode,
        seen,
        capabilities,
      });

      // Seed the minimal event log the console replays to reconstruct this run's live badge:
      //  - terminal: the `status` (terminal triple) event + a `rating` event (settled → stream closes
      //    cleanly, no drop banner);
      //  - live: a `status` (running|pending) event + the `phase` overlay event (queued position /
      //    waiting_input / stopping) so the header shows the locked phase chip.
      const statusEvent: Record<string, unknown> = { type: "status", status: cols.status };
      if (terminal) {
        if (cols.outcome) statusEvent.outcome = cols.outcome;
        if (cols.stopReasonCode) {
          statusEvent.stopReason = `Seeded ${cols.stopReasonCode}`;
          statusEvent.stopReasonCode = cols.stopReasonCode;
        }
      }
      const events: RunEvent[] = terminal
        ? [statusEvent as RunEvent, { type: "rating", state: ratingState } as RunEvent]
        : [
            statusEvent as RunEvent,
            ...(cols.phase
              ? [
                  {
                    type: "phase",
                    phase: cols.phase,
                    ...(spec.livePosition != null && cols.phase === "queued"
                      ? { detail: { position: spec.livePosition } }
                      : {}),
                  } as RunEvent,
                ]
              : []),
          ];
      clearEvents.run(runId);
      events.forEach((event, idx) => {
        insertEvent.run({
          id: `${runId}-ev-${idx}`,
          runId,
          idx,
          type: event.type,
          payload: JSON.stringify(event),
          createdAt: NOW,
        });
      });

      seeded.push({
        runId,
        kind,
        state,
        mode: spec.mode,
        persisted: {
          status: cols.status,
          outcome: cols.outcome,
          stopReasonCode: cols.stopReasonCode,
          phase: cols.phase,
          ratingState,
        },
        expected: spec.expected,
        expectedLive: spec.expectedLive ?? spec.expected,
        ...(spec.livePosition != null ? { livePosition: spec.livePosition } : {}),
      });
    }
  }
  return seeded;
}
