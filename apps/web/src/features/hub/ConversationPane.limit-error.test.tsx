// Assistant Hub (WP4.3, D-AH17/R-SES11) — the limit-error banner's LIVE wiring inside `ConversationPane`:
// the trailing turn's `limit_error` renders an actionable retry (not just inert text), and clicking it
// resends the turn's original user text on the SAME session with the chosen model as a per-message
// override. A separate file from `ConversationPane.regenerate.test.tsx` (mirrors that split) so this
// suite's `listProviders`/`listProviderModels` mocking (the live roster `TrailingLimitErrorTurn` fetches)
// doesn't leak into the other suites' module graph.
import type { HubEvent, HubSession, ProviderCredential } from "@mcp-token-footprint/shared";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("@brand/ai", () => import("./test-support/brand-ai-mock"));

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return {
    ...actual,
    sendHubMessage: vi.fn(),
    openHubSessionStream: vi.fn(() => () => undefined),
    listProviders: vi.fn(),
    listProviderModels: vi.fn(),
  };
});

// model-identity WP 4.3 — a refused retry must be SURFACED, not swallowed and not quietly re-aimed at
// the other source. `notifyError` also writes into a `role="alert"` live region, which would collide
// with the `Alert` this very banner renders, so observe the call itself.
vi.mock("../../lib/notify", () => ({ notifyError: vi.fn() }));

import * as api from "../../lib/api";
import { notifyError } from "../../lib/notify";
import { ConversationPane } from "./ConversationPane";
import type { ConversationStream } from "./ConversationPane";
import { buildHubTimeline, type HubStreamState } from "./use-hub-stream";

function session(overrides: Partial<HubSession> = {}): HubSession {
  return {
    id: "s1",
    kind: "chat",
    title: "Untitled session",
    titleState: "pending",
    mode: "chat",
    model: "claude-sonnet-5",
    status: "completed",
    costUsd: 0,
    tokensIn: 0,
    tokensOut: 0,
    createdAt: "2026-07-17T12:00:00.000Z",
    updatedAt: "2026-07-17T12:00:00.000Z",
    seen: true,
    ...overrides,
  };
}

function credential(overrides: Partial<ProviderCredential> = {}): ProviderCredential {
  return {
    id: "cred-1",
    kind: "openai",
    label: "OpenAI",
    hasKey: true,
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    ...overrides,
  };
}

function baseState(events: HubEvent[]): HubStreamState {
  return {
    events,
    deltaText: {},
    deltaReasoning: {},
    liveMessageId: null,
    turnRunning: false,
    phase: null,
    queuePosition: null,
    phaseDeadlineAt: null,
    waitingReason: null,
    error: null,
    authRequired: false,
    pendingElicitation: null,
    openQuestions: [],
  };
}

function streamFromEvents(
  events: HubEvent[],
  overrides: Partial<ConversationStream> = {},
): ConversationStream {
  const state = baseState(events);
  return {
    ...state,
    timeline: buildHubTimeline(state),
    tasks: [],
    pendingQueued: [],
    ...overrides,
  };
}

const LIMIT_ERROR_EVENTS: HubEvent[] = [
  { type: "user_message", messageId: "u1", text: "Summarize the last scan.", seq: 1 },
  {
    type: "limit_error",
    message: "You've hit the rate limit for this provider.",
    retrySources: ["api_key", "other_model"],
    limitKind: "rate_limit",
    provider: "claude_subscription",
    seq: 2,
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.listProviders).mockResolvedValue([credential()]);
  vi.mocked(api.listProviderModels).mockResolvedValue({
    source: "provider",
    models: [{ id: "gpt-5" }],
  });
});

