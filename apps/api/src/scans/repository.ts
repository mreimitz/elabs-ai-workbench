import { nanoid } from "nanoid";
import type {
  PromptScan,
  ResourceScan,
  ScanDeletionResult,
  ScanDetail,
  ScanEvent,
  ScanEventLevel,
  ScanRetentionResult,
  ScanStatus,
  ScanSummary,
  TokenProfileId,
  ToolScan,
} from "@mcp-token-footprint/shared";
import { TOKEN_COUNTING_VERSION } from "@mcp-token-footprint/shared";
import type { AppDatabase } from "../db/database.js";
import type {
  PromptScanRow,
  ResourceScanRow,
  ScanEventRow,
  ScanRow,
  ToolScanRow,
} from "../db/rows.js";
import { httpError } from "../utils/errors.js";
import { parseJsonObject, stableStringify } from "../utils/json.js";

export type ToolScanInsert = Omit<ToolScan, "id" | "scanId">;

export type ResourceScanInsert = Omit<ResourceScan, "id" | "scanId">;

export type PromptScanInsert = Omit<PromptScan, "id" | "scanId">;

export class ScanRepository {
  constructor(private readonly db: AppDatabase) {}

  createRunningScan(serverId: string, tokenProfile: TokenProfileId): ScanSummary {
    const id = nanoid();
    const scannedAt = new Date().toISOString();

    this.db
      .prepare(
        `INSERT INTO mcp_scans (
          id, server_id, token_profile, scanned_at, status, counting_version
        ) VALUES (?, ?, ?, ?, 'running', ?)`,
      )
      .run(id, serverId, tokenProfile, scannedAt, TOKEN_COUNTING_VERSION);

    return this.getSummary(id);
  }

  addEvent(scanId: string, level: ScanEventLevel, message: string): ScanEvent {
    const event = {
      id: nanoid(),
      scanId,
      level,
      message,
      createdAt: new Date().toISOString(),
    };

    this.db
      .prepare(
        `INSERT INTO scan_events (id, scan_id, level, message, created_at)
        VALUES (@id, @scanId, @level, @message, @createdAt)`,
      )
      .run(event);

    return event;
  }

