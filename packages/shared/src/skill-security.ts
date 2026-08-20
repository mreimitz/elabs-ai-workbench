// Skill security surface — the deterministic, read-only "what could this skill reach?" summary shown
// on the Skills inspector's Overview and projected by the workbench MCP server's `skills_security`
// tool (planning/Roadmap/RM-08-ci/mcp-server.md, D-MCP4: one derivation, several surfaces — never a second copy).
//
// This derivation used to live INSIDE `apps/web/src/features/skills/SkillOverview.tsx`, which meant
// the only way to answer "does this skill ship scripts / reference the network?" was to render the
// React component. It is a pure function over the already-persisted file list plus the SKILL.md body,
// so it belongs in `packages/shared` where both ends can read it.
//
// It INSPECTS, it never executes: skill content is stored and metered, never run (see CLAUDE.md §
// "Skills registry & inspector"). The network check is a deliberately LIGHT lexical scan of the
// SKILL.md body — it flags an operator-visible signal, it is not a sandbox or a taint analysis.
import type { SkillFileNode } from "./types.js";

/** The at-a-glance security surface of ONE skill version. */
export type SkillSecuritySurface = {
  /** How many files the version classifies as `script`. */
  scriptCount: number;
  /** The distinct languages those scripts are written in, sorted, by file extension. */
  scriptLangs: string[];
  /** Whether the SKILL.md body contains at least one absolute http(s) URL. */
  networkRefs: boolean;
  /** Total files in the version (scripts and everything else). */
  fileCount: number;
  /** Total bytes across every file in the version. */
  totalBytes: number;
};

/** File extension → the language label the UI and the MCP tool both report. */
export const SKILL_SCRIPT_LANG_LABELS: Record<string, string> = {
  py: "python",
  js: "javascript",
  ts: "typescript",
  sh: "shell",
  bash: "shell",
  rb: "ruby",
  go: "go",
};

/**
 * Rough URL/network-reference detector. Light on purpose: it flags absolute http(s) URLs so an
 * operator can spot an external call in the prose, and never claims more than that.
 *
 * What it deliberately does NOT match: a relative Markdown link (`[guide](./docs/guide.md)`), a bare
 * domain with no scheme (`example.com`), a `mailto:`/`file:` URI, or a package name that merely
 * contains a slash. The scheme is the whole signal — anything looser would fire on ordinary prose and
 * make the `info` finding it feeds worthless. It is a lexical scan, NOT a taint analysis: it says
 * "there is a URL in here to go and read", never "this skill makes a network call".
 *
 * Exported (WP 1.3) so `skill-surface.network-reference` can report WHERE it matched, with an offset,
 * instead of only that it did. {@link deriveSkillSecuritySurface} keeps using the same constant, so
 * the boolean the Skills inspector shows and the finding the analyzer emits can never disagree.
 */
export const SKILL_NETWORK_REF_PATTERN = /\bhttps?:\/\/[^\s"'<>)]+/i;

/**
 * Derive the security surface from a version's file list plus a light scan of its SKILL.md body.
 * Pure — no I/O, no DB, no execution.
 *
 * An unrecognised extension falls back to the raw extension itself (a `.zsh` script reports "zsh");
 * a file with no extension at all reports the empty string, exactly as the original UI derivation did.
 */
export function deriveSkillSecuritySurface(
  files: readonly SkillFileNode[],
  skillMdBody: string,
): SkillSecuritySurface {
  const scripts = files.filter((file) => file.kind === "script");
  const scriptLangs = Array.from(
    new Set(
      scripts.map((file) => {
        const ext = file.path.split(".").pop()?.toLowerCase() ?? "";
        return SKILL_SCRIPT_LANG_LABELS[ext] ?? ext;
      }),
    ),
  ).sort();
  return {
    scriptCount: scripts.length,
    scriptLangs,
    networkRefs: SKILL_NETWORK_REF_PATTERN.test(skillMdBody),
    fileCount: files.length,
    totalBytes: files.reduce((sum, file) => sum + file.size, 0),
  };
}
