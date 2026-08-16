import { fireEvent, render, screen } from "@testing-library/react";
import { Button } from "@brand/ui";
import { describe, expect, test, vi } from "vitest";
import { WorkbenchDialog } from "./WorkbenchDialog";

describe("WorkbenchDialog", () => {
  test("renders title, header actions, the working surface, and an optional footer", () => {
    render(
      <WorkbenchDialog
        open
        onOpenChange={() => {}}
        title="Tool playground"
        description="Run a tool and measure it."
        headerActions={<Button>Reset</Button>}
        footer={<Button>Run tool</Button>}
      >
        <div data-testid="surface">Playground surface</div>
      </WorkbenchDialog>,
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Tool playground")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reset" })).toBeInTheDocument();
    expect(screen.getByTestId("surface")).toHaveTextContent("Playground surface");
    expect(screen.getByRole("button", { name: "Run tool" })).toBeInTheDocument();
  });

  test("dirty guard: closing while dirty opens the discard confirm instead of closing", () => {
    const onOpenChange = vi.fn();
    render(
      <WorkbenchDialog open onOpenChange={onOpenChange} title="Playground" dirty>
        <div>surface</div>
      </WorkbenchDialog>,
    );
    // The built-in Close (X) triggers a user-initiated close, which the guard intercepts.
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(screen.getByText("Discard unsaved changes?")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Discard changes" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
