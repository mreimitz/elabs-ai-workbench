import type { RunStep } from "@mcp-token-footprint/shared";

/**
 * Observability (WP 3.2) — a pure step-TREE builder over WP3.1's `parentStepId`/`spanKind` links
 * (`RunStep.parentStepId`/`spanKind`, additive/optional; a pre-WP3.1 step carries neither). Shared by
 * `StepLog` (the collapsible tree) and `RunGantt` (nested swimlanes) so both views agree on exactly
 * the same parent/child edges and the same default-collapse rule — no drift between the two
 * representations of the same run.
 *
 * Today's ONLY emitted subtrees (see `apps/api/src/testing/{run-service,grading/grade-service}.ts`,
 * read-only reference — this WP never touches `apps/api`) are:
 *   - a `tool_call` step owning a `tool_io` child (the MCP request/response detail);
 *   - a `rating` step (the post-run review span) owning `judge_call` children (one per LLM judge).
 * `turn`/`probe` are reserved `SpanKind`s with no emitter yet (WP3.1 STATUS: probe emitter deferred);
 * the tree builder handles them generically so nothing here needs to change when they land.
 */

export type StepTreeNode = {
  step: RunStep;
  /** Root = 0. */
  depth: number;
  children: StepTreeNode[];
};

/** True iff any step carries a `parentStepId` — i.e. this run has real tree structure to render. A
 *  flat (pre-WP3.1, or hierarchy-free) run carries none, so callers should render EXACTLY as before. */
export function hasStepHierarchy(steps: RunStep[]): boolean {
  return steps.some((step) => step.parentStepId != null);
}

/** The `toolCallId` a step's redacted payload carries (engine + MCP-sink `tool_call` steps both do,
 *  per F5) — the SAME correlation key `dedupe-tool-steps.ts` uses. */
function toolCallIdOf(step: RunStep | undefined): string | undefined {
  const payload = step?.payload;
  if (payload && typeof payload === "object" && "toolCallId" in payload) {
    const id = (payload as { toolCallId: unknown }).toolCallId;
    return typeof id === "string" ? id : undefined;
  }
  return undefined;
}

/**
 * Resolve a child's `parentStepId` against the DISPLAYED step ids. When the literal parent survives
 * display-side de-duping (the common case — e.g. `rating` → `judge_call`), it resolves directly. When
 * it doesn't (a `tool_io` child's `parentStepId` is the MCP-sink `tool_call` step's id, which
 * `dedupeToolSteps` — a WEB-DISPLAY-ONLY transform, `./dedupe-tool-steps.ts` — folds into the
 * surviving ENGINE `tool_call` row so the log shows one row per logical call), re-target it onto the
 * surviving engine row via the SAME `toolCallId` both sides carry. A step with neither a literal nor a
 * resolvable parent has no parent at all — it renders as a root; this never throws, never guesses.
 */
function resolveParentId(
  parentStepId: string,
  displayedIds: ReadonlySet<string>,
  rawSteps: RunStep[],
): string | undefined {
  if (displayedIds.has(parentStepId)) return parentStepId;
  const droppedParent = rawSteps.find((step) => step.id === parentStepId);
  const callId = toolCallIdOf(droppedParent);
  if (!callId) return undefined;
  const engineMatch = rawSteps.find(
    (step) => step.type === "tool_call" && displayedIds.has(step.id) && toolCallIdOf(step) === callId,
  );
  return engineMatch?.id;
}

/**
 * Build the step tree over the DISPLAYED steps (e.g. post `dedupeToolSteps`), reparenting any child
 * whose literal parent was folded away by that same de-dup (see {@link resolveParentId}). `rawSteps`
 * is the pre-de-dup list (needed only for that reparenting lookup — pass the same array unchanged when
 * the caller applies no de-dup). Preserves the flat, monotonic `index` order at every level: the tree
 * is a RENDERING of `parentStepId` links, never a reordering (WP3.1's own invariant).
 */
export function buildStepTree(displayedSteps: RunStep[], rawSteps: RunStep[]): StepTreeNode[] {
  const displayedIds = new Set(displayedSteps.map((step) => step.id));
  const nodeById = new Map<string, StepTreeNode>();
  for (const step of displayedSteps) nodeById.set(step.id, { step, depth: 0, children: [] });

  const roots: StepTreeNode[] = [];
  for (const step of displayedSteps) {
    // Every displayed step was just inserted above, so this lookup always succeeds.
    const node = nodeById.get(step.id)!;
    const parentId = step.parentStepId
      ? resolveParentId(step.parentStepId, displayedIds, rawSteps)
      : undefined;
    const parent = parentId ? nodeById.get(parentId) : undefined;
    if (parent) {
      node.depth = parent.depth + 1;
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  }
  return roots;
}

/**
 * Default-collapsed parent ids. A parent starts collapsed when it IS a `rating` span (hides its
 * `judge_call` children — the judge-call detail is reachable via Inspect, not the default view) OR
 * OWNS a `tool_io` child (a `tool_call` row hides its MCP-roundtrip detail by default, matching the
 * existing packet-inspector-on-demand pattern). Every other parent (a future `turn`/`probe` grouping)
 * starts EXPANDED.
 */
export function defaultCollapsedStepIds(nodes: StepTreeNode[]): Set<string> {
  const collapsed = new Set<string>();
  const visit = (node: StepTreeNode): void => {
    if (node.children.length > 0) {
      const collapseByDefault =
        node.step.spanKind === "rating" ||
        node.children.some((child) => child.step.spanKind === "tool_io");
      if (collapseByDefault) collapsed.add(node.step.id);
    }
    for (const child of node.children) visit(child);
  };
  for (const root of nodes) visit(root);
  return collapsed;
}

/** Every node id that owns at least one child (i.e. every "expandable" id in the tree). */
export function expandableStepIds(nodes: StepTreeNode[]): string[] {
  const ids: string[] = [];
  const visit = (node: StepTreeNode): void => {
    if (node.children.length > 0) ids.push(node.step.id);
    for (const child of node.children) visit(child);
  };
  for (const root of nodes) visit(root);
  return ids;
}

/** Flatten the tree into a `parentId -> childIds[]` map (drives `rollupSubtreeEconomics`). */
export function childrenByParentId(nodes: StepTreeNode[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  const visit = (node: StepTreeNode): void => {
    if (node.children.length > 0) {
      map.set(
        node.step.id,
        node.children.map((child) => child.step.id),
      );
    }
    for (const child of node.children) visit(child);
  };
  for (const root of nodes) visit(root);
  return map;
}
