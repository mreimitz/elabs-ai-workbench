import type {
  HubSendMessageInput,
  HubSession,
  SessionCapabilities,
  Skill,
} from "@mcp-token-footprint/shared";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("@elabs-ai/components-ai", () => import("./test-support/brand-ai-mock"));

// hub-fixes WP6.2 — spy on `toast` (kept otherwise real, mirrors the `../../lib/api` partial-mock
// pattern below) so the mode chip's rejected-switch path can assert a failure is actually SURFACED,
// never a silent revert (interaction-guidelines.md's "never a silent failure").
vi.mock("@elabs-ai/components-ui", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@elabs-ai/components-ui")>();
  return { ...actual, toast: { ...actual.toast, error: vi.fn(), success: vi.fn() } };
});

// WP2.5 — `ComposerCommands.tsx`'s catalog hook calls these; every test below that never opens the
// slash menu never triggers them (the fetch is lazy — see `useComposerCommandCatalog`'s own doc), so
// the pre-WP2.5 tests are unaffected by this mock existing at all.
// WP3.4 — `uploadHubFile` likewise: every test that never attaches a file never calls it.
// hub-fixes WP6.2 — `updateHubSession` likewise: every test that never opens/uses the mode chip never
// calls it (`SessionModeChip` owns this PATCH directly — see `Composer.tsx`'s doc for why).
vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return {
    ...actual,
    listSkills: vi.fn(),
    listServers: vi.fn(),
    uploadHubFile: vi.fn(),
    updateHubSession: vi.fn(),
  };
});

import { toast } from "@elabs-ai/components-ui";
import * as api from "../../lib/api";
import {
  Composer,
  dataUrlToFile,
  switchableSessionModes,
  withPlanFirstDirective,
} from "./Composer";
import type { HubModelOption } from "./use-hub-models";

function skill(overrides: Partial<Skill> = {}): Skill {
  return {
    id: "sk1",
    name: "graphify",
    displayName: "Graphify",
    slug: "graphify",
    sourceType: "upload",
    versionCount: 1,
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.listSkills).mockResolvedValue([]);
  vi.mocked(api.listServers).mockResolvedValue([]);
});

function session(overrides: Partial<HubSession> = {}): HubSession {
  return {
    id: "s1",
    kind: "chat",
    title: "Untitled session",
    titleState: "pending",
    mode: "chat",
    model: "claude-sonnet-5",
    status: "running",
    costUsd: 0,
    tokensIn: 0,
    tokensOut: 0,
    createdAt: "2026-07-17T12:00:00.000Z",
    updatedAt: "2026-07-17T12:00:00.000Z",
    seen: true,
    ...overrides,
  };
}

// A complete, valid capability manifest (mirrors the API's AI-SDK default) so a test can flip a single
// facet — here `followUps` — that the composer's merged Send↔Stop control gates on.
function capabilities(overrides: Partial<SessionCapabilities> = {}): SessionCapabilities {
  return {
    liveText: true,
    liveReasoning: "raw",
    toolCalls: true,
    contextWindow: true,
    tokens: "exact",
    costBasis: "api_exact",
    followUps: true,
    askUser: true,
    ...overrides,
  };
}

const MODELS: HubModelOption[] = [
  { modelId: "claude-sonnet-5", kind: "anthropic", credentialId: "c1" },
  { modelId: "gpt-5", kind: "openai", credentialId: "c2" },
];

// model-identity WP 3.1 (D-MI8) — the owner's real rosters: `claude-sonnet-5` is byte-identical across
// the metered `anthropic` credential and the `claude_subscription` one, distinguishable only by their
// display names + credentials.
const COLLIDING_MODELS: HubModelOption[] = [
  {
    modelId: "claude-sonnet-5",
    kind: "anthropic",
    credentialId: "c-api",
    displayName: "Claude Sonnet 5",
  },
  {
    modelId: "claude-sonnet-5",
    kind: "claude_subscription",
    credentialId: "c-sub",
    displayName: "Sonnet",
  },
];

// The composer input is now a contenteditable MentionEditor (role="textbox", data-testid), not a
// textarea — set its content + fire `input` (the editor serializes its DOM), then submit the form.
function getEditor(): HTMLElement {
  return screen.getByTestId("mention-editor");
}
function setComposerText(text: string): HTMLElement {
  const editor = getEditor();
  editor.textContent = text;
  fireEvent.input(editor);
  return editor;
}
function typeAndSubmit(text: string): void {
  const editor = setComposerText(text);
  fireEvent.submit(editor.closest("form") as HTMLFormElement);
}

