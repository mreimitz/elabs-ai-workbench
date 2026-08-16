# tool-shell — archetype A (tool/workspace)

The IDE-like shell: inset collapsible sidebar (navigator) + routed content + **status
bar**, an optional **right inspector** pane, a **⌘K command palette**, and **focus
mode** (⌘.). Generalized from `qlabs-workbench`. Archetype **B** (enterprise admin) is
the default and lives at `../app-shell.tsx`; use A for editors, inspectors, canvases.

> Starting points — verify every `@brand/*` prop with `brand-ui docs <Component>`.

| File                  | Role                                                                                   |
| --------------------- | -------------------------------------------------------------------------------------- |
| `ui-state.tsx`        | `UiStateProvider` + `useUiState` — navigator/inspector/palette/focus state, persisted. |
| `tool-shell.tsx`      | `ToolShell` — the frame; wires keyboard shortcuts + panes + status bar + palette.      |
| `command-palette.tsx` | `CommandPalette` — ⌘K `Command` dialog from a list of `PaletteCommand`.                |
| `status-bar.tsx`      | `StatusBar` — thin ambient-state bar docked at the bottom.                             |

## Keyboard

⌘K palette · ⌘\ navigator · ⌘I inspector · ⌘. focus mode (collapse both panes, restore on toggle).

## Assemble

```tsx
import { AppProviders } from "../app-providers"; // Theme → Tooltip → Sidebar → ContextPanel + Toaster
import { UiStateProvider } from "./ui-state";
import { ToolShell } from "./tool-shell";
import { Sidebar /* … */ } from "@brand/ui";

<AppProviders>
  <UiStateProvider>
    <ToolShell
      sidebar={
        <Sidebar variant="inset" collapsible="icon">
          {/* BrandLogo header + nav */}
        </Sidebar>
      }
      inspector={<YourInspector />}
      status={{ left: <span>Ready</span>, right: <span>Ln 1, Col 1</span> }}
      commands={[
        { id: "new", label: "New file", group: "File", onRun: () => {} },
        { id: "search", label: "Search…", group: "Go", onRun: () => {} },
      ]}
    >
      <YourEditorOrCanvas />
    </ToolShell>
  </UiStateProvider>
</AppProviders>;
```

The collapsible Qlik app icon (lockup↔mark), theme switcher, and settings modal are the
same as archetype B — reuse `../app-shell.tsx` §header, `../theme-switcher.tsx`,
`../settings-dialog.tsx`.
