import { useEffect, useId, useState } from "react";
import type { Skill } from "@mcp-token-footprint/shared";
import { Alert, AlertDescription, AlertTitle, Input, Label, Switch, Text } from "@brand/ui";
import { AlertTriangle } from "lucide-react";
import { updateSkill } from "../../lib/api";
import { getErrorMessage } from "../../lib/errors";
import { FormDialog } from "../../components/dialogs";

export type GithubSourceDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The GitHub-bound skill whose source config is edited (must carry `skill.github`). */
  skill: Skill;
  /** Called after a successful save so the inspector refetches (badge, upstream check, links). */
  onSaved: () => void;
};

/**
 * Edit a GitHub-bound skill's SOURCE CONFIG — the repo URL, tracked branch/ref, subpath, and the
 * stored PAT (set/replace or clear). All fields except the PAT are prefilled from the redacted
 * `skill.github` view; the PAT field is write-only (never prefilled, never echoed — the server only
 * ever exposes `hasAuth`). Saving PUTs the CHANGED fields to `/api/skills/:id`; retargeting the
 * repo/ref/subpath only changes what pull/upstream/push track (the next pull imports from the new
 * target as a new immutable version — existing versions are untouched).
 */
export function GithubSourceDialog({
  open,
  onOpenChange,
  skill,
  onSaved,
}: GithubSourceDialogProps) {
  const github = skill.github;
  const [repoUrl, setRepoUrl] = useState(github?.repoUrl ?? "");
  const [ref, setRef] = useState(github?.ref ?? "main");
  const [subpath, setSubpath] = useState(github?.subpath ?? "");
  // PAT — write-only, NEVER prefilled and never round-tripped from the server.
  const [token, setToken] = useState("");
  const [clearToken, setClearToken] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const repoFieldId = useId();
  const refFieldId = useId();
  const subpathFieldId = useId();
  const tokenFieldId = useId();

  // Reset every transient field each time the dialog opens against the CURRENT stored config.
  useEffect(() => {
    if (open) {
      setRepoUrl(github?.repoUrl ?? "");
      setRef(github?.ref ?? "main");
      setSubpath(github?.subpath ?? "");
      setToken("");
      setClearToken(false);
      setError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const trimmedRepo = repoUrl.trim();
  const trimmedRef = ref.trim();
  const trimmedSubpath = subpath.trim();
  const repoChanged = trimmedRepo !== (github?.repoUrl ?? "");
  const refChanged = trimmedRef !== (github?.ref ?? "");
  const subpathChanged = trimmedSubpath !== (github?.subpath ?? "");
  const retargeted = repoChanged || refChanged || subpathChanged;
  const tokenChanged = clearToken || token.trim().length > 0;
  const dirty = retargeted || tokenChanged;
  const valid = trimmedRepo.length > 0 && trimmedRef.length > 0;

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      await updateSkill(skill.id, {
        github: {
          // Only send what changed — an untouched field stays exactly as stored.
          ...(repoChanged ? { repoUrl: trimmedRepo } : {}),
          ...(refChanged ? { ref: trimmedRef } : {}),
          ...(subpathChanged ? { subpath: trimmedSubpath } : {}),
          ...(clearToken ? { auth: null } : token.trim() ? { auth: { token: token.trim() } } : {}),
        },
      });
      onSaved();
      onOpenChange(false);
    } catch (err) {
      setError(getErrorMessage(err, "The source settings weren’t saved."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <FormDialog
      open={open}
      // Don't let an overlay-click / Esc tear down a save in flight.
      onOpenChange={(next) => {
        if (!next && saving) return;
        onOpenChange(next);
      }}
      title="GitHub source settings"
      description="What “Pull latest”, update checks, and “Push to GitHub” track for this skill."
      primaryLabel="Save settings"
      onSubmit={handleSave}
      busy={saving}
      submitDisabled={!dirty || !valid}
    >
      {error ? (
        <Alert variant="destructive">
          <AlertTriangle />
          <AlertTitle>Couldn’t save — check the fields and try again.</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={repoFieldId}>Repository URL</Label>
        <Input
          id={repoFieldId}
          name="repo-url"
          type="url"
          value={repoUrl}
          placeholder="https://github.com/acme/my-skill.git…"
          spellCheck={false}
          autoComplete="off"
          onChange={(event) => setRepoUrl(event.target.value)}
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={refFieldId}>Branch / ref</Label>
          <Input
            id={refFieldId}
            name="git-ref"
            value={ref}
            placeholder="main…"
            spellCheck={false}
            autoComplete="off"
            onChange={(event) => setRef(event.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={subpathFieldId}>Subpath</Label>
          <Input
            id={subpathFieldId}
            name="git-subpath"
            value={subpath}
            placeholder="skills/my-skill…"
            spellCheck={false}
            autoComplete="off"
            onChange={(event) => setSubpath(event.target.value)}
          />
          <Text variant="meta" tone="muted">
            Leave blank for the repository root.
          </Text>
        </div>
      </div>

      {retargeted ? (
        <Alert variant="warning">
          <AlertTriangle />
          <AlertTitle>Retargeting the source</AlertTitle>
          <AlertDescription>
            Existing versions are untouched; the next “Pull latest” imports from the new target as a
            new version.
          </AlertDescription>
        </Alert>
      ) : null}

      {/* PAT — write-only, never prefilled / echoed / logged. */}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={tokenFieldId}>Personal access token</Label>
        <Input
          id={tokenFieldId}
          name="github-pat"
          type="password"
          value={token}
          placeholder={github?.hasAuth ? "•••••• (stored — paste to replace)…" : "ghp_…"}
          autoComplete="off"
          spellCheck={false}
          disabled={clearToken}
          onChange={(event) => setToken(event.target.value)}
        />
        <Text variant="meta" tone="muted">
          {github?.hasAuth
            ? "A token is stored (encrypted, never shown). Leave blank to keep it, paste a new one to replace it."
            : "No token stored. Needed for private repositories and for pushing."}
        </Text>
      </div>

      {github?.hasAuth ? (
        <Label
          htmlFor="github-source-clear-token"
          className="flex items-start justify-between gap-3 font-normal"
        >
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="font-medium">Remove the stored token</span>
            <Text variant="meta" tone="muted">
              Pull, update checks, and push will need a token again for private repositories.
            </Text>
          </span>
          <Switch
            id="github-source-clear-token"
            checked={clearToken}
            onCheckedChange={(checked) => {
              setClearToken(checked);
              if (checked) setToken("");
            }}
            className="mt-0.5 shrink-0"
          />
        </Label>
      ) : null}
    </FormDialog>
  );
}
