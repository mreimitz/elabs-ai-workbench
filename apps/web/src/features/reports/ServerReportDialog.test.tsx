import type { ScanDetail } from "@mcp-token-footprint/shared";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ServerReportDialog } from "./ServerReportDialog";

// M2 — `generate()` used to run four `window.localStorage.setItem(...)` calls BEFORE calling
// `onGenerate(...)`. An unguarded throw (Safari private mode / quota exceeded) aborted the click
// handler entirely, so the report never generated. This locks the fix: persistence is best-effort
// (wrapped in try/catch) and `onGenerate` always fires regardless of localStorage outcome.

vi.mock("../../lib/api", () => ({
  getCompatibilityModels: vi.fn().mockResolvedValue({
    models: [
      {
        id: "claude-opus-4-8",
        providerId: "anthropic",
        providerName: "Anthropic",
        displayName: "Claude Opus 4.8",
        group: "saas",
        status: null,
        contextWindow: 200000,
      },
    ],
  }),
}));

const SCAN: ScanDetail = {
  id: "scan-1",
  serverId: "server-1",
  serverName: "Test Server",
  tokenProfile: "generic_o200k",
  scannedAt: new Date().toISOString(),
  status: "success",
  totalTools: 1,
  totalTokens: 100,
  totalRawBytes: 400,
  averageTokensPerTool: 100,
  largestToolTokens: 100,
  totalResources: 0,
  totalResourceTemplates: 0,
  totalPrompts: 0,
  totalResourceTokens: 0,
  totalPromptTokens: 0,
  largestResourceTokens: 0,
  largestPromptTokens: 0,
  countingVersion: 2,
  tools: [],
  resources: [],
  prompts: [],
  events: [],
};

describe("ServerReportDialog — generate() localStorage guard (M2)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("still calls onGenerate when localStorage.setItem throws", async () => {
    const onGenerate = vi.fn();
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });

    render(<ServerReportDialog open scan={SCAN} onOpenChange={() => {}} onGenerate={onGenerate} />);

    const generateButton = await screen.findByRole("button", { name: "Generate report" });
    await waitFor(() => expect(generateButton).not.toBeDisabled());

    expect(() => fireEvent.click(generateButton)).not.toThrow();
    expect(onGenerate).toHaveBeenCalledTimes(1);
    expect(onGenerate).toHaveBeenCalledWith(
      expect.objectContaining({ scanId: "scan-1", modelIds: ["claude-opus-4-8"] }),
    );
  });
});
