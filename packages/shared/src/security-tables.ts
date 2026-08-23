// The security SIGNATURE tables as DATA, plus the one seam every consumer reads them through
// (RM-38 WP 2.1).
//
// WHY THIS MODULE EXISTS
// ---------------------
// Prompt-injection payloads, credential-shaped parameter names and over-broad scope patterns change
// on attackers' schedule. Until WP 2.1 every one of them was a `const` inside
// `apps/api/src/security/*.ts`, so recognising a new payload needed a release, an image rebuild and
// a redeploy of every install. They now live in `data-pack/security/signatures.json` and arrive
// through the reference data pack.
//
// THREE PROPERTIES THIS FILE HOLDS
// --------------------------------
//   • **Regex is data (D-DP9).** A pattern ships as `{ source, flags }` under a source-length cap and
//     is compiled EXACTLY ONCE, at pack load. A malformed or oversized pattern REFUSES THE PACK; it
//     never throws in the middle of a scan, where the failure would be a 500 on a report an operator
//     asked for.
//   • **One seam, one answer.** `getSecurityTables()` returns the tables in force. `apps/api`
//     installs the resolved pack's tables at boot; everything else — including the browser bundle,
//     which cannot read a pack off disk — falls back to the BUNDLED snapshot compiled in at
//     `security-tables.generated.ts`. There is no third source and no per-field merge.
//   • **`zod` is the only import** (plus the generated data module, which imports nothing at
//     runtime). No `node:*`, no filesystem, no network. Reading pack bytes is the API's job; this
//     module takes an already-parsed document. `apps/api/test/security-tables.test.ts` scans this
//     file's own source and fails on any other import specifier.
//
// It deliberately does NOT own the rule REGISTRY (ids, severities, titles, rationales). That lives
// in `security-posture.ts` beside `createSecurityFinding`, which reads a rule's severity out of it —
// putting the registry here would make the two modules mutually dependent at module-evaluation time
// for no gain. This module imports the registry's TYPES only, which erase at runtime.

import { z } from "zod";
import {
  BUNDLED_SECURITY_ANALYZER_VERSION,
  BUNDLED_SECURITY_RULES,
  BUNDLED_SECURITY_RULE_ID_LEDGER,
  BUNDLED_SECURITY_SIGNATURES,
} from "./security-tables.generated.js";
import type { SecurityRule } from "./security-posture.js";

// ── D-DP9 · regex as data ───────────────────────────────────────────────────────────────────────

/**
 * The longest `source` a pack-declared pattern may carry.
 *
 * 256 is roughly twice the longest pattern in the bundled pack (the credential-shaped parameter
 * matcher, 113 characters), which is enough headroom for an honest addition and far short of the
 * length a hand-built catastrophic-backtracking payload needs. The cap is a **refusal**, not a
 * truncation: a pattern that does not fit is a pattern nobody reviewed.
 *
 * It bounds only what the PACK declares. Patterns DERIVED from a word list (see `tokenPattern`) are
 * as long as the list, and the list has its own bounds below.
 */
export const SECURITY_PATTERN_MAX_SOURCE_CHARS = 256;

/** How many entries any one signature list may carry. A pack is reference data, not a corpus. */
export const SECURITY_SIGNATURE_MAX_LIST_ITEMS = 512;

/** How long any one word/phrase in a signature list may be. */
export const SECURITY_SIGNATURE_MAX_ITEM_CHARS = 128;

/**
 * A regular expression, transported as data. `flags` is checked against the ECMAScript flag set
 * rather than left free, so a pack cannot smuggle in a `g` flag — a shared `g`-flagged regex carries
 * `lastIndex` between calls, which would make a report depend on what ran before it (D-SP6).
 */
export const RegexSpecSchema = z
  .object({
    source: z.string().min(1).max(SECURITY_PATTERN_MAX_SOURCE_CHARS),
    flags: z.string().regex(/^[dimsuvy]*$/),
  })
  .strict();

export type RegexSpec = z.infer<typeof RegexSpecSchema>;

/** One thing wrong with a signature document, addressed by a dotted path into it. */
export type SecurityTableViolation = { path: string; message: string };

const signatureWord = z.string().min(1).max(SECURITY_SIGNATURE_MAX_ITEM_CHARS);
const signatureList = z.array(signatureWord).min(1).max(SECURITY_SIGNATURE_MAX_LIST_ITEMS);

