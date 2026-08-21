// Observability — watch-rule persistence (planning/Roadmap/RM-17-observability/, WP4.1, D-OB19/D-OB21).
//
// CRUD over `watch_rules` + the append-only `watch_rule_events` audit log, plus the ENCRYPTED
// webhook-URL store (`watch_secrets`). The runtime/secret boundary is enforced HERE: a `webhook`
// action arrives with a plaintext `url`; the repository mints an opaque `secretRef`, encrypts the URL
// via {@link SecretStore}, and persists/returns ONLY the ref — the URL never lands in `watch_rules`, a
// response, or a log. On read every stored blob is re-validated through the shared zod (`filter_json`
// -> `runFilterSchema`, `actions_json` -> the stored action union) so a hand-edited/legacy row can
// never hand the engine an unchecked object.

import { nanoid } from "nanoid";
import {
  runFilterSchema,
  WATCH_ACTION_TYPES,
  watchActionSchema,
  watchRuleInputSchema,
  watchRulePatchSchema,
  watchWindowConfigSchema,
  type WatchAction,
  type WatchActionInput,
  type WatchRule,
  type WatchRuleEvent,
  type WatchRuleEventResult,
  type WatchRuleInput,
  type WatchRulePatch,
  type WatchRuleTrigger,
  type WatchWindowLevel,
} from "@mcp-token-footprint/shared";
import { z } from "zod";
import type { AppDatabase } from "../db/database.js";
import type { WatchRuleEventRow, WatchRuleRow, WatchSecretRow } from "../db/rows.js";
import type { SecretStore } from "../secrets/secret-store.js";
import { httpError } from "../utils/errors.js";

const storedActionsSchema = z.array(watchActionSchema);

export class WatchRuleRepository {
  constructor(
    private readonly db: AppDatabase,
    private readonly secrets: SecretStore,
  ) {}

  list(): WatchRule[] {
    const rows = this.db
      .prepare("SELECT * FROM watch_rules ORDER BY created_at ASC, id ASC")
      .all() as WatchRuleRow[];
    return rows.map((row) => toPublic(row));
  }

  get(id: string): WatchRule {
    return toPublic(this.getRow(id));
  }

  /** Every enabled rule for a trigger (the engine reads `on_terminal`). Ordered so audit rows land in
   *  a stable, reproducible sequence. */
  listEnabledByTrigger(trigger: WatchRuleTrigger): WatchRule[] {
    const rows = this.db
      .prepare(
        "SELECT * FROM watch_rules WHERE enabled = 1 AND trigger = ? ORDER BY created_at ASC, id ASC",
      )
      .all(trigger) as WatchRuleRow[];
    return rows.map((row) => toPublic(row));
  }

  create(input: WatchRuleInput): WatchRule {
    const parsed = watchRuleInputSchema.parse(input);
    const id = nanoid();
    const now = new Date().toISOString();

    this.db.transaction(() => {
      // Mint the stored actions (webhook `url` -> encrypted secret + `secretRef`) BEFORE the insert so
      // the persisted `actions_json` never carries a URL. The secret ROWS are inserted after the rule
      // row exists (the FK) — but the `secretRef` is a self-minted nanoid, so it's known up front.
      const { actions, secrets } = this.prepareActions(id, parsed.actions);
      this.db
        .prepare(
          `INSERT INTO watch_rules
             (id, name, enabled, trigger, filter_json, sample, window_json, min_interval_minutes,
              actions_json, created_at, updated_at)
           VALUES (@id, @name, @enabled, @trigger, @filterJson, @sample, @windowJson, @minInterval,
                   @actionsJson, @now, @now)`,
        )
        .run({
          id,
          name: parsed.name,
          enabled: parsed.enabled ? 1 : 0,
          trigger: parsed.trigger,
          filterJson: JSON.stringify(parsed.filter),
          sample: parsed.sample ?? null,
          windowJson: parsed.window === undefined ? null : JSON.stringify(parsed.window),
          // AM-OB10 — 0 and "absent" mean the same thing (no limit), so they get ONE stored
          // representation. A new rule is never created paused; `paused_until` starts NULL.
          minInterval: normalizeMinInterval(parsed.minIntervalMinutes),
          actionsJson: JSON.stringify(actions),
          now,
        });
      this.insertSecrets(secrets, now);
    })();

    return this.get(id);
  }

