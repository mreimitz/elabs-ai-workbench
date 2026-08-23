// The server security analyzer (planning/Roadmap/RM-20-security-posture/, WP 1.2) — the eleven rules of
// `SECURITY_RULES` implemented as PURE functions over a `ScanDetail` the caller already holds.
//
// Five properties this file exists to hold:
//
//   • **D-SP7 — it is a pure function over already-loaded data.** No database handle, no clock, no
//     network, no MCP connection, no config, no module-level mutable state. `apps/api/src/security/
//     service.ts` does the loading and the scoring; `planning/Roadmap/RM-08-ci/` WP 3.1 will call `analyzeScanTools`
//     directly with the `ScanDetail` the assertions engine is already holding, rather than round-
//     tripping through HTTP.
//   • **D-SP5 — a rule never chooses a severity.** Every finding is built by `createSecurityFinding`,
//     which reads the severity out of `SECURITY_RULES`. There is no `severity:` literal in this file.
//   • **D-SP4 — a rule never builds a `SecurityEvidence`.** Evidence is handed over as
//     `{ raw, offset }` and `createSecurityFinding` forces it through `redactSecurityEvidence`
//     (invisibles escaped so they become visible, credential-shaped runs masked, truncated at 200).
//   • **README — heuristics are conservative and documented.** Every matcher's vocabulary now lives
//     in `data-pack/security/signatures.json`, and its false-positive review — what it deliberately
//     does NOT match, and why — travels WITH it, in that file's `…Note` fields, where the person
//     editing the list will read it. Each one still has a near-miss fixture in
//     `apps/api/test/security-analyzer.test.ts` that must stay green.
//   • **A rule that throws must not take the report down.** MCP tool definitions arrive from arbitrary
//     third-party servers, so `inputSchema` may be a string, `annotations` may be an array and
//     `description` may be absent. Every rule call is wrapped: an unexpected shape yields NO finding
//     from that rule instead of a 500. An analyzer that crashes on a weird server is an analyzer that
//     tells you nothing about the weirdest servers — which are the ones worth analysing.
//
// **Read `toolName`, `description`, `inputSchema` and `annotations` — never `rawTool`.** `rawTool` is
// the untouched provider payload and may hold anything at all; the four normalized fields are the
// surface a model actually reads, which is the surface these rules are about.
//
// **D-SP14 (WP 1.3) — rules 1, 2 and 3 are thin callers of `./text-scan.ts`.** Their three
// heuristics ask exactly the same question of a SKILL.md body that they ask of a tool description,
// so they live in one file rather than being copied into a second analyzer. The rules THEMSELVES —
// which anchor they use, how many findings they emit per tool, what their messages say — stay here,
// because those are per-subject decisions and the skill rules make different ones.
//
// **RM-38 WP 2.1 — every list and every pattern this file used to declare is now pack data.** Not one
// vocabulary literal remains here; each rule reads `securitySignatures()` at CALL time, never at
// module load, because in ESM a module-level read happens strictly before boot installs the resolved
// pack. `apps/api/test/security-tables.test.ts` scans this file's comment-stripped source and fails
// on a re-introduced phrase list or verb array — comment-stripped on purpose, because a sentence
// describing where a list used to live would otherwise satisfy the scan after the list came back.

import {
  SECURITY_MAX_FINDINGS_PER_TOOL,
  type ScanDetail,
  type SecurityFinding,
  type SecurityRuleId,
  type ToolScan,
  createSecurityFinding,
  securityMaxDescriptionChars,
  securitySignatures,
} from "@mcp-token-footprint/shared";
import {
  describeCodePoint,
  evidenceAround,
  findHiddenInstructionBlocks,
  findInjectionPhrases,
  findInvisible,
  readText,
} from "./text-scan.js";

// D-SP14 — the three shared text heuristics are still defined in exactly one place, `./text-scan.ts`,
// and this module is still a thin caller of them. What changed in RM-38 WP 2.1 is that their
// VOCABULARY is no longer a `const` in either file: it is pack data, reached through
// `securitySignatures()` at call time. Nothing is re-exported from here any more, because there is no
// longer a constant to re-export — a consumer that wants the phrase list reads the tables.
export { escapeRegExp } from "./text-scan.js";

// ── Input ───────────────────────────────────────────────────────────────────────────────────────

/**
 * What the pure analyzer is allowed to see (D-SP7). No repository, no db, no clock, no network.
 */
export type AnalyzerInput = {
  scan: ScanDetail;
  /**
   * Granted OAuth scope NAMES, or `null` when there are none (D-SP9). Never token material — the
   * only projection of the encrypted credential blob that reaches this module is
   * `OAuthRepository.listGrantedScopes`, which returns strings split out of `tokens.scope`.
   *
   * `null` means "no OAuth, or nothing stored", and it produces NO finding: "we could not tell" is
   * not a finding, and a rule that guessed would be a rule an operator learns to ignore.
   */
  oauthScopes: string[] | null;
  /**
   * Called at most once per rule id when a rule throws on a malformed tool definition. Optional and
   * clock-free so the analyzer stays pure; `routes.ts` supplies a Fastify logger, tests supply a spy.
   */
  onRuleError?: (ruleId: SecurityRuleId, error: unknown) => void;
};

