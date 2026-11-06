/**
 * Docker-host trust — the one sanctioned widening of "loopback" (RM-40 amendment to D-C2).
 *
 * ## The defect this exists for
 *
 * The guard opens `/api/*` to loopback callers only. In a container that is never the operator's
 * browser: Docker Desktop delivers a connection to a published port from the container network's
 * GATEWAY (measured: `172.25.0.1`, the container itself at `172.25.0.2`), so the host's own browser
 * reads as a remote caller and every request is refused with `authentication_required`. A browser
 * cannot present a bearer token, so the containerized UI was unusable from the day the guard shipped.
 *
 * ## What is trusted, and why it is safe
 *
 * Exactly ONE address — the container's IPv4 default gateway, read from the kernel routing table at
 * startup — and only when BOTH:
 *   - the process runs in Docker mode (`config.dockerMode`), and
 *   - the operator opted in with `API_TRUST_DOCKER_HOST=true` (default `false`).
 *
 * The repo's `docker-compose.yml` publishes the port on `127.0.0.1` only, so the only thing that can
 * reach the gateway-side of that port is a process on the host machine itself — the same population
 * loopback already admits. Other containers on the same network connect from their OWN addresses
 * (`172.25.0.3`, …), not the gateway's, so they stay remote and still need a token. Publishing the
 * port on `0.0.0.0` while this is on would admit the LAN — the compose comment says so.
 *
 * Nothing here reads a header. The gateway comes from the kernel, the peer from the socket.
 */

/** Linux `RTF_GATEWAY` — the route uses a gateway. */
const RTF_GATEWAY = 0x2;

/**
 * The IPv4 default gateway from a `/proc/net/route` table, or `undefined` when there is none.
 *
 * The table's `Gateway` column is the address as a little-endian hex `u32` (`010019AC` ⇒
 * `172.25.0.1`). Only a default route (`Destination` `00000000`) that actually has the gateway flag
 * counts; a malformed row is skipped, never guessed at.
 */
export function parseDefaultGateway(routeTable: string): string | undefined {
  for (const line of routeTable.split("\n").slice(1)) {
    const columns = line.trim().split(/\s+/);
    const [, destination, gateway, flags] = columns;
    if (destination !== "00000000" || !gateway || !flags) continue;
    if (!/^[0-9A-Fa-f]{8}$/.test(gateway) || !/^[0-9A-Fa-f]+$/.test(flags)) continue;
    if ((Number.parseInt(flags, 16) & RTF_GATEWAY) === 0) continue;
    const octets = gateway.match(/../g)?.map((pair) => Number.parseInt(pair, 16)) ?? [];
    if (octets.length !== 4) continue;
    const address = octets.reverse().join(".");
    if (address === "0.0.0.0") continue;
    return address;
  }
  return undefined;
}

/**
 * The peer addresses the guard treats like loopback. Empty unless BOTH switches are on and a
 * gateway was actually found — so a misread table, a non-Linux host or a forgotten opt-in all fail
 * CLOSED to the unchanged loopback-only rule.
 */
export function resolveTrustedLocalPeers(options: {
  trustDockerHost: boolean;
  dockerMode: boolean;
  readRouteTable: () => string;
}): ReadonlySet<string> {
  if (!options.trustDockerHost || !options.dockerMode) return new Set();
  let table: string;
  try {
    table = options.readRouteTable();
  } catch {
    return new Set();
  }
  const gateway = parseDefaultGateway(table);
  return gateway ? new Set([gateway]) : new Set();
}

/** Is this socket peer one of the trusted local peers? Normalizes the IPv4-mapped IPv6 form. */
export function isTrustedLocalPeer(
  remoteAddress: string | undefined | null,
  trusted: ReadonlySet<string>,
): boolean {
  if (!remoteAddress || trusted.size === 0) return false;
  const address = remoteAddress.split("%")[0]?.toLowerCase() ?? "";
  const ipv4 = address.startsWith("::ffff:") ? address.slice("::ffff:".length) : address;
  return trusted.has(ipv4);
}
