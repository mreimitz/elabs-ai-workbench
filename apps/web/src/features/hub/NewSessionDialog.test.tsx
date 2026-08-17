import type { HubProject, HubSessionCreateInput } from "@mcp-token-footprint/shared";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

// The redesigned modal renders `ModelSelectorLogo` from `@elabs-ai/components-ai` for each family — stub the heavy
// `@elabs-ai/components-ai` surface (it pulls in @xyflow/shiki/mermaid CSS jsdom can't load), same as the other hub
// component tests (AssistantView/Composer). The stub's `ModelSelectorLogo` is a no-op, so the family
// buttons are still matched by their text label.
vi.mock("@elabs-ai/components-ai", () => import("./test-support/brand-ai-mock"));

// The Agents & Crews tab's picker self-fetches the saved roles + crews — stub those two listers (keep the
// rest of the api module real; nothing else in this dialog's render calls it).
vi.mock("../../lib/api", async (importActual) => {
  const actual = await importActual<typeof import("../../lib/api")>();
  const NOW = "2026-07-20T00:00:00.000Z";
  return {
    ...actual,
    listHubAgentRoles: vi.fn().mockResolvedValue([
      {
        id: "role-1",
        name: "Analyst",
        systemPrompt: "You are an analyst.",
        defaultModel: "claude-sonnet-5",
        toolGrants: { servers: {}, builtins: [] },
        skills: [],
        target: "Analyze.",
        expectedOutcome: "A report.",
        createdAt: NOW,
        updatedAt: NOW,
      },
    ]),
    listHubCrews: vi.fn().mockResolvedValue([
      {
        id: "crew-1",
        name: "Research crew",
        topology: "parallel",
        members: [{ agentId: "role-1" }],
        createdAt: NOW,
        updatedAt: NOW,
      },
    ]),
  };
});

import { NewSessionDialog } from "./NewSessionDialog";
import type { HubModelOption } from "./use-hub-models";

const MODELS: HubModelOption[] = [
  { modelId: "claude-sonnet-5", kind: "anthropic", credentialId: "c1" },
];

const TWO_FAMILY_MODELS: HubModelOption[] = [
  { modelId: "claude-sonnet-5", kind: "anthropic", credentialId: "c1", displayName: "Sonnet 5" },
  { modelId: "llama3", kind: "ollama", credentialId: "c2", displayName: "Llama 3" },
];

// model-identity WP 3.1 (D-MI8) — the owner's real rosters: `claude-sonnet-5` is byte-identical
// across the metered `anthropic` credential and the `claude_subscription` one. Both must survive AND
// stay separately selectable, each carrying its OWN credential to the create call.
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

const PROJECTS: HubProject[] = [
  {
    id: "p1",
    name: "Q3 Launch",
    createdAt: "2026-07-10T00:00:00.000Z",
    updatedAt: "2026-07-10T00:00:00.000Z",
  },
];