// ── Tool-shaped helpers ─────────────────────────────────────────────────────────────────────────
//
// `readText`, `evidenceAround`, `escapeRegExp` and `EVIDENCE_CONTEXT_CHARS` moved to `./text-scan.ts`
// with the heuristics that use them (D-SP14) and are imported above; only the tool-specific naming
// helper is left here, because a skill has no `toolName` to fall back for.

/** A tool whose name came back empty still has to produce a VALID anchor (`toolName` is `min(1)`). */
const UNNAMED_TOOL = "(unnamed tool)";

function toolNameOf(tool: ToolScan): string {
  const name = readText(tool.toolName).trim();
  return name.length > 0 ? name : UNNAMED_TOOL;
}

// The token-boundary matcher that turns a word list into a pattern now lives in
// `packages/shared/src/security-tables.ts` and runs ONCE, at pack load (D-DP9). Its boundary is
// anything that is not a letter or a digit — deliberately NOT `\b`, because `_` is a word character
// and the snake_case names MCP tools are written in would defeat it.

/** The index/length of the captured group (group 1), not of the boundary character before it. */
type TokenMatch = { index: number; length: number; text: string };

function matchToken(pattern: RegExp, text: string): TokenMatch | null {
  const match = pattern.exec(text);
  const captured = match?.[1];
  if (!match || captured === undefined) return null;
  // `match.index` points at the boundary character (or at the token itself at position 0).
  const index = match.index + match[0].length - captured.length;
  return { index, length: captured.length, text: captured };
}

// ── Reading the two `unknown` fields safely ─────────────────────────────────────────────────────

/**
 * `ToolScan.annotations` is `unknown` on purpose. Three outcomes, and the difference matters:
 *
 *   • `absent`    — the server declared no annotations at all. `annotation.destructive-unmarked`
 *                   treats that as "a host has nothing to key a confirmation prompt off".
 *   • `object`    — a real annotations object; the hints inside it are load-bearing.
 *   • `malformed` — an array, a string, a number. NO annotation rule fires: a server whose
 *                   annotations we cannot parse has told us nothing, and inventing a finding out of
 *                   "we could not read it" is the silent-wrong-answer this workstream exists against.
 */
type AnnotationsRead =
  | { kind: "absent" }
  | { kind: "object"; value: Record<string, unknown> }
  | { kind: "malformed" };

function readAnnotations(value: unknown): AnnotationsRead {
  if (value === undefined || value === null) return { kind: "absent" };
  if (typeof value !== "object" || Array.isArray(value)) return { kind: "malformed" };
  return { kind: "object", value: value as Record<string, unknown> };
}

