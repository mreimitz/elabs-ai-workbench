// Assistant Hub — Declarative GenUI catalog (WP2.6, R-GUI1/2/8).
//
// THE ONE REGISTRY. This module is the single source of truth for the bounded, curated set of UI
// components the model may compose inside a message (CopilotKit's "Declarative" tier — it never writes
// HTML/JS, never chooses styles). From this one `HUB_GENUI_CATALOG` descriptor the app derives, and
// keeps in lockstep, EVERYTHING (R-GUI1 — "regenerated together so they can't disagree"):
//   • the prompt catalog       — compact one-line typed signatures + notes/anti-patterns  (API `genui/compile-prompt.ts`)
//   • the runtime validator    — the allowlist + typed-error repair hints                 (this file's `validateGenuiSpec`)
//   • the flat JSON schema     — `$type` enum + `$key` + `children` recursion             (API `genui/json-schema.ts`)
//   • the web renderer registry — `$type` → a `@brand`-part-backed React component        (web `genui/registry.tsx`)
//
// The VALIDATOR lives HERE (not in the API) on purpose: the render-time allowlist check IS the security
// boundary (R-GUI2), so the browser must run the exact same validation the server used to drive the
// repair loop — sharing the code makes "prompt and validator can never disagree" literal across the
// web/api boundary. Consistency tests assert the prompt/json-schema/renderer all cover this catalog's
// component set.
//
// R-GUI8 (tokens only): props carry STRUCTURE + DATA only — never colors, CSS, or pixel layout. There is
// no style-bearing prop kind in this catalog; because the validator rejects any prop a component does not
// declare, a model-invented `color`/`style`/`className` prop is a typed error, never rendered. The only
// look-ish props are closed enums that map to `@brand` component variants (already token-driven).

import { HUB_GENUI_SPEC_VERSION } from "./constants.js";

// ── Prop + component descriptor shapes ────────────────────────────────────────────────────────────

/** The kind of a catalog prop — how the validator checks it and how the prompt renders its signature.
 *  `text` is a multi-line string (rendered as prose); `url` is a string validated by {@link isSafeGenuiUrl};
 *  `chartSpec` is the adopted-as-is `@brand/charts` `ChartSpec` (validated shallowly — AutoChart never
 *  throws); `items` is an array of objects whose fields are themselves primitive-typed. */
export type GenuiPropKind =
  | "string"
  | "text"
  | "number"
  | "boolean"
  | "enum"
  | "url"
  | "chartSpec"
  | "items";

/** One field inside an `items` prop (a table column, a form field, a stat row, …). Primitive only —
 *  `items` fields may themselves be `items` (e.g. a form field's `options`), kept shallow. */
export interface GenuiItemFieldSpec {
  kind: "string" | "number" | "boolean" | "url" | "enum" | "items";
  required?: boolean;
  enum?: readonly string[];
  itemFields?: Record<string, GenuiItemFieldSpec>;
  description?: string;
}

/** One prop a catalog component accepts. */
export interface GenuiPropSpec {
  kind: GenuiPropKind;
  required?: boolean;
  description: string;
  /** Allowed values when `kind === "enum"`. */
  enum?: readonly string[];
  /** Field shape when `kind === "items"`. */
  itemFields?: Record<string, GenuiItemFieldSpec>;
}

/** The loose grouping used only to organize the compiled prompt catalog into readable sections. */
export type GenuiComponentGroup = "layout" | "content" | "data" | "chart" | "media" | "input";

/** One catalog component: its `$type` id, a one-line purpose, its typed props, whether it may carry
 *  children (and which), whether it participates in two-tier interactivity, and prose notes. */
