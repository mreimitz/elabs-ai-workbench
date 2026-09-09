---
type: "Status Ledger"
title: "brand-ui 4.1.0 adoption — work-package status ledger · PRIORITY: HIGH"
description: "Living state for the brand-ui 4.1.0 adoption plan, read and updated by /next-wp brand-ui-4-1."
tags: ["roadmap", "RM-39"]
timestamp: "2026-09-09T21:40:00Z"
status: "active"
---
# brand-ui 4.1.0 adoption — work-package status ledger · **PRIORITY: HIGH**

Living state for the **brand-ui-4-1** plan, read and updated by `/next-wp brand-ui-4-1`.
A box is ticked **only** when the WP's Acceptance is met and the gate
(`pnpm typecheck && pnpm test && pnpm build && pnpm lint`) is green.

**Legend:** `[ ]` open · `[x]` done. Done lines: `… — done <YYYY-MM-DD> · wp/brand-ui-4-1/<id>`.

> Plan + invariants in [`item.md`](./item.md). Locked decisions **D-BU1–D-BU9** below are the
> constraints the code must keep honouring — a WP may not quietly relax one.

---

## Where the facts in this ledger come from

Every claim below was read from the **published 4.1.0 artefacts**, not from memory and not from the
locally installed plugin checkout:

- the 4.1.0 tarballs of all twelve packages from the public npm registry (they ship `src/`, including
  stories), diffed file-by-file and export-by-export against the 4.0.0 tarballs;
- the 4.1.0 CLI's generated component manifest (`brand-ui docs <Name>`), which is the maintainers'
  own anti-hallucination surface;
- the upstream repository at tag-equivalent `main` (`packages/ui/package.json` reads `4.1.0`) — its
  `CHANGELOG.md` §`v4.1.0 — 2026-09-08` (2,328 lines), its `registry/blocks/app-shell/` sources and
  its `docs/superpowers/specs/2026-09-05-app-shell-blocks-design.md`.

**The plugin checkout at `~/.claude/plugins/marketplaces/brand-ui` is version 2.1.1 and is stale.**
Its skills, manifest and component APIs describe a system three majors behind. Do not consult it for
this work — it is the same trap the retired `vendor/brand-ui-agent-kit/` was, and
`.claude/rules/dependencies.md` already records that lesson.

---

## The finding that reframes this item

`docs/superpowers/specs/2026-09-05-app-shell-blocks-design.md` §2.1 in the upstream repository states
that the library's new flagship app shell was designed by **reading this repository**. It cites
`apps/web/src/components/AppShell.tsx` (1,102 lines) and `PageShell.tsx` (254 lines) by path and line
count, and enumerates nine things this app carried that the library did not — the skip link, the
active-nav accent indicator (added here *because* the library's own `bg-sidebar-accent` default
measured 1.17:1 in light and 1.29:1 in dark), the collapsed icon-rail repairs, the sidebar pinned to
`data-density="comfortable"`, the `⌘K` command trigger, and the resizable right-hand assistant dock
with its 480px minimum content width and its own 1100px overlay breakpoint.

The flagship block's own header comment calls itself *"a direct port of the shell the elabs AI
Workbench ships"*.

**Consequence for planning.** This is not "adopt a foreign template". Nearly every shell repair this
repo invented is now a supported, tested, upstream primitive with the same constants. The work is to
**delete our copies and import theirs** — and to take the handful of things the library did *not*
copy from us, which are listed as WP 2.4 and WP 2.5.

---

## Locked decisions

- **D-BU1 — the range is pinned, not caret.** Every `@elabs-ai/components-*` dependency is an exact
  `4.0.0` today and becomes an exact `4.1.0` on upgrade. 4.1.0 carries **three** breaking changes
  under a minor version number — a deliberate maintainer decision, stated in the changelog's own
  "Note on this release's number" — so a caret range is a build break waiting for the next
  `pnpm install` that re-resolves. The pin was applied ahead of this plan as a protective measure.
- **D-BU2 — the upgrade is atomic across all packages.** They ship in lockstep; `.claude/rules/dependencies.md`
  already requires all-or-none. `@elabs-ai/components-terminal` and `-process` join the workspace
  only if a WP actually renders them — a new dependency still needs owner approval.
- **D-BU3 — a rename is a rename, never a local alias shim.** The three breaking changes are
  migrations with a mechanical answer. We do not add a compatibility layer that re-exports the old
  names; that would leave this repo the only place in the world still speaking 4.0.0's vocabulary.
- **D-BU4 — a library primitive replaces a local workaround only when it is behaviourally equal or
  better, proved by the existing test.** Our shell guardrails (`one-main.guardrail.test.tsx`,
  `touch-target.guardrail.test.tsx`, the token-contrast identity guardrail) stay and must stay green
  across the swap. If a guardrail goes red, the library is not yet equal and the local code stays,
  with the difference recorded here.
- **D-BU5 — the light focus-ring override in `app.css` is not in scope and is not deleted.**
  `.claude/rules/styling-and-tokens.md` records why it exists (upstream's lime ring measures
  1.30–1.42:1 in light). 4.1.0 retunes the four `-text` status tokens but the ledger's own reading
  found no change to `--ring` in light. Re-measure before touching it; absent a measurement, keep it.
