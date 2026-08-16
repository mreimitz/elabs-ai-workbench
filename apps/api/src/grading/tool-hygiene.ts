import type {
  ScanDetail,
  ToolHygieneFinding,
  ToolHygieneSeverity,
} from "@mcp-token-footprint/shared";
import type { ScanRepository } from "../scans/repository.js";
import { stableStringify } from "../utils/json.js";
import type { GradeContext, Grader, GraderResult } from "./grader.js";
import { checkArgsAgainstSchema } from "./schema-check.js";

/**
 * tool_hygiene grader (B6.1, WP 2.1) — a DETERMINISTIC grade of HOW a run used its tools. No model, no
 * MCP session, no execution: it reads the run's already-persisted `tool_call`/`tool_result` steps and
 * validates each call's arguments against the app's OWN scan data — the latest completed scan's tool
 * `inputSchema` per server (the same read-only reuse as Skill IDE I5), fetched via
 * {@link ScanRepository.getLatestForServer}.
 *
 * HARD invariants (roadmap/benchmarks/conventions.md):
 *   - NEVER opens an MCP session / executes anything. It reads persisted scans + `run.steps` only.
 *     (Enforced by a static import assertion in `test/grading-tool-hygiene.test.ts`.)
 *   - `unevaluable` (score `null`) when it cannot judge — a run with NO tool calls, or a run where NO
 *     called tool has a usable scan to check against. `unevaluable` is NEVER a 0.
 *
 * SCORING: every finding carries a documented weight; `score = clamp(1 − Σ weights, 0, 1)`. A clean run
 * (valid args, tool present in the scan, no misuse signals) scores 1.0.
 *
 * WHERE THE ARGUMENTS COME FROM: the engine persists the model's tool input on the STREAM `tool_call`
 * step as `payload.args` (the AI-SDK tool `input`; a separate MCP-sink `tool_call` step carries the
 * `serverId` + ok/error status but no args — the two correlate by `payload.toolCallId`). This grader
 * anchors a logical call on the args-bearing step, then borrows `serverId`/status from its correlates.
 * Arguments are treated as OPAQUE structured data (redacted on persistence) — never executed.
 */

const METHOD = "tool_hygiene_v1";

/**
 * Per-check severity + score weight. Exported so the weighting is auditable and stable. `score` starts
 * at 1.0 and each finding subtracts its weight (then clamped to [0, 1]); every weight is > 0 so a single
 * finding always drops the score below 1.0.
 */
export const TOOL_HYGIENE_CHECKS = {
  // Schema-derived (args vs the tool's scanned inputSchema).
  "missing-required": { severity: "high", weight: 0.25 },
  "wrong-type": { severity: "high", weight: 0.2 },
  "enum-violation": { severity: "medium", weight: 0.15 },
  "unknown-property": { severity: "low", weight: 0.1 },
  // Trace-derived (how the calls were sequenced).
  "tool-not-in-scan": { severity: "high", weight: 0.25 },
  "tool-error-rate": { severity: "medium", weight: 0.2 },
  "identical-repeat": { severity: "low", weight: 0.1 },
  "error-then-retry": { severity: "medium", weight: 0.15 },
} as const satisfies Record<string, { severity: ToolHygieneSeverity; weight: number }>;

type CheckId = keyof typeof TOOL_HYGIENE_CHECKS;

/**
 * Fraction of `tool_result` steps that may fail before a single `tool-error-rate` finding fires
 * (strictly greater than this threshold trips it). Documented + tunable in one place.
 */
export const TOOL_ERROR_RATE_THRESHOLD = 0.5;

/** A logical tool call, anchored on the args-bearing `tool_call` step. */
type LogicalCall = {
  stepIdx: number;
  toolName: string;
  args: unknown;
  argsKey: string; // canonical JSON of args, for byte-identical comparison
  toolCallId?: string;
  serverId?: string;
};

export class ToolHygieneGrader implements Grader {
  readonly id = "tool_hygiene" as const;
  readonly kind = "deterministic" as const;

  constructor(private readonly scans: ScanRepository) {}

