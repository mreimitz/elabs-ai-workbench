import { useEffect, useState } from "react";
import type { BoundTool } from "@mcp-token-footprint/shared";
import type { CodeEditorProps } from "@elabs-ai/components-editor";
import { getErrorMessage } from "../../lib/errors";
import { getBoundTools } from "./skills-inspector-api";

// Skill IDE WP 8.2 (I9.3) — editor assistance sourced from the bound servers' persisted scans.
// This module owns the two halves of that surface: a fetcher hook for the bound-tools list, and a
// framework helper that registers Monaco completion + hover providers from it. Read-only over
// PERSISTED scans (the fetch never opens an MCP connection); the providers are ADVISORY overlays.
//
// The `onMount(editor, monacoApi)` callback of `@elabs-ai/components-editor`'s `CodeEditor` hands over the full
// monaco namespace + the standalone editor; deriving the two param types off the prop avoids a direct
// `monaco-editor` import (the same pattern WP 5.2's marker plumbing uses).
type CodeEditorMount = NonNullable<CodeEditorProps["onMount"]>;
type MonacoEditor = Parameters<CodeEditorMount>[0];
type MonacoApi = Parameters<CodeEditorMount>[1];

/**
 * Fetch the version's bound-tools list (Skill IDE WP 8.2). Returns `[]` (and registers nothing
 * downstream) for an unbound skill — the honest degradation the WP requires. `enabled` gates the
 * fetch so surfaces that only need it in a specific mode (e.g. the section-body editor only renders
 * in edit mode) don't hit the route needlessly. A failure degrades to an empty list + a captured
 * message; this is advisory tooling, never a load-blocking error.
 */
