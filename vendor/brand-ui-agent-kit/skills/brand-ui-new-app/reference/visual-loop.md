# The visual feedback loop (propose → preview → pick → refine)

The reusable interaction loop for **every visual decision** in a guided flow
(`brand-ui-new-app` today; `migrate` when it lands). brand-ui's edge: previews
are **real rendered components in the chosen theme** (via the Storybook MCP), not
mockups. This is the canonical reference (VP-04) both flows follow — keep the loop
identical across them.

## The loop

1. **Propose** — offer **2–4 concrete options**, never an open-ended "what do you
   want?". Each option is a real, namable choice (an archetype, a theme, a nav
   shape, a chart type), not a parameter.
2. **Preview** — render the options at the **highest fidelity available** (ladder
   below). Surface the preview URL/artifact to the user — don't describe a render
   you could show.
3. **Pick** — one `AskUserQuestion` round (≤4 options; "Other" is free text). When
   a render exists, attach it (option preview / the surfaced URL) so the choice is
   made on the UI, not on prose.
4. **Refine** — apply the pick, re-preview, and offer the next decision. Stop when
   the user is happy or says "defaults are fine" (record the defaults in the spec).

## The fidelity ladder (always use the highest rung available)

| Rung | Mechanism                                                                                                        | When                                                         |
| ---- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| 1    | **Real Storybook render** — `mcp__storybook__preview-stories` with `globals={theme:'<slug>'}` (see helper below) | The option maps to a real component/template/playbook story. |
| 2    | **Generated artifact preview** — a self-contained HTML file of the assembled multi-component screen              | A composed surface no single story covers (VP-04 issue-03).  |
| 3    | **Option thumbnail / code snippet** — `AskUserQuestion` option `preview`                                         | A quick A/B where a full render is overkill or unavailable.  |
| 4    | **Text description** — last resort                                                                               | Nothing renders (no Storybook, no artifact path).            |

**Rule:** never advance a visual choice on **text alone** when a render is
possible. If rung 1 is reachable (the Storybook dev server can be started), use
it before dropping to a lower rung.

## Getting a real render (rung 1)

- If the `mcp__storybook__*` tools exist, call `mcp__storybook__preview-stories`
  with the story ID + `globals={theme:'<slug>'}` and **surface the URL**.
- If they don't exist and you're inside the brand-ui monorepo, **start the dev
  server** (`pnpm storybook` in the background), drive it, then stop it when done.
- Theme slugs are the CSS slugs, never display names: `qlik-bright`, `qlik-dark`,
  `blueprint`. Story-ID derivation + tool details: the brand-ui Storybook-MCP rule.
- **Fallback (server unavailable):** drop to rung 2 (artifact) or rung 3
  (option preview) — and say plainly that the choice was made without a live
  render, so the user knows to eyeball it after scaffolding.

## Where it's used in the interview

`reference/stages.md` marks each stage that carries a visual choice with **[visual
loop]** — stages 2 (archetype), 3 (nav), 5 (brand/feel/theme), and 6 (per-surface
chart types / layout). Run this loop there; capture the chosen option into
`app-spec.md` immediately.

## Review the result like a designer

After scaffolding a surface, review it for interaction & front-end hygiene and,
for anything bigger than a tweak, run the `brand-ui-visual-ux-reviewer` — the loop
is for _choosing_, the reviewers are for _verifying_ the rendered result. Report
the findings to the user (the reviewers report; they don't fix).
