import type { MemberSkipReason, ProviderKind, SuiteVariant } from "@mcp-token-footprint/shared";
import type { ProviderRepository } from "../providers/repository.js";
import type { ScenarioRepository } from "../testing/scenario-repository.js";
import type { TestRepository } from "../testing/test-repository.js";
import { httpError } from "../utils/errors.js";

/**
 * Qlik Answers (WP 1.4, D-QA6) — the clean-session invariant's PLAN-TIME layer. A `qlik_answers`
 * environment can never attach MCP servers/skills, take a test's `systemPromptOverride` (the assistant
 * owns its own system config), or accept `attachments` (the Answers API takes a text prompt only). A
 * member that violates this is SKIPPED rather than run or hard-failed (D-QA6); a skill-effect variant
 * that targets the kind is rejected outright (variants encode skill overrides, meaningless here).
 *
 * The dependency bundle mirrors the existing `skills?: SkillRepository` optional-validation pattern
 * already used by {@link import("../testing/scenario-service.js").assertSkillOverridesResolvable}:
 * when absent (e.g. an orchestrator test that never runs a `qlik_answers` scenario), every member is
 * treated as compatible and no variant is ever kind-rejected — production always wires it (`index.ts`).
 */
export type MemberCompatibilityDeps = {
  scenarios: ScenarioRepository;
  tests: TestRepository;
  providers: ProviderRepository;
};

/**
 * The resolved provider kind + allow-list sizes for a scenario, or `undefined` when the scenario or its
 * provider no longer resolves. Never this module's concern to surface that failure — the run starter's
 * own lookup (inside `resolve()`/`resolveAnswers()`) throws it honestly at execution; a member this
 * function can't resolve is simply never skipped BY THIS CHECK.
 */
function scenarioProviderInfo(
  deps: Pick<MemberCompatibilityDeps, "scenarios" | "providers">,
  scenarioId: string,
): { kind: ProviderKind; allowedServers: number; allowedSkills: number } | undefined {
  try {
    const scenario = deps.scenarios.get(scenarioId);
    const kind = deps.providers.get(scenario.providerId).kind;
    return {
      kind,
      allowedServers: scenario.allowedServers.length,
      allowedSkills: scenario.allowedSkills.length,
    };
  } catch {
    return undefined;
  }
}

/**
 * D-QA6 — is this (testId, scenarioId) pairing incompatible with a `qlik_answers` environment? Only
 * scenarios whose provider is `qlik_answers` are constrained AT ALL (every other kind supports
 * attachments/`systemPromptOverride`/servers/skills normally — this always returns `undefined` for
 * them). Incompatible when:
 *   - the scenario is a legacy row still carrying non-empty `allowedServers`/`allowedSkills` for the
 *     kind (a row that predates WP 1.4's write-time reject), OR
 *   - the test carries `attachments` (the Answers API takes a text prompt only), OR
 *   - the test carries a `systemPromptOverride` (the assistant owns its own system config).
 * A scenario/provider/test that doesn't resolve is treated as compatible here (never masks an
 * unrelated 404 — see {@link scenarioProviderInfo}).
 */
export function checkMemberCompatibility(
  deps: MemberCompatibilityDeps,
  testId: string,
  scenarioId: string,
): MemberSkipReason | undefined {
  const info = scenarioProviderInfo(deps, scenarioId);
  if (!info || info.kind !== "qlik_answers") return undefined;
  if (info.allowedServers > 0 || info.allowedSkills > 0) return "incompatible";

  try {
    const test = deps.tests.get(testId);
    if (test.attachments.length > 0 || test.systemPromptOverride) return "incompatible";
  } catch {
    return undefined;
  }
  return undefined;
}

/**
 * D-QA6 — reject the WHOLE plan (400) if any skill-effect variant targets a `qlik_answers` scenario: a
 * variant's `skillOverrides` (attach/detach) are meaningless for a kind with no skill attachments, so a
 * variant plan against it can never do what it says. Fails fast at plan start (mirrors the existing
 * `assertSkillOverridesResolvable` up-front validation), never mid-suite.
 */
export function assertNoQlikAnswersVariants(
  deps: Pick<MemberCompatibilityDeps, "scenarios" | "providers">,
  variants: readonly SuiteVariant[],
): void {
  for (const variant of variants) {
    const info = scenarioProviderInfo(deps, variant.scenarioId);
    if (info?.kind === "qlik_answers") {
      throw httpError(
        400,
        `Variant "${variant.label}" targets a Qlik Answers environment, which has no skills to override — skill-effect variants aren't supported for this provider kind.`,
      );
    }
  }
}
