import { explainerFor } from "./explainers";
import type { Disposable, MonacoApi, MonacoEditor, MonacoModel } from "./monaco-types";
import { SNIPPET_SPECS } from "./snippet-specs";

// Skill IDE WP 9.3 (I10.5) — the authoring-snippet + asset-path completion provider (the code-mode
// equivalent of the flow canvas's create dialogs). Scoped to ONE editor's model; disposed on unmount.
//   • Static snippets (`SNIPPET_SPECS`): section / /command / gatekeeper+breadcrumb / skillflow:*
//     annotations / frontmatter keywords|servers, CONTEXT-GATED (frontmatter block vs body).
//   • Relative-path completion for asset refs, sourced from the version's file tree (`getFilePaths`),
//     so a path an author types resolves to a real bundled file (→ an `asset` node).

const PATH_FRAGMENT_RE = /[\w./-]*$/;

export type SnippetProviderContext = {
  /** The version's file paths (posix, relative), for relative-path asset-ref completion. */
  getFilePaths: () => readonly string[];
};

/**
 * Register the snippet + path completion provider on `editor`'s model and return a disposer. Registered
 * ONCE per mount; the returned `dispose()` unregisters it (the dispose invariant — Monaco keeps
 * completion providers on the shared language registry, so a leak would double every suggestion).
 */
export function registerSnippetProvider(
  monacoApi: MonacoApi,
  editor: MonacoEditor,
  ctx: SnippetProviderContext,
): Disposable {
  const CompletionItemKind = monacoApi.languages.CompletionItemKind;
  const InsertAsSnippet = monacoApi.languages.CompletionItemInsertTextRule.InsertAsSnippet;

  const provider = monacoApi.languages.registerCompletionItemProvider("markdown", {
    triggerCharacters: ["/"],
    provideCompletionItems(model, position) {
      if (model !== editor.getModel()) return { suggestions: [] };

      const linePrefix = model.getValueInRange({
        startLineNumber: position.lineNumber,
        startColumn: 1,
        endLineNumber: position.lineNumber,
        endColumn: position.column,
      });
      const fragment = PATH_FRAGMENT_RE.exec(linePrefix)?.[0] ?? "";
      const range = {
        startLineNumber: position.lineNumber,
        startColumn: position.column - fragment.length,
        endLineNumber: position.lineNumber,
        endColumn: position.column,
      };
      const frontmatter = inFrontmatter(model, position.lineNumber);

      // Static authoring snippets, context-gated (frontmatter block vs markdown body).
      const snippetItems = SNIPPET_SPECS.filter(
        (spec) => (spec.context === "frontmatter") === frontmatter,
      ).map((spec) => {
        const explainer = explainerFor(spec.explainerId);
        return {
          label: spec.keyword,
          kind: CompletionItemKind.Snippet,
          insertText: spec.insertText,
          insertTextRules: InsertAsSnippet,
          detail: spec.detail,
          documentation: explainer
            ? { value: `${explainer.short}\n\n[Authoring guide ↗](${explainer.guideAnchor})` }
            : { value: spec.detail },
          range,
        };
      });

      // Relative-path asset-ref completion (body only, when the fragment looks path-like or `/`-triggered).
      const pathLike = fragment.includes("/") || fragment.includes(".") || linePrefix.endsWith("/");
      const pathItems =
        !frontmatter && pathLike
          ? ctx
              .getFilePaths()
              .filter((path) => path !== "SKILL.md")
              .map((path) => ({
                label: path,
                kind: CompletionItemKind.File,
                insertText: path,
                detail: "Bundled file (relative reference)",
                documentation: {
                  value: `Reference \`${path}\` — resolves to a bundled asset (an L3 file).`,
                },
                range,
              }))
          : [];

      return { suggestions: [...snippetItems, ...pathItems] };
    },
  });

  return { dispose: () => provider.dispose() };
}

/** Is `line` inside the leading `---`…`---` YAML frontmatter block? */
function inFrontmatter(model: MonacoModel, line: number): boolean {
  if (model.getLineContent(1).trim() !== "---") return false;
  const lineCount = model.getLineCount();
  for (let i = 2; i <= lineCount; i += 1) {
    if (model.getLineContent(i).trim() === "---") return line > 1 && line < i;
  }
  return false;
}
