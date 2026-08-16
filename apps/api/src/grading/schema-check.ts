/**
 * schema-check — an in-house, deliberately SMALL JSON-Schema **subset** validator (B6.1, WP 2.1).
 *
 * WHY in-house: adding `ajv` (or any schema engine) is a new runtime dependency and is owner-gated
 * (see `.claude/rules/dependencies.md`). The `tool_hygiene` grader only needs to catch the coarse,
 * high-signal argument mistakes a model makes when calling an MCP tool, so a tiny top-level checker is
 * enough — and being tiny keeps it deterministic and offline (it NEVER executes anything).
 *
 * SCOPE — what this checks (and ONLY this), against the TOP-LEVEL object of the tool `inputSchema`:
 *   - `missing-required`  — a name in `schema.required` is absent from the args object.
 *   - `wrong-type`        — a top-level property's declared `type` disagrees with the arg's JS type
 *                           (string / number / integer / boolean / object / array / null). `type` may
 *                           be a single string or an array of strings (matches if ANY is satisfied).
 *                           An `integer` arg satisfies a `number` schema; a non-integer `number` does
 *                           NOT satisfy an `integer` schema.
 *   - `enum-violation`    — a top-level property carries an `enum` and the arg value equals none of its
 *                           members (compared by canonical JSON, so `{a:1,b:2}` == `{b:2,a:1}`).
 *   - `unknown-property`  — an arg key is absent from `schema.properties` AND
 *                           `schema.additionalProperties === false` (only then — an open schema, the
 *                           JSON-Schema default, permits extra keys and reports nothing).
 *
 * OUT OF SCOPE — intentionally NOT validated (deeper validation would need a real engine):
 *   nested / per-property object & array-item schemas, `$ref`, `allOf`/`anyOf`/`oneOf`/`not`,
 *   `pattern`/`format`, numeric `minimum`/`maximum`/`multipleOf`, string `minLength`/`maxLength`,
 *   array `minItems`/`uniqueItems`, `dependencies`, `const`, conditional (`if`/`then`). A schema whose
 *   top level is not an object schema (or is absent) yields NO violations — the checker abstains rather
 *   than guessing.
 *
 * Returns an ORDERED list of violations (required-order first, then args-key insertion order) so the
 * output is stable — the caller ({@link import("./tool-hygiene.js")}) depends on determinism.
 */

/** The four checks this subset validator can report — a stable, documented id set. */
export type SchemaCheckId =
  | "missing-required"
  | "wrong-type"
  | "unknown-property"
  | "enum-violation";

/** One top-level violation. `property` is the offending key (or the missing/required name). */
export type SchemaViolation = {
  checkId: SchemaCheckId;
  property: string;
  message: string;
};

/** The JS-value categories this checker distinguishes (the JSON-Schema primitive `type`s + `integer`). */
export type JsonValueType =
  | "string"
  | "number"
  | "integer"
  | "boolean"
  | "object"
  | "array"
  | "null";

/**
 * Validate `args` against the TOP-LEVEL of `schema` (see the module header for the exact subset).
 * Pure + deterministic; never throws. An unusable schema (not a plain object) → `[]` (abstain).
 */
export function checkArgsAgainstSchema(schema: unknown, args: unknown): SchemaViolation[] {
  if (!isPlainObject(schema)) return [];

  const violations: SchemaViolation[] = [];
  const properties = isPlainObject(schema.properties) ? schema.properties : {};
  const required = Array.isArray(schema.required)
    ? schema.required.filter((name): name is string => typeof name === "string")
    : [];
  const additionalPropsFalse = schema.additionalProperties === false;

  // When args is not an object at all, no key is present → every required name is "missing" and no
  // per-property (type/enum/unknown) check can run. This keeps a bogus non-object arg honest.
  const argsObj = isPlainObject(args) ? args : {};

  // (1) missing-required — in schema.required order (deterministic).
  for (const name of required) {
    if (!(name in argsObj)) {
      violations.push({
        checkId: "missing-required",
        property: name,
        message: `required property "${name}" is missing`,
      });
    }
  }

  // (2)/(3)/(4) per top-level arg key — in the args object's insertion order (deterministic).
  for (const [key, value] of Object.entries(argsObj)) {
    const propSchema = properties[key];

    if (!isPlainObject(propSchema)) {
      // Key not described by any property. Only an explicitly CLOSED schema flags it.
      if (additionalPropsFalse) {
        violations.push({
          checkId: "unknown-property",
          property: key,
          message: `property "${key}" is not declared and additionalProperties is false`,
        });
      }
      continue;
    }

    // wrong-type — only when the property declares a `type`.
    const expectedTypes = normalizeTypes(propSchema.type);
    if (expectedTypes.length > 0) {
      const actual = jsonTypeOf(value);
      if (!expectedTypes.some((expected) => typeMatches(expected, actual))) {
        violations.push({
          checkId: "wrong-type",
          property: key,
          message: `property "${key}" should be ${expectedTypes.join(" | ")} but got ${actual}`,
        });
      }
    }

    // enum-violation — only when the property declares an `enum`.
    if (Array.isArray(propSchema.enum) && propSchema.enum.length > 0) {
      const canonical = canonicalJson(value);
      const inEnum = propSchema.enum.some((member) => canonicalJson(member) === canonical);
      if (!inEnum) {
        violations.push({
          checkId: "enum-violation",
          property: key,
          message: `property "${key}" value is not one of the ${propSchema.enum.length} allowed enum members`,
        });
      }
    }
  }

  return violations;
}

/** The JSON value category of `value` (arrays and null are distinguished from `object`). */
export function jsonTypeOf(value: unknown): JsonValueType {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  switch (typeof value) {
    case "string":
      return "string";
    case "boolean":
      return "boolean";
    case "number":
      return Number.isInteger(value) ? "integer" : "number";
    default:
      return "object";
  }
}

/** Does an actual JSON type satisfy a single declared schema `type`? (An integer satisfies `number`.) */
function typeMatches(expected: JsonValueType, actual: JsonValueType): boolean {
  if (expected === actual) return true;
  // JSON-Schema `number` admits integers; `integer` does NOT admit non-integer numbers.
  if (expected === "number" && actual === "integer") return true;
  return false;
}

/** A schema `type` (string | string[] | anything else) → the recognized {@link JsonValueType} list. */
function normalizeTypes(type: unknown): JsonValueType[] {
  const raw = Array.isArray(type) ? type : type === undefined ? [] : [type];
  const known: JsonValueType[] = [
    "string",
    "number",
    "integer",
    "boolean",
    "object",
    "array",
    "null",
  ];
  return raw.filter(
    (t): t is JsonValueType => typeof t === "string" && (known as string[]).includes(t),
  );
}

/** Canonical (key-sorted) JSON of a value, for order-insensitive enum membership. Undefined → "undefined". */
function canonicalJson(value: unknown): string {
  if (value === undefined) return "undefined";
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, sortKeys(v)]),
    );
  }
  return value;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
