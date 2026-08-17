import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { Collection } from "@mcp-token-footprint/shared";
import { TooltipProvider, toast } from "@elabs-ai/components-ui";

// The console's promote flow is STUBBED (no real `POST /api/runs/:id/promote-to-test` route exists
// yet — see `lib/api.ts`'s `promoteRunToTest` doc) — this test proves the WEB side (dialog, the
// client call, the success toast + collection link) end to end against a mocked `lib/api`.
vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return {
    ...actual,
    listCollections: vi.fn(),
    promoteRunToTest: vi.fn(),
  };
});

import { listCollections, promoteRunToTest } from "../../lib/api";
import { PromoteToTestDialog } from "./PromoteToTestDialog";

const mockListCollections = vi.mocked(listCollections);
const mockPromoteRunToTest = vi.mocked(promoteRunToTest);

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
  mockPromoteRunToTest.mockReset();
  mockListCollections.mockResolvedValue([LOCAL, FINANCE]);
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
    mockPromoteRunToTest.mockResolvedValueOnce({ testId: "test-1" });
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
