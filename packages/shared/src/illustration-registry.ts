import { z } from "zod";

// ==================================================================================================
// Illustration catalog contract — the closed component vocabularies and the registry-entry shape
// (planning/Roadmap/RM-14-illustrations/, WP 0.1)
// ==================================================================================================
// **This module draws nothing, and it registers nothing.** Not one component, not one entry. It is
// the declaration that the primitives (WP 0.2), the first registry entries (WP 0.3), the scene spec
// (`illustration-scene.ts`, tightened in WP 2.1), the gallery route, the assistant's
// `illustrations_registry` read tool (D-IL13) and the scaffold script all import — so that none of
// them re-derives a vocabulary from prose. The precedent is `security-posture.ts`: the contract
// lands before the first rule, and every consumer is held to it.
//
// It is PURE. `zod` is its only import: no `node:*`, no filesystem, no network, no React, no
// module-level mutable state. That is what lets `apps/web`, the API (which validates authored scene
// specs WITHOUT importing React, D-IL10) and any future export path share one copy of it, and it is
// why `packages/illustrations` — the React package — owns the pixels and not the shapes
// (`.claude/rules/architecture.md`: a wire shape is declared in `packages/shared` first).
//
// Locked decisions this module encodes (planning/Roadmap/RM-14-illustrations/decisions.md):
//
//   • **D-IL7 — ports, not coordinates.** A component declares NAMED ports here; a scene's
//     connectors attach `nodeId.port -> nodeId.port`. Raw coordinates exist only as a per-node
//     layout override in the scene spec, never as a connector endpoint. That is what lets a scene
//     re-lay itself out without anybody redrawing an entity.
//   • **D-IL8 — closed grammars.** Entity states, connector kinds and sizes are closed sets mapped
//     to `--illus-*` tokens inside the illustrations package. A scene spec cannot express a raw
//     style, so a spec physically cannot go off-brand. The sets GROW, through the contribution
//     process (D-IL12); they are never widened ad hoc at a call site.
//   • **D-IL9 — the registry is the single catalog.** One zod-typed entry shape, one
//     {@link ILLUSTRATION_REGISTRY_VERSION}. No component ships without an entry, and every authored
//     scene records the registry version it was written against, so a scene is FLAGGED — never
//     silently broken — when a component's contract moves. Same discipline as `counting_version`.
//   • **D-IL15 / D-IL16 / D-IL17 — the drafting vocabularies.** Sizes are the quantized footprints
//     (S 4x4 / M 6x6 / L 8x8 units, 1 unit = 16 px); detail levels are the cut-plane set; `facing`
//     is which iso face a character's front panel mounts on. All three are closed here so the scene
//     spec and the step player reference ONE definition.
//
// What this module deliberately does NOT do: it does not close the `entity` vocabulary (see
// {@link illustrationEntitySchema}), it does not check that a connector's port exists on the
// referenced component (a cross-reference the scene validator owns, WP 2.1), and it declares no
// geometry — `iso-math.ts` is WP 0.2 and lives in the React package.

/**
 * The catalog's own version, stamped into every authored scene spec (D-IL9). A consumer comparing a
 * scene against the live registry MUST check this first: a scene authored against an older registry
 * is readable but flagged, exactly the way a scan carrying an older `TOKEN_COUNTING_VERSION` is.
 *
 * Bumped when an ENTRY's contract moves in a way that could change how an existing scene renders —
 * a port renamed or removed, a variant dropped, a footprint re-sized. ADDING a component, a variant
 * or a port is additive and leaves this alone. `0.1.0` is the pre-entry state: WP 0.1 ships the
 * shape, WP 0.3 ships the first three entries against it.
 */
export const ILLUSTRATION_REGISTRY_VERSION = "0.1.0";

/**
 * The five entity states (D-IL8, research 3.5). `idle` is the default and every component must
 * support it ({@link illustrationRegistryEntrySchema} enforces that); `highlight` and `dimmed` are
 * driven by the explain-mode step player (D-IL11), never authored as a resting state.
 */
export const ILLUSTRATION_STATES = ["idle", "active", "highlight", "dimmed", "error"] as const;
export type IllustrationState = (typeof ILLUSTRATION_STATES)[number];

/**
 * The six connector kinds (D-IL8). A kind is the ONLY thing a scene may say about a line: the
 * illustrations package maps each to its `--illus-*` stroke, dash and marker, so a spec cannot pick
 * a color or a width and cannot go off-brand.
 */
export const ILLUSTRATION_CONNECTOR_KINDS = [
  "flow",
  "read",
  "write",
  "publish",
  "loop",
  "signal",
] as const;
export type IllustrationConnectorKind = (typeof ILLUSTRATION_CONNECTOR_KINDS)[number];

