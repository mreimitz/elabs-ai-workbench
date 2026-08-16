import { MemoryRouter } from "react-router-dom";
import { fireEvent, render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import type { RunForkRef } from "@mcp-token-footprint/shared";
import { LineageBanner } from "./LineageBanner";

function renderBanner(props: Parameters<typeof LineageBanner>[0]) {
  render(
    <MemoryRouter>
      <LineageBanner {...props} />
    </MemoryRouter>,
  );
}

test("renders nothing for an ordinary un-forked run", () => {
  const { container } = render(
    <MemoryRouter>
      <LineageBanner />
    </MemoryRouter>,
  );
  expect(container.firstChild).toBeNull();
});

test("child → parent: a derived run links back to its parent + offers Compare with parent", () => {
  const onCompare = vi.fn();
  renderBanner({
    derivedFromRunId: "parent-abcdef12",
    forkStepId: "parent:step:3",
    onCompareWithParent: onCompare,
  });
  expect(screen.getByText(/Forked from run/)).toBeInTheDocument();
  const link = screen.getByRole("link", { name: /parent-a/ });
  expect(link).toHaveAttribute("href", "/testing/runs/parent-abcdef12");
  fireEvent.click(screen.getByRole("button", { name: /compare with parent/i }));
  expect(onCompare).toHaveBeenCalledOnce();
});

test("parent → child: a run that has forks lists them with links", () => {
  const forks: RunForkRef[] = [
    { runId: "aX9kQ2mfDerived", status: "completed", startedAt: "2026-07-16T00:00:00Z" },
    { runId: "bZ7pR4ntDerived", forkStepId: "p:step:2", status: "running", startedAt: "2026-07-16T01:00:00Z" },
  ];
  renderBanner({ forks });
  expect(screen.getByText(/Forked into/)).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /aX9kQ2mf/ })).toHaveAttribute(
    "href",
    "/testing/runs/aX9kQ2mfDerived",
  );
  expect(screen.getByRole("link", { name: /bZ7pR4nt/ })).toHaveAttribute(
    "href",
    "/testing/runs/bZ7pR4ntDerived",
  );
});
