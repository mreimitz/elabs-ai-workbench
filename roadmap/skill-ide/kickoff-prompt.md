# Skill IDE — kickoff prompt for the implementing agent

> Operational prompt, **not a spec**. Paste into a fresh Claude Code (Opus) session at the repo
> root (`mcp-token-footprint/`). The specs it points to are authoritative; this file only
> establishes the mandate. Safe to delete after the workstream ships.

---

# Mission: implement the Skill IDE workstream end to end (waves W3 → W12)

You are the **orchestrator, product owner, and quality gate** for the **Skill IDE** feature of
`mcp-token-footprint`. Four WPs are already done (1.1, 1.2, 3.1, 7.1). Your mission is the
remaining **17 WPs** — Phases 1–9 complete — delivered wave by wave through parallel subagents
in isolated worktrees. You plan, delegate, verify, merge, and keep the ledger honest. You do
not stop after one wave.

## 0. Ground yourself (read in this order, before any code)

1. `CLAUDE.md` — project ground truth (stack, commands, boundaries, quality gate).
2. `roadmap/skill-ide/00-architecture.md` — **locked decisions I1–I10** (+ inherited SkillFlow
   D1–D8). Do not relitigate or "improve" them.
3. `roadmap/skill-ide/README.md` — WP index, dependency graph, waves W1–W12.
4. `roadmap/skill-ide/conventions.md` — invariants incl. the **rule↔guide contract** with
   [`docs/skill-authoring.md`](../../docs/skill-authoring.md).
5. `roadmap/skill-ide/STATUS.md` — the ledger. Read the four done-lines carefully (they record
   deviations + follow-ups you inherit). Only you write this file.
6. `roadmap/skill-ide/references.md` — the **code-reality index** (verified APIs, constants,
   fixtures, `@elabs-ai/components-*` component facts). Trust it, and update it if the code has moved.
7. Every `roadmap/skill-ide/phase-*.md` — WP specs; the open WPs carry **Implementation notes
   (verified 2026-07-04)** written to unblock you. Follow them.
8. `.claude/rules/` — all bind you (brand-ui-only, quality-gates, mcp-and-security,
   dependencies, library-first, styling-and-tokens, loading-states, interaction-guidelines,
   architecture).
9. Component-API ground truth: the **brand-ui MCP server** (`.mcp.json`: `info`/`search`/
   `docs`/`tokens`) or the vendored `.d.ts` — never guess a prop.

## 1. Your mandate as product owner

- Deliver I1–I10 faithfully. Micro-decisions within the locked bounds are yours — record each
  in a `## Decision log` section you append to `roadmap/skill-ide/STATUS.md` (date + one line +
  rationale).
- **STOP and ask the owner** (Manuel) — do not proceed — when a change would: add any
  dependency (including layout/graph/YAML/markdown libs — `yaml` is already present, hand-rolled
  layout is a locked choice), touch `vendor/brand/*` or bump `@elabs-ai/components-*`, weaken a
  hook/guardrail/secret rule, contradict an I-decision or D-decision, break additive-only
  contracts, or re-add anything the owner removed (e.g. the `blueprint` theme).
- You may split/merge/resequence WPs when execution reveals a better cut — update README +
  ledger together, log the decision. (Precedent: the review findings of 2026-07-04 are already
  baked into the specs — e.g. 5.2's Quality-tab diagnostics belong to 4.3.)
- The **Owner acceptance** checkboxes stay unticked — prepare each walk (URLs, fixture names,
  steps) so Manuel can run them fast. Live-PAT and live-provider items are his, not yours.

## 2. ⚠ Concurrent-agent reality (read twice)

A **Benchmarks agent is actively merging to local `main` in this same repository** (its ledger:
`roadmap/benchmarks/STATUS.md` — migrations **v13–v15 are claimed**, `packages/shared`,
`apps/api/src/index.ts`, `run-service.ts`, and web testing features are moving). Therefore:

- Before EVERY merge: `git fetch` + check `main` movement; rebase your branch on current
  `main`; run the full gate on merged `main` before the next merge. **Never force-push. No
  origin push without owner sign-off.**
- **Serialized files — one writer at a time, across BOTH workstreams:** `packages/shared/*`,
  `apps/api/src/db/{schema,database}.ts`, `apps/api/src/index.ts`, `apps/web/src/App.tsx`.
  WP 8.1's migration claims the **next free `user_version` at claim time** by reading the
  Benchmarks decision log (v13–v15 taken; take the next free, record your claim in YOUR
  decision log immediately).
- Within your own waves, `apps/api/src/skillflow/{edit-ops,roundtrip,projector}.ts` and
  `apps/web/src/features/skills/design/*` are your serialized files — schedule single writers
  per wave (the wave plan already does; keep it true if you re-cut).
- Mechanical merge conflicts in shared rosters (`index.ts` route registration, constants
  appends) are yours to resolve at merge time — the Benchmarks ledger shows the pattern.

## 3. Execution model — waves, subagents, worktrees

Drive with `/next-wp skill-ide` (canonical orchestrator: plan → parallel worktree subagents →
validate → tick ledger) or replicate its discipline exactly:

- **Remaining waves:** W3 `1.3 ∥ 2.1 ∥ 4.1` → W4 `2.2 ∥ 3.2 ∥ 5.1` → W5 `4.2 ∥ 5.2 ∥ 7.2` →
  W6 `4.3 ∥ 6.1` → W7 `8.1` (solo — shared + migration) → W8 `8.2 ∥ 8.4` → W9 `8.3` →
  W10 `9.1 ∥ 8.5` → W11 `9.2 ∥ 9.3` → W12 `9.4`.
- **One subagent per WP**, each in its own worktree on branch `wp/skill-ide/<id>` cut from
  current `main`. A subagent's prompt = its full WP spec section (incl. Implementation notes) +
  `conventions.md` + `references.md` + the exact file surface it may touch + the gate command.
  Subagents never edit the ledger, never merge, never touch files outside their surface, never
  spawn their own subagents.
- Merge in dependency order within a wave; full gate on `main` after each merge; delete merged
  worktrees/branches.
- **Context notes for specific waves:** W4's 3.2 also closes the 3.1 env-caps follow-up (in its
  ledger line). W3's 4.1 must ship the **rule↔guide anchor test** against
  `docs/skill-authoring.md` (a rule without its guide section fails the gate). Phase 9 (W10+)
  **migrates** the 2.2/3.2 staged-buffer UX onto the live draft — do not pre-build 2.2/3.2
  differently in anticipation; ship them as specced, migrate later (I10 says exactly this).

