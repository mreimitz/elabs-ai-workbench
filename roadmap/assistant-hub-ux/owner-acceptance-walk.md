# Assistant Hub UX — Owner-acceptance walk (WP4.2)

A concrete click-through the **owner** runs against the **live app** to sign off the Assistant Hub
UX rebuild (Waves 0–3, decisions D-HUX1…16). For every surface it lists **what to click** and
**what to expect**, and it names the cross-cutting variants — **both themes**, **keyboard-only**,
**reduced-motion**, **decoration-minimal** — plus the checks that need a **provider key** or a
**registered MCP server** (called out with 🔑 / 🔌).

> **Honesty note (read first).** WP4.2 landed the code-feasible a11y/UX fixes (composer clearance,
> org-chart node keyboard parity, the session-switcher purpose label) and documented the genuine
> brand-ui gaps — verified by `pnpm typecheck && pnpm test && pnpm lint`. The **rendered both-theme
> visual walk itself is NOT yet done**: the WP4.2 sandbox had no Chromium, so no screenshots were
> taken and no pixels were inspected. **This document is that walk, for the owner to perform here.**
> Nothing below should be read as "already verified visually."

---

## 0. Setup

1. Run the app the way the reference instance runs — Docker on **http://localhost:8080/**
   (`docker compose up --build`), or a `vite preview` of `pnpm build` (a bare `pnpm dev` trips the
   `@elabs-ai/components-editor` worker prebundle — use the build). The dot-grid canvas, choreography, and meta
   rail only read correctly in a real browser, not a test renderer.
2. Have ready, for the 🔑/🔌 steps: **a provider key** (entered in Settings → Providers; the
   `claude_subscription` path too if you want to exercise it) and **at least one registered MCP
   server that has been scanned** (Servers view → add → scan), ideally a research-capable one
   (Tavily/Brave/Exa preset) for research mode.

### How to drive each variant

