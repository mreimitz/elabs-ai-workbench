# skill/assets — paste-ready baseline

Starting points for the enterprise app baseline (SKILL.md step 3). **Starting points,
not a library** — grounded in two shipping qLabs apps (`qlabs-workbench`,
`mcp-token-footprint`) and the brand-ui v1.0.0 manifest. Before shipping, confirm every
`@brand/*` prop with `brand-ui docs <Component>`.

| File                  | What it gives you                                                                                                                                                             |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `app-providers.tsx`   | Root provider order (Theme → Tooltip → Sidebar → ContextPanel) + `<Toaster/>` once.                                                                                           |
| `app-shell.tsx`       | Archetype B (enterprise admin) shell: collapsible Qlik-icon sidebar + TopNav (breadcrumb + theme switcher + settings) + optional rail + main.                                 |
| `theme-switcher.tsx`  | System / Qlik Bright / Qlik Dark curated switcher (OS-following).                                                                                                             |
| `settings-dialog.tsx` | Settings as a modal; controlled, with optional `?settings=1` deep-link.                                                                                                       |
| `favicon-setup.md`    | Wire the browser-tab favicon to the Qlik mark.                                                                                                                                |
| `detail-hub.tsx`      | A **screen-level** worked example: the archetype-B object **detail hub** (sticky header + sticky tabs · `SplitPanel` master-detail with per-pane scroll · Run-task `Dialog`). |

Archetype A (tool/workspace) — status bar, left navigator + right inspector panes, ⌘K
command palette, and focus mode — is paste-ready under **`tool-shell/`** (see its README).
Reference: `../reference/shell-and-navigation.md` §1A.

`detail-hub.tsx` is a **screen** example, not app chrome: the MCP-server detail page from
the case studies, implementing `../reference/screen-layout-patterns.md` (which component for
each job) and `../reference/information-priority-and-emphasis.md` (what deserves the spotlight)
end to end. Adapt the object model (server → tool → scan) to your domain.
