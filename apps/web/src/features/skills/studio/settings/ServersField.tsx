import { useCallback, useEffect, useMemo, useState } from "react";
import type { ScanDetail, ServerConfig, ServerType } from "@mcp-token-footprint/shared";
import { Alert, AlertDescription, AlertTitle, Button, Text, toast } from "@elabs-ai/components-ui";
import { AlertTriangle, Link2 } from "lucide-react";
import { apiPost, listServerTypes } from "../../../../lib/api";
import { getErrorMessage } from "../../../../lib/errors";
import { notifyError } from "../../../../lib/notify";
import { ConfirmDialog } from "../../../../components/dialogs";
import { fetchSkillBindings, getBoundTools } from "../../skills-inspector-api";
import {
  deriveBindCandidates,
  deriveBindTypeCandidates,
  type BindCandidate,
  type BindTypeCandidate,
} from "../../design/bind-server-candidates";
import { buildBindingChips } from "../../design/binding-display";
import { BindServerDialog, useServerDirectory } from "../../design/BindServerDialog";
import { ServerChip, TypeChip } from "../../design/BindingChips";

// ── Skill Studio (RM-30 WP 7.3, audit SI1/SI3) — the settings panel's SERVERS field ───────────────
// The picker WP 7.3a built, re-pointed at the WP 7.3 draft store. That re-pointing is the whole
// difference and it is the deviation D-UX18 asked for: binding used to POST a new immutable version
// the instant you clicked Bind, which meant a bind and the editor's own save were two competing save
// paths that had to be kept from racing with a dirty-guard. Now a bind stages a `servers:` change on
// the ONE draft — it shows up in the Code view immediately, it is listed in the save dialog, and it
// lands with everything else on a single "Save as vN".
//
// Everything else is reused, not rebuilt: `deriveBindCandidates` / `deriveBindTypeCandidates` (pure,
// unit-tested), `buildBindingChips`, and `BindServerDialog` itself. The one thing added here is SI1's
// missing half — an inline **Scan now** for a registered server that has never been scanned, so an
// author does not have to leave the Studio to make a server's tools appear.

export type ServersFieldProps = {
  skillId: string;
  versionId: string;
  /** The `servers:` names declared by the LIVE draft (not the saved version). */
  declaredServers: string[];
  /** Stage a bind/unbind on the draft. */
  onBind: (name: string) => void;
  onUnbind: (name: string) => void;
  /** A reason the field is read-only right now (an older version is open), or `null`. */
  blockedReason: string | null;
};

