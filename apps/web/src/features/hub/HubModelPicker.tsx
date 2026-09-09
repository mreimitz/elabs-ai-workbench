import {
  cloneElement,
  isValidElement,
  useId,
  useMemo,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react";
import { ModelProviderLogo } from "@elabs-ai/components-ai";
import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  Skeleton,
  Text,
  cn,
} from "@elabs-ai/components-ui";
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
 * `HubModelPicker` — THE model picker (D-MI7, `planning/Roadmap/RM-16-model-identity/` WP 4.1).
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

/**
 * What `ModelSelectorName` was, verbatim: `<span className="flex-1 truncate text-start">`.
 *
 * brand-ui 4.1.0 deleted the whole `ModelSelector*` family (RM-39 WP 1.3). Eleven of its fourteen
 * exports were one-line pass-throughs of `@elabs-ai/components-ui` components — `ModelSelectorGroup`
 * *was* `CommandGroup`, `ModelSelectorItem` *was* `CommandItem` — so this file now composes those
 * directly. This one had no `-ui` equivalent to pass through to; it was three utility classes, and
 * it is local rather than re-invented as a component because a bare styled span is not a design
 * decision anyone else needs to share.
 */
function RowName({ className, ...props }: ComponentProps<"span">) {
  return <span className={cn("flex-1 truncate text-start", className)} {...props} />;
}

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

  /**
   * A caller-supplied trigger, wired to open the palette.
   *
   * This used to be `<DialogTrigger asChild>{trigger}</DialogTrigger>`, which let Radix inject the
   * click handler and the ref through its Slot. `CommandDialog` owns its own `Dialog` (see the
   * comment at the render site for why that is the shape we want), so there is no trigger slot to
   * fill and the click is attached here instead. `isValidElement` guards it: a caller who passes
   * something that is not a single element gets their node rendered untouched rather than a crash,
   * and the default `Button` branch below is unaffected.
   */
  const customTrigger =
    trigger !== undefined && isValidElement<{ onClick?: () => void }>(trigger)
      ? cloneElement(trigger, { onClick: () => setOpen(true) })
      : trigger;

  const hasRows = groups.length > 0;

  return (
    <>
      {/* The trigger is a SIBLING of the palette, not a `DialogTrigger` inside it. `CommandDialog`
          composes its own dialog surface internally, which is the point — this app's dialog-kit
          guardrail (design-remediation T2) forbids hand-rolling that surface outside
          `components/dialogs/`, and its allowlist may only ever shrink. So the open state is driven
          directly, and a caller-supplied trigger is cloned to carry the click rather than being
          handed `asChild` slot behaviour. */}
      {customTrigger ?? (
        <Button
          id={id}
          type="button"
          variant="outline"
          disabled={disabled}
          onClick={() => setOpen(true)}
          aria-label={`${name}: ${triggerText}`}
          className={cn("w-full justify-between gap-2 font-normal", className)}
        >
          <span className="flex min-w-0 items-center gap-2">
            {value ? (
              <ModelProviderLogo
                provider={modelSelectorLogoProvider(value.kind)}
                className="size-4 shrink-0"
              />
            ) : null}
            <span className="min-w-0 truncate">{triggerText}</span>
          </span>
          <ChevronsUpDown aria-hidden className="size-4 shrink-0 opacity-50" />
        </Button>
      )}
      {/* `CommandDialog` renders the `sr-only` `DialogTitle` from `title` — the same accessible name
          `ModelSelectorContent` gave the palette before 4.1.0 removed it. */}
      <CommandDialog open={open} onOpenChange={setOpen} title={dialogTitle ?? `Choose a model`}>
        {/* `data-testid` is a deliberate, load-bearing test hook, not a leftover. Until 4.1.0 the
            palette body WAS an element — `ModelSelectorContent` — and eight test files address it to
            scope their queries to the palette rather than to the dialog that may be hosting it (a
            model picker inside `NewSessionDialog` means two dialogs on screen, so `getByRole("dialog")`
            is ambiguous there). `CommandDialog` composes its surface internally and gives a caller
            nowhere to put an attribute, so the body keeps its identity here. Behavioural assertions
            still go through roles and accessible names; this only says WHERE to look. */}
        <div data-testid="model-selector-content" className="contents">
          {/* An explicit accessible name. `CommandInput` renders a `combobox` whose only label was
              its placeholder, which assistive tech is not required to expose as a name. The old test
              mock supplied one of its own, so the gap never showed up in a test — naming it here is
              the fix, not a test accommodation. */}
          <CommandInput
            aria-label="Search models"
            className="h-auto py-3.5"
            placeholder="Search models, providers, credentials…"
          />
          <CommandList>
            <CommandEmpty>
              {loading ? "Loading models…" : "No models match your search."}
            </CommandEmpty>

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
              <CommandGroup heading="Default">
                <CommandItem
                  value={clearOption.label}
                  keywords={["default", "clear", "inherit"]}
                  onSelect={() => {
                    clearOption.onClear();
                    setOpen(false);
                  }}
                >
                  <span className="flex min-w-0 flex-1 flex-col text-start">
                    <RowName>{clearOption.label}</RowName>
                    {clearOption.hint ? (
                      <Text as="span" variant="caption" tone="muted" className="truncate">
                        {clearOption.hint}
                      </Text>
                    ) : null}
                  </span>
                  {value === null && offRoster === null ? (
                    <Check aria-hidden className="size-4 shrink-0" />
                  ) : null}
                </CommandItem>
              </CommandGroup>
            ) : null}

            {offRoster !== null ? (
              <CommandGroup heading="Current selection">
                {/* Not in the live roster: no credential is known, so none is invented. Selecting it
                  is a no-op that just closes the palette — it is already the value. */}
                <CommandItem
                  value={offRoster}
                  keywords={["current", "not in roster"]}
                  onSelect={() => setOpen(false)}
                >
                  <span className="flex min-w-0 flex-1 flex-col text-start">
                    <RowName>{offRoster}</RowName>
                    <Text as="span" variant="caption" tone="muted" className="truncate">
                      Not in the live roster — no provider is pinned to it.
                    </Text>
                  </span>
                  <Check aria-hidden className="size-4 shrink-0" />
                </CommandItem>
              </CommandGroup>
            ) : null}

            {groups.map((group) => (
              <CommandGroup key={group.id} heading={group.heading}>
                {group.rows.map((row) => (
                  <CommandItem
                    key={row.key}
                    // D-MI7 — human-readable and unique; the credential NANOID is in neither `value`
                    // nor `keywords` (cmdk fuzzy-scores both). Identity rides `onSelect`'s closure.
                    value={row.value}
                    keywords={row.keywords}
                    onSelect={() => pick(row.option)}
                  >
                    <ModelProviderLogo
                      provider={modelSelectorLogoProvider(row.option.kind)}
                      className="size-4 shrink-0"
                    />
                    <span className="flex min-w-0 flex-1 flex-col text-start">
                      <RowName>{row.displayName}</RowName>
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
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}

            {issues.length > 0 ? (
              <CommandGroup heading="Unavailable">
                {issues.map((issue) => {
                  const reasonId = `${reasonPrefix}-${issue.credentialId}`;
                  return (
                    <CommandItem
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
                      <ModelProviderLogo
                        provider={modelSelectorLogoProvider(issue.kind)}
                        className="size-4 shrink-0"
                      />
                      <span className="flex min-w-0 flex-1 flex-col text-start">
                        <RowName>{issue.label}</RowName>
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
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            ) : null}
          </CommandList>

          {!loading && !hasRows ? (
            <div className="p-3">
              <Alert variant="warning">
                <AlertDescription>{emptyMessage}</AlertDescription>
              </Alert>
            </div>
          ) : null}
        </div>
      </CommandDialog>
    </>
  );
}
