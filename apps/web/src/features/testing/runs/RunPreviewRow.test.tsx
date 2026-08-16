import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import type { RunSummary } from "@mcp-token-footprint/shared";
import { Table, TableBody } from "@brand/ui";
import { RunPreviewRow } from "./RunPreviewRow";

function makeRun(over: Partial<RunSummary> = {}): RunSummary {
  return {
    id: "run-1",
    testId: "test-1",
    scenarioId: "scn-1",
    mode: "automated",
    status: "completed",
    outcome: "completed",
    startedAt: "2026-07-13T00:00:00.000Z",
    turns: 2,
    toolCalls: 1,
    peakContextTokens: 500,
    tokensIn: 100,
    tokensOut: 20,
    costUsd: 0.5,
    ...over,
  };
}

function renderPreview(run: RunSummary, mode: Parameters<typeof RunPreviewRow>[0]["mode"]) {
  return render(
    <Table>
      <TableBody>
        <RunPreviewRow run={run} mode={mode} colSpan={11} />
      </TableBody>
    </Table>,
  );
}

describe("RunPreviewRow", () => {
  test("mode 'none' renders nothing", () => {
    const { container } = renderPreview(makeRun(), "none");
    expect(container.querySelector("tr")).not.toBeInTheDocument();
  });

  test("mode 'snippet' shows the search snippet with its match-kind chip", () => {
    renderPreview(
      makeRun({ searchSnippet: "…found the [tool] result…", searchMatchKind: "tool" }),
      "snippet",
    );
    expect(screen.getByText("…found the [tool] result…")).toBeInTheDocument();
    expect(screen.getByText("Tool call")).toBeInTheDocument();
  });

  test("mode 'snippet' with no hit shows an honest placeholder (never fabricates content)", () => {
    renderPreview(makeRun(), "snippet");
    expect(screen.getByText("No search match to preview on this run.")).toBeInTheDocument();
  });

  test("mode 'lastAssistantText' reuses the snippet ONLY when the hit is assistant-kind", () => {
    renderPreview(
      makeRun({ searchSnippet: "the assistant said…", searchMatchKind: "assistant" }),
      "lastAssistantText",
    );
    expect(screen.getByText("the assistant said…")).toBeInTheDocument();
  });

  test("mode 'lastAssistantText' with a non-assistant hit falls back honestly (no fabrication)", () => {
    renderPreview(
      makeRun({ searchSnippet: "a tool call…", searchMatchKind: "tool" }),
      "lastAssistantText",
    );
    expect(screen.queryByText("a tool call…")).not.toBeInTheDocument();
    expect(
      screen.getByText("No assistant-text preview available — open the run to read its full transcript."),
    ).toBeInTheDocument();
  });

  test("mode 'error' shows the derived status label only for an errored run", () => {
    renderPreview(makeRun({ status: "error", outcome: "error" }), "error");
    expect(screen.getByText("Failed")).toBeInTheDocument();
  });

  test("mode 'error' on a healthy run shows 'No error'", () => {
    renderPreview(makeRun(), "error");
    expect(screen.getByText("No error on this run.")).toBeInTheDocument();
  });

  test("mode 'cost' shows cost + token breakdown from ALREADY-known RunSummary fields", () => {
    renderPreview(makeRun({ costUsd: 1.23, tokensIn: 500, tokensOut: 75 }), "cost");
    expect(screen.getByText(/\$1\.23/)).toBeInTheDocument();
    expect(screen.getByText(/500/)).toBeInTheDocument();
    expect(screen.getByText(/75/)).toBeInTheDocument();
  });

  test("mode 'feedback' shows an honest empty state when the run carries no feedback", () => {
    renderPreview(makeRun(), "feedback");
    expect(screen.getByText("No human feedback on this run yet.")).toBeInTheDocument();
  });

  test("mode 'feedback' renders the run's RunSummary.feedback aggregate as a chip", () => {
    renderPreview(makeRun({ feedback: [{ key: "verdict", score: 1 }] }), "feedback");
    expect(screen.getByText("Your verdict")).toBeInTheDocument();
    expect(screen.queryByText("No human feedback on this run yet.")).not.toBeInTheDocument();
  });
});
