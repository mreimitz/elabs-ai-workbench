// Assistant Hub (roadmap/assistant-hub/, WP0.2, D-AH1…D-AH20) — persistence for the full-page,
// multi-model, multi-agent Assistant. This repository owns the 13 migration-v47 `hub_*` tables
// (`hub_projects`, `hub_sessions`, `hub_events`, `hub_agents`, `hub_crews`, `hub_missions`,
// `hub_artifacts`, `hub_artifact_versions`, `hub_reviews`, `hub_files`, `hub_file_links`,
// `hub_memory`, `hub_session_summaries`) and is the ONLY code in the app that touches them directly
// — mirrors `assistant/repository.ts`'s role for the dock's thread/event tables. Later WPs (the turn
// engine WP1.1, routes WP1.2, missions WP1.7, …) build on top of it rather than querying SQLite
// themselves.
//
// hub_sessions REUSES the Unified-Sessions lifecycle vocabulary VERBATIM (D-AH3/§1.2) — status/
// phase/stopReasonCode/capabilities are the shared `RunStatus`/`RunPhase`/`StopReasonCode`/
// `SessionCapabilities` types, never forked here.
//
// hub_events is APPEND-ONLY with a PER-SESSION monotonic `seq` (R-SES1 — a session's full state must
// be reconstructible from its event log alone). `appendEvent`/`listEvents` are the write/replay pair;
// there is no update/delete for a single event.
//
// SQL lives here (repositories own SQL; services/routes stay thin — see
// .claude/rules/architecture.md). The hub NEVER touches the testing tables (runs/run_steps/
// run_events/suites/grading) — this file doesn't import or reference them.
import { HUB_MISSION_MAX_DEPTH, HUB_MISSION_MAX_TOTAL_AGENTS } from "@mcp-token-footprint/shared";
import { nanoid } from "nanoid";
import type {
  HubActorKind,
  HubAgentRole,
  HubAgentRoleInput,
  HubAgentRolePatch,
  HubArtifact,
  HubArtifactKind,
  HubArtifactVersion,
  HubAutonomyLevel,
  HubBudgets,
  HubCrew,
  HubCrewColor,
  HubCrewInput,
  HubCrewPatch,
  HubEvent,
  HubFile,
  HubFileLink,
  HubFileLinkRole,
  HubFileLinkTarget,
  HubMemory,
  HubMemoryInput,
  HubMemoryKind,
  HubMemoryPatch,
  HubMemoryScope,
  HubMemorySource,
  HubMemoryStatus,
  HubMission,
  HubMissionBudgets,
  HubMissionPlan,
  HubMissionStatus,
  HubProject,
  HubProjectInput,
  HubProjectPatch,
  HubReview,
  HubReviewComment,
  HubReviewStatus,
  HubSession,
  HubSessionCreateInput,
  HubSessionKind,
  HubSessionPatch,
  HubSessionRoster,
  HubSessionSummary,
  HubSkillAttachment,
  HubSkillAttachmentInput,
  HubToolGrants,
  HubTopology,
  RunPhase,
  RunStatus,
  SessionCapabilities,
  StopReasonCode,
} from "@mcp-token-footprint/shared";
import type { AppDatabase } from "../db/database.js";
import type {
  HubAgentRow,
  HubArtifactRow,
  HubArtifactVersionRow,
  HubCrewRow,
  HubEventRow,
  HubFileLinkRow,
  HubFileRow,
  HubMemoryRow,
  HubMissionRow,
  HubProjectRow,
  HubReviewRow,
  HubSessionRow,
  HubSessionSkillRow,
  HubSessionSummaryRow,
} from "../db/rows.js";
import { httpError } from "../utils/errors.js";
import { parseJsonObject, stableStringify } from "../utils/json.js";
import { assertCrewGraphValid } from "./missions/crew-resolution.js";

const DEFAULT_SESSION_TITLE = "New session";
const EMPTY_TOOL_GRANTS: HubToolGrants = { servers: {}, builtins: [] };
const EMPTY_SESSION_ROSTER: HubSessionRoster = { crewIds: [], agentIds: [] };

/** The `hub_memory` row PLUS the v49 scope columns (`scope`/`scope_id`, D-HUX11). Those columns exist in
 *  the DB (migration v49 / baseline schema.ts) but the shared `HubMemoryRow` mirror in `db/rows.ts` is
 *  not this WP's (WP1.5) to edit — `db/*` is done. Extend it locally so the memory reads/writes below are
 *  typed without touching a file sibling WPs also grow. */
type HubScopedMemoryRow = HubMemoryRow & { scope: HubMemoryScope; scope_id: string | null };

/** Fill a skill-attachment INPUT's optional fields with their WP2.4/R-SK8 defaults (`versionMode:
 *  "latest"`, `invocationMode: "model_invocable"`) — mirrors `EMPTY_TOOL_GRANTS`'s "repository does its
 *  own defaulting, doesn't assume the caller's zod layer already ran" convention (routes.ts validates
 *  with `hubSkillAttachmentInputSchema`, which applies the SAME defaults, but tests/other callers may
 *  hit this repository directly). */
function normalizeSkillAttachments(
  skills: readonly HubSkillAttachmentInput[] | undefined,
): HubSkillAttachment[] {
  return (skills ?? []).map((s) => ({
    skillId: s.skillId,
    versionMode: s.versionMode ?? "latest",
    ...(s.versionMode === "pinned" && s.pinnedVersionId
      ? { pinnedVersionId: s.pinnedVersionId }
      : {}),
    invocationMode: s.invocationMode ?? "model_invocable",
  }));
}

/**
 * A freshly-constructed {@link HubEvent} BEFORE the caller stamps `seq`/`at` — the shape handed to
 * {@link HubRepository.appendEvent}. A DISTRIBUTIVE omit over the union (a plain
 * `Omit<HubEvent, "seq" | "at">` would collapse to `{ type }`, dropping every per-variant field —
 * mirrors `AssistantEventInput`'s documented reasoning).
 */
export type HubEventInput = HubEvent extends infer T
  ? T extends unknown
    ? Omit<T, "seq" | "at">
    : never
  : never;

/** Extra fields beyond the wire {@link HubSessionCreateInput} needed to create an `agent` (mission
 *  child) session — never set by the public create-session route, only by the mission orchestrator. */
export type HubSessionCreateOptions = HubSessionCreateInput & {
  kind?: HubSessionKind;
  parentSessionId?: string;
  missionId?: string;
};

/** Engine-owned session-lifecycle transition (mirrors `AssistantRepository.setSessionState`) —
 *  deliberately SEPARATE from {@link HubSessionPatch} (the client-writable title/model/autonomy
 *  fields): no client request can smuggle a lifecycle change through this path. */
export type HubSessionLifecyclePatch = {
  status?: RunStatus;
  phase?: RunPhase | null;
  stopReasonCode?: StopReasonCode | null;
  capabilities?: SessionCapabilities | null;
  budgets?: HubBudgets | null;
  promptVersion?: string | null;
  costUsd?: number;
  tokensIn?: number;
  tokensOut?: number;
  activeDurationMs?: number | null;
  totalDurationMs?: number | null;
  waitDeadlineAt?: string | null;
  endedAt?: string | null;
  seen?: boolean;
};

export type HubMissionCreateInput = {
  sessionId: string;
  topology: HubTopology;
  autonomy: HubAutonomyLevel;
  plan: HubMissionPlan;
  budgets?: HubMissionBudgets;
  // Crew-nesting lineage (D-CN6, v54). All optional — every existing caller passes nothing (a ROOT
  // mission). The recursion engine (WP 2.1) threads these down for a child: `parentMissionId` = the
  // spawning mission, `depth` = parent.depth + 1, `rootMissionId` = the parent's rootMissionId. When
  // omitted, `createMission` treats the row as a root: parent NULL, depth 0, root = its own id.
  parentMissionId?: string;
  depth?: number;
  rootMissionId?: string;
};

export type HubMissionPatch = {
  status?: HubMissionStatus;
  plan?: HubMissionPlan;
  budgets?: HubMissionBudgets | null;
  costUsd?: number;
  agentSessionIds?: string[];
  startedAt?: string | null;
  endedAt?: string | null;
};

export type HubArtifactCreateInput = {
  sessionId?: string | null;
  projectId?: string | null;
  kind: HubArtifactKind;
  title: string;
  content: string;
  note?: string;
  authorKind: HubActorKind;
  authorRef?: string;
};

export type HubArtifactVersionInput = {
  content: string;
  note?: string;
  authorKind: HubActorKind;
  authorRef?: string;
};

export type HubArtifactFilter = { sessionId?: string; projectId?: string };

export type HubReviewCreateInput = {
  artifactId: string;
  baseVersion: number;
  reviewerKind: HubActorKind;
  reviewerRef?: string;
  comments?: HubReviewComment[];
};

export type HubReviewPatch = {
  status?: HubReviewStatus;
  comments?: HubReviewComment[];
};

export type HubFileCreateInput = {
  sha256: string;
  mime: string;
  filename?: string;
  content: Buffer;
};

export type HubFileLinkInput = {
  fileId: string;
  role: HubFileLinkRole;
  targetKind: HubFileLinkTarget;
  targetId: string;
};

export type HubMemoryCreateInput = HubMemoryInput & { source?: HubMemorySource };

export type HubSessionSummaryInput = {
  sessionId: string;
  uptoSeq: number;
  content: string;
  tokens: number;
};

