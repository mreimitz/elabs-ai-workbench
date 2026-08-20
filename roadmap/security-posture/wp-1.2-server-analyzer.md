# WP 1.2 — server analyzer: poisoning / annotation / schema / OAuth rules + score

Phase 1 of [`README.md`](./README.md). Ledger: [`STATUS.md`](./STATUS.md). Shared rules: the
[testing conventions](../testing/conventions.md) + the repo rules in `.claude/rules/`.

**Depends on:** WP 1.1 (the contract — the eleven rule ids, the shapes, the score, the ordering, the
redactor).
**Consumed by:** WP 1.4 (posture diff), WP 2.1/2.2 (UI + report export), and — the reason this WP is
being built now — **`roadmap/ci/` WP 3.1**, the `no-new-security-findings` assertion, which calls the
analyzer function this WP exports.

---

## Locked decisions this WP implements

- **D-SP1** — the contract lives in `packages/shared/src/security-posture.ts`; this WP imports it and
  adds no second shape, no second score, no second ordering.
- **D-SP2** — rule ids are frozen. Implement **exactly** the eleven declared ids; invent none, rename
  none.
- **D-SP3** — the score is `computeSecurityScore` and nothing else. Do not re-weight, do not
  re-band, do not compute a score anywhere in `apps/api`.
- **D-SP4** — every piece of evidence goes through `redactSecurityEvidence`. A rule never builds a
  `SecurityEvidence` literal.
- **D-SP5** — severity comes from the registry via `createSecurityFinding`. A rule never chooses one.
- **D-SP6** — the report's findings are sorted with `compareSecurityFindings`, so the same scan always
  produces a byte-identical report.
- **README invariants** — read-only over persisted data (no MCP connection, no execution, no
  network); heuristics conservative and documented, each finding saying *why* and citing what it
  matched; **severity inflation is a defect**; false-positive review is part of every rule's
  acceptance fixtures; **no new runtime dependency**.
- **`.claude/rules/mcp-and-security.md`** — nothing leaving the API carries a secret value.

### Decisions to lock in this WP (record them in the ledger's decision log)

- **D-SP7 — the analyzer is a PURE function over an already-loaded `ScanDetail`, and a thin service
  loads it.** `analyzeScanTools(scan, oauth)` takes data and returns findings; it opens no database,
  reads no config and has no clock. The service (`analyzeScan(ports, scanId)`) does the loading, the
  refusal of an unusable scan, the ordering, the capping and the scoring. This is what lets CI WP 3.1
  call the analyzer from the assertions engine with the scan it already holds, instead of round-
  tripping through HTTP.
- **D-SP8 — a posture report is computed on read and persisted nowhere.** It is a pure derivation of
  a row that is already immutable (`mcp_scans` + `mcp_tool_scans` never change after a scan settles),
  so a cache would be a second source of truth with a staleness bug waiting in it, and a table would
  be a migration for data we can recompute in milliseconds. WP 1.4's diff recomputes both sides.
  **No migration, no new table, no new column.**
- **D-SP9 — the OAuth rule reads a NARROW, scope-only projection, and that is the only thing it may
  see** *(owner-reviewable: it is the one place this WP touches a decryption path)*. Granted scopes
  live inside the encrypted `mcp_oauth_credentials.tokens_json`, so answering "is this server's OAuth
  grant unusually broad?" needs the existing `OAuthRepository` — which already decrypts routinely,
  inside `apps/api`, behind the runtime boundary. This WP adds **one** method,
  `listGrantedScopes(serverId): string[] | null`, which returns scope **names** and nothing else: no
  access token, no refresh token, no client secret, no expiry, no id. Scope names are the
  "stored (non-secret) auth metadata" the plan's README already sanctions publishing. A test asserts
  a stored access token cannot reach a finding. If no scope was stored, the rule reports **nothing** —
  it never guesses, and "we could not tell" is not a finding.
