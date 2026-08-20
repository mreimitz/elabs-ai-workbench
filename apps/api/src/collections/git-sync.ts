import fs from "node:fs";
import path from "node:path";
import {
  type Collection,
  type CollectionSyncResult,
  type CollectionSyncState,
  REPO_NOT_BOUND_CODE,
  type Suite,
  type SuiteFile,
  type SyncConflict,
  type TestFile,
  suiteFileSchema,
  testFileSchema,
} from "@mcp-token-footprint/shared";
import type { AppDatabase } from "../db/database.js";
import {
  assertHostAllowed,
  type DnsLookupAll,
  defaultLookup,
  errText,
  looksLikeAuthFailure,
  redactUrl,
  runGit,
  withToken,
} from "../git/git-credential.js";
import { assertSafeRelativePath, assertWithinBase } from "./path-safety.js";
import type { CollectionRepository } from "./repository.js";
import {
  fileToSuiteInput,
  fileToTestInput,
  serializeFile,
  suiteToFile,
  testToFile,
} from "./serializer.js";
import type { SuiteRepository } from "../suites/repository.js";
import type { TestRepository } from "../testing/test-repository.js";
import { httpError } from "../utils/errors.js";

/**
 * WP 4.2 (Benchmarks, B11) — REAL-git two-way sync for a Collection, on the exact skills-git trust
 * model (the credential/SSRF/timeout discipline lives in ONE shared module, `../git/git-credential.ts`,
 * consumed here AND by the skills git services).
 *
 * Each collection keeps a persistent working clone under `<baseDir>/<id>` (NEVER inside the repo tree).
 * A sync is: export local members → commit if dirty → fetch → merge (a real 3-way — **NEVER a rebase,
 * NEVER a force-push**) → reconcile the DB from the merged worktree → push. A conflict surfaces as a
 * per-file {@link SyncConflict} list and STOPS (no push); `resolve` finishes the in-progress merge.
 *
 * INVARIANTS (planning/Roadmap/RM-07-benchmarks/conventions.md):
 *  - The PAT is obtained ONLY via {@link CollectionRepository.decryptPat} (internal), injected via the
 *    argv-only {@link withToken} helper, NEVER written to `.git/config` (the clone's origin url is
 *    scrubbed to the tokenless url immediately after clone; every fetch/push passes the auth url as an
 *    argv), NEVER returned by a route, NEVER logged; every surfaced git error is {@link redactUrl}-ed.
 *  - No force-push, EVER. `push` is only ever `git push <url> <branch>:refs/heads/<branch>` (no `-f`,
 *    no `--force`, no `--force-with-lease`). No `rebase`.
 *  - Exported files carry no secrets / local-only refs (guaranteed by the 4.1 serializer).
 *  - Sync runs only on an explicit user action (a route call).
 */
export class CollectionGitSyncService {
  private readonly baseDir: string;
  private readonly gitTimeoutMs: number;
  private readonly lookup: DnsLookupAll;

  /**
   * H-5 — per-collection-id serialization. `sync`/`status`/`resolve` all mutate the SAME persistent
   * clone at `<baseDir>/<id>` with many `await` points between git subprocesses; two overlapping HTTP
   * calls would interleave `git add`/`commit`/`merge`/`checkout` on one index (or `ensureClone` could
   * `rmSync` the clone mid-commit). This map holds a per-id promise chain so every entry point runs to
   * completion before the next one for the same collection starts. Different collections stay parallel.
   */
  private readonly locks = new Map<string, Promise<unknown>>();

  constructor(
    private readonly db: AppDatabase,
    private readonly collections: CollectionRepository,
    private readonly tests: TestRepository,
    private readonly suites: SuiteRepository,
    options: { baseDir: string; gitTimeoutMs?: number; lookup?: DnsLookupAll },
  ) {
    this.baseDir = options.baseDir;
    this.gitTimeoutMs = options.gitTimeoutMs ?? 120_000;
    this.lookup = options.lookup ?? defaultLookup;
  }

  // --- Public API -------------------------------------------------------------------------------

  /**
   * Run `fn` after any in-flight operation for `collectionId` has settled, and register it as the new
   * tail so the NEXT call waits for this one (H-5). The stored tail swallows errors so one failed sync
   * never wedges the chain; the returned promise still rejects for its own caller (Fastify handles it).
   */
  private serialize<T>(collectionId: string, fn: () => Promise<T>): Promise<T> {
    const tail = (this.locks.get(collectionId) ?? Promise.resolve()).catch(() => undefined);
    const result = tail.then(fn);
    this.locks.set(
      collectionId,
      result.then(
        () => undefined,
        () => undefined,
      ),
    );
    return result;
  }

