import type { HubUsageSummary } from "@mcp-token-footprint/shared";
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("../../../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../lib/api")>();
  return { ...actual, apiGet: vi.fn() };
});

import * as api from "../../../../lib/api";
import { UsageSection } from "./UsageSection";

function summary(overrides: Partial<HubUsageSummary> = {}): HubUsageSummary {
  return {
    groupBy: "agent",
    id: "role-1",
    label: "Research Analyst",
    totals: { sessions: 4, costUsd: 1.2345, tokensIn: 12000, tokensOut: 3400 },
    strip: [
      { key: "2026-07-01", label: "2026-07-01", sessions: 1, costUsd: 0.4, tokensIn: 4000, tokensOut: 1000 },
      { key: "2026-07-02", label: "2026-07-02", sessions: 3, costUsd: 0.8, tokensIn: 8000, tokensOut: 2400 },
    ],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("UsageSection — WP1.6 per-agent summary", () => {
  test("requests the agent-scoped summary and renders totals + the daily strip", async () => {
    vi.mocked(api.apiGet).mockResolvedValue(summary());
    render(<UsageSection agentId="role-1" />);

    await waitFor(() => expect(screen.getByText("Sessions")).toBeInTheDocument());
    expect(api.apiGet).toHaveBeenCalledWith(
      "/api/hub/usage/summary?groupBy=agent&id=role-1&days=30",
    );
    expect(screen.getByText("4")).toBeInTheDocument(); // sessions
    expect(screen.getByText("$1.23")).toBeInTheDocument(); // cost, 2dp
    expect(screen.getByText("12,000")).toBeInTheDocument(); // tokens in
    expect(screen.getByLabelText(/Daily token usage/)).toBeInTheDocument();
  });

  test("an agent with no spend shows an honest empty note, not a fake chart", async () => {
    vi.mocked(api.apiGet).mockResolvedValue(
      summary({
        totals: { sessions: 0, costUsd: 0, tokensIn: 0, tokensOut: 0 },
        strip: [],
      }),
    );
    render(<UsageSection agentId="role-1" />);
    await waitFor(() =>
      expect(screen.getByText(/No spend recorded for this agent/i)).toBeInTheDocument(),
    );
  });

  test("a load failure surfaces an error, never a silent blank", async () => {
    vi.mocked(api.apiGet).mockRejectedValue(new Error("boom"));
    render(<UsageSection agentId="role-1" />);
    await waitFor(() => expect(screen.getByText(/Couldn.t load usage/i)).toBeInTheDocument());
  });
});
