import { useId, useMemo, useState, type ReactNode } from "react";
import {
  ModelSelector,
  ModelSelectorContent,
  ModelSelectorEmpty,
  ModelSelectorGroup,
  ModelSelectorInput,
  ModelSelectorItem,
  ModelSelectorList,
  ModelSelectorLogo,
  ModelSelectorName,
  ModelSelectorTrigger,
} from "@elabs-ai/components-ai";
import { Alert, AlertDescription, Badge, Button, Skeleton, Text, cn } from "@elabs-ai/components-ui";
import { Check, ChevronsUpDown } from "lucide-react";
import {
  buildHubModelGroups,
  hubModelKeywords,
  hubModelTriggerLabel,
  sortHubModelIssues,
} from "./hub-model-picker";
import {
  hubModelOptionKey,
  modelSelectorLogoProvider,
  type HubModelCredentialIssue,
  type HubModelOption,
} from "./use-hub-models";

/**
 * `HubModelPicker` — THE model picker (D-MI7, `roadmap/model-identity/` WP 4.1).
 * ==============================================================================================
 *
 * One component replacing four implementations across nine call sites: a two-step family/model
 * button grid (`NewSessionDialog`), a keyword-less command palette (`Composer`), a search + card
 * grid (agent profile), and three plain `Input list=<datalist>` / `Select` fields (`QuickCreate`,
 * `RoleEditor`, crew member override, the limit-error banner). They disagreed about what a model
 * IS: some offered a credential-bearing roster row, some a bare id string; none of them could show
 * two credentials of the same kind apart.
 *
 * A ROW SHOWS (D-MI7): provider logo · display name · raw model id · billing badge · credential
 * label **when its kind has more than one credential**. Every label comes from the ONE registry in
 * `packages/shared` (`PROVIDER_KIND_META` / `providerKindLabel` / `PROVIDER_KIND_BILLING_LABELS`),
 * so `claude_subscription` reads "Anthropic CLI" here exactly as it does in Settings (D-MI5/D-MI6).
 *
 * GROUPING + ORDER are deterministic — per credential when a kind has several, else per kind,
 * sorted `kind` → `label` → `credentialId`. Never `updated_at DESC` (the order `listProviders()`
 * returns), which is what made "which twin survives" flip when an unrelated credential was edited.
 *
 * SEARCH: every row carries `keywords` (provider name, credential label, billing basis, raw kind)
 * on top of its `value`. cmdk scores `value + " " + keywords.join(" ")`, so the palette is finally
 * searchable by provider — `Composer.tsx` used to pass `value={model.modelId}` and no keywords, so
 * typing "anthropic" matched nothing. The credential nanoid appears in NEITHER (cmdk fuzzy-scores
 * both); row identity rides the `onSelect` closure. See `hub-model-picker.ts` for why `value`
 * carries the credential LABEL — without a unique `value`, cmdk's keyboard cannot reach the second
 * of two colliding twins at all.
 *
 * A BROKEN CREDENTIAL renders **disabled-and-visible**, never hidden: hiding it is what makes
 * *"why did it use the other one?"* unanswerable. Its reason is visible text AND wired to the row's
 * `aria-describedby`, so it reaches assistive tech (the `icon-affordances.md` posture; no native
 * `title` anywhere in this file).
 *
 * Every visible element is `@elabs-ai/components-*`; `className` is layout-only; semantic tokens only, so both
 * `light` and `dark` are covered without a single `dark:` override.
 */
