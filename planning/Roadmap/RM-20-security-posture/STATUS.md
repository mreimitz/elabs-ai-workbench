---
type: "Status Ledger"
title: "Security posture \u2014 work-package status ledger \u00b7 PRIORITY: HIGH"
description: "Living state for the security-posture plan, read and updated by /next-wp security-posture."
tags: ["roadmap", "RM-20"]
timestamp: "2026-08-20T17:10:00Z"
status: "active"
---
# Security posture — work-package status ledger · **PRIORITY: HIGH**

Living state for the **security-posture** plan, read and updated by `/next-wp security-posture`.
A box is ticked **only** when the WP's Acceptance is met and the gate
(`pnpm typecheck && pnpm test && pnpm build && pnpm lint`) is green.

**Legend:** `[ ]` open · `[x]` done. Done lines: `… — done <YYYY-MM-DD> · wp/security-posture/<id>`.

> Plan + invariants in [`README.md`](./item.md). Pure read-model over persisted scans/skills —
> no schema migration expected; if one becomes necessary, claim the next free `user_version` via
> the cross-workstream decision-log convention.

## Phase 1 — Analyzer
- [x] WP 1.1 — contract: finding/report/score shapes, rule-id registry, `SECURITY_ANALYZER_VERSION`
      — done 2026-08-20 · `wp/security-posture/1.1` · spec: [`wp-1.1-contract.md`](./wp-1.1-contract.md).
      **Contract only — no analyzer, no rule logic, no route, no migration, no dependency.** Three
      files: a new `packages/shared/src/security-posture.ts` (657 lines), its test (555 lines), and
      **one** added export line in `packages/shared/src/index.ts`. It declares
      `SECURITY_ANALYZER_VERSION` (1), the severity / subject-kind / rule-category vocabularies, the
      **frozen eleven-rule server registry** (4 `error` · 4 `warning` · 3 `info` — WP 1.2 implements
      them), six shapes with `.strict()` zod schemas, and five pure functions:
      `computeSecurityScore`, `compareSecurityFindings`, `redactSecurityEvidence`,
      `capSecurityFindings`, `createSecurityFinding`. Its only import is `zod` — no `node:*`, no
      filesystem, no network. Decisions **D-SP1–D-SP6** in the log below.
      **Verified by the orchestrator, not taken on report:** the gate re-run on the branch
      (`typecheck` **0** · shared **127/127** [97 before] · cli **63/63** · api **3344 passed / 7
      failed** — the pre-existing compatibility-roster failures — · `build` **0** · `lint` **2**
      errors, both the pre-existing oversized `all-models.json`; web **3556 passed / 5 skipped**, run
      separately and byte-identical to the measured baseline); the three-file diff and the one-line
      `index.ts` change; and **three independent teeth checks** — disabling credential masking in
      `redactSecurityEvidence`, letting a caller smuggle a severity past `createSecurityFinding`, and
      dropping the comparator's residual tie-breakers each turned tests **red**, all restored
      afterwards (`git status` clean).
      **Two deviations, both reported rather than taken silently:** (1) the spec's `index.ts`
      placement instruction contradicted itself ("alphabetically" vs "between `run-filter` and
      `schemas`"); the agent took alphabetical, which is correct — `security-posture` sorts after
      `schemas`. (2) The credential regexes absorb an escaped-invisible as one credential character,
      without which the spec's own requirement (masking survives an invisible injected mid-credential)
      is unachievable, because escaping inserts a backslash that splits the run.
      **Orchestrator note (not a defect — carry into WP 1.2's fixtures):** the catch-all
      `[A-Za-z0-9_-]{32,}` credential pattern will mask a long snake_case MCP tool name that appears
      inside an evidence excerpt. Nothing leaks and the finding's *anchor* still names the tool
      unredacted, but WP 1.2's fixtures should expect it rather than be surprised by it.
      **Not verified:** D-SP4's "a finding never carries an absolute local path" is documented in the
      anchor's JSDoc, not enforced at runtime — that becomes WP 1.2's obligation when it constructs
      anchors. `SecurityRule.deprecated` is declared but unused, so untested. Nothing was run against
      the running app (this WP adds no route and no UI).
- [x] WP 1.2 — server analyzer: poisoning/annotation/schema/OAuth rules + score — done 2026-08-20 ·
      `wp/security-posture/1.2` · spec: [`wp-1.2-server-analyzer.md`](./wp-1.2-server-analyzer.md).
      **All eleven declared rules implemented, and only those eleven** —
      `apps/api/src/security/{analyzer,service,routes}.ts` plus one narrow method on
      `OAuthRepository` and a 6-line registration in `index.ts`. `analyzeScanTools({ scan,
      oauthScopes, onRuleError? })` is **pure** (a test reads the source and fails on
      `better-sqlite3` / `node:fs` / `fastify` / `new Date(` / `Date.now(`), so CI WP 3.1 can call it
      with a `ScanDetail` it already holds instead of round-tripping through HTTP;
      `analyzeScan(ports, scanId)` owns loading, the non-`success` refusal, ordering, capping,
      counting-all and scoring. Served at **`GET /api/scans/:scanId/security`** — one route, thin,
      404 unknown / 400 non-`success`. Decisions **D-SP7–D-SP11** in the log below. **Computed on
      read, persisted nowhere: no migration, no table, no column** (pinned by a test that compares
      `sqlite_master` and `PRAGMA user_version` before and after both a service call and a real HTTP
      request). No new dependency, no environment variable, no feature flag.
      **Three of the plan's own near-miss fixtures forced the MATCHERS to be tightened rather than
      the tests weakened** — which is what the README's false-positive clause is for. Rule 1 now
      requires an instruction-noun object after "ignore/disregard previous", so *"will ignore previous
      drafts"* is silent; rule 6 matches bare verb tokens only in the tool **name** and only
      unambiguous third-person forms in the description, so `list_deleted_items` +
      `readOnlyHint: true` is silent; rule 8 excludes measurement/reference suffixes and normalizes
      camelCase, so `token_count` and `access_key_id` are silent while `secret_access_key` still
      fires. Rules 1 and 2 emit **at most one finding per tool** (three payloads in one description is
      one hostile description; three `error` findings would move the score −45 for a single fact,
      which the README calls a defect).
      **Verified by the orchestrator, not taken on report:** the gate re-run on the branch
      (`typecheck` **0** · shared **127/127** · cli **81/81** · api **3389 passed / 7 failed** — the
      pre-existing compatibility-roster failures, byte-for-byte the measured list — a **+45-test**
      delta all passing · `build` **0** · `lint` **2** errors, both the pre-existing oversized
      `all-models.json`; web **3574 passed / 5 skipped**, run separately); the 7-file diff and all 14
      zero-line-diff paths, including **zero removed lines** in WP 1.1's contract; and **three
      independent teeth checks** — making `listGrantedScopes` also return the access token turned
      both D-SP9 tests red, dropping `compareSecurityFindings` from the service turned both
      determinism tests red, and accepting a non-`success` scan turned all three D-SP10/A10 tests
      red; all restored, `git status` clean.
      **Two corrections this WP surfaced in the plan's own documents, both now fixed:** the WP 1.1
      ledger line and the WP 1.2 spec both said the registry declares **three** `error` rules. It
      declares **four** — `annotation.readonly-contradiction` is the fourth. The real split is
      **4 `error` · 4 `warning` · 3 `info`**, counted from the registry by the orchestrator.
      **Nine deviations, all declared:** the three matcher tightenings above; `https`/`urls`/`uri`
      added to rule 7's terms (with token matching, `https://…` is the token `https`, so a list with
      only `http` would be blind to every real URL); rule 11's evidence is the whole granted scope
      list, space-joined, with the message naming the broad ones; an optional `onRuleError` callback
      because a pure analyzer has no logger and the spec still required a rule that throws to be
      logged once; rule 3's parameter findings bounded by the same per-tool cap as rule 9 (same
      drowning failure mode); and the two bound constants (`SECURITY_MAX_DESCRIPTION_CHARS` 2000,
      `SECURITY_MAX_FINDINGS_PER_TOOL` 10) placed in `packages/shared/src/security-posture.ts` rather
      than the analyzer — which the spec's Files section explicitly sanctions, since WP 1.1 had not
      declared them and WP 2.1's UI will need the threshold.
      **Not verified:** nothing was run against the running app (this WP has no UI; the route was
      exercised over a real in-process Fastify instance with the real repositories, not against
      `http://localhost:8081`). The heuristics were reviewed against fixtures, **not against a corpus
      of real third-party MCP servers** — every "deliberately does not match" claim is argued and
      fixture-pinned, but the false-positive rate in the wild is unmeasured. No live OAuth flow was
      run (the D-SP9 tests store scopes through the real repository, with real encryption and
      decryption, but no provider was contacted).
      **Pre-existing web-test flake seen once by the implementing agent, not by the orchestrator, and
      not this WP's** (`apps/web/**` is zero-diff): `apps/web/src/features/hub/ArtifactCanvas.tsx:211`
      schedules `setTimeout(() => setCopied(false), 1500)` which can fire after
      `ArtifactCanvas.test.tsx` tears its environment down, surfacing as an unhandled
      `ReferenceError: window is not defined`. Owner-facing test-hygiene item.
