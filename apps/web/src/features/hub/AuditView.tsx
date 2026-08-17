import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { DataTable, FacetFilter, SearchInput, type ColumnDef, type FacetOption } from "@elabs-ai/components-data";
import {
  Badge,
  Button,
  DateRangePicker,
  EmptyState,
  Heading,
  SectionHeader,
  StatePanel,
  Text,
  cn,
  type DateRange,
  type DateRangePreset,
} from "@elabs-ai/components-ui";
import type {
  HubAgentRole,
  HubAuditEntry,
  HubAuditKind,
  HubCrew,
  SessionCostBasis,
} from "@mcp-token-footprint/shared";
import { HUB_AUDIT_KINDS } from "@mcp-token-footprint/shared";
import {
  Bot,
  Download,
  Globe,
  History,
  ShieldCheck,
  Sparkles,
  SquareArrowOutUpRight,
  TriangleAlert,
  Wrench,
} from "lucide-react";
import { PageShell } from "../../components/PageShell";
import { StatusBadge } from "../../components/StatusBadge";
import { ViewToolbar } from "../../components/ViewToolbar";
import { downloadCsv, toCsv } from "../../lib/csv";
import { getErrorMessage } from "../../lib/errors";
import { formatCostUsd, formatDateTime, formatNumber, formatRelativeTime } from "../../lib/format";
import { listHubAgentRoles, listHubAudit, listHubCrews } from "../../lib/api";
import { loadableData, useLoadable } from "../../lib/loadable";
import { clickableRowTableProps, navCol } from "../../lib/table";
import { accentFor } from "./workforce/AgentCard";
import { notifyError } from "../../lib/notify";

/**
 * Assistant Hub UX WP3.2 (D-HUX2, D-HUX8, D-HUX14, §7.6) — the global, filterable Audit timeline at
 * `/assistant/audit`: every tool call, approval decision, mission-agent spawn, and model call across
 * EVERY session, normalized from `hub_events` by `GET /api/hub/audit` (`apps/api/src/hub/audit.ts`'s
 * read-only projection — see its module doc for the merge/deep-link/scale contract this view renders).
 * Rebuilt onto the shared shell grammar (this WP owns ONLY this file — the API/wire is untouched):
 *
 *  - `PageShell headerVariant="toolbar"` + `ViewToolbar` (D-HUX2) replaces the old hand-rolled
 *    icon+Heading block; the kept description moves into the toolbar's `info` tooltip.
 *  - Rows group under STICKY day-group `SectionHeader`s ("Today", "Yesterday", …) — one `DataTable`
 *    per day so each group's header can stick independently while that day's rows scroll under it.
 *  - Mission-agent rows (`sessionKind: "agent"`) get a best-effort identity enrichment: the row's
 *    `sessionTitle` is matched by NAME against the agent-role library (`listHubAgentRoles`) to find
 *    its crew(s) (`listHubCrews`) and real profile — see `resolveAgentIdentity` below for exactly why
 *    this is a name match rather than an id lookup (the audit projection carries no `roleId`/`crewId`,
 *    and this WP does not touch the API to add one) and its one honest failure mode (two roles sharing
 *    a name). A resolved row renders the crew's D-HUX8 accent dot (always paired with the crew's own
 *    name — never a bare color) plus a link into that agent's profile **Usage** sub-page
 *    (`/assistant/agents/agent/:id?settings=usage`, the D-HUX6 settings-tab scheme `WorkforceView.tsx`
 *    documents). An unresolved agent row (ad-hoc mission member, or a renamed/deleted role) still shows
 *    exactly what it always did — the plain session title + an "agent" badge — so a failed match never
 *    reads as a REGRESSION, only as "no extra enrichment available".
 *  - Outcome chips go through the app's ONE status vocabulary (`StatusBadge`/`lib/status`, D-HUX14)
 *    instead of a bespoke variant/icon table; the destructive/open-world annotation chips (a separate,
 *    categorical concept — R-UX7) are unchanged.
 *  - One `EmptyState` (§8.5) covers both "nothing has ever happened" and "filters matched nothing",
 *    with a reset action when filters are the reason the list is empty.
 *  - A client-side CSV export (`lib/csv.ts`, no new API call) covers the wireframe's `[Export]`
 *    toolbar action over the currently-loaded + filtered rows — the repo's established "export what's
 *    on screen" pattern for data the browser already holds.
 *
 * Each row still deep-links into session replay: clicking it navigates to `/assistant?session=
 * <rootSessionId>&message=<messageId>` — `AssistantView` opens that session and (when a `messageId`
 * resolved) `ConversationPane` scrolls the transcript to the exact turn. A mission-agent row's
 * `rootSessionId` is the PARENT chat session (the app has no standalone per-agent transcript view yet
 * — the mission board on the parent, where that agent's card renders, is the honest landing spot), so
 * its link still opens cleanly even without a `messageId`. This deep link is UNCHANGED by this WP.
 *
 * `annotations` (destructive/open-world hints) render inline on tool_call/approval rows — R-UX7's
 * "irreversible external writes labeled". The undo actions R-UX7 also asks for (artifact-version
 * revert, memory delete) already live where those actions happen (`ArtifactCanvas`, scoped-memory
 * surfaces in the meta rail and workspace modals); this view's own job is visibility + the link
 * back to where that undo lives, not a duplicate action surface.
 *
 * KIND and SESSION are hybrid client/server filters: with exactly ONE value selected they go to the
 * SERVER (`HubAuditFilter.kind`/`sessionId`, each single-valued) so the API's `MAX_SCAN` window scans
 * only matching raw events — the deep-pagination guarantee the audit backend's own module doc
 * describes. With ZERO or TWO+ values selected (a `FacetFilter` lets a user pick either), the request
 * goes unfiltered on that axis and the extra narrowing happens client-side over whatever page already
 * loaded — never worse than today's "all kinds"/"all sessions" default, just not as deeply paginated
 * as the single-value case. TOOL and the date range stay server-side filters, unchanged.
 */

