import { nanoid } from "nanoid";
import type {
  AllowedServer,
  AllowedSkill,
  ModelParams,
  Scenario,
  ScenarioInput,
  TokenProfileRef,
  ToolLoadingMode,
} from "@mcp-token-footprint/shared";
import { scenarioInputSchema } from "@mcp-token-footprint/shared";
import type { AppDatabase } from "../db/database.js";
import type { ScenarioRow, ScenarioServerRow, ScenarioSkillRow } from "../db/rows.js";
import { httpError } from "../utils/errors.js";
import { parseJsonObject, stableStringify } from "../utils/json.js";

// `packages/shared` inlines this shape on `Scenario`/`ScenarioInput` rather than exporting it as a
// standalone type — derive it locally instead of adding a shared export (WP 2.3 is additive-only).
type AnswersMode = NonNullable<Scenario["answersMode"]>;

export class ScenarioRepository {
  constructor(private readonly db: AppDatabase) {}

  list(): Scenario[] {
    const rows = this.db
      .prepare("SELECT * FROM scenarios ORDER BY updated_at DESC")
      .all() as ScenarioRow[];
    return rows.map((row) => this.hydrate(row));
  }

  get(id: string): Scenario {
    return this.hydrate(this.getRow(id));
  }

  create(input: ScenarioInput): Scenario {
    const parsed = scenarioInputSchema.parse(input);
    const now = new Date().toISOString();
    const id = nanoid();

    const transaction = this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO scenarios (
            id, name, provider_id, model, params_json, system_prompt,
            default_profiles_json, guardrails_json, tool_loading_mode, answers_mode, created_at, updated_at
          ) VALUES (
            @id, @name, @providerId, @model, @paramsJson, @systemPrompt,
            @defaultProfilesJson, @guardrailsJson, @toolLoadingMode, @answersModeJson, @createdAt, @updatedAt
          )`,
        )
        .run({
          id,
          name: parsed.name,
          providerId: parsed.providerId,
          model: parsed.model,
          paramsJson: stableStringify(parsed.params),
          systemPrompt: parsed.systemPrompt,
          defaultProfilesJson: stableStringify(parsed.defaultProfiles),
          guardrailsJson: stableStringify(parsed.guardrails),
          toolLoadingMode: parsed.toolLoadingMode,
          // Qlik Answers (WP 2.3): JSON-serialize when present; NULL when omitted (non-qlik scenarios).
          answersModeJson: parsed.answersMode ? stableStringify(parsed.answersMode) : null,
          createdAt: now,
          updatedAt: now,
        });
      this.replaceServers(id, parsed.allowedServers);
      this.replaceSkills(id, parsed.allowedSkills);
    });
    transaction();

    return this.get(id);
  }

  update(id: string, input: ScenarioInput): Scenario {
    const parsed = scenarioInputSchema.parse(input);
    const now = new Date().toISOString();

    const transaction = this.db.transaction(() => {
      const result = this.db
        .prepare(
          `UPDATE scenarios
            SET name = @name,
                provider_id = @providerId,
                model = @model,
                params_json = @paramsJson,
                system_prompt = @systemPrompt,
                default_profiles_json = @defaultProfilesJson,
                guardrails_json = @guardrailsJson,
                tool_loading_mode = @toolLoadingMode,
                answers_mode = @answersModeJson,
                updated_at = @updatedAt
          WHERE id = @id`,
        )
        .run({
          id,
          name: parsed.name,
          providerId: parsed.providerId,
          model: parsed.model,
          paramsJson: stableStringify(parsed.params),
          systemPrompt: parsed.systemPrompt,
          defaultProfilesJson: stableStringify(parsed.defaultProfiles),
          guardrailsJson: stableStringify(parsed.guardrails),
          toolLoadingMode: parsed.toolLoadingMode,
          // Qlik Answers (WP 2.3): JSON-serialize when present; NULL when omitted (non-qlik scenarios).
          answersModeJson: parsed.answersMode ? stableStringify(parsed.answersMode) : null,
          updatedAt: now,
        });
      if (result.changes === 0) {
        throw httpError(404, "Scenario not found");
      }
      this.replaceServers(id, parsed.allowedServers);
      this.replaceSkills(id, parsed.allowedSkills);
    });
    transaction();

    return this.get(id);
  }

  delete(id: string): void {
    // scenario_servers + scenario_skills rows cascade via the FK (ON DELETE CASCADE).
    const result = this.db.prepare("DELETE FROM scenarios WHERE id = ?").run(id);
    if (result.changes === 0) {
      throw httpError(404, "Scenario not found");
    }
  }

  listServers(scenarioId: string): AllowedServer[] {
    const rows = this.db
      .prepare("SELECT * FROM scenario_servers WHERE scenario_id = ? ORDER BY server_id ASC")
      .all(scenarioId) as ScenarioServerRow[];
    return rows.map(toAllowedServer);
  }

  // Upsert the scenario_servers allow-list: clear then re-insert from the input.
  private replaceServers(scenarioId: string, allowedServers: AllowedServer[]): void {
    this.db.prepare("DELETE FROM scenario_servers WHERE scenario_id = ?").run(scenarioId);
    const insert = this.db.prepare(
      `INSERT INTO scenario_servers (scenario_id, server_id, allowed_tools_json)
        VALUES (@scenarioId, @serverId, @allowedToolsJson)`,
    );
    for (const server of allowedServers) {
      insert.run({
        scenarioId,
        serverId: server.serverId,
        // null = all tools allowed; otherwise persist the per-tool allow-list.
        allowedToolsJson:
          server.allowedTools === null ? null : stableStringify(server.allowedTools),
      });
    }
  }

  listSkills(scenarioId: string): AllowedSkill[] {
    const rows = this.db
      .prepare("SELECT * FROM scenario_skills WHERE scenario_id = ? ORDER BY skill_id ASC")
      .all(scenarioId) as ScenarioSkillRow[];
    return rows.map(toAllowedSkill);
  }

  // Upsert the scenario_skills attachment list (mirrors replaceServers): clear then re-insert.
  // Called in the same create/update transaction as replaceServers.
  private replaceSkills(scenarioId: string, allowedSkills: AllowedSkill[]): void {
    this.db.prepare("DELETE FROM scenario_skills WHERE scenario_id = ?").run(scenarioId);
    const insert = this.db.prepare(
      `INSERT INTO scenario_skills (scenario_id, skill_id, version_mode, pinned_version_id, eager)
        VALUES (@scenarioId, @skillId, @versionMode, @pinnedVersionId, @eager)`,
    );
    for (const skill of allowedSkills) {
      insert.run({
        scenarioId,
        skillId: skill.skillId,
        versionMode: skill.versionMode,
        // Only 'pinned' carries a version id; 'latest' resolves at run time (WP 2.2).
        pinnedVersionId: skill.versionMode === "pinned" ? (skill.pinnedVersionId ?? null) : null,
        // WP 2.3 eager toggle — persist as 0/1.
        eager: skill.eager ? 1 : 0,
      });
    }
  }

  private hydrate(row: ScenarioRow): Scenario {
    const scenario: Scenario = {
      id: row.id,
      name: row.name,
      providerId: row.provider_id,
      model: row.model,
      params: parseJsonObject<ModelParams>(row.params_json, {}),
      systemPrompt: row.system_prompt,
      allowedServers: this.listServers(row.id),
      allowedSkills: this.listSkills(row.id),
      defaultProfiles: parseJsonObject<TokenProfileRef[]>(row.default_profiles_json, []),
      guardrails: parseJsonObject(row.guardrails_json, {}),
      // Older rows backfilled to 'eager' by the migration; coerce any unexpected value back to eager.
      toolLoadingMode: (row.tool_loading_mode === "deferred"
        ? "deferred"
        : "eager") as ToolLoadingMode,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
    // Qlik Answers (WP 2.3): NULL column stays omitted (non-qlik scenarios, or one that never set it) —
    // the run engine's own `answersMode?.transport ?? "stream"` default then applies (D-QA2).
    if (row.answers_mode) {
      scenario.answersMode = parseJsonObject<AnswersMode>(row.answers_mode, { transport: "stream" });
    }
    return scenario;
  }

  private getRow(id: string): ScenarioRow {
    const row = this.db.prepare("SELECT * FROM scenarios WHERE id = ?").get(id) as
      | ScenarioRow
      | undefined;
    if (!row) {
      throw httpError(404, "Scenario not found");
    }
    return row;
  }
}

function toAllowedServer(row: ScenarioServerRow): AllowedServer {
  return {
    serverId: row.server_id,
    allowedTools:
      row.allowed_tools_json === null
        ? null
        : parseJsonObject<string[]>(row.allowed_tools_json, []),
  };
}

function toAllowedSkill(row: ScenarioSkillRow): AllowedSkill {
  const skill: AllowedSkill = {
    skillId: row.skill_id,
    versionMode: row.version_mode,
    // WP 2.3 eager toggle — 0/1 → boolean.
    eager: row.eager === 1,
  };
  if (row.version_mode === "pinned" && row.pinned_version_id) {
    skill.pinnedVersionId = row.pinned_version_id;
  }
  return skill;
}