  /** A REAL partial update — an omitted field keeps its stored value. Supplying `actions` REPLACES the
   *  whole set AND rotates the rule's webhook secrets (old rows dropped, new ones minted). */
  update(id: string, patch: WatchRulePatch): WatchRule {
    const parsed = watchRulePatchSchema.parse(patch);
    const current = this.getRow(id);
    const now = new Date().toISOString();

    this.db.transaction(() => {
      let actionsJson = current.actions_json;
      if (parsed.actions !== undefined) {
        // Rotate: drop the rule's existing secrets, then re-mint for the new action set.
        this.db.prepare("DELETE FROM watch_secrets WHERE rule_id = ?").run(id);
        const { actions, secrets } = this.prepareActions(id, parsed.actions);
        actionsJson = JSON.stringify(actions);
        this.insertSecrets(secrets, now);
      }
      this.db
        .prepare(
          `UPDATE watch_rules SET
             name = @name, enabled = @enabled, trigger = @trigger, filter_json = @filterJson,
             sample = @sample, window_json = @windowJson, min_interval_minutes = @minInterval,
             paused_until = @pausedUntil, actions_json = @actionsJson, updated_at = @now
           WHERE id = @id`,
        )
        .run({
          id,
          name: parsed.name ?? current.name,
          enabled: parsed.enabled !== undefined ? (parsed.enabled ? 1 : 0) : current.enabled,
          trigger: parsed.trigger ?? current.trigger,
          filterJson:
            parsed.filter !== undefined ? JSON.stringify(parsed.filter) : current.filter_json,
          sample: parsed.sample !== undefined ? parsed.sample : current.sample,
          windowJson:
            parsed.window !== undefined ? JSON.stringify(parsed.window) : current.window_json,
          minInterval:
            parsed.minIntervalMinutes !== undefined
              ? normalizeMinInterval(parsed.minIntervalMinutes)
              : current.min_interval_minutes,
          // AM-OB10 — pause/resume rides the SAME "omitted keeps the stored value" patch rule as
          // every other field; an EXPLICIT `null` is what clears it (resume).
          pausedUntil:
            parsed.pausedUntil !== undefined ? parsed.pausedUntil : current.paused_until,
          actionsJson,
          now,
        });
    })();

    return this.get(id);
  }

  /** Hard delete — cascades to the rule's audit events + webhook secrets (FK ON DELETE CASCADE). */
  delete(id: string): void {
    const result = this.db.prepare("DELETE FROM watch_rules WHERE id = ?").run(id);
    if (result.changes === 0) throw httpError(404, "Watch rule not found");
  }

  // ── Audit log ───────────────────────────────────────────────────────────────────────────────────

  /** The rule's audit history, newest first. 404 if the rule is gone. */
  listEvents(ruleId: string): WatchRuleEvent[] {
    this.getRow(ruleId); // 404 if the rule doesn't exist
    const rows = this.db
      .prepare("SELECT * FROM watch_rule_events WHERE rule_id = ? ORDER BY at DESC, id DESC")
      .all(ruleId) as WatchRuleEventRow[];
    return rows.map(toEventPublic);
  }

  /** Append one audit row. NEVER throws into the engine — a persistence hiccup is swallowed (an
   *  observer's audit write can't be allowed to affect the run pipeline). `at` defaults to now; the
   *  WP4.2 windowed markers pass the WINDOW END so the audit sorts chronologically by the window it
   *  describes AND {@link getWindowState} can re-seed the scheduler's fire/recover state by reading the
   *  latest marker's `at` (no extra persisted state). */
  recordEvent(
    ruleId: string,
    runId: string | undefined,
    action: string,
    result: WatchRuleEventResult,
    at?: string,
  ): void {
    try {
      this.db
        .prepare(
          `INSERT INTO watch_rule_events (id, rule_id, run_id, at, action, result_json)
           VALUES (@id, @ruleId, @runId, @at, @action, @resultJson)`,
        )
        .run({
          id: nanoid(),
          ruleId,
          runId: runId ?? null,
          at: at ?? new Date().toISOString(),
          action,
          resultJson: JSON.stringify(result),
        });
    } catch {
      // Best-effort audit — never propagate (rules are observers).
    }
  }