  /**
   * Full sync pipeline (see the class doc). Returns the resulting {@link CollectionSyncResult}. On a
   * merge conflict it returns `status: "conflicts"` with the per-file diff and does NOT push; call
   * {@link resolve} to finish. A zod-invalid remote file fails cleanly (naming the file) with the DB
   * untouched. Serialized per collection id (H-5).
   */
  sync(collectionId: string): Promise<CollectionSyncResult> {
    return this.serialize(collectionId, () => this.syncImpl(collectionId));
  }

  private async syncImpl(collectionId: string): Promise<CollectionSyncResult> {
    const collection = this.collections.get(collectionId); // 404 if unknown (redacted — no PAT)
    const { repoUrl: cleanUrl, repoPath, branch } = requireBinding(collection); // 400 if unbound (local)
    const token = this.collections.decryptPat(collectionId);
    const firstSync = !collection.lastSyncedSha;

    const clonePath = await this.ensureClone(collectionId, cleanUrl, branch, token);

    // An unresolved merge from a prior conflict: don't stack another — report it and stop.
    if (this.mergeInProgress(clonePath)) {
      const conflicts = await this.parseConflicts(clonePath);
      return this.result("conflicts", await this.buildState(clonePath, branch, conflicts));
    }

    // 1. Materialize the current local members into the worktree (adds + edits + rename cleanup).
    this.exportLocalMembers(clonePath, repoPath, collectionId);

    // 2. Commit IF the export produced any change.
    await this.commitIfDirty(clonePath);

    // 3. Fetch the remote branch into refs/remotes/origin/<branch> (no-op for an empty remote).
    await this.fetch(clonePath, cleanUrl, branch, token);

    const remoteRef = `refs/remotes/origin/${branch}`;
    const remoteExists = await this.refExists(clonePath, remoteRef);

    // 4. ahead / behind relative to the fetched remote branch.
    const behind = remoteExists
      ? await this.aheadBehind(clonePath, branch, remoteRef, "behind")
      : 0;

    // 5. Merge remote changes (fast-forward or a real 3-way). NEVER a rebase.
    let mergedOrPulled = false;
    if (behind > 0) {
      const conflicts = await this.merge(clonePath, remoteRef);
      if (conflicts.length > 0) {
        // STOP: leave the merge in progress for `resolve`; do not push.
        return this.result("conflicts", await this.buildState(clonePath, branch, conflicts));
      }
      mergedOrPulled = true;
    }

    // 6. Reflect the merged worktree back into the DB (imports remote adds/edits). Runs on the first
    //    sync (import-bootstrap) or whenever remote changes were merged/fast-forwarded.
    if (firstSync || mergedOrPulled) {
      this.reconcileDbFromWorktree(clonePath, repoPath, collectionId);
    }

    // 7. Push our local commits (never forced). Recompute ahead AFTER any merge commit.
    const aheadNow = remoteExists
      ? await this.aheadBehind(clonePath, branch, remoteRef, "ahead")
      : await this.commitCount(clonePath, branch);
    let pushed = false;
    if (aheadNow > 0) {
      await this.push(clonePath, cleanUrl, branch, token);
      pushed = true;
    }

    // 8. Record the converged commit.
    const head = await this.headSha(clonePath);
    if (head) this.updateLastSyncedSha(collectionId, head);

    const status: CollectionSyncResult["status"] = pushed
      ? mergedOrPulled
        ? "merged"
        : "pushed"
      : mergedOrPulled || firstSync
        ? "pulled"
        : "unchanged";
    return this.result(status, await this.buildState(clonePath, branch, []));
  }

  /**
   * Live sync state relative to the remote (ahead/behind/dirty + any in-progress conflict). READ-ONLY:
   * it ensures the clone and fetches, but — unlike a sync — it does NOT export local members into the
   * worktree (H-5: a GET must never mutate the persistent clone), commit, merge, or push. `dirty` here
   * therefore reflects the worktree's own state (an in-progress merge, or a prior sync's residue), not
   * un-exported local DB edits — a full {@link sync} is what materializes and reconciles those.
   * Serialized per collection id (H-5).
   */
  status(collectionId: string): Promise<CollectionSyncState> {
    return this.serialize(collectionId, () => this.statusImpl(collectionId));
  }

