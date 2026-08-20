import { z } from "zod";

// ==================================================================================================
// Security posture contract — the finding/report shapes, the frozen rule-id registry, the score, and
// the one total order a report is emitted in (planning/Roadmap/RM-20-security-posture/, WP 1.1)
// ==================================================================================================
// **This module analyses nothing.** Not one rule is implemented here. It is the declaration that the
// server analyzer (WP 1.2), the skill analyzer (WP 1.3), the posture diff (WP 1.4), the Security tab
// (WP 2.1), the report export (WP 2.2) and CI's `no-new-security-findings` assertion
// (`planning/Roadmap/RM-08-ci/` WP 3.1) all import — so that none of them re-derives a shape, a weight or a sort
// order from prose. The precedent is `ci-assertions.ts` (the CI gate contract, declared once and
// consumed by both the API and the CLI) and `skill-security.ts` (a derivation lifted out of a React
// component so both ends could reach it).
//
// It is PURE. `zod` is its only import: no `node:*`, no filesystem, no network, no database, no
// module-level mutable state. That is exactly what lets the API, the web bundle and the CLI-facing
// report share one copy of it, and it is why the analyzer's I/O lives in `apps/api` instead
// (`.claude/rules/architecture.md` — a wire shape is declared in `packages/shared` first).
//
// Locked decisions this module encodes (planning/Roadmap/RM-20-security-posture/wp-1.1-contract.md):
//
//   • **D-SP1 — the analyzer is a pure, versioned read-model declared here, and the contract lands
//     before the first rule.** One module holds the shapes, the registry, the score and the ordering.
//     Every consumer imports them; none re-implements them.
//   • **D-SP2 — a rule id is `category.kebab-slug`, and it is frozen the moment it ships.** A rule is
//     never renamed and never re-pointed at a different check; one that stops making sense is marked
//     {@link SecurityRule.deprecated} and keeps its id. This is not tidiness. CI WP 3.1 compares
//     finding sets **by `ruleId`** across two releases, so a renamed rule reads as one finding
//     resolved plus one new finding appearing — precisely the false alarm that teaches an operator to
//     ignore the gate.
//   • **D-SP3 — the score is a documented, severity-weighted deduction from 100, computed in exactly
//     ONE place** ({@link computeSecurityScore}) and versioned by {@link SECURITY_ANALYZER_VERSION}.
//     No caller may re-apply the weights.
//   • **D-SP4 — evidence is redacted and capped by construction, not by convention.** All of it goes
//     through {@link redactSecurityEvidence}: truncated, invisibles escaped so they become VISIBLE,
//     credential-shaped runs masked. A finding never carries an absolute local path.
//   • **D-SP5 — a finding's severity IS its rule's declared severity. Always.** A rule that needs two
//     severities is two rules. {@link createSecurityFinding} reads the severity out of the registry
//     rather than taking it as a parameter, so a caller cannot escalate a single instance and make a
//     gate's counts move for a reason nobody can see in the rule list.
//   • **D-SP6 — a report is byte-stable for the same input.** {@link compareSecurityFindings} is the
//     ONE total order findings are emitted in. Determinism is this plan's headline invariant, and the
//     posture diff plus the CI gate are both meaningless without it.

/**
 * Bumped when a rule's MEANING changes, a weight changes, or the report shape changes — i.e. whenever
 * two reports would no longer be comparable. Mirrors `TOKEN_COUNTING_VERSION`'s job for token counts:
 * a consumer that compares two reports MUST check this first (D-SP3). Adding a NEW rule id is
 * additive and leaves this at 1; re-pointing an existing id at a different check is forbidden
 * outright (D-SP2), so this constant never has to paper over a rename.
 */
export const SECURITY_ANALYZER_VERSION = 1;

/**
 * Ordered worst-first, which is also the order findings are emitted in (D-SP6) and the order the
 * deduction weights descend in (D-SP3).
 */
export const SECURITY_SEVERITIES = ["error", "warning", "info"] as const;
export type SecuritySeverity = (typeof SECURITY_SEVERITIES)[number];

/** What a report is ABOUT. WP 1.3 added the `skill` rules without reshaping this vocabulary. */
export const SECURITY_SUBJECT_KINDS = ["server", "skill"] as const;
export type SecuritySubjectKind = (typeof SECURITY_SUBJECT_KINDS)[number];

/**
 * The `category` half of every rule id (D-SP2). `skill-surface` carries WP 1.3's seven skill rules,
 * which roll the existing skill security surface into this same shape.
 */
export const SECURITY_RULE_CATEGORIES = [
  "poisoning",
  "annotation",
  "schema",
  "oauth",
  "skill-surface",
] as const;
export type SecurityRuleCategory = (typeof SECURITY_RULE_CATEGORIES)[number];

/** How a score reads at a glance. Thresholds live in {@link computeSecurityScore}, nowhere else. */
export const SECURITY_SCORE_BANDS = ["clean", "low", "medium", "high"] as const;
export type SecurityScoreBand = (typeof SECURITY_SCORE_BANDS)[number];

// ── The rule registry (D-SP2) ───────────────────────────────────────────────────────────────────

export type SecurityRule = {
  /** `category.kebab-slug`, frozen forever once shipped (D-SP2). */
  id: string;
  category: SecurityRuleCategory;
  subject: SecuritySubjectKind;
  /** The ONE severity every finding of this rule carries (D-SP5). */
  severity: SecuritySeverity;
  /** Four words an operator scans in a list. */
  title: string;
  /**
   * WHY this matters and what to do — one or two sentences, written for the person who has to fix
   * the server, not for a changelog. A rule with a vague rationale is a rule that gets ignored.
   */
  rationale: string;
  /** Set instead of deleting a rule that no longer makes sense. Its id is never reused (D-SP2). */
  deprecated?: true;
};

/**
 * The eighteen rules: **eleven** `subject: "server"` (implemented in `apps/api/src/security/
 * analyzer.ts`, WP 1.2) followed by **seven** `subject: "skill"` (implemented in
 * `apps/api/src/security/skill-analyzer.ts`, WP 1.3). Nothing here analyses anything — this is the
 * declaration both analyzers are held to, and a rule id that no analyzer can emit is a red test.
 *
 * The severities were chosen against the plan's "severity inflation is a defect" line: only the
 * checks where a finding means *this thing is actively trying to steer a model* are `error`; hygiene
 * a reasonable server or an honest skill may legitimately fail is `info`.
 *
 * Every id is frozen the moment it ships (D-SP2). The seven skill ids were ADDED here; not one of the
 * eleven above was renamed, re-pointed or re-severitied, which is why `SECURITY_ANALYZER_VERSION`
 * stays 1.
 */
