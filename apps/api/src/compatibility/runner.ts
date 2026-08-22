// The static compatibility engine: for a (scan, model) — and a multi-scan "environment" for the
// aggregate caps — evaluate each catalog test to a verdict, resolve its per-model severity, and roll
// the applicable results up into a heatmap cell (score + green/amber/red band). Covers the 23
// no-run-needed checks (server + environment + tool levels); session/single-exec tests are Phase 2.

import type {
  CompatibilityAffectedTool,
  CompatibilityCell,
  CompatibilityResult,
  CompatibilitySeverity,
  CompatibilityVerdict,
} from "@mcp-token-footprint/shared";
import { bandForScore } from "@mcp-token-footprint/shared";
import { getCatalog, type CatalogTest } from "./catalog.js";
import { getCrossCutting, getModel } from "./dataset.js";
import type { FlatModel } from "@mcp-token-footprint/shared";
import {
  annotationsCoherent,
  countAllProperties,
  countDuplicates,
  descriptionQualityOk,
  followsNamingConvention,
  isObjectSchema,
  matchesToolNamePattern,
  maxEnumLength,
  maxNestingDepth,
  namespacePrefix,
  schemaHasOutputFormat,
  schemaHasPagination,
  unsupportedKeywords,
} from "./evaluators.js";
import { resolveSeverity } from "./resolve.js";

export type ToolInput = {
  toolName: string;
  description?: string;
  descriptionTokens: number;
  totalTokens: number;
  inputSchema?: unknown;
  /** MCP behavior annotations (readOnlyHint/destructiveHint/…), when the scan captured them. */
  annotations?: unknown;
};

export type ScanInput = {
  scanId: string;
  serverName: string;
  totalTools: number;
  totalTokens: number;
  totalRawBytes: number;
  tools: ToolInput[];
};

/** Aggregate across all connected servers (the scope the 128/512/10k caps actually bind). */
export type EnvInput = { totalTools: number; totalTokens: number; totalRawBytes: number };

export type RunOpts = { client?: string };

type Verdict = {
  verdict: CompatibilityVerdict;
  measured: CompatibilityResult["measured"];
  threshold: CompatibilityResult["threshold"];
  /** Per-tool breakdown behind an aggregate server-level measure (offenders / top contributors). */
  affectedTools?: CompatibilityAffectedTool[];
};

const WEIGHTS: Record<CompatibilitySeverity, number> = {
  blocker: 1.0,
  high: 0.7,
  medium: 0.4,
  low: 0.2,
};
const VERDICT_VALUE: Record<"pass" | "warn" | "fail", number> = { pass: 1.0, warn: 0.5, fail: 0.0 };

function getPath(obj: unknown, dotted: string): unknown {
  let cur: unknown = obj;
  for (const seg of dotted.split(".")) {
    if (cur && typeof cur === "object" && seg in (cur as Record<string, unknown>))
      cur = (cur as Record<string, unknown>)[seg];
    else return undefined;
  }
  return cur;
}

/** Resolve a threshold.source path against the model (`model.*`) or cross-cutting (`cross.*`). */
function sourceNumber(source: string | null, model: FlatModel, client?: string): number | null {
  if (!source) return null;
  let node: unknown;
  if (source.startsWith("model.")) node = getPath(model.detail, source.slice("model.".length));
  else if (source.startsWith("cross.")) {
    const path = source
      .slice("cross.".length)
      .replace("<target>", client ?? "")
      .replace("<provider>", model.provider_id);
    node = getPath(getCrossCutting(), path);
  }
  const v =
    node && typeof node === "object" && "value" in (node as Record<string, unknown>)
      ? (node as Record<string, unknown>).value
      : node;
  return typeof v === "number" ? v : null;
}

/** Lower-is-better band: fail at/above failAt, warn at/above warnAt, else pass. */
function bandUpper(value: number, warnAt: number, failAt: number): CompatibilityVerdict {
  if (value >= failAt) return "fail";
  if (value >= warnAt) return "warn";
  return "pass";
}

function passFail(ok: boolean): CompatibilityVerdict {
  return ok ? "pass" : "fail";
}

