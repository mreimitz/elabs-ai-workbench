import { SKILLFLOW_ANNOTATION_PREFIX } from "@mcp-token-footprint/shared";

/**
 * A parsed `<!-- skillflow:… -->` in-file annotation. Annotations are optional, invisible to the
 * rendered markdown, and inert for the consuming agent (D2). They refine the inferred graph — an
 * annotation directly above a heading forces that heading's node kind + a stable id.
 *
 * Supported keywords:
 * - `skillflow:gatekeeper id=X` — force the following section's node to `gatekeeper` with id `X`.
 * - `skillflow:gate id=X` — force the following section's node to `validation_gate` with id `X`
 *   (the script is resolved by the projector; if none can be resolved the kind is kept + a warning).
 * - `skillflow:command id=X` — pin the stable id of the `entry_point` node projected from the
 *   following `/command` heading (Skill IDE WP 1.2). Above a non-command heading it is inert.
 * - `skillflow:servers a,b` — a DOCUMENT-SCOPE annotation (Skill IDE WP 5.1) that scopes MCP
 *   tool-reference validation to named servers. It refines validation, not the graph, so it is
 *   recognized (never warns, not heading-bound) but produces no `SkillflowAnnotation`.
 *
 * Unknown keywords produce a warning, never an error.
 */
export type SkillflowAnnotation = {
  /** The keyword after the `skillflow:` prefix, e.g. `gatekeeper` or `gate`. */
  keyword: string;
  /** The `id=` param, when present — this becomes the affected node's stable id (wins over generated). */
  id?: string;
  /** All `key=value` params parsed from the comment (id included). */
  params: Record<string, string>;
  /** 1-based line of the annotation comment itself. */
  commentLine: number;
  /** 1-based line of the heading the annotation targets. */
  targetLine: number;
};

export type ParsedAnnotations = {
  /** Annotations keyed by the 1-based line of the heading each one targets. */
  byTargetLine: Map<number, SkillflowAnnotation>;
  warnings: string[];
};

/** A whole-line HTML comment: `<!-- … -->` (leading/trailing whitespace tolerated). */
const COMMENT_RE = /^<!--\s*(.*?)\s*-->$/;
/** An ATX heading line (`#`..`######` + space + content). */
const HEADING_RE = /^#{1,6}\s+\S/;

/**
 * Parse every `<!-- skillflow:… -->` annotation that sits on its own line directly above a heading.
 * Pure over the already-split `lines` (1-based line numbers = index + 1). Never throws — malformed
 * or unknown annotations degrade to a warning.
 */
export function parseSkillflowAnnotations(lines: string[]): ParsedAnnotations {
  const byTargetLine = new Map<number, SkillflowAnnotation>();
  const warnings: string[] = [];

  for (let i = 0; i < lines.length; i += 1) {
    const commentMatch = COMMENT_RE.exec((lines[i] ?? "").trim());
    if (!commentMatch) continue;
    const inner = (commentMatch[1] ?? "").trim();
    if (!inner.startsWith(SKILLFLOW_ANNOTATION_PREFIX)) continue;

    const commentLine = i + 1;
    const body = inner.slice(SKILLFLOW_ANNOTATION_PREFIX.length).trim();
    const tokens = body.split(/\s+/).filter(Boolean);
    const keyword = tokens.shift();
    if (!keyword) {
      warnings.push(`skillflow annotation on line ${commentLine} has no keyword; ignored`);
      continue;
    }

    const params: Record<string, string> = {};
    for (const tok of tokens) {
      const eq = tok.indexOf("=");
      if (eq > 0) params[tok.slice(0, eq)] = tok.slice(eq + 1);
    }

    // `skillflow:servers a,b` (Skill IDE WP 5.1) is a DOCUMENT-SCOPE annotation that scopes MCP
    // tool-reference validation (see `tool-validation.ts`), NOT a heading refinement — it is not tied
    // to a heading and must not warn. Recognize it here so it neither trips the heading-adjacency check
    // below nor the unknown-keyword warning; it intentionally does not enter `byTargetLine` (the graph
    // projection is unaffected — `tool-validation.ts` parses the scope itself).
    if (keyword === "servers") continue;

    // The annotation must sit directly above a heading (skipping only blank lines between them).
    let j = i + 1;
    while (j < lines.length && (lines[j] ?? "").trim() === "") j += 1;
    if (j >= lines.length || !HEADING_RE.test(lines[j] ?? "")) {
      warnings.push(
        `skillflow:${keyword} annotation on line ${commentLine} is not directly above a heading; ignored`,
      );
      continue;
    }

    if (keyword !== "gatekeeper" && keyword !== "gate" && keyword !== "command") {
      warnings.push(`unknown annotation "skillflow:${keyword}" on line ${commentLine}; ignored`);
      continue;
    }

    byTargetLine.set(j + 1, { keyword, id: params.id, params, commentLine, targetLine: j + 1 });
  }

  return { byTargetLine, warnings };
}
