---
type: "Work Package Spec"
title: "WP 2.6 — Skills: cards carry the metrics, Overview leads with the outcome strip, seven tabs, Studio labelled preview"
description: "Phase 2 of item.md. Ledger: STATUS.md. Skill cards gain footprint, security surface, usage and open issues; the inspector Overview opens with an outcome strip and the Total footprint, loses its editing control, and drops from nine tabs to seven in question order; Quality says one thing; Usage gets outcome columns; Design and Studio lay the outline out vertically with a fit-to-view; Trace becomes reachable or un-claimed."
tags: ["roadmap", "RM-37"]
timestamp: "2026-08-22T07:10:00Z"
status: "final"
---
# WP 2.6 — Skills: cards carry the metrics, Overview leads with the outcome strip, seven tabs, Studio labelled preview

Phase 2 of [`item.md`](./item.md). Ledger: [`STATUS.md`](./STATUS.md). Follows the rules in
[`wp-2.1-shell-ia.md`](./wp-2.1-shell-ia.md) (rules 1, 3, 5 and 7 apply here).

## Scope

`/skills` (`apps/web/src/features/skills/SkillsOverview.tsx`), `/skills/:skillId` (`SkillInspector.tsx`,
`SkillOverview.tsx`, `SkillUsageTab.tsx`, `SkillVersions.tsx`, `SkillDiffView.tsx`, `quality/*`, `design/*`)
and `/skills/:skillId/studio` (`studio/*`). Additive wire fields on the skill list and usage endpoints
(`apps/api/src/skills/*`) are in scope; nothing else under `apps/api/` is. **Out of scope:** the Studio's
editing and save surfaces (RM-30 Phase 7,
[`/Roadmap/RM-22-skill-ide/item.md`](/Roadmap/RM-22-skill-ide/item.md)), the SkillFlow trace engine
([`/Roadmap/RM-23-skillflow/item.md`](/Roadmap/RM-23-skillflow/item.md)), the skill version in the URL (WP
3.4), the token-profile label map (WP 3.1), the group-by trigger label (WP 2.3 fixes all EntityBrowser
consumers), and the Frontmatter card stretch already scoped by RM-36
[`wp-2.2-consistency-density.md`](/Roadmap/RM-36-ui-ux-audit-remediation/wp-2.2-consistency-density.md)
(P2-5). **Continues** RM-36 WP 2.2 and [`/Roadmap/RM-24-skills/item.md`](/Roadmap/RM-24-skills/item.md). The
README wording about the read-only inspector is WP 0.7's.

## Target layout

Reading order on `/skills` (EntityBrowser, grid default, **no grouping** — source stays a chip on the card):

| Zone | Component | Contents | Removed / merged / demoted |
|---|---|---|---|
| 1. Toolbar | `ViewToolbar` | search · Group by (value label shown) · results "5 skills · no collisions" · **+ Add skill** (primary, right) | breadcrumb "Skills › Skills" → one crumb |
| 2. Card | `EntityCard` | identity: name (untruncated) · source chip · "v37"; **primary number: Total footprint 10,278** with an L1/L2/L3 stacked mini-bar; meta "5 files · 41.5 KB · no scripts · no network refs"; usage "2 environments · last run Jul 15 · Answered"; declared + observed servers as chips; ⋯ (Open · Studio (preview) · Download · Delete) | grouping by source; description/URL/updated move to the meta line or tooltip; sort default = Total footprint desc |
| 3. Table view | `EntityTable` | Name · Source · Version · Total footprint · L1 · Files / size · Security surface · Environments · Last run · Open issues · ⋯ | — |

Reading order on `/skills/:skillId`:

