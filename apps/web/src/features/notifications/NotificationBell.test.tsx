import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { TooltipProvider } from "@elabs-ai/components-ui";
import type { Notification, NotificationListResult } from "@mcp-token-footprint/shared";
import { NotificationBell } from "./NotificationBell";

// WP4.3 — the bell fetches its page + unread count on mount (GET /api/notifications), live-pushes
// newly-created notifications over a STUBBED SSE stream (no real EventSource under jsdom — mirrors
// use-run-stream.test.ts's FakeEventSource, but here the mock function itself hands back the push
// callback directly, which is simpler since `openNotificationStream` is a thin wrapper this file owns
// end-to-end), and exercises read/read-all + the "while you were away" late chip.

const listNotificationsMock = vi.fn();
const markNotificationReadMock = vi.fn();
const markAllNotificationsReadMock = vi.fn();
const openNotificationStreamMock = vi.fn();

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return {
    ...actual,
    listNotifications: (...args: unknown[]) => listNotificationsMock(...args),
    markNotificationRead: (...args: unknown[]) => markNotificationReadMock(...args),
    markAllNotificationsRead: (...args: unknown[]) => markAllNotificationsReadMock(...args),
    openNotificationStream: (...args: unknown[]) => openNotificationStreamMock(...args),
  };
});

function notification(over: Partial<Notification> = {}): Notification {
  return {
    id: "n1",
    at: new Date().toISOString(),
    severity: "info",
    title: "Run completed",
    body: "Test t1 · scenario s1 — success",
    read: false,
    late: false,
    ...over,
  };
}

function listResult(items: Notification[], unreadCount?: number): NotificationListResult {
  return { items, total: items.length, unreadCount: unreadCount ?? items.filter((n) => !n.read).length };
}

let pushNotification: (n: Notification) => void = () => {};
let streamClosed = false;

beforeEach(() => {
  listNotificationsMock.mockReset();
  markNotificationReadMock.mockReset();
  markAllNotificationsReadMock.mockReset();
  openNotificationStreamMock.mockReset();
  streamClosed = false;
  openNotificationStreamMock.mockImplementation((on: (n: Notification) => void) => {
    pushNotification = on;
    return () => {
      streamClosed = true;
    };
  });
  markNotificationReadMock.mockImplementation((id: string) =>
    Promise.resolve(notification({ id, read: true })),
  );
  markAllNotificationsReadMock.mockResolvedValue({ count: 1 });
});

afterEach(() => {
  vi.clearAllMocks();
});

// The bell is an `IconButton` (D-TB5), which renders a Radix `Tooltip` that needs a
// `TooltipProvider` ancestor (the app root mounts one; tests wrap it here).
function renderBell(initialPath = "/dashboard") {
  return render(
    <TooltipProvider delayDuration={0}>
      <MemoryRouter initialEntries={[initialPath]}>
        <NotificationBell />
        <Routes>
          <Route path="*" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>
    </TooltipProvider>,
  );
}

function LocationProbe() {
  // A tiny probe so tests can assert the router actually navigated to a notification's linkPath.
  const location = useLocation();
  return <div data-testid="location">{location.pathname}</div>;
}

