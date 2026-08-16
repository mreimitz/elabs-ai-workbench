import { diffLines } from "diff";
import type {
  SkillDiff,
  SkillDiffEntry,
  SkillFileContent,
  SkillManifest,
} from "@mcp-token-footprint/shared";
import type { SkillDiffFile, SkillRepository } from "./repository.js";
import { httpError } from "../utils/errors.js";

/** Both file contents for one path across two versions — feeds the client-side Monaco DiffEditor. */
export type SkillFileDiff = {
  path: string;
  from: SkillFileContent;
  to: SkillFileContent;
};

/** The manifest fields we surface in the field-level diff (research/skill-registry/04). */
const MANIFEST_FIELDS = [
  "name",
  "description",
  "license",
  "compatibility",
  "allowedTools",
  "metadata",
] as const;

/**
 * The full-tree "what-changed" diff between two immutable versions (research/skill-registry/04).
 *
 * Computed on demand from two `skill_files` maps — never stored. Works identically for uploaded and
 * GitHub skills because both are just content-addressed file maps by diff time.
 */
export class SkillDiffService {
  constructor(private readonly repo: SkillRepository) {}

  /**
   * Classify every path as added/removed/modified/unchanged from the two versions' blob-sha maps,
   * lift renames (identical blob at a moved path) out of added+removed, attach per-entry token
   * deltas, and roll up file counts + per-level token deltas + a manifest field diff.
   */
  diffVersions(fromId: string, toId: string): SkillDiff {
    const fromVersion = this.repo.getVersion(fromId); // 404 if missing
    const toVersion = this.repo.getVersion(toId); // 404 if missing
    const fromMap = this.repo.getDiffFileMap(fromId);
    const toMap = this.repo.getDiffFileMap(toId);

    const entries: SkillDiffEntry[] = [];
    const rollup = {
      filesAdded: 0,
      filesRemoved: 0,
      filesModified: 0,
      filesRenamed: 0,
      bytesDelta: toVersion.totalBytes - fromVersion.totalBytes,
      l1Delta: toVersion.l1MetadataTokens - fromVersion.l1MetadataTokens,
      l2Delta: toVersion.l2BodyTokens - fromVersion.l2BodyTokens,
      l3Delta: toVersion.l3ResourceTokens - fromVersion.l3ResourceTokens,
      totalDelta: toVersion.totalTokens - fromVersion.totalTokens,
    };

    // Candidate added/removed paths — renames get pulled out of these below.
    const addedPaths = new Set<string>();
    const removedPaths = new Set<string>();

    for (const [path, to] of toMap) {
      const from = fromMap.get(path);
      if (!from) {
        addedPaths.add(path);
      } else if (from.blobSha !== to.blobSha) {
        entries.push(this.modifiedEntry(path, from, to));
        rollup.filesModified += 1;
      } else {
        entries.push(unchangedEntry(path, from, to));
      }
    }
    for (const path of fromMap.keys()) {
      if (!toMap.has(path)) removedPaths.add(path);
    }

    // Rename detection: an added path and a removed path sharing a blob_sha are the same content
    // moved. Index removals by blob_sha (first-wins per sha) so each removal is consumed once.
    const removedByBlob = new Map<string, string>();
    for (const path of removedPaths) {
      const sha = fromMap.get(path)?.blobSha;
      if (sha && !removedByBlob.has(sha)) removedByBlob.set(sha, path);
    }

    for (const path of addedPaths) {
      const to = toMap.get(path);
      if (!to) continue;
      const fromPath = removedByBlob.get(to.blobSha);
      if (fromPath && removedPaths.has(fromPath)) {
        const from = fromMap.get(fromPath);
        entries.push({
          status: "renamed",
          path,
          fromPath,
          kind: to.kind,
          fromTokens: from?.tokens,
          toTokens: to.tokens,
          tokenDelta: to.tokens - (from?.tokens ?? 0),
          binary: to.binary,
        });
        rollup.filesRenamed += 1;
        removedPaths.delete(fromPath);
        removedByBlob.delete(to.blobSha);
      } else {
        entries.push({
          status: "added",
          path,
          kind: to.kind,
          toTokens: to.tokens,
          tokenDelta: to.tokens,
          binary: to.binary,
        });
        rollup.filesAdded += 1;
      }
    }

    // Whatever survived rename detection is a genuine removal.
    for (const path of removedPaths) {
      const from = fromMap.get(path);
      if (!from) continue;
      entries.push({
        status: "removed",
        path,
        kind: from.kind,
        fromTokens: from.tokens,
        tokenDelta: -from.tokens,
        binary: from.binary,
      });
      rollup.filesRemoved += 1;
    }

    entries.sort((a, b) => a.path.localeCompare(b.path));

    return {
      skillId: toVersion.skillId,
      fromVersionId: fromId,
      toVersionId: toId,
      entries,
      rollup,
      manifestDiff: manifestDiff(fromVersion.manifest, toVersion.manifest),
    };
  }

