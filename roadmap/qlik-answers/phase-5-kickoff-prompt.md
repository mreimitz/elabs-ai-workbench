# Qlik Answers Phase 5 — orchestrator kickoff prompt

Paste the block below as the first message of a fresh Claude Code session started in
`mcp-token-footprint/`. Record deviations in `STATUS.md`'s Decision log.

---

You are the orchestrator for **qlik-answers Phase 5 (answer rendering rework)**. You select, brief, validate, merge, and tick — sub-agents implement, one worktree per WP.

READ FIRST, in order: `roadmap/qlik-answers/phase-5-answer-rendering.md` (the plan: evidence table, decisions D-QA8–D-QA13, seams, WP index, batch map), `roadmap/qlik-answers/STATUS.md` §Phase 5 (authoritative ledger) + its Decision log tail, `roadmap/qlik-answers/README.md` (D-QA1–D-QA7 context; naming rule), `.claude/skills/next-wp/SKILL.md`, `.claude/rules/quality-gates.md`, `.claude/rules/brand-ui-only.md`, `.claude/rules/loading-states.md`. Decisions D-QA8–D-QA13 are proposed defaults locked at kickoff — if one seems wrong in the code, STOP and ask the owner; do not silently re-plan.

MISSION: drive WPs 5.1–5.6 to done, one reviewed batch at a time. Batch map: **5.1 solo** (touches `packages/shared`) · 5.2 ∥ 5.5 · 5.3 ∥ 5.4 · 5.6. Spawn a batch's sub-agents in one message, each in its own worktree; integrate via a dedicated main worktree if the shared checkout is contested (see the STATUS "toolbar collision" precedent).

GROUND TRUTH FOR FIXTURES: the live run `hHGgqkU58F_xYv0e-nHKC` (replayable via `GET /api/runs/hHGgqkU58F_xYv0e-nHKC` on the running app, http://localhost:8080). Its `steps[1].payload.rawResponse` is the real Adaptive-Card shape: `content[0].card.body[]` = "Conclusion" TextBlock → interleaved narrative TextBlocks (with `<citation data-index="N">` markers) + 5 `Qlik.Snapshot` blocks whose `snapshot.data.qHyperCube` carries real matrices (1×1, 20×4, 20×2, 15×2, 20×3), then an ActionSet + hidden Container. `payload.reasoning` (11.6 KB) is the phase-structured stream whose tail duplicates `assistantText`. WP 5.2's fixtures must be cut from this shape (trimmed, not invented). No real tenant is ever contacted — extraction is pure functions over persisted data.

HARD CONSTRAINTS
1. **Grader invariant (the one thing that must not move):** `assistantText` and `reasoning` outputs of `qlik-answers-message.ts` stay byte-identical; every pre-existing `qlik-answers-*` test passes unchanged. Blocks/data/citations are ADDITIVE derivations. Grading code is out of scope entirely.
2. **No migration, no persistence change.** `blocks`/`data` are derived from the already-persisted `rawResponse` — at event-emit time in the executor and at replay read for legacy steps (D-QA8). Beware `run-repository.ts` redaction: keys matching `…Tokens` get rewritten on persist (the WP 3.1 `promptMode` lesson) — never name or rely on a payload field that redaction mangles.
3. Contract-first: WP 5.1 lands types + zod in `packages/shared` before 5.2/5.3/5.4 start; additive wire only. `packages/shared` writers serialize across ALL workstreams — confirm it's free before spawning 5.1.
4. **Verbatim fallbacks everywhere:** a parse miss (blocks, phases, hypercube) must render exactly what renders today — never drop text, never a broken card. WP 5.3's renderer falls back to `ChatMarkdown(assistantText)` when `blocks` is absent; non-qlik runs are provably byte-identical (existing ConversationPane/KpiRail tests stay green).
5. brand-ui only (`@brand/*`, semantic tokens, both themes `qlik-bright`/`qlik-dark`, `tabular-nums` on data cells); loading-states rule (settled payload only — the answers payload exists only post-terminal, never render blocks mid-stream); naming rule: `qlik-answers-` module prefix, never bare "assistant" (`apps/api/src/assistant/*` is the Claude dock — do not touch it).
6. Gate = `pnpm typecheck && pnpm test && pnpm build && pnpm lint` — green in the worktree before handback, green on `main` after merge; no tick without it. Merges to `main` serialize; never push to origin (owner-gated).
7. Honest reporting: web WPs (5.3/5.4/5.5) claim tests/typecheck/build/lint only — both-theme + keyboard walks and the citation-scroll feel are OWNER-ACCEPTANCE (already listed in the ledger), never claimed by you. Web tests are REQUIRED (the repo has a web test runner — the WP 3.2 "no runner" note was stale).

MODEL MAP
- **Opus-tier** — WP 5.2 (the extraction rework: ordered walk, hypercube labeling from `qDimensionInfo`/`qMeasureInfo`, citation indexing, phase parser + dedupe heuristic, replay-derivation seam — highest judgment + the grader invariant lives here) and WP 5.3 (the answer renderer: block composition, citation anchor-scroll, fallback correctness in the most-looked-at surface of the app).
- **Sonnet** — WP 5.1 (shapes fully specified in the plan), 5.4 (insights/reasoning rework — patterns established by 5.2's types + SourcesPanel precedents), 5.5 (kind-switch on existing `providerKind` plumbing), 5.6 (report parity + docs).
- **Haiku** — read-only verification only (seam anchors, fixture-shape checks, ledger cross-checks).

PER-WP BRIEF must include: the WP row + the relevant plan sections verbatim (for 5.2: the evidence table + D-QA8–D-QA11; for 5.3/5.4: D-QA9/D-QA10/D-QA13 + the seams list); constraints 1–5; expected files; a do-NOT-touch list (grading/*, run-repository.ts, apps/api/src/assistant/*, packages/shared unless the WP owns it); the gate; honest reporting; pattern pointers (`qlik-answers-message.test.ts` fixture style, `SourcesPanel.tsx`, `ConversationPane.tsx` AssistantTurn, `KpiRail.tsx` kind handling, `lib/table.tsx` `col` helper, `consoleAnchor` in ConversationPane for the citation scroll).

VALIDATION LOOP per returned WP: read the full diff; run the gate in the worktree; check the invariants (grader byte-identity via the untouched tests, additive wire, verbatim fallbacks present + tested, no raw colors, no new deps, non-qlik surfaces untouched); rebase on `main`, re-gate if it moved; merge; tick the ledger with date + `wp/qlik-answers/5.x`; Decision-log every deviation. Send defects back concretely; small mechanical fixes allowed — note them.

STOP AND ASK THE OWNER when: a D-QA8–13 default conflicts with reality in the code; the hypercube shape in a fixture doesn't match the plan's evidence table; a brand-ui gap would force a raw element; `packages/shared` contention is unknown; or two sessions want `main` at once.

Begin: load the ledger, run a Haiku read-only pre-flight (verify the seams listed in the plan §The seams still anchor — file + symbol level; confirm `packages/shared` is free), then spawn WP 5.1 (Sonnet) with the brief, and report the batch plan for the session.
