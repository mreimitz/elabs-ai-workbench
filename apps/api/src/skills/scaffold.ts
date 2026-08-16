import { stringify as stringifyYaml } from "yaml";
import { httpError } from "../utils/errors.js";

// Blank-skill scaffold (SkillFlow D3, WP 1.2): given a user-supplied name + description (+ optional
// display name), build a minimal, spec-valid `SKILL.md` — frontmatter with `name` + `description`,
// a one-line intro, and an empty "## Steps" section — so it registers as a normal version 1 through
// the existing ingest path (manifest validation, caps, token footprint all apply unchanged).
//
// Deterministic: no timestamps, no randomness. Same (name, description, displayName) in → the exact
// same bytes out, every time — so re-scaffolding is a byte-for-byte no-op (`createVersion` correctly
// reports `{ unchanged: true }` if a caller ever re-submits the identical scaffold).

/** One file of the scaffolded skill tree (matches the shape `SkillIngestService` consumes). */
export type BlankSkillFile = {
  path: string;
  content: Buffer;
};

// Mirrors `apps/api/src/skills/manifest.ts` NAME_MAX/NAME_PATTERN (research/skill-registry/01-agent
// -skills-format.md) — kept in sync by hand since manifest.ts doesn't export its constants. Any
// scaffolded name must pass `parseSkillManifest` validation unchanged.
const NAME_MAX = 64;
const NAME_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const DESCRIPTION_MAX = 1024;

/**
 * Validate + normalize the user-supplied `name` against the Agent Skills manifest rules
 * (lowercase letters/digits, single hyphens, no leading/trailing/consecutive hyphens, 1–64 chars).
 * Trims surrounding whitespace only — it does NOT auto-slugify (a name with spaces/uppercase is
 * rejected, not silently corrected, so the user sees exactly what will land in `SKILL.md`).
 * Throws a typed 400 `httpError` (consistent with the rest of the ingest pipeline) on any violation.
 */
export function normalizeBlankSkillName(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    throw httpError(400, "Field 'name' is required.");
  }
  if (trimmed.length > NAME_MAX) {
    throw httpError(
      400,
      `Field 'name' must be at most ${NAME_MAX} characters (got ${trimmed.length}).`,
    );
  }
  if (!NAME_PATTERN.test(trimmed)) {
    throw httpError(
      400,
      "Field 'name' must be lowercase letters, digits, and single hyphens (no spaces, uppercase letters, or leading/trailing/consecutive hyphens).",
    );
  }
  return trimmed;
}

/** Validate the user-supplied `description` (non-empty, within the manifest's length cap). */
export function normalizeBlankSkillDescription(description: string): string {
  const trimmed = description.trim();
  if (trimmed.length === 0) {
    throw httpError(400, "Field 'description' is required.");
  }
  if (trimmed.length > DESCRIPTION_MAX) {
    throw httpError(
      400,
      `Field 'description' must be at most ${DESCRIPTION_MAX} characters (got ${trimmed.length}).`,
    );
  }
  return trimmed;
}

/**
 * Build the one-file tree for a brand-new blank skill: a single `SKILL.md` with valid YAML
 * frontmatter (`name` + `description`, serialized with the `yaml` package so arbitrary punctuation
 * in `description` round-trips safely) and a starter body — a one-line intro plus an empty
 * "## Steps" section the user (or the Design tab, once WP 1.3 lands) grows from.
 *
 * Throws a 400 `httpError` if `name`/`description` fail manifest validation — the caller should not
 * create a skill shell before calling this (mirrors the upload path's "no partial rows" behavior).
 */
export function buildBlankSkillTree(
  name: string,
  description: string,
  displayName?: string,
): BlankSkillFile[] {
  const skillName = normalizeBlankSkillName(name);
  const skillDescription = normalizeBlankSkillDescription(description);
  const label = displayName?.trim() || skillName;

  const frontmatter = stringifyYaml({ name: skillName, description: skillDescription });
  const intro = `${label} is a new skill, freshly scaffolded and not yet written.`;
  const markdown = `---\n${frontmatter}---\n\n${intro}\n\n## Steps\n`;

  return [{ path: "SKILL.md", content: Buffer.from(markdown, "utf8") }];
}

