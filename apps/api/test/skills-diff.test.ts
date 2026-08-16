import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { afterEach, test } from "node:test";
import type { SkillDiffEntry } from "@mcp-token-footprint/shared";
import type { AppDatabase } from "../src/db/database.js";
import { schemaSql } from "../src/db/schema.js";
import { SecretStore } from "../src/secrets/secret-store.js";
import { SkillDiffService, lineDelta, manifestDiff } from "../src/skills/diff-service.js";
import {
  SkillRepository,
  type CreateVersionFootprint,
  type SkillFileInput,
} from "../src/skills/repository.js";

const databases: AppDatabase[] = [];

afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

function createDatabase(): AppDatabase {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(schemaSql);
  databases.push(db);
  return db;
}

function file(path: string, text: string): SkillFileInput {
  return { path, bytes: Buffer.from(text, "utf8") };
}

function bin(path: string, bytes: number[]): SkillFileInput {
  return { path, bytes: Buffer.from(bytes) };
}

/** Build a footprint whose L1/L2/L3/total + per-file totals we control exactly for delta asserts. */
function footprint(
  l1: number,
  l2: number,
  l3: number,
  byPath: Record<string, number>,
): CreateVersionFootprint {
  return {
    l1,
    l2,
    l3,
    total: l1 + l2 + l3,
    byPath: new Map(Object.entries(byPath)),
  };
}

function entryFor(entries: SkillDiffEntry[], path: string): SkillDiffEntry {
  const entry = entries.find((e) => e.path === path);
  assert.ok(entry, `expected an entry for ${path}`);
  return entry;
}

test("classifies added/removed/modified/unchanged and rolls up token deltas per level", () => {
  const db = createDatabase();
  const repo = new SkillRepository(db, new SecretStore(Buffer.alloc(32, 1)));
  const service = new SkillDiffService(repo);
  const skill = repo.create({ name: "diff", sourceType: "upload" });

  const v1 = repo.createVersion(
    skill.id,
    [
      file("SKILL.md", "body v1"),
      file("references/keep.md", "keep"),
      file("references/gone.md", "gone"),
    ],
    {
      sourceKind: "upload",
      importedFrom: "upload",
      manifest: { name: "diff", description: "first" },
      footprint: footprint(3, 10, 20, {
        "SKILL.md": 10,
        "references/keep.md": 12,
        "references/gone.md": 8,
      }),
    },
  );

  const v2 = repo.createVersion(
    skill.id,
    [
      file("SKILL.md", "body v2 longer"), // modified
      file("references/keep.md", "keep"), // unchanged (same bytes)
      file("references/new.md", "brand new"), // added
      // references/gone.md removed
    ],
    {
      sourceKind: "upload",
      importedFrom: "upload",
      manifest: { name: "diff", description: "second" },
      footprint: footprint(4, 15, 18, {
        "SKILL.md": 15,
        "references/keep.md": 12,
        "references/new.md": 6,
      }),
    },
  );

  assert.equal(v1.unchanged, false);
  assert.equal(v2.unchanged, false);

  const diff = service.diffVersions(v1.version.id, v2.version.id);

  assert.equal(diff.skillId, skill.id);
  assert.equal(diff.fromVersionId, v1.version.id);
  assert.equal(diff.toVersionId, v2.version.id);

  assert.equal(entryFor(diff.entries, "SKILL.md").status, "modified");
  assert.equal(entryFor(diff.entries, "references/keep.md").status, "unchanged");
  assert.equal(entryFor(diff.entries, "references/new.md").status, "added");
  assert.equal(entryFor(diff.entries, "references/gone.md").status, "removed");

  // Per-entry token deltas (to − from).
  assert.equal(entryFor(diff.entries, "SKILL.md").tokenDelta, 5); // 15 − 10
  assert.equal(entryFor(diff.entries, "references/new.md").tokenDelta, 6); // added
  assert.equal(entryFor(diff.entries, "references/new.md").fromTokens, undefined);
  assert.equal(entryFor(diff.entries, "references/gone.md").tokenDelta, -8); // removed
  assert.equal(entryFor(diff.entries, "references/gone.md").toTokens, undefined);
  assert.equal(entryFor(diff.entries, "references/keep.md").tokenDelta, 0);

  // Rollup file counts.
  assert.equal(diff.rollup.filesAdded, 1);
  assert.equal(diff.rollup.filesRemoved, 1);
  assert.equal(diff.rollup.filesModified, 1);
  assert.equal(diff.rollup.filesRenamed, 0);

  // Rollup token deltas per level (from the two versions' stored subtotals).
  assert.equal(diff.rollup.l1Delta, 1); // 4 − 3
  assert.equal(diff.rollup.l2Delta, 5); // 15 − 10
  assert.equal(diff.rollup.l3Delta, -2); // 18 − 20
  assert.equal(diff.rollup.totalDelta, 4); // 37 − 33

  // Bytes delta from the two versions' total_bytes.
  const expectedBytes = v2.version.totalBytes - v1.version.totalBytes;
  assert.equal(diff.rollup.bytesDelta, expectedBytes);

  // Manifest field diff: only description changed.
  assert.deepEqual(diff.manifestDiff, [{ field: "description", from: "first", to: "second" }]);
});

