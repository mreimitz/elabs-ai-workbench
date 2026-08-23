---
type: "Work Package Spec"
title: "Owner acceptance — the one consolidated checklist (WP 1.6)"
description: "Every pending owner-acceptance check across every roadmap ledger, grouped into four sittings by the one credential each needs."
tags: ["roadmap", "RM-18"]
timestamp: "2026-08-23T09:20:00Z"
status: "final"
---
# Owner acceptance — the one consolidated checklist (WP 1.6)

**192 pending owner-acceptance boxes, drawn from 23 files, worked as 193 checks grouped into four
sittings by the one thing each sitting needs before it can start.** (One box — RM-08's WP M.4 — is
worked in two halves, in different sittings; hence 193 checks for 192 boxes.) Assembled 2026-08-21
by RM-18 WP 1.6, driven as RM-35 WP 1.1.

> **One box closed since assembly: 191 open as of 2026-08-23.** RM-20's "the bench's own MCP mount
> scores 49 / high risk" (block A9, box 4 of 10) was closed by the owner — the mount measures
> 24 tools / 0 findings / 100 `clean`, and the recorded pair was transposed. **The totals below are
> the assembly figures and are deliberately left as assembled**; subtract closed boxes rather than
> rewriting them, so the arithmetic stays checkable against the date it was measured.

Thirteen roadmap items are code-complete, gate-green and on `main`, and cannot be retired because
`/complete-roadmap` refuses while any ledger box is open — and their only open boxes are these.
This file is the one place to work them.

---

## How to use this

- **This is preparation only. The walks stay owner-only.** Nothing here was run. No check below has
  been verified by an agent; the assembly verified only that each check corresponds to a real,
  currently-open box in a real ledger, and that every URL cited resolves against
  `apps/web/src/App.tsx`.
- **Ticking a box here does NOT tick the source ledger.** Every check carries a `Ledger:` line naming
  the file, the section and the box it satisfies. After a sitting, the owner (or a later `/next-wp`
  batch) copies the outcome into that ledger box — that is what unblocks `/complete-roadmap`.
- **Each sitting has exactly one entry condition.** A check is filed under the sitting matching its
  own *strictest* prerequisite, not its item's. That means a few items appear in more than one
  sitting (RM-08 spans three); each item's header says where the rest of it went, so nothing is lost.
- **Extra, non-credential setup** (a scanned MCP server, a GitHub PAT, a deliberately broken server)
  is called out per check as `Setup:`. Shared fixtures are in *Before any sitting*, below.
- **Do not count the checkboxes here and expect 192.** Two blocks (**B10** and **B12 §6**) keep their
  own walk file's structure and group several source boxes under one line, because splitting them
  would break a script that reads as one pass. The per-item counts in the section headers and the
  *Tally* are the source-box numbers; those are what map onto the ledgers.
- **Read the two "corrections" appendices before Sitting A.** Several ledger boxes were written
  against a UI that has since moved; a handful are currently **impossible to run** because the
  surface they name is parked. Those are marked ⛔ inline, so no sitting is spent hunting for a tab
  that does not render.

### Which URL to use

| Instance | URL | Use it for |
| --- | --- | --- |
| **The container** (`docker compose up -d --build`) | **`http://localhost:8081/`** | **Everything below, unless a check says otherwise.** `docker-compose.yml` publishes `127.0.0.1:8081 → 8080`. |
| Dev (`pnpm dev`) | web `http://127.0.0.1:5173`, API `http://127.0.0.1:8080` | Only where a check needs a hot-reload loop. Vite proxies `/api` → `:8080`. |

> ⚠️ **Port 8080 on this machine is not this app.** A separate, older checkout
> (`qlabs-ai-benchmark/mcp-token-footprint`) runs its own long-lived container on `127.0.0.1:8080`
> with its own data — see the note at the top of `docker-compose.yml` — and a stale dev server has
> also been observed holding it. **Several ledger boxes say `localhost:8080` or
> `http://127.0.0.1:8080/api/mcp`; on this machine those addresses reach the wrong application.**
> Substitute `8081` everywhere, and if a check genuinely needs the dev API on `:8080`, free the port
> first and confirm the page you are looking at is this build.

### The two cross-cutting passes

Almost every visual check below asks for the same two passes. Do them once per surface, not once per
box:

- **Both themes** — the theme control is in the **top bar** (mirrored in **Settings › General**,
  `/settings/general`). Switch `light` → `dark` and re-look at the same surface. `light` carries a
  deliberate app-side focus-ring token override; a missing focus ring in `light` is a regression, not
  a theme quirk.
- **Keyboard only** — `Tab`/`Shift+Tab` to move, `Enter`/`Space` to activate, `Esc` to close. Every
  interactive element reachable, with a **visible focus ring** at every stop.

---

## Before any sitting — the fixtures

None of these are ledger boxes. They are the state the checks assume.

- [ ] **The container is up and is this build.** `docker compose up -d --build`, then
      `http://localhost:8081/` → the dashboard renders. (The image was unbuildable for a period until
      2026-08-21 — four missing `COPY` lines for `apps/cli` and `packages/illustrations`, fixed
      during RM-14's Phase 0 acceptance. No gate builds the image, so confirm the build actually
      succeeded rather than assuming.)
- [ ] **At least one MCP server registered and scanned** — `/servers` → **Add server** → run a
      discovery scan. Needed by: RM-20 (all 10), RM-22 Phases 5/8, RM-26 WP 5.4, RM-08 WP M.3/3.1,
      RM-04 §4a, RM-13 §1.
- [ ] **At least one skill registered** — `/skills` → **Add skill** (upload a `.zip`/`SKILL.md`, or
      import from GitHub). Needed by: RM-20 (skill analyzer), RM-22, RM-23, RM-24.
- [ ] **Recorded runs exist.** Most run-console, report, compare and rating surfaces read persisted
      runs and need no live spend. The owner's database already carries ~163 runs (recorded during
      RM-33). Confirm at `/testing/runs`.
- [ ] **A second scan of the same server** (re-scan after any change) — needed by RM-20's diff box
      and RM-08 WP 3.1.

---

## What is NOT in here, and why

| Item | Open boxes | Why excluded |
| --- | --- | --- |
| **RM-25** team-server | 1 | Never started (0 of 6 WPs). The box is forward-looking acceptance for software that does not exist — there is nothing to walk. |
| **RM-18** platform (this item) | 1 | Same: its box covers WP 1.1's demo seed and WP 1.3's diagnostics bundle, neither of which is built (0 of 6 WPs done before this one). |
| **RM-14** illustrations | 3 | The three open boxes accept **Phases 2, 3 and 4**, which are not built (Phase 1 completed 2026-08-21; Phases 2–4 open). Phase 0's box was accepted 2026-08-21. Nothing to walk yet. |
| **RM-35** roadmap-cleanup | 6 | Five ARE these four sittings (WP 2.1–2.4) plus the retirement pass (WP 2.5); the sixth is the meta "the roadmap lists only live work" sign-off. Including them would be circular. |
| **RM-17** observability | 0 | Its Owner-acceptance section is **prose bullets, not checkboxes**, so `/complete-roadmap` is not blocked by it. Listed in Appendix 1 so the pending walks are not lost. |
| **RM-34** estimator | 0 | Its Owner-acceptance section is an empty placeholder. |
| `completed/` **RM-21**, **RM-28** | 0 | Retired, with prose-only pending walks and no checkboxes. Appendix 1. |
| `completed/` **RM-33** | 0 | All five boxes ticked 2026-08-21, each with a recorded "still owner's to judge" rider. Appendix 1. |

**Two retired items ARE included, deliberately.** `completed/RM-04-assistant-hub-ux` and
`completed/RM-13-hub-fixes` were retired with their ledgers clean, but each travels with an
`owner-acceptance-walk.md` carrying real, **never-run** checkboxes — RM-13's says in its own words
*"Nothing below is verified."* They block nothing, and they are exactly the verification that would
otherwise be lost. They are marked **🗄 RETIRED — verification outstanding**.

---

# Sitting A — browser only

> **Entry condition: a browser and the running container. No API key, no subscription, no pipeline.**
> **39 checks across 10 items.** Clears **RM-01 · RM-05 · RM-20 · RM-22 · RM-24(P1) · RM-26(5.4) ·
> RM-27 · RM-30(1/2) · RM-32** and 7 of RM-08's 13 boxes.

---

## A1 · RM-01 — Advisor (1 check)

`Ledger: planning/Roadmap/RM-01-advisor/STATUS.md › "Owner acceptance (owner-only)"`

- [ ] **An unused-tool trim that is actually believable.** Open `http://localhost:8081/advisor` —
      the bare route renders the **fleet** report with zero query params; scope it with
      `?scope=&id=`. Find an *unused-tool trim* recommendation. Follow each of its evidence links.
      Then apply the trim by hand on the real server (remove/disable the named tools), re-scan it,
      and compare the new footprint against the advisor's predicted saving.
      *Expect:* every evidence link resolves to a real scan/run; the re-scan moves the token total in
      the **direction** the advisor predicted (magnitude need not match). Both themes.
      *Setup:* ≥1 registered, scanned server with runs against it.
      *Ledger:* box 1 of 1 — "A real scenario shows an unused-tool trim with believable token
      savings…".
      *Note:* RM-35 WP 2.5 records that **RM-01 has no documentation subject**, so retiring it also
      needs `/new-docu` (or folding into DC-11) — not part of this walk.

---

## A2 · RM-27 — Testing IA consolidation (1 check)

`Ledger: planning/Roadmap/RM-27-testing-ia/STATUS.md › "Owner acceptance (owner-only)"`

- [ ] **The whole Testing IA, in one pass, both themes.** Six things in sequence:
      1. **Nav is 4 + Setup.** The Testing nav group shows four peers plus a **Setup** group.
      2. **The four redirects land.** Type each and confirm the URL rewrites:
         `/testing` → `/testing/collections` · `/testing/scenarios` → `/testing/environments` ·
         `/testing/compare` → `/testing/runs/compare` · `/testing/runs/review` → `/testing/review`.
      3. **Collection-as-home.** `/testing/collections` shows **Local** (undeletable, pinned first,
         no Delete action); a test lives in a collection.
      4. **Launcher, both paths.** Path 1: run a **saved suite**. Path 2: an **interactive** ad-hoc
         plan, then **Save as suite** — confirm the saved suite then appears in the list.
      5. **Run a collection** end-to-end.
      6. **Runs feed drill.** `/testing/runs` → a suite-run **summary** row → its **member list** →
         **drill into one session** (`/testing/runs/:runId`). Then the **rename spot-check**:
         UI labels read *Environment*, while the URL and wire still say `scenario`.
      *Expect:* each step lands where named; nothing dead-ends; both themes legible.
      *Setup:* a saved suite and a collection with ≥1 test.
      *Ledger:* box 1 of 1 — "Walk the running app (both themes): nav 4 + Setup; 4 redirects…".
      ⚠️ **The box says "4 redirects" but names none.** The set has since changed: design-remediation
      T8 **deleted** `/testing/tests → collections` and `/testing/suites → collections`, made
      `/testing/suites` a real route, and added `/testing/runs/review → /testing/review`. The four
      above are the four that exist in `App.tsx` today. `/testing/tests` correctly falls through to
      the 404.

---

## A3 · RM-05 — Assistant operability (2 checks)

`Ledger: planning/Roadmap/RM-05-assistant-operability/STATUS.md › "Owner acceptance (owner-only)"`

- [ ] **The dock is context-aware on `/assistant/agents`, and still global on `/dashboard`.**
      Open `http://localhost:8081/assistant/agents`, open the right-hand **App assistant** dock on a
      fresh thread. *Expect:* the empty-state starter chips are **agent/crew** chips — **not** "Most
      expensive server / Token savings / Recent failures". Click **"Rank my agents by token & cost"**
      → a real answer, produced via the hub read tools. Then open `/dashboard` → the **global** chips
      return. Then an entity page (`/servers/:id`) → unaffected. Both themes.
      *Setup:* the **Assistant** feature flag must be **on** (`/settings/features`); ≥1 agent and
      ≥1 crew must exist, or the chips have nothing to rank.
      *Ledger:* box 1 of 2 — "On the running app, `/assistant/agents` dock empty-state shows the
      agent/crew chips…".
      *Note:* answering a chip runs a model turn — if that requires a configured credential in your
      setup, do this half in **Sitting B** and record it there.
