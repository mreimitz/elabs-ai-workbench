# WP 1.3 — skill analyzer: security-surface roll-up into the same report shape + score

Phase 1 of [`README.md`](./README.md). Ledger: [`STATUS.md`](./STATUS.md). Shared rules: the
[testing conventions](../testing/conventions.md) + the repo rules in `.claude/rules/`.

**Depends on:** WP 1.1 (the contract — the shapes, the score, the ordering, the redactor, the finding
factory) and, in practice, WP 1.2's `apps/api/src/security/` module, whose text heuristics this WP
**moves into one place and reuses** rather than copying.
**Consumed by:** WP 1.4 (posture diff — it diffs skill reports the same way it diffs server reports),
WP 2.1 (Security tab in the skill inspector), WP 2.2 (report export).

---

## Locked decisions this WP inherits

- **D-SP1** — the contract lives in `packages/shared/src/security-posture.ts`. This WP **extends** it
  additively and adds no second shape, no second score, no second ordering.
- **D-SP2** — rule ids are `category.kebab-slug` and frozen the moment they ship. This WP freezes
  **seven** new `skill-surface.*` ids. Adding a new id is additive and leaves
  `SECURITY_ANALYZER_VERSION` at **1**; re-pointing or renaming an existing id is forbidden outright.
- **D-SP3** — the score is `computeSecurityScore` and nothing else. Do not re-weight, do not re-band,
  do not compute a score in a second file. (A WP 1.2 test asserts `computeSecurityScore` appears in
  **exactly** `security/service.ts` across all of `apps/api/src` — see the Design section, which is
  why the skill service function lands in that same file.)
- **D-SP4** — evidence goes through `redactSecurityEvidence`, always, via `createSecurityFinding`'s
  `{ raw, offset }` parameter. A rule never builds a `SecurityEvidence` literal, never calls the
  redactor directly, and never carries an absolute local path. (A WP 1.2 test walks **every** file
  under `apps/api/src/security/` and fails on a `severity:` literal, an `excerpt:` literal, or a
  direct `redactSecurityEvidence` call — the new files are covered by it automatically.)
- **D-SP5** — a finding's severity **is** its rule's declared severity. `createSecurityFinding` has
  no severity parameter; a rule that would need two severities is two rules.
- **D-SP6** — a report is byte-stable for the same input: findings are emitted in
  `compareSecurityFindings` order and nothing else.
- **D-SP7** — the analyzer is **pure** (data in, findings out); a thin service does the loading.
- **D-SP8** — a posture report is computed on read and **persisted nowhere**. No migration, no table,
  no column.
- **D-SP11** — every heuristic's matcher is a named, exported constant with a **positive** fixture and
  a **near-miss negative** fixture, and a comment saying what it deliberately does **not** match.
  That comment is the false-positive review, written down.
- **README invariants** — read-only over persisted data; **skill content is inspected, never
  executed** (CLAUDE.md § "Skills registry & inspector"); heuristics conservative and documented;
  **severity inflation is a defect**; **no new runtime dependency**.
- **`.claude/rules/mcp-and-security.md`** — nothing leaving the API carries a secret value. The skill
  secret (a GitHub PAT) is never returned; use the **redacted** `SkillRepository.getPublic`, never
  `getInternal`.

### Decisions to lock in this WP (record them in the ledger's decision log)

- **D-SP12 — a skill-level finding gets its own anchor kind; it does not borrow the server's.**
  `SecurityFindingAnchor` gains one additive member, `{ kind: "skill" }`, for a finding that is about
  the **version as a whole** rather than about one file in it (it ships scripts; its frontmatter grants
  broad tool access). Reusing `{ kind: "server" }` would put the word *server* on a skill finding in
  every UI, every export and every CI comment, for the sake of not adding four lines. The change is
  additive by construction: every existing union member, `anchorNameParts`' existing cases,
  `ANCHOR_KIND_RANK`'s existing entries and the zod union's existing variants stay **byte-identical**,
  the new kind ranks **last** (`skill: 4`) so no existing pair's relative order can move, and
  `SECURITY_ANALYZER_VERSION` stays **1** — no report that exists today changes meaning.
