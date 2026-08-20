---
type: "Status Ledger"
title: "Illustrations \u2014 work-package status ledger \u00b7 PRIORITY: HIGH"
description: "Driven by /next-wp illustrations. This ledger is the single source of truth for"
tags: ["roadmap", "RM-14"]
timestamp: "2026-08-21T00:05:00Z"
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
- [ ] WP 0.2 — Iso primitives (PaperStage, IsoPlatform, IsoHousing, GlyphFrame,
      ConstructionGhost, StationHeader, Connector ×6 kinds, cards, EntityRoot)
      — spec: [`wp-0.2-primitives.md`](./wp-0.2-primitives.md)
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
