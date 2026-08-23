// Assembles data-pack/manifest.json. Deterministic by construction: the file list is discovered by
// walking a fixed set of directories and sorted by path, `asOf` is derived from the newest `as_of`
// in the pack's own sources (never the wall clock), and `packVersion` comes from
// data-pack/package.json. The drift test rebuilds this in memory and byte-compares, so any
// non-determinism here fails the gate rather than producing a manifest nobody can reproduce.

import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

/**
 * The directories whose JSON files make up the pack, in manifest order. `build/` is deliberately
 * absent — the generator is code, not pack content — and so are package.json / tsconfig.json.
 */
export const PACK_CONTENT_DIRS = [
  "compatibility",
  "generated",
  "limits",
  "models/open-weight",
  "models/saas",
  "schema",
  "security",
] as const;

export type ManifestFileEntry = { path: string; sha256: string; bytes: number };

export type PackManifest = {
  packVersion: string;
  schemaVersion: number;
  asOf: string;
  generator: string;
  files: ManifestFileEntry[];
};

export function sha256Hex(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Every pack-content file, as pack-root-relative POSIX paths, sorted. */
export function listPackContentFiles(packRoot: string): string[] {
  const out: string[] = [];
  for (const dir of PACK_CONTENT_DIRS) {
    const abs = path.join(packRoot, dir);
    let entries: string[];
    try {
      entries = readdirSync(abs);
    } catch {
      continue; // A pack-content dir may legitimately not exist yet during a first build.
    }
    for (const name of entries) {
      if (!name.endsWith(".json")) continue;
      out.push(`${dir}/${name}`);
    }
  }
  return out.sort();
}

/** Digest every pack-content file on disk, keyed by pack-root-relative POSIX path. */
export function digestPackContents(packRoot: string): Map<string, { sha256: string; bytes: number }> {
  const map = new Map<string, { sha256: string; bytes: number }>();
  for (const rel of listPackContentFiles(packRoot)) {
    const bytes = readFileSync(path.join(packRoot, rel));
    map.set(rel, { sha256: sha256Hex(bytes), bytes: bytes.byteLength });
  }
  return map;
}

/** `YYYY-MM-DD` string max — the pack is only as current as its stalest input is new. */
export function newestAsOf(values: readonly string[]): string {
  let newest = "";
  for (const v of values) if (v > newest) newest = v;
  return newest;
}

export function buildManifest(args: {
  packRoot: string;
  packVersion: string;
  schemaVersion: number;
  asOf: string;
  generator: string;
}): PackManifest {
  const files: ManifestFileEntry[] = [];
  for (const [rel, digest] of digestPackContents(args.packRoot)) {
    files.push({ path: rel, sha256: digest.sha256, bytes: digest.bytes });
  }
  files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return {
    packVersion: args.packVersion,
    schemaVersion: args.schemaVersion,
    asOf: args.asOf,
    generator: args.generator,
    files,
  };
}

/** Stable serialization for the committed manifest (2-space indent, trailing newline). */
export function serializeManifest(manifest: PackManifest): string {
  return JSON.stringify(manifest, null, 2) + "\n";
}
