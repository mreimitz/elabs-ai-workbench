import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { ReviewRubric } from "@mcp-token-footprint/shared";
import { TooltipProvider } from "@brand/ui";

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return {
    ...actual,
    listReviewRubrics: vi.fn(),
    createReviewRubric: vi.fn(),
    updateReviewRubric: vi.fn(),
    deleteReviewRubric: vi.fn(),
  };
});

import {
  createReviewRubric,
  deleteReviewRubric,
  listReviewRubrics,
  updateReviewRubric,
} from "../../lib/api";
import { RubricsView } from "./RubricsView";

const mockList = vi.mocked(listReviewRubrics);
const mockCreate = vi.mocked(createReviewRubric);
const mockUpdate = vi.mocked(updateReviewRubric);
const mockDelete = vi.mocked(deleteReviewRubric);

const QUALITY_RUBRIC: ReviewRubric = {
  id: "rub-1",
  name: "Answer quality",
  instructions: "Judge the final answer.",
  keys: [
    { key: "helpful", kind: "thumbs" },
    { key: "clarity", kind: "scale5" },
  ],
  createdAt: "2026-07-17T00:00:00.000Z",
  updatedAt: "2026-07-17T00:00:00.000Z",
};

function renderView() {
  return render(
    <MemoryRouter>
      <TooltipProvider>
        <RubricsView />
      </TooltipProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  mockList.mockReset();
  mockCreate.mockReset();
  mockUpdate.mockReset();
  mockDelete.mockReset();
  mockList.mockResolvedValue([QUALITY_RUBRIC]);
});

describe("RubricsView — list", () => {
  test("renders each rubric with its key count + key names", async () => {
    renderView();
    expect(await screen.findByText("Answer quality")).toBeInTheDocument();
    expect(screen.getByText("2 keys")).toBeInTheDocument();
    expect(screen.getByText("helpful, clarity")).toBeInTheDocument();
  });

  test("an empty rubric list renders the empty state", async () => {
    mockList.mockReset();
    mockList.mockResolvedValue([]);
    renderView();
    expect(await screen.findByText("No review rubrics yet")).toBeInTheDocument();
  });
});

describe("RubricsView — create", () => {
  test("New rubric opens the editor; filling name + one key creates it", async () => {
    const created: ReviewRubric = {
      id: "rub-2",
      name: "New rubric",
      keys: [{ key: "ok", kind: "thumbs" }],
      createdAt: "2026-07-17T00:00:00.000Z",
      updatedAt: "2026-07-17T00:00:00.000Z",
    };
    mockCreate.mockResolvedValue(created);
    mockList.mockResolvedValueOnce([QUALITY_RUBRIC]).mockResolvedValueOnce([QUALITY_RUBRIC, created]);

    renderView();
    await screen.findByText("Answer quality");

    fireEvent.click(screen.getByRole("button", { name: "New rubric" }));
    expect(await screen.findByText("New review rubric")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "New rubric" } });
    fireEvent.change(screen.getByLabelText("Key 1 name"), { target: { value: "ok" } });

    fireEvent.click(screen.getByRole("button", { name: "Create rubric" }));

    await waitFor(() =>
      expect(mockCreate).toHaveBeenCalledWith({
        name: "New rubric",
        instructions: undefined,
        keys: [{ key: "ok", kind: "thumbs" }],
      }),
    );
  });

  test("submit stays disabled until a name AND at least one named key are present", async () => {
    renderView();
    await screen.findByText("Answer quality");
    fireEvent.click(screen.getByRole("button", { name: "New rubric" }));
    await screen.findByText("New review rubric");

    expect(screen.getByRole("button", { name: "Create rubric" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Only a name" } });
    // No key name typed yet — the one default row is still empty.
    expect(screen.getByRole("button", { name: "Create rubric" })).toBeDisabled();
  });
});

describe("RubricsView — edit / delete", () => {
  test("Edit opens the editor prefilled; saving calls updateReviewRubric", async () => {
    mockUpdate.mockResolvedValue({ ...QUALITY_RUBRIC, name: "Renamed" });
    renderView();
    const row = (await screen.findByText("Answer quality")).closest("li") as HTMLElement;
    fireEvent.click(within(row).getByRole("button", { name: "Edit" }));

    expect(await screen.findByText("Edit rubric")).toBeInTheDocument();
    expect(screen.getByLabelText("Name")).toHaveValue("Answer quality");
    expect(screen.getByLabelText("Key 1 name")).toHaveValue("helpful");

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Renamed" } });
    fireEvent.click(screen.getByRole("button", { name: "Save rubric" }));

    await waitFor(() =>
      expect(mockUpdate).toHaveBeenCalledWith(
        "rub-1",
        expect.objectContaining({ name: "Renamed" }),
      ),
    );
  });

  test("Delete (overflow menu) confirms, then calls deleteReviewRubric", async () => {
    mockDelete.mockResolvedValue(undefined);
    renderView();
    const row = (await screen.findByText("Answer quality")).closest("li") as HTMLElement;
    // Radix's DropdownMenuTrigger only listens for pointerdown/keydown, not click (the established
    // WatchRulesView.test.tsx precedent) — fireEvent.click alone never opens it in jsdom.
    fireEvent.keyDown(within(row).getByRole("button", { name: "More actions for Answer quality" }), {
      key: "Enter",
    });
    fireEvent.click(await screen.findByText("Delete"));

    expect(await screen.findByText("Delete Answer quality?")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Delete rubric" }));

    await waitFor(() => expect(mockDelete).toHaveBeenCalledWith("rub-1"));
  });
});
