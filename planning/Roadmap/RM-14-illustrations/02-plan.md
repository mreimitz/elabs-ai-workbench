---
type: "Work Package Spec"
title: "Illustrations \u2014 phased plan (work packages)"
description: "Locked decisions: decisions.md (D-IL1\u2013D-IL17). Live state"
tags: ["roadmap", "RM-14"]
timestamp: "2026-08-21T13:10:00Z"
status: "final"
---
# Illustrations — phased plan (work packages)

> Locked decisions: [`decisions.md`](./decisions.md) (D-IL1–D-IL17). Live state:
> [`STATUS.md`](./STATUS.md) — the ledger is authoritative; this file describes scope.
> Shared rules: the repo-wide gate (`pnpm typecheck && pnpm test && pnpm build && pnpm lint`),
> contract-first (`packages/shared` first), both themes verified by looking.

Recommended waves: 0.1 → 0.2 → 0.3 (prove the language end-to-end early) · then 1.x in
parallel worktrees (entities are independent files) · 2.x sequential · 3.x/4.x after 2.4.

## Phase 0 — Foundations (prove the language)

- **WP 0.1 — Package scaffold + token layer.** Create `packages/illustrations` wired like
  `shared` (exports, build/typecheck/test); `src/tokens.css` with the full `--illus-*`
  mapping (research §3.4) incl. `color-mix` face derivation + fallbacks; `SceneSpec` +
  `RegistryEntry` zod/types stubs in `packages/shared` (new `illustration-*.ts`, exported);
  `apps/web` dep + `@source` not needed (package CSS imported via app.css `@import`).
  Contract tests for schemas. *Gate.*
- **WP 0.2 — Iso primitives.** `iso-math.ts` (unit grid, true-iso projection, the three
  face-map transforms [top/left/right, 86.6% + ±30°], iso-ellipse rule, calibration cube),
  `PaperStage`, `IsoPlatform` (1–3 tiers, S/M/L), `IsoHousing` (+`isoExtrude`),
  `GlyphFrame`, `ConstructionGhost`, `StationHeader`, `Connector` (all 6 kinds + markers),
  `CalloutCard`/`PrincipleCard`, `EntityRoot` (states, a11y, ports plumbing). Storybook-less:
  a dev-only preview page in `apps/web` behind the gallery route stub. *Gate.*
- **WP 0.3 — Pilot entities + gallery v0.** Three tier-1 entities end-to-end:
  `mcp-server` (stdio/http variants), `skill` (plain/versioned), `agent` (LLM robot).
  `registry.ts` v0.1 with real entries; `/illustrations` route (PageShell, DataTable-free
  grid, live rendering, theme flips via Settings re-skin it); component detail view (states ×
  sizes matrix, port overlay, registry entry). **Acceptance:** all three read correctly in
  both themes, verified by looking. *Gate.*

## Phase 1 — Entity library v1 + contribution kit

- **WP 1.1 — Runtime cast.** `model`, `provider` (incl. `vendor_assistant` variant), `validator`
  (shield agent), `run` (track segment), `prompt` (display + bubble). Registry entries + tests.
- **WP 1.2 — Assets & knowledge cast.** `tool`, `resource`, `prompt-template`, `file`
  (sheet stack), `feedback-report` (doc tray), `scan` (scanner arch), `token-meter`.
- **WP 1.3 — Orchestration cast.** `suite`, `collection`, `orchestrator` (automation hub —
  the honest "automatic execution" entity per research §5), `diff-compare`, `environment`,
  `database`, `credentials-vault`, `assistant`.
- **WP 1.4 — Contribution kit.** `scripts/new-component.mjs` scaffold (component + registry
  entry + contract test), the illustration checklist in `packages/illustrations/README.md`,
  registry changelog + `REGISTRY_VERSION` discipline, gallery auto-pickup proven by adding a
  **24th** component via the scaffold alone. (Corrected 2026-08-21: 3 pilots + 5 + 7 + 8 = **23**
  after Phase 1, so the proof is the 24th, not the 21st. And per the dated amendment in
  [`decisions.md`](./decisions.md), the "`REGISTRY_VERSION` discipline" is a **changelog** plus a
  test that catches a BREAKING entry change shipped without a bump — adding a component does not
  bump the number.)

