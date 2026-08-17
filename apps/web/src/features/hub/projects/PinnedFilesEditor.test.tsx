import type { HubFile } from "@mcp-token-footprint/shared";
import { TooltipProvider } from "@elabs-ai/components-ui";
import { fireEvent, render as rtlRender, screen, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("../../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/api")>();
  return {
    ...actual,
    listHubProjectFiles: vi.fn(),
    createHubProjectFile: vi.fn(),
    deleteHubProjectFile: vi.fn(),
  };
});

import * as api from "../../../lib/api";
import { PinnedFilesEditor } from "./PinnedFilesEditor";

// The per-file "Remove" control is an `IconButton` (D-TB5), which wraps every control in a Radix
// `Tooltip` — that throws without an ancestor `TooltipProvider` (the app root mounts one).
function render(ui: ReactElement) {
  return rtlRender(<TooltipProvider>{ui}</TooltipProvider>);
}

function file(overrides: Partial<HubFile> = {}): HubFile {
  return {
    id: "f1",
    sha256: "abc",
    mime: "text/plain",
    bytes: 42,
    filename: "style-guide.md",
    createdAt: "2026-07-10T00:00:00.000Z",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("PinnedFilesEditor — empty state", () => {
  test("shows the quiet one-line empty note when nothing is pinned", async () => {
    vi.mocked(api.listHubProjectFiles).mockResolvedValue([]);
    render(<PinnedFilesEditor projectId="p1" />);
    // ui-wave U6 — a one-line note, not the old full-height dashed EmptyState box.
    await waitFor(() => expect(screen.getByText(/No pinned files yet/)).toBeInTheDocument());
  });
});

describe("PinnedFilesEditor — add", () => {
  test("filling filename + content and clicking Pin creates + prepends the file", async () => {
    vi.mocked(api.listHubProjectFiles).mockResolvedValue([]);
    vi.mocked(api.createHubProjectFile).mockResolvedValue(file());
    render(<PinnedFilesEditor projectId="p1" />);

    await waitFor(() => expect(screen.getByText(/No pinned files yet/)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    fireEvent.change(screen.getByLabelText("Filename"), {
      target: { value: "style-guide.md" },
    });
    fireEvent.change(screen.getByLabelText("Content"), {
      target: { value: "Use tabular-nums for numbers." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Pin" }));

    await waitFor(() =>
      expect(api.createHubProjectFile).toHaveBeenCalledWith("p1", {
        filename: "style-guide.md",
        content: "Use tabular-nums for numbers.",
      }),
    );
    await waitFor(() => expect(screen.getByText("style-guide.md")).toBeInTheDocument());
  });

  test("Pin stays disabled until both filename and content are filled", async () => {
    vi.mocked(api.listHubProjectFiles).mockResolvedValue([]);
    render(<PinnedFilesEditor projectId="p1" />);
    await waitFor(() => expect(screen.getByText(/No pinned files yet/)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    expect(screen.getByRole("button", { name: "Pin" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Filename"), { target: { value: "a.md" } });
    expect(screen.getByRole("button", { name: "Pin" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Content"), { target: { value: "body" } });
    expect(screen.getByRole("button", { name: "Pin" })).toBeEnabled();
  });
});

describe("PinnedFilesEditor — list rows + remove", () => {
  test("a row shows filename + size and Remove deletes the file, returning to the quiet empty note", async () => {
    const existing = file();
    vi.mocked(api.listHubProjectFiles).mockResolvedValue([existing]);
    vi.mocked(api.deleteHubProjectFile).mockResolvedValue(undefined);
    render(<PinnedFilesEditor projectId="p1" />);

    await waitFor(() => expect(screen.getByText("style-guide.md")).toBeInTheDocument());
    // The U6 list row carries the size inline (formatBytes) instead of a table column.
    expect(screen.getByText("42 B")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Remove style-guide.md" }));

    await waitFor(() => expect(api.deleteHubProjectFile).toHaveBeenCalledWith("p1", existing.id));
    await waitFor(() => expect(screen.getByText(/No pinned files yet/)).toBeInTheDocument());
  });
});
