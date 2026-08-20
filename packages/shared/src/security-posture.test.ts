import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  SECURITY_ANALYZER_VERSION,
  SECURITY_CREDENTIAL_PREFIX_PATTERNS,
  SECURITY_EVIDENCE_MAX_CHARS,
  SECURITY_FINDING_LIMIT,
  SECURITY_REDACTION_MARKER,
  SECURITY_RULE_CATEGORIES,
  SECURITY_RULE_IDS,
  SECURITY_RULES,
  SECURITY_SCORE_BANDS,
  SECURITY_SEVERITIES,
  SECURITY_SEVERITY_DEDUCTION,
  SECURITY_SUBJECT_KINDS,
  type SecurityFinding,
  type SecurityFindingAnchor,
  type SecurityReport,
  type SecurityRule,
  type SecurityRuleId,
  type SecuritySeverity,
  type SecuritySubjectKind,
  capSecurityFindings,
  compareSecurityFindings,
  computeSecurityScore,
  createSecurityFinding,
  diffSecurityReports,
  findPrefixedCredential,
  redactSecurityEvidence,
  securityDiffQuerySchema,
  securityFindingAnchorKey,
  securityFindingCountsSchema,
  securityFindingIdentity,
  securityFindingSchema,
  securityPostureDiffSchema,
  securityReportSchema,
} from "./security-posture.js";

// The contract is WP 1.1's only deliverable, so these tests are the contract's teeth: they pin the
// frozen rule ids (D-SP2), the registry-owned severity (D-SP5), the documented score table (D-SP3),
// the totality of the emit order (D-SP6) and the fact that the redactor actually bites (D-SP4).
// Nothing here analyses anything — there is nothing to analyse yet; WP 1.2 brings the rules.

/**
 * Every id this workstream freezes, with the severity it was frozen at. Written out a second time, by
 * hand, so a rename is a red test rather than a quiet re-point (D-SP2) and a severity drift is a red
 * test rather than a silent change in what a CI gate counts (D-SP5).
 *
 * WP 1.1 froze the eleven `subject: "server"` ids; WP 1.3 ADDED the seven `subject: "skill"` ids
 * below without touching one of them, which is why `SECURITY_ANALYZER_VERSION` is still 1.
 */
const FROZEN_SERVER_RULES: Record<string, SecuritySeverity> = {
  "annotation.destructive-unmarked": "warning",
  "annotation.open-world-unmarked": "info",
  "annotation.readonly-contradiction": "error",
  "oauth.broad-scope": "warning",
  "poisoning.hidden-instructions": "error",
  "poisoning.injection-phrasing": "error",
  "poisoning.invisible-unicode": "error",
  "poisoning.oversized-description": "warning",
  "schema.secret-shaped-parameter": "warning",
  "schema.undescribed-parameter": "info",
  "schema.unconstrained-additional-properties": "info",
};

/** The seven WP 1.3 froze. Only the three "this skill is steering the model" checks are `error`. */
const FROZEN_SKILL_RULES: Record<string, SecuritySeverity> = {
  "skill-surface.broad-allowed-tools": "warning",
  "skill-surface.credential-in-body": "warning",
  "skill-surface.executable-scripts": "info",
  "skill-surface.hidden-instructions": "error",
  "skill-surface.injection-phrasing": "error",
  "skill-surface.invisible-unicode": "error",
  "skill-surface.network-reference": "info",
};

const FROZEN_RULES: Record<string, SecuritySeverity> = {
  ...FROZEN_SERVER_RULES,
  ...FROZEN_SKILL_RULES,
};

// Written as escape sequences on purpose: a literal invisible character in a test file is
// unreviewable, which is the same reason the redactor rewrites them in an excerpt.
const ZERO_WIDTH_SPACE = "\u200B";
const RIGHT_TO_LEFT_OVERRIDE = "\u202E";

/** The two subject-level anchors, named so the D-SP12 tests read as the comparison they are. */
const SERVER: SecurityFindingAnchor = { kind: "server" };
const SKILL: SecurityFindingAnchor = { kind: "skill" };

/** Build N findings of one severity, for the score table and the cap. */
function findingsOfSeverity(severity: SecuritySeverity, count: number): SecurityFinding[] {
  const ruleId = SECURITY_RULE_IDS.find((id) => SECURITY_RULES[id].severity === severity);
  assert.ok(ruleId, `the registry must declare at least one ${severity} rule`);
  return Array.from({ length: count }, (_unused, index) =>
    createSecurityFinding({
      ruleId,
      anchor: { kind: "tool", toolName: `tool_${index}` },
      message: `finding ${index}`,
    }),
  );
}

