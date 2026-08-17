# Loading, streaming & placeholders

Mirrors the upstream brand-ui **loading-states** convention (new in `@elabs-ai/components-*` v1.6.0). It is
**purely additive** — existing `loading` props (DataTable, Gantt) and chart `status="loading"` are
the canonical APIs; nothing was renamed. This is the streaming-heavy surface of the app (the run
console / SSE conversation), so get the two signals right.

## Two orthogonal signals — keep them separate

- **`loading` — "no content yet."** Before the first byte. Render a **layout-shaped placeholder**
  (a `Skeleton` sized like the eventual content, or `StatePanel kind="loading"` for a full view),
  never a spinner that collapses the layout. Reserve image space with `AspectRatio` so bytes
  arriving cause **no CLS**. (`@elabs-ai/components-ui`: `LoadingState`/`StatePanel`/`Skeleton`/`Spinner`;
  `@elabs-ai/components-data` `DataTable` has `loading`+`loadingRows`; `@elabs-ai/components-ai` `Gallery` has `loading`+`expectedCount`.)
- **`isStreaming` — "partial content arriving."** Tokens/rows are streaming in. **Build the content
  up** as it arrives and **suppress transient artifacts** (don't fold a half-filled table, don't
  flash a half-parsed error). (`@elabs-ai/components-ai` `Reasoning isStreaming`, `Shimmer`.)

## Errors fire only on a TERMINAL, settled failure

An error slot must **not** render mid-stream. Surface an error only once the operation has settled
into a failed terminal state — an expected end-of-stream socket close after a terminal status is
**not** an error.

## How this app already does it (don't regress these)

- `apps/web/src/features/testing/use-run-stream.ts` — `terminalRef` swallows the expected
  post-terminal socket close and only sets `error` on a genuine **pre-terminal** drop; per-turn
  `streaming` flag distinguishes live turns.
- `ConversationPane.tsx` — `Shimmer` "Thinking…" + `PendingAssistant` for *no content yet*;
  `Reasoning isStreaming` / `ChatMarkdown streaming` for *partial*; `TerminalNotice` renders error/
  overflow **only** at terminal phases.
- `ChatMarkdown.tsx` — `complete = !isLast || !streaming` defers footer/catalog splits until the
  stream settles (no flicker while a table fills).
- `ToolCallCard.tsx` — derives running/complete/failed from **settled** step status; never flashes
  an error while a call is in flight.

When building new streaming UI, match these — and prefer the library's `loading`/`isStreaming`
props over hand-rolled spinners. Confirm a component's exact loading API via the **brand-ui MCP
server** (`docs`/`search`) or its `.d.ts`; never guess.