- **D-SP13 — detection is precise, redaction is generous, and the two are deliberately different
  matchers over one definition.** `redactSecurityEvidence`'s credential list ends in a catch-all
  (`[A-Za-z0-9_-]{32,}`) whose over-masking is the correct error direction: an over-masked identifier
  costs one question, a leaked token costs a rotation. That same catch-all is the **wrong** matcher for
  *reporting* a credential — a SKILL.md routinely contains a commit sha, a long slug or a long
  snake_case tool name, and a rule that fires on those is the false-positive machine the README
  forbids. So `security-posture.ts` exports the **prefixed** shapes separately
  (`SECURITY_CREDENTIAL_PREFIX_PATTERNS` + `findPrefixedCredential`), the redactor keeps using the full
  list including the catch-all, and **neither list is re-typed anywhere**. The asymmetry is written in
  a comment beside both.
- **D-SP14 — a text heuristic has exactly one definition, and both analyzers call it.** The injection
  phrase list, the hidden-instruction patterns and the invisible-codepoint ranges are the *same
  question* asked of a tool description and of a SKILL.md body. Copying them into a second file is how
  the two drift until `poisoning.injection-phrasing` and `skill-surface.injection-phrasing` mean
  different things while claiming to mean the same one. They move to
  `apps/api/src/security/text-scan.ts`, `analyzer.ts` **re-exports** every constant it exported before
  (so its public surface is unchanged), and its three rule functions become thin callers.
  **`apps/api/test/security-analyzer.test.ts` must stay byte-identical and green — that is the proof
  the extraction preserved behaviour**, and it is the acceptance criterion, not a nice-to-have.
- **D-SP15 — the skill analyzer reads the version row, the file LIST and the SKILL.md body, and
  nothing else.** It does not open the content of every file in the tree. A version may hold up to
  2,000 files and 50 MB (`SKILL_MAX_FILES` / `SKILL_MAX_TOTAL_BYTES`), so a full-tree content scan
  would need its own byte budget, its own truncation flag on the report and its own answer for "the
  scan stopped early" — a shape change to `SecurityReport` for a rule this WP does not have. SKILL.md
  is the text an agent loads **every** time the skill is attached, which makes it the highest-value
  surface per byte read. The bound is documented at the top of the analyzer, and widening it later is a
  **new rule id** (additive, D-SP2), never a change of meaning for one of these seven.
- **D-SP16 — a version whose SKILL.md cannot be read as text is a 400, not a clean report.** Five of
  the seven rules read that body; scoring a version without it would hand it a near-clean bill of
  health on the strength of the two rules that happened to still run. Refuse with **400** naming why
  (`missing` or `binary`), exactly the posture D-SP10 takes for a non-`success` scan. A version that
  simply has *no findings* is a different thing and still scores `100`/`clean`.

---

## What we're building

1. **`packages/shared/src/security-posture.ts` — additive only, zero removed lines:**
   - seven new `skill-surface.*` entries in `SECURITY_RULES`, each with `subject: "skill"`;
   - the `{ kind: "skill" }` anchor member + its `anchorNameParts` case + `ANCHOR_KIND_RANK.skill = 4`
     + its `.strict()` zod variant (D-SP12);
   - `SECURITY_CREDENTIAL_PREFIX_PATTERNS` + `findPrefixedCredential(text)` (D-SP13), with the
     existing `CREDENTIAL_PATTERNS` rebuilt from that same list plus the unchanged catch-all so there
     is one definition of each prefix shape.
2. **`packages/shared/src/skill-security.ts`** — export the existing network-reference regex as
   `SKILL_NETWORK_REF_PATTERN` so the rule can report **where** it matched instead of only that it did.
   `deriveSkillSecuritySurface` keeps using it and its behaviour does not change.