  completeScan(
    scanId: string,
    summary: CompleteScanInput,
    tools: ToolScanInsert[],
    resources: ResourceScanInsert[] = [],
    prompts: PromptScanInsert[] = [],
  ): void {
    const transaction = this.db.transaction(() => {
      this.db
        .prepare(
          `UPDATE mcp_scans
            SET status = 'success',
                total_tools = @totalTools,
                total_tokens = @totalTokens,
                total_raw_bytes = @totalRawBytes,
                average_tokens_per_tool = @averageTokensPerTool,
                largest_tool_name = @largestToolName,
                largest_tool_tokens = @largestToolTokens,
                total_resources = @totalResources,
                total_resource_templates = @totalResourceTemplates,
                total_prompts = @totalPrompts,
                total_resource_tokens = @totalResourceTokens,
                total_prompt_tokens = @totalPromptTokens,
                largest_resource_name = @largestResourceName,
                largest_resource_tokens = @largestResourceTokens,
                largest_prompt_name = @largestPromptName,
                largest_prompt_tokens = @largestPromptTokens,
                error_message = NULL
          WHERE id = @scanId`,
        )
        .run({ scanId, ...summary });

      const insertTool = this.db.prepare(
        `INSERT INTO mcp_tool_scans (
          id, scan_id, tool_name, description, input_schema_json, annotations_json, raw_tool_json,
          total_tokens, name_tokens, description_tokens, schema_tokens, annotations_tokens,
          raw_bytes, contribution_percent
        ) VALUES (
          @id, @scanId, @toolName, @description, @inputSchemaJson, @annotationsJson, @rawToolJson,
          @totalTokens, @nameTokens, @descriptionTokens, @schemaTokens, @annotationsTokens,
          @rawBytes, @contributionPercent
        )`,
      );

      for (const tool of tools) {
        insertTool.run({
          id: nanoid(),
          scanId,
          toolName: tool.toolName,
          description: tool.description ?? null,
          inputSchemaJson:
            tool.inputSchema === undefined ? null : stableStringify(tool.inputSchema),
          annotationsJson:
            tool.annotations === undefined ? null : stableStringify(tool.annotations),
          rawToolJson: stableStringify(tool.rawTool),
          totalTokens: tool.totalTokens,
          nameTokens: tool.nameTokens,
          descriptionTokens: tool.descriptionTokens,
          schemaTokens: tool.schemaTokens,
          annotationsTokens: tool.annotationsTokens,
          rawBytes: tool.rawBytes,
          contributionPercent: tool.contributionPercent,
        });
      }

      const insertResource = this.db.prepare(
        `INSERT INTO mcp_resource_scans (
          id, scan_id, kind, uri, name, description, mime_type, raw_resource_json,
          total_tokens, uri_tokens, name_tokens, description_tokens, mimetype_tokens,
          raw_bytes, contribution_percent
        ) VALUES (
          @id, @scanId, @kind, @uri, @name, @description, @mimeType, @rawResourceJson,
          @totalTokens, @uriTokens, @nameTokens, @descriptionTokens, @mimeTypeTokens,
          @rawBytes, @contributionPercent
        )`,
      );

      for (const resource of resources) {
        insertResource.run({
          id: nanoid(),
          scanId,
          kind: resource.kind,
          uri: resource.uri,
          name: resource.name ?? null,
          description: resource.description ?? null,
          mimeType: resource.mimeType ?? null,
          rawResourceJson: stableStringify(resource.rawResource),
          totalTokens: resource.totalTokens,
          uriTokens: resource.uriTokens,
          nameTokens: resource.nameTokens,
          descriptionTokens: resource.descriptionTokens,
          mimeTypeTokens: resource.mimeTypeTokens,
          rawBytes: resource.rawBytes,
          contributionPercent: resource.contributionPercent,
        });
      }

      const insertPrompt = this.db.prepare(
        `INSERT INTO mcp_prompt_scans (
          id, scan_id, prompt_name, description, arguments_json, raw_prompt_json,
          total_tokens, name_tokens, description_tokens, arguments_tokens,
          raw_bytes, contribution_percent
        ) VALUES (
          @id, @scanId, @promptName, @description, @argumentsJson, @rawPromptJson,
          @totalTokens, @nameTokens, @descriptionTokens, @argumentsTokens,
          @rawBytes, @contributionPercent
        )`,
      );

      for (const prompt of prompts) {
        insertPrompt.run({
          id: nanoid(),
          scanId,
          promptName: prompt.promptName,
          description: prompt.description ?? null,
          argumentsJson: prompt.arguments === undefined ? null : stableStringify(prompt.arguments),
          rawPromptJson: stableStringify(prompt.rawPrompt),
          totalTokens: prompt.totalTokens,
          nameTokens: prompt.nameTokens,
          descriptionTokens: prompt.descriptionTokens,
          argumentsTokens: prompt.argumentsTokens,
          rawBytes: prompt.rawBytes,
          contributionPercent: prompt.contributionPercent,
        });
      }
    });

    transaction();
  }

  /**
   * On API restart, any `mcp_scans` still marked `running` lost their in-memory scan (the process is
   * gone), so mark them `failed` with an "interrupted by restart" note — otherwise a crash mid-scan
   * leaves the row `running` forever. Returns the number of rows reconciled. Wired at startup in
   * `index.ts` alongside the run reconciliation (`RunRepository.abortOrphanedRuns`).
   */
  abortOrphanedScans(): number {
    const result = this.db
      .prepare(
        `UPDATE mcp_scans
          SET status = 'failed',
              error_message = 'Scan interrupted by restart'
        WHERE status = 'running'`,
      )
      .run();
    return result.changes;
  }

  failScan(scanId: string, errorMessage: string): void {
    this.db
      .prepare(
        `UPDATE mcp_scans
          SET status = 'failed',
              error_message = @errorMessage
        WHERE id = @scanId`,
      )
      .run({ scanId, errorMessage });
  }

  listSummaries(): ScanSummary[] {
    const rows = this.db
      .prepare(
        `SELECT s.*, m.name AS server_name
          FROM mcp_scans s
          JOIN mcp_servers m ON m.id = s.server_id
          ORDER BY s.scanned_at DESC`,
      )
      .all() as ScanRow[];
    return rows.map(toScanSummary);
  }

  listSummariesByServer(serverId: string): ScanSummary[] {
    const rows = this.db
      .prepare(
        `SELECT s.*, m.name AS server_name
          FROM mcp_scans s
          JOIN mcp_servers m ON m.id = s.server_id
          WHERE s.server_id = ?
          ORDER BY s.scanned_at DESC`,
      )
      .all(serverId) as ScanRow[];
    return rows.map(toScanSummary);
  }

  getSummary(scanId: string): ScanSummary {
    const row = this.db
      .prepare(
        `SELECT s.*, m.name AS server_name
          FROM mcp_scans s
          JOIN mcp_servers m ON m.id = s.server_id
          WHERE s.id = ?`,
      )
      .get(scanId) as ScanRow | undefined;

    if (!row) {
      throw httpError(404, "Scan not found");
    }

    return toScanSummary(row);
  }