- **D-SP10 — a report is refused for a scan that is not `success`.** A `running` or `failed` scan has
  a partial or empty tool list; scoring it would hand a broken server a clean bill of health, which is
  precisely the silent-wrong-answer this workstream exists to prevent. **400**, naming the status.
  (Same posture as CI WP 1.3's refusal to assert against a non-`success` scan.)
- **D-SP11 — every heuristic's matcher is a named, exported constant with its own fixture pair.**
  Each rule ships a **positive** fixture (fires) and a **near-miss negative** fixture (must not fire).
  The README makes false-positive review part of acceptance; this makes it mechanical. A rule with
  only a positive fixture is incomplete.

---

## What we're building

1. **`apps/api/src/security/analyzer.ts`** — the eleven pure rules over a `ScanDetail`, each an
   exported function returning `SecurityFinding[]`, plus the exported matcher constants (D-SP11).
2. **`apps/api/src/security/service.ts`** — `analyzeScan(ports, scanId): SecurityReport`: load,
   refuse a non-`success` scan (D-SP10), run the rules, sort (`compareSecurityFindings`), cap
   (`capSecurityFindings`), count **all** findings, score (`computeSecurityScore`), stamp
   `analyzerVersion` + `generatedAt`.
3. **`apps/api/src/security/routes.ts`** — `GET /api/scans/:scanId/security` → `SecurityReport`.
   Thin: parse the param, delegate, let the central error handler format. 404 unknown scan (the
   repository throws it), 400 non-`success`.
4. **`OAuthRepository.listGrantedScopes`** — the narrow projection of D-SP9.
5. **Wiring** in `apps/api/src/index.ts` — register the route with the existing `scans`, `servers`
   and `oauth` instances. Construct nothing new.
6. **Fixture-driven tests** — `apps/api/test/security-analyzer.test.ts`.

### The eleven rules — implement exactly these heuristics

All text matching is case-insensitive unless stated. Every rule scans a `ToolScan`'s `toolName`,
`description`, and (for the schema rules) `inputSchema`; **never** `rawTool`, which may hold anything.
Iterate tools in the order the scan returns them; the final sort makes order irrelevant anyway.

| # | Rule id | What fires it |
| --- | --- | --- |
| 1 | `poisoning.injection-phrasing` | The description contains one of an exported, documented phrase list: `ignore previous`, `ignore all previous`, `disregard previous`, `disregard the above`, `do not tell the user`, `don't tell the user`, `without telling the user`, `do not mention this`, `before using any other tool`, `before doing anything else`, `you must first read`, `override your instructions`, `override the system`. **Anchor:** tool. **Evidence:** the match ±40 characters. Deliberately short and literal — a broad regex over "ignore" would fire on half the honest servers in the world. |
| 2 | `poisoning.hidden-instructions` | An HTML comment (`<!-- … -->`), an uppercase pseudo-tag (`</?(IMPORTANT\|SYSTEM\|INSTRUCTION\|INSTRUCTIONS\|SECRET\|ADMIN)\b[^>]*>`), or an address to the model (`note to (the )?(assistant\|model\|ai)`, `ai instructions?:`). **Anchor:** tool. **Evidence:** the block, redacted + capped. |
| 3 | `poisoning.invisible-unicode` | Any codepoint in U+200B–U+200F, U+202A–U+202E, U+2060–U+2064, U+FEFF, U+E0000–U+E007F, or the private-use block U+E000–U+F8FF, in the tool name, the description, or any parameter name/description. **Anchor:** tool (or parameter, when the hit is in a parameter). **Evidence:** the surrounding text — `redactSecurityEvidence` escapes the invisible characters visibly, which is the whole point of the rule. |
| 4 | `poisoning.oversized-description` | `description.length > SECURITY_MAX_DESCRIPTION_CHARS` — declare it here as **2000** with a comment on why (long enough that no honest tool description reaches it; short enough that an embedded second instruction set does). **Anchor:** tool. **Evidence:** the first 200 characters; the message states the actual length. |
| 5 | `annotation.destructive-unmarked` | The tool name or description matches a destructive verb (`delete`, `remove`, `drop`, `destroy`, `purge`, `truncate`, `revoke`, `terminate`, `wipe`, `erase`) **and** the tool either has no `annotations` object at all or has `destructiveHint === false`. Do **not** fire merely because `destructiveHint` is absent-but-annotations-present in a way MCP's own default already covers — say in a comment which reading you implemented and why. **Anchor:** tool. |
| 6 | `annotation.readonly-contradiction` | `annotations.readOnlyHint === true` **and** the name or description matches a mutating verb (`delete`, `remove`, `write`, `create`, `update`, `insert`, `drop`, `send`, `post`, `set_`, `put_`, `patch`). **Anchor:** tool. This is the one annotation rule that is an `error`: the server is asserting something contradicted by its own surface. |
| 7 | `annotation.open-world-unmarked` | The name or description matches a network/external verb (`fetch`, `http`, `url`, `web`, `search`, `browse`, `download`, `upload`, `remote`, `external api`) **and** `annotations?.openWorldHint !== true`. **Anchor:** tool. `info` — plenty of honest servers omit the hint. |
| 8 | `schema.secret-shaped-parameter` | Walking `inputSchema.properties` **recursively**, a property whose name matches `(^\|_)(token\|password\|passwd\|secret\|api[_-]?key\|apikey\|credential\|private[_-]?key\|access[_-]?key)($\|_)` whose declared `type` is `string` and which is neither `format: "password"` nor constrained by an `enum`. **Anchor:** parameter, with a dotted `parameterPath` (`auth.api_key`). **Evidence:** the parameter's own description, if any — **never a value** (a schema has none, and a `default` must not be echoed). |
| 9 | `schema.undescribed-parameter` | A property with no non-empty `description`. **Anchor:** parameter. Bounded per tool by `SECURITY_MAX_FINDINGS_PER_TOOL` (declare here as **10**, with a trailing count in the message) so one 60-parameter tool cannot drown the report. |
| 10 | `schema.unconstrained-additional-properties` | The **root** input schema is `type: "object"` with `properties` and `additionalProperties` is `undefined` or `true`. Root only — firing on every nested object would produce noise proportional to schema depth for no extra signal. **Anchor:** tool. |
| 11 | `oauth.broad-scope` | `listGrantedScopes(serverId)` returns a non-empty list containing a scope matching `^\*$`, `^all$`, `^admin$`, `^full[_-]?access$`, `^.*:\*$`, or `^(repo\|write:org\|admin:.*)$`. **Anchor:** server. **Evidence:** the scope names, joined. A `null` (no OAuth, or no stored scope) produces **no finding** (D-SP9). |

Every matcher above is an exported named constant with a comment saying what it deliberately does
**not** match. That comment is the false-positive review, written down.

### Explicitly NOT in this WP

The **skill** analyzer and any skill rule id (WP 1.3 — out of scope for this workstream slice
entirely) · the posture **diff** (WP 1.4) · any **UI** (WP 2.1) · report-export integration (WP 2.2) ·
the CI assertion (`roadmap/ci/` WP 3.1 — do **not** add an assertion rule, a rule family, or a
placeholder) · persisting a report (D-SP8) · a migration · a new runtime dependency · an environment
variable · a feature flag · any change to `packages/shared/src/security-posture.ts` beyond adding the
two bound constants named above **if** WP 1.1 did not already declare them — if it did, use them and
change nothing.

---

## Design (implement this, don't redesign it)

### 1. `apps/api/src/security/analyzer.ts` — pure

```ts
/** What the pure analyzer is allowed to see. No repository, no db, no clock, no network. */
export type AnalyzerInput = {
  scan: ScanDetail;
  /** Granted OAuth scope NAMES, or null when there are none (D-SP9). Never token material. */
  oauthScopes: string[] | null;
};

export function analyzeScanTools(input: AnalyzerInput): SecurityFinding[];
```

One exported function per rule (`ruleInjectionPhrasing(tool)`, …) so a fixture can target a single
rule, plus the aggregator that runs all eleven. Findings are built **only** through
`createSecurityFinding` (D-SP5) with evidence built **only** through the input's raw text passed as
`evidence: { raw, offset }` (D-SP4).

A rule that throws must not take the report down — wrap each rule call so an unexpected input shape
(a `ToolScan.inputSchema` that is a string, an `annotations` that is an array) yields **no finding**
from that rule rather than a 500, and log once. State this in a comment: an analyzer that crashes on
a weird server is an analyzer that tells you nothing about the weirdest servers.

### 2. `apps/api/src/security/service.ts`

```ts
export type SecurityAnalyzerPorts = {
  scans: { getDetail: (scanId: string) => ScanDetail };
  servers: { list: () => ServerConfig[] };
  oauth: { listGrantedScopes: (serverId: string) => string[] | null };
  /** Injectable so a test can pin `generatedAt`. */
  now?: () => Date;
};

export function analyzeScan(ports: SecurityAnalyzerPorts, scanId: string): SecurityReport;
```

Structurally typed ports, exactly like `AssertionPorts` in `apps/api/src/assertions/service.ts` —
follow that file's shape, its comment density, and its `httpError(400, …)` idiom. Order → cap →
count-all → score, in that order, and a comment saying `counts` reflects **all** findings while
`findings` may be capped.

`subject` is a `SecuritySubjectRef` with `kind: "server"`, `id` = the scan id, `ownerId` = the server
id, `name` = the server's display name (from `servers.list()`, which is the **redacted** projection —
never `getInternal`), `capturedAt` = `scan.scannedAt`.