3. **`apps/api/src/security/text-scan.ts`** — the one definition of the three shared text heuristics
   (D-SP14), pure, plus the constants moved out of `analyzer.ts`.
4. **`apps/api/src/security/analyzer.ts`** — rules 1–3 become thin callers of `text-scan.ts`; every
   previously exported constant is **re-exported** so nothing importing it breaks. No behaviour change.
5. **`apps/api/src/security/skill-analyzer.ts`** — the seven pure skill rules over already-loaded data.
6. **`apps/api/src/security/service.ts`** — `analyzeSkillVersion(ports, skillId, versionId):
   SecurityReport`: load, refuse an unreadable SKILL.md (D-SP16), run the rules, sort, cap, count
   **all**, score, stamp. Added **to the existing file** (see Design §4).
7. **`apps/api/src/security/routes.ts`** — one route,
   `GET /api/skills/:id/versions/:vid/security` → `SecurityReport`.
8. **Wiring** in `apps/api/src/index.ts` — pass the already-constructed skills repository into the
   existing `registerSecurityRoutes` ports. Construct nothing new.
9. **Tests** — a **new** file `apps/api/test/security-skill-analyzer.test.ts`, plus the additions to
   `packages/shared/src/security-posture.test.ts` that its registry-integrity test forces.

### The seven rules — implement exactly these heuristics

All matching is case-insensitive unless stated. `body` is the SKILL.md file's text as stored (frontmatter
included — it is text the model reads). `files` is `SkillRepository.listFiles(versionId)`. `manifest` is
`SkillVersion.manifest`, already parsed and persisted — **do not re-parse frontmatter**.

