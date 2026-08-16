# Assistant operability (D-AO1–D-AO6)

Every react-router **`<Route>`** a user can land on — and every addressable UI view an agent can
`ui_navigate` to — must resolve to a **real, page-appropriate assistant surface**, so the "App
assistant" dock can operate the *current* feature instead of falling back to the generic `global`
starter set. This closes the operability gap behind the **Agents & Crews** report: the dock showed
the global chips ("Most expensive server / Token savings / Recent failures") on `/assistant/agents`
because **nothing in the app required a new view to expose an assistant interface** — the whole Hub
was never wired into the dock's context/suggestion/navigation registries. This rule makes that a
hard, gated invariant.

This is a peer to [`brand-ui-only.md`](./brand-ui-only.md), with one deliberate difference: it is
enforced by a **test inside `pnpm test`, not a PostToolUse hook** (see *Enforcement* below).

> **Locked owner decision D-AO1/D-AO2 (2026-07-26).** Enforcement is a **hard CI/test gate over a
> single source-of-truth route manifest**, not a regex hook. The enforceable unit is the
> react-router **`<Route>`** (plus the addressable UI view) — not a function or component — because
> the dock's entire context derives from `location.pathname` (+ `?tab`); it cannot observe
> functions. Every route resolves to a **non-`global` starter surface** appropriate to the page —
> plus an **entity pin** where the URL names one entity — **or** is declared a `redirect` / a
> reasoned `exempt` in the manifest. The dock must **never silently fall back to the generic
> `global` starter set on a real feature page.**

## The rule

- **The one declaration you touch is the manifest.** When you add or change a `<Route>` in
  `apps/web/src/App.tsx`, add or adjust exactly one entry in
  [`packages/shared/src/assistant-route-manifest.ts`](../../packages/shared/src/assistant-route-manifest.ts)
  (`ASSISTANT_ROUTE_MANIFEST`). An entry is
  `{ pattern, surface | "redirect", pin?, addressable?, view?, exempt? }`, where `pattern` is
  **byte-identical** to the `path="…"` literal in `App.tsx` (the coverage check is a string-set
  equality — a typo is a failure, not a near-miss).
