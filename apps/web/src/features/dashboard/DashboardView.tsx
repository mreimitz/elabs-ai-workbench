import { useEffect, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import type { ScanSummary, ServerConfig } from "@mcp-token-footprint/shared";
import { Heading, StatePanel } from "@elabs-ai/components-ui";
import { PageShell } from "../../components/PageShell";
import { TabPanel, TabPanelContent } from "../../components/TabPanel";
import { ViewToolbar } from "../../components/ViewToolbar";
import { IssuesFleetTab } from "../issues-fleet/IssuesFleetTab";
import { useFleetIssues } from "../issues-fleet/use-fleet-issues";
import { DashboardRangeControl } from "./DashboardRangeControl";
import {
  type DashboardRangeSelection,
  parseDashboardRange,
  resolveDashboardRange,
  sameDashboardRange,
  serializeDashboardRange,
  writeDashboardRange,
} from "./dashboard-range";
import { OverviewTab } from "./overview/OverviewTab";
import { TestingTab } from "./TestingTab";

/**
 * The Dashboard's tabs (D-OB11: the Dashboard is the observability home).
 *
 * **Three, as of dashboard-bento WP 2.2.** `scans` is gone — the owner asked for it (2026-08-20:
 * *"Overview and scans can be merged from my perspective"*), and everything it carried now lives on
 * the Overview bento: the fleet inventory and largest-tool figures as WP 2.1's `InventoryTile` /
 * `LargestToolTile`, and the two tables full-width at the bottom as `FootprintTableTile` /
 * `RecentScansTile`. `?tab=scans` is not a dead end — see {@link RETIRED_TABS}.
 */
const DASHBOARD_TABS = ["overview", "testing", "issues"] as const;
type DashboardTab = (typeof DASHBOARD_TABS)[number];
const DEFAULT_TAB: DashboardTab = "overview";

/**
 * Tabs that no longer exist, and where a link to one now lands. `?tab=scans` was a real,
 * shareable URL — the Dashboard's default until WP 1.4 — so it gets the same courtesy the app gives
 * its other moved routes (`App.tsx`'s `<Navigate>` redirects): it resolves, silently, to the tab
 * that absorbed it, and the stale param is dropped from the URL so a reload is clean.
 */
const RETIRED_TABS = new Map<string, DashboardTab>([["scans", "overview"]]);

/** Where a `?tab=` value resolves, or `undefined` if it names nothing. A `Map`, not an object
 *  literal, so a hand-typed `?tab=toString` reads as "unknown" instead of resolving to
 *  `Object.prototype.toString` off the prototype chain and handing `TabPanel` a function. */
function resolveRetiredTab(raw: string | null): DashboardTab | undefined {
  return raw === null ? undefined : RETIRED_TABS.get(raw);
}

function isDashboardTab(value: string | null): value is DashboardTab {
  return value != null && (DASHBOARD_TABS as readonly string[]).includes(value);
}

/**
 * DashboardView — the tab HOST, and (since dashboard-bento WP 2.2) the owner of the page's ONE
 * toolbar row.
 * =============================================================================================
 *
 * ── THE TOOLBAR ORDER, PUT BACK THE RIGHT WAY UP (WP 2.2, Defect 1) ──────────────────────────────
 * The app's written layout order is **breadcrumb → ONE `ViewToolbar` row → content**
 * (`planning/Roadmap/RM-30-ux-overhaul/toolbar-standard-2026-07-11.md`, D-TB1/D-TB2), and every other view follows
 * it — `SkillInspector.tsx:538` is the built reference, with its toolbar ABOVE the tab strip. The
 * Dashboard did the opposite: the tab strip sat at page level and each tab pinned its OWN `bg-card`
 * toolbar band *inside* itself (the Overview's window control, the Testing tab's `FilterControls`,
 * the Issues tab's filter row). That inversion is what the owner reported on 2026-08-20.
 *
 * So the page now mounts one `ViewToolbar` in `PageShell`'s `headerVariant="toolbar"` slot, above
 * the strip, and the per-tab bands are gone. What is left inside a tab is its own **facet** row —
 * Testing's provider/server/environment/suite/model/group-by, Issues' lifecycle/entity/search —
 * rendered frame-light (no `bg-card`, no border, no gutter bleed) so it reads as part of that tab's
 * content, not as a second chrome band competing with the page toolbar.
 *
 * ── ONE TIMELINE, THREE TABS (WP 2.2, Defect 2) ──────────────────────────────────────────────────
 * > *"If we introduce a new toolbar with filter on timeline this need to work for Testing and issues
 * > as well."*
 *
 * That page toolbar owns the **time range**, and all three tabs read the same resolved window. The
 * whole contract — one `?range=` param, a preset that stays relative, a custom range that stays
 * pinned, and read-compatibility with the two schemes it replaces (`?oRange=`, `?tFrom=`/`?tTo=`) —
 * lives in `dashboard-range.ts`; this component is simply the one place that calls
 * `useSearchParams()` for it and passes the result down.
 *
 * ── DEEP-LINKING ─────────────────────────────────────────────────────────────────────────────────
 * The active tab lives in `?tab=` (e.g. `/dashboard?tab=testing`), read/written via
 * `useSearchParams` — the idiom this app already uses for URL-restorable state (`CompareView`'s
 * `?serverA=…`, `SkillInspector`'s `?file=…`). The DEFAULT tab is kept OUT of the URL, so
 * `/dashboard` stays the clean canonical link the sidebar nav points at; only a non-default tab
 * appends `?tab=`. Every `?tab=testing|issues` deep link — and the `/dashboard?tab=issues&issue=…`
 * links the attention queue, the notification centre and the digest report emit — keeps resolving
 * unchanged; `?tab=scans` redirects to Overview (see {@link RETIRED_TABS}). `{ replace: true }`
 * throughout (mirroring `SkillInspector`'s `setLiveFileParam`) so clicking between tabs or windows
 * doesn't spam browser history — back/forward still leaves the page rather than walking tab-by-tab.
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
  const tab: DashboardTab = isDashboardTab(rawTab)
    ? rawTab
    : (resolveRetiredTab(rawTab) ?? DEFAULT_TAB);

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

  // A link to a retired tab still lands somewhere real (above); drop the stale param so a reload,
  // a bookmark or a copied URL is clean. Effect rather than render-time, because navigating during
  // render is a React anti-pattern — and `{ replace: true }` so it never adds a history entry.
  const retiredTab = !isDashboardTab(rawTab) && resolveRetiredTab(rawTab) !== undefined;
  useEffect(() => {
    if (!retiredTab) return;
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete("tab");
        return next;
      },
      { replace: true },
    );
    // Deliberately keyed on the boolean alone: `setSearchParams` identity churns per render.
  }, [retiredTab]);

  // ── The page range (WP 2.2) ────────────────────────────────────────────────────────────────────
  // Memoised on the SERIALIZED selection, not the params object: `resolveDashboardRange` reads the
  // clock for a preset, so recomputing per render would hand every tab a new `from`/`to` on each
  // pass and re-fire their fetches forever.
  const selection = parseDashboardRange(searchParams);
  const selectionKey = serializeDashboardRange(selection);
  // Keyed on `selectionKey` (a string), not on `selection` (a fresh object every render).
  const range = useMemo(() => resolveDashboardRange(selection), [selectionKey]);

  const setRange = (next: DashboardRangeSelection) => {
    if (sameDashboardRange(next, selection)) return;
    setSearchParams((prev) => writeDashboardRange(prev, next), { replace: true });
  };

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
    <PageShell
      width="centered"
      scroll="fill"
      headerVariant="toolbar"
      header={
        // Toolbar standard (2026-07-11): ONE ViewToolbar row, ABOVE the tab strip. `/dashboard` is
        // the home root and keeps no breadcrumb, so the row carries no identity — only the control
        // that scopes every tab under it, and a plain statement of what that control currently means.
        <ViewToolbar
          info="One window for the whole Dashboard: the Overview bento, the Testing metrics and the Issues list are all scoped to the range you pick here. A preset (24h / 7 days / 30 days) always means the trailing window as of now; a range picked on the calendar stays pinned to those exact days."
          left={<DashboardRangeControl range={range} onChange={setRange} />}
          results={<span>Showing {range.description}</span>}
        />
      }
    >
      <TabPanel
        value={tab}
        onValueChange={setTab}
        header={srHeading}
        tabs={[
          { value: "overview", label: "Overview" },
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
        {/* `scroll={false}` because each tab owns its own scroll region: the bento scrolls inside a
            `ScrollArea`, and the Testing tab pins its facet row above a scrolling panel column. */}
        <TabPanelContent value="overview" scroll={false} bodyClassName="flex min-h-0 flex-col">
          <OverviewTab
            range={range}
            servers={props.servers}
            scans={props.scans}
            onOpenScan={props.onOpenScan}
            onOpenServer={props.onOpenServer}
            onRunScan={props.onRunScan}
          />
        </TabPanelContent>
        <TabPanelContent value="testing" scroll={false} bodyClassName="flex min-h-0 flex-col">
          <TestingTab range={range} />
        </TabPanelContent>
        {/* WP 5.3 — Issues tab (fleet issues registry, extends the v26 rating-issues registry).
            Owner-directed redesign: a full-width table (no more `SplitPane` owning its own scroll),
            so this now takes the DEFAULT `scroll` (the tab body itself is the one scroll container). */}
        <TabPanelContent value="issues">
          <IssuesFleetTab
            range={range}
            issuesState={issuesState}
            reloadIssues={reloadIssues}
          />
        </TabPanelContent>
      </TabPanel>
    </PageShell>
  );
}
