// RM-38 WP 2.1 — the security rule registry, its frozen id ledger, and every signature list, as pack
// data.
//
// Four things are proved here, and each one names what it cannot see:
//
//   1. **The literals are gone from the code.** A source scan over `apps/api/src/security/**` and
//      `packages/shared/src/skill-security.ts`.
//   2. **The pack IS the source of truth**, and the compiled-in `security-tables.generated.ts` is
//      its faithful, regenerable snapshot.
//   3. **Regex is data under a cap (D-DP9)** — compiled once, at load; a bad one refuses the pack.
//   4. **D-DP6 / D-DP7 / rule-set equality are load-time refusals**, not documentation.
//
// A NOTE ON THE SOURCE SCANS, because this item has already been burned by one. A scan that reads
// UN-STRIPPED source asserts "nobody wrote this string", never "the code does not do this" — and the
// thing most likely to keep a moved string alive is a COMMENT describing where it used to live,
// which is exactly the sentence a relocation invites you to write. Every scan below therefore
// strips comments first, and each was probed twice: once by putting the literal back as code (red),
// and once by putting the code back AND adding a plausible comment naming it (still red). The first
// probe passes on a broken guard; only the second distinguishes them.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import {
  BUNDLED_SECURITY_ANALYZER_VERSION,
  BUNDLED_SECURITY_RULES,
  BUNDLED_SECURITY_RULE_ID_LEDGER,
  BUNDLED_SECURITY_SIGNATURES,
  SECURITY_ANALYZER_VERSION,
  SECURITY_PATTERN_MAX_SOURCE_CHARS,
  SECURITY_RULES,
  SECURITY_RULE_IDS,
  type SecurityRuleRegistryDoc,
  SecurityRuleRegistryDocSchema,
  checkSecurityRuleLedger,
  checkSecurityRuleSet,
  checkSecuritySeverityBump,
  compileSecuritySignatures,
  securitySignatures,
} from "@mcp-token-footprint/shared";
import { renderSecurityGeneratedFromPack } from "../../../data-pack/build/security.js";
import { SERVER_ANALYZER_RULE_IDS } from "../src/security/analyzer.js";
import { SKILL_ANALYZER_RULE_IDS } from "../src/security/skill-analyzer.js";

const REPO_ROOT = path.resolve(import.meta.dirname, "../../..");
const PACK_ROOT = path.join(REPO_ROOT, "data-pack");
const API_SECURITY_SRC = path.join(REPO_ROOT, "apps/api/src/security");
const SHARED_SRC = path.join(REPO_ROOT, "packages/shared/src");

/**
 * Drop `/* … *\/` and `// …` so a scan reads CODE, not prose. The `[^:]` guard keeps a `://` inside a
 * string literal from being mistaken for a line comment. Same shape as
 * `apps/api/test/data-pack-seam.test.ts`'s helper, which learned this the expensive way.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

function walkTs(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) walkTs(abs, out);
    else if (entry.name.endsWith(".ts")) out.push(abs);
  }
  return out;
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
// 1 — the literals are gone from the code
// ══════════════════════════════════════════════════════════════════════════════════════════════

/**
 * Distinctive members of the moved lists — chosen so a hit is unambiguous. A generic verb
 * (`delete`, `remove`) appears all over this codebase for unrelated reasons and would make the scan
 * fire on innocent code; these do not.
 *
 * WHAT THIS SCAN CANNOT SEE: a list re-introduced under DIFFERENT words. It proves these particular
 * lists did not come back, not that no phrase list exists anywhere. That is why the byte-identity
 * guard (`security-pack-identity.test.ts`) exists beside it — a second copy that actually changed a
 * verdict moves those four hashes.
 */
const MOVED_LITERALS = [
  "before using any other tool", // injection phrase list
  "override your instructions", // injection phrase list
  "without telling the user", // injection phrase list
  "truncating", // destructive verb list
  "passwd", // credential-shaped parameter matcher
  "full[_-]?access", // broad OAuth scope patterns
];