export class HubRepository {
  // Crew nesting (WP1.1, D-CN4/D-CN10) — the author-time crew-graph caps. Optional so existing
  // `new HubRepository(db)` call sites (tests) keep the shared-constant defaults; `index.ts` injects
  // the env-resolved values (`config.hubMissionMaxDepth`/`hubMissionMaxTotalAgents`), honoring D-CN10's
  // depth off-switch at author time.
  constructor(
    private readonly db: AppDatabase,
    private readonly crewCaps: { maxCrewDepth: number; maxTotalAgents: number } = {
      maxCrewDepth: HUB_MISSION_MAX_DEPTH,
      maxTotalAgents: HUB_MISSION_MAX_TOTAL_AGENTS,
    },
  ) {}

  // ── Projects (hub_projects) ──────────────────────────────────────────────────────────────────

  createProject(input: HubProjectInput): HubProject {
    const now = new Date().toISOString();
    const id = nanoid();
    this.db
      .prepare(
        `INSERT INTO hub_projects (id, name, description, instructions, created_at, updated_at, archived_at)
         VALUES (@id, @name, @description, @instructions, @createdAt, @updatedAt, NULL)`,
      )
      .run({
        id,
        name: input.name,
        description: input.description ?? null,
        instructions: input.instructions ?? null,
        createdAt: now,
        updatedAt: now,
      });
    return this.getProject(id);
  }

  getProject(id: string): HubProject {
    return toProject(this.getProjectRow(id));
  }

  listProjects(options: { includeArchived?: boolean } = {}): HubProject[] {
    const clause = options.includeArchived ? "" : "WHERE archived_at IS NULL";
    const rows = this.db
      .prepare(`SELECT * FROM hub_projects ${clause} ORDER BY updated_at DESC, rowid DESC`)
      .all() as HubProjectRow[];
    return rows.map(toProject);
  }

  updateProject(id: string, patch: HubProjectPatch): HubProject {
    const current = this.getProjectRow(id);
    this.db
      .prepare(
        `UPDATE hub_projects
           SET name = @name, description = @description, instructions = @instructions,
               archived_at = @archivedAt, updated_at = @updatedAt
         WHERE id = @id`,
      )
      .run({
        id,
        name: patch.name !== undefined ? patch.name : current.name,
        description: patch.description !== undefined ? patch.description : current.description,
        instructions: patch.instructions !== undefined ? patch.instructions : current.instructions,
        archivedAt:
          patch.archived === undefined
            ? current.archived_at
            : patch.archived
              ? (current.archived_at ?? new Date().toISOString())
              : null,
        updatedAt: new Date().toISOString(),
      });
    return this.getProject(id);
  }

  /** Cascades to sessions/artifacts (`ON DELETE SET NULL` — a project's history is not history to
   *  its own sessions, they just lose the pin). */
  deleteProject(id: string): void {
    const result = this.db.prepare("DELETE FROM hub_projects WHERE id = ?").run(id);
    if (result.changes === 0) throw httpError(404, "Hub project not found");
  }

  // ── Role library (hub_agents, D-AH7) ─────────────────────────────────────────────────────────

  createAgentRole(input: HubAgentRoleInput): HubAgentRole {
    const now = new Date().toISOString();
    const id = nanoid();
    this.db
      .prepare(
        `INSERT INTO hub_agents (
           id, name, display_name, description, icon, system_prompt, default_model, tool_grants_json,
           skill_ids_json, target, expected_outcome, budgets_json, provider_credential_id,
           created_at, updated_at, archived_at
         ) VALUES (
           @id, @name, @displayName, @description, @icon, @systemPrompt, @defaultModel, @toolGrantsJson,
           @skillIdsJson, @target, @expectedOutcome, @budgetsJson, @providerCredentialId,
           @createdAt, @updatedAt, NULL
         )`,
      )
      .run({
        id,
        name: input.name,
        displayName: input.displayName ?? null,
        description: input.description ?? null,
        icon: input.icon ?? null,
        systemPrompt: input.systemPrompt,
        defaultModel: input.defaultModel,
        toolGrantsJson: stableStringify(input.toolGrants ?? EMPTY_TOOL_GRANTS),
        skillIdsJson: stableStringify(normalizeSkillAttachments(input.skills)),
        target: input.target,
        expectedOutcome: input.expectedOutcome,
        budgetsJson: input.budgets ? stableStringify(input.budgets) : null,
        // model-identity WP2.1 (D-MI1) — the credential that owns `defaultModel`. Optional by design: a
        // library agent must remain definable before any credential exists, so absent ⇒ NULL ⇒ unpinned.
        providerCredentialId: input.providerCredentialId ?? null,
        createdAt: now,
        updatedAt: now,
      });
    return this.getAgentRole(id);
  }

  getAgentRole(id: string): HubAgentRole {
    return toAgentRole(this.getAgentRoleRow(id));
  }

  listAgentRoles(options: { includeArchived?: boolean } = {}): HubAgentRole[] {
    const clause = options.includeArchived ? "" : "WHERE archived_at IS NULL";
    const rows = this.db
      .prepare(`SELECT * FROM hub_agents ${clause} ORDER BY name ASC`)
      .all() as HubAgentRow[];
    return rows.map(toAgentRole);
  }

  updateAgentRole(id: string, patch: HubAgentRolePatch): HubAgentRole {
    const current = this.getAgentRoleRow(id);
    this.db
      .prepare(
        `UPDATE hub_agents
           SET name = @name, display_name = @displayName, description = @description, icon = @icon,
               system_prompt = @systemPrompt, default_model = @defaultModel,
               tool_grants_json = @toolGrantsJson, skill_ids_json = @skillIdsJson, target = @target,
               expected_outcome = @expectedOutcome, budgets_json = @budgetsJson,
               provider_credential_id = @providerCredentialId,
               archived_at = @archivedAt, updated_at = @updatedAt
         WHERE id = @id`,
      )
      .run({
        id,
        name: patch.name !== undefined ? patch.name : current.name,
        // `null` clears the persona name back to the role-title (`name`) fallback (D-HUX8).
        displayName: patch.displayName !== undefined ? patch.displayName : current.display_name,
        description: patch.description !== undefined ? patch.description : current.description,
        icon: patch.icon !== undefined ? patch.icon : current.icon,
        systemPrompt: patch.systemPrompt !== undefined ? patch.systemPrompt : current.system_prompt,
        defaultModel: patch.defaultModel !== undefined ? patch.defaultModel : current.default_model,
        toolGrantsJson:
          patch.toolGrants !== undefined
            ? stableStringify(patch.toolGrants)
            : current.tool_grants_json,
        skillIdsJson:
          patch.skills !== undefined
            ? stableStringify(normalizeSkillAttachments(patch.skills))
            : current.skill_ids_json,
        target: patch.target !== undefined ? patch.target : current.target,
        expectedOutcome:
          patch.expectedOutcome !== undefined ? patch.expectedOutcome : current.expected_outcome,
        budgetsJson:
          patch.budgets === undefined
            ? current.budgets_json
            : patch.budgets === null
              ? null
              : stableStringify(patch.budgets),
        // model-identity WP2.1 — same three-way convention as `budgets` above: absent ⇒ unchanged;
        // `null` ⇒ explicitly UNPIN (back to the heuristic); an id ⇒ replace.
        providerCredentialId:
          patch.providerCredentialId === undefined
            ? current.provider_credential_id
            : patch.providerCredentialId,
        archivedAt:
          patch.archived === undefined
            ? current.archived_at
            : patch.archived
              ? (current.archived_at ?? new Date().toISOString())
              : null,
        updatedAt: new Date().toISOString(),
      });
    return this.getAgentRole(id);
  }

  deleteAgentRole(id: string): void {
    const result = this.db.prepare("DELETE FROM hub_agents WHERE id = ?").run(id);
    if (result.changes === 0) throw httpError(404, "Hub agent role not found");
  }

  // ── Crews (hub_crews, D-AH7) ─────────────────────────────────────────────────────────────────

  createCrew(input: HubCrewInput): HubCrew {
    const now = new Date().toISOString();
    const id = nanoid();
    // Author-time crew-graph integrity (D-CN4) — build the substrate from every persisted crew, overlay
    // the pending (not-yet-inserted) crew under its freshly-minted id, and reject a cyclic / missing /
    // over-depth `crewId` member BEFORE the write lands. A create can only reference EXISTING crews so
    // it cannot itself close a cycle, but running the same walk uniformly catches missing/over-depth.
    const crewsById = new Map(this.listCrews().map((crew) => [crew.id, crew] as const));
    crewsById.set(id, {
      id,
      name: input.name,
      description: input.description ?? undefined,
      color: input.color ?? undefined,
      icon: input.icon ?? undefined,
      topology: input.topology,
      members: input.members,
      createdAt: now,
      updatedAt: now,
    });
    assertCrewGraphValid({ rootId: id, crewsById, maxCrewDepth: this.crewCaps.maxCrewDepth });
    this.db
      .prepare(
        `INSERT INTO hub_crews (id, name, description, color, icon, topology, members_json, created_at, updated_at)
         VALUES (@id, @name, @description, @color, @icon, @topology, @membersJson, @createdAt, @updatedAt)`,
      )
      .run({
        id,
        name: input.name,
        description: input.description ?? null,
        color: input.color ?? null,
        icon: input.icon ?? null,
        topology: input.topology,
        membersJson: stableStringify(input.members),
        createdAt: now,
        updatedAt: now,
      });
    return this.getCrew(id);
  }

  getCrew(id: string): HubCrew {
    return toCrew(this.getCrewRow(id));
  }

  listCrews(): HubCrew[] {
    const rows = this.db.prepare("SELECT * FROM hub_crews ORDER BY name ASC").all() as HubCrewRow[];
    return rows.map(toCrew);
  }

