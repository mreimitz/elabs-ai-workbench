import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { TooltipProvider } from "@elabs-ai/components-ui";

// Providers — per-credential settings open in a MODAL (owner decision 2026-07-28; they used to
// render as an inline form under the list). For an `claude_subscription` credential (WP 0.3,
// D-CS7) the modal has NO key/secret field: it embeds the shared Claude sign-in panel instead, so
// the token can be signed in, re-signed in, and RESET without leaving the credential. The api
// module is mocked so every fetch resolves deterministically and no real request is made.
vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return {
    ...actual,
    listProviders: vi.fn(),
    getAssistantAuthStatus: vi.fn(),
    createProvider: vi.fn(),
    updateProvider: vi.fn(),
    deleteProvider: vi.fn(),
    signOutAssistant: vi.fn(),
    startAssistantOauth: vi.fn(),
  };
});

import * as api from "../../lib/api";
import { ProvidersSection } from "./SettingsView";

function renderSection() {
  return render(
    <TooltipProvider>
      <ProvidersSection />
    </TooltipProvider>,
  );
}

const SIGNED_OUT = { signedIn: false, fallbackConfigured: false, models: [] as string[] };
const SIGNED_IN = {
  signedIn: true,
  tokenCreatedAt: "2026-01-01T00:00:00.000Z",
  tokenAgeDays: 12,
  fallbackConfigured: false,
  models: [] as string[],
};

const SUBSCRIPTION_PROVIDER = {
  id: "cred-1",
  kind: "claude_subscription" as const,
  label: "My Claude subscription",
  hasKey: false,
  createdAt: "2026-07-13T00:00:00.000Z",
  updatedAt: "2026-07-13T00:00:00.000Z",
};

const ANTHROPIC_PROVIDER = {
  id: "cred-2",
  kind: "anthropic" as const,
  label: "Prod Anthropic",
  hasKey: true,
  createdAt: "2026-07-13T00:00:00.000Z",
  updatedAt: "2026-07-13T00:00:00.000Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.listProviders).mockResolvedValue([SUBSCRIPTION_PROVIDER]);
  vi.mocked(api.getAssistantAuthStatus).mockResolvedValue(SIGNED_OUT);
});

describe("ProvidersSection — per-credential settings open in a modal", () => {
  test("editing a credential opens a dialog rather than an inline form", async () => {
    vi.mocked(api.listProviders).mockResolvedValue([ANTHROPIC_PROVIDER]);

    renderSection();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    fireEvent.click(await screen.findByRole("button", { name: /edit prod anthropic/i }));

    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("Edit Prod Anthropic");
    expect(screen.getByLabelText("API key")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Update credential" })).toBeInTheDocument();
  });

  test("adding a credential opens the dialog with the create affordance", async () => {
    renderSection();

    fireEvent.click(await screen.findByRole("button", { name: /add credential/i }));

    expect(await screen.findByRole("dialog")).toHaveTextContent("New credential");
    expect(screen.getByRole("button", { name: "Save credential" })).toBeInTheDocument();
  });
});

describe("ProvidersSection — claude_subscription (WP 0.3)", () => {
  test("the modal hides the API key field and shows 'Not signed in'", async () => {
    renderSection();

    fireEvent.click(await screen.findByRole("button", { name: /edit my claude subscription/i }));

    expect(await screen.findByText("Not signed in")).toBeInTheDocument();
    expect(screen.queryByLabelText("API key")).not.toBeInTheDocument();
  });

  test("the modal explains that the token carries no account identity", async () => {
    renderSection();

    fireEvent.click(await screen.findByRole("button", { name: /edit my claude subscription/i }));

    expect(await screen.findByText(/which account is this\?/i)).toBeInTheDocument();
    expect(screen.getByText(/scopes those tokens to inference only/i)).toBeInTheDocument();
  });

  test("sign-in can be started from the modal — no trip to another section", async () => {
    vi.mocked(api.startAssistantOauth).mockResolvedValue({
      flowId: "flow-1",
      authUrl: "https://claude.ai/oauth/authorize?state=abc",
    });

    renderSection();
    fireEvent.click(await screen.findByRole("button", { name: /edit my claude subscription/i }));
    fireEvent.click(await screen.findByRole("button", { name: /^sign in with claude$/i }));

    expect(
      await screen.findByText("https://claude.ai/oauth/authorize?state=abc"),
    ).toBeInTheDocument();
    expect(api.startAssistantOauth).toHaveBeenCalledTimes(1);
  });

  test("resetting the token confirms first, then signs out and flips the row badge", async () => {
    vi.mocked(api.getAssistantAuthStatus).mockResolvedValue(SIGNED_IN);
    vi.mocked(api.signOutAssistant).mockResolvedValue(SIGNED_OUT);

    renderSection();
    expect(await screen.findByText("signed in")).toBeInTheDocument();

    fireEvent.click(await screen.findByRole("button", { name: /edit my claude subscription/i }));
    fireEvent.click(await screen.findByRole("button", { name: /^reset token$/i }));

    // Destructive → a confirm step, never a bare click-through.
    expect(await screen.findByText(/reset the stored claude token\?/i)).toBeInTheDocument();
    expect(api.signOutAssistant).not.toHaveBeenCalled();

    const confirms = screen.getAllByRole("button", { name: /^reset token$/i });
    fireEvent.click(confirms[confirms.length - 1] as HTMLElement);

    await waitFor(() => expect(api.signOutAssistant).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("not signed in")).toBeInTheDocument();
  });

  test("the credential row shows a sign-in-state badge, not the misleading 'no key' badge", async () => {
    renderSection();

    expect(await screen.findByText("not signed in")).toBeInTheDocument();
    expect(screen.queryByText("no key")).not.toBeInTheDocument();
  });
});
