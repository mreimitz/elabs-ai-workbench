import { useLoadable, type Loadable } from "../../lib/loadable";
import {
  fetchDocsManifest,
  fetchDocument,
  type DocsManifest,
  type DocsManifestSubject,
} from "./docs-manifest";

/** The guide's table of contents. One fetch, shared by all three docs routes. */
export function useDocsManifest(): {
  state: Loadable<DocsManifest>;
  reload: () => void;
} {
  return useLoadable(() => fetchDocsManifest(), []);
}

/** One subject's documents, in manifest order, fetched together. */
export type LoadedDocument = { id: string; title: string; markdown: string };

export function useSubjectDocuments(
  subject: DocsManifestSubject | undefined,
): { state: Loadable<LoadedDocument[]>; reload: () => void } {
  return useLoadable(
    async () => {
      if (!subject) return [];
      return Promise.all(
        subject.documents.map(async (document) => ({
          id: document.id,
          title: document.title,
          markdown: await fetchDocument(document.path),
        })),
      );
    },
    [subject?.id],
    { enabled: subject !== undefined },
  );
}

/** The repository CHANGELOG's Markdown body. */
export function useChangelog(path: string | undefined): {
  state: Loadable<string>;
  reload: () => void;
} {
  return useLoadable(() => fetchDocument(path ?? "changelog.md"), [path], {
    enabled: path !== undefined,
  });
}
