import type { SuiteCell, SuiteRunMember } from "@mcp-token-footprint/shared";
import { cellKey } from "./use-suite-stream";

/**
 * Derive a matrix-cell seed from a suite run's persisted MEMBER runs — one {@link SuiteCell} per
 * member, keyed by {@link cellKey} exactly like the live SSE cells. This is what re-materialises the
 * matrix for a FINISHED suite run: the backend never re-emits `cell` events once a run settles, but
 * every member run is persisted, so we project them back into the same `Record<string, SuiteCell>` the
 * matrix already consumes. Merged UNDER the live stream (`{ ...seed, ...stream.cells }`) so a live cell
 * with a fresher status/score always wins over its seed.
 *
 * A member's `status` (a {@link import("@mcp-token-footprint/shared").RunStatus}) maps directly into
 * the matrix rollup's terminal/failed logic — no translation. `variantLabel` (present only for a
 * skill-effect suite) is folded into the key so base + variant cells never collide.
 */
export function deriveSeedCells(members: readonly SuiteRunMember[]): Record<string, SuiteCell> {
  const seed: Record<string, SuiteCell> = {};
  for (const member of members) {
    const cell: SuiteCell = {
      testId: member.testId,
      scenarioId: member.scenarioId,
      repetition: member.repetition ?? 1,
      runId: member.id,
      status: member.status,
      score: member.score,
    };
    if (member.variantLabel !== undefined) cell.variantLabel = member.variantLabel;
    seed[cellKey(cell)] = cell;
  }
  return seed;
}
