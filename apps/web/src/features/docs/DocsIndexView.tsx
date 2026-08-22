import { Link } from "react-router-dom";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Heading,
  StatePanel,
  Text,
} from "@elabs-ai/components-ui";
import { PageShell } from "../../components/PageShell";
import { InlineError } from "../../components/InlineError";
import { CHANGELOG_ROUTE } from "./help-map";
import { DOCS_ROUTE_BASE } from "./docs-manifest";
import { useDocsManifest } from "./use-docs";

/**
 * `/docs` — the user guide's index (RM-18 WP 1.2).
 *
 * Routes-vs-dialogs (D-TB10): a page of the manual is a PLACE — bookmarked, pasted to a colleague,
 * reloaded — so the guide is three routes, not a dialog. This one renders the whole table of
 * contents with ZERO query params.
 *
 * The documents come from `/doc-content/manifest.json`, written into the web build by
 * `scripts/build-docs-bundle.mjs`. Nothing here reads the repository, so it works identically in the
 * container, where `planning/` is not on disk.
 *
 * Deliberately NO nav item (a non-goal of the WP): reached from the top-bar Help control and by URL.
 * Where the guide belongs in the sidebar is an IA decision for the owner, exactly as `/illustrations`
 * was left.
 */
export function DocsIndexView() {
  const { state, reload } = useDocsManifest();

  return (
    <PageShell
      width="centered"
      scroll="body"
      header={
        <div className="flex min-w-0 flex-col gap-1">
          <Heading level={1} size="title">
            User guide
          </Heading>
          <Text variant="meta" tone="muted">
            The manual that ships with this build, readable without leaving the app.
          </Text>
        </div>
      }
    >
      {state.status === "loading" ? (
        <StatePanel kind="loading" loadingLabel="Loading the guide…" />
      ) : state.status === "error" ? (
        <InlineError
          level={2}
          title="Couldn’t load the guide"
          detail={state.error}
          onRetry={reload}
        />
      ) : (
        <div className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            {state.data.subjects.map((subject) => (
              <Card key={subject.id} className="min-w-0">
                <CardHeader>
                  <CardTitle className="min-w-0">
                    <Link
                      to={`${DOCS_ROUTE_BASE}/${subject.id}`}
                      className="underline-offset-2 hover:underline"
                    >
                      {subject.title}
                    </Link>
                  </CardTitle>
                  {subject.description ? (
                    <CardDescription measure>{subject.description}</CardDescription>
                  ) : null}
                </CardHeader>
                <CardContent>
                  <ul className="flex flex-col gap-1">
                    {subject.documents.map((document) => (
                      <li key={document.id} className="min-w-0">
                        <Link
                          to={`${DOCS_ROUTE_BASE}/${subject.id}#${document.id}`}
                          className="text-caption text-primary underline underline-offset-2"
                        >
                          {document.title}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* The changelog is a reserved subject, not a DC folder — so it gets its own card rather
              than a row in the grid above. "What changed in this build" is the one question the
              guide itself cannot answer. */}
          <Card className="min-w-0">
            <CardHeader>
              <CardTitle className="min-w-0">
                <Link to={CHANGELOG_ROUTE} className="underline-offset-2 hover:underline">
                  {state.data.changelog.title}
                </Link>
              </CardTitle>
              <CardDescription measure>
                Every notable change to this application, newest first.
              </CardDescription>
            </CardHeader>
          </Card>
        </div>
      )}
    </PageShell>
  );
}