- **D-BU6 — `SchemaForm` adoption must not silently change what a tool call sends.** The tool
  playground's job is to send exactly the arguments an MCP server's `inputSchema` describes.
  `fromJsonSchema` **refuses** `$ref`, `allOf`, `oneOf`, `anyOf` and `not` by throwing
  `UnsupportedJsonSchemaError`, and **drops** properties whose type it does not cover. Both are
  documented upstream as deliberate. Any adoption keeps a working path for a refused schema and must
  never submit a form that omits a field the schema requires.
- **D-BU7 — the state illustrations are an owner decision, not a default.** `@elabs-ai/components-ui`
  now ships seven `*Illustration` components and a `StatePanel illustration` prop. This repo has its
  own in-flight illustrations package (RM-14) with a different purpose — entity illustrations for a
  scene compositor, not empty/error state art. They are not the same thing and one does not retire
  the other. WP 4.1 states the question; it does not answer it.
- **D-BU8 — no wire change, no migration, no new environment variable.** Everything in this item is
  a web-package change plus a dependency bump. If a WP finds it needs a schema change, it stops and
  says so rather than widening.
- **D-BU9 — a visual claim needs a browser.** Every WP that changes what the shell looks like is
  verified against the running app in **both** themes and with a keyboard pass, per
  `.claude/rules/quality-gates.md`. A headless assertion that a class string is present is not a
  substitute and may not be reported as one.

---

## Phase 1 — take the breaking changes (blocks everything else) — ✅ COMPLETE 2026-09-09

