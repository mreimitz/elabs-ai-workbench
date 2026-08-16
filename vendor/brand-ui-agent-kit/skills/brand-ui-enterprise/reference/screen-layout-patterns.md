# Screen layout & component selection

The most common agent failure: it knows the components exist but has **no sense of screen
anatomy** — what goes where, in which component, and how the user works the view. So it
dumps everything into stacked cards on one scrolling page. This file is prescriptive: the
**anatomy** of the common screens, the **right component for each structural job**, and a
real **case study** (an MCP-server detail page) showing failure → fix. A paste-ready
implementation of this whole anatomy is `../assets/detail-hub.tsx`.

## Before laying out a screen, answer two questions

1. **Hierarchy** — what is the primary object, its sections, and its child lists?
2. **Work pattern** — how does the user actually operate this view: scan? select-and-act?
   compare? drill? Lay the screen out around the **task**, not around the shape of the data.
3. **Importance** — which region matters most, and does its space/emphasis/interaction match?
   Component choice is _this_ file; emphasis & proportion are `information-priority-and-emphasis.md`.

## Component selection — structural job → `@brand/*`

| Structural job                        | Use                                                          | Not                                       |
| ------------------------------------- | ------------------------------------------------------------ | ----------------------------------------- |
| Page wrapper + header                 | `PageShell` (`header` slot, `width` default `"xl"`)          | a bare `<div>` with a scroll-away title   |
| Page/section title + status + actions | `SectionHeader` + `ButtonGroup`                              | loose `<Button>`s dropped in a row        |
| A toolbar (group of actions)          | `ButtonGroup` (+ `ButtonGroupSeparator`/`ButtonGroupText`)   | individually-placed buttons               |
| Sections of **one** object            | `Tabs` (`TabsList`/`TabsTrigger`/`TabsContent`)              | a vertical **stack of `Card`s**           |
| List + detail of the selection        | **`SplitPanel`** (`start`=list, `end`=detail)                | detail rendered **below** the list        |
| Resizable two-pane                    | `ResizablePanelGroup` + `ResizablePanel` + `ResizableHandle` | hand-rolled flex, no resize               |
| Read-only attributes                  | `Descriptions` / `DescriptionsItem`                          | a card of label/value `<div>`s            |
| The list itself (searchable)          | `DataTable` + `SearchInput` + `FilterBar` + a count          | a hand-rolled stack of cards              |
| KPI row                               | `MetricGrid` + `MetricCard` (`@brand/charts`)                | cards of numbers in raw markup            |
| Empty / loading / error               | `StatePanel` (`kind=empty/error/loading`) / `EmptyState`     | a blank region                            |
| Body scroll region                    | `ScrollArea`                                                 | the whole page scrolling under the header |

## Anatomy of an object **detail page** (the hub)

```
PageShell
├── header: SectionHeader            ← STICKY (does not scroll away)
│     ├── Breadcrumb (drill path)            · where am I
│     ├── Title + status Badge               · which object (health = Badge variant)
│     └── actions: ButtonGroup               · Edit · Test · [Run scan = primary] · ⋯ · Delete (danger)
└── body: ScrollArea
      ├── (optional) MetricGrid — a few KPIs  · at-a-glance, NOT the whole page
      └── Tabs                                · Overview · Tools · Scans · Settings
            ├── Overview → Descriptions (attributes) + latest-scan summary
            ├── Tools    → SplitPanel(start = tool list, end = tool detail)   · master-detail
            └── Scans    → DataTable (history)
```

Rules: the **header AND the `TabsList` stay in the sticky region** — only `TabsContent`
scrolls (a Tab bar that scrolls away, so you must scroll up to switch tabs, is a live-audited
failure); **sections are `Tabs`**, not stacked cards; **a list + its detail is a `SplitPanel`**
whose two panes **each get their own `ScrollArea`** (scroll independently), never
detail-below-list.

## Anatomy of a **list page** (the master)

```
PageShell → header: SectionHeader (title + "Add" primary + ButtonGroup)
         → body: SearchInput + FilterBar → DataTable (sortable, paginated) → footer: "N items"
```

Row click → drill to the object's detail page (R078). Quick peek → a right `Sheet`. A list
needs **search, filter, and a count/footer** — not just an Add button.

## Master-detail (the pattern the agent keeps getting wrong)

When a screen shows **a list and the detail of the selected item**, put them **side by
side** so selecting updates the detail **in place** — the user never scrolls away to change
selection:

```tsx
<SplitPanel
  startSize="360px" // list pane width
  start={<ToolList selectedId={id} onSelect={setId} />}
  end={<ToolDetail toolId={id} />} // updates in place on select
/>
```

Narrow/vertical screens may stack, but the default for "pick one, see its detail" is a
**split**. **Detail rendered below a list is the anti-pattern** — scroll up to change
selection, down to read it.

## Case study — MCP-server detail page (failure → fix)

Real findings from a brand-ui app (built _before_ this skill). Each maps to a structural
component:

| #   | What the agent did ✗                                                                      | Fix ✓ (`@brand/*`)                                                                      |
| --- | ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| 1   | Server **list** has an Add button but **no search, no count/footer**                      | `SearchInput` + a count footer (or a `DataTable` list)                                  |
| 2   | Detail **header scrolls away**                                                            | `PageShell` + a **sticky** `SectionHeader`                                              |
| 3   | Action **buttons dumped loose** in the header                                             | a `ButtonGroup` (primary right; `Delete` = danger; overflow `⋯`)                        |
| 4   | Every section is a **stacked card** (profile, KPIs, contributors, composition, inventory) | **`Tabs`**: Overview · Tools · Scans — structure, not a long scroll                     |
| 5   | **Tool detail rendered below the tool list** → scroll up/down to change tool              | **`SplitPanel`**: tool list `start`, tool detail `end` — select updates detail in place |

Root cause (the owner's words): _no sense for hierarchical layout, component selection, or
how the user works the view._ The fix is this file — pick the structural component for each
job, and lay the screen out around the **task** (select-a-tool → read-its-detail), not the
data.

---

_Grounded in `@brand/*` v1.0.0 source: `PageShell` (`header`, `width`), `SectionHeader`,
`ButtonGroup`, `Tabs`, `SplitPanel` (`start`/`end`/`startSize`/`direction`), `Descriptions`,
`DataTable`, `StatePanel`. Confirm props with `brand-ui docs`._
