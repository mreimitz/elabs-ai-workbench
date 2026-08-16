import assert from "node:assert/strict";
import { test } from "node:test";
import {
  annotationsCoherent,
  descriptionQualityOk,
  followsNamingConvention,
  maxEnumLength,
  schemaHasOutputFormat,
  schemaHasPagination,
  unsupportedKeywords,
} from "../src/compatibility/evaluators.js";
import { runToolLevel, type ToolInput } from "../src/compatibility/runner.js";

// --- Unit tests for the WP 5.5 design-quality evaluators (doc 05 §4) -----------------------------

test("annotationsCoherent: present + non-contradictory passes; missing or read-only+destructive warns", () => {
  assert.equal(annotationsCoherent({ readOnlyHint: true }), true);
  assert.equal(annotationsCoherent({ readOnlyHint: false, destructiveHint: true }), true);
  assert.equal(annotationsCoherent({ idempotentHint: true, openWorldHint: false }), true);
  // Contradiction: a read-only tool cannot also be destructive.
  assert.equal(annotationsCoherent({ readOnlyHint: true, destructiveHint: true }), false);
  // No annotations declared at all → soft miss.
  assert.equal(annotationsCoherent(undefined), false);
  assert.equal(annotationsCoherent(null), false);
  assert.equal(annotationsCoherent("nope"), false);
});

test("#25 maxEnumLength counts enums factored into $defs/definitions (not just inline)", () => {
  const big = Array.from({ length: 300 }, (_, i) => `v${i}`);
  assert.equal(
    maxEnumLength({
      type: "object",
      properties: { a: { $ref: "#/$defs/E" } },
      $defs: { E: { enum: big } },
    }),
    300,
  );
  assert.equal(maxEnumLength({ definitions: { E: { enum: big } } }), 300);
  // Inline still works.
  assert.equal(maxEnumLength({ type: "object", properties: { a: { enum: ["x", "y"] } } }), 2);
});

test("#26 unsupportedKeywords descends into patternProperties + object additionalProperties", () => {
  // patternProperties is itself a strict-unsupported keyword AND its value-schemas are now traversed,
  // so the nested oneOf is also surfaced (previously missed).
  const pat = unsupportedKeywords({
    type: "object",
    patternProperties: { "^x": { oneOf: [{ type: "string" }] } },
  });
  assert.ok(
    pat.includes("patternProperties") && pat.includes("oneOf"),
    `expected patternProperties + oneOf, got ${pat.join(",")}`,
  );
  // A $ref nested under an object-form additionalProperties is now found (was a false pass).
  assert.deepEqual(
    unsupportedKeywords({ type: "object", additionalProperties: { $ref: "#/$defs/X" } }),
    ["$ref"],
  );
  // additionalProperties:false is a boolean, not a schema → no traversal, no false positive.
  assert.deepEqual(unsupportedKeywords({ type: "object", additionalProperties: false }), []);
});

test("followsNamingConvention: service_action snake_case with a verb passes; bare/non-snake warns", () => {
  assert.equal(followsNamingConvention("github_create_issue"), true);
  assert.equal(followsNamingConvention("db_run_query"), true);
  assert.equal(followsNamingConvention("jira_list_tickets"), true);
  // No action verb segment.
  assert.equal(followsNamingConvention("github_issue"), false);
  // Single bare word.
  assert.equal(followsNamingConvention("search"), false);
  // Not snake_case.
  assert.equal(followsNamingConvention("createIssue"), false);
  assert.equal(followsNamingConvention("Create_Issue"), false);
});

test("descriptionQualityOk: substantive / usage-cued passes; terse one-liner warns", () => {
  assert.equal(
    descriptionQualityOk(
      "Creates a new GitHub issue. Use this when you need to file a bug or feature request.",
    ),
    true,
  );
  assert.equal(
    descriptionQualityOk(
      "Returns the current weather for a city, including temperature and conditions for the next hours.",
    ),
    true,
  );
  // Too short.
  assert.equal(descriptionQualityOk("Does a thing."), false);
  assert.equal(descriptionQualityOk(""), false);
  assert.equal(descriptionQualityOk(undefined), false);
  // Medium length, single sentence, no cue → warn.
  assert.equal(descriptionQualityOk("Performs an internal lookup operation on the dataset"), false);
});