  getLatestForServer(serverId: string): ScanDetail | null {
    const row = this.db
      .prepare(
        `SELECT s.*, m.name AS server_name
          FROM mcp_scans s
          JOIN mcp_servers m ON m.id = s.server_id
          WHERE s.server_id = ?
          ORDER BY s.scanned_at DESC
          LIMIT 1`,
      )
      .get(serverId) as ScanRow | undefined;

    return row ? this.getDetail(row.id) : null;
  }

  getDetail(scanId: string): ScanDetail {
    const summary = this.getSummary(scanId);
    const toolRows = this.db
      .prepare("SELECT * FROM mcp_tool_scans WHERE scan_id = ? ORDER BY total_tokens DESC")
      .all(scanId) as ToolScanRow[];
    const resourceRows = this.db
      .prepare("SELECT * FROM mcp_resource_scans WHERE scan_id = ? ORDER BY total_tokens DESC")
      .all(scanId) as ResourceScanRow[];
    const promptRows = this.db
      .prepare("SELECT * FROM mcp_prompt_scans WHERE scan_id = ? ORDER BY total_tokens DESC")
      .all(scanId) as PromptScanRow[];
    const eventRows = this.db
      .prepare("SELECT * FROM scan_events WHERE scan_id = ? ORDER BY created_at ASC")
      .all(scanId) as ScanEventRow[];

    return {
      ...summary,
      tools: toolRows.map(toToolScan),
      resources: resourceRows.map(toResourceScan),
      prompts: promptRows.map(toPromptScan),
      events: eventRows.map(toScanEvent),
    };
  }