  private async statusImpl(collectionId: string): Promise<CollectionSyncState> {
    const collection = this.collections.get(collectionId);
    const { repoUrl, branch } = requireBinding(collection); // 400 if unbound (local)
    const token = this.collections.decryptPat(collectionId);
    const clonePath = await this.ensureClone(collectionId, repoUrl, branch, token);

    if (this.mergeInProgress(clonePath)) {
      const conflicts = await this.parseConflicts(clonePath);
      return this.buildState(clonePath, branch, conflicts);
    }

    await this.fetch(clonePath, repoUrl, branch, token);
    return this.buildState(clonePath, branch, []);
  }

  /**
   * Finish a conflicted sync: for each conflicted file apply the chosen side (`take-local` = our
   * staged version, `take-remote` = their staged version, `edited` = supplied content), `git add`,
   * commit the merge, reconcile the DB from the resolved worktree, push, and re-run status.
   */
  resolve(
    collectionId: string,
    resolutions: ConflictResolution[],
  ): Promise<CollectionSyncResult> {
    return this.serialize(collectionId, () => this.resolveImpl(collectionId, resolutions));
  }

  private async resolveImpl(
    collectionId: string,
    resolutions: ConflictResolution[],
  ): Promise<CollectionSyncResult> {
    const collection = this.collections.get(collectionId);
    const { repoUrl, repoPath, branch } = requireBinding(collection); // 400 if unbound (local)
    const token = this.collections.decryptPat(collectionId);
    const clonePath = await this.ensureClone(collectionId, repoUrl, branch, token);

    if (!this.mergeInProgress(clonePath)) {
      // Nothing to resolve — return current state so the UI reconciles.
      return this.result("unchanged", await this.buildState(clonePath, branch, []));
    }

    // C-1 / security H1 — the ONLY legal targets are the paths git reports as unmerged in THIS merge
    // (the exact set already surfaced to the client as `SyncConflict.path`). Restricting to that set,
    // on top of the safe-path + containment checks below, closes the arbitrary host-file write/delete.
    const legalPaths = new Set((await this.parseConflicts(clonePath)).map((c) => c.path));

    for (const res of resolutions) {
      // Defense in depth: reject a traversal path (the route schema already does, this re-asserts),
      // assert the resolved target stays inside the clone, and require it to be a real conflicted path
      // — all BEFORE any fs write/delete.
      assertSafeRelativePath(res.path);
      const abs = path.join(clonePath, ...res.path.split("/"));
      assertWithinBase(clonePath, abs);
      if (!legalPaths.has(res.path)) {
        throw httpError(400, `"${res.path}" is not an unresolved conflict in this merge.`);
      }
      if (res.resolution === "edited") {
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, res.content ?? "");
        await this.git(clonePath, ["add", "--", res.path]);
      } else {
        const stage = res.resolution === "take-local" ? 2 : 3;
        const content = await this.stageContent(clonePath, stage, res.path);
        if (content === undefined) {
          // The chosen side deleted the file → remove it and stage the deletion.
          fs.rmSync(abs, { force: true });
          await this.git(clonePath, ["rm", "-f", "--ignore-unmatch", "--", res.path]);
        } else {
          fs.mkdirSync(path.dirname(abs), { recursive: true });
          fs.writeFileSync(abs, content);
          await this.git(clonePath, ["add", "--", res.path]);
        }
      }
    }

    // Every conflicted path must now be resolved before we can commit the merge.
    const stillConflicted = await this.parseConflicts(clonePath);
    if (stillConflicted.length > 0) {
      return this.result("conflicts", await this.buildState(clonePath, branch, stillConflicted));
    }

    await this.git(clonePath, ["commit", "--no-edit"], committerEnv());
    this.reconcileDbFromWorktree(clonePath, repoPath, collectionId);

    const remoteRef = `refs/remotes/origin/${branch}`;
    const aheadNow = (await this.refExists(clonePath, remoteRef))
      ? await this.aheadBehind(clonePath, branch, remoteRef, "ahead")
      : await this.commitCount(clonePath, branch);
    if (aheadNow > 0) {
      await this.push(clonePath, repoUrl, branch, token);
    }
    const head = await this.headSha(clonePath);
    if (head) this.updateLastSyncedSha(collectionId, head);