### 3. `apps/api/src/oauth/repository.ts` — one narrow method (D-SP9)

```ts
/**
 * The granted OAuth scope NAMES for a server, or null when none are stored.
 *
 * This is the ONLY projection of the encrypted credential blob that leaves this module for the
 * security analyzer, and it deliberately cannot carry anything else: it reads `tokens.scope` (falling
 * back to the registered `clientInformation.scope`), splits it on whitespace, and returns strings. No
 * access token, no refresh token, no client secret, no expiry. A test pins that.
 */
listGrantedScopes(serverId: string): string[] | null
```

Nothing else in `oauth/` changes.

### 4. `apps/api/src/security/routes.ts` + `index.ts`

One route, thin, registered beside the existing scan routes with the already-constructed `scans`,
`servers` and `oauthRepository` instances.

### 5. Tests — `apps/api/test/security-analyzer.test.ts`

Build fixtures as plain `ScanDetail` objects (no database) — the analyzer is pure, so this is cheap.

- **Per rule (D-SP11): a positive fixture and a near-miss negative fixture.** The negatives are the
  point. Examples of near-misses that must **not** fire: a tool honestly documenting "this endpoint
  will ignore previous drafts" (rule 1 — decide whether your phrase list survives it, and if not,
  tighten the list, don't weaken the test); a `<b>` tag (rule 2); a normal em-dash and an accented
  character (rule 3); a 1,900-character description (rule 4); a `list_deleted_items` read tool with
  `readOnlyHint: true` (rule 6 — decide and document); a parameter named `token_count` (rule 8 — the
  word-boundary anchors exist for exactly this); a root schema with `additionalProperties: false`
  (rule 10); scopes `["read:user", "read:org"]` (rule 11).
