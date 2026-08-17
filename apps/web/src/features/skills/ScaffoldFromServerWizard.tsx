import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import type {
  ScaffoldFromServerResult,
  ScanDetail,
  ScanSummary,
  ServerConfig,
  ServerType,
  ToolScan,
} from "@mcp-token-footprint/shared";
import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  Checkbox,
  Input,
  Label,
  RadioGroup,
  RadioGroupItem,
  Spinner,
  StatePanel,
  Text,
  Textarea,
  cn,
} from "@elabs-ai/components-ui";
import { DataTable, SearchInput, type ColumnDef } from "@elabs-ai/components-data";
import { Server, Sparkles, Tags } from "lucide-react";
import { apiGet, listServerTypes } from "../../lib/api";
import { getErrorMessage } from "../../lib/errors";
import { col, shouldPaginate } from "../../lib/table";
import { FieldRow } from "../../components/FieldRow";
import { WideDialog, type WideDialogSection } from "../../components/dialogs";
import { DiscardChangesDialog, useUnsavedChangesGuard } from "../../components/UnsavedChangesGuard";
import { ServerTypeStatusBadge } from "../servers/ServerTypeStatusBadge";
import {
  deriveBindTypeCandidates,
  type BindTypeCandidate,
} from "./design/bind-server-candidates";
import { scaffoldSkillFromServer } from "./skills-inspector-api";

// Mirrors the API's manifest name rule (apps/api/src/skills/manifest.ts) — lowercase letters/digits,
// single hyphens, no leading/trailing/consecutive hyphens. Client-side so the wizard gates "Create"
// and shows an inline hint instead of round-tripping to the API just to learn the name is invalid.
const NAME_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

type WizardStep = "server" | "tools" | "details";

/** Server-types WP 3.2 (B) — scaffold FROM a single server, or FROM a type (bind to the type, read the
 *  representative's tool surface). */
type SourceKind = "server" | "type";

const STEPS = [
  { id: "server", label: "Source" },
  { id: "tools", label: "Tools" },
  { id: "details", label: "Details" },
];

export type ScaffoldFromServerWizardProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called after a successful scaffold with the created skill + its resolved source-server binding. */
  onCreated: (result: ScaffoldFromServerResult) => void;
};

/**
 * The "New skill from server…" wizard (Skill IDE WP 8.4 / I9.4): start a skill FROM a registered
 * server's tool surface. Three steps — pick a server (only servers WITH a completed scan are offered)
 * → multi-select its tools (a `@elabs-ai/components-data` DataTable with per-tool token costs) → name/slug (+ optional
 * display name/description). "Create" POSTs to `/api/skills/scaffold-from-server`; the API reads the
 * server's latest completed scan itself (persisted reads only — never a live probe), composes the
 * SKILL.md (one `##` section + one `tool_ref` per selected tool), creates the skill (v1) + the
 * source-server binding, and returns it. A slug/name collision is a 409 surfaced inline.
 */