const KIND_LABELS: Record<HubAuditKind, string> = {
  tool_call: "Tool call",
  approval: "Approval",
  spawn: "Agent spawn",
  model_call: "Model call",
};

const KIND_ICONS: Record<HubAuditKind, typeof Wrench> = {
  tool_call: Wrench,
  approval: ShieldCheck,
  spawn: Bot,
  model_call: Sparkles,
};

const KIND_FACET_OPTIONS: FacetOption[] = HUB_AUDIT_KINDS.map((kind) => ({
  value: kind,
  label: KIND_LABELS[kind],
}));

const DATE_PRESETS: DateRangePreset[] = [
  {
    label: "Last 24 hours",
    getRange: () => ({ from: new Date(Date.now() - 24 * 60 * 60 * 1000), to: new Date() }),
  },
  { label: "Last 7 days", getRange: () => ({ from: daysAgo(6), to: new Date() }) },
  { label: "Last 30 days", getRange: () => ({ from: daysAgo(29), to: new Date() }) },
];

function daysAgo(n: number): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - n);
  return d;
}

/** An inclusive end-of-day bound for a DateRangePicker `to` value — a plain calendar click returns
 *  midnight (00:00:00.000), which would otherwise EXCLUDE that whole day's rows from `until`; a
 *  preset that already supplies a precise time (e.g. "now") passes through unchanged. */
function untilIso(to: Date): string {
  const d = new Date(to);
  if (d.getHours() === 0 && d.getMinutes() === 0 && d.getSeconds() === 0 && d.getMilliseconds() === 0) {
    d.setHours(23, 59, 59, 999);
  }
  return d.toISOString();
}

/** Tool-call outcome → the app's ONE status vocabulary (D-HUX14: "Audit outcome: ok → complete · error
 *  → failed"; a denied call is `denied`, which `lib/status.ts` renders as a calm neutral "Denied" chip
 *  via its documented safe default — falling out of the locked label table on purpose, since inventing
 *  a bespoke tone here would be exactly the per-view chip proliferation D-HUX14 retires). */
function toolCallOutcomeBadge(entry: HubAuditEntry) {
  if (entry.state === "output-error" || entry.isError) return <StatusBadge status="failed" />;
  if (entry.state === "output-denied") return <StatusBadge status="denied" />;
  if (entry.state === "output-available") return <StatusBadge status="completed" />;
  return <StatusBadge status="pending" />;
}

/** Approval outcome → the same vocabulary, with the auto-approved/always-allow/allowed nuance kept as
 *  a label override on the "completed" tone (`StatusBadge`'s `children` prop) rather than a separate
 *  tone — the distinction is WHO decided, not whether the call proceeded. */
