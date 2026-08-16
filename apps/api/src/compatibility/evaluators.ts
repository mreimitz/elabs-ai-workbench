// Pure measurement functions for the catalog's `measured.expr` (the data-driven static checks).
// Schema-introspection mirrors the research evaluator ids (count_all_properties, max_nesting_depth,
// max_enum_length, is_object_schema, unsupported_keywords, count_duplicates).

type JsonSchema = Record<string, unknown>;

function asObject(v: unknown): JsonSchema | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as JsonSchema) : null;
}

/** A usable object input schema = an object with `type: "object"` and/or a `properties` map. */
export function isObjectSchema(schema: unknown): boolean {
  const s = asObject(schema);
  if (!s) return false;
  if (s.type === "object") return true;
  return asObject(s.properties) !== null;
}

/** Total number of `properties` keys across the whole schema tree (OpenAI strict counts all). */
export function countAllProperties(schema: unknown): number {
  let count = 0;
  const visit = (node: unknown): void => {
    const s = asObject(node);
    if (!s) return;
    const props = asObject(s.properties);
    if (props) {
      count += Object.keys(props).length;
      for (const child of Object.values(props)) visit(child);
    }
    const items = s.items;
    if (Array.isArray(items)) items.forEach(visit);
    else if (items) visit(items);
    for (const key of ["anyOf", "oneOf", "allOf"]) {
      const branch = s[key];
      if (Array.isArray(branch)) branch.forEach(visit);
    }
    const defs = asObject(s.$defs) ?? asObject(s.definitions);
    if (defs) for (const child of Object.values(defs)) visit(child);
  };
  visit(schema);
  return count;
}

/** Maximum object-nesting depth (a top-level object schema = depth 1). */
export function maxNestingDepth(schema: unknown): number {
  const visit = (node: unknown, depth: number): number => {
    const s = asObject(node);
    if (!s) return depth;
    let max = depth;
    const props = asObject(s.properties);
    if (props)
      for (const child of Object.values(props)) max = Math.max(max, visit(child, depth + 1));
    const items = s.items;
    if (Array.isArray(items)) for (const it of items) max = Math.max(max, visit(it, depth + 1));
    else if (items) max = Math.max(max, visit(items, depth + 1));
    for (const key of ["anyOf", "oneOf", "allOf"]) {
      const branch = s[key];
      if (Array.isArray(branch)) for (const b of branch) max = Math.max(max, visit(b, depth));
    }
    return max;
  };
  return isObjectSchema(schema) ? visit(schema, 1) : 0;
}

/** Largest enum array length anywhere in the schema. */
export function maxEnumLength(schema: unknown): number {
  let max = 0;
  const visit = (node: unknown): void => {
    const s = asObject(node);
    if (!s) return;
    if (Array.isArray(s.enum)) max = Math.max(max, s.enum.length);
    const props = asObject(s.properties);
    if (props) for (const child of Object.values(props)) visit(child);
    const items = s.items;
    if (Array.isArray(items)) items.forEach(visit);
    else if (items) visit(items);
    for (const key of ["anyOf", "oneOf", "allOf"]) {
      const branch = s[key];
      if (Array.isArray(branch)) branch.forEach(visit);
    }
    // Traverse $defs/definitions too — a large enum factored into a reusable def must still count
    // (mirrors countAllProperties / unsupportedKeywords, which already walk defs).
    const defs = asObject(s.$defs) ?? asObject(s.definitions);
    if (defs) for (const child of Object.values(defs)) visit(child);
  };
  visit(schema);
  return max;
}

// Keywords OpenAI strict mode rejects (the strictest common denominator). Other providers vary; the
// per-model severity resolver downgrades the impact where the provider is permissive.
const STRICT_UNSUPPORTED = [
  "oneOf",
  "$ref",
  "allOf",
  "not",
  "patternProperties",
  "if",
  "then",
  "else",
];

/** Disallowed-in-strict-mode keywords present anywhere in the schema (deduped). */
export function unsupportedKeywords(schema: unknown): string[] {
  const found = new Set<string>();
  const visit = (node: unknown): void => {
    const s = asObject(node);
    if (!s) return;
    for (const kw of STRICT_UNSUPPORTED) if (kw in s) found.add(kw);
    const props = asObject(s.properties);
    if (props) for (const child of Object.values(props)) visit(child);
    const items = s.items;
    if (Array.isArray(items)) items.forEach(visit);
    else if (items) visit(items);
    for (const key of ["anyOf", "oneOf", "allOf"]) {
      const branch = s[key];
      if (Array.isArray(branch)) branch.forEach(visit);
    }
    // Also descend into patternProperties value-schemas and an object-form additionalProperties — an
    // unsupported keyword (e.g. oneOf) nested under either would otherwise be missed (false pass).
    const pattern = asObject(s.patternProperties);
    if (pattern) for (const child of Object.values(pattern)) visit(child);
    const additional = asObject(s.additionalProperties); // `false`/`true` are not objects → skipped
    if (additional) visit(additional);
    const defs = asObject(s.$defs) ?? asObject(s.definitions);
    if (defs) for (const child of Object.values(defs)) visit(child);
  };
  visit(schema);
  return [...found];
}

/** Count of names that appear more than once. */
export function countDuplicates(names: string[]): number {
  const counts = new Map<string, number>();
  for (const n of names) counts.set(n, (counts.get(n) ?? 0) + 1);
  let dups = 0;
  for (const c of counts.values()) if (c > 1) dups += c - 1;
  return dups;
}

