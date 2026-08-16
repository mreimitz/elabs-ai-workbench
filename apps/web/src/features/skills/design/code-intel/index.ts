import type { BoundTool, SkillGraph } from "@mcp-token-footprint/shared";
import { registerBoundToolProviders } from "../../use-bound-tools";
import { computeGraphDecorations, computeTextDecorations } from "./decorations";
import { registerConstructHovers } from "./hovers";
import type { Disposable, MonacoApi, MonacoEditor } from "./monaco-types";
import { registerSnippetProvider } from "./snippets";
import { registerToolCompletionProvider } from "./tool-completions";

// Skill IDE WP 9.3 (I10.5), reworked by Skill Studio WP 7.5 (SI7) — the code-intel orchestrator: ONE
// call in the unified Code editor's `onMount` wires every provider + the decoration set and hands back
// a single controller with a single `dispose()`. The dispose invariant is load-bearing (Monaco keeps
// hover/completion providers on the SHARED language registry), so this module owns EVERY
// registration's lifetime:
//   • WP 8.2's bound-tool completion + hover (`registerBoundToolProviders`) — re-registered whenever
//     the bound-tool set changes (its suggestions are eager), disposed on the final dispose;
//   • the construct-hover provider (headings→kind, frontmatter keys, annotations, breadcrumb markers,
//     asset refs, and the WP 7.5 tool-reference hovers) — which DEFERS a backticked bound-tool token
//     back to WP 8.2 (no double hover);
//   • the snippet + asset-path completion provider;
//   • the SI9 bare-word tool-name completion provider (`tool-completions.ts`) — registered ONCE,
//     reading the CURRENT bound-tool list lazily per request (an async-arriving list needs no
//     re-registration), and DEFERRING backticked contexts to WP 8.2's completion so no suggestion
//     ever doubles;
//   • TWO decoration collections (WP 7.5): the GRAPH-driven set (kind gutters, flow rails, asset
//     refs), recomputed from each fresh LIVE projection (`setGraph`); and the TEXT-driven set
//     (annotations, breadcrumbs, tool references), recomputed on EVERY content change AND on every
//     `setBoundTools` push — so tool decorations are correct immediately while typing and the moment
//     the (async-fetched) bound-tool list lands, the two halves of the SI7 flakiness.
// Nothing here fetches per keystroke — the text pass is a pure in-memory scan of the model.

export type CodeIntelController = {
  /** Dispose every provider + clear decorations. Called on the code editor's unmount. */
  dispose: () => void;
  /** Push the latest LIVE projection (recomputes graph decorations + feeds the hover graph). */
  setGraph: (graph: SkillGraph | null) => void;
  /** Push the latest bound tools (re-registers WP 8.2's providers, recomputes tool decorations,
   *  and feeds the WP 7.5 tool hovers). */
  setBoundTools: (tools: BoundTool[]) => void;
  /** Push the latest version file paths (drives asset-ref path completion). */
  setFilePaths: (paths: readonly string[]) => void;
};

export type CodeIntelOptions = {
  graph?: SkillGraph | null;
  boundTools?: BoundTool[];
  filePaths?: readonly string[];
  /** WP 8.5 — forwarded to WP 8.2's hover so a bound-tool popup can open the inline tool runner. */
  onTestTool?: (tool: BoundTool) => void;
};

/**
 * Register the full code-mode intelligence layer on `editor` and return its controller. Call ONCE in
 * `onMount`; call the returned `dispose()` ONCE on unmount.
 */
export function registerCodeIntel(
  monacoApi: MonacoApi,
  editor: MonacoEditor,
  options: CodeIntelOptions = {},
): CodeIntelController {
  // The glyph margin hosts the kind / annotation / breadcrumb gutter glyphs — ensure it is on.
  editor.updateOptions({ glyphMargin: true });

  // Mutable, closure-held state the lazily-reading providers see the latest of (no re-registration).
  let graph: SkillGraph | null = options.graph ?? null;
  let filePaths: readonly string[] = options.filePaths ?? [];
  let boundTools: readonly BoundTool[] = options.boundTools ?? [];

  const graphDecorations = editor.createDecorationsCollection();
  const textDecorations = editor.createDecorationsCollection();

  const recomputeGraphDecorations = (): void => {
    const model = editor.getModel();
    if (model && graph) graphDecorations.set(computeGraphDecorations(monacoApi, model, graph));
    else graphDecorations.clear();
  };
  const recomputeTextDecorations = (): void => {
    const model = editor.getModel();
    if (model) {
      textDecorations.set(
        computeTextDecorations(
          monacoApi,
          model,
          boundTools.map((tool) => tool.toolName),
        ),
      );
    } else {
      textDecorations.clear();
    }
  };

  // WP 7.5 — the text-driven decorations track the LIVE text: a pure, in-memory recompute per edit
  // (no fetch, no projection round-trip), so tool underlines never lag or land on stale anchors.
  const contentListener = editor.onDidChangeModelContent(() => recomputeTextDecorations());

  const constructHovers = registerConstructHovers(monacoApi, editor, {
    getGraph: () => graph,
    getBoundTools: () => boundTools,
  });
  const snippets = registerSnippetProvider(monacoApi, editor, {
    getFilePaths: () => filePaths,
  });

  // SI9 — bare-word tool-name completions (`qlik_` on a blank line now suggests). Registered ONCE;
  // reads `boundTools` lazily per request, so the async-arriving list (and every re-scan) is picked
  // up with no re-registration. Backticked contexts defer to WP 8.2's provider below — exactly one
  // completion source per context.
  const toolCompletions = registerToolCompletionProvider(monacoApi, editor, {
    getBoundTools: () => boundTools,
  });

  // WP 8.2's bound-tool providers — re-registered on every bound-tool change (eager suggestions).
  let boundToolProviders: Disposable | null = registerBoundTools(options.boundTools ?? []);
  function registerBoundTools(tools: BoundTool[]): Disposable | null {
    if (tools.length === 0) return null; // unbound skill → register nothing (honest degradation)
    return registerBoundToolProviders(
      monacoApi,
      editor,
      tools,
      options.onTestTool ? { onTestTool: options.onTestTool } : {},
    );
  }

  recomputeGraphDecorations();
  recomputeTextDecorations();

  return {
    dispose() {
      contentListener.dispose();
      constructHovers.dispose();
      snippets.dispose();
      toolCompletions.dispose();
      boundToolProviders?.dispose();
      boundToolProviders = null;
      graphDecorations.clear();
      textDecorations.clear();
    },
    setGraph(next) {
      graph = next;
      recomputeGraphDecorations();
    },
    setBoundTools(tools) {
      boundTools = tools;
      boundToolProviders?.dispose();
      boundToolProviders = registerBoundTools(tools);
      // The SI7 async-arrival fix: the tool-reference decorations depend on the tool list's
      // identity, so a list that lands AFTER mount (or changes on re-scan) recomputes them.
      recomputeTextDecorations();
    },
    setFilePaths(paths) {
      filePaths = paths;
    },
  };
}
