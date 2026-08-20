import { ILLUSTRATION_STATES, type IllustrationRegistryEntry } from "@mcp-token-footprint/shared";
import { ILLUSTRATION_REGISTRY, REGISTRY_VERSION } from "@mcp-token-footprint/illustrations";
import { TooltipProvider } from "@elabs-ai/components-ui";
import { ThemeProvider } from "@elabs-ai/components-tokens";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, test } from "vitest";
import { IllustrationDetail } from "./IllustrationDetail";

const AGENT = ILLUSTRATION_REGISTRY.find(
  (entry) => entry.id === "agent",
) as IllustrationRegistryEntry;
const SERVER = ILLUSTRATION_REGISTRY.find(
  (entry) => entry.id === "mcp-server",
) as IllustrationRegistryEntry;

/** The dialog is controlled by the gallery, so the harness owns the same two pieces of state. */
function Harness({ entry }: { entry: IllustrationRegistryEntry }) {
  const [showPorts, setShowPorts] = useState(false);
  return (
    <ThemeProvider defaultTheme="light">
      <TooltipProvider>
        <IllustrationDetail
          entry={entry}
          open
          onOpenChange={() => undefined}
          showPorts={showPorts}
          onShowPortsChange={setShowPorts}
        />
      </TooltipProvider>
    </ThemeProvider>
  );
}

describe("IllustrationDetail — the states x sizes matrix (system design 5.1)", () => {
  test("draws every state the entry claims, each captioned", () => {
    render(<Harness entry={AGENT} />);
    const states = within(screen.getByRole("dialog")).getByRole("heading", { name: "States" })
      .parentElement as HTMLElement;
    for (const state of ILLUSTRATION_STATES) {
      expect(within(states).getByText(state)).toBeInTheDocument();
    }
  });

  test("draws every footprint the entry claims, framed against ONE box so the scale is real", () => {
    const { container } = render(<Harness entry={AGENT} />);
    const sizes = screen.getByRole("heading", { name: "Sizes" }).parentElement as HTMLElement;
    for (const size of AGENT.sizes) {
      expect(within(sizes).getByText(new RegExp(`^${size.toUpperCase()} · `))).toBeInTheDocument();
    }
    // Same viewBox on every cell in that section: the drawings differ in size, the frames do not.
    const frames = [...sizes.querySelectorAll("svg")].map((svg) => svg.getAttribute("viewBox"));
    expect(frames.length).toBe(AGENT.sizes.length);
    expect(new Set(frames).size).toBe(1);
    // …and the drawings really are three different footprints inside that one frame.
    const drawn = [...sizes.querySelectorAll("[data-illus-size]")].map((node) =>
      node.getAttribute("data-illus-size"),
    );
    expect(drawn).toEqual([...AGENT.sizes]);
    expect(container).toBeTruthy();
  });

  test("shows a Variants section only for a component that has variants", () => {
    const { unmount } = render(<Harness entry={SERVER} />);
    const variants = screen.getByRole("heading", { name: "Variants" }).parentElement as HTMLElement;
    for (const variant of SERVER.variants) {
      expect(within(variants).getByText(variant)).toBeInTheDocument();
    }
    unmount();

    render(<Harness entry={AGENT} />);
    expect(screen.queryByRole("heading", { name: "Variants" })).not.toBeInTheDocument();
  });

  test("always shows both facings — which is how a faceless entity proves it ignores the prop", () => {
    render(<Harness entry={SERVER} />);
    const facing = screen.getByRole("heading", { name: "Facing" }).parentElement as HTMLElement;
    const drawn = [...facing.querySelectorAll("[data-illus-facing]")].map((node) =>
      node.getAttribute("data-illus-facing"),
    );
    expect(drawn).toEqual(["upstream", "downstream"]);
    // The rack front stays on the same face either way (D-IL17: faceless entities ignore `facing`).
    const faces = [...facing.querySelectorAll("[data-illus-glyph-face]")].map((node) =>
      node.getAttribute("data-illus-glyph-face"),
    );
    expect(new Set(faces)).toEqual(new Set(["left"]));
  });
});

describe("IllustrationDetail — the port overlay and the registry entry", () => {
  test("the overlay toggle turns the declared ports on across the whole matrix", () => {
    render(<Harness entry={SERVER} />);
    // The dialog is PORTALLED to document.body, so `container` never contains it — query the dialog.
    const ports = () =>
      new Set(
        [...screen.getByRole("dialog").querySelectorAll("[data-illus-port]")].map((node) =>
          node.getAttribute("data-illus-port"),
        ),
      );
    expect(ports().size).toBe(0);

    fireEvent.click(screen.getByLabelText("Show port overlay"));

    expect(ports()).toEqual(new Set(Object.keys(SERVER.ports)));
  });

  test("publishes the entry itself — ids, tier, ports with their sides, and the registry version", () => {
    render(<Harness entry={SERVER} />);
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText(SERVER.id)).toBeInTheDocument();
    expect(within(dialog).getByText(SERVER.entity as string)).toBeInTheDocument();
    // `0.1.0` is both the entry's `since` and the catalog's version — the same string, twice, on
    // purpose: this is the release the pilot cast first appeared in.
    expect(within(dialog).getAllByText(REGISTRY_VERSION)).toHaveLength(2);
    // Each port renders as one badge carrying its NAME and the SIDE it leaves from, adjacent — so
    // the pair reads as one string. Asserting the concatenation is what makes the test insensitive
    // to the badge's internal markup while still proving name and side are shown together (a port
    // name alone is not enough: `top` is both a port name and a side here).
    const shown = dialog.textContent ?? "";
    for (const [name, port] of Object.entries(SERVER.ports)) {
      expect(shown).toContain(`${name}${port.side}`);
    }
    for (const keyword of SERVER.keywords) {
      // `getAllByText`: a keyword may legitimately also be a variant caption in the matrix above
      // (`stdio` is both), and this assertion is about the keyword list, not about uniqueness.
      expect(within(dialog).getAllByText(keyword).length).toBeGreaterThan(0);
    }
  });

  test("renders nothing at all when no component is selected", () => {
    render(
      <ThemeProvider defaultTheme="light">
        <TooltipProvider>
          <IllustrationDetail
            entry={null}
            open={false}
            onOpenChange={() => undefined}
            showPorts={false}
            onShowPortsChange={() => undefined}
          />
        </TooltipProvider>
      </ThemeProvider>,
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