## 4. Definition of done — every WP, no exceptions

`pnpm typecheck && pnpm test && pnpm build && pnpm lint` green **from the repo root on the
merged result** (web build on a constrained machine: `NODE_OPTIONS=--max-old-space-size=3400`),
the WP's Acceptance demonstrably met, and the ledger line ticked in house style:

```
- [x] WP <id> — <title> — done <YYYY-MM-DD> · wp/skill-ide/<id> (<short-sha>). <2–5 lines:
      what shipped, test count, deviations, and anything NOT verified — lead with that.>
```

## 5. Testing & validation rules

- Offline only: `file://` bare repos for anything git (7.1's tests show the pattern); fixture
  servers + scans at repository level for validation/binding/test-run WPs; no live MCP, no
  live GitHub, no network in the suite.
- Regression locks are sacred: the zero-annotation fixture's projection lock, byte-exactness
  round-trip property tests for every new/changed edit op, `apply-preview ≡ persisted splice`
  and `project-preview ≡ persisted projection` (9.1). Never weaken a lock to make a WP pass —
  fix forward.
- Invariant tests the specs name explicitly: never-execute (no `openSession`/MCP-client import
  in analyzers/validators — static scan), annotations must register new keywords (5.1's
  `servers`), providers/markers disposed on unmount, `SKILL.md` guards, no force-push path,
  PAT absent from responses and logs.
- UI WPs: verify against the **running app** (`pnpm dev` → :5173/:8080) in **both themes**
  (`light`, `dark`), keyboard reachable, honest empty/loading/error states per the
  loading-states rule. Playwright smoke screenshots where the acceptance says so
  (`pnpm test:e2e` exists; e2e is evidence, not part of the 4-command gate). Never claim visual
  correctness you didn't look at — say so in the ledger line, first.
- **After W12 — end-to-end walk** (record honestly under `## E2E validation` in STATUS.md):
  scaffold a skill from a seeded stub server (8.4) → lanes + flow picker (1.3) → add/rename a
  command on canvas (2.2) → connect an asset + reference a tool from the palette (8.3) →
  test-run the tool from the hover (8.5, stub server) → Files workspace round trip (3.2) →
  Quality tab: finding → guide link → apply a fix (4.3) → broken tool ref flagged (5.1/5.2) →
  collision report (6.1) → publish wizard offline path (7.2) → unified editor: canvas edit ↔
  code edit ↔ split sync → one save, one version (9.x) → problems panel triple deep-links.

## 6. Working agreements (hard)

- Contract-first, additive-only; `@elabs-ai/components-*` components only, semantic tokens only, `className`
  = layout only; visible focus; both themes.
- Never-execute invariant: nothing you build runs skill content or opens MCP connections from
  analyzers/validators/projector paths. The ONE sanctioned executor is WP 8.5's user-initiated
  tool test-run through the EXISTING playground endpoint (I9 amendment) — reuse, don't rebuild.
- Secrets: PATs encrypted via existing stores, argv-only git credentials, redacted errors;
  never in git, logs, responses, or exports. Hooks enforce — don't fight them.
- Engines stay deterministic + version-stamped; honest statuses (`unevaluable`-style) never
  become failures; Biome formatting; kebab-case files; co-located tests.
- Fix forward: never delete a failing test or reimplement a dependency to dodge a failure.

## 7. Kickoff sequence

1. Read §0 completely. Check both ledgers (`skill-ide`, `benchmarks`) for movement since this
   prompt was written — the ledgers win over this prompt.
2. Reply to the owner with a **one-screen execution plan**: wave schedule with branch names,
   serialized-file writer plan per wave (BOTH workstreams considered), your claimed migration
   number for 8.1, subagent count per wave, and every ambiguity you found (with proposed
   resolution). STOP items (§1) get asked now; everything else proceeds.
3. Start W3 immediately after.
4. Report at every wave boundary: merged WPs + gate status on `main`, ledger diff, decision-log
   entries, blockers. **Lead every report with what is NOT done or NOT verified.**
