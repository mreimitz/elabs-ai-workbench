import { useEffect, useState } from "react";
import type {
  AttachmentKind,
  Collection,
  Difficulty,
  ReferenceLogicKind,
  Test,
  TestAssertions,
  TestAttachment,
  TestAttachmentInput,
  TestExpectations,
  TestInput,
  TokenProfileRef,
} from "@mcp-token-footprint/shared";
import { testInputSchema } from "@mcp-token-footprint/shared";
import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  FileUpload,
  FileUploadDropzone,
  Input,
  Label,
  Spinner,
  Switch,
  Text,
  Textarea,
  type UploadFile,
} from "@brand/ui";
import { ClipboardCheck, FileText, Paperclip, Plus, Tags, Trash2, X } from "lucide-react";
import { AssertionsEditor } from "../AssertionsEditor";
import { TokenProfileField } from "../TokenProfileField";
import { WideDialog, type WideDialogSection, DialogSection } from "../../../components/dialogs";
import { SegmentedField, TagInput } from "../../../components/form";
import { FieldRow } from "../../../components/FieldRow";
import { IconButton } from "../../../components/IconButton";
import { SelectField } from "../../../components/SelectField";
import { formatBytes } from "../../../lib/format";
import { getErrorMessage } from "../../../lib/errors";

type FieldErrors = Partial<Record<string, string>>;

/** "none" sentinels — a "no difficulty" / "no reference logic" choice mapped back to `undefined` on
 *  save. `SegmentedField` is single-select-sticky, so "none" is a real, selectable segment. */
type DifficultyChoice = "none" | Difficulty;
type ReferenceLogicChoice = "none" | ReferenceLogicKind;

/** Structured expected-value: field/value rows (implicit `equals`) OR a raw-JSON escape hatch. */
type ExpectedMode = "fields" | "json";
type ExpectedField = { field: string; value: string };

const DIFFICULTY_OPTIONS = [
  { value: "none", label: "Unset" },
  { value: "easy", label: "Easy" },
  { value: "medium", label: "Medium" },
  { value: "hard", label: "Hard" },
];

const REFERENCE_LOGIC_OPTIONS = [
  { value: "none", label: "None" },
  { value: "code", label: "Code" },
  { value: "text", label: "Text" },
];

const REFERENCE_LOGIC_HELP: Record<ReferenceLogicChoice, string> = {
  none: "No reference solution — the trajectory judge scores against the prompt alone.",
  code: "A reference solution in code, handed to the trajectory judge as a document (never executed).",
  text: "A reference approach in prose, handed to the trajectory judge as a document.",
};

/** Which WideDialog section owns each validated field — so a submit error can jump to it. */
type SectionId = "basics" | "grading" | "metadata" | "attachments";
const SECTION_FOR_FIELD: Record<string, SectionId> = {
  name: "basics",
  userPrompt: "basics",
  systemPromptOverride: "basics",
  addedProfiles: "basics",
  expectedValue: "grading",
  expectations: "grading",
  assertions: "grading",
  category: "metadata",
  difficulty: "metadata",
  tags: "metadata",
};

type FormState = {
  name: string;
  userPrompt: string;
  systemPromptOverride: string;
  addedProfiles: TokenProfileRef[];
  assertions: TestAssertions;
  // B1 (Benchmarks) — ground-truth/grading block + analytics metadata. All optional; a test with none
  // saves exactly as before. `answerable` defaults on (only stored when explicitly turned off).
  expectedInsight: string;
  // Structured expected value (F5/S11): `expectedFields` rows in "fields" mode, `expectedJson` raw
  // text in the JSON escape hatch. Only the active `expectedMode` is read on save.
  expectedMode: ExpectedMode;
  expectedFields: ExpectedField[];
  expectedJson: string;
  refKind: ReferenceLogicChoice;
  refLanguage: string;
  refBody: string;
  rubricOverride: string;
  answerable: boolean;
  category: string;
  difficulty: DifficultyChoice;
  tags: string[];
};

/** An attachment picked but NOT yet uploaded — staged in memory, persisted only on Save. */
type StagedAttachment = { tempId: string; file: File; kind: AttachmentKind };