> The app runs on **4.1.0**. Gate green: `pnpm typecheck` · `pnpm test` (shared 288 · illustrations
> 1032 · cli 87 · api 3985 · web 402 files / 4,534 tests, 0 failures) · `pnpm build` · `pnpm lint`.
> Booted the built app against an isolated database on a spare port and looked at it in a real
> headless browser: the shell renders in **both** themes, exactly one `<main>`, the skip link is
> present, and there were **zero** console errors. Screenshots were taken; they are not committed.
>
> **What Phase 1 actually found, beyond the three migrations it was scoped to:**
>
> - **The `Form` split gives this repo nothing yet.** The eight moved names are unused here (the
>   form kit is built on `FieldRow`), so the migration was a no-op — but `react-hook-form` is
>   **still installed and still linked into `@elabs-ai/components-ui`'s own `node_modules`**,
>   because pnpm auto-installs optional peers. The changelog's promised win ("a consumer who
>   doesn't use `Form` no longer installs or bundles either") does **not** land under this package
>   manager's defaults. Turning that off is a global setting with repo-wide effects and was not done.
> - **The terminal split DOES land.** `@xterm/xterm` and `@xterm/addon-fit` went from present to
>   **zero occurrences in `pnpm-lock.yaml`**, and nothing links them any more. Measured, not assumed.
> - **A real accessibility defect, now on the record and not fixed here.** The palette's search box
>   has **no accessible name**. cmdk always sets `aria-labelledby` on its input, pointing at the
>   label element `Command` renders only when given a `label` — and `CommandDialog` accepts no such
>   prop and forwards none. `aria-labelledby` outranks `aria-label`, so the name computes to the
>   empty string and the `aria-label` this WP added cannot win. **The old test mock supplied its own
>   label, which is exactly why no test ever saw this.** It is an upstream gap (`library-first.md`:
>   raise it, don't hand-roll around it); the tests now locate the box by role alone.
> - **The picker's tests got stronger, not weaker.** Because the picker composes
>   `@elabs-ai/components-ui` directly and that package is mocked nowhere, **every** picker test now
>   runs against real cmdk and a real Radix modal, instead of a stub that re-implemented filtering.
>   That is what turned up the unnamed search box, and it retired ~230 lines of mock that described
>   a deleted API. `HubModelPicker.cmdk.test.tsx` existed solely to create this arrangement for one
>   test; it is now the default everywhere, and that file is four lines.
> - **Two upstream changes were absorbed into tests rather than papered over.** `Button` moved from
>   a hand-stacked `focus-visible:ring-ring` to the `focus-ring` compound utility (ADR 0027) — the
>   assertion now names the utility *and* asserts the old class is absent, so a half-done migration
>   cannot pass on the dead one. And a cmdk option is a `div` marked `aria-disabled`/`data-disabled`,
>   not a native `disabled` control, so `toBeDisabled()` was replaced by both attributes plus the
>   inert-click proof that was already there.
> - **A guardrail bit, correctly, twice.** The first re-composition introduced a hand-rolled dialog
>   surface, which the design-remediation T2 ratchet forbids outside `components/dialogs/` — its
>   allowlist may only ever shrink, so the code moved onto `CommandDialog` rather than the list
>   growing. It then bit a second time on the *comment* explaining the first fix, because the check
>   is a text scan; the comment was reworded.
>
> **Not verified:** no hand-driven keyboard pass, and the model picker was never exercised against a
> real provider credential (the boot used an empty database), so the nine call sites are proved by
> tests only.

- [x] **WP 1.1 — `Form` moves off the main barrel.** — done 2026-09-09 · wp/brand-ui-4-1/1.1
      `Form`, `FormField`, `FormItem`, `FormLabel`, `FormControl`, `FormDescription`, `FormMessage`
      and `useFormField` are no longer exported from `@elabs-ai/components-ui`; they live at
      `@elabs-ai/components-ui/form`, and `react-hook-form` + `@hookform/resolvers` became **optional**
      peers.
      **Measured impact on this repo: zero.** A scan of every `import … from "@elabs-ai/components-ui"`
      in `apps/web/src` found no use of any of the eight names — this app's form kit is built on
      `FieldRow` and its own `components/form/*` compositions, which is exactly the react-hook-form-free
      path the split was made for. So this WP is a **verification**, not a migration: confirm the zero
      after the bump, and confirm we do not gain `react-hook-form` as a transitive install.
      *Acceptance:* the bump lands; no import of the eight names exists; `react-hook-form` is absent
      from `apps/web`'s resolved tree; gate green.

- [x] **WP 1.2 — `Context*` → `TokenUsage*` (`@elabs-ai/components-ai`).** — done 2026-09-09 · wp/brand-ui-4-1/1.2
      The context-window usage readout is renamed outright, with no alias and no transitional
      re-export: `Context` → `TokenUsage`, `ContextTrigger` → `TokenUsageTrigger`, `ContextContent` →
      `TokenUsageContent`, `…ContentHeader/Body/Footer` likewise, `ContextInputUsage` →
      `TokenUsageInput`, `ContextOutputUsage` → `TokenUsageOutput`, `ContextReasoningUsage` →
      `TokenUsageReasoning`, `ContextCacheUsage` → `TokenUsageCache`, and every matching `*Props`.
      Props, behaviour and rendered DOM are unchanged, so the rename is the whole migration.
      **Sites:** `apps/web/src/features/testing/KpiRail.tsx` is the one real consumer;
      `features/hub/test-support/brand-ai-mock.tsx` mocks the same family and renames with it.
      **Also breaking, and easy to miss:** the six locale keys move from `ai.context.*` to
      `ai.tokenUsage.*` in `DEFAULT_MESSAGES`. This app does not currently override them — confirm
      that, and if it ever does, the key names change too.
      *Acceptance:* no `Context*` usage-readout name remains; `KpiRail` renders the same figures; the
      cache-split tiles RM-33 added still read correctly; gate green.

- [x] **WP 1.3 — the `ModelSelector*` family is deleted.** — done 2026-09-09 · wp/brand-ui-4-1/1.3
      All fourteen exports are gone from `@elabs-ai/components-ai` with no alias. Eleven of them were
      one-line pass-throughs of `@elabs-ai/components-ui` components, which is why they were removed
      rather than moved: `ModelSelectorGroup` *was* `CommandGroup`, `ModelSelectorItem` *was*
      `CommandItem`, `ModelSelectorDialog` *was* `CommandDialog`. The provider-logo half survives,
      renamed: `ModelSelectorLogo` → `ModelProviderLogo`, `ModelSelectorLogoGroup` →
      `ModelProviderLogoGroup`, `MODEL_SELECTOR_LOGO_BASE_URL` → `MODEL_PROVIDER_LOGO_BASE_URL`
      (rendering byte-identical).
      **Sites: three non-test files.** `features/hub/HubModelPicker.tsx` is the substantial one — it is
      RM-16's single picker, the one that replaced four implementations across nine call sites, and it
      is built on ten `ModelSelector*` parts. It re-composes directly on `CommandDialog` + `Command` /
      `CommandInput` / `CommandList` / `CommandEmpty` / `CommandGroup` / `CommandItem` /
      `CommandSeparator` from `@elabs-ai/components-ui`, with `DialogTrigger` replacing
      `ModelSelectorTrigger` one-for-one. `features/hub/Composer.tsx` and
      `features/hub/agents/RoleAvatar.tsx` take the logo rename only. Two test-support mocks
      (`brand-ai-mock.tsx`, `brand-ai-cmdk-mock.tsx`) and their dependent suites follow.
      **Guard against a silent regression:** RM-16's whole point was that a model choice means the
      model *and* the credential. The picker's grouping, its credential rows and its
      `providerCredentialId` plumbing must survive the re-composition unchanged — the existing
      `HubModelPicker` tests are the proof, and they must stay green without being weakened.
      *Acceptance:* no `ModelSelector*` name remains; the picker's nine call sites behave identically;
      RM-16's tests pass unmodified in intent; gate green.

- [x] **WP 1.4 — the terminal family moved to a new package, and we must confirm we do not use it.** — done 2026-09-09 · wp/brand-ui-4-1/1.4
      `Terminal`, `InteractiveTerminal`, `buildInteractiveTerminalTheme` and their parts left
      `@elabs-ai/components-ai` for the new `@elabs-ai/components-terminal`, with no re-export.
      **Measured impact: zero** — this app imports none of them. So the correct action is to take the
      *benefit*: `@xterm/xterm` and `@xterm/addon-fit` were optional peers of `-ai` and now travel
      with the terminal package, so a chat-only consumer can drop them. Confirm this app never
      installed them, and record that we deliberately do **not** add `-terminal`.
      *Acceptance:* no terminal import exists; no xterm package is in `apps/web`'s resolved tree; the
      decision not to adopt `-terminal` is written down; gate green.

- [x] **WP 1.5 — the bump itself, and the peer that widened.** — done 2026-09-09 · wp/brand-ui-4-1/1.5
      Move all eight `@elabs-ai/components-*` deps in `apps/web` plus the root
      `@elabs-ai/components-cli` from exact `4.0.0` to exact `4.1.0` (D-BU1), reinstall, and run the
      full gate. Two things to watch. **First:** `@elabs-ai/components-ai`'s peer on the Vercel AI SDK
      widens to `ai@^6 || ^7` **and becomes optional**, which turns off the package manager's peer
      auto-install — this app already declares `ai@^6` in `apps/web` and `ai@^7` in `apps/api`
      (`.claude/rules/dependencies.md` records why those must not be unified), so the explicit
      declaration is what saves us; verify both still resolve. **Second:** `@elabs-ai/components-icons`
      became a **peer** dependency of `-ai`; it is already a direct dep here, so verify rather than
      assume. Also add the `@source` line for any new package a later WP adopts — a missing one
      renders that package unstyled with no error.
      *Acceptance:* every package resolves at exactly 4.1.0; `pnpm typecheck && pnpm test && pnpm build`
      pass and `pnpm lint` is clean; the app boots and the shell renders in both themes.

---

## Phase 2 — bring the shell repairs home

> Read the "finding that reframes this item" section above before starting any WP here. Each of
> these deletes local code whose upstream equivalent exists *because of* this repo.

- [x] **WP 2.1 — `SkipLink` and the `<main>` contract.** — done 2026-09-09 · wp/brand-ui-4-1/2.1

      The hand-rolled anchor is replaced by the imported `SkipLink`. The wording stays
      **"Skip to content"** — two tests pin it and it is the string a keyboard user has learned; the
      component's own default is only a default.

      **The behavioural difference was checked, not assumed.** Ours positioned with `focus:fixed`,
      the library uses `focus-visible:absolute` — and an absolutely-positioned pill resolves against
      the nearest POSITIONED ancestor, so it could in principle land off-screen. Measured in a real
      browser by pressing Tab once from the top of the document: the link takes focus, becomes
      visible at **(13, 13), 119×33**, in **both** themes. `focus-visible` rather than `focus` is
      also correct for this control — a skip link is reached by Tab, which sets `:focus-visible`, and
      nobody clicks a link they cannot see.

      `<main>` keeps `tabIndex={-1}` here, deliberately NOT the `{0}` the library's own `AppShell`
      primitive uses: there `<main>` IS the scroll port, whereas in this app the port lives inside
      `PageShell` (see WP 2.6). A skip target that is not a scroll container must not become a tab
      stop.
- [x] **WP 2.2 — `CommandTrigger` replaces the hand-rolled ⌘K search button.** — done 2026-09-09 · wp/brand-ui-4-1/2.2

      The local `SHORTCUT_HINT` platform sniff and the search-shaped `Button` are gone; the imported
      `CommandTrigger` computes the hint itself and marks both the visible label and the `Kbd`
      `aria-hidden` so the shortcut glyph cannot concatenate into the accessible name.

      Two choices at the call site. The accessible name stays the richer **"Search — open the command
      palette"** rather than the bare visible label (the component sets `aria-label` before its prop
      spread, so passing it here wins, and a name that says what the control DOES beats one that
      repeats its glyph). And the native `title` the old button carried is **deleted** —
      `.claude/rules/icon-affordances.md` reserves `title` for truncated text, never as the hover
      affordance of a control that collapses to an icon under `sm`, which this one does.
