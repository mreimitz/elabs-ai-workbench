// Per-model severity resolver — faithful TypeScript port of the research reference
// planning/Research/RS-01-token-context-comparison/outputs/tests/resolve_model_severity.py (Decision 2). A fixture-parity
// test (compatibility-resolve.test.ts) reproduces the Python demo output exactly so the two stay in
// lockstep.
//
// Deliberately matches the reference DSL: predicates are SINGLE-CLAUSE only (no && / ||), and the
// `is_scorable` na-gate is the same coarse substring check (any test whose JSON mentions
// "context_window_tokens" is `na` for a model with no documented window).

import type { CompatibilityEvidence, CompatibilitySeverity } from "@mcp-token-footprint/shared";
import type { CatalogTest } from "./catalog.js";
import type { FlatModel } from "@mcp-token-footprint/shared";
import { getCrossCutting, getModel } from "./dataset.js";

export type ResolvedSeverity = {
  severity: CompatibilitySeverity | "na";
  consequence: string;
  rationale: string;
  evidence: CompatibilityEvidence[];
};

/** Walk a dotted path through nested objects (mirror of the reference `getpath`). */
function getPath(obj: unknown, dotted: string): unknown {
  let cur: unknown = obj;
  for (const seg of dotted.split(".")) {
    if (cur && typeof cur === "object" && seg in (cur as Record<string, unknown>)) {
      cur = (cur as Record<string, unknown>)[seg];
    } else {
      return undefined;
    }
  }
  return cur;
}

function crossPath(field: string, targetClient?: string): string {
  // strip the leading "cross." and substitute <target>
  return field.slice("cross.".length).replace("<target>", targetClient ?? "");
}

/** Provenance bundle for an evidence field path (mirror of `resolve_field`). */
function resolveField(row: FlatModel, field: string, targetClient?: string): CompatibilityEvidence {
  if (field.startsWith("cross.")) {
    const v = getPath(getCrossCutting(), crossPath(field, targetClient));
    // Show the resolved client in the field label (e.g. `cross.clients.cursor.max_tools`), not the
    // raw `<target>` placeholder the catalog rule carries — the value is already client-specific.
    const displayField = targetClient ? field.split("<target>").join(targetClient) : field;
    return { field: displayField, value: toEvidenceValue(v), sourceUrl: null, confidence: "n/a" };
  }
  const node = getPath(row.detail, field);
  if (node && typeof node === "object") {
    const n = node as Record<string, unknown>;
    return {
      field,
      value: toEvidenceValue(n.value),
      sourceUrl: (n.source_url as string | null | undefined) ?? undefined,
      sourceTier: typeof n.source_tier === "number" ? n.source_tier : undefined,
      confidence: (n.confidence as CompatibilityEvidence["confidence"]) ?? undefined,
    };
  }
  return { field, value: toEvidenceValue(node) };
}

function toEvidenceValue(v: unknown): string | number | boolean | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") return v;
  return String(v);
}

const RE_PROVIDER = /^provider\.id (==|!=) (\S+)$/;
const RE_EXISTS = /^model\.([\w.]+)\.value (exists|absent)$/;
const RE_NUMERIC = /^model\.([\w.]+)\.value (<=|>=|<|>) (\d+)$/;