  // ── Windowed scheduler state (WP4.2) ───────────────────────────────────────────────────────────

  /** Persist the boot-catch-up baseline: the grid-boundary end (ISO-8601) of the most recent window the
   *  scheduler evaluated. Best-effort like {@link recordEvent} (an observer write must never throw). */
  setLastEvaluatedAt(ruleId: string, at: string): void {
    try {
      this.db.prepare("UPDATE watch_rules SET last_evaluated_at = ? WHERE id = ?").run(at, ruleId);
    } catch {
      // Best-effort — the next tick re-derives from the (unchanged) baseline.
    }
  }

  /**
   * Re-seed the scheduler's fire/recover state for a windowed rule from the audit log (WP4.2). The
   * `window_fire` / `window_recover` markers carry the window END as their `at`, so:
   *  - `armed` = true unless the LATEST marker is a `window_fire` (a fire disarms; a recovery re-arms);
   *  - `lastFiredAt` = the latest `window_fire`'s window end (drives cooldown re-fire while breached).
   * Stateless across process restarts — the audit IS the state (survives boot).
   */
  getWindowState(ruleId: string): {
    armed: boolean;
    lastFiredAt: string | null;
    /** AM-OB10 — the LEVEL the latest fire reached, so a `warn`→`alert` escalation survives a
     *  restart and is not swallowed by the cooldown the warning armed. */
    lastFiredLevel: WatchWindowLevel | undefined;
  } {
    // ⚠️ AM-OB10 — this query deliberately does NOT include the `window_no_data` marker. That is
    // precisely what makes the default `hold` policy hold: an empty window records a marker for the
    // operator to read, and the fire/recover state machine does not see it at all.
    const latestMarker = this.db
      .prepare(
        `SELECT action FROM watch_rule_events
          WHERE rule_id = ? AND action IN ('window_fire','window_recover')
          ORDER BY at DESC, id DESC LIMIT 1`,
      )
      .get(ruleId) as { action: string } | undefined;
    const latestFire = this.db
      .prepare(
        `SELECT at, result_json FROM watch_rule_events
          WHERE rule_id = ? AND action = 'window_fire'
          ORDER BY at DESC, id DESC LIMIT 1`,
      )
      .get(ruleId) as { at: string; result_json: string } | undefined;
    return {
      armed: latestMarker === undefined || latestMarker.action === "window_recover",
      lastFiredAt: latestFire?.at ?? null,
      lastFiredLevel: parseFiredLevel(latestFire?.result_json),
    };
  }

  /**
   * AM-OB10 — when this rule last actually DISPATCHED an action (any of the closed action types),
   * or `null` if it never has. Drives the `on_terminal` minimum-interval gate. `MAX(at)` rather than
   * an ordered LIMIT 1 because several action rows written in the same millisecond share an `at`
   * and nanoid ids are not chronological — "was anything dispatched inside the interval" is a
   * max-timestamp question, not a row-order one.
   */
  getLastActionAt(ruleId: string): string | null {
    const placeholders = WATCH_ACTION_TYPES.map(() => "?").join(",");
    const row = this.db
      .prepare(
        `SELECT MAX(at) AS at FROM watch_rule_events
          WHERE rule_id = ? AND action IN (${placeholders})`,
      )
      .get(ruleId, ...WATCH_ACTION_TYPES) as { at: string | null } | undefined;
    return row?.at ?? null;
  }

  // ── Webhook secret resolution (engine only) ──────────────────────────────────────────────────────

  /** Decrypt a webhook action's URL by its `secretRef`, or `undefined` if the ref is unknown. The
   *  plaintext URL exists ONLY transiently in memory here — never persisted, returned, or logged. */
  resolveWebhookUrl(secretRef: string): string | undefined {
    const row = this.db
      .prepare("SELECT encrypted_value FROM watch_secrets WHERE ref = ?")
      .get(secretRef) as Pick<WatchSecretRow, "encrypted_value"> | undefined;
    if (!row) return undefined;
    return this.secrets.decryptText(row.encrypted_value);
  }

