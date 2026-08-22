#!/usr/bin/env node
// ==================================================================================================
// Build `packages/shared` — at most once, never concurrently.
// ==================================================================================================
//
// WHY THIS EXISTS. Four packages (`apps/api`, `apps/web`, `apps/cli`, `packages/illustrations`) each
// need `packages/shared/dist` fresh before their tests run, and each used to open its `test` script
// with a bare `pnpm --filter @mcp-token-footprint/shared build`. `pnpm -r --if-present test` runs
// packages CONCURRENTLY, so that meant up to four `tsc` processes writing the SAME `dist/` directory
// while other packages' tests were already importing out of it.
//
// That was measured, not guessed (2026-08-22): during one `pnpm test` run, three concurrent `tsc`
// processes were observed and `packages/shared/dist/index.js` was rewritten TWICE — once at startup
// and again 33 seconds in, with api and web tests already executing. A module read while it is being
// rewritten is truncated or briefly absent, which is why the suite failed on a DIFFERENT file almost
// every run, always passed in isolation, and produced bare 5000 ms vitest timeouts and one 4-second
// perf outlier that no amount of CPU load could reproduce on its own.
//
// The earlier "packages/illustrations was reading a stale dist" incident is the same defect seen from
// the other side: the fix then was to add a fourth inline build, which removed the staleness and made
// the race worse. This script is the fix for both halves at once — the build happens, and it happens
// exactly once.
//
// HOW. Two guards, in order:
//   1. FRESHNESS — if every `dist` output is newer than every `src` input, there is nothing to do.
//   2. AN EXCLUSIVE LOCK — `mkdir` is atomic on every filesystem we run on. The winner builds; every
//      other caller WAITS for it to finish and then returns, rather than building a second time.
//      A caller never proceeds on the assumption that someone else's build will be done in time.
//
// A stale lock (a previous run killed mid-build) is reclaimed after LOCK_STALE_MS so a crash cannot
// wedge the repo. Deliberately dependency-free: this runs before anything is built.

import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SHARED = path.join(REPO_ROOT, "packages/shared");
const SRC = path.join(SHARED, "src");
const DIST = path.join(SHARED, "dist");
const LOCK = path.join(SHARED, ".build-lock");
// Written ONLY after a build exits 0, and holds the source fingerprint it was built from. Freshness
// is decided on this, not on dist's mtimes: a build that fails partway leaves NEW files in `dist`, so
// an mtime comparison alone would call a broken half-build "fresh" and hand it to the tests. That is
// the same class of defect this whole script exists to remove, so it is not left open here.
const STAMP = path.join(SHARED, ".build-stamp");

/** A build that has not finished within this is treated as dead, not as in-progress. */
const LOCK_STALE_MS = 5 * 60_000;
const POLL_MS = 100;

/** Newest mtime under `dir`, or 0 if it does not exist. `-1` means "exists but is empty". */
function newestMtime(dir) {
  if (!existsSync(dir)) return 0;
  let newest = -1;
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      newest = Math.max(newest, statSync(full).mtimeMs);
    }
  };
  walk(dir);
  return newest;
}

/** True when a SUCCESSFUL build recorded a fingerprint at or after the newest source change. */
function isFresh() {
  if (newestMtime(DIST) <= 0) return false;
  const src = newestMtime(SRC);
  if (src <= 0) return false;
  let stamped;
  try {
    stamped = Number(readFileSync(STAMP, "utf8").trim());
  } catch {
    return false;
  }
  return Number.isFinite(stamped) && stamped >= src;
}

function build() {
  // Read the fingerprint BEFORE building: a source edited while tsc runs must invalidate the stamp,
  // not be captured by it.
  const fingerprint = newestMtime(SRC);
  execFileSync("pnpm", ["--filter", "@mcp-token-footprint/shared", "build"], {
    cwd: REPO_ROOT,
    stdio: "inherit",
  });
  writeFileSync(STAMP, String(fingerprint));
}

function lockAgeMs() {
  try {
    return Date.now() - statSync(LOCK).mtimeMs;
  } catch {
    return 0;
  }
}

async function main() {
  if (isFresh()) return;

  for (;;) {
    try {
      // Atomic: exactly one caller can create the directory.
      mkdirSync(LOCK);
      break;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      if (lockAgeMs() > LOCK_STALE_MS) {
        // A previous build died holding the lock. Reclaim it rather than wedging the repo.
        rmSync(LOCK, { recursive: true, force: true });
        continue;
      }
      // Someone else is building. WAIT for them — do not build a second copy into the same dist,
      // and do not proceed hoping they finish first.
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
      if (!existsSync(LOCK)) return isFresh() ? undefined : main();
    }
  }

  try {
    writeFileSync(path.join(LOCK, "pid"), String(process.pid));
    build();
  } finally {
    rmSync(LOCK, { recursive: true, force: true });
  }
}

await main();