/** Single-clause predicate DSL (mirror of `predicate`; intentionally no && / ||). */
export function predicate(row: FlatModel, when: string, targetClient?: string): boolean {
  let m = RE_PROVIDER.exec(when);
  // Supports both `==` and `!=`; `!=` rules (e.g. `provider.id != openai → low`) previously fell
  // through to `false` and silently took the test's default severity / rationale.
  if (m) return m[1] === "==" ? row.provider_id === m[2] : row.provider_id !== m[2];

  m = RE_EXISTS.exec(when);
  if (m) {
    const v = getPath(row.detail, `${m[1]}.value`);
    return m[2] === "exists" ? v !== null && v !== undefined : v === null || v === undefined;
  }

  m = RE_NUMERIC.exec(when);
  if (m) {
    const v = getPath(row.detail, `${m[1]}.value`);
    if (typeof v !== "number") return false;
    const n = Number(m[3]);
    switch (m[2]) {
      case "<":
        return v < n;
      case "<=":
        return v <= n;
      case ">":
        return v > n;
      case ">=":
        return v >= n;
    }
  }

  if (when.startsWith("cross.") && when.endsWith("exists")) {
    const path = crossPath(when.split(" ")[0] ?? when, targetClient);
    return (
      getPath(getCrossCutting(), path) !== undefined && getPath(getCrossCutting(), path) !== null
    );
  }
  return false;
}

/** Fill {provider} + {dotted.path} placeholders (mirror of `fill`). */
export function fill(template: string, row: FlatModel, targetClient?: string): string {
  let s = template.replace(/\{provider\}/g, row.provider_name);
  for (const ph of s.match(/\{([\w.<>-]+)\}/g) ?? []) {
    const key = ph.slice(1, -1);
    if (key === "provider") continue;
    const val = key.startsWith("cross.")
      ? getPath(getCrossCutting(), crossPath(key, targetClient))
      : getPath(row.detail, `${key}.value`);
    let rendered: string;
    if (val === null || val === undefined) rendered = "(undocumented)";
    else if (typeof val === "number" && Number.isInteger(val))
      rendered = val.toLocaleString("en-US");
    else rendered = String(val);
    s = s.split(ph).join(rendered);
  }
  return s;
}

/** A model with no documented context window can't be meaningfully window-scored (mirror). */
export function isScorable(modelId: string): boolean {
  const row = getModel(modelId);
  if (!row) return false;
  const cw = getPath(row.detail, "context.context_window_tokens.value");
  return cw !== null && cw !== undefined;
}

/** Resolve { severity, consequence, rationale, evidence } for (test, model) (mirror of `resolve`). */
export function resolveSeverity(
  test: CatalogTest,
  modelId: string,
  targetClient?: string,
): ResolvedSeverity {
  const row = getModel(modelId);
  if (!row) {
    return {
      severity: "na",
      consequence: "unknown model",
      rationale: "model not in dataset",
      evidence: [],
    };
  }
  const ms = test.model_severity;

  // MIN-1: window-dependent tests can't be scored for models with no documented context window.
  // Gate ONLY on the test's PRIMARY measure (`measured.inputs`), not a blind substring scan of the
  // whole test JSON. The old scan also tripped for tests that merely cite the window inside an
  // unrelated fallback rule's evidence (e.g. ENV_AGGREGATE_TOOL_COUNT's "uncapped-provider" branch),
  // which silently coerced a window-INDEPENDENT binding cap (a hard tool-count blocker) to `na` for
  // windowless models — dropping it from scoreCell so the cell never red-gated.
  if (
    !isScorable(modelId) &&
    test.measured.inputs.includes("model.context.context_window_tokens")
  ) {
    return {
      severity: "na",
      consequence: "insufficient data",
      rationale: "insufficient data — no documented context window for this model",
      evidence: [],
    };
  }

  if (!ms.variant) {
    return {
      severity: ms.default,
      consequence: test.impact.what_happens,
      rationale: `(model-invariant) ${test.impact.what_happens}`,
      evidence: [],
    };
  }

  for (const rule of ms.rules ?? []) {
    if (predicate(row, rule.when, targetClient)) {
      return {
        severity: rule.severity,
        consequence: rule.consequence,
        rationale: fill(rule.rationale_template, row, targetClient),
        evidence: rule.evidence_fields.map((f) => resolveField(row, f, targetClient)),
      };
    }
  }

  return {
    severity: ms.default,
    consequence: test.impact.what_happens,
    rationale: "(default — no rule matched)",
    evidence: [],
  };
}
