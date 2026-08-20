// The security-posture endpoints (planning/Roadmap/RM-20-security-posture/):
//
//   GET /api/scans/:scanId/security                       → `SecurityReport`      (WP 1.2)
//   GET /api/skills/:id/versions/:vid/security            → `SecurityReport`      (WP 1.3)
//   GET /api/scans/:scanId/security/diff?baseline=        → `SecurityPostureDiff` (WP 1.4)
//   GET /api/skills/:id/versions/:vid/security/diff?baseline=
//                                                         → `SecurityPostureDiff` (WP 1.4)
//   GET /api/security/summary                             → `SecurityFleetSummary[]` (WP 2.1)
//
// Thin, per the API convention: read the params, delegate, let the central error handler format
// anything thrown (a repository's 404 for an unknown id, the service's D-SP10 400 for a non-`success`
// scan, its D-SP16 400 for an unreadable SKILL.md, WP 1.4's 400 for a pairing that cannot mean
// anything, and a `ZodError` → 400 for a missing `?baseline=`). Read-only — they open no MCP
// connection, run no scan, execute no skill, write nothing, persist nothing (D-SP8) and return no
// secret value.
//
// A diff route is deliberately a **sub-path of the report it diffs** (`…/security/diff`) rather than
// a route of its own: the subject in the path is the thing being asked about, and the baseline is a
// query parameter because it is an argument to the question, not a second subject. That also means
// the diff surface needs no port the report surface did not already have — `apps/api/src/index.ts` is
// untouched by this WP.
//
// The one thing this file adds on top of the services is a LOGGER for a rule that threw on a
// malformed definition. The analyzers are pure by construction (D-SP7) and so have no logger of their
// own; the route is the first layer that has one, so it passes a callback down rather than letting a
// swallowed exception become a blind spot nobody can see.
//
// The skill route's params are **`:id` / `:vid`**, byte-identical to every sibling in
// `apps/api/src/skills/routes.ts` — same path shape, same names, no ambiguity for anyone reading the
// two files side by side.

import type { FastifyInstance } from "fastify";
import { securityDiffQuerySchema } from "@mcp-token-footprint/shared";
import {
  type SecurityAnalyzerPorts,
  type SecurityFleetPorts,
  type SecuritySkillPorts,
  analyzeScan,
  analyzeSkillVersion,
  diffScanPosture,
  diffSkillPosture,
  summarizeFleetPosture,
} from "./service.js";

/**
 * The scan ports, plus the skill ports **optionally**.
 *
 * The skills port is optional rather than required on purpose. `apps/api/test/security-analyzer.test.ts`
 * constructs this object as `{ scans, servers, oauth }` and is D-SP14's proof that WP 1.3's extraction
 * preserved WP 1.2's behaviour — it has to stay byte-identical, so the port could only be added
 * additively. `apps/api/src/index.ts` always supplies it; a caller that wires only scan posture
 * simply does not get the skill route, which is the honest outcome rather than a route that 500s.
 */
export type SecurityRoutePorts = SecurityAnalyzerPorts &
  Partial<Pick<SecuritySkillPorts, "skills">> & {
    /**
     * WP 2.1 — the fleet summary's one extra read, **optional for the same reason `skills` is**.
     * `apps/api/test/security-analyzer.test.ts` hands this function a hand-built `scans` stub with
     * only `getDetail` on it and has to stay byte-identical (D-SP14's proof), so the port could only
     * be added additively. A caller that does not supply it simply does not get the summary route,
     * which beats a route that 500s on its first request.
     */
    scans: SecurityAnalyzerPorts["scans"] &
      Partial<Pick<SecurityFleetPorts["scans"], "listSummariesByServer">>;
  };

/** Narrow to {@link SecurityFleetPorts} without rebuilding the ports object — a spread would copy a
 *  repository's own fields and drop its prototype methods, which is a runtime failure the types
 *  would not catch. */
function hasFleetPort(ports: SecurityRoutePorts): ports is SecurityRoutePorts & SecurityFleetPorts {
  return typeof ports.scans.listSummariesByServer === "function";
}

export async function registerSecurityRoutes(app: FastifyInstance, ports: SecurityRoutePorts) {
  app.get("/api/scans/:scanId/security", async (request) => {
    const { scanId } = request.params as { scanId: string };
    return analyzeScan(
      {
        ...ports,
        onRuleError: (ruleId, error) => {
          request.log.warn(
            { ruleId, scanId, err: error },
            "security rule threw on a malformed tool definition; it contributed no finding",
          );
        },
      },
      scanId,
    );
  });

  // WP 1.4 — the same subject, measured against a NAMED baseline scan of the same server. The
  // baseline is never inferred: resolving "the previous scan" would need a scan-history read these
  // ports deliberately do not carry, and a baseline that quietly moved between two runs would answer
  // the same question two different ways.
  app.get("/api/scans/:scanId/security/diff", async (request) => {
    const { scanId } = request.params as { scanId: string };
    const { baseline } = securityDiffQuerySchema.parse(request.query);
    return diffScanPosture(
      {
        ...ports,
        onRuleError: (ruleId, error) => {
          request.log.warn(
            { ruleId, scanId, baselineScanId: baseline, err: error },
            "security rule threw on a malformed tool definition; it contributed no finding",
          );
        },
      },
      scanId,
      baseline,
    );
  });

  // WP 2.1 (D-SP22) — ONE request for the whole servers list. Not `/api/servers/:id/security`
  // repeated per row: a fleet of forty servers would be forty requests every time the rail paints.
  // The path is a sibling of the per-scan report rather than a sub-path of it, because its subject
  // is the fleet, not any one scan.
  if (hasFleetPort(ports)) {
    app.get("/api/security/summary", async (request) =>
      summarizeFleetPosture({
        ...ports,
        onRuleError: (ruleId, error) => {
          request.log.warn(
            { ruleId, err: error },
            "security rule threw on a malformed tool definition; it contributed no finding",
          );
        },
      }),
    );
  }

  const skills = ports.skills;
  if (skills === undefined) return;

  app.get("/api/skills/:id/versions/:vid/security", async (request) => {
    const { id, vid } = request.params as { id: string; vid: string };
    return analyzeSkillVersion(
      {
        skills,
        ...(ports.now === undefined ? {} : { now: ports.now }),
        onRuleError: (ruleId, error) => {
          request.log.warn(
            { ruleId, skillId: id, versionId: vid, err: error },
            "security rule threw on a malformed skill version; it contributed no finding",
          );
        },
      },
      id,
      vid,
    );
  });

  // WP 1.4 — two versions of the SAME skill. Both sides are analysed under the `:id` in the path, so
  // a `?baseline=` naming a version of another skill is a 404 from the service rather than a diff
  // reported under this skill's name.
  app.get("/api/skills/:id/versions/:vid/security/diff", async (request) => {
    const { id, vid } = request.params as { id: string; vid: string };
    const { baseline } = securityDiffQuerySchema.parse(request.query);
    return diffSkillPosture(
      {
        skills,
        ...(ports.now === undefined ? {} : { now: ports.now }),
        onRuleError: (ruleId, error) => {
          request.log.warn(
            { ruleId, skillId: id, versionId: vid, baselineVersionId: baseline, err: error },
            "security rule threw on a malformed skill version; it contributed no finding",
          );
        },
      },
      id,
      vid,
      baseline,
    );
  });
}
