import type { QlikTenantProbe, ServerAuthInput } from "@mcp-token-footprint/shared";
import type { LinkedAuthResolver, LinkedServerReader } from "../providers/linked-auth.js";
import { isLikelyQlikTenantUrl, safeUrlOrigin } from "./qlik-detect.js";

/**
 * Qlik Answers availability probe (WP 2.1) — LIST-ONLY BY CONSTRUCTION.
 *
 * The ONLY tenant request this module can ever make is `GET <origin>/api/v1/assistants` (the path is a
 * hardcoded constant below). It imports NO invoke/stream helper, holds NO reference to `actions/invoke`
 * or `actions/stream`, and exposes no seam to reach one — so a probe can NEVER consume a question. That
 * is the headline WP 2.1 invariant, enforced here by structure rather than by discipline.
 *
 * Everything lives behind the runtime boundary (apps/api only). A resolved bearer / OAuth access token
 * is read here to authorize the single GET; it NEVER appears in the returned `QlikTenantProbe` (which
 * carries only `origin` + booleans + a count), in a log, or in an error message. Every failure path
 * degrades to `answersAvailable:false` (with `needsOwnKey` only on a 401/403) — no secret is ever
 * surfaced.
 *
 * The tenant HTTP call is an injectable `fetch` ({@link ProbeFetch}); no test ever contacts a real Qlik
 * tenant.
 */

/** Injectable fetch seam (defaults to the global `fetch`); stubbed in tests — never a real tenant. */
export type ProbeFetch = typeof fetch;

/**
 * The single, hardcoded list-only endpoint. A SMALL page (`limit`) is requested — this is an
 * availability check, so we take one page's count and NEVER paginate (`links.next` is ignored). The
 * count is a lower bound for a tenant with more than a page of assistants, which is fine for the
 * wizard's "Answers is available (N assistants)" hint.
 */
const ASSISTANTS_PATH = "api/v1/assistants";
const ASSISTANTS_PROBE_LIMIT = 100;

type Availability = Pick<QlikTenantProbe, "answersAvailable" | "assistantCount" | "needsOwnKey">;

const NOT_AVAILABLE: Availability = { answersAvailable: false, assistantCount: 0 };

/**
 * The list-only GET primitive: given a tenant origin + a resolved bearer, hit `GET
 * <origin>/api/v1/assistants?limit=<small>` exactly once and classify the outcome. NEVER throws — a
 * failure is data (`answersAvailable:false`), never an error that could carry the bearer.
 *
 *  - 2xx           → `answersAvailable:true`, `assistantCount` = this page's `data[]` length,
 *                    `needsOwnKey:false`.
 *  - 401 / 403     → `answersAvailable:false`, `needsOwnKey:true` (the wizard offers an API-key
 *                    fallback — D-QA1); these creds can't reach the tenant.
 *  - anything else → `answersAvailable:false` (no `needsOwnKey`): a non-auth failure (5xx, network,
 *                    unreadable body). Availability is simply unknown/negative.
 */
export async function probeAssistantsAvailability(
  origin: string,
  bearer: string,
  fetchImpl: ProbeFetch = fetch,
): Promise<Availability> {
  const url = `${origin.replace(/\/+$/, "")}/${ASSISTANTS_PATH}?limit=${ASSISTANTS_PROBE_LIMIT}`;
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: "GET",
      headers: { authorization: `Bearer ${bearer}` },
    });
  } catch {
    // Network / DNS / TLS failure — never surface the cause (it can't leak the bearer either way).
    return NOT_AVAILABLE;
  }

  if (response.status === 401 || response.status === 403) {
    return { answersAvailable: false, assistantCount: 0, needsOwnKey: true };
  }
  if (!response.ok) {
    return NOT_AVAILABLE;
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return NOT_AVAILABLE;
  }
  return { answersAvailable: true, assistantCount: countAssistants(payload), needsOwnKey: false };
}

/** Count a single page of `{ data: Assistant[] }` — availability only; malformed/missing → 0. */
function countAssistants(payload: unknown): number {
  const data = (payload as { data?: unknown } | null)?.data;
  return Array.isArray(data) ? data.length : 0;
}

