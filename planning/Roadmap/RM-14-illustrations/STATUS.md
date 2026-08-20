---
type: "Status Ledger"
title: "Illustrations \u2014 work-package status ledger \u00b7 PRIORITY: HIGH"
description: "Driven by /next-wp illustrations. This ledger is the single source of truth for"
tags: ["roadmap", "RM-14"]
timestamp: "2026-08-21T03:10:00Z"
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
- [ ] WP 0.3 — Pilot entities (`mcp-server`, `skill`, `agent`) + registry v0.1 + `/illustrations`
      gallery route v0 — spec: [`wp-0.3-pilot-entities.md`](./wp-0.3-pilot-entities.md)

## Phase 1 — Entity library v1 + contribution kit

- [ ] WP 1.1 — Runtime cast (`model`, `provider`, `validator`, `run`, `prompt`)
- [ ] WP 1.2 — Assets & knowledge cast (`tool`, `resource`, `prompt-template`, `file`,
      `feedback-report`, `scan`, `token-meter`)
- [ ] WP 1.3 — Orchestration cast (`suite`, `collection`, `orchestrator`, `diff-compare`,
      `environment`, `database`, `credentials-vault`, `assistant`)
- [ ] WP 1.4 — Contribution kit (scaffold script, checklist, registry changelog +
      `REGISTRY_VERSION`, scaffold-only 21st component proof)

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

- [ ] Phase 0 (WP 0.3) — gallery walk @ localhost:8080: all pilot entities read correctly in
      **both** themes (switch in Settings), ports overlay sane, keyboard focus visible —
      accepted: ____
- [ ] Phase 2 (WP 2.4) — the rebuilt Agentic Loop scene: one shared MCP+Skill hub clearly
      read/write/publish-connected to steps 1/4/5; both themes; exported SVG opens standalone —
      accepted: ____
- [ ] Phase 3 (WP 3.2) — one full explainer walkthrough keyboard-only, both themes,
      reduced-motion honored — accepted: ____
- [ ] Phase 4 (WP 4.2) — live compose-from-chat walk (needs assistant sign-in): describe the
      suite-run flow, preview, approve, find it in the gallery — accepted: ____
