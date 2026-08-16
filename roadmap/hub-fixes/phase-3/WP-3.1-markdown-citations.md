# WP 3.1 — markdown + inline citation chips together

**Phase:** 3 · **Size:** M · **Depends on:** — · **Model:** Sonnet · **Agent profile:** web

## Objective

Cited answers render as real markdown WITH inline citation chips, instead of raw `##`/`**`/`|—|`
text. This kills RC4's rendering half for every hub surface (mission synthesis, research answers,
any cited chat turn).

## Why / evidence

`analysis.md` RC4: `renderCitedText` returns a node array whenever any `[n]` resolves
(`SourcesPanel.tsx:113-131`), and the array branch renders in a plain `whitespace-pre-wrap Text`
(`ConversationPane.tsx:918-921`) — the comment admits "markdown yields to the inline-citation
MUST". The live synthesis (citations `["1"]` + `[1]` markers + headings/tables) always hits it.
The dock proves the fix shape: unconditional markdown via `ChatMarkdown`
(`features/testing/ChatMarkdown.tsx`, used by `AssistantMessageBody.tsx:36-48`).

## Design

- Render cited assistant text through the Streamdown-based markdown path ALWAYS
  (`MessageResponse` or the shared `ChatMarkdown` — prefer promoting `ChatMarkdown` for the table/
  typography overrides, library-first).
- Weave chips inside markdown via a custom renderer override: post-process rendered text nodes,
  replacing resolvable `[n]` tokens with `InlineCitationChip` (same resolution rules as today:
  orphan markers stay literal; never a chip that points nowhere). Implementation options in order
  of preference: Streamdown `components` text-level override (the dock already overrides `a` this
  way) → a small rehype transform → LAST resort: pre-split into markdown segments between markers
  and render each segment via markdown with chips interleaved (block-level markdown must survive:
  a `[1]` inside a table cell or heading must not break the table/heading).
- `renderCitedText` keeps its export for the SourcesPanel preview but ConversationPane stops using
  it for body rendering.

## Files (exclusive)

- `apps/web/src/features/hub/ConversationPane.tsx` (text-part branch), `SourcesPanel.tsx` (weaver refactor/export)
- Possibly promote `apps/web/src/features/testing/ChatMarkdown.tsx` → a shared location (follow the repo's library-first rule; keep the dock import working)
- Tests: `ConversationPane.test.tsx` + a regression fixture that is EXACTLY the live synthesis shape (citations id `"1"`, `[1]` markers, `##` headings, a markdown table) asserting: `<table>` renders, headings render, chips render inline, no literal `##`

## Acceptance

- [ ] Live-shape regression test green (the RC4 fixture above).
- [ ] Uncited answers byte-identical to before (existing tests untouched).
- [ ] Orphan `[99]` stays literal text inside rendered markdown; chip popovers still open the source panel.
- [ ] Markdown inside tables/headings with adjacent chips renders correctly; sanitization unchanged (no raw-HTML injection via citation titles — add a hostile-title test).
- [ ] Both themes visually sane (chip contrast tokens only).
- [ ] Gate green.
