/**
 * Request-path normalization for the root `onRequest` guards (roadmap/ci/ WP 1.1).
 *
 * ## Why this exists
 *
 * A guard that prefix-matches `request.url` and a router that matches a DECODED path do not agree
 * about what `/api` is, and the disagreement is exploitable. Fastify's router percent-decodes before
 * matching, but `request.url` inside an `onRequest` hook is the RAW request target — so a guard that
 * compares the raw string sees `/%61pi/tokens` as "not under /api", waves it through, and the router
 * then decodes `%61` to `a` and dispatches it straight to the real `GET /api/tokens` handler.
 *
 * Measured against a real Fastify 5 instance (routes registered as in `index.ts`):
 *
 * | request target        | router dispatches to  | note                                           |
 * | --------------------- | --------------------- | ---------------------------------------------- |
 * | `/%61pi/tokens`       | `GET /api/tokens`     | decoded once — THE bypass this module closes    |
 * | `/api/%74okens`       | `GET /api/tokens`     | any segment, not just the first                 |
 * | `/api%2ftokens`       | 404                   | `%2f` is NOT a path separator to the router     |
 * | `/%2e%2e/api/tokens`  | 404                   | no `..`/`.` resolution anywhere in the stack    |
 * | `/%25%36%31pi/tokens` | 404                   | decoding is single-pass, never recursive        |
 * | `/%zz/api/tokens`     | 400 (hook never runs) | malformed escapes are rejected before the hook  |
 *
 * ## The contract
 *
 * A guard must be **at least as inclusive as the router**: if the router could dispatch a request to
 * a governed route, the guard has to govern it. Being *more* inclusive is harmless — it turns a
 * would-be 404 into a 401/403, which is a refusal either way — so every predicate here matches on the
 * **union** of the raw and decoded interpretations, and {@link requestPathIsUnder} treats an
 * undecodable path as governed. Both directions fail closed: `%2f`-style tricks cannot escape a
 * prefix refusal, and a malformed escape cannot buy a free pass.
 *
 * Decoding is deliberately **single-pass** (`decodeURIComponent`, not a loop), which is exactly what
 * the router does — so the two never diverge.
 */

/** A request path in both the interpretations a guard has to consider. */
export type RequestPath = {
  /** The raw request target with any query string / fragment removed — what `request.url` carries. */
  raw: string;
  /** The percent-decoded path — what the router actually matches on. `null` when it won't decode. */
  decoded: string | null;
};

/**
 * Split a request URL into its raw and decoded path forms. Total: a malformed percent-escape yields
 * `decoded: null` rather than throwing, so a guard on the hot path can never 500 on a hostile URL.
 */
export function normalizeRequestPath(url: string): RequestPath {
  const raw = url.split("?")[0]?.split("#")[0] ?? url;
  try {
    return { raw, decoded: decodeURIComponent(raw) };
  } catch {
    // A malformed escape (`/%zz/…`). Fastify itself answers 400 before any hook runs, so this is
    // belt-and-braces — but it must resolve to "governed", never "waved through".
    return { raw, decoded: null };
  }
}

/** Does `path` sit at or under `prefix`, on a real segment boundary (`/api/x` yes, `/apifoo` no)? */
function isUnder(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(`${prefix}/`);
}

/**
 * Is this request at or under `prefix` under ANY interpretation the router might take?
 *
 * **Fails closed**: an undecodable path is treated as a match, so a hostile escape sequence can never
 * be used to slip out from under a guarded prefix.
 */
export function requestPathIsUnder(path: RequestPath, prefix: string): boolean {
  if (path.decoded === null) return true;
  return isUnder(path.raw, prefix) || isUnder(path.decoded, prefix);
}

/**
 * Does this request address exactly `exact` under any interpretation?
 *
 * Used for EXEMPTIONS (`GET /api/health`), so it deliberately does NOT fail closed: an undecodable
 * path has no `decoded` form and its raw form cannot equal a literal without escapes, so it simply
 * fails to match — which is the safe direction for an exemption.
 */
export function requestPathEquals(path: RequestPath, exact: string): boolean {
  return path.raw === exact || path.decoded === exact;
}

// ── The STRICT (intersection) direction — for rules that RELAX, not rules that govern (D-MCP9) ────
//
// Everything above answers "is this request governed?" and answers it on the **union** of the raw and
// decoded forms, because for that question the inclusive answer is the safe one: over-governing turns
// a would-be 404 into a refusal, which is a refusal either way.
//
// A per-route scope rule (`API_TOKEN_ROUTE_SCOPES`) asks the OPPOSITE question — "may this request
// need LESS than the coarse rule demands?" — and there the inclusive answer is the unsafe one. If
// `/%61pi/mcp` matched the relaxed `POST /api/mcp → read` rule on its decoded form alone, a
// `read`-only token would inherit that relaxation for a request whose raw form is not the mount at
// all. So a relaxing rule applies only on the **intersection**: the raw form and the decoded form must
// BOTH match, and an undecodable path matches nothing. An ambiguous path then falls back to the coarse
// method rule — which demands MORE, i.e. the safe direction.
//
// Same module, opposite direction, on purpose. `apps/api/test/api-tokens-guard.test.ts` pins both with
// a table that fails if either matcher is swapped for the other.

/** Does `path` address exactly `exact` under BOTH interpretations? Used only to RELAX (D-MCP9). */
export function requestPathEqualsStrict(path: RequestPath, exact: string): boolean {
  if (path.decoded === null) return false;
  return path.raw === exact && path.decoded === exact;
}

/** Does `path` sit at or under `prefix` under BOTH interpretations? Used only to RELAX (D-MCP9). */
export function requestPathIsUnderStrict(path: RequestPath, prefix: string): boolean {
  if (path.decoded === null) return false;
  return isUnder(path.raw, prefix) && isUnder(path.decoded, prefix);
}

/** Every distinct interpretation, for a caller that has to run its own matcher over each. */
export function requestPathCandidates(path: RequestPath): string[] {
  if (path.decoded === null || path.decoded === path.raw) return [path.raw];
  return [path.raw, path.decoded];
}