export const SECURITY_RULES = {
  "poisoning.injection-phrasing": {
    id: "poisoning.injection-phrasing",
    category: "poisoning",
    subject: "server",
    severity: "error",
    title: "Injection phrasing in description",
    rationale:
      "The description tells the model to override its own instructions or to keep something from you. A tool definition is prompt text the model reads verbatim, so this steers every session that loads the server — treat it as hostile until the vendor explains it.",
  },
  "poisoning.hidden-instructions": {
    id: "poisoning.hidden-instructions",
    category: "poisoning",
    subject: "server",
    severity: "error",
    title: "Hidden instruction block",
    rationale:
      "The description carries a block addressed to the model rather than to you — a pseudo-tag or an HTML comment. Anything you do not see in the tool list but the model does is a channel for instructions you never approved.",
  },
  "poisoning.invisible-unicode": {
    id: "poisoning.invisible-unicode",
    category: "poisoning",
    subject: "server",
    severity: "error",
    title: "Invisible characters in definition",
    rationale:
      "Zero-width, bidi-control or private-use characters sit in the tool's name or description, where they are invisible to you and meaningful to the model. A tool definition has no legitimate reason to carry them.",
  },
  "poisoning.oversized-description": {
    id: "poisoning.oversized-description",
    category: "poisoning",
    subject: "server",
    severity: "warning",
    title: "Oversized tool description",
    rationale:
      "The description is long enough to hide a second instruction set or an embedded protocol in plain sight, and it costs that context on every single call. Read it end to end, then ask the vendor to trim it.",
  },
  "annotation.destructive-unmarked": {
    id: "annotation.destructive-unmarked",
    category: "annotation",
    subject: "server",
    severity: "warning",
    title: "Destructive tool not marked",
    rationale:
      "The tool reads as deleting or overwriting something but carries no destructiveHint, so a host that confirms destructive calls will not confirm this one. Set the hint, or rename the tool if it is not actually destructive.",
  },
  "annotation.readonly-contradiction": {
    id: "annotation.readonly-contradiction",
    category: "annotation",
    subject: "server",
    severity: "error",
    title: "readOnlyHint contradicts the tool",
    rationale:
      "The tool claims readOnlyHint: true while its name or description describes a mutation. A host that skips approval for read-only tools will run this one unattended, which makes the wrong hint worse than no hint at all.",
  },
  "annotation.open-world-unmarked": {
    id: "annotation.open-world-unmarked",
    category: "annotation",
    subject: "server",
    severity: "info",
    title: "Open-world tool not marked",
    rationale:
      "The tool appears to reach the network or an external system without declaring openWorldHint, so a host cannot tell you its result came from outside your control. Adding the hint costs nothing and changes no behaviour.",
  },
  "schema.secret-shaped-parameter": {
    id: "schema.secret-shaped-parameter",
    category: "schema",
    subject: "server",
    severity: "warning",
    title: "Credential-shaped parameter",
    rationale:
      "A free-text parameter is named like a credential, which invites the model to put a real secret into a tool argument that then gets logged, metered and replayed. Have the server read that credential from its own configuration instead.",
  },
  "schema.undescribed-parameter": {
    id: "schema.undescribed-parameter",
    category: "schema",
    subject: "server",
    severity: "info",
    title: "Parameter has no description",
    rationale:
      "The parameter carries no description, so the model has to guess what belongs in it from the name alone. That is a correctness problem before it is a cost problem: guessed arguments mean failed calls and retries.",
  },
  "schema.unconstrained-additional-properties": {
    id: "schema.unconstrained-additional-properties",
    category: "schema",
    subject: "server",
    severity: "info",
    title: "Unconstrained object schema",
    rationale:
      "The object schema neither forbids additional properties nor constrains them, so the model may invent fields the server silently accepts or silently drops. Setting additionalProperties: false makes the contract checkable.",
  },
  "oauth.broad-scope": {
    id: "oauth.broad-scope",
    category: "oauth",
    subject: "server",
    severity: "warning",
    title: "Broad OAuth scope",
    rationale:
      "The stored OAuth grant asks for a wildcard or whole-account scope on a server used for one job. If that server is compromised the blast radius is everything the scope reaches — request the narrowest scope that still works.",
  },

  // ── The seven skill rules (WP 1.3) ──────────────────────────────────────────────────────────
  //
  // Added, never re-pointed: every id above keeps its exact meaning, so `SECURITY_ANALYZER_VERSION`
  // stays 1 and no report that exists today changes (D-SP2).
  //
  // The severities are chosen against the same "severity inflation is a defect" line the server rules
  // were: only the three checks that mean *this skill is steering the model behind your back* are
  // `error`. Shipping scripts and linking out are `info`, because honest skills do both all day —
  // a skill registry whose loudest signal fires on every normal skill is a registry nobody reads.

  "skill-surface.injection-phrasing": {
    id: "skill-surface.injection-phrasing",
    category: "skill-surface",
    subject: "skill",
    severity: "error",
    title: "Injection phrasing in SKILL.md",
    rationale:
      "The skill body tells the model to override its own instructions or to keep something from you. SKILL.md is loaded verbatim into context every time this skill is attached, so this steers every run that uses it — treat it as hostile until the author explains it.",
  },
  "skill-surface.hidden-instructions": {
    id: "skill-surface.hidden-instructions",
    category: "skill-surface",
    subject: "skill",
    severity: "error",
    title: "Hidden instruction block in SKILL.md",
    rationale:
      "The skill body carries a block addressed to the model rather than to you — a pseudo-tag, or a comment that renders as nothing while the model still reads it. Anything you do not see in the rendered skill but the model does is a channel for instructions you never approved.",
  },
  "skill-surface.invisible-unicode": {
    id: "skill-surface.invisible-unicode",
    category: "skill-surface",
    subject: "skill",
    severity: "error",
    title: "Invisible characters in the skill",
    rationale:
      "Zero-width, bidi-control or private-use characters sit in the skill body, its frontmatter or a file path, where they are invisible to you and meaningful to the model. Skill text that a human wrote has no legitimate reason to carry them.",
  },
  "skill-surface.credential-in-body": {
    id: "skill-surface.credential-in-body",
    category: "skill-surface",
    subject: "skill",
    severity: "warning",
    title: "Credential-shaped value in SKILL.md",
    rationale:
      "The skill body contains a run of text shaped like a real API key or token. Skill content is stored, versioned, exported and read into model context, so a secret pasted into it has already travelled further than you meant — rotate it and read the value from configuration instead.",
  },
  "skill-surface.broad-allowed-tools": {
    id: "skill-surface.broad-allowed-tools",
    category: "skill-surface",
    subject: "skill",
    severity: "warning",
    title: "Broad allowed-tools grant",
    rationale:
      "The frontmatter grants this skill a wildcard or an unrestricted command executor, so attaching it hands the model every tool rather than the few the skill needs. Narrow the grant to the specific tools and command prefixes the instructions actually use.",
  },
  "skill-surface.executable-scripts": {
    id: "skill-surface.executable-scripts",
    category: "skill-surface",
    subject: "skill",
    severity: "info",
    title: "Skill ships executable scripts",
    rationale:
      "The version contains script files. This app never runs them — it stores and meters skill content — but an agent host that does will execute whatever they contain, so read them before you attach this skill anywhere that can.",
  },
  "skill-surface.network-reference": {
    id: "skill-surface.network-reference",
    category: "skill-surface",
    subject: "skill",
    severity: "info",
    title: "SKILL.md references the network",
    rationale:
      "The skill body contains an absolute http(s) URL, which is a hint that following the instructions reaches outside your control. This is a lexical scan of the prose and not a taint analysis, so treat it as a place to look rather than as proof of a network call.",
  },
} as const satisfies Record<string, SecurityRule>;

