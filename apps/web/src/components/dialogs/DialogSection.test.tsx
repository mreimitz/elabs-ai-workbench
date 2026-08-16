import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { AdvancedGroup, DialogSection } from "./DialogSection";

describe("DialogSection", () => {
  test("renders the section heading, description, and children", () => {
    render(
      <DialogSection title="Basics" description="Name and prompt.">
        <div data-testid="fields">field group</div>
      </DialogSection>,
    );
    expect(screen.getByText("Basics")).toBeInTheDocument();
    expect(screen.getByText("Name and prompt.")).toBeInTheDocument();
    expect(screen.getByTestId("fields")).toHaveTextContent("field group");
  });
});

describe("AdvancedGroup", () => {
  test("is collapsed by default and shows the summary while closed", () => {
    render(
      <AdvancedGroup summary="2 overrides set">
        <div data-testid="advanced-body">expert options</div>
      </AdvancedGroup>,
    );
    // Trigger shows the collapsed label + summary…
    expect(screen.getByRole("button", { name: /Advanced/ })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(screen.getByText("2 overrides set")).toBeInTheDocument();
    // …and the body is not rendered while collapsed (Radix unmounts CollapsibleContent).
    expect(screen.queryByTestId("advanced-body")).not.toBeInTheDocument();
  });

  test("expands to reveal its children and hides the summary", () => {
    render(
      <AdvancedGroup summary="2 overrides set">
        <div data-testid="advanced-body">expert options</div>
      </AdvancedGroup>,
    );
    fireEvent.click(screen.getByRole("button", { name: /Advanced/ }));
    expect(screen.getByRole("button", { name: /Advanced/ })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(screen.getByTestId("advanced-body")).toBeInTheDocument();
    expect(screen.queryByText("2 overrides set")).not.toBeInTheDocument();
  });

  test("honors a custom label and defaultOpen", () => {
    render(
      <AdvancedGroup label="Expert" defaultOpen>
        <div data-testid="body">x</div>
      </AdvancedGroup>,
    );
    expect(screen.getByRole("button", { name: /Expert/ })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByTestId("body")).toBeInTheDocument();
  });
});
