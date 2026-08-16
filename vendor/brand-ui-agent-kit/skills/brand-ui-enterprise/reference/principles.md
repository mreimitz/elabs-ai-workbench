# Enterprise UX principles → brand-ui

The design judgment for professional surfaces, distilled from the 103-rule business-app
rulebook (Ant Design + Clarity) and mapped to `@brand/*`. Apply these when building
screens (procedure step 4). This is _generative_ guidance; for _scored review_ use the
`brand-ui-audit` skill (don't duplicate it).

> **Visuals:** `assets/images/` holds the do/don't pairs and "what good looks like"
> pattern examples for these rules — see its README.

## The spine

A mature business app is about **orientation, trust, task completion, recoverability,
density management, and predictable behavior** — not beautiful components. Eight rules
that carry the rest:

1. Design for people and tasks before components ("approve invoice", then pick the UI).
2. Keep the user's current task and location visible; minimize page transitions.
3. Spacing, alignment, contrast, repetition are the structure — borders last.
4. Copy is short, user-centered, consistent, action-labelled.
5. Feedback only when it helps understand state or recover — never noise.
6. Choose forms / tables / lists / cards / modals by task risk and information density.
7. Motion explains state changes; it never decorates.
8. Accessibility, validation, error recovery, auditability are core product design.

## Density is a feature — manage it, don't remove it

Professional users are experts; dense tables and many fields are correct. The answer to
complexity is **progressive disclosure** (collapse, detail panels, "advanced" sections,
context panel), not amputation. Order information by importance, frequency, association.

> **Structure across screens, not just within one:** model the objects + tasks and use
> **drill-down/up navigation** (object → detail hub → related objects) rather than cramming
> everything onto one page. See `object-and-navigation-patterns.md`.

## Apply by cluster (rule range → what to do → brand-ui)

| Area                            | Do                                                                                                          | Build with (`@brand/*`)                                                               |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| **Layout** (R006–R012)          | proximity groups; spacing scale; fixed nav + adaptive work area; preserve the work surface                  | `AppShell`/`Sidebar`/`SidebarInset`; tokens + `gap-*`                                 |
| **Navigation** (R022–R031)      | "where am I / can I go / how"; side rail for ops; tabs/steps; cache list position                           | `Sidebar`, `TopNav`+`Breadcrumb`, `Tabs`, `Steps`, `Pagination`                       |
| **Interaction** (R032–R039)     | direct manipulation; stay-on-page (drawer/split); undo vs confirm; controls near object                     | `Sheet`/`Drawer`, `ContextPanel`, `AlertDialog`                                       |
| **Feedback** (R040–R050)        | necessary/immediate; don't over-toast; loading >2s; progress+cancel; modal only when justified; never stack | `Alert`, `Toaster`/`toast`, `Skeleton`/`Spinner`/`LoadingState`, `Progress`, `Dialog` |
| **Forms** (R051–R064)           | only-as-long; group; labels close; validate on blur; color+icon+text; required-by-default                   | `Form`, `Input`, `Select`, `RadioGroup`, `Switch`, `InputGroup`                       |
| **Data display** (R065–R072)    | order by importance; design extreme states; tables vs cards; "-" for empty; collapse                        | `DataTable` (`@brand/data`), `Card`, `Badge`, `Table`                                 |
| **Data lists** (R073–R080)      | table/list/card by task; search pattern; submit vs live filter; batch-after-select; empty states            | `DataTable` + `SearchInput`/`FacetFilter`/`ColumnPicker`, `EmptyState`                |
| **Actions** (R081–R092)         | one primary per group; danger only for destructive; icon needs tooltip; verb+object labels                  | `Button` variants, `Tooltip`                                                          |
| **Motion** (R093–R099)          | serve interaction/hierarchy/feedback; minimal duration; fast exits; react immediately                       | token-driven; `motion-reduce` safe                                                    |
| **AI/productivity** (R100–R103) | source+confidence+reversibility; review states; editable-in-context; recoverable AI errors                  | `@brand/ai` (`Reasoning`, `Tool`, `Sources`), `ContextPanel`                          |

## Designed states (every interactive surface)

default · hover · focus (visible ring) · active · disabled · loading (skeleton, not
mid-content spinner) · empty (what it's for + first action) · error (what + how to fix)
· partial/overflow (10k rows → pagination/virtualization). Use brand-ui's state
components — `EmptyState`, `ErrorState`, `LoadingState`, `Skeleton` — not bespoke markup.

## Copy discipline

User's point of view; terse; familiar domain language; consistent terms across
button/title/object; important info first; verb+object button labels ("Publish report",
not "OK"); fix-oriented errors ("Email must include @ — e.g. name@company.com") rendered
inline (`role="alert"`), not as a toast. No marketing buzzwords (streamline/empower/
seamless/elevate…), no "Jane Doe / Acme / 99.99%" content — the brand lives in tokens +
the logo, not in sample copy.

## Review checklist (gate a screen before "done")

Layout communicates groups by spacing before borders · work surface preserved · nav
stable, you always know where you are · most important info first · every action has
appropriate feedback, no noisy toasts · long operations show progress + cancel ·
destructive actions reversible or confirmed · forms only-as-long, labels close,
validation inline + humanized, color paired with icon/text · representation chosen by
task (compare/scan/browse) · empty/loading/long-content states designed · returning
from detail preserves list state · one primary action per area · danger reserved for
real risk · motion short/performant/non-distracting · reads in qlik-bright + qlik-dark.

(Visuals: `../assets/images/` — do/don't pairs + pattern examples. Source: the business-app
rulebook, Ant Design + Clarity. Always confirm real props with `brand-ui docs <Component>` — and
note some clusters live in `@brand/charts`/`ai`/`marketing`/`flow`/`editor`; reach for one only
if that package is available in your app.)