export type SecurityRuleId = keyof typeof SECURITY_RULES;

/** Declaration order, which is stable for string keys and therefore safe to depend on. */
export const SECURITY_RULE_IDS = Object.keys(SECURITY_RULES) as SecurityRuleId[];

// ── The finding + report shapes ─────────────────────────────────────────────────────────────────

/**
 * WHERE in the subject the finding lives. `server` is the subject itself (an OAuth-scope finding
 * belongs to the server, not to any one tool).
 *
 * `path` is always RELATIVE — to the skill version's own tree. D-SP4: a finding never carries an
 * absolute local path, because a report is exported, pasted into a PR comment and read by people who
 * have no business knowing the container's directory layout.
 */
export type SecurityFindingAnchor =
  | { kind: "server" }
  /**
   * D-SP12 — the SKILL VERSION as a whole, for a finding that is about the version rather than about
   * one file in it: it ships scripts, its frontmatter grants broad tool access. It gets its own kind
   * instead of borrowing `server` because reusing that one would print the word *server* on a skill
   * finding in every UI, every export and every CI comment, for the sake of not adding four lines.
   */
  | { kind: "skill" }
  | { kind: "tool"; toolName: string }
  | { kind: "parameter"; toolName: string; parameterPath: string }
  | { kind: "file"; path: string };

/** The matched text, already redacted and capped (D-SP4). Never constructed by hand. */
export type SecurityEvidence = {
  /** The excerpt, after {@link redactSecurityEvidence}. */
  excerpt: string;
  /** Character offset of the match within the source text, when the rule knows it. */
  offset?: number;
  /** True when the excerpt was truncated at {@link SECURITY_EVIDENCE_MAX_CHARS}. */
  truncated: boolean;
};

export type SecurityFinding = {
  ruleId: SecurityRuleId;
  /** Always `SECURITY_RULES[ruleId].severity` (D-SP5). Echoed so a consumer need not join. */
  severity: SecuritySeverity;
  anchor: SecurityFindingAnchor;
  /** One operator sentence naming what was found where. Never a stack trace, never a raw payload. */
  message: string;
  evidence?: SecurityEvidence;
};

export type SecurityScore = {
  /** 0–100, integer, floored at 0. */
  value: number;
  band: SecurityScoreBand;
  /** Echoed so a stored score is never re-banded by a later build's thresholds. */
  analyzerVersion: number;
};

/** Enough to identify what was analysed and reproduce it; never enough to leak anything. */
export type SecuritySubjectRef = {
  kind: SecuritySubjectKind;
  /** The scan id (server) or the skill-version id (skill) the report was computed from. */
  id: string;
  /** The owning entity: the server id, or the skill id. */
  ownerId: string;
  /** Display name of the owning entity. Not a path, not a URL, not a command line. */
  name: string;
  /** When the analysed artefact was produced (scan `scannedAt` / skill version `createdAt`). */
  capturedAt: string;
};

export type SecurityReport = {
  analyzerVersion: number;
  /** ISO 8601 instant the analyzer produced this. */
  generatedAt: string;
  subject: SecuritySubjectRef;
  /** Emitted in {@link compareSecurityFindings} order, and capped by {@link capSecurityFindings}. */
  findings: SecurityFinding[];
  /**
   * The counts of **ALL** findings the analyzer produced — including any that
   * {@link capSecurityFindings} dropped from `findings`. This split is deliberate and load-bearing:
   * a gate that reads `counts.error` must never be fooled into passing by display truncation. If you
   * ever find yourself computing a count from `findings.length`, that is the bug.
   */
  counts: { error: number; warning: number; info: number; total: number };
  score: SecurityScore;
  /** True when {@link capSecurityFindings} dropped rows; `counts` still reflects ALL findings. */
  truncated: boolean;
};

// ── Constants the pure functions apply ──────────────────────────────────────────────────────────

/** How much of a matched span an excerpt may carry before it is truncated (D-SP4). */
export const SECURITY_EVIDENCE_MAX_CHARS = 200;

/** How many findings a report may LIST. Its `counts` always describe all of them (D-SP4/A7). */
export const SECURITY_FINDING_LIMIT = 200;

/** What one masked credential-shaped run is replaced with. Not a real character class, on purpose. */
export const SECURITY_REDACTION_MARKER = "«redacted»";

/**
 * WP 1.2 · rule 4 (`poisoning.oversized-description`) — how long a tool description may be before it
 * is reported. 2,000 characters is deliberately generous: it is long enough that no honest tool
 * description reaches it (the largest in the servers this app has scanned sit in the low hundreds),
 * and short enough that a second instruction set embedded under a plausible first paragraph does.
 *
 * It lives in the contract rather than in `apps/api` for the same reason the score does: the Security
 * tab (WP 2.1) has to tell an operator what the threshold WAS, and a UI that re-types the number is a
 * UI that eventually disagrees with the analyzer.
 */
export const SECURITY_MAX_DESCRIPTION_CHARS = 2000;

/**
 * WP 1.2 — how many findings ONE rule may emit for ONE tool before it stops and says how many more it
 * saw. It bounds the per-parameter rules (`schema.undescribed-parameter` above all), so a single
 * sixty-parameter tool cannot drown every other finding in the report.
 *
 * This is a RULE-level bound and is not {@link SECURITY_FINDING_LIMIT}, which bounds the finished
 * report's list. The difference matters for {@link SecurityReport.counts}: findings this bound
 * suppresses were never produced, so the counts do not include them (and the message says so),
 * whereas findings {@link capSecurityFindings} drops WERE produced and the counts still do.
 */
export const SECURITY_MAX_FINDINGS_PER_TOOL = 10;

/**
 * D-SP3 — the documented weights, deducted from 100. They live beside
 * {@link computeSecurityScore}, which is the only function permitted to apply them.
 */
export const SECURITY_SEVERITY_DEDUCTION: Record<SecuritySeverity, number> = {
  error: 15,
  warning: 5,
  info: 1,
};

// ── D-SP3 · the score ───────────────────────────────────────────────────────────────────────────

