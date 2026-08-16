import { useEffect, useId, useState } from "react";
import type {
  GithubAccountStatus,
  Skill,
  SkillPushMode,
  SkillPushToGithubResult,
} from "@mcp-token-footprint/shared";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Card,
  Input,
  Label,
  RadioGroup,
  RadioGroupItem,
  Text,
  Textarea,
} from "@brand/ui";
import { AlertTriangle, CheckCircle2, ExternalLink } from "lucide-react";
import { ApiError, getGithubAccount } from "../../lib/api";
import { getErrorMessage } from "../../lib/errors";
import { FormDialog } from "../../components/dialogs";
import { pushSkillToGithub } from "./skills-inspector-api";

type Banner = { status: number | "other"; message: string };

/** Human title for the inline refusal banner, keyed by the API's redacted status. */
function bannerTitle(status: Banner["status"]): string {
  switch (status) {
    case 409:
      return "Couldn’t push — the branch moved. Pull the latest, then push again.";
    case 401:
    case 403:
      return "Couldn’t authenticate with GitHub — check the token and try again.";
    case 400:
      return "Couldn’t push that version — check the details below and try again.";
    default:
      return "Couldn’t push to GitHub — check the connection and try again.";
  }
}

export type PushGithubDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The GitHub-bound skill (must carry `skill.github` — the dialog reads ref/hasAuth/slug). */
  skill: Skill;
  /** The version being pushed back to the source repo. */
  versionId: string;
  /** Human label of that version (context + default commit-message/branch stems). */
  versionLabel?: string;
  /** Called after a successful DIRECT push so the inspector refetches (lastSha moved). */
  onPushed: () => void;
};

/**
 * Push the selected version BACK to the skill's bound GitHub source — the other half of "Pull
 * latest". Two modes: a DIRECT commit onto the tracked branch, or a new head branch + PULL REQUEST
 * against it (both via `POST /:id/versions/:vid/push-github`; the API owns all git/secret work and
 * never force-pushes). The PAT field is a write-only override: blank uses the skill's stored token.
 */
