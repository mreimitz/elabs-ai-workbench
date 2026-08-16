import type {
  AllowedSkill,
  NormalizedToolDefinition,
  Scenario,
  ScenarioInput,
  SuiteVariant,
  TokenProfileRef,
} from "@mcp-token-footprint/shared";
import type { ProviderRepository } from "../providers/repository.js";
import type { ScanRepository } from "../scans/repository.js";
import type { SkillRepository } from "../skills/repository.js";
import { httpError } from "../utils/errors.js";
import type { ResolvedSkill } from "./skill-context.js";
import type { ScenarioRepository } from "./scenario-repository.js";
import { resolveSystemPrompt, unionProfiles } from "./resolution.js";

export type ResolvedAllowedTools = {
  serverId: string;
  tools: NormalizedToolDefinition[];
};

/** The variant skill-override shape (WP 5.1) — a subset of {@link SuiteVariant} reused as an argument. */
export type SkillOverrides = SuiteVariant["skillOverrides"];

export class ScenarioService {
  constructor(
    private readonly scenarios: ScenarioRepository,
    private readonly scans: ScanRepository,
    /**
     * Skill registry — used by {@link resolveAllowedSkills} to resolve a scenario's attached skills to
     * concrete versions + files at run time. Optional so existing callers/tests that only exercise
     * server/tool resolution keep working; when absent, `resolveAllowedSkills` returns `[]`.
     */
    private readonly skills?: SkillRepository,
    /**
     * Qlik Answers (WP 1.4, D-QA6 layer 1 — write-time) — used ONLY to look up a scenario's provider
     * KIND so `create`/`update` can reject a `qlik_answers` scenario that still carries MCP servers or
     * skills. `ProviderRepository.get` is the CHEAP path: it reads the redacted row (kind/label/etc.)
     * without decrypting the API key, so this check never touches a secret. Optional so existing
     * callers/tests that don't exercise this kind keep working unchanged; when absent, no kind-aware
     * check runs (production always wires it — see `index.ts`).
     */
    private readonly providers?: ProviderRepository,
  ) {}

  list(): Scenario[] {
    return this.scenarios.list();
  }

  get(id: string): Scenario {
    return this.scenarios.get(id);
  }

  create(input: ScenarioInput): Scenario {
    this.assertCleanSession(input);
    return this.scenarios.create(input);
  }

  update(id: string, input: ScenarioInput): Scenario {
    this.assertCleanSession(input);
    return this.scenarios.update(id, input);
  }

  delete(id: string): void {
    this.scenarios.delete(id);
  }

  /**
   * Effective tool set for a scenario. For each scenario_servers row, take the server's most
   * recently scanned tools and intersect with the per-tool allow-list (`allowedTools`; `null` =
   * all of the server's tools). Returns one entry per allow-listed server. Consumed by the run
   * engine (WP 1.3).
   */
  resolveAllowedTools(scenarioId: string): ResolvedAllowedTools[] {
    const scenario = this.scenarios.get(scenarioId);
    return scenario.allowedServers.map((allowed) => {
      const scanned = this.scannedTools(allowed.serverId);
      const tools =
        allowed.allowedTools === null
          ? scanned
          : scanned.filter((tool) => allowed.allowedTools?.includes(tool.name));
      return { serverId: allowed.serverId, tools };
    });
  }

