// Assistant Hub (planning/Roadmap/RM-03-assistant-hub/, WP0.5) — `hub/workspace.ts`: the per-session workspace
// filesystem confinement (path-traversal-guarded; content read/written, NEVER executed).
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";
import {
  createWorkspaceSnapshot,
  editWorkspaceTextFile,
  ensureHubWorkspaceRoot,
  hubWorkspaceRootFor,
  listWorkspaceSnapshots,
  listWorkspaceTree,
  readWorkspaceTextFile,
  removeHubWorkspaceRoot,
  restoreWorkspaceSnapshot,
  writeWorkspaceTextFile,
} from "../src/hub/workspace.js";

const tempDirs: string[] = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function tempDataDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hub-ws-test-"));
  tempDirs.push(dir);
  return dir;
}

test("hubWorkspaceRootFor rejects a session id with path separators / traversal", () => {
  const dataDir = tempDataDir();
  assert.throws(() => hubWorkspaceRootFor(dataDir, "../escape"), /Invalid session id/);
  assert.throws(() => hubWorkspaceRootFor(dataDir, "a/b"), /Invalid session id/);
});

test("ensureHubWorkspaceRoot creates <dataDir>/hub/ws/<sessionId> idempotently", () => {
  const dataDir = tempDataDir();
  const root1 = ensureHubWorkspaceRoot(dataDir, "sess1");
  const root2 = ensureHubWorkspaceRoot(dataDir, "sess1");
  assert.equal(root1, root2);
  assert.equal(root1, path.join(path.resolve(dataDir), "hub", "ws", "sess1"));
  assert.ok(fs.existsSync(root1));
});

test("write then read round-trips a text file, creating parent directories", () => {
  const dataDir = tempDataDir();
  const root = ensureHubWorkspaceRoot(dataDir, "sess2");
  const result = writeWorkspaceTextFile(root, "notes/plan.md", "# Plan\n\nStep 1.");
  assert.equal(result.path, "notes/plan.md");
  assert.equal(result.bytes, Buffer.byteLength("# Plan\n\nStep 1.", "utf8"));
  assert.equal(readWorkspaceTextFile(root, "notes/plan.md"), "# Plan\n\nStep 1.");
});

test("readWorkspaceTextFile 404s on a missing file", () => {
  const dataDir = tempDataDir();
  const root = ensureHubWorkspaceRoot(dataDir, "sess3");
  assert.throws(
    () => readWorkspaceTextFile(root, "nope.txt"),
    (error: unknown) => (error as { statusCode?: number }).statusCode === 404,
  );
});

test("path-traversal guard: '..' segments, absolute paths, and NUL bytes are all rejected (write + read)", () => {
  const dataDir = tempDataDir();
  const root = ensureHubWorkspaceRoot(dataDir, "sess4");
  for (const bad of ["../escape.txt", "a/../../escape.txt", "/etc/passwd", "a\0b"]) {
    assert.throws(
      () => writeWorkspaceTextFile(root, bad, "x"),
      (error: unknown) => (error as { statusCode?: number }).statusCode === 400,
      `write should reject "${bad}"`,
    );
    assert.throws(
      () => readWorkspaceTextFile(root, bad),
      (error: unknown) => (error as { statusCode?: number }).statusCode === 400,
      `read should reject "${bad}"`,
    );
  }
});

test("symlink escape guard: a symlink resolving OUTSIDE the workspace root is refused on read", () => {
  const dataDir = tempDataDir();
  const root = ensureHubWorkspaceRoot(dataDir, "sess5");
  const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), "hub-ws-outside-"));
  tempDirs.push(outsideDir);
  const secretFile = path.join(outsideDir, "secret.txt");
  fs.writeFileSync(secretFile, "top secret");
  const linkPath = path.join(root, "escape-link.txt");
  fs.symlinkSync(secretFile, linkPath);

  assert.throws(
    () => readWorkspaceTextFile(root, "escape-link.txt"),
    (error: unknown) => (error as { statusCode?: number }).statusCode === 400,
  );
});

// ── Wave-3 adversarial-review F1 — CREATE-through-symlinked-parent escape guard ────────────────────

