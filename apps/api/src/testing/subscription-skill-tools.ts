// Claude subscription skill wiring (roadmap/claude-subscription/, WP 1.4, D-CS9 — the skills half).
//
// Skills DO work on the subscription path (unlike qlik_answers' structural clean-session invariant).
// Each of the run's attached skills is resolved (`ScenarioService.resolveAllowedSkills`, the SAME
// resolution the AI-SDK path uses) and MATERIALIZED READ-ONLY into the run's throwaway workspace (a
// `skills/` subtree — see `claude-subscription-executor.ts`'s `materializeSkillWorkspace`), then served
// to the model through a tiny in-process MCP server built on the Agent SDK's OWN `createSdkMcpServer`/
// `tool()` (the SAME mechanism `apps/api/src/assistant/tools/index.ts` uses for the assistant's read
// toolset) exposing `list_skill_files` / `read_skill_file`. Behaviorally this mirrors
// `skill-context.ts`'s AI-SDK-path disclosure tools byte-for-byte (same read-only guard, same
// binary-omission note, same "list every attached skill" shape) — it is a SEPARATE implementation only
// because the `ai` package's `Tool` shape (`skill-context.ts`) is incompatible with the Agent SDK's own
// `SdkMcpToolDefinition` shape this executor's `mcpServers` seam needs.
//
// WHY an in-process MCP tool and not the SDK's native `Skill` tool / `.claude/skills` discovery: the
// subscription executor unconditionally disallows the native `Read`/`Glob`/`Grep`/`Bash` built-ins
// (`SUBSCRIPTION_DISALLOWED_TOOLS`) as a blanket filesystem/exec sandbox for the WHOLE run — not merely
// to keep a skill's own scripts from running. The SDK's public skill-loading contract documents L2/L3
// resource files as "reachable via Read/Bash" (installed `@anthropic-ai/claude-agent-sdk@0.3.206`
// `sdk.d.ts`, `Options.skills`), so native discovery would either need Read re-enabled (widening that
// sandbox for the WHOLE run, not just skills — a materially different, unverifiable risk) or would
// silently degrade L2/L3 access with no way to verify it against a stubbed driver (the live SDK's skill
// loading is owner-acceptance only, exactly like WP 1.3's live MCP behavior). The disclosure-tool
// alternative the plan explicitly sanctions is deterministic, reuses a battle-tested pattern, is fully
// exercised by a stub driver in tests, and is metered by the executor's EXISTING generic tool-result
// accounting (`createToolResultMeter` in `claude-subscription-executor.ts`) — no bespoke accounting here.
//
// SECURITY INVARIANT (never executed): `materializeSkills` only WRITES files (best-effort read-only
// chmod) — nothing here spawns, evals, or runs any skill content, script or otherwise. The
// `read_skill_file` tool only ever returns file TEXT; there is no execute path anywhere in this module.
import fs from "node:fs/promises";
import path from "node:path";
import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { ResolvedSkill } from "./skill-context.js";
import { toolPattern } from "./subscription-tools.js";

/** The `mcpServers` map key for the skill-disclosure in-process server (`mcp__skills__<tool>`). */
export const SUBSCRIPTION_SKILLS_MCP_KEY = "skills";
export const LIST_SKILL_FILES_TOOL = "list_skill_files";
export const READ_SKILL_FILE_TOOL = "read_skill_file";

/** The `mcp__skills__{list_skill_files,read_skill_file}` allow patterns for the skills server. */
export function subscriptionSkillToolPatterns(): string[] {
  return [
    toolPattern(SUBSCRIPTION_SKILLS_MCP_KEY, LIST_SKILL_FILES_TOOL),
    toolPattern(SUBSCRIPTION_SKILLS_MCP_KEY, READ_SKILL_FILE_TOOL),
  ];
}

