import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ASSERTION_DETAIL_LIMIT,
  ASSERTIONS_VERSION,
  type AssertionReport,
  type AssertionRuleResult,
  type AssertionScanRef,
  type AssertionSuiteRunRef,
  assertionSubjectId,
  assertionSubjectInstant,
  assertionSubjectLabel,
  renderAssertionMarkdown,
} from "./ci-assertions.js";

// `renderAssertionMarkdown` — the PR-comment artifact (planning/Roadmap/RM-08-ci/ WP 2.2, **D-C15**).
//
// This is the ONE place the comment body is built: not a second API endpoint (the evaluation is
// server-side; the formatting is the client's job — D-C6) and not a private copy in `apps/cli`
// (WP 2.3's workflow posts these exact bytes). So the tests here are about the body itself — what it
// says, that it says the same thing twice, and that it cannot carry anything it must not.

// ── fixtures ────────────────────────────────────────────────────────────────────────────────────

const SCAN: AssertionScanRef = {
  scanId: "scn_new",
  serverId: "srv_1",
  serverName: "Everything",
  scannedAt: "2026-08-19T10:00:00.000Z",
  tokenProfile: "generic_o200k",
  countingVersion: 2,
  totalTokens: 2410,
  totalTools: 21,
};

const SCAN_BASELINE: AssertionScanRef = {
  ...SCAN,
  scanId: "scn_old",
  scannedAt: "2026-08-18T10:00:00.000Z",
  totalTokens: 2224,
};

const SUITE: AssertionSuiteRunRef = {
  suiteRunId: "sr_new",
  suiteId: "ste_1",
  suiteName: "Nightly",
  source: "suite",
  startedAt: "2026-08-20T09:00:00.000Z",
  endedAt: "2026-08-20T09:30:00.000Z",
  status: "completed",
  cellsTotal: 6,
  cellsCompleted: 6,
  meanGrade: 0.79,
  execCostUsd: 1.2,
  judgeCostUsd: 0.11,
};

const SUITE_BASELINE: AssertionSuiteRunRef = {
  ...SUITE,
  suiteRunId: "sr_old",
  startedAt: "2026-08-19T09:00:00.000Z",
  endedAt: "2026-08-19T09:30:00.000Z",
  meanGrade: 0.84,
  execCostUsd: 0.9,
  judgeCostUsd: 0.12,
};

const PASSING: AssertionRuleResult = {
  rule: "max-server-tokens",
  status: "pass",
  message: "Server tokens 2,410 within budget 3,000.",
  observed: 2410,
  limit: 3000,
};

const FAILING: AssertionRuleResult = {
  rule: "max-tool-tokens",
  status: "fail",
  message: "2 of 21 tools exceed the 400-token budget.",
  observed: 1204,
  limit: 400,
  details: ["search_issues — 1,204 > 400", "create_issue — 502 > 400"],
};

const SKIPPED: AssertionRuleResult = {
  rule: "no-new-tools",
  status: "skipped",
  message: "no-new-tools could not be evaluated without a baseline.",
  skipReason: "there is nothing earlier to compare against.",
};

function report(overrides: Partial<AssertionReport> = {}): AssertionReport {
  const results = overrides.results ?? [PASSING];
  const failed = results.filter((result) => result.status === "fail").length;
  const skipped = results.filter((result) => result.status === "skipped").length;
  return {
    assertionsVersion: ASSERTIONS_VERSION,
    evaluatedAt: "2026-08-20T12:00:00.000Z",
    subject: { kind: "scan", ...SCAN },
    baseline: { requested: "previous", scan: { kind: "scan", ...SCAN_BASELINE } },
    results,
    counts: {
      total: results.length,
      passed: results.length - failed - skipped,
      failed,
      skipped,
    },
    passed: failed === 0,
    ...overrides,
  };
}

