import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ADVISOR_EVIDENCE_KINDS,
  ADVISOR_SAVINGS_UNITS,
  ADVISOR_SEVERITIES,
  ADVISOR_VERSION,
  advisorReportSchema,
  type AdvisorRecommendation,
  type AdvisorReport,
  type AdvisorScope,
} from "@mcp-token-footprint/shared";
import { runAdvisor } from "../src/advisor/engine.js";
import {
  ADVISOR_RULES,
  advisorRuleRegistry,
  createAdvisorRuleRegistry,
} from "../src/advisor/registry.js";
import {
  runEvidence,
  scanEvidence,
  scenarioEvidence,
  serverEvidence,
  skillEvidence,
  toolScanEvidence,
} from "../src/advisor/evidence.js";
import {
  AdvisorRuleContractError,
  type AdvisorContext,
  type AdvisorGradePort,
  type AdvisorRule,
  type AdvisorRunPort,
  type AdvisorScanPort,
  type AdvisorScenarioPort,
  type AdvisorServerPort,
  type AdvisorSkillPort,
  type AdvisorSuiteRunPort,
} from "../src/advisor/types.js";
import type { GradeRepository } from "../src/grading/grade-repository.js";
import type { RunRepository } from "../src/testing/run-repository.js";
import type { ScanRepository } from "../src/scans/repository.js";
import type { ScenarioRepository } from "../src/testing/scenario-repository.js";
import type { ServerRepository } from "../src/servers/repository.js";
import type { SkillRepository } from "../src/skills/repository.js";
import type { SuiteRunRepository } from "../src/suites/suite-run-repository.js";

// WP 1.1 (Advisor) — the wire contract + the deterministic rule-engine core. ZERO product rules
// ship in this WP, so every rule here is a fixture that exercises the seam WP 1.2's four rules land
// on: determinism, first-wins dedup, honest gaps, and labeled-estimate savings.

const FIXED_CLOCK = new Date("2026-08-18T09:30:00.000Z");

/**
 * A context whose every read port throws. Fixture rules read no data, so any port access would be
 * a bug — and this proves the engine itself never touches the read model (and that a rule cannot
 * reach a DB handle: there is none on the context to reach for).
 */
function stubContext(now: Date = FIXED_CLOCK): AdvisorContext {
  const forbidden = (port: string) => (): never => {
    throw new Error(`the fixture context's ${port} port must not be read`);
  };
  return {
    servers: { list: forbidden("servers"), getPublic: forbidden("servers") },
    scans: {
      listSummariesByServer: forbidden("scans"),
      getLatestForServer: forbidden("scans"),
      getDetail: forbidden("scans"),
    },
    scenarios: {
      list: forbidden("scenarios"),
      get: forbidden("scenarios"),
      listServers: forbidden("scenarios"),
    },
    runs: {
      listRuns: forbidden("runs"),
      getRun: forbidden("runs"),
      getToolCallSequence: forbidden("runs"),
      getSummary: forbidden("runs"),
      getRunSkills: forbidden("runs"),
    },
    // WP 2.1 — the grade-aware ports are forbidden here too: a rule under test that reaches for a
    // grade it was not handed should fail loudly, not read an empty list and call it a measurement.
    grades: { listByRun: forbidden("grades") },
    suiteRuns: { listRuns: forbidden("suiteRuns"), listChildRunIds: forbidden("suiteRuns") },
    skills: { list: forbidden("skills") },
    models: { get: forbidden("models") },
    now: () => now,
  };
}

/**
 * A context over an EMPTY read model — every port answers, and answers with nothing. Used for the
 * default-registry call, where WP 1.2's real rules do read their ports and must produce honest gaps
 * rather than findings.
 */
