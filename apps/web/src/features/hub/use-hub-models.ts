import { useEffect, useState } from "react";
import type { ProviderKind } from "@mcp-token-footprint/shared";
import { PROVIDER_KIND_META, providerKindLabel } from "@mcp-token-footprint/shared";
import { listProviderModels, listProviders } from "../../lib/api";

/**
 * Assistant Hub (WP1.3) — the hub's model surface (D-AH4), mirrored LOCALLY from the API's
 * `apps/api/src/hub/capabilities.ts` `HUB_MODEL_KINDS` (the six hub-eligible provider kinds; `apps/web`
 * cannot import `apps/api`).
 */
export const HUB_ELIGIBLE_PROVIDER_KINDS: readonly ProviderKind[] = [
  "anthropic",
  "openai",
  "google",
  "openai_compatible",
  "ollama",
  "claude_subscription",
];

/**
 * The hub-eligible kinds named in prose for the "Assistant isn't configured" empty state.
 *
 * D-MI6 (`roadmap/model-identity/`, WP 2.3): GENERATED from {@link HUB_ELIGIBLE_PROVIDER_KINDS} ×
 * the one label registry in `packages/shared`, mirroring the API's own `NO_PROVIDER_MESSAGE`
 * (`apps/api/src/hub/routes.ts`). Both rosters used to be hand-written sentences that named
 * providers differently from Settings and could silently omit a newly-added kind.
 */
export const HUB_PROVIDER_KIND_PROSE: string = ((): string => {
  const labels = HUB_ELIGIBLE_PROVIDER_KINDS.map((kind) => providerKindLabel(kind));
  const last = labels.at(-1);
  if (last === undefined) return "";
  if (labels.length === 1) return last;
  return `${labels.slice(0, -1).join(", ")}, or ${last}`;
})();

export type HubModelOption = {
  modelId: string;
  kind: ProviderKind;
  credentialId: string;
  displayName?: string;
  /**
   * D-MI7 (WP 4.1) — the credential's own label (`provider_credentials.label`), so a row can say
   * WHICH key it belongs to when its kind has more than one. Additive/optional: a row built without
   * it (every pre-4.1 test fixture) still renders, just without the credential chip — the picker
   * only shows the chip when a kind genuinely has >1 credential anyway.
   *
   * ⚠️ A LABEL, not the credential id. The id (`credentialId`) is a nanoid and stays out of every
   * human-facing string and out of cmdk's fuzzy-scored `value` (see {@link hubModelOptionKey}).
   */
  credentialLabel?: string;
};

/**
 * D-MI7 (WP 4.1) — a hub-eligible credential that contributes NO usable model row: its auth is
 * broken (`ProviderCredential.authBroken`), or its live `GET /api/providers/:id/models` fetch failed,
 * or it returned an empty roster.
 *
 * Before this, `useHubModelRoster` silently dropped such a credential (the `Promise.allSettled` loop
 * `continue`s past a rejection), which is precisely what makes *"why did it use the other one?"*
 * unanswerable. The picker renders these **disabled-and-visible** instead of hiding them.
 */
export type HubModelCredentialIssue = {
  credentialId: string;
  kind: ProviderKind;
  label: string;
  /** Operator-facing reason, never a raw error dump (a provider error can echo a key fragment). */
  reason: string;
};

/**
 * D-MI8 (`roadmap/model-identity/`, WP 3.1) — the identity of a roster ROW: a model id **per
 * credential**. Two credentials can expose byte-identical model ids (the subscription roster
 * deliberately emits Anthropic's canonical `claude-sonnet-5` / `claude-opus-4-8` /
 * `claude-haiku-4-5-20251001` so `resolvePrice` / `MODEL_CONTEXT_LIMITS` stay exact-key lookups), so
 * the bare model id is NOT a unique row identity — deduping on it swallowed one of every colliding
 * pair, and *which* one survived flipped with an unrelated credential's `updated_at`.
 *
 * ⚠️ **LOCAL ONLY.** This string is a dedupe key, a React `key`, and an "is this the same row?"
 * comparison — nothing else. It must NEVER become:
 *   • a wire value (`model` stays byte-identical on every request — D-MI1 rejected a composite id),
 *   • a cmdk `value` (cmdk fuzzy-scores `value`; the credential nanoid would pollute search — D-MI7),
 *   • a lookup key against `MODEL_CONTEXT_LIMITS` / `resolvePrice` / `isStructuredOutputModel` /
 *     `inferModelLogoProvider` (all exact/prefix matchers on the bare id).
 * Provider identity travels on the wire as the additive optional `providerCredentialId`, never inside
 * `model`.
 */
export function hubModelOptionKey(
  option: Pick<HubModelOption, "modelId" | "credentialId">,
): string {
  return `${option.credentialId}::${option.modelId}`;
}

