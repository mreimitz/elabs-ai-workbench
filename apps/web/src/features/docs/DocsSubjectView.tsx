import { useEffect } from "react";
import { Link, useParams } from "react-router-dom";
import { Button, Heading, StatePanel, Text } from "@elabs-ai/components-ui";
import { PageShell } from "../../components/PageShell";
import { InlineError } from "../../components/InlineError";
import { useRouteCrumb } from "../../components/route-crumb";
import { DocProse } from "./DocProse";
import { DOCS_ROUTE_BASE, findSubject } from "./docs-manifest";
import { useDocsManifest, useSubjectDocuments } from "./use-docs";

/**
 * `/docs/:subject` — one subject of the guide (RM-18 WP 1.2).
 *
 * A subject renders ALL of its documents on one page, each in a `<section id="…">`. That is what
 * makes the generator's link rewriting work: a cross-reference to another guide page becomes
 * `/docs/<subject>#<document>`, and both a same-page and a cross-page jump land on a real anchor.
 *
 * A subject id that does not exist renders a real not-found state with a way back — NOT a blank
 * page, and not a silent redirect to the index (which would hide a bad bookmark rather than explain
 * it). `/docs/manifest.json` lands here too, since the static bundle deliberately lives at
 * `/doc-content/` — see `docs-collision.test.tsx`.
 */
export function DocsSubjectView() {
  const { subject: subjectId } = useParams<{ subject: string }>();
  const { state: manifestState, reload: reloadManifest } = useDocsManifest();
  const subject =
    manifestState.status === "data" && subjectId
      ? findSubject(manifestState.data, subjectId)
      : undefined;
  const { state: documentsState, reload: reloadDocuments } = useSubjectDocuments(subject);

  // The breadcrumb leaf is the subject's real title, published once it resolves (see route-crumb).
  useRouteCrumb(subject?.title ?? null);

  // A `#document` in the URL must survive the fetch: the anchor does not exist at mount, so the
  // browser's own scroll-to-fragment has nothing to hit. Re-run it once the documents are in.
  useEffect(() => {
    if (documentsState.status !== "data") return;
    const hash = window.location.hash.slice(1);
    if (!hash) return;
    document.getElementById(hash)?.scrollIntoView();
  }, [documentsState.status]);

  const notFound = manifestState.status === "data" && subject === undefined;

  return (
    <PageShell
      width="centered"
      scroll="body"
      header={
        <div className="flex min-w-0 flex-col gap-1">
          <Heading level={1} size="title">
            {subject?.title ?? "User guide"}
          </Heading>
          <Text variant="meta" tone="muted">
            {subject ? subject.description || subject.tag : "A page of the shipped manual."}
          </Text>
        </div>
      }
    >
      {manifestState.status === "loading" ? (
        <StatePanel kind="loading" loadingLabel="Loading the guide…" />
      ) : manifestState.status === "error" ? (
        <InlineError
          level={2}
          title="Couldn’t load the guide"
          detail={manifestState.error}
          onRetry={reloadManifest}
        />
      ) : notFound ? (
        <StatePanel
          kind="empty"
          title="No such page in the guide"
          description={`This build's guide has no section called “${subjectId ?? ""}”. It may have been renamed since the link was made.`}
          actions={
            <Button asChild variant="outline">
              <Link to={DOCS_ROUTE_BASE}>Back to the guide</Link>
            </Button>
          }
        />
      ) : documentsState.status === "loading" ? (
        <StatePanel kind="loading" loadingLabel="Loading this section…" />
      ) : documentsState.status === "error" ? (
        <InlineError
          level={2}
          title="Couldn’t load this section"
          detail={documentsState.error}
          onRetry={reloadDocuments}
        />
      ) : (
        <div className="flex min-w-0 flex-col gap-8">
          {/* On this page — only worth showing when the subject really has several documents. */}
          {documentsState.data.length > 1 ? (
            <nav aria-label="On this page" className="flex min-w-0 flex-col gap-1">
              <Text variant="meta" tone="muted" as="span">
                On this page
              </Text>
              <ul className="flex flex-col gap-1">
                {documentsState.data.map((document) => (
                  <li key={document.id} className="min-w-0">
                    <a
                      href={`#${document.id}`}
                      className="text-caption text-primary underline underline-offset-2"
                    >
                      {document.title}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
          ) : null}

          {documentsState.data.map((document) => (
            // `scroll-mt-*` keeps a jumped-to section clear of PageShell's sticky header.
            <section key={document.id} id={document.id} className="min-w-0 scroll-mt-4">
              <DocProse markdown={document.markdown} />
            </section>
          ))}

          <div className="min-w-0">
            <Button asChild variant="outline" size="sm">
              <Link to={DOCS_ROUTE_BASE}>Back to the guide</Link>
            </Button>
          </div>
        </div>
      )}
    </PageShell>
  );
}