function suiteReport(overrides: Partial<AssertionReport> = {}): AssertionReport {
  return report({
    subject: { kind: "suite_run", ...SUITE },
    baseline: { requested: "previous", scan: { kind: "suite_run", ...SUITE_BASELINE } },
    results: [
      {
        rule: "min-suite-score",
        status: "fail",
        message: "Mean grade 0.79 is below the required 0.80.",
        observed: 0.79,
        limit: 0.8,
      },
      {
        rule: "max-suite-cost",
        status: "pass",
        message: "Suite run cost $1.31 (execution $1.20 + judge $0.11) is within the $2.00 budget.",
        observed: 1.31,
        limit: 2,
      },
    ],
    ...overrides,
  });
}

// ── the verdict heading ─────────────────────────────────────────────────────────────────────────

describe("renderAssertionMarkdown — the verdict heading", () => {
  it("leads with pass or fail, and says how many rules did not run", () => {
    assert.match(renderAssertionMarkdown(report()), /^## ✅ mcpfp gate passed\n/);
    assert.match(
      renderAssertionMarkdown(report({ results: [PASSING, FAILING] })),
      /^## ❌ mcpfp gate failed\n/,
    );
    // A skip is neither a pass nor a failure — it is "this rule did not actually run", and it
    // belongs in the one line a reviewer is guaranteed to read.
    assert.match(
      renderAssertionMarkdown(report({ results: [PASSING, SKIPPED] })),
      /^## ✅ mcpfp gate passed — 1 skipped\n/,
    );
    assert.match(
      renderAssertionMarkdown(report({ results: [FAILING, SKIPPED, SKIPPED] })),
      /^## ❌ mcpfp gate failed — 2 skipped\n/,
    );
  });

  it("trusts the report's own verdict rather than recounting the rows", () => {
    // The same client invariant the CLI holds: the API evaluates, everything else renders.
    const contradictory = report({
      results: [PASSING],
      counts: { total: 1, passed: 0, failed: 1, skipped: 0 },
      passed: false,
    });
    assert.match(renderAssertionMarkdown(contradictory), /^## ❌ mcpfp gate failed\n/);
  });
});

// ── the identity line ───────────────────────────────────────────────────────────────────────────

describe("renderAssertionMarkdown — the identity line", () => {
  it("names a scan subject by server, id and capture instant", () => {
    assert.match(
      renderAssertionMarkdown(report()),
      /\*\*Everything \(srv_1\)\*\* · scan `scn_new` · captured 2026-08-19T10:00:00\.000Z/,
    );
  });

  it("names a suite subject by suite, run id and start instant", () => {
    assert.match(
      renderAssertionMarkdown(suiteReport()),
      /\*\*Nightly \(ste_1\)\*\* · suite run `sr_new` · captured 2026-08-20T09:00:00\.000Z/,
    );
  });

  it("exposes the same identity through the shared accessors", () => {
    assert.equal(assertionSubjectId({ kind: "scan", ...SCAN }), "scn_new");
    assert.equal(assertionSubjectId({ kind: "suite_run", ...SUITE }), "sr_new");
    assert.equal(assertionSubjectInstant({ kind: "scan", ...SCAN }), "2026-08-19T10:00:00.000Z");
    assert.equal(
      assertionSubjectInstant({ kind: "suite_run", ...SUITE }),
      "2026-08-20T09:00:00.000Z",
    );
    assert.equal(assertionSubjectLabel({ kind: "scan", ...SCAN }), "Everything (srv_1)");
    assert.equal(assertionSubjectLabel({ kind: "suite_run", ...SUITE }), "Nightly (ste_1)");
    // A run with no saved suite carries an honest label and no invented id.
    const { suiteId: _suiteId, ...orphan } = SUITE;
    assert.equal(
      assertionSubjectLabel({ kind: "suite_run", ...orphan, suiteName: "(no saved suite — adhoc plan)" }),
      "(no saved suite — adhoc plan)",
    );
  });
});

// ── the delta sentence ──────────────────────────────────────────────────────────────────────────

describe("renderAssertionMarkdown — the delta sentence", () => {
  it("renders a scan delta with the absolute change and the percentage", () => {
    const body = renderAssertionMarkdown(report());
    assert.match(body, /Tokens 2,224 → 2,410 \(\+186, \+8\.4%\)/);
    assert.match(body, /against scan `scn_old` \(2026-08-18T10:00:00\.000Z, asked for `previous`\)/);
  });

  it("renders a DROP with a real minus sign, so the direction survives a copy", () => {
    const dropped = report({
      subject: { kind: "scan", ...SCAN, totalTokens: 2000 },
    });
    assert.match(renderAssertionMarkdown(dropped), /Tokens 2,224 → 2,000 \(−224, −10\.1%\)/);
  });

  it("renders a suite delta as both a grade line and a cost line", () => {
    const body = renderAssertionMarkdown(suiteReport());
    assert.match(body, /Mean grade 0\.84 → 0\.79 \(−0\.05\)/);
    // 0.90 + 0.12 = 1.02 → 1.20 + 0.11 = 1.31.
    assert.match(body, /Cost \$1\.02 → \$1\.31 \(\+\$0\.29\)/);
    assert.match(body, /Compared against suite run `sr_old`/);
  });

  it("says so honestly when a grade is missing on either side", () => {
    const ungraded = suiteReport({
      subject: { kind: "suite_run", ...SUITE, meanGrade: null },
    });
    const body = renderAssertionMarkdown(ungraded);
    assert.match(body, /Mean grade 0\.84 → none \(no delta — one side has no graded score\)/);
    // The cost half still renders — half the story is better than none.
    assert.match(body, /Cost \$1\.02 → \$1\.31/);
  });

  it("omits the percentage rather than dividing by zero", () => {
    const fromNothing = report({
      baseline: {
        requested: "previous",
        scan: { kind: "scan", ...SCAN_BASELINE, totalTokens: 0 },
      },
    });
    const body = renderAssertionMarkdown(fromNothing);
    assert.match(body, /Tokens 0 → 2,410 \(\+2,410\)/);
    assert.ok(!/Infinity|NaN/.test(body), "a zero baseline must not print Infinity or NaN");
  });

  it("distinguishes 'nothing earlier yet' from 'this gate named none'", () => {
    const named = report({
      baseline: null,
      baselineSkipReason: 'No earlier completed scan of "Everything" — scn_new is the first one.',
      results: [PASSING],
    });
    assert.match(
      renderAssertionMarkdown(named),
      /No baseline was compared — No earlier completed scan of "Everything"/,
    );

    const unnamed = report({ baseline: null, results: [PASSING] });
    assert.match(renderAssertionMarkdown(unnamed), /No baseline was compared — this gate named none\./);
  });
});

// ── the rules table ─────────────────────────────────────────────────────────────────────────────

describe("renderAssertionMarkdown — the rules table", () => {
  it("lists every rule with its status, observed value and limit", () => {
    const body = renderAssertionMarkdown(report({ results: [PASSING, FAILING, SKIPPED] }));
    assert.match(body, /\| Rule \| Status \| Observed \| Limit \|\n\| --- \| --- \| --- \| --- \|/);
    assert.match(body, /\| `max-server-tokens` \| ✅ pass \| 2,410 \| 3,000 \|/);
    assert.match(body, /\| `max-tool-tokens` \| ❌ fail \| 1,204 \| 400 \|/);
    // A rule that measured nothing shows an em dash rather than an empty cell or a zero.
    assert.match(body, /\| `no-new-tools` \| ⚠️ skipped \| — \| — \|/);
  });

  it("does NOT round a fractional measure to a whole number", () => {
    // `formatNumber` rounds — a mean grade of 0.79 rendered as "1" would turn the table into a lie.
    const body = renderAssertionMarkdown(suiteReport());
    assert.match(body, /\| `min-suite-score` \| ❌ fail \| 0\.79 \| 0\.80 \|/);
    assert.match(body, /\| `max-suite-cost` \| ✅ pass \| 1\.31 \| 2 \|/);
  });
});

// ── the failure details ─────────────────────────────────────────────────────────────────────────

describe("renderAssertionMarkdown — the failure details", () => {
  it("collapses one block per failing rule that itemized something", () => {
    const body = renderAssertionMarkdown(report({ results: [PASSING, FAILING] }));
    assert.match(body, /<details>\n<summary>❌ max-tool-tokens — 2 of 21 tools exceed the 400-token budget\.<\/summary>/);
    assert.match(body, /- search_issues — 1,204 > 400\n- create_issue — 502 > 400/);
    assert.match(body, /<\/details>/);
  });

  it("emits no block for a PASSING rule, or for a failing one with nothing to itemize", () => {
    const passingWithDetails: AssertionRuleResult = { ...FAILING, status: "pass" };
    assert.ok(!renderAssertionMarkdown(report({ results: [passingWithDetails] })).includes("<details>"));

    const { details: _details, ...bare } = FAILING;
    assert.ok(!renderAssertionMarkdown(report({ results: [bare] })).includes("<details>"));
  });

  it("never re-caps and never un-caps the API's itemization", () => {
    // The cap is the API's (`capAssertionDetails`); the renderer prints what it was handed, so a
    // second cap here would silently hide lines the operator was told to expect.
    const lines = Array.from({ length: ASSERTION_DETAIL_LIMIT + 1 }, (_, index) => `tool_${index}`);
    const body = renderAssertionMarkdown(report({ results: [{ ...FAILING, details: lines }] }));
    for (const line of lines) assert.ok(body.includes(`- ${line}`), line);
  });
});

// ── the footer, determinism, and what the body may never carry ──────────────────────────────────

describe("renderAssertionMarkdown — the contract of the artifact", () => {
  it("closes with the assertions version and the evaluation instant", () => {
    assert.match(
      renderAssertionMarkdown(report()),
      /<sub>mcpfp assertions v1 · evaluated 2026-08-20T12:00:00\.000Z<\/sub>\n$/,
    );
  });

  it("is deterministic — the same report renders byte-for-byte the same body", () => {
    for (const input of [report({ results: [PASSING, FAILING, SKIPPED] }), suiteReport()]) {
      assert.equal(renderAssertionMarkdown(input), renderAssertionMarkdown(input));
      // …and from a structurally equal but distinct object, so nothing is memoized by identity.
      assert.equal(
        renderAssertionMarkdown(input),
        renderAssertionMarkdown(JSON.parse(JSON.stringify(input)) as AssertionReport),
      );
    }
  });

  it("carries no credential, no absolute path and no filesystem detail", () => {
    // A PR comment is the most public thing this workstream produces. The report's identity refs
    // carry no secret by construction; this is the second line of defence.
    const bodies = [
      renderAssertionMarkdown(report({ results: [PASSING, FAILING, SKIPPED] })),
      renderAssertionMarkdown(suiteReport()),
      renderAssertionMarkdown(report({ baseline: null, baselineSkipReason: "first scan." })),
    ];
    for (const body of bodies) {
      assert.ok(!/mcpfp_[A-Za-z0-9_-]{8,}/.test(body), "no service token");
      assert.ok(!/\b(?:sk|ghp|gho|github_pat)[-_][A-Za-z0-9_-]{8,}/.test(body), "no provider key");
      assert.ok(!/Bearer\s/i.test(body), "no authorization header");
      // No `/`-rooted path: a `/Users/…`, a `/data/app.sqlite`, a `C:\…`.
      assert.ok(!/(?:^|[\s(`"'])\/[A-Za-z._]/m.test(body), `no absolute path in:\n${body}`);
      assert.ok(!/[A-Za-z]:\\/.test(body), "no Windows path");
      assert.ok(!/\bfile:\/\//.test(body), "no file URL");
      assert.ok(!/\.sqlite|node_modules|\bcwd\b/.test(body), "no filesystem detail");
    }
  });

  it("renders the sections in order, and nothing else", () => {
    const body = renderAssertionMarkdown(report({ results: [PASSING, FAILING] }));
    const order = [
      body.indexOf("## ❌ mcpfp gate failed"),
      body.indexOf("**Everything (srv_1)**"),
      body.indexOf("Tokens 2,224 → 2,410"),
      body.indexOf("| Rule | Status |"),
      body.indexOf("<details>"),
      body.indexOf("<sub>mcpfp assertions"),
    ];
    assert.ok(
      order.every((position, index) => position > (order[index - 1] ?? -1)),
      `sections out of order: ${JSON.stringify(order)}`,
    );
  });
});
