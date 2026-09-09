import {
  UnsupportedJsonSchemaError,
  fromJsonSchema,
  type FieldSpec,
  type FormSpec,
} from "@elabs-ai/components-ui";

/**
 * tool-schema-form — decide whether an MCP tool's `inputSchema` can be rendered as a real typed
 * form, and REFUSE clearly when it cannot (RM-39 WP 3.1, decision D-BU6).
 *
 * WHY THIS MODULE EXISTS AND IS SEPARATE. The tool playground's job is to send exactly the arguments
 * a server's `inputSchema` describes. brand-ui 4.1.0 ships `fromJsonSchema()`, a deliberately narrow
 * JSON-Schema→`FormSpec` adapter that turns the common subset into real controls — a string array
 * becomes a list field, a constrained string array becomes a multi-select, an object becomes a
 * group — instead of the raw JSON textarea this app renders for anything array- or object-shaped.
 *
 * But narrow means it has two documented escape behaviours, and both are dangerous HERE in a way
 * they are not in a settings form:
 *
 *   1. It THROWS `UnsupportedJsonSchemaError` on `$ref`, `allOf`, `oneOf`, `anyOf` or `not`, anywhere
 *      in the schema. That is the adapter being honest — those keywords change what a schema MEANS
 *      and approximating them would render a field that looks plausible and is wrong.
 *   2. It DROPS, silently and by design, any property whose type its subset does not cover — a
 *      `"null"` type, a 2020-12 array-of-types, an array of non-strings, an object with no
 *      `properties`.
 *
 * Dropping an OPTIONAL property costs the operator a field. Dropping a REQUIRED one means the form
 * cannot express a valid call at all, and the button would happily submit the incomplete object. So
 * this module treats a dropped required property as a REFUSAL, exactly like a thrown keyword.
 *
 * A refusal is not a failure: the caller keeps its existing hand-written form, which can express
 * anything through its raw-JSON escape hatch. What must never happen is a typed form that silently
 * sends less than the schema asked for.
 */

/** Why a schema could not be rendered as a typed form — carried so the UI can say which. */
export type ToolFormRefusal =
  | {
      kind: "unsupported-keyword";
      /** The keyword the adapter refused (`$ref`, `oneOf`, …) and where it sat. */
      detail: string;
    }
  | {
      kind: "required-dropped";
      /** The required property names the adapter did not produce a field for. */
      missing: string[];
      detail: string;
    }
  | { kind: "not-an-object"; detail: string }
  | {
      kind: "nested-object";
      /** The object-typed property names whose shape could not be rebuilt. */
      properties: string[];
      detail: string;
    };

export type ToolFormPlan =
  | { usable: true; spec: FormSpec }
  | { usable: false; refusal: ToolFormRefusal };

/** Every field NAME a spec exposes, including those nested inside a group's branches. */
export function specFieldNames(fields: readonly FieldSpec[]): Set<string> {
  const names = new Set<string>();
  const walk = (list: readonly FieldSpec[]): void => {
    for (const field of list) {
      if (field.type === "group") {
        // A group carries no value of its own — its BRANCHES hold the real fields, and
        // `fromJsonSchema` flattens a nested object into exactly that shape.
        for (const branch of field.groups) walk(branch.fields);
        continue;
      }
      names.add(field.name);
    }
  };
  walk(fields);
  return names;
}

/**
 * Object-typed properties, which this app must currently REFUSE.
 *
 * `fromJsonSchema` maps `{ type: "object", properties: {...} }` onto a `group` field and FLATTENS
 * its children into the one flat `FormValues` map — so a schema like `{ address: { city, zip } }`
 * produces values keyed `city` and `zip`, not `address.city`. Upstream ships
 * `jsonSchemaRequestBody(spec, values)` for exactly this: it rebuilds the nested shape the flatten
 * threw away.
 *
 * **That helper is not exported from the package barrel** (verified against 4.1.0's published
 * `dist/index.d.ts`), so a consumer cannot reach it. Without it, submitting a nested schema's form
 * would send `{ city, zip }` where the tool asked for `{ address: { city, zip } }` — a call that is
 * plausible, accepted by the form, and wrong. That is the one outcome D-BU6 forbids, so a nested
 * object is a refusal here rather than a best effort.
 *
 * This is an upstream gap, recorded in RM-39; when `jsonSchemaRequestBody` becomes public this
 * function and its refusal can go, and nested schemas gain a real form.
 */
