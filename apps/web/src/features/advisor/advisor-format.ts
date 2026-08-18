import {
  ADVISOR_SCOPE_KINDS,
  type AdvisorReportQuery,
  type AdvisorSavings,
  type AdvisorScopeKind,
  type AdvisorSeverity,
} from "@mcp-token-footprint/shared";
import { formatCostUsd, formatNumber } from "../../lib/format";

// ==================================================================================================
// Advisor WP 1.3 — the display vocabulary (pure, unit-tested)
// ==================================================================================================
// Two invariants from `roadmap/advisor/conventions.md` are enforced HERE, in the only place the web
// turns advisor numbers into words:
//   • invariant 4 — "estimates are labeled". Every savings figure renders through
//     {@link formatAdvisorSavings}, which puts the word "Estimated" in the sentence itself (not only
//     in a chip) and hands the basis back so the card can print how the number was reached.
//   • invariant 2 — units are never converted into one another (no pricing applied behind the
//     operator's back), so each unit keeps its own suffix and its own formatter.

/** Severity → the chip a card leads with. Text + variant, never colour alone (Badge anti-pattern). */
export const ADVISOR_SEVERITY_META: Record<
  AdvisorSeverity,
  { label: string; variant: "destructive" | "warning" | "info" }
> = {
  high: { label: "High", variant: "destructive" },
  medium: { label: "Medium", variant: "warning" },
  info: { label: "Info", variant: "info" },
};

/** How one savings unit is spoken. `≈` + the unit suffix; `usd_per_run` keeps sub-cent precision. */
function formatSavingsValue(savings: AdvisorSavings): string {
  switch (savings.unit) {
    case "tokens_per_turn":
      return `≈ ${formatNumber(savings.value)} tokens/turn`;
    case "tokens":
      return `≈ ${formatNumber(savings.value)} tokens`;
    case "usd_per_run":
      return `≈ ${formatCostUsd(savings.value, { precision: 4 })}/run`;
    default:
      return `≈ ${formatNumber(savings.value)}`;
  }
}

/**
 * The one rendering of a savings figure. `sentence` ALWAYS carries the word "Estimated" so the
 * number can never be read as a measurement even out of context (e.g. by a screen reader landing on
 * it alone, or in a copy-paste). `basis` is the rule's own one-line explanation of how the value was
 * computed — printed verbatim, so the operator can reproduce it from the cited evidence.
 */
export function formatAdvisorSavings(savings: AdvisorSavings): {
  sentence: string;
  amount: string;
  basis: string;
} {
  const amount = formatSavingsValue(savings);
  return {
    amount,
    sentence: `Estimated saving ${amount}`,
    basis: savings.basis,
  };
}

/** Human label for a scope kind. "Environment" is the UI label; the wire name stays `scenario`. */
export const ADVISOR_SCOPE_LABELS: Record<AdvisorScopeKind, string> = {
  fleet: "Whole fleet",
  server: "MCP server",
  scenario: "Environment",
};

export function isAdvisorScopeKind(value: string): value is AdvisorScopeKind {
  return (ADVISOR_SCOPE_KINDS as readonly string[]).includes(value);
}

/**
 * Read an {@link AdvisorReportQuery} off the URL. `/advisor` with NO query params is a real, useful
 * page (D-TB10) — it means the fleet report — so the fallback is `{ scope: "fleet" }`, never an
 * error. A scoped request whose `id` is missing returns `null`: the view then asks the operator to
 * pick one instead of silently widening the report to the whole fleet.
 */
export function parseAdvisorQuery(search: URLSearchParams): AdvisorReportQuery | null {
  const rawScope = search.get("scope");
  const scope: AdvisorScopeKind = rawScope && isAdvisorScopeKind(rawScope) ? rawScope : "fleet";
  if (scope === "fleet") return { scope: "fleet" };
  const id = search.get("id");
  if (!id) return null;
  return { scope, id };
}

/** The `/advisor` href for a scope — the deep link the inline panels' "Open full report" uses. */
export function advisorReportHref(query: AdvisorReportQuery): string {
  const params = new URLSearchParams({ scope: query.scope });
  if (query.id !== undefined) params.set("id", query.id);
  return `/advisor?${params.toString()}`;
}

/**
 * Human label for a rule id (`advisor.description-bloat` → "Description bloat"). The wire id stays
 * the identifier the API stamps on every finding; this is display text only, so an operator never
 * reads a raw dotted/kebab token in the UI. An id that doesn't follow the convention is returned
 * unchanged rather than mangled.
 */
export function advisorRuleLabel(ruleId: string): string {
  const bare = ruleId.startsWith("advisor.") ? ruleId.slice("advisor.".length) : ruleId;
  const words = bare.replace(/[._-]+/g, " ").trim();
  if (words.length === 0) return ruleId;
  return words.charAt(0).toUpperCase() + words.slice(1);
}
