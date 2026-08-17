import type { ReactNode } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  EmptyState,
  Heading,
} from "@elabs-ai/components-ui";
import { BarChart3, ChevronDown, GitFork, LayoutGrid, Plus } from "lucide-react";
import { PageShell } from "../../../components/PageShell";
import { TabPanel, TabPanelContent } from "../../../components/TabPanel";
import { ViewToolbar } from "../../../components/ViewToolbar";
import { OrgRail, type OrgRailScope, encodeOrgRailScope, parseOrgRailScope } from "./OrgRail";

/**
 * Assistant Hub UX WP2.1 (D-HUX5) — the workforce section frame: one `PageHeader` + a "+ New" split
 * button, the `Directory · Org chart · Usage` tab strip, and the shared org rail scoping whichever
 * tab is active. This is THE FRAME every later Wave-2 WP (2.2 Directory, 2.3 agent profile, 2.4 crew
 * profile, 2.5 Org chart, 2.6 Usage) builds against — see the slot-prop doc below and the URL scheme
 * doc above the two route-derived state blocks. Replaces the deleted Roles/Crews `TabPanel` (and its
 * `h-[46rem]` fixed frame) that used to live directly in `AgentsView.tsx`.
 *
 * ================================================================================================
 * THE FRAME API (read this before wiring WP2.2/2.3/2.4/2.5/2.6 in at Wave-2 integration)
 * ================================================================================================
 *
 * URL SCHEME (D-HUX5, execution-plan.md §1) — all state lives in the URL, nothing in local/lifted
 * React state that would vanish on reload or fail to deep-link:
 *   • Pathname (mounted by App.tsx — see its WP2.1 route block):
 *       - `/assistant/agents`                     — bare: Directory tab, no node selected.
 *       - `/assistant/agents/agent/:agentId`       — an agent's profile is open (D-HUX5's `{agent|
 *         crew}` token). `useParams().agentId` resolves ANYWHERE in this subtree (no prop threading
 *         needed) because App.tsx declares this as its OWN literal `<Route>`, not a shared splat.
 *       - `/assistant/agents/crew/:crewId`         — a crew's profile is open. Same mechanics,
 *         DELIBERATELY a different param name (`crewId`, not `id`) than the agent route — so a
 *         future `AgentProfileModal`/`CrewProfileModal` can each call `useParams()` directly and
 *         know unambiguously whether IT is the one that should be open, with no `matchPath`/
 *         `useLocation` needed on their end.
 *   • `?tab=directory|org|usage` — the active tab. `directory` is the default and is OMITTED from
 *     the URL (mirrors `DashboardView`'s `?tab=` convention: a default-tab link stays the clean
 *     canonical `/assistant/agents`); an unrecognized value falls back to the default.
 *   • `?scope=` — the org rail's selection: absent (default, "all agents") | `unassigned` |
 *     `archived` | `crew:<crewId>`. See `OrgRail.tsx`'s `encodeOrgRailScope`/`parseOrgRailScope` —
 *     WP2.2/WP2.5 read the SAME param via those exported pure functions (or `useSearchParams()
 *     .get("scope")` directly) to scope their own card grid / org-chart lanes; this file only owns
 *     WRITING it (via the rail's `onScopeChange`).
 *   • `?settings=<section>` — which sub-page of an OPEN profile modal is active (D-HUX6's 8 agent /
 *     6 crew sections, e.g. `?settings=access`). This file does not read or write it — it is plain
 *     `URLSearchParams` plumbing that coexists with `tab`/`scope` on a node URL (e.g.
 *     `/assistant/agents/agent/abc123?tab=directory&scope=crew:xyz&settings=access`); WP2.3/WP2.4's
 *     modal owns reading/writing/clearing it entirely. Nothing here needs to change for that to work.
 *
 * SLOTS (all optional `ReactNode`; `undefined` renders a lightweight WP2.1 placeholder or nothing —
 * mirrors `AssistantView`'s Wave-1 `metaRail`/`emptyIntro`/`chatCanvas` prop pattern):
 *   • `directoryTab` / `orgChartTab` / `usageTab` — mounted as the body of the matching
 *     `TabPanelContent` REGARDLESS of which tab is active (Radix keeps all three in the tree; only
 *     the active one is visible) — so each can read `?scope=`/`?tab=` itself via `useSearchParams()`
 *     once wired in; this file threads NOTHING into them as props.
 *   • `agentProfileModal` / `crewProfileModal` — mounted only while the matching node route is
 *     active (`agentId`/`crewId` resolved, see above). Render your own `Dialog`/`WideDialog` with
 *     `open` hard-coded `true` (or derived from its own `useParams()`/`useSearchParams()` read) —
 *     this file gates MOUNTING, the modal owns its own open/close and `?settings=` navigation.
 *   • `onNewAgent` / `onNewCrew` — the "+ New" split button's two menu items. `undefined` renders
 *     each item DISABLED (never a silent no-op — the exact bug class WP0.3 fixed elsewhere in this
 *     workstream) until WP2.2's quick-create (agent) / WP2.4's crew creation wire real handlers in.
 *   • `onOrgChanged` (ui-wave U5, owner feedback) — fired when the org RAIL mutates the org (its
 *     inline crew/agent create, a drag/menu crew reassignment). The rail refreshes itself; this lets
 *     the host also refresh sibling surfaces that fetch their own copy of roles+crews (AgentsView
 *     bumps DirectoryTab's `reloadKey`, the existing WP2.8 refresh signal). Optional — omitted, the
 *     rail still works, the grid just stays stale until its own next reload.
 *
 * KNOWN OPEN ITEM (flagged, not fixed here — no modal exists yet to observe against): navigating
 * from the bare list to a node route (and back) crosses a DIFFERENT `<Route>` match in App.tsx, so
 * React may remount this subtree rather than layer the modal over the same instance. If WP2.3/2.4's
 * visual walk sees the Directory grid flash/reset behind the opening modal, the fix is the SAME
 * technique `App.tsx` already uses for `/settings` (render the last non-modal location behind the
 * overlay via a location ref) — not a reason to change the URL scheme above.
 */

