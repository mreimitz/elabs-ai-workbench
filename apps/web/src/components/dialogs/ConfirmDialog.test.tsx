import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { ConfirmDialog } from "./ConfirmDialog";

describe("ConfirmDialog", () => {
  test("renders title, description, and a consequence-labeled confirm button", () => {
    render(
      <ConfirmDialog
        open
        onOpenChange={() => {}}
        title="Delete skill?"
        description="This cannot be undone."
        confirmLabel="Delete skill"
        onConfirm={() => {}}
      />,
    );
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    expect(screen.getByText("Delete skill?")).toBeInTheDocument();
    expect(screen.getByText("This cannot be undone.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete skill" })).toBeInTheDocument();
  });

  test("primary (confirm) action is the last/bottom-right button after Cancel", () => {
    render(
      <ConfirmDialog
        open
        onOpenChange={() => {}}
        title="Confirm"
        confirmLabel="Publish"
        onConfirm={() => {}}
      />,
    );
    const dialog = screen.getByRole("alertdialog");
    const buttons = within(dialog).getAllByRole("button");
    const cancelIdx = buttons.findIndex((b) => b.textContent === "Cancel");
    const confirmIdx = buttons.findIndex((b) => b.textContent === "Publish");
    expect(cancelIdx).toBeGreaterThanOrEqual(0);
    // Primary sits AFTER cancel in DOM order → bottom-right via sm:justify-end.
    expect(confirmIdx).toBeGreaterThan(cancelIdx);
  });

  test("fires onConfirm when the confirm button is clicked", () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmDialog
        open
        onOpenChange={() => {}}
        title="Confirm"
        confirmLabel="Delete skill"
        tone="destructive"
        onConfirm={onConfirm}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Delete skill" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  test("disables both actions while busy", () => {
    render(
      <ConfirmDialog
        open
        onOpenChange={() => {}}
        title="Confirm"
        confirmLabel="Delete skill"
        busy
        onConfirm={() => {}}
      />,
    );
    expect(screen.getByRole("button", { name: /Delete skill/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
  });
});
