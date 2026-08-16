// Walks a tool's JSON-Schema `inputSchema` into a flat list of top-level parameters, attributing
// the tool's measured `schemaTokens` across them proportionally (by serialized weight) so the
// per-parameter numbers sum to the real schema cost. This is a client-side estimate for "where do
// the schema tokens go" — not a re-tokenization.

export type ToolParamFlag = "large-enum" | "verbose";

export type ToolParam = {
  name: string;
  typeLabel: string;
  required: boolean;
  description?: string;
  enumValues?: string[];
  tokens: number;
  flags: ToolParamFlag[];
};

type JsonObj = Record<string, unknown>;

function isObj(v: unknown): v is JsonObj {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function typeLabel(schema: JsonObj): string {
  const enumVals = asArray(schema.enum);
  if (enumVals.length > 0) return `enum · ${enumVals.length} values`;
  const t = schema.type;
  if (t === "array") {
    const items = isObj(schema.items) ? schema.items : undefined;
    const itemType = items?.type;
    if (itemType === "object" || (items && isObj(items.properties))) return "array<object>";
    if (typeof itemType === "string") return `array<${itemType}>`;
    return "array";
  }
  if (Array.isArray(t)) return t.filter((x) => typeof x === "string").join(" | ") || "any";
  if (typeof t === "string") return t;
  if (isObj(schema.properties)) return "object";
  return "any";
}

function weightOf(name: string, schema: unknown): number {
  try {
    return JSON.stringify({ [name]: schema }).length;
  } catch {
    return name.length + 8;
  }
}

/** Parse top-level parameters and attribute `schemaTokens` across them. */
export function parseParams(inputSchema: unknown, schemaTokens: number): ToolParam[] {
  if (!isObj(inputSchema) || !isObj(inputSchema.properties)) return [];
  const required = new Set(
    asArray(inputSchema.required).filter((x): x is string => typeof x === "string"),
  );
  const entries = Object.entries(inputSchema.properties).filter(([, v]) => isObj(v)) as [
    string,
    JsonObj,
  ][];
  if (entries.length === 0) return [];

  const weights = entries.map(([name, schema]) => weightOf(name, schema));
  const totalWeight = weights.reduce((a, b) => a + b, 0) || 1;

  return entries.map(([name, schema], index) => {
    const tokens = Math.max(1, Math.round((schemaTokens * (weights[index] ?? 0)) / totalWeight));
    const enumValues = asArray(schema.enum).map((x) => String(x));
    const description = typeof schema.description === "string" ? schema.description : undefined;
    const flags: ToolParamFlag[] = [];
    if (enumValues.length > 6) flags.push("large-enum");
    if (description && description.length > 200) flags.push("verbose");
    return {
      name,
      typeLabel: typeLabel(schema),
      required: required.has(name),
      description,
      enumValues: enumValues.length > 0 ? enumValues : undefined,
      tokens,
      flags,
    };
  });
}

/** Stable sort: required params first, then optional, preserving original order within each group. */
export function sortParams(params: ToolParam[]): ToolParam[] {
  const requiredFirst = params.filter((p) => p.required);
  const optional = params.filter((p) => !p.required);
  return [...requiredFirst, ...optional];
}