  updateCrew(id: string, patch: HubCrewPatch): HubCrew {
    const current = this.getCrewRow(id);
    // Author-time crew-graph integrity (D-CN4) — ONLY a members patch is validated: it REPLACES the
    // whole roster, so validate the full replacement set (not a delta). A name/topology/color-only
    // patch leaves `members` untouched and needs no graph re-check (and must still succeed even if
    // unrelated crews changed since this crew was last saved).
    if (patch.members !== undefined) {
      const crewsById = new Map(this.listCrews().map((crew) => [crew.id, crew] as const));
      crewsById.set(id, { ...toCrew(current), members: patch.members });
      assertCrewGraphValid({ rootId: id, crewsById, maxCrewDepth: this.crewCaps.maxCrewDepth });
    }
    this.db
      .prepare(
        `UPDATE hub_crews
           SET name = @name, description = @description, color = @color, icon = @icon,
               topology = @topology, members_json = @membersJson, updated_at = @updatedAt
         WHERE id = @id`,
      )
      .run({
        id,
        name: patch.name !== undefined ? patch.name : current.name,
        description: patch.description !== undefined ? patch.description : current.description,
        // `null` clears the accent back to no explicit color (D-HUX8).
        color: patch.color !== undefined ? patch.color : current.color,
        // `null` clears the icon back to the default (member-strip / Persona fallback).
        icon: patch.icon !== undefined ? patch.icon : current.icon,
        topology: patch.topology !== undefined ? patch.topology : current.topology,
        membersJson:
          patch.members !== undefined ? stableStringify(patch.members) : current.members_json,
        updatedAt: new Date().toISOString(),
      });
    return this.getCrew(id);
  }

  deleteCrew(id: string): void {
    const result = this.db.prepare("DELETE FROM hub_crews WHERE id = ?").run(id);
    if (result.changes === 0) throw httpError(404, "Hub crew not found");
  }

  // ── Sessions (hub_sessions, §1.2) ────────────────────────────────────────────────────────────

  createSession(input: HubSessionCreateOptions): HubSession {
    const now = new Date().toISOString();
    const id = nanoid();
    this.db
      .prepare(
        `INSERT INTO hub_sessions (
           id, project_id, kind, parent_session_id, mission_id, title, title_state, mode, topology,
           autonomy, crew_id, model, provider_credential_id, status, phase, stop_reason_code,
           capabilities_json, budgets_json,
           prompt_version, tool_scope_json, roster_json, cost_usd, tokens_in, tokens_out,
           active_duration_ms, total_duration_ms, wait_deadline_at, created_at, updated_at, ended_at, seen
         ) VALUES (
           @id, @projectId, @kind, @parentSessionId, @missionId, @title, 'pending', @mode, @topology,
           @autonomy, @crewId, @model, @providerCredentialId, 'pending', NULL, NULL,
           NULL, NULL,
           NULL, @toolScopeJson, @rosterJson, 0, 0, 0,
           NULL, NULL, NULL, @createdAt, @updatedAt, NULL, 0
         )`,
      )
      .run({
        id,
        projectId: input.projectId ?? null,
        kind: input.kind ?? "chat",
        parentSessionId: input.parentSessionId ?? null,
        missionId: input.missionId ?? null,
        title: input.title?.trim() || DEFAULT_SESSION_TITLE,
        mode: input.mode,
        topology: input.topology ?? null,
        autonomy: input.autonomy ?? null,
        crewId: input.crewId ?? null,
        model: input.model,
        // model-identity WP2.1 (D-MI1) — the credential that runs this session's turns. Absent ⇒ NULL ⇒
        // unpinned ⇒ the resolver's unchanged model-name heuristic (exactly how every pre-v55 row reads).
        providerCredentialId: input.providerCredentialId ?? null,
        // End-user UX pass — "scoped" ⇒ persist the picked grants; absent ⇒ NULL ⇒ auto/all-reachable.
        toolScopeJson: input.toolScope ? stableStringify(input.toolScope) : null,
        // End-user UX pass — the Agents & Crews roster (preferred pool for the planner); absent ⇒ NULL.
        rosterJson: input.roster ? stableStringify(input.roster) : null,
        createdAt: now,
        updatedAt: now,
      });
    // End-user UX pass — "Pick" skills: seed the session's attachments at create (the same channel
    // `PUT /api/hub/sessions/:id/skills` uses). Absent/empty ⇒ auto: the full registry is offered.
    if (input.skills && input.skills.length > 0) {
      this.replaceSessionSkills(id, input.skills);
    }
    return this.getSession(id);
  }

  getSession(id: string): HubSession {
    return toSession(this.getSessionRow(id));
  }

  /**
   * `topLevelOnly` (D-HUX4, WP1.4) restricts to root sessions (`parent_session_id IS NULL`) — a
   * mission-agent child is never a legitimate row on the Sessions table (it surfaces via the mission
   * board/audit instead). `includeArchived` (P4) is TRI-STATE and defaults to `undefined` = NO archive
   * filtering — unlike `listAgentRoles`/`listProjects` (which default-EXCLUDE archived), this repository
   * method is also read by `usage.ts`/`audit.ts` (rollups/timelines that must never silently drop an
   * archived session's history) and the startup orphan sweep (`reconcileOrphanHubSessions`, which must
   * catch a `running` session regardless of archive state) — none of those callers pass this filter, so
   * they see unchanged behavior. Only an explicit `includeArchived: false` (the Sessions table's toggle,
   * OFF) excludes archived rows; `true` is equivalent to omitting it (kept for a caller that wants to be
   * explicit). The two correlated subqueries populate the WP1.4 list-stats projection (`turns`/
   * `lastError`, see {@link toSessionWithStats}) — cheap against `idx_hub_events_session_seq` for a
   * local-dev-scale event log.
   */
  listSessions(
    filter: {
      projectId?: string;
      kind?: HubSessionKind;
      topLevelOnly?: boolean;
      includeArchived?: boolean;
    } = {},
  ): HubSession[] {
    const where: string[] = [];
    const params: Record<string, string> = {};
    if (filter.projectId) {
      where.push("s.project_id = @projectId");
      params.projectId = filter.projectId;
    }
    if (filter.kind) {
      where.push("s.kind = @kind");
      params.kind = filter.kind;
    }
    if (filter.topLevelOnly) {
      where.push("s.parent_session_id IS NULL");
    }
    if (filter.includeArchived === false) {
      where.push("s.archived_at IS NULL");
    }
    const clause = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
    const rows = this.db
      .prepare(
        `SELECT s.*,
           (SELECT COUNT(*) FROM hub_events e
              WHERE e.session_id = s.id AND e.type = 'user_message') AS turns,
           (SELECT e2.payload_json FROM hub_events e2
              WHERE e2.session_id = s.id AND e2.type IN ('error', 'limit_error')
              ORDER BY e2.seq DESC LIMIT 1) AS last_error_payload_json
         FROM hub_sessions s ${clause}
         ORDER BY s.updated_at DESC, s.rowid DESC`,
      )
      .all(params) as HubSessionStatsRow[];
    return rows.map(toSessionWithStats);
  }

  /** Sessions parented to a mission (agent children), in creation order. */
  listMissionAgentSessions(missionId: string): HubSession[] {
    const rows = this.db
      .prepare("SELECT * FROM hub_sessions WHERE mission_id = ? ORDER BY created_at ASC")
      .all(missionId) as HubSessionRow[];
    return rows.map(toSession);
  }

  /** Client-writable fields only (title/model/providerCredentialId/autonomy/archived/toolScope/mode —
   *  mirrors
   *  `assistantThreadUpdateSchema`'s discipline: `HubSessionPatch` has no lifecycle fields).
   *  `archived` (D-HUX4, P4) is soft-hide only — sets/clears `archived_at`, exactly like
   *  `updateProject`/`updateAgentRole`'s own archive toggle; there is no hard delete here.
   *  `toolScope` (hub-fixes WP1.2, RC3) kills the write-once trap: absent ⇒ unchanged; `null` ⇒ clear
   *  back to auto (NULL column); a {@link HubToolGrants} object ⇒ replace it — the SAME three-way
   *  undefined/null/value convention `updateAgentRole`'s `budgetsJson` already uses. `mode` (hub-fixes
   *  WP6.2, RC7) is the composer's own mode-chip switch: absent ⇒ unchanged, else replace outright (no
   *  "clear" value — a session always has exactly one mode). The running-mission guard on a
   *  mission<->auto swap is enforced by the CALLER (`routes.ts`'s PATCH handler, which reads the
   *  session/mission BEFORE this write) — this method just persists whatever `patch.mode` says. */
  updateSession(id: string, patch: HubSessionPatch): HubSession {
    const current = this.getSessionRow(id);
    this.db
      .prepare(
        `UPDATE hub_sessions
           SET title = @title, title_state = @titleState, model = @model,
               provider_credential_id = @providerCredentialId, autonomy = @autonomy,
               mode = @mode, tool_scope_json = @toolScopeJson, roster_json = @rosterJson,
               archived_at = @archivedAt, updated_at = @updatedAt
         WHERE id = @id`,
      )
      .run({
        id,
        title: patch.title !== undefined ? patch.title : current.title,
        // A user-set title wins forever (manual is never auto-overwritten, D-AH title lifecycle).
        titleState: patch.title !== undefined ? "manual" : current.title_state,
        model: patch.model !== undefined ? patch.model : current.model,
        // model-identity WP2.1 — re-pin the credential. The SAME three-way convention `toolScope`/`roster`
        // use: absent ⇒ unchanged; `null` ⇒ explicitly UNPIN (back to the heuristic — without this a
        // mis-pinned session could never be corrected); an id ⇒ replace.
        providerCredentialId:
          patch.providerCredentialId === undefined
            ? current.provider_credential_id
            : patch.providerCredentialId,
        autonomy: patch.autonomy !== undefined ? patch.autonomy : current.autonomy,
        mode: patch.mode !== undefined ? patch.mode : current.mode,
        toolScopeJson:
          patch.toolScope === undefined
            ? current.tool_scope_json
            : patch.toolScope === null
              ? null
              : stableStringify(patch.toolScope),
        // Roster edit — same three-way absent/null/value convention as toolScope.
        rosterJson:
          patch.roster === undefined
            ? current.roster_json
            : patch.roster === null
              ? null
              : stableStringify(patch.roster),
        archivedAt:
          patch.archived === undefined
            ? current.archived_at
            : patch.archived
              ? (current.archived_at ?? new Date().toISOString())
              : null,
        updatedAt: new Date().toISOString(),
      });
    return this.getSession(id);
  }