test("symlink escape guard (F1): writing a NEW file through a symlinked parent directory is refused, not followed outside", () => {
  const dataDir = tempDataDir();
  const root = ensureHubWorkspaceRoot(dataDir, "sess-f1a");
  const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), "hub-ws-outside-"));
  tempDirs.push(outsideDir);

  // `linkdir` lives INSIDE the workspace but points OUTSIDE it. `new.txt` does not exist yet under
  // EITHER path — this is the case the old check missed (it only ever guarded an EXISTING target).
  const linkPath = path.join(root, "linkdir");
  fs.symlinkSync(outsideDir, linkPath);

  assert.throws(
    () => writeWorkspaceTextFile(root, "linkdir/new.txt", "escaped content"),
    (error: unknown) => (error as { statusCode?: number }).statusCode === 400,
    "a create through a symlinked parent must throw, not escape",
  );
  assert.ok(
    !fs.existsSync(path.join(outsideDir, "new.txt")),
    "the file must NOT have been written outside the workspace",
  );
});

test("symlink escape guard (F1): a NESTED new path under a symlinked ancestor several levels up is also refused", () => {
  const dataDir = tempDataDir();
  const root = ensureHubWorkspaceRoot(dataDir, "sess-f1b");
  const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), "hub-ws-outside-"));
  tempDirs.push(outsideDir);
  const linkPath = path.join(root, "linkdir");
  fs.symlinkSync(outsideDir, linkPath);

  assert.throws(
    () => writeWorkspaceTextFile(root, "linkdir/deep/nested/new.txt", "escaped"),
    (error: unknown) => (error as { statusCode?: number }).statusCode === 400,
  );
  assert.ok(!fs.existsSync(path.join(outsideDir, "deep")));
});

test("symlink escape guard (F1) does not false-positive: creating a brand-new nested file under a REAL (non-symlinked) new directory tree still works", () => {
  const dataDir = tempDataDir();
  const root = ensureHubWorkspaceRoot(dataDir, "sess-f1c");
  const result = writeWorkspaceTextFile(root, "brand/new/nested/dir.txt", "hello");
  assert.equal(result.path, "brand/new/nested/dir.txt");
  assert.equal(readWorkspaceTextFile(root, "brand/new/nested/dir.txt"), "hello");
});

test("editWorkspaceTextFile requires a unique match; errors on zero or multiple matches without replaceAll", () => {
  const dataDir = tempDataDir();
  const root = ensureHubWorkspaceRoot(dataDir, "sess6");
  writeWorkspaceTextFile(root, "f.txt", "alpha beta alpha");

  assert.throws(
    () => editWorkspaceTextFile(root, "f.txt", "gamma", "delta"),
    (error: unknown) => (error as { statusCode?: number }).statusCode === 400,
    "zero matches should 400",
  );
  assert.throws(
    () => editWorkspaceTextFile(root, "f.txt", "alpha", "X"),
    (error: unknown) => (error as { statusCode?: number }).statusCode === 400,
    "non-unique match without replaceAll should 400",
  );

  const result = editWorkspaceTextFile(root, "f.txt", "alpha", "X", true);
  assert.equal(result.replacements, 2);
  assert.equal(readWorkspaceTextFile(root, "f.txt"), "X beta X");
});

test("editWorkspaceTextFile replaces a single unique match", () => {
  const dataDir = tempDataDir();
  const root = ensureHubWorkspaceRoot(dataDir, "sess7");
  writeWorkspaceTextFile(root, "f.txt", "hello world");
  const result = editWorkspaceTextFile(root, "f.txt", "world", "there");
  assert.equal(result.replacements, 1);
  assert.equal(readWorkspaceTextFile(root, "f.txt"), "hello there");
});

// ── Wave-3 adversarial-review F2 — workspace write size cap ────────────────────────────────────────

test("writeWorkspaceTextFile (F2): an over-cap write is rejected with a clear 400; the default cap lets an ordinary write through", () => {
  const dataDir = tempDataDir();
  const root = ensureHubWorkspaceRoot(dataDir, "sess-f2a");

  // Under an explicit small cap: a small write succeeds, an over-cap write is rejected and nothing
  // is left on disk.
  const ok = writeWorkspaceTextFile(root, "small.txt", "hello", { maxBytes: 10 });
  assert.equal(ok.bytes, 5);
  assert.throws(
    () => writeWorkspaceTextFile(root, "big.txt", "x".repeat(11), { maxBytes: 10 }),
    (error: unknown) => (error as { statusCode?: number }).statusCode === 400,
  );
  assert.ok(!fs.existsSync(path.join(root, "big.txt")), "an over-cap write must not land on disk");

  // No explicit cap: the module's own default (HUB_WS_MAX_FILE_BYTES) still lets an ordinary,
  // realistic write through untouched.
  const defaulted = writeWorkspaceTextFile(root, "default-cap.txt", "an ordinary small file");
  assert.equal(defaulted.bytes, Buffer.byteLength("an ordinary small file", "utf8"));
});

