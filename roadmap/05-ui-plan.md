# 05 UI Plan

> Phase 1 screens are below. The expanded target adds a **Tool Playground** (schema-generated
> form + execute + result) and **cross-server / tool-level comparison**, plus an overall UI/UX
> redesign — see [`08-expanded-target.md`](./08-expanded-target.md).

## Visual Direction

The UI follows the QLabs admin reference:

- dense left sidebar
- compact top navigation
- bordered panels with small headers
- metric strips for summary state
- table-first operational screens
- secondary navigation only when it represents real objects or useful task hierarchy
- selected-row details in the main workspace when they are part of the primary task
- restrained typography and spacing

## Screens

### Dashboard

Portfolio triage for configured MCP servers. The first screen highlights highest footprint, latest scan state, scan coverage, attention items, largest tool, ranked server footprint, and recent scan activity. It should answer what needs investigation first.

### MCP Servers

Primary operational workspace. The secondary rail lists saved MCP servers with add, edit, delete, test, and scan actions. Selecting a server shows its profile, latest scan metrics, token charts, tool inventory, scan history, and selected tool details in the main page. Forms support `stdio` and `streamable_http`. Saved secrets are never displayed back.

### Scans

Global scan history and report export. Scan detail includes sortable/filterable tool table and inline tool inspection. Tool details must not live in the right context panel.

### Compare

Select two scans from the same server and show totals, deltas, added tools, removed tools, changed tools, largest increases, and largest decreases.

### Settings

Default token profile, app version, database path, Docker mode, and data directory.

## UX Requirements

- global toast/feedback area
- global error boundary
- visible scan progress
- connection failures shown in UI
- no fake scan results
- no placeholder screens in the final deliverable
- Light and Dark are the only selectable themes
- the vendor brand mark remains the sidebar app icon and favicon