/**
 * Resolve a roster row from a (modelId, credentialId?) pair — the credential-aware replacement for the
 * `models.find((m) => m.modelId === id)` lookups that became ambiguous once colliding twins both
 * survive the roster (D-MI8). An exact credential match wins; with no credential (a legacy/unpinned
 * session, or a bare id typed outside the roster) it degrades to today's first-match-by-id behaviour.
 */
export function findHubModelOption(
  models: readonly HubModelOption[],
  modelId: string | undefined,
  credentialId?: string | null,
): HubModelOption | undefined {
  if (!modelId) return undefined;
  if (credentialId) {
    const exact = models.find(
      (model) => model.modelId === modelId && model.credentialId === credentialId,
    );
    if (exact) return exact;
  }
  return models.find((model) => model.modelId === modelId);
}

/**
 * The wire fields a picked roster row contributes to `HubSessionCreateInput` / `HubSendMessageInput` /
 * `HubSessionPatch` (D-MI1): the bare `model` **plus** the additive optional `providerCredentialId`.
 * One helper so no call site can send the model and silently drop the credential again — the exact
 * discard that routed an "Anthropic CLI" session onto the metered Anthropic API key.
 */
export function hubModelWireFields(option: Pick<HubModelOption, "modelId" | "credentialId">): {
  model: string;
  providerCredentialId?: string;
} {
  return {
    model: option.modelId,
    ...(option.credentialId ? { providerCredentialId: option.credentialId } : {}),
  };
}

export type HubModelRoster = {
  models: HubModelOption[];
  loading: boolean;
  /** True once at least one hub-eligible provider credential exists — drives "not configured" vs
   *  "configured, but its live roster fetch failed" (the latter still lets a manual model id through
   *  since {@link HubSendMessageInput.model}/`HubSessionCreateInput.model` accept any non-empty string). */
  hasCredential: boolean;
  /** D-MI7 (WP 4.1) — the credentials that produced no row. Never hidden; the picker lists them
   *  disabled with their reason. Empty on the happy path. */
  unavailable: HubModelCredentialIssue[];
};

/**
 * The live per-message/session model roster (R-SES10) — every hub-eligible provider credential's own
 * model list (`GET /api/providers/:id/models`, the SAME live endpoint the Testing launcher/scenario
 * picker use). A single credential's roster fetch failing (e.g. a bad key) is tolerated — the other
 * credentials' models still populate — since one broken provider must never blank the whole picker.
 *
 * D-MI8 (WP 3.1) — rows are deduped per **credential × model** ({@link hubModelOptionKey}), not on the
 * bare model id. The old global-by-id dedupe silently swallowed one of every colliding pair (the
 * subscription roster emits Anthropic's canonical ids on purpose), so an operator could not pick "the
 * subscription Sonnet" at all — and which twin survived flipped with the `updated_at DESC` order the
 * credential list arrives in. A credential that genuinely repeats a model id within its OWN roster is
 * still deduped (the key includes its id).
 */
