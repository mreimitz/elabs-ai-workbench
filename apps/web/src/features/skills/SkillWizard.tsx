import { useEffect, useState } from "react";
import type { Skill, SkillRepoProbe } from "@mcp-token-footprint/shared";
import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  Descriptions,
  DescriptionsItem,
  FileUpload,
  FileUploadDropzone,
  FileUploadItem,
  FileUploadList,
  Input,
  Label,
  Text,
  Textarea,
  ToggleGroup,
  ToggleGroupItem,
  cn,
  type UploadFile,
} from "@elabs-ai/components-ui";
import { FileArchive, FilePlus2, Github, Save, Search, ServerCog, Upload } from "lucide-react";
import { formatBytes } from "../../lib/format";
import { getErrorMessage } from "../../lib/errors";
import { FieldRow } from "../../components/FieldRow";
import { WideDialog, type WideDialogSection } from "../../components/dialogs";
import { DiscardChangesDialog, useUnsavedChangesGuard } from "../../components/UnsavedChangesGuard";

type Source = "upload" | "github" | "blank" | "server";
type WizardStep = "source" | "detail" | "review";

// Accept a .zip archive or a bare SKILL.md (matches the API's upload ingestion).
const UPLOAD_ACCEPT = ".zip,.md";

// Mirrors the API's manifest name rule (research/skill-registry/01-agent-skills-format.md,
// apps/api/src/skills/manifest.ts) — lowercase letters/digits, single hyphens, no leading/
// trailing/consecutive hyphens. Client-side so the wizard can gate "Continue" and show an inline
// hint instead of round-tripping to the API just to learn the name is invalid.
const BLANK_NAME_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export type SkillWizardProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Create a skill from an uploaded `.zip`/`SKILL.md`. Resolves to the new skill. */
  onCreateUpload: (file: File, displayName?: string) => Promise<Skill>;
  /** Probe a GitHub repo/ref for SKILL.md dirs (no persistence). */
  onProbeRepo: (repoUrl: string, ref: string, token?: string) => Promise<SkillRepoProbe>;
  /** Create a skill from a discovered GitHub subpath. Resolves to the new skill. */
  onCreateGithub: (input: {
    repoUrl: string;
    ref: string;
    subpath: string;
    token?: string;
    displayName?: string;
  }) => Promise<Skill>;
  /**
   * Create a skill from the Blank source (SkillFlow D3): name + description scaffold a minimal
   * `SKILL.md`, registered as version 1. Resolves to the new skill. Optional so a parent that
   * hasn't wired the callback yet still renders (and typechecks) unchanged — the Blank card is
   * hidden in that case.
   */
  onCreateBlank?: (input: {
    name: string;
    description: string;
    displayName?: string;
  }) => Promise<Skill>;
  /**
   * D-UX1 (K6) — the "From server" source. Server-scaffold is a rich multi-step flow of its own
   * (pick server → select tools → name), so selecting this tile HANDS OFF to the dedicated
   * `ScaffoldFromServerWizard` (the parent closes this modal and opens that one). Optional so a parent
   * that hasn't wired it renders unchanged — the "From server" tile is hidden in that case.
   */
  onUseServerSource?: () => void;
};

/**
 * The add-skill wizard (UI plan §3): a multi-step `Dialog` mirroring `ServerWizard`.
 * - Step 1 (Source): an Upload / GitHub / Blank `ToggleGroup`.
 * - Step 2a (Upload): a `@elabs-ai/components-*` `FileUpload` dropzone (`.zip` or `SKILL.md`) + optional display name.
 * - Step 2b (GitHub): repo URL + ref + optional PAT → "Discover" (`probe`) → pick a candidate subpath.
 * - Step 2c (Blank, SkillFlow D3): name + description (+ optional display name) — the API scaffolds
 *   a minimal, spec-valid `SKILL.md` and registers it as version 1, immediately inspectable.
 * - Step 3 (Review): a `Descriptions` summary → create → the parent toasts + selects the new skill.
 *
 * All network/git/secret work stays in the API; the wizard only sends redacted requests and hands
 * the created `Skill` back to the parent via the create callbacks.
 */