const EMPTY: FormState = {
  name: "",
  userPrompt: "",
  systemPromptOverride: "",
  addedProfiles: [],
  assertions: {},
  expectedInsight: "",
  expectedMode: "fields",
  expectedFields: [],
  expectedJson: "",
  refKind: "none",
  refLanguage: "",
  refBody: "",
  rubricOverride: "",
  answerable: true,
  category: "",
  difficulty: "none",
  tags: [],
};

/** Field ids in submit order — drives focus-first-error (interaction-guidelines). */
const FIELD_ORDER: { key: string; id: string }[] = [
  { key: "name", id: "test-name" },
  { key: "userPrompt", id: "test-prompt" },
  { key: "expectedValue", id: "test-expected-json" },
];

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Parse a field value cell as a JSON literal (number/bool/null/quoted string); unquoted text falls
 *  back to the raw string, so authors don't have to quote plain words. */
function parseFieldValue(raw: string): unknown {
  const trimmed = raw.trim();
  if (trimmed === "") return "";
  try {
    return JSON.parse(trimmed);
  } catch {
    return raw;
  }
}

function fromTest(test: Test): FormState {
  const expectations = test.expectations;
  const rawValue = expectations?.expectedValue;
  const hasValue = rawValue !== undefined;
  const objectValue = isPlainObject(rawValue);
  return {
    name: test.name,
    userPrompt: test.userPrompt,
    systemPromptOverride: test.systemPromptOverride ?? "",
    addedProfiles: test.addedProfiles,
    assertions: test.assertions ?? {},
    expectedInsight: expectations?.expectedInsight ?? "",
    // A plain object seeds the structured rows; anything else (array/scalar) opens the JSON hatch.
    expectedMode: hasValue && !objectValue ? "json" : "fields",
    expectedFields: objectValue
      ? Object.entries(rawValue).map(([field, value]) => ({ field, value: JSON.stringify(value) }))
      : [],
    expectedJson: hasValue ? JSON.stringify(rawValue, null, 2) : "",
    refKind: expectations?.referenceLogic?.kind ?? "none",
    refLanguage: expectations?.referenceLogic?.language ?? "",
    refBody: expectations?.referenceLogic?.body ?? "",
    rubricOverride: expectations?.rubricOverride ?? "",
    answerable: expectations?.answerable ?? true,
    category: test.category ?? "",
    difficulty: test.difficulty ?? "none",
    tags: [...test.tags],
  };
}

/** Resolve the active expected-value from the form: `{hasValue,value}` or a parse error. */
function resolveExpectedValue(
  form: FormState,
): { ok: true; hasValue: boolean; value: unknown } | { ok: false; message: string } {
  if (form.expectedMode === "json") {
    const raw = form.expectedJson.trim();
    if (!raw) return { ok: true, hasValue: false, value: undefined };
    try {
      return { ok: true, hasValue: true, value: JSON.parse(raw) };
    } catch {
      return { ok: false, message: "Enter valid JSON, or switch to structured fields." };
    }
  }
  const rows = form.expectedFields.filter((row) => row.field.trim());
  if (rows.length === 0) return { ok: true, hasValue: false, value: undefined };
  const value: Record<string, unknown> = {};
  for (const row of rows) value[row.field.trim()] = parseFieldValue(row.value);
  return { ok: true, hasValue: true, value };
}

/**
 * Assemble the optional {@link TestExpectations} block from the form. `expectedValue` is passed in
 * PRE-RESOLVED — `hasValue` distinguishes an omitted value from a legitimate `false`/`0`/`null`.
 * `answerable` is only stored when explicitly turned off. Returns `undefined` when every facet is
 * empty, so a test with no expectations saves exactly as before.
 */
function buildExpectations(
  form: FormState,
  expectedValue: { hasValue: boolean; value: unknown },
): TestExpectations | undefined {
  const referenceLogic =
    form.refKind !== "none" && form.refBody.trim()
      ? {
          kind: form.refKind,
          ...(form.refLanguage.trim() ? { language: form.refLanguage.trim() } : {}),
          body: form.refBody,
        }
      : undefined;
  const expectations: TestExpectations = {
    ...(form.expectedInsight.trim() ? { expectedInsight: form.expectedInsight } : {}),
    ...(expectedValue.hasValue ? { expectedValue: expectedValue.value } : {}),
    ...(referenceLogic ? { referenceLogic } : {}),
    ...(form.answerable === false ? { answerable: false } : {}),
    ...(form.rubricOverride.trim() ? { rubricOverride: form.rubricOverride } : {}),
  };
  return Object.keys(expectations).length > 0 ? expectations : undefined;
}

