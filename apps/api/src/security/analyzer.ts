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
//   • **README — heuristics are conservative and documented.** Every matcher below is an exported
//     named constant whose comment says what it deliberately does NOT match (D-SP11). That comment is
//     the false-positive review, written down; each one has a near-miss fixture in
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
// **D-SP14 (WP 1.3) — rules 1, 2 and 3 are now thin callers of `./text-scan.ts`.** Their three
// heuristics — the injection phrase list, the hidden-instruction patterns, the invisible-codepoint
// ranges — ask exactly the same question of a SKILL.md body that they ask of a tool description, so
// they were moved to one file rather than copied into a second analyzer. Everything this module
// exported before the move it still exports, re-exported below, and
// `apps/api/test/security-analyzer.test.ts` is byte-identical and green: that is the proof the
// extraction changed no behaviour. The rules THEMSELVES — which anchor they use, how many findings
// they emit per tool, what their messages say — stay here, because those are per-subject decisions
// and the skill rules make different ones.

import {
  createSecurityFinding,
  SECURITY_MAX_DESCRIPTION_CHARS,
  SECURITY_MAX_FINDINGS_PER_TOOL,
  type ScanDetail,
  type SecurityFinding,
  type SecurityRuleId,
  type ToolScan,
} from "@mcp-token-footprint/shared";
import {
  describeCodePoint,
  escapeRegExp,
  evidenceAround,
  findHiddenInstructionBlocks,
  findInjectionPhrases,
  findInvisible,
  readText,
} from "./text-scan.js";

// D-SP14 — everything this module exported before the heuristics moved, it still exports. A consumer
// that imported `INJECTION_PHRASES` or `HIDDEN_PSEUDO_TAG_PATTERN` from here keeps compiling, and the
// WP 1.2 test file's import list did not have to change (which is what made it possible to leave that
// file byte-identical).
export {
  EVIDENCE_CONTEXT_CHARS,
  HIDDEN_HTML_COMMENT_PATTERN,
  HIDDEN_MODEL_ADDRESS_PATTERN,
  HIDDEN_PSEUDO_TAG_PATTERN,
  INJECTION_INSTRUCTION_OBJECTS,
  INJECTION_PHRASES,
  INVISIBLE_CODE_POINT_RANGES,
  type InjectionPhrase,
} from "./text-scan.js";

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

/**
 * A "token" boundary for identifiers AND prose: anything that is not a letter or a digit. That makes
 * `delete` a token in `delete_file`, `delete-file`, `Delete a file` and `files.delete`, while
 * `dropdown` does NOT contain the token `drop` and `undelete` does not contain `delete`.
 *
 * Deliberately NOT `\b`: `_` is a word character, so `\bdelete\b` fails on `soft_delete_file` —
 * exactly the snake_case names MCP tools are written in.
 */
function tokenPattern(words: readonly string[], flags = "i"): RegExp {
  const alternatives = words.map(escapeRegExp).join("|");
  return new RegExp(`(?:^|[^a-zA-Z0-9])(${alternatives})(?![a-zA-Z0-9])`, flags);
}

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

/**
 * How deep and how wide the schema walk goes before it stops. A tool definition is untrusted input,
 * so the traversal is bounded rather than trusting it to be small. Both bounds are far past anything
 * a real schema reaches; hitting one means the report is incomplete for that tool, never wrong.
 */
