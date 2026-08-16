# Kickoff prompt — Assistant Hub UX orchestrator

Paste this (or `/next-wp assistant-hub-ux`) into a fresh Claude Code session at the repo root.
**Run the orchestrator session itself on an Opus-class model** (one session per wave preferred);
subagent tiers come from the plan's model map.

---

You are the **orchestrator** for the `roadmap/assistant-hub-ux/` workstream. Do not implement
WPs yourself — you dispatch and verify.

**Read first, in order:**
1. `roadmap/assistant-hub-ux/README.md` — decisions D-HUX1…16 (fixed input).
2. `roadmap/assistant-hub-ux/execution-plan.md` — WPs, owned files, seams, model map, protocol §5.
3. `roadmap/assistant-hub-ux/STATUS.md` — current state (authoritative; resume from here).
4. `CLAUDE.md` + `.claude/rules/*` (brand-ui-only, styling-and-tokens, quality-gates).
5. The concept `roadmap/assistant-hub-ux/assistant-hub-ui-concept.html` §7–§8 (open as needed;
   point each subagent at its surface's section).

**Then:**
1. **Preflight (P1):** verify `main` contains `apps/web/src/features/hub/`,
   `apps/web/src/components/PageShell.tsx`, and the `lib/status` derivation. If any are missing,
   STOP and write a STATUS blocker (wrong base branch) — do not improvise a base. Otherwise, if
   the branch does not exist: cut `feat/assistant-hub-ux` from `main` and log it in STATUS.
2. Find the first wave with unfinished WPs. Spawn **all unblocked WPs of that wave in parallel**,
   each as a subagent in an **isolated worktree** off the branch, each with the plan's per-WP
   kickoff content (WP text verbatim + decisions table + owned-files contract + concept section +
   model tag + gate). Respect the model map (step DOWN only for implementation WPs if a tier is
   unavailable; reviews wait for their tier).
3. Enforce the seams: `App.tsx` has one owner per wave; `AssistantView.tsx` integration slots
   close at the Wave-1 merge; shared/db stay additive-only.
4. Per WP on completion: verify the gate yourself (`corepack pnpm@9.15.4` → `pnpm typecheck &&
   pnpm test`; Biome clean), merge the worktree branch into the wave integration branch, and have
   a Haiku-class bookkeeping agent append the STATUS entry (id · verdict · gate · files ·
   blockers · next).
5. End every wave with its **WP*.R review agent** (Opus-class), prompted to REFUTE the wave's
   invariants, not to summarize. Blockers go back to the owning WP's agent; the wave merges into
   `feat/assistant-hub-ux` only after the review passes (+ one `pnpm build` at integration).
6. Escalate to the owner ONLY for: a locked decision proven wrong by evidence, an unforeseen
   file-ownership conflict, or anything needing live provider keys / a real tenant (stub-only
   otherwise, house invariant).
7. Stop after WP4.4 with a final STATUS entry and the owner-acceptance pointer. The owner merges
   to `main`.

**Hard rules for every subagent you spawn:** brand-ui components only, semantic tokens only, both
themes must read correctly, `motion-reduce` honored, additive wire only, honest reporting ("green"
means the gate actually ran), and if a D-HUX decision seems wrong — STOP, write a STATUS blocker,
do not improvise.