test("no security signature literal survives in apps/api/src/security or shared's skill-security", () => {
  const scanned = [...walkTs(API_SECURITY_SRC), path.join(SHARED_SRC, "skill-security.ts")];
  const offenders: string[] = [];
  for (const file of scanned) {
    const code = stripComments(readFileSync(file, "utf8"));
    for (const literal of MOVED_LITERALS) {
      if (code.includes(literal)) offenders.push(`${path.relative(REPO_ROOT, file)} → "${literal}"`);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    "a signature list came back into the code; it belongs in data-pack/security/signatures.json",
  );
});

test("the scan is not vacuous: every literal it looks for IS in the pack", () => {
  // Without this, deleting a term from the pack would make the scan above trivially pass forever.
  const signatures = readFileSync(path.join(PACK_ROOT, "security/signatures.json"), "utf8");
  for (const literal of MOVED_LITERALS) {
    assert.ok(signatures.includes(literal), `"${literal}" is not in the pack at all`);
  }
});

test("the comment-stripper actually strips (the guard's own guard)", () => {
  // The failure this file's header describes, reproduced in miniature: a scan over UN-stripped
  // source is satisfied by a sentence, so the stripper is the load-bearing part of every scan above.
  const withComment = '// we used to keep "before using any other tool" here\nconst x = 1;';
  assert.equal(withComment.includes("before using any other tool"), true);
  assert.equal(stripComments(withComment).includes("before using any other tool"), false);
  // …and it must not strip a URL inside a string literal, which would hide real code.
  assert.ok(stripComments('const u = "https://example.com/x";').includes("example.com"));
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
// 2 — the pack is the source of truth; the generated module is its snapshot
// ══════════════════════════════════════════════════════════════════════════════════════════════

test("security-tables.generated.ts is not stale vs data-pack/security/** (re-render + byte-compare)", () => {
  const onDisk = readFileSync(path.join(SHARED_SRC, "security-tables.generated.ts"), "utf8");
  assert.equal(
    renderSecurityGeneratedFromPack(PACK_ROOT),
    onDisk,
    "regenerate with `pnpm build:data-pack` — the pack is the authoring copy, this file is derived",
  );
});

test("the bundled snapshot really is the pack's bytes, field for field", () => {
  const rules = JSON.parse(
    readFileSync(path.join(PACK_ROOT, "security/rules.json"), "utf8"),
  ) as SecurityRuleRegistryDoc;
  assert.equal(BUNDLED_SECURITY_ANALYZER_VERSION, rules.analyzerVersion);
  assert.deepEqual([...BUNDLED_SECURITY_RULE_ID_LEDGER], rules.idLedger);
  assert.deepEqual(
    Object.values(BUNDLED_SECURITY_RULES).map((rule) => rule.id),
    rules.rules.map((rule) => rule.id),
  );
  const signatures = JSON.parse(
    readFileSync(path.join(PACK_ROOT, "security/signatures.json"), "utf8"),
  );
  assert.equal(
    createHash("sha256").update(JSON.stringify(BUNDLED_SECURITY_SIGNATURES)).digest("hex"),
    createHash("sha256").update(JSON.stringify(signatures)).digest("hex"),
  );
});

test("the pack's rules.json satisfies the compiled-in contract, and equals SECURITY_RULES", () => {
  const parsed = SecurityRuleRegistryDocSchema.parse(
    JSON.parse(readFileSync(path.join(PACK_ROOT, "security/rules.json"), "utf8")),
  );
  assert.equal(parsed.rules.length, 18);
  assert.deepEqual(
    parsed.rules.map((rule) => rule.id),
    SECURITY_RULE_IDS,
  );
  assert.equal(parsed.analyzerVersion, SECURITY_ANALYZER_VERSION);
  for (const rule of parsed.rules) {
    assert.deepEqual(SECURITY_RULES[rule.id as keyof typeof SECURITY_RULES], rule);
  }
});

test("the pack's idLedger is exactly the eighteen ids, in declaration order", () => {
  assert.deepEqual([...BUNDLED_SECURITY_RULE_ID_LEDGER], SECURITY_RULE_IDS);
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
// 3 — rule-set equality, BOTH directions (WP 2.1 scope item 4)
// ══════════════════════════════════════════════════════════════════════════════════════════════

test("the rule set the analyzers can emit equals the rule set the pack declares, both ways", () => {
  const emitted = [...SERVER_ANALYZER_RULE_IDS, ...SKILL_ANALYZER_RULE_IDS].sort();
  const declared = [...SECURITY_RULE_IDS].sort();
  assert.deepEqual(emitted, declared, "a declared rule no analyzer implements, or the reverse");
  // …and stated the other way round, so a reader does not have to trust one `deepEqual` to have
  // covered both directions.
  for (const id of declared) assert.ok(emitted.includes(id), `${id} is declared but never emitted`);
  for (const id of emitted) assert.ok(declared.includes(id), `${id} is emitted but never declared`);
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
// 4 — regex is data, compiled once, under a cap (D-DP9)
// ══════════════════════════════════════════════════════════════════════════════════════════════

test("every pattern in the pack compiles, and none exceeds the source cap", () => {
  const compiled = compileSecuritySignatures(
    JSON.parse(readFileSync(path.join(PACK_ROOT, "security/signatures.json"), "utf8")),
  );
  assert.ok(compiled.ok, `the shipped signatures do not compile: ${JSON.stringify(compiled)}`);
  if (!compiled.ok) return;
  const patterns = [
    compiled.signatures.htmlCommentPattern,
    compiled.signatures.pseudoTagPattern,
    compiled.signatures.modelAddressPattern,
    compiled.signatures.openWorldPhrasePattern,
    compiled.signatures.secretParameterPattern,
    compiled.signatures.skillNetworkRefPattern,
    ...compiled.signatures.broadOauthScopePatterns,
    ...compiled.signatures.broadAllowedToolPatterns,
  ];
  for (const pattern of patterns) {
    assert.ok(pattern instanceof RegExp);
    assert.ok(
      pattern.source.length <= SECURITY_PATTERN_MAX_SOURCE_CHARS,
      `${pattern.source.slice(0, 40)}… is over the cap`,
    );
    // A shared `g` flag would carry `lastIndex` between calls and make a report depend on what ran
    // before it (D-SP6). The schema forbids it; this is the belt.
    assert.equal(pattern.global, false, `${pattern.source} carries the g flag`);
  }
});

test("a pattern whose source exceeds the cap REFUSES, and says so as a cap violation", () => {
  const doc = JSON.parse(readFileSync(path.join(PACK_ROOT, "security/signatures.json"), "utf8"));
  // Catastrophic backtracking, and long: `(a+)+$` nested past the cap. Both properties matter — the
  // cap is what makes "this is unreviewable" mechanical, without the loader having to decide whether
  // an arbitrary pattern is dangerous.
  const evil = `(${"a+".repeat(200)})+$`;
  assert.ok(evil.length > SECURITY_PATTERN_MAX_SOURCE_CHARS, "the probe must actually exceed the cap");
  doc.secretParameterPattern = { source: evil, flags: "" };
  const compiled = compileSecuritySignatures(doc);
  assert.equal(compiled.ok, false);
  if (compiled.ok) return;
  // The cap bites in the SCHEMA, before compilation is even attempted — which is the right order:
  // an oversized source is refused as unreviewable rather than handed to the regex engine to find
  // out. `compileSpec` re-checks it as a belt for a caller that reaches it without the schema.
  assert.ok(
    compiled.violations.some(
      (violation) =>
        violation.path.startsWith("secretParameterPattern") &&
        new RegExp(`${SECURITY_PATTERN_MAX_SOURCE_CHARS} character|cap`, "i").test(violation.message),
    ),
    `expected a cap violation naming ${SECURITY_PATTERN_MAX_SOURCE_CHARS}, got ${JSON.stringify(compiled.violations)}`,
  );
  // …and a pattern one character UNDER the cap is accepted, so the cap is a real boundary rather
  // than a rejection of anything long.
  doc.secretParameterPattern = { source: "a".repeat(SECURITY_PATTERN_MAX_SOURCE_CHARS), flags: "" };
  assert.equal(compileSecuritySignatures(doc).ok, true);
});

test("a pattern that does not compile REFUSES rather than throwing later", () => {
  const doc = JSON.parse(readFileSync(path.join(PACK_ROOT, "security/signatures.json"), "utf8"));
  doc.hiddenInstructions.pseudoTag = { source: "([unclosed", flags: "" };
  const compiled = compileSecuritySignatures(doc);
  assert.equal(compiled.ok, false);
  if (compiled.ok) return;
  assert.ok(
    compiled.violations.some((violation) => violation.path === "hiddenInstructions.pseudoTag"),
    JSON.stringify(compiled.violations),
  );
});

test("the compiled tables are built ONCE — two reads return the same RegExp objects", () => {
  // Not a micro-optimisation check: a per-call `new RegExp` would move a malformed pattern's failure
  // from load time (a refusal) to scan time (a 500 on a report an operator asked for).
  assert.equal(securitySignatures(), securitySignatures());
  assert.equal(securitySignatures().secretParameterPattern, securitySignatures().secretParameterPattern);
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
// 5 — D-DP6 and D-DP7 as pure functions (the load-time wiring is in data-pack-loader.test.ts)
// ══════════════════════════════════════════════════════════════════════════════════════════════

function packRulesDoc(): SecurityRuleRegistryDoc {
  return SecurityRuleRegistryDocSchema.parse(
    JSON.parse(readFileSync(path.join(PACK_ROOT, "security/rules.json"), "utf8")),
  );
}

test("D-DP6 — an append is fine; a drop, a rename and a re-order are refused", () => {
  const bundled = [...BUNDLED_SECURITY_RULE_ID_LEDGER];
  assert.equal(checkSecurityRuleLedger(bundled), null);
  assert.equal(checkSecurityRuleLedger([...bundled, "poisoning.some-future-rule"]), null);

  const dropped = bundled.slice(0, -1);
  assert.match(checkSecurityRuleLedger(dropped)?.reason ?? "", /append-only/);

  const renamed = [...bundled];
  renamed[0] = "poisoning.injection-phrasing-v2";
  assert.match(checkSecurityRuleLedger(renamed)?.reason ?? "", /diverges at position 0/);

  const reordered = [bundled[1] as string, bundled[0] as string, ...bundled.slice(2)];
  assert.match(checkSecurityRuleLedger(reordered)?.reason ?? "", /diverges at position 0/);
});

test("D-DP7 — a severity change needs a GREATER analyzerVersion, in both directions", () => {
  const doc = packRulesDoc();
  assert.equal(checkSecuritySeverityBump(doc), null, "the shipped pack must be self-consistent");

  const lowered = packRulesDoc();
  const target = lowered.rules.find((rule) => rule.severity === "error");
  assert.ok(target, "the registry must declare at least one error rule for this probe to apply");
  target.severity = "info";
  assert.match(
    checkSecuritySeverityBump(lowered)?.reason ?? "",
    /analyzerVersion is 4, not greater/,
    "lowering a severity at the same analyzerVersion must be refused",
  );

  // Raising one is refused just as firmly: either direction makes two reports incomparable.
  const raised = packRulesDoc();
  const info = raised.rules.find((rule) => rule.severity === "info");
  assert.ok(info);
  info.severity = "error";
  assert.ok(checkSecuritySeverityBump(raised) !== null);

  // …and with the bump, it is accepted.
  lowered.analyzerVersion = SECURITY_ANALYZER_VERSION + 1;
  assert.equal(checkSecuritySeverityBump(lowered), null);
});

test("the rule SET must match the analyzers, both ways, at load too", () => {
  const doc = packRulesDoc();
  assert.equal(checkSecurityRuleSet(doc), null);

  const extra = packRulesDoc();
  extra.rules.push({
    id: "poisoning.invented-rule",
    category: "poisoning",
    subject: "server",
    severity: "info",
    title: "Invented",
    rationale: "A rule no analyzer implements would be declared and never emitted, forever.",
  });
  assert.match(checkSecurityRuleSet(extra)?.reason ?? "", /no analyzer implements/);

  const short = packRulesDoc();
  short.rules = short.rules.slice(1);
  assert.match(checkSecurityRuleSet(short)?.reason ?? "", /an analyzer emits/);
});