export function SkillWizard(props: SkillWizardProps) {
  const [source, setSource] = useState<Source>("upload");
  const [step, setStep] = useState<WizardStep>("source");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState("");

  // Upload state — the brand-ui FileUpload is controlled; we read the single picked File from it.
  const [files, setFiles] = useState<UploadFile[]>([]);
  const pickedFile = files[0]?.file ?? null;

  // GitHub state.
  const [repoUrl, setRepoUrl] = useState("");
  const [ref, setRef] = useState("main");
  const [token, setToken] = useState("");
  const [probe, setProbe] = useState<SkillRepoProbe | null>(null);
  const [subpath, setSubpath] = useState<string | null>(null);

  // Blank state (SkillFlow D3) — name + description scaffold the SKILL.md; displayName is shared
  // with the other two sources above.
  const [blankName, setBlankName] = useState("");
  const [blankDescription, setBlankDescription] = useState("");
  const blankNameTrimmed = blankName.trim();
  const blankNameValid = BLANK_NAME_PATTERN.test(blankNameTrimmed);
  const blankNameError =
    blankNameTrimmed.length > 0 && !blankNameValid
      ? "Use lowercase letters, digits, and single hyphens (e.g. my-skill)."
      : undefined;
  const blankDescriptionTrimmed = blankDescription.trim();

  // Reset everything each time the dialog opens so a second run starts clean.
  useEffect(() => {
    if (!props.open) return;
    setSource("upload");
    setStep("source");
    setBusy(null);
    setError(null);
    setDisplayName("");
    setFiles([]);
    setRepoUrl("");
    setRef("main");
    setToken("");
    setProbe(null);
    setSubpath(null);
    setBlankName("");
    setBlankDescription("");
  }, [props.open]);

  const detailLabel =
    source === "upload"
      ? "Upload"
      : source === "github"
        ? "GitHub"
        : source === "server"
          ? "From server"
          : "Blank skill";
  const steps = [
    { id: "source", label: "Source" },
    { id: "detail", label: detailLabel },
    { id: "review", label: "Review" },
  ];

  const selectedCandidate =
    probe?.candidates.find((candidate) => candidate.subpath === subpath) ?? null;

  // Dirty = the user has entered any input (so closing mid-add warns). Ref defaults to "main", so an
  // untouched form is not dirty.
  const dirty =
    displayName.trim() !== "" ||
    files.length > 0 ||
    repoUrl.trim() !== "" ||
    ref.trim() !== "main" ||
    token.trim() !== "" ||
    subpath !== null ||
    blankNameTrimmed !== "" ||
    blankDescriptionTrimmed !== "";
  const guard = useUnsavedChangesGuard(dirty, props.onOpenChange);

  async function runProbe() {
    setBusy("probe");
    setError(null);
    setProbe(null);
    setSubpath(null);
    try {
      const result = await props.onProbeRepo(
        repoUrl.trim(),
        ref.trim() || "main",
        token.trim() || undefined,
      );
      setProbe(result);
      if (!result.ok) {
        setError(result.errorMessage ?? result.message);
      } else if (result.candidates.length === 0) {
        setError("No SKILL.md was found in this repository/ref.");
      } else {
        // Pre-select the first candidate for a single-skill repo.
        setSubpath(result.candidates[0]?.subpath ?? null);
      }
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function create() {
    setBusy("create");
    setError(null);
    try {
      if (source === "upload") {
        if (!pickedFile) throw new Error("Pick a .zip or SKILL.md file first.");
        await props.onCreateUpload(pickedFile, displayName.trim() || undefined);
      } else if (source === "github") {
        if (subpath === null) throw new Error("Pick a discovered skill first.");
        await props.onCreateGithub({
          repoUrl: repoUrl.trim(),
          ref: ref.trim() || "main",
          subpath,
          token: token.trim() || undefined,
          displayName: displayName.trim() || undefined,
        });
      } else {
        if (!props.onCreateBlank) throw new Error("Blank skill creation isn't available.");
        if (!blankNameValid) throw new Error("Enter a valid skill name first.");
        if (blankDescriptionTrimmed.length === 0) throw new Error("Enter a description first.");
        await props.onCreateBlank({
          name: blankNameTrimmed,
          description: blankDescriptionTrimmed,
          displayName: displayName.trim() || undefined,
        });
      }
      // The parent toasts + selects; just close on success.
      props.onOpenChange(false);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  // Gate the "Next" button per step so a user can't advance with an incomplete step.
  const canAdvanceDetail =
    source === "upload"
      ? Boolean(pickedFile)
      : source === "github"
        ? Boolean(probe?.ok) && subpath !== null
        : blankNameValid && blankDescriptionTrimmed.length > 0;

  const errorAlert = error ? (
    <Alert variant="destructive">
      <AlertDescription>{error}</AlertDescription>
    </Alert>
  ) : null;

  const sourceContent = (
    <div className="flex flex-col gap-4">
      {errorAlert}
      <div className="flex flex-col gap-1.5">
        <Label>Source</Label>
        <ToggleGroup
          type="single"
          variant="outline"
          value={source}
          onValueChange={(value) => {
            if (!value) return;
            setSource(value as Source);
            setError(null);
          }}
        >
          <ToggleGroupItem value="upload">
            <Upload aria-hidden />
            <span>Upload</span>
          </ToggleGroupItem>
          <ToggleGroupItem value="github">
            <Github aria-hidden />
            <span>GitHub</span>
          </ToggleGroupItem>
          <ToggleGroupItem value="blank">
            <FilePlus2 aria-hidden />
            <span>Blank skill</span>
          </ToggleGroupItem>
          {props.onUseServerSource ? (
            <ToggleGroupItem value="server">
              <ServerCog aria-hidden />
              <span>From server</span>
            </ToggleGroupItem>
          ) : null}
        </ToggleGroup>
        <Text variant="meta" tone="muted">
          {source === "upload"
            ? "Drop a .zip archive or a single SKILL.md file."
            : source === "github"
              ? "Discover skills in a public or private (PAT) repository."
              : source === "server"
                ? "Scaffold a skill from a scanned server's tool surface — pick the server, its tools, and a name."
                : "Start from a minimal, empty SKILL.md you grow from scratch."}
        </Text>
      </div>
    </div>
  );

  const detailContent = (
    <div className="flex flex-col gap-4">
      {errorAlert}
      {source === "upload" ? (
        <>
          <FileUpload
            accept={UPLOAD_ACCEPT}
            multiple={false}
            maxFiles={1}
            files={files}
            onFilesChange={setFiles}
          >
            <FileUploadDropzone browseLabel="Browse for a skill file">
              <div className="flex flex-col items-center gap-2 py-2 text-center">
                <FileArchive aria-hidden className="size-6 text-muted-foreground" />
                <Text className="font-medium">Drop a .zip or SKILL.md here</Text>
                <Text variant="meta" tone="muted">
                  or use the browse link to pick a file
                </Text>
              </div>
            </FileUploadDropzone>
            <FileUploadList>
              {files.map((uploadFile) => (
                <FileUploadItem key={uploadFile.id} uploadFile={uploadFile} />
              ))}
            </FileUploadList>
          </FileUpload>
          <FieldRow id="skill-upload-name" label="Display name (optional)">
            <Input
              id="skill-upload-name"
              value={displayName}
              placeholder="Derived from the file name if left blank…"
              autoComplete="off"
              spellCheck={false}
              onChange={(event) => setDisplayName(event.target.value)}
            />
          </FieldRow>
        </>
      ) : source === "github" ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <FieldRow id="skill-repo-url" label="Repository URL" wide>
              <Input
                id="skill-repo-url"
                value={repoUrl}
                placeholder="https://github.com/owner/repo…"
                type="url"
                inputMode="url"
                autoComplete="off"
                spellCheck={false}
                onChange={(event) => {
                  setRepoUrl(event.target.value);
                  setProbe(null);
                  setSubpath(null);
                }}
              />
            </FieldRow>
            <FieldRow id="skill-repo-ref" label="Ref (branch / tag / sha)">
              <Input
                id="skill-repo-ref"
                value={ref}
                placeholder="main"
                autoComplete="off"
                spellCheck={false}
                onChange={(event) => {
                  setRef(event.target.value);
                  setProbe(null);
                  setSubpath(null);
                }}
              />
            </FieldRow>
            <FieldRow id="skill-repo-pat" label="Personal access token (optional)">
              <Input
                id="skill-repo-pat"
                value={token}
                placeholder="For private repositories…"
                type="password"
                autoComplete="off"
                spellCheck={false}
                onChange={(event) => {
                  setToken(event.target.value);
                  setProbe(null);
                }}
              />
            </FieldRow>
          </div>

          <Button
            variant="outline"
            className="w-fit"
            disabled={Boolean(busy) || !repoUrl.trim()}
            onClick={() => void runProbe()}
          >
            <Search aria-hidden />
            <span>{busy === "probe" ? "Discovering…" : "Discover skills"}</span>
          </Button>

          {probe?.ok && probe.candidates.length > 0 ? (
            <div className="flex flex-col gap-1.5">
              <Label>Discovered skills</Label>
              <ul className="flex flex-col gap-1.5">
                {probe.candidates.map((candidate) => {
                  const selected = candidate.subpath === subpath;
                  return (
                    <li key={candidate.subpath || "__root__"}>
                      <Button
                        variant="outline"
                        className={cn(
                          "h-auto w-full flex-col items-start gap-1 rounded-md py-2 text-left",
                          selected && "border-primary ring-1 ring-ring",
                        )}
                        aria-pressed={selected}
                        onClick={() => setSubpath(candidate.subpath)}
                      >
                        <span className="flex min-w-0 items-center gap-2">
                          <Text className="min-w-0 truncate font-medium">
                            {candidate.name ?? candidate.subpath ?? "(repository root)"}
                          </Text>
                          <Badge variant="secondary" className="shrink-0 font-mono">
                            {candidate.subpath || "/"}
                          </Badge>
                        </span>
                        {candidate.description ? (
                          <Text variant="meta" tone="muted" className="line-clamp-2">
                            {candidate.description}
                          </Text>
                        ) : null}
                      </Button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}
        </>
      ) : (
        <>
          <FieldRow id="skill-blank-name" label="Name" error={blankNameError}>
            <Input
              id="skill-blank-name"
              value={blankName}
              placeholder="my-skill…"
              autoComplete="off"
              spellCheck={false}
              aria-invalid={blankNameError ? true : undefined}
              onChange={(event) => setBlankName(event.target.value)}
            />
          </FieldRow>
          <FieldRow id="skill-blank-display-name" label="Display name (optional)">
            <Input
              id="skill-blank-display-name"
              value={displayName}
              placeholder="Defaults to the name above if left blank…"
              autoComplete="off"
              spellCheck={false}
              onChange={(event) => setDisplayName(event.target.value)}
            />
          </FieldRow>
          <FieldRow id="skill-blank-description" label="Description">
            <Textarea
              id="skill-blank-description"
              rows={3}
              value={blankDescription}
              placeholder="What this skill will help with…"
              spellCheck={true}
              onChange={(event) => setBlankDescription(event.target.value)}
            />
          </FieldRow>
          <Text variant="meta" tone="muted">
            A minimal, spec-valid SKILL.md is scaffolded from these fields — an empty "Steps" section
            you fill in from the inspector afterward.
          </Text>
        </>
      )}
    </div>
  );

  const reviewContent = (
    <div className="flex flex-col gap-4">
      {errorAlert}
      <Descriptions columns={1}>
        <DescriptionsItem label="Source">
          {source === "upload" ? "Upload" : source === "github" ? "GitHub" : "Blank skill"}
        </DescriptionsItem>
        {source === "upload" ? (
          <>
            <DescriptionsItem label="File">{pickedFile?.name ?? "—"}</DescriptionsItem>
            <DescriptionsItem label="Size">
              {pickedFile ? formatBytes(pickedFile.size) : "—"}
            </DescriptionsItem>
          </>
        ) : source === "github" ? (
          <>
            <DescriptionsItem label="Repository">{repoUrl.trim() || "—"}</DescriptionsItem>
            <DescriptionsItem label="Ref">{ref.trim() || "main"}</DescriptionsItem>
            <DescriptionsItem label="Subpath">{subpath || "/"}</DescriptionsItem>
            <DescriptionsItem label="Skill">
              {selectedCandidate?.name ?? selectedCandidate?.subpath ?? "—"}
            </DescriptionsItem>
            <DescriptionsItem label="Authentication">
              {token.trim() ? "PAT provided" : "Public"}
            </DescriptionsItem>
          </>
        ) : (
          <>
            <DescriptionsItem label="Name">{blankNameTrimmed || "—"}</DescriptionsItem>
            <DescriptionsItem label="Description">
              {blankDescriptionTrimmed || "—"}
            </DescriptionsItem>
          </>
        )}
        <DescriptionsItem label="Display name">{displayName.trim() || "(auto)"}</DescriptionsItem>
      </Descriptions>
    </div>
  );

  // One WideDialog section per wizard step — the rail is the step indicator + backward nav.
  const sections: WideDialogSection[] = steps.map((s) => ({
    id: s.id,
    label: s.label,
    content: s.id === "source" ? sourceContent : s.id === "detail" ? detailContent : reviewContent,
  }));

  const stepOrder = steps.map((s) => s.id);
  function handleSectionChange(id: string) {
    if (busy) return;
    const currentIndex = stepOrder.indexOf(step);
    const targetIndex = stepOrder.indexOf(id);
    if (targetIndex !== -1 && targetIndex < currentIndex) setStep(id as WizardStep);
  }

  // Back grouped LEFT; Cancel + the step's forward/commit action grouped right (kit footer rule).
  const footer = (
    <div className="flex w-full items-center justify-between gap-2">
      <div className="flex items-center gap-2">
        {step !== "source" ? (
          <Button
            variant="outline"
            disabled={Boolean(busy)}
            onClick={() => setStep(step === "review" ? "detail" : "source")}
          >
            Back
          </Button>
        ) : null}
      </div>
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          onClick={() => guard.requestOpenChange(false)}
          disabled={Boolean(busy)}
        >
          Cancel
        </Button>
        {step === "source" ? (
          <Button
            onClick={() => {
              // "From server" hands off to the dedicated scaffold wizard (D-UX1 / K6) instead of
              // proceeding to an in-modal detail step.
              if (source === "server") {
                props.onUseServerSource?.();
                return;
              }
              setStep("detail");
            }}
          >
            Continue
          </Button>
        ) : null}
        {step === "detail" ? (
          <Button onClick={() => setStep("review")} disabled={!canAdvanceDetail || Boolean(busy)}>
            Continue
          </Button>
        ) : null}
        {step === "review" ? (
          <Button onClick={() => void create()} disabled={Boolean(busy)}>
            <Save aria-hidden />
            <span>{busy === "create" ? "Registering…" : "Register skill"}</span>
          </Button>
        ) : null}
      </div>
    </div>
  );

  return (
    <>
      <WideDialog
        open={props.open}
        onOpenChange={guard.requestOpenChange}
        title="Add skill"
        description="Register an Agent Skill from an uploaded archive, a GitHub repository, a blank scaffold, or a scanned server's tool surface. The app inspects — it never runs skill content."
        sections={sections}
        activeSectionId={step}
        onActiveSectionChange={handleSectionChange}
        footer={footer}
      />
      <DiscardChangesDialog
        open={guard.confirming}
        onConfirm={guard.confirmDiscard}
        onCancel={guard.cancelDiscard}
      />
    </>
  );
}
