import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  AgentMessage,
  ApprovalCard,
  ApprovalCardAccepted,
  ApprovalCardActions,
  ApprovalCardApprove,
  ApprovalCardDeny,
  ApprovalCardDescription,
  ApprovalCardRejected,
  ApprovalCardRequest,
  ApprovalCardTitle,
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
  MessageAction,
  MessageActions,
  MessageBranch,
  MessageBranchContent,
  MessageBranchNext,
  MessageBranchPage,
  MessageBranchPrevious,
  MessageBranchSelector,
  MessageContent,
  MessageResponse,
  ProducedAssetTree,
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
  Shimmer,
  Suggestion,
  Suggestions,
  Task,
  TaskContent,
  TaskItem,
  TaskTrigger,
  Tool,
  ToolContent,
  ToolDetails,
  ToolHeader,
  ToolInput,
  ToolOutput,
  UserMessage,
  type ContextAsset,
  type ContextAssetType,
} from "@brand/ai";
import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  cn,
  Descriptions,
  DescriptionsItem,
  Input,
  Label,
  NumberInput,
  Progress,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  Text,
  Textarea,
  toast,
} from "@brand/ui";
import type {
  HubCitation,
  HubEvent,
  HubLimitRetrySource,
  HubMemoryKind,
  HubMemoryScope,
  HubMessagePart,
  HubSession,
  HubTaskItem,
  HubToolAnnotations,
  HubToolArtifact,
  HubToolPart,
  HubToolProgress,
  ProviderKind,
} from "@mcp-token-footprint/shared";
// hub-fixes WP5.2 (RC5, D-HF2) — the WP 5.1 "web" capability surface (values, not types): the
// grantable builtin name + the provider kinds whose native model surface can back it. Mirrors
// `apps/api/src/providers/registry.ts`'s `providerSupportsWebSearch` exactly (the web app can't
// import API source) — see `ResearchModelWebSearchProbe` below.
import { HUB_WEB_SEARCH_BUILTIN, HUB_WEB_SEARCH_PROVIDER_KINDS } from "@mcp-token-footprint/shared";
import {
  AlertTriangle,
  Ban,
  Bot,
  ChevronDown,
  ChevronRight,
  FileText,
  FolderTree,
  Globe,
  HelpCircle,
  KeyRound,
  Layers,
  MessageSquare,
  RefreshCw,
  Repeat,
  Search,
  Server,
  ServerOff,
  ShieldCheck,
  X,
} from "lucide-react";
import { Link } from "react-router-dom";
import { mcpErrorText, summarizeArgs, unwrapToolResult } from "../testing/tool-call-view";
import {
  acceptHubMemoryProposal,
  branchHubSession,
  listServers,
  postHubUiState,
  promoteHubWorkspaceFile,
  sendHubMessage,
} from "../../lib/api";
import { hasResearchCapableServer, missionTextWantsWebCapability } from "../servers/researchServerPresets";
import { formatDuration } from "../../lib/format";
import { getErrorMessage } from "../../lib/errors";
import { AlertHeading } from "../../components/AlertHeading";
import { SelectField } from "../../components/SelectField";
import { parseParams, sortParams, type ToolParam } from "../../lib/schema-params";
import { MD_TABLE_COMPONENTS } from "../testing/ChatMarkdown";
import { useElapsed } from "../testing/RunBar";
import { prettyToolName, taskStatusToStatus, toolUiPartApproval } from "./hub-tool-parts";
import { GenUiPart } from "./genui/index";
import { HubLimitErrorBanner } from "./HubLimitErrorBanner";
import { HubQuestionPrompt } from "./HubQuestionPrompt";
import { citationMarkdownComponents, MessageSources, SessionSourceRail } from "./SourcesPanel";
import { MissionPlanCard } from "./MissionPlanCard";
import { MissionBoard, reconstructMissionBoard } from "./MissionBoard";
import type { MissionCrewLookup, MissionRoleLookup } from "./lib/mission-agent-icon";
import {
  findHubModelOption,
  hubModelWireFields,
  useHubModelRoster,
  type HubModelCredentialIssue,
  type HubModelOption,
} from "./use-hub-models";
import { HUB_DIRECT_RETRY_SOURCE_LABEL } from "./hub-limit-retry";
import { hubCredentialLabel, hubModelTriggerLabel } from "./hub-model-picker";
import type { HubMissionPlan } from "@mcp-token-footprint/shared";
import {
  useHubStream,
  type HubElicitationRequest,
  type HubStreamState,
  type HubTimelineAssistantTurn,
  type HubTimelineItem,
  type HubTimelineQueuedItem,
  type HubTimelineToolCall,
} from "./use-hub-stream";
import {
  CHAT_READING_COLUMN_CLASS,
  TRANSCRIPT_TOP_SCRIM_PX,
  transcriptBottomScrimPx,
} from "./lib/hub-ux";
import { notifyError } from "../../lib/notify";

// Re-exported for tests + AssistantView (the type now lives in `use-hub-stream`, derived live from the
// `elicitation_requested`/`elicitation_responded` events — WP2.3).
export type { HubElicitationRequest };

/** The full `useHubStream` return shape, as consumed by this file's components. */
export type ConversationStream = HubStreamState & {
  timeline: HubTimelineItem[];
  tasks: HubTaskItem[];
  pendingQueued: HubTimelineQueuedItem[];
};

/** An operator's decision on an approval-gated tool call (R-MCP3 / R-UX1). `deny` is universal; the
 *  affirmative kinds mirror `HubApprovalOptionKind`. */
export type ToolDecision = "allow-once" | "always" | "deny";

/** Optional interaction callbacks. Absent → the affordance renders in its honest "not yet actionable"
 *  disabled state (the WP1.3 precedent). Wired by the parent view when its routes land. */
export type ConversationHandlers = {
  onToolDecision?: (toolCallId: string, decision: ToolDecision) => void;
  onCancelTool?: (toolCallId: string) => void;
  /** MCP reachability presentation for the in-transcript "unreachable server" notice. Assembled by
   *  `ConversationPane` from the session's `toolScope` + the caller's authenticate handler. `scopedServerIds`
   *  = the ids the owner explicitly scoped in (`null` ⇒ auto mode: non-auth failures are silently skipped,
   *  the model just uses reachable servers). `onAuthenticate` opens the ServerWizard reauth flow for a
   *  server that failed with an auth error. Absent ⇒ legacy behavior (the plain warning for every issue —
   *  e.g. a read-only regenerate variant with no session context). */
  mcpAuth?: {
    scopedServerIds: Set<string> | null;
    onAuthenticate: (serverId: string, serverName: string) => void;
  };
  /** WP2.6 (R-GUI5) — declarative-GenUI two-tier interactivity. Wired by `ConversationPane` from the
   *  session's own event log + `sendHubMessage`/`postHubUiState`. Absent ⇒ genui widgets render
   *  read-only (e.g. inside a regenerate variant). */
  genui?: {
    /** The latest replayed `ui_state` for a widget (message + optional widget key) — R-GUI5 rehydration. */
    uiStateFor: (messageId: string, key?: string) => unknown;
    /** Persist a client-side widget-state snapshot as a `ui_state` event (never re-enters the model). */
    onPersistUiState: (messageId: string, key: string | undefined, state: unknown) => void;
    /** Send a to-assistant (dual-audience) message as the user's next turn. */
    onSubmit: (text: string) => void;
  };
  /** WP3.2 (D-AH11) — the memory-proposal chip's action + "already saved" lookup. Wired by
   *  `ConversationPane` from the session's own event log (`reconstructSavedMemoryIds`, R-SES1) +
   *  `acceptHubMemoryProposal`. Absent ⇒ a proposal chip still renders (nothing hidden), just without a
   *  working Save button (the WP1.3 "honest not-yet-actionable" precedent — e.g. a read-only regenerate
   *  variant, mirroring how `onToolDecision`/`onCancelTool` already degrade there). */
  memory?: {
    /** Every `memoryId` this session has an ACCEPTED (`memory_saved`) event for — see the fold
     *  function's own doc for why only the "saved" half is event-sourced. */
    savedMemoryIds: ReadonlySet<string>;
    /** WP2.7 (D-HUX11) — the scopes THIS session can save a proposal into: always `profile`, plus
     *  `project`/`crew` when the session itself belongs to one — mirrors
     *  `buildSessionEffectiveMemory`'s own owning-entity resolution, so a picked scope can never name
     *  an owner this session has no relationship to. */
    scopeOptions: HubMemoryScopeOption[];
    /** "Save to memory" — accepts the proposal (`status: "proposed" → "active"`), moving it to the
     *  scope picker's chosen owner in the SAME request (D-HUX11 — "proposals land in the chosen
     *  scope"). Pass the proposal's OWN scope/scopeId unchanged when the picker wasn't touched. */
    onAccept: (memoryId: string, scope: HubMemoryScope, scopeId?: string) => void;
  };
};

/** One option in the memory-proposal chip's scope picker (WP2.7, D-HUX11). */
export type HubMemoryScopeOption = { value: HubMemoryScope; scopeId?: string; label: string };

// ── Memory-proposal chips (WP3.2, D-AH11) ───────────────────────────────────────────────────────────
//
// `memory.propose_save` is a BUILT-IN tool call like any other, but D-AH11's hard rule — the assistant
// may only PROPOSE, never write silently — means its result deserves a dedicated, actionable card in
// the transcript rather than the generic `Tool`/`StructuredOutput` row every other built-in gets
// (mirrors WP2.6's `merged.source === "genui"` special-case in `renderMessagePart`'s `tool_call` arm).
//
// The PROPOSAL's own content (kind/content) is read straight off the settled tool-call part's
// `artifact` (`{kind:"hub_memory", data: HubMemory}` — the same channel every other built-in's rich
// result rides, e.g. `SpillCard`'s `part.artifact?.kind === "spill"`), NOT off the separately-persisted
// `memory_proposed` event: that event is appended DIRECTLY via `ctx.repository.appendEvent`
// (`hub/tools/builtins/memory.ts`), bypassing the turn engine's live-forwarding `persist()` choke point
// (see that file's doc) — so it reaches a plain reconnect/replay but NOT an already-open live
// connection. `tool_result` (which carries this same artifact) always DOES go through `persist()`, so
// reading the proposal off it is reliable in both the live AND replay cases.
//
// The "saved" half is the opposite: it MUST be event-sourced, because the settled tool-call part is a
// FROZEN snapshot from the instant the tool ran (`use-hub-stream.ts`'s own doc — settled
// `assistant_message.parts` are never mutated after persistence) and would say "proposed" forever even
// after the owner clicks Save. `reconstructSavedMemoryIds` folds the `memory_saved` events instead
// (mirrors `reconstructVariantGroups`'s pure-fold style over `readonly HubEvent[]`, R-SES1) — and
// `registerHubMemoryRoutes`'s accept route explicitly live-forwards that event, so this half stays
// correct on an already-open connection too.

/** Reconstruct the set of `memoryId`s this session has an accepted (`memory_saved`) event for. See the
 *  module doc above for why only this half (not the proposal itself) is event-sourced. */
export function reconstructSavedMemoryIds(events: readonly HubEvent[]): Set<string> {
  const saved = new Set<string>();
  for (const event of events) {
    if (event.type === "memory_saved") saved.add(event.memoryId);
  }
  return saved;
}

const MEMORY_KIND_LABELS: Record<HubMemoryKind, string> = {
  profile: "Profile",
  preference: "Preference",
  instruction: "Instruction",
};

const MEMORY_SCOPE_LABELS: Record<HubMemoryScope, string> = {
  profile: "Profile (global)",
  project: "This project",
  crew: "This crew",
  agent: "This agent",
};

/** WP2.7 (D-HUX11) — the scopes a memory proposal in THIS session can be saved into: always `profile`,
 *  plus `project`/`crew` when the session itself belongs to one. Mirrors
 *  `buildSessionEffectiveMemory`'s (`hub/memory-resolver.ts`) own owning-entity resolution so the
 *  picker can never offer a scope this session has no `scopeId` for. (A top-level chat/research/
 *  mission session — the only kind `ConversationPane` renders a live transcript for — has no
 *  resolvable `agent` owner of its own, so `agent` is never offered here.) */
function memoryScopeOptionsForSession(session: HubSession): HubMemoryScopeOption[] {
  const options: HubMemoryScopeOption[] = [
    { value: "profile", label: MEMORY_SCOPE_LABELS.profile },
  ];
  if (session.projectId) {
    options.push({
      value: "project",
      scopeId: session.projectId,
      label: MEMORY_SCOPE_LABELS.project,
    });
  }
  if (session.crewId) {
    options.push({ value: "crew", scopeId: session.crewId, label: MEMORY_SCOPE_LABELS.crew });
  }
  return options;
}

/**
 * WP2.7 (D-HUX11) — the scope picker on the proposal chip's "Save to memory" action. Defaults to the
 * proposal's OWN scope (the model's choice — never silently moved just because the owner clicked Save
 * without touching the picker) and always offers it as an option even when it falls outside the
 * session's own `scopeOptions` (e.g. a proposal scoped by a mission-child session this top-level
 * transcript doesn't itself belong to) — see `initialOptions` below.
 */
