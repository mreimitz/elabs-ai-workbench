# Toolbar Reach — conventions (shared implementation rules)

Every WP in this plan assumes the rules below. Read this and your WP spec before writing code. The
program index and locked decisions are in [`README.md`](./README.md); the ledger is
[`STATUS.md`](./STATUS.md).

---

## 1. The quality gate (definition of done, per WP)

From the repo root (`mcp-token-footprint/`):

```bash
pnpm typecheck && pnpm test && pnpm build && pnpm lint
```

All four green — plus any **WP-specific tests** the spec names. This is the same set the root
`.github/workflows/ci.yml` runs. Notes for this repo:

- pnpm is pinned: use `corepack pnpm@9.15.4` if a bare `pnpm` resolves to the wrong version.
- Web tests must build `shared` first — run them via the `test` script / recursive `pnpm test`, never a
  bare `vitest run` (shared resolves to a git-ignored `dist`).
- `pnpm build` under concurrent-session load can OOM the web build. If a batch runs several builds at
  once, use `pnpm -r --workspace-concurrency=1 build`, or set `NODE_OPTIONS=--max-old-space-size=3400`.
  The **PM runs the authoritative `pnpm build`** at each merge on `ui/toolbar-reach`; a batch agent that
  can't build in its sandbox says so and runs `typecheck · test · lint`, and the PM builds at merge.

## 2. Visual claims — measured, not asserted

Any WP touching a toolbar, a filter row, or a status/count readout makes a **visual claim**, and a visual
claim is only valid against the **running app** at `http://127.0.0.1:8080` (or the built app on a spare
port), in **BOTH** `light` **and** `dark` — **never a mock, never a screenshot of a component
in isolation.**

**Toolbar geometry is measured, not eyeballed.** For any row a WP touches, the acceptance evidence is the
auditor's own method:

> Read the toolbar row's children in the live DOM and compare `getBoundingClientRect()`. The **top edge**
> and **height** of every interactive control in the row must be **identical** (the count/meta text may be
> a different height, but every *control* — select, search, button, facet — shares one top and one height).

"Looks aligned" is **not** a pass. Report the measured numbers (e.g. `Date range top=118 h=32 · Provider
top=118 h=32 · Suite top=118 h=32` — one top, one height). C-1's whole finding is *three* heights and
*three* tops with 11px of scatter; the fix is not done until the measured scatter is 0.

The committed `data/app.sqlite` is essentially empty (see the ux-overhaul verification notes). A WP whose
acceptance needs content **seeds its own** (upload a `SKILL.md`, create a stdio echo-fixture server + scan,
the default "Local" collection auto-exists) — it never fabricates a rendered result. Anything that needs a
**provider key** or a **live run** (run-console live streaming, live grades, real model rosters) is an
**owner-acceptance** item: build it structurally, note it in the report, do not claim it verified.

## 3. Repo rules still bind

- **Contract-first.** A wire change is made in `packages/shared` (types + zod) **first**, then the API,
  then web. Most of this plan is web-only; if a WP needs a new field or endpoint, it graduates through
  `shared` first. (2.3's `title=` on a select and 4.4's Settings theme control are web-only. 4.3 may add a
  route — routes are web-only unless they fetch a new shape.)
- **API runtime / secret boundary.** Only `apps/api` spawns MCP processes, makes MCP HTTP calls, or reads
  decrypted secrets. The web UI receives redacted configs. No WP here should need to cross it; if one
  seems to, that is a signal the spec is wrong — report it.
- **`@elabs-ai/components-*`-only + semantic tokens.** Every visible element is a `@elabs-ai/components-*` component (or a
  `lucide-react`/`@elabs-ai/components-icons` glyph). No raw `#hex`/`rgb()`/`hsl()`, no palette colours (`text-gray-500`),
  no `*-black`/`*-white`. `className` is layout-only — use a component's `variant`/`size` for looks. The
  `enforce-brand-ui` and `check-tokens` hooks are active. New primitives (`IconButton`) compose `@elabs-ai/components-*`
  parts; verify props against the vendored kit / `.d.ts` / the brand-ui MCP server, never guess.
