# Objects, tasks & drill-down navigation

The fix for the #1 failure mode: defaulting to a **content-dump** — cramming everything
into cards on one page, optimizing "show many things." A business app exists to let users
**operate complex processes**: select an object, see its detail, act on it, drill into its
related objects. **Design the object model and task flow first, then lay out screens**
(noun → verb, not page-by-page).

## 1. Object-Oriented UI — the mental model

A professional app is **collections of objects** the user operates on — Country, Customer,
Order, Invoice, Pipeline. OOUI is **noun → verb**: show the object (or a list of them)
first, let the user **select**, then offer **actions**. Both the inverse (verb → noun:
pick an action, then its target) and the content-dump (show everything at once) fail for
operational work.

Model before screens (OOUX "**ORCA**"): **Objects** (the nouns), **Relationships**
(a Country _has many_ Customers), **CTAs** (actions per object), **Attributes** (fields).
Every object gets: an **identity** (name/status), **attributes**, **actions**, and
**related lists** (its child objects).

## 2. The object detail hub — the unit of a business app

Each object has a **detail page** that is its hub — not a card on a shared dashboard:

- **Header** — object name + status + primary/secondary actions (+ peer nav: prev/next).
- **Attributes** — read-only `Descriptions`; edit in place or via a focused task.
- **Related lists** — its child objects as `DataTable`s (a Country's Customers, Orders).
- **Sub-sections** — `Tabs` (Overview / Related / Activity / Settings) — switch without leaving.

The detail hub is where work happens. The list and the dashboard just **route** you to it.

## 3. Drill-down / drill-up navigation (your Country → Customer example)

Traversing object **relationships** is "drilling":

```
Countries (list)
  └─ select "Germany" → Country detail hub      (attributes · actions · related lists)
        └─ Customers (related list)
              └─ select "Acme GmbH" → Customer detail hub
                    └─ Orders (related list) → select "#4711" → Order detail hub → …
```

- **Drill-down** = open a child object's hub (nested master-detail, a.k.a. "nested-doll").
- **Drill-up** = climb back via the **breadcrumb** (`Countries / Germany / Customers /
Acme GmbH`) — every crumb is a level you can jump to.
- **Peer navigation** = move between siblings (next/prev Customer) from the detail, without
  returning to the list (the "pyramid" pattern).
- **Preserve position** = returning to a list restores scroll / filters / selection
  (rulebook R031/R077). Drilling must never lose the user's place.

## 4. Navigation-pattern taxonomy (pick one per relationship)

| Pattern                        | Shape                         | Use for                                       |
| ------------------------------ | ----------------------------- | --------------------------------------------- |
| **Hierarchical / nested-doll** | drill in; breadcrumb out      | object → child → grandchild (the drill chain) |
| **Hub-and-spoke**              | central hub; return to it     | unrelated top-level areas                     |
| **Pyramid / sequential**       | move across siblings          | next/prev within a set, from the detail       |
| **Master-detail (split)**      | list + detail side by side    | fast scan + act on many peers (triage, mail)  |
| **Flat / tabbed**              | switch peer sections in place | an object's sub-sections (`Tabs`)             |

## 5. Which surface for the detail/task? — decision tree

Default to **keeping the work surface** (rulebook R012/R033). Choose by _context need →
complexity → reference need_ (after Neufeld / Smashing / NN-G):

1. **Need the underlying screen's context?** No → **full page**. Yes → an overlay.
2. **Complexity / duration?** Long, multi-step, lots of detail → **full page** (the hub).
   Short and focused → an overlay.
3. **Need to reference/compare background data while working?** Yes → a **non-blocking
   drawer / `Sheet`** (a modal blocks compare + copy-paste). No → a **modal `Dialog`**.
4. **Same task repeated over and over?** → avoid both: **inline edit / expandable row**
   (anchored to the current screen).

Rules of thumb:

- **Full page** = the object's **detail hub**, and complex multi-step flows.
- **Drawer / `Sheet` (non-blocking)** = quick detail or a sub-task that needs the list still
  in view; the **default overlay** for "preserve the work surface."
- **Modal `Dialog`** = a single, self-contained task or a quick entity peek; confirmations
  and **destructive/irreversible** actions (`AlertDialog`). Never stack modals; always give an exit.
- **Inline / expand** = repeated edits, a quick value change, a one-row peek.
- **Wizard / `Steps`** = a bounded procedure with order + progress.

## 6. The dashboard is a routing surface, not a dumping ground

A dashboard answers **"what needs my attention, and where do I go"** — then routes to the
object hubs. Keep it to ~6–8 focused visuals, most-important first; use **drill-through**
(click a metric → the filtered list → the object) instead of piling every widget onto one
screen. "When everything is visible, nothing is important."

## 7. Anti-pattern: the content-dump (refuse this)

- Everything on one page in equal cards; nested cards; a wall of widgets.
- Showing **data** instead of enabling **tasks**; no object detail hubs; no drill path.
- Detail crammed into a card instead of its own hub/drawer; modals for long multi-step flows.
- Losing list position on the way back; no breadcrumb; no peer navigation.
- Detail rendered **below** a list (scroll up to change selection, down to read) — use a
  **`SplitPanel`** master-detail. Sections stacked as cards instead of `Tabs`; a scroll-away
  header; loose buttons instead of a `ButtonGroup` toolbar → see `screen-layout-patterns.md`.

Replace each with: an **object model → detail hubs → drill-down/up navigation → the right
surface**.

## 8. brand-ui mapping

| Need                                   | brand-ui                                                                                                                               |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Object list (the master)               | `DataTable` + `SearchInput`/`FacetFilter`/`ColumnPicker` (`@brand/data`); the object name is the drill link (R078)                     |
| Object detail hub                      | routed page: header (name/status + `Button` actions) + `Descriptions` (attributes) + `Tabs` (sub-sections) + `DataTable` related lists |
| Drill path / drill-up                  | `Breadcrumb` (`@brand/ui`) reflecting the relationship chain                                                                           |
| Peer navigation                        | prev/next `Button`s in the detail header                                                                                               |
| Quick detail / sub-task (keep context) | right `Sheet` / `Drawer` (`@brand/ui`, `side="right"`)                                                                                 |
| Focused / destructive task             | `Dialog` / `AlertDialog` (`@brand/ui`)                                                                                                 |
| Repeated edits                         | inline cell edit / expandable row (`DataTable`)                                                                                        |
| Procedure                              | `Wizard` / `Steps` (`@brand/ui`)                                                                                                       |
| Dashboard routing                      | `MetricGrid` / `ChartCard` (`@brand/charts`) → drill-through to the list/hub                                                           |

Confirm props with `brand-ui docs`. The shell these live in: `shell-and-navigation.md`.

---

_Sources: OOUI (Wikipedia); OOUX / ORCA (Sophia Prater); master-detail & navigation
patterns (Oracle, PatternFly, Tidwell, *Designing Interfaces* 3e); modal-vs-page decision
tree (Ryan Neufeld; Smashing Magazine; NN/g); dashboard overload (multiple). Full source
profiles live in the skill's research notes._
