import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, test } from "node:test";
import Database from "better-sqlite3";
import {
  diffSecurityReports,
  renderAssertionMarkdown,
  stampDataPackVersion,
  type AssertionReport,
  type SecurityFinding,
  type SecurityReport,
  type ToolScan,
} from "@mcp-token-footprint/shared";
import { getDataPack } from "../src/data-pack/source.js";
import { dataPackStamp } from "../src/data-pack/stamp.js";
import { applyMigrations, type AppDatabase } from "../src/db/database.js";
import { schemaSql } from "../src/db/schema.js";
import { OAuthRepository } from "../src/oauth/repository.js";
import { renderSecuritySection } from "../src/reports/security-section.js";
import { ScanRepository } from "../src/scans/repository.js";
import { SecretStore } from "../src/secrets/secret-store.js";
import { analyzeScan } from "../src/security/service.js";
import { ServerRepository } from "../src/servers/repository.js";

// ==================================================================================================
// The pack-version stamp — RM-38 WP 3.2, D-DP8
// ==================================================================================================
//
// **A verdict document that cannot name the data it was computed against is not reproducible**, and
// it is worthless if two builders can disagree about the version. So the stamp has exactly ONE
// definition (`stampDataPackVersion` in `packages/shared/src/data-pack.ts`, reached on the API side
// through `dataPackStamp()`), and every document builder makes one call to it.
//
// THIS FILE IS TWO HALVES AND NEITHER IS EVIDENCE ALONE.
//
//   * The BAN — the field literal appears in no source file under `apps/api/src`, and in exactly one
//     under `packages/shared/src`. A ban fails the SAFE way against comment-laundering: a comment
//     naming the field causes a false RED, which is annoying rather than dangerous. (The guard this
//     item lost to a comment satisfying a *presence* check is why that direction matters.)
//   * The NON-VACUITY half — because **a ban is itself an absence assertion**, and this item has
//     spent a day cataloguing how those pass for the wrong reason: over an empty corpus, over a
//     directory that moved, over a field list that did not exist. "Zero violations over zero files"
//     is the same 0 as a real pass. So the scan asserts it walked a non-empty tree against a
//     measured floor, every stamped builder is read by an absolute path (`readFileSync` THROWS if
//     one moves — a glob would silently drop it), and each is asserted to carry the sanctioned call.
//
// The models are on `main` and were copied rather than invented: `apps/api/test/estimate.test.ts`'s
// D-CT5 tooth (the call-site variant — one function is the only producer, comments stripped first)
// and `apps/api/test/security-report-export.test.ts`'s A6 source walk (the structural variant — one
// file owns the thing). **This needs the call-site variant**, because six builders legitimately call
// the helper; a one-file rule would be the wrong shape and would read as satisfied while being
// unenforceable.

const HERE = dirname(fileURLToPath(import.meta.url));
const API_SRC = join(HERE, "..", "src");
const SHARED_SRC = join(HERE, "..", "..", "..", "packages", "shared", "src");

/**
 * The field literal, assembled at runtime.
 *
 * Spelled as a concatenation so THIS FILE does not contain it — otherwise the ban would have to
 * carve out its own test, and a guard with an exception for itself is a guard with an exception.
 */
const FIELD_LITERAL = `${"dataPackVersion"}:`;

/** The ONE file allowed to ASSEMBLE it, relative to `packages/shared/src`. */
const STAMP_DEFINITION = "data-pack.ts";

/**
 * The field literal NOT followed by ` z.` — i.e. an ASSEMBLY rather than a zod declaration.
 *
 * The distinction is the whole precision of the ban. `dataPackVersion: z.string().optional()` in
 * `schemas.ts` declares the wire shape and produces no version; `dataPackVersion: someVersion`
 * answers "which pack?", and that answer may exist in exactly one place. A TypeScript type
 * declaration (`dataPackVersion?: string`) does not match the literal at all — the `?` sits between
 * the name and the colon.
 */
const ASSEMBLY = new RegExp(`${"dataPackVersion"}:(?! z\\.)`);