const TOOL_NAME_PATTERN = /^[a-zA-Z0-9_-]+$/;

export function matchesToolNamePattern(name: string): boolean {
  return TOOL_NAME_PATTERN.test(name);
}

/** Host namespace prefix a client adds to MCP tool names, e.g. `mcp__my_server__`. */
export function namespacePrefix(serverName: string): string {
  const handle = serverName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return `mcp__${handle}__`;
}

// --- Design-quality evaluators (doc 05 §4 / 04 mcp-builder gap analysis) -------------------------
// All are pure, model-invariant heuristics over the tool definition (no execution). They return a
// boolean (pass=true / warn=false); the runner maps false → warn so they never gate a cell.

/**
 * MCP tool annotation hints are present and not self-contradictory. The clear logical conflict is a
 * tool marked both `readOnlyHint:true` and `destructiveHint:true`. Absence of any annotation object
 * is also treated as a (soft) miss, since hosts rely on the hints to gate auto-execution.
 */
export function annotationsCoherent(annotations: unknown): boolean {
  const a = asObject(annotations);
  if (!a) return false; // no annotations declared at all → soft miss (advisory to add them)
  const readOnly = a.readOnlyHint === true;
  const destructive = a.destructiveHint === true;
  if (readOnly && destructive) return false; // logically contradictory
  return true;
}

const NAMING_RE = /^[a-z0-9]+(?:_[a-z0-9]+)+$/;
const VERBS = [
  "get",
  "list",
  "create",
  "update",
  "delete",
  "search",
  "find",
  "fetch",
  "read",
  "write",
  "run",
  "execute",
  "send",
  "add",
  "remove",
  "set",
  "query",
  "call",
  "make",
  "build",
  "open",
  "close",
  "start",
  "stop",
  "cancel",
  "check",
  "validate",
  "generate",
  "resolve",
  "lookup",
  "describe",
  "show",
  "load",
  "save",
  "export",
  "import",
  "scan",
  "count",
  "move",
  "copy",
  "enable",
  "disable",
  "publish",
  "subscribe",
  "upload",
  "download",
  "patch",
  "put",
  "post",
];

/**
 * Tool name reads as a service-prefixed, action-verb, snake_case identifier (e.g.
 * `github_create_issue`): snake_case with >=2 segments and an action verb in one of the segments.
 */
export function followsNamingConvention(name: string): boolean {
  if (!NAMING_RE.test(name)) return false;
  const segments = name.split("_");
  if (segments.length < 2) return false;
  return segments.some((s) => VERBS.includes(s));
}

const USAGE_CUES = [
  "use this",
  "use when",
  "when to use",
  "when you",
  "for example",
  "e.g",
  "such as",
  "returns",
  "useful for",
  "to retrieve",
  "to fetch",
  "to get",
  "to create",
  "to update",
  "do not use",
  "don't use",
  "instead of",
  "rather than",
  "prefer",
  "before",
];

/**
 * Description has enough substance to guide selection: a reasonable length AND either multiple
 * sentences / enough length OR an explicit usage cue (when-to-use / example / returns). A terse
 * one-liner warns.
 */
export function descriptionQualityOk(description: string | undefined): boolean {
  const d = (description ?? "").trim();
  if (d.length < 40) return false;
  const lower = d.toLowerCase();
  const hasCue = USAGE_CUES.some((c) => lower.includes(c));
  const sentenceCount = (d.match(/[.!?](\s|$)/g) ?? []).length;
  const multiSentence = sentenceCount >= 2 || d.length >= 120;
  return hasCue || multiSentence;
}

const PAGINATION_KEYS = [
  "limit",
  "offset",
  "cursor",
  "page",
  "page_size",
  "pagesize",
  "per_page",
  "perpage",
  "page_token",
  "pagetoken",
  "max_results",
  "maxresults",
  "count",
  "top",
  "skip",
  "after",
  "before",
];
const OUTPUT_FORMAT_KEYS = [
  "response_format",
  "responseformat",
  "format",
  "detail",
  "detail_level",
  "detaillevel",
  "verbosity",
  "verbose",
  "fields",
  "field_mask",
  "fieldmask",
  "view",
  "output_format",
  "outputformat",
  "projection",
  "include",
  "expand",
  "summary",
];

/** Collect the top-level (and one-level-nested) property keys of an object input schema, lowercased. */
function schemaPropertyKeys(schema: unknown): Set<string> {
  const keys = new Set<string>();
  const s = asObject(schema);
  if (!s) return keys;
  const collect = (node: unknown, depth: number): void => {
    const o = asObject(node);
    if (!o) return;
    const props = asObject(o.properties);
    if (props) {
      for (const k of Object.keys(props)) {
        keys.add(k.toLowerCase());
        if (depth < 1) collect(props[k], depth + 1);
      }
    }
  };
  collect(s, 0);
  return keys;
}

/** Schema exposes a pagination / output-limiting control (limit / offset / cursor / page / …). */
export function schemaHasPagination(schema: unknown): boolean {
  const keys = schemaPropertyKeys(schema);
  return PAGINATION_KEYS.some((k) => keys.has(k));
}

/** Schema exposes an output-shaping control (response_format / detail / fields / verbosity / …). */
export function schemaHasOutputFormat(schema: unknown): boolean {
  const keys = schemaPropertyKeys(schema);
  return OUTPUT_FORMAT_KEYS.some((k) => keys.has(k));
}
