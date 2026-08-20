import type { SkillFileNode, SkillManifest, SkillVersion } from "@mcp-token-footprint/shared";
import { jsonSchema, tool, type Tool, type ToolExecutionOptions } from "ai";
import type { StepSink } from "./tool-bridge.js";

/**
 * WP 2.2 — faithful skill-context injection for the run engine.
 *
 * How a real product loads a skill (see `planning/Research/RS-02-skill-registry/notes/11-skill-loading-in-real-products.md`):
 *
 *   - **L1 (metadata) — always.** The `name` + `description` + an on-disk `location` of every attached
 *     skill is injected into the system prompt up front, as the `<available_skills>` block (the
 *     agentskills.io `skills-ref` XML shape). This is the true always-on context cost.
 *   - **L2/L3 — on demand.** The model reads `SKILL.md` (L2) and resource files (L3) via a read-only
 *     disclosure tool when it judges the skill relevant. Metered like an MCP `tools/call`.
 *   - **Eager (optional).** A per-attachment toggle that additionally inlines the full `SKILL.md` body
 *     up front (a deliberate worst-case comparison). Off by default (the faithful model).
 *
 * The app **NEVER executes** skill content. The disclosure tool only returns file *contents* — there is
 * no script-execution path anywhere in this module (this preserves the Phase-1 non-goal).
 */

/**
 * One attached skill resolved to a concrete, immutable version + its files + the SKILL.md body. Built
 * by {@link import("./scenario-service.js").ScenarioService.resolveAllowedSkills} at run time (so a
 * `latest`-mode attachment picks up a freshly pulled version; a `pinned` one stays reproducible).
 */
export type ResolvedSkill = {
  /** The owning skill's id (the scenario attachment key). */
  skillId: string;
  /** The skill's stable name (used in the `<available_skills>` block + the `skill://` location). */
  name: string;
  /** The skill's description (the L1 metadata surfaced to the model). */
  description: string;
  /** The resolved version's id (used to read files through the repository). */
  versionId: string;
  /** Human-facing version label (e.g. `v3`) — used in the synthetic `skill://name@version` location. */
  versionLabel: string;
  /** The resolved {@link SkillVersion} record (manifest + L1/L2/L3 level token subtotals). */
  version: SkillVersion;
  /** The skill's manifest (frontmatter). */
  manifest: SkillManifest;
  /** The version's flat file list (the disclosure tool's read surface). */
  files: SkillFileNode[];
  /** The SKILL.md body text (empty string when the version has none). Inlined only when eager. */
  skillMdBody: string;
  /**
   * WP 2.3 — the attachment's eager flag. When true, the run's L1 block additionally inlines this
   * skill's full SKILL.md body (L2) up front. The run service builds the `eagerIds` set for
   * {@link buildAvailableSkillsBlock} from this field.
   */
  eager: boolean;
};

/** Options shaping the L1 block build. */
export type AvailableSkillsBlockOptions = {
  /**
   * The set of skill ids marked **eager**. For an eager skill the block additionally inlines the full
   * SKILL.md body (L2) up front. Off by default → an empty/omitted set is the faithful model.
   */
  eagerIds?: ReadonlySet<string>;
};

/** The synthetic on-disk location the model sees for a skill's SKILL.md (the `skills-ref` shape). */
export function skillLocation(skill: ResolvedSkill): string {
  return `skill://${skill.name}@${skill.versionLabel}/SKILL.md`;
}

/**
 * Build the `<available_skills>` L1 block for all attached skills and (when eager) inline their SKILL.md
 * bodies. Returns the string to PREPEND to the run's system prompt. An empty resolved list returns `""`
 * so a scenario with no skills is byte-for-byte unchanged.
 *
 * Shape (per skill), matching the agentskills.io `skills-ref` `to-prompt` output verbatim:
 * ```xml
 * <available_skills>
 *   <skill>
 *     <name>pdf-processing</name>
 *     <description>Extract PDF text, fill forms, merge…</description>
 *     <location>skill://pdf-processing@v5/SKILL.md</location>
 *   </skill>
 * </available_skills>
 * ```
 * When a skill is eager, an `<eager_skill name="…">…SKILL.md body…</eager_skill>` block is appended
 * after the listing so the full L2 body is resident in the prompt up front.
 */