  // ── Internals ────────────────────────────────────────────────────────────────────────────────────

  private prepareActions(
    ruleId: string,
    inputs: WatchActionInput[],
  ): {
    actions: WatchAction[];
    secrets: Array<{ ref: string; ruleId: string; encrypted: string }>;
  } {
    const actions: WatchAction[] = [];
    const secrets: Array<{ ref: string; ruleId: string; encrypted: string }> = [];
    for (const action of inputs) {
      if (action.type === "webhook") {
        const ref = nanoid();
        secrets.push({ ref, ruleId, encrypted: this.secrets.encryptText(action.url) });
        actions.push({
          type: "webhook",
          secretRef: ref,
          ...(action.template !== undefined ? { template: action.template } : {}),
        });
      } else {
        actions.push(action);
      }
    }
    return { actions, secrets };
  }

  private insertSecrets(
    secrets: Array<{ ref: string; ruleId: string; encrypted: string }>,
    now: string,
  ): void {
    const stmt = this.db.prepare(
      "INSERT INTO watch_secrets (ref, rule_id, encrypted_value, created_at) VALUES (@ref, @ruleId, @encrypted, @now)",
    );
    for (const secret of secrets) stmt.run({ ...secret, now });
  }

  private getRow(id: string): WatchRuleRow {
    const row = this.db.prepare("SELECT * FROM watch_rules WHERE id = ?").get(id) as
      | WatchRuleRow
      | undefined;
    if (!row) throw httpError(404, "Watch rule not found");
    return row;
  }
}

/** Row -> public rule. Re-validates the persisted JSON through the shared zod (cheap insurance against
 *  a hand-edited/legacy row) — including the WP4.2 `window_json` threshold config. `last_evaluated_at`
 *  (v39) surfaces only when the rule has been evaluated at least once. */
export function toPublic(row: WatchRuleRow): WatchRule {
  return {
    id: row.id,
    name: row.name,
    enabled: row.enabled === 1,
    trigger: row.trigger,
    filter: runFilterSchema.parse(JSON.parse(row.filter_json)),
    ...(row.sample !== null ? { sample: row.sample } : {}),
    ...(row.window_json !== null
      ? { window: watchWindowConfigSchema.parse(JSON.parse(row.window_json)) }
      : {}),
    ...(row.last_evaluated_at !== null ? { lastEvaluatedAt: row.last_evaluated_at } : {}),
    // AM-OB10 (v61) — both nullable; absent on the wire means "not set", so an existing rule is
    // byte-identical to what it was before the migration.
    ...(row.paused_until !== null ? { pausedUntil: row.paused_until } : {}),
    ...(row.min_interval_minutes !== null
      ? { minIntervalMinutes: row.min_interval_minutes }
      : {}),
    actions: storedActionsSchema.parse(JSON.parse(row.actions_json)),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** 0 and "absent" both mean NO limit, so they get ONE stored representation (NULL). */
function normalizeMinInterval(minutes: number | undefined): number | null {
  return minutes !== undefined && minutes > 0 ? minutes : null;
}

/** Read the `level` back off a persisted `window_fire` result. A legacy row (written before
 *  AM-OB10) simply has no `level`, which correctly reads as "the fire was an alert". */
function parseFiredLevel(resultJson: string | undefined): WatchWindowLevel | undefined {
  if (resultJson === undefined) return undefined;
  try {
    const parsed = JSON.parse(resultJson) as WatchRuleEventResult;
    return parsed.level;
  } catch {
    return undefined;
  }
}

function toEventPublic(row: WatchRuleEventRow): WatchRuleEvent {
  return {
    id: row.id,
    ruleId: row.rule_id,
    ...(row.run_id !== null ? { runId: row.run_id } : {}),
    at: row.at,
    action: row.action,
    result: JSON.parse(row.result_json) as WatchRuleEventResult,
  };
}
