---
type: "Status Ledger"
title: "Illustrations \u2014 work-package status ledger \u00b7 PRIORITY: HIGH"
description: "Driven by /next-wp illustrations. This ledger is the single source of truth for"
tags: ["roadmap", "RM-14"]
timestamp: "2026-08-20T13:47:37Z"
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

- [ ] WP 0.1 — Package scaffold + `--illus-*` token layer + shared spec/registry schema stubs
- [ ] WP 0.2 — Iso primitives (PaperStage, IsoPlatform, IsoHousing, GlyphFrame,
      ConstructionGhost, StationHeader, Connector ×6 kinds, cards, EntityRoot)
- [ ] WP 0.3 — Pilot entities (`mcp-server`, `skill`, `agent`) + registry v0.1 + `/illustrations`
      gallery route v0

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
