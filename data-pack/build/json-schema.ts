// A deliberately small JSON Schema validator, covering exactly the draft-2020-12 keyword subset the
// pack's own schemas use. It exists because adding a validator dependency (`ajv`) to ship four
// schema files is out of proportion, and because a validator whose supported keyword set is
// EXPLICIT cannot silently ignore a keyword an author wrote — `assertSupportedKeywords` fails on an
// unknown keyword rather than passing a document the schema meant to reject.
//
// Supported: $ref (local "#/..." pointers only), type (string or array, incl. "integer"),
// properties, required, additionalProperties (boolean or schema), items, enum, const, minItems,
// minimum, maximum, minLength, pattern.
// Annotations (ignored by design, as the spec allows): $schema, $id, title, description, format,
// examples, default, deprecated, $comment.
//
// NOT supported, and therefore REJECTED at load rather than skipped: allOf/anyOf/oneOf/not,
// if/then/else, patternProperties, propertyNames, dependent*, uniqueItems, prefixItems,
// remote $refs, $dynamicRef, unevaluated*. If a pack schema ever needs one, teach this file
// (with a negative test) instead of quietly widening what validates.

export type JsonSchema = Record<string, unknown>;

export type SchemaViolation = {
  /** JSON-Pointer-ish path into the instance, e.g. `/models/3/context/context_window_tokens`. */
  path: string;
  message: string;
};

const ANNOTATION_KEYWORDS = new Set([
  "$schema",
  "$id",
  "$anchor",
  "$comment",
  "$defs",
  "title",
  "description",
  "format",
  "examples",
  "default",
  "deprecated",
  "readOnly",
  "writeOnly",
]);

const SUPPORTED_KEYWORDS = new Set([
  "$ref",
  "type",
  "properties",
  "required",
  "additionalProperties",
  "items",
  "enum",
  "const",
  "minItems",
  "maxItems",
  "minimum",
  "maximum",
  "minLength",
  "maxLength",
  "pattern",
]);

/**
 * Walk a schema document and throw on any keyword this validator does not implement. Called once by
 * `compileSchema`, so an unsupported keyword is a loud load-time failure, never a silent pass.
 */
export function assertSupportedKeywords(schema: unknown, at = "#"): void {
  if (Array.isArray(schema)) {
    schema.forEach((s, i) => assertSupportedKeywords(s, `${at}/${i}`));
    return;
  }
  if (!schema || typeof schema !== "object") return;
  const obj = schema as JsonSchema;
  for (const key of Object.keys(obj)) {
    if (ANNOTATION_KEYWORDS.has(key)) continue;
    if (!SUPPORTED_KEYWORDS.has(key)) {
      throw new Error(`Unsupported JSON Schema keyword "${key}" at ${at}`);
    }
  }
  // Recurse only through the places a subschema can legally appear in the supported subset.
  const props = obj.properties;
  if (props && typeof props === "object") {
    for (const [k, v] of Object.entries(props as Record<string, unknown>)) {
      assertSupportedKeywords(v, `${at}/properties/${k}`);
    }
  }
  const defs = obj.$defs;
  if (defs && typeof defs === "object") {
    for (const [k, v] of Object.entries(defs as Record<string, unknown>)) {
      assertSupportedKeywords(v, `${at}/$defs/${k}`);
    }
  }
  if (obj.items !== undefined) assertSupportedKeywords(obj.items, `${at}/items`);
  if (typeof obj.additionalProperties === "object" && obj.additionalProperties !== null) {
    assertSupportedKeywords(obj.additionalProperties, `${at}/additionalProperties`);
  }
}

/** Resolve a local `#/a/b/c` pointer against the root schema. */
function resolveRef(root: JsonSchema, ref: string): JsonSchema {
  if (!ref.startsWith("#/") && ref !== "#") {
    throw new Error(`Only local $ref pointers are supported; got "${ref}"`);
  }
  if (ref === "#") return root;
  let cur: unknown = root;
  for (const rawSegment of ref.slice(2).split("/")) {
    const segment = rawSegment.replace(/~1/g, "/").replace(/~0/g, "~");
    if (!cur || typeof cur !== "object") throw new Error(`Unresolvable $ref "${ref}"`);
    cur = (cur as Record<string, unknown>)[segment];
  }
  if (!cur || typeof cur !== "object") throw new Error(`Unresolvable $ref "${ref}"`);
  return cur as JsonSchema;
}

function typeMatches(value: unknown, type: string): boolean {
  switch (type) {
    case "object":
      return typeof value === "object" && value !== null && !Array.isArray(value);
    case "array":
      return Array.isArray(value);
    case "string":
      return typeof value === "string";
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "integer":
      return typeof value === "number" && Number.isInteger(value);
    case "boolean":
      return typeof value === "boolean";
    case "null":
      return value === null;
    default:
      throw new Error(`Unsupported JSON Schema type "${type}"`);
  }
}

