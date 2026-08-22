/**
 * Types for `build-docs-bundle.mjs` — RM-18 WP 1.2.
 *
 * The generator is a plain `.mjs` build script (it runs under bare `node`, before any TypeScript
 * build step exists), so this declaration file is what lets its co-located vitest suite import it
 * under `strict` + `noUncheckedIndexedAccess`. The shipped MANIFEST shape is declared once, in
 * `apps/web/src/features/docs/docs-manifest.ts`, and re-used here so the writer and the reader
 * cannot drift.
 */
import type { DocsManifest } from "../apps/web/src/features/docs/docs-manifest.js";

export declare const DOCS_MANIFEST_SCHEMA: 1;
export declare const RESERVED_SUBJECT_ID: "changelog";

export type FrontmatterFields = Record<string, string>;

export type ShippedDocument = {
  id: string;
  title: string;
  description: string;
  fileName: string;
  body: string;
};

/** A subject that ships (`skipped: false`) or one with no guide page yet (`skipped: true`). */
export type CollectedSubject =
  | { id: string; tag: string; dirName: string; skipped: true }
  | {
      id: string;
      tag: string;
      dirName: string;
      skipped: false;
      title: string;
      description: string;
      documents: ShippedDocument[];
      assetDirs: string[];
    };

export type ShippedIndex = {
  documentsByPath: Map<string, { subjectId: string; documentId: string }>;
  assetsByPath: Map<string, string>;
};

export type RewriteContext = { subjectDir: string; index: ShippedIndex };

export type BuildResult = {
  manifest: DocsManifest;
  outDir: string;
  documentCount: number;
  assetCount: number;
  unresolvedLinks: number;
  skipped: string[];
};

export declare function parseFrontmatter(source: string): {
  fields: FrontmatterFields;
  body: string;
};
export declare function rewriteLink(target: string, context: RewriteContext): string | null;
export declare function rewriteLinks(
  markdown: string,
  context: RewriteContext,
): { markdown: string; unresolved: number };
export declare function collectSubjects(userGuideDir: string): CollectedSubject[];
export declare function buildDocsBundle(options: {
  repoRoot: string;
  outDir: string;
}): BuildResult;