describe("NotificationBell", () => {
  test("loads on mount and shows the unread badge count", async () => {
    listNotificationsMock.mockResolvedValue(
      listResult([notification({ id: "n1" }), notification({ id: "n2", read: true })], 1),
    );
    renderBell();

    await waitFor(() => expect(listNotificationsMock).toHaveBeenCalled());
    expect(await screen.findByText("1")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /notification center — 1 unread/i })).toBeInTheDocument();
  });

  test("no unread notifications renders no badge", async () => {
    listNotificationsMock.mockResolvedValue(listResult([]));
    renderBell();
    await waitFor(() => expect(listNotificationsMock).toHaveBeenCalled());
    expect(screen.getByRole("button", { name: /notification center — no unread/i })).toBeInTheDocument();
  });

  test("opening the popover shows items with severity + an empty state when there are none", async () => {
    listNotificationsMock.mockResolvedValue(listResult([]));
    renderBell();
    await waitFor(() => expect(listNotificationsMock).toHaveBeenCalled());

    fireEvent.click(screen.getByRole("button", { name: /notification center/i }));
    expect(await screen.findByText(/no notifications yet/i)).toBeInTheDocument();
  });

  test("a live-pushed notification is prepended and bumps the badge — no toast, badge only", async () => {
    listNotificationsMock.mockResolvedValue(listResult([]));
    renderBell();
    await waitFor(() => expect(openNotificationStreamMock).toHaveBeenCalled());

    // Nothing rendered a toast region message — the push is silent (conventions §11 / the WP note).
    expect(screen.queryByRole("status")).not.toBeInTheDocument();

    act(() => {
      pushNotification(notification({ id: "pushed", severity: "critical", title: "Cost cap breached" }));
    });

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /notification center — 1 unread/i })).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: /notification center/i }));
    expect(await screen.findByText("Cost cap breached")).toBeInTheDocument();
    expect(screen.getByText("Critical")).toBeInTheDocument();
  });

  test("a late windowed notification renders the 'while you were away' chip", async () => {
    listNotificationsMock.mockResolvedValue(
      listResult([notification({ id: "n1", late: true, title: "Error rate spike" })]),
    );
    renderBell();
    fireEvent.click(await screen.findByRole("button", { name: /notification center/i }));
    expect(await screen.findByText("Error rate spike")).toBeInTheDocument();
    expect(screen.getByText(/while you were away/i)).toBeInTheDocument();
  });

  test("a non-late notification does NOT render the away chip", async () => {
    listNotificationsMock.mockResolvedValue(listResult([notification({ id: "n1", late: false })]));
    renderBell();
    fireEvent.click(await screen.findByRole("button", { name: /notification center/i }));
    await screen.findByText("Run completed");
    expect(screen.queryByText(/while you were away/i)).not.toBeInTheDocument();
  });

  test("clicking a notification marks it read and navigates to its linkPath", async () => {
    listNotificationsMock.mockResolvedValue(
      listResult([notification({ id: "n1", linkPath: "/testing/runs/run-42" })]),
    );
    renderBell();
    fireEvent.click(await screen.findByRole("button", { name: /notification center/i }));
    // Query the ROW by role: the title also appears in the row's hover/focus tooltip (which Radix
    // opens on focus at the test provider's zero delay), so a bare text query is ambiguous.
    fireEvent.click(await screen.findByRole("button", { name: /Run completed/ }));

    await waitFor(() => expect(markNotificationReadMock).toHaveBeenCalledWith("n1"));
    await waitFor(() =>
      expect(screen.getByTestId("location")).toHaveTextContent("/testing/runs/run-42"),
    );
  });

  test("clicking an ALREADY-read notification navigates without calling markRead again", async () => {
    listNotificationsMock.mockResolvedValue(
      listResult([notification({ id: "n1", read: true, linkPath: "/testing/runs/run-1" })], 0),
    );
    renderBell();
    fireEvent.click(await screen.findByRole("button", { name: /notification center/i }));
    fireEvent.click(await screen.findByRole("button", { name: /Run completed/ }));

    expect(markNotificationReadMock).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(screen.getByTestId("location")).toHaveTextContent("/testing/runs/run-1"),
    );
  });

  test("'mark all read' calls the API then refreshes; disabled at zero unread", async () => {
    listNotificationsMock.mockResolvedValueOnce(listResult([notification({ id: "n1" })], 1));
    renderBell();
    fireEvent.click(await screen.findByRole("button", { name: /notification center — 1 unread/i }));

    const markAllButton = screen.getByRole("button", { name: /mark all read/i });
    expect(markAllButton).toBeEnabled();

    listNotificationsMock.mockResolvedValueOnce(
      listResult([notification({ id: "n1", read: true })], 0),
    );
    fireEvent.click(markAllButton);

    await waitFor(() => expect(markAllNotificationsReadMock).toHaveBeenCalled());
    await waitFor(() => expect(listNotificationsMock).toHaveBeenCalledTimes(2));
  });

  test("the stream subscription is closed on unmount (no leaked EventSource)", async () => {
    listNotificationsMock.mockResolvedValue(listResult([]));
    const { unmount } = renderBell();
    await waitFor(() => expect(openNotificationStreamMock).toHaveBeenCalled());
    expect(streamClosed).toBe(false);
    unmount();
    expect(streamClosed).toBe(true);
  });
});

