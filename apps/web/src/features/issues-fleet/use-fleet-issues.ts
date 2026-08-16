import { listIssues } from "../../lib/api";
import { type Loadable, loadableData, useLoadable } from "../../lib/loadable";
import { type FleetIssue, isFleetIssue } from "./issue-lib";

/**
 * The one data source for the fleet Issues tab — fetched at DASHBOARD level (not inside the tab
 * body), mirroring `features/issues/use-rating-issues.ts`: the Dashboard's tab strip badges the
 * open+regressed count before the Issues tab is ever opened (Radix `TabsContent` unmounts inactive
 * tabs, so a tab-owned fetch would leave the badge blank until the first visit).
 *
 * `GET /api/issues` returns EVERY issue (plain per-run auto-rating issues AND fleet-clustered ones);
 * this hook narrows to the fleet subset (`isFleetIssue`) — the per-run ones stay `features/issues/
 * IssuesPanel`'s surface on the server/skill detail view, never duplicated here.
 */
export type FleetIssuesState = {
  state: Loadable<FleetIssue[]>;
  reload: () => void;
  /** Open + regressed count for the tab badge — `undefined` until loaded (the strip shows no count,
   *  same contract as `useRatingIssues.openCount`). */
  badgeCount: number | undefined;
};

export function useFleetIssues(): FleetIssuesState {
  const { state: rawState, reload } = useLoadable(() => listIssues(), []);
  const state: Loadable<FleetIssue[]> =
    rawState.status === "data"
      ? { status: "data", data: rawState.data.filter(isFleetIssue) }
      : rawState;
  const issues = loadableData(state);
  return {
    state,
    reload,
    badgeCount: issues?.filter(
      (issue) => issue.fleet.lifecycle === "open" || issue.fleet.lifecycle === "regressed",
    ).length,
  };
}