describe("security rule registry (D-SP2)", () => {
  it("keys every entry by its own id", () => {
    for (const id of SECURITY_RULE_IDS) {
      const rule: SecurityRule = SECURITY_RULES[id];
      assert.equal(rule.id, id, `${id} is filed under a key that is not its own id`);
    }
  });

  it("uses a category.kebab-slug id whose prefix is a declared category", () => {
    for (const id of SECURITY_RULE_IDS) {
      assert.match(id, /^[a-z-]+\.[a-z0-9-]+$/, `${id} is not a category.kebab-slug id`);
      const rule: SecurityRule = SECURITY_RULES[id];
      const prefix = id.slice(0, id.indexOf("."));
      assert.ok(
        (SECURITY_RULE_CATEGORIES as readonly string[]).includes(prefix),
        `${id} names ${prefix}, which is not a declared category`,
      );
      assert.equal(rule.category, prefix, `${id}'s category must match its own id prefix`);
    }
  });

  it("declares a real severity, a title and a rationale an operator can act on", () => {
    for (const id of SECURITY_RULE_IDS) {
      const rule: SecurityRule = SECURITY_RULES[id];
      assert.ok(
        (SECURITY_SEVERITIES as readonly string[]).includes(rule.severity),
        `${id} declares ${rule.severity}, which is not a severity`,
      );
      assert.ok(rule.title.length > 0, `${id} needs a title an operator can scan`);
      // A placeholder rationale ("todo", "n/a") is the failure mode this length floor catches: a
      // rule nobody can act on is a rule that gets ignored, which is worse than no rule at all.
      assert.ok(
        rule.rationale.length >= 40,
        `${id} needs a real rationale, got ${rule.rationale.length} characters`,
      );
      assert.match(rule.rationale, /\.$/, `${id}'s rationale must be a finished sentence`);
    }
  });

  it("declares exactly the eighteen frozen rules, at their frozen severities", () => {
    assert.equal(SECURITY_RULE_IDS.length, 18);
    assert.deepEqual([...SECURITY_RULE_IDS].sort(), Object.keys(FROZEN_RULES).sort());
    assert.equal(new Set(SECURITY_RULE_IDS).size, SECURITY_RULE_IDS.length, "ids must be unique");
    for (const id of SECURITY_RULE_IDS) {
      assert.equal(SECURITY_RULES[id].severity, FROZEN_RULES[id], `${id} changed severity`);
    }
  });

  it("splits the registry eleven server / seven skill, each rule under its own subject", () => {
    const bySubject = (kind: SecuritySubjectKind) =>
      SECURITY_RULE_IDS.filter((id) => SECURITY_RULES[id].subject === kind).sort();

    assert.deepEqual(bySubject("server"), Object.keys(FROZEN_SERVER_RULES).sort());
    assert.deepEqual(bySubject("skill"), Object.keys(FROZEN_SKILL_RULES).sort());
    assert.ok((SECURITY_SUBJECT_KINDS as readonly string[]).includes("skill"));

    // Every skill rule sits in the `skill-surface` category and every server rule outside it, so the
    // id itself tells a reader which analyzer emits it without a lookup.
    for (const id of bySubject("skill")) assert.equal(SECURITY_RULES[id].category, "skill-surface");
    for (const id of bySubject("server")) {
      assert.notEqual(
        SECURITY_RULES[id].category,
        "skill-surface",
        `${id} is filed as a skill rule`,
      );
    }
  });

  it("keeps WP 1.1's eleven server rules byte-frozen, which is why the version is still 1", () => {
    // The forcing function for D-SP2. Adding the seven skill ids is additive; re-pointing, renaming
    // or re-severitying one of the eleven is not, and would demand a `SECURITY_ANALYZER_VERSION`
    // bump — so it must be a red test, not a judgement call.
    for (const [id, severity] of Object.entries(FROZEN_SERVER_RULES)) {
      const rule: SecurityRule | undefined = SECURITY_RULES[id as SecurityRuleId];
      assert.ok(rule, `${id} disappeared from the registry`);
      assert.equal(rule.severity, severity, `${id} changed severity`);
      assert.equal(rule.subject, "server", `${id} changed subject`);
    }
    assert.equal(SECURITY_ANALYZER_VERSION, 1);
  });
});

describe("createSecurityFinding (D-SP5)", () => {
  it("always takes the severity from the registry, for every declared rule", () => {
    for (const id of SECURITY_RULE_IDS) {
      const finding = createSecurityFinding({
        ruleId: id,
        anchor: { kind: "server" },
        message: "found something",
      });
      assert.equal(
        finding.severity,
        SECURITY_RULES[id].severity,
        `${id} escalated or de-escalated`,
      );
    }
  });

  it("ignores a severity a caller smuggles in past the type", () => {
    // The signature has no `severity` parameter, so this is only reachable through a cast — which is
    // exactly what an analyzer author under deadline pressure would try. It must do nothing.
    const smuggled = {
      ruleId: "annotation.open-world-unmarked" as SecurityRuleId,
      anchor: { kind: "server" } as const,
      message: "found something",
      severity: "error",
    } as Parameters<typeof createSecurityFinding>[0];
    assert.equal(createSecurityFinding(smuggled).severity, "info");
  });

  it("forces evidence through the redactor rather than accepting a finished excerpt", () => {
    const finding = createSecurityFinding({
      ruleId: "schema.secret-shaped-parameter",
      anchor: { kind: "parameter", toolName: "send", parameterPath: "auth.token" },
      message: "default value looks like a credential",
      evidence: { raw: `default=mcpfp_${"A".repeat(43)}`, offset: 8 },
    });
    assert.ok(finding.evidence);
    assert.ok(finding.evidence.excerpt.includes(SECURITY_REDACTION_MARKER));
    assert.ok(!finding.evidence.excerpt.includes("mcpfp_"));
    assert.equal(finding.evidence.offset, 8);
  });

  it("omits `evidence` entirely when the rule has none", () => {
    const finding = createSecurityFinding({
      ruleId: "oauth.broad-scope",
      anchor: { kind: "server" },
      message: "the stored grant is account-wide",
    });
    assert.equal(Object.hasOwn(finding, "evidence"), false);
  });
});

