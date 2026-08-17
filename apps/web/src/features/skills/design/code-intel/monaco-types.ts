import type { CodeEditorProps } from "@elabs-ai/components-editor";

// Skill IDE WP 9.3 (I10.5) — the monaco type aliases the code-intel module derives OFF the
// `@elabs-ai/components-editor` `CodeEditor.onMount(editor, monacoApi)` prop, so nothing here imports `monaco-editor`
// directly (the same anti-direct-import trick WP 8.2's `use-bound-tools.ts` + WP 5.2's marker plumbing
// use). Every import is `import type` → erased at build time (zero runtime cost, no bundler coupling).

type CodeEditorMount = NonNullable<CodeEditorProps["onMount"]>;

/** The standalone code editor handed to `onMount` (its first argument). */
export type MonacoEditor = Parameters<CodeEditorMount>[0];
/** The full monaco namespace handed to `onMount` (its second argument). */
export type MonacoApi = Parameters<CodeEditorMount>[1];
/** A live text model (non-null — callers guard `getModel()` first). */
export type MonacoModel = NonNullable<ReturnType<MonacoEditor["getModel"]>>;
/** One delta decoration (the element type `createDecorationsCollection` accepts). */
export type DeltaDecoration = NonNullable<
  Parameters<MonacoEditor["createDecorationsCollection"]>[0]
>[number];
/** A live decorations collection (`.set(…)` / `.clear()`). */
export type DecorationsCollection = ReturnType<MonacoEditor["createDecorationsCollection"]>;

/** Anything with a `dispose()` — the shared disposal contract every registration returns. */
export type Disposable = { dispose: () => void };