export function useHubModelRoster(): HubModelRoster {
  const [models, setModels] = useState<HubModelOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasCredential, setHasCredential] = useState(false);
  const [unavailable, setUnavailable] = useState<HubModelCredentialIssue[]>([]);

  useEffect(() => {
    let cancelled = false;

    async function load(): Promise<void> {
      setLoading(true);
      try {
        const credentials = await listProviders();
        const eligible = credentials.filter((credential) =>
          HUB_ELIGIBLE_PROVIDER_KINDS.includes(credential.kind),
        );
        if (cancelled) return;
        setHasCredential(eligible.length > 0);

        const settled = await Promise.allSettled(
          eligible.map(async (credential) => ({
            credential,
            response: await listProviderModels(credential.id),
          })),
        );
        if (cancelled) return;

        const roster: HubModelOption[] = [];
        const issues: HubModelCredentialIssue[] = [];
        const seen = new Set<string>();
        for (const [index, result] of settled.entries()) {
          const requested = eligible[index];
          if (result.status !== "fulfilled") {
            // D-MI7 (WP 4.1) — a credential whose live roster fetch FAILED used to vanish from the
            // picker entirely. Keep it, with a reason: the deterministic message only (never the
            // provider's raw error text, which can echo a key fragment — `mcp-and-security.md`).
            if (requested) {
              issues.push({
                credentialId: requested.id,
                kind: requested.kind,
                label: requested.label,
                reason:
                  requested.authBroken === true
                    ? "This credential's authentication is broken — reconnect it in Settings."
                    : "Its model list couldn’t be loaded — check the credential in Settings.",
              });
            }
            continue;
          }
          const { credential, response } = result.value;
          if (credential.authBroken === true) {
            // D-MI9 posture, mirrored in the UI: a credential the API would REFUSE to run on must not
            // be silently offered. It stays visible (below) but contributes no selectable row.
            issues.push({
              credentialId: credential.id,
              kind: credential.kind,
              label: credential.label,
              reason: "This credential's authentication is broken — reconnect it in Settings.",
            });
            continue;
          }
          let added = 0;
          for (const model of response.models) {
            // D-MI8 — credential × model, never the bare model id (see `hubModelOptionKey`).
            const key = hubModelOptionKey({ modelId: model.id, credentialId: credential.id });
            if (seen.has(key)) continue;
            seen.add(key);
            added += 1;
            roster.push({
              modelId: model.id,
              kind: credential.kind,
              credentialId: credential.id,
              credentialLabel: credential.label,
              ...(model.displayName ? { displayName: model.displayName } : {}),
            });
          }
          if (added === 0) {
            issues.push({
              credentialId: credential.id,
              kind: credential.kind,
              label: credential.label,
              reason: "It exposes no models — check the credential in Settings.",
            });
          }
        }
        setModels(roster);
        setUnavailable(issues);
      } catch {
        // Best-effort — the picker just falls back to a manual model-id entry.
        if (!cancelled) {
          setModels([]);
          setHasCredential(false);
          setUnavailable([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  return { models, loading, hasCredential, unavailable };
}

/**
 * `ModelSelectorLogo`'s `provider` prop (`@brand/ai`) accepts a closed set of known slugs plus an
 * arbitrary fallback string (`(string & {})`) — an unrecognized kind still renders (a generic
 * fallback glyph), never throws. `anthropic`/`openai`/`google` map straight through;
 * `claude_subscription` reuses the Anthropic mark (it IS Claude); `openai_compatible`/`ollama` pass
 * their own kind through as the fallback string (no dedicated logo in the set, but a stable label).
 *
 * D-MI6 (`roadmap/model-identity/`, WP 2.3): the mapping itself now lives in the ONE registry in
 * `packages/shared` (`PROVIDER_KIND_META[kind].logoProvider`) alongside the labels, so a glyph and a
 * name can never disagree about which provider a model belongs to. This stays exported under its
 * original name for its existing call sites (`Composer`, `NewSessionDialog`, agent-profile
 * `FormSections`); behaviour is byte-identical to the branch it replaced.
 */
export function modelSelectorLogoProvider(kind: ProviderKind): string {
  return PROVIDER_KIND_META[kind].logoProvider;
}

/**
 * Resolve a `ModelSelectorLogo` provider slug straight from a model id — no roster fetch — for the
 * agent/crew avatar "model image" fallback ({@link RoleAvatar}). Mirrors the API's `inferHubModelKind`
 * name heuristic (`apps/api/src/hub/routes.ts`), so a card renders the right logo even before any
 * roster is loaded. Returns `undefined` for an unrecognized id (the avatar then uses the `Persona`
 * glyph). Only the three name-hintable families have a dedicated logo; others fall through.
 */
export function inferModelLogoProvider(modelId: string): string | undefined {
  const lower = modelId.trim().toLowerCase();
  if (lower === "") return undefined;
  if (lower.startsWith("claude")) return "anthropic";
  if (lower.startsWith("gpt-") || /^o[1-9]/.test(lower)) return "openai";
  if (lower.startsWith("gemini")) return "google";
  return undefined;
}

export type HubModelFamily = { kind: ProviderKind; label: string; models: HubModelOption[] };

/**
 * Group the flat roster into families (by provider kind) for the two-step picker. Families appear in
 * first-seen roster order (credential-then-model, the order `useHubModelRoster` keeps), so the picker
 * is deterministic. Models within a family keep their roster order.
 *
 * D-MI6 (`roadmap/model-identity/`, WP 2.3): the family label comes from the ONE registry in
 * `packages/shared` (`providerKindLabel`). It used to come from a local `HUB_FAMILY_LABELS`
 * `Record<ProviderKind, string>` — one of the five disagreeing vocabularies — which is now DELETED
 * (nothing outside this file imported it). Exhaustiveness is still enforced, now at the registry:
 * `PROVIDER_KIND_META` is a `Record` over every {@link ProviderKind}, so a newly-added kind fails
 * `pnpm typecheck` there until it is classified.
 *
 * The old map and the registry agree on every label, so no
 * family chip this picker can actually render changes text. Where a chip is too tight for a full
 * name, `providerKindShortLabel(kind)` is the intended escape.
 */
export function groupModelsByFamily(models: HubModelOption[]): HubModelFamily[] {
  const order: ProviderKind[] = [];
  const byKind = new Map<ProviderKind, HubModelOption[]>();
  for (const model of models) {
    const existing = byKind.get(model.kind);
    if (existing) {
      existing.push(model);
    } else {
      byKind.set(model.kind, [model]);
      order.push(model.kind);
    }
  }
  return order.map((kind) => ({
    kind,
    label: providerKindLabel(kind),
    models: byKind.get(kind) ?? [],
  }));
}
