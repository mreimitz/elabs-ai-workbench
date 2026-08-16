import { nanoid } from "nanoid";
import {
  GRADING_VERSION,
  type GradeKind,
  type GraderId,
  type GradeStatus,
  type RunGrade,
} from "@mcp-token-footprint/shared";
import type { AppDatabase } from "../db/database.js";
import type { RunGradeRow } from "../db/rows.js";
import { RunSearchIndex } from "../observability/search.js";
import { parseJsonObject, stableStringify } from "../utils/json.js";

/**
 * APPEND-ONLY persistence over `run_grades` (B2/B4/B5). One INSERT per grade row; grade rows are NEVER
 * updated or deleted — the history IS the provenance, and display selects the latest row per grader id.
 * Judge cost lives in the `judge_*` columns (a SEPARATE ledger, never folded into `runs.cost_usd`); the
 * two deterministic graders write them as 0/null. Mirrors the other repositories' snake_case ⇄ camelCase
 * mapping.
 */
export class GradeRepository {
  // Observability (WP1.3, D-OB16) — full-text index writer for the `rating` content class (judge verdict
  // text + forensics summaries / fix targets). Best-effort (DERIVED state): an index failure never blocks
  // a grade write; the index is rebuildable via reindex.
  private readonly search: RunSearchIndex;

  constructor(private readonly db: AppDatabase) {
    this.search = new RunSearchIndex(db);
  }

  /** Insert one grade row (id + created_at + grading_version stamped here). Returns the inserted {@link RunGrade}. */
  insert(input: GradeInsert): RunGrade {
    const id = nanoid();
    const createdAt = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO run_grades (
           id, run_id, grader_id, kind, status, score, raw_score, method, reasoning, evidence_json,
           judge_provider_id, judge_model, judge_tokens_in, judge_tokens_out, judge_cost_usd,
           grading_version, created_at
         ) VALUES (
           @id, @runId, @graderId, @kind, @status, @score, @rawScore, @method, @reasoning, @evidenceJson,
           @judgeProviderId, @judgeModel, @judgeTokensIn, @judgeTokensOut, @judgeCostUsd,
           @gradingVersion, @createdAt
         )`,
      )
      .run({
        id,
        runId: input.runId,
        graderId: input.graderId,
        kind: input.kind,
        status: input.status,
        // A score is only ever a number for a `graded` row; `unevaluable`/`error` are always null (never 0).
        score: input.status === "graded" ? input.score : null,
        rawScore: input.rawScore ?? null,
        method: input.method,
        reasoning: input.reasoning ?? null,
        evidenceJson:
          input.evidence === undefined || input.evidence === null
            ? null
            : stableStringify(input.evidence),
        judgeProviderId: input.judgeProviderId ?? null,
        judgeModel: input.judgeModel ?? null,
        judgeTokensIn: input.judgeTokensIn ?? 0,
        judgeTokensOut: input.judgeTokensOut ?? 0,
        judgeCostUsd: input.judgeCostUsd ?? 0,
        gradingVersion: GRADING_VERSION,
        createdAt,
      });
    // Observability (WP1.3) — index the judge verdict text + forensics summaries / fix targets. Keyed by
    // the (append-only) grade id, so reindex reads back the same grade rows and produces identical docs.
    try {
      this.search.indexRating(input.runId, id, {
        reasoning: input.reasoning,
        method: input.method,
        evidence: input.evidence,
      });
    } catch {
      // Derived state (conventions §1) — never let an index write break the authoritative grade write.
    }
    return this.get(id);
  }

  /** All grade rows for a run, oldest first (the append-only history). `rowid` breaks same-ms ties. */
  listByRun(runId: string): RunGrade[] {
    const rows = this.db
      .prepare("SELECT * FROM run_grades WHERE run_id = ? ORDER BY created_at ASC, rowid ASC")
      .all(runId) as RunGradeRow[];
    return rows.map(toRunGrade);
  }

  /** The newest row per grader id (for display). Iterates the ASC history so the last write per grader wins. */
  latestByGrader(runId: string): RunGrade[] {
    const latest = new Map<string, RunGrade>();
    for (const grade of this.listByRun(runId)) latest.set(grade.graderId, grade);
    return [...latest.values()];
  }

  private get(id: string): RunGrade {
    const row = this.db.prepare("SELECT * FROM run_grades WHERE id = ?").get(id) as
      | RunGradeRow
      | undefined;
    if (!row) throw new Error(`grade row ${id} not found immediately after insert`);
    return toRunGrade(row);
  }
}

/** The input to {@link GradeRepository.insert}. `judge_*` fields default to 0/null (deterministic graders). */
export type GradeInsert = {
  runId: string;
  graderId: GraderId;
  kind: GradeKind;
  status: GradeStatus;
  score: number | null;
  rawScore?: number | null;
  method: string;
  reasoning?: string | null;
  evidence?: unknown;
  judgeProviderId?: string | null;
  judgeModel?: string | null;
  judgeTokensIn?: number;
  judgeTokensOut?: number;
  judgeCostUsd?: number;
};

function toRunGrade(row: RunGradeRow): RunGrade {
  return {
    id: row.id,
    runId: row.run_id,
    graderId: row.grader_id as GraderId,
    kind: row.kind,
    status: row.status,
    score: row.score,
    rawScore: row.raw_score,
    method: row.method,
    reasoning: row.reasoning,
    evidence: row.evidence_json ? parseJsonObject<unknown>(row.evidence_json, null) : null,
    judgeProviderId: row.judge_provider_id,
    judgeModel: row.judge_model,
    judgeTokensIn: row.judge_tokens_in,
    judgeTokensOut: row.judge_tokens_out,
    judgeCostUsd: row.judge_cost_usd,
    gradingVersion: row.grading_version,
    createdAt: row.created_at,
  };
}
