import { useEffect, useState } from "react";
import type { Collection, CollectionInput } from "@mcp-token-footprint/shared";
import { collectionInputSchema } from "@mcp-token-footprint/shared";
import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Spinner,
  Switch,
  Text,
} from "@brand/ui";
import { KeyRound, Save } from "lucide-react";
import { FieldRow } from "../../../components/FieldRow";
import { getErrorMessage } from "../../../lib/errors";

type FieldErrors = Partial<Record<"name" | "repoUrl" | "repoPath" | "branch", string>>;

const FIELD_FOCUS: { key: keyof FieldErrors; id: string }[] = [
  { key: "name", id: "collection-name" },
  { key: "repoUrl", id: "collection-repo-url" },
  { key: "repoPath", id: "collection-repo-path" },
  { key: "branch", id: "collection-branch" },
];

export type CollectionEditorSubmit = {
  input: CollectionInput;
  /** Import-bootstrap: run a sync straight after creating so existing remote members are pulled in. */
  bootstrap: boolean;
};

/**
 * Create / bind a Collection — a Dialog over `@brand/ui` parts (contract-validated with
 * `collectionInputSchema`, mirroring the ServerWizard/SuiteEditor form pattern). A collection binds a
 * set of tests/suites to a git repo. The PAT is WRITE-ONLY: the field is a `type="password"` input
 * with `autoComplete="off"` that NEVER shows a stored value — on edit we render only a "PAT set"
 * indicator (from `hasPat`) and an empty box (typing rotates it; leaving it empty keeps the stored
 * one). An "import existing repo" toggle (create only) triggers a first sync that pulls the remote's
 * members into the DB.
 */
