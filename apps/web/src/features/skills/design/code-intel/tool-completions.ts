import type { BoundTool } from "@mcp-token-footprint/shared";
import type { Disposable, MonacoApi, MonacoEditor, MonacoModel } from "./monaco-types";

// Skill Studio SI9 — tool-name IntelliSense for the code editor: typing a bare tool-name prefix
// (`qlik_` on a blank line — the owner's repro) now offers the bound servers' tools as completions.
// Split the way tool-references.ts is: a PURE, exhaustively-tested context decision
// (`getToolCompletionContext`) + a PURE item mapper (`buildToolCompletionItems`), and a thin Monaco
// registration (`registerToolCompletionProvider`) the code-intel orchestrator wires ONCE per mount.
//
// WHEN it offers (conservative — a surprise popup on prose is worse than a missed one):
//   • a bare word of tool-name shape (`[a-z][a-z0-9_]*`, clean word boundaries on BOTH sides)
//     containing or ending at the cursor, with ≥ 3 typed chars — and only when at least one bound
//     tool name STARTS with the typed prefix (an ordinary prose word offers nothing: the prefix
//     match against the bound list decides);
//   • inside an inline-code (backtick) span — DETECTED here and fully covered by the mapper (bare
//     insert text, no backtick doubling), but the LIVE provider DEFERS that context to WP 8.2's
//     completion provider (`use-bound-tools.ts`, registered on the same editor), which already owns
//     backticked suggestions — exactly one provider fires per context, the same no-double contract
//     hovers.ts applies to backticked known tokens;
//   • NEVER inside the YAML frontmatter block (the provider passes the model-derived flag), and
//     never when the skill has no scanned bound tools (unbound → silence, WP 8.2's honest
//     degradation). Decisions are otherwise line-local (like WP 8.2's parity heuristic): a bare
//     known-prefix word inside a fenced example still completes — fence content is a real
//     tool-reference context (the stance tool-references.ts takes for KNOWN matches).

/** The lowercase alphabet a completion word is scanned over (the tool-name alphabet). */
const LOWER_WORD_CHAR_RE = /[a-z0-9_]/;
/** The broader identifier alphabet used for BOUNDARY checks (mirrors tool-references.ts) — a word
 *  abutting one of these (`Qlik_sea`, `qlik_Search`) is mid-identifier, not a clean tool word. */
const BOUNDARY_CHAR_RE = /[A-Za-z0-9_]/;
/** The shape a completion word must have: starts with a lowercase letter, then `[a-z0-9_]*`. */
const WORD_SHAPE_RE = /^[a-z][a-z0-9_]*$/;
/** Minimum typed-prefix length before the bare-word path offers anything (conservative). */
const MIN_BARE_QUERY_LENGTH = 3;

/** Where (and whether) tool completions apply at a cursor position — `null` means "do not offer". */
export type ToolCompletionContext = {
  /** Monaco-style 1-based columns of the span an accepted item replaces (the whole word / the whole
   *  inline-code span content — it contains or ends at the cursor). */
  replaceRange: { startColumn: number; endColumn: number };
  /** What the user has typed so far (word/span start → cursor) — the prefix items filter on. */
  query: string;
  /** True when the cursor sits inside an inline-code (backtick) span. */
  backticked: boolean;
};

export type ToolCompletionContextOptions = {
  /** True when the line sits inside the leading `---`…`---` YAML frontmatter block. The caller
   *  knows the document (this function sees ONE line); frontmatter never completes tool names. */
  inFrontmatter?: boolean;
};

/**
 * Decide whether the cursor at 1-based `column` on `lineText` is a tool-completion context, and if
 * so which span to replace and what has been typed. PURE — no Monaco, no React, no fetch — so it is
 * exhaustively unit-testable (`tool-completions.test.ts`).
 *
 * Backtick detection uses the same odd-parity heuristic WP 8.2's provider uses (an odd number of
 * backticks before the cursor ⇔ inside a span), so the two providers can never both claim a context.
 */
