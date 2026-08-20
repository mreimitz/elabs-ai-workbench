---
type: "Work Package Spec"
title: "WP 0.3 - pilot entities (mcp-server, skill, agent), registry v0.1 and the /illustrations gallery"
description: "Phase 0 of 02-plan.md. Ledger: STATUS.md. Proves the visual language end-to-end: three real entities composed only from WP 0.2 primitives, catalogued in the registry, browsable at /illustrations in both themes."
tags: ["roadmap", "RM-14"]
timestamp: "2026-08-21T02:25:00Z"
status: "final"
---
# WP 0.3 — pilot entities + registry v0.1 + `/illustrations` gallery v0

Phase 0 of [`02-plan.md`](./02-plan.md). Ledger: [`STATUS.md`](./STATUS.md). Locked decisions:
[`decisions.md`](./decisions.md). Registry + gallery detail:
[`01-system-design.md`](./01-system-design.md) §3 and §5.1.

**Depends on:** WP 0.1 (contract + tokens), WP 0.2 (every primitive).
**Consumed by:** Phase 1 (the remaining ~17 entities follow these three as the pattern), Phase 2
(the scene renderer resolves `node.component` against this registry).

This is the WP that **proves the language end-to-end** and the first one the owner can look at. It
is also the Phase 0 exit: the ledger forbids opening Phase 1 until the owner has walked the gallery.

---

## Locked decisions this WP implements

- **D-IL9** — no component ships without a registry entry; `REGISTRY_VERSION` is stamped.
- **D-IL12** — every component carries the illustration checklist: footprint · ports · five states ·
  both themes · accent budget · screen-aligned label · `<title>`/`<desc>` · a co-located contract
  test.
- **D-IL14** — illustrations are **content graphics**, so their inline SVG does not violate
  `brand-ui-only.md`; every piece of surrounding chrome (PageShell, cards, tabs, toolbar, dialogs)
  **is** `@elabs-ai/components-*`.
- **D-IL17** — `agent` declares `facing`, default `upstream`.
- **`.claude/rules/routes-vs-dialogs.md`** — the gallery is a *place*, so it is a route, and it must
  render something useful with **zero query params**.

## Scope

### 1. Three entities (`src/entities/`)

Composed **only** from WP 0.2 primitives — a new `<path>` in this WP is a finding:

- `mcp-server` — variants `stdio` / `streamable_http`; rack housing, LED detail, antenna glyph on
  the HTTP variant; port `bus` plus the four cardinals.
- `skill` — variants `plain` / `versioned`; port `version-out`.
- `agent` — the LLM robot from [`examples/Agent.example.tsx`](./examples/Agent.example.tsx); ports
  `context-in`, `result-out`; `facing` honored (the exemplar's "facing: downstream" tile is the
  proof case).

Each: all three sizes (S/M/L), all five states, a co-located contract test asserting its ports,
states and a11y text match its registry entry.

### 2. `src/registry.ts` — v0.1

Real `RegistryEntry` values for the three, validated at module load against the WP 0.1 zod schema,
plus `REGISTRY_VERSION = "0.1.0"`. A component whose ports or states disagree with its entry must
fail a test, not render wrong.

### 3. `/illustrations` gallery v0 (`apps/web/src/features/illustrations/`)

- Route in `apps/web/src/App.tsx`; `PageShell` + `PageHeader`, breadcrumb per the S16 shell
  contract; a grid of registry entries rendered **live** (real components, current theme).
- Detail view per entry: the **states × sizes matrix**, a **port overlay** toggle, and the registry
  entry itself.
- Filter/search chrome from `@elabs-ai/components-*` — not hand-rolled.
- Useful with zero query params (a cold load shows the full catalog).

### 4. The gate gotcha — build it in, do not discover it

Adding `<Route path="/illustrations">` **fails the `assistant-route-operability` test** unless the
same change adds one entry to
`packages/shared/src/assistant-route-manifest.ts`
(43 entries today, none for illustrations). The Phase 0 entry is:

```ts
{
  pattern: "/illustrations",
  surface: "global",
  exempt: "Asset-repository catalog; the operable illustration surface arrives with the `illustration` addressable view and the illustrations_* tools in RM-14 WP 4.1.",
}
```

`pattern` must be **byte-identical** to the `path="…"` literal in `App.tsx` — the coverage check is
string-set equality. **Do not touch** `ASSISTANT_ENTITY_KINDS`, `SCOPE_WRITE_TOOLS` or
`deriveAssistantScope` (D-AO3 — frozen security boundary); the exemption is the sanctioned route,
and it names WP 4.1 so it reads as visibly provisional.

### 4b. The SECOND route registry — `PAGESHELL_EXACT_ROUTES` (added 2026-08-21 by the orchestrator)

> Reported by the session that built **RM-32** (overview→detail restructure) and **verified against
> the tree before being written here**. It is a separate registry from the assistant manifest above,
> and it is the one that is easy to miss because **nothing fails when you forget it.**

`apps/web/src/App.tsx` exports `PAGESHELL_EXACT_ROUTES` (a `Set<string>`, at `apps/web/src/App.tsx:217`
as of 2026-08-21), consumed by `isPageShellRoute`. A route that is
**absent** from that set mounts **padded and scrolling** instead of edge-to-edge. So the gallery
needs `"/illustrations"` added there too — again **byte-identical** to the `path="…"` literal.