function MemoryProposalChip({
  memoryId,
  kind,
  content,
  scope,
  scopeId,
  saved,
  scopeOptions,
  onAccept,
}: {
  memoryId: string;
  kind: HubMemoryKind;
  content: string;
  scope: HubMemoryScope;
  scopeId?: string;
  saved: boolean;
  scopeOptions: HubMemoryScopeOption[];
  onAccept?: (memoryId: string, scope: HubMemoryScope, scopeId?: string) => void;
}) {
  const initialOptions = useMemo<HubMemoryScopeOption[]>(() => {
    if (scopeOptions.some((option) => option.value === scope)) return scopeOptions;
    const proposedOption: HubMemoryScopeOption = {
      value: scope,
      ...(scopeId ? { scopeId } : {}),
      label: MEMORY_SCOPE_LABELS[scope],
    };
    return [proposedOption, ...scopeOptions];
  }, [scopeOptions, scope, scopeId]);
  const [chosen, setChosen] = useState<HubMemoryScopeOption>(
    () => initialOptions.find((option) => option.value === scope) ?? initialOptions[0]!,
  );

  return (
    <Alert variant={saved ? "success" : "info"} data-testid="memory-proposal-chip">
      <AlertHeading level={2}>{saved ? "Saved to memory" : "Save to memory?"}</AlertHeading>
      <AlertDescription className="flex min-w-0 flex-col gap-2">
        <div className="flex min-w-0 items-start gap-2">
          <Badge variant="outline" className="w-fit shrink-0">
            {MEMORY_KIND_LABELS[kind]}
          </Badge>
          <Text className="min-w-0 flex-1 whitespace-pre-wrap break-words">{content}</Text>
        </div>
        {!saved ? (
          <div className="flex flex-wrap items-center justify-end gap-2">
            {initialOptions.length > 1 ? (
              <Select
                value={chosen.value}
                onValueChange={(value) =>
                  setChosen(initialOptions.find((option) => option.value === value) ?? chosen)
                }
              >
                <SelectTrigger size="sm" className="w-auto gap-1" aria-label="Memory scope">
                  <span className="text-muted-foreground">Save to:</span>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {initialOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : null}
            <Button
              size="sm"
              disabled={!onAccept}
              onClick={() => onAccept?.(memoryId, chosen.value, chosen.scopeId)}
            >
              Save to memory
            </Button>
          </div>
        ) : null}
      </AlertDescription>
    </Alert>
  );
}

/** Type-guard the `hub_memory` artifact channel a settled `memory.propose_save` result carries — the
 *  minimal shape the chip needs (see the module doc for why this, not `memory_proposed`, is the
 *  proposal's source of truth). WP2.7 — also carries the proposal's own `scope`/`scopeId` (D-HUX11) so
 *  the chip's scope picker can default to it. */
function memoryProposalFromPart(part: HubToolPart):
  | {
      memoryId: string;
      kind: HubMemoryKind;
      content: string;
      scope: HubMemoryScope;
      scopeId?: string;
    }
  | undefined {
  if (part.toolName !== "memory.propose_save" || part.artifact?.kind !== "hub_memory")
    return undefined;
  const data = part.artifact.data as
    | Partial<Record<"id" | "kind" | "content" | "scope" | "scopeId", unknown>>
    | undefined;
  if (
    !data ||
    typeof data.id !== "string" ||
    typeof data.kind !== "string" ||
    typeof data.content !== "string"
  ) {
    return undefined;
  }
  return {
    memoryId: data.id,
    kind: data.kind as HubMemoryKind,
    content: data.content,
    scope: typeof data.scope === "string" ? (data.scope as HubMemoryScope) : "profile",
    ...(typeof data.scopeId === "string" ? { scopeId: data.scopeId } : {}),
  };
}

// ── Task widget (R-SES4) — ≤5 visible + expand, reconciled by id ───────────────────────────────────

const TASK_WIDGET_VISIBLE_CAP = 5;

export function TaskWidget({ tasks }: { tasks: HubTaskItem[] }) {
  const [expanded, setExpanded] = useState(false);
  if (tasks.length === 0) return null;
  const visible = expanded ? tasks : tasks.slice(0, TASK_WIDGET_VISIBLE_CAP);
  const hiddenCount = tasks.length - visible.length;

  return (
    <div className="mx-4 mt-2">
      <Task defaultOpen>
        <TaskTrigger title={`Tasks (${tasks.length})`} />
        <TaskContent>
          {visible.map((task) => (
            <TaskItem key={task.id} status={taskStatusToStatus(task.status)}>
              {task.title}
              {task.status === "blocked" ? " — blocked" : ""}
              {task.status === "cancelled" ? " — cancelled" : ""}
            </TaskItem>
          ))}
        </TaskContent>
        {hiddenCount > 0 ? (
          <Button variant="ghost" size="sm" className="ms-2" onClick={() => setExpanded(true)}>
            Show {hiddenCount} more
          </Button>
        ) : null}
      </Task>
    </div>
  );
}

// ── MCP interaction depth: annotations · server chip · progress · structured output · spill ─────────

/** R-MCP3 — the behavior annotations a scanned MCP tool declares, rendered as badges. Trust reads:
 *  read-only is reassuring (success), destructive is a warning (destructive), the rest are neutral. */
export function AnnotationBadges({ annotations }: { annotations?: HubToolAnnotations }) {
  if (!annotations) return null;
  const badges: {
    key: string;
    label: string;
    variant: "success" | "destructive" | "secondary";
    icon: typeof ShieldCheck;
  }[] = [];
  if (annotations.readOnlyHint)
    badges.push({ key: "ro", label: "read-only", variant: "success", icon: ShieldCheck });
  if (annotations.destructiveHint)
    badges.push({ key: "de", label: "destructive", variant: "destructive", icon: AlertTriangle });
  if (annotations.idempotentHint)
    badges.push({ key: "id", label: "idempotent", variant: "secondary", icon: Repeat });
  if (annotations.openWorldHint)
    badges.push({ key: "ow", label: "open-world", variant: "secondary", icon: Globe });
  if (badges.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1" data-testid="tool-annotations">
      {badges.map(({ key, label, variant, icon: Icon }) => (
        <Badge key={key} variant={variant} className="gap-1 font-normal">
          <Icon aria-hidden className="size-3" />
          {label}
        </Badge>
      ))}
    </div>
  );
}

/** R-MCP11 — a per-server chip on an MCP tool row: which registered server routed the call. Live
 *  connection status (connected / auth-needed / error, reconnect + `list_changed`) needs a status feed
 *  the hub contract doesn't yet carry; a call that ran IS a connected signal, shown here. */
function ServerChip({ serverId }: { serverId: string }) {
  return (
    <Badge variant="outline" className="gap-1 font-normal" title={`MCP server: ${serverId}`}>
      <Server aria-hidden className="size-3" />
      <span className="max-w-40 truncate">{serverId}</span>
    </Badge>
  );
}

/** R-MCP5 — a running tool's progress bar + cancel. The elapsed ticker lives on the row summary; this is
 *  the determinate/indeterminate progress + the operator's cancel affordance (`notifications/cancelled`). */
function ToolProgressBar({
  progress,
  onCancel,
}: {
  progress: HubToolProgress;
  onCancel?: () => void;
}) {
  const pct =
    progress.total && progress.total > 0 && typeof progress.progress === "number"
      ? Math.min(100, Math.round((progress.progress / progress.total) * 100))
      : undefined;
  return (
    <div className="flex flex-col gap-1.5" data-testid="tool-progress">
      <div className="flex items-center gap-2">
        {typeof pct === "number" ? (
          <Progress value={pct} className="h-1.5 min-w-0 flex-1" />
        ) : (
          <Shimmer className="min-w-0 flex-1 text-caption">
            {progress.message ?? "Working…"}
          </Shimmer>
        )}
        {progress.cancellable && !progress.cancelled && onCancel ? (
          <Button variant="ghost" size="sm" className="shrink-0 gap-1" onClick={onCancel}>
            <X aria-hidden className="size-3" /> Cancel
          </Button>
        ) : null}
      </div>
      {typeof pct === "number" && progress.message ? (
        <Text tone="muted" className="text-caption">
          {progress.message}
          {progress.cancelled ? " — cancelling…" : ""}
        </Text>
      ) : null}
    </div>
  );
}

/** R-MCP7 — the output-cap spill reference card: an oversized tool result was written to the session
 *  workspace instead of the model context; this points the operator (and the model) at the file. */
function SpillCard({ artifact }: { artifact: HubToolArtifact }) {
  return (
    <Alert variant="warning" data-testid="spill-card">
      <AlertHeading level={2}>Large result spilled to the workspace</AlertHeading>
      <AlertDescription className="flex flex-col gap-1">
        <Text className="text-caption">
          The result exceeded the output cap and was saved as{" "}
          <span className="font-mono">{artifact.spillPath ?? "a workspace file"}</span>. The model
          can read it with <span className="font-mono">files.read</span> rather than re-running the
          call.
        </Text>
        {artifact.text ? (
          <Text tone="muted" className="line-clamp-3 font-mono text-caption">
            {artifact.text}
          </Text>
        ) : null}
      </AlertDescription>
    </Alert>
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function scalarText(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "—";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

const STRUCTURED_ROW_CAP = 20;
const STRUCTURED_FIELD_CAP = 16;

/** R-MCP6 — typed rendering of a tool's structured output: a flat object → a label↔value list; a list
 *  of records → typed rows; anything else falls back to the JSON view. `structuredContent` is preferred
 *  by `unwrapToolResult` before this runs, so this sees the tool's typed payload when it has one. */
function StructuredOutput({ value }: { value: unknown }) {
  if (Array.isArray(value) && value.length > 0 && value.every(isRecord)) {
    return (
      <div className="flex flex-col gap-2" data-testid="structured-output">
        {value.slice(0, STRUCTURED_ROW_CAP).map((row, index) => (
          <Descriptions key={index} className="rounded-md border border-border p-2">
            {Object.entries(row)
              .slice(0, STRUCTURED_FIELD_CAP)
              .map(([key, val]) => (
                <DescriptionsItem key={key} label={key} numeric={typeof val === "number"}>
                  {scalarText(val)}
                </DescriptionsItem>
              ))}
          </Descriptions>
        ))}
        {value.length > STRUCTURED_ROW_CAP ? (
          <Text tone="muted" className="text-caption">
            +{value.length - STRUCTURED_ROW_CAP} more rows
          </Text>
        ) : null}
      </div>
    );
  }
  if (isRecord(value) && Object.keys(value).length > 0) {
    return (
      <Descriptions data-testid="structured-output">
        {Object.entries(value)
          .slice(0, STRUCTURED_FIELD_CAP)
          .map(([key, val]) => (
            <DescriptionsItem key={key} label={key} numeric={typeof val === "number"}>
              {scalarText(val)}
            </DescriptionsItem>
          ))}
      </Descriptions>
    );
  }
  // Primitive / string / empty — the technical JSON view (the existing behavior).
  return <ToolOutput output={value} errorText={undefined} />;
}

/** The output slot of a tool row: spill card (R-MCP7) → failed step (R-MCP6 `isError`) → typed
 *  structured render (R-MCP6). The citation envelope's `availableCitations` is dropped by
 *  `unwrapToolResult` (it prefers `structuredContent`/text), surfacing instead as inline chips + Sources. */
function ToolOutputView({ part }: { part: HubToolPart }) {
  if (part.artifact?.kind === "spill") return <SpillCard artifact={part.artifact} />;
  if (part.isError) {
    const errorText = part.errorText ?? mcpErrorText(part.modelContent);
    return <ToolOutput output={undefined} errorText={errorText} />;
  }
  return <StructuredOutput value={unwrapToolResult(part.modelContent)} />;
}

// ── Elicitation (R-MCP4) — form mode via the existing schema→form generator, or URL mode ────────────

const CREDENTIAL_FIELD_RE =
  /(pass(word|phrase)?|secret|token|api[_-]?key|apikey|credential|private[_-]?key|client[_-]?secret)/i;
function looksLikeCredentialField(param: ToolParam): boolean {
  return CREDENTIAL_FIELD_RE.test(param.name);
}
function elicitationHttpsUrl(url: string | undefined): { href: string; host: string } | undefined {
  if (!url) return undefined;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return undefined; // R-MCP4/12 — https-only, never auto-opened
    return { href: parsed.toString(), host: parsed.host };
  } catch {
    return undefined;
  }
}

/**
 * The MCP elicitation surface (R-MCP4). Form mode reuses the app's existing schema→form generator
 * (`lib/schema-params` — the same parser the tool playground uses) and refuses credential-shaped
 * fields; URL mode shows the full URL with domain emphasis and never auto-opens/prefetches. Decline and
 * cancel are first-class. Rendered while the session sits in the `waiting_input` (`question`) phase.
 */
export function ElicitationPanel({
  request,
  onRespond,
  onDecline,
}: {
  request: HubElicitationRequest;
  onRespond?: (values: Record<string, unknown>) => void;
  onDecline?: () => void;
}) {
  if (request.mode === "url") {
    const link = elicitationHttpsUrl(request.url);
    return (
      <Alert data-testid="elicitation-url">
        <AlertHeading level={2}>The tool needs you to visit a link</AlertHeading>
        <AlertDescription className="flex flex-col gap-2">
          <Text className="text-caption">{request.message}</Text>
          {link ? (
            <div className="flex flex-col gap-1 rounded-md border border-border bg-muted/40 p-2">
              <Text tone="muted" className="text-caption">
                Domain: <span className="font-medium text-foreground">{link.host}</span>
              </Text>
              <Text className="min-w-0 break-all font-mono text-caption">{link.href}</Text>
            </div>
          ) : (
            <Text tone="muted" className="text-caption">
              The tool supplied a link that is not a valid https URL — it will not be opened.
            </Text>
          )}
          <div className="flex flex-wrap items-center gap-2">
            {link ? (
              <Button asChild size="sm">
                {/* User-initiated only — never auto-opened or prefetched (R-MCP4/R-MCP12). */}
                <a href={link.href} target="_blank" rel="noreferrer noopener">
                  Open link
                </a>
              </Button>
            ) : null}
            <Button variant="ghost" size="sm" onClick={onDecline}>
              <Ban aria-hidden className="size-3" /> Decline
            </Button>
          </div>
        </AlertDescription>
      </Alert>
    );
  }
  return <ElicitationForm request={request} onRespond={onRespond} onDecline={onDecline} />;
}

function ElicitationForm({
  request,
  onRespond,
  onDecline,
}: {
  request: HubElicitationRequest;
  onRespond?: (values: Record<string, unknown>) => void;
  onDecline?: () => void;
}) {
  const params = useMemo(() => sortParams(parseParams(request.schema, 0)), [request.schema]);
  const credentialField = params.find(looksLikeCredentialField);
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  const setValue = (name: string, value: unknown) => {
    setValues((current) => ({ ...current, [name]: value }));
    setErrors((current) => (current[name] ? { ...current, [name]: "" } : current));
  };

  // R-MCP4 — credential-shaped fields are refused outright (an elicitation must never harvest secrets).
  if (credentialField) {
    return (
      <Alert variant="destructive" data-testid="elicitation-refused">
        <AlertHeading level={2}>This request was declined automatically</AlertHeading>
        <AlertDescription>
          The tool asked for a credential-shaped field (
          <span className="font-mono">{credentialField.name}</span>). Elicitation never collects
          secrets, so this form is not shown.
        </AlertDescription>
      </Alert>
    );
  }

  const submit = () => {
    const next: Record<string, string> = {};
    for (const param of params) {
      const value = values[param.name];
      if (param.required && (value === undefined || value === null || value === "")) {
        next[param.name] = "This field is required.";
      }
    }
    setErrors(next);
    if (Object.keys(next).length > 0) return;
    onRespond?.(values);
  };

  return (
    <Alert data-testid="elicitation-form">
      <AlertHeading level={2}>The tool needs more information</AlertHeading>
      <AlertDescription className="flex flex-col gap-3">
        <Text className="text-caption">{request.message}</Text>
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          {params.map((param) => {
            const fieldId = `elicit-${param.name}`;
            const errorId = errors[param.name] ? `${fieldId}-error` : undefined;
            return (
              <div key={param.name} className="flex min-w-0 flex-col gap-1.5">
                <Label htmlFor={fieldId} className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-caption">{param.name}</span>
                  {param.required ? <Badge variant="secondary">required</Badge> : null}
                </Label>
                {param.enumValues ? (
                  <SelectField
                    id={fieldId}
                    label=""
                    value={String(values[param.name] ?? "")}
                    placeholder="Select…"
                    options={param.enumValues.map((v) => ({ value: v, label: v }))}
                    onChange={(v) => setValue(param.name, v)}
                  />
                ) : param.typeLabel === "boolean" ? (
                  <Switch
                    id={fieldId}
                    checked={Boolean(values[param.name])}
                    onCheckedChange={(checked) => setValue(param.name, checked)}
                  />
                ) : /^(number|integer)/.test(param.typeLabel) ? (
                  <NumberInput
                    id={fieldId}
                    value={(values[param.name] as number | null | undefined) ?? null}
                    onValueChange={(n) => setValue(param.name, n)}
                  />
                ) : /^(array|object)/.test(param.typeLabel) ? (
                  <Textarea
                    id={fieldId}
                    rows={2}
                    spellCheck={false}
                    aria-describedby={errorId}
                    value={String(values[param.name] ?? "")}
                    onChange={(e) => setValue(param.name, e.target.value)}
                  />
                ) : (
                  <Input
                    id={fieldId}
                    spellCheck={false}
                    aria-describedby={errorId}
                    value={String(values[param.name] ?? "")}
                    onChange={(e) => setValue(param.name, e.target.value)}
                  />
                )}
                {errors[param.name] ? (
                  <Text id={errorId} role="alert" className="text-caption text-destructive-text">
                    {errors[param.name]}
                  </Text>
                ) : param.description ? (
                  <Text tone="muted" className="line-clamp-2 text-caption">
                    {param.description}
                  </Text>
                ) : null}
              </div>
            );
          })}
          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" size="sm">
              Submit
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={onDecline}>
              <Ban aria-hidden className="size-3" /> Decline
            </Button>
          </div>
        </form>
      </AlertDescription>
    </Alert>
  );
}

// ── Tool call row — the R-UX1 canonical state machine, rendered inline ─────────────────────────────

function ToolCallRow({
  entry,
  handlers,
}: {
  entry: HubTimelineToolCall;
  handlers: ConversationHandlers;
}) {
  const { part } = entry;
  const running =
    part.state === "input-streaming" ||
    part.state === "input-available" ||
    part.state === "approval-requested" ||
    part.state === "approval-responded";
  const startedAtMs = entry.startedAt ? Date.parse(entry.startedAt) : null;
  const elapsedMs = useElapsed(startedAtMs, running && Number.isFinite(startedAtMs));
  const argsSummary = summarizeArgs(part.args) ?? undefined;
  const summary =
    running && startedAtMs !== null
      ? [argsSummary, formatDuration(elapsedMs)].filter(Boolean).join(" · ")
      : argsSummary;
  const name = prettyToolName(part.toolName);
  const hasOutput = part.state === "output-available" || part.state === "output-error";
  const destructive = part.annotations?.destructiveHint === true;
  const onDecision = handlers.onToolDecision;

  return (
    <Tool defaultOpen={part.state === "approval-requested"}>
      <ToolHeader
        type="dynamic-tool"
        state={part.state}
        toolName={part.toolName}
        title={name}
        summary={summary}
      />
      <ToolContent>
        {/* R-MCP11 origin chip + R-MCP3 annotation badges (shown whether or not approval is gated). */}
        {part.serverId || part.annotations ? (
          <div className="flex flex-wrap items-center gap-1.5">
            {part.serverId ? <ServerChip serverId={part.serverId} /> : null}
            <AnnotationBadges annotations={part.annotations} />
          </div>
        ) : null}

        {/* R-MCP5 progress + cancel on a running tool. */}
        {running && part.progress ? (
          <ToolProgressBar
            progress={part.progress}
            {...(handlers.onCancelTool
              ? { onCancel: () => handlers.onCancelTool?.(part.toolCallId) }
              : {})}
          />
        ) : null}

        <ApprovalCard state={part.state} approval={toolUiPartApproval(part)}>
          <ApprovalCardTitle>Approve &ldquo;{name}&rdquo;?</ApprovalCardTitle>
          <ApprovalCardDescription>
            {destructive
              ? "This tool is annotated destructive — it may make changes that are hard to undo."
              : "This tool call is waiting for your decision."}
          </ApprovalCardDescription>
          <ApprovalCardRequest>
            <AnnotationBadges annotations={part.annotations} />
            <ApprovalCardActions>
              {/* R-MCP3 / R-UX1 — live approve/deny. Disabled (honest, never a dead click) until the
                  parent view wires a decision handler; the route itself is a later WP. */}
              <ApprovalCardDeny
                disabled={!onDecision}
                onClick={() => onDecision?.(part.toolCallId, "deny")}
              >
                Deny
              </ApprovalCardDeny>
              <ApprovalCardApprove
                disabled={!onDecision}
                onClick={() => onDecision?.(part.toolCallId, "allow-once")}
              >
                Approve
              </ApprovalCardApprove>
            </ApprovalCardActions>
          </ApprovalCardRequest>
          <ApprovalCardAccepted>Approved.</ApprovalCardAccepted>
          <ApprovalCardRejected>Denied.</ApprovalCardRejected>
        </ApprovalCard>

        <ToolDetails label="Details" defaultOpen={false}>
          {part.args !== undefined ? <ToolInput input={part.args} /> : null}
          {hasOutput ? <ToolOutputView part={part} /> : null}
        </ToolDetails>
      </ToolContent>
    </Tool>
  );
}

// ── One ordered message part (R-SES2) — the renderer switches on part type/state ───────────────────

function renderMessagePart(
  part: HubMessagePart,
  key: string,
  turn: HubTimelineAssistantTurn,
  toolByCallId: Map<string, HubTimelineToolCall>,
  citations: HubCitation[],
  handlers: ConversationHandlers,
) {
  switch (part.type) {
    case "text": {
      if (part.text.trim().length === 0) return null;
      // WP3.1 (RC4 fix) — assistant text ALWAYS renders through real markdown now; `[n]` markers are
      // woven INLINE via a Streamdown `components` override (`citationMarkdownComponents`) instead of
      // the old `renderCitedText` whole-message array that bypassed markdown entirely whenever any
      // marker resolved (mission syntheses always carry citations, so they always hit that branch).
      // ui-wave U2 (owner feedback, supersedes WP3.1's byte-identical-when-uncited stance): an UNCITED
      // turn now rides the shared `MD_TABLE_COMPONENTS` map too — bare Streamdown's own table block
      // carries a raw-fullscreen expand, whereas the shared map routes every table through
      // `ExpandableTable` (expand → the app's normal Dialog). A cited turn's map already includes the
      // same wrap (see `citationMarkdownComponents`), plus the citation weave.
      const mdComponents =
        citations.length > 0 ? citationMarkdownComponents(citations) : MD_TABLE_COMPONENTS;
      return (
        <AgentMessage key={key} emphasis="answer">
          <MessageContent>
            <MessageResponse components={mdComponents}>{part.text}</MessageResponse>
          </MessageContent>
        </AgentMessage>
      );
    }
    case "reasoning":
      return part.text.trim().length > 0 ? (
        <Reasoning key={key} isStreaming={turn.streaming}>
          <ReasoningTrigger />
          <ReasoningContent>{part.text}</ReasoningContent>
        </Reasoning>
      ) : null;
    case "tool_call": {
      const entry = toolByCallId.get(part.toolCallId) ?? { id: part.toolCallId, part };
      const merged = entry.part;
      // WP2.6 (R-GUI2/3) — a `present`/`prompt_user` (source "genui") call renders as a WIDGET in the
      // genui region, not as a tool card. Everything else is the normal tool-call row.
      if (merged.source === "genui") {
        return (
          <GenUiPart
            key={key}
            toolPart={merged}
            {...(turn.messageId ? { messageId: turn.messageId } : {})}
            widgetKey={merged.toolCallId}
            {...(handlers.genui && turn.messageId
              ? { uiState: handlers.genui.uiStateFor(turn.messageId, merged.toolCallId) }
              : {})}
            {...(handlers.genui ? { handlers: handlers.genui } : {})}
            streaming={turn.streaming}
          />
        );
      }
      // WP3.2 (D-AH11) — a SETTLED `memory.propose_save` call renders the proposal chip instead of the
      // generic tool card (see the module doc above `MemoryProposalChip`); a still-running/errored call
      // falls through to the normal `ToolCallRow` (no successful `hub_memory` artifact to show yet).
      const memoryProposal = memoryProposalFromPart(merged);
      if (memoryProposal) {
        return (
          <MemoryProposalChip
            key={key}
            memoryId={memoryProposal.memoryId}
            kind={memoryProposal.kind}
            content={memoryProposal.content}
            scope={memoryProposal.scope}
            {...(memoryProposal.scopeId ? { scopeId: memoryProposal.scopeId } : {})}
            saved={handlers.memory?.savedMemoryIds.has(memoryProposal.memoryId) ?? false}
            scopeOptions={handlers.memory?.scopeOptions ?? []}
            {...(handlers.memory ? { onAccept: handlers.memory.onAccept } : {})}
          />
        );
      }
      return <ToolCallRow key={key} entry={{ ...entry, part }} handlers={handlers} />;
    }
    case "citation": {
      const citation = citations.find((c) => c.id === part.citationId);
      return citation ? (
        <Badge
          key={key}
          variant="outline"
          className="w-fit tabular-nums text-meta"
          title={citation.title}
        >
          [{citation.id}]
        </Badge>
      ) : null;
    }
    case "artifact_ref":
      return (
        <Badge key={key} variant="secondary" className="w-fit gap-1.5">
          <FileText aria-hidden className="size-3" />
          {part.title ?? part.artifactId}
        </Badge>
      );
    case "generative-ui": {
      // WP2.6 (R-GUI3) — a settled `generative-ui` message part (the persisted widget). Rendered through
      // the SAME allowlisted renderer + two-tier interactivity as a live genui tool call.
      const widgetKey = part.key ?? key;
      return (
        <GenUiPart
          key={key}
          spec={part.spec}
          {...(turn.messageId ? { messageId: turn.messageId } : {})}
          widgetKey={widgetKey}
          {...(handlers.genui && turn.messageId
            ? { uiState: handlers.genui.uiStateFor(turn.messageId, widgetKey) ?? part.state }
            : { uiState: part.state })}
          {...(handlers.genui ? { handlers: handlers.genui } : {})}
          streaming={turn.streaming}
        />
      );
    }
    default:
      return null;
  }
}

// ── One turn / one user item ────────────────────────────────────────────────────────────────────────

function UserTurn({ text, model }: { text: string; model?: string }) {
  const trimmed = text.trim();
  return (
    <UserMessage>
      <MessageContent>
        {trimmed.length > 0 ? (
          <Text className="min-w-0 whitespace-pre-wrap break-words">{trimmed}</Text>
        ) : (
          <Text tone="muted">No message text.</Text>
        )}
        {model ? (
          <Badge
            variant="outline"
            className="mt-1.5 w-fit font-normal"
            title="Model requested for this turn"
          >
            {model}
          </Badge>
        ) : null}
      </MessageContent>
    </UserMessage>
  );
}

function QueuedTurn({ item }: { item: HubTimelineQueuedItem }) {
  return (
    <div className="ms-auto flex max-w-[85%] min-w-0 flex-col items-end gap-1 opacity-70">
      <Badge variant="outline" className="w-fit gap-1.5 font-normal">
        Queued — will send once the current turn finishes
      </Badge>
      <Text className="min-w-0 whitespace-pre-wrap break-words text-end">{item.text}</Text>
    </div>
  );
}

/** WP4.3 (D-AH17/R-SES11) — the limit-error banner's live retry wiring. Absent ⇒ `turn.limitError`
 *  still renders the message, just without a working retry action (an older turn, or a read-only
 *  regenerate variant — mirrors every other `ConversationHandlers` "absent = honestly inert" degrade). */
export type LimitErrorRetryHandlers = {
  roster: HubModelOption[];
  /** Credentials that exist but contribute no selectable row (`useHubModelRoster().unavailable`). */
  unavailable: HubModelCredentialIssue[];
  /** The session's persisted pin — what the failed turn ran on (`null` => pre-v55/unpinned). */
  currentCredentialId: string | null;
  retrying: boolean;
  /** model-identity WP 4.3 (D-MI1) — the whole roster ROW, so the retry carries provider identity
   *  (model **and** credential) instead of a bare id the server has to re-guess a provider from. */
  onRetry: (source: HubLimitRetrySource, target: HubModelOption) => void;
};

function AssistantTurnBlock({
  turn,
  handlers,
  limitErrorRetry,
}: {
  turn: HubTimelineAssistantTurn;
  handlers: ConversationHandlers;
  limitErrorRetry?: LimitErrorRetryHandlers;
}) {
  const toolByCallId = useMemo(
    () => new Map(turn.toolCalls.map((entry) => [entry.part.toolCallId, entry])),
    [turn.toolCalls],
  );
  const hasContent = turn.parts.length > 0;

  return (
    <div className="flex min-w-0 flex-col gap-3">
      {/* R-SES10 — per-message model chip. */}
      {turn.model ? (
        <Badge
          variant="outline"
          className="w-fit gap-1 font-normal"
          title="Model used for this reply"
        >
          <Bot aria-hidden className="size-3" />
          {turn.model}
        </Badge>
      ) : null}

      {hasContent ? (
        turn.parts.map((part, index) =>
          renderMessagePart(
            part,
            `${turn.id}-part-${index}`,
            turn,
            toolByCallId,
            turn.citations,
            handlers,
          ),
        )
      ) : turn.streaming ? (
        // Liveness — dead air is a defect (R-UX3): a Shimmer before the first token/tool call.
        <AgentMessage>
          <MessageContent>
            <Shimmer>Thinking…</Shimmer>
          </MessageContent>
        </AgentMessage>
      ) : null}

      {/* R-UX5 — the per-message Sources panel (grounding footer) once the turn has cited sources. */}
      {!turn.streaming ? <MessageSources citations={turn.citations} /> : null}

      {turn.limitError ? (
        <HubLimitErrorBanner
          message={turn.limitError.message}
          retrySources={turn.limitError.retrySources ?? []}
          {...(turn.model ? { currentModel: turn.model } : {})}
          roster={limitErrorRetry?.roster ?? []}
          unavailable={limitErrorRetry?.unavailable ?? []}
          currentCredentialId={limitErrorRetry?.currentCredentialId ?? null}
          interactive={!!limitErrorRetry}
          retrying={limitErrorRetry?.retrying ?? false}
          onRetry={(source, target) => limitErrorRetry?.onRetry(source, target)}
        />
      ) : null}

      {turn.errorMessage ? (
        <Alert variant="destructive">
          <AlertHeading level={2}>The assistant hit an error</AlertHeading>
          <AlertDescription>{turn.errorMessage}</AlertDescription>
        </Alert>
      ) : null}

      {/* The in-transcript MCP-reachability notice(s). Rendered ONLY once the turn has SETTLED
          (`!turn.streaming`, per `.claude/rules/loading-states.md` — an error slot must never fire
          mid-stream). An auth failure becomes an actionable "Authenticate" card; a plain transport
          failure surfaces only for a server the owner explicitly scoped in (auto mode skips it). */}
      {!turn.streaming && turn.mcpServerIssues && turn.mcpServerIssues.length > 0 ? (
        <McpServerNotices issues={turn.mcpServerIssues} mcpAuth={handlers.mcpAuth} />
      ) : null}
    </div>
  );
}

type McpServerIssue = NonNullable<HubTimelineAssistantTurn["mcpServerIssues"]>[number];

/** The plain "unreachable this turn" warning (transport failures) — the legacy card, extracted. */
function UnreachableWarning({ issues }: { issues: McpServerIssue[] }) {
  return (
    <Alert variant="warning">
      <ServerOff aria-hidden className="size-4" />
      <AlertHeading level={2}>
        {issues.length === 1
          ? "An MCP server was unreachable this turn"
          : `${issues.length} MCP servers were unreachable this turn`}
      </AlertHeading>
      <AlertDescription className="flex min-w-0 flex-col gap-1">
        {issues.map((issue) => (
          <span key={issue.serverId} className="min-w-0">
            <span className="font-medium">{issue.serverName}</span>
            {issue.message ? <span className="text-muted-foreground"> — {issue.message}</span> : null}
          </span>
        ))}
        <span className="text-caption text-muted-foreground">
          Its tools weren't available for this reply. Check the server in the Context rail and retry,
          or reconnect it from Servers.
        </span>
      </AlertDescription>
    </Alert>
  );
}

/**
 * MCP-reachability notice(s) for one settled turn. Partitions this turn's issues:
 *   - AUTH failures (reauth-able) → an actionable "Authenticate" card (any mode) whose button opens the
 *     ServerWizard reauth flow via `mcpAuth.onAuthenticate`.
 *   - TRANSPORT failures → the plain warning, but ONLY for a server the owner explicitly scoped in;
 *     in AUTO mode (`scopedServerIds === null`) they are silently skipped — the model just used whatever
 *     was reachable, so there is nothing actionable to nag about.
 * Without `mcpAuth` (no session context — e.g. a read-only regenerate variant) it falls back to the
 * legacy plain warning for every issue.
 */
function McpServerNotices({
  issues,
  mcpAuth,
}: {
  issues: McpServerIssue[];
  mcpAuth: ConversationHandlers["mcpAuth"];
}) {
  if (!mcpAuth) return <UnreachableWarning issues={issues} />;
  const authIssues = issues.filter((issue) => issue.authRequired);
  const otherIssues = issues.filter((issue) => !issue.authRequired);
  const scoped = mcpAuth.scopedServerIds;
  const shownUnreachable = scoped
    ? otherIssues.filter((issue) => scoped.has(issue.serverId))
    : []; // auto mode → transport failures are silent
  if (authIssues.length === 0 && shownUnreachable.length === 0) return null;
  return (
    <div className="flex min-w-0 flex-col gap-3">
      {authIssues.length > 0 ? (
        <Alert variant="info">
          <KeyRound aria-hidden className="size-4" />
          <AlertHeading level={2}>
            {authIssues.length === 1
              ? "A server needs authentication"
              : `${authIssues.length} servers need authentication`}
          </AlertHeading>
          <AlertDescription className="flex min-w-0 flex-col gap-2">
            <span className="text-caption text-muted-foreground">
              Sign in to use {authIssues.length === 1 ? "its" : "their"} tools in this session.
            </span>
            <div className="flex flex-wrap gap-2">
              {authIssues.map((issue) => (
                <Button
                  key={issue.serverId}
                  type="button"
                  size="sm"
                  variant="outline"
                  className="w-fit"
                  onClick={() => mcpAuth.onAuthenticate(issue.serverId, issue.serverName)}
                >
                  <KeyRound className="size-4" aria-hidden />
                  Authenticate {issue.serverName}
                </Button>
              ))}
            </div>
          </AlertDescription>
        </Alert>
      ) : null}
      {shownUnreachable.length > 0 ? <UnreachableWarning issues={shownUnreachable} /> : null}
    </div>
  );
}

// ── Regenerate + branch variants (WP2.5, R-SES6) ────────────────────────────────────────────────────
//
// "Regenerate" on the LAST settled assistant turn forks the CURRENT session via the EXISTING `/branch`
// route (WP1.2/1.7's `POST /api/hub/sessions/:id/branch` — `lib/api.ts#branchHubSession`, unmodified),
// cut off just BEFORE that turn (the preceding user message's own `seq`, minus one), then resends the
// SAME user text to the new sibling session for a fresh reply. Each sibling is a REAL, independent hub
// session (visible in the rail, its own durable event log — R-SES1 lineage), not an in-place text edit —
// exactly the "same mechanics as WP2.5 variants" R-SES6 describes for rewind/branch. `MessageBranch*`
// then lets the operator page between: variant 0 is always the ORIGINAL session's own turn (rendered
// in-place, no extra fetch); variants 1..N are the regenerated siblings, each rendered by
// `RegeneratedVariant` subscribing to ITS OWN live `useHubStream` — the SAME hook and rendering
// (`AssistantTurnBlock`) any session view uses, so a still-streaming regenerate looks and behaves
// identically to a live reply (Shimmer, tool calls, citations — no bespoke second rendering path).
//
// Sibling groups are keyed by the STABLE "turn key" — the id of the user message that started the turn
// — so they survive across regenerations of the SAME turn and are naturally scoped per-session.
//
// R-SES1 fix (Wave-2 adversarial review, finding a): groups are DERIVED from the session's persisted
// `branch_created` events (`reconstructVariantGroups`), not local-only React state, so the sibling
// switcher survives a reload / session switch exactly like `ui_state` (~line 1186) and the mission board
// (`reconstructMissionBoard`) already do. A live `handleRegenerate` still works because the branch's
// OWN `branch_created` event is appended to THIS (source) session and streams back over the same SSE
// connection this pane already subscribes to (`useHubStream`'s default event-fold case), landing in
// `stream.events` — no separate optimistic write needed. `regeneratingKeys` (below) stays genuine local
// React state: which turn's Regenerate button is mid-flight is not itself durable event-log state.

/** One turn's accumulated regenerate siblings (variant 0 is always the original session's own turn —
 *  never stored here). */
type VariantGroup = { siblingSessionIds: string[] };

/**
 * Reconstruct every turn's regenerate sibling group from the event log alone (R-SES1). A regenerate
 * (`handleRegenerate` below) branches the source session at `atSeq = <the turn's user message>.seq - 1`
 * and the `/branch` route persists that as `fromSeq` on the resulting `branch_created` event — so a
 * `branch_created` event's `fromSeq` maps back to the turn key (the STARTING user message's id) via the
 * `user_message` whose `seq === fromSeq + 1`. Order matches insertion order (ascending `seq` of the
 * `branch_created` events), the same order a live `handleRegenerate` appends in. A `branch_created` event
 * with no `fromSeq`, or one whose `fromSeq + 1` matches no known `user_message`, isn't a regenerate
 * variant of a known turn (e.g. branched with no cutoff) and is skipped rather than guessed at.
 */
export function reconstructVariantGroups(
  events: readonly HubEvent[],
): Record<string, VariantGroup> {
  const userMessageIdBySeq = new Map<number, string>();
  for (const event of events) {
    if (event.type === "user_message" && event.seq !== undefined) {
      userMessageIdBySeq.set(event.seq, event.messageId);
    }
  }
  const groups: Record<string, VariantGroup> = {};
  for (const event of events) {
    if (event.type !== "branch_created" || event.fromSeq === undefined) continue;
    const turnKey = userMessageIdBySeq.get(event.fromSeq + 1);
    if (!turnKey) continue;
    const existing = groups[turnKey]?.siblingSessionIds ?? [];
    groups[turnKey] = { siblingSessionIds: [...existing, event.branchSessionId] };
  }
  return groups;
}

/** A regenerated sibling's rendered content — subscribes to its OWN session id and renders its last
 *  assistant turn with the SAME `AssistantTurnBlock` the original session's turn uses. */
function RegeneratedVariant({
  sessionId,
  handlers,
}: {
  sessionId: string;
  handlers: ConversationHandlers;
}) {
  const stream = useHubStream(sessionId);
  const lastTurn = useMemo(
    () =>
      [...stream.timeline]
        .reverse()
        .find((item): item is HubTimelineAssistantTurn => item.kind === "assistant_turn"),
    [stream.timeline],
  );
  if (!lastTurn) {
    // Liveness — dead air is a defect (R-UX3): the branch was just created and hasn't produced its
    // first settled/streaming turn yet (a brief window right after the regenerate kicks off).
    return (
      <AgentMessage>
        <MessageContent>
          <Shimmer>Thinking…</Shimmer>
        </MessageContent>
      </AgentMessage>
    );
  }
  // A variant's genui widgets render READ-ONLY: its interactive round-trips would target THIS variant's
  // throwaway branch session, not the main one, so strip the genui handlers (widgets still render).
  const { genui: _genui, ...readOnlyHandlers } = handlers;
  return <AssistantTurnBlock turn={lastTurn} handlers={readOnlyHandlers} />;
}

/** Wraps one assistant turn with its regenerate siblings (if any) + the Regenerate action (if offered).
 *  With no siblings this renders EXACTLY what a bare `AssistantTurnBlock` would (byte-for-byte the same
 *  turn content), so every pre-WP2.5 rendering test is unaffected. `key={siblings.length}` forces
 *  `MessageBranch` (an UNCONTROLLED component — `defaultBranch` is only read once, at mount) to remount
 *  and jump straight to the newest sibling every time a fresh regenerate lands; the minor cost is that
 *  an already-mounted sibling's `useHubStream` also remounts (a brief reconnect+replay, not a bug) —
 *  the vendored component has no external "jump to index" API, so a `key` remount is the correct,
 *  idiomatic way to reach for one. */
function AssistantTurnWithVariants({
  turn,
  handlers,
  isLast,
  variantGroup,
  regenerating,
  onRegenerate,
  limitErrorRetry,
}: {
  turn: HubTimelineAssistantTurn;
  handlers: ConversationHandlers;
  isLast: boolean;
  variantGroup: VariantGroup | undefined;
  regenerating: boolean;
  onRegenerate?: () => void;
  limitErrorRetry?: LimitErrorRetryHandlers;
}) {
  const siblings = variantGroup?.siblingSessionIds ?? [];
  const showRegenerate = isLast && !turn.streaming && !turn.errorMessage && !!onRegenerate;

  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      {/* a11y (critique 2026-07-25T20-00-10Z item 5) — a SMALL, scoped status region for the
          TRAILING turn's start/stop, separate from the transcript-wide `role="log"` above: an
          `<output>` (implicit `role="status"`, matching `ResultCount.tsx`'s own precedent — a native
          semantic element instead of a raw `role="status"` attribute, per Biome's
          `useSemanticElements`) is atomic (its ENTIRE content is re-announced on every change), so it
          deliberately does NOT wrap the growing message body — only this short sr-only line's text
          changes (at most twice: streaming start, then settle), which is what makes it safe to use
          here without re-reading a token-by-token streaming reply. `aria-busy` mirrors the streaming
          flag. Scoped to `isLast` only: earlier, settled turns never change again, so they get no
          status region of their own (the "trailing turn" scoping the audit asked for). */}
      {isLast ? (
        <output aria-live="polite" aria-busy={turn.streaming} className="sr-only">
          {turn.streaming ? "Assistant is responding…" : "Assistant finished responding."}
        </output>
      ) : null}
      {siblings.length > 0 ? (
        <MessageBranch key={siblings.length} defaultBranch={siblings.length} className="gap-1.5">
          <MessageBranchContent>
            <AssistantTurnBlock
              key="original"
              turn={turn}
              handlers={handlers}
              {...(limitErrorRetry ? { limitErrorRetry } : {})}
            />
            {siblings.map((sessionId) => (
              <RegeneratedVariant key={sessionId} sessionId={sessionId} handlers={handlers} />
            ))}
          </MessageBranchContent>
          <MessageBranchSelector className="w-fit">
            <MessageBranchPrevious />
            <MessageBranchPage />
            <MessageBranchNext />
          </MessageBranchSelector>
        </MessageBranch>
      ) : (
        <AssistantTurnBlock
          turn={turn}
          handlers={handlers}
          {...(limitErrorRetry ? { limitErrorRetry } : {})}
        />
      )}
      {showRegenerate ? (
        <MessageActions>
          <MessageAction
            label="Regenerate"
            tooltip="Regenerate — starts a fresh reply as a new branch session"
            disabled={regenerating}
            onClick={onRegenerate}
          >
            <RefreshCw aria-hidden className={cn("size-3.5", regenerating && "animate-spin")} />
          </MessageAction>
        </MessageActions>
      ) : null}
    </div>
  );
}

/**
 * WP4.3 — mounts the live hub model roster (`useHubModelRoster`, a `GET /api/providers/:id/models`
 * fan-out) ONLY when the trailing turn actually needs a limit-error retry affordance, so every other
 * turn/render — the overwhelming majority of a session's transcript — never fires that fetch. The
 * caller renders this INSTEAD of a bare `AssistantTurnWithVariants` for exactly that one turn.
 */
function TrailingLimitErrorTurn({
  retrying,
  onRetry,
  currentCredentialId,
  ...rest
}: {
  turn: HubTimelineAssistantTurn;
  handlers: ConversationHandlers;
  isLast: boolean;
  variantGroup: VariantGroup | undefined;
  regenerating: boolean;
  onRegenerate?: () => void;
  retrying: boolean;
  /** The session's persisted credential pin — what the failed turn ran on (model-identity WP4.3). */
  currentCredentialId: string | null;
  onRetry: (source: HubLimitRetrySource, target: HubModelOption) => void;
}) {
  const { models, unavailable } = useHubModelRoster();
  return (
    <AssistantTurnWithVariants
      {...rest}
      limitErrorRetry={{ roster: models, unavailable, currentCredentialId, retrying, onRetry }}
    />
  );
}

/**
 * hub-fixes WP5.2 (RC5, D-HF2) — mounts the live hub model roster (`useHubModelRoster`, the SAME
 * `GET /api/providers/:id/models` fan-out `TrailingLimitErrorTurn` above narrow-mounts) ONLY when the
 * caller has already decided a research hint/notice is a real candidate to render (see
 * `needsModelCapabilityCheck`), so this fetch never fires for the overwhelming majority of ordinary
 * sessions. Resolves whether the session's OWN model is a provider kind WP 5.1 backs
 * (`HUB_WEB_SEARCH_PROVIDER_KINDS` — mirrors `providerSupportsWebSearch` exactly); a model missing
 * from the live roster (no/bad credential, or a manually-typed model id) resolves to `false` — the
 * caller's hint/notice then just shows its plainer copy, never a broken assumption of built-in web
 * access. Renders nothing itself; reports back via `onResolve` once the roster settles.
 */
function ResearchModelWebSearchProbe({
  modelId,
  credentialId,
  onResolve,
}: {
  modelId: string | undefined;
  /** D-MI8 — the session's pinned credential, so a model id exposed by TWO credentials resolves to the
   *  kind it actually runs on (`anthropic` vs `claude_subscription` are different kinds behind
   *  byte-identical ids). `null` (an unpinned/pre-v55 session) keeps the first-match-by-id behaviour. */
  credentialId: string | null;
  onResolve: (supported: boolean) => void;
}) {
  const { models, loading } = useHubModelRoster();
  useEffect(() => {
    if (loading) return;
    const kind: ProviderKind | undefined = findHubModelOption(models, modelId, credentialId)?.kind;
    onResolve(kind ? (HUB_WEB_SEARCH_PROVIDER_KINDS as readonly ProviderKind[]).includes(kind) : false);
  }, [loading, models, modelId, credentialId, onResolve]);
  return null;
}

// ── Produced assets (WP3.4, D-AH12) — everything the assistant WROTE to the workspace this session ──
//
// Derived, not persisted separately: a `workspace_file` artifact (`files.write`/`files.edit`) or a
// `spill` artifact (an output-cap-capped MCP result, R-MCP7) already rides the settled `tool_result`
// event's `artifact` channel (`turn-engine.ts`'s WP3.4 wiring; `SpillCard`/`ToolOutputView` above
// already render each one INLINE, at its own tool-call row) — this panel is the SESSION-WIDE summary
// the real `@brand/ai` `ProducedAssetTree` renders, deduped by path across every turn so far. Selecting
// an entry promotes that workspace file to a versioned artifact (WP1.6 canvas) — additive, never
// destructive, so a plain click (no confirmation dialog) is the right affordance here.

function inferAssetType(path: string): ContextAssetType {
  const ext = path.split(".").pop()?.toLowerCase();
  if (ext === "md" || ext === "markdown") return "markdown";
  if (ext === "csv") return "csv";
  if (ext === "sql") return "sql";
  if (ext && ["png", "jpg", "jpeg", "gif", "webp", "svg"].includes(ext)) return "image";
  return "code";
}

function assetNameFromPath(path: string): string {
  return path.split("/").pop() || path;
}

/** Walk every settled tool call in the timeline for a produced-file artifact; last write per path wins
 *  (an edited-then-re-edited file shows once, keyed by its current path). */
export function deriveProducedAssets(timeline: HubTimelineItem[]): ContextAsset[] {
  const byPath = new Map<string, ContextAsset>();
  for (const item of timeline) {
    if (item.kind !== "assistant_turn") continue;
    for (const call of item.toolCalls) {
      const artifact = call.part.artifact;
      const path =
        artifact?.kind === "workspace_file" || artifact?.kind === "spill"
          ? artifact.spillPath
          : undefined;
      if (!path) continue;
      byPath.set(path, {
        id: call.part.toolCallId,
        name: assetNameFromPath(path),
        path,
        type: inferAssetType(path),
      });
    }
  }
  return [...byPath.values()];
}

function ProducedAssetsPanel({
  session,
  assets,
}: { session?: HubSession; assets: ContextAsset[] }) {
  if (assets.length === 0) return null;

  const handleSelect = (asset: ContextAsset) => {
    if (!session || !asset.path) return;
    void promoteHubWorkspaceFile(session.id, asset.path)
      .then(() => toast.success("Promoted to artifact", { description: asset.name }))
      .catch((error) => notifyError("Couldn’t promote", { description: getErrorMessage(error) }));
  };

  return (
    <div className="rounded-lg border bg-card p-3" data-testid="produced-assets-panel">
      <div className="mb-2 flex items-center gap-1.5 text-meta text-muted-foreground">
        <FolderTree className="size-3.5" aria-hidden="true" />
        <span>Produced files this session — select to promote to an artifact</span>
      </div>
      <ProducedAssetTree assets={assets} onSelect={handleSelect} />
    </div>
  );
}

// ── The transcript itself ───────────────────────────────────────────────────────────────────────────

/** R-UX10 — curated starter chips on an empty session (mirrors the WP0.4 placeholder copy, now real
 *  — a click SENDS the prompt instead of doing nothing). */
export const HUB_STARTER_SUGGESTIONS = [
  "Summarize my last MCP scan",
  "Which tools cost the most tokens?",
  "Draft a plan to compare two servers",
];

/** Every distinct source cited across the whole session, deduped by id (feeds the session rail). */
function sessionCitations(timeline: HubTimelineItem[]): HubCitation[] {
  const byId = new Map<string, HubCitation>();
  for (const item of timeline) {
    if (item.kind !== "assistant_turn") continue;
    for (const citation of item.citations)
      if (!byId.has(citation.id)) byId.set(citation.id, citation);
  }
  return [...byId.values()];
}

// ── Compaction marker (WP3.3 / R-SES8) — "earlier turns compacted", expandable ──────────────────────
//
// A compaction collapses the OLDER turns into a rolling summary in what the MODEL sees — the human
// transcript above still shows every turn (nothing is hidden). The marker sits at the compaction
// boundary and lets the operator EXPAND the exact summary the model now carries, plus the honest
// token-window saving and what was cleared / re-attached. Derived from the session's `compaction` events
// alone (R-SES1 replay), the same way the mission board + regenerate variants reconstruct from events.

/** The wire-shaped compaction event (payload + the `{ seq, at }` envelope from the event union). */
export type HubCompactionWireEvent = Extract<HubEvent, { type: "compaction" }>;

/** A compaction event anchored to the id of the last transcript item it summarized (`null` → render at
 *  the very top, before any turn — a compaction whose boundary predates the visible timeline). */
export type CompactionMarkerAnchor = { event: HubCompactionWireEvent; anchorId: string | null };

export function reconstructCompactionMarkers(
  events: readonly HubEvent[],
): CompactionMarkerAnchor[] {
  const messages: { seq: number; id: string }[] = [];
  for (const event of events) {
    if (event.seq === undefined) continue;
    if (event.type === "user_message" || event.type === "assistant_message") {
      messages.push({ seq: event.seq, id: event.messageId });
    }
  }
  const markers: CompactionMarkerAnchor[] = [];
  for (const event of events) {
    if (event.type !== "compaction") continue;
    // Anchor to the LAST user/assistant message at or before the compaction boundary (`uptoSeq`).
    let anchorId: string | null = null;
    for (const message of messages) {
      if (message.seq <= event.uptoSeq) anchorId = message.id;
      else break;
    }
    markers.push({ event, anchorId });
  }
  return markers;
}

export function CompactionMarker({ event }: { event: HubCompactionWireEvent }) {
  const [expanded, setExpanded] = useState(false);
  const freed = Math.max(0, event.windowBefore - event.windowAfter);
  const skillCount = event.reattachedSkillIds?.length ?? 0;
  return (
    <div
      className="mx-auto flex w-full max-w-2xl min-w-0 flex-col gap-2 rounded-md border border-dashed border-border bg-muted/40 p-3"
      data-testid="compaction-marker"
    >
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <Layers aria-hidden className="size-4 shrink-0 text-muted-foreground" />
        <Text className="min-w-0 font-medium">Earlier turns compacted</Text>
        {freed > 0 ? (
          <Badge variant="secondary" className="font-normal tabular-nums">
            freed ~{freed.toLocaleString()} tokens
          </Badge>
        ) : null}
        {event.clearedToolOutputs > 0 ? (
          <Badge variant="outline" className="font-normal tabular-nums">
            {event.clearedToolOutputs.toLocaleString()} tool output
            {event.clearedToolOutputs === 1 ? "" : "s"} cleared
          </Badge>
        ) : null}
        {skillCount > 0 ? (
          <Badge variant="outline" className="font-normal tabular-nums">
            {skillCount} skill{skillCount === 1 ? "" : "s"} re-attached
          </Badge>
        ) : null}
        <Button
          variant="ghost"
          size="sm"
          className="ms-auto shrink-0 gap-1"
          onClick={() => setExpanded((value) => !value)}
          aria-expanded={expanded}
        >
          {expanded ? (
            <ChevronDown aria-hidden className="size-3.5" />
          ) : (
            <ChevronRight aria-hidden className="size-3.5" />
          )}
          {expanded ? "Hide summary" : "Show summary"}
        </Button>
      </div>
      <Text tone="muted" className="text-caption">
        The model now reads a summary of the earlier turns instead of their full text. Everything
        you required earlier still applies — the full transcript above is unchanged.
      </Text>
      {event.userAim ? (
        <Text tone="muted" className="text-caption">
          Aimed at: <span className="text-foreground">{event.userAim}</span>
        </Text>
      ) : null}
      {expanded ? (
        <div
          className="max-h-72 min-w-0 overflow-y-auto rounded-md border border-border bg-background p-3"
          data-testid="compaction-summary"
        >
          <Text className="min-w-0 whitespace-pre-wrap break-words text-caption">
            {event.summary}
          </Text>
        </div>
      ) : null}
    </div>
  );
}

/** WP1.7 — mission-control callbacks + busy flag, wired by the parent (AssistantView) to the mission
 *  routes. All optional: when a callback is absent its control is simply not offered (the plan card +
 *  board still render read-only from the event log). */
export type MissionHandlers = {
  onApproveMission?: (missionId: string) => void;
  onEditMissionPlan?: (missionId: string, plan: HubMissionPlan) => void;
  onCancelMission?: (missionId: string) => void;
  onStopMission?: (missionId: string) => void;
  onStopAgent?: (missionId: string, agentSessionId: string) => void;
  /** WP2.3 — steer a running mission agent (R-SES3/R-UX4). */
  onSteerAgent?: (missionId: string, agentSessionId: string, text: string) => void;
  /** v1-fixes (F7) — propose a FOLLOW-UP mission seeded with one of the reports' open questions. */
  onProposeFollowup?: (question: string) => void;
  busy?: boolean;
};

/** WP4.2 (D-AH13) — the stable per-turn DOM anchor id a {@link HubTimelineItem}'s `id` (a `messageId`
 *  for both a user message and the assistant turn it opened) renders under, so the Audit view's
 *  deep link (`AssistantView`'s `?message=` → `ConversationPane`'s `scrollToMessageId`) has a real
 *  element to scroll to. Exported so callers/tests reference the exact id this file renders. */
export function hubTurnAnchorId(itemId: string): string {
  return `hub-turn-${itemId}`;
}

export function ConversationPane({
  stream,
  session,
  onStarterSelect,
  handlers = {},
  mission,
  elicitation,
  onElicitationRespond,
  onElicitationDecline,
  onAuthenticateServer,
  scrollToMessageId,
  hideGenericEmptyState = false,
  composerInset = false,
  roleLookup,
  crewLookup,
}: {
  stream: ConversationStream;
  /** WP2.5 — the OPEN session, needed to fork it for turn regenerate (`branchHubSession`). Optional so
   *  every pre-WP2.5 caller/test keeps working unchanged: without it, `onRegenerate` is never computed
   *  and the Regenerate action simply isn't offered (the established "honest not-yet-actionable" gate
   *  this file already uses for `onToolDecision`/mission handlers). */
  session?: HubSession;
  onStarterSelect: (text: string) => void;
  handlers?: ConversationHandlers;
  /** WP1.7 — mission-control callbacks (propose → approve → run → synthesize). */
  mission?: MissionHandlers;
  /** R-MCP4 — an active MCP elicitation to surface (form/URL). The transport that FEEDS this is a
   *  flagged contract gap (see the panel's doc); when set, the full panel renders. */
  elicitation?: HubElicitationRequest | null;
  onElicitationRespond?: (values: Record<string, unknown>) => void;
  onElicitationDecline?: () => void;
  /** Open the MCP-server authentication (ServerWizard reauth) flow for a server that failed with an auth
   *  error this turn. Wired by `AssistantView` to `useMcpAuth().requestReauth` + reconnect. Absent ⇒ no
   *  "Authenticate" affordance is offered (the notice degrades to the plain unreachable warning). */
  onAuthenticateServer?: (serverId: string, serverName: string) => void;
  /** WP4.2 (D-AH13) — the Audit view's "deep-link into session replay": a timeline item id (a
   *  `messageId` — see {@link hubTurnAnchorId}) to scroll into view once this session's turns have
   *  rendered. `AssistantView` sources this from `?message=` on `/assistant`. Scrolls (smoothly, once
   *  per distinct id) rather than highlighting — no visual state to reconcile with the transcript's own
   *  streaming/error styling. */
  scrollToMessageId?: string | null;
  /** WP1.3 (D-HUX13) — once a caller renders `EmptySessionIntro` for a fresh session (the centered
   *  greeting + starter chips + composer), this pane's own generic "Start a conversation" empty
   *  state becomes a second empty state for the same absence (§8.5 forbids that) and should be
   *  suppressed here. Defaults to `false` so every existing caller/test keeps today's behavior
   *  unchanged; `AssistantView` (WP1.1) sets this once `EmptySessionIntro` is wired in as the
   *  fresh-session surface. The research-mode "no research-capable server" guidance below is a
   *  distinct, data-driven state and is NEVER suppressed by this flag. */
  hideGenericEmptyState?: boolean;
  /** WP1.8 integration / WP4.2 (WP1.R-C) — reserve bottom space in the scroll content so the
   *  FLOATING docked composer (`EmptySessionIntro` overlays it at `bottom-6`, not as a flow footer)
   *  never covers the last message. `false` (default) reserves nothing (composer in a normal flow
   *  footer); `true` reserves the fixed `h-40` fallback (used before the composer has been measured);
   *  a `number` reserves that many px — `AssistantView` passes the MEASURED composer clearance
   *  (`composerClearancePx`) so a tall composer (multi-line / attachments / running Stop) still
   *  clears, which the fixed `h-40` could under-reserve. */
  composerInset?: boolean | number;
  /** The role library (id → role), threaded from `AssistantView` so the mission plan card + board
   *  resolve each agent's avatar icon. Absent ⇒ `RoleAvatar` falls back to the model logo / `Persona`. */
  roleLookup?: MissionRoleLookup;
  /** crew-nesting WP4.3 (D-CN5) — the saved-crew library (by id), threaded from `AssistantView` so a
   *  `crewId`-bearing PRE-RUN plan row (`MissionPlanCard`'s `PlannedCrewCard`) resolves the crew's own
   *  name/icon/topology preview. `MissionBoard`/`MissionExpandDialog` need no library lookup — at run
   *  time the live `childBoard` already carries the real topology/agents/rollup, so this is passed to
   *  `MissionPlanCard` only. */
  crewLookup?: MissionCrewLookup;
}) {
  const showLiveGap =
    stream.turnRunning &&
    (stream.timeline.length === 0 || stream.timeline[stream.timeline.length - 1]?.kind === "user");
  const railCitations = useMemo(() => sessionCitations(stream.timeline), [stream.timeline]);
  // WP3.4 — everything the assistant has WRITTEN to the workspace so far this session (see the panel's
  // own doc above); `[]` on most sessions, so the panel simply doesn't render.
  const producedAssets = useMemo(() => deriveProducedAssets(stream.timeline), [stream.timeline]);
  // R-MCP4 — the session is blocked awaiting the operator's answer to a tool's question/elicitation.
  const awaitingQuestion =
    stream.phase === "waiting_input" &&
    (stream.waitingReason === "question" || stream.waitingReason === "elicitation");
  // WP1.7 — reconstruct the mission board from the event log alone (R-SES1). A still-proposed mission
  // renders the editable plan card; once approved it renders the live board (in-band in the transcript).
  const missionBoard = useMemo(() => reconstructMissionBoard(stream.events), [stream.events]);

  // R-MCP13 / hub-fixes WP5.2 (RC5) — "does at least one registered server look research-capable?".
  // Powers the research-mode hint on BOTH an empty transcript (unchanged) and — new in WP5.2 — a
  // COMPACT hint once the session already has a transcript (previously the hint just disappeared the
  // moment a research session had any turn at all), plus the mission-plan-card's web-capability notice
  // (`missionNode` below) when the planner reached for the web but the catalog has nothing that looks
  // capable of it. One fetch serves all three; best-effort — a failed fetch just means every consumer
  // treats it as "unknown" (`null`), never a blocking error on the conversation itself.
  const showResearchEmptyState =
    session?.mode === "research" && stream.timeline.length === 0 && !stream.turnRunning;
  const showResearchCompactHint =
    session?.mode === "research" && stream.timeline.length > 0 && !stream.turnRunning;
  const missionWantsWebCapability = useMemo(() => {
    if (!missionBoard || missionBoard.phase !== "proposed" || missionBoard.approved) return false;
    return (
      missionBoard.plan.agents.some((agent) =>
        missionTextWantsWebCapability(agent.brief, agent.target, agent.expectedOutcome, agent.rationale),
      ) || missionTextWantsWebCapability(missionBoard.plan.rationale)
    );
  }, [missionBoard]);
  const [hasResearchServer, setHasResearchServer] = useState<boolean | null>(null);
  useEffect(() => {
    const needsCheck = showResearchEmptyState || showResearchCompactHint || missionWantsWebCapability;
    if (!needsCheck) return;
    let cancelled = false;
    listServers()
      .then((servers) => {
        if (!cancelled) setHasResearchServer(hasResearchCapableServer(servers));
      })
      .catch(() => {
        if (!cancelled) setHasResearchServer(null);
      });
    return () => {
      cancelled = true;
    };
  }, [showResearchEmptyState, showResearchCompactHint, missionWantsWebCapability]);

  // hub-fixes WP5.2 (D-HF2, acknowledging WP 5.1) — does THIS session already have real web access via
  // the provider-native `web.search` built-in? Mirrors `apps/api/src/hub/session-service.ts`'s
  // `composeWebTools` `isDefaultScope` input EXACTLY (the web app can't import API source): an explicit,
  // NON-EMPTY `toolScope.builtins` list is authoritative on its own (no roster lookup needed); an
  // absent/default-builtins scope falls back to the model's OWN capability
  // (`HUB_WEB_SEARCH_PROVIDER_KINDS`), which needs the live model roster to resolve —
  // `ResearchModelWebSearchProbe` below narrow-mounts that fetch only when it's actually needed.
  const sessionToolScopeIsDefault = !session?.toolScope || session.toolScope.builtins.length === 0;
  const sessionExplicitlyHasWebSearch = session?.toolScope
    ? session.toolScope.builtins.includes(HUB_WEB_SEARCH_BUILTIN)
    : false;
  const [modelSupportsWebSearch, setModelSupportsWebSearch] = useState(false);
  const sessionHasWebSearch = sessionToolScopeIsDefault
    ? modelSupportsWebSearch
    : sessionExplicitlyHasWebSearch;
  // Only probe the live model roster when a hint/notice is actually a CANDIDATE to render (MCP catalog
  // already known empty) AND the answer isn't already decidable from the explicit scope alone — mirrors
  // `TrailingLimitErrorTurn`'s narrow-mount discipline so this fetch never fires for an ordinary session.
  const needsModelCapabilityCheck =
    sessionToolScopeIsDefault &&
    hasResearchServer === false &&
    (showResearchEmptyState || showResearchCompactHint || missionWantsWebCapability);

  // WP2.5 — regenerate/branch variants. `turnKeys` maps an assistant turn's id to the STABLE id of the
  // user message that started it (the key variant state is grouped by — survives across regenerations
  // of the SAME turn); `lastAssistantTurnId` gates the Regenerate action to the current last turn only.
  const turnKeys = useMemo(() => {
    const map = new Map<string, string>();
    let lastUserId: string | null = null;
    for (const item of stream.timeline) {
      if (item.kind === "user") {
        lastUserId = item.id;
        continue;
      }
      if (lastUserId) map.set(item.id, lastUserId);
    }
    return map;
  }, [stream.timeline]);
  const lastAssistantTurnId = useMemo(() => {
    for (let i = stream.timeline.length - 1; i >= 0; i -= 1) {
      const item = stream.timeline[i];
      if (item?.kind === "assistant_turn") return item.id;
    }
    return null;
  }, [stream.timeline]);
  // WP4.3 — the trailing turn's `limitError.message`, if any (used ONLY to suppress the generic
  // "Connection issue" fallback below when the SAME failure already has its own actionable banner).
  const trailingLimitErrorMessage = useMemo(() => {
    const last = stream.timeline[stream.timeline.length - 1];
    return last?.kind === "assistant_turn" ? (last.limitError?.message ?? null) : null;
  }, [stream.timeline]);
  const variantGroups = useMemo(() => reconstructVariantGroups(stream.events), [stream.events]);
  const [regeneratingKeys, setRegeneratingKeys] = useState<ReadonlySet<string>>(new Set());

  const handleRegenerate = useCallback(
    async (turn: HubTimelineAssistantTurn) => {
      const turnKey = turnKeys.get(turn.id);
      if (!session || !turnKey) return;
      const userEvent = stream.events.find(
        (event): event is Extract<HubEvent, { type: "user_message" }> =>
          event.type === "user_message" && event.messageId === turnKey,
      );
      if (!userEvent) return;
      setRegeneratingKeys((current) => new Set(current).add(turnKey));
      try {
        const atSeq = userEvent.seq !== undefined ? userEvent.seq - 1 : undefined;
        const forked = await branchHubSession(session.id, { atSeq, label: "Regenerate" });
        await sendHubMessage(forked.id, {
          text: userEvent.text,
          ...(userEvent.model ? { model: userEvent.model } : {}),
        });
        // No local write here: the `/branch` route persists `branch_created` on THIS (source) session
        // and pushes it over the same SSE connection `stream` already subscribes to, so `variantGroups`
        // (derived above) picks the new sibling up as soon as that event lands — same source of truth
        // a reload replays from (R-SES1).
      } catch (error) {
        notifyError("Couldn’t regenerate", { description: getErrorMessage(error) });
      } finally {
        setRegeneratingKeys((current) => {
          const next = new Set(current);
          next.delete(turnKey);
          return next;
        });
      }
    },
    [session, turnKeys, stream.events],
  );

  // WP4.3 (D-AH17/R-SES11) — the limit-error banner's retry action. Resends the turn's original user
  // text as a NEW message on the SAME session, overriding the model for just that message
  // (`HubSendMessageInput.model`, R-SES10) — no branch/fork (unlike Regenerate): a limit_error already
  // produced no useful reply, so a plain in-session retry is the honest, event-sourced next attempt.
  // The live model roster itself is fetched by `TrailingLimitErrorTurn` below, ONLY when actually
  // needed — not here, so an ordinary render never fires that fetch.
  const [retryingLimitErrorKeys, setRetryingLimitErrorKeys] = useState<ReadonlySet<string>>(
    new Set(),
  );

  const handleRetryLimitError = useCallback(
    async (turn: HubTimelineAssistantTurn, source: HubLimitRetrySource, target: HubModelOption) => {
      const turnKey = turnKeys.get(turn.id);
      if (!session || !turnKey) return;
      const userEvent = stream.events.find(
        (event): event is Extract<HubEvent, { type: "user_message" }> =>
          event.type === "user_message" && event.messageId === turnKey,
      );
      if (!userEvent) return;
      setRetryingLimitErrorKeys((current) => new Set(current).add(turnKey));
      try {
        // model-identity WP 4.3 (D-MI1) — the LAST hop, and the one that used to drop the operator's
        // choice: `{ text, model: modelId }` sent a bare id, so the API re-derived a provider from
        // the model NAME and "retry on the subscription" ran on the metered Anthropic key. The one
        // helper (`hubModelWireFields`) sends `model` + `providerCredentialId` together so no call
        // site can silently send half of it. An unusable pin is refused by the API (D-MI9, 409)
        // rather than quietly re-guessed — surfaced below, never retried on some other source.
        await sendHubMessage(session.id, { text: userEvent.text, ...hubModelWireFields(target) });
      } catch (error) {
        const on =
          source === "other_model"
            ? hubModelTriggerLabel(target)
            : `the ${HUB_DIRECT_RETRY_SOURCE_LABEL[source]} (${hubCredentialLabel(target)})`;
        notifyError(`Couldn’t retry on ${on}`, { description: getErrorMessage(error) });
      } finally {
        setRetryingLimitErrorKeys((current) => {
          const next = new Set(current);
          next.delete(turnKey);
          return next;
        });
      }
    },
    [session, turnKeys, stream.events],
  );

  // WP3.3 (R-SES8) — the in-transcript compaction markers, folded from THIS session's `compaction`
  // events (R-SES1 replay), anchored to the last turn each compaction summarized.
  const { topCompactions, compactionsByAnchor } = useMemo(() => {
    const byAnchor = new Map<string, HubCompactionWireEvent[]>();
    const top: HubCompactionWireEvent[] = [];
    for (const marker of reconstructCompactionMarkers(stream.events)) {
      if (marker.anchorId === null) {
        top.push(marker.event);
      } else {
        const list = byAnchor.get(marker.anchorId) ?? [];
        list.push(marker.event);
        byAnchor.set(marker.anchorId, list);
      }
    }
    return { topCompactions: top, compactionsByAnchor: byAnchor };
  }, [stream.events]);

  // WP2.6 (R-GUI5) — the per-message GenUI `ui_state` lookup, folded from THIS session's event log
  // (R-SES1 replay-rehydration). Keyed by `messageId::widgetKey`, last write wins.
  const uiStateByWidget = useMemo(() => {
    const map = new Map<string, unknown>();
    for (const event of stream.events) {
      if (event.type === "ui_state") map.set(`${event.messageId}::${event.key ?? ""}`, event.state);
    }
    return map;
  }, [stream.events]);

  // WP3.2 (D-AH11) — which memory proposals THIS session has already had explicitly accepted (see
  // `reconstructSavedMemoryIds`'s doc for why only this half is event-sourced).
  const savedMemoryIds = useMemo(() => reconstructSavedMemoryIds(stream.events), [stream.events]);

  // Merge the GenUI two-tier interactivity handlers + the memory-proposal accept action into the ones
  // passed in. Wired only when the session is known (client-side ops persist a `ui_state` event; a
  // to-assistant submit or a memory accept sends a real request against this session's id).
  const handlersWithGenui = useMemo<ConversationHandlers>(() => {
    if (!session) return handlers;
    const sessionId = session.id;
    return {
      ...handlers,
      // MCP-reachability presentation: scoped-in server ids (null ⇒ auto mode) + the authenticate action.
      // Only wired when the caller supplied `onAuthenticateServer` (AssistantView) — a session without it
      // (or without a scope) still degrades gracefully to the plain notice.
      ...(onAuthenticateServer
        ? {
            mcpAuth: {
              scopedServerIds: session.toolScope
                ? new Set(Object.keys(session.toolScope.servers))
                : null,
              onAuthenticate: onAuthenticateServer,
            },
          }
        : {}),
      genui: {
        uiStateFor: (messageId, key) => uiStateByWidget.get(`${messageId}::${key ?? ""}`),
        onPersistUiState: (messageId, key, state) => {
          void postHubUiState(sessionId, {
            messageId,
            ...(key ? { key } : {}),
            state,
          }).catch(() => undefined);
        },
        onSubmit: (text) => {
          void sendHubMessage(sessionId, { text }).catch((error) =>
            notifyError("Couldn’t send", { description: getErrorMessage(error) }),
          );
        },
      },
      memory: {
        savedMemoryIds,
        scopeOptions: memoryScopeOptionsForSession(session),
        onAccept: (memoryId, scope, scopeId) => {
          void acceptHubMemoryProposal(sessionId, memoryId, {
            scope,
            ...(scopeId ? { scopeId } : {}),
          }).catch((error) =>
            notifyError("Couldn’t save to memory", { description: getErrorMessage(error) }),
          );
        },
      },
    };
  }, [handlers, session, uiStateByWidget, savedMemoryIds, onAuthenticateServer]);

  // WP4.2 — the Audit view's deep-link scroll target. Fires once per distinct `scrollToMessageId`
  // (a session switch or a fresh `?message=` navigation resets `lastScrolledRef`, so re-rendering the
  // SAME target — e.g. a new event arriving over SSE — doesn't keep re-scrolling underfoot); waits for
  // the anchor to actually exist (it renders only once `stream.timeline` has settled) rather than
  // firing against a stale DOM.
  const lastScrolledRef = useRef<string | null>(null);
  useEffect(() => {
    if (!scrollToMessageId || lastScrolledRef.current === scrollToMessageId) return;
    const target = document.getElementById(hubTurnAnchorId(scrollToMessageId));
    if (!target) return;
    lastScrolledRef.current = scrollToMessageId;
    target.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [scrollToMessageId, stream.timeline]);

  // WP1.7 — the mission, in-band: the editable plan card while proposed, the live board once approved.
  // hub-fixes WP2.3 follow-up (D-HF5, folded into WP6.1) — the parent session's own tool scope, so the
  // plan card's per-agent chips get their EFFECTIVE-access subtitle (plan grants ∩ this scope) and the
  // per-agent grant editor is constrained to the servers the parent can actually reach. A `null`
  // (`auto`/unscoped) parent is D-HF5's pass-through case: no subtitle, and the picker offers every
  // registered server — so `catalogServerIds` is threaded ONLY for a scoped parent.
  const parentScope = session?.toolScope ?? null;
  const catalogServerIds = parentScope ? Object.keys(parentScope.servers) : undefined;
  const missionNode =
    missionBoard && missionBoard.phase === "proposed" && !missionBoard.approved ? (
      <MissionPlanCard
        missionId={missionBoard.missionId}
        plan={missionBoard.plan}
        {...(roleLookup ? { roleLookup } : {})}
        {...(crewLookup ? { crewLookup } : {})}
        {...(mission?.onApproveMission ? { onApprove: mission.onApproveMission } : {})}
        {...(mission?.onEditMissionPlan ? { onEditPlan: mission.onEditMissionPlan } : {})}
        {...(mission?.onCancelMission ? { onCancel: mission.onCancelMission } : {})}
        {...(mission?.busy ? { busy: mission.busy } : {})}
        {...(hasResearchServer !== null ? { catalogHasResearchServer: hasResearchServer } : {})}
        sessionHasWebSearch={sessionHasWebSearch}
        parentScope={parentScope}
        {...(catalogServerIds ? { catalogServerIds } : {})}
      />
    ) : missionBoard ? (
      <MissionBoard
        board={missionBoard}
        {...(roleLookup ? { roleLookup } : {})}
        {...(missionBoard.plan.budgets ? { budgets: missionBoard.plan.budgets } : {})}
        {...(mission?.onStopMission ? { onStopMission: mission.onStopMission } : {})}
        {...(mission?.onStopAgent ? { onStopAgent: mission.onStopAgent } : {})}
        {...(mission?.onSteerAgent ? { onSteerAgent: mission.onSteerAgent } : {})}
        {...(mission?.onProposeFollowup ? { onProposeFollowup: mission.onProposeFollowup } : {})}
        {...(mission?.busy ? { busy: mission.busy } : {})}
      />
    ) : null;
  // Placement (owner feedback: the synthesized answer must be the LAST message). Once the mission is
  // DONE the "Final Answer" is a normal assistant turn in the timeline — render the board just BEFORE
  // that turn so the answer stays last; while proposed/running (no answer yet) it renders at the end.
  const missionAnchorId =
    missionBoard && missionBoard.phase === "done"
      ? (missionBoard.synthesis?.messageId ?? lastAssistantTurnId)
      : null;
  const missionAnchorInTimeline =
    missionAnchorId != null && stream.timeline.some((item) => item.id === missionAnchorId);

  // The transcript's fade scrims (see `transcriptBottomScrimPx`): the bottom scrim dissolves content
  // into the page ground BEFORE it reaches the floating docked composer (`EmptySessionIntro` overlays
  // it at `bottom-6`, raised to `z-20`), so the conversation reads as ENDING where the composer starts
  // instead of sliding visibly behind it; the top scrim gives the same soft edge up top. Matches the
  // run console's `ChatShell variant="bare"` treatment, adapted to the hub's floating composer.
  const bottomScrimPx = transcriptBottomScrimPx(composerInset);

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      {/* hub-fixes WP5.2 — narrow-mounted ONLY when a research hint/notice is a candidate to render
          AND the answer isn't already decidable from the explicit scope alone (see
          `needsModelCapabilityCheck` above); renders nothing itself. */}
      {needsModelCapabilityCheck ? (
        <ResearchModelWebSearchProbe
          modelId={session?.model}
          credentialId={session?.providerCredentialId ?? null}
          onResolve={setModelSupportsWebSearch}
        />
      ) : null}
      {/* a11y (critique 2026-07-25T20-00-10Z item 5): `@brand/ai`'s `Conversation` already carries a
          bare `role="log"` (vendor `conversation.tsx`) with no name and no explicit `aria-live` —
          effectively an unnamed, implicit-only live region spanning the WHOLE (potentially very long)
          transcript. `aria-live`/`aria-label` mirror the same pattern `AgentTranscript.tsx` and
          `RunConsole.tsx`'s run-transcript wrapper already use; `aria-relevant="additions"` scopes
          announcements to newly-added turns (not text/attribute churn elsewhere in the subtree), and
          `aria-busy` mirrors the turn-running state so AT knows the region is mid-update. These are
          all plain HTML-div props `@brand/ai`'s `Conversation` (`StickToBottomProps extends
          React.HTMLAttributes<HTMLDivElement>`) forwards straight through — no vendor edit. The
          TRAILING turn additionally gets its own small, scoped `role="status"` region (see
          `AssistantTurnWithVariants` below) so a streaming reply's start/stop is announced without
          re-reading the whole growing message on every token (role=status is atomic). */}
      <Conversation
        className="min-h-0 flex-1"
        aria-live="polite"
        aria-relevant="additions"
        aria-busy={stream.turnRunning}
        aria-label="Conversation transcript"
      >
        {/* One centred reading column (D-HUX / end-user UX pass) — the transcript shares the composer's
            max-width so a turn's edges line up with the input below, instead of spanning full-bleed. */}
        <ConversationContent
          className={cn(CHAT_READING_COLUMN_CLASS, "flex min-w-0 flex-col gap-4 p-4")}
        >
          <ProducedAssetsPanel session={session} assets={producedAssets} />
          {stream.timeline.length === 0 && !stream.turnRunning ? (
            <>
              {/* R-MCP13 — research mode with no research-capable server registered: point at the
                bundled research-server recipe (the "Add MCP server" wizard's curated presets) instead
                of the generic starter prompts, which would otherwise return no sources to cite. A
                distinct, data-driven state — NEVER suppressed by `hideGenericEmptyState`. hub-fixes
                WP5.2: suppressed once the session already has real web access via `web.search`
                (`sessionHasWebSearch`) — the generic empty state (starter chips) is the honest fallback
                then, not a stale "you have zero web access" claim. */}
              {showResearchEmptyState && hasResearchServer === false && !sessionHasWebSearch ? (
                <div className="flex min-w-0 flex-col items-center gap-4 py-8">
                  <ConversationEmptyState
                    icon={<Search aria-hidden className="size-6" />}
                    title="No research-capable server yet"
                    description="Research mode answers with cited sources from your registered MCP servers — none of yours look search/fetch-capable yet. Add one from the bundled recipe (Tavily, Brave Search, or Exa)."
                  />
                  <Button asChild size="sm">
                    <Link to="/servers">
                      <Server aria-hidden />
                      <span>Add MCP server</span>
                    </Link>
                  </Button>
                </div>
              ) : hideGenericEmptyState ? // WP1.3 (D-HUX13) — superseded by `EmptySessionIntro`'s centered greeting + starter
              // chips + composer, layered above this (now visually empty, still-transparent) pane by
              // the caller (`AssistantView`, WP1.1) so `ChatCanvas`'s dot-grid shows through.
              null : (
                <div className="flex min-w-0 flex-col items-center gap-4 py-8">
                  <ConversationEmptyState
                    icon={<MessageSquare aria-hidden className="size-6" />}
                    title="Start a conversation"
                    description="Ask about a scan, a run, a skill, or anything else in the app — the assistant can read your data and use its MCP tools."
                  />
                  <Suggestions className="justify-center">
                    {HUB_STARTER_SUGGESTIONS.map((starter) => (
                      <Suggestion key={starter} suggestion={starter} onClick={onStarterSelect} />
                    ))}
                  </Suggestions>
                </div>
              )}
            </>
          ) : (
            <>
              {/* hub-fixes WP5.2 (RC5) — the SAME research-mode hint, compact, once the session already
                  has a transcript (it used to just disappear the moment a research session had any
                  turn — RC5's "the hint disappears once a transcript exists"). Suppressed the moment
                  EITHER an MCP research server appears OR the session already has real web access via
                  `web.search` (`sessionHasWebSearch`, WP 5.1 acknowledgement) — a research session that
                  already has usable web access gets no hint at all. */}
              {showResearchCompactHint && hasResearchServer === false && !sessionHasWebSearch ? (
                <Alert variant="info" data-testid="research-compact-hint">
                  <Search aria-hidden className="size-4" />
                  <AlertHeading level={2}>No research-capable server yet</AlertHeading>
                  <AlertDescription className="flex flex-col gap-2">
                    <Text tone="muted" className="text-caption">
                      Research mode answers with cited sources from your registered MCP servers — none
                      of yours look search/fetch-capable yet. Add one from the bundled recipe (Tavily,
                      Brave Search, or Exa) — you'll paste your own API key; no key is bundled.
                    </Text>
                    <Button asChild size="sm" variant="outline" className="self-start">
                      <Link to="/servers">
                        <Server aria-hidden />
                        <span>Add MCP server</span>
                      </Link>
                    </Button>
                  </AlertDescription>
                </Alert>
              ) : null}
              {/* WP3.3 — a compaction whose boundary predates the visible timeline renders at the top. */}
              {topCompactions.map((event) => (
                <CompactionMarker key={`compaction-${event.seq}`} event={event} />
              ))}
              {stream.timeline.map((item) => {
                const turnKey = item.kind === "user" ? undefined : turnKeys.get(item.id);
                const markers = compactionsByAnchor.get(item.id);
                return (
                  // WP4.2 — `id` is a stable per-turn DOM anchor for the Audit view's deep link
                  // (`scrollToMessageId` above); `display:contents` (the `contents` utility) keeps this
                  // wrapper OUT of the box model entirely, so it renders exactly like the `Fragment` it
                  // replaces — `ConversationContent`'s `gap-4` still applies directly between the turn and
                  // its own trailing compaction marker, not around this wrapper.
                  <div key={item.id} id={hubTurnAnchorId(item.id)} className="contents">
                    {/* Owner feedback — the completed mission board renders just above the synthesis
                      answer so that answer is the last message (see `missionAnchorId`). */}
                    {missionAnchorInTimeline && item.id === missionAnchorId ? missionNode : null}
                    {item.kind === "user" ? (
                      <UserTurn text={item.text} model={item.model} />
                    ) : session &&
                      !stream.turnRunning &&
                      item.id === lastAssistantTurnId &&
                      item.limitError ? (
                      <TrailingLimitErrorTurn
                        turn={item}
                        handlers={handlersWithGenui}
                        isLast
                        variantGroup={turnKey ? variantGroups[turnKey] : undefined}
                        regenerating={!!turnKey && regeneratingKeys.has(turnKey)}
                        onRegenerate={() => void handleRegenerate(item)}
                        retrying={!!turnKey && retryingLimitErrorKeys.has(turnKey)}
                        // model-identity WP 4.3 — what the failed turn ran on, so a one-click retry
                        // can avoid that credential and the picker can select the right one of two
                        // same-id twins. `null` on a pre-v55/unpinned session (degrades by id).
                        currentCredentialId={session.providerCredentialId ?? null}
                        onRetry={(source, target) =>
                          void handleRetryLimitError(item, source, target)
                        }
                      />
                    ) : (
                      <AssistantTurnWithVariants
                        turn={item}
                        handlers={handlersWithGenui}
                        isLast={item.id === lastAssistantTurnId}
                        variantGroup={turnKey ? variantGroups[turnKey] : undefined}
                        regenerating={!!turnKey && regeneratingKeys.has(turnKey)}
                        {...(session && !stream.turnRunning
                          ? { onRegenerate: () => void handleRegenerate(item) }
                          : {})}
                      />
                    )}
                    {/* WP3.3 — the "earlier turns compacted" marker at this compaction's boundary. */}
                    {markers?.map((event) => (
                      <CompactionMarker key={`compaction-${event.seq}`} event={event} />
                    ))}
                  </div>
                );
              })}
            </>
          )}

          {/* WP1.7 — the mission, in-band. Reconstructs from the event log (R-SES1). While proposed/
            running it renders here at the end; once DONE it renders inline just ABOVE the synthesis
            answer instead (see `missionAnchorInTimeline`) so the answer is the last message. */}
          {missionAnchorInTimeline ? null : missionNode}

          {showLiveGap ? (
            <AgentMessage>
              <MessageContent>
                <Shimmer>Thinking…</Shimmer>
              </MessageContent>
            </AgentMessage>
          ) : null}

          {/* Agent-initiated `ask_user` question(s): the interactive answer card(s) — one per still-open
            question. Self-gates on the session's `askUser` capability (mission agents never render one). */}
          <HubQuestionPrompt
            sessionId={session?.id ?? null}
            questions={stream.openQuestions}
            askUser={session?.capabilities?.askUser === true}
          />

          {/* R-MCP4 elicitation: render the full panel when a request is present; otherwise a plain
            "waiting for you" notice while the session sits in a wait phase with no concrete card to show
            (a real `ask_user` question renders its own card above, so the generic notice is suppressed
            once there is an open question). */}
          {elicitation ? (
            <ElicitationPanel
              request={elicitation}
              {...(onElicitationRespond ? { onRespond: onElicitationRespond } : {})}
              {...(onElicitationDecline ? { onDecline: onElicitationDecline } : {})}
            />
          ) : awaitingQuestion && stream.openQuestions.length === 0 ? (
            <Alert data-testid="elicitation-waiting">
              <AlertHeading level={2}>Waiting for your input</AlertHeading>
              <AlertDescription>
                A tool is asking for more information to continue.
              </AlertDescription>
            </Alert>
          ) : null}

          {stream.pendingQueued.length > 0 ? (
            <div className="flex min-w-0 flex-col items-end gap-1">
              {stream.pendingQueued.map((item) => (
                <QueuedTurn key={item.id} item={item} />
              ))}
            </div>
          ) : null}

          {/* R-UX5 — the session-wide source rail (collapsed): every source, once, in stable order. */}
          <SessionSourceRail citations={railCitations} />

          {/* WP4.3 — a `limit_error` already renders its own actionable `HubLimitErrorBanner` on the
            trailing turn above (with the real retry affordance); suppress this generic fallback for
            that exact case so the same failure doesn't render twice. Still fires for a genuine
            connection-lost drop or a plain `error` event, neither of which has a turn-level banner. */}
          {stream.error && stream.error !== trailingLimitErrorMessage ? (
            <Alert variant="destructive">
              <AlertHeading level={2}>Connection issue</AlertHeading>
              <AlertDescription>{stream.error}</AlertDescription>
            </Alert>
          ) : null}

          {/* WP1.8 / WP4.2 (WP1.R-C) — bottom clearance for the floating docked composer (see
            `composerInset`); keeps the last message out from behind it. A `number` reserves the
            MEASURED clearance; `true` is the fixed `h-40` fallback (pre-measurement / no
            ResizeObserver); falsy reserves nothing. */}
          {typeof composerInset === "number" ? (
            composerInset > 0 ? (
              <div
                aria-hidden
                className="w-full shrink-0"
                style={{ height: `${composerInset}px` }}
              />
            ) : null
          ) : composerInset ? (
            <div aria-hidden className="h-40 w-full shrink-0" />
          ) : null}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>

      {/* Top fade — content dissolves into the page ground at the top edge (soft, not a hard cut). */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 z-10 bg-gradient-to-b from-background to-transparent"
        style={{ height: `${TRANSCRIPT_TOP_SCRIM_PX}px` }}
      />
      {/* Bottom fade — content fades to nothing over the composer's band (sized to `composerInset`) so
          the transcript ends where the floating composer starts instead of scrolling behind it. Kept
          BELOW the composer (`z-10` vs the composer wrap's `z-20`) so the composer's card stays crisp. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-background to-transparent"
        style={{ height: `${bottomScrimPx}px` }}
      />
    </div>
  );
}
