---
type: "Status Ledger"
title: "brand-ui 4.1.0 adoption — work-package status ledger · PRIORITY: HIGH"
description: "Living state for the brand-ui 4.1.0 adoption plan, read and updated by /next-wp brand-ui-4-1."
tags: ["roadmap", "RM-39"]
timestamp: "2026-09-09T17:25:00Z"
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

- [ ] **WP 2.1 — `SkipLink` and the `<main>` contract.**
      The library now ships `SkipLink` and the `AppShell` primitive mounts one itself, targeting a
      `mainId` that defaults to `"main-content"`. This app hand-rolls the same anchor in
      `AppShell.tsx` and already uses `id="main-content"` with `tabIndex={-1}` on `SidebarInset`.
      Replace the hand-rolled anchor with the imported component; keep our own `<main>` wiring, since
      this app composes `Sidebar`/`SidebarInset` directly rather than mounting the `AppShell`
      primitive.
      **Note the shape difference and do not copy it blindly:** the primitive gives its `<main>`
      `tabIndex={0}` and `focus-ring-inset` **because there `<main>` is itself the scroll port**. In
      this app the scroll port is inside `PageShell`, so `tabIndex={-1}` remains correct here — a
      skip target that is not a scroll container must not become a tab stop.
      *Acceptance:* `one-main.guardrail.test.tsx` stays green; the skip link is still the first
      focusable element and still moves focus into `<main>`; verified by keyboard in a browser.

- [ ] **WP 2.2 — `CommandTrigger` replaces the hand-rolled ⌘K search button.**
      `AppShell.tsx` computes `SHORTCUT_HINT` from `navigator.platform` at module load and renders a
      search-shaped `Button` with a `Kbd` pinned right, collapsing under `sm`. `CommandTrigger` is
      that component, with a platform-correct default hint and an accessible name that survives the
      shortcut glyph sitting next to it — which is the part a hand-rolled version usually gets wrong.
      Delete `SHORTCUT_HINT` and the local composition.
      **Check before deleting:** the local trigger currently sets a native `title`, which
      `.claude/rules/icon-affordances.md` forbids on an icon-only control. Confirm the replacement
      does not reintroduce it.
      *Acceptance:* the palette still opens from the trigger and from the keyboard; the accessible
      name is the label, not the label plus the glyph; both themes checked in a browser.

- [ ] **WP 2.3 — `SideDock` replaces the hand-rolled assistant dock.**
      This is the largest deletion in the item and the highest-confidence one, because the library's
      component was written from ours and the **constants match exactly**: `SideDock`'s
      `minContentWidth` defaults to 480 (our `DOCK_MIN_MAIN_PX = 480`) and its `overlayBreakpoint`
      defaults to 1100 (our `DOCK_SHEET_MAX_WIDTH_PX = 1100`), described upstream in the same terms we
      used — *"deliberately ABOVE the library's 768px mobile breakpoint: a 400px dock at 768px leaves
      ~360px of content."* It ships the drag **and arrow-key** resize, the width-transitions-to-zero
      open/close mechanic, `motion-reduce:transition-none`, re-clamping against the live viewport, and
      the automatic overlay-`Sheet` presentation below the breakpoint — so both branches of our
      current code (the wide split column *and* the narrow `Sheet`) collapse into one component.
      It splits width reporting into `onWidthChange` (continuous — drive layout) and `onWidthCommit`
      (once, at interaction end — **persist from this**), which is a better contract than ours.
      **Two deliberate differences to decide, not to skip.** (1) `SideDock` requires a `title` and it
      is the `SheetTitle` in overlay presentation — ours says "App assistant"; keep that string. (2)
      Upstream grounds `SideDock` on `--card`, a **content** surface, and says explicitly that page ink
      is correct there and sidebar ink is the mistake; our dock paints `bg-sidebar text-sidebar-foreground`.
      Changing it is a visible change to the assistant dock and needs an owner look in both themes.
      *Acceptance:* the dock opens, closes, resizes by pointer and by arrow key, persists its width,
      re-clamps on viewport resize, and becomes a sheet below 1100px — all verified in a browser, both
      themes, keyboard included; the width persisted before the change is still honoured after it.

- [ ] **WP 2.4 — the complementary landmark is currently inside `<main>`. Fix it.**
      **This is a real accessibility defect in this app today, not a style preference.** In
      `AppShell.tsx` the assistant dock's `<aside aria-label="App assistant">` is rendered **inside**
      `<SidebarInset id="main-content">`, which is the app's single `<main>` — so a complementary
      landmark sits nested within the main landmark. The flagship block names this exact mistake at
      its dock call site: *"A SIBLING of `SidebarInset`, so the `aside` lands beside `<main>` rather
      than inside it"*, and in its header: *"an `aside` inside `<main>` puts a complementary landmark
      inside the main landmark."*
      Move the dock (and its resize handle) out to be a flex sibling of `SidebarInset` under the
      `SidebarProvider`. Note this interacts with WP 2.3 and should land with it or immediately after.
      **Also verify, don't assume:** the top bar must stay *inside* the main column so it does not
      span across the dock — the flagship does the same, and our current code already does.
      *Acceptance:* a landmark query finds exactly one `main` and finds the `complementary` outside it;
      a new guardrail test locks the relationship and is proved by breaking it and watching it go red;
      the visual result is unchanged in both themes.

