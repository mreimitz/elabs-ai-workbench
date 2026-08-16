# Professional vs consumer vs marketing — the first decision

The single most important call in this skill. Before any component, decide which of
three product types you are building. Each has a different goal, so each gets a
different design language ("register"). Conflating them is the category error this
skill exists to prevent.

> **Visual:** `assets/images/generated_concept_principles.png` summarizes the five
> universal business-app principles; do/don't pairs live in `assets/images/`.

## One-line tests

- **Professional / enterprise** — "A trained user will do this repeatedly as part of
  their job." → **calm** register.
- **Consumer** — "A stranger uses this voluntarily and we want them to come back." →
  **lighter, friendlier** register.
- **Marketing / presales** — "A visitor is deciding whether to care; we want one
  action." → **expressive** register.

Mixed product? Classify **per surface**: the app shell is professional; a `/landing`
or `/pricing` route is marketing. Don't let one register leak into the other.

## What changes with the answer

| Dimension       | Professional / enterprise                 | Consumer                        | Marketing / presales          |
| --------------- | ----------------------------------------- | ------------------------------- | ----------------------------- |
| Goal            | Complete real work accurately             | Engage & retain a mass audience | Persuade → convert            |
| Success metric  | Task throughput, error rate ↓             | DAU, retention ↑                | Conversion rate               |
| User            | Expert, repeat, obligated                 | Novice→casual, voluntary        | First-time, skeptical         |
| Info density    | **High, on purpose**                      | Low                             | Low (one idea/section)        |
| Visual register | Calm, neutral, tokens, restraint          | Friendly, branded               | Expressive, big type, imagery |
| Motion          | Explains state, <~200ms                   | Delight micro-interactions      | Scroll/reveal choreography    |
| Copy            | Domain terms, terse, verb+object          | Plain, warm                     | Benefit-led, persuasive       |
| Navigation      | Persistent shell, stay-on-page            | Tabs/bottom nav                 | Sticky top nav → CTA          |
| brand-ui home   | `ui · data · charts · ai · flow · editor` | `ui` (lighter)                  | **`marketing`**               |
| Avoid           | Over-simplifying, hiding power            | Overwhelm, jargon               | Walls of text, many CTAs      |

## The trap (memorize this)

A coding agent told "build an internal admin console for X" will, left alone, often
emit a **marketing** layout: hero banner, three equal feature cards, a big gradient
headline, fake-perfect stats. That is a category error. An admin console is a
**professional** surface → calm register, archetype B shell, the app baseline.
**If you find yourself reaching for `@brand/marketing` (Hero, StatsBand, FeatureGrid,
CTASection) inside an operational app, stop and re-classify.**

## Legitimate expressive moments inside a professional app

The expressive register is correct in bounded spots — wherever there is **no work to
do yet** — then snap back to calm the moment real data/tasks appear:

- Empty states (invite the first action) · first-run onboarding · upgrade / plan /
  paywall pages · changelog / what's-new · in-app announcements · presales "demo mode".

These are the only places `@brand/marketing` belongs inside a pro app.

## Per-archetype register (for brand-ui-new-app)

| Archetype                                            | Register                                               |
| ---------------------------------------------------- | ------------------------------------------------------ |
| Dashboard · Data app · AI assistant · Flow workspace | professional                                           |
| Settings                                             | professional (+ bounded expressive on upgrade screens) |
| Marketing                                            | marketing (the expressive exception)                   |

## Why this is true (evidence)

Marketing/landing design is persuasion- and conversion-centred; a professional app is
task-centred — usability is the whole product, persuasion is irrelevant once the user
is working. Enterprise users are experts who tolerate and need density; the answer to
complexity is **progressive disclosure**, not removal. The enterprise design-system
consensus (IBM Carbon, Salesforce Lightning, Atlassian) is built on clarity,
predictability and density — not delight or persuasion. (Sources: NN/g enterprise UX; IBM Carbon, Salesforce Lightning,
Atlassian; and conversion-design literature — collected in the skill's research notes.)