function nestedObjectProperties(schema: unknown): string[] {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) return [];
  const properties = (schema as { properties?: unknown }).properties;
  if (!properties || typeof properties !== "object" || Array.isArray(properties)) return [];
  return Object.entries(properties as Record<string, unknown>)
    .filter(([, value]) => {
      if (!value || typeof value !== "object" || Array.isArray(value)) return false;
      const node = value as { type?: unknown; properties?: unknown };
      return node.type === "object" && !!node.properties;
    })
    .map(([name]) => name);
}

/** The `required` array of a JSON Schema object node, or `[]` when it declares none. */
function requiredNames(schema: unknown): string[] {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) return [];
  const raw = (schema as { required?: unknown }).required;
  if (!Array.isArray(raw)) return [];
  return raw.filter((name): name is string => typeof name === "string");
}

/**
 * Decide how to render one tool's input schema.
 *
 * `toolName` only names the form; it never reaches the wire.
 */
export function planToolForm(inputSchema: unknown, toolName: string): ToolFormPlan {
  if (!inputSchema || typeof inputSchema !== "object" || Array.isArray(inputSchema)) {
    return {
      usable: false,
      refusal: {
        kind: "not-an-object",
        detail: "The tool declares no object input schema.",
      },
    };
  }

  let spec: FormSpec;
  try {
    spec = fromJsonSchema(inputSchema, { formName: `tool-${toolName}` });
  } catch (error) {
    if (error instanceof UnsupportedJsonSchemaError) {
      return {
        usable: false,
        refusal: { kind: "unsupported-keyword", detail: error.message },
      };
    }
    // An unexpected throw is still a refusal — the point of this module is that the typed form is
    // only used when it is KNOWN to be faithful, never when something merely did not crash.
    return {
      usable: false,
      refusal: {
        kind: "unsupported-keyword",
        detail: error instanceof Error ? error.message : String(error),
      },
    };
  }

  // Required-first ordering, preserved from the hand-written form this replaces.
  //
  // `fromJsonSchema` emits fields in the schema's own property order, which for an alphabetised
  // schema buries the one argument a caller MUST supply in the middle of six optional ones — in the
  // workbench's own `run_plan_start`, the required `source` lands sixth. The old form sorted
  // required-first and drew a divider at the boundary; keeping the ordering keeps the replacement at
  // least as usable as what it replaced (D-BU4). Stable within each group, so the schema's order
  // still decides ties.
  const ordered: FormSpec = {
    ...spec,
    fields: [
      ...spec.fields.filter((f) => f.required === true),
      ...spec.fields.filter((f) => f.required !== true),
    ],
  };

  // The flatten guard — see `nestedObjectProperties`. Checked BEFORE the drop guard because a
  // nested object does produce fields; it is the ARGUMENT SHAPE that would be wrong, which no
  // field-name check can see.
  const nested = nestedObjectProperties(inputSchema);
  if (nested.length > 0) {
    return {
      usable: false,
      refusal: {
        kind: "nested-object",
        properties: nested,
        detail: `The generated form would flatten ${nested.length === 1 ? "a nested object" : "nested objects"} (${nested.join(", ")}) and send the wrong argument shape.`,
      },
    };
  }

  // The silent-drop guard. Every property the schema marks required must have survived into a real
  // field; if one did not, a typed form physically cannot produce a valid call.
  const produced = specFieldNames(ordered.fields);
  const missing = requiredNames(inputSchema).filter((name) => !produced.has(name));
  if (missing.length > 0) {
    return {
      usable: false,
      refusal: {
        kind: "required-dropped",
        missing,
        detail: `The generated form would omit ${missing.length === 1 ? "a required argument" : "required arguments"}: ${missing.join(", ")}.`,
      },
    };
  }

  return { usable: true, spec: ordered };
}

/** One plain sentence for the UI, so a refusal is explained rather than merely observed. */
export function describeRefusal(refusal: ToolFormRefusal): string {
  switch (refusal.kind) {
    case "unsupported-keyword":
      return `This tool's schema uses a feature the generated form cannot represent, so the raw editor is shown instead. ${refusal.detail}`;
    case "required-dropped":
      return `This tool's schema uses a type the generated form cannot represent, and skipping it would drop a required argument, so the raw editor is shown instead. ${refusal.detail}`;
    case "nested-object":
      return `This tool nests its arguments, and the generated form would flatten them into the wrong shape, so the raw editor is shown instead. ${refusal.detail}`;
    case "not-an-object":
      return refusal.detail;
  }
}
