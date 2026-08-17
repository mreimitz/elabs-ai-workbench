import type { ComponentProps } from "react";
import { MemoryRouter } from "react-router-dom";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

// model-identity WP 4.1 — the banner's "retry with a different model" field is now the shared
// `HubModelPicker`, which composes `@elabs-ai/components-ai`'s ModelSelector; stub the barrel like every other hub
// suite does so jsdom never loads xyflow/monaco/shiki (see `test-support/brand-ai-mock.tsx`).
vi.mock("@elabs-ai/components-ai", () => import("./test-support/brand-ai-mock"));

import { HubLimitErrorBanner } from "./HubLimitErrorBanner";
import type { HubModelOption } from "./use-hub-models";

// WP4.3 (D-AH17/R-SES11) — the hub's terminal limit-error banner: retry-on-other-source, but only for a
// source with an actual credential in the live roster; a link to Settings otherwise. An "other_model"
// retry offers an inline picker over the whole roster. Non-interactive (historical) turns render
// message-only, no actions — mirrors the Assistant dock's `AssistantLimitErrorBanner` (D-AS14).
//
// model-identity WP 4.3 (D-MI1) — every `onRetry` now carries the whole roster ROW (model AND
// credential). Until this WP it carried a bare model id, and THIS SUITE ASSERTED THAT: the "Retry on
// subscription" test expected `onRetry("subscription", "claude-sonnet-5")` and passed, while the
// retry itself went out with no credential and the API's `claude*` → `anthropic` name heuristic put
// it straight back on the metered key. A bare id can never express which of two byte-identical
// twins was meant, so the assertions below check the CREDENTIAL, not just that a retry fired.

const SUBSCRIPTION_SONNET: HubModelOption = {
  modelId: "claude-sonnet-5",
  kind: "claude_subscription",
  credentialId: "sub-1",
  credentialLabel: "Claude Max",
  displayName: "Sonnet",
};
const OPENAI_GPT5: HubModelOption = {
  modelId: "gpt-5",
  kind: "openai",
  credentialId: "cred-openai",
  credentialLabel: "OpenAI",
};
const ROSTER: HubModelOption[] = [SUBSCRIPTION_SONNET, OPENAI_GPT5];

function renderBanner(props: Partial<ComponentProps<typeof HubLimitErrorBanner>> = {}) {
  const onRetry = vi.fn();
  render(
    <MemoryRouter>
      <HubLimitErrorBanner
        message="You've hit the usage limit for this session."
        retrySources={["api_key", "other_model"]}
        currentModel="claude-sonnet-5"
        roster={ROSTER}
        interactive
        retrying={false}
        onRetry={onRetry}
        {...props}
      />
    </MemoryRouter>,
  );
  return { onRetry };
}