export type HubModelPickerProps = {
  /** The live roster (`useHubModelRoster().models`). */
  models: readonly HubModelOption[];
  /** True while the roster is still being fetched — renders layout-shaped `Skeleton`s, not a spinner. */
  loading?: boolean;
  /** Credentials that contribute no selectable row (`useHubModelRoster().unavailable`). */
  unavailable?: readonly HubModelCredentialIssue[];
  /** The picked roster row, or `null`. */
  value: HubModelOption | null;
  /**
   * A bare model id with no roster row behind it — a legacy/unpinned session, an id typed before its
   * credential existed, or a credential that has since been deleted. Shown as its own selected row
   * so an already-assigned id is never silently dropped, and never re-attributed to a credential.
   */
  fallbackModelId?: string | null;
  onChange: (option: HubModelOption) => void;
  /**
   * Offers a "clear" row at the top of the palette (an optional override: "use the session's / the
   * role's default"). Omit for a required field.
   */
  clearOption?: { label: string; hint?: string; onClear: () => void };
  /** Element id for the trigger, so a `Label htmlFor` points at it. */
  id?: string;
  /** Accessible name prefix for the trigger, e.g. "Model" → "Model: claude-sonnet-5". */
  name?: string;
  /** Trigger text when nothing is picked. */
  placeholder?: string;
  disabled?: boolean;
  /** The palette dialog's (screen-reader-only) title. */
  dialogTitle?: string;
  /** Layout only. */
  className?: string;
  /**
   * A custom trigger (rendered `asChild`), for surfaces with their own chrome — the composer's
   * icon-only `PromptInputButton`, for instance. It must accept `onClick`/`ref` (any `@elabs-ai/components-ui`
   * `Button`-shaped element does).
   */
  trigger?: ReactNode;
  /** Shown instead of the palette when the roster is empty (and nothing is loading). */
  emptyMessage?: string;
};

