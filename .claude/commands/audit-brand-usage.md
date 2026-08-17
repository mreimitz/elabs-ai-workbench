---
description: Audit the web app for raw-color / library-first violations (report only, don't fix)
allowed-tools: Bash, Read, Grep
---
Audit `apps/web/src` against @.claude/rules/library-first.md and
@.claude/rules/styling-and-tokens.md. **Report findings as `file:line`; do not patch.**

Flag:
- **Raw color literals** in `.ts`/`.tsx` — `#hex`, `rgb()/rgba()/hsl()/hsla()`. (Color belongs in
  the oklch tokens shipped by `@elabs-ai/components-tokens`, never in component code.)
- **Bespoke UI that duplicates a `@elabs-ai/components-*` export** — hand-rolled buttons/inputs/tables/dialogs/
  badges/panels instead of the library component. Check exports via `pnpm exec brand-ui docs <Component>` or the `.d.ts`
  or `pnpm exec brand-ui <info|search|docs>` first.
- **`className` used to recolor/re-typeset** a library component (layout-only is fine).
- **A second styling system** sneaking in (Tailwind utilities, inline `style={{color/background}}`,
  CSS-in-JS).
- **Hardcoded theme assumptions** that break in `dark`.

Suggested starting grep (raw colors in app code):

```bash
grep -rnE '#[0-9a-fA-F]{3,8}\b|\b(rgb|rgba|hsl|hsla)\(' apps/web/src --include='*.ts' --include='*.tsx'
```

For each finding, recommend the fix path: use an existing `brand-ui` component, add a token, or
extend the library (per `library-first.md`). Report only.