function approvalOutcomeBadge(entry: HubAuditEntry) {
  if (entry.resolution === "deny") return <StatusBadge status="denied" />;
  if (entry.resolution === "allow-once" || entry.resolution === "always") {
    const label = entry.isAutomatic
      ? "Auto-approved"
      : entry.resolution === "always"
        ? "Always allow"
        : "Allowed";
    return <StatusBadge status="completed">{label}</StatusBadge>;
  }
  return <StatusBadge status="pending" />;
}

/** Plain-text outcome summary for CSV export (no JSX) — same branches as the two badge functions. */
function outcomeSummary(entry: HubAuditEntry): string {
  if (entry.kind === "tool_call") {
    if (entry.state === "output-error" || entry.isError) return "Failed";
    if (entry.state === "output-denied") return "Denied";
    if (entry.state === "output-available") return "Completed";
    return "Pending";
  }
  if (entry.kind === "approval") {
    if (entry.resolution === "deny") return "Denied";
    if (entry.resolution === "allow-once") return entry.isAutomatic ? "Auto-approved" : "Allowed";
    if (entry.resolution === "always") return "Always allow";
    return "Pending";
  }
  return "—";
}

/** The primary label + subtitle for a row's `navCol` action cell — what the entry actually IS. */
function actionText(entry: HubAuditEntry): { title: string; subtitle?: string } {
  switch (entry.kind) {
    case "tool_call":
      return { title: entry.toolName ?? "Unknown tool", subtitle: entry.source ? `via ${entry.source}` : undefined };
    case "approval":
      return { title: entry.toolName ?? "Unknown tool", subtitle: "approval" };
    case "spawn":
      return { title: entry.roleName ?? "Agent", subtitle: entry.model };
    case "model_call":
      return { title: entry.model ?? "Model call", subtitle: entry.finishReason };
  }
}

function auditDeepLink(entry: HubAuditEntry): string {
  const params = new URLSearchParams({ session: entry.rootSessionId });
  if (entry.messageId) params.set("message", entry.messageId);
  return `/assistant?${params.toString()}`;
}

/** Smallest cost `formatCostUsd`'s default 2dp can represent without rounding down to `$0.00`. */
const MIN_REPRESENTABLE_COST_USD = 0.01;

function formatCostUsdLabel(costUsd: number, costBasis?: SessionCostBasis): string {
  // T10: a real, non-zero per-event cost (a fraction of a cent — routine for a single tool call or
  // model turn) used to round to the exact same "$0.00 est." a genuinely free/unpriced call shows,
  // reading as "this cost nothing" when it didn't. Once it's below what 2dp can show, say so plainly
  // instead of silently rounding it away; an actual zero (no `costUsd`, or an exact 0) still reads
  // as "$0.00" — only a positive-but-sub-cent value gets the "<$0.01" treatment.
  const label =
    costUsd > 0 && costUsd < MIN_REPRESENTABLE_COST_USD ? "<$0.01" : formatCostUsd(costUsd);
  // T10: this compared against the string "subscription", which `SessionCostBasis` never contains
  // (its member is `"subscription_reference"` — see `constants.ts`'s `SESSION_COST_BASES`), so a
  // subscription-priced call always fell through to "… est." and silently mislabeled a reference
  // figure as an estimate. Compare against the real value so the two labels stay distinct.
  return costBasis === "subscription_reference" ? `${label} · subscription` : `${label} est.`;
}

// ── Day grouping (§7.6: "TODAY ── SectionHeader (sticky while its day scrolls)") ───────────────────

type DayGroup = { key: string; label: string; entries: HubAuditEntry[] };

/** "Today" / "Yesterday" / a full weekday+date (year included only when it isn't the current one). */
function dayGroupLabel(at: string, now: Date): string {
  const target = new Date(at);
  if (Number.isNaN(target.getTime())) return "Unknown date";
  const startOfDay = (d: Date) => {
    const copy = new Date(d);
    copy.setHours(0, 0, 0, 0);
    return copy.getTime();
  };
  const today = startOfDay(now);
  const yesterday = today - 24 * 60 * 60 * 1000;
  const targetDay = startOfDay(target);
  if (targetDay === today) return "Today";
  if (targetDay === yesterday) return "Yesterday";
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    ...(target.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }),
  }).format(target);
}

