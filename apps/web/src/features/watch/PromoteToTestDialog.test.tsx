import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { Collection, RunFeedback } from "@mcp-token-footprint/shared";
import { TooltipProvider, toast } from "@elabs-ai/components-ui";

// AM-OB2 — the backing POST /api/runs/:id/promote-to-test route now EXISTS (it was a documented
// stub, so this dialog 404'd in production); the API side is covered by
// apps/api/test/promote-to-test-route.test.ts. This file proves the WEB side (dialog, the client
// call, the corrected-answer preview, the success toast + collection link) against a mocked lib/api.
vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return {
    ...actual,
    listCollections: vi.fn(),
    listRunFeedback: vi.fn(),
    promoteRunToTest: vi.fn(),
  };
});

import { listCollections, listRunFeedback, promoteRunToTest } from "../../lib/api";
import { PromoteToTestDialog } from "./PromoteToTestDialog";

const mockListCollections = vi.mocked(listCollections);
const mockListRunFeedback = vi.mocked(listRunFeedback);
const mockPromoteRunToTest = vi.mocked(promoteRunToTest);

function correctionRow(comment: string): RunFeedback {
  return {
    id: "fb-c",
    runId: "run-42",
    key: "corrected_output",
    comment,
    source: "human",
    createdAt: "2026-08-22T00:00:00.000Z",
  };
}

if (typeof window.matchMedia !== "function") {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

const LOCAL: Collection = {
  id: "col-local",
  name: "Local",
  isDefault: true,
  repoUrl: null,
  repoPath: null,
  branch: null,
  hasPat: false,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};
const FINANCE: Collection = {
  id: "col-finance",
  name: "Finance benchmarks",
  isDefault: false,
  repoUrl: null,
  repoPath: null,
  branch: null,
  hasPat: false,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

function renderDialog(open = true) {
  return render(
    <MemoryRouter>
      <TooltipProvider>
        <PromoteToTestDialog open={open} onOpenChange={() => {}} runId="run-42" />
      </TooltipProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  mockListCollections.mockReset();
  mockListRunFeedback.mockReset();
  mockPromoteRunToTest.mockReset();
  mockListCollections.mockResolvedValue([LOCAL, FINANCE]);
  mockListRunFeedback.mockResolvedValue([]);
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** Wait past the "Loading collections…" state — the picker has swapped in and preselected the
 *  default collection (`getByRole("combobox")` since "Local" also appears, hidden, in the native
 *  `<select>` Radix mirrors for form semantics — the visible trigger is the unambiguous target). */
async function waitForLoaded() {
  await waitFor(() => expect(screen.queryByText("Loading collections…")).not.toBeInTheDocument());
  return screen.getByRole("combobox");
}

describe("PromoteToTestDialog", () => {
  test("loads collections on open and preselects the default one", async () => {
    renderDialog();
    await waitFor(() => expect(mockListCollections).toHaveBeenCalled());
    const trigger = await waitForLoaded();
    expect(trigger).toHaveTextContent("Local");
  });

  test("does not fetch when closed", () => {
    renderDialog(false);
    expect(mockListCollections).not.toHaveBeenCalled();
  });

  test("submit calls promoteRunToTest(runId, collectionId) and shows a success toast with a link action", async () => {
    mockPromoteRunToTest.mockResolvedValueOnce({ testId: "test-1", usedCorrectedOutput: false });
    const successSpy = vi.spyOn(toast, "success").mockImplementation(() => "" as never);

    renderDialog();
    await waitForLoaded();

    fireEvent.click(screen.getByRole("button", { name: "Create draft test" }));

    await waitFor(() =>
      expect(mockPromoteRunToTest).toHaveBeenCalledWith("run-42", "col-local"),
    );
    await waitFor(() =>
      expect(successSpy).toHaveBeenCalledWith(
        "Draft test created",
        expect.objectContaining({
          action: expect.objectContaining({ label: "Open collection" }),
        }),
      ),
    );
    successSpy.mockRestore();
  });

  test("a failed promote surfaces an inline error, not a toast", async () => {
    mockPromoteRunToTest.mockRejectedValueOnce(new Error("run not found"));

    renderDialog();
    await waitForLoaded();

    fireEvent.click(screen.getByRole("button", { name: "Create draft test" }));

    expect(await screen.findByText("run not found")).toBeInTheDocument();
  });
});

// AM-OB2 — promoting is never a blind action. "Nothing was corrected" and "no correction was
// captured" must not render the same, and neither may be claimed from an unfinished fetch.

describe("PromoteToTestDialog — corrected-answer preview (AM-OB2)", () => {
  test("shows the captured corrected answer verbatim, as what the draft will expect", async () => {
    mockListRunFeedback.mockResolvedValue([correctionRow("It should have said 42.")]);
    renderDialog();
    expect(
      await screen.findByText("The draft will expect your corrected answer"),
    ).toBeInTheDocument();
    expect(screen.getByText("It should have said 42.")).toBeInTheDocument();
  });

  test("says so EXPLICITLY when no correction was captured, and what happens instead", async () => {
    mockListRunFeedback.mockResolvedValue([]);
    renderDialog();
    expect(await screen.findByText("No corrected answer was captured")).toBeInTheDocument();
    expect(
      screen.getByText(/carries the source test.s expectations unchanged/),
    ).toBeInTheDocument();
  });

  test("a FAILED feedback lookup claims neither state (an unknown is not a 'no')", async () => {
    mockListRunFeedback.mockRejectedValue(new Error("offline"));
    renderDialog();
    await waitForLoaded();
    expect(screen.queryByText("No corrected answer was captured")).not.toBeInTheDocument();
    expect(
      screen.queryByText("The draft will expect your corrected answer"),
    ).not.toBeInTheDocument();
    // The promote itself is unaffected — the server applies whatever the run really carries.
    expect(screen.getByRole("button", { name: "Create draft test" })).toBeEnabled();
  });

  test("a step-scoped correction is NOT previewed (only a run-level one becomes the expectation)", async () => {
    mockListRunFeedback.mockResolvedValue([
      { ...correctionRow("turn-level nitpick"), stepId: "run-42:step:3" },
    ]);
    renderDialog();
    expect(await screen.findByText("No corrected answer was captured")).toBeInTheDocument();
    expect(screen.queryByText("turn-level nitpick")).not.toBeInTheDocument();
  });

  test("the success toast says the correction was used when the server reports it", async () => {
    mockListRunFeedback.mockResolvedValue([correctionRow("42.")]);
    mockPromoteRunToTest.mockResolvedValueOnce({ testId: "t-9", usedCorrectedOutput: true });
    const successSpy = vi.spyOn(toast, "success").mockImplementation(() => "" as never);

    renderDialog();
    await waitForLoaded();
    fireEvent.click(screen.getByRole("button", { name: "Create draft test" }));

    await waitFor(() =>
      expect(successSpy).toHaveBeenCalledWith(
        "Draft test created",
        expect.objectContaining({
          description: "Promoted into Local, expecting your corrected answer.",
        }),
      ),
    );
    successSpy.mockRestore();
  });
});
