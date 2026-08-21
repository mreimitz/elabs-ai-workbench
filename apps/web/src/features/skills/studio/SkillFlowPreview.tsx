import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { SkillGraph } from "@mcp-token-footprint/shared";
import { Button, StatePanel, Text } from "@elabs-ai/components-ui";
import { PencilRuler } from "lucide-react";
import { getErrorMessage } from "../../../lib/errors";
import { getSkillGraph } from "../skills-inspector-api";
import { buildFlow, ExplainerLegend, SkillGraphCanvas } from "../design/SkillGraphCanvas";
import { skillStudioPath } from "./studio-url";

// ── Skill Studio (RM-30 WP 7.1) — the inspector's Design tab, now read-only ────────────────────────
// I2: editing lives in the Studio ONLY. The inspector keeps a Design tab because reading the flow is
// genuinely useful next to Quality/Files/Versions — but it is a PREVIEW: the canvas is mounted
// without `editable`, there is no palette, no node-detail editor, no draft, and therefore no save
// bar anywhere on the inspector. The one action is "Edit in Studio".

export type SkillFlowPreviewProps = {
  skillId: string;
  versionId: string;
  /** False when the inspector is showing an OLDER version — the Studio always authors the head, so
   *  the call to action says so instead of silently switching versions under the author. */
  isHeadVersion: boolean;
};

export function SkillFlowPreview({ skillId, versionId, isHeadVersion }: SkillFlowPreviewProps) {
  const [graph, setGraph] = useState<SkillGraph | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setGraph(null);
    setError(null);
    getSkillGraph(skillId, versionId)
      .then((response) => {
        if (!cancelled) setGraph(response.graph);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(getErrorMessage(err));
      });
    return () => {
      cancelled = true;
    };
  }, [skillId, versionId]);

  const flow = useMemo(
    () => (graph ? buildFlow(graph) : { nodes: [], edges: [], droppedEdges: 0 }),
    [graph],
  );

  // The read-only canvas still reports selection; nothing here consumes it (there is no detail
  // editor on this surface), so it is deliberately swallowed.
  const handleSelectNode = useCallback(() => {}, []);

  const studioHref = skillStudioPath(skillId);

  if (error !== null) {
    return (
      <StatePanel
        kind="error"
        title="Couldn’t project the flow — switch versions or refresh the page to try again."
        description={error}
      />
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-3" data-testid="skill-flow-preview">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Text variant="meta" tone="muted" className="min-w-0 text-pretty">
          {isHeadVersion
            ? "A read-only view of how this skill reads. Open the Studio to change it."
            : "A read-only view of an earlier version. The Studio always edits the latest version."}
        </Text>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <ExplainerLegend />
          <Button asChild size="sm">
            <Link to={studioHref}>
              <PencilRuler aria-hidden /> Edit in Studio
            </Link>
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden rounded-lg border border-border bg-card">
        {graph === null ? (
          <StatePanel kind="loading" title="Loading…" loadingLabel="Projecting the skill…" />
        ) : flow.nodes.length === 0 ? (
          <StatePanel
            kind="empty"
            title="Nothing to show yet"
            description="No sections were found in this version’s SKILL.md."
            actions={
              <Button asChild size="sm">
                <Link to={studioHref}>Edit in Studio</Link>
              </Button>
            }
          />
        ) : (
          <SkillGraphCanvas nodes={flow.nodes} edges={flow.edges} onSelectNode={handleSelectNode} />
        )}
      </div>
    </div>
  );
}