/** Drop empty assertion arrays / a false switch so a test with no real assertions sends `undefined`. */
function normalizeAssertions(assertions: TestAssertions): TestAssertions | undefined {
  const skillGates = assertions.skillGates?.filter((g) => g.skillId && g.nodeId);
  const skillRoutes = assertions.skillRoutes?.filter(
    (r) => r.skillId && r.gatekeeperId && r.expectedEdgeId,
  );
  const next: TestAssertions = {
    ...(skillGates && skillGates.length > 0 ? { skillGates } : {}),
    ...(skillRoutes && skillRoutes.length > 0 ? { skillRoutes } : {}),
    ...(assertions.noFractures === true ? { noFractures: true } : {}),
  };
  return Object.keys(next).length > 0 ? next : undefined;
}

function toInput(form: FormState, expectedValue: { hasValue: boolean; value: unknown }): TestInput {
  const override = form.systemPromptOverride.trim();
  const assertions = normalizeAssertions(form.assertions);
  const expectations = buildExpectations(form, expectedValue);
  const tags = form.tags.map((tag) => tag.trim()).filter(Boolean);
  return {
    name: form.name.trim(),
    userPrompt: form.userPrompt,
    ...(override ? { systemPromptOverride: form.systemPromptOverride } : {}),
    addedProfiles: form.addedProfiles,
    ...(assertions ? { assertions } : {}),
    ...(expectations ? { expectations } : {}),
    ...(form.category.trim() ? { category: form.category.trim() } : {}),
    ...(form.difficulty !== "none" ? { difficulty: form.difficulty } : {}),
    tags,
  };
}

/** Coarse attachment-kind classification from the browser File's MIME type. */
function kindFor(file: File): AttachmentKind {
  if (file.type.startsWith("image/")) return "image";
  if (file.type.startsWith("text/") || file.type === "application/json") return "text";
  return "file";
}

/** Read a File as bare base64 (strip the `data:…;base64,` prefix the FileReader adds). */
function readBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error ?? new Error("Couldn’t read the file. Try a different file."));
    reader.readAsDataURL(file);
  });
}

