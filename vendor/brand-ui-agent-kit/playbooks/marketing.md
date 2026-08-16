# Playbook — Marketing / presales landing page

Standalone pitch page: nav → hero → proof → capability → relevance → trust →
ask. Template source: `templates/marketing.tsx` (generated from this Storybook story by `pnpm gen:templates`).

## Building blocks

| Section    | Component                                        | From                         |
| ---------- | ------------------------------------------------ | ---------------------------- |
| Nav        | sticky header + `BrandLogo` + `Button` CTA       | `@brand/ui` / `@brand/icons` |
| Hero       | `Hero` (eyebrow/title/description/actions/media) | `@brand/marketing`           |
| Proof      | `StatsBand` (3–4 numbers)                        | `@brand/marketing`           |
| Capability | `FeatureGrid` (6 items, 3 columns)               | `@brand/marketing`           |
| Relevance  | `UseCaseCard` ×3 (industry cards)                | `@brand/marketing`           |
| Trust      | `LogoStrip` (customer logos)                     | `@brand/marketing`           |
| Ask        | `CTASection` (one action)                        | `@brand/marketing`           |

## Section order (and why)

```
header (sticky, backdrop-blur)
└── main (max-w-6xl, flex-col gap-24)      ← gap-24 between sections, no dividers
    Hero        — what it is, in one line          (attention)
    StatsBand   — numbers that earn belief          (credibility)
    FeatureGrid — what it does, scannable           (capability)
    UseCaseCard — "this applies to MY industry"     (relevance)
    LogoStrip   — who already trusts it             (social proof)
    CTASection  — one ask, repeated from the nav    (action)
```

Embedded variant (a section inside a demo app): drop the header, footer, and
`CTASection`; keep the middle sections.

## Prop shapes (the ones people guess wrong)

```tsx
// Hero: media switches centered → split layout
<Hero
  title="…"
  description="…"
  actions={
    <>
      <Button size="lg">Primary</Button>
      <Button size="lg" variant="outline">
        Secondary
      </Button>
    </>
  }
  media={
    <img
      src="/shot.png"
      alt="Product screenshot"
      width={1200}
      height={800}
      className="rounded-xl border"
    />
  }
/>;

// FeatureGrid: icon is an ELEMENT, not a component reference
const features: Feature[] = [{ title: "…", description: "…", icon: <Sparkles /> }];

// StatsBand
const stats: Stat[] = [{ value: "38,000+", label: "customers worldwide" }];

// LogoStrip: ReactNode[] — mixed <img>/inline SVG fine; rendered h-7, muted/grayscale
<LogoStrip logos={[<img key="a" src="/logos/acme.svg" alt="Acme" width={96} height={28} />]} />;
```

All sections animate in by default (motion-token-gated, `motion-reduce`
safe); pass `animate={false}` to opt out.

## Decisions you own

Copy (headline, stats, feature titles — the hard part) · CTA labels +
targets · feature count/icons · standalone vs. embedded · theme
(qlik-bright for a Qlik pitch; client-brand theme for client pitches —
re-branding is a token swap, not a redesign).

## Decisions already made — don't re-make

Section order · split-vs-centered hero (presence of `media` decides) · logo
treatment (muted/grayscale, uniform height) · CTA band styling (`CTASection`
owns the primary surface) · responsive behavior of every section.

## Common mistakes

- Inventing section layouts with raw Tailwind when a `@brand/marketing`
  component covers it.
- More than one ask in `CTASection` — one action converts.
- `<img>` without `width`/`height` (CLS) — applies to hero media and logos.
- Hardcoding brand colors for a client pitch — make a theme, swap
  `defaultTheme`.
