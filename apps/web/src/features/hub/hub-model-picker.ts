import {
  PROVIDER_KINDS,
  PROVIDER_KIND_BILLING_LABELS,
  providerKindBilling,
  providerKindLabel,
  providerKindShortLabel,
  type ProviderKind,
} from "@mcp-token-footprint/shared";
import {
  hubModelOptionKey,
  type HubModelCredentialIssue,
  type HubModelOption,
} from "./use-hub-models";

/**
 * `HubModelPicker`'s pure data layer (D-MI7, `planning/Roadmap/RM-16-model-identity/` WP 4.1).
 * ==============================================================================================
 *
 * Kept framework-free so the two load-bearing behaviours can be unit-tested without rendering a
 * command palette:
 *
 *  1. **Grouping + order are deterministic and data-independent.** Groups are keyed per CREDENTIAL
 *     when a kind has more than one, otherwise per KIND, and sorted `kind` → `label` → `credentialId`.
 *     They are explicitly NOT in roster order, because the roster arrives in `listProviders()` order,
 *     which is `ORDER BY updated_at DESC` (`apps/api/src/providers/repository.ts`) — editing an
 *     unrelated credential used to reshuffle the picker, and (before D-MI8) flip which of two
 *     colliding twins survived.
 *
 *  2. **Row identity for cmdk.** Each row gets a stable, human-readable `value` and a `keywords`
 *     list. Both feed `commandScore(value + " " + keywords.join(" "), search)` — cmdk's default
 *     filter — so a row is findable by model id, display name, provider name and credential label.
 *     Neither may contain the credential nanoid (D-MI7).
 */

/** One selectable row in the palette. */
export type HubModelPickerRow = {
  option: HubModelOption;
  /**
   * `${credentialId}::${modelId}` — the LOCAL row identity (React key, "is this the selected row?").
   * Never the wire, never cmdk's `value`. See {@link hubModelOptionKey}.
   */
  key: string;
  /**
   * cmdk's `value`. Human-readable and **globally unique across the palette**, because cmdk resolves
   * the keyboard-highlighted item by `data-value` (`querySelector('[cmdk-item][aria-selected=true]')`
   * returns the FIRST match) — two items sharing a `value` are one item as far as arrow keys and
   * Enter are concerned, so the second is unreachable without a mouse.
   *
   * ⚠️ This is the WP-3.1 carry-forward finding, and it is why `value` is not simply `modelId`:
   * two colliding twins (`claude-sonnet-5` on the metered key and on the subscription) would trap
   * the keyboard on the first one. `keywords` alone cannot fix it — cmdk writes only `value` into
   * `data-value`; keywords participate in scoring but never in selection identity.
   *
   * The disambiguator is the CREDENTIAL LABEL (a human word the operator typed), plus an ordinal
   * suffix in the pathological case of two identically-labelled credentials — never the credential
   * nanoid, which cmdk would fuzzy-score into search results (D-MI7).
   */
  value: string;
  /** Extra fuzzy-search terms: provider name, credential label, billing basis, raw kind. */
  keywords: string[];
  /** What the row leads with — the provider's display name, falling back to the raw id. */
  displayName: string;
  /** The raw model id, always shown (it is what the wire carries and what a report will quote). */
  modelId: string;
  /** "Metered" / "Subscription" / "Local" / "Questions" — {@link PROVIDER_KIND_BILLING_LABELS}. */
  billingLabel: string;
  /** Present only when this row's KIND has more than one credential (D-MI7). */
  credentialLabel?: string;
};

export type HubModelPickerGroup = {
  /** `credential:<id>` or `kind:<kind>` — a React key only. */
  id: string;
  heading: string;
  kind: ProviderKind;
  rows: HubModelPickerRow[];
};

/** Canonical kind order — the `PROVIDER_KINDS` declaration order, so it can never depend on data. */
function kindRank(kind: ProviderKind): number {
  const index = (PROVIDER_KINDS as readonly string[]).indexOf(kind);
  return index === -1 ? PROVIDER_KINDS.length : index;
}

/** The label a credential is known by, with a stable fallback when the roster row carries none. */
export function hubCredentialLabel(option: HubModelOption): string {
  return option.credentialLabel?.trim() || providerKindLabel(option.kind);
}

/**
 * The fuzzy-search terms for a row beyond its `value`. Deliberately all HUMAN words: the provider's
 * full and short names, the credential's label, the billing basis, and the raw `ProviderKind`
 * literal (an operator who knows the API vocabulary can type `claude_subscription`).
 *
 * This is the D-MI7 fix for "the palette cannot be searched by provider": `Composer.tsx` passed
 * `value={model.modelId}` and no keywords, so typing "anthropic" matched nothing.
 */
export function hubModelKeywords(option: HubModelOption, credentialLabel: string): string[] {
  const terms = [
    option.modelId,
    option.displayName ?? "",
    providerKindLabel(option.kind),
    providerKindShortLabel(option.kind),
    credentialLabel,
    PROVIDER_KIND_BILLING_LABELS[providerKindBilling(option.kind)],
    option.kind,
  ];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const term of terms) {
    const trimmed = term.trim();
    if (trimmed === "" || seen.has(trimmed.toLowerCase())) continue;
    seen.add(trimmed.toLowerCase());
    out.push(trimmed);
  }
  return out;
}

