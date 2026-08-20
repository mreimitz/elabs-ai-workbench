// WP 2.3 (D-C17) — the packaged GitHub Actions gates ship as EXAMPLES, so a TEST is what keeps them
// honest.
//
// A live `.github/workflows/mcpfp-gate.yml` here would need a running workbench and a registered MCP
// server that this repo's CI does not have; it would be permanently red or permanently skipped, and
// a skipped gate in the repository that publishes gates is worse than no gate. So this repo keeps
// exactly one workflow (`mcp-self-scan.yml`, the D-MCP5 dogfood gate) and the examples are validated
// as TEXT instead — no YAML parser, no dependency (the spec's "the validation test reads text").
//
// What the reading buys, in order of how much it earns its keep:
//   • every shipped gate file still parses against `assertionDocumentSchema` — a schema change that
//     invalidated an example would otherwise be discovered by a stranger who copied it;
//   • no example reaches for `pnpm --silent` / `pnpm exec mcpfp` / `pnpm mcpfp` (D-C19) — pnpm's
//     banner lands on STDOUT and both forms collapse a non-zero exit onto 1, the code D-C7 reserves
//     for "an assertion failed";
//   • the scan and the assert stay SEPARATE steps (D-C9), so the exit code is attributable;
//   • every `uses:` is pinned and drawn from a fixed allow-list — adding a third-party action to a
//     workflow other people copy is a supply-chain decision, and this makes it a deliberate one;
//   • nothing token-shaped and no absolute local path appears in an example or in the guide.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import {
  assertionDocumentSchema,
  assertionRuleFamily,
  assertionTargetFamily,
  redactSecurityEvidence,
} from "@mcp-token-footprint/shared";

const REPO_ROOT = path.join(import.meta.dirname, "..", "..", "..");
const EXAMPLES_DIR = path.join(REPO_ROOT, "examples", "github-actions");
const WORKFLOWS_DIR = path.join(REPO_ROOT, ".github", "workflows");
const GUIDE_PATH = path.join(REPO_ROOT, "planning", "user-guide", "DC-19-ci-github-actions", "23-ci-github-actions.md");

/** The example workflows, by file name. Adding one here is the only edit a third topology needs. */
const WORKFLOW_FILES = ["mcpfp-footprint-gate.yml", "mcpfp-remote-gate.yml"] as const;

/**
 * The ONLY actions an example may use. Pinned to a major, and third-party-free apart from pnpm's own
 * setup action. The pull-request comment is posted with the preinstalled `gh` CLI precisely so this
 * list does not have to grow a commenting action nobody audits.
 */
const ALLOWED_ACTIONS = [
  "actions/checkout",
  "actions/setup-node",
  "actions/upload-artifact",
  "pnpm/action-setup",
] as const;

/** D-C19 — the three ways a copied workflow silently loses the difference between exit 1 and 2. */
const FORBIDDEN_INVOCATIONS: readonly (readonly [RegExp, string])[] = [
  [/pnpm\s+--silent/, "pnpm --silent collapses every non-zero exit onto 1 (D-C7/D-C19)"],
  [/pnpm\s+exec\s+mcpfp/, "pnpm exec collapses every non-zero exit onto 1 (D-C7/D-C19)"],
  [/pnpm\s+mcpfp/, "pnpm prints its banner on stdout, corrupting --format json (D-C19)"],
];

/** The CLI entry point every example must call, and the only spelling of it that is allowed. */
const CLI_ENTRY_POINT = "node apps/cli/dist/index.js";