export function buildAvailableSkillsBlock(
  resolved: ResolvedSkill[],
  options: AvailableSkillsBlockOptions = {},
): string {
  if (resolved.length === 0) return "";
  const eagerIds = options.eagerIds ?? new Set<string>();

  const entries = resolved
    .map((skill) => {
      return [
        "  <skill>",
        `    <name>${escapeXml(skill.name)}</name>`,
        `    <description>${escapeXml(skill.description)}</description>`,
        `    <location>${escapeXml(skillLocation(skill))}</location>`,
        "  </skill>",
      ].join("\n");
    })
    .join("\n");

  const listing = `<available_skills>\n${entries}\n</available_skills>`;

  // Eager: additionally inline each eager skill's full SKILL.md body (L2) up front.
  const eager = resolved
    .filter((skill) => eagerIds.has(skill.skillId) && skill.skillMdBody.length > 0)
    .map(
      (skill) =>
        `<eager_skill name="${escapeXml(skill.name)}" location="${escapeXml(skillLocation(skill))}">\n${skill.skillMdBody}\n</eager_skill>`,
    );

  return [listing, ...eager].join("\n\n");
}

/** The read-only disclosure tool names registered in the agent loop (never any execute/run tool). */
export const READ_SKILL_FILE_TOOL = "read_skill_file";
export const LIST_SKILL_FILES_TOOL = "list_skill_files";

/**
 * A read-only file reader over the resolved skill versions — the seam the disclosure tools call. The
 * run service backs this with {@link import("../skills/repository.js").SkillRepository} (`listFiles` /
 * `getFileContent`). It ONLY reads; there is deliberately no method that executes anything.
 */
export type SkillFileReader = {
  /** List a version's files (posix paths + metadata). */
  listFiles(versionId: string): SkillFileNode[];
  /**
   * Read one text file's contents from a version. Binary files return `{ isBinary: true }` (no text) —
   * the model gets a note, not raw bytes. Throws if the file is absent.
   */
  readTextFile(
    versionId: string,
    path: string,
  ): { path: string; text: string } | { path: string; isBinary: true; size: number };
};

/** The result the `read_skill_file` tool returns to the model (contents only — never an execution). */
type ReadSkillFileResult =
  | { skill: string; path: string; contents: string }
  | { skill: string; path: string; isBinary: true; size: number; note: string }
  | { error: string };

/** The result the `list_skill_files` tool returns (the per-skill file listing). */
type ListSkillFilesResult = {
  skills: Array<{
    skill: string;
    version: string;
    files: Array<{ path: string; kind: string; tokens: number; binary: boolean }>;
  }>;
};

/**
 * Build the read-only skill-disclosure tools (`list_skill_files` + `read_skill_file`) for the resolved
 * skills, metered EXACTLY like an MCP `tools/call` (each call flows a {@link StepSink.toolCall} outcome
 * so its request/response token + byte cost lands in the run's accounting — the *realized* L2/L3 cost).
 *
 * Path guarding: a read is only served for `{skill, path}` where `skill` is an attached, resolved skill
 * and `path` is a file that actually exists in that skill's resolved version. Traversal (`..`, absolute
 * paths) and unknown skills are refused with an `{ error }` result (never a throw that fails the run,
 * and never a filesystem access outside the attached version).
 *
 * SECURITY INVARIANT: these tools NEVER execute skill content — they return file contents only. There
 * is no code path here that spawns, evals, or runs `scripts/*`.
 */
export function buildSkillDisclosureTools(
  resolved: ResolvedSkill[],
  reader: SkillFileReader,
  sink: StepSink,
): Record<string, Tool> {
  if (resolved.length === 0) return {};

  const byName = new Map<string, ResolvedSkill>();
  for (const skill of resolved) byName.set(skill.name, skill);

  const listExecute = async (
    args: unknown,
    options: ToolExecutionOptions<unknown>,
  ): Promise<ListSkillFilesResult> => {
    const startedAt = new Date().toISOString();
    const started = performance.now();
    const result: ListSkillFilesResult = {
      skills: resolved.map((skill) => ({
        skill: skill.name,
        version: skill.versionLabel,
        files: skill.files.map((f) => ({
          path: f.path,
          kind: f.kind,
          tokens: f.tokenTotal,
          binary: f.isBinary,
        })),
      })),
    };
    await meter(sink, {
      skillId: "*",
      toolName: LIST_SKILL_FILES_TOOL,
      args: (args ?? {}) as Record<string, unknown>,
      result,
      isError: false,
      startedAt,
      started,
      toolCallId: options?.toolCallId,
    });
    return result;
  };

  const readExecute = async (
    args: unknown,
    options: ToolExecutionOptions<unknown>,
  ): Promise<ReadSkillFileResult> => {
    const startedAt = new Date().toISOString();
    const started = performance.now();
    const input = (args ?? {}) as { skill?: unknown; path?: unknown };
    const outcome = resolveRead(byName, reader, input);
    await meter(sink, {
      skillId: outcome.skillId,
      toolName: READ_SKILL_FILE_TOOL,
      args: (args ?? {}) as Record<string, unknown>,
      result: outcome.result,
      isError: "error" in outcome.result,
      startedAt,
      started,
      toolCallId: options?.toolCallId,
    });
    return outcome.result;
  };

  return {
    [LIST_SKILL_FILES_TOOL]: tool({
      description:
        "List the files inside the skills attached to this run (read-only). Returns each skill's file paths, kinds, and token sizes. Does not read contents and never executes anything.",
      inputSchema: jsonSchema({ type: "object", properties: {}, additionalProperties: false }),
      execute: listExecute,
    }),
    [READ_SKILL_FILE_TOOL]: tool({
      description:
        "Read the CONTENTS of one file inside an attached skill (read-only, e.g. its SKILL.md or a reference file). Provide `skill` (the skill name) and `path` (the file path within that skill). Returns text only — it never runs scripts or executes anything.",
      inputSchema: jsonSchema({
        type: "object",
        properties: {
          skill: {
            type: "string",
            description: "The attached skill's name (from <available_skills>).",
          },
          path: { type: "string", description: "The file path within the skill (e.g. SKILL.md)." },
        },
        required: ["skill", "path"],
        additionalProperties: false,
      }),
      execute: readExecute,
    }),
  };
}