/**
 * An injection phrase. `requiresInstructionObject` is what separates "this endpoint will ignore
 * previous drafts" (ordinary English about the tool's own behaviour) from a sentence addressed to
 * the model: the phrase alone is not enough, an instruction-object noun has to follow it.
 */
export const InjectionPhraseSchema = z
  .object({
    phrase: signatureWord,
    requiresInstructionObject: z.literal(true).optional(),
  })
  .strict();

export type InjectionPhrase = z.infer<typeof InjectionPhraseSchema>;

/**
 * `data-pack/security/signatures.json`.
 *
 * Every group carries an optional `note`: the "what this deliberately does NOT match" review that
 * used to sit as a comment above the constant. It travels WITH the list on purpose — the false-
 * positive review is the most valuable thing about a heuristic, and a reviewer editing the JSON is
 * exactly the reader who needs it.
 */
export const SecuritySignaturesSchema = z
  .object({
    note: z.string().optional(),
    /** How much text either side of a match an evidence excerpt carries. */
    evidenceContextChars: z.number().int().positive().max(1000),
    /** `poisoning.oversized-description`'s ceiling, in characters. */
    maxDescriptionChars: z.number().int().positive().max(1_000_000),
    /** How deep and how wide the untrusted-schema walk goes before it stops. */
    schemaWalkMaxDepth: z.number().int().positive().max(100),
    schemaWalkMaxNodes: z.number().int().positive().max(1_000_000),
    injection: z
      .object({
        note: z.string().optional(),
        phrases: z.array(InjectionPhraseSchema).min(1).max(SECURITY_SIGNATURE_MAX_LIST_ITEMS),
        instructionObjects: signatureList,
        objectModifiers: signatureList,
      })
      .strict(),
    hiddenInstructions: z
      .object({
        note: z.string().optional(),
        htmlComment: RegexSpecSchema,
        pseudoTag: RegexSpecSchema,
        modelAddress: RegexSpecSchema,
      })
      .strict(),
    invisibleCodePointRanges: z
      .array(z.tuple([z.number().int().nonnegative(), z.number().int().nonnegative()]))
      .min(1)
      .max(SECURITY_SIGNATURE_MAX_LIST_ITEMS),
    invisibleCodePointRangesNote: z.string().optional(),
    destructiveVerbs: signatureList,
    destructiveVerbsNote: z.string().optional(),
    mutatingVerbsInName: signatureList,
    mutatingVerbsInNameNote: z.string().optional(),
    mutatingVerbsInDescription: signatureList,
    mutatingVerbsInDescriptionNote: z.string().optional(),
    readVerbsInName: signatureList,
    weakMutatingVerbsInName: signatureList,
    /** How many tokens may precede a weak verb (`set`/`put`) and still leave it "leading". */
    weakVerbMaxLeadingOffset: z.number().int().nonnegative().max(10),
    openWorldNameTerms: signatureList,
    openWorldDescriptionTerms: signatureList,
    openWorldNote: z.string().optional(),
    openWorldPhrase: RegexSpecSchema,
    secretParameterPattern: RegexSpecSchema,
    secretParameterMeasurementSuffixes: signatureList,
    secretParameterNote: z.string().optional(),
    broadOauthScopePatterns: z
      .array(RegexSpecSchema)
      .min(1)
      .max(SECURITY_SIGNATURE_MAX_LIST_ITEMS),
    broadOauthScopeNote: z.string().optional(),
    broadAllowedToolPatterns: z
      .array(RegexSpecSchema)
      .min(1)
      .max(SECURITY_SIGNATURE_MAX_LIST_ITEMS),
    broadAllowedToolNote: z.string().optional(),
    /** File extension → the language label the Skills inspector and the MCP tool both report. */
    skillScriptLangLabels: z.record(signatureWord),
    skillNetworkRefPattern: RegexSpecSchema,
    skillNetworkRefNote: z.string().optional(),
  })
  .strict();

export type SecuritySignaturesDoc = z.infer<typeof SecuritySignaturesSchema>;

// ── Pattern construction — the ONE definition ───────────────────────────────────────────────────

/**
 * Escape a literal for embedding in a `RegExp`. The phrase/verb lists are data, but building the
 * pattern from them is what keeps the LIST the single declaration.
 */