test("detects a rename (identical file moved) and pulls it out of added/removed", () => {
  const db = createDatabase();
  const repo = new SkillRepository(db, new SecretStore(Buffer.alloc(32, 2)));
  const service = new SkillDiffService(repo);
  const skill = repo.create({ name: "rename", sourceType: "upload" });

  const v1 = repo.createVersion(
    skill.id,
    [file("SKILL.md", "root"), file("references/old-name.md", "identical content")],
    {
      sourceKind: "upload",
      importedFrom: "upload",
      footprint: footprint(2, 5, 7, { "SKILL.md": 5, "references/old-name.md": 7 }),
    },
  );

  // Same bytes for the moved file → same blob_sha at a new path.
  const v2 = repo.createVersion(
    skill.id,
    [file("SKILL.md", "root"), file("references/new-name.md", "identical content")],
    {
      sourceKind: "upload",
      importedFrom: "upload",
      footprint: footprint(2, 5, 7, { "SKILL.md": 5, "references/new-name.md": 7 }),
    },
  );

  const diff = service.diffVersions(v1.version.id, v2.version.id);

  const renamed = entryFor(diff.entries, "references/new-name.md");
  assert.equal(renamed.status, "renamed");
  assert.equal(renamed.fromPath, "references/old-name.md");
  assert.equal(renamed.tokenDelta, 0);
  assert.equal(renamed.fromTokens, 7);
  assert.equal(renamed.toTokens, 7);

  // The rename is NOT double-counted as an add or a remove.
  assert.equal(
    diff.entries.some((e) => e.status === "added"),
    false,
  );
  assert.equal(
    diff.entries.some((e) => e.status === "removed"),
    false,
  );
  assert.equal(diff.rollup.filesRenamed, 1);
  assert.equal(diff.rollup.filesAdded, 0);
  assert.equal(diff.rollup.filesRemoved, 0);
});

test("binary modified files report binary with no line diff; text files carry line deltas", () => {
  const db = createDatabase();
  const repo = new SkillRepository(db, new SecretStore(Buffer.alloc(32, 3)));
  const service = new SkillDiffService(repo);
  const skill = repo.create({ name: "binary", sourceType: "upload" });

  const v1 = repo.createVersion(
    skill.id,
    [file("SKILL.md", "line1\nline2\n"), bin("assets/logo.png", [0x89, 0x50, 0x4e, 0x47, 0x01])],
    {
      sourceKind: "upload",
      importedFrom: "upload",
      footprint: footprint(1, 4, 0, { "SKILL.md": 4 }),
    },
  );

  const v2 = repo.createVersion(
    skill.id,
    [
      file("SKILL.md", "line1\nline2\nline3\n"),
      bin("assets/logo.png", [0x89, 0x50, 0x4e, 0x47, 0x02]),
    ],
    {
      sourceKind: "upload",
      importedFrom: "upload",
      footprint: footprint(1, 6, 0, { "SKILL.md": 6 }),
    },
  );

  const diff = service.diffVersions(v1.version.id, v2.version.id);

  const png = entryFor(diff.entries, "assets/logo.png");
  assert.equal(png.status, "modified");
  assert.equal(png.binary, true);

  const skillMd = entryFor(diff.entries, "SKILL.md");
  assert.equal(skillMd.status, "modified");
  assert.equal(skillMd.binary, false);

  // The text file's added/removed line counts come from jsdiff (one line appended).
  const from = repo.getFileContent(v1.version.id, "SKILL.md");
  const to = repo.getFileContent(v2.version.id, "SKILL.md");
  assert.equal(from.isBinary, false);
  assert.equal(to.isBinary, false);
  const delta = lineDelta(from.isBinary ? "" : from.text, to.isBinary ? "" : to.text);
  assert.equal(delta.adds, 1);
  assert.equal(delta.dels, 0);
});