/**
 * The ONE place a posture score is computed. Sum the per-severity deductions, subtract from 100,
 * floor at 0 (a server with eight `error` findings is not "-20 secure"), then band it.
 *
 * Bands break at exactly 100 / 90 / 70: `clean` means literally nothing was found, so a single `info`
 * drops out of it — that is the point, an operator should be able to trust `clean`.
 *
 * The returned {@link SecurityScore.analyzerVersion} echoes {@link SECURITY_ANALYZER_VERSION} so a
 * stored score can never be silently compared against, or re-banded by, a later build's thresholds.
 */
export function computeSecurityScore(findings: readonly SecurityFinding[]): SecurityScore {
  let deduction = 0;
  for (const finding of findings) {
    deduction += SECURITY_SEVERITY_DEDUCTION[finding.severity];
  }
  const value = Math.max(0, 100 - deduction);
  let band: SecurityScoreBand;
  if (value >= 100) {
    band = "clean";
  } else if (value >= 90) {
    band = "low";
  } else if (value >= 70) {
    band = "medium";
  } else {
    band = "high";
  }
  return { value, band, analyzerVersion: SECURITY_ANALYZER_VERSION };
}

// ── D-SP6 · the one total order ─────────────────────────────────────────────────────────────────

/** Worst first. Deliberately the same order as {@link SECURITY_SEVERITIES}. */
const SEVERITY_RANK: Record<SecuritySeverity, number> = { error: 0, warning: 1, info: 2 };

/**
 * Broadest anchor first, so a server-wide finding sorts above the tools it is about.
 *
 * D-SP12 — `skill` ranks **last** rather than beside `server`, which it resembles. That is deliberate:
 * appending a rank leaves every existing pair's relative order byte-identical, whereas inserting one
 * at rank 1 would renumber `tool`/`parameter`/`file` and silently reorder every report that already
 * exists. A subject-level skill finding still sorts above nothing it needs to outrank, because a skill
 * report's other anchors are all `file` and severity + `ruleId` are compared long before the kind is.
 */
const ANCHOR_KIND_RANK: Record<SecurityFindingAnchor["kind"], number> = {
  server: 0,
  tool: 1,
  parameter: 2,
  file: 3,
  skill: 4,
};

/**
 * Deterministic UTF-16 code-unit comparison. **Not** `localeCompare`: that is locale- and
 * ICU-dependent, so two machines could order the same report differently — exactly what D-SP6
 * forbids.
 */
