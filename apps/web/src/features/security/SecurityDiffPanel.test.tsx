import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { TooltipProvider } from "@elabs-ai/components-ui";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  SECURITY_ANALYZER_VERSION,
  type SecurityFinding,
  type SecurityPostureDiff,
  type SecurityReport,
} from "@mcp-token-footprint/shared";
import { ApiError } from "../../lib/api";

const getScanSecurityDiff = vi.fn();
const getSkillSecurityDiff = vi.fn();

vi.mock("./security-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./security-api")>();
  return {
    ...actual,
    getScanSecurityDiff: (...args: unknown[]) => getScanSecurityDiff(...args),
    getSkillSecurityDiff: (...args: unknown[]) => getSkillSecurityDiff(...args),
  };
});

import { SecurityPanel } from "./SecurityPanel";

// The diff half of the Security tab. Two things matter here and they pull in opposite directions:
// selecting a baseline has to be real URL state (so it can be shared and survives a reload), and a
// REFUSED diff has to stay information rather than becoming a crash — the current report keeps
// rendering, the picker keeps working, and the API's own sentence is what the operator reads.

afterEach(() => {
  vi.clearAllMocks();
});

const BASELINES = [
  { id: "scan_old", label: "19 Aug 2026, 10:00" },
  { id: "scan_older", label: "18 Aug 2026, 10:00" },
];

const finding = (over: Partial<SecurityFinding> = {}): SecurityFinding => ({
  ruleId: "poisoning.injection-phrasing",
  severity: "error",
  anchor: { kind: "tool", toolName: "summarize" },
  message: "The description of “summarize” tells the model to ignore its own instructions.",
  ...over,
});

const subjectRef = (id: string) => ({
  kind: "server" as const,
  id,
  ownerId: "srv_1",
  name: "GitHub",
  capturedAt: "2026-08-20T10:00:00.000Z",
});

const report = (over: Partial<SecurityReport> = {}): SecurityReport => ({
  analyzerVersion: SECURITY_ANALYZER_VERSION,
  generatedAt: "2026-08-20T12:00:00.000Z",
  subject: subjectRef("scan_new"),
  findings: [finding()],
  counts: { error: 1, warning: 0, info: 0, total: 1 },
  score: { value: 85, band: "medium", analyzerVersion: SECURITY_ANALYZER_VERSION },
  truncated: false,
  ...over,
});

const diff = (over: Partial<SecurityPostureDiff> = {}): SecurityPostureDiff => ({
  analyzerVersion: SECURITY_ANALYZER_VERSION,
  generatedAt: "2026-08-20T12:00:00.000Z",
  baseline: { ...subjectRef("scan_old"), capturedAt: "2026-08-19T10:00:00.000Z" },
  subject: subjectRef("scan_new"),
  added: [],
  resolved: [],
  unchanged: [],
  counts: {
    added: { error: 0, warning: 0, info: 0, total: 0 },
    resolved: { error: 0, warning: 0, info: 0, total: 0 },
    unchanged: { error: 0, warning: 0, info: 0, total: 0 },
  },
  score: {
    baseline: { value: 85, band: "medium", analyzerVersion: SECURITY_ANALYZER_VERSION },
    subject: { value: 85, band: "medium", analyzerVersion: SECURITY_ANALYZER_VERSION },
    delta: 0,
  },
  ...over,
});

/** Echoes the live URL so a test can assert what the panel actually wrote to it. */
function LocationProbe() {
  const location = useLocation();
  return <span data-testid="url">{`${location.pathname}${location.search}`}</span>;
}

function renderTab(entry = "/scans/scan_new?tab=security", data: SecurityReport = report()) {
  // `TooltipProvider` mirrors `main.tsx`, which mounts one for the whole app — the posture score's
  // scale hint (RM-37 WP 0.5) is a Radix Tooltip and needs it.
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <TooltipProvider>
        <Routes>
          <Route
            path="/scans/:scanId"
            element={
              <>
                <LocationProbe />
                <SecurityPanel
                  target={{ kind: "scan", scanId: "scan_new" }}
                  baselines={BASELINES}
                  state={{ status: "data", data }}
                  onRetry={() => {}}
                />
              </>
            }
          />
        </Routes>
      </TooltipProvider>
    </MemoryRouter>,
  );
}