- [x] **WP 2.3 — `SideDock` replaces the hand-rolled assistant dock.** — done 2026-09-09 · wp/brand-ui-4-1/2.3 (owner chose to switch)

      **Owner decision taken 2026-09-09: switch.** The hand-rolled dock is gone — a **net 168 lines
      removed** from `AppShell.tsx` (110 added, 278 deleted). What went with it: the resizable right
      column, its bespoke `DockResizeHandle` (a 73-line pointer+arrow-key separator written because
      `ResizableHandle` cannot animate a width), the `useDockAsSheet` matchMedia hook, the
      `resize`-listener effect that re-clamped the stored width against the live viewport, the
      close-transition timer that kept content mounted for exactly 200ms, and the entire separate
      narrow-screen `Sheet` branch. `SideDock` does all of it, with the SAME constants this app
      chose first, and adds arrow-key resizing the local version never had.

      What stayed is the only part that is genuinely this app's business: **where** the width is
      persisted. It is now written on `onWidthCommit` — once per interaction — rather than on every
      pointer move, which is a better contract than the local one had.

      **The guardrail from WP 2.4 caught a real hazard during this swap, and was fixed to be
      stronger.** It looked for `aside[aria-label="App assistant"]` — the hand-rolled dock's markup.
      `SideDock` labels its aside with `aria-labelledby` instead, so that selector stopped matching
      and the test went **green for the wrong reason**: it was asserting about an element that no
      longer existed. The invariant was never about that one aside, so it now asserts that **no**
      `<aside>` sits inside `<main>`, whoever renders it, and the harness forces a 1600px viewport
      because below the dock's 1100px breakpoint `SideDock` renders a portalled overlay that is
      trivially outside `main` and would prove nothing. Re-proved by mutation: moving the `SideDock`
      back inside `SidebarInset` turns it red.

      **NOT VERIFIED, and this is the one to look at.** The assistant dock needs provider credentials
      to render, and this environment has none, so the dock has **never been seen** in its new form.
      The specific risk, read from `SideDock`'s source rather than imagined: its body is
      `p-4 overflow-y-auto`, i.e. it owns padding AND scrolling — while `AssistantDock` mounts a
      `ChatShell` that owns its own transcript scroll and pins a composer to the bottom. A scrolling
      parent around a self-scrolling chat can produce a double scrollbar and a composer that scrolls
      away. Three further known consequences of the switch, all accepted by the owner in advance:
      the dock's ground changes from `--sidebar` to `--card`; the `assistant-dock-shell` block in
      `app.css` was tuned to fix `ChatShell`'s colour scrims **on the sidebar ground** and will need
      re-checking on the new one; and `SideDock` renders its own title/close header above a
      `ChatShell` that already has chrome.

      Gate green (typecheck · 4,568 web tests · build · lint), but a green gate cannot see any of
      the four things above. **First owner action: open the dock with a signed-in provider and look.**
