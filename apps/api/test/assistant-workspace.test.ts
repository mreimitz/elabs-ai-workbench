import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";
import {
  ensureWorkspaceRoot,
  materializeWorkspace,
  readWorkspaceTree,
  removeSkillWorkspace,
  removeWorkspaceRoot,
  skillWorkspaceDir,
  workspaceRootFor,
} from "../src/assistant/workspace.js";

// Assistant (WP 2.2) — the skill-workspace filesystem plumbing, exercised against a REAL temp
// directory (local fs, not network — allowed by the ground rules). No SDK, no DB, no fake driver: this
// file tests `workspace.ts` in complete isolation.

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function tmpDataDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-assistant-ws-"));
  dirs.push(dir);
  return dir;
}

test("workspaceRootFor is a sibling of threads/<id>, under ws/<id>; ensureWorkspaceRoot creates it idempotently", () => {
  const dataDir = tmpDataDir();
  const root = workspaceRootFor(dataDir, "thread-1");
  assert.equal(root, path.join(path.resolve(dataDir), "ws", "thread-1"));
  assert.equal(fs.existsSync(root), false, "not created by the pure path computation alone");

  const created = ensureWorkspaceRoot(dataDir, "thread-1");
  assert.equal(created, root);
  assert.ok(fs.statSync(root).isDirectory());

  // Idempotent — calling again on an existing dir doesn't throw.
  assert.doesNotThrow(() => ensureWorkspaceRoot(dataDir, "thread-1"));
});

test("materializeWorkspace writes a nested tree and readWorkspaceTree reads the exact bytes back, sorted by path", () => {
  const dataDir = tmpDataDir();
  const root = ensureWorkspaceRoot(dataDir, "thread-2");

  const files = [
    { path: "SKILL.md", bytes: Buffer.from("---\nname: demo\n---\nBody.", "utf8") },
    { path: "references/API.md", bytes: Buffer.from("# API", "utf8") },
    { path: "assets/logo.png", bytes: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01]) },
  ];
  const listing = materializeWorkspace(root, "skill-a", files);
  assert.equal(listing.length, 3);
  // `localeCompare` order (case-insensitive-ish): assets < references < SKILL.md.
  assert.deepEqual(
    listing.map((f) => f.path),
    ["assets/logo.png", "references/API.md", "SKILL.md"],
    "listing is sorted by path",
  );
  assert.equal(listing.find((f) => f.path === "assets/logo.png")?.isBinary, true);
  assert.equal(listing.find((f) => f.path === "SKILL.md")?.isBinary, false);

  const tree = readWorkspaceTree(root, "skill-a");
  assert.equal(tree.length, 3);
  const skillMd = tree.find((f) => f.path === "SKILL.md");
  assert.equal(skillMd?.bytes.toString("utf8"), "---\nname: demo\n---\nBody.");
  const nested = tree.find((f) => f.path === "references/API.md");
  assert.equal(nested?.bytes.toString("utf8"), "# API");
});

test("re-materializing a skill REPLACES its tree (a stale file from a prior open is gone)", () => {
  const dataDir = tmpDataDir();
  const root = ensureWorkspaceRoot(dataDir, "thread-3");

  materializeWorkspace(root, "skill-a", [
    { path: "SKILL.md", bytes: Buffer.from("v1", "utf8") },
    { path: "stale.md", bytes: Buffer.from("will be gone", "utf8") },
  ]);
  materializeWorkspace(root, "skill-a", [{ path: "SKILL.md", bytes: Buffer.from("v2", "utf8") }]);

  const tree = readWorkspaceTree(root, "skill-a");
  assert.equal(tree.length, 1);
  assert.equal(tree[0]?.path, "SKILL.md");
  assert.equal(tree[0]?.bytes.toString("utf8"), "v2");
});

test("readWorkspaceTree picks up a NATIVE file-tool edit made directly on disk (simulates Edit/Write)", () => {
  const dataDir = tmpDataDir();
  const root = ensureWorkspaceRoot(dataDir, "thread-4");
  materializeWorkspace(root, "skill-a", [
    { path: "SKILL.md", bytes: Buffer.from("original", "utf8") },
  ]);

  // Simulate the agent's native Edit/Write tool mutating the file for real (ground rule: extend the
  // fake driver to simulate native edits by writing to the real scratch fs — this is that write).
  const skillMdPath = path.join(skillWorkspaceDir(root, "skill-a"), "SKILL.md");
  fs.writeFileSync(skillMdPath, "edited by the agent");
  fs.writeFileSync(path.join(skillWorkspaceDir(root, "skill-a"), "NEW.md"), "a brand new file");

  const tree = readWorkspaceTree(root, "skill-a");
  assert.equal(
    tree.find((f) => f.path === "SKILL.md")?.bytes.toString("utf8"),
    "edited by the agent",
  );
  assert.equal(tree.find((f) => f.path === "NEW.md")?.bytes.toString("utf8"), "a brand new file");
});

