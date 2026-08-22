import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { TooltipProvider } from "@elabs-ai/components-ui";
import type { SkillVersion } from "@mcp-token-footprint/shared";
import { SkillDiffView } from "./SkillDiffView";

// ── RM-30 WP 7.9 — the Diff tab's A/B pickers say "v5", not "v5 · v5" ────────────────────────────
// The API derives a fallback `versionLabel` of exactly `v{seq}` for an editor save (no manifest
// version, no git ref). Skill IDE SI13 fixed the resulting duplicated label ONCE, in
// `formatVersionLabel` — and these two pickers went on composing their own label out of `seq` +
// `versionLabel` and showing "v5 · v5" anyway. This is the assertion that stops it coming back: it
// reads what the OPTION actually renders, not what the helper returns in isolation (the helper's own
// unit tests live beside it, in `design/design-chrome.test.tsx`).
//
// Rendered without a From/To selection, so the view sits in its "Pick two versions" empty state and
// never fetches a diff — the pickers are the whole surface under test.

// Monaco never enters jsdom; the empty state does not mount it, but the module-level import would.
vi.mock("@elabs-ai/components-editor", () => ({
  CodeEditor: () => null,
  DiffEditor: () => null,
}));

const version = (seq: number, versionLabel: string): SkillVersion => ({
  id: `ver-${seq}`,
  skillId: "sk-1",
  seq,
  versionLabel,
  treeSha: `sha-${seq}`,
  sourceKind: "upload",
  manifest: { name: "demo", description: "A demo" },
  manifestValid: true,
  manifestErrors: [],
  fileCount: 2,
  totalBytes: 128,
  importedFrom: "upload",
  createdAt: "2026-07-01T00:00:00.000Z",
  tokenProfile: "generic_o200k",
  l1MetadataTokens: 5,
  l2BodyTokens: 20,
  l3ResourceTokens: 0,
  totalTokens: 25,
});

/** v5 is an editor save (the API's fallback label repeats the sequence); v4 carries a real one. */
const VERSIONS = [version(5, "v5"), version(4, "stable"), version(3, "")];

const renderDiff = () =>
  render(
    <TooltipProvider>
      <SkillDiffView
        skillId="sk-1"
        versions={VERSIONS}
        onChangeFrom={vi.fn()}
        onChangeTo={vi.fn()}
      />
    </TooltipProvider>,
  );

const optionLabels = () =>
  screen.getAllByRole("option").map((option) => option.textContent?.trim());

describe("SkillDiffView — the A/B version pickers", () => {
  test("an editor save reads as `v5`, NOT the duplicated `v5 · v5`", () => {
    renderDiff();
    fireEvent.click(screen.getByRole("combobox", { name: "From version" }));

    const labels = optionLabels();
    expect(labels).toContain("v5");
    expect(labels.some((label) => label?.includes("v5 · v5"))).toBe(false);
  });

  test("a label that ADDS information is still shown", () => {
    renderDiff();
    fireEvent.click(screen.getByRole("combobox", { name: "From version" }));
    expect(optionLabels()).toContain("v4 · stable");
  });

  test("an empty label falls back to the sequence alone", () => {
    renderDiff();
    fireEvent.click(screen.getByRole("combobox", { name: "From version" }));
    expect(optionLabels()).toContain("v3");
  });

  test("BOTH pickers use the same vocabulary — the fix is not half-applied", () => {
    renderDiff();
    fireEvent.click(screen.getByRole("combobox", { name: "To version" }));
    const listbox = screen.getByRole("listbox");
    expect(within(listbox).getByRole("option", { name: "v5" })).toBeInTheDocument();
    expect(within(listbox).queryByRole("option", { name: "v5 · v5" })).toBeNull();
  });
});