  /** Auto-title lifecycle (deterministic-then-LLM-refine, D-AS26 pattern) — separate from
   *  {@link updateSession} so an auto-title never flips `titleState` to 'manual'. */
  setAutoTitle(id: string, title: string): HubSession {
    this.getSessionRow(id);
    this.db
      .prepare(
        `UPDATE hub_sessions SET title = @title, title_state = 'auto', updated_at = @updatedAt WHERE id = @id`,
      )
      .run({ id, title, updatedAt: new Date().toISOString() });
    return this.getSession(id);
  }

  /** Engine-owned lifecycle transition (mirrors `AssistantRepository.setSessionState`) — the ONLY
   *  path that changes status/phase/stopReasonCode/capabilities/budgets/metering/durations/seen. */
  setSessionLifecycle(id: string, patch: HubSessionLifecyclePatch): HubSession {
    const current = this.getSessionRow(id);
    this.db
      .prepare(
        `UPDATE hub_sessions
           SET status = @status, phase = @phase, stop_reason_code = @stopReasonCode,
               capabilities_json = @capabilitiesJson, budgets_json = @budgetsJson,
               prompt_version = @promptVersion, cost_usd = @costUsd, tokens_in = @tokensIn,
               tokens_out = @tokensOut, active_duration_ms = @activeDurationMs,
               total_duration_ms = @totalDurationMs, wait_deadline_at = @waitDeadlineAt,
               ended_at = @endedAt, seen = @seen, updated_at = @updatedAt
         WHERE id = @id`,
      )
      .run({
        id,
        status: patch.status ?? current.status,
        phase: patch.phase === undefined ? current.phase : patch.phase,
        stopReasonCode:
          patch.stopReasonCode === undefined ? current.stop_reason_code : patch.stopReasonCode,
        capabilitiesJson:
          patch.capabilities === undefined
            ? current.capabilities_json
            : patch.capabilities === null
              ? null
              : stableStringify(patch.capabilities),
        budgetsJson:
          patch.budgets === undefined
            ? current.budgets_json
            : patch.budgets === null
              ? null
              : stableStringify(patch.budgets),
        promptVersion:
          patch.promptVersion === undefined ? current.prompt_version : patch.promptVersion,
        costUsd: patch.costUsd ?? current.cost_usd,
        tokensIn: patch.tokensIn ?? current.tokens_in,
        tokensOut: patch.tokensOut ?? current.tokens_out,
        activeDurationMs:
          patch.activeDurationMs === undefined
            ? current.active_duration_ms
            : patch.activeDurationMs,
        totalDurationMs:
          patch.totalDurationMs === undefined ? current.total_duration_ms : patch.totalDurationMs,
        waitDeadlineAt:
          patch.waitDeadlineAt === undefined ? current.wait_deadline_at : patch.waitDeadlineAt,
        endedAt: patch.endedAt === undefined ? current.ended_at : patch.endedAt,
        seen: patch.seen === undefined ? current.seen : boolToInt(patch.seen),
        updatedAt: new Date().toISOString(),
      });
    return this.getSession(id);
  }

  markSeen(id: string): HubSession {
    return this.setSessionLifecycle(id, { seen: true });
  }

  /** Cascades to hub_events/hub_missions(as parent)/hub_session_summaries/child agent sessions
   *  (all `ON DELETE CASCADE`); artifacts/files pinned to the session are `SET NULL` (they survive). */
  deleteSession(id: string): void {
    const result = this.db.prepare("DELETE FROM hub_sessions WHERE id = ?").run(id);
    if (result.changes === 0) throw httpError(404, "Hub session not found");
  }

  // ── Retention (Wave 4, `POST /api/maintenance/prune-hub`) ──────────────────────────────────────

  /**
   * Root ("chat"-lineage — no `parentSessionId`) sessions last touched before `cutoffIso`, whose OWN
   * status is a settled terminal (`isTerminalStatus`, `testing/run-manager.ts`) — a session mid-turn is
   * NEVER a prune candidate regardless of age. The caller (`retention.ts`) additionally skips any root
   * whose mission (if it started one) hasn't ITSELF reached a terminal status — a mission runs
   * independently of its parent session's own per-turn status (see `missions/orchestrator.ts`), so that
   * check can't be expressed as SQL here.
   */
  listPrunableRootSessionIds(cutoffIso: string): string[] {
    const rows = this.db
      .prepare(
        `SELECT id FROM hub_sessions
           WHERE parent_session_id IS NULL AND updated_at < ?
             AND status IN ('completed','stopped','error','aborted','ended')`,
      )
      .all(cutoffIso) as Array<{ id: string }>;
    return rows.map((row) => row.id);
  }

  /** Every currently-persisted session id (root + mission-agent children) — the orphan workspace-dir
   *  sweep's "still alive" set (a directory for an id NOT in this set is a leftover). */
  listAllSessionIds(): string[] {
    const rows = this.db.prepare("SELECT id FROM hub_sessions").all() as Array<{ id: string }>;
    return rows.map((row) => row.id);
  }

  /** A session's direct children (mission agents) — read BEFORE `deleteSession` cascades their rows
   *  away, so the caller can also sweep their now-orphaned workspace directories (the cascade only
   *  removes DB rows, never touches the filesystem). */
  listChildSessionIds(parentSessionId: string): string[] {
    const rows = this.db
      .prepare("SELECT id FROM hub_sessions WHERE parent_session_id = ?")
      .all(parentSessionId) as Array<{ id: string }>;
    return rows.map((row) => row.id);
  }

  /**
   * Remove `hub_file_links` rows whose polymorphic target (D-AH12's denormalized `target_kind`/
   * `target_id` — no real FK) no longer exists. Only `session`/`project`/`artifact` targets are
   * independently verifiable this way; a `message` target's id lives inside an event payload, not a
   * row, so those links are left alone (a harmless false-negative — never a false-positive delete).
   * Returns the removed count.
   */
  pruneDanglingFileLinks(): number {
    const result = this.db
      .prepare(
        `DELETE FROM hub_file_links
           WHERE (target_kind = 'session' AND target_id NOT IN (SELECT id FROM hub_sessions))
              OR (target_kind = 'project' AND target_id NOT IN (SELECT id FROM hub_projects))
              OR (target_kind = 'artifact' AND target_id NOT IN (SELECT id FROM hub_artifacts))`,
      )
      .run();
    return result.changes;
  }

  /** Delete `hub_files` rows with NO remaining `hub_file_links` row — a fully unreferenced upload
   *  (typically one whose only link was just removed by {@link pruneDanglingFileLinks}). Call AFTER
   *  that pass so a link-orphaned file is caught in the same sweep. Returns the removed count. */
  pruneUnlinkedFiles(): number {
    const result = this.db
      .prepare(
        "DELETE FROM hub_files WHERE id NOT IN (SELECT DISTINCT file_id FROM hub_file_links)",
      )
      .run();
    return result.changes;
  }

  // ── Session skill attachments (hub_session_skills, WP2.4, R-SK1…R-SK3/R-SK8) ───────────────────
  //   Mirrors the Testing feature's `scenario_skills` attach-list exactly: `listSkills`/`replaceSkills`
  //   (delete-then-reinsert on write — there is no per-row update, the whole list is replaced).

  listSessionSkills(sessionId: string): HubSkillAttachment[] {
    const rows = this.db
      .prepare("SELECT * FROM hub_session_skills WHERE session_id = ? ORDER BY skill_id ASC")
      .all(sessionId) as HubSessionSkillRow[];
    return rows.map(toSkillAttachment);
  }

  replaceSessionSkills(
    sessionId: string,
    skills: readonly HubSkillAttachmentInput[],
  ): HubSkillAttachment[] {
    const normalized = normalizeSkillAttachments(skills);
    const transaction = this.db.transaction(() => {
      this.db.prepare("DELETE FROM hub_session_skills WHERE session_id = ?").run(sessionId);
      const insert = this.db.prepare(
        `INSERT INTO hub_session_skills (session_id, skill_id, version_mode, pinned_version_id, invocation_mode)
           VALUES (@sessionId, @skillId, @versionMode, @pinnedVersionId, @invocationMode)`,
      );
      for (const skill of normalized) {
        insert.run({
          sessionId,
          skillId: skill.skillId,
          versionMode: skill.versionMode,
          pinnedVersionId: skill.versionMode === "pinned" ? (skill.pinnedVersionId ?? null) : null,
          invocationMode: skill.invocationMode,
        });
      }
    });
    transaction();
    return this.listSessionSkills(sessionId);
  }

  // ── Events (hub_events, append-only, per-session monotonic seq — R-SES1) ───────────────────────