export function TestEditor(props: {
  open: boolean;
  test: Test | null;
  onOpenChange: (open: boolean) => void;
  /** Persist the test (create or update); returns the saved Test so attachments can target its id. */
  onSave: (input: TestInput, existing: Test | null) => Promise<Test>;
  /** Upload one attachment to an already-saved test. */
  onAddAttachment: (testId: string, input: TestAttachmentInput) => Promise<TestAttachment>;
  /**
   * Benchmarks (WP 4.3) — collections to (re)assign this test to. When provided the editor shows a
   * small collection picker; assignment is an immediate write (only for an already-saved test), so
   * `onSetCollection` is called with the test id, the chosen collection (or null to detach) and the
   * previously-applied collection (needed to key the detach route).
   */
  collections?: Collection[];
  onSetCollection?: (
    testId: string,
    toCollectionId: string | null,
    fromCollectionId: string | null,
  ) => Promise<void>;
}) {
  const { open, test, collections, onSetCollection } = props;
  const NO_COLLECTION = "none";
  const [collectionChoice, setCollectionChoice] = useState<string>(NO_COLLECTION);
  // The last collection this test was assigned to in-session — needed to key a detach (the API's
  // Test payload doesn't carry `collectionId`, so we track the applied value ourselves).
  const [appliedCollection, setAppliedCollection] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [activeSection, setActiveSection] = useState<SectionId>("basics");
  // The persisted test the attachments section targets — the passed `test`, or the one just created.
  const [savedTest, setSavedTest] = useState<Test | null>(test);
  const [attachments, setAttachments] = useState<TestAttachment[]>(test?.attachments ?? []);
  // Files picked this session but not yet uploaded (staged in memory; uploaded on Save).
  const [staged, setStaged] = useState<StagedAttachment[]>([]);
  const [files, setFiles] = useState<UploadFile[]>([]);
  // A snapshot of the form at open, for the dirty check.
  const [baseline, setBaseline] = useState<string>("");

  const editing = Boolean(savedTest);

  useEffect(() => {
    if (!open) return;
    const next = test ? fromTest(test) : EMPTY;
    setForm(next);
    setBaseline(JSON.stringify(next));
    setSavedTest(test);
    setAttachments(test?.attachments ?? []);
    setStaged([]);
    setFiles([]);
    setErrors({});
    setFormError(null);
    setSaving(false);
    setUploading(false);
    setActiveSection("basics");
    const seeded = test?.collectionId ?? null;
    setCollectionChoice(seeded ?? NO_COLLECTION);
    setAppliedCollection(seeded);
  }, [open, test]);

  // Immediate-write collection (re)assignment. Only actionable for an ALREADY-saved test (the
  // membership API keys off a persisted id); a brand-new test enables the picker after its first save.
  async function changeCollection(choice: string) {
    setCollectionChoice(choice);
    if (!savedTest || !onSetCollection) return;
    const to = choice === NO_COLLECTION ? null : choice;
    const from = appliedCollection;
    if (to === from) return;
    try {
      await onSetCollection(savedTest.id, to, from);
      setAppliedCollection(to);
    } catch {
      // The handler surfaces its own toast; revert the picker to the last applied value.
      setCollectionChoice(appliedCollection ?? NO_COLLECTION);
    }
  }

  const dirty = JSON.stringify(form) !== baseline || staged.length > 0;

  function patch<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  // Toggle the expected-value editor mode, carrying content across so a switch never silently drops
  // what was typed: fields → JSON serializes the current object; JSON → fields hydrates rows from a
  // plain object.
  function changeExpectedMode(mode: ExpectedMode) {
    setForm((current) => {
      if (mode === current.expectedMode) return current;
      if (mode === "json") {
        const rows = current.expectedFields.filter((row) => row.field.trim());
        if (current.expectedJson.trim() === "" && rows.length > 0) {
          const obj: Record<string, unknown> = {};
          for (const row of rows) obj[row.field.trim()] = parseFieldValue(row.value);
          return { ...current, expectedMode: mode, expectedJson: JSON.stringify(obj, null, 2) };
        }
        return { ...current, expectedMode: mode };
      }
      // → fields
      if (current.expectedFields.length === 0 && current.expectedJson.trim()) {
        try {
          const parsed: unknown = JSON.parse(current.expectedJson);
          if (isPlainObject(parsed)) {
            return {
              ...current,
              expectedMode: mode,
              expectedFields: Object.entries(parsed).map(([field, value]) => ({
                field,
                value: JSON.stringify(value),
              })),
            };
          }
        } catch {
          // Non-object / invalid JSON: leave rows empty, the hatch keeps its text.
        }
      }
      return { ...current, expectedMode: mode };
    });
    setErrors((e) => ({ ...e, expectedValue: undefined }));
  }

  function focusFirstError(next: FieldErrors) {
    const first = FIELD_ORDER.find((field) => next[field.key]);
    if (first) {
      const section = SECTION_FOR_FIELD[first.key];
      if (section) setActiveSection(section);
      // Defer focus until after the section switch has rendered the field.
      requestAnimationFrame(() => document.getElementById(first.id)?.focus());
    }
  }

  async function save(): Promise<Test | null> {
    // Resolve the structured expected value first — a malformed JSON hatch is a field error.
    const resolved = resolveExpectedValue(form);
    if (!resolved.ok) {
      const next: FieldErrors = { expectedValue: resolved.message };
      setErrors(next);
      setFormError("Fix the highlighted fields and try again.");
      focusFirstError(next);
      return null;
    }

    const input = toInput(form, { hasValue: resolved.hasValue, value: resolved.value });
    const parsed = testInputSchema.safeParse(input);
    if (!parsed.success) {
      const next: FieldErrors = {};
      for (const issue of parsed.error.issues) {
        const key = String(issue.path[0] ?? "form");
        if (!next[key]) next[key] = issue.message;
      }
      setErrors(next);
      setFormError("Fix the highlighted fields and try again.");
      // Jump to the section owning the first errored field.
      const firstKey = Object.keys(next)[0];
      const section = firstKey ? SECTION_FOR_FIELD[firstKey] : undefined;
      if (section) setActiveSection(section);
      focusFirstError(next);
      return null;
    }

    setErrors({});
    setFormError(null);
    setSaving(true);
    try {
      const saved = await props.onSave(parsed.data, savedTest);
      setSavedTest(saved);
      setAttachments(saved.attachments);

      // Persist any staged attachments now that we have a test id. Successful uploads are reflected
      // (and dropped from `staged`) one by one, so a mid-list failure leaves the rest staged with a
      // clear error rather than silently losing them.
      if (staged.length > 0) {
        setUploading(true);
        try {
          for (const entry of staged) {
            const base64 = await readBase64(entry.file);
            const created = await props.onAddAttachment(saved.id, {
              kind: entry.kind,
              name: entry.file.name,
              contentBase64: base64,
            });
            setAttachments((current) => [...current, created]);
            setStaged((current) => current.filter((item) => item.tempId !== entry.tempId));
          }
        } finally {
          setUploading(false);
        }
      }

      // Reset the dirty baseline to the just-saved state.
      setBaseline(JSON.stringify(form));
      return saved;
    } catch (error) {
      setFormError(`Couldn’t save the test. ${getErrorMessage(error)} Try again.`);
      return null;
    } finally {
      setSaving(false);
    }
  }

  async function saveAndClose() {
    // `save()` returns the saved test only when the test AND every staged attachment persisted (a
    // failed upload throws → caught → null). On that full success, close DIRECTLY (the form is no
    // longer dirty, so the WideDialog guard won't prompt).
    const saved = await save();
    if (saved) props.onOpenChange(false);
  }

  /** Stage newly-picked files in memory. Nothing uploads until Save. */
  function handleFilesChange(next: UploadFile[]) {
    if (next.length === 0) return;
    setStaged((current) => [
      ...current,
      ...next.map((entry) => ({ tempId: entry.id, file: entry.file, kind: kindFor(entry.file) })),
    ]);
    // The staged list below is the source of truth; clear the dropzone buffer.
    setFiles([]);
  }

  function removeStaged(tempId: string) {
    setStaged((current) => current.filter((item) => item.tempId !== tempId));
  }

  const errorBanner = formError ? (
    <Alert variant="destructive">
      <AlertDescription>{formError}</AlertDescription>
    </Alert>
  ) : null;

  // ── Section content ─────────────────────────────────────────────────────────────────────────
  const basicsContent = (
    <div className="flex flex-col gap-5">
      {errorBanner}
      <FieldRow id="test-name" label="Name" error={errors.name}>
        <Input
          id="test-name"
          value={form.name}
          placeholder="Summarize Q3 incidents…"
          aria-invalid={errors.name ? true : undefined}
          onChange={(event) => patch("name", event.target.value)}
        />
      </FieldRow>

      <FieldRow id="test-prompt" label="User prompt" error={errors.userPrompt}>
        <Textarea
          id="test-prompt"
          rows={5}
          value={form.userPrompt}
          placeholder="Summarize the Q3 incident reports and rank them by severity…"
          aria-invalid={errors.userPrompt ? true : undefined}
          onChange={(event) => patch("userPrompt", event.target.value)}
        />
      </FieldRow>

      <FieldRow id="test-override" label="System prompt override">
        <Textarea
          id="test-override"
          rows={3}
          value={form.systemPromptOverride}
          placeholder="Leave empty to use the environment's system prompt…"
          onChange={(event) => patch("systemPromptOverride", event.target.value)}
        />
        <Text variant="meta" tone="muted">
          Per-test override. When empty, the environment's system prompt is used.
        </Text>
      </FieldRow>

      <div className="flex flex-col gap-1.5">
        <Label id="test-profiles-label">Added token profiles</Label>
        <TokenProfileField
          value={form.addedProfiles}
          onChange={(next) => patch("addedProfiles", next)}
          ariaLabel="Added token profiles"
        />
        <Text variant="meta" tone="muted">
          Extra estimator lenses for this test, on top of the environment's defaults.
        </Text>
      </div>
    </div>
  );

  const gradingContent = (
    <div className="flex flex-col gap-6">
      {errorBanner}
      <DialogSection
        title="Expectations"
        description="Ground truth for the output-quality graders. Every field is optional — a test with none grades and saves exactly as before."
      >
        <div className="flex items-center justify-between gap-4">
          <div className="flex min-w-0 flex-col">
            <Label htmlFor="test-answerable">Answerable</Label>
            <Text variant="meta" tone="muted">
              Turn off to mark this as an intentionally unanswerable question.
            </Text>
          </div>
          <Switch
            id="test-answerable"
            checked={form.answerable}
            onCheckedChange={(checked) => patch("answerable", checked)}
            aria-label="Answerable"
          />
        </div>

        <FieldRow id="test-expected-insight" label="Expected insight">
          <Textarea
            id="test-expected-insight"
            rows={3}
            value={form.expectedInsight}
            placeholder="The reference answer the ROUGE-1 and outcome-judge graders score against…"
            onChange={(event) => patch("expectedInsight", event.target.value)}
          />
        </FieldRow>

        <ExpectedValueEditor
          mode={form.expectedMode}
          fields={form.expectedFields}
          json={form.expectedJson}
          error={errors.expectedValue}
          onModeChange={changeExpectedMode}
          onFieldsChange={(next) => {
            patch("expectedFields", next);
            setErrors((e) => ({ ...e, expectedValue: undefined }));
          }}
          onJsonChange={(next) => {
            patch("expectedJson", next);
            setErrors((e) => ({ ...e, expectedValue: undefined }));
          }}
          onValidate={() => {
            const resolved = resolveExpectedValue(form);
            setErrors((e) => ({
              ...e,
              expectedValue: resolved.ok ? undefined : resolved.message,
            }));
          }}
        />

        {/* Reference logic — a reference solution handed to the trajectory judge as a DOCUMENT,
            never executed (B15). */}
        <div className="flex flex-col gap-3 rounded-md border border-border p-3">
          <SegmentedField
            id="test-ref-kind"
            label="Reference logic"
            value={form.refKind}
            options={REFERENCE_LOGIC_OPTIONS}
            help={REFERENCE_LOGIC_HELP[form.refKind]}
            onChange={(value) => patch("refKind", value as ReferenceLogicChoice)}
          />
          {form.refKind === "code" ? (
            <FieldRow id="test-ref-language" label="Language">
              <Input
                id="test-ref-language"
                value={form.refLanguage}
                placeholder="python, sql…"
                spellCheck={false}
                onChange={(event) => patch("refLanguage", event.target.value)}
              />
            </FieldRow>
          ) : null}
          {form.refKind !== "none" ? (
            <FieldRow id="test-ref-body" label={form.refKind === "code" ? "Code" : "Text"}>
              <Textarea
                id="test-ref-body"
                rows={4}
                className={form.refKind === "code" ? "font-mono" : undefined}
                spellCheck={form.refKind === "code" ? false : undefined}
                value={form.refBody}
                placeholder={
                  form.refKind === "code"
                    ? "The reference solution's code…"
                    : "The reference approach, in prose…"
                }
                onChange={(event) => patch("refBody", event.target.value)}
              />
            </FieldRow>
          ) : null}
        </div>

        <FieldRow id="test-rubric" label="Judge rubric override">
          <Textarea
            id="test-rubric"
            rows={3}
            value={form.rubricOverride}
            placeholder="Optional — replaces the default outcome-judge rubric for this test…"
            onChange={(event) => patch("rubricOverride", event.target.value)}
          />
        </FieldRow>
      </DialogSection>

      {/* WP 5.1 — validation-gate assertions, evaluated headlessly from the run's trace alignment. */}
      <AssertionsEditor value={form.assertions} onChange={(next) => patch("assertions", next)} />
    </div>
  );

  const metadataContent = (
    <div className="flex flex-col gap-5">
      {errorBanner}
      {/* Benchmarks (WP 4.3) — collection membership. Assignment is an immediate write, so it's only
          actionable once the test is saved; a synced collection materializes it to git. */}
      {collections ? (
        <div className="flex flex-col gap-1.5">
          <SelectField
            id="test-collection"
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
              ? "Assign this test to a git-backed collection — its members sync to the repo."
              : "Save the test first, then assign it to a collection."}
          </Text>
        </div>
      ) : null}

      <SegmentedField
        id="test-difficulty"
        label="Difficulty"
        value={form.difficulty}
        options={DIFFICULTY_OPTIONS}
        help="Used to slice analytics; leave Unset if it doesn't apply."
        onChange={(value) => patch("difficulty", value as DifficultyChoice)}
      />

      <FieldRow id="test-category" label="Category">
        <Input
          id="test-category"
          value={form.category}
          placeholder="e.g. finance-summarization…"
          spellCheck={false}
          onChange={(event) => patch("category", event.target.value)}
        />
      </FieldRow>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="test-tags">Tags</Label>
        <TagInput
          value={form.tags}
          onChange={(next) => patch("tags", next)}
          placeholder="Add a tag…"
          aria-label="Tags"
        />
        <Text variant="meta" tone="muted">
          Press Enter or comma to add a chip. Used to slice analytics by tag.
        </Text>
      </div>
    </div>
  );

  const attachmentsContent = (
    <div className="flex flex-col gap-3">
      {errorBanner}
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 flex-col">
          <Label>Attachments</Label>
          <Text variant="meta" tone="muted">
            Files are staged here and uploaded when you save the test — nothing is persisted until
            then.
          </Text>
        </div>
        {uploading ? <Spinner className="size-4" /> : null}
      </div>

      {/* Already-persisted attachments (from a previously-saved test). */}
      {attachments.length > 0 ? (
        <ul className="flex flex-col gap-1.5">
          {attachments.map((attachment) => (
            <li
              key={attachment.id}
              className="flex items-center justify-between gap-3 rounded-md border border-border bg-muted/40 px-2.5 py-1.5"
            >
              <span className="flex min-w-0 items-center gap-2">
                <Paperclip className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                <span className="min-w-0 truncate">{attachment.name}</span>
                <Badge variant="secondary">{attachment.kind}</Badge>
              </span>
              <Text variant="meta" tone="muted" className="shrink-0 tabular-nums">
                {formatBytes(attachment.bytes)}
              </Text>
            </li>
          ))}
        </ul>
      ) : null}

      {/* Staged (pending) attachments — removable before save. */}
      {staged.length > 0 ? (
        <ul className="flex flex-col gap-1.5">
          {staged.map((entry) => (
            <li
              key={entry.tempId}
              className="flex items-center justify-between gap-3 rounded-md border border-dashed border-border bg-muted/20 px-2.5 py-1.5"
            >
              <span className="flex min-w-0 items-center gap-2">
                <Paperclip className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                <span className="min-w-0 truncate">{entry.file.name}</span>
                <Badge variant="outline">pending</Badge>
              </span>
              <span className="flex shrink-0 items-center gap-2">
                <Text variant="meta" tone="muted" className="tabular-nums">
                  {formatBytes(entry.file.size)}
                </Text>
                <IconButton
                  variant="ghost"
                  size="sm"
                  label={`Remove ${entry.file.name}`}
                  disabled={saving || uploading}
                  onClick={() => removeStaged(entry.tempId)}
                >
                  <X aria-hidden />
                </IconButton>
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      <FileUpload files={files} onFilesChange={handleFilesChange} disabled={saving || uploading}>
        <FileUploadDropzone browseLabel="Browse for an attachment" />
      </FileUpload>
    </div>
  );

  const sections: WideDialogSection[] = [
    { id: "basics", label: "Basics", icon: <FileText aria-hidden />, content: basicsContent },
    {
      id: "grading",
      label: "Grading",
      icon: <ClipboardCheck aria-hidden />,
      content: gradingContent,
    },
    { id: "metadata", label: "Metadata", icon: <Tags aria-hidden />, content: metadataContent },
    {
      id: "attachments",
      label: "Attachments",
      icon: <Paperclip aria-hidden />,
      content: attachmentsContent,
    },
  ];

  const stagedNote =
    staged.length > 0 ? (
      <span className="tabular-nums">
        {staged.length} attachment{staged.length === 1 ? "" : "s"} staged — uploaded on save
      </span>
    ) : null;

  return (
    <WideDialog
      open={open}
      onOpenChange={props.onOpenChange}
      title={editing ? "Edit test" : "New test"}
      description="A test is a reusable prompt (plus optional system override, attachments, and extra token profiles) run against an environment."
      sections={sections}
      nav="rail"
      activeSectionId={activeSection}
      onActiveSectionChange={(id) => setActiveSection(id as SectionId)}
      dirty={dirty}
      busy={saving || uploading}
      primaryLabel={editing ? "Save test" : "Create test"}
      onSubmit={() => void saveAndClose()}
      footerStart={stagedNote}
    />
  );
}

/**
 * Structured expected-value editor (F5/S11) — the replacement for the raw-JSON textarea. In
 * **Fields** mode each row is `field · equals · value`, where the value cell is parsed as a JSON
 * literal (numbers, `true`/`false`, quoted strings) and unquoted text is kept as a string. The
 * **JSON** segment is the escape hatch for arrays / scalars / nested shapes the value-match grader
 * also accepts; it's validated on blur.
 */
function ExpectedValueEditor(props: {
  mode: ExpectedMode;
  fields: ExpectedField[];
  json: string;
  error?: string;
  onModeChange: (mode: ExpectedMode) => void;
  onFieldsChange: (next: ExpectedField[]) => void;
  onJsonChange: (next: string) => void;
  onValidate: () => void;
}) {
  const { mode, fields, json, error } = props;

  function updateRow(index: number, patch: Partial<ExpectedField>) {
    props.onFieldsChange(fields.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }
  function addRow() {
    props.onFieldsChange([...fields, { field: "", value: "" }]);
  }
  function removeRow(index: number) {
    props.onFieldsChange(fields.filter((_, i) => i !== index));
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Label htmlFor="test-expected-mode">Expected value</Label>
        <SegmentedField
          id="test-expected-mode"
          label="Value format"
          className="[&>label]:sr-only"
          value={mode}
          options={[
            { value: "fields", label: "Structured" },
            { value: "json", label: "JSON" },
          ]}
          onChange={(value) => props.onModeChange(value as ExpectedMode)}
        />
      </div>

      {mode === "fields" ? (
        <div className="flex flex-col gap-2">
          {fields.length === 0 ? (
            <Text variant="meta" tone="muted">
              No fields yet — add a row for each value the answer must contain, or switch to JSON.
            </Text>
          ) : (
            <ul className="flex flex-col gap-2">
              {fields.map((row, index) => (
                // Positional rows keyed by index — no reordering, so the index is stable.
                <li key={index} className="flex items-center gap-2">
                  <Input
                    value={row.field}
                    onChange={(e) => updateRow(index, { field: e.target.value })}
                    placeholder="field"
                    spellCheck={false}
                    autoComplete="off"
                    aria-label={`Field ${index + 1}`}
                    className="min-w-0 flex-1"
                  />
                  <Badge variant="outline" className="shrink-0 font-normal">
                    equals
                  </Badge>
                  <Input
                    value={row.value}
                    onChange={(e) => updateRow(index, { value: e.target.value })}
                    onBlur={props.onValidate}
                    placeholder={'1200000 or "text"'}
                    spellCheck={false}
                    autoComplete="off"
                    aria-label={`Value ${index + 1}`}
                    className="min-w-0 flex-1 font-mono"
                  />
                  <IconButton
                    type="button"
                    variant="ghost"
                    size="icon"
                    label={`Remove field ${index + 1}`}
                    onClick={() => removeRow(index)}
                    className="shrink-0"
                  >
                    <Trash2 aria-hidden />
                  </IconButton>
                </li>
              ))}
            </ul>
          )}
          <Button type="button" variant="outline" size="sm" className="w-fit" onClick={addRow}>
            <Plus aria-hidden />
            <span>Add field</span>
          </Button>
          <Text variant="meta" tone="muted">
            Each field must equal the value. Values are read as JSON (numbers, true/false, quoted
            strings); plain text is kept as a string.
          </Text>
        </div>
      ) : (
        <div className="flex flex-col gap-1.5">
          <Textarea
            id="test-expected-json"
            rows={5}
            className="font-mono"
            spellCheck={false}
            value={json}
            placeholder={'Structured ground truth, e.g. { "revenue": 1200000 } or [1, 2, 3]'}
            aria-invalid={error ? true : undefined}
            onChange={(e) => props.onJsonChange(e.target.value)}
            onBlur={props.onValidate}
          />
          <Text variant="meta" tone="muted">
            Must be valid JSON. Leave empty for no structured expected value.
          </Text>
        </div>
      )}

      {error ? (
        <Text variant="meta" className="text-destructive" role="alert">
          {error}
        </Text>
      ) : null}
    </div>
  );
}
