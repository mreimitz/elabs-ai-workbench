import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { TooltipProvider } from "@elabs-ai/components-ui";

// WP 0.2 — the Settings "Assistant" section (a pane of the settings modal). The api module is
// mocked so the on-mount status + providers fetch resolves deterministically and no real request
// is made.
vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return {
    ...actual,
    getAssistantAuthStatus: vi.fn(),
    listProviders: vi.fn(),
    startAssistantOauth: vi.fn(),
    completeAssistantOauth: vi.fn(),
    cancelAssistantOauth: vi.fn(),
    storeAssistantToken: vi.fn(),
    setAssistantFallback: vi.fn(),
    signOutAssistant: vi.fn(),
  };
});

import * as api from "../../lib/api";
import { AssistantSection } from "./SettingsView";

function renderSection() {
  return render(
    <TooltipProvider>
      <AssistantSection />
    </TooltipProvider>,
  );
}

const SIGNED_OUT = { signedIn: false, fallbackConfigured: false, models: [] as string[] };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.getAssistantAuthStatus).mockResolvedValue(SIGNED_OUT);
  vi.mocked(api.listProviders).mockResolvedValue([]);
});

describe("AssistantSection", () => {
  test("renders the signed-out state with subscription framing and no 'Claude Code' copy", async () => {
    const { container } = renderSection();

    expect(await screen.findByText("Not signed in")).toBeInTheDocument();
    expect(screen.getByText(/powered by your claude subscription/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /sign in with claude/i })).toBeInTheDocument();
    // D-AS9 hard rule: the product is "Assistant"; UI copy must never say "Claude Code".
    expect(container.textContent).not.toMatch(/Claude Code/);
  });

  test("starting the PTY flow surfaces the authorization URL and a code input", async () => {
    vi.mocked(api.startAssistantOauth).mockResolvedValue({
      flowId: "flow-1",
      authUrl: "https://claude.ai/oauth/authorize?state=abc",
    });

    renderSection();
    fireEvent.click(await screen.findByRole("button", { name: /sign in with claude/i }));

    expect(
      await screen.findByText("https://claude.ai/oauth/authorize?state=abc"),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /submit code/i })).toBeInTheDocument();
    expect(api.startAssistantOauth).toHaveBeenCalledTimes(1);
  });

  test("shows the expiry warning and a token-reset affordance when signed in near expiry", async () => {
    vi.mocked(api.getAssistantAuthStatus).mockResolvedValue({
      signedIn: true,
      tokenCreatedAt: "2025-01-01T00:00:00Z",
      tokenAgeDays: 340,
      fallbackConfigured: false,
      models: [],
    });

    renderSection();

    expect(await screen.findByText("Signed in")).toBeInTheDocument();
    expect(screen.getByText(/close to its one-year expiry/i)).toBeInTheDocument();
    // The sign-out affordance is now framed as "Reset token" — the same `signOutAssistant` call,
    // named for what the owner is actually trying to do (mint a fresh token / switch account).
    expect(screen.getByRole("button", { name: /^reset token$/i })).toBeInTheDocument();
  });

  test("states plainly that the stored token carries no account identity", async () => {
    renderSection();

    expect(await screen.findByText(/which account is this\?/i)).toBeInTheDocument();
    expect(screen.getByText(/scopes those tokens to inference only/i)).toBeInTheDocument();
  });
});
