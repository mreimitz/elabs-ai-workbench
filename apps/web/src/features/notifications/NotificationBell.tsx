import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Badge, Button, Popover, PopoverContent, PopoverTrigger, ScrollArea, Text, cn } from "@brand/ui";
import type { Notification, WatchNotifySeverity } from "@mcp-token-footprint/shared";
import { Bell, Clock } from "lucide-react";
import { IconButton } from "../../components/IconButton";
import { StatusBadge } from "../../components/StatusBadge";
import { formatRelativeTime } from "../../lib/format";
import type { StatusView } from "../../lib/status";
import { useNotifications } from "./use-notifications";

// Observability WP4.3 (D-OB19) — the bell in the AppShell header: unread badge, a popover of recent
// notifications (severity tone, relative time, a "while you were away" chip for a late windowed
// fire), click → deep link + mark read, and "mark all read". Deliberately QUIET (conventions §11 / the
// WP note): no toast is ever fired for a notification of any severity — the badge count + this
// popover are the whole surface.
//
// `@brand/ui` ships a purpose-built `NavNotifications` composite, but its shape (`{id, fallback, text,
// time}` — a people/avatar mention list) has no room for severity/read-state/deep-link/late, all of
// which this app's WP4.3 spec requires — so this composes `Popover` + `Badge` + `StatusBadge` (the
// app's own severity/status chip primitive) directly, per library-first.md's "compose from existing
// @brand primitives" guidance rather than force-fitting a component built for a different shape.
//
// design-remediation T5 (item 9): this center is named "Notification center" — NOT "Notifications" —
// so its accessible name does not collide with Sonner's toast viewport region (whose default
// `containerAriaLabel` is "Notifications", configured at the app root). Two live surfaces both named
// "Notifications" read as one thing to a screen reader; the persistent center and the transient
// toast stack are distinct systems and now carry distinct names.

/** Severity → the app's StatusBadge tone vocabulary (lib/status.ts `StatusTone`). Reused rather than
 *  hand-rolling a second tone→class table. */
const SEVERITY_VIEW: Record<WatchNotifySeverity, StatusView> = {
  info: { kind: "chip", label: "Info", tone: "info", spinner: false, dashed: false },
  warning: { kind: "chip", label: "Warning", tone: "warning", spinner: false, dashed: false },
  critical: { kind: "chip", label: "Critical", tone: "danger", spinner: false, dashed: false },
};

export function NotificationBell() {
  const navigate = useNavigate();
  const { items, unreadCount, loading, error, markRead, markAllRead } = useNotifications();
  const [open, setOpen] = useState(false);
  // design-remediation T5 (item 2): the Radix trigger is the relative wrapper `<div>` (the unread
  // Badge overlays the button, so the trigger can't BE the button), and a `<div>` isn't focusable —
  // so Radix's default close-focus restore lands on <body>. Keep a ref to the bell button and send
  // focus back to it on close via `onCloseAutoFocus` below.
  const triggerRef = useRef<HTMLButtonElement>(null);

  const handleSelect = (notification: Notification) => {
    setOpen(false);
    if (!notification.read) void markRead(notification.id);
    if (notification.linkPath) navigate(notification.linkPath);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <div className="relative">
          <IconButton
            ref={triggerRef}
            variant="ghost"
            label={
              unreadCount > 0
                ? `Notification center — ${unreadCount} unread`
                : "Notification center — no unread"
            }
          >
            <Bell aria-hidden />
          </IconButton>
          {unreadCount > 0 ? (
            <Badge
              aria-hidden
              className="pointer-events-none absolute -right-0.5 -top-0.5 h-4 min-w-4 justify-center px-1 tabular-nums"
            >
              {unreadCount > 99 ? "99+" : unreadCount}
            </Badge>
          ) : null}
        </div>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-96 p-0"
        onCloseAutoFocus={(event) => {
          // Restore focus to the bell button (the wrapper div Radix would otherwise focus is inert).
          if (triggerRef.current) {
            event.preventDefault();
            triggerRef.current.focus();
          }
        }}
      >
        <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
          <Text variant="body" className="font-medium">
            Notification center
          </Text>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void markAllRead()}
            disabled={unreadCount === 0}
          >
            Mark all read
          </Button>
        </div>
        <NotificationList
          items={items}
          loading={loading}
          error={error}
          onSelect={handleSelect}
        />
      </PopoverContent>
    </Popover>
  );
}

function NotificationList({
  items,
  loading,
  error,
  onSelect,
}: {
  items: Notification[];
  loading: boolean;
  error: string | null;
  onSelect: (notification: Notification) => void;
}) {
  if (loading && items.length === 0) {
    return (
      <div className="flex flex-col gap-2 p-3">
        {/* Loading-states.md: a layout-shaped placeholder, never a bare spinner. */}
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-14 animate-pulse rounded-md bg-muted motion-reduce:animate-none" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4">
        <Text variant="body" tone="muted">
          {`${error} Try again.`}
        </Text>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="p-6 text-center">
        <Text variant="body" tone="muted">
          No notifications yet.
        </Text>
      </div>
    );
  }

  return (
    <ScrollArea className="max-h-96">
      <ul className="flex flex-col">
        {items.map((notification) => (
          <li key={notification.id}>
            <Button
              variant="ghost"
              onClick={() => onSelect(notification)}
              className={cn(
                "h-auto w-full flex-col items-start gap-1 rounded-none px-3 py-2.5 text-left",
                "border-b border-border last:border-b-0",
                !notification.read && "bg-accent/40",
              )}
            >
              <div className="flex w-full items-center gap-2">
                <StatusBadge view={SEVERITY_VIEW[notification.severity]} />
                <Text variant="body" className="min-w-0 flex-1 truncate font-medium">
                  {notification.title}
                </Text>
                <Text variant="meta" tone="muted" className="shrink-0 tabular-nums">
                  {formatRelativeTime(notification.at)}
                </Text>
              </div>
              <Text variant="meta" tone="muted" className="w-full truncate whitespace-normal text-left">
                {notification.body}
              </Text>
              {notification.late ? (
                <Badge variant="outline" className="gap-1 border-border text-muted-foreground">
                  <Clock aria-hidden className="size-3" />
                  While you were away
                </Badge>
              ) : null}
            </Button>
          </li>
        ))}
      </ul>
    </ScrollArea>
  );
}
