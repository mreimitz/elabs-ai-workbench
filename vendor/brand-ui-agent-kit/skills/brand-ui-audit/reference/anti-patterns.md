# Design anti-patterns (brand-ui, token-aware)

Flag these in review. Each maps to a brand-ui fix — a token, a variant, or an
existing component. Never recommend a raw value.

This catalog harvests the taste-skill's **AI-TELLS** list (WP-15, research
[`09-taste-adoption.md`](../../../research/enterprise-gap/09-taste-adoption.md)),
**token-translated**: where the source prescribes a literal (`#000`, `Geist`,
emerald), we name the brand-ui token/rule instead — **the styling/token rules win
every conflict.** Many of these are checked deterministically by
`brand-ui audit <path>` (the detector rule id is shown in `[brackets]`); the rest
are perceptual and live in the rendered/visual pass.

## Visual / "AI slop"

- **Raw or arbitrary colors** (`#…`, `rgb()`, `bg-[#…]`) anywhere but `themes.css`.
  `[raw-hex` / `rgb-literal` / `arbitrary-color]` → semantic token (`bg-card`,
  `text-muted-foreground`, `bg-primary`).
- **Pure black** — the `-black` utilities (`text-black`, `bg-black`, `border-black`)
  `[pure-black]`, or raw `#000` `[raw-hex]`. → the `foreground` / `border` token (an
  off-black tuned per theme). `bg-black/<alpha>` is fine ONLY as an overlay scrim
  (e.g. `DialogOverlay`), so `pure-black` exempts it.
- **Neon / outer glow** (`shadow-[0_0_…]`, a `0 0 <blur>` halo). `[neon-glow]` →
  a tinted or inset shadow token (`shadow-sm/md`), never an outer glow.
