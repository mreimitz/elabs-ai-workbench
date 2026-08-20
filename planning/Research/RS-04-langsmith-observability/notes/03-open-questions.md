---
type: "Research Note"
title: "03 \u2014 Open questions (settle before anything is built)"
description: "Owner decisions in the repo's usual sense \u2014 once decided, each gets a D-OBn number and is"
tags: ["research", "RS-04"]
timestamp: "2026-08-20T13:47:37Z"
status: "final"
---
# 03 — Open questions (settle before anything is built)

Owner decisions in the repo's usual sense — once decided, each gets a D-OB*n* number and is
recorded as locked. [`02-enhancement-concept.md`](../outputs/02-enhancement-concept.md) references these
by Q-OB number. Several reshape the concept materially.

---

**Q-OB1 — Where does monitoring live in the IA?**
Testing IA just consolidated nav 7→4. Options: (a) a new top-level Observability view, (b) the
existing Dashboard grows tabs (Scans | Testing | Issues), (c) a tab inside Testing. (b) keeps
nav flat but mixes two audiences; (a) is honest about scope creep. Also: does the scans
dashboard eventually merge into the same metrics backbone (`/api/metrics/scans`)?

**Q-OB2 — Metrics: compute on demand or maintain rollups?**
Concept v0 says plain SQL on demand (derived-never-authoritative, like suite analytics). At what
run count does that stop holding on the SQLite file, and do we then add a derived
`run_metrics_daily` table (recomputable, still not authoritative) or indexes only? Needs a quick
profiling spike with realistic volumes (10k–100k runs).

**Q-OB3 — Comparability rules for mixed-capability fleets.**
`vendor_assistant` runs have estimated tokens and question-based cost; subscription runs have
reference cost. Do token/cost charts exclude, footnote, or split these (per the C3 capability
manifest)? Same question for `meanScore` across judge vs deterministic graders. The wrong
default silently produces dishonest charts — the one sin the app's reporting has avoided so far.

**Q-OB4 — Does human feedback join the analytics?**
O1.5 stores human scores. Do they stay a separate lens, or blend into `meanScore` /
suite analytics / Compare (which today are grader-only)? LangSmith blends by key; blending here
touches the AR6 "expectation metrics keep their meaning" invariant.

**Q-OB5 — Scope: which session kinds does the layer cover?**
Runs only? Runs + scans (footprint over time is arguably our *core* fleet metric)? Assistant
sessions too (unified-run-sessions Q11 asks the same from the contract side)? Recommendation in
concept v0 is runs + scans first; assistant sessions only if Q11 pulls them into the contract.

**Q-OB6 — Prebuilt-only dashboard, or custom chart composer?**
LangSmith ships both. Concept v0 ships prebuilt panels + global filter/group-by and defers a
chart composer. Is that enough for the owner's actual monitoring questions, or is composer v1
a requirement (significantly more UI surface: metric picker, series editor, layout persistence)?

**Q-OB7 — Step hierarchy: wire-level or presentation-level?**
`parentStepId` on `run_steps` is honest and replay-stable but is a wire/persistence change every
executor must feed. Alternative: presentation-only grouping (rating steps fold under a header by
convention). Wire-level unlocks per-span rollups (O3.2) properly; presentation-level ships
faster and can be upgraded later. Which, and if wire-level: do rating/judge calls become steps
retroactively for old runs (no) or only forward?

**Q-OB8 — Re-run-from-step semantics.**
Allowed on suite members (probably not — comparability)? Do derived runs join suite aggregates
and the runs feed by default, or live under a "derived" filter? Does lineage carry into Compare
automatically? What is forbidden to override (environment? servers?) so a derived run stays
meaningfully comparable to its parent?

**Q-OB9 — Windowed alerts on an app that isn't always running.**
LangSmith is a service; this app runs when the owner runs it. A windowed rule ("error rate >
30% over 15 min") evaluated by an in-process ticker misses everything while the app is closed.
Options: catch-up sweep on boot (evaluate missed windows, notify late), evaluate-on-open only,
or accept the gap. Also: is Docker-compose "always on" the actual deployment reality, making
this moot?

**Q-OB10 — How much human-review workflow does a single owner want?**
O2.4 (thumbs in console) is clearly cheap. Is O4.4 (rubric checklist queue) wanted at all, or
does it wait for team-server (where reservations/multi-reviewer come back into play)? Deciding
this late is fine; nothing else depends on O4.4.

**Q-OB11 — FTS scope and cost.**
Which step payloads get indexed (assistant text, tool args, tool results?) and at what per-field
truncation? Tool results can be huge (base64, JSON dumps) — indexing them naively bloats the DB
the same way the skills zip-bomb caps guard against. Also: index rating/forensics text so
"search by diagnosis" works?

**Q-OB12 — One issues registry.**
Rating Issues (v26) already exist per-run/persisted. Does O5 extend that table (add clustering
key, occurrences, status lifecycle) or introduce a `fleet_issues` table referencing it? And the
label problem: "Issues" (LangSmith Engine term) vs the existing registry's naming — one word,
both surfaces, before UI ships.

**Q-OB13 — What is the Assistant allowed to do about an issue autonomously?**
O5.3 keeps every write behind the existing approval protocol (D-AS4). Is scheduled *analysis*
(no writes) allowed to run unattended (cost: CLI/subscription contention — unified-run-sessions
Q7 decoupling matters here), or is the whole loop strictly owner-initiated? The answer separates
"Insights analog" (passive report) from "Engine analog" (active watchtower).

# Citations

None.
