import path from "node:path";
import { httpError } from "../utils/errors.js";

/**
 * Containment guards for the collection conflict-`resolve` sink (C-1 / security H1).
 *
 * `POST /api/collections/:id/resolve` takes a per-file `path` that the git-sync engine joins under the
 * collection's working clone and then writes / deletes with `fs`. Left unconstrained, a `../…` (or an
 * absolute) path escapes the clone and gives arbitrary host-file write/delete BEFORE git ever validates
 * it. These helpers are the single place that decides whether a caller-supplied relative path is legal.
 *
 * Kept LOCAL to `collections/` on purpose (the assistant workspace has an equivalent guard, but this
 * worktree stays file-disjoint from it) — do NOT import the assistant helper here.
 */

/**
 * True iff `p` is a safe POSIX-style RELATIVE path: non-empty, NUL-free, not absolute (no leading `/`,
 * no Windows drive prefix), backslash-free (a `\` is a Windows separator / would defeat the `/`-based
 * containment reasoning), and with NO empty / `.` / `..` segment. This is the predicate the route schema
 * refines with, and the first check the engine re-applies (defense in depth).
 */
export function isSafeRelativePath(p: string): boolean {
  if (typeof p !== "string" || p.length === 0) return false;
  if (p.includes("\0")) return false; // NUL byte — truncation / injection
  if (p.includes("\\")) return false; // backslash — Windows sep / containment bypass
  if (p.startsWith("/")) return false; // absolute POSIX
  if (/^[a-zA-Z]:/.test(p)) return false; // Windows drive-absolute (C:\…)
  for (const segment of p.split("/")) {
    if (segment === "" || segment === "." || segment === "..") return false;
  }
  return true;
}

/** Assert {@link isSafeRelativePath}, else a typed 400 (never a raw fs error to the caller). */
export function assertSafeRelativePath(p: string): void {
  if (!isSafeRelativePath(p)) {
    throw httpError(400, `Unsafe file path "${p}" — no absolute, backslash, NUL, or ".." segments.`);
  }
}

/**
 * Best-in-depth containment: assert the resolved `abs` path stays STRICTLY inside `base` (the clone
 * dir). Even with {@link isSafeRelativePath} in front, this catches any residual escape (symlinked base,
 * odd normalization) before an `fs` write/delete ever runs.
 */
export function assertWithinBase(base: string, abs: string): void {
  const resolvedBase = path.resolve(base);
  const resolvedAbs = path.resolve(abs);
  const prefix = resolvedBase.endsWith(path.sep) ? resolvedBase : resolvedBase + path.sep;
  if (!resolvedAbs.startsWith(prefix)) {
    throw httpError(400, "Resolved path escapes the collection working directory.");
  }
}