function emptyContext(now: Date = FIXED_CLOCK): AdvisorContext {
  const missing = (what: string) => (): never => {
    const error = new Error(`${what} not found`) as Error & { statusCode: number };
    error.statusCode = 404;
    throw error;
  };
  return {
    servers: { list: () => [], getPublic: missing("Server") },
    scans: {
      listSummariesByServer: () => [],
      getLatestForServer: () => null,
      getDetail: missing("Scan"),
    },
    scenarios: { list: () => [], get: missing("Scenario"), listServers: () => [] },
    runs: {
      listRuns: () => [],
      getRun: missing("Run"),
      getToolCallSequence: () => [],
      getSummary: missing("Run"),
      getRunSkills: () => [],
    },
    // WP 2.1 — an install that has never benchmarked anything: every grade-aware port answers, and
    // answers with nothing, so the three grade-aware rules must produce honest gaps.
    grades: { listByRun: () => [] },
    suiteRuns: { listRuns: () => [], listChildRunIds: () => [] },
    skills: { list: () => [] },
    models: { get: () => null },
    now: () => now,
  };
}

/** A minimal, contract-valid recommendation. Overrides let a test bend exactly one field. */
function recommendation(
  ruleId: string,
  id: string,
  overrides: Partial<AdvisorRecommendation> = {},
): AdvisorRecommendation {
  return {
    id,
    ruleId,
    title: `Finding ${id}`,
    detail: `Detail for ${id}`,
    severity: "medium",
    evidence: [{ kind: "server", id: "srv-1", label: "Fixture server" }],
    assumptions: [],
    ...overrides,
  };
}

/** A fixture rule that emits exactly what it is handed, for every scope. */
function fixtureRule(
  id: string,
  recommendations: AdvisorRecommendation[],
  insufficientData: Array<{ ruleId: string; reason: string }> = [],
  appliesTo: (scope: AdvisorScope) => boolean = () => true,
): AdvisorRule {
  return {
    id,
    description: `fixture rule ${id}`,
    appliesTo,
    run: () => ({ recommendations, insufficientData }),
  };
}

const FLEET: AdvisorScope = { kind: "fleet" };

// ── Version stamp ────────────────────────────────────────────────────────────────────────────────

test("every report is stamped with ADVISOR_VERSION", () => {
  const report = runAdvisor(stubContext(), FLEET, { rules: [] });
  assert.equal(ADVISOR_VERSION, 1);
  assert.equal(report.advisorVersion, ADVISOR_VERSION);
});

test("the report's generatedAt comes from the injected clock, never a wall-clock read", () => {
  const report = runAdvisor(stubContext(new Date("2020-01-02T03:04:05.000Z")), FLEET, {
    rules: [],
  });
  assert.equal(report.generatedAt, "2020-01-02T03:04:05.000Z");
});

// ── Contract: TS types + zod, round-trip ─────────────────────────────────────────────────────────

test("a fully-populated report round-trips through advisorReportSchema unchanged", () => {
  const rule = fixtureRule("fixture.full", [
    recommendation("fixture.full", "rec-full", {
      severity: "high",
      savings: {
        value: 9200,
        unit: "tokens_per_turn",
        estimate: true,
        basis: "sum of the 12 never-called tools' definition tokens",
      },
      evidence: [
        serverEvidence({ id: "srv-1", name: "Fixture server" }),
        scanEvidence({
          id: "scan-1",
          serverName: "Fixture server",
          scannedAt: "2026-08-01T00:00:00.000Z",
        }),
        toolScanEvidence("scan-1", "search_documents"),
        runEvidence({ id: "run-1", startedAt: "2026-08-02T00:00:00.000Z" }),
        scenarioEvidence({ id: "scn-1", name: "Fixture environment" }),
        skillEvidence("skill-1", "Fixture skill"),
      ],
      assumptions: ["the last 20 runs are representative of normal use"],
    }),
  ]);

  const report = runAdvisor(stubContext(), { kind: "server", id: "srv-1" }, { rules: [rule] });

  // Round-trip over the wire: serialize → parse → validate, and nothing is lost or coerced.
  const parsed = advisorReportSchema.parse(JSON.parse(JSON.stringify(report)));
  assert.deepEqual(parsed, report);
  // …and the parsed report is itself still valid input to the schema (idempotent).
  assert.deepEqual(advisorReportSchema.parse(parsed), parsed);
  // Every evidence kind in the shared vocabulary has a builder that produces a valid ref.
  const kinds = report.recommendations[0]?.evidence.map((e) => e.kind) ?? [];
  assert.deepEqual([...kinds].sort(), [...ADVISOR_EVIDENCE_KINDS].sort());
});

