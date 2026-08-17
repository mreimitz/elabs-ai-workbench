import { useEffect, useId, useMemo, useState } from "react";
import type {
  AllowedServer,
  ScanDetail,
  ServerConfig,
  ServerType,
} from "@mcp-token-footprint/shared";
import {
  Badge,
  Button,
  Checkbox,
  cn,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Label,
  RadioGroup,
  RadioGroupItem,
  ScrollArea,
  StatePanel,
  Text,
  Wizard,
  WizardStep,
  WizardSteps,
} from "@elabs-ai/components-ui";
import { ChevronRight, Server, ServerCog, Tags } from "lucide-react";
import { formatNumber } from "../../lib/format";
import { ServerTypeStatusBadge } from "../servers/ServerTypeStatusBadge";
import {
  type BindTypeCandidate,
  deriveBindTypeCandidates,
} from "../skills/design/bind-server-candidates";
import { canonicalizeSelection } from "./allow-list";

const STEPS = [
  { id: "source", title: "Select source", description: "Pick a server or a server type" },
  { id: "tools", title: "Select tools", description: "Choose which tools are allowed" },
] as const;

/** Add a server directly, or by server type (WP 4.2) — a type resolves to its representative member. */
type SourceKind = "server" | "type";

/**
 * Nested two-step Dialog opened from the Environment editor's right panel to append one
 * `AllowedServer` to the allow-list.
 *
 * Step 0 chooses a SOURCE — either a single configured server (the original flow) or, since
 * server-types WP 4.2, a registered server TYPE. Picking a type RESOLVES it to its representative
 * member (D-ST3: the member with the newest successful scan; tiebreak newest `scanned_at`, then
 * `id` ASC) and drives the identical step-1 tool selection off that representative's latest scan.
 * Either way the confirmed entry stores a CONCRETE server id — attach-by-type is a resolution
 * convenience, not a new wire shape (`AllowedServer` is byte-identical).
 *
 * Step 1 picks tools from the chosen server's latest scan (or all-tools when unscanned) and
 * canonicalizes "all tools" → `allowedTools: null` (same rule as the editor). Radix manages the
 * nested overlay/focus; the parent Dialog stays put.
 */