const WORKFORCE_TABS = ["directory", "org", "usage"] as const;
type WorkforceTab = (typeof WORKFORCE_TABS)[number];
const DEFAULT_TAB: WorkforceTab = "directory";

function isWorkforceTab(value: string | null): value is WorkforceTab {
  return value != null && (WORKFORCE_TABS as readonly string[]).includes(value);
}

export type WorkforceViewProps = {
  directoryTab?: ReactNode;
  orgChartTab?: ReactNode;
  usageTab?: ReactNode;
  agentProfileModal?: ReactNode;
  crewProfileModal?: ReactNode;
  onNewAgent?: () => void;
  onNewCrew?: () => void;
  onOrgChanged?: () => void;
};

export function WorkforceView({
  directoryTab,
  orgChartTab,
  usageTab,
  agentProfileModal,
  crewProfileModal,
  onNewAgent,
  onNewCrew,
  onOrgChanged,
}: WorkforceViewProps = {}) {
  const [searchParams, setSearchParams] = useSearchParams();
  // D-HUX5 node routes — see the class doc above for why these are distinct param NAMES (agentId vs
  // crewId), not a shared `id`: it lets a future profile-modal component disambiguate itself with a
  // bare `useParams()` read, no route-matching of its own required.
  const { agentId, crewId } = useParams<{ agentId?: string; crewId?: string }>();

  const rawTab = searchParams.get("tab");
  const tab: WorkforceTab = isWorkforceTab(rawTab) ? rawTab : DEFAULT_TAB;
  const setTab = (value: string) => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (value === DEFAULT_TAB) next.delete("tab");
        else next.set("tab", value);
        return next;
      },
      { replace: true },
    );
  };

  const scope = parseOrgRailScope(searchParams.get("scope"));
  const setScope = (next: OrgRailScope) => {
    setSearchParams(
      (prev) => {
        const nextParams = new URLSearchParams(prev);
        const encoded = encodeOrgRailScope(next);
        if (encoded == null) nextParams.delete("scope");
        else nextParams.set("scope", encoded);
        return nextParams;
      },
      { replace: true },
    );
  };

  // The rail scopes Directory + Org chart only — the concept's Usage-tab wireframe (§7.3 Tab 3) has
  // no rail column; that tab gets its own DateRangePicker/group-by toolbar (WP2.6) with the full
  // content width instead.
  const showRail = tab !== "usage";

  return (
    <PageShell
      width="full"
      scroll="fill"
      headerVariant="toolbar"
      header={
        <ViewToolbar
          info="The workforce: agent identities the planner draws from, and the saved crews built from them."
          actions={
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button type="button">
                  <Plus aria-hidden />
                  <span>New</span>
                  <ChevronDown aria-hidden className="size-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem disabled={!onNewAgent} onSelect={() => onNewAgent?.()}>
                  New agent
                </DropdownMenuItem>
                <DropdownMenuItem disabled={!onNewCrew} onSelect={() => onNewCrew?.()}>
                  New crew
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          }
        />
      }
    >
      <Heading level={1} className="sr-only">
        Agents & Crews
      </Heading>
      <div className="flex min-h-0 flex-1 gap-4">
        {/* The org rail is an INTERNAL sibling column (like the workspace's meta rail), not the
            AppShell-level `secondaryContent` Servers/Skills use — WP2.1's App.tsx surface is scoped
            to route lines only (see its own doc comment), so this view owns its full layout. */}
        {showRail ? (
          <OrgRail
            scope={scope}
            onScopeChange={setScope}
            onMutated={onOrgChanged}
            className="w-[288px] shrink-0 border-r border-border"
          />
        ) : null}

        <div className="min-w-0 flex-1">
          <TabPanel
            value={tab}
            onValueChange={setTab}
            tabs={[
              { value: "directory", label: "Directory" },
              { value: "org", label: "Org chart" },
              { value: "usage", label: "Usage" },
            ]}
          >
            <TabPanelContent value="directory" scroll={false}>
              {directoryTab ?? (
                <WorkforcePlaceholder
                  icon={<LayoutGrid aria-hidden />}
                  title="Directory"
                  description="The agent + crew card grid isn’t wired up yet."
                />
              )}
            </TabPanelContent>
            <TabPanelContent value="org" scroll={false}>
              {orgChartTab ?? (
                <WorkforcePlaceholder
                  icon={<GitFork aria-hidden />}
                  title="Org chart"
                  description="The crew organigram isn’t wired up yet."
                />
              )}
            </TabPanelContent>
            <TabPanelContent value="usage" scroll={false}>
              {usageTab ?? (
                <WorkforcePlaceholder
                  icon={<BarChart3 aria-hidden />}
                  title="Usage"
                  description="Spend and token analytics aren’t wired up yet."
                />
              )}
            </TabPanelContent>
          </TabPanel>
        </div>
      </div>

      {agentId ? (agentProfileModal ?? null) : null}
      {crewId ? (crewProfileModal ?? null) : null}
    </PageShell>
  );
}

function WorkforcePlaceholder(props: { icon: ReactNode; title: string; description: string }) {
  return (
    <div className="flex h-full items-center justify-center">
      <EmptyState icon={props.icon} title={props.title} description={props.description} />
    </div>
  );
}
