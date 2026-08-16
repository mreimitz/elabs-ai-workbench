/**
 * settings-unsaved.guardrail.test.tsx — design-remediation T5 (item 1, P0) guardrail.
 *
 * Settings used to SILENTLY DESTROY unsaved edits: type into an explicit-save field (OAuth App
 * client id, judge model, run-retention JSON), switch section or press Escape, and the edit was gone
 * with no prompt. The three such sections now publish their form to the dialog, which routes a dirty
 * section switch / close through the shared `DiscardChangesDialog` guard instead of reverting.
 *
 * This renders the real `SettingsDialog` on the GitHub section (the lightest explicit-save section —
 * one mocked fetch), dirties the client-id field, and proves a section switch is INTERCEPTED by the
 * discard guard (not silently applied), and only actually switches once confirmed.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { TooltipProvider } from "@brand/ui";
import { ThemeProvider } from "@brand/tokens";
import type { GithubAccountStatus } from "@mcp-token-footprint/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";

// SettingsView imports the whole `lib/api` surface at module load; preserve every export
// (importOriginal) and override only the GitHub calls the GitHub section makes on mount.
vi.mock("../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/api")>();
  return {
    ...actual,
    getGithubAccount: vi.fn(),
    setGithubClientId: vi.fn(),
    startGithubDeviceFlow: vi.fn(),
    pollGithubDeviceFlow: vi.fn(),
    disconnectGithubAccount: vi.fn(),
  };
});

import * as api from "../lib/api";
import { SettingsDialog } from "../features/settings/SettingsView";

// jsdom lacks matchMedia, which `useThemePreference` (mounted in the dialog body) reads — mirrors the
// polyfill in AppShell.test.tsx.
if (typeof window.matchMedia !== "function") {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

const NO_ACCOUNT: GithubAccountStatus = { connected: false, clientIdConfigured: false };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.getGithubAccount).mockResolvedValue(NO_ACCOUNT);
});

function renderSettings(overrides: Partial<Parameters<typeof SettingsDialog>[0]> = {}) {
  const onSectionChange = vi.fn();
  const onOpenChange = vi.fn();
  render(
    <ThemeProvider defaultTheme="qlik-bright">
      <TooltipProvider delayDuration={0}>
        <SettingsDialog
          open
          section="github"
          onSectionChange={onSectionChange}
          onOpenChange={onOpenChange}
          defaultProfile="generic_o200k"
          health={null}
          onDefaultProfileChange={() => {}}
          {...overrides}
        />
      </TooltipProvider>
    </ThemeProvider>,
  );
  return { onSectionChange, onOpenChange };
}

describe("GUARDRAIL — Settings never silently discards unsaved edits (item 1, P0)", () => {
  it("intercepts a dirty section switch with a discard prompt instead of reverting", async () => {
    const { onSectionChange } = renderSettings();

    const input = (await screen.findByLabelText("OAuth App client ID")) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Iv1.typed-by-hand" } });
    expect(input.value).toBe("Iv1.typed-by-hand");

    // The persistent footer signals the unsaved state (item 6).
    await waitFor(() => expect(screen.getByText("You have unsaved changes.")).toBeInTheDocument());

    // Switching section while dirty must NOT apply immediately — it prompts to discard.
    fireEvent.click(screen.getByRole("button", { name: "General" }));
    expect(await screen.findByText("Discard unsaved changes?")).toBeInTheDocument();
    // Not switched, not reverted: the callback never fired and the typed value survives.
    expect(onSectionChange).not.toHaveBeenCalled();
    expect(input.value).toBe("Iv1.typed-by-hand");
  });

  it("‘Keep editing’ cancels the switch and preserves the edit", async () => {
    const { onSectionChange } = renderSettings();
    const input = (await screen.findByLabelText("OAuth App client ID")) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Iv1.keep-me" } });
    await waitFor(() => expect(screen.getByText("You have unsaved changes.")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "General" }));
    fireEvent.click(await screen.findByRole("button", { name: /keep editing/i }));

    await waitFor(() =>
      expect(screen.queryByText("Discard unsaved changes?")).not.toBeInTheDocument(),
    );
    expect(onSectionChange).not.toHaveBeenCalled();
    expect(input.value).toBe("Iv1.keep-me");
  });

  it("‘Discard changes’ confirms and finally performs the switch", async () => {
    const { onSectionChange } = renderSettings();
    const input = (await screen.findByLabelText("OAuth App client ID")) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Iv1.discard-me" } });
    await waitFor(() => expect(screen.getByText("You have unsaved changes.")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "General" }));
    fireEvent.click(await screen.findByRole("button", { name: /discard changes/i }));

    await waitFor(() => expect(onSectionChange).toHaveBeenCalledWith("general"));
  });

  it("a clean section switches immediately (no prompt when there is nothing to lose)", async () => {
    const { onSectionChange } = renderSettings();
    await screen.findByLabelText("OAuth App client ID"); // section mounted, nothing typed

    fireEvent.click(screen.getByRole("button", { name: "Providers" }));
    expect(screen.queryByText("Discard unsaved changes?")).not.toBeInTheDocument();
    expect(onSectionChange).toHaveBeenCalledWith("providers");
  });
});