export interface GenuiComponentSpec {
  id: string;
  /** One-line "Use <Component>(…) to <purpose>" signature body (the prompt renders `id` + this). */
  summary: string;
  group: GenuiComponentGroup;
  props: Record<string, GenuiPropSpec>;
  /** May the node carry `children`? Only container components may (R-GUI2 streaming shell-first). */
  container?: boolean;
  /** When set, `children` may ONLY be these component ids; omitted ⇒ any catalog component. */
  allowedChildren?: readonly string[];
  /** True for a component that round-trips to the assistant (a Form submit / a `send` Button) or holds
   *  client-side state (R-GUI5). Informational for the prompt + the renderer's interactivity wiring. */
  interactive?: boolean;
  notes?: readonly string[];
  antipatterns?: readonly string[];
}

// ── The catalog ───────────────────────────────────────────────────────────────────────────────────

const FIELD_TYPE_VALUES = ["text", "number", "select", "checkbox", "textarea"] as const;

/**
 * The curated component catalog. Each entry is backed by a `@brand` part (verified against the live
 * library, never hand-rolled): layout → `Card`/flex; content → `Heading`/`Text`/`Alert`; data →
 * `Descriptions`/`Table`/`MetricCard`; chart → `@brand/charts` `AutoChart` (`ChartSpec` adopted as-is);
 * media → `<img>`/`<a>` in token-styled frames; input → the schema→form kit + `Button`.
 */
