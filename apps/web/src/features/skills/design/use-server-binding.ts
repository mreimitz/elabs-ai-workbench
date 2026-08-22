import { useCallback, useEffect, useMemo, useState } from "react";
import type { ScanDetail, ServerConfig, ServerType } from "@mcp-token-footprint/shared";
import { toast } from "@elabs-ai/components-ui";
import { apiPost, listServerTypes } from "../../../lib/api";
import { getErrorMessage } from "../../../lib/errors";
import { notifyError } from "../../../lib/notify";
import { fetchSkillBindings, getBoundTools } from "../skills-inspector-api";
import {
  deriveBindCandidates,
  deriveBindTypeCandidates,
  type BindCandidate,
  type BindTypeCandidate,
} from "./bind-server-candidates";
import { buildBindingChips, type BindingChip } from "./binding-display";
import { useServerDirectory } from "./BindServerDialog";

// ── RM-30 WP 7.7 — ONE server-binding read, shared by the two surfaces that offer binding ─────────
// WP 7.3 put binding in the Studio's Settings panel; WP 7.7's components palette grows an "MCP
// Servers" section that also binds, unbinds and lists a server's tools. The WP prompt is explicit
// that these two must not become a second binding UI that DISAGREES with the first — so the read
// (registered servers · scans · resolved bindings · types · per-server tool counts), the chip model
// and the inline "Scan now" live here once, and both surfaces mount this hook.
//
// It reads only. Binding itself is a `stageSettingsEdit` on the ONE Studio draft, owned by the
// caller — this hook never writes to the skill, so a second mount can't produce a second save path
// (which is exactly the deviation D-UX18 that WP 7.3 closed).

export type SkillServerBindingSurface = {
  /** One row per declared frontmatter name, in declaration order. */
  chips: BindingChip[];
  /** Registered servers that could still be bound. */
  candidates: BindCandidate[];
  /** Registered server TYPES that could still be bound. */
  typeCandidates: BindTypeCandidate[];
  /** True while the registered-server directory is loading (drives the picker's own state). */
  directoryLoading: boolean;
  directoryError: string | null;
  /** The server whose discovery scan is running right now, or `null`. */
  scanningServerId: string | null;
  /** Run a discovery scan for an unscanned registered server (SI1's missing half). Read-only with
   *  respect to the skill: it stages nothing and can never interfere with a pending save. */
  scan: (candidate: BindCandidate) => void;
  /** Re-read the directory + bindings (after a bind/unbind lands, say). */
  refresh: () => void;
};

/**
 * @param active `false` keeps the registered-server directory unfetched until something needs it
 *   (the picker opening, or the servers section being expanded).
 */
export function useSkillServerBinding(
  skillId: string,
  versionId: string,
  declaredServers: readonly string[],
  active: boolean,
): SkillServerBindingSurface {
  const [nonce, setNonce] = useState(0);
  const [scanningServerId, setScanningServerId] = useState<string | null>(null);

  const directory = useServerDirectory(active || nonce > 0);

  const [serverTypes, setServerTypes] = useState<ServerType[]>([]);
  const [resolvedBindings, setResolvedBindings] = useState<
    Awaited<ReturnType<typeof fetchSkillBindings>>
  >([]);
  const [toolCountByServer, setToolCountByServer] = useState<Map<string, number>>(new Map());

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      listServerTypes().catch(() => [] as ServerType[]),
      fetchSkillBindings(skillId).catch(() => []),
      getBoundTools(skillId, versionId).catch(() => []),
    ])
      .then(([types, bindings, tools]) => {
        if (cancelled) return;
        setServerTypes(types);
        setResolvedBindings(bindings);
        const counts = new Map<string, number>();
        for (const tool of tools) {
          counts.set(tool.serverName, (counts.get(tool.serverName) ?? 0) + 1);
        }
        setToolCountByServer(counts);
      })
      .catch(() => {
        /* honest degradation — plain chips, no counts */
      });
    return () => {
      cancelled = true;
    };
  }, [skillId, versionId]);

  const servers = directory.servers as ServerConfig[];

  const chips = useMemo(
    () => buildBindingChips(declaredServers, resolvedBindings, serverTypes, servers, toolCountByServer),
    [declaredServers, resolvedBindings, serverTypes, servers, toolCountByServer],
  );

  const candidates = useMemo(
    () => deriveBindCandidates(servers, directory.scans, declaredServers),
    [servers, directory.scans, declaredServers],
  );
  const typeCandidates = useMemo(
    () => deriveBindTypeCandidates(serverTypes, servers, directory.scans, declaredServers),
    [serverTypes, servers, directory.scans, declaredServers],
  );

  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  const scan = useCallback((candidate: BindCandidate) => {
    setScanningServerId(candidate.serverId);
    void (async () => {
      try {
        const scanResult = await apiPost<ScanDetail>(`/api/servers/${candidate.serverId}/scan`, {});
        if (scanResult.status === "success") {
          toast.success("Scan completed", {
            description: `${candidate.serverName}: ${scanResult.totalTools} tools, ${scanResult.totalTokens.toLocaleString()} tokens.`,
          });
        } else {
          notifyError("The scan didn’t complete", {
            description:
              scanResult.errorMessage ??
              "The server reported no tools. Check it on the Servers page.",
          });
        }
      } catch (err) {
        notifyError("Couldn’t run the scan", {
          description: getErrorMessage(err, "The scan request didn’t go through. Try again."),
        });
      } finally {
        setScanningServerId(null);
        // Re-read the directory so the row reflects the scan it just ran.
        setNonce((n) => n + 1);
      }
    })();
  }, []);

  return {
    chips,
    candidates,
    typeCandidates,
    directoryLoading: directory.loading,
    directoryError: directory.error,
    scanningServerId,
    scan,
    refresh,
  };
}
