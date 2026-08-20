// Assistant Hub (planning/Roadmap/RM-03-assistant-hub/, WP4.2, D-AH13, R-UX7) — the read-only Audit-timeline
// PROJECTION over `hub_events`: normalizes tool calls, approvals, mission-agent spawns, and model
// calls (D-AH13's four categories, verbatim: "tool calls, approvals, agent spawns, model calls") into
// one merged `HubAuditEntry` per real-world action, across EVERY session. This module never mutates
// `hub_events` and never introduces a new table — it's a projection, not a new source of truth
// (R-SES1 stays intact: a session's full state is still reconstructible from `hub_events` alone).
//
// Correlation: a `tool_call` row merges the initiating `tool_call` event with its settled
// `tool_result` (by `toolCallId`); an `approval` row merges `approval_requested` with its terminal
// `approval_responded` — the SAME correlation `apps/web/src/features/hub/use-hub-stream.ts`'s
// `buildHubTimeline` already does client-side for the transcript, done here server-side across
// sessions. `agent_spawned` and settled `assistant_message` events are each already one row.
//
// Deep-link resolution (WP text: "deep-links into session replay"; R-UX7's audit/undo pairing —
// the undo actions THEMSELVES already exist: `POST .../artifacts/:id/versions/:version/revert`
// (WP3.5), `DELETE /api/hub/memory/:id` (WP3.2), `POST .../workspace/snapshots/:id/restore` (WP3.4);
// this view's contribution is visibility + a working link back to where an action happened, plus
// labeling a destructive/open-world tool call inline via `annotations` so an irreversible EXTERNAL
// write reads as irreversible right here, not just on the approval card that already scrolled away):
// every row carries `rootSessionId`, the session id the Audit view's link actually opens. For a
// `chat`-kind session that's the row's own `sessionId`; for an `agent`-kind session (a mission member)
// it's that session's `parentSessionId` — mission-level events (`agent_spawned` etc.) are themselves
// already logged on the PARENT session (`hub/missions/orchestrator.ts` appends them to
// `mission.sessionId` directly, never to the child), so only `tool_call`/`approval`/`model_call` rows
// that happened INSIDE a mission member's own turn need this redirect. The app has no standalone
// per-agent transcript view yet, so the mission board on the parent session (where that agent's card
// renders) is the honest landing spot — not a broken link to a page that doesn't exist. `messageId`
// rides along when resolvable so a `chat`-kind target can additionally scroll+highlight the exact turn.
//
// Scale: this is a local, single-owner dev tool. `MAX_SCAN` bounds one repository call to a generous
// but FIXED window of the most recent matching raw `hub_events` rows rather than implementing true
// keyset streaming across a session JOIN; pagination (`before`/`limit`) and the `tool` substring
// filter are then applied to the correlated result IN MEMORY. Two honest consequences at extreme
// scale (never expected in normal single-owner usage): (1) a raw event whose settled counterpart fell
// just outside the scan window renders as a one-sided row (a `tool_call` still marked "pending" though
// its `tool_result` actually landed slightly earlier/later) rather than silently vanishing; (2) rows
// older than the `MAX_SCAN`-th most recent matching event are not reachable by paging `before` — both
// called out here rather than discovered later as a silent bug.
import type {
  HubAuditEntry,
  HubAuditKind,
  HubAuditPage,
  HubEvent,
  HubSession,
} from "@mcp-token-footprint/shared";
import type { HubRepository } from "./repository.js";

const MAX_SCAN = 4000;
export const HUB_AUDIT_DEFAULT_LIMIT = 50;
export const HUB_AUDIT_MAX_LIMIT = 200;

/** Which raw `hub_events` TYPES each audit kind derives from (D-AH13's four categories). */
const KIND_TO_TYPES: Record<HubAuditKind, readonly string[]> = {
  tool_call: ["tool_call", "tool_result"],
  approval: ["approval_requested", "approval_responded"],
  spawn: ["agent_spawned"],
  model_call: ["assistant_message"],
};
const ALL_AUDIT_TYPES: readonly string[] = Object.values(KIND_TO_TYPES).flat();