describe("Composer", () => {
  test("submitting while idle calls onSend with the typed text", async () => {
    const onSend = vi
      .fn<(input: HubSendMessageInput) => Promise<void>>()
      .mockResolvedValue(undefined);
    render(
      <Composer
        session={session({ status: "completed" })}
        turnRunning={false}
        onSend={onSend}
        onStop={vi.fn()}
        models={MODELS}
        modelsLoading={false}
        autonomy="threshold"
        onAutonomyChange={vi.fn()}
      />,
    );
    typeAndSubmit("What tools does this server expose?");
    await waitFor(() =>
      expect(onSend).toHaveBeenCalledWith({ text: "What tools does this server expose?" }),
    );
  });

  test("R-SES3 — submitting WHILE a turn is running is allowed (queues); the merged control stops when empty", async () => {
    const onSend = vi
      .fn<(input: HubSendMessageInput) => Promise<void>>()
      .mockResolvedValue(undefined);
    const onStop = vi.fn();
    render(
      <Composer
        session={session()}
        turnRunning
        onSend={onSend}
        onStop={onStop}
        models={MODELS}
        modelsLoading={false}
        autonomy="threshold"
        onAutonomyChange={vi.fn()}
      />,
    );

    // The input is never disabled while running — R-SES3's whole point is that it stays usable.
    expect(getEditor()).toHaveAttribute("contenteditable", "true");

    typeAndSubmit("also check server B");
    await waitFor(() => expect(onSend).toHaveBeenCalledWith({ text: "also check server B" }));

    // The composer clears after the queued send, so the merged action is Stop again — clicking it
    // stops the running turn and NEVER submits.
    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    expect(onStop).toHaveBeenCalledTimes(1);
    expect(onSend).toHaveBeenCalledTimes(1); // Stop didn't also submit
  });

  test("owner-feedback — the single Send↔Stop control: Stop while running & empty, Send once a follow-up is typed", () => {
    render(
      <Composer
        session={session()}
        turnRunning
        onSend={vi.fn()}
        onStop={vi.fn()}
        models={MODELS}
        modelsLoading={false}
        autonomy="threshold"
        onAutonomyChange={vi.fn()}
      />,
    );

    // Running + empty → the action slot is Stop (there is no separate Send button competing with it).
    expect(screen.getByRole("button", { name: "Stop" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Send message" })).not.toBeInTheDocument();

    // Typing a follow-up flips the SAME control back to Send (the session allows queuing while live).
    setComposerText("also check server B");
    expect(screen.getByRole("button", { name: "Send message" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Stop" })).not.toBeInTheDocument();

    // Clearing it again returns to Stop.
    setComposerText("");
    expect(screen.getByRole("button", { name: "Stop" })).toBeInTheDocument();
  });

  test("owner-feedback — a session that can't take follow-ups keeps Stop even while typing (no queue)", () => {
    render(
      <Composer
        session={session({ capabilities: capabilities({ followUps: false }) })}
        turnRunning
        onSend={vi.fn()}
        onStop={vi.fn()}
        models={MODELS}
        modelsLoading={false}
        autonomy="threshold"
        onAutonomyChange={vi.fn()}
      />,
    );
    // With `followUps:false` there is nothing to queue, so a typed follow-up must NOT flip Stop to Send.
    setComposerText("try to queue this");
    expect(screen.getByRole("button", { name: "Stop" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Send message" })).not.toBeInTheDocument();
  });

  test("no Stop button while idle", () => {
    render(
      <Composer
        session={session({ status: "completed" })}
        turnRunning={false}
        onSend={vi.fn()}
        onStop={vi.fn()}
        models={MODELS}
        modelsLoading={false}
        autonomy="threshold"
        onAutonomyChange={vi.fn()}
      />,
    );
    expect(screen.queryByRole("button", { name: "Stop" })).not.toBeInTheDocument();
  });

  test("R-SES10 — picking a model from the per-message override sends it on the NEXT message", async () => {
    const onSend = vi
      .fn<(input: HubSendMessageInput) => Promise<void>>()
      .mockResolvedValue(undefined);
    render(
      <Composer
        session={session({ status: "completed" })}
        turnRunning={false}
        onSend={onSend}
        onStop={vi.fn()}
        models={MODELS}
        modelsLoading={false}
        autonomy="threshold"
        onAutonomyChange={vi.fn()}
      />,
    );

    // Open the model picker (session default shown on the trigger) and switch to gpt-5.
    fireEvent.click(screen.getByRole("button", { name: /model: claude-sonnet-5/i }));
    fireEvent.click(screen.getByRole("button", { name: /^gpt-5/ }));

    typeAndSubmit("use the other model for this one");
    await waitFor(() =>
      expect(onSend).toHaveBeenCalledWith({
        text: "use the other model for this one",
        model: "gpt-5",
        // model-identity WP 3.1 (D-MI1) — the override carries the credential it was picked from,
        // so the turn cannot be re-routed by a name heuristic server-side.
        providerCredentialId: "c2",
      }),
    );
  });

  // model-identity WP 3.1 (D-MI1/D-MI8) — the per-message twin of the create-time defect. With only a
  // bare model id, a session already running on the metered `claude-sonnet-5` could not switch to the
  // SUBSCRIPTION `claude-sonnet-5`: the twin was filtered out as "the session's own model", and even if
  // it had rendered, the send would have carried an id the API re-guesses a provider for by NAME.
  test("a session pinned to one credential can still override to the SAME model id on the other", async () => {
    const onSend = vi
      .fn<(input: HubSendMessageInput) => Promise<void>>()
      .mockResolvedValue(undefined);
    render(
      <Composer
        session={session({
          status: "completed",
          model: "claude-sonnet-5",
          providerCredentialId: "c-api",
        })}
        turnRunning={false}
        onSend={onSend}
        onStop={vi.fn()}
        models={COLLIDING_MODELS}
        modelsLoading={false}
        autonomy="threshold"
        onAutonomyChange={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /model: claude-sonnet-5/i }));
    const palette = within(screen.getByTestId("model-selector-content"));
    // model-identity WP 4.1 (D-MI7) — BOTH twins are listed now (the old palette had to exclude the
    // session's own row to avoid showing it twice); the session's metered row is simply the one
    // marked current, and the subscription twin is a separate, selectable option.
    expect(palette.getByRole("button", { name: /^Claude Sonnet 5/ })).toBeVisible();
    fireEvent.click(palette.getByRole("button", { name: /^Sonnet/ }));

    typeAndSubmit("run this one on the subscription");
    await waitFor(() =>
      expect(onSend).toHaveBeenCalledWith({
        text: "run this one on the subscription",
        model: "claude-sonnet-5",
        providerCredentialId: "c-sub",
      }),
    );
  });

  // A pre-v55 session persists no credential. It must keep working exactly as before: no override
  // sends no model/credential at all, and the server falls back to its unchanged heuristic.
  test("an UNPINNED (legacy) session sends neither model nor credential when nothing is overridden", async () => {
    const onSend = vi
      .fn<(input: HubSendMessageInput) => Promise<void>>()
      .mockResolvedValue(undefined);
    render(
      <Composer
        session={session({ status: "completed" })}
        turnRunning={false}
        onSend={onSend}
        onStop={vi.fn()}
        models={COLLIDING_MODELS}
        modelsLoading={false}
        autonomy="threshold"
        onAutonomyChange={vi.fn()}
      />,
    );

    typeAndSubmit("just answer");
    await waitFor(() => expect(onSend).toHaveBeenCalledWith({ text: "just answer" }));
  });

  test("switching sessions resets any per-message override back to the new session's default", async () => {
    const onSend = vi
      .fn<(input: HubSendMessageInput) => Promise<void>>()
      .mockResolvedValue(undefined);
    const { rerender } = render(
      <Composer
        session={session({ id: "s1", status: "completed" })}
        turnRunning={false}
        onSend={onSend}
        onStop={vi.fn()}
        models={MODELS}
        modelsLoading={false}
        autonomy="threshold"
        onAutonomyChange={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /model: claude-sonnet-5/i }));
    fireEvent.click(screen.getByRole("button", { name: /^gpt-5/ }));

    rerender(
      <Composer
        session={session({ id: "s2", status: "completed", model: "claude-sonnet-5" })}
        turnRunning={false}
        onSend={onSend}
        onStop={vi.fn()}
        models={MODELS}
        modelsLoading={false}
        autonomy="threshold"
        onAutonomyChange={vi.fn()}
      />,
    );

    typeAndSubmit("fresh session, fresh model");
    await waitFor(
      () => expect(onSend).toHaveBeenCalledWith({ text: "fresh session, fresh model" }), // no override — back to the new session's default
    );
  });
});

/**
 * model-identity WP 4.1 — the RE-PIN entry point. WP 3.1's acceptance item "the credential is sent on
 * the model patch" was locked at the wire level only, because nothing in `apps/web` ever PATCHed
 * `session.model`. This is that surface: pick a per-message model, then keep it for the session.
 */
describe("Composer — re-pin the session's model (D-MI7 / WP 3.1 carry-forward)", () => {
  function renderPinned(models: HubModelOption[], sessionOverrides: Partial<HubSession> = {}) {
    render(
      <Composer
        session={session({ status: "completed", ...sessionOverrides })}
        turnRunning={false}
        onSend={vi.fn().mockResolvedValue(undefined)}
        onStop={vi.fn()}
        models={models}
        modelsLoading={false}
        autonomy="threshold"
        onAutonomyChange={vi.fn()}
      />,
    );
  }

  test("no override in force ⇒ no re-pin affordance (nothing to pin)", () => {
    renderPinned(MODELS);
    expect(screen.queryByRole("button", { name: /pin .* as this session's model/i })).toBeNull();
  });

  test("pinning sends BOTH the model and its credential on the PATCH, then clears the override", async () => {
    vi.mocked(api.updateHubSession).mockResolvedValue(session({ model: "gpt-5" }));
    renderPinned(MODELS);

    fireEvent.click(screen.getByRole("button", { name: /model: claude-sonnet-5/i }));
    fireEvent.click(screen.getByRole("button", { name: /^gpt-5/ }));

    fireEvent.click(screen.getByRole("button", { name: /pin gpt-5 as this session's model/i }));
    await waitFor(() =>
      expect(api.updateHubSession).toHaveBeenCalledWith("s1", {
        model: "gpt-5",
        providerCredentialId: "c2",
      }),
    );
    // The override is now the session's own model, so the per-message override is cleared.
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: /pin gpt-5/i })).not.toBeInTheDocument(),
    );
  });

  test("re-pinning to the SAME model id on the OTHER credential is offered (not a no-op)", async () => {
    vi.mocked(api.updateHubSession).mockResolvedValue(session());
    renderPinned(COLLIDING_MODELS, {
      model: "claude-sonnet-5",
      providerCredentialId: "c-api",
    });

    fireEvent.click(screen.getByRole("button", { name: /model: claude-sonnet-5/i }));
    fireEvent.click(
      within(screen.getByTestId("model-selector-content")).getByRole("button", { name: /^Sonnet/ }),
    );

    fireEvent.click(
      screen.getByRole("button", { name: /pin claude-sonnet-5 as this session's model/i }),
    );
    await waitFor(() =>
      expect(api.updateHubSession).toHaveBeenCalledWith("s1", {
        model: "claude-sonnet-5",
        providerCredentialId: "c-sub",
      }),
    );
  });
});

describe("Composer — WP2.5 plan-first toggle (R-SES5)", () => {
  test("toggling it on prefixes the NEXT outgoing message with the plan-first directive", async () => {
    const onSend = vi
      .fn<(input: HubSendMessageInput) => Promise<void>>()
      .mockResolvedValue(undefined);
    render(
      <Composer
        session={session({ status: "completed" })}
        turnRunning={false}
        onSend={onSend}
        onStop={vi.fn()}
        models={MODELS}
        modelsLoading={false}
        autonomy="threshold"
        onAutonomyChange={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /plan first/i }));
    typeAndSubmit("Compare server A and B");

    await waitFor(() => expect(onSend).toHaveBeenCalled());
    expect(onSend).toHaveBeenCalledWith({ text: withPlanFirstDirective("Compare server A and B") });
  });

  test("off by default — plain text goes out unmodified", async () => {
    const onSend = vi
      .fn<(input: HubSendMessageInput) => Promise<void>>()
      .mockResolvedValue(undefined);
    render(
      <Composer
        session={session({ status: "completed" })}
        turnRunning={false}
        onSend={onSend}
        onStop={vi.fn()}
        models={MODELS}
        modelsLoading={false}
        autonomy="threshold"
        onAutonomyChange={vi.fn()}
      />,
    );
    typeAndSubmit("just a normal question");
    await waitFor(() => expect(onSend).toHaveBeenCalledWith({ text: "just a normal question" }));
  });

  test("not offered in mission mode — the in-band plan → approve flow already covers it", () => {
    render(
      <Composer
        session={session({ mode: "mission", status: "completed" })}
        turnRunning={false}
        onSend={vi.fn()}
        onStop={vi.fn()}
        models={MODELS}
        modelsLoading={false}
        autonomy="threshold"
        onAutonomyChange={vi.fn()}
      />,
    );
    expect(screen.queryByRole("button", { name: /plan first/i })).not.toBeInTheDocument();
  });
});

describe("Composer — Autonomy as a mode (AutonomyModeSelect footer control)", () => {
  // hub-fixes WP6.2 (RC7) — the trigger's accessible name/label now carry the "Autonomy:" prefix so
  // it reads as unmistakably distinct from the (new, separate) session mode chip.
  test("the mode trigger's accessible name carries the current autonomy level, prefixed 'Autonomy:'", () => {
    render(
      <Composer
        session={session({ status: "completed" })}
        turnRunning={false}
        onSend={vi.fn()}
        onStop={vi.fn()}
        models={MODELS}
        modelsLoading={false}
        autonomy="auto"
        onAutonomyChange={vi.fn()}
      />,
    );
    // owner-feedback: the chip is icon-only now — the level lives in the aria-label (the query handle),
    // not in visible text.
    expect(screen.getByRole("button", { name: "Autonomy: Auto" })).toBeInTheDocument();
  });

  test("shown in mission mode too (unlike Plan first)", () => {
    render(
      <Composer
        session={session({ mode: "mission", status: "completed" })}
        turnRunning={false}
        onSend={vi.fn()}
        onStop={vi.fn()}
        models={MODELS}
        modelsLoading={false}
        autonomy="threshold"
        onAutonomyChange={vi.fn()}
      />,
    );
    // Plan first is chat/research-only; autonomy is always offered.
    expect(screen.queryByRole("button", { name: /plan first/i })).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Autonomy: Ask above a threshold" }),
    ).toBeInTheDocument();
  });

  test("picking a level from the popover fires onAutonomyChange with that level", async () => {
    const onAutonomyChange = vi.fn<(next: string) => void>();
    render(
      <Composer
        session={session({ status: "completed" })}
        turnRunning={false}
        onSend={vi.fn()}
        onStop={vi.fn()}
        models={MODELS}
        modelsLoading={false}
        autonomy="threshold"
        onAutonomyChange={onAutonomyChange}
      />,
    );

    // Opens the mode menu (a real @elabs-ai/components-ui Popover), then selects "Auto". `\b` keeps the auto row's
    // name (`/^Auto\b/`) from also matching the trigger button's "Autonomy: Ask above a threshold".
    fireEvent.click(screen.getByRole("button", { name: "Autonomy: Ask above a threshold" }));
    fireEvent.click(await screen.findByRole("button", { name: /^Auto\b/ }));
    expect(onAutonomyChange).toHaveBeenCalledWith("auto");
  });
});

describe("Composer — Session mode chip (SessionModeChip, hub-fixes WP6.2/RC7)", () => {
  test("switchableSessionModes: auto/chat/research swap freely among each other; mission only ever offers 'auto'", () => {
    expect(switchableSessionModes("auto").sort()).toEqual(["chat", "research"]);
    expect(switchableSessionModes("chat").sort()).toEqual(["auto", "research"]);
    expect(switchableSessionModes("research").sort()).toEqual(["auto", "chat"]);
    expect(switchableSessionModes("mission")).toEqual(["auto"]); // never chat/research directly
  });

  test("the chip reflects the session's current mode, distinct from (and next to) the model chip", () => {
    render(
      <Composer
        session={session({ mode: "auto", status: "completed" })}
        turnRunning={false}
        onSend={vi.fn()}
        onStop={vi.fn()}
        models={MODELS}
        modelsLoading={false}
        autonomy="threshold"
        onAutonomyChange={vi.fn()}
      />,
    );
    // owner-feedback: icon-only chips — the mode lives in the aria-label, not visible text.
    expect(screen.getByRole("button", { name: /session mode: auto mode/i })).toBeInTheDocument();
    // Distinct from the autonomy chip and the model chip — three separate, clearly-named controls.
    expect(
      screen.getByRole("button", { name: "Autonomy: Ask above a threshold" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /model: claude-sonnet-5/i })).toBeInTheDocument();
  });

  test("a mission-mode session's chip reads 'Mission'", () => {
    render(
      <Composer
        session={session({ mode: "mission", status: "completed" })}
        turnRunning={false}
        onSend={vi.fn()}
        onStop={vi.fn()}
        models={MODELS}
        modelsLoading={false}
        autonomy="threshold"
        onAutonomyChange={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: /session mode: mission/i })).toBeInTheDocument();
  });

  test("clicking the chip explains the mode and offers auto<->chat<->research switch targets, never 'mission'", async () => {
    render(
      <Composer
        session={session({ mode: "chat", status: "completed" })}
        turnRunning={false}
        onSend={vi.fn()}
        onStop={vi.fn()}
        models={MODELS}
        modelsLoading={false}
        autonomy="threshold"
        onAutonomyChange={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /session mode: chat/i }));

    expect(await screen.findByText("Session mode")).toBeInTheDocument();
    expect(screen.getByText(/always answers directly, one turn at a time/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /switch to auto mode/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /switch to research/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /switch to mission/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /switch to chat/i })).not.toBeInTheDocument(); // current
  });

  test("a mission-mode session's popover offers ONLY 'Switch to Auto mode'", async () => {
    render(
      <Composer
        session={session({ mode: "mission", status: "completed" })}
        turnRunning={false}
        onSend={vi.fn()}
        onStop={vi.fn()}
        models={MODELS}
        modelsLoading={false}
        autonomy="threshold"
        onAutonomyChange={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /session mode: mission/i }));

    expect(await screen.findByRole("button", { name: /switch to auto mode/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /switch to chat/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /switch to research/i })).not.toBeInTheDocument();
  });

  test("switching mode PATCHes the session and the chip re-renders with the new mode", async () => {
    vi.mocked(api.updateHubSession).mockResolvedValue(session({ id: "s1", mode: "auto" }));
    render(
      <Composer
        session={session({ id: "s1", mode: "chat", status: "completed" })}
        turnRunning={false}
        onSend={vi.fn()}
        onStop={vi.fn()}
        models={MODELS}
        modelsLoading={false}
        autonomy="threshold"
        onAutonomyChange={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /session mode: chat/i }));
    fireEvent.click(await screen.findByRole("button", { name: /switch to auto mode/i }));

    expect(api.updateHubSession).toHaveBeenCalledWith("s1", { mode: "auto" });
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /session mode: auto mode/i })).toBeInTheDocument(),
    );
  });

  test("running-mission guard: a rejected switch (the API's 409) reverts the chip and surfaces a toast — never a silent failure", async () => {
    vi.mocked(api.updateHubSession).mockRejectedValue(
      new Error(
        "This session's mission is still running — stop or wait for it to finish before switching mode.",
      ),
    );
    render(
      <Composer
        session={session({ id: "s1", mode: "mission", status: "completed" })}
        turnRunning={false}
        onSend={vi.fn()}
        onStop={vi.fn()}
        models={MODELS}
        modelsLoading={false}
        autonomy="threshold"
        onAutonomyChange={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /session mode: mission/i }));
    fireEvent.click(await screen.findByRole("button", { name: /switch to auto mode/i }));

    expect(api.updateHubSession).toHaveBeenCalledWith("s1", { mode: "auto" });
    // The optimistic switch is rolled back once the PATCH rejects — the chip reads "Mission" again
    // (icon-only now: the mode is back in the aria-label).
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /session mode: mission/i })).toBeInTheDocument(),
    );
    expect(toast.error).toHaveBeenCalledWith(
      "Couldn’t change mode",
      expect.objectContaining({ description: expect.stringMatching(/mission is still running/i) }),
    );
  });

  // a11y (WP6.2 Acceptance): both the mode chip and the autonomy chip are real, keyboard-focusable
  // native buttons with clear, DISTINCT accessible names (never generic "button", never a div).
  test("a11y: the mode chip and the autonomy chip are both real buttons, focusable, with distinct clear names", () => {
    render(
      <Composer
        session={session({ mode: "research", status: "completed" })}
        turnRunning={false}
        onSend={vi.fn()}
        onStop={vi.fn()}
        models={MODELS}
        modelsLoading={false}
        autonomy="always_ask"
        onAutonomyChange={vi.fn()}
      />,
    );
    const modeChip = screen.getByRole("button", { name: /session mode: research/i });
    const autonomyChip = screen.getByRole("button", { name: "Autonomy: Ask every time" });

    expect(modeChip.tagName).toBe("BUTTON");
    expect(autonomyChip.tagName).toBe("BUTTON");
    expect(modeChip).not.toBeDisabled();
    expect(autonomyChip).not.toBeDisabled();
    expect(modeChip.getAttribute("aria-label")).not.toBe(autonomyChip.getAttribute("aria-label"));

    // Native buttons are in the default tab order and programmatically focusable — the concrete,
    // jsdom-provable half of "keyboard-operable" (Enter/Space activation is native <button> behavior
    // no application code here overrides).
    modeChip.focus();
    expect(document.activeElement).toBe(modeChip);
    autonomyChip.focus();
    expect(document.activeElement).toBe(autonomyChip);
  });
});