export const HUB_GENUI_CATALOG: readonly GenuiComponentSpec[] = [
  // ── layout (containers) ──
  {
    id: "Stack",
    summary: "Use Stack(direction?, gap?) to arrange child components in a column (default) or row.",
    group: "layout",
    container: true,
    props: {
      direction: { kind: "enum", enum: ["vertical", "horizontal"], description: "Layout axis (default vertical)." },
      gap: { kind: "enum", enum: ["sm", "md", "lg"], description: "Spacing between children (default md)." },
    },
    notes: ["The default top-level container. Give every child a stable `$key`."],
  },
  {
    id: "Grid",
    summary: "Use Grid(columns?) to lay child components out in an even N-column grid.",
    group: "layout",
    container: true,
    props: {
      columns: { kind: "enum", enum: ["2", "3", "4"], description: "Number of equal columns (default 2)." },
    },
    notes: ["For a set of peer cards / stats; wraps responsively on narrow viewports."],
  },
  {
    id: "Card",
    summary: "Use Card(title?, description?) to group related children in a titled, bordered surface.",
    group: "layout",
    container: true,
    props: {
      title: { kind: "string", description: "Card heading." },
      description: { kind: "string", description: "One-line sub-heading under the title." },
    },
  },
  // ── content (leaves) ──
  {
    id: "Heading",
    summary: "Use Heading(text, level?) for a section title.",
    group: "content",
    props: {
      text: { kind: "string", required: true, description: "The heading text." },
      level: { kind: "enum", enum: ["1", "2", "3"], description: "Semantic level (default 2)." },
    },
  },
  {
    id: "Text",
    summary: "Use Text(text) for a paragraph of prose (markdown inline formatting allowed).",
    group: "content",
    props: {
      text: { kind: "text", required: true, description: "The paragraph text." },
    },
    antipatterns: ["Do not narrate tabular data as prose — use a Table or Chart."],
  },
  {
    id: "Callout",
    summary: "Use Callout(text, title?, variant?) to highlight a note, tip, warning, or error.",
    group: "content",
    props: {
      text: { kind: "text", required: true, description: "The callout body." },
      title: { kind: "string", description: "Optional bold lead-in." },
      variant: {
        kind: "enum",
        enum: ["info", "success", "warning", "error"],
        description: "Severity (maps to a token-driven Alert variant — never a raw color).",
      },
    },
  },
  // ── data ──
  {
    id: "KeyValue",
    summary: "Use KeyValue(items) for a label→value list of facts (a compact spec sheet).",
    group: "data",
    props: {
      items: {
        kind: "items",
        required: true,
        description: "The rows.",
        itemFields: {
          label: { kind: "string", required: true, description: "Left label." },
          value: { kind: "string", required: true, description: "Right value." },
        },
      },
    },
  },
  {
    id: "Table",
    summary: "Use Table(columns, rows) to compare structured records across fields.",
    group: "data",
    props: {
      columns: {
        kind: "items",
        required: true,
        description: "Column definitions, in order.",
        itemFields: {
          key: { kind: "string", required: true, description: "The field name read from each row." },
          label: { kind: "string", required: true, description: "The column header." },
        },
      },
      rows: {
        kind: "items",
        required: true,
        description: "The data rows — each an object keyed by the column `key`s (primitive cell values).",
      },
      caption: { kind: "string", description: "Optional table caption." },
    },
    antipatterns: ["Do not put a chart's time series in a Table — use a Chart for trends."],
  },
  {
    id: "StatGroup",
    summary: "Use StatGroup(stats) for a row of headline KPI figures.",
    group: "data",
    props: {
      stats: {
        kind: "items",
        required: true,
        description: "The KPI tiles.",
        itemFields: {
          label: { kind: "string", required: true, description: "Metric name." },
          value: { kind: "string", required: true, description: "The headline value (already formatted)." },
          delta: { kind: "string", description: "Optional change indicator, e.g. \"+12%\"." },
          hint: { kind: "string", description: "Optional one-line context." },
        },
      },
    },
  },
  // ── chart ──
  {
    id: "Chart",
    summary:
      "Use Chart(spec) to visualize a trend or comparison — `spec` is a ChartSpec {type?, data[], x, series[]}.",
    group: "chart",
    props: {
      spec: {
        kind: "chartSpec",
        required: true,
        description:
          "A @brand/charts ChartSpec: type? (line|area|bar|pie|scatter|radar|funnel), data (flat rows), x (field name), series (field names). Colors are token-only and chosen by the app.",
      },
    },
    notes: ["The chart itself carries the numbers — add at most one sentence of insight in a sibling Text."],
  },
  // ── media ──
  {
    id: "Image",
    summary: "Use Image(src, alt, caption?) to show an image from a trusted http(s) URL.",
    group: "media",
    props: {
      src: { kind: "url", required: true, description: "http(s) image URL (validated; javascript:/data:/file: rejected)." },
      alt: { kind: "string", required: true, description: "Accessible alt text." },
      caption: { kind: "string", description: "Caption below the image." },
    },
  },
  {
    id: "Link",
    summary: "Use Link(href, label) for a labelled hyperlink to a trusted http(s) URL.",
    group: "media",
    props: {
      href: { kind: "url", required: true, description: "http(s) destination (validated)." },
      label: { kind: "string", required: true, description: "Visible link text." },
    },
  },
  // ── input (interactive, two-tier — R-GUI5) ──
  {
    id: "Form",
    summary:
      "Use Form(name, fields, submitLabel?) to collect structured input; on submit it arrives as the user's next message.",
    group: "input",
    interactive: true,
    props: {
      name: { kind: "string", required: true, description: "Stable form name (used in the round-trip snapshot)." },
      fields: {
        kind: "items",
        required: true,
        description: "The fields, in order.",
        itemFields: {
          name: { kind: "string", required: true, description: "Field key (appears in formState)." },
          label: { kind: "string", required: true, description: "Field label." },
          type: { kind: "enum", enum: FIELD_TYPE_VALUES, required: true, description: "Control kind." },
          placeholder: { kind: "string", description: "Example input, ends with an ellipsis." },
          required: { kind: "boolean", description: "Whether the field must be filled." },
          options: {
            kind: "items",
            description: "Choices for a select field.",
            itemFields: {
              value: { kind: "string", required: true, description: "Submitted value." },
              label: { kind: "string", required: true, description: "Shown label." },
            },
          },
        },
      },
      submitLabel: { kind: "string", description: "Submit button text (default \"Submit\")." },
      humanMessage: { kind: "string", description: "Optional template shown as the user's turn on submit." },
      llmMessage: { kind: "string", description: "Optional instruction to you accompanying the submitted formState." },
    },
    notes: ["Never request passwords, keys, tokens, or other secrets through a Form."],
  },
  {
    id: "Button",
    summary:
      "Use Button(label, action, message?) for a single action — action:\"send\" messages you; action:\"reset\" clears the enclosing Form.",
    group: "input",
    interactive: true,
    props: {
      label: { kind: "string", required: true, description: "Button text." },
      action: {
        kind: "enum",
        enum: ["send", "reset"],
        required: true,
        description: "\"send\" round-trips a message to you; \"reset\" is a client-only Form reset (never reaches you).",
      },
      message: { kind: "string", description: "For action:\"send\", the message text sent as the user's turn." },
    },
  },
] as const;

