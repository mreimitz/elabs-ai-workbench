# Interface Craft — conventions (shared implementation rules)

Every WP in this plan assumes the rules below. Read this and your WP spec before writing code. The
program index and locked decisions are in [`README.md`](./README.md); the ledger is
[`STATUS.md`](./STATUS.md).

---

## 1. The quality gate (definition of done, per WP)

From the repo root (`mcp-token-footprint/`):

```bash
pnpm typecheck && pnpm test && pnpm build && pnpm lint
```

All four green — **plus** any **WP-specific tests** the spec names. This is the same set the root
`.github/workflows/ci.yml` runs. Repo notes:

- pnpm is pinned: use `corepack pnpm@9.15.4` if a bare `pnpm` resolves to the wrong version.
- Web tests must build `shared` first — run them via the `test` script / recursive `pnpm test`, never a
  bare `vitest run` (shared resolves to a git-ignored `dist`).
- `pnpm build` under concurrent-session load can OOM the web build. A batch agent that can't build in
  its sandbox says so and runs `typecheck · test · lint`; the **PM runs the authoritative `pnpm build`
  on `ui/interface-craft` at each merge**. If needed: `pnpm -r --workspace-concurrency=1 build` or
  `NODE_OPTIONS=--max-old-space-size=3400`.
- The full `pnpm test` (~5 min) can exceed a sub-agent's bash timeout. Agents run **typecheck + lint +
  their WP-specific/targeted tests**; the PM runs the full gate at integration.

## 2. Every acceptance claim is a MEASUREMENT, not an impression

**This is the defining rule of this plan.** The review's methods are the bar, and they are
reproducible. A WP is not done until its Acceptance **numbers** are produced against the **running app**
at `http://127.0.0.1:8080` (or the built app on a spare port), in **BOTH** `light` **and**
`dark`. Never a mock, never a component in isolation, never "looks fine."

| Claim | Method | Report |
|---|---|---|
| **Contrast** | convert `oklch()` to sRGB in-page, compute the WCAG ratio | the number **and** the pair, in **both** themes (e.g. `bright --primary/-foreground = 4.62:1 PASS`) |
| **Landmarks / headings / focus order** | query the live DOM: `document.querySelectorAll('main')`, the heading list, enumerate focusables | the counts (e.g. `<main> = 1`; `headings = h1 + 5×h2`; `focusables before content = 1`) |
| **Overflow / measure** | `clientWidth` vs `scrollWidth`; characters-per-line from a character-width probe | both numbers (e.g. Runs row `scrollWidth 498 → 0` hidden; callout `190ch → 66ch`) |

How to run the probes: build the branch, serve it, drive Chrome headless (CDP) — see the memory note
"Run app & verify visually" (`pnpm dev` breaks on `@elabs-ai/components-editor ?worker` prebundle; use the Docker
`:8080` image or a `vite preview` of the build, CDP-headless-Chrome for the DOM queries/screenshots).
The committed `data/app.sqlite` is essentially empty — a WP whose acceptance needs content **seeds its
own** (upload a `SKILL.md`, create a stdio echo-fixture server + scan, the default "Local" collection
auto-exists); it never fabricates a rendered result. Anything needing a **provider key** or a **live
run** (run-console live streaming, live grades, real model rosters) is an **owner-acceptance** item:
build it structurally, note it in the report, do not claim it verified.

For any structural a11y claim that a browser DOM query can't settle (does a given AT/browser pair
**announce** a `role="alert"` / a `role="log"` update / an `aria-describedby`), state it as
**structurally correct, screen-reader-announcement not tested** — the review itself drew that line
(its "Not verified" section). Do not claim an announcement you did not hear.

## 3. Repo rules still bind

- **Contract-first.** A wire change is made in `packages/shared` (types + zod) **first**, then API,
  then web. **This plan is web-only** — no WP here should touch a wire shape. If one seems to, that is
  a signal the spec is wrong — report it.
- **API runtime / secret boundary.** Only `apps/api` spawns MCP processes / reads secrets. No WP here
  crosses it.
- **`@elabs-ai/components-*`-only + semantic tokens.** Every visible element is a `@elabs-ai/components-*` component (or a
  `lucide-react`/`@elabs-ai/components-icons` glyph). No raw `#hex`/`rgb()`/`hsl()`, no palette colours, no
  `*-black`/`*-white`. `className` is layout-only. The `enforce-brand-ui` and `check-tokens` hooks are
  active. **The one sanctioned exception in this plan** is the D-IC1/D-IC2 **token override block** in
  `apps/web/src/styles/app.css` (WP 0.1): it defines new *token values*, it is not raw color in a
  component, and it lives in the token entry file. New app wrappers (`SectionCardTitle`, the
  title-carrying select, the measure-capped description) **compose** `@elabs-ai/components-*` parts — verify props
  against the vendored kit / `.d.ts` / the brand-ui MCP server (`mcp__brand-ui__docs`/`search`/`tokens`),
  never guess.
- **Do not bump the `@elabs-ai/components-*` version.** Vendor fixes land app-side (README "Vendor boundary");
  record each in [`upstream-gaps.md`](./upstream-gaps.md).
- **Two themes only** — `light` (default) + `dark`. New UI reads correctly in both. Don't
  reach for `dark:` overrides; tokens cover both.
