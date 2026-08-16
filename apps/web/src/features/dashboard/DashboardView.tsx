import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import type { ScanSummary, ServerConfig } from "@mcp-token-footprint/shared";
import { Heading, StatePanel } from "@brand/ui";
import { PageShell } from "../../components/PageShell";
import { TabPanel, TabPanelContent } from "../../components/TabPanel";
import { IssuesFleetTab } from "../issues-fleet/IssuesFleetTab";
import { useFleetIssues } from "../issues-fleet/use-fleet-issues";
import { ScansTab } from "./ScansTab";
import { TestingTab } from "./TestingTab";

/** localStorage key for the "since your last visit" reference timestamp (epoch ms). Owned here (the
 *  tab host), not by `ScansTab` — see `ScansTab.tsx`'s doc comment for why. */
const LAST_VISIT_KEY = "mcpfp:dashboard:last-visit-at";

/** The Dashboard's tabs (D-OB11: the Dashboard is the observability home). `scans` is the default —
 *  today's dashboard content, unchanged, for muscle memory. `testing` is the WP 2.2 metrics shell.
 *  `issues` is the WP 5.3 fleet-issues triage + detail (extends the v26 rating-issues registry). */
const DASHBOARD_TABS = ["scans", "testing", "issues"] as const;
type DashboardTab = (typeof DASHBOARD_TABS)[number];
const DEFAULT_TAB: DashboardTab = "scans";

function isDashboardTab(value: string | null): value is DashboardTab {
  return value != null && (DASHBOARD_TABS as readonly string[]).includes(value);
}

/**
 * DashboardView — the tab HOST (WP 2.1 restructure). Owns the shared loading gate + the
 * "since your last visit" reference (both must survive tab switches — see `ScansTab.tsx`), and
 * hosts three tabs on the shared `TabPanel` grammar: `Scans` (today's dashboard, moved verbatim into
 * `ScansTab.tsx` — no visual redesign), `Testing` (`TestingTab.tsx`, WP 2.2), and `Issues`
 * (`IssuesFleetTab.tsx`, WP 5.3 — the fleet-issues triage list + detail).
 *
 * DEEP-LINKING: the active tab lives in `?tab=` (e.g. `/dashboard?tab=testing`), read/written via
 * `useSearchParams` — the same idiom this app already uses for URL-restorable state elsewhere
 * (`CompareView`'s `?serverA=…`, `SkillInspector`'s `?file=…`, `RunConsoleRoute`). No existing view
 * wires a `TabPanel`'s *tab itself* to the URL yet (every other `TabPanel` consumer — `ScansView`,
 * `CompareView`, `ServersView`, `SuiteRunConsole` — keeps the active tab in local `useState`; see
 * `assistant-context.tsx`'s `deriveAssistantEnvelope` doc, which notes the app "doesn't yet encode a
 * tab in every route"), so this establishes the `?tab=` convention using the query-param option the
 * WP spec explicitly allows. The default tab ("scans") is kept OUT of the URL (`/dashboard` stays
 * the clean canonical link the sidebar nav already points at); only a non-default tab appends `?tab=`.
 * `{ replace: true }` (mirroring `SkillInspector`'s `setLiveFileParam`) so clicking between tabs
 * doesn't spam browser history — back/forward still leaves the page, not walks tab-by-tab.
 */
export function DashboardView(props: {
  /** True until the app's first data fetch settles — render loading, not the "no data" empty state. */
  initialLoading?: boolean;
  servers: ServerConfig[];
  scans: ScanSummary[];
  onOpenScan: (scanId: string) => void;
  onOpenServer: (serverId: string) => void;
  /** Run a scan for a server inline (wired from App.tsx). The attention list uses this for its Scan CTA (F1/D3). */
  onRunScan?: (serverId: string) => void;
}) {
  const [searchParams, setSearchParams] = useSearchParams();
  const rawTab = searchParams.get("tab");
  const tab: DashboardTab = isDashboardTab(rawTab) ? rawTab : DEFAULT_TAB;

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

  // "Since your last visit" reference: read ONCE at mount (before we re-stamp it below) so the
  // change window is stable for the whole time this view is open — including across Scans/Testing
  // tab switches, which unmount/remount `TabPanelContent` bodies but never this host. `null` = no
  // prior visit recorded.
  const [lastVisitAt] = useState<number | null>(() => readLastVisit());
  // After the first real data load settles, stamp "now" so the NEXT visit diffs against this one.
  useEffect(() => {
    if (props.initialLoading) return;
    try {
      window.localStorage.setItem(LAST_VISIT_KEY, String(Date.now()));
    } catch {
      // Storage can be unavailable (private mode / disabled) — the feature degrades to "first visit".
    }
  }, [props.initialLoading]);

  // Fleet issues (WP 5.3) — fetched at PAGE level (not inside the tab) so the tab strip can badge the
  // open+regressed count before the Issues tab is ever opened (mirrors `ServersView`'s
  // `useRatingIssues` page-level fetch; Radix `TabsContent`/`TabPanelContent` unmounts inactive tabs,
  // so a tab-owned fetch would leave the badge blank until the first visit).
  const { state: issuesState, reload: reloadIssues, badgeCount: issuesBadgeCount } = useFleetIssues();

  // Home root has no breadcrumb to name the page — keep an H1 for AT only (D-TB1). Lives in
  // TabPanel's pinned `header` slot (rule 1: identical for every tab) so it renders exactly once,
  // regardless of which tab is active.
  const srHeading = (
    <Heading level={1} className="sr-only">
      Dashboard
    </Heading>
  );

  if (props.initialLoading) {
    return (
      <PageShell width="centered">
        {srHeading}
        <StatePanel kind="loading" title="Loading dashboard…" loadingLabel="Loading…" />
      </PageShell>
    );
  }

  return (
    <PageShell width="centered" scroll="fill">
      <TabPanel
        value={tab}
        onValueChange={setTab}
        header={srHeading}
        tabs={[
          { value: "scans", label: "Scans" },
          { value: "testing", label: "Testing" },
          // Open+regressed count (D-OB11 dashboard integration) — undefined while loading, so the
          // strip shows no count until it's known (same contract as ServersView's Issues tab).
          {
            value: "issues",
            label: "Issues",
            count: issuesBadgeCount && issuesBadgeCount > 0 ? issuesBadgeCount : undefined,
          },
        ]}
      >
        <TabPanelContent value="scans">
          <ScansTab
            servers={props.servers}
            scans={props.scans}
            onOpenScan={props.onOpenScan}
            onOpenServer={props.onOpenServer}
            onRunScan={props.onRunScan}
            lastVisitAt={lastVisitAt}
          />
        </TabPanelContent>
        <TabPanelContent value="testing" scroll={false} bodyClassName="flex min-h-0 flex-col">
          <TestingTab />
        </TabPanelContent>
        {/* WP 5.3 — Issues tab (fleet issues registry, extends the v26 rating-issues registry).
            Owner-directed redesign: a full-width table (no more `SplitPane` owning its own scroll),
            so this now takes the DEFAULT `scroll` (the tab body itself is the one scroll container —
            the SAME contract the "scans" tab above already uses for its own plain `DataTable`s). */}
        <TabPanelContent value="issues">
          <IssuesFleetTab issuesState={issuesState} reloadIssues={reloadIssues} />
        </TabPanelContent>
      </TabPanel>
    </PageShell>
  );
}

/** Read the stored last-visit epoch-ms (safe against unavailable/garbage storage). */
function readLastVisit(): number | null {
  try {
    const raw = window.localStorage.getItem(LAST_VISIT_KEY);
    if (!raw) return null;
    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
