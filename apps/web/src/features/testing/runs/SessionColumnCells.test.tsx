import type { ReactNode } from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import type { SessionCapabilities } from "@mcp-token-footprint/shared";
import { TooltipProvider } from "@elabs-ai/components-ui";
import {
  ActiveDurationCell,
  LastActivityCell,
  SeenMarker,
  SessionKindChip,
  WaitingCell,
} from "./SessionColumnCells";

// Real-clock-relative (not a fixed literal) so `formatRelativeTime`'s render is deterministic without
// mocking system time — mirrors `AssistantDock.test.tsx`'s `hoursAgoIso` convention: an offset large
// enough that ordinary test latency never crosses an hour boundary.
function hoursAgoIso(hours: number): string {
  return new Date(Date.now() - hours * 3_600_000).toISOString();
}

function withTooltip(node: ReactNode) {
  return render(<TooltipProvider>{node}</TooltipProvider>);
}

describe("SessionKindChip", () => {
  test("shows the plain scenario model", () => {
    withTooltip(<SessionKindChip capabilities={undefined} model="claude-sonnet-4-5" />);
    expect(screen.getByText("claude-sonnet-4-5")).toBeInTheDocument();
  });

  test("no model ⇒ honest dash", () => {
    withTooltip(<SessionKindChip capabilities={undefined} model={undefined} />);
    expect(screen.getByText("—")).toBeInTheDocument();
  });
});

describe("ActiveDurationCell — D-US3 default-to-active, honest wall-clock fallback", () => {
  test("activeDurationMs present ⇒ shown with no marker", () => {
    withTooltip(<ActiveDurationCell run={{ activeDurationMs: 65_000, durationMs: 90_000 }} />);
    expect(screen.getByText("1m 5s")).toBeInTheDocument();
    expect(screen.queryByText("(wall)")).not.toBeInTheDocument();
  });

  test("legacy run (no active figure) degrades to wall-clock, MARKED '(wall)'", () => {
    withTooltip(<ActiveDurationCell run={{ activeDurationMs: undefined, durationMs: 4200 }} />);
    expect(screen.getByText("4.20 s")).toBeInTheDocument();
    expect(screen.getByText("(wall)")).toBeInTheDocument();
  });

  test("neither figure known ⇒ honest dash, no marker", () => {
    withTooltip(<ActiveDurationCell run={{ activeDurationMs: undefined, durationMs: undefined }} />);
    expect(screen.getByText("—")).toBeInTheDocument();
    expect(screen.queryByText("(wall)")).not.toBeInTheDocument();
  });
});

describe("WaitingCell — D-US3 waiting = total − active", () => {
  test("both figures known ⇒ the computed remainder", () => {
    withTooltip(<WaitingCell run={{ activeDurationMs: 3000, totalDurationMs: 10_000 }} />);
    expect(screen.getByText("7.00 s")).toBeInTheDocument();
  });

  test("a partial pair (e.g. still-live waiting run) ⇒ honest dash, never a fabricated figure", () => {
    withTooltip(<WaitingCell run={{ activeDurationMs: 3000, totalDurationMs: undefined }} />);
    expect(screen.getByText("—")).toBeInTheDocument();
  });
});

describe("LastActivityCell", () => {
  test("a terminal run (endedAt known) shows its exact instant on the tooltip, no '(from start)' marker", () => {
    const endedAt = hoursAgoIso(3);
    withTooltip(<LastActivityCell run={{ endedAt, startedAt: hoursAgoIso(5) }} />);
    expect(screen.getByText("3h ago")).toBeInTheDocument();
    expect(screen.queryByText("(from start)")).not.toBeInTheDocument();
  });

  test("a still-open/legacy run (no endedAt) falls back to startedAt, MARKED '(from start)'", () => {
    const startedAt = hoursAgoIso(2);
    withTooltip(<LastActivityCell run={{ endedAt: undefined, startedAt }} />);
    expect(screen.getByText("2h ago")).toBeInTheDocument();
    expect(screen.getByText("(from start)")).toBeInTheDocument();
  });
});

describe("SeenMarker — D-US2 unseen finished sessions surface first", () => {
  test("seen:false renders the 'New' unseen marker", () => {
    render(<SeenMarker seen={false} />);
    expect(screen.getByText("New")).toBeInTheDocument();
  });

  test("seen:true renders no marker (a plain dash — nothing alarming)", () => {
    render(<SeenMarker seen={true} />);
    expect(screen.queryByText("New")).not.toBeInTheDocument();
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  test("seen:undefined (a pre-D-US1 legacy run) NEVER falsely claims unseen", () => {
    render(<SeenMarker seen={undefined} />);
    expect(screen.queryByText("New")).not.toBeInTheDocument();
  });
});
