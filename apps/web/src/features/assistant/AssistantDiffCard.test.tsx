import { MemoryRouter } from "react-router-dom";
import { render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import type { SkillDiff } from "@mcp-token-footprint/shared";
import type { AssistantTimelineToolCall } from "./use-assistant-stream";

// `AssistantDiffCard` reuses `DeltaStrip` from `SkillDiffView.tsx`, which ALSO statically imports
// `@elabs-ai/components-editor`'s Monaco `CodeEditor`/`DiffEditor` for its (unused-here) per-file viewer — far too
// heavy for jsdom. Stub it the same way `design-chrome.test.tsx` / the smoke tests do.
vi.mock("@elabs-ai/components-editor", () => ({ CodeEditor: () => null, DiffEditor: () => null }));

import { AssistantDiffCard, extractCommitWorkspaceDiff } from "./AssistantDiffCard";

const DIFF: SkillDiff = {
  skillId: "skill-1",
  fromVersionId: "v1",
  toVersionId: "v2",
  entries: [
    {
      status: "modified",
      path: "SKILL.md",
      kind: "skill_md",
      fromTokens: 40,
      toTokens: 55,
      tokenDelta: 15,
      binary: false,
    },
    {
      status: "added",
      path: "references/NOTES.md",
      kind: "reference",
      toTokens: 20,
      tokenDelta: 20,
      binary: false,
    },
  ],
  rollup: {
    filesAdded: 1,
    filesRemoved: 0,
    filesModified: 1,
    filesRenamed: 0,
    bytesDelta: 120,
    l1Delta: 0,
    l2Delta: 15,
    l3Delta: 20,
    totalDelta: 35,
  },
  manifestDiff: [],
};

function toolCall(overrides: Partial<AssistantTimelineToolCall> = {}): AssistantTimelineToolCall {
  return {
    id: "tu-1",
    toolName: "mcp__assistant-app__skills_commit_workspace",
    input: { skillId: "skill-1" },
    result: {
      value: [
        {
          type: "text",
          text: JSON.stringify({
            unchanged: false,
            skillId: "skill-1",
            versionId: "v2",
            versionLabel: "v2",
            skillLink: "/skills/skill-1",
            diff: DIFF,
          }),
        },
      ],
      isError: false,
    },
    ...overrides,
  };
}

describe("extractCommitWorkspaceDiff", () => {
  test("extracts skillId/versionLabel/diff from a real MCP content-block tool_result", () => {
    const out = extractCommitWorkspaceDiff(toolCall());
    expect(out).toEqual({ skillId: "skill-1", versionLabel: "v2", diff: DIFF });
  });

  test("also accepts an already-parsed plain-object result value (a simplified test double)", () => {
    const out = extractCommitWorkspaceDiff(
      toolCall({
        result: {
          value: { unchanged: false, skillId: "skill-1", versionLabel: "v2", diff: DIFF },
          isError: false,
        },
      }),
    );
    expect(out).toEqual({ skillId: "skill-1", versionLabel: "v2", diff: DIFF });
  });

  test("matches the BARE tool name too (permission_request-style, no mcp__ prefix)", () => {
    const out = extractCommitWorkspaceDiff(toolCall({ toolName: "skills_commit_workspace" }));
    expect(out).not.toBeNull();
  });

  test("returns null for an `unchanged: true` commit — nothing to diff", () => {
    const out = extractCommitWorkspaceDiff(
      toolCall({
        result: {
          value: [
            {
              type: "text",
              text: JSON.stringify({ unchanged: true, skillId: "skill-1", versionId: "v1" }),
            },
          ],
          isError: false,
        },
      }),
    );
    expect(out).toBeNull();
  });

  test("returns null for an error result, a still-running call, or a different tool", () => {
    expect(
      extractCommitWorkspaceDiff(
        toolCall({ result: { value: [{ type: "text", text: "{}" }], isError: true } }),
      ),
    ).toBeNull();
    expect(extractCommitWorkspaceDiff(toolCall({ result: undefined }))).toBeNull();
    expect(
      extractCommitWorkspaceDiff(
        toolCall({ toolName: "mcp__assistant-app__skills_open_workspace" }),
      ),
    ).toBeNull();
  });
});

describe("AssistantDiffCard", () => {
  test("renders the version label, delta-strip rollup counts, and a link to the skill", () => {
    render(
      <MemoryRouter>
        <AssistantDiffCard skillId="skill-1" versionLabel="v2" diff={DIFF} />
      </MemoryRouter>,
    );

    expect(screen.getByText("Skill updated")).toBeInTheDocument();
    expect(screen.getByText("v2")).toBeInTheDocument();
    const link = screen.getByRole("link", { name: /view skill/i });
    expect(link).toHaveAttribute("href", "/skills/skill-1");
    // The reused DeltaStrip rollup — files-added/modified counts and the total token delta.
    expect(screen.getByText("+1")).toBeInTheDocument();
    expect(screen.getByText("~1")).toBeInTheDocument();
  });
});
