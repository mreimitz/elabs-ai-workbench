// The advisor service (WP 1.2): resolve the requested scope against real, persisted entities, then
// hand it to the deterministic engine.
//
// Resolution happens HERE rather than inside a rule for two reasons: an unknown id must answer 404
// once (not once per rule), and a rule that has to defend itself against a non-existent entity would
// be tempted to report an empty result instead of an error — which would look to an operator like
// "nothing to advise" rather than "that id does not exist".

import type { AdvisorReport, AdvisorReportQuery, AdvisorScope } from "@mcp-token-footprint/shared";
import { httpError } from "../utils/errors.js";
import { runAdvisor, type RunAdvisorOptions } from "./engine.js";
import type { AdvisorContext } from "./types.js";

/**
 * Turns a validated query into a scope whose id is known to exist.
 *
 * The repositories' own `get`/`getPublic` are the existence check — they already throw a 404 for an
 * unknown id, and reusing them means the advisor can never disagree with the rest of the app about
 * whether a server/environment exists.
 */
export function resolveAdvisorScope(ctx: AdvisorContext, query: AdvisorReportQuery): AdvisorScope {
  if (query.scope === "fleet") return { kind: "fleet" };

  const id = query.id;
  // Unreachable through the route (the zod schema requires an id for a scoped report), but a direct
  // caller must not be able to turn a scoped request into a silent fleet-wide one.
  if (id === undefined) {
    throw httpError(400, `The ${query.scope} scope requires an id`);
  }

  if (query.scope === "server") {
    ctx.servers.getPublic(id); // throws 404 "Server not found"
    return { kind: "server", id };
  }

  ctx.scenarios.get(id); // throws 404 "Scenario not found"
  return { kind: "scenario", id };
}

/** `GET /api/advisor/report` end to end: resolve → run every applicable rule → stamped report. */
export function buildAdvisorReport(
  ctx: AdvisorContext,
  query: AdvisorReportQuery,
  options: RunAdvisorOptions = {},
): AdvisorReport {
  return runAdvisor(ctx, resolveAdvisorScope(ctx, query), options);
}
