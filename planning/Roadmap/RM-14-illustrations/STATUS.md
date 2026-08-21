---
type: "Status Ledger"
title: "Illustrations \u2014 work-package status ledger \u00b7 PRIORITY: HIGH"
description: "Driven by /next-wp illustrations. This ledger is the single source of truth for"
tags: ["roadmap", "RM-14"]
timestamp: "2026-08-21T10:15:00Z"
status: "active"
---
# Illustrations — work-package status ledger · **PRIORITY: HIGH**

Driven by `/next-wp illustrations`. This ledger is the **single source of truth** for
in-flight state; [`02-plan.md`](./02-plan.md) describes scope, [`decisions.md`](./decisions.md)
(D-IL1–D-IL17) constrains design.

Legend: `[ ]` open · `[x]` done — done lines record `— done <YYYY-MM-DD> · wp/illustrations/<id>`
(branch/sha), what shipped, deviations, the gate result (`typecheck · test · build · lint`),
and an explicit "Not verified:" tail.

> Locked decisions live in [`decisions.md`](./decisions.md). Recommended waves:
> 0.1 → 0.2 → 0.3 first (prove the language end-to-end), then 1.1–1.3 in parallel worktrees,
> 1.4 after any one of them, 2.x sequential, 3.x/4.x after 2.4.

## Phase 0 — Foundations

- [x] WP 0.1 — Package scaffold + `--illus-*` token layer + shared spec/registry schema stubs
      — done 2026-08-20 · `wp/illustrations/0.1` (4 commits, merged fast-forward to `main` @ `feb19c7`)
      · spec: [`wp-0.1-scaffold.md`](./wp-0.1-scaffold.md).
      **Shipped:** `packages/illustrations` wired like `packages/shared` (ESM, `types→src`/`default→dist`,
      own build/typecheck/test, `react` as a PEER, zero new runtime dependency); `src/tokens.css` — the
      single `--illus-*` mapping file (15 bindings + 3 derived faces) with `src/tokens.ts` as its
      machine-readable mirror and `ILLUS_FACE_SEPARATION_FLOOR`; `packages/shared/src/illustration-registry.ts`
      + `illustration-scene.ts` (closed D-IL8 vocabularies, `.strict()` zod, `ILLUSTRATION_REGISTRY_VERSION`
      `0.1.0`, required `title`/`summary` so a11y is schema-enforced) exported from `index.ts`; the
      `apps/web` dependency + the `app.css` `@import` after the two theme sheets. 14 files, **+1699, 0
      deletions**. Renders nothing, by design.
      **Gate (re-run by the orchestrator on the branch, not taken on report):** typecheck clean ·
      shared **236** (186 before) · illustrations **14** (new) · api **3564** · web **3615 passed / 5
      skipped** · cli **87** · build green · lint clean (1596 files). Consumers byte-identical to the
      2026-08-20 baseline measured on `main` @ `4376dec`.
      **Teeth verified by the orchestrator, each broken and restored:** (1) removing `"signal"` from
      `ILLUSTRATION_CONNECTOR_KINDS` → `not ok 47 … closed vocabularies (D-IL8)`; (2) light left face
      32%→12% → `light: top to left separates by 8.4% … under the 20% floor`; (3) dark left 10%→2% →
      `dark: … 5.3% … under the 20% floor`; (4) a `"#ff0000"` smuggled into `tokens.ts` →
      `not ok 2 … no color literal anywhere in this package (D-IL5)`.
      **Refine round:** guard (2)/(3) did **not** exist on first delivery — `ILLUS_FACE_SEPARATION_FLOOR`
      was asserted only `> 0 && < 1`, a tautology, so the four hand-tuned percentages were guarded by a
      comment. Sent back; the agent added a static arithmetic test that parses the mixes **out of
      `tokens.css`** and asserts both adjacent pairs in both themes. WP 0.1's spec had deferred this to
      WP 0.2, so this was an orchestrator addition, not a missed requirement.
      **Accepted deviation (D-IL15 tuning):** face mixes are **light 32%/61% · dark 10%/26%**, not
      research §3.3's illustrative 12%/24% — those yield only **8.4%/9.2%** separation against the 20%
      floor. Orchestrator recomputed independently against the installed `@elabs-ai/components-tokens@4.0.0`
      values (light `--card` L 1.000 / `--foreground` L 0.300; dark 0.250 / 0.950): the tuned light faces
      land at **77.6% / 57.3%** of top — inside research's own 75–80% / 55–60% bands — at 22.4% / 26.2%
      separation; dark at 21.9% / 25.9%. `tokens.css` is the sanctioned place for this per D-IL15.
      **Other accepted deviations:** `illustration-scene.ts` imports its sibling `illustration-registry.ts`
      (one closed vocabulary, not two — the spec's "imports zod and nothing else" meant no third-party
      or platform import); `entity` is a snake_case *pattern*, not a closed enum, because freezing it
      would block WP 0.3+ and `ASSISTANT_ENTITY_KINDS` is the D-AO3 write-scope boundary and untouchable;
      named `ILLUSTRATION_REGISTRY_VERSION` (a bare `REGISTRY_VERSION` would collide on shared's flat
      `export *`); no `@source` line added — correct today, the package ships custom properties and no
      className strings, and `app.css` carries the note for when that changes.
      **Front page deliberately NOT updated:** WP 0.1 adds no user-visible capability, and its spec
      defers the `README.md`/`CHANGELOG.md` update to WP 0.3, the first delivery an owner can see.
      **Not verified:** nothing visual — the package renders nothing, so there is no both-theme look to
      do; the face separation is verified as *arithmetic against installed token values*, never as
      pixels. The `@import` is proven through the build (all 18 `--illus-*` properties reach the built
      CSS), not in a browser. One api test failed **once in four runs** and never reproduced; the branch
      touches **zero** files under `apps/api`, so it cannot be caused by this work — plausibly RM-10's
      documented `hub-workspace.test.ts` same-millisecond flake, but the failing test's name was not
      captured, so that is a hypothesis, not a finding. Lightning CSS wraps each `color-mix` in an
      `@supports` guard whose fallback flattens the faces and makes `--illus-shadow` opaque ink on a
      browser without `color-mix` support — build output only, so D-IL5's grep is unaffected.
      **Merged while another session (RM-32) held uncommitted work in the tree — owner-directed.**