// --- Skill IDE WP 8.4 (I9.4) — scaffold a new skill FROM a server's tool surface ------------------
// Same blank-skill source path (`buildBlankSkillTree` is the pattern): compose a spec-valid SKILL.md
// deterministically — frontmatter (`name`, a `description` stub or the caller's, `servers: [<server
// name>]`), an intro paragraph, then ONE `##` section per selected tool. Each tool section carries
// the scan description's FIRST SENTENCE plus a backticked, context-signalled tool reference so the
// projector (extract-tools.ts heuristic) lifts EXACTLY ONE `tool_ref` node per section. Pure over its
// inputs — no scan reads, no clock, no randomness (the route feeds it persisted scan data).

/** One selected tool for a server scaffold: its `toolName` + optional scan `description`. */
export type ServerScaffoldTool = {
  toolName: string;
  description?: string;
};

/** Inputs for {@link buildServerScaffoldTree}: skill identity + the source server + selected tools. */
export type ServerScaffoldInput = {
  name: string;
  displayName?: string;
  description?: string;
  serverName: string;
  tools: ServerScaffoldTool[];
};

/**
 * Build the one-file tree for a skill scaffolded from a server: a single `SKILL.md` binding the source
 * server (frontmatter `servers:`) with one `##` section per selected tool. Throws a 400 `httpError` if
 * `name`/`description` fail manifest validation (mirrors the blank path's "no partial rows" contract).
 */
export function buildServerScaffoldTree(input: ServerScaffoldInput): BlankSkillFile[] {
  const skillName = normalizeBlankSkillName(input.name);
  const description = serverScaffoldDescription(input);
  const label = input.displayName?.trim() || skillName;
  const serverName = input.serverName.trim();

  // The raw server name goes into frontmatter `servers:` (YAML-serialized so arbitrary punctuation
  // round-trips) — it must match the registered server name exactly for binding resolution.
  const frontmatter = stringifyYaml({ name: skillName, description, servers: [serverName] });

  const intro =
    `${label} works with the ${serverName} MCP server. ` +
    "Each section below documents one tool it uses — fill in how and when to call each.";

  const sections = input.tools.map(renderToolSection).join("\n");
  const markdown = `---\n${frontmatter}---\n\n${intro}\n\n${sections}`;

  return [{ path: "SKILL.md", content: Buffer.from(markdown, "utf8") }];
}

/**
 * The `description` for a server scaffold: the caller's (validated) when provided, else a generated
 * stub naming the source server + tool count. The stub strips angle brackets from the server name so
 * it can't trip the manifest's XML-tag guard (the frontmatter `servers:` entry keeps the raw name).
 */
function serverScaffoldDescription(input: ServerScaffoldInput): string {
  if (input.description !== undefined && input.description.trim() !== "") {
    return normalizeBlankSkillDescription(input.description);
  }
  const count = input.tools.length;
  const noun = count === 1 ? "tool" : "tools";
  const safeName = input.serverName.replace(/[<>]/g, "").trim() || "an MCP server";
  return normalizeBlankSkillDescription(
    `Works with ${count} ${noun} from the ${safeName} MCP server.`,
  );
}

/**
 * One `## <toolName>` section: the description's first sentence (on its own line), then a
 * `Call the \`<toolName>\` tool.` line carrying BOTH the shape-matching backtick reference AND the
 * tool-calling context word the extraction heuristic (extract-tools.ts) requires. The blank line
 * between them keeps the description's own text out of the reference line's context window, so the
 * section's ONLY inline-code span is the tool reference → exactly one `tool_ref` per section.
 */
function renderToolSection(tool: ServerScaffoldTool): string {
  const lead = firstSentence(tool.description);
  const body = lead ? `${lead}\n\n` : "";
  return `## ${tool.toolName}\n\n${body}Call the \`${tool.toolName}\` tool.\n`;
}

/**
 * The first sentence of a tool's scan description for its scaffolded section body: text up to the
 * first sentence terminator (`.`/`!`/`?` at a word boundary), collapsed to one line and stripped of
 * backticks (so a stray backtick in the description can't introduce a second inline-code span and a
 * spurious `tool_ref`). Empty/absent description → "".
 */
function firstSentence(text: string | undefined): string {
  if (!text) return "";
  const collapsed = text.replace(/`/g, "").replace(/\s+/g, " ").trim();
  if (collapsed === "") return "";
  const match = collapsed.match(/^.*?[.!?](?=\s|$)/);
  return (match ? match[0] : collapsed).trim();
}
