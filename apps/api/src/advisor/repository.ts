// The advisor's read-model composition root (WP 1.2).
//
// This is the ONE place that binds the app's concrete repositories to the advisor's narrow read
// ports. Rules never import a repository, never see a `Database`, and never touch the secret store —
// they receive an {@link AdvisorContext} and can only read what these ports expose
// (roadmap/advisor/conventions.md, runtime boundary).
//
// It is called `repository.ts` because it is the advisor's data-access layer; there is deliberately
// no SQL of its own. Everything the advisor reads is already persisted and already has a repository
// that owns its queries — re-querying those tables here would duplicate (and eventually contradict)
// them.

import type { AdvisorContext } from "./types.js";
import type {
  AdvisorRunPort,
  AdvisorScanPort,
  AdvisorScenarioPort,
  AdvisorServerPort,
} from "./types.js";

/**
 * The four repositories the advisor reads. Typed as the PORTS, not as the concrete classes, so this
 * file compiles against the narrow slice; the real `ServerRepository` / `ScanRepository` /
 * `ScenarioRepository` / `RunRepository` satisfy them structurally at the call site in `index.ts`
 * (and `advisor-engine.test.ts` pins that structural conformance at compile time).
 */
export type AdvisorRepositories = {
  servers: AdvisorServerPort;
  scans: AdvisorScanPort;
  scenarios: AdvisorScenarioPort;
  runs: AdvisorRunPort;
};

/**
 * Builds the context a report is computed over.
 *
 * `now` is injected rather than read inside the engine so a report is reproducible: the same inputs
 * under the same clock produce byte-identical output, `generatedAt` included. Production passes the
 * real clock (the default); tests pass a fixed one.
 */
export function createAdvisorContext(
  repositories: AdvisorRepositories,
  now: () => Date = () => new Date(),
): AdvisorContext {
  return {
    servers: repositories.servers,
    scans: repositories.scans,
    scenarios: repositories.scenarios,
    runs: repositories.runs,
    now,
  };
}
