import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { ScanSummary, ServerConfig } from "@mcp-token-footprint/shared";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Card,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Spinner,
  StatePanel,
  Text,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@brand/ui";
import { AlertTriangle, Link2, Server, Tags } from "lucide-react";
import { apiGet } from "../../../lib/api";
import { getErrorMessage } from "../../../lib/errors";
import { formatDateTime } from "../../../lib/format";
import { StatusBadge } from "../../../components/StatusBadge";
import { ServerTypeStatusBadge } from "../../servers/ServerTypeStatusBadge";
import type {
  BindCandidate,
  BindCandidateDisabledReason,
  BindTypeCandidate,
  BindTypeCandidateDisabledReason,
} from "./bind-server-candidates";

// Skill Studio WP 7.3a (audit SI1) — the first-class "Bind server" picker: REGISTERED servers only
// (from the existing `/api/servers` + `/api/scans` reads — the same pair the scaffold wizard uses),
// each with its transport + last-scan status. Selecting one writes the server's NAME into the draft
// SKILL.md frontmatter `servers:` list through the palette's save flow — this dialog itself never
// scans, never opens an MCP connection, and never mutates anything.

/**
 * Fetch the registered-server directory (servers + scan summaries) whenever `active` turns true —
 * the palette mounts this once and the list refreshes on every dialog open. A failure degrades to an
 * inline error inside the dialog (never a toastless blank).
 */
export function useServerDirectory(active: boolean): {
  servers: ServerConfig[];
  scans: ScanSummary[];
  loading: boolean;
  error: string | null;
} {
  const [servers, setServers] = useState<ServerConfig[]>([]);
  const [scans, setScans] = useState<ScanSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all([apiGet<ServerConfig[]>("/api/servers"), apiGet<ScanSummary[]>("/api/scans")])
      .then(([serverList, scanList]) => {
        if (cancelled) return;
        setServers(serverList);
        setScans(scanList);
      })
      .catch((err: unknown) => {
        if (!cancelled)
          setError(getErrorMessage(err, "Couldn’t load the registered servers"));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [active]);

  return { servers, scans, loading, error };
}

const TRANSPORT_LABEL: Record<string, string> = {
  stdio: "stdio",
  streamable_http: "HTTP",
};

const DISABLED_REASON_LABEL: Record<BindCandidateDisabledReason, string> = {
  "already-bound": "Already bound",
  "ambiguous-name": "Ambiguous name",
};

const DISABLED_REASON_HINT: Record<BindCandidateDisabledReason, string> = {
  "already-bound": "This server's name is already in the skill's servers: list.",
  "ambiguous-name":
    "Two registered servers share this exact name, so a frontmatter name can never resolve to it — rename one under Servers first.",
};

const TYPE_DISABLED_REASON_LABEL: Record<BindTypeCandidateDisabledReason, string> = {
  "already-bound": "Already bound",
  "name-collision": "Shadowed by a server",
};

const TYPE_DISABLED_REASON_HINT: Record<BindTypeCandidateDisabledReason, string> = {
  "already-bound": "This type's name is already in the skill's servers: list.",
  "name-collision":
    "A registered server shares this exact name, so a frontmatter entry resolves to that server, not the type — rename one under Servers first.",
};

export type BindServerDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  loading: boolean;
  error: string | null;
  candidates: BindCandidate[];
  /** Server-types WP 3.2 (B) — the registered server TYPES, offered as a distinct "Types" section.
   *  Binding one writes the TYPE NAME into `servers:` (the resolver maps it to its representative). */
  typeCandidates?: BindTypeCandidate[];
  /** When set, EVERY bind action is disabled and this reason renders inline (dirty draft, older
   *  version, unreadable SKILL.md, …). */
  blockedReason: string | null;
  /** The key (serverId OR typeId) whose bind-save is in flight — its row shows a spinner; all rows
   *  disable. One key drives both sections (server ids and type ids never collide). */
  busyKey: string | null;
  onBind: (candidate: BindCandidate) => void;
  /** Bind a server TYPE (writes the type name into `servers:`). Omitted ⇒ the Types section is hidden. */
  onBindType?: (candidate: BindTypeCandidate) => void;
};