describe("computeSecurityScore (D-SP3)", () => {
  it("applies exactly the documented weights", () => {
    assert.deepEqual(SECURITY_SEVERITY_DEDUCTION, { error: 15, warning: 5, info: 1 });
    for (const severity of SECURITY_SEVERITIES) {
      assert.equal(typeof SECURITY_SEVERITY_DEDUCTION[severity], "number");
    }
  });

  it("matches the documented score table", () => {
    assert.deepEqual(computeSecurityScore([]), {
      value: 100,
      band: "clean",
      analyzerVersion: SECURITY_ANALYZER_VERSION,
    });
    assert.equal(computeSecurityScore(findingsOfSeverity("info", 1)).value, 99);
    assert.equal(computeSecurityScore(findingsOfSeverity("info", 1)).band, "low");
    assert.equal(computeSecurityScore(findingsOfSeverity("warning", 2)).value, 90);
    assert.equal(computeSecurityScore(findingsOfSeverity("warning", 2)).band, "low");

    const errorAndWarning = [
      ...findingsOfSeverity("error", 1),
      ...findingsOfSeverity("warning", 1),
    ];
    assert.equal(computeSecurityScore(errorAndWarning).value, 80);
    assert.equal(computeSecurityScore(errorAndWarning).band, "medium");

    assert.equal(computeSecurityScore(findingsOfSeverity("error", 3)).value, 55);
    assert.equal(computeSecurityScore(findingsOfSeverity("error", 3)).band, "high");
  });

  it("floors at 0 rather than going negative", () => {
    const score = computeSecurityScore(findingsOfSeverity("error", 7));
    assert.equal(score.value, 0);
    assert.equal(score.band, "high");
  });

  it("breaks the bands at exactly 100 / 90 / 70", () => {
    // 100 -> clean, 99 -> low: a single `info` must drop a server out of `clean`.
    assert.equal(computeSecurityScore([]).band, "clean");
    assert.equal(computeSecurityScore(findingsOfSeverity("info", 1)).band, "low");
    // 90 -> low, 89 -> medium.
    assert.equal(computeSecurityScore(findingsOfSeverity("warning", 2)).value, 90);
    assert.equal(computeSecurityScore(findingsOfSeverity("warning", 2)).band, "low");
    const eightyNine = [...findingsOfSeverity("warning", 2), ...findingsOfSeverity("info", 1)];
    assert.equal(computeSecurityScore(eightyNine).value, 89);
    assert.equal(computeSecurityScore(eightyNine).band, "medium");
    // 70 -> medium, 69 -> high.
    assert.equal(computeSecurityScore(findingsOfSeverity("error", 2)).value, 70);
    assert.equal(computeSecurityScore(findingsOfSeverity("error", 2)).band, "medium");
    const sixtyNine = [...findingsOfSeverity("error", 2), ...findingsOfSeverity("info", 1)];
    assert.equal(computeSecurityScore(sixtyNine).value, 69);
    assert.equal(computeSecurityScore(sixtyNine).band, "high");
    // Every band declared in the vocabulary is actually reachable.
    assert.deepEqual([...SECURITY_SCORE_BANDS], ["clean", "low", "medium", "high"]);
  });

  it("echoes the analyzer version so a stored score is never re-banded later", () => {
    assert.equal(computeSecurityScore([]).analyzerVersion, SECURITY_ANALYZER_VERSION);
    assert.equal(SECURITY_ANALYZER_VERSION, 1);
  });
});

describe("compareSecurityFindings (D-SP6)", () => {
  // Deliberately exercises the comparator's components — including pairs that differ ONLY in the
  // message, ONLY in the offset and ONLY in whether evidence is present — rather than modelling
  // realistic analyzer output. Totality is what is under test.
  const fixture: SecurityFinding[] = [
    createSecurityFinding({
      ruleId: "poisoning.injection-phrasing",
      anchor: { kind: "server" },
      message: "a",
    }),
    createSecurityFinding({
      ruleId: "poisoning.injection-phrasing",
      anchor: { kind: "server" },
      message: "b",
    }),
    createSecurityFinding({
      ruleId: "poisoning.invisible-unicode",
      anchor: { kind: "tool", toolName: "alpha" },
      message: "m",
    }),
    createSecurityFinding({
      ruleId: "poisoning.invisible-unicode",
      anchor: { kind: "tool", toolName: "beta" },
      message: "m",
    }),
    createSecurityFinding({
      ruleId: "schema.undescribed-parameter",
      anchor: { kind: "parameter", toolName: "alpha", parameterPath: "a" },
      message: "m",
    }),
    createSecurityFinding({
      ruleId: "schema.undescribed-parameter",
      anchor: { kind: "parameter", toolName: "alpha", parameterPath: "b" },
      message: "m",
    }),
    createSecurityFinding({
      ruleId: "annotation.destructive-unmarked",
      anchor: { kind: "file", path: "scripts/wipe.sh" },
      message: "m",
    }),
    createSecurityFinding({
      ruleId: "annotation.open-world-unmarked",
      anchor: { kind: "tool", toolName: "alpha" },
      message: "m",
    }),
    createSecurityFinding({
      ruleId: "oauth.broad-scope",
      anchor: { kind: "server" },
      message: "m",
      evidence: { raw: "scope-one" },
    }),
    createSecurityFinding({
      ruleId: "oauth.broad-scope",
      anchor: { kind: "server" },
      message: "m",
      evidence: { raw: "scope-two" },
    }),
    createSecurityFinding({
      ruleId: "oauth.broad-scope",
      anchor: { kind: "server" },
      message: "m",
      evidence: { raw: "scope-one", offset: 4 },
    }),
    createSecurityFinding({
      ruleId: "oauth.broad-scope",
      anchor: { kind: "server" },
      message: "m",
    }),
  ];

  it("never compares two distinct findings equal", () => {
    for (let i = 0; i < fixture.length; i += 1) {
      for (let j = 0; j < fixture.length; j += 1) {
        const left = fixture[i];
        const right = fixture[j];
        assert.ok(left && right);
        const order = compareSecurityFindings(left, right);
        if (i === j) {
          assert.equal(order, 0, "a finding must compare equal to itself");
        } else {
          assert.notEqual(order, 0, `findings ${i} and ${j} are distinct but compare 0`);
        }
      }
    }
  });

  it("is antisymmetric", () => {
    for (const left of fixture) {
      for (const right of fixture) {
        // Summed rather than negated: `Math.sign(0)` is `0` and `-Math.sign(0)` is `-0`, which
        // `assert.equal` treats as different values. The sum is +0 for every antisymmetric pair.
        assert.equal(
          Math.sign(compareSecurityFindings(left, right)) +
            Math.sign(compareSecurityFindings(right, left)),
          0,
        );
      }
    }
  });

  it("sorts any permutation to the identical, byte-stable array", () => {
    const forwards = [...fixture].sort(compareSecurityFindings);
    const backwards = [...fixture].reverse().sort(compareSecurityFindings);
    const rotated = [...fixture.slice(5), ...fixture.slice(0, 5)].sort(compareSecurityFindings);
    assert.deepEqual(backwards, forwards);
    assert.deepEqual(rotated, forwards);
    assert.equal(JSON.stringify(backwards), JSON.stringify(forwards));
    assert.equal(JSON.stringify(rotated), JSON.stringify(forwards));
    // Sorting an already-sorted report is a no-op, so a re-emit cannot reorder it.
    assert.equal(
      JSON.stringify([...forwards].sort(compareSecurityFindings)),
      JSON.stringify(forwards),
    );
  });

  it("puts the worst severity first", () => {
    const sorted = [...fixture].sort(compareSecurityFindings);
    assert.equal(sorted[0]?.severity, "error");
    assert.equal(sorted[sorted.length - 1]?.severity, "info");
    const ranks = sorted.map((finding) => SECURITY_SEVERITIES.indexOf(finding.severity));
    assert.deepEqual(
      ranks,
      [...ranks].sort((a, b) => a - b),
      "severity must never go back up",
    );
  });
});