- [x] WP 1.3 — skill analyzer: security-surface roll-up + score — done 2026-08-20 ·
      `wp/security-posture/1.3` · spec: [`wp-1.3-skill-analyzer.md`](./wp-1.3-skill-analyzer.md).
      **Seven `skill-surface.*` rules, and only those seven** — three `error` (injection phrasing,
      hidden instruction block, invisible unicode), two `warning` (a credential-shaped value in the
      body, a broad `allowed-tools` grant), two `info` (ships executable scripts, references the
      network) — over an ALREADY-persisted skill version, scored and ordered by WP 1.1's contract
      exactly as the eleven server rules are. Served at
      **`GET /api/skills/:id/versions/:vid/security`**. `analyzeSkillFiles({ version, files, skillMd,
      onRuleError? })` is **pure** (source-scanned for `better-sqlite3` / `node:fs` / `fastify` /
      `new Date(` / `Date.now(`); a port-call-counting test proves `getFileContent` is called exactly
      once, for the SKILL.md); `analyzeSkillVersion(ports, skillId, versionId)` — which lives in the
      **existing** `security/service.ts`, because a WP 1.2 test pins `computeSecurityScore` to exactly
      one file — owns loading, the D-SP16 refusals, ordering, capping, counting-all and scoring.
      Decisions **D-SP12–D-SP16** in the log below. **Computed on read, persisted nowhere: no
      migration, no table, no column** (pinned by a `sqlite_master` + `PRAGMA user_version` comparison
      across a service call and a real HTTP request). No new dependency, no environment variable, no
      feature flag. Eleven files; `apps/api/src/skills/**` is a **zero-line diff** — the analyzer adds
      no repository method, no query and no route to the skills module.
      **Two rules were deliberately narrowed against the plan's false-positive clause.** The
      hidden-instruction rule does **not** fire on a bare HTML comment — the one intentional
      divergence from the server rule it mirrors — because a SKILL.md is authored Markdown where
      `<!-- prettier-ignore -->` and TOC markers are ordinary editorial furniture; it fires on a
      comment only when the comment *carries* a payload (an injection phrase or an address to the
      model), and it scans **every** comment so an innocent first one cannot shield a later payload.
      The credential rule reports only **prefixed** shapes (D-SP13), so a 40-character commit sha and
      a long slug in prose stay silent. The scripts rule emits **exactly one** finding for a version,
      never one per script: thirty scripts is one fact, and thirty `info` findings would cost 30
      points for it.
      **Verified by the orchestrator, not taken on report:** the gate re-run on the branch
      (`typecheck` **0** · shared **162/162** [152 before] · cli **87/87** · api **3519 passed / 7
      failed** — a **+45-test** delta, all passing · `build` **0** · `lint` **2** errors; web
      **332 files, 3574 passed / 5 skipped**, run separately and identical to the baseline). **Each of
      the 7 api failures and both lint errors was re-run against `main` itself and reproduces there**
      — they are pre-existing, not this WP's. The authoritative 11-file change list and every
      zero-line-diff path were re-checked with an explicit `git -C <worktree> diff main..HEAD`,
      including **byte-identical `apps/api/test/security-analyzer.test.ts`** (D-SP14's proof) and a
      zero-diff `roadmap/**`. **Four independent teeth checks**, each applied then reverted: adding
      the catch-all to the *reporting* credential list turned `findPrefixedCredential (D-SP13)` red;
      inserting the `skill` anchor at rank 1 instead of appending it turned the D-SP12 order-
      preservation test red; making the scripts rule emit one finding per script turned both the
      "thirty scripts is ONE finding" and the 98/`low` anti-inflation tests red; and pasting a copy of
      the injection phrase list into `skill-analyzer.ts` turned the D-SP14 single-definition test red.
      `git status` clean afterwards.
      **Four deviations, all declared.** (1) **`apps/api/src/assertions/service.ts` is +7, not
      zero-diff** — the spec required both the additive `skill` anchor and a zero-diff there, which is
      not simultaneously achievable: `describeAnchor` is an exhaustive switch and the compiler demands
      an arm. **The spec was wrong; the agent added the arm rather than a `default:`**, which would
      have silently swallowed the next union member. No gate behaviour changes — `no-new-security-
      findings` reads scan posture only. (2) The skills port on `registerSecurityRoutes` is
      **optional**, because WP 1.2's test constructs `{ scans, servers, oauth }` and had to stay
      byte-identical; `index.ts` always supplies it, and a test asserts exactly two security routes
      exist, both read-only verbs. (3) Four comments in `security-posture.ts` that WP 1.1 wrote about
      WP 1.3 ("`skill` has no rules yet") were updated — the spec said "zero removed lines", but
      leaving them would have made the contract lie about itself. (4) `text-scan.ts` exports more than
      the spec's three signatures (plural finders carrying the match *count* and the block *label*),
      because `analyzer.ts` needs them to keep its messages byte-identical.
      **Not verified:** nothing was run against the running app in a browser — this WP has no UI (that
      is WP 2.1). The implementing agent did run the built API on a throwaway port with a fresh
      migrated DB and uploaded a poisoned skill through the real path (59/`high`, the `sk-` key masked
      to `«redacted»`, the sha correctly not reported); the orchestrator verified the gate and the
      diff, not that live run. The heuristics were reviewed against fixtures, **not against a corpus
      of real third-party skills** — the false-positive rate in the wild is unmeasured, exactly as for
      WP 1.2's server rules. **One behaviour worth an owner glance, consistent rather than new:** a
      payload hidden inside an HTML comment fires **both** the injection rule and the hidden-
      instruction rule (−30), the same doubling the server rules already have for the same input.
      **A correction to the plan's own documents:** WP 1.2's spec and ledger line name
      `apps/api/test/compatibility-data.test.ts` as the home of the pre-existing failures. They
      actually live in `compatibility-runner.test.ts` (5), `compatibility-tool-findings.test.ts` (1)
      and `compatibility-session.test.ts` (1). The count (7) was right; the file was not.
- [x] WP 1.4 — posture diff (scan↔scan, version↔version) — done 2026-08-20 ·
      `wp/security-posture/1.4` · spec: [`wp-1.4-posture-diff.md`](./wp-1.4-posture-diff.md).
      **One differ, in the contract, re-projected by the CI gate.** `diffSecurityReports(baseline,
      subject)` in `packages/shared/src/security-posture.ts` is now the only definition of which
      findings are `added` / `resolved` / `unchanged`, and
      `no-new-security-findings` in `apps/api/src/assertions/service.ts` reads `.added` off it instead
      of building its own identity `Set` — **`apps/api/test/ci-assertions.test.ts` stayed
      byte-identical and green (56/56)**, which is the proof the re-point moved no gate behaviour.
      Served at **`GET /api/scans/:scanId/security/diff?baseline=`** and
      **`GET /api/skills/:id/versions/:vid/security/diff?baseline=`** — each a sub-path of the report
      it diffs, so no discriminator parameter is needed. Both sides analysed through the SAME
      `analyzeScan` / `analyzeSkillVersion` the report routes serve (D-MCP4), so a diff and a report
      can never disagree about one subject's posture. Decisions **D-SP17–D-SP20** in the log below.
      **Computed on read, persisted nowhere** (pinned by a `sqlite_master` + `PRAGMA user_version`
      comparison across a service call and a real HTTP request). No migration, no dependency, no
      environment variable, no feature flag, and **`apps/api/src/index.ts` is a zero-line diff** — the
      diff needed no port the report routes did not already receive.
      **Verified by the orchestrator, not taken on report:** the gate re-run on the branch
      (`typecheck` **0** · shared **179/179** [162 before] · cli **87/87** · api **3537 passed / 7
      failed** — a **+18-test** delta, all passing · `build` **0** · `lint` **2** errors; web
      **332 files, 3574 passed / 5 skipped**, run separately and identical to the baseline). The 7 api
      failures are byte-for-byte the pre-existing compatibility list and the 2 lint errors the two
      oversized `all-models.json` files — both re-run against `main` itself in the WP 1.3 round and
      confirmed to reproduce there. Every zero-line-diff path re-checked with an explicit
      `git -C <worktree> diff main..HEAD`, including `ci-assertions.test.ts`, `index.ts`, all three
      analyzer files, `packages/shared/src/{index,ci-assertions,schemas}.ts` and `roadmap/**`. The one
      edit to an existing declaration in WP 1.1's contract — extracting `securityFindingCountsSchema`
      out of `securityReportSchema`'s inline `counts` literal — was checked against `main` and is
      **behaviour-identical** (the original literal was `.strict()` too).
      **Four independent teeth checks**, each applied then reverted: dropping the analyzer-version
      refusal from the shared differ turned the four-refusals test red; dating the diff from the
      baseline instead of the later instant turned the dating test red; **emptying the gate's `added`
      bucket turned SIX `ci-assertions` tests red**, which is the direct proof the CI gate genuinely
      flows through the shared differ; and removing the service's cross-owner refusal turned both the
      400-naming test and the "400s, not 500s" test red. `git status` clean afterwards.
      **A process failure of the orchestrator's, not the implementer's — recorded because it changes
      how this ledger should be read.** The WP spec was authored at kickoff but left **untracked in
      the primary working tree**, so it was absent from the implementer's worktree (created from a
      commit) and **the implementer never saw it**. It said so plainly rather than inventing one, and
      derived the design from the README, the D-SP1–D-SP16 log, WP 1.1–1.3 as the house pattern, and
      its brief. The orchestrator then compared the shipped design against the unseen draft, judged it
      acceptable — **better in two places**: `counts` per bucket is a full severity tally rather than a
      bare number, and the route shape reuses the report's own path instead of inventing a
      `?subject=` discriminator — and **rewrote the spec to describe what shipped**, with a provenance
      note at its top and the draft's unbuilt ideas recorded as follow-ups. The lesson: **commit a WP
      spec before dispatching.**
      **Three deviations, all declared:** (1) `apps/api/test/security-skill-analyzer.test.ts` is
      +11/−5 because its route-surface assertion is deliberately **exhaustive** ("exactly TWO security
      routes"); it was updated to list all four rather than weakened — the assertion working as
      designed. (2) The `securityFindingCountsSchema` extraction above (−6 lines in the contract), so
      the diff's three tallies and the report's one tally share a definition. (3) The gate's `carried`
      still reads `subjectReport.counts.total - added.length` rather than `diff.unchanged.length`;
      they are provably equal because the truncation guard above it makes `counts.total ===
      findings.length`, and keeping the expression keeps the re-point's behavioural surface minimal.
      **Three follow-ups deliberately not built** (none a defect; all additive, all in the spec's
      closing section): an `evidenceChanged` flag so WP 2.1 can show that a vendor reworded a
      description under an otherwise-unchanged finding; duplicate-identity pairing (the differ uses
      `Set`s, so if one side ever carried two findings sharing `(ruleId, anchor)` the extra would not
      appear as resolved — no rule emits duplicate identities today); and collapsing D-SP18's
      belt-and-braces refusals to one message table (the *conditions* have one definition, the
      *wording* exists twice, and both copies are tested).
      **Not verified:** nothing was run against the running app or a browser — this WP adds no UI
      (that is WP 2.1). The routes were exercised over a real in-process Fastify instance with the
      real repositories and a real migrated SQLite database, not against `http://localhost:8081`. The
      two endpoints have never been called against real third-party scan or skill data.

## Phase 2 — Surfacing
- [ ] WP 2.1 — UI: Security tabs, list badges, diff view (both themes) — depends: 1.4 —
      **status: in progress** (`wp/security-posture/2.1`, runs SOLO — it owns `apps/api/src/index.ts`
      this round) · spec: [`wp-2.1-security-ui.md`](./wp-2.1-security-ui.md)
- [ ] WP 2.2 — report export integration — depends: 1.4 — status: open (queued behind WP 2.1:
      both need `apps/api/src/index.ts`) · spec: [`wp-2.2-report-export.md`](./wp-2.2-report-export.md)

## Decision log
_Entries: date · decision · rationale._

- **2026-08-20 · D-SP1–D-SP6 locked at the WP 1.1 kickoff.** Full text + the design they bind:
  [`wp-1.1-contract.md`](./wp-1.1-contract.md). Declared in
  `packages/shared/src/security-posture.ts` and pinned by `packages/shared/src/security-posture.test.ts`.
  - **D-SP1 — the analyzer is a pure, versioned read-model declared in `packages/shared`, and the
    contract lands before the first rule.** One module holds the shapes, the rule registry, the score
    and the emit order. WP 1.2's server analyzer, WP 1.3's skill analyzer, WP 1.4's posture diff,
    WP 2.x's UI and `roadmap/ci/` WP 3.1's `no-new-security-findings` assertion all **import** from
    it; none re-derives a shape, a weight or a sort order. Its only import is `zod` — no `node:*`, no
    filesystem, no network, no DB — which is what lets the API, the web bundle and the CLI-facing
    report share one copy. Precedent: `ci-assertions.ts` and `skill-security.ts`. No migration, no
    runtime dependency, no feature flag, no environment variable.
  - **D-SP2 — a rule id is `category.kebab-slug`, and it is frozen the moment it ships.** A rule is
    never renamed and never re-pointed at a different check; one that stops making sense is marked
    `deprecated` and keeps its id. CI WP 3.1 compares finding sets **by `ruleId`** across two
    releases, so a rename reads as one finding resolved plus one new finding appearing — exactly the
    false alarm that teaches an operator to ignore the gate. Eleven server rule ids are frozen here;
    no skill rule id is declared, but `SECURITY_SUBJECT_KINDS` already carries `"skill"` so WP 1.3
    adds rules without reshaping anything. Pinned by a test that writes the ids **and** their
    severities out a second time by hand, so a rename or a severity drift is a red test.
  - **D-SP3 — the score is a documented, severity-weighted deduction from 100, computed in exactly
    one place, and versioned by `SECURITY_ANALYZER_VERSION`.** Deductions: `error` −15, `warning` −5,
    `info` −1, floored at 0. Bands: `clean` = 100, `low` 90–99, `medium` 70–89, `high` < 70.
    `computeSecurityScore` is the only function permitted to apply the weights or the thresholds —
    the band function is deliberately **not** exported — and the returned score echoes the analyzer
    version so a stored score is never re-banded by a later build. Two reports produced under
    different analyzer versions are never silently compared, the same discipline `counting_version`
    already gives token counts.
  - **D-SP4 — evidence is redacted and capped by construction, not by convention.** Every excerpt
    passes through `redactSecurityEvidence`, in this order: (a) invisible characters — C0, DEL,
    U+200B–200F, U+202A–202E, U+2060–2064, U+FEFF — are rewritten to a visible `\uXXXX`, because a
    poisoning rule's whole job is to surface characters you cannot see and printing them raw would
    hide the finding; (b) credential-shaped runs (`mcpfp_…`, `sk-…`, `gh[pousr]_…`, and bare
    base64url runs of 32+) are masked to `«redacted»` — masking runs **after** escaping, and the
    matchers absorb an escaped-invisible as one credential character, so an invisible injected
    mid-credential cannot split the run past the matcher; (c) the result is truncated at
    `SECURITY_EVIDENCE_MAX_CHARS` (200) with an explicit `…` and `truncated: true`.
    `createSecurityFinding` takes evidence as `{ raw }`, never as a finished excerpt, so the redactor
    cannot be bypassed. A finding never carries an absolute local path.
  - **D-SP5 — a finding's severity IS its rule's declared severity. Always.** A rule that needs two
    severities is two rules. Per-instance escalation would make a gate's counts move for reasons an
    operator cannot see in the rule list, and `no-new-security-findings` would have to reason about
    severity drift on top of set membership. Enforced at construction: `createSecurityFinding` has
    **no** `severity` parameter and reads it from `SECURITY_RULES`. Pinned across all eleven rules,
    including a case that smuggles a severity in through a cast.
  - **D-SP6 — a report is byte-stable for the same input.** Findings are emitted in one total order
    via the exported `compareSecurityFindings`: severity descending, then `ruleId`, then anchor kind,
    then anchor name, then the evidence excerpt — followed by residual tie-breakers (evidence
    presence, offset, truncated flag, message) so **no pair compares 0 unless every component is
    equal**. `Array.prototype.sort` is only stable within one engine, and the posture diff (WP 1.4)
    plus the CI gate are both meaningless without byte-stability, so the order belongs to the
    contract, not to the analyzer. String comparison is UTF-16 code-unit, never `localeCompare`.
    `SecurityReport.counts` always describes **all** findings even when `capSecurityFindings`
    (limit 200) shortened the list, so a gate reading `counts.error` cannot be fooled by display
    truncation.

- **2026-08-20 · D-SP7–D-SP11 locked at the WP 1.2 kickoff.** Full text + the design they bind:
  [`wp-1.2-server-analyzer.md`](./wp-1.2-server-analyzer.md). Implemented in
  `apps/api/src/security/{analyzer,service,routes}.ts` and pinned by
  `apps/api/test/security-analyzer.test.ts`.
  - **D-SP7 — the analyzer is a PURE function over an already-loaded `ScanDetail`, and a thin service
    loads it.** `analyzeScanTools({ scan, oauthScopes, onRuleError? }): SecurityFinding[]` opens no
    database, reads no config, has no clock and touches no network; a test reads the module source
    and fails on `better-sqlite3`, `node:fs`, `fastify`, `new Date(` or `Date.now(`.
    `analyzeScan(ports, scanId)` owns the loading, the refusal, the ordering, the capping and the
    scoring. This is what lets `roadmap/ci/` WP 3.1 call the analyzer from the assertions engine with
    the `ScanDetail` it already holds instead of round-tripping through HTTP. Ports are structurally
    typed, exactly like `AssertionPorts`, so a test hands it three functions instead of a database.
  - **D-SP8 — a posture report is computed on read and persisted nowhere.** It is a pure derivation
    of rows that are already immutable (`mcp_scans` + `mcp_tool_scans` never change once a scan
    settles), so a cache would be a second source of truth with a staleness bug waiting in it and a
    table would be a migration for data we recompute in milliseconds. WP 1.4's diff recomputes both
    sides. **No migration, no new table, no new column** — pinned by a test that compares
    `sqlite_master` and `PRAGMA user_version` before and after both a service call and a real HTTP
    request.
  - **D-SP9 — the OAuth rule reads a NARROW, scope-only projection, and that is the only thing it may
    see.** ⚠️ **Owner-reviewable: this is the one place this workstream touches a decryption path.**
    Granted scopes live inside the encrypted `mcp_oauth_credentials.tokens_json`, so `OAuthRepository`
    — which already decrypts routinely, inside `apps/api`, behind the runtime boundary — gained
    exactly **one** method: `listGrantedScopes(serverId): string[] | null`. It reads `tokens.scope`
    (falling back to the registered client's `scope`), splits on whitespace and returns strings: no
    access token, no refresh token, no client secret, no expiry, no id. Nothing else in
    `apps/api/src/oauth/` changed (`service.ts` / `provider.ts` / `routes.ts` all zero-line diffs).
    Two tests pin it — one that the method returns exactly the scope names, and one that a stored
    access token appears **nowhere** in `JSON.stringify(report)`; the fixture token is deliberately
    under 32 characters so the WP 1.1 redactor's credential catch-all cannot mask a leak and make the
    test pass for the wrong reason. A `null` produces **no finding** — "we could not tell" is not a
    finding, and the rule never guesses. The orchestrator confirmed the guard bites by making the
    method also return the access token: both tests went red.
  - **D-SP10 — a report is refused for a scan that is not `success`.** A `running` or `failed` scan
    has a partial or empty tool list; scoring it would hand a broken server a clean bill of health,
    which is precisely the silent-wrong-answer this workstream exists to prevent. **400**, naming the
    status. Same posture as CI WP 1.3's refusal to assert against a non-`success` scan.
  - **D-SP11 — every heuristic's matcher is a named, exported constant with its own fixture pair.**
    Each of the eleven rules ships a **positive** fixture and a **near-miss negative** fixture, and
    each matcher constant carries a comment saying what it deliberately does **not** match — that
    comment is the false-positive review, written down. Three of the plan's own near-misses forced
    the matchers to be tightened rather than the tests weakened (see the WP line above).

  _Rationale:_ D-SP7/D-SP8 are what make the analyzer callable from two places without a cache or a
  second source of truth; D-SP9 keeps the one credential read as small as it can possibly be; D-SP10
  keeps the report from ever being confidently wrong; D-SP11 turns the README's "false-positive
  review is part of every rule's acceptance" from an intention into a mechanical, red-or-green
  obligation.

  _Rationale (D-SP1–D-SP6):_ the whole workstream's value is that a posture report can be **diffed** — release to
  release, and by a CI gate that must not cry wolf. Every one of these six exists to make two reports
  comparable: a frozen id, one score, one order, one redactor, one severity per rule, and a version
  stamp for the day any of that has to change.

- **2026-08-20 · D-SP12–D-SP16 locked at the WP 1.3 kickoff.** Full text + the design they bind:
  [`wp-1.3-skill-analyzer.md`](./wp-1.3-skill-analyzer.md). Implemented in
  `apps/api/src/security/{text-scan,skill-analyzer,service,routes}.ts` and pinned by
  `apps/api/test/security-skill-analyzer.test.ts` + `packages/shared/src/security-posture.test.ts`.
  - **D-SP12 — a skill-level finding gets its OWN anchor kind; it does not borrow the server's.**
    `SecurityFindingAnchor` gained one additive member, `{ kind: "skill" }`, for a finding about the
    version as a whole (it ships scripts; its frontmatter grants broad tool access) rather than about
    one file in it. Reusing `{ kind: "server" }` would print the word *server* on a skill finding in
    every UI, every export and every CI comment. The new kind ranks **last** (`skill: 4`) rather than
    beside `server`, which it resembles: appending a rank leaves every existing pair's relative order
    byte-identical, whereas inserting one at rank 1 would renumber `tool`/`parameter`/`file` and
    silently reorder every report that already exists. `SECURITY_ANALYZER_VERSION` stays **1**.
  - **D-SP13 — detection is precise, redaction is generous, over ONE definition.**
    `redactSecurityEvidence`'s credential list ends in a catch-all (`[A-Za-z0-9_-]{32,}`) whose
    over-masking is the correct error direction — an over-masked identifier costs one question, a
    leaked token costs a rotation. That same catch-all is the **wrong** matcher for *reporting* a
    credential, because a SKILL.md routinely carries a commit sha or a long slug. So
    `SECURITY_CREDENTIAL_PREFIX_PATTERNS` (the prefixed shapes) is exported and used by
    `findPrefixedCredential`, `CREDENTIAL_PATTERNS` is rebuilt **from** it plus the unchanged
    catch-all, and neither list is re-typed. The redactor's output is unchanged for every input.
  - **D-SP14 — a text heuristic has exactly ONE definition, and both analyzers call it.** The
    injection phrase list, the hidden-instruction patterns and the invisible-codepoint ranges are the
    same question asked of a tool description and of a SKILL.md body; a second copy is how the two
    drift until `poisoning.injection-phrasing` and `skill-surface.injection-phrasing` mean different
    things while claiming to mean the same one. They live in `apps/api/src/security/text-scan.ts`,
    `analyzer.ts` re-exports every constant it exported before, and its three rules became thin
    callers. **`apps/api/test/security-analyzer.test.ts` is byte-identical and green — that is the
    proof the extraction preserved behaviour**, and a fingerprint test fails if any definition
    acquires a second home. (Its reach is honest but bounded: it catches a *copied* list, not a
    paraphrased re-implementation.)
  - **D-SP15 — the skill analyzer reads the version row, the file LIST and the SKILL.md body, and
    nothing else.** A version may hold 2,000 files and 50 MB, so a full-tree content scan would need
    its own byte budget, its own truncation flag on `SecurityReport` and its own answer for "the scan
    stopped early" — a shape change for a rule this WP does not have. SKILL.md is the text an agent
    loads *every* time the skill is attached, which makes it the highest-value surface per byte read.
    A credential committed into a helper script is therefore **not** found today; widening the reach
    later is a **new rule id** (additive, D-SP2), never a change of meaning for one of these seven.
  - **D-SP16 — a version whose SKILL.md cannot be read as text is a 400, not a clean report.** Five
    of the seven rules read that body; scoring a version without it would hand it a near-clean bill of
    health on the strength of the two rules that happened to still run. Refused with **400** naming
    the case (`missing` or `binary`), the same posture D-SP10 takes for a non-`success` scan. A
    version that simply has no findings is a different thing and still scores 100/`clean`. A version
    id belonging to a *different* skill is a **404**, so a version can never be reported under another
    skill's name.

  _Rationale:_ D-SP12/D-SP14 keep the skill report and the server report one system rather than two
  that resemble each other — the same anchor union, the same order, the same heuristic definitions —
  which is the only reason WP 1.4's diff and WP 2.1's UI can treat them identically. D-SP13 and
  D-SP16 are both about not being confidently wrong: one refuses to cry wolf, the other refuses to
  issue a clean bill of health it cannot stand behind. D-SP15 draws the read boundary explicitly so
  the gap is a documented bound rather than an unnoticed blind spot.

- **2026-08-20 · D-SP17–D-SP20, locked from the shipped WP 1.4 implementation.** Full text + the
  design they bind: [`wp-1.4-posture-diff.md`](./wp-1.4-posture-diff.md) (whose provenance note
  explains that it documents what shipped rather than what was specified in advance — see the WP line
  above). Implemented in `packages/shared/src/security-posture.ts` +
  `apps/api/src/security/{service,routes}.ts` and pinned by
  `apps/api/test/security-posture-diff.test.ts` + `packages/shared/src/security-posture.test.ts`.
  - **D-SP17 — there is exactly ONE differ, it lives in the contract, and the CI gate re-projects
    it.** `diffSecurityReports(baseline, subject)` does the set arithmetic once, in
    `packages/shared`, where the web bundle, the API and the assertions engine can all reach it.
    `no-new-security-findings` reads `.added` off it rather than re-deriving membership — the
    assertions engine's own header already said that rule "analyses NOTHING… re-project, don't
    reimplement" (D-MCP4/D-SP7), and this makes it literally true. Two implementations of "which
    findings are new" is how a diff view and a CI gate end up disagreeing in front of an operator
    with no way to tell which one is lying. **`apps/api/test/ci-assertions.test.ts` stayed
    byte-identical and green**, and emptying the gate's `added` bucket turns six of its tests red —
    the gate demonstrably runs through the shared differ.
  - **D-SP18 — the differ refuses an incomparable pair ITSELF, and the service refuses again with an
    HTTP message.** Deliberate belt-and-braces rather than an oversight: the shared throw means a
    future caller — WP 2.1, an export, another gate — cannot skip the check by forgetting to call a
    predicate, while the service's `httpError(400, …)` is the one an operator actually reads. A test
    pins the difference by asserting the HTTP caller sees **400 and not 500**, which is exactly what
    regresses if the service guard is removed and only the shared one remains. The cost is two sets of
    wording for one set of conditions, recorded as a follow-up.
  - **D-SP19 — four refusals, each a 400 naming itself.** (a) subject-kind mismatch — a server report
    against a skill report shares no anchor vocabulary; (b) **different owner** — "added" and
    "resolved" are only meaningful about ONE subject over time, and the cross-server question is
    `GET /api/compare`'s and always was; (c) analyzer-version mismatch — findings from different
    analyzer versions are not on the same scale (the existing D-C22 guard, now shared); (d) either
    side truncated — a shortened list would answer "what changed among the ones we listed", which is
    not a verdict, and would report findings as *resolved* purely because they fell off the other
    side's list. Precedent throughout: D-C8's `deltasComparable === false` is a 400, never a
    suppressed-to-zero pass.
  - **D-SP20 — the diff is dated from its two reports, never from a clock.**
    `packages/shared/src/security-posture.ts` has no clock and must not grow one, so `generatedAt` is
    the **later** of the two reports' own instants — the diff is as fresh as its freshest side. That
    is also what makes the determinism test meaningful: a fixed pair of reports diffs to a
    byte-identical answer every time. `score.delta` is `subject − baseline`, so **positive is an
    improvement**; the JSDoc says so, because half of readers will assume the opposite.

  _Rationale:_ D-SP17 is the whole point of the WP — the diff exists so a gate and a human can be
  told the same story, and that only holds if there is one differ. D-SP18/D-SP19 are the same
  discipline D-SP10 and D-SP16 already applied to the reports themselves: refuse rather than answer
  confidently wrong. D-SP20 keeps the contract pure and the answer reproducible, which is what every
  downstream consumer — the UI, the export, the gate — is quietly relying on.

## Owner acceptance (owner-only)
- [ ] **WP 1.4 — the diff on YOUR own history, and the four refusals.** Pick a server you have
      scanned more than once and call
      `GET /api/scans/:scanId/security/diff?baseline=<an older scan of the same server>`; do the same
      for two versions of one skill. The question is whether `added` / `resolved` / `unchanged` match
      what you believe actually changed, and whether the four refusals (different server, server-vs-
      skill, analyzer-version mismatch, a truncated report) read as helpful rather than obstructive —
      accepted: ____
- [ ] **WP 1.3 — the false-positive rate on YOUR real skills, and the two narrowings.** Call
      `GET /api/skills/:id/versions/:vid/security` for the skills you have actually registered. Two
      judgement calls are yours to confirm: a **bare HTML comment in a SKILL.md does not fire**
      (only one carrying a payload does), and the credential rule reports **prefixed shapes only**, so
      a committed key in an unusual format is missed rather than a sha being reported. Also note that
      a payload hidden inside an HTML comment fires **two** rules at once (−30) — consistent with the
      server rules, but worth seeing once — accepted: ____
- [ ] **D-SP15 — the read boundary, for your explicit sign-off.** The skill analyzer reads only the
      version row, the file list and SKILL.md. A credential or an instruction payload committed into a
      helper script or an L3 resource file is **not** scanned today. Say whether that bound is where
      you want it, or whether widening it should be the next skill rule — accepted: ____
- [ ] **WPs 1.1–1.2 — the false-positive rate on YOUR real servers.** Call
      `GET /api/scans/:scanId/security` for every server you have actually registered and read the
      findings. The heuristics were reviewed against fixtures, **never against a corpus of real
      third-party MCP servers** — so the question is not "did it find the poisoned one" but "how many
      of these findings would I roll my eyes at?" Anything that fires on an honest server is a
      matcher to tighten (WP 1.2's near-miss fixtures are where the tightening goes), not a severity
      to lower — accepted: ____
- [ ] **D-SP9 — the one decryption-path touch, for your explicit sign-off.**
      `OAuthRepository.listGrantedScopes` reads the encrypted OAuth blob and returns granted scope
      **names** so `oauth.broad-scope` can judge them. 28 insertion-only lines, `string[] | null`, no
      access token / refresh token / client secret / expiry / id, with a test asserting a stored
      access token appears nowhere in a serialized report. Read the method and say whether publishing
      scope names in a posture report is a line you want crossed — accepted: ____
- [ ] A deliberately poisoned fixture server (injection phrasing + secret-shaped param +
      contradictory annotation) shows the expected findings with readable evidence in both
      themes; a clean server scores clean; the diff shows a finding appearing and resolving —
      accepted: ____
