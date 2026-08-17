import { useEffect, useMemo, useRef, useState } from "react";
import type {
  BoundTool,
  ServerConfig,
  ServerType,
  SkillEditsResponse,
  SkillServerBinding,
} from "@mcp-token-footprint/shared";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  StatePanel,
  Text,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  toast,
} from "@elabs-ai/components-ui";
import { AlertTriangle, CircleDashed, Link2, Server, Tags, X } from "lucide-react";
import { apiGet, apiPost, listServerTypes } from "../../lib/api";
import { getErrorMessage } from "../../lib/errors";
import { ConfirmDialog } from "../../components/dialogs";
import { IconButton } from "../../components/IconButton";
import { ServerTypeStatusBadge } from "../servers/ServerTypeStatusBadge";
import {
  deriveBindCandidates,
  deriveBindTypeCandidates,
  type BindCandidate,
  type BindTypeCandidate,
} from "./design/bind-server-candidates";
import { buildBindingChips, type BindingChip } from "./design/binding-display";
import { BindServerDialog, useServerDirectory } from "./design/BindServerDialog";
import {
  addFrontmatterServer,
  parseFrontmatterServers,
  removeFrontmatterServer,
} from "./design/frontmatter-servers";
import { fetchSkillBindings, getBoundTools, getSkill, getSkillFile } from "./skills-inspector-api";
import { notifyError } from "../../lib/notify";

// The skill↔server (and WP 3.2 server-TYPE) binding surface, RELOCATED out of the parked Design-tab
// Tools palette so it is reachable from the Overview AND Files tabs (the Design tab is hidden per owner
// decision O2b, which made the palette's binding UI unreachable). It reuses — unchanged — every proven
// piece of the palette's flow: `frontmatter-servers.ts` (byte-preserving `servers:` edits), the
// `bind-server-candidates.ts` derivations, the `binding-display.ts` chip model, the standalone
// `BindServerDialog` (Servers + Types sections), and the SAME content-canonical save the palette used
// (`POST /api/skills/:id/save-draft`, head-guarded 409 → `onVersionSaved`). No wire/API/DB change.
//
// Read-only-safe by construction: it only ever reads persisted scans/registries + edits SKILL.md
// frontmatter through the save-draft route. It never opens an MCP connection or runs a scan.

export type SkillBindingsPanelProps = {
  skillId: string;
  /** The version whose SKILL.md frontmatter these chips reflect — a bind/unbind saves a NEW version
   *  FROM this one, so it must still be the skill's head (the save 409s otherwise). */
  versionId: string;
  /** True when `versionId` is the skill's CURRENT version. `false` ⇒ the chips are READ-ONLY (bindings
   *  are edited on the latest version only). */
  isHeadVersion: boolean;
  /** The committed SKILL.md text, when the host already has it (the Overview tab loads it) — a seed so
   *  the chips render without a load flash. `null`/omitted ⇒ the panel loads SKILL.md itself (Files). */
  skillMdText?: string | null;
  /** A host-supplied reason binding is unavailable right now (e.g. the Files workspace has unsaved
   *  edits — the two save paths must not race). When set, bind/unbind are disabled and it renders inline. */
  blockedReason?: string | null;
  /** The inspector's refresh-and-select-new-version callback — fired after a bind/unbind lands a new
   *  immutable version (same contract as the editor's own save). */
  onVersionSaved: (newVersionId: string) => void;
};

/**
 * Resolved-binding chips + a "Bind server…" picker, host-agnostic (the Overview wraps it in a Card,
 * the Files tab in a compact strip). Renders a server-TYPE binding distinctly (type name + lifecycle
 * status + resolved representative) from a plain server binding, and NEVER guesses a representative.
 */
