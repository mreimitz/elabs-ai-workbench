import { describe, expect, test } from "vitest";
import {
  describeRefusal,
  planToolForm,
  specFieldNames,
  type ToolFormRefusal,
} from "./tool-schema-form";

/**
 * These run against the REAL `fromJsonSchema` from `@elabs-ai/components-ui`, not a stub. The whole
 * value of this module is that it knows what the adapter actually does with a given schema, so
 * mocking the adapter would test nothing worth testing.
 *
 * The schemas below are MCP-shaped on purpose — the subset a tool surface really uses.
 */

describe("planToolForm — schemas the typed form can honour", () => {
  test("the ordinary case: strings, enums, numbers and booleans all become fields", () => {
    const plan = planToolForm(
      {
        type: "object",
        properties: {
          query: { type: "string", description: "What to search for" },
          limit: { type: "integer", minimum: 1, maximum: 100 },
          mode: { type: "string", enum: ["fast", "thorough"] },
          includeArchived: { type: "boolean" },
        },
        required: ["query"],
      },
      "search_files",
    );
    expect(plan.usable).toBe(true);
    if (!plan.usable) return;
    expect([...specFieldNames(plan.spec.fields)].sort()).toEqual([
      "includeArchived",
      "limit",
      "mode",
      "query",
    ]);
  });

  test("orders REQUIRED fields first, as the hand-written form it replaces did", () => {
    // The adapter emits the schema's own property order. For an alphabetised schema that buries the
    // one argument a caller must supply — the workbench's own `run_plan_start` puts its required
    // `source` sixth of seven.
    const plan = planToolForm(
      {
        type: "object",
        properties: {
          alpha: { type: "string" },
          beta: { type: "string" },
          source: { type: "string" },
          zulu: { type: "string" },
        },
        required: ["source"],
      },
      "ordering_tool",
    );
    expect(plan.usable).toBe(true);
    if (!plan.usable) return;
    expect(plan.spec.fields.map((f) => f.name)).toEqual(["source", "alpha", "beta", "zulu"]);
  });

  test("a string ARRAY becomes a real list field — the case that used to be a JSON textarea", () => {
    const plan = planToolForm(
      { type: "object", properties: { tags: { type: "array", items: { type: "string" } } } },
      "tag_tool",
    );
    expect(plan.usable).toBe(true);
    if (!plan.usable) return;
    const tags = plan.spec.fields.find((f) => f.name === "tags");
    expect(tags?.type).toBe("list");
  });

  test("a CONSTRAINED string array becomes a multi-select, not a free list", () => {
    const plan = planToolForm(
      {
        type: "object",
        properties: { scopes: { type: "array", items: { type: "string", enum: ["a", "b", "c"] } } },
      },
      "scoped_tool",
    );
    expect(plan.usable).toBe(true);
    if (!plan.usable) return;
    expect(plan.spec.fields.find((f) => f.name === "scopes")?.type).toBe("multi-enum");
  });

  test("`specFieldNames` sees INSIDE a group — otherwise the drop guard would be blind to nesting", () => {
    // Built directly rather than through `planToolForm`, which refuses nested schemas (see below).
    // The recursion still has to be right: a future release that exports the un-flattening helper
    // will lift that refusal, and this guard has to keep working on the day it does.
    const names = specFieldNames([
      {
        type: "group",
        name: "address",
        label: "Address",
        variant: "advanced",
        groups: [
          {
            key: "main",
            label: "Address",
            fields: [
              { type: "string", name: "city", label: "City" },
              { type: "string", name: "zip", label: "Zip" },
            ],
          },
        ],
      },
    ]);
    expect(names.has("city")).toBe(true);
    expect(names.has("zip")).toBe(true);
  });

  test("REFUSES a nested object, because the un-flattening helper is not exported", () => {
    // `fromJsonSchema` flattens `{ address: { city, zip } }` into flat `city`/`zip` values, and
    // upstream's `jsonSchemaRequestBody` — which rebuilds the nested shape — is absent from the
    // package barrel. Submitting would send the WRONG SHAPE, which is exactly what D-BU6 forbids,
    // so this refuses rather than making a best effort.
    const plan = planToolForm(
      {
        type: "object",
        properties: {
          address: {
            type: "object",
            properties: { city: { type: "string" }, zip: { type: "string" } },
          },
        },
      },
      "nested_tool",
    );
    expect(plan.usable).toBe(false);
    if (plan.usable) return;
    expect(plan.refusal.kind).toBe("nested-object");
    if (plan.refusal.kind !== "nested-object") return;
    expect(plan.refusal.properties).toEqual(["address"]);
  });
});

