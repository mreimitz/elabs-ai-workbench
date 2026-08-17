import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { buildHubAgentAnalyzePrompt, type HubAgentRole } from "@mcp-token-footprint/shared";
import { Button, StatePanel, toast } from "@elabs-ai/components-ui";
import {
  BarChart3,
  Brain,
  Cpu,
  Gauge,
  KeyRound,
  ScrollText,
  Sparkles,
  User,
} from "lucide-react";
import { WideDialog, type WideDialogSection } from "../../../../components/dialogs";
import { getHubAgentRole, updateHubAgentRole } from "../../../../lib/api";
import { getErrorMessage } from "../../../../lib/errors";
import { useAssistant } from "../../../assistant/assistant-context";
import { RoleAvatar } from "../../agents/RoleAvatar";
import { AccessSection } from "./AccessSection";
import {
  type AgentFieldErrors,
  type AgentProfileFormValue,
  type AgentSectionId,
  FIELD_IDS,
  FIELD_SECTION,
  firstErrorField,
  formFromRole,
  isAgentSectionId,
  isDirty,
  patchFromForm,
  validate,
} from "./agent-profile-form";
import {
  BudgetsSection,
  InstructionsSection,
  ModelSection,
  ProfileSection,
  SkillsSection,
} from "./FormSections";
import { MemorySection } from "./MemorySection";
import { UsageSection } from "./UsageSection";
import { ScopedMemoryList } from "../../memory/ScopedMemoryList";
import { notifyError } from "../../../../lib/notify";

/**
 * Assistant Hub UX WP2.3 — the agent-profile modal (D-HUX6: entity settings as a `WideDialog
 * nav="rail"`, S17 tier 3). Eight sections — Profile · Instructions · Model · Access · Skills ·
 * Memory · Budgets · Usage — over one dirty-guarded draft with a consequence-stating primary label.
 *
 * ── How it fills the `agentProfileModal` slot (WP2.1 frame API) ──────────────────────────────────
 * `AgentsView` mounts `<WorkforceView agentProfileModal={<AgentProfileModal />} />`. `WorkforceView`
 * renders the slot ONLY while `useParams().agentId` resolves (the `/assistant/agents/agent/:agentId`
 * node route). This component is fully self-contained: it reads its own `agentId` (`useParams`) and
 * active section (`?settings=`, D-HUX6), loads the role, and on close navigates back to the bare
 * `/assistant/agents` list — preserving `?tab=`/`?scope=`, dropping the node path + `?settings=`.
 *
 * KNOWN OPEN ITEM (flagged, not fixed here — WP2.1's seam): bare-list ↔ node-route crosses a
 * different `<Route>` match, so React may remount the Directory behind the opening modal. If a walk
 * sees the grid flash, the fix is App.tsx's background-location technique (the same one `/settings`
 * uses) — not this component's job to change.
 *
 * ── "Ask the assistant" header action (assistant-operability WP 3.2, D-AO5) ────────────────────────
 * A `WideDialog headerActions` button (next to the title, not inside `DialogTitle` — see
 * `WideDialog.tsx`'s doc) that opens the dock PREFILLED with `buildHubAgentAnalyzePrompt(personaName)`
 * (never auto-sent — `openAssistant({ prompt })` only fills the composer). Rendered ONLY while
 * `assistant.authConfigured` — hidden entirely otherwise, the same gate `IssueAssistantMount` and
 * `SkillInspector`'s "Fix with assistant" use, so a disabled dock never grows a dead button. The dock
 * opens UNPINNED (the Hub's `agents` surface carries no entity pin, D-AO3) — the prompt itself names
 * the agent so it's unambiguous.
 *
 * ── Memory slot (WP2.7 · wired WP2.8) ───────────────────────────────────────────────────────────
 * The `memorySection?: ReactNode` prop is the documented override slot. As of the WP2.8 integration
 * the Memory section's DEFAULT is WP2.7's real `<ScopedMemoryList scope="agent" scopeId={agentId} />`
 * (built in `renderSection` below); the inner `MemorySection`'s WP1.5 read-only fallback is kept for a
 * null slot but is no longer reached from this modal.
 */

type SectionMeta = { id: AgentSectionId; label: string; icon: ReactNode };

