// Skill IDE WP 8.1 (I9.2) — the SINGLE conservative tool-reference extraction implementation, shared
// by the projector (`tool_ref` graph nodes) and the WP 5.1 validator (`tool-validation.ts`). Lifted
// verbatim out of `tool-validation.ts` so there is exactly ONE heuristic; both consumers import it.
//
// PURE and deterministic over `skillMd` (I9.2 never-scan): FILE BYTES ONLY — no scan reads, no MCP
// client, no DB, no network, no clock. Same input → same output.
//
// ── Extraction heuristic (CONSERVATIVE — false positives are worse than misses) ────────────────────
// A candidate tool reference is a backtick-quoted inline-code identifier that BOTH:
//   1. matches a tool-name SHAPE — `snake_case`/`kebab-case` (`/^[a-z0-9]+([_-][a-z0-9]+)+$/i`, i.e. at
//      least one `_`/`-` separator) OR a `namespace:tool` form — a single bare word NEVER matches; and
//   2. carries a CONTEXT SIGNAL — the same or an immediately adjacent line contains a tool-calling word
//      ("tool"/"call"/"invoke"/"use" and common inflections). The context scan strips inline-code spans
//      first, so an identifier that itself contains "tool"/"use" (e.g. `use_widget`) can't self-admit.
// Extraction skips YAML frontmatter and fenced code blocks (``` / ~~~) — example code there is a
// false-positive magnet. Each surviving reference is anchored to its exact line.
//
// ── Scope (`<!-- skillflow:servers a,b -->`) ───────────────────────────────────────────────────────
// A document-scope annotation narrows the candidate server set to the named (trim + case-insensitive)
// registered servers; absent → ALL registered servers. Parsed here in the SAME conservative pass
// (independent of the graph-oriented `parseSkillflowAnnotations`, which only recognizes heading-adjacent
// annotations) so the validator and any future consumer read exactly one shape.

import type { SkillGraphAnchor } from "@mcp-token-footprint/shared";

/** One extracted tool reference: the backticked `name`, its 1-based `line`, and a SKILL.md anchor. */
export type ToolReference = {
  name: string;
  line: number;
  anchor: SkillGraphAnchor;
};

/** The result of one conservative scan: anchored references + the union server scope (or null). */
export type ExtractedTools = { references: ToolReference[]; scope: string[] | null };

// Tool-name shapes. Snake/kebab requires ≥1 separator; namespaced is `ns:tool` (each side a valid
// identifier). A single bare word matches NEITHER — deliberately, to keep extraction conservative.
const SNAKE_KEBAB_RE = /^[a-z0-9]+([_-][a-z0-9]+)+$/i;
const NAMESPACED_RE = /^[a-z0-9]+([_-][a-z0-9]+)*:[a-z0-9]+([_-][a-z0-9]+)*$/i;
// Context words that admit a shape-matching backticked identifier as a real tool reference.
const CONTEXT_RE =
  /\b(tool|tools|tooling|call|calls|called|calling|invoke|invokes|invoked|invoking|use|uses|used|using)\b/i;
// An ATX heading line (kept in step with the projector so anchors carry a comparable heading path).
const HEADING_RE = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
// The document-scope annotation: `<!-- skillflow:servers a, b, c -->` (comma-separated server names).
const SCOPE_RE = /^<!--\s*skillflow:servers\s+(.+?)\s*-->$/i;

/**
 * Single conservative pass over SKILL.md: collect anchored tool references (shape + context signal,
 * skipping frontmatter + fenced code) and the union of any `skillflow:servers` scope annotations
 * (lower-cased server names; `null` when none present → all servers in scope).
 */
