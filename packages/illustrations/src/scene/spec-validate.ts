// ==================================================================================================
// validateScene — every reason a spec cannot be drawn, as a LIST (WP 2.1, system design §4)
// ==================================================================================================
// `illustrationSceneSpecSchema` in `@mcp-token-footprint/shared` answers "is this the right SHAPE".
// It cannot answer "does `agent` exist", "does `mcp-server` have a `bus` port", "is `loop` a band" —
// those need the live registry and the spec's own cross-references, and the registry lives in this
// package because it is bound to React components (D-IL10).
//
// Three properties are deliberate and each one is a decision:
//
//   1. **It returns issues, it does not throw.** An authoring surface — the gallery, the assistant's
//      `illustrations_compose_scene` (D-IL13), a future canvas — needs EVERY problem at once. A
//      throw gives you the first one and hides the rest, which is how a person ends up fixing a spec
//      one error per round trip.
//
//   2. **It never throws on bad input either.** Not "usually does not": the reference pass below
//      reads `unknown` through narrowing helpers and touches nothing it has not first proved is
//      there, so `null`, an array, a string, a half-written draft and a file that is not a scene at
//      all all come back as issues. `spec-validate.test.ts` fires those at it on purpose.
//
//   3. **Shape failures do not suppress reference failures.** The two passes are independent, and
//      that is the point rather than an accident. A draft that carries a stray key AND names nine
//      components that do not exist must report the nine — otherwise the author fixes the stray key
//      and discovers the real problem on the next run. It is also what makes the run-flow exemplar
//      usable as a negative fixture while it is still a draft.
//
// It imports `@mcp-token-footprint/shared` and NOTHING else — no React, no registry module, no
// filesystem. The registry arrives as an argument, so this file is pure and the caller decides which
// catalog a spec is judged against (the live one, or a fixture in a test).

import {
  ILLUSTRATION_REGISTRY_VERSION,
  type IllustrationRegistryEntry,
  type IllustrationSceneSpec,
  illustrationSceneSpecSchema,
} from "@mcp-token-footprint/shared";

/**
 * Every way a scene can be wrong. Closed, because a caller switches on it: the gallery groups by
 * code, and the assistant tool turns `unknown-component` into "pick a real one from the catalog"
 * while `registry-version-ahead` is a warning about the READER, not the spec.
 */
export const SCENE_ISSUE_CODES = [
  /** The spec is not the shape `illustrationSceneSpecSchema` describes. */
  "schema",
  /** The spec was authored against a catalog newer than this build's (D-IL9, flag-don't-break). */
  "registry-version-ahead",
  "duplicate-band-id",
  "duplicate-node-id",
  "duplicate-connector-id",
  /** `node.component` is not a registry id. */
  "unknown-component",
  "unknown-variant",
  "unknown-state",
  "unknown-size",
  /** A `band` reference that names no declared band. */
  "unknown-band",
  /** An endpoint, focus or target naming no declared node (nor a cycle band's gate). */
  "unknown-node",
  /** `nodeId.port` where the component declares no such port — or a gate that is not entry/exit. */
  "unknown-port",
  /** `steps[].connectors` naming no declared connector id. */
  "unknown-connector",
  /** `node.attach` naming no declared node. */
  "unknown-attach",
  /** `node.attach` chains never reach an unpinned node. */
  "attach-cycle",
  /** A `cycle` band whose `stations` count disagrees with the nodes that reference it. */
  "cycle-station-count",
] as const;
export type SceneIssueCode = (typeof SCENE_ISSUE_CODES)[number];

export type SceneIssue = {
  /** The offending location, spelled the way the JSON reads: `nodes[3].component`. */
  readonly path: string;
  readonly code: SceneIssueCode;
  readonly message: string;
  /** The offending value, when there is a single one worth naming. */
  readonly value?: string;
};

// -- Narrowing helpers: the reason this file cannot throw -------------------------------------------

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function asArray(value: unknown): readonly unknown[] | undefined {
  return Array.isArray(value) ? value : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) ? value : undefined;
}

/**
 * `nodes[3].component` — a path a person can find in the file without counting braces. The empty
 * path is the document itself, and is spelled `<root>` rather than `""`: an issue whose location
 * renders as nothing looks like a bug in the report.
 */
export const SCENE_ROOT_PATH = "<root>";

export function formatScenePath(segments: readonly (string | number)[]): string {
  if (segments.length === 0) return SCENE_ROOT_PATH;
  return segments.reduce<string>(
    (path, segment) =>
      typeof segment === "number"
        ? `${path}[${segment}]`
        : path === ""
          ? segment
          : `${path}.${segment}`,
    "",
  );
}

