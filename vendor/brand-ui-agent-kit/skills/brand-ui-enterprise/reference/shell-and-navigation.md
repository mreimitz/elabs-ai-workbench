# Shell & navigation — archetypes, nav types, canonical snippets

_Grounded in patterns distilled from shipping qLabs apps; the paste-ready versions live in
`../assets/`. Confirm props with `brand-ui docs <Component>`._

Picking the shell is the **first** structural decision (rulebook R009/R022–R031).
There isn't one shell — there are **archetypes**, and within each a **stack of
navigation types**. This file names them and links the paste-ready assets so the agent
reuses them instead of reinventing.

> Paste-ready implementations of both archetypes live in `../assets/`:
>
> - **Tool/workspace shell (A)** — `../assets/tool-shell/` (shell · status bar · navigator/
>   inspector panes · ⌘K palette · focus mode).
> - **Enterprise admin shell (B)** — `../assets/app-shell.tsx` (+ `theme-switcher.tsx`,
>   `settings-dialog.tsx`, `app-providers.tsx`).

---

## 1. Two shell archetypes

### A. Tool / workspace shell (IDE-like)

For document/editor/inspector tools, canvases, anything with a long-lived work
surface and power users. **Paste-ready: `../assets/tool-shell/`.**

```
SidebarProvider (Sidebar variant="inset" collapsible="icon")
├── Sidebar         — identity (collapsible BrandLogo) → workspace nav → contextual group → AccountMenu
├── SidebarInset    — routed content (<Outlet/>) + StatusBar at the bottom
└── global overlays — CommandPalette (⌘K) · SettingsDialog · other dialogs
```

Signature moves: **left navigator + right inspector** panes, **focus mode** (⌘.
collapses both, persisted/restored), **resizable persisted sidebar**, heavy
**keyboard** (⌘K palette, ⌘\ navigator, ⌘I inspector), a **status bar**. State for
panes/palette/focus lives in a `UiStateProvider` (see `../assets/tool-shell/ui-state.tsx`).

### B. Enterprise admin shell (console)

For multi-view admin/analytics/back-office consoles. **Paste-ready: `../assets/app-shell.tsx`.**

```
SidebarProvider (Sidebar collapsible="icon")
├── Sidebar      — app identity (icon + name) → primary view menu (isActive+tooltip) → footer
└── SidebarInset
    ├── TopNav    — start: SidebarTrigger + Breadcrumb · end: page actions + ThemeSwitcher
    ├── secondary rail (optional <aside w-72 border-r>) — the list/master for the active view
    └── main      — the active view (detail/table/dashboard)
```

Signature moves: **icon-collapsible primary sidebar** for top-level destinations,
**breadcrumb** for location, an **optional secondary rail** that appears per-view
(a list/master rail on a list→detail view), and a **detail panel** for the selected object.

> Marketing surfaces use neither — top nav + single scroll (see professional-vs-marketing).

---

## 2. Navigation-type catalog (the "different nav types")

Layer these deliberately; each answers a different question (rulebook R022).

| Nav type                           | Answers                         | brand-ui                                     | Use when                                             |
| ---------------------------------- | ------------------------------- | -------------------------------------------- | ---------------------------------------------------- |
| Primary sidebar (icon-collapsible) | "where can I go" (top level)    | `Sidebar collapsible="icon"` + `SidebarMenu` | operation-heavy apps (R026)                          |
| Top nav + breadcrumb               | "where am I"                    | `TopNav` + `Breadcrumb`                      | every pro shell; primary only for simple apps (R025) |
| Secondary rail (master/list)       | "which object"                  | `<aside>` or a per-view rail                 | list→detail views                                    |
| Tabs                               | switch related content in place | `Tabs`                                       | object sub-sections (R028), no page change           |
| Steps / wizard                     | procedural progress             | `Steps` / `Wizard`                           | multi-step setup (R029)                              |
| Detail / context panel             | "about the selection"           | `ContextPanel` family / inspector pane       | preserve work surface (R012/R024)                    |
| Command palette                    | power navigation                | `Command` in `Dialog` (`CommandDialog`)      | ⌘K everywhere                                        |
| Status bar                         | ambient state                   | bespoke bar in `SidebarInset` footer         | tool shells                                          |

The right-side **`ContextPanel`** is the library-native form of the archetype-A
**inspector** pane — same role (adaptive detail beside the work surface), animated.

---

## 3. Canonical solved snippets (reuse these)

### 3a. Collapsible Qlik app icon — see `../assets/app-shell.tsx`

`BrandLogo` lockup when expanded, `variant="mark"` when collapsed-to-icon:

