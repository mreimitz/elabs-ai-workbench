---
type: "Status Ledger"
title: "Platform hardening \u2014 work-package status ledger \u00b7 PRIORITY: MEDIUM (rolling)"
description: "Living state for the platform plan, read and updated by /next-wp platform. A box is ticked"
tags: ["roadmap", "RM-18"]
timestamp: "2026-08-22T21:15:00Z"
status: "active"
---
# Platform hardening — work-package status ledger · **PRIORITY: MEDIUM (rolling)**

Living state for the **platform** plan, read and updated by `/next-wp platform`. A box is ticked
**only** when the WP's Acceptance is met and the gate
(`pnpm typecheck && pnpm test && pnpm build && pnpm lint`) is green.

**Legend:** `[ ]` open · `[x]` done. Done lines: `… — done <YYYY-MM-DD> · wp/platform/<id>`.

> Plan in [`item.md`](./item.md). WPs are independent — pick opportunistically between
> other workstreams' waves.
>
> **The two blocked-on notes were STALE and are cleared (checked 2026-08-21 by `RM-35` WP 4.1's
> prerequisite recheck).** They read "1.1 needs Benchmarks P1; 1.5 needs Benchmarks P3". Both
> Benchmarks phases are complete in
> [`RM-07`'s ledger](../RM-07-benchmarks/STATUS.md): **Phase 1 is 4/4** (WP 1.1 contract, 1.2 grader
> engine, 1.3 LLM judge, 1.4 grade UI) and **Phase 3 is 5/5** (WP 3.1 suites schema, 3.2
> orchestrator, 3.3 suite console, 3.4 analytics, 3.5 failure buckets). **Nothing in this item is
> blocked on another workstream.** This is the second stale blocked-flag found here — RM-01's WP 2.1
> flag was found stale the same way on 2026-08-18.

- [ ] WP 1.1 — first-run onboarding: seeded demo content + guided empty states
- [x] WP 1.2 — docs & changelog: in-app docs route, CHANGELOG discipline, per-view help links
      — **done 2026-08-22 · `wp/roadmap-cleanup/rm18-1.2` (3 commits, merged) · spec:
      [`wp-1.2-in-app-docs.md`](./wp-1.2-in-app-docs.md) · 21 files, +2,107 / −3 · no `apps/api` diff,
      no migration, NO NEW DEPENDENCY.**
      The shipped guide is now readable **inside the running app**. A build-time generator bakes
      `planning/user-guide/DC-*/` + `CHANGELOG.md` into the web dist at `/doc-content/` (gitignored,
      never committed); routes `/docs` · `/docs/:subject` · `/docs/changelog`; and **one route-aware
      Help control in the AppShell top bar** resolves to the current view's page — **zero per-view
      file edits**, which is why it could run beside three other agents. The ship rule is structural,
      not a list: a document ships iff its OKF frontmatter is `type: "Guide Page"`, so `doc.md` (the
      delivery record) never ships without a second rule saying so.
      **⚠️ THE CONTAINER CHECK — the item that proves the whole approach — WAS RE-RUN BY THE
      ORCHESTRATOR, not accepted.** Image built from the merged tree: `ls /app/planning` → *No such
      file or directory*; `/api/health` 200; `/docs` → **200 `text/html`**;
      `/doc-content/manifest.json` → **200 `application/json`, 22 real subjects**;
      `/docs/manifest.json` → **200 `text/html`** (the SPA not-found, so the two paths provably do not
      collide); and a real document fetched by the manifest's own path →
      **200 `text/markdown`, 7,099 bytes**, opening "# AI Workbench". Container and volume destroyed
      afterwards; the live `:8081` instance was never touched.
      **THREE DEFECTS A BROWSER FOUND THAT NO UNIT TEST COULD** — all three passed every jsdom
      assertion. (1) **Every guide link was dead**: the markdown renderer emits a link as
      `<button data-streamdown="link">` with no `href` (its AI-content link-safety behaviour), so ~124
      cross-references looked like links and did nothing — 47 anchors on one page, 0 navigable.
      (2) Once fixed, **all of them opened in a new tab** (the pipeline injects `target="_blank"`).
      (3) **Link text failed WCAG contrast in light theme: `text-primary` measured 1.36:1** against
      1.4.3's 4.5:1, and **12.41:1 in dark** — which is precisely why one-theme testing hides it. Now
      `text-foreground`: 13.1:1 light / 15.31:1 dark, re-measured on a rebuilt image.
      **Defect (3) is NOT confined to the docs, and it is now assigned.** The same `text-primary`
      markdown-link colour ships in `features/skills/SkillOverview.tsx:55` (rendered `SKILL.md`) and
      `features/assistant/AssistantMessageBody.tsx:117` (dock replies) — both live. Flagged across the
      boundary rather than edited; the RM-37 session verified both call sites and **took them as its
      WP 2.6 and WP 2.10**. Same root cause as the `app.css` light-theme `--ring` override (upstream's
      lime measures 1.30–1.42:1) — that override was never extended to link *text*.
      **A guard bug found by breaking its own guard:** the generator's direct-run check compared
      `import.meta.url` to `process.argv[1]` verbatim; macOS `tmpdir` is a symlink, so a copy run from
      a temp directory did nothing and **exited 0** — the CLI-failure test would have passed against a
      script that never ran. Now compares real paths.
      **Premise corrections:** the guide is **22 shippable subjects, not 25** — DC-20, DC-24 and DC-25
      hold a delivery record and no `Guide Page`, so they are named on stdout and left out rather than
      rendered blank; and the runtime image also carries `apps/api/resources` (`Dockerfile:104`), so
      "only the three dist folders" was very slightly off. **`.dockerignore` does not exclude
      `planning/`** — load-bearing, since the generator reads it inside the build stage; excluding it
      later fails the build loudly, which is the intended mode.
      **CSP addendum, measured on the container:** `offOrigin: []`, `scripts: 0`, `dataUris: 0`, all
      fetches relative same-origin. **20 inline `style=` attributes DO appear and none are ours** —
      the syntax highlighter's per-token custom properties plus `content-visibility` virtualization,
      a pre-existing property of every markdown surface in the app. Raised with the RM-37 session,
      which **verified its policy already carries `style-src 'self' 'unsafe-inline'`** so nothing
      breaks, and recorded it as a thing not to tighten — the failure mode is silent, just colourless
      code. The renderer also parses raw HTML then sanitizes it, with `allowDataImages: true`; the
      guide uses none today.
      **NOT VERIFIED:** no human has used it; every visual claim is headless Chromium at 1440×950.
      Not checked: viewports < 768px, real zoom, a screen reader, the `system` theme setting.
      **Tab depth to the Help control is 23** from the top of `/dashboard` — whether that is
      acceptable is an owner judgement, not made. The version badge reads `apps/api/package.json`'s
      `0.1.0`, not the root `1.1.0` (pre-existing disagreement, untouched), and is absent in the
      container because the health fetch 401s for a non-loopback caller — it renders nothing rather
      than a fake version. **10 MB of DC-23 screenshots now ship in the dist and image** — a
      deliberate call against 36 broken images, and an owner may reverse it.
