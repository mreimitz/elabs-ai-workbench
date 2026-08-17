import { MemoryRouter } from "react-router-dom";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { RatingIssue } from "@mcp-token-footprint/shared";

// The panel's ONLY mutation is the status PATCH — mock it; everything else (the export URL builder
// is pure) stays real. The fetch itself lives in the parent's `useRatingIssues`, so the panel is
// rendered directly with a `Loadable` state (mirrors how the views pass it down).
vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return {
    ...actual,
    updateIssueStatus: vi.fn(),
  };
});

import * as api from "../../lib/api";
import type { Loadable } from "../../lib/loadable";
import { IssuesPanel, buildIssueFixPrompt } from "./IssuesPanel";

function makeIssue(overrides: Partial<RatingIssue> = {}): RatingIssue {
  return {
    id: "iss_1",
    targetKind: "mcp_server",
    targetId: "srv_1",
    targetName: "docs-server",
    title: "search_docs rejects its own documented limit param",
    summary: "Across 4 runs the tool refused the `limit` argument its schema documents.",
    bucket: "mcp_server",
    fixTarget: "mcp_server",
    draftFix: "server: accept the documented `limit` param on search_docs",
    severity: "high",
    status: "open",
    timesSeen: 4,
    firstSeenAt: "2026-07-01T10:00:00Z",
    lastSeenAt: "2026-07-11T10:00:00Z",
    ratingVersion: 1,
    judgeProviderId: null,
    judgeModel: null,
    occurrences: [
      {
        runId: "run_abc12345",
        suiteRunId: "sr_777",
        category: "failed_tool_call",
        message: "tools/call search_docs → invalid params",
        toolName: "search_docs",
        sentArguments: '{"limit":"ten"}',
        errorMessage: "limit must be an integer",
        createdAt: "2026-07-11T10:00:00Z",
      },
    ],
    ...overrides,
  };
}

function renderPanel(props: Partial<Parameters<typeof IssuesPanel>[0]> = {}) {
  const onReload = vi.fn();
  const state: Loadable<RatingIssue[]> = props.state ?? {
    status: "data",
    data: [makeIssue()],
  };
  render(
    <MemoryRouter>
      <IssuesPanel
        targetKind="mcp_server"
        targetId="srv_1"
        targetName="docs-server"
        state={state}
        onReload={onReload}
        {...props}
      />
    </MemoryRouter>,
  );
  return { onReload };
}

