import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, test, vi } from "vitest";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Button,
} from "@elabs-ai/components-ui";
import { EntityCard } from "./EntityCard";

// The D-OD7 activation contract, pinned. Each of these is a real defect the guard prevents: a card
// that navigates when you open its ⋯ menu, a card that navigates twice when you click its title, and
// a card that swallows the end of a text selection as a click.

function renderCard(props?: { onOpen?: () => void; onDelete?: () => void }) {
  const onOpen = props?.onOpen ?? vi.fn();
  return {
    onOpen,
    ...render(
      <MemoryRouter>
        <EntityCard
          title="barc-benchmark"
          href="/servers/abc"
          onOpen={onOpen}
          description="A description"
          actions={
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm">
                  More
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuItem onSelect={() => props?.onDelete?.()}>Delete</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          }
        />
      </MemoryRouter>,
    ),
  };
}

describe("EntityCard", () => {
  test("the title is a real link carrying the entity's href", () => {
    renderCard();
    expect(screen.getByRole("link", { name: "barc-benchmark" })).toHaveAttribute(
      "href",
      "/servers/abc",
    );
  });

  test("a click on the card body opens the entity", () => {
    const { onOpen } = renderCard();
    fireEvent.click(screen.getByText("A description"));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  test("a click on the title link does NOT also fire onOpen (no double navigation)", () => {
    const { onOpen } = renderCard();
    fireEvent.click(screen.getByRole("link", { name: "barc-benchmark" }));
    expect(onOpen).not.toHaveBeenCalled();
  });

  test("a click on a nested control does not open the entity", () => {
    const { onOpen } = renderCard();
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    expect(onOpen).not.toHaveBeenCalled();
  });

  test("a click on a PORTALED menu item does not open the entity", async () => {
    const onDelete = vi.fn();
    const { onOpen } = renderCard({ onDelete });
    // Radix opens on pointerdown/keydown, not a synthetic click — the keyboard path is the one
    // jsdom reproduces faithfully (the repo's existing dropdown tests use it too).
    fireEvent.keyDown(screen.getByRole("button", { name: "More" }), { key: "Enter" });
    const item = await screen.findByRole("menuitem", { name: "Delete" });
    fireEvent.click(item);
    expect(onOpen).not.toHaveBeenCalled();
  });

  test("the tail of a text-selection drag does not open the entity", () => {
    const { onOpen } = renderCard();
    const selection = { isCollapsed: false } as Selection;
    const spy = vi.spyOn(window, "getSelection").mockReturnValue(selection);
    fireEvent.click(screen.getByText("A description"));
    expect(onOpen).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
