# Benchmarks — kickoff prompt for the implementing agent

> Operational prompt, **not a spec**. Paste into a fresh Claude Code (Opus) session at the repo
> root (`mcp-token-footprint/`). The specs it points to are authoritative; this file just
> establishes the mandate. Safe to delete after the workstream ships.

---

# Mission: implement the Benchmarks workstream end to end

You are the **product owner and tech lead** for the **Benchmarks** feature of
`mcp-token-footprint`. You own it end to end: planning, parallel implementation across
subagents, validation, and an honest hand-off. The mission is the **entire workstream**
(Phases 1–5, WPs 1.1 → 5.1), delivered wave by wave — not just the first WP.

## 0. Ground yourself (read in this order, before any code)

1. `CLAUDE.md` — project ground truth (stack, commands, boundaries, quality gate).
2. `roadmap/benchmarks/00-architecture.md` — **locked owner decisions B1–B15. Do not
   relitigate, reinterpret, or "improve" them.**
3. `roadmap/benchmarks/README.md` — WP index, dependency graph, waves W1–W6.
4. `roadmap/benchmarks/conventions.md` — hard invariants (grading never blocks runs, graders
   never execute anything, append-only grades, judge-cost ledger, sync/PAT discipline).
5. `roadmap/benchmarks/phase-*.md` — per-WP specs (Objective / Files / Rules / Acceptance).
6. `roadmap/benchmarks/STATUS.md` — the ledger. Single source of truth for progress; only you
   write it.
7. `.claude/rules/` — all bind you: `brand-ui-only`, `quality-gates`, `mcp-and-security`,
   `dependencies`, `library-first`, `styling-and-tokens`, `loading-states`,
   `interaction-guidelines`, `architecture`.
8. Concept origin (context): `roadmap/research/insights-bench-assessment.md`.
9. Code you will extend — read before designing: `apps/api/src/testing/` (run-service
   post-completion assertion hook, `resolution.ts`, `skill-context.ts`, run-manager SSE
   pattern), `apps/api/src/skills/git-service.ts` + `publish-service.ts` (credential/SSRF
   discipline to extract and reuse — one implementation), `apps/api/src/providers/`
   (+ `pricing.ts`), `apps/api/src/db/{schema,database}.ts` (versioned migrations),
   `packages/shared/src/*`, `apps/web/src/features/testing/`.

## 1. Your mandate as product owner

- Deliver B1–B15 faithfully. Where a spec leaves micro-decisions open, decide **within the
  locked bounds** and record each one in a `## Decision log` section you append to
  `roadmap/benchmarks/STATUS.md` (date + one line + rationale).
- **STOP and ask the owner** (Manuel) — do not proceed — when a change would: add any runtime
  dependency (ajv is explicitly owner-gated; ROUGE-1 and the JSON-Schema subset checker are
  in-house by decision), touch `vendor/brand/*` or bump `@elabs-ai/components-*`, add a non-`@elabs-ai/components-*` UI
  dependency, weaken any hook/guardrail/secret rule, contradict a B-decision or a
  `conventions.md` invariant, or require a breaking (non-additive) API change.
- You may split/merge/resequence WPs if execution reveals a better cut — update the README WP
  index and the ledger together, note it in the decision log.
- The **Owner acceptance** checkboxes at the bottom of STATUS.md are Manuel's. Leave them
  unticked; prepare everything so he can walk them quickly (exact URLs, fixture names, steps).

## 2. Execution model — waves, subagents, worktrees

The repo's canonical orchestrator is the `/next-wp` skill (`.claude/skills/next-wp/`):
plan → parallel worktree subagents → validate → tick the ledger. Drive the workstream with
`/next-wp benchmarks` wave by wave; if you orchestrate manually, replicate its discipline:

- **Waves:** W1 `1.1` (solo — the contract; everything depends on it) → W2 `1.2 ∥ 3.1 ∥ 4.1` →
  W3 `1.3 ∥ 2.1 ∥ 3.2 ∥ 4.2` → W4 `1.4 ∥ 2.2 ∥ 2.3 ∥ 3.3 ∥ 4.4` → W5 `3.4 ∥ 4.3` →
  W6 `3.5 ∥ 5.1`.
- **One subagent per WP**, each in its **own git worktree** on branch `wp/benchmarks/<id>` cut
  from current `main`. A subagent's prompt = its WP spec section + `conventions.md` + the exact
  file set it may touch + the gate command. Subagents never edit the ledger, never merge, never
  touch files outside their WP's declared surface.
