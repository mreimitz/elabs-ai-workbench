import type { ServerTypeStatus } from "@mcp-token-footprint/shared";

// Skill Studio WP 7.3a — the PURE derivation behind the "Bind server" picker: registered servers ×
// persisted scan summaries × the names already declared in the draft frontmatter → one candidate row
// per registered server, annotated with its latest-scan state and (when applicable) why it can't be
// bound. Pure + framework-free so the list logic is unit-tested without rendering. The input slices
// are structural (string fields) so a shared `ServerConfig` / `ScanSummary` satisfies them directly.
//
// Server-types WP 3.2 (B) extends this with `deriveBindTypeCandidates` — the same picker also offers
// registered server TYPES. Binding a type writes the TYPE NAME into `servers:`, which the API resolver
// maps to the type's representative member (D-ST3). Membership is read from each server's `typeId`.

/** The slim server slice the picker needs (a `ServerConfig` always satisfies it). `typeId` (additive,
 *  WP 3.1/2.x) is the server's type membership — used by {@link deriveBindTypeCandidates}. */
export type BindServerInfo = { id: string; name: string; transport: string; typeId?: string | null };

/** The slim scan slice the picker needs (a `ScanSummary` always satisfies it). */
export type BindScanInfo = {
  serverId: string;
  status: string;
  scannedAt: string;
  totalTools: number;
};

export type BindCandidateDisabledReason = "already-bound" | "ambiguous-name";

export type BindCandidate = {
  serverId: string;
  serverName: string;
  transport: string;
  /** The NEWEST scan's raw status wire value (any status), or null when the server was never scanned. */
  lastScanStatus: string | null;
  /** The newest scan's timestamp (ISO), or null when never scanned. */
  lastScanAt: string | null;
  /** Tool count of the newest SUCCESS scan — what binding would actually surface. Null when none. */
  scannedTools: number | null;
  /** True when at least one completed (success) scan exists — the palette will show tools. */
  hasCompletedScan: boolean;
  /**
   * Why this row can't be bound, or null when bindable:
   *  - `already-bound` — the (trimmed) name is already in the frontmatter `servers:` list;
   *  - `ambiguous-name` — ≥2 registered servers share this exact name, so a frontmatter name can
   *    never auto-resolve to it (mirrors the API's `resolveBindings`, which refuses to guess).
   */
  disabledReason: BindCandidateDisabledReason | null;
};

/** Later timestamp wins; unparseable dates lose to parseable ones (defensive — the API sorts anyway). */
function isNewer(candidate: string, incumbent: string | null): boolean {
  if (incumbent === null) return true;
  const a = Date.parse(candidate);
  const b = Date.parse(incumbent);
  if (Number.isNaN(a)) return false;
  if (Number.isNaN(b)) return true;
  return a > b;
}

/**
 * Derive the picker rows: one {@link BindCandidate} per registered server, sorted by name (then id
 * for same-name stability). `boundNames` are the names currently declared in the frontmatter (the
 * chips) — trimmed before comparison, matching the manifest parser's normalization.
 */
export function deriveBindCandidates(
  servers: readonly BindServerInfo[],
  scans: readonly BindScanInfo[],
  boundNames: readonly string[],
): BindCandidate[] {
  const bound = new Set(boundNames.map((name) => name.trim()).filter((name) => name !== ""));

  const nameCounts = new Map<string, number>();
  for (const server of servers) {
    nameCounts.set(server.name, (nameCounts.get(server.name) ?? 0) + 1);
  }

  const latestByServer = new Map<string, BindScanInfo>();
  const latestSuccessByServer = new Map<string, BindScanInfo>();
  for (const scan of scans) {
    const newest = latestByServer.get(scan.serverId);
    if (isNewer(scan.scannedAt, newest?.scannedAt ?? null)) latestByServer.set(scan.serverId, scan);
    if (scan.status === "success") {
      const newestSuccess = latestSuccessByServer.get(scan.serverId);
      if (isNewer(scan.scannedAt, newestSuccess?.scannedAt ?? null)) {
        latestSuccessByServer.set(scan.serverId, scan);
      }
    }
  }

  return servers
    .map((server): BindCandidate => {
      const latest = latestByServer.get(server.id) ?? null;
      const latestSuccess = latestSuccessByServer.get(server.id) ?? null;
      const disabledReason: BindCandidateDisabledReason | null = bound.has(server.name.trim())
        ? "already-bound"
        : (nameCounts.get(server.name) ?? 0) > 1
          ? "ambiguous-name"
          : null;
      return {
        serverId: server.id,
        serverName: server.name,
        transport: server.transport,
        lastScanStatus: latest ? latest.status : null,
        lastScanAt: latest ? latest.scannedAt : null,
        scannedTools: latestSuccess ? latestSuccess.totalTools : null,
        hasCompletedScan: latestSuccess !== null,
        disabledReason,
      };
    })
    .sort(
      (a, b) => a.serverName.localeCompare(b.serverName) || a.serverId.localeCompare(b.serverId),
    );
}

// ── Server-types WP 3.2 (B) — the "Types" section of the picker ────────────────────────────────────

/** The slim type slice the picker needs (a shared `ServerType` always satisfies it). */
export type BindTypeInfo = {
  id: string;
  name: string;
  status: ServerTypeStatus;
  memberCount: number;
};

export type BindTypeCandidateDisabledReason = "already-bound" | "name-collision";

