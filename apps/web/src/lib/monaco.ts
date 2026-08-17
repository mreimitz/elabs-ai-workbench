// Shared read-only Monaco (`@elabs-ai/components-editor` CodeEditor) configuration — the single source for what
// used to be five near-identical `READ_ONLY_OPTIONS` copies (ToolDetailPanel, ArtifactPreview,
// TraceLeafDetail, SkillFileExplorer, SkillDiffView) and two `EXT_LANG` maps (the two skills views).
// Every JSON/code viewer in the app reads identically: folding + search, no minimap, soft wrap.

/** Read-only editor options: folding/search, no minimap, soft-wrap, indentation guides. */
export const READ_ONLY_OPTIONS = {
  readOnly: true,
  minimap: { enabled: false },
  folding: true,
  foldingHighlight: true,
  lineNumbers: "on" as const,
  scrollBeyondLastLine: false,
  wordWrap: "on" as const,
  automaticLayout: true,
  fontSize: 12,
  tabSize: 2,
  renderLineHighlight: "none" as const,
  guides: { indentation: true },
};

/** File extension → Monaco language id. */
export const EXT_LANG: Record<string, string> = {
  ts: "typescript",
  tsx: "typescript",
  js: "javascript",
  jsx: "javascript",
  json: "json",
  py: "python",
  rb: "ruby",
  go: "go",
  sh: "shell",
  bash: "shell",
  yml: "yaml",
  yaml: "yaml",
  toml: "ini",
  css: "css",
  html: "html",
  sql: "sql",
  md: "markdown",
  markdown: "markdown",
  txt: "plaintext",
};

/** Lowercased file extension (no dot), or "" when there is none. */
export function extOf(path: string): string {
  return path.split(".").pop()?.toLowerCase() ?? "";
}

/** Monaco language id for a file path, defaulting to plaintext. */
export function languageFor(path: string): string {
  return EXT_LANG[extOf(path)] ?? "plaintext";
}
