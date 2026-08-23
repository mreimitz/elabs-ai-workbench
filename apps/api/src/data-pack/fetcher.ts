// The startup refresh: fetch a manifest, download what it lists into staging, verify it THERE, and
// swap it into `DATA_DIR/data-pack/` in one rename (RM-38 WP 3.1, D-DP4).
//
// THE ONE RULE THIS FILE SERVES
// -----------------------------
// **The fetch is an optimisation that can always fail.** This app's offline hand-off bundle (RM-19)
// is built for someone with no repository access and no registry; a container that will not start
// because GitHub is slow is a worse product than one running last week's model prices. So nothing
// here throws, nothing here is awaited on the boot path, and every failure — DNS, 404, hang, a
// server that streams forever, a corrupt pack, a pack that fails one of the five D-DP5 refusals —
// returns a VALUE that says what happened and leaves the pack in force exactly as it was.
//
// TWO BOUNDS, NOT ONE, AND THEY BOUND DIFFERENT THINGS
// ---------------------------------------------------
// `DATA_PACK_TIMEOUT_MS` bounds ONE request. It does nothing about a peer that answers every
// request at 99% of that bound — with ~24 files that is 24 timeouts of wall clock, and the
// per-request bound never fires once. `dataPackTotalBudgetMs` bounds the check as a whole. Both are
// enforced on the same `AbortSignal`, and each has its own test with a real listener behind it,
// because a bound whose removal reddens nothing is an environment variable that does not bite.
//
// WHAT IS DELIBERATELY ABSENT: retries, and any pacing delay. A retry would multiply the cost of a
// misbehaving peer by the retry count, and the thing being retried is a check that runs again on
// the next boot anyway. If that changes, the retry needs its own bound and its own test — do not
// add one silently.
//
// ORDERING, AND WHY THE CHEAP REFUSALS COME FIRST
// ----------------------------------------------
// The manifest is checked for shape, then layout version, then version ordering, then path safety —
// all BEFORE a single pack file is downloaded. A pack this build cannot read is refused for ~2 KB
// of traffic rather than ~2 MB, and, more importantly, a manifest naming a hostile path is refused
// before anything has been written anywhere.

import path from "node:path";
import {
  comparePackVersions,
  DATA_PACK_MANIFEST_FILENAME,
  DATA_PACK_MAX_REMOTE_FILE_BYTES,
  DATA_PACK_MAX_REMOTE_FILES,
  DATA_PACK_MAX_REMOTE_TOTAL_BYTES,
  DataPackManifestSchema,
  type DataPackFetchOutcome,
  type DataPackManifest,
  type DataPackRefusal,
  dataPackTotalBudgetMs,
  isSafePackRelativePath,
  isSupportedDataPackSchemaVersion,
  resolveDataPackFileUrl,
} from "@mcp-token-footprint/shared";
import {
  type DataPackFs,
  type DataPackWriteFs,
  nodeDataPackFs,
  nodeDataPackWriteFs,
} from "./fs.js";
import type { ResolvedDataPack } from "./loader.js";
import { CACHE_PACK_DIRNAME, RETIRED_PACK_DIRNAME, STAGING_PACK_DIRNAME } from "./resolve.js";
import { verifyCandidatePack } from "./verify.js";

/** The `fetch` seam. Global `fetch` in production; a recording double in the "zero requests" test. */
export type DataPackFetchImpl = (url: string, init: { signal: AbortSignal }) => Promise<Response>;

export type DataPackRefreshDeps = {
  fetchImpl?: DataPackFetchImpl;
  readFs?: DataPackFs;
  writeFs?: DataPackWriteFs;
  /** Monotonic-ish clock, injectable so a budget test does not have to sleep. */
  now?: () => number;
};