describe("HubLimitErrorBanner", () => {
  test("api_key offered + a non-subscription credential exists: a one-click Retry on API key button fires onRetry with that credential's row", () => {
    const { onRetry } = renderBanner({
      retrySources: ["api_key"],
      currentCredentialId: "sub-1",
    });
    const button = screen.getByRole("button", { name: /retry on api key/i });
    expect(button).toBeEnabled();
    fireEvent.click(button);
    // The whole row — a bare "gpt-5" is what used to be sent, and it cannot say WHICH credential.
    expect(onRetry).toHaveBeenCalledWith("api_key", OPENAI_GPT5);
  });

  test("subscription offered: Retry on subscription fires onRetry with the SUBSCRIPTION credential", () => {
    const { onRetry } = renderBanner({
      retrySources: ["subscription"],
      currentModel: "gpt-5",
      currentCredentialId: "cred-openai",
    });
    fireEvent.click(screen.getByRole("button", { name: /retry on subscription/i }));
    expect(onRetry).toHaveBeenCalledWith("subscription", SUBSCRIPTION_SONNET);
  });

  test("THE defect (README §1 row 14): with a byte-identical colliding id, Retry on subscription does NOT land on the metered twin", () => {
    const meteredSonnet: HubModelOption = {
      modelId: "claude-sonnet-5",
      kind: "anthropic",
      credentialId: "cred-metered",
      credentialLabel: "Work key",
      displayName: "Claude Sonnet 5",
    };
    const { onRetry } = renderBanner({
      retrySources: ["subscription"],
      // The failing turn: the metered key's `claude-sonnet-5`.
      currentModel: "claude-sonnet-5",
      currentCredentialId: "cred-metered",
      roster: [meteredSonnet, SUBSCRIPTION_SONNET],
    });
    fireEvent.click(screen.getByRole("button", { name: /retry on subscription/i }));
    const [, target] = onRetry.mock.calls[0] as [string, HubModelOption];
    // Same model id on BOTH rows, so the id alone proves nothing — the credential is the assertion.
    expect(target.modelId).toBe("claude-sonnet-5");
    expect(target.credentialId).toBe("sub-1");
    expect(target.credentialId).not.toBe("cred-metered");
  });

  test("the button states, in words, exactly which model on which credential it will run", () => {
    renderBanner({ retrySources: ["subscription"], currentModel: "gpt-5" });
    // "the operator picks one thing and gets another" is only checkable if the app says what it will do.
    expect(screen.getByText(/Runs Sonnet \(claude-sonnet-5\) on Claude Max\./)).toBeVisible();
  });

  test("a direct source with NO matching roster credential: a Settings link, no retry button", () => {
    renderBanner({ retrySources: ["subscription"], roster: [OPENAI_GPT5] });
    const link = screen.getByRole("link", { name: /configure subscription in settings/i });
    expect(link).toHaveAttribute("href", "/settings");
    expect(
      screen.queryByRole("button", { name: /retry on subscription/i }),
    ).not.toBeInTheDocument();
  });

  test("a direct source whose credential EXISTS but is unusable reads as broken, not as unconfigured, with its reason", () => {
    renderBanner({
      retrySources: ["subscription"],
      roster: [OPENAI_GPT5],
      unavailable: [
        {
          credentialId: "sub-1",
          kind: "claude_subscription",
          label: "Claude Max",
          reason: "This credential's authentication is broken — reconnect it in Settings.",
        },
      ],
    });
    // D-MI9 posture: never silently fall through to the other source, and never claim the source is
    // simply "not configured" when it is configured and broken.
    expect(
      screen.getByRole("link", { name: /fix claude max in settings to retry/i }),
    ).toHaveAttribute("href", "/settings");
    expect(screen.getByText(/This credential's authentication is broken/)).toBeVisible();
    expect(
      screen.queryByRole("button", { name: /retry on subscription/i }),
    ).not.toBeInTheDocument();
  });

  // model-identity WP 4.1 (D-MI7) — the inline field is the shared `HubModelPicker` now, not a
  // `Select`. The Select had to collapse colliding twins (an option's `value` IS the model id), which
  // dropped the row an operator most wants after a metered limit error: the subscription twin.
  test("other_model offered: an inline picker lists the roster; choosing one fires onRetry with that row", async () => {
    const { onRetry } = renderBanner({ retrySources: ["other_model"] });
    fireEvent.click(screen.getByRole("button", { name: /retry with a different model/i }));
    fireEvent.click(await screen.findByRole("button", { name: /gpt-5/ }));
    expect(onRetry).toHaveBeenCalledWith("other_model", OPENAI_GPT5);
  });

  test("a model id shared by two credentials keeps BOTH rows, and the retry targets the one CHOSEN", async () => {
    const work: HubModelOption = {
      modelId: "claude-sonnet-5",
      kind: "anthropic",
      credentialId: "c-work",
      credentialLabel: "Work key",
      displayName: "Claude Sonnet 5",
    };
    const personal: HubModelOption = {
      modelId: "claude-sonnet-5",
      kind: "anthropic",
      credentialId: "c-personal",
      credentialLabel: "Personal key",
      displayName: "Claude Sonnet 5",
    };
    const { onRetry } = renderBanner({
      retrySources: ["other_model"],
      currentModel: "gpt-5",
      roster: [work, personal],
    });
    fireEvent.click(screen.getByRole("button", { name: /retry with a different model/i }));
    const palette = within(await screen.findByTestId("model-selector-content"));
    // Two DIFFERENT rows for one model id — the `Select` this replaced showed exactly one. Both are
    // `anthropic`, so the CREDENTIAL LABEL is the only thing that tells them apart: the carry-forward
    // finding "same-kind credentials are visually indistinguishable", closed.
    expect(palette.getByRole("button", { name: /Claude Sonnet 5.*Work key/ })).toBeVisible();
    fireEvent.click(palette.getByRole("button", { name: /Claude Sonnet 5.*Personal key/ }));
    // Two credentials of the SAME kind: the retry has to name the one the operator clicked.
    expect(onRetry).toHaveBeenCalledWith("other_model", personal);
  });

  test("retrying=true disables the retry button (no double-send)", () => {
    renderBanner({ retrySources: ["api_key"], retrying: true });
    const button = screen.getByRole("button", { name: /retrying/i });
    expect(button).toBeDisabled();
  });

  test("non-interactive (historical) turn: message only — no buttons, no links, no picker", () => {
    renderBanner({ interactive: false });
    expect(screen.getByText("You've hit the usage limit for this session.")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });

  test("no retrySources at all: just the message, no actions", () => {
    renderBanner({ retrySources: [] });
    expect(screen.getByText("You've hit the usage limit for this session.")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });
});
