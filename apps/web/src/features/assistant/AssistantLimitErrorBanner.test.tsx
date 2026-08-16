import type { ComponentProps } from "react";
import { MemoryRouter } from "react-router-dom";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import type { AssistantAuthStatus } from "@mcp-token-footprint/shared";
import { AssistantLimitErrorBanner } from "./AssistantLimitErrorBanner";

// WP 3.3 (D-AS14) — the terminal limit-error banner: retry-on-other-source (only when configured),
// a Settings link otherwise, and an auth-kind re-sign-in/re-check hint. Non-interactive (historical)
// turns render message-only, no actions.

const SIGNED_IN_NO_FALLBACK: AssistantAuthStatus = {
  signedIn: true,
  fallbackConfigured: false,
  models: [],
};
const SIGNED_IN_WITH_FALLBACK: AssistantAuthStatus = {
  signedIn: true,
  fallbackConfigured: true,
  models: [],
};

function renderBanner(props: Partial<ComponentProps<typeof AssistantLimitErrorBanner>> = {}) {
  const onRetry = vi.fn();
  render(
    <MemoryRouter>
      <AssistantLimitErrorBanner
        message="Usage limit reached"
        source="subscription"
        authStatus={SIGNED_IN_NO_FALLBACK}
        interactive
        retrying={false}
        onRetry={onRetry}
        {...props}
      />
    </MemoryRouter>,
  );
  return { onRetry };
}

describe("AssistantLimitErrorBanner", () => {
  test("interactive + fallback NOT configured: shows a link to Settings, no retry button", () => {
    renderBanner({ source: "subscription", authStatus: SIGNED_IN_NO_FALLBACK });
    expect(screen.getByText("Usage limit reached")).toBeInTheDocument();
    const link = screen.getByRole("link", { name: /configure api key in settings/i });
    expect(link).toHaveAttribute("href", "/settings");
    expect(screen.queryByRole("button", { name: /retry on/i })).not.toBeInTheDocument();
  });

  test("interactive + fallback configured: a one-click Retry on API key button fires onRetry('api_key')", () => {
    const { onRetry } = renderBanner({
      source: "subscription",
      authStatus: SIGNED_IN_WITH_FALLBACK,
    });
    const button = screen.getByRole("button", { name: /retry on api key/i });
    expect(button).toBeEnabled();
    fireEvent.click(button);
    expect(onRetry).toHaveBeenCalledWith("api_key");
  });

  test("source api_key + signed in: offers Retry on subscription", () => {
    const { onRetry } = renderBanner({
      source: "api_key",
      authStatus: { signedIn: true, fallbackConfigured: true, models: [] },
    });
    const button = screen.getByRole("button", { name: /retry on subscription/i });
    fireEvent.click(button);
    expect(onRetry).toHaveBeenCalledWith("subscription");
  });

  test("source api_key + NOT signed in: no retry button, links to Settings instead", () => {
    renderBanner({
      source: "api_key",
      authStatus: { signedIn: false, fallbackConfigured: true, models: [] },
    });
    expect(
      screen.queryByRole("button", { name: /retry on subscription/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /configure subscription in settings/i }),
    ).toBeInTheDocument();
  });

  test("retrying=true disables the button and shows a busy label (no double-send)", () => {
    renderBanner({ source: "subscription", authStatus: SIGNED_IN_WITH_FALLBACK, retrying: true });
    const button = screen.getByRole("button", { name: /retrying/i });
    expect(button).toBeDisabled();
  });

  test("kind=auth + subscription: shows a re-sign-in hint", () => {
    renderBanner({ source: "subscription", kind: "auth", authStatus: SIGNED_IN_WITH_FALLBACK });
    expect(screen.getByText(/sign in again in settings/i)).toBeInTheDocument();
  });

  test("kind=auth + api_key: shows a check-the-key hint, not a re-sign-in one", () => {
    renderBanner({ source: "api_key", kind: "auth", authStatus: SIGNED_IN_WITH_FALLBACK });
    expect(screen.getByText(/check it in settings/i)).toBeInTheDocument();
    expect(screen.queryByText(/sign in again/i)).not.toBeInTheDocument();
  });

  test("kind=rate_limit: no re-sign-in/re-check hint at all", () => {
    renderBanner({
      source: "subscription",
      kind: "rate_limit",
      authStatus: SIGNED_IN_WITH_FALLBACK,
    });
    expect(screen.queryByText(/sign in again/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/check it in settings/i)).not.toBeInTheDocument();
  });

  test("non-interactive (historical) turn: message only — no actions, no hints, no auth-status dependency", () => {
    renderBanner({ interactive: false, kind: "auth", authStatus: null });
    expect(screen.getByText("Usage limit reached")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.queryByText(/sign in again/i)).not.toBeInTheDocument();
  });

  test("authStatus still loading (null): interactive turn falls back to the Settings-link path", () => {
    renderBanner({ interactive: true, authStatus: null });
    expect(
      screen.getByRole("link", { name: /configure api key in settings/i }),
    ).toBeInTheDocument();
  });
});