function pickBaseline(label: string) {
  fireEvent.click(screen.getByRole("combobox", { name: /baseline scan to compare/i }));
  fireEvent.click(screen.getByRole("option", { name: label }));
}

describe("SecurityDiffPanel — A4: the baseline is URL state", () => {
  it("puts the selection in `?baseline=` and takes it back out when cleared", async () => {
    getScanSecurityDiff.mockResolvedValue(diff());
    renderTab();

    expect(screen.getByTestId("url").textContent).toBe("/scans/scan_new?tab=security");
    pickBaseline("19 Aug 2026, 10:00");

    await waitFor(() =>
      expect(screen.getByTestId("url").textContent).toBe(
        "/scans/scan_new?tab=security&baseline=scan_old",
      ),
    );
    expect(getScanSecurityDiff).toHaveBeenCalledWith("scan_new", "scan_old");

    fireEvent.click(screen.getByRole("button", { name: /clear/i }));
    await waitFor(() =>
      expect(screen.getByTestId("url").textContent).toBe("/scans/scan_new?tab=security"),
    );
  });

  it("reads a baseline straight off the URL on a cold load — the deep link works", async () => {
    getScanSecurityDiff.mockResolvedValue(
      diff({
        added: [finding({ anchor: { kind: "tool", toolName: "arrived" } })],
        counts: {
          added: { error: 1, warning: 0, info: 0, total: 1 },
          resolved: { error: 0, warning: 0, info: 0, total: 0 },
          unchanged: { error: 0, warning: 0, info: 0, total: 0 },
        },
        score: {
          baseline: { value: 100, band: "clean", analyzerVersion: SECURITY_ANALYZER_VERSION },
          subject: { value: 85, band: "medium", analyzerVersion: SECURITY_ANALYZER_VERSION },
          delta: -15,
        },
      }),
    );
    renderTab("/scans/scan_new?tab=security&baseline=scan_old");

    await waitFor(() => expect(getScanSecurityDiff).toHaveBeenCalledWith("scan_new", "scan_old"));
    expect(await screen.findByText("Added")).toBeTruthy();
    expect(screen.getByText("Resolved")).toBeTruthy();
    expect(screen.getByText("Unchanged")).toBeTruthy();
    expect(screen.getByText("arrived")).toBeTruthy();
    // The delta is signed AND worded — direction is never carried by colour alone.
    expect(screen.getByText("−15 worse")).toBeTruthy();
  });

  it("ignores a `?baseline=` naming something that is not selectable", async () => {
    renderTab("/scans/scan_new?tab=security&baseline=scan_from_another_server");
    // No request at all: a stale link resolves to "no baseline", and the plain report renders.
    await waitFor(() => expect(screen.getByText("What was found")).toBeTruthy());
    expect(getScanSecurityDiff).not.toHaveBeenCalled();
  });
});

