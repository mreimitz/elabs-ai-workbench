import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { afterEach, test } from "node:test";
import type { AppDatabase } from "../src/db/database.js";
import { schemaSql } from "../src/db/schema.js";
import { SecretStore } from "../src/secrets/secret-store.js";
import { SkillRepository, type SkillFileInput } from "../src/skills/repository.js";

const databases: AppDatabase[] = [];

afterEach(() => {
  for (const db of databases.splice(0)) {
    db.close();
  }
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

test("round-trips a skill + version + files (reload equal)", () => {
  const db = createDatabase();
  const repo = new SkillRepository(db, new SecretStore(Buffer.alloc(32, 1)));

  const skill = repo.create({ name: "pdf", sourceType: "upload", description: "Work with PDFs" });
  assert.equal(skill.slug, "pdf");
  assert.equal(skill.versionCount, 0);

  const result = repo.createVersion(
    skill.id,
    [file("SKILL.md", "---\nname: pdf\n---\nbody"), file("references/FORMS.md", "forms doc")],
    {
      sourceKind: "upload",
      importedFrom: "upload",
      manifest: { name: "pdf", description: "Work with PDFs" },
    },
  );
  assert.equal(result.unchanged, false);

  const reloaded = repo.getPublic(skill.id);
  assert.equal(reloaded.versionCount, 1);
  assert.equal(reloaded.currentVersionId, result.version.id);

  const files = repo.listFiles(result.version.id);
  assert.deepEqual(files.map((f) => f.path).sort(), ["SKILL.md", "references/FORMS.md"]);
  const skillMd = files.find((f) => f.path === "SKILL.md");
  assert.equal(skillMd?.isSkillMd, true);
  assert.equal(skillMd?.kind, "skill_md");

  const content = repo.getFileContent(result.version.id, "references/FORMS.md");
  assert.equal(content.isBinary, false);
  assert.equal(content.isBinary === false && content.text, "forms doc");
});

test("createVersion dedupes identical blobs across versions", () => {
  const db = createDatabase();
  const repo = new SkillRepository(db, new SecretStore(Buffer.alloc(32, 2)));
  const skill = repo.create({ name: "dedupe", sourceType: "upload" });

  // v1: two files.
  repo.createVersion(skill.id, [file("SKILL.md", "shared body"), file("a.md", "alpha")], {
    sourceKind: "upload",
    importedFrom: "upload",
  });

  // v2: SKILL.md unchanged (same bytes → same sha), a.md changed.
  const v2 = repo.createVersion(skill.id, [file("SKILL.md", "shared body"), file("a.md", "beta")], {
    sourceKind: "upload",
    importedFrom: "upload",
  });
  assert.equal(v2.unchanged, false);

  // The identical SKILL.md content is stored as exactly one blob.
  const sharedSha = db
    .prepare("SELECT blob_sha FROM skill_files WHERE path = 'SKILL.md' LIMIT 1")
    .get() as { blob_sha: string };
  const blobCount = db
    .prepare("SELECT COUNT(*) AS n FROM skill_blobs WHERE sha256 = ?")
    .get(sharedSha.blob_sha) as { n: number };
  assert.equal(blobCount.n, 1, "identical file across versions stores exactly one blob");

  // Distinct contents across the two versions: SKILL.md (1) + a.md v1 + a.md v2 = 3 blobs.
  const totalBlobs = db.prepare("SELECT COUNT(*) AS n FROM skill_blobs").get() as { n: number };
  assert.equal(totalBlobs.n, 3);
});

test("createVersion is a no-op when tree_sha matches the current version", () => {
  const db = createDatabase();
  const repo = new SkillRepository(db, new SecretStore(Buffer.alloc(32, 3)));
  const skill = repo.create({ name: "noop", sourceType: "upload" });

  const files = [file("SKILL.md", "same"), file("x.txt", "same too")];
  const v1 = repo.createVersion(skill.id, files, { sourceKind: "upload", importedFrom: "upload" });
  assert.equal(v1.unchanged, false);

  // Re-upload identical bytes (order shuffled) → unchanged, no new version.
  const again = repo.createVersion(skill.id, [...files].reverse(), {
    sourceKind: "upload",
    importedFrom: "upload",
  });
  assert.equal(again.unchanged, true);
  assert.equal(again.version.id, v1.version.id);
  assert.equal(repo.listVersions(skill.id).length, 1);
});

test("public/list views never expose the PAT — only hasAuth", () => {
  const db = createDatabase();
  const repo = new SkillRepository(db, new SecretStore(Buffer.alloc(32, 4)));

  const skill = repo.create({
    name: "gh-skill",
    sourceType: "github",
    github: {
      repoUrl: "https://github.com/anthropics/skills",
      ref: "main",
      subpath: "pdf",
      token: "ghp_secret_pat",
    },
  });

  assert.equal(skill.github?.hasAuth, true);
  assert.equal((skill.github as Record<string, unknown>).token, undefined);
  assert.equal(JSON.stringify(skill).includes("ghp_secret_pat"), false);
  assert.equal(JSON.stringify(repo.list()).includes("ghp_secret_pat"), false);

  // Stored encrypted, and getInternal decrypts for API use.
  const row = db.prepare("SELECT github_auth_ref FROM skills WHERE id = ?").get(skill.id) as {
    github_auth_ref: string;
  };
  assert.match(row.github_auth_ref, /^enc:v1:/);
  assert.equal(row.github_auth_ref.includes("ghp_secret_pat"), false);
  assert.equal(repo.getInternal(skill.id).githubToken, "ghp_secret_pat");
});

test("binary files set is_binary and store token_total 0", () => {
  const db = createDatabase();
  const repo = new SkillRepository(db, new SecretStore(Buffer.alloc(32, 5)));
  const skill = repo.create({ name: "bin", sourceType: "upload" });

  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01, 0x02]);
  const v = repo.createVersion(
    skill.id,
    [file("SKILL.md", "text"), { path: "assets/logo.png", bytes: png }],
    { sourceKind: "upload", importedFrom: "upload" },
  );

  const node = repo.listFiles(v.version.id).find((f) => f.path === "assets/logo.png");
  assert.equal(node?.isBinary, true);
  assert.equal(node?.tokenTotal, 0);
  assert.equal(node?.kind, "asset");

  const content = repo.getFileContent(v.version.id, "assets/logo.png");
  assert.equal(content.isBinary, true);
});

