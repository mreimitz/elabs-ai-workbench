---
type: "Work Package Spec"
title: "WP 0.7 — README and product-page truth-up: tokenizer wording, drafted-fix wording, judge prerequisite, inspector claim, ports, screenshots, subscription-terms check"
description: "Phase 0 of item.md. Ledger: STATUS.md. Reword the README and product page to what the code does today (o200k/cl100k counting with a Claude proxy, drafted fixes, grading once a judge exists, an inspector that still edits triggers), add an Anthropic count_tokens profile, print both ports, settle the audience list and provider table, regenerate the eleven screenshots from demo data, and record the owner's subscription-terms decision."
tags: ["roadmap", "RM-37"]
timestamp: "2026-08-22T07:10:00Z"
status: "final"
---
# WP 0.7 — README and product-page truth-up: tokenizer wording, drafted-fix wording, judge prerequisite, inspector claim, ports, screenshots, subscription-terms check

Phase 0 of [`item.md`](./item.md). Ledger: [`STATUS.md`](./STATUS.md).

## Scope

Files: `README.md` — intro `:1-16`, "Who it's for" `:35-45`, "What sets it apart" `:47-65`, tour `:68-309`
(§4 Skills `:109-122`, §6 rating `:180-206`, §10 self-scan `:242-257`, §11 `:259-283`, §12 Illustrations
`:285-309`), CI `:384-438`, "Run it" `:462-530`, "Data & security" `:559-574`;
`planning/user-guide/DC-23-product-overview/product-page.md:108-116` ("no setup, no reference answer
required"); `planning/user-guide/DC-01-getting-started/01-key-concepts.md:89-100` (token profiles);
`docs/screenshots/` (11 PNGs referenced from README — the review copy holds only `_to_delete/`);
`scripts/readme-screenshots.mjs`; `apps/api/src/token-counting/profiles.ts:148-152` and
`packages/shared/src/constants.ts:16-25` (profiles are `o200k_base`/`cl100k_base` tiktoken plus two
heuristics; no provider count endpoint is called anywhere in `apps/api/src`). Out of scope: the in-app
"Studio (preview)" CTA (WP 2.6), judge auto-default and the testing first-run checklist (WP 1.3), the
demo seed the screenshots need (WP 1.1), the dashboard count fix the first screenshot needs (WP 2.2),
in-image docs at `/docs` (WP 1.4), the comparison page and the recorded closed-loop capture (WP 4.2),
the name/version/licence sentences (WP 0.2), README §9 on the Hub (WP 0.1).

## Actions

1. Tokenizer wording: README `:49-51` "counts … the way a model does — with real tokenizer BPE" →
   "exact for the GPT-4o/`o200k` and GPT-4/`cl100k` families (js-tiktoken, offline); a documented proxy
   for Claude and other models until a provider-count profile ships"; the same sentence in
   `01-key-concepts.md:89-100` and on the product page. — P0
2. Anthropic count profile: add `anthropic_count_tokens` to `TOKEN_PROFILES` (`constants.ts:17-25`),
   implemented as a `TokenCounter` in `profiles.ts` over the provider's `messages/count_tokens` endpoint
   (accepts `tools`), offered only when an Anthropic credential exists, cached per tool per scan, with its
   own rate limit; hero numbers print the profile next to the figure ("275,567 tokens · o200k"). — P1
3. Drafted-fix wording: README `:42` "a proven fix" and `:55-57` "Closed-loop test-and-fix" → "A failing
   run files a tracked issue with a **drafted** fix; apply it, re-run, and compare"; the product page's
   fix paragraph (`:203-206`) the same; the word "loop" returns only once WP 4.2's recorded example is
   linked. — P0
4. Judge prerequisite: README `:199-203` "Every terminal run is graded automatically" → "… once a judge is
   configured (a signed-in Claude CLI or a provider judge in Settings › Grading)"; product page
   `:111-113` "no setup, no reference answer required" → "no reference answer required; needs a judge
   credential"; §6 adds one sentence on what the Report tab shows without a judge. — P0
5. Inspector claim: README `:117-120` "The inspector is now purely a place to read a skill" → "reading
   happens in the inspector; editing in the Studio — the Triggers editor and Files save remain in the
   inspector until RM-30 WP 7.3/7.4 land". — P1
6. Studio, SkillFlow and Illustrations billing: README §4 names the Studio "Studio (preview)"; §12 leaves
   the tour (the `/illustrations` route stays; one line in "Also in the box"); SkillFlow Trace is not
   described as reachable (its exposure is WP 2.6). — P1
7. Ports: README `:251-252` (`127.0.0.1:8080/api/mcp`) and `:519` (callback) state both ports — `8080`
   for `pnpm dev`, `8081` for Docker (`docker-compose.yml:24`) — in one "Ports" table in §Run it. — P1
8. Vocabulary: README `:114` "test scenarios" → "environments"; every "scenario" in README and the
   product page → "environment". — P2
9. **Owner decision needed:** the "Operators & end users" audience (README `:37-39`). Options: (a) drop
   it; (b) fold it into "Skill & MCP developers"; (c) keep it and define its one artefact (a shareable
   read-only fleet report) as a later WP. Then order the list MCP server owners → Presales, CSEs &
   field teams → Skill & MCP developers. — P1
10. README structure: tour reordered as Measure (§1–3) → Test (§5, §8) → Grade (§6) → Fix (issues) →
    Automate (§10 and "Drive it without a browser"); Skills, Compatibility, Security, Assistant (preview)
    and Illustrations get one line each in an "Also in the box" section; the first screen holds one
    sentence, the install command recorded by WP 0.3, and one screenshot of a ranked per-tool footprint
    with a real number. — P1
11. "First ten minutes" section written from a demo-seeded instance (WP 1.1) for the two audiences with
    a working path — server owner (add → connect → scan → footprint) and skill developer
    (upload → inspector → run with a judge) — with measured, not estimated, timings. — P2
12. Data & security sentences (README `:559-574`): "no authentication by design" → the WP 0.4 model;
    add "Model calls go to the provider you configured (or a local Ollama model); nothing else leaves the
    machine"; add "single-user, local; a team server is planned (RM-25)" here, in "Who it's for" and in
    Settings › About. — P1
13. Provider claims: README §5 lists only providers verified end to end; `google` (in `PROVIDER_KINDS`,
    `packages/shared/src/constants.ts:54-60`) appears only after one recorded Gemini run; a provider
    table answers Azure OpenAI, Bedrock and Vertex (tested through `openai_compatible`, or "not
    supported"). — P2
14. **Owner decision needed:** subscription terms. Confirm whether driving a consumer Claude subscription
    through the Agent SDK for automated suite runs, grading and missions is permitted for a product
    offered to outside developers under the current Anthropic consumer and Agent-SDK terms. Options: (a)
    permitted → `claude_subscription` stays documented; (b) not permitted for third-party products → API
    key becomes the documented path, the "Anthropic CLI" run model and judge move behind a flag, README
    `:571-574` is rewritten. — P0
15. Screenshots: confirm the 11 PNGs exist in the real repository; regenerate all 11 with
    `scripts/readme-screenshots.mjs` from the demo-seeded instance (WP 1.1) after WP 2.2 (dashboard
    counts) and WP 0.5 (fleet chip); none shows a tenant hostname, a person's name or a third-party
    organisation; the compare screenshot is cropped so the delta sentence leads; the dashboard hero
    screenshot is replaced by the per-tool ranking; README `:89-90` "still show the previous side-list
    layout" is removed. — P1
16. **Owner decision needed:** Qlik-identifiable material in public assets (server names, `qlik_*` tool
    identifiers). Options: (a) anonymised demo database only (WP 1.1 data); (b) employer sign-off
    obtained for named material. Record the choice before any screenshot or capture is published. — P0
17. Guide link: README links the user guide by repository path; once WP 1.4 serves `/docs`, link that
    route; until then the README states that the guide ships with the repository only. — P2

## Acceptance

- [ ] `grep -n "the way a model does\|proven fix\|purely a place to read\|no setup, no reference answer\|test scenarios" README.md planning/user-guide/DC-23-product-overview/product-page.md`
      → 0 hits.
- [ ] README §6 and "What sets it apart" state the judge prerequisite; the product page matches.
- [ ] A Ports table exists in §Run it; `8081` appears beside every Docker URL.
- [ ] `anthropic_count_tokens` is selectable in Settings › General with an Anthropic credential and
      absent without one; a scan with it stores the profile id; the hero number names its profile.
- [ ] "Who it's for" carries the decided audience list in the decided order; Settings › About and
      README state the single-user boundary.
- [ ] README §5 provider list equals the set with a recorded end-to-end run; the provider table exists.
- [ ] All 11 screenshot files exist, post-date the demo seed, and a manual check recorded in
      `STATUS.md` confirms no hostname, person or third-party name is visible.
- [ ] Owner decisions 9, 14 and 16 are recorded in `STATUS.md` with the chosen option.
- [ ] The README's first screen holds one sentence, one proven install command and one screenshot.
- [ ] Gate green: `pnpm typecheck && pnpm test && pnpm build && pnpm lint`.

## Effort

**M** — copy changes are a day; the count-tokens profile is two to three days; screenshots wait on
WP 1.1, WP 2.2 and WP 0.5.

## Sources

`MK-04, MK-05, MK-08, MK-10, MK-14, MK-15, MK-19, MK-21, MK-23, MK-24, PO-09, PO-10, PO-25, PO-27, PO-28, PO-29, PS-23, PS-25, PS-26, PS-27`