test("the zod schema refuses the two shapes the TS types cannot forbid: empty evidence, blank basis", () => {
  const base = recommendation("fixture.zod", "rec-zod");
  const report = (rec: AdvisorRecommendation): unknown => ({
    advisorVersion: ADVISOR_VERSION,
    generatedAt: FIXED_CLOCK.toISOString(),
    scope: FLEET,
    recommendations: [rec],
    insufficientData: [],
  });

  assert.equal(advisorReportSchema.safeParse(report({ ...base, evidence: [] })).success, false);
  assert.equal(
    advisorReportSchema.safeParse(
      report({
        ...base,
        savings: { value: 10, unit: "tokens", estimate: true, basis: "   " },
      }),
    ).success,
    false,
  );
});

// ── Evidence is mandatory ────────────────────────────────────────────────────────────────────────

test("the engine REJECTS a recommendation with no evidence — it never reaches the report", () => {
  const rule = fixtureRule("fixture.noevidence", [
    recommendation("fixture.noevidence", "rec-blind", { evidence: [] }),
  ]);

  assert.throws(
    () => runAdvisor(stubContext(), FLEET, { rules: [rule] }),
    (error: unknown) => {
      assert.ok(error instanceof AdvisorRuleContractError);
      assert.equal(error.ruleId, "fixture.noevidence");
      assert.match(error.message, /carries no evidence/);
      return true;
    },
  );
});

test("every recommendation the engine publishes carries at least one evidence ref", () => {
  const rules = [
    fixtureRule("fixture.a", [recommendation("fixture.a", "rec-a")]),
    fixtureRule("fixture.b", [recommendation("fixture.b", "rec-b")]),
  ];
  const report = runAdvisor(stubContext(), FLEET, { rules });

  assert.equal(report.recommendations.length, 2);
  for (const rec of report.recommendations) assert.ok(rec.evidence.length >= 1);
});

test("the evidence builders refuse a blank id or label instead of emitting a dead link", () => {
  assert.throws(() => serverEvidence({ id: "  ", name: "Server" }), /non-empty id/);
  assert.throws(() => serverEvidence({ id: "srv-1", name: "   " }), /non-empty label/);
  // A tool-scan ref is keyed `<scanId>:<toolName>` so it is stable for the same scan.
  assert.deepEqual(toolScanEvidence("scan-1", "search_documents"), {
    kind: "tool_scan",
    id: "scan-1:search_documents",
    label: "search_documents",
  });
});

test("the engine rejects a recommendation stamped with another rule's id (provenance)", () => {
  const rule = fixtureRule("fixture.owner", [recommendation("fixture.impostor", "rec-x")]);
  assert.throws(
    () => runAdvisor(stubContext(), FLEET, { rules: [rule] }),
    /stamped ruleId "fixture.impostor"/,
  );
});

// ── Determinism ──────────────────────────────────────────────────────────────────────────────────

test("running the engine twice over the same fixture rules yields BYTE-IDENTICAL JSON", () => {
  const rules = [
    fixtureRule("fixture.one", [
      recommendation("fixture.one", "rec-info", { severity: "info" }),
      recommendation("fixture.one", "rec-high-cheap", {
        severity: "high",
        savings: { value: 10, unit: "tokens_per_turn", estimate: true, basis: "ten tokens" },
      }),
    ]),
    fixtureRule(
      "fixture.two",
      [
        recommendation("fixture.two", "rec-high-rich", {
          severity: "high",
          savings: { value: 9000, unit: "tokens_per_turn", estimate: true, basis: "nine thousand" },
        }),
        recommendation("fixture.two", "rec-medium"),
      ],
      [{ ruleId: "fixture.two", reason: "no completed runs in the last 30 days" }],
    ),
  ];

  const first = runAdvisor(stubContext(), FLEET, { rules });
  const second = runAdvisor(stubContext(), FLEET, { rules });

  assert.equal(JSON.stringify(first), JSON.stringify(second));
  // …including the ordering of BOTH arrays, not merely the set of members.
  assert.deepEqual(
    first.recommendations.map((r) => r.id),
    second.recommendations.map((r) => r.id),
  );
  assert.deepEqual(first.insufficientData, second.insufficientData);
});