- **A clean server scores 100/`clean`**, a deliberately poisoned fixture scores in the expected band,
  and the same fixture analysed twice produces a **byte-identical** report (D-SP6/D-SP8).
- **D-SP10**: `running` and `failed` scans are each a 400.
- **D-SP9 secrecy**: a fixture whose stored OAuth credential holds an access token produces a report
  in which that token string appears **nowhere** — assert over `JSON.stringify(report)`.
- **Robustness**: a `ToolScan` with `inputSchema: "not an object"`, `annotations: []`, a null
  description, and a 500 KB description each produce a report rather than a throw.
- **Route**: `GET /api/scans/:id/security` returns the report; unknown id 404s.

Every new guardrail test must be **proved to bite** — the orchestrator will revert the guard and
expect it red. Pay particular attention to the D-SP9 secrecy test and the determinism test.

---

## Files

**New**
- `apps/api/src/security/analyzer.ts`
- `apps/api/src/security/service.ts`
- `apps/api/src/security/routes.ts`
- `apps/api/test/security-analyzer.test.ts`

**Modified**
- `apps/api/src/oauth/repository.ts` (one added method)
- `apps/api/src/index.ts` (register the route with existing instances)
- `packages/shared/src/security-posture.ts` — **only** if `SECURITY_MAX_DESCRIPTION_CHARS` /
  `SECURITY_MAX_FINDINGS_PER_TOOL` are not already declared there by WP 1.1. Nothing else in that
  file may change: the rule registry, the score, the ordering and the redactor are WP 1.1's and are
  complete.