/** The `$type` allowlist (the security boundary's membership set). */
export const HUB_GENUI_COMPONENT_IDS: readonly string[] = HUB_GENUI_CATALOG.map((c) => c.id);

const CATALOG_BY_ID: ReadonlyMap<string, GenuiComponentSpec> = new Map(
  HUB_GENUI_CATALOG.map((c) => [c.id, c]),
);

/** Look a component spec up by `$type`. */
export function genuiComponent(id: string): GenuiComponentSpec | undefined {
  return CATALOG_BY_ID.get(id);
}

// ── URL safety (R-GUI2 — the prop-URL boundary) ─────────────────────────────────────────────────────

/**
 * True iff `url` is safe to place in a rendered `href`/`src`. ONLY absolute http(s) URLs pass. Everything
 * else is rejected: `javascript:`/`vbscript:`/`data:`/`file:`/`blob:` schemes (XSS + local-file exfil),
 * scheme-relative `//host` (protocol-flexible), and any other/unparseable value. This is the render-time
 * URL boundary the renderer and the server validator BOTH call (R-GUI2: "prop URLs validated — no
 * `javascript:`, no unvetted `src`").
 */
export function isSafeGenuiUrl(url: unknown): url is string {
  if (typeof url !== "string") return false;
  const trimmed = url.trim();
  if (trimmed === "") return false;
  // Scheme-relative (`//evil.com`) inherits the page protocol — reject outright.
  if (trimmed.startsWith("//")) return false;
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    // Not absolute (no scheme). Reject — we never resolve a relative URL against the app origin for a
    // model-provided value (it could reach an internal API path).
    return false;
  }
  return parsed.protocol === "http:" || parsed.protocol === "https:";
}

// ── The validator (the allowlist) — R-GUI2/4/8 ─────────────────────────────────────────────────────

/** A machine-readable validation error code. Each maps to a repair HINT the model is fed back. */
export type GenuiErrorCode =
  | "not_an_object"
  | "unknown_component"
  | "missing_type"
  | "unknown_prop"
  | "missing_required_prop"
  | "wrong_prop_type"
  | "unsafe_url"
  | "children_not_allowed"
  | "child_not_allowed"
  | "bad_enum_value";

/** One typed validation issue, addressed by a `$key`/index path so the model can locate it. */
export interface GenuiValidationError {
  code: GenuiErrorCode;
  /** Dotted path to the offending node/prop, e.g. `root.children[1].props.color`. */
  path: string;
  message: string;
}

/** A minimal structural view of a GenUI node (mirrors the shared `HubGenUiNode` type). */
export interface GenuiNodeLike {
  $type?: unknown;
  $key?: unknown;
  props?: unknown;
  children?: unknown;
}

/** A sanitized (renderable) node: only known props kept, only valid children kept, recursively. */
export interface SanitizedGenuiNode {
  $type: string;
  $key?: string;
  props: Record<string, unknown>;
  children: SanitizedGenuiNode[];
}

