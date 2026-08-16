import { useEffect, useId, useState } from "react";
import { GITHUB_REPO_NAME_PATTERN, type PublishToGithubResult } from "@mcp-token-footprint/shared";
import { Alert, AlertDescription, AlertTitle, Badge, Card, Input, Label, Switch, Text } from "@brand/ui";
import { AlertTriangle, CheckCircle2, GitBranch } from "lucide-react";
import { ApiError } from "../../lib/api";
import { getErrorMessage } from "../../lib/errors";
import { FormDialog } from "../../components/dialogs";
import { publishSkillToGithub } from "./skills-inspector-api";

/** A validation-blocking name is one that fails the shared pattern, or is a git-reserved bare dot. */
function isValidRepoName(name: string): boolean {
  return GITHUB_REPO_NAME_PATTERN.test(name) && name !== "." && name !== "..";
}

type Banner = { status: number | "other"; message: string };

/** Human title for the inline refusal banner, keyed by the API's redacted status. */
function bannerTitle(status: Banner["status"]): string {
  switch (status) {
    case 409:
      return "Couldn’t publish there — that repository name is taken. Pick a different name and try again.";
    case 401:
    case 403:
      return "Couldn’t authenticate with GitHub — check the token and try again.";
    case 400:
      return "Couldn’t publish that version — check the details below and try again.";
    default:
      return "Couldn’t publish to GitHub — check the connection and try again.";
  }
}

export type PublishGithubDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  skillId: string;
  /** The version being published (the tree pushed as the initial commit). */
  versionId: string;
  /** Human label of that version (context only — e.g. "v3 · 1.2.0"). */
  versionLabel?: string;
  /** Prefill for the repo-name field (the skill slug). */
  defaultRepoName: string;
  /**
   * True when the skill is ALREADY GitHub-bound: it can still be published to a NEW repo, but
   * bind-as-source is disabled (the API refuses a silent rebind with a 409 — we prevent the obvious
   * mistake here; the server stays authoritative).
   */
  alreadyBound: boolean;
  /** Called on a successful publish so the inspector refetches the skill (badge + pull affordances). */
  onPublished: () => void;
};

/**
 * WP 7.2 — the version-scoped "Publish to GitHub" wizard. Collects a repo name (prefilled from the
 * slug), a private toggle, a write-only PAT, and a bind-as-source toggle → POSTs to WP 7.1's
 * `publish-github` route → shows the created repo URL (a real out-link) or the API's redacted refusal
 * inline. The wizard adds NO secret handling beyond sending the PAT in the body: the field is a
 * `type="password"` input that is never prefilled, never echoed back, and never logged; the API
 * stores it encrypted ONLY when bind-as-source is on.
 */
