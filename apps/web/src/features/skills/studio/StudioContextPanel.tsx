import type { SkillGraph } from "@mcp-token-footprint/shared";
import { Badge, Descriptions, DescriptionsItem, ScrollArea, Text } from "@elabs-ai/components-ui";
import { NODE_KIND_META } from "../design/node-kind-meta";

// ── Skill Studio (RM-30 WP 7.1) — the right context panel ─────────────────────────────────────────
// Collapsed by default, and never a reserved blank column: it opens onto the CURRENT selection —
// the node the `?sel=` param names — which is also what makes that param visibly meaningful rather
// than a value that only round-trips in the address bar.
//
// Later work packages fill the same frame: WP 7.6 docks the trace Evidence list + legend here.

export type StudioContextPanelProps = {
  /** The live projection of the document (`null` while the editor is still loading it). */
  graph: SkillGraph | null;
  /** The selected graph node — the Studio's `?sel=` param. */
  selectedNodeId: string | null;
};

export function StudioContextPanel({ graph, selectedNodeId }: StudioContextPanelProps) {
  const node = selectedNodeId ? graph?.nodes.find((n) => n.id === selectedNodeId) : undefined;

  if (!node) {
    return (
      <ScrollArea className="min-h-0 flex-1">
        <div className="p-3">
          <Text variant="meta" tone="muted" className="text-pretty">
            {selectedNodeId
              ? "The selected part is no longer in this document — pick another node on the canvas."
              : "Select a node on the canvas, or put the cursor inside a section in code, to see what it is."}
          </Text>
        </div>
      </ScrollArea>
    );
  }

  const meta = NODE_KIND_META[node.kind];
  const { startLine, endLine } = node.anchor;

  return (
    <ScrollArea className="min-h-0 flex-1">
      <div className="flex flex-col gap-3 p-3" data-testid="studio-context-node">
        <div className="flex flex-col gap-1">
          <Text className="text-pretty font-medium">{node.label}</Text>
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge variant="secondary">{meta.label}</Badge>
            <Badge variant="outline">
              {node.source === "annotated" ? "Annotated" : "Inferred"}
            </Badge>
          </div>
        </div>

        <Descriptions layout="vertical">
          <DescriptionsItem label="Lines" numeric>
            {startLine === endLine ? startLine : `${startLine}–${endLine}`}
          </DescriptionsItem>
          <DescriptionsItem label="Heading path">
            <span className="break-words">
              {node.anchor.headingPath.length > 0 ? node.anchor.headingPath.join(" › ") : "—"}
            </span>
          </DescriptionsItem>
        </Descriptions>
      </div>
    </ScrollArea>
  );
}