const VERDICT_RANK: Record<CompatibilityVerdict, number> = { na: -1, pass: 0, warn: 1, fail: 2 };
/** The more severe of two verdicts (fail > warn > pass), for tests with multiple band clauses. */
function worseVerdict(a: CompatibilityVerdict, b: CompatibilityVerdict): CompatibilityVerdict {
  return VERDICT_RANK[a] >= VERDICT_RANK[b] ? a : b;
}

const NA: Verdict = { verdict: "na", measured: { value: null }, threshold: { value: null } };

// --- Per-test static evaluation -----------------------------------------------------------------

function evalServerOrEnv(
  test: CatalogTest,
  scan: ScanInput,
  env: EnvInput,
  model: FlatModel,
  opts: RunOpts,
): Verdict {
  const window = model.context_window_tokens;
  switch (test.id) {
    case "SERVER_TOOL_COUNT_HARD": {
      const cap = sourceNumber(test.threshold.source, model);
      if (cap === null) return NA;
      return {
        verdict: passFail(scan.totalTools <= cap),
        measured: { value: scan.totalTools, unit: "tools" },
        threshold: { value: cap, source: test.threshold.source ?? undefined },
      };
    }
    case "SERVER_TOOL_COUNT_PRACTICAL": {
      const documented = sourceNumber(test.threshold.source, model);
      const limit = documented ?? 40;
      const verdict =
        scan.totalTools > 1.5 * limit ? "fail" : scan.totalTools > limit ? "warn" : "pass";
      // Label honestly: only say "fallback 40" when the model's own practical value wasn't documented.
      const source =
        documented !== null ? "max_tools_practical" : "max_tools_practical (fallback 40)";
      return {
        verdict,
        measured: { value: scan.totalTools, unit: "tools" },
        threshold: { value: limit, source },
      };
    }
    case "SERVER_TOOL_COUNT_CONTEXT": {
      if (window === null || scan.totalTools === 0) return NA;
      const maxOut = model.max_output_tokens_max ?? Math.round(0.25 * window);
      const headroom = Math.max(0, window - Math.min(maxOut, 0.25 * window));
      const avg = scan.totalTokens / scan.totalTools;
      const ceiling = avg > 0 ? Math.floor((headroom * 0.5) / avg) : 0;
      const verdict =
        scan.totalTools > ceiling ? "fail" : scan.totalTools > 0.5 * ceiling ? "warn" : "pass";
      return {
        verdict,
        measured: { value: scan.totalTools, unit: "tools" },
        threshold: { value: ceiling, source: "derived: window ÷ avg tool tokens" },
      };
    }
    case "SERVER_DEFINITION_FOOTPRINT": {
      if (window === null) return NA;
      const frac = scan.totalTokens / window;
      // The footprint is an aggregate; surface the biggest token contributors so the user knows
      // which tools to trim first (>1000 tokens flagged as a real offender).
      // These are the biggest token CONTRIBUTORS to an aggregate footprint, not tools past a per-tool
      // cap — `over:false` so the UI labels them "Top contributors", never "Tools over the limit".
      const affectedTools: CompatibilityAffectedTool[] = [...scan.tools]
        .sort((a, b) => b.totalTokens - a.totalTokens)
        .slice(0, 8)
        .map((t) => ({ toolName: t.toolName, value: t.totalTokens, unit: "tokens", over: false }));
      const pct = Number((frac * 100).toFixed(2));
      return {
        verdict: bandUpper(frac, 0.25, 0.5),
        measured: { value: pct, unit: "% of window" },
        threshold: { value: 50, unit: "% of window", source: "warn ≥25% / fail ≥50% of window" },
        affectedTools,
      };
    }
    case "SERVER_REQUEST_SIZE": {
      // Catalog computed-note: MB/GB caps compare raw payload bytes; a token-unit cap (M365's 4,096-
      // token plugin I/O budget) compares the tool-token FOOTPRINT, not bytes. Previously the token
      // case fell through `unitToBytes` to null → na, so M365's binding budget was checked nowhere.
      const cap = requestSizeCap(test.threshold.source, model);
      if (cap === null) return NA;
      if (cap.unit === "tokens") {
        return {
          verdict: passFail(scan.totalTokens <= cap.value),
          measured: { value: scan.totalTokens, unit: "tokens" },
          threshold: {
            value: cap.value,
            unit: "tokens",
            source: test.threshold.source ?? undefined,
          },
        };
      }
      return {
        verdict: passFail(scan.totalRawBytes <= cap.value),
        measured: { value: scan.totalRawBytes, unit: "bytes" },
        threshold: { value: cap.value, unit: "bytes", source: test.threshold.source ?? undefined },
      };
    }
    case "SERVER_CLIENT_TOOL_CAP": {
      if (!opts.client) return NA;
      const cap = sourceNumber(test.threshold.source, model, opts.client);
      if (cap === null) return NA;
      const verdict = env.totalTools > cap ? "fail" : env.totalTools >= 0.9 * cap ? "warn" : "pass";
      return {
        verdict,
        measured: { value: env.totalTools, unit: "tools" },
        threshold: { value: cap, source: `cross.clients.${opts.client}.max_tools` },
      };
    }
    case "SERVER_TOOL_NAME_DUPLICATE": {
      const dups = countDuplicates(scan.tools.map((t) => t.toolName));
      return {
        verdict: passFail(dups === 0),
        measured: { value: dups, unit: "duplicates" },
        threshold: { value: 0 },
      };
    }
    case "SERVER_NAMESPACED_NAME_LENGTH": {
      const cap = sourceNumber(test.threshold.source, model) ?? 64;
      const prefix = namespacePrefix(scan.serverName);
      // Evaluate every tool's namespaced length; the result is the longest, but we keep the
      // per-tool offenders (over this model's cap) so the finding can list + link them.
      const perTool = scan.tools.map((t) => {
        // `value` counts the NAMESPACED string (prefix + name), so the breakdown carries that string
        // as `namespacedName` — otherwise the UI shows the bare name beside a count that includes the
        // (invisible) prefix and the number can't be reconciled by eye.
        const namespacedName = prefix + t.toolName;
        const value = namespacedName.length;
        return { toolName: t.toolName, namespacedName, value, unit: "chars", over: value > cap };
      });
      const longest = perTool.reduce((m, t) => Math.max(m, t.value), 0);
      const verdict = longest > cap ? "fail" : longest > 0.9 * cap ? "warn" : "pass";
      const offenders = perTool.filter((t) => t.over).sort((a, b) => b.value - a.value);
      // On a warn (nothing strictly over the cap) still surface the near-cap tools as contributors so
      // the finding names which tools to shorten, instead of listing nothing.
      const affectedTools =
        offenders.length > 0
          ? offenders
          : perTool.filter((t) => t.value > 0.9 * cap).sort((a, b) => b.value - a.value);
      return {
        verdict,
        measured: { value: longest, unit: "chars" },
        threshold: { value: cap, source: "max_tool_name_len (fallback 64)" },
        affectedTools,
      };
    }
    case "ENV_AGGREGATE_TOOL_COUNT": {
      const cap =
        sourceNumber("model.tools_mcp.max_tools_hard.value", model) ??
        sourceNumber("model.tools_mcp.max_total_tools.value", model);
      if (cap === null) return NA;
      const verdict = env.totalTools > cap ? "fail" : env.totalTools >= 0.9 * cap ? "warn" : "pass";
      return {
        verdict,
        measured: { value: env.totalTools, unit: "tools" },
        threshold: { value: cap, source: "max_tools_hard ?? max_total_tools" },
      };
    }
    case "ENV_AGGREGATE_FOOTPRINT": {
      if (window === null) return NA;
      const frac = env.totalTokens / window;
      const pct = Number((frac * 100).toFixed(2));
      return {
        verdict: bandUpper(frac, 0.25, 0.5),
        measured: { value: pct, unit: "% of window" },
        threshold: { value: 50, unit: "% of window", source: "warn ≥25% / fail ≥50% of window" },
      };
    }
    case "ENV_AGGREGATE_REQUEST_SIZE": {
      const cap = unitToBytes(test.threshold.source, model);
      if (cap === null) return NA;
      const verdict =
        env.totalRawBytes > cap ? "fail" : env.totalRawBytes >= 0.9 * cap ? "warn" : "pass";
      return {
        verdict,
        measured: { value: env.totalRawBytes, unit: "bytes" },
        threshold: { value: cap, unit: "bytes" },
      };
    }
    default:
      // session / single-exec / SERVER_PRIMITIVE_FOOTPRINT (no resource/prompt counts yet) /
      // SERVER_TRANSPORT_STDIO_HYGIENE (the static engine has no per-connection error stream;
      // surfaced from the scan's connect events elsewhere, na here).
      return NA;
  }
}