/** Groups already-sorted (newest-first) entries into contiguous local-calendar-day buckets, preserving
 *  the day order the entries arrived in (so the result is newest-day-first, matching the feed). */
function groupEntriesByDay(entries: readonly HubAuditEntry[], now: Date = new Date()): DayGroup[] {
  const groups = new Map<string, DayGroup>();
  for (const entry of entries) {
    const d = new Date(entry.at);
    const key = Number.isNaN(d.getTime()) ? "unknown" : d.toDateString();
    let group = groups.get(key);
    if (!group) {
      group = { key, label: dayGroupLabel(entry.at, now), entries: [] };
      groups.set(key, group);
    }
    group.entries.push(entry);
  }
  return [...groups.values()];
}

// ── Agent identity enrichment (D-HUX8) ──────────────────────────────────────────────────────────────

type AgentIdentity = { role: HubAgentRole; crews: HubCrew[] };

export function AuditView() {
  const navigate = useNavigate();

  const [kindFacet, setKindFacet] = useState<string[]>([]);
  const [sessionFacet, setSessionFacet] = useState<string[]>([]);
  const [toolInput, setToolInput] = useState("");
  const [tool, setTool] = useState("");
  const [dateRange, setDateRange] = useState<DateRange | undefined>(undefined);

  const [entries, setEntries] = useState<HubAuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [nextBefore, setNextBefore] = useState<string | undefined>(undefined);

  // Debounce the free-text tool filter (a real server round-trip per keystroke would be noisy).
  useEffect(() => {
    const timeout = setTimeout(() => setTool(toolInput.trim()), 300);
    return () => clearTimeout(timeout);
  }, [toolInput]);

  // Hybrid server filter — see the module doc: a single selection narrows the server scan window;
  // zero or multiple selections fetch unfiltered on that axis and narrow client-side below.
  const kindParam = kindFacet.length === 1 ? (kindFacet[0] as HubAuditKind) : undefined;
  const sessionParam = sessionFacet.length === 1 ? sessionFacet[0] : undefined;

  const activeFilter = useMemo(
    () => ({
      ...(kindParam ? { kind: kindParam } : {}),
      ...(sessionParam ? { sessionId: sessionParam } : {}),
      ...(tool ? { tool } : {}),
      ...(dateRange?.from ? { since: dateRange.from.toISOString() } : {}),
      ...(dateRange?.to ? { until: untilIso(dateRange.to) } : {}),
    }),
    [kindParam, sessionParam, tool, dateRange],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const page = await listHubAudit(activeFilter);
      setEntries(page.entries);
      setNextBefore(page.nextBefore);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  const loadMore = useCallback(async () => {
    if (!nextBefore) return;
    setLoadingMore(true);
    try {
      const page = await listHubAudit({ ...activeFilter, before: nextBefore });
      setEntries((current) => [...current, ...page.entries]);
      setNextBefore(page.nextBefore);
    } catch (err) {
      notifyError("Couldn’t load more", { description: getErrorMessage(err) });
    } finally {
      setLoadingMore(false);
    }
  }, [activeFilter, nextBefore]);

  // Client-side narrowing for the 2+/0-selection facet cases (see the module doc's hybrid-filter note).
  const filtered = useMemo(() => {
    if (kindFacet.length <= 1 && sessionFacet.length <= 1) return entries;
    return entries.filter((entry) => {
      if (kindFacet.length > 1 && !kindFacet.includes(entry.kind)) return false;
      if (sessionFacet.length > 1 && !sessionFacet.includes(entry.sessionId)) return false;
      return true;
    });
  }, [entries, kindFacet, sessionFacet]);

  // Session facet options, derived from what's actually loaded (no separate "list every session"
  // call) — a session that has never done anything audit-worthy has nothing to filter TO anyway.
  const sessionOptions: FacetOption[] = useMemo(() => {
    // Only a `chat`-kind row's `sessionTitle` actually describes its OWN `sessionId` (an `agent` row's
    // `sessionTitle` is the MISSION MEMBER'S own title, and the server-side `sessionId` filter matches
    // the raw event's `sessionId`, not `rootSessionId` — see the audit backend's own module doc) — skip
    // those so the facet never offers a value that then matches nothing.
    const seen = new Map<string, string>();
    for (const entry of entries) {
      if (entry.sessionKind === "chat" && !seen.has(entry.sessionId)) {
        seen.set(entry.sessionId, entry.sessionTitle);
      }
    }
    return [...seen.entries()]
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [entries]);

  // Best-effort agent/crew identity lookup for mission-agent row enrichment (D-HUX8). Ignores fetch
  // errors — mirrors `useHubModelRoster`/`AgentCard`'s "best effort" posture: a stalled/failed identity
  // lookup must never block the audit timeline itself, it just degrades rows to their pre-WP3.2 look
  // (plain session title + "agent" badge, no crew dot, no profile link).
  const { state: identityState } = useLoadable(
    () =>
      Promise.all([listHubAgentRoles({ includeArchived: true }), listHubCrews()]).then(
        ([roles, crews]) => ({ roles, crews }),
      ),
    [],
  );
  const identityData = loadableData(identityState);

  const roleByName = useMemo(
    () => new Map((identityData?.roles ?? []).map((role) => [role.name, role])),
    [identityData],
  );
  const crewsByRoleId = useMemo(() => {
    const map = new Map<string, HubCrew[]>();
    for (const crew of identityData?.crews ?? []) {
      for (const member of crew.members) {
        // Crew nesting (WP0.1 / D-CN5) — `agentId` is optional now (a member may be a nested crew);
        // only agent members index into the role→crews map here.
        const roleId = member.agentId;
        if (!roleId) continue;
        const list = map.get(roleId) ?? [];
        list.push(crew);
        map.set(roleId, list);
      }
    }
    return map;
  }, [identityData]);

  /**
   * A mission-agent row's `sessionTitle` is set by the mission orchestrator to `plannedAgentLabel()` —
   * `role.name` for a crew-instantiated agent, or a free-text ad-hoc name otherwise
   * (`apps/api/src/hub/missions/{orchestrator,topologies}.ts`). Neither the row nor the session it came
   * from carries a `roleId`/`crewId` (the audit projection is additive-only this WP; adding one would
   * touch the API, out of this WP's scope) — so this is a NAME match against the current role library,
   * not an id lookup. Honest failure modes, both non-crashing: (1) a role renamed/archived-and-renamed
   * after the mission ran no longer matches → the row quietly loses its enrichment, never a wrong one;
   * (2) two roles sharing the exact same `name` are ambiguous → the map keeps the LAST one registered,
   * so a rare same-name collision can point the Usage link at a same-named sibling rather than the
   * literal agent that ran. Acceptable for a local single-user tool; flagged here rather than silently
   * assumed correct.
   */
  const resolveAgentIdentity = useCallback(
    (sessionTitle: string): AgentIdentity | undefined => {
      const role = roleByName.get(sessionTitle);
      if (!role) return undefined;
      return { role, crews: crewsByRoleId.get(role.id) ?? [] };
    },
    [roleByName, crewsByRoleId],
  );

  const resetFilters = useCallback(() => {
    setKindFacet([]);
    setSessionFacet([]);
    setToolInput("");
    setTool("");
    setDateRange(undefined);
  }, []);

  const filtersActive =
    kindFacet.length > 0 ||
    sessionFacet.length > 0 ||
    toolInput.trim().length > 0 ||
    dateRange !== undefined;

  const handleExport = useCallback(() => {
    const headers = [
      "Time",
      "Kind",
      "Action",
      "Detail",
      "Session",
      "Session kind",
      "Outcome",
      "Tokens in",
      "Tokens out",
      "Cost USD",
    ];
    const rows = filtered.map((entry) => {
      const { title, subtitle } = actionText(entry);
      return [
        formatDateTime(entry.at),
        KIND_LABELS[entry.kind],
        title,
        subtitle ?? "",
        entry.sessionTitle,
        entry.sessionKind,
        outcomeSummary(entry),
        entry.usage?.tokensIn ?? "",
        entry.usage?.tokensOut ?? "",
        entry.costUsd ?? "",
      ];
    });
    downloadCsv(`audit-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(headers, rows));
  }, [filtered]);

  const columns: ColumnDef<HubAuditEntry>[] = useMemo(
    () => [
      navCol<HubAuditEntry>({
        id: "action",
        header: "Action",
        value: (row) => actionText(row).title,
        onSelect: (row) => navigate(auditDeepLink(row)),
        ariaLabel: (row) => `Open ${actionText(row).title} in session replay`,
        pin: "left",
        cell: (row) => {
          const { title, subtitle } = actionText(row);
          const Icon = KIND_ICONS[row.kind];
          return (
            <span className="flex min-w-0 items-center gap-2">
              <Icon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
              <span className="flex min-w-0 flex-col">
                <span className="min-w-0 max-w-[16rem] truncate font-medium" title={title}>
                  {title}
                </span>
                {subtitle ? (
                  <Text variant="caption" tone="muted" className="max-w-[16rem] truncate">
                    {subtitle}
                  </Text>
                ) : null}
              </span>
            </span>
          );
        },
      }),
      {
        id: "kind",
        accessorFn: (row) => row.kind,
        enableSorting: true,
        header: () => "Kind",
        cell: ({ row }) => <Badge variant="outline">{KIND_LABELS[row.original.kind]}</Badge>,
      },
      {
        id: "session",
        accessorFn: (row) => row.sessionTitle,
        enableSorting: true,
        header: () => "Session",
        cell: ({ row }) => {
          const entry = row.original;
          const isAgent = entry.sessionKind === "agent";
          const identity = isAgent ? resolveAgentIdentity(entry.sessionTitle) : undefined;
          const dots = identity ? accentFor(identity.crews).dots : [];
          return (
            <span className="flex min-w-0 max-w-[14rem] flex-col gap-0.5">
              <span className="flex min-w-0 items-center gap-1.5">
                <span className="min-w-0 truncate" title={entry.sessionTitle}>
                  {entry.sessionTitle}
                </span>
                {isAgent ? (
                  <Badge variant="secondary" className="shrink-0">
                    agent
                  </Badge>
                ) : null}
              </span>
              {identity ? (
                <span className="flex min-w-0 flex-wrap items-center gap-1.5">
                  {dots.map((d) => (
                    <span key={d.crewId} className="flex min-w-0 shrink-0 items-center gap-1">
                      <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", d.dot)} />
                      <Text variant="caption" tone="muted" className="min-w-0 max-w-[5rem] truncate">
                        {d.name}
                      </Text>
                    </span>
                  ))}
                  <Button
                    asChild
                    variant="link"
                    size="sm"
                    className="h-auto min-w-0 shrink-0 gap-1 p-0 text-caption"
                  >
                    <Link
                      to={`/assistant/agents/agent/${identity.role.id}?settings=usage`}
                      aria-label={`Open ${identity.role.displayName ?? identity.role.name}'s usage`}
                    >
                      <span>Usage</span>
                      <SquareArrowOutUpRight aria-hidden className="size-3" />
                    </Link>
                  </Button>
                </span>
              ) : null}
            </span>
          );
        },
      },
      {
        id: "outcome",
        enableSorting: false,
        header: () => "Outcome",
        cell: ({ row }) => {
          const entry = row.original;
          if (entry.kind === "tool_call" || entry.kind === "approval") {
            return (
              <span className="flex min-w-0 flex-wrap items-center gap-1.5">
                {entry.kind === "tool_call" ? toolCallOutcomeBadge(entry) : approvalOutcomeBadge(entry)}
                {entry.annotations?.destructiveHint ? (
                  <Badge variant="warning" className="gap-1" title="Destructive (annotation)">
                    <TriangleAlert aria-hidden className="size-3" />
                    <span>Destructive</span>
                  </Badge>
                ) : null}
                {entry.annotations?.openWorldHint ? (
                  <Badge variant="outline" className="gap-1" title="Irreversible external write (annotation)">
                    <Globe aria-hidden className="size-3" />
                    <span>External</span>
                  </Badge>
                ) : null}
              </span>
            );
          }
          if (entry.kind === "model_call") {
            const usage = entry.usage;
            return (
              <span className="flex min-w-0 flex-col text-caption tabular-nums text-muted-foreground">
                {usage ? (
                  <span>
                    {formatNumber(usage.tokensIn)} in / {formatNumber(usage.tokensOut)} out
                  </span>
                ) : null}
                {entry.costUsd !== undefined ? <span>{formatCostUsdLabel(entry.costUsd, entry.costBasis)}</span> : null}
              </span>
            );
          }
          return (
            <Text variant="caption" tone="muted">
              —
            </Text>
          );
        },
      },
      {
        id: "at",
        accessorFn: (row) => row.at,
        enableSorting: false,
        header: () => "Time",
        cell: ({ row }) => (
          <span
            className="whitespace-nowrap tabular-nums text-caption text-muted-foreground"
            title={formatDateTime(row.original.at)}
          >
            {formatRelativeTime(row.original.at)}
          </span>
        ),
      },
    ],
    [navigate, resolveAgentIdentity],
  );

  const dayGroups = useMemo(() => groupEntriesByDay(filtered), [filtered]);

  const toolbar = (
    <ViewToolbar
      info="Every tool call, approval decision, mission-agent spawn, and model call across every session — derived from the append-only event log. Click a row to open it in session replay."
      left={
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <div className="w-56 min-w-[10rem]">
            <SearchInput
              value={toolInput}
              onValueChange={setToolInput}
              label="Filter by tool name"
              placeholder="Filter by tool name…"
            />
          </div>
          <FacetFilter
            title="Kind"
            options={KIND_FACET_OPTIONS}
            selected={kindFacet}
            onSelectedChange={setKindFacet}
          />
          <FacetFilter
            title="Session"
            options={sessionOptions}
            selected={sessionFacet}
            onSelectedChange={setSessionFacet}
          />
          <DateRangePicker
            value={dateRange}
            onValueChange={setDateRange}
            presets={DATE_PRESETS}
            placeholder="All time"
          />
          <Badge variant="secondary" className="shrink-0 tabular-nums">
            {filtered.length === entries.length
              ? `${entries.length} event${entries.length === 1 ? "" : "s"}`
              : `${filtered.length} of ${entries.length} loaded`}
          </Badge>
        </div>
      }
      actions={
        <Button variant="outline" onClick={handleExport} disabled={filtered.length === 0}>
          <Download aria-hidden />
          <span>Export</span>
        </Button>
      }
    />
  );

  if (loading) {
    return (
      <PageShell headerVariant="toolbar" header={toolbar}>
        <Heading level={1} className="sr-only">
          Audit
        </Heading>
        <StatePanel kind="loading" title="Loading the audit timeline…" loadingLabel="Loading the audit timeline…" />
      </PageShell>
    );
  }

  if (error) {
    return (
      <PageShell headerVariant="toolbar" header={toolbar}>
        <Heading level={1} className="sr-only">
          Audit
        </Heading>
        <StatePanel
          kind="error"
          title="Couldn’t load the audit timeline"
          description={error}
          actions={
            <Button variant="outline" onClick={() => void load()}>
              Retry
            </Button>
          }
        />
      </PageShell>
    );
  }

  if (dayGroups.length === 0) {
    return (
      <PageShell headerVariant="toolbar" header={toolbar}>
        <Heading level={1} className="sr-only">
          Audit
        </Heading>
        <EmptyState
          icon={<History aria-hidden />}
          title={filtersActive ? "No events match" : "No audit activity yet"}
          description={
            filtersActive
              ? "Adjust the search, facets, or date range to see more of the timeline."
              : "Every tool call, approval decision, mission-agent spawn, and model call across every session will appear here."
          }
          actions={
            filtersActive ? (
              <Button variant="outline" onClick={resetFilters}>
                Reset filters
              </Button>
            ) : (
              <Button asChild variant="outline">
                <Link to="/assistant">Go to Assistant</Link>
              </Button>
            )
          }
        />
      </PageShell>
    );
  }

  return (
    <PageShell headerVariant="toolbar" header={toolbar}>
      <Heading level={1} className="sr-only">
        Audit
      </Heading>

      {dayGroups.map((group) => (
        <div key={group.key} className="flex min-w-0 flex-col gap-2">
          <SectionHeader
            title={group.label}
            description={`${group.entries.length} event${group.entries.length === 1 ? "" : "s"}`}
            className="sticky top-0 z-10 bg-background py-1.5"
          />
          <div className="min-w-0 overflow-hidden rounded-lg border border-border">
            {/* ui-wave U7 (owner feedback): whole-row click target (see lib/table.tsx). */}
            <DataTable data={group.entries} columns={columns} {...clickableRowTableProps()} />
          </div>
        </div>
      ))}

      {nextBefore ? (
        <div className="flex justify-center">
          <Button variant="outline" onClick={() => void loadMore()} disabled={loadingMore}>
            {loadingMore ? "Loading…" : "Load more"}
          </Button>
        </div>
      ) : null}
    </PageShell>
  );
}