- [x] **WP 2.4 — the complementary landmark is currently inside `<main>`. Fix it.** — done 2026-09-09 · wp/brand-ui-4-1/2.4

      **Fixed.** The dock's `<aside aria-label="App assistant">` and its resize handle are now flex
      SIBLINGS of `SidebarInset` under the provider, whose root is `flex min-h-svh w-full` — the same
      arrangement brand-ui's flagship block uses, and it names this exact mistake at its dock call
      site *because that block was ported from this app*. The top bar stays inside the main column so
      the bar still never spans across the dock.

      Purely structural: the flex row, the widths, the transition and the surfaces are unchanged, so
      nothing moved on screen. Confirmed live — one `main` landmark, no console errors, both themes.

      **A new guardrail locks it and was proved to have teeth.** `one-main.guardrail.test.tsx` gains
      a dock-mounted harness asserting `main.contains(aside) === false`, plus that exactly one `main`
      survives and the dock content still mounts. Putting the `<aside>` back inside `SidebarInset`
      turns it **red** with the message *"the assistant dock's `<aside>` is inside `<main>` — a
      complementary landmark nested in the main landmark"*; the mutation was run and reverted.
- [x] **WP 2.5 — delete the two sidebar workarounds the library absorbed.** — done 2026-09-09 · wp/brand-ui-4-1/2.5

      Both are gone from this app.

      **(a) The active-nav indicator.** `ACTIVE_NAV_INDICATOR_CLASS` and its four call sites are
      deleted. Gated on a MEASUREMENT rather than the changelog: `--sidebar-primary` (what upstream
      paints) and `--primary` (what this app painted) resolve to **the same value in both themes** —
      `oklch(87.5% .148 116.5)` — against a sidebar at 30% / 18% lightness, so the bar is
      pixel-identical. Re-measured after the deletion on the running app: the active item's `::before`
      still paints `oklch(0.875 0.148 116.5)` at `font-weight: 600`, in both themes.

      Its guardrail was **rewritten rather than deleted**, and is now stronger: it used to assert
      strings on a constant this app owned; it now renders the shell and asserts the class list that
      ACTUALLY reaches the active nav item — so it fails if upstream ever drops the bar, which the
      old version could not see, as well as if this app reverts to a wash.

      **(b) The collapsed group label.** The local `group-data-[collapsible=icon]:hidden` override is
      removed from all four group labels. Verified by diffing the two published sources, not assumed:
      4.0.0's `SidebarGroupLabel` collapsed with `-mt-8 opacity-0` (invisible but still BOXED),
      4.1.0's with `hidden`. Checked live — the collapsed icon rail has no phantom gaps.

      **Left alone**, as the plan said: the pinned `data-density="comfortable"`, `SidebarContent`'s
      explicit `min-h-0 overflow-y-auto`, the `display: contents` nav landmark, the collapsed-rail
      mirror items, and the 44×44 coarse-pointer floor. Upstream lists these as things it read from
      here, but the shipped `Sidebar` was not verified to carry them.
- [x] **WP 2.6 — reconcile our `PageShell` with the library's new scroll modes.** — done 2026-09-09 · wp/brand-ui-4-1/2.6

      **Kept ours, and fixed the real defect it was missing.** This app's `PageShell` invented the
      same three-mode `scroll` vocabulary independently, but the two are not drop-in equivalents —
      ours defaults to `"content"`, the library's to `"body"` (byte-identical to its old behaviour,
      for compatibility), and ours owns this app's gutter scale and header variants. Re-basing would
      be a large change for no behavioural gain.

      What the comparison DID surface is a **second real accessibility defect, now fixed**: this
      app's scroll ports carried **no `tabIndex`**, so a keyboard-only user could not scroll a page
      whose content held nothing focusable — a long read-only report, say. That is WCAG 2.1.1 / axe
      `scrollable-region-focusable`, and it is exactly the pair the library's `scroll="content"` adds.
      Both ports now carry `tabIndex={0}` and `focus-ring-inset` — **inset**, not the plain rung,
      because both of its layers are drawn outside the element's box and an ancestor here carries
      `overflow-hidden`, which would clip the indicator away entirely.

      Verified on the running app: `/advisor`, `/servers` and `/skills` now expose a focusable scroll
      port; `/scans` correctly exposes none, because it uses the `fill` mode, which scrolls nothing
      itself.

      **One conflict had to be adjudicated in the open.** Biome's `noNoninteractiveTabindex` forbids
      exactly this, so it is suppressed at the two lines with a stated reason: that rule guards
      against tab stops on inert decoration, while axe's rule REQUIRES one on a scrollable region.
      The rules genuinely conflict, the more specific wins, and brand-ui's own `PageShell` and
      `AppShell` make the same call.

      *Noticed, not fixed:* two library-owned elements on the dashboard carry `focus-ring-inset` on a
      scrollable div with **no** tab stop — the same defect, in upstream's code. Out of scope here.
