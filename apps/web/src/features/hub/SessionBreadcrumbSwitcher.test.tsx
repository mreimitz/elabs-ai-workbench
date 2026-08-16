import type { HubSession } from "@mcp-token-footprint/shared";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { SessionBreadcrumbSwitcher } from "./SessionBreadcrumbSwitcher";

function session(overrides: Partial<HubSession> = {}): HubSession {
  return {
    id: "s1",
    kind: "chat",
    title: "Alpha thread",
    titleState: "auto",
    mode: "chat",
    model: "claude-sonnet-5",
    status: "completed",
    costUsd: 0,
    tokensIn: 0,
    tokensOut: 0,
    turns: 0,
    archived: false,
    createdAt: "2026-07-17T09:00:00.000Z",
    updatedAt: "2026-07-17T09:00:00.000Z",
    seen: true,
    ...overrides,
  };
}

const sessions = [
  session({ id: "alpha", title: "Alpha thread" }),
  session({ id: "beta", title: "Beta thread", mode: "research" }),
  session({ id: "gamma", title: "Gamma thread", mode: "mission" }),
];

function renderSwitcher(
  props: Partial<React.ComponentProps<typeof SessionBreadcrumbSwitcher>> = {},
) {
  const onSelect = vi.fn();
  const onNewSession = vi.fn();
  const onViewAll = vi.fn();
  render(
    <SessionBreadcrumbSwitcher
      sessions={sessions}
      activeSessionId="alpha"
      onSelect={onSelect}
      onNewSession={onNewSession}
      onViewAll={onViewAll}
      {...props}
    />,
  );
  return { onSelect, onNewSession, onViewAll };
}

describe("SessionBreadcrumbSwitcher (Assistant Hub end-user UX pass)", () => {
  test("the trigger shows the active session's title", () => {
    renderSwitcher();
    expect(screen.getByRole("button", { name: "Switch session" })).toHaveTextContent(
      "Alpha thread",
    );
  });

  test("opening the popover lists every session; picking a non-active one calls onSelect with it", async () => {
    const { onSelect } = renderSwitcher();
    fireEvent.click(screen.getByRole("button", { name: "Switch session" }));

    await waitFor(() => expect(screen.getByText("Beta thread")).toBeInTheDocument());
    expect(screen.getByText("Gamma thread")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Beta thread"));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect.mock.calls[0]?.[0]).toMatchObject({ id: "beta" });
  });

  test("the search box filters the list by title", async () => {
    renderSwitcher();
    fireEvent.click(screen.getByRole("button", { name: "Switch session" }));
    await waitFor(() => expect(screen.getByText("Gamma thread")).toBeInTheDocument());

    fireEvent.change(screen.getByPlaceholderText("Search sessions…"), {
      target: { value: "beta" },
    });

    expect(screen.getByText("Beta thread")).toBeInTheDocument();
    expect(screen.queryByText("Gamma thread")).not.toBeInTheDocument();
  });

  test("the footer actions fire onNewSession and onViewAll (each closes the popover)", async () => {
    const { onNewSession, onViewAll } = renderSwitcher();

    fireEvent.click(screen.getByRole("button", { name: "Switch session" }));
    await waitFor(() => expect(screen.getByText("New session")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "New session" }));
    expect(onNewSession).toHaveBeenCalledTimes(1);

    // Picking a footer action closes the popover — reopen it for the second assertion.
    fireEvent.click(screen.getByRole("button", { name: "Switch session" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "View all sessions →" })).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: "View all sessions →" }));
    expect(onViewAll).toHaveBeenCalledTimes(1);
  });

  test("a search with no matches echoes the query and its Clear filter action restores the list (finding 13)", async () => {
    renderSwitcher();
    fireEvent.click(screen.getByRole("button", { name: "Switch session" }));
    await waitFor(() => expect(screen.getByText("Gamma thread")).toBeInTheDocument());

    fireEvent.change(screen.getByPlaceholderText("Search sessions…"), {
      target: { value: "nonexistent" },
    });
    expect(screen.getByText("No sessions match “nonexistent”.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Clear filter" }));
    expect(screen.getByText("Gamma thread")).toBeInTheDocument();
    expect(screen.queryByText(/No sessions match/)).not.toBeInTheDocument();
  });

  test("with no active session the trigger invites picking one", () => {
    renderSwitcher({ activeSessionId: null });
    expect(screen.getByRole("button", { name: "Switch session" })).toHaveTextContent(
      "Select a session",
    );
  });
});
