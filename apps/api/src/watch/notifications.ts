// Observability — the notification center (planning/Roadmap/RM-17-observability/, WP4.3, D-OB19).
//
// This module is the whole reason the WP4.1 `notify` seam existed: `WatchActionServices.notify` was
// left `undefined` in `index.ts` ("inert until WP4.3", `watch/actions.ts`) — the `notify` action
// already calls it when present, so `createNotifySink` below is wired into `index.ts` and the action
// goes live with ZERO change to `watch/engine.ts` / `watch/actions.ts`.
//
// Three pieces:
//   - {@link NotificationRepository} — plain CRUD over the `notifications` table (v40).
//   - {@link NotificationHub} — an in-process pub/sub so `GET /api/notifications/stream` can push a
//     freshly-created notification to any open browser tab.
//   - {@link createNotifySink} — turns a {@link WatchNotifyRequest} (the existing WP4.1 seam type,
//     UNCHANGED) into a persisted {@link Notification} + publishes it to the hub.
//
// SSE CHOICE (documented per the WP spec): every existing SSE route in this app
// (`testing/routes.ts` run stream, `suites/routes.ts` suite-run stream, `assistant/routes.ts` thread
// stream) is scoped to ONE entity (a run/suite-run/thread) and replays that entity's persisted event
// log on connect. There is no APP-LEVEL stream to piggyback on — notifications are cross-cutting (any
// rule, any run, at any time), so `notification-routes.ts` adds a small, dedicated
// `GET /api/notifications/stream` instead. It deliberately does NOT replay history the way the run
// stream does: the bell always loads its current page via `GET /api/notifications` on mount/open, so
// the stream only needs to push notifications created AFTER the tab connected (a comment-only SSE
// heartbeat keeps the socket alive; see `notification-routes.ts`).

import { nanoid } from "nanoid";
import type { Notification, NotificationListQuery, NotificationListResult, NotificationPruneResult, RunSummary, WatchNotifySeverity } from "@mcp-token-footprint/shared";
import { NOTIFICATION_LIST_DEFAULT_LIMIT, NOTIFICATION_LIST_MAX_LIMIT } from "@mcp-token-footprint/shared";
import type { AppDatabase } from "../db/database.js";
import type { NotificationRow } from "../db/rows.js";
import { httpError } from "../utils/errors.js";
import type { WatchNotifyRequest } from "./actions.js";
import { appPath } from "./outbound-link.js";

/** Fields {@link NotificationRepository.create} accepts — the already-decided content of one
 *  notification (severity/title/body/link + optional rule/run identity + the late flag). */
export interface NotificationCreateInput {
  severity: WatchNotifySeverity;
  title: string;
  body: string;
  linkPath?: string;
  ruleId?: string;
  runId?: string;
  late?: boolean;
}

export class NotificationRepository {
  constructor(private readonly db: AppDatabase) {}

