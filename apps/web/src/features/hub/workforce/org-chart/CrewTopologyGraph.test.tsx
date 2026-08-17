// Renders the REAL @elabs-ai/components-flow canvas under jsdom (the TopologyGraph precedent — ResizeObserver is
// polyfilled in vitest.setup), asserting member labels reach the DOM. Geometry is NOT asserted (canvas
// libs render empty geometry under jsdom); the node/edge MODEL is covered by crew-layout.test.ts.
import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { CrewTopologyGraph } from "./CrewTopologyGraph";
import { makeCrew, makeRole } from "./test-fixtures";

describe("CrewTopologyGraph", () => {
  test("renders a labelled region with a node per member", () => {
    const roles = [
      makeRole("a", { displayName: "Nova", name: "Researcher" }),
      makeRole("b", { name: "Analyst" }),
    ];
    const crew = makeCrew("c1", "pipeline", ["a", "b"], { name: "Alpha" });
    render(<CrewTopologyGraph crew={crew} roles={roles} />);
    expect(screen.getByRole("region", { name: "Alpha topology" })).toBeInTheDocument();
    expect(screen.getByText("Nova")).toBeInTheDocument();
    expect(screen.getByText("Analyst")).toBeInTheDocument();
  });

  test("an empty crew renders a hint, not a blank canvas", () => {
    const crew = makeCrew("c1", "parallel", [], { name: "Empty" });
    render(<CrewTopologyGraph crew={crew} roles={[]} ariaLabel="Empty topology" />);
    expect(screen.getByText(/Add at least one member/)).toBeInTheDocument();
  });
});