- **Oversaturated accent / "AI purple"** — a loud, >~80%-saturation accent, or
  more than one accent competing. → palette discipline: max **one** accent, the
  committed brand token; lean on neutrals (the audit already caught the brand
  green at 3.61:1 — the _discipline_ is welcome, the specific hue is the brand's).
- **Gray text on a colored/tinted background** (washed out). → `*-foreground`
  token paired with the surface, or a darker token of the same hue.
- **Side-stripe accent borders** (`border-left` > 1px as decoration). `[side-stripe]`
  → full `border-border`, a `bg-*` tint, or a leading icon/Badge. (A semantic
  `border-s-2`/`-s-4` accent rail per the surface-separation grammar is the
  _intentional_ exception — role-coded, not decoration.)
- **Gradient text** (`background-clip:text` + gradient). `[gradient-text]` → one
  solid token color; emphasis via weight/size.
- **Nested cards / card-for-everything.** Cards only when they're the right
  affordance; never a `Card` inside a `Card`. **(Register-gated — see below.)**
- **Identical icon-tile-above-heading grids** repeated endlessly. → vary structure.
- **Custom mouse cursors** (`cursor-[url(…)]`). `[custom-cursor]` → keep the system
  cursor (dated + accessibility-hostile).
- **Unicode glyphs that render as emoji** (e.g. `↕` U+2195 for sort). → a lucide
  icon (`ChevronsUpDown`) in `text-muted-foreground`. (This is the DataTable sort bug.)
- **Hardcoded / over-round radius** (`rounded-[10px]`, `rounded-3xl`). `[arbitrary-radius`
  / `over-round]` → the `--radius`-backed `rounded-*` scale (brand-ui radius is tight).
- **`h-screen` (100vh)** for a full-height region. `[viewport-h-screen]` →
  `min-h-dvh` / `min-h-[100dvh]` (viewport-stable on mobile).

## Content / "AI slop" (the "Jane Doe effect")

The content the audit lacked before WP-15 — generic, machine-generated copy that
makes a real product read as a demo. Brand-agnostic. The unambiguous ones are
deterministic (`[bracketed]`) and **ratcheted in CI** (`pnpm slop:check` — finders
report, the gate has the teeth); the softer ones are advisory.

- **Generic placeholder names** ("John Doe", "Jane Doe", "Sarah Chan"). `[slop-generic-name]`
  → a realistic, domain-specific name for the surface (a finance app's user list
  isn't full of Does).
- **Egg / default avatars** (SVG eggs, a bare Lucide `User` glyph as the avatar).
  → a real image, or `AvatarFallback` with the person's initials.
- **Fake-perfect numbers** — round/too-perfect stats ("99.99%", "50%", "100%",
  "1234567"). The deterministic check `[slop-fake-number]` targets the unambiguous
  ones ("99.9%"/"99.99%", "1234567") and deliberately skips bare "50%" (it would
  collide with alpha/fractions like `bg-primary/50`, `w-1/2`); judge the rest by
  eye. → a realistic, specific figure (pair number columns with `tabular-nums`).
- **Slop brand names** ("Acme", "Nexus", "SmartFlow", "Cloudly"). `[slop-brand-name]`
  → the real product name. **Brand identity lives in tokens + the logo (`BrandLogo`),
  never in hardcoded sample copy.**
- **AI filler verbs** ("Elevate", "Seamless", "Unleash", "Next-Gen", "Revolutionize",
  "Reimagine", "Disrupt"). `[marketing-buzzword]` → name what it literally does
  (extends the existing buzzword list; see Copy & microcopy in `ux-evaluation.md`).
- **Broken / placeholder image links** (dead `source.unsplash.com`, hotlinked
  stock). → a reliable, self-hosted placeholder or a real asset with explicit
  `width`/`height` (CLS), `loading="lazy"` below the fold.

## Register-gated tells (advisory in PRODUCT; harder in BRAND/high-density)

These are **not hard bans** — they'd break legitimate enterprise admin UIs. Judge
against the active register (see SKILL.md Setup) and the taste profile:

- **Three-column equal feature cards** / a wall of identical cards. Fine in a
  dense product dashboard; a generic tell on a **brand/marketing** landing page →
  vary the layout (bento, split, asymmetry) at high expressiveness.
- **Anti-card-overuse** — a `Card` wrapping content that spacing alone would
  separate. Advisory in product (cards are a first-class affordance here); flag
  harder in brand register.
- **Section-number eyebrows** ("00 / INDEX", "001 · Capabilities"), version labels
  in a hero ("V0.6", "BETA"), decorative locale/weather strips. Marketing-surface
  tells → drop unless the brief is genuinely about launch/place.

## Layout / hierarchy

- **Empty showcase / dead content area** — a shell with placeholder text and no
  real content. → compose real content (`MetricGrid` + `DataTable`, etc.).
- **Flat type scale** — headings barely larger than body. → use the type scale;
  ≥1.25 step ratio.
- **Cramped or arbitrary spacing.** → the Tailwind scale + `gap-*`, consistent rhythm.
- **Overflow / clipping** — a control taller than its container (e.g. a
  field-sizing textarea in a fixed-height row). → fix the container
  (`has-[textarea]:h-auto`, `flex-wrap`), not the symptom.

## States (often missing)

- **No empty / loading / error state.** → `EmptyState`, `Skeleton`/`Spinner`/`LoadingState`,
  `ErrorState`/`Alert`.
- **Missing focus ring** (`outline-none` with no replacement). → `focus-visible:ring-2 ring-ring`.
- **Destructive action with no confirmation/undo.** → `AlertDialog`; friction
  proportional to consequence.

## Accessibility / ethics (from the Intent catalog)

- **Contrast below AA** in any theme (measure, don't assume).
- **Icon-only control without `aria-label`; input without a label.**
- **Avatar without `AvatarFallback`; Dialog/Sheet/Drawer without a Title.**
- **Mandatory / perpetual motion** — the taste-skill prescribes infinite
  animation on "every card." brand-ui **rejects this as an a11y red line.** Any
  motion must ship a `motion-reduce:` neutralizer and respect `MotionPreference`
  (system/reduced/full); the product default is calm. Expressive, looping motion
  is opt-in at high motion intensity / brand register only. See
  `docs/MOTION_GUIDELINES.md` (and the `bounce-easing` / `layout-anim` detector
  rules: animate `transform`/`opacity`, not layout, with tokened easing).
- **Dark patterns** — prechecked consent, confirmshaming opt-out copy, fake
  urgency/scarcity, asymmetric opt-out, low-contrast decline buttons. These are
  defects, not features — flag with severity and name the pattern.

## Severity guide

- **P0** — illegible/inaccessible (AA failure), broken layout, unusable control.
- **P1** — clearly hurts quality (empty showcase, weak hierarchy, overflow).
- **P2** — polish (icon affordance, spacing rhythm, faint borders in low-contrast conditions).