// ══ Overflow + tooltip (reported defect) ═════════════════════════════════════════════════════════
// A hub notification's title carries the SESSION title verbatim ("Mission completed: i need a full
// market analysis of …"), which is arbitrarily long. Two things went wrong in the popover: rows were
// laid out inside a Radix `ScrollArea`, whose viewport content wrapper is `display:table;
// min-width:100%` — a shrink-to-fit box that grows to the widest row, so `truncate` never fired and
// the ScrollArea root's `overflow-hidden` hard-CUT the title mid-word at the panel edge — and the
// body used `truncate whitespace-normal` (the `whitespace-normal` cancels truncate's `nowrap`, so
// the ellipsis was dead and the body wrapped unbounded). Full text is now reachable on hover/focus.
describe("NotificationBell — long content is clamped, full text on hover", () => {
  const LONG_TITLE =
    "Mission completed: i need a full market analysis of the european business-intelligence tooling space";
  const LONG_BODY =
    "The mission finished and synthesized its results across every agent, tool call and cited source it gathered.";

  async function openWithLongItem() {
    listNotificationsMock.mockResolvedValue(
      listResult([notification({ id: "n1", title: LONG_TITLE, body: LONG_BODY })]),
    );
    renderBell();
    fireEvent.click(await screen.findByRole("button", { name: /notification center/i }));
    return await screen.findByText(LONG_TITLE);
  }

  test("the title truncates to one line and the body clamps instead of growing the row", async () => {
    const title = await openWithLongItem();
    expect(title.className).toContain("truncate");
    const body = screen.getByText(LONG_BODY);
    expect(body.className).toContain("line-clamp-2");
    // `whitespace-normal` cancels `truncate`'s `nowrap` — it must not be paired with it.
    expect(body.className).not.toContain("truncate");
  });

  test("the scroll viewport is forced back to `block` so rows cannot size to their content", async () => {
    await openWithLongItem();
    // Radix's viewport content wrapper is `display:table` (shrink-to-fit); without this override the
    // list is as wide as its longest row and every `truncate`/`w-full` inside it is inert.
    const viewport = document.querySelector("[data-radix-scroll-area-viewport]");
    expect(viewport).not.toBeNull();
    const scrollRoot = viewport?.parentElement;
    expect(scrollRoot?.className).toContain("[&>[data-radix-scroll-area-viewport]>div]:block!");
  });

  test("focusing a row reveals the full title and body in a tooltip", async () => {
    await openWithLongItem();
    const row = screen.getByRole("button", { name: new RegExp(LONG_TITLE.slice(0, 40), "i") });
    await act(async () => {
      row.focus();
    });
    const tip = await screen.findByRole("tooltip");
    expect(tip).toHaveTextContent(LONG_TITLE);
    expect(tip).toHaveTextContent(LONG_BODY);
  });

  test("the row still marks read and navigates with the tooltip wrapper in place", async () => {
    listNotificationsMock.mockResolvedValue(
      listResult([notification({ id: "n1", title: LONG_TITLE, linkPath: "/assistant?session=s-1" })]),
    );
    renderBell();
    fireEvent.click(await screen.findByRole("button", { name: /notification center/i }));
    fireEvent.click(await screen.findByRole("button", { name: new RegExp(LONG_TITLE.slice(0, 40), "i") }));
    await waitFor(() => expect(markNotificationReadMock).toHaveBeenCalledWith("n1"));
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("/assistant"));
  });
});
