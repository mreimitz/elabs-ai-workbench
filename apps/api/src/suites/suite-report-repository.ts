import { nanoid } from "nanoid";
import type { SuiteReport } from "@mcp-token-footprint/shared";
import type { AppDatabase } from "../db/database.js";
import type { SuiteRunReportRow } from "../db/rows.js";
import { parseJsonObject, stableStringify } from "../utils/json.js";

/**
 * Auto-Rating (WP 4.1, AR7/AR11/AR15) — APPEND-ONLY persistence over `suite_run_reports`. One INSERT per
 * generation; report rows are NEVER updated or deleted — the history IS the provenance, and display /
 * regeneration selects the LATEST row per suite run (mirrors {@link import("../grading/grade-repository.js").GradeRepository}'s
 * discipline). The judge_* columns are a SEPARATE ledger (B5), written 0/null on the deterministic pass
 * (WP 4.2 fills them when it makes the per-test-group agreement call). `report`/`report_json` round-trip
 * via the shared stable-JSON helpers; snake_case ⇄ camelCase mirrors the other repositories.
 */
export type SuiteReportStatus = SuiteRunReportRow["status"];

/** One persisted suite-run report row (the serialized {@link SuiteReport} + its status + judge ledger). */
export type SuiteRunReportRecord = {
  id: string;
  suiteRunId: string;
  status: SuiteReportStatus;
  report: SuiteReport;
  ratingVersion: number;
  judgeProviderId: string | null;
  judgeModel: string | null;
  judgeTokensIn: number;
  judgeTokensOut: number;
  judgeCostUsd: number;
  createdAt: string;
};

/** The input to {@link SuiteReportRepository.insert}. Judge-ledger fields default to 0/null (deterministic pass). */
export type SuiteReportInsert = {
  suiteRunId: string;
  status: SuiteReportStatus;
  report: SuiteReport;
  ratingVersion: number;
  judgeProviderId?: string | null;
  judgeModel?: string | null;
  judgeTokensIn?: number;
  judgeTokensOut?: number;
  judgeCostUsd?: number;
};

export class SuiteReportRepository {
  constructor(private readonly db: AppDatabase) {}

  /** Insert one report row (id + created_at stamped here). Returns the inserted {@link SuiteRunReportRecord}. */
  insert(input: SuiteReportInsert): SuiteRunReportRecord {
    const id = nanoid();
    const createdAt = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO suite_run_reports (
           id, suite_run_id, status, report_json, rating_version,
           judge_provider_id, judge_model, judge_tokens_in, judge_tokens_out, judge_cost_usd, created_at
         ) VALUES (
           @id, @suiteRunId, @status, @reportJson, @ratingVersion,
           @judgeProviderId, @judgeModel, @judgeTokensIn, @judgeTokensOut, @judgeCostUsd, @createdAt
         )`,
      )
      .run({
        id,
        suiteRunId: input.suiteRunId,
        status: input.status,
        reportJson: stableStringify(input.report),
        ratingVersion: input.ratingVersion,
        judgeProviderId: input.judgeProviderId ?? null,
        judgeModel: input.judgeModel ?? null,
        judgeTokensIn: input.judgeTokensIn ?? 0,
        judgeTokensOut: input.judgeTokensOut ?? 0,
        judgeCostUsd: input.judgeCostUsd ?? 0,
        createdAt,
      });
    return this.get(id);
  }

  /** The LATEST report for a suite run (newest by created_at; `rowid` breaks a same-ms tie), or null if none. */
  latest(suiteRunId: string): SuiteRunReportRecord | null {
    const row = this.db
      .prepare(
        "SELECT * FROM suite_run_reports WHERE suite_run_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1",
      )
      .get(suiteRunId) as SuiteRunReportRow | undefined;
    return row ? toRecord(row) : null;
  }

  /** All report rows for a suite run, oldest first (the append-only history). `rowid` breaks same-ms ties. */
  listBySuiteRun(suiteRunId: string): SuiteRunReportRecord[] {
    const rows = this.db
      .prepare(
        "SELECT * FROM suite_run_reports WHERE suite_run_id = ? ORDER BY created_at ASC, rowid ASC",
      )
      .all(suiteRunId) as SuiteRunReportRow[];
    return rows.map(toRecord);
  }

  private get(id: string): SuiteRunReportRecord {
    const row = this.db.prepare("SELECT * FROM suite_run_reports WHERE id = ?").get(id) as
      | SuiteRunReportRow
      | undefined;
    if (!row) throw new Error(`suite_run_reports row ${id} not found immediately after insert`);
    return toRecord(row);
  }
}

function toRecord(row: SuiteRunReportRow): SuiteRunReportRecord {
  return {
    id: row.id,
    suiteRunId: row.suite_run_id,
    status: row.status,
    report: parseJsonObject<SuiteReport>(row.report_json, emptyReportFallback(row.suite_run_id)),
    ratingVersion: row.rating_version,
    judgeProviderId: row.judge_provider_id,
    judgeModel: row.judge_model,
    judgeTokensIn: row.judge_tokens_in,
    judgeTokensOut: row.judge_tokens_out,
    judgeCostUsd: row.judge_cost_usd,
    createdAt: row.created_at,
  };
}

/** A defensive fallback if a stored report_json is ever unparseable (should never happen — we serialize it). */
function emptyReportFallback(suiteRunId: string): SuiteReport {
  return {
    suiteRunId,
    testGroups: [],
    errorClustering: [],
    rootCauseRollup: [],
    narrative: "",
    judgeProvenance: { judgeProviderId: null, judgeModel: null },
    ratingVersion: 0,
    generatedAt: "",
  };
}
