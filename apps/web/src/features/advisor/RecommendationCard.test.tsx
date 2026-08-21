import type { AdvisorRecommendation } from "@mcp-token-footprint/shared";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { RecommendationCard, splitDetailNameLists } from "./RecommendationCard";

// Advisor WP 1.3 acceptance — "cards show severity, estimated savings LABELED AS ESTIMATES,
// assumptions, and evidence links that resolve to the real scan / run / tool."

const recommendation: AdvisorRecommendation = {
  id: "advisor.unused-tool-trim:env_1",
  ruleId: "advisor.unused-tool-trim",
  title: "Trim 12 never-called tools from Nightly regression",
  detail: "Across the last 20 completed runs, 12 of the 31 allowed tools were never called.",
  severity: "high",
  savings: {
    value: 9240,
    unit: "tokens_per_turn",
    estimate: true,
    basis: "sum of the 12 never-called tools' definition tokens in scan sc_1",
  },
  evidence: [
    { kind: "scenario", id: "env_1", label: "Nightly regression" },
    { kind: "scan", id: "sc_1", label: "GitHub · scan 2026-08-01T10:00:00.000Z" },
    { kind: "tool_scan", id: "sc_1:create_issue", label: "create_issue" },
    { kind: "run", id: "run_1", label: "run 2026-08-02T10:00:00.000Z" },
    { kind: "server", id: "srv_1", label: "GitHub" },
    { kind: "skill", id: "sk_1", label: "Release notes" },
  ],
  assumptions: ["the last 20 runs are representative of normal use"],
};

/** The shape audit finding P1-1 measured on the running app: the rule's own sentence, then 139
 *  comma-separated identifiers, then the kept list — all one paragraph. */
const NEVER_CALLED = Array.from(
  { length: 139 },
  (_, i) => `qlik_tool_${String(i).padStart(3, "0")}`,
);
const KEPT = Array.from({ length: 21 }, (_, i) => `qlik_kept_${String(i).padStart(2, "0")}`);
const ENUMERATED_DETAIL =
  'Across 4 completed runs of "Stage", 21 of the 160 tools "qlik-stage" exposes to this environment ' +
  "were called. The 139 that never were cost 136,502 of the 172,904 definition tokens this server " +
  `contributes (78.9%). Never called: ${NEVER_CALLED.join(", ")}. ` +
  `Suggested allowedTools: ${KEPT.join(", ")}.`;

function renderCard(over: Partial<AdvisorRecommendation> = {}) {
  return render(
    <MemoryRouter>
      <RecommendationCard recommendation={{ ...recommendation, ...over }} />
    </MemoryRouter>,
  );
}

