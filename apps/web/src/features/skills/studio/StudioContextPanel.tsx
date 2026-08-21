// ── Skill Studio (RM-30 WP 7.1) — the right context panel ─────────────────────────────────────────
// Collapsed by default, and never a reserved blank column: it opens onto whatever the current
// selection is. In WP 7.1 that is the editor's OWN Node details panel — PORTALLED in through
// `containerRef` rather than re-implemented here, so the panel an author sees in the Studio is the
// live, editable one (anchored SKILL.md excerpt, per-kind editors, "Test this tool…"), not a
// read-only lookalike sitting beside a second copy in the centre.
//
// It deliberately carries no copy of its own: `NodeDetailPanel` already owns the "select a node"
// empty state, and a second hint layered behind it would just be a second voice saying the same
// thing (and, for the seconds before the editor has projected the document, a wrong one).
//
// Later work packages fill the same frame: WP 7.6 docks the trace Evidence list + legend here.

export type StudioContextPanelProps = {
  /** Mount point for the editor's Node details panel. Passed straight to a `ref` — pass the setter
   *  from a `useState`, so the host re-renders exactly once when the node appears or goes away. */
  containerRef: (node: HTMLDivElement | null) => void;
};

export function StudioContextPanel({ containerRef }: StudioContextPanelProps) {
  return (
    <div
      ref={containerRef}
      className="flex min-h-0 flex-1 flex-col"
      data-testid="studio-context-body"
    />
  );
}