/**
 * Resolve a raw bearer token from a request-supplied `ServerAuthInput` (the URL-first
 * `POST /api/servers/probe` path — the server isn't saved yet, so there is no stored credential or
 * OAuth token). Mirrors the linked-auth header logic:
 *  - `bearer`  → the token.
 *  - `api_key` → the header value (an api-key server's header value IS the token).
 *  - custom `headers` → an `Authorization` value (strip an optional `Bearer ` prefix), else the first
 *    non-empty header value.
 *  - `none` / `oauth` (no connected token during an unauthenticated probe) → undefined.
 */
export function bearerFromRequestAuth(auth: ServerAuthInput | undefined): string | undefined {
  if (!auth || auth.type === "none" || auth.type === "oauth") return undefined;
  if (auth.type === "bearer") {
    const token = auth.token?.trim();
    return token || undefined;
  }
  if (auth.type === "api_key") {
    const key = auth.key?.trim();
    return key || undefined;
  }
  return bearerFromHeaders(auth.headers);
}

/** First usable bearer in a decrypted headers map: an `Authorization` value (Bearer-stripped), else any non-empty value. */
function bearerFromHeaders(headers: Record<string, string> | undefined): string | undefined {
  const entries = Object.entries(headers ?? {});
  for (const [name, value] of entries) {
    if (name.toLowerCase() === "authorization" && value.trim()) {
      return value.trim().replace(/^Bearer\s+/i, "");
    }
  }
  for (const value of entries.map(([, v]) => v)) {
    if (value.trim()) return value.trim();
  }
  return undefined;
}

/**
 * Dedicated-route orchestration for `POST /api/servers/:id/qlik/answers-probe`: detect (URL-based) then,
 * only for a Qlik tenant with resolvable OWN credentials, run the list-only availability GET. Always
 * returns a `QlikTenantProbe` (never throws for a non-Qlik / broken-auth server — that is just
 * `answersAvailable:false`).
 *
 * Auth reuses the WP 0.2 {@link LinkedAuthResolver} precedent (OAuth access token for an oauth server;
 * the decrypted `Authorization`/api-key header otherwise) so the four auth flavors resolve identically
 * to the roster. A broken/absent credential is a non-auth failure (`answersAvailable:false`, no
 * `needsOwnKey`) — we could not even attempt the GET, which is distinct from the tenant rejecting it.
 */
export async function probeServerAnswers(
  deps: { servers: LinkedServerReader; auth: LinkedAuthResolver },
  serverId: string,
  fetchImpl: ProbeFetch = fetch,
): Promise<QlikTenantProbe> {
  // `getInternal` throws a 404 for an unknown id — the route surfaces that (a real "server not found"),
  // so it is intentionally NOT caught here.
  const config = deps.servers.getInternal(serverId);
  const origin = safeUrlOrigin(config.url) ?? "";

  if (!isLikelyQlikTenantUrl(config.url)) {
    return { origin, ...NOT_AVAILABLE };
  }

  let bearer: string;
  try {
    // `resolve` returns the raw bearer + the server URL origin; since the URL is a Qlik tenant, that
    // origin IS the tenant origin. A broken link throws (non-leaking) → treat as a non-auth failure.
    ({ apiKey: bearer } = deps.auth.resolve(serverId));
  } catch {
    return { origin, ...NOT_AVAILABLE };
  }

  return { origin, ...(await probeAssistantsAvailability(origin, bearer, fetchImpl)) };
}

/**
 * URL-first folding for `POST /api/servers/probe`: returns a `QlikTenantProbe` ONLY when the probed URL
 * looks like a Qlik tenant, else `undefined` (so `ServerProbeResponse.qlikTenant` stays absent and every
 * other server probes exactly as before). Uses the probe request's OWN supplied auth — no server is
 * saved yet. A Qlik tenant with no usable auth (e.g. oauth not yet connected) → `answersAvailable:false`.
 */
export async function probeRequestAnswers(
  url: string,
  auth: ServerAuthInput | undefined,
  fetchImpl: ProbeFetch = fetch,
): Promise<QlikTenantProbe | undefined> {
  if (!isLikelyQlikTenantUrl(url)) return undefined;
  const origin = safeUrlOrigin(url) ?? "";

  const bearer = bearerFromRequestAuth(auth);
  if (!bearer) return { origin, ...NOT_AVAILABLE };

  return { origin, ...(await probeAssistantsAvailability(origin, bearer, fetchImpl)) };
}