    return this.result("merged", await this.buildState(clonePath, branch, []));
  }

  // --- Working-clone lifecycle ------------------------------------------------------------------

  /**
   * Ensure a valid working clone exists at `<baseDir>/<id>` for `cleanUrl`. Re-clones if the dir is
   * missing, not a git repo, or points at a different remote (corruption / rebind). The clone is done
   * with the auth url, then origin is immediately scrubbed to the tokenless url so no PAT ever lands
   * in `.git/config`.
   */
  private async ensureClone(
    collectionId: string,
    cleanUrl: string,
    branch: string,
    token: string | undefined,
  ): Promise<string> {
    const clonePath = path.join(this.baseDir, collectionId);

    if (await this.isValidClone(clonePath, cleanUrl)) {
      // A clone mid-merge (an unresolved conflict) must keep its index — resetting the branch here
      // would fail ("you need to resolve your current index first") and clobber the in-progress merge.
      if (!this.mergeInProgress(clonePath)) {
        await this.prepareBranch(clonePath, branch);
      }
      return clonePath;
    }

    // Wipe any partial/corrupt clone, then re-clone.
    fs.rmSync(clonePath, { recursive: true, force: true });
    fs.mkdirSync(this.baseDir, { recursive: true });

    await assertHostAllowed(cleanUrl, this.lookup); // SSRF DNS guard before any network git call
    const authUrl = withToken(cleanUrl, token);
    try {
      await this.git(this.baseDir, ["clone", "--no-tags", authUrl, clonePath]);
    } catch (err) {
      // NEVER surface the auth url: redact before it can reach a response or a log.
      throw gitError("clone", cleanUrl, err);
    }
    // Scrub the token from persisted config; every later fetch/push passes the auth url as an argv.
    await this.git(clonePath, ["remote", "set-url", "origin", cleanUrl]);
    await this.prepareBranch(clonePath, branch);
    return clonePath;
  }

  private async isValidClone(clonePath: string, cleanUrl: string): Promise<boolean> {
    if (!fs.existsSync(path.join(clonePath, ".git"))) return false;
    try {
      const { stdout } = await this.git(clonePath, ["config", "--get", "remote.origin.url"]);
      return stdout.trim() === cleanUrl;
    } catch {
      return false;
    }
  }

  /** Put HEAD on `branch`: reset to origin/<branch> if it exists, else create it (unborn for an empty remote). */
  private async prepareBranch(clonePath: string, branch: string): Promise<void> {
    const remoteRef = `refs/remotes/origin/${branch}`;
    if (await this.refExists(clonePath, remoteRef)) {
      await this.git(clonePath, ["checkout", "-q", "-B", branch, remoteRef]);
    } else if (await this.refExists(clonePath, "HEAD")) {
      await this.git(clonePath, ["checkout", "-q", "-B", branch]);
    } else {
      // Empty remote — point HEAD at the (unborn) target branch so the first commit lands there.
      await this.git(clonePath, ["symbolic-ref", "HEAD", `refs/heads/${branch}`]);
    }
  }

  // --- Export (DB → worktree) -------------------------------------------------------------------

  /**
   * Write every current local member (test/suite that belongs to this collection and has an
   * `external_key`) into `<clonePath>/<repoPath>/{tests,suites}/<kebab-name>.json`. Identity is the
   * `external_key` INSIDE the file, so a rename (filename change) removes the member's old file.
   * Remote-only files (external_keys not in the local member set) are NEVER touched.
   */
  private exportLocalMembers(clonePath: string, repoSubpath: string, collectionId: string): void {
    const root = repoRoot(clonePath, repoSubpath);
    this.exportKind(path.join(root, "tests"), this.memberTestRows(collectionId), (row) => {
      const test = this.tests.get(row.id);
      test.externalKey = row.external_key;
      return { name: test.name, content: serializeFile(testToFile(test)) };
    });
    this.exportKind(path.join(root, "suites"), this.memberSuiteRows(collectionId), (row) => {
      const suite = this.suites.get(row.id);
      suite.externalKey = row.external_key;
      const memberKeys = this.suiteMemberExternalKeys(suite);
      return { name: suite.name, content: serializeFile(suiteToFile(suite, memberKeys)) };
    });
  }

  private exportKind(
    dir: string,
    rows: MemberRow[],
    render: (row: MemberRow) => { name: string; content: string },
  ): void {
    fs.mkdirSync(dir, { recursive: true });
    const existingByKey = indexFilesByExternalKey(dir);

    // H-6 — an on-disk file owned by a DIFFERENT `external_key` than any member in THIS batch is a
    // "foreign" file (remote-only, or a detached member's file legitimately kept for the remote side).
    // Seed `usedNames` with those filenames so a current member whose name kebabs to the same slug gets
    // a `-2`/`-3` suffix instead of silently OVERWRITING (then pushing over) the foreign file — the
    // module's "remote-only files are NEVER touched" invariant. A member's OWN existing file (same key)
    // is NOT reserved, so it re-writes/renames in place as before.
    const batchKeys = new Set(rows.map((row) => row.external_key).filter((k): k is string => !!k));
    const usedNames = new Set<string>();
    for (const [key, abs] of existingByKey) {
      if (!batchKeys.has(key)) usedNames.add(path.basename(abs));
    }

    for (const row of rows) {
      if (!row.external_key) continue; // memberRows already filter this out; guard for the type + safety
      const { name, content } = render(row);
      const fileName = uniqueFileName(kebab(name), usedNames);
      const desiredPath = path.join(dir, fileName);
      const old = existingByKey.get(row.external_key);
      if (old && path.resolve(old) !== path.resolve(desiredPath)) {
        fs.rmSync(old, { force: true }); // rename cleanup — same identity moved to a new filename
      }
      fs.writeFileSync(desiredPath, content);
    }
  }

  // --- Reconcile (worktree → DB) ----------------------------------------------------------------

  /**
   * Bring the DB's members for this collection into line with the merged worktree: upsert every
   * `tests/*.json` + `suites/*.json` by `external_key`, and DETACH (never destroy) local members whose
   * file was removed by the merge. Remote files are zod-validated FIRST (a malformed file fails the
   * whole reconcile, naming the file, with the DB untouched); the writes then run in one transaction.
   */
  private reconcileDbFromWorktree(
    clonePath: string,
    repoSubpath: string,
    collectionId: string,
  ): void {
    const root = repoRoot(clonePath, repoSubpath);
    const testFiles = readValidatedFiles(path.join(root, "tests"), (raw, name) =>
      parseTestFile(raw, name),
    );
    const suiteFiles = readValidatedFiles(path.join(root, "suites"), (raw, name) =>
      parseSuiteFile(raw, name),
    );

    const apply = this.db.transaction(() => {
      // Tests first (suites resolve their members against the reconciled test set).
      const testKeys = new Set<string>();
      for (const file of testFiles) {
        this.upsertTest(collectionId, file);
        testKeys.add(file.externalKey);
      }
      for (const row of this.memberTestRows(collectionId)) {
        if (row.external_key && !testKeys.has(row.external_key)) this.detachTest(row.id);
      }

      const idByKey = this.testIdByExternalKey(collectionId);
      const suiteKeys = new Set<string>();
      for (const file of suiteFiles) {
        this.upsertSuite(collectionId, file, idByKey);
        suiteKeys.add(file.externalKey);
      }
      for (const row of this.memberSuiteRows(collectionId)) {
        if (row.external_key && !suiteKeys.has(row.external_key)) this.detachSuite(row.id);
      }
    });
    apply();
  }

  private upsertTest(collectionId: string, file: TestFile): void {
    const existing = this.db
      .prepare("SELECT id FROM tests WHERE collection_id = ? AND external_key = ?")
      .get(collectionId, file.externalKey) as { id: string } | undefined;
    const input = fileToTestInput(file);
    if (existing) {
      this.tests.update(existing.id, input);
    } else {
      const created = this.tests.create(input);
      this.db
        .prepare("UPDATE tests SET collection_id = ?, external_key = ? WHERE id = ?")
        .run(collectionId, file.externalKey, created.id);
    }
  }

  private upsertSuite(collectionId: string, file: SuiteFile, idByKey: Map<string, string>): void {
    const existing = this.db
      .prepare("SELECT id FROM suites WHERE collection_id = ? AND external_key = ?")
      .get(collectionId, file.externalKey) as { id: string } | undefined;
    const input = fileToSuiteInput(file, idByKey);
    if (existing) {
      this.suites.update(existing.id, input);
    } else {
      const created = this.suites.create(input);
      this.db
        .prepare("UPDATE suites SET collection_id = ?, external_key = ? WHERE id = ?")
        .run(collectionId, file.externalKey, created.id);
    }
  }

  private detachTest(id: string): void {
    this.db
      .prepare("UPDATE tests SET collection_id = NULL, external_key = NULL WHERE id = ?")
      .run(id);
  }

  private detachSuite(id: string): void {
    this.db
      .prepare("UPDATE suites SET collection_id = NULL, external_key = NULL WHERE id = ?")
      .run(id);
  }

  // --- Member queries ---------------------------------------------------------------------------

  private memberTestRows(collectionId: string): MemberRow[] {
    return this.db
      .prepare(
        "SELECT id, external_key FROM tests WHERE collection_id = ? AND external_key IS NOT NULL ORDER BY external_key ASC",
      )
      .all(collectionId) as MemberRow[];
  }

  private memberSuiteRows(collectionId: string): MemberRow[] {
    return this.db
      .prepare(
        "SELECT id, external_key FROM suites WHERE collection_id = ? AND external_key IS NOT NULL ORDER BY external_key ASC",
      )
      .all(collectionId) as MemberRow[];
  }

  private testIdByExternalKey(collectionId: string): Map<string, string> {
    const rows = this.db
      .prepare(
        "SELECT id, external_key FROM tests WHERE collection_id = ? AND external_key IS NOT NULL",
      )
      .all(collectionId) as MemberRow[];
    const map = new Map<string, string>();
    for (const row of rows) if (row.external_key) map.set(row.external_key, row.id);
    return map;
  }

  /** Ordered `external_key`s of a suite's member tests (skipping any local-only member). */
  private suiteMemberExternalKeys(suite: Suite): string[] {
    const keys: string[] = [];
    for (const testId of suite.testIds) {
      const row = this.db.prepare("SELECT external_key FROM tests WHERE id = ?").get(testId) as
        | { external_key: string | null }
        | undefined;
      if (row?.external_key) keys.push(row.external_key);
    }
    return keys;
  }

  private updateLastSyncedSha(collectionId: string, sha: string): void {
    this.db
      .prepare("UPDATE collections SET last_synced_sha = ?, updated_at = ? WHERE id = ?")
      .run(sha, new Date().toISOString(), collectionId);
  }

  // --- Git plumbing -----------------------------------------------------------------------------

  private async commitIfDirty(clonePath: string): Promise<boolean> {
    await this.git(clonePath, ["add", "-A"]);
    const { stdout } = await this.git(clonePath, ["status", "--porcelain"]);
    const changed = stdout.split("\n").filter((line) => line.trim().length > 0);
    if (changed.length === 0) return false;
    await this.git(
      clonePath,
      ["commit", "-q", "-m", `sync: ${changed.length} changed`],
      committerEnv(),
    );
    return true;
  }

  private async fetch(
    clonePath: string,
    cleanUrl: string,
    branch: string,
    token: string | undefined,
  ): Promise<void> {
    await assertHostAllowed(cleanUrl, this.lookup);
    const authUrl = withToken(cleanUrl, token);
    try {
      await this.git(clonePath, [
        "fetch",
        "--no-tags",
        authUrl,
        `+refs/heads/${branch}:refs/remotes/origin/${branch}`,
      ]);
    } catch (err) {
      // An empty remote (branch doesn't exist yet) → not an error: origin/<branch> simply stays absent.
      if (isMissingRemoteRef(err)) return;
      throw gitError("fetch", cleanUrl, err);
    }
  }

  /** `git merge --no-edit <ref>` (ff or 3-way). Returns the conflict list (empty on a clean merge). */
  private async merge(clonePath: string, remoteRef: string): Promise<SyncConflict[]> {
    try {
      await this.git(clonePath, ["merge", "--no-edit", remoteRef], committerEnv());
      return [];
    } catch (err) {
      const conflicts = await this.parseConflicts(clonePath);
      if (conflicts.length > 0) return conflicts; // real conflict — leave the merge in progress
      // Not a conflict → a genuine merge failure. Abort to leave the clone clean, then surface it.
      await this.git(clonePath, ["merge", "--abort"]).catch(() => undefined);
      throw httpError(502, `git merge failed: ${redactUrl(errText(err)).slice(0, 500)}`);
    }
  }

  private async push(
    clonePath: string,
    cleanUrl: string,
    branch: string,
    token: string | undefined,
  ): Promise<void> {
    await assertHostAllowed(cleanUrl, this.lookup);
    const authUrl = withToken(cleanUrl, token);
    try {
      // No `--force`, ever. A non-fast-forward is rejected by git and surfaced as a 409.
      await this.git(clonePath, ["push", authUrl, `${branch}:refs/heads/${branch}`]);
    } catch (err) {
      throw pushError(cleanUrl, err);
    }
  }

  // --- Conflict / state introspection -----------------------------------------------------------

  private mergeInProgress(clonePath: string): boolean {
    return fs.existsSync(path.join(clonePath, ".git", "MERGE_HEAD"));
  }

  /** Parse `git status --porcelain` unmerged paths into {@link SyncConflict}s (both parsed sides). */
  private async parseConflicts(clonePath: string): Promise<SyncConflict[]> {
    const { stdout } = await this.git(clonePath, ["status", "--porcelain"]);
    const conflicts: SyncConflict[] = [];
    for (const line of stdout.split("\n")) {
      const code = line.slice(0, 2);
      if (!isUnmergedCode(code)) continue;
      const filePath = line.slice(3).trim();
      if (!filePath) continue;
      conflicts.push({
        path: filePath,
        local: (await this.stageContent(clonePath, 2, filePath)) ?? "",
        remote: (await this.stageContent(clonePath, 3, filePath)) ?? "",
      });
    }
    return conflicts;
  }

  private async stageContent(
    clonePath: string,
    stage: number,
    filePath: string,
  ): Promise<string | undefined> {
    try {
      const { stdout } = await this.git(clonePath, ["show", `:${stage}:${filePath}`]);
      return stdout;
    } catch {
      return undefined; // stage absent (this side deleted the file)
    }
  }

  private async buildState(
    clonePath: string,
    branch: string,
    conflicts: SyncConflict[],
  ): Promise<CollectionSyncState> {
    const remoteRef = `refs/remotes/origin/${branch}`;
    const remoteExists = await this.refExists(clonePath, remoteRef);
    const ahead = remoteExists
      ? await this.aheadBehind(clonePath, branch, remoteRef, "ahead")
      : await this.commitCount(clonePath, branch);
    const behind = remoteExists
      ? await this.aheadBehind(clonePath, branch, remoteRef, "behind")
      : 0;
    const { stdout } = await this.git(clonePath, ["status", "--porcelain"]);
    return { ahead, behind, dirty: stdout.trim().length > 0, conflicts };
  }

  private async aheadBehind(
    clonePath: string,
    branch: string,
    remoteRef: string,
    which: "ahead" | "behind",
  ): Promise<number> {
    const range = which === "ahead" ? `${remoteRef}..${branch}` : `${branch}..${remoteRef}`;
    try {
      const { stdout } = await this.git(clonePath, ["rev-list", "--count", range]);
      return Number(stdout.trim()) || 0;
    } catch {
      return 0; // one side unborn/absent
    }
  }

  private async commitCount(clonePath: string, branch: string): Promise<number> {
    try {
      const { stdout } = await this.git(clonePath, ["rev-list", "--count", branch]);
      return Number(stdout.trim()) || 0;
    } catch {
      return 0; // unborn branch
    }
  }

  private async refExists(clonePath: string, ref: string): Promise<boolean> {
    try {
      await this.git(clonePath, ["rev-parse", "--verify", "--quiet", ref]);
      return true;
    } catch {
      return false;
    }
  }

  private async headSha(clonePath: string): Promise<string | undefined> {
    try {
      const { stdout } = await this.git(clonePath, ["rev-parse", "HEAD"]);
      return stdout.trim();
    } catch {
      return undefined; // unborn (empty remote + no local commits)
    }
  }

  private git(
    cwd: string,
    args: string[],
    env?: NodeJS.ProcessEnv,
  ): Promise<{ stdout: string; stderr: string }> {
    return runGit(args, cwd, { timeoutMs: this.gitTimeoutMs, env });
  }

  private result(
    status: CollectionSyncResult["status"],
    state: CollectionSyncState,
  ): CollectionSyncResult {
    return { status, state };
  }
}

