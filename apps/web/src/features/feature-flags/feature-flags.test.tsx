import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { TooltipProvider } from "@elabs-ai/components-ui";

// Settings › Features — the flag provider, the route gate, and the settings pane. The api module is
// mocked so the provider's on-mount fetch resolves deterministically and no real request is made.
vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return {
    ...actual,
    getFeatureFlags: vi.fn(),
    updateFeatureFlags: vi.fn(),
  };
});

import {
  APP_FEATURE_IDS,
  APP_FEATURE_META,
  type AppFeatureFlags,
  DEFAULT_APP_FEATURE_FLAGS,
} from "@mcp-token-footprint/shared";
import * as api from "../../lib/api";
import { FeaturesSection } from "../settings/FeaturesSection";
import { FeatureGate } from "./FeatureGate";
import { FeatureFlagsProvider, useFeatureEnabled } from "./feature-flags-context";

function renderWithProvider(node: React.ReactNode) {
  return render(
    <MemoryRouter>
      <TooltipProvider>
        <FeatureFlagsProvider>{node}</FeatureFlagsProvider>
      </TooltipProvider>
    </MemoryRouter>,
  );
}

function AssistantProbe() {
  return <span>{useFeatureEnabled("assistant") ? "assistant-on" : "assistant-off"}</span>;
}

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  vi.mocked(api.getFeatureFlags).mockResolvedValue({
    flags: { ...DEFAULT_APP_FEATURE_FLAGS, assistant: true },
  });
  vi.mocked(api.updateFeatureFlags).mockResolvedValue({
    flags: { ...DEFAULT_APP_FEATURE_FLAGS, assistant: false },
  });
});

describe("FeatureFlagsProvider", () => {
  test("adopts the server's map", async () => {
    vi.mocked(api.getFeatureFlags).mockResolvedValue({
      flags: { ...DEFAULT_APP_FEATURE_FLAGS, assistant: false },
    });
    renderWithProvider(<AssistantProbe />);
    expect(await screen.findByText("assistant-off")).toBeTruthy();
  });

  test("a failed fetch leaves every feature ENABLED rather than hiding the app", async () => {
    vi.mocked(api.getFeatureFlags).mockRejectedValue(new Error("API down"));
    renderWithProvider(<AssistantProbe />);
    await waitFor(() => expect(api.getFeatureFlags).toHaveBeenCalled());
    expect(screen.getByText("assistant-on")).toBeTruthy();
  });

  test("mirrors the last-known map so a reload does not flash the feature's surfaces", async () => {
    vi.mocked(api.getFeatureFlags).mockResolvedValue({
      flags: { ...DEFAULT_APP_FEATURE_FLAGS, assistant: false },
    });
    const first = renderWithProvider(<AssistantProbe />);
    expect(await screen.findByText("assistant-off")).toBeTruthy();
    first.unmount();

    // Second mount: the fetch is still pending, but the mirror already knows the answer.
    let resolveFetch: ((value: { flags: AppFeatureFlags }) => void) | undefined;
    vi.mocked(api.getFeatureFlags).mockReturnValue(
      new Promise((resolve) => {
        resolveFetch = resolve;
      }),
    );
    renderWithProvider(<AssistantProbe />);
    expect(screen.getByText("assistant-off")).toBeTruthy();
    // Settle the in-flight fetch inside act() so the adopt() state update belongs to the test.
    await act(async () => {
      resolveFetch?.({ flags: { ...DEFAULT_APP_FEATURE_FLAGS, assistant: false } });
    });
    expect(screen.getByText("assistant-off")).toBeTruthy();
  });
});

describe("FeatureGate", () => {
  test("renders the route while the feature is on", async () => {
    renderWithProvider(
      <FeatureGate feature="assistant">
        <span>the real view</span>
      </FeatureGate>,
    );
    expect(await screen.findByText("the real view")).toBeTruthy();
  });

  test("swaps in an explaining panel — with a link to the switch — while it is off", async () => {
    vi.mocked(api.getFeatureFlags).mockResolvedValue({
      flags: { ...DEFAULT_APP_FEATURE_FLAGS, assistant: false },
    });
    renderWithProvider(
      <FeatureGate feature="assistant">
        <span>the real view</span>
      </FeatureGate>,
    );
    expect(await screen.findByText("Assistant is turned off")).toBeTruthy();
    expect(screen.queryByText("the real view")).toBeNull();
    const link = screen.getByRole("link", { name: /Settings . Features/i });
    expect(link.getAttribute("href")).toBe("/settings/features");
  });
});

describe("Settings › Features", () => {
  test("shows one switch per feature, reflecting the current state", async () => {
    renderWithProvider(<FeaturesSection />);
    const toggle = await screen.findByRole("switch", { name: "Assistant" });
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    // The pane renders straight from the registry, so registering a feature needs no UI change here.
    expect(screen.getAllByRole("switch")).toHaveLength(APP_FEATURE_IDS.length);
    for (const id of APP_FEATURE_IDS) {
      expect(screen.getByRole("switch", { name: APP_FEATURE_META[id].label })).toBeTruthy();
    }
  });

  test("turning a feature OFF confirms first, naming what disappears", async () => {
    renderWithProvider(<FeaturesSection />);
    fireEvent.click(await screen.findByRole("switch", { name: "Assistant" }));

    // Nothing is written until the operator confirms.
    expect(api.updateFeatureFlags).not.toHaveBeenCalled();
    expect(screen.getByText("Turn off Assistant?")).toBeTruthy();
    expect(screen.getByText("The App-assistant dock and its ⌘J shortcut")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Turn off Assistant" }));
    await waitFor(() => expect(api.updateFeatureFlags).toHaveBeenCalledWith({ assistant: false }));
  });

  test("cancelling the confirmation leaves the feature on", async () => {
    renderWithProvider(<FeaturesSection />);
    fireEvent.click(await screen.findByRole("switch", { name: "Assistant" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(api.updateFeatureFlags).not.toHaveBeenCalled();
    expect(screen.getByRole("switch", { name: "Assistant" }).getAttribute("aria-checked")).toBe(
      "true",
    );
  });

  test("turning a feature back ON applies immediately, with no confirmation", async () => {
    vi.mocked(api.getFeatureFlags).mockResolvedValue({
      flags: { ...DEFAULT_APP_FEATURE_FLAGS, assistant: false },
    });
    vi.mocked(api.updateFeatureFlags).mockResolvedValue({
      flags: { ...DEFAULT_APP_FEATURE_FLAGS, assistant: true },
    });
    renderWithProvider(<FeaturesSection />);

    const toggle = await screen.findByRole("switch", { name: "Assistant" });
    await waitFor(() => expect(toggle.getAttribute("aria-checked")).toBe("false"));
    fireEvent.click(toggle);
    await waitFor(() => expect(api.updateFeatureFlags).toHaveBeenCalledWith({ assistant: true }));
    expect(screen.queryByText(/Turn off/)).toBeNull();
  });
});
