import { Link } from "react-router-dom";
import { Badge, Button, Heading, StatePanel, Text } from "@elabs-ai/components-ui";
import { PageShell } from "../../components/PageShell";
import { InlineError } from "../../components/InlineError";
import { DocProse } from "./DocProse";
import { DOCS_ROUTE_BASE } from "./docs-manifest";
import { useChangelog, useDocsManifest } from "./use-docs";

/**
 * `/docs/changelog` — the repository CHANGELOG, rendered (RM-18 WP 1.2).
 *
 * The payoff of the changelog-follows-the-work rule (`CLAUDE.md` §11): the discipline already
 * existed, but the record lived only in the repository. Now "what changed in this build" is
 * answerable by the person actually running it.
 *
 * `version` is the app version the API already reports on `GET /api/health` — App.tsx has it, so it
 * is threaded in rather than fetched again. NO version scheme is invented here: when the API has not
 * answered yet, the badge is simply absent.
 *
 * `changelog` is a RESERVED subject id — the generator refuses to emit a DC subject that would take
 * it — so this route can never be shadowed by a folder rename.
 */
export function ChangelogView({ version }: { version?: string | null }) {
  const { state: manifestState, reload: reloadManifest } = useDocsManifest();
  const changelogPath =
    manifestState.status === "data" ? manifestState.data.changelog.path : undefined;
  const { state, reload } = useChangelog(changelogPath);

  return (
    <PageShell
      width="centered"
      scroll="body"
      header={
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex min-w-0 items-center gap-2">
            <Heading level={1} size="title">
              Changelog
            </Heading>
            {version ? (
              <Badge variant="secondary" className="tabular-nums">
                v{version}
              </Badge>
            ) : null}
          </div>
          <Text variant="meta" tone="muted">
            Every notable change to this application, newest first.
          </Text>
        </div>
      }
    >
      {manifestState.status === "error" ? (
        <InlineError
          level={2}
          title="Couldn’t load the guide"
          detail={manifestState.error}
          onRetry={reloadManifest}
        />
      ) : state.status === "loading" ? (
        <StatePanel kind="loading" loadingLabel="Loading the changelog…" />
      ) : state.status === "error" ? (
        <InlineError
          level={2}
          title="Couldn’t load the changelog"
          detail={state.error}
          onRetry={reload}
        />
      ) : (
        <div className="flex min-w-0 flex-col gap-8">
          <DocProse markdown={state.data} />
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