// -- Version comparison (D-IL9, amended 2026-08-21) ------------------------------------------------

function parseMajorMinor(value: string): { major: number; minor: number } | undefined {
  const match = /^\s*(\d+)\.(\d+)/.exec(value);
  if (match === null) return undefined;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  if (!Number.isFinite(major) || !Number.isFinite(minor)) return undefined;
  return { major, minor };
}

/**
 * Is `specVersion` a catalog this build cannot be sure it understands?
 *
 * MAJOR/MINOR only, and a PATCH difference is deliberately not ahead — that is the amended D-IL12
 * rule stated as arithmetic. The version moves when an existing entry's scene-visible contract moves;
 * adding a component leaves it alone, so a spec stamped with an OLDER version stays perfectly valid
 * and gets no issue at all. An unparseable version is not "ahead" either: it is a schema problem, and
 * `illustrationVersionSchema` already reports it as one. Reporting it twice, in two vocabularies,
 * would just make the list harder to read.
 */
export function isRegistryVersionAhead(
  specVersion: string,
  packageVersion: string = ILLUSTRATION_REGISTRY_VERSION,
): boolean {
  const spec = parseMajorMinor(specVersion);
  const pkg = parseMajorMinor(packageVersion);
  if (spec === undefined || pkg === undefined) return false;
  if (spec.major !== pkg.major) return spec.major > pkg.major;
  return spec.minor > pkg.minor;
}

// -- The endpoint grammar --------------------------------------------------------------------------

/** The two endpoints a `cycle` BAND exposes, as opposed to the ports a node exposes (D-IL7). */
export const CYCLE_BAND_GATES = ["entry", "exit"] as const;
export type CycleBandGate = (typeof CYCLE_BAND_GATES)[number];

/** `agent.context-in` → `{ owner: "agent", member: "context-in" }`. Split at the FIRST dot. */
export function splitEndpoint(
  endpoint: string,
): { readonly owner: string; readonly member: string } | undefined {
  const dot = endpoint.indexOf(".");
  if (dot <= 0 || dot === endpoint.length - 1) return undefined;
  return { owner: endpoint.slice(0, dot), member: endpoint.slice(dot + 1) };
}

// -- The validator ---------------------------------------------------------------------------------

type BandFacts = { readonly kind: string; readonly index: number; readonly stations?: number };

/**
 * Every reason `input` cannot be drawn against `registry`, in a stable order: schema issues first
 * (in zod's own order), then bands, nodes, connectors, annotations and steps in document order.
 * Stable because the list is snapshotted in tests and read by people.
 */