function evalTool(test: CatalogTest, tool: ToolInput, model: FlatModel): Verdict {
  switch (test.id) {
    case "TOOL_NAME_LENGTH": {
      const cap = sourceNumber(test.threshold.source, model);
      if (cap === null) return NA;
      return {
        verdict: passFail(tool.toolName.length <= cap),
        measured: { value: tool.toolName.length, unit: "chars" },
        threshold: { value: cap },
      };
    }
    case "TOOL_NAME_PATTERN":
      return {
        verdict: passFail(matchesToolNamePattern(tool.toolName)),
        measured: { value: tool.toolName },
        threshold: { value: "^[a-zA-Z0-9_-]+$" },
      };
    case "TOOL_DESCRIPTION_PRESENT":
      return {
        verdict: (tool.description ?? "").trim().length > 0 ? "pass" : "warn",
        measured: { value: (tool.description ?? "").trim().length > 0 },
        threshold: { value: true },
      };
    case "TOOL_DESCRIPTION_LENGTH": {
      const cap = sourceNumber(test.threshold.source, model);
      if (cap === null) return NA;
      return {
        verdict: passFail((tool.description ?? "").length <= cap),
        measured: { value: (tool.description ?? "").length, unit: "chars" },
        threshold: { value: cap },
      };
    }
    case "TOOL_DESCRIPTION_TOKEN_BUDGET":
      return {
        verdict: bandUpper(tool.descriptionTokens, 200, 500),
        measured: { value: tool.descriptionTokens, unit: "tokens" },
        threshold: { value: 500, source: "warn 200 / fail 500" },
      };
    case "TOOL_SCHEMA_PRESENT":
      return {
        verdict: isObjectSchema(tool.inputSchema) ? "pass" : "warn",
        measured: { value: isObjectSchema(tool.inputSchema) },
        threshold: { value: true },
      };
    case "TOOL_SCHEMA_PROPERTY_COUNT": {
      if (!isStrict(model)) return NA;
      const cap = sourceNumber(test.threshold.source, model) ?? 100;
      const n = countAllProperties(tool.inputSchema);
      return {
        verdict: n > cap ? "fail" : n >= 0.8 * cap ? "warn" : "pass",
        measured: { value: n, unit: "properties" },
        threshold: { value: cap },
      };
    }
    case "TOOL_SCHEMA_NESTING_DEPTH": {
      if (!isStrict(model)) return NA;
      const cap = sourceNumber(test.threshold.source, model) ?? 5;
      const d = maxNestingDepth(tool.inputSchema);
      // Catalog bands: pass depth < cap, warn depth == cap (at the ceiling), fail depth > cap.
      const verdict = d > cap ? "fail" : d >= cap ? "warn" : "pass";
      return { verdict, measured: { value: d, unit: "levels" }, threshold: { value: cap } };
    }
    case "TOOL_SCHEMA_UNSUPPORTED_KEYWORDS": {
      const bad = unsupportedKeywords(tool.inputSchema);
      return {
        verdict: passFail(bad.length === 0),
        measured: { value: bad.join(", ") || "none" },
        threshold: { value: "strict-supported keywords only" },
      };
    }
    case "TOOL_SCHEMA_ENUM_SIZE": {
      const n = maxEnumLength(tool.inputSchema);
      return {
        verdict: bandUpper(n, 100, 500),
        measured: { value: n, unit: "enum values" },
        threshold: { value: 500, source: "warn 100 / fail 500" },
      };
    }
    case "TOOL_DEFINITION_TOKENS": {
      // Catalog bands are the WORSE of an absolute token budget (warn 1000 / fail 2000) and a
      // window-share budget (warn ≥5% / fail ≥10% of the window). The window clause was previously
      // dropped, so a 1,700-token tool on a 16k-window model only warned instead of failing.
      const window = model.context_window_tokens;
      const absolute = bandUpper(tool.totalTokens, 1000, 2000);
      const verdict =
        window && window > 0
          ? worseVerdict(absolute, bandUpper(tool.totalTokens / window, 0.05, 0.1))
          : absolute;
      const source =
        window && window > 0
          ? "warn 1000 tok or ≥5% window / fail 2000 tok or ≥10% window"
          : "warn 1000 / fail 2000";
      return {
        verdict,
        measured: { value: tool.totalTokens, unit: "tokens" },
        threshold: { value: 2000, source },
      };
    }
    // --- Design-quality tests (non-blocker; false → warn, never gates a cell) --------------------
    case "TOOL_ANNOTATIONS_COHERENT": {
      const ok = annotationsCoherent(tool.annotations);
      return { verdict: ok ? "pass" : "warn", measured: { value: ok }, threshold: { value: true } };
    }
    case "TOOL_NAMING_CONVENTION": {
      const ok = followsNamingConvention(tool.toolName);
      return {
        verdict: ok ? "pass" : "warn",
        measured: { value: ok },
        threshold: { value: "service_action snake_case" },
      };
    }
    case "TOOL_DESCRIPTION_QUALITY": {
      const ok = descriptionQualityOk(tool.description);
      return { verdict: ok ? "pass" : "warn", measured: { value: ok }, threshold: { value: true } };
    }
    case "TOOL_PAGINATION_SUPPORTED": {
      const ok = schemaHasPagination(tool.inputSchema);
      return {
        verdict: ok ? "pass" : "warn",
        measured: { value: ok },
        threshold: { value: "limit/offset/cursor present" },
      };
    }
    case "TOOL_OUTPUT_DUAL_FORMAT": {
      const ok = schemaHasOutputFormat(tool.inputSchema);
      return {
        verdict: ok ? "pass" : "warn",
        measured: { value: ok },
        threshold: { value: "response_format/detail present" },
      };
    }
    default:
      return NA;
  }
}