describe("planToolForm — schemas it REFUSES rather than approximating (D-BU6)", () => {
  // `$ref`/`allOf`/`oneOf`/`anyOf`/`not` change what a schema MEANS. The adapter throws on them by
  // design; this module turns that into a refusal the UI can explain.
  for (const keyword of ["$ref", "allOf", "oneOf", "anyOf", "not"] as const) {
    test(`refuses \`${keyword}\`, wherever it sits`, () => {
      const inner =
        keyword === "$ref"
          ? { $ref: "#/definitions/Thing" }
          : keyword === "not"
            ? { not: { type: "string" } }
            : { [keyword]: [{ type: "string" }] };
      const plan = planToolForm(
        { type: "object", properties: { thing: inner } },
        `${keyword}_tool`,
      );
      expect(plan.usable).toBe(false);
      if (plan.usable) return;
      expect(plan.refusal.kind).toBe("unsupported-keyword");
      // The adapter names the keyword and its path; that detail must survive to the UI.
      expect(plan.refusal.detail).toContain(keyword);
    });
  }

  test("refuses when a REQUIRED property would be silently dropped", () => {
    // `payload` has a type the subset does not cover, so `fromJsonSchema` omits it — and it is
    // required, so a typed form could never produce a valid call. This is the case the guard exists
    // for, and the one that would otherwise submit an incomplete argument object.
    const plan = planToolForm(
      {
        type: "object",
        properties: {
          name: { type: "string" },
          payload: { type: "array", items: { type: "number" } },
        },
        required: ["name", "payload"],
      },
      "binary_tool",
    );
    expect(plan.usable).toBe(false);
    if (plan.usable) return;
    expect(plan.refusal.kind).toBe("required-dropped");
    if (plan.refusal.kind !== "required-dropped") return;
    expect(plan.refusal.missing).toEqual(["payload"]);
  });

  test("an OPTIONAL dropped property is NOT a refusal — it costs a field, not a valid call", () => {
    const plan = planToolForm(
      {
        type: "object",
        properties: {
          name: { type: "string" },
          payload: { type: "array", items: { type: "number" } },
        },
        required: ["name"],
      },
      "optional_drop_tool",
    );
    expect(plan.usable).toBe(true);
    if (!plan.usable) return;
    expect(specFieldNames(plan.spec.fields).has("payload")).toBe(false);
  });

  test("refuses a schema that is not an object at all", () => {
    for (const bad of [null, undefined, [], "string", 42]) {
      const plan = planToolForm(bad, "weird_tool");
      expect(plan.usable).toBe(false);
    }
  });

  test("a tool with NO arguments is still a usable form (an empty one), not a refusal", () => {
    const plan = planToolForm({ type: "object", properties: {} }, "no_args_tool");
    expect(plan.usable).toBe(true);
    if (!plan.usable) return;
    expect(plan.spec.fields).toEqual([]);
  });
});

describe("describeRefusal — a refusal is explained, not merely observed", () => {
  test("every refusal kind produces a sentence naming the raw editor fallback", () => {
    const kinds: ToolFormRefusal[] = [
      { kind: "unsupported-keyword", detail: "oneOf at #/properties/x" },
      { kind: "required-dropped", missing: ["x"], detail: "would omit a required argument: x." },
      { kind: "nested-object", properties: ["address"], detail: "would flatten a nested object." },
    ];
    for (const refusal of kinds) {
      const text = describeRefusal(refusal);
      expect(text).toContain("raw editor");
      expect(text).toContain(refusal.detail);
    }
  });
});
