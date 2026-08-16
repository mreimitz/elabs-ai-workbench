import type { HubMemory } from "@mcp-token-footprint/shared";
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("../../../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../lib/api")>();
  return { ...actual, listHubMemory: vi.fn() };
});

import * as api from "../../../../lib/api";
import { MemorySection } from "./MemorySection";

function memory(overrides: Partial<HubMemory> = {}): HubMemory {
  return {
    id: "mem-1",
    kind: "preference",
    content: "Prefers concise bullet summaries.",
    source: "user",
    status: "active",
    scope: "agent",
    scopeId: "role-1",
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("MemorySection — read-only agent-scoped fallback (WP1.5)", () => {
  test("lists only this agent's scoped memory (filters out other scopes/agents)", async () => {
    vi.mocked(api.listHubMemory).mockResolvedValue([
      memory(),
      memory({ id: "mem-2", scope: "profile", scopeId: null, content: "Global fact." }),
      memory({ id: "mem-3", scope: "agent", scopeId: "role-9", content: "Another agent's fact." }),
    ]);
    render(<MemorySection agentId="role-1" />);

    await waitFor(() =>
      expect(screen.getByText("Prefers concise bullet summaries.")).toBeInTheDocument(),
    );
    expect(screen.queryByText("Global fact.")).not.toBeInTheDocument();
    expect(screen.queryByText("Another agent's fact.")).not.toBeInTheDocument();
  });

  test("no agent-scoped memory shows an empty state", async () => {
    vi.mocked(api.listHubMemory).mockResolvedValue([
      memory({ scope: "profile", scopeId: null }),
    ]);
    render(<MemorySection agentId="role-1" />);
    await waitFor(() => expect(screen.getByText("No agent-scoped memory")).toBeInTheDocument());
  });
});

describe("MemorySection — WP2.7 slot", () => {
  test("a provided slot replaces the read-only fallback and suppresses the fetch", () => {
    render(<MemorySection agentId="role-1" slot={<div data-testid="scoped-list">WP2.7 list</div>} />);
    expect(screen.getByTestId("scoped-list")).toBeInTheDocument();
    expect(api.listHubMemory).not.toHaveBeenCalled();
  });
});