describe("Composer — WP2.5 voice input (SpeechInput, feature-detected)", () => {
  test("a transcript from SpeechInput lands in the composer text", () => {
    render(
      <Composer
        session={session({ status: "completed" })}
        turnRunning={false}
        onSend={vi.fn()}
        onStop={vi.fn()}
        models={MODELS}
        modelsLoading={false}
        autonomy="threshold"
        onAutonomyChange={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /voice input/i }));
    expect(getEditor()).toHaveTextContent("mock transcript");
  });

  test("a transcript APPENDS to already-typed text rather than replacing it", () => {
    render(
      <Composer
        session={session({ status: "completed" })}
        turnRunning={false}
        onSend={vi.fn()}
        onStop={vi.fn()}
        models={MODELS}
        modelsLoading={false}
        autonomy="threshold"
        onAutonomyChange={vi.fn()}
      />,
    );
    const editor = setComposerText("Notes:");
    fireEvent.click(screen.getByRole("button", { name: /voice input/i }));
    expect(editor).toHaveTextContent("Notes: mock transcript");
  });
});

describe("Composer — WP2.5 slash command menu (R-SK3 slash, R-MCP8, R-UX10)", () => {
  test("typing / opens the menu; picking a skill inserts /slug (ready for args) and closes it", async () => {
    vi.mocked(api.listSkills).mockResolvedValue([skill()]);

    render(
      <Composer
        session={session({ status: "completed" })}
        turnRunning={false}
        onSend={vi.fn()}
        onStop={vi.fn()}
        models={MODELS}
        modelsLoading={false}
        autonomy="threshold"
        onAutonomyChange={vi.fn()}
      />,
    );
    const editor = setComposerText("/");

    expect(screen.getByTestId("composer-commands")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("/graphify")).toBeInTheDocument());

    fireEvent.click(screen.getByText("/graphify"));

    expect(editor.textContent).toBe("/graphify ");
    // The trailing space means the text no longer matches the slash-trigger pattern — the menu closes.
    expect(screen.queryByTestId("composer-commands")).not.toBeInTheDocument();
  });

  test("clicking the Commands button opens the menu from an empty composer", async () => {
    render(
      <Composer
        session={session({ status: "completed" })}
        turnRunning={false}
        onSend={vi.fn()}
        onStop={vi.fn()}
        models={MODELS}
        modelsLoading={false}
        autonomy="threshold"
        onAutonomyChange={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Commands" }));
    expect(getEditor().textContent).toBe("/");
    expect(screen.getByTestId("composer-commands")).toBeInTheDocument();
    // Let the lazily-triggered catalog fetch settle within `act` (its own content isn't under test here).
    await waitFor(() => expect(screen.getByText(/no skills or mcp prompts/i)).toBeInTheDocument());
  });

  test("Escape dismisses the menu without touching the typed text", () => {
    render(
      <Composer
        session={session({ status: "completed" })}
        turnRunning={false}
        onSend={vi.fn()}
        onStop={vi.fn()}
        models={MODELS}
        modelsLoading={false}
        autonomy="threshold"
        onAutonomyChange={vi.fn()}
      />,
    );
    const editor = setComposerText("/");
    expect(screen.getByTestId("composer-commands")).toBeInTheDocument();

    fireEvent.keyDown(editor, { key: "Escape" });
    expect(screen.queryByTestId("composer-commands")).not.toBeInTheDocument();
    expect(editor.textContent).toBe("/");
  });

  test("Enter with no matching command falls through to a normal send, not a swallowed keystroke", async () => {
    const onSend = vi
      .fn<(input: HubSendMessageInput) => Promise<void>>()
      .mockResolvedValue(undefined);
    render(
      <Composer
        session={session({ status: "completed" })}
        turnRunning={false}
        onSend={onSend}
        onStop={vi.fn()}
        models={MODELS}
        modelsLoading={false}
        autonomy="threshold"
        onAutonomyChange={vi.fn()}
      />,
    );
    // "/tmp/report" never matches a registered command (the catalog is empty here) — it's a literal
    // message, so submitting it normally must still work.
    typeAndSubmit("/tmp/report is where I saved it");
    await waitFor(() =>
      expect(onSend).toHaveBeenCalledWith({ text: "/tmp/report is where I saved it" }),
    );
  });

  test("a literal slash mid-message (not the first character) never opens the menu", () => {
    render(
      <Composer
        session={session({ status: "completed" })}
        turnRunning={false}
        onSend={vi.fn()}
        onStop={vi.fn()}
        models={MODELS}
        modelsLoading={false}
        autonomy="threshold"
        onAutonomyChange={vi.fn()}
      />,
    );
    setComposerText("see /tmp/report");
    expect(screen.queryByTestId("composer-commands")).not.toBeInTheDocument();
  });
});

// ── WP3.4 — Attachments ──────────────────────────────────────────────────────────────────────────

function readAsText(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
    reader.onerror = () => reject(reader.error);
    reader.readAsText(blob);
  });
}