function compareStrings(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/** The anchor's name components, in significance order. Same `kind` ⇒ same number of components. */
function anchorNameParts(anchor: SecurityFindingAnchor): readonly string[] {
  switch (anchor.kind) {
    case "server":
      return [];
    // D-SP12 — like `server`, the subject itself: it names no component, so its key is its kind alone.
    case "skill":
      return [];
    case "tool":
      return [anchor.toolName];
    case "parameter":
      return [anchor.toolName, anchor.parameterPath];
    case "file":
      return [anchor.path];
  }
}

/**
 * D-SP6 — the ONE total order a report's findings are emitted in: severity descending, then `ruleId`,
 * then anchor kind, then anchor name, then the evidence excerpt.
 *
 * Those five are the contract. The three comparisons after them are residual tie-breakers, and they
 * are not decoration: `Array.prototype.sort` is only *documented* as stable, and two findings that
 * differ solely in their offset or their message must still land in a fixed order or the serialized
 * report stops being byte-identical for the same input. So the rule is stricter than "sorted": no
 * pair may compare 0 unless every component is equal.
 */
export function compareSecurityFindings(a: SecurityFinding, b: SecurityFinding): number {
  const bySeverity = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
  if (bySeverity !== 0) return bySeverity;

  const byRule = compareStrings(a.ruleId, b.ruleId);
  if (byRule !== 0) return byRule;

  const byAnchorKind = ANCHOR_KIND_RANK[a.anchor.kind] - ANCHOR_KIND_RANK[b.anchor.kind];
  if (byAnchorKind !== 0) return byAnchorKind;

  // Equal kinds, so the two part lists have the same length and compare like with like.
  const aParts = anchorNameParts(a.anchor);
  const bParts = anchorNameParts(b.anchor);
  for (let index = 0; index < aParts.length; index += 1) {
    const byPart = compareStrings(aParts[index] ?? "", bParts[index] ?? "");
    if (byPart !== 0) return byPart;
  }

  const byExcerpt = compareStrings(a.evidence?.excerpt ?? "", b.evidence?.excerpt ?? "");
  if (byExcerpt !== 0) return byExcerpt;

  // ── Residual tie-breakers: totality, not ranking ──
  const byEvidencePresence = Number(a.evidence !== undefined) - Number(b.evidence !== undefined);
  if (byEvidencePresence !== 0) return byEvidencePresence;

  // A missing offset sorts before offset 0, which is why the fallback is -1 rather than 0.
  const byOffset = (a.evidence?.offset ?? -1) - (b.evidence?.offset ?? -1);
  if (byOffset !== 0) return byOffset;

  const byTruncated =
    Number(a.evidence?.truncated ?? false) - Number(b.evidence?.truncated ?? false);
  if (byTruncated !== 0) return byTruncated;

  return compareStrings(a.message, b.message);
}

// ── Finding IDENTITY — "is this the same finding?" (planning/Roadmap/RM-08-ci/ WP 3.1, D-C20) ──────────────────
//
// Ordering answers "which finding comes first"; identity answers "is this the SAME finding as that
// one". They are different questions and they must not be conflated: the sort is a total order over
// every field (so a report serializes byte-identically), whereas identity is deliberately COARSER.
//
// It lives here, in the contract, because more than one consumer needs one answer: CI's
// `no-new-security-findings` gate (planning/Roadmap/RM-08-ci/ WP 3.1) asks "was this finding already in the
// baseline?", and the posture diff (WP 1.4) asks "which findings are new / resolved / unchanged?".
// Two implementations of "the same finding" is exactly how a diff and a gate end up disagreeing in
// front of an operator, with no way to tell which one is lying.

/**
 * The anchor half of a finding's identity: its kind plus its name components, each percent-encoded
 * so the join is unambiguous.
 *
 * The encoding is not decoration. A tool name comes from an arbitrary third-party MCP server and may
 * contain any character at all, `:` included; without escaping, a `parameter` anchor for tool
 * `a:b` / path `c` and one for tool `a` / path `b:c` would produce the same key and be treated as
 * the same finding. `encodeURIComponent` escapes `:` (to `%3A`) and leaves ordinary identifier
 * characters readable, so the key stays greppable in a CI log while staying injective.
 *
 * Each `kind` has a fixed number of components (see {@link SecurityFindingAnchor}), so the key is
 * total and two anchors of different kinds can never collide.
 */
export function securityFindingAnchorKey(anchor: SecurityFindingAnchor): string {
  const parts = anchorNameParts(anchor).map((part) => encodeURIComponent(part));
  return parts.length === 0 ? anchor.kind : `${anchor.kind}:${parts.join(":")}`;
}

/**
 * **D-C20** — a finding's identity is `ruleId` + anchor, and **nothing else**.
 *
 * Two exclusions, both load-bearing:
 *
 *   • **Evidence is not part of it.** The same rule firing on the same tool with a reworded
 *     description is the SAME finding, not a resolved one plus a new one. A gate that went red
 *     because a vendor rephrased a sentence is a gate that gets switched off inside a week.
 *   • **Severity is not part of it either** — it is a property of the RULE (D-SP5), so it is already
 *     implied by `ruleId` and adding it would only make the key longer.
 *
 * This is sound precisely because **D-SP2 freezes rule ids**: a rule is never renamed and never
 * re-pointed at a different check, so the same id across two releases really does mean the same
 * question was asked. Renaming one would read as a finding resolved plus a finding appearing — the
 * exact false alarm D-SP2 exists to prevent.
 *
 * The `|` separator is safe by the same freeze: a rule id is `category.kebab-slug` and can never
 * contain one, and the anchor half is percent-encoded.
 */
export function securityFindingIdentity(
  finding: Pick<SecurityFinding, "ruleId" | "anchor">,
): string {
  return `${finding.ruleId}|${securityFindingAnchorKey(finding.anchor)}`;
}

// ── D-SP4 · redaction ───────────────────────────────────────────────────────────────────────────

/**
 * The characters an excerpt must never carry through verbatim.
 *
 * A poisoning rule's whole job is to surface characters you cannot see, so printing them raw would
 * hide the very finding being reported — `poisoning.invisible-unicode` would render as a description
 * that looks completely normal. Each one is therefore rewritten to a visible `\uXXXX`.
 *
 * The C0 range deliberately includes tab, CR and LF: an excerpt is one line by construction, and a
 * newline smuggled into a CI log is its own small injection vector.
 */
const INVISIBLE_CODE_POINT_RANGES: readonly (readonly [number, number])[] = [
  [0x0000, 0x001f], // C0 controls, tab/CR/LF included
  [0x007f, 0x007f], // DEL
  [0x200b, 0x200f], // zero-width space/non-joiner/joiner, LRM, RLM
  [0x202a, 0x202e], // bidi embeddings and the RIGHT-TO-LEFT OVERRIDE
  [0x2060, 0x2064], // word joiner and the invisible operators
  [0xfeff, 0xfeff], // BOM / zero-width no-break space
];

/** `0x200b` → `\u200B`. Uppercase hex, four digits: every range above is inside the BMP. */
function toUnicodeEscape(code: number): string {
  return `\\u${code.toString(16).toUpperCase().padStart(4, "0")}`;
}

/**
 * Rewrite every invisible character to its visible `\uXXXX` form.
 *
 * Iterating with `for…of` walks CODE POINTS, so an astral character arrives as one two-unit string
 * whose code point is above the BMP and is therefore never in the ranges — it passes through intact
 * rather than being split into lone surrogates.
 */
function escapeInvisibleCharacters(raw: string): string {
  let escaped = "";
  for (const character of raw) {
    const code = character.codePointAt(0) ?? 0;
    const invisible = INVISIBLE_CODE_POINT_RANGES.some(
      ([low, high]) => code >= low && code <= high,
    );
    escaped += invisible ? toUnicodeEscape(code) : character;
  }
  return escaped;
}

// One character of a credential AS IT LOOKS AFTER ESCAPING: a base64url (or plain alphanumeric)
// character, OR a whole escaped-invisible sequence. That alternative is the reason masking runs
// AFTER escaping and not before — once a zero-width space has become the six visible characters
// `\u200B`, the matcher can swallow it, so a credential with an invisible character injected into
// the middle of it is still masked as one run instead of leaking its two halves.
const BASE64URL_CHARACTER = String.raw`(?:[A-Za-z0-9_-]|\\u[0-9A-F]{4})`;
const ALPHANUMERIC_CHARACTER = String.raw`(?:[A-Za-z0-9]|\\u[0-9A-F]{4})`;

/**
 * **D-SP13 — the credential shapes precise enough to REPORT.** Each one is anchored on a vendor
 * prefix nothing else produces, so a match is a credential and not a coincidence.
 *
 * What this list deliberately does NOT contain is the catch-all
 * {@link CREDENTIAL_PATTERNS} also masks with — a bare base64url run of 32 or more. That absence is
 * the whole point of the split. A SKILL.md routinely carries a 40-character commit sha, a long slug
 * or a long snake_case tool name, and a RULE that fired on those would be the false-positive machine
 * the plan's README forbids. Over-masking is the right error for redaction and the wrong one for a
 * finding: an over-masked identifier costs an operator one question, a finding that cries wolf costs
 * them the whole report.
 *
 * The escaped-invisible alternative inside {@link BASE64URL_CHARACTER} is inert on the raw text
 * {@link findPrefixedCredential} reads (nothing has been escaped yet) and load-bearing on the escaped
 * text {@link redactSecurityEvidence} reads. One list, two readers, no second definition.
 */
export const SECURITY_CREDENTIAL_PREFIX_PATTERNS: readonly RegExp[] = [
  new RegExp(`mcpfp_${BASE64URL_CHARACTER}{20,}`, "g"),
  new RegExp(`sk-${BASE64URL_CHARACTER}{16,}`, "g"),
  new RegExp(`gh[pousr]_${ALPHANUMERIC_CHARACTER}{20,}`, "g"),
];

/**
 * Credential shapes, most specific first: the prefixed shapes above, then the catch-all — a bare
 * base64url run long enough that no prose produces it by accident. It over-masks the occasional long
 * opaque id, which is the correct trade — an over-masked identifier costs an operator one question,
 * a leaked token costs them a rotation.
 *
 * Built FROM {@link SECURITY_CREDENTIAL_PREFIX_PATTERNS} rather than re-typed beside it, so each
 * prefix shape has exactly one definition (D-SP13). Same shapes, same order, same behaviour as before
 * the split: {@link redactSecurityEvidence}'s output is unchanged for every input.
 */
const CREDENTIAL_PATTERNS: readonly RegExp[] = [
  ...SECURITY_CREDENTIAL_PREFIX_PATTERNS,
  new RegExp(`${BASE64URL_CHARACTER}{32,}`, "g"),
];

/**
 * The first prefixed credential-shaped run in `text`, or `null` — the REPORTING half of D-SP13.
 *
 * "First" is by position, with the declaration order of {@link SECURITY_CREDENTIAL_PREFIX_PATTERNS}
 * breaking a tie, so the answer is total and a report stays byte-stable (D-SP6).
 *
 * The returned `match` is the credential IN CLEAR. A caller never prints it: it goes to
 * {@link createSecurityFinding} as `{ raw }`, which forces it through {@link redactSecurityEvidence}
 * and it comes out as {@link SECURITY_REDACTION_MARKER}. The finding then proves a credential is
 * there without republishing it.
 */
export function findPrefixedCredential(text: string): { match: string; offset: number } | null {
  let best: { match: string; offset: number } | null = null;
  for (const pattern of SECURITY_CREDENTIAL_PREFIX_PATTERNS) {
    // A fresh, NON-global copy per call. `exec` on a `g`-flagged regex advances the regex's own
    // `lastIndex`, and these constants are shared with `redactSecurityEvidence` — a matcher that
    // carries state between calls is a matcher whose answer depends on what ran before it, which is
    // exactly what D-SP6 forbids.
    const match = new RegExp(pattern.source).exec(text);
    if (match === null) continue;
    if (best === null || match.index < best.offset) {
      best = { match: match[0], offset: match.index };
    }
  }
  return best;
}

/**
 * D-SP4 — turn a raw matched span into the only evidence shape a finding may carry: invisibles
 * escaped so they are visible, credential-shaped runs masked, the whole thing truncated to
 * {@link SECURITY_EVIDENCE_MAX_CHARS}.
 *
 * The order is escape → mask → truncate, and each step depends on the one before it. Escaping first
 * lets the masker see an injected invisible instead of being split by it; masking before truncating
 * means a credential can never be cut down to a sub-threshold prefix that no pattern matches any
 * more and then printed.
 */
export function redactSecurityEvidence(raw: string, offset?: number): SecurityEvidence {
  const escaped = escapeInvisibleCharacters(raw);
  let masked = escaped;
  for (const pattern of CREDENTIAL_PATTERNS) {
    masked = masked.replace(pattern, SECURITY_REDACTION_MARKER);
  }

  const truncated = masked.length > SECURITY_EVIDENCE_MAX_CHARS;
  let excerpt = masked;
  if (truncated) {
    // Never cut between a surrogate pair — a lone surrogate is not valid text to put on a wire.
    let cut = SECURITY_EVIDENCE_MAX_CHARS;
    const lastCode = masked.charCodeAt(cut - 1);
    if (lastCode >= 0xd800 && lastCode <= 0xdbff) cut -= 1;
    excerpt = `${masked.slice(0, cut)}…`;
  }

  return offset === undefined ? { excerpt, truncated } : { excerpt, offset, truncated };
}

// ── Bounding and construction ───────────────────────────────────────────────────────────────────

/**
 * Bound a report's finding LIST at {@link SECURITY_FINDING_LIMIT}. The caller keeps the true counts:
 * {@link SecurityReport.counts} always describes every finding the analyzer produced, so a CI gate
 * reading `counts.error` cannot be fooled into passing by a list that was shortened for display.
 */
export function capSecurityFindings(findings: readonly SecurityFinding[]): {
  findings: SecurityFinding[];
  truncated: boolean;
} {
  if (findings.length > SECURITY_FINDING_LIMIT) {
    return { findings: findings.slice(0, SECURITY_FINDING_LIMIT), truncated: true };
  }
  return { findings: [...findings], truncated: false };
}

/**
 * D-SP5 — the only sanctioned way to build a {@link SecurityFinding}.
 *
 * There is no `severity` parameter: it is read from {@link SECURITY_RULES}, so a rule's severity is
 * a property of the RULE and never of one instance. And `evidence` is taken as `{ raw }` rather than
 * as a finished {@link SecurityEvidence}, so every excerpt is forced through
 * {@link redactSecurityEvidence} — D-SP4 "by construction, not by convention" is this signature.
 */
export function createSecurityFinding(input: {
  ruleId: SecurityRuleId;
  anchor: SecurityFindingAnchor;
  message: string;
  evidence?: { raw: string; offset?: number };
}): SecurityFinding {
  const severity: SecuritySeverity = SECURITY_RULES[input.ruleId].severity;
  const base = {
    ruleId: input.ruleId,
    severity,
    anchor: input.anchor,
    message: input.message,
  };
  if (input.evidence === undefined) return base;
  return { ...base, evidence: redactSecurityEvidence(input.evidence.raw, input.evidence.offset) };
}

// ── WP 1.4 · the posture DIFF ───────────────────────────────────────────────────────────────────
//
// Ordering answers "which finding comes first". Identity answers "is this the SAME finding". This
// third section answers the question an operator actually asks between two releases — **what
// changed?** — and it answers it in exactly one place, for the same reason the score and the order
// live in exactly one place (D-SP1).
//
// There is a concrete boundary this protects. `planning/Roadmap/RM-08-ci/` WP 3.1's `no-new-security-findings`
// gate did this set arithmetic inline, and WP 2.1's Security tab needs the same three buckets. Two
// implementations of "what changed" is how a CI gate and a UI end up telling an operator different
// stories about the same pair of scans, with no way to tell which one is lying — the failure D-C20
// and D-SP2 were both written to prevent.
//
// Like everything else in this module it is PURE, and — the part that is easy to get wrong — it is
// **clock-free**. A diff's `generatedAt` is derived from the two reports it was handed, never read
// from a clock: the reports are the measurements, the diff is arithmetic over them, and arithmetic
// that stamps itself with the current time is arithmetic nobody can reproduce.

/**
 * The per-severity tally a report carries, reused verbatim by each of the diff's three buckets.
 *
 * Derived from {@link SecurityReport} rather than re-declared, so "the shape of a count" keeps one
 * definition and a field added to one can never go missing from the other.
 */
export type SecurityFindingCounts = SecurityReport["counts"];

/**
 * What changed between two posture reports of the **same subject** — two scans of one server, or two
 * versions of one skill.
 *
 * The three buckets partition the two reports' findings by {@link securityFindingIdentity}:
 *
 *   • `added` — in the subject, not in the baseline. The plan's "new". It is named `added` because
 *     `new` is a reserved word and `diff.new` reads like a constructor at every call site.
 *   • `resolved` — in the baseline, not in the subject.
 *   • `unchanged` — in both, carried as the **subject's** instance, because its evidence is the text
 *     that is live today: a vendor who reworded a poisoned description while leaving it poisoned
 *     should be shown this release's wording, not last release's.
 *
 * Two invariants follow, and both are pinned by tests:
 * `added.length + unchanged.length === subject.findings.length`, and
 * `resolved.length + (baseline findings the subject still carries) === baseline.findings.length`.
 */
export type SecurityPostureDiff = {
  /** Both reports' version, which {@link diffSecurityReports} has already proven equal. */
  analyzerVersion: number;
  /**
   * The LATER of the two reports' `generatedAt`, so a diff is dated by its freshest input. Never a
   * clock read — see the section note above.
   */
  generatedAt: string;
  /** What the subject was measured against. */
  baseline: SecuritySubjectRef;
  /** What was measured. */
  subject: SecuritySubjectRef;
  /** In the SUBJECT report's {@link compareSecurityFindings} order. */
  added: SecurityFinding[];
  /** In the BASELINE report's {@link compareSecurityFindings} order. */
  resolved: SecurityFinding[];
  /** In the SUBJECT report's {@link compareSecurityFindings} order. */
  unchanged: SecurityFinding[];
  counts: {
    added: SecurityFindingCounts;
    resolved: SecurityFindingCounts;
    unchanged: SecurityFindingCounts;
  };
  score: {
    baseline: SecurityScore;
    subject: SecurityScore;
    /**
     * `subject.value − baseline.value`. **Positive means the posture improved**, which is the
     * direction an operator reads a score in ("we went up four points"), not the direction a
     * deduction moves. Both sides are echoed from the reports; no weight and no band is re-applied
     * here (D-SP3 — {@link computeSecurityScore} is the only function permitted to do that).
     */
    delta: number;
  };
};

/** Tally one bucket. Local: a diff's counts are its own and are never read off a report. */
function countFindings(findings: readonly SecurityFinding[]): SecurityFindingCounts {
  const counts: SecurityFindingCounts = { error: 0, warning: 0, info: 0, total: findings.length };
  for (const finding of findings) counts[finding.severity] += 1;
  return counts;
}

/** ISO-8601 out of `toISOString()` is fixed-width UTC, so lexicographic order IS chronological. */
function laterInstant(a: string, b: string): string {
  return a > b ? a : b;
}

/**
 * The ONE posture differ: two reports in, `added` / `resolved` / `unchanged` out.
 *
 * **Four refusals, and not one of them is a quiet zero.** Each is a comparison that cannot mean what
 * its reader will assume it means, and the point of this workstream is that a posture answer is
 * either trustworthy or absent — never confidently wrong (D-SP10, D-SP16, D-C8 and D-C22 are the
 * same instinct applied to four other inputs):
 *
 *   1. **Different subject KINDS.** A server report against a skill report share no anchor space, so
 *      every finding would read as added and every finding as resolved.
 *   2. **Different OWNERS.** Two scans of two different servers produce a diff in which the entire
 *      tool surface changed — a real answer to a question nobody asked. A posture diff is
 *      scan↔scan of one server, or version↔version of one skill.
 *   3. **Different ANALYZER VERSIONS.** Exactly D-C22: findings produced under different versions
 *      are not on the same scale, because a rule's meaning may have changed underneath the
 *      comparison. `SECURITY_ANALYZER_VERSION` exists so that is detectable rather than silent.
 *   4. **A TRUNCATED report on either side.** {@link capSecurityFindings} may have shortened a
 *      report's LIST while its `counts` kept the true totals. Diffing the listed rows would answer
 *      "what changed among the ones we happened to list", which is not the question; falling back to
 *      the counts would be the count comparison {@link securityFindingIdentity} explains is unsound.
 *
 * It throws a plain `Error`, never an HTTP one: this module has no idea it is behind a web server
 * (D-SP1 — its only import is `zod`). A caller that serves HTTP guards these four cases first and
 * translates them into a **400** in its own words; the throws here are the backstop for the caller
 * that forgets, and the reason a wrong pairing can never quietly produce a plausible-looking diff.
 *
 * Diffing a report against ITSELF is deliberately legal — everything lands in `unchanged`, `delta`
 * is 0, and it is the cheapest available proof that the identity function is total.
 */
export function diffSecurityReports(
  baseline: SecurityReport,
  subject: SecurityReport,
): SecurityPostureDiff {
  if (baseline.subject.kind !== subject.subject.kind) {
    throw new Error(
      `Cannot diff security posture: the baseline is a "${baseline.subject.kind}" report and the subject a "${subject.subject.kind}" report. ` +
        "A posture diff compares two scans of one server, or two versions of one skill.",
    );
  }
  if (baseline.subject.ownerId !== subject.subject.ownerId) {
    throw new Error(
      `Cannot diff security posture: the baseline belongs to "${baseline.subject.ownerId}" and the subject to "${subject.subject.ownerId}". ` +
        "A posture diff compares two scans of ONE server, or two versions of ONE skill.",
    );
  }
  if (baseline.analyzerVersion !== subject.analyzerVersion) {
    throw new Error(
      `Cannot diff security posture: the baseline was analysed by security analyzer version ${baseline.analyzerVersion}, ` +
        `and the subject by version ${subject.analyzerVersion}. ` +
        "Findings produced under different analyzer versions are not on the same scale, so a rule's meaning may have changed underneath the comparison.",
    );
  }
  if (baseline.truncated || subject.truncated) {
    const sides = [
      ...(baseline.truncated ? ["the baseline"] : []),
      ...(subject.truncated ? ["the subject"] : []),
    ];
    throw new Error(
      `Cannot diff security posture: ${sides.join(" and ")} produced more than ${SECURITY_FINDING_LIMIT} findings, ` +
        `so the report lists only the first ${SECURITY_FINDING_LIMIT} of them ` +
        `(baseline ${baseline.counts.total}, subject ${subject.counts.total} in total). ` +
        'Diffing a truncated list would answer "what changed among the ones we listed", which is not a verdict.',
    );
  }

  // Set membership by (ruleId, anchor) — never a count, and never the evidence text. A rule that
  // fires on the same tool with a reworded description is the SAME finding; see
  // `securityFindingIdentity` above for why both of those exclusions are load-bearing.
  const baselineIdentities = new Set(baseline.findings.map(securityFindingIdentity));
  const subjectIdentities = new Set(subject.findings.map(securityFindingIdentity));

  // One pass over the subject in its own emit order, so `added` and `unchanged` inherit
  // `compareSecurityFindings` for free and the diff is byte-stable for the same pair (D-SP6).
  const added: SecurityFinding[] = [];
  const unchanged: SecurityFinding[] = [];
  for (const finding of subject.findings) {
    if (baselineIdentities.has(securityFindingIdentity(finding))) unchanged.push(finding);
    else added.push(finding);
  }
  const resolved = baseline.findings.filter(
    (finding) => !subjectIdentities.has(securityFindingIdentity(finding)),
  );

  return {
    analyzerVersion: subject.analyzerVersion,
    generatedAt: laterInstant(baseline.generatedAt, subject.generatedAt),
    baseline: baseline.subject,
    subject: subject.subject,
    added,
    resolved,
    unchanged,
    counts: {
      added: countFindings(added),
      resolved: countFindings(resolved),
      unchanged: countFindings(unchanged),
    },
    score: {
      baseline: baseline.score,
      subject: subject.score,
      delta: subject.score.value - baseline.score.value,
    },
  };
}

// ── The wire schemas ────────────────────────────────────────────────────────────────────────────
// `.strict()` at every level, for the same reason `ci-assertions.ts` is: a typo'd key must be a loud
// rejection naming the field, never a value that is silently dropped from a report somebody believes
// is protecting them.
//
// D-SP12 — the anchor union's `skill` variant was APPENDED, never inserted: every other variant is
// byte-identical to what WP 1.1 shipped, so no report that validates today stops validating.

export const securitySeveritySchema = z.enum(SECURITY_SEVERITIES);
export const securitySubjectKindSchema = z.enum(SECURITY_SUBJECT_KINDS);
export const securityScoreBandSchema = z.enum(SECURITY_SCORE_BANDS);

/**
 * A rule id validates against the REGISTRY's key set, not against a loose string: a report naming a
 * rule this build does not know about is a report whose findings cannot be rendered or diffed, and
 * saying so at the boundary beats discovering it in a UI (D-SP2).
 *
 * The cast is the standard `z.enum` non-empty-tuple requirement; the registry-integrity test pins
 * that the registry is non-empty, so it cannot become a lie.
 */
export const securityRuleIdSchema = z.enum(
  SECURITY_RULE_IDS as [SecurityRuleId, ...SecurityRuleId[]],
);

export const securityFindingAnchorSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("server") }).strict(),
  z
    .object({ kind: z.literal("skill") })
    .strict(), // D-SP12; see the note above
  z.object({ kind: z.literal("tool"), toolName: z.string().min(1) }).strict(),
  z
    .object({
      kind: z.literal("parameter"),
      toolName: z.string().min(1),
      parameterPath: z.string().min(1),
    })
    .strict(),
  z.object({ kind: z.literal("file"), path: z.string().min(1) }).strict(),
]);