// --- Types --------------------------------------------------------------------------------------

/** One conflicted-file resolution (validated by the route). */
export type ConflictResolution = {
  path: string;
  resolution: "take-local" | "take-remote" | "edited";
  content?: string;
};

type MemberRow = { id: string; external_key: string | null };

// --- Pure helpers -------------------------------------------------------------------------------

/**
 * Testing IA (WP 2.1, D-T4) — narrow a (possibly LOCAL/unbound) collection to its git binding, or fail
 * with an honest 400 carrying the shared {@link REPO_NOT_BOUND_CODE}. An unbound collection has all
 * three repo fields NULL and nothing to sync — every sync/status/resolve entry point calls this so we
 * NEVER fake a sync success on a local collection. `repoPath` may legitimately be "" (the repo root),
 * so binding presence is tested by `!= null`, NOT truthiness.
 */
function requireBinding(collection: Collection): {
  repoUrl: string;
  repoPath: string;
  branch: string;
} {
  if (collection.repoUrl == null || collection.repoPath == null || collection.branch == null) {
    throw httpError(
      400,
      `Collection "${collection.name}" is not bound to a git repository.`,
      REPO_NOT_BOUND_CODE,
    );
  }
  return { repoUrl: collection.repoUrl, repoPath: collection.repoPath, branch: collection.branch };
}

