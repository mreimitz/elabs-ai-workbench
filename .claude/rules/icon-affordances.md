# Icon affordances (D-TB5)

Every **icon-only control** in this app carries exactly **one** hover/focus affordance, and it is a
Radix **`Tooltip`** whose text **equals its `aria-label`**. This closes audit finding **D-7** — three
divergent mechanisms across ~124 icon buttons (~11% styled Radix `Tooltip`, ~16% bare native
`title`, ~72% `aria-label`-only with *nothing* on hover) — by collapsing them to one.

> **Locked owner decision D-TB5 (2026-07-25).** One icon affordance mechanism. The tooltip text
> equals the `aria-label`; the native `title` attribute is **never** used for this; disabled
> controls expose their reason via the tooltip **and** `aria-describedby`. Enforced by an
> **`IconButton`** primitive that derives both the tooltip text and the `aria-label` from **one
> `label` prop** — so the two can never diverge and no call site can forget the tooltip. There is
> **no `title` escape hatch** on `IconButton`.

## The rule

- **Use `IconButton`** (`apps/web/src/components/IconButton.tsx`) for any button whose only visible
  child is an icon glyph. Pass the accessible name **once**, as `label`; it becomes **both** the
  `aria-label` **and** the tooltip text. They are the same string by construction — they cannot
  diverge, and the tooltip cannot be forgotten.
- **Never use the native `title` attribute** to explain an icon-only control. It has a ~1.5s OS
  delay, is unstyled, and — the real defect — is **invisible to assistive technology** (`title` is
  not `aria-describedby`). `IconButton` has no `title` prop; the type omits it.
- **Disabled controls carry a reason.** When a control is `disabled` in a way that could confuse an
  operator, pass `disabledReason`. It is shown in the tooltip **and** wired to `aria-describedby`
  (via an always-present `sr-only` node), so it reaches screen readers even while the tooltip is
  closed. The tooltip still opens on a disabled control: the Radix trigger is a focusable/hoverable
  wrapper `<span>`, not the disabled `<button>` (a disabled `@elabs-ai/components-ui` `Button` carries
  `pointer-events-none`, so hover falls through to the wrapper). Do not hand-roll this — use
  `IconButton`.
- **Visible focus + `size="icon"`** come from the `@elabs-ai/components-ui` `Button` `IconButton` composes; the
  focus ring is token-driven and reads in both themes. `className` stays layout-only.
- The glyph itself is **decorative** — mark it `aria-hidden` at the call site. The accessible name
  comes from `label`, never from the icon.

## The one carve-out for `title`

`title` is still the sanctioned recovery for **truncated text** on an element that *is not* an
icon-only control (D-10 — a clamped description, a truncated cell). The ban here is narrow and
specific: on a **text-less `<Button>`**, `title` is forbidden; use the tooltip via `IconButton`.

## Scope / status

The primitive and this rule are the **foundation**. Converting the existing ~124 icon-button call
sites (starting with the reused form kit — `ListEditor`, `KeyValueEditor`, `TagInput`,
`SliderNumber`) is a **separate, later phase** of the toolbar-reach plan — do not treat an unconverted
site as a violation of a shipped conversion. New icon-only controls, however, use `IconButton` from
the start.

Related: [`brand-ui-only.md`](./brand-ui-only.md) (every visible element is `@elabs-ai/components-*`),
[`interaction-guidelines.md`](./interaction-guidelines.md) (form/a11y hygiene),
[`styling-and-tokens.md`](./styling-and-tokens.md) (two themes, semantic tokens).