export function SkillBindingsPanel({
  skillId,
  versionId,
  isHeadVersion,
  skillMdText,
  blockedReason = null,
  onVersionSaved,
}: SkillBindingsPanelProps) {
  // ── The declared binding list = the version's SAVED SKILL.md frontmatter `servers:` ──────────────
  // Seeded from the host's text when provided (no flash); otherwise loaded here, mirroring the palette.
  // `md` is a LOCAL overlay so a bind/unbind reflects in the chips immediately, before the inspector
  // switches versions — a fresh `skillMdText`/`versionId` re-syncs it.
  const [md, setMd] = useState<string | null>(skillMdText ?? null);
  const [mdBinary, setMdBinary] = useState(false);
  const [mdError, setMdError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    // The host already has the committed text — trust it (no fetch), reset any prior overlay/errors.
    if (skillMdText != null) {
      setMd(skillMdText);
      setMdBinary(false);
      setMdError(null);
      return;
    }
    // Otherwise load SKILL.md ourselves (the Files tab doesn't pre-load it).
    setMd(null);
    setMdBinary(false);
    setMdError(null);
    getSkillFile(skillId, versionId, "SKILL.md")
      .then((content) => {
        if (cancelled) return;
        if (content.isBinary) setMdBinary(true);
        else setMd(content.text);
      })
      .catch((err: unknown) => {
        if (!cancelled) setMdError(getErrorMessage(err, "Couldn’t load SKILL.md"));
      });
    return () => {
      cancelled = true;
    };
  }, [skillId, versionId, skillMdText]);

  const declaredServers = useMemo(
    () => (md === null ? [] : parseFrontmatterServers(md)),
    [md],
  );

  // ── Resolved bindings + type/server directories + bound-tool counts (all best-effort, read-only) ──
  // A fetch failure DEGRADES every chip to the plain server rendering (never a fabricated type). The
  // bound-tools read only supplies each chip's tool count; its absence shows the honest "no tools yet".
  const [resolvedBindings, setResolvedBindings] = useState<SkillServerBinding[]>([]);
  const [serverTypes, setServerTypes] = useState<ServerType[]>([]);
  const [serverDirectory, setServerDirectory] = useState<ServerConfig[]>([]);
  const [boundTools, setBoundTools] = useState<BoundTool[]>([]);
  const [metaLoaded, setMetaLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setMetaLoaded(false);
    Promise.all([
      fetchSkillBindings(skillId),
      listServerTypes(),
      apiGet<ServerConfig[]>("/api/servers"),
      getBoundTools(skillId, versionId).catch(() => [] as BoundTool[]),
    ])
      .then(([bindingsList, typesList, serversList, tools]) => {
        if (cancelled) return;
        setResolvedBindings(bindingsList);
        setServerTypes(typesList);
        setServerDirectory(serversList);
        setBoundTools(tools);
        setMetaLoaded(true);
      })
      .catch(() => {
        if (cancelled) return;
        // Honest degradation: plain server chips, no type metadata, no counts.
        setResolvedBindings([]);
        setServerTypes([]);
        setServerDirectory([]);
        setBoundTools([]);
        setMetaLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [skillId, versionId]);

  /** serverName → resolved tool count from the latest completed scans of the bound servers. */
  const toolCountByServer = useMemo(() => {
    const counts = new Map<string, number>();
    for (const tool of boundTools) {
      counts.set(tool.serverName, (counts.get(tool.serverName) ?? 0) + 1);
    }
    return counts;
  }, [boundTools]);

  const chips = useMemo(
    () =>
      buildBindingChips(
        declaredServers,
        resolvedBindings,
        serverTypes,
        serverDirectory,
        toolCountByServer,
      ),
    [declaredServers, resolvedBindings, serverTypes, serverDirectory, toolCountByServer],
  );

  // ── bind/unbind through the content-canonical save (head-guarded, host-dirty-guarded) ────────────
  const [bindOpen, setBindOpen] = useState(false);
  const [unbindTarget, setUnbindTarget] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const busyRef = useRef(false);

  const directory = useServerDirectory(bindOpen);
  const candidates = useMemo(
    () => deriveBindCandidates(directory.servers, directory.scans, declaredServers),
    [directory.servers, directory.scans, declaredServers],
  );
  const typeCandidates = useMemo(
    () => deriveBindTypeCandidates(serverTypes, directory.servers, directory.scans, declaredServers),
    [serverTypes, directory.servers, directory.scans, declaredServers],
  );

  // The panel's own blockers (binary/unreadable SKILL.md) fold into the host's `blockedReason`, so a
  // single reason drives both the disabled state and the inline Alert.
  const activeBlockedReason: string | null =
    blockedReason ??
    (mdBinary
      ? "SKILL.md is binary — its frontmatter can’t be edited."
      : mdError
        ? `SKILL.md couldn’t be loaded: ${mdError}`
        : null);
  const canManage = isHeadVersion && activeBlockedReason === null && busyKey === null;

  /** Run one binding edit end-to-end: fresh reads → mutate frontmatter → save-draft → hand over. */
  async function applyBindingEdit(
    busyKeyValue: string,
    mutate: (text: string) => string,
    note: string,
    successTitle: string,
  ): Promise<boolean> {
    if (!isHeadVersion || busyRef.current) return false;
    busyRef.current = true;
    setBusyKey(busyKeyValue);
    try {
      // Fresh reads at action time: the head must still be the viewed version (the save would 409
      // anyway — this just gives the clearer message), and the text must be current.
      const [skill, file] = await Promise.all([
        getSkill(skillId),
        getSkillFile(skillId, versionId, "SKILL.md"),
      ]);
      if (skill.currentVersionId !== versionId) {
        notifyError("Not the latest version", {
          description: "Bindings are edited on the latest version — switch to it and try again.",
        });
        return false;
      }
      if (file.isBinary) {
        notifyError("SKILL.md is binary", { description: "Its frontmatter can’t be edited." });
        return false;
      }
      const next = mutate(file.text);
      if (next === file.text) {
        toast.info("No change", { description: "The servers: list is already in that state." });
        setMd(file.text);
        return true;
      }
      const response = await apiPost<SkillEditsResponse>(`/api/skills/${skillId}/save-draft`, {
        baseVersionId: versionId,
        content: next,
        treeOps: [],
        intentLog: [],
        note,
      });
      if ("unchanged" in response) {
        toast.info("No change", { description: "The edit left SKILL.md identical." });
        return true;
      }
      setMd(next); // chips reflect the edit immediately, before the inspector switches versions
      toast.success(successTitle, {
        description: `Saved as v${response.version.seq} — the frontmatter servers: list was updated.`,
      });
      onVersionSaved(response.version.id);
      return true;
    } catch (err) {
      notifyError("Couldn’t update the binding", {
        description: getErrorMessage(err, "The save was rejected — reload the skill and try again."),
      });
      return false;
    } finally {
      busyRef.current = false;
      setBusyKey(null);
    }
  }

  const handleBind = async (candidate: BindCandidate) => {
    const ok = await applyBindingEdit(
      candidate.serverId,
      (text) => addFrontmatterServer(text, candidate.serverName),
      `Bind server "${candidate.serverName}"`,
      "Server bound",
    );
    if (ok) setBindOpen(false);
  };

  // Binding a TYPE writes the TYPE NAME into `servers:` (same save path) — the API resolver maps it to
  // the type's representative member at read time. The busy key is the typeId (distinct from serverIds).
  const handleBindType = async (candidate: BindTypeCandidate) => {
    const ok = await applyBindingEdit(
      candidate.typeId,
      (text) => addFrontmatterServer(text, candidate.typeName),
      `Bind server type "${candidate.typeName}"`,
      "Server type bound",
    );
    if (ok) setBindOpen(false);
  };

  const handleUnbind = async (name: string) => {
    const ok = await applyBindingEdit(
      name,
      (text) => removeFrontmatterServer(text, name),
      `Unbind server "${name}"`,
      "Server unbound",
    );
    if (ok) setUnbindTarget(null);
  };

  const loadingChips = md === null && !mdBinary && !mdError;

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex flex-col gap-0.5">
        <Text variant="caption" tone="muted" className="font-medium">
          Bound servers &amp; types
        </Text>
        <Text variant="meta" tone="muted">
          The MCP servers (or server types) this skill is bound to, from its SKILL.md frontmatter.
          Binding never opens a connection or runs a scan.
        </Text>
      </div>

      {/* Non-head hint: bindings are edited on the latest version only. */}
      {!isHeadVersion ? (
        <Text variant="meta" tone="muted">
          Viewing an older version — switch to Latest to change its server bindings.
        </Text>
      ) : null}

      {/* Blocked (host dirty / unreadable SKILL.md): a single inline reason, actions disabled. */}
      {isHeadVersion && activeBlockedReason !== null ? (
        <Alert variant="warning">
          <AlertTriangle />
          <AlertTitle>Binding is unavailable right now</AlertTitle>
          <AlertDescription>{activeBlockedReason}</AlertDescription>
        </Alert>
      ) : null}

      {loadingChips ? (
        <StatePanel kind="loading" size="sm" title="Loading bindings…" loadingLabel="Loading bindings…" />
      ) : mdError ? (
        <StatePanel
          kind="error"
          size="sm"
          title="Couldn’t read SKILL.md — refresh the page to try again."
          description={mdError}
        />
      ) : chips.length === 0 ? (
        <Text variant="meta" tone="muted">
          Not bound to any server yet — the frontmatter <span className="font-mono">servers:</span>{" "}
          list is empty.
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

      {isHeadVersion ? (
        <div className="flex">
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="inline-block">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={activeBlockedReason !== null || busyKey !== null || !metaLoaded}
                  onClick={() => setBindOpen(true)}
                >
                  <Link2 aria-hidden />
                  <span>Bind server…</span>
                </Button>
              </span>
            </TooltipTrigger>
            <TooltipContent>
              {activeBlockedReason ??
                "Pick a registered server or type — its name is written to the servers: frontmatter."}
            </TooltipContent>
          </Tooltip>
        </div>
      ) : null}

      <BindServerDialog
        open={bindOpen}
        onOpenChange={setBindOpen}
        loading={directory.loading}
        error={directory.error}
        candidates={candidates}
        typeCandidates={typeCandidates}
        blockedReason={activeBlockedReason}
        busyKey={busyKey}
        onBind={(candidate) => void handleBind(candidate)}
        onBindType={(candidate) => void handleBindType(candidate)}
      />

      <ConfirmDialog
        open={unbindTarget !== null}
        onOpenChange={(open) => {
          if (!open && busyKey === null) setUnbindTarget(null);
        }}
        title="Unbind server"
        description={
          unbindTarget !== null
            ? `Removes “${unbindTarget}” from the servers: list in SKILL.md frontmatter and saves a new immutable version. Tool references into this server will report as unknown until it's bound again.`
            : undefined
        }
        confirmLabel="Unbind & save"
        busy={busyKey !== null}
        onConfirm={() => {
          if (unbindTarget !== null) void handleUnbind(unbindTarget);
        }}
      />
    </div>
  );
}

/** One bound-server chip: the declared frontmatter name, its resolved tool count (or an honest "no
 *  tools yet" marker), and — when binding is available — the unbind ×. (Lifted from the Tools palette.) */
function ServerChip({
  name,
  toolCount,
  canUnbind,
  onUnbind,
}: {
  name: string;
  /** Resolved tool count from the bound-tools read; null ⇒ unscanned or not a registered name. */
  toolCount: number | null;
  canUnbind: boolean;
  onUnbind: () => void;
}) {
  return (
    <li className="min-w-0">
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex min-w-0">
            <Badge variant="outline" className="max-w-full gap-1 pe-0.5">
              <Server className="size-3 shrink-0 text-muted-foreground" aria-hidden />
              <Text as="span" variant="meta" className="min-w-0 truncate font-mono" title={name}>
                {name}
              </Text>
              {toolCount === null ? (
                <CircleDashed className="size-3 shrink-0 text-muted-foreground" aria-hidden />
              ) : (
                <Text as="span" variant="meta" tone="muted" className="shrink-0 tabular-nums">
                  {toolCount}
                </Text>
              )}
              {canUnbind ? (
                <IconButton
                  variant="ghost"
                  size="icon"
                  className="size-4 shrink-0"
                  label={`Unbind server ${name}`}
                  onClick={onUnbind}
                >
                  <X aria-hidden />
                </IconButton>
              ) : null}
            </Badge>
          </span>
        </TooltipTrigger>
        <TooltipContent>
          {toolCount === null
            ? "No tools yet — the server has no completed scan, or no registered server matches this name."
            : `${toolCount} ${toolCount === 1 ? "tool" : "tools"} from the latest completed scan.`}
        </TooltipContent>
      </Tooltip>
    </li>
  );
}

/** One TYPE-bound chip: the declared type name (Tags glyph), the type's lifecycle status, and the
 *  resolved representative member — or an honest "no representative yet" state when no member has a
 *  completed scan. The representative is chosen by the API resolver (D-ST3); this chip only reports it.
 *  (Lifted from the Tools palette.) */
function TypeChip({
  chip,
  canUnbind,
  onUnbind,
}: {
  chip: Extract<BindingChip, { kind: "type" }>;
  canUnbind: boolean;
  onUnbind: () => void;
}) {
  const label = chip.typeName ?? chip.name;
  const hasRep = chip.representativeId !== null;
  return (
    <li className="min-w-0">
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex min-w-0">
            <Badge variant="outline" className="max-w-full gap-1 pe-0.5">
              <Tags className="size-3 shrink-0 text-muted-foreground" aria-hidden />
              <Text as="span" variant="meta" className="min-w-0 truncate font-mono" title={label}>
                {label}
              </Text>
              <Text as="span" variant="meta" tone="muted" className="shrink-0">
                Type
              </Text>
              {chip.status ? <ServerTypeStatusBadge status={chip.status} /> : null}
              {hasRep && chip.toolCount !== null ? (
                <Text as="span" variant="meta" tone="muted" className="shrink-0 tabular-nums">
                  {chip.toolCount}
                </Text>
              ) : (
                <CircleDashed className="size-3 shrink-0 text-muted-foreground" aria-hidden />
              )}
              {canUnbind ? (
                <IconButton
                  variant="ghost"
                  size="icon"
                  className="size-4 shrink-0"
                  label={`Unbind server type ${label}`}
                  onClick={onUnbind}
                >
                  <X aria-hidden />
                </IconButton>
              ) : null}
            </Badge>
          </span>
        </TooltipTrigger>
        <TooltipContent>
          {hasRep
            ? `Server type — resolves to representative “${
                chip.representativeName ?? "a scanned member"
              }” (the member with the newest successful scan).${
                chip.toolCount !== null
                  ? ` ${chip.toolCount} ${chip.toolCount === 1 ? "tool" : "tools"} from its latest completed scan.`
                  : ""
              }`
            : "Server type — no representative yet: no member has a completed scan. Tools appear once a member is scanned."}
        </TooltipContent>
      </Tooltip>
    </li>
  );
}
