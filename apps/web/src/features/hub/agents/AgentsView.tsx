import { useCallback, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { AgentProfileModal } from "../workforce/agent-profile/AgentProfileModal";
import { CrewProfileModal } from "../workforce/crew-profile/CrewProfileModal";
import { DirectoryTab } from "../workforce/DirectoryTab";
import { OrgChartTab } from "../workforce/org-chart";
import { QuickCreateAgentDialog, QuickCreateCrewDialog } from "../workforce/QuickCreate";
import { UsageTab } from "../workforce/usage/UsageTab";
import { WorkforceView } from "../workforce/WorkforceView";

/**
 * Assistant Hub UX WP2.1 (D-HUX5) — `AgentsView` is the THIN SHELL over the workforce frame, now
 * fully wired at the WP2.8 integration pass. The old Roles/Crews `TabPanel` (and its `h-[46rem]`
 * fixed frame — Wave-1 review D-HUX1 finding) was deleted outright; the whole workforce section
 * (PageHeader, the New agent/crew split button, the Directory · Org chart · Usage tabs, and the org
 * rail) lives in `../workforce/WorkforceView.tsx`, which App.tsx mounts at `/assistant/agents` (bare)
 * + the two node routes (`/assistant/agents/agent/:agentId`, `/assistant/agents/crew/:crewId`,
 * D-HUX5's URL scheme).
 *
 * WP2.8 integration wiring (see `WorkforceView.tsx`'s frame-API doc for the slot contract):
 *   • Tab slots — `directoryTab`/`orgChartTab`/`usageTab` mount the three self-contained tab bodies
 *     (each reads `?tab=`/`?scope=` itself; nothing is threaded in as props).
 *   • Profile modals — `agentProfileModal`/`crewProfileModal` mount only while their node route
 *     resolves; each reads its own `agentId`/`crewId` via `useParams()` and provides the WP2.7
 *     Memory / WP2.5 Topology cross-slots internally (see each modal).
 *   • `+ New` quick-create — `onNewAgent`/`onNewCrew` open the ≤6-field `FormDialog`s (D-HUX6);
 *     "Create, then open profile" (D-HUX5) navigates to the new node's profile and bumps
 *     `directoryReloadKey` so the (never-remounted — see the node-route note below) Directory grid
 *     picks the new entity up when the user returns. The disabled-when-`undefined` split-button
 *     contract is now enabled-and-functional (never a silent no-op).
 *
 * NODE-ROUTE REMOUNT (WP2.1's flagged KNOWN OPEN ITEM — resolved here): the three sibling routes all
 * render THIS same `<AgentsView />` element type at the same position in `App.tsx`'s flat `<Routes>`,
 * so react-router reconciles them as one fiber — navigating bare ↔ node re-renders (new `useParams`)
 * but never REMOUNTS the subtree. The Directory grid stays mounted behind the opening profile modal
 * (no flash/reset), so App.tsx needs NO background-location technique. Locked by a regression test in
 * `AgentsView.test.tsx`. Because it never remounts, the Directory would otherwise miss a just-created
 * entity — hence the `directoryReloadKey` bump above.
 */
export function AgentsView() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [quickCreate, setQuickCreate] = useState<"agent" | "crew" | null>(null);
  // Bumped whenever the org changes OUTSIDE the always-mounted Directory grid (it never remounts on
  // the node-route hop — see the class doc): a PageHeader quick-create, and — ui-wave U5 (owner
  // feedback) — the org rail's own mutations (inline create, drag/menu crew reassignment) via
  // WorkforceView's `onOrgChanged`. The Directory toolbar no longer duplicates a "+ New" entry
  // point (U5 toolbar cleanup) — the PageHeader menu is THE create surface up here.
  const [directoryReloadKey, setDirectoryReloadKey] = useState(0);

  // Open the new node's profile, preserving `tab`/`scope` and dropping any stale `?settings=` — the
  // exact D-HUX5 navigation `DirectoryTab.openProfile` uses, so both create paths land identically.
  const openProfile = useCallback(
    (kind: "agent" | "crew", id: string) => {
      const params = new URLSearchParams(searchParams);
      params.delete("settings");
      const qs = params.toString();
      navigate(`/assistant/agents/${kind}/${id}${qs ? `?${qs}` : ""}`);
    },
    [navigate, searchParams],
  );

  return (
    <>
      <WorkforceView
        directoryTab={<DirectoryTab reloadKey={directoryReloadKey} />}
        orgChartTab={<OrgChartTab />}
        usageTab={<UsageTab />}
        agentProfileModal={<AgentProfileModal />}
        crewProfileModal={<CrewProfileModal />}
        onNewAgent={() => setQuickCreate("agent")}
        onNewCrew={() => setQuickCreate("crew")}
        onOrgChanged={() => setDirectoryReloadKey((key) => key + 1)}
      />

      <QuickCreateAgentDialog
        open={quickCreate === "agent"}
        onOpenChange={(open) => setQuickCreate(open ? "agent" : null)}
        onCreated={(roleId) => {
          setDirectoryReloadKey((key) => key + 1);
          openProfile("agent", roleId);
        }}
      />
      <QuickCreateCrewDialog
        open={quickCreate === "crew"}
        onOpenChange={(open) => setQuickCreate(open ? "crew" : null)}
        onCreated={(crewId) => {
          setDirectoryReloadKey((key) => key + 1);
          openProfile("crew", crewId);
        }}
      />
    </>
  );
}
