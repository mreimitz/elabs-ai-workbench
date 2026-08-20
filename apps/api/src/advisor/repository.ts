// The advisor's read-model composition root (WP 1.2).
//
// This is the ONE place that binds the app's concrete repositories to the advisor's narrow read
// ports. Rules never import a repository, never see a `Database`, and never touch the secret store —
// they receive an {@link AdvisorContext} and can only read what these ports expose
// (planning/Roadmap/RM-01-advisor/conventions.md, runtime boundary).
//
// It is called `repository.ts` because it is the advisor's data-access layer; there is deliberately
// no SQL of its own. Everything the advisor reads is already persisted and already has a repository
// that owns its queries — re-querying those tables here would duplicate (and eventually contradict)
// them.

import { getModel } from "../compatibility/dataset.js";
import type { AdvisorContext } from "./types.js";
import type {
  AdvisorGradePort,
  AdvisorModelPort,
  AdvisorRunPort,
  AdvisorScanPort,
  AdvisorScenarioPort,
  AdvisorServerPort,
  AdvisorSkillPort,
  AdvisorSuiteRunPort,
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
  // WP 2.1 — the graded side. Same discipline: typed as the narrow ports, satisfied structurally by
  // `GradeRepository` / `SuiteRunRepository` / `SkillRepository` at the `index.ts` call site.
  grades: AdvisorGradePort;
  suiteRuns: AdvisorSuiteRunPort;
  skills: AdvisorSkillPort;
};

/**
 * WP 2.1 — the model-limits port over the bundled compatibility dataset (static JSON, no DB).
 *
 * A separate builder rather than a member of {@link AdvisorRepositories} because it is not a
 * repository: it is the compatibility engine's own lookup, adapted to the three fields a rule may
 * read. `contextWindowTokens` stays `null` when the dataset carries no window — an UNKNOWN limit is
 * never flattened to `0`, which a rule would read as "this model has no room" (invariant 3).
 */
export function createAdvisorModelPort(
  lookup: (modelId: string) => ReturnType<typeof getModel> = getModel,
): AdvisorModelPort {
  return {
    get(modelId) {
      const model = lookup(modelId);
      if (!model) return null;
      return {
        id: model.model_id,
        displayName: model.display_name ?? model.model_id,
        contextWindowTokens: model.context_window_tokens,
      };
    },
  };
}

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
  models: AdvisorModelPort = createAdvisorModelPort(),
): AdvisorContext {
  return {
    servers: repositories.servers,
    scans: repositories.scans,
    scenarios: repositories.scenarios,
    runs: repositories.runs,
    grades: repositories.grades,
    suiteRuns: repositories.suiteRuns,
    skills: repositories.skills,
    models,
    now,
  };
}
