// ==================================================================================================
// Loopback API hardening — the browser-facing half of the auth posture (RM-37 WP 0.4)
// ==================================================================================================
//
// `api-tokens.ts` answers "may this CALLER reach the API?" for a headless caller. It deliberately
// leaves loopback open, because the browser on the host presents no credential (D-C2). That open
// door is fine against a caller on the network — the socket peer decides it — and useless against
// the two attacks that do not need a socket of their own:
//
//   • **DNS rebinding.** A page on `attacker.example` is served with a 1-second TTL; the record then
//     flips to `127.0.0.1`. The victim's browser re-resolves, and the page's own `fetch()` reaches
//     this API *from the victim's machine*, over a genuine loopback socket. `isLoopbackAddress` says
//     yes, correctly, because the connection really is local. What gives it away is the `Host`
//     header: the page asked for `attacker.example:8080`, not `localhost:8080`. Hence a HOST
//     allow-list, checked before routing (see `apps/api/src/security/origin-guard.ts`).
//
//   • **Cross-site request forgery.** Any page anywhere can `fetch("http://localhost:8080/api/...",
//     { method: "POST", mode: "no-cors" })` or submit a form at it. The request arrives on loopback
//     with a correct `Host`. What gives it away is `Origin` / `Sec-Fetch-Site`, and — belt and
//     braces, for a client that sends neither — a token the attacker's page cannot read out of a
//     `SameSite=Strict` cookie.
//
// This module is the **vocabulary** both halves share: the wire-visible error codes, the cookie and
// header names the SPA and the API must agree on, the host-matching rules, the response headers, and
// the rate-limit budgets. The enforcement lives in `apps/api/src/security/`; nothing here reads a
// request or holds state, so both ends resolve to one definition rather than two drifting copies.
//
// No new dependency, no migration, no feature flag — an off-switch on an origin check is the same
// foot-gun `api-tokens.ts` refuses for the auth check.

// ── Error codes (machine-readable, carried additively by the central error handler) ────────────────

/** 403 — the `Host` header names something outside the allow-list. The DNS-rebinding refusal. */
export const HOST_NOT_ALLOWED_ERROR_CODE = "host_not_allowed";

/** 403 — the request came from another site (`Origin`/`Referer`/`Sec-Fetch-Site` say so). */
export const ORIGIN_NOT_ALLOWED_ERROR_CODE = "origin_not_allowed";

/** 403 — a tokenless state-changing request arrived without a matching browser CSRF token. */
export const CSRF_TOKEN_INVALID_ERROR_CODE = "csrf_token_invalid";

/** 429 — too many requests of this kind inside the window. Carries a `Retry-After` header. */
export const RATE_LIMITED_ERROR_CODE = "rate_limited";

// ── The browser CSRF token ────────────────────────────────────────────────────────────────────────

/**
 * The cookie the API sets on any GET whose request did not already carry the current value.
 *
 * `SameSite=Strict` so a cross-site page's request never carries it, and **not** `HttpOnly` — the SPA
 * has to read it back to echo it in {@link CSRF_HEADER_NAME}. That is the point of the pattern, not a
 * slip: the value is not a credential (it authenticates nothing on its own), it is a proof that the
 * caller could read a same-origin cookie, which a cross-site attacker cannot do.
 */
export const CSRF_COOKIE_NAME = "workbench_csrf";

/** The header the SPA echoes the cookie back in, on every state-changing request. Lowercase — Node
 *  normalizes incoming header names, and the web client sends it in this exact spelling. */
export const CSRF_HEADER_NAME = "x-workbench-csrf";

/** Random bytes behind the per-install CSRF token (base64url-encoded to 43 characters). */
export const CSRF_TOKEN_BYTES = 32;

/** The `app_settings` key the per-install CSRF token is persisted under, so it survives a restart —
 *  a token minted per process would 403 every open tab on every `docker compose restart`. */
export const CSRF_TOKEN_SETTING_KEY = "app.csrfToken";

/** Does this string even LOOK like one of our CSRF tokens? Cheap shape gate before any comparison,
 *  so a blank or attacker-planted `workbench_csrf=x` cookie is rejected on shape rather than on a
 *  string compare that a same-site cookie-setting attacker might otherwise try to steer. */
export function looksLikeCsrfToken(value: string | undefined | null): boolean {
  return typeof value === "string" && /^[A-Za-z0-9_-]{32,128}$/.test(value);
}

/**
 * Read one cookie's value out of a raw `Cookie` header. Total — a malformed header yields
 * `undefined` rather than throwing on the hot path.
 *
 * Deliberately minimal: no percent-decoding (the token is base64url, which needs none) and no
 * quoted-string handling, so there is no decoding step for a hostile cookie to exploit.
 */
