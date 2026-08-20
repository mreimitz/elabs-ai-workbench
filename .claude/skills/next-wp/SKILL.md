---
name: next-wp
description: Execute and advance an implementation plan made of numbered work packages (WP specs in a plan folder with a STATUS ledger) by driving the next reviewed batch to done. Use this whenever the user wants to run, advance, continue, or ship the next work package(s) of a plan, says "next-wp", "/next-wp", "run the next WP", "pick up the next tasks", "work the testing plan", or wants up to four sub-agents to implement plan tasks in parallel git worktrees with a validate-and-tick-off review loop. It selects the next open, dependency-unblocked WPs, dispatches one worktree sub-agent each, validates results against every WP's Acceptance and the project quality gate, then ticks the task off in the ledger or sends the agent back to refine.
metadata:
  version: "1.0.0"
---

# next-wp — work-package runner

Drives an implementation plan to completion **one reviewed batch at a time**. A *plan* is a folder of
numbered **work-package (WP) specs** plus a **STATUS ledger**. This skill picks the next open,
dependency-unblocked WPs, has up to four sub-agents implement them **in parallel git worktrees**, then
**you (the main session) validate** each result and **tick it off** — or send the agent back to refine.
A WP is ticked off **only** when its Acceptance is met and the quality gate is green.

You are the **orchestrator**. Sub-agents implement; you select, validate, integrate, and record.

## Inputs
- **plan** — the plan folder (a directory of WP specs + a STATUS ledger). If the user names it (e.g.
  "the testing plan"), use it; otherwise list candidate plans and confirm.
- **maxAgents** — parallel sub-agents, default **4**, hard cap **4**.

## Project defaults (this repo)
- Plans are **roadmap items in the planning bundle**: `planning/Roadmap/RM-NN-<slug>/` (e.g.
  `planning/Roadmap/RM-26-testing/`). A plan argument may be the **tag** (`RM-26`) or the **slug**
  (`testing`) — resolve it against `planning/Roadmap/RM-*/` first, then `planning/Roadmap/completed/RM-*/`
  (a completed item is finished: report that and stop rather than reopening it). The master index is that
  folder's `item.md` (**not** a `README.md` — those are banned inside `planning/`); shared implementation
  rules are its `conventions.md`; the ledger is its `STATUS.md`.
- Every file in a plan folder is a typed OKF concept with frontmatter. When you edit `STATUS.md` or a WP
  spec, **update its `timestamp` in the same write** — the `okf-pre` hook rejects a meaningful edit that
  does not. Never add a `README.md`, never hand-move a folder, never set an item's status to `done`.
- Quality gate (definition of done): `pnpm typecheck && pnpm test && pnpm build && pnpm lint` — see
  `.claude/rules/quality-gates.md`. Linting is **Biome** (`pnpm lint`); the gate is run **locally**
  (this repo has no `ci.yml`). `pnpm okf:validate` must also stay green after any bundle edit.
- Obey the repo rules: contract-first (shared types/zod first), the API runtime/secret boundary,
  `brand-ui` only + semantic tokens + the **two themes** (`light`, `dark`), kebab/PascalCase naming.

`references/plan-layout.md` defines the exact folder shape a plan must have. `references/status-ledger.md`
defines the ledger format and how to parse and update it. Read them if the plan's structure is unfamiliar.

## Workflow

### 0. Preconditions
Resolve the plan folder. If it doesn't exist, stop and list candidate plans (`planning/Roadmap/RM-*/`
folders with an `item.md` + WP specs). Check `git status`; commit/stash stray changes or warn before creating worktrees. Find the
git root with `git rev-parse --show-toplevel`.

### 1. Load the ledger
Read `PLAN/STATUS.md`. If it's missing, generate it: scan the WP specs, parse each WP's title and its
dependencies, seed every WP open, using `assets/STATUS.template.md` as the shape. See
`references/status-ledger.md`.

### 2. Select the batch (dependency-aware, parallel-safe)
Take WPs that are **open** AND whose **dependencies are all done**. Among those pick up to `maxAgents`,
honoring:
- the **recommended build order** in the plan's `item.md` (e.g. a vertical slice first);
- **minimal file overlap** — read each candidate's **Files** section; never run two WPs that modify the
  same file in parallel. A WP touching many shared files runs **solo**;