/**
 * The quantized footprints (D-IL2): `s` = 4x4 units, `m` = 6x6, `l` = 8x8 on the platform top face,
 * 1 unit = 16 px in the base viewBox. Quantization is what makes components interchangeable inside
 * a scene — a station can be swapped for another of the same size and the layout does not move.
 */
export const ILLUSTRATION_SIZES = ["s", "m", "l"] as const;
export type IllustrationSize = (typeof ILLUSTRATION_SIZES)[number];

/**
 * How central a component is to the app's story, and therefore the order the gallery and the
 * assistant's catalog search surface it in. 1 = the core cast (MCP server, skill, agent), 3 = the
 * long tail. It is a curation signal, not a capability.
 */
export const ILLUSTRATION_TIERS = [1, 2, 3] as const;
export type IllustrationTier = (typeof ILLUSTRATION_TIERS)[number];

/**
 * The cut-plane set (D-IL16). A component that has no cutaway IGNORES a request for one rather than
 * erroring — a scene must never fail to render because it asked for detail an entity cannot show.
 */
export const ILLUSTRATION_DETAIL_LEVELS = ["silhouette", "standard", "cutaway"] as const;
export type IllustrationDetailLevel = (typeof ILLUSTRATION_DETAIL_LEVELS)[number];

/**
 * Which iso face an entity's front panel mounts on (D-IL17): `upstream` puts the face on the LEFT
 * (+y) face, `downstream` on the RIGHT (+x). The DEFAULT is `upstream` — in a left-to-right process
 * scene a character looks toward the incoming work, not away from it. Faceless entities ignore it.
 */
export const ILLUSTRATION_FACINGS = ["upstream", "downstream"] as const;
export type IllustrationFacing = (typeof ILLUSTRATION_FACINGS)[number];

/**
 * Which side of a component's own footprint a port sits on. This is the coarse attachment hint the
 * connector router needs; it is NOT a coordinate (D-IL7). The port's NAME carries the meaning
 * (`bus`, `context-in`, `result-out`); this says only where the line leaves from.
 */
export const ILLUSTRATION_PORT_SIDES = ["top", "bottom", "left", "right"] as const;
export type IllustrationPortSide = (typeof ILLUSTRATION_PORT_SIDES)[number];

// -- Identifier shapes -----------------------------------------------------------------------------

/** kebab-case, stable forever once shipped — a scene spec references it by value (D-IL9). */
export const ILLUSTRATION_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** `major.minor.patch`, no prerelease: a registry version is a plain, comparable triple. */
export const ILLUSTRATION_VERSION_PATTERN = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/;

/** snake_case, matching the app's own table/domain naming (`mcp_servers`, `skills`, `runs`). */
export const ILLUSTRATION_ENTITY_PATTERN = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/;

export const illustrationIdSchema = z.string().regex(ILLUSTRATION_ID_PATTERN, {
  message: "an illustration id is kebab-case (lowercase letters, digits and single hyphens)",
});

export const illustrationVersionSchema = z.string().regex(ILLUSTRATION_VERSION_PATTERN, {
  message: "a registry version is a plain major.minor.patch triple",
});

/**
 * Which domain concept a component depicts, or `null` for an abstract one (a band, a principle
 * card). Deliberately a PATTERN and not a closed enum, for two reasons. First, the vocabulary it
 * names lives outside this contract — it is the app's own table/domain naming, which grows with the
 * app rather than with the illustration catalog. Second, the app already has a frozen entity
 * vocabulary, `ASSISTANT_ENTITY_KINDS`, and that one is a WRITE-SCOPE SECURITY BOUNDARY
 * (`.claude/rules/assistant-operability.md`, D-AO3): reusing or extending it so a drawing could be
 * catalogued would put a picture inside the blast radius of the permission system. Illustrations
 * bind to the domain by name only, and never to that enum.
 */
export const illustrationEntitySchema = z
  .string()
  .regex(ILLUSTRATION_ENTITY_PATTERN, {
    message: "an entity binding is snake_case, matching the app's own domain naming",
  })
  .nullable();

// -- The closed-set schemas ------------------------------------------------------------------------

export const illustrationStateSchema = z.enum(ILLUSTRATION_STATES);
export const illustrationConnectorKindSchema = z.enum(ILLUSTRATION_CONNECTOR_KINDS);
export const illustrationSizeSchema = z.enum(ILLUSTRATION_SIZES);
export const illustrationDetailLevelSchema = z.enum(ILLUSTRATION_DETAIL_LEVELS);
export const illustrationFacingSchema = z.enum(ILLUSTRATION_FACINGS);
export const illustrationPortSideSchema = z.enum(ILLUSTRATION_PORT_SIDES);

const isIllustrationTier = (value: number): value is IllustrationTier =>
  (ILLUSTRATION_TIERS as readonly number[]).includes(value);

/**
 * Derived from {@link ILLUSTRATION_TIERS} rather than written out a second time as a literal union,
 * so the array stays the single source: removing a tier from it makes that tier stop validating,
 * which is exactly what the contract test measures.
 */
