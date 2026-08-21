import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import type { SkillFileNode } from "@mcp-token-footprint/shared";
import {
  Button,
  Heading,
  ToggleGroup,
  ToggleGroupItem,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  Text,
} from "@elabs-ai/components-ui";
import { ArrowLeft, Code2, Columns2, TriangleAlert, Workflow } from "lucide-react";
import { PageShell } from "../../../components/PageShell";
import { ViewToolbar } from "../../../components/ViewToolbar";
import { DiscardChangesDialog } from "../../../components/UnsavedChangesGuard";
import { SkillDesignView } from "../design/SkillDesignView";
import type { SkillProblemsSummary } from "../design/ProblemsPanel";
import { getSkillFiles } from "../skills-inspector-api";
import { StudioContextPanel } from "./StudioContextPanel";
import { StudioLeftRail, isStudioLeftRailTab, type StudioLeftRailTab } from "./StudioLeftRail";
import { StudioRail } from "./StudioRail";
import { readStudioRailCollapsed, writeStudioRailCollapsed } from "./studio-layout";
import {
  isStudioMode,
  readStudioUrlState,
  STUDIO_DEFAULT_FILE,
  writeStudioUrlState,
  type StudioMode,
} from "./studio-url";

// ── Skill Studio (RM-30 WP 7.1) — the workbench frame ─────────────────────────────────────────────
// One full-viewport surface: a slim, never-scrolling toolbar
// (`[← Exit] [Flow | Code | Split] [Problems n] … [dirty] [Save…]`), a collapsible left rail
// (Files · Tools · Settings), the editor as the CENTRE surface, a collapsible right context panel
// that starts collapsed — never a reserved blank column — and the unified Problems strip along the
// bottom. `PageShell scroll="fill" bodyGutter="none"` gives it a viewport-filling frame with no
// outer scroll, so the toolbar cannot scroll away and each region owns its own overflow.
//
// The editing itself is the SAME `SkillDesignView` → `UnifiedEditor` chain the inspector used to
// mount; it is moved here rather than re-implemented, and it hands its chrome (the save cluster, the
// problems panel) to this shell through the additive slots the WP added to it.

const LEFT_RAIL_KEY = "left";
const CONTEXT_RAIL_KEY = "context";

export type StudioShellProps = {
  skillId: string;
  /** The skill's display name — the toolbar's screen-reader heading. */
  skillName: string;
  /** The version being authored (the head, unless the URL pins one). */
  versionId: string;
  /** True when `versionId` is the skill's current version. */
  isHeadVersion: boolean;
  /** The version label shown beside the exit control, e.g. "v4". */
  versionLabel: string;
  /** A save (or a bind/unbind) landed a NEW immutable version — the route re-points onto it. */
  onVersionSaved: (newVersionId: string) => void;
  /** Where Exit goes (the skill's inspector). */
  exitTo: string;
};

