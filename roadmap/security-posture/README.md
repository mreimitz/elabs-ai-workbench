# Security posture — implementation plan · **PRIORITY: HIGH**

Owner directive (2026-07-04): the app already stores everything needed to assess an MCP
server's or skill's **security posture** — tool names/descriptions/annotations/schemas
(`mcp_tool_scans`), OAuth metadata, and skill file trees (registry security surface). Add a
**deterministic, versioned analyzer** that turns that data into findings + a score, diffable
release-to-release, and usable as a CI assertion (`roadmap/ci/` WP 3.1).

Living state: [`STATUS.md`](./STATUS.md) (driven by `/next-wp security-posture`).

## What we're building

1. **Server analyzer** over persisted scan data (never a live MCP call, never execution):
   - *Tool-poisoning heuristics*: injection phrasing in descriptions ("ignore previous…",
     "do not tell the user…", imperative exfiltration patterns), hidden-instruction blocks,
     zero-width/homoglyph unicode, suspiciously long descriptions with embedded protocols.
   - *Annotation sanity*: destructive/open-world tools without warning hints; `readOnlyHint`
     contradictions (e.g. a `delete_*` tool marked read-only).
   - *Schema hygiene*: secret-shaped parameters (`token`, `password`, `api_key` as free text),
     parameters without descriptions, unconstrained `additionalProperties` on sensitive tools.
   - *OAuth surface*: scope breadth review from stored (non-secret) auth metadata.
2. **Skill analyzer roll-up**: the existing skills security surface (scripts + languages,
   network references, byte/file totals) normalized into the same finding/report shape.
3. **Score + diff**: per-server/per-skill 0–100 posture score (documented weighted formula, like
   the Skill IDE quality engine I4), findings anchored to the tool/file, and a **posture diff**
   between two scans / two skill versions (new/resolved findings).
4. **UI**: a Security tab on scan/server detail and in the skill inspector; posture badges in
   the servers list; diff view integrated with the existing compare surfaces.

## Invariants

- Deterministic + versioned (`SECURITY_ANALYZER_VERSION`); findings carry `ruleId`, severity
  (`error`/`warning`/`info`), evidence (tool name / file / matched text span, redacted), and a
  documented rationale. Never-silently-compare across analyzer versions.
- Read-only over persisted data; no MCP connection, no skill execution, no network.
- Heuristics are conservative and documented — a finding must say *why* and cite the matched
  evidence; severity inflation is a defect. False-positive review is part of every rule's
  acceptance fixtures.
- No new runtime dependency (regex/unicode tables in-house; confusables subset documented).

## WP index

### Phase 1 — Analyzer
| WP | Title | Depends on | Size |
|---|---|---|---|
| 1.1 | Contract: `SecurityFinding`/`SecurityReport`/score shapes, rule-id registry, version constant | — | S |
| 1.2 | Server analyzer: poisoning/annotation/schema/OAuth rules over latest scan + score | 1.1 | L |
| 1.3 | Skill analyzer: security-surface roll-up into the same report shape + score | 1.1 | M |
| 1.4 | Posture diff: scan-to-scan and version-to-version (new/resolved/unchanged findings) | 1.2, 1.3 | M |

### Phase 2 — Surfacing
| WP | Title | Depends on | Size |
|---|---|---|---|
| 2.1 | UI: Security tab (server/scan + skill inspector), list badges, diff view | 1.4 | L |
| 2.2 | Report export integration (scan/server/skill reports gain a posture section) | 1.4 | S |

Downstream: `roadmap/ci/` WP 3.1 (`no-new-security-findings` assertion) consumes Phase 1.

## Definition of done (every WP)

Gate green from repo root + acceptance (fixture matrix per rule: a crafted offending scan/skill
fires exactly the expected findings; clean fixtures score clean; determinism proven); ledger
discipline per [`STATUS.md`](./STATUS.md).