/**
 * The bind-server picker dialog. Rows are REGISTERED servers; a row with no completed scan is still
 * bindable (binding is a frontmatter declaration) but says honestly that tools only appear after a
 * discovery scan, with a link to the server page — scans are never triggered from here.
 */
export function BindServerDialog({
  open,
  onOpenChange,
  loading,
  error,
  candidates,
  typeCandidates,
  blockedReason,
  busyKey,
  onBind,
  onBindType,
}: BindServerDialogProps) {
  const busy = busyKey !== null;
  const types = onBindType ? (typeCandidates ?? []) : [];
  const showTypes = onBindType !== undefined;
  const nothingToBind = candidates.length === 0 && types.length === 0;
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!busy) onOpenChange(next);
      }}
    >
      <DialogContent size="lg" className="flex max-h-[85vh] flex-col gap-0 p-0">
        <DialogHeader className="flex-none gap-1 border-b border-border p-4 pe-12">
          <DialogTitle>Bind a server or type</DialogTitle>
          <DialogDescription>
            Binding writes the server's or type's name into the `servers:` list of this skill's
            SKILL.md frontmatter and saves it as a new immutable version. A type resolves to its
            representative member (the one with the newest successful scan). Tools come from the
            latest completed scan — binding never opens a connection or runs a scan.
          </DialogDescription>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
          {blockedReason ? (
            <Alert variant="warning">
              <AlertTriangle />
              <AlertTitle>Binding is unavailable right now</AlertTitle>
              <AlertDescription>{blockedReason}</AlertDescription>
            </Alert>
          ) : null}
          {error ? (
            <Alert variant="destructive">
              <AlertTriangle />
              <AlertTitle>Couldn’t load servers — close and reopen this dialog to try again.</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}

          {loading ? (
            <StatePanel
              kind="loading"
              size="sm"
              title="Loading servers…"
              loadingLabel="Loading servers…"
            />
          ) : nothingToBind && !error ? (
            <StatePanel
              kind="empty"
              size="sm"
              icon={<Server aria-hidden />}
              title="No registered servers or types"
              description="Register an MCP server (or create a server type) first — then bind it here."
              actions={
                <Button asChild variant="outline" size="sm">
                  <Link to="/servers">Open Servers</Link>
                </Button>
              }
            />
          ) : (
            <>
              {candidates.length > 0 ? (
                <section className="flex flex-col gap-1.5">
                  {showTypes ? (
                    <div className="flex items-center gap-1.5">
                      <Server className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                      <Text variant="caption" tone="muted" className="font-medium">
                        Servers
                      </Text>
                    </div>
                  ) : null}
                  <ul className="flex flex-col gap-1.5">
                    {candidates.map((candidate) => (
                      <CandidateRow
                        key={candidate.serverId}
                        candidate={candidate}
                        blocked={blockedReason !== null}
                        busy={busy}
                        bindInFlight={busyKey === candidate.serverId}
                        onBind={onBind}
                      />
                    ))}
                  </ul>
                </section>
              ) : null}

              {showTypes && types.length > 0 ? (
                <section className="flex flex-col gap-1.5">
                  <div className="flex items-center gap-1.5">
                    <Tags className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                    <Text variant="caption" tone="muted" className="font-medium">
                      Types
                    </Text>
                  </div>
                  <ul className="flex flex-col gap-1.5">
                    {types.map((candidate) => (
                      <TypeCandidateRow
                        key={candidate.typeId}
                        candidate={candidate}
                        blocked={blockedReason !== null}
                        busy={busy}
                        bindInFlight={busyKey === candidate.typeId}
                        onBind={onBindType!}
                      />
                    ))}
                  </ul>
                </section>
              ) : null}
            </>
          )}
        </div>

        <DialogFooter className="flex-none border-t border-border p-4">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** One registered server row: identity + transport + last-scan status, and the Bind action (or the
 *  reason it's unavailable). */
function CandidateRow({
  candidate,
  blocked,
  busy,
  bindInFlight,
  onBind,
}: {
  candidate: BindCandidate;
  blocked: boolean;
  busy: boolean;
  bindInFlight: boolean;
  onBind: (candidate: BindCandidate) => void;
}) {
  const disabledReason = candidate.disabledReason;
  return (
    <li>
      <Card className="flex items-start justify-between gap-3 p-2.5">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            <Server className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
            <Text as="span" className="min-w-0 truncate font-medium" title={candidate.serverName}>
              {candidate.serverName}
            </Text>
            <Badge variant="secondary" className="shrink-0">
              {TRANSPORT_LABEL[candidate.transport] ?? candidate.transport}
            </Badge>
            <StatusBadge status={candidate.lastScanStatus ?? "unscanned"} />
          </div>
          <Text variant="meta" tone="muted">
            {candidate.hasCompletedScan
              ? `${(candidate.scannedTools ?? 0).toLocaleString()} tools in the latest completed scan` +
                (candidate.lastScanAt
                  ? ` · last scanned ${formatDateTime(candidate.lastScanAt)}`
                  : "")
              : "No scan yet — tools appear after a discovery scan."}
          </Text>
          {!candidate.hasCompletedScan ? (
            <Link
              to={`/servers/${candidate.serverId}`}
              className="w-fit text-xs text-primary underline-offset-2 hover:underline"
            >
              View server
            </Link>
          ) : null}
        </div>

        {disabledReason !== null ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="inline-block shrink-0">
                <Button variant="outline" size="sm" disabled>
                  {DISABLED_REASON_LABEL[disabledReason]}
                </Button>
              </span>
            </TooltipTrigger>
            <TooltipContent>{DISABLED_REASON_HINT[disabledReason]}</TooltipContent>
          </Tooltip>
        ) : (
          <Button
            variant="outline"
            size="sm"
            className="shrink-0"
            disabled={blocked || busy}
            onClick={() => onBind(candidate)}
          >
            {bindInFlight ? <Spinner className="size-4" /> : <Link2 aria-hidden />}
            <span>{bindInFlight ? "Binding…" : "Bind"}</span>
          </Button>
        )}
      </Card>
    </li>
  );
}

/** Server-types WP 3.2 (B) — one registered server-type row: type identity + lifecycle status +
 *  member count + the resolved representative member (D-ST3), and the Bind action (or the reason it's
 *  unavailable). A type with no scanned member is still bindable — it says so honestly. */
function TypeCandidateRow({
  candidate,
  blocked,
  busy,
  bindInFlight,
  onBind,
}: {
  candidate: BindTypeCandidate;
  blocked: boolean;
  busy: boolean;
  bindInFlight: boolean;
  onBind: (candidate: BindTypeCandidate) => void;
}) {
  const disabledReason = candidate.disabledReason;
  const members = `${candidate.memberCount.toLocaleString()} ${
    candidate.memberCount === 1 ? "member" : "members"
  }`;
  return (
    <li>
      <Card className="flex items-start justify-between gap-3 p-2.5">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            <Tags className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
            <Text as="span" className="min-w-0 truncate font-medium" title={candidate.typeName}>
              {candidate.typeName}
            </Text>
            <ServerTypeStatusBadge status={candidate.status} />
            <Badge variant="secondary" className="shrink-0 tabular-nums">
              {members}
            </Badge>
          </div>
          <Text variant="meta" tone="muted">
            {candidate.hasRepresentative
              ? `Resolves to “${candidate.representativeName ?? "a scanned member"}” · ${(
                  candidate.representativeTools ?? 0
                ).toLocaleString()} tools in its latest completed scan`
              : "No representative yet — no member has a completed scan. Bindable now; tools appear after a scan."}
          </Text>
        </div>

        {disabledReason !== null ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="inline-block shrink-0">
                <Button variant="outline" size="sm" disabled>
                  {TYPE_DISABLED_REASON_LABEL[disabledReason]}
                </Button>
              </span>
            </TooltipTrigger>
            <TooltipContent>{TYPE_DISABLED_REASON_HINT[disabledReason]}</TooltipContent>
          </Tooltip>
        ) : (
          <Button
            variant="outline"
            size="sm"
            className="shrink-0"
            disabled={blocked || busy}
            onClick={() => onBind(candidate)}
          >
            {bindInFlight ? <Spinner className="size-4" /> : <Link2 aria-hidden />}
            <span>{bindInFlight ? "Binding…" : "Bind type"}</span>
          </Button>
        )}
      </Card>
    </li>
  );
}