  /**
   * Append one settled event to a session's replayable log. Stamps a PER-SESSION monotonic `seq`
   * (1, 2, 3…, derived from the current max — the caller never supplies one, so concurrent appends
   * for DIFFERENT sessions never collide) and `at`. There is no update/delete for a single event —
   * only {@link deleteSession} removes events (cascade). Mirrors
   * `AssistantRepository.appendEvent`/`RunManager`'s single emit choke point.
   */
  appendEvent(sessionId: string, event: HubEventInput): HubEvent {
    this.getSessionRow(sessionId); // 404s with a clean message if the session doesn't exist
    const seq = this.nextSeq(sessionId);
    const at = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO hub_events (id, session_id, seq, type, payload_json, created_at)
         VALUES (@id, @sessionId, @seq, @type, @payloadJson, @createdAt)`,
      )
      .run({
        id: nanoid(),
        sessionId,
        seq,
        type: event.type,
        payloadJson: stableStringify(event),
        createdAt: at,
      });
    return { ...event, seq, at } as HubEvent;
  }

  /** Every settled event for a session, ordered by `seq` ascending — the full replay log (R-SES1). */
  listEvents(sessionId: string): HubEvent[] {
    const rows = this.db
      .prepare("SELECT * FROM hub_events WHERE session_id = ? ORDER BY seq ASC")
      .all(sessionId) as HubEventRow[];
    return rows.map(toEvent);
  }

  /**
   * WP4.2 (D-AH13) — a cross-session slice of `hub_events`, filtered to a caller-supplied set of raw
   * event TYPES (`hub/audit.ts` maps its 4 audit kinds to these) and optionally one session id + a
   * `[since, until]` creation-time window. Read-only — a projection, never a mutation of the append-
   * only log. Ordered newest-first (`created_at DESC, rowid DESC` — the latter breaks ties within the
   * same millisecond deterministically, mirroring `listSessions`'s own `updated_at DESC, rowid DESC`).
   * Bounded by `limit`: a local, single-owner dev tool never needs true server-side keyset streaming at
   * this table's scale — the audit SERVICE requests a generous cap, then correlates/filters/paginates
   * the rest in memory (mirrors `reports/digest.ts`'s and `observability/search.ts`'s own `IN (...)`
   * placeholder-list pattern for the type filter).
   */
  listAuditEvents(filter: {
    types: readonly string[];
    sessionId?: string;
    since?: string;
    until?: string;
    limit: number;
  }): (HubEvent & { sessionId: string })[] {
    const typePlaceholders = filter.types.map(() => "?").join(",");
    const where: string[] = [`type IN (${typePlaceholders})`];
    const params: (string | number)[] = [...filter.types];
    if (filter.sessionId) {
      where.push("session_id = ?");
      params.push(filter.sessionId);
    }
    if (filter.since) {
      where.push("created_at >= ?");
      params.push(filter.since);
    }
    if (filter.until) {
      where.push("created_at <= ?");
      params.push(filter.until);
    }
    params.push(filter.limit);
    const rows = this.db
      .prepare(
        `SELECT * FROM hub_events WHERE ${where.join(" AND ")} ORDER BY created_at DESC, rowid DESC LIMIT ?`,
      )
      .all(...params) as HubEventRow[];
    return rows.map((row) => ({ ...toEvent(row), sessionId: row.session_id }));
  }

  private nextSeq(sessionId: string): number {
    const row = this.db
      .prepare("SELECT COALESCE(MAX(seq), 0) AS maxSeq FROM hub_events WHERE session_id = ?")
      .get(sessionId) as { maxSeq: number };
    return row.maxSeq + 1;
  }

  // ── Missions (hub_missions, D-AH6/D-AH8) ────────────────────────────────────────────────────

  createMission(input: HubMissionCreateInput): HubMission {
    const now = new Date().toISOString();
    const id = nanoid();
    this.db
      .prepare(
        `INSERT INTO hub_missions (
           id, session_id, status, topology, autonomy, plan_json, budgets_json, cost_usd,
           agent_session_ids_json, started_at, ended_at, created_at, updated_at,
           parent_mission_id, depth, root_mission_id
         ) VALUES (
           @id, @sessionId, 'proposed', @topology, @autonomy, @planJson, @budgetsJson, 0,
           '[]', NULL, NULL, @createdAt, @updatedAt,
           @parentMissionId, @depth, @rootMissionId
         )`,
      )
      .run({
        id,
        sessionId: input.sessionId,
        topology: input.topology,
        autonomy: input.autonomy,
        planJson: stableStringify(input.plan),
        budgetsJson: input.budgets ? stableStringify(input.budgets) : null,
        createdAt: now,
        updatedAt: now,
        // Crew-nesting lineage (D-CN6). A ROOT (no lineage input) self-references its own id via
        // `root_mission_id`, so a later `WHERE root_mission_id = @root` (getMissionTree) returns the
        // whole tree INCLUDING its root. A child passes the parent's rootMissionId down (WP 2.1).
        parentMissionId: input.parentMissionId ?? null,
        depth: input.depth ?? 0,
        rootMissionId: input.rootMissionId ?? id,
      });
    return this.getMission(id);
  }

  getMission(id: string): HubMission {
    return toMission(this.getMissionRow(id));
  }

  /** A chat session's mission, when it started one (a session hosts at most one — D-AH8). */
  getMissionBySession(sessionId: string): HubMission | undefined {
    const row = this.db
      .prepare("SELECT * FROM hub_missions WHERE session_id = ? ORDER BY created_at DESC LIMIT 1")
      .get(sessionId) as HubMissionRow | undefined;
    return row ? toMission(row) : undefined;
  }

  /** EVERY mission, newest first — no session/project filter. Serves WP4.1 usage aggregates (the
   *  mission breakdown + the R-UX6 plan-acceptance metric) AND Wave 4 boot orphan reconciliation
   *  (`reconcileOrphanHubMissions`). The usage route filters by the parent session's project + a
   *  createdAt range; missions are rare enough that a full scan here is cheap. */
  listMissions(): HubMission[] {
    const rows = this.db
      .prepare("SELECT * FROM hub_missions ORDER BY created_at DESC")
      .all() as HubMissionRow[];
    return rows.map(toMission);
  }

  /** Direct children of a mission (one level down), oldest first — the crew-nesting tree edge
   *  (D-CN6). Missions are rare enough that this full-scan-by-parent needs no index (columns-only
   *  scope; `listMissions` already scans). */
  listChildMissions(parentMissionId: string): HubMission[] {
    const rows = this.db
      .prepare("SELECT * FROM hub_missions WHERE parent_mission_id = ? ORDER BY created_at")
      .all(parentMissionId) as HubMissionRow[];
    return rows.map(toMission);
  }

  /** The WHOLE mission tree rooted at `rootMissionId` (the root + every descendant), ordered by
   *  depth then created_at (D-CN6). The `id = @root OR` arm returns the root even for a legacy
   *  pre-v54 root whose `root_mission_id` is NULL; a v54+ root self-references its own id, so the
   *  `root_mission_id = @root` arm alone already covers it. Callers rebuild the tree from
   *  `parentMissionId`. */
  getMissionTree(rootMissionId: string): HubMission[] {
    const rows = this.db
      .prepare(
        "SELECT * FROM hub_missions WHERE id = @root OR root_mission_id = @root ORDER BY depth, created_at",
      )
      .all({ root: rootMissionId }) as HubMissionRow[];
    return rows.map(toMission);
  }

  updateMission(id: string, patch: HubMissionPatch): HubMission {
    const current = this.getMissionRow(id);
    this.db
      .prepare(
        `UPDATE hub_missions
           SET status = @status, plan_json = @planJson, budgets_json = @budgetsJson,
               cost_usd = @costUsd, agent_session_ids_json = @agentSessionIdsJson,
               started_at = @startedAt, ended_at = @endedAt, updated_at = @updatedAt
         WHERE id = @id`,
      )
      .run({
        id,
        status: patch.status ?? current.status,
        planJson: patch.plan !== undefined ? stableStringify(patch.plan) : current.plan_json,
        budgetsJson:
          patch.budgets === undefined
            ? current.budgets_json
            : patch.budgets === null
              ? null
              : stableStringify(patch.budgets),
        costUsd: patch.costUsd ?? current.cost_usd,
        agentSessionIdsJson:
          patch.agentSessionIds !== undefined
            ? stableStringify(patch.agentSessionIds)
            : current.agent_session_ids_json,
        startedAt: patch.startedAt === undefined ? current.started_at : patch.startedAt,
        endedAt: patch.endedAt === undefined ? current.ended_at : patch.endedAt,
        updatedAt: new Date().toISOString(),
      });
    return this.getMission(id);
  }

  // ── Artifacts + versions (hub_artifacts / hub_artifact_versions, D-AH12) ───────────────────────

  /**
   * Creates the artifact AND its first (version 1) content in one transaction. Inserts the artifact
   * row with `current_version_id = NULL` first, then the version (its `artifact_id` FK now resolves),
   * then repoints `current_version_id` — SQLite's FK enforcement is IMMEDIATE per statement (not
   * deferred to commit) unless a constraint is declared `DEFERRABLE INITIALLY DEFERRED`, which these
   * aren't, so inserting `current_version_id` before the version row exists would fail
   * `FOREIGN KEY constraint failed` even inside a transaction.
   */
  createArtifact(input: HubArtifactCreateInput): HubArtifact {
    const now = new Date().toISOString();
    const artifactId = nanoid();
    const versionId = nanoid();
    const run = this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO hub_artifacts (
             id, session_id, project_id, kind, title, latest_version, current_version_id, created_at, updated_at
           ) VALUES (@id, @sessionId, @projectId, @kind, @title, 1, NULL, @createdAt, @updatedAt)`,
        )
        .run({
          id: artifactId,
          sessionId: input.sessionId ?? null,
          projectId: input.projectId ?? null,
          kind: input.kind,
          title: input.title,
          createdAt: now,
          updatedAt: now,
        });
      this.db
        .prepare(
          `INSERT INTO hub_artifact_versions (id, artifact_id, version, content, note, author_kind, author_ref, created_at)
           VALUES (@id, @artifactId, 1, @content, @note, @authorKind, @authorRef, @createdAt)`,
        )
        .run({
          id: versionId,
          artifactId,
          content: input.content,
          note: input.note ?? null,
          authorKind: input.authorKind,
          authorRef: input.authorRef ?? null,
          createdAt: now,
        });
      this.db
        .prepare("UPDATE hub_artifacts SET current_version_id = @versionId WHERE id = @artifactId")
        .run({ versionId, artifactId });
    });
    run();
    return this.getArtifact(artifactId);
  }

  getArtifact(id: string): HubArtifact {
    return toArtifact(this.getArtifactRow(id));
  }

  listArtifacts(filter: HubArtifactFilter = {}): HubArtifact[] {
    const where: string[] = [];
    const params: Record<string, string> = {};
    if (filter.sessionId) {
      where.push("session_id = @sessionId");
      params.sessionId = filter.sessionId;
    }
    if (filter.projectId) {
      where.push("project_id = @projectId");
      params.projectId = filter.projectId;
    }
    const clause = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
    const rows = this.db
      .prepare(`SELECT * FROM hub_artifacts ${clause} ORDER BY updated_at DESC, rowid DESC`)
      .all(params) as HubArtifactRow[];
    return rows.map(toArtifact);
  }

  /** Appends a new IMMUTABLE version, bumps `latest_version`, and repoints `current_version_id`. */
  addArtifactVersion(artifactId: string, input: HubArtifactVersionInput): HubArtifactVersion {
    const artifact = this.getArtifactRow(artifactId);
    const version = artifact.latest_version + 1;
    const id = nanoid();
    const now = new Date().toISOString();
    const run = this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO hub_artifact_versions (id, artifact_id, version, content, note, author_kind, author_ref, created_at)
           VALUES (@id, @artifactId, @version, @content, @note, @authorKind, @authorRef, @createdAt)`,
        )
        .run({
          id,
          artifactId,
          version,
          content: input.content,
          note: input.note ?? null,
          authorKind: input.authorKind,
          authorRef: input.authorRef ?? null,
          createdAt: now,
        });
      this.db
        .prepare(
          `UPDATE hub_artifacts SET latest_version = @version, current_version_id = @id, updated_at = @updatedAt WHERE id = @artifactId`,
        )
        .run({ artifactId, version, id, updatedAt: now });
    });
    run();
    return this.getArtifactVersion(id);
  }

  getArtifactVersion(id: string): HubArtifactVersion {
    const row = this.db.prepare("SELECT * FROM hub_artifact_versions WHERE id = ?").get(id) as
      | HubArtifactVersionRow
      | undefined;
    if (!row) throw httpError(404, "Hub artifact version not found");
    return toArtifactVersion(row);
  }

  listArtifactVersions(artifactId: string): HubArtifactVersion[] {
    const rows = this.db
      .prepare("SELECT * FROM hub_artifact_versions WHERE artifact_id = ? ORDER BY version ASC")
      .all(artifactId) as HubArtifactVersionRow[];
    return rows.map(toArtifactVersion);
  }

  /** Cascades to hub_artifact_versions/hub_reviews (`ON DELETE CASCADE`). */
  deleteArtifact(id: string): void {
    const result = this.db.prepare("DELETE FROM hub_artifacts WHERE id = ?").run(id);
    if (result.changes === 0) throw httpError(404, "Hub artifact not found");
  }

  // ── Reviews (hub_reviews, D-AH12) ───────────────────────────────────────────────────────────

  createReview(input: HubReviewCreateInput): HubReview {
    const now = new Date().toISOString();
    const id = nanoid();
    this.db
      .prepare(
        `INSERT INTO hub_reviews (
           id, artifact_id, base_version, status, reviewer_kind, reviewer_ref, comments_json, created_at, updated_at
         ) VALUES (@id, @artifactId, @baseVersion, 'open', @reviewerKind, @reviewerRef, @commentsJson, @createdAt, @updatedAt)`,
      )
      .run({
        id,
        artifactId: input.artifactId,
        baseVersion: input.baseVersion,
        reviewerKind: input.reviewerKind,
        reviewerRef: input.reviewerRef ?? null,
        commentsJson: stableStringify(input.comments ?? []),
        createdAt: now,
        updatedAt: now,
      });
    return this.getReview(id);
  }

  getReview(id: string): HubReview {
    return toReview(this.getReviewRow(id));
  }

  listReviews(artifactId: string): HubReview[] {
    const rows = this.db
      .prepare("SELECT * FROM hub_reviews WHERE artifact_id = ? ORDER BY created_at ASC")
      .all(artifactId) as HubReviewRow[];
    return rows.map(toReview);
  }

  updateReview(id: string, patch: HubReviewPatch): HubReview {
    const current = this.getReviewRow(id);
    this.db
      .prepare(
        `UPDATE hub_reviews SET status = @status, comments_json = @commentsJson, updated_at = @updatedAt WHERE id = @id`,
      )
      .run({
        id,
        status: patch.status ?? current.status,
        commentsJson:
          patch.comments !== undefined ? stableStringify(patch.comments) : current.comments_json,
        updatedAt: new Date().toISOString(),
      });
    return this.getReview(id);
  }

  /** Set one comment's decision in place (accept/reject a suggestion) — a thin convenience over
   *  {@link updateReview} so callers don't have to round-trip the whole comments array by hand. */
  decideReviewComment(
    reviewId: string,
    commentId: string,
    decision: HubReviewComment["decision"],
  ): HubReview {
    const current = this.getReviewRow(reviewId);
    const comments = parseJsonObject<HubReviewComment[]>(current.comments_json, []);
    const found = comments.find((c) => c.id === commentId);
    if (!found) throw httpError(404, "Hub review comment not found");
    found.decision = decision;
    return this.updateReview(reviewId, { comments });
  }

  // ── Files + links (hub_files / hub_file_links, D-AH12) ──────────────────────────────────────

  createFile(input: HubFileCreateInput): HubFile {
    const now = new Date().toISOString();
    const id = nanoid();
    this.db
      .prepare(
        `INSERT INTO hub_files (id, sha256, mime, bytes, filename, content, created_at)
         VALUES (@id, @sha256, @mime, @bytes, @filename, @content, @createdAt)`,
      )
      .run({
        id,
        sha256: input.sha256,
        mime: input.mime,
        bytes: input.content.byteLength,
        filename: input.filename ?? null,
        content: input.content,
        createdAt: now,
      });
    return this.getFile(id);
  }

  getFile(id: string): HubFile {
    return toFile(this.getFileRow(id));
  }

  /** The raw bytes — kept SEPARATE from {@link getFile} so ordinary listing/metadata reads never
   *  pull a blob into memory. */
  getFileContent(id: string): Buffer {
    return this.getFileRow(id).content;
  }

  listFiles(): HubFile[] {
    const rows = this.db
      .prepare(
        "SELECT id, sha256, mime, bytes, filename, created_at FROM hub_files ORDER BY created_at DESC",
      )
      .all() as Array<Omit<HubFileRow, "content">>;
    return rows.map((row) => ({
      id: row.id,
      sha256: row.sha256,
      mime: row.mime,
      bytes: row.bytes,
      filename: row.filename ?? undefined,
      createdAt: row.created_at,
    }));
  }

  deleteFile(id: string): void {
    const result = this.db.prepare("DELETE FROM hub_files WHERE id = ?").run(id);
    if (result.changes === 0) throw httpError(404, "Hub file not found");
  }

  linkFile(input: HubFileLinkInput): HubFileLink {
    this.getFileRow(input.fileId); // 404s if the file doesn't exist
    const now = new Date().toISOString();
    const id = nanoid();
    this.db
      .prepare(
        `INSERT INTO hub_file_links (id, file_id, role, target_kind, target_id, created_at)
         VALUES (@id, @fileId, @role, @targetKind, @targetId, @createdAt)`,
      )
      .run({
        id,
        fileId: input.fileId,
        role: input.role,
        targetKind: input.targetKind,
        targetId: input.targetId,
        createdAt: now,
      });
    return toFileLink(
      this.db.prepare("SELECT * FROM hub_file_links WHERE id = ?").get(id) as HubFileLinkRow,
    );
  }

  listFileLinksForTarget(targetKind: HubFileLinkTarget, targetId: string): HubFileLink[] {
    const rows = this.db
      .prepare(
        "SELECT * FROM hub_file_links WHERE target_kind = ? AND target_id = ? ORDER BY created_at ASC",
      )
      .all(targetKind, targetId) as HubFileLinkRow[];
    return rows.map(toFileLink);
  }

  listFileLinksForFile(fileId: string): HubFileLink[] {
    const rows = this.db
      .prepare("SELECT * FROM hub_file_links WHERE file_id = ? ORDER BY created_at ASC")
      .all(fileId) as HubFileLinkRow[];
    return rows.map(toFileLink);
  }

  unlinkFile(linkId: string): void {
    const result = this.db.prepare("DELETE FROM hub_file_links WHERE id = ?").run(linkId);
    if (result.changes === 0) throw httpError(404, "Hub file link not found");
  }

  // ── Memory (hub_memory, D-AH11) ─────────────────────────────────────────────────────────────

  createMemory(input: HubMemoryCreateInput): HubMemory {
    const now = new Date().toISOString();
    const id = nanoid();
    const source = input.source ?? "user";
    // WP1.5 (D-HUX11) — resolve + guard the scope: `profile` (default) has no owner; a `project`/`crew`/
    // `agent` scope requires a `scopeId` naming an EXISTING owning entity (else 400/404).
    const { scope, scopeId } = this.resolveMemoryScope(input.scope, input.scopeId);
    this.db
      .prepare(
        `INSERT INTO hub_memory (id, kind, content, source, status, scope, scope_id, created_at, updated_at)
         VALUES (@id, @kind, @content, @source, @status, @scope, @scopeId, @createdAt, @updatedAt)`,
      )
      .run({
        id,
        kind: input.kind,
        content: input.content,
        source,
        // The assistant may only PROPOSE — never write silently (D-AH11); a user-authored row is
        // active immediately.
        status: source === "assistant_proposed" ? "proposed" : "active",
        scope,
        scopeId,
        createdAt: now,
        updatedAt: now,
      });
    return this.getMemory(id);
  }

  /**
   * WP1.5 (D-HUX11) — normalize + validate a memory write's scope. `profile` (or an omitted scope) is
   * global and carries NO owner (a `scopeId` on it is a client bug → 400). A `project`/`crew`/`agent`
   * scope REQUIRES a `scopeId` (400 if absent) naming an existing owning entity (404 via the row lookups
   * if it doesn't exist). The entity guard keeps a scoped memory from ever pointing at a phantom owner.
   */
  private resolveMemoryScope(
    scope: HubMemoryScope | undefined,
    scopeId: string | undefined,
  ): { scope: HubMemoryScope; scopeId: string | null } {
    const resolved = scope ?? "profile";
    if (resolved === "profile") {
      if (scopeId)
        throw httpError(400, "Profile-scoped memory has no owner (`scopeId` must be omitted).");
      return { scope: "profile", scopeId: null };
    }
    if (!scopeId) {
      throw httpError(
        400,
        `A ${resolved}-scoped memory requires a \`scopeId\` (the owning ${resolved} id).`,
      );
    }
    if (resolved === "project")
      this.getProjectRow(scopeId); // 404 "Hub project not found" if unknown
    else if (resolved === "crew")
      this.getCrewRow(scopeId); // 404 "Hub crew not found" if unknown
    else this.getAgentRoleRow(scopeId); // agent — 404 "Hub agent role not found" if unknown
    return { scope: resolved, scopeId };
  }

  getMemory(id: string): HubMemory {
    return toMemory(this.getMemoryRow(id));
  }

  /** List memory rows. WP1.5 (D-HUX11) adds the `scope`/`scopeId` filters the resolver uses to pull one
   *  layer at a time (`scope:"project", scopeId:<id>` etc.); an omitted `scope` still returns ALL scopes,
   *  so existing callers (`{ status:"active" }` in the turn engine + context inspector) are unchanged. */
  listMemory(
    filter: {
      status?: HubMemoryStatus;
      kind?: HubMemoryKind;
      scope?: HubMemoryScope;
      scopeId?: string;
    } = {},
  ): HubMemory[] {
    const where: string[] = [];
    const params: Record<string, string> = {};
    if (filter.status) {
      where.push("status = @status");
      params.status = filter.status;
    }
    if (filter.kind) {
      where.push("kind = @kind");
      params.kind = filter.kind;
    }
    if (filter.scope) {
      where.push("scope = @scope");
      params.scope = filter.scope;
    }
    if (filter.scopeId !== undefined) {
      where.push("scope_id = @scopeId");
      params.scopeId = filter.scopeId;
    }
    const clause = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
    const rows = this.db
      .prepare(`SELECT * FROM hub_memory ${clause} ORDER BY updated_at DESC, rowid DESC`)
      .all(params) as HubScopedMemoryRow[];
    return rows.map(toMemory);
  }

  /**
   * WP2.7 (D-HUX11) — a patch MAY also move the row to a different scope: the save-proposal's scope
   * picker (`MemoryProposalChip`) lets the owner override the model's default owner before accepting,
   * and the standalone manage surface (`ScopedMemoryList`) lets them re-home a row later. Only touches
   * scope/scope_id when the patch actually names one (`patch.scope`/`patch.scopeId` !== undefined) —
   * an ordinary content/status-only patch (every pre-WP2.7 caller) leaves the row's scope untouched.
   * Reuses the SAME entity guard the create path uses (`resolveMemoryScope`) so a moved row can never
   * point at a phantom/mismatched owner.
   */
  updateMemory(id: string, patch: HubMemoryPatch): HubMemory {
    const current = this.getMemoryRow(id);
    const movingScope = patch.scope !== undefined || patch.scopeId !== undefined;
    const { scope, scopeId } = movingScope
      ? this.resolveMemoryScope(patch.scope ?? current.scope, patch.scopeId)
      : { scope: current.scope, scopeId: current.scope_id };
    this.db
      .prepare(
        `UPDATE hub_memory SET content = @content, status = @status, scope = @scope, scope_id = @scopeId, updated_at = @updatedAt WHERE id = @id`,
      )
      .run({
        id,
        content: patch.content !== undefined ? patch.content : current.content,
        status: patch.status !== undefined ? patch.status : current.status,
        scope,
        scopeId,
        updatedAt: new Date().toISOString(),
      });
    return this.getMemory(id);
  }

  deleteMemory(id: string): void {
    const result = this.db.prepare("DELETE FROM hub_memory WHERE id = ?").run(id);
    if (result.changes === 0) throw httpError(404, "Hub memory row not found");
  }

  // ── Session summaries (hub_session_summaries, D-AH11(b)) ────────────────────────────────────

  createSessionSummary(input: HubSessionSummaryInput): HubSessionSummary {
    const now = new Date().toISOString();
    const id = nanoid();
    this.db
      .prepare(
        `INSERT INTO hub_session_summaries (id, session_id, upto_seq, content, tokens, created_at)
         VALUES (@id, @sessionId, @uptoSeq, @content, @tokens, @createdAt)`,
      )
      .run({
        id,
        sessionId: input.sessionId,
        uptoSeq: input.uptoSeq,
        content: input.content,
        tokens: input.tokens,
        createdAt: now,
      });
    return toSessionSummary(
      this.db
        .prepare("SELECT * FROM hub_session_summaries WHERE id = ?")
        .get(id) as HubSessionSummaryRow,
    );
  }

  listSessionSummaries(sessionId: string): HubSessionSummary[] {
    const rows = this.db
      .prepare("SELECT * FROM hub_session_summaries WHERE session_id = ? ORDER BY upto_seq ASC")
      .all(sessionId) as HubSessionSummaryRow[];
    return rows.map(toSessionSummary);
  }

  getLatestSessionSummary(sessionId: string): HubSessionSummary | undefined {
    const row = this.db
      .prepare(
        "SELECT * FROM hub_session_summaries WHERE session_id = ? ORDER BY upto_seq DESC LIMIT 1",
      )
      .get(sessionId) as HubSessionSummaryRow | undefined;
    return row ? toSessionSummary(row) : undefined;
  }

  // ── Row lookups (private) ───────────────────────────────────────────────────────────────────

  private getProjectRow(id: string): HubProjectRow {
    const row = this.db.prepare("SELECT * FROM hub_projects WHERE id = ?").get(id) as
      | HubProjectRow
      | undefined;
    if (!row) throw httpError(404, "Hub project not found");
    return row;
  }

  private getAgentRoleRow(id: string): HubAgentRow {
    const row = this.db.prepare("SELECT * FROM hub_agents WHERE id = ?").get(id) as
      | HubAgentRow
      | undefined;
    if (!row) throw httpError(404, "Hub agent role not found");
    return row;
  }

  private getCrewRow(id: string): HubCrewRow {
    const row = this.db.prepare("SELECT * FROM hub_crews WHERE id = ?").get(id) as
      | HubCrewRow
      | undefined;
    if (!row) throw httpError(404, "Hub crew not found");
    return row;
  }

  private getSessionRow(id: string): HubSessionRow {
    const row = this.db.prepare("SELECT * FROM hub_sessions WHERE id = ?").get(id) as
      | HubSessionRow
      | undefined;
    if (!row) throw httpError(404, "Hub session not found");
    return row;
  }

  private getMissionRow(id: string): HubMissionRow {
    const row = this.db.prepare("SELECT * FROM hub_missions WHERE id = ?").get(id) as
      | HubMissionRow
      | undefined;
    if (!row) throw httpError(404, "Hub mission not found");
    return row;
  }

  private getArtifactRow(id: string): HubArtifactRow {
    const row = this.db.prepare("SELECT * FROM hub_artifacts WHERE id = ?").get(id) as
      | HubArtifactRow
      | undefined;
    if (!row) throw httpError(404, "Hub artifact not found");
    return row;
  }

  private getReviewRow(id: string): HubReviewRow {
    const row = this.db.prepare("SELECT * FROM hub_reviews WHERE id = ?").get(id) as
      | HubReviewRow
      | undefined;
    if (!row) throw httpError(404, "Hub review not found");
    return row;
  }

  private getFileRow(id: string): HubFileRow {
    const row = this.db.prepare("SELECT * FROM hub_files WHERE id = ?").get(id) as
      | HubFileRow
      | undefined;
    if (!row) throw httpError(404, "Hub file not found");
    return row;
  }

  private getMemoryRow(id: string): HubScopedMemoryRow {
    const row = this.db.prepare("SELECT * FROM hub_memory WHERE id = ?").get(id) as
      | HubScopedMemoryRow
      | undefined;
    if (!row) throw httpError(404, "Hub memory row not found");
    return row;
  }
}

