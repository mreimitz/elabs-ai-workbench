import { useEffect, useRef, useState } from "react";
import {
  Label,
  RadioGroup,
  RadioGroupItem,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Text,
  cn,
} from "@brand/ui";
import {
  HUB_SESSION_MODES,
  type HubProject,
  type HubSessionCreateInput,
  type HubSessionMode,
  type HubSessionRoster,
  type HubToolGrants,
} from "@mcp-token-footprint/shared";
import { BookOpen, Info, MessageSquare, Search, Server, Sparkles, Users, Wand2 } from "lucide-react";
import { getErrorMessage } from "../../lib/errors";
import { WideDialog, type WideDialogSection } from "../../components/dialogs";
import { SegmentedField } from "../../components/form/SegmentedField";
import { ToolGrantPicker } from "./agents/ToolGrantPicker";
import { SkillPicker } from "./agents/SkillPicker";
import { AgentCrewPicker } from "./agents/AgentCrewPicker";
import { HubModelPicker } from "./HubModelPicker";
import { defaultHubModelOption } from "./hub-model-picker";
import {
  hubModelWireFields,
  type HubModelCredentialIssue,
  type HubModelOption,
} from "./use-hub-models";

/** Radix `Select` disallows an empty-string item value — this sentinel stands in for "no project"
 *  and is translated back to `undefined` before it ever reaches `onCreate`. */
const NO_PROJECT_VALUE = "__none__";

const EMPTY_TOOL_GRANTS: HubToolGrants = { servers: {}, builtins: [] };
const EMPTY_ROSTER: HubSessionRoster = { crewIds: [], agentIds: [] };

/**
 * The mode picker's copy (D-AH5). A `Record` keyed by every {@link HubSessionMode} so a mode added to
 * `HUB_SESSION_MODES` without picker copy fails `pnpm typecheck` instead of silently rendering nothing.
 * End-user UX pass — fuller descriptions + bigger icons; the three cards sit side by side.
 */
const MODE_COPY: Record<
  HubSessionMode,
  { icon: typeof MessageSquare; label: string; description: string }
> = {
  auto: {
    icon: Wand2,
    label: "Auto",
    description:
      "Routed per message: a plain ask gets a chat answer; a bigger task proposes a mission (you still approve) — and it asks first when unsure.",
  },
  chat: {
    icon: MessageSquare,
    label: "Chat",
    description:
      "General-purpose conversation. The assistant searches your MCP tools and skills for what your prompt needs.",
  },
  research: {
    icon: Search,
    label: "Research",
    description:
      "Search-grounded answers that cite their sources inline — for verifiable, referenced findings.",
  },
  mission: {
    icon: Users,
    label: "Mission",
    description:
      "Propose a multi-agent team to work the task in parallel, with a plan you approve before it runs.",
  },
};

// hub-fixes WP6.1 (RC7) — derived from `HUB_SESSION_MODES` (so a new mode without picker copy still
// fails typecheck via `MODE_COPY`), then floated so `auto` — the new default — leads the picker.
const MODE_OPTIONS = HUB_SESSION_MODES.map((value) => ({ value, ...MODE_COPY[value] })).sort(
  (a, b) => Number(b.value === "auto") - Number(a.value === "auto"),
);

export type NewSessionDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  models: HubModelOption[];
  modelsLoading: boolean;
  /** D-MI7 (WP 4.1) — credentials that produced no row; listed disabled-and-visible in the picker. */
  unavailableCredentials?: readonly HubModelCredentialIssue[];
  onCreate: (input: HubSessionCreateInput) => Promise<void>;
  /** The project library; the picker is omitted entirely when there are none yet. */
  projects?: HubProject[];
};