describe("the `skill` anchor (D-SP12)", () => {
  it("is a real member of the type, the rank table, the key function and the zod union", () => {
    const finding = createSecurityFinding({
      ruleId: "skill-surface.executable-scripts",
      anchor: { kind: "skill" },
      message: "the version ships 3 script files",
    });
    assert.deepEqual(finding.anchor, { kind: "skill" });
    // Like `server`, it names no component, so its key is its kind alone — and it is DISTINCT from
    // `server`'s, which is the whole reason it exists rather than borrowing that one.
    assert.equal(securityFindingAnchorKey({ kind: "skill" }), "skill");
    assert.notEqual(
      securityFindingAnchorKey({ kind: "skill" }),
      securityFindingAnchorKey({ kind: "server" }),
    );
    assert.equal(securityFindingSchema.safeParse(finding).success, true);
    assert.equal(
      securityFindingSchema.safeParse({ ...finding, anchor: { kind: "skill", path: "x" } }).success,
      false,
      "the new variant must be `.strict()` like every other one",
    );
  });

  it("gives a `skill` anchor and a `server` anchor distinct identities", () => {
    // `securityFindingIdentity` is what CI WP 3.1 and WP 1.4's diff both key on. Had the skill
    // finding borrowed `{ kind: "server" }`, a skill and a server firing the same rule id would
    // collide — which is the second, load-bearing reason D-SP12 added a kind instead of reusing one.
    const skill = { ruleId: "skill-surface.executable-scripts" as SecurityRuleId, anchor: SKILL };
    const server = { ruleId: "skill-surface.executable-scripts" as SecurityRuleId, anchor: SERVER };
    assert.notEqual(securityFindingIdentity(skill), securityFindingIdentity(server));
    assert.equal(securityFindingIdentity(skill), "skill-surface.executable-scripts|skill");
  });

  it("ranks LAST, so no pre-existing pair's relative order can have moved", () => {
    // Every pair of the four ORIGINAL kinds, sorted, must come out in the order WP 1.1 shipped:
    // server → tool → parameter → file. Appending `skill` at rank 4 cannot disturb that; inserting
    // it anywhere else would have silently reordered every report that already exists.
    const sameRule = (anchor: SecurityFinding["anchor"]) =>
      createSecurityFinding({
        ruleId: "poisoning.invisible-unicode",
        anchor,
        message: "m",
      });
    const original = [
      sameRule({ kind: "file", path: "a" }),
      sameRule({ kind: "parameter", toolName: "t", parameterPath: "p" }),
      sameRule({ kind: "tool", toolName: "t" }),
      sameRule(SERVER),
    ].sort(compareSecurityFindings);
    assert.deepEqual(
      original.map((finding) => finding.anchor.kind),
      ["server", "tool", "parameter", "file"],
    );

    // …and the same four with a `skill` finding mixed in keep that order, with `skill` last.
    const withSkill = [...original, sameRule(SKILL)].sort(compareSecurityFindings);
    assert.deepEqual(
      withSkill.map((finding) => finding.anchor.kind),
      ["server", "tool", "parameter", "file", "skill"],
    );
  });

  it("sorts a mixed skill/file report stably and round-trips through the report schema", () => {
    const findings = [
      createSecurityFinding({
        ruleId: "skill-surface.network-reference",
        anchor: { kind: "file", path: "SKILL.md" },
        message: "an absolute URL",
      }),
      createSecurityFinding({
        ruleId: "skill-surface.executable-scripts",
        anchor: SKILL,
        message: "3 scripts",
      }),
      createSecurityFinding({
        ruleId: "skill-surface.invisible-unicode",
        anchor: SKILL,
        message: "an invisible character in the frontmatter",
      }),
      createSecurityFinding({
        ruleId: "skill-surface.invisible-unicode",
        anchor: { kind: "file", path: "scripts/run.sh" },
        message: "an invisible character in a path",
      }),
    ];
    const forwards = [...findings].sort(compareSecurityFindings);
    const backwards = [...findings].reverse().sort(compareSecurityFindings);
    assert.equal(JSON.stringify(backwards), JSON.stringify(forwards));

    const report: SecurityReport = {
      analyzerVersion: SECURITY_ANALYZER_VERSION,
      generatedAt: "2026-08-20T10:00:00.000Z",
      subject: {
        kind: "skill",
        id: "ver_01",
        ownerId: "skl_01",
        name: "Report writer",
        capturedAt: "2026-08-20T09:00:00.000Z",
      },
      findings: forwards,
      counts: { error: 2, warning: 0, info: 2, total: 4 },
      score: computeSecurityScore(forwards),
      truncated: false,
    };
    assert.deepEqual(securityReportSchema.parse(report), report);
  });
});

