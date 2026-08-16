import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

vi.mock("../../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/api")>();
  return { ...actual, listHubMemory: vi.fn() };
});

import * as api from "../../../lib/api";
import { ProfileMemoryDialog } from "./ProfileMemoryDialog";

describe("ProfileMemoryDialog", () => {
  test("renders the profile ScopedMemoryList when open; Close calls onOpenChange(false)", async () => {
    vi.mocked(api.listHubMemory).mockResolvedValue([]);
    const onOpenChange = vi.fn();
    render(<ProfileMemoryDialog open onOpenChange={onOpenChange} />);

    expect(screen.getByText("Profile memory")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("No memory saved yet")).toBeInTheDocument());

    // Two "Close" buttons exist (the footer's + Radix's own auto X close) — the footer one is first.
    fireEvent.click(screen.getAllByRole("button", { name: "Close" })[0]!);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  test("renders nothing interactive when closed", () => {
    render(<ProfileMemoryDialog open={false} onOpenChange={vi.fn()} />);
    expect(screen.queryByText("Profile memory")).not.toBeInTheDocument();
  });
});