export function PublishGithubDialog({
  open,
  onOpenChange,
  skillId,
  versionId,
  versionLabel,
  defaultRepoName,
  alreadyBound,
  onPublished,
}: PublishGithubDialogProps) {
  const [repoName, setRepoName] = useState(defaultRepoName);
  const [isPrivate, setIsPrivate] = useState(true);
  // PAT — write-only, NEVER prefilled and never round-tripped from the server.
  const [token, setToken] = useState("");
  const [bindAsSource, setBindAsSource] = useState(!alreadyBound);
  const [publishing, setPublishing] = useState(false);
  const [banner, setBanner] = useState<Banner | null>(null);
  const [result, setResult] = useState<PublishToGithubResult | null>(null);

  const nameFieldId = useId();
  const nameErrorId = useId();
  const tokenFieldId = useId();

  // Reset every transient field each time the dialog opens for a fresh publish.
  useEffect(() => {
    if (open) {
      setRepoName(defaultRepoName);
      setIsPrivate(true);
      setToken("");
      setBindAsSource(!alreadyBound);
      setBanner(null);
      setResult(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const trimmedName = repoName.trim();
  const nameValid = isValidRepoName(trimmedName);
  const showNameError = repoName.length > 0 && !nameValid;

  async function handlePublish() {
    setPublishing(true);
    setBanner(null);
    try {
      const trimmedToken = token.trim();
      const response = await publishSkillToGithub(skillId, versionId, {
        repoName: trimmedName,
        private: isPrivate,
        bindAsSource,
        // Omit the token entirely when blank so the API falls back to the skill's stored PAT.
        ...(trimmedToken ? { token: trimmedToken } : {}),
      });
      setResult(response);
      // Refetch immediately so the GitHub source badge + Pull affordances appear without navigation.
      onPublished();
    } catch (err) {
      setBanner({
        status: err instanceof ApiError ? err.status : "other",
        message: getErrorMessage(err, "GitHub didn’t accept the publish."),
      });
    } finally {
      setPublishing(false);
    }
  }

  return (
    <FormDialog
      open={open}
      // Don't let an overlay-click / Esc tear down a publish in flight.
      onOpenChange={(next) => {
        if (!next && publishing) return;
        onOpenChange(next);
      }}
      title={result ? "Published to GitHub" : "Publish to GitHub"}
      description={
        result
          ? "The version tree was pushed as the initial commit of a new repository."
          : `Create a new GitHub repository from ${
              versionLabel ? `“${versionLabel}”` : "this version"
            } and push its files as the first commit.`
      }
      // Result phase: "Open repository" is the next action; "Close" dismisses. Form phase: publish.
      cancelLabel={result ? "Close" : undefined}
      primaryLabel={result ? "Open repository" : "Publish to GitHub"}
      onSubmit={
        result
          ? () => window.open(result.repoUrl, "_blank", "noopener,noreferrer")
          : handlePublish
      }
      busy={result ? undefined : publishing}
      submitDisabled={result ? undefined : !nameValid}
    >
      {result ? (
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="size-5 text-success" aria-hidden />
            <Text>
              Repository created
              {result.bound ? " and bound as this skill’s GitHub source." : "."}
            </Text>
          </div>

          <Card className="flex flex-col gap-1.5 p-3">
            <Text variant="meta" tone="muted">
              Repository URL
            </Text>
            <a
              href={result.repoUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-w-0 items-center gap-1.5 break-all font-mono text-body text-primary underline underline-offset-2"
            >
              <GitBranch className="size-3.5 shrink-0" aria-hidden />
              <span className="min-w-0 break-all">{result.repoUrl}</span>
            </a>
          </Card>

          {result.bound ? (
            <Text variant="meta" tone="muted">
              <Badge variant="secondary" className="me-1.5 align-middle">
                <GitBranch className="size-3" aria-hidden /> Bound
              </Badge>
              Pull and upstream checks now work against this repository — the token was stored
              encrypted.
            </Text>
          ) : null}
        </div>
      ) : (
        <>
          {banner ? (
            <Alert variant={banner.status === 409 ? "warning" : "destructive"}>
              <AlertTriangle />
              <AlertTitle>{bannerTitle(banner.status)}</AlertTitle>
              <AlertDescription>{banner.message}</AlertDescription>
            </Alert>
          ) : null}

          {/* Repo name — prefilled from the slug, validated against the shared pattern. */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={nameFieldId}>Repository name</Label>
            <Input
              id={nameFieldId}
              name="repo-name"
              value={repoName}
              placeholder="my-skill…"
              spellCheck={false}
              autoComplete="off"
              aria-invalid={showNameError || undefined}
              aria-describedby={showNameError ? nameErrorId : undefined}
              onChange={(event) => setRepoName(event.target.value)}
            />
            {showNameError ? (
              <Text id={nameErrorId} variant="meta" className="text-destructive" role="alert">
                Use 1–100 characters: letters, digits, “.”, “-”, or “_” (not a bare “.” or “..”).
              </Text>
            ) : (
              <Text variant="meta" tone="muted">
                Created under your GitHub account.
              </Text>
            )}
          </div>

          {/* Private toggle — defaults to private. */}
          <Label
            htmlFor="publish-github-private"
            className="flex items-start justify-between gap-3 font-normal"
          >
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="font-medium">Private repository</span>
              <Text variant="meta" tone="muted">
                Create the new repository as private. Turn off to make it public.
              </Text>
            </span>
            <Switch
              id="publish-github-private"
              checked={isPrivate}
              onCheckedChange={setIsPrivate}
              className="mt-0.5 shrink-0"
            />
          </Label>

          {/* PAT — write-only, never prefilled / echoed / logged. */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={tokenFieldId}>Personal access token</Label>
            <Input
              id={tokenFieldId}
              name="github-pat"
              type="password"
              value={token}
              placeholder="ghp_…"
              autoComplete="off"
              spellCheck={false}
              onChange={(event) => setToken(event.target.value)}
            />
            <Text variant="meta" tone="muted">
              {alreadyBound
                ? "Leave blank to reuse this skill’s stored token, or paste one to create the new repo."
                : "Needs a token with repo-creation scope."}{" "}
              {bindAsSource
                ? "Stored encrypted server-side so pull/upstream keep working; never shown again."
                : "Used once to create the repo and push — not stored."}
            </Text>
          </div>

          {/* Bind-as-source toggle — disabled for an already-bound skill (the API 409s a rebind). */}
          <Label
            htmlFor="publish-github-bind"
            className="flex items-start justify-between gap-3 font-normal"
          >
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="font-medium">Bind as this skill’s GitHub source</span>
              <Text variant="meta" tone="muted">
                {alreadyBound
                  ? "This skill is already bound to a GitHub source — publishing creates a new repo without rebinding."
                  : "Wire the new repo up as the source so “Pull latest” and update checks work right away."}
              </Text>
            </span>
            <Switch
              id="publish-github-bind"
              checked={bindAsSource}
              disabled={alreadyBound}
              onCheckedChange={setBindAsSource}
              className="mt-0.5 shrink-0"
            />
          </Label>
        </>
      )}
    </FormDialog>
  );
}