export function PushGithubDialog({
  open,
  onOpenChange,
  skill,
  versionId,
  versionLabel,
  onPushed,
}: PushGithubDialogProps) {
  const github = skill.github;
  const trackedRef = github?.ref ?? "main";

  const [mode, setMode] = useState<SkillPushMode>("direct");
  const [commitMessage, setCommitMessage] = useState("");
  const [branch, setBranch] = useState("");
  const [prTitle, setPrTitle] = useState("");
  const [prBody, setPrBody] = useState("");
  // PAT override — write-only; blank falls back to the skill's stored token.
  const [token, setToken] = useState("");
  const [pushing, setPushing] = useState(false);
  const [banner, setBanner] = useState<Banner | null>(null);
  const [result, setResult] = useState<SkillPushToGithubResult | null>(null);
  // The app-wide GitHub account (Settings sign-in) — the token resolution's LAST fallback. Fetched
  // best-effort per open; `null` (unknown/failed) degrades to the per-skill-token-only behavior.
  const [account, setAccount] = useState<GithubAccountStatus | null>(null);

  const commitFieldId = useId();
  const branchFieldId = useId();
  const prTitleFieldId = useId();
  const prBodyFieldId = useId();
  const tokenFieldId = useId();

  const defaultCommitMessage = `Update ${skill.name}${versionLabel ? ` to ${versionLabel}` : ""}`;

  // Reset every transient field each time the dialog opens for a fresh push.
  useEffect(() => {
    if (open) {
      setMode("direct");
      setCommitMessage("");
      setBranch("");
      setPrTitle("");
      setPrBody("");
      setToken("");
      setBanner(null);
      setResult(null);
      getGithubAccount()
        .then(setAccount)
        .catch(() => setAccount(null));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const accountConnected = Boolean(account?.connected);
  const hasAnyStoredAuth = Boolean(github?.hasAuth) || accountConnected;

  async function handlePush() {
    setPushing(true);
    setBanner(null);
    try {
      const response = await pushSkillToGithub(skill.id, versionId, {
        mode,
        // Omit blank optionals so the API applies its documented defaults.
        ...(commitMessage.trim() ? { commitMessage: commitMessage.trim() } : {}),
        ...(mode === "pr" && branch.trim() ? { branch: branch.trim() } : {}),
        ...(mode === "pr" && prTitle.trim() ? { prTitle: prTitle.trim() } : {}),
        ...(mode === "pr" && prBody.trim() ? { prBody: prBody.trim() } : {}),
        ...(token.trim() ? { token: token.trim() } : {}),
      });
      setResult(response);
      if (response.mode === "direct" && !response.unchanged) {
        // The tracked branch moved (to our own commit) — refetch so lastSha/upstream stay honest.
        onPushed();
      }
    } catch (err) {
      setBanner({
        status: err instanceof ApiError ? err.status : "other",
        message: getErrorMessage(err, "GitHub didn’t accept the push."),
      });
    } finally {
      setPushing(false);
    }
  }

  const openUrl =
    result && result.mode === "pr" && result.prUrl ? result.prUrl : result?.repoUrl;
  const openLabel = result?.mode === "pr" && result.prUrl ? "Open pull request" : "Open repository";

  return (
    <FormDialog
      open={open}
      // Don't let an overlay-click / Esc tear down a push in flight.
      onOpenChange={(next) => {
        if (!next && pushing) return;
        onOpenChange(next);
      }}
      title={
        result ? (result.unchanged ? "Nothing to push" : "Pushed to GitHub") : "Push to GitHub"
      }
      description={
        result
          ? result.unchanged
            ? `This version is identical to the repository content on “${result.branch}”.`
            : result.mode === "pr"
              ? "The changes were pushed to a new branch and a pull request was opened."
              : `The changes were committed to “${result.branch}”.`
          : `Push ${versionLabel ? `“${versionLabel}”` : "this version"} back to the source repository (${trackedRef}).`
      }
      // Result phase: open the PR/repo (the next action); "Close" dismisses. Form phase: push.
      cancelLabel={result ? "Close" : undefined}
      primaryLabel={result ? openLabel : mode === "pr" ? "Push & open PR" : "Push"}
      onSubmit={
        result
          ? () => {
              if (openUrl) window.open(openUrl, "_blank", "noopener,noreferrer");
            }
          : handlePush
      }
      busy={result ? undefined : pushing}
      submitDisabled={result ? undefined : !hasAnyStoredAuth && !token.trim()}
    >
      {result ? (
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-2">
            <CheckCircle2
              className={`size-5 ${result.unchanged ? "text-muted-foreground" : "text-success"}`}
              aria-hidden
            />
            <Text>
              {result.unchanged
                ? "No commit was created — the trees already match."
                : result.mode === "pr"
                  ? `Pull request #${result.prNumber ?? "?"} opened from “${result.branch}” into “${trackedRef}”.`
                  : `Commit ${result.commitSha?.slice(0, 7) ?? ""} pushed to “${result.branch}”.`}
            </Text>
          </div>

          {!result.unchanged ? (
            <Card className="flex flex-col gap-1.5 p-3">
              <Text variant="meta" tone="muted">
                {result.mode === "pr" ? "Pull request" : "Repository"}
              </Text>
              <a
                href={result.mode === "pr" && result.prUrl ? result.prUrl : result.repoUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex min-w-0 items-center gap-1.5 break-all font-mono text-body text-primary underline underline-offset-2"
              >
                <ExternalLink className="size-3.5 shrink-0" aria-hidden />
                <span className="min-w-0 break-all">
                  {result.mode === "pr" && result.prUrl ? result.prUrl : result.repoUrl}
                </span>
              </a>
            </Card>
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

          {/* Mode — direct commit vs branch + PR. */}
          <RadioGroup
            value={mode}
            onValueChange={(value) => setMode(value as SkillPushMode)}
            className="flex flex-col gap-1"
            aria-label="Push mode"
          >
            <Label
              htmlFor="push-github-mode-direct"
              className="flex items-start gap-3 rounded-md border border-border p-3 font-normal"
            >
              <RadioGroupItem id="push-github-mode-direct" value="direct" className="mt-0.5" />
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="font-medium">Commit to “{trackedRef}”</span>
                <Text variant="meta" tone="muted">
                  Push one commit straight onto the tracked branch (never force-pushed).
                </Text>
              </span>
            </Label>
            <Label
              htmlFor="push-github-mode-pr"
              className="flex items-start gap-3 rounded-md border border-border p-3 font-normal"
            >
              <RadioGroupItem id="push-github-mode-pr" value="pr" className="mt-0.5" />
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="font-medium">Open a pull request</span>
                <Text variant="meta" tone="muted">
                  Push a new branch and open a PR into “{trackedRef}” (github.com repositories).
                </Text>
              </span>
            </Label>
          </RadioGroup>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor={commitFieldId}>Commit message</Label>
            <Input
              id={commitFieldId}
              name="commit-message"
              value={commitMessage}
              placeholder={`${defaultCommitMessage}…`}
              spellCheck={false}
              autoComplete="off"
              onChange={(event) => setCommitMessage(event.target.value)}
            />
            <Text variant="meta" tone="muted">
              Leave blank for “{defaultCommitMessage}”.
            </Text>
          </div>

          {mode === "pr" ? (
            <>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={branchFieldId}>Head branch</Label>
                <Input
                  id={branchFieldId}
                  name="head-branch"
                  value={branch}
                  placeholder={`skill/${skill.slug}${versionLabel ? `-${versionLabel.toLowerCase().replace(/[^a-z0-9._-]+/g, "-")}` : ""}…`}
                  spellCheck={false}
                  autoComplete="off"
                  onChange={(event) => setBranch(event.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={prTitleFieldId}>Pull request title</Label>
                <Input
                  id={prTitleFieldId}
                  name="pr-title"
                  value={prTitle}
                  placeholder={`${defaultCommitMessage}…`}
                  spellCheck={false}
                  autoComplete="off"
                  onChange={(event) => setPrTitle(event.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={prBodyFieldId}>Pull request description</Label>
                <Textarea
                  id={prBodyFieldId}
                  name="pr-body"
                  value={prBody}
                  rows={3}
                  placeholder="What changed and why…"
                  onChange={(event) => setPrBody(event.target.value)}
                />
              </div>
            </>
          ) : null}

          {/* PAT override — write-only; blank uses the stored token. */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={tokenFieldId}>Personal access token</Label>
            <Input
              id={tokenFieldId}
              name="github-pat"
              type="password"
              value={token}
              placeholder={hasAnyStoredAuth ? "•••••• (optional override)…" : "ghp_…"}
              autoComplete="off"
              spellCheck={false}
              onChange={(event) => setToken(event.target.value)}
            />
            <Text variant="meta" tone="muted">
              {github?.hasAuth
                ? "Leave blank to use this skill’s stored token. Used once for this push — an override is not stored."
                : accountConnected
                  ? `Leave blank to push as ${account?.login ?? "your GitHub account"} (signed in via Settings).`
                  : "No token stored and no GitHub account signed in — paste a token, or sign in with GitHub in Settings."}
            </Text>
          </div>
        </>
      )}
    </FormDialog>
  );
}
