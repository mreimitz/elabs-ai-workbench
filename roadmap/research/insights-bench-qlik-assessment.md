# Assessment: `insights-bench-qlik` vs. MCP Token Footprint

> Analysis of `~/Downloads/insights-bench-qlik-main` (2026-07-04). Research artifact, not a plan —
> nothing here is committed work; owner decisions are flagged at the end.
>
> **Follow-up (same day):** the §6 decisions were resolved with the owner and became the
> **Benchmarks workstream** — locked decisions B1–B15 + phased WPs at
> [`../benchmarks/`](../benchmarks/) (ledger: [`STATUS.md`](../benchmarks/STATUS.md)).
> D-3 resolved as: no external hosted-agent adapters (B15).

## 1. What it is

A **Python research pipeline** (scripts + Jupyter, no app, no UI, no DB) that benchmarks the
**answer quality** of two Qlik analytics agents against
[InsightBench](https://insightbench.github.io/) — 100 datasets / 425 questions across 12 question
types and 3 difficulty levels, each with ground-truth insight, insight value, action, and the
reference pandas code that produced it.

Two engines are compared:

- **MCP path** — the Qlik MCP server driven by **Claude Code (Sonnet 4.5)**. Per-app prompt files
  instruct the agent to answer all questions using only `qlik_*` tools and to **self-report** its
  own metrics (tool-call trajectory, full interaction log, token estimate, latency, skills used)
  back into a JSON file via a bash heredoc.
- **DAA path** — Qlik's hosted **Data Analyst Agent / Qlik Answers** via the
  `cloud-assistants` threads + stream REST API; the `<final>` answer is parsed out of the streamed
  AdaptiveCard payload.

Pipeline: extract questions from InsightBench notebooks → load CSVs as Qlik Cloud apps
(`csv_to_qlik_apps.py`) → run predictions (both paths) → score → analyze in a notebook.
Everything persists as mutated-in-place JSON files.

## 2. The evaluation methodology (the valuable part)

Three scores per answered question:

| Score | How | Notes |
| --- | --- | --- |
| `rouge_score` | ROUGE-1 of `pred_insight + pred_insight_value` vs GT text | Cheap, deterministic, weak signal (their own top example scores 0.15 on a correct answer) |
| `gemini_eval_score` (0–1) | **G-Eval-style LLM-as-judge** (Gemini 2.5 Pro, Vertex): "rate 1–10 how close to GT", `<rating>` tag, temperature 0 | **Logprob-weighted**: reads top-5 token candidates at the rating position and returns the probability-weighted expected rating — a meaningfully smoother score than a single sampled integer |
| `tools_vs_code_score` (0–10) | **Trajectory judge** (Gemini 3.1 Pro): compares the agent's recorded tool-call chain (`tools.interactions` with request/response/thought/selections/error) against the GT **reference Python code** — same dimensions? same measures/aggregations? same filters/groupings/sort? redundant or missing steps? | Explicit 0–10 rubric; outputs `calculation_comparison` + `tools_vs_code_reason`. Grades the **process**, decoupled from the phrased answer |

The two-axis design is the key idea: **outcome score × process score**. Their notebook mines the
quadrants — e.g. 64.5% of "low insight / high process" cases are the agent being *penalized for
over-delivering* (extra percentages, data-quality caveats GT scripts ignore), i.e. an eval
artifact, not an agent failure.

Also notable: `convert_to_benchmarks.py` detects GT insights that say "column missing / KeyError"
and marks those tasks `answerable: false`, so agents are scored on **recognizing unanswerable
questions** instead of being judged against a broken ground truth.

### Their headline findings (single run each, May 2026)

~40% failure rate for both engines, bimodal all-or-nothing score distribution. Shared weaknesses:
temporal blindspot (static aggregates instead of grouping by time), the "smart-analyst penalty",
methodology mismatch, undefined-bucket ambiguity. MCP-specific: missing time dimension (39% of its
unique failures), silent proxy substitution, unprompted filters. DAA-specific: 51% of its unique
failures are *process narration instead of results*. They also correlate **which qlik-\* skills
the agent invoked per question type** (their §9) — directly relevant to our Skills attachment.

## 3. Engineering maturity — honest read

Research-grade, and it knows it: JSON files as the database, in-place overwrites, no run
versioning, single-run conclusions, prompts-as-orchestration, field naming drift
(`insight_eval_score` in the scorer vs `gemini_eval_score` in the results), and — critically —
**the MCP path's tokens/latency/trajectory are self-reported by the agent being tested**
("tokens_used: estimate based on response lengths"). None of the execution machinery is worth
porting. The *methodology* is.

## 4. Fit against MCP Token Footprint

The two projects are complements with one clean seam:

| Capability | insights-bench | Us |
| --- | --- | --- |
| Real agent loop against MCP servers | ✖ (pipes prompts into Claude Code CLI) | ✅ Testing run engine (Vercel AI SDK, multi-provider) |
| Tool-call trajectory capture | Self-reported by the agent, lossy | ✅ `run_steps` — exact, persisted, replayable |
| Token/cost measurement | Agent's own guess | ✅ Real counting + pricing + guardrails |
| Scenario/test management, attachments, skills | ✖ | ✅ Built (incl. `scenario_skills`) |
| **Ground truth on tests** (expected insight/value/reference logic, answerable flag) | ✅ | ✖ |
| **Outcome grading** (LLM-judge + lexical baseline) | ✅ | ✖ |
| **Process grading** (trajectory vs reference) | ✅ | ◐ SkillFlow conformance grades *flow adherence*, not analytic correctness |
| **Suite/batch execution + aggregate analytics** (distributions by type/difficulty, failure buckets, repeated failures) | ✅ (notebook) | ✖ (run compare is pairwise) |
| Cross-engine comparison (agent-loop vs hosted agent API) | ✅ | ✖ (and see decision D-3) |

Their entire prompt-engineering effort (§ of `generate_batch_prompts.py` begging the agent to
record `tools.interactions`, counts, latency, tokens) exists **because they lack our run engine**.
We already capture all of that exactly. Conversely, our runs finish with a transcript and cost but
**no notion of whether the answer was right**. That is the gap this project maps out for us.

The synthesis neither project has — and the reason this fits our north star rather than beside
it — is **quality × cost on one screen**: insight score vs. tokens/cost/latency per run, per
model, per MCP server, per attached skill. We have the X axis built; they prototyped the Y axis.

## 5. What's worth adopting (ranked)

1. **Grading as a first-class run dimension.** GT fields on `tests`
   (`expected_insight`, `expected_value`, `reference_logic` — code or trajectory —, `answerable`),
   and a grade record per run. Contract-first in `packages/shared`, graders behind a
   **`Grader` interface** exactly like `TokenCounter` (deterministic `rouge1` baseline —
   trivial unigram-F1, no new dep — plus `llm_judge` via our existing encrypted provider
   credentials; **no Gemini/Vertex dependency needed**). Stamp results with a `grading_version` +
   judge model id, mirroring `counting_version` discipline.
2. **The logprob-weighted judge technique** (`eval_utils.compute_insight_eval`) and the
   **trajectory-judge prompt + 0–10 rubric** (`compare_tools_vs_code.py`) — both port cleanly;
   the trajectory judge consumes our `run_steps` instead of self-reported interactions, and can
   accept a SkillFlow graph as the reference, unifying with conformance.
3. **Suite runs + results analytics.** Run a scenario across N graded tests (× M models),
   aggregate: score distributions by question type/difficulty, failure buckets, repeated
   low-scorers, and the **quality-vs-cost scatter**. Natural extension of the existing compare +
   compatibility views.
4. **Skill-effect measurement.** Their §9 (skills ↔ question-type correspondence) done properly:
   same suite with and without an attached skill → delta in grade, tokens, tool calls. Strongest
   unique payoff of our Skills + Testing combination; feeds SkillFlow's fracture→suggestion loop.
5. **`answerable: false` semantics** — grade the agent on refusing gracefully.
6. *(Content, optional)* An **InsightBench importer** (their `questions.json` → scenarios/tests).
   Caveat: the GT is bound to Qlik Cloud apps, so the suite is only meaningful when pointed at a
   Qlik MCP; generic suites need their own GT.

**Not worth adopting:** JSON-file persistence, prompt-based orchestration, self-reported metrics,
in-place score overwrites, the Vertex-specific client, single-run methodology.

**Adopt with eyes open:** their own §1.8 admits the judge is bimodal and penalizes better-than-GT
answers. Any grading feature must display the judge's reasoning (they store it — so should we),
version the judge, and never present a single-run score as truth.

## 6. Owner decisions needed before any of this becomes a workstream

- **D-1 — Scope:** add "Grading/Benchmarks" as a new roadmap workstream (`roadmap/grading/`)?
  Ranked items 1–3 are one coherent phase-able plan; 4 builds on it.
- **D-2 — Judge provider:** reuse existing provider-credential system for LLM-judge calls
  (recommended; zero new deps, cost-capped like runs) vs. a dedicated judge config.
- **D-3 — External engines:** a DAA-style hosted-agent adapter would reintroduce
  "results produced outside our run engine" — same territory as the session-JSONL feature you
  removed on 2026-07-03 (SkillFlow D6 amendment). Default: out of scope; graded runs stay
  engine-native.
- **D-4 — InsightBench content import:** worth it only if Qlik-MCP benchmarking is a real target
  tenant/workflow for you.

## 7. Source map (for later reference)

- Judge + logprob weighting: `scripts/evaluator/eval_utils.py` (`compute_insight_eval`)
- Trajectory-vs-reference judge (prompt, rubric, parsing): `scripts/evaluator/compare_tools_vs_code.py`
- Scoring orchestration: `scripts/evaluator/compare_insights.py`
- Self-reporting prompt scheme (what our run engine obsoletes): `scripts/querying/mcp_w_claude_code/generate_batch_prompts.py`
- Hosted-agent path (DAA/Qlik Answers stream parsing): `scripts/querying/daa_via_api/run_daa_predictions.py`
- `answerable:false` + benchmark folder format: `scripts/convertor/convert_to_benchmarks.py`
- Analytics/failure taxonomy: `evaluation/notebooks/insightbench_MCP_vs_DAA_comparison.ipynb` (+ `notebook_utils.py`)
- Data shapes: `data/extracted_questions/questions.json` (425 q / 100 apps),
  `evaluation/results/insightbench/results_12_may_2026/*.json`
