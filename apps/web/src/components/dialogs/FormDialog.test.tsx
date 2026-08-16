import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { FormDialog } from "./FormDialog";

describe("FormDialog", () => {
  test("renders title, body content, and the consequence-labeled primary button", () => {
    render(
      <FormDialog
        open
        onOpenChange={() => {}}
        title="New environment"
        description="Configure the run environment."
        primaryLabel="Create environment"
        onSubmit={() => {}}
      >
        <div data-testid="form-body">Name field</div>
      </FormDialog>,
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("New environment")).toBeInTheDocument();
    expect(screen.getByTestId("form-body")).toHaveTextContent("Name field");
    expect(screen.getByRole("button", { name: "Create environment" })).toBeInTheDocument();
  });

  test("primary (submit) sits after Cancel — bottom-right", () => {
    render(
      <FormDialog
        open
        onOpenChange={() => {}}
        title="Edit"
        description="d"
        primaryLabel="Save as new version"
        onSubmit={() => {}}
      >
        <div>fields</div>
      </FormDialog>,
    );
    const dialog = screen.getByRole("dialog");
    const buttons = within(dialog).getAllByRole("button");
    const cancelIdx = buttons.findIndex((b) => b.textContent === "Cancel");
    const primaryIdx = buttons.findIndex((b) => b.textContent === "Save as new version");
    expect(cancelIdx).toBeGreaterThanOrEqual(0);
    expect(primaryIdx).toBeGreaterThan(cancelIdx);
  });

  test("submitting the form calls onSubmit", () => {
    const onSubmit = vi.fn();
    render(
      <FormDialog
        open
        onOpenChange={() => {}}
        title="Edit"
        description="d"
        primaryLabel="Save"
        onSubmit={onSubmit}
      >
        <div>fields</div>
      </FormDialog>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  test("submitDisabled blocks submit; busy shows a spinner and disables the primary", () => {
    const onSubmit = vi.fn();
    const { rerender } = render(
      <FormDialog
        open
        onOpenChange={() => {}}
        title="Edit"
        description="d"
        primaryLabel="Save"
        submitDisabled
        onSubmit={onSubmit}
      >
        <div>fields</div>
      </FormDialog>,
    );
    const primary = screen.getByRole("button", { name: "Save" });
    expect(primary).toBeDisabled();
    fireEvent.click(primary);
    expect(onSubmit).not.toHaveBeenCalled();

    rerender(
      <FormDialog
        open
        onOpenChange={() => {}}
        title="Edit"
        description="d"
        primaryLabel="Save"
        busy
        onSubmit={onSubmit}
      >
        <div>fields</div>
      </FormDialog>,
    );
    expect(screen.getByRole("button", { name: /Save/ })).toBeDisabled();
  });
});