The asymmetry is the trap. `apps/web/src/App.test.ts` carries a grep-proof test that every
`PAGESHELL_EXACT_ROUTES` entry corresponds to a declared `<Route path>` — so a **dead entry** is
caught. The **opposite** direction is not gated: a route with no entry is not a test failure, it is
a silently wrong-looking page. Verify the gallery renders full-bleed **by looking**, not by
assuming the gate would have told you.

Three further details, all **verified against the source on 2026-08-21**, which decide how this WP
must register the route:

1. **`isPageShellRoute` matches exact OR prefix**, and a trailing-slash prefix does **not** cover
   its own bare path — `"/illustrations".startsWith("/illustrations/")` is `false`. So even if this
   WP (or a later one) adds `"/illustrations/"` to `PAGESHELL_ROUTE_PREFIXES` for a future detail
   route, **`/illustrations` still needs its own entry in `PAGESHELL_EXACT_ROUTES`.** Registering
   only the prefix is precisely the mount-looks-slightly-wrong failure with nothing red.
2. **`PAGESHELL_ROUTE_PREFIXES` is ungated in BOTH directions.** The grep-proof loop iterates only
   the exact `Set`; the prefix array is never reconciled against `App.tsx` at all. The "a dead entry
   is caught" guarantee therefore holds for **exact routes only**. Anything this WP or a successor
   puts in the prefix array has no coverage in either direction.
3. The one partial reverse-direction check that exists — "registers exactly the current
   `/assistant/*` routes" — asserts
   `PAGESHELL_EXACT_ROUTES` filtered to `/assistant` **equals** `ASSISTANT_HUB_ROUTES`. **Both
   operands are hand-maintained and neither is derived from `App.tsx`**, which decides exactly which
   mistakes it catches:
   - registry updated, literal forgotten → **fails** (registry superset);
   - literal updated, registry forgotten → **fails** (literal superset);
   - a new `/assistant/*` `<Route>` declared and **neither** touched → **passes silently.** Both
     sides are still equal to each other; they are simply both wrong.

   That last case is the failure mode this WP must not repeat, and it is why the check covers the
   Hub *slice* rather than providing general coverage. Do not read it as a safety net.

> **Open follow-up, deliberately NOT claimed by RM-14 (orchestrator note, 2026-08-21):** the reverse
> assertion is small — the grep-proof test already holds a parsed `declaredRoutePaths` set, so
> iterating it and requiring each declared path be covered by an exact entry or a prefix is a few
> lines in the same test. It is not a one-liner: it needs an explicit carve-out for the `<Navigate>`
> redirect routes, which legitimately never mount (the same exemption the assistant manifest makes
> with `surface: "redirect"`), plus the `*` catch-all and `/`. That converts a whole class of silent
> layout bugs into a red test, but it is **shell-gate hardening, not illustration work**, and it
> touches a file no RM-14 WP otherwise owns. It needs its own roadmap item and an owner decision —
> an implementing agent must **not** fold it into this WP unopposed.

**Also from RM-32, if it has landed by the time you build this:** `AppShell`'s `secondaryContent` /
`secondaryTitle` props and the mobile rail `Sheet` are **removed** (both list rails were deleted, so
nothing passed them). Mount the gallery with `fullBleed` + `breadcrumbs`; there is no rail prop any
more. If RM-32 is still uncommitted when this WP is dispatched, the orchestrator resolves that
first — two sessions must not edit `App.tsx` in the same tree.

## Out of scope (explicitly)

Any fourth entity, the scene spec's layout engine or renderer, explain mode, persistence, assistant
tools, the scaffold script (WP 1.4).

## Acceptance

1. `pnpm typecheck && pnpm test && pnpm build && pnpm lint` green from the repo root.
2. All three entities render at S/M/L × five states without a color literal in the package.
3. Each entity's contract test ties it to its registry entry (ports, states, a11y text).
4. `assistant-route-operability` passes **with** the manifest entry — and, as a **teeth check
   performed and reported**, fails when the entry is temporarily removed. Restore it.
5. `enforce-brand-ui` and `check-tokens` clean across `apps/web/src/features/illustrations`.
5b. `"/illustrations"` is present in **both** route registries — `ASSISTANT_ROUTE_MANIFEST` and
   `PAGESHELL_EXACT_ROUTES` — and the gallery is confirmed **full-bleed by looking** (§4b: the
   missing-entry direction is not test-gated).
6. Keyboard: the grid is reachable, focus is visible, the port-overlay toggle is operable.
7. Live walk by the implementing agent at `http://127.0.0.1:5173/illustrations`, **both themes**,
   with a screenshot of each in the done-line. This does **not** replace the owner walk below.

## Phase 0 exit — owner-only, and a hard stop

[`STATUS.md`](./STATUS.md) states: *"A new phase must not open while a prior phase's
owner-acceptance items are unresolved."* Phase 1 does not start until the owner ticks:

> Phase 0 (WP 0.3) — gallery walk @ localhost:8080: all pilot entities read correctly in **both**
> themes (switch in Settings), ports overlay sane, keyboard focus visible.

## Ledger + front page

Tick WP 0.3 in [`STATUS.md`](./STATUS.md) with the gate result, deviations and an explicit
**"Not verified:"** tail. Because WP 0.3 is the first user-visible delivery, the **same commit**
updates the capability table in `README.md` and adds a `CHANGELOG.md` entry — each claim verified
against the running app, never against this spec.
