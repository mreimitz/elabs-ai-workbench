---
type: "Work Package Spec"
title: "WP 1.4 — markdown table toolbar: the D-TB5 violation, raised upstream"
description: "Phase 1 of item.md. Ledger: STATUS.md. Eleven icon-only controls in the rendered SKILL.md name themselves with a native title=, paint no focus ring, and measure under 24px — the app's only unringed focusables. They are upstream, so this WP raises the gap and records the exception rather than patching around it."
tags: ["roadmap", "RM-36"]
timestamp: "2026-08-21T19:20:00Z"
status: "final"
---
# WP 1.4 — markdown table toolbar: the D-TB5 violation, raised upstream

Phase 1 of [`item.md`](./item.md). Ledger: [`STATUS.md`](./STATUS.md).
Finding **P1-5** in [`audit-report.md`](./audit-report.md).

**Depends on:** nothing. **Owner-gated:** the outcome is an upstream request plus a recorded
exception, not a local component.

## The finding

On `/skills/:skillId` → Overview (the rendered `SKILL.md`), each rendered markdown table carries an
icon-only toolbar — *Copy table*, *Download table*, *View fullscreen*. Eleven such controls on that
one page, in both themes:

```html
<button class="cursor-pointer p-1 text-muted-foreground transition-all …" title="Copy table" type="button">
```

Three failures at once:

1. **The accessible name is a native `title`.** `.claude/rules/icon-affordances.md` (**D-TB5**) is
   explicit: *"Never use the native `title` attribute to explain an icon-only control … it is
   invisible to assistive technology."* There is no `aria-label`.
2. **No focus ring.** Computed on focus: `outline: 0px auto`, `box-shadow: none`. These were
   **11 of the 13** unringed focusables found on the entire route — and the only unringed controls
   the whole audit found anywhere.
3. **21×21 and 23×23**, sitting adjacent, so both the 24px minimum and the spacing exception fail.

## The owning package and component (WP 1.4 investigation, 2026-08-21)

Identified with the brand-ui CLI as the authority (`pnpm exec brand-ui search markdown`,
`pnpm exec brand-ui docs MessageResponse`) and confirmed by reading the installed dist.

| Question | Answer |
| --- | --- |
| **App call site** | `apps/web/src/features/skills/SkillOverview.tsx:538` — `<MessageResponse>{renderedBody}</MessageResponse>` |
| **Owning `@elabs-ai/components-*` package** | **`@elabs-ai/components-ai`**, installed version **`4.0.0`** |
| **Owning component** | **`MessageResponse`** — the CLI reports `source: packages/ai/src/message.tsx`, `purpose: Renders streamed assistant markdown (Streamdown) inside a Message.` Its type is `ComponentProps<typeof Streamdown> & { loading?: boolean }` (`apps/web/node_modules/@elabs-ai/components-ai/dist/index.d.ts:1697`), so it is a thin pass-through. |
| **Where the defective markup actually lives** | `MessageResponse` does not author these buttons. They come from its runtime dependency **`streamdown`**, declared `"streamdown": "^2.4.0"` in `@elabs-ai/components-ai`'s manifest and resolved here to **`streamdown@2.5.0`**. |
| **File inside `node_modules`** | `node_modules/.pnpm/streamdown@2.5.0_react-dom@19.2.7_react@19.2.7__react@19.2.7/node_modules/streamdown/dist/chunk-BO2N2NFS.js` |
| **Second consumer** | `@elabs-ai/components-editor@4.0.0` also depends on `streamdown@2.5.0`, so a fix upstream benefits both packages. |

**Evidence matched on.** The exact class string the audit captured appears verbatim in that chunk,
paired with a `title:` and no `aria-label`:

```js
jsx("button",{className:s("cursor-pointer p-1 text-muted-foreground transition-all hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50",t),
  disabled:m,onClick:()=>l(!a),title:u.copyTable,type:"button",children:…jsx(b,{height:14,width:14})})
```

The label strings are a translations table in the same chunk —
`copyTable:"Copy table", downloadTable:"Download table", viewFullscreen:"View fullscreen"` — which
is exactly the trio the audit named.

**Three measurements re-derived from source, and they agree with the audit:**

- **`title` is the only name.** The whole chunk contains **2** occurrences of `aria-label`, neither
  on these buttons. Streamdown does expose a `translations` prop for i18n, but it only rewords the
  `title` — it cannot add an accessible name.
