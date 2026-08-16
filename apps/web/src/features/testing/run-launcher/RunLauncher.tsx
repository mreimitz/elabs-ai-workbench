import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import type {
  Collection,
  ProviderCredential,
  ProviderKind,
  RunPlanEstimate,
  RunPlanInput,
  Scenario,
  Suite,
  SuiteInput,
  Test,
} from "@mcp-token-footprint/shared";
import {
  SUITE_DEFAULT_CONCURRENCY,
  SUITE_DEFAULT_REPETITIONS,
  SUITE_MAX_REPETITIONS,
} from "@mcp-token-footprint/shared";
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
  RadioGroup,
  RadioGroupItem,
  ScrollArea,
  Skeleton,
  StatePanel,
  Text,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  Wizard,
  WizardStep,
  WizardSteps,
  cn,
  toast,
} from "@brand/ui";
import { SearchInput } from "@brand/data";
import {
  ChevronLeft,
  ChevronRight,
  Info,
  Layers,
  ListChecks,
  Loader2,
  PlayCircle,
  Plus,
  Save,
  Server,
  TriangleAlert,
} from "lucide-react";
import {
  createRunPlan,
  createSuite,
  estimateRunPlan,
  listCollections,
  listProviders,
  listScenarios,
  listSuites,
  listTests,
} from "../../../lib/api";
import { getErrorMessage } from "../../../lib/errors";
import { formatCostUsd, formatDuration, formatNumber } from "../../../lib/format";
import { SelectField } from "../../../components/SelectField";
import { BoundedNumber } from "../../../components/form";
import { KpiStat } from "../../../components/KpiStat";
import { getCredentialHealth } from "../credential-health";

/**
 * Run launcher — the ONE "Run" entry, reworked as a WIDE three-step wizard (Testing IA WP 3.3 +
 * run-config rework). All four call sites (RunsView "New run", CollectionDetail "Run collection",
 * a test row "Run test", a suite row "Run suite") open this same dialog prefilled by
 * {@link RunLauncherIntent}.
 *
 * **Shape:** a wider-than-high modal (≈1080×640, WideDialog-tier sizing: fixed height, header and
 * footer pinned, only the step body scrolls). The `@brand/ui` Wizard runs CONTROLLED with a
 * vertical step rail on the left; the footer owns Back / Next / Run so the primary action lives in
 * the sticky footer, per the modal-system convention.
 *
 * **Steps:**
 * 1. **Run type** — Suite run vs Single / interactive run (RadioGroup choice cards).
 * 2. **Selection** — suite path: pick a saved suite (its matrix summarized); interactive path:
 *    tests and environment(s) side by side (the wide layout's payoff).
 * 3. **Configure & run** — repetitions + cost cap (suite values prefilled from the suite), the
 *    matrix roll-up, and the advisory cost preview.
 *
 * A prefilled intent (suite / collection / tests / environments) SKIPS step 1 — the entry point
 * already decided the type — but Back still returns to it to change your mind.
 *
 * **Routing (unchanged):** suite → `POST /api/run-plans` `source:'suite'`. Interactive: exactly
 * 1 test × 1 environment × 1 rep takes the EXISTING lightweight single-run path
 * (`/testing/runs/new` → `startRun`); anything larger runs as a plan (`source:'collection'` when
 * the entry collection's full test set is unchanged, else `source:'adhoc'`). Any interactive
 * configuration can be **Saved as a suite** (named, lands in the entry collection via its
 * `collectionId`) so it reruns identically.
 *
 * Self-contained: fetches its own tests / environments / suites / collections when it opens. Forms
 * follow `interaction-guidelines.md` (Next/Run stay enabled until validation runs, then inline
 * errors + focus-first-error; structural emptiness disables with an inline hint instead). Every
 * user-facing string reads "Environment(s)".
 */
export type RunLauncherIntent =
  | { kind: "choose" }
  | { kind: "suite"; suiteId: string }
  | { kind: "collection"; collectionId: string }
  | { kind: "tests"; testIds: string[]; collectionId?: string | null }
  // UX WP 3.3 (G11/S20) — open the interactive path with a pre-selected environment set (the
  // environments a skill is attached to), so "Test this skill" is one click from the skill page.
  // Additive; the user still picks the tests to run.
  | { kind: "environments"; scenarioIds: string[] };

type LauncherMode = "suite" | "interactive";
type FieldErrors = { tests?: string; scenarios?: string; suite?: string };

/** Wizard step indices — the wizard is controlled, so these are the only source of order. */
const STEP_TYPE = 0;
const STEP_SELECT = 1;
const STEP_CONFIGURE = 2;

/**
 * Unified Sessions (roadmap/unified-sessions/, WP3.4, D-US3/D-US7) — the SessionClock defaults the
 * effective-limits summary (below) renders. Mirrored by hand from the API source, NOT imported —
 * `apps/web` never imports `apps/api` source (the runtime boundary, `.claude/rules/architecture.md`)
 * and there is currently no read API serving these as data:
 *  - `SESSION_STALL_MS`/`SESSION_WAIT_BUDGET_MS` mirror `DEFAULT_STALL_MS`/`DEFAULT_WAIT_BUDGET_MS` in
 *    `apps/api/src/testing/session-clock.ts` — fixed constants with NO environment-variable override.
 *  - `QLIK_ANSWERS_WAIT_BUDGET_MS` mirrors the same-named export in
 *    `apps/api/src/testing/session-capabilities.ts` (Qlik Answers' longer wait budget).
 *  - `SUBSCRIPTION_RUNS_DEFAULT_CONCURRENCY` mirrors the `SUBSCRIPTION_RUNS_MAX_CONCURRENCY` env var's
 *    default in `apps/api/src/config/env.ts` (that one IS env-configurable, unlike the two above).
 * **Backend gap (flagged for a follow-up WP):** keeping these in sync by hand is fragile — a settings
 * read API (e.g. an addition to `GET /api/health` or a dedicated `GET /api/testing/session-defaults`)
 * should serve them as data instead. See `roadmap/unified-sessions/STATUS.md`.
 */
const SESSION_STALL_MS = 10 * 60_000;
const SESSION_WAIT_BUDGET_MS = 10 * 60_000;
const QLIK_ANSWERS_WAIT_BUDGET_MS = 30 * 60_000;
const SUBSCRIPTION_RUNS_DEFAULT_CONCURRENCY = 2;

