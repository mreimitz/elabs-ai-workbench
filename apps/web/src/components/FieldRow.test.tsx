import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { Input, Text } from "@elabs-ai/components-ui";
import { FieldRow } from "./FieldRow";

// Locks finding 4 / D-IC6: FieldRow associates its error message with the control it labels, once,
// so every one of the ~16 forms built on it inherits the fix. The error `<Text>` gets a stable `id`
// and keeps `role="alert"`; the control gets `aria-describedby` (merged with anything the caller
// already set) and `aria-invalid` while an error is present — and neither when it isn't.

describe("FieldRow — error association (finding 4 / D-IC6)", () => {
  test("with an error, the control has aria-invalid and an aria-describedby that resolves to the alert", () => {
    render(
      <FieldRow id="name" label="Name" error="Name is required">
        <Input id="name" />
      </FieldRow>,
    );
    const control = screen.getByRole("textbox");
    expect(control).toHaveAttribute("aria-invalid", "true");

    const describedBy = control.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    const errorNode = document.getElementById(describedBy as string);
    expect(errorNode).not.toBeNull();
    expect(errorNode?.textContent).toBe("Name is required");
    expect(errorNode).toHaveAttribute("role", "alert");
    expect(errorNode?.id).toBe("name-error");
  });

  test("without an error, the control has no aria-describedby and no dangling error id", () => {
    render(
      <FieldRow id="name" label="Name">
        <Input id="name" />
      </FieldRow>,
    );
    const control = screen.getByRole("textbox");
    expect(control).not.toHaveAttribute("aria-describedby");
    expect(control).not.toHaveAttribute("aria-invalid");
    expect(document.getElementById("name-error")).toBeNull();
  });

  test("a caller-supplied aria-describedby is preserved (space-joined), not overwritten", () => {
    render(
      <FieldRow id="name" label="Name" error="Name is required">
        <Input id="name" aria-describedby="name-hint" />
        <Text id="name-hint">Use your full legal name</Text>
      </FieldRow>,
    );
    const control = screen.getByRole("textbox");
    const describedBy = control.getAttribute("aria-describedby");
    expect(describedBy).toBe("name-hint name-error");
    // Both referenced ids still resolve to real nodes.
    for (const refId of describedBy?.split(" ") ?? []) {
      expect(document.getElementById(refId)).not.toBeNull();
    }
  });

  test("a caller-supplied aria-describedby passes through untouched when there is no error", () => {
    render(
      <FieldRow id="name" label="Name">
        <Input id="name" aria-describedby="name-hint" />
      </FieldRow>,
    );
    const control = screen.getByRole("textbox");
    expect(control).toHaveAttribute("aria-describedby", "name-hint");
  });

  test("the FIRST element child is treated as the control when a trailing helper Text is also rendered", () => {
    // Mirrors real call sites (CollectionEditor's repo-url field, FormSections'/RoleEditor's
    // default-model field) that render the control plus a sibling helper Text alongside it.
    render(
      <FieldRow id="repo-url" label="Repository URL" error="Not a valid URL">
        <Input id="repo-url" />
        <Text data-testid="hint">An HTTPS git remote.</Text>
      </FieldRow>,
    );
    const control = screen.getByRole("textbox");
    expect(control).toHaveAttribute("aria-invalid", "true");
    expect(control).toHaveAttribute("aria-describedby", "repo-url-error");
    // The trailing helper node is preserved unmodified — it does not receive the ARIA injection.
    expect(screen.getByTestId("hint")).not.toHaveAttribute("aria-describedby");
  });

  test("`required` renders a marker after the label AND sets aria-required on the control (T7)", () => {
    render(
      <FieldRow id="url" label="Server URL" required>
        <Input id="url" />
      </FieldRow>,
    );
    const control = screen.getByRole("textbox");
    // The consistent required marker: aria-required on the control (the AT signal) + a visible "*".
    expect(control).toHaveAttribute("aria-required", "true");
    const label = screen.getByText("Server URL").closest("label");
    expect(label?.textContent).toContain("*");
    // The visible asterisk is decorative — hidden from assistive tech (aria-required carries the state).
    expect(label?.querySelector("[aria-hidden]")?.textContent).toContain("*");
  });

  test("without `required`, no marker and no aria-required", () => {
    render(
      <FieldRow id="url" label="Server URL">
        <Input id="url" />
      </FieldRow>,
    );
    const control = screen.getByRole("textbox");
    expect(control).not.toHaveAttribute("aria-required");
    expect(screen.getByText("Server URL").closest("label")?.textContent).not.toContain("*");
  });

  test("the label is wired to the control via htmlFor, and `wide` spans two columns", () => {
    const { container, rerender } = render(
      <FieldRow id="name" label="Name">
        <Input id="name" />
      </FieldRow>,
    );
    expect(screen.getByText("Name")).toHaveAttribute("for", "name");
    expect(container.firstElementChild?.className).not.toContain("sm:col-span-2");

    rerender(
      <FieldRow id="name" label="Name" wide>
        <Input id="name" />
      </FieldRow>,
    );
    expect(container.firstElementChild?.className).toContain("sm:col-span-2");
  });
});