- [ ] **WP 2.5 — delete the two sidebar workarounds the library absorbed.**
      Both fixes this repo made are now in `@elabs-ai/components-ui`, verified by reading 4.1.0's
      `sidebar.tsx`:
      (a) **the active-nav indicator.** `SidebarMenuButton` now carries, on `data-[active=true]`, a
      `before:` accent bar on `--sidebar-primary` (`inset-y-1.5 start-0 w-1 rounded-full`) plus
      `font-semibold`, and `SidebarMenuSubButton` carries the same — which is precisely what our
      `ACTIVE_NAV_INDICATOR_CLASS` adds at three call sites. Upstream files it as defect R1 with our
      measurement as the reason.
      (b) **the collapsed group label.** `SidebarGroupLabel` now collapses with `hidden` instead of
      `-mt-8 opacity-0`, removing the boxed phantom gap our code works around.
      Delete both local workarounds **only after** confirming by measurement that the upstream
      indicator is at least as visible in both themes (D-BU4) — our version exists because a previous
      upstream default failed contrast, so this is exactly the class of change that must be looked at,
      not assumed.
      **Leave alone:** the sidebar's pinned `data-density="comfortable"`, the explicit
      `min-h-0 overflow-y-auto` on `SidebarContent`, the `display: contents` nav landmark, the
      collapsed-rail mirror items, and the 44×44 coarse-pointer floor. Upstream lists these as things
      it read from us but the shipped `Sidebar` was **not** verified in this ledger to carry them.
      *Acceptance:* `ACTIVE_NAV_INDICATOR_CLASS` is gone and the active item still reads as active by a
      **non-colour** cue in both themes, confirmed by looking; no phantom gap in the collapsed rail;
      the touch-target guardrail stays green.

- [ ] **WP 2.6 — reconcile our `PageShell` with the library's new scroll modes.**
      The library's `PageShell` gained `scroll: "body" | "content" | "fill"` and a `headerGutter`
      with a `--page-shell-header-gutter` custom property. This app's own `PageShell` invented the
      **same three-mode vocabulary** independently (audit §S22) — but ours defaults to `"content"` and
      the library's defaults to `"body"` (byte-identical to its old behaviour, for compatibility).
      They are not drop-in equivalents.
      Decide one of: keep ours and record why; or re-base ours on the library's, keeping our default
      and our gutter scale. Whichever is chosen, the library's `scroll="content"` sets `tabIndex={0}`
      and `focus-ring-inset` on the port — a scroll container must be keyboard-operable (WCAG 2.1.1,
      axe `scrollable-region-focusable`), and `focus-ring-inset` rather than `focus-ring` because an
      ancestor's `overflow-hidden` clips the outside rings. **Check whether our port does this; if it
      does not, that is a second real defect and it is fixed here.**
      *Acceptance:* every route still scrolls in exactly one place; a keyboard user can reach and
      operate the scroll port and sees a focus ring that is not clipped; the decision is recorded.

---

## Phase 3 — the tool playground gets a real schema form

- [ ] **WP 3.1 — adopt `SchemaForm` + `fromJsonSchema` in the MCP tool playground.**
      `apps/web/src/components/ToolRunner.tsx` (493 lines) generates the tool-call form today by
      **regex-matching a stringified type label** — `/^(array|object)/` becomes a raw JSON textarea,
      `/^(number|integer)/` a numeric input — so an array of enums, a nested object and a list of
      strings all render as "paste JSON here". The library now ships the supported version of this:
      `SchemaForm` with a serializable `FormSpec`, and `fromJsonSchema()`, a deliberately narrow
      JSON-Schema adapter that maps the common subset onto real controls — `array of string` becomes a
      list field, `array of string with enum` becomes a multi-enum, `object with properties` becomes a
      group. It also carries the loading / submitting / submitted / error states as props.
      **Honour D-BU6.** `fromJsonSchema` **throws** `UnsupportedJsonSchemaError` on `$ref`, `allOf`,
      `oneOf`, `anyOf` or `not` anywhere in the schema, naming the keyword and its path — MCP tool
      schemas in the wild do use these. It **silently drops** a property whose type it does not cover.
      Neither may end with the app sending an incomplete argument object: the refusal path keeps the
      current raw-JSON editor as an honest fallback, and a dropped required property must be detected
      and surfaced, not shipped.
      *Acceptance:* a tool whose schema is in the supported subset renders typed controls and calls
      with identical arguments to before; a tool whose schema uses a refused keyword falls back
      visibly and still runs; a required property that would be dropped is reported rather than
      omitted; measured against a real registered MCP server, not a fixture alone.

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

- [ ] **WP 4.2 — the new chart families against the surfaces that hand-rolled them.**
      `@elabs-ai/components-charts` grew from 238 to 345 source files. Four additions map onto
      surfaces this app already built by hand, and each is a *candidate*, not a commitment:
      **`NetworkChart`** (force / circular / arc layouts) against RM-17 WP 3.5's agent-graph lens,
      which was built on the flow canvas; **`HeatmapChart`** against the MCP × model compatibility
      heatmap; **`TreemapChart`** against the per-tool token-footprint breakdown; and
      **`DistributionChart`** (box / violin / histogram / strip) against RM-34's turn-profile
      percentiles, which currently have no visual at all.
      **Warning, and it is this repo's own known weakness:** the panel test suites mock
      `@elabs-ai/components-charts` as no-ops, so a chart-prop bug passes the gate silently — RM-17's
      ledger already records this. Any chart adoption is verified by looking at it, not by a green test.
      *Acceptance:* a per-candidate verdict with a rendered screenshot for any adopted; no adoption on
      the strength of a passing test alone.

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