  /**
   * Delete a scan and every child row (tool/resource/prompt scans + scan_events) in one transaction.
   * The child tables all declare `ON DELETE CASCADE` on `mcp_scans(id)`, so deleting the parent row
   * removes them — but we count them first (while they still exist) so the caller/UI can confirm
   * exactly what was removed. 404s if the scan doesn't exist. Requires `foreign_keys = ON` (set in
   * {@link import("../db/database.js").openDatabase}).
   */
  delete(scanId: string): ScanDeletionResult {
    const remove = this.db.transaction((): ScanDeletionResult => {
      const exists = this.db.prepare("SELECT 1 FROM mcp_scans WHERE id = ?").get(scanId);
      if (!exists) throw httpError(404, "Scan not found");

      const count = (table: string): number =>
        (
          this.db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE scan_id = ?`).get(scanId) as {
            n: number;
          }
        ).n;
      const result: ScanDeletionResult = {
        scanId,
        deletedTools: count("mcp_tool_scans"),
        deletedResources: count("mcp_resource_scans"),
        deletedPrompts: count("mcp_prompt_scans"),
        deletedEvents: count("scan_events"),
      };

      // The parent delete cascades to all four child tables (FK ON DELETE CASCADE).
      this.db.prepare("DELETE FROM mcp_scans WHERE id = ?").run(scanId);
      return result;
    });
    return remove();
  }

  /**
   * Retention: keep only the most recent `keep` scans for a single server (by `scanned_at DESC`,
   * `id` as a stable tiebreak) and delete the rest, cascading their child rows. `keep <= 0` is a
   * no-op (retention disabled). Returns the pruned scan ids. Non-automatic — called explicitly by a
   * maintenance surface or after a scan when {@link config.scanRetentionPerServer} is configured.
   */
  pruneServerScans(serverId: string, keep: number): string[] {
    if (keep <= 0) return [];
    const prune = this.db.transaction((): string[] => {
      // F5 — only TERMINAL scans ('success'/'failed') are prune candidates. A 'running' scan is
      // in-flight: pruning it would orphan the in-progress work (FK errors + lost results when it
      // completes). Excluding it from BOTH the keep-window count AND the victim set keeps "keep last
      // N" consistent — the N kept are the newest terminal scans; running scans are never touched.
      const victims = (
        this.db
          .prepare(
            `SELECT id FROM mcp_scans
              WHERE server_id = ? AND status IN ('success', 'failed')
              ORDER BY scanned_at DESC, id DESC
              LIMIT -1 OFFSET ?`,
          )
          .all(serverId, keep) as Array<{ id: string }>
      ).map((r) => r.id);
      if (victims.length === 0) return [];
      const del = this.db.prepare("DELETE FROM mcp_scans WHERE id = ?");
      for (const id of victims) del.run(id);
      return victims;
    });
    return prune();
  }

  /** Apply "keep last N scans per server" retention across every server. Returns the pruned ids. */
  pruneAllServers(keep: number): ScanRetentionResult {
    if (keep <= 0) return { keep, prunedScanIds: [] };
    const serverIds = (
      this.db.prepare("SELECT DISTINCT server_id FROM mcp_scans").all() as Array<{
        server_id: string;
      }>
    ).map((r) => r.server_id);
    const prunedScanIds: string[] = [];
    for (const serverId of serverIds) prunedScanIds.push(...this.pruneServerScans(serverId, keep));
    return { keep, prunedScanIds };
  }
}

type CompleteScanInput = {
  totalTools: number;
  totalTokens: number;
  totalRawBytes: number;
  averageTokensPerTool: number;
  largestToolName: string | null;
  largestToolTokens: number;
  totalResources: number;
  totalResourceTemplates: number;
  totalPrompts: number;
  totalResourceTokens: number;
  totalPromptTokens: number;
  largestResourceName: string | null;
  largestResourceTokens: number;
  largestPromptName: string | null;
  largestPromptTokens: number;
};

function toScanSummary(row: ScanRow): ScanSummary {
  return {
    id: row.id,
    serverId: row.server_id,
    serverName: row.server_name,
    tokenProfile: row.token_profile,
    scannedAt: row.scanned_at,
    status: row.status as ScanStatus,
    totalTools: row.total_tools,
    totalTokens: row.total_tokens,
    totalRawBytes: row.total_raw_bytes,
    averageTokensPerTool: row.average_tokens_per_tool,
    largestToolName: row.largest_tool_name ?? undefined,
    largestToolTokens: row.largest_tool_tokens,
    totalResources: row.total_resources,
    totalResourceTemplates: row.total_resource_templates,
    totalPrompts: row.total_prompts,
    totalResourceTokens: row.total_resource_tokens,
    totalPromptTokens: row.total_prompt_tokens,
    largestResourceName: row.largest_resource_name ?? undefined,
    largestResourceTokens: row.largest_resource_tokens,
    largestPromptName: row.largest_prompt_name ?? undefined,
    largestPromptTokens: row.largest_prompt_tokens,
    countingVersion: row.counting_version,
    errorMessage: row.error_message ?? undefined,
  };
}

function toToolScan(row: ToolScanRow): ToolScan {
  return {
    id: row.id,
    scanId: row.scan_id,
    toolName: row.tool_name,
    description: row.description ?? undefined,
    inputSchema: parseJsonObject<unknown>(row.input_schema_json, undefined),
    annotations: parseJsonObject<unknown>(row.annotations_json, undefined),
    rawTool: parseJsonObject<unknown>(row.raw_tool_json, {}),
    totalTokens: row.total_tokens,
    nameTokens: row.name_tokens,
    descriptionTokens: row.description_tokens,
    schemaTokens: row.schema_tokens,
    annotationsTokens: row.annotations_tokens,
    rawBytes: row.raw_bytes,
    contributionPercent: row.contribution_percent,
  };
}

function toResourceScan(row: ResourceScanRow): ResourceScan {
  return {
    id: row.id,
    scanId: row.scan_id,
    kind: row.kind,
    uri: row.uri,
    name: row.name ?? undefined,
    description: row.description ?? undefined,
    mimeType: row.mime_type ?? undefined,
    rawResource: parseJsonObject<unknown>(row.raw_resource_json, {}),
    totalTokens: row.total_tokens,
    uriTokens: row.uri_tokens,
    nameTokens: row.name_tokens,
    descriptionTokens: row.description_tokens,
    mimeTypeTokens: row.mimetype_tokens,
    rawBytes: row.raw_bytes,
    contributionPercent: row.contribution_percent,
  };
}

function toPromptScan(row: PromptScanRow): PromptScan {
  return {
    id: row.id,
    scanId: row.scan_id,
    promptName: row.prompt_name,
    description: row.description ?? undefined,
    arguments: parseJsonObject<unknown>(row.arguments_json, undefined),
    rawPrompt: parseJsonObject<unknown>(row.raw_prompt_json, {}),
    totalTokens: row.total_tokens,
    nameTokens: row.name_tokens,
    descriptionTokens: row.description_tokens,
    argumentsTokens: row.arguments_tokens,
    rawBytes: row.raw_bytes,
    contributionPercent: row.contribution_percent,
  };
}

function toScanEvent(row: ScanEventRow): ScanEvent {
  return {
    id: row.id,
    scanId: row.scan_id,
    level: row.level,
    message: row.message,
    createdAt: row.created_at,
  };
}
