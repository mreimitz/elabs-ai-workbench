// The security-posture endpoints (roadmap/security-posture/):
//
//   GET /api/scans/:scanId/security                  → `SecurityReport`   (WP 1.2)
//   GET /api/skills/:id/versions/:vid/security       → `SecurityReport`   (WP 1.3)
//
// Thin, per the API convention: read the params, delegate, let the central error handler format
// anything thrown (a repository's 404 for an unknown id, the service's D-SP10 400 for a non-`success`
// scan, its D-SP16 400 for an unreadable SKILL.md). Read-only — they open no MCP connection, run no
// scan, execute no skill, write nothing, persist nothing (D-SP8) and return no secret value.
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
import {
  type SecurityAnalyzerPorts,
  type SecuritySkillPorts,
  analyzeScan,
  analyzeSkillVersion,
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
  Partial<Pick<SecuritySkillPorts, "skills">>;

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
}