- [x] WP 1.3 — diagnostics bundle: redacted export, secret-free proven by test — **done 2026-08-22 ·
      `wp/roadmap-cleanup/rm18-1.3` (2 commits, merged `98c4ca8`) · spec:
      [`wp-1.3-diagnostics-bundle.md`](./wp-1.3-diagnostics-bundle.md) · 12 files, +1,893, no
      deletions · no migration, no table, no column, no dependency, no feature flag.**
      `GET /api/diagnostics{,/markdown}` plus a Settings row that shows the document before it is
      sent. Five groups: versions, environment, database, recent errors, feature state.
      **Secret-freedom is structural, not filtered.** The environment group iterates a **78-entry
      hard-coded catalogue** of the variables `config/env.ts` recognises and emits `{ name, status }`
      — `set` / `unset` / `default`. There is no code path from a variable's value into the document,
      so no regex has to be trusted. The sweep seeds every recognised name **and** every real
      persistence path (server env + header secrets via `ServerRepository`, `OAuthRepository.saveTokens`,
      `ProviderRepository.create`, and a `SecretStore` whose own 32-byte key carries a sentinel) and
      asserts none reaches the JSON **or** the Markdown. The catalogue is drift-tested against
      `config/env.ts` in **both** directions. Markdown is derived from the same payload, pinned by a
      source test: the renderer's arity is 1 and its file names no `process.env`, no `config/env`, no
      `db.prepare`, no `readFileSync`.
      **One acceptance item did NOT hold, and it is on the record rather than smoothed over.** A live
      failing stdio scan against the built API (isolated `DATA_DIR`, port 8099 — this worktree has no
      `data/`, so the owner's database was never opened) put the operator's **configured command path**
      into the bundle through a `spawn … ENOENT` message. Only there, and only that: of five planted
      sentinels the server name, its args, an env secret value and an env var value were all absent
      from both renderings. It was **not stripped** — an ENOENT without its path is not worth filing,
      and stripping would need a second redactor, which is the one thing the WP forbids. The false
      *"no user-typed names"* claim was deleted, the preamble now says to read the errors section
      before pasting, and the boundary is **pinned in BOTH directions** (the errors group must still
      echo a quoted command; the four derived groups must stay clean; the preamble must not make the
      blanket claim) so it cannot silently change either way. **The contradiction was in the spec, not
      the build:** it mandated an errors group quoting system error text verbatim *and* "no MCP
      commands anywhere", which cannot both hold without a path-stripping redactor.
      **An error source exists** — `scan_events` at `level='error'`, `mcp_scans.error_message`,
      `runs.error_message` — but the API's pino log is stdout-only and nothing persists it, so
      `process_log` is always `not_captured`. That distinction is **structural**: the source type is a
      discriminated union, so a `not_captured` source **cannot spell** `matched`, and a dropped table
      degrades to `not_captured` rather than to zero. "Nothing captured" can never render as "no
      errors".
      **Validated by the orchestrator, not taken on the agent's report:** the api suite re-run here at
      **3,758/3,758**; the structural claims re-checked by diff (`*package.json`, `pnpm-lock.yaml`,
      `apps/api/src/db/`, `feature-flags.ts`, `apps/api/src/features/` all zero-line); and the
      headline guard **independently re-broken** — one env var's value emitted into the payload turned
      **3 assertions red** with the exact sentinel message, green again on restore.
      **NOT verified — no browser was opened.** No two-theme look, no keyboard pass, no focus order
      over the new Settings row, its dialog, the tab strip or Copy; every UI claim is a jsdom
      assertion. `CodeSnippet` was never seen rendering a real ~7.7 KB bundle inside the 52vh clamp,
      and `navigator.clipboard` was mocked, never exercised. The `defaulted` classification of the 78
      variables is a mechanical reading of `config/env.ts` — the **names** are drift-tested, the
      classification is not, so a future refactor could add a default without this noticing.
      **Follow-up for the owner (not built):** whether the errors group should be omittable, so the
      default bundle regains a blanket paste-without-reading promise. That is a product call, not a
      defect.
- [x] WP 1.4 — upgrade-path test harness: fixture DBs → migrate → invariants — **done 2026-08-22 · `wp/roadmap-cleanup/rm18-1.4` (2 commits, merged) · spec:
      [`wp-1.4-upgrade-harness.md`](./wp-1.4-upgrade-harness.md). It found a LIVE DEFECT in shipped
      migration code, which is what the WP was for.**
      Six captured fixtures (377 KB total, 31–194 KB each), byte-deterministic from a committed
      generator, incl. `user_version = 0` and the item's named pre-v13 case. The harness asserts six
      invariant classes per fixture — version lands at latest, a second migration is a no-op, no row
      lost, `foreign_key_check` + `integrity_check` clean, the migrated schema matches a **fresh** one
      structurally, and repositories still read. It rides `pnpm test` with no wiring (the api script is
      `tsx --test test/*.test.ts`). api tests 3729 → 3738.
      **THE DEFECT — migration v5 broke `run_feedback` on any pre-v5 database.** v5 rebuilt `run_steps`
      by renaming it away first, on the recorded grounds that *"nothing FK-references `run_steps`"*.
      True at F6; **false since v36**, which added `run_feedback.step_id TEXT REFERENCES run_steps(id)
      ON DELETE CASCADE`. SQLite rewrites a child's stored FK text to follow a renamed parent, so the
      rename silently repointed it at `run_steps_old`, which the rebuild then dropped.
      **Reproduced independently by the orchestrator** in an isolated database — the child's DDL came
      back as `REFERENCES "run_steps_old"(id)`, `foreign_key_check` returned `[]` (it inspects ROWS and
      a new `run_feedback` is empty), and **every** insert then failed with *"no such table:
      main.run_steps_old"* — **including one with a NULL `step_id`**, because SQLite resolves the FK
      target when it PREPARES the statement. The whole human-feedback surface (WP1.5 feedback, WP4.5
      review queue) was dead on such a database.
      **The fix** is the pattern v31 already uses on `runs`: build under a new name, copy, DROP the
      original, RENAME into the freed name — no child DDL is ever rewritten. **Verified independently
      under BOTH `foreign_keys` settings**: the child text stays `REFERENCES run_steps(id)`, rows are
      preserved, the insert succeeds. v31's own comment, which cited v5 as the safe counter-example, is
      corrected in the same diff. **Teeth probed:** reinstating the old pattern turns
      `v00-preversioning` red with *"run_feedback foreign keys differ from a fresh database"*.
      `schema.ts` and the `MIGRATIONS` array are byte-unchanged; `apps/web`/`packages`/`apps/cli` are a
      zero-line diff; the live `data/app.sqlite` was never opened (md5 and mtime unchanged).
      ⚠️ **TWO THINGS LEFT FOR THE OWNER, neither done here.** (1) **Forward path only** — a database
      that ALREADY went through the old rename is not healed; repairing it needs a new numbered
      migration, which this WP was forbidden from adding. Exposure is narrow (only a DB opened at
      `user_version` 0–4 by code that already carried v36's `run_feedback`) and **the owner's live
      database was deliberately not checked against it**. (2) The deep fixtures cannot see column drift
      on `run_steps` and `runs` specifically, because v5 and v31 rebuild those two from today's
      `schemaSql` — that is what `v61-at-capture` is for, and it is documented rather than glossed
- [ ] WP 1.5 — performance & scale pass: fleet-scale fixtures, endpoint budgets, index review.
      **⚠ Scoping input 2026-08-22 — an unbounded `runs` table is now the GUARANTEED shape on a fresh
      install, which raises this WP's value rather than lowering it.** The concurrent RM-37 session
      planned to stamp a nightly 180-day run prune onto fresh installs; the owner overrode it —
      *keep everything, prune nothing unless switched on*. **That ruling restores the shipped
      behaviour rather than changing it**, verified here rather than taken on report: run retention
      is an opt-in **policy** (`POST /api/maintenance/prune-runs`, `db/maintenance.ts:169-175`),
      persisted under `APP_SETTING_RUN_RETENTION_KEY`, and *"absent body → the saved policy (default
      empty → no-op, no auto-prune without explicit configuration)"*; a pinned run is never a victim.
      It is the app's convention stated **four** times — `SCAN_RETENTION_PER_SERVER` default 0
      (`config/env.ts:180-183`, *"retention is opt-in and never silently discards history"*),
      `ASSISTANT_SESSION_RETENTION_DAYS` 0 (`:230-233`), `HUB_SESSION_RETENTION_DAYS` 0 (`:478-482`),
      and the run policy above. **Consequence for this WP:** size the fixtures and the index review
      against a runs table that only ever grows — the endpoint budgets are the thing standing between
      that and a slow bench, since nothing will trim it for the operator.
- [x] WP 1.6 — owner-acceptance consolidation: one runnable checklist across all ledgers — done
      2026-08-21 · wp/roadmap-cleanup/1.1 · every pending owner walk in the bundle, grouped into four
      sittings by prerequisite (browser · provider key · subscription · CI):
      [`owner-acceptance-consolidated.md`](./owner-acceptance-consolidated.md)

## Decision log
_Entries: date · decision · rationale._

- **2026-08-22 · OWNER DECISION — the in-app guide gets NO sidebar entry. Top-bar Help only.**
  Asked directly, as a question with the consequence stated, because nav placement is the owner's
  call and not a work package's — the `/illustrations` precedent, which shipped as a real route with
  no nav item on exactly those grounds. The owner chose *"top-bar Help only"* over *"add it beside
  Settings"* and over deferring.
  **What WP 1.2 therefore builds:** the guide is reached by **one route-aware control in the
  AppShell top-bar `end` slot** (`AppShell.tsx:474-538`) — it opens the page for the view you are on,
  via one route-pattern → subject table — **and by URL**. `AppShell.tsx:764-787`'s `SidebarFooter`
  is untouched; WP 1.2's §5 non-goal *"No new nav item"* stands as written.
  **This decision reaches outside this item, which is why it is recorded here rather than in a
  message.** The concurrent RM-37 session's **WP 2.1** specifies a `SidebarFooter` reading
  *"Settings · Help (→ `/docs`) · Report a problem · version"* — stated three times in its spec
  (`wp-2.1-shell-ia.md:40`, `:91`, `:107`) — and its Phase 1 owner-acceptance line ends *"`/docs`
  opens from the sidebar footer"*. **The owner has now ruled against that entry point.** That is
  RM-37's line to change, not this item's; it was relayed rather than edited (repo scope rule — never
  write another item's ledger on its behalf).
  **Sequence, recorded because it matters to who decided what:** the question was asked *before* the
  RM-37 session sent a stand-down saying no owner interrupt was needed. The stand-down was reasonable
  — its argument was that WP 2.1 already owned the IA decision — but the owner had already answered,
  and an owner answer outranks a peer's reading of which work package owns a choice.

## Owner acceptance (owner-only)
- [ ] Fresh install → load demo data → every main view populated and self-explanatory → remove
      demo data → clean empty states; diagnostics bundle opened and confirmed readable +
      secret-free — accepted: ____
