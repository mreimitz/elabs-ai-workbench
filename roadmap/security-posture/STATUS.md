# Security posture — work-package status ledger · **PRIORITY: HIGH**

Living state for the **security-posture** plan, read and updated by `/next-wp security-posture`.
A box is ticked **only** when the WP's Acceptance is met and the gate
(`pnpm typecheck && pnpm test && pnpm build && pnpm lint`) is green.

**Legend:** `[ ]` open · `[x]` done. Done lines: `… — done <YYYY-MM-DD> · wp/security-posture/<id>`.

> Plan + invariants in [`README.md`](./README.md). Pure read-model over persisted scans/skills —
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
- [ ] WP 1.3 — skill analyzer: security-surface roll-up + score
- [ ] WP 1.4 — posture diff (scan↔scan, version↔version)

## Phase 2 — Surfacing
- [ ] WP 2.1 — UI: Security tabs, list badges, diff view (both themes)
- [ ] WP 2.2 — report export integration

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

## Owner acceptance (owner-only)
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
