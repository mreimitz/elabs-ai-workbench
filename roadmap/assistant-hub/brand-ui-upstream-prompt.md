# Prompt for the brand-ui coding agent — model-emittable message-body components

> Filed from the `mcp-token-footprint` Assistant-Hub workstream (WP2.6 upstream-gap duty,
> `roadmap/assistant-hub/requirements.md` R-GUI + research doc
> `research/agentic-session-sota/04-genui-agent2ui.md`). Paste everything below the line into a
> coding-agent session running in the **brand-ui monorepo**.

---

You are working in the **brand-ui monorepo** (packages/{ai,charts,data,ui,…}, registry/blocks,
Storybook). Before writing any code, read the repo's own contribution docs and use the
repo's maintainer workflow (the `brand-ui-component` skill if available: dedupe gate →
component API rules → quality gates → manifest regeneration). Everything below supplements —
never overrides — the repo's own rules.

## Mission

A downstream product (an assistant whose LLM composes UI from a curated catalog of brand-ui
parts — "generative UI") needs a small set of **model-emittable, message-body components** that
the library does not have yet. The design bar is set by two components you already ship — treat
them as the canonical precedents and match their quality and API style:

- **`Charts/AutoChart`** (`@elabs-ai/components-charts`): spec-driven ("The serializable chart specification
  produced by an LLM tool-call"), **never throws** (unsupported/empty → `ChartFallback`),
  intentionally bare (no frame; consumers wrap), typed formatting hints.
- **`AI/ChangeReview`** (`@elabs-ai/components-ai`): compound component with lifted state, controlled AND
  uncontrolled modes, provenance object, per-part override renderers.

## Step 0 — Dedupe gate (mandatory, before any component work)

For EACH item below, verify it does not already exist: check the live Storybook index, the
package exports (components can exist without stories — e.g. kit-era exports like `Plan`,
`Queue`, `Checkpoint`, `PromptInput*`, `MessageBranch*` may or may not still ship), and the
registry blocks. If something exists partially, extend it rather than creating a sibling.
Record the dedupe verdict per item in your report.

## Global rules (apply to every component here)

1. **Presentational only.** No model calls, no fetch, no runtime coupling — the app owns
   transport (your own playbook's D5 boundary). Components receive specs/props and emit events.
2. **Spec-driven where the model is the author.** The model-facing components (Form, Table)
   take one **serializable spec prop** (zod-validated), exactly like `AutoChart`'s `ChartSpec`.
   Document the spec as "produced by an LLM tool-call". Export the zod schema — downstream
   catalogs compile prompts and validators from it.
3. **Never throw on model output.** Bad/unknown spec content renders a typed fallback
   (`…Fallback`) with a short reason — mirror `ChartFallback` semantics.
4. **Streaming-tolerant.** Props may arrive as partial parses mid-stream; render progressively
   (missing fields → skeleton/omitted, never a crash, never `null` holes in lists).
5. **Tokens only.** No raw colors/styles; everything from `@elabs-ai/components-tokens`; correct in ALL
   shipped themes. Specs must not carry style-bearing props (the model never chooses look).
6. **Compound + lifted state, controlled and uncontrolled** — the `ChangeReview` pattern.
7. **A11y is part of Acceptance:** keyboard operability, labels/roles, focus management,
   `aria-live` where content streams, reduced-motion respect.
8. **Deliverables per component:** implementation, stories (default · streaming/partial ·
   empty · fallback · controlled · dark theme), docs page, exported types + zod schema, tests
   per repo convention, manifest regeneration. Honest reporting: state what you did NOT verify.
9. **Package placement:** lightweight message-body parts belong in `packages/ai`. If a
   component needs a sibling package (`@elabs-ai/components-data`, `@elabs-ai/components-charts`), follow the `ai-chart`
   precedent: primitive in its home package + the cross-package composition as a **registry
   block** (packages must not cross-import siblings).

## The work, in priority order

### A — `MessageForm` (in-message, model-emittable form) · HIGH

The model emits a form inside a chat message; the user fills it; the app gets structured state.

- **Spec (`FormSpec`, zod, serializable):** `formName`, optional `title`/`description`,
  `fields[]` where each field is a **flat primitive** — `string` (with optional
  `format: "email" | "uri" | "date" | "date-time"`, `minLength`, `maxLength`, `pattern`,
  `multiline`), `number`/`integer` (`min`, `max`), `boolean`, single-select enum (plain values
  or `{const, title}` pairs), multi-select enum — each with `label`, optional `description`,
  `required`, `default`. **No nested objects/arrays-of-objects, no file inputs, no
  password/credential fields (reject in the schema).** This exact shape is deliberately
  compatible with MCP elicitation's `requestedSchema` (spec 2025-11-25) so one renderer serves
  both generative-UI forms and MCP elicitation dialogs.
- **Validation vocabulary** (declarative, client-enforced, auto error display):
  `required, email, min, max, minLength, maxLength, pattern, url, numeric`.
- **Behavior:** controlled (`values`, `onChange`) and uncontrolled; `onSubmit(formState)` with
  `formState = { formName, values }`; `submitLabel`; `disabled` / `submitted` /
  `submitting` states (a submitted form renders inert with its values visible — messages are a
  historical record); Enter submits from single-line fields; never nest a form in a form.
- Compose existing `@elabs-ai/components-ui` inputs; do not re-invent field primitives.

### B — `MessageTable` (model-emittable data table) · HIGH

- **Spec (`TableSpec`, zod, serializable, column-oriented):** `title?`, `columns[]` with
  `{ key, label, format?: "text" | "number" | "currency" | "percent" | "date" | "badge" }`,
  `rows[]` (objects keyed by column key), `emptyText?`. Formats drive rendering + alignment
  (numeric right-aligned, tabular-nums), `badge` maps values to tonal badges.
- **Behavior:** never throws (unknown format → text; missing cell → em-dash); optional
  client-side sort (`sortable`); row cap with "showing N of M" truncation notice (mirror the
  reference-harness rule of truncating huge tables gracefully); optional per-cell render
  override for consumer composition (like `ChangeReview.renderHunk`).
- Keep it lightweight in `packages/ai` — this is message content, not the app-chrome
  `@elabs-ai/components-data` `DataTable`. If reuse of `@elabs-ai/components-data` internals is compelling, do it as a
  registry block instead (rule 9).

### C — Part-grouping engine (`GroupedParts` + `groupPartByType`) · MEDIUM

Derive collapsible reasoning/tool traces from an ordered part list — a **pure client-side view
transform**, never a model output format. Adopt the proven design (assistant-ui's, API-adapted
to this library):

- `groupBy(part, context) => readonly \`group-${string}\`[] | []` maps each part to a group-key
  path; **adjacent parts sharing a key path coalesce** into synthetic group nodes
  `{ type: \`group-${string}\`, status, indices }`; multi-element paths nest; the `group-`
  namespace is reserved so keys can't collide with real part types.
- Group **status rolls up** (any member running → group running); leaf identity keys stay
  stable across re-renders so streaming rows don't remount; memoize the groupBy fingerprint.
- Ship a `groupPartByType({...})` helper + a tool classification hint
  (`display: "inline" | "standalone"`): human/approval-style parts are **forced standalone** —
  interaction cards must never fold into a thinking accordion.
- Render-prop API: `{({ part, children }) => …}` switching on `part.type`, integrating with the
  existing `ChainOfThought`/`Reasoning`/`Tool` components as the default renderers.

### D — Message edit-in-place · MEDIUM

- An edit mode for user messages: `beginEdit`/`cancel` semantics, the existing composer
  rendered inline in the message bubble, `onEditSubmit(newText)` — the consumer creates a
  branch (compose with the existing `MessageBranch*` mechanics if still exported; verify in
  Step 0). Esc cancels, Enter submits, focus is trapped and restored; the original text is
  restored on cancel.

### E — Per-message feedback · LOW

- `MessageFeedback`: thumbs up/down with a `submitted` state (`data-submitted`, buttons
  auto-disable after submit), `onSubmit({ type: "positive" | "negative" })`, optional compact
  variant for message toolbars. No persistence — host-owned.

### F — Selection/quote toolbar · LOW

- A floating toolbar over selected transcript text with a single default action:
  `onQuote(selectedText)` (consumer prepends `> `-prefixed blockquote into the composer).
  Positioning via the repo's existing popover primitives; dismiss on selection collapse.

### G — Suggestions: streaming trailing-loader · LOW

- Extend the existing `Suggestion(s)` with a `loading` trailing-chip pattern (compose with
  `Shimmer`): chips appear progressively while a generator streams; the trailing chip shows a
  loading state until the set settles.

## Definition of done (whole batch)

Every component: dedupe verdict recorded → API reviewed against the two precedents → all
deliverables from rule 8 → repo quality gates green → manifest/docs regenerated → a short
CHANGELOG/report entry per component stating (a) what shipped, (b) what was deliberately left
out, (c) anything unverified. Do NOT silently expand scope beyond this list; if a locked design
choice above seems wrong for this library, stop and report the conflict instead of improvising.