export const securityEvidenceSchema = z
  .object({
    excerpt: z.string(),
    offset: z.number().int().nonnegative().optional(),
    truncated: z.boolean(),
  })
  .strict();

export const securityFindingSchema = z
  .object({
    ruleId: securityRuleIdSchema,
    severity: securitySeveritySchema,
    anchor: securityFindingAnchorSchema,
    message: z.string().min(1),
    evidence: securityEvidenceSchema.optional(),
  })
  .strict();

export const securityScoreSchema = z
  .object({
    value: z.number().int().min(0).max(100),
    band: securityScoreBandSchema,
    analyzerVersion: z.number().int().positive(),
  })
  .strict();

/**
 * WP 1.4 — the per-severity tally, extracted so a report and each of a diff's three buckets validate
 * against ONE definition. The object it replaced in {@link securityReportSchema} was byte-identical,
 * so no payload that validated before validates differently now; the extraction exists only so the
 * two cannot drift the way a second literal eventually does.
 */
export const securityFindingCountsSchema = z
  .object({
    error: z.number().int().nonnegative(),
    warning: z.number().int().nonnegative(),
    info: z.number().int().nonnegative(),
    total: z.number().int().nonnegative(),
  })
  .strict();

export const securitySubjectRefSchema = z
  .object({
    kind: securitySubjectKindSchema,
    id: z.string().min(1),
    ownerId: z.string().min(1),
    name: z.string().min(1),
    capturedAt: z.string().min(1),
  })
  .strict();