```tsx
<SidebarHeader>
  <Link to="/" aria-label="Home" className="… group-data-[collapsible=icon]:justify-center">
    <BrandLogo height={20} className="group-data-[collapsible=icon]:hidden" />
    <BrandLogo variant="mark" height={20} className="hidden group-data-[collapsible=icon]:block" />
    <span className="… group-data-[collapsible=icon]:hidden">App name</span>
  </Link>
</SidebarHeader>
```

Set the **favicon** to the same Qlik mark (head-level asset).

### 3b. Theme switcher — System / Qlik Bright / Qlik Dark — preferred + alternative

**Verified against `@brand/*` v1.0.0 source.** Two good options.

**Preferred — the library component already does it:**

```tsx
import { ThemeSwitcher } from "@brand/ui";
// `themes` defaults to the Qlik light/dark pair; `showSystem` defaults to true →
// renders exactly System / Qlik Bright / Qlik Dark (whole-screen animated, reduce-motion safe).
<ThemeSwitcher />;
```

**Alternative — a curated labeled `Select`** (see `../assets/theme-switcher.tsx`),
when you want text labels instead of the icon toggle:

```tsx
const LIGHT = "qlik-bright",
  DARK = "qlik-dark";
type Mode = "qlik-bright" | "qlik-dark" | "system";
// persist Mode in localStorage; in "system", read matchMedia('(prefers-color-scheme: dark)')
// and setTheme(systemTheme()) on change.
<Select value={mode} onValueChange={choose}>
  <SelectTrigger size="sm" className="w-[150px]" aria-label="Appearance">
    <SelectValue />
  </SelectTrigger>
  <SelectContent>
    <SelectItem value="qlik-bright">{THEME_META[LIGHT].label}</SelectItem>
    <SelectItem value="qlik-dark">{THEME_META[DARK].label}</SelectItem>
    <SelectItem value="system">System</SelectItem>
  </SelectContent>
</Select>;
```

> Verified props: `themes?` (default Qlik pair) · `showSystem?` (default true) ·
> `mode?` ("auto"|"toggle"|"dropdown") · `size?` · `effect?`. So `<ThemeSwitcher />`
> yields System / Qlik Bright / Qlik Dark with no config — the `Select` is only for an
> explicit labeled dropdown.

### 3c. Settings as a modal — see `../assets/settings-dialog.tsx`

`Dialog`, deep-linkable via `?settings=1`, closes back to the screen with context
intact; Appearance section hosts the theme switcher:

```tsx
// open state from useSearchParams(): ?settings=1
<Dialog open={open} onOpenChange={setOpen}>
  <DialogContent className="max-h-[85vh] max-w-md overflow-y-auto">
    <DialogHeader>
      <DialogTitle>Settings</DialogTitle>…
    </DialogHeader>
    <section aria-label="Appearance">
      <ThemeSwitcher />
    </section>
    {/* + other small sections */}
  </DialogContent>
</Dialog>
```

Rationale: three small sections never justified a full route. Keep deep settings as a route
only when they grow large; the always-available entry is the modal.

---

## 4. Shell selection — decision table (refined)

| App style                               | Archetype                                | Start from                                                                  |
| --------------------------------------- | ---------------------------------------- | --------------------------------------------------------------------------- |
| Document/editor/inspector tool, canvas  | **A — tool/workspace**                   | `../assets/tool-shell/`; inset sidebar + status bar + panes + ⌘K            |
| Admin / analytics / back-office console | **B — enterprise admin**                 | `template-data-app`/`-dashboard` + `sidebar-02`; topnav+breadcrumb (+ rail) |
| Mail / triage / list-detail             | B (+ secondary rail)                     | `sidebar-04`                                                                |
| Nested / dual navigation                | B (double rail)                          | `sidebar-05`                                                                |
| AI assistant · flow · settings-heavy    | B (+ `ChatShell`/`CanvasShell`/sections) | matching `template-*`                                                       |
| Marketing / presales                    | neither                                  | `template-marketing`, TopNav only                                           |

> Shell/template IDs (`sidebar-0x`, `template-*`) are indicative — confirm the current ones
> with `brand-ui search`.

---

## 5. Root provider order (generalized — baseline in `../assets/app-providers.tsx`)

```
ErrorBoundary → ThemeProvider(defaultTheme="qlik-bright") → QueryClient → TooltipProvider
  → UiStateProvider (panes/palette/focus, tool shells)
    → SidebarProvider → ContextPanelProvider → <Shell/>
  → <Toaster/>   (once)
```

(Mount `ThemeProvider` above any `useTheme` consumer; `<Toaster/>` lives once near the root.)