describe("findPrefixedCredential (D-SP13)", () => {
  // The asymmetry, shown in ONE place: detection is precise, redaction is generous, and both read
  // the same list of prefix shapes. An over-masked identifier costs an operator a question; a rule
  // that fires on every commit sha costs them the whole report.
  const SHA = "5f2c9a1b3d4e6f708192a3b4c5d6e7f809a1b2c3"; // 40 hex characters
  const SLUG = "generate-quarterly-revenue-summary-report"; // a long, honest kebab slug

  it("fires on the prefixed shapes an operator can act on", () => {
    for (const raw of [
      `token = mcpfp_${"A".repeat(43)}`,
      `key: sk-${"B".repeat(40)}`,
      `export GH=ghp_${"c".repeat(36)}`,
    ]) {
      const hit = findPrefixedCredential(raw);
      assert.ok(hit, `${raw.slice(0, 12)}… was not detected`);
      assert.ok(raw.includes(hit.match));
      assert.equal(raw.slice(hit.offset, hit.offset + hit.match.length), hit.match);
    }
  });

  it("is SILENT on a commit sha and a long slug — the whole point of the split", () => {
    assert.equal(findPrefixedCredential(`See commit ${SHA} for context.`), null);
    assert.equal(findPrefixedCredential(`Run the ${SLUG} workflow.`), null);
    assert.equal(findPrefixedCredential("no credential here at all"), null);
    assert.equal(findPrefixedCredential(""), null);
  });

  it("still lets the REDACTOR mask all four, including the two the rule ignores", () => {
    // Side by side, as the acceptance asks: the two halves disagree on purpose.
    for (const raw of [
      `token = mcpfp_${"A".repeat(43)}`,
      `key: sk-${"B".repeat(40)}`,
      `export GH=ghp_${"c".repeat(36)}`,
      `See commit ${SHA} for context.`,
    ]) {
      assert.ok(
        redactSecurityEvidence(raw).excerpt.includes(SECURITY_REDACTION_MARKER),
        `the redactor let ${raw.slice(0, 16)}… through`,
      );
    }
  });

  it("returns the EARLIEST match, so the answer is total and a report stays byte-stable", () => {
    const raw = `a sk-${"B".repeat(20)} then mcpfp_${"A".repeat(43)}`;
    const first = findPrefixedCredential(raw);
    assert.ok(first);
    assert.equal(first.offset, raw.indexOf("sk-"));
    // Called twice in a row it must answer identically: the prefix patterns carry the `g` flag, and
    // a matcher whose `lastIndex` survived a call would give a different answer the second time.
    assert.deepEqual(findPrefixedCredential(raw), first);
    assert.deepEqual(findPrefixedCredential(raw), first);
  });

  it("keeps one definition of each prefix shape", () => {
    // `CREDENTIAL_PATTERNS` is built FROM this list plus the catch-all, so a shape cannot be fixed in
    // one and left stale in the other. Three prefixed shapes; the catch-all is deliberately absent.
    assert.equal(SECURITY_CREDENTIAL_PREFIX_PATTERNS.length, 3);
    for (const pattern of SECURITY_CREDENTIAL_PREFIX_PATTERNS) {
      assert.ok(
        /mcpfp_|sk-|gh\[pousr\]_/.test(pattern.source),
        `${pattern.source} is not anchored on a vendor prefix`,
      );
    }
  });
});

describe("redactSecurityEvidence (D-SP4)", () => {
  it("masks a service token, an sk- key and a GitHub token", () => {
    const cases = [
      `Authorization: Bearer mcpfp_${"a".repeat(43)}`,
      `key = sk-${"B".repeat(40)}`,
      `token: ghp_${"c".repeat(36)}`,
    ];
    const secrets = ["a".repeat(43), "B".repeat(40), "c".repeat(36)];
    cases.forEach((raw, index) => {
      const { excerpt } = redactSecurityEvidence(raw);
      assert.ok(excerpt.includes(SECURITY_REDACTION_MARKER), `case ${index} was not masked`);
      assert.ok(!excerpt.includes(secrets[index] ?? ""), `case ${index} leaked its secret`);
    });
    assert.ok(!redactSecurityEvidence(cases[0] ?? "").excerpt.includes("mcpfp_"));
    assert.ok(!redactSecurityEvidence(cases[1] ?? "").excerpt.includes("sk-"));
    assert.ok(!redactSecurityEvidence(cases[2] ?? "").excerpt.includes("ghp_"));
  });

  it("masks a credential even with an invisible character injected into the middle of it", () => {
    const raw = `header=mcpfp_${"A".repeat(10)}${ZERO_WIDTH_SPACE}${"B".repeat(30)} trailing`;
    const { excerpt } = redactSecurityEvidence(raw);
    assert.ok(excerpt.includes(SECURITY_REDACTION_MARKER));
    assert.ok(!excerpt.includes("mcpfp_"), "the prefix survived, so the run was split");
    assert.ok(!excerpt.includes("A".repeat(10)), "the first half of the credential leaked");
    assert.ok(!excerpt.includes("B".repeat(10)), "the second half of the credential leaked");
    assert.ok(excerpt.endsWith(" trailing"), "masking must not swallow the surrounding text");
  });

  it("makes zero-width and bidi-control characters visible instead of printing them raw", () => {
    const raw = `before${ZERO_WIDTH_SPACE}after${RIGHT_TO_LEFT_OVERRIDE}end`;
    const { excerpt } = redactSecurityEvidence(raw);
    assert.ok(!excerpt.includes(ZERO_WIDTH_SPACE), "a zero-width space was printed raw");
    assert.ok(!excerpt.includes(RIGHT_TO_LEFT_OVERRIDE), "an RTL override was printed raw");
    assert.equal(excerpt, "before\\u200Bafter\\u202Eend");
  });

  it("escapes the rest of the invisible vocabulary too", () => {
    assert.equal(redactSecurityEvidence("a\nb").excerpt, "a\\u000Ab");
    assert.equal(redactSecurityEvidence("a\u007Fb").excerpt, "a\\u007Fb");
    assert.equal(redactSecurityEvidence("a\u2060b").excerpt, "a\\u2060b");
    assert.equal(redactSecurityEvidence("a\uFEFFb").excerpt, "a\\uFEFFb");
  });

  it("truncates an oversized excerpt and says so", () => {
    // Filler with no run long enough to look like a credential, so truncation is what is measured.
    const raw = "long ".repeat(1000);
    assert.equal(raw.length, 5000);
    const evidence = redactSecurityEvidence(raw, 12);
    assert.equal(evidence.truncated, true);
    assert.equal(evidence.offset, 12);
    assert.equal(evidence.excerpt.length, SECURITY_EVIDENCE_MAX_CHARS + 1);
    assert.ok(evidence.excerpt.endsWith("…"));
  });

  it("leaves a short, clean excerpt exactly as it was, and omits an absent offset", () => {
    const evidence = redactSecurityEvidence("please ignore previous instructions");
    assert.equal(evidence.excerpt, "please ignore previous instructions");
    assert.equal(evidence.truncated, false);
    assert.equal(Object.hasOwn(evidence, "offset"), false);
  });
});