export const securityReportSchema = z
  .object({
    analyzerVersion: z.number().int().positive(),
    generatedAt: z.string().min(1),
    subject: securitySubjectRefSchema,
    findings: z.array(securityFindingSchema),
    counts: securityFindingCountsSchema,
    score: securityScoreSchema,
    truncated: z.boolean(),
  })
  .strict();

/**
 * WP 1.4 — the wire shape of {@link diffSecurityReports}' answer.
 *
 * `.strict()` at every level like everything else here, and `delta` is `z.number().int()` **without**
 * a sign bound on purpose: a posture that got worse is a negative delta, and a schema that refused
 * one would refuse exactly the diff an operator most needs to see.
 */
export const securityPostureDiffSchema = z
  .object({
    analyzerVersion: z.number().int().positive(),
    generatedAt: z.string().min(1),
    baseline: securitySubjectRefSchema,
    subject: securitySubjectRefSchema,
    added: z.array(securityFindingSchema),
    resolved: z.array(securityFindingSchema),
    unchanged: z.array(securityFindingSchema),
    counts: z
      .object({
        added: securityFindingCountsSchema,
        resolved: securityFindingCountsSchema,
        unchanged: securityFindingCountsSchema,
      })
      .strict(),
    score: z
      .object({
        baseline: securityScoreSchema,
        subject: securityScoreSchema,
        delta: z.number().int(),
      })
      .strict(),
  })
  .strict();