## Phase 2 — Scene engine (declarative composition)

- **WP 2.1 — Scene spec + layout.** Full `SceneSpec` zod in `shared` (bands, nodes,
  connectors, annotations, steps; required title/summary); band/lane/hub layout engine with
  quantized distribution + explicit override; spec→errors validator (registry ids, ports,
  kinds). Golden tests: spec fixtures → stable layout snapshots. **Must include the `cycle`
  band kind** (ring of stations, travel direction, entry/exit gaps, lap counter) discovered
  by the run-flow exemplar ([`examples/run-flow.scene.json`](./examples/run-flow.scene.json))
  — lane/hub alone cannot express an execution loop.
- **WP 2.2 — Connector router + labels.** Orthogonal port-to-port routing, parallel-run
  nudging, corner radii, label placement with node-box collision avoidance; all 6 kinds
  rendered from tokens; deterministic (no DOM measurement).
- **WP 2.3 — `<IllustrationScene>` renderer + annotations.** Deterministic scene render
  (same spec+theme+registry ⇒ same SVG), `role="img"`+title/desc from spec, dev-mode accent
  ratio warning (D-IL6), annotation cards, canvas formats.
- **WP 2.4 — Acceptance scene + export.** The **Self-Learning Agentic Loop** authored as a
  spec fixture — six stations, ONE shared `mcp-server`+`skill` hub node, `read` from step 1,
  `write` from step 4, `publish` from step 5, `loop` 6→1 — rendered in the gallery's Scenes
  tab; `export.ts` standalone-SVG export with resolved theme values (both themes). This spec
  replaces the hand-drawn `illustrations/self-learning-agentic-loop.svg` as source of truth
  (folder stays as export output, D-IL14). *Owner-visible milestone.*

## Phase 3 — Explain mode (app-internal process documentation)

- **WP 3.1 — Step player.** `steps[]` semantics (focus sets → highlight/dim), caption
  `aria-live` region, keyboard `←/→`/`Esc`, `prefers-reduced-motion`, step progress dots
  (`@elabs-ai/components-ui` chrome).
- **WP 3.2 — Embedded explainers.** `ProcessExplainer` entry point (Dialog/Sheet); three
  authored in-repo specs: *how a scan works* (Servers view), *how a run executes* (run
  console), *the skill feedback loop* (Skills view). Both-theme + keyboard walk noted for
  owner acceptance.
- **WP 3.3 — Scene library persistence.** Versioned migration `illustration_scenes`;
  `/api/illustrations/scenes*` CRUD (zod from shared; additive); gallery Scenes tab lists
  saved + in-repo scenes.

## Phase 4 — Assistant composition + hardening

- **WP 4.1 — Assistant tools.** `illustrations_registry` + `illustrations_compose_scene`
  (read; validate + normalized spec + preview deep link via a new `illustration` view in
  `assistant-ui-registry.ts`) and `illustrations_save_scene` (write; approval-gated, D-AS4/
  D-IL13). Stub-tested like all assistant tools (no live key needed).
- **WP 4.2 — Compose flow in the dock.** Describe → preview (dock/page) → approve → saved;
  starter prompt ("Visualize this workflow…"); scene deep links from chat chips.
- **WP 4.3 — Hardening.** A11y pass (gallery + player), golden screenshots of registry ×
  both themes (visual-regression baseline), bundle budget assertion, package README +
  `.claude/rules` pointer so future agents use the system instead of hand-drawing SVGs.

## Out of scope (explicit)

Canvas/drag-drop authoring (future, would emit the same spec), PNG server rasterization,
upstreaming to `@elabs-ai/components-*`, any third theme, animation beyond the step player + dash motion.