export function escapeRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * A whole-token matcher over a word list: the word must be bounded by a non-alphanumeric on the left
 * and not be followed by one on the right. `drop` matches in `drop_table` and in `drop table`, and
 * does NOT match inside `dropdown`; `delete` does not match inside `undelete`.
 */
export function tokenPattern(words: readonly string[], flags = "i"): RegExp {
  const alternatives = words.map(escapeRegExp).join("|");
  return new RegExp(`(?:^|[^a-zA-Z0-9])(${alternatives})(?![a-zA-Z0-9])`, flags);
}

// ── The compiled tables ─────────────────────────────────────────────────────────────────────────

/** Which of the three hidden-instruction shapes fired. */
export type HiddenInstructionKind = "html-comment" | "pseudo-tag" | "model-address";

/** A hidden-instruction matcher, with the phrase a finding's message reads back. */
export type HiddenInstructionPattern = {
  kind: HiddenInstructionKind;
  label: string;
  pattern: RegExp;
};

/**
 * Everything the two analyzers read, with every `RegExp` already built. Nothing in here is compiled
 * per call: a rule that builds a regex on every tool would pay for it once per tool per scan, and —
 * worse — a malformed one would fail at scan time rather than at load time (D-DP9).
 */
export type CompiledSecuritySignatures = {
  evidenceContextChars: number;
  maxDescriptionChars: number;
  schemaWalkMaxDepth: number;
  schemaWalkMaxNodes: number;

  injectionPhrases: readonly InjectionPhrase[];
  injectionInstructionObjects: readonly string[];
  injectionObjectModifiers: readonly string[];
  /** In declaration order — `findInjectionPhrases` breaks an offset tie on it (D-SP6). */
  injectionPatterns: readonly { entry: InjectionPhrase; pattern: RegExp }[];

  htmlCommentPattern: RegExp;
  pseudoTagPattern: RegExp;
  modelAddressPattern: RegExp;
  /** In declaration order, for the same tie-break reason. */
  hiddenInstructionPatterns: readonly HiddenInstructionPattern[];

  invisibleCodePointRanges: readonly (readonly [number, number])[];

  destructiveVerbs: readonly string[];
  destructiveVerbPattern: RegExp;

  mutatingVerbsInName: readonly string[];
  mutatingNameTokens: ReadonlySet<string>;
  mutatingVerbsInDescription: readonly string[];
  mutatingDescriptionPattern: RegExp;
  readVerbsInName: readonly string[];
  readNameTokens: ReadonlySet<string>;
  weakMutatingVerbsInName: readonly string[];
  weakMutatingNameTokens: ReadonlySet<string>;
  weakVerbMaxLeadingOffset: number;

  openWorldNameTerms: readonly string[];
  openWorldNamePattern: RegExp;
  openWorldDescriptionTerms: readonly string[];
  openWorldDescriptionPattern: RegExp;
  openWorldPhrasePattern: RegExp;

  secretParameterPattern: RegExp;
  secretParameterMeasurementSuffixes: readonly string[];

  broadOauthScopePatterns: readonly RegExp[];
  broadAllowedToolPatterns: readonly RegExp[];

  skillScriptLangLabels: Readonly<Record<string, string>>;
  skillNetworkRefPattern: RegExp;
};

export type SecuritySignaturesCompilation =
  | { ok: true; signatures: CompiledSecuritySignatures }
  | { ok: false; violations: SecurityTableViolation[] };

function compileSpec(
  spec: RegexSpec,
  path: string,
  violations: SecurityTableViolation[],
): RegExp | null {
  if (spec.source.length > SECURITY_PATTERN_MAX_SOURCE_CHARS) {
    violations.push({
      path,
      message: `pattern source is ${spec.source.length} characters, over the ${SECURITY_PATTERN_MAX_SOURCE_CHARS}-character cap`,
    });
    return null;
  }
  try {
    return new RegExp(spec.source, spec.flags);
  } catch (error) {
    violations.push({
      path,
      message: `pattern does not compile: ${error instanceof Error ? error.message : String(error)}`,
    });
    return null;
  }
}

/**
 * Validate a signature document and build every `RegExp` in it, ONCE.
 *
 * Returns violations rather than throwing, because the caller is the pack loader and a bad pack is a
 * refusal (a value), never an exception that takes boot down (D-DP4/D-DP9).
 */