  /**
   * Both file contents for one path across the two versions (feeds the client Monaco DiffEditor).
   * An **added** file is absent from `from` and a **removed** file is absent from `to`; for the side
   * that lacks the path we return an empty text content (the client renders those single-pane) rather
   * than 404-ing. Only a path present in *neither* version is a genuine 404.
   */
  fileDiff(fromId: string, toId: string, path: string): SkillFileDiff {
    const inFrom = this.repo.getDiffFileMap(fromId).has(path);
    const inTo = this.repo.getDiffFileMap(toId).has(path);
    if (!inFrom && !inTo) throw httpError(404, "Skill file not found");
    return {
      path,
      from: inFrom ? this.repo.getFileContent(fromId, path) : emptyFileContent(path),
      to: inTo ? this.repo.getFileContent(toId, path) : emptyFileContent(path),
    };
  }

  /**
   * A modified entry. A modified file is `binary` when either side is binary → `binary:true`, no
   * line diff (per WP 1.5). Text files carry the change; the `+adds/−dels` line counts for the
   * badge are computed on demand from `fileDiff` + `lineDelta` (the visual diff is client-side).
   */
  private modifiedEntry(path: string, from: SkillDiffFile, to: SkillDiffFile): SkillDiffEntry {
    return {
      status: "modified",
      path,
      kind: to.kind,
      fromTokens: from.tokens,
      toTokens: to.tokens,
      tokenDelta: to.tokens - from.tokens,
      binary: from.binary || to.binary,
    };
  }
}

/** The empty side of an added/removed file's diff — the client renders those single-pane. */
function emptyFileContent(path: string): SkillFileContent {
  return { path, isBinary: false, text: "", tokenTotal: 0 };
}

function unchangedEntry(path: string, from: SkillDiffFile, to: SkillDiffFile): SkillDiffEntry {
  return {
    status: "unchanged",
    path,
    kind: to.kind,
    fromTokens: from.tokens,
    toTokens: to.tokens,
    tokenDelta: to.tokens - from.tokens,
    binary: to.binary,
  };
}

/** Count added/removed lines between two texts (jsdiff) — the `+adds/−dels` badge inputs. */
export function lineDelta(oldText: string, newText: string): { adds: number; dels: number } {
  let adds = 0;
  let dels = 0;
  for (const change of diffLines(oldText, newText)) {
    if (change.added) adds += change.count ?? 0;
    else if (change.removed) dels += change.count ?? 0;
  }
  return { adds, dels };
}

/** Field-by-field manifest diff → `{ field, from, to }[]` for the changed frontmatter fields. */
export function manifestDiff(from: SkillManifest, to: SkillManifest): SkillDiff["manifestDiff"] {
  const diff: SkillDiff["manifestDiff"] = [];
  for (const field of MANIFEST_FIELDS) {
    const before = normalizeField(from[field]);
    const after = normalizeField(to[field]);
    if (before !== after) {
      diff.push({
        field,
        from: before === undefined ? undefined : before,
        to: after === undefined ? undefined : after,
      });
    }
  }
  return diff;
}

/** Normalize a manifest field to a comparable string; `metadata` (object) → stable JSON. */
function normalizeField(value: string | Record<string, string> | undefined): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "string") return value;
  const keys = Object.keys(value).sort();
  return JSON.stringify(Object.fromEntries(keys.map((k) => [k, value[k]])));
}
