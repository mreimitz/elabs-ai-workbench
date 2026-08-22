/**
 * help-in-shell.test.tsx — RM-18 WP 1.2, acceptance item 6.
 *
 * "The Help control appears ONCE, on every route" is the claim the whole top-bar approach rests on.
 * It is asserted against a real render of the shell, on several routes — including one with no
 * mapping — so a regression that hides it behind a condition, or duplicates it, goes red.
 *
 * `AppShell` is imported, never edited, by this file: the WP's single insertion into the shell is
 * one line in the top bar's `end` slot, and this is the guard on it.
 */
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

// NotificationBell opens an SSE stream on mount; neither it nor the network exists under jsdom and
// neither is under test here. Same stub the existing AppShell render harness uses.
vi.mock("../notifications/NotificationBell", () => ({ NotificationBell: () => null }));

if (typeof window.matchMedia !== "function") {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

import { AppShell } from "../../components/AppShell";

function renderShellAt(pathname: string) {
  return render(
    <MemoryRouter initialEntries={[pathname]}>
      <AppShell themePreference="light" onThemePreferenceChange={() => {}}>
        <div>page</div>
      </AppShell>
    </MemoryRouter>,
  );
}

describe("the Help control in the app shell", () => {
  it.each([
    ["/dashboard", "Help — open the guide for this page"],
    ["/servers/abc", "Help — open the guide for this page"],
    ["/testing/runs/run_1", "Help — open the guide for this page"],
    // No mapping for /advisor yet (DC-25 has no guide page) — the control must still be there, and
    // must say which of the two answers the reader is about to get.
    ["/advisor", "Help — open the user guide"],
  ])("renders exactly one Help control on %s", (pathname, label) => {
    const view = renderShellAt(pathname);
    const buttons = screen.getAllByRole("button", { name: /^Help — / });
    expect(buttons).toHaveLength(1);
    expect(buttons[0]).toHaveAccessibleName(label);
    // D-TB5: the affordance is the tooltip, never a native `title`.
    expect(buttons[0]?.getAttribute("title")).toBeNull();
    view.unmount();
  });
});
