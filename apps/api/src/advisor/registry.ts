// The advisor's rule registry (WP 1.1) — an EXPLICIT list, in a fixed order, plus the seam later
// WPs register onto. Registration order is load-bearing: it is the tie-break for the engine's
// first-wins dedup (see `engine.ts`), so a rule's position in {@link ADVISOR_RULES} is part of the
// deterministic contract, not an incidental detail.
//
// WP 1.2 fills the seam with the four deterministic rules below. Their ORDER is the report's
// tie-break order: each rule's recommendation ids are prefixed with its own rule id, so they cannot
// actually collide today — but the order is still what a future rule would have to lose a dedup
// against, so it is stated once, here, rather than emerging from import order.

import { descriptionBloatRule } from "./rules/description-bloat.js";
import { loadingModeComparisonRule } from "./rules/loading-mode.js";
import { toolOverlapRule } from "./rules/tool-overlap.js";
import { unusedToolTrimRule } from "./rules/unused-tool-trim.js";
import type { AdvisorRule } from "./types.js";

/** The registered product rules, in evaluation order (WP 1.2). */
export const ADVISOR_RULES: readonly AdvisorRule[] = [
  unusedToolTrimRule,
  descriptionBloatRule,
  loadingModeComparisonRule,
  toolOverlapRule,
];

export type AdvisorRuleRegistry = {
  /** Registered rules in registration order. */
  list(): readonly AdvisorRule[];
  /** Lookup by rule id; `undefined` when nothing is registered under that id. */
  get(id: string): AdvisorRule | undefined;
  /** Adds a rule. Throws on a blank or duplicate id — two rules sharing an id would make the
   *  provenance stamped on every recommendation ambiguous. */
  register(rule: AdvisorRule): void;
};

/** Builds an isolated registry over `rules`. Tests (and later, alternate rule sets) get their own
 *  instance instead of mutating module-level state, so registrations never leak across tests. */
export function createAdvisorRuleRegistry(
  rules: readonly AdvisorRule[] = ADVISOR_RULES,
): AdvisorRuleRegistry {
  const ordered: AdvisorRule[] = [];
  const byId = new Map<string, AdvisorRule>();

  const registry: AdvisorRuleRegistry = {
    list: () => ordered.slice(),
    get: (id) => byId.get(id),
    register(rule) {
      const id = rule.id.trim();
      if (!id) throw new Error("An advisor rule needs a non-empty id");
      if (byId.has(id)) throw new Error(`Advisor rule id "${id}" is already registered`);
      byId.set(id, rule);
      ordered.push(rule);
    },
  };

  for (const rule of rules) registry.register(rule);
  return registry;
}

/** The app-wide registry `GET /api/advisor/report` reads (via `runAdvisor`'s default). */
export const advisorRuleRegistry = createAdvisorRuleRegistry();