- [ ] **The gate actually bites.** Two deliberate breakages, each reverted after:
      1. Add `<Route path="/zzz" element={<div />} />` to `apps/web/src/App.tsx` with **no**
         `ASSISTANT_ROUTE_MANIFEST` entry → `pnpm test` must fail **Test A** ("App.tsx routes with NO
         manifest entry").
      2. Add a manifest entry with `surface: "global"` and **no** `exempt` → must fail **Test B**.
      Then add a real surface (or a reasoned exemption) and confirm the gate goes green.
      *Expect:* red, red, green — a *failure*, not a warning.
      *Ledger:* box 2 of 2 — "The gate fails when a bogus `<Route path="/zzz">` is added…".
      *Note:* this is the one check in Sitting A that touches source; revert both edits.

---

## A4 · RM-24 — Skills registry & inspector, Phase 1 (1 check)

`Ledger: planning/Roadmap/RM-24-skills/STATUS.md › "Owner acceptance (deferred visual / a11y…)"`
*Phase 2's box needs a real run — filed under **B5**.*

- [ ] **Phase 1 (WP 1.6–1.9) — the registry, the wizard, the inspector, both themes + a11y.**
      `http://localhost:8081/skills` → the overview grid; **Add skill** wizard (all sources: upload
      a `.zip`, a lone `SKILL.md`, GitHub import); a skill detail `/skills/:skillId` and its tabs —
      **Overview**, **Files**, **Versions**, **Diff**. Then a `docker compose up --build` round trip
      and confirm the registered skills survive it.
      *Expect:* every tab readable in both themes, keyboard-reachable with visible focus; the wizard's
      errors are inline and loud; the Diff tab renders a full-tree diff between two versions.
      *Setup:* ≥2 versions of one skill so Versions/Diff have something to show.
      *Ledger:* box 1 of 2 — "Phase 1 (WP 1.6–1.9) — two-theme visual + a11y walk…".
      ⚠️ The box says `@ localhost:8080`. Use **8081**. It also names the tab set
      "Overview / Files / Versions / Diff"; the inspector today shows **Overview · Files · Quality ·
      Usage · Issues · Security · Versions · Diff** (Design and Trace are parked — see Appendix 2).

---

## A5 · RM-26 — Testing, WP 5.4 (1 check)

`Ledger: planning/Roadmap/RM-26-testing/STATUS.md › "Owner acceptance (deferred visual / a11y / e2e…)"`
*WPs 3.1, 4.1 and 4.4 need live runs — filed under **B7**.*

- [ ] **WP 5.4 — the compatibility heatmap, both themes.** `http://localhost:8081/testing/compatibility`.
      *Expect:* the MCP × model heatmap renders; the cell colours are distinguishable in **both**
      themes and are not the only carrier of meaning (a cell's state must also be readable from its
      label/value); over/under-limit cells are unambiguous.
      *Setup:* ≥1 scanned server (the heatmap is derived from `GET /api/scans/:id/heatmap` — it needs
      a scan, not a run).
      *Ledger:* box 4 of 4 — "WP 5.4 — compatibility heatmap two-theme visual acceptance".

---

## A6 · RM-30 — UX overhaul, the structural walk (1 of 2 checks)

`Ledger: planning/Roadmap/RM-30-ux-overhaul/STATUS.md › "Owner-acceptance (live, by the owner — mirrors phase-5 checklist)"`
*The second box is provider-key-only — filed under **B11**.*

- [ ] **Two-theme walk · keyboard pass · shell walks · compare-workspace decision · sign-off.**
      One pass over every view, checking the six invariants the programme shipped:
      one **page shell** (`PageShell`/`PageHeader` + the S22 scroll contract — the frame fills the
      viewport and the *inner* region scrolls, never the whole page); one **tab shell** (`TabPanel`,
      a stable strip that does not reflow); one **status vocabulary** (`StatusBadge`); one **modal
      system** (four dialog tiers); one **form kit**; one **table recipe** (sticky header, pinning).
      Then the **Compare Workspace** (`/compare/scans` and `/testing/runs/compare`): letter-chip run
      identity held in the URL, the Summary Δ-matrix + verdict sentences, the Flow LCS trace-diff and
      its lenses, the lossless drill drawer, change markers + next steps, suite compare.
      **The decision this box asks for:** does the rebuilt Compare Workspace do what you need, now
      that the efficiency radar is deleted? Record yes/no.
      *Expect:* no view scrolls at the outer frame; no tab strip reflows on selection; both themes.
      *Setup:* two scans of the same server (scan compare) and two recorded runs (run compare).
      *Ledger:* box 1 of 2 — "Two-theme walk · keyboard pass · shell walks · compare-workspace
      decision walk · sign-off + merge to main".
      ℹ️ The box ends "…+ merge to main". The `ux/integration` branch **no longer exists locally**
      and its code is present on `main` (`apps/web/src/components/TabPanel.tsx`, the Compare
      Workspace route). Treat the merge clause as already satisfied and verify by looking, not by
      merging.

---

## A7 · RM-32 — Overview → Detail (8 checks)

`Ledger: planning/Roadmap/RM-32-overview-detail/STATUS.md › "Owner-acceptance (pending — owner-run; **this is what blocks retirement**)"`

All eight are `/servers` unless stated. Do all eight in **both** themes.

- [ ] **1 · `/servers` cold-load is the overview, not a redirect.** Open
      `http://localhost:8081/servers` in a fresh tab.
      *Expect:* a grid of every server **grouped by type** — the URL stays `/servers`. It must **not**
      bounce to `/servers/<whichever-sorted-first>`.
      *Ledger:* box 1 of 8.
- [ ] **2 · Grid ⇄ table, and the URL wins.** Toggle grid ⇄ table.
      *Expect:* same groups, same order in both modes; reload the page and the mode survives (stored
      preference); then load `/servers?view=grid` while the stored preference is `table` — **`?view=`
      beats the stored preference**. An unrecognised `?view=` value is ignored, not an error.
      *Ledger:* box 2 of 8.
- [ ] **3 · Search, both modes, and the zero-match state.** Type in the overview search.
      *Expect:* it filters in **both** grid and table; groups that end up empty **disappear** rather
      than rendering as empty headers; a query matching nothing shows a state offering **Clear**.
      *Ledger:* box 3 of 8.
- [ ] **4 · A card opens a full-width detail.** Click a server card.
      *Expect:* `/servers/:serverId` renders with **no left rail** — the detail spans the window. The
      old 288px `ServerRail` is gone.
      *Ledger:* box 4 of 8.
- [ ] **5 · The breadcrumb leaf is an entity switcher.** On the detail, click the **last** breadcrumb
      crumb.
      *Expect:* a popover listing **every** server, grouped and searchable; picking one navigates to
      it; **"View all →"** and the parent crumb both return to `/servers`.
      *Ledger:* box 5 of 8.
- [ ] **6 · Keyboard only.** Put the mouse down on `/servers`.
      *Expect:* **one** tab stop per card (plus its own actions — not one stop per field); `Enter`
      opens the card; the focus ring is visible in **both** themes, including `light`.
      *Ledger:* box 6 of 8.
- [ ] **7 · The same walk on `/skills` and `/testing/collections`.** Repeat 1–6 on
      `http://localhost:8081/skills` (grouped by **source**) and
      `http://localhost:8081/testing/collections`.
      *Expect:* identical behaviour; on collections, **Local** is pinned first and has **no Delete**.
      *Ledger:* box 7 of 8.
- [ ] **8 · Below 768px.** Narrow the window under 768px on `/servers`.
      *Expect:* the removed mobile rail **Sheet** is gone (no leftover drawer affordance) and the
      overview still reads — cards stack, search still reachable.
      *Ledger:* box 8 of 8.

---

## A8 · RM-22 — Skill IDE (7 checks, 2½ currently blocked)

`Ledger: planning/Roadmap/RM-22-skill-ide/STATUS.md › "Owner acceptance (deferred visual / a11y — owner-only)"`

> ⛔ **Read this first.** The skill inspector's **Design** and **Trace** tabs are **hidden** by owner
> decision **O2b** — `SkillInspector.tsx`'s `requestTabChange` rewrites `design`/`trace` to `files`,
> and an effect bounces a deep link the same way. Un-parking them is **RM-30 Phase 7** (Skill
> Studio), which is not built. Every check below that names the **canvas**, **flow lanes**, a
> **`tool_ref` node card**, or **Show flow | Show code | Split** is therefore **not runnable today**.
> Do not spend the sitting looking for them; record them as blocked-on-RM-30-Phase-7 instead.

- [ ] ⛔ **Phase 1–2 — flow lanes, canvas command CRUD, drag-connect.** *Not runnable.* The box asks
      for "a multi-command skill's flow lanes, command create/delete **on canvas**, **drag-connect**
      to an asset, save → clean SKILL.md diff". The canvas is the parked Design tab.
      *Runnable half:* the **"save → clean SKILL.md diff"** end can be checked from the **Files** tab
      — edit `SKILL.md`, save a new version, open **Diff** and confirm the diff is minimal and
      preserves hand-written prose.
      *Ledger:* box 1 of 7 — record as **blocked (O2b)**, not as failed.
- [ ] **Phase 3 — folder/file round trip including move + edit.** `/skills/:skillId?tab=files`.
      Create a folder, create a file in it, edit it, **move** it to another folder, delete one, save.
      *Expect:* the tree updates live; save produces exactly one new immutable version; the Diff tab
      shows the moves as moves.
      *Ledger:* box 2 of 7.
- [ ] **Phase 4 — quality score + an applied fix.** `/skills/:skillId?tab=quality`.
      *Expect:* a quality score with itemised findings; applying a suggested fix changes the score in
      the right direction and produces a clean diff.
      *Ledger:* box 3 of 7.
- [ ] **Phase 5 — a broken tool reference flagged against a real server's scan.** Bind the skill to a
      registered server (the **Servers** card on the skill **Overview** tab, or the compact strip on
      **Files** — `SkillBindingsPanel`), then reference a tool that does **not** exist on that
      server's newest successful scan.
      *Expect:* the Files editor shows a validation marker naming the unknown tool; a valid tool does
      not fire.
      *Setup:* a registered, **scanned** server.
      *Ledger:* box 4 of 7.
      ℹ️ The binding UI is on **Overview**/**Files**, not the parked Design tab's Tools palette — it
      was moved there in the 2026-07-12 reachability fix recorded in `completed/RM-21-server-types`.
- [ ] **Phase 6–7 — collision report, and publish → pull back.** The **trigger collision report** is
      the footer of the `/skills` overview (it renders only when ≥1 skill exists). Then, from a
      skill detail, use the header's **Publish to GitHub** action (version-scoped, **unbound** skills
      only) to create a fresh repo, then **pull** it back as a new version.
      *Expect:* the collision report names real overlapping triggers; the published repo contains the
      version's tree; the pull creates a new version whose diff is empty (or explains itself).
      *Setup:* **GitHub credentials** (`/settings/github`) and permission to create a repo — the one
      check in Sitting A needing an external account.
      *Ledger:* box 5 of 7.
- [ ] ⛔/**partial** **Phase 8 — server-bound authoring.** Four claims, of which two are runnable:
      - ✅ **Completion + hover show real tools with token costs** — in the **Files** `SKILL.md`
        editor of a server-bound skill. *Expect:* completing a tool name offers the bound server's
        real tools, and the hover popup carries each one's scan-measured token cost.
      - ✅ **Test-run a real tool from the hover popup** — the inline tool-runner `Sheet` is hosted at
        the inspector precisely so **Files** can open it (WP 8.5). *Expect:* a destructive-annotated
        tool asks for confirmation first; the result and its measured request/response tokens render.
      - ✅ **Scaffold a new skill from the server** — the Add-skill wizard's *From server* tile
        (`ScaffoldFromServerWizard`). *Expect:* the scaffolded skill projects the server's tools.
      - ⛔ **Drag a tool onto a section → a `tool_ref` node + clean diff**, and **test-run from a
        `tool_ref` node card** — both are canvas-only. Not runnable.
      *Setup:* a registered, scanned server; a skill bound to it.
      *Ledger:* box 6 of 7 — tick only if you record the two blocked claims explicitly.
- [ ] ⛔ **Phase 9 — the unified Flow | Code | Split round trip.** *Not runnable.* The box's entire
      subject ("edit on canvas → Show code → edit text → Show flow → split view syncs selection both
      ways → one Save, one version; hovers/legend; problems panel deep-links node + line") is the
      parked Design surface.
      *Ledger:* box 7 of 7 — record as **blocked (O2b)**.

---

## A9 · RM-20 — Security posture (10 checks)

`Ledger: planning/Roadmap/RM-20-security-posture/STATUS.md › "Owner acceptance (owner-only)"`

Six of these are **judgement calls**, not looking. Budget them separately. Order below is
cheapest-first, which is **not** the ledger's order — the `Ledger:` line gives the real box.

- [ ] **The two-theme, keyboard walk, in YOUR browser.** Open a scan's Security tab —
      `http://localhost:8081/scans/:scanId?tab=security` — and a skill's —
      `/skills/:skillId?tab=security`. Pick a **baseline** on each (the picker inside the tab). Then
      look at the **server posture badges** on the overview.
      *Expect, specifically the three things worth your eye:* (1) the **evidence cell** — invisible
      characters must be *visible* as `\uXXXX`, and credential-shaped values masked; (2) the
      **clean-subject** and **"nothing changed"** states must read as *answers*, not as emptiness;
      (3) the **focus ring on the new controls in `light`**, where this app carries a deliberate token
      override.
      *Ledger:* box 3 of 10 — "WP 2.1 — the two-theme, keyboard walk, in YOUR browser."
      ⚠️ The box says "check the **servers rail** badges". **There is no servers rail** — RM-32
      deleted it. The posture badge now renders on the **`/servers` overview** cards and as a
      sortable `posture` column in table mode (`ServersOverview.tsx`), fed by one fleet-wide request.
      Look there.
      ℹ️ Honest provenance from the ledger: the implementing agent walked both themes with
      screenshots and measured contrast (worst 4.59:1, all AA); **the orchestrator did not look at
      the app at all.**
- [ ] **Read one exported document yourself.** `/scans/:scanId` → export the scan report as
      **Markdown**, for a server **with findings**. Then do the same for a server whose scan
      **failed**.
      *Expect:* the first carries the score, the per-severity counts and the redacted evidence; the
      second says `Not analysed: … — unmeasured, not clean` and **still** carries its token
      footprint.
      *Ledger:* box 2 of 10 — "WP 2.2 — read one exported document yourself."
      ℹ️ "The agent read all three states by eye and judged them correct; nobody else has."
- [ ] **The false-positive rate on YOUR real servers.** For **every** server you have actually
      registered, call `GET /api/scans/:scanId/security` (or open the Security tab) and read the
      findings.
      *Expect / the actual question:* not "did it find the poisoned one" but **"how many of these
      would I roll my eyes at?"** Anything that fires on an honest server is a **matcher to tighten**
      (WP 1.2's near-miss fixtures are where the tightening goes), **not a severity to lower**.
      *Ledger:* box 8 of 10 — "WPs 1.1–1.2 — the false-positive rate on YOUR real servers."
      ℹ️ The eleven heuristics were reviewed against fixtures, **never against a corpus of real
      third-party MCP servers**.
- [ ] **The false-positive rate on YOUR real skills, and the two narrowings.** Call
      `GET /api/skills/:id/versions/:vid/security` for the skills you have registered.
      *Two judgement calls to confirm:* (1) a **bare HTML comment** in a `SKILL.md` does **not** fire
      — only one carrying a payload does; (2) the credential rule reports **prefixed shapes only**,
      so a committed key in an unusual format is **missed** rather than a sha being reported. Also
      see once that a payload hidden inside an HTML comment fires **two** rules at once (−30).
      *Ledger:* box 6 of 10 — "WP 1.3 — the false-positive rate on YOUR real skills…".
- [ ] **The diff on YOUR own history, and the four refusals.** Pick a server scanned more than once:
      `GET /api/scans/:scanId/security/diff?baseline=<an older scan of the same server>`. Then the
      same for two versions of one skill:
      `GET /api/skills/:id/versions/:vid/security/diff?baseline=<older vid>`.
      *Expect:* `added` / `resolved` / `unchanged` match what you believe actually changed. Then
      deliberately trigger the **four refusals** — a baseline from a **different server**, a
      **server-vs-skill** pair, an **analyzer-version mismatch**, and a **truncated** report — and
      judge whether each reads as *helpful* rather than obstructive.
      *Setup:* two scans of one server; two versions of one skill.
      *Ledger:* box 5 of 10 — "WP 1.4 — the diff on YOUR own history, and the four refusals."
- [ ] **A deliberately poisoned fixture server.** Stand up a server carrying injection phrasing **+**
      a secret-shaped parameter **+** a contradictory annotation (e.g. `readOnlyHint: true` on a
      `delete_*`). Scan it. Then compare against a clean server, and diff the poisoned server before
      and after the poison.
      *Expect:* the expected findings appear with readable evidence in **both** themes; the clean
      server scores clean; the diff shows a finding **appearing** and then **resolving**.
      *Setup:* a server whose tool definitions you can edit. Shared with RM-08 WP 3.1 (**A10**) —
      build it once and use it twice.
      *Ledger:* box 10 of 10.
- [ ] **DECISION — D-SP9, the one decryption-path touch.** Read
      `OAuthRepository.listGrantedScopes` (28 insertion-only lines): it reads the encrypted OAuth
      blob and returns granted scope **names** so `oauth.broad-scope` can judge them —
      `string[] | null`, no access token, refresh token, client secret, expiry or id, with a test
      asserting a stored access token appears nowhere in a serialized report.
      *The decision:* is publishing **scope names** in a posture report a line you want crossed?
      *Ledger:* box 9 of 10.
- [ ] **DECISION — D-SP15, the skill analyzer's read boundary.** The skill analyzer reads only the
      version row, the file list and `SKILL.md`. A credential or an instruction payload committed
      into a **helper script** or an **L3 resource file** is **not** scanned today.
      *The decision:* is that bound where you want it, or should widening it be the next skill rule?
      *Ledger:* box 7 of 10.
- [ ] **DECISION — D-SP26, no skill report endpoint.** The item's Phase 2 wording promised
      "scan/server/**skill** reports gain a posture section". Two of three shipped. The only skill
      export today is a **zip of the version's files**; there is no skill report *document* to add a
      section to, and WP 2.2 refused to invent one.
      *The decision:* is a skill report endpoint (JSON + Markdown, like the scan and server ones)
      worth its own work package? The posture renderer already handles a skill report unchanged.
      *Ledger:* box 1 of 10.
- [x] **CLOSED 2026-08-23 — the mount is 100 / clean, and the recorded figure was wrong.** This box
      read "the bench's own MCP mount scores 49 / high risk, 51 `info` findings". Measured on `main`
      2026-08-23 (RM-38): **24 tools · 0 findings · 100 / `clean` · analyzerVersion 4**, and the 18
      rules are live — degrading one real tool produces 2 `info` findings / 98 `low`, so the 0 is a
      clean subject, not a deleted rule set. The original pair was also **transposed**: the code's own
      record (`packages/shared/src/security-posture.ts:73-77` and `:479-482`, two independent comments)
      says **score 51 on 49 findings**. And since analyzer v3 capped `info` at 10, no info-only report
      can score below **90** at any count, so "49 / high risk" is unreachable either way.
      *Decided by the owner 2026-08-23.* It rests on that measurement — **no test in the suite asserts
      the real mount's score**, so the gate covers it not at all.
      *Ledger:* box 4 of 10 — now closed; RM-20 has 9 open.

---

## A10 · RM-08 — CI & headless automation, the local half (7 checks)

`Ledger: planning/Roadmap/RM-08-ci/STATUS.md › "Owner acceptance (owner-only)"`
*Covers boxes 1, 2, 5, 6, 10, 12 and the first half of 13. RM-08's remaining boxes: 1 needs a
provider key (**B8**), 6 need a real pipeline (**Sitting D**), which also takes 13's second half.*

> ⚠️ **Every RM-08 box that says `http://127.0.0.1:8080/api/mcp` must be read as `:8081`** on this
> machine (see *Which URL to use*). `:8080` reaches a different checkout's container.

- [ ] **WP 1.1 — Settings › API tokens, both themes, and a real remote refusal.**
      `http://localhost:8081/settings/tokens`.
      *Expect:* reads correctly in both themes, keyboard-reachable with visible focus; **creating a
      token reveals the secret exactly once**, with an unmissable "you will not see this again" and a
      working copy button; **revoking asks first**. Then the remote half: from another machine on the
      LAN — or `curl` from inside a container — hit `/api/servers`; it must be **refused without a
      token** and **succeed with one**.
      *Ledger:* box 1 of 13.
- [ ] **WP 1.1 — three consequences of D-C2 to rule on.** All three work as specified; none is a
      defect; each is a one-line change if you want it different.
      1. **`API_AUTH_REQUIRED=true` makes Settings › API tokens unreachable** — the host's browser
         presents no token (401) and a token may never manage tokens (403). Documented workaround:
         mint the tokens you need first, then switch it on. Alternative: exempt `/api/tokens*` on
         loopback even under the flag.
      2. **A remote browser loads the SPA shell but every `/api` call 401s** — non-`/api` paths are
         deliberately untouched, so a remote user sees the app with nothing in it. A friendlier
         "this instance needs a token" surface is possible but unbuilt.
      3. **The workbench MCP mount is POST-based**, so under WP 1.1's coarse rule a remote MCP client
         needed an **execute** scope, not `read`. Per-route mapping was WP M.2's job — confirm M.2
         picked it up (`API_TOKEN_ROUTE_SCOPES` now relaxes `POST /api/mcp` to `read`).
      *Ledger:* box 2 of 13. This is a decision box — record three answers.
- [ ] **WP M.1 — the feature flag, and a live MCP host.**
      `http://localhost:8081/settings/features` shows the **Workbench MCP server** row.
      *Expect:* reads correctly in both themes, keyboard-reachable with visible focus; its turn-off
      confirm dialog **states the blast radius**. Then point an external agent host (Claude Code /
      Cursor) at **`http://127.0.0.1:8081/api/mcp`** and have it answer a real question from the
      tools. Turn the flag off → the same call must answer **403 `feature_disabled`**.
      *Setup:* an MCP host client installed locally.
      *Ledger:* box 12 of 13.
- [ ] **WP M.4 — onboarding from the served doc.** Open
      **`http://127.0.0.1:8081/api/mcp/llms.txt`** in a browser and read it. Then in **another repo**
      run `claude mcp add --transport http workbench http://127.0.0.1:8081/api/mcp` and have that
      session answer a question from the tools **without further explanation from you**.
      *Expect:* the doc is generated from the registered surface and is enough on its own.
      *Ledger:* box 13 of 13 — **the second half of this box** ("the `mcp-self-scan.yml` job runs
      green once the branch reaches GitHub, never yet executed") is in **Sitting D (D5)**. Tick here
      only for the llms.txt/onboarding half.
- [ ] **WP M.2 — scopes at the mount door.** From a second machine (or the LAN IP from this one),
      point an MCP host at `http://<lan-ip>:8081/api/mcp` with a **`read`** token → connects and
      answers a real question. The same host with **no** token → refused. A token holding only
      **`scan:run`** → refused **at the door, naming `read`**. Then read the API log: **one audit
      line per tool call**, carrying the token's display prefix `mcpfp_xxxxxxxx` and **no secret**.
      *Setup:* two tokens with different scopes (`/settings/tokens`); an MCP host.
      *Ledger:* box 5 of 13.
- [ ] **WP M.3 — the write tools, and the refusal that matters.** With a token holding
      **`read` + `scan:run`**, have the agent run **`scan_run`** against a registered server.
      *Expect:* the result is a **compact summary naming `scans_get`** — *not* a wall of tool
      definitions. Then ask the **same** token to `suite_run_start`: it must be **refused with a
      message naming `suites:run`**, and **no suite run may appear**. Finally, confirm the **cost
      estimate** in a launch result matches what the in-app launcher previews for the same plan.
      *Setup:* a registered server; an MCP host; a scoped token.
      *Ledger:* box 6 of 13.
- [ ] **WP 3.1 — the posture gate against a real regression.** Scan a server. Add a deliberately
      poisoned tool (injection phrasing, or `readOnlyHint: true` on a `delete_*`). Scan again. Run a
      gate carrying **`no-new-security-findings`**: `pnpm build`, then
      `node apps/cli/dist/index.js assert --gate <file> --url http://127.0.0.1:8081`.
      *Expect:* it **fails naming the rule and the tool** (exit **1**). Then **reword the offending
      description without removing the problem** and confirm it still reads as the **SAME** finding —
      no new failure, no resolved-then-new churn. That is D-C20's whole claim, and the one an
      operator notices first.
      *Setup:* the same poisoned fixture server as **A9**'s last check.
      *Ledger:* box 10 of 13.
      ⚠️ Use `node apps/cli/dist/index.js`, **not `pnpm mcpfp`** — pnpm prints a banner on stdout and
      collapses every non-zero exit to `1`, which is the code D-C7 reserves for "the gate said no".

---

# Sitting B — one provider API key

> **Entry condition: one working provider API key entered at `/settings/providers`.** Nothing here
> needs a Claude subscription sign-in; nothing here needs a pipeline.
> **113 checks across 12 blocks.** Clears **RM-23 · RM-07 · RM-10 · RM-06(6/7) · RM-24(P2) ·
> RM-26(3/4) · RM-30(2/2)** and the three Hub walks.

> ℹ️ **Why every Hub check is here and not in Sitting A.** With no provider credential configured,
> `/assistant` renders a **"not configured" empty state pointing at Settings**
> (`apps/web/src/features/hub/AssistantView.tsx`). No Hub surface paints at all without a key — so
> RM-03, RM-04 and RM-13 belong to this sitting in full, even the parts that are only "look at it".

> 💰 **This sitting spends money.** Suite mass-runs, missions and LLM judges all bill. Set a cost cap
> before starting (`/settings/testing`), and prefer the cheapest capable model where a check does not
> name one.

---

## B1 · RM-23 — SkillFlow (4 checks, 3½ currently blocked)

`Ledger: planning/Roadmap/RM-23-skillflow/STATUS.md › "Owner acceptance (deferred visual / a11y — owner-only…)"`

> ⛔ **Read A8's O2b note first.** The **Design** and **Trace** tabs — SkillFlow's entire visible
> surface — are **hidden** by owner decision O2b, un-parked only by RM-30 Phase 7. `SuggestionCard`
> lives in `features/skills/trace/`, so the fracture→suggestion loop is hidden with it. **Three and a
> half of RM-23's four open boxes cannot be walked today.** This is the single most important thing
> to know before opening this sitting.

- [ ] ⛔ **Phase 1 (WP 1.3) — the Design tab across three skill sources.** *Not runnable.* The box
      asks for a two-theme walk of the **Design tab** across an uploaded skill, a GitHub-imported
      skill and a fresh blank skill.
      *Ledger:* box 1 of 4 — record as **blocked (O2b → RM-30 Phase 7)**.
      ⚠️ The box says `@ localhost:8080`; when it becomes runnable, use **8081**.
- [ ] ⛔ **Phase 2 (WP 2.3) — the Trace tab against a real run.** *Not runnable.* The box asks for a
      two-theme walk of the **Trace tab** against a real run with an attached skill (green path, a
      fracture, a never-visited node).
      *Ledger:* box 2 of 4 — record as **blocked (O2b)**.
- [ ] ⛔ **Phase 4 (WP 4.2) — edit a skill visually, save as a new version.** *Not runnable* as
      written ("edit **visually**"). *Runnable substitute, if you want the underlying property
      proven:* edit the same `SKILL.md` from the **Files** tab, save as a new version, and verify the
      diff **preserves hand-written prose**. Record clearly which you did.
      *Ledger:* box 3 of 4.
- [ ] **partial** **Phase 5 (WP 5.1–5.2) — gate verdicts and the suggestion round trip.**
      - ✅ **Gate verdicts appear in test results.** Attach a skill to an environment, put a
        SkillFlow **gate assertion** on a test, run it, and open the run's **Report** tab
        (`/testing/runs/:runId`). *Expect:* the conformance verdict renders alongside the other
        grades and does not get conflated with expectation grades.
      - ⛔ **A suggested edit round-trips.** *Not runnable* — the suggestion card is a Trace-tab
        component.
      *Setup:* a skill attached to an environment; one run.
      *Ledger:* box 4 of 4 — tick only if you record the blocked half explicitly.

---

## B2 · RM-07 — Benchmarks (5 checks)

`Ledger: planning/Roadmap/RM-07-benchmarks/STATUS.md › "Owner acceptance (deferred visual / a11y / live-credential — owner-only)"`

- [ ] **Phase 1 — expectations → run → Grade panel, both themes.** Author a test with
      **expectations**, run it, open the **Grade** panel on the run.
      *Expect:* scores, the judge's **reasoning**, and a working **re-grade**; the judge itself
      configured in `/settings/grading` against a real provider.
      *Ledger:* box 1 of 5.
- [ ] **Phase 2 — tool hygiene and a trajectory judge that cites real steps.** Author a run that
      makes a **deliberate wrong-parameter tool call**.
      *Expect:* `tool_hygiene` findings name it; a **trajectory-judge** grade **cites real steps**
      (the step links resolve into the run's step log).
      *Setup:* a registered MCP server the run can call.
      *Ledger:* box 2 of 5.
- [ ] **Phase 3 — a live suite run, both themes.** Launch a saved suite with a test × environment ×
      repetition matrix and a **cost cap** set low enough to trip.
      *Expect:* the matrix **fills** as members complete; the cap **soft-stops** (partial results
      kept, honestly marked); the quality×cost **scatter** and the breakdowns read correctly in
      **both** themes.
      *Ledger:* box 3 of 5.
- [ ] **Phase 4 — a live GitHub round trip on a private repo.** Bind a collection to a **private**
      repo with a PAT (`/settings/github`) → **sync** → create a **conflict** on both sides →
      **resolve** → confirm both sides **converge**.
      *Expect:* a real git merge; the **PAT never surfaces** anywhere in the UI, a report, or a log.
      *Setup:* a private GitHub repo and a PAT — an **extra** credential beyond this sitting's key.
      *Ledger:* box 4 of 5.
- [ ] **Phase 5 — a ± skill delta table on a real suite.** Run the same suite with and without a
      skill attached.
      *Expect:* the A/B delta table shows the skill's effect on quality and cost, and the sign of the
      delta matches a human read of the answers.
      *Ledger:* box 5 of 5.
      ℹ️ RM-35 §4.7 records **RM-07 Phase 6** (judge calibration & trust, 2 WPs) as an owner-gated
      parked phase that also blocks retirement. Deciding it — build, or split to a new RM item — is a
      10-minute decision, not part of this walk.

---

## B3 · RM-10 — Hierarchical crews (9 checks)

`Ledger: planning/Roadmap/RM-10-crew-nesting/STATUS.md › "Owner acceptance (owner-only)"`
*Box 1 of 10 (the D-CN log + three defaults) was accepted 2026-07-26 — 9 remain.*

- [ ] **A live nested mission ≥ 2 levels.** e.g. Chief Operating Agent → {Strategy Crew (parallel,
      root agents), Intelligence Crew (parallel) → {Data Analyst, BI sub-crew}}. Launch it from
      `http://localhost:8081/assistant`.
      *Expect:* it runs; **each subtree preserves its own topology**; the synthesis is honest; the
      JSON **and** Markdown run reports show **per-level cost attribution**.
      *Setup:* ≥2 saved crews, one nested inside the other; mixed real models.
      *Ledger:* box 2 of 10.
- [ ] **Budget exhaustion mid-tree.** Give the root a real allocation (e.g. $5) that splits across
      levels, and make a child crew trip its budget.
      *Expect:* the trip **cleanly aborts in-flight siblings** and marks the branch **partial** — not
      a silent truncation; aggregate spend **never exceeds** the root `HUB_MISSION_MAX_BUDGET_USD`.
      *Ledger:* box 3 of 10.
- [ ] **Cycle and depth rejection, at both layers.** (a) Save a crew whose `crewId` member
      transitively reaches itself → **rejected at author time** with a clear, actionable error.
      (b) Save a crew ≥ `HUB_MISSION_MAX_DEPTH+1` deep (default depth 2) → likewise rejected with a
      user-facing message. (c) Mutate the graph **between save and run** → rejected at **run time**
      too.
      *Ledger:* box 4 of 10.
- [ ] **Transitive grant intersection across N levels (D-HF5).** Put a child crew with `@read`
      Access on a server inside a parent with `@admin`.
      *Expect:* the child shows its **`@read` intersection**, never escalated to `@admin`; the model
      holds on a **full-tree** traversal.
      *Setup:* a registered MCP server with distinguishable scopes.
      *Ledger:* box 5 of 10.
- [ ] **Live HITL awaiter cleanup (the 5.R residual risk).** Deny an approval, or stop a run, on a
      **nested** level.
      *Expect:* dangling awaiters settle on the **real** `runAgentTurn`/`releaseTurn` session-runner
      path — the path the test stub bypasses. Nothing hangs; the mission still terminates.
      *Ledger:* box 6 of 10.
- [ ] **Both themes + keyboard, four surfaces.** (1) the **N-level org chart/rail** — arrow/Tab/Enter
      roving, cycle placeholders; (2) the **nested mission-board drill** — this is the **first
      `Dialog`-in-`Dialog` in the app**, so check the focus trap and the **Esc ordering** (inner
      closes first); (3) the crew-editor **Sub-crew add** path and its cycle warning; (4) the
      **per-level cost meter**.
      *Ledger:* box 7 of 10.
- [ ] **The hierarchical run report.** Export the nested mission's run report, **JSON and Markdown**.
      *Expect:* the hierarchical trace renders with **per-level cost and timing**, and honest
      **partial** marking on budget-exhausted children.
      *Ledger:* box 8 of 10.
- [ ] **Read the two adversarial reviews and accept the residual risk.**
      `planning/Roadmap/RM-10-crew-nesting/phase-2-engine/2.R-review.md` and
      `phase-5-close/5.R-review.md`. All probes were REFUTED; the residual risk is yours to accept.
      *Ledger:* box 9 of 10. A reading task, not a walk.
- [ ] **Acknowledge the pre-existing `hub-workspace.test.ts` flake.** A same-millisecond
      snapshot-ordering timing flake in code byte-identical to `main`, unrelated to crew nesting.
      *The decision:* harden it separately, or accept it.
      *Ledger:* box 10 of 10.
      ℹ️ The ledger says this walk gates a merge of `feat/crew-nesting → main`. **That branch no
      longer exists locally** and the code is present here (`apps/api/src/hub/missions/crew-resolution.ts`).
      Treat the merge clause as satisfied; verify by looking.

---

## B4 · RM-06 — Auto-rating (6 of 7 checks)

`Ledger: planning/Roadmap/RM-06-auto-rating/STATUS.md › "Owner acceptance (owner-only)"`
*Box 1 needs a Claude subscription — filed under **C4**.*

- [ ] **A deliberately broken run's error forensics.** Cause a run to fail honestly — a bad tool
      argument, or a guardrail stop.
      *Expect:* an `error_forensics` finding whose **bucket**, **fixTarget** and **drafted fix** are
      *believable*, and whose **evidence links resolve to the right steps**. This is a judgement call
      about plausibility, not a pass/fail.
      *Ledger:* box 2 of 7.
- [ ] **A ≥2-member suite's consistency verdict.** Run a suite with **repetitions**.
      *Expect:* the suite report's **consistency verdict matches a human read** of the member
      answers; spot-check the **cost and variance arithmetic** against the member rows.
      *Ledger:* box 3 of 7.
- [ ] **Report tabs, both themes + keyboard; and AR6 held.** Walk the **Report** tab on a run
      (`/testing/runs/:runId`) and on a suite run (`/testing/suite-runs/:suiteRunId`).
      *Expect:* both themes, keyboard-reachable. **Critically:** the runs-feed **verdict chip** is
      never conflated with **expectation grades** — they are different axes and must read as
      different things (AR6).
      *Ledger:* box 4 of 7.
- [ ] **Watch `ratingState` flip, live, everywhere.** Launch a run and watch it to terminal.
      *Expect:* `ratingState` visibly moves **Reviewing → Completed** (or **Failed**) in **every**
      surface that renders it: the runs feed, suite rows, Compare, the run console, the suite
      console, the chat shimmer, and the Report tab label. A surface still saying "Reviewing…" after
      the rest settled is the defect this box is looking for.
      *Ledger:* box 5 of 7.
- [ ] **The report redesign, both themes.** On the Report tab: the **Outcome/Trajectory judge
      donuts**, the run-rating **RadarChart**, `scoreTone()`'s thresholds as applied to
      `ScoreReadout` / `GradeChip` / `GradePanel`, and the **"Reviewing…"** chips.
      *Expect:* the donuts and radar are legible in both themes and the tone thresholds are
      distinguishable by more than colour alone.
      *Ledger:* box 6 of 7.
- [ ] **The re-rate control's in-progress state.** Trigger **Re-rate** on a rated run.
      *Expect:* the control **visibly disables** and shows a rating-in-progress state until the new
      report settles — no double-fire, no silent no-op.
      *Ledger:* box 7 of 7.
      ℹ️ RM-35 §4.7 records **RM-06 Phase 5** (cross-links, 3 WPs) as an owner-gated parked phase
      that also blocks retirement — a decision, not a walk.

---

## B5 · RM-24 — Skills, Phase 2 (1 check)

`Ledger: planning/Roadmap/RM-24-skills/STATUS.md › "Owner acceptance…"` *(Phase 1's box is **A4**.)*

- [ ] **Phase 2 (WP 2.3) — the Allowed-skills editor, and a real run using an attached skill.**
      `http://localhost:8081/testing/environments` → an environment → its **Allowed skills** editor.
      Attach a skill three ways — **latest**, **pinned** to a version, and **eager** (inline) — then
      run each.
      *Expect:* the editor reads correctly in both themes; `latest` resolves at runtime while
      `pinned` does not move; the **eager** attachment's tokens show up in the run's context
      accounting; the skill's files are exposed **read-only and metered, never executed**.
      *Setup:* ≥1 skill with ≥2 versions.
      *Ledger:* box 2 of 2. ⚠️ The box says `@ localhost:8080`; use **8081**.

---

## B6 · RM-30 — UX overhaul, the provider-key checks (1 of 2)

`Ledger: planning/Roadmap/RM-30-ux-overhaul/STATUS.md › "Owner-acceptance (live, by the owner…)"`
*Box 1 is **A6**.*

- [ ] **The four provider-key-only checks, on the live instance.** All four are sub-items of one
      ledger box — tick it only when all four are answered.
      1. **WP 2.5 — on run `9JThXmPbkW2zh8JeINxGy`:** expanding **every** tool call must **never
         move the KPI rail**; the console **opens at turn 1** for finished runs; the Analytics
         turn-axis reads correctly with data. (This run id is named in the ledger; if it is no longer
         in your database, substitute any long recorded run and say which.)
      2. **WP 2.8 K4 — Trace lens:** value-aware chips, a **one-line all-unmatched verdict**, and the
         **docked legend** all render correctly once a trace is loaded.
      3. **WP 2.7 / 2.10 — the ENABLED, credential-filtered model roster** (F2/S19) with a real
         provider key: only models the credential can actually reach are selectable.
      4. **WP 3.5 — the launcher cost preview with live pricing** (`POST /api/estimate/run-plan`).
      *Ledger:* box 2 of 2 — "Provider-key-only checks (couldn't verify without a key…)".
      ℹ️ Sub-item 4 overlaps a known limitation the owner has already seen: the band **brackets** a
      real run ($0.42–$1.59 against $0.80 billed) but cannot land near it, because the estimator's
      8-turn ceiling is the dominant error where that run took 19 turns. **RM-34 WP 2.1** is the open
      work package that fixes exactly this — judge the *band*, not the *point*.

---

## B7 · RM-26 — Testing (3 of 4 checks)

`Ledger: planning/Roadmap/RM-26-testing/STATUS.md › "Owner acceptance…"` *(WP 5.4 is **A5**.)*

- [ ] **Phase 3 (WP 3.1–3.10) — every Testing surface, two themes + keyboard.** The run console, the
      conversation pane, the **KPI rail + context chart**, the **step log / packet inspector**,
      **replay**, **compare**, and the **Application / Console** panels. Then the live half: a run
      producing **50+ steps**, watched streaming.
      *Expect:* everything legible and keyboard-reachable in both themes; **the 50+ step stream is
      smooth** — no layout thrash, no half-parsed error flashing mid-stream, no folding of a
      half-filled table. An error must appear **only** at a terminal, settled failure.
      *Setup:* one long live run (the streaming half) — the rest can be pre-checked on a recorded run.
      *Ledger:* box 1 of 4.
- [ ] **WP 4.1 — two-theme a11y acceptance, contrast, and a keyboard-only full run.** Measure
      contrast including the **`--chart-1..5`** series and the **destructive/overflow markers**. Then
      drive a **full run → inspect → replay** using **only** the keyboard. Then confirm the **log
      stays stable under load**.
      *Expect:* AA contrast everywhere; the whole run/inspect/replay path reachable without a mouse.
      *Ledger:* box 2 of 4.
      ℹ️ The chart ramp is now **12** series (`--chart-1` … `--chart-12`), not 5 — check the ones your
      charts actually use, not just 1–5.
- [ ] **WP 4.4 — end-to-end through the built Docker image.** `docker compose up --build`, then
      drive a **real run** through `http://localhost:8081/` end to end.
      *Expect:* migrations apply on the deployed DB, the encrypted-secret path works, the SPA is
      served by the API, and the run engine completes — all inside the image, not a dev server.
      *Ledger:* box 3 of 4.
      ℹ️ RM-35 §4.3 calls this "the cheapest way to de-risk everything else" and lists it as **real
      engineering** (RM-26 WP 4.4), not merely a walk — it exercises migrations, secrets, static
      serving and the run engine in one shot. If it fails, that is a defect to file, not a box to
      leave open.

---

## B8 · RM-08 — CI, the suite-run check (1 check)

`Ledger: planning/Roadmap/RM-08-ci/STATUS.md › "Owner acceptance (owner-only)"`

- [ ] **WP 2.1 — `mcpfp suite run` against a real matrix.** `pnpm build`, then
      `node apps/cli/dist/index.js suite run <suiteId> --url http://127.0.0.1:8081`, on a suite that
      takes **minutes**.
      *Expect:* the **progress lines move** (they must not repeat the same line); the summary **names
      the worst members**; the exit code is **0**. Then **stop a run from the UI mid-flight** →
      the command must exit **2** saying `stopped`, **not 0**. If you have a suite that trips its
      **cost cap**, confirm `capped` is **also a 2** — *that is the judgement call most worth your
      eye*, since a capped run did produce partial results.
      *Setup:* a saved suite with a multi-minute matrix.
      *Ledger:* box 7 of 13.
      ⚠️ `node apps/cli/dist/index.js`, **not `pnpm mcpfp`** — see A10's last note.

---

## B9 · RM-03 — Assistant Hub, the ledger boxes (17 of 18)

`Ledger: planning/Roadmap/RM-03-assistant-hub/STATUS.md › "Owner-acceptance (assembled by WP 4.R; needs live credentials — never faked)"`
*The `claude_subscription` box is **C3**. The 23-box walk script is **B10**.*

**Live provider inference (3 of 4)**
- [ ] **One real session per hub-eligible provider kind** — `anthropic`, `openai`, `google`,
      `openai_compatible`, `ollama`. *Expect:* a real reply, **exact** tokens/cost, and the UI
      capability-gated per kind (a kind without web search says so honestly).
      *Ledger:* group 1, box 1.
- [ ] **Per-message model switch mid-thread.** *Expect:* the honest provider **and cost basis** for
      each message — a subscription message reads `$ est. · subscription` (D-AH17), a metered one does
      not. *Ledger:* group 1, box 2.
- [ ] **Real-model quality of plan / report / synthesis / judge.** The `generateObject` /
      `generateText` glue is seed-proven; **quality with a real model is the judgement call**.
      *Ledger:* group 1, box 4.

**Research + MCP depth (3)**
- [ ] **Research mode against a real search/fetch MCP server.** *Expect:* inline `[n]` citations
      resolve **end to end** — the chip, the hover source, and the Sources footer all name the same
      real document. *Setup:* a research-capable MCP server (Tavily/Brave/Exa preset in the
      add-server wizard). *Ledger:* group 2, box 1.
- [ ] **MCP elicitation round-trip against a real eliciting server** — both **form** and **URL**
      modes, with the session visibly in `waiting_input`. *Ledger:* group 2, box 2.
      ⚠️ **Likely blocked.** RM-35 §4.5 records **RM-03 WP 2.3** — "autonomy dial + hard budgets +
      steering + live HITL approval-gating + **MCP elicitation**" — as **still open engineering**,
      carrying two BLOCKING MUSTs including the elicitation transport (R-MCP4). Confirm before
      spending time here.
- [ ] **Annotation-informed approvals, progress/cancel, structured output, the 10K/25K output-cap
      spill, and cross-server tool-name namespacing** — all against a real server.
      *Ledger:* group 2, box 3.

**Missions & topologies (3)**
- [ ] **A real mission, ≥3 agents, mixed models** — plan **edit**, per-agent **steer**, a **budget
      trip**, and the **synthesis**. *Ledger:* group 3, box 1.
- [ ] **Each topology live, once:** `parallel` · `pipeline` · `debate` · `best_of_n` — with the
      blind judge picking a **real** winner. *Ledger:* group 3, box 2.
- [ ] **Subscription-heavy fan-out respects the semaphore**; the board shows queueing **honestly**
      (a queued agent reads as queued, not as running). *Ledger:* group 3, box 3.
      ℹ️ Needs the subscription — if you are not doing **Sitting C**, record this one as deferred.

**Composer / voice / GenUI (3)**
- [ ] **`SpeechInput` availability in your browser** — feature-detected; where unsupported it must
      degrade to **disabled-but-visible**, never a crash or a missing control.
      *Ledger:* group 4, box 1.
- [ ] **A real model emits `present` / `prompt_user` GenUI** — charts, forms, tables — that
      **validate**, **render**, and **round-trip**. *Ledger:* group 4, box 2.
- [ ] **Slash commands, regenerate/branch, and `/mcp__server__prompt` argument forms**, driven live.
      *Ledger:* group 4, box 3.

**Knowledge / files / compaction (2)**
- [ ] **Compaction fidelity on a long real thread** — constraints are **never silently dropped**, and
      compaction markers **expand**. *Ledger:* group 5, box 1.
- [ ] **Multimodal uploads → a capable model; workspace promote-to-artifact; memory propose→save**,
      live. *Ledger:* group 5, box 2.

**The browser walk (1) — this is the whole of B10**
- [ ] **Both-theme + keyboard walk of all 9 surfaces.** Chat/research · mission board + plan card
      (4 topologies) · agents/crews (per-tool grant picker) · projects · memory · usage + context
      inspector (charts in both themes) · audit (filter + deep-link) · artifacts + review
      (`ChangeReview` accept/reject, revert) · cross-cutting (SpeechInput degrade, SR announcements,
      reduced motion).
      *Ledger:* group 6, box 1. **Run it as B10 below**, then tick this box.

**Hardening (2)**
- [ ] **Container restart mid-mission.** Restart the container while a mission is running.
      *Expect:* orphan reconciliation lands the mission in an **honest interrupted terminal state** —
      not "running" forever, not a fabricated success. *Ledger:* group 7, box 1.
- [ ] **`POST /api/hub/maintenance/prune-hub` against real data**, plus `/data/hub/**` on a **fresh**
      Docker deploy. *Expect:* retention actually removes what it claims and nothing it does not.
      *Ledger:* group 7, box 2.

---

## B10 · RM-03 — the 9-surface keyboard + both-theme walk (23 checks)

`Walk file: planning/Roadmap/RM-03-assistant-hub/owner-acceptance-walk.md`
This is the script for **B9's** "Both-theme + keyboard browser walk" box. Its 23 boxes live in the
walk file itself; tick them there **and** tick B9's group-6 box when the walk is done.

**Setup (from the walk file):** at least one hub-eligible provider credential configured, so
`/assistant` does not show the "not configured" empty state. Two passes per surface — **both themes**
and **keyboard-first** — as described at the top of this document.

> ⚠️ **This walk describes a pre-RM-04 UI in three places.** RM-04 rebuilt the workforce, usage and
> memory surfaces afterwards. Specifically:
> - **§5 "Memory (`Memory` view)"** — `/assistant/memory` is now a **redirect** to
>   `/assistant?memory=profile`.
> - **§6 "Usage (`/assistant/usage`)"** — now a **redirect** to `/assistant/agents?tab=usage`.
> - **§3 "Agents + crews"** — rebuilt as the workforce section (**Directory / Org chart / Usage**
>   tabs with an org rail).
> For those three surfaces, **run RM-04's walk (B11) instead** and treat RM-03's §3/§5/§6 boxes as
> satisfied by it. RM-03's §1 (chat), §2 (mission board), §4 (projects), §7 (audit), §8 (artifacts)
> and §9 (cross-cutting) are still the current description.

- [ ] §1 Chat — 3 boxes (transcript/composer/tool-call cards both themes · keyboard incl. `/` menu ·
      citations panel + `[n]` chips)
- [ ] §2 Mission board + plan card — 3 boxes (plan card + board both themes · keyboard
      Approve/Cancel/Stop/steer, graph does not trap focus · each of the 4 topologies visually, state
      distinguishable **by more than colour**)
- [ ] §3 Agents + crews — 2 boxes *(superseded — see B11 §3)*
- [ ] §4 Projects — 2 boxes (list/instructions/pinned-files/session grouping · create+pin+assign by
      keyboard)
- [ ] §5 Memory — 2 boxes *(superseded — see B11 §7)*
- [ ] §6 Usage + context inspector — 3 boxes *(usage: superseded — see B11 §3c; the **context
      inspector** box is NOT superseded — check `SessionContextPanel`'s per-layer window breakdown:
      prompt sections, eager vs deferred tool defs, skill L1/L2/L3, memory, project, history)*
- [ ] §7 Audit — 2 boxes (timeline + deep-links both themes · filter → follow → return by keyboard)
- [ ] §8 Artifacts — 3 boxes (list/Content-Diff-Review tabs/versions+Revert/export menu · the
      `share.html` export **legible standalone in a plain tab, not hardcoded to one theme** ·
      `ChangeReview` hunk accept/reject + keyboard)
- [ ] §9 Cross-cutting — 3 boxes (`SpeechInput` degrades disabled-but-visible · SR announcements on
      mode switch / mission phase / approval outcome (`aria-live` / `role="status"` present) ·
      reduced motion **tones down** rather than ignores)

---

## B11 · 🗄 RM-04 — Assistant Hub UX, the rebuilt surfaces (15 checks) — **RETIRED, verification outstanding**

`Walk file: planning/Roadmap/completed/RM-04-assistant-hub-ux/owner-acceptance-walk.md`
`Ledger: planning/Roadmap/completed/RM-04-assistant-hub-ux/STATUS.md › "Owner-acceptance (pending, end of workstream)"` *(prose, no boxes)*

> 🗄 **RM-04 is already in `Roadmap/completed/`.** Nothing here unblocks a retirement — the item is
> retired. It is included because **the walk was never run**, and this is the newest description of
> the workforce/sessions/memory surfaces that RM-03's older walk (B10) still describes in their
> pre-rebuild form. Its own honesty note: *"the rendered both-theme visual walk itself is NOT yet
> done: the WP4.2 sandbox had no Chromium, so no screenshots were taken and no pixels were
> inspected."*

Its 15 sign-off boxes live in the walk file. Four cross-cutting variants apply throughout —
**Light ↔ Dark** (top-bar switcher, **not** Settings, per that file), **keyboard-only**,
**reduced-motion** (OS setting; the hub reads `prefers-reduced-motion` live), and
**decoration** (confirm the dot grid never competes with text — there is no live density toggle).

- [ ] §1 **Workspace choreography** — fresh session opens **centered** with greeting + starter chips;
      on send the composer **glides once** (~240 ms) to docked, **once per session**; with
      reduced-motion it **snaps** with content never hidden; a session reopened **with history**
      starts docked instantly.
- [ ] §1b **Composer clearance (the WP1.R-C fix — verify carefully).** Grow the composer: several
      lines + attachments + a running **Stop**. *Expect:* the **last transcript message is never
      covered** at any composer height.
- [ ] §1c **Meta rail** — one 360px rail with its own scroll; **Progress / Outputs / Context**
      collapse individually and keep their counts; under ~1100px content width it becomes a
      **Sheet** that traps focus and closes on `Esc`.
- [ ] §2 **Sessions table** (`/assistant/sessions`) — sortable/filterable `DataTable`; **Show
      archived** toggles; a row returns to the workspace on that session. Plus the switcher's
      `role="group"` **"Session switcher"** purpose label, and its two pinned actions
      ("View all sessions →", "+ New session") firing their own action rather than selecting a
      session.
- [ ] §3a **Directory** (`/assistant/agents?tab=directory`) — single-click **selects**,
      double-click / `Enter` / ⋯→open **opens** the profile modal; the org rail scope filters;
      **exactly one** `EmptyState` per region. **Crew colour is accents only** — a 3px card top
      border, the avatar ring, a dot beside names, always paired with the crew name; never a fill or
      a text colour. Quick-create with an empty name fails **loudly**.
- [ ] §3b **Org chart keyboard parity** (`?tab=org`) — **focus a node → the inspector populates**
      (mirrors a click); **`Enter`/`Space` on a focused node → its profile modal opens** (mirrors a
      double-click); canvas chrome is a no-op for those keys. Edges draw the crew's **real** topology.
      *Setup:* ≥2 crews with members, mixed topologies.
- [ ] §3c **Usage** (`?tab=usage`) — group-by (agent · crew · model · project · mode) and a drill to
      sessions → replay. *Expect:* **`sum(rows) == total`** for every group-by, and unattributed
      spend appears as an explicit **"no agent" bucket**, never a silently short total. Also check
      the `/assistant/usage` → `?tab=usage` redirect.
- [ ] §4a **Agent profile → Access (the centrepiece).** Per registered MCP server: a **tri-state**
      master checkbox, per-tool checkboxes, per-server search, All/None, live counts — and **every
      tool row shows its scan-measured token cost**, with a running **Granted footprint** total. A
      granted server with **no scan** is called out.
      **Known brand-ui gap — confirm, do not expect a fix:** the master checkbox in the "some" state
      is correctly `aria-checked="mixed"` but its **glyph looks identical to checked**; the
      **"N / M tools" badge** beside it is the visual disambiguator. Confirm the badge is present and
      its count is right.
      *Setup:* a **scanned** MCP server, or the tool rows have no costs to show.
- [ ] §4b **Crew profile → colour picker** — exactly five `--chart-1…5` swatches plus **No color**,
      each a real radio with an `sr-only` label, arrow-selectable, `aria-label="Crew color"`. Set and
      clear a colour and confirm it propagates to the card border/dot and the org-chart tint.
- [ ] §5 **Projects** (`/assistant/projects`) — no fixed-height inner frame (the old `h-[46rem]` is
      gone; the page scrolls as one region); the files table sorts; the sessions link deep-links to
      `/assistant/sessions?projectId=…`.
- [ ] §6 **Audit** (`/assistant/audit`) — toolbar grammar, **sticky day-group headers**, outcomes as
      `StatusBadge`, one `EmptyState`, and an error state that offers **retry**.
- [ ] §7 **Memory** — `/assistant/memory` → `/assistant?memory=profile`; the workspace **Context**
      section shows the **effective stack** (profile → project → crew → agent, in injection order,
      each tagged and linked); a save-proposal carries a **scope picker** defaulting to the
      most-specific sensible owner; conflicts resolve **most-specific-wins**, shown transparently.
- [ ] §8 **Nav and redirects** — exactly **4** hub nav items (**Assistant** + its **Sessions** child,
      **Agents & Crews**, **Projects**, **Audit**); **exactly one** is active at a time (the Assistant
      parent must **not** also light up on Agents/Projects/Audit); breadcrumbs render on
      `/assistant/sessions`; both redirects land on a real, param-consuming target.
- [ ] **The cross-cutting re-pass** — every surface above re-checked in **Dark**, driven
      **keyboard-only**, with **reduced-motion** on, and the dot grid confirmed non-competing.
- [ ] **The six credentialed items** listed at the end of that file (live session + choreography ·
      the `claude_subscription` path — *do this one in **Sitting C*** · Access token costs on a
      scanned server · org chart with ≥2 crews · usage drill on real spend · research mode against a
      research-capable server).

---

## B12 · 🗄 RM-13 — Hub defect fixes (28 checks) — **RETIRED, verification outstanding**

`Walk file: planning/Roadmap/completed/RM-13-hub-fixes/owner-acceptance-walk.md`
`Ledger: planning/Roadmap/completed/RM-13-hub-fixes/STATUS.md › "Owner-acceptance (never faked; assembled by WP 7.R)"` *(prose, no boxes)*

> 🗄 **RM-13 was retired 2026-08-21 with its ledger clean — and its 28-item walk has never been run.**
> The file says so in its own words: **"Nothing below is verified."** This is the single largest block
> of unrun verification in the bundle, and it covers the six root causes behind missions that
> *"produced confident output from no evidence"*. Nothing here unblocks a retirement; it is the
> honesty debt the retirement carried with it.

**§0 · Pre-flight — 3 boxes.** These are setup and decisions, and can be done before the key is even
entered:
- [ ] **Migration v51 applies cleanly on the EXISTING deployed DB.** Back up first. Bring the
      container up. *Expect:* boot succeeds, existing sessions still open, `PRAGMA user_version`
      reads **51** (or higher — the schema has moved on since; confirm it is **≥ 51** and that the
      `hub_sessions` `mode` CHECK admits `'auto'`), and a new session can be created with mode
      `auto`.
- [ ] **DECISION — remove WP0.1's eager override?** `docker-compose.yml` still pins
      `HUB_TOOL_LOADING_DEFAULT: eager` (the Phase-0 same-day mitigation). The code default is now
      `auto`, which loads a small scoped catalog eagerly and **defers** a large unscoped one (with
      `tool_search` promotion) instead of blowing the prompt budget. The live RC1/RC3 proof works
      under either mode. **Keep `eager`** → simplest, long-tested; a large unscoped session re-hits
      the ~245k-token cost. **Remove the line** → recommended once the scoped proof below passes.
      Decide, edit, recreate the container, record the choice.
- [ ] **Register + scan ≥1 MCP server** with working auth, so the Hub has a real tool surface to
      grant. (Shared with *Before any sitting*.)

**§1 · MCP truth in a main session (RC1/RC3) — 4 boxes.**
- [ ] **Scoped tool call end-to-end (the core proof).** `/assistant` → **New session** → **MCP &
      tools** tab → **Scoped** → tick **one** server only → create. Ask a question that needs it.
      *Expect:* a tool call appears with an **approval card**; approving returns **real data**; the
      answer renders. (Pre-fix, **no MCP tool was ever callable** — that is RC1.) In `auto`/`deferred`
      mode a `tool_search` promotion step may come first.
- [ ] **The rail's Tools/Context section shows ONLY the scoped server (RC3.1).** Compare against an
      **Auto** (unscoped) session, which should list every reachable server. Both themes.
- [ ] **Manage tools after create (RC3.3).** Open the rail's **Manage tools** editor, change the
      grant, save. *Expect:* the scope persists (PATCH) and the **next turn honours it**. Both
      themes; open the dialog by keyboard.
- [ ] **The real failing-MCP path (RC3.4).** Point a server at a dead URL, or let its OAuth expire,
      then take a turn needing it. *Expect:* an **error chip with the reason** (not a silent drop);
      the prompt/answer says **"Unreachable this turn: `<server>` (`<reason>`)"** rather than the
      misleading "no MCP tools are granted"; a **Retry** affordance is present; after fixing auth,
      Retry or the next turn reconnects. *Setup:* a genuinely broken server.

**§2 · Missions become real tool-using sessions (RC2/RC6) — 6 boxes.**
- [ ] **A real mission with real MCP tools (RC2 — the linchpin).** *Expect:* an agent's child session
      runs **real turns**, calls a granted tool, streams the call + result into its transcript,
      returns a **real** report, and the board shows **real** per-agent cost/tokens — **not
      `costUsd: 0`**.
- [ ] **Live expand-modal transcript (RC6.2/6.4).** **Maximize** on the topology graph → select an
      agent node by click **and** by keyboard. *Expect:* the right panel **streams that agent's
      child-session transcript live**; closing the modal **unsubscribes** (no leaked stream). Check
      at **1280 and 1920** widths, both themes. *(Selecting a REBUTTAL node `::rN` falls back to the
      default agent gracefully — a documented follow-up, not a crash.)*
- [ ] **Mission agent grid + detail box (RC6.3).** A responsive 2-up grid; a card opens (mouse and
      keyboard) to the detail box's **Status / Live / Report** tabs.
- [ ] **Truthful topology graph vs live timestamps (RC6.1).** Run a **debate** mission. *Expect:* a
      parallel **openings** row → a **rebuttal** row with "sees + rebuts" edges → a terminal
      **Synthesis (resolver)** node, with the per-topology legend line present. Cross-check the agent
      report **timestamps**: round-1 debaters should **overlap**; rebuttals should see prior openings.
      Repeat for pipeline / parallel / best-of-N.
- [ ] **Live HITL approval round-trip (D-HF6).** Run a mission with autonomy `always_ask`.
      *Expect:* each gated call queues to the board's **approval queue**; approving resumes that
      agent's slot; **denying makes the tool fail into the transcript with an honest report note —
      never a fabricated result**; an unanswered card **auto-denies** after
      `HUB_MISSION_APPROVAL_TIMEOUT_S` (default 300s) with a visible note, and the mission still
      terminates.
- [ ] **Live planner proposes real grants (RC2.4).** *Expect:* the `MissionPlanCard` shows **per-agent
      server chips drawn from your reachable catalog** (not "no tools"); hallucinated server ids are
      **stripped with a plan note**; unconfigured "Finish configuring…" roles warn before launch; the
      effective-grant subtitle reflects **plan ∩ parent scope**. Edit a grant and confirm it
      constrains the picker.

**§3 · Answer rendering (RC4) — 2 boxes.**
- [ ] **Mission synthesis renders as MARKDOWN with inline chips + GenUI.** *Expect:* **real
      markdown** (headings, tables, lists — not literal `##` / `|---|`), `[n]` markers as **inline
      citation chips** with a hover source, and a GenUI `present` widget where the model chose one.
      Pre-fix, **any citation-bearing answer rendered as raw markdown** — that is RC4. Also confirm a
      **legacy pre-fix mission log still renders** on replay. Both themes — check chip contrast.
- [ ] **Hostile-markdown answer renders safely (INV5).** If you can prompt an answer containing
      `<script>` or a `javascript:` link: **nothing executes** and **no active link is produced**.
      Streamdown sanitization is a library boundary jsdom cannot test — this must be verified live.

**§4 · Internet capability (RC5, D-HF2) — 2 boxes.**
- [ ] **Live `web.search` on at least one provider.** On a search-capable model
      (Anthropic / OpenAI / Google), ask something needing current info. *Expect:* the provider's
      **native** web search runs, results become **hub citations** (numbered, hover-able), and usage
      shows a truthful `webSearches` count with **no fabricated $**. On an unsupported model
      (`openai_compatible` / `ollama`) the prompt honestly says web.search is unavailable and suggests
      `web.fetch`. Confirm **`HUB_WEB_TOOLS=off` removes both tools everywhere.**
- [ ] **Research-server onboarding surfacing.** In a research session with no research MCP server and
      no web capability: the honest hint appears (**"paste your own API key; none bundled"**), the
      plan-card web-capability notice shows, and the deep-link lands on `/servers` one click from
      Add-server → the research presets.

**§5 · Mode routing + composer clarity (RC7) — 2 boxes.**
- [ ] **`auto` session mode routes per message.** Create an **Auto** session. A trivial question →
      answered directly as chat. A decomposable ask → it **proposes** a mission plan (never silently
      starts one). An ambiguous ask → a GenUI **clarify card** ("Quick answer / Run a mission (≈$X,
      N agents)"); take **each** branch and confirm it acts on the choice. Both themes; keyboard the
      clarify card.
- [ ] **Composer mode + autonomy chips.** *Expect:* a **SessionModeChip** (icon + label) beside the
      model chip switching auto ↔ chat ↔ research (**mission is never an offered switch target**),
      and an autonomy control reading **"Autonomy:"** with a 3-level tooltip — **visibly distinct
      axes** (their conflation is what produced the original report). Both are real focusable buttons
      with distinct `aria-label`s.

**§6 · The consolidated both-theme + keyboard pass — 9 boxes.** One pass in **Light** then **Dark**,
keyboard-only where possible, over: the rail **Tools/Context** section + per-server **connection
chips** + **Retry** · the **Manage tools** dialog · the mission **board grid** + **approval queue** +
**spend bar** / per-agent cost badge · the mission **expand modal** + live transcript at 1280 and
1920 · the **debate topology graph** on the board **and** the org chart · the **clarify card** +
mode/autonomy chips · the **MissionPlanCard** grant chips + effective-grant subtitle +
unconfigured-role warning · the **synthesis answer** (markdown + citation chip contrast + Sources
footer + GenUI widget) · the **research hint / web-capability notice** copy.

**Known non-blockers, from the walk file:** the hub-UI Playwright tests are flaky/broken on the local
macOS box (pre-existing) — treat CI as the reference. `review-7R.md` records one **accepted risk**
(INV2: the promotion cap is per-search, not per-turn — not a confinement break) and one **by-design
note** (INV3: a granted-but-unscanned server is not surfaced as a status). Neither blocks acceptance.

---

# Sitting C — a live Claude subscription sign-in

> **Entry condition: a real Max/Pro Claude account, signed in inside the container** (Settings →
> Assistant, `/settings/assistant` — the in-app PTY flow, or the paste fallback). A provider API key
> is *also* useful here for the fallback checks.
> **35 checks across 5 items.** Clears **RM-09 · RM-16 · RM-02** and the subscription boxes of
> **RM-03** and **RM-06**.

> ⚠️ **Sign-in has a history of failing in the image, and both fixes need a rebuild.** Two real bugs
> were found and fixed during the 2026-07-10 owner run: `resolveClaudeBinary()` resolved the SDK's
> bundled CLI from the wrong module scope (`MODULE_NOT_FOUND` under pnpm's nested layout, falling back
> to a bare `claude` the image does not have), and the PTY was `cols: 120`, which hard-wrapped the
> ~350-character authorize URL so `parseAuthUrl` captured only part of `redirect_uri`. Both are fixed
> (`cols: 1000`, SDK-scope resolution preferring the glibc variant) but **require
> `docker compose up --build`** to take effect. The **paste path** is the unaffected always-works
> fallback. Confirm the rebuild before concluding sign-in is broken.

---

## C1 · RM-09 — Claude subscription as a run model (4 checks)

`Ledger: planning/Roadmap/RM-09-claude-subscription/STATUS.md › "Owner-acceptance (needs a signed-in subscription; can't run headless here)"`

- [ ] **A live single run on the subscription drives an MCP server end to end.**
      *Expect:* it renders **identically** to an API-keyed Claude run (D-CS3), and the cost is marked
      **"est. · subscription"** (D-CS4/8) — shadow-priced from exact tokens, never presented as
      billed. *Setup:* a registered MCP server; a test/environment that calls it.
      *Ledger:* box 1 of 4.
- [ ] **A live suite mass-run completes with the shared semaphore holding.** Launch a suite whose
      matrix would otherwise fan out wide.
      *Expect:* the run **completes**, memory stays in check, and concurrency is bounded by the shared
      run+judge subscription semaphore (D-CS2/10). *Ledger:* box 2 of 4.
- [ ] **Both themes + keyboard walk of the accuracy markers** — in the run console, the Runs feed,
      and the reports. *Expect:* every metric that is **not provider-exact** carries its marker
      ("est." / "subscription-reference"), and the marker is legible in both themes.
      *Ledger:* box 3 of 4.
- [ ] **The not-signed-in path is honest.** Sign out (or let the token expire) and launch a run.
      *Expect:* **"auth broken"** plus an honest **run error** — never a fake result (D-CS7).
      *Ledger:* box 4 of 4.

---

## C2 · RM-16 — Model identity (7 checks)

`Ledger: planning/Roadmap/RM-16-model-identity/STATUS.md › "Owner acceptance (not self-certifiable by an agent)"`

- [ ] **A real turn on Anthropic CLI → Sonnet, with NO metered call.** Pin a session to the
      subscription credential and take a turn.
      *Expect:* it answers **and no metered API call is made** (check the provider's own usage, and
      the run's cost basis). **This is the only way criterion 1 can be closed** — every agent proof
      stops at the resolution/branch point or a stubbed driver boundary.
      *Ledger:* box 1 of 7.
- [ ] **`HubModelPicker` at all nine call sites, both themes + keyboard** — plus three surfaces added
      during the plan: the **"Billed to"** panel (WP 3.3), the rebuilt **limit-error banner**
      (WP 4.3), and the composer's **"Pin ⟨model⟩ as this session's model"** action (WP 4.1).
      ℹ️ WP 4.1's keyboard proof was real cmdk under **jsdom, not a browser** — the browser pass is
      genuinely new information.
      *Ledger:* box 2 of 7.
- [ ] **A saved agent pinned to the subscription, launched via a crew, runs on that credential.**
      *Expect:* the credential the agent is pinned to is the one that bills.
      ℹ️ This is the criterion-4 defect WP 6.1 fixed — the pin was **write-only for the entire plan**
      until the adversarial review found it, so it is worth confirming live.
      *Ledger:* box 3 of 7.
- [ ] **Two same-kind credentials are distinguishable in the picker**, and a **broken-credential row
      reads clearly** (not just absent, not silently identical).
      *Setup:* two credentials of the same kind; one deliberately broken.
      *Ledger:* box 4 of 7.
- [ ] **A mission with a subscription-pinned agent (D-MI4) behaves as specified.**
      *Ledger:* box 5 of 7.
- [ ] **Usage shows a distinct "Anthropic CLI" bucket** in `byProvider` — **not** folded into
      "Anthropic". *Ledger:* box 6 of 7.
- [ ] **DECISION — the D-MI5 label.** Does **"Anthropic CLI"** read correctly next to the qualified
      **"Claude CLI judge"**, or do the two names confuse each other?
      *Ledger:* box 7 of 7.

---

## C3 · RM-03 — the subscription box (1 of 18)

`Ledger: planning/Roadmap/RM-03-assistant-hub/STATUS.md › "Owner-acceptance…" group 1, box 3`
*RM-03's other 17 ledger boxes are **B9**; its 23-box walk is **B10**.*

- [ ] **`claude_subscription` in the Hub.** *Expect:* a **real sign-in**; a session that goes
      **`queued`** under the D-CS10 semaphore; **exact tokens**; the cost **marked as shadow**; and on
      a limit error, an **explicit retry-on-the-other-source** action — **never a silent fallback**.

---

## C4 · RM-06 — the CLI-judge chain (1 of 7)

`Ledger: planning/Roadmap/RM-06-auto-rating/STATUS.md › "Owner acceptance (owner-only)" box 1 of 7`
*RM-06's other 6 boxes are **B4**.*

- [ ] **The judge chain degrades honestly, three steps down.**
      1. **With a signed-in subscription:** a run rates automatically via the **CLI judge** —
         provenance reads `claude_cli`, tokens are **real**, cost is **0**.
      2. **Pull the subscription:** the next run **falls back to the provider judge**.
      3. **Remove that too:** a **deterministic-only** report, with the LLM facets honestly marked
         **`unevaluable`** — not silently scored, not zero.
      *Setup:* a provider key for step 2, then removable.

---

## C5 · RM-02 — Assistant (the dock) (22 checks)

`Ledger: planning/Roadmap/RM-02-assistant/STATUS.md` — **five separate owner-acceptance sections**,
grown by four refinement rounds. They are listed here in ledger order; do them in the order below.

> ℹ️ RM-02 is the **largest single block in the roadmap** (22 boxes). RM-35 §3c notes they are "four
> separate refinement rounds that each grew their own acceptance section rather than merging into
> one" — so expect overlap between R2/R3/R4 and the base walk, and do the shared both-theme/keyboard
> pass **once**.

### Base — `## Owner-acceptance (needs the owner: subscription sign-in, live walks)` (6)
- [ ] **Live in-app sign-in (PTY flow) with the real Max/Pro account; paste fallback verified.**
      *Setup:* container egress to `claude.com` / `claude.ai`; **`docker compose up --build`** first
      (see the Sitting C warning). Remaining step from the 2026-07-10 run: complete the round trip —
      authorize in the browser → paste the code → token captured. *Ledger:* base box 1 of 6.
- [ ] **Canonical flow 1 — run-console failure triage on a real failed run.** *Ledger:* base box 2.
- [ ] **Canonical flow 2 — skill page → analyze recent runs → the agent edits the skill → approve →
      a new version visible with the correct diff.** *Ledger:* base box 3.
- [ ] **Subscription limit → the explicit "Retry on API key" action** on the dock's limit-error
      banner (WP 3.3). *Expect:* it **actually retries** (no silent spend on the wrong source) **and**
      the resumed conversation carries over — or, if resume-across-sources turns out unsupported, the
      failure **surfaces loudly** rather than silently dropping the retry. *Ledger:* base box 4.
- [ ] **Both themes + keyboard walk of:** the dock generally · **Settings → Assistant**
      (`/settings/assistant`: sign-in flow, paste field, fallback picker, sign-out confirm) ·
      **Settings → Storage & maintenance** (`/settings/storage`) and its new **"Prune assistant
      threads"** row · and specifically the WP 3.3 additions — the **limit-error banner** (retry
      button / Settings-link fallback / re-sign-in hint) and the dock header's **"Expiring soon"**
      token-expiry badge. *Ledger:* base box 5.
- [ ] **Container restart mid-thread → the thread resumes.** *Expect:* orphan reconciliation to
      `idle` plus a synthesized error event on restart. Unit-tested; **a real Docker restart with a
      live child was never exercised.** *Ledger:* base box 6.

### R1 — the skill edit loop (4) *(the ledger notes R1 was on `ux/integration`; that branch no longer exists locally and the code is present on `main` — verify by looking)*
- [ ] **Rule 1 / D-AS19 — the scope lock holds.** Skill page → **"enhance this skill from recent
      runs"**. *Expect:* it **reads** runs but **only edits the skill**; an attempt to touch the
      environment is **denied with a visible reason**. *Ledger:* R1 box 1.
- [ ] **Rule 2 / D-AS20–21 — it reads its references first.** *Expect:* the assistant reads
      `references/*` **before** editing and follows the bundled skill-authoring reference.
      *Ledger:* R1 box 2.
- [ ] **Rule 3 / D-AS22 — the live edit loop.** *Expect:* edits appear **live** in the Files view
      with the UI **auto-navigating to each changed file**; review the **accumulated** diff; approve
      the **single** `skills_commit_workspace` → **one** new version. Both themes + keyboard.
      *Ledger:* R1 box 3.
- [ ] **D-AS23 — the dock Scope chip reads correctly as you navigate.** Both themes + keyboard.
      *Ledger:* R1 box 4.
      ℹ️ The ledger's R1 follow-ups (S1, S2, the skill-creator vendoring gap, and two id-matching
      findings) are **prose, not boxes** — none blocks. Two are worth knowing while you walk:
      **finding 2** is reversible and live today (`collections_modify` `remove_test`/`remove_suite`
      are not id-matched under `collection` scope, so a child of *another* collection can be re-homed
      — membership only, no data loss); **finding 3** is latent and unreachable today but MUST be
      closed before `scenario`/`test` URL pins land.

### R2 — per-entity threads · release-on-reply · names/dates (4)
- [ ] **Per-entity threads.** On an MCP server (or skill/scan/run) page, the dock switcher shows
      **only that entity's** threads; **"+ New thread"** there is **pinned** to it; **"Show all
      threads"** reveals the global list. *Ledger:* R2 box 1.
- [ ] **Release-on-reply.** Rapidly use several threads. *Expect:* **no "too many sessions"** — after
      each reply the session **releases**, and the next message **resumes** the same conversation.
      (Real cross-session context reload needs a live token; the offline tests prove only the
      `resume: sdkSessionId` wiring.) *Ledger:* R2 box 2.
- [ ] **Thread names and dates.** *Expect:* a **meaningful name** — message-derived immediately, then
      upgraded to a crisp LLM title after the first reply when `ASSISTANT_AUTO_TITLE` is on (a real,
      small spend on the thread's auth source) — plus a **relative date**, and working inline
      **rename**. Both themes + keyboard. *Ledger:* R2 box 3.
- [ ] **DECISION — the `ASSISTANT_AUTO_TITLE` default.** It ships **ON** (D-AS26's intended
      behaviour; a bounded one-shot on `claude-haiku-4-5` with a silent deterministic fallback). Set
      `ASSISTANT_AUTO_TITLE=false` for the deterministic title only, with no extra spend. Decide and
      record. *Ledger:* R2 box 4.

### R3 — starter chips (4)
- [ ] **Context-appropriate starters on every pinned page.** Open a new thread on a **server / scan /
      skill / run / suite-run / compare / collection / compatibility** page. *Expect:* relevant
      starter chips. Then check the **data-aware** ones fire: a **failed scan**, a **failed run**, an
      **L2-over-budget skill**, a **low suite pass-rate**. Then `/dashboard` → the cross-cutting
      `global` starters. *Ledger:* R3 box 1.
- [ ] **A starter prefills; it never auto-sends.** *Expect:* clicking a starter **prefills** the
      composer and you press send. **Action** starters (server "Adjust config", skill edits,
      collection "Organize") appear **only on their in-scope page** and go through the normal
      approval; read-only surfaces (run / scan / compare / compatibility) show **analysis starters
      only**. *Ledger:* R3 box 2.
- [ ] **Both themes + keyboard:** the chip row reads correctly and is reachable/focusable in the dock
      empty state. *Ledger:* R3 box 3.
- [ ] **Acknowledge the three deferred-and-recorded gaps (NOT defects).** (1) **Environment/Test**
      starters are authored but not emitted until `/testing/environments` publishes a
      `scenario`/`test` URL pin. (2) **Skill tab** variants are authored but dormant until the skill
      page emits `?tab=`. (3) The skill **`[?quality score low]`** conditional is authored and
      scope-checked but not emitted until a cheap quality-score cache exists.
      *Ledger:* R3 box 4.
      ⚠️ **Gap (2)'s premise looks stale.** `SkillInspector.tsx` reads **`?tab=`** today
      (`searchParams.get("tab")`, tabs `overview|files|quality|usage|issues|security|versions|diff`);
      the box says "it uses `?mode=` today". Whether the *assistant envelope* forwards the tab is a
      separate question — worth checking rather than assuming still-dormant.

### R4 — MCP tool calls, issue filing, blank-session-on-open (4)
- [ ] **MCP tools from the dock.** On a run page, ask the assistant to **list a registered server's
      tools** (`mcp_tools_list`) and **call one** (`mcp_tool_call`). *Expect:* the approval card shows
      **server + tool + arguments**; the result **and its token cost** render; toggling **per-thread
      auto-accept** lets a follow-up call run without a prompt. *Ledger:* R4 box 1.
- [ ] **File an issue against the skill a run used.** From the same run, ask it to file one
      (`rating_issue_file`). *Expect:* approval, then the issue appears on the skill's **Issues** tab
      (`GET /api/skills/:id/issues`) **and** in the export; **re-filing the same title adds a
      sighting, not a duplicate**. *Ledger:* R4 box 2.
- [ ] **Opening the dock starts a blank session** each time (toggle or **⌘J**); previous threads are
      still listed in the switcher; a page-hook **"Analyze…"** open still lands on its **pinned**
      thread. *Ledger:* R4 box 3.
- [ ] **Both themes + keyboard walk of the new approval cards and results in the dock.**
      *Ledger:* R4 box 4.

---

# Sitting D — a real CI pipeline

> **Entry condition: somewhere GitHub Actions can actually run.** Either push `main` to `origin`
> (RM-35 Wave 0 step 1 — `main` has been ahead of `origin/main`, and `.github/workflows/mcp-self-scan.yml`
> has never seen this code), **or** copy the two example workflows into a throwaway repository with a
> service token and execute them there.
> **6 checks, all RM-08.** *Completes* **RM-08** — its other boxes are **A10** (7) and **B8** (1), so
> this sitting is what finally retires it. The last of the four, and the only one with a prerequisite
> the owner does not currently have.

`Ledger: planning/Roadmap/RM-08-ci/STATUS.md › "Owner acceptance (owner-only)"`
*Covers boxes 3, 4, 8, 9, 11 and the second half of 13.*

> ⚠️ **The example workflows have never been executed by anything.** They are shipped as *examples*
> in `examples/github-actions/`, not as live workflows in this repository, and are held honest only
> by a text test that reads them. Everything in this sitting is genuinely first-run.

- [ ] **D1 · WP 2.3 — the example workflow, actually executed. (The one that matters most.)** Copy
      `examples/github-actions/mcpfp-footprint-gate.yml` into a repository that owns an MCP server and
      let GitHub Actions run it.
      *Expect:* the **health wait** works; the **scan** and **assert** steps fail **independently**
      (a scan failure must not read as an assertion failure); and **`gh pr comment` posts the body**.
      *Ledger:* box 9 of 13.
- [ ] **D2 · WP 1.2 — `mcpfp` from a real pipeline.** A CI step that runs `pnpm build` then
      `node apps/cli/dist/index.js report scan <id> --format json > report.json`.
      *Expect:* the file **parses**; a deliberate failure (stop the API) fails the step with exit
      **2**. Then a **non-loopback** invocation
      (`--url http://<lan-ip>:8080 --token mcpfp_…`) **succeeds with a `read` token** and is
      **refused without one**.
      *Ledger:* box 3 of 13.
- [ ] **D3 · WP 1.3 — `mcpfp assert` from a real pipeline, and the exit-code contract.**
      *Expect, in order:* a gate file the change genuinely breaches → exit **1**, **naming the rule**;
      the same job with the API **stopped** → exit **2**; a server's **first** scan → the baseline
      rules report as **skipped**, it **warns**, and it still exits **0**; a **remote** (non-loopback)
      `assert` is **refused without a token** and **succeeds with an execute-scoped one** (D-C10).
      *Expect the distinction to hold:* `1` = "the gate said no", `2` = "the gate could not run".
      *Ledger:* box 4 of 13.
- [ ] **D4 · WP 2.2 — a quality gate that genuinely fails, and its PR comment.** Write a
      `min-suite-score` your current suite **misses**, run
      `node apps/cli/dist/index.js assert --format markdown`, and **read the rendered comment**:
      does the **verdict line**, the **grade/cost delta** and the **collapsed detail block** tell you
      what to do? Post it on a **real PR** and confirm GitHub renders the **two delta lines as two
      lines**. Then assert against a suite run that is **still rating** and confirm a **400** rather
      than a low score.
      *Setup:* a graded suite (Sitting B) and a real PR.
      *Ledger:* box 8 of 13.
- [ ] **D5 · WP M.4 — `mcp-self-scan.yml` runs green on GitHub.** Once the branch reaches GitHub, the
      repository's **only** workflow must run green: `pnpm mcp:self-scan` re-measures the workbench's
      own MCP mount against the **3,000-token definition budget** (currently **24 tools · 2,749
      tokens**), exiting **1** over budget and **2** on failure.
      *Expect:* green, and the gitignored `.artifacts/mcp-self-scan/` JSON + Markdown artifact
      produced. **Never executed.**
      *Ledger:* box 13 of 13 — **the second half**; the llms.txt/onboarding half is **A10**.
- [ ] **D6 · A repository with an MCP server gated end to end.** PR → workflow → **scan + suite +
      assertions** → a **PR comment with deltas**; then a **deliberate budget breach fails the
      check**.
      *Expect:* the whole chain, unassisted, on a real PR.
      *Ledger:* box 11 of 13.

---

# Appendix 1 — pending walks with no ledger box

These are real, unrun owner walks recorded as **prose**, not checkboxes. `/complete-roadmap` is not
blocked by any of them, so they are not in the sittings above — but they are the same kind of debt,
and losing them would be the failure this document exists to prevent.

| Where | What is pending |
| --- | --- |
| **RM-17** observability · `STATUS.md` › "Owner-acceptance (pending — grows as WPs land)" | Both-theme + keyboard walks of: Dashboard tabs, the runs-feed filter bar, the rules UI, the notification center, the issues tab, the review queue, the pricing editor, the sessions lens. Live walks needing real credentials/tenants: the judge-chain LLM clustering assist (5.2), the assistant issue loop (5.4), a webhook test-fire to a real Slack endpoint. Data-quality spot-checks: FTS relevance on a real corpus; metrics drill-down counts matching the runs feed; capability-split series rendering honestly for a mixed suite (API + CLI + vendor). **RM-17 has 28 of 29 WPs done; the last is WP 3.5, gated on an owner decision about the Langfuse amendment (AM-OB1–14). Rejecting the amendment makes RM-17 retirable with zero owner-acceptance boxes — the cheapest retirement in the roadmap.** |
| 🗄 **RM-21** server-types · `completed/…/STATUS.md` › "Owner-acceptance (pending)" | Retired with four unrun prose walks: **Phase 2 visual** (grouped ServerRail — ⚠️ *since deleted by RM-32*; the wizard type picker; server-detail toolbar/profile badges; the Manage-types dialog incl. inline 409 and delete-detaches confirm); **Phase 2 live** CRUD against a real fleet; **Phase 3 live** (a skill bound to a type whose tools validate against the representative member, and the representative re-resolving as members/scans change); **Phase 3.2 visual** of the Skill IDE type chip, the Bind dialog's Types section, and the New-skill wizard's Server\|Type toggle. Also records the 2026-07-12 reachability fix that moved the binding UI out of the parked Design tab onto **Overview** and **Files**. |
| 🗄 **RM-28** toolbar-reach · `completed/…/STATUS.md` | The PM-as-owner walk was **DONE 2026-07-25** on measured geometry, but left explicit **owner-pending** items needing a provider key or seeded data: run-console visuals (A-1/2/3), content-bearing rows (Compatibility / Compare / Usage / KPI), a live theme switch, and icon-hover at scale. Also four carry-forwards: the **IconButton-in-Dialog Escape hazard** (a modal auto-focusing an `IconButton` opens its tooltip, which eats the first Escape — one instance fixed, others may exist); the `FacetFilter` `h-26` vs `Button` `h-30` ~2px residual on mixed toolbar rows (upstream); `Composer.tsx`'s `SpeechInput` keeping a bare native `title` (upstream); and two cleanup calls (`agents/CrewEditor.tsx` + `CrewLibraryPanel.tsx` look like dead code; the `/skills → "Skills > Skills"` breadcrumb redundancy). |
| 🗄 **RM-33** cache-aware tokens · `completed/…/STATUS.md` | All five boxes are **ticked** — but each carries a *"Still owner's to judge"* rider that nobody has answered: whether the cache wording and chart colours read well; whether the Trace tooltip wording reads well; whether the focus order feels right by hand; and **whether a cost band this wide is useful in the launcher**. That last one is what produced **RM-34**, whose WP 2.1 is still open. |

---

# Appendix 2 — corrections found while assembling this

Every item here is a place where a ledger box describes software that has since moved. None is a
defect in the box's *intent*; all of them would waste a sitting if discovered live.

1. **⛔ The Skill inspector's Design and Trace tabs are HIDDEN** (owner decision **O2b**;
   `apps/web/src/features/skills/SkillInspector.tsx` rewrites `design`/`trace` → `files` in
   `requestTabChange`, and an effect bounces deep links the same way). Un-parking is **RM-30 Phase 7**
   (Skill Studio, 6 WPs, not built). **This makes roughly 6 of RM-22's and RM-23's 11 open boxes
   unrunnable today.** `SuggestionCard` and `SkillTraceView` live under `features/skills/trace/`;
   `SkillGraphCanvas`, `UnifiedEditor`, `ToolsPalette`, `ProblemsPanel` and all of `design/code-intel/`
   live under `features/skills/design/` — each with exactly one importer, the hidden tabs.
2. **Port 8080 is not this app on this machine.** Boxes in RM-23, RM-24, RM-26 and RM-08 name
   `localhost:8080` / `127.0.0.1:8080`. `docker-compose.yml` publishes **8081**, and 8080 is held by a
   different checkout's long-running container (plus, on 2026-08-19–21, a stale dev server).
3. **There is no servers rail.** RM-20's WP 2.1 box says to "check the servers rail badges". RM-32
   deleted `ServerRail`. The posture badge is now on the **`/servers` overview** cards and as a
   sortable `posture` column in table mode (`ServersOverview.tsx`), fed by one fleet-wide request.
4. **RM-27's "4 redirects" are not the original four.** design-remediation T8 deleted
   `/testing/tests → collections` and `/testing/suites → collections`, promoted `/testing/suites` to a
   real route, and added `/testing/runs/review → /testing/review`. The four in `App.tsx` today are
   listed in **A2**.
5. **`/assistant/memory` and `/assistant/usage` are redirects.** RM-03's walk (**B10**) describes them
   as pages. They now `<Navigate>` to `/assistant?memory=profile` and `/assistant/agents?tab=usage`
   respectively — and the workforce surface RM-03 §3 describes was rebuilt by RM-04. Use **B11** for
   those three.
6. **RM-02's R3 "the skill page uses `?mode=` today" looks stale.** `SkillInspector` reads
   `searchParams.get("tab")` and its tab set is
   `overview|files|quality|usage|issues|security|versions|diff`. Whether the assistant *envelope*
   forwards the tab is a separate question; do not assume the starter is still dormant.
7. **Four branch names in the ledgers no longer exist locally, and their code is on `main`.**
   `ux/integration` (RM-30, RM-02 R1), `feat/assistant-hub` / `feat/assistant-hub-ux` (RM-03, RM-04)
   and `feat/crew-nesting` (RM-10) are absent from `git branch -a`, while
   `apps/web/src/components/TabPanel.tsx`, `apps/web/src/features/hub/` and
   `apps/api/src/hub/missions/crew-resolution.ts` are all present. Treat each box's "…and merge to
   main" clause as satisfied, and verify by looking rather than by merging.
8. **The Docker image was unbuildable until 2026-08-21.** The Dockerfile's `deps`/`prod-deps` stages
   copied workspace manifests by hand and had never learned about `apps/cli` or
   `packages/illustrations`, so the in-container `pnpm build` died with
   `Cannot find module '@mcp-token-footprint/shared'`. Four `COPY` lines fixed it. **No gate builds
   the image**, so confirm your build actually succeeded before trusting any container-based check.
9. **RM-02's ledger carries 22 open boxes, not 18.** The count in some summaries is 18; the ledger's
   five owner-acceptance sections hold **4 (R1) + 6 (base) + 4 (R2) + 4 (R3) + 4 (R4) = 22**. RM-35
   §3c agrees on 22.
10. **`pnpm mcpfp` is not the CI invocation.** pnpm prints a banner on stdout (breaking
    `--format json > file`) and, with `--silent`, collapses every non-zero exit to **1** — the code
    D-C7 reserves for assertion failures. Every RM-08 check above uses
    `node apps/cli/dist/index.js …` after one `pnpm build`.

---

# Tally

| Sitting | Entry condition | Checks | Items cleared |
| --- | --- | ---: | --- |
| **A** | A browser and the running container | **39** | RM-01 · RM-05 · RM-20 · RM-22 · RM-24(P1) · RM-26(5.4) · RM-27 · RM-30(1/2) · RM-32 · RM-08(7 boxes) |
| **B** | One provider API key | **113** | RM-23 · RM-07 · RM-10 · RM-06(6/7) · RM-24(P2) · RM-26(3/4) · RM-30(2/2) · RM-08(1 box) · RM-03(17/18) · 🗄RM-04 · 🗄RM-13 |
| **C** | A live Claude subscription sign-in | **35** | RM-09 · RM-16 · RM-02 · RM-03(1/18) · RM-06(1/7) |
| **D** | A real CI pipeline | **6** | RM-08(6 boxes) |
| | **Total** | **193** | **192 distinct boxes** |

Per source file: RM-01 1 · RM-02 22 · RM-03 18 + 23 (walk) · RM-05 2 · RM-06 7 · RM-07 5 · RM-08 13 ·
RM-09 4 · RM-10 9 · RM-16 7 · RM-20 10 · RM-22 7 · RM-23 4 · RM-24 2 · RM-26 4 · RM-27 1 · RM-30 2 ·
RM-32 8 · 🗄RM-04 walk 15 · 🗄RM-13 walk 28 = **192**.

Excluded and why: see *What is NOT in here*. Currently unrunnable: **~6 checks blocked by O2b**
(RM-22 boxes 1, 6-part, 7; RM-23 boxes 1, 2, 3, 4-part) and **1 likely blocked by open engineering**
(RM-03's MCP elicitation box, pending RM-03 WP 2.3).