  /**
   * Resolve a scenario's attached skills to concrete, immutable versions (mirrors
   * {@link resolveAllowedTools} for the skills story). For each `AllowedSkill`:
   *   - `latest` → the skill's `currentVersionId` **at run time** (a scenario tracking latest picks up
   *     a freshly pulled version).
   *   - `pinned` → the fixed `pinnedVersionId` (reproducible forever).
   * Loads the resolved {@link SkillVersion} + its files + manifest + level tokens + the SKILL.md body.
   *
   * A skill or version that no longer exists (deleted, or `latest` with no version yet) is skipped
   * gracefully — the run proceeds with whatever skills still resolve, never throwing.
   *
   * WP 5.1 (skill-effect variants) — an optional {@link SkillOverrides} tweaks the scenario's base
   * attachments BEFORE resolution: `detach` drops a skill, `attach` adds (or re-pins) one to a specific
   * version / `latest`. The scenario row is NEVER mutated — the merge is in-memory, per resolution (a
   * suite variant's override lives only in the suite-run config snapshot). Existing callers pass no
   * overrides and get the unchanged base behavior.
   */
  resolveAllowedSkills(scenarioId: string, overrides?: SkillOverrides): ResolvedSkill[] {
    if (!this.skills) return [];
    const scenario = this.scenarios.get(scenarioId);
    const attachments = applySkillOverrides(scenario.allowedSkills, overrides);
    const resolved: ResolvedSkill[] = [];

    for (const allowed of attachments) {
      try {
        const skill = this.skills.getPublic(allowed.skillId);
        const versionId =
          allowed.versionMode === "pinned" ? allowed.pinnedVersionId : skill.currentVersionId;
        if (!versionId) continue; // latest with no current version yet, or pinned with none → skip.

        const version = this.skills.getVersion(versionId);
        // Defensive: a pinned version id that belongs to a different skill is ignored.
        if (version.skillId !== allowed.skillId) continue;

        const files = this.skills.listFiles(versionId);
        const skillMdFile = files.find((f) => f.isSkillMd);
        const skillMdBody = skillMdFile ? this.readSkillMdBody(versionId, skillMdFile.path) : "";

        resolved.push({
          skillId: skill.id,
          name: skill.name,
          description: version.manifest.description || skill.description || "",
          versionId,
          versionLabel: version.versionLabel,
          version,
          manifest: version.manifest,
          files,
          skillMdBody,
          // WP 2.3 — carry the attachment's eager flag through to the run engine.
          eager: allowed.eager ?? false,
        });
      } catch {
        // Skill/version deleted or otherwise unreadable → skip it gracefully.
        continue;
      }
    }

    return resolved;
  }

  // Read the SKILL.md body text for the resolved version (empty string if binary/absent/unreadable).
  private readSkillMdBody(versionId: string, path: string): string {
    if (!this.skills) return "";
    try {
      const content = this.skills.getFileContent(versionId, path);
      return content.isBinary ? "" : content.text;
    } catch {
      return "";
    }
  }

  // Pull the latest scan's tools for a server and adapt them to NormalizedToolDefinition. A server
  // with no successful scan yet contributes no tools.
  private scannedTools(serverId: string): NormalizedToolDefinition[] {
    const latest = this.scans.getLatestForServer(serverId);
    if (!latest) return [];
    return latest.tools.map((tool) => ({
      name: tool.toolName,
      description: tool.description,
      inputSchema: tool.inputSchema,
      annotations: tool.annotations,
      raw: tool.rawTool,
    }));
  }

  /**
   * Qlik Answers (WP 1.4, D-QA6 layer 1 — write-time) — reject a scenario whose provider is
   * `qlik_answers` if it carries any MCP servers or skills. An environment with zero servers/skills is
   * already the norm (`allowedServers`/`allowedSkills` default `[]`); this only forbids the OPPOSITE
   * for this kind — the Answers API is a RAG product endpoint, not an agent loop, so it structurally
   * cannot attach tools or skills (see `roadmap/research/qlik-answers-as-model.md` §5). A no-op when
   * `providers` isn't wired, when the arrays are already empty, or when the referenced provider doesn't
   * (yet) resolve — an unknown `providerId` is the repository's own concern (its own validation/FK
   * surfaces that honestly); this check only ever ADDS a rejection, never masks an unrelated one.
   */
  private assertCleanSession(input: ScenarioInput): void {
    if (!this.providers) return;
    if (input.allowedServers.length === 0 && input.allowedSkills.length === 0) return;
    let kind: string;
    try {
      kind = this.providers.get(input.providerId).kind;
    } catch {
      return;
    }
    if (kind !== "qlik_answers") return;
    throw httpError(
      400,
      "A Qlik Answers environment can't have MCP servers or skills attached — it's a RAG product endpoint, not an agent loop.",
    );
  }
}