| # | Rule id | Severity | What fires it |
| --- | --- | --- | --- |
| S1 | `skill-surface.injection-phrasing` | `error` | `findInjectionPhrase(body)` matches — the **same** phrase list and the same instruction-noun requirement WP 1.2's rule 1 uses (D-SP14), so *"will ignore previous drafts"* stays silent here too. **Anchor:** `file`, the SKILL.md path. **Evidence:** the match ± `EVIDENCE_CONTEXT_CHARS`. **At most one finding per version** — a hostile SKILL.md is one hostile fact, and three `error` findings would move the score −45 for it. |
| S2 | `skill-surface.hidden-instructions` | `error` | The body matches the pseudo-tag pattern **or** the model-address pattern, **or** contains an HTML comment *whose inner text* matches `findInjectionPhrase` or the model-address pattern. **A bare HTML comment does NOT fire** — that is the one deliberate divergence from WP 1.2's rule 2, and it must be commented: a SKILL.md is authored Markdown where `<!-- prettier-ignore -->` and TOC markers are ordinary editorial furniture, unlike a tool description, which is a wire string with no reason to carry one. **Anchor:** `file`. **Evidence:** the matched block. One finding max. |
| S3 | `skill-surface.invisible-unicode` | `error` | An invisible codepoint (the shared `INVISIBLE_CODE_POINT_RANGES`, plus U+E0000–U+E007F and the private-use block U+E000–U+F8FF exactly as WP 1.2's rule 3 handles them) appears in the **body**, in `manifest.name` / `manifest.description`, or in a **file path**. **Anchor:** `file` for a body or path hit (the offending path), `skill` for a manifest hit. **Evidence:** the surrounding text — the redactor escapes the invisibles visibly, which is the entire point of the rule. At most one body finding, at most one manifest finding, and path findings bounded by `SECURITY_MAX_FINDINGS_PER_TOOL` (reuse it; add **no** second constant meaning the same number, and comment that it is the per-rule-per-subject bound). |
| S4 | `skill-surface.credential-in-body` | `warning` | `findPrefixedCredential(body)` matches — the **prefixed** shapes only (D-SP13). **Anchor:** `file`. **Evidence:** the match ± context, which `redactSecurityEvidence` then masks to `«redacted»` — so the finding proves a credential is there without republishing it. One finding max. The message must say the file and that the value was masked. |
| S5 | `skill-surface.broad-allowed-tools` | `warning` | `manifest.allowedTools` is present and, split on whitespace, contains a token matching `^\*$`, or a bare unrestricted executor (`^(bash\|shell\|execute)$`), or an executor with a wildcard argument (`^(bash\|shell\|execute)\(\s*\*\s*\)$`). **A parenthesised restriction never fires** (`Bash(git:*)` is a narrowed grant and is the good case). **`allowedTools` absent → no finding**: "we could not tell" is not a finding (the D-SP9 posture). **Anchor:** `skill`. **Evidence:** the raw `allowedTools` string. |
| S6 | `skill-surface.executable-scripts` | `info` | `deriveSkillSecuritySurface(files, body).scriptCount > 0`. **Call that function — do not re-derive script classification** (it is the same derivation the Skills inspector and the workbench MCP `skills_security` tool already show; a second one is how three surfaces end up disagreeing). **Anchor:** `skill`. **Message:** the count and the languages. **Evidence:** the script paths, in `listFiles` order, space-joined (the redactor caps it). **Exactly one finding**, never one per script — thirty scripts is one fact, and thirty `info` findings would be −30 for it. |
| S7 | `skill-surface.network-reference` | `info` | `SKILL_NETWORK_REF_PATTERN` matches the body. **Anchor:** `file`. **Evidence:** the matched URL ± context, with the offset. One finding max. Deliberately light: it flags an operator-visible signal, it is not a taint analysis — say so in the rationale, as `skill-security.ts` already does. |

Rationales in the registry are written for **the person who has to fix the skill**, in the voice the
eleven server rules already use. Severities were chosen against "severity inflation is a defect": only
the three checks that mean *this skill is steering the model behind your back* are `error`; shipping
scripts and linking out are `info`, because honest skills do both all day.

### Explicitly NOT in this WP

The posture **diff** (WP 1.4 — do not add a diff function, a baseline comparison, or a placeholder) ·
any **UI** (WP 2.1) · report-export integration (WP 2.2) · a CI assertion or any change to
`apps/api/src/assertions/**` / `packages/shared/src/ci-assertions.ts` (`roadmap/ci/` WP 3.1 consumes
server posture only; wiring skills into it is a later, owner-gated decision) · a workbench MCP tool
over skill posture (`apps/api/src/mcp-server/**` is zero-diff) · a **full-tree content scan**
(D-SP15) · persisting a report (D-SP8) · a migration · a new runtime dependency · an environment
variable · a feature flag · **any behaviour change to the eleven server rules** (their fixtures prove
it) · any change to `SECURITY_ANALYZER_VERSION`, `computeSecurityScore`, `compareSecurityFindings`,
`redactSecurityEvidence` or `createSecurityFinding`.

---

## Design (implement this, don't redesign it)

### 1. `packages/shared/src/security-posture.ts` — additive

```ts
export type SecurityFindingAnchor =
  | { kind: "server" }
  | { kind: "skill" }                                             // NEW (D-SP12)
  | { kind: "tool"; toolName: string }
  | { kind: "parameter"; toolName: string; parameterPath: string }
  | { kind: "file"; path: string };
```

`anchorNameParts` gains `case "skill": return [];`. `ANCHOR_KIND_RANK` gains `skill: 4` — **last**, so
no existing pair's relative order can move (say that in a comment). The zod union gains
`z.object({ kind: z.literal("skill") }).strict()`. Everything else in the file keeps a zero-line diff.

```ts
/**
 * D-SP13 — the credential shapes precise enough to REPORT. The catch-all that
 * `redactSecurityEvidence` also masks with is deliberately absent: over-masking is the right error
 * for redaction and the wrong one for a finding.
 */
export const SECURITY_CREDENTIAL_PREFIX_PATTERNS: readonly RegExp[];

/** The first prefixed credential-shaped run in `text`, or null. Never returns the value un-masked to a caller that then prints it — callers pass it to `createSecurityFinding` as `{ raw }`. */
export function findPrefixedCredential(text: string): { match: string; offset: number } | null;
```

Rebuild the existing `CREDENTIAL_PATTERNS` as `[...SECURITY_CREDENTIAL_PREFIX_PATTERNS, <the
unchanged catch-all>]` so each prefix shape has one definition. `redactSecurityEvidence`'s **output
must not change for any input** — the existing WP 1.1 redaction tests are the proof and must stay
green unmodified.

### 2. `apps/api/src/security/text-scan.ts` — the one definition (D-SP14)

```ts
export function findInjectionPhrase(text: string): { phrase: string; match: string; offset: number } | null;
export function findHiddenInstructionBlock(text: string): { match: string; offset: number } | null;
export function findInvisibleCharacter(text: string): { code: number; offset: number } | null;
```

Move `INJECTION_PHRASES`, `INJECTION_INSTRUCTION_OBJECTS`, `HIDDEN_HTML_COMMENT_PATTERN`,
`HIDDEN_PSEUDO_TAG_PATTERN`, `HIDDEN_MODEL_ADDRESS_PATTERN`, `INVISIBLE_CODE_POINT_RANGES` and
`EVIDENCE_CONTEXT_CHARS` here **verbatim, comments included** — including every "deliberately does not
match" comment, which is the false-positive review and must not be lost in the move. `analyzer.ts`
then re-exports each of them (`export { X } from "./text-scan.js"` or an explicit re-export block) so
its public surface is byte-for-byte what it was, and rewrites `ruleInjectionPhrasing`,
`ruleHiddenInstructions` and `ruleInvisibleUnicode` as callers.

`text-scan.ts` is pure and must satisfy the same forbidden-import check as `analyzer.ts`
(`better-sqlite3`, `node:fs`, `fastify`, `new Date(`, `Date.now(`).

### 3. `apps/api/src/security/skill-analyzer.ts` — pure

```ts
/** What the pure skill analyzer is allowed to see (D-SP15). No repository, no db, no clock, no network. */
export type SkillAnalyzerInput = {
  version: SkillVersion;
  files: readonly SkillFileNode[];
  /** The SKILL.md text. The service refuses the request when it cannot be read (D-SP16), so this is never a silent "". */
  skillMd: { path: string; body: string };
};

export function analyzeSkillFiles(input: SkillAnalyzerInput): SecurityFinding[];
```

One exported function per rule (`ruleSkillInjectionPhrasing(input)`, …) so a fixture can target one
rule, plus an exported `SKILL_ANALYZER_RULE_IDS` and a `SKILL_RULES` table, mirroring `analyzer.ts`'s
`TOOL_RULES` / `SERVER_RULES` / `SERVER_ANALYZER_RULE_IDS` shape.

Every rule call is wrapped so a malformed input (a `manifest` whose `allowedTools` is not a string, a
file node with no `path`) yields **no finding from that rule** rather than a 500, logged once through
the same optional `onRuleError` callback `analyzeScanTools` already takes. Same comment as WP 1.2's:
an analyzer that crashes on a weird skill is an analyzer that tells you nothing about the weirdest
skills.

### 4. `apps/api/src/security/service.ts` — added to the EXISTING file

```ts
export type SecuritySkillPorts = {
  skills: {
    getPublic: (skillId: string) => Skill;            // REDACTED projection — never getInternal
    getVersion: (versionId: string) => SkillVersion;
    listFiles: (versionId: string) => SkillFileNode[];
    getFileContent: (versionId: string, path: string) => SkillFileContent;
  };
  now?: () => Date;
  onRuleError?: (ruleId: SecurityRuleId, error: unknown) => void;
};

export function analyzeSkillVersion(
  ports: SecuritySkillPorts,
  skillId: string,
  versionId: string,
): SecurityReport;
```

It goes in `service.ts` and **not** in a new file for a concrete reason: a WP 1.2 test asserts that
`computeSecurityScore` appears in exactly one file across all of `apps/api/src`, and that file is
`security/service.ts` (A4 / D-SP3). Splitting the skill service out would either break that test or
force it to be weakened — and the test is right: one place applies the score.

Order of operations, and it matters:
1. `getVersion(versionId)`; **404 if `version.skillId !== skillId`** — a version id from another
   skill must never be reportable under this skill's name.
2. `listFiles(versionId)`; find `isSkillMd`. Missing → **400** (D-SP16). `getFileContent` → binary →
   **400** (D-SP16). Both messages name the version and say which case it is.
3. `analyzeSkillFiles(...)` → sort with `compareSecurityFindings` → `capSecurityFindings` → count
   **all** (not `findings.length`) → `computeSecurityScore` over the same complete set.
4. `subject`: `{ kind: "skill", id: versionId, ownerId: skillId, name: getPublic(skillId).displayName,
   capturedAt: version.createdAt }`. Fall back to the version's `versionLabel`-bearing skill name only
   if `getPublic` throws, with the same reasoning `displayName()` already carries for servers.

Follow the existing file's comment density and its `httpError(400, …)` idiom exactly.

### 5. `apps/api/src/security/routes.ts` + `index.ts`

```
GET /api/skills/:id/versions/:vid/security  →  SecurityReport
```

Use the param names **`:id` / `:vid`**, matching every sibling route in `apps/api/src/skills/routes.ts`
— same path shape, same names, no ambiguity for anyone reading the two files side by side. Thin: read
the params, delegate, pass the `onRuleError` logger down exactly as the scan route does, let the
central error handler format the repository's 404 and the service's 400s.

`registerSecurityRoutes` grows its ports object; `index.ts` passes the **already-constructed** skills
repository. Construct nothing new, add no second `registerSecurityRoutes` call.

### 6. Tests — `apps/api/test/security-skill-analyzer.test.ts` (new file)

A new file, so **`apps/api/test/security-analyzer.test.ts` stays byte-identical** (D-SP14's proof).

- **Per rule (D-SP11): a positive fixture and a near-miss negative fixture.** The negatives are the
  point. At minimum: a SKILL.md honestly saying *"the importer will ignore previous drafts"* (S1);
  a `<!-- prettier-ignore -->` comment and a `<b>` tag (S2 — must be silent); an em-dash and an
  accented character (S3); a commit sha and a 40-character slug in prose (S4 — must be silent, and
  this is exactly the D-SP13 asymmetry earning its keep); `allowed-tools: Bash(git:*) Read` (S5 — must
  be silent); a skill with no script files (S6); a skill whose body has only relative Markdown links
  (S7).
- **A skill with a plain prose SKILL.md, no scripts and no links scores 100/`clean`**, and its
  `subject` is the exact `{ kind: "skill", id, ownerId, name, capturedAt }` shape.
- **Determinism**: the same version analysed twice is **byte-identical** (`JSON.stringify` equality),
  and `securityReportSchema.parse` accepts it.
- **D-SP12**: a report containing both a `skill` anchor and `file` anchors sorts stably, and
  `securityFindingIdentity` produces distinct keys for a `skill` anchor and a `server` anchor.
- **D-SP16**: a version with no SKILL.md, and one whose SKILL.md is binary, are each a **400** naming
  the case. A version id belonging to a different skill is a **404**.
- **Score sanity**: a deliberately poisoned SKILL.md (injection phrasing + a hidden instruction block +
  an `sk-` credential + `allowed-tools: *`) lands in the expected band; a normal skill that ships
  scripts and links out scores 98/`low` and **not** worse — that assertion is the anti-inflation guard.
- **Robustness**: a `manifest` with a non-string `allowedTools`, a file node with an empty path, a
  500 KB body, and a body that is entirely one 200 KB line each produce a report rather than a throw.
- **Route**: `GET /api/skills/:id/versions/:vid/security` returns the report over the **real**
  `SkillRepository` against a migrated in-memory database; an unknown version 404s; `sqlite_master`
  and `PRAGMA user_version` are unchanged before and after (D-SP8).
- **Regression, in this file**: `analyzeScanTools` over a small server fixture still produces exactly
  what it did before the extraction — one direct assertion, so a reader of *this* file can see D-SP14
  was checked here too and not only by the untouched WP 1.2 file.

`packages/shared/src/security-posture.test.ts` must be extended (its registry-integrity test writes
every rule id **and** its severity out a second time by hand — that is deliberate, so add the seven
rather than loosening the test), plus coverage for the new anchor member, `findPrefixedCredential`
and the unchanged `redactSecurityEvidence` behaviour.

Every new guardrail test must be **proved to bite** — the orchestrator will revert the guard and expect
red. Pay particular attention to the D-SP16 refusals, the D-SP13 near-miss and the determinism test.

---

## Files

**New**
- `apps/api/src/security/text-scan.ts`
- `apps/api/src/security/skill-analyzer.ts`
- `apps/api/test/security-skill-analyzer.test.ts`

**Modified**
- `packages/shared/src/security-posture.ts` — **additive only, zero removed lines** except the
  `CREDENTIAL_PATTERNS` literal being rebuilt from `SECURITY_CREDENTIAL_PREFIX_PATTERNS` (same shapes,
  same order, same behaviour)
- `packages/shared/src/security-posture.test.ts` — the seven rule ids + severities, the anchor member,
  `findPrefixedCredential`
- `packages/shared/src/skill-security.ts` — export `SKILL_NETWORK_REF_PATTERN`; no behaviour change
- `apps/api/src/security/analyzer.ts` — three rules become callers; the moved constants are re-exported
- `apps/api/src/security/service.ts` — `analyzeSkillVersion` + `SecuritySkillPorts`
- `apps/api/src/security/routes.ts` — one added route
- `apps/api/src/index.ts` — pass the existing skills repository into the existing ports

**Zero-line diff (verify each with `git diff <base>..HEAD -- <path>`)**
- `apps/api/test/security-analyzer.test.ts` — **byte-identical, and green** (D-SP14's proof)
- `packages/shared/src/security-posture.ts`'s `SECURITY_ANALYZER_VERSION`, `computeSecurityScore`,
  `compareSecurityFindings`, `redactSecurityEvidence`, `createSecurityFinding`,
  `securityFindingIdentity` and every existing `SECURITY_RULES` entry
- `apps/api/src/skills/**` — the analyzer reads through the repository's existing methods; it adds none
- `apps/api/src/oauth/**`, `apps/api/src/secrets/**`
- `apps/api/src/assertions/**`, `packages/shared/src/ci-assertions.ts`
- `apps/api/src/mcp-server/**`, `packages/shared/src/workbench-mcp.ts`
- `apps/web/**`, `apps/cli/**`, `e2e/**`
- `apps/api/src/db/**` — no migration (D-SP8)
- `pnpm-lock.yaml`, every `package.json` — no dependency
- `.env.example`, `apps/api/src/config/env.ts` — no environment variable
- every `roadmap/**/STATUS.md` — the orchestrator ticks the ledger, not you

---

## Acceptance

- **A1** — Exactly **seven** `skill-surface.*` rule ids are declared and implemented — no more, no
  fewer, none invented. A test asserts the set of rule ids `analyzeSkillFiles` can emit equals
  `SECURITY_RULE_IDS` filtered to `subject: "skill"`, and that the eleven server ids are untouched.
- **A2 (D-SP11)** — Every one of the seven has a positive **and** a near-miss negative fixture, and
  every matcher is an exported constant carrying a comment on what it deliberately does not match.
- **A3 (D-SP12)** — `{ kind: "skill" }` exists in the type, in `anchorNameParts`, in
  `ANCHOR_KIND_RANK` (ranked **last**), and in the zod union; `SECURITY_ANALYZER_VERSION` is still
  **1**; every pre-existing anchor member is byte-identical; a mixed-anchor report sorts stably and
  round-trips through `securityReportSchema`.
- **A4 (D-SP13)** — `findPrefixedCredential` fires on `sk-…`, `ghp_…` and `mcpfp_…` and is **silent**
  on a 40-character hex sha and a long slug, while `redactSecurityEvidence` still masks all four —
  one test shows both halves side by side. `redactSecurityEvidence`'s output is unchanged for every
  existing WP 1.1 fixture.
- **A5 (D-SP14)** — Each shared heuristic has exactly one definition: a grep proves the phrase list,
  the hidden-instruction patterns and the invisible ranges appear in **one** file under `apps/api/src`.
  `apps/api/test/security-analyzer.test.ts` is **byte-identical to its pre-WP state and passes**.
- **A6 (D-SP15/D-SP7)** — `analyzeSkillFiles` is pure: data in, findings out, no db/clock/network
  (source-scanned for `better-sqlite3`, `node:fs`, `fastify`, `new Date(`, `Date.now(`), and
  `text-scan.ts` passes the same scan. It reads no file content beyond the SKILL.md body it was handed.
- **A7 (D-SP16)** — A missing SKILL.md and a binary SKILL.md are each a **400** naming the case; a
  version id belonging to another skill is a **404**; a version with genuinely nothing to report is
  `100`/`clean`.
- **A8 (D-SP3/no inflation)** — The score comes from `computeSecurityScore`, still computed in exactly
  one file. A skill that ships scripts and links out scores **98**/`low`, not worse — the two `info`
  rules cost exactly two points between them, and no rule emits per-file findings for a subject-level
  fact.
- **A9 (D-SP6/D-SP8)** — The same version analysed twice is byte-identical; nothing is persisted;
  `apps/api/src/db/**` is zero-diff and `PRAGMA user_version` is unchanged across a service call
  **and** a real HTTP request.
- **A10 (D-SP4/D-SP5)** — No finding is constructed except through `createSecurityFinding` and no
  evidence except through it (the WP 1.2 source-walk test covers the new files — confirm it still
  passes rather than assuming it). Each rule emits exactly the registry's declared severity; the
  `error` rules are exactly the three the registry declares.
- **A11 (secrets)** — The report reads the **redacted** `getPublic` projection, never `getInternal`; a
  fixture skill with a stored GitHub PAT produces a report in which that PAT appears **nowhere**
  (asserted over `JSON.stringify(report)`, with the fixture token deliberately shorter than 32
  characters so the redactor's catch-all cannot make the test pass for the wrong reason).
- **A12 (route)** — `GET /api/skills/:id/versions/:vid/security` returns the report. No other route was
  added, no feature flag, no migration, no dependency, no environment variable.
- **A13 (robustness)** — A non-string `allowedTools`, an empty file path, a 500 KB body and a
  single-200 KB-line body each yield a report rather than a throw, and the affected rule contributes
  no finding.
- **A14 (gate)** — From the repo root: `pnpm typecheck && pnpm test && pnpm build && pnpm lint`, plus
  `pnpm --filter @mcp-token-footprint/web test` **separately**. Report exit codes and test counts.
  These failures are **pre-existing** and must be reported as such, never fixed silently: the
  compatibility-roster tests in `apps/api/test/compatibility-data.test.ts`, and `pnpm lint` on
  `research/token-context-comparison/comparison/all-models.json`.
- **A15 (no drive-by scope)** — Every zero-line-diff path above is clean; no file outside the Files
  section changed; **no diff function, no UI, no assertion rule and no MCP tool was added**. You did
  **not** touch any `STATUS.md`.
