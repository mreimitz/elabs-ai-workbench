import type { HubLimitRetrySource } from "@mcp-token-footprint/shared";
import { buildHubModelGroups } from "./hub-model-picker";
import type { HubModelCredentialIssue, HubModelOption } from "./use-hub-models";

/**
 * The limit-error banner's pure target-selection layer (D-MI1/D-MI9,
 * `roadmap/model-identity/` WP 4.3).
 * ==============================================================================================
 *
 * A `limit_error` offers to retry the turn on the **other auth source** (`retrySourcesFor`,
 * `apps/api/src/hub/turn-engine.ts` — an API-keyed kind offers `subscription`, the subscription
 * offers `api_key`; both also offer `other_model`). Before this WP the banner answered that offer
 * with a bare **model id**, and the model id is exactly the thing that cannot express which source
 * it came from: the subscription roster deliberately emits Anthropic's canonical ids
 * (`claude-sonnet-5`, `claude-opus-4-8`, `claude-haiku-4-5-20251001`), so "Retry on subscription"
 * sent `claude-sonnet-5` with no credential, the server's name heuristic mapped `claude*` →
 * `anthropic`, and the retry landed on the **metered API key** — the same source that had just
 * refused the turn.
 *
 * So a retry target is a whole roster ROW ({@link HubModelOption} — model **and** credential), and
 * it reaches the wire through `hubModelWireFields()`. Selecting that row is what this module does,
 * deterministically and without any name guessing.
 */

/** A retry source that names an auth source directly (i.e. not the `other_model` free choice). */
export type HubDirectRetrySource = Exclude<HubLimitRetrySource, "other_model">;

export function isDirectRetrySource(source: HubLimitRetrySource): source is HubDirectRetrySource {
  return source !== "other_model";
}

/** How a direct retry source is named to an operator ("Retry on ⟨…⟩", "Couldn't retry on the ⟨…⟩").
 *  Deliberately the AUTH SOURCE, not a provider kind — the provider itself is named separately, from
 *  the D-MI6 registry, so the two can never drift into disagreeing (D-MI5/D-MI6). */
export const HUB_DIRECT_RETRY_SOURCE_LABEL: Record<HubDirectRetrySource, string> = {
  api_key: "API key",
  subscription: "subscription",
};

/**
 * Does this provider kind belong to the auth source `source` names?
 *
 * `subscription` is the one Agent-SDK/Claude-subscription kind; `api_key` is every other
 * hub-eligible kind (all of them are metered credentials from the operator's point of view). This
 * mirrors `retrySourcesFor`'s own `kind === "claude_subscription" ? … : …` split, so the two halves
 * can never disagree about which side of the fence a credential is on.
 */
export function kindMatchesRetrySource(
  kind: HubModelOption["kind"],
  source: HubDirectRetrySource,
): boolean {
  return source === "subscription"
    ? kind === "claude_subscription"
    : kind !== "claude_subscription";
}

/** What the failed turn was running on, as far as the client can know it. */
export type HubRetryOrigin = {
  /** The turn's model id (`assistant_message.model`), if the transcript recorded one. */
  modelId?: string | null;
  /** The session's persisted pin (`HubSession.providerCredentialId`); `null` on a pre-v55 session. */
  credentialId?: string | null;
};

/**
 * The roster row a one-click "Retry on ⟨source⟩" will actually run on — or `undefined` when that
 * source contributes no usable row (the caller then shows a Settings affordance, never a dead
 * button).
 *
 * Selection rules, in order:
 *
 *  1. **Only rows of the named source.** {@link kindMatchesRetrySource}.
 *  2. **Never the credential that just failed.** `retrySourcesFor` already offers only the opposite
 *     class, so this is belt-and-braces — but a retry on the very credential that refused the turn
 *     is a guaranteed repeat, and the whole point of this WP is that "the operator picks one thing
 *     and gets another" stops happening.
 *  3. **Prefer the SAME model id** — the colliding twin. This is the canonical case from README §1:
 *     a limit on the metered `claude-sonnet-5` should retry `claude-sonnet-5` on the subscription,
 *     not some unrelated model that happens to sort first. It is also the case that used to fail
 *     silently, because the twin is byte-identical on the wire and only the credential tells them
 *     apart.
 *  4. **Otherwise the first row in the picker's own deterministic order** —
 *     `buildHubModelGroups` (`kind` → credential label → credential id), never the roster's arrival
 *     order, which is `listProviders()`' `ORDER BY updated_at DESC`. Editing an unrelated
 *     credential must not change which provider a retry runs on.
 */
export function pickHubRetryTarget(
  models: readonly HubModelOption[],
  source: HubDirectRetrySource,
  origin: HubRetryOrigin = {},
): HubModelOption | undefined {
  const candidates = buildHubModelGroups(models)
    .flatMap((group) => group.rows)
    .map((row) => row.option)
    .filter(
      (option) =>
        kindMatchesRetrySource(option.kind, source) &&
        (!origin.credentialId || option.credentialId !== origin.credentialId),
    );
  const twin = origin.modelId
    ? candidates.find((option) => option.modelId === origin.modelId)
    : undefined;
  return twin ?? candidates[0];
}

/**
 * The credential of the named source that EXISTS but contributes no selectable row — its auth is
 * broken, its `/models` fetch failed, or it exposes nothing (`useHubModelRoster().unavailable`,
 * D-MI7).
 *
 * Without this, the banner's only "no candidate" copy was *"Configure ⟨source⟩ in Settings to
 * retry"* — which is a lie when the source IS configured and merely broken, and it is precisely the
 * kind of unanswerable *"why did it use the other one?"* the D-MI9 posture exists to prevent. Ties
 * break in the same deterministic order the picker's issue list uses.
 */
export function findUnavailableRetrySource(
  issues: readonly HubModelCredentialIssue[],
  source: HubDirectRetrySource,
): HubModelCredentialIssue | undefined {
  return [...issues]
    .filter((issue) => kindMatchesRetrySource(issue.kind, source))
    .sort((a, b) => a.label.localeCompare(b.label) || a.credentialId.localeCompare(b.credentialId))
    .at(0);
}