/** The neutral author/committer for sync commits — never a real identity, stamped via env only. */
function committerEnv(): NodeJS.ProcessEnv {
  const name = "mcp-token-footprint";
  const email = "local@benchmarks";
  return {
    GIT_AUTHOR_NAME: name,
    GIT_AUTHOR_EMAIL: email,
    GIT_COMMITTER_NAME: name,
    GIT_COMMITTER_EMAIL: email,
  };
}

/** The `<clonePath>/<repoPath>` root the member files live under (repoPath '' → the clone root). */
function repoRoot(clonePath: string, repoSubpath: string): string {
  const trimmed = repoSubpath.trim().replace(/^[/\\]+|[/\\]+$/g, "");
  return trimmed ? path.join(clonePath, ...trimmed.split("/")) : clonePath;
}

/** Map every `<dir>/*.json` file to its parsed `externalKey` (unparseable files skipped). */
function indexFilesByExternalKey(dir: string): Map<string, string> {
  const map = new Map<string, string>();
  if (!fs.existsSync(dir)) return map;
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith(".json")) continue;
    const abs = path.join(dir, name);
    try {
      const parsed = JSON.parse(fs.readFileSync(abs, "utf8")) as { externalKey?: unknown };
      if (typeof parsed.externalKey === "string") map.set(parsed.externalKey, abs);
    } catch {
      // unparseable — leave it for reconcile to reject if it's a member file
    }
  }
  return map;
}