describe("SecurityDiffPanel — A5/D-SP19: a refusal is information, not a crash", () => {
  const REFUSALS = [
    'Cannot diff security posture: the baseline is a "skill" report and the subject a "server" report. A posture diff compares two scans of one server, or two versions of one skill.',
    'Cannot diff security posture: baseline scan_old belongs to "Other" (srv_2), not to the subject\'s "GitHub" (srv_1).',
    "Cannot diff security posture: baseline scan_old was analysed by security analyzer version 1, and subject scan_new by version 2.",
    "Cannot diff security posture: the subject produced more than 200 findings, so the report lists only the first 200 of them.",
  ];

  for (const [index, message] of REFUSALS.entries()) {
    it(`shows refusal ${index + 1} verbatim while the current report stays visible`, async () => {
      getScanSecurityDiff.mockRejectedValue(new ApiError(400, message));
      renderTab("/scans/scan_new?tab=security&baseline=scan_old");

      // The API's own sentence, not a re-worded one.
      expect(await screen.findByText(message)).toBeTruthy();
      // The report above is untouched: its score, its counts and its findings all still render.
      expect(screen.getByText("Medium risk")).toBeTruthy();
      expect(screen.getByText("1 finding")).toBeTruthy();
      expect(screen.getByText("summarize")).toBeTruthy();
      // And the picker is still usable — a refusal does not lock the operator out of trying another.
      expect(screen.getByRole("combobox", { name: /baseline scan to compare/i })).toBeTruthy();
    });
  }

  it("lets the operator pick a DIFFERENT baseline straight after a refusal", async () => {
    getScanSecurityDiff.mockRejectedValueOnce(new ApiError(400, "Cannot diff security posture: …"));
    getScanSecurityDiff.mockResolvedValueOnce(diff());
    renderTab("/scans/scan_new?tab=security&baseline=scan_old");

    expect(await screen.findByText("Cannot diff security posture: …")).toBeTruthy();
    pickBaseline("18 Aug 2026, 10:00");
    await waitFor(() =>
      expect(getScanSecurityDiff).toHaveBeenLastCalledWith("scan_new", "scan_older"),
    );
    expect(await screen.findByText("Nothing changed")).toBeTruthy();
  });
});

describe("SecurityDiffPanel — A3/D-SP23: three empty buckets are a RESULT", () => {
  it("says nothing changed rather than showing three blank tables", async () => {
    getScanSecurityDiff.mockResolvedValue(
      diff({
        unchanged: [finding()],
        counts: {
          added: { error: 0, warning: 0, info: 0, total: 0 },
          resolved: { error: 0, warning: 0, info: 0, total: 0 },
          unchanged: { error: 1, warning: 0, info: 0, total: 1 },
        },
      }),
    );
    renderTab("/scans/scan_new?tab=security&baseline=scan_old");

    expect(await screen.findByText("Nothing changed")).toBeTruthy();
    expect(screen.getByText(/1 finding carries over unchanged/)).toBeTruthy();
    expect(screen.queryByText("Added")).toBeNull();
    expect(screen.getByText("No change")).toBeTruthy();
  });
});

describe("SecurityDiffPanel — the counts come off the diff, never off a length", () => {
  it("renders each bucket's own per-severity tally", async () => {
    getScanSecurityDiff.mockResolvedValue(
      diff({
        added: [finding()],
        resolved: [finding({ anchor: { kind: "tool", toolName: "gone" } })],
        counts: {
          // Deliberately larger than the arrays: the UI must print the DIFF's tally, not `.length`.
          added: { error: 4, warning: 1, info: 0, total: 5 },
          resolved: { error: 2, warning: 0, info: 1, total: 3 },
          unchanged: { error: 0, warning: 0, info: 0, total: 0 },
        },
      }),
    );
    renderTab("/scans/scan_new?tab=security&baseline=scan_old");

    expect(await screen.findByText("Added")).toBeTruthy();
    expect(screen.getByText("4 error · 1 warning · 0 info")).toBeTruthy();
    expect(screen.getByText("2 error · 0 warning · 1 info")).toBeTruthy();
  });
});

describe("SecurityDiffPanel — a subject with nothing to compare against", () => {
  it("disables the picker and says why, rather than offering an empty list", () => {
    render(
      <MemoryRouter initialEntries={["/scans/scan_new?tab=security"]}>
        <TooltipProvider>
          <SecurityPanel
            target={{ kind: "scan", scanId: "scan_new" }}
            baselines={[]}
            state={{ status: "data", data: report() }}
            onRetry={() => {}}
          />
        </TooltipProvider>
      </MemoryRouter>,
    );
    expect(screen.getByRole("combobox", { name: /baseline scan to compare/i })).toBeDisabled();
    expect(screen.getByText(/only one scan to compare/)).toBeTruthy();
  });
});
