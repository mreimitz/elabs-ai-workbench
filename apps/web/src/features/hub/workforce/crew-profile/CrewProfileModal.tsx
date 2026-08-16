import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { buildHubCrewAnalyzePrompt, type HubAgentRole, type HubCrew } from "@mcp-token-footprint/shared";
import { Button, Dialog, DialogContent, DialogTitle, Spinner, StatePanel, cn, toast } from "@brand/ui";
import { BarChart3, Brain, Gauge, GitFork, Rocket, Sparkles, UserRound, Users } from "lucide-react";
import { WideDialog, type WideDialogSection } from "../../../../components/dialogs";
import { getErrorMessage } from "../../../../lib/errors";
import {
  createHubSession,
  getHubCrew,
  listHubAgentRoles,
  listHubCrews,
  updateHubCrew,
} from "../../../../lib/api";
import { loadableData, useLoadable } from "../../../../lib/loadable";
import { useAssistant } from "../../../assistant/assistant-context";
import { crewAccentClasses } from "../../lib/hub-ux";
import { HubModelPicker } from "../../HubModelPicker";
import { defaultHubModelOption } from "../../hub-model-picker";
import { hubModelWireFields, useHubModelRoster, type HubModelOption } from "../../use-hub-models";
import { ScopedMemoryList } from "../../memory/ScopedMemoryList";
import { CrewTopologyGraph, TOPOLOGY_LABEL } from "../org-chart";
import { BudgetsSection } from "./BudgetsSection";
import {
  crewProfileFormFromCrew,
  crewProfileFormToPatch,
  type CrewProfileFieldErrors,
  type CrewProfileFormValue,
  validateCrewProfileForm,
} from "./crew-profile-form";
import { MembersSection } from "./MembersSection";
import { MemorySection } from "./MemorySection";
import { ProfileSection } from "./ProfileSection";
import { TopologySection } from "./TopologySection";
import { UsageSection } from "./UsageSection";
import { notifyError } from "../../../../lib/notify";

const SECTION_IDS = ["profile", "members", "topology", "budgets", "memory", "usage"] as const;
type SectionId = (typeof SECTION_IDS)[number];

function isSectionId(value: string | null): value is SectionId {
  return value != null && (SECTION_IDS as readonly string[]).includes(value);
}

export type CrewProfileModalProps = {
  /** OVERRIDE slot for the Topology section. As of WP2.8 the DEFAULT is already WP2.5's D-HUX9
   *  `CrewTopologyGraph` (built internally from the live form); pass this only to substitute a
   *  different renderer (tests). See `TopologySection.tsx`'s class doc for the full contract. */
  topologyRenderer?: ReactNode;
  /** OVERRIDE slot for the Memory section. As of WP2.8 the DEFAULT is already WP2.7's
   *  `<ScopedMemoryList scope="crew" scopeId={crewId} />`; pass this only to substitute a different
   *  list (tests). See `MemorySection.tsx`'s class doc. */
  memorySection?: ReactNode;
};

/**
 * Assistant Hub UX WP2.4 (D-HUX6) — the crew profile: a `WideDialog nav="rail"` with six sections
 * (Profile · Members · Topology · Budgets · Memory · Usage), mounted by `WorkforceView`'s
 * `crewProfileModal` slot whenever `/assistant/agents/crew/:crewId` resolves (see `AgentsView.tsx`,
 * which wires this component in). Reads `crewId` itself via `useParams()` — WorkforceView only
 * MOUNTS this slot once the route matches, so a bare `useParams()` read here is safe (its own doc
 * comment sanctions exactly this pattern).
 *
 * ONE unified form (Profile/Members/Topology/Budgets share `CrewProfileFormValue`) with ONE dirty
 * check and ONE Save in the sticky footer — matches the concept's wireframe (a single Cancel/Save
 * pair, not a save-per-section) and `CrewEditor.tsx`'s existing save semantics (same validation, same
 * patch shape, PLUS `color`). Memory and Usage are read-only informational sections with no form
 * state. `?settings=<section>` (owned entirely by this component, per `WorkforceView`'s frame-API doc)
 * drives which section is active so a specific section is a shareable/reloadable URL.
 *
 * ── "Ask the assistant" header action (assistant-operability WP 3.2, D-AO5) ────────────────────────
 * A second `WideDialog headerActions` button, next to the existing "Instantiate" one — opens the dock
 * PREFILLED with `buildHubCrewAnalyzePrompt(form.name)` (never auto-sent). Rendered ONLY while
 * `assistant.authConfigured`, the same gate `AgentProfileModal`'s equivalent action and
 * `IssueAssistantMount` use. Unpinned (the Hub's `agents` surface carries no entity pin, D-AO3) — the
 * prompt names the crew so it's unambiguous.
 */
