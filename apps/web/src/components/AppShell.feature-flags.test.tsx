import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

// Settings › Features — the shell's half of the Assistant switch: while the feature is off, its
// whole sidebar group AND the App-assistant dock toggle are gone. Rendered against the real
// `AppShell` tree so the assertion is about what an operator can actually reach, not a prop.

vi.mock("../features/notifications/NotificationBell", () => ({
  NotificationBell: () => null,
}));

// Feed the shell a deterministic flag map without touching the network: the provider's fetch is
// mocked, so `AppShell`'s `useFeatureEnabled` reads exactly what each test sets up.
vi.mock("../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/api")>();
  return { ...actual, getFeatureFlags: vi.fn(), updateFeatureFlags: vi.fn() };
});

// jsdom omits `matchMedia`, which `@elabs-ai/components-ui`'s `useIsMobile` (SidebarProvider) reads —
// `matches: false` keeps the shell in its DESKTOP layout (no mobile Sheet branch).
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

import * as api from "../lib/api";
import { FeatureFlagsProvider } from "../features/feature-flags/feature-flags-context";
import { AppShell } from "./AppShell";

const ASSISTANT_NAV_LABELS = ["Assistant", "Agents & Crews", "Projects", "Audit"];

async function renderShell(assistant: boolean) {
  vi.mocked(api.getFeatureFlags).mockResolvedValue({ flags: { assistant } });
  const view = render(
    <MemoryRouter initialEntries={["/dashboard"]}>
      <FeatureFlagsProvider>
        <AppShell themePreference="light" onThemePreferenceChange={() => {}} dockAvailable>
          <div>Dashboard content</div>
        </AppShell>
      </FeatureFlagsProvider>
    </MemoryRouter>,
  );
  // Let the provider's fetch settle so the shell renders against the real flag map.
  await screen.findByText("Dashboard content");
  return view;
}

describe("AppShell × Settings › Features", () => {
  it("shows the Assistant nav group and the dock toggle while the feature is on", async () => {
    await renderShell(true);
    for (const label of ASSISTANT_NAV_LABELS) {
      expect(await screen.findByRole("link", { name: label })).toBeTruthy();
    }
    expect(await screen.findByRole("button", { name: /App assistant/ })).toBeTruthy();
  });

  it("removes every Assistant nav item and the dock toggle while it is off", async () => {
    await renderShell(false);
    // Wait for the flag fetch to have been consumed before asserting on absence.
    await vi.waitFor(() => expect(screen.queryByRole("link", { name: "Assistant" })).toBeNull());
    for (const label of ASSISTANT_NAV_LABELS) {
      expect(screen.queryByRole("link", { name: label })).toBeNull();
    }
    expect(screen.queryByRole("button", { name: /App assistant/ })).toBeNull();
    // The rest of the shell is untouched.
    expect(screen.getByRole("link", { name: "Dashboard" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "MCP Servers" })).toBeTruthy();
  });
});