describe("ConversationPane — limit-error retry (WP4.3, D-AH17/R-SES11)", () => {
  test("a trailing limit_error renders an actionable Retry button (not just inert text)", async () => {
    render(
      <MemoryRouter>
        <ConversationPane
          stream={streamFromEvents(LIMIT_ERROR_EVENTS)}
          session={session()}
          onStarterSelect={vi.fn()}
        />
      </MemoryRouter>,
    );
    expect(await screen.findByRole("button", { name: /retry on api key/i })).toBeInTheDocument();
  });

  test("clicking Retry on API key resends the ORIGINAL user text on the SAME session with the model override AND its credential", async () => {
    vi.mocked(api.sendHubMessage).mockResolvedValue({
      sessionId: "s1",
      streamUrl: "/api/hub/sessions/s1/stream",
    });
    render(
      <MemoryRouter>
        <ConversationPane
          stream={streamFromEvents(LIMIT_ERROR_EVENTS)}
          session={session()}
          onStarterSelect={vi.fn()}
        />
      </MemoryRouter>,
    );

    const button = await screen.findByRole("button", { name: /retry on api key/i });
    fireEvent.click(button);

    await waitFor(() =>
      // model-identity WP 4.3 (D-MI1): `providerCredentialId` is the whole point. Until this WP the
      // body was `{ text, model }` and the API re-derived a provider from the model NAME — which is
      // how "retry on the other source" ended up on the source that had just refused the turn.
      expect(api.sendHubMessage).toHaveBeenCalledWith("s1", {
        text: "Summarize the last scan.",
        model: "gpt-5",
        providerCredentialId: "cred-1",
      }),
    );
  });

  test("no session prop -> the banner still renders the message, but no retry action (honest not-yet-actionable gate)", () => {
    render(
      <MemoryRouter>
        <ConversationPane stream={streamFromEvents(LIMIT_ERROR_EVENTS)} onStarterSelect={vi.fn()} />
      </MemoryRouter>,
    );
    expect(screen.getByText("You've hit the rate limit for this provider.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /retry on/i })).not.toBeInTheDocument();
  });

  test("an EARLIER (non-trailing) limit_error renders message-only, no retry action", () => {
    const events: HubEvent[] = [
      ...LIMIT_ERROR_EVENTS,
      { type: "user_message", messageId: "u2", text: "Try again.", seq: 3 },
      {
        type: "assistant_message",
        messageId: "m2",
        model: "gpt-5",
        parts: [{ type: "text", text: "Here you go." }],
        citations: [],
        artifactsTouched: [],
        seq: 4,
      },
      { type: "turn_done", messageId: "m2", seq: 5 },
    ];
    render(
      <MemoryRouter>
        <ConversationPane
          stream={streamFromEvents(events)}
          session={session()}
          onStarterSelect={vi.fn()}
        />
      </MemoryRouter>,
    );
    expect(screen.getByText("You've hit the rate limit for this provider.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /retry on/i })).not.toBeInTheDocument();
  });
});

// ── model-identity WP 4.3 (D-MI1/D-MI9) ─────────────────────────────────────────────────────────────
// The retry now carries PROVIDER IDENTITY to the wire, not a source label plus a bare model id. These
// assert what actually reaches `POST /api/hub/sessions/:id/messages` — the hop that used to drop the
// operator's choice — for the three cases a bare id cannot express.

/** Roster fan-out: one credential list + a per-credential `/models` response. */
function mockRoster(entries: { credential: ProviderCredential; models: { id: string }[] }[]): void {
  vi.mocked(api.listProviders).mockResolvedValue(entries.map((entry) => entry.credential));
  vi.mocked(api.listProviderModels).mockImplementation(async (credentialId: string) => ({
    source: "provider" as const,
    models: entries.find((entry) => entry.credential.id === credentialId)?.models ?? [],
  }));
}

const SUBSCRIPTION_LIMIT_EVENTS: HubEvent[] = [
  { type: "user_message", messageId: "u1", text: "Summarize the last scan.", seq: 1 },
  {
    type: "limit_error",
    message: "Your credit balance is too low to access the Anthropic API.",
    // The metered kind offers the SUBSCRIPTION (`retrySourcesFor`, turn-engine.ts).
    retrySources: ["subscription", "other_model"],
    limitKind: "rate_limit",
    provider: "anthropic",
    seq: 2,
  },
];

describe("ConversationPane — the retry actually switches source (model-identity WP 4.3)", () => {
  test("THE defect: a metered `claude-sonnet-5` limit retries the SUBSCRIPTION twin — same id, other credential", async () => {
    // Both credentials expose the byte-identical `claude-sonnet-5` (the subscription roster emits
    // Anthropic's canonical ids on purpose — README §1). So `model` alone cannot possibly say which
    // one was meant, and the server's `claude*` → `anthropic` heuristic always picked the metered key.
    mockRoster([
      {
        credential: credential({ id: "cred-api", kind: "anthropic", label: "Anthropic key" }),
        models: [{ id: "claude-sonnet-5" }],
      },
      {
        credential: credential({
          id: "cred-sub",
          kind: "claude_subscription",
          label: "Claude Max",
        }),
        models: [{ id: "claude-sonnet-5" }],
      },
    ]);
    vi.mocked(api.sendHubMessage).mockResolvedValue({
      sessionId: "s1",
      streamUrl: "/api/hub/sessions/s1/stream",
    });

    render(
      <MemoryRouter>
        <ConversationPane
          stream={streamFromEvents(SUBSCRIPTION_LIMIT_EVENTS)}
          session={session({ model: "claude-sonnet-5", providerCredentialId: "cred-api" })}
          onStarterSelect={vi.fn()}
        />
      </MemoryRouter>,
    );

    fireEvent.click(await screen.findByRole("button", { name: /retry on subscription/i }));

    await waitFor(() =>
      expect(api.sendHubMessage).toHaveBeenCalledWith("s1", {
        text: "Summarize the last scan.",
        // `model` stays byte-identical (D-MI1 — frozen wire); the credential is what changed.
        model: "claude-sonnet-5",
        providerCredentialId: "cred-sub",
      }),
    );
  });

  test("two credentials of the SAME kind: the retry runs on the one the operator picked, not the first one", async () => {
    mockRoster([
      {
        credential: credential({ id: "c-work", kind: "anthropic", label: "Work key" }),
        models: [{ id: "claude-sonnet-5" }],
      },
      {
        credential: credential({ id: "c-personal", kind: "anthropic", label: "Personal key" }),
        models: [{ id: "claude-sonnet-5" }],
      },
    ]);
    vi.mocked(api.sendHubMessage).mockResolvedValue({
      sessionId: "s1",
      streamUrl: "/api/hub/sessions/s1/stream",
    });

    render(
      <MemoryRouter>
        <ConversationPane
          stream={streamFromEvents([
            { type: "user_message", messageId: "u1", text: "Summarize the last scan.", seq: 1 },
            {
              type: "limit_error",
              message: "You've hit the rate limit for this provider.",
              retrySources: ["other_model"],
              seq: 2,
            },
          ])}
          session={session({ model: "claude-sonnet-5", providerCredentialId: "c-work" })}
          onStarterSelect={vi.fn()}
        />
      </MemoryRouter>,
    );

    fireEvent.click(await screen.findByRole("button", { name: /retry with a different model/i }));
    const palette = within(await screen.findByTestId("model-selector-content"));
    fireEvent.click(palette.getByRole("button", { name: /claude-sonnet-5.*Personal key/ }));

    await waitFor(() =>
      expect(api.sendHubMessage).toHaveBeenCalledWith("s1", {
        text: "Summarize the last scan.",
        model: "claude-sonnet-5",
        providerCredentialId: "c-personal",
      }),
    );
  });

  test("a REFUSED retry (the D-MI9 409) is surfaced by name and never silently re-aimed at the other source", async () => {
    mockRoster([
      {
        credential: credential({ id: "cred-api", kind: "anthropic", label: "Anthropic key" }),
        models: [{ id: "claude-sonnet-5" }],
      },
      {
        credential: credential({
          id: "cred-sub",
          kind: "claude_subscription",
          label: "Claude Max",
        }),
        models: [{ id: "claude-sonnet-5" }],
      },
    ]);
    vi.mocked(api.sendHubMessage).mockRejectedValue(
      new api.ApiError(
        409,
        'The provider credential "cred-sub" pinned for model "claude-sonnet-5" can no longer be used.',
      ),
    );

    render(
      <MemoryRouter>
        <ConversationPane
          stream={streamFromEvents(SUBSCRIPTION_LIMIT_EVENTS)}
          session={session({ model: "claude-sonnet-5", providerCredentialId: "cred-api" })}
          onStarterSelect={vi.fn()}
        />
      </MemoryRouter>,
    );

    fireEvent.click(await screen.findByRole("button", { name: /retry on subscription/i }));

    await waitFor(() =>
      expect(notifyError).toHaveBeenCalledWith(
        "Couldn’t retry on the subscription (Claude Max)",
        expect.objectContaining({
          description: expect.stringContaining('The provider credential "cred-sub"'),
        }),
      ),
    );
    // The refusal stops here. Re-picking the metered key "so something happens" is exactly the silent
    // substitution this whole workstream exists to remove (D-MI9: fail honestly, never re-guess).
    expect(api.sendHubMessage).toHaveBeenCalledTimes(1);
    expect(api.sendHubMessage).toHaveBeenCalledWith("s1", {
      text: "Summarize the last scan.",
      model: "claude-sonnet-5",
      providerCredentialId: "cred-sub",
    });
  });

  test("a credential that is CONFIGURED BUT BROKEN reads as broken — no dead retry, no 'not configured' lie", async () => {
    mockRoster([
      {
        credential: credential({ id: "cred-api", kind: "anthropic", label: "Anthropic key" }),
        models: [{ id: "claude-sonnet-5" }],
      },
      {
        credential: credential({
          id: "cred-sub",
          kind: "claude_subscription",
          label: "Claude Max",
          authBroken: true,
        }),
        models: [{ id: "claude-sonnet-5" }],
      },
    ]);

    render(
      <MemoryRouter>
        <ConversationPane
          stream={streamFromEvents(SUBSCRIPTION_LIMIT_EVENTS)}
          session={session({ model: "claude-sonnet-5", providerCredentialId: "cred-api" })}
          onStarterSelect={vi.fn()}
        />
      </MemoryRouter>,
    );

    expect(
      await screen.findByRole("link", { name: /fix claude max in settings to retry/i }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /retry on subscription/i }),
    ).not.toBeInTheDocument();
    expect(api.sendHubMessage).not.toHaveBeenCalled();
  });
});
