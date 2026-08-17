# Interaction & front-end hygiene

Front-end quality bar for the UI. Especially relevant to the **tool playground** target, which
generates input forms from MCP tool schemas — forms are a first-class surface here.

## Forms (incl. schema-generated forms)

- Inputs carry a meaningful `name`, the correct `type` (`email`/`url`/`number`/...) and
  `inputmode`; use `autocomplete` appropriately (`autocomplete="off"` on non-auth fields that
  shouldn't trigger password managers).
- **Never block paste.** `spellCheck={false}` on codes, tokens, URLs, identifiers.
- Labels are clickable (`htmlFor`/wrapping) and share one hit target with their control.
- **Submit stays enabled until the request starts**, then shows a spinner. Validate against the
  source schema; render errors **inline next to the field**; focus the first error on submit.
- Placeholders show an example and end with an ellipsis. Warn before discarding unsaved input.
- For generated forms: map JSON-schema types to controls predictably (string -> text, enum ->
  Select/ChoiceGrid, boolean -> toggle, number -> numeric input, object/array -> nested/repeatable),
  honor `required`, and show schema `description` as field help.

## Micro-typography

- Real ellipsis, curly quotes. Loading/among-actions text ends with an ellipsis ("Scanning...").
- **`tabular-nums`** for any number column or before/after comparison (token counts, deltas,
  history) so digits line up.
- `text-wrap: balance`/`pretty` on headings; non-breaking space in units (`10 MB`, `4 GB`).

## Content handling & empty states

- Text containers handle long content: `truncate`/`line-clamp-*`/`break-words`. **Flex children
  need `min-w-0`** to truncate (the silent culprit).
- Every list/string renders a real **empty state** (use `EmptyState`) — never broken UI for `[]`
  or `""`. Design for short, average, AND very long content (large tool inventories, long schemas).

## Feedback, performance, a11y

- Surface every async outcome: success/scan-failure/connection-error via the toast region; never a
  silent failure, never a fake scan result.
- Long tables (large tool lists): prefer the library `DataTable`; avoid expensive per-keystroke
  work and layout thrash (`getBoundingClientRect`/`offsetHeight` in render).
- Keyboard reachable, visible focus, labels/roles on every control; no `div`-as-button.
- Destructive actions (delete server, delete scan) get a confirmation or an undo window.