test("editWorkspaceTextFile (F2): an edit that would grow the file past the cap is rejected; the original content is untouched", () => {
  const dataDir = tempDataDir();
  const root = ensureHubWorkspaceRoot(dataDir, "sess-f2b");
  writeWorkspaceTextFile(root, "f.txt", "hello world", { maxBytes: 1000 });

  assert.throws(
    () => editWorkspaceTextFile(root, "f.txt", "world", "x".repeat(50), false, { maxBytes: 20 }),
    (error: unknown) => (error as { statusCode?: number }).statusCode === 400,
  );
  assert.equal(readWorkspaceTextFile(root, "f.txt"), "hello world", "rejected edit must not mutate the file");

  const result = editWorkspaceTextFile(root, "f.txt", "world", "there", false, { maxBytes: 20 });
  assert.equal(result.replacements, 1);
  assert.equal(readWorkspaceTextFile(root, "f.txt"), "hello there");
});

test("listWorkspaceTree lists files recursively, sorted, with directories flagged; empty for an unused workspace", () => {
  const dataDir = tempDataDir();
  const root = ensureHubWorkspaceRoot(dataDir, "sess8");
  assert.deepEqual(listWorkspaceTree(root), []);

  writeWorkspaceTextFile(root, "a.txt", "1");
  writeWorkspaceTextFile(root, "sub/b.txt", "22");
  const entries = listWorkspaceTree(root);
  const names = entries.map((e) => e.path);
  assert.ok(names.includes("a.txt"));
  assert.ok(names.includes("sub"));
  assert.ok(names.includes("sub/b.txt"));
  const dirEntry = entries.find((e) => e.path === "sub");
  assert.equal(dirEntry?.isDirectory, true);
  const fileEntry = entries.find((e) => e.path === "sub/b.txt");
  assert.equal(fileEntry?.isDirectory, false);
  assert.equal(fileEntry?.size, 2);
});

test("removeHubWorkspaceRoot removes the whole session workspace", () => {
  const dataDir = tempDataDir();
  const root = ensureHubWorkspaceRoot(dataDir, "sess9");
  writeWorkspaceTextFile(root, "a.txt", "x");
  assert.ok(fs.existsSync(root));
  removeHubWorkspaceRoot(dataDir, "sess9");
  assert.ok(!fs.existsSync(root));
});

// ── WP3.4 (R-SES6) — content-addressed workspace snapshots ─────────────────────────────────────────

test("createWorkspaceSnapshot captures the current tree; restore checks out its content, leaving untracked new files alone", () => {
  const dataDir = tempDataDir();
  const root = ensureHubWorkspaceRoot(dataDir, "sess-snap");
  writeWorkspaceTextFile(root, "a.txt", "version 1");
  writeWorkspaceTextFile(root, "nested/b.txt", "nested v1");

  const snapshot = createWorkspaceSnapshot(root, "checkpoint 1");
  assert.equal(snapshot.label, "checkpoint 1");
  assert.equal(snapshot.fileCount, 2);
  assert.equal(snapshot.totalBytes, "version 1".length + "nested v1".length);

  // Mutate an existing file AND add a brand-new one that was never part of the snapshot.
  writeWorkspaceTextFile(root, "a.txt", "version 2");
  writeWorkspaceTextFile(root, "untracked.txt", "never snapshotted");

  const { restored } = restoreWorkspaceSnapshot(root, snapshot.id);
  assert.equal(restored, 2);
  assert.equal(
    readWorkspaceTextFile(root, "a.txt"),
    "version 1",
    "restored to the snapshotted content",
  );
  assert.equal(readWorkspaceTextFile(root, "nested/b.txt"), "nested v1");
  assert.equal(
    readWorkspaceTextFile(root, "untracked.txt"),
    "never snapshotted",
    "a file gained AFTER the snapshot is left alone — restore is a checkout, never an implicit prune",
  );
});