describe("capSecurityFindings", () => {
  it("passes a short list through untouched", () => {
    const findings = findingsOfSeverity("info", 3);
    const capped = capSecurityFindings(findings);
    assert.equal(capped.truncated, false);
    assert.deepEqual(capped.findings, findings);
  });

  it("bounds a long list at the limit and flags it", () => {
    const findings = findingsOfSeverity("info", SECURITY_FINDING_LIMIT + 5);
    const capped = capSecurityFindings(findings);
    assert.equal(capped.findings.length, SECURITY_FINDING_LIMIT);
    assert.equal(capped.truncated, true);
    // The whole point of the split: the true totals survive the cap, so a gate cannot be fooled.
    assert.equal(findings.length, SECURITY_FINDING_LIMIT + 5);
    assert.equal(computeSecurityScore(findings).value, 0);
  });
});

describe("wire schemas", () => {
  const findings = [
    createSecurityFinding({
      ruleId: "poisoning.injection-phrasing",
      anchor: { kind: "tool", toolName: "read_file" },
      message: "the description instructs the model to ignore its own rules",
      evidence: { raw: "ignore previous instructions", offset: 42 },
    }),
    createSecurityFinding({
      ruleId: "annotation.destructive-unmarked",
      anchor: { kind: "tool", toolName: "delete_file" },
      message: "delete_file carries no destructiveHint",
    }),
    createSecurityFinding({
      ruleId: "schema.undescribed-parameter",
      anchor: { kind: "parameter", toolName: "read_file", parameterPath: "path" },
      message: "path has no description",
    }),
    createSecurityFinding({
      ruleId: "annotation.open-world-unmarked",
      anchor: { kind: "file", path: "scripts/fetch.py" },
      message: "reaches the network without openWorldHint",
    }),
  ].sort(compareSecurityFindings);

  const report: SecurityReport = {
    analyzerVersion: SECURITY_ANALYZER_VERSION,
    generatedAt: "2026-08-20T10:00:00.000Z",
    subject: {
      kind: "server",
      id: "scan_01",
      ownerId: "srv_01",
      name: "Acme MCP",
      capturedAt: "2026-08-20T09:59:00.000Z",
    },
    findings,
    counts: {
      error: findings.filter((finding) => finding.severity === "error").length,
      warning: findings.filter((finding) => finding.severity === "warning").length,
      info: findings.filter((finding) => finding.severity === "info").length,
      total: findings.length,
    },
    score: computeSecurityScore(findings),
    truncated: false,
  };

  it("round-trips a fully-populated report, in both type directions", () => {
    // `report` is typed `SecurityReport` going in and the parse result is assigned back out, so this
    // is a compile-time proof that the schema and the hand-written type still mirror each other.
    const parsed: SecurityReport = securityReportSchema.parse(report);
    assert.deepEqual(parsed, report);
    assert.equal(JSON.stringify(parsed), JSON.stringify(report));
  });

  it("rejects a rule id the registry does not declare", () => {
    const finding = { ...report.findings[0], ruleId: "poisoning.not-a-real-rule" };
    assert.equal(securityFindingSchema.safeParse(finding).success, false);
  });

  it("rejects an extra key anywhere (.strict())", () => {
    assert.equal(
      securityFindingSchema.safeParse({ ...report.findings[0], note: "extra" }).success,
      false,
    );
    assert.equal(securityReportSchema.safeParse({ ...report, note: "extra" }).success, false);
    assert.equal(
      securityReportSchema.safeParse({
        ...report,
        subject: { ...report.subject, path: "/data/app.sqlite" },
      }).success,
      false,
    );
    assert.equal(
      securityFindingSchema.safeParse({
        ...report.findings[0],
        anchor: { kind: "tool", toolName: "read_file", extra: 1 },
      }).success,
      false,
    );
  });

  it("rejects a score outside 0-100 and an unknown band", () => {
    assert.equal(
      securityReportSchema.safeParse({ ...report, score: { ...report.score, value: 101 } }).success,
      false,
    );
    assert.equal(
      securityReportSchema.safeParse({ ...report, score: { ...report.score, value: -1 } }).success,
      false,
    );
    assert.equal(
      securityReportSchema.safeParse({ ...report, score: { ...report.score, band: "fine" } })
        .success,
      false,
    );
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
// WP 1.4 — the posture diff
// ══════════════════════════════════════════════════════════════════════════════════════════════
// `diffSecurityReports` is the ONE answer to "what changed between these two reports", and these are
// its teeth: that "new" is set membership by (ruleId, anchor) and not a count (D-C20), that the four
// meaningless pairings are refused rather than answered (D-SP10/D-SP16/D-C22's shared instinct), that
// the buckets partition both reports exactly, and that the diff is clock-free.

/** A report of `findings`, with everything else derived exactly as the real services derive it. */
function reportOf(
  findings: SecurityFinding[],
  overrides: Partial<SecurityReport> = {},
): SecurityReport {
  const counts = { error: 0, warning: 0, info: 0, total: findings.length };
  for (const finding of findings) counts[finding.severity] += 1;
  return {
    analyzerVersion: SECURITY_ANALYZER_VERSION,
    generatedAt: "2026-08-20T12:00:00.000Z",
    subject: {
      kind: "server",
      id: "scan_old",
      ownerId: "srv_1",
      name: "Everything",
      capturedAt: "2026-08-20T10:00:00.000Z",
    },
    findings,
    counts,
    score: computeSecurityScore(findings),
    truncated: false,
    ...overrides,
  };
}

/** A finding on one tool, through the sanctioned constructor so D-SP5 picks the severity. */
function toolFinding(ruleId: SecurityRuleId, toolName: string, evidence?: string): SecurityFinding {
  return createSecurityFinding({
    ruleId,
    anchor: { kind: "tool", toolName },
    message: `${ruleId} fired on "${toolName}".`,
    ...(evidence === undefined ? {} : { evidence: { raw: evidence } }),
  });
}

const DIFF_ERROR_RULE = "poisoning.injection-phrasing" satisfies SecurityRuleId;
const DIFF_WARNING_RULE = "annotation.destructive-unmarked" satisfies SecurityRuleId;
const DIFF_INFO_RULE = "schema.undescribed-parameter" satisfies SecurityRuleId;

describe("diffSecurityReports — the three buckets (WP 1.4)", () => {
  it("partitions the two reports: added / resolved / unchanged, by identity and not by count", () => {
    // The fixture that earns its keep: one finding resolved and a DIFFERENT one added, so every
    // count on both sides is byte-identical and only set membership can tell them apart.
    const shared = [toolFinding(DIFF_ERROR_RULE, "alpha"), toolFinding(DIFF_WARNING_RULE, "beta")];
    const baseline = reportOf([...shared, toolFinding(DIFF_ERROR_RULE, "gone")]);
    const subject = reportOf([...shared, toolFinding(DIFF_ERROR_RULE, "arrived")], {
      subject: { ...baseline.subject, id: "scan_new" },
    });
    assert.deepEqual(subject.counts, baseline.counts, "the fixture only bites while counts match");

    const diff = diffSecurityReports(baseline, subject);
    assert.deepEqual(
      diff.added.map((finding) => finding.anchor),
      [{ kind: "tool", toolName: "arrived" }],
    );
    assert.deepEqual(
      diff.resolved.map((finding) => finding.anchor),
      [{ kind: "tool", toolName: "gone" }],
    );
    assert.deepEqual(diff.unchanged, shared);
  });

  it("treats the same rule on the same tool with different evidence as UNCHANGED", () => {
    // A vendor rewords a poisoned description. It is still the same finding — a gate or a UI that
    // called this "one resolved, one new" is a gate somebody switches off inside a week.
    const baseline = reportOf([toolFinding(DIFF_ERROR_RULE, "alpha", "ignore previous rules")]);
    const subject = reportOf([toolFinding(DIFF_ERROR_RULE, "alpha", "disregard prior guidance")]);

    const diff = diffSecurityReports(baseline, subject);
    assert.deepEqual(diff.added, []);
    assert.deepEqual(diff.resolved, []);
    assert.equal(diff.unchanged.length, 1);
    // …and it is the SUBJECT's instance that is carried, because its evidence is the live text.
    assert.match(diff.unchanged[0]?.evidence?.excerpt ?? "", /disregard prior guidance/);
  });

  it("keeps both partition invariants over every anchor kind, including the subject-level ones", () => {
    const anchors: SecurityFindingAnchor[] = [
      SERVER,
      SKILL,
      { kind: "tool", toolName: "alpha" },
      { kind: "parameter", toolName: "alpha", parameterPath: "token" },
      { kind: "file", path: "scripts/run.py" },
    ];
    const all = anchors.map((anchor) =>
      createSecurityFinding({ ruleId: DIFF_ERROR_RULE, anchor, message: "fired." }),
    );
    const baseline = reportOf(all.slice(0, 3));
    const subject = reportOf(all.slice(2));

    const diff = diffSecurityReports(baseline, subject);
    assert.equal(diff.added.length + diff.unchanged.length, subject.findings.length);
    assert.equal(diff.resolved.length + diff.unchanged.length, baseline.findings.length);
    assert.equal(diff.added.length, 2);
    assert.equal(diff.resolved.length, 2);
    assert.equal(diff.unchanged.length, 1);
  });

  it("counts each bucket by severity, and never off a report's own counts", () => {
    const baseline = reportOf([toolFinding(DIFF_INFO_RULE, "stays")]);
    const subject = reportOf([
      toolFinding(DIFF_INFO_RULE, "stays"),
      toolFinding(DIFF_ERROR_RULE, "new_error"),
      toolFinding(DIFF_WARNING_RULE, "new_warning"),
    ]);

    const diff = diffSecurityReports(baseline, subject);
    assert.deepEqual(diff.counts.added, { error: 1, warning: 1, info: 0, total: 2 });
    assert.deepEqual(diff.counts.resolved, { error: 0, warning: 0, info: 0, total: 0 });
    assert.deepEqual(diff.counts.unchanged, { error: 0, warning: 0, info: 1, total: 1 });
  });

  it("emits each bucket in the source report's own compareSecurityFindings order", () => {
    const ordered = [
      toolFinding(DIFF_ERROR_RULE, "a"),
      toolFinding(DIFF_WARNING_RULE, "b"),
      toolFinding(DIFF_INFO_RULE, "c"),
    ].sort(compareSecurityFindings);
    const subject = reportOf(ordered);
    const diff = diffSecurityReports(reportOf([]), subject);
    assert.deepEqual(diff.added, ordered, "added inherits the subject report's emit order");
    assert.deepEqual(
      diff.added,
      [...diff.added].sort(compareSecurityFindings),
      "so it is already in the one total order (D-SP6)",
    );
  });

  it("is byte-stable: the same pair diffed twice serializes identically", () => {
    const baseline = reportOf([toolFinding(DIFF_ERROR_RULE, "gone")]);
    const subject = reportOf([toolFinding(DIFF_WARNING_RULE, "arrived")]);
    assert.equal(
      JSON.stringify(diffSecurityReports(baseline, subject)),
      JSON.stringify(diffSecurityReports(baseline, subject)),
    );
  });

  it("diffs a report against ITSELF as all-unchanged, delta 0", () => {
    const report = reportOf([
      toolFinding(DIFF_ERROR_RULE, "alpha"),
      toolFinding(DIFF_INFO_RULE, "b"),
    ]);
    const diff = diffSecurityReports(report, report);
    assert.deepEqual(diff.added, []);
    assert.deepEqual(diff.resolved, []);
    assert.equal(diff.unchanged.length, 2);
    assert.equal(diff.score.delta, 0);
  });
});

describe("diffSecurityReports — the score delta and the dating (WP 1.4)", () => {
  it("echoes both scores and reports subject − baseline, so improving is POSITIVE", () => {
    const baseline = reportOf([toolFinding(DIFF_ERROR_RULE, "alpha")]); // 85
    const subject = reportOf([]); // 100
    const improved = diffSecurityReports(baseline, subject);
    assert.deepEqual(improved.score.baseline, baseline.score);
    assert.deepEqual(improved.score.subject, subject.score);
    assert.equal(improved.score.delta, 15);

    // …and a posture that got worse is a negative delta, which the schema must accept.
    const worse = diffSecurityReports(subject, baseline);
    assert.equal(worse.score.delta, -15);
    assert.equal(securityPostureDiffSchema.safeParse(worse).success, true);
  });

  it("dates itself from the two reports and never from a clock", () => {
    const baseline = reportOf([], { generatedAt: "2026-08-20T09:00:00.000Z" });
    const subject = reportOf([], { generatedAt: "2026-08-20T17:30:00.000Z" });
    assert.equal(diffSecurityReports(baseline, subject).generatedAt, "2026-08-20T17:30:00.000Z");
    // The later instant wins whichever side carries it — the diff is dated by its freshest input.
    assert.equal(diffSecurityReports(subject, baseline).generatedAt, "2026-08-20T17:30:00.000Z");
  });

  it("echoes the analyzer version and both subject refs", () => {
    const baseline = reportOf([]);
    const subject = reportOf([], { subject: { ...baseline.subject, id: "scan_new" } });
    const diff = diffSecurityReports(baseline, subject);
    assert.equal(diff.analyzerVersion, SECURITY_ANALYZER_VERSION);
    assert.equal(diff.baseline.id, "scan_old");
    assert.equal(diff.subject.id, "scan_new");
  });
});

describe("diffSecurityReports — the four refusals (WP 1.4)", () => {
  const baseline = reportOf([]);

  it("refuses two different subject KINDS", () => {
    const skillReport = reportOf([], {
      subject: { ...baseline.subject, kind: "skill" },
    });
    assert.throws(
      () => diffSecurityReports(baseline, skillReport),
      /baseline is a "server" report and the subject a "skill" report/,
    );
  });

  it("refuses two different OWNERS — a posture diff is one server, or one skill", () => {
    const otherServer = reportOf([], {
      subject: { ...baseline.subject, id: "scan_new", ownerId: "srv_2" },
    });
    assert.throws(() => diffSecurityReports(baseline, otherServer), /belongs to "srv_1"/);
  });

  it("refuses two different ANALYZER VERSIONS, in both directions (D-C22's instinct)", () => {
    const newer = reportOf([], { analyzerVersion: SECURITY_ANALYZER_VERSION + 1 });
    assert.throws(() => diffSecurityReports(baseline, newer), /not on the same scale/);
    assert.throws(() => diffSecurityReports(newer, baseline), /not on the same scale/);
  });

  it("refuses a TRUNCATED report on either side, and names the side", () => {
    const truncated = reportOf([], {
      truncated: true,
      counts: { error: 300, warning: 0, info: 0, total: 300 },
    });
    assert.throws(
      () => diffSecurityReports(truncated, baseline),
      /the baseline produced more than/,
    );
    assert.throws(() => diffSecurityReports(baseline, truncated), /the subject produced more than/);
    assert.throws(
      () => diffSecurityReports(truncated, truncated),
      /the baseline and the subject produced more than/,
    );
    // A partial set is never quietly answered as "nothing changed".
    assert.throws(() => diffSecurityReports(baseline, truncated), /not a verdict/);
  });
});

describe("securityPostureDiffSchema + securityDiffQuerySchema (WP 1.4)", () => {
  const diff = diffSecurityReports(
    reportOf([toolFinding(DIFF_ERROR_RULE, "gone")]),
    reportOf([toolFinding(DIFF_WARNING_RULE, "arrived")], {
      subject: { ...reportOf([]).subject, id: "scan_new" },
    }),
  );

  it("round-trips a real diff and rejects an unknown key at every level", () => {
    assert.deepEqual(securityPostureDiffSchema.parse(diff), diff);
    assert.equal(securityPostureDiffSchema.safeParse({ ...diff, note: "extra" }).success, false);
    assert.equal(
      securityPostureDiffSchema.safeParse({
        ...diff,
        counts: { ...diff.counts, dropped: { error: 0, warning: 0, info: 0, total: 0 } },
      }).success,
      false,
    );
    assert.equal(
      securityPostureDiffSchema.safeParse({ ...diff, score: { ...diff.score, ratio: 1 } }).success,
      false,
    );
  });

  it("validates the report counts and the diff counts against ONE extracted schema", () => {
    const counts = { error: 1, warning: 0, info: 0, total: 1 };
    assert.deepEqual(securityFindingCountsSchema.parse(counts), counts);
    assert.equal(securityFindingCountsSchema.safeParse({ ...counts, extra: 1 }).success, false);
    assert.equal(securityFindingCountsSchema.safeParse({ ...counts, error: -1 }).success, false);
  });

  it("requires an explicit, non-blank baseline and refuses an unknown query key", () => {
    assert.deepEqual(securityDiffQuerySchema.parse({ baseline: " scan_old " }), {
      baseline: "scan_old",
    });
    assert.equal(securityDiffQuerySchema.safeParse({}).success, false);
    assert.equal(securityDiffQuerySchema.safeParse({ baseline: "   " }).success, false);
    // `?baseline=…&minSeverity=error` is a caller who believes they set a floor. Say so.
    assert.equal(
      securityDiffQuerySchema.safeParse({ baseline: "scan_old", minSeverity: "error" }).success,
      false,
    );
  });
});