/** Read + validate every `<dir>/*.json` file. A malformed/invalid file throws (naming the file). */
function readValidatedFiles<T>(dir: string, parse: (raw: unknown, name: string) => T): T[] {
  if (!fs.existsSync(dir)) return [];
  const files: T[] = [];
  for (const name of fs.readdirSync(dir).sort()) {
    if (!name.endsWith(".json")) continue;
    const abs = path.join(dir, name);
    let raw: unknown;
    try {
      raw = JSON.parse(fs.readFileSync(abs, "utf8"));
    } catch (err) {
      throw httpError(422, `Invalid JSON in remote file "${name}": ${errText(err).slice(0, 200)}`);
    }
    files.push(parse(raw, name));
  }
  return files;
}

function parseTestFile(raw: unknown, name: string): TestFile {
  const result = testFileSchema.safeParse(raw);
  if (!result.success) {
    throw httpError(
      422,
      `Invalid test file "${name}": ${result.error.issues[0]?.message ?? "schema mismatch"}`,
    );
  }
  return result.data as TestFile;
}

function parseSuiteFile(raw: unknown, name: string): SuiteFile {
  const result = suiteFileSchema.safeParse(raw);
  if (!result.success) {
    throw httpError(
      422,
      `Invalid suite file "${name}": ${result.error.issues[0]?.message ?? "schema mismatch"}`,
    );
  }
  return result.data as SuiteFile;
}

