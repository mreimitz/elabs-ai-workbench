import { useEffect, useMemo, useState } from "react";
import type {
  Collection,
  Scenario,
  Skill,
  SkillVersion,
  Suite,
  SuiteInput,
  SuiteVariant,
  Test,
} from "@mcp-token-footprint/shared";
import {
  SUITE_DEFAULT_CONCURRENCY,
  SUITE_DEFAULT_REPETITIONS,
  SUITE_MAX_CONCURRENCY,
  SUITE_MAX_REPETITIONS,
  suiteInputSchema,
} from "@mcp-token-footprint/shared";

/**
 * Error Prevention (P1) — every NEW suite used to default to `aggregateCostCapUsd: undefined` ("no
 * cap"), so an operator who never visits this field ships an uncapped mass-run. Seed a modest guard
 * instead; clearing the field still opts back out to "no cap" explicitly. An EXISTING suite's cap is
 * never touched by this default — editing preserves whatever it already has, including a deliberate
 * "no cap".
 */
const SUITE_DEFAULT_COST_CAP_USD = 5;
import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Input,
  Label,
  NumberInput,
  Text,
  Textarea,
} from "@brand/ui";
import {
  ArrowDown,
  ArrowUp,
  GitCompareArrows,
  ListChecks,
  Plus,
  Save,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { SelectField } from "../../../components/SelectField";
import { FieldRow } from "../../../components/FieldRow";
import { IconButton } from "../../../components/IconButton";
import { getErrorMessage } from "../../../lib/errors";
import { AddSkillModal } from "../AddSkillModal";

/**
 * Create / edit a suite — a Dialog over `@brand/ui` parts (contract-validated with `suiteInputSchema`).
 * A suite is an ORDERED set of tests × a scenario set × an execution config; the run matrix is their
 * cross product × repetitions. The test picker is order-sensitive (reordered with up/down `Button`s —
 * NO drag-and-drop dependency), scenarios are a Checkbox multi-select, and the config is bounded
 * `NumberInput`s. Submit stays enabled until the request starts, then validates + surfaces inline
 * errors and focuses the first offending field (interaction-guidelines).
 */
export type SuiteEditorProps = {
  open: boolean;
  /** The suite being edited, or `null` to create a new one. */
  suite: Suite | null;
  tests: Test[];
  scenarios: Scenario[];
  /** Registered skills + their versions (WP 5.1) — power the variant skill attach/detach pickers. */
  skills?: Skill[];
  skillVersions?: Map<string, SkillVersion[]>;
  onOpenChange: (open: boolean) => void;
  onSubmit: (input: SuiteInput) => Promise<void>;
  /**
   * Benchmarks (WP 4.3) — collections to (re)assign this suite to. When provided the editor shows a
   * collection picker; assignment is an immediate write (only for an already-saved suite), calling
   * `onSetCollection` with the suite id, the chosen collection (or null to detach) and the
   * previously-applied collection (needed to key the detach route).
   */
  collections?: Collection[];
  onSetCollection?: (
    suiteId: string,
    toCollectionId: string | null,
    fromCollectionId: string | null,
  ) => Promise<void>;
};

type FieldErrors = Partial<
  Record<"name" | "testIds" | "scenarioIds" | "config" | "variants", string>
>;

const FIELD_FOCUS: { key: keyof FieldErrors; id: string }[] = [
  { key: "name", id: "suite-name" },
  { key: "testIds", id: "suite-add-test" },
  { key: "scenarioIds", id: "suite-scenarios" },
];

export function SuiteEditor({
  open,
  suite,
  tests,
  scenarios,
  skills = [],
  skillVersions = new Map(),
  onOpenChange,
  onSubmit,
  collections,
  onSetCollection,
}: SuiteEditorProps) {
  const editing = suite !== null;
  const NO_COLLECTION = "none";

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [testIds, setTestIds] = useState<string[]>([]);
  const [scenarioIds, setScenarioIds] = useState<string[]>([]);
  const [repetitions, setRepetitions] = useState<number>(SUITE_DEFAULT_REPETITIONS);
  const [maxConcurrency, setMaxConcurrency] = useState<number>(SUITE_DEFAULT_CONCURRENCY);
  const [costCap, setCostCap] = useState<number | null>(null);
  // WP 5.1 — skill-effect variants: base vs ± skill/version, compared on the SAME run. When non-empty
  // the matrix runs each test under each VARIANT (its own scenario + skill override) instead of the
  // scenario set. `addSkillFor` is the variant index whose attach modal is open (or null).
  const [variants, setVariants] = useState<SuiteVariant[]>([]);
  const [addSkillFor, setAddSkillFor] = useState<number | null>(null);
  const [collectionChoice, setCollectionChoice] = useState<string>(NO_COLLECTION);
  // The last collection this suite was assigned to in-session (the API's Suite payload doesn't carry
  // `collectionId`, so we track the applied value ourselves to key a detach).
  const [appliedCollection, setAppliedCollection] = useState<string | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Seed the form from the suite (edit) or defaults (create) whenever the dialog (re)opens.
  useEffect(() => {
    if (!open) return;
    setName(suite?.name ?? "");
    setDescription(suite?.description ?? "");
    setTestIds(suite?.testIds ?? []);
    setScenarioIds(suite?.scenarioIds ?? []);
    setRepetitions(suite?.config.repetitions ?? SUITE_DEFAULT_REPETITIONS);
    setMaxConcurrency(suite?.config.maxConcurrency ?? SUITE_DEFAULT_CONCURRENCY);
    // A NEW suite (no `suite`) seeds a modest default cap rather than "no cap"; an EXISTING suite's
    // own cap — even an explicit "no cap" — is left exactly as it was.
    setCostCap(suite ? (suite.config.aggregateCostCapUsd ?? null) : SUITE_DEFAULT_COST_CAP_USD);
    setVariants(suite?.config.variants ?? []);
    setAddSkillFor(null);
    const seeded = suite?.collectionId ?? null;
    setCollectionChoice(seeded ?? NO_COLLECTION);
    setAppliedCollection(seeded);
    setErrors({});
    setFormError(null);
    setSaving(false);
  }, [open, suite]);

  // Immediate-write collection (re)assignment — only actionable for an already-saved suite (the
  // membership API keys off a persisted id). Create a suite first, then assign it.
  async function changeCollection(choice: string) {
    setCollectionChoice(choice);
    if (!suite || !onSetCollection) return;
    const to = choice === NO_COLLECTION ? null : choice;
    const from = appliedCollection;
    if (to === from) return;
    try {
      await onSetCollection(suite.id, to, from);
      setAppliedCollection(to);
    } catch {
      setCollectionChoice(appliedCollection ?? NO_COLLECTION);
    }
  }

  const testById = useMemo(() => new Map(tests.map((t) => [t.id, t])), [tests]);
  const unselectedTests = useMemo(
    () => tests.filter((t) => !testIds.includes(t.id)),
    [tests, testIds],
  );

  function moveTest(index: number, delta: number) {
    setTestIds((prev) => {
      const next = [...prev];
      const target = index + delta;
      if (target < 0 || target >= next.length) return prev;
      const [moved] = next.splice(index, 1);
      if (moved !== undefined) next.splice(target, 0, moved);
      return next;
    });
  }

  function addTest(id: string) {
    if (!id) return;
    setTestIds((prev) => (prev.includes(id) ? prev : [...prev, id]));
  }

  function removeTest(id: string) {
    setTestIds((prev) => prev.filter((t) => t !== id));
  }

  function toggleScenario(id: string) {
    setScenarioIds((prev) => (prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]));
  }

  // ── WP 5.1 variant helpers (immutable updates by index) ──────────────────────────────────────────
  function patchVariant(index: number, patch: Partial<SuiteVariant>) {
    setVariants((prev) =>
      prev.map((variant, i) => (i === index ? { ...variant, ...patch } : variant)),
    );
  }

  function addVariant() {
    // A fresh variant defaults to the first scenario + empty overrides (a "base"), with a unique label.
    const label = variants.length === 0 ? "base" : `variant ${variants.length}`;
    setVariants((prev) => [
      ...prev,
      { label, scenarioId: scenarios[0]?.id ?? "", skillOverrides: {} },
    ]);
  }

  function removeVariant(index: number) {
    setVariants((prev) => prev.filter((_, i) => i !== index));
  }

  // Convert an AllowedSkill (from the reused AddSkillModal) to a variant attach entry + append it. The
  // variant attach shape is `{skillId, versionId}` (`latest` or a pinned id); the modal's eager flag is
  // not part of a variant override, so it is dropped here.
  function addAttach(index: number, skillId: string, versionId: string) {
    setVariants((prev) =>
      prev.map((variant, i) => {
        if (i !== index) return variant;
        const attach = [
          ...(variant.skillOverrides.attach ?? []).filter((a) => a.skillId !== skillId),
          { skillId, versionId },
        ];
        const detach = (variant.skillOverrides.detach ?? []).filter((id) => id !== skillId);
        return {
          ...variant,
          skillOverrides: {
            ...variant.skillOverrides,
            attach,
            ...(detach.length ? { detach } : { detach: undefined }),
          },
        };
      }),
    );
  }

  function removeAttach(index: number, skillId: string) {
    setVariants((prev) =>
      prev.map((variant, i) => {
        if (i !== index) return variant;
        const attach = (variant.skillOverrides.attach ?? []).filter((a) => a.skillId !== skillId);
        return {
          ...variant,
          skillOverrides: { ...variant.skillOverrides, attach: attach.length ? attach : undefined },
        };
      }),
    );
  }

  function addDetach(index: number, skillId: string) {
    if (!skillId) return;
    setVariants((prev) =>
      prev.map((variant, i) => {
        if (i !== index) return variant;
        const detach = [...new Set([...(variant.skillOverrides.detach ?? []), skillId])];
        const attach = (variant.skillOverrides.attach ?? []).filter((a) => a.skillId !== skillId);
        return {
          ...variant,
          skillOverrides: { attach: attach.length ? attach : undefined, detach },
        };
      }),
    );
  }

  function removeDetach(index: number, skillId: string) {
    setVariants((prev) =>
      prev.map((variant, i) => {
        if (i !== index) return variant;
        const detach = (variant.skillOverrides.detach ?? []).filter((id) => id !== skillId);
        return {
          ...variant,
          skillOverrides: { ...variant.skillOverrides, detach: detach.length ? detach : undefined },
        };
      }),
    );
  }

  async function submit() {
    // Normalize variants: drop empty override arrays so the payload matches the wire shape cleanly.
    const cleanVariants: SuiteVariant[] = variants.map((variant) => {
      const attach = variant.skillOverrides.attach ?? [];
      const detach = variant.skillOverrides.detach ?? [];
      return {
        label: variant.label.trim(),
        scenarioId: variant.scenarioId,
        skillOverrides: {
          ...(attach.length ? { attach } : {}),
          ...(detach.length ? { detach } : {}),
        },
      };
    });
    const useVariants = cleanVariants.length > 0;

    const input = {
      name: name.trim(),
      ...(description.trim() ? { description: description.trim() } : {}),
      config: {
        repetitions,
        maxConcurrency,
        ...(costCap !== null && costCap > 0 ? { aggregateCostCapUsd: costCap } : {}),
        ...(useVariants ? { variants: cleanVariants } : {}),
      },
      testIds,
      scenarioIds,
    };

    // Contract validation + our own "runnable suite" guard (the schema allows empty arrays, but an
    // empty matrix can't run — surface it inline rather than saving a dud).
    const parsed = suiteInputSchema.safeParse(input);
    const next: FieldErrors = {};
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const head = String(issue.path[0] ?? "form");
        const key: keyof FieldErrors =
          head === "config" || head === "variants" ? "variants" : (head as keyof FieldErrors);
        if (!next[key]) next[key] = issue.message;
      }
    }
    if (testIds.length === 0) next.testIds = "Add at least one test.";
    // The variant axis REPLACES the scenario axis: require scenarios ONLY when there are no variants.
    if (!useVariants && scenarioIds.length === 0)
      next.scenarioIds = "Select at least one environment.";
    if (useVariants) {
      if (cleanVariants.some((variant) => variant.label === ""))
        next.variants = "Give every variant a label.";
      else if (cleanVariants.some((variant) => !variant.scenarioId))
        next.variants = "Pick an environment for every variant.";
      else if (new Set(cleanVariants.map((v) => v.label)).size !== cleanVariants.length)
        next.variants = "Variant labels must be unique.";
    }

    if (Object.keys(next).length > 0 || !parsed.success) {
      setErrors(next);
      setFormError("Fix the highlighted fields and try again.");
      const firstInvalid = FIELD_FOCUS.find((field) => next[field.key]);
      if (firstInvalid) document.getElementById(firstInvalid.id)?.focus();
      return;
    }

    setErrors({});
    setFormError(null);
    setSaving(true);
    try {
      await onSubmit(parsed.data);
      onOpenChange(false);
    } catch (error) {
      setFormError(`Couldn’t save the suite. ${getErrorMessage(error)} Try again.`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        size="xl"
        className="flex max-h-[90vh] flex-col gap-0 p-0"
        onOpenAutoFocus={(event) => {
          // Edit-suite name-selection (P1) — Radix's default dialog open-focus SELECTS the first
          // tabbable field's entire value (`FocusScope`'s `focus(el, { select: true })`). Harmless for
          // an empty "create" name, but for Edit suite it fully-selects the EXISTING name, so the very
          // first keystroke replaces it. Focus the name field without selecting its text instead.
          event.preventDefault();
          document.getElementById("suite-name")?.focus();
        }}
      >
        <DialogHeader className="flex-none gap-1 border-b border-border p-4 pe-12">
          <DialogTitle>{editing ? "Edit suite" : "New suite"}</DialogTitle>
          <DialogDescription>
            A suite runs its ordered tests against every selected environment, repeated per the
            config — a test × environment × repetition matrix.
          </DialogDescription>
        </DialogHeader>

        {formError ? (
          <div className="flex-none border-b border-border px-4 py-3">
            <Alert variant="destructive">
              <AlertDescription>{formError}</AlertDescription>
            </Alert>
          </div>
        ) : null}

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <div className="flex flex-col gap-5">
            {/* Identity */}
            <FieldRow id="suite-name" label="Name" error={errors.name}>
              <Input
                id="suite-name"
                name="suite-name"
                value={name}
                placeholder="Regression suite…"
                autoComplete="off"
                spellCheck={false}
                aria-invalid={errors.name ? true : undefined}
                onChange={(event) => setName(event.target.value)}
              />
            </FieldRow>

            <FieldRow id="suite-description" label="Description">
              <Textarea
                id="suite-description"
                name="suite-description"
                value={description}
                placeholder="What this suite covers…"
                rows={2}
                onChange={(event) => setDescription(event.target.value)}
              />
            </FieldRow>

            {/* Benchmarks (WP 4.3) — collection membership. Immediate write, so only actionable once
                the suite is saved; a synced collection materializes it to git. */}
            {collections ? (
              <div className="flex flex-col gap-1.5">
                <SelectField
                  id="suite-collection"
                  label="Collection"
                  value={collectionChoice}
                  disabled={!editing}
                  options={[
                    { value: "none", label: "Local only" },
                    ...collections.map((c) => ({ value: c.id, label: c.name })),
                  ]}
                  onChange={(value) => void changeCollection(value)}
                />
                <Text variant="meta" tone="muted">
                  {editing
                    ? "Assign this suite to a git-backed collection — its members sync to the repo."
                    : "Create the suite first, then assign it to a collection."}
                </Text>
              </div>
            ) : null}

            {/* Execution config */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="suite-repetitions">Repetitions</Label>
                <NumberInput
                  id="suite-repetitions"
                  value={repetitions}
                  min={1}
                  max={SUITE_MAX_REPETITIONS}
                  onValueChange={(value) => setRepetitions(value ?? SUITE_DEFAULT_REPETITIONS)}
                />
                <Text variant="meta" tone="muted">
                  1–{SUITE_MAX_REPETITIONS} runs per cell
                </Text>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="suite-concurrency">Max concurrency</Label>
                <NumberInput
                  id="suite-concurrency"
                  value={maxConcurrency}
                  min={1}
                  max={SUITE_MAX_CONCURRENCY}
                  onValueChange={(value) => setMaxConcurrency(value ?? SUITE_DEFAULT_CONCURRENCY)}
                />
                <Text variant="meta" tone="muted">
                  1–{SUITE_MAX_CONCURRENCY} parallel cells
                </Text>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="suite-cost-cap">Cost cap (USD)</Label>
                <NumberInput
                  id="suite-cost-cap"
                  value={costCap}
                  min={0}
                  step={0.5}
                  placeholder="No cap"
                  onValueChange={(value) => setCostCap(value)}
                />
                <Text variant="meta" tone="muted">
                  Soft-stop once spend ≥ cap. Clear the field to run uncapped.
                </Text>
              </div>
            </div>

            {/* Ordered test picker */}
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between gap-2">
                <Text className="font-medium">Tests (ordered)</Text>
                <Text variant="meta" tone="muted" className="tabular-nums">
                  {testIds.length} selected
                </Text>
              </div>
              {tests.length === 0 ? (
                <Text variant="meta" tone="muted">
                  No tests exist yet — create one in the Tests view first.
                </Text>
              ) : (
                <SelectField
                  id="suite-add-test"
                  label="Add a test"
                  value=""
                  placeholder="Add a test…"
                  disabled={unselectedTests.length === 0}
                  options={unselectedTests.map((t) => ({ value: t.id, label: t.name }))}
                  onChange={addTest}
                />
              )}
              {testIds.length > 0 ? (
                <ul className="flex flex-col gap-1.5">
                  {testIds.map((id, index) => (
                    <li
                      key={id}
                      className="flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2"
                    >
                      <Badge variant="outline" className="shrink-0 tabular-nums">
                        {index + 1}
                      </Badge>
                      <span className="min-w-0 flex-1 truncate">
                        {testById.get(id)?.name ?? `#${id.slice(0, 6)}`}
                      </span>
                      <IconButton
                        variant="ghost"
                        size="sm"
                        label={`Move ${testById.get(id)?.name ?? "test"} up`}
                        disabled={index === 0}
                        disabledReason="Already first"
                        onClick={() => moveTest(index, -1)}
                      >
                        <ArrowUp aria-hidden />
                      </IconButton>
                      <IconButton
                        variant="ghost"
                        size="sm"
                        label={`Move ${testById.get(id)?.name ?? "test"} down`}
                        disabled={index === testIds.length - 1}
                        disabledReason="Already last"
                        onClick={() => moveTest(index, 1)}
                      >
                        <ArrowDown aria-hidden />
                      </IconButton>
                      <IconButton
                        variant="ghost"
                        size="sm"
                        label={`Remove ${testById.get(id)?.name ?? "test"}`}
                        onClick={() => removeTest(id)}
                      >
                        <Trash2 aria-hidden />
                      </IconButton>
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyState
                  icon={<ListChecks aria-hidden />}
                  title="No tests added"
                  description="Add tests above; they run in this order."
                />
              )}
              {errors.testIds ? (
                <Text variant="meta" className="text-destructive" role="alert">
                  {errors.testIds}
                </Text>
              ) : null}
            </div>

            {/* Environment multi-select */}
            <div
              className="flex flex-col gap-2 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              id="suite-scenarios"
              tabIndex={-1}
            >
              <div className="flex items-center justify-between gap-2">
                <Text className="font-medium">Environments</Text>
                <Text variant="meta" tone="muted" className="tabular-nums">
                  {scenarioIds.length} selected
                </Text>
              </div>
              {variants.length > 0 ? (
                <Text variant="meta" tone="muted">
                  Ignored while variants are defined — the variant axis below replaces the
                  environment axis (each variant names its own environment).
                </Text>
              ) : null}
              {scenarios.length === 0 ? (
                <Text variant="meta" tone="muted">
                  No environments exist yet — create one in the Environments view first.
                </Text>
              ) : (
                <ul className="flex flex-col gap-1.5">
                  {scenarios.map((scenario) => (
                    <li key={scenario.id}>
                      <label className="flex min-w-0 cursor-pointer items-center gap-2 rounded-md border border-border px-3 py-2">
                        <Checkbox
                          checked={scenarioIds.includes(scenario.id)}
                          onCheckedChange={() => toggleScenario(scenario.id)}
                          aria-label={`Include ${scenario.name}`}
                        />
                        <Text as="span" className="min-w-0 flex-1 truncate">
                          {scenario.name}
                        </Text>
                        <Badge variant="secondary" className="shrink-0 font-mono text-meta">
                          {scenario.model}
                        </Badge>
                      </label>
                    </li>
                  ))}
                </ul>
              )}
              {errors.scenarioIds ? (
                <Text variant="meta" className="text-destructive" role="alert">
                  {errors.scenarioIds}
                </Text>
              ) : null}
            </div>

            {/* Variants — the WP 5.1 skill-effect axis. Define base vs ± skill/version to compare on the
                SAME run; each variant runs every test on its own scenario with its skill override. */}
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between gap-2">
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span className="flex items-center gap-2">
                    <GitCompareArrows
                      aria-hidden
                      className="size-4 shrink-0 text-muted-foreground"
                    />
                    <Text className="font-medium">Variants (skill effect)</Text>
                  </span>
                  <Text variant="meta" tone="muted" className="text-pretty">
                    Optional. Add two or more (e.g. base vs +skill) to answer “does attaching this
                    skill make it better or cheaper?” on one run. Each variant runs every test on
                    its environment.
                  </Text>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="shrink-0"
                  onClick={addVariant}
                  disabled={scenarios.length === 0}
                >
                  <Plus aria-hidden />
                  <span>Add variant</span>
                </Button>
              </div>

              {variants.length === 0 ? (
                <EmptyState
                  icon={<GitCompareArrows aria-hidden />}
                  title="No variants"
                  description="Runs the plain test × environment matrix. Add variants to run a ± skill A/B on the same suite."
                />
              ) : (
                <ul className="flex flex-col gap-2">
                  {variants.map((variant, index) => (
                    <li key={index}>
                      <VariantCard
                        variant={variant}
                        index={index}
                        scenarios={scenarios}
                        skills={skills}
                        skillVersions={skillVersions}
                        onPatch={(patch) => patchVariant(index, patch)}
                        onRemove={() => removeVariant(index)}
                        onAddSkill={() => setAddSkillFor(index)}
                        onRemoveAttach={(skillId) => removeAttach(index, skillId)}
                        onAddDetach={(skillId) => addDetach(index, skillId)}
                        onRemoveDetach={(skillId) => removeDetach(index, skillId)}
                      />
                    </li>
                  ))}
                </ul>
              )}
              {errors.variants ? (
                <Text variant="meta" className="text-destructive" role="alert">
                  {errors.variants}
                </Text>
              ) : null}
            </div>
          </div>
        </div>

        {/* Reuse the scenario skill-attachment flow: pick a skill + version, convert to a variant attach. */}
        {addSkillFor !== null ? (
          <AddSkillModal
            open
            onOpenChange={(open) => !open && setAddSkillFor(null)}
            skills={skills}
            skillVersions={skillVersions}
            existing={(variants[addSkillFor]?.skillOverrides.attach ?? []).map((a) => ({
              skillId: a.skillId,
              versionMode: "latest",
            }))}
            onAdd={(entry) => {
              const versionId =
                entry.versionMode === "pinned" ? (entry.pinnedVersionId ?? "latest") : "latest";
              addAttach(addSkillFor, entry.skillId, versionId);
              setAddSkillFor(null);
            }}
          />
        ) : null}

        <DialogFooter className="flex-none border-t border-border p-4">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={saving}>
            <Save aria-hidden />
            <span>{saving ? "Saving…" : editing ? "Save suite" : "Create suite"}</span>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * One skill-effect variant (WP 5.1): a label + scenario + its ± skill override. The attach picker reuses
 * the scenario `AddSkillModal` (converted to `{skillId, versionId}`); detach is a simple skill Select.
 * `className` is layout only; every control is a `@brand/*` component.
 */
function VariantCard({
  variant,
  index,
  scenarios,
  skills,
  skillVersions,
  onPatch,
  onRemove,
  onAddSkill,
  onRemoveAttach,
  onAddDetach,
  onRemoveDetach,
}: {
  variant: SuiteVariant;
  index: number;
  scenarios: Scenario[];
  skills: Skill[];
  skillVersions: Map<string, SkillVersion[]>;
  onPatch: (patch: Partial<SuiteVariant>) => void;
  onRemove: () => void;
  onAddSkill: () => void;
  onRemoveAttach: (skillId: string) => void;
  onAddDetach: (skillId: string) => void;
  onRemoveDetach: (skillId: string) => void;
}) {
  const skillName = useMemo(() => new Map(skills.map((s) => [s.id, s.displayName])), [skills]);
  const attach = variant.skillOverrides.attach ?? [];
  const detach = variant.skillOverrides.detach ?? [];

  // Skills eligible to DETACH: any not already attached or detached (dropping a base attachment).
  const detachable = skills.filter(
    (s) => !attach.some((a) => a.skillId === s.id) && !detach.includes(s.id),
  );

  // Human label for an attach entry's version — the pinned label, or "latest".
  const versionLabel = (skillId: string, versionId: string): string => {
    if (versionId === "latest") return "latest";
    return skillVersions.get(skillId)?.find((v) => v.id === versionId)?.versionLabel ?? "pinned";
  };

  return (
    <div className="flex flex-col gap-3 rounded-md border border-border bg-card p-3">
      <div className="flex items-start gap-2">
        <Badge variant="outline" className="mt-2 shrink-0 tabular-nums">
          {index + 1}
        </Badge>
        <div className="grid min-w-0 flex-1 grid-cols-1 gap-2 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`variant-label-${index}`}>Label</Label>
            <Input
              id={`variant-label-${index}`}
              name={`variant-label-${index}`}
              value={variant.label}
              placeholder="base…"
              autoComplete="off"
              spellCheck={false}
              onChange={(event) => onPatch({ label: event.target.value })}
            />
          </div>
          <SelectField
            id={`variant-scenario-${index}`}
            label="Environment"
            value={variant.scenarioId}
            placeholder="Pick an environment…"
            options={scenarios.map((s) => ({ value: s.id, label: s.name }))}
            onChange={(value) => onPatch({ scenarioId: value })}
          />
        </div>
        <IconButton
          variant="ghost"
          size="sm"
          className="mt-6 shrink-0"
          label={`Remove variant ${variant.label || index + 1}`}
          onClick={onRemove}
        >
          <Trash2 aria-hidden />
        </IconButton>
      </div>

      {/* Attach — reuses the scenario AddSkillModal. */}
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between gap-2">
          <Text variant="meta" className="font-medium">
            Attach skills
          </Text>
          <Button variant="outline" size="sm" onClick={onAddSkill} disabled={skills.length === 0}>
            <Sparkles aria-hidden />
            <span>Add skill</span>
          </Button>
        </div>
        {attach.length === 0 ? (
          <Text variant="meta" tone="muted">
            None — this variant adds no skill on top of the environment’s own attachments.
          </Text>
        ) : (
          <ul className="flex flex-wrap gap-1.5">
            {attach.map((a) => (
              <li key={a.skillId}>
                <Badge variant="secondary" className="gap-1.5">
                  <Sparkles aria-hidden className="size-3" />
                  <span className="truncate">{skillName.get(a.skillId) ?? a.skillId}</span>
                  <span className="tabular-nums opacity-70">
                    {versionLabel(a.skillId, a.versionId)}
                  </span>
                  <IconButton
                    variant="ghost"
                    size="icon-sm"
                    className="-me-1 size-4"
                    label={`Remove attached ${skillName.get(a.skillId) ?? a.skillId}`}
                    onClick={() => onRemoveAttach(a.skillId)}
                  >
                    <X aria-hidden className="size-3" />
                  </IconButton>
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Detach — drop a base attachment for this variant. */}
      <div className="flex flex-col gap-1.5">
        <Text variant="meta" className="font-medium">
          Detach skills
        </Text>
        {detach.length > 0 ? (
          <ul className="flex flex-wrap gap-1.5">
            {detach.map((skillId) => (
              <li key={skillId}>
                <Badge variant="outline" className="gap-1.5">
                  <span className="truncate line-through opacity-80">
                    {skillName.get(skillId) ?? skillId}
                  </span>
                  <IconButton
                    variant="ghost"
                    size="icon-sm"
                    className="-me-1 size-4"
                    label={`Stop detaching ${skillName.get(skillId) ?? skillId}`}
                    onClick={() => onRemoveDetach(skillId)}
                  >
                    <X aria-hidden className="size-3" />
                  </IconButton>
                </Badge>
              </li>
            ))}
          </ul>
        ) : null}
        <SelectField
          id={`variant-detach-${index}`}
          label="Detach a skill"
          value=""
          placeholder={detachable.length === 0 ? "No skills to detach" : "Detach a skill…"}
          disabled={detachable.length === 0}
          options={detachable.map((s) => ({ value: s.id, label: s.displayName }))}
          onChange={onAddDetach}
        />
      </div>
    </div>
  );
}
