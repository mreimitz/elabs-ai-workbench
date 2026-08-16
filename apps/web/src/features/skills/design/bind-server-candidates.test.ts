import { describe, expect, test } from "vitest";
import type { ServerTypeStatus } from "@mcp-token-footprint/shared";
import {
  deriveBindCandidates,
  deriveBindTypeCandidates,
  type BindTypeInfo,
} from "./bind-server-candidates";

// Behaviour lock for the bind-picker derivation (Skill Studio WP 7.3a): scan-state annotation,
// already-bound / ambiguous-name disabling (mirroring the API resolver's refusal to guess), and a
// stable name sort.

const servers = [
  { id: "s-files", name: "files", transport: "stdio" },
  { id: "s-qlik", name: "qlik-cloud", transport: "streamable_http" },
  { id: "s-fresh", name: "brand-new", transport: "stdio" },
];

const scans = [
  // files: an older success, then a newer FAILED scan → latest=failed, but a completed scan exists.
  { serverId: "s-files", status: "success", scannedAt: "2026-07-01T10:00:00.000Z", totalTools: 12 },
  { serverId: "s-files", status: "failed", scannedAt: "2026-07-02T10:00:00.000Z", totalTools: 0 },
  // qlik-cloud: two successes → the NEWEST success wins the tool count.
  { serverId: "s-qlik", status: "success", scannedAt: "2026-06-01T00:00:00.000Z", totalTools: 5 },
  { serverId: "s-qlik", status: "success", scannedAt: "2026-06-20T00:00:00.000Z", totalTools: 8 },
  // brand-new: never scanned.
];

describe("deriveBindCandidates", () => {
  test("annotates latest scan status, completed-scan flag, and success tool count", () => {
    const rows = deriveBindCandidates(servers, scans, []);
    expect(rows.map((row) => row.serverName)).toEqual(["brand-new", "files", "qlik-cloud"]);

    const files = rows.find((row) => row.serverId === "s-files");
    expect(files).toMatchObject({
      lastScanStatus: "failed",
      lastScanAt: "2026-07-02T10:00:00.000Z",
      hasCompletedScan: true,
      scannedTools: 12,
      disabledReason: null,
    });

    const qlik = rows.find((row) => row.serverId === "s-qlik");
    expect(qlik).toMatchObject({
      lastScanStatus: "success",
      scannedTools: 8,
      hasCompletedScan: true,
    });

    const fresh = rows.find((row) => row.serverId === "s-fresh");
    expect(fresh).toMatchObject({
      lastScanStatus: null,
      lastScanAt: null,
      scannedTools: null,
      hasCompletedScan: false,
      disabledReason: null,
    });
  });

  test("already-declared names are disabled (trimmed comparison)", () => {
    const rows = deriveBindCandidates(servers, scans, ["  files  ", "unrelated"]);
    expect(rows.find((row) => row.serverId === "s-files")?.disabledReason).toBe("already-bound");
    expect(rows.find((row) => row.serverId === "s-qlik")?.disabledReason).toBeNull();
  });

  test("duplicate registered names are ALL disabled as ambiguous (the resolver never guesses)", () => {
    const dupes = [
      { id: "a", name: "twin", transport: "stdio" },
      { id: "b", name: "twin", transport: "streamable_http" },
      { id: "c", name: "solo", transport: "stdio" },
    ];
    const rows = deriveBindCandidates(dupes, [], []);
    expect(
      rows.filter((row) => row.serverName === "twin").map((row) => row.disabledReason),
    ).toEqual(["ambiguous-name", "ambiguous-name"]);
    expect(rows.find((row) => row.serverName === "solo")?.disabledReason).toBeNull();
    // Same-name rows keep a stable id order.
    expect(rows.map((row) => row.serverId)).toEqual(["c", "a", "b"]);
  });

  test("already-bound wins over ambiguous-name (the chip is the truer state)", () => {
    const dupes = [
      { id: "a", name: "twin", transport: "stdio" },
      { id: "b", name: "twin", transport: "stdio" },
    ];
    const rows = deriveBindCandidates(dupes, [], ["twin"]);
    expect(rows.map((row) => row.disabledReason)).toEqual(["already-bound", "already-bound"]);
  });

  test("no servers → no rows", () => {
    expect(deriveBindCandidates([], scans, ["x"])).toEqual([]);
  });
});

// ── Server-types WP 3.2 (B) — the "Types" picker derivation ────────────────────────────────────────
// D-ST3 representative selection (newest successful scan; tiebreak newest scanned_at, then id ASC),
// the honest no-scanned-member state, name-collision disabling (a same-named server wins per WP 3.1),
// already-bound disabling (case-insensitive), and a stable name sort.