  grade(ctx: GradeContext): GraderResult {
    const steps = ctx.run.steps ?? [];
    const calls = extractLogicalCalls(steps);

    // No tool calls at all → nothing to judge (never a 0).
    if (calls.length === 0) {
      return {
        status: "unevaluable",
        score: null,
        method: METHOD,
        reasoning: "the run made no tool calls",
      };
    }

    resolveServerIds(calls, steps);

    // Scans are fetched at most once per server (getLatestForServer → the newest completed scan detail).
    const scanCache = new Map<string, ScanDetail | null>();
    const scanFor = (serverId: string): ScanDetail | null => {
      if (!scanCache.has(serverId))
        scanCache.set(serverId, this.scans.getLatestForServer(serverId));
      return scanCache.get(serverId) ?? null;
    };

    const findings: ToolHygieneFinding[] = [];
    let checkableCalls = 0;

    // ── Schema-derived + tool-presence checks (need a scan for the call's server) ──────────────────
    for (const call of calls) {
      if (!call.serverId) continue; // can't locate the server → not checkable against a scan
      const scan = scanFor(call.serverId);
      if (!scan) continue; // no completed scan for that server → unevaluable-contributing (skip, never a violation)

      checkableCalls += 1;
      const tool = scan.tools.find((t) => t.toolName === call.toolName);
      if (!tool) {
        findings.push(
          finding(
            "tool-not-in-scan",
            call.stepIdx,
            `tool "${call.toolName}" is not in ${scan.serverName}'s latest scan`,
          ),
        );
        continue;
      }
      for (const v of checkArgsAgainstSchema(tool.inputSchema, call.args)) {
        findings.push(finding(v.checkId, call.stepIdx, v.message));
      }
    }

    // If not a single call could be checked against a scan, the grade is honestly unevaluable — never a
    // 0, even if the trace-derived signals below might have fired.
    if (checkableCalls === 0) {
      return {
        status: "unevaluable",
        score: null,
        method: METHOD,
        reasoning: `made ${calls.length} tool call(s) but no called tool has a completed scan to check against`,
      };
    }

    // ── Trace-derived checks (independent of any scan) ─────────────────────────────────────────────
    findings.push(...toolErrorRateFindings(steps));
    findings.push(...identicalRepeatFindings(calls));
    findings.push(...errorThenRetryFindings(calls, steps));

    const totalWeight = findings.reduce(
      (sum, f) => sum + TOOL_HYGIENE_CHECKS[f.checkId as CheckId].weight,
      0,
    );
    const score = clamp01(1 - totalWeight);

    return {
      status: "graded",
      score,
      method: METHOD,
      reasoning:
        findings.length === 0
          ? `${checkableCalls} tool call(s) checked; no hygiene issues`
          : `${findings.length} finding(s) across ${calls.length} tool call(s); score ${score.toFixed(3)}`,
      evidence: findings,
    };
  }
}

// ── Logical-call extraction + correlation ───────────────────────────────────────────────────────────

/**
 * The args-bearing `tool_call` steps — one per logical call the model made. The MCP-sink `tool_call`
 * step (serverId + status, no `args`) and every other step type are excluded here; they only feed the
 * serverId/status correlation below.
 */
function extractLogicalCalls(steps: GradeContext["run"]["steps"]): LogicalCall[] {
  const calls: LogicalCall[] = [];
  for (const step of steps) {
    if (step.type !== "tool_call") continue;
    const payload = asRecord(step.payload);
    if (!payload || !("args" in payload)) continue; // the MCP-sink duplicate carries no args → skip
    const args = payload.args;
    calls.push({
      stepIdx: step.index,
      toolName: step.toolName ?? step.label ?? "",
      args,
      argsKey: stableStringify(args),
      toolCallId: typeof payload.toolCallId === "string" ? payload.toolCallId : undefined,
      serverId: step.serverId,
    });
  }
  return calls;
}

/**
 * Fill in each call's `serverId` when the args-bearing step didn't carry it. In a real run the serverId
 * lives on the correlated MCP-sink `tool_call` step (same `toolCallId`); as a last resort we map by tool
 * name (tool names are effectively server-unique within a run — the bridge is server-scoped).
 */
function resolveServerIds(calls: LogicalCall[], steps: GradeContext["run"]["steps"]): void {
  const byToolCallId = new Map<string, string>();
  const byToolName = new Map<string, string>();
  for (const step of steps) {
    if (!step.serverId) continue;
    const payload = asRecord(step.payload);
    const tcid = payload && typeof payload.toolCallId === "string" ? payload.toolCallId : undefined;
    if (tcid) byToolCallId.set(tcid, step.serverId);
    if (step.toolName) byToolName.set(step.toolName, step.serverId);
  }
  for (const call of calls) {
    if (call.serverId) continue;
    call.serverId =
      (call.toolCallId ? byToolCallId.get(call.toolCallId) : undefined) ??
      byToolName.get(call.toolName);
  }
}

// ── Trace-derived checks ────────────────────────────────────────────────────────────────────────────

