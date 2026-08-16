import fs from "node:fs";
import path from "node:path";
import { nanoid } from "nanoid";
import { Unzip, UnzipInflate, UnzipPassThrough, zipSync, type Zippable } from "fflate";
import { type TokenProfileId } from "@mcp-token-footprint/shared";
import { countLevels, type SkillFootprintFile } from "./footprint.js";
import { parseSkillManifest } from "./manifest.js";
import {
  DEFAULT_INGEST_CAPS,
  assertFileCap,
  assertFileCountCap,
  assertTotalCap,
  type IngestCaps,
} from "./caps.js";
import type {
  CreateVersionFootprint,
  CreateVersionMeta,
  CreateVersionResult,
  SkillFileInput,
  SkillRepository,
} from "./repository.js";
import { isBinary } from "./repository.js";
import { httpError } from "../utils/errors.js";

export { DEFAULT_INGEST_CAPS, type IngestCaps } from "./caps.js";

/** A file located inside an upload, rebased to the skill root. */
type StagedFile = { path: string; bytes: Buffer };

export type IngestServiceOptions = {
  dataDir: string;
  tokenProfile?: TokenProfileId;
  caps?: IngestCaps;
};

/**
 * Turns an uploaded `.zip` (or lone `SKILL.md`) into a stored skill version. Only the API touches
 * the filesystem here — the buffer is spooled to `DATA_DIR/tmp/<nanoid>/` (cleaned in `finally`) and
 * unzipped in-memory with `fflate`, enforcing the zip-bomb caps while iterating.
 */
export class SkillIngestService {
  private readonly caps: IngestCaps;

  constructor(
    private readonly repo: SkillRepository,
    private readonly options: IngestServiceOptions,
  ) {
    this.caps = options.caps ?? DEFAULT_INGEST_CAPS;
  }

