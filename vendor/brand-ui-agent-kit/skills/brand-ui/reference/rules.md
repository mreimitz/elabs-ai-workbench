# brand-ui — critical rules (Incorrect / Correct)

These mirror the brand-ui rules. Run `brand-ui audit <path>` to catch the
mechanical ones.

## Color: semantic tokens only

Raw colors live ONLY in the `@brand/tokens` theme stylesheet
(`@brand/tokens/styles.css`). App code uses token-backed utilities so every
theme works.

```tsx
// ❌ raw / arbitrary color — breaks theming, fails the audit
<div className="bg-[#0b1f17] text-gray-500 border-[#e5e7eb]" />
<span className="text-emerald-600">+20.1%</span>

// ✅ semantic tokens
<div className="bg-card text-muted-foreground border-border" />
<Badge variant="success">+20.1%</Badge>
```

## className is layout, not recolor

```tsx
// ❌ overriding the component's colors/typography
<Button className="bg-blue-600 text-white text-lg" />

// ✅ use variants/sizes; className for layout only
<Button variant="default" size="lg" className="w-full" />
```

## Authoring/extending a component

```tsx
// ❌ no ref, no className merge, no spread
export function Thing(props) {
  return <div className="p-4">{props.children}</div>;
}

// ✅ forwardRef + cn() + spread
export const Thing = forwardRef<HTMLDivElement, ThingProps>(function Thing(
  { className, ...props },
  ref,
) {
  return <div ref={ref} className={cn("p-4", className)} {...props} />;
});
```

## Overlays: Radix, no manual z-index

```tsx
// ❌ custom popover with hand-rolled stacking + dismissal
<div className="absolute z-[9999]">…</div>

// ✅ the primitive owns focus, dismissal, stacking
<Popover><PopoverTrigger asChild><Button>Open</Button></PopoverTrigger>
  <PopoverContent>…</PopoverContent></Popover>
```

## Focus ring (never remove it)

```tsx
// ❌
<button className="outline-none">Go</button>
// ✅ (Button already does this; for custom controls keep it)
<button className="outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">Go</button>
```

## Spacing & sizing

```tsx
// ❌ space-y / unequal w-h
<div className="space-y-4"><Card/><Card/></div>
<Avatar className="w-10 h-10" />
// ✅ gap + size
<div className="flex flex-col gap-4"><Card/><Card/></div>
<Avatar className="size-10" />
```

## Required sub-parts

```tsx
// ❌ Avatar without fallback; Dialog without a title
<Avatar><AvatarImage src={url} /></Avatar>
<DialogContent>…</DialogContent>

// ✅
<Avatar><AvatarImage src={url} /><AvatarFallback>MR</AvatarFallback></Avatar>
<DialogContent><DialogTitle className="sr-only">Edit</DialogTitle>…</DialogContent>
```

## Theme-safety

Don't reach for `dark:` overrides — components rely on semantic tokens so all three
themes (qlik-bright default, qlik-dark, blueprint) benefit. If you add a visual
concept, it's a token in every theme block, not a literal in the component.

## Accessibility baseline

Real elements (`<button>`/`<a>`/`<input>`), labelled inputs (visible or `sr-only`),
`aria-label` on icon-only controls, `aria-hidden` on decorative SVGs, body text
≥ 4.5:1 / UI ≥ 3:1 in every theme. Loading → `role="status"`; errors → `role="alert"`.