export function compileSecuritySignatures(document: unknown): SecuritySignaturesCompilation {
  const parsed = SecuritySignaturesSchema.safeParse(document);
  if (!parsed.success) {
    return {
      ok: false,
      violations: parsed.error.issues.map((issue) => ({
        path: issue.path.join(".") || "<root>",
        message: issue.message,
      })),
    };
  }
  const doc = parsed.data;
  const violations: SecurityTableViolation[] = [];

  const htmlCommentPattern = compileSpec(
    doc.hiddenInstructions.htmlComment,
    "hiddenInstructions.htmlComment",
    violations,
  );
  const pseudoTagPattern = compileSpec(
    doc.hiddenInstructions.pseudoTag,
    "hiddenInstructions.pseudoTag",
    violations,
  );
  const modelAddressPattern = compileSpec(
    doc.hiddenInstructions.modelAddress,
    "hiddenInstructions.modelAddress",
    violations,
  );
  const openWorldPhrasePattern = compileSpec(doc.openWorldPhrase, "openWorldPhrase", violations);
  const secretParameterPattern = compileSpec(
    doc.secretParameterPattern,
    "secretParameterPattern",
    violations,
  );
  const skillNetworkRefPattern = compileSpec(
    doc.skillNetworkRefPattern,
    "skillNetworkRefPattern",
    violations,
  );
  const broadOauthScopePatterns = doc.broadOauthScopePatterns.map((spec, index) =>
    compileSpec(spec, `broadOauthScopePatterns.${index}`, violations),
  );
  const broadAllowedToolPatterns = doc.broadAllowedToolPatterns.map((spec, index) =>
    compileSpec(spec, `broadAllowedToolPatterns.${index}`, violations),
  );

  for (const [index, range] of doc.invisibleCodePointRanges.entries()) {
    if (range[0] > range[1]) {
      violations.push({
        path: `invisibleCodePointRanges.${index}`,
        message: `range starts at ${range[0]} and ends at ${range[1]}, so it matches nothing`,
      });
    }
  }

  if (violations.length > 0) return { ok: false, violations };

  // Every `compileSpec` returned non-null, because a null pushed a violation and we returned above.
  const required = (value: RegExp | null): RegExp => value as RegExp;

  const injectionPatterns = doc.injection.phrases.map((entry) => {
    const literal = escapeRegExp(entry.phrase).replace(/ /g, String.raw`\s+`);
    const object = entry.requiresInstructionObject
      ? `(?:\\s+(?:${doc.injection.objectModifiers.join("|")}))*\\s+(?:${doc.injection.instructionObjects.join("|")})\\b`
      : "";
    return { entry, pattern: new RegExp(literal + object, "i") };
  });

  const html = required(htmlCommentPattern);
  const pseudo = required(pseudoTagPattern);
  const address = required(modelAddressPattern);

  return {
    ok: true,
    signatures: {
      evidenceContextChars: doc.evidenceContextChars,
      maxDescriptionChars: doc.maxDescriptionChars,
      schemaWalkMaxDepth: doc.schemaWalkMaxDepth,
      schemaWalkMaxNodes: doc.schemaWalkMaxNodes,

      injectionPhrases: doc.injection.phrases,
      injectionInstructionObjects: doc.injection.instructionObjects,
      injectionObjectModifiers: doc.injection.objectModifiers,
      injectionPatterns,

      htmlCommentPattern: html,
      pseudoTagPattern: pseudo,
      modelAddressPattern: address,
      hiddenInstructionPatterns: [
        { kind: "html-comment", label: "an HTML comment", pattern: html },
        { kind: "pseudo-tag", label: "an uppercase pseudo-tag", pattern: pseudo },
        {
          kind: "model-address",
          label: "an instruction addressed to the model",
          pattern: address,
        },
      ],

      invisibleCodePointRanges: doc.invisibleCodePointRanges.map(
        (range) => [range[0], range[1]] as const,
      ),

      destructiveVerbs: doc.destructiveVerbs,
      destructiveVerbPattern: tokenPattern(doc.destructiveVerbs),

      mutatingVerbsInName: doc.mutatingVerbsInName,
      mutatingNameTokens: new Set(doc.mutatingVerbsInName),
      mutatingVerbsInDescription: doc.mutatingVerbsInDescription,
      mutatingDescriptionPattern: tokenPattern(doc.mutatingVerbsInDescription),
      readVerbsInName: doc.readVerbsInName,
      readNameTokens: new Set(doc.readVerbsInName),
      weakMutatingVerbsInName: doc.weakMutatingVerbsInName,
      weakMutatingNameTokens: new Set(doc.weakMutatingVerbsInName),
      weakVerbMaxLeadingOffset: doc.weakVerbMaxLeadingOffset,

      openWorldNameTerms: doc.openWorldNameTerms,
      openWorldNamePattern: tokenPattern(doc.openWorldNameTerms),
      openWorldDescriptionTerms: doc.openWorldDescriptionTerms,
      openWorldDescriptionPattern: tokenPattern(doc.openWorldDescriptionTerms),
      openWorldPhrasePattern: required(openWorldPhrasePattern),

      secretParameterPattern: required(secretParameterPattern),
      secretParameterMeasurementSuffixes: doc.secretParameterMeasurementSuffixes,

      broadOauthScopePatterns: broadOauthScopePatterns.map(required),
      broadAllowedToolPatterns: broadAllowedToolPatterns.map(required),

      skillScriptLangLabels: doc.skillScriptLangLabels,
      skillNetworkRefPattern: required(skillNetworkRefPattern),
    },
  };
}