test("readWorkspaceTree throws on a skill that was never opened, and on an emptied-out one", () => {
  const dataDir = tmpDataDir();
  const root = ensureWorkspaceRoot(dataDir, "thread-5");
  assert.throws(() => readWorkspaceTree(root, "never-opened"), /skills_open_workspace/i);

  materializeWorkspace(root, "skill-a", [{ path: "SKILL.md", bytes: Buffer.from("x", "utf8") }]);
  fs.rmSync(path.join(skillWorkspaceDir(root, "skill-a"), "SKILL.md"));
  assert.throws(() => readWorkspaceTree(root, "skill-a"), /empty/i);
});

test("path-traversal guard: a skillId with `..`, a path separator, or an absolute shape is rejected", () => {
  const dataDir = tmpDataDir();
  const root = ensureWorkspaceRoot(dataDir, "thread-6");
  for (const badId of ["../../etc", "a/b", "/etc/passwd", "..", ""]) {
    assert.throws(
      () => materializeWorkspace(root, badId, [{ path: "SKILL.md", bytes: Buffer.from("x") }]),
      (error: unknown) => (error as { statusCode?: number }).statusCode === 400,
      `expected a 400 for skillId ${JSON.stringify(badId)}`,
    );
    assert.throws(
      () => readWorkspaceTree(root, badId),
      (error: unknown) => (error as { statusCode?: number }).statusCode === 400,
    );
  }
});

test("path-traversal guard: a file path with `..` or a leading `/` is rejected on materialize", () => {
  const dataDir = tmpDataDir();
  const root = ensureWorkspaceRoot(dataDir, "thread-7");
  for (const badPath of ["../escape.md", "/etc/passwd", "a/../../escape.md"]) {
    assert.throws(
      () => materializeWorkspace(root, "skill-a", [{ path: badPath, bytes: Buffer.from("x") }]),
      (error: unknown) => (error as { statusCode?: number }).statusCode === 400,
      `expected a 400 for file path ${JSON.stringify(badPath)}`,
    );
  }
});

test(
  "symlink escape guard: a symlink inside the skill dir pointing outside the workspace is refused on commit",
  { skip: process.platform === "win32" },
  () => {
    const dataDir = tmpDataDir();
    const root = ensureWorkspaceRoot(dataDir, "thread-8");
    materializeWorkspace(root, "skill-a", [{ path: "SKILL.md", bytes: Buffer.from("x", "utf8") }]);

    // A file OUTSIDE the entire workspace root the agent must never be able to pull into a commit.
    const outsideSecret = path.join(dataDir, "outside-secret.txt");
    fs.writeFileSync(outsideSecret, "not part of any skill");
    const skillDir = skillWorkspaceDir(root, "skill-a");
    fs.symlinkSync(outsideSecret, path.join(skillDir, "escape.txt"));

    assert.throws(
      () => readWorkspaceTree(root, "skill-a"),
      (error: unknown) => {
        assert.equal((error as { statusCode?: number }).statusCode, 400);
        assert.match((error as Error).message, /outside the skill workspace/i);
        return true;
      },
    );
  },
);

test(
  "a symlink that stays INSIDE the skill's own directory is followed normally",
  { skip: process.platform === "win32" },
  () => {
    const dataDir = tmpDataDir();
    const root = ensureWorkspaceRoot(dataDir, "thread-9");
    materializeWorkspace(root, "skill-a", [
      { path: "SKILL.md", bytes: Buffer.from("real content", "utf8") },
    ]);
    const skillDir = skillWorkspaceDir(root, "skill-a");
    fs.symlinkSync(path.join(skillDir, "SKILL.md"), path.join(skillDir, "alias.md"));

    const tree = readWorkspaceTree(root, "skill-a");
    assert.equal(tree.find((f) => f.path === "alias.md")?.bytes.toString("utf8"), "real content");
  },
);

test("removeSkillWorkspace removes only that skill's dir, leaving a sibling skill + the root intact", () => {
  const dataDir = tmpDataDir();
  const root = ensureWorkspaceRoot(dataDir, "thread-10");
  materializeWorkspace(root, "skill-a", [{ path: "SKILL.md", bytes: Buffer.from("a", "utf8") }]);
  materializeWorkspace(root, "skill-b", [{ path: "SKILL.md", bytes: Buffer.from("b", "utf8") }]);

  removeSkillWorkspace(root, "skill-a");

  assert.equal(fs.existsSync(skillWorkspaceDir(root, "skill-a")), false);
  assert.equal(fs.existsSync(skillWorkspaceDir(root, "skill-b")), true);
  assert.equal(fs.existsSync(root), true, "the thread's workspace root itself survives");
});

test("removeWorkspaceRoot deletes the entire thread workspace (every skill it ever opened); a no-op if never created", () => {
  const dataDir = tmpDataDir();
  const root = ensureWorkspaceRoot(dataDir, "thread-11");
  materializeWorkspace(root, "skill-a", [{ path: "SKILL.md", bytes: Buffer.from("a", "utf8") }]);

  removeWorkspaceRoot(dataDir, "thread-11");
  assert.equal(fs.existsSync(root), false);

  // Never created at all — force:true makes this a clean no-op, never a throw.
  assert.doesNotThrow(() => removeWorkspaceRoot(dataDir, "thread-never-existed"));
});