test("dataUrlToFile round-trips a base64 data: URL back into a File with the right name/type/content", async () => {
  const file = dataUrlToFile("data:text/plain;base64,aGVsbG8=", "notes.txt", "text/plain");
  expect(file.name).toBe("notes.txt");
  expect(file.type).toBe("text/plain");
  expect(await readAsText(file)).toBe("hello");
});

describe("Composer — Attachments (WP3.4, D-AH12)", () => {
  test("picking a file renders a removable chip; removing it clears the tray", async () => {
    render(
      <Composer
        session={session({ status: "completed" })}
        turnRunning={false}
        onSend={vi.fn()}
        onStop={vi.fn()}
        models={MODELS}
        modelsLoading={false}
        autonomy="threshold"
        onAutonomyChange={vi.fn()}
      />,
    );
    const input = screen.getByTestId("composer-attachment-input");
    const file = new File(["hello world"], "notes.txt", { type: "text/plain" });
    fireEvent.change(input, { target: { files: [file] } });

    const chip = await screen.findByTestId("attachment-chip");
    expect(chip).toHaveTextContent("notes.txt");

    fireEvent.click(screen.getByRole("button", { name: /remove attachment/i }));
    await waitFor(() => expect(screen.queryByTestId("attachment-chip")).not.toBeInTheDocument());
  });

  test("sending with an attached file uploads it (linked to this session) BEFORE the message, then sends attachmentFileIds and clears the tray", async () => {
    vi.mocked(api.uploadHubFile).mockResolvedValue({
      id: "file-1",
      sha256: "abc",
      mime: "text/plain",
      bytes: 11,
      filename: "notes.txt",
      createdAt: "2026-07-17T00:00:00.000Z",
    });
    const onSend = vi
      .fn<(input: HubSendMessageInput) => Promise<void>>()
      .mockResolvedValue(undefined);
    render(
      <Composer
        session={session({ id: "sess-42", status: "completed" })}
        turnRunning={false}
        onSend={onSend}
        onStop={vi.fn()}
        models={MODELS}
        modelsLoading={false}
        autonomy="threshold"
        onAutonomyChange={vi.fn()}
      />,
    );

    const input = screen.getByTestId("composer-attachment-input");
    const file = new File(["hello world"], "notes.txt", { type: "text/plain" });
    fireEvent.change(input, { target: { files: [file] } });
    await screen.findByTestId("attachment-chip");

    typeAndSubmit("See the attached notes");

    await waitFor(() => expect(onSend).toHaveBeenCalled());
    expect(api.uploadHubFile).toHaveBeenCalledWith(expect.objectContaining({ name: "notes.txt" }), {
      sessionId: "sess-42",
      role: "upload",
    });
    expect(onSend).toHaveBeenCalledWith({
      text: "See the attached notes",
      attachmentFileIds: ["file-1"],
    });
    await waitFor(() => expect(screen.queryByTestId("attachment-chip")).not.toBeInTheDocument());
  });

  test("WP1.3 (D-HUX13): dockPosition defaults to docked and is exposed via data-dock-position", () => {
    render(
      <Composer
        session={session()}
        turnRunning={false}
        onSend={vi.fn()}
        onStop={vi.fn()}
        models={MODELS}
        modelsLoading={false}
        autonomy="threshold"
        onAutonomyChange={vi.fn()}
      />,
    );
    expect(document.querySelector('[data-dock-position="docked"]')).toBeInTheDocument();
  });

  test("WP1.3 (D-HUX13): dockPosition='centered' is a width/alignment affordance only — send logic is unaffected", async () => {
    const onSend = vi
      .fn<(input: HubSendMessageInput) => Promise<void>>()
      .mockResolvedValue(undefined);
    render(
      <Composer
        session={session({ status: "completed" })}
        turnRunning={false}
        onSend={onSend}
        onStop={vi.fn()}
        models={MODELS}
        modelsLoading={false}
        autonomy="threshold"
        onAutonomyChange={vi.fn()}
        dockPosition="centered"
      />,
    );
    expect(document.querySelector('[data-dock-position="centered"]')).toBeInTheDocument();
    typeAndSubmit("Hello from the centered composer");
    await waitFor(() =>
      expect(onSend).toHaveBeenCalledWith({ text: "Hello from the centered composer" }),
    );
  });
});