/**
 * Build the palette's groups from a flat roster.
 *
 * Grouping (D-MI7): per credential when the kind has >1 credential, else per kind. Rows inside a
 * group keep the provider's own roster order (one group is always one credential, so that order is
 * that credential's `/models` response — stable), while the GROUPS are sorted deterministically.
 */
export function buildHubModelGroups(
  models: readonly HubModelOption[],
): HubModelPickerGroup[] {
  const credentialsByKind = new Map<ProviderKind, Set<string>>();
  for (const model of models) {
    const set = credentialsByKind.get(model.kind) ?? new Set<string>();
    set.add(model.credentialId);
    credentialsByKind.set(model.kind, set);
  }

  type Draft = {
    id: string;
    kind: ProviderKind;
    heading: string;
    sortLabel: string;
    credentialId: string;
    rows: Omit<HubModelPickerRow, "value">[];
  };
  const drafts = new Map<string, Draft>();

  for (const option of models) {
    const perKind = credentialsByKind.get(option.kind)?.size ?? 1;
    const splitByCredential = perKind > 1;
    const credentialLabel = hubCredentialLabel(option);
    const groupId = splitByCredential
      ? `credential:${option.credentialId}`
      : `kind:${option.kind}`;
    const kindLabel = providerKindLabel(option.kind);
    const heading = splitByCredential ? `${kindLabel} · ${credentialLabel}` : kindLabel;

    const draft = drafts.get(groupId) ?? {
      id: groupId,
      kind: option.kind,
      heading,
      sortLabel: splitByCredential ? credentialLabel : "",
      credentialId: option.credentialId,
      rows: [],
    };
    draft.rows.push({
      option,
      key: hubModelOptionKey(option),
      keywords: hubModelKeywords(option, credentialLabel),
      displayName: option.displayName?.trim() || option.modelId,
      modelId: option.modelId,
      billingLabel: PROVIDER_KIND_BILLING_LABELS[providerKindBilling(option.kind)],
      // The credential chip is the "two Anthropic keys look identical" fix — shown ONLY when the
      // kind actually has more than one credential, so the common single-key case stays quiet.
      ...(splitByCredential ? { credentialLabel } : {}),
    });
    drafts.set(groupId, draft);
  }

  const ordered = [...drafts.values()].sort(
    (a, b) =>
      kindRank(a.kind) - kindRank(b.kind) ||
      a.sortLabel.localeCompare(b.sortLabel) ||
      // Total order tie-break for two identically-labelled credentials of the same kind. Credential
      // ids are stable, so the result is deterministic — it is only ever a tie-break, never a rank.
      a.credentialId.localeCompare(b.credentialId),
  );

  // Assign cmdk `value`s last, once the group order is fixed, so the ordinal disambiguator (needed
  // only when two credentials of one kind share a label) is itself deterministic.
  const used = new Set<string>();
  return ordered.map((draft) => ({
    id: draft.id,
    heading: draft.heading,
    kind: draft.kind,
    rows: draft.rows.map((row) => {
      const parts = [row.displayName];
      if (row.modelId !== row.displayName) parts.push(row.modelId);
      if (row.credentialLabel) parts.push(row.credentialLabel);
      const base = parts.join(" ");
      let value = base;
      let ordinal = 2;
      while (used.has(value.toLowerCase())) {
        value = `${base} (${ordinal})`;
        ordinal += 1;
      }
      used.add(value.toLowerCase());
      return { ...row, value };
    }),
  }));
}

/**
 * The credentials that contribute no selectable row, in the same deterministic order the groups use,
 * so the "unavailable" block below the palette doesn't reshuffle either.
 */
export function sortHubModelIssues(
  issues: readonly HubModelCredentialIssue[],
): HubModelCredentialIssue[] {
  return [...issues].sort(
    (a, b) =>
      kindRank(a.kind) - kindRank(b.kind) ||
      a.label.localeCompare(b.label) ||
      a.credentialId.localeCompare(b.credentialId),
  );
}

/**
 * The DEFAULT row for a surface that has to pre-pick one (a crew's coordinating session, the
 * new-session dialog's seed): the first row of the deterministic grouping, **not** `models[0]`.
 *
 * `models[0]` is the first model of whichever credential `listProviders()` happened to return first,
 * i.e. the most recently *edited* one (`ORDER BY updated_at DESC`) — so editing an unrelated
 * credential's label silently changed which provider a crew instantiated on.
 */
export function defaultHubModelOption(
  models: readonly HubModelOption[],
): HubModelOption | undefined {
  return buildHubModelGroups(models)[0]?.rows[0]?.option;
}

/** The one-line summary a closed trigger shows for a picked row. */
export function hubModelTriggerLabel(option: HubModelOption): string {
  const name = option.displayName?.trim();
  return name && name !== option.modelId ? `${name} (${option.modelId})` : option.modelId;
}
