import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "@brand/ui";
import type {
  HubContextInspector,
  HubEffectiveMemory,
  HubFile,
  HubProject,
  HubSession,
  HubWorkspaceSnapshot,
} from "@mcp-token-footprint/shared";
import {
  getHubProject,
  getHubSessionContext,
  listHubArtifacts,
  listHubProjectFiles,
  listHubSessionFiles,
  listHubWorkspaceSnapshots,
  restoreHubWorkspaceSnapshot,
} from "../../../lib/api";
import { getErrorMessage } from "../../../lib/errors";
import type { HubArtifact } from "@mcp-token-footprint/shared";
import type { HubOutputFileEntry } from "./OutputsSection";
import { notifyError } from "../../../lib/notify";

/**
 * Assistant Hub UX (WP1.8 integration, D-HUX3) — the meta rail's DATA layer, moved OUT of the retired
 * `ArtifactCanvas`/`SessionContextPanel`/`WorkspaceFilesPanel` asides and into one hook `AssistantView`
 * owns. The rail's three section components (`ProgressSection`/`OutputsSection`/`ContextSection`) are
 * PURE — they take already-resolved props so they render deterministically from fixtures — so the
 * fetching that used to live inside each retired panel has to live here now.
 *
 * Progress data is NOT here: it (tasks + mission board) is derived synchronously from the live SSE
 * stream in `AssistantView` itself. This hook covers only the two async layers — Outputs (artifacts +
 * session files + workspace snapshots) and Context (project + pinned files + the R-SES7 context
 * inspector, which additionally carries the WP1.5 `effectiveMemory` stack). Everything re-fetches when
 * the session changes AND on the falling edge of `turnRunning` (a settled turn may have produced a new
 * artifact/file or shifted the context window — the same settle signal `ArtifactCanvas` used).
 *
 * A monotonic request token guards every async write so a slow response for a session the owner has
 * since switched away from can never clobber the current session's data (the retired panels used a
 * per-effect `cancelled` flag; one shared token is the multi-request equivalent).
 */
export type MetaRailData = {
  // Outputs
  artifacts: HubArtifact[];
  files: HubOutputFileEntry[];
  snapshots: HubWorkspaceSnapshot[];
  restoring: boolean;
  restoreSnapshot: (snapshotId: string) => Promise<void>;
  // Context
  project: HubProject | null;
  projectLoaded: boolean;
  projectError: string | null;
  pinnedFiles: HubFile[];
  inspector: HubContextInspector | null;
  inspectorLoaded: boolean;
  inspectorError: string | null;
  /** WP2.7 — promoted to `@mcp-token-footprint/shared`; `null` while unresolved/absent (an older
   *  cached payload, or no session). */
  effectiveMemory: HubEffectiveMemory | null;
  refresh: () => void;
};

const EMPTY_OUTPUTS: {
  artifacts: HubArtifact[];
  files: HubOutputFileEntry[];
  snapshots: HubWorkspaceSnapshot[];
} = { artifacts: [], files: [], snapshots: [] };