| Variant | How to drive it | Applies to |
|---|---|---|
| **Theme: Light ↔ Dark** | The theme switcher (System · Bright · Dark) lives in the **top bar**, not Settings. Toggle it and re-look at the SAME surface. Do every section in **both** themes. | Every surface. Watch: crew accents, the dot grid, status badges, dashed/`--border` outlines, muted text. |
| **Keyboard-only** | Put the mouse down. `Tab`/`Shift+Tab` to move, `Enter`/`Space` to activate, `Esc` to close overlays, arrow keys inside menus/tabs. Every step must be reachable with a **visible focus ring**. | Every interactive surface. |
| **Reduced-motion** | Turn on the OS setting (macOS: System Settings → Accessibility → Display → **Reduce motion**), reload. The hub reads `prefers-reduced-motion` live (`@elabs-ai/components-tokens` `useReducedMotion`). | The first-prompt choreography (§1) primarily; nothing else should animate meaningfully. |
| **Decoration-minimal** | There is **no live density toggle in Settings yet** (the dot grid is gated in code by `ChatCanvas`'s local `DecorationProvider`; `decorationLevel={0}` removes the grid — a future density setting will surface it). So the decoration check here is: confirm the grid is **purely decorative** — it never reduces text legibility in either theme, and removing it (were the setting present) would leave the transcript fully intact. Flag if the grid ever competes with text. | The workspace transcript (§1). |

---

## 1. Workspace — `/assistant` (transcript + choreography + meta rail)

### 1a. First-prompt choreography (D-HUX13)
- **Click:** nav **Assistant** → **New session** (session switcher, top-left of the workspace
  toolbar) → pick a mode → create.
- **Expect (fresh session):** the composer opens **centered** with a greeting ("What should we dig
  into?") and starter **Suggestion** chips above/below it; the dot-grid canvas shows behind.
- **Click:** type a prompt (or click a starter) and send. 🔑 (a real turn needs a provider key).
- **Expect:** the composer **glides once** (~240 ms, transform-based) down to the docked position;
  greeting + chips fade out; the transcript builds above it. It docks **once per session** and never
  re-opens the invitation mid-conversation.
- **Reduced-motion:** the SAME fresh session still shows greeting + interactive chips (never
  `aria-hidden`), and on send it **snaps** to docked with **no glide** — content is never hidden,
  only the animation is dropped. A session **reopened with history** starts docked instantly in both
  motion modes.
- **Both themes:** greeting/chips/composer legible; the dot grid stays a quiet texture (not a
  competing pattern) in Bright and Dark.

### 1b. Composer clearance — the WP1.R-C fix (verify carefully)
- **Click:** in a session **with a few messages**, grow the composer: type several lines, attach a
  file or two (paperclip → the attachment chips stack above the textarea), and start a turn so the
  **Stop** button appears.
- **Expect:** the **last transcript message is never covered** by the docked composer at any composer
  height. Scroll to the bottom — there's always clearance between the last message and the top of the
  composer. (Previously a fixed 160 px reserve under-reserved for a tall composer; the reserve now
  tracks the measured composer height.)
- **Keyboard-only:** the composer, model selector, attach, plan-first toggle, send, and Stop are all
  Tab-reachable with visible focus; sending never steals focus unexpectedly.

### 1c. Meta rail (D-HUX3)
- **Click:** the meta-rail **show/hide** toggle in the toolbar; expand/collapse **Progress**,
  **Outputs**, **Context** individually.
- **Expect:** one 360 px rail, its own scroll; counts remain visible when a section is collapsed;
  Outputs merges artifacts + workspace files; Context shows the session's **effective memory stack**
  (profile → project → crew → agent, in injection order, each entry tagged). Under a narrow content
  width (~<1100 px) the rail becomes a **Sheet** instead. 🔑 live Progress/Context need a running
  session.
- **Both themes / keyboard:** section headers are buttons with focus rings; the Sheet traps focus and
  closes on `Esc`.

---

## 2. Sessions — `/assistant/sessions` (D-HUX4)

- **Click:** the session-switcher's **"View all sessions →"**, or nav Assistant → **Sessions**.
- **Expect:** a sortable/filterable `DataTable` (status, mode, project, model, turns, tokens in/out,
  cost, updated, last error, open). Sort a column; toggle **Show archived**; open a row → returns to
  the workspace on that session.
- **Session switcher purpose label — the WP4.2 affordance:** the switcher's trigger shows the active
  session **title**; it is wrapped in a `role="group"` labelled **"Session switcher"** so assistive
  tech announces the control's purpose (the title alone doesn't). (Brand-ui gap: the `Combobox`
  can't take a trigger-level `aria-label` — see the Gaps appendix.)
- **Keyboard:** the switcher opens with `Enter`, filters as you type, arrow-selects, and the two
  pinned actions ("View all sessions →", "+ New session") are reachable and fire their own action,
  not a session select.
- **Both themes:** status badges use the shared `StatusBadge` vocabulary and read in both themes.

---

## 3. Workforce — `/assistant/agents` (D-HUX5)

One `PageHeader`, tabs **Directory · Org chart · Usage** (URL `?tab=`), a shared **org rail** (All
agents / Crews (each with a count + color dot) / Unassigned / Archived; URL `?scope=`).

### 3a. Directory tab (`?tab=directory`)
- **Click:** an agent **card** (single-click = select → card highlights); **double-click** (or the
  card **⋯ → open**, or `Enter` on a focused card) = open its profile modal. Switch the org rail
  scope to a crew, to Unassigned, to Archived.
- **Expect:** single-click selects without opening; the ⋯ menu opens without selecting; scoping the
  rail filters the grid; exactly **one** `EmptyState` per region (e.g. a deleted-crew scope shows one
  empty state, not two).
- **Crew color (D-HUX8):** color appears ONLY as small accents — a 3 px card top border, the avatar
  ring, a dot next to names, always paired with the crew name; **never** a fill or text color.
  Multi-crew agents show stacked dots in "All agents".
- **Keyboard:** a card is `role="button"`, `tabIndex=0`, `Enter` opens it, visible focus. (Minor,
  logged: it activates on `Enter` but not `Space` — see the sweep note in STATUS.)
- **Quick-create:** the **+ New** action opens a ≤6-field `FormDialog`; **Create agent** with an
  empty name fails **loudly** (inline "Name is required." + toast), never a silent no-op.

### 3b. Org chart tab (`?tab=org`) — the WP2.R keyboard fix (verify carefully)
- **Click (mouse):** single-click a node → the **InspectorPanel** (right) populates; **double-click**
  a node → opens its agent/crew profile modal. Pan/zoom, minimap, legend all present.
- **Keyboard-only — the parity fix:** `Tab` into the canvas and onto a node → the **inspector
  populates** for that node (mirrors a mouse click). Press **`Enter` or `Space`** on a focused node →
  its **profile modal opens** (mirrors the double-click). Canvas chrome (zoom controls, minimap) is a
  no-op for these keys. The inspector's empty prompt now reads "…Double-click — or focus a node and
  press `Enter` — to open its profile."
- **Expect:** edges inside a crew draw its **real topology** (pipeline chain · parallel fan · debate
  pair · best-of-N fan-in); the legend maps crew colors + topology arrows. 🔌🔑 a meaningful chart
  needs **≥2 crews with members** seeded (create them in Directory, or via a real mission).
- **Both themes:** crew group tints and the `--canvas`/`--border` chrome read in both; the topology
  arrows stay legible on the `bg-card` canvas.

### 3c. Usage tab (`?tab=usage`)
- **Click:** a `DateRangePicker`, group-by (agent · crew · model · project · mode), then a ranked
  table row to **drill** (URL-held) down to sessions → replay.
- **Expect:** the `MetricGrid` + charts + table reconcile — `sum(rows) == total` for every group-by;
  **unattributed spend** shows as an explicit **"no agent" bucket**, never a silently short total.
  🔑 real numbers need a provider key + real spend; with none, expect empty/zeroed states, not
  errors.
- **Redirect check:** visit `/assistant/usage` → it lands on `/assistant/agents?tab=usage`.

---

## 4. Profile modals (D-HUX6) — agent & crew

Open from Directory (double-click / ⋯) or the org chart (double-click / `Enter`). Both are
`WideDialog nav="rail"` modals; the URL carries `?settings=<section>`.

### 4a. Agent profile
- **Sections (rail):** Profile · Instructions · Model · **Access** · Skills · Memory · Budgets ·
  Usage. Click through each with mouse, then **keyboard** (`Tab` to the rail, arrow/Tab between
  sections); a dirty-guard warns before discarding unsaved edits; the primary button states its
  consequence.
- **Access (D-HUX7) — the centerpivot 🔌🔑:** per registered MCP server a **tri-state** master
  checkbox (none/some/all), **per-tool** checkboxes, a per-server **search**, **All/None**, live
  counts, and — the point — **every tool row shows its scan-measured token cost**, with a running
  **Granted footprint** total. Grant some tools, flip the master, search, and watch the footprint +
  the "N / M tools" badge update. A granted server with **no scan** is called out (its cost can't be
  counted). Needs a **scanned** MCP server to show real tool rows + costs.
  - **Tri-state glyph — brand-ui gap (confirm, don't expect a fix):** the master checkbox in the
    "some" state is `aria-checked="mixed"` (correct for AT), but its **glyph looks identical to
    checked** — a brand-ui `Checkbox` limitation. The **"N / M tools" badge beside it disambiguates**
    the state visually. Confirm the badge is present and the count is right. See the Gaps appendix.
- **Both themes:** the footprint panel, badges, and tool rows read in both; `tabular-nums` on token
  counts line up.

### 4b. Crew profile
- **Sections:** Profile · Members · Topology · Budgets · Memory · Usage.
- **Click:** the **color picker** (Profile) — exactly five `--chart-1…5` swatches + a "No color"
  option; each swatch is a real radio with an `sr-only` label ("Color 1"…"Color 5", "No color"),
  keyboard-arrow-selectable, `aria-label="Crew color"`. Set/clear a color and confirm it propagates
  to the card border/dot and the org-chart tint.
- **Topology:** the section renders the crew's topology graph (the same `CrewTopologyGraph`).
- **Both themes:** swatches show the real theme-aware hue (the one place color is a fill — documented
  exemption); neutral "Color N" labels (not hue names) because the hue differs per theme.

---

## 5. Projects — `/assistant/projects` (D-HUX3/§WP3.3)

- **Click:** nav **Projects** → a project → its detail (Descriptions, a **files** `DataTable`, a
  **sessions** link, pinned context).
- **Expect:** no fixed-height inner frame (the old `h-[46rem]` is gone — the page scrolls as one
  region); the files table sorts; the sessions link deep-links to `/assistant/sessions?projectId=…`.
- **Keyboard / both themes:** table + links reachable with focus rings; descriptions legible in both.

---

## 6. Audit — `/assistant/audit` (D-HUX14/§WP3.2)

- **Click:** nav **Audit** → filter/search the timeline; click an agent/crew link; click an outcome
  to deep-link into a session replay (`/assistant?message=…` scrolls the transcript to that turn).
- **Expect:** `PageShell headerVariant="toolbar"` grammar; **sticky day-group** headers; outcomes via
  `StatusBadge` (complete/failed); one `EmptyState`; an error state offers **retry**.
- **Both themes / keyboard:** sticky headers, links, and filters read + focus in both.

---

## 7. Scoped memory (D-HUX11)

- **Redirect:** visit `/assistant/memory` → it opens `/assistant?memory=profile` — the **profile
  memory** manage dialog in the workspace.
- **Click:** open the dialog; from the workspace **Context** section read the **effective stack**
  (profile + project + crew + agent, injection order, each tagged + linked); entity memories live in
  their profiles/detail. A save-proposal (from the assistant) carries a **scope picker** defaulting to
  the most-specific sensible owner; conflicts resolve **most-specific-wins**, shown transparently.
- **Note:** memory is provider-independent; if no provider is configured the workspace may still show
  the provider "not configured" gate around it (inherited) — the memory dialog itself is reachable via
  the redirect.

---

## 8. Nav & redirects (D-HUX15)

- **Expect:** exactly **4** hub nav items — **Assistant** (+ **Sessions** child), **Agents & Crews**,
  **Projects**, **Audit**. Exactly **one** nav item is active at a time (the Assistant parent must
  NOT also light up on Agents/Projects/Audit). Breadcrumbs render on `/assistant/sessions`.
- **Redirect matrix to click:** `/assistant/memory` → `/assistant?memory=profile`; `/assistant/usage`
  → `/assistant/agents?tab=usage`. Both land on a real, param-consuming target (not an interstitial).

---

## 🔑🔌 Provider-key / MCP-server-gated items (do these last, with credentials)

1. **Live session + choreography (§1):** a real turn against a provider key — greeting → send →
   glide → transcript builds; meta-rail Progress/Context populate live.
2. **`claude_subscription` path:** if used, a session on the subscription auth source runs and, on a
   limit, surfaces the explicit retry-on-the-other-source affordance (inherited from the dock).
3. **Access token costs (§4a):** a **scanned** MCP server so tool rows show real `totalTokens` and the
   Granted footprint sums a real set; confirm the "no scan yet" and "granted-but-unscanned" callouts.
4. **Org chart with ≥2 crews (§3b):** seed ≥2 crews with members (mixed topologies) so the chart
   draws real containers + topology edges; then run the keyboard parity check on real nodes.
5. **Usage drill on real spend (§3c):** a provider key + a few runs so the group-bys and the drill →
   sessions → replay reconcile against real numbers, and the "no agent" bucket appears if any spend is
   unattributed.
6. **Research mode (§1a):** a research-capable server registered so a `research`-mode session shows the
   research empty-state guidance and, on a run, inline citations.

---

## Appendix — brand-ui gaps (documented, not owner-blocking; upstream to raise)

These are genuine `@elabs-ai/components-*` limitations found in WP4.2. Each has a safe in-app affordance; the real
fix is upstream in `@elabs-ai/components-ui`.

1. **Tri-state `Checkbox` indeterminate glyph** (Access master checkbox, `AccessSection.tsx`).
   `checked="indeterminate"` renders the correct `aria-checked="mixed"`, but the **glyph is visually
   identical to the checked state** — brand-ui's `Checkbox` draws no distinct "mixed" mark.
   *In-app affordance:* the **"N / M tools" badge** beside the checkbox disambiguates the state.
   *Upstream ask:* a distinct indeterminate glyph (e.g. a dash) in `@elabs-ai/components-ui` `Checkbox`.

2. **`Combobox` has no trigger purpose-label passthrough** (session switcher, `SessionSwitcher.tsx`).
   The trigger's accessible **name is the selected value** (the session title — so the earlier
   "no accessible name" claim was wrong), but `ComboboxProps` exposes **no** `aria-label` /
   `aria-labelledby` / `id` and does **not** spread arbitrary props (confirmed against the vendored
   source: only `{ options, value, onValueChange, placeholder, searchPlaceholder, emptyText,
   className }`). A wrapping `<label>` would **clobber** the value-name, so it isn't a clean fix.
   *In-app affordance:* the switcher is wrapped in a `role="group"` labelled **"Session switcher"** so
   AT can announce the purpose as context while the trigger keeps the live title.
   *Upstream ask:* an `aria-label` / `aria-labelledby` (or `triggerProps`) passthrough on
   `@elabs-ai/components-ui` `Combobox`.

---

## Sign-off checklist

- [ ] §1 Workspace: choreography (fresh glide once; reduced-motion snaps, content never hidden;
      history docks instant) — **both themes**.
- [ ] §1b **Composer clearance**: last message never covered at any composer height (multi-line +
      attachments + running Stop).
- [ ] §1c Meta rail: one rail, own scroll, collapsible sections + counts, Sheet under narrow width.
- [ ] §2 Sessions table + the `role="group"` switcher purpose label; keyboard-drivable.
- [ ] §3a Directory: single-click select / double-click|Enter open; crew color = accents only;
      loud quick-create.
- [ ] §3b **Org chart keyboard parity**: focus → inspector; Enter/Space → open profile.
- [ ] §3c Usage reconciles (`sum(rows)==total`) + explicit "no agent" bucket; `/assistant/usage`
      redirect.
- [ ] §4a Access: tri-state master + per-tool + per-tool token cost + footprint (🔌🔑); tri-state
      glyph gap confirmed (badge disambiguates).
- [ ] §4b Crew color picker: 5 swatches + "No color", keyboard + sr-only labels; propagation.
- [ ] §5 Projects: no fixed frame, files table, sessions link.
- [ ] §6 Audit: toolbar grammar, sticky day groups, links, retry.
- [ ] §7 Memory: `/assistant/memory` redirect + effective stack + most-specific-wins.
- [ ] §8 Nav 6→4, exactly one active item, full redirect matrix.
- [ ] **Every** surface re-checked in **Dark**, driven **keyboard-only**, with **reduced-motion**
      on, and the dot grid confirmed non-competing (decoration).
- [ ] 🔑🔌 the six credentialed items above.

When all boxes are ticked, the owner merges `feat/assistant-hub-ux → main`.
