// WP 5.1 (Phase 5 — answer rendering, D-QA8/D-QA9/D-QA10): unit coverage for the additive
// `AnswersAnswerBlock` union and the `blocks`/`data` extensions to the qlik_answers wire contract.
// `packages/shared` had no test runner before this WP (see package.json's new `test` script); this
// is the first `*.test.ts` co-located under `src/`.
import assert from "node:assert/strict";
import { test } from "node:test";
import { answersAnswerBlockSchema, answersStepPayloadSchema, reasoningSectionSchema } from "./schemas.js";
import type { AnswersStepPayload } from "./types.js";

// ── (b) backward compatibility: the real persisted payload shape still parses ───────────────────
//
// A trimmed-but-faithful copy of the ACTUAL persisted `qlik_answers` `llm_response` step payload
// from run `hHGgqkU…` (`.qa-fixtures/run-hHGgqkU.json`, `steps[1].payload` — scratch-only per the
// WP brief, never committed). Every field/value below (including the full 5-entry `snapshots[]`
// and a trimmed two-entry `rawResponse.content[0].card.body`) is copied verbatim from that file.
//
// One exception: the real fixture file has `"estimatedTokens":"[redacted]"` (a string), which is a
// pre-existing data artifact — unrelated to this WP — that would fail the ALREADY-EXISTING
// `estimatedTokens: z.boolean().optional()` schema regardless of anything added here (confirmed by
// parsing the raw file directly: only that one field fails). `estimatedTokens` is documented as
// "Always true for this kind", so it is restored to `true` here to test the real wire shape rather
// than that unrelated artifact. This inline copy is used (per the WP brief's fallback) instead of
// reading `.qa-fixtures/` at test time, since that directory is scratch and not committed.
const REAL_PAYLOAD_SHAPE: AnswersStepPayload = {
  appId: "174e3c60-c5fb-48de-bf01-a4468d9f3197",
  estimatedTokens: true,
  expressions: [
    "=(({<[Carrier.airline_name]={'American Airlines'},[Origin.airport_type]={'large_airport','medium_airport'}>} [Flights]) / ({<[Origin.airport_type]={'large_airport','medium_airport'}>} [Flights])) * 100",
    "={<[Origin.airport_type]={'large_airport','medium_airport'}>} [Flights]",
    '={<[Origin.airport_type]={"large_airport","medium_airport"}>} [DepDelay]',
    '={<[Origin.airport_type]={"large_airport","medium_airport"}>} [CarrierDelay]',
  ],
  messageId: "0cf13385-e19c-4c1c-a9dd-5c33375c04ec",
  promptMode: "oneshot",
  questionsConsumed: 1,
  reasoning: "Compare American Airlines' on-time performance against all other major US carriers…",
  snapshots: [
    {
      title: "AA Market Share %",
      reason: "Establishes baseline partnership scale and market presence",
      measures: [
        {
          expression:
            "(({<[Carrier.airline_name]={'American Airlines'},[Origin.airport_type]={'large_airport','medium_airport'}>} [Flights]) / ({<[Origin.airport_type]={'large_airport','medium_airport'}>} [Flights])) * 100",
          label: "AA Market Share %",
        },
      ],
    },
    {
      title: "Flight Count",
      measures: [
        { expression: "{<[Origin.airport_type]={'large_airport','medium_airport'}>} [Flights]", label: "Flight Count" },
        {
          expression: '{<[Origin.airport_type]={"large_airport","medium_airport"}>} [DepDelay]',
          label: "Avg Delay Minutes",
        },
        {
          expression: '{<[Origin.airport_type]={"large_airport","medium_airport"}>} [CarrierDelay]',
          label: "Avg Carrier-Caused Delay",
        },
      ],
    },
    {
      title: "Avg Carrier Delay",
      reason: "Isolates carrier-controllable delays to assess operational excellence",
      dimensions: [{ expression: "Carrier.airline_name", label: "Carrier.airline_name" }],
      measures: [
        {
          expression: '{<[Origin.airport_type]={"large_airport","medium_airport"}>} [CarrierDelay]',
          label: "Avg Carrier Delay",
        },
      ],
    },
    {
      title: "Flight Volume",
      reason: "Shows network coverage and capacity availability for partnership consideration",
      dimensions: [{ expression: "Carrier.airline_name", label: "Carrier.airline_name" }],
      measures: [
        { expression: "{<[Origin.airport_type]={'large_airport','medium_airport'}>} [Flights]", label: "Flight Volume" },
      ],
    },
    {
      title: "Total Flights by Carrier",
      reason: "Enables direct comparison of AA punctuality against all competitors",
      dimensions: [{ expression: "Carrier.airline_name", label: "Carrier.airline_name" }],
      measures: [
        {
          expression: "{<[Origin.airport_type]={'large_airport','medium_airport'}>} [Flights]",
          label: "Total Flights by Carrier",
        },
        {
          expression: '{<[Origin.airport_type]={"large_airport","medium_airport"}>} [DepDelay]',
          label: "Avg Departure Delay",
        },
      ],
    },
  ],
  sources: [],
  threadId: "79784c03-6fd7-4eb1-828c-59123962df36",
  // Trimmed: the real `rawResponse` is a full AdaptiveCard with 19 body entries (5
  // text/Qlik.Snapshot pairs); two entries are kept here as a representative shape. `rawResponse`
  // is `unknown` on the wire, so its exact shape is irrelevant to this schema — only its presence.
  rawResponse: {
    content: [
      {
        card: {
          $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
          body: [
            { size: "medium", spacing: "medium", text: "Conclusion", type: "TextBlock", weight: "bolder" },
            {
              spacing: "medium",
              text: 'American Airlines holds roughly 13.5% of all flights at major and mid-sized US airports.<citation data-index="0">1</citation>',
              type: "TextBlock",
              wrap: true,
            },
          ],
        },
        type: "adaptiveCard",
      },
    ],
  },
};