export function validateScene(
  input: unknown,
  registry: readonly IllustrationRegistryEntry[],
): SceneIssue[] {
  const issues: SceneIssue[] = [];
  const add = (
    segments: readonly (string | number)[],
    code: SceneIssueCode,
    message: string,
    value?: string,
  ): void => {
    issues.push(
      value === undefined
        ? { path: formatScenePath(segments), code, message }
        : { path: formatScenePath(segments), code, message, value },
    );
  };

  // ── Pass 1: shape ───────────────────────────────────────────────────────────────────────────────
  const parsed = illustrationSceneSpecSchema.safeParse(input);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      add(issue.path as readonly (string | number)[], "schema", issue.message);
    }
  }

  // ── Pass 2: references. Deliberately over the RAW input, so a shape failure elsewhere in the
  // document does not hide a real reference error here (see the header).
  const spec = asRecord(input);
  if (spec === undefined) return issues;

  const registryById = new Map(registry.map((entry) => [entry.id, entry]));

  const registryVersion = asString(spec.registryVersion);
  if (registryVersion !== undefined && isRegistryVersionAhead(registryVersion)) {
    add(
      ["registryVersion"],
      "registry-version-ahead",
      `the scene was authored against illustration catalog ${registryVersion}, which is ahead of ` +
        `this build's ${ILLUSTRATION_REGISTRY_VERSION}; an entry it references may since have ` +
        "changed shape (D-IL9)",
      registryVersion,
    );
  }

  // -- bands ---------------------------------------------------------------------------------------
  const bands = new Map<string, BandFacts>();
  for (const [index, raw] of (asArray(spec.bands) ?? []).entries()) {
    const band = asRecord(raw);
    if (band === undefined) continue;
    const id = asString(band.id);
    const kind = asString(band.kind);
    if (id === undefined || kind === undefined) continue;
    if (bands.has(id)) {
      add(["bands", index, "id"], "duplicate-band-id", `band id "${id}" is declared twice`, id);
      continue;
    }
    const stations = asInteger(band.stations);
    bands.set(id, stations === undefined ? { kind, index } : { kind, index, stations });
  }

  // -- nodes ---------------------------------------------------------------------------------------
  type NodeFacts = { readonly index: number; readonly entry?: IllustrationRegistryEntry };
  const nodes = new Map<string, NodeFacts>();
  const attachOf = new Map<string, string>();
  const stationsPerBand = new Map<string, number>();

  for (const [index, raw] of (asArray(spec.nodes) ?? []).entries()) {
    const node = asRecord(raw);
    if (node === undefined) continue;
    const id = asString(node.id);
    const component = asString(node.component);
    if (id === undefined) continue;

    const entry = component === undefined ? undefined : registryById.get(component);
    if (component !== undefined && entry === undefined) {
      add(
        ["nodes", index, "component"],
        "unknown-component",
        `"${component}" is not a component in the illustration catalog`,
        component,
      );
    }

    if (nodes.has(id)) {
      add(["nodes", index, "id"], "duplicate-node-id", `node id "${id}" is declared twice`, id);
    } else {
      nodes.set(id, entry === undefined ? { index } : { index, entry });
    }

    if (entry !== undefined) {
      const variant = asString(node.variant);
      if (variant !== undefined && !entry.variants.includes(variant)) {
        add(
          ["nodes", index, "variant"],
          "unknown-variant",
          `"${component}" declares no variant "${variant}"` +
            (entry.variants.length === 0
              ? " — it has no variants"
              : ` (it has ${entry.variants.join(", ")})`),
          variant,
        );
      }
      const state = asString(node.state);
      if (state !== undefined && !(entry.states as readonly string[]).includes(state)) {
        add(
          ["nodes", index, "state"],
          "unknown-state",
          `"${component}" does not implement the state "${state}"`,
          state,
        );
      }
      const size = asString(node.size);
      if (size !== undefined && !(entry.sizes as readonly string[]).includes(size)) {
        add(
          ["nodes", index, "size"],
          "unknown-size",
          `"${component}" is not drawn at size "${size}"`,
          size,
        );
      }
    }

    const band = asString(node.band);
    if (band !== undefined) {
      const facts = bands.get(band);
      if (facts === undefined) {
        add(["nodes", index, "band"], "unknown-band", `no band is declared with id "${band}"`, band);
      } else if (facts.kind === "cycle" && asString(node.attach) === undefined) {
        stationsPerBand.set(band, (stationsPerBand.get(band) ?? 0) + 1);
      }
    }

    const attach = asString(node.attach);
    if (attach !== undefined) attachOf.set(id, attach);
  }

  // `attach` is resolved after the whole node list is known: a node may legitimately be pinned to a
  // neighbour declared later in the file.
  for (const [id, anchor] of attachOf) {
    const self = nodes.get(id);
    if (self === undefined) continue;
    if (!nodes.has(anchor)) {
      add(
        ["nodes", self.index, "attach"],
        "unknown-attach",
        `node "${id}" is pinned to "${anchor}", which is not a node in this scene`,
        anchor,
      );
      continue;
    }
    // Walk the chain. It must reach an unpinned node within the number of nodes that exist; if it
    // does not, it is going round in a circle and the layout engine would have nothing to anchor to.
    let cursor = anchor;
    let steps = 0;
    while (steps <= nodes.size) {
      const next = attachOf.get(cursor);
      if (next === undefined) break;
      cursor = next;
      steps += 1;
    }
    if (steps > nodes.size) {
      add(
        ["nodes", self.index, "attach"],
        "attach-cycle",
        `node "${id}" is pinned through a chain that never reaches an unpinned node`,
        anchor,
      );
    }
  }

  for (const [id, facts] of bands) {
    if (facts.kind !== "cycle" || facts.stations === undefined) continue;
    const placed = stationsPerBand.get(id) ?? 0;
    if (placed !== facts.stations) {
      add(
        ["bands", facts.index, "stations"],
        "cycle-station-count",
        `cycle band "${id}" declares ${facts.stations} stations but ${placed} node(s) reference it`,
        String(facts.stations),
      );
    }
  }

  // -- endpoints (connectors, annotation targets) --------------------------------------------------
  const resolveEndpoint = (endpoint: string, segments: readonly (string | number)[]): void => {
    const split = splitEndpoint(endpoint);
    if (split === undefined) return; // a malformed endpoint is a SHAPE problem; pass 1 reported it.
    const { owner, member } = split;

    const node = nodes.get(owner);
    if (node !== undefined) {
      // An unknown component was already reported once, by id. Reporting each of its ports as
      // "unknown" too would bury that one finding under a pile of consequences.
      if (node.entry === undefined) return;
      if (!Object.hasOwn(node.entry.ports, member)) {
        add(
          segments,
          "unknown-port",
          `node "${owner}" draws a component that declares no port "${member}" ` +
            `(it has ${Object.keys(node.entry.ports).sort().join(", ")})`,
          endpoint,
        );
      }
      return;
    }

    const band = bands.get(owner);
    if (band === undefined) {
      add(segments, "unknown-node", `no node is declared with id "${owner}"`, endpoint);
      return;
    }
    if (band.kind !== "cycle") {
      add(
        segments,
        "unknown-node",
        `"${owner}" is a ${band.kind} band, not a node — only a cycle band is reachable as an ` +
          "endpoint, through its entry and exit",
        endpoint,
      );
      return;
    }
    if (!(CYCLE_BAND_GATES as readonly string[]).includes(member)) {
      add(
        segments,
        "unknown-port",
        `cycle band "${owner}" exposes ${CYCLE_BAND_GATES.join(" and ")}, not "${member}"`,
        endpoint,
      );
    }
  };

  const connectorIds = new Set<string>();
  for (const [index, raw] of (asArray(spec.connectors) ?? []).entries()) {
    const connector = asRecord(raw);
    if (connector === undefined) continue;
    const id = asString(connector.id);
    if (id !== undefined) {
      if (connectorIds.has(id)) {
        add(
          ["connectors", index, "id"],
          "duplicate-connector-id",
          `connector id "${id}" is declared twice`,
          id,
        );
      }
      connectorIds.add(id);
    }
    for (const side of ["from", "to"] as const) {
      const endpoint = asString(connector[side]);
      if (endpoint !== undefined) resolveEndpoint(endpoint, ["connectors", index, side]);
    }
  }

  // -- annotations ---------------------------------------------------------------------------------
  for (const [index, raw] of (asArray(spec.annotations) ?? []).entries()) {
    const annotation = asRecord(raw);
    if (annotation === undefined) continue;
    const band = asString(annotation.band);
    if (band !== undefined && !bands.has(band)) {
      add(
        ["annotations", index, "band"],
        "unknown-band",
        `no band is declared with id "${band}"`,
        band,
      );
    }
    const target = asString(annotation.target);
    if (target === undefined) continue;
    if (target.includes(".")) {
      resolveEndpoint(target, ["annotations", index, "target"]);
    } else if (!nodes.has(target)) {
      add(
        ["annotations", index, "target"],
        "unknown-node",
        `no node is declared with id "${target}"`,
        target,
      );
    }
  }

  // -- steps ---------------------------------------------------------------------------------------
  for (const [index, raw] of (asArray(spec.steps) ?? []).entries()) {
    const step = asRecord(raw);
    if (step === undefined) continue;
    for (const [position, entry] of (asArray(step.focus) ?? []).entries()) {
      const id = asString(entry);
      if (id === undefined || nodes.has(id)) continue;
      add(
        ["steps", index, "focus", position],
        "unknown-node",
        `step ${index} focuses "${id}", which is not a node in this scene`,
        id,
      );
    }
    for (const [position, entry] of (asArray(step.connectors) ?? []).entries()) {
      const id = asString(entry);
      if (id === undefined || connectorIds.has(id)) continue;
      add(
        ["steps", index, "connectors", position],
        "unknown-connector",
        `step ${index} spotlights connector "${id}", which is not declared in this scene`,
        id,
      );
    }
  }

  return issues;
}

export type SceneParseResult = {
  /** The parsed spec, or `null` when it could not be drawn. */
  readonly spec: IllustrationSceneSpec | null;
  readonly issues: readonly SceneIssue[];
};

/**
 * {@link validateScene} plus the parsed value, for the callers that want both — the renderer needs a
 * typed spec, the authoring surfaces need the list. `spec` is `null` whenever ANY issue was found,
 * including a reference one: a scene naming a component that does not exist parses fine and still
 * cannot be drawn, so handing back a typed value would be the same trap as an unchecked cast.
 */
export function parseScene(
  input: unknown,
  registry: readonly IllustrationRegistryEntry[],
): SceneParseResult {
  const issues = validateScene(input, registry);
  if (issues.length > 0) return { spec: null, issues };
  return { spec: illustrationSceneSpecSchema.parse(input), issues };
}