/** Resolve a `read_skill_file` call against the attached skills, guarding the skill + path. */
function resolveRead(
  byName: Map<string, ResolvedSkill>,
  reader: SkillFileReader,
  input: { skill?: unknown; path?: unknown },
): { skillId: string; result: ReadSkillFileResult } {
  const skillName = typeof input.skill === "string" ? input.skill : "";
  const rawPath = typeof input.path === "string" ? input.path : "";
  const skill = byName.get(skillName);
  if (!skill) {
    return { skillId: "*", result: { error: `No attached skill named "${skillName}".` } };
  }
  if (!isSafeRelativePath(rawPath)) {
    return {
      skillId: skill.skillId,
      result: {
        error: `Invalid path "${rawPath}" (must be a relative file within the skill, no traversal).`,
      },
    };
  }
  // Guard: only files that ACTUALLY EXIST in the resolved version are readable (no fs escape).
  const known = skill.files.some((f) => f.path === rawPath);
  if (!known) {
    return {
      skillId: skill.skillId,
      result: { error: `File "${rawPath}" is not part of skill "${skillName}".` },
    };
  }
  try {
    const file = reader.readTextFile(skill.versionId, rawPath);
    if ("isBinary" in file) {
      return {
        skillId: skill.skillId,
        result: {
          skill: skill.name,
          path: rawPath,
          isBinary: true,
          size: file.size,
          note: "Binary file — contents omitted (this tool reads text only and never executes files).",
        },
      };
    }
    return {
      skillId: skill.skillId,
      result: { skill: skill.name, path: rawPath, contents: file.text },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { skillId: skill.skillId, result: { error: `Could not read "${rawPath}": ${message}` } };
  }
}

/**
 * A path is safe iff it is a relative, non-empty, traversal-free posix path. Rejects absolute paths,
 * `..` segments, and backslashes. (The existence check in {@link resolveRead} is the second guard: even
 * a syntactically safe path is only served when it is a real file in the attached version.)
 */
function isSafeRelativePath(path: string): boolean {
  if (!path || path.length === 0) return false;
  if (path.startsWith("/") || path.includes("\\")) return false;
  if (path.includes("\0")) return false;
  const segments = path.split("/");
  return segments.every((segment) => segment !== "" && segment !== "." && segment !== "..");
}

/**
 * Meter one disclosure call through the same {@link StepSink} the MCP tool bridge uses, so its
 * request/response tokens + bytes land in the run's context accounting exactly like a `tools/call`.
 * The synthetic `serverId` (`skill://<skillId>`) tags the step as a skill-disclosure read.
 */
async function meter(
  sink: StepSink,
  args: {
    skillId: string;
    toolName: string;
    args: Record<string, unknown>;
    result: unknown;
    isError: boolean;
    startedAt: string;
    started: number;
    toolCallId?: string;
  },
): Promise<void> {
  const durationMs = performance.now() - args.started;
  const endedAt = new Date().toISOString();
  await sink.toolCall({
    serverId: `skill://${args.skillId}`,
    toolName: args.toolName,
    args: args.args,
    durationMs,
    startedAt: args.startedAt,
    endedAt,
    result: args.result as Record<string, unknown>,
    isError: args.isError,
    ...(args.toolCallId ? { toolCallId: args.toolCallId } : {}),
  });
}

/** Minimal XML text escaping for the `<available_skills>` block (name/description/location are text). */
function escapeXml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