export function useBoundTools(
  skillId: string,
  versionId: string,
  enabled = true,
): { boundTools: BoundTool[]; loading: boolean; error: string | null } {
  const [boundTools, setBoundTools] = useState<BoundTool[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) {
      setBoundTools([]);
      setError(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    getBoundTools(skillId, versionId)
      .then((tools) => {
        if (!cancelled) setBoundTools(tools);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setBoundTools([]);
          setError(getErrorMessage(err, "Couldn’t load bound tools"));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [skillId, versionId, enabled]);

  return { boundTools, loading, error };
}

export type BoundToolProviderOptions = {
  /**
   * WP 8.5 hook — when provided, the hover popup offers a "Test this tool…" command link that calls
   * this with the hovered bound tool (already resolved to a `serverId`). NO caller supplies it in
   * WP 8.2, so the action stays HIDDEN (honest partial state — the runner it opens isn't built yet).
   */
  onTestTool?: (tool: BoundTool) => void;
};

/**
 * Register a completion + a hover provider driven by `boundTools`, SCOPED to a single `editor`'s
 * model, and return a disposer. Two guarantees the WP requires:
 *
 *  - **Scope:** every callback early-returns unless `model === editor.getModel()`, so the providers
 *    only fire in THIS editor (not the read-only excerpt viewer, the diff editor, or any other
 *    markdown model in the app).
 *  - **Dispose:** the returned `dispose()` disposes both provider registrations. The caller registers
 *    ONCE per mount and disposes on unmount / when the tool set changes, so providers never
 *    accumulate across remounts (no duplicate suggestions). Monaco registers completion/hover
 *    providers on the shared language registry, so without disposal each remount would leak another
 *    provider — disposal is load-bearing, not decorative.
 *
 * Completion is scoped to inline-code (backtick) context; hover fires on a backticked token that
 * matches a bound tool. Both are pure over the passed `boundTools` — no fetch, no scan.
 */
export function registerBoundToolProviders(
  monacoApi: MonacoApi,
  editor: MonacoEditor,
  boundTools: BoundTool[],
  options: BoundToolProviderOptions = {},
): { dispose: () => void } {
  // The "Test this tool…" command is only wired when a caller opts in (WP 8.5). Bound at the editor,
  // released when the editor itself disposes (standalone `addCommand` has no separate disposer).
  let commandId: string | null = null;
  if (options.onTestTool) {
    commandId = editor.addCommand(0, (..._args: unknown[]) => {
      const ref = _args.find(
        (arg): arg is { toolName: string; serverName?: string } =>
          typeof arg === "object" &&
          arg !== null &&
          typeof (arg as { toolName?: unknown }).toolName === "string",
      );
      if (!ref) return;
      const target = boundTools.find(
        (tool) =>
          tool.toolName === ref.toolName &&
          (ref.serverName === undefined || tool.serverName === ref.serverName),
      );
      if (target) options.onTestTool?.(target);
    });
  }

  const completion = monacoApi.languages.registerCompletionItemProvider("markdown", {
    triggerCharacters: ["`"],
    provideCompletionItems(model, position) {
      if (model !== editor.getModel() || boundTools.length === 0) return { suggestions: [] };
      const linePrefix = model.getValueInRange({
        startLineNumber: position.lineNumber,
        startColumn: 1,
        endLineNumber: position.lineNumber,
        endColumn: position.column,
      });
      // Inside an inline-code span iff an odd number of backticks precede the cursor.
      const insideBacktick = (linePrefix.match(/`/g)?.length ?? 0) % 2 === 1;
      const lastTick = linePrefix.lastIndexOf("`");
      if (!insideBacktick || lastTick < 0) return { suggestions: [] };
      // Replace only the partial tool name typed after the opening backtick.
      const range = {
        startLineNumber: position.lineNumber,
        startColumn: lastTick + 2,
        endLineNumber: position.lineNumber,
        endColumn: position.column,
      };
      const suggestions = boundTools.map((tool) => ({
        label: tool.toolName,
        kind: monacoApi.languages.CompletionItemKind.Function,
        insertText: tool.toolName,
        detail: tool.serverName,
        documentation: { value: hoverMarkdown(tool, null) },
        range,
      }));
      return { suggestions };
    },
  });

  const hover = monacoApi.languages.registerHoverProvider("markdown", {
    provideHover(model, position) {
      if (model !== editor.getModel()) return null;
      const token = inlineCodeTokenAt(model.getLineContent(position.lineNumber), position.column);
      if (!token) return null;
      const matches = boundTools.filter((tool) => tool.toolName === token.text);
      if (matches.length === 0) return null;
      const trusted = commandId !== null;
      return {
        range: {
          startLineNumber: position.lineNumber,
          startColumn: token.startColumn,
          endLineNumber: position.lineNumber,
          endColumn: token.endColumn,
        },
        contents: matches.map((tool) => ({
          value: hoverMarkdown(tool, commandId),
          isTrusted: trusted,
        })),
      };
    },
  });

  return {
    dispose() {
      completion.dispose();
      hover.dispose();
    },
  };
}

/** The inline-code (`` `token` ``) span containing 1-based `column` on `line`, or `null`. Columns are
 *  those of the inner text (the backticks excluded); the caret may sit just after the token too. */
function inlineCodeTokenAt(
  line: string,
  column: number,
): { text: string; startColumn: number; endColumn: number } | null {
  for (const match of line.matchAll(/`([^`]+)`/g)) {
    const inner = match[1] ?? "";
    const startColumn = (match.index ?? 0) + 2; // 1-based column of the first inner char (after the backtick)
    const endColumn = startColumn + inner.length; // 1-based column just past the last inner char
    if (column >= startColumn && column <= endColumn) {
      return { text: inner, startColumn, endColumn };
    }
  }
  return null;
}

/** The hover/documentation markdown for a bound tool: name + owning server, a description excerpt,
 *  the parameter list, the definition token cost, and — only when `commandId` is set (WP 8.5 opted
 *  in) — a trusted "Test this tool…" command link. */
function hoverMarkdown(tool: BoundTool, commandId: string | null): string {
  const lines: string[] = [`**\`${tool.toolName}\`** · ${tool.serverName}`];
  if (tool.description) lines.push("", excerpt(tool.description, 240));
  if (tool.schemaParams.length > 0) {
    lines.push("", "**Parameters**", "");
    for (const param of tool.schemaParams) {
      lines.push(`- \`${param.name}\`: ${param.type}${param.required ? " _(required)_" : ""}`);
    }
  } else {
    lines.push("", "_No parameters._");
  }
  lines.push("", `Definition cost: **${tool.definitionTokens.toLocaleString()}** tokens`);
  if (commandId) {
    const args = encodeURIComponent(
      JSON.stringify([{ toolName: tool.toolName, serverName: tool.serverName }]),
    );
    lines.push("", `[Test this tool…](command:${commandId}?${args})`);
  }
  return lines.join("\n");
}

/** Trim to `max` chars on a word boundary with an ellipsis (single-spaced, newlines collapsed). */
function excerpt(text: string, max: number): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  if (collapsed.length <= max) return collapsed;
  const clipped = collapsed.slice(0, max);
  const lastSpace = clipped.lastIndexOf(" ");
  return `${(lastSpace > max * 0.6 ? clipped.slice(0, lastSpace) : clipped).trimEnd()}…`;
}
