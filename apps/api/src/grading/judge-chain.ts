import {
  APP_SETTING_JUDGE_CLI_MODEL_KEY,
  APP_SETTING_JUDGE_KEY,
  CLAUDE_CLI_PROVIDER_ID,
  type JudgeSettings,
  judgeSettingsSchema,
  type ResolvedJudgeSource,
} from "@mcp-token-footprint/shared";
import { estimateCost, isModelPriced } from "../providers/pricing.js";
import type { AppSettingsRepository } from "./app-settings-repository.js";
import { CLI_JUDGE_DEFAULT_MODEL, ClaudeCliJudgeError } from "./claude-cli-judge.js";
import type { JudgeGenerate, JudgeGenerateResult } from "./judge.js";

/**
 * Auto-Rating WP 2.3 (AR2/AR3/AR13/AR16) — the ONE judge resolution chain used by ALL FIVE LLM graders
 * (`outcome_judge`, `trajectory_judge`, `error_forensics`, `answer_validation`, `insight_surplus`).
 * It replaces the single provider judge those graders shared with a resolution chain:
 *
 *   **Claude CLI (subscription, if signed in) → configured provider judge → none.**
 *
 * Two pieces plug into each grader's existing `{ resolveJudge, generate }` seam WITHOUT touching the
 * grader interface:
 *   - {@link chainJudgeResolver} — the WIDENED `resolveJudge`. "A judge is available" (a non-null
 *     result) is now true when EITHER the CLI subscription is signed in OR a provider judge is
 *     configured — so a grader runs the CLI even when NO provider credential is set. It PREFERS the CLI
 *     (returns the CLI-sentinel settings when the subscription is signed in) so the base graders'
 *     pricing guard — which is CLI-aware — never blocks the free CLI path on a provider's pricing.
 *   - {@link createJudgeChainGenerate} — the chain `generate`. It tries the CLI first (when signed in),
 *     falls through to the provider on ANY {@link ClaudeCliJudgeError} (AR16) when a provider is
 *     configured, and stamps the ACTUAL source it used onto the {@link JudgeGenerateResult}'s
 *     provenance fields (`judgeProviderId`/`judgeModel`/`judgeCostUsd`). Each grader's ledger site
 *     PREFERS those over the resolver's settings, so a fall-through row reads the provider (real
 *     estimated cost), a CLI row reads {@link CLAUDE_CLI_PROVIDER_ID} + cost 0 (AR13 — real tokens).
 *
 * Fall-through policy (documented): the CLI judge distinguishes `auth` / `rate_limit` / `timeout` /
 * `driver` failures ({@link ClaudeCliJudgeError.kind}). AR16 mandates falling through on the usage
 * limits (`auth`/`rate_limit`); a mechanical CLI failure (`timeout`/`driver`) SHOULD NOT hard-fail the
 * grade when a provider judge exists either, so ALL kinds fall through to a CONFIGURED provider. When
 * NO provider is configured, the CLI error is surfaced (re-thrown) so the grader settles into an honest
 * `error` (never a fake score) — the deterministic facets (e.g. the forensics inventory) still emit.
 *
 * HARD invariants: the chain NEVER throws a non-judge error into a run (its throws land in each
 * grader's own try/catch → an honest `error`/`unevaluable`), judge cost stays the SEPARATE ledger (B5),
 * the subscription token stays server-side (only `cliAvailable()` — a boolean — crosses into settings),
 * and an unpriced PROVIDER model is refused on fall-through (defence-in-depth against uncapped spend).
 */

/** The dependencies the chain resolves against — all lazy so a sign-in/settings change is seen live. */
export type JudgeChainDeps = {
  /** The Claude-CLI judge generate (`createClaudeCliJudgeGenerate(...)`); tests inject a fake. */
  cliGenerate: JudgeGenerate;
  /** The provider judge generate (`createProviderJudgeGenerate(providers)`); tests inject a fake. */
  providerGenerate: JudgeGenerate;
  /** True when a Claude subscription is signed in (`assistantAuth.resolveJudgeAuth() !== null`). */
  cliAvailable: () => boolean;
  /** The configured CLI judge model (Settings KV; default {@link CLI_JUDGE_DEFAULT_MODEL}). */
  resolveCliModel: () => string;
  /** The configured provider judge (references only), or `null` when not fully configured. */
  resolveProviderJudge: () => JudgeSettings | null;
};

/** The subset of {@link JudgeChainDeps} the resolver / source helpers need (no `generate`). */
type JudgeChainResolveDeps = Pick<
  JudgeChainDeps,
  "cliAvailable" | "resolveCliModel" | "resolveProviderJudge"
>;

/**
 * The configured PROVIDER judge (references only), or `null` when the KV is absent/unparseable/partial.
 * The canonical reader — the routes and the chain both use it, so "a provider judge is configured"
 * means one thing everywhere. NEVER key material (holds a `providerCredentialId`, not an API key).
 */
export function readProviderJudge(appSettings: AppSettingsRepository): JudgeSettings | null {
  const parsed = judgeSettingsSchema.safeParse(appSettings.get(APP_SETTING_JUDGE_KEY));
  if (!parsed.success) return null;
  const settings = parsed.data;
  if (!settings.providerCredentialId || !settings.model) return null;
  return settings;
}

/**
 * The configured Claude-CLI judge model — the persisted Settings KV, falling back to
 * {@link CLI_JUDGE_DEFAULT_MODEL} (`claude-sonnet-4-5`) when unset/blank. A subscription model (cost 0),
 * so it is NOT subject to the unpriced-provider guard.
 */