export function readCookie(header: string | undefined | null, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() !== name) continue;
    const value = part.slice(eq + 1).trim();
    return value.length > 0 ? value : undefined;
  }
  return undefined;
}

/** The `Set-Cookie` value for the browser CSRF token. `Path=/` so every route sees it; no `Domain`
 *  so it stays host-only; no `Secure` because this app is served over plain HTTP on loopback (a
 *  `Secure` cookie would simply never be stored, which would 403 every write). */
export function csrfSetCookieValue(token: string): string {
  return `${CSRF_COOKIE_NAME}=${token}; Path=/; SameSite=Strict`;
}

// ── Host allow-list ───────────────────────────────────────────────────────────────────────────────

/**
 * The hostnames this API answers to out of the box — the ones that can only mean "this machine".
 * Everything else has to be named explicitly in `API_ALLOWED_HOSTS`, which is why the launchers set
 * nothing: they all open `http://localhost:<port>` or `http://127.0.0.1:<port>`.
 *
 * A subdomain of `localhost` (`evil.localhost`, which resolves to 127.0.0.1 on most stacks) is
 * **not** covered — matching is exact, and a wildcard here would hand back the rebinding vector the
 * allow-list exists to close.
 */
export const DEFAULT_ALLOWED_HOSTNAMES = ["localhost", "::1"] as const;

/** Any address in `127.0.0.0/8`, written as a literal IPv4 host. */
function isLoopbackIpv4Literal(hostname: string): boolean {
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname);
}

/**
 * Pull the hostname out of a `Host` header value (`localhost:8081`, `127.0.0.1:8080`, `[::1]:8080`).
 *
 * The port is dropped on purpose: the allow-list is about *which name the caller asked for*, and a
 * rebound page controls the name, never the port it happened to be published on. Returns `null` for
 * an absent or unparseable header, which the guard treats as a refusal (fail closed).
 */
export function hostnameFromHostHeader(host: string | undefined | null): string | null {
  if (typeof host !== "string") return null;
  const trimmed = host.trim().toLowerCase();
  if (trimmed.length === 0) return null;

  if (trimmed.startsWith("[")) {
    const end = trimmed.indexOf("]");
    if (end <= 1) return null;
    return trimmed.slice(1, end);
  }

  const firstColon = trimmed.indexOf(":");
  if (firstColon === -1) return trimmed;
  // A bare IPv6 literal (`::1`) has several colons and no brackets. Splitting it at the first colon
  // would yield an empty string and refuse a perfectly local caller, so treat it as the whole name.
  if (trimmed.indexOf(":", firstColon + 1) !== -1) return trimmed;
  const name = trimmed.slice(0, firstColon);
  return name.length > 0 ? name : null;
}

/** Pull the hostname out of an absolute URL (`Origin`, `Referer`). `null` when it will not parse. */
export function hostnameFromUrl(value: string | undefined | null): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  try {
    const url = new URL(trimmed);
    const hostname = url.hostname.toLowerCase();
    // `new URL("http://[::1]:8080")` reports the hostname WITH its brackets; the Host-header form
    // does not. Normalize to the bracketless spelling so one allow-list serves both.
    return hostname.startsWith("[") ? hostname.slice(1, -1) : hostname;
  } catch {
    return null;
  }
}

/**
 * Parse `API_ALLOWED_HOSTS` — comma-separated, default empty. Entries are lowercased and stripped of
 * any `scheme://`, `[...]` brackets, port and path a copy-paste is likely to bring with it, so
 * `https://workbench.example.com:8443/` and `workbench.example.com` mean the same thing.
 */
