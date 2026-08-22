/**
 * build-docs-bundle.test.ts — RM-18 WP 1.2, the generator's teeth.
 *
 * Lives under `apps/web/src` because that is the only tree vitest collects
 * (`apps/web/vitest.config.ts`: `include: ["src/**\/*.test.{ts,tsx}"]`), and the generator is a
 * root-level build script with no runner of its own. It imports the REAL script — nothing here
 * re-implements it.
 *
 * Two layers:
 *   A. FIXTURE — a synthetic guide tree in a temp directory, so the refusals and the link rewriting
 *      are proved on inputs the real repository does not contain (an empty tree, a `changelog`
 *      collision, a duplicate slug).
 *   B. THE REAL REPOSITORY — the shipped set is non-empty, `doc.md` never ships, and the output
 *      directory is `doc-content`, never `docs`.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DOCS_MANIFEST_SCHEMA,
  RESERVED_SUBJECT_ID,
  buildDocsBundle,
  collectSubjects,
  parseFrontmatter,
  rewriteLink,
  rewriteLinks,
  type CollectedSubject,
} from "../../../../../scripts/build-docs-bundle.mjs";

type ShippedSubject = Extract<CollectedSubject, { skipped: false }>;

/** The subjects that actually ship, narrowed off the generator's discriminated union. */
function shippedOnly(subjects: CollectedSubject[]): ShippedSubject[] {
  return subjects.filter((subject): subject is ShippedSubject => !subject.skipped);
}

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..", "..", ".."); // …/apps/web/src/features/docs → repo root
const scriptPath = join(repoRoot, "scripts", "build-docs-bundle.mjs");

// ── A. fixture tree ───────────────────────────────────────────────────────────────────────────────

let fixture: string;

function guidePage(title: string, body: string): string {
  return [
    "---",
    'type: "Guide Page"',
    `title: ${JSON.stringify(title)}`,
    `description: "About ${title}"`,
    'tags: ["documentation"]',
    'timestamp: "2026-08-22T00:00:00Z"',
    'status: "current"',
    "---",
    body,
    "",
  ].join("\n");
}

function deliveryRecord(title: string): string {
  return [
    "---",
    'type: "Documentation"',
    `title: ${JSON.stringify(title)}`,
    `description: "Delivery record for ${title}"`,
    'tags: ["documentation"]',
    'timestamp: "2026-08-22T00:00:00Z"',
    'status: "draft"',
    "---",
    "# Delivery record",
    "",
    "This must never reach an operator's screen.",
    "",
  ].join("\n");
}

function writeSubject(root: string, dirName: string, files: Record<string, string>): void {
  const dir = join(root, "planning", "user-guide", dirName);
  mkdirSync(dir, { recursive: true });
  for (const [name, contents] of Object.entries(files)) {
    const target = join(dir, name);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, contents, "utf8");
  }
}

beforeEach(() => {
  fixture = mkdtempSync(join(tmpdir(), "docs-bundle-"));
  mkdirSync(join(fixture, "planning", "user-guide"), { recursive: true });
  writeFileSync(join(fixture, "CHANGELOG.md"), "# Changelog\n\n## Unreleased\n\nA thing.\n", "utf8");
});

afterEach(() => {
  rmSync(fixture, { recursive: true, force: true });
});

describe("parseFrontmatter", () => {
  it("reads JSON-escaped values and returns the body without the fence", () => {
    const { fields, body } = parseFrontmatter(guidePage("Platform — hardening", "# Hi\n\nbody"));
    expect(fields.type).toBe("Guide Page");
    expect(fields.title).toBe("Platform — hardening");
    expect(body.startsWith("# Hi")).toBe(true);
  });

  it("returns no fields for a file with no frontmatter (index.md / log.md)", () => {
    const { fields, body } = parseFrontmatter("# Getting started\n\n* [a](a.md)\n");
    expect(fields).toEqual({});
    expect(body).toBe("# Getting started\n\n* [a](a.md)\n");
  });
});

