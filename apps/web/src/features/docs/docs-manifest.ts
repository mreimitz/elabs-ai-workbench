/**
 * docs-manifest.ts — RM-18 WP 1.2. The reader for the build-time docs bundle.
 * =================================================================================================
 *
 * `scripts/build-docs-bundle.mjs` writes `apps/web/public/doc-content/`; Vite copies that verbatim
 * into `apps/web/dist/`, and the API serves `apps/web/dist` at prefix `/`. So the guide reaches the
 * browser as PLAIN STATIC FILES — there is no API endpoint, no repository access at runtime, and the
 * container needs nothing from `planning/` (which its runtime stage does not carry).
 *
 * WHY `/doc-content/` AND NOT `/docs/`
 *   `/docs/*` is the client ROUTE. The API's not-found handler falls back to `index.html` for any
 *   non-`/api/` URL, so a static directory called `docs/` would be competing with the SPA route for
 *   URLs like `/docs/manifest.json`. Naming the two differently removes the race entirely rather
 *   than depending on plugin ordering. `docs-collision.test.ts` pins both halves.
 *
 * WHY A HAND-WRITTEN VALIDATOR
 *   The manifest is build output, not user input, but it can still be STALE — an old `dist` served
 *   after the shape changed. `parseDocsManifest` checks the schema number and every field it will
 *   dereference, and returns `null` rather than letting a half-shaped object reach the renderer. No
 *   dependency is added for it (D: `.claude/rules/dependencies.md` — a new runtime dep is
 *   owner-gated, and this needs ~40 lines).
 */

/** Where the generated bundle is served from. NOT `/docs`, which is the client route — see above. */
export const DOC_CONTENT_BASE = "/doc-content";

/** The client route prefix for the guide. NOT `doc-content`, which is the static directory. */
export const DOCS_ROUTE_BASE = "/docs";

/** The reserved subject id: `/docs/changelog` renders the repository CHANGELOG, not a DC subject. */
export const CHANGELOG_SUBJECT_ID = "changelog";

/** The manifest shape version this reader understands. */
export const DOCS_MANIFEST_SCHEMA = 1;

export type DocsManifestDocument = {
  /** Stable id (the source filename without `.md`) — also the in-page anchor on the subject page. */
  id: string;
  title: string;
  description: string;
  /** Path under {@link DOC_CONTENT_BASE}, e.g. `getting-started/00-guide-map.md`. */
  path: string;
};

export type DocsManifestSubject = {
  /** The DC folder slug, e.g. `getting-started`. The `:subject` route param. */
  id: string;
  /** The OKF tag, e.g. `DC-01`. */
  tag: string;
  title: string;
  description: string;
  /** Never empty — the generator refuses to emit a subject with no shipped document. */
  documents: DocsManifestDocument[];
};

export type DocsManifest = {
  schema: 1;
  subjects: DocsManifestSubject[];
  changelog: { id: string; title: string; path: string };
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readString(source: Record<string, unknown>, key: string): string | null {
  const value = source[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * Validate a parsed `manifest.json`. Returns `null` for anything this reader would have to guess
 * about — a wrong schema number, a missing id/path, or a subject with no documents (which the
 * generator cannot produce, so seeing one means the bundle is not the one this build wrote).
 */
export function parseDocsManifest(input: unknown): DocsManifest | null {
  if (!isRecord(input) || input.schema !== DOCS_MANIFEST_SCHEMA) return null;
  if (!Array.isArray(input.subjects) || !isRecord(input.changelog)) return null;

  const changelogId = readString(input.changelog, "id");
  const changelogTitle = readString(input.changelog, "title");
  const changelogPath = readString(input.changelog, "path");
  if (!changelogId || !changelogTitle || !changelogPath) return null;

  const subjects: DocsManifestSubject[] = [];
  for (const raw of input.subjects) {
    if (!isRecord(raw)) return null;
    const id = readString(raw, "id");
    const tag = readString(raw, "tag");
    const title = readString(raw, "title");
    if (!id || !tag || !title || !Array.isArray(raw.documents) || raw.documents.length === 0) {
      return null;
    }
    const documents: DocsManifestDocument[] = [];
    for (const rawDocument of raw.documents) {
      if (!isRecord(rawDocument)) return null;
      const documentId = readString(rawDocument, "id");
      const documentTitle = readString(rawDocument, "title");
      const path = readString(rawDocument, "path");
      if (!documentId || !documentTitle || !path) return null;
      documents.push({
        id: documentId,
        title: documentTitle,
        description: typeof rawDocument.description === "string" ? rawDocument.description : "",
        path,
      });
    }
    subjects.push({
      id,
      tag,
      title,
      description: typeof raw.description === "string" ? raw.description : "",
      documents,
    });
  }

  return {
    schema: DOCS_MANIFEST_SCHEMA,
    subjects,
    changelog: { id: changelogId, title: changelogTitle, path: changelogPath },
  };
}

/** Find one subject by its route param. */
export function findSubject(
  manifest: DocsManifest,
  subjectId: string,
): DocsManifestSubject | undefined {
  return manifest.subjects.find((subject) => subject.id === subjectId);
}

/** Fetch + validate the manifest. Throws a readable message; the views render it as an error state. */
export async function fetchDocsManifest(signal?: AbortSignal): Promise<DocsManifest> {
  const response = await fetch(`${DOC_CONTENT_BASE}/manifest.json`, { signal });
  if (!response.ok) {
    throw new Error(`The documentation bundle is not available (HTTP ${response.status}).`);
  }
  const manifest = parseDocsManifest(await response.json());
  if (!manifest) {
    throw new Error(
      "The documentation bundle on this server was written by a different build and cannot be read.",
    );
  }
  return manifest;
}

/** Fetch one document's Markdown body from the bundle. */
export async function fetchDocument(path: string, signal?: AbortSignal): Promise<string> {
  const response = await fetch(`${DOC_CONTENT_BASE}/${path}`, { signal });
  if (!response.ok) {
    throw new Error(`Could not load ${path} (HTTP ${response.status}).`);
  }
  return response.text();
}
