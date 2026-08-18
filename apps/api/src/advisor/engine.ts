// The advisor rule engine (WP 1.1): select applicable rules → run them → validate what they
// emitted → dedupe → sort → stamp. Pure over its inputs; the DB lives behind the context's read
// ports (`types.ts`), never here.
//
// DETERMINISM CONTRACT (roadmap/advisor/conventions.md, invariant 2). Given the same rules, the
// same context data and the same clock, `runAdvisor` produces a BYTE-IDENTICAL report — same
// numbers, same array order, same `generatedAt`. Three things make that true:
//
//   1. **Rule order is fixed** — the registry's registration order (`registry.ts`).
//   2. **Dedup is FIRST-WINS on `AdvisorRecommendation.id`** — when two rules (or one rule twice)
//      emit the same stable id, the FIRST occurrence in rule order survives and every later one is
//      dropped whole. A later duplicate never merges into, overwrites, or enriches the winner;
//      that would make the result depend on rule order in a way an operator cannot see.
//   3. **The sort is a strict total order** — `severity → savings → id`, spelled out below.
//
// THE SORT, precisely:
//   severity  — `ADVISOR_SEVERITIES` index ascending (high, then medium, then info).
//   savings   — a recommendation WITH a savings estimate outranks one without; among those with
//               one, `ADVISOR_SAVINGS_UNITS` index ascending, then `value` DESCENDING. Grouping by
//               unit first is deliberate: savings in different units are never converted into one
//               another (that would need pricing the operator never approved), so comparing a
//               `tokens_per_turn` number against a `usd_per_run` number is meaningless — and a
//               comparator that returned "equal" for such a pair would not be transitive, which is
//               exactly how a sort stops being deterministic.
//   id        — ascending, as the final tie-break. Since ids are unique after dedup, the order is
//               total: no two recommendations can compare equal.

import {
  ADVISOR_SAVINGS_UNITS,
  ADVISOR_SEVERITIES,
  ADVISOR_VERSION,
  type AdvisorInsufficientData,
  type AdvisorRecommendation,
  type AdvisorReport,
  type AdvisorScope,
} from "@mcp-token-footprint/shared";
import { advisorRuleRegistry } from "./registry.js";
import { AdvisorRuleContractError, type AdvisorContext, type AdvisorRule } from "./types.js";

const SEVERITY_RANK = new Map(ADVISOR_SEVERITIES.map((s, i) => [s, i] as const));
const SAVINGS_UNIT_RANK = new Map(ADVISOR_SAVINGS_UNITS.map((u, i) => [u, i] as const));

/** A missing estimate ranks AFTER every real unit, so advice with a quantified payoff floats up. */
const NO_SAVINGS_RANK = ADVISOR_SAVINGS_UNITS.length;

function severityRank(rec: AdvisorRecommendation): number {
  return SEVERITY_RANK.get(rec.severity) ?? ADVISOR_SEVERITIES.length;
}

function savingsUnitRank(rec: AdvisorRecommendation): number {
  if (!rec.savings) return NO_SAVINGS_RANK;
  return SAVINGS_UNIT_RANK.get(rec.savings.unit) ?? NO_SAVINGS_RANK;
}

