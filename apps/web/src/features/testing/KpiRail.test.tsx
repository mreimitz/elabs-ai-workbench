import type { ReactNode } from "react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { render, screen, within, fireEvent } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import type { GuardrailConfig, RunStep, SessionCapabilities } from "@mcp-token-footprint/shared";
import { TooltipProvider } from "@brand/ui";

// KpiRail now pulls `@brand/ai` (the Context usage popover behind the Context tile); the @brand/ai
// barrel imports xyflow CSS jsdom can't load, so stub it (the repo's standard posture). The popover's
// hover/expand behavior is Radix's, not under test — these stubs keep the tile's own text assertable.
vi.mock("@brand/ai", () => {
  const Pass = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  return {
    Context: Pass,
    ContextTrigger: Pass,
    ContextContent: () => null,
    ContextContentHeader: () => null,
    ContextContentBody: Pass,
    ContextContentFooter: Pass,
  };
});

import { figureRelationshipNote, KpiRail, type KpiRailProps } from "./KpiRail";
import type { RunKpis } from "./use-run-stream";

/**
 * WP 3.2 (Unified Sessions, D-US4) — proves the KPI rail's tile list is built DECLARATIVELY off the
 * run's `SessionCapabilities` manifest, not a `providerKind` fork: an `api_exact` (ordinary
 * chat-completions engine) manifest gets Tool calls + Context + both Tokens tiles, a `$` cost value,
 * and no identity card; a `subscription_reference` manifest drops the Context tile (no meaningful
 * context window) and marks the cost tile "est. · subscription"; a `questions`-cost + identity
 * manifest (Acme) drops Context AND Tool-calls, replaces the headline slot with the assistant-identity
 * card, reads the cost tile as "<N> questions", and — since its `tokens` facet is `"estimated"`, not
 * `"none"` — STILL shows the Tokens tiles, marked "(estimated)" instead of "(provider-actual)".
 */

const NO_GUARDRAILS: GuardrailConfig = {};

const ENGINE_CAPS: SessionCapabilities = {
  liveText: true,
  liveReasoning: "raw",
  toolCalls: true,
  contextWindow: true,
  tokens: "exact",
  costBasis: "api_exact",
  followUps: true,
  askUser: true,
};

const SUBSCRIPTION_CAPS: SessionCapabilities = {
  liveText: true,
  liveReasoning: "none",
  toolCalls: true,
  contextWindow: false,
  tokens: "exact",
  costBasis: "subscription_reference",
  followUps: true,
  askUser: false,
};

function kpis(over: Partial<RunKpis> = {}): RunKpis {
  return {
    turns: 2,
    toolCalls: 3,
    tokensIn: 100,
    tokensOut: 200,
    contextTokens: 500,
    costUsd: 0.05,
    ...over,
  };
}

function renderRail(props: Partial<KpiRailProps> = {}) {
  return render(
    <TooltipProvider>
      <KpiRail
        kpis={kpis()}
        contextLimit={8000}
        guardrails={NO_GUARDRAILS}
        currentContextTokens={500}
        capabilities={ENGINE_CAPS}
        {...props}
      />
    </TooltipProvider>,
  );
}