test("createWorkspaceSnapshot content-addresses: two files with IDENTICAL bytes share ONE blob", () => {
  const dataDir = tempDataDir();
  const root = ensureHubWorkspaceRoot(dataDir, "sess-snap2");
  writeWorkspaceTextFile(root, "a.txt", "same content");
  writeWorkspaceTextFile(root, "b.txt", "same content");
  createWorkspaceSnapshot(root);

  const blobsDir = path.join(root, "_snapshots", "blobs");
  const blobs = fs.readdirSync(blobsDir);
  assert.equal(blobs.length, 1, "one shared blob for two files with identical bytes");
});

test("listWorkspaceSnapshots is newest-first and empty for an unused workspace; never recursively snapshots itself", () => {
  const dataDir = tempDataDir();
  const root = ensureHubWorkspaceRoot(dataDir, "sess-snap3");
  assert.deepEqual(listWorkspaceSnapshots(root), []);

  writeWorkspaceTextFile(root, "a.txt", "1");
  const first = createWorkspaceSnapshot(root, "first");
  // `createWorkspaceSnapshot` stamps `new Date().toISOString()` (millisecond precision) and
  // `listWorkspaceSnapshots` sorts `createdAt` DESC then `id` DESC. Two back-to-back snapshots
  // therefore land in the SAME millisecond most of the time, and the tie breaks on a random nanoid —
  // which made this "newest-first" assertion fail ~20% of runs. Waiting for the clock to tick is what
  // makes the two `createdAt`s genuinely differ, so this test measures ordering-by-time (its actual
  // subject) rather than the tie-break. The same-millisecond tie is locked deterministically by the
  // F3 test immediately below, so nothing is lost by keeping the two concerns separate.
  const startedAt = Date.now();
  while (Date.now() === startedAt) {
    /* spin until the millisecond ticks — sub-millisecond in practice */
  }
  writeWorkspaceTextFile(root, "a.txt", "2");
  const second = createWorkspaceSnapshot(root, "second");
  assert.notEqual(first.createdAt, second.createdAt, "the two snapshots must differ in time");

  const list = listWorkspaceSnapshots(root);
  assert.deepEqual(
    list.map((s) => s.id),
    [second.id, first.id],
  );
  // A snapshot never includes `_snapshots/` itself — no infinite/recursive growth.
  const third = createWorkspaceSnapshot(root, "third");
  const thirdManifest = JSON.parse(
    fs.readFileSync(path.join(root, "_snapshots", "manifests", `${third.id}.json`), "utf8"),
  ) as { entries: Array<{ path: string }> };
  assert.ok(thirdManifest.entries.every((e) => !e.path.startsWith("_snapshots/")));
});

// ── Wave-3 adversarial-review F3 — deterministic ordering for same-`createdAt` snapshots ───────────

test("listWorkspaceSnapshots (F3): two snapshots with the SAME createdAt millisecond list in a deterministic order, repeatably", () => {
  const dataDir = tempDataDir();
  const root = ensureHubWorkspaceRoot(dataDir, "sess-snap-tie");
  const manifestDir = path.join(root, "_snapshots", "manifests");
  fs.mkdirSync(manifestDir, { recursive: true });

  // Write two manifests directly with an IDENTICAL createdAt (what `createWorkspaceSnapshot` would
  // produce for two snapshots taken within the same millisecond — a real, if narrow, race) but
  // DIFFERENT ids, so any ordering that relies on createdAt alone is a coin flip.
  const tiedCreatedAt = "2026-07-18T00:00:00.000Z";
  const idA = "aaaaaaaaaa";
  const idB = "zzzzzzzzzz";
  for (const id of [idA, idB]) {
    fs.writeFileSync(
      path.join(manifestDir, `${id}.json`),
      JSON.stringify({ id, createdAt: tiedCreatedAt, entries: [] }),
      "utf8",
    );
  }

  const orderings = Array.from({ length: 10 }, () => listWorkspaceSnapshots(root).map((s) => s.id));
  for (const ordering of orderings) {
    assert.deepEqual(ordering, orderings[0], "the tie must resolve to the SAME order every call");
  }
  // The documented tiebreaker is id descending.
  assert.deepEqual(orderings[0], [idB, idA]);
});

test("restoreWorkspaceSnapshot 404s on an unknown snapshot id and rejects a traversal-shaped one", () => {
  const dataDir = tempDataDir();
  const root = ensureHubWorkspaceRoot(dataDir, "sess-snap4");
  assert.throws(() => restoreWorkspaceSnapshot(root, "does-not-exist"), /404|not found|snapshot/i);
  assert.throws(() => restoreWorkspaceSnapshot(root, "../../etc/passwd"), /400|invalid/i);
});