describe("collectSubjects — the two refusals the WP names", () => {
  it("FAILS LOUDLY when there are zero shipped subjects", () => {
    // A subject that holds only a delivery record ships nothing — so the tree is empty.
    writeSubject(fixture, "DC-01-empty", { "doc.md": deliveryRecord("Empty") });
    expect(() => collectSubjects(join(fixture, "planning", "user-guide"))).toThrow(
      /found 0 shipped documentation subjects/,
    );
  });

  it("REFUSES a subject whose id collides with the reserved `changelog` id", () => {
    writeSubject(fixture, "DC-01-changelog", {
      "doc.md": deliveryRecord("Changelog"),
      "00-page.md": guidePage("A page", "# A page"),
    });
    expect(() => collectSubjects(join(fixture, "planning", "user-guide"))).toThrow(
      new RegExp(`reserved for the repository CHANGELOG`),
    );
    expect(RESERVED_SUBJECT_ID).toBe("changelog");
  });

  it("REFUSES two subjects that resolve to the same id", () => {
    writeSubject(fixture, "DC-01-skills", { "00-a.md": guidePage("A", "# A") });
    writeSubject(fixture, "DC-02-skills", { "00-b.md": guidePage("B", "# B") });
    expect(() => collectSubjects(join(fixture, "planning", "user-guide"))).toThrow(
      /both resolve to the subject id "skills"/,
    );
  });

  it("ships only `Guide Page` concepts, in DC then filename order", () => {
    writeSubject(fixture, "DC-02-second", {
      "doc.md": deliveryRecord("Second"),
      "index.md": "# Second\n\nnavigation, no frontmatter\n",
      "log.md": "# Log\n",
      "05-later.md": guidePage("Later", "# Later"),
      "04-earlier.md": guidePage("Earlier", "# Earlier"),
    });
    writeSubject(fixture, "DC-01-first", {
      "doc.md": deliveryRecord("First"),
      "00-only.md": guidePage("Only", "# Only"),
    });
    const subjects = shippedOnly(collectSubjects(join(fixture, "planning", "user-guide")));
    expect(subjects.map((s) => s.id)).toEqual(["first", "second"]);
    expect(subjects[1]?.documents.map((d) => d.id)).toEqual(["04-earlier", "05-later"]);
    // The delivery record, the navigation index and the log are all absent — by TYPE, not by name.
    const allIds = subjects.flatMap((s) => s.documents.map((d) => d.id));
    expect(allIds).not.toContain("doc");
    expect(allIds).not.toContain("index");
    expect(allIds).not.toContain("log");
  });
});

describe("rewriteLink", () => {
  const index = {
    documentsByPath: new Map([
      ["DC-08-testing/09-testing.md", { subjectId: "testing", documentId: "09-testing" }],
      ["DC-01-start/02-getting-started.md", { subjectId: "start", documentId: "02-getting-started" }],
    ]),
    assetsByPath: new Map([["DC-23-overview/images/01.png", "overview/images/01.png"]]),
  };

  it.each([
    ["https://example.com/x", null],
    ["mailto:a@b.c", null],
    ["#anchor", null],
    ["/Roadmap/completed/RM-19-release/item.md", null],
    ["../DC-99-nope/nope.md", null],
  ])("leaves %s untouched", (target, expected) => {
    expect(rewriteLink(target, { subjectDir: "DC-01-start", index })).toBe(expected);
  });

  it("maps a sibling guide page onto its subject page anchor", () => {
    expect(rewriteLink("./02-getting-started.md", { subjectDir: "DC-01-start", index })).toBe(
      "/docs/start#02-getting-started",
    );
  });

  it("maps a cross-subject guide page, dropping the source fragment", () => {
    expect(
      rewriteLink("../DC-08-testing/09-testing.md#costs", { subjectDir: "DC-01-start", index }),
    ).toBe("/docs/testing#09-testing");
  });

  it("maps an asset onto its served path", () => {
    expect(rewriteLink("../DC-23-overview/images/01.png", { subjectDir: "DC-01-start", index })).toBe(
      "/doc-content/overview/images/01.png",
    );
  });

  it("does not rewrite inside a fenced code block", () => {
    const source = ["```md", "[x](./02-getting-started.md)", "```", "[y](./02-getting-started.md)"].join(
      "\n",
    );
    const { markdown } = rewriteLinks(source, { subjectDir: "DC-01-start", index });
    expect(markdown).toContain("```md\n[x](./02-getting-started.md)\n```");
    expect(markdown).toContain("[y](/docs/start#02-getting-started)");
  });
});