export function getToolCompletionContext(
  lineText: string,
  column: number,
  options: ToolCompletionContextOptions = {},
): ToolCompletionContext | null {
  if (options.inFrontmatter) return null;
  const cursor = Math.max(0, Math.min(column - 1, lineText.length)); // 0-based caret offset
  const prefix = lineText.slice(0, cursor);

  // (b) Inside an inline-code span — complete the span content (bare insert; caller may defer).
  const backtickCount = prefix.match(/`/g)?.length ?? 0;
  if (backtickCount % 2 === 1) {
    const spanStart = prefix.lastIndexOf("`") + 1;
    const query = prefix.slice(spanStart);
    if (query !== "" && !WORD_SHAPE_RE.test(query)) return null; // `foo bar — not a tool token
    const end = wordEndFrom(lineText, cursor);
    if (end === null) return null; // an uppercase identifier char continues the span
    return {
      replaceRange: { startColumn: spanStart + 1, endColumn: end + 1 },
      query,
      backticked: true,
    };
  }

  // (a) A bare word of tool-name shape containing or ending at the cursor, ≥ 3 chars typed.
  let start = cursor;
  while (start > 0 && LOWER_WORD_CHAR_RE.test(lineText.charAt(start - 1))) start -= 1;
  const query = prefix.slice(start);
  if (query.length < MIN_BARE_QUERY_LENGTH) return null;
  if (start > 0 && BOUNDARY_CHAR_RE.test(lineText.charAt(start - 1))) return null; // `Qlik_sea`
  const end = wordEndFrom(lineText, cursor);
  if (end === null) return null; // `qlik_Search` — the word continues in another alphabet
  const word = lineText.slice(start, end);
  if (!WORD_SHAPE_RE.test(word)) return null; // must start with a lowercase letter
  return {
    replaceRange: { startColumn: start + 1, endColumn: end + 1 },
    query,
    backticked: false,
  };
}

/** Extend from 0-based `cursor` over the lowercase word alphabet and return the 0-based end offset;
 *  `null` when the char that stops the scan is still an identifier char in the broader alphabet
 *  (an uppercase continuation — the cursor sits mid-identifier, not in a tool word). */
function wordEndFrom(lineText: string, cursor: number): number | null {
  let end = cursor;
  while (end < lineText.length && LOWER_WORD_CHAR_RE.test(lineText.charAt(end))) end += 1;
  if (end < lineText.length && BOUNDARY_CHAR_RE.test(lineText.charAt(end))) return null;
  return end;
}

/** One completion item, Monaco-free (the provider adds `kind` + the full line-qualified range). */
export type ToolCompletionItemSpec = {
  /** The tool name (the label Monaco filters the typed word against). */
  label: string;
  /** A backticked reference outside code spans (the file's established reference style — what the
   *  scaffolder emits and the tool-reference matcher treats as canonical); bare inside a span. */
  insertText: string;
  /** `<server> · <tokens> tok` — the owning server + the definition's token cost at a glance. */
  detail: string;
  /** Description excerpt (`""` when the scan carries no description). */
  documentation: string;
  /** Exact-prefix matches rank before substring matches, then alphabetical. */
  sortText: string;
};

/**
 * Map `tools` to completion items for `context`. PURE. The conservative gate lives here: when NO
 * bound tool name starts with the typed query, the result is `[]` — an ordinary prose word that
 * shares no prefix with any known tool never pops a list (substring hits alone do not fire; they
 * only ride along, ranked second, once a prefix match justified firing). Empty `tools` → `[]`.
 */
export function buildToolCompletionItems(
  context: ToolCompletionContext,
  tools: readonly BoundTool[],
): ToolCompletionItemSpec[] {
  if (tools.length === 0) return [];
  const query = context.query;
  const prefixed = tools.filter((tool) => tool.toolName.startsWith(query));
  if (prefixed.length === 0) return [];
  const contained = tools.filter(
    (tool) => !tool.toolName.startsWith(query) && tool.toolName.includes(query),
  );
  const toSpec = (tool: BoundTool, rank: 0 | 1): ToolCompletionItemSpec => ({
    label: tool.toolName,
    insertText: context.backticked ? tool.toolName : `\`${tool.toolName}\``,
    detail: `${tool.serverName} · ${tool.definitionTokens.toLocaleString()} tok`,
    documentation: tool.description ? excerpt(tool.description, 200) : "",
    sortText: `${rank}_${tool.toolName}`,
  });
  return [
    ...prefixed.map((tool) => toSpec(tool, 0)),
    ...contained.map((tool) => toSpec(tool, 1)),
  ].sort((a, b) => a.sortText.localeCompare(b.sortText));
}

