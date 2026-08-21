import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type {
  Collection,
  GithubAccountStatus,
  WatchRule,
  WatchWindowPreview,
} from "@mcp-token-footprint/shared";
import {
  GRADER_IDS,
  RUN_METRICS_GROUP_BY,
  RUN_METRICS_MEASURES,
  WATCH_COOLDOWN_MAX_MINUTES,
  WATCH_MIN_INTERVAL_MAX_MINUTES,
  WATCH_NO_DATA_POLICIES,
  WATCH_NOTIFY_SEVERITIES,
  WATCH_WINDOW_DURATIONS,
  WATCH_WINDOW_OPS,
  validateWatchThresholds,
} from "@mcp-token-footprint/shared";
import {
  Alert,
  AlertDescription,
  Checkbox,
  Input,
  Label,
  NumberInput,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  Text,
  Textarea,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  cn,
  toast,
} from "@elabs-ai/components-ui";
import { WideDialog, DialogSection, type WideDialogSection } from "../../components/dialogs";
import { FieldRow } from "../../components/FieldRow";
import { KeyValueEditor, SegmentedField } from "../../components/form";
import { RunFilterBar, type RunFilterOptionData } from "../testing/runs/RunFilterBar";
import {
  ApiError,
  createWatchRule,
  getGithubAccount,
  listCollections,
  previewWatchWindow,
  updateWatchRule,
} from "../../lib/api";
import { getErrorMessage } from "../../lib/errors";
import {
  type ActionFormState,
  type RuleFormState,
  bucketForWindow,
  emptyRuleFormState,
  ruleToDuplicateFormState,
  ruleToFormState,
  toWatchRuleInput,
  toWatchRulePatch,
  validateActions,
  windowForWire,
} from "./rule-form";
import { useRunFilterOptions } from "./use-run-filter-options";
import { WindowPreviewStrip } from "./WindowPreviewStrip";

export type RuleEditorMode = "create" | "edit" | "duplicate";

/**
 * The rules editor (Observability WP4.4) — a `WideDialog` (create/edit/duplicate all share it).
 * Three sections: Trigger (name/enabled/trigger + the REUSED WP2.3 `RunFilterBar` + the windowed
 * threshold config), Preview (windowed only — the MANDATORY historical preview gating Save,
 * conventions §11), Actions (the closed action-type checklist + per-action config). A webhook
 * action's URL is write-only and is only re-sent when the Actions step was actually touched this
 * session (see `rule-form.ts`'s `toWatchRulePatch` doc) — so editing just the filter of a rule that
 * already has a webhook never forces re-entering its secret.
 */