// ── The seam ────────────────────────────────────────────────────────────────────────────────────

/** The rule registry and the signature tables, as one indivisible unit (D-DP2). */
export type SecurityTables = {
  /** The analyzer version the rules were declared at — echoed into every report's `score`. */
  analyzerVersion: number;
  /** Keyed by rule id. `SECURITY_RULES` in `security-posture.ts` is this map's bundled value. */
  rules: Readonly<Record<string, SecurityRule>>;
  /** Every rule id ever shipped, append-only (D-DP6). */
  idLedger: readonly string[];
  signatures: CompiledSecuritySignatures;
};

let installed: SecurityTables | null = null;
let bundled: SecurityTables | null = null;

/**
 * The compiled-in tables, from `security-tables.generated.ts`. Built once, lazily, because it costs
 * a dozen `new RegExp` calls and a browser bundle that never opens a Security tab should not pay for
 * them at import time.
 *
 * A failure here is NOT a data problem — the generated module is written by the pack build from a
 * schema-validated pack, so a violation means the build shipped something broken. It throws, for the
 * same reason a missing bundled snapshot throws in `apps/api/src/data-pack/resolve.ts`: serving an
 * analyzer with no phrase list would report a poisoned server as clean.
 */
export function bundledSecurityTables(): SecurityTables {
  if (bundled) return bundled;
  const compiled = compileSecuritySignatures(BUNDLED_SECURITY_SIGNATURES);
  if (!compiled.ok) {
    throw new Error(
      "The compiled-in security signature tables are unusable: " +
        compiled.violations.map((v) => `${v.path}: ${v.message}`).join("; ") +
        ". This is a broken build artifact, not a data problem — regenerate with `pnpm build:data-pack`.",
    );
  }
  bundled = {
    analyzerVersion: BUNDLED_SECURITY_ANALYZER_VERSION,
    rules: BUNDLED_SECURITY_RULES,
    idLedger: BUNDLED_SECURITY_RULE_ID_LEDGER,
    signatures: compiled.signatures,
  };
  return bundled;
}

/**
 * Put the resolved pack's tables in force. ONE assignment, so there is no window in which half of
 * one pack and half of another is readable (D-DP2). Called once, from `apps/api/src/index.ts`,
 * beside `installDataPackSource`.
 */
export function installSecurityTables(tables: SecurityTables): void {
  installed = tables;
}

/** The tables in force: the installed pack's, or the compiled-in bundled snapshot. */
export function getSecurityTables(): SecurityTables {
  return installed ?? bundledSecurityTables();
}

/** The signature half of {@link getSecurityTables}, which is all either analyzer ever needs. */
export function securitySignatures(): CompiledSecuritySignatures {
  return getSecurityTables().signatures;
}

/**
 * Clear the slot. For tests only — production installs once and never uninstalls, and the name says
 * so loudly enough that a call site in `src/` reads as a mistake.
 */
export function resetSecurityTablesForTests(): void {
  installed = null;
}