export interface GenuiValidationResult {
  /** True iff there were ZERO errors anywhere in the tree (drives the repair loop). */
  ok: boolean;
  /** True iff the ROOT itself is renderable (known component, required props present + typed, safe URLs).
   *  When false, nothing can render (→ recovery card). When true, valid portions render even if `ok`
   *  is false (invalid children/props were dropped) — R-GUI4 "valid portions still render". */
  rootRenderable: boolean;
  /** The renderable projection — the SAME sanitization the renderer applies (valid portions only). */
  sanitized: SanitizedGenuiNode | null;
  errors: GenuiValidationError[];
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function checkItemField(
  value: unknown,
  spec: GenuiItemFieldSpec,
  path: string,
  errors: GenuiValidationError[],
): boolean {
  if (value === undefined || value === null) {
    if (spec.required) {
      errors.push({ code: "missing_required_prop", path, message: `\`${path}\` is required.` });
      return false;
    }
    return true;
  }
  switch (spec.kind) {
    case "string":
      if (typeof value !== "string") {
        errors.push({ code: "wrong_prop_type", path, message: `\`${path}\` must be a string.` });
        return false;
      }
      return true;
    case "number":
      if (typeof value !== "number") {
        errors.push({ code: "wrong_prop_type", path, message: `\`${path}\` must be a number.` });
        return false;
      }
      return true;
    case "boolean":
      if (typeof value !== "boolean") {
        errors.push({ code: "wrong_prop_type", path, message: `\`${path}\` must be a boolean.` });
        return false;
      }
      return true;
    case "url":
      if (!isSafeGenuiUrl(value)) {
        errors.push({ code: "unsafe_url", path, message: `\`${path}\` must be a safe http(s) URL.` });
        return false;
      }
      return true;
    case "enum":
      if (typeof value !== "string" || !(spec.enum ?? []).includes(value)) {
        errors.push({
          code: "bad_enum_value",
          path,
          message: `\`${path}\` must be one of: ${(spec.enum ?? []).join(", ")}.`,
        });
        return false;
      }
      return true;
    case "items": {
      if (!Array.isArray(value)) {
        errors.push({ code: "wrong_prop_type", path, message: `\`${path}\` must be an array.` });
        return false;
      }
      let allOk = true;
      value.forEach((entry, i) => {
        if (!isPlainObject(entry)) {
          errors.push({ code: "wrong_prop_type", path: `${path}[${i}]`, message: `\`${path}[${i}]\` must be an object.` });
          allOk = false;
          return;
        }
        if (spec.itemFields) {
          for (const [fname, fspec] of Object.entries(spec.itemFields)) {
            if (!checkItemField(entry[fname], fspec, `${path}[${i}].${fname}`, errors)) allOk = false;
          }
        }
      });
      return allOk;
    }
    default:
      return true;
  }
}

/** Validate + sanitize one prop value against its spec. Returns the KEPT value (or undefined to drop). */
function checkProp(
  value: unknown,
  spec: GenuiPropSpec,
  path: string,
  errors: GenuiValidationError[],
): { keep: boolean } {
  switch (spec.kind) {
    case "string":
    case "text":
      if (typeof value !== "string") {
        errors.push({ code: "wrong_prop_type", path, message: `\`${path}\` must be a string.` });
        return { keep: false };
      }
      return { keep: true };
    case "number":
      if (typeof value !== "number") {
        errors.push({ code: "wrong_prop_type", path, message: `\`${path}\` must be a number.` });
        return { keep: false };
      }
      return { keep: true };
    case "boolean":
      if (typeof value !== "boolean") {
        errors.push({ code: "wrong_prop_type", path, message: `\`${path}\` must be a boolean.` });
        return { keep: false };
      }
      return { keep: true };
    case "enum":
      if (typeof value !== "string" || !(spec.enum ?? []).includes(value)) {
        errors.push({
          code: "bad_enum_value",
          path,
          message: `\`${path}\` must be one of: ${(spec.enum ?? []).join(", ")}.`,
        });
        return { keep: false };
      }
      return { keep: true };
    case "url":
      if (!isSafeGenuiUrl(value)) {
        errors.push({ code: "unsafe_url", path, message: `\`${path}\` must be a safe http(s) URL (javascript:/data:/file: are rejected).` });
        return { keep: false };
      }
      return { keep: true };
    case "chartSpec": {
      // ChartSpec is adopted as-is; AutoChart never throws + ignores non-token colors. Validate only the
      // load-bearing shape (data rows + x + series). Deeper checks are pointless — AutoChart tolerates them.
      if (!isPlainObject(value) || !Array.isArray((value as { data?: unknown }).data)) {
        errors.push({ code: "wrong_prop_type", path, message: `\`${path}\` must be a ChartSpec object with a \`data\` array.` });
        return { keep: false };
      }
      return { keep: true };
    }
    case "items": {
      const ok = checkItemField(value, { kind: "items", required: spec.required, itemFields: spec.itemFields }, path, errors);
      return { keep: ok };
    }
    default:
      return { keep: false };
  }
}

/**
 * Validate a raw GenUI spec tree against the catalog allowlist and return typed errors + the sanitized
 * (renderable) projection (R-GUI2/4). Both the server (repair loop) and the browser (render-time
 * boundary) call this. It NEVER throws; unknown components/props, bad enums, and unsafe URLs are DATA.
 *
 * Sanitization mirrors the renderer exactly: a node with an unknown `$type` (or missing required props /
 * unsafe URL prop that is required) is unrenderable at that position (dropped from a parent's children;
 * `sanitized: null` + `rootRenderable: false` at the root). Unknown/mistyped props are dropped. Invalid
 * children are dropped (never a null hole — R-GUI3). Valid siblings/portions survive (R-GUI4).
 */
export function validateGenuiSpec(spec: unknown, path = "root"): GenuiValidationResult {
  const errors: GenuiValidationError[] = [];
  const sanitized = sanitizeNode(spec, path, errors, true);
  return {
    ok: errors.length === 0,
    rootRenderable: sanitized !== null,
    sanitized,
    errors,
  };
}

/** Recursive worker. Returns the sanitized node, or null when this position is unrenderable. When
 *  `isRoot`, a null return means the whole spec cannot render (→ recovery). */
function sanitizeNode(
  node: unknown,
  path: string,
  errors: GenuiValidationError[],
  isRoot: boolean,
): SanitizedGenuiNode | null {
  if (!isPlainObject(node)) {
    errors.push({ code: "not_an_object", path, message: `\`${path}\` must be an object.` });
    return null;
  }
  const typeVal = (node as GenuiNodeLike).$type;
  if (typeof typeVal !== "string" || typeVal === "") {
    errors.push({ code: "missing_type", path, message: `\`${path}\` is missing a \`$type\`.` });
    return null;
  }
  const spec = genuiComponent(typeVal);
  if (!spec) {
    errors.push({
      code: "unknown_component",
      path: `${path}.$type`,
      message: `Unknown component "${typeVal}". Available: ${HUB_GENUI_COMPONENT_IDS.join(", ")}.`,
    });
    return null;
  }

  const rawProps = isPlainObject((node as GenuiNodeLike).props) ? ((node as GenuiNodeLike).props as Record<string, unknown>) : {};
  const keptProps: Record<string, unknown> = {};

  // Unknown props are a HARD error (this is where an injected `color`/`style`/`onClick`/`dangerouslySet…`
  // prop is caught — R-GUI2/8 security). They are dropped from the sanitized output regardless.
  for (const key of Object.keys(rawProps)) {
    if (!(key in spec.props)) {
      errors.push({
        code: "unknown_prop",
        path: `${path}.props.${key}`,
        message: `Component "${typeVal}" has no prop "${key}". Allowed: ${Object.keys(spec.props).join(", ") || "(none)"}.`,
      });
    }
  }

  // Required-prop presence + per-prop type/URL/enum validation; a REQUIRED prop that is missing or
  // invalid makes this NODE unrenderable (drop the node; recovery at the root).
  let nodeRenderable = true;
  for (const [pname, pspec] of Object.entries(spec.props)) {
    const value = rawProps[pname];
    if (value === undefined || value === null) {
      if (pspec.required) {
        errors.push({ code: "missing_required_prop", path: `${path}.props.${pname}`, message: `\`${pname}\` is required on "${typeVal}".` });
        nodeRenderable = false;
      }
      continue;
    }
    const { keep } = checkProp(value, pspec, `${path}.props.${pname}`, errors);
    if (keep) {
      keptProps[pname] = value;
    } else if (pspec.required) {
      nodeRenderable = false;
    }
  }
  if (!nodeRenderable) {
    if (isRoot) return null;
    return null;
  }

  // Children: only containers may carry them; else it is a HARD error and they are dropped.
  const sanitizedChildren: SanitizedGenuiNode[] = [];
  const rawChildren = (node as GenuiNodeLike).children;
  if (rawChildren !== undefined && rawChildren !== null) {
    if (!spec.container || !Array.isArray(rawChildren)) {
      if (!spec.container) {
        errors.push({ code: "children_not_allowed", path: `${path}.children`, message: `Component "${typeVal}" cannot have children.` });
      } else {
        errors.push({ code: "wrong_prop_type", path: `${path}.children`, message: `\`${path}.children\` must be an array.` });
      }
    } else {
      rawChildren.forEach((child, i) => {
        const childPath = `${path}.children[${i}]`;
        const childType = isPlainObject(child) ? (child as GenuiNodeLike).$type : undefined;
        if (spec.allowedChildren && typeof childType === "string" && !spec.allowedChildren.includes(childType)) {
          errors.push({
            code: "child_not_allowed",
            path: `${childPath}.$type`,
            message: `"${typeVal}" allows only these children: ${spec.allowedChildren.join(", ")}.`,
          });
          return; // drop this child (never a null hole — R-GUI3)
        }
        const sanitizedChild = sanitizeNode(child, childPath, errors, false);
        if (sanitizedChild) sanitizedChildren.push(sanitizedChild);
      });
    }
  }

  const out: SanitizedGenuiNode = { $type: typeVal, props: keptProps, children: sanitizedChildren };
  const keyVal = (node as GenuiNodeLike).$key;
  if (typeof keyVal === "string") out.$key = keyVal;
  return out;
}

// ── Round-trip helpers (R-GUI5/6 — dual audience + send-time state stamping) ─────────────────────────

/**
 * Stamp an editable surface's current state into a user turn (R-GUI6): `[Current state of "<name>"
 * (id: <id>): <json>]`. Kept model-visible so the model can target the right surface with an
 * `update_<name>`-style tool. Used both by a Form submit's dual-audience text (R-GUI5) and by any
 * agent-editable surface's send-time snapshot.
 */
export function stampGenuiSurfaceState(name: string, id: string, state: unknown): string {
  let json: string;
  try {
    json = JSON.stringify(state);
  } catch {
    json = "{}";
  }
  return `[Current state of "${name}" (id: ${id}): ${json}]`;
}

/**
 * Build the dual-audience text sent as the user's turn when a Form is submitted or a `send` Button is
 * pressed (R-GUI5): the human-friendly line the user sees, then the machine-readable state snapshot the
 * model reads. When `formState` is present it is stamped via {@link stampGenuiSurfaceState}. Returns a
 * single string because `user_message.text` is one channel — the human line leads, the bracketed
 * snapshot trails (exactly the R-GUI6 stamping convention).
 */
export function buildGenuiSubmitMessage(input: {
  humanFriendlyMessage: string;
  llmFriendlyMessage?: string;
  surfaceName?: string;
  surfaceId?: string;
  formState?: Record<string, unknown>;
}): string {
  const parts: string[] = [input.humanFriendlyMessage.trim()];
  if (input.llmFriendlyMessage && input.llmFriendlyMessage.trim()) {
    parts.push(input.llmFriendlyMessage.trim());
  }
  if (input.formState && input.surfaceName && input.surfaceId) {
    parts.push(stampGenuiSurfaceState(input.surfaceName, input.surfaceId, input.formState));
  }
  return parts.join("\n\n");
}

/** Re-exported for callers that stamp the version onto events without importing constants directly. */
export { HUB_GENUI_SPEC_VERSION };
