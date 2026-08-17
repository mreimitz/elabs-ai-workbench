import type { AssistantContextEnvelope, AssistantEntityKind } from "@mcp-token-footprint/shared";
import { deriveAssistantScope } from "@mcp-token-footprint/shared";

/**
 * Assistant Refinement R1 (WP R1.5, D-AS23) — the dock header's "Scope" chip: shows what the
 * assistant may WRITE to, derived from the CURRENT envelope via the R1.1 shared helper
 * (`deriveAssistantScope`, `packages/shared/src/assistant-scope.ts`). Pure and unit-tested without
 * React (mirrors `deriveAssistantEnvelope` in `assistant-context.tsx`) — `AssistantDock.tsx` just
 * calls {@link scopeChipCopy} on `currentEnvelope` and renders the result in a `@elabs-ai/components-ui` `Badge`.
 * No migration, no new wire shape — this reads the R1.1 envelope/scope types as-is.
 *
 * `scenario` is the WIRE name for what the UI labels "Environment" (the Testing-IA rename is
 * UI-label-only, wire frozen — see CLAUDE.md §1 and `ASSISTANT_ENTITY_KINDS`'s own doc comment in
 * `packages/shared/src/constants.ts`).
 *
 * DRIFT NOTE (verified against the code, not assumed from the refinement-01 kickoff prompt): the
 * kickoff cites "an analysis page like a run/scan/compare" as an example of an UNSCOPED page. That
 * holds for `compare` (no route ever carries a single entity id — see `resolveEntityPin` in
 * `assistant-context.tsx`), but NOT for `run`/`scan`: both `/testing/runs/:runId` and
 * `/scans/:scanId` DO pin an entity today (R1.1's `resolveEntityPin`), so `deriveAssistantScope`
 * returns a NON-NULL scope there even though `SCOPE_WRITE_TOOLS.run` / `SCOPE_WRITE_TOOLS.scan` are
 * BOTH empty (deliberately read-only surfaces — see `assistant-scope.ts`'s own doc comment). The
 * chip therefore reads "Scope: Run <id>" / "Scope: Scan <id>" on those pages even though no write
 * tool is ever actually reachable there. This module implements the LOCKED decision literally
 * (D-AS23: "the dock shows a chip from the CURRENT ENVELOPE" — i.e. from `deriveAssistantScope`'s
 * entity-pin, not from whether that kind's write-tool allowlist happens to be non-empty), so it does
 * NOT special-case run/scan into the read-only copy. Flagged for the owner rather than silently
 * reinterpreted — see the R1.5 handback.
 */

/** Human noun per {@link AssistantEntityKind} for the chip's "Scope: <noun> <id>" copy. Distinct
 *  from `AssistantDock.tsx`'s own `ENTITY_KIND_LABELS` (that map lowercases every noun, including
 *  `scenario` -> "scenario", for the switcher's mid-sentence "Threads for this <noun>" label) — the
 *  chip is a standalone, Title-Case tag, and `scenario` reads "Environment" here specifically. */
const SCOPE_CHIP_ENTITY_NOUNS: Record<AssistantEntityKind, string> = {
  run: "Run",
  scenario: "Environment",
  skill: "Skill",
  scan: "Scan",
  server: "Server",
  test: "Test",
  collection: "Collection",
  suite_run: "Suite run",
  compare: "Compare",
};

/** D-AS23's exact unscoped copy. */
export const SCOPE_CHIP_READ_ONLY_COPY = "Read-only — open an entity to enable edits";

/** The scope chip's rendered state for the current envelope. */
export type ScopeChipCopy = { scoped: boolean; text: string };

/**
 * The scope chip's text for the current envelope. `scoped: true` when an entity is pinned
 * (`deriveAssistantScope(envelope) !== null`) — the id is shown as-is; the envelope carries no
 * human-readable name to prefer, so one is never fabricated (an honest id beats a guessed name).
 */
export function scopeChipCopy(envelope: AssistantContextEnvelope | undefined): ScopeChipCopy {
  const scope = deriveAssistantScope(envelope);
  if (!scope) return { scoped: false, text: SCOPE_CHIP_READ_ONLY_COPY };
  return {
    scoped: true,
    text: `Scope: ${SCOPE_CHIP_ENTITY_NOUNS[scope.entityKind]} ${scope.entityId}`,
  };
}
