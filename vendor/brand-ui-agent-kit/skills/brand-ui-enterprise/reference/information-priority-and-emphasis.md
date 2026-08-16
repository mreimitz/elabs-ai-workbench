# Importance, emphasis & intent — designing by information value

The deepest judgment, and the one agents lack most: looking at content and knowing **what
matters most**, then giving it proportional **space, prominence, and interaction** — and
de-emphasizing or hiding the rest. `screen-layout-patterns.md` tells you _which component_;
this file tells you _what deserves the spotlight and how the user should act on it_. Without
it you get "everything present, nothing prioritized" — the most valuable thing in the smallest,
least-interactive corner.

## The core law

**Visual weight = information value.** Size, position, contrast, and **screen real estate**
must be proportional to how much the content matters to the user's task. The most valuable
thing gets the most room and the strongest emphasis; reference and raw data are de-emphasized,
collapsed, or moved to a secondary surface. (NN/g visual hierarchy; Refactoring UI; Tufte data-ink.)

## Step 1 — Rank every region by value to the task (the value tiers)

For each region ask "what does the user _do_ with this?" and tier it:

| Tier            | What it is                                                          | Treatment                                                        |
| --------------- | ------------------------------------------------------------------- | ---------------------------------------------------------------- |
| **Act**         | findings to act on; the primary task (Run, Approve, Fix)            | hero prominence; **interactive** (CTA / own surface); most space |
| **Decide**      | signals that drive the next choice (tokens, issues, status, deltas) | prominent + scannable; in lists as columns/badges                |
| **Reference**   | attributes, profile, config                                         | present but calm (`Descriptions`, secondary section)             |
| **Raw / debug** | JSON, full schemas, logs                                            | tucked away (a tab, `Collapsible`, `CodeBlock`)                  |

The mistake is rendering all four tiers as equal cards. Rank first, then emphasize.

## Step 2 — Allocate space by importance (proportion is a decision)

The pane that carries the most value gets the most room. **A ⅔ list + ⅓ detail, when the
detail is the point, is inverted** — give the high-value pane equal-or-more space. Don't let a
low-value visualization eat full width; don't let a list dominate the screen its detail should own.

## Step 3 — Turn insight into action (don't just display findings)

A valuable finding (an optimization recommendation, an "attention" item) is **Tier: Act** — it
must be _interactive_, not a static line buried in a card-in-card. Pattern: a short list of
findings, each = **what + why + a CTA** ("Schema is 88% of this tool's tokens → Trim schema").
Built-in recommendations tell the user what to do next; never bury the most actionable content.

## Step 4 — Kill redundancy (every region earns its place)

If the sticky header already shows the KPI band, the Overview tab must **not** repeat it — lead
Overview with something new (the findings). If the list shows a tool's instruction, the detail
repeating it in full is wasted: the list shows a **one-line truncated** summary (tooltip for the
rest), the detail shows the full text **once**. Say each thing in exactly one place.

## Step 5 — Encode efficiently (the right visual, the right size)

- A composition of parts = **one segmented/stacked bar**, not N stacked bars wasting vertical
  space. A chart earns its width only if it beats a number or a compact bar (Tufte data-ink).
- A ranked set (top contributors) = a **compact ranked list** with inline bars, not a giant
  full-width chart.
- Precise comparison = a **table**; trend = a line; part-to-whole = one stacked bar / ring.

## Step 6 — Order sections by importance & reading order

Tabs/sections read left-to-right: **summary first, then operate, then history/raw.** "Overview"
(the at-a-glance summary) is tab #1 and the default; never bury it second. Put the section the
user needs most often first.

## Step 7 — Promote a high-value task to its own surface

When a feature is important and repeated (Run Tool, a builder, a comparison), it deserves a
**first-class task surface**, not a cramped sub-panel: a large `Dialog` with **inputs on the
left, results on the right** (or a `Sheet`), room to breathe, and purposeful motion. Match the
surface to the task's value (surface decision tree: `object-and-navigation-patterns.md` §5).

## Worked redesign — the MCP server detail (Overview + Tools)

> Implemented as a paste-ready asset: `../assets/detail-hub.tsx` (findings-first Overview,
> rebalanced `SplitPanel`, decision-signal list, raw tucked last, Run-task `Dialog`).

**Overview tab** (was: repeats the header KPIs → Profile → findings buried in a card-in-card →
a full-width contributors chart):

- **Lead with the findings (Act):** "Attention & Optimization" becomes the hero — a list of
  recommendations, each _what + why + CTA_ ("qlik_create_data_object schema = 88% of its tokens
  → Review schema"). Most valuable content → top + width + interactive.
- **Don't repeat** the header KPI band.
- **Server Profile (Reference):** `Descriptions`, calm, below the findings.
- **Footprint composition:** one **segmented bar** (Names / Descriptions / Schemas / Annotations),
  not four stacked bars.
- **Top contributors:** a **compact ranked list** (tool · tokens · inline bar · %), not a
  full-width chart.

**Tools tab** (was: ⅔ list + ⅓ detail; list instructions overflow and duplicate the detail; no
decision signal; detail is a flat panel; Run Tool cramped):

- **Rebalance the split** — the detail is the point: list ~`360–400px`, detail takes the rest;
  each pane its own `ScrollArea`.
- **List = decision signal (Decide):** columns for **tokens** and a **detected-issues** badge +
  status — what helps you _pick_ the right tool. Name on one line, **truncate** the description
  (tooltip); don't repeat the full instruction here.
- **Detail = structured, not a flat list:** sub-`Tabs` (or clear sections) — **Breakdown** (one
  segmented bar + numbers), **Parameters** (`Descriptions`/table), **Run** (the task), **Raw**
  (schema/JSON in a `CodeBlock`). Hierarchy by value; raw tucked last.
- **Run Tool = its own surface (Act):** a large `Dialog` — **parameters on the left, result on
  the right** — launched from a prominent "Run" button; show the call's tokens/bytes with the
  result; purposeful reveal motion. A super-smart feature deserves a first-class surface.

## The one question that drives all of this

For every screen and every region: **"What is the most valuable thing here, how does the user
act on it, and do its size / place / interaction match that?"** If the answer is "everything
looks equally important" or "the valuable thing is the smallest / least interactive," redesign.

---

_Sources: NN/g Visual Hierarchy; Refactoring UI (Wathan & Schoger); Tufte data-ink ratio;
actionable-insights practice (Databox, Envoy, Sopact). Profiles in the skill's research notes._
