// The skill security analyzer (planning/Roadmap/RM-20-security-posture/, WP 1.3) — the seven `skill-surface.*` rules
// of `SECURITY_RULES` implemented as PURE functions over data the caller already loaded.
//
// It is the sibling of `analyzer.ts` and holds the same five properties, for the same reasons:
//
//   • **D-SP7 — pure.** No database handle, no clock, no network, no filesystem, no module-level
//     mutable state. `service.ts` does the loading, the refusal, the ordering and the score.
//   • **D-SP5 — a rule never chooses a severity.** Every finding goes through
//     `createSecurityFinding`, which reads it out of the registry. There is no severity literal here.
//   • **D-SP4 — a rule never builds evidence.** It hands over `{ raw, offset }` and the contract
//     redacts it: invisibles escaped so they become visible, credential-shaped runs masked to
//     `«redacted»`, truncated at 200 characters.
//   • **D-SP11 — every matcher is a named, exported constant whose comment says what it deliberately
//     does NOT match.** That comment is the false-positive review, written down, and each one has a
//     near-miss fixture in `apps/api/test/security-skill-analyzer.test.ts`.
//   • **A rule that throws must not take the report down.** A skill's frontmatter is parsed from a
//     file a third party wrote, so `manifest.allowedTools` may not be a string and a file node's path
//     may be empty. Every rule call is wrapped; a malformed input costs that rule's findings and
//     nothing else.
//
// **D-SP15 — what this analyzer is allowed to READ, and why the bound is where it is.** It sees the
// version row, the file LIST and the SKILL.md body. It does NOT open the content of every file in the
// tree. A version may hold up to `SKILL_MAX_FILES` (2,000) files and `SKILL_MAX_TOTAL_BYTES` (50 MB),
// so a full-tree content scan would need its own byte budget, its own truncation flag on the report
// and its own honest answer to "the scan stopped early" — a shape change to `SecurityReport` for a
// rule this WP does not have. SKILL.md is the text an agent loads EVERY time the skill is attached,
// which makes it the highest-value surface per byte read. Widening this later is a NEW rule id
// (additive, D-SP2), never a change of meaning for one of these seven.
//
// **It inspects; it never executes.** Skill content is stored, versioned and metered by this app and
// never run (CLAUDE.md § "Skills registry & inspector"). `skill-surface.executable-scripts` reports
// that scripts EXIST — it does not open them, and it certainly does not run them.

import {
  createSecurityFinding,
  deriveSkillSecuritySurface,
  findPrefixedCredential,
  SECURITY_MAX_FINDINGS_PER_TOOL,
  type SecurityFinding,
  type SecurityRuleId,
  type SkillFileNode,
  type SkillVersion,
  securitySignatures,
  skillNetworkRefPattern,
} from "@mcp-token-footprint/shared";
import {
  describeCodePoint,
  evidenceAround,
  findHiddenInstructionBlocks,
  findHtmlComments,
  findInjectionPhrases,
  findInvisible,
  readText,
} from "./text-scan.js";

// ── Input ───────────────────────────────────────────────────────────────────────────────────────

/**
 * What the pure skill analyzer is allowed to see (D-SP15). No repository, no db, no clock, no
 * network.
 */
export type SkillAnalyzerInput = {
  version: SkillVersion;
  files: readonly SkillFileNode[];
  /**
   * The SKILL.md text, and the relative path it lives at. The service refuses the request when it
   * cannot be read (D-SP16), so this is never a silent `""` that would hand a version a near-clean
   * bill of health on the strength of the two rules that happened to still run.
   */
  skillMd: { path: string; body: string };
  /**
   * Called at most once per rule id when a rule throws on a malformed skill. Optional and clock-free
   * so the analyzer stays pure; `routes.ts` supplies a Fastify logger, tests supply a spy.
   */
  onRuleError?: (ruleId: SecurityRuleId, error: unknown) => void;
};