function compareRecommendations(a: AdvisorRecommendation, b: AdvisorRecommendation): number {
  const bySeverity = severityRank(a) - severityRank(b);
  if (bySeverity !== 0) return bySeverity;

  const byUnit = savingsUnitRank(a) - savingsUnitRank(b);
  if (byUnit !== 0) return byUnit;

  const byValue = (b.savings?.value ?? 0) - (a.savings?.value ?? 0); // larger estimate first
  if (byValue !== 0) return byValue;

  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function compareGaps(a: AdvisorInsufficientData, b: AdvisorInsufficientData): number {
  if (a.ruleId !== b.ruleId) return a.ruleId < b.ruleId ? -1 : 1;
  return a.reason < b.reason ? -1 : a.reason > b.reason ? 1 : 0;
}

/**
 * The invariants a rule's output must hold before the engine will publish it. A violation is a bug
 * in the RULE — the engine refuses the finding loudly (throw) rather than shipping an unevidenced
 * or unlabeled suggestion, or silently dropping one so the defect never surfaces.
 */
function assertRecommendationContract(rule: AdvisorRule, rec: AdvisorRecommendation): void {
  const fail = (detail: string): never => {
    throw new AdvisorRuleContractError(rule.id, detail);
  };

  if (!rec.id.trim()) fail("a recommendation needs a stable, non-empty id (it is the dedup key)");
  // Provenance: the id stamped on the finding must be the rule that produced it, so a report's
  // `ruleId` can always be trusted to point back at real, re-runnable logic.
  if (rec.ruleId !== rule.id) {
    fail(`recommendation "${rec.id}" is stamped ruleId "${rec.ruleId}"`);
  }
  if (!rec.title.trim()) fail(`recommendation "${rec.id}" needs a title`);
  // Invariant 1 — every suggestion is drillable. No evidence, no publication.
  if (rec.evidence.length === 0) {
    fail(
      `recommendation "${rec.id}" carries no evidence; every recommendation must cite at least ` +
        "one scan/run/scenario/server/skill it was derived from",
    );
  }
  // Invariant 4 — a savings figure is ALWAYS a labeled estimate WITH a reproducible basis. A
  // number with no basis is an unfalsifiable claim, so it is refused rather than rounded off.
  if (rec.savings) {
    if (rec.savings.estimate !== true) {
      fail(`recommendation "${rec.id}" reports savings without the estimate marker`);
    }
    if (!rec.savings.basis.trim()) {
      fail(`recommendation "${rec.id}" reports a savings value with no basis string`);
    }
    if (!Number.isFinite(rec.savings.value)) {
      fail(`recommendation "${rec.id}" reports a non-finite savings value`);
    }
  }
}

function assertGapContract(rule: AdvisorRule, gap: AdvisorInsufficientData): void {
  if (gap.ruleId !== rule.id) {
    throw new AdvisorRuleContractError(
      rule.id,
      `insufficient-data entry is stamped ruleId "${gap.ruleId}"`,
    );
  }
  // Invariant 3 — an honest gap NAMES what is missing. A blank reason is not an honest gap.
  if (!gap.reason.trim()) {
    throw new AdvisorRuleContractError(rule.id, "insufficient-data entry has no reason");
  }
}

export type RunAdvisorOptions = {
  /** Rules to evaluate. Defaults to the app-wide registry (empty until WP 1.2). */
  rules?: readonly AdvisorRule[];
};

/**
 * Runs the advisor over `scope` and assembles a stamped, deterministic {@link AdvisorReport}.
 *
 * Rules that do not apply to `scope` are skipped entirely — they contribute neither a
 * recommendation nor an `insufficientData` entry, because a scope a rule was never meant to cover
 * is not a data gap.
 */
export function runAdvisor(
  ctx: AdvisorContext,
  scope: AdvisorScope,
  options: RunAdvisorOptions = {},
): AdvisorReport {
  const rules = options.rules ?? advisorRuleRegistry.list();

  const byId = new Map<string, AdvisorRecommendation>();
  const gaps: AdvisorInsufficientData[] = [];

  for (const rule of rules) {
    if (!rule.appliesTo(scope)) continue;

    const result = rule.run(ctx, scope);

    for (const rec of result.recommendations) {
      assertRecommendationContract(rule, rec);
      // FIRST-WINS: an id already claimed by an earlier rule (or an earlier emission from this
      // one) keeps its original finding; the duplicate is dropped whole, never merged.
      if (byId.has(rec.id)) continue;
      byId.set(rec.id, rec);
    }

    for (const gap of result.insufficientData) {
      assertGapContract(rule, gap);
      // Exact duplicates (same rule, same reason) collapse — the same gap reported twice is noise,
      // not two gaps. Two DIFFERENT reasons from one rule are both kept.
      if (gaps.some((g) => g.ruleId === gap.ruleId && g.reason === gap.reason)) continue;
      gaps.push(gap);
    }
  }

  return {
    advisorVersion: ADVISOR_VERSION,
    generatedAt: ctx.now().toISOString(),
    // Rebuilt rather than passed through, so the report never aliases caller state and its key
    // order is fixed — `JSON.stringify` of two reports over the same inputs must match byte for
    // byte, and a caller writing `{ id, kind }` instead of `{ kind, id }` would otherwise break it.
    scope: scope.id === undefined ? { kind: scope.kind } : { kind: scope.kind, id: scope.id },
    recommendations: [...byId.values()].sort(compareRecommendations),
    insufficientData: gaps.sort(compareGaps),
  };
}
