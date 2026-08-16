# WP 3.4 — In-run search + view lenses

**Phase:** 3 — Console depth · **Size:** M · **Depends on:** 1.3 · **Model:** Sonnet

## Objective

Find things inside one long session: a search box scoped to the open run (client-side over
loaded steps, FTS-backed for replayed history), plus a compact "Turns" lens for long
interactive sessions (the LangSmith M/T/D idea, scoped to what our console needs).

## Design

- In-run search: console header search input; live runs search the in-memory step accumulator
  (case-insensitive, all text fields); replayed runs additionally query
  `GET /api/runs?filter={q, runId}`-style scoped FTS (reuse 1.3 with a run-scoped filter) so
  truncation-indexed content stays findable. Matches: highlight + prev/next navigation
  (keyboard `n`/`p`), count chip, filter-to-matches toggle for the StepLog ("Filtered only" /
  "Show all" — the LangSmith in-trace pattern).
- Lenses: a view switcher (Conversation · Steps · Turns) — Conversation and Steps are today's
  panes formalized; **Turns** renders per-turn summary cards (first line of user prompt, first
  line of reply, per-turn chips: duration, tokens Δ, tool count, feedback) for fast scanning of
  long interactive sessions. Keyboard switching (existing shortcut conventions).
- State URL-persisted (`?lens=turns&find=…`) for shareable deep links into a session.

## Files

- `apps/web/src/features/testing/{RunConsole,ConversationPane,StepLog}.tsx` + a
  `TurnsLens.tsx` + search hook (+ tests)
- `apps/web/src/lib/api.ts` (scoped search call)

## Acceptance

- [ ] Search finds across prompts/replies/tool text/errors in a live fixture; prev/next +
      highlight + filtered-only work; replay path hits the FTS route (stubbed) and merges.
- [ ] Turns lens renders correct per-turn summaries incl. chips; switching lenses preserves
      scroll target (selected step stays anchored).
- [ ] URL round-trip for lens + query.
- [ ] Both-theme + keyboard = owner-acceptance. Gate green.

## Notes

Owns the console cluster for its batch (after 3.2 merges). Do not re-implement match logic
twice — one helper, two data sources.