test("answersStepPayloadSchema accepts the real persisted qlik_answers payload shape (no new fields present)", () => {
  const parsed = answersStepPayloadSchema.parse(REAL_PAYLOAD_SHAPE);
  assert.deepEqual(parsed, REAL_PAYLOAD_SHAPE);
});

// ── (a) round-trip: the new `blocks`/`data` additions parse and preserve their values ────────────

test("answersStepPayloadSchema round-trips blocks[] + a snapshot with data", () => {
  const payload: AnswersStepPayload = {
    threadId: "79784c03-6fd7-4eb1-828c-59123962df36",
    promptMode: "oneshot",
    questionsConsumed: 1,
    snapshots: [
      {
        title: "Flight Volume",
        reason: "Shows network coverage and capacity availability",
        dimensions: [{ expression: "Carrier.airline_name", label: "Carrier.airline_name" }],
        measures: [{ expression: "[Flights]", label: "Flight Volume" }],
        data: {
          columns: ["Carrier.airline_name", "Flight Volume"],
          rows: [
            ["Southwest Airlines", 12798190],
            ["Delta Air Lines", 8901234],
            ["American Airlines", 8500000],
          ],
          totalRows: 20,
        },
      },
    ],
    blocks: [
      {
        kind: "text",
        markdown:
          "American Airlines holds roughly 13.5% of all flights at major and mid-sized US airports, making it the third-largest carrier by volume.",
        citations: [0],
      },
      { kind: "snapshot", index: 0 },
      { kind: "text", markdown: "Bottom line: a multi-vendor strategy anchored by Alaska and Delta is recommended." },
    ],
  };

  const parsed = answersStepPayloadSchema.parse(payload);
  assert.deepEqual(parsed, payload);
  // Row cap (D-QA10) is an executor/extraction concern (WP 5.2), not enforced by the schema itself —
  // the schema just needs to carry a capped array + honest `totalRows` faithfully, which it does.
  assert.equal(parsed.snapshots?.[0]?.data?.rows.length, 3);
  assert.equal(parsed.snapshots?.[0]?.data?.totalRows, 20);
  assert.equal(parsed.blocks?.[1]?.kind, "snapshot");
});

test("answersAnswerBlockSchema discriminates on kind and rejects an unknown variant", () => {
  assert.deepEqual(answersAnswerBlockSchema.parse({ kind: "text", markdown: "hi" }), {
    kind: "text",
    markdown: "hi",
  });
  assert.deepEqual(answersAnswerBlockSchema.parse({ kind: "snapshot", index: 2 }), {
    kind: "snapshot",
    index: 2,
  });
  assert.throws(() => answersAnswerBlockSchema.parse({ kind: "chart", index: 0 }));
  assert.throws(() => answersAnswerBlockSchema.parse({ kind: "snapshot", index: -1 }));
  assert.throws(() => answersAnswerBlockSchema.parse({ kind: "text", markdown: "hi", citations: [-1] }));
});

// ── WP 5.2 (D-QA11): the additive `reasoningSections` contract round-trips ───────────────────────

test("reasoningSectionSchema discriminates every kind and rejects an unknown one", () => {
  assert.deepEqual(reasoningSectionSchema.parse({ kind: "understanding", title: "Understanding", markdown: "x" }), {
    kind: "understanding",
    title: "Understanding",
    markdown: "x",
  });
  assert.deepEqual(
    reasoningSectionSchema.parse({
      kind: "assets",
      title: "Master Measures",
      rows: [{ asset: "DepDelay", type: "measure", similarity: 0.888, glossary: "delay" }],
    }),
    { kind: "assets", title: "Master Measures", rows: [{ asset: "DepDelay", type: "measure", similarity: 0.888, glossary: "delay" }] },
  );
  assert.deepEqual(reasoningSectionSchema.parse({ kind: "raw", markdown: "verbatim" }), {
    kind: "raw",
    markdown: "verbatim",
  });
  assert.throws(() => reasoningSectionSchema.parse({ kind: "draft", markdown: "d" })); // missing duplicatesAnswer
  assert.throws(() => reasoningSectionSchema.parse({ kind: "unknown", markdown: "x" }));
});

test("answersStepPayloadSchema round-trips reasoningSections alongside blocks", () => {
  const payload: AnswersStepPayload = {
    promptMode: "oneshot",
    questionsConsumed: 1,
    reasoning: "1. **Understanding**: …\n\n## Draft\n\n…",
    blocks: [{ kind: "text", markdown: "Answer." }],
    reasoningSections: [
      { kind: "understanding", title: "Understanding", markdown: "…" },
      { kind: "assets", title: "Master Dimensions", rows: [{ asset: "Carrier", type: "dimension" }] },
      { kind: "draft", title: "Draft", markdown: "…", duplicatesAnswer: true },
      { kind: "raw", markdown: "fallback" },
    ],
  };
  assert.deepEqual(answersStepPayloadSchema.parse(payload), payload);
});