export type HubAuditFilter = {
  sessionId?: string;
  kind?: HubAuditKind;
  /** Case-insensitive substring match against `toolName` (tool_call/approval rows only). */
  tool?: string;
  /** ISO — inclusive lower bound on the row's `at`. */
  since?: string;
  /** ISO — inclusive upper bound on the row's `at`. */
  until?: string;
  limit?: number;
  /** Opaque pagination cursor — the previous page's last `HubAuditPage.nextBefore`. */
  before?: string;
};

function encodeCursor(at: string, id: string): string {
  return `${at}::${id}`;
}

function decodeCursor(cursor: string): { at: string; id: string } | undefined {
  const idx = cursor.lastIndexOf("::");
  if (idx < 0) return undefined;
  return { at: cursor.slice(0, idx), id: cursor.slice(idx + 2) };
}

/** Build one page of the Audit timeline (D-AH13/R-UX7) — see the module doc for the full contract. */
export function listHubAudit(repository: HubRepository, filter: HubAuditFilter): HubAuditPage {
  const limit = Math.min(Math.max(filter.limit ?? HUB_AUDIT_DEFAULT_LIMIT, 1), HUB_AUDIT_MAX_LIMIT);
  const types = filter.kind ? KIND_TO_TYPES[filter.kind] : ALL_AUDIT_TYPES;

  const raw = repository.listAuditEvents({
    types,
    ...(filter.sessionId ? { sessionId: filter.sessionId } : {}),
    ...(filter.since ? { since: filter.since } : {}),
    ...(filter.until ? { until: filter.until } : {}),
    limit: MAX_SCAN,
  });
  if (raw.length === 0) return { entries: [] };

  // Session metadata — only for the sessions actually touched by the scanned window (never the
  // whole table's worth of work when the window is small).
  const touchedSessionIds = new Set(raw.map((event) => event.sessionId));
  const sessions = new Map<string, HubSession>();
  for (const session of repository.listSessions({})) {
    if (touchedSessionIds.has(session.id)) sessions.set(session.id, session);
  }

  let entries = buildEntries(raw, sessions);
  if (filter.tool) {
    const needle = filter.tool.trim().toLowerCase();
    if (needle) {
      entries = entries.filter((entry) => entry.toolName?.toLowerCase().includes(needle));
    }
  }
  entries.sort((a, b) => {
    if (a.at !== b.at) return a.at < b.at ? 1 : -1; // newest first
    return a.id < b.id ? 1 : -1; // stable tie-break
  });

  const cursor = filter.before ? decodeCursor(filter.before) : undefined;
  const windowed = cursor
    ? entries.filter((entry) => entry.at < cursor.at || (entry.at === cursor.at && entry.id < cursor.id))
    : entries;

  const page = windowed.slice(0, limit);
  const last = page[page.length - 1];
  const hasMore = windowed.length > limit;
  return { entries: page, ...(hasMore && last ? { nextBefore: encodeCursor(last.at, last.id) } : {}) };
}