| Zone | Component | Contents | Removed / merged / demoted |
|---|---|---|---|
| 1. Header | `PageShell headerVariant="toolbar"` | name · version picker labelled "Latest (v37)" · source link · actions: Download · Refresh · **Studio (preview)** (secondary) | "Edit in Studio" as the primary slot and its duplicate on Design |
| 2. Outcome strip | `KpiStat` ×7, one row | Total footprint 10,278 (per turn 50) · Security 100 Clean · Quality 100 · **Open issues 8 (5 high)** · Environments 2 · Last run Jul 15 · `BaseVerdictChip` Answered | — (new; the strip answers size / safety / issues / usage before any tab) |
| 3. Tabs (in URL) | `TabPanel` | **Overview · Issues · Usage · Quality · Files · Versions · Design** | Security (→ Overview surface card + Quality findings), Diff (→ an action inside Versions); nine tabs become seven |
| 4. Overview left | `MetricCard` featured + `KpiStat` inline | Total first, L1 50 · L2 3,959 · L3 6,269 under a stacked bar, line "per turn: 50 · on first use: 3,959 · on demand: 6,269", profile by its human label; then Usage summary (environments · "Seen with <server> · 5 runs · last Jul 15" · last outcome → Usage) | Total as the fourth tile; raw `generic_o200k` id (WP 3.1) |
| 5. Overview right | `Descriptions`, `ProseCardDescription` | Frontmatter with the description **untruncated**; Security surface (score, band, "7 skill rules ran"); Triggers read-only, one state-aware sentence; Servers = declared binding + observed binding | the keyword `TagInput` + "Save as new version"; the two contradictory empty sentences |
| 6. Overview bottom | rendered SKILL.md | full width below the card row | half-width column with an empty right half |
| 7. Quality | `QualityScoreCard` + sections | score + one summary line; Tool references first when it has rows; Findings / Optimization only when non-empty; zero counts in neutral chips | three "nothing found" sections; red "0 errors" chip |
| 8. Usage | `EntityTable` | header "5 runs · 5 answered · avg judge —"; columns Started · Environment · Outcome (`BaseVerdictChip` + score) · Skill read (turn 1 / never) · Cost · Skill version "v37 (2.4.1)" · Open | leading Status column of "Completed"; external-link icon on an internal route |
| 9. Design / Studio canvas | `SkillGraphCanvas` | **vertical outline (top-to-bottom)**, fit on mount and on mode change, zoom clamped at the readability floor, scroll instead of shrink | horizontal chain with 3–4 of N nodes visible |
| 10. Studio chrome | `StudioShell` | Exit · Flow / Code / Split · Problems count badge (the bottom strip owns the list) · "Editing v37" · Save; the app sidebar collapses to its icon rail while the Studio is open | second "Problems 1"; unlabeled "v37"; full sidebar inside the workbench |

Primary action: on `/skills` it is **+ Add skill**; on the inspector there is none (read surface) — Studio
(preview) is secondary; in the Studio it is **Save**.

## Actions

1. **Skill cards carry the product's metrics — P1.** WHAT: the card recipe in zone 2 and the table columns in
   zone 3; no grouping by default. WHERE: `/skills` · `apps/web/src/features/skills/SkillsOverview.tsx`
   (group-by at `:63-72,129-136`, card at `:216`), `skill-groups.ts`; the list payload
   (`packages/shared/src/types.ts:3269` `Skill` carries no footprint) gains an additive `current` summary —
   `totalTokens`, `l1MetadataTokens`, `fileCount`, `totalBytes`, `scripts`/`networkRefs` flags, security score
   + band, environments count, last run at + outcome, open issues — served by `GET /api/skills`
   (`apps/api/src/skills/*`). TARGET STATE: every card shows Total footprint as its only large number, the
   meta, usage and servers lines, and the ⋯ menu; sort by Total footprint desc; breadcrumb reads "Skills"
   once.
2. **Overview: outcome strip, Total first, description untruncated, Triggers read-only — P1.** WHAT: zones 2,
   4, 5, 6. WHERE: `/skills/:skillId?tab=overview` · `SkillOverview.tsx` (footprint card `:286-315` with
   `label="Total"` last; `TagInput` + "Save as new version" `:352-370,551`; Security surface `:436`; Servers
   card). TARGET STATE: a seven-stat strip under the header; the footprint `MetricCard` features Total with
   L1/L2/L3 beneath and the "per turn / on first use / on demand" line; the frontmatter description renders in
   full via `ProseCardDescription`; the Triggers card has no editing control and reads one sentence — both
   lists empty: "No triggers yet — this skill is reached by name only. Add keywords or a /command in the
   Studio."; SKILL.md renders full width below the cards.