/**
 * Reads a resolved skill version's RAW file bytes (binary-safe — unlike the AI-SDK path's text-only
 * `SkillFileReader` in `skill-context.ts`, materialization needs every file's actual bytes). The run
 * service supplies a thin adapter over its `SkillRepository`; kept as a narrow DI seam (mirroring every
 * other seam in `claude-subscription-executor.ts`) so this module never depends on the skills registry
 * directly and a test can inject an in-memory stub with NO database.
 */
export type SkillFileBytesReader = {
  getFileBytes(versionId: string, filePath: string): { bytes: Buffer; isBinary: boolean };
};

/** A path is safe iff it is a relative, non-empty, traversal-free posix path (mirrors `skill-context.ts`'s guard). */
function isSafeRelativePath(value: string): boolean {
  if (!value || value.length === 0) return false;
  if (value.startsWith("/") || value.includes("\\")) return false;
  if (value.includes("\0")) return false;
  const segments = value.split("/");
  return segments.every((segment) => segment !== "" && segment !== "." && segment !== "..");
}

/** `<skillsDir>/<skillId>/<posix file path>` — the on-disk location one resolved skill's files live under. */
function skillFileAbsPath(skillsDir: string, skillId: string, filePath: string): string {
  return path.join(skillsDir, skillId, ...filePath.split("/"));
}

/**
 * Materialize every resolved skill's files, READ-ONLY, under `skillsDir/<skillId>/<file.path>`. Only
 * WRITES bytes to disk — nothing here executes anything (the never-execute invariant is preserved by
 * construction: there is no code path that spawns/evals a written file). `chmod 0o444` is best-effort
 * (swallowed on failure — some filesystems/sandboxes don't honor it, and a run must never fail over a
 * chmod). A file whose path fails the traversal guard is skipped defensively (every path here already
 * comes from a resolved `SkillFileNode`, so this should never trigger in practice). A per-file read
 * failure (a corrupted blob) is likewise skipped rather than failing the whole run — the model then sees
 * that one file is simply absent, an honest degradation consistent with `resolveAllowedSkills` itself
 * skipping an unreadable skill/version.
 */
export async function materializeSkills(
  skillsDir: string,
  resolved: readonly ResolvedSkill[],
  reader: SkillFileBytesReader,
): Promise<void> {
  for (const skill of resolved) {
    for (const file of skill.files) {
      if (!isSafeRelativePath(file.path)) continue;
      try {
        const { bytes } = reader.getFileBytes(skill.versionId, file.path);
        const abs = skillFileAbsPath(skillsDir, skill.skillId, file.path);
        await fs.mkdir(path.dirname(abs), { recursive: true });
        await fs.writeFile(abs, bytes);
        await fs.chmod(abs, 0o444).catch(() => {});
      } catch {
        // Unreadable blob for this one file — skip it (never fail the run over one bad file).
      }
    }
  }
}

/** The `list_skill_files` result shape — identical to `skill-context.ts`'s AI-SDK-path equivalent. */
type ListSkillFilesResult = {
  skills: Array<{
    skill: string;
    version: string;
    files: Array<{ path: string; kind: string; tokens: number; binary: boolean }>;
  }>;
};

/** The `read_skill_file` result shape — identical to `skill-context.ts`'s AI-SDK-path equivalent. */
type ReadSkillFileResult =
  | { skill: string; path: string; contents: string }
  | { skill: string; path: string; isBinary: true; size: number; note: string }
  | { error: string };

function jsonResult(value: unknown, isError = false): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(value) }], ...(isError ? { isError } : {}) };
}

function listSkillFilesResult(resolved: readonly ResolvedSkill[]): ListSkillFilesResult {
  return {
    skills: resolved.map((skill) => ({
      skill: skill.name,
      version: skill.versionLabel,
      files: skill.files.map((f) => ({ path: f.path, kind: f.kind, tokens: f.tokenTotal, binary: f.isBinary })),
    })),
  };
}