test("a scope built with reversed key order still serializes identically (no aliasing)", () => {
  const scopeA: AdvisorScope = { kind: "server", id: "srv-1" };
  const scopeB = { id: "srv-1", kind: "server" } as AdvisorScope;

  assert.equal(
    JSON.stringify(runAdvisor(stubContext(), scopeA, { rules: [] })),
    JSON.stringify(runAdvisor(stubContext(), scopeB, { rules: [] })),
  );
});

test("the documented sort is severity → savings → id", () => {
  // Deliberately emitted in the WRONG order, and split across two rules, so only the sort can
  // produce the expected sequence.
  const rules = [
    fixtureRule("fixture.late", [
      recommendation("fixture.late", "z-info", { severity: "info" }),
      recommendation("fixture.late", "b-medium-800", {
        severity: "medium",
        savings: { value: 800, unit: "tokens_per_turn", estimate: true, basis: "b" },
      }),
      recommendation("fixture.late", "a-high-nosavings", { severity: "high" }),
    ]),
    fixtureRule("fixture.early", [
      recommendation("fixture.early", "a-medium-800", {
        severity: "medium",
        savings: { value: 800, unit: "tokens_per_turn", estimate: true, basis: "a" },
      }),
      recommendation("fixture.early", "y-high-5", {
        severity: "high",
        savings: { value: 5, unit: "tokens_per_turn", estimate: true, basis: "y" },
      }),
      recommendation("fixture.early", "x-high-500", {
        severity: "high",
        savings: { value: 500, unit: "tokens_per_turn", estimate: true, basis: "x" },
      }),
      recommendation("fixture.early", "m-medium-usd", {
        severity: "medium",
        savings: { value: 999, unit: "usd_per_run", estimate: true, basis: "m" },
      }),
    ]),
  ];

  const report = runAdvisor(stubContext(), FLEET, { rules });

  assert.deepEqual(
    report.recommendations.map((r) => r.id),
    [
      // high, with savings, biggest first
      "x-high-500",
      "y-high-5",
      // high, no savings — ranks after every quantified sibling in its band
      "a-high-nosavings",
      // medium, tokens_per_turn 800 twice → the id tie-break decides
      "a-medium-800",
      "b-medium-800",
      // medium, usd_per_run — a later unit rank; 999 usd is NEVER converted to compare against tokens
      "m-medium-usd",
      // info last
      "z-info",
    ],
  );
  assert.deepEqual([...ADVISOR_SEVERITIES], ["high", "medium", "info"]);
  assert.deepEqual([...ADVISOR_SAVINGS_UNITS], ["tokens_per_turn", "tokens", "usd_per_run"]);
});

test("insufficient-data entries sort deterministically by ruleId then reason", () => {
  const rules = [
    fixtureRule("fixture.z", [], [{ ruleId: "fixture.z", reason: "no scans for this server" }]),
    fixtureRule(
      "fixture.a",
      [],
      [
        { ruleId: "fixture.a", reason: "no runs recorded" },
        { ruleId: "fixture.a", reason: "and no scenario is attached" },
      ],
    ),
  ];

  const report = runAdvisor(stubContext(), FLEET, { rules });
  assert.deepEqual(report.insufficientData, [
    { ruleId: "fixture.a", reason: "and no scenario is attached" },
    { ruleId: "fixture.a", reason: "no runs recorded" },
    { ruleId: "fixture.z", reason: "no scans for this server" },
  ]);
});

// ── Dedup ────────────────────────────────────────────────────────────────────────────────────────