export function CollectionEditor({
  open,
  collection,
  onOpenChange,
  onSubmit,
}: {
  open: boolean;
  /** The collection being edited, or `null` to create/bind a new one. */
  collection: Collection | null;
  onOpenChange: (open: boolean) => void;
  onSubmit: (payload: CollectionEditorSubmit) => Promise<void>;
}) {
  const editing = collection !== null;

  const [name, setName] = useState("");
  const [repoUrl, setRepoUrl] = useState("");
  const [repoPath, setRepoPath] = useState("");
  const [branch, setBranch] = useState("main");
  const [pat, setPat] = useState("");
  const [bootstrap, setBootstrap] = useState(true);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Seed from the collection (edit) or defaults (create) whenever the dialog (re)opens. The PAT box is
  // ALWAYS seeded empty — a stored PAT is never read back into the client.
  useEffect(() => {
    if (!open) return;
    setName(collection?.name ?? "");
    setRepoUrl(collection?.repoUrl ?? "");
    setRepoPath(collection?.repoPath ?? "");
    setBranch(collection?.branch ?? "main");
    setPat("");
    setBootstrap(!editing);
    setErrors({});
    setFormError(null);
    setSaving(false);
  }, [open, collection, editing]);

  async function submit() {
    const input: CollectionInput = {
      name: name.trim(),
      repoUrl: repoUrl.trim(),
      repoPath: repoPath.trim(),
      branch: branch.trim(),
      // Only send `pat` when the user typed one — omitting it keeps the stored PAT on edit.
      ...(pat.trim() ? { pat: pat.trim() } : {}),
    };

    const parsed = collectionInputSchema.safeParse(input);
    if (!parsed.success) {
      const next: FieldErrors = {};
      for (const issue of parsed.error.issues) {
        const key = String(issue.path[0] ?? "form") as keyof FieldErrors;
        if (!next[key]) next[key] = issue.message;
      }
      setErrors(next);
      setFormError("Fix the highlighted fields and try again.");
      const first = FIELD_FOCUS.find((f) => next[f.key]);
      if (first) document.getElementById(first.id)?.focus();
      return;
    }

    setErrors({});
    setFormError(null);
    setSaving(true);
    try {
      await onSubmit({ input: parsed.data, bootstrap: editing ? false : bootstrap });
      onOpenChange(false);
    } catch (error) {
      setFormError(`Couldn’t save the collection. ${getErrorMessage(error)} Try again.`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg" className="flex max-h-[90vh] flex-col gap-0 p-0">
        <DialogHeader className="flex-none gap-1 border-b border-border p-4 pe-12">
          <DialogTitle>{editing ? "Edit collection" : "New collection"}</DialogTitle>
          <DialogDescription>
            A collection binds a set of tests and suites to a git repo so a team can share and
            version them. Sync is two-way — a real merge, never a force-push.
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
            <FieldRow id="collection-name" label="Name" error={errors.name}>
              <Input
                id="collection-name"
                name="collection-name"
                value={name}
                placeholder="Shared benchmark set…"
                autoComplete="off"
                spellCheck={false}
                aria-invalid={errors.name ? true : undefined}
                onChange={(event) => setName(event.target.value)}
              />
            </FieldRow>

            <FieldRow id="collection-repo-url" label="Repository URL" error={errors.repoUrl}>
              <Input
                id="collection-repo-url"
                name="collection-repo-url"
                type="url"
                inputMode="url"
                value={repoUrl}
                placeholder="https://github.com/team/benchmarks.git…"
                autoComplete="off"
                spellCheck={false}
                aria-invalid={errors.repoUrl ? true : undefined}
                onChange={(event) => setRepoUrl(event.target.value)}
              />
              <Text variant="meta" tone="muted">
                An HTTPS git remote. Private repos need a PAT below.
              </Text>
            </FieldRow>

            <div className="grid gap-4 sm:grid-cols-2">
              <FieldRow id="collection-repo-path" label="Path in repo" error={errors.repoPath}>
                <Input
                  id="collection-repo-path"
                  name="collection-repo-path"
                  value={repoPath}
                  placeholder="benchmarks (blank = repo root)…"
                  autoComplete="off"
                  spellCheck={false}
                  aria-invalid={errors.repoPath ? true : undefined}
                  onChange={(event) => setRepoPath(event.target.value)}
                />
                <Text variant="meta" tone="muted">
                  Sub-folder for the tests/ and suites/ files. Blank = repo root.
                </Text>
              </FieldRow>

              <FieldRow id="collection-branch" label="Branch" error={errors.branch}>
                <Input
                  id="collection-branch"
                  name="collection-branch"
                  value={branch}
                  placeholder="main…"
                  autoComplete="off"
                  spellCheck={false}
                  aria-invalid={errors.branch ? true : undefined}
                  onChange={(event) => setBranch(event.target.value)}
                />
              </FieldRow>
            </div>

            {/* PAT — write-only. On edit we show a "PAT set" indicator (from hasPat) and an EMPTY box;
                the stored value is never read back into the client. */}
            <FieldRow
              id="collection-pat"
              label={
                <span className="flex items-center gap-2">
                  <span>Personal access token</span>
                  {editing && collection?.hasPat ? (
                    <Badge variant="secondary">
                      <KeyRound aria-hidden className="size-3" />
                      PAT set
                    </Badge>
                  ) : null}
                </span>
              }
            >
              <Input
                id="collection-pat"
                name="collection-pat"
                type="password"
                value={pat}
                placeholder={
                  editing && collection?.hasPat
                    ? "Leave blank to keep the stored token…"
                    : "Optional — for a private repo…"
                }
                autoComplete="off"
                spellCheck={false}
                onChange={(event) => setPat(event.target.value)}
              />
              <Text variant="meta" tone="muted">
                Write-only — encrypted server-side and never shown again.{" "}
                {editing
                  ? "Type a new value to rotate it; leave blank to keep the current one."
                  : null}
              </Text>
            </FieldRow>

            {!editing ? (
              <div className="flex items-start justify-between gap-4 rounded-md border border-border p-3">
                <div className="flex flex-col">
                  <Label htmlFor="collection-bootstrap">Import existing repo</Label>
                  <Text variant="meta" tone="muted">
                    Run a first sync right after creating — pulls any tests/suites already in the
                    repo into your local library.
                  </Text>
                </div>
                <Switch
                  id="collection-bootstrap"
                  checked={bootstrap}
                  onCheckedChange={setBootstrap}
                  aria-label="Import existing repo on create"
                />
              </div>
            ) : null}
          </div>
        </div>

        <DialogFooter className="flex-none border-t border-border p-4">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={saving}>
            {saving ? <Spinner className="size-4" /> : <Save aria-hidden />}
            <span>{saving ? "Saving…" : editing ? "Save collection" : "Create collection"}</span>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