export function parseAllowedHosts(value: string | undefined | null): string[] {
  if (typeof value !== "string") return [];
  const out: string[] = [];
  for (const raw of value.split(",")) {
    const entry = raw.trim().toLowerCase();
    if (entry.length === 0) continue;
    const withoutScheme = entry.replace(/^[a-z][a-z0-9+.-]*:\/\//, "");
    const hostPart = withoutScheme.split("/")[0] ?? "";
    const hostname = hostnameFromHostHeader(hostPart);
    if (hostname && !out.includes(hostname)) out.push(hostname);
  }
  return out;
}

/**
 * Is this hostname one the API answers to? `null` (absent / unparseable) is always a refusal.
 *
 * `extra` is the parsed `API_ALLOWED_HOSTS`; it can only ever ADD names. There is no way to remove
 * the loopback defaults, because doing so would lock the operator's own browser out of a tool whose
 * entire premise is that it runs on their machine.
 */
export function isAllowedHostname(
  hostname: string | null,
  extra: readonly string[] = [],
): boolean {
  if (hostname === null || hostname.length === 0) return false;
  const name = hostname.toLowerCase();
  if ((DEFAULT_ALLOWED_HOSTNAMES as readonly string[]).includes(name)) return true;
  if (isLoopbackIpv4Literal(name)) return true;
  return extra.some((entry) => entry.toLowerCase() === name);
}

// ── Security response headers ─────────────────────────────────────────────────────────────────────

/**
 * The Content-Security-Policy served with the SPA and every `/api` response.
 *
 * Strict where it closes a real hole in this app, permissive where the design system genuinely needs
 * it — and each relaxation is here with its reason, so nobody has to re-derive it:
 *
 *   • `default-src 'self'` — nothing loads from another origin. With `connect-src 'self'` this is
 *     what stops an injected script from posting your scan inventory somewhere.
 *   • `script-src 'self'` — no inline script, no `eval`. The built SPA is module scripts from
 *     `/assets/*`. (The OAuth callback page has one inline script and therefore sets its own
 *     nonce-based policy; the shared hook never overwrites a policy a route already chose.)
 *   • `style-src 'self' 'unsafe-inline'` — **required.** Radix (every popover, tooltip, select and
 *     dialog in `@elabs-ai/components-ui`) positions itself by writing `style="..."` attributes, and
 *     Monaco injects `<style>` elements at runtime. Without `'unsafe-inline'` the app renders, but
 *     every overlay lands in the wrong place. There is no nonce path for a style *attribute*.
 *   • `img-src`/`font-src`/`media-src` take `data:` and `blob:` — inline SVG data URIs, the
 *     illustration gallery, and object URLs the export actions mint.
 *   • `worker-src 'self' blob:` — Monaco's editor workers.
 *   • `frame-ancestors 'none'` + `X-Frame-Options: DENY` — this app is never framed, so clickjacking
 *     a one-click "delete this server" is off the table.
 *   • `object-src 'none'`, `base-uri 'self'`, `form-action 'self'` — the cheap ones that close plugin
 *     embedding, `<base>` hijacking and form exfiltration.
 */
export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "media-src 'self' data: blob:",
  "worker-src 'self' blob:",
  "connect-src 'self' blob:",
].join("; ");

/**
 * The headers every response carries. Flat and boring on purpose — this is a lookup table, not a
 * policy engine, so "which headers do we send" is answerable by reading four lines.
 */
export const SECURITY_RESPONSE_HEADERS: Readonly<Record<string, string>> = {
  "content-security-policy": CONTENT_SECURITY_POLICY,
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "no-referrer",
};

// ── Rate limits ───────────────────────────────────────────────────────────────────────────────────

/** The window every budget below is counted over. One minute — short enough that a legitimate burst
 *  clears quickly, long enough that a brute-force attempt cannot outrun it. */
export const RATE_LIMIT_WINDOW_MS = 60_000;

/**
 * Failed token authentications allowed per peer per window before the API answers 429 instead of 401.
 *
 * The point is not to make a 256-bit token guessable-in-theory-but-slower — it is not guessable. It
 * is that an unthrottled auth endpoint is a free oracle and a free amplifier: each attempt costs a
 * SHA-256 and a SQLite lookup, and nothing else in the app tells an operator that something is
 * hammering it.
 */
export const RATE_LIMIT_AUTH_FAILURES_PER_MINUTE = 20;

/**
 * Expensive actions allowed per peer per window — starting a scan, testing a server, launching a run
 * or a suite, or having the assistant invoke an MCP tool. Each of these spawns a child process or
 * spends provider tokens, so the budget is about a runaway loop (a retry storm, a stuck agent), not
 * about a hostile human: 60/min is far above anything a person does by hand.
 */
export const RATE_LIMIT_EXPENSIVE_PER_MINUTE = 60;

/**
 * The routes the expensive-action budget covers, as literal path prefixes/suffixes the API matches.
 * Declared here so the API guard, the docs and the tests read one list.
 *
 * `suffix` exists because two of them are parameterised in the middle (`/api/servers/:id/scan`), and
 * a rule that matched `/api/servers` as a prefix would throttle the plain server list too.
 */
export const RATE_LIMITED_ROUTES: readonly {
  method: "POST";
  match: "exact" | "prefix" | "suffix";
  path: string;
  reason: string;
}[] = [
  { method: "POST", match: "suffix", path: "/scan", reason: "scan" },
  { method: "POST", match: "suffix", path: "/test", reason: "server test" },
  { method: "POST", match: "exact", path: "/api/runs", reason: "run launch" },
  { method: "POST", match: "exact", path: "/api/run-plans", reason: "run launch" },
  { method: "POST", match: "suffix", path: "/rerun", reason: "run launch" },
  { method: "POST", match: "suffix", path: "/run", reason: "suite run" },
];

/** The key an in-process (non-HTTP) action is counted under — today only the assistant's
 *  `mcp_tool_call`, which has no socket peer to attribute a request to. */
export const RATE_LIMIT_ASSISTANT_TOOL_CALL_KEY = "assistant:mcp_tool_call";