test("two rules emitting the same recommendation id collapse to one — FIRST WINS", () => {
  const winner = recommendation("fixture.first", "shared-id", {
    title: "Emitted by the first rule",
    severity: "info",
  });
  const loser = recommendation("fixture.second", "shared-id", {
    title: "Emitted by the second rule",
    severity: "high",
    savings: { value: 5000, unit: "tokens_per_turn", estimate: true, basis: "loser" },
  });

  const report = runAdvisor(stubContext(), FLEET, {
    rules: [fixtureRule("fixture.first", [winner]), fixtureRule("fixture.second", [loser])],
  });

  assert.equal(report.recommendations.length, 1);
  const kept = report.recommendations[0];
  // First-wins: the EARLIER rule's finding survives whole. The duplicate is dropped, never merged
  // in — the loser's higher severity and its savings figure do not leak into the winner.
  assert.equal(kept?.title, "Emitted by the first rule");
  assert.equal(kept?.ruleId, "fixture.first");
  assert.equal(kept?.severity, "info");
  assert.equal(kept?.savings, undefined);

  // Reversing rule order flips which one wins — proving order, not content, decides.
  const reversed = runAdvisor(stubContext(), FLEET, {
    rules: [fixtureRule("fixture.second", [loser]), fixtureRule("fixture.first", [winner])],
  });
  assert.equal(reversed.recommendations[0]?.title, "Emitted by the second rule");
});

test("one rule emitting the same id twice also collapses, first-wins", () => {
  const rule = fixtureRule("fixture.dup", [
    recommendation("fixture.dup", "same", { title: "first" }),
    recommendation("fixture.dup", "same", { title: "second" }),
  ]);
  const report = runAdvisor(stubContext(), FLEET, { rules: [rule] });

  assert.equal(report.recommendations.length, 1);
  assert.equal(report.recommendations[0]?.title, "first");
});

test("identical insufficient-data entries collapse; different reasons from one rule are kept", () => {
  const rule = fixtureRule(
    "fixture.gaps",
    [],
    [
      { ruleId: "fixture.gaps", reason: "no runs recorded" },
      { ruleId: "fixture.gaps", reason: "no runs recorded" },
      { ruleId: "fixture.gaps", reason: "no scan for server srv-1" },
    ],
  );
  const report = runAdvisor(stubContext(), FLEET, { rules: [rule] });

  assert.deepEqual(report.insufficientData, [
    { ruleId: "fixture.gaps", reason: "no runs recorded" },
    { ruleId: "fixture.gaps", reason: "no scan for server srv-1" },
  ]);
});

// ── Insufficient data ────────────────────────────────────────────────────────────────────────────

test("a rule lacking inputs names what is missing and fabricates NO numbers", () => {
  const starved = fixtureRule(
    "fixture.unused-tool-trim",
    [], // no recommendation at all — not a zero-saving one
    [
      {
        ruleId: "fixture.unused-tool-trim",
        reason: "environment scn-1 has no completed runs, so tool usage cannot be observed",
      },
    ],
  );

  const report = runAdvisor(stubContext(), { kind: "scenario", id: "scn-1" }, { rules: [starved] });

  assert.equal(report.recommendations.length, 0);
  assert.deepEqual(report.insufficientData, [
    {
      ruleId: "fixture.unused-tool-trim",
      reason: "environment scn-1 has no completed runs, so tool usage cannot be observed",
    },
  ]);
  // The gap NAMES the missing input, and nowhere in the report is there a number standing in for
  // the measurement that could not be taken.
  assert.match(report.insufficientData[0]?.reason ?? "", /no completed runs/);
  assert.equal(JSON.stringify(report).includes('"savings"'), false);
  assert.equal(advisorReportSchema.safeParse(report).success, true);
});

test("an insufficient-data entry with a blank reason is rejected, not published as an empty gap", () => {
  const rule = fixtureRule("fixture.blankgap", [], [{ ruleId: "fixture.blankgap", reason: "  " }]);
  assert.throws(
    () => runAdvisor(stubContext(), FLEET, { rules: [rule] }),
    /insufficient-data entry has no reason/,
  );
});

