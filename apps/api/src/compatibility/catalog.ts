// Loads + types the bundled compatibility test catalog (the source of truth for the rules; the
// research file planning/Research/RS-01-token-context-comparison/outputs/tests/test-catalog.json, copied to ./data by
// `pnpm build:model-data`). The engine never hand-authors test logic — it reads this.

import { readFileSync } from "node:fs";
import type {
  CompatibilityLevel,
  CompatibilitySeverity,
  CompatibilityVerdict,
} from "@mcp-token-footprint/shared";

export type CatalogModelSeverityRule = {
  when: string;
  severity: CompatibilitySeverity | "na";
  failure_mode: string;
  consequence: string;
  evidence_fields: string[];
  rationale_template: string;
};

export type CatalogModelSeverity = {
  variant: boolean;
  default: CompatibilitySeverity | "na";
  rules?: CatalogModelSeverityRule[];
};

export type CatalogThreshold = {
  source: string | null;
  compare: string;
  fallback?: unknown;
  computed?: string;
  warn_at?: number | string;
  fail_at?: number | string;
};

export type CatalogTest = {
  id: string;
  tech_name: string;
  /** Names the CHECK, for the checks list. */
  user_facing_name: string;
  /**
   * Names the FINDING, for a findings list — the same check phrased as the problem it found
   * (RM-37 WP 0.5, action 7). Required: every catalog entry carries one, so a findings surface can
   * never silently fall back to the check name.
   */
  finding_name: string;
  level: CompatibilityLevel;
  scope: "per_tool" | "per_server" | "aggregate";
  category: string;
  data_phase: "static" | "runtime";
  execution_mode: "static_connection" | "single_tool_exec" | "live_session";
  what_it_does: string;
  measured: { expr: string; inputs: string[]; unit: string };
  threshold: CatalogThreshold;
  applies_to: { rule: string; capability_field: string | null; models_note?: string };
  verdict_bands: Record<string, string | null>;
  severity: CompatibilitySeverity;
  maps_to_scan_event_level: string;
  extends_existing: string | null;
  recommendation: string;
  references: Record<string, unknown>;
  impact: {
    failure_mode: string;
    what_happens: string;
    blast_radius: string;
    recoverability: string;
  };
  model_severity: CatalogModelSeverity;
};

export type Catalog = {
  catalog_version: string;
  as_of: string;
  verdicts: CompatibilityVerdict[];
  severities: CompatibilitySeverity[];
  scoring: {
    weights: Record<CompatibilitySeverity, number>;
    verdict_value: Record<"pass" | "warn" | "fail", number>;
    cell_score: string;
    gate: string;
    bands: Record<string, string>;
  };
  verdict_to_scan_event_level: Record<string, string>;
  tests: CatalogTest[];
};

const catalog = JSON.parse(
  readFileSync(new URL("./data/test-catalog.json", import.meta.url), "utf8"),
) as Catalog;

export function getCatalog(): Catalog {
  return catalog;
}

export function getTest(id: string): CatalogTest | undefined {
  return catalog.tests.find((t) => t.id === id);
}