export function RuleEditorDialog({
  open,
  onOpenChange,
  mode,
  rule,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: RuleEditorMode;
  /** The source rule for `edit`/`duplicate`; `null` for `create`. */
  rule: WatchRule | null;
  onSaved: (rule: WatchRule) => void;
}) {
  const [state, setState] = useState<RuleFormState>(emptyRuleFormState());
  const [actionsTouched, setActionsTouched] = useState(false);
  const [activeSectionId, setActiveSectionId] = useState("trigger");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [issues, setIssues] = useState<{ path: (string | number)[]; message: string }[] | null>(null);
  const [collections, setCollections] = useState<Collection[]>([]);
  /** AM-OB11 — the redacted GitHub account status (identity + scopes, NEVER the token). `null` until
   *  the lookup settles. `githubChecked` separates "still looking" from "looked, and there is none":
   *  the workflow-dispatch slot is disabled in both, but it must not accuse the operator of having
   *  no account while the answer is still in flight. */
  const [githubAccount, setGithubAccount] = useState<GithubAccountStatus | null>(null);
  const [githubChecked, setGithubChecked] = useState(false);

  const [preview, setPreview] = useState<WatchWindowPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewedSignature, setPreviewedSignature] = useState<string | null>(null);

  const initialSnapshotRef = useRef<string>("");

  const options = useRunFilterOptions(open);

  useEffect(() => {
    if (!open) return;
    const initial =
      mode === "edit" && rule
        ? ruleToFormState(rule)
        : mode === "duplicate" && rule
          ? ruleToDuplicateFormState(rule)
          : emptyRuleFormState();
    setState(initial);
    initialSnapshotRef.current = JSON.stringify(initial);
    setActionsTouched(false);
    setActiveSectionId("trigger");
    setFormError(null);
    setIssues(null);
    setPreview(null);
    setPreviewError(null);
    setPreviewedSignature(null);
    setSaving(false);
    let alive = true;
    setGithubAccount(null);
    setGithubChecked(false);
    listCollections()
      .then((list) => alive && setCollections(list))
      .catch(() => {
        // Best-effort — the collection pickers just show no options.
      });
    // AM-OB11 — the workflow-dispatch action rides the app-wide connected GitHub account, so the
    // editor asks whether one exists. Best-effort: a failure leaves `githubAccount` null, which the
    // slot reads as "not connected" and says so, rather than offering an action that cannot run.
    getGithubAccount()
      .then((status) => {
        if (!alive) return;
        setGithubAccount(status);
        setGithubChecked(true);
      })
      .catch(() => {
        // Best-effort. A failed lookup settles as "no account": the slot stays disabled and says so,
        // which is the safe reading — offering an action that cannot run would be worse.
        if (alive) setGithubChecked(true);
      });
    return () => {
      alive = false;
    };
  }, [open, mode, rule]);

  const dirty = open && JSON.stringify(state) !== initialSnapshotRef.current;

  const currentWindowSignature = useMemo(
    () => JSON.stringify({ filter: state.filter, window: state.window }),
    [state.filter, state.window],
  );
  const previewIsCurrent = previewedSignature !== null && previewedSignature === currentWindowSignature;
  const windowedNeedsPreview = state.trigger === "windowed" && !previewIsCurrent;

  async function runPreview() {
    setPreviewLoading(true);
    setPreviewError(null);
    const signatureAtRequest = currentWindowSignature;
    try {
      const result = await previewWatchWindow({
        filter: state.filter,
        // AM-OB4 — the SAME projection Save uses (`windowForWire`), so the preview cannot 400 on a
        // stale ratio draft that Save would have dropped, and cannot preview a window Save would not
        // have sent.
        window: windowForWire(state.window),
      });
      setPreview(result);
      setPreviewedSignature(signatureAtRequest);
    } catch (err) {
      setPreviewError(getErrorMessage(err, "Couldn’t preview the window. Try again."));
    } finally {
      setPreviewLoading(false);
    }
  }

  async function handleSave() {
    setFormError(null);
    setIssues(null);
    if (!state.name.trim()) {
      setFormError("Name is required.");
      setActiveSectionId("trigger");
      return;
    }
    const actionsRequired = mode !== "edit" || actionsTouched;
    if (actionsRequired) {
      const validation = validateActions(state.actions);
      if (!validation.ok) {
        setFormError(validation.message);
        setActiveSectionId("actions");
        return;
      }
    }
    // AM-OB10 — a warning that is not strictly LESS severe than the alert can never fire at the
    // warning level. Caught here with the same shared predicate the API's zod uses, so the operator
    // gets an inline message instead of a 400.
    if (state.trigger === "windowed") {
      const thresholds = validateWatchThresholds(state.window);
      if (!thresholds.ok) {
        setFormError(thresholds.message);
        setActiveSectionId("trigger");
        return;
      }
      // AM-OB4 — an empty numerator is schema-VALID (an unconstrained RunFilter) and would save as a
      // rule whose share is 100% in every window, i.e. one that fires forever. The wire cannot catch
      // that, so the editor does.
      if (
        state.window.measure === "ratio" &&
        Object.keys(state.window.ratio?.numerator ?? {}).length === 0
      ) {
        setFormError(
          "Add at least one condition to the share's numerator — an empty one matches every run.",
        );
        setActiveSectionId("trigger");
        return;
      }
    }
    if (windowedNeedsPreview) {
      setFormError("Run the preview before saving a windowed rule.");
      setActiveSectionId("preview");
      return;
    }
    setSaving(true);
    try {
      const saved =
        mode === "edit" && rule
          ? await updateWatchRule(rule.id, toWatchRulePatch(state, actionsTouched))
          : await createWatchRule(toWatchRuleInput(state));
      onOpenChange(false);
      onSaved(saved);
      toast.success(mode === "edit" ? "Rule updated" : "Rule created", { description: saved.name });
    } catch (err) {
      // The error banner lives in the Trigger section (the first, always-present one) — jump there
      // so a failure surfaced while the Actions/Preview tab was active is actually visible, exactly
      // like the earlier client-side validation branches above.
      setActiveSectionId("trigger");
      if (err instanceof ApiError && err.issues) {
        setIssues(err.issues);
        setFormError(err.message);
      } else {
        setFormError(getErrorMessage(err, "Couldn’t save the rule. Check the details and try again."));
      }
    } finally {
      setSaving(false);
    }
  }

  const sections: WideDialogSection[] = [
    {
      id: "trigger",
      label: "Trigger",
      content: (
        <TriggerSection
          state={state}
          onChange={setState}
          options={options}
          formError={formError}
          issues={issues}
        />
      ),
    },
    ...(state.trigger === "windowed"
      ? [
          {
            id: "preview",
            label: "Preview",
            content: (
              <WindowPreviewStrip
                preview={preview}
                loading={previewLoading}
                error={previewError}
                onRunPreview={() => void runPreview()}
              />
            ),
          },
        ]
      : []),
    {
      id: "actions",
      label: "Actions",
      content: (
        <ActionsSection
          actions={state.actions}
          collections={collections}
          githubAccount={githubAccount}
          githubChecked={githubChecked}
          formError={formError}
          issues={issues}
          onChange={(actions) => {
            setActionsTouched(true);
            setState((current) => ({ ...current, actions }));
          }}
        />
      ),
    },
  ];

  const primaryLabel =
    mode === "edit" ? "Save changes" : mode === "duplicate" ? "Create copy" : "Create rule";

  return (
    <WideDialog
      open={open}
      onOpenChange={onOpenChange}
      title={mode === "edit" ? `Edit ${rule?.name ?? "rule"}` : mode === "duplicate" ? "Duplicate rule" : "New watch rule"}
      description="When a run matches this filter, run the enabled actions."
      sections={sections}
      activeSectionId={activeSectionId}
      onActiveSectionChange={setActiveSectionId}
      primaryLabel={primaryLabel}
      onSubmit={() => void handleSave()}
      busy={saving}
      submitDisabled={saving || !state.name.trim() || windowedNeedsPreview}
      dirty={dirty}
      footerStart={
        windowedNeedsPreview ? "Run the preview before saving a windowed rule." : undefined
      }
    />
  );
}