/**
 * Resolve one `read_skill_file` call against the MATERIALIZED files on disk (never the DB — the
 * executor's whole point is that the child only ever sees the workspace's own `skills/` subtree).
 * Guards: an unknown skill name, an unsafe/traversal path, or a path not part of the resolved skill's
 * known file list all refuse with `{error}` (never a throw). A binary file's contents are never inlined
 * — only a note, mirroring `skill-context.ts`'s AI-SDK-path behavior exactly.
 */
async function readSkillFile(
  skillsDir: string,
  byName: ReadonlyMap<string, ResolvedSkill>,
  skillName: string,
  rawPath: string,
): Promise<ReadSkillFileResult> {
  const skill = byName.get(skillName);
  if (!skill) return { error: `No attached skill named "${skillName}".` };
  if (!isSafeRelativePath(rawPath)) {
    return { error: `Invalid path "${rawPath}" (must be a relative file within the skill, no traversal).` };
  }
  const file = skill.files.find((f) => f.path === rawPath);
  if (!file) return { error: `File "${rawPath}" is not part of skill "${skillName}".` };
  if (file.isBinary) {
    return {
      skill: skill.name,
      path: rawPath,
      isBinary: true,
      size: file.size,
      note: "Binary file — contents omitted (this tool reads text only and never executes files).",
    };
  }
  try {
    const text = await fs.readFile(skillFileAbsPath(skillsDir, skill.skillId, rawPath), "utf8");
    return { skill: skill.name, path: rawPath, contents: text };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { error: `Could not read "${rawPath}": ${message}` };
  }
}

/**
 * Build the Agent-SDK-native skill-disclosure tool definitions (exported separately from
 * {@link buildSubscriptionSkillToolServer} so a test can invoke `.handler` directly without going
 * through the SDK's MCP transport — mirrors `skill-context.test.ts`'s direct `execute()` calls against
 * `buildSkillDisclosureTools`).
 */
export function buildSubscriptionSkillToolDefinitions(
  skillsDir: string,
  resolved: readonly ResolvedSkill[],
) {
  const byName = new Map(resolved.map((skill) => [skill.name, skill] as const));
  return [
    tool(
      LIST_SKILL_FILES_TOOL,
      "List the files inside the skills attached to this run (read-only). Returns each skill's file paths, kinds, and token sizes. Does not read contents and never executes anything.",
      {},
      async (): Promise<CallToolResult> => jsonResult(listSkillFilesResult(resolved)),
    ),
    tool(
      READ_SKILL_FILE_TOOL,
      "Read the CONTENTS of one file inside an attached skill (read-only, e.g. its SKILL.md or a reference file). Provide `skill` (the skill name) and `path` (the file path within that skill). Returns text only — it never runs scripts or executes anything.",
      {
        skill: z.string().describe("The attached skill's name (from <available_skills>)."),
        path: z.string().describe("The file path within the skill (e.g. SKILL.md)."),
      },
      async ({ skill, path: rawPath }): Promise<CallToolResult> => {
        const result = await readSkillFile(skillsDir, byName, skill, rawPath);
        return jsonResult(result, "error" in result);
      },
    ),
  ];
}

/**
 * Build the read-only skill-disclosure in-process MCP server (`driver.start({ mcpServers })`'s
 * `"skills"` entry), backed by the files MATERIALIZED under `skillsDir`. Called only when the run has
 * ≥1 resolved skill (see `claude-subscription-executor.ts`'s `startSession`) — a scenario with no
 * attached skills never builds this server, keeping its wiring byte-for-byte unchanged.
 */
export function buildSubscriptionSkillToolServer(
  skillsDir: string,
  resolved: readonly ResolvedSkill[],
): unknown {
  return createSdkMcpServer({
    name: SUBSCRIPTION_SKILLS_MCP_KEY,
    version: "0.0.0",
    tools: buildSubscriptionSkillToolDefinitions(skillsDir, resolved),
  });
}