export const illustrationTierSchema = z
  .number()
  .int()
  .refine(isIllustrationTier, {
    message: `tier must be one of ${ILLUSTRATION_TIERS.join(", ")}`,
  });

/** A list drawn from a closed set is a list where a repeat is always a typo. */
const hasNoDuplicates = (values: readonly unknown[]): boolean =>
  new Set(values).size === values.length;

const NO_DUPLICATES = { message: "entries must be unique" } as const;

// -- Ports (D-IL7) ---------------------------------------------------------------------------------

/**
 * One named attachment point. The port's KEY in {@link IllustrationRegistryEntry.ports} is its name
 * — that is what a connector writes as `nodeId.port` — so the definition itself carries only what
 * the router and the gallery's port overlay need.
 *
 * `offset` is the escape hatch, in grid units along the named side, for a port that does not sit at
 * that side's midpoint (a bus running down the front edge of a rack). It is optional on purpose:
 * WP 0.2 fixes the iso frame those units are measured in, and an entry written today should not
 * have to guess at it. Nothing in WP 0.1 consumes it.
 */
export type IllustrationPortDef = {
  /** Human-readable, shown in the gallery's port overlay and returned to the assistant. */
  title: string;
  /** Which side of the component's footprint the connector leaves from. */
  side: IllustrationPortSide;
  /** Distance along `side` from its midpoint, in grid units (1 unit = 16 px). Optional. */
  offset?: number;
};

export const illustrationPortDefSchema = z
  .object({
    title: z.string().min(1),
    side: illustrationPortSideSchema,
    offset: z.number().finite().optional(),
  })
  .strict();

// -- The registry entry (D-IL9) --------------------------------------------------------------------

/**
 * One catalog entry — one component. Consumed by the gallery route (which renders everything it
 * lists), the scene renderer and validator (which resolve `node.component` and every port reference
 * against it), the assistant's read tools (which search `keywords`) and the scaffold script (which
 * refuses to create a component without one).
 */
export type IllustrationRegistryEntry = {
  /** kebab-case, stable, referenced by scene specs as `node.component`. */
  id: string;
  /** Title case, shown in the gallery. */
  title: string;
  /** The domain concept this depicts, or `null` for an abstract component. */
  entity: string | null;
  tier: IllustrationTier;
  /** Retrieval terms for the assistant's catalog search. At least one. */
  keywords: string[];
  /** Named alternates of the same component (`stdio`, `streamable-http`). May be empty. */
  variants: string[];
  /** The states this component actually implements. Always includes `idle`. */
  states: IllustrationState[];
  /** Named attachment points (D-IL7). At least one: an entity nothing can reach is a dead end. */
  ports: Record<string, IllustrationPortDef>;
  /** The footprints this component is drawn at. At least one. */
  sizes: IllustrationSize[];
  /** The registry version the component first appeared in. */
  since: string;
  /** One line. Doubles as the rendered SVG's `<desc>`, so it is a11y text, not a changelog line. */
  description: string;
};

/**
 * `.strict()`, for the same reason `ci-assertions.ts` and `security-posture.ts` are: a typo'd key
 * must be a loud rejection naming the field, never a value silently dropped from a catalog somebody
 * believes is complete. The two refinements beyond shape are D-IL8/D-IL7 invariants rather than
 * taste — `idle` is the state every renderer falls back to, and a component with no ports cannot
 * take part in a scene at all.
 */
export const illustrationRegistryEntrySchema = z
  .object({
    id: illustrationIdSchema,
    title: z.string().min(1),
    entity: illustrationEntitySchema,
    tier: illustrationTierSchema,
    keywords: z.array(z.string().min(1)).min(1).refine(hasNoDuplicates, NO_DUPLICATES),
    variants: z.array(illustrationIdSchema).refine(hasNoDuplicates, NO_DUPLICATES),
    states: z
      .array(illustrationStateSchema)
      .min(1)
      .refine(hasNoDuplicates, NO_DUPLICATES)
      .refine((states) => states.includes("idle"), {
        message: "every component must implement the default `idle` state",
      }),
    ports: z
      .record(illustrationIdSchema, illustrationPortDefSchema)
      .refine((ports) => Object.keys(ports).length > 0, {
        message: "every component declares at least one named port (D-IL7)",
      }),
    sizes: z.array(illustrationSizeSchema).min(1).refine(hasNoDuplicates, NO_DUPLICATES),
    since: illustrationVersionSchema,
    description: z.string().min(1),
  })
  .strict();

/** The whole catalog, as the gallery and the assistant read it: every id appears exactly once. */
export const illustrationRegistrySchema = z
  .array(illustrationRegistryEntrySchema)
  .refine((entries) => hasNoDuplicates(entries.map((entry) => entry.id)), {
    message: "an illustration id appears exactly once in the registry",
  });