  /**
   * Parse + validate an upload, then persist it as a new version of `skillId`. Returns the repo's
   * `CreateVersionResult` (`{ unchanged: true }` when the tree matches the current version).
   */
  async ingestUpload(
    skillId: string,
    buffer: Buffer,
    filename: string,
  ): Promise<CreateVersionResult> {
    const tmpDir = path.join(this.options.dataDir, "tmp", nanoid());
    try {
      // Spool to the temp dir (runtime boundary / convention) then work from the in-memory buffer.
      fs.mkdirSync(tmpDir, { recursive: true });
      fs.writeFileSync(path.join(tmpDir, sanitizeFilename(filename)), buffer);

      const staged = this.stage(buffer, filename);
      const meta = await this.buildVersionMeta(staged);
      const files: SkillFileInput[] = staged.map((f) => ({ path: f.path, bytes: f.bytes }));
      return this.repo.createVersion(skillId, files, meta);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }

  /** Rebuild a `.zip` of the version's exact tree from its stored blobs. */
  exportVersionZip(versionId: string): Buffer {
    const files = this.repo.getVersionFiles(versionId);
    const zippable: Zippable = {};
    for (const file of files) {
      zippable[file.path] = new Uint8Array(file.bytes);
    }
    return Buffer.from(zipSync(zippable));
  }

  // --- Internals --------------------------------------------------------------------------------

  /** Unpack the upload into a rebased-to-root list of files, enforcing the caps as we go. */
  private stage(buffer: Buffer, filename: string): StagedFile[] {
    if (isZipFilename(filename) || looksLikeZip(buffer)) {
      return this.stageZip(buffer);
    }
    // A lone SKILL.md (or any single markdown file) → a one-file skill tree.
    assertFileCap(buffer.byteLength, this.caps);
    assertTotalCap(buffer.byteLength, this.caps);
    return [{ path: "SKILL.md", bytes: buffer }];
  }

  /**
   * STREAMING decompression (fflate `Unzip` + `UnzipInflate`/`UnzipPassThrough`). The compressed
   * buffer is fed in small chunks so each entry's inflater emits its output incrementally; we keep a
   * running uncompressed-byte total + file count and ABORT (throw the cap error) the moment any cap
   * is crossed — so a high-ratio zip bomb is rejected WITHOUT inflating the whole archive into
   * memory. Path traversal (`..` / absolute) is rejected as each entry header is read.
   */
  private stageZip(buffer: Buffer): StagedFile[] {
    const collected: StagedFile[] = [];
    let total = 0; // running uncompressed bytes across all kept entries (zip-bomb budget)
    let fileCount = 0;

    const unzip = new Unzip();
    unzip.register(UnzipInflate); // DEFLATE (method 8)
    unzip.register(UnzipPassThrough); // STORE (method 0)

    unzip.onfile = (file) => {
      // Reject dangerous entry paths up front (before any of the entry is inflated).
      assertSafeZipEntryPath(file.name);
      const normalized = normalizeZipPath(file.name);
      const skip = !normalized || file.name.endsWith("/") || isIgnoredPath(normalized);

      let fileBytes = 0;
      // Collect bytes only for a KEPT entry; `null` for an ignored one (`.git/…`, `__MACOSX/…`, dirs).
      const chunks: Buffer[] | null = skip ? null : [];
      file.ondata = (err, chunk, final) => {
        if (err) throw httpError(400, `Could not read the uploaded archive: ${err.message}`);
        if (chunk && chunk.byteLength > 0) {
          // F2 — meter EVERY decompressed chunk against the caps, even for an IGNORED entry. `fflate`
          // still inflates ignored paths through `file.start()`, so counting only kept entries let a
          // zip bomb hidden in `.git/huge` / `__MACOSX/huge` blow past the total cap uncounted. We now
          // accumulate + assert on every chunk and only PUSH into `chunks` when the entry is kept.
          fileBytes += chunk.byteLength;
          total += chunk.byteLength;
          // Enforce the caps on the running totals — abort mid-inflation on the first breach.
          assertFileCap(fileBytes, this.caps);
          assertTotalCap(total, this.caps);
          if (chunks) chunks.push(Buffer.from(chunk));
        }
        if (final && chunks) {
          collected.push({ path: normalized, bytes: Buffer.concat(chunks) });
        }
      };

      if (!skip) {
        fileCount += 1;
        assertFileCountCap(fileCount, this.caps);
      }
      file.start();
    };

    try {
      // Small push chunks keep each inflater emitting incrementally, so a bomb is caught after only
      // a bounded amount of decompressed data — never the whole archive.
      const pushChunk = 8 * 1024;
      for (let offset = 0; offset < buffer.length; offset += pushChunk) {
        const end = Math.min(offset + pushChunk, buffer.length);
        unzip.push(buffer.subarray(offset, end), end >= buffer.length);
      }
    } catch (err) {
      // Cap breaches + path-traversal rejects already carry a statusCode — surface them verbatim.
      if (typeof (err as { statusCode?: number }).statusCode === "number") throw err;
      throw httpError(400, `Could not read the uploaded archive: ${(err as Error).message}`);
    }

    if (collected.length === 0) {
      throw httpError(400, "Archive is empty.");
    }

    return this.rebaseToSkillRoot(collected);
  }

  /** Locate the single dir containing `SKILL.md` (root or nested one level) and rebase paths. */
  private rebaseToSkillRoot(files: StagedFile[]): StagedFile[] {
    const skillMdDirs = files
      .filter((f) => path.posix.basename(f.path).toLowerCase() === "skill.md")
      .map((f) => path.posix.dirname(f.path))
      .map((dir) => (dir === "." ? "" : dir));

    if (skillMdDirs.length === 0) {
      throw httpError(400, "No SKILL.md found in the archive.");
    }

    const uniqueDirs = [...new Set(skillMdDirs)];
    if (uniqueDirs.length > 1) {
      throw httpError(
        400,
        `Archive contains ${uniqueDirs.length} skills — upload one skill per archive.`,
      );
    }

    const root = uniqueDirs[0] ?? "";
    // Only accept the skill root at the archive root or nested one level deep.
    if (root && root.includes("/")) {
      throw httpError(400, "SKILL.md must be at the archive root or nested one level deep.");
    }

    const prefix = root ? `${root}/` : "";
    const rebased: StagedFile[] = [];
    for (const file of files) {
      if (root) {
        if (!file.path.startsWith(prefix)) continue; // files outside the skill dir are dropped
        rebased.push({ path: file.path.slice(prefix.length), bytes: file.bytes });
      } else {
        rebased.push(file);
      }
    }

    if (!rebased.some((f) => f.path === "SKILL.md")) {
      // Reachable only if the SKILL.md sits under a case-variant name we normalized differently.
      throw httpError(400, "Could not locate SKILL.md at the skill root.");
    }

    return rebased;
  }

  /**
   * Parse the manifest + count tokens, producing the `createVersion` meta + backfilled footprint.
   */
  private async buildVersionMeta(files: StagedFile[]): Promise<CreateVersionMeta> {
    const skillMd = files.find((f) => f.path === "SKILL.md");
    if (!skillMd) throw httpError(400, "No SKILL.md found in the upload.");

    const parsed = parseSkillManifest(skillMd.bytes.toString("utf8"));

    const footprintFiles: SkillFootprintFile[] = files.map((file) => {
      const binary = isBinary(file.bytes);
      return {
        path: file.path,
        isBinary: binary,
        text: binary ? undefined : file.bytes.toString("utf8"),
      };
    });

    const tokenProfile = this.options.tokenProfile;
    const levels = await countLevels(footprintFiles, parsed.manifest, parsed.body, tokenProfile);

    const byPath = new Map<string, number>();
    for (const file of levels.files) byPath.set(file.path, file.tokenTotal);
    const footprint: CreateVersionFootprint = {
      l1: levels.l1,
      l2: levels.l2,
      l3: levels.l3,
      total: levels.total,
      byPath,
    };

    return {
      sourceKind: "upload",
      importedFrom: "upload",
      manifest: parsed.manifest,
      manifestValid: parsed.valid,
      manifestErrors: parsed.errors,
      tokenProfile: levels.tokenProfile,
      footprint,
    };
  }
}

function isZipFilename(filename: string): boolean {
  return filename.toLowerCase().endsWith(".zip");
}

/** PK\x03\x04 local-file-header magic — recognise a zip even with a misleading filename. */
function looksLikeZip(buffer: Buffer): boolean {
  return (
    buffer.length >= 4 &&
    buffer[0] === 0x50 &&
    buffer[1] === 0x4b &&
    buffer[2] === 0x03 &&
    buffer[3] === 0x04
  );
}

function sanitizeFilename(filename: string): string {
  const base = path.basename(filename).replace(/[^a-zA-Z0-9._-]/g, "_");
  return base || "upload.bin";
}

/** Normalize a zip entry path to a posix, root-relative form (drops leading `./` and `/`). */
function normalizeZipPath(rawPath: string): string {
  return rawPath.replace(/\\/g, "/").replace(/^\.\//, "").replace(/^\/+/, "").trim();
}

/**
 * Zip-slip guard: reject any entry that is absolute or contains a `..` traversal segment (e.g.
 * `../evil.md`, `a/../../b`). Thrown before the entry is inflated or stored.
 */
function assertSafeZipEntryPath(rawPath: string): void {
  const cleaned = rawPath.replace(/\\/g, "/").trim();
  if (cleaned.startsWith("/") || /^[a-zA-Z]:\//.test(cleaned)) {
    throw httpError(400, `Unsafe path in archive (absolute path): ${rawPath}`);
  }
  if (cleaned.split("/").some((segment) => segment === "..")) {
    throw httpError(400, `Unsafe path in archive (path traversal): ${rawPath}`);
  }
}

/** Archive cruft we never store (macOS metadata, VCS dirs, editor junk). */
function isIgnoredPath(normalized: string): boolean {
  const segments = normalized.split("/");
  if (segments.includes("__MACOSX")) return true;
  if (segments.includes(".git")) return true;
  const base = segments[segments.length - 1] ?? "";
  if (base === ".DS_Store") return true;
  if (base.startsWith("._")) return true;
  return false;
}