export function ServersField({
  skillId,
  versionId,
  declaredServers,
  onBind,
  onUnbind,
  blockedReason,
}: ServersFieldProps) {
  const [bindOpen, setBindOpen] = useState(false);
  const [unbindTarget, setUnbindTarget] = useState<string | null>(null);
  const [scanningServerId, setScanningServerId] = useState<string | null>(null);
  const [directoryNonce, setDirectoryNonce] = useState(0);

  // The registered-server directory + scan summaries. Refetched whenever the dialog opens AND after
  // a scan finishes, so a freshly scanned server's row stops saying "no scan yet".
  const directory = useServerDirectory(bindOpen || directoryNonce > 0);

  // Resolved bindings + type registry + bound-tool counts — all read-only, all best-effort: a failed
  // fetch degrades every chip to the plain server rendering rather than inventing a type.
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
    () =>
      buildBindingChips(
        declaredServers,
        resolvedBindings,
        serverTypes,
        servers,
        toolCountByServer,
      ),
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

  const canManage = blockedReason === null;

  const handleBind = useCallback(
    (candidate: BindCandidate) => {
      onBind(candidate.serverName);
      setBindOpen(false);
    },
    [onBind],
  );

  // Binding a TYPE writes the TYPE NAME into `servers:`; the API resolver maps it to the type's
  // representative member at read time (D-ST3). Same staged edit, different name.
  const handleBindType = useCallback(
    (candidate: BindTypeCandidate) => {
      onBind(candidate.typeName);
      setBindOpen(false);
    },
    [onBind],
  );

  /**
   * SI1's missing half — run a discovery scan for an unscanned server without leaving the Studio.
   * This is the ONLY thing in the settings panel that talks to a server; it changes no skill state
   * and stages nothing on the draft, so it can never interfere with the pending save.
   */
  const handleScan = useCallback(async (candidate: BindCandidate) => {
    setScanningServerId(candidate.serverId);
    try {
      const scan = await apiPost<ScanDetail>(`/api/servers/${candidate.serverId}/scan`, {});
      if (scan.status === "success") {
        toast.success("Scan completed", {
          description: `${candidate.serverName}: ${scan.totalTools} tools, ${scan.totalTokens.toLocaleString()} tokens.`,
        });
      } else {
        notifyError("The scan didn’t complete", {
          description:
            scan.errorMessage ?? "The server reported no tools. Check it on the Servers page.",
        });
      }
    } catch (err) {
      notifyError("Couldn’t run the scan", {
        description: getErrorMessage(err, "The scan request didn’t go through. Try again."),
      });
    } finally {
      setScanningServerId(null);
      // Re-read the directory so the row reflects the scan it just ran.
      setDirectoryNonce((nonce) => nonce + 1);
    }
  }, []);

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex flex-col gap-0.5">
        <Text variant="caption" tone="muted" className="font-medium">
          Servers
        </Text>
        <Text variant="meta" tone="muted" className="text-pretty">
          The MCP servers (or server types) this skill is bound to. Binding writes the name into the
          draft’s <span className="font-mono">servers:</span> frontmatter — it saves with everything
          else, and never opens a connection.
        </Text>
      </div>

      {blockedReason !== null ? (
        <Alert variant="warning">
          <AlertTriangle />
          <AlertTitle>Binding is unavailable right now</AlertTitle>
          <AlertDescription>{blockedReason}</AlertDescription>
        </Alert>
      ) : null}

      {chips.length === 0 ? (
        <Text variant="meta" tone="muted">
          Not bound to any server yet.
        </Text>
      ) : (
        <ul className="flex flex-wrap gap-1">
          {chips.map((chip) =>
            chip.kind === "type" ? (
              <TypeChip
                key={chip.name}
                chip={chip}
                canUnbind={canManage}
                onUnbind={() => setUnbindTarget(chip.name)}
              />
            ) : (
              <ServerChip
                key={chip.name}
                name={chip.name}
                toolCount={chip.toolCount}
                canUnbind={canManage}
                onUnbind={() => setUnbindTarget(chip.name)}
              />
            ),
          )}
        </ul>
      )}

      <div className="flex">
        <Button
          variant="outline"
          size="sm"
          disabled={!canManage}
          onClick={() => setBindOpen(true)}
          data-testid="settings-bind-server"
        >
          <Link2 aria-hidden />
          <span>Bind server…</span>
        </Button>
      </div>

      <BindServerDialog
        open={bindOpen}
        onOpenChange={setBindOpen}
        loading={directory.loading}
        error={directory.error}
        candidates={candidates}
        typeCandidates={typeCandidates}
        blockedReason={blockedReason}
        busyKey={null}
        onBind={handleBind}
        onBindType={handleBindType}
        onScan={(candidate) => void handleScan(candidate)}
        scanningServerId={scanningServerId}
      />

      <ConfirmDialog
        open={unbindTarget !== null}
        onOpenChange={(open) => {
          if (!open) setUnbindTarget(null);
        }}
        title={unbindTarget ? `Unbind “${unbindTarget}”?` : "Unbind"}
        description={
          unbindTarget
            ? `Removes “${unbindTarget}” from the draft’s servers: list. Tool references into this server will report as unknown until it is bound again. Nothing is saved until you save the draft.`
            : undefined
        }
        confirmLabel="Unbind"
        tone="destructive"
        onConfirm={() => {
          if (unbindTarget) onUnbind(unbindTarget);
          setUnbindTarget(null);
        }}
      />
    </div>
  );
}