export function AddServerModal(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  servers: ServerConfig[];
  /** Server types (roadmap/server-types) — read-only type/status per row + the attach-by-type source. */
  serverTypes?: ServerType[];
  latestScans: Map<string, ScanDetail>;
  existing: AllowedServer[];
  onAdd: (entry: AllowedServer) => void;
}) {
  const { open, onOpenChange, servers, serverTypes = [], latestScans, existing, onAdd } = props;
  const [step, setStep] = useState(0);
  const [sourceKind, setSourceKind] = useState<SourceKind>("server");
  const sourceKindFieldId = useId();

  // Server-type lookup (WP 4.1): a dangling `typeId` (its type was deleted) resolves to `null` and
  // reads as untyped — never crashes.
  const typesById = useMemo(
    () => new Map(serverTypes.map((type) => [type.id, type] as const)),
    [serverTypes],
  );
  const resolveType = (server: ServerConfig): ServerType | null =>
    server.typeId ? (typesById.get(server.typeId) ?? null) : null;

  const [serverId, setServerId] = useState<string | null>(null);
  // The chosen type (type-source only) — recorded so step 1 can show the resolved "type → member".
  const [typeId, setTypeId] = useState<string | null>(null);
  // Explicit per-tool selection for step 2; `null` ⇒ all tools (also used when there's no scan).
  const [selected, setSelected] = useState<Set<string> | null>(null);

  // Server ids already on the allow-list — excluded from the server picker, and the reason a type
  // whose representative is one of them is disabled.
  const usedServerIds = useMemo(() => new Set(existing.map((entry) => entry.serverId)), [existing]);

  // Servers still available to add (not already on the allow-list).
  const available = useMemo(
    () => servers.filter((server) => !usedServerIds.has(server.id)),
    [servers, usedServerIds],
  );

  // WP 4.2 — attach-by-type candidates. Reuses the Skill IDE's pure derivation for the representative
  // (D-ST3), status, and member count so the deterministic tiebreak lives in exactly one place. The
  // scan source is the same latest-scan-per-server the modal already has, keeping the resolved
  // representative consistent with the tools step 1 will actually show. `boundNames: []` — the
  // derivation's `disabledReason` is SKILLS-specific (frontmatter names) and does NOT apply here; we
  // ignore it and apply the environment's own eligibility (no representative / already added) below.
  const scanList = useMemo(() => Array.from(latestScans.values()), [latestScans]);
  const typeCandidates = useMemo(
    () => deriveBindTypeCandidates(serverTypes, servers, scanList, []),
    [serverTypes, servers, scanList],
  );

  /** Environment-specific eligibility for a type row (independent of the skills-only disabledReason). */
  function typeDisabledReason(candidate: BindTypeCandidate): string | null {
    if (!candidate.hasRepresentative) return "No scanned member — scan a member first.";
    if (candidate.representativeId && usedServerIds.has(candidate.representativeId)) {
      return "Representative already added.";
    }
    return null;
  }

  // Reset the flow whenever the modal opens.
  useEffect(() => {
    if (!open) return;
    setStep(0);
    setSourceKind("server");
    setServerId(null);
    setTypeId(null);
    setSelected(null);
  }, [open]);

  const chosenServer = serverId ? (servers.find((server) => server.id === serverId) ?? null) : null;
  const chosenType = typeId
    ? (typeCandidates.find((candidate) => candidate.typeId === typeId) ?? null)
    : null;
  const scan = serverId ? latestScans.get(serverId) : undefined;
  const tools = scan?.tools ?? [];

  // Switch the source — reset any in-progress pick so the two paths never carry each other's state.
  function changeSourceKind(next: SourceKind) {
    setSourceKind(next);
    setServerId(null);
    setTypeId(null);
    setSelected(null);
  }

  function chooseServer(id: string) {
    setTypeId(null);
    setServerId(id);
    setSelected(null); // default to all tools
    setStep(1);
  }

  // WP 4.2 — pick a TYPE: resolve to its D-ST3 representative and drive the SAME tools step off that
  // member's latest scan. The confirmed entry stores the CONCRETE representative id.
  function chooseType(candidate: BindTypeCandidate) {
    if (!candidate.representativeId) return; // ineligible — guarded in the UI
    setTypeId(candidate.typeId);
    setServerId(candidate.representativeId);
    setSelected(null); // default to all tools
    setStep(1);
  }

  function toggleAll(allChecked: boolean) {
    setSelected(allChecked ? null : new Set());
  }

  function toggleTool(toolName: string, checked: boolean) {
    setSelected((current) => {
      const base = new Set(current ?? tools.map((tool) => tool.toolName));
      if (checked) base.add(toolName);
      else base.delete(toolName);
      return base;
    });
  }

  const subtotal = useMemo(() => {
    if (!scan) return { tokens: 0, count: 0 };
    const allow = selected ?? new Set(tools.map((tool) => tool.toolName));
    const picked = tools.filter((tool) => allow.has(tool.toolName));
    return {
      tokens: picked.reduce((sum, tool) => sum + tool.totalTokens, 0),
      count: picked.length,
    };
  }, [scan, selected, tools]);

  const allChecked = selected === null;
  const canConfirm =
    serverId !== null && (selected === null || selected.size > 0 || tools.length === 0);
  // Why the confirm action is disabled — surfaced inline next to the button (interaction-guidelines:
  // don't leave a silently-disabled control).
  const disabledReason =
    step !== 1
      ? sourceKind === "type"
        ? "Pick a type to continue."
        : "Pick a server to continue."
      : !canConfirm
        ? "Select at least one tool to add this server."
        : null;

  function confirm() {
    if (!serverId) return;
    const allow = selected ?? new Set(tools.map((tool) => tool.toolName));
    onAdd(canonicalizeSelection(serverId, allow, scan));
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg" className="flex max-h-[85vh] flex-col gap-0 p-0">
        <DialogHeader className="flex-none gap-1 border-b border-border p-4 pe-12">
          <DialogTitle>Add server to allow-list</DialogTitle>
          <DialogDescription>
            Pick a configured server or a server type, then choose which of its tools this
            environment may use.
          </DialogDescription>
        </DialogHeader>

        <Wizard steps={[...STEPS]} step={step} className="flex min-h-0 flex-1 flex-col gap-0">
          <div className="flex-none border-b border-border p-4">
            <WizardSteps />
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            {/* Step 1 — Select source (a server or a type) */}
            <WizardStep step={0} className="flex flex-col gap-3 outline-none">
              {/* WP 4.2 — attach a single server, or a whole type (resolves to its representative). */}
              <RadioGroup
                aria-label="Add a server or a server type"
                className="grid gap-2 sm:grid-cols-2"
                value={sourceKind}
                onValueChange={(value) => value && changeSourceKind(value as SourceKind)}
              >
                {(
                  [
                    {
                      value: "server",
                      icon: Server,
                      label: "A server",
                      description: "Allow tools from one registered MCP server.",
                    },
                    {
                      value: "type",
                      icon: Tags,
                      label: "A server type",
                      description: "Resolves to the type's representative member.",
                    },
                  ] satisfies {
                    value: SourceKind;
                    icon: typeof Server;
                    label: string;
                    description: string;
                  }[]
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
                        <option.icon className="size-4 text-muted-foreground" aria-hidden />
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
                available.length === 0 ? (
                  <StatePanel
                    kind="empty"
                    icon={<ServerCog aria-hidden />}
                    title={
                      servers.length === 0
                        ? "No MCP servers configured"
                        : "All servers already added"
                    }
                    description={
                      servers.length === 0
                        ? "Add an MCP server under Servers, then return here to allow its tools."
                        : "Every configured server is already on this environment's allow-list."
                    }
                  />
                ) : (
                  <ul className="flex flex-col gap-2">
                    {available.map((server) => {
                      const serverScan = latestScans.get(server.id);
                      // Read-only type/status surfacing (WP 4.1) — a deprecated fleet is de-emphasized
                      // but stays selectable.
                      const type = resolveType(server);
                      const deprecated = type?.status === "deprecated";
                      return (
                        <li key={server.id} className="min-w-0">
                          <Button
                            variant="outline"
                            className="h-auto w-full justify-between gap-3 px-3 py-2.5"
                            onClick={() => chooseServer(server.id)}
                          >
                            <span className="flex min-w-0 items-center gap-2">
                              <ServerCog
                                className="size-4 shrink-0 text-muted-foreground"
                                aria-hidden
                              />
                              <span
                                className={cn("truncate", deprecated && "text-muted-foreground")}
                              >
                                {server.name}
                              </span>
                              {type ? (
                                <Badge variant="outline" className="shrink-0">
                                  {type.name}
                                </Badge>
                              ) : null}
                            </span>
                            <span className="flex shrink-0 items-center gap-2">
                              {type ? <ServerTypeStatusBadge status={type.status} /> : null}
                              {serverScan ? (
                                <Badge variant="secondary" className="tabular-nums">
                                  {serverScan.tools.length} tools
                                </Badge>
                              ) : (
                                <Badge variant="outline">no scan</Badge>
                              )}
                              <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
                            </span>
                          </Button>
                        </li>
                      );
                    })}
                  </ul>
                )
              ) : typeCandidates.length === 0 ? (
                <StatePanel
                  kind="empty"
                  icon={<Tags aria-hidden />}
                  title="No server types"
                  description="Create a server type and assign it members under Servers, then attach a type's tools here."
                />
              ) : (
                <ul className="flex flex-col gap-2">
                  {typeCandidates.map((candidate) => {
                    const reason = typeDisabledReason(candidate);
                    const disabled = reason !== null;
                    const deprecated = candidate.status === "deprecated";
                    return (
                      <li key={candidate.typeId} className="min-w-0">
                        <Button
                          variant="outline"
                          disabled={disabled}
                          className="h-auto w-full flex-col items-stretch gap-1 px-3 py-2.5 text-left"
                          onClick={() => chooseType(candidate)}
                        >
                          <span className="flex items-center justify-between gap-3">
                            <span className="flex min-w-0 items-center gap-2">
                              <Tags className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                              <span
                                className={cn("truncate", deprecated && "text-muted-foreground")}
                              >
                                {candidate.typeName}
                              </span>
                              <ServerTypeStatusBadge status={candidate.status} />
                            </span>
                            <span className="flex shrink-0 items-center gap-2">
                              <Badge variant="secondary" className="tabular-nums">
                                {candidate.memberCount}{" "}
                                {candidate.memberCount === 1 ? "member" : "members"}
                              </Badge>
                              {!disabled ? (
                                <ChevronRight
                                  className="size-4 text-muted-foreground"
                                  aria-hidden
                                />
                              ) : null}
                            </span>
                          </span>
                          {/* Honest/transparent resolution — the concrete member the type resolves to,
                              or why it can't be attached. */}
                          <Text
                            variant="meta"
                            tone="muted"
                            className="whitespace-normal ps-6 text-pretty"
                          >
                            {reason ??
                              `Resolves to ${candidate.representativeName ?? "a scanned member"} · ${candidate.representativeTools ?? 0} tools`}
                          </Text>
                        </Button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </WizardStep>

            {/* Step 2 — Select tools */}
            <WizardStep step={1} className="flex flex-col gap-3 outline-none">
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 flex-col gap-1">
                  <Label className="flex min-w-0 items-center gap-2">
                    <ServerCog className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                    <span className="truncate">{chosenServer?.name ?? "Server"}</span>
                  </Label>
                  {sourceKind === "type" && chosenType ? (
                    <Text
                      variant="meta"
                      tone="muted"
                      className="flex min-w-0 items-center gap-1.5 ps-6"
                    >
                      <Badge variant="outline" className="shrink-0">
                        {chosenType.typeName}
                      </Badge>
                      <span aria-hidden>→</span>
                      <span className="truncate">{chosenServer?.name ?? "representative"}</span>
                    </Text>
                  ) : null}
                </div>
                {scan ? (
                  <Text variant="meta" tone="muted" className="shrink-0 tabular-nums">
                    {subtotal.count} of {tools.length} · {formatNumber(subtotal.tokens)} tok
                  </Text>
                ) : null}
              </div>

              {scan && tools.length > 0 ? (
                <>
                  <Label htmlFor="add-server-all" className="flex items-center gap-2 font-normal">
                    <Checkbox
                      id="add-server-all"
                      checked={allChecked}
                      onCheckedChange={(next) => toggleAll(next === true)}
                    />
                    <span>All tools</span>
                  </Label>
                  <ScrollArea className="max-h-72 rounded-md border border-border">
                    <ul className="flex flex-col gap-1 p-2">
                      {tools.map((tool) => {
                        const checked = selected === null ? true : selected.has(tool.toolName);
                        const checkboxId = `add-tool-${tool.toolName}`;
                        return (
                          <li key={tool.id} className="flex items-center justify-between gap-3">
                            <Label
                              htmlFor={checkboxId}
                              className="flex min-w-0 items-center gap-2 font-normal"
                            >
                              <Checkbox
                                id={checkboxId}
                                checked={checked}
                                onCheckedChange={(next) => toggleTool(tool.toolName, next === true)}
                              />
                              <span className="truncate font-mono text-sm">{tool.toolName}</span>
                            </Label>
                            <Text variant="meta" tone="muted" className="shrink-0 tabular-nums">
                              {formatNumber(tool.totalTokens)}
                            </Text>
                          </li>
                        );
                      })}
                    </ul>
                  </ScrollArea>
                </>
              ) : (
                <StatePanel
                  kind="empty"
                  title="All tools allowed"
                  description="This server has no scan yet, so every tool is allowed. Scan it under Servers to tune its per-tool footprint."
                />
              )}
            </WizardStep>
          </div>
        </Wizard>

        <DialogFooter className="flex-none border-t border-border p-4">
          {disabledReason ? (
            <Text variant="meta" tone="muted" className="me-auto self-center text-pretty">
              {disabledReason}
            </Text>
          ) : null}
          {step === 1 ? (
            <Button variant="outline" onClick={() => setStep(0)}>
              Back
            </Button>
          ) : null}
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={confirm} disabled={step !== 1 || !canConfirm}>
            Add server
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
