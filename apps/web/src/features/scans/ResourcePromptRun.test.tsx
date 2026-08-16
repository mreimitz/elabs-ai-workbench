import type { ResourceReadResult } from "@mcp-token-footprint/shared";
import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// M4 — `ResourceReadDialog`'s auto-fetch effect called `void read()` on `[open, uri, serverId]` and
// unconditionally applied the response via `setResult`/`setError`/`setAuthExpired`. Retargeting to a
// new `uri` while an earlier read was still in flight let the SLOWER, now-stale response overwrite
// the newer one. Locks the request-token fix: the latest `read()` call always wins.

vi.mock("../servers/McpAuthProvider", () => ({
  useMcpAuth: () => ({ requestReauth: vi.fn() }),
}));

// Stub Monaco (`@brand/editor`) — far too heavy for jsdom; irrelevant to the race being tested.
// Mirrors LiveSkillWorkspaceView.test.tsx's stubbing convention.
vi.mock("@brand/editor", () => ({
  CodeEditor: (props: { value: string; ariaLabel?: string }) => (
    <div data-testid="code-editor" aria-label={props.ariaLabel}>
      {props.value}
    </div>
  ),
}));

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return { ...actual, apiPost: vi.fn() };
});

import * as api from "../../lib/api";
import { ResourceReadDialog } from "./ResourcePromptRun";

function makeResult(uri: string): ResourceReadResult {
  return {
    uri,
    isError: false,
    durationMs: 1,
    tokenProfile: "generic_o200k",
    requestTokens: 1,
    requestBytes: 1,
    responseTokens: 1,
    responseBytes: 1,
    contents: { marker: uri },
    raw: null,
  };
}

describe("ResourceReadDialog — stale-response guard (M4)", () => {
  afterEach(() => {
    vi.mocked(api.apiPost).mockReset();
    vi.restoreAllMocks();
  });

  it("keeps the LATEST targeted uri's result even when the earlier request resolves later", async () => {
    let resolveFirst!: (value: ResourceReadResult) => void;
    const firstPromise = new Promise<ResourceReadResult>((resolve) => {
      resolveFirst = resolve;
    });
    vi.mocked(api.apiPost)
      .mockImplementationOnce(() => firstPromise as Promise<unknown>) // for uri="resource-a"
      .mockResolvedValueOnce(makeResult("resource-b")); // for uri="resource-b"

    const { rerender } = render(
      <ResourceReadDialog open onOpenChange={() => {}} serverId="server-1" uri="resource-a" />,
    );

    // Retarget to a new uri BEFORE the first (slower) request resolves — this fires the auto-fetch
    // effect again and starts a second, newer `read()` call.
    rerender(
      <ResourceReadDialog open onOpenChange={() => {}} serverId="server-1" uri="resource-b" />,
    );

    await waitFor(() =>
      expect(screen.getByTestId("code-editor")).toHaveTextContent(/"marker":\s*"resource-b"/),
    );

    // Now let the STALE first response resolve — it must NOT overwrite the newer result.
    resolveFirst(makeResult("resource-a"));
    await new Promise((r) => setTimeout(r, 0));

    expect(screen.getByTestId("code-editor")).toHaveTextContent(/"marker":\s*"resource-b"/);
    expect(vi.mocked(api.apiPost)).toHaveBeenCalledTimes(2);
  });
});