const SECTION_META: SectionMeta[] = [
  { id: "profile", label: "Profile", icon: <User aria-hidden className="size-4" /> },
  { id: "instructions", label: "Instructions", icon: <ScrollText aria-hidden className="size-4" /> },
  { id: "model", label: "Model", icon: <Cpu aria-hidden className="size-4" /> },
  { id: "access", label: "Access", icon: <KeyRound aria-hidden className="size-4" /> },
  { id: "skills", label: "Skills", icon: <Sparkles aria-hidden className="size-4" /> },
  { id: "memory", label: "Memory", icon: <Brain aria-hidden className="size-4" /> },
  { id: "budgets", label: "Budgets", icon: <Gauge aria-hidden className="size-4" /> },
  { id: "usage", label: "Usage", icon: <BarChart3 aria-hidden className="size-4" /> },
];

type LoadState = "loading" | "ready" | "error";

export function AgentProfileModal({ memorySection }: { memorySection?: ReactNode } = {}) {
  const { agentId } = useParams<{ agentId?: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const assistant = useAssistant();

  const [role, setRole] = useState<HubAgentRole | null>(null);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [initial, setInitial] = useState<AgentProfileFormValue | null>(null);
  const [value, setValue] = useState<AgentProfileFormValue | null>(null);
  const [errors, setErrors] = useState<AgentFieldErrors>({});
  const [saving, setSaving] = useState(false);
  const [pendingFocus, setPendingFocus] = useState<{ field: keyof typeof FIELD_IDS } | null>(null);

  // Load the role by id (the modal always edits an existing role — quick-create makes it first).
  useEffect(() => {
    if (!agentId) return;
    let cancelled = false;
    setLoadState("loading");
    setLoadError(null);
    (async () => {
      try {
        const loaded = await getHubAgentRole(agentId);
        if (cancelled) return;
        const form = formFromRole(loaded);
        setRole(loaded);
        setInitial(form);
        setValue(form);
        setLoadState("ready");
      } catch (err) {
        if (!cancelled) {
          setLoadError(getErrorMessage(err));
          setLoadState("error");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [agentId]);

  const rawSettings = searchParams.get("settings");
  const activeSectionId: AgentSectionId = isAgentSectionId(rawSettings) ? rawSettings : "profile";

  const setActiveSection = useCallback(
    (id: string) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set("settings", id);
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  // Navigate back to the bare list — preserve tab/scope, drop the node path + ?settings=. This is a
  // PROGRAMMATIC close (bypasses the dirty guard): used after a successful save and by the guard's
  // confirmed-discard path (which routes through `handleOpenChange(false)`).
  const closeToList = useCallback(() => {
    const next = new URLSearchParams(searchParams);
    next.delete("settings");
    const query = next.toString();
    navigate(`/assistant/agents${query ? `?${query}` : ""}`);
  }, [navigate, searchParams]);

  const update = useCallback((patch: Partial<AgentProfileFormValue>) => {
    setValue((current) => (current ? { ...current, ...patch } : current));
  }, []);

  const dirty = value != null && initial != null && isDirty(value, initial);

  // Focus the first invalid field once its section is active (rail mode only mounts the active
  // section, so a cross-section error must switch the rail first — this effect completes the focus
  // after that switch commits).
  useEffect(() => {
    if (!pendingFocus) return;
    if (FIELD_SECTION[pendingFocus.field] !== activeSectionId) return;
    document.getElementById(FIELD_IDS[pendingFocus.field])?.focus();
    setPendingFocus(null);
  }, [pendingFocus, activeSectionId]);

  const handleSubmit = useCallback(async () => {
    if (!value || !agentId) return;
    const nextErrors = validate(value);
    setErrors(nextErrors);
    const first = firstErrorField(nextErrors);
    if (first) {
      const section = FIELD_SECTION[first];
      if (section !== activeSectionId) setActiveSection(section);
      setPendingFocus({ field: first });
      return;
    }
    setSaving(true);
    try {
      await updateHubAgentRole(agentId, patchFromForm(value));
      toast.success("Agent saved");
      closeToList();
    } catch (err) {
      notifyError("Couldn’t save the agent", { description: getErrorMessage(err) });
    } finally {
      setSaving(false);
    }
  }, [value, agentId, activeSectionId, setActiveSection, closeToList]);

  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (!next) closeToList();
    },
    [closeToList],
  );

  const personaName = value
    ? value.displayName.trim() || value.name.trim() || "Agent"
    : (role?.displayName ?? role?.name ?? "Agent");

  const sections: WideDialogSection[] = useMemo(() => {
    const notReady = loadState !== "ready" || value == null;
    return SECTION_META.map((meta) => ({
      id: meta.id,
      label: meta.label,
      icon: meta.icon,
      content: notReady ? (
        <SectionStatus state={loadState} error={loadError} />
      ) : (
        renderSection(meta.id, {
          agentId: agentId ?? "",
          value,
          errors,
          update,
          memorySection,
        })
      ),
    }));
    // `value`/`errors` change on every keystroke — content is rebuilt each render (cheap: only the
    // ACTIVE section's element is mounted by WideDialog's rail).
  }, [loadState, loadError, value, errors, agentId, update, memorySection]);

  return (
    <WideDialog
      open
      onOpenChange={handleOpenChange}
      nav="rail"
      title={
        <span className="flex min-w-0 items-center gap-2">
          <RoleAvatar
            id={agentId ?? "agent"}
            icon={value?.icon}
            model={value?.defaultModel}
            className="size-6 shrink-0"
          />
          <span className="min-w-0 truncate">{personaName}</span>
        </span>
      }
      headerActions={
        assistant.authConfigured ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() =>
              assistant.openAssistant({ prompt: buildHubAgentAnalyzePrompt(personaName) })
            }
          >
            <Sparkles aria-hidden />
            <span>Ask the assistant</span>
          </Button>
        ) : undefined
      }
      sections={sections}
      activeSectionId={activeSectionId}
      onActiveSectionChange={setActiveSection}
      primaryLabel="Save changes"
      onSubmit={() => void handleSubmit()}
      busy={saving}
      submitDisabled={!dirty}
      dirty={dirty}
      {...(dirty ? { footerStart: "Unsaved changes" } : {})}
    />
  );
}

function SectionStatus({ state, error }: { state: LoadState; error: string | null }) {
  if (state === "error") {
    return (
      <StatePanel
        kind="error"
        title="Couldn’t load this agent"
        description={error ?? "Close this dialog and try again."}
      />
    );
  }
  return <StatePanel kind="loading" title="Loading agent…" />;
}

function renderSection(
  id: AgentSectionId,
  ctx: {
    agentId: string;
    value: AgentProfileFormValue;
    errors: AgentFieldErrors;
    update: (patch: Partial<AgentProfileFormValue>) => void;
    memorySection?: ReactNode;
  },
): ReactNode {
  switch (id) {
    case "profile":
      return (
        <ProfileSection
          roleId={ctx.agentId}
          value={ctx.value}
          errors={ctx.errors}
          update={ctx.update}
        />
      );
    case "instructions":
      return <InstructionsSection value={ctx.value} errors={ctx.errors} update={ctx.update} />;
    case "model":
      return <ModelSection value={ctx.value} errors={ctx.errors} update={ctx.update} />;
    case "access":
      return (
        <AccessSection
          value={ctx.value.toolGrants}
          onChange={(next) => ctx.update({ toolGrants: next })}
        />
      );
    case "skills":
      return <SkillsSection value={ctx.value} update={ctx.update} />;
    case "memory":
      // WP2.8 — the DEFAULT is now WP2.7's real `ScopedMemoryList` (grouped, provenance, inline
      // edit/archive/delete), scoped to this agent; an externally-passed `memorySection` slot still
      // overrides it (tests, future callers). The inner `MemorySection`'s own read-only fallback
      // stays for a null slot but is no longer reached from this modal.
      return (
        <MemorySection
          agentId={ctx.agentId}
          slot={
            ctx.memorySection ??
            (ctx.agentId ? <ScopedMemoryList scope="agent" scopeId={ctx.agentId} /> : undefined)
          }
        />
      );
    case "budgets":
      return <BudgetsSection value={ctx.value} update={ctx.update} />;
    case "usage":
      return <UsageSection agentId={ctx.agentId} />;
    default:
      return null;
  }
}