/**
 * Assistant Hub — the new-session dialog, end-user UX pass. Rebuilt on {@link WideDialog} (left-rail
 * sections) so a session can be *pre-configured* before it starts:
 *   • Setup    — pick a mode (side-by-side cards) and a model via a two-step family → model picker.
 *   • MCP & tools — Auto (every reachable server, tool-search — the Claude-Desktop default) or Scoped
 *                   (grant only the servers/tools you pick). Scoped ⇒ `toolScope` on the create input.
 *   • Skills   — Auto (the whole registry, prompt-driven pick) or Pick (attach a specific set) ⇒
 *               `skills` on the create input.
 * Both left on Auto ⇒ the create input carries neither field, and the session behaves like Claude
 * Desktop (discovers tools + skills from the prompt). A `qlik_answers` model runs as a CLEAN session
 * (no MCP/skills, D-QA invariant), so its MCP & Skills sections show a note instead of the pickers.
 */
export function NewSessionDialog({
  open,
  onOpenChange,
  models,
  modelsLoading,
  unavailableCredentials = [],
  onCreate,
  projects = [],
}: NewSessionDialogProps) {
  // hub-fixes WP6.1 (RC7) — new sessions DEFAULT to `auto` (per-message routing); every existing mode
  // stays selectable, and existing sessions/replays are untouched (their persisted mode is authoritative).
  const [mode, setMode] = useState<HubSessionMode>("auto");
  // D-MI1/D-MI8 (WP 3.1) — the selection is the whole ROSTER ROW, not a bare model-id string. The old
  // `useState("")` discarded the credential the picker already knew, and `models.find(m => m.modelId
  // === modelId)` could not tell two colliding twins apart once both survive the roster.
  const [selectedModel, setSelectedModel] = useState<HubModelOption | null>(null);
  const [projectId, setProjectId] = useState(NO_PROJECT_VALUE);
  const [toolAccess, setToolAccess] = useState<"auto" | "scoped">("auto");
  const [toolScope, setToolScope] = useState<HubToolGrants>(EMPTY_TOOL_GRANTS);
  const [skillAccess, setSkillAccess] = useState<"auto" | "pick">("auto");
  const [skillIds, setSkillIds] = useState<string[]>([]);
  const [rosterAccess, setRosterAccess] = useState<"auto" | "pick">("auto");
  const [roster, setRoster] = useState<HubSessionRoster>(EMPTY_ROSTER);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset to a clean form exactly once per open, then opportunistically seed the model once the async
  // roster arrives if nothing is picked yet.
  const openedRef = useRef(false);
  useEffect(() => {
    if (open && !openedRef.current) {
      openedRef.current = true;
      setMode("auto");
      // D-MI7 (WP 4.1) — the DETERMINISTIC first row, not `models[0]`: the roster arrives in
      // `ORDER BY updated_at DESC`, so the seeded provider used to change when an unrelated
      // credential was edited.
      setSelectedModel(defaultHubModelOption(models) ?? null);
      setProjectId(NO_PROJECT_VALUE);
      setToolAccess("auto");
      setToolScope(EMPTY_TOOL_GRANTS);
      setSkillAccess("auto");
      setSkillIds([]);
      setRosterAccess("auto");
      setRoster(EMPTY_ROSTER);
      setCreating(false);
      setError(null);
      return;
    }
    if (!open) {
      openedRef.current = false;
      return;
    }
    setSelectedModel((current) => current ?? defaultHubModelOption(models) ?? null);
  }, [open, models]);

  const modelId = selectedModel?.modelId ?? "";
  // A Qlik Answers model runs as a clean session — no MCP servers or skills can be attached.
  const isCleanSession = selectedModel?.kind === "qlik_answers";

  const handleCreate = async (): Promise<void> => {
    if (!selectedModel) return;
    setCreating(true);
    setError(null);
    try {
      // D-MI1 — the chosen row's credential rides along as the additive optional
      // `providerCredentialId`; `model` is unchanged and byte-identical.
      const input: HubSessionCreateInput = { mode, ...hubModelWireFields(selectedModel) };
      if (projectId !== NO_PROJECT_VALUE) input.projectId = projectId;
      // Auto ⇒ omit the field entirely (the Claude-Desktop default lives server-side); a clean-session
      // model never carries MCP/skill config.
      if (!isCleanSession && toolAccess === "scoped") {
        input.toolScope = toolScope;
      }
      if (!isCleanSession && skillAccess === "pick" && skillIds.length > 0) {
        input.skills = skillIds.map((id) => ({
          skillId: id,
          versionMode: "latest" as const,
          invocationMode: "model_invocable" as const,
        }));
      }
      // Agents & Crews roster — a preferred pool for the mission planner; omit when empty (auto).
      if (
        !isCleanSession &&
        rosterAccess === "pick" &&
        (roster.crewIds.length > 0 || roster.agentIds.length > 0)
      ) {
        input.roster = roster;
      }
      await onCreate(input);
      onOpenChange(false);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setCreating(false);
    }
  };

  const setupContent = (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Text className="font-medium">Mode</Text>
        <RadioGroup
          aria-label="Session mode"
          className="grid gap-3 sm:grid-cols-2"
          value={mode}
          onValueChange={(value) => value && setMode(value as HubSessionMode)}
        >
          {MODE_OPTIONS.map((option) => {
            const id = `hub-new-session-mode-${option.value}`;
            const active = mode === option.value;
            return (
              <Label
                key={option.value}
                htmlFor={id}
                className={cn(
                  "flex cursor-pointer flex-col gap-2 rounded-lg border p-4 text-left font-normal whitespace-normal",
                  active
                    ? "border-primary bg-primary/5 ring-1 ring-primary"
                    : "border-border hover:border-primary/40",
                )}
              >
                <span className="flex items-center justify-between">
                  <option.icon aria-hidden className="size-6 text-primary" />
                  {/* Accessible name = the short mode label only (not the whole card copy), so the
                      `auto` card's copy — which names the other modes — can't make a mode-name radio
                      selector ambiguous; the description below stays visible for sighted + AT users. */}
                  <RadioGroupItem id={id} value={option.value} aria-label={option.label} />
                </span>
                <span className="font-medium">{option.label}</span>
                <span className="text-caption text-pretty text-muted-foreground">
                  {option.description}
                </span>
              </Label>
            );
          })}
        </RadioGroup>
      </div>

      {/* D-MI7 (WP 4.1) — the two-step family→model button grid is gone; one `HubModelPicker`
          serves every model choice in the Hub, so "Anthropic CLI · Sonnet" reads the same here as
          in the composer, the agent profile and Settings. */}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="hub-new-session-model">Model</Label>
        <HubModelPicker
          id="hub-new-session-model"
          models={models}
          loading={modelsLoading}
          unavailable={unavailableCredentials}
          value={selectedModel}
          onChange={setSelectedModel}
          dialogTitle="Choose this session's model"
        />
        {!modelsLoading && models.length === 0 ? (
          <Text variant="caption" tone="muted">
            No provider credential has a usable model roster. Add or fix one in Settings.
          </Text>
        ) : null}
      </div>

      {projects.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="hub-new-session-project">Project (optional)</Label>
          <Select value={projectId} onValueChange={setProjectId}>
            <SelectTrigger id="hub-new-session-project" aria-label="Project">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NO_PROJECT_VALUE}>No project</SelectItem>
              {projects.map((project) => (
                <SelectItem key={project.id} value={project.id}>
                  {project.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Text variant="caption" tone="muted">
            Groups this session in the rail and shares the project's instructions + pinned files.
          </Text>
        </div>
      ) : null}
    </div>
  );

  const cleanSessionNote = (
    <div className="flex items-start gap-2 rounded-md border border-border bg-muted/30 p-3">
      <Info aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <Text variant="caption" tone="muted">
        This model runs as a clean session — it answers on its own and never attaches MCP servers or
        skills.
      </Text>
    </div>
  );

  const mcpContent = isCleanSession ? (
    cleanSessionNote
  ) : (
    <div className="flex flex-col gap-4">
      <SegmentedField
        id="hub-new-tools-access"
        label="MCP tools"
        value={toolAccess}
        onChange={(value) => setToolAccess(value as "auto" | "scoped")}
        options={[
          { value: "auto", label: "Auto" },
          { value: "scoped", label: "Scoped" },
        ]}
        help={
          toolAccess === "auto"
            ? "Every reachable MCP server is available; the assistant searches for the right tools from your prompt (recommended)."
            : "Grant only the servers and tools you pick below — the assistant sees nothing else."
        }
      />
      {toolAccess === "scoped" ? (
        <ToolGrantPicker idPrefix="hub-new-session" value={toolScope} onChange={setToolScope} />
      ) : null}
      {mode === "mission" ? (
        <div className="flex items-start gap-2 rounded-md border border-border bg-muted/30 p-3">
          <Info aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <Text variant="caption" tone="muted">
            This scope applies to the mission's own coordinating session, not its agents. A
            crew-based mission's agents each get their tool access from their role's Access tab
            instead; a prompt-planned mission's agents get theirs from the plan you approve.
          </Text>
        </div>
      ) : null}
    </div>
  );

  const skillsContent = isCleanSession ? (
    cleanSessionNote
  ) : (
    <div className="flex flex-col gap-4">
      <SegmentedField
        id="hub-new-skills-access"
        label="Skills"
        value={skillAccess}
        onChange={(value) => setSkillAccess(value as "auto" | "pick")}
        options={[
          { value: "auto", label: "Auto" },
          { value: "pick", label: "Pick" },
        ]}
        help={
          skillAccess === "auto"
            ? "Your whole skill registry is available; the assistant loads the skills your prompt needs (recommended)."
            : "Attach only the skills you pick below."
        }
      />
      {skillAccess === "pick" ? (
        <SkillPicker idPrefix="hub-new-session" value={skillIds} onChange={setSkillIds} />
      ) : null}
    </div>
  );

  const agentsCrewsContent = isCleanSession ? (
    cleanSessionNote
  ) : (
    <div className="flex flex-col gap-4">
      <SegmentedField
        id="hub-new-roster-access"
        label="Agents & crews"
        value={rosterAccess}
        onChange={(value) => setRosterAccess(value as "auto" | "pick")}
        options={[
          { value: "auto", label: "Auto" },
          { value: "pick", label: "Pick" },
        ]}
        help={
          rosterAccess === "auto"
            ? "A mission's planner proposes a fresh team from your prompt (recommended)."
            : "Scope in specific saved agents & crews as a preferred pool for the planner."
        }
      />
      {rosterAccess === "pick" ? (
        <AgentCrewPicker idPrefix="hub-new-session" value={roster} onChange={setRoster} />
      ) : null}
      <div className="flex items-start gap-2 rounded-md border border-border bg-muted/30 p-3">
        <Info aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <Text variant="caption" tone="muted">
          Used when a mission is planned (Mission mode, or Auto when it proposes a mission). The
          planner prefers and faithfully reuses the agents/crews you pick — their saved prompt, tools,
          skills, and model — and may still expand the team. A plain chat answer doesn't use these.
        </Text>
      </div>
    </div>
  );

  const sections: WideDialogSection[] = [
    {
      id: "setup",
      label: "Setup",
      icon: <Sparkles aria-hidden className="size-4" />,
      content: setupContent,
    },
    {
      id: "tools",
      label: "MCP & tools",
      icon: <Server aria-hidden className="size-4" />,
      content: mcpContent,
    },
    {
      id: "skills",
      label: "Skills",
      icon: <BookOpen aria-hidden className="size-4" />,
      content: skillsContent,
    },
    {
      id: "agents-crews",
      label: "Agents & Crews",
      icon: <Users aria-hidden className="size-4" />,
      content: agentsCrewsContent,
    },
  ];

  return (
    <WideDialog
      open={open}
      onOpenChange={(next) => (creating ? undefined : onOpenChange(next))}
      title="New session"
      description="Pick a mode and model. Pre-configure MCP servers, tools, and skills — or leave them on Auto and the assistant discovers what it needs from your prompt."
      sections={sections}
      primaryLabel="Start session"
      onSubmit={() => void handleCreate()}
      busy={creating}
      submitDisabled={!modelId}
      footerStart={
        error ? (
          <span className="text-destructive" role="alert">
            {error}
          </span>
        ) : undefined
      }
    />
  );
}
