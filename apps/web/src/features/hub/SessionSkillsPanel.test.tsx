// Assistant Hub (WP2.4, R-SK1…R-SK6/R-SK8) — the session settings skill panel: attachment list +
// invocation-mode edit + remove, the L1 listing budget bar, and per-skill L1/L2/L3 usage.

import type { HubSessionSkillsView, Skill } from "@mcp-token-footprint/shared";
import { TooltipProvider } from "@elabs-ai/components-ui";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, test, vi } from "vitest";

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return {
    ...actual,
    getHubSessionSkills: vi.fn(),
    listSkills: vi.fn(),
    replaceHubSessionSkills: vi.fn(),
  };
});
vi.mock("../skills/skills-inspector-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../skills/skills-inspector-api")>();
  return { ...actual, listSkillVersions: vi.fn().mockResolvedValue([]) };
});

import * as api from "../../lib/api";
import { SessionSkillsPanel } from "./SessionSkillsPanel";

afterEach(() => {
  vi.clearAllMocks();
});

// The panel links out to a skill's registry inspector (`/skills/:id`) — needs a Router context
// (mirrors AssistantView.test.tsx's own MemoryRouter wrap).
// The Remove-attachment control is an `IconButton` (D-TB5), which wraps every control in a Radix
// `Tooltip` — that throws without an ancestor `TooltipProvider` (the app root mounts one).
function renderPanel(sessionId = "s1"): void {
  render(
    <TooltipProvider>
      <MemoryRouter>
        <SessionSkillsPanel sessionId={sessionId} open onOpenChange={vi.fn()} />
      </MemoryRouter>
    </TooltipProvider>,
  );
}

function view(overrides: Partial<HubSessionSkillsView> = {}): HubSessionSkillsView {
  return {
    attachments: [
      {
        skillId: "sk-1",
        versionMode: "latest",
        invocationMode: "model_invocable",
        skillName: "PDF Processing",
        skillDescription: "Extract text and fill forms.",
        versionId: "v-1",
        versionLabel: "v3",
        isLatest: true,
        footprint: { tokenProfile: "generic_o200k", l1MetadataTokens: 20, l2BodyTokens: 400, l3ResourceTokens: 100, totalTokens: 520 },
        frontmatter: { whenToUse: "When the user needs PDF text extraction." },
      },
    ],
    listing: {
      entries: [{ skillId: "sk-1", name: "PDF Processing", state: "full", demoted: false, loadable: true, tokens: 20 }],
      budgetTokens: 1000,
      usedTokens: 20,
      contextWindow: 100_000,
    },
    usage: [
      { skillId: "sk-1", name: "PDF Processing", l1Tokens: 20, l2Tokens: 0, l3Tokens: 0, totalTokens: 20, invoked: false, loadedPaths: [] },
    ],
    ...overrides,
  };
}

const SKILL: Skill = {
  id: "sk-1",
  name: "pdf-processing",
  displayName: "PDF Processing",
  slug: "pdf-processing",
  sourceType: "upload",
  versionCount: 3,
  createdAt: "2026-07-17T00:00:00.000Z",
  updatedAt: "2026-07-17T00:00:00.000Z",
};

describe("SessionSkillsPanel — empty state", () => {
  test("no attachments shows an empty state with an Attach action, never a crash", async () => {
    vi.mocked(api.getHubSessionSkills).mockResolvedValue(
      view({ attachments: [], listing: { entries: [], budgetTokens: 0, usedTokens: 0, contextWindow: 0 }, usage: [] }),
    );
    vi.mocked(api.listSkills).mockResolvedValue([]);

    renderPanel();

    await waitFor(() => expect(screen.getByText(/no skills attached/i)).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /attach skill/i })).toBeInTheDocument();
  });

  test("Attach skill → pick skill → User-only invocation → confirm calls replaceHubSessionSkills", async () => {
    vi.mocked(api.getHubSessionSkills).mockResolvedValue(
      view({ attachments: [], listing: { entries: [], budgetTokens: 0, usedTokens: 0, contextWindow: 0 }, usage: [] }),
    );
    vi.mocked(api.listSkills).mockResolvedValue([SKILL]);
    vi.mocked(api.replaceHubSessionSkills).mockResolvedValue(view());

    renderPanel();
    await waitFor(() => expect(screen.getByText(/no skills attached/i)).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /attach skill/i }));
    const modal = await screen.findByRole("dialog", { name: /attach skill to this session/i });
    fireEvent.click(within(modal).getByRole("button", { name: /pdf processing/i }));

    fireEvent.click(within(modal).getByRole("radio", { name: /user-only \(slash\)/i }));
    fireEvent.click(within(modal).getByRole("button", { name: /^attach skill$/i }));

    await waitFor(() =>
      expect(api.replaceHubSessionSkills).toHaveBeenCalledWith("s1", [
        { skillId: "sk-1", versionMode: "latest", invocationMode: "user_only" },
      ]),
    );
  });
});

describe("SessionSkillsPanel — populated", () => {
  test("renders the attached skill's name, version chip, and usage breakdown", async () => {
    vi.mocked(api.getHubSessionSkills).mockResolvedValue(view());
    vi.mocked(api.listSkills).mockResolvedValue([SKILL]);

    renderPanel();

    await waitFor(() => expect(screen.getByText("PDF Processing")).toBeInTheDocument());
    expect(screen.getByText("Latest")).toBeInTheDocument();
    expect(screen.getByText(/when the user needs pdf text extraction/i)).toBeInTheDocument();
    // The L1 listing budget bar renders when budgetTokens > 0.
    expect(screen.getByText(/l1 listing budget/i)).toBeInTheDocument();
  });

  test("Remove calls replaceHubSessionSkills with the attachment filtered out", async () => {
    vi.mocked(api.getHubSessionSkills).mockResolvedValue(view());
    vi.mocked(api.listSkills).mockResolvedValue([SKILL]);
    vi.mocked(api.replaceHubSessionSkills).mockResolvedValue(
      view({ attachments: [], listing: { entries: [], budgetTokens: 1000, usedTokens: 0, contextWindow: 100_000 }, usage: [] }),
    );

    renderPanel();
    await waitFor(() => expect(screen.getByText("PDF Processing")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /remove pdf processing/i }));

    await waitFor(() =>
      expect(api.replaceHubSessionSkills).toHaveBeenCalledWith("s1", []),
    );
  });

  test("changing the invocation Select calls replaceHubSessionSkills with the new mode", async () => {
    vi.mocked(api.getHubSessionSkills).mockResolvedValue(view());
    vi.mocked(api.listSkills).mockResolvedValue([SKILL]);
    vi.mocked(api.replaceHubSessionSkills).mockResolvedValue(view());

    renderPanel();
    await waitFor(() => expect(screen.getByText("PDF Processing")).toBeInTheDocument());

    // Radix Select: open via keyboard on the trigger (mirrors this app's own verified pattern for
    // triggers that only listen for pointerdown/keydown, not a synthetic click).
    const trigger = screen.getByRole("combobox", { name: /invocation for pdf processing/i });
    fireEvent.keyDown(trigger, { key: "Enter" });
    const option = await screen.findByRole("option", { name: /user-only/i });
    fireEvent.click(option);

    await waitFor(() =>
      expect(api.replaceHubSessionSkills).toHaveBeenCalledWith("s1", [
        { skillId: "sk-1", versionMode: "latest", invocationMode: "user_only" },
      ]),
    );
  });
});
