// The filesystem seam the pack loader reads through (RM-38 WP 1.2).
//
// It exists so `loadDataPack` is a pure function of (a directory listing, some bytes) and can be
// driven from an in-memory tree in tests — a refusal test that has to write a truncated
// `manifest.json` into the real repository is a test that can leave the repository broken.
//
// The seam is deliberately three methods wide. Anything more (globbing, stats, watching) would let
// the loader grow behaviour the in-memory double has to re-implement, and a double that has to
// re-implement behaviour is a second implementation.

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";

export type DataPackDirEntry = { name: string; isDirectory: boolean };

export type DataPackFs = {
  exists(absPath: string): boolean;
  /** Throws if the file does not exist — callers check `exists` first where absence is meaningful. */
  readFile(absPath: string): Buffer;
  /** Throws if the directory does not exist — callers check `exists` first. */
  readDir(absPath: string): DataPackDirEntry[];
};

export const nodeDataPackFs: DataPackFs = {
  exists: (absPath) => existsSync(absPath),
  readFile: (absPath) => readFileSync(absPath),
  readDir: (absPath) =>
    readdirSync(absPath, { withFileTypes: true }).map((e) => ({
      name: e.name,
      isDirectory: e.isDirectory(),
    })),
};

// --- The WRITE seam (RM-38 WP 3.1) --------------------------------------------------------------
//
// Reading a pack and writing one are deliberately two seams, not one widened seam. Almost every
// consumer in `apps/api` only ever reads; the fetcher is the sole writer, and keeping the write
// verbs off `DataPackFs` means a module that takes a `DataPackFs` provably cannot create, replace or
// delete a directory under `DATA_DIR`.
//
// The verbs are chosen so the atomic swap is expressible and nothing more is. In particular there is
// no `copy` and no `walk`: a swap is `rename`, and a rename that has to fall back to a recursive
// copy is not a swap.

export type DataPackWriteFs = {
  /** Create `absDir` and every missing parent. Existing is not an error. */
  mkdirp(absDir: string): void;
  writeFile(absPath: string, bytes: Buffer): void;
  /** Recursive remove. A path that does not exist is NOT an error — this is the leftover sweep. */
  rmrf(absPath: string): void;
  /**
   * `rename(2)`. Throws on failure, deliberately: the swap's whole value is that it either moved the
   * directory or it did not, and a rename that quietly did nothing would be the one failure mode
   * that could publish a half-written pack.
   */
  rename(from: string, to: string): void;
};

export const nodeDataPackWriteFs: DataPackWriteFs = {
  mkdirp: (absDir) => {
    mkdirSync(absDir, { recursive: true });
  },
  writeFile: (absPath, bytes) => {
    writeFileSync(absPath, bytes);
  },
  rmrf: (absPath) => {
    rmSync(absPath, { recursive: true, force: true });
  },
  rename: (from, to) => {
    renameSync(from, to);
  },
};