/**
 * One `tool-error-rate` finding when the share of `tool_result` steps that failed exceeds
 * {@link TOOL_ERROR_RATE_THRESHOLD}. Anchored on the FIRST failing `tool_result` step so the finding
 * cites a concrete step. Runs with no `tool_result` steps produce nothing.
 */
function toolErrorRateFindings(steps: GradeContext["run"]["steps"]): ToolHygieneFinding[] {
  const results = steps.filter((s) => s.type === "tool_result");
  if (results.length === 0) return [];
  const errors = results.filter((s) => s.status === "error");
  const rate = errors.length / results.length;
  if (rate <= TOOL_ERROR_RATE_THRESHOLD) return [];
  const firstError = errors[0];
  const stepIdx = firstError ? firstError.index : (results[0]?.index ?? 0);
  return [
    finding(
      "tool-error-rate",
      stepIdx,
      `${errors.length}/${results.length} tool results errored (${(rate * 100).toFixed(0)}% > ${(TOOL_ERROR_RATE_THRESHOLD * 100).toFixed(0)}%)`,
    ),
  ];
}

/**
 * `identical-repeat` — the model issued the exact same call (same tool name + canonical-JSON-identical
 * args) two or more times. Every occurrence AFTER the first in a group gets a finding on its own step.
 */
function identicalRepeatFindings(calls: LogicalCall[]): ToolHygieneFinding[] {
  const seen = new Map<string, number>(); // group key → times seen so far
  const out: ToolHygieneFinding[] = [];
  for (const call of calls) {
    const key = `${call.toolName} ${call.argsKey}`;
    const count = (seen.get(key) ?? 0) + 1;
    seen.set(key, count);
    if (count >= 2) {
      out.push(
        finding(
          "identical-repeat",
          call.stepIdx,
          `identical call to "${call.toolName}" repeated (occurrence ${count})`,
        ),
      );
    }
  }
  return out;
}

/**
 * `error-then-retry` — a failed call immediately followed (in logical-call order) by a byte-identical
 * retry of the SAME tool. The intervening `tool_result` step is the failure signal; a call's status is
 * resolved from its correlated `tool_result` (by `toolCallId`, else the next same-tool result step).
 */
function errorThenRetryFindings(
  calls: LogicalCall[],
  steps: GradeContext["run"]["steps"],
): ToolHygieneFinding[] {
  const status = callStatuses(calls, steps);
  const out: ToolHygieneFinding[] = [];
  for (let i = 0; i < calls.length - 1; i++) {
    const cur = calls[i];
    const next = calls[i + 1];
    if (!cur || !next) continue;
    if (status[i] !== "error") continue;
    if (next.toolName === cur.toolName && next.argsKey === cur.argsKey) {
      out.push(
        finding(
          "error-then-retry",
          next.stepIdx,
          `retried "${next.toolName}" with identical args after it errored`,
        ),
      );
    }
  }
  return out;
}

/**
 * Per-call terminal status (`ok` | `error` | `unknown`) resolved from `tool_result` steps: first by the
 * shared `toolCallId`, else by the next not-yet-consumed same-tool `tool_result` after the call's step.
 */
function callStatuses(
  calls: LogicalCall[],
  steps: GradeContext["run"]["steps"],
): Array<"ok" | "error" | "unknown"> {
  const byToolCallId = new Map<string, "ok" | "error">();
  for (const step of steps) {
    if (step.type !== "tool_result") continue;
    const payload = asRecord(step.payload);
    const tcid = payload && typeof payload.toolCallId === "string" ? payload.toolCallId : undefined;
    if (!tcid) continue;
    const s = step.status === "error" ? "error" : "ok";
    // An error anywhere for a toolCallId wins.
    if (s === "error" || !byToolCallId.has(tcid)) byToolCallId.set(tcid, s);
  }

  const resultSteps = steps
    .filter((s) => s.type === "tool_result")
    .map((s) => ({
      index: s.index,
      toolName: s.toolName ?? "",
      status: s.status === "error" ? "error" : "ok",
      used: false,
    }));

  return calls.map((call) => {
    if (call.toolCallId && byToolCallId.has(call.toolCallId))
      return byToolCallId.get(call.toolCallId) as "ok" | "error";
    const match = resultSteps.find(
      (r) => !r.used && r.index > call.stepIdx && r.toolName === call.toolName,
    );
    if (match) {
      match.used = true;
      return match.status as "ok" | "error";
    }
    return "unknown";
  });
}

// ── helpers ─────────────────────────────────────────────────────────────────────────────────────────

function finding(checkId: CheckId, stepIdx: number, message: string): ToolHygieneFinding {
  return { checkId, severity: TOOL_HYGIENE_CHECKS[checkId].severity, stepIdx, message };
}

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
