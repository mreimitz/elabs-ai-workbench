---
type: "Work Package Spec"
title: "WP 1.2 - in-app docs and changelog (the shipped user guide readable inside the running app, plus one context-aware Help control in the top bar)"
description: "Bundles planning/user-guide/DC-* and CHANGELOG.md into the web build at build time, serves them at /docs, and adds a single route-aware Help control to the AppShell top bar so every view reaches its own page of the guide without a per-view edit."
tags: ["roadmap", "RM-18"]
timestamp: "2026-08-22T20:30:00Z"
status: "final"
---
# WP 1.2 — in-app docs & changelog

Ledger: [`STATUS.md`](./STATUS.md) (line 30 — *"docs & changelog: in-app docs route, CHANGELOG
discipline, per-view help links"*). Item: [`item.md`](./item.md).

**Not blocked.** Both historic "blocked on Benchmarks P1/P3" flags on this item were rechecked
2026-08-21 and were false; the ledger records that nothing here is blocked on another workstream.

---

## 1. The problem

The app ships a real, maintained user guide — **25 subjects** under `planning/user-guide/DC-*/`,
each a documentation *part of the system* rather than a roadmap item — and a `CHANGELOG.md`. **None
of it is reachable from the running app.** An operator with the container open has no way to read
how the thing in front of them works; they need the repository, which the offline-bundle recipient
(RM-19) does not have at all.

The runtime image makes this concrete: the Docker build stage copies the whole repository
(`Dockerfile:60`) but the **runtime stage copies only `apps/api/dist`, `apps/web/dist` and
`packages/shared/dist`** (`Dockerfile:83-85`). So `planning/` is not on disk at runtime, and no
API route could read it even if one existed. Whatever ships must be **baked into the web build**.

---

## 2. Where every premise below was read

Read at `main` @ `01a87fe`.

| Fact | Read at |
| --- | --- |
| 25 documentation subjects exist | `planning/user-guide/` (DC-01 … DC-25) |
| The runtime image carries only the three `dist` folders | `Dockerfile:83-85`; the build stage copies everything at `:60` |
| `apps/web/public/` exists and is Vite's static passthrough | `apps/web/public/favicon.svg` |
| The web build is plain `vite build` | `apps/web/package.json:7` |
| The repo build is `pnpm -r --sort build`; dev is `pnpm dev` | `package.json:8`, `:11-13` |
| The top bar's `end` slot is one place, rendered once for every route | `apps/web/src/components/AppShell.tsx:474-538` (search button, `NotificationBell`, `ThemeMenu`, dock toggle) |
| Every `<Route path>` needs exactly one route-manifest entry, byte-identical | `.claude/rules/assistant-operability.md`; the gate is `apps/api/test/assistant-route-operability.test.ts` |
| The sanctioned shape for a page with no entity to operate | `packages/shared/src/assistant-route-manifest.ts:195-204` (the `/illustrations` reasoned exemption) |
| PageShell routes are registered in one PM-owned set | `apps/web/src/App.tsx:232-244` (`PAGESHELL_EXACT_ROUTES`) |
| Route-vs-dialog rule | `.claude/rules/routes-vs-dialogs.md` (D-TB10) |
| The changelog-follows-the-work rule already exists as a hard rule | `CLAUDE.md` §11, *"The front page follows the work"* |

---

## 3. Scope

### 3a. A build-time docs bundle

A generator script — `scripts/build-docs-bundle.mjs` — reads `planning/user-guide/DC-*/` and the
repo `CHANGELOG.md`, and writes into **`apps/web/public/doc-content/`**:

- one Markdown file per document, at a stable, URL-safe path;
- one `manifest.json`: subject id, tag (`DC-NN`), title, ordered document list, and each document's
  path — enough for a table of contents without reading 25 files.

Decisions to honour, and why:

- **`/doc-content/`, not `/docs/`.** The client route is `/docs/*`; the SPA fallback would otherwise
  race the static file for `/docs/manifest.json`. Two different names, no collision, no ordering
  assumption about the API's static plugin.
- **Generated, never committed.** `apps/web/public/doc-content/` goes in `.gitignore`. A committed
  copy of a document that lives somewhere else is a second source of truth, and it will drift.
- **Wired into `build` and `dev`** so a fresh clone and the Docker build both get it without a
  remembered step. It must run *before* `vite build`.
- **`doc.md` is excluded.** Inside a DC subject, `doc.md` is the *delivery record* — what shipped
  versus what was planned — written for whoever maintains the project, not for the operator. Ship
  the guide pages; leave the delivery record in the repository. Say so in the generator's header.
- The generator asserts it found a non-zero number of subjects and fails loudly if it does not — a
  silently empty docs section is worse than a build error.

### 3b. The routes

- **`/docs`** — the guide's index: the subjects, grouped, with their titles. Useful with **zero
  query params** (D-TB10).
- **`/docs/:subject`** — one subject, its documents rendered as Markdown, with in-page anchors.
- **`/docs/changelog`** — the repo `CHANGELOG.md`, rendered. A reserved subject id; the generator
  must refuse to emit a DC subject that would collide with it.

All three are **routes, not dialogs**: an operator bookmarks a page of the manual, pastes it to a
colleague, and reloads it.

Register each in `PAGESHELL_EXACT_ROUTES` (or its prefix list for the dynamic one) and add exactly
one `ASSISTANT_ROUTE_MANIFEST` entry per `path=` literal. There is no documentation entity for the
dock to operate and no doc-aware read tool, so these are `surface: "global"` with an honest
`exempt` reason in the shape of the `/illustrations` entry — **not** a fabricated pin. The
operability gate will hold you to whatever you declare.

### 3c. Markdown rendering — reuse, do not add

The app already renders Markdown (`ChatMarkdown` in the assistant surface; the read-only code
display in `features/testing/CodeSnippet.tsx`). **Find the existing renderer and reuse it.** Adding
a Markdown dependency for this is out of scope and needs owner approval
(`.claude/rules/dependencies.md`). If nothing reusable exists, **stop and report that** rather than
adding a dependency — a docs page that ships a month later is cheaper than a second Markdown engine.

### 3d. One context-aware Help control (this is the "per-view help links")

A single control in the **top bar's `end` slot** (`AppShell.tsx:474-538`), beside the notification
bell and theme menu. It reads the current route and opens **that view's** page of the guide; where
no mapping exists it opens the index rather than disappearing or dead-ending.

The mapping is **one table**, route pattern → subject id, living beside the manifest-style
registries the app already keeps. That is the whole reason the control goes in the top bar:
**zero per-view file edits**, so this WP cannot collide with any other work, and a new route gets
help by adding one line rather than editing a view.

- It is an icon-only control, so D-TB5 binds: use `IconButton`, tooltip text **equal to** the
  `aria-label`, no native `title` (`.claude/rules/icon-affordances.md`).
- Keyboard reachable with a visible focus ring, both themes.

### 3e. Changelog discipline

The discipline itself is already a hard rule (`CLAUDE.md` §11). What this WP adds is the payoff:
the changelog is **visible in the product**, so "what changed in this build" is answerable by the
person running it. Include the app version alongside it if one is already available — do **not**
invent a version scheme.

---

## 4. Files

**Add:**

- `scripts/build-docs-bundle.mjs` (+ its test)
- `apps/web/src/features/docs/DocsIndexView.tsx`
- `apps/web/src/features/docs/DocsSubjectView.tsx`
- `apps/web/src/features/docs/ChangelogView.tsx`
- `apps/web/src/features/docs/docs-manifest.ts` (fetch + types for the generated manifest)
- `apps/web/src/features/docs/help-map.ts` (route pattern → subject id, the one table)
- `apps/web/src/components/HelpButton.tsx`
- co-located tests for the manifest reader, the help map and the button

**Modify:**

- `apps/web/src/App.tsx` (three routes, `PAGESHELL_EXACT_ROUTES`)
- `packages/shared/src/assistant-route-manifest.ts` (three entries, each with a reasoned exemption)
- `apps/web/src/components/AppShell.tsx` (the top-bar `end` slot — **one insertion**)
- `package.json` (wire the generator into `build` and `dev`)
- `.gitignore` (`apps/web/public/doc-content/`)

**Do not touch** (another agent holds them this batch): `apps/web/src/features/skills/**`,
`apps/web/src/features/testing/**`, `apps/web/src/features/watch/**`, `apps/web/src/lib/api.ts`,
`apps/api/src/**`, `packages/illustrations/**`.

---

## 5. Non-goals

- **No API endpoint, no migration, no table, no column, no feature flag, no new dependency.** The
  documents are static build output; the API is a zero-line diff.
- **No editing.** The guide is read-only in the app; it is authored in the repository through the
  OKF generators (`CLAUDE.md` §11), and nothing here may write into `planning/`.
- **No search across the docs** (the ⌘K palette staying out of scope is deliberate — it is its own
  piece of work).
- **No new nav item.** Reached from the top-bar Help control and by URL. Whether the guide earns a
  sidebar entry is an IA decision for the owner, exactly as `/illustrations`' placement was.
- **No rewriting of any guide content**, and no `doc.md` in the shipped bundle.
- **No first-run seeding, no guided empty states** — that is WP 1.1, and it must stay separable.

---

## 6. Acceptance

1. `pnpm build` from a clean tree produces `apps/web/dist/doc-content/manifest.json` and one file per
   shipped document, with **no committed copy** anywhere in git.
2. **The container serves them.** Build the image and confirm `/docs` renders the guide with
   `planning/` absent from the runtime stage — this is the acceptance item that proves the whole
   approach, and it is the one an in-tree dev server cannot prove.
3. `/docs`, `/docs/:subject` and `/docs/changelog` each render something useful with **zero query
   params**; a subject id that does not exist renders a real not-found state, not a blank page.
4. **`/doc-content/` and `/docs/` never collide** — asserted directly, including a request for
   `/docs/manifest.json` (which must be the SPA route's not-found, not a JSON file).
5. **One route-manifest entry per `path=` literal**, and `pnpm test`'s
   `assistant-route-operability` gate is green. Each exemption reason is specific and honest.
6. **The Help control appears once**, on every route, resolves to the right subject for at least the
   main views, and falls back to the index rather than vanishing. Pinned by a test over the map.
7. **D-TB5 holds** on the Help control: `IconButton`, tooltip text equal to `aria-label`, no native
   `title`.
8. **The generator fails loudly** on zero subjects, and refuses a subject id colliding with
   `changelog`. Break each and watch it go red.
9. **No new dependency** in `apps/web/package.json` or the root. If Markdown rendering could not be
   reused, the WP reports that instead of adding one.
10. **No `apps/api/**` diff. No migration. No `user_version` claimed.**
11. **Gate green**: `pnpm typecheck && pnpm test && pnpm build && pnpm lint` from the repo root.
12. **Report what was not verified.** Both themes and a keyboard pass over the Help control and the
    docs pages are owner-acceptance unless a browser was actually opened — say which, plainly. No
    browser has been opened for anything in RM-18 so far.