test("fileDiff returns both file contents for a path", () => {
  const db = createDatabase();
  const repo = new SkillRepository(db, new SecretStore(Buffer.alloc(32, 4)));
  const service = new SkillDiffService(repo);
  const skill = repo.create({ name: "filediff", sourceType: "upload" });

  const v1 = repo.createVersion(skill.id, [file("SKILL.md", "old body")], {
    sourceKind: "upload",
    importedFrom: "upload",
    footprint: footprint(1, 3, 0, { "SKILL.md": 3 }),
  });
  const v2 = repo.createVersion(skill.id, [file("SKILL.md", "new body text")], {
    sourceKind: "upload",
    importedFrom: "upload",
    footprint: footprint(1, 5, 0, { "SKILL.md": 5 }),
  });

  const fd = service.fileDiff(v1.version.id, v2.version.id, "SKILL.md");
  assert.equal(fd.path, "SKILL.md");
  assert.equal(fd.from.isBinary === false && fd.from.text, "old body");
  assert.equal(fd.to.isBinary === false && fd.to.text, "new body text");
});

test("fileDiff tolerates one-sided files (added → empty from; removed → empty to; neither → 404)", () => {
  const db = createDatabase();
  const repo = new SkillRepository(db, new SecretStore(Buffer.alloc(32, 5)));
  const service = new SkillDiffService(repo);
  const skill = repo.create({ name: "onesided", sourceType: "upload" });

  const v1 = repo.createVersion(
    skill.id,
    [file("SKILL.md", "body"), file("references/gone.md", "bye")],
    {
      sourceKind: "upload",
      importedFrom: "upload",
      footprint: footprint(1, 2, 2, { "SKILL.md": 2, "references/gone.md": 2 }),
    },
  );
  const v2 = repo.createVersion(
    skill.id,
    [file("SKILL.md", "body"), file("references/new.md", "hi there")],
    {
      sourceKind: "upload",
      importedFrom: "upload",
      footprint: footprint(1, 2, 2, { "SKILL.md": 2, "references/new.md": 2 }),
    },
  );

  // Added file: present only in `to` → empty `from`, real `to`, no 404.
  const added = service.fileDiff(v1.version.id, v2.version.id, "references/new.md");
  assert.equal(added.from.isBinary === false && added.from.text, "");
  assert.equal(added.to.isBinary === false && added.to.text, "hi there");

  // Removed file: present only in `from` → real `from`, empty `to`.
  const removed = service.fileDiff(v1.version.id, v2.version.id, "references/gone.md");
  assert.equal(removed.from.isBinary === false && removed.from.text, "bye");
  assert.equal(removed.to.isBinary === false && removed.to.text, "");

  // Present in neither version → genuine 404.
  assert.throws(() => service.fileDiff(v1.version.id, v2.version.id, "nope.md"), /not found/i);
});

test("manifestDiff compares every surfaced frontmatter field including metadata", () => {
  const before = {
    name: "pdf",
    description: "Work with PDFs",
    license: "MIT",
    allowedTools: "Read Write",
    metadata: { version: "1.0", author: "acme" },
  };
  const after = {
    name: "pdf",
    description: "Work with PDF forms",
    license: "MIT",
    allowedTools: "Read Write Bash",
    metadata: { version: "1.1", author: "acme" },
  };

  const diff = manifestDiff(before, after);
  const byField = new Map(diff.map((d) => [d.field, d]));

  assert.equal(byField.has("name"), false); // unchanged
  assert.equal(byField.has("license"), false); // unchanged
  assert.deepEqual(byField.get("description"), {
    field: "description",
    from: "Work with PDFs",
    to: "Work with PDF forms",
  });
  assert.deepEqual(byField.get("allowedTools"), {
    field: "allowedTools",
    from: "Read Write",
    to: "Read Write Bash",
  });
  // metadata changed (version bumped) → surfaced as stable-JSON before/after.
  const meta = byField.get("metadata");
  assert.ok(meta);
  assert.match(meta.from ?? "", /"version":"1.0"/);
  assert.match(meta.to ?? "", /"version":"1.1"/);
});

test("manifestDiff reports an added field (from undefined) and a removed field (to undefined)", () => {
  const diff = manifestDiff(
    { name: "s", description: "d" },
    { name: "s", description: "d", license: "MIT" },
  );
  assert.deepEqual(diff, [{ field: "license", from: undefined, to: "MIT" }]);

  const diff2 = manifestDiff(
    { name: "s", description: "d", compatibility: "claude-3" },
    { name: "s", description: "d" },
  );
  assert.deepEqual(diff2, [{ field: "compatibility", from: "claude-3", to: undefined }]);
});
