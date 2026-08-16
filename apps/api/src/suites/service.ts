import type { Suite, SuiteInput } from "@mcp-token-footprint/shared";
import { suiteInputSchema } from "@mcp-token-footprint/shared";
import type { SuiteRepository } from "./repository.js";

/**
 * Thin orchestration over {@link SuiteRepository} (mirrors {@link ScenarioService}). Routes call this;
 * the repository owns SQL. Input is validated against `suiteInputSchema` before it reaches the
 * repository; a missing id 404s from the repository. The suite-run orchestrator is WP 3.2.
 */
export class SuiteService {
  constructor(private readonly suites: SuiteRepository) {}

  list(): Suite[] {
    return this.suites.list();
  }

  get(id: string): Suite {
    return this.suites.get(id);
  }

  create(input: SuiteInput): Suite {
    return this.suites.create(suiteInputSchema.parse(input));
  }

  update(id: string, input: SuiteInput): Suite {
    return this.suites.update(id, suiteInputSchema.parse(input));
  }

  delete(id: string): void {
    this.suites.delete(id);
  }
}