export function CrewProfileModal({ topologyRenderer, memorySection }: CrewProfileModalProps = {}) {
  const { crewId } = useParams<{ crewId?: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const modelRoster = useHubModelRoster();
  const assistant = useAssistant();

  const { state: crewState, reload: reloadCrew } = useLoadable<HubCrew>(
    () => getHubCrew(crewId as string),
    [crewId],
    { enabled: !!crewId },
  );
  const crew = loadableData(crewState);

  const { state: rolesState } = useLoadable<HubAgentRole[]>(
    () => listHubAgentRoles({ includeArchived: true }),
    [],
  );
  const roles = loadableData(rolesState) ?? [];
  const rolesLoading = rolesState.status === "loading";
  const roleById = useMemo(() => new Map(roles.map((role) => [role.id, role])), [roles]);

  // Crew nesting (WP4.1, D-CN4/D-CN8) — the whole saved-crew set, for `MembersSection`'s sub-crew
  // add path + its cycle/depth-filtered picker, and for the author-time nesting check on submit.
  const { state: crewsState } = useLoadable<HubCrew[]>(() => listHubCrews(), []);
  const crews = loadableData(crewsState) ?? [];
  const crewsLoading = crewsState.status === "loading";

  const [form, setForm] = useState<CrewProfileFormValue | null>(null);
  const [baseline, setBaseline] = useState<CrewProfileFormValue | null>(null);
  const [errors, setErrors] = useState<CrewProfileFieldErrors>({});
  const [saving, setSaving] = useState(false);
  const [instantiating, setInstantiating] = useState(false);
  /** D-MI7 (WP 4.1) — an explicit coordinating-model choice; `null` = the deterministic default. */
  const [pickedInstantiateModel, setPickedInstantiateModel] = useState<HubModelOption | null>(null);

  // Seed the form once the crew loads (a fresh fetch — `crewId` changing, or the error-state retry —
  // reseeds it; an in-place PATCH response never lands here since a successful save closes the modal).
  useEffect(() => {
    if (crew) {
      const initial = crewProfileFormFromCrew(crew);
      setForm(initial);
      setBaseline(initial);
      setErrors({});
    }
  }, [crew]);

  const dirty =
    form != null && baseline != null && JSON.stringify(form) !== JSON.stringify(baseline);

  const rawSection = searchParams.get("settings");
  const activeSectionId: SectionId = isSectionId(rawSection) ? rawSection : "profile";
  const setActiveSectionId = (id: string): void => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set("settings", id);
        return next;
      },
      { replace: true },
    );
  };

  /** Back to the bare Directory, preserving `tab`/`scope` (WorkforceView's own state) but dropping
   *  `settings` (this modal's own state — nothing to resume once it's closed). */
  const closeToList = (): void => {
    const next = new URLSearchParams(searchParams);
    next.delete("settings");
    const qs = next.toString();
    navigate(`/assistant/agents${qs ? `?${qs}` : ""}`);
  };

  const handleSubmit = async (): Promise<void> => {
    if (!form || !crewId) return;
    const nextErrors = validateCrewProfileForm(form, { crewId, crews });
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      setActiveSectionId(nextErrors.name ? "profile" : "members");
      return;
    }
    setSaving(true);
    try {
      await updateHubCrew(crewId, crewProfileFormToPatch(form));
      toast.success("Crew saved");
      closeToList(); // Direct navigate on success — bypasses the unsaved-changes guard, matches
      // EnvironmentEditor's own `onOpenChange(false)`-after-save convention.
    } catch (error) {
      notifyError("Couldn’t save the crew", { description: getErrorMessage(error) });
    } finally {
      setSaving(false);
    }
  };

  const canInstantiate = !!crew && crew.members.length > 0 && modelRoster.models.length > 0;

  // D-MI7 (WP 4.1) — the coordinating session's model is now an operator CHOICE, not a silent
  // `models[0]`. The seed is the deterministic first row (`defaultHubModelOption`), which — unlike
  // `models[0]` — does not move when an unrelated credential is edited (`ORDER BY updated_at DESC`).
  const instantiateModel = pickedInstantiateModel ?? defaultHubModelOption(modelRoster.models) ?? null;

  const handleInstantiate = async (): Promise<void> => {
    if (!crew || !instantiateModel) return;
    setInstantiating(true);
    try {
      // D-MI1 (WP 3.1) — the coordinating session carries the picked row's credential, not just its
      // bare model id (which the server would otherwise re-guess a provider for by NAME).
      const session = await createHubSession({
        mode: "mission",
        ...hubModelWireFields(instantiateModel),
        crewId: crew.id,
      });
      navigate(`/assistant?session=${session.id}`);
    } catch (error) {
      notifyError("Couldn’t start a session for this crew", { description: getErrorMessage(error) });
    } finally {
      setInstantiating(false);
    }
  };

  if (!crewId) return null;

  // Error is checked BEFORE the loading/not-yet-seeded fallback below — `form` stays null on a failed
  // fetch too (it's only ever seeded from a successfully loaded `crew`), so checking `!form` first
  // would make this branch unreachable.
  if (crewState.status === "error") {
    return (
      <Dialog open onOpenChange={(open) => (open ? undefined : closeToList())}>
        <DialogContent aria-describedby={undefined} className="sm:max-w-[min(640px,95vw)]">
          <DialogTitle className="sr-only">Crew profile</DialogTitle>
          <StatePanel
            kind="error"
            title="Couldn’t load this crew"
            description={crewState.error}
            actions={
              <>
                <Button type="button" variant="outline" onClick={closeToList}>
                  Close
                </Button>
                <Button type="button" onClick={reloadCrew}>
                  Retry
                </Button>
              </>
            }
          />
        </DialogContent>
      </Dialog>
    );
  }

  // Loading / not-yet-seeded renders a minimal Dialog — the full WideDialog needs a loaded form to
  // build its sections against, so it only mounts once `crew` (and the seeded `form`) are ready.
  // `!crew` is redundant behaviourally (a non-error, non-loading `crewState` is always `data`, so
  // `crew` is defined) but narrows `crew` to `HubCrew` for the live-topology renderer below.
  if (crewState.status === "loading" || !form || !crew) {
    return (
      <Dialog open onOpenChange={(open) => (open ? undefined : closeToList())}>
        <DialogContent aria-describedby={undefined} className="sm:max-w-[min(640px,95vw)]">
          <DialogTitle className="sr-only">Crew profile</DialogTitle>
          <StatePanel kind="loading" title="Loading crew…" />
        </DialogContent>
      </Dialog>
    );
  }

  const accent = crewAccentClasses(form.color);

  // WP2.8 cross-slots (both honour an externally-passed prop as an override):
  //  • Topology — the DEFAULT is now WP2.5's D-HUX9 `CrewTopologyGraph` (topology-true edges on the
  //    same `@brand/flow` canvas the Org chart draws), fed a crew synthesised from the LIVE form so
  //    the preview updates as the user edits topology/members (matching the old `TopologyGraph`
  //    default's live behaviour). Imported from `../org-chart` — no edge logic duplicated here.
  //  • Memory — the DEFAULT is now WP2.7's `ScopedMemoryList scope="crew"` (grouped, provenance,
  //    inline edit/archive/delete), replacing the WP2.4 read-only placeholder.
  const liveCrew: HubCrew = { ...crew, topology: form.topology, members: form.members };
  const memberCount = form.members.length;
  const resolvedTopologyRenderer: ReactNode =
    topologyRenderer ?? (
      <CrewTopologyGraph
        crew={liveCrew}
        roles={roles}
        ariaLabel={`${TOPOLOGY_LABEL[form.topology]} topology — ${memberCount} member${
          memberCount === 1 ? "" : "s"
        }`}
      />
    );
  const resolvedMemorySection: ReactNode = memorySection ?? (
    <ScopedMemoryList scope="crew" scopeId={crewId} />
  );

  const sections: WideDialogSection[] = [
    {
      id: "profile",
      label: "Profile",
      icon: <UserRound aria-hidden />,
      content: (
        <ProfileSection
          crewId={crewId ?? "crew"}
          name={form.name}
          description={form.description}
          color={form.color}
          icon={form.icon}
          onNameChange={(name) => setForm({ ...form, name })}
          onDescriptionChange={(description) => setForm({ ...form, description })}
          onColorChange={(color) => setForm({ ...form, color })}
          onIconChange={(icon) => setForm({ ...form, icon })}
          nameError={errors.name}
          disabled={saving}
        />
      ),
    },
    {
      id: "members",
      label: "Members",
      icon: <Users aria-hidden />,
      content: (
        <MembersSection
          members={form.members}
          roles={roles}
          rolesLoading={rolesLoading}
          crews={crews}
          crewsLoading={crewsLoading}
          crewId={crewId}
          onChange={(members) => setForm({ ...form, members })}
          error={errors.members}
          disabled={saving}
        />
      ),
    },
    {
      id: "topology",
      label: "Topology",
      icon: <GitFork aria-hidden />,
      content: (
        <TopologySection
          topology={form.topology}
          members={form.members}
          roleById={roleById}
          onTopologyChange={(topology) => setForm({ ...form, topology })}
          disabled={saving}
          topologyRenderer={resolvedTopologyRenderer}
        />
      ),
    },
    {
      id: "budgets",
      label: "Budgets",
      icon: <Gauge aria-hidden />,
      content: (
        <BudgetsSection
          members={form.members}
          roles={roles}
          onChange={(members) => setForm({ ...form, members })}
          disabled={saving}
        />
      ),
    },
    {
      id: "memory",
      label: "Memory",
      icon: <Brain aria-hidden />,
      content: <MemorySection crewId={crewId} memorySection={resolvedMemorySection} />,
    },
    {
      id: "usage",
      label: "Usage",
      icon: <BarChart3 aria-hidden />,
      content: <UsageSection crewId={crewId} />,
    },
  ];

  return (
    <WideDialog
      open
      onOpenChange={(open) => (open ? undefined : closeToList())}
      title={
        <div className="flex min-w-0 items-center justify-between gap-3 pe-1">
          <span className="flex min-w-0 items-center gap-2">
            <span aria-hidden className={cn("size-2.5 shrink-0 rounded-full", accent.dot)} />
            <span className="min-w-0 truncate">{form.name || "Untitled crew"}</span>
          </span>
          <span className="flex shrink-0 items-center gap-2">
            {/* D-MI7 (WP 4.1) — WHICH model (and therefore which credential) the crew's coordinating
                session runs on is now visible and changeable, instead of an invisible `models[0]`. */}
            {modelRoster.models.length > 0 ? (
              <HubModelPicker
                id="crew-profile-instantiate-model"
                name="Coordinating model"
                models={modelRoster.models}
                loading={modelRoster.loading}
                unavailable={modelRoster.unavailable}
                value={instantiateModel}
                disabled={instantiating}
                dialogTitle="Choose this crew's coordinating model"
                className="w-56"
                onChange={setPickedInstantiateModel}
              />
            ) : null}
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="shrink-0"
              disabled={!canInstantiate || instantiating}
              title={
                !canInstantiate
                  ? crew && crew.members.length === 0
                    ? "Add at least one member first"
                    : "No model available — add a provider credential in Settings"
                  : undefined
              }
              onClick={() => void handleInstantiate()}
            >
              {instantiating ? (
                <Spinner className="size-4" aria-hidden />
              ) : (
                <Rocket aria-hidden className="size-4" />
              )}
              <span>Instantiate</span>
            </Button>
          </span>
        </div>
      }
      headerActions={
        assistant.authConfigured ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() =>
              assistant.openAssistant({ prompt: buildHubCrewAnalyzePrompt(form.name) })
            }
          >
            <Sparkles aria-hidden />
            <span>Ask the assistant</span>
          </Button>
        ) : undefined
      }
      description="Start a mission session from this crew, exactly as configured here."
      sections={sections}
      nav="rail"
      activeSectionId={activeSectionId}
      onActiveSectionChange={setActiveSectionId}
      dirty={dirty}
      busy={saving}
      primaryLabel="Save crew"
      onSubmit={() => void handleSubmit()}
      footerStart={
        <span>
          {form.members.length} member{form.members.length === 1 ? "" : "s"}
        </span>
      }
    />
  );
}