export type DataPackRefreshArgs = {
  /** `DATA_PACK_URL`. Empty string disables the check entirely and makes zero outbound requests. */
  url: string;
  /** `DATA_PACK_CHECK_ON_START`. False disables the check entirely. */
  enabled: boolean;
  /** `DATA_PACK_TIMEOUT_MS`, per request. The total budget is derived from it. */
  timeoutMs: number;
  /**
   * The whole-check budget. Defaults to `dataPackTotalBudgetMs(timeoutMs)`, which is what
   * production always uses — there is no env var for it, deliberately: two independently tunable
   * timeouts is a configuration surface nobody would get right.
   *
   * It is an ARGUMENT rather than a derived local so the two bounds can be tested independently.
   * A test that can only move them together cannot tell which one fired, and a bound whose removal
   * reddens nothing is an environment variable that does not bite. With this, the per-request test
   * sets a budget too large to fire and the budget test sets a per-request timeout too large to
   * fire, so each assertion has exactly one possible cause.
   */
  totalBudgetMs?: number;
  /** `DATA_DIR`. The cache, staging and retired directories are all resolved under it. */
  dataDirectory: string;
  /** The pack a candidate must be strictly newer than. */
  inForce: ResolvedDataPack;
  /** The pack whose security rule-id ledger anchors D-DP6. Always the BUNDLED snapshot. */
  bundled: ResolvedDataPack;
  deps?: DataPackRefreshDeps;
};

export type DataPackRefreshResult = {
  outcome: DataPackFetchOutcome;
  /**
   * The newly verified pack, ONLY when `outcome.status === "installed"`. The caller installs it —
   * this module never touches the module-level slot, so a test can run a full refresh without
   * changing what the rest of the process sees.
   */
  pack?: ResolvedDataPack;
};

/** Internal: a bounded download failed. Carries the sentence that reaches the log. */
class TransportError extends Error {}

/**
 * Run one startup refresh. Never throws — a caller that wraps this in `.catch()` is being polite,
 * not defensive.
 */