export function ScaffoldFromServerWizard(props: ScaffoldFromServerWizardProps) {
  const [step, setStep] = useState<WizardStep>("server");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Eligible-server discovery (reuses the existing scan endpoints — no new listing route).
  const [loadingServers, setLoadingServers] = useState(false);
  const [servers, setServers] = useState<ServerConfig[]>([]);
  // serverId → the server's LATEST success scan summary (the scaffold source scan).
  const [latestSuccessByServer, setLatestSuccessByServer] = useState<Map<string, ScanSummary>>(
    () => new Map(),
  );
  // Server-types WP 3.2 (B) — the type registry + raw scan summaries feed the "Type" source picker.
  const [serverTypes, setServerTypes] = useState<ServerType[]>([]);
  const [scanSummaries, setScanSummaries] = useState<ScanSummary[]>([]);
  const [sourceKind, setSourceKind] = useState<SourceKind>("server");
  // The chosen type (scaffold-from-type): its name is written into frontmatter; its representative
  // provides the tool surface (`serverId` below is set to that representative).
  const [typeId, setTypeId] = useState<string | null>(null);
  const sourceKindFieldId = useId();

  // Selected server + its loaded scan tools.
  const [serverId, setServerId] = useState<string | null>(null);
  const [loadingTools, setLoadingTools] = useState(false);
  const [tools, setTools] = useState<ToolScan[]>([]);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [toolSearch, setToolSearch] = useState("");

  // Details.
  const [name, setName] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [description, setDescription] = useState("");

  const nameTrimmed = name.trim();
  const nameValid = NAME_PATTERN.test(nameTrimmed);
  const nameError =
    nameTrimmed.length > 0 && !nameValid
      ? "Use lowercase letters, digits, and single hyphens (e.g. my-skill)."
      : undefined;

  const selectedServer = servers.find((server) => server.id === serverId) ?? null;
  const sourceScan = serverId ? (latestSuccessByServer.get(serverId) ?? null) : null;

  const eligibleServers = useMemo(
    () =>
      [...servers]
        .filter((server) => latestSuccessByServer.has(server.id))
        .sort((left, right) => left.name.localeCompare(right.name)),
    [servers, latestSuccessByServer],
  );

  // Server-types WP 3.2 (B) — the "Type" source candidates: every registered type resolved to its
  // D-ST3 representative from the same servers × scans inputs the resolver uses. `boundNames: []` — a
  // NEW skill has no frontmatter yet, so `already-bound` never fires; `name-collision` still does (a
  // same-named server would shadow the type). A type is scaffoldable only when it has a representative
  // (a member with a completed scan → a tool surface) AND isn't name-collided.
  const typeCandidates = useMemo(
    () => deriveBindTypeCandidates(serverTypes, servers, scanSummaries, []),
    [serverTypes, servers, scanSummaries],
  );
  const selectedType = typeId
    ? (typeCandidates.find((candidate) => candidate.typeId === typeId) ?? null)
    : null;

  // Reset everything each time the dialog opens so a second run starts clean, then discover servers.
  useEffect(() => {
    if (!props.open) return;
    setStep("server");
    setBusy(null);
    setError(null);
    setSourceKind("server");
    setTypeId(null);
    setServerId(null);
    setTools([]);
    setSelected(new Set());
    setToolSearch("");
    setName("");
    setDisplayName("");
    setDescription("");

    let active = true;
    setLoadingServers(true);
    Promise.all([
      apiGet<ServerConfig[]>("/api/servers"),
      apiGet<ScanSummary[]>("/api/scans"),
      listServerTypes(),
    ])
      .then(([serverList, scanList, typeList]) => {
        if (!active) return;
        // `/api/scans` is newest-first (scanned_at DESC); the first `success` per server is its latest.
        const latest = new Map<string, ScanSummary>();
        for (const scan of scanList) {
          if (scan.status === "success" && !latest.has(scan.serverId))
            latest.set(scan.serverId, scan);
        }
        setServers(serverList);
        setLatestSuccessByServer(latest);
        setScanSummaries(scanList);
        setServerTypes(typeList);
      })
      .catch((caught) => {
        if (active)
          setError(
            getErrorMessage(
              caught,
              "Couldn’t load servers or types — close and reopen this dialog to try again.",
            ),
          );
      })
      .finally(() => {
        if (active) setLoadingServers(false);
      });
    return () => {
      active = false;
    };
  }, [props.open]);

  // M5 — stale-server-pick guard: a request token bumped on every `loadToolsForServer` call. Picking
  // server A then quickly re-picking server B must not let A's (possibly slower) response land after
  // B's and overwrite the tool list with the wrong server's tools — the latest pick always wins.
  const toolsRequestIdRef = useRef(0);

  // Load a scan's tools by SERVER id (persisted read — the API never re-scans). Shared by the server
  // and type pickers (a type loads its representative member's tool surface).
  const loadToolsForServer = useCallback(
    (id: string) => {
      setSelected(new Set());
      setTools([]);
      setError(null);
      const scan = latestSuccessByServer.get(id);
      if (!scan) return;
      const requestId = ++toolsRequestIdRef.current;
      setLoadingTools(true);
      apiGet<ScanDetail>(`/api/scans/${scan.id}`)
        .then((detail) => {
          if (requestId !== toolsRequestIdRef.current) return; // superseded by a newer pick
          setTools(detail.tools);
        })
        .catch((caught) => {
          if (requestId !== toolsRequestIdRef.current) return;
          setError(
            getErrorMessage(caught, "Couldn’t load that server’s tools — pick it again to retry."),
          );
        })
        .finally(() => {
          if (requestId === toolsRequestIdRef.current) setLoadingTools(false);
        });
    },
    [latestSuccessByServer],
  );

  const pickServer = useCallback(
    (id: string) => {
      setTypeId(null);
      setServerId(id);
      loadToolsForServer(id);
    },
    [loadToolsForServer],
  );

  // Server-types WP 3.2 (B) — pick a TYPE: bind to the type, but read its D-ST3 representative's tool
  // surface. `serverId` is set to the representative so the tools step + the API's scan read work
  // unchanged; `typeId` records that this is a type binding (→ `bindTypeName` on Create).
  const pickType = useCallback(
    (candidate: BindTypeCandidate) => {
      if (candidate.representativeId === null) return; // ineligible — no tool surface (guarded in the UI)
      setTypeId(candidate.typeId);
      setServerId(candidate.representativeId);
      loadToolsForServer(candidate.representativeId);
    },
    [loadToolsForServer],
  );

  // Switch the source between a single server and a type — reset any in-progress selection so the two
  // paths never carry each other's state.
  const changeSourceKind = useCallback((next: SourceKind) => {
    setSourceKind(next);
    setTypeId(null);
    setServerId(null);
    setTools([]);
    setSelected(new Set());
    setError(null);
  }, []);

  const toggleTool = useCallback((toolName: string, on: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(toolName);
      else next.delete(toolName);
      return next;
    });
  }, []);

  const allSelected = tools.length > 0 && tools.every((tool) => selected.has(tool.toolName));
  const someSelected = tools.some((tool) => selected.has(tool.toolName));
  const toggleAll = useCallback(
    (on: boolean) => setSelected(on ? new Set(tools.map((tool) => tool.toolName)) : new Set()),
    [tools],
  );

  const columns = useMemo<ColumnDef<ToolScan>[]>(
    () => [
      {
        id: "select",
        enableSorting: false,
        header: () => (
          <Checkbox
            aria-label="Select all tools"
            checked={allSelected ? true : someSelected ? "indeterminate" : false}
            onCheckedChange={(value) => toggleAll(value === true)}
          />
        ),
        cell: ({ row }) => {
          const toolName = row.original.toolName;
          return (
            <Checkbox
              aria-label={`Select ${toolName}`}
              checked={selected.has(toolName)}
              onCheckedChange={(value) => toggleTool(toolName, value === true)}
            />
          );
        },
      },
      col<ToolScan>({
        id: "name",
        header: "Tool",
        value: (tool) => tool.toolName,
        cell: (tool) => <span className="font-mono text-body">{tool.toolName}</span>,
      }),
      col<ToolScan>({
        id: "description",
        header: "Description",
        value: (tool) => tool.description ?? "",
        cell: (tool) => (
          <span className="line-clamp-2 text-muted-foreground">{tool.description || "—"}</span>
        ),
      }),
      col<ToolScan>({
        id: "tokens",
        header: "Tokens",
        numeric: true,
        value: (tool) => tool.totalTokens,
      }),
    ],
    [allSelected, someSelected, selected, toggleAll, toggleTool],
  );

  // Dirty = the user has chosen a source / selected tools / typed identity (so closing mid-add warns).
  const dirty =
    serverId !== null ||
    typeId !== null ||
    selected.size > 0 ||
    nameTrimmed !== "" ||
    displayName.trim() !== "" ||
    description.trim() !== "";
  const guard = useUnsavedChangesGuard(dirty, props.onOpenChange);

  const canAdvanceServer = serverId !== null && !loadingTools;
  const canAdvanceTools = selected.size > 0;
  const canCreate = nameValid && selected.size > 0 && serverId !== null;

  async function create() {
    if (!serverId) return;
    setBusy("create");
    setError(null);
    try {
      const result = await scaffoldSkillFromServer({
        serverId,
        name: nameTrimmed,
        displayName: displayName.trim() || undefined,
        description: description.trim() || undefined,
        // Server-types WP 3.2 (B) — scaffold-from-TYPE writes the TYPE NAME into `servers:` (the new
        // skill binds to the type; `serverId` above is only its representative's tool surface). Omitted
        // for a plain server scaffold, keeping that path byte-identical.
        bindTypeName: sourceKind === "type" ? (selectedType?.typeName ?? undefined) : undefined,
        // Order the selected tool names by the scan's own order (deterministic section order).
        tools: tools.filter((tool) => selected.has(tool.toolName)).map((tool) => tool.toolName),
      });
      props.onCreated(result);
      props.onOpenChange(false);
    } catch (caught) {
      setError(getErrorMessage(caught));
    } finally {
      setBusy(null);
    }
  }

  const errorAlert = error ? (
    <Alert variant="destructive">
      <AlertDescription>{error}</AlertDescription>
    </Alert>
  ) : null;

  const serverContent = (
    <div className="flex flex-col gap-4">
      {errorAlert}
      {loadingServers ? (
        <div className="flex items-center gap-2">
          <Spinner className="size-4" />
          <Text variant="meta" tone="muted">
            Finding servers and types with a completed scan…
          </Text>
        </div>
      ) : (
        <>
          {/* Server-types WP 3.2 (B) — bind to a single server, or to a type. */}
          <RadioGroup
            aria-label="Bind to a server or a type"
            className="grid gap-2 sm:grid-cols-2"
            value={sourceKind}
            onValueChange={(value) => value && changeSourceKind(value as SourceKind)}
          >
            {(
              [
                {
                  value: "server" as const,
                  icon: Server,
                  label: "A server",
                  description: "Bind this skill to one registered MCP server.",
                },
                {
                  value: "type" as const,
                  icon: Tags,
                  label: "A server type",
                  description: "Bind to a type — resolves to its representative member.",
                },
              ]
            ).map((option) => {
              const id = `${sourceKindFieldId}-${option.value}`;
              const active = sourceKind === option.value;
              return (
                <Label
                  key={option.value}
                  htmlFor={id}
                  className={cn(
                    "flex h-full cursor-pointer flex-col gap-1 rounded-md border p-3 text-left font-normal whitespace-normal",
                    active ? "border-primary bg-primary/5" : "border-border",
                  )}
                >
                  <span className="flex items-center gap-2 font-medium">
                    <RadioGroupItem id={id} value={option.value} />
                    <option.icon aria-hidden />
                    {option.label}
                  </span>
                  <Text variant="caption" tone="muted" className="ps-6">
                    {option.description}
                  </Text>
                </Label>
              );
            })}
          </RadioGroup>

          {sourceKind === "server" ? (
            eligibleServers.length === 0 ? (
              <StatePanel
                kind="empty"
                icon={<Server aria-hidden />}
                title="No scanned servers"
                description="Only servers with at least one completed scan can seed a skill. Run a discovery scan on a server first, then come back."
              />
            ) : (
              <div className="flex flex-col gap-1.5">
                <Text variant="meta" tone="muted">
                  Choose the server whose tools this skill will work with.
                </Text>
                <ul className="flex flex-col gap-1.5">
                  {eligibleServers.map((server) => {
                    const scan = latestSuccessByServer.get(server.id);
                    const active = server.id === serverId && typeId === null;
                    return (
                      <li key={server.id}>
                        <Button
                          variant="outline"
                          className={cn(
                            "h-auto w-full flex-col items-start gap-1 rounded-md py-2 text-left",
                            active && "border-primary ring-1 ring-ring",
                          )}
                          aria-pressed={active}
                          onClick={() => pickServer(server.id)}
                        >
                          <span className="flex min-w-0 items-center gap-2">
                            <Text className="min-w-0 truncate font-medium">{server.name}</Text>
                            <Badge variant="secondary" className="shrink-0 tabular-nums">
                              {scan?.totalTools ?? 0} tools
                            </Badge>
                          </span>
                          {scan ? (
                            <Text variant="meta" tone="muted">
                              Last scanned {new Date(scan.scannedAt).toLocaleString()}
                            </Text>
                          ) : null}
                        </Button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )
          ) : typeCandidates.length === 0 ? (
            <StatePanel
              kind="empty"
              icon={<Tags aria-hidden />}
              title="No server types"
              description="Create a server type and assign it members (under Servers) — then a type with a scanned member can seed a skill."
            />
          ) : (
            <div className="flex flex-col gap-1.5">
              <Text variant="meta" tone="muted">
                Choose the type to bind — the skill uses its representative member's tools.
              </Text>
              <ul className="flex flex-col gap-1.5">
                {typeCandidates.map((candidate) => {
                  const ineligible =
                    candidate.disabledReason !== null || !candidate.hasRepresentative;
                  const reason =
                    candidate.disabledReason === "name-collision"
                      ? "A registered server shares this exact name — it would shadow the type. Rename one under Servers first."
                      : !candidate.hasRepresentative
                        ? "No representative yet — no member has a completed scan to scaffold from."
                        : null;
                  const active = candidate.typeId === typeId;
                  return (
                    <li key={candidate.typeId}>
                      <Button
                        variant="outline"
                        disabled={ineligible}
                        className={cn(
                          "h-auto w-full flex-col items-start gap-1 rounded-md py-2 text-left",
                          active && "border-primary ring-1 ring-ring",
                        )}
                        aria-pressed={active}
                        onClick={() => pickType(candidate)}
                      >
                        <span className="flex min-w-0 flex-wrap items-center gap-2">
                          <Text className="min-w-0 truncate font-medium">{candidate.typeName}</Text>
                          <ServerTypeStatusBadge status={candidate.status} />
                          {candidate.hasRepresentative ? (
                            <Badge variant="secondary" className="shrink-0 tabular-nums">
                              {candidate.representativeTools ?? 0} tools
                            </Badge>
                          ) : null}
                        </span>
                        <Text variant="meta" tone="muted" className="whitespace-normal">
                          {reason ??
                            `Resolves to “${candidate.representativeName ?? "a scanned member"}” · ${candidate.memberCount} ${candidate.memberCount === 1 ? "member" : "members"}`}
                        </Text>
                      </Button>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  );

  const toolsContent = (
    <div className="flex min-h-0 flex-col gap-3">
      {errorAlert}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Text variant="meta" tone="muted">
          {sourceKind === "type" && selectedType
            ? `Tools from ${selectedType.representativeName ?? "the representative member"}'s latest scan — the representative of type ${selectedType.typeName}.`
            : selectedServer
              ? `Tools from ${selectedServer.name}'s latest scan.`
              : "Select tools."}
        </Text>
        <Badge variant="secondary" className="tabular-nums">
          {selected.size} selected
        </Badge>
      </div>
      {loadingTools ? (
        <StatePanel kind="loading" title="Loading tools…" loadingLabel="Loading tools…" />
      ) : (
        <DataTable
          data={tools}
          columns={columns}
          globalFilter={toolSearch}
          onGlobalFilterChange={setToolSearch}
          enablePagination={shouldPaginate(tools.length, 25)}
          pageSize={25}
          initialView={{ sorting: [{ id: "tokens", desc: true }] }}
          emptyMessage="This scan exposed no tools."
          toolbar={() => (
            <SearchInput
              value={toolSearch}
              onValueChange={setToolSearch}
              placeholder="Search tools…"
              label="Search tools"
            />
          )}
        />
      )}
    </div>
  );

  const detailsContent = (
    <div className="flex flex-col gap-4">
      {errorAlert}
      <FieldRow id="scaffold-name" label="Name" error={nameError}>
        <Input
          id="scaffold-name"
          value={name}
          placeholder="my-skill…"
          autoComplete="off"
          spellCheck={false}
          aria-invalid={nameError ? true : undefined}
          onChange={(event) => setName(event.target.value)}
        />
      </FieldRow>
      <FieldRow id="scaffold-display-name" label="Display name (optional)">
        <Input
          id="scaffold-display-name"
          value={displayName}
          placeholder="Defaults to the name above if left blank…"
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => setDisplayName(event.target.value)}
        />
      </FieldRow>
      <FieldRow id="scaffold-description" label="Description (optional)">
        <Textarea
          id="scaffold-description"
          rows={3}
          value={description}
          placeholder="Defaults to a stub naming the server and its tools…"
          spellCheck
          onChange={(event) => setDescription(event.target.value)}
        />
      </FieldRow>
      <Text variant="meta" tone="muted">
        A spec-valid SKILL.md is scaffolded with one section per selected tool and bound to{" "}
        {sourceKind === "type" && selectedType
          ? `the type ${selectedType.typeName} (resolves to ${selectedType.representativeName ?? "its representative member"})`
          : (selectedServer?.name ?? "the server")}{" "}
        — its palette and completion go live immediately.
      </Text>
    </div>
  );

  // One WideDialog section per wizard step — the rail is the step indicator + backward nav.
  const sections: WideDialogSection[] = STEPS.map((s) => ({
    id: s.id,
    label: s.label,
    content: s.id === "server" ? serverContent : s.id === "tools" ? toolsContent : detailsContent,
  }));

  const stepOrder = STEPS.map((s) => s.id);
  function handleSectionChange(id: string) {
    if (busy) return;
    const currentIndex = stepOrder.indexOf(step);
    const targetIndex = stepOrder.indexOf(id);
    if (targetIndex !== -1 && targetIndex < currentIndex) setStep(id as WizardStep);
  }

  // Back grouped LEFT; Cancel + the step's forward/commit action grouped right (kit footer rule).
  const footer = (
    <div className="flex w-full items-center justify-between gap-2">
      <div className="flex items-center gap-2">
        {step !== "server" ? (
          <Button
            variant="outline"
            disabled={Boolean(busy)}
            onClick={() => setStep(step === "details" ? "tools" : "server")}
          >
            Back
          </Button>
        ) : null}
      </div>
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          onClick={() => guard.requestOpenChange(false)}
          disabled={Boolean(busy)}
        >
          Cancel
        </Button>
        {step === "server" ? (
          <Button onClick={() => setStep("tools")} disabled={!canAdvanceServer}>
            Continue
          </Button>
        ) : null}
        {step === "tools" ? (
          <Button onClick={() => setStep("details")} disabled={!canAdvanceTools}>
            Continue
          </Button>
        ) : null}
        {step === "details" ? (
          <Button onClick={() => void create()} disabled={!canCreate || Boolean(busy)}>
            <Sparkles aria-hidden />
            <span>{busy === "create" ? "Creating…" : "Create skill"}</span>
          </Button>
        ) : null}
      </div>
    </div>
  );

  return (
    <>
      <WideDialog
        open={props.open}
        onOpenChange={guard.requestOpenChange}
        title="New skill from server or type"
        description="Scaffold a skill from a tool surface — pick a server (or a server type, binding to its representative member) with a completed scan, choose its tools, and name it. The app reads the last scan; it never re-scans or runs anything."
        sections={sections}
        activeSectionId={step}
        onActiveSectionChange={handleSectionChange}
        footer={footer}
      />
      <DiscardChangesDialog
        open={guard.confirming}
        onConfirm={guard.confirmDiscard}
        onCancel={guard.cancelDiscard}
      />
    </>
  );
}
