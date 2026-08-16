# UX evaluation — scorecard, states, WCAG, copy, ethics

The heuristic/structured layer of a brand-ui audit. Synthesized from established
practice (Nielsen's 10, WCAG 2.2, the dark-pattern catalog) and adapted to
brand-ui's tokens and components. Use it to turn raw findings into a scored,
routed report.

## Run two independent passes, then synthesize

Anchoring is the enemy of an honest review. Run **Pass A (design/heuristic review)**
and **Pass B (deterministic detector + rendered contrast)** independently, then
synthesize. Pass A should be formed before the detector output enters judgment —
deterministic numbers anchor the eye. (This mirrors how a mature critique engine
separates the two.)

## Scorecard (0–4 per dimension → /24)

Score each, lead with the verdict, cite specific evidence (file:line or surface+theme).

| #   | Dimension                   | What to score                                                                                                                                                                                                                  |
| --- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | **Accessibility**           | Contrast (all themes), focus rings, semantic elements, labels, keyboard, ARIA only where needed                                                                                                                                |
| 2   | **States & resilience**     | Are the component states present? (see inventory below) empty/loading/error designed, not blank                                                                                                                                |
| 3   | **Theming & tokens**        | Semantic tokens only; correct in qlik-bright/qlik-dark/blueprint; no raw hex                                                                                                                                                   |
| 4   | **Consistency & hierarchy** | One component family; clear visual hierarchy; spacing rhythm; aligned edges                                                                                                                                                    |
| 5   | **Visual anti-patterns**    | No visual AI-slop tells (gradient text, nested cards, gray-on-color, emoji glyphs, over-round, neon glow, pure black); intentional detail                                                                                      |
| 6   | **Taste & anti-slop**       | No content slop (the "Jane Doe effect": generic names/avatars, fake numbers, slop brand names, filler verbs); fits the **active taste profile** (register × density × motion × expressiveness); motion is `motion-reduce`-safe |

**Bands (/24):** 22–24 excellent (polish only) · 17–21 good (fix weak dims) ·
12–16 acceptable (significant work) · 7–11 poor (overhaul) · 0–6 critical.
Optionally also give a 0–100 UX health composite and a one-line anti-pattern
verdict ("does this look AI-generated?") — which now weighs **content** slop, not
just visual.

Dimensions 5 and 6 map onto the deterministic detector (`brand-ui audit <path>`)
plus the catalog in [anti-patterns.md](./anti-patterns.md); dimension 6 is **register-
gated** (opinionated tells like 3-equal-cards / anti-card are advisory in product,
harder in brand). See SKILL.md "Setup" for picking the register/profile.

Severity tags on every finding: **P0** blocking/inaccessible (AA failure, broken
task) · **P1** major (WCAG AA violation, weak hierarchy) · **P2** minor · **P3** polish.
Each finding: what + where + why it matters + token-referenced fix + which command/skill owns it.

## Nielsen's 10 (quick heuristic pass, score 0–4 each)

H1 visibility of system status · H2 match to real world · H3 user control & freedom
(undo) · H4 consistency & standards · H5 error prevention · H6 recognition over
recall · H7 flexibility/efficiency · H8 aesthetic & minimalist · H9 help users
recover from errors · H10 help & docs. Document specific violations, not "nav could
be better."

## The 9-state inventory (per component / screen)

A component library is judged by its states. For each interactive surface, verify
all nine — and that brand-ui's state components are used, not bespoke markup:

| State                  | Check                                                      | brand-ui component                    |
| ---------------------- | ---------------------------------------------------------- | ------------------------------------- |
| **default**            | communicates what it is + what you can do                  | —                                     |
| **hover**              | signals interactivity (never essential info; not on touch) | variant styles                        |
| **focus**              | visible ring, distinct from hover (a11y requirement)       | `focus-visible:ring-ring`             |
| **active/pressed**     | immediate feedback                                         | variant styles                        |
| **disabled**           | shows why / when it re-enables                             | `disabled:` + tokens                  |
| **loading**            | skeleton (not a spinner mid-content); action acknowledged  | `Skeleton`, `LoadingState`, `Spinner` |
| **empty**              | what it's for + how to add the first + why (not "no data") | `EmptyState`                          |
| **error**              | what went wrong + how to fix (not "something went wrong")  | `ErrorState`, `Alert`                 |
| **partial / overflow** | some loaded/failed; 10k rows; pagination/truncation        | `DataTable` pagination                |

Output a **state matrix** (component × state) flagging the missing/ad-hoc ones.

## WCAG 2.2 for designers (POUR + the 2.2 additions)

- **Perceivable** — text alt for meaningful images, empty alt for decorative;
  contrast ≥ 4.5:1 body / 3:1 large + UI; never color-only meaning; reflow at 400% zoom.
- **Operable** — everything keyboard-reachable, no traps; visible focus; **target
  size ≥ 24×24px** (2.2); **focus not obscured** by sticky headers/toasts (2.2);
  **dragging has a non-drag alternative** (2.2); no 3+ flashes/sec; respect
  `prefers-reduced-motion`.
- **Understandable** — visible labels on every input (not placeholder-only);
  consistent patterns; errors identified in text with a fix; **don't ask for
  re-entry of data already given** (2.2); **no cognitive-test-only auth** (2.2).
- **Robust** — semantic HTML first; ARIA only to fill a genuine gap (wrong ARIA is
  worse than none); reading order = DOM order; landmarks (`main`/`nav`/`header`/
  `footer`); live regions (`role="status"` polite, `role="alert"` assertive, sparingly).

Automated tools catch ~30%; tab through it and check at 200%/400% zoom.

## Copy & microcopy (what to flag)

- **Error message** = what went wrong **+** how to fix. "Invalid input" fails;
  "Email must include @ — e.g. name@company.com" passes. Adjacent to the field,
  `aria-describedby`, clears when fixed. Tone: solution, never blame.
- **Empty state** = what it's for + how to start + why it's worth it (+ a CTA).
- **Button label** = verb + object ("Save changes", "Delete project"), not "OK"/"Yes".
- **Link text** stands alone ("View pricing", not "Click here").
- **No marketing buzzwords / filler verbs** (streamline/empower/supercharge/
  seamless/world-class/elevate/unleash/revolutionize/next-gen…); name what it
  does. **No 3+ em-dashes** as cadence. Plain language (grade 6–8).
- **No content slop — the "Jane Doe effect"** (anti-patterns.md, Content): generic
  placeholder names ("John/Jane Doe"), egg/default avatars, fake-perfect numbers
  ("99.99%"), slop brand names ("Acme/Nexus"). Use realistic, domain-specific
  content; the brand lives in tokens + the logo, not in hardcoded copy.
- Destructive-action **friction hierarchy**: (1) visual distinction → (2) confirm
  dialog naming the consequence → (3) type-to-confirm → (4) cooling period.
  Match friction to consequence; don't confirm reversible actions (offer undo instead).

## Ethics / dark-pattern check (flag as P0/P1)

Scan for manipulative patterns; each has an honest alternative:

- **Confirmshaming** → neutral opt-out ("No thanks", not "No, I hate saving money").
- **Visual misdirection** → decline option gets equal visual weight/size/position.
- **Prechecked consent / sneak-into-basket** → nothing opted-in or added without a
  deliberate action; no pre-checked marketing/data boxes.
- **Trick questions** → every option stateable as an affirmative; no double negatives.
- **Hidden costs** → show totals before personal info.
- **Fake urgency/scarcity**, **forced continuity**, **roach-motel cancel** → honest
  state, symmetric opt-out (cancel as easy as signup).

Dark-pattern findings are always P0 or P1; name the pattern and the regulation if
relevant (GDPR pre-checked-consent ban, FTC click-to-cancel, etc.).

## Taste pre-flight (final QA gate, before "done")

A condensed, **token-translated and a11y-safe** version of the taste-skill's
pre-flight matrix (WP-15). Run it on a surface before shipping; a "no" is a
finding. **Register-gate** it — product is the calm default, brand is expressive.

- **Tokens, not literals** — no raw hex/font/arbitrary color anywhere but
  `themes.css`; one accent (the brand token), neutral base; one corner-radius
  system; one type role-scale (no raw `text-xl`). (`brand-ui audit` proves these.)
- **Content is real** — no "Jane Doe", no "99.99%", no "Acme", no filler verbs;
  avatars have real images or initials; images have `width`/`height`.
- **Every state designed** — default/hover/focus/active/disabled/loading/empty/
  error present; skeletons over spinners; tactile `:active` feedback.
- **Motion is honored, not mandated** — animations justified, `transform`/`opacity`
  only, tokened easing, **`motion-reduce:` neutralizer + `MotionPreference`
  respected**; nothing loops perpetually in the product register.
- **Contrast holds in all three themes** — body ≥ 4.5:1, large/UI ≥ 3:1 (measure on
  real pixels; the static pass can't prove this).
- **Hierarchy & layout** — clear type hierarchy by weight/size; `min-h-dvh` not
  `h-screen`; cards only where the affordance is right (register-gated); no wall of
  identical 3-equal-cards on a brand surface.

## Output

A scored health report: the /24 scorecard + (optional) 0–100 composite, the
anti-pattern verdict (visual **and** content), the taste pre-flight result, P0–P3
findings (each token-referenced + routed), the state matrix, a WCAG note, the
ethics check, and **positive findings** (what to protect). Write it to a dated
file (e.g. `reports/visual-ux-<date>.md`), then **report the findings to the
user** (each with `file:line`/surface, severity, and a concrete token-referenced
fix). This is a reporter — it reports and routes; it doesn't fix.