describe("NewSessionDialog", () => {
  test("defaults to auto mode (hub-fixes WP6.1); picking Research changes the RadioGroup selection", () => {
    render(
      <NewSessionDialog
        open
        models={MODELS}
        modelsLoading={false}
        onOpenChange={vi.fn()}
        onCreate={vi.fn()}
      />,
    );
    const auto = screen.getByRole("radio", { name: /auto/i });
    const chat = screen.getByRole("radio", { name: /^chat/i });
    const research = screen.getByRole("radio", { name: /research/i });
    const mission = screen.getByRole("radio", { name: /mission/i });
    expect(auto).toHaveAttribute("aria-checked", "true");
    expect(chat).toHaveAttribute("aria-checked", "false");
    expect(research).toHaveAttribute("aria-checked", "false");
    expect(mission).toHaveAttribute("aria-checked", "false");

    fireEvent.click(research);
    expect(research).toHaveAttribute("aria-checked", "true");
    expect(auto).toHaveAttribute("aria-checked", "false");
  });

  test("Start session creates with the picked mode + the seeded model, then closes", async () => {
    const onCreate = vi
      .fn<(input: HubSessionCreateInput) => Promise<void>>()
      .mockResolvedValue(undefined);
    const onOpenChange = vi.fn();
    render(
      <NewSessionDialog
        open
        models={MODELS}
        modelsLoading={false}
        onOpenChange={onOpenChange}
        onCreate={onCreate}
      />,
    );

    fireEvent.click(screen.getByRole("radio", { name: /research/i }));
    fireEvent.click(screen.getByRole("button", { name: /start session/i }));

    await waitFor(() =>
      expect(onCreate).toHaveBeenCalledWith({
        mode: "research",
        model: "claude-sonnet-5",
        // model-identity WP 3.1 (D-MI1) — the picked row's credential travels with the model id.
        providerCredentialId: "c1",
      }),
    );
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  test("Start session stays disabled with no model available, and shows a helper hint", () => {
    render(
      <NewSessionDialog
        open
        models={[]}
        modelsLoading={false}
        onOpenChange={vi.fn()}
        onCreate={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: /start session/i })).toBeDisabled();
    expect(
      screen.getByText(/no provider credential has a usable model roster/i),
    ).toBeInTheDocument();
  });

  test("no projects: the project picker is omitted entirely", () => {
    render(
      <NewSessionDialog
        open
        models={MODELS}
        modelsLoading={false}
        onOpenChange={vi.fn()}
        onCreate={vi.fn()}
      />,
    );
    expect(screen.queryByRole("combobox", { name: /project/i })).not.toBeInTheDocument();
  });

  test("projects present: defaults to 'No project'; picking one includes projectId in the create call", async () => {
    const onCreate = vi
      .fn<(input: HubSessionCreateInput) => Promise<void>>()
      .mockResolvedValue(undefined);
    render(
      <NewSessionDialog
        open
        models={MODELS}
        modelsLoading={false}
        onOpenChange={vi.fn()}
        onCreate={onCreate}
        projects={PROJECTS}
      />,
    );

    const trigger = screen.getByRole("combobox", { name: /project/i });
    expect(trigger).toHaveTextContent(/no project/i);

    // Radix Select: open via keyboard (mirrors this app's own verified pattern — see
    // `SessionSkillsPanel.test.tsx`'s invocation-Select test).
    fireEvent.keyDown(trigger, { key: "Enter" });
    const option = await screen.findByRole("option", { name: "Q3 Launch" });
    fireEvent.click(option);

    fireEvent.click(screen.getByRole("button", { name: /start session/i }));
    await waitFor(() =>
      expect(onCreate).toHaveBeenCalledWith({
        // hub-fixes WP6.1 — the mode is left untouched here, so it's the new `auto` default.
        mode: "auto",
        model: "claude-sonnet-5",
        providerCredentialId: "c1",
        projectId: "p1",
      }),
    );
  });

  // model-identity WP 4.1 (D-MI7) — the bespoke two-step family→model button grid is replaced by the
  // ONE shared picker; its groups are the provider families, in a deterministic order.
  test("the model picker groups by provider family; picking another family's model switches it", async () => {
    const onCreate = vi
      .fn<(input: HubSessionCreateInput) => Promise<void>>()
      .mockResolvedValue(undefined);
    render(
      <NewSessionDialog
        open
        models={TWO_FAMILY_MODELS}
        modelsLoading={false}
        onOpenChange={vi.fn()}
        onCreate={onCreate}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /^Model:/ }));
    const palette = within(screen.getByTestId("model-selector-content"));
    expect(palette.getByText("Anthropic")).toBeInTheDocument();
    expect(palette.getByText("Ollama")).toBeInTheDocument();
    fireEvent.click(palette.getByRole("button", { name: /^Llama 3/ }));
    fireEvent.click(screen.getByRole("button", { name: /start session/i }));

    // hub-fixes WP6.1 — mode left untouched ⇒ the new `auto` default.
    await waitFor(() =>
      expect(onCreate).toHaveBeenCalledWith({
        mode: "auto",
        model: "llama3",
        providerCredentialId: "c2",
      }),
    );
  });

  // The D-MI7 search fix, exercised through the repaired `@elabs-ai/components-ai` mock (which filters items on
  // `value` + `keywords`, the same two inputs cmdk's default `commandScore` consumes). Before WP 4.1
  // no keywords were passed at all, so typing a PROVIDER name matched nothing.
  test("the palette is searchable by provider name, not just by model id", async () => {
    render(
      <NewSessionDialog
        open
        models={TWO_FAMILY_MODELS}
        modelsLoading={false}
        onOpenChange={vi.fn()}
        onCreate={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /^Model:/ }));
    const palette = within(screen.getByTestId("model-selector-content"));
    fireEvent.change(palette.getByRole("textbox", { name: /search models/i }), {
      target: { value: "ollama" },
    });
    expect(palette.getByRole("button", { name: /^Llama 3/ })).toBeVisible();
    expect(palette.queryByRole("button", { name: /^Sonnet 5/ })).not.toBeInTheDocument();
  });

  // model-identity WP 3.1 (D-MI1/D-MI8) — the defect, restated as a check: an operator who picks
  // "Anthropic CLI → Sonnet" must not have that choice collapsed into a bare `claude-sonnet-5` the
  // API then re-guesses a provider for by NAME (which routed the session onto the metered API key).
  test("two credentials sharing a model id are separately selectable; each sends its OWN credential", async () => {
    const onCreate = vi
      .fn<(input: HubSessionCreateInput) => Promise<void>>()
      .mockResolvedValue(undefined);
    const { unmount } = render(
      <NewSessionDialog
        open
        models={COLLIDING_MODELS}
        modelsLoading={false}
        onOpenChange={vi.fn()}
        onCreate={onCreate}
      />,
    );

    // Both providers are offered — the colliding twin is no longer swallowed by the roster. D-MI5:
    // the subscription group reads "Anthropic CLI", from the ONE label registry.
    fireEvent.click(screen.getByRole("button", { name: /^Model:/ }));
    let palette = within(screen.getByTestId("model-selector-content"));
    expect(palette.getByText("Anthropic")).toBeInTheDocument();
    expect(palette.getByText("Anthropic CLI")).toBeInTheDocument();

    fireEvent.click(palette.getByRole("button", { name: /^Sonnet claude-sonnet-5/ }));
    fireEvent.click(screen.getByRole("button", { name: /start session/i }));
    await waitFor(() =>
      expect(onCreate).toHaveBeenCalledWith({
        mode: "auto",
        model: "claude-sonnet-5",
        providerCredentialId: "c-sub",
      }),
    );
    unmount();

    // The SAME model id picked from the other credential sends the other credential.
    onCreate.mockClear();
    render(
      <NewSessionDialog
        open
        models={COLLIDING_MODELS}
        modelsLoading={false}
        onOpenChange={vi.fn()}
        onCreate={onCreate}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /^Model:/ }));
    palette = within(screen.getByTestId("model-selector-content"));
    fireEvent.click(palette.getByRole("button", { name: /^Claude Sonnet 5/ }));
    fireEvent.click(screen.getByRole("button", { name: /start session/i }));
    await waitFor(() =>
      expect(onCreate).toHaveBeenCalledWith({
        mode: "auto",
        model: "claude-sonnet-5",
        providerCredentialId: "c-api",
      }),
    );
  });

  test("MCP & tools and Skills sections default to Auto with a prompt-driven explainer", () => {
    render(
      <NewSessionDialog
        open
        models={MODELS}
        modelsLoading={false}
        onOpenChange={vi.fn()}
        onCreate={vi.fn()}
      />,
    );

    // The left rail carries the pre-configure sections; each defaults to Auto (the Claude-Desktop
    // behaviour) with a prompt-driven explainer — no picker until you switch off Auto.
    fireEvent.click(screen.getByRole("button", { name: "MCP & tools" }));
    expect(screen.getByText(/every reachable mcp server is available/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Skills" }));
    expect(screen.getByText(/your whole skill registry is available/i)).toBeInTheDocument();
  });

  test("Agents & Crews tab: defaults to Auto with the planner explainer", () => {
    render(
      <NewSessionDialog
        open
        models={MODELS}
        modelsLoading={false}
        onOpenChange={vi.fn()}
        onCreate={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Agents & Crews" }));
    expect(screen.getByText(/a mission's planner proposes a fresh team/i)).toBeInTheDocument();
    // The picker only appears once you switch off Auto.
    expect(screen.queryByText("Analyst")).not.toBeInTheDocument();
  });

  test("Agents & Crews tab: picking a saved agent includes the roster in the create call", async () => {
    const onCreate = vi
      .fn<(input: HubSessionCreateInput) => Promise<void>>()
      .mockResolvedValue(undefined);
    render(
      <NewSessionDialog
        open
        models={MODELS}
        modelsLoading={false}
        onOpenChange={vi.fn()}
        onCreate={onCreate}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Agents & Crews" }));
    // Switch the segmented control from Auto to Pick → the picker mounts + fetches.
    fireEvent.click(screen.getByText("Pick"));
    const agent = await screen.findByRole("checkbox", { name: /Analyst/i });
    fireEvent.click(agent);

    fireEvent.click(screen.getByRole("button", { name: /start session/i }));
    await waitFor(() =>
      expect(onCreate).toHaveBeenCalledWith({
        mode: "auto",
        model: "claude-sonnet-5",
        providerCredentialId: "c1",
        roster: { crewIds: [], agentIds: ["role-1"] },
      }),
    );
  });

  test("a create failure surfaces inline and keeps the dialog open", async () => {
    const onCreate = vi
      .fn<(input: HubSessionCreateInput) => Promise<void>>()
      .mockRejectedValue(new Error("The Assistant is not configured."));
    const onOpenChange = vi.fn();
    render(
      <NewSessionDialog
        open
        models={MODELS}
        modelsLoading={false}
        onOpenChange={onOpenChange}
        onCreate={onCreate}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /start session/i }));

    await waitFor(() =>
      expect(screen.getByText("The Assistant is not configured.")).toBeInTheDocument(),
    );
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });
});