- [x] WP 0.2 — Iso primitives (PaperStage, IsoPlatform, IsoHousing, GlyphFrame,
      ConstructionGhost, StationHeader, Connector ×6 kinds, cards, EntityRoot)
      — done 2026-08-21 · branch `worktree-agent-aac5800e6428e8cea` (harness-named, **not** the
      planned `wp/illustrations/0.2`), 5 commits `7b4e944`..`725befd`, rebased onto `main` @ `8c2ddf9`
      and merged **fast-forward** · spec: [`wp-0.2-primitives.md`](./wp-0.2-primitives.md).
      **Shipped:** `iso-math.ts` (the projection, the three face matrices, the iso-ellipse rule, the
      quantized footprints — pure, no React) with a 466-line test; `layers.tsx` (the D-IL16 fixed
      paint order) and `line-system.ts`; **ten primitives, one file each** (`PaperStage`,
      `IsoPlatform`, `IsoHousing`, `GlyphFrame`, `ConstructionGhost`, `CalibrationCube`,
      `StationHeader`, `Connector`, `CalloutCard`, `PrincipleCard`) plus `EntityRoot`; the dev-mode
      face-separation assertion (`src/dev/`, a no-op under `NODE_ENV==="production"`, itself tested);
      a both-theme preview sheet + the two scripts that render and photograph it; and an **unrouted**
      web preview page. 35 files, **+4501 / −13**. No route, no manifest entry, `App.tsx` untouched
      (both are WP 0.3's, and a route without a manifest entry fails `assistant-route-operability`).
      **Gate — re-run by the orchestrator in the worktree, with the path pinned in every command,
      not taken on the agent's report:** typecheck all Done · shared **236** · illustrations **166**
      (14 before) · cli **87** · api **3564** (baseline exactly) · web **344 files / 3678 passed / 5
      skipped** · build all Done · lint clean (1652 files).
      **Teeth verified by the orchestrator — each broken, watched go red, and restored:**
      (1) face `scaleY` 0.866→0.75 → **11** failures, incl. `not ok 7 — iso-math — the three fixed
      face transforms (D-IL15)` and `not ok 8 — the iso-ellipse rule`; (2) light left face 32%→5% →
      `light: top to left separates by 3.5% (L 1.000 vs 0.965), under the 20% floor` — firing in
      **both** the new shipped assertion **and** WP 0.1's arithmetic test; (3) deleting the
      seventh-kind `@ts-expect-error` → `error TS2322: Type '"teleport"' is not assignable to type
      '"read" | "flow" | "write" | "publish" | "loop" | "signal"'`, proving acceptance item 4 is a
      **compile-time** guarantee rather than a runtime fallback.
      **Both themes verified by the orchestrator BY LOOKING** at
      `.artifacts/illustrations-preview/primitives-{light,dark}.png` (headless Chromium 1223, device
      scale 2, real installed theme stylesheets + this package's unmodified `tokens.css`) — not
      merely accepted from the report. Both read correctly: three distinguishable faces, sparing
      accent, all six connector kinds, all five states, the ports overlay and the `facing` variant.
      **Orchestrator process note, recorded because the failure mode is invisible:** an intermediate
      spot-check was run from the **main** tree by mistake and reported `illustrations 14` — the
      pre-WP count — which looked exactly like "the new tests never ran". The full gate had in fact
      been correct; re-running with the worktree path pinned gives 166. A package silently reporting
      its old count is indistinguishable from a passing one, which is why every gate command in this
      tick names its directory explicitly.
      **Accepted deviations from the exemplar** (`examples/Agent.example.tsx`): `EntityRoot` renders a
      `<g>`, not a standalone `<svg>`, so an entity can be placed inside a scene; the `m` platform is
      **6 units**, not the exemplar's 5.6, because D-IL2 quantizes `m` at 6×6 and the spec wins (the
      1.4-unit tier inset is kept, so the silhouette is unchanged); ports resolve from **side +
      offset** per the WP 0.1 registry contract rather than literal `project()` coordinates; the
      ground shadow derives from the footprint through the iso-ellipse ratio instead of fixed radii;
      text reads no custom property at all, since the exemplar's `var(--font-sans, …)` is outside the
      closed `--illus-*` set. **The three face matrices are byte-identical to the exemplar's** — that
      geometry was lifted, not re-derived.
      **Accepted deviations from the spec text:** "top: `scaleY(0.866)`" is not a face transform on
      its own (a bare vertical squash leaves art axis-aligned while the top face is a rhombus), so all
      three faces use the full `rotate ∘ shear ∘ scaleY(0.866)` triple; the shear **signs are
      mirrored** because SVG's y axis points down while the drafting recipe is written y-up; and
      "side-facing: rotated ±30°" describes the **minor** axis, which as an SVG rotation of a
      horizontal-major ellipse is ∓60°. None of the three is taken on argument — each matrix is tested
      to reproduce `project()` exactly, and the ellipse angle is measured back off the face matrix.
      `Connector` draws its arrowhead as a **polygon**, not a `<marker>`, because a marker needs an id
      that is either duplicated across two connectors of one kind or generated, and a generated id
      breaks "same props ⇒ same SVG".
      **Dependencies:** `react-dom` + `@types/react-dom` as **devDependencies of this package only**
      (`renderToStaticMarkup` for the tests and the preview builder). `react` stays a peer; **zero
      runtime dependencies added** (D-IL3 intact) — confirmed absent from the web bundle. The exports
      map also gained a **`development` condition** pointing at source, without which `apps/web`'s
      vitest cannot resolve the package at all (`default` points at a `dist` no test step builds).
      **One file touched outside the stated scope, and it was necessary:** WP 0.1's `tokens.test.ts`
      no-color-literal scan used a flat `readdirSync`, so it would have walked straight past every
      file WP 0.2 added — a guard reporting green while checking nothing. Made recursive, with an
      added assertion that the scan actually reaches a subdirectory.
      **Front page deliberately NOT updated:** WP 0.2 adds no user-visible capability — the package
      still renders nothing in the app, since it has no route until WP 0.3 — so `README.md`'s
      "🔜 Planned" row for the illustration system remains **accurate, not stale**, and no
      `CHANGELOG.md` entry is owed. Same reasoning WP 0.1 recorded; the front-page update lands with
      WP 0.3, the first delivery an owner can see.
      **Not verified:** the preview page has **never been reached through the running app** — it has
      no route until WP 0.3, so it is proven in jsdom and in real Chromium via the standalone sheet,
      but not inside the app shell with the app's own stylesheet cascade. Keyboard/focus of the
      preview page was not walked (it has no interactive controls of its own beyond a tooltip
      trigger). The **dark-stage lighting flip** — side faces lighter than the top — is plainly
      visible in the dark screenshot and remains an **owner judgement** (accepted at WP 0.1 as
      unavoidable with this token set); the orchestrator confirms it is legible, not that it reads as
      intent. The `signal` connector is **very faint on the light theme** (`--illus-accent-2` maps to
      `--chart-3`, a light grey there) — that is the §2.3 table applied literally, and worth an owner
      glance. `packages/illustrations/scripts/` is **not typechecked** (the package tsconfig includes
      only `src`); both scripts were run successfully and ship nothing.
- [x] WP 0.3 — Pilot entities (`mcp-server`, `skill`, `agent`) + registry v0.1 + `/illustrations`
      gallery route v0 — done 2026-08-21 · `wp/illustrations/0.3` (5 commits `69941f1`..`c43520b`),
      merged **--no-ff** as `a175d08` — *not* fast-forward, because another session's commit
      `4c50e23` landed on `main` first (see the deviations tail) · spec:
      [`wp-0.3-pilot-entities.md`](./wp-0.3-pilot-entities.md).
      **Shipped:** three pilot entities under `src/entities/` — `mcp-server`
      (`stdio` / `streamable-http`), `skill` (`plain` / `versioned`) and `agent` (D-IL17 `facing`,
      default `upstream`) — each at S/M/L × all five states × its variants, each with a co-located
      `*.test.tsx` calling a shared `contract-support.tsx` harness that asserts **against the
      registry entry, never against a literal repeated in the test**; `src/registry.ts` — registry
      v0.1 (`REGISTRY_VERSION` re-exporting the shared `ILLUSTRATION_REGISTRY_VERSION` so there is
      one value under two names, entries `.parse`d against the WP 0.1 zod schema **at module load**,
      and a separate component map held equal to the entry ids **in both directions** because the
      schema is `.strict()` and `packages/shared` must not import React); and
      `apps/web/src/features/illustrations/` — the `/illustrations` route: a live grid in the current
      theme, a detail dialog with the states × sizes × variants × facing matrix + a port overlay +
      the entry itself, and a second tab that finally makes WP 0.2's primitives sheet reachable
      through the running app. 26 files, **+2675 / −165**.
      **Gate on the branch (re-run by the orchestrator in the worktree with the path pinned, not
      taken on the agent's report):** typecheck clean · shared **236** · illustrations **252** (166
      before) · cli **87** · api **3564** (baseline exactly) · web **346 files / 3697 passed / 5
      skipped** (344 / 3678 / 5 before) · build all Done · lint clean (1668 files) · exit 0.
      **Gate re-run by the orchestrator on the MERGED `main`**, because this WP and `4c50e23` had
      never been tested together: shared **238** · illustrations **252** · cli **87** · api **3567** ·
      web **346 files / 3702 passed / 5 skipped** · build Done · lint clean · exit 0. The deltas over
      the branch numbers (+2 shared, +3 api, +5 web) are `4c50e23`'s, not this WP's.
      **Teeth verified by the orchestrator — five guards, each broken, watched go red, and restored:**
      (1) manifest entry deleted → `not ok 1 - Test A … App.tsx routes with NO manifest entry (add
      one with a real surface or a reasoned exempt/redirect): ["/illustrations"]`, restored → `# pass
      5 / # fail 0`; (2) `#a3e635` substituted for `var(--illus-accent)` in `Skill.tsx` → **two**
      independent failures, `not ok 24 - skill — construction (D-IL5, D-IL12)` **and** WP 0.1's
      recursive scan `not ok 63 - no color literal anywhere in this package (D-IL5)`; (3) a raw
      `<path>` injected into `McpServer` → `mcp-server (s/stdio) drew a <path>; entities compose
      primitives`, which is how the spec's otherwise-unenforceable "composed only from primitives"
      became a test; (4) the entity made to render **1 of its 5 declared ports** → `not ok 14 -
      mcp-server — the drawing matches the entry`; (5) `"/illustrations"` removed from
      `PAGESHELL_EXACT_ROUTES` → this WP's own `illustrations-route.test.ts` fails (`the PageShell
      registry mounts it full-bleed — the direction NO test gates (spec §4b)`) **while the
      pre-existing `App.test.ts` stayed 28/28 green** — the silent-failure asymmetry spec §4b warns
      about, observed live and now closed *for this route*.
      **A trap that cost an owner-visible false alarm, and that WILL recur — read this before the
      acceptance walk.** Minutes after the merge the owner opened `127.0.0.1:5173/illustrations` and
      **every illustration was a solid black rectangle** while the surrounding chrome rendered
      perfectly. Nothing was wrong with the code. That dev server had been running since **Aug 19
      14:48**, which is **before WP 0.1 linked `@mcp-token-footprint/illustrations` into `apps/web`
      at all** (the symlink is stamped Aug 20 22:26). When its Tailwind pass first processed
      `app.css`, `@import "@mcp-token-footprint/illustrations/tokens.css"` could not resolve, the
      `@import` was **dropped silently — no warning, no error** — and the result was cached and served
      unchanged for a day and a half. With the `--illus-*` layer absent, every `fill: var(--illus-...)`
      is invalid at computed-value time and falls back to the CSS initial value for `fill`, which is
      **black** — so the failure mode of a missing token layer is not "unstyled", it is "perfectly
      laid out and entirely black". Diagnosed, not guessed: the transformed `app.css` that server
      served contained **0** occurrences of `illus` across 296 KB; a fresh `vite` on the **same tree**
      served all **18** `--illus-*` properties; and the production build
      (`dist/assets/index-D0J9cWRW.css`) carries all 18 too. **The fix is to restart the dev server**;
      there is no code change, and none was made. Two lessons worth keeping: a long-running dev server
      is *not* evidence about the tree it points at, and this is the concrete browser-level proof WP
      0.1's ledger recorded as missing when it verified the `@import` "through the build, not in a
      browser".
      **A non-finding, recorded so a later reader does not mistake it for a hole:** adding a port to
      an entity's registry entry **alone** fails nothing. That is correct — `EntityRoot` draws the
      overlay straight from `meta.ports`, so a drawing cannot under-claim its entry by construction;
      teeth (4) covers the direction that *can* break, which is a drawing that stops routing through
      `EntityRoot`.
      **Both themes verified by the orchestrator BY LOOKING**, not accepted from the report, at
      `gallery-{light,dark}.png`, `detail-light.png`, `detail-ports-{light,dark}.png` and
      `keyboard-card-focus.png`: three distinguishable faces, one accent moment per entity, the five
      states legible (`dimmed` genuinely recedes, `error` reads as a red dashed ground ring + red
      LED, `highlight` as an accent pool), the three footprints framed against one box so the scale
      difference is real, and — with the port overlay **off** — the two `mcp-server` variants plainly
      distinct: the antenna on `streamable-http`, the local-process block on `stdio`. With the
      overlay **on**, the port dots and labels sit on top of exactly those two marks and hide them;
      that is a legibility observation for the owner walk, not a defect.
      **Accepted deviations (the agent's, each justified):** variant id is `streamable-http`, not the
      spec prose's `streamable_http`, because WP 0.1's schema types `variants` as kebab-case
      `illustrationIdSchema` — the contract wins, and the snake_case domain name survives in
      `entity: "mcp_servers"`; `agent` declares `variants: []` because `upstream`/`downstream` are the
      two values of the first-class `facing` prop (D-IL17) and listing them twice would give the
      catalog two ways to say one thing — the detail renders both facings for *every* entity instead;
      the entity `variant` prop is `string`, not a per-entity union, so all entities share the one
      `EntityComponentProps` the gallery and the future scene renderer need, with an unknown variant
      falling back to the default (D-IL16's "ignore what you cannot do"); **the detail is a dialog,
      not a route**, because the spec sanctions exactly one manifest entry and nothing links to a
      single illustration today — WP 4.1 owns the `illustration` addressable view; `PageShell` +
      `ViewToolbar` rather than the spec's `PageHeader`, which D-TB1 retired; two tabs, absorbing WP
      0.2's unrouted preview page (its three assertions carried over, not dropped); **no nav item**,
      since D-TB10 decouples route from nav and where an asset repository belongs in the IA is an
      owner decision; `contract-support.tsx` is a shared harness *called by* each co-located test, so
      the file that goes red is still the entity's own; `IllustrationCanvas` takes a **required**
      `alt` because Biome's `noSvgWithoutTitle` rejects an unnamed `<svg>`, mirroring `IconButton`'s
      `label`.
      **A real bug the agent found by looking, which the green gate had not:** wrapping a card in
      `@elabs-ai/components-ui`'s `Button` clamped every 232 px illustration to **16 px**, because
      `Button` carries `[&_svg]:size-4` and assumes any nested SVG is an icon glyph. The page rendered
      three specks with every test passing. Fixed by moving the drawing outside the button per
      `EntityCard`'s activation contract, and pinned by a test forbidding `svg[role="img"]` inside any
      button on the page.
      **Orchestrator-added / orchestrator-caused deviations:** the agent ran `pnpm format`, which
      reformatted a handful of lines in `App.tsx` and `assistant-route-manifest.ts` that this WP does
      not otherwise touch — harmless, but note `pnpm lint` is `biome check --formatter-enabled=false`,
      so formatting is **not** gated and that churn was not required; and the orchestrator committed
      one wording fix (`c43520b`) because README §12 said the page could be reached "from the
      breadcrumb's Home", which is the way back **out**, not in.
      **Merged over another session's uncommitted work — owner-directed, and the second time this has
      happened in this plan.** ~400 lines splitting the Assistant feature flag into
      `assistant_workspace` + `app_assistant` sat unstaged in `main`, touching `README.md` and
      `CHANGELOG.md` — the same two files this WP edits — so git refused the merge. On the owner's
      instruction it was committed as-is as `4c50e23`, under a message stating plainly that the
      committing session neither authored nor verified it. The `CHANGELOG.md` conflict was resolved
      by **keeping both** entries.
      **Front page updated in this WP, as its spec requires (the first owner-visible delivery):** the
      capability table row moved **🔜 Planned → 🚧 Partially built** with what shipped and what did
      not, a README §12 tour was added, and a `CHANGELOG.md` entry written. Note for future WPs: the
      capability table lives in **`CLAUDE.md` §1**, not `README.md` — README has no such table, so the
      rule's "capability table" is CLAUDE.md's.
      **Not verified:** the live walk was performed by the implementing agent on **port 5174, not
      5173** (5173 was held by a different checkout), and the app shell around the gallery in every
      screenshot was served by that **neighbouring instance's API on :8080** — the gallery itself
      reads no API data, so nothing on the page depends on it, but the surrounding chrome is not this
      branch's. The page has **never been walked at `localhost:8080`**, the built/Docker instance —
      that is precisely the owner-acceptance item below. The orchestrator verified the **light**
      focus ring by looking; the **dark** focus ring was not, and the tab order is taken from the
      agent's report rather than re-driven. Commit `4c50e23` was **not authored or verified by this
      session** — the merged gate covers the combination, not that commit in isolation, and its own
      owner-acceptance is unrecorded and belongs to whichever session wrote it. The **dark-stage
      lighting flip** persists and remains an owner judgement (accepted at WP 0.1). The merged-gate
      lint file count (3341) was inflated by the then-still-present worktree, since removed.
      `packages/illustrations/scripts/` is still outside the package tsconfig and therefore still not
      typechecked.

## Phase 1 — Entity library v1 + contribution kit

> **BLOCKED on the Phase 0 owner-acceptance box below** (2026-08-21). The ledger's own rule — *"A
> new phase must not open while a prior phase's owner-acceptance items are unresolved"* — holds this
> whole phase shut until the gallery walk is ticked. Nothing here is dispatchable before then.
>
> **Specs written 2026-08-21** for 1.1–1.3, so dispatch is immediate once the box ticks. WP 1.4 is
> still one paragraph in [`02-plan.md`](./02-plan.md) and needs a spec before it can run.
>
> **Wave order corrected (a `/next-wp` file-overlap finding, not an owner change).**
> `02-plan.md` says "1.x in parallel worktrees (entities are independent files)". The entity files
> are independent; **`src/registry.ts` and `src/entities/index.ts` are not**, and three branches
> appending to the same two files is the collision the runner forbids. WP 1.1 therefore lands a
> **cast-module seam** first (per-WP `cast-*.ts` modules that `registry.ts` concatenates), after
> which 1.2 ∥ 1.3 share no file at all. Waves: **1.1 → {1.2 ∥ 1.3} → 1.4**.
>
> **Arithmetic discrepancy for the owner, flagged not silently fixed:** `02-plan.md` lists
> 5 + 7 + 8 = **20** new entities, which with the three pilots is a **23**-component catalog — so WP
> 1.4's "21st component proof" and `CLAUDE.md` §1's "remaining ~17 entities" are both off. Wants
> correcting before WP 1.4 is written.

- [x] WP 1.1 — Runtime cast (`model`, `provider`, `validator`, `run`, `prompt`) + the cast-module
      seam — done 2026-08-21 · `wp/illustrations/1.1` (2 commits `78da767`, `247edc6`), merged
      **--no-ff** as `8a7580e` · spec: [`wp-1.1-runtime-cast.md`](./wp-1.1-runtime-cast.md).
      **Shipped:** the **cast-module seam** — `cast-member.ts` (the `IllustrationCastMember` type),
      `cast-pilot.ts` (the three pilots moved out of `registry.ts`), `cast-runtime.ts` (this WP's
      five), and `cast-assets.ts` + `cast-orchestration.ts` **committed, exported and empty** so WPs
      1.2 and 1.3 create no file in common; `registry.ts` now names **no entity at all**, deriving
      both `ILLUSTRATION_REGISTRY` and `ILLUSTRATION_COMPONENTS` from the concatenation, with a test
      that reads `registry.ts`'s own source and fails if it ever imports an entity module — the
      seam's headline sentence made mechanical rather than promised. Plus **five entities**:
      `model` (processor package, lit die), `provider` (standing board with a deliberately blank
      cartouche — no vendor mark), `validator` (standing figure carrying a shield on its gaze side),
      `run` (track on a ground pad, direction chevrons, one lit) and `prompt` (message board on a
      display post), each at S/M/L × five states × its variants with a co-located `*.test.tsx`
      calling `contract-support.tsx`. 22 files, **+2054 / −117**, every one inside
      `packages/illustrations` — `git diff cb93a6f --stat -- packages/shared apps/` is **empty**,
      confirmed by the orchestrator, so the gallery picked the five up with no web change.
      **Gate — re-run by the orchestrator in the worktree with `pnpm --dir <worktree>` on every
      command, not taken on the agent's report:** typecheck all Done · shared **250** ·
      illustrations **390** (252 before) · cli **87** · api **3589** · web **347 files / 3719 passed
      / 5 skipped** · build Done · lint clean (**1689** files).
      **Teeth verified by the orchestrator — each broken, watched go red, and restored:**
      (a) a duplicate `model` cast member added to `cast-assets.ts` → module-load throw across nine
      test files, `two illustration cast members share an id: "model" is claimed by runtime and
      assets`; (b) `fill: accent` → `fill: "#c8ff00"` in `Validator.tsx` → **two independent**
      guards, `validator (idle/grader) painted #c8ff00, which is not an --illus-* token` **and**
      WP 0.1's recursive scan `entities/Validator.tsx carries a hex color` (390 → 387 pass / 3 fail);
      (c) `run` handed `EntityRoot` a meta whose `ports` drop `exit` while its entry still declares
      it → `not ok - exposes exactly the ports the entry declares … + 'exit'` (389 pass / 1 fail).
      All three restored, 390/390.
      **Both themes verified by the orchestrator BY LOOKING** at `gallery-light.png` and
      `gallery-dark-via-app.png` — the dark shot taken after flipping the theme through the app's
      **own** top-bar control (the `Theme: Dark` tooltip is in frame), not by setting `data-theme` by
      hand. Eight entities, every silhouette distinguishable at `m`, one accent moment each, the
      blank provider cartouche holding (no wordmark), and the port overlay drawing 42 markers —
      exactly the sum the eight entries declare.
      **The §3 `validator` decision, as the spec required:** built **option 1** — a new shared
      `primitives/IsoFigure.tsx` with `Agent` refactored onto it. It does not abstract nothing: the
      three stacked solids, the *sequential* stacking arithmetic (re-associating it would move the
      exemplar's numbers, since float addition is not associative) and the visor moved, ~60 lines;
      the antenna, chest plates and shield stayed behind. `agentHeightUnits("m") === 5.35` still
      holds exactly, so the WP 0.2 exemplar is intact. It pays forward to WP 1.3's `assistant` and
      research §5's `owner/user`.
      **Accepted deviations:** one file beyond the spec's four cast modules —
      `entities/cast-member.ts`, because the spec declares the `IllustrationCastMember` type without
      saying where it lives; and `entities/index.ts` changed shape (cast modules now `export *` their
      own entities, so the index names no component), without which adding an entity would still
      have touched two shared files and the seam's claim would have been false. Every previously
      public name still reaches the package surface.
      **A build-order finding worth keeping:** in a **fresh** worktree `pnpm test` fails before it
      starts — illustrations dies with `ERR_MODULE_NOT_FOUND … @mcp-token-footprint/shared/dist/index.js`,
      because `pnpm -r --if-present test` does not build `shared` first. It only passes in the main
      checkout because a `dist/` is already lying there. `pnpm --filter @mcp-token-footprint/shared
      build` first is required, and every WP 1.2/1.3 agent must be told so.
      **`REGISTRY_VERSION` deliberately left at `0.1.0`, and two documents disagree about that.**
      D-IL12 says a new component bumps it; the shared constant's own doc comment says adding a
      component is additive and leaves it alone. The agent followed the constant, because bumping
      would mean editing `packages/shared`, which the spec forbids. **Owner decision, flagged not
      taken** — it wants settling before WP 1.4 writes the registry-changelog discipline.
      **An orchestrator error, recorded because it repeats a documented failure of this plan.** The
      base commit `cb93a6f` — written by the orchestrator to fix the Dockerfile and the lint gate —
      was staged with `git add -A` while **another session (RM-33, cache-aware token accounting) held
      ~53 files of uncommitted work in the tree**, so that work was swept into the commit under a
      message that neither mentions nor verifies it, and whose quoted gate numbers (shared 238 · api
      3567 · web 346/3702) were measured **before** the sweep. The true post-sweep baseline is shared
      **250** · api **3589** · web **347 / 3719**. The implementing agent caught this and corrected
      the orchestrator, which is the only reason it is on the record. **The combination is green** —
      the gate above covers it — but `cb93a6f` was not authored or verified by this session as far as
      RM-33's files go, and its owner-acceptance belongs to whichever session wrote them. This is the
      **third** time in RM-14 that another session's uncommitted work has been swept up by a merge or
      a commit; the fix is to stage explicit paths, never `-A`, which this WP's own tick does.
      **Front page not updated:** the **`CLAUDE.md` §1** capability table row already reads
      🚧 Partially built and says Phase 0 is complete with the remaining entities not built; five of
      those entities now exist, which makes the row's *count* stale but no sentence in it false. It is
      updated when Phase 1 closes, so the front page moves once per phase rather than per WP.
      **Not verified:** the **System** theme option (only Light and Dark were walked); any viewport
      other than 1440×1000; the keyboard walk was not re-driven by the orchestrator, only the focus
      screenshot looked at. **Port-label crowding on the flat entities** is real and visible in
      `gallery-light-ports.png` — on `model` and `run` the `left`/`bottom`/`right` labels sit close
      to the named ports because `EntityRoot` anchors side ports at `heightUnits / 2` and those two
      are the flattest things in the catalog. It is inherited overlay behaviour, most visible on the
      new entities; nobody measured an actual overlap. The **dark-stage lighting flip** (side faces
      lighter than the top) persists unchanged — it lives in the token layer, so the five inherit it
      identically; still an owner judgement, accepted at WP 0.1.
- [ ] WP 1.2 — Assets & knowledge cast (`tool`, `resource`, `prompt-template`, `file`,
      `feedback-report`, `scan`, `token-meter`) — spec:
      [`wp-1.2-assets-cast.md`](./wp-1.2-assets-cast.md) · depends on 1.1 · parallel with 1.3
- [ ] WP 1.3 — Orchestration cast (`suite`, `collection`, `orchestrator`, `diff-compare`,
      `environment`, `database`, `credentials-vault`, `assistant`) — spec:
      [`wp-1.3-orchestration-cast.md`](./wp-1.3-orchestration-cast.md) · depends on 1.1 · parallel
      with 1.2
- [ ] WP 1.4 — Contribution kit (scaffold script, checklist, registry changelog +
      `REGISTRY_VERSION`, scaffold-only Nth-component proof) — **no spec yet**

## Phase 2 — Scene engine

- [ ] WP 2.1 — SceneSpec zod (shared) + band/lane/hub layout engine + validator + golden tests
- [ ] WP 2.2 — Connector router (orthogonal, port-to-port, label collision avoidance)
- [ ] WP 2.3 — `<IllustrationScene>` deterministic renderer + annotations + accent-ratio dev warning
- [ ] WP 2.4 — Acceptance scene (Self-Learning Agentic Loop as spec fixture, one shared hub) +
      standalone-SVG export — **owner-visible milestone**

## Phase 3 — Explain mode

- [ ] WP 3.1 — Step player (focus/dim, aria-live captions, keyboard, reduced-motion)
- [ ] WP 3.2 — Embedded explainers ×3 (scan pipeline · run execution · skill feedback loop)
- [ ] WP 3.3 — Scene library persistence (migration `illustration_scenes` + CRUD + gallery tab)

## Phase 4 — Assistant composition + hardening

- [ ] WP 4.1 — Assistant tools (`illustrations_registry`, `illustrations_compose_scene`,
      `illustrations_save_scene` write-gated) + `illustration` addressable view
- [ ] WP 4.2 — Compose flow in the dock (describe → preview → approve → save)
- [ ] WP 4.3 — Hardening (a11y pass, both-theme golden screenshots, bundle budget, docs +
      rules pointer)

## Owner acceptance (deferred visual / a11y — owner-only, not subagent-doable)

> A new phase must not open while a prior phase's owner-acceptance items are unresolved.

- [x] Phase 0 (WP 0.3) — gallery walk: all pilot entities read correctly in **both** themes
      (switch in Settings), ports overlay sane, keyboard focus visible —
      **accepted by the owner 2026-08-21.** Walked at **`http://localhost:8081/illustrations`**, the
      `docker compose` container, **not** the `localhost:8080` this line originally named — 8080 was
      held by a dev server running since Aug 19 15:34 (stale, pre-dating every illustrations WP), and
      8081 is the port `docker-compose.yml` publishes. The orchestrator verified mechanically before
      the walk that the container serves the gallery (`GET /illustrations` → 200) and that all **18**
      `--illus-*` custom properties reach the served stylesheet — closing the exact
      black-rectangle trap WP 0.3's done-line documents. The visual judgement is the owner's and was
      given; the orchestrator did not re-look.
      **Two defects on `main` were found and fixed while standing this instance up, neither caused by
      RM-14:** (1) `docker compose up --build` **failed outright** — the Dockerfile's `deps` and
      `prod-deps` stages copy workspace manifests by hand and had never learned about `apps/cli`
      (RM-08 Phase 1) or `packages/illustrations` (RM-14 WP 0.1), so the in-container `pnpm build`
      died with `Cannot find module '@mcp-token-footprint/shared'` in `apps/cli`. Four `COPY` lines.
      The image had been unbuildable since `apps/cli` landed and nothing caught it, because **no gate
      builds the image** — worth its own roadmap item. (2) `pnpm lint` was **red on `main` with 507
      errors**, all parse noise from `.vscode/free-web-port.sh` (added by HEAD commit `bb0767e`),
      which Biome was reading as JSON; `"**/*.sh"` added to `files.ignore`.
- [ ] Phase 2 (WP 2.4) — the rebuilt Agentic Loop scene: one shared MCP+Skill hub clearly
      read/write/publish-connected to steps 1/4/5; both themes; exported SVG opens standalone —
      accepted: ____
- [ ] Phase 3 (WP 3.2) — one full explainer walkthrough keyboard-only, both themes,
      reduced-motion honored — accepted: ____
- [ ] Phase 4 (WP 4.2) — live compose-from-chat walk (needs assistant sign-in): describe the
      suite-run flow, preview, approve, find it in the gallery — accepted: ____