test("schemaHasPagination: detects limit/offset/cursor/page controls", () => {
  assert.equal(
    schemaHasPagination({ type: "object", properties: { limit: { type: "number" } } }),
    true,
  );
  assert.equal(
    schemaHasPagination({ type: "object", properties: { cursor: { type: "string" } } }),
    true,
  );
  assert.equal(
    schemaHasPagination({
      type: "object",
      properties: { page_size: { type: "number" }, q: { type: "string" } },
    }),
    true,
  );
  assert.equal(
    schemaHasPagination({ type: "object", properties: { query: { type: "string" } } }),
    false,
  );
  assert.equal(schemaHasPagination(undefined), false);
});

test("schemaHasOutputFormat: detects response_format/detail/fields/verbosity controls", () => {
  assert.equal(
    schemaHasOutputFormat({ type: "object", properties: { response_format: { type: "string" } } }),
    true,
  );
  assert.equal(
    schemaHasOutputFormat({ type: "object", properties: { detail: { type: "string" } } }),
    true,
  );
  assert.equal(
    schemaHasOutputFormat({ type: "object", properties: { fields: { type: "array" } } }),
    true,
  );
  assert.equal(
    schemaHasOutputFormat({ type: "object", properties: { name: { type: "string" } } }),
    false,
  );
  assert.equal(schemaHasOutputFormat(undefined), false);
});

// --- The 5 design tests are wired into the static tool-level set (non-blocker; false → warn) -----

test("design tests run in the static tool set and never gate (warn, not fail)", () => {
  const find = (rs: { testId: string }[], id: string) => rs.find((r) => r.testId === id);

  // A well-designed tool: passes all five.
  const good: ToolInput = {
    toolName: "github_list_issues",
    description:
      "Lists issues in a GitHub repository. Use this when you need to enumerate open or closed issues; returns a paginated set.",
    descriptionTokens: 30,
    totalTokens: 200,
    inputSchema: {
      type: "object",
      properties: {
        repo: { type: "string" },
        limit: { type: "number" },
        response_format: { type: "string" },
      },
    },
    annotations: { readOnlyHint: true },
  };
  const goodResults = runToolLevel(good, "gpt-5.5");
  for (const id of [
    "TOOL_ANNOTATIONS_COHERENT",
    "TOOL_NAMING_CONVENTION",
    "TOOL_DESCRIPTION_QUALITY",
    "TOOL_PAGINATION_SUPPORTED",
    "TOOL_OUTPUT_DUAL_FORMAT",
  ]) {
    assert.equal(
      find(goodResults, id)?.verdict,
      "pass",
      `${id} should pass on a well-designed tool`,
    );
  }

  // A poorly-designed tool: warns on all five, but NONE is a fail (design tests don't gate).
  const bad: ToolInput = {
    toolName: "search",
    description: "Searches.",
    descriptionTokens: 2,
    totalTokens: 50,
    inputSchema: { type: "object", properties: { q: { type: "string" } } },
    // no annotations
  };
  const badResults = runToolLevel(bad, "gpt-5.5");
  for (const id of [
    "TOOL_ANNOTATIONS_COHERENT",
    "TOOL_NAMING_CONVENTION",
    "TOOL_DESCRIPTION_QUALITY",
    "TOOL_PAGINATION_SUPPORTED",
    "TOOL_OUTPUT_DUAL_FORMAT",
  ]) {
    const r = find(badResults, id);
    assert.equal(r?.verdict, "warn", `${id} should warn on a poor tool`);
    assert.notEqual(r?.verdict, "fail", `${id} must never fail-gate a cell`);
  }
});
