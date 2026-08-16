import {
  SKILL_MAX_FILES,
  SKILL_MAX_FILE_BYTES,
  SKILL_MAX_TOTAL_BYTES,
} from "@mcp-token-footprint/shared";
import { httpError } from "../utils/errors.js";

/**
 * Runtime ingest caps (the zip-bomb / oversized-tree guard). The same limits apply to EVERY
 * ingestion path — uploads AND GitHub checkouts — so a large tree can never enter the DB through a
 * back door. Defaults come from the shared constants; `resolveIngestCaps` lets `config/env.ts`
 * override them from the environment.
 */
export type IngestCaps = {
  maxFiles: number;
  maxFileBytes: number;
  maxTotalBytes: number;
};

export const DEFAULT_INGEST_CAPS: IngestCaps = {
  maxFiles: SKILL_MAX_FILES,
  maxFileBytes: SKILL_MAX_FILE_BYTES,
  maxTotalBytes: SKILL_MAX_TOTAL_BYTES,
};

/** A per-file cap breach (5 MB per file by default) → clear 400. */
export function assertFileCap(bytes: number, caps: IngestCaps): void {
  if (bytes > caps.maxFileBytes) {
    throw httpError(
      400,
      `A file exceeds the ${caps.maxFileBytes}-byte per-file limit (zip-bomb guard).`,
    );
  }
}

/** A whole-tree total-size cap breach (50 MB by default) → clear 400. */
export function assertTotalCap(totalBytes: number, caps: IngestCaps): void {
  if (totalBytes > caps.maxTotalBytes) {
    throw httpError(
      400,
      `The upload exceeds the ${caps.maxTotalBytes}-byte total-size limit (zip-bomb guard).`,
    );
  }
}

/** A file-count cap breach (2000 files by default) → clear 400. */
export function assertFileCountCap(fileCount: number, caps: IngestCaps): void {
  if (fileCount > caps.maxFiles) {
    throw httpError(400, `The upload has more than ${caps.maxFiles} files (zip-bomb guard).`);
  }
}

/**
 * Enforce every cap over an already-materialized tree of `{ byteLength }` files. Used by the GitHub
 * checkout path (the upload path enforces the same caps incrementally while it unzips). Throws the
 * first breach it finds — no partial state can leak past this because callers persist only after it
 * returns cleanly.
 */
export function assertTreeWithinCaps(
  files: ReadonlyArray<{ byteLength: number }>,
  caps: IngestCaps,
): void {
  assertFileCountCap(files.length, caps);
  let total = 0;
  for (const file of files) {
    assertFileCap(file.byteLength, caps);
    total += file.byteLength;
  }
  assertTotalCap(total, caps);
}