export async function refreshDataPack(args: DataPackRefreshArgs): Promise<DataPackRefreshResult> {
  const deps = args.deps ?? {};
  const fetchImpl = deps.fetchImpl ?? ((url, init) => fetch(url, init));
  const readFs = deps.readFs ?? nodeDataPackFs;
  const writeFs = deps.writeFs ?? nodeDataPackWriteFs;
  const now = deps.now ?? (() => Date.now());

  const startedAt = now();
  const currentVersion = args.inForce.manifest.packVersion;
  const since = (): number => Math.max(0, now() - startedAt);

  const url = args.url.trim();
  if (!args.enabled || url.length === 0) {
    // No socket is opened on this path, and `assertZeroRequests` in the test suite is what holds
    // that true rather than this comment.
    return {
      outcome: {
        status: "disabled",
        detail: !args.enabled
          ? "DATA_PACK_CHECK_ON_START is off; no reference-data check was made."
          : "DATA_PACK_URL is empty; the reference-data check is disabled.",
        ...(url.length > 0 ? { url } : {}),
        currentVersion,
        durationMs: since(),
      },
    };
  }

  const cacheDir = path.join(args.dataDirectory, CACHE_PACK_DIRNAME);
  const stagingDir = path.join(args.dataDirectory, STAGING_PACK_DIRNAME);
  const retiredDir = path.join(args.dataDirectory, RETIRED_PACK_DIRNAME);

  const unreachable = (detail: string, remoteVersion?: string): DataPackRefreshResult => ({
    outcome: {
      status: "unreachable",
      detail,
      url,
      currentVersion,
      ...(remoteVersion ? { remoteVersion } : {}),
      durationMs: since(),
    },
  });
  const refused = (refusal: DataPackRefusal, remoteVersion?: string): DataPackRefreshResult => ({
    outcome: {
      status: "refused",
      detail: refusal.detail,
      url,
      currentVersion,
      ...(remoteVersion ? { remoteVersion } : {}),
      refusal,
      durationMs: since(),
    },
  });

  const deadline = startedAt + (args.totalBudgetMs ?? dataPackTotalBudgetMs(args.timeoutMs));
  const download = (target: string, cap: number): Promise<Buffer> =>
    fetchBounded({ url: target, fetchImpl, timeoutMs: args.timeoutMs, deadline, now, cap });

  // --- 1. The manifest ---------------------------------------------------------------------------

  let manifestBytes: Buffer;
  try {
    manifestBytes = await download(url, DATA_PACK_MAX_REMOTE_FILE_BYTES);
  } catch (error) {
    return unreachable(
      `The reference data pack check could not read ${DATA_PACK_MANIFEST_FILENAME}: ${describe(error)}`,
    );
  }

  let manifest: DataPackManifest;
  try {
    const parsed = DataPackManifestSchema.safeParse(JSON.parse(manifestBytes.toString("utf8")));
    if (!parsed.success) {
      return refused({
        reason: "schema_violation",
        detail:
          `The manifest served at ${url} does not satisfy the pack manifest contract: ` +
          parsed.error.issues
            .slice(0, 4)
            .map((issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`)
            .join("; "),
        paths: [DATA_PACK_MANIFEST_FILENAME],
      });
    }
    manifest = parsed.data;
  } catch {
    return refused({
      reason: "schema_violation",
      detail: `The manifest served at ${url} is not readable JSON.`,
      paths: [DATA_PACK_MANIFEST_FILENAME],
    });
  }

  // --- 2. Layout version, before a single pack file is downloaded --------------------------------

  if (!isSupportedDataPackSchemaVersion(manifest.schemaVersion)) {
    return refused(
      {
        reason: "unsupported_schema_version",
        detail:
          `The pack served at ${url} declares schemaVersion ${manifest.schemaVersion}, which this ` +
          "build does not understand. Refused whole rather than partially downloaded.",
      },
      manifest.packVersion,
    );
  }

  // --- 3. Version ordering -----------------------------------------------------------------------
  //
  // EQUAL is not a refusal. It is the steady state of every healthy install that has already
  // refreshed once, and reporting it as a downgrade would fill the log with alarm about nothing.
  // Strictly LOWER, and unorderable, are refusals (D-DP5).

  const order = comparePackVersions(manifest.packVersion, currentVersion);
  if (order === 0) {
    return {
      outcome: {
        status: "up_to_date",
        detail: `The published pack is ${manifest.packVersion}, the same version already in force.`,
        url,
        remoteVersion: manifest.packVersion,
        currentVersion,
        durationMs: since(),
      },
    };
  }
  if (order !== 1) {
    return refused(
      {
        reason: "version_regression",
        detail:
          `The pack served at ${url} is version ${manifest.packVersion}, which is not newer than ` +
          `the ${args.inForce.origin} pack ${currentVersion}` +
          `${order === null ? " (and one of the two versions is unorderable)" : ""}; ` +
          "keeping the pack in force.",
      },
      manifest.packVersion,
    );
  }

  // --- 4. Path safety and size, before anything is written --------------------------------------

  if (manifest.files.length > DATA_PACK_MAX_REMOTE_FILES) {
    return refused(
      {
        reason: "schema_violation",
        detail:
          `The pack served at ${url} lists ${manifest.files.length} files, over the ` +
          `${DATA_PACK_MAX_REMOTE_FILES}-file cap.`,
      },
      manifest.packVersion,
    );
  }
  const declaredTotal = manifest.files.reduce((sum, entry) => sum + entry.bytes, 0);
  if (declaredTotal > DATA_PACK_MAX_REMOTE_TOTAL_BYTES) {
    return refused(
      {
        reason: "schema_violation",
        detail:
          `The pack served at ${url} declares ${declaredTotal} bytes, over the ` +
          `${DATA_PACK_MAX_REMOTE_TOTAL_BYTES}-byte cap.`,
      },
      manifest.packVersion,
    );
  }
  const targets: { rel: string; href: string; bytes: number }[] = [];
  for (const entry of manifest.files) {
    const href = isSafePackRelativePath(entry.path)
      ? resolveDataPackFileUrl(url, entry.path)
      : null;
    if (href === null) {
      // The single most important refusal in this file. The manifest is untrusted input that is
      // about to decide WHERE THIS PROCESS WRITES, and it decides that before any digest, schema or
      // ledger check has had a chance to run. `../../../` is refused here or nowhere.
      return refused(
        {
          reason: "schema_violation",
          detail:
            `The pack served at ${url} lists a file path this build will not fetch or write: ` +
            `${JSON.stringify(entry.path)}.`,
          paths: [entry.path],
        },
        manifest.packVersion,
      );
    }
    if (entry.bytes > DATA_PACK_MAX_REMOTE_FILE_BYTES) {
      return refused(
        {
          reason: "schema_violation",
          detail:
            `The pack served at ${url} declares ${entry.path} at ${entry.bytes} bytes, over the ` +
            `${DATA_PACK_MAX_REMOTE_FILE_BYTES}-byte per-file cap.`,
          paths: [entry.path],
        },
        manifest.packVersion,
      );
    }
    targets.push({ rel: entry.path, href, bytes: entry.bytes });
  }

  // --- 5. Stage ----------------------------------------------------------------------------------
  //
  // The sweep is first, unconditionally. A previous process killed mid-download leaves a partial
  // tree here, and appending to it would build a pack out of two different versions' files — which
  // the digest check would then catch, but for the wrong reason and after the download cost.

  try {
    writeFs.rmrf(stagingDir);
    writeFs.mkdirp(stagingDir);
    writeFs.writeFile(path.join(stagingDir, DATA_PACK_MANIFEST_FILENAME), manifestBytes);

    let downloaded = 0;
    for (const target of targets) {
      const bytes = await download(target.href, DATA_PACK_MAX_REMOTE_FILE_BYTES);
      downloaded += bytes.byteLength;
      if (downloaded > DATA_PACK_MAX_REMOTE_TOTAL_BYTES) {
        throw new TransportError(
          `the download exceeded the ${DATA_PACK_MAX_REMOTE_TOTAL_BYTES}-byte total cap`,
        );
      }
      const abs = path.join(stagingDir, ...target.rel.split("/"));
      writeFs.mkdirp(path.dirname(abs));
      writeFs.writeFile(abs, bytes);
    }
  } catch (error) {
    // Staging is discarded on ANY failure, so an interrupted download leaves nothing behind that a
    // later run could mistake for a pack. It is outside `DATA_DIR/data-pack/` in the first place,
    // so it was never a candidate; this is tidiness on top of a structural guarantee.
    safely(() => writeFs.rmrf(stagingDir));
    return unreachable(
      `The reference data pack at ${url} could not be downloaded: ${describe(error)}`,
      manifest.packVersion,
    );
  }

  // --- 6. Verify IN STAGING — all five D-DP5 refusals, through the one verifier -------------------

  const verified = verifyCandidatePack({
    dir: stagingDir,
    origin: "fetched",
    inForce: args.inForce,
    bundled: args.bundled,
    fs: readFs,
  });
  if (!verified.ok) {
    safely(() => writeFs.rmrf(stagingDir));
    return refused(verified.refusal, manifest.packVersion);
  }

  // --- 7. Swap ------------------------------------------------------------------------------------

  try {
    swapIntoPlace({ cacheDir, stagingDir, retiredDir, readFs, writeFs });
  } catch (error) {
    safely(() => writeFs.rmrf(stagingDir));
    return unreachable(
      `The reference data pack ${manifest.packVersion} verified but could not be written to ` +
        `${cacheDir}: ${describe(error)}`,
      manifest.packVersion,
    );
  }

  // The pack object still points at `stagingDir`, which no longer exists — it was renamed. Re-point
  // it at where the bytes actually are, so a log line, `/api/diagnostics` (WP 3.2) and any later
  // reader all name a directory that is really there. Everything else about the pack is already
  // parsed and in memory; nothing is re-read.
  const pack: ResolvedDataPack = { ...verified.pack, dir: cacheDir };

  return {
    outcome: {
      status: "installed",
      detail:
        `Reference data pack ${manifest.packVersion} verified and installed, replacing ` +
        `${currentVersion}.`,
      url,
      remoteVersion: manifest.packVersion,
      currentVersion,
      files: manifest.files.length,
      durationMs: since(),
    },
    pack,
  };
}

/**
 * Replace the cache directory with the staged one.
 *
 * Two renames, because `rename(2)` onto a non-empty directory is ENOTEMPTY. The window between them
 * is the only moment `DATA_DIR/data-pack/` does not exist, and a crash inside it degrades to the
 * bundled snapshot on the next boot — the D-DP4 answer, and never a partial tree. If the second
 * rename fails the first is undone, so a failure leaves the previous cache exactly where it was.
 *
 * This is filesystem atomicity, and it is NOT what makes the swap safe for the running process.
 * That is `installDataPackSource`'s single assignment: the cache directory is read at boot and
 * nowhere else, so no in-flight request is looking at these bytes while they move.
 */
function swapIntoPlace(args: {
  cacheDir: string;
  stagingDir: string;
  retiredDir: string;
  readFs: DataPackFs;
  writeFs: DataPackWriteFs;
}): void {
  const { cacheDir, stagingDir, retiredDir, readFs, writeFs } = args;
  writeFs.rmrf(retiredDir);
  const hadCache = readFs.exists(cacheDir);
  if (hadCache) writeFs.rename(cacheDir, retiredDir);
  try {
    writeFs.rename(stagingDir, cacheDir);
  } catch (error) {
    if (hadCache) safely(() => writeFs.rename(retiredDir, cacheDir));
    throw error;
  }
  writeFs.rmrf(retiredDir);
}

/**
 * One bounded GET.
 *
 * BOTH bounds ride the same `AbortSignal`: the per-request timeout and whatever is left of the
 * total budget, whichever is smaller. That is deliberate — a request started with 40 ms of budget
 * left gets 40 ms, not a fresh timeout, so N slow-but-not-timing-out requests cannot add up past
 * the budget one at a time.
 *
 * The body is read through a reader rather than `arrayBuffer()` so the byte cap bounds MEMORY and
 * not just time. A peer that under-declares `content-length` and then streams forever would
 * otherwise be bounded only by the clock, having already allocated whatever it sent in the interim.
 */
async function fetchBounded(args: {
  url: string;
  fetchImpl: DataPackFetchImpl;
  timeoutMs: number;
  deadline: number;
  now: () => number;
  cap: number;
}): Promise<Buffer> {
  const remaining = args.deadline - args.now();
  if (remaining <= 0) {
    throw new TransportError("the total time budget for the check was exhausted");
  }
  const controller = new AbortController();
  let budgetExhausted = false;
  const allowance = Math.min(args.timeoutMs, remaining);
  if (allowance === remaining) budgetExhausted = true;
  const timer = setTimeout(() => controller.abort(), allowance);
  try {
    const response = await args.fetchImpl(args.url, { signal: controller.signal });
    if (!response.ok) {
      throw new TransportError(`HTTP ${response.status} from ${args.url}`);
    }
    const declared = Number(response.headers.get("content-length") ?? Number.NaN);
    if (Number.isFinite(declared) && declared > args.cap) {
      throw new TransportError(`${args.url} declares ${declared} bytes, over the ${args.cap} cap`);
    }
    const body = response.body;
    if (!body) {
      throw new TransportError(`${args.url} returned no body`);
    }
    const reader = body.getReader();
    const chunks: Buffer[] = [];
    let total = 0;
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      total += next.value.byteLength;
      if (total > args.cap) {
        await reader.cancel().catch(() => {});
        throw new TransportError(`${args.url} sent more than the ${args.cap}-byte cap`);
      }
      chunks.push(Buffer.from(next.value));
    }
    return Buffer.concat(chunks);
  } catch (error) {
    if (controller.signal.aborted) {
      throw new TransportError(
        budgetExhausted
          ? `the total time budget for the check ran out during ${args.url}`
          : `${args.url} did not answer within ${args.timeoutMs} ms`,
      );
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function describe(error: unknown): string {
  if (error instanceof TransportError) return error.message;
  if (error instanceof Error) return error.message;
  return String(error);
}

/** Run a cleanup that must never mask the failure it is cleaning up after. */
function safely(run: () => void): void {
  try {
    run();
  } catch {
    // Deliberately swallowed: this only ever runs on an error path, and a failed `rm` of a staging
    // directory must not replace the real reason the refresh failed.
  }
}
