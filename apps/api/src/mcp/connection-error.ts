// Human-readable MCP connection errors. Node's undici surfaces transport failures as a bare
// `TypeError: fetch failed` with the real cause (ECONNREFUSED / ENOTFOUND / address:port) buried in
// `error.cause` — so a raw `error.message` is a dead end ("fetch failed"). This walks the cause chain
// and turns the common failure modes into actionable guidance. Shared by the probe + scan paths.

import { config } from "../config/env.js";

/** Walk the `Error.cause` chain to find a field (code / hostname / address / port / syscall). */
function findField(error: unknown, field: string, seen = new Set<unknown>()): string | undefined {
  if (!error || typeof error !== "object" || seen.has(error)) return undefined;
  seen.add(error);
  const value = (error as Record<string, unknown>)[field];
  if ((typeof value === "string" || typeof value === "number") && String(value).trim())
    return String(value);
  return findField((error as Record<string, unknown>).cause, field, seen);
}

function hostFromUrl(targetUrl?: string): string | undefined {
  if (!targetUrl) return undefined;
  try {
    return new URL(targetUrl).hostname;
  } catch {
    return undefined;
  }
}

function portFromUrl(targetUrl?: string): string | undefined {
  if (!targetUrl) return undefined;
  try {
    const url = new URL(targetUrl);
    return url.port || (url.protocol === "https:" ? "443" : url.protocol === "http:" ? "80" : "");
  } catch {
    return undefined;
  }
}

function rewriteHost(targetUrl: string, host: string): string | null {
  try {
    const url = new URL(targetUrl);
    url.hostname = host;
    return url.toString();
  } catch {
    return null;
  }
}

/** Base message with the underlying cause detail appended, so "fetch failed" carries its reason. */
export function describeError(error: unknown): string {
  const base =
    error instanceof Error ? error.message : typeof error === "string" ? error : "Unknown error";
  const code = findField(error, "code");
  const address = findField(error, "address");
  const port = findField(error, "port");
  const causeMsg =
    error instanceof Error && error.cause instanceof Error ? error.cause.message : undefined;

  const detail: string[] = [];
  if (code) detail.push(code);
  if (address) detail.push(port ? `${address}:${port}` : address);
  if (!detail.length && causeMsg && causeMsg !== base) detail.push(causeMsg);

  return detail.length ? `${base} (${detail.join(" ")})` : base;
}

/**
 * Turn an MCP transport error into an actionable message. Handles DNS (ENOTFOUND), connection
 * refused (ECONNREFUSED — nothing listening), and localhost-inside-Docker; falls back to the
 * cause-enriched `describeError`.
 */
export function formatConnectionError(
  error: unknown,
  targetUrl?: string,
  dockerMode = config.dockerMode,
): string {
  const code = findField(error, "code");
  const hostname = findField(error, "hostname") ?? hostFromUrl(targetUrl);
  const address = findField(error, "address");
  const port = findField(error, "port") ?? portFromUrl(targetUrl);

  if (code === "ENOTFOUND" && hostname) {
    const replacementUrl =
      dockerMode && targetUrl ? rewriteHost(targetUrl, "host.docker.internal") : null;
    return dockerMode && replacementUrl
      ? `Could not resolve hostname "${hostname}" from inside the MCP Token Footprint Docker container. Use ${replacementUrl} if the MCP server publishes that port on Docker Desktop, or put both containers on the same Docker network.`
      : `Could not resolve hostname "${hostname}". Check that the MCP server hostname is reachable from the API process.`;
  }

  if (code === "ECONNREFUSED") {
    const where = address
      ? ` at ${address}${port ? `:${port}` : ""}`
      : port
        ? ` on port ${port}`
        : "";
    const dockerHint = dockerMode
      ? " If it IS running in Docker, make sure its port is published to a host-reachable interface (0.0.0.0, not 127.0.0.1-only) — the API reaches it via host.docker.internal."
      : "";
    return `Connection refused${where} — nothing is accepting connections there. The most likely cause is that the MCP server isn't running; confirm the server/container is started and listening on that port.${dockerHint}`;
  }

  if ((hostname === "localhost" || hostname === "127.0.0.1") && dockerMode && targetUrl) {
    const replacementUrl = rewriteHost(targetUrl, "host.docker.internal");
    return `The API runs inside Docker, so ${hostname} points at the MCP Token Footprint container. Use ${replacementUrl} to reach a service published on the Docker Desktop host.`;
  }

  return describeError(error);
}
