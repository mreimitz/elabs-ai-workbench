import { z } from "zod";

// ==================================================================================================
// Security posture contract — the finding/report shapes, the frozen rule-id registry, the score, and
// the one total order a report is emitted in (roadmap/security-posture/, WP 1.1)
// ==================================================================================================
// **This module analyses nothing.** Not one rule is implemented here. It is the declaration that the
// server analyzer (WP 1.2), the skill analyzer (WP 1.3), the posture diff (WP 1.4), the Security tab
// (WP 2.1), the report export (WP 2.2) and CI's `no-new-security-findings` assertion
// (`roadmap/ci/` WP 3.1) all import — so that none of them re-derives a shape, a weight or a sort
// order from prose. The precedent is `ci-assertions.ts` (the CI gate contract, declared once and
// consumed by both the API and the CLI) and `skill-security.ts` (a derivation lifted out of a React
// component so both ends could reach it).
//
// It is PURE. `zod` is its only import: no `node:*`, no filesystem, no network, no database, no
// module-level mutable state. That is exactly what lets the API, the web bundle and the CLI-facing
// report share one copy of it, and it is why the analyzer's I/O lives in `apps/api` instead
// (`.claude/rules/architecture.md` — a wire shape is declared in `packages/shared` first).
//
// Locked decisions this module encodes (roadmap/security-posture/wp-1.1-contract.md):
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

/** What a report is ABOUT. `skill` has no rules yet — WP 1.3 adds them without reshaping this. */
export const SECURITY_SUBJECT_KINDS = ["server", "skill"] as const;
export type SecuritySubjectKind = (typeof SECURITY_SUBJECT_KINDS)[number];

/**
 * The `category` half of every rule id (D-SP2). `skill-surface` is declared but unused until WP 1.3
 * rolls the existing skill security surface into this same shape.
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
 * The eleven server rules WP 1.2 implements. **This WP only declares them** — there is no check
 * behind any of these ids yet, and writing one here would be a scope violation.
 *
 * The severities were chosen against the plan's "severity inflation is a defect" line: only the three
 * checks where a finding means *this server is actively trying to steer a model* are `error`; hygiene
 * a reasonable server may legitimately fail is `info`.
 *
 * No skill rule id is declared. WP 1.3 owns those, and declaring ids nothing implements would leave
 * the registry-integrity test unable to pin them to anything.
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

/** Broadest anchor first, so a server-wide finding sorts above the tools it is about. */
const ANCHOR_KIND_RANK: Record<SecurityFindingAnchor["kind"], number> = {
  server: 0,
  tool: 1,
  parameter: 2,
  file: 3,
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
 * Credential shapes, most specific first. The final entry is the catch-all: a bare base64url run
 * long enough that no prose produces it by accident. It over-masks the occasional long opaque id,
 * which is the correct trade — an over-masked identifier costs an operator one question, a leaked
 * token costs them a rotation.
 */
const CREDENTIAL_PATTERNS: readonly RegExp[] = [
  new RegExp(`mcpfp_${BASE64URL_CHARACTER}{20,}`, "g"),
  new RegExp(`sk-${BASE64URL_CHARACTER}{16,}`, "g"),
  new RegExp(`gh[pousr]_${ALPHANUMERIC_CHARACTER}{20,}`, "g"),
  new RegExp(`${BASE64URL_CHARACTER}{32,}`, "g"),
];

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

// ── The wire schemas ────────────────────────────────────────────────────────────────────────────
// `.strict()` at every level, for the same reason `ci-assertions.ts` is: a typo'd key must be a loud
// rejection naming the field, never a value that is silently dropped from a report somebody believes
// is protecting them.

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
    counts: z
      .object({
        error: z.number().int().nonnegative(),
        warning: z.number().int().nonnegative(),
        info: z.number().int().nonnegative(),
        total: z.number().int().nonnegative(),
      })
      .strict(),
    score: securityScoreSchema,
    truncated: z.boolean(),
  })
  .strict();