- **Give the route a real surface.** `surface` must be a non-`global` `AssistantStarterSurface`
  appropriate to the page (`server`, `scan`, `skill`, `run`, `suite_run`, `collection`, `compare`,
  `compatibility`, and — from Phase 2 — the Hub's `hub` / `agents` surfaces). Picking a surface is
  the whole point: it forces you to decide what the dock should *do* on this page, which is the
  decision the old code let everyone skip.
- **Pin the entity when the URL names one.** When a route's URL identifies a single entity
  (`/servers/:serverId`, `/scans/:scanId`, `/testing/runs/:runId`, …), set `pin` to the
  `AssistantEntityKind` the resolver returns, so the dock scopes to *that* entity. A route that
  names no single entity (a comparison, a list, the Hub) stays deliberately unpinned — fabricating a
  pin would silently widen the dock's write scope.
- **Declare `addressable` + `view` for a navigable view.** If an agent can `ui_navigate` to the
  route, set `addressable: true` and name the `ASSISTANT_UI_VIEWS` member in `view`; the gate
  reconciles the addressable entries 1:1 with that registry.
- **The manifest is an assertion harness, not a generator.** The live resolvers
  (`resolveStarterSurface`, `resolveEntityPin` / `deriveAssistantEnvelope`, and the
  `ASSISTANT_UI_VIEWS` registry) are ground truth; the manifest asserts it agrees with them. If a
  check fails, **the manifest is wrong** — re-derive it against the resolver, never the reverse.

## Enforcement = the gate, not a hook (D-AO1)

"Every route is context-aware" is a **whole-repo join** — the `App.tsx` route table × the surface
resolver × the entity-pin resolver × the UI-view registry. A per-file PostToolUse hook only ever
sees the one file just edited, so it *cannot* evaluate that join; and regex-parsing the lazy
`<Routes>` JSX to reconstruct it is brittle. The authority is therefore a **test**, split across the
package boundary and run inside `pnpm test`:

- [`apps/api/test/assistant-route-operability.test.ts`](../../apps/api/test/assistant-route-operability.test.ts)
  — **Test A** (coverage: every `App.tsx` `path="…"` has exactly one manifest entry, and the only
  manifest-only pattern is the `/settings/:section` known-extra), **Test B** (operability: every
  entry is a `redirect`, or a non-`global` surface, or `global` *with* a non-empty `exempt`), and
  **Test C-shared** (`resolveStarterSurface` agrees with each non-redirect entry's `surface`;
  `addressable` views reconcile with `ASSISTANT_UI_VIEWS`; every `pin` is a real
  `ASSISTANT_ENTITY_KINDS` member).
- [`apps/web/src/features/assistant/assistant-route-operability.test.tsx`](../../apps/web/src/features/assistant/assistant-route-operability.test.tsx)
  — **Test C-web** (pin conformance: `deriveAssistantEnvelope` agrees with each entry's `pin`).

The gate is split because `resolveEntityPin` / `deriveAssistantEnvelope` live in `apps/web` as a
React `.tsx` that a node-runner api test may not import (`architecture.md` forbids api↔web source
imports; the runner can't load `.tsx`) — see the WP 1.1 decision in
[`../../roadmap/assistant-operability/STATUS.md`](../../roadmap/assistant-operability/STATUS.md).
Both halves run inside `pnpm test`, so the manifest is pinned to **both** live resolvers.

WP 4.1 may add a **non-blocking** PostToolUse *nudge* (`enforce-assistant-operability.mjs`) that
flags a new `path="…"` in `App.tsx` with no manifest entry at edit time — but that is a convenience
only; **the test stays the authority.** Do not treat the nudge as the enforcement mechanism.

## Applying it — the developer workflow

1. Add a `<Route path="/thing">` to `App.tsx`.
2. Run `pnpm test`. **Test A fails**: "App.tsx routes with NO manifest entry".
3. Add one `ASSISTANT_ROUTE_MANIFEST` entry for `/thing` with a **real, page-appropriate `surface`**
   (this is the forcing function — you must decide what the dock does on this page), **or** a
   reasoned `exempt` / `redirect` (the escape hatch below).
4. If you chose a real surface, Test C will hold you to it — the manifest must match what
   `resolveStarterSurface` / `deriveAssistantEnvelope` actually return, so a surface you *declare*
   but never *wire* still fails.

## Escape hatch (D-AO4)

The operability analogue of `brand-ui-allow:` — allowed, but **visible and owner-reviewed**:

- **`exempt: "<reason>"`** on a `surface: "global"` entry — for a page whose operable surface is a
  drill-in detail (a list → its `/:id` detail), a management/config surface with no single entity to
  pin, a launcher with no entity yet, or the canonical global home (`/dashboard`).
- **`surface: "redirect"`** — for a `<Navigate>` route, which never paints a surface to be
  context-aware about.

Reasons must be **honest and specific** — "List page; the operable surface is the drill-in
`/scans/:scanId` detail" is a reason; "n/a" is not. A temporary exemption that a later WP will
upgrade should name that WP so the exemption reads as visibly provisional (as the Phase 1 Hub rows
do: "the dock's `hub` starter surface lands in WP 2.1"). An exemption is a decision on the record,
not a way to skip the decision.

## Scope — this governs the DOCK, not the Hub (D-AO5)

This rule governs the right-side **"App assistant" dock**, whose mission is to **operate the current
feature** on the user's behalf. It does **not** govern the Hub's full-page, general-purpose
assistant (`/assistant`) — that is D-AH1's world ("app data is not the center of gravity"). The
Hub's *dock* starter surfaces therefore stay **analysis-only and page-operation-flavored**
("summarize *this* page's usage"), never "answer anything".

## Frozen boundary (D-AO3)

Hub integration is done with **route-keyed `agents` / `hub` starter surfaces** (mirroring the
existing `compatibility` precedent — analysis-only, no write scope), **not** new entity kinds.
`ASSISTANT_ENTITY_KINDS` is the write-scope **security boundary** (`SCOPE_WRITE_TOOLS`,
`deriveAssistantScope`, the persisted `entityKind` wire); expanding it is an owner-gated D-AS7 change
into security-critical code and is **out of scope here**. **Never touch `ASSISTANT_ENTITY_KINDS` /
`SCOPE_WRITE_TOOLS` / `deriveAssistantScope`** to satisfy this rule. (And per D-AO6, this rule adds
**no DB migration and no new runtime dependency** — it is a shared registry + a test + read tools
over existing repositories + docs.)

Related: [`routes-vs-dialogs.md`](./routes-vs-dialogs.md) (routes vs dialogs — the manifest
classifies exactly the `<Route>`s that rule defines, plus the deep-linkable `/settings/:section`
modal), [`brand-ui-only.md`](./brand-ui-only.md) (the sibling hard rule; that one is hook-enforced,
this one is test-enforced), and the plan
[`../../roadmap/assistant-operability/README.md`](../../roadmap/assistant-operability/README.md).