  create(input: NotificationCreateInput): Notification {
    const id = nanoid();
    const at = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO notifications (id, at, severity, title, body, link_path, rule_id, run_id, read, late)
         VALUES (@id, @at, @severity, @title, @body, @linkPath, @ruleId, @runId, 0, @late)`,
      )
      .run({
        id,
        at,
        severity: input.severity,
        title: input.title,
        body: input.body,
        linkPath: input.linkPath ?? null,
        ruleId: input.ruleId ?? null,
        runId: input.runId ?? null,
        late: input.late ? 1 : 0,
      });
    return this.get(id);
  }

  get(id: string): Notification {
    const row = this.db.prepare("SELECT * FROM notifications WHERE id = ?").get(id) as
      | NotificationRow
      | undefined;
    if (!row) throw httpError(404, "Notification not found");
    return toPublic(row);
  }

  /** Filtered, paged list (`GET /api/notifications`), newest first. `unreadCount` in the result is
   *  ALWAYS the global unread total — independent of the filter/page — so the bell's badge stays
   *  correct even while a filtered page is showing. */
  list(query: NotificationListQuery): NotificationListResult {
    const clauses: string[] = [];
    const params: Record<string, unknown> = {};
    if (query.unread !== undefined) {
      clauses.push("read = @read");
      params.read = query.unread ? 0 : 1;
    }
    if (query.severity !== undefined) {
      clauses.push("severity = @severity");
      params.severity = query.severity;
    }
    if (query.since !== undefined) {
      clauses.push("at >= @since");
      params.since = query.since;
    }
    if (query.until !== undefined) {
      clauses.push("at <= @until");
      params.until = query.until;
    }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";

    const limit =
      query.limit !== undefined
        ? Math.min(query.limit, NOTIFICATION_LIST_MAX_LIMIT)
        : NOTIFICATION_LIST_DEFAULT_LIMIT;
    const offset = query.offset ?? 0;

    const rows = this.db
      .prepare(
        `SELECT * FROM notifications ${where} ORDER BY at DESC, id DESC LIMIT @limit OFFSET @offset`,
      )
      .all({ ...params, limit, offset }) as NotificationRow[];
    const totalRow = this.db
      .prepare(`SELECT COUNT(*) as n FROM notifications ${where}`)
      .get(params) as { n: number };
    const unreadRow = this.db
      .prepare("SELECT COUNT(*) as n FROM notifications WHERE read = 0")
      .get() as { n: number };

    return { items: rows.map(toPublic), total: totalRow.n, unreadCount: unreadRow.n };
  }

  /** Flip one notification to read (idempotent — reading an already-read row is a no-op). 404 if
   *  unknown, mirroring every other single-resource route in this app. */
  markRead(id: string): Notification {
    const result = this.db.prepare("UPDATE notifications SET read = 1 WHERE id = ?").run(id);
    if (result.changes === 0) throw httpError(404, "Notification not found");
    return this.get(id);
  }

  /** Flip every unread notification to read; returns how many changed. */
  markAllRead(): number {
    const result = this.db.prepare("UPDATE notifications SET read = 1 WHERE read = 0").run();
    return result.changes;
  }

  /** Prune READ notifications with `at` older than `days`. An UNREAD notification is NEVER a prune
   *  victim regardless of age — an operator must see an alert at least once. `days <= 0` (or
   *  non-finite) is a no-op, matching the `prune-scans`/`prune-assistant` "0 = disabled" convention. */
  pruneRead(days: number): NotificationPruneResult {
    if (!Number.isFinite(days) || days <= 0) {
      return { retentionDays: days, prunedNotificationIds: [] };
    }
    const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();
    const victims = this.db
      .prepare("SELECT id FROM notifications WHERE read = 1 AND at < ?")
      .all(cutoff) as Array<{ id: string }>;
    if (victims.length === 0) return { retentionDays: days, prunedNotificationIds: [] };
    const ids = victims.map((v) => v.id);
    const placeholders = ids.map(() => "?").join(",");
    this.db.prepare(`DELETE FROM notifications WHERE id IN (${placeholders})`).run(...ids);
    return { retentionDays: days, prunedNotificationIds: ids };
  }
}

function toPublic(row: NotificationRow): Notification {
  return {
    id: row.id,
    at: row.at,
    severity: row.severity,
    title: row.title,
    body: row.body,
    ...(row.link_path !== null ? { linkPath: row.link_path } : {}),
    ...(row.rule_id !== null ? { ruleId: row.rule_id } : {}),
    ...(row.run_id !== null ? { runId: row.run_id } : {}),
    read: row.read === 1,
    late: row.late === 1,
  };
}

/**
 * A tiny in-process pub/sub so `GET /api/notifications/stream` connections can be pushed a freshly
 * created {@link Notification} without polling. One process-wide instance, constructed in `index.ts`
 * alongside {@link NotificationRepository} and handed to both {@link createNotifySink} (publisher) and
 * `registerNotificationRoutes` (subscriber). A throwing subscriber is isolated — never affects another
 * open tab, never affects the publisher (mirrors `WatchRuleRepository.recordEvent`'s best-effort audit
 * discipline).
 */
export class NotificationHub {
  private readonly listeners = new Set<(notification: Notification) => void>();

  /** Attach a listener; call the returned function to detach (an SSE connection's `close` handler). */
  subscribe(listener: (notification: Notification) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  publish(notification: Notification): void {
    for (const listener of this.listeners) {
      try {
        listener(notification);
      } catch {
        // Isolate a bad subscriber (e.g. a half-closed socket) — must never affect another tab or the
        // publisher (the watch engine calling `notify`).
      }
    }
  }
}

/** What {@link createNotifySink} needs to turn a {@link WatchNotifyRequest} into a real notification. */
export interface NotifySinkDeps {
  repository: NotificationRepository;
  hub: NotificationHub;
  /** Enrich an on-terminal fire with the run's status/outcome/test — best-effort (the sink degrades
   *  honestly to a generic title/body if this throws or the run has vanished; it never propagates). */
  getRunSummary: (runId: string) => RunSummary;
}

/**
 * Build the real `notify` sink the WP4.1 `WatchActionServices.notify` seam expects
 * (`(request: WatchNotifyRequest) => void`, SYNCHRONOUS + never throwing — better-sqlite3 is
 * synchronous, so no async plumbing is needed here). Wired into `watchActionServices.notify` in
 * `index.ts`; both the on-terminal engine AND the WP4.2 windowed evaluator call it through the SAME
 * seam, so a windowed rule's fire lands a notification for free with no extra wiring.
 */
export function createNotifySink(deps: NotifySinkDeps): (request: WatchNotifyRequest) => void {
  return (request) => {
    try {
      const built = buildNotification(request, deps.getRunSummary);
      const notification = deps.repository.create(built);
      deps.hub.publish(notification);
    } catch {
      // Best-effort observer (mirrors `WatchRuleRepository.recordEvent`) — a persistence hiccup here
      // must never propagate into the watch engine or the windowed scheduler.
    }
  };
}

/**
 * Turn one {@link WatchNotifyRequest} into notification content. EXACTLY one of `window`/`runId` is
 * ever set by the existing seam (see `actions.ts`'s `WatchNotifyRequest` doc): a windowed fire carries
 * rule identity (`ruleId`/`ruleName`) but no run; an on-terminal fire carries a `runId` but no rule
 * identity (the seam's `ctx` never threaded rule id/name through to the action — see `engine.ts`
 * `onRunSettled`), so the title there is enriched from the run's own summary instead. `template`, when
 * given, is used as the body verbatim (the operator's own wording); otherwise a readable default is
 * derived from whichever context is present.
 *
 * AM-OB13 — `linkPath` now comes from the SHARED path vocabulary (`outbound-link.ts`'s {@link appPath}),
 * the same one the webhook bodies build from, so there is ONE definition of "where a run lives" rather
 * than two that can drift. It is deliberately NOT run through `outboundUrl`: this field is consumed by
 * `apps/web/src/features/notifications/NotificationBell.tsx` as `navigate(notification.linkPath)` — a
 * react-router IN-APP navigation, which treats an absolute URL as a path and lands nowhere useful. A
 * notification stays inside the app; only a webhook body leaves it.
 */
function buildNotification(
  request: WatchNotifyRequest,
  getRunSummary: (runId: string) => RunSummary,
): NotificationCreateInput {
  if (request.window) {
    const w = request.window;
    const valueText = w.value !== null ? ` — measured ${w.value}` : "";
    // AM-OB10 — say WHICH thing happened. A no-data alert must not read like a threshold crossing
    // (there is no measurement to report), and a warning must not read like the alert.
    const crossed = w.level === "warn" && w.warnThreshold !== undefined ? w.warnThreshold : w.threshold;
    const defaultBody = w.noData
      ? `No runs at all in the last ${w.window} — nothing was measured.`
      : `${w.measure} ${w.op} ${crossed} over ${w.window}${valueText}` +
        (w.level === "warn" ? " (warning level)" : "");
    return {
      severity: request.severity,
      title: w.ruleName,
      body: request.template ?? defaultBody,
      linkPath: appPath.watchRules(),
      ruleId: w.ruleId,
      late: w.late,
    };
  }
  if (request.runId) {
    const summary = tryGetRunSummary(request.runId, getRunSummary);
    const title = summary ? `Run ${humanize(summary.status)}` : "Run alert";
    const defaultBody = summary
      ? `Test ${summary.testId} · scenario ${summary.scenarioId}${summary.outcome ? ` — ${summary.outcome}` : ""}`
      : `Run ${request.runId}`;
    return {
      severity: request.severity,
      title,
      body: request.template ?? defaultBody,
      linkPath: appPath.run(request.runId),
      runId: request.runId,
      late: false,
    };
  }
  // Neither `window` nor `runId` — not reachable via the current seam, but the sink degrades honestly
  // rather than throwing/crashing the engine if it ever is.
  return {
    severity: request.severity,
    title: "Watch alert",
    body: request.template ?? "A watch rule fired.",
    late: false,
  };
}

function tryGetRunSummary(
  runId: string,
  getRunSummary: (runId: string) => RunSummary,
): RunSummary | undefined {
  try {
    return getRunSummary(runId);
  } catch {
    return undefined; // the run vanished / lookup failed — degrade to the generic title, never throw
  }
}

/** Turn a raw snake_case status into a sentence-case label (e.g. `"stopped_guardrail"` -> "Stopped guardrail"). */
function humanize(raw: string): string {
  const words = raw.replace(/[_-]+/g, " ").trim();
  if (words.length === 0) return "Unknown";
  return words.charAt(0).toUpperCase() + words.slice(1);
}