beforeEach(() => {
  vi.mocked(api.updateIssueStatus).mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("IssuesPanel", () => {
  test("renders an issue with status/severity/bucket/fixTarget chips, seen count, draft fix and occurrence links", () => {
    renderPanel();

    // Roll-up chips (a single open issue).
    expect(screen.getByText("1 open")).toBeInTheDocument();
    expect(screen.getByText("0 resolved")).toBeInTheDocument();
    expect(screen.getByText("1 high")).toBeInTheDocument();

    // Per-issue chips — the same vocabulary the run Report tab uses for bucket/fixTarget.
    expect(screen.getByText("Open")).toBeInTheDocument();
    expect(screen.getByText("High")).toBeInTheDocument();
    expect(screen.getByText("MCP server")).toBeInTheDocument();
    expect(screen.getByText("Fix in MCP server")).toBeInTheDocument();
    expect(screen.getByText(/seen 4×/)).toBeInTheDocument();

    // Title, summary, and the labeled draft-fix SUGGESTION.
    expect(
      screen.getByText("search_docs rejects its own documented limit param"),
    ).toBeInTheDocument();
    expect(screen.getByText("Draft fix")).toBeInTheDocument();
    expect(screen.getByText(/accept the documented `limit` param/)).toBeInTheDocument();

    // Occurrences deep-link into the run console — and the suite run when one exists.
    const runLink = screen.getByRole("link", { name: /run run_abc1/i });
    expect(runLink).toHaveAttribute("href", "/testing/runs/run_abc12345");
    const suiteLink = screen.getByRole("link", { name: /suite run sr_777/i });
    expect(suiteLink).toHaveAttribute("href", "/testing/suite-runs/sr_777");
  });

  test("an occurrence shows the CONCRETE evidence — the sent parameters and the exact error", () => {
    renderPanel();

    // The actual wrong call + the exact error are surfaced verbatim (not just a category).
    expect(screen.getByText(/Sent parameters · search_docs/)).toBeInTheDocument();
    expect(screen.getByLabelText("Arguments actually sent on the failing tool call")).toHaveTextContent(
      '{"limit":"ten"}',
    );
    expect(screen.getByText("Exact error")).toBeInTheDocument();
    expect(screen.getByLabelText("Exact error returned")).toHaveTextContent(
      "limit must be an integer",
    );
  });

  test("export buttons are real download links to the export routes", () => {
    renderPanel();
    expect(screen.getByRole("link", { name: /export markdown/i })).toHaveAttribute(
      "href",
      "/api/issues/export/markdown?targetKind=mcp_server&targetId=srv_1",
    );
    expect(screen.getByRole("link", { name: /export json/i })).toHaveAttribute(
      "href",
      "/api/issues/export/json?targetKind=mcp_server&targetId=srv_1",
    );
  });

  test("Resolve PATCHes the issue to resolved, then refetches via onReload (optimistic-free)", async () => {
    vi.mocked(api.updateIssueStatus).mockResolvedValue(makeIssue({ status: "resolved" }));
    const { onReload } = renderPanel();

    fireEvent.click(screen.getByRole("button", { name: /resolve/i }));
    await waitFor(() => expect(api.updateIssueStatus).toHaveBeenCalledWith("iss_1", "resolved"));
    await waitFor(() => expect(onReload).toHaveBeenCalled());
  });

  test("Reopen PATCHes a resolved issue back to open; a failure toasts and never reloads", async () => {
    vi.mocked(api.updateIssueStatus).mockRejectedValue(new Error("boom"));
    const { onReload } = renderPanel({
      state: { status: "data", data: [makeIssue({ status: "resolved" })] },
    });

    // A resolved issue offers Reopen (and no assistant action).
    fireEvent.click(screen.getByRole("button", { name: /reopen/i }));
    await waitFor(() => expect(api.updateIssueStatus).toHaveBeenCalledWith("iss_1", "open"));
    // Settled failure → no refetch (the toast carries the error).
    expect(onReload).not.toHaveBeenCalled();
  });

  test("empty list renders the honest empty state", () => {
    renderPanel({ state: { status: "data", data: [] } });
    expect(screen.getByText("No issues recorded")).toBeInTheDocument();
    expect(screen.getByText(/will file them here automatically/i)).toBeInTheDocument();
  });

  test("loading renders a layout-shaped skeleton with a live status (no content yet)", () => {
    renderPanel({ state: { status: "loading" } });
    expect(screen.getByRole("status")).toHaveTextContent(/loading issues/i);
    expect(screen.queryByText("Draft fix")).not.toBeInTheDocument();
  });

  test("a settled fetch failure renders the error slot with a retry that reloads", () => {
    const { onReload } = renderPanel({ state: { status: "error", error: "boom" } });
    expect(screen.getByText("Couldn’t load issues")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(onReload).toHaveBeenCalled();
  });

  test("Fix with assistant renders ONLY for open issues when wired, and passes the issue", () => {
    const onFix = vi.fn();
    const open = makeIssue();
    const resolved = makeIssue({ id: "iss_2", status: "resolved", title: "Another issue" });
    renderPanel({
      targetKind: "skill",
      state: { status: "data", data: [open, resolved] },
      onFixWithAssistant: onFix,
    });

    // Exactly one action — the resolved issue gets none.
    const buttons = screen.getAllByRole("button", { name: /fix with assistant/i });
    expect(buttons).toHaveLength(1);
    fireEvent.click(buttons[0]!);
    expect(onFix).toHaveBeenCalledWith(expect.objectContaining({ id: "iss_1" }));
  });

  test("without the assistant wiring the action never renders (server targets / signed out)", () => {
    renderPanel();
    expect(screen.queryByRole("button", { name: /fix with assistant/i })).not.toBeInTheDocument();
  });

  test("buildIssueFixPrompt carries the skill name, title, summary and draft fix", () => {
    const prompt = buildIssueFixPrompt("acme-analyst", makeIssue());
    expect(prompt).toContain("acme-analyst");
    expect(prompt).toContain("search_docs rejects its own documented limit param");
    expect(prompt).toContain("refused the `limit` argument");
    expect(prompt).toContain("accept the documented `limit` param");
    // The instruction: propose an edit through the approval-gated flow → a new immutable version.
    expect(prompt).toMatch(/new immutable version/i);
    expect(prompt).toMatch(/approval/i);
  });
});