/**
 * The one save-error surface, rendered by whichever section `handleSave` sent the operator to.
 *
 * It used to live only inside `TriggerSection`, which meant an ACTIONS-step failure ("Enable at
 * least one action", a bad webhook URL, and now a bad workflow-dispatch target) set the message,
 * switched to the Actions step — and showed nothing, because only the active section is mounted.
 * AM-OB11 needs its target error to be visible where the operator typed it, so the alert became a
 * shared part both sections render.
 */
function FormErrorAlert({
  formError,
  issues,
}: {
  formError: string | null;
  issues: { path: (string | number)[]; message: string }[] | null;
}) {
  if (!formError) return null;
  return (
    <Alert variant="destructive">
      <AlertDescription>
        {formError}
        {issues && issues.length > 0 ? (
          <ul className="mt-1.5 list-inside list-disc">
            {issues.map((issue, index) => (
              <li key={index}>
                {issue.path.length > 0 ? `${issue.path.join(".")}: ` : ""}
                {issue.message}
              </li>
            ))}
          </ul>
        ) : null}
      </AlertDescription>
    </Alert>
  );
}

function TriggerSection({
  state,
  onChange,
  options,
  formError,
  issues,
}: {
  state: RuleFormState;
  onChange: (next: RuleFormState) => void;
  options: RunFilterOptionData;
  formError: string | null;
  issues: { path: (string | number)[]; message: string }[] | null;
}) {
  const patch = (partial: Partial<RuleFormState>) => onChange({ ...state, ...partial });

  return (
    <div className="flex flex-col gap-5">
      <FormErrorAlert formError={formError} issues={issues} />

      <DialogSection title="Identity">
        <FieldRow id="rule-name" label="Name">
          <Input
            id="rule-name"
            value={state.name}
            placeholder="High error rate on Finance…"
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => patch({ name: event.target.value })}
          />
        </FieldRow>
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor="rule-enabled">Enabled</Label>
          <Switch
            id="rule-enabled"
            checked={state.enabled}
            onCheckedChange={(checked) => patch({ enabled: checked })}
          />
        </div>
      </DialogSection>

      <DialogSection title="Trigger">
        <SegmentedField
          id="rule-trigger"
          label="Fires"
          value={state.trigger}
          onChange={(value) => onChange({ ...state, trigger: value as RuleFormState["trigger"] })}
          options={[
            { value: "on_terminal", label: "On terminal run" },
            { value: "windowed", label: "Windowed threshold" },
          ]}
          help={
            state.trigger === "on_terminal"
              ? "Evaluated once per run, right after it finishes."
              : "Evaluated on a schedule, over a trailing time window."
          }
        />
      </DialogSection>

      <DialogSection title="Filter" description="Which runs count toward this rule.">
        <RunFilterBar
          filter={state.filter}
          onChange={(filter) => patch({ filter })}
          options={options}
        />
      </DialogSection>

      {state.trigger === "on_terminal" ? (
        <DialogSection title="Sample rate" description="Evaluate only a deterministic slice of matching runs.">
          <FieldRow id="rule-sample" label="Percent of matching runs">
            <div className="flex items-center gap-2">
              <NumberInput
                id="rule-sample"
                value={state.samplePercent}
                min={0}
                max={100}
                step={5}
                clamp
                onValueChange={(value) => patch({ samplePercent: value ?? 100 })}
                className="w-28"
              />
              <Text variant="meta" tone="muted">
                % · 100% = always evaluate
              </Text>
            </div>
          </FieldRow>
          {/* AM-OB10 — the on-terminal analogue of a windowed rule's cooldown. Without it, a broken
              environment producing 50 failing runs produces 50 notifications. */}
          <FieldRow id="rule-min-interval" label="Minimum minutes between alerts">
            <div className="flex items-center gap-2">
              <NumberInput
                id="rule-min-interval"
                value={state.minIntervalMinutes}
                min={0}
                max={WATCH_MIN_INTERVAL_MAX_MINUTES}
                step={5}
                clamp
                onValueChange={(value) => patch({ minIntervalMinutes: value ?? 0 })}
                className="w-28"
              />
              <Text variant="meta" tone="muted">
                min · 0 = alert on every matching run
              </Text>
            </div>
          </FieldRow>
        </DialogSection>
      ) : (
        <WindowConfigSection state={state} onChange={onChange} options={options} />
      )}
    </div>
  );
}