export function resolveCliJudgeModel(appSettings: AppSettingsRepository): string {
  const raw = appSettings.get(APP_SETTING_JUDGE_CLI_MODEL_KEY);
  return typeof raw === "string" && raw.trim() ? raw.trim() : CLI_JUDGE_DEFAULT_MODEL;
}

/** Persist the Claude-CLI judge model (a plain string). Overwrites; last write wins. */
export function writeCliJudgeModel(appSettings: AppSettingsRepository, model: string): void {
  appSettings.put(APP_SETTING_JUDGE_CLI_MODEL_KEY, model.trim());
}

/**
 * The WIDENED `resolveJudge` shared by all five LLM graders. Returns non-null (→ the grader proceeds)
 * when EITHER the CLI subscription is signed in OR a provider judge is configured; `null` (→ the grader
 * self-reports `unevaluable`/inventory-only) when neither is available. PREFERS the CLI: when the
 * subscription is signed in it returns the CLI-sentinel settings (`providerCredentialId` =
 * {@link CLAUDE_CLI_PROVIDER_ID}, `model` = the CLI model), so the base graders' CLI-aware pricing guard
 * never refuses the free CLI path over a provider's pricing. The actual per-call source (and its
 * provenance) is decided by {@link createJudgeChainGenerate}; these settings are only the ledger
 * FALLBACK (the chain always stamps real provenance).
 */
export function chainJudgeResolver(deps: JudgeChainResolveDeps): () => JudgeSettings | null {
  return () => {
    if (deps.cliAvailable()) {
      return { providerCredentialId: CLAUDE_CLI_PROVIDER_ID, model: deps.resolveCliModel() };
    }
    const provider = deps.resolveProviderJudge();
    if (provider) return provider;
    return null;
  };
}

/** Which judge would rate a run now (AR3) — for the Settings resolved-source surface. */
export function resolveJudgeSource(
  deps: Pick<JudgeChainDeps, "cliAvailable" | "resolveProviderJudge">,
): ResolvedJudgeSource {
  if (deps.cliAvailable()) return "claude_cli";
  if (deps.resolveProviderJudge()) return "provider";
  return "none";
}

/**
 * The chain `generate`. Tries the CLI first when the subscription is signed in, falls through to a
 * CONFIGURED provider on any {@link ClaudeCliJudgeError} (AR16), else uses the provider directly. Always
 * stamps the ACTUAL source used onto the result's provenance (`judgeProviderId`/`judgeModel`/
 * `judgeCostUsd`) — CLI: {@link CLAUDE_CLI_PROVIDER_ID} + cost 0 (real tokens); provider: its id/model +
 * estimated cost. The passed `settings` (the resolver's output) is ignored for routing — the chain
 * re-resolves live so a mid-flight sign-in/settings change is honoured. NEVER hangs (each leg is
 * timeout-bounded by its own `generate`); a leftover failure is thrown for the grader's own catch.
 */
export function createJudgeChainGenerate(deps: JudgeChainDeps): JudgeGenerate {
  return async (_settings, prompt, opts) => {
    if (deps.cliAvailable()) {
      const cliModel = deps.resolveCliModel();
      try {
        const res = await deps.cliGenerate(
          { providerCredentialId: null, model: cliModel },
          prompt,
          opts,
        );
        // AR13: CLI ran on the subscription → real tokens, cost 0, provenance `claude_cli`.
        return stampProvenance(res, CLAUDE_CLI_PROVIDER_ID, cliModel, 0);
      } catch (error) {
        const provider = deps.resolveProviderJudge();
        // AR16: fall through the chain on ANY distinguishable CLI failure when a provider judge exists.
        if (error instanceof ClaudeCliJudgeError && provider) {
          return runProviderJudge(deps.providerGenerate, provider, prompt, opts);
        }
        // No provider to fall through to (or a non-judge error) → surface it: the grader emits `error`.
        throw error;
      }
    }
    const provider = deps.resolveProviderJudge();
    if (!provider) {
      // Defensive — the widened resolver already returns null here, so a grader never reaches generate.
      throw new Error(
        "no judge is available (neither the Claude CLI nor a provider judge is configured)",
      );
    }
    return runProviderJudge(deps.providerGenerate, provider, prompt, opts);
  };
}

/** Run the provider judge, guarding an unpriced model (uncapped spend) and stamping real provenance. */
async function runProviderJudge(
  providerGenerate: JudgeGenerate,
  provider: JudgeSettings,
  prompt: string,
  opts: { system: string; signal: AbortSignal },
): Promise<JudgeGenerateResult> {
  if (provider.model && !isModelPriced(provider.model)) {
    // Defence-in-depth: the PUT/re-grade guards already refuse an unpriced provider model, but a
    // fall-through must never let one spend uncapped and read cost 0 in the separate ledger.
    throw new Error(
      `the configured provider judge model "${provider.model}" has no known pricing; refusing to spend on it`,
    );
  }
  const res = await providerGenerate(provider, prompt, opts);
  const cost = provider.model ? estimateCost(provider.model, res.usage) : 0;
  return stampProvenance(res, provider.providerCredentialId, provider.model, cost);
}

/** Attach the ACTUAL judge source's provenance to a result (the ledger sites prefer these). */
function stampProvenance(
  res: JudgeGenerateResult,
  judgeProviderId: string | null,
  judgeModel: string | null,
  judgeCostUsd: number,
): JudgeGenerateResult {
  return { ...res, judgeProviderId, judgeModel, judgeCostUsd };
}