test("a rule that does not apply to the scope contributes nothing — not even a gap", () => {
  const serverOnly = fixtureRule(
    "fixture.serveronly",
    [recommendation("fixture.serveronly", "rec-server")],
    [{ ruleId: "fixture.serveronly", reason: "would have reported this" }],
    (scope) => scope.kind === "server",
  );

  const fleetReport = runAdvisor(stubContext(), FLEET, { rules: [serverOnly] });
  assert.deepEqual(fleetReport.recommendations, []);
  assert.deepEqual(fleetReport.insufficientData, []);

  const serverReport = runAdvisor(
    stubContext(),
    { kind: "server", id: "srv-1" },
    { rules: [serverOnly] },
  );
  assert.equal(serverReport.recommendations.length, 1);
  assert.equal(serverReport.insufficientData.length, 1);
});

// ── Savings are labeled estimates with a basis ───────────────────────────────────────────────────

test("a savings value cannot be emitted without its basis string", () => {
  const rule = fixtureRule("fixture.basisless", [
    recommendation("fixture.basisless", "rec-nobasis", {
      savings: { value: 4200, unit: "tokens_per_turn", estimate: true, basis: "" },
    }),
  ]);

  assert.throws(
    () => runAdvisor(stubContext(), FLEET, { rules: [rule] }),
    (error: unknown) => {
      assert.ok(error instanceof AdvisorRuleContractError);
      assert.match(error.message, /savings value with no basis string/);
      return true;
    },
  );

  // Whitespace is not a basis either.
  const blank = fixtureRule("fixture.blankbasis", [
    recommendation("fixture.blankbasis", "rec-blank", {
      savings: { value: 4200, unit: "tokens", estimate: true, basis: "   \n " },
    }),
  ]);
  assert.throws(() => runAdvisor(stubContext(), FLEET, { rules: [blank] }), /no basis string/);
});

test("a savings value cannot be emitted without the explicit estimate marker", () => {
  const rule = fixtureRule("fixture.unlabeled", [
    recommendation("fixture.unlabeled", "rec-unlabeled", {
      // A rule reaching around the `estimate: true` literal type — the runtime check still bites.
      savings: {
        value: 4200,
        unit: "tokens_per_turn",
        estimate: false,
        basis: "sum of tool tokens",
      } as unknown as AdvisorRecommendation["savings"],
    }),
  ]);

  assert.throws(
    () => runAdvisor(stubContext(), FLEET, { rules: [rule] }),
    /savings without the estimate marker/,
  );
});

test("a non-finite savings value is refused rather than serialized as null", () => {
  const rule = fixtureRule("fixture.nan", [
    recommendation("fixture.nan", "rec-nan", {
      savings: { value: Number.NaN, unit: "tokens", estimate: true, basis: "bad arithmetic" },
    }),
  ]);
  assert.throws(() => runAdvisor(stubContext(), FLEET, { rules: [rule] }), /non-finite savings/);
});

test("a published savings figure keeps its estimate marker and basis end to end", () => {
  const rule = fixtureRule("fixture.savings", [
    recommendation("fixture.savings", "rec-savings", {
      savings: {
        value: 9200,
        unit: "tokens_per_turn",
        estimate: true,
        basis: "sum of the 12 never-called tools' definition tokens in scan scan-1",
      },
    }),
  ]);

  const report: AdvisorReport = runAdvisor(stubContext(), FLEET, { rules: [rule] });
  const savings = report.recommendations[0]?.savings;

  assert.equal(savings?.estimate, true);
  assert.equal(savings?.value, 9200);
  assert.ok((savings?.basis ?? "").length > 0);
  assert.equal(advisorReportSchema.safeParse(report).success, true);
});

// ── Registry seam ────────────────────────────────────────────────────────────────────────────────