describe("RecommendationCard", () => {
  it("leads with the severity as TEXT (not colour alone) plus the rule that produced it", () => {
    renderCard();
    expect(screen.getByText("High")).toBeTruthy();
    expect(screen.getByText("Unused tool trim")).toBeTruthy();
  });

  it("renders the title and the detail", () => {
    renderCard();
    expect(screen.getByText(recommendation.title)).toBeTruthy();
    expect(screen.getByText(recommendation.detail)).toBeTruthy();
  });

  it("labels the savings figure as an ESTIMATE and prints the basis that reproduces it", () => {
    renderCard();
    // The word is in the sentence itself, so the number can never be read as a measurement…
    expect(screen.getByText("Estimated saving ≈ 9,240 tokens/turn")).toBeTruthy();
    // …and again as a chip beside the "Estimated saving" heading.
    expect(screen.getByText("Estimate")).toBeTruthy();
    expect(
      screen.getByText(
        "How it was estimated: sum of the 12 never-called tools' definition tokens in scan sc_1",
      ),
    ).toBeTruthy();
  });

  it("omits the estimate block entirely when the rule named no defensible number", () => {
    renderCard({ savings: undefined });
    expect(screen.queryByText("Estimate")).toBeNull();
    expect(screen.queryByText(/Estimated saving/)).toBeNull();
  });

  it("states the assumptions the suggestion rests on", () => {
    renderCard();
    expect(screen.getByText("Assumptions")).toBeTruthy();
    expect(screen.getByText("the last 20 runs are representative of normal use")).toBeTruthy();
  });

  it("renders every evidence ref as a link that resolves to the real entity", () => {
    renderCard();
    const hrefFor = (name: RegExp) => screen.getByRole("link", { name }).getAttribute("href");

    expect(hrefFor(/^Scan: GitHub/)).toBe("/scans/sc_1");
    // A tool citation lands on the TOOL, not merely on the scan that contains it.
    expect(hrefFor(/^Tool: create_issue/)).toBe("/scans/sc_1?tool=create_issue");
    expect(hrefFor(/^Run: run 2026-08-02/)).toBe("/testing/runs/run_1");
    expect(hrefFor(/^Server: GitHub$/)).toBe("/servers/srv_1");
    expect(hrefFor(/^Skill: Release notes/)).toBe("/skills/sk_1");
    expect(hrefFor(/^Environment: Nightly regression/)).toBe("/testing/environments");
  });

  it("groups the evidence under an accessible list naming the recommendation", () => {
    renderCard();
    const list = screen.getByRole("list", { name: `Evidence for ${recommendation.title}` });
    expect(list.querySelectorAll("li")).toHaveLength(recommendation.evidence.length);
  });

  it("degrades an unresolvable ref to plain labelled text rather than a dead link", () => {
    renderCard({
      evidence: [{ kind: "tool_scan", id: "malformed-no-colon", label: "create_issue" }],
    });
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText("Tool: create_issue")).toBeTruthy();
  });

  it("offers no way to APPLY the advice — the app never auto-applies a recommendation", () => {
    renderCard();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("adds no apply affordance when the body carries disclosures — they are the only buttons", () => {
    renderCard({ detail: ENUMERATED_DETAIL });
    expect(screen.getAllByRole("button").map((button) => button.textContent)).toEqual([
      "Show 139 never-called tools",
      "Show 21 suggested allowedTools",
    ]);
  });
});

// RM-36 WP 1.1 · audit P1-1 — "the conclusion is buried under its own evidence": the rules inline
// their enumerated tool names into the detail prose, so the top card was twenty rendered lines of
// `qlik_*` identifiers standing between the sentence and its "Estimated saving" panel.
describe("RecommendationCard — the enumerated tool names (P1-1)", () => {
  it("keeps the sentence and the token figure in the body, not the 139 identifiers", () => {
    renderCard({ detail: ENUMERATED_DETAIL });

    const prose = screen.getByText(/^Across 4 completed runs/);
    expect(prose.textContent).toContain("136,502 of the 172,904 definition tokens");
    // The enumerations — and the lead-ins that introduced them — are gone from the paragraph.
    expect(prose.textContent).not.toContain("Never called:");
    expect(prose.textContent).not.toContain("Suggested allowedTools:");
    for (const name of [...NEVER_CALLED, ...KEPT]) {
      expect(prose.textContent).not.toContain(name);
    }
    // The estimate the operator came for is still rendered, unmoved.
    expect(screen.getByText("Estimated saving ≈ 9,240 tokens/turn")).toBeTruthy();
  });

  it("states the count on the collapsed trigger, so the FACT survives the fold", () => {
    renderCard({ detail: ENUMERATED_DETAIL });
    expect(screen.getByRole("button", { name: "Show 139 never-called tools" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Show 21 suggested allowedTools" })).toBeTruthy();
  });

  it("renders no identifier until the disclosure is opened, then all of them as chips", () => {
    renderCard({ detail: ENUMERATED_DETAIL });
    expect(screen.queryByText("qlik_tool_000")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Show 139 never-called tools" }));

    const names = screen.getByRole("list", { name: "139 never-called tools" });
    expect(names.querySelectorAll("li")).toHaveLength(139);
    expect(screen.getByText("qlik_tool_000")).toBeTruthy();
    expect(screen.getByText("qlik_tool_138")).toBeTruthy();
    // The trigger now offers the way back, and the OTHER list stayed closed.
    expect(screen.getByRole("button", { name: "Hide 139 never-called tools" })).toBeTruthy();
    expect(screen.queryByText("qlik_kept_00")).toBeNull();
  });

  it("is a real, keyboard-focusable button element, not a div dressed as one", () => {
    renderCard({ detail: ENUMERATED_DETAIL });
    const trigger = screen.getByRole("button", { name: "Show 139 never-called tools" });
    expect(trigger.tagName).toBe("BUTTON");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
  });

  it("leaves a short enumeration inline — three names are not a wall of prose", () => {
    const detail = "Two of five tools were called. Never called: alpha, beta, gamma.";
    renderCard({ detail });
    expect(screen.getByText(detail)).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });
});

describe("splitDetailNameLists", () => {
  it("returns a detail it does not recognise byte-identical", () => {
    const detail = recommendation.detail;
    expect(splitDetailNameLists(detail)).toEqual({ prose: detail, lists: [] });
  });

  it("lifts each enumeration out and leaves the argument as clean prose", () => {
    const { prose, lists } = splitDetailNameLists(ENUMERATED_DETAIL);
    expect(prose).toBe(
      'Across 4 completed runs of "Stage", 21 of the 160 tools "qlik-stage" exposes to this ' +
        "environment were called. The 139 that never were cost 136,502 of the 172,904 definition " +
        "tokens this server contributes (78.9%).",
    );
    expect(lists.map((list) => list.label)).toEqual([
      "139 never-called tools",
      "21 suggested allowedTools",
    ]);
    expect(lists[0]?.items).toEqual(NEVER_CALLED);
    expect(lists[1]?.items).toEqual(KEPT);
  });

  it("keeps the sentence that FOLLOWS an enumeration", () => {
    const names = Array.from({ length: 6 }, (_, i) => `t_${i}`);
    const { prose, lists } = splitDetailNameLists(
      `Six tools went unused. Never called: ${names.join(", ")}. ` +
        "No tool on this server was called at all — consider detaching the server.",
    );
    expect(prose).toBe(
      "Six tools went unused. No tool on this server was called at all — consider detaching the server.",
    );
    expect(lists[0]?.items).toEqual(names);
  });

  it("does not truncate an identifier that contains a dot", () => {
    const names = ["ns.alpha", "ns.beta", "ns.gamma", "ns.delta"];
    const { lists } = splitDetailNameLists(`Never called: ${names.join(", ")}. And then some.`);
    expect(lists[0]?.items).toEqual(names);
  });
});

// RM-36 WP 1.1 · audit P1-2 — 55 real WCAG 2.2 2.5.8 target-size failures, the only ones in the
// app. `EvidenceLink` carried `h-auto … p-0`, which strips the Button's own box and collapses the
// target to its 16px line box; the list packed those 16px targets 4px apart, so the 24px
// undisturbed-circle exception could not rescue them either.
//
// jsdom does NOT do layout — `getBoundingClientRect()` is all zeroes here — so this check is
// CLASS-LEVEL: it reads the height/gap utilities the component actually renders and converts them
// to the pixels Tailwind's scale defines. A real rendered measurement needs a browser.
describe("RecommendationCard — evidence target size (P1-2)", () => {
  /** Tailwind's spacing scale in px (`--spacing` is 0.25rem = 4px at the browser default). */
  const SPACING_PX: Record<string, number> = {
    "0": 0,
    "0.5": 2,
    "1": 4,
    "1.5": 6,
    "2": 8,
    "2.5": 10,
    "3": 12,
    "3.5": 14,
    "4": 16,
    "5": 20,
    "6": 24,
    "7": 28,
    "8": 32,
    "9": 36,
    "10": 40,
  };

  /** The px a `h-*` / `gap-y-*` utility resolves to, or `null` when the class names no fixed size
   *  (`h-auto`, or no height utility at all) — which is exactly the collapse this guards against. */
  function utilityPx(element: Element, prefix: string): number | null {
    for (const cls of (element.getAttribute("class") ?? "").split(/\s+/)) {
      if (!cls.startsWith(`${prefix}-`)) continue;
      return SPACING_PX[cls.slice(prefix.length + 1)] ?? null;
    }
    return null;
  }

  const MIN_TARGET_PX = 24; // WCAG 2.2 SC 2.5.8 (Target Size, Minimum), AA.

  it("gives every evidence link a target at least 24px tall", () => {
    renderCard();
    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(recommendation.evidence.length);

    for (const link of links) {
      const height = utilityPx(link, "h");
      expect(
        height,
        `"${link.textContent}" names no fixed height — the target collapses to its line box`,
      ).not.toBeNull();
      expect(height ?? 0).toBeGreaterThanOrEqual(MIN_TARGET_PX);
    }
  });

  it("no longer packs the evidence rows 4px apart", () => {
    renderCard();
    const list = screen.getByRole("list", { name: `Evidence for ${recommendation.title}` });
    expect(utilityPx(list, "gap-y") ?? 0).toBeGreaterThanOrEqual(8);
  });

  it("holds the disclosure trigger to the same 24px floor", () => {
    renderCard({ detail: ENUMERATED_DETAIL });
    for (const trigger of screen.getAllByRole("button")) {
      const height = utilityPx(trigger, "h");
      expect(height, `"${trigger.textContent}" names no fixed height`).not.toBeNull();
      expect(height ?? 0).toBeGreaterThanOrEqual(MIN_TARGET_PX);
    }
  });
});
