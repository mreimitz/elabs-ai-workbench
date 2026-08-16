import { useCallback, useEffect, useRef, useState } from "react";
import type { Notification } from "@mcp-token-footprint/shared";
import {
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  openNotificationStream,
} from "../../lib/api";
import { getErrorMessage } from "../../lib/errors";

/** How many recent notifications the bell's popover keeps loaded — a compact recent-history list, not
 *  a full inbox (the notification center itself is a future surface; see roadmap/observability/). */
const BELL_PAGE_LIMIT = 20;

export interface UseNotificationsState {
  items: Notification[];
  /** The GLOBAL unread total (independent of `items`, which is capped to `BELL_PAGE_LIMIT`) — the
   *  badge's source of truth. */
  unreadCount: number;
  /** True only before the FIRST successful load (loading-states.md: "no content yet" — the popover
   *  shows a layout-shaped placeholder, never a blank flash). A background refresh does not re-flip
   *  this. */
  loading: boolean;
  error: string | null;
}

export interface UseNotifications extends UseNotificationsState {
  refresh: () => void;
  markRead: (id: string) => Promise<void>;
  markAllRead: () => Promise<void>;
}

/**
 * The bell's data source: loads the current page on mount, live-pushes newly-created notifications
 * over SSE (prepended, unread count bumped — see {@link openNotificationStream}), and exposes
 * read/read-all actions that RE-FETCH afterward (the server is the source of truth for the unread
 * count, so a round-trip beats a hand-rolled optimistic decrement that could drift). Deliberately
 * QUIET: no toast is ever fired here for any severity — the badge + popover are the whole surface
 * (the WP4.3 spec: "no toasts for `info`, badge only").
 */
export function useNotifications(): UseNotifications {
  const [state, setState] = useState<UseNotificationsState>({
    items: [],
    unreadCount: 0,
    loading: true,
    error: null,
  });
  // Guards every async continuation (fetch / SSE message) against landing after unmount.
  const activeRef = useRef(true);

  const load = useCallback(() => {
    setState((current) => ({ ...current, error: null }));
    listNotifications({ limit: BELL_PAGE_LIMIT })
      .then((result) => {
        if (!activeRef.current) return;
        setState({
          items: result.items,
          unreadCount: result.unreadCount,
          loading: false,
          error: null,
        });
      })
      .catch((error: unknown) => {
        if (!activeRef.current) return;
        setState((current) => ({
          ...current,
          loading: false,
          error: getErrorMessage(error, "Couldn’t load notifications."),
        }));
      });
  }, []);

  useEffect(() => {
    activeRef.current = true;
    load();
    return () => {
      activeRef.current = false;
    };
  }, [load]);

  // Live push: a freshly-created notification is prepended (deduped by id, capped to the page limit)
  // and the unread badge is bumped — no toast, no refetch (this IS the up-to-date row already).
  useEffect(() => {
    const close = openNotificationStream((notification) => {
      if (!activeRef.current) return;
      setState((current) => ({
        ...current,
        items: [notification, ...current.items.filter((n) => n.id !== notification.id)].slice(
          0,
          BELL_PAGE_LIMIT,
        ),
        unreadCount: notification.read ? current.unreadCount : current.unreadCount + 1,
      }));
    });
    return close;
  }, []);

  const markRead = useCallback(
    async (id: string) => {
      await markNotificationRead(id);
      if (activeRef.current) load();
    },
    [load],
  );

  const markAllRead = useCallback(async () => {
    await markAllNotificationsRead();
    if (activeRef.current) load();
  }, [load]);

  return { ...state, refresh: load, markRead, markAllRead };
}