/** A porcelain status code marks an unmerged (conflicted) path (see `git status` docs). */
function isUnmergedCode(code: string): boolean {
  return (
    code === "DD" ||
    code === "AU" ||
    code === "UD" ||
    code === "UA" ||
    code === "DU" ||
    code === "AA" ||
    code === "UU"
  );
}

function kebab(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "item";
}

/** `<base>.json`, disambiguated to `<base>-2.json`, `-3`… on a name collision within the batch. */
function uniqueFileName(base: string, used: Set<string>): string {
  let candidate = `${base}.json`;
  let n = 2;
  while (used.has(candidate)) {
    candidate = `${base}-${n}.json`;
    n += 1;
  }
  used.add(candidate);
  return candidate;
}

function isMissingRemoteRef(err: unknown): boolean {
  const text = errText(err).toLowerCase();
  return text.includes("couldn't find remote ref") || text.includes("couldn't find remote refs");
}

/** Map a clone/fetch failure: auth → 401; else 502. ALWAYS redacted (the auth url may be in the message). */
function gitError(op: string, cleanUrl: string, err: unknown): Error {
  const stderr = redactUrl(errText(err));
  if (looksLikeAuthFailure(stderr)) {
    return httpError(401, `Authentication required for ${redactUrl(cleanUrl)}.`);
  }
  return httpError(502, `git ${op} failed for ${redactUrl(cleanUrl)}: ${stderr.slice(0, 500)}`);
}

/** Map a push failure: auth → 401; non-fast-forward → 409 (we do NOT force); else 502. Always redacted. */
function pushError(cleanUrl: string, err: unknown): Error {
  const stderr = redactUrl(errText(err));
  if (looksLikeAuthFailure(stderr)) {
    return httpError(401, `Authentication required to push to ${redactUrl(cleanUrl)}.`);
  }
  const lower = stderr.toLowerCase();
  if (
    lower.includes("non-fast-forward") ||
    lower.includes("fetch first") ||
    lower.includes("rejected")
  ) {
    return httpError(
      409,
      "The remote moved ahead; re-sync to merge before pushing (no force-push).",
    );
  }
  return httpError(502, `git push failed for ${redactUrl(cleanUrl)}: ${stderr.slice(0, 500)}`);
}