3. **Tabs nine → seven, in question order — P1.** WHAT: Overview · Issues · Usage · Quality · Files · Versions
   · Design; Security merges into the Overview surface card and the Quality findings list; Diff becomes
   "Compare selected" inside Versions (route `?tab=diff` redirects to Versions with the pickers open). WHERE:
   `SkillInspector.tsx:717-741` (`TabsTrigger` list), `:743-920` (contents), `SkillVersions.tsx`,
   `SkillDiffView.tsx`. TARGET STATE: seven triggers in that order; Issues shows its count; `?tab=security`
   and `?tab=diff` still resolve.
4. **Quality says one thing — P2.** WHAT: one summary line under the score; sections render only when
   non-empty; Tool references first when it has rows; zero counts neutral. The `src_year` "unknown tool" comes
   from a fenced code sample — exclude fenced code from the tool-reference scan, and count any remaining
   tool-reference diagnostic in the score instead of showing 100 beside it. WHERE:
   `/skills/:skillId?tab=quality` · `quality/QualityView.tsx:300`, `quality/QualityScoreCard.tsx`,
   `quality/ToolDiagnosticsSection.tsx:86`; the scanner under `apps/api/src/skills/` that emits
   `unknown_tool`. TARGET STATE: a clean skill shows the score and one line; a skill with one finding shows
   the score reduced and that finding first.
5. **Usage answers "did it help?" — P1.** WHAT: zone 8 columns and header line; "Skill read" derived from
   `read_skill_file` steps in the run; both version numbers labelled. WHERE: `/skills/:skillId?tab=usage` ·
   `SkillUsageTab.tsx:77-119`; the usage endpoint gains per-run `outcome`/score, `skillReadTurn` and `costUsd`
   (additive). TARGET STATE: every run row shows an outcome chip and whether SKILL.md was read; the header
   states runs · answered · average judge score; the Open cell uses an internal-link glyph.
6. **Design and Studio: vertical outline + fit-to-view, one Problems, one CTA — P2.** WHAT: switch the layout
   geometry from LR to TB (an outline reads downward), keep `resolveFitViewport`'s readability clamp and
   re-fit on mode change; one "Studio (preview)" CTA on the inspector; Problems listed in the strip only, the
   toolbar shows the count; "Editing v37"; the Problems-strip "Line 113" link scrolls the target line to
   centre **after** the panel lays out; Settings-rail copy wraps instead of clipping; the app sidebar
   collapses to its icon rail inside the Studio. WHERE: `/skills/:skillId?tab=design`,
   `/skills/:skillId/studio` · `design/graph-layout.ts` (`:302` LR geometry),
   `design/SkillGraphCanvas.tsx:279-300` (`FitViewOnChange`), `SkillInspector.tsx:637`,
   `studio/StudioShell.tsx:35-69`, `studio/StudioLeftRail.tsx`. TARGET STATE: the whole outline of a
   20-section skill is visible at ≥ 11 px labels at 1440×900 in Flow and Split; one Problems surface; one CTA.
7. **Studio labelled preview and out of the primary slot — P1.** WHAT: label the CTA "Studio (preview)"
   wherever it appears (inspector header, card menu, Design tab) and render it as a secondary action; keep the
   Files tab's Save/Discard as the documented editing path until RM-30 WP 7.3/7.4 land. WHERE:
   `SkillInspector.tsx:637`, `SkillsOverview.tsx` card menu, `design/SkillDesignView.tsx`. TARGET STATE: no
   primary-styled button on a skill page leads to the Studio.
