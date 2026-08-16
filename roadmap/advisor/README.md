# Advisor — implementation plan · **PRIORITY: MEDIUM**

Owner directive (2026-07-04): turn measurements into **advice**. The app knows footprints,
runtime behavior, grades, and costs — the Advisor layer converts them into concrete, evidenced
recommendations ("disable these 12 tools in this scenario: −9.2K tokens/turn at unchanged suite
score", "these 3 descriptions are 41% of the server's footprint", "skill X: +0.11 mean grade for
+$0.004/run"). Supersedes-and-extends the open testing WP 5.7 (trends/recommendations) — that
WP's scope folds in here; tick it in the testing ledger with a pointer when Phase 1 lands.

Living state: [`STATUS.md`](./STATUS.md) (driven by `/next-wp advisor`).

## What we're building

1. **Deterministic rule engine** (versioned `ADVISOR_VERSION`, findings with evidence links):
   - *Unused-tool trim*: per scenario, tools never called across its runs vs their footprint
     share → suggested `allowed_tools` trim with estimated tokens saved per turn.
   - *Description bloat*: top-N tools by footprint share; per-tool token vs usage frequency.
   - *Loading-mode comparison*: eager vs deferred (`tool_loading_mode`) side-by-side for the
     same scenario (peak context, tokens, cost — data already captured by the run engine).
   - *Overlap detection*: near-duplicate tools across a scenario's servers (reuse
     `compare/matching.ts`).
2. **Grade-aware recommendations** (needs Benchmarks P3/P5): toolset-trim validated by suite
   score (suggest only when quality holds), skill effect summaries from A/B deltas, cheapest
   model clearing a quality bar per suite (joins compatibility + grades).
3. **Fleet report**: an on-demand aggregate report (servers + drift, scenario costs, suite
   grades, posture summary when available) exported JSON/Markdown through the reports family.
4. **UI**: an Advisor view (recommendation cards with evidence drill-through) + inline
   recommendation panels on server/scenario detail.

## Invariants

- Recommendations are **suggestions with evidence** — the app never auto-applies them. Each
  card links the runs/scans/grades it was derived from and states its assumptions.
- Deterministic rules stamped `ADVISOR_VERSION`; grade-aware rules additionally record the
  `grading_version` / suite-run ids they read. Insufficient data → honest "not enough data"
  state, never a guess.
- Estimated savings are labeled estimates and reproducible from the cited inputs.

## WP index

### Phase 1 — Deterministic rules
| WP | Title | Depends on | Size |
|---|---|---|---|
| 1.1 | Contract + rule engine core: recommendation shapes, evidence refs, `ADVISOR_VERSION` | — | M |
| 1.2 | Rules: unused-tool trim, description bloat, loading-mode comparison, overlap | 1.1 | L |
| 1.3 | UI: Advisor view + server/scenario panels | 1.2 | M |

### Phase 2 — Grade-aware
| WP | Title | Depends on | Size |
|---|---|---|---|
| 2.1 | Quality-validated trims + skill-effect summaries + model-per-quality-bar | 1.2, benchmarks 3.4/5.1 | L |
| 2.2 | Fleet report (JSON/MD export via reports family) | 1.2 (richer with 2.1) | M |

## Definition of done (every WP)

Gate green from repo root + acceptance (fixture scenarios produce the expected recommendations
with correct arithmetic, verified by hand-computed cases); ledger discipline per
[`STATUS.md`](./STATUS.md).