// ── Row → wire mapping ───────────────────────────────────────────────────────────────────────────

function toProject(row: HubProjectRow): HubProject {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    instructions: row.instructions,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    archivedAt: row.archived_at,
  };
}

function toAgentRole(row: HubAgentRow): HubAgentRole {
  return {
    id: row.id,
    name: row.name,
    // WP1.7 (D-HUX8/P2) — optional persona name; NULL (old/unset rows) omits the field, and the web
    // side falls back to `name` (the role title). The avatar reuses `icon` below, not a new field.
    displayName: row.display_name ?? undefined,
    description: row.description ?? undefined,
    icon: row.icon ?? undefined,
    systemPrompt: row.system_prompt,
    defaultModel: row.default_model,
    // model-identity WP2.1 (D-MI1) — the credential that owns `defaultModel`. NULL is a MEANINGFUL wire
    // value here ("unpinned ⇒ heuristic"), so it is projected as `null` rather than omitted (mirrors the
    // `HubAgentRole.providerCredentialId?: … | null` wire type).
    providerCredentialId: row.provider_credential_id,
    toolGrants: parseJsonObject<HubToolGrants>(row.tool_grants_json, EMPTY_TOOL_GRANTS),
    skills: parseJsonObject<HubSkillAttachment[]>(row.skill_ids_json, []),
    target: row.target,
    expectedOutcome: row.expected_outcome,
    budgets: row.budgets_json ? parseJsonObject<HubBudgets>(row.budgets_json, {}) : undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    archivedAt: row.archived_at,
  };
}