/**
 * Every builder that stamps a verdict document, by path relative to `apps/api/src`.
 *
 * Read with `readFileSync` on an absolute path: if one is renamed or moved, this test THROWS with
 * the path in the message rather than quietly shrinking the set it checks. That is the protection a
 * glob cannot give, and it is the whole reason the list is hardcoded.
 */
const STAMPED_BUILDERS: readonly { file: string; documents: string }[] = [
  { file: "security/service.ts", documents: "SecurityReport (server + skill)" },
  { file: "advisor/engine.ts", documents: "AdvisorReport" },
  { file: "reports/fleet-report.ts", documents: "FleetReport" },
  {
    file: "compatibility/service.ts",
    documents: "CompatibilityHeatmap + CompatibilityTestReport (server + tool)",
  },
  { file: "assertions/service.ts", documents: "AssertionReport (the CI gate document)" },
  { file: "reports/server-report.ts", documents: "ServerReport" },
  { file: "grading/run-report.ts", documents: "RunReport" },
];

/** Measured on this branch: 346 api sources, 52 shared. The floors are deliberately well under. */
const API_SOURCE_FLOOR = 200;
const SHARED_SOURCE_FLOOR = 30;

/**
 * Strip block and line comments.
 *
 * Naive, and exact enough here for the reason `estimate.test.ts` gives about its own module: what is
 * being searched for is a TypeScript object key, and a `//` or `/*` inside a string literal cannot
 * turn a real key into a hidden one — it can only over-strip, which for a BAN is the direction that
 * produces a false red, not a false green. The positive control below proves it does not erase real
 * code, and the negative control proves it does erase a comment.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

function walkSources(directory: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...walkSources(full));
    else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) files.push(full);
  }
  return files;
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
// The comment stripper's own two-step probe — run as assertions, not as a note in a report
// ══════════════════════════════════════════════════════════════════════════════════════════════

test("D-DP8 — the stripper erases a comment and does NOT erase code (both directions)", () => {
  // NEGATIVE: a plausible comment naming the helper does not satisfy anything.
  const commentOnly = `// this builder stamps ${FIELD_LITERAL} via dataPackStamp()\nconst x = 1;\n`;
  assert.equal(
    stripComments(commentOnly).includes(FIELD_LITERAL),
    false,
    "a comment survived the strip, so the ban could be satisfied by prose",
  );

  // POSITIVE: the same literal as real code survives. Without this the stripper could be erasing
  // everything and the ban would pass over an empty string — the exact vacuity this test is for.
  const asCode = `const stamp = { ${FIELD_LITERAL} "1.0.0" };\n`;
  assert.equal(
    stripComments(asCode).includes(FIELD_LITERAL),
    true,
    "the stripper erased real code, so a ban over stripped source proves nothing",
  );
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
// The ban — plus the non-vacuity half that makes it mean something
// ══════════════════════════════════════════════════════════════════════════════════════════════

test("D-DP8 — the stamp field is spelled in exactly ONE file, and the scan is not vacuous", () => {
  const apiFiles = walkSources(API_SRC);
  const sharedFiles = walkSources(SHARED_SRC);

  // NON-VACUITY 1 — the corpus is real. A scan that walked nothing reports zero violations and looks
  // identical to a clean pass.
  assert.ok(
    apiFiles.length >= API_SOURCE_FLOOR,
    `walked only ${apiFiles.length} api sources (floor ${API_SOURCE_FLOOR}) — the scan is looking in the wrong place`,
  );
  assert.ok(
    sharedFiles.length >= SHARED_SOURCE_FLOOR,
    `walked only ${sharedFiles.length} shared sources (floor ${SHARED_SOURCE_FLOOR})`,
  );

  // NON-VACUITY 2 — every stamped builder is INSIDE the walked set. If a seventh builder were added
  // under a path this walk does not reach, the ban would stay green and the guarantee would be gone.
  for (const builder of STAMPED_BUILDERS) {
    const absolute = join(API_SRC, builder.file);
    assert.ok(
      apiFiles.includes(absolute),
      `${builder.file} is a stamped builder the source walk never visited`,
    );
  }

  // `apps/api/src` is where every builder lives, and it declares no zod: the ban there is absolute.
  const apiOffenders = apiFiles.filter((file) =>
    stripComments(readFileSync(file, "utf8")).includes(FIELD_LITERAL),
  );
  assert.deepEqual(
    apiOffenders.map((file) => file.slice(API_SRC.length)),
    [],
    "a file under apps/api/src spells the stamp field itself instead of calling dataPackStamp()",
  );

  // `packages/shared/src` legitimately DECLARES the field in the zod schemas of every stamped
  // document. So the ban there is on ASSEMBLY — the literal not followed by ` z.` — which is
  // permitted in exactly one file.
  const sharedOffenders = sharedFiles
    .filter((file) => ASSEMBLY.test(stripComments(readFileSync(file, "utf8"))))
    .map((file) => file.slice(SHARED_SRC.length + 1));
  assert.deepEqual(
    sharedOffenders,
    [STAMP_DEFINITION],
    "the stamp is assembled somewhere other than (or as well as) packages/shared/src/data-pack.ts",
  );

  // NON-VACUITY 3 — the assembly pattern is discriminating, not a regex that never matches. It sees
  // an assembly and does NOT see a declaration.
  assert.equal(ASSEMBLY.test(`const s = { ${FIELD_LITERAL} version };`), true);
  assert.equal(ASSEMBLY.test(`{ ${FIELD_LITERAL} z.string().optional() }`), false);
});

test("D-DP8 — every stamped builder calls the ONE helper (read by absolute path)", () => {
  for (const builder of STAMPED_BUILDERS) {
    // `readFileSync` throws if the file moved. That is deliberate: a missing builder must be a hard
    // failure naming the path, never a silently smaller set.
    const source = stripComments(readFileSync(join(API_SRC, builder.file), "utf8"));
    assert.match(
      source,
      /dataPackStamp\(\)/,
      `${builder.file} builds ${builder.documents} but never calls dataPackStamp()`,
    );
  }
});

test("D-DP8 — the API-side helper is the only production caller of the shared builder", () => {
  const callers = walkSources(API_SRC)
    .filter((file) => stripComments(readFileSync(file, "utf8")).includes("stampDataPackVersion("))
    .map((file) => file.slice(API_SRC.length));
  assert.deepEqual(
    callers,
    ["/data-pack/stamp.ts"],
    "a second place answers 'which pack is in force' — that is how two builders come to disagree",
  );
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
// The behaviour — a document is READ and fails on a missing stamp
// ══════════════════════════════════════════════════════════════════════════════════════════════

const databases: AppDatabase[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

function openDb(): AppDatabase {
  const db = new Database(":memory:") as unknown as AppDatabase;
  db.exec(schemaSql);
  applyMigrations(db);
  databases.push(db);
  return db;
}

function toolInsert(toolName: string, description: string): Omit<ToolScan, "id" | "scanId"> {
  return {
    toolName,
    description,
    inputSchema: undefined,
    annotations: undefined,
    rawTool: {},
    totalTokens: 10,
    nameTokens: 2,
    descriptionTokens: 3,
    schemaTokens: 5,
    annotationsTokens: 0,
    rawBytes: 40,
    contributionPercent: 0,
  };
}

test("D-DP8 — a real security report names the pack in force", () => {
  const db = openDb();
  const secrets = new SecretStore(Buffer.alloc(32));
  const servers = new ServerRepository(db, secrets);
  const scans = new ScanRepository(db);
  const oauth = new OAuthRepository(db, secrets);

  const server = servers.create({ name: "Stamp fixture", transport: "stdio", command: "node" });
  const scan = scans.createRunningScan(server.id, "generic_o200k");
  scans.completeScan(
    scan.id,
    {
      totalTools: 1,
      totalTokens: 10,
      totalRawBytes: 40,
      averageTokensPerTool: 10,
      largestToolName: "delete_all",
      largestToolTokens: 10,
      totalResources: 0,
      totalResourceTemplates: 0,
      totalPrompts: 0,
      totalResourceTokens: 0,
      totalPromptTokens: 0,
      largestResourceName: null,
      largestResourceTokens: 0,
      largestPromptName: null,
      largestPromptTokens: 0,
    },
    [toolInsert("delete_all", "Deletes all the things.")],
  );

  const report = analyzeScan({ scans, servers, oauth }, scan.id);
  const expected = getDataPack().manifest.packVersion;

  assert.equal(
    report.dataPackVersion,
    expected,
    "the security report does not name the pack it was computed against",
  );
  // Non-vacuity: the expected version is a real semver core read off the pack, not `undefined`
  // compared against `undefined`.
  assert.match(expected, /^\d+\.\d+\.\d+$/);

  // And it reaches the exported Markdown section, on the D-SP25 score line rather than a new one.
  const markdown = renderSecuritySection({ status: "analyzed", report }).join("\n");
  assert.ok(
    markdown.includes(`reference data pack ${expected}`),
    "the exported security section does not name the pack",
  );
});

test("D-DP8 — the posture diff INHERITS its stamp from the subject, and does not invent one", () => {
  const finding: SecurityFinding = {
    ruleId: "annotation.destructive-unmarked",
    severity: "warning",
    anchor: { kind: "tool", toolName: "delete_all" },
    message: "x",
  };
  const base = (over: Partial<SecurityReport>): SecurityReport => ({
    analyzerVersion: 4,
    generatedAt: "2026-08-23T00:00:00.000Z",
    subject: {
      kind: "server",
      id: "scan_1",
      ownerId: "srv_1",
      name: "s",
      capturedAt: "2026-08-23T00:00:00.000Z",
    },
    findings: [],
    counts: { error: 0, warning: 0, info: 0, total: 0 },
    score: { value: 100, band: "clean", analyzerVersion: 4 },
    truncated: false,
    ...over,
  });

  const stamped = diffSecurityReports(
    base({ dataPackVersion: "9.9.9" }),
    base({
      dataPackVersion: "9.9.9",
      findings: [finding],
      counts: { error: 0, warning: 1, info: 0, total: 1 },
    }),
  );
  assert.equal(stamped.dataPackVersion, "9.9.9");

  // A subject with no stamp yields no stamp — never a guess, and never the bundled version passed
  // off as the one that produced the input.
  const unstamped = diffSecurityReports(base({}), base({}));
  assert.equal(unstamped.dataPackVersion, undefined);
});

test("D-DP8 — the CI gate document names the pack in its footer", () => {
  const report: AssertionReport = {
    dataPackVersion: "4.5.6",
    assertionsVersion: 1,
    evaluatedAt: "2026-08-23T00:00:00.000Z",
    subject: {
      kind: "scan",
      scanId: "scan_1",
      serverId: "srv_1",
      serverName: "s",
      scannedAt: "2026-08-23T00:00:00.000Z",
      totalTools: 1,
      totalTokens: 10,
    },
    baseline: null,
    results: [],
    counts: { total: 0, passed: 0, failed: 0, skipped: 0 },
    passed: true,
  };
  assert.ok(renderAssertionMarkdown(report).includes("data pack 4.5.6"));

  // The absence case renders the pre-RM-38 footer byte-for-byte, so an older report is unchanged.
  const { dataPackVersion: _dropped, ...withoutStamp } = report;
  assert.ok(renderAssertionMarkdown(withoutStamp).includes("mcpfp assertions v1 · evaluated"));
  assert.equal(renderAssertionMarkdown(withoutStamp).includes("data pack"), false);
});

test("D-DP8 — the helper reads the pack in force, and the shared builder is pure", () => {
  assert.deepEqual(dataPackStamp(), {
    dataPackVersion: getDataPack().manifest.packVersion,
  });
  assert.deepEqual(stampDataPackVersion("1.2.3"), { dataPackVersion: "1.2.3" });
});