8. **Trace reachable or un-claimed — P2.** WHAT: either mount `SkillTraceView` as a Studio lens (the context
   panel already reserves the frame) or remove the inspector's hidden `trace` tab value and mark the CLAUDE.md
   SkillFlow row "built, currently unreachable". WHERE: `SkillInspector.tsx:338-345` (`trace` → `files`
   redirect), `:829` (dead `TabsContent value="trace"`), `studio/StudioContextPanel.tsx:12`,
   `trace/SkillTraceView.tsx`, `CLAUDE.md` SkillFlow row. TARGET STATE: a user can open a trace from the
   Studio, or no document claims they can.
9. **Servers card: observed binding beside the declared one — P2.** WHAT: a line derived from run history —
   "Seen with <server> · 5 runs · last Jul 15" — next to the frontmatter `servers:` state, so a skill used
   with a server in runs never reads "Not bound to any server yet" alone. WHERE: `SkillOverview.tsx` Servers
   card; derivation from `run_steps` (`read_skill_file` followed by tool calls per server) in the usage
   endpoint. TARGET STATE: the card shows both the declared and the observed binding, each labelled.
10. **Versions: real provenance, unclipped source refs, recounted diff — P3.** WHAT: "Imported: GitHub" for
   github-pulled versions (not "Upload"); Source ref cells truncate middle with a tooltip; the
   Files/Total-tokens deltas on Diff are recounted from both trees. WHERE: `SkillVersions.tsx:41,145-168`,
   `SkillDiffView.tsx`. TARGET STATE: a GitHub skill's versions read "GitHub"; a diff whose description lost a
   clause shows a non-zero SKILL.md delta.
11. **Security-rule count by subject kind; header icon tooltips — P3.** WHAT: "All 7 skill rules ran" (not 18 —
   `SECURITY_RULES` holds 11 server + 7 skill rules); the header Refresh / Diff / Download icons show their
   tooltip on hover. WHERE: `apps/web/src/features/security/SecurityPanel.tsx:322`
   (`Object.keys(SECURITY_RULES).length`), `SkillInspector.tsx` header icons (route through
   `components/IconButton.tsx`). TARGET STATE: the count matches the rules that ran for that subject kind;
   every header icon has tooltip == `aria-label`.

## Acceptance

- [ ] `/skills` at 1440×900: every card shows Total footprint as its only large number, a usage line and at
      least one server chip where a binding exists; no group heading unless the user picks one; the breadcrumb
      has one crumb.
- [ ] `/skills/:skillId` at 1440×900: the outcome strip (seven stats) and the Total footprint are visible
      without scrolling; the tab bar reads Overview · Issues · Usage · Quality · Files · Versions · Design.
- [ ] The Overview renders no `TagInput`, no "Save as new version" and no sentence that contradicts another;
      the frontmatter description shows in full; SKILL.md spans the content width.
- [ ] Quality on a skill whose only diagnostic is a token inside a fenced code block shows score 100 and no
      Tool-references row; on a skill with a real unknown tool the score is < 100 and that row is first.
- [ ] Usage lists an outcome chip and a Skill-read value on every run row; the header line shows runs ·
      answered · average score.
- [ ] Design and Studio (Flow and Split) show the complete outline at ≥ 11 px labels on mount and after a mode
      change; exactly one Problems list and one Studio CTA, labelled "Studio (preview)", are on screen.
- [ ] Trace is reachable from the Studio, or `CLAUDE.md` says it is not.
- [ ] Both themes read correctly on all three routes.
- [ ] Gate green: `pnpm typecheck && pnpm test && pnpm build && pnpm lint`.

## Effort

**M** overall — actions 1, 2, 5 and 9 need additive API fields (S–M each); 3, 4, 6, 7 are web-only (S each);
8, 10, 11 are S.

## Sources

UX-19, UX-20, UX-21, UX-22, UX-23 · EU-17, EU-18, EU-19, EU-20, EU-21, EU-22, EU-23 · PO-11, PO-12 · PS-13 ·
QA-23 (skill-header icons), QA-26 (a, c, d, e — b is WP 3.4's), QA-27 · walkthrough `/skills` and
`/skills/:id` notes (cards without metrics, nine tabs, Triggers editing control, horizontal chain, Quality
"nothing found" three ways, Usage without outcome, Studio chrome).