function isStrict(model: FlatModel): boolean {
  const v = getPath(model.detail, "tools_mcp.strict_function_schema.value");
  return v === true;
}

/**
 * Normalize a request-size threshold to a typed cap. MB/GB → bytes; a `tokens` unit (M365's plugin
 * I/O budget) stays as a token cap so the SERVER_REQUEST_SIZE case can compare the token footprint.
 * Other/unitless values → null (na).
 */
function requestSizeCap(
  source: string | null,
  model: FlatModel,
): { value: number; unit: "bytes" | "tokens" } | null {
  if (!source || !source.startsWith("model.")) return null;
  const node = getPath(model.detail, source.slice("model.".length).replace(/\.value$/, ""));
  if (!node || typeof node !== "object") return null;
  const n = node as Record<string, unknown>;
  if (typeof n.value !== "number") return null;
  const unit = typeof n.unit === "string" ? n.unit : "";
  if (unit === "MB") return { value: n.value * 1_048_576, unit: "bytes" };
  if (unit === "GB") return { value: n.value * 1_073_741_824, unit: "bytes" };
  if (unit === "tokens") return { value: n.value, unit: "tokens" };
  return null;
}

/**
 * Byte-only request-size cap for the AGGREGATE check. The catalog's ENV_AGGREGATE_REQUEST_SIZE
 * computed-note deliberately SKIPS token-unit budgets (those are a per-server footprint, not a
 * cross-server payload), so a `tokens` cap resolves to null → na here (unlike SERVER_REQUEST_SIZE).
 */