export function useMetaRailData(session: HubSession | null, turnRunning: boolean): MetaRailData {
  const sessionId = session?.id ?? null;
  const projectId = session?.projectId ?? null;

  const [outputs, setOutputs] = useState(EMPTY_OUTPUTS);
  const [restoring, setRestoring] = useState(false);

  const [project, setProject] = useState<HubProject | null>(null);
  const [pinnedFiles, setPinnedFiles] = useState<HubFile[]>([]);
  const [projectLoaded, setProjectLoaded] = useState(true);
  const [projectError, setProjectError] = useState<string | null>(null);

  const [inspector, setInspector] = useState<HubContextInspector | null>(null);
  const [inspectorLoaded, setInspectorLoaded] = useState(true);
  const [inspectorError, setInspectorError] = useState<string | null>(null);
  const [effectiveMemory, setEffectiveMemory] = useState<HubEffectiveMemory | null>(null);

  // Bumped on every (re)load; a resolved fetch whose token is stale is dropped (the owner switched
  // sessions, or a newer refresh started).
  const requestRef = useRef(0);

  const load = useCallback(() => {
    const token = ++requestRef.current;
    const fresh = () => requestRef.current === token;

    if (!sessionId) {
      setOutputs(EMPTY_OUTPUTS);
      setProject(null);
      setPinnedFiles([]);
      setProjectLoaded(true);
      setProjectError(null);
      setInspector(null);
      setInspectorLoaded(true);
      setInspectorError(null);
      setEffectiveMemory(null);
      return;
    }

    // ── Outputs — best-effort (empty on failure; the section shows its own "no outputs" state). ──
    void (async () => {
      try {
        const [artifacts, sessionFiles, snapshots] = await Promise.all([
          listHubArtifacts({ session: sessionId }),
          listHubSessionFiles(sessionId),
          listHubWorkspaceSnapshots(sessionId),
        ]);
        if (!fresh()) return;
        setOutputs({
          artifacts,
          files: sessionFiles.map(({ file, link }): HubOutputFileEntry => ({ file, link })),
          snapshots,
        });
      } catch {
        if (fresh()) setOutputs(EMPTY_OUTPUTS);
      }
    })();

    // ── Context: project + pinned files (only when the session is in a project). ──
    if (!projectId) {
      setProject(null);
      setPinnedFiles([]);
      setProjectLoaded(true);
      setProjectError(null);
    } else {
      setProjectLoaded(false);
      setProjectError(null);
      void (async () => {
        try {
          const [proj, files] = await Promise.all([
            getHubProject(projectId),
            listHubProjectFiles(projectId),
          ]);
          if (!fresh()) return;
          setProject(proj);
          setPinnedFiles(files);
        } catch (error) {
          if (!fresh()) return;
          setProjectError(getErrorMessage(error));
          setProject(null);
          setPinnedFiles([]);
        } finally {
          if (fresh()) setProjectLoaded(true);
        }
      })();
    }

    // ── Context: the R-SES7 inspector + WP1.5 effective-memory (every session has a window). ──
    setInspectorLoaded(false);
    setInspectorError(null);
    void (async () => {
      try {
        const payload = await getHubSessionContext(sessionId);
        if (!fresh()) return;
        setInspector(payload);
        setEffectiveMemory(payload.effectiveMemory ?? null);
      } catch (error) {
        if (!fresh()) return;
        setInspectorError(getErrorMessage(error));
        setInspector(null);
        setEffectiveMemory(null);
      } finally {
        if (fresh()) setInspectorLoaded(true);
      }
    })();
  }, [sessionId, projectId]);

  useEffect(() => {
    load();
  }, [load]);

  // Re-fetch on the falling edge of `turnRunning` (a just-settled turn may have written an artifact/
  // file or moved the context window) — mirrors `ArtifactCanvas`'s own settle-detection.
  const prevRunningRef = useRef(false);
  useEffect(() => {
    const wasRunning = prevRunningRef.current;
    prevRunningRef.current = turnRunning;
    if (wasRunning && !turnRunning) load();
  }, [turnRunning, load]);

  const restoreSnapshot = useCallback(
    async (snapshotId: string): Promise<void> => {
      if (!sessionId) return;
      setRestoring(true);
      try {
        const { restored } = await restoreHubWorkspaceSnapshot(sessionId, snapshotId);
        toast.success("Workspace restored", {
          description: `${restored} file${restored === 1 ? "" : "s"} restored from the snapshot.`,
        });
        load();
      } catch (error) {
        notifyError("Couldn’t restore the snapshot", { description: getErrorMessage(error) });
      } finally {
        setRestoring(false);
      }
    },
    [sessionId, load],
  );

  return {
    artifacts: outputs.artifacts,
    files: outputs.files,
    snapshots: outputs.snapshots,
    restoring,
    restoreSnapshot,
    project,
    projectLoaded,
    projectError,
    pinnedFiles,
    inspector,
    inspectorLoaded,
    inspectorError,
    effectiveMemory,
    refresh: load,
  };
}