function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return false;
  if (typeof a !== "object") return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

function validateNode(
  root: JsonSchema,
  schema: JsonSchema,
  value: unknown,
  path: string,
  out: SchemaViolation[],
): void {
  const ref = schema.$ref;
  if (typeof ref === "string") {
    validateNode(root, resolveRef(root, ref), value, path, out);
    return;
  }

  const type = schema.type;
  if (type !== undefined) {
    const types = Array.isArray(type) ? (type as string[]) : [type as string];
    if (!types.some((t) => typeMatches(value, t))) {
      out.push({ path, message: `expected type ${types.join("|")}, got ${describe(value)}` });
      return; // Every other keyword below assumes the type held.
    }
  }

  if (schema.const !== undefined && !sameValue(value, schema.const)) {
    out.push({ path, message: `expected const ${JSON.stringify(schema.const)}` });
  }

  const enumValues = schema.enum;
  if (Array.isArray(enumValues) && !enumValues.some((e) => sameValue(value, e))) {
    out.push({ path, message: `${JSON.stringify(value)} is not one of ${JSON.stringify(enumValues)}` });
  }

  if (typeof value === "string") {
    const pattern = schema.pattern;
    if (typeof pattern === "string" && !new RegExp(pattern).test(value)) {
      out.push({ path, message: `"${value}" does not match /${pattern}/` });
    }
    const minLength = schema.minLength;
    if (typeof minLength === "number" && value.length < minLength) {
      out.push({ path, message: `shorter than minLength ${minLength}` });
    }
    const maxLength = schema.maxLength;
    if (typeof maxLength === "number" && value.length > maxLength) {
      out.push({ path, message: `longer than maxLength ${maxLength}` });
    }
  }

  if (typeof value === "number") {
    const minimum = schema.minimum;
    if (typeof minimum === "number" && value < minimum) {
      out.push({ path, message: `${value} is below minimum ${minimum}` });
    }
    const maximum = schema.maximum;
    if (typeof maximum === "number" && value > maximum) {
      out.push({ path, message: `${value} is above maximum ${maximum}` });
    }
  }

  if (Array.isArray(value)) {
    const minItems = schema.minItems;
    if (typeof minItems === "number" && value.length < minItems) {
      out.push({ path, message: `has ${value.length} items, minItems is ${minItems}` });
    }
    const maxItems = schema.maxItems;
    if (typeof maxItems === "number" && value.length > maxItems) {
      out.push({ path, message: `has ${value.length} items, maxItems is ${maxItems}` });
    }
    const items = schema.items;
    if (items && typeof items === "object") {
      value.forEach((v, i) => validateNode(root, items as JsonSchema, v, `${path}/${i}`, out));
    }
  }

  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    const required = schema.required;
    if (Array.isArray(required)) {
      for (const key of required as string[]) {
        if (!Object.hasOwn(obj, key)) {
          out.push({ path: `${path}/${key}`, message: "required property is missing" });
        }
      }
    }
    const properties = (schema.properties ?? {}) as Record<string, unknown>;
    for (const [key, sub] of Object.entries(properties)) {
      if (!Object.hasOwn(obj, key)) continue;
      if (sub && typeof sub === "object") {
        validateNode(root, sub as JsonSchema, obj[key], `${path}/${key}`, out);
      }
    }
    const additional = schema.additionalProperties;
    if (additional === false) {
      for (const key of Object.keys(obj)) {
        if (!Object.hasOwn(properties, key)) {
          out.push({ path: `${path}/${key}`, message: "property is not allowed (additionalProperties: false)" });
        }
      }
    } else if (additional && typeof additional === "object") {
      for (const key of Object.keys(obj)) {
        if (Object.hasOwn(properties, key)) continue;
        validateNode(root, additional as JsonSchema, obj[key], `${path}/${key}`, out);
      }
    }
  }
}

function describe(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

export type SchemaValidator = (instance: unknown) => SchemaViolation[];

/**
 * Compile a schema into a validator. Throws on an unsupported keyword (see the header); the returned
 * validator never throws — it answers with the list of violations, empty when the instance is valid.
 */
export function compileSchema(schema: JsonSchema): SchemaValidator {
  assertSupportedKeywords(schema);
  return (instance: unknown) => {
    const out: SchemaViolation[] = [];
    validateNode(schema, schema, instance, "", out);
    return out;
  };
}

/** Render violations as one message, for a test assertion or a refusal detail. */
export function formatViolations(label: string, violations: readonly SchemaViolation[]): string {
  return `${label}: ${violations.map((v) => `${v.path || "/"} — ${v.message}`).join("; ")}`;
}