function unitToBytes(source: string | null, model: FlatModel): number | null {
  const cap = requestSizeCap(source, model);
  return cap && cap.unit === "bytes" ? cap.value : null;
}

// --- Result + cell assembly ---------------------------------------------------------------------

function toResult(
  test: CatalogTest,
  subjectType: CompatibilityResult["subjectType"],
  subjectId: string,
  modelId: string,
  v: Verdict,
  opts: RunOpts,
): CompatibilityResult {
  const resolved = resolveSeverity(test, modelId, opts.client);
  const severity = v.verdict === "na" ? "na" : resolved.severity;
  return {
    testId: test.id,
    techName: test.tech_name,
    userFacingName: test.user_facing_name,
    findingName: test.finding_name,
    level: test.level,
    subjectType,
    subjectId,
    modelId,
    verdict: v.verdict,
    severity,
    failureMode: test.impact.failure_mode,
    measured: v.measured,
    threshold: v.threshold,
    message: test.what_it_does,
    recommendation: test.recommendation,
    rationale: resolved.rationale,
    evidence: resolved.evidence,
    affectedTools: v.affectedTools,
  };
}

/** Roll a subject's results into a heatmap cell: weighted score + blocker-fail gate + band. */
export function scoreCell(modelId: string, results: CompatibilityResult[]): CompatibilityCell {
  const scored = results.filter((r) => r.verdict !== "na" && r.severity !== "na");
  let num = 0;
  let den = 0;
  let blockerFail = false;
  let anyWarn = false;
  for (const r of scored) {
    const w = WEIGHTS[r.severity as CompatibilitySeverity];
    const vv = VERDICT_VALUE[r.verdict as "pass" | "warn" | "fail"];
    num += w * vv;
    den += w;
    if (r.verdict === "fail" && r.severity === "blocker") blockerFail = true;
    if (r.verdict === "warn") anyWarn = true;
  }
  const score = den > 0 ? Math.round((100 * num) / den) : null;
  // Catalog bands (test-catalog.json `scoring.bands`): green = score >= 90 AND no blocker fail;
  // amber = 60 <= score < 90 OR any warn; red = score < 60 OR any blocker fail. The red floor takes
  // precedence over "any warn → amber" — a single unrelated low warn must NOT upgrade a sub-60
  // (incompatible) cell to amber. A `null` score (nothing applicable scored this cell) is the
  // ABSENCE of evidence → `untested`, NOT green: a gap in coverage must never paint as "verified
  // safe". The mapping lives in the shared `bandForScore` so the runner + the web guardrail agree.
  const band = bandForScore(score, { blockerFail, anyWarn });
  return { modelId, score, band, results };
}

