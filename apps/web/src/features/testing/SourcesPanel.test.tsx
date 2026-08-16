import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import type {
  AnswersStepPayload,
  RunDetail,
  RunStep,
  RunSummary,
} from "@mcp-token-footprint/shared";
import { TooltipProvider } from "@brand/ui";

// The drift lookup calls the EXISTING `GET /api/runs` (list) + `GET /api/runs/:id` (detail, via
// `getRun`) — no new endpoint (per the WP). Stub both so tests control the "previous run" comparison
// deterministically without a real network layer (mirrors EnvironmentEditor.test.tsx's api mock).
vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return {
    ...actual,
    apiGet: vi.fn(),
    getRun: vi.fn(),
  };
});

// SourcesPanel's disclosure is now `@brand/ai`'s Sources/SourcesTrigger/SourcesContent; the
// @brand/ai barrel imports xyflow CSS jsdom can't load, so rebuild the three on the REAL `@brand/ui`
// Collapsible — the open/close behavior under test stays real Radix.
vi.mock("@brand/ai", async () => {
  const ui = await import("@brand/ui");
  return {
    Sources: ({ children, className }: { children?: React.ReactNode; className?: string }) => (
      <ui.Collapsible className={className}>{children}</ui.Collapsible>
    ),
    SourcesTrigger: ({
      count,
      children,
      ...props
    }: { count: number; children?: React.ReactNode } & Record<string, unknown>) => (
      <ui.CollapsibleTrigger {...props}>
        {children ?? `Used ${count} sources`}
      </ui.CollapsibleTrigger>
    ),
    SourcesContent: ({ children }: { children?: React.ReactNode }) => (
      <ui.CollapsibleContent>{children}</ui.CollapsibleContent>
    ),
  };
});

import * as api from "../../lib/api";
import { SourcesPanel } from "./SourcesPanel";

function renderPanel(
  payload: AnswersStepPayload,
  testId = "test-1",
  runId: string | null = "run-current",
) {
  return render(
    <TooltipProvider>
      <SourcesPanel payload={payload} testId={testId} runId={runId} />
    </TooltipProvider>,
  );
}

function runSummary(over: Partial<RunSummary> & { id: string }): RunSummary {
  return {
    testId: "test-1",
    scenarioId: "env-1",
    mode: "automated",
    status: "completed",
    outcome: "completed",
    startedAt: "2026-07-01T00:00:00Z",
    turns: 1,
    toolCalls: 0,
    peakContextTokens: 0,
    tokensIn: 10,
    tokensOut: 10,
    costUsd: 0,
    ...over,
  };
}

function runDetail(over: Partial<RunDetail> & { id: string }): RunDetail {
  return {
    ...runSummary(over),
    steps: [],
    events: [],
    skills: [],
    ...over,
  };
}

function llmResponseStep(payload: unknown): RunStep {
  return {
    id: "step-0",
    runId: "prev-run",
    index: 0,
    type: "llm_response",
    label: "answer",
    status: "ok",
    profileTokens: {},
    payload,
  };
}