- [x] **WP 3.1 — adopt `SchemaForm` + `fromJsonSchema` in the MCP tool playground.** — done 2026-09-09 · wp/brand-ui-4-1/3.1

      **Done.** The tool playground's parameters pane is now a real typed form. A string array is a
      repeatable list with an *Add item* control, a constrained array is a multi-select, a number is
      a stepper, an enum is a select, and each field carries its schema `description` as help text —
      where every one of those used to be either a bare text input or, for anything array- or
      object-shaped, a **"paste JSON here" textarea** matched by a regex on a stringified type label.

      **Measured on real data, not fixtures:** all **24 of 24** tools on the workbench's own MCP
      mount produce a usable typed form — zero refusals. Rendered in a browser, both themes, no
      console errors: `run_plan_start`'s seven parameters come through with **zero** raw-JSON boxes.

      **The safety half is the point, and it lives in its own tested module** (`lib/tool-schema-form.ts`,
      16 tests against the REAL adapter, never a stub). `planToolForm` refuses **four** ways, and any
      refusal keeps the existing hand-written form — which still has the raw-JSON escape hatch, the
      only thing that can express an arbitrary shape — and says so in a visible notice rather than
      degrading silently:
      1. **`$ref` / `allOf` / `oneOf` / `anyOf` / `not`** — the adapter throws; those keywords change
         what a schema MEANS and approximating them renders a field that is plausible and wrong.
      2. **A required property the adapter dropped.** `fromJsonSchema` silently omits any property
         whose type its subset does not cover. Dropping an OPTIONAL one costs a field; dropping a
         REQUIRED one means the form cannot express a valid call, and the button would submit the
         incomplete object anyway. Tested with a real case (`array of number`) that the adapter does
         drop.
      3. **A nested object — and this one is an upstream gap worth reporting.** `fromJsonSchema` maps
         `{ address: { city, zip } }` onto a group and FLATTENS it into one flat values map. Upstream
         ships `jsonSchemaRequestBody(spec, values)` to rebuild the nested shape — but it is **not
         exported from the package barrel** (checked against 4.1.0's published `dist/index.d.ts`). So
         a consumer literally cannot un-flatten, and submitting would send `{ city, zip }` where the
         tool asked for `{ address: { city, zip } }`: accepted, plausible, wrong. Refused until that
         helper is public. **This refusal is also what keeps the argument-building a straight copy** —
         lift it and the submit path needs the un-flattening step, not a tweak.
      4. A schema that is not an object at all.

      **One thing the swap would have lost, caught by looking at it and then fixed.** The adapter
      emits fields in the schema's own property order, so `run_plan_start`'s single REQUIRED argument
      (`source`) rendered **sixth of seven** — the hand-written form had always sorted required-first.
      `planToolForm` now re-orders required-first (stable within each group), because D-BU4 says the
      replacement must be at least as usable as what it replaced.

      Validation moved to the library's own `validateForm`, which knows each field's real constraints
      (min/max, pattern, minItems, required) instead of this component's "is it empty / is it JSON"
      pair. The destructive-confirm gate, the KPI footer and the result pane are untouched.

      *Known, minor, not fixed:* the adapter humanises labels from property names, so `aggregateCostCapUsd`
      reads "Aggregate Cost Cap Usd" where the old form showed the exact wire name in monospace. An
      operator matching a name against a server's docs loses a little precision.

      *Not done:* no keyboard pass over the generated controls, and no tool has been RUN through the
      typed form against a live server — the arguments path is covered by tests and by the flatten
      refusal, not by an executed call.
- [ ] **WP 3.2 — the same treatment for resources, prompts and the skill tool runner.**
      `features/scans/ResourcePromptRun.tsx` (614 lines) and `features/skills/design/ToolRunnerSheet.tsx`
      solve the same problem separately. Fold them onto whatever WP 3.1 establishes, so the app has
      one schema-to-form path rather than three.
      *Acceptance:* one adapter, three call sites; behaviour unchanged; gate green.

- [ ] **WP 3.3 — evaluate the `Field*` primitives against `components/form/*`.**
      `@elabs-ai/components-ui` now ships `FieldRoot` / `FieldLabel` / `FieldControl` /
      `FieldDescription` / `FieldError`, with `invalid` and `required` driving `aria-invalid` and
      `aria-required` across every control in the field. This app's form kit
      (`BoundedNumber`, `KeyValueEditor`, `ListEditor`, `SegmentedField`, `SliderNumber`, `TagInput`)
      predates them. This WP is a **read and a recommendation**, not a rewrite: say which of the six
      would be simpler on `Field*`, and which carry app-specific behaviour worth keeping.
      *Acceptance:* a written recommendation with a per-component verdict; no code change required to
      close it.

---

## Phase 4 — the rest of the release, judged rather than absorbed

- [ ] **WP 4.1 — state illustrations: state the question, get an owner answer.**
      `@elabs-ai/components-ui` ships seven `*Illustration` components (`EmptyList`, `NoResults`,
      `NoAccess`, `Error`, `Offline`, `Success`, `FirstRun`) and `StatePanel` gained an `illustration`
      prop that renders one in place of the size-clamped `icon` slot. They draw in `currentColor` plus
      one meaning-bearing accent that follows a `--illustration-accent` property, and they are
      `aria-hidden` (the panel's title and description carry the meaning).
      This app has ~98 files rendering `EmptyState` / `ErrorState` / `StatePanel`, so the reach is
      wide. It also has its own `packages/illustrations` (RM-14) — but that package draws **entities**
      (MCP servers, skills, runs) for a scene compositor, which is a different job from empty-state
      art. Per D-BU7 the two coexist unless the owner says otherwise.
      *Acceptance:* the question is put to the owner with a rendered before/after of two real empty
      states in both themes; the answer is recorded here. No mass edit before that.

- [x] **WP 4.2 — the new chart families against the surfaces that hand-rolled them.** — done 2026-09-09 · wp/brand-ui-4-1/4.2

      **Verdict: adopt none of them now. One is worth building, and it is blocked on a wire change.**
      The charts package grew 238 → 345 source files and gained ten new containers. This app uses
      only the basic families (`Bar`/`Line`/`Area`/`Ring`/`Radar`/`Scatter`/`Sparkline`/`Gantt`) and
      **none** of the ten. Each was judged against the surface it appears to match, by reading our
      data shape and the component's own declared anti-patterns — not by name.

      | New chart | Surface it appears to match | Verdict |
      | --- | --- | --- |
      | `NetworkChart` | the run console's agent-graph lens | **No** |
      | `TreeChart` | the workforce org chart | **No** |
      | `HeatmapChart` | the MCP × model compatibility grid | **No** |
      | `TreemapChart` | per-tool token footprint | **No, for now** |
      | `DistributionChart` | the measured turn profile | **Yes — but blocked** |
      | `DumbbellChart` | the compare workspace's per-tool deltas | **Yes — the real find** |
      | `UnitChart` | the dashboard's surface-mix ring | **No** |
      | `WaterfallChart` · `BumpChart` · `ParallelCoordinatesChart` | — | **No** |

      **Why the two graph rejections are not laziness.** `NetworkChart`'s own anti-pattern list says
      *"Reading a force layout's POSITIONS as data — only adjacency is encoded; distance, direction
      and the picture's orientation are artefacts of the solver's seed."* Our agent-graph lens
      (`apps/web/src/features/testing/AgentGraphLens.tsx`) has an **Expanded** mode that unrolls
      every call *in execution order* — position IS data there — and it draws rich nodes carrying
      count/tokens/cost/duration chips plus `×N` edge labels. `NetworkChart` nodes are circles sized
      by value with optional text labels. Adopting it would delete a deterministic layout in favour
      of one whose own documentation says not to read it, and throw away the node chips. The org
      chart fails the same way against `TreeChart`, which draws every node at uniform weight and
      would lose the agent avatars and role chips.

      **Why the heatmap rejection is the interesting one.** The shape matches perfectly — two
      discrete dimensions (subject × model) and one numeric value with real nulls
      (`CompatibilityCell.score: number | null`), which is exactly the case `HeatmapChart`'s
      empty-pinprick exists for. But the current table is **already better than a colour ramp**:
      each cell carries a per-band glyph *and* a hatch so meaning survives colour-blindness and
      greyscale, an accessible name that decodes the band and speaks `"not scored"` for a null, a
      real focusable button per cell, and a pinned subject column. `HeatmapChart` encodes value as
      an ordered ramp step — and its own anti-patterns warn against leaning on ramp darkness to
      carry meaning. The cell's primary content is a **band** (a categorical verdict), not a
      magnitude. Swapping would trade a colour-independent grid for a colour-dependent one.

      **The one genuinely new capability, and why it cannot be built here.** `DistributionChart`
      (histogram / box / violin / strip) is the right picture for RM-34's measured turn profile,
      which today has **no visual at all**. It cannot be fed: its `data` prop is documented as
      *"RECORD-level rows — one per observation, NOT pre-aggregated buckets… handing it counts
      defeats the point"*, and `RunPlanTurnProfile` carries only `p10/p50/p90` plus a sample size.
      Rendering it needs the sample (or a full five-number summary) on the wire — **a wire change,
      which D-BU8 forbids in this item.** Recorded as a follow-up against RM-34, not smuggled in.

      **The real find is the one that was not on the original list.** The compare workspace
      (`apps/web/src/features/compare/CompareView.tsx`) renders per-tool `deltaTokens` sorted by
      absolute change as **table rows with badges, and no chart whatsoever**. `DumbbellChart` exists
      for precisely this — *"before/after per category… so the CHANGE is the mark, not a second
      bar"* — and its data is already on the client. It needs no wire change and no migration. It is
      the strongest candidate in the release for this app and belongs in its own work package.

      **A caution that applies to every future chart adoption, now measured rather than asserted:**
      **40 test files** stub `@elabs-ai/components-charts` with no-op or simplified components, so a
      chart-prop bug passes the gate in silence. Nothing here may be adopted on the strength of a
      green test; it is verified by looking at it, in both themes.

      *Not done:* no chart was rendered, and no browser was opened for this WP — it is a reading of
      our data shapes against the components' declared contracts. That is sufficient for a "do not
      adopt" verdict and is **not** sufficient for an adoption.

- [x] **WP 4.2b — `DumbbellChart` in the compare workspace (split out of WP 4.2).** — done 2026-09-09 · wp/brand-ui-4-1/4.2b

      Every diff tab (Tools / Resources / Prompts) now opens with a **movers chart** above its table:
      one track per entity from the earlier scan (hollow marker) to the later one (filled), with the
      signed token change as the label. New file `apps/web/src/features/compare/DeltaMoversChart.tsx`;
      `CompareView` gains one line plus a comment. No wire change, no migration, no new dependency.
      The table is untouched and stays the record — every row, exact figures, search, filters.

      **It renders nothing when nothing changed size**, so a zero-diff comparison looks exactly as it
      did. The card's title is the conclusion (*"workbench_export_bundle moved most — +820 tokens"*),
      and the description is the legend, including the truncation: a chart that silently drops rows
      is a chart that lies.

      **Verified in a real browser, both themes** — and looking is what made it correct. Two defects
      existed in the first cut that no test could have seen, both then fixed and re-measured:
      1. **The chart was clipped.** `DumbbellChart` sizes itself from its own `aspectRatio`, and a
         `ChartCard height` does not shrink an SVG that has already sized itself — so the default
         "2 / 1" drew a **625px** SVG into a ~355px slot and **four of the eight tracks were cut off**
         with no error and no scrollbar. Fixed with an explicit `aspectRatio="3 / 1"` and a card
         height that matches; re-measured at **417px for six rows, no overflow**.
      2. **Long labels were clipped at the START.** The first category label sat at **x = −25**,
         i.e. outside the SVG box — so `workbench_export_bundle` rendered as `bench_export_bundle`,
         losing the part that distinguishes MCP tool names. Fixed with `margin={{ left: 190 }}`;
         re-measured at **x = +25 for every label**.

      The row cap moved **8 → 6** as a consequence, and the constant records that it was measured
      (six tracks land ~66px apart, clear of their own delta labels) rather than chosen by taste.

      **One honest inconsistency, disclosed rather than hidden:** the chart ranks by delta MAGNITUDE
      while the table beneath defaults to the SIGNED delta, so the two disagree about what comes
      fourth. Both orderings are right for their own job, so the description now names the chart's
      ("ordered by size of change, up or down") instead of quietly leaving a reader to notice.

      **Test posture.** 15 new tests assert the decisions — which rows are drawn, the magnitude
      order, the cap, the disclosure wording, and the exact props handed to `DumbbellChart` — against
      a recording stub. `CompareView`'s own suite had to stub the charts package too, because it
      **cannot be loaded** under vitest (`@visx/gradient`'s ESM index deep-import fails to resolve),
      which is the real reason ~40 suites in this app already stub it. So the gate can see the
      chart's props but not its pixels; the pixels were checked by eye and by measurement instead.

      *Fixture note:* the two scans compared were real scans of the workbench's own MCP mount, with
      the later one's per-tool token counts perturbed in a **scratch** database to create deltas. The
      project's own `data/app.sqlite` was never opened.

      *Not done:* no keyboard pass over the chart's datapoint targets.

- [ ] **WP 4.3 — the new flow edges against SkillFlow's canvas.**
      `@elabs-ai/components-flow` gained `FlowWeightedEdge` (with a weight scale and generated ARIA
      labels), `FlowSelfLoopEdge` with real self-loop geometry, `FlowEdgePath`, back-edge detours and
      closest-anchor picking. RM-30 WP 7.8 gave this app's skill canvas five edge **kinds** drawn as
      five dash patterns, and its own ledger records that nobody has ever looked at them in a browser
      — *"whether five dash patterns are distinguishable at real zoom"* is listed as unknown.
      A weighted edge that encodes magnitude, plus proper self-loop geometry, is directly relevant to
      a graph whose whole point is that a file cited four times is one box with four arrows.
      *Acceptance:* a verdict, and if adopted, the dash-pattern legibility question is answered by
      looking rather than left open.

- [ ] **WP 4.4 — `DataTable` row selection and column resizing.**
      `@elabs-ai/components-data` gained a controlled/uncontrolled `rowSelection` slice with a
      ready-made `createSelectionColumn()`, and `enableColumnResizing` with pointer **and** keyboard
      operation (arrow keys in 10px steps, exposed as a WAI-ARIA separator-as-slider with
      `aria-valuetext`). Both compose with the column pinning this app already uses via `lib/table`.
      Candidate surfaces: the runs feed (bulk operations), the scans tool table, the suite matrix.
      *Acceptance:* a verdict; if adopted, keyboard resizing is verified by hand.

- [ ] **WP 4.5 — the two new packages: decide, and mostly decline.**
      `@elabs-ai/components-terminal` and `@elabs-ai/components-process` are new. **Terminal** is
      where the moved `Terminal`/`InteractiveTerminal` now live plus a coding-agent transcript
      vocabulary; this app renders its agent transcripts through `@elabs-ai/components-ai`'s
      conversation components and has no terminal surface, so the expected answer is **no**.
      **Process** is process mining over event logs — a `ProcessMap`, variants, conformance — and it
      is the one layer-3 package. It is a genuine question rather than an obvious no, because this app
      stores `run_steps` with a `parentStepId` hierarchy and RM-17 already built an agent-graph lens
      over exactly that data. Adopting it is a new runtime dependency and needs owner approval.
      *Acceptance:* a written yes/no for each with the reason; no dependency added without approval.

---

## Owner-acceptance (nothing below is verified)

- [ ] The app runs on 4.1.0 and every route renders in **both** themes.
- [ ] The assistant dock: open, close, drag-resize, arrow-key resize, width survives a reload,
      becomes a sheet below 1100px — walked by hand.
- [ ] A keyboard-only pass of the shell: skip link first, past the nav, into `<main>`, into the
      scroll port, into the dock.
- [ ] The active nav item is identifiable **without colour** in both themes after WP 2.5.
- [ ] The model picker still offers the same models, credentials and grouping after WP 1.3, on a real
      signed-in provider.
- [ ] A real MCP tool with a non-trivial input schema runs from the playground after WP 3.1, and one
      with a `$ref` or `oneOf` falls back honestly instead of silently sending less.
- [ ] A decision on the state illustrations (WP 4.1) and on the dock's surface colour (WP 2.3).
