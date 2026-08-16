import type { RatingIssue, RatingIssueTargetKind } from "@mcp-token-footprint/shared";
import { getServerIssues, getSkillIssues } from "../../lib/api";
import { type Loadable, loadableData, useLoadable } from "../../lib/loadable";

/**
 * The one data source for a target's rating issues (auto-learning loop). Called at PAGE level (the
 * server detail view / skill inspector), NOT inside `IssuesPanel`, so the tab strip can badge the
 * open count before the Issues tab is ever opened — Radix `TabsContent` unmounts inactive tabs, so a
 * panel-owned fetch would leave the badge blank until the first visit. The panel receives the
 * resulting `state` + `reload` as props (which also keeps it trivially testable).
 */
export type RatingIssuesState = {
  state: Loadable<RatingIssue[]>;
  reload: () => void;
  /** Open-issue count for the tab badge — `undefined` until loaded (the strip shows no count). */
  openCount: number | undefined;
};

export function useRatingIssues(
  targetKind: RatingIssueTargetKind,
  targetId: string | null | undefined,
): RatingIssuesState {
  const { state, reload } = useLoadable<RatingIssue[]>(
    () =>
      targetKind === "skill"
        ? getSkillIssues(targetId as string)
        : getServerIssues(targetId as string),
    [targetKind, targetId],
    { enabled: targetId != null && targetId !== "" },
  );
  const issues = loadableData(state);
  return {
    state,
    reload,
    openCount: issues?.filter((issue) => issue.status === "open").length,
  };
}
