---
type: "Work Package Spec"
title: "WP 1.4 — In-image user guide at /docs, Help + Report a problem in the shell, redacted diagnostics export, pre-flight panel"
description: "Phase 1 of item.md. Ledger: STATUS.md. Ships the 24-subject user guide inside the image and serves it at /docs, adds Help and Report a problem to the shell, delivers RM-18 WP 1.3's one-click redacted diagnostics export proven secret-free by test, and adds a pre-flight / demo-readiness panel whose rows each carry a fix link."
tags: ["roadmap", "RM-37"]
timestamp: "2026-08-22T07:10:00Z"
status: "final"
---
# WP 1.4 — In-image user guide at `/docs`, Help + Report a problem in the shell, redacted diagnostics export, pre-flight panel

Phase 1 of [`item.md`](./item.md). Ledger: [`STATUS.md`](./STATUS.md).

## Scope

Delivers **RM-18 WP 1.2** (in-app docs route, per-view help links) and **RM-18 WP 1.3** (redacted
diagnostics bundle), both open in [`/Roadmap/RM-18-platform/STATUS.md`](/Roadmap/RM-18-platform/STATUS.md).
RM-37 adds: the content is the existing guide under `planning/user-guide/DC-01…DC-24` (not only
`docs/skill-authoring.md`), it travels inside the image, the shell gets Help and Report a problem, the
diagnostics export moves the filesystem paths out of `/api/health`, and a pre-flight panel reads the same
checks a demo needs. Surfaces: a build step writing `apps/api/resources/docs/` (the `Dockerfile` already
copies `apps/api/resources`), new `GET /api/docs/*` routes in `apps/api/src/`, a `/docs/*` web route in
`apps/web/src/App.tsx` rendered with `apps/web/src/features/testing/ChatMarkdown.tsx`, the sidebar footer
(`apps/web/src/components/AppShell.tsx:781-786`), Settings › About (`apps/web/src/features/settings/SettingsView.tsx:1173-1190`),
the toolbar ⓘ (`apps/web/src/components/ViewToolbar.tsx:82-130`), `/api/health` (`apps/api/src/index.ts:1421-1430`),
`scripts/release/README.md`. Out of scope: the footer's final layout and "Local / dev mode" removal
(wp-0.2/wp-2.1), CHANGELOG discipline and the version source (wp-0.2), the key-mismatch degraded boot
(wp-0.3, ENG-07), the API-down shell banner (wp-3.3, ENG-19), the demo seed the panel links to (wp-1.1).

## Actions

1. **Build the guide into the image**: `scripts/build-docs.mjs` (run by `pnpm build`) copies
   `planning/user-guide/DC-*/**/*.md` + `DC-23-product-overview/images/` + `CHANGELOG.md` into
   `apps/api/resources/docs/`, rewrites relative links to `/docs/<subject>/<page>`, and emits
   `index.json` (subject id, title, pages, first heading per page). Heading anchors are generated
   deterministically from heading text and kept stable (quality findings deep-link them). No new runtime
   dependency: markdown ships as markdown. **P1**
2. **Serve it**: `GET /api/docs/index`, `GET /api/docs/:subject/:page` (markdown text) and
   `GET /api/docs/assets/*` (images) behind the normal guard (loopback open, remote needs a token);
   web route `/docs`, `/docs/:subject`, `/docs/:subject/:page` rendering with `ChatMarkdown`, a left
   subject list, in-page heading outline, search over titles, and theme-aware images. 404s render the
   existing error panel. **P1**
3. **Help and Report a problem in the shell**: sidebar footer gains "Help" → `/docs` (placed by wp-2.1;
   this WP adds the entry and the route); Settings › About gains links "User guide", "Changelog"
   (`/docs/changelog`) and "Report a problem" → `REPORT_PROBLEM_URL` (new env, documented in
   `.env.example`); when unset the link reads "Copy diagnostics and send them to the person who gave you
   this build" and triggers action 5. **P1**