export type ToolCompletionProviderContext = {
  /** Read the CURRENT bound tools — lazily, per completion request, so a list that lands after
   *  mount (the async fetch) or changes on re-scan is seen immediately without re-registration
   *  (the same async-arrival contract the WP 7.5 decoration recompute honors). */
  getBoundTools: () => readonly BoundTool[];
};

/**
 * Register the SI9 tool-name completion provider on `editor`'s model and return a disposer.
 * Registered ONCE per mount; the returned `dispose()` unregisters it (the dispose invariant —
 * Monaco keeps completion providers on the shared language registry, so a leak would double every
 * suggestion on the next mount).
 */
export function registerToolCompletionProvider(
  monacoApi: MonacoApi,
  editor: MonacoEditor,
  ctx: ToolCompletionProviderContext,
): Disposable {
  const provider = monacoApi.languages.registerCompletionItemProvider("markdown", {
    // "_" re-invokes the widget while a snake_case prefix is being typed (the owner's `qlik_` repro
    // fires here even with quick-suggest off); "`" claims the span-open keystroke, where this
    // provider then defers to WP 8.2's (see below) so the span still gets exactly one list.
    triggerCharacters: ["`", "_"],
    provideCompletionItems(model, position) {
      if (model !== editor.getModel()) return { suggestions: [] };
      const tools = ctx.getBoundTools();
      if (tools.length === 0) return { suggestions: [] }; // unbound skill → no noise
      const context = getToolCompletionContext(
        model.getLineContent(position.lineNumber),
        position.column,
        { inFrontmatter: inFrontmatter(model, position.lineNumber) },
      );
      if (!context) return { suggestions: [] };
      // Backticked contexts belong to WP 8.2's completion provider (registered on the SAME editor
      // by the orchestrator) — defer, so no suggestion ever doubles (the hovers.ts contract).
      if (context.backticked) return { suggestions: [] };
      const range = {
        startLineNumber: position.lineNumber,
        startColumn: context.replaceRange.startColumn,
        endLineNumber: position.lineNumber,
        endColumn: context.replaceRange.endColumn,
      };
      const suggestions = buildToolCompletionItems(context, tools).map((item) => ({
        label: item.label,
        kind: monacoApi.languages.CompletionItemKind.Function,
        insertText: item.insertText,
        detail: item.detail,
        ...(item.documentation !== "" ? { documentation: { value: item.documentation } } : {}),
        sortText: item.sortText,
        range,
      }));
      return { suggestions };
    },
  });
  return { dispose: () => provider.dispose() };
}

/** Is `line` inside the leading `---`…`---` YAML frontmatter block? (The same private helper
 *  snippets.ts and hovers.ts carry — siblings by design, each scoped to its provider.) */
function inFrontmatter(model: MonacoModel, line: number): boolean {
  if (model.getLineContent(1).trim() !== "---") return false;
  const lineCount = model.getLineCount();
  for (let i = 2; i <= lineCount; i += 1) {
    if (model.getLineContent(i).trim() === "---") return line > 1 && line < i;
  }
  return false;
}

/** Trim to `max` chars on a word boundary with an ellipsis (single-spaced, newlines collapsed) —
 *  the same trim the hover cards apply (private siblings, like hovers.ts documents). */
function excerpt(text: string, max: number): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  if (collapsed.length <= max) return collapsed;
  const clipped = collapsed.slice(0, max);
  const lastSpace = clipped.lastIndexOf(" ");
  return `${(lastSpace > max * 0.6 ? clipped.slice(0, lastSpace) : clipped).trimEnd()}…`;
}