export const SCHEMA_WALK_MAX_DEPTH = 12;
export const SCHEMA_WALK_MAX_NODES = 2000;

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

  const walk = (node: Record<string, unknown>, prefix: string, depth: number): void => {
    if (depth > SCHEMA_WALK_MAX_DEPTH || visited >= SCHEMA_WALK_MAX_NODES) return;

    const properties = readSchemaObject(node.properties);
    if (properties !== null) {
      for (const [key, rawChild] of Object.entries(properties)) {
        if (visited >= SCHEMA_WALK_MAX_NODES) return;
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
 * The phrase list itself is `INJECTION_PHRASES` in `./text-scan.ts` (D-SP14) — including the
 * `requiresInstructionObject` rule that keeps "will ignore previous drafts" silent. What is decided
 * HERE is what a SERVER finding looks like: the `tool` anchor, the one-per-tool bound, the message.
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
 * report). The ranges themselves are `INVISIBLE_CODE_POINT_RANGES` in `./text-scan.ts` (D-SP14).
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
 * Length only — no attempt to judge the CONTENT of a long description. `SECURITY_MAX_DESCRIPTION_CHARS`
 * (2,000) is set so that a thorough, honest description does not reach it; a 1,900-character
 * description is deliberately silent, which is the near-miss fixture.
 */
export function ruleOversizedDescription(tool: ToolScan): SecurityFinding[] {
  const description = readText(tool.description);
  if (description.length <= SECURITY_MAX_DESCRIPTION_CHARS) return [];

  const toolName = toolNameOf(tool);
  return [
    createSecurityFinding({
      ruleId: "poisoning.oversized-description",
      anchor: { kind: "tool", toolName },
      message: `The description of "${toolName}" is ${description.length} characters, over the ${SECURITY_MAX_DESCRIPTION_CHARS}-character limit, and that context is spent on every call. Read it end to end.`,
      // The first 200 characters — the excerpt cap is 200 anyway, so this is what a reader gets.
      evidence: { raw: description.slice(0, 200), offset: 0 },
    }),
  ];
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
// Rule 5 — annotation.destructive-unmarked
// ══════════════════════════════════════════════════════════════════════════════════════════════

/**
 * Destructive verbs, written out in every inflection rather than stemmed.
 *
 * Spelling the forms out is what makes the false-positive review reviewable: `drop` is here but
 * `dropdown` is not a token match, `delete` is here but `undelete` is not (the token boundary is a
 * non-alphanumeric, so `un` before it blocks the match), and no stem like `eras` can quietly pull in
 * "eras" or `wip` pull in "work in progress".
 */
// biome-ignore format: one inflection family per line — the grouping IS the review surface
export const DESTRUCTIVE_VERBS = [
  "delete", "deletes", "deleted", "deleting", "deletion", "deletions",
  "remove", "removes", "removed", "removing", "removal",
  "drop", "drops", "dropped", "dropping",
  "destroy", "destroys", "destroyed", "destroying",
  "purge", "purges", "purged", "purging",
  "truncate", "truncates", "truncated", "truncating",
  "revoke", "revokes", "revoked", "revoking",
  "terminate", "terminates", "terminated", "terminating",
  "wipe", "wipes", "wiped", "wiping",
  "erase", "erases", "erased", "erasing",
] as const;

export const DESTRUCTIVE_VERB_PATTERN = tokenPattern(DESTRUCTIVE_VERBS);

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
  const inName = matchToken(DESTRUCTIVE_VERB_PATTERN, name);
  const inDescription = inName === null ? matchToken(DESTRUCTIVE_VERB_PATTERN, description) : null;
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

/**
 * Mutating verbs matched in the tool NAME. A name is an identifier the server chose, so a token here
 * is a claim about what the tool does, never incidental prose.
 *
 * Token matching subsumes the `set_`/`put_` prefixes the plan names: `set` is a token in `set_config`
 * and in `config_set`, while `settings_get` and `output_path` contain neither (`settings` and
 * `output` are single tokens). `reset` is likewise not the token `set`.
 *
 * Deliberately absent: the past participles (`deleted`, `updated`, `removed`). Those describe a STATE
 * the tool reads, not an action it performs — `list_deleted_items` is a read tool with an honest
 * `readOnlyHint: true`, and firing this `error` on it would be exactly the false positive that
 * teaches an operator to stop reading the loudest severity in the report.
 */
// biome-ignore format: one inflection family per line — the grouping IS the review surface
export const MUTATING_VERBS_IN_NAME = [
  "delete", "deletes",
  "remove", "removes",
  "write", "writes",
  "create", "creates",
  "update", "updates",
  "insert", "inserts",
  "drop", "drops",
  "send", "sends",
  "post", "posts",
  "patch", "patches",
  "set", "sets",
  "put", "puts",
] as const;

/**
 * Mutating verbs matched in the DESCRIPTION — third-person-singular forms only.
 *
 * The bare infinitives are all common NOUNS in tool prose: "write access", "the last update", "a
 * blog post", "the patch id", "the result set". Matching those would turn the one `error` in the
 * annotation family into the noisiest rule in the report. The `-s` form is unambiguously verbal in
 * "Deletes a file", which is how honest servers actually write a mutation.
 *
 * Deliberately absent even in `-s` form: `updates`, `posts`, `patches`, `sets`, `puts` — all common
 * plural nouns ("returns pending updates", "the user's posts"). A tool that really mutates and lies
 * about it will almost always say so in its NAME as well, which the list above catches.
 */
export const MUTATING_VERBS_IN_DESCRIPTION = [
  "deletes",
  "removes",
  "writes",
  "creates",
  "inserts",
  "drops",
  "sends",
] as const;

// NOTE — there is deliberately no `MUTATING_NAME_PATTERN` any more. A single first-match regex over
// the whole name is what produced this rule's false positives, so leaving it exported beside
// {@link findMutatingNameToken} would leave a second, quietly wrong answer for the next caller to
// reach for. The vocabulary lives in {@link MUTATING_VERBS_IN_NAME}; the matching is positional.
export const MUTATING_DESCRIPTION_PATTERN = tokenPattern(MUTATING_VERBS_IN_DESCRIPTION);

/**
 * Tokens that declare the name a READ (RM-37 WP 0.5).
 *
 * When one of these precedes a mutating token in the SAME name, the mutating token is part of the
 * noun being read, not the action being performed: `qlik_get_set_expression` reads *a set
 * expression*, `get_delete_policy` reads *a delete policy*. The leading verb is what the tool does.
 */
// biome-ignore format: one token per line — the list IS the review surface
export const READ_VERBS_IN_NAME = [
  "get",
  "list",
  "read",
  "fetch",
  "describe",
  "search",
  "query",
  "find",
  "show",
] as const;

/**
 * The two inflection families that are as often a NOUN or a trailing modifier as they are a verb.
 *
 * `set` and `put` are the weakest tokens in {@link MUTATING_VERBS_IN_NAME}, and they produced this
 * rule's only measured false positives: on the owner's three Qlik servers,
 * `qlik_get_set_expression` and `qlik_generate_set_expression` are both getters whose names carry
 * the noun "set expression". They therefore fire only from the LEADING verb position — see
 * {@link findMutatingNameToken}.
 */
export const WEAK_MUTATING_VERBS_IN_NAME = ["set", "sets", "put", "puts"] as const;

/**
 * How many tokens may precede a weak verb and still leave it "leading".
 *
 * **One**, because that is how MCP servers namespace a tool: `qlik_set_session_mutation_mode`,
 * `github_put_file`. Anything deeper and the verb is sitting inside a noun phrase — which is
 * exactly the shape of both measured false positives (`qlik_get_set_expression`,
 * `qlik_generate_set_expression`, both at index 2).
 */
const WEAK_VERB_MAX_LEADING_OFFSET = 1;

const READ_NAME_TOKENS = new Set<string>(READ_VERBS_IN_NAME);
const MUTATING_NAME_TOKENS = new Set<string>(MUTATING_VERBS_IN_NAME);
const WEAK_MUTATING_NAME_TOKENS = new Set<string>(WEAK_MUTATING_VERBS_IN_NAME);

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
  const tokens = tokenizeName(name);
  for (let index = 0; index < tokens.length && index <= WEAK_VERB_MAX_LEADING_OFFSET; index += 1) {
    const token = tokens[index];
    if (token !== undefined && READ_NAME_TOKENS.has(token.text.toLowerCase())) return true;
  }
  return false;
}

export function findMutatingNameToken(name: string): TokenMatch | null {
  const tokens = tokenizeName(name);
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === undefined) continue;
    const lower = token.text.toLowerCase();
    if (!MUTATING_NAME_TOKENS.has(lower)) continue;

    // Guard 1 — a read verb anywhere before this token. (Any LATER mutating token is behind the
    // same read verb, so this could equally `return null`; the `continue` keeps the loop uniform.)
    const readVerbPrecedes = tokens
      .slice(0, index)
      .some((earlier) => READ_NAME_TOKENS.has(earlier.text.toLowerCase()));
    if (readVerbPrecedes) continue;

    // Guard 2 — a weak verb has to LEAD a verb phrase: at most one namespace token in front of it,
    // and at least one token after it for it to act on.
    if (WEAK_MUTATING_NAME_TOKENS.has(lower)) {
      const leads = index <= WEAK_VERB_MAX_LEADING_OFFSET && index < tokens.length - 1;
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
  // verb or part of the noun. The vocabulary is still {@link MUTATING_VERBS_IN_NAME}.
  const inName = findMutatingNameToken(name);
  const inDescription =
    inName === null ? matchToken(MUTATING_DESCRIPTION_PATTERN, description) : null;
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

/**
 * Terms in a tool's NAME that suggest it reaches outside the host's control.
 *
 * A name is a label the server author chose for what the tool DOES, so a noun here is as strong a
 * signal as a verb: `fetch_page`, `web_search`, `download_report`, `remote_exec`. `https` sits
 * beside `http` because the token matcher treats `https` as its own token.
 *
 * What it deliberately does NOT match: `search` inside a compound token (`researcher`, `websearch`
 * are single tokens and do not match `search` — that is the token boundary doing its job), nor a
 * tool that already declares `openWorldHint: true`, nor `file`, `read` or `list`. This is the
 * quietest rule in the plan (`info`) precisely because plenty of honest servers just omit the hint —
 * a finding here is a nudge, and treating it as anything more would be severity inflation.
 */
// biome-ignore format: one inflection family per line — the grouping IS the review surface
export const OPEN_WORLD_NAME_TERMS = [
  "fetch", "fetches", "fetched", "fetching",
  "http", "https",
  "url", "urls", "uri", "uris",
  "web",
  "search", "searches", "searching",
  "browse", "browses", "browsing",
  "download", "downloads", "downloading",
  "upload", "uploads", "uploading",
  "remote",
] as const;

/**
 * Terms in a tool's DESCRIPTION that suggest it reaches outside the host's control — a deliberately
 * SMALLER list than {@link OPEN_WORLD_NAME_TERMS}, and the same split rule 6 already makes between a
 * name and a description.
 *
 * A description is prose, and prose names the data a tool RETURNS as often as it names what the tool
 * does. Two real false positives on this app's own MCP mount are why this list is narrow:
 * `servers_list` was flagged for the word "url" in *"transport, command/url, auth kind"* — a field it
 * returns — and `skills_list` for "upload" in *"source (upload/GitHub)"*, an enum value it returns.
 * Neither tool reaches anything; both read the local database.
 *
 * So only unambiguous **action inflections** survive here: a description has to say the tool *fetches*
 * or *downloads*, not merely that the word `url` appears somewhere in it. Nothing was added to the
 * vocabulary — this is the existing list, split.
 *
 * What it deliberately does NOT match, all of them nouns that routinely name returned data or a
 * config field: `url`/`uri`, `web`, `remote`, `http`/`https` (a documentation link in a description is
 * a citation, not a network call), and the bare verb stems `fetch`, `search`, `browse`, `download`,
 * `upload`, which are equally common as nouns ("the search index", "an upload"). Each of those still
 * fires from the tool's NAME, where it is a claim about behaviour rather than about a payload.
 */
// biome-ignore format: one inflection family per line — the grouping IS the review surface
export const OPEN_WORLD_DESCRIPTION_TERMS = [
  "fetches", "fetched", "fetching",
  "searches", "searching",
  "browses", "browsing",
  "downloads", "downloading",
  "uploads", "uploading",
] as const;

export const OPEN_WORLD_NAME_PATTERN = tokenPattern(OPEN_WORLD_NAME_TERMS);
export const OPEN_WORLD_DESCRIPTION_PATTERN = tokenPattern(OPEN_WORLD_DESCRIPTION_TERMS);

/** The plan lists "external api" as a phrase, which is not a token — it gets its own matcher. */
export const OPEN_WORLD_PHRASE_PATTERN = /external\s+api/i;

export function ruleOpenWorldUnmarked(tool: ToolScan): SecurityFinding[] {
  const annotations = readAnnotations(tool.annotations);
  if (annotations.kind === "malformed") return [];
  if (annotations.kind === "object" && annotations.value.openWorldHint === true) return [];

  const name = readText(tool.toolName);
  const description = readText(tool.description);
  // The name gets the full term list; the description gets action inflections only. `external api`
  // is unambiguous wherever it appears, so the phrase matcher applies to both.
  for (const [source, where, pattern] of [
    [name, "name", OPEN_WORLD_NAME_PATTERN],
    [description, "description", OPEN_WORLD_DESCRIPTION_PATTERN],
  ] as const) {
    const token = matchToken(pattern, source);
    const phrase = OPEN_WORLD_PHRASE_PATTERN.exec(source);
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

/**
 * A property name shaped like a credential. Anchored on `_`-separated segment boundaries, so it reads
 * whole words rather than substrings.
 *
 * Names are normalized to snake_case first ({@link normalizeParameterName}), which is what lets the
 * same anchored pattern read `accessToken` and `access_token` identically instead of silently
 * missing every camelCase schema.
 */
export const SECRET_PARAMETER_PATTERN =
  /(^|_)(token|password|passwd|secret|api[_-]?key|apikey|credential|credentials|private[_-]?key|access[_-]?key)($|_)/;

/**
 * Trailing segments that turn a credential-shaped name into a MEASUREMENT or a REFERENCE rather than
 * a place a secret goes: `token_count` counts tokens, `secret_name` names a vault entry,
 * `access_key_id` is the public half of an AWS key pair.
 *
 * This list is why the near-miss fixture `token_count` stays silent. Note what survives it:
 * `secret_access_key` ends in `key`, which is not on this list, so the actual AWS secret still fires.
 */
// biome-ignore format: one inflection family per line — the grouping IS the review surface
export const SECRET_PARAMETER_MEASUREMENT_SUFFIXES = [
  "count", "counts", "limit", "limits", "length", "size", "budget", "usage", "total", "totals",
  "type", "kind", "name", "names", "id", "ids", "index", "estimate", "ratio", "threshold",
  "max", "min", "profile", "format", "prefix", "suffix", "required", "enabled", "present",
] as const;

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
  const normalized = normalizeParameterName(parameter.name);
  if (!SECRET_PARAMETER_PATTERN.test(normalized)) return false;

  const lastSegment = normalized.split("_").at(-1) ?? "";
  if ((SECRET_PARAMETER_MEASUREMENT_SUFFIXES as readonly string[]).includes(lastSegment)) {
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

/**
 * Scope shapes that grant far more than one job needs.
 *
 * What it deliberately does NOT match: any narrowed scope, which is nearly all of them —
 * `read:user`, `read:org`, `repo:status`, `admin` as part of a longer word, `user:email`. The
 * patterns are anchored end to end for exactly that reason: `^.*:\*$` matches `files:*` but not
 * `files:read`, and `^(repo|write:org|admin:.*)$` matches GitHub's whole-account grants without
 * touching their narrowed siblings.
 *
 * Matched case-insensitively; a provider that returns `ADMIN` is granting the same thing.
 */
export const BROAD_OAUTH_SCOPE_PATTERNS: readonly RegExp[] = [
  /^\*$/i,
  /^all$/i,
  /^admin$/i,
  /^full[_-]?access$/i,
  /^.*:\*$/i,
  /^(repo|write:org|admin:.*)$/i,
];

export function isBroadOAuthScope(scope: string): boolean {
  return BROAD_OAUTH_SCOPE_PATTERNS.some((pattern) => pattern.test(scope));
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