export function RunLauncher({
  open,
  onOpenChange,
  intent,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  intent: RunLauncherIntent;
}) {
  const navigate = useNavigate();
  // A stable key so the load/seed effect only re-runs when the entry intent's CONTENT changes, not on
  // every parent re-render (the intent is an object literal at the call site).
  const intentKey = useMemo(() => JSON.stringify(intent), [intent]);
  // Only a collection entry runs the whole collection (source:'collection'); a test-row entry keeps its
  // explicit test even though it may carry a collectionId (used only to land a saved suite).
  const sourceCollectionId = intent.kind === "collection" ? intent.collectionId : null;
  const saveCollectionId =
    intent.kind === "collection"
      ? intent.collectionId
      : intent.kind === "tests"
        ? (intent.collectionId ?? null)
        : null;

  const [loading, setLoading] = useState(false);
  const [suites, setSuites] = useState<Suite[]>([]);
  const [tests, setTests] = useState<Test[]>([]);
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [providers, setProviders] = useState<ProviderCredential[]>([]);
  const [collections, setCollections] = useState<Collection[]>([]);

  const [mode, setMode] = useState<LauncherMode>("interactive");
  const [step, setStep] = useState(STEP_TYPE);

  // Path 1 — suite
  const [suiteId, setSuiteId] = useState("");
  const [suiteReps, setSuiteReps] = useState<number>(SUITE_DEFAULT_REPETITIONS);
  const [suiteCostCap, setSuiteCostCap] = useState<number | null>(null);

  // Path 2 — interactive
  const [selectedTestIds, setSelectedTestIds] = useState<string[]>([]);
  const [selectedScenarioIds, setSelectedScenarioIds] = useState<string[]>([]);
  const [reps, setReps] = useState<number>(SUITE_DEFAULT_REPETITIONS);
  const [costCap, setCostCap] = useState<number | null>(null);
  // Per-list narrowing (F4) — each picker gets its own search box + an "N of M shown" count.
  const [testSearch, setTestSearch] = useState("");
  const [scenarioSearch, setScenarioSearch] = useState("");

  const [launching, setLaunching] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});

  // Save-as-suite naming prompt (nested dialog, same pattern as SuiteEditor's AddSkillModal).
  const [saveOpen, setSaveOpen] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Load the harness + seed the form from the entry intent whenever the dialog opens. A prefilled
  // intent skips the type step — the entry point already decided suite-vs-interactive.
  useEffect(() => {
    if (!open) return;
    let active = true;
    setLoading(true);
    setFormError(null);
    setErrors({});
    setSaveOpen(false);
    setTestSearch("");
    setScenarioSearch("");
    setStep(intent.kind === "choose" ? STEP_TYPE : STEP_SELECT);
    Promise.all([listSuites(), listTests(), listScenarios(), listProviders(), listCollections()])
      .then(([suiteList, testList, scenarioList, providerList, collectionList]) => {
        if (!active) return;
        setSuites(suiteList);
        setTests(testList);
        setScenarios(scenarioList);
        setProviders(providerList);
        setCollections(collectionList);

        if (intent.kind === "suite") {
          setMode("suite");
          setSuiteId(intent.suiteId);
          const chosen = suiteList.find((s) => s.id === intent.suiteId);
          setSuiteReps(chosen?.config.repetitions ?? SUITE_DEFAULT_REPETITIONS);
          setSuiteCostCap(chosen?.config.aggregateCostCapUsd ?? null);
        } else if (intent.kind === "collection") {
          setMode("interactive");
          setSelectedTestIds(
            testList.filter((t) => t.collectionId === intent.collectionId).map((t) => t.id),
          );
          setSelectedScenarioIds([]);
          setReps(SUITE_DEFAULT_REPETITIONS);
          setCostCap(null);
        } else if (intent.kind === "tests") {
          setMode("interactive");
          setSelectedTestIds(intent.testIds);
          setSelectedScenarioIds([]);
          setReps(SUITE_DEFAULT_REPETITIONS);
          setCostCap(null);
        } else if (intent.kind === "environments") {
          // UX WP 3.3 — pre-select the environments a skill is attached to; the user then picks tests.
          setMode("interactive");
          setSelectedTestIds([]);
          setSelectedScenarioIds(intent.scenarioIds);
          setReps(SUITE_DEFAULT_REPETITIONS);
          setCostCap(null);
        } else {
          setMode("interactive");
          setSuiteId("");
          setSelectedTestIds([]);
          setSelectedScenarioIds([]);
          setReps(SUITE_DEFAULT_REPETITIONS);
          setCostCap(null);
        }
        setLoading(false);
      })
      .catch((error) => {
        if (!active) return;
        setFormError(`Couldn’t load the run options. ${getErrorMessage(error)} Try again.`);
        setLoading(false);
      });
    return () => {
      active = false;
    };
    // `intentKey` captures the intent content; `intent` is read fresh inside.
  }, [open, intentKey]);

  const suiteById = useMemo(() => new Map(suites.map((s) => [s.id, s])), [suites]);
  const collectionName = useMemo(
    () => new Map(collections.map((c) => [c.id, c.name])),
    [collections],
  );
  const providerLabel = (scenario: Scenario): string =>
    providers.find((p) => p.id === scenario.providerId)?.label ?? scenario.providerId;

  // The full test set of the entry collection — when the current selection still equals it, an
  // interactive launch stays a `source:'collection'` plan (resolved at run time); narrowing/widening
  // it drops to `source:'adhoc'` with explicit test ids.
  const collectionTestIds = useMemo(
    () =>
      sourceCollectionId
        ? tests.filter((t) => t.collectionId === sourceCollectionId).map((t) => t.id)
        : [],
    [tests, sourceCollectionId],
  );

  const interactiveCells = selectedTestIds.length * selectedScenarioIds.length * (reps || 1);
  const selectedSuite = suiteById.get(suiteId);
  const suiteAxisCount = selectedSuite
    ? (selectedSuite.config.variants?.length ?? 0) > 0
      ? (selectedSuite.config.variants?.length ?? 0)
      : selectedSuite.scenarioIds.length
    : 0;
  const suiteCells = selectedSuite
    ? selectedSuite.testIds.length * suiteAxisCount * (suiteReps || 1)
    : 0;

  // Per-list filtering (F4). Selected rows always stay visible even when filtered out, so a search
  // can't hide something the user already ticked.
  const visibleTests = useMemo(() => {
    const q = testSearch.trim().toLowerCase();
    if (!q) return tests;
    return tests.filter((t) => selectedTestIds.includes(t.id) || t.name.toLowerCase().includes(q));
  }, [tests, testSearch, selectedTestIds]);
  const visibleScenarios = useMemo(() => {
    const q = scenarioSearch.trim().toLowerCase();
    if (!q) return scenarios;
    return scenarios.filter(
      (s) =>
        selectedScenarioIds.includes(s.id) ||
        s.name.toLowerCase().includes(q) ||
        s.model.toLowerCase().includes(q),
    );
  }, [scenarios, scenarioSearch, selectedScenarioIds]);

  // Structural emptiness — nothing to select at all. This DISABLES Next/Run with an inline hint;
  // an empty SELECTION instead validates on Next (inline error + focus, per interaction-guidelines).
  const structuralReason: string | null =
    mode === "suite"
      ? suites.length === 0
        ? "Create a suite first."
        : null
      : tests.length === 0 || scenarios.length === 0
        ? "Create a test and an environment first."
        : null;

  // The reason Run is blocked, or null when it's ready — belt-and-braces on the final step (the
  // selection step already gates advancing, but Back + edits can invalidate it again).
  const runDisabledReason: string | null = (() => {
    if (loading) return null;
    if (structuralReason) return structuralReason;
    if (mode === "suite") {
      if (!suiteId) return "Pick a suite to run.";
      return null;
    }
    if (selectedTestIds.length === 0 && selectedScenarioIds.length === 0)
      return "Pick at least one test and one environment.";
    if (selectedTestIds.length === 0) return "Pick at least one test.";
    if (selectedScenarioIds.length === 0) return "Pick at least one environment.";
    return null;
  })();

  // The reason the SELECTION step can't advance yet — surfaced PROACTIVELY in the footer (before Next
  // is clicked) so the user always sees WHICH field blocks, never a bare "Fix the highlighted fields"
  // over nothing highlighted. `null` once the selection is valid. (Structural emptiness — no tests at
  // all — is handled separately: it disables Next; this is the enabled-with-inline-error case.)
  const selectBlockReason: string | null =
    structuralReason !== null
      ? null
      : mode === "suite"
        ? suiteId
          ? null
          : "Pick a suite to run."
        : selectedTestIds.length === 0 && selectedScenarioIds.length === 0
          ? "Pick at least one test and one environment."
          : selectedTestIds.length === 0
            ? "Pick at least one test."
            : selectedScenarioIds.length === 0
              ? "Pick at least one environment."
              : null;

  // The step rail doubles as a running summary — each step's description reflects what's chosen.
  const wizardSteps = useMemo(
    () => [
      {
        id: "type",
        title: "Run type",
        description: mode === "suite" ? "Suite run" : "Single / interactive",
      },
      {
        id: "select",
        title: mode === "suite" ? "Pick a suite" : "Tests & environments",
        description:
          mode === "suite"
            ? (selectedSuite?.name ?? "Nothing picked yet")
            : `${selectedTestIds.length} test${selectedTestIds.length === 1 ? "" : "s"} · ${selectedScenarioIds.length} environment${selectedScenarioIds.length === 1 ? "" : "s"}`,
      },
      {
        id: "configure",
        title: "Configure & run",
        description: "Repetitions & cost cap",
      },
    ],
    [mode, selectedSuite, selectedTestIds.length, selectedScenarioIds.length],
  );

  function switchMode(next: LauncherMode) {
    setMode(next);
    // S14 — a validation banner from the other path must not linger where nothing is highlighted.
    setFormError(null);
    setErrors({});
  }

  function toggleTest(id: string) {
    setSelectedTestIds((prev) =>
      prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id],
    );
    setErrors((e) => ({ ...e, tests: undefined }));
  }

  function toggleScenario(id: string) {
    setSelectedScenarioIds((prev) =>
      prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id],
    );
    setErrors((e) => ({ ...e, scenarios: undefined }));
  }

  function pickSuite(id: string) {
    setSuiteId(id);
    const chosen = suiteById.get(id);
    setSuiteReps(chosen?.config.repetitions ?? SUITE_DEFAULT_REPETITIONS);
    setSuiteCostCap(chosen?.config.aggregateCostCapUsd ?? null);
    setErrors((e) => ({ ...e, suite: undefined }));
  }

  function sameIdSet(a: string[], b: string[]): boolean {
    if (a.length !== b.length) return false;
    const set = new Set(a);
    return b.every((id) => set.has(id));
  }

  function buildInteractivePlan(): RunPlanInput {
    const overrides = {
      repetitions: reps,
      ...(costCap && costCap > 0 ? { aggregateCostCapUsd: costCap } : {}),
    };
    // Unchanged full-collection selection → run the collection (picks up its current tests at launch).
    if (sourceCollectionId && sameIdSet(selectedTestIds, collectionTestIds)) {
      return {
        source: "collection",
        collectionId: sourceCollectionId,
        scenarioIds: selectedScenarioIds,
        ...overrides,
      };
    }
    return {
      source: "adhoc",
      testIds: selectedTestIds,
      scenarioIds: selectedScenarioIds,
      ...overrides,
    };
  }

  function validateInteractive(): boolean {
    const next: FieldErrors = {};
    if (selectedTestIds.length === 0) next.tests = "Pick at least one test.";
    if (selectedScenarioIds.length === 0) next.scenarios = "Pick at least one environment.";
    if (Object.keys(next).length > 0) {
      setErrors(next);
      setFormError("Fix the highlighted fields and try again.");
      document.getElementById(next.tests ? "launcher-tests" : "launcher-environments")?.focus();
      return false;
    }
    setErrors({});
    setFormError(null);
    return true;
  }

  function validateSuiteSelection(): boolean {
    if (!suiteId) {
      setErrors({ suite: "Pick a suite to run." });
      setFormError("Select a suite first.");
      document.getElementById("launcher-suite")?.focus();
      return false;
    }
    setErrors({});
    setFormError(null);
    return true;
  }

  /** Footer "Next" — validates the active step before advancing (the wizard is controlled). */
  function goNext() {
    if (step === STEP_TYPE) {
      setStep(STEP_SELECT);
      return;
    }
    if (step === STEP_SELECT) {
      const ok = mode === "suite" ? validateSuiteSelection() : validateInteractive();
      if (ok) setStep(STEP_CONFIGURE);
    }
  }

  function goBack() {
    setFormError(null);
    setStep((s) => Math.max(STEP_TYPE, s - 1));
  }

  async function launchInteractive() {
    if (!validateInteractive()) return;
    setLaunching(true);
    try {
      const onlyTest = selectedTestIds[0];
      const onlyScenario = selectedScenarioIds[0];
      // 1 test × 1 environment × 1 rep → the EXISTING lightweight single-run path (unchanged).
      if (interactiveCells === 1 && onlyTest && onlyScenario) {
        const query = new URLSearchParams({ testId: onlyTest, scenarioId: onlyScenario });
        onOpenChange(false);
        navigate(`/testing/runs/new?${query.toString()}`);
        return;
      }
      const run = await createRunPlan(buildInteractivePlan());
      toast.success("Run started", { description: `${interactiveCells} runs queued` });
      onOpenChange(false);
      navigate(`/testing/suite-runs/${run.id}`);
    } catch (error) {
      setFormError(`Couldn’t start the run. ${getErrorMessage(error)} Try again.`);
      setLaunching(false);
    }
  }

  async function launchSuite() {
    if (!validateSuiteSelection()) return;
    setLaunching(true);
    try {
      // Overrides tune only reps + cost cap; the suite's own membership, concurrency, judge and variants
      // are inherited server-side. (Clearing a suite's cost cap here can't unset it — an absent override
      // inherits the suite value; edit the suite to remove a cap.)
      const overrides = {
        repetitions: suiteReps,
        ...(suiteCostCap && suiteCostCap > 0 ? { aggregateCostCapUsd: suiteCostCap } : {}),
      };
      const run = await createRunPlan({ source: "suite", suiteId, ...overrides });
      toast.success("Suite run started", { description: suiteById.get(suiteId)?.name });
      onOpenChange(false);
      navigate(`/testing/suite-runs/${run.id}`);
    } catch (error) {
      setFormError(`Couldn’t start the suite run. ${getErrorMessage(error)} Try again.`);
      setLaunching(false);
    }
  }

  function openSavePrompt() {
    if (!validateInteractive()) return;
    setSaveName("");
    setSaveError(null);
    setSaveOpen(true);
  }

  async function saveAsSuite() {
    const name = saveName.trim();
    if (!name) {
      setSaveError("Give the suite a name.");
      document.getElementById("save-suite-name")?.focus();
      return;
    }
    if (selectedTestIds.length === 0 || selectedScenarioIds.length === 0) {
      setSaveError("Pick at least one test and one environment first.");
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      const input: SuiteInput = {
        name,
        config: {
          repetitions: reps,
          maxConcurrency: SUITE_DEFAULT_CONCURRENCY,
          ...(costCap && costCap > 0 ? { aggregateCostCapUsd: costCap } : {}),
        },
        testIds: selectedTestIds,
        scenarioIds: selectedScenarioIds,
        ...(saveCollectionId ? { collectionId: saveCollectionId } : {}),
      };
      await createSuite(input);
      const where = saveCollectionId
        ? (collectionName.get(saveCollectionId) ?? "the collection")
        : "Local";
      toast.success("Saved as suite", { description: `“${name}” added to ${where}` });
      setSaveOpen(false);
      onOpenChange(false);
    } catch (error) {
      setSaveError(`Couldn’t save the suite. ${getErrorMessage(error)} Try again.`);
    } finally {
      setSaving(false);
    }
  }

  function goNewTest() {
    onOpenChange(false);
    navigate(
      saveCollectionId ? `/testing/collections/${saveCollectionId}` : "/testing/collections",
    );
  }

  function goNewEnvironment() {
    onOpenChange(false);
    navigate("/testing/environments");
  }

  /* ---------------------------------- Step 1 — run type ---------------------------------- */

  const typeStep = (
    <div className="flex h-full flex-col gap-4">
      <Text tone="muted" className="text-pretty">
        What kind of run is this? The entry points around the app preselect this for you — change it
        here any time.
      </Text>
      <RadioGroup
        aria-label="Run type"
        className="grid gap-3 sm:grid-cols-2"
        value={mode}
        onValueChange={(value) => value && switchMode(value as LauncherMode)}
      >
        {(
          [
            {
              value: "suite" as const,
              icon: Layers,
              label: "Suite run",
              description:
                "Launch a saved suite — a repeatable tests × environments matrix with its own repetitions, cost cap, judge and variants.",
            },
            {
              value: "interactive" as const,
              icon: PlayCircle,
              label: "Single / interactive run",
              description:
                "Pick tests and environment(s) now. One test × one environment opens the single-run console; anything larger runs as a matrix. Save any setup as a suite to rerun it.",
            },
          ] as const
        ).map((option) => {
          const id = `launcher-mode-${option.value}`;
          const active = mode === option.value;
          return (
            <Label
              key={option.value}
              htmlFor={id}
              className={cn(
                "flex h-full cursor-pointer flex-col gap-1.5 rounded-md border p-4 text-left font-normal whitespace-normal",
                active ? "border-primary bg-primary/5" : "border-border",
              )}
            >
              <span className="flex items-center gap-2 font-medium">
                <RadioGroupItem id={id} value={option.value} />
                <option.icon aria-hidden className="size-4" />
                {option.label}
              </span>
              <span className="ps-6 text-caption text-pretty text-muted-foreground">
                {option.description}
              </span>
            </Label>
          );
        })}
      </RadioGroup>
    </div>
  );

  /* ------------------------------- Step 2 — selection ------------------------------- */

  const suiteSelectStep = (
    <div className="flex flex-col gap-5">
      {suites.length === 0 ? (
        <EmptyState
          icon={<Layers aria-hidden />}
          title="No suites yet"
          description="A suite bundles ordered tests and an environment set into a repeatable matrix run. Create one from a collection's Suites tab, then launch it here."
        />
      ) : (
        <>
          <div className="flex max-w-xl flex-col gap-1.5">
            <SelectField
              id="launcher-suite"
              label="Suite"
              value={suiteId}
              placeholder="Pick a suite…"
              options={suites.map((s) => ({ value: s.id, label: s.name }))}
              onChange={pickSuite}
            />
            {errors.suite ? (
              <Text variant="meta" className="text-destructive" role="alert">
                {errors.suite}
              </Text>
            ) : null}
          </div>

          {selectedSuite ? (
            <div className="flex flex-col gap-3 rounded-md border border-border bg-card p-4">
              <Text className="font-medium">{selectedSuite.name}</Text>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="secondary" className="tabular-nums">
                  {selectedSuite.testIds.length} test
                  {selectedSuite.testIds.length === 1 ? "" : "s"}
                </Badge>
                <Badge variant="secondary" className="tabular-nums">
                  {(selectedSuite.config.variants?.length ?? 0) > 0
                    ? `${selectedSuite.config.variants?.length ?? 0} variants`
                    : `${selectedSuite.scenarioIds.length} environment${selectedSuite.scenarioIds.length === 1 ? "" : "s"}`}
                </Badge>
                {selectedSuite.collectionId ? (
                  <Badge variant="secondary">
                    {collectionName.get(selectedSuite.collectionId) ?? "Local"}
                  </Badge>
                ) : null}
              </div>
              <Text variant="meta" tone="muted" className="text-pretty">
                Membership, concurrency, judge and variants come from the suite. The next step tunes
                repetitions and the cost cap for THIS launch only.
              </Text>
            </div>
          ) : null}
        </>
      )}
    </div>
  );

  const testsPicker = (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Text className="font-medium">Tests</Text>
        <div className="flex items-center gap-3">
          <Text variant="meta" tone="muted" className="tabular-nums">
            {selectedTestIds.length} selected
          </Text>
          <Button variant="link" size="sm" className="h-auto p-0" onClick={goNewTest}>
            <Plus aria-hidden />
            <span>New test</span>
          </Button>
        </div>
      </div>
      {tests.length === 0 ? (
        <EmptyState
          icon={<ListChecks aria-hidden />}
          title="No tests yet"
          description="Create a test in a collection first, then pick it here to run."
        />
      ) : (
        <>
          {tests.length > 5 ? (
            <SearchInput
              value={testSearch}
              onValueChange={setTestSearch}
              placeholder="Search tests…"
              label="Search tests"
            />
          ) : null}
          <ScrollArea
            id="launcher-tests"
            tabIndex={-1}
            aria-invalid={errors.tests ? true : undefined}
            className={cn(
              "h-64 rounded-md border outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
              errors.tests ? "border-destructive" : "border-border",
            )}
          >
            {visibleTests.length === 0 ? (
              <Text variant="meta" tone="muted" className="p-3">
                No tests match “{testSearch}”.
              </Text>
            ) : (
              <div className="flex flex-col gap-1.5 p-1.5">
                {visibleTests.map((test) => (
                  <label
                    key={test.id}
                    className="flex min-w-0 cursor-pointer items-center gap-2 rounded-md border border-border px-3 py-2"
                  >
                    <Checkbox
                      checked={selectedTestIds.includes(test.id)}
                      onCheckedChange={() => toggleTest(test.id)}
                      aria-label={`Include ${test.name}`}
                    />
                    <Text as="span" className="min-w-0 flex-1 truncate">
                      {test.name}
                    </Text>
                    {test.collectionId ? (
                      <Badge variant="secondary" className="shrink-0 font-normal">
                        {collectionName.get(test.collectionId) ?? "Local"}
                      </Badge>
                    ) : null}
                  </label>
                ))}
              </div>
            )}
          </ScrollArea>
          <Text variant="meta" tone="muted" className="tabular-nums">
            Showing {visibleTests.length} of {tests.length} test{tests.length === 1 ? "" : "s"}
            {testSearch.trim() ? " — search to narrow" : ""}
          </Text>
        </>
      )}
      {errors.tests ? (
        <Text variant="meta" className="text-destructive" role="alert">
          {errors.tests}
        </Text>
      ) : null}
    </div>
  );

  const environmentsPicker = (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Text className="font-medium">Environment(s)</Text>
        <div className="flex items-center gap-3">
          <Text variant="meta" tone="muted" className="tabular-nums">
            {selectedScenarioIds.length} selected
          </Text>
          <Button variant="link" size="sm" className="h-auto p-0" onClick={goNewEnvironment}>
            <Plus aria-hidden />
            <span>New environment</span>
          </Button>
        </div>
      </div>
      {scenarios.length === 0 ? (
        <EmptyState
          icon={<Server aria-hidden />}
          title="No environments yet"
          description="An environment sets the provider, model, guardrails and MCP servers a test runs against. Create one, then pick it here."
        />
      ) : (
        <>
          {scenarios.length > 5 ? (
            <SearchInput
              value={scenarioSearch}
              onValueChange={setScenarioSearch}
              placeholder="Search environments…"
              label="Search environments"
            />
          ) : null}
          <ScrollArea
            id="launcher-environments"
            tabIndex={-1}
            aria-invalid={errors.scenarios ? true : undefined}
            className={cn(
              "h-64 rounded-md border outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
              errors.scenarios ? "border-destructive" : "border-border",
            )}
          >
            {visibleScenarios.length === 0 ? (
              <Text variant="meta" tone="muted" className="p-3">
                No environments match “{scenarioSearch}”.
              </Text>
            ) : (
              <div className="flex flex-col gap-1.5 p-1.5">
                {visibleScenarios.map((scenario) => (
                  <label
                    key={scenario.id}
                    className="flex min-w-0 cursor-pointer items-center gap-2 rounded-md border border-border px-3 py-2"
                  >
                    <Checkbox
                      checked={selectedScenarioIds.includes(scenario.id)}
                      onCheckedChange={() => toggleScenario(scenario.id)}
                      aria-label={`Include ${scenario.name}`}
                    />
                    <div className="flex min-w-0 flex-1 flex-col">
                      <Text as="span" className="min-w-0 truncate">
                        {scenario.name}
                      </Text>
                      <Text as="span" variant="meta" tone="muted" className="min-w-0 truncate">
                        {providerLabel(scenario)}
                      </Text>
                    </div>
                    <Badge variant="secondary" className="shrink-0 font-mono text-meta">
                      {scenario.model}
                    </Badge>
                  </label>
                ))}
              </div>
            )}
          </ScrollArea>
          <Text variant="meta" tone="muted" className="tabular-nums">
            Showing {visibleScenarios.length} of {scenarios.length} environment
            {scenarios.length === 1 ? "" : "s"}
            {scenarioSearch.trim() ? " — search to narrow" : ""}
          </Text>
        </>
      )}
      {errors.scenarios ? (
        <Text variant="meta" className="text-destructive" role="alert">
          {errors.scenarios}
        </Text>
      ) : null}
    </div>
  );

  // The wide modal's payoff — tests and environments side by side instead of stacked.
  const interactiveSelectStep = (
    <div className="grid gap-6 lg:grid-cols-2">
      {testsPicker}
      {environmentsPicker}
    </div>
  );

  /* ---------------------------- Step 3 — configure & run ---------------------------- */

  const configureStep =
    mode === "suite" ? (
      <div className="flex flex-col gap-5">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="launcher-suite-reps">Repetitions</Label>
            <NumberInput
              id="launcher-suite-reps"
              value={suiteReps}
              min={1}
              max={SUITE_MAX_REPETITIONS}
              onValueChange={(value) => setSuiteReps(value ?? SUITE_DEFAULT_REPETITIONS)}
            />
            <Text variant="meta" tone="muted">
              Prefilled from the suite — 1–{SUITE_MAX_REPETITIONS} runs per cell.
            </Text>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="launcher-suite-cap">Cost cap (USD)</Label>
            <BoundedNumber
              id="launcher-suite-cap"
              value={suiteCostCap}
              min={0}
              step={0.5}
              placeholder="No cap"
              unit="$"
              aria-label="Cost cap in US dollars"
              onChange={(value) => setSuiteCostCap(value)}
            />
            <Text variant="meta" tone="muted">
              Soft-stop once spend ≥ cap.
            </Text>
          </div>
        </div>

        {selectedSuite ? (
          <>
            <MatrixSummary
              axisALabel={`${selectedSuite.testIds.length} tests`}
              axisBLabel={
                (selectedSuite.config.variants?.length ?? 0) > 0
                  ? `${selectedSuite.config.variants?.length ?? 0} variants`
                  : `${selectedSuite.scenarioIds.length} environments`
              }
              reps={suiteReps}
              cells={suiteCells}
            />

            {/* A variant carries its OWN scenarioId (unlike the token/cost estimate below, the
                effective-limits summary is cheap local derivation, so variants are included too). */}
            <EffectiveLimits
              scenarioIds={
                (selectedSuite.config.variants?.length ?? 0) > 0
                  ? (selectedSuite.config.variants ?? []).map((variant) => variant.scenarioId)
                  : selectedSuite.scenarioIds
              }
              scenarios={scenarios}
              providers={providers}
            />

            <CredentialWarning
              scenarioIds={
                (selectedSuite.config.variants?.length ?? 0) > 0
                  ? (selectedSuite.config.variants ?? []).map((variant) => variant.scenarioId)
                  : selectedSuite.scenarioIds
              }
              scenarios={scenarios}
              providers={providers}
            />

            {/* Variant suites override the environment per axis, so the env-footprint estimate only
                applies to a plain tests × environments suite. */}
            {(selectedSuite.config.variants?.length ?? 0) === 0 ? (
              <CostPreview
                open={open}
                testIds={selectedSuite.testIds}
                environmentIds={selectedSuite.scenarioIds}
                reps={suiteReps}
              />
            ) : null}
          </>
        ) : null}
      </div>
    ) : (
      <div className="flex flex-col gap-5">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="launcher-reps">Repetitions</Label>
            <NumberInput
              id="launcher-reps"
              value={reps}
              min={1}
              max={SUITE_MAX_REPETITIONS}
              onValueChange={(value) => setReps(value ?? SUITE_DEFAULT_REPETITIONS)}
            />
            <Text variant="meta" tone="muted">
              1–{SUITE_MAX_REPETITIONS} runs per test × environment cell.
            </Text>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="launcher-cap">Cost cap (USD)</Label>
            <BoundedNumber
              id="launcher-cap"
              value={costCap}
              min={0}
              step={0.5}
              placeholder="No cap"
              unit="$"
              aria-label="Cost cap in US dollars"
              onChange={(value) => setCostCap(value)}
            />
            <Text variant="meta" tone="muted">
              Soft-stop once spend ≥ cap. Leave empty for no cap.
            </Text>
          </div>
        </div>

        <MatrixSummary
          axisALabel={`${selectedTestIds.length} tests`}
          axisBLabel={`${selectedScenarioIds.length} environments`}
          reps={reps}
          cells={interactiveCells}
          single="1 test × 1 environment opens the single-run console."
        />

        <EffectiveLimits
          scenarioIds={selectedScenarioIds}
          scenarios={scenarios}
          providers={providers}
        />

        <CredentialWarning
          scenarioIds={selectedScenarioIds}
          scenarios={scenarios}
          providers={providers}
        />

        <CostPreview
          open={open}
          testIds={selectedTestIds}
          environmentIds={selectedScenarioIds}
          reps={reps}
        />
      </div>
    );

  /* --------------------------------------- Shell --------------------------------------- */

  const onFinal = step === STEP_CONFIGURE;
  const footerHint = loading
    ? null
    : step === STEP_SELECT
      ? (structuralReason ?? selectBlockReason)
      : onFinal
        ? runDisabledReason
        : null;

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        {/* WideDialog-tier sizing (audit §S17/S22): a wider-than-high modal with a STABLE height —
            header (auto) · body (1fr, the step content scrolls) · footer (auto). Switching steps
            never resizes the dialog. */}
        <DialogContent className="grid h-[min(85vh,640px)] grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden p-0 sm:max-w-[min(1080px,95vw)]">
          <DialogHeader className="flex-none gap-1 border-b border-border px-6 py-4 pe-12 text-start">
            <DialogTitle>Run</DialogTitle>
            <DialogDescription>
              Three steps — choose the run type, pick what to run, set repetitions and the cost cap.
            </DialogDescription>
          </DialogHeader>

          <div className="flex min-h-0 flex-col">
            {formError ? (
              <div className="flex-none border-b border-border px-6 py-3">
                <Alert variant="destructive">
                  <AlertDescription>{formError}</AlertDescription>
                </Alert>
              </div>
            ) : null}

            {loading ? (
              <div className="min-h-0 flex-1 overflow-y-auto p-6">
                <StatePanel
                  kind="loading"
                  title="Loading run options…"
                  loadingLabel="Loading run options…"
                />
              </div>
            ) : (
              <Wizard
                orientation="vertical"
                steps={wizardSteps}
                step={step}
                onStepChange={setStep}
                className="min-h-0 flex-1 gap-0"
              >
                {/* Vertical step rail — the wizard's left column, doubling as a running summary. */}
                <div className="w-60 shrink-0 overflow-y-auto border-e border-border bg-muted/30 p-4">
                  <WizardSteps className="gap-4" />
                </div>
                <div className="min-w-0 flex-1 overflow-y-auto px-6 py-5">
                  <WizardStep step={STEP_TYPE}>{typeStep}</WizardStep>
                  <WizardStep step={STEP_SELECT}>
                    {mode === "suite" ? suiteSelectStep : interactiveSelectStep}
                  </WizardStep>
                  <WizardStep step={STEP_CONFIGURE}>{configureStep}</WizardStep>
                </div>
              </Wizard>
            )}
          </div>

          {/* Footer owns Back / Next / Run so the primary action is always visible (S22). The
              wizard is controlled, so these buttons drive the same state the rail reflects. */}
          <DialogFooter className="flex-none flex-wrap items-center border-t border-border px-6 py-4">
            {footerHint ? (
              <Text variant="meta" tone="muted" className="me-auto min-w-0">
                {footerHint}
              </Text>
            ) : null}
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            {step > STEP_TYPE ? (
              <Button variant="outline" onClick={goBack} disabled={launching || loading}>
                <ChevronLeft aria-hidden />
                <span>Back</span>
              </Button>
            ) : null}
            {onFinal && mode === "interactive" ? (
              <Button
                variant="outline"
                onClick={openSavePrompt}
                disabled={launching || loading || runDisabledReason !== null}
              >
                <Save aria-hidden />
                <span>Save as suite</span>
              </Button>
            ) : null}
            {onFinal ? (
              <Button
                onClick={() => void (mode === "suite" ? launchSuite() : launchInteractive())}
                disabled={launching || loading || runDisabledReason !== null}
                title={runDisabledReason ?? undefined}
              >
                {launching ? (
                  <Loader2 className="animate-spin" aria-hidden />
                ) : (
                  <PlayCircle aria-hidden />
                )}
                <span>{launching ? "Starting…" : "Run"}</span>
              </Button>
            ) : (
              <Button
                onClick={goNext}
                disabled={loading || (step === STEP_SELECT && structuralReason !== null)}
                title={
                  step === STEP_SELECT
                    ? (structuralReason ?? selectBlockReason ?? undefined)
                    : undefined
                }
              >
                <span>Next</span>
                <ChevronRight aria-hidden />
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Save-as-suite naming prompt — a focused sibling dialog (SuiteEditor uses the same pattern). */}
      <Dialog open={saveOpen} onOpenChange={(next) => !next && setSaveOpen(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Save as suite</DialogTitle>
            <DialogDescription>
              Save this configuration as a repeatable suite
              {saveCollectionId
                ? ` in ${collectionName.get(saveCollectionId) ?? "the collection"}`
                : ""}
              . It reruns the same tests × environments matrix.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="save-suite-name">Name</Label>
            <Input
              id="save-suite-name"
              name="save-suite-name"
              value={saveName}
              placeholder="Regression suite…"
              autoComplete="off"
              spellCheck={false}
              aria-invalid={saveError ? true : undefined}
              onChange={(event) => setSaveName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void saveAsSuite();
              }}
            />
            {saveError ? (
              <Text variant="meta" className="text-destructive" role="alert">
                {saveError}
              </Text>
            ) : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSaveOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => void saveAsSuite()} disabled={saving}>
              <Save aria-hidden />
              <span>{saving ? "Saving…" : "Save suite"}</span>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** The matrix roll-up line — `A × B × reps = cells`, `tabular-nums` for aligned digits. */
function MatrixSummary({
  axisALabel,
  axisBLabel,
  reps,
  cells,
  single,
}: {
  axisALabel: string;
  axisBLabel: string;
  reps: number;
  cells: number;
  single?: string;
}) {
  return (
    <div className="rounded-md border border-border bg-muted px-3 py-2">
      <Text variant="meta" tone="muted" className="tabular-nums text-pretty">
        {axisALabel} × {axisBLabel} × {reps} repetition{reps === 1 ? "" : "s"} ={" "}
        <span className="font-medium text-foreground">
          {cells} run{cells === 1 ? "" : "s"}
        </span>
        {single && cells === 1 ? ` — ${single}` : ""}
      </Text>
    </div>
  );
}

/** Format a token band as "low–high" (or a single figure when they collapse), `tabular-nums`-ready. */
function formatRange(low: number, high: number): string {
  return low === high ? formatNumber(low) : `${formatNumber(low)}–${formatNumber(high)}`;
}

/**
 * Describe the wall cap across a set of environments: one shared value when they agree (including
 * "no cap" when every one of them is uncapped), a "no cap · up to X (N of M)" summary when some are
 * capped and some aren't, or a "low–high" band when every one of them is capped but at different
 * values.
 */
function describeWallCap(selected: Scenario[]): string {
  const values = selected.map((scenario) => scenario.guardrails.maxRunDurationMs ?? null);
  const distinct = Array.from(new Set(values));
  if (distinct.length === 1) {
    const only = distinct[0];
    return only == null ? "No cap" : formatDuration(only);
  }
  const capped = values.filter((value): value is number => value != null);
  const uncappedCount = values.length - capped.length;
  const maxCap = Math.max(...capped);
  if (uncappedCount > 0) {
    return `No cap · up to ${formatDuration(maxCap)} (${capped.length} of ${values.length} environments)`;
  }
  const minCap = Math.min(...capped);
  return `${formatDuration(minCap)}–${formatDuration(maxCap)}`;
}

/**
 * Unified Sessions (roadmap/unified-sessions/, WP3.4, D-US3/D-US7) — the effective-limits summary:
 * the stall timeout, wait budget, wall cap, and (when relevant) subscription concurrency the run WILL
 * use, surfaced BEFORE the run starts. Pure/sync — no network round trip: there's no persisted run yet
 * to read a `capabilities` manifest from, and `POST /api/estimate/run-plan`'s response
 * ({@link RunPlanEstimate}) carries no limits at all, only the token/cost/questions advisory. Derived
 * from:
 *  - the wall cap: each selected environment's OWN `guardrails.maxRunDurationMs` — a REAL, persisted
 *    backend field (`EnvironmentEditor`'s "Max run duration").
 *  - the stall timeout + wait-budget DEFAULTS: the mirrored constants above — there is currently NO
 *    per-environment override field for either and NO read API serving them as data (see the constants'
 *    doc comment and the WP3.4 report), so they render as fixed figures here, never editable inputs.
 *  - subscription concurrency: shown only when a selected environment runs on a `claude_subscription`
 *    credential — also env-var-only, no read API (same flag).
 */
function EffectiveLimits({
  scenarioIds,
  scenarios,
  providers,
}: {
  scenarioIds: string[];
  scenarios: Scenario[];
  providers: ProviderCredential[];
}) {
  const selected = useMemo(
    () => scenarios.filter((scenario) => scenarioIds.includes(scenario.id)),
    [scenarios, scenarioIds],
  );
  if (selected.length === 0) return null;

  const kindOf = (scenario: Scenario): ProviderKind | undefined =>
    providers.find((provider) => provider.id === scenario.providerId)?.kind;
  const qlikCount = selected.filter((scenario) => kindOf(scenario) === "qlik_answers").length;
  const subscriptionCount = selected.filter(
    (scenario) => kindOf(scenario) === "claude_subscription",
  ).length;

  const waitBudgetLabel =
    qlikCount === 0
      ? formatDuration(SESSION_WAIT_BUDGET_MS)
      : qlikCount === selected.length
        ? formatDuration(QLIK_ANSWERS_WAIT_BUDGET_MS)
        : `${formatDuration(SESSION_WAIT_BUDGET_MS)} · ${formatDuration(QLIK_ANSWERS_WAIT_BUDGET_MS)} for ${qlikCount} Qlik Answers environment${qlikCount === 1 ? "" : "s"}`;

  return (
    <div className="flex flex-col gap-2.5 rounded-md border border-border bg-card px-3 py-2.5">
      <div className="flex items-center gap-1.5">
        <Text variant="meta" tone="muted">
          Effective limits
        </Text>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              className="size-5 text-muted-foreground"
              aria-label="What these limits mean"
            >
              <Info aria-hidden className="size-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent className="max-w-72">
            <p className="text-pretty">
              The run's session clock: no events for the stall timeout while running stops it;
              waiting on a follow-up beyond the wait budget stops it ("Expired"); the wall cap, when
              an environment sets one, is a hard ceiling regardless of activity. Subscription
              concurrency bounds how many Claude-subscription runs execute at once, app-wide.
            </p>
          </TooltipContent>
        </Tooltip>
      </div>
      <div className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-4">
        <KpiStat label="Stall timeout" value={formatDuration(SESSION_STALL_MS)} />
        <KpiStat label="Wait budget" value={waitBudgetLabel} />
        <KpiStat label="Wall cap" value={describeWallCap(selected)} />
        {subscriptionCount > 0 ? (
          <KpiStat
            label="Subscription concurrency"
            value={`up to ${SUBSCRIPTION_RUNS_DEFAULT_CONCURRENCY}`}
            sub="concurrent"
          />
        ) : null}
      </div>
    </div>
  );
}

/**
 * T7 — a run can die on a bad/never-tested API key with no earlier signal. This warns BEFORE launch
 * when a selected environment's provider credential isn't `verified` (never tested, or last test
 * failed — see `credential-health.ts`). Advisory only: it blocks nothing (the run still launches);
 * it points the operator at the Environments "Test connection" affordance. Nothing shows once every
 * selected environment's credential reads verified.
 */
function CredentialWarning({
  scenarioIds,
  scenarios,
  providers,
}: {
  scenarioIds: string[];
  scenarios: Scenario[];
  providers: ProviderCredential[];
}) {
  const unverifiedCount = useMemo(() => {
    const providerById = new Map(providers.map((provider) => [provider.id, provider]));
    let count = 0;
    for (const id of scenarioIds) {
      const scenario = scenarios.find((candidate) => candidate.id === id);
      if (!scenario) continue;
      const provider = providerById.get(scenario.providerId);
      if (getCredentialHealth(provider).state !== "verified") count += 1;
    }
    return count;
  }, [scenarioIds, scenarios, providers]);

  if (unverifiedCount === 0) return null;

  return (
    <Alert variant="warning">
      <TriangleAlert aria-hidden />
      <AlertDescription className="text-pretty">
        {unverifiedCount} selected{" "}
        {unverifiedCount === 1
          ? "environment uses a credential that hasn’t"
          : "environments use credentials that haven’t"}{" "}
        been verified. Test the connection in Environments so a paid run doesn’t fail on a bad key.
      </AlertDescription>
    </Alert>
  );
}

/**
 * WP 3.5 (G7) — advisory cost preview. Debounced call to `GET /api/estimate/run-plan`; renders the
 * selection's rough "≈ tokens · $ range (estimate)" with a tooltip explaining the assumptions, plus
 * advisory notes for unpriced models and environments with no cost cap. Blocks NOTHING; only shows
 * once there's at least one test and one environment.
 */
function CostPreview({
  open,
  testIds,
  environmentIds,
  reps,
}: {
  open: boolean;
  testIds: string[];
  environmentIds: string[];
  reps: number;
}) {
  const [estimate, setEstimate] = useState<RunPlanEstimate | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ready = testIds.length > 0 && environmentIds.length > 0 && (reps || 0) > 0;
  // A stable key so the debounced fetch only re-runs when the SELECTION content changes.
  const selectionKey = `${testIds.join(",")}|${environmentIds.join(",")}|${reps}`;

  useEffect(() => {
    if (!open || !ready) {
      setEstimate(null);
      setError(null);
      setLoading(false);
      return;
    }
    let active = true;
    setLoading(true);
    // Debounce so rapid ticking of checkboxes doesn't hammer the endpoint.
    const handle = window.setTimeout(() => {
      estimateRunPlan(testIds, environmentIds, reps)
        .then((result) => {
          if (!active) return;
          setEstimate(result);
          setError(null);
          setLoading(false);
        })
        .catch((err) => {
          if (!active) return;
          setError(`Couldn’t estimate cost. ${getErrorMessage(err)} You can still continue.`);
          setLoading(false);
        });
    }, 300);
    return () => {
      active = false;
      window.clearTimeout(handle);
    };
    // `selectionKey` captures the selection; the ids/reps are read fresh inside.
  }, [open, ready, selectionKey]);

  if (!ready) return null;

  // Qlik Answers (WP 3.2): `answersQuestions` is the plan TOTAL across every `qlik_answers`
  // environment (the wire carries no per-environment breakdown — additive-only, see WP 0.1). Since
  // each such environment contributes exactly `testCount × repetitions` questions, the environment
  // count for the explicit multiplier divides back out exactly (integer, never a guess).
  const qlikAnswersEnvironmentCount =
    estimate &&
    estimate.answersQuestions !== undefined &&
    estimate.testCount > 0 &&
    estimate.repetitions > 0
      ? Math.round(estimate.answersQuestions / (estimate.testCount * estimate.repetitions))
      : 0;

  return (
    <div className="flex flex-col gap-2 rounded-md border border-border bg-card px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
        <Text variant="meta" tone="muted">
          Estimated cost
        </Text>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              className="size-5 text-muted-foreground"
              aria-label="How this estimate is calculated"
            >
              <Info aria-hidden className="size-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent className="max-w-72">
            <p className="text-pretty">
              A rough forecast, not a quote. It multiplies each environment's tool-definition
              footprint (re-sent every agent turn) by an assumed 1–8 turns, the selected
              repetitions, and the model's list price. Actual spend depends on how many turns the
              agent takes and prompt caching. Unpriced or local models are excluded from the dollar
              range.
            </p>
          </TooltipContent>
        </Tooltip>
      </div>

      {loading && !estimate ? (
        <div className="flex flex-col gap-1.5">
          <Skeleton className="h-5 w-48" />
          <Skeleton className="h-3.5 w-32" />
        </div>
      ) : error ? (
        <Text variant="meta" tone="muted">
          {error}
        </Text>
      ) : estimate ? (
        <div className="flex flex-col gap-1.5">
          <Text className="text-pretty tabular-nums">
            <span aria-hidden>≈ </span>
            <span className="font-medium text-foreground">
              {formatRange(estimate.tokens.low, estimate.tokens.high)}
            </span>{" "}
            tokens
            {estimate.environmentCount > estimate.unpricedEnvironmentCount ? (
              <>
                {" · "}
                <span className="font-medium text-foreground">
                  {formatCostUsd(estimate.costUsd.low)}–{formatCostUsd(estimate.costUsd.high)}
                </span>
              </>
            ) : null}{" "}
            <span className="text-muted-foreground">(estimate)</span>
          </Text>

          {estimate.unpricedEnvironmentCount > 0 ? (
            <Text variant="meta" tone="muted" className="text-pretty">
              {estimate.unpricedEnvironmentCount} environment
              {estimate.unpricedEnvironmentCount === 1 ? " uses" : "s use"} an unpriced model —
              counted in tokens, excluded from the dollar range.
            </Text>
          ) : null}

          {/* Qlik Answers (WP 3.2): a tenant assistant consumes QUESTIONS, not metered tokens — the
              matrix multiplier is spelled out explicitly (mirrors MatrixSummary's "A × B × reps ="
              convention) so it's clear this is a separate quota from the $ estimate above. */}
          {estimate.answersQuestions !== undefined ? (
            <div className="flex flex-col gap-1 rounded-md border border-border bg-muted px-3 py-2">
              <Text variant="meta" tone="muted" className="tabular-nums text-pretty">
                {estimate.testCount} test{estimate.testCount === 1 ? "" : "s"} ×{" "}
                {qlikAnswersEnvironmentCount} Qlik Answers environment
                {qlikAnswersEnvironmentCount === 1 ? "" : "s"} × {estimate.repetitions} repetition
                {estimate.repetitions === 1 ? "" : "s"} ={" "}
                <span className="font-medium text-foreground">
                  {formatNumber(estimate.answersQuestions)} question
                  {estimate.answersQuestions === 1 ? "" : "s"}
                </span>
              </Text>
              <Text variant="meta" tone="muted" className="text-pretty">
                Qlik Answers has no per-token cost — each prompt draws one question from the
                tenant's shared monthly quota.
              </Text>
            </div>
          ) : null}

          {estimate.uncappedEnvironmentCount > 0 ? (
            <div className="flex items-start gap-1.5">
              <TriangleAlert
                aria-hidden
                className="mt-0.5 size-3.5 shrink-0 text-muted-foreground"
              />
              <Text variant="meta" tone="muted" className="text-pretty">
                {estimate.uncappedEnvironmentCount} environment
                {estimate.uncappedEnvironmentCount === 1 ? " has" : "s have"} no cost cap — a run
                can spend more than expected. Set a cap on the environment to soft-stop.
              </Text>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
