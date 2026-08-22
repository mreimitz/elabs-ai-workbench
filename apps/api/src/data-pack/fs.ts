// The filesystem seam the pack loader reads through (RM-38 WP 1.2).
//
// It exists so `loadDataPack` is a pure function of (a directory listing, some bytes) and can be
// driven from an in-memory tree in tests — a refusal test that has to write a truncated
// `manifest.json` into the real repository is a test that can leave the repository broken.
//
// The seam is deliberately three methods wide. Anything more (globbing, stats, watching) would let
// the loader grow behaviour the in-memory double has to re-implement, and a double that has to
// re-implement behaviour is a second implementation.

import { existsSync, readdirSync, readFileSync } from "node:fs";

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