/** A JSON-Schema node, or `null` when this is not a plain object (a string, an array, a number). */
function readSchemaObject(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

// ── The parameter walk (rules 3, 8, 9) ──────────────────────────────────────────────────────────

// How deep and how wide the schema walk goes before it stops is pack data
// (`schemaWalkMaxDepth`/`schemaWalkMaxNodes`). A tool definition is untrusted input, so the traversal
// is bounded rather than trusted to be small. Both bounds are far past anything a real schema
// reaches; hitting one means the report is incomplete for that tool, never wrong.

export type SchemaParameter = {
  /** Dotted path from the root schema, e.g. `auth.api_key` or `filters[].field`. */
  path: string;
  /** The property key itself, exactly as the server wrote it. */
  name: string;
  schema: Record<string, unknown>;
};

/**
 * Every property under `inputSchema`, depth-first, including properties of nested objects and of
 * array `items`. `$defs`/`definitions` and `$ref` targets are deliberately NOT followed: a `$ref`
 * would let one definition be reported many times (once per reference), and the report's job is to
 * name places an operator can go and edit.
 *
 * The returned list is sorted by `path`, so a caller that has to bound itself keeps the SAME
 * parameters whatever order the server happened to serialize its properties in (D-SP6).
 */
export function collectSchemaParameters(inputSchema: unknown): SchemaParameter[] {
  const root = readSchemaObject(inputSchema);
  if (root === null) return [];

  const collected: SchemaParameter[] = [];
  let visited = 0;
  const { schemaWalkMaxDepth, schemaWalkMaxNodes } = securitySignatures();

  const walk = (node: Record<string, unknown>, prefix: string, depth: number): void => {
    if (depth > schemaWalkMaxDepth || visited >= schemaWalkMaxNodes) return;

    const properties = readSchemaObject(node.properties);
    if (properties !== null) {
      for (const [key, rawChild] of Object.entries(properties)) {
        if (visited >= schemaWalkMaxNodes) return;
        if (key.length === 0) continue;
        const child = readSchemaObject(rawChild);
        if (child === null) continue;
        visited += 1;
        const path = prefix.length === 0 ? key : `${prefix}.${key}`;
        collected.push({ path, name: key, schema: child });
        walk(child, path, depth + 1);
        const items = readSchemaObject(child.items);
        if (items !== null) walk(items, `${path}[]`, depth + 1);
      }
    }
  };

  walk(root, "", 0);
  // `Object.entries` follows insertion order, which follows the server's JSON. Sorting here makes the
  // per-tool bound (SECURITY_MAX_FINDINGS_PER_TOOL) pick the same parameters every time.
  collected.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return collected;
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
// Rule 1 — poisoning.injection-phrasing
// ══════════════════════════════════════════════════════════════════════════════════════════════

/**
 * One finding per TOOL, not one per matched phrase. A description carrying three payloads is one
 * hostile description, and emitting three `error` findings would move the score by −45 for a single
 * fact — the kind of severity inflation the README calls a defect. The message says how many other
 * phrases matched so nothing is hidden.
 *
 * The phrase list itself is pack data, matched by `./text-scan.ts` (D-SP14) — including the
 * requires-an-instruction-object rule that keeps a sentence about the tool's own behaviour silent.
 * What is decided HERE is what a SERVER finding looks like: the `tool` anchor, the one-per-tool
 * bound, the message.
 */
export function ruleInjectionPhrasing(tool: ToolScan): SecurityFinding[] {
  const description = readText(tool.description);
  const matches = findInjectionPhrases(description);
  const first = matches[0];
  if (first === undefined) return [];

  const others = matches.length - 1;
  const suffix =
    others === 0 ? "" : ` (${others} further phrase${others === 1 ? "" : "s"} also matched)`;
  return [
    createSecurityFinding({
      ruleId: "poisoning.injection-phrasing",
      anchor: { kind: "tool", toolName: toolNameOf(tool) },
      message: `The description of "${toolNameOf(tool)}" contains injection phrasing ("${first.phrase}") at character ${first.offset}${suffix}.`,
      evidence: evidenceAround(description, first.offset, first.match.length),
    }),
  ];
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
// Rule 2 — poisoning.hidden-instructions
// ══════════════════════════════════════════════════════════════════════════════════════════════

/**
 * One finding per tool, for the same reason rule 1 emits one — see its comment.
 *
 * All three shapes fire here, the bare HTML comment included: a tool description is a WIRE string a
 * server serialized into a JSON payload, and it has no editorial reason to carry a comment at all.
 * (The skill rule deliberately diverges — see `skill-analyzer.ts` — because a SKILL.md is authored
 * Markdown where `<!-- prettier-ignore -->` is ordinary furniture.)
 */
export function ruleHiddenInstructions(tool: ToolScan): SecurityFinding[] {
  const description = readText(tool.description);
  const first = findHiddenInstructionBlocks(description)[0];
  if (first === undefined) return [];

  return [
    createSecurityFinding({
      ruleId: "poisoning.hidden-instructions",
      anchor: { kind: "tool", toolName: toolNameOf(tool) },
      message: `The description of "${toolNameOf(tool)}" carries ${first.label} at character ${first.offset}, which you do not see in a tool list but the model does.`,
      evidence: evidenceAround(description, first.offset, first.match.length),
    }),
  ];
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
// Rule 3 — poisoning.invisible-unicode
// ══════════════════════════════════════════════════════════════════════════════════════════════

/**
 * One tool-anchored finding for the name/description, plus one parameter-anchored finding per
 * offending parameter (bounded per tool like rule 9, so a pathological schema cannot drown the
 * report). The ranges themselves are pack data, matched by `./text-scan.ts` (D-SP14).
 */
export function ruleInvisibleUnicode(tool: ToolScan): SecurityFinding[] {
  const findings: SecurityFinding[] = [];
  const toolName = toolNameOf(tool);

  const name = readText(tool.toolName);
  const description = readText(tool.description);
  const inName = findInvisible(name);
  const inDescription = inName === null ? findInvisible(description) : null;
  const hit = inName ?? inDescription;
  if (hit !== null) {
    const source = inName !== null ? name : description;
    const where = inName !== null ? "name" : "description";
    findings.push(
      createSecurityFinding({
        ruleId: "poisoning.invisible-unicode",
        anchor: { kind: "tool", toolName },
        message: `The ${where} of "${toolName}" contains the invisible character ${describeCodePoint(hit.code)} at character ${hit.index}.`,
        evidence: evidenceAround(source, hit.index, hit.length),
      }),
    );
  }

  const offending: {
    path: string;
    where: string;
    source: string;
    hit: NonNullable<ReturnType<typeof findInvisible>>;
  }[] = [];
  for (const parameter of collectSchemaParameters(tool.inputSchema)) {
    const inKey = findInvisible(parameter.name);
    if (inKey !== null) {
      offending.push({ path: parameter.path, where: "name", source: parameter.name, hit: inKey });
      continue;
    }
    const parameterDescription = readText(parameter.schema.description);
    const inText = findInvisible(parameterDescription);
    if (inText !== null) {
      offending.push({
        path: parameter.path,
        where: "description",
        source: parameterDescription,
        hit: inText,
      });
    }
  }

  const shown = offending.slice(0, SECURITY_MAX_FINDINGS_PER_TOOL);
  const hidden = offending.length - shown.length;
  shown.forEach((entry, index) => {
    const overflow =
      hidden > 0 && index === shown.length - 1
        ? ` A further ${hidden} parameter${hidden === 1 ? "" : "s"} of this tool also carry invisible characters and are not listed.`
        : "";
    findings.push(
      createSecurityFinding({
        ruleId: "poisoning.invisible-unicode",
        anchor: { kind: "parameter", toolName, parameterPath: entry.path },
        message: `The ${entry.where} of parameter "${entry.path}" on "${toolName}" contains the invisible character ${describeCodePoint(entry.hit.code)} at character ${entry.hit.index}.${overflow}`,
        evidence: evidenceAround(entry.source, entry.hit.index, entry.hit.length),
      }),
    );
  });

  return findings;
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
// Rule 4 — poisoning.oversized-description
// ══════════════════════════════════════════════════════════════════════════════════════════════

/**
 * Length only — no attempt to judge the CONTENT of a long description. The ceiling is pack data
 * (`maxDescriptionChars`), set so that a thorough, honest description does not reach it; a
 * description just under it is deliberately silent, which is the near-miss fixture.
 */
export function ruleOversizedDescription(tool: ToolScan): SecurityFinding[] {
  const description = readText(tool.description);
  const ceiling = securityMaxDescriptionChars();
  if (description.length <= ceiling) return [];

  const toolName = toolNameOf(tool);
  return [
    createSecurityFinding({
      ruleId: "poisoning.oversized-description",
      anchor: { kind: "tool", toolName },
      message: `The description of "${toolName}" is ${description.length} characters, over the ${ceiling}-character limit, and that context is spent on every call. Read it end to end.`,
      // The first 200 characters — the excerpt cap is 200 anyway, so this is what a reader gets.
      evidence: { raw: description.slice(0, 200), offset: 0 },
    }),
  ];
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
// Rule 5 — annotation.destructive-unmarked
// ══════════════════════════════════════════════════════════════════════════════════════════════

// The destructive-verb vocabulary is pack data (`destructiveVerbs`), written out in every inflection
// rather than stemmed, with its false-positive review beside it in the pack.

/**
 * Fires when the tool reads as destructive AND (there is no annotations object at all, OR
 * `destructiveHint` is explicitly `false`).
 *
 * **Which reading of "absent" this implements, and why.** MCP's own spec defaults `destructiveHint`
 * to `true` for a tool that is not read-only, so an annotations object that simply OMITS the hint is
 * already treated as destructive by a conforming host — there is nothing to warn about, and firing
 * there would report a tool that is behaving correctly. Two cases are left, and they are different:
 * a tool with NO annotations object gives a host nothing at all to key its confirmation prompt off,
 * and a tool with `destructiveHint: false` is making an active claim its own name contradicts.
 */
export function ruleDestructiveUnmarked(tool: ToolScan): SecurityFinding[] {
  const annotations = readAnnotations(tool.annotations);
  if (annotations.kind === "malformed") return [];

  const declaredNonDestructive =
    annotations.kind === "object" && annotations.value.destructiveHint === false;
  if (annotations.kind === "object" && !declaredNonDestructive) return [];

  const name = readText(tool.toolName);
  const description = readText(tool.description);
  const pattern = securitySignatures().destructiveVerbPattern;
  const inName = matchToken(pattern, name);
  const inDescription = inName === null ? matchToken(pattern, description) : null;
  const hit = inName ?? inDescription;
  if (hit === null) return [];

  const source = inName !== null ? name : description;
  const toolName = toolNameOf(tool);
  const reason = declaredNonDestructive
    ? "declares destructiveHint: false"
    : "carries no annotations at all";
  return [
    createSecurityFinding({
      ruleId: "annotation.destructive-unmarked",
      anchor: { kind: "tool", toolName },
      message: `"${toolName}" reads as destructive ("${hit.text}") but ${reason}, so a host that confirms destructive calls will not confirm this one.`,
      evidence: evidenceAround(source, hit.index, hit.length),
    }),
  ];
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
// Rule 6 — annotation.readonly-contradiction
// ══════════════════════════════════════════════════════════════════════════════════════════════

// Rule 6's whole vocabulary is pack data, and each of the four lists carries its own false-positive
// review there:
//
//   • `mutatingVerbsInName` — matched in the tool NAME, which is an identifier the server chose, so a
//     token there is a claim about what the tool does rather than incidental prose. Token matching
//     subsumes the prefix forms the plan named, and the past participles are deliberately absent
//     because they describe a STATE the tool reads.
//   • `mutatingVerbsInDescription` — third-person-singular forms only, because the bare infinitives
//     are all common nouns in tool prose.
//   • `readVerbsInName` (RM-37 WP 0.5) — when one of these precedes a mutating token in the SAME
//     name, the mutating token is part of the noun being read, not the action being performed. The
//     leading verb is what the tool does.
//   • `weakMutatingVerbsInName` + `weakVerbMaxLeadingOffset` (RM-37 WP 0.5) — the two inflection
//     families that are as often a noun as a verb. They produced this rule's only MEASURED false
//     positives, on three of the owner's own Qlik servers, so they fire from the leading verb
//     position only: index 0, or index 1 behind a single namespace token, which is how MCP servers
//     namespace a tool.
//
// There is deliberately no single "mutating name pattern". A first-match regex over the whole name
// is exactly what produced this rule's false positives, so leaving one beside
// {@link findMutatingNameToken} would leave a second, quietly wrong answer for the next caller to
// reach for. The vocabulary is a list; the matching is positional.

/** Every alphanumeric run in a name, in order — the same token boundary {@link tokenPattern} uses. */
function tokenizeName(name: string): TokenMatch[] {
  const tokens: TokenMatch[] = [];
  const pattern = /[a-zA-Z0-9]+/g;
  let match = pattern.exec(name);
  while (match !== null) {
    tokens.push({ index: match.index, length: match[0].length, text: match[0] });
    match = pattern.exec(name);
  }
  return tokens;
}

/**
 * The mutating token a tool NAME actually claims — or `null` when every candidate is a noun.
 *
 * Two guards, both added by RM-37 WP 0.5 after `qlik_get_set_expression` scored an `error` on the
 * owner's own servers. Both are about POSITION, which is the only signal a name carries:
 *
 *   1. **A read verb earlier in the name wins.** `get`, `list`, `read`, … announce what the tool
 *      does; a mutating token after one of them names the thing being read.
 *   2. **`set`/`put` must lead the verb phrase.** They are as often nouns ("the config set", "a set
 *      expression") as verbs, so they fire from index 0 — or index 1 behind a single namespace
 *      token — and never from deeper in a noun phrase.
 *
 * The deliberate cost, stated rather than hidden: a genuine mutation named `search_and_delete_all`
 * no longer fires. Measured against the owner's 198-tool corpus that costs **nothing** (no name
 * puts a read verb in front of a real mutation), and this is the analyzer's ONE `error` rule — an
 * `error` an operator learns to ignore is worse than no rule at all.
 */
/**
 * Does this name LEAD with a read verb — `get_script`, `qlik_list_apps`, `fetch_report`?
 *
 * A tool name is an identifier its author chose; a description is prose written for a model. When
 * the two disagree, the name wins, because the name is the only part the author had to be precise
 * about. `qlik_get_script` on the owner's servers is the case: its description ends *"so the server
 * can reject **writes** against a stale view of the script"* — a plural NOUN, naming what a
 * different tool does — and the description matcher read it as a mutation verb.
 *
 * One namespace token may precede the read verb, for the same reason it may precede a weak mutating
 * verb: `qlik_get_script` and `get_script` are the same claim.
 */
function nameLeadsWithReadVerb(name: string): boolean {
  const { readNameTokens, weakVerbMaxLeadingOffset } = securitySignatures();
  const tokens = tokenizeName(name);
  for (let index = 0; index < tokens.length && index <= weakVerbMaxLeadingOffset; index += 1) {
    const token = tokens[index];
    if (token !== undefined && readNameTokens.has(token.text.toLowerCase())) return true;
  }
  return false;
}

export function findMutatingNameToken(name: string): TokenMatch | null {
  const { readNameTokens, mutatingNameTokens, weakMutatingNameTokens, weakVerbMaxLeadingOffset } =
    securitySignatures();
  const tokens = tokenizeName(name);
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === undefined) continue;
    const lower = token.text.toLowerCase();
    if (!mutatingNameTokens.has(lower)) continue;

    // Guard 1 — a read verb ANYWHERE before this token means the token names the thing being read.
    //
    // This overlaps `nameLeadsWithReadVerb`, the early return in `ruleReadonlyContradiction`, and the
    // overlap is only partial. Measured by disabling each one separately:
    //
    //   • name path, read verb at index 0-1 (`get_delete_policy`) — BOTH catch it; either alone suffices.
    //   • name path, read verb at index >= 2 (`qlik_app_get_delete_policy`) — **this guard only.** The
    //     early return never looks that deep.
    //   • description path (`qlik_get_script`, whose NAME holds no mutating token) — **early return
    //     only.** This function is never reached.
    //
    // The middle case is why this guard exists, and it is the one that shipped untested: an earlier
    // revision of this comment said the guard "could equally `return null`", which read as a note about
    // control flow and became a reason not to test it, while every fixture happened to sit in the
    // doubly-covered first case. Each mechanism now has a fixture in the region only IT covers, and each
    // was proved by breaking that mechanism alone — see the tests "read verb DEEPER than the leading
    // position (guard 1)" and "is not second-guessed by its prose".
    const readVerbPrecedes = tokens
      .slice(0, index)
      .some((earlier) => readNameTokens.has(earlier.text.toLowerCase()));
    if (readVerbPrecedes) continue;

    // Guard 2 — a weak verb has to LEAD a verb phrase: at most one namespace token in front of it,
    // and at least one token after it for it to act on.
    if (weakMutatingNameTokens.has(lower)) {
      const leads = index <= weakVerbMaxLeadingOffset && index < tokens.length - 1;
      if (!leads) continue;
    }

    return token;
  }
  return null;
}

/**
 * The one `error` in the annotation family: the server is asserting `readOnlyHint: true` while its
 * own surface describes a mutation. A host that skips approval for read-only tools runs this one
 * unattended, which makes the wrong hint worse than no hint.
 */
export function ruleReadonlyContradiction(tool: ToolScan): SecurityFinding[] {
  const annotations = readAnnotations(tool.annotations);
  if (annotations.kind !== "object" || annotations.value.readOnlyHint !== true) return [];

  const name = readText(tool.toolName);
  const description = readText(tool.description);

  // RM-37 WP 0.5 — a tool whose NAME leads with a read verb is a read tool, and this rule does not
  // second-guess that from prose. `qlik_get_script` scored an `error` because its description
  // mentions "writes" while explaining how ANOTHER tool rejects stale ones. The name is the
  // author's own identifier; the description is prose written for a model. When they disagree, the
  // one that had to be precise wins.
  if (nameLeadsWithReadVerb(name)) return [];

  // Position-aware — a name is an ordered claim, so where the token sits decides whether it is the
  // verb or part of the noun. The vocabulary is the pack's `mutatingVerbsInName`.
  const inName = findMutatingNameToken(name);
  const inDescription =
    inName === null
      ? matchToken(securitySignatures().mutatingDescriptionPattern, description)
      : null;
  const hit = inName ?? inDescription;
  if (hit === null) return [];

  const source = inName !== null ? name : description;
  const where = inName !== null ? "name" : "description";
  const toolName = toolNameOf(tool);
  return [
    createSecurityFinding({
      ruleId: "annotation.readonly-contradiction",
      anchor: { kind: "tool", toolName },
      message: `"${toolName}" declares readOnlyHint: true, but its ${where} describes a mutation ("${hit.text}").`,
      evidence: evidenceAround(source, hit.index, hit.length),
    }),
  ];
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
// Rule 7 — annotation.open-world-unmarked
// ══════════════════════════════════════════════════════════════════════════════════════════════

// Rule 7's vocabulary is pack data, in two lists with one review between them:
// `openWorldNameTerms` is the fuller one, because a NAME is a label the author chose for what the
// tool DOES; `openWorldDescriptionTerms` is deliberately smaller, because prose names the data a
// tool RETURNS as often as it names what the tool does — two measured false positives on this app's
// own MCP mount are why. The phrase matcher (`openWorldPhrase`) exists because the plan lists a
// two-word phrase that is not a token.
//
// This is the quietest rule in the plan (`info`) precisely because plenty of honest servers just
// omit the hint — a finding here is a nudge, and treating it as anything more would be severity
// inflation.

export function ruleOpenWorldUnmarked(tool: ToolScan): SecurityFinding[] {
  const annotations = readAnnotations(tool.annotations);
  if (annotations.kind === "malformed") return [];
  if (annotations.kind === "object" && annotations.value.openWorldHint === true) return [];

  const name = readText(tool.toolName);
  const description = readText(tool.description);
  const signatures = securitySignatures();
  // The name gets the full term list; the description gets action inflections only. The two-word
  // phrase is unambiguous wherever it appears, so its matcher applies to both.
  for (const [source, where, pattern] of [
    [name, "name", signatures.openWorldNamePattern],
    [description, "description", signatures.openWorldDescriptionPattern],
  ] as const) {
    const token = matchToken(pattern, source);
    const phrase = signatures.openWorldPhrasePattern.exec(source);
    const hit =
      token !== null && (phrase === null || token.index <= phrase.index)
        ? token
        : phrase === null
          ? null
          : { index: phrase.index, length: phrase[0].length, text: phrase[0] };
    if (hit === null) continue;

    const toolName = toolNameOf(tool);
    return [
      createSecurityFinding({
        ruleId: "annotation.open-world-unmarked",
        anchor: { kind: "tool", toolName },
        message: `The ${where} of "${toolName}" suggests it reaches an external system ("${hit.text}") but it does not declare openWorldHint: true.`,
        evidence: evidenceAround(source, hit.index, hit.length),
      }),
    ];
  }
  return [];
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
// Rule 8 — schema.secret-shaped-parameter
// ══════════════════════════════════════════════════════════════════════════════════════════════

// Rule 8's matcher (`secretParameterPattern`) and its exception list
// (`secretParameterMeasurementSuffixes`) are pack data, with their review beside them there. Names
// are normalized to snake_case first ({@link normalizeParameterName}), which is what lets one
// anchored pattern read camelCase and snake_case identically instead of silently missing every
// camelCase schema.

/**
 * `accessToken` → `access_token`; `APIKey` → `api_key`; `api-key` → `api_key`. Lower-cased, with a
 * separator inserted at every lower→upper transition and at every acronym→word boundary.
 */
export function normalizeParameterName(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2")
    .replace(/[-\s]+/g, "_")
    .toLowerCase();
}

/** True when the parameter is a free-text field named like a credential. */
export function isSecretShapedParameter(parameter: SchemaParameter): boolean {
  const signatures = securitySignatures();
  const normalized = normalizeParameterName(parameter.name);
  if (!signatures.secretParameterPattern.test(normalized)) return false;

  const lastSegment = normalized.split("_").at(-1) ?? "";
  if (signatures.secretParameterMeasurementSuffixes.includes(lastSegment)) {
    return false;
  }

  // Only a FREE-TEXT string is a place a real secret can be typed. A `format: "password"` field is
  // already declared as one and gets host handling; an `enum` is a closed list of allowed values, so
  // it cannot carry a credential no matter what it is called.
  if (parameter.schema.type !== "string") return false;
  if (parameter.schema.format === "password") return false;
  if (parameter.schema.enum !== undefined) return false;
  return true;
}

export function ruleSecretShapedParameter(tool: ToolScan): SecurityFinding[] {
  const toolName = toolNameOf(tool);
  const findings: SecurityFinding[] = [];
  for (const parameter of collectSchemaParameters(tool.inputSchema)) {
    if (!isSecretShapedParameter(parameter)) continue;
    // Evidence is the parameter's own DESCRIPTION and nothing else — a schema holds no value, and a
    // `default` must never be echoed into a report that gets pasted into a PR comment.
    const description = readText(parameter.schema.description);
    findings.push(
      createSecurityFinding({
        ruleId: "schema.secret-shaped-parameter",
        anchor: { kind: "parameter", toolName, parameterPath: parameter.path },
        message: `Parameter "${parameter.path}" on "${toolName}" is a free-text string named like a credential, which invites the model to put a real secret into a tool argument.`,
        ...(description.length > 0 ? { evidence: { raw: description, offset: 0 } } : {}),
      }),
    );
  }
  return findings;
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
// Rule 9 — schema.undescribed-parameter
// ══════════════════════════════════════════════════════════════════════════════════════════════

/**
 * A property with no non-empty `description`. Bounded at {@link SECURITY_MAX_FINDINGS_PER_TOOL} per
 * tool, with the count of the rest carried in the last message, so one sixty-parameter tool cannot
 * drown every other finding in the report.
 *
 * Deliberately silent for a parameter that HAS a description of any length, and for a schema this
 * analyzer cannot parse at all (a string `inputSchema` yields no parameters, hence no findings —
 * "we could not read it" is not a finding).
 */
export function ruleUndescribedParameter(tool: ToolScan): SecurityFinding[] {
  const toolName = toolNameOf(tool);
  const undescribed = collectSchemaParameters(tool.inputSchema).filter(
    (parameter) => readText(parameter.schema.description).trim().length === 0,
  );

  const shown = undescribed.slice(0, SECURITY_MAX_FINDINGS_PER_TOOL);
  const hidden = undescribed.length - shown.length;
  return shown.map((parameter, index) => {
    const overflow =
      hidden > 0 && index === shown.length - 1
        ? ` A further ${hidden} parameter${hidden === 1 ? "" : "s"} of this tool are also undescribed and are not listed.`
        : "";
    return createSecurityFinding({
      ruleId: "schema.undescribed-parameter",
      anchor: { kind: "parameter", toolName, parameterPath: parameter.path },
      message: `Parameter "${parameter.path}" on "${toolName}" has no description, so the model has to guess what belongs in it.${overflow}`,
    });
  });
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
// Rule 10 — schema.unconstrained-additional-properties
// ══════════════════════════════════════════════════════════════════════════════════════════════

/**
 * The ROOT input schema only. Firing on every nested object would produce noise proportional to
 * schema depth for no extra signal — the root is where a model actually invents a field.
 *
 * Deliberately silent for `additionalProperties: false`, for a schema with no `properties` at all (a
 * tool that takes no arguments, or an open map that is documented as one), and for a root that is
 * not `type: "object"`.
 */
export function ruleUnconstrainedAdditionalProperties(tool: ToolScan): SecurityFinding[] {
  const root = readSchemaObject(tool.inputSchema);
  if (root === null) return [];
  if (root.type !== "object") return [];
  if (readSchemaObject(root.properties) === null) return [];

  const additional = root.additionalProperties;
  if (additional !== undefined && additional !== true) return [];

  const toolName = toolNameOf(tool);
  return [
    createSecurityFinding({
      ruleId: "schema.unconstrained-additional-properties",
      anchor: { kind: "tool", toolName },
      message: `The input schema of "${toolName}" declares properties but ${additional === true ? "explicitly allows" : "does not forbid"} additional ones, so the model may invent fields the server silently accepts or drops.`,
    }),
  ];
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
// Rule 11 — oauth.broad-scope
// ══════════════════════════════════════════════════════════════════════════════════════════════

// Rule 11's scope shapes (`broadOauthScopePatterns`) are pack data, with their review beside them
// there. Every pattern is anchored end to end so a narrowed scope — which is nearly all of them —
// does not match, and all are matched case-insensitively.

export function isBroadOAuthScope(scope: string): boolean {
  return securitySignatures().broadOauthScopePatterns.some((pattern) => pattern.test(scope));
}

/**
 * A `null` scope list produces NO finding (D-SP9): "this server does not use OAuth" and "nothing was
 * stored" are both "we could not tell", and this analyzer never guesses.
 */
export function ruleBroadOAuthScope(input: AnalyzerInput): SecurityFinding[] {
  const scopes = input.oauthScopes;
  if (scopes === null || scopes.length === 0) return [];

  const broad = scopes.filter((scope) => isBroadOAuthScope(scope));
  if (broad.length === 0) return [];

  const serverName = readText(input.scan.serverName) || input.scan.serverId;
  return [
    createSecurityFinding({
      ruleId: "oauth.broad-scope",
      anchor: { kind: "server" },
      message: `The stored OAuth grant for "${serverName}" includes ${broad.length} broad scope${broad.length === 1 ? "" : "s"} (${broad.join(", ")}) out of ${scopes.length} granted; if this server is compromised the blast radius is everything they reach.`,
      // The WHOLE grant, in the space-delimited form OAuth stores it: an operator reviewing scope
      // breadth needs to see what else was asked for, not only the entries that tripped the rule. It
      // is also the tighter secrecy guard — anything that ever reached this list would show up here,
      // which is what `apps/api/test/security-analyzer.test.ts`'s D-SP9 test reads.
      evidence: { raw: scopes.join(" "), offset: 0 },
    }),
  ];
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
// The aggregator
// ══════════════════════════════════════════════════════════════════════════════════════════════

/** A rule that reads ONE tool definition. */
export type ToolRule = (tool: ToolScan) => SecurityFinding[];
/** A rule that reads the whole subject (today: only the OAuth grant). */
export type ServerRule = (input: AnalyzerInput) => SecurityFinding[];

/**
 * The ten per-tool rules, keyed by the frozen rule id they emit (D-SP2). Keying the map by rule id is
 * what lets the acceptance test assert that the set of ids this analyzer can emit is EXACTLY the
 * registry's `subject: "server"` set — no invented id, none missing.
 */
export const TOOL_RULES = {
  "poisoning.injection-phrasing": ruleInjectionPhrasing,
  "poisoning.hidden-instructions": ruleHiddenInstructions,
  "poisoning.invisible-unicode": ruleInvisibleUnicode,
  "poisoning.oversized-description": ruleOversizedDescription,
  "annotation.destructive-unmarked": ruleDestructiveUnmarked,
  "annotation.readonly-contradiction": ruleReadonlyContradiction,
  "annotation.open-world-unmarked": ruleOpenWorldUnmarked,
  "schema.secret-shaped-parameter": ruleSecretShapedParameter,
  "schema.undescribed-parameter": ruleUndescribedParameter,
  "schema.unconstrained-additional-properties": ruleUnconstrainedAdditionalProperties,
} as const satisfies Partial<Record<SecurityRuleId, ToolRule>>;

/** The one subject-level rule. */
export const SERVER_RULES = {
  "oauth.broad-scope": ruleBroadOAuthScope,
} as const satisfies Partial<Record<SecurityRuleId, ServerRule>>;

/** Every rule id this analyzer can emit — the assertion target of acceptance A1. */
export const SERVER_ANALYZER_RULE_IDS: readonly SecurityRuleId[] = [
  ...Object.keys(TOOL_RULES),
  ...Object.keys(SERVER_RULES),
] as SecurityRuleId[];

/**
 * Run one rule and swallow anything it throws.
 *
 * A tool definition comes from an arbitrary third-party server: `inputSchema` may be a string,
 * `annotations` may be an array, a description may be half a megabyte. A rule that throws on one of
 * those must not take the whole report down with it, because the servers most likely to produce a
 * malformed definition are the servers most worth analysing. The failure is reported through
 * `onRuleError` (at most once per rule id) rather than silently — an analyzer that hides its own
 * blind spot is worse than one that has none.
 */
function runRule<T>(
  ruleId: SecurityRuleId,
  rule: (argument: T) => SecurityFinding[],
  argument: T,
  reported: Set<SecurityRuleId>,
  onRuleError: AnalyzerInput["onRuleError"],
): SecurityFinding[] {
  try {
    return rule(argument);
  } catch (error) {
    if (!reported.has(ruleId)) {
      reported.add(ruleId);
      onRuleError?.(ruleId, error);
    }
    return [];
  }
}

/**
 * D-SP7 — the pure entry point. Takes data, returns findings, in the order the rules happened to
 * produce them; ORDERING, CAPPING and SCORING are the service's job, because the sort is contract
 * (`compareSecurityFindings`) and applying it twice would be two sources of one truth.
 *
 * `planning/Roadmap/RM-08-ci/` WP 3.1 calls exactly this with the `ScanDetail` the assertions engine already holds.
 */
export function analyzeScanTools(input: AnalyzerInput): SecurityFinding[] {
  const reported = new Set<SecurityRuleId>();
  const findings: SecurityFinding[] = [];

  for (const [ruleId, rule] of Object.entries(SERVER_RULES)) {
    findings.push(...runRule(ruleId as SecurityRuleId, rule, input, reported, input.onRuleError));
  }

  const tools = Array.isArray(input.scan.tools) ? input.scan.tools : [];
  for (const tool of tools) {
    for (const [ruleId, rule] of Object.entries(TOOL_RULES)) {
      findings.push(...runRule(ruleId as SecurityRuleId, rule, tool, reported, input.onRuleError));
    }
  }

  return findings;
}
