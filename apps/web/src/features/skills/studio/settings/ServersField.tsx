import { useCallback, useState } from "react";
import { Alert, AlertDescription, AlertTitle, Button, Text } from "@elabs-ai/components-ui";
import { AlertTriangle, Link2 } from "lucide-react";
import { ConfirmDialog } from "../../../../components/dialogs";
import type { BindCandidate, BindTypeCandidate } from "../../design/bind-server-candidates";
import { BindServerDialog } from "../../design/BindServerDialog";
import { ServerChip, TypeChip } from "../../design/BindingChips";
import { useSkillServerBinding } from "../../design/use-server-binding";

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

  // RM-30 WP 7.7 — the registered-server directory, the resolved bindings, the chip model and the
  // inline "Scan now" are ONE hook now, shared with the components palette's MCP Servers section.
  // Two surfaces that offer binding must not hold two opinions about what is bound.
  const binding = useSkillServerBinding(skillId, versionId, declaredServers, true);
  const chips = binding.chips;
  const candidates = binding.candidates;
  const typeCandidates = binding.typeCandidates;

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
        loading={binding.directoryLoading}
        error={binding.directoryError}
        candidates={candidates}
        typeCandidates={typeCandidates}
        blockedReason={blockedReason}
        busyKey={null}
        onBind={handleBind}
        onBindType={handleBindType}
        onScan={binding.scan}
        scanningServerId={binding.scanningServerId}
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