/** Absolute paths from somebody's machine. An artifact carries none, and neither does an example. */
const ABSOLUTE_LOCAL_PATHS = [/\/Users\//, /\/home\/[a-z]/, /\/root\//, /[A-Z]:\\/];

function read(file: string): string {
  return fs.readFileSync(file, "utf8");
}

/**
 * The lines a runner would EXECUTE — comments dropped.
 *
 * Every one of these files carries a banner explaining, in prose, why `pnpm --silent` and
 * `continue-on-error` must not appear. A checker that read those explanations as violations would
 * make the only honest way to document the rule a way to break it.
 */
function executableLines(text: string): readonly { line: string; number: number }[] {
  return text
    .split("\n")
    .map((line, index) => ({ line, number: index + 1 }))
    .filter(({ line }) => !line.trim().startsWith("#"));
}

const workflows = WORKFLOW_FILES.map((name) => ({
  name,
  text: read(path.join(EXAMPLES_DIR, name)),
}));

/**
 * Split a workflow's text into one chunk per `steps:` entry, by the six-space `- ` that starts one.
 *
 * Deliberately crude: it is a containment test ("does the scan live in the same step as the
 * assert?"), not a parse. A comment between two steps lands at the end of the earlier chunk, which
 * is harmless — the assertions below look for the CLI entry point, never for prose.
 */
function stepChunks(text: string): string[] {
  const chunks: string[] = [];
  let current: string[] | null = null;
  for (const line of text.split("\n")) {
    if (/^ {6}- /.test(line)) {
      if (current) chunks.push(current.join("\n"));
      current = [line];
    } else if (current) {
      current.push(line);
    }
  }
  if (current) chunks.push(current.join("\n"));
  return chunks;
}

// ── A1 (D-C17) — the examples are examples; this repo still has exactly one workflow ────────────

test("A1 (D-C17) — the examples live outside .github/workflows, which still holds one workflow", () => {
  const live = fs.readdirSync(WORKFLOWS_DIR).sort();
  assert.deepEqual(
    live,
    ["mcp-self-scan.yml"],
    "this repository keeps exactly ONE workflow (the D-MCP5 dogfood gate). A packaged gate belongs in examples/github-actions/, where it cannot be permanently red or permanently skipped.",
  );

  for (const { name } of workflows) {
    assert.ok(
      fs.existsSync(path.join(EXAMPLES_DIR, name)),
      `${name} must ship under examples/github-actions/`,
    );
  }
});

// ── A5 — every action is pinned, and drawn from the allow-list ──────────────────────────────────

test("A5 — every `uses:` is pinned to a major and is on the allow-list", () => {
  const used = new Set<string>();
  for (const { name, text } of workflows) {
    for (const match of text.matchAll(/^\s*(?:- )?uses:\s*(\S+)\s*$/gm)) {
      const ref = match[1] ?? "";
      assert.match(ref, /@v\d+$/, `${name}: "${ref}" is not pinned to a major version`);
      used.add(ref.slice(0, ref.lastIndexOf("@")));
    }
  }
  assert.deepEqual(
    [...used].sort(),
    [...ALLOWED_ACTIONS].sort(),
    "the examples' action set changed. Adding a third-party action to a workflow other repositories copy is a supply-chain decision — make it deliberately, here.",
  );
});

test("A5 — the pull-request comment is posted with the `gh` CLI, not an action", () => {
  for (const { name, text } of workflows) {
    assert.ok(
      text.includes("gh pr comment"),
      `${name}: the comment must be posted with the preinstalled GitHub CLI`,
    );
  }
});

// ── A3 (D-C19) — the CLI is invoked as the built entry point, never through pnpm ────────────────

test("A3 (D-C19) — no example invokes the CLI through pnpm", () => {
  for (const { name, text } of workflows) {
    for (const { line, number } of executableLines(text)) {
      for (const [pattern, why] of FORBIDDEN_INVOCATIONS) {
        assert.ok(!pattern.test(line), `${name}:${number} matches ${pattern} — ${why}\n  ${line}`);
      }
    }
  }
});

test("A3 (D-C19) — every CLI call is `node apps/cli/dist/index.js`", () => {
  for (const { name, text } of workflows) {
    // Matched on `apps/cli`, not on `index.js`: topology A also starts `apps/api/dist/index.js`,
    // which is the workbench itself and has nothing to do with this rule.
    const invocations = executableLines(text).filter(({ line }) => line.includes("apps/cli"));

    assert.ok(
      invocations.length >= 2,
      `${name}: expected at least a measure step and an assert step calling the CLI`,
    );
    for (const { line, number } of invocations) {
      assert.ok(
        line.includes(CLI_ENTRY_POINT),
        `${name}:${number} references the CLI but not as \`${CLI_ENTRY_POINT}\`\n  ${line}`,
      );
    }
  }
});

// ── A4 — the scan and the assert are separate steps, and nothing hides a failing gate ───────────

test("A4 (D-C9) — the measure step and the assert step are distinct steps", () => {
  for (const { name, text } of workflows) {
    const chunks = stepChunks(text);
    const measuring = chunks.filter(
      (chunk) =>
        chunk.includes(`${CLI_ENTRY_POINT} scan`) || chunk.includes(`${CLI_ENTRY_POINT} suite run`),
    );
    const asserting = chunks.filter((chunk) => chunk.includes(`${CLI_ENTRY_POINT} assert`));

    assert.ok(measuring.length >= 1, `${name}: no step measures anything`);
    assert.ok(asserting.length >= 1, `${name}: no step asserts anything`);
    for (const chunk of measuring) {
      assert.ok(
        !chunk.includes(`${CLI_ENTRY_POINT} assert`),
        `${name}: a step both measures and asserts. Keep them separate (D-C9) so the job log says which one produced the exit code.\n${chunk}`,
      );
    }
  }
});

test("A4 — the comment and upload steps are `if: always()`, and nothing is continue-on-error", () => {
  for (const { name, text } of workflows) {
    for (const { line, number } of executableLines(text)) {
      assert.ok(
        !line.includes("continue-on-error"),
        `${name}:${number}: continue-on-error must never appear — a gate you allow to fail softly is not a gate\n  ${line}`,
      );
    }

    for (const chunk of stepChunks(text)) {
      const posts = chunk.includes("gh pr comment");
      const uploads = chunk.includes("actions/upload-artifact@");
      if (!posts && !uploads) continue;
      assert.ok(
        chunk.includes("if: always()"),
        `${name}: the ${posts ? "comment" : "upload"} step must run \`if: always()\` — a FAILING gate is the one whose reason a reviewer needs.\n${chunk}`,
      );
    }
  }
});

// ── A6 — no credential, no absolute local path ──────────────────────────────────────────────────

/**
 * Every whitespace-delimited word, through the security contract's own redactor (D-SP4), must come
 * back unchanged. Reusing that redactor rather than inventing a third set of masks is the point: the
 * examples are held to the same "credential-shaped" definition the posture analyzer's evidence is.
 */
function assertNothingCredentialShaped(label: string, text: string): void {
  text.split("\n").forEach((line, index) => {
    for (const word of line.split(/\s+/)) {
      if (word === "") continue;
      const { excerpt } = redactSecurityEvidence(word);
      assert.equal(
        excerpt,
        word,
        `${label}:${index + 1} contains something credential-shaped: ${excerpt}`,
      );
    }
  });
}

test("A6 — nothing token-shaped appears in an example or in the guide", () => {
  for (const { name, text } of workflows) assertNothingCredentialShaped(name, text);
  for (const file of fs.readdirSync(EXAMPLES_DIR).filter((f) => f.endsWith(".json"))) {
    assertNothingCredentialShaped(file, read(path.join(EXAMPLES_DIR, file)));
  }
  assertNothingCredentialShaped("planning/user-guide/DC-19-ci-github-actions/23-ci-github-actions.md", read(GUIDE_PATH));
});

test("A6 — the service token only ever comes from `${{ secrets.MCPFP_TOKEN }}`", () => {
  for (const { name, text } of workflows) {
    text.split("\n").forEach((line, index) => {
      if (!line.includes("MCPFP_TOKEN")) return;
      if (line.trim().startsWith("#")) return; // prose in the banner
      assert.match(
        line,
        /^\s*MCPFP_TOKEN:\s*\$\{\{\s*secrets\.MCPFP_TOKEN\s*\}\}\s*$/,
        `${name}:${index + 1} — the token may only be bound from a repository secret, never used in a run: line, an echo or a URL.\n  ${line}`,
      );
    });
  }
});

test("A6 — no absolute local path appears in an example or in the guide", () => {
  const files: readonly (readonly [string, string])[] = [
    ...workflows.map((wf) => [wf.name, wf.text] as const),
    ...fs
      .readdirSync(EXAMPLES_DIR)
      .filter((f) => f.endsWith(".json"))
      .map((f) => [f, read(path.join(EXAMPLES_DIR, f))] as const),
    ["planning/user-guide/DC-19-ci-github-actions/23-ci-github-actions.md", read(GUIDE_PATH)] as const,
  ];
  for (const [label, text] of files) {
    text.split("\n").forEach((line, index) => {
      for (const pattern of ABSOLUTE_LOCAL_PATHS) {
        assert.ok(
          !pattern.test(line),
          `${label}:${index + 1} carries an absolute local path (${pattern})\n  ${line}`,
        );
      }
    });
  }
});

// ── A7 — every shipped gate file still parses, and is single-family (D-C13) ─────────────────────

test("A7 (D-C13) — every gate file the workflows reference exists and parses", () => {
  const referenced = new Set<string>();
  for (const { text } of workflows) {
    for (const match of text.matchAll(/examples\/github-actions\/([A-Za-z0-9._-]+\.json)/g)) {
      referenced.add(match[1] ?? "");
    }
  }
  assert.ok(referenced.size >= 2, "both example gate files should be referenced by a workflow");

  for (const file of referenced) {
    assert.ok(
      fs.existsSync(path.join(EXAMPLES_DIR, file)),
      `${file} is referenced by a workflow but does not ship`,
    );
  }
});

test("A7 (D-C13) — every shipped gate file validates against assertionDocumentSchema", () => {
  const gateFiles = fs.readdirSync(EXAMPLES_DIR).filter((file) => file.endsWith(".json"));
  assert.ok(gateFiles.length >= 2, "a footprint gate and a quality gate should both ship");

  const families = new Set<string>();
  for (const file of gateFiles) {
    const document: unknown = JSON.parse(read(path.join(EXAMPLES_DIR, file)));
    const parsed = assertionDocumentSchema.safeParse(document);
    assert.ok(
      parsed.success,
      `${file} no longer validates: ${JSON.stringify(parsed.error?.issues ?? [])}`,
    );

    // D-C13, spelled out rather than left to the schema's refinement: one target, one family.
    const family = assertionTargetFamily(parsed.data.target);
    for (const rule of parsed.data.rules) {
      assert.equal(
        assertionRuleFamily(rule.rule),
        family,
        `${file} mixes families: "${rule.rule}" is not a ${family} rule`,
      );
    }
    families.add(family);
  }

  assert.deepEqual(
    [...families].sort(),
    ["scan", "suite"],
    "the examples should show BOTH families — a footprint gate and a quality gate, in two files",
  );
});