/** Correlate the raw, per-session-grouped events into one `HubAuditEntry` per real-world action. */
function buildEntries(
  raw: readonly (HubEvent & { sessionId: string })[],
  sessions: ReadonlyMap<string, HubSession>,
): HubAuditEntry[] {
  const bySession = new Map<string, (HubEvent & { sessionId: string })[]>();
  for (const event of raw) {
    const list = bySession.get(event.sessionId);
    if (list) list.push(event);
    else bySession.set(event.sessionId, [event]);
  }

  const entries: HubAuditEntry[] = [];
  for (const [sessionId, events] of bySession) {
    const session = sessions.get(sessionId);
    if (!session) continue; // orphaned (session deleted concurrently with this read) — skip, don't guess
    // Ascending `seq` (the repository returns newest-first by `created_at`, which is only
    // millisecond-precise — two events appended back-to-back can tie) so the initiating event is
    // ALWAYS visited before its settled counterpart within a session; `seq` is the per-session
    // monotonic ordinal `hub_events` itself enforces (the same field `listEvents`'s replay sorts by).
    const ordered = [...events].sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));

    const rootSessionId = session.kind === "agent" ? (session.parentSessionId ?? session.id) : session.id;
    const base = {
      sessionId,
      sessionKind: session.kind,
      sessionTitle: session.title,
      rootSessionId,
      missionId: session.missionId,
    } as const;

    const toolCalls = new Map<string, HubAuditEntry>();
    const approvals = new Map<string, HubAuditEntry>();

    for (const event of ordered) {
      if (event.type === "tool_call") {
        const part = event.part;
        const settledStates = ["output-available", "output-error", "output-denied"] as const;
        const state = (settledStates as readonly string[]).includes(part.state)
          ? (part.state as HubAuditEntry["state"])
          : "pending";
        toolCalls.set(part.toolCallId, {
          ...base,
          id: `tool_call:${part.toolCallId}`,
          kind: "tool_call",
          at: event.at ?? "",
          toolCallId: part.toolCallId,
          toolName: part.toolName,
          source: part.source,
          state,
          ...(part.serverId ? { serverId: part.serverId } : {}),
          ...(part.annotations ? { annotations: part.annotations } : {}),
          ...(event.messageId ? { messageId: event.messageId } : {}),
          ...(part.isError !== undefined ? { isError: part.isError } : {}),
        });
      } else if (event.type === "tool_result") {
        const existing = toolCalls.get(event.toolCallId);
        const patch = {
          settledAt: event.at,
          state: event.state,
          ...(event.isError !== undefined ? { isError: event.isError } : {}),
        };
        toolCalls.set(
          event.toolCallId,
          existing
            ? { ...existing, ...patch }
            : {
                // The result landed without its call in this scan window (see the module doc's scale
                // note) — still surface the outcome rather than silently dropping it.
                ...base,
                id: `tool_call:${event.toolCallId}`,
                kind: "tool_call",
                at: event.at ?? "",
                toolCallId: event.toolCallId,
                ...patch,
              },
        );
      } else if (event.type === "approval_requested") {
        approvals.set(event.toolCallId, {
          ...base,
          id: `approval:${event.toolCallId}`,
          kind: "approval",
          at: event.at ?? "",
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          source: event.source,
          resolution: "pending",
          ...(event.serverId ? { serverId: event.serverId } : {}),
          ...(event.annotations ? { annotations: event.annotations } : {}),
          ...(event.messageId ? { messageId: event.messageId } : {}),
          ...(event.isAutomatic !== undefined ? { isAutomatic: event.isAutomatic } : {}),
          ...(event.autonomy ? { autonomy: event.autonomy } : {}),
        });
      } else if (event.type === "approval_responded") {
        const existing = approvals.get(event.toolCallId);
        const patch = {
          settledAt: event.at,
          resolution: event.resolution,
          ...(event.isAutomatic !== undefined ? { isAutomatic: event.isAutomatic } : {}),
        };
        approvals.set(
          event.toolCallId,
          existing
            ? { ...existing, ...patch }
            : {
                ...base,
                id: `approval:${event.toolCallId}`,
                kind: "approval",
                at: event.at ?? "",
                toolCallId: event.toolCallId,
                ...patch,
              },
        );
      } else if (event.type === "agent_spawned") {
        entries.push({
          ...base,
          id: `spawn:${event.agentSessionId}`,
          kind: "spawn",
          at: event.at ?? "",
          missionId: event.missionId,
          agentSessionId: event.agentSessionId,
          roleName: event.roleName,
          model: event.model,
        });
      } else if (event.type === "assistant_message") {
        entries.push({
          ...base,
          id: `model_call:${event.messageId}`,
          kind: "model_call",
          at: event.at ?? "",
          messageId: event.messageId,
          model: event.model,
          ...(event.usage ? { usage: event.usage } : {}),
          ...(event.costUsd !== undefined ? { costUsd: event.costUsd } : {}),
          ...(event.costBasis ? { costBasis: event.costBasis } : {}),
          ...(event.finishReason ? { finishReason: event.finishReason } : {}),
        });
      }
    }

    for (const entry of toolCalls.values()) entries.push(entry);
    for (const entry of approvals.values()) entries.push(entry);
  }

  return entries;
}