/**
 * WP 5.1 — apply a variant's skill overrides to a scenario's base attachments, producing the effective
 * {@link AllowedSkill} list WITHOUT mutating the scenario. `detach` removes matching skills; `attach`
 * adds a skill (or re-pins an already-attached one) to a specific version id (or `latest`). Re-attaching
 * an already-present skill preserves its base `eager` flag (only the version/mode changes). Pure —
 * exported so it (and the resolution it feeds) can be unit-tested against fixture attachments.
 */
export function applySkillOverrides(
  base: AllowedSkill[],
  overrides?: SkillOverrides,
): AllowedSkill[] {
  if (!overrides || (!overrides.attach?.length && !overrides.detach?.length)) return base;
  const detach = new Set(overrides.detach ?? []);
  const attach = overrides.attach ?? [];
  const attachIds = new Set(attach.map((a) => a.skillId));
  const baseById = new Map(base.map((a) => [a.skillId, a]));
  // Keep base attachments that are neither detached nor re-attached (attach overrides the base pin).
  const kept = base.filter((a) => !detach.has(a.skillId) && !attachIds.has(a.skillId));
  const added: AllowedSkill[] = attach.map((a) => {
    const eager = baseById.get(a.skillId)?.eager ?? false;
    return a.versionId === "latest"
      ? { skillId: a.skillId, versionMode: "latest", eager }
      : { skillId: a.skillId, versionMode: "pinned", pinnedVersionId: a.versionId, eager };
  });
  return [...kept, ...added];
}

/**
 * WP 5.1 — validate that every skill/version a variant's `attach` overrides reference STILL EXISTS,
 * throwing a typed 400 otherwise. Called at RUN START (per run in the run service, and up-front for the
 * whole matrix in the suite orchestrator) so a variant referencing a deleted skill fails fast — never
 * mid-suite. `detach` needs no validation (dropping an absent skill is a harmless no-op). A `latest`
 * attach requires the skill to have a current version to track; a pinned attach requires that exact
 * version to exist and belong to the named skill.
 */
export function assertSkillOverridesResolvable(
  skills: SkillRepository,
  overrides: SkillOverrides | undefined,
  variantLabel?: string,
): void {
  for (const a of overrides?.attach ?? []) {
    let skill: ReturnType<SkillRepository["getPublic"]>;
    try {
      skill = skills.getPublic(a.skillId);
    } catch {
      throw httpError(
        400,
        variantContext(variantLabel, `references skill "${a.skillId}", which no longer exists`),
      );
    }
    if (a.versionId === "latest") {
      if (!skill.currentVersionId) {
        throw httpError(
          400,
          variantContext(
            variantLabel,
            `attaches skill "${a.skillId}" with no current version to track`,
          ),
        );
      }
      continue;
    }
    let version: ReturnType<SkillRepository["getVersion"]>;
    try {
      version = skills.getVersion(a.versionId);
    } catch {
      throw httpError(
        400,
        variantContext(
          variantLabel,
          `references skill version "${a.versionId}", which no longer exists`,
        ),
      );
    }
    if (version.skillId !== a.skillId) {
      throw httpError(
        400,
        variantContext(
          variantLabel,
          `pins version "${a.versionId}" that belongs to a different skill`,
        ),
      );
    }
  }
}

function variantContext(variantLabel: string | undefined, message: string): string {
  return variantLabel ? `Variant "${variantLabel}" ${message}` : `Skill override ${message}`;
}

// Re-export the pure resolution helpers so consumers can import them from the service module too.
export { resolveSystemPrompt, unionProfiles };
export type { TokenProfileRef };