const mkType = (id: string, name: string, status: ServerTypeStatus, memberCount: number): BindTypeInfo => ({
  id,
  name,
  status,
  memberCount,
});

describe("deriveBindTypeCandidates", () => {
  const typeServers = [
    { id: "s-a", name: "Qlik A", transport: "streamable_http", typeId: "t-saas" },
    { id: "s-b", name: "Qlik B", transport: "streamable_http", typeId: "t-saas" },
    { id: "s-solo", name: "solo", transport: "stdio", typeId: null },
  ];
  const types = [mkType("t-saas", "Qlik-SaaS", "production", 2)];

  test("resolves the representative = the member with the NEWEST successful scan (D-ST3)", () => {
    const scansIn = [
      { serverId: "s-a", status: "success", scannedAt: "2026-01-01T00:00:00.000Z", totalTools: 5 },
      { serverId: "s-b", status: "success", scannedAt: "2026-01-02T00:00:00.000Z", totalTools: 8 }, // newer
      { serverId: "s-b", status: "failed", scannedAt: "2026-01-09T00:00:00.000Z", totalTools: 0 }, // ignored
    ];
    const [row] = deriveBindTypeCandidates(types, typeServers, scansIn, []);
    expect(row).toMatchObject({
      typeId: "t-saas",
      typeName: "Qlik-SaaS",
      status: "production",
      memberCount: 2,
      representativeId: "s-b",
      representativeName: "Qlik B",
      hasRepresentative: true,
      representativeTools: 8,
      disabledReason: null,
    });
  });

  test("EQUAL scanned_at → the lower server id wins the representative (deterministic tiebreak)", () => {
    const at = "2026-06-06T00:00:00.000Z";
    const scansIn = [
      { serverId: "s-b", status: "success", scannedAt: at, totalTools: 8 },
      { serverId: "s-a", status: "success", scannedAt: at, totalTools: 5 },
    ];
    const [row] = deriveBindTypeCandidates(types, typeServers, scansIn, []);
    expect(row?.representativeId).toBe("s-a"); // "s-a" < "s-b" (string ASC)
  });

  test("a type with NO successful-scan member → null representative (honest, not disabled)", () => {
    const scansIn = [
      { serverId: "s-a", status: "failed", scannedAt: "2026-01-01T00:00:00.000Z", totalTools: 0 },
    ];
    const [row] = deriveBindTypeCandidates(types, typeServers, scansIn, []);
    expect(row).toMatchObject({
      representativeId: null,
      representativeName: null,
      hasRepresentative: false,
      representativeTools: null,
      disabledReason: null, // still BINDABLE (tools appear after a scan) — scaffold gates on hasRepresentative
    });
  });

  test("a type whose name is ALSO a registered server name is disabled as `name-collision`", () => {
    const collidingServers = [
      ...typeServers,
      { id: "s-clash", name: "Qlik-SaaS", transport: "stdio", typeId: null }, // exact same name as the type
    ];
    const scansIn = [
      { serverId: "s-a", status: "success", scannedAt: "2026-01-01T00:00:00.000Z", totalTools: 5 },
    ];
    const [row] = deriveBindTypeCandidates(types, collidingServers, scansIn, []);
    expect(row?.disabledReason).toBe("name-collision");
  });

  test("a type already declared in the frontmatter is disabled `already-bound` (case-insensitive)", () => {
    const scansIn = [
      { serverId: "s-a", status: "success", scannedAt: "2026-01-01T00:00:00.000Z", totalTools: 5 },
    ];
    const [row] = deriveBindTypeCandidates(types, typeServers, scansIn, ["  qlik-saas "]);
    expect(row?.disabledReason).toBe("already-bound");
  });

  test("already-bound wins over name-collision (the truer state)", () => {
    const collidingServers = [
      ...typeServers,
      { id: "s-clash", name: "Qlik-SaaS", transport: "stdio", typeId: null },
    ];
    const [row] = deriveBindTypeCandidates(types, collidingServers, [], ["Qlik-SaaS"]);
    expect(row?.disabledReason).toBe("already-bound");
  });

  test("rows are sorted by type name (then id)", () => {
    const many = [
      mkType("t-2", "Zeta", "beta", 0),
      mkType("t-1", "Alpha", "production", 0),
    ];
    const rows = deriveBindTypeCandidates(many, [], [], []);
    expect(rows.map((row) => row.typeName)).toEqual(["Alpha", "Zeta"]);
  });

  test("no types → no rows", () => {
    expect(deriveBindTypeCandidates([], typeServers, [], [])).toEqual([]);
  });
});
