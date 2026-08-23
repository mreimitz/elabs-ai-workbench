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
//
// RM-38 WP 2.1 — the language-label map and the URL matcher are no longer literals here. They are
// pack data (`data-pack/security/signatures.json`), read through `securitySignatures()` at call
// time so a refreshed pack changes them with no release. The DERIVATION is unchanged, which is why
// this file's tests did not move.
import { securitySignatures } from "./security-tables.js";
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

/**
 * File extension → the language label the UI and the MCP tool both report.
 *
 * Pack data since RM-38 WP 2.1. A FUNCTION rather than a constant, deliberately: a constant would
 * snapshot the table at module-evaluation time, which in ESM is strictly before `index.ts` installs
 * the resolved pack — "install before the consumer" is not something that can be arranged for a
 * module-level read, only something that can look arranged.
 */
export function skillScriptLangLabels(): Readonly<Record<string, string>> {
  return securitySignatures().skillScriptLangLabels;
}

/**
 * Rough URL/network-reference detector. Light on purpose: it flags absolute http(s) URLs so an
 * operator can spot an external call in the prose, and never claims more than that.
 *
 * The full false-positive review — what it deliberately does NOT match, and why the scheme is the
 * whole signal — travels with the pattern, in `data-pack/security/signatures.json`'s
 * `skillNetworkRefNote`. It is a lexical scan, NOT a taint analysis: it says "there is a URL in here
 * to go and read", never "this skill makes a network call".
 *
 * Exposed as a function (WP 1.3 exported the constant) so `skill-surface.network-reference` can
 * report WHERE it matched, with an offset, instead of only that it did.
 * {@link deriveSkillSecuritySurface} calls the same accessor, so the boolean the Skills inspector
 * shows and the finding the analyzer emits can never disagree.
 */
export function skillNetworkRefPattern(): RegExp {
  return securitySignatures().skillNetworkRefPattern;
}

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
  const labels = skillScriptLangLabels();
  const scripts = files.filter((file) => file.kind === "script");
  const scriptLangs = Array.from(
    new Set(
      scripts.map((file) => {
        const ext = file.path.split(".").pop()?.toLowerCase() ?? "";
        return labels[ext] ?? ext;
      }),
    ),
  ).sort();
  return {
    scriptCount: scripts.length,
    scriptLangs,
    networkRefs: skillNetworkRefPattern().test(skillMdBody),
    fileCount: files.length,
    totalBytes: files.reduce((sum, file) => sum + file.size, 0),
  };
}