export function HubModelPicker({
  models,
  loading = false,
  unavailable = [],
  value,
  fallbackModelId = null,
  onChange,
  clearOption,
  id,
  name = "Model",
  placeholder = "Choose a model…",
  disabled = false,
  dialogTitle,
  className,
  trigger,
  emptyMessage = "No provider credential has a usable model roster. Add or fix one in Settings.",
}: HubModelPickerProps) {
  const [open, setOpen] = useState(false);
  const reasonPrefix = useId();

  const groups = useMemo(() => buildHubModelGroups(models), [models]);
  const issues = useMemo(() => sortHubModelIssues(unavailable), [unavailable]);

  const selectedKey = value ? hubModelOptionKey(value) : null;
  // A `fallbackModelId` only matters while nothing from the roster is picked; once a real row is
  // chosen the off-roster id is history.
  const offRoster =
    value === null && fallbackModelId != null && fallbackModelId.trim() !== ""
      ? fallbackModelId.trim()
      : null;

  const triggerText = value
    ? hubModelTriggerLabel(value)
    : offRoster !== null
      ? offRoster
      : placeholder;

  function pick(option: HubModelOption): void {
    onChange(option);
    setOpen(false);
  }

  const hasRows = groups.length > 0;

  return (
    <ModelSelector open={open} onOpenChange={setOpen}>
      <ModelSelectorTrigger asChild disabled={disabled}>
        {trigger ?? (
          <Button
            id={id}
            type="button"
            variant="outline"
            disabled={disabled}
            aria-label={`${name}: ${triggerText}`}
            className={cn("w-full justify-between gap-2 font-normal", className)}
          >
            <span className="flex min-w-0 items-center gap-2">
              {value ? (
                <ModelSelectorLogo
                  provider={modelSelectorLogoProvider(value.kind)}
                  className="size-4 shrink-0"
                />
              ) : null}
              <span className="min-w-0 truncate">{triggerText}</span>
            </span>
            <ChevronsUpDown aria-hidden className="size-4 shrink-0 opacity-50" />
          </Button>
        )}
      </ModelSelectorTrigger>
      <ModelSelectorContent title={dialogTitle ?? `Choose a model`}>
        <ModelSelectorInput placeholder="Search models, providers, credentials…" />
        <ModelSelectorList>
          <ModelSelectorEmpty>
            {loading ? "Loading models…" : "No models match your search."}
          </ModelSelectorEmpty>

          {loading ? (
            // `loading` = "no content yet" (loading-states rule): layout-shaped placeholders sized
            // like the rows that will replace them, never a spinner that collapses the list.
            <div className="flex flex-col gap-2 p-2" aria-hidden>
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-9 w-full" />
            </div>
          ) : null}

          {clearOption ? (
            <ModelSelectorGroup heading="Default">
              <ModelSelectorItem
                value={clearOption.label}
                keywords={["default", "clear", "inherit"]}
                onSelect={() => {
                  clearOption.onClear();
                  setOpen(false);
                }}
              >
                <span className="flex min-w-0 flex-1 flex-col text-start">
                  <ModelSelectorName>{clearOption.label}</ModelSelectorName>
                  {clearOption.hint ? (
                    <Text as="span" variant="caption" tone="muted" className="truncate">
                      {clearOption.hint}
                    </Text>
                  ) : null}
                </span>
                {value === null && offRoster === null ? (
                  <Check aria-hidden className="size-4 shrink-0" />
                ) : null}
              </ModelSelectorItem>
            </ModelSelectorGroup>
          ) : null}

          {offRoster !== null ? (
            <ModelSelectorGroup heading="Current selection">
              {/* Not in the live roster: no credential is known, so none is invented. Selecting it
                  is a no-op that just closes the palette — it is already the value. */}
              <ModelSelectorItem
                value={offRoster}
                keywords={["current", "not in roster"]}
                onSelect={() => setOpen(false)}
              >
                <span className="flex min-w-0 flex-1 flex-col text-start">
                  <ModelSelectorName>{offRoster}</ModelSelectorName>
                  <Text as="span" variant="caption" tone="muted" className="truncate">
                    Not in the live roster — no provider is pinned to it.
                  </Text>
                </span>
                <Check aria-hidden className="size-4 shrink-0" />
              </ModelSelectorItem>
            </ModelSelectorGroup>
          ) : null}

          {groups.map((group) => (
            <ModelSelectorGroup key={group.id} heading={group.heading}>
              {group.rows.map((row) => (
                <ModelSelectorItem
                  key={row.key}
                  // D-MI7 — human-readable and unique; the credential NANOID is in neither `value`
                  // nor `keywords` (cmdk fuzzy-scores both). Identity rides `onSelect`'s closure.
                  value={row.value}
                  keywords={row.keywords}
                  onSelect={() => pick(row.option)}
                >
                  <ModelSelectorLogo
                    provider={modelSelectorLogoProvider(row.option.kind)}
                    className="size-4 shrink-0"
                  />
                  <span className="flex min-w-0 flex-1 flex-col text-start">
                    <ModelSelectorName>{row.displayName}</ModelSelectorName>
                    {row.modelId === row.displayName ? null : (
                      <Text as="span" variant="caption" tone="muted" className="truncate">
                        {row.modelId}
                      </Text>
                    )}
                  </span>
                  {row.credentialLabel ? (
                    <Badge variant="outline" className="shrink-0">
                      {row.credentialLabel}
                    </Badge>
                  ) : null}
                  <Badge variant="secondary" className="shrink-0">
                    {row.billingLabel}
                  </Badge>
                  {row.key === selectedKey ? (
                    <Check aria-hidden className="size-4 shrink-0" />
                  ) : null}
                </ModelSelectorItem>
              ))}
            </ModelSelectorGroup>
          ))}

          {issues.length > 0 ? (
            <ModelSelectorGroup heading="Unavailable">
              {issues.map((issue) => {
                const reasonId = `${reasonPrefix}-${issue.credentialId}`;
                return (
                  <ModelSelectorItem
                    key={issue.credentialId}
                    // Visible, and deliberately NOT selectable — hiding a broken credential is what
                    // makes "why did it use the other one?" unanswerable (D-MI7).
                    disabled
                    value={`${issue.label} unavailable`}
                    keywords={hubModelKeywords(
                      { modelId: "", kind: issue.kind, credentialId: issue.credentialId },
                      issue.label,
                    )}
                    aria-describedby={reasonId}
                  >
                    <ModelSelectorLogo
                      provider={modelSelectorLogoProvider(issue.kind)}
                      className="size-4 shrink-0"
                    />
                    <span className="flex min-w-0 flex-1 flex-col text-start">
                      <ModelSelectorName>{issue.label}</ModelSelectorName>
                      {/* The reason is VISIBLE and is the `aria-describedby` target, so it reaches
                          assistive tech without a tooltip having to be opened (D-TB5 posture). */}
                      <Text
                        as="span"
                        id={reasonId}
                        variant="caption"
                        tone="muted"
                        className="text-pretty"
                      >
                        {issue.reason}
                      </Text>
                    </span>
                  </ModelSelectorItem>
                );
              })}
            </ModelSelectorGroup>
          ) : null}
        </ModelSelectorList>

        {!loading && !hasRows ? (
          <div className="p-3">
            <Alert variant="warning">
              <AlertDescription>{emptyMessage}</AlertDescription>
            </Alert>
          </div>
        ) : null}
      </ModelSelectorContent>
    </ModelSelector>
  );
}