export function StudioShell({
  skillId,
  skillName,
  versionId,
  isHeadVersion,
  versionLabel,
  onVersionSaved,
  exitTo,
}: StudioShellProps) {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const urlState = readStudioUrlState(searchParams);
  const { mode, sel } = urlState;
  void sel; // read below, once, for the mount-time selection seed
  const file = urlState.file ?? STUDIO_DEFAULT_FILE;

  const applyUrlState = useCallback(
    (next: Parameters<typeof writeStudioUrlState>[1]) => {
      setSearchParams((prev) => writeStudioUrlState(prev, next), { replace: true });
    },
    [setSearchParams],
  );

  const setMode = useCallback((next: StudioMode) => applyUrlState({ mode: next }), [applyUrlState]);
  const setFile = useCallback(
    (next: string) => applyUrlState({ file: next === STUDIO_DEFAULT_FILE ? null : next }),
    [applyUrlState],
  );
  // Stable by construction — `UnifiedEditor` publishes the selection through this on every change,
  // so an unstable identity here would re-fire its effect on every render.
  const handleSelectedNodeChange = useCallback(
    (nodeId: string | undefined) => applyUrlState({ sel: nodeId ?? null }),
    [applyUrlState],
  );

  // The `?sel=` value at MOUNT — the editor seeds its canvas selection from it once. Read through a
  // lazy initializer so a later URL write (the editor publishing its own selection) can't re-seed.
  const [initialSel] = useState<string | null>(sel);

  // ── rails ────────────────────────────────────────────────────────────────────────────────────
  // Left opens by default (an author needs the file/tool/settings surface); the right context panel
  // starts COLLAPSED, per the WP: it is opened when there is something to look at, never held open
  // as an empty column.
  const [leftTab, setLeftTab] = useState<StudioLeftRailTab>("files");
  const [leftCollapsed, setLeftCollapsedState] = useState(() =>
    readStudioRailCollapsed(LEFT_RAIL_KEY, false),
  );
  const [contextCollapsed, setContextCollapsedState] = useState(() =>
    readStudioRailCollapsed(CONTEXT_RAIL_KEY, true),
  );
  const setLeftCollapsed = useCallback((next: boolean) => {
    setLeftCollapsedState(next);
    writeStudioRailCollapsed(LEFT_RAIL_KEY, next);
  }, []);
  const setContextCollapsed = useCallback((next: boolean) => {
    setContextCollapsedState(next);
    writeStudioRailCollapsed(CONTEXT_RAIL_KEY, next);
  }, []);

  // ── the editor's chrome, handed up through the WP 7.1 slots ──────────────────────────────────
  const [saveActions, setSaveActions] = useState<ReactNode>(null);
  const [problemsPanel, setProblemsPanel] = useState<ReactNode>(null);
  // Where the editor PAINTS its two flow side panels: a mount point in each rail. The editor
  // portals into these, so exactly one Tools palette and one Node details panel exist, they stay in
  // the editor's tree (live draft, live bound tools), and nothing travels through this shell's state
  // on every editor render. A `null` container simply means that rail is collapsed or on another
  // tab right now, and the editor renders nothing there.
  const [toolsContainer, setToolsContainer] = useState<HTMLDivElement | null>(null);
  const [detailContainer, setDetailContainer] = useState<HTMLDivElement | null>(null);
  const [problemsSummary, setProblemsSummary] = useState<SkillProblemsSummary | null>(null);
  const [problemsOpen, setProblemsOpen] = useState(false);
  const [dirty, setDirty] = useState(false);

  // ── rail data (read-only; the editor owns the draft) ─────────────────────────────────────────
  const [files, setFiles] = useState<SkillFileNode[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    setFiles(null);
    getSkillFiles(skillId, versionId)
      .then((loaded) => {
        if (!cancelled) setFiles(loaded);
      })
      .catch(() => {
        // The rail degrades to an empty tree; the editor is unaffected (it loads its own document).
        if (!cancelled) setFiles([]);
      });
    return () => {
      cancelled = true;
    };
  }, [skillId, versionId]);

  // ── exit, guarded by the shared discard dialog when the draft is dirty ───────────────────────
  const [exitConfirming, setExitConfirming] = useState(false);
  const requestExit = useCallback(() => {
    if (dirty) {
      setExitConfirming(true);
      return;
    }
    navigate(exitTo);
  }, [dirty, navigate, exitTo]);

  const problemsCount = problemsSummary?.total ?? 0;
  const problemsTone = useMemo(() => {
    if (!problemsSummary || problemsSummary.total === 0) return "outline" as const;
    if (problemsSummary.error > 0) return "destructive" as const;
    return "secondary" as const;
  }, [problemsSummary]);

  const toolbar = (
    <ViewToolbar
      left={
        <>
          <Button variant="ghost" size="sm" onClick={requestExit}>
            <ArrowLeft aria-hidden /> Exit
          </Button>
          <span aria-hidden className="h-5 w-px shrink-0 bg-border" />

          <ToggleGroup
            type="single"
            variant="segmented"
            value={mode}
            onValueChange={(value) => {
              if (isStudioMode(value)) setMode(value);
            }}
            aria-label="Editor view"
          >
            <ToggleGroupItem value="flow" aria-label="Show flow">
              <Workflow className="size-4" aria-hidden /> Flow
            </ToggleGroupItem>
            <ToggleGroupItem value="code" aria-label="Show code">
              <Code2 className="size-4" aria-hidden /> Code
            </ToggleGroupItem>
            <ToggleGroupItem value="split" aria-label="Split view">
              <Columns2 className="size-4" aria-hidden /> Split
            </ToggleGroupItem>
          </ToggleGroup>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant={problemsTone === "destructive" ? "destructive" : "outline"}
                size="sm"
                aria-expanded={problemsOpen}
                onClick={() => setProblemsOpen((open) => !open)}
              >
                <TriangleAlert aria-hidden /> Problems{" "}
                <span className="tabular-nums">{problemsCount}</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {problemsOpen ? "Hide the problems list" : "Show the problems list"}
            </TooltipContent>
          </Tooltip>

          <Text variant="meta" tone="muted" className="min-w-0 truncate">
            {versionLabel}
            {isHeadVersion ? "" : " · not the latest version"}
          </Text>
        </>
      }
      actions={saveActions}
    />
  );

  return (
    <PageShell
      width="full"
      scroll="fill"
      bodyGutter="none"
      headerVariant="toolbar"
      header={toolbar}
      className="flex h-full min-h-0 flex-col"
      contentClassName="flex min-h-0 flex-1 flex-col"
    >
      {/* The breadcrumb names the page (Skills / <skill> / Studio); keep an AT-only H1 the way every
          other toolbar-header route does (D-TB1). */}
      <Heading level={1} className="sr-only">
        {skillName} — Studio
      </Heading>

      <div className="flex min-h-0 flex-1 flex-col" data-testid="studio-body">
        <div className="flex min-h-0 flex-1">
          <StudioRail
            side="start"
            label="Workspace"
            collapsed={leftCollapsed}
            onCollapsedChange={setLeftCollapsed}
            testId="studio-left-rail"
          >
            <StudioLeftRail
              skillId={skillId}
              versionId={versionId}
              isHeadVersion={isHeadVersion}
              tab={leftTab}
              onTabChange={setLeftTab}
              files={files}
              selectedFile={file}
              onSelectFile={setFile}
              toolsContainerRef={setToolsContainer}
              onVersionSaved={onVersionSaved}
              bindingBlockedReason={
                dirty ? "Save or discard your unsaved edits before changing servers." : null
              }
            />
          </StudioRail>

          {/* The centre surface: `flex-1 min-w-0`, so it takes everything the two fixed rails leave. */}
          <section
            aria-label="Editor"
            className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden p-3"
            data-testid="studio-center"
          >
            <SkillDesignView
              skillId={skillId}
              versionId={versionId}
              hideModeToggle
              onDirtyChange={setDirty}
              onVersionSaved={onVersionSaved}
              onOpenDiff={() => navigate(`${exitTo}?tab=diff`)}
              onHeaderActionsChange={setSaveActions}
              onProblemsChange={setProblemsPanel}
              problemsOpen={problemsOpen}
              onProblemsOpenChange={setProblemsOpen}
              onProblemsSummaryChange={setProblemsSummary}
              onSelectedNodeChange={handleSelectedNodeChange}
              flowToolsContainer={toolsContainer}
              flowDetailContainer={detailContainer}
              {...(initialSel ? { initialSelectedNodeId: initialSel } : {})}
            />
          </section>

          <StudioRail
            side="end"
            label="Context"
            collapsed={contextCollapsed}
            onCollapsedChange={setContextCollapsed}
            testId="studio-context-panel"
          >
            <StudioContextPanel containerRef={setDetailContainer} />
          </StudioRail>
        </div>

        {/* The unified Problems strip, spanning the workbench. Registered by the editor so it reads
            the SAME live projection the canvas and the code decorations do. */}
        <div className="shrink-0 border-t border-border" data-testid="studio-problems">
          {problemsPanel}
        </div>
      </div>

      <DiscardChangesDialog
        open={exitConfirming}
        onConfirm={() => {
          setExitConfirming(false);
          navigate(exitTo);
        }}
        onCancel={() => setExitConfirming(false)}
      />
    </PageShell>
  );
}