- **Two themes only** — `light` (default) + `dark`. New UI must read correctly in both. Don't
  reach for `dark:` overrides; tokens cover both.
- **Naming:** TS files kebab-case; React components PascalCase; tests co-located as `name.test.ts(x)`.
- **Loading/streaming discipline** (`.claude/rules/loading-states.md`): `loading` = no content yet;
  `isStreaming` = partial; errors fire only on a **terminal, settled** failure. WP 0.1 touches the run
  console — do not regress `use-run-stream.ts`'s terminal-swallow behaviour.

## 4. The Domain contract

Each WP spec has a **Domain** — the exact file list it may create or modify. **A sub-agent may not touch a
file outside its Domain.** That is what makes a batch's parallel worktrees safe. If your WP genuinely
cannot be completed without editing a file outside your Domain (e.g. a shared type, a test that breaks in a
sibling file), **stop and report it to the PM** — do not reach across. The PM will either widen the Domain
(and re-check the batch for collisions) or reschedule.

Where a Domain says "**region only**" (e.g. 2.3 = the `ScanCompareBar` region of `CompareView.tsx`), touch
only that region; another WP or a later batch owns the rest of the file.

## 5. Working with the audit as source

The audit was written from **verified source on 2026-07-25**, cross-checked against `apps/web/src` before
each finding was written down. But **source moves.** If you open the file your WP names and the audit's
`file:line` no longer matches — the symbol was renamed, the block moved, the fix is already partly done —
**report that back to the PM rather than improvising.** Do not force the audit's literal line edit onto
drifted source; implement the *intent* against what you find, and flag the drift.

Known drift already resolved by the PM (reflected in the specs, don't re-discover):
- `ScanCompareBar` is **not a separate file** — it is defined **inside** `features/compare/CompareView.tsx`.
- `IssuesFleetTab.tsx` lives at `features/issues-fleet/IssuesFleetTab.tsx`, **not** `features/dashboard/`.
- The run console's visible tab strip is **Chat · Trace · Analytics · Report**, where **"Trace" is the tab
  whose `value` is `"raw"`** (`RunConsole.tsx:877`). `steps` and `turns` are panels with **no** tab.
- `PageHeader` has exactly **three** `import` consumers (`WorkforceView`, `ProjectsView`,
  `CompareWorkspace`); `PageShell.test.tsx` **imports it directly** in a `describe("PageHeader")` block
  (breaks on delete); `AgentsView.test.tsx` / `DirectoryTab.test.tsx` **exercise** WorkforceView's header.

## 6. Branch / ledger discipline

- Base branch: **`ui/toolbar-reach`** (cut from `main`). WP branches: **`wp/toolbar-reach/<id>`**
  (e.g. `wp/toolbar-reach/0.1`). Small, reviewable commits.
- **A sub-agent never edits `STATUS.md`.** Only the PM does — a box is ticked only after the PM re-runs the
  gate on the merge and checks every Acceptance item.
- Report back: branch name, files changed, gate output (paste the final lines), each Acceptance item
  pass/fail, and — **led, not buried** — anything you could NOT verify (needs a provider key, needs the
  live app, a spec drift you found).

## 7. Accessibility floor (this plan raises it)

- Every interactive element is keyboard-reachable with a **visible focus ring**; no `div`-as-button.
- Every icon-only control has an **accessible name** — and, after Phase 3, a matching **tooltip** (D-TB5).
- Disabled controls that could confuse an operator carry a **reason**, wired to `aria-describedby` (D-TB5).
- Count/number readouts use `tabular-nums`; truncating text carries a recovery (`title`/tooltip/expand)
  per D-10 — note the one carve-out: on a text-less `<Button>`, `title` is banned (D-TB5); use the tooltip.