/**
 * One "Types" picker row: a registered server type resolved to its representative member (D-ST3). A
 * type carries no config — binding one writes the TYPE NAME into `servers:`, which the API resolver
 * maps to `representativeId` at read time.
 */
export type BindTypeCandidate = {
  typeId: string;
  typeName: string;
  status: ServerTypeStatus;
  memberCount: number;
  /** The D-ST3 representative member (newest successful scan; tiebreak newest `scanned_at`, id ASC), or
   *  null when no member has a completed success scan. NEVER guessed. */
  representativeId: string | null;
  representativeName: string | null;
  /** True when a representative exists — a member has a completed success scan (tools/scaffold possible). */
  hasRepresentative: boolean;
  /** The representative's success-scan tool count (what binding/scaffold would surface), or null. */
  representativeTools: number | null;
  /**
   * Why this type can't be BOUND, or null when bindable:
   *  - `already-bound` — the type's name is already declared in the frontmatter `servers:` list
   *    (case-insensitive, mirroring the resolver's case-insensitive type match);
   *  - `name-collision` — a registered SERVER shares this exact name, so per WP 3.1 precedence the
   *    frontmatter name resolves to the SERVER (step 2), never the type — binding it would not be a
   *    type binding. This reason ALSO makes the type ineligible to scaffold from.
   * A type with no scanned member is NOT disabled for binding (bind now, tools appear after a scan);
   * the SCAFFOLD surface additionally treats `!hasRepresentative` as ineligible (no tool surface).
   */
  disabledReason: BindTypeCandidateDisabledReason | null;
};

/** D-ST3 representative: among a type's member ids, the one whose newest SUCCESSFUL scan is newest
 *  overall (tiebreak newest `scanned_at`, then server `id` ASC). Mirrors the API's
 *  `pickRepresentativeServer` exactly (ISO timestamps compare lexicographically). */
function pickRepresentative(
  memberIds: readonly string[],
  latestSuccessByServer: ReadonlyMap<string, BindScanInfo>,
): { serverId: string; totalTools: number } | null {
  const candidates: { serverId: string; scannedAt: string; totalTools: number }[] = [];
  for (const id of memberIds) {
    const success = latestSuccessByServer.get(id);
    if (success) candidates.push({ serverId: id, scannedAt: success.scannedAt, totalTools: success.totalTools });
  }
  if (candidates.length === 0) return null;
  candidates.sort((a, b) =>
    a.scannedAt !== b.scannedAt
      ? a.scannedAt < b.scannedAt
        ? 1
        : -1
      : a.serverId < b.serverId
        ? -1
        : a.serverId > b.serverId
          ? 1
          : 0,
  );
  const winner = candidates[0];
  return winner ? { serverId: winner.serverId, totalTools: winner.totalTools } : null;
}

/**
 * Derive the "Types" picker rows: one {@link BindTypeCandidate} per registered server type, sorted by
 * name (then id for stability). Each type resolves to its D-ST3 representative member from the same
 * `servers` × `scans` inputs the server picker uses (membership via `server.typeId`). `boundNames` are
 * the names already declared in the frontmatter — a type whose name matches one (case-insensitive) is
 * `already-bound`; a type whose name is ALSO a registered server name is `name-collision` (the resolver
 * would bind the server, not the type — WP 3.1 precedence).
 */
export function deriveBindTypeCandidates(
  types: readonly BindTypeInfo[],
  servers: readonly BindServerInfo[],
  scans: readonly BindScanInfo[],
  boundNames: readonly string[],
): BindTypeCandidate[] {
  const boundLower = new Set(
    boundNames.map((name) => name.trim().toLowerCase()).filter((name) => name !== ""),
  );
  // Exact registered-server names (case-sensitive — the resolver's step 2 matches exactly).
  const serverNames = new Set(servers.map((server) => server.name));
  const serverNameById = new Map(servers.map((server) => [server.id, server.name] as const));

  // Newest SUCCESS scan per server (same selection as the server picker / the API resolver).
  const latestSuccessByServer = new Map<string, BindScanInfo>();
  for (const scan of scans) {
    if (scan.status !== "success") continue;
    const incumbent = latestSuccessByServer.get(scan.serverId);
    if (isNewer(scan.scannedAt, incumbent?.scannedAt ?? null)) {
      latestSuccessByServer.set(scan.serverId, scan);
    }
  }

  // Member ids per type (from each server's typeId).
  const memberIdsByType = new Map<string, string[]>();
  for (const server of servers) {
    if (!server.typeId) continue;
    const list = memberIdsByType.get(server.typeId) ?? [];
    list.push(server.id);
    memberIdsByType.set(server.typeId, list);
  }

  return types
    .map((type): BindTypeCandidate => {
      const rep = pickRepresentative(memberIdsByType.get(type.id) ?? [], latestSuccessByServer);
      const disabledReason: BindTypeCandidateDisabledReason | null = boundLower.has(
        type.name.trim().toLowerCase(),
      )
        ? "already-bound"
        : serverNames.has(type.name)
          ? "name-collision"
          : null;
      return {
        typeId: type.id,
        typeName: type.name,
        status: type.status,
        memberCount: type.memberCount,
        representativeId: rep?.serverId ?? null,
        representativeName: rep ? (serverNameById.get(rep.serverId) ?? null) : null,
        hasRepresentative: rep !== null,
        representativeTools: rep?.totalTools ?? null,
        disabledReason,
      };
    })
    .sort((a, b) => a.typeName.localeCompare(b.typeName) || a.typeId.localeCompare(b.typeId));
}
