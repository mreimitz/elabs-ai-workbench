import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import type { BoundTool, Skill, SkillFileNode, SkillVersion } from "@mcp-token-footprint/shared";
import {
  Badge,
  Button,
  ButtonGroup,
  Heading,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  StatePanel,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  toast,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@elabs-ai/components-ui";
import {
  Download,
  ExternalLink,
  GitBranch,
  GitPullRequest,
  PencilRuler,
  RefreshCw,
  Settings2,
  Upload,
} from "lucide-react";
import { pullSkill } from "../../lib/api";
import { SecurityPanel, useSecurityReport } from "../security/SecurityPanel";
import { formatDateTime } from "../../lib/format";
import { loadableData } from "../../lib/loadable";
import { getErrorMessage } from "../../lib/errors";
import { IconButton } from "../../components/IconButton";
// The app's page frame (audit §S16) — carries the toolbar standard's `headerVariant="toolbar"`
// slot (`bg-card` + border-b lift) that hosts `ViewToolbar`. This view previously used the raw
// `@elabs-ai/components-ui` PageShell, which has no such slot; switched to the local frame like every other view.
import { PageShell } from "../../components/PageShell";
import { ViewToolbar } from "../../components/ViewToolbar";
// `useAssistant()` is read-only here: the Files-tab live-workspace mirror keys off the active
// assistant thread id (see the WP R1.4 block below). Touches ONLY the frozen public
// assistant-context API; no `AssistantDock` internals. (The old "Analyze recent runs" header
// action that also used it was removed under the toolbar standard, D-TB3.)
import { useAssistant } from "../assistant/assistant-context";
// Rating Issues registry (auto-learning loop) — the shared Issues tab surface + the per-issue
// "Fix with assistant" prompt builder (the hook fetches at page level so the tab can badge counts).
import { IssuesPanel, buildIssueFixPrompt } from "../issues/IssuesPanel";
import { useRatingIssues } from "../issues/use-rating-issues";
import { GithubSourceDialog } from "./GithubSourceDialog";
import { PublishGithubDialog } from "./PublishGithubDialog";
import { PushGithubDialog } from "./PushGithubDialog";
import { SkillFlowPreview } from "./studio/SkillFlowPreview";
import { skillStudioPath } from "./studio/studio-url";
import { ToolRunnerSheet } from "./design/ToolRunnerSheet";
// WP R1.4 (D-AS22) — the Files tab's live-workspace mirror: detection/subscription runs HERE (not
// gated by the active tab) so a change can auto-navigate INTO the Files tab from anywhere on this page.
import { LiveSkillWorkspaceView } from "./LiveSkillWorkspaceView";
import { useLiveSkillWorkspace } from "./use-live-skill-workspace";
import { SkillTraceView } from "./trace/SkillTraceView";
import { QualityView } from "./quality/QualityView";
import { SkillFileExplorer } from "./SkillFileExplorer";
import { SkillOverview } from "./SkillOverview";
import { SkillUsageTab } from "./SkillUsageTab";
import { SkillVersions } from "./SkillVersions";
import { SkillDiffView } from "./SkillDiffView";
import {
  getSkill,
  getSkillFiles,
  getSkillUpstreamSafe,
  getSkillVersion,
  listSkillVersions,
  restoreSkillVersion,
  skillExportUrl,
  type SkillUpstreamStatus,
} from "./skills-inspector-api";
import { notifyError } from "../../lib/notify";

const LATEST = "__latest__";

/**
 * One version's display label: `v{seq}`, plus the human `versionLabel` when it actually adds
 * information. The API derives a fallback label of exactly `v{seq}` for editor saves (no manifest
 * version, no git ref), which used to render as the duplicated "v5 · v5" — an identical (or
 * blank) label is dropped instead. Exported for tests.
 */
export function formatVersionLabel(version: Pick<SkillVersion, "seq" | "versionLabel">): string {
  const seqLabel = `v${version.seq}`;
  const label = version.versionLabel?.trim();
  if (!label || label.toLowerCase() === seqLabel.toLowerCase()) return seqLabel;
  return `${seqLabel} · ${label}`;
}

export type SkillInspectorProps = {
  skillId: string;
};

/**
 * Skill inspector: the header (version picker + Download .zip + "Pull latest" for GitHub-sourced
 * skills + an "update available" badge driven defensively by `GET /:id/upstream`) and the tab set
 * (Overview | Design | Trace | Files | Versions | Diff).
 *
 * All data comes from the read-only `/api/skills` routes via `skills-inspector-api`. This component
 * is self-contained and renderable in isolation given a `skillId`.
 */
export function SkillInspector({ skillId }: SkillInspectorProps) {
  const assistant = useAssistant();
  const [searchParams, setSearchParams] = useSearchParams();
  const [skill, setSkill] = useState<Skill | null>(null);
  const [versions, setVersions] = useState<SkillVersion[]>([]);
  const [error, setError] = useState<string | null>(null);

  // The version selection: LATEST (tracks the current version) or a pinned version id.
  const [selection, setSelection] = useState<string>(LATEST);
  const [version, setVersion] = useState<SkillVersion | null>(null);
  const [files, setFiles] = useState<SkillFileNode[] | null>(null);
  const [filesError, setFilesError] = useState<string | null>(null);

  const [upstream, setUpstream] = useState<SkillUpstreamStatus | null>(null);

  // Rating issues (auto-learning loop) — page-level fetch so the Issues tab badges its open count
  // before the tab is ever opened (Radix unmounts inactive tab content, so the panel can't own it).
  const {
    state: issuesState,
    reload: reloadIssues,
    openCount: openIssuesCount,
  } = useRatingIssues("skill", skillId);

  // Active inspector tab (controlled so "Compare"/"Pull latest" can deep-link into Diff).
  //
  // WP 2.1 (D-SP21) — held in the URL (`?tab=`) rather than in component state, so a Security tab
  // deep link (`/skills/:id?tab=security&baseline=…`) survives a reload and can be shared. No
  // `<Route>` is added: `/skills/:skillId` already exists and the tab is a parameter on it, which is
  // what keeps `ASSISTANT_ROUTE_MANIFEST` and its gate untouched.
  const tab = searchParams.get("tab") ?? "overview";
  const setTab = useCallback(
    (next: string) => {
      setSearchParams(
        (previous) => {
          const params = new URLSearchParams(previous);
          params.set("tab", next);
          // A baseline belongs to the Security tab; leaving it on the URL after switching away would
          // silently re-arm the diff on the way back.
          if (next !== "security") params.delete("baseline");
          return params;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );
  // Versions-tab compare selection (up to two version ids, oldest drops off when a third is added).
  const [compareSelection, setCompareSelection] = useState<string[]>([]);
  // Diff-tab A/B selection (from → to). Undefined until seeded (prev → current) or set explicitly.
  const [diffFromId, setDiffFromId] = useState<string | undefined>(undefined);
  const [diffToId, setDiffToId] = useState<string | undefined>(undefined);
  const [pulling, setPulling] = useState(false);
  // The version id whose "Set as latest" restore is in flight (drives the row spinner in Versions).
  const [restoringId, setRestoringId] = useState<string | null>(null);
  // WP 7.2 — version-scoped "Publish to GitHub" wizard.
  const [publishOpen, setPublishOpen] = useState(false);
  // GitHub workflow: the source-config editor + the version-scoped push-back (direct / PR) dialog.
  const [sourceOpen, setSourceOpen] = useState(false);
  const [pushOpen, setPushOpen] = useState(false);

  // RM-30 WP 7.1 (I2) — the inspector no longer HOLDS an editable draft. Authoring moved to the
  // Skill Studio (`/skills/:skillId/studio`), which owns the one draft, the one dirty flag and the
  // one save path, and guards its own exit. So the WP 4.2 tab/version unsaved-changes guard and the
  // SI13 header save cluster are both gone from here: there is nothing on this page that can be
  // dirty, and therefore no save bar anywhere on it.

  // Skill IDE WP 8.5 — the inline tool-runner Sheet lives at the inspector so both the Design and Files
  // surfaces can open it. Set (strictly on a user click / hover command-link) with the ALREADY-RESOLVED
  // bound tool to run; `null` closes it. Results are ephemeral — closing drops them.
  const [testTool, setTestTool] = useState<BoundTool | null>(null);
  const handleTestTool = useCallback((tool: BoundTool) => setTestTool(tool), []);

  // Load the skill + its versions.
  useEffect(() => {
    let cancelled = false;
    setSkill(null);
    setVersions([]);
    setError(null);
    setSelection(LATEST);
    setCompareSelection([]);
    setDiffFromId(undefined);
    setDiffToId(undefined);
    Promise.all([getSkill(skillId), listSkillVersions(skillId)])
      .then(([loadedSkill, loadedVersions]) => {
        if (cancelled) return;
        setSkill(loadedSkill);
        // Newest first (highest seq).
        setVersions([...loadedVersions].sort((a, b) => b.seq - a.seq));
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(getErrorMessage(err, "Couldn’t load skill"));
      });
    return () => {
      cancelled = true;
    };
  }, [skillId]);

  // The tab reset that used to live in the load effect above. It has to skip the FIRST run, or it
  // would wipe a `?tab=security` deep link the moment the page mounted; comparing against a ref
  // makes it fire on a real skill CHANGE and only then.
  const lastSkillIdRef = useRef(skillId);
  useEffect(() => {
    if (lastSkillIdRef.current === skillId) return;
    lastSkillIdRef.current = skillId;
    setTab("overview");
  }, [skillId, setTab]);

  // Defensive upstream check (WP 1.4 route may not exist yet → null → badge hidden). GitHub-only.
  useEffect(() => {
    if (!skill || skill.sourceType !== "github") {
      setUpstream(null);
      return;
    }
    let cancelled = false;
    getSkillUpstreamSafe(skillId)
      .then((status) => {
        if (!cancelled) setUpstream(status);
      })
      .catch(() => {
        // The "update available" badge is a non-critical affordance: on a hard failure (network/5xx —
        // `getSkillUpstreamSafe` now rethrows these rather than masking them as "no update") just hide
        // the badge. The inspector's primary content has its own error surfaces.
        if (!cancelled) setUpstream(null);
      });
    return () => {
      cancelled = true;
    };
  }, [skillId, skill]);

  // Resolve which version id is active.
  const latestVersionId = skill?.currentVersionId ?? versions[0]?.id;
  const activeVersionId = selection === LATEST ? latestVersionId : selection;
  // Is the viewed version the skill's HEAD? The Overview/Files server-binding surfaces edit the
  // latest version only (a bind/unbind saves a NEW version FROM it), so they render read-only when a
  // pinned older version is being viewed.
  const isHeadVersion = activeVersionId != null && activeVersionId === latestVersionId;

  // WP 2.1 — the posture report for the ACTIVE version, loaded here rather than inside the tab so the
  // strip can badge `counts.total` before the tab is ever opened (Radix unmounts inactive tab
  // content) — the same reason `useRatingIssues` above sits at page level for the Issues count.
  const securityReport = useSecurityReport(
    { kind: "skill", skillId, versionId: activeVersionId ?? "" },
    { enabled: activeVersionId != null },
  );
  const securityCount = loadableData(securityReport.state)?.counts.total;

  // The baselines a posture diff may name: this skill's OTHER versions, newest first. `versions` is
  // already sorted by descending `seq` where it is set.
  const securityBaselines = useMemo(
    () =>
      versions
        .filter((version) => version.id !== activeVersionId)
        .map((version) => ({
          id: version.id,
          label: `v${version.seq} · ${formatDateTime(version.createdAt)}`,
        })),
    [versions, activeVersionId],
  );

  // Load the active version detail + its files.
  useEffect(() => {
    if (!activeVersionId) {
      setVersion(null);
      setFiles(null);
      return;
    }
    let cancelled = false;
    setVersion(null);
    setFiles(null);
    setFilesError(null);
    Promise.all([
      getSkillVersion(skillId, activeVersionId),
      getSkillFiles(skillId, activeVersionId),
    ])
      .then(([loadedVersion, loadedFiles]) => {
        if (cancelled) return;
        setVersion(loadedVersion);
        setFiles(loadedFiles);
      })
      .catch((err: unknown) => {
        if (!cancelled) setFilesError(getErrorMessage(err, "Couldn’t load version"));
      });
    return () => {
      cancelled = true;
    };
  }, [skillId, activeVersionId]);

  const versionOptions = useMemo(
    () =>
      versions.map((v) => ({
        value: v.id,
        label: formatVersionLabel(v),
      })),
    [versions],
  );

  // Seed the Diff A/B pickers to (previous → current) once versions are known. `versions` is sorted
  // newest-first, so [0] is current and [1] is the immediate predecessor.
  useEffect(() => {
    if (versions.length < 2) {
      setDiffFromId(undefined);
      setDiffToId(undefined);
      return;
    }
    setDiffFromId((current) => current ?? versions[1]?.id);
    setDiffToId((current) => current ?? versions[0]?.id);
  }, [versions]);

  // Toggle a version into the Versions-tab compare selection (cap two; oldest picked drops off).
  const toggleCompare = useCallback((versionId: string) => {
    setCompareSelection((current) => {
      if (current.includes(versionId)) return current.filter((id) => id !== versionId);
      if (current.length < 2) return [...current, versionId];
      // Already two selected — drop the first, keep the second, add the new one.
      return [current[1] as string, versionId];
    });
  }, []);

  // Open the Diff tab for a specific pair (from → to). Used by "Compare", "Pull latest", and the
  // Design tab's "View full diff" (from its SaveVersionDialog success state).
  const openDiff = useCallback((fromId: string, toId: string) => {
    setDiffFromId(fromId);
    setDiffToId(toId);
    setTab("diff");
  }, []);

  // RM-30 WP 7.1 — nothing on this page can be dirty any more (authoring is the Studio's), so a tab
  // or version switch just applies. Trace stays hidden (its lens rides the Studio canvas), so a
  // stale `trace` value still redirects to Files; `design` is a real tab again — a READ-ONLY flow
  // preview whose only action is "Edit in Studio".
  const requestTabChange = useCallback((next: string) => {
    setTab(next === "trace" ? "files" : next);
  }, []);

  useEffect(() => {
    if (tab === "trace") setTab("files");
  }, [tab]);

  const requestSelectionChange = useCallback((next: string) => {
    setSelection(next);
  }, []);

  // Refresh the skill + version list after the Design tab saves a new version, then switch the
  // active selection to it (mirrors "Pull latest"'s own refresh-and-select flow).
  const handleDesignSaved = useCallback(
    async (newVersionId: string) => {
      const [loadedSkill, loadedVersions] = await Promise.all([
        getSkill(skillId),
        listSkillVersions(skillId),
      ]);
      setSkill(loadedSkill);
      setVersions([...loadedVersions].sort((a, b) => b.seq - a.seq));
      setSelection(newVersionId);
    },
    [skillId],
  );

  // ── WP R1.4 (D-AS22) — the Files tab's live-workspace mirror ────────────────────────────────────
  // Detection/subscription runs HERE, regardless of the active tab, so a live edit can auto-navigate
  // INTO the Files tab from anywhere on this page. `assistant.activeAssistantThreadId` is `null`
  // whenever the dock is closed or on a thread unrelated to this page (see `assistant-context.tsx`),
  // in which case the hook resolves to a harmless no-op — no fetch, no subscription.
  const live = useLiveSkillWorkspace(assistant.activeAssistantThreadId, skillId);

  /** Write the Files-tab file selection into the URL (`?file=…`), optionally also forcing `?tab=files`
   *  — `replace:true` so a burst of auto-navigated edits doesn't spam browser history. */
  const setLiveFileParam = useCallback(
    (path: string, options?: { forceFilesTab?: boolean }) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (options?.forceFilesTab) next.set("tab", "files");
          next.set("file", path);
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );
  const liveSelectedPath = searchParams.get("file") ?? undefined;

  // Seed a sensible default selection (SKILL.md, else the first text file, else the first file — mirrors
  // `SkillFileExplorer`'s own `defaultSelection`) once live mode is confirmed and nothing is picked yet.
  // Deliberately does NOT force the Files tab open — only an actual change does that (below).
  useEffect(() => {
    if (!live.isLive || liveSelectedPath || live.files.length === 0) return;
    const fallback =
      live.files.find((f) => f.path === "SKILL.md")?.path ??
      live.files.find((f) => !f.isBinary)?.path ??
      live.files[0]?.path;
    if (fallback) setLiveFileParam(fallback);
  }, [live.isLive, live.files, liveSelectedPath, setLiveFileParam]);

  // Auto-navigate: a fresh, DEBOUNCED change settle (`autoOpenNonce`, see the hook's doc) jumps the
  // owner into the Files tab at that file. Guarded by a ref (not just the nonce dependency) so this
  // fires exactly once per settle — including the very first one, which is why the guard compares
  // against a ref rather than skipping nonce 0 (0 is also `useState`'s initial value, so a dep-only
  // guard could never distinguish "never settled" from "settled once already, unrelated re-render").
  const lastAutoOpenNonceRef = useRef(0);
  useEffect(() => {
    if (live.autoOpenNonce === 0 || live.autoOpenNonce === lastAutoOpenNonceRef.current) return;
    lastAutoOpenNonceRef.current = live.autoOpenNonce;
    if (!live.autoOpenPath) return;
    requestTabChange("files");
    setLiveFileParam(live.autoOpenPath, { forceFilesTab: true });
  }, [live.autoOpenNonce, live.autoOpenPath, requestTabChange, setLiveFileParam]);

  // On commit: exit live mode and rebase onto the new committed version — reuse the SAME post-save
  // refresh path the Design/Files tabs already use, so the version picker + every other tab stay honest.
  const lastCommitNonceRef = useRef(0);
  useEffect(() => {
    if (!live.committed || live.committed.nonce === lastCommitNonceRef.current) return;
    lastCommitNonceRef.current = live.committed.nonce;
    void handleDesignSaved(live.committed.versionId);
  }, [live.committed, handleDesignSaved]);

  // A genuine (non-400) live-workspace check/fetch failure is a best-effort BACKGROUND check — surface
  // it without blocking the (still fully usable) committed-version Files view.
  useEffect(() => {
    if (live.filesError) {
      notifyError("Couldn’t check the assistant’s live workspace", {
        description: `${live.filesError} The committed version below is still available; refresh the page to check again.`,
      });
    }
  }, [live.filesError]);

  // The diff base: the version the live workspace actually opened FROM when observed live, else the
  // skill's currently-viewed committed version (an honest fallback for a late subscriber that missed
  // the `workspace_opened` frame — see the hook's module doc; `skills_open_workspace` itself defaults to
  // the skill's CURRENT version when the agent doesn't pick one, so this is right in the common case).
  const liveBaseVersionId = live.baseVersionId ?? activeVersionId ?? null;

  // "Pull latest" (GitHub): pull upstream, and if a NEW version landed, refresh + deep-link into
  // Diff(previous → new). An unchanged tree lands a toast and leaves the view untouched.
  const handlePull = useCallback(async () => {
    setPulling(true);
    try {
      const result = await pullSkill(skillId);
      if ("unchanged" in result) {
        toast.info("Already up to date", { description: "The upstream tree hasn’t changed." });
        return;
      }
      // A new version — reload the skill + versions so the new row is present.
      const [loadedSkill, loadedVersions] = await Promise.all([
        getSkill(skillId),
        listSkillVersions(skillId),
      ]);
      const sorted = [...loadedVersions].sort((a, b) => b.seq - a.seq);
      setSkill(loadedSkill);
      setVersions(sorted);
      setSelection(LATEST);
      setUpstream(null);
      const newVersion = sorted.find((v) => v.id === result.id) ?? sorted[0];
      const prevVersion = sorted.find((v) => v.seq === (newVersion?.seq ?? 0) - 1) ?? sorted[1];
      if (newVersion && prevVersion) {
        openDiff(prevVersion.id, newVersion.id);
        toast.success(`Pulled v${newVersion.seq}`, {
          description: "Showing the diff vs the previous version.",
        });
      }
    } catch (err) {
      notifyError("Couldn’t pull the latest version", {
        description: `${getErrorMessage(err, "The pull didn’t go through.")} Check the connection and try again.`,
      });
    } finally {
      setPulling(false);
    }
  }, [skillId, openDiff]);

  // "Set as latest" (Versions tab): restore an OLDER version as a NEW head version — non-destructive,
  // the in-between versions are kept. On success reload the skill + versions (the new row + moved head
  // pointer), reset the selection to LATEST, and deep-link into Diff(previous head → new) so the user
  // sees exactly what reverting changed. An unchanged tree (restoring a version identical to the
  // current head) lands an info toast and leaves the view untouched. Mirrors `handlePull`.
  const handleRestore = useCallback(
    async (versionId: string) => {
      setRestoringId(versionId);
      try {
        const result = await restoreSkillVersion(skillId, versionId);
        if ("unchanged" in result) {
          toast.info("Already the latest", {
            description: "That version’s content already matches the current latest version.",
          });
          return;
        }
        const [loadedSkill, loadedVersions] = await Promise.all([
          getSkill(skillId),
          listSkillVersions(skillId),
        ]);
        const sorted = [...loadedVersions].sort((a, b) => b.seq - a.seq);
        setSkill(loadedSkill);
        setVersions(sorted);
        setSelection(LATEST);
        const newVersion = sorted.find((v) => v.id === result.version.id) ?? sorted[0];
        const prevVersion = sorted.find((v) => v.seq === (newVersion?.seq ?? 0) - 1) ?? sorted[1];
        if (newVersion && prevVersion) {
          openDiff(prevVersion.id, newVersion.id);
        }
        toast.success(`Restored as v${newVersion?.seq}`, {
          description:
            "The chosen version is now the latest. Showing the diff vs the previous latest.",
        });
      } catch (err) {
        notifyError("Couldn’t set that version as the latest", {
          description: `${getErrorMessage(err, "The restore didn’t go through.")} Check the connection and try again.`,
        });
      } finally {
        setRestoringId(null);
      }
    },
    [skillId, openDiff],
  );

  // After a successful publish, reload the skill + versions so a freshly-bound skill immediately
  // shows the GitHub source badge + "Pull latest" affordance (and re-runs the upstream check),
  // without any navigation. Non-binding publishes are harmless to refetch too.
  const handlePublished = useCallback(async () => {
    const [loadedSkill, loadedVersions] = await Promise.all([
      getSkill(skillId),
      listSkillVersions(skillId),
    ]);
    setSkill(loadedSkill);
    setVersions([...loadedVersions].sort((a, b) => b.seq - a.seq));
  }, [skillId]);

  if (error) {
    return (
      <StatePanel
        kind="error"
        title="Couldn’t load skill — refresh the page to try again."
        description={error}
      />
    );
  }
  if (!skill) {
    return <StatePanel kind="loading" title="Loading skill…" loadingLabel="Loading skill…" />;
  }

  const isGithub = skill.sourceType === "github";

  return (
    // Full-height inspector under the unified PageShell frame; stays full-width (width="full") and
    // fills its height so the tabbed master-detail layout is preserved.
    <PageShell
      width="full"
      scroll="fill"
      className="flex h-full min-h-0 flex-col"
      contentClassName="flex min-h-0 flex-1 flex-col"
      headerVariant="toolbar"
      header={
        // Toolbar standard (2026-07-11): breadcrumb → ONE ViewToolbar row → content. Identity is the
        // breadcrumb leaf (App.tsx publishes `skill.displayName`), NOT an in-page H1 (D-TB1); the
        // description is dropped here because it is repeated verbatim in the Overview/Frontmatter card.
        <ViewToolbar
          left={
            <>
              {/* Version picker — LATEST tracks the current version, or a pinned version id. */}
              <div className="w-56 shrink-0">
                <Select value={selection} onValueChange={requestSelectionChange}>
                  <SelectTrigger size="sm" className="w-full" aria-label="Version">
                    <SelectValue placeholder="Version" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={LATEST}>
                      Latest
                      {latestVersionId
                        ? ` (v${versions.find((v) => v.id === latestVersionId)?.seq ?? "?"})`
                        : ""}
                    </SelectItem>
                    {versionOptions.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Source chip — GitHub-bound (a real out-link to the repo + a settings affordance
                  for the tracked repo/ref/subpath/token) or uploaded. */}
              {isGithub && skill.github ? (
                <>
                  <Button
                    asChild
                    variant="outline"
                    size="sm"
                    className="shrink-0"
                    title="Open the source repository on GitHub"
                  >
                    <a
                      href={skill.github.repoUrl.replace(/\.git$/, "")}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <GitBranch className="size-3.5" /> GitHub
                      <ExternalLink className="size-3" aria-hidden />
                    </a>
                  </Button>
                  <IconButton
                    variant="ghost"
                    size="icon-sm"
                    className="shrink-0"
                    onClick={() => setSourceOpen(true)}
                    label="GitHub source settings (repository, branch, token)"
                  >
                    <Settings2 aria-hidden className="size-4" />
                  </IconButton>
                </>
              ) : (
                <Badge variant="outline" className="shrink-0">
                  Upload
                </Badge>
              )}
              {upstream?.updateAvailable ? (
                <Badge variant="warning" className="shrink-0">
                  Update available
                </Badge>
              ) : null}
            </>
          }
          actions={
            <>
              {/* RM-30 WP 7.1 (I2) — the one authoring entry point. The inspector reads a skill;
                  the Studio edits it, and owns the only save path. */}
              <Button asChild size="sm" className="shrink-0">
                <Link to={skillStudioPath(skillId)}>
                  <PencilRuler aria-hidden /> Edit in Studio
                </Link>
              </Button>

              {/* Icon-only action cluster (tooltips carry the labels, like the Servers toolbar).
                  Push vs Publish is EITHER/OR: a repo-bound skill pushes back to its source; an
                  unbound skill publishes to a brand-new repo. */}
              <ButtonGroup>
                {/* "Pull latest" (GitHub) → on a new version, deep-links into Diff(prev → new). */}
                {isGithub ? (
                  <IconButton
                    variant="outline"
                    size="icon"
                    label={pulling ? "Pulling…" : "Pull latest"}
                    onClick={() => void handlePull()}
                    disabled={pulling}
                  >
                    <RefreshCw aria-hidden className={pulling ? "animate-spin" : undefined} />
                  </IconButton>
                ) : null}

                {/* "Push to GitHub" (version-scoped, bound skills only) → commit this version back
                    to the bound source repo directly, or open a PR against the tracked branch. */}
                {isGithub && activeVersionId ? (
                  <IconButton
                    variant="outline"
                    size="icon"
                    label="Push to GitHub"
                    onClick={() => setPushOpen(true)}
                  >
                    <GitPullRequest aria-hidden />
                  </IconButton>
                ) : null}

                {/* "Publish to GitHub" (version-scoped, UNBOUND skills only) → create a new repo. */}
                {!isGithub && activeVersionId ? (
                  <IconButton
                    variant="outline"
                    size="icon"
                    label="Publish to GitHub"
                    onClick={() => setPublishOpen(true)}
                  >
                    <Upload aria-hidden />
                  </IconButton>
                ) : null}

                {activeVersionId ? (
                  // IconButton can't accept `asChild` (D-TB5 — it would dissolve into a Slot and
                  // break the icon-child composition), and this needs to stay a REAL download <a>
                  // (native "Save As" / browser download UI). So — like the memory-stack cross-link
                  // — it manually replicates IconButton's Tooltip mechanism: one label fed to both
                  // the anchor's `aria-label` and the tooltip.
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button asChild variant="outline" size="icon" aria-label="Download .zip">
                        <a href={skillExportUrl(skillId, activeVersionId)} download>
                          <Download aria-hidden />
                        </a>
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Download .zip</TooltipContent>
                  </Tooltip>
                ) : null}
              </ButtonGroup>
            </>
          }
        />
      }
    >
      {/* The breadcrumb (Skills / <name>) names the page; keep an AT-only H1 for screen readers now
          that the in-page title block is gone (toolbar standard D-TB1) — mirrors CompareWorkspace. */}
      <Heading level={1} className="sr-only">
        {skill.displayName}
      </Heading>

      {/* Tabs */}
      <Tabs value={tab} onValueChange={requestTabChange} className="flex min-h-0 flex-1 flex-col">
        {/* O4 (2026-07-06 owner): tab order Overview · Design · Files · Quality · Usage · Versions ·
            Diff. RM-30 WP 7.1 brings Design back as a READ-ONLY flow preview (authoring is the
            Studio's). Trace stays hidden — its lens rides the same canvas and lands with WP 7.6; a
            stale `trace` tab value redirects to Files via the effect below. */}
        <TabsList className="shrink-0">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="design">Design</TabsTrigger>
          <TabsTrigger value="files">Files</TabsTrigger>
          <TabsTrigger value="quality">Quality</TabsTrigger>
          <TabsTrigger value="usage">Usage</TabsTrigger>
          <TabsTrigger value="issues">
            Issues
            {/* Open-count suffix only when > 0 — mirrors TabPanel's muted, value-neutral count. */}
            {openIssuesCount && openIssuesCount > 0 ? (
              <span className="ml-1.5 tabular-nums text-muted-foreground">{openIssuesCount}</span>
            ) : null}
          </TabsTrigger>
          <TabsTrigger value="security">
            Security
            {/* WP 2.1 — the REPORT's `counts.total`, never the rendered row count; suffix only when
                > 0, mirroring how Issues renders its own count above. */}
            {securityCount && securityCount > 0 ? (
              <span className="ml-1.5 tabular-nums text-muted-foreground">{securityCount}</span>
            ) : null}
          </TabsTrigger>
          <TabsTrigger value="versions">Versions</TabsTrigger>
          <TabsTrigger value="diff">Diff</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="min-h-0 flex-1 overflow-y-auto pt-4">
          {filesError ? (
            <StatePanel
              kind="error"
              title="Couldn’t load version — switch versions or refresh the page to try again."
              description={filesError}
            />
          ) : !version || !files ? (
            <StatePanel kind="loading" title="Loading version…" loadingLabel="Loading version…" />
          ) : (
            <SkillOverview
              skillId={skillId}
              version={version}
              files={files}
              isHeadVersion={isHeadVersion}
              onOpenFlow={() => requestTabChange("design")}
            />
          )}
        </TabsContent>

        <TabsContent value="usage" className="min-h-0 flex-1 overflow-y-auto pt-4">
          <SkillUsageTab skillId={skillId} />
        </TabsContent>

        {/* ── ISSUES — deduplicated rating issues filed against this skill (auto-learning loop).
            "Fix with assistant" opens the dock PREFILLED (never auto-sent) pinned to this skill;
            the actual edit lands as a new immutable version via the existing approval-gated
            workspace flow. Rendered only while the assistant is configured (the dock is hidden
            entirely otherwise — same gate as AppShell's dock toggle). ── */}
        <TabsContent value="issues" className="min-h-0 flex-1 overflow-y-auto pt-4">
          <IssuesPanel
            targetKind="skill"
            targetId={skillId}
            targetName={skill.displayName}
            state={issuesState}
            onReload={reloadIssues}
            onFixWithAssistant={
              assistant.authConfigured
                ? (issue) =>
                    assistant.openAssistant({
                      entity: { kind: "skill", id: skillId },
                      prompt: buildIssueFixPrompt(skill.displayName, issue),
                    })
                : undefined
            }
          />
        </TabsContent>

        {/* ── SECURITY — this VERSION's posture: score, band, per-severity counts, the findings
            worst-first with their redacted evidence, and an optional diff against another version of
            the same skill. A skill finding never prints the word "server" (D-SP12): its anchors are
            "This skill version" and relative file paths. ── */}
        <TabsContent value="security" className="min-h-0 flex-1 overflow-y-auto pt-4">
          {activeVersionId ? (
            <SecurityPanel
              target={{ kind: "skill", skillId, versionId: activeVersionId }}
              baselines={securityBaselines}
              state={securityReport.state}
              onRetry={securityReport.reload}
            />
          ) : (
            <StatePanel kind="loading" title="Loading version…" loadingLabel="Loading version…" />
          )}
        </TabsContent>

        {/* RM-30 WP 7.1 (I2) — Design is a READ-ONLY flow preview. No palette, no node editor, no
            draft, no save bar: the one action is "Edit in Studio". */}
        <TabsContent value="design" className="flex min-h-0 flex-1 flex-col pt-4">
          {filesError ? (
            <StatePanel
              kind="error"
              title="Couldn’t load version — switch versions or refresh the page to try again."
              description={filesError}
            />
          ) : !activeVersionId ? (
            <StatePanel kind="loading" title="Loading version…" loadingLabel="Loading version…" />
          ) : (
            <SkillFlowPreview
              skillId={skillId}
              versionId={activeVersionId}
              isHeadVersion={isHeadVersion}
            />
          )}
        </TabsContent>

        <TabsContent value="trace" className="flex min-h-0 flex-1 flex-col pt-4">
          {filesError ? (
            <StatePanel
              kind="error"
              title="Couldn’t load version — switch versions or refresh the page to try again."
              description={filesError}
            />
          ) : !activeVersionId ? (
            <StatePanel kind="loading" title="Loading version…" loadingLabel="Loading version…" />
          ) : (
            <SkillTraceView
              skillId={skillId}
              versionId={activeVersionId}
              onVersionSaved={(newVersionId) => void handleDesignSaved(newVersionId)}
              onOpenDiff={openDiff}
            />
          )}
        </TabsContent>

        <TabsContent value="quality" className="min-h-0 flex-1 overflow-y-auto pt-4">
          {filesError ? (
            <StatePanel
              kind="error"
              title="Couldn’t load version — switch versions or refresh the page to try again."
              description={filesError}
            />
          ) : !activeVersionId ? (
            <StatePanel kind="loading" title="Loading version…" loadingLabel="Loading version…" />
          ) : (
            <QualityView
              skillId={skillId}
              versionId={activeVersionId}
              onVersionSaved={(newVersionId) => void handleDesignSaved(newVersionId)}
              onOpenDiff={openDiff}
              onOpenDesign={() => requestTabChange("files")}
            />
          )}
        </TabsContent>

        <TabsContent value="files" className="flex min-h-0 flex-1 flex-col pt-4">
          {filesError ? (
            <StatePanel
              kind="error"
              title="Couldn’t load files — switch versions or refresh the page to try again."
              description={filesError}
            />
          ) : !files || !activeVersionId ? (
            <StatePanel kind="loading" title="Loading files…" loadingLabel="Loading files…" />
          ) : live.isLive && assistant.activeAssistantThreadId && liveBaseVersionId ? (
            // WP R1.4 (D-AS22) — the assistant has this skill's workspace open: mirror its LIVE,
            // uncommitted files instead of the committed-version editor. Read-only — no editing
            // controls here; the single commit stays the dock's gated `skills_commit_workspace`.
            <LiveSkillWorkspaceView
              threadId={assistant.activeAssistantThreadId}
              skillId={skillId}
              baseVersionId={liveBaseVersionId}
              files={live.files}
              changedPaths={live.changedPaths}
              selectedPath={liveSelectedPath}
              onSelectPath={(path) => setLiveFileParam(path, { forceFilesTab: true })}
              changeNonce={live.autoOpenNonce}
            />
          ) : (
            // RM-30 WP 7.4 — browse-only: the tree and a read-only preview, with "Edit in Studio"
            // as the one action. It can no longer save, so it needs no `onVersionSaved`.
            <SkillFileExplorer
              skillId={skillId}
              versionId={activeVersionId}
              files={files}
              onTestTool={handleTestTool}
            />
          )}
        </TabsContent>

        <TabsContent value="versions" className="min-h-0 flex-1 overflow-y-auto pt-4">
          <SkillVersions
            versions={versions}
            selectedIds={compareSelection}
            onToggleSelect={toggleCompare}
            onCompare={openDiff}
            latestVersionId={latestVersionId}
            onRestore={handleRestore}
            restoringId={restoringId}
          />
        </TabsContent>

        <TabsContent value="diff" className="min-h-0 flex-1 overflow-y-auto pt-4">
          <SkillDiffView
            skillId={skillId}
            versions={versions}
            fromId={diffFromId}
            toId={diffToId}
            onChangeFrom={setDiffFromId}
            onChangeTo={setDiffToId}
          />
        </TabsContent>
      </Tabs>

      {/* WP 8.5 — the inline tool-runner Sheet, opened from the Design tool card / hover + Files hover. */}
      <ToolRunnerSheet tool={testTool} onClose={() => setTestTool(null)} />

      {activeVersionId ? (
        <PublishGithubDialog
          open={publishOpen}
          onOpenChange={setPublishOpen}
          skillId={skillId}
          versionId={activeVersionId}
          versionLabel={(() => {
            const v = versions.find((entry) => entry.id === activeVersionId);
            return v ? formatVersionLabel(v) : undefined;
          })()}
          defaultRepoName={skill.slug}
          alreadyBound={isGithub}
          onPublished={() => void handlePublished()}
        />
      ) : null}

      {/* GitHub source settings — edit the tracked repo/ref/subpath + set/clear the stored PAT.
          `handlePublished` refetches the skill, which also re-runs the upstream check. */}
      {isGithub ? (
        <GithubSourceDialog
          open={sourceOpen}
          onOpenChange={setSourceOpen}
          skill={skill}
          onSaved={() => void handlePublished()}
        />
      ) : null}

      {/* Push this version back to the bound source repo (direct commit or PR). A direct push
          moves the tracked branch to our own commit — refetch so lastSha/upstream stay honest. */}
      {isGithub && activeVersionId ? (
        <PushGithubDialog
          open={pushOpen}
          onOpenChange={setPushOpen}
          skill={skill}
          versionId={activeVersionId}
          versionLabel={(() => {
            const v = versions.find((entry) => entry.id === activeVersionId);
            return v ? formatVersionLabel(v) : undefined;
          })()}
          onPushed={() => void handlePublished()}
        />
      ) : null}
    </PageShell>
  );
}
