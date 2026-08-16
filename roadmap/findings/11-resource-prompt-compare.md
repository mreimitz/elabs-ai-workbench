# Resource / prompt cross-server compare (Round 6, `ui-findings6`)

Completes the **diff-across-servers** story (north-star #3/#4) for the entities Round 4 added:
`GET /api/compare` now diffs **resources** (incl. templates) and **prompts** across two scans,
alongside tools. Built **contract-first** across two reviewed lanes, each gated + live-verified.

## Base — this round needs BOTH R3 and R4

Resource/prompt compare extends R3's compare engine AND consumes R4's resource/prompt data, so its
base is a **combined branch**: `ui-findings6` = `ui-findings4` (R4) with `ui-findings3` (R3) merged in
(auto-merged cleanly — `types.ts` + `compare.test.ts` resolved with no conflicts). The combined base
gated green (typecheck + **test 107/107** + build + brand-ui audit baseline) before any R6 work.

## Lane 1 — backend (`ui/rpc-api`)

Mirrors the existing tool-level diff in `buildComparison`, **reusing the generic matcher unchanged**.
- **Contract (additive):** `ComparedResource` (`kind`/`uri`/`name?`/`mimeType?`/`totalTokens`/
  `contributionPercent`), `ComparedPrompt` (`promptName`/`totalTokens`/`contributionPercent`),
  `ResourceMatch`/`PromptMatch` (`a`/`b`/`basis`/`similarity`/`deltaTokens`/`deltaPercent`).
  `ScanComparison` gains `resourceMatched`/`resourceOnlyInA`/`resourceOnlyInB`/`resourceCounts` +
  the prompt equivalents. No zod/endpoint change (response-only).
- **Service:** resources ride the matcher with `toolName = uri` (URI is identity — exact same uri
  matches across scans; cross-server falls to fuzzy over name+description), prompts with
  `toolName = promptName`. Matcher-only `toolName`/`description` are stripped before returning the wire
  objects. Deltas are `B − A` with the existing percent guard. The tool path is untouched.
- **Tests:** +4 (matched-by-uri / matched-by-name with deltas; onlyInA/B; fuzzy/normalized match; no
  matcher-field leak). 111/111.

## Lane 2 — web (`ui/rpc-web`)

`CompareView` now wraps its diff table in **Tools | Resources | Prompts** tabs (count-bearing
triggers = matched+added+removed). A reusable local `DiffTable` renders all three (DataTable + toolbar
with count badges, search, Change `FacetFilter`, and the cross-server-only Fuzzy-match select). The
Tools tab keeps its Definition column; Resources show a Resource/Template `kind` Badge and an `a → b`
label when matched uris differ; the **Match** column (basis + similarity %) shows in cross-server mode;
each tab has a real empty state. The Δ `MetricCard` + cross-profile `Alert` stay above the tabs.

## Live verification (seeded `:8099`, real servers, BOTH themes, screenshots eyeballed)

- **API:** `everything` ↔ `everything-2` (cross-server) → **9 resources matched (basis exact, uri
  identity)**, **4 prompts matched (exact name)**, Δ 0 (identical surfaces), no matcher-field leak.
  `everything` ↔ `filesystem` → 9 resources / 4 prompts **onlyInA** (filesystem exposes none).
- **Web (qlik-bright + qlik-dark):** the Compare view shows Tools (13) / Resources (9) / Prompts (4)
  tabs; the Resources tab renders the diff (Resource · Match `Exact 100.0%` · Before · After · Δ ·
  Change), Template/Resource badges, 0 added / 0 removed / 9 matched; the Prompts tab the same with 4
  matched. Both themes read cleanly with the Match column + fuzzy select (cross-server).

## State + PR topology (this round's wrinkle)

`ui-findings6` = `main` + **R3 + R4 + R6** (it does NOT include R5/PR #4). Because R6 depends on two
still-open PRs (R3 #2, R4 #3), there's no single existing branch with just R3+R4 to stack on cleanly —
so landing R6 is a choice (one combined PR vs main, or hold until #2/#3 merge then PR R6's diff). The
clean resolution is to **merge #2 (R3) + #3 (R4) to `main` first**, after which both R5 (#4) and R6
rebase to small, independent diffs. `main`/`origin/main` untouched throughout (still `5da8228`).

## Out of scope / deferred

Resource/prompt compare reuses the same `threshold` for all three surfaces (no separate resource/prompt
preset). Definition-level diffing of resources (mimeType/description changed flags, like tools'
`definitionDelta`) is a possible later refinement; v1 diffs by token totals + matched/added/removed.