// ── Shared helpers ──────────────────────────────────────────────────────────────────────────────

/**
 * The version's own label, for a message an operator can match against the version list. Defensive
 * for the same reason `analyzer.ts`'s `toolNameOf` is: the row is projected from a database whose
 * contents came from an uploaded zip.
 */
function versionLabelOf(version: SkillVersion): string {
  const label = readText(version.versionLabel).trim();
  return label.length > 0 ? label : "this version";
}

/** A file path safe to put in an anchor: `path` is `min(1)` on the wire, so it can never be empty. */
const UNNAMED_FILE = "(unnamed file)";

function filePathOf(file: SkillFileNode): string {
  const path = readText(file.path).trim();
  return path.length > 0 ? path : UNNAMED_FILE;
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
// S1 — skill-surface.injection-phrasing
// ══════════════════════════════════════════════════════════════════════════════════════════════

/**
 * The SAME phrase list, and the SAME instruction-noun requirement, that `poisoning.injection-phrasing`
 * uses — `INJECTION_PHRASES` in `./text-scan.ts` (D-SP14). So a SKILL.md that honestly says *"the
 * importer will ignore previous drafts"* stays silent here too, exactly as a tool description does.
 *
 * **At most one finding per version.** A hostile SKILL.md is one hostile fact; three `error` findings
 * would move the score −45 for it, which is the severity inflation the README calls a defect. The
 * message says how many further phrases matched, so nothing is hidden.
 */
export function ruleSkillInjectionPhrasing(input: SkillAnalyzerInput): SecurityFinding[] {
  const body = input.skillMd.body;
  const matches = findInjectionPhrases(body);
  const first = matches[0];
  if (first === undefined) return [];

  const others = matches.length - 1;
  const suffix =
    others === 0 ? "" : ` (${others} further phrase${others === 1 ? "" : "s"} also matched)`;
  return [
    createSecurityFinding({
      ruleId: "skill-surface.injection-phrasing",
      anchor: { kind: "file", path: input.skillMd.path },
      message: `${input.skillMd.path} contains injection phrasing ("${first.phrase}") at character ${first.offset}${suffix}. This text is loaded into context every time the skill is attached.`,
      evidence: evidenceAround(body, first.offset, first.match.length),
    }),
  ];
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
// S2 — skill-surface.hidden-instructions
// ══════════════════════════════════════════════════════════════════════════════════════════════

/**
 * A pseudo-tag or an instruction addressed to the model fires directly, exactly as it does for a tool
 * description. An HTML comment fires **only when its INNER TEXT is itself a payload** — injection
 * phrasing, or prose addressed to the model.
 *
 * **A bare HTML comment deliberately does NOT fire, and that is the one intentional divergence from
 * `poisoning.hidden-instructions`.** A SKILL.md is authored Markdown, where `<!-- prettier-ignore -->`,
 * `<!-- markdownlint-disable -->` and table-of-contents markers are ordinary editorial furniture that
 * honest skills carry all day. A tool description is a wire string a server serialized into a JSON
 * payload and has no such reason to carry one — so the same shape means different things in the two
 * places, and pretending otherwise would make this `error` the noisiest rule in the skill report.
 *
 * Every comment in the body is scanned, not just the first: a skill that opens with
 * `<!-- prettier-ignore -->` and hides its payload in the third comment must still be caught.
 *
 * One finding max, for the same reason S1 emits one.
 */
export function ruleSkillHiddenInstructions(input: SkillAnalyzerInput): SecurityFinding[] {
  const body = input.skillMd.body;

  const candidates: { label: string; offset: number; length: number }[] = [];

  // The two shapes that are a payload by their very form.
  for (const block of findHiddenInstructionBlocks(body)) {
    if (block.kind === "html-comment") continue;
    candidates.push({ label: block.label, offset: block.offset, length: block.match.length });
  }

  // …and the third shape, which is only a payload when it CARRIES one.
  for (const comment of findHtmlComments(body)) {
    const carriesPayload =
      findInjectionPhrases(comment.inner).length > 0 ||
      findHiddenInstructionBlocks(comment.inner).some((block) => block.kind === "model-address");
    if (!carriesPayload) continue;
    candidates.push({
      label: "an HTML comment carrying an instruction to the model",
      offset: comment.offset,
      length: comment.match.length,
    });
  }

  if (candidates.length === 0) return [];
  // Earliest first; the label breaks a tie, so the choice is total and the report byte-stable (D-SP6).
  candidates.sort(
    (a, b) => a.offset - b.offset || (a.label < b.label ? -1 : a.label > b.label ? 1 : 0),
  );
  const first = candidates[0];
  if (first === undefined) return [];

  return [
    createSecurityFinding({
      ruleId: "skill-surface.hidden-instructions",
      anchor: { kind: "file", path: input.skillMd.path },
      message: `${input.skillMd.path} carries ${first.label} at character ${first.offset}, which you do not see in the rendered skill but the model does.`,
      evidence: evidenceAround(body, first.offset, first.length),
    }),
  ];
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
// S3 — skill-surface.invisible-unicode
// ══════════════════════════════════════════════════════════════════════════════════════════════

/**
 * The SAME `INVISIBLE_CODE_POINT_RANGES` the server rule uses (`./text-scan.ts`, D-SP14) — which is
 * where the private-use block U+E000–U+F8FF and the TAG block U+E0000–U+E007F already live, so a
 * skill and a server agree on what "invisible" means. An em-dash, a curly quote and an accented
 * letter are all outside those ranges and stay silent here too.
 *
 * Three surfaces, three anchor choices:
 *   • the BODY — anchored to the SKILL.md file, at most one finding;
 *   • the MANIFEST (`name` / `description`) — anchored to the `skill`, because frontmatter is a
 *     property of the version and not of any one file (D-SP12), at most one finding;
 *   • a FILE PATH — anchored to the offending file, bounded below.
 *
 * The evidence is the surrounding text, which `redactSecurityEvidence` renders with the invisibles
 * escaped to a visible `\uXXXX`. That is the entire point of the rule: printing them raw would hide
 * the very thing being reported.
 */
export function ruleSkillInvisibleUnicode(input: SkillAnalyzerInput): SecurityFinding[] {
  const findings: SecurityFinding[] = [];

  const body = input.skillMd.body;
  const inBody = findInvisible(body);
  if (inBody !== null) {
    findings.push(
      createSecurityFinding({
        ruleId: "skill-surface.invisible-unicode",
        anchor: { kind: "file", path: input.skillMd.path },
        message: `${input.skillMd.path} contains the invisible character ${describeCodePoint(inBody.code)} at character ${inBody.index}.`,
        evidence: evidenceAround(body, inBody.index, inBody.length),
      }),
    );
  }

  const manifestName = readText(input.version.manifest?.name);
  const manifestDescription = readText(input.version.manifest?.description);
  const inName = findInvisible(manifestName);
  const inDescription = inName === null ? findInvisible(manifestDescription) : null;
  const manifestHit = inName ?? inDescription;
  if (manifestHit !== null) {
    const source = inName !== null ? manifestName : manifestDescription;
    const where = inName !== null ? "name" : "description";
    findings.push(
      createSecurityFinding({
        ruleId: "skill-surface.invisible-unicode",
        anchor: { kind: "skill" },
        message: `The frontmatter ${where} of ${versionLabelOf(input.version)} contains the invisible character ${describeCodePoint(manifestHit.code)} at character ${manifestHit.index}.`,
        evidence: evidenceAround(source, manifestHit.index, manifestHit.length),
      }),
    );
  }

  const offendingPaths: { path: string; hit: NonNullable<ReturnType<typeof findInvisible>> }[] = [];
  for (const file of input.files) {
    const path = readText(file.path);
    const hit = findInvisible(path);
    if (hit !== null) offendingPaths.push({ path: filePathOf(file), hit });
  }

  // Reusing `SECURITY_MAX_FINDINGS_PER_TOOL` on purpose: it is the contract's per-rule-per-subject
  // bound — "how many findings ONE rule may emit about ONE thing before it stops and says how many
  // more it saw" — and a skill version is that one thing here. A second constant meaning the same
  // number is how two surfaces end up disagreeing about a bound nobody remembers setting twice.
  const shown = offendingPaths.slice(0, SECURITY_MAX_FINDINGS_PER_TOOL);
  const hidden = offendingPaths.length - shown.length;
  shown.forEach((entry, index) => {
    const overflow =
      hidden > 0 && index === shown.length - 1
        ? ` A further ${hidden} file path${hidden === 1 ? "" : "s"} in this version also carry invisible characters and are not listed.`
        : "";
    findings.push(
      createSecurityFinding({
        ruleId: "skill-surface.invisible-unicode",
        anchor: { kind: "file", path: entry.path },
        message: `The file path "${entry.path}" contains the invisible character ${describeCodePoint(entry.hit.code)} at character ${entry.hit.index}.${overflow}`,
        evidence: evidenceAround(entry.path, entry.hit.index, entry.hit.length),
      }),
    );
  });

  return findings;
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
// S4 — skill-surface.credential-in-body
// ══════════════════════════════════════════════════════════════════════════════════════════════

/**
 * `findPrefixedCredential` — the PREFIXED shapes only (`mcpfp_…`, `sk-…`, `gh[pousr]_…`), D-SP13.
 *
 * What it deliberately does NOT match is the catch-all `[A-Za-z0-9_-]{32,}` that
 * `redactSecurityEvidence` also masks with. A SKILL.md routinely contains a 40-character commit sha,
 * a long slug or a long snake_case tool name, and a rule that fired on those would be the
 * false-positive machine the README forbids. Over-masking is the right error for redaction and the
 * wrong one for a finding — so the detector is strictly narrower than the masker, on purpose, and
 * both read one list.
 *
 * The finding proves a credential is there **without republishing it**: the raw match goes to
 * `createSecurityFinding` as `{ raw }`, which masks it to `«redacted»`, and the message names only
 * the file and the offset.
 *
 * One finding max: a body with three pasted keys is one "you pasted secrets in here" fact.
 */
export function ruleSkillCredentialInBody(input: SkillAnalyzerInput): SecurityFinding[] {
  const body = input.skillMd.body;
  const hit = findPrefixedCredential(body);
  if (hit === null) return [];

  return [
    createSecurityFinding({
      ruleId: "skill-surface.credential-in-body",
      anchor: { kind: "file", path: input.skillMd.path },
      message: `${input.skillMd.path} contains a credential-shaped value at character ${hit.offset}. The value is masked in this report, but it is stored in the skill version in clear — rotate it and read it from configuration instead.`,
      evidence: evidenceAround(body, hit.offset, hit.match.length),
    }),
  ];
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
// S5 — skill-surface.broad-allowed-tools
// ══════════════════════════════════════════════════════════════════════════════════════════════

/**
 * Grant tokens that hand a skill more than the few tools it needs.
 *
 * The patterns are pack data (`broadAllowedToolPatterns`), with their false-positive review beside
 * them there. The shape of the review, in one line: every entry is anchored end to end against a
 * single whitespace-separated token and matched case-insensitively, so a NARROWED grant — the good
 * case, the thing we want authors to write — never fires, and neither does a named tool nor a tool
 * whose name merely CONTAINS one of the executor words.
 */
export function isBroadAllowedTool(token: string): boolean {
  return securitySignatures().broadAllowedToolPatterns.some((pattern) => pattern.test(token));
}

/**
 * **`allowedTools` absent ⇒ NO finding.** "We could not tell" is not a finding — the same posture
 * D-SP9 takes for a server with no stored OAuth scope. A skill without an `allowed-tools:` line has
 * told us nothing about its grant, and inventing a finding out of silence is the guess this analyzer
 * never makes.
 *
 * The evidence is the raw `allowed-tools` string, so a reader sees the WHOLE grant and not only the
 * token that tripped the rule — the narrow tools listed beside `*` are part of the picture.
 */
export function ruleSkillBroadAllowedTools(input: SkillAnalyzerInput): SecurityFinding[] {
  const raw = input.version.manifest?.allowedTools;
  // A non-string reaches here when frontmatter parsing produced something odd. That is "we could not
  // tell", not "the grant is broad", so it produces nothing rather than a guess or a throw.
  if (typeof raw !== "string") return [];
  const tokens = raw.split(/\s+/).filter((token) => token.length > 0);
  const broad = tokens.filter((token) => isBroadAllowedTool(token));
  if (broad.length === 0) return [];

  return [
    createSecurityFinding({
      ruleId: "skill-surface.broad-allowed-tools",
      anchor: { kind: "skill" },
      message: `The allowed-tools grant of ${versionLabelOf(input.version)} includes ${broad.length} unrestricted entr${broad.length === 1 ? "y" : "ies"} (${broad.join(", ")}) out of ${tokens.length}, so attaching this skill hands the model more than it needs.`,
      evidence: { raw, offset: 0 },
    }),
  ];
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
// S6 — skill-surface.executable-scripts
// ══════════════════════════════════════════════════════════════════════════════════════════════

/**
 * `deriveSkillSecuritySurface` decides what a script IS — the same derivation the Skills inspector's
 * Overview and the workbench MCP server's `skills_security` tool already show (D-MCP4: one
 * derivation, several surfaces). Re-deriving script classification here is how three surfaces end up
 * disagreeing about a number an operator is reading off all three.
 *
 * **Exactly one finding, never one per script.** Thirty scripts is one fact — "this skill ships
 * executable content" — and thirty `info` findings would cost 30 points for it. The count and the
 * languages go in the message; the paths go in the evidence, which the redactor caps at 200
 * characters.
 *
 * This is `info` on purpose. Honest skills ship scripts all day, and this app never runs them; the
 * finding is a "read these before you attach it somewhere that does", not an accusation.
 */
export function ruleSkillExecutableScripts(input: SkillAnalyzerInput): SecurityFinding[] {
  const surface = deriveSkillSecuritySurface(input.files, input.skillMd.body);
  if (surface.scriptCount === 0) return [];

  const paths = input.files
    .filter((file) => file.kind === "script")
    .map((file) => filePathOf(file));
  const languages =
    surface.scriptLangs.filter((lang) => lang.length > 0).join(", ") || "an unrecognised language";
  return [
    createSecurityFinding({
      ruleId: "skill-surface.executable-scripts",
      anchor: { kind: "skill" },
      message: `${versionLabelOf(input.version)} ships ${surface.scriptCount} script file${surface.scriptCount === 1 ? "" : "s"} (${languages}). This app never runs them, but an agent host that does will execute whatever they contain.`,
      // `listFiles` order, space-joined. Not sorted here: the repository already returns files in
      // `path ASC`, so the order is stable without a second sort claiming to be the source of it.
      evidence: { raw: paths.join(" "), offset: 0 },
    }),
  ];
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
// S7 — skill-surface.network-reference
// ══════════════════════════════════════════════════════════════════════════════════════════════

/**
 * `skillNetworkRefPattern()` — the same accessor `deriveSkillSecuritySurface` computes its
 * `networkRefs` boolean from, so the Skills inspector and this report can never disagree.
 *
 * The pattern is pack data; its false-positive review travels with it there. The scheme is the whole
 * signal.
 *
 * **Deliberately light.** It flags an operator-visible signal — "there is a URL in here, go and read
 * it" — and is not a taint analysis; the rationale in the registry says so, exactly as
 * `skill-security.ts` already does. That is why it is `info` and why it emits one finding rather than
 * one per URL: a skill with twelve documentation links is not twelve times more networked than one
 * with a single link.
 */
export function ruleSkillNetworkReference(input: SkillAnalyzerInput): SecurityFinding[] {
  const body = input.skillMd.body;
  const match = skillNetworkRefPattern().exec(body);
  if (match === null) return [];

  return [
    createSecurityFinding({
      ruleId: "skill-surface.network-reference",
      anchor: { kind: "file", path: input.skillMd.path },
      message: `${input.skillMd.path} references an absolute URL at character ${match.index}. This is a lexical scan of the prose, not proof of a network call — read the surrounding instructions.`,
      evidence: evidenceAround(body, match.index, match[0].length),
    }),
  ];
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
// The aggregator
// ══════════════════════════════════════════════════════════════════════════════════════════════

/** A rule that reads the whole skill version. Every skill rule is one — a skill has no `ToolScan`. */
export type SkillRule = (input: SkillAnalyzerInput) => SecurityFinding[];

/**
 * The seven skill rules, keyed by the frozen rule id they emit (D-SP2). Keying the map by rule id is
 * what lets the acceptance test assert that the set of ids this analyzer can emit is EXACTLY the
 * registry's `subject: "skill"` set — no invented id, none missing.
 */
export const SKILL_RULES = {
  "skill-surface.injection-phrasing": ruleSkillInjectionPhrasing,
  "skill-surface.hidden-instructions": ruleSkillHiddenInstructions,
  "skill-surface.invisible-unicode": ruleSkillInvisibleUnicode,
  "skill-surface.credential-in-body": ruleSkillCredentialInBody,
  "skill-surface.broad-allowed-tools": ruleSkillBroadAllowedTools,
  "skill-surface.executable-scripts": ruleSkillExecutableScripts,
  "skill-surface.network-reference": ruleSkillNetworkReference,
} as const satisfies Partial<Record<SecurityRuleId, SkillRule>>;

/** Every rule id this analyzer can emit — the assertion target of acceptance A1. */
export const SKILL_ANALYZER_RULE_IDS: readonly SecurityRuleId[] = Object.keys(
  SKILL_RULES,
) as SecurityRuleId[];

/**
 * Run one rule and swallow anything it throws.
 *
 * A skill's frontmatter is parsed from a file a third party wrote and persisted as-is, so
 * `manifest.allowedTools` may not be a string, a file node's path may be empty, and a body may be
 * half a megabyte on one line. A rule that throws on one of those must not take the whole report down
 * with it, because the skills most likely to produce a malformed manifest are the skills most worth
 * analysing. The failure is reported through `onRuleError` (at most once per rule id) rather than
 * silently — an analyzer that hides its own blind spot is worse than one that has none.
 */
function runRule(
  ruleId: SecurityRuleId,
  rule: SkillRule,
  input: SkillAnalyzerInput,
  reported: Set<SecurityRuleId>,
): SecurityFinding[] {
  try {
    return rule(input);
  } catch (error) {
    if (!reported.has(ruleId)) {
      reported.add(ruleId);
      input.onRuleError?.(ruleId, error);
    }
    return [];
  }
}

/**
 * D-SP7 — the pure entry point. Takes data, returns findings, in the order the rules happened to
 * produce them; ORDERING, CAPPING and SCORING are the service's job, because the sort is contract
 * (`compareSecurityFindings`) and applying it twice would be two sources of one truth.
 */
export function analyzeSkillFiles(input: SkillAnalyzerInput): SecurityFinding[] {
  const reported = new Set<SecurityRuleId>();
  const findings: SecurityFinding[] = [];
  for (const [ruleId, rule] of Object.entries(SKILL_RULES)) {
    findings.push(...runRule(ruleId as SecurityRuleId, rule, input, reported));
  }
  return findings;
}