// ── ui-wave U4 (owner feedback) — single-surface layout ─────────────────────────────────────────
// Structural pass only: everything above (send/queue/stop/commands/attachments) must keep passing
// untouched; these tests pin the two new BEHAVIORS the redesign introduced.

describe("Composer — ui-wave U4 single-surface layout", () => {
  test("Send is disabled while the composer is empty and arms once text arrives (submit still guards)", () => {
    render(
      <Composer
        session={session({ status: "completed" })}
        turnRunning={false}
        onSend={vi.fn()}
        onStop={vi.fn()}
        models={MODELS}
        modelsLoading={false}
        autonomy="threshold"
        onAutonomyChange={vi.fn()}
      />,
    );
    const send = screen.getByRole("button", { name: "Send message" });
    expect(send).toBeDisabled();
    setComposerText("hello");
    expect(send).not.toBeDisabled();
  });

  test("the status strip lives INSIDE the composer frame and carries the queue hint while a turn runs", () => {
    const props = {
      session: session({ status: "completed" }),
      onSend: vi.fn(),
      onStop: vi.fn(),
      models: MODELS,
      modelsLoading: false,
      autonomy: "threshold" as const,
      onAutonomyChange: vi.fn(),
    };
    const { rerender } = render(<Composer {...props} turnRunning={false} />);

    // owner-feedback (2026-07-27): the strip is always on and, crucially, INSIDE the bordered card —
    // the same frame that holds the editor. Asserted structurally (shared `.rounded-xl` ancestor)
    // rather than by class string, so it fails if the strip is ever lifted back out above the box.
    const idle = screen.getByText(/awaiting your input/i);
    const frame = idle.closest(".rounded-xl");
    expect(frame).not.toBeNull();
    expect(frame).toContainElement(getEditor());

    // The R-SES3 queue-while-running state still surfaces — same strip, running text.
    rerender(<Composer {...props} turnRunning />);
    expect(screen.queryByText(/awaiting your input/i)).not.toBeInTheDocument();
    const running = screen.getByText(/queues and sends next/i);
    expect(running.closest(".rounded-xl")).toBe(frame);
  });
});
