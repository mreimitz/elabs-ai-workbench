import { Fragment, type ReactNode } from "react";

/**
 * Observability (WP3.4) — renders the ONE bracket-delimited snippet convention `run-search.ts`
 * produces (`…before[match]after…`, mirroring the WP1.3 FTS5 `snippet()` shape) with the matched span
 * wrapped in a token-backed `<mark>`. No `@elabs-ai/components-*` component covers inline text highlighting (checked
 * via the brand-ui MCP `search "mark highlight"` — none), so this is a minimal, semantic-token-only
 * composition (`bg-primary/20` + `text-foreground` — no raw color), not a hand-rolled UI primitive.
 */
export function HighlightedSnippet({ snippet }: { snippet: string }): ReactNode {
  const parts: ReactNode[] = [];
  const re = /\[([^\]]*)\]/g;
  let last = 0;
  let key = 0;
  let match: RegExpExecArray | null = re.exec(snippet);
  while (match !== null) {
    if (match.index > last) {
      parts.push(<Fragment key={key++}>{snippet.slice(last, match.index)}</Fragment>);
    }
    parts.push(
      <mark key={key++} className="rounded-sm bg-primary/20 px-0.5 text-foreground">
        {match[1]}
      </mark>,
    );
    last = re.lastIndex;
    match = re.exec(snippet);
  }
  if (last < snippet.length) {
    parts.push(<Fragment key={key++}>{snippet.slice(last)}</Fragment>);
  }
  return <>{parts}</>;
}

/**
 * Highlight the first literal (case-insensitive) occurrence of `query` within `text` — used where
 * there's no pre-built snippet (e.g. a StepLog tree row's visible label). Renders the plain text
 * unchanged when the query is empty or doesn't literally appear in it (the row may still match
 * OVERALL on its full payload haystack — this only marks what's visibly present).
 */
export function HighlightMatch({ text, query }: { text: string; query: string }): ReactNode {
  const needle = query.trim();
  if (needle.length === 0) return <>{text}</>;
  const idx = text.toLowerCase().indexOf(needle.toLowerCase());
  if (idx === -1) return <>{text}</>;
  return (
    <>
      {text.slice(0, idx)}
      <mark className="rounded-sm bg-primary/20 px-0.5 text-foreground">
        {text.slice(idx, idx + needle.length)}
      </mark>
      {text.slice(idx + needle.length)}
    </>
  );
}