export function scanSkillForTools(skillMd: string): ExtractedTools {
  if (typeof skillMd !== "string" || skillMd === "") return { references: [], scope: null };
  const lines = skillMd.split(/\r?\n/);

  // A leading `---` … `---` YAML frontmatter block is skipped for extraction (its lines still count
  // for anchoring). `fmEnd` is the 0-based index of the closing fence (or -1 when there is none).
  let fmEnd = -1;
  if ((lines[0] ?? "").trim() === "---") {
    for (let i = 1; i < lines.length; i += 1) {
      if ((lines[i] ?? "").trim() === "---") {
        fmEnd = i;
        break;
      }
    }
  }

  const references: ToolReference[] = [];
  const seenRef = new Set<string>();
  let scope: Set<string> | null = null;
  const stack: Array<{ level: number; title: string }> = [];
  let inFence = false;

  for (let i = 0; i < lines.length; i += 1) {
    if (fmEnd >= 0 && i <= fmEnd) continue; // inside (or at the fences of) the frontmatter block
    const raw = lines[i] ?? "";
    const trimmed = raw.trim();

    if (trimmed.startsWith("```") || trimmed.startsWith("~~~")) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;

    const scopeMatch = SCOPE_RE.exec(trimmed);
    if (scopeMatch) {
      const names = (scopeMatch[1] ?? "")
        .split(",")
        .map((name) => name.trim().toLowerCase())
        .filter(Boolean);
      if (names.length > 0) {
        if (scope === null) scope = new Set<string>();
        for (const name of names) scope.add(name);
      }
      continue;
    }

    const headingMatch = HEADING_RE.exec(raw);
    if (headingMatch && (headingMatch[2] ?? "").trim() !== "") {
      const level = headingMatch[1]!.length;
      const title = (headingMatch[2] ?? "").trim();
      while (stack.length > 0 && stack[stack.length - 1]!.level >= level) stack.pop();
      stack.push({ level, title });
    }

    for (const name of backtickedCandidates(raw)) {
      if (!hasContextSignal(lines, i)) continue;
      const key = `${name} ${i + 1}`;
      if (seenRef.has(key)) continue;
      seenRef.add(key);
      references.push({
        name,
        line: i + 1,
        anchor: { headingPath: headingPathOf(stack), startLine: i + 1, endLine: i + 1 },
      });
    }
  }

  return { references, scope: scope ? [...scope] : null };
}

/** Inline-code identifiers on `line` whose inner text matches a tool-name shape (deduped in-line). */
function backtickedCandidates(line: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const re = /`([^`\n]+)`/g;
  let match = re.exec(line);
  while (match !== null) {
    const inner = (match[1] ?? "").trim();
    if (looksLikeToolName(inner) && !seen.has(inner)) {
      seen.add(inner);
      out.push(inner);
    }
    match = re.exec(line);
  }
  return out;
}

function looksLikeToolName(value: string): boolean {
  return SNAKE_KEBAB_RE.test(value) || NAMESPACED_RE.test(value);
}

/**
 * Is there a tool-calling context word on line `i` or an immediately adjacent line? Inline-code spans
 * are stripped first so an identifier that itself contains a context word cannot self-admit.
 */
function hasContextSignal(lines: string[], i: number): boolean {
  const window = [lines[i - 1], lines[i], lines[i + 1]];
  const prose = window.map((line) => stripInlineCode(line ?? "")).join(" ");
  return CONTEXT_RE.test(prose);
}

function stripInlineCode(line: string): string {
  return line.replace(/`[^`\n]+`/g, " ");
}

/** The heading path for the anchor, matching the projector's convention (H1 → itself; else H2+ chain). */
function headingPathOf(stack: Array<{ level: number; title: string }>): string[] {
  if (stack.length === 0) return [];
  const top = stack[stack.length - 1]!;
  if (top.level === 1) return [top.title];
  return stack.filter((entry) => entry.level >= 2).map((entry) => entry.title);
}

/** Extract the anchored tool references from SKILL.md (the projector + validator consume this). */
export function extractToolReferences(skillMd: string): ToolReference[] {
  return scanSkillForTools(skillMd).references;
}

/** Parse the `skillflow:servers` scope (lower-cased names), or `null` when no scope annotation. */
export function parseServerScope(skillMd: string): string[] | null {
  return scanSkillForTools(skillMd).scope;
}
