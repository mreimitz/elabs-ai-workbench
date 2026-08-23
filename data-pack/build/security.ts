// Renders `packages/shared/src/security-tables.generated.ts` from the pack's two security documents
// (RM-38 WP 2.1).
//
// WHY A GENERATED TS MODULE AT ALL, when the pack is the source of truth
// ---------------------------------------------------------------------
// `apps/api` reads the resolved pack off disk, so a REFRESHED pack changes its tables with no
// release. `apps/web` cannot: a browser bundle has no filesystem, and the Security tab still has to
// name a rule's title and count the registry. The generated module is the BUNDLED SNAPSHOT for
// those consumers — exactly the job `model-data.generated.ts` already does for the model roster
// (RM-38 WP 1.1). It is derived, never authored: `apps/api/test/security-tables.test.ts` re-renders
// it in memory and byte-compares, so a hand edit or a stale file is a red gate, not a silent drift.
//
// It also serves a second, load-bearing purpose: it is the BUNDLED REGISTRY that D-DP6 and D-DP7
// compare a candidate pack against. Without a compiled-in reference there is nothing to be
// append-only *to*.
//
// Determinism: the output is a pure function of the two JSON documents' bytes. No clock, no path,
// no environment. `JSON.stringify(…, null, 2)` preserves array order, which the injection phrase
// list and the hidden-instruction list both depend on (D-SP6 breaks an offset tie on declaration
// order).

import { readFileSync } from "node:fs";
import path from "node:path";

/** The pack-root-relative paths this generator reads. */
export const SECURITY_RULES_PATH = "security/rules.json";
export const SECURITY_SIGNATURES_PATH = "security/signatures.json";

type RuleEntry = {
  id: string;
  category: string;
  subject: string;
  severity: string;
  title: string;
  rationale: string;
  deprecated?: true;
};

type RulesDoc = {
  analyzerVersion: number;
  idLedger: string[];
  rules: RuleEntry[];
};

/**
 * Indent every line of an already-serialized JSON value, so it nests inside a `const` declaration
 * without the generator having to re-implement a printer.
 */
function indent(json: string, spaces: number): string {
  const pad = " ".repeat(spaces);
  return json
    .split("\n")
    .map((line, index) => (index === 0 ? line : `${pad}${line}`))
    .join("\n");
}

export function renderSecurityGenerated(rulesJson: string, signaturesJson: string): string {
  const rules = JSON.parse(rulesJson) as RulesDoc;
  const signatures = JSON.parse(signaturesJson) as unknown;

  // Keyed by id, in the document's declaration order — `SECURITY_RULE_IDS` is `Object.keys` of this
  // and several reports iterate it, so the order is contract, not presentation.
  const keyed: Record<string, RuleEntry> = {};
  for (const rule of rules.rules) keyed[rule.id] = rule;

  const lines = [
    "// GENERATED — do not edit by hand.",
    "// Source of truth: data-pack/security/{rules,signatures}.json; regenerate with `pnpm build:data-pack`.",
    "//",
    "// This module imports NOTHING, at runtime or as a type. It is the bundled snapshot of the pack's",
    "// security tables: the fallback for consumers that cannot read a pack off disk (the browser",
    "// bundle), and the reference a candidate pack's rule ledger and severities are checked against",
    "// (RM-38 D-DP6/D-DP7). `packages/shared/src/security-tables.ts` is what reads it.",
    "",
    "/** The analyzer version the BUNDLED rules were declared at. A pack may carry a greater one. */",
    `export const BUNDLED_SECURITY_ANALYZER_VERSION = ${rules.analyzerVersion};`,
    "",
    "/** Every rule id ever shipped. Append-only: a pack that drops or renames one is refused. */",
    `export const BUNDLED_SECURITY_RULE_ID_LEDGER = ${indent(JSON.stringify(rules.idLedger, null, 2), 0)} as const;`,
    "",
    "/** The rule registry, keyed by id, in declaration order. */",
    `export const BUNDLED_SECURITY_RULES = ${indent(JSON.stringify(keyed, null, 2), 0)} as const;`,
    "",
    "/** The signature tables, exactly as the pack declares them. Compiled by `security-tables.ts`. */",
    `export const BUNDLED_SECURITY_SIGNATURES = ${indent(JSON.stringify(signatures, null, 2), 0)} as const;`,
    "",
  ];
  return lines.join("\n");
}

/** Read both documents off a pack root and render the module. */
export function renderSecurityGeneratedFromPack(packRoot: string): string {
  return renderSecurityGenerated(
    readFileSync(path.join(packRoot, ...SECURITY_RULES_PATH.split("/")), "utf8"),
    readFileSync(path.join(packRoot, ...SECURITY_SIGNATURES_PATH.split("/")), "utf8"),
  );
}
