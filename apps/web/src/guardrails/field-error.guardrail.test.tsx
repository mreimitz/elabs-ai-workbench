/**
 * field-error.guardrail.test.tsx — interface-craft WP 4.1 guardrail (D-IC6).
 *
 * The CI guardrail that keeps `FieldRow` associating its inline error with the control it labels.
 * Because ~16 forms compose `FieldRow`, this ONE association is what gives every field the fix (the
 * review found `aria-invalid` on 45 fields but `aria-describedby` on only 6). If `FieldRow` stopped
 * emitting `aria-describedby` (→ the error id) or `aria-invalid` when handed an `error`, this goes
 * RED — screen-reader users would lose the "this field, this error" link.
 *
 * Additive to `apps/web/src/components/FieldRow.test.tsx` (the WP 0.2 phase deliverable this WP may
 * not edit): the phase test locks the full behaviour (merge/passthrough/first-child selection); this
 * guardrail pins the two attributes that carry the a11y contract so they can't silently regress.
 */
import { render, screen } from "@testing-library/react";
import { Input } from "@brand/ui";
import { describe, expect, it } from "vitest";
import { FieldRow } from "../components/FieldRow";

describe("GUARDRAIL D-IC6 — FieldRow associates its error with the control", () => {
  it("WITH an error: the control gets aria-invalid AND an aria-describedby that resolves to the alert", () => {
    render(
      <FieldRow id="port" label="Port" error="Port is required">
        <Input id="port" />
      </FieldRow>,
    );
    const control = screen.getByRole("textbox");

    // aria-invalid must be set while an error is present.
    expect(control).toHaveAttribute("aria-invalid", "true");

    // aria-describedby must point at a REAL node that is the error alert carrying the message.
    const describedBy = control.getAttribute("aria-describedby");
    expect(describedBy, "the control must be described by the error").toBeTruthy();
    const errorNode = document.getElementById(describedBy as string);
    expect(errorNode, "aria-describedby must resolve to a live node").not.toBeNull();
    expect(errorNode).toHaveAttribute("role", "alert");
    expect(errorNode?.textContent).toBe("Port is required");
    expect(errorNode?.id).toBe("port-error");
  });

  it("WITHOUT an error: no aria-invalid, no dangling aria-describedby, no orphan error id", () => {
    render(
      <FieldRow id="port" label="Port">
        <Input id="port" />
      </FieldRow>,
    );
    const control = screen.getByRole("textbox");
    expect(control).not.toHaveAttribute("aria-invalid");
    expect(control).not.toHaveAttribute("aria-describedby");
    expect(document.getElementById("port-error")).toBeNull();
  });
});