// --- Public entry points ------------------------------------------------------------------------

/** Server- + environment-level results for one (scan, model). `env` defaults to this scan alone. */
export function runServerLevel(
  scan: ScanInput,
  modelId: string,
  opts: RunOpts = {},
  env?: EnvInput,
): CompatibilityResult[] {
  const model = getModel(modelId);
  if (!model) return [];
  const environment: EnvInput = env ?? {
    totalTools: scan.totalTools,
    totalTokens: scan.totalTokens,
    totalRawBytes: scan.totalRawBytes,
  };
  const tests = getCatalog().tests.filter(
    (t) =>
      (t.level === "server" || t.level === "environment") &&
      t.execution_mode === "static_connection",
  );
  return tests.map((t) =>
    toResult(
      t,
      t.level === "environment" ? "environment" : "server",
      scan.scanId,
      modelId,
      evalServerOrEnv(t, scan, environment, model, opts),
      opts,
    ),
  );
}

/** Tool-level results for one (tool, model). */
export function runToolLevel(
  tool: ToolInput,
  modelId: string,
  opts: RunOpts = {},
): CompatibilityResult[] {
  const model = getModel(modelId);
  if (!model) return [];
  const tests = getCatalog().tests.filter(
    (t) => t.level === "tool" && t.execution_mode === "static_connection",
  );
  return tests.map((t) =>
    toResult(t, "tool", tool.toolName, modelId, evalTool(t, tool, model), opts),
  );
}
