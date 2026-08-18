// The advisor's rule registry (WP 1.1) — an EXPLICIT list, in a fixed order, plus the seam later
// WPs register onto. Registration order is load-bearing: it is the tie-break for the engine's
// first-wins dedup (see `engine.ts`), so a rule's position in {@link ADVISOR_RULES} is part of the
// deterministic contract, not an incidental detail.
//
// **This WP registers ZERO product rules.** The four deterministic rules (unused-tool trim,
// description bloat, loading-mode comparison, overlap detection) land in WP 1.2 by appending to
// {@link ADVISOR_RULES}; the engine and its tests exercise the seam with fixture rules.

import type { AdvisorRule } from "./types.js";

/** The registered product rules, in evaluation order. Empty until WP 1.2. */
export const ADVISOR_RULES: readonly AdvisorRule[] = [];

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

/** The app-wide registry the API route (WP 1.2) reads. Empty in this WP. */
export const advisorRuleRegistry = createAdvisorRuleRegistry();