- **owner-gated** WPs (needs a credential, a vendored artifact, an approval): if the gate isn't met,
  mark them **blocked** in the ledger and skip — never fake them.

If nothing is eligible, say so and stop with a clear note on what's blocking.

### 3. Mark in progress + show a task list
Set each selected WP's ledger line to `status: in progress (agent label)`. Create one task-list entry
per selected WP so progress is visible.

### 4. Dispatch one sub-agent per WP — each in its own git worktree
Launch the selected WPs in parallel, one sub-agent each, **each in its own git worktree** so they can't
collide. Prefer the sub-agent tool's worktree isolation; otherwise create one per agent from the git
root: `git worktree add .worktrees/PLAN-ID -b wp/PLAN/ID` and run the agent there.

Brief each agent exactly:
1. Read the plan's `conventions.md` and your WP spec; implement **only that WP** (and any docs it links).
2. Follow the repo rules (contract-first, runtime/secret boundary, brand-ui-only, naming).
3. Commit on branch `wp/PLAN/ID` in your worktree (small, reviewable commits).
4. Run the gate from the repo root (`pnpm typecheck && pnpm test && pnpm build && pnpm lint`) plus any WP-specific tests.
5. **Self-review against the WP's Acceptance checklist.** Do **not** mark the WP done yourself.
6. **Report back**: branch name, files changed, gate output, each Acceptance item pass/fail, and anything
   you could not verify (e.g. needs a provider key, needs the running app for a visual check).

### 5. Validate, then tick off or refine
When an agent reports back, **validate — don't take "done" on faith**:
- Review the branch diff; **re-run the gate** in that worktree; check **every** Acceptance item and rule
  compliance.
- **PASS** → integrate the branch into the working branch (merge, resolve conflicts); **tick the WP off**
  in `STATUS.md` (`[x]`, date, branch); mark the task completed; remove the worktree.
- **FAIL / partial** → **send the same agent back to refine** (continue that sub-agent with its context —
  don't spawn a fresh one) with an **itemized** list of what to fix and which Acceptance items failed.
  Keep the ledger at `status: in review`. Re-validate until it passes or is genuinely blocked.
- **Integrate validated branches one at a time.** If two conflict, merge one, then have the other rebase.

### 6. Close out — the front page follows the work
Update `STATUS.md` and the task list. Then, **in the same commit as the tick**:

- Update the capability table in `README.md` — move what this WP made real out of "planned" and into
  what the app does today, and correct anything the WP made false.
- Add a `CHANGELOG.md` entry.
- **Verify each claim by running it** — the running app or a passing test — never from the WP
  description. A ledger box does not tick while the front page still describes software that does not
  match.

Summarize: WPs **ticked off** (with branch/commit), WPs still **in refine**, WPs **blocked** (unmet deps,
conflicts, or owner actions — name them). Offer to run the next batch.

### 7. When the last box ticks — the plan is not finished
A ledger with no open boxes means the code is done, not that the item is. Complete the lifecycle
(`CLAUDE.md` §11):

1. Make sure every `planning/user-guide/DC-NN-*/` subject the delivery touched exists — create it with
   `/new-docu` if it does not. Subjects are **parts of the system**, not roadmap items.
2. Retire the item in one transaction:
   `python3 planning/.claude/scripts/okf.py --root planning complete-roadmap --tag RM-NN --docu DC-NN
   --shipped "…" --deviation "…" --gap "…" --code-path "…" --docu-status current`.
   Write `--shipped`, `--deviation` and `--gap` from the ledger's own evidence — what shipped, how it
   differed from the plan, and what was deliberately left out or left unverified. The command refuses
   while any box is open; that refusal is correct — never reach for `--no-ledger`.
3. Apply the stale-reference report it prints, then confirm with
   `… check-references --tag RM-NN`.

## Guardrails
- **Never tick off** a WP unless the gate is green **and** every Acceptance item is met. Report honestly:
  lead with what is unverified (visual/a11y claims must cite the running app, not a mock).
- **Respect dependencies and owner-gated items**; surface blockers, never fabricate results.
- **Isolation is mandatory**: each agent edits only its own worktree; the main tree changes only via your
  validated merges. Never let two agents write the main tree at once.
- **Secrets stay server-side and out of git** (any secret-guard hook still applies); never commit keys.
- If every WP in the ledger is ticked, report that the plan is complete and stop.
