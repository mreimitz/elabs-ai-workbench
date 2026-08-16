import type { SkillFileKind, SkillManifest, TokenProfileId } from "@mcp-token-footprint/shared";
import { getTokenCounter } from "../token-counting/profiles.js";
import type { TokenCounter } from "../token-counting/types.js";

// Three-level token footprint for a skill version (research/skill-registry/11 + 06):
//   L1 = name + description tokens (always-loaded metadata, from the manifest)
//   L2 = SKILL.md body tokens (loaded when the skill triggers)
//   L3 = sum of every OTHER text file's tokens (references/scripts/assets/other, loaded on demand)
// Binary files contribute 0 tokens. `total` == L1 + L2 + L3 == the sum of per-file totals plus L1.
//
// Pure functions — no DB. WP 1.3/1.4 wire `countLevels` into `createVersion` to backfill the
// `skill_versions` level columns + `skill_files.token_total`.

/** A single file in a skill version's flat tree, as seen by token accounting. */
export type SkillFootprintFile = {
  /** POSIX path relative to the skill root (e.g. "SKILL.md", "references/API.md", "assets/logo.png"). */
  path: string;
  /** UTF-8 text content for text files; omit/undefined for binary files. */
  text?: string;
  /** Whether this file is binary (contributes 0 tokens regardless of `text`). */
  isBinary: boolean;
};

/** Per-file token accounting result. */
export type SkillFileFootprint = {
  path: string;
  kind: SkillFileKind;
  isBinary: boolean;
  /** Tokens attributed to this file (0 for binary; SKILL.md body counts here as its body tokens). */
  tokenTotal: number;
};

/** Level subtotals + per-file totals for a skill version. */
export type SkillLevelsFootprint = {
  tokenProfile: TokenProfileId;
  l1: number;
  l2: number;
  l3: number;
  total: number;
  files: SkillFileFootprint[];
};

/**
 * Classify a file by its POSIX path relative to the skill root:
 *   - root `SKILL.md` (case-insensitive) → `skill_md`
 *   - `references/*` → `reference`
 *   - `scripts/*` → `script`
 *   - `assets/*` → `asset`
 *   - everything else → `other`
 * A `SKILL.md` that is NOT at the root (e.g. `references/SKILL.md`) is not `skill_md`.
 */
export function classifyFile(path: string): SkillFileKind {
  const normalized = normalizePath(path);
  if (normalized.toLowerCase() === "skill.md") return "skill_md";
  const firstSegment = normalized.split("/")[0];
  if (firstSegment === "references") return "reference";
  if (firstSegment === "scripts") return "script";
  if (firstSegment === "assets") return "asset";
  return "other";
}

/** Strip leading `./` and `/`, collapse `\\` → `/`, so classification is stable across inputs. */
function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\.\//, "").replace(/^\/+/, "");
}

/**
 * Compute the L1/L2/L3 token footprint of a skill version and per-file token totals.
 *
 * @param files   the version's flat file list (text inline; binary flagged)
 * @param manifest the validated (or best-effort) manifest — drives L1 (name + description)
 * @param body    the SKILL.md Markdown body (from `parseSkillManifest`) — drives L2
 * @param profile the token profile to count with (defaults to `generic_o200k`, the scan default)
 */
export async function countLevels(
  files: SkillFootprintFile[],
  manifest: SkillManifest,
  body: string,
  profile: TokenProfileId = "generic_o200k",
): Promise<SkillLevelsFootprint> {
  const counter: TokenCounter = getTokenCounter(profile);

  // L1 — always-loaded metadata: name + description tokens.
  const nameTokens = manifest.name ? await counter.countText(manifest.name) : 0;
  const descriptionTokens = manifest.description
    ? await counter.countText(manifest.description)
    : 0;
  const l1 = nameTokens + descriptionTokens;

  // L2 — SKILL.md body tokens.
  const l2 = body ? await counter.countText(body) : 0;

  // Per-file totals + L3 (sum of every OTHER text file). The root SKILL.md file is attributed its
  // body tokens (L2) and does NOT contribute to L3.
  const fileFootprints: SkillFileFootprint[] = [];
  let l3 = 0;

  for (const file of files) {
    const kind = classifyFile(file.path);
    const isSkillMd = kind === "skill_md";

    let tokenTotal = 0;
    if (file.isBinary) {
      tokenTotal = 0;
    } else if (isSkillMd) {
      tokenTotal = l2;
    } else {
      tokenTotal = file.text ? await counter.countText(file.text) : 0;
      l3 += tokenTotal;
    }

    fileFootprints.push({ path: file.path, kind, isBinary: file.isBinary, tokenTotal });
  }

  return {
    tokenProfile: profile,
    l1,
    l2,
    l3,
    total: l1 + l2 + l3,
    files: fileFootprints,
  };
}