**Zero-line diff (verified with `git diff <base>..HEAD -- <path>`)**
- `packages/shared/src/security-posture.ts`'s `SECURITY_RULES`, `computeSecurityScore`,
  `compareSecurityFindings`, `redactSecurityEvidence`, `createSecurityFinding`, and
  `SECURITY_ANALYZER_VERSION` — byte-identical
- `apps/api/src/oauth/{service,provider,routes}.ts`
- `apps/api/src/secrets/**`
- `apps/api/src/assertions/**`, `packages/shared/src/ci-assertions.ts` — WP 3.1's, not this WP's
- `apps/api/src/mcp-server/**`, `packages/shared/src/workbench-mcp.ts`
- `apps/web/**`, `apps/cli/**`
- `apps/api/src/db/**` — no migration (D-SP8)
- `pnpm-lock.yaml`, every `package.json` — no dependency
- `.env.example`, `apps/api/src/config/env.ts` — no environment variable

---

## Acceptance

- **A1** — All eleven declared rule ids are implemented, and **only** those eleven. A test asserts the
  set of rule ids the analyzer can emit equals `SECURITY_RULE_IDS` filtered to `subject: "server"`.
- **A2 (D-SP11)** — Every rule has a positive **and** a near-miss negative fixture, and each matcher
  is an exported constant carrying a comment on what it deliberately does not match.
- **A3 (D-SP5/D-SP4)** — No finding is constructed except through `createSecurityFinding`, and no
  `SecurityEvidence` is built except through `redactSecurityEvidence`. Grep proves it.
- **A4 (D-SP3)** — The score comes from `computeSecurityScore` and is computed nowhere else in
  `apps/api`. A clean fixture scores 100/`clean`.
- **A5 (D-SP6/D-SP8)** — Analysing the same scan twice yields a byte-identical report; nothing is
  persisted; `apps/api/src/db/**` has a zero-line diff and `user_version` is unchanged.
- **A6 (D-SP7)** — `analyzeScanTools` is pure: it takes data, has no database/clock/network, and CI
  WP 3.1 can call it with a `ScanDetail` it already holds. State the exported signature.
- **A7 (D-SP9)** — `listGrantedScopes` returns scope names only; a stored access token appears
  **nowhere** in a serialized report (asserted over `JSON.stringify`); a server with no stored scope
  produces no `oauth.broad-scope` finding. Nothing else in `oauth/` changed.
- **A8 (D-SP10)** — `running` and `failed` scans are each a **400** naming the status, never a report.
- **A9 (robustness)** — A malformed `inputSchema`, a non-object `annotations`, a null description and
  a 500 KB description each yield a report rather than a throw, and the affected rule contributes no
  finding.
- **A10** — `GET /api/scans/:scanId/security` returns the report and 404s an unknown id. No other
  route was added, no feature flag, no migration.
- **A11 (no severity inflation)** — Each rule emits exactly the registry's declared severity (D-SP5),
  and the `error` rules are exactly the ones the registry declares — a test enumerates them. (The
  registry's real split is **4 `error` · 4 `warning` · 3 `info`**; an earlier draft of this line said
  three, which was a miscount.)
- **A12 (gate)** — From the repo root: `pnpm typecheck && pnpm test && pnpm build && pnpm lint`, plus
  `pnpm --filter @mcp-token-footprint/web test` **separately**. Report exit codes and test counts.
  Two failures are **pre-existing** and must be reported as such, never fixed silently: 2 tests in
  `apps/api/test/compatibility-data.test.ts` and `pnpm lint` on
  `research/token-context-comparison/comparison/all-models.json`.
- **A13 (no drive-by scope)** — Every zero-line-diff path is clean; no file outside the Files section
  changed; **no skill rule, no diff, no UI and no assertion rule was added**. You did **not** touch
  any `STATUS.md`.