/**
 * WP 1.4 — the query the two diff endpoints take: `?baseline=<scan id | skill version id>`.
 *
 * The baseline is always **named explicitly**; there is no "previous" shorthand here. Resolving one
 * would mean listing a server's scan history, which is a read the security routes deliberately do not
 * have — and a gate or a UI that silently picked a different baseline between two runs would produce
 * two different diffs for the same question.
 *
 * `.strict()` because this endpoint takes exactly one parameter: `?baseline=…&minSeverity=error` is a
 * caller who believes they applied a severity floor, and being told so beats being quietly ignored.
 */
export const securityDiffQuerySchema = z.object({ baseline: z.string().trim().min(1) }).strict();

// ── WP 2.1 · the FLEET summary (D-SP22) ─────────────────────────────────────────────────────────
//
// One row per server the servers list can badge, so the list makes ONE request for the whole fleet
// rather than one per row — which is what a naive per-row badge would do to a fleet of forty.
//
// It carries the score and the counts and nothing else: the badge shows the band, the score is its
// accessible detail, and anyone who wants the findings drills into `GET /api/scans/:scanId/security`
// with the `scanId` this row already names. Deliberately NOT a `SecurityReport` per server — a list
// endpoint that shipped forty full finding lists to paint forty chips would be the wrong trade.

/**
 * One server's posture, as of its latest **`success`** scan.
 *
 * A server with no usable scan is **omitted** from the response rather than carried with a neutral
 * score: a server nobody has scanned has no posture, and inventing a 100 for it would be the same
 * silent-wrong-answer D-SP10 refuses for a non-`success` scan. The list renders the absence as its
 * own already-existing "not scanned" treatment.
 */
export type SecurityFleetSummary = {
  serverId: string;
  /** The server's CURRENT display name — the same one {@link SecurityReport.subject}`.name` carries. */
  serverName: string;
  /** The scan this posture was computed from; the drill-in target. */
  scanId: string;
  /** When that scan was captured (its `scannedAt`), not when this summary was computed. */
  scannedAt: string;
  score: SecurityScore;
  /** ALL findings, exactly as {@link SecurityReport.counts} — never a `findings.length`. */
  counts: SecurityFindingCounts;
};

/** `.strict()` like every other shape here — see the section note above `securitySeveritySchema`. */
export const securityFleetSummarySchema = z
  .object({
    serverId: z.string().min(1),
    serverName: z.string().min(1),
    scanId: z.string().min(1),
    scannedAt: z.string().min(1),
    score: securityScoreSchema,
    counts: securityFindingCountsSchema,
  })
  .strict();