/** AM-OB10 — what an EMPTY window means for this rule, in the operator's words. */
const NO_DATA_POLICY_LABELS: Record<(typeof WATCH_NO_DATA_POLICIES)[number], string> = {
  hold: "Hold — don't fire, don't recover (default)",
  ok: "Treat as OK — count it as below the threshold",
  notify: "Alert me — no runs at all is the problem",
};

function WindowConfigSection({
  state,
  onChange,
  options,
}: {
  state: RuleFormState;
  onChange: (next: RuleFormState) => void;
  /** AM-OB4 — passed through for the `ratio` measure's numerator/denominator filter bars. */
  options: RunFilterOptionData;
}) {
  const window = state.window;
  const patchWindow = (partial: Partial<RuleFormState["window"]>) =>
    onChange({ ...state, window: { ...window, ...partial } });
  // The SAME predicate the API's zod runs, so the inline message and the 400 can never disagree.
  const thresholdCheck = validateWatchThresholds(window);
  const warnError = thresholdCheck.ok ? null : thresholdCheck.message;

  return (
    <DialogSection title="Window threshold" description="measure op threshold, over a trailing window.">
      <div className="grid gap-4 sm:grid-cols-2">
        <FieldRow id="window-measure" label="Measure">
          <Select value={window.measure} onValueChange={(value) => patchWindow({ measure: value as typeof window.measure })}>
            <SelectTrigger id="window-measure">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {RUN_METRICS_MEASURES.map((measure) => (
                <SelectItem key={measure} value={measure}>
                  {measure === "ratio" ? "ratio (a share you define)" : measure}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FieldRow>

        <FieldRow id="window-groupby" label="Group by (optional)">
          <Select
            value={window.groupBy ?? "__none__"}
            onValueChange={(value) =>
              patchWindow({ groupBy: value === "__none__" ? undefined : (value as typeof window.groupBy) })
            }
          >
            <SelectTrigger id="window-groupby">
              <SelectValue placeholder="Overall" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">Overall (no grouping)</SelectItem>
              {RUN_METRICS_GROUP_BY.map((dimension) => (
                <SelectItem key={dimension} value={dimension}>
                  {dimension}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FieldRow>

        <FieldRow id="window-duration" label="Trailing window">
          <Select
            value={window.window}
            onValueChange={(value) => {
              const nextWindow = value as typeof window.window;
              patchWindow({ window: nextWindow, bucket: bucketForWindow(nextWindow) });
            }}
          >
            <SelectTrigger id="window-duration">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {WATCH_WINDOW_DURATIONS.map((duration) => (
                <SelectItem key={duration} value={duration}>
                  {duration}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FieldRow>

        <FieldRow id="window-op" label="Comparison">
          <Select value={window.op} onValueChange={(value) => patchWindow({ op: value as typeof window.op })}>
            <SelectTrigger id="window-op">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {WATCH_WINDOW_OPS.map((op) => (
                <SelectItem key={op} value={op}>
                  {op}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FieldRow>

        <FieldRow id="window-threshold" label="Alert threshold">
          <NumberInput
            id="window-threshold"
            value={window.threshold}
            step={0.01}
            onValueChange={(value) => patchWindow({ threshold: value ?? 0 })}
          />
        </FieldRow>

        {/* AM-OB10 — an OPTIONAL second, less severe threshold. Crossing only this fires one step
            down the existing severity ladder; crossing the alert fires at the configured one. */}
        <FieldRow
          id="window-warn-threshold"
          label="Warning threshold (optional)"
          {...(warnError !== null ? { error: warnError } : {})}
        >
          <div className="flex items-center gap-2">
            <NumberInput
              id="window-warn-threshold"
              value={window.warnThreshold ?? null}
              step={0.01}
              placeholder="None…"
              onValueChange={(value) =>
                patchWindow({ warnThreshold: value === null ? undefined : value })
              }
            />
            <Text variant="meta" tone="muted" className="text-pretty">
              {window.op === ">=" ? "Below the alert threshold" : "Above the alert threshold"} · one
              severity step lower
            </Text>
          </div>
        </FieldRow>

        {/* AM-OB10 — what an EMPTY window means. Before this existed, an empty window was recorded
            as a RECOVERY: a bench that went silent while the rule was firing read as good news. */}
        <FieldRow id="window-no-data" label="When no runs happened">
          <Select
            value={window.noData ?? "hold"}
            onValueChange={(value) =>
              patchWindow({ noData: value as NonNullable<typeof window.noData> })
            }
          >
            <SelectTrigger id="window-no-data">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {WATCH_NO_DATA_POLICIES.map((policy) => (
                <SelectItem key={policy} value={policy}>
                  {NO_DATA_POLICY_LABELS[policy]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FieldRow>

        <FieldRow id="window-cooldown" label="Cooldown (minutes)">
          <NumberInput
            id="window-cooldown"
            value={window.cooldownMinutes}
            min={0}
            max={WATCH_COOLDOWN_MAX_MINUTES}
            step={5}
            clamp
            onValueChange={(value) => patchWindow({ cooldownMinutes: value ?? 0 })}
          />
        </FieldRow>

        {/* AM-OB4 — the label and help now say what this field DOES. It narrows which runs count to
            those this grader graded; it does not choose whose score `meanScore` averages (that is
            always the primary grader). The old "Scope to one grader…" implied the opposite. */}
        <FieldRow id="window-grader" label="Only runs graded by (optional)">
          <div className="flex flex-col gap-1">
            <Input
              id="window-grader"
              value={window.grader ?? ""}
              placeholder="e.g. outcome_judge…"
              spellCheck={false}
              autoComplete="off"
              onChange={(event) => patchWindow({ grader: event.target.value.trim() || undefined })}
            />
            <Text variant="meta" tone="muted" className="text-pretty">
              Narrows which runs count. It does not change whose score meanScore averages — that is
              always the primary grader.
            </Text>
          </div>
        </FieldRow>
      </div>

      {window.measure === "ratio" ? (
        <RatioFields state={state} onChange={onChange} options={options} />
      ) : null}

      <Text variant="meta" tone="muted">
        Metrics bucket: <span className="tabular-nums">{bucketForWindow(window.window)}</span> (derived
        from the trailing window).
      </Text>
    </DialogSection>
  );
}

/**
 * AM-OB4 — the `ratio` measure's two filters inside a windowed rule, on the SAME `RunFilterBar` the
 * rule's own filter uses. Worded as the question the operator is asking, not as arithmetic.
 *
 * The empty-window note is not decoration: a share whose base is empty produces NO point, so the rule
 * reports `no_data` and its no-data policy decides what that means. Before AM-OB10 an empty window
 * was recorded as a recovery, and a rule on a share is exactly where that would bite again.
 */
function RatioFields({
  state,
  onChange,
  options,
}: {
  state: RuleFormState;
  onChange: (next: RuleFormState) => void;
  options: RunFilterOptionData;
}) {
  const ratio = state.window.ratio ?? { numerator: {} };
  const setRatio = (next: NonNullable<RuleFormState["window"]["ratio"]>) =>
    onChange({ ...state, window: { ...state.window, ratio: next } });
  const hasDenominator = ratio.denominator !== undefined;
  const numeratorEmpty = Object.keys(ratio.numerator).length === 0;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label id="window-ratio-numerator-label">Count the runs that match…</Label>
        <div aria-labelledby="window-ratio-numerator-label">
          <RunFilterBar
            filter={ratio.numerator}
            onChange={(numerator) => setRatio({ ...ratio, numerator })}
            options={options}
          />
        </div>
        {numeratorEmpty ? (
          <Text variant="meta" tone="muted">
            Add at least one condition — an empty numerator matches every run, so the share would
            always be 100%.
          </Text>
        ) : null}
      </div>

      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor="window-ratio-denominator">…out of a narrower base</Label>
          <Switch
            id="window-ratio-denominator"
            checked={hasDenominator}
            onCheckedChange={(checked) => {
              if (checked) setRatio({ ...ratio, denominator: {} });
              else setRatio({ numerator: ratio.numerator });
            }}
          />
        </div>
        {hasDenominator ? (
          <div aria-labelledby="window-ratio-denominator-label">
            <span id="window-ratio-denominator-label" className="sr-only">
              Base filter for the share
            </span>
            <RunFilterBar
              filter={ratio.denominator ?? {}}
              onChange={(denominator) => setRatio({ ...ratio, denominator })}
              options={options}
            />
          </div>
        ) : (
          <Text variant="meta" tone="muted">
            Off — the base is this rule's own filter above.
          </Text>
        )}
      </div>

      <Text variant="meta" tone="muted" className="text-pretty">
        A window whose base is empty produces no value at all, so the rule reports “no runs” and your
        no-data setting above decides what happens — it is never treated as a healthy 0%.
      </Text>
    </div>
  );
}

function ActionsSection({
  actions,
  collections,
  githubAccount,
  githubChecked,
  formError,
  issues,
  onChange,
}: {
  actions: ActionFormState;
  collections: Collection[];
  githubAccount: GithubAccountStatus | null;
  githubChecked: boolean;
  formError: string | null;
  issues: { path: (string | number)[]; message: string }[] | null;
  onChange: (next: ActionFormState) => void;
}) {
  const patch = <K extends keyof ActionFormState>(key: K, value: ActionFormState[K]) =>
    onChange({ ...actions, [key]: value });

  // AM-OB11 — why the workflow-dispatch slot is unavailable, if it is. The two states are kept
  // apart deliberately: telling an operator they have no GitHub account while the lookup is still
  // in flight would be a lie they might act on.
  const githubReason = githubAccount?.connected
    ? null
    : githubChecked
      ? "No GitHub account is connected. Connect one in Settings → GitHub account, then reopen this rule."
      : "Checking your connected GitHub account…";

  return (
    <div className="flex flex-col gap-4">
      <FormErrorAlert formError={formError} issues={issues} />
      <ActionRow
        id="action-notify"
        title="Notify"
        description="Post to the in-app notification center."
        enabled={actions.notify.enabled}
        onEnabledChange={(enabled) => patch("notify", { ...actions.notify, enabled })}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <FieldRow id="notify-severity" label="Severity">
            <Select
              value={actions.notify.severity}
              onValueChange={(value) =>
                patch("notify", { ...actions.notify, severity: value as ActionFormState["notify"]["severity"] })
              }
            >
              <SelectTrigger id="notify-severity">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {WATCH_NOTIFY_SEVERITIES.map((severity) => (
                  <SelectItem key={severity} value={severity}>
                    {severity}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FieldRow>
          <FieldRow id="notify-template" label="Template (optional)" wide>
            <Textarea
              id="notify-template"
              value={actions.notify.template}
              placeholder="Custom message…"
              spellCheck={false}
              rows={2}
              onChange={(event) => patch("notify", { ...actions.notify, template: event.target.value })}
            />
          </FieldRow>
        </div>
      </ActionRow>

      <ActionRow
        id="action-pin"
        title="Pin run"
        description="Exempt the run from retention pruning."
        enabled={actions.pin.enabled}
        onEnabledChange={(enabled) => patch("pin", { enabled })}
      />

      <ActionRow
        id="action-add-to-collection"
        title="Add to collection"
        description="Assign the run's test to a collection."
        enabled={actions.add_to_collection.enabled}
        onEnabledChange={(enabled) => patch("add_to_collection", { ...actions.add_to_collection, enabled })}
      >
        <CollectionPicker
          id="add-to-collection-picker"
          value={actions.add_to_collection.collectionId}
          collections={collections}
          onChange={(collectionId) => patch("add_to_collection", { ...actions.add_to_collection, collectionId })}
        />
      </ActionRow>

      <ActionRow
        id="action-promote-to-test"
        title="Promote to test"
        description="Create a draft test from the run (never auto-runs)."
        enabled={actions.promote_to_test.enabled}
        onEnabledChange={(enabled) => patch("promote_to_test", { ...actions.promote_to_test, enabled })}
      >
        <CollectionPicker
          id="promote-to-test-picker"
          value={actions.promote_to_test.collectionId}
          collections={collections}
          onChange={(collectionId) => patch("promote_to_test", { ...actions.promote_to_test, collectionId })}
        />
      </ActionRow>

      <ActionRow
        id="action-run-grader"
        title="Run grader"
        description="Append an extra grade to the run (never mutates existing grades)."
        enabled={actions.run_grader.enabled}
        onEnabledChange={(enabled) => patch("run_grader", { ...actions.run_grader, enabled })}
      >
        <FieldRow id="run-grader-id" label="Grader id">
          <Input
            id="run-grader-id"
            value={actions.run_grader.graderId}
            placeholder="e.g. answer_validation…"
            spellCheck={false}
            autoComplete="off"
            list="grader-id-options"
            onChange={(event) => patch("run_grader", { ...actions.run_grader, graderId: event.target.value })}
          />
          {/* brand-ui-allow: a native datalist pairs with the Input above for autocomplete —
              no brand-ui equivalent exists, and a custom grader id (not in the roster) is a
              documented, valid value (packages/shared GraderId doc: "a custom id is allowed"). */}
          <datalist id="grader-id-options">
            {GRADER_IDS.map((id) => (
              <option key={id} value={id} />
            ))}
          </datalist>
        </FieldRow>
      </ActionRow>

      <ActionRow
        id="action-webhook"
        title="Webhook"
        description="POST a JSON payload to an external URL."
        enabled={actions.webhook.enabled}
        onEnabledChange={(enabled) => patch("webhook", { ...actions.webhook, enabled })}
      >
        <div className="flex flex-col gap-3">
          {actions.webhook.hasSavedSecret ? (
            <Alert variant="info">
              <AlertDescription>
                A webhook URL is already saved for this rule (never shown again — write-only). Leave
                the field below blank to keep editing other sections without touching it; enter a new
                URL only to replace it.
              </AlertDescription>
            </Alert>
          ) : null}
          <FieldRow id="webhook-url" label="URL">
            <Input
              id="webhook-url"
              type="url"
              inputMode="url"
              value={actions.webhook.url}
              placeholder="https://hooks.example.com/…"
              spellCheck={false}
              autoComplete="off"
              onChange={(event) => patch("webhook", { ...actions.webhook, url: event.target.value })}
            />
          </FieldRow>
          <FieldRow id="webhook-template" label="Template (optional)">
            <Textarea
              id="webhook-template"
              value={actions.webhook.template}
              placeholder="Custom JSON template…"
              spellCheck={false}
              rows={2}
              onChange={(event) => patch("webhook", { ...actions.webhook, template: event.target.value })}
            />
          </FieldRow>
        </div>
      </ActionRow>

      <ActionRow
        id="action-workflow-dispatch"
        title="Run a GitHub Actions workflow"
        // The one action on this list that STARTS WORK and SPENDS MONEY outside this app. Say so
        // here, where the operator ticks the box — not in a footnote.
        description="Starts a CI run on GitHub and spends Actions minutes. Uses your connected GitHub account; no credential is stored on the rule."
        enabled={actions.workflow_dispatch.enabled}
        disabled={githubReason !== null}
        disabledReason={githubReason}
        onEnabledChange={(enabled) =>
          patch("workflow_dispatch", { ...actions.workflow_dispatch, enabled })
        }
      >
        <div className="flex flex-col gap-3">
          <Alert variant="info">
            <AlertDescription>
              Dispatched as{" "}
              <span className="font-medium">{githubAccount?.login ?? "your connected account"}</span>
              . The workflow must already declare a{" "}
              <code className="font-mono">workflow_dispatch</code> trigger, and GitHub
              rejects any input it does not declare — so only the inputs below are sent.
            </AlertDescription>
          </Alert>
          <div className="grid gap-3 sm:grid-cols-2">
            <FieldRow id="workflow-owner" label="Owner">
              <Input
                id="workflow-owner"
                value={actions.workflow_dispatch.owner}
                placeholder="acme-labs…"
                spellCheck={false}
                autoComplete="off"
                onChange={(event) =>
                  patch("workflow_dispatch", {
                    ...actions.workflow_dispatch,
                    owner: event.target.value,
                  })
                }
              />
            </FieldRow>
            <FieldRow id="workflow-repo" label="Repository">
              <Input
                id="workflow-repo"
                value={actions.workflow_dispatch.repo}
                placeholder="workbench…"
                spellCheck={false}
                autoComplete="off"
                onChange={(event) =>
                  patch("workflow_dispatch", {
                    ...actions.workflow_dispatch,
                    repo: event.target.value,
                  })
                }
              />
            </FieldRow>
            <FieldRow id="workflow-file" label="Workflow file or id">
              <Input
                id="workflow-file"
                value={actions.workflow_dispatch.workflow}
                placeholder="nightly.yml…"
                spellCheck={false}
                autoComplete="off"
                onChange={(event) =>
                  patch("workflow_dispatch", {
                    ...actions.workflow_dispatch,
                    workflow: event.target.value,
                  })
                }
              />
            </FieldRow>
            <FieldRow id="workflow-ref" label="Ref (branch or tag)">
              <Input
                id="workflow-ref"
                value={actions.workflow_dispatch.ref}
                placeholder="main…"
                spellCheck={false}
                autoComplete="off"
                onChange={(event) =>
                  patch("workflow_dispatch", { ...actions.workflow_dispatch, ref: event.target.value })
                }
              />
            </FieldRow>
          </div>
          <FieldRow id="workflow-inputs" label="Workflow inputs (optional)" wide>
            <KeyValueEditor
              aria-label="Workflow inputs"
              value={actions.workflow_dispatch.inputs}
              keyPlaceholder="input_name"
              valuePlaceholder="value…"
              addLabel="Add input"
              onChange={(inputs) =>
                patch("workflow_dispatch", { ...actions.workflow_dispatch, inputs })
              }
            />
          </FieldRow>
        </div>
      </ActionRow>
    </div>
  );
}

/**
 * One action slot. AM-OB11 adds an optional UNAVAILABLE state: when `disabled` with a
 * `disabledReason`, the checkbox is disabled, the reason is shown BOTH in a hover/focus tooltip and
 * as visible text, and it is wired to the checkbox's `aria-describedby` — so it reaches assistive
 * tech even while the tooltip is closed. This mirrors `IconButton`'s D-TB5 discipline (one reason,
 * reachable without a mouse); the Radix trigger is a wrapper `<span>` rather than the disabled
 * control, because a disabled control swallows hover.
 */
function ActionRow({
  id,
  title,
  description,
  enabled,
  disabled = false,
  disabledReason = null,
  onEnabledChange,
  children,
}: {
  id: string;
  title: string;
  description: string;
  enabled: boolean;
  disabled?: boolean;
  disabledReason?: string | null;
  onEnabledChange: (enabled: boolean) => void;
  children?: ReactNode;
}) {
  const reasonId = `${id}-reason`;
  const showReason = disabled && disabledReason !== null;

  const control = (
    <Checkbox
      id={id}
      checked={enabled && !disabled}
      disabled={disabled}
      aria-label={title}
      aria-describedby={showReason ? reasonId : undefined}
      onCheckedChange={(checked) => onEnabledChange(checked === true)}
    />
  );

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border p-3">
      <label htmlFor={id} className={cn("flex items-start gap-2.5", !disabled && "cursor-pointer")}>
        {showReason ? (
          <Tooltip>
            <TooltipTrigger asChild>
              {/* The wrapper is the actual Radix trigger: a disabled Checkbox carries
                  pointer-events-none, so hover falls through to the span. Unlike `IconButton` — whose
                  reason is `sr-only` and therefore needs a focusable wrapper — this reason is VISIBLE
                  below and wired to the control's `aria-describedby`, so the span deliberately adds
                  NO tab stop. The tooltip is the mouse convenience; the visible text is the truth. */}
              <span className="inline-flex">{control}</span>
            </TooltipTrigger>
            <TooltipContent>{disabledReason}</TooltipContent>
          </Tooltip>
        ) : (
          control
        )}
        <span className="flex flex-col gap-0.5">
          <Text className="font-medium">{title}</Text>
          <Text variant="meta" tone="muted">
            {description}
          </Text>
        </span>
      </label>
      {showReason ? (
        // Visible as well as tooltip-only: the reason is the difference between "this app is broken"
        // and "you have one thing to go and do", so it must not depend on hovering.
        <Alert variant="warning">
          <AlertDescription id={reasonId}>{disabledReason}</AlertDescription>
        </Alert>
      ) : null}
      {enabled && !disabled && children ? <div className="ps-6">{children}</div> : null}
    </div>
  );
}

function CollectionPicker({
  id,
  value,
  collections,
  onChange,
}: {
  id: string;
  value: string;
  collections: Collection[];
  onChange: (collectionId: string) => void;
}) {
  return (
    <FieldRow id={id} label="Collection">
      <Select value={value || undefined} onValueChange={onChange}>
        <SelectTrigger id={id}>
          <SelectValue placeholder="Select a collection…" />
        </SelectTrigger>
        <SelectContent>
          {collections.map((collection) => (
            <SelectItem key={collection.id} value={collection.id}>
              {collection.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </FieldRow>
  );
}