- **No focus ring is possible.** The chunk contains **zero** occurrences of `focus-visible`. The
  buttons carry no ring class at all, which is why the computed style was `box-shadow: none`.
- **Target size.** `p-1` (4px each side) around a 14×14 glyph ⇒ a ~22px box, consistent with the
  measured 21×21 / 23×23.

**Eight controls share that class string**, each named only by `title`:
`copyCode` and `downloadFile` (code blocks), `downloadDiagram` and `viewFullscreen` (mermaid), and
`copyTable` / a copy-format sub-button / `downloadTable` / `viewFullscreen` (tables).

## Why this is not a local fix

The markup is **not** in `apps/web/src` — a repo-wide grep for `"Copy table"` under `apps/web/src`
returns nothing (the only `apps/web/src` hits for *Download table* are the app's own
`ExpandableTable`, which is already correct and already uses `IconButton`). It is rendered by a
`@elabs-ai/components-*` component. `.claude/rules/library-first.md` is clear that a
missing or wrong library behaviour is *"a real upstream gap, not a license to hand-roll"*, and
`brand-ui-only.md` puts local overrides of a component's behaviour behind owner sign-off.

The correct in-repo counterpart already exists and is right:
`apps/web/src/components/IconButton.tsx` derives the tooltip text **and** the `aria-label` from one
`label` prop, so the two cannot diverge and the tooltip cannot be forgotten.

### One honest qualification the investigation turned up

The app **already owns a sanctioned, non-CSS override for the table half of this** and simply did
not apply it on this one surface. `apps/web/src/features/testing/ChatMarkdown.tsx` exports
`MD_TABLE_COMPONENTS`, a `components` map that replaces Streamdown's table block with
`@elabs-ai/components-ui` `Table*` inside the app's own `ExpandableTable` (whose toolbar *is* built
from `IconButton`). Three surfaces pass it — `ChatMarkdown` itself, `hub/ConversationPane.tsx` and
`hub/AgentTranscript.tsx:164`. `SkillOverview.tsx:538` is the one bare `MessageResponse` left, so it
is the one surface that still renders Streamdown's own toolbar.

Passing that existing map would remove **the table trio** without any CSS override and without a new
component. It would **not** remove the code-block trio (`copyCode` / `downloadFile`), which shares
the identical defect and which no app-side `components` map covers — a `SKILL.md` with fenced code
keeps its unringed buttons either way.

That is a call for the owner, not for this WP: applying it is a code change outside this WP's Scope
and Acceptance. It is recorded here so the exception below is honest about what is genuinely
un-fixable locally (the code-block/mermaid toolbars) versus what is a deliberate not-yet (the table
toolbar on this one route).

## Scope

1. **Identify the exact component and package** that renders the toolbar — narrow it with
   `pnpm exec brand-ui search` / `docs` rather than guessing, and record the package and component
   name in this file. ✅ done — see the table above.
2. **Raise it upstream** with the owner: the toolbar should take the `IconButton` treatment — one
   `label` prop feeding both the tooltip and `aria-label`, a token-driven
   `focus-visible:ring-2 ring-ring`, and a ≥24px target.
3. **Record the exception** in the ledger's Owner-acceptance section so the unringed controls are a
   known, owned gap rather than an unexplained audit failure.

**Do not** patch it locally with a global CSS override targeting the library's class names. That
would be a second styling system by the back door, and it would break silently on the next
`@elabs-ai/components-*` bump.

## Out of scope

Converting the app's remaining icon-only call sites to `IconButton`. `.claude/rules/icon-affordances.md`
says that conversion is a separate, later phase and that an unconverted site is not a violation of a
shipped conversion. This WP covers only the upstream toolbar.

## Acceptance

- [ ] The owning package and component are named in this spec, verified with the brand-ui CLI.
- [ ] The gap is raised with the owner, with the three measured failures and the `IconButton`
      precedent attached.
- [ ] The ledger's Owner-acceptance section records the exception, so a later audit reading
      "11 unringed focusables on `/skills/:skillId`" finds the decision instead of re-filing it.
- [ ] No local CSS override of library class names was added.
- [ ] Gate green: `pnpm typecheck && pnpm test && pnpm build && pnpm lint`.
