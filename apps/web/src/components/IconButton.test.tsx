import { act, render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { TooltipProvider } from "@elabs-ai/components-ui";
import { RefreshCw } from "lucide-react";
import { IconButton } from "./IconButton";

// Locks the D-TB5 contract for the one icon affordance (icon-affordances rule): a SINGLE `label`
// prop drives BOTH the tooltip text AND the `aria-label` (they cannot diverge); a `disabledReason`
// is exposed via the tooltip AND `aria-describedby` and still shows on a disabled control; the
// control is keyboard-focusable with a visible ring; and there is no `title` escape hatch.
//
// The Radix `Tooltip` reads from a `TooltipProvider` (the app root mounts one) and its content only
// mounts on hover/focus. In jsdom a disabled Button carries `pointer-events-none` and hover is not
// reliable, so the tests open the tooltip via FOCUS (Radix opens on focus with no delay), which
// also exercises the keyboard path.
function renderIconButton(ui: React.ReactNode) {
  return render(<TooltipProvider delayDuration={0}>{ui}</TooltipProvider>);
}

async function focus(el: HTMLElement) {
  await act(async () => {
    el.focus();
  });
}

describe("IconButton — the one icon affordance (D-TB5)", () => {
  test("renders a brand-ui Button with the icon child and an aria-label from `label`", () => {
    renderIconButton(
      <IconButton label="Refresh scans" onClick={() => {}}>
        <RefreshCw aria-hidden data-testid="glyph" />
      </IconButton>,
    );
    const btn = screen.getByRole("button", { name: "Refresh scans" });
    expect(btn).toHaveAttribute("aria-label", "Refresh scans");
    expect(btn.tagName).toBe("BUTTON");
    // The glyph is rendered inside the button as its icon child.
    expect(screen.getByTestId("glyph")).toBeInTheDocument();
    expect(btn).toContainElement(screen.getByTestId("glyph"));
    // D-TB5: no native `title` escape hatch is ever emitted.
    expect(btn).not.toHaveAttribute("title");
  });

  test("the tooltip text EQUALS the aria-label — both derived from the one `label` prop", async () => {
    renderIconButton(
      <IconButton label="Refresh scans">
        <RefreshCw aria-hidden />
      </IconButton>,
    );
    const btn = screen.getByRole("button", { name: "Refresh scans" });
    await focus(btn);
    const tip = screen.getByRole("tooltip");
    expect(tip.textContent).toBe("Refresh scans");
    // The two names come from one prop, so they are identical by construction.
    expect(tip.textContent).toBe(btn.getAttribute("aria-label"));
  });

  test("the enabled button is keyboard-focusable and carries a visible focus ring", async () => {
    renderIconButton(
      <IconButton label="Refresh scans">
        <RefreshCw aria-hidden />
      </IconButton>,
    );
    const btn = screen.getByRole("button", { name: "Refresh scans" });
    expect(btn).not.toBeDisabled();
    await focus(btn);
    expect(btn).toHaveFocus();
    // The ring is inherited from `@elabs-ai/components-ui` Button's base variant (token-driven, both themes).
    expect(btn.className).toContain("focus-visible:ring-ring");
  });

  test("size defaults to icon and is overridable", () => {
    const { rerender } = renderIconButton(
      <IconButton label="Refresh">
        <RefreshCw aria-hidden />
      </IconButton>,
    );
    // `size="icon"` → the square `size-9` utility from buttonVariants.
    expect(screen.getByRole("button", { name: "Refresh" }).className).toContain("size-9");
    rerender(
      <TooltipProvider delayDuration={0}>
        <IconButton label="Refresh" size="icon-sm">
          <RefreshCw aria-hidden />
        </IconButton>
      </TooltipProvider>,
    );
    expect(screen.getByRole("button", { name: "Refresh" }).className).toContain("size-8");
  });

  test("disabledReason is wired to aria-describedby and shown in the tooltip on a DISABLED button", async () => {
    renderIconButton(
      <IconButton
        label="Export comparison"
        disabled
        disabledReason="Add a second run to export a comparison."
      >
        <RefreshCw aria-hidden />
      </IconButton>,
    );
    const btn = screen.getByRole("button", { name: "Export comparison" });
    expect(btn).toBeDisabled();

    // aria-describedby points at an element whose text is the reason (reaches AT while closed too).
    const describedBy = btn.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    const reasonNode = document.getElementById(describedBy as string);
    expect(reasonNode).not.toBeNull();
    expect(reasonNode?.textContent).toBe("Add a second run to export a comparison.");

    // The tooltip still opens on the DISABLED control: the wrapper span (not the disabled Button)
    // is the focusable/hoverable Radix trigger. Focus it and assert the reason surfaces.
    const trigger = btn.parentElement as HTMLElement;
    expect(trigger.tagName).toBe("SPAN");
    expect(trigger).toHaveAttribute("tabindex", "0");
    await focus(trigger);
    expect(screen.getByRole("tooltip").textContent).toBe(
      "Add a second run to export a comparison.",
    );
  });

  test("an enabled button exposes no describedby wiring and no extra tab stop on the wrapper", () => {
    renderIconButton(
      <IconButton label="Refresh" disabledReason="Not relevant while enabled.">
        <RefreshCw aria-hidden />
      </IconButton>,
    );
    const btn = screen.getByRole("button", { name: "Refresh" });
    expect(btn).not.toHaveAttribute("aria-describedby");
    // The wrapper span is not a tab stop while the inner button is the focus target.
    expect(btn.parentElement).not.toHaveAttribute("tabindex");
  });
});