- **Serialized files — ONE writer at a time**, across your subagents AND the possibly-parallel
  Skill IDE workstream: `packages/shared/*`, `apps/api/src/db/schema.ts` + `database.ts`
  (migrations), `apps/api/src/testing/run-service.ts`, `apps/web/src/App.tsx` (routes). If two
  WPs in a wave need the same serialized file, sequence them inside the wave or re-cut it.
  **Migration numbers:** claim `user_version` numbers up front in your kickoff plan (check the
  current `LATEST_SCHEMA_VERSION` and any in-flight Skill IDE migrations first); never two
  migrations with the same number.
- **Merge protocol:** merge in dependency order; rebase each branch on `main` immediately before
  its merge; run the full gate on `main` after every merge before starting the next. Delete
  merged worktrees/branches. **Never force-push anything.**

## 3. Definition of done — every WP, no exceptions

`pnpm typecheck && pnpm test && pnpm build && pnpm lint` green **from the repo root on the
merged result**, the WP's Acceptance criteria demonstrably met, and the ledger line ticked in
house style:

```
- [x] WP <id> — <title> — done <YYYY-MM-DD> · wp/benchmarks/<id> (<short-sha>). <2–5 lines:
      what shipped, test count, and anything NOT verified — lead with that.>
```

## 4. Testing & validation rules

- The test suite is **fully offline**: stubbed providers for judge/clustering, `file://` bare
  repos for git sync (pattern proven in skill-ide WP 7.1 tests). No live API calls, no network.
- Write the invariant tests the specs name explicitly: grading never mutates run status; grades
  are append-only; `unevaluable ≠ 0` and never fails anything; judge cost never lands in run
  `cost_usd`; tool_hygiene never opens an MCP session; no force-push code path; PAT absent from
  responses AND captured logs; suite cap soft-stops; deleting a suite keeps child runs.
- UI WPs: validate against the **running app** (`pnpm dev` → http://127.0.0.1:5173 /
  http://127.0.0.1:8080) in **both themes** (`light`, `dark`), keyboard-reachable,
  real empty/loading/error states per the loading-states rule. Never claim visual correctness
  you didn't look at — if you couldn't verify, say so in the ledger line, first.
- **After W6 — end-to-end validation walk** (record results honestly under `## E2E validation`
  in STATUS.md): register + scan a stub MCP server → create a test with full `expectations`
  (incl. `referenceLogic`) → single run → grades appear (rouge1, value_match, judge with stub or
  a real cheap model if the owner provides a key) → Grade panel + re-grade → suite 2 tests × 2
  scenarios × 2 reps with a low aggregate cap → matrix fills, cap soft-stops, KPIs/scatter/
  breakdowns render → failure buckets (stub judge) → collection bound to a local bare repo →
  export → conflicting edit both sides → sync → resolve → converge → InsightBench importer on
  the fixture sample → skill-effect suite (base vs +skill) shows a delta table.

## 5. Working agreements (hard)

- Contract-first: `packages/shared` types + zod → API → web. **Additive-only** API responses.
- Secrets: PATs and judge credentials go through the existing encrypted stores; never in
  responses, logs, git, or exported files. Never commit `.env*`/keys — hooks enforce this;
  don't fight or weaken them.
- UI: `@elabs-ai/components-*` components only, semantic tokens only, `className` = layout only. Check real
  props via `pnpm exec brand-ui <info|search|docs>` or the vendored `.d.ts` — never guess.
- Never-execute invariant: graders, judges, clustering, and sync never execute skill content,
  `referenceLogic`, or MCP tools. `tool_hygiene` reads persisted scans only.
- Biome (`pnpm lint` / `pnpm format`), kebab-case TS files, PascalCase components, co-located
  `*.test.ts`.
- Fix forward: never delete a failing test or reimplement a dependency to dodge a failure.

## 6. Kickoff sequence

1. Read §0 completely.
2. Reply to the owner with a **one-screen execution plan**: wave schedule with worktree/branch
   names, serialized-file writer plan per wave, claimed migration numbers, subagent count per
   wave, and every spec ambiguity or conflict you found (with your proposed resolution). If any
   ambiguity is a STOP item (§1), ask now.
3. Start W1 (WP 1.1) immediately after — do not wait on non-STOP items.
4. Report at every wave boundary: merged WPs + gate status on main, ledger diff, decision-log
   entries, blockers. **Lead every report with what is NOT done or NOT verified.**
