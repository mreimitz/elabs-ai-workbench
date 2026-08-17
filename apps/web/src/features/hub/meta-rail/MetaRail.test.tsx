import type {
  HubArtifact,
  HubContextInspector,
  HubFile,
  HubSession,
  HubTaskItem,
} from "@mcp-token-footprint/shared";
import { fireEvent, render as rtlRender, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { TooltipProvider } from "@elabs-ai/components-ui";
import type { ReactElement } from "react";

// ProgressSection composes `Task*` from `@elabs-ai/components-ai` — stub the shared surface (mirrors every other
// hub test that touches `@elabs-ai/components-ai`, e.g. `ArtifactCanvas.test.tsx`/`Mission.test.tsx`).
vi.mock("@elabs-ai/components-ai", () => import("../test-support/brand-ai-mock"));

import type { MetaRailContextProps, MetaRailOutputsProps, MetaRailProgressProps } from "./MetaRail";
import { MetaRail } from "./MetaRail";

// MetaRail renders `IconButton`s (D-TB5), which wrap every control in a Radix `Tooltip` — that
// throws without an ancestor `TooltipProvider` (the app root mounts one; this file's many render()
// call sites don't get it automatically), so `render` here is rebound to always supply one.
function render(ui: ReactElement) {
  return rtlRender(<TooltipProvider>{ui}</TooltipProvider>);
}

function session(overrides: Partial<HubSession> = {}): HubSession {
  return {
    id: "s1",
    kind: "chat",
    title: "Untitled session",
    titleState: "pending",
    mode: "chat",
    model: "claude-sonnet-5",
    status: "running",
    seen: false,
    costUsd: 0,
    tokensIn: 0,
    tokensOut: 0,
    createdAt: "2026-07-17T12:00:00.000Z",
    updatedAt: "2026-07-17T12:00:00.000Z",
    ...overrides,
  };
}

function inspectorFixture(overrides: Partial<HubContextInspector> = {}): HubContextInspector {
  return {
    sessionId: "s1",
    model: "claude-sonnet-5",
    contextWindow: 200_000,
    promptSections: [],
    promptTotalTokens: 0,
    tools: {
      mode: "eager",
      totalTokens: 0,
      residentTokens: 0,
      savingsPercent: 0,
      resident: [],
      deferred: [],
      builtins: [],
    },
    skills: { usage: [], totalTokens: 0 },
    memory: { tokens: 0, itemCount: 0 },
    project: null,
    history: { tokens: 0, messageCount: 0 },
    estimatedTotalTokens: 0,
    ...overrides,
  };
}

function task(over: Partial<HubTaskItem> & { id: string }): HubTaskItem {
  return { title: over.id, status: "pending", ...over };
}

function artifact(over: Partial<HubArtifact> & { id: string }): HubArtifact {
  return {
    kind: "markdown",
    title: over.id,
    latestVersion: 1,
    createdAt: "2026-07-01T00:00:00Z",
    updatedAt: "2026-07-01T00:00:00Z",
    ...over,
  };
}

function file(over: Partial<HubFile> & { id: string }): HubFile {
  return {
    sha256: "abc",
    mime: "text/plain",
    bytes: 100,
    createdAt: "2026-07-01T00:00:00Z",
    ...over,
  };
}

const EMPTY_PROGRESS: MetaRailProgressProps = { tasks: [] };
const EMPTY_OUTPUTS: MetaRailOutputsProps = { artifacts: [], files: [] };
const EMPTY_CONTEXT: MetaRailContextProps = {
  session: session(),
  project: null,
  inspector: inspectorFixture(),
};

describe("MetaRail (WP1.2, D-HUX3 — renders standalone from fixture props)", () => {
  test("renders all three sections with fixture props alone (no network, no context providers)", () => {
    render(
      <MetaRail
        open
        onOpenChange={() => {}}
        isNarrow={false}
        // Outputs collapses by default (the concept wireframe: ▾ Progress · ▸ Outputs · ▾ Context) —
        // open it explicitly here so its content is asserted too.
        defaultOpenSections={{ outputs: true }}
        progress={{ tasks: [task({ id: "t1", title: "Scan the server" })] }}
        outputs={{ artifacts: [artifact({ id: "a1", title: "Report.md" })], files: [] }}
        context={EMPTY_CONTEXT}
      />,
    );
    expect(screen.getByText("Progress")).toBeInTheDocument();
    expect(screen.getByText("Outputs")).toBeInTheDocument();
    expect(screen.getByText("Context")).toBeInTheDocument();
    expect(screen.getByText("Scan the server")).toBeInTheDocument();
    expect(screen.getByText("Report.md")).toBeInTheDocument();
  });

  // Interface-craft WP 1.3 (D-IC.. / interface-review finding 8) — the closed rail used to stay
  // mounted via `aria-hidden` + `pointer-events-none`, which hides it from the a11y tree while
  // leaving its "Hide the rail" button and section tree in the TAB ORDER (focus could enter a region
  // the a11y tree says doesn't exist). Replaced with the `inert` attribute, which removes the subtree
  // from hit-testing AND the tab order in one attribute — no `aria-hidden` on focusable content.
  //
  // jsdom (25.0.1) does not implement `inert`'s focus/hit-test semantics itself (verified: no
  // handling anywhere in jsdom's `living/nodes` sources) — there is no real browser here to enforce
  // "closed = untabbable" for us. So this enumerates every element a real UA would consider
  // focusable (mirrors `AppShell.test.tsx`'s `FOCUSABLE_SELECTOR`) and asserts each one sits under
  // the `inert` node, which is exactly what makes it unfocusable/untabbable once a real UA is in the
  // loop. The true "focusables inside the closed rail = 0" count is a live-DOM measurement (see
  // conventions.md §2) — a PM/owner-acceptance item, not assertable under jsdom.
  const FOCUSABLE_SELECTOR = [
    "a[href]",
    "button:not([disabled])",
    "input:not([disabled])",
    "select:not([disabled])",
    "textarea:not([disabled])",
    "[tabindex]",
  ].join(", ");

  test("wide mode stays MOUNTED (animated, not unmounted) when open=false, and carries `inert` (not aria-hidden)", () => {
    render(
      <MetaRail
        open={false}
        onOpenChange={() => {}}
        isNarrow={false}
        progress={{ tasks: [task({ id: "t1", title: "Scan the server" })] }}
        outputs={EMPTY_OUTPUTS}
        context={EMPTY_CONTEXT}
      />,
    );
    // The wide rail animates open/closed rather than mounting/unmounting — the wrapper stays in the
    // DOM so its width/opacity can transition…
    const wrapper = screen.getByTestId("meta-rail-wide");
    expect(wrapper).toBeInTheDocument();
    // …but while collapsed it carries `inert` and NOT the old aria-hidden/pointer-events-none pair.
    expect(wrapper).toHaveAttribute("inert");
    expect(wrapper).not.toHaveAttribute("aria-hidden");
    expect(wrapper.className).not.toContain("pointer-events-none");
    // The labeled rail surface is still mounted underneath the (inert) wrapper.
    expect(screen.getByLabelText("Session meta rail")).toBeInTheDocument();

    // Every naturally-focusable element in the closed rail (the "Hide the rail" button, the section
    // triggers, the task row, …) sits under the `inert` node, and none carries its own `aria-hidden`.
    const focusables = Array.from(wrapper.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
    expect(focusables.length).toBeGreaterThan(0); // sanity: the rail really does contain controls
    for (const el of focusables) {
      expect(el.closest("[inert]")).toBe(wrapper);
      expect(el).not.toHaveAttribute("aria-hidden");
    }
  });

  test("wide mode is NOT inert (and controls are focusable + un-hidden) when open", () => {
    render(
      <MetaRail
        open
        onOpenChange={() => {}}
        isNarrow={false}
        progress={{ tasks: [task({ id: "t1", title: "Scan the server" })] }}
        outputs={EMPTY_OUTPUTS}
        context={EMPTY_CONTEXT}
      />,
    );
    const wrapper = screen.getByTestId("meta-rail-wide");
    expect(wrapper).not.toHaveAttribute("inert");
    expect(wrapper).not.toHaveAttribute("aria-hidden");
    expect(wrapper.className).not.toContain("pointer-events-none");
    // No regression: the same controls are real, un-inert-ed focusables when open.
    const focusables = Array.from(wrapper.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
    expect(focusables.length).toBeGreaterThan(0);
    for (const el of focusables) {
      expect(el.closest("[inert]")).toBeNull();
    }
  });

  test("the header collapse control hides the rail via onOpenChange(false)", () => {
    const onOpenChange = vi.fn();
    render(
      <MetaRail
        open
        onOpenChange={onOpenChange}
        isNarrow={false}
        progress={EMPTY_PROGRESS}
        outputs={EMPTY_OUTPUTS}
        context={EMPTY_CONTEXT}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Hide the rail" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  test("collapsed sections still show their counts (§8.3)", () => {
    render(
      <MetaRail
        open
        onOpenChange={() => {}}
        isNarrow={false}
        defaultOpenSections={{ progress: false, outputs: false, context: false }}
        progress={{ tasks: [task({ id: "t1" }), task({ id: "t2" })] }}
        outputs={{ artifacts: [artifact({ id: "a1" })], files: [{ file: file({ id: "f1" }) }] }}
        context={EMPTY_CONTEXT}
      />,
    );
    // Progress: 2 tasks -> count 2. Outputs: 1 artifact + 1 file -> count 2. Both survive collapse.
    const counts = screen.getAllByText("2");
    expect(counts.length).toBeGreaterThanOrEqual(2);
    // Collapsed content is not rendered (Radix Collapsible unmounts its content when closed).
    expect(screen.queryByText("Tasks (2)")).not.toBeInTheDocument();
  });

  test("each section collapses independently", () => {
    render(
      <MetaRail
        open
        onOpenChange={() => {}}
        isNarrow={false}
        progress={{ tasks: [task({ id: "t1", title: "Only task" })] }}
        outputs={EMPTY_OUTPUTS}
        context={EMPTY_CONTEXT}
      />,
    );
    expect(screen.getByText("Only task")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /progress/i }));
    expect(screen.queryByText("Only task")).not.toBeInTheDocument();
    // Context (still open by default) is unaffected by collapsing Progress — its own content (a
    // session with no project, per EMPTY_CONTEXT's fixture) stays rendered.
    expect(screen.getByText("No project")).toBeInTheDocument();
  });

  test("isNarrow=true renders the Sheet fallback with the same content instead of the inline column", () => {
    render(
      <MetaRail
        open
        onOpenChange={() => {}}
        isNarrow
        progress={{ tasks: [task({ id: "t1", title: "Narrow task" })] }}
        outputs={EMPTY_OUTPUTS}
        context={EMPTY_CONTEXT}
      />,
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Narrow task")).toBeInTheDocument();
  });

  test("closing the narrow Sheet calls onOpenChange(false)", () => {
    const onOpenChange = vi.fn();
    render(
      <MetaRail
        open
        onOpenChange={onOpenChange}
        isNarrow
        progress={EMPTY_PROGRESS}
        outputs={EMPTY_OUTPUTS}
        context={EMPTY_CONTEXT}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /close/i }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