test("the app registry exposes the seven product rules, in registration order", () => {
  // WP 1.1 shipped this registry EMPTY (the engine seam only); WP 1.2 filled it with the four
  // deterministic rules and WP 2.1 APPENDED the three grade-aware ones. Their order is part of the
  // determinism contract — it is the tie-break the engine's first-wins dedup would use — so the full
  // list is asserted here, once, against the registry itself.
  const expected = [
    "advisor.unused-tool-trim",
    "advisor.description-bloat",
    "advisor.loading-mode-comparison",
    "advisor.tool-overlap",
    "advisor.quality-validated-trim",
    "advisor.skill-effect",
    "advisor.model-quality-bar",
  ];
  assert.deepEqual(
    ADVISOR_RULES.map((rule) => rule.id),
    expected,
  );
  assert.deepEqual(
    advisorRuleRegistry.list().map((rule) => rule.id),
    expected,
  );
  assert.equal(advisorRuleRegistry.get("anything"), undefined);
  assert.equal(advisorRuleRegistry.get("advisor.tool-overlap")?.id, "advisor.tool-overlap");
  // Every registered rule still satisfies the engine's own shape (a non-empty id + description, and
  // both members of the contract), which is what lets the default-registry call below be trusted.
  for (const rule of ADVISOR_RULES) {
    assert.ok(rule.id.trim().length > 0);
    assert.ok(rule.description.trim().length > 0);
    assert.equal(typeof rule.appliesTo, "function");
    assert.equal(typeof rule.run, "function");
  }
  // The default-registry engine call over an EMPTY read model is still a valid report: an install
  // with no servers, no environments and no runs produces honest gaps, never fabricated findings.
  const report = runAdvisor(emptyContext(), FLEET);
  assert.deepEqual(report.recommendations, []);
  assert.equal(advisorReportSchema.safeParse(report).success, true);
  assert.ok(report.insufficientData.length > 0);
  for (const gap of report.insufficientData) assert.ok(gap.reason.trim().length > 0);
});

test("the registry keeps registration order, looks up by id, and refuses duplicate ids", () => {
  const first = fixtureRule("rule.first", []);
  const second = fixtureRule("rule.second", []);
  const registry = createAdvisorRuleRegistry([first]);

  registry.register(second);
  assert.deepEqual(
    registry.list().map((r) => r.id),
    ["rule.first", "rule.second"],
  );
  assert.equal(registry.get("rule.second"), second);
  assert.throws(() => registry.register(fixtureRule("rule.first", [])), /already registered/);
  assert.throws(() => registry.register(fixtureRule("  ", [])), /non-empty id/);

  // An isolated registry never leaks into the app-wide one (which carries only the product rules).
  assert.equal(advisorRuleRegistry.get("rule.first"), undefined);
  assert.equal(advisorRuleRegistry.get("rule.second"), undefined);
  assert.equal(advisorRuleRegistry.list().length, ADVISOR_RULES.length);
});

// ── Runtime boundary ─────────────────────────────────────────────────────────────────────────────

test("the real repositories structurally satisfy the advisor read ports", () => {
  // Compile-time proof (this test fails `pnpm typecheck`, not at runtime, if a port drifts from the
  // repository it stands for). Nothing is instantiated: the ports must match without a DB handle,
  // which is exactly the point — a rule reads these narrow slices, never a `Database`.
  const servers = undefined as unknown as ServerRepository;
  const scans = undefined as unknown as ScanRepository;
  const scenarios = undefined as unknown as ScenarioRepository;
  const runs = undefined as unknown as RunRepository;
  const grades = undefined as unknown as GradeRepository;
  const suiteRuns = undefined as unknown as SuiteRunRepository;
  const skills = undefined as unknown as SkillRepository;

  const serverPort: AdvisorServerPort = servers;
  const scanPort: AdvisorScanPort = scans;
  const scenarioPort: AdvisorScenarioPort = scenarios;
  const runPort: AdvisorRunPort = runs;
  // WP 2.1 — the same compile-time proof for the three grade-aware ports.
  const gradePort: AdvisorGradePort = grades;
  const suiteRunPort: AdvisorSuiteRunPort = suiteRuns;
  const skillPort: AdvisorSkillPort = skills;

  assert.deepEqual(
    [serverPort, scanPort, scenarioPort, runPort, gradePort, suiteRunPort, skillPort],
    [undefined, undefined, undefined, undefined, undefined, undefined, undefined],
  );
});

test("the advisor context exposes no database handle for a rule to grab", () => {
  const ctx = stubContext();
  assert.deepEqual(Object.keys(ctx).sort(), [
    "grades",
    "models",
    "now",
    "runs",
    "scans",
    "scenarios",
    "servers",
    "skills",
    "suiteRuns",
  ]);
  assert.equal("db" in ctx, false);
});
