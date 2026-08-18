import { ADVISOR_SAVINGS_UNITS, type AdvisorSavings } from "@mcp-token-footprint/shared";
import { describe, expect, it } from "vitest";
import {
  ADVISOR_SCOPE_LABELS,
  advisorReportHref,
  advisorRuleLabel,
  formatAdvisorSavings,
  isAdvisorScopeKind,
  parseAdvisorQuery,
} from "./advisor-format";

const savings = (over: Partial<AdvisorSavings> = {}): AdvisorSavings => ({
  value: 9240,
  unit: "tokens_per_turn",
  estimate: true,
  basis: "sum of the 12 never-called tools' definition tokens",
  ...over,
});

// README invariant 4 — "estimated savings are labeled estimates and reproducible from the cited
// inputs". These assertions are what stop a future edit from quietly dropping the word.
describe("formatAdvisorSavings — the figure is ALWAYS spoken as an estimate", () => {
  it("puts the word 'Estimated' in the sentence itself, not just in a chip", () => {
    expect(formatAdvisorSavings(savings()).sentence).toBe("Estimated saving ≈ 9,240 tokens/turn");
  });

  it("keeps each unit in its own terms — no unit is ever converted into another", () => {
    expect(formatAdvisorSavings(savings({ unit: "tokens" })).amount).toBe("≈ 9,240 tokens");
    expect(formatAdvisorSavings(savings({ unit: "tokens_per_turn" })).amount).toBe(
      "≈ 9,240 tokens/turn",
    );
    expect(formatAdvisorSavings(savings({ unit: "usd_per_run", value: 0.0042 })).amount).toBe(
      "≈ $0.0042/run",
    );
  });

  it("formats every ADVISOR_SAVINGS_UNITS member (a new unit can't ship unformatted)", () => {
    for (const unit of ADVISOR_SAVINGS_UNITS) {
      const formatted = formatAdvisorSavings(savings({ unit }));
      expect(formatted.sentence.startsWith("Estimated saving")).toBe(true);
      expect(formatted.amount).not.toBe("≈ ");
    }
  });

  it("hands back the rule's own basis verbatim so the number is reproducible by hand", () => {
    expect(formatAdvisorSavings(savings()).basis).toBe(
      "sum of the 12 never-called tools' definition tokens",
    );
  });
});

describe("advisorRuleLabel", () => {
  it("turns a wire rule id into display text (no raw dotted/kebab token in the UI)", () => {
    expect(advisorRuleLabel("advisor.description-bloat")).toBe("Description bloat");
    expect(advisorRuleLabel("advisor.unused-tool-trim")).toBe("Unused tool trim");
  });

  it("leaves an id that doesn't follow the convention alone rather than mangling it", () => {
    expect(advisorRuleLabel("custom")).toBe("Custom");
    expect(advisorRuleLabel("")).toBe("");
  });
});

describe("parseAdvisorQuery — URL state (D-TB10: useful with zero query params)", () => {
  it("defaults to the FLEET report when the route carries no params at all", () => {
    expect(parseAdvisorQuery(new URLSearchParams())).toEqual({ scope: "fleet" });
  });

  it("ignores an unknown scope rather than erroring, falling back to fleet", () => {
    expect(parseAdvisorQuery(new URLSearchParams("scope=bogus"))).toEqual({ scope: "fleet" });
  });

  it("reads a scoped request", () => {
    expect(parseAdvisorQuery(new URLSearchParams("scope=server&id=srv_1"))).toEqual({
      scope: "server",
      id: "srv_1",
    });
    expect(parseAdvisorQuery(new URLSearchParams("scope=scenario&id=env_1"))).toEqual({
      scope: "scenario",
      id: "env_1",
    });
  });

  it("returns null for a scoped request with no id — never a silent widening to the fleet", () => {
    expect(parseAdvisorQuery(new URLSearchParams("scope=server"))).toBeNull();
    expect(parseAdvisorQuery(new URLSearchParams("scope=scenario"))).toBeNull();
  });

  it("drops a stray id on a fleet request (the API rejects one)", () => {
    expect(parseAdvisorQuery(new URLSearchParams("scope=fleet&id=srv_1"))).toEqual({
      scope: "fleet",
    });
  });
});

describe("advisorReportHref / labels", () => {
  it("builds the deep link the inline panels' 'Open full report' uses", () => {
    expect(advisorReportHref({ scope: "fleet" })).toBe("/advisor?scope=fleet");
    expect(advisorReportHref({ scope: "server", id: "srv_1" })).toBe(
      "/advisor?scope=server&id=srv_1",
    );
  });

  it("calls the `scenario` scope an Environment (UI label; the wire name is frozen)", () => {
    expect(ADVISOR_SCOPE_LABELS.scenario).toBe("Environment");
    expect(isAdvisorScopeKind("scenario")).toBe(true);
    expect(isAdvisorScopeKind("nope")).toBe(false);
  });
});