function toSkillAttachment(row: HubSessionSkillRow): HubSkillAttachment {
  const attachment: HubSkillAttachment = {
    skillId: row.skill_id,
    versionMode: row.version_mode,
    invocationMode: row.invocation_mode,
  };
  if (row.version_mode === "pinned" && row.pinned_version_id) {
    attachment.pinnedVersionId = row.pinned_version_id;
  }
  return attachment;
}

function toCrew(row: HubCrewRow): HubCrew {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? undefined,
    // WP1.7 (D-HUX8) — optional `chart-1`..`chart-5` accent; NULL (old/unset rows) omits the field
    // (no explicit accent). The column is unchecked at the DB layer on an upgraded (v49-migrated) DB,
    // so the cast trusts the app-layer `hubCrewColorSchema` validation on every write.
    color: (row.color as HubCrewColor | null) ?? undefined,
    // Optional avatar icon (owner request) — NULL (old/unset rows) omits the field. Unchecked at the
    // DB layer (nullable TEXT); the app-layer `HUB_ICON_MAX_LENGTH` zod bound validates every write.
    icon: row.icon ?? undefined,
    topology: row.topology as HubTopology,
    members: parseJsonObject(row.members_json, []),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toSession(row: HubSessionRow): HubSession {
  return {
    id: row.id,
    projectId: row.project_id,
    kind: row.kind,
    parentSessionId: row.parent_session_id,
    missionId: row.mission_id,
    title: row.title,
    titleState: row.title_state,
    mode: row.mode,
    topology: (row.topology ?? undefined) as HubSession["topology"],
    autonomy: (row.autonomy ?? undefined) as HubSession["autonomy"],
    crewId: row.crew_id,
    model: row.model,
    // model-identity WP2.1 (D-MI1) — exposed on the READ wire so the UI can show the TRUE provider (and
    // warn when it is unpinned) instead of re-deriving it from the model name. `null` ⇒ unpinned.
    providerCredentialId: row.provider_credential_id,
    status: row.status as RunStatus,
    phase: (row.phase ?? undefined) as RunPhase | undefined,
    stopReasonCode: (row.stop_reason_code ?? undefined) as StopReasonCode | undefined,
    capabilities: row.capabilities_json
      ? parseJsonObject<SessionCapabilities>(row.capabilities_json, undefined as never)
      : undefined,
    budgets: row.budgets_json ? parseJsonObject<HubBudgets>(row.budgets_json, {}) : undefined,
    promptVersion: row.prompt_version ?? undefined,
    // End-user UX pass — the MCP tool scope (null column ⇒ auto/all-reachable, the field is omitted).
    toolScope: row.tool_scope_json
      ? parseJsonObject<HubToolGrants>(row.tool_scope_json, EMPTY_TOOL_GRANTS)
      : null,
    // End-user UX pass — the Agents & Crews roster (null column ⇒ none). Preferred pool for the planner.
    roster: row.roster_json
      ? parseJsonObject<HubSessionRoster>(row.roster_json, EMPTY_SESSION_ROSTER)
      : null,
    costUsd: row.cost_usd,
    tokensIn: row.tokens_in,
    tokensOut: row.tokens_out,
    activeDurationMs: row.active_duration_ms ?? undefined,
    totalDurationMs: row.total_duration_ms ?? undefined,
    waitDeadlineAt: row.wait_deadline_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    endedAt: row.ended_at,
    seen: row.seen === 1,
    // WP1.4 (D-HUX4, P4) — projects the raw timestamp column into the boolean wire flag (mirrors
    // `HubProject`/`HubAgentRole`'s own archived-flag-from-archived_at-column shape).
    archived: row.archived_at !== null,
  };
}

/** {@link HubSessionRow} plus the two WP1.4 (D-HUX4) list-stats columns `listSessions`'s correlated
 *  subqueries add — never a real table shape, just what that one query returns. */
type HubSessionStatsRow = HubSessionRow & {
  turns: number;
  last_error_payload_json: string | null;
};

/** Parses the `last_error_payload_json` correlated-subquery column (a raw `HubErrorEvent`/
 *  `HubLimitErrorEvent` JSON blob, or `null` when the session has no error/limit_error event) into the
 *  wire's `lastError` string. Malformed JSON (should never happen — `appendEvent` always writes valid
 *  `stableStringify` output) degrades to `undefined` rather than throwing, matching every other
 *  best-effort read path in this file. */
function parseLastErrorMessage(payloadJson: string | null): string | undefined {
  if (!payloadJson) return undefined;
  try {
    const parsed = JSON.parse(payloadJson) as { message?: unknown };
    return typeof parsed.message === "string" ? parsed.message : undefined;
  } catch {
    return undefined;
  }
}

/** {@link toSession} plus the WP1.4 (D-HUX4) `turns`/`lastError` list-stats fields — the Sessions
 *  table's own projection (`HubRepository.listSessions`). */
function toSessionWithStats(row: HubSessionStatsRow): HubSession {
  return {
    ...toSession(row),
    turns: row.turns,
    lastError: parseLastErrorMessage(row.last_error_payload_json),
  };
}

function toMission(row: HubMissionRow): HubMission {
  return {
    id: row.id,
    sessionId: row.session_id,
    status: row.status as HubMissionStatus,
    topology: row.topology as HubTopology,
    autonomy: row.autonomy as HubAutonomyLevel,
    plan: parseJsonObject<HubMissionPlan>(row.plan_json, {
      topology: row.topology as HubTopology,
      autonomy: row.autonomy as HubAutonomyLevel,
      agents: [],
    }),
    budgets: row.budgets_json
      ? parseJsonObject<HubMissionBudgets>(row.budgets_json, {})
      : undefined,
    costUsd: row.cost_usd,
    agentSessionIds: parseJsonObject<string[]>(row.agent_session_ids_json, []),
    startedAt: row.started_at,
    endedAt: row.ended_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    // Crew-nesting lineage on the wire (D-CN5/D-CN6): ROOT ⇒ parent NULL ⇒ undefined; depth is 0 on a
    // root or a legacy (migrated) row. `root_mission_id` is DB-internal and deliberately NOT surfaced.
    parentMissionId: row.parent_mission_id ?? undefined,
    depth: row.depth,
  };
}

/**
 * The stored payload is the event input itself (minus `seq`/`at`, which live in their own columns)
 * — reconstruct it as-is and overlay the row's `seq`/`created_at`. Mirrors
 * `assistant/repository.ts`'s `toEvent`.
 */
function toEvent(row: HubEventRow): HubEvent {
  const parsed = parseJsonObject<Record<string, unknown>>(row.payload_json, { type: row.type });
  return { ...parsed, seq: row.seq, at: row.created_at } as HubEvent;
}

function toArtifact(row: HubArtifactRow): HubArtifact {
  return {
    id: row.id,
    sessionId: row.session_id,
    projectId: row.project_id,
    kind: row.kind,
    title: row.title,
    latestVersion: row.latest_version,
    currentVersionId: row.current_version_id ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toArtifactVersion(row: HubArtifactVersionRow): HubArtifactVersion {
  return {
    id: row.id,
    artifactId: row.artifact_id,
    version: row.version,
    content: row.content,
    note: row.note ?? undefined,
    authorKind: row.author_kind,
    authorRef: row.author_ref ?? undefined,
    createdAt: row.created_at,
  };
}

function toReview(row: HubReviewRow): HubReview {
  return {
    id: row.id,
    artifactId: row.artifact_id,
    baseVersion: row.base_version,
    status: row.status,
    reviewerKind: row.reviewer_kind,
    reviewerRef: row.reviewer_ref ?? undefined,
    comments: parseJsonObject<HubReviewComment[]>(row.comments_json, []),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toFile(row: HubFileRow): HubFile {
  return {
    id: row.id,
    sha256: row.sha256,
    mime: row.mime,
    bytes: row.bytes,
    filename: row.filename ?? undefined,
    createdAt: row.created_at,
  };
}

function toFileLink(row: HubFileLinkRow): HubFileLink {
  return {
    id: row.id,
    fileId: row.file_id,
    role: row.role,
    targetKind: row.target_kind,
    targetId: row.target_id,
    createdAt: row.created_at,
  };
}

function toMemory(row: HubScopedMemoryRow): HubMemory {
  return {
    id: row.id,
    kind: row.kind,
    content: row.content,
    source: row.source,
    status: row.status,
    // WP1.5 (D-HUX11) — a pre-scope row reads back `scope:"profile"` (the DB DEFAULT), `scopeId:null`.
    scope: row.scope,
    scopeId: row.scope_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toSessionSummary(row: HubSessionSummaryRow): HubSessionSummary {
  return {
    id: row.id,
    sessionId: row.session_id,
    uptoSeq: row.upto_seq,
    content: row.content,
    tokens: row.tokens,
    createdAt: row.created_at,
  };
}

function boolToInt(value: boolean): number {
  return value ? 1 : 0;
}
