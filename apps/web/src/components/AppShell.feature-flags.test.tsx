import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

// Settings › Features — the shell's half of the TWO assistant switches. They are independent by
// design (they were one flag until 2026-08-21, which meant switching the full-page workspace off
// also took the right-hand dock with it): `assistant` owns the sidebar group, `app_assistant` owns
// the dock toggle. Rendered against the real `AppShell` tree so each assertion is about what an
// operator can actually reach, not a prop.

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
import { DEFAULT_APP_FEATURE_FLAGS } from "@mcp-token-footprint/shared";
import { FeatureFlagsProvider } from "../features/feature-flags/feature-flags-context";
import { AppShell } from "./AppShell";

const ASSISTANT_NAV_LABELS = ["Assistant", "Agents & Crews", "Projects", "Audit"];

async function renderShell(overrides: { assistant?: boolean; app_assistant?: boolean }) {
  vi.mocked(api.getFeatureFlags).mockResolvedValue({
    flags: { ...DEFAULT_APP_FEATURE_FLAGS, ...overrides },
  });
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
  it("shows the Assistant nav group and the dock toggle while both features are on", async () => {
    await renderShell({});
    for (const label of ASSISTANT_NAV_LABELS) {
      expect(await screen.findByRole("link", { name: label })).toBeTruthy();
    }
    expect(await screen.findByRole("button", { name: /App assistant/ })).toBeTruthy();
  });

  it("removes every Assistant nav item while the workspace is off — but KEEPS the dock", async () => {
    await renderShell({ assistant: false });
    // Wait for the flag fetch to have been consumed before asserting on absence.
    await vi.waitFor(() => expect(screen.queryByRole("link", { name: "Assistant" })).toBeNull());
    for (const label of ASSISTANT_NAV_LABELS) {
      expect(screen.queryByRole("link", { name: label })).toBeNull();
    }
    // THE REGRESSION this split exists for: the dock is a separate feature and must survive.
    expect(screen.getByRole("button", { name: /App assistant/ })).toBeTruthy();
    // The rest of the shell is untouched.
    expect(screen.getByRole("link", { name: "Dashboard" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "MCP Servers" })).toBeTruthy();
  });

  it("removes the dock toggle while the dock is off — but KEEPS the Assistant nav group", async () => {
    await renderShell({ app_assistant: false });
    await vi.waitFor(() =>
      expect(screen.queryByRole("button", { name: /App assistant/ })).toBeNull(),
    );
    for (const label of ASSISTANT_NAV_LABELS) {
      expect(screen.getByRole("link", { name: label })).toBeTruthy();
    }
    expect(screen.getByRole("link", { name: "Dashboard" })).toBeTruthy();
  });

  it("removes both when both are off", async () => {
    await renderShell({ assistant: false, app_assistant: false });
    await vi.waitFor(() => expect(screen.queryByRole("link", { name: "Assistant" })).toBeNull());
    for (const label of ASSISTANT_NAV_LABELS) {
      expect(screen.queryByRole("link", { name: label })).toBeNull();
    }
    expect(screen.queryByRole("button", { name: /App assistant/ })).toBeNull();
    expect(screen.getByRole("link", { name: "Dashboard" })).toBeTruthy();
  });
});
