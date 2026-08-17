import { fireEvent, render as rtlRender, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { TooltipProvider } from "@elabs-ai/components-ui";
import type { ReactElement } from "react";

// RoleAvatar (the picker's live preview) reaches for `@elabs-ai/components-ai`'s Rive/WebGL `Persona` — stub it.
vi.mock("@elabs-ai/components-ai", () => ({
  Persona: () => <div data-testid="persona" />,
  ModelSelectorLogo: () => <div data-testid="model-logo" />,
}));

import { IconPicker } from "./IconPicker";

// The glyph grid renders `IconButton`s (D-TB5), which wrap every control in a Radix `Tooltip` — that
// throws without an ancestor `TooltipProvider` (the app root mounts one; this file's render doesn't
// get it automatically).
function render(ui: ReactElement) {
  return rtlRender(<TooltipProvider>{ui}</TooltipProvider>);
}

describe("IconPicker", () => {
  test("clicking a library glyph emits its lucide-prefixed value", () => {
    const onChange = vi.fn();
    render(<IconPicker value="" onChange={onChange} previewId="agent-1" />);

    fireEvent.click(screen.getByRole("button", { name: "database" }));
    expect(onChange).toHaveBeenCalledWith("lucide:database");
  });

  test("the search box filters the grid", () => {
    render(<IconPicker value="" onChange={vi.fn()} previewId="agent-1" />);

    // Before filtering, an unrelated glyph is present.
    expect(screen.getByRole("button", { name: "rocket" })).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText("Search icons…"), {
      target: { value: "database" },
    });

    expect(screen.getByRole("button", { name: "database" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "rocket" })).toBeNull();
  });

  test("a selected glyph is marked pressed and offers a clear-to-model-image action", () => {
    const onChange = vi.fn();
    render(<IconPicker value="lucide:brain" onChange={onChange} previewId="agent-1" />);

    expect(screen.getByRole("button", { name: "brain" })).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(screen.getByRole("button", { name: "Use model image" }));
    expect(onChange).toHaveBeenCalledWith("");
  });

  test("with no icon set, there is no clear action (already on the model-image default)", () => {
    render(<IconPicker value="" onChange={vi.fn()} previewId="agent-1" />);
    expect(screen.queryByRole("button", { name: "Use model image" })).toBeNull();
  });

  test("an uploaded image opens on the Upload tab with a Remove affordance", () => {
    const onChange = vi.fn();
    render(
      <IconPicker
        value="data:image/png;base64,AAAA"
        onChange={onChange}
        previewId="agent-1"
      />,
    );

    const remove = screen.getByRole("button", { name: /Remove image/ });
    fireEvent.click(remove);
    expect(onChange).toHaveBeenCalledWith("");
  });
});