test("deleting a skill cascades files and GCs orphan blobs", () => {
  const db = createDatabase();
  const repo = new SkillRepository(db, new SecretStore(Buffer.alloc(32, 6)));
  const skill = repo.create({ name: "gc", sourceType: "upload" });

  repo.createVersion(skill.id, [file("SKILL.md", "a"), file("b.md", "b")], {
    sourceKind: "upload",
    importedFrom: "upload",
  });
  repo.createVersion(skill.id, [file("SKILL.md", "a"), file("b.md", "b2")], {
    sourceKind: "upload",
    importedFrom: "upload",
  });

  assert.ok((db.prepare("SELECT COUNT(*) AS n FROM skill_blobs").get() as { n: number }).n > 0);

  repo.deleteSkill(skill.id);

  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM skills").get() as { n: number }).n, 0);
  assert.equal(
    (db.prepare("SELECT COUNT(*) AS n FROM skill_versions").get() as { n: number }).n,
    0,
  );
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM skill_files").get() as { n: number }).n, 0);
  assert.equal(
    (db.prepare("SELECT COUNT(*) AS n FROM skill_blobs").get() as { n: number }).n,
    0,
    "no orphan blobs remain after delete",
  );
});

test("deleteVersion re-points current_version_id and GCs only its orphaned blobs", () => {
  const db = createDatabase();
  const repo = new SkillRepository(db, new SecretStore(Buffer.alloc(32, 7)));
  const skill = repo.create({ name: "delver", sourceType: "upload" });

  const v1 = repo.createVersion(skill.id, [file("SKILL.md", "a"), file("only-v1.md", "unique1")], {
    sourceKind: "upload",
    importedFrom: "upload",
  });
  const v2 = repo.createVersion(skill.id, [file("SKILL.md", "a"), file("only-v2.md", "unique2")], {
    sourceKind: "upload",
    importedFrom: "upload",
  });

  assert.equal(repo.getPublic(skill.id).currentVersionId, v2.version.id);

  // Delete the current version → current re-points at v1; v2's unique blob is GC'd, v1's survive.
  repo.deleteVersion(v2.version.id);
  assert.equal(repo.getPublic(skill.id).currentVersionId, v1.version.id);

  const shas = (db.prepare("SELECT sha256 FROM skill_blobs").all() as Array<{ sha256: string }>)
    .length;
  // Remaining blobs: SKILL.md ("a") + only-v1.md ("unique1") = 2.
  assert.equal(shas, 2);
});

test("versionPinnedBy returns [] in Phase 1 (delete-guard hook exists)", () => {
  const db = createDatabase();
  const repo = new SkillRepository(db, new SecretStore(Buffer.alloc(32, 8)));
  const skill = repo.create({ name: "guard", sourceType: "upload" });
  const v = repo.createVersion(skill.id, [file("SKILL.md", "x")], {
    sourceKind: "upload",
    importedFrom: "upload",
  });
  assert.deepEqual(repo.versionPinnedBy(v.version.id), []);
});
