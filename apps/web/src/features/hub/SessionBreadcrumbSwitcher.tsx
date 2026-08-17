// Assistant Hub end-user UX pass — the session identity control, relocated from the workspace toolbar
// into the breadcrumb (`Home › Assistant › [Session ▾]`). Clicking the crumb opens a popover that
// leads with THIS session, then a searchable list of every other session — the richer switcher the
// flat `@elabs-ai/components-ui` Combobox (one flat group, no per-row status, no pinned footer) couldn't express, so
// it's composed here from `Popover` + `@elabs-ai/components-data` `SearchInput` + the app's one `StatusBadge`.
//
// This supersedes the toolbar `SessionSwitcher` (removed from `AssistantView`'s ViewToolbar): the
// session title + its live status now live in the breadcrumb as the leaf crumb.

import { useMemo, useState } from "react";
import { Badge, Button, Popover, PopoverContent, PopoverTrigger, Text, cn } from "@elabs-ai/components-ui";
import { SearchInput } from "@elabs-ai/components-data";
import type { HubSession } from "@mcp-token-footprint/shared";
import { ChevronDown, Plus } from "lucide-react";
import { StatusBadge } from "../../components/StatusBadge";
import { deriveRunStatusView, type StatusView } from "../../lib/status";
import { formatRelativeTime } from "../../lib/format";
import { SESSION_MODE_LABELS } from "./sessions/columns";

export type SessionBreadcrumbSwitcherProps = {
  /** All loaded sessions, most-recently-updated first (the order `AssistantView` keeps them in). */
  sessions: HubSession[];
  activeSessionId: string | null;
  /** The active session's live status view (queued/waiting reflected), rendered in the trigger — the
   *  same derivation the toolbar used, computed once by `AssistantView`. */
  activeStatusView?: StatusView | null;
  /** True while the initial session list fetch is still in flight. */
  loading?: boolean;
  onSelect: (session: HubSession) => void;
  onNewSession: () => void;
  onViewAll: () => void;
};

/** A settled per-row status view (list rows show the last-settled status, not live SSE phase — that
 *  only exists for the ACTIVE session, which carries {@link SessionBreadcrumbSwitcherProps.activeStatusView}). */
function rowStatusView(session: HubSession): StatusView {
  return deriveRunStatusView({
    status: session.status,
    ...(session.stopReasonCode ? { stopReasonCode: session.stopReasonCode } : {}),
  });
}

export function SessionBreadcrumbSwitcher({
  sessions,
  activeSessionId,
  activeStatusView = null,
  loading = false,
  onSelect,
  onNewSession,
  onViewAll,
}: SessionBreadcrumbSwitcherProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const activeSession = activeSessionId
    ? (sessions.find((s) => s.id === activeSessionId) ?? null)
    : null;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sessions;
    return sessions.filter((s) => (s.title.trim() || "Untitled session").toLowerCase().includes(q));
  }, [sessions, query]);

  const triggerLabel = activeSession
    ? activeSession.title.trim() || "Untitled session"
    : loading
      ? "Loading sessions…"
      : "Select a session";

  const handleSelect = (session: HubSession): void => {
    onSelect(session);
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          // Layout-only: sit flush in the breadcrumb row (compact height, tight gutter) while keeping
          // the ghost hover affordance so it reads as an interactive crumb.
          className="-my-1 h-7 max-w-[16rem] gap-1.5 px-2 font-medium"
          aria-label="Switch session"
        >
          <span className="min-w-0 truncate">{triggerLabel}</span>
          {activeStatusView ? <StatusBadge view={activeStatusView} className="shrink-0" /> : null}
          <ChevronDown aria-hidden className="size-3.5 shrink-0 opacity-60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[22rem] p-0">
        <div className="flex flex-col" data-testid="session-switcher-popover">
          <div className="flex flex-col gap-2 border-b border-border p-3">
            <Text variant="meta" tone="muted" className="uppercase tracking-wide">
              This session
            </Text>
            {activeSession ? (
              <div className="flex min-w-0 items-center gap-2">
                <span className="min-w-0 flex-1 truncate font-medium">
                  {activeSession.title.trim() || "Untitled session"}
                </span>
                <StatusBadge
                  view={activeStatusView ?? rowStatusView(activeSession)}
                  className="shrink-0"
                />
              </div>
            ) : (
              <Text tone="muted">No session open.</Text>
            )}
          </div>

          <div className="p-2">
            <SearchInput
              value={query}
              onValueChange={setQuery}
              placeholder="Search sessions…"
              label="Search sessions"
            />
          </div>

          <div className="max-h-[18rem] min-h-0 overflow-y-auto px-2 pb-2">
            {filtered.length === 0 ? (
              <div className="flex flex-col items-center gap-2 px-2 py-6 text-center">
                <Text tone="muted">
                  {sessions.length === 0
                    ? "No sessions yet."
                    : `No sessions match “${query.trim()}”.`}
                </Text>
                {sessions.length > 0 ? (
                  <Button variant="outline" size="sm" onClick={() => setQuery("")}>
                    Clear filter
                  </Button>
                ) : null}
              </div>
            ) : (
              <ul className="flex flex-col gap-0.5">
                {filtered.map((session) => {
                  const isActive = session.id === activeSessionId;
                  return (
                    <li key={session.id}>
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={() => handleSelect(session)}
                        aria-current={isActive ? "true" : undefined}
                        className={cn(
                          "h-auto w-full flex-col items-stretch gap-1 rounded-md px-2 py-2 text-left font-normal",
                          isActive && "bg-accent text-accent-foreground",
                        )}
                      >
                        <span className="flex min-w-0 items-center gap-2">
                          <span className="min-w-0 flex-1 truncate">
                            {session.title.trim() || "Untitled session"}
                          </span>
                          <StatusBadge view={rowStatusView(session)} className="shrink-0" />
                        </span>
                        <span className="flex items-center gap-2 text-caption text-muted-foreground">
                          <Badge variant="outline" className="shrink-0">
                            {SESSION_MODE_LABELS[session.mode]}
                          </Badge>
                          <span className="truncate">{formatRelativeTime(session.updatedAt)}</span>
                        </span>
                      </Button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <div className="flex items-center justify-between gap-2 border-t border-border p-2">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="gap-1.5"
              onClick={() => {
                onNewSession();
                setOpen(false);
              }}
            >
              <Plus aria-hidden className="size-4" />
              <span>New session</span>
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="text-muted-foreground"
              onClick={() => {
                onViewAll();
                setOpen(false);
              }}
            >
              View all sessions →
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