4. **Per-view help links**: the ⓘ tooltip in `ViewToolbar.tsx:82-130` gains "Learn more →" to the view's
   subject (map: servers → DC-02, scans → DC-03, compare → DC-04, advisor → DC-11 or the Advisor page
   once it exists, skills → DC-07, runs/console → DC-08, suites/collections → DC-09, compatibility →
   DC-10, environments → DC-08, settings → DC-14, tokens → DC-17); every main-view empty state links the
   same subject under its description. **P2**
5. **Diagnostics export** (RM-18 WP 1.3): `GET /api/diagnostics` — loopback only, never auth-exempt, not
   mapped to any token scope — returns JSON: app version + git sha (from wp-0.2/0.6), Node version,
   `dockerMode`, platform/arch, `databasePath`, `dataDirectory`, DB `user_version` + `LATEST_SCHEMA_VERSION`,
   migration log, table row counts and file sizes, feature flags, env variable NAMES present (never
   values), provider kinds and counts (no ids, no labels), the last 200 log lines passed through the
   secret scrubber, MCP server names with transport (no URLs, no commands). Settings › About gains
   "Copy diagnostics" and "Download diagnostics.json". `/api/health` stops returning `databasePath` and
   `dataDirectory` (they move here). **P1**
6. **Secret-free by test**: a test seeds real-shaped material — an `sk-ant-…` key, a GitHub PAT, an env
   value, a server header, a subscription token — into providers, servers and log lines, calls the
   export, and asserts none of it appears (same discipline as `apps/api/test/grade-feedback.test.ts`). **P1**
7. **Pre-flight panel** Settings › About › "Pre-flight" (route `/settings/about#preflight`, also linked
   from the dashboard first-run state): rows with state + fix link — API reachable and version ·
   provider credential present and last verified (server-side health from wp-2.9; until then "n
   completed runs") · judge configured and priced → `/settings/grading` · assistant credential OK (only
   while the `assistant`/`app_assistant` flags are on) · servers failed or unscanned (list, each →
   `/servers/:id`) · open issues count · demo data loaded / snapshot present (→ Settings › Storage,
   wp-1.1) · feature flags summary. Every row is a plain sentence; none carries a rating word. **P1**
8. **Bundle README** (`scripts/release/README.md`): "Troubleshooting" gains `docker logs
   mcp-token-footprint`, "open Settings › About › Copy diagnostics", and "the user guide is at
   `http://localhost:<port>/docs`"; the recipient folder gets `docs.pdf` produced by
   `scripts/build-docs.mjs --pdf` with the Playwright already in devDependencies (not part of the image). **P2**

## Acceptance

- [ ] `docker run … ls apps/api/resources/docs` lists 24 subjects + `changelog.md`; `/docs` renders the
      index and every page with its images in both themes; a crawler test follows every internal link
      and finds no 404 and no anchor without a target.
- [ ] Help is reachable from the sidebar footer and from Settings › About; Report a problem opens
      `REPORT_PROBLEM_URL` when set and the diagnostics fallback when not.
- [ ] Every main view's ⓘ carries a working "Learn more →"; every main-view empty state links its subject.
- [ ] `GET /api/diagnostics` returns 401 from a non-loopback peer and the full payload on loopback; the
      action-6 test passes; `/api/health` no longer contains `databasePath`/`dataDirectory` (test).
- [ ] On a fixture DB with one failed server, no judge and no provider, the pre-flight panel shows exactly
      those three rows as not ready, each link landing on the named surface (test + e2e).
- [ ] `docs.pdf` builds and opens; the bundle README troubleshooting section contains the three lines.
- [ ] RM-18's owner line "diagnostics bundle opened and confirmed readable + secret-free" is walkable
      and listed in wp-4.1.
- [ ] Gate green: `pnpm typecheck && pnpm test && pnpm build && pnpm lint`.

## Effort

**M** — a build script, three small routes, one web route reusing the markdown renderer, a diagnostics
projection with a scrubber test, and one settings section; the content already exists.

## Sources

PO-21 · PO-22 · PS-18 · PS-23 · ENG-27 · SEC-13 (paths leave `/api/health`) · walkthrough Settings
note (About has no docs/changelog/diagnostics links) · RM-18 WP 1.2 / WP 1.3 definitions.
