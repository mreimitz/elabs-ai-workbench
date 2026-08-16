# WP 3.2 — Scenarios & Tests authoring UI

**Phase:** 3 · **Size:** L · **Depends on:** 3.1, 2.1, 1.1

## Objective
Author scenarios (the harness) and tests (the workloads), including the server→tool allow-list with a
**live static footprint**, profile selection, system prompt, guardrails, and attachments.

## Why / references
Scope decisions #5–#7, #11, #13–#15. UI concept [`../10-…ui-concept.md`](../../10-testing-ui-concept.md)
§6 (pre-run shows the frozen config + baseline footprint) and §9 (component mapping). The allow-list
footprint reuses existing scan/token data — the app's core strength.

## Files (new)
- `apps/web/src/features/testing/ScenariosView.tsx`, `ScenarioEditor.tsx`
- `apps/web/src/features/testing/TestsView.tsx`, `TestEditor.tsx`
- `apps/web/src/components/AllowListPicker.tsx`
- *(provider credentials UI: extend `features/settings/SettingsView.tsx` or a small `ProvidersView`)*

## Design — components (brand-ui only)
- Lists: `@brand/data` `DataTable` (scenarios, tests) with `SearchInput`.
- Editors: `@brand/ui` form primitives (`Field`, `Select`, `Switch`, `Textarea`, `NumberInput`),
  `Dialog`/`Sheet` or a dedicated view. Use the existing `SelectField` composition where it fits.
- **AllowListPicker:** server checkboxes (`Switch`/`Checkbox`) → expand to per-tool toggles; beside it
  a live **footprint** panel (reuse `components/TokenViz.tsx` / `MetricCard`) summing the selected
  tools' definition tokens from the latest scan, updating as toggles change (`tabular-nums`).
- Provider credential form: `kind` `Select`, `label`, `apiKey` (`type="password"`, never re-rendered
  after save — show `hasKey`), `baseUrl` for local/Ollama.
- Guardrails: numeric fields bound to `GuardrailConfig`. Profiles: multi-select of token profiles
  (scenario default; test adds).

## Implementation steps
1. CRUD wiring through `api.ts` (`/api/scenarios`, `/api/tests`, `/api/providers`,
   `/api/tests/:id/attachments`).
2. `AllowListPicker` pulls the server's latest scan tools and computes the live footprint client-side.
3. Validate against the shared schemas (surface field errors inline; `conventions.md` form hygiene).

## Acceptance
- Create a provider credential (key shown only as `hasKey` afterward), a scenario (provider/model/
  params/allow-list/guardrails/profiles), and a test (prompt/attachments/override).
- Toggling a tool changes the live footprint number immediately.
- Renders correctly in both themes (qlik-bright, qlik-dark); keyboard-navigable; visible focus.
- Gate: typecheck + build green; manual check at `http://localhost:8080`.

## Notes
- Don't block paste on the API-key field; `spellCheck={false}`; `autocomplete="off"`
  (`.claude/rules/interaction-guidelines.md`).