- **Naming:** TS files kebab-case; React components PascalCase; tests co-located as `name.test.ts(x)`.
- **Loading/streaming discipline** (`.claude/rules/loading-states.md`): `loading` = no content yet;
  `isStreaming` = partial; errors fire only on a **terminal, settled** failure. WP 1.2 touches the run
  console — do not regress `use-run-stream.ts`'s terminal-swallow behaviour, and do not let a
  `role="log"` region announce a mid-stream transient.

## 4. The Domain contract

Each WP spec has a **Domain** — the exact file list it may create or modify. **A sub-agent may not
touch a file outside its Domain.** That is what makes a batch's parallel worktrees safe. If your WP
genuinely cannot be completed without editing a file outside your Domain (a shared type, a sibling
test that breaks), **stop and report it to the PM** — do not reach across. Where a Domain says
"**region only**" (e.g. 0.4 = the toolbar region of `RunsView.tsx`), touch only that region; another
WP or a later batch owns the rest of the file.

## 5. Working with the review as source — KNOWN DRIFT (don't re-discover)

The review was written against a **pre-toolbar-reach tree**; toolbar-reach then merged into `main`
(this plan's base). Several `file:line`s have moved or the code was restructured. If you open the file
your WP names and the review's `file:line` no longer matches — the symbol moved, the block was
restructured, the fix is already partly done — implement the *intent* against what you find and
**report the drift**; do not force a literal line edit onto drifted source. Already-known drift,
resolved (reflected in the specs — do not re-report as new):

- **`components/TableToolbar.tsx` is DELETED** (toolbar-reach D-TB6). Finding 7's
  "`TableToolbar.tsx:66-70` + 6 count call sites" no longer exists — counts render via `ViewToolbar`'s
  `results` slot (`Badge variant="secondary" className="tabular-nums"`). WP 1.2 re-locates them.
- **Finding 2 drifted** `RunsView.tsx:632 → :733` (the `overflow-x-auto [scrollbar-width:none]`
  wrapper) and the derived-toggle green `:662 → :764` (`variant={filter.derived === true ? "default" :
  "outline"}`). Defect intact.
- **`AgentCard.tsx` already carries `title`** (`:186`, `:234`) from a toolbar-reach touch-up. WP 2.1
  targets **`CrewCard.tsx:60`** (line-clamp-2, no `title`) and re-verifies AgentCard.
- **`PageHeader` is deleted**; page identity is the breadcrumb + an `sr-only` h1 (this is the exact
  gap D-IC5/WP 1.1 fixes — the `sr-only` h1 is the *only* heading on Runs/Servers/Dashboard today).
- The run console visible tab strip is **Chat · Steps · Turns · Trace · Analytics · Report** (one
  `TabPanel` strip since toolbar-reach WP 0.1); WP 1.2 touches only the **transcript region**, not the
  strip.

## 6. Do NOT resurrect the review's rejected candidates

The review's **Considered but Rejected** table lists five candidates it deliberately did not turn into
findings, with reasons. **No WP proposes any of them** (details in [`README`](./README.md) /
[`upstream-gaps.md`](./upstream-gaps.md)):

1. Raising `active:scale-[0.98]` to `0.96` — vendored token, 0.98 is inside the rule's floor.
2. Normalizing icon sizing (size-3.5/4/5 across 22 files) — can't tell correct hierarchy from a
   collision without a per-row visual check that wasn't run.
3. **Concentric radius** — `--radius` is 4px, so max error is 4px, not perceptible. The *visible*
   issue in those components is the doubled border, which **is** finding 14 (WP 2.4).
4. `text-base sm:text-sm` for iOS input zoom — desktop console; compact folds `text-base` to 13px, so
   the standard remedy is wrong here.
5. Converting to logical properties — no RTL anywhere; churn with no user benefit.

(Also rejected: replacing `border-b` list separators / loosening the compact density — a deliberate,
documented product decision that survives the stress tests.)

## 7. Copy discipline (WP 3.x)

Copy changes must **preserve what is already right**: no user-blaming, no "Oops", no exclamation marks
(the review confirmed zero of each today — do not introduce any). The existing **target voice** is
`RunConsole.tsx:822` ("… The console will resume automatically when the connection recovers.") and
`GradePanel.tsx:142` ("… Configure the LLM judge, then re-grade.") — match it: one opener
("Couldn't …", curly apostrophe) **plus a next step**. Preserve good sites; rename only the ones that
name internals rather than user concepts.

## 8. Branch / ledger discipline

- Base branch: **`ui/interface-craft`** (cut from the merged `main`). WP branches:
  **`wp/interface-craft/<id>`** (e.g. `wp/interface-craft/0.1`). Small, reviewable commits.
- Worktree isolation forks from `main`, not from the plan base — **bake a base-reset into the initial
  dispatch** (`git checkout -B wp/interface-craft/<id> <ui/interface-craft-tip-SHA>`) so the isolated
  worktree starts from the right commit (see the memory note "Parallel worktree agent gotchas").
- **A sub-agent never edits `STATUS.md`.** Only the PM does — a box is ticked only after the PM
  re-runs the gate on the merge and checks **every** Acceptance item (with its numbers).
- **A sub-agent that finds its spec wrong reports back instead of improvising.**
- Report back: branch name, files changed, gate output (paste the final lines), each Acceptance item
  pass/fail **with its measured number**, and — **led, not buried** — anything you could NOT verify
  (needs a provider key, needs a screen reader, a spec drift you found).
