import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { Button } from "@brand/ui";
import { WideDialog, type WideDialogSection } from "./WideDialog";

const sections: WideDialogSection[] = [
  { id: "basics", label: "Basics", content: <div>Basics content</div> },
  { id: "grading", label: "Grading", content: <div>Grading content</div> },
  { id: "advanced", label: "Advanced", content: <div>Advanced content</div> },
];

describe("WideDialog", () => {
  test("renders the title, the section rail, and the first section by default", () => {
    render(
      <WideDialog
        open
        onOpenChange={() => {}}
        title="Edit test"
        sections={sections}
        primaryLabel="Save as new version"
        onSubmit={() => {}}
      />,
    );
    expect(screen.getByText("Edit test")).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Sections" })).toBeInTheDocument();
    expect(screen.getByText("Basics content")).toBeInTheDocument();
  });

  test("clicking a rail item switches the visible section", () => {
    render(
      <WideDialog
        open
        onOpenChange={() => {}}
        title="Edit test"
        sections={sections}
        primaryLabel="Save"
        onSubmit={() => {}}
      />,
    );
    const nav = screen.getByRole("navigation", { name: "Sections" });
    fireEvent.click(within(nav).getByRole("button", { name: "Grading" }));
    expect(screen.getByText("Grading content")).toBeInTheDocument();
  });

  test("primary (submit) is the last footer button — bottom-right", () => {
    render(
      <WideDialog
        open
        onOpenChange={() => {}}
        title="Edit test"
        sections={sections}
        primaryLabel="Save as new version"
        onSubmit={() => {}}
      />,
    );
    const dialog = screen.getByRole("dialog");
    const buttons = within(dialog).getAllByRole("button");
    const cancelIdx = buttons.findIndex((b) => b.textContent === "Cancel");
    const primaryIdx = buttons.findIndex((b) => b.textContent === "Save as new version");
    expect(cancelIdx).toBeGreaterThanOrEqual(0);
    expect(primaryIdx).toBeGreaterThan(cancelIdx);
  });

  test("headerActions renders next to the title, outside the accessible dialog name", () => {
    render(
      <WideDialog
        open
        onOpenChange={() => {}}
        title="Edit test"
        headerActions={<Button type="button">Ask the assistant</Button>}
        sections={sections}
        primaryLabel="Save"
        onSubmit={() => {}}
      />,
    );
    expect(screen.getByRole("button", { name: "Ask the assistant" })).toBeInTheDocument();
    // The action's own label must not bleed into the dialog's accessible name (it lives outside
    // `DialogTitle` — see the component doc).
    expect(screen.getByRole("dialog", { name: "Edit test" })).toBeInTheDocument();
  });

  test("top-tabs nav renders a tablist", () => {
    render(
      <WideDialog
        open
        onOpenChange={() => {}}
        title="Edit test"
        nav="tabs"
        sections={sections}
        primaryLabel="Save"
        onSubmit={() => {}}
      />,
    );
    expect(screen.getByRole("tablist")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Basics" })).toBeInTheDocument();
  });

  test("dirty guard: Cancel while dirty opens the discard confirm instead of closing", () => {
    const onOpenChange = vi.fn();
    render(
      <WideDialog
        open
        onOpenChange={onOpenChange}
        title="Edit test"
        sections={sections}
        primaryLabel="Save"
        onSubmit={() => {}}
        dirty
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    // The close is intercepted — onOpenChange NOT called yet…
    expect(onOpenChange).not.toHaveBeenCalled();
    // …and the shared discard-changes confirm appears.
    expect(screen.getByText("Discard unsaved changes?")).toBeInTheDocument();

    // Confirming the discard closes the dialog.
    fireEvent.click(screen.getByRole("button", { name: "Discard changes" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  test("not dirty: Cancel closes immediately (no discard confirm)", () => {
    const onOpenChange = vi.fn();
    render(
      <WideDialog
        open
        onOpenChange={onOpenChange}
        title="Edit test"
        sections={sections}
        primaryLabel="Save"
        onSubmit={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(screen.queryByText("Discard unsaved changes?")).not.toBeInTheDocument();
  });
});
