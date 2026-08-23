// `GET /api/data-pack` and `POST /api/data-pack/refresh` (RM-38 WP 3.2).
//
// Two routes, ONE payload shape. The refresh answers with the status AFTER the check, so the caller
// never has to issue a second request to find out what happened — and, more importantly, cannot see
// a version and a check outcome that came from two different moments.
//
// SCOPES — checked against the real table rather than assumed. `requiredScopesForMethod("POST")`
// answers `API_TOKEN_EXECUTE_SCOPES`, so a token-authenticated caller would need `scan:run`,
// `runs:launch` or `suites:run` to refresh. That is the right answer and it is deliberately left
// alone: a refresh reaches out to the network and REPLACES the data every verdict in this install is
// computed against, which is a heavier act than a read even though it creates no row. Relaxing it
// through `API_TOKEN_ROUTE_SCOPES` (the only direction that table can move) would hand a read-only
// token the ability to change what the CI gate says. A LOOPBACK caller — the browser UI — passes
// without a token exactly as it does everywhere else (D-C2), which is what the Settings button uses.
//
// NO FEATURE FLAG. The pack is always resolved; only the FETCH is switchable, and that switch is
// `DATA_PACK_CHECK_ON_START` / `DATA_PACK_URL` from WP 3.1. A flag over a read of the version in
// force would be an off-switch on the app's ability to say what data it is running.

import type { FastifyInstance } from "fastify";
import { config } from "../config/env.js";
import { refreshDataPack } from "./fetcher.js";
import { resolveDataPackFromDisk } from "./resolve.js";
import { getDataPack, installDataPackSource } from "./source.js";
import { recordDataPackCheck } from "./state.js";
import { buildDataPackStatus } from "./status.js";
import { installSecurityTables } from "@mcp-token-footprint/shared";

/**
 * The check's own configuration, injectable so a test can exercise this route without opening a
 * socket to the real release host. Production passes nothing and reads `config`, which is the only
 * place these three values are resolved.
 */
export type DataPackRouteConfig = {
  url: string;
  enabled: boolean;
  timeoutMs: number;
  dataDirectory: string;
};

export function registerDataPackRoutes(
  app: FastifyInstance,
  overrides?: Partial<DataPackRouteConfig>,
): void {
  const settings = (): DataPackRouteConfig => ({
    url: overrides?.url ?? config.dataPackUrl,
    enabled: overrides?.enabled ?? config.dataPackCheckOnStart,
    timeoutMs: overrides?.timeoutMs ?? config.dataPackTimeoutMs,
    dataDirectory: overrides?.dataDirectory ?? config.dataDirectory,
  });

  app.get("/api/data-pack", async () => buildDataPackStatus());

  app.post("/api/data-pack/refresh", async () => {
    const current = settings();
    const inForce = getDataPack();
    // The D-DP6 ledger anchor is always the BUNDLED snapshot, never the pack in force — an anchor
    // that moved with each accepted pack would let a chain of packs walk the rule-id ledger
    // anywhere, one small append at a time. `resolveDataPackFromDisk` hands back both; it re-reads
    // the bundled tree, which costs a few milliseconds on an operator-initiated action and keeps
    // this route from having to cache a second pack object for the life of the process.
    const resolution = resolveDataPackFromDisk();
    const result = await refreshDataPack({
      url: current.url,
      enabled: current.enabled,
      timeoutMs: current.timeoutMs,
      dataDirectory: current.dataDirectory,
      inForce,
      bundled: resolution.bundled,
    });
    recordDataPackCheck(result.outcome);
    if (result.outcome.status === "installed" && result.pack) {
      // Both, in the same breath, for the reason WP 2.1 installed them together in `index.ts`: the
      // pack and the security tables must never name different versions.
      installDataPackSource(result.pack);
      installSecurityTables(result.pack.documents.securityTables);
      app.log.info(
        {
          packVersion: result.outcome.remoteVersion,
          previousVersion: result.outcome.currentVersion,
          files: result.outcome.files,
        },
        "Reference data pack refreshed on demand",
      );
    }
    return buildDataPackStatus();
  });
}