describe("buildDocsBundle over a fixture tree", () => {
  it("writes a manifest, one file per document, and the changelog — deterministically", () => {
    writeSubject(fixture, "DC-01-start", {
      "doc.md": deliveryRecord("Start"),
      "00-intro.md": guidePage("Intro", "# Intro\n\nSee [testing](../DC-08-testing/09-testing.md)."),
    });
    writeSubject(fixture, "DC-08-testing", {
      "doc.md": deliveryRecord("Testing"),
      "09-testing.md": guidePage("Testing", "# Testing"),
    });
    const outDir = join(fixture, "out");

    const first = buildDocsBundle({ repoRoot: fixture, outDir });
    expect(first.manifest.schema).toBe(DOCS_MANIFEST_SCHEMA);
    expect(first.manifest.subjects.map((s) => s.id)).toEqual(["start", "testing"]);
    expect(first.documentCount).toBe(2);
    expect(existsSync(join(outDir, "manifest.json"))).toBe(true);
    expect(existsSync(join(outDir, "start", "00-intro.md"))).toBe(true);
    expect(existsSync(join(outDir, "changelog.md"))).toBe(true);
    // The cross-subject link resolved.
    expect(readFileSync(join(outDir, "start", "00-intro.md"), "utf8")).toContain(
      "(/docs/testing#09-testing)",
    );

    const manifestBytes = readFileSync(join(outDir, "manifest.json"), "utf8");
    buildDocsBundle({ repoRoot: fixture, outDir });
    expect(readFileSync(join(outDir, "manifest.json"), "utf8")).toBe(manifestBytes);
  });

  it("drops a subject that no longer ships, rather than leaving it in a stale bundle", () => {
    writeSubject(fixture, "DC-01-start", { "00-intro.md": guidePage("Intro", "# Intro") });
    writeSubject(fixture, "DC-02-gone", { "00-gone.md": guidePage("Gone", "# Gone") });
    const outDir = join(fixture, "out");
    buildDocsBundle({ repoRoot: fixture, outDir });
    expect(existsSync(join(outDir, "gone"))).toBe(true);

    rmSync(join(fixture, "planning", "user-guide", "DC-02-gone"), { recursive: true });
    buildDocsBundle({ repoRoot: fixture, outDir });
    expect(existsSync(join(outDir, "gone"))).toBe(false);
  });

  it("refuses to build without a CHANGELOG.md", () => {
    writeSubject(fixture, "DC-01-start", { "00-intro.md": guidePage("Intro", "# Intro") });
    rmSync(join(fixture, "CHANGELOG.md"));
    expect(() => buildDocsBundle({ repoRoot: fixture, outDir: join(fixture, "out") })).toThrow(
      /CHANGELOG\.md not found/,
    );
  });

  it("EXITS NON-ZERO as a CLI when the guide is empty (a build error, not an empty docs section)", () => {
    // The real teeth: the failure must stop `pnpm build`, not just throw inside a function. The CLI
    // derives its repo root from its OWN location, so the script is copied INTO the fixture — that
    // makes the fixture the repository it reads, without touching the real one.
    writeSubject(fixture, "DC-01-empty", { "doc.md": deliveryRecord("Empty") });
    mkdirSync(join(fixture, "scripts"), { recursive: true });
    const copied = join(fixture, "scripts", "build-docs-bundle.mjs");
    writeFileSync(copied, readFileSync(scriptPath, "utf8"), "utf8");

    let exitCode: number | undefined;
    let stderr = "";
    try {
      execFileSync(process.execPath, [copied], { stdio: "pipe" });
    } catch (error) {
      const failure = error as { status?: number; stderr?: Buffer };
      exitCode = failure.status;
      stderr = failure.stderr?.toString() ?? "";
    }
    expect(exitCode, "the generator must fail the build, not warn").not.toBe(0);
    expect(stderr).toMatch(/found 0 shipped documentation subjects/);
    expect(existsSync(join(fixture, "apps", "web", "public", "doc-content"))).toBe(false);
  });

  it("EXITS NON-ZERO as a CLI on a `changelog` subject-id collision", () => {
    writeSubject(fixture, "DC-01-changelog", { "00-page.md": guidePage("A page", "# A page") });
    mkdirSync(join(fixture, "scripts"), { recursive: true });
    const copied = join(fixture, "scripts", "build-docs-bundle.mjs");
    writeFileSync(copied, readFileSync(scriptPath, "utf8"), "utf8");

    let exitCode: number | undefined;
    let stderr = "";
    try {
      execFileSync(process.execPath, [copied], { stdio: "pipe" });
    } catch (error) {
      const failure = error as { status?: number; stderr?: Buffer };
      exitCode = failure.status;
      stderr = failure.stderr?.toString() ?? "";
    }
    expect(exitCode).not.toBe(0);
    expect(stderr).toMatch(/reserved for the repository CHANGELOG/);
  });
});

// ── B. the real repository ────────────────────────────────────────────────────────────────────────

describe("the real user guide", () => {
  it("ships a non-empty set of subjects, and never a delivery record", () => {
    const subjects = shippedOnly(collectSubjects(join(repoRoot, "planning", "user-guide")));
    expect(subjects.length).toBeGreaterThan(0);
    for (const subject of subjects) {
      expect(subject.documents.length).toBeGreaterThan(0);
      expect(subject.id).not.toBe(RESERVED_SUBJECT_ID);
      for (const document of subject.documents) {
        expect(document.fileName).not.toBe("doc.md");
        expect(document.fileName).not.toBe("index.md");
        expect(document.fileName).not.toBe("log.md");
      }
    }
  });

  it("writes to `doc-content`, never `docs` — the SPA route owns /docs/*", () => {
    const source = readFileSync(scriptPath, "utf8");
    expect(source).toContain('"doc-content"');
    // The CLI's out-dir join must not name a bare "docs" segment.
    expect(source).not.toMatch(/join\(repoRoot, "apps", "web", "public", "docs"\)/);
  });
});