describe("SourcesPanel", () => {
  test("no sources, no version, not rejected → renders nothing", () => {
    const { container } = renderPanel({});
    expect(container).toBeEmptyDOMElement();
  });

  test("renders each source once the panel is opened", () => {
    vi.mocked(api.apiGet).mockResolvedValue([]);
    renderPanel({
      sources: [
        { source: "handbook/onboarding.pdf", knowledgebaseId: "kb-1", chunks: [1, 2] },
        { source: "policies/refunds.pdf", datasourceId: "ds-9" },
      ],
    });

    fireEvent.click(screen.getByRole("button", { name: /Sources · 2/ }));

    expect(screen.getByText("handbook/onboarding.pdf")).toBeInTheDocument();
    expect(screen.getByText("policies/refunds.pdf")).toBeInTheDocument();
    expect(screen.getByText("KB · kb-1")).toBeInTheDocument();
    expect(screen.getByText("Datasource · ds-9")).toBeInTheDocument();
    expect(screen.getByText("2 chunks")).toBeInTheDocument();
  });

  test("WP 7.1 (DE-DUP) — a snapshots-ONLY payload renders nothing here (the rail's Insights owns it)", () => {
    // The Qlik.Snapshot insights moved ENTIRELY to the monitoring rail (RailInsightsPanel). With no
    // document sources and no version, SourcesPanel has nothing to show — a snapshot-only answer's
    // evidence lives in the rail, exactly once (never duplicated in the chat).
    const { container } = renderPanel({
      snapshots: [
        { title: "Flights by Carrier", reason: "Understanding market share." },
        {
          title: "Delay minutes",
          reason: "Delay comparison.",
          data: { columns: ["min"], rows: [[7]] },
        },
      ],
    });
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole("button", { name: /Insights/ })).not.toBeInTheDocument();
    expect(screen.queryByText("Understanding market share.")).not.toBeInTheDocument();
  });

  test("WP 7.1 — a payload with BOTH sources and snapshots still shows Sources (snapshots stay rail-only)", () => {
    vi.mocked(api.apiGet).mockResolvedValue([]);
    renderPanel({
      sources: [{ source: "handbook/onboarding.pdf" }],
      snapshots: [{ title: "Flights by Carrier", reason: "Understanding market share." }],
    });
    // The document Sources panel renders; the snapshot's insight face does NOT (it's the rail's now).
    expect(screen.getByRole("button", { name: /Sources · 1/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Insights/ })).not.toBeInTheDocument();
    expect(screen.queryByText("Understanding market share.")).not.toBeInTheDocument();
  });

  test("a source with no `source` label falls back to 'Untitled source'", () => {
    vi.mocked(api.apiGet).mockResolvedValue([]);
    renderPanel({ sources: [{ datasourceId: "ds-1" }] });
    fireEvent.click(screen.getByRole("button", { name: /Sources · 1/ }));
    expect(screen.getByText("Untitled source")).toBeInTheDocument();
  });

  test("rejected: true reads as a prompt-declined notice, never an empty answer", () => {
    renderPanel({ rejected: true, sources: [] });
    expect(screen.getByText("Prompt declined")).toBeInTheDocument();
    expect(
      screen.getByText(/tenant assistant's own guardrail rejected this prompt/i),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Sources/ })).not.toBeInTheDocument();
  });

  test("a version with no previous run to compare against renders plainly (outline, no drift)", async () => {
    vi.mocked(api.apiGet).mockResolvedValue([runSummary({ id: "run-current" })]);
    renderPanel({ assistantVersion: "etag-v1" });

    const chip = await screen.findByText("etag-v1");
    await waitFor(() => expect(api.apiGet).toHaveBeenCalledWith("/api/runs"));
    const badge = chip.parentElement;
    expect(badge?.className).not.toContain("bg-warning");
  });

  test("assistant-version drift: a DIFFERENT version on the previous same-test×environment run marks it changed", async () => {
    vi.mocked(api.apiGet).mockResolvedValue([
      runSummary({ id: "run-current", startedAt: "2026-07-02T00:00:00Z" }),
      runSummary({ id: "run-previous", startedAt: "2026-07-01T00:00:00Z" }),
      // a different test's run, same environment, must never be picked
      runSummary({ id: "run-other-test", testId: "test-2", startedAt: "2026-07-01T12:00:00Z" }),
    ]);
    vi.mocked(api.getRun).mockResolvedValue(
      runDetail({
        id: "run-previous",
        steps: [
          llmResponseStep({
            assistantVersion: "etag-OLD",
            promptMode: "oneshot",
            estimatedTokens: true,
          }),
        ],
      }),
    );

    renderPanel({ assistantVersion: "etag-NEW" }, "test-1", "run-current");

    await waitFor(() => expect(api.getRun).toHaveBeenCalledWith("run-previous"));
    const chip = await screen.findByText("etag-NEW");
    const badge = chip.parentElement;
    await waitFor(() => expect(badge?.className).toContain("bg-warning"));
  });

  test("assistant-version drift: the SAME version on the previous run stays unmarked", async () => {
    vi.mocked(api.apiGet).mockResolvedValue([
      runSummary({ id: "run-current", startedAt: "2026-07-02T00:00:00Z" }),
      runSummary({ id: "run-previous", startedAt: "2026-07-01T00:00:00Z" }),
    ]);
    vi.mocked(api.getRun).mockResolvedValue(
      runDetail({
        id: "run-previous",
        steps: [
          llmResponseStep({
            assistantVersion: "etag-SAME",
            promptMode: "oneshot",
            estimatedTokens: true,
          }),
        ],
      }),
    );

    renderPanel({ assistantVersion: "etag-SAME" }, "test-1", "run-current");

    await waitFor(() => expect(api.getRun).toHaveBeenCalledWith("run-previous"));
    const chip = await screen.findByText("etag-SAME");
    // Give the (resolved, non-drift) state a tick to settle before asserting its ABSENCE.
    await new Promise((resolve) => setTimeout(resolve, 0));
    const badge = chip.parentElement;
    expect(badge?.className).not.toContain("bg-warning");
  });
});