describe("KpiRail — declarative tile list (WP 3.2, D-US4)", () => {
  test("api_exact manifest: Tool calls + Context + BOTH Tokens tiles render, no identity card", () => {
    renderRail({ capabilities: ENGINE_CAPS });

    expect(screen.getByText("Tool calls")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument(); // toolCalls value
    expect(screen.getByText("Context")).toBeInTheDocument();
    expect(screen.getByText("6%")).toBeInTheDocument(); // 500 / 8000 rounded
    expect(screen.getByText("Tokens ↑")).toBeInTheDocument();
    expect(screen.getByText("Tokens ↓")).toBeInTheDocument();
    expect(screen.getByText("sent (provider-actual)")).toBeInTheDocument();
    // The cost tile reads a plain dollar figure, no subscription marker.
    expect(screen.getByText("$0.05")).toBeInTheDocument();
    expect(screen.queryByText("est.")).not.toBeInTheDocument();
    expect(screen.queryByText("Assistant")).not.toBeInTheDocument();
  });

  test("api_exact manifest: cost description is the generic 'estimated'", () => {
    renderRail({ capabilities: ENGINE_CAPS });
    expect(screen.getByText("estimated")).toBeInTheDocument();
  });

  test("subscription_reference manifest: NO context tile, both Tokens tiles keep 'provider-actual' (tokens:\"exact\"), cost gets the 'est.' subscription marker", () => {
    renderRail({
      capabilities: SUBSCRIPTION_CAPS,
      kpis: kpis({ costUsd: 0.12 }),
    });

    expect(screen.queryByText("Context")).not.toBeInTheDocument();
    expect(screen.queryByText("Assistant")).not.toBeInTheDocument();
    // subscription still declares toolCalls:true and tokens:"exact" — both tiles keep rendering.
    expect(screen.getByText("Tokens ↑")).toBeInTheDocument();
    expect(screen.getByText("sent (provider-actual)")).toBeInTheDocument();
    expect(screen.getByText("Tool calls")).toBeInTheDocument();

    const marker = screen.getByText("est.");
    expect(marker).toBeInTheDocument();
    expect(marker.getAttribute("aria-label")).toMatch(/subscription reference/i);
    expect(screen.getByText("$0.12")).toBeInTheDocument();
    expect(screen.getByText("subscription reference")).toBeInTheDocument();
    expect(screen.queryByText("estimated")).not.toBeInTheDocument();
  });

  test("tokens:\"none\" hides both Tokens tiles entirely", () => {
    renderRail({ capabilities: { ...ENGINE_CAPS, tokens: "none" } });
    expect(screen.queryByText("Tokens ↑")).not.toBeInTheDocument();
    expect(screen.queryByText("Tokens ↓")).not.toBeInTheDocument();
  });

  test("costBasis:\"none\" hides the Est. cost tile entirely", () => {
    renderRail({ capabilities: { ...ENGINE_CAPS, costBasis: "none" } });
    expect(screen.queryByText("Est. cost")).not.toBeInTheDocument();
  });

  test("toolCalls:false (no identity) hides the Tool-calls tile with no replacement", () => {
    renderRail({ capabilities: { ...ENGINE_CAPS, toolCalls: false } });
    expect(screen.queryByText("Tool calls")).not.toBeInTheDocument();
  });

  test("Turns always renders regardless of capabilities", () => {
    renderRail({ capabilities: { ...ENGINE_CAPS, costBasis: "none", tokens: "none", toolCalls: false, contextWindow: false } });
    expect(screen.getByText("Turns")).toBeInTheDocument();
  });
});

// ── Observability WP 3.2 — the hotspots strip ADDITION (capability-tile matrix + grep-proof test) ────

function step(over: Partial<RunStep> & Pick<RunStep, "id" | "type">): RunStep {
  return {
    runId: "run",
    index: 0,
    label: over.type,
    status: "ok",
    profileTokens: {},
    payload: {},
    ...over,
  } as RunStep;
}

const CONTEXT_SEGMENTS_ZERO = { system: 0, tool_defs: 0, history: 0, tool_results: 0, output: 0 };

/** Steps carrying duration + cost-bearing kpi snapshots + a context jump — enough for all 3 hotspots. */
const HOTSPOT_STEPS: RunStep[] = [
  step({ id: "slow", index: 0, type: "tool_call", toolName: "slow-tool", durationMs: 900 }),
  step({
    id: "ctx",
    index: 1,
    type: "llm_response",
    context: { total: 4000, limit: 8000, segments: CONTEXT_SEGMENTS_ZERO },
  }),
];

const HOTSPOT_KPI_MAP = new Map([
  ["slow", { tokensIn: 100, tokensOut: 10, costUsd: 0.02 }],
  ["ctx", { tokensIn: 100, tokensOut: 10, costUsd: 0.02 }],
]);

// T10 ("numbers that do not reconcile") — Context/Tokens ↑/Tokens ↓/Est. cost used to render with no
// stated relationship, reading as four unexplained figures beside any aggregate shown elsewhere.
describe("KpiRail — figure-relationship note (T10)", () => {
  test("api_exact manifest (Context + Tokens + Cost all visible): states all three clauses, scoped to THIS run", () => {
    renderRail({ capabilities: ENGINE_CAPS });
    expect(
      screen.getByText(/Tokens ↑\/↓ are cumulative sends\/receives across this run's turns so far/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Context is this run's current conversation size — a different quantity, not their sum/),
    ).toBeInTheDocument();
    expect(screen.getByText(/Est\. cost is this run's own estimate, not a fleet total/)).toBeInTheDocument();
  });

  test("subscription_reference manifest (no Context tile): the note never mentions Context", () => {
    renderRail({ capabilities: SUBSCRIPTION_CAPS });
    expect(screen.queryByText(/Context is this run's current conversation size/)).not.toBeInTheDocument();
    expect(screen.getByText(/Tokens ↑\/↓ are cumulative/)).toBeInTheDocument();
    expect(screen.getByText(/Est\. cost is this run's own estimate/)).toBeInTheDocument();
  });

  test("costBasis:\"none\" + tokens:\"none\" + contextWindow:false: no note at all (nothing to relate)", () => {
    renderRail({
      capabilities: { ...ENGINE_CAPS, costBasis: "none", tokens: "none", contextWindow: false },
    });
    expect(screen.queryByText(/this run's own estimate/)).not.toBeInTheDocument();
    expect(screen.queryByText(/cumulative sends\/receives/)).not.toBeInTheDocument();
    expect(screen.queryByText(/current conversation size/)).not.toBeInTheDocument();
  });

  test("figureRelationshipNote is pure and null when nothing is visible", () => {
    expect(figureRelationshipNote({ showContext: false, showTokens: false, showCost: false })).toBeNull();
    expect(
      figureRelationshipNote({ showContext: true, showTokens: false, showCost: false }),
    ).toBe("Context is this run's current conversation size — a different quantity, not their sum.");
  });
});

describe("KpiRail — hotspots strip (Observability WP 3.2, ADDITIVE to the D-US4 tile grid above)", () => {
  test("api_exact + contextWindow manifest: all THREE hotspots render as jump-links", () => {
    renderRail({
      capabilities: ENGINE_CAPS,
      steps: HOTSPOT_STEPS,
      kpiByStepId: HOTSPOT_KPI_MAP,
      onSelectStep: () => {},
    });
    expect(screen.getByText("Hotspots")).toBeInTheDocument();
    expect(screen.getByText("Slowest step")).toBeInTheDocument();
    expect(screen.getByText("Costliest step")).toBeInTheDocument();
    expect(screen.getByText("Largest context jump")).toBeInTheDocument();
  });

  test("subscription_reference manifest (contextWindow:false): slowest + costliest render, NO context-jump hotspot", () => {
    renderRail({
      capabilities: SUBSCRIPTION_CAPS,
      steps: HOTSPOT_STEPS,
      kpiByStepId: HOTSPOT_KPI_MAP,
      onSelectStep: () => {},
    });
    expect(screen.getByText("Slowest step")).toBeInTheDocument();
    expect(screen.getByText("Costliest step")).toBeInTheDocument();
    expect(screen.queryByText("Largest context jump")).not.toBeInTheDocument();
  });

  test("costBasis:\"none\": DURATION-ONLY — only the slowest hotspot renders (no honest per-step $ or context figure)", () => {
    renderRail({
      capabilities: { ...ENGINE_CAPS, costBasis: "none", contextWindow: false },
      steps: HOTSPOT_STEPS,
      kpiByStepId: HOTSPOT_KPI_MAP,
      onSelectStep: () => {},
    });
    expect(screen.getByText("Slowest step")).toBeInTheDocument();
    expect(screen.queryByText("Costliest step")).not.toBeInTheDocument();
    expect(screen.queryByText("Largest context jump")).not.toBeInTheDocument();
  });

  test("no timing/cost/context data anywhere renders NO hotspots strip at all (never a fabricated pick)", () => {
    renderRail({
      capabilities: ENGINE_CAPS,
      steps: [step({ id: "s1", index: 0, type: "user_message" })],
      kpiByStepId: new Map(),
      onSelectStep: () => {},
    });
    expect(screen.queryByText("Hotspots")).not.toBeInTheDocument();
  });

  test("no `onSelectStep` handler suppresses the strip entirely — a hotspot with no jump target is not rendered", () => {
    renderRail({ capabilities: ENGINE_CAPS, steps: HOTSPOT_STEPS, kpiByStepId: HOTSPOT_KPI_MAP });
    expect(screen.queryByText("Hotspots")).not.toBeInTheDocument();
  });

  test("clicking a hotspot jump-links to its OWN step id via onSelectStep", () => {
    const onSelectStep = vi.fn();
    renderRail({
      capabilities: ENGINE_CAPS,
      steps: HOTSPOT_STEPS,
      kpiByStepId: HOTSPOT_KPI_MAP,
      onSelectStep,
    });
    fireEvent.click(screen.getByText("Slowest step"));
    expect(onSelectStep).toHaveBeenCalledWith("slow");
  });

  test("null kpiByStepId (a still-live run) keeps the slowest hotspot but drops costliest — never a stale pick", () => {
    renderRail({
      capabilities: ENGINE_CAPS,
      steps: HOTSPOT_STEPS,
      kpiByStepId: null,
      onSelectStep: () => {},
    });
    expect(screen.getByText("Slowest step")).toBeInTheDocument();
    expect(screen.queryByText("Costliest step")).not.toBeInTheDocument();
  });
});

describe("KpiRail — ZERO new `providerKind` conditionals (grep-proof, D-US4)", () => {
  test("the source file's CODE (comments stripped) never references providerKind", () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const source = readFileSync(path.join(here, "KpiRail.tsx"), "utf8");
    // Strip block comments (incl. every JSDoc, which legitimately DISCUSSES providerKind in prose)
    // and line comments before scanning — only real code may never fork on it.
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(code).not.toMatch(/providerKind/);
  });
});
