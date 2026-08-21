// ==================================================================================================
// new-component — scaffold a catalogued illustration (D-IL12, WP 1.4)
// ==================================================================================================
// Three work packages added twenty entities by READING A NEIGHBOUR AND COPYING ITS SHAPE. It worked,
// and it cost the same rediscovery three times over: that `illusLayer` and `entityHeightUnits` are
// attached to the function AFTER it is declared, that `resolveVariant` falls back rather than
// throws, that the census lives beside the cast module. This script is that knowledge written down
// once, in the only form that cannot go stale — the thing that actually writes the files.
//
// Usage:
//
//   node packages/illustrations/scripts/new-component.mjs <Name> --cast <pilot|runtime|assets|orchestration>
//                                                        [--tier 1|2|3] [--entity snake_case]
//                                                        [--variants a,b] [--dry-run]
//
// WHAT IT TOUCHES, AND WHAT IT MUST NEVER TOUCH. A new component's whole edit surface is five files:
// its own `.tsx`, its own `.test.tsx`, its cast module, that module's census, and the registry
// changelog. It does NOT touch `src/registry.ts` or `src/entities/index.ts` — those name no entity
// on purpose (WP 1.1's cast-module seam), and if this script ever needed to reach into either of
// them the seam would have regressed and that is a FINDING to report, not a line to add here.
//
// TRANSACTIONAL. Every file is rendered in memory and every precondition is checked before a single
// byte is written; if a write throws half way, the originals are restored and the new files are
// removed. A half-scaffolded component is worse than none — it leaves a cast module importing a file
// that does not exist, which fails at module load across every test in the package.
//
// NO NEW DEPENDENCY (D-IL3). Plain Node: `node:fs`, `node:path`, `node:util`'s `parseArgs`, and
// string templates. It is a `.mjs` beside the existing `scripts/`, which sits OUTSIDE the package's
// `tsconfig.json` `include` — deliberately, so scaffolding tooling never becomes part of the shipped
// type surface. That also means it cannot import the registry (which is `.tsx`), so every question
// it asks about the existing catalog is asked of the SOURCES, by reading them.

import { readFileSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

const HERE = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = join(HERE, "..");
const ENTITIES_DIR = join(PACKAGE_ROOT, "src", "entities");
const CHANGELOG_PATH = join(PACKAGE_ROOT, "CHANGELOG.md");

/** The four cast modules, and the work package each one belongs to (used in generated comments). */
export const CAST_MODULES = {
  pilot: "WP 0.3",
  runtime: "WP 1.1",
  assets: "WP 1.2",
  orchestration: "WP 1.3",
};

/** The marker the changelog carries so an appended line lands somewhere deliberate. */
export const CHANGELOG_MARKER = "<!-- new-component.mjs appends one line per component below -->";

/** Every state and size a new component must claim — the closed sets, not a subset (D-IL8, D-IL2). */
const ALL_STATES = ["idle", "active", "highlight", "dimmed", "error"];
const ALL_SIZES = ["s", "m", "l"];

// -- Naming ----------------------------------------------------------------------------------------

/** `Owner` -> `owner`, `McpServer` -> `mcp-server`, `TokenMeter` -> `token-meter` (D-IL9's id shape). */
export function kebabCase(name) {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1-$2")
    .toLowerCase();
}

/** `Owner` -> `owner`, `McpServer` -> `mcpServer` — the prefix every export in the file carries. */
export function camelCase(name) {
  return name.charAt(0).toLowerCase() + name.slice(1);
}

/** `McpServer` -> `Mcp Server`: a first-guess title the author is expected to correct. */
export function titleFrom(name) {
  return name.replace(/([a-z0-9])([A-Z])/g, "$1 $2");
}

/** `ILLUSTRATION_ORCHESTRATION_CAST` — the exported array a cast module publishes. */
function castArrayName(cast) {
  return `ILLUSTRATION_${cast.toUpperCase()}_CAST`;
}

// -- Reading the catalog that already exists -------------------------------------------------------

/**
 * Every id the catalog already claims, read from the entity sources themselves.
 *
 * It reads the SOURCES rather than importing the registry because this file is `.mjs` and the
 * registry is `.tsx` — but that turns out to be the honest thing anyway: the question is "has anyone
 * already taken this id", and the answer lives in the 23 files that declare one, not in a build
 * artifact that may be stale.
 */
export function claimedIds(entitiesDir = ENTITIES_DIR) {
  const found = new Map();
  for (const file of readdirSync(entitiesDir)) {
    if (!file.endsWith(".tsx") || file.endsWith(".test.tsx")) continue;
    const source = readFileSync(join(entitiesDir, file), "utf8");
    const match = /Meta:\s*IllustrationRegistryEntry\s*=\s*\{\s*\n\s*id:\s*"([^"]+)"/.exec(source);
    if (match) found.set(match[1], file);
  }
  return found;
}

// -- Rendering the five files ----------------------------------------------------------------------

/** The component source. Every part D-IL12 requires is present; the DRAWING is what is TODO. */
export function renderEntitySource(plan) {
  const { name, id, camel, title, tier, entity, variants, cast, since } = plan;
  const upper = id.replace(/-/g, "_").toUpperCase();
  const hasVariants = variants.length > 0;

  const variantBlock = hasVariants
    ? `
export const ${upper}_VARIANTS = [${variants.map((v) => `"${v}"`).join(", ")}] as const;
export type ${name}Variant = (typeof ${upper}_VARIANTS)[number];

/**
 * FALLS BACK, never throws (D-IL16). A scene that names a variant this component has never heard of
 * must still draw — a stale spec is a thing to report, not a reason for the page to go blank. The
 * contract test holds you to it: it renders an unknown variant and asserts the bytes match the
 * default drawing, ignoring only the recorded \`data-illus-variant\`.
 */
function resolveVariant(variant: string | undefined): ${name}Variant {
  return ${upper}_VARIANTS.includes(variant as ${name}Variant)
    ? (variant as ${name}Variant)
    : "${variants[0]}";
}

/**
 * TODO: PLACEHOLDER DIFFERENTIATION — replace this. The two variants currently differ only by how
 * many plinth tiers they stand on, which is enough to make the contract test's "draws every declared
 * variant differently" assertion pass but is NOT a real alternate reading. D-IL8 wants a variant to
 * be a genuinely different drawing; give it a different SILHOUETTE, not a different colour (D-IL5/
 * D-IL6 will not give you a colour anyway).
 */
const VARIANT_TIERS: Record<${name}Variant, number> = {
${variants.map((v, index) => `  "${v}": ${index === 0 ? 2 : 3},`).join("\n")}
};
`
    : "";

  const variantResolve = hasVariants ? "  const resolved = resolveVariant(variant);\n" : "";
  const variantTiers = hasVariants ? "VARIANT_TIERS[resolved]" : "PLATFORM_TIERS";
  const variantProp = hasVariants ? "resolved" : "variant";
  const tiersConst = hasVariants
    ? ""
    : `
/** TODO: how many plinth tiers this entity stands on (1-3). The stub stands on the usual two. */
const PLATFORM_TIERS = 2;
`;

  return `// ==================================================================================================
// ${title} — TODO: one line saying what this entity IS (tier ${tier}${entity ? `, entity \`${entity}\`` : ""})
// ==================================================================================================
// TODO: replace this header. Every entity in this package explains, up top, WHY it is drawn the way
// it is — what the silhouette is doing, what makes it unmistakable next to its neighbours, and which
// decisions it is honouring. That paragraph is the reason twenty entities do not look like twenty
// different hands drew them, so it is not optional decoration.
//
// Before you call this done, walk \`packages/illustrations/README.md\`'s checklist. The five things
// Phase 1 learned the hard way, in short:
//
//   1. \`${camel}HeightUnits\` is LOAD-BEARING — every port anchor measures against it, so two
//      variants must not differ in height unless a connector is MEANT to move.
//   2. NO \`<path>\`. Compose from \`../primitives/\`; a shape you cannot express there is a new
//      primitive, never an inline path. The contract test fails on a single one.
//   3. A primitive that abstracts nothing is a finding — say so, don't ship it.
//   4. LOOK AT IT. Render it and open the picture. Phase 1 changed five drawings because somebody
//      did; the gate caught none of them.
//   5. Render the WHOLE CAST at \`m\`/\`idle\` before declaring this done. If it is hard to tell from
//      a neighbour, change the SILHOUETTE.

import type { IllustrationRegistryEntry, IllustrationSize } from "@mcp-token-footprint/shared";
import type { ReactElement } from "react";
import { footprintUnits } from "../iso-math.js";
import { ConstructionGhost } from "../primitives/ConstructionGhost.js";
import { EntityRoot } from "../primitives/EntityRoot.js";
import { IsoPlatform, platformHeight } from "../primitives/IsoPlatform.js";
import type { EntityComponentProps } from "./entity-props.js";

/**
 * TODO: say what this entity's PORTS mean. A port name is the entity's sentence (\`context-in\`,
 * \`result-out\`), and the four cardinals below are only a starting point — rename them to what a
 * connector would actually be attaching to, and delete the ones that mean nothing here (D-IL7).
 *
 * TODO: \`keywords\` are what the gallery search and the assistant's catalog tool match on, and
 * \`description\` is the rendered SVG's \`<desc>\` — a11y text, not a changelog line.
 */
export const ${camel}Meta: IllustrationRegistryEntry = {
  id: "${id}",
  title: "${title}",
  entity: ${entity ? `"${entity}"` : "null"},
  tier: ${tier},
  keywords: ["${id}"],
  variants: [${variants.map((v) => `"${v}"`).join(", ")}],
  states: [${ALL_STATES.map((s) => `"${s}"`).join(", ")}],
  ports: {
    top: { title: "Top", side: "top" },
    bottom: { title: "Bottom", side: "bottom" },
    left: { title: "Left", side: "left" },
    right: { title: "Right", side: "right" },
  },
  sizes: [${ALL_SIZES.map((s) => `"${s}"`).join(", ")}],
  // The version this entity was BORN under — never the version it was last touched under. Adding a
  // component is additive and does NOT bump \`REGISTRY_VERSION\` (D-IL12, amended 2026-08-21).
  since: "${since}",
  description:
    "TODO: one line. It is read aloud by a screen reader, so describe the DRAWING, not the feature.",
};
${variantBlock}${tiersConst}
export type ${name}Props = EntityComponentProps;

/**
 * How tall the drawn solid stands, in grid units, at each footprint.
 *
 * LOAD-BEARING, and the single easiest thing to get wrong: \`EntityRoot\` anchors every \`top\` port
 * against this number, so if two variants report different heights, a connector attached to \`top\`
 * MOVES when a scene switches between them. Only let that happen when it is meant to.
 */
export function ${camel}HeightUnits(size: IllustrationSize): number {
  // TODO: add whatever this entity stands on top of the plinth.
  return platformHeight(${hasVariants ? "2" : "PLATFORM_TIERS"});
}

export function ${name}({
  size = "m",
  state = "idle",
  facing = "upstream",
  detail = "standard",
  variant,
  label,
  showPorts = false,
  idPrefix,
}: ${name}Props): ReactElement {
${variantResolve}  const footprint = footprintUnits(size);

  return (
    <EntityRoot
      meta={${camel}Meta}
      size={size}
      state={state}
      facing={facing}
      detail={detail}
      variant={${variantProp}}
      label={label}
      heightUnits={${camel}HeightUnits(size)}
      showPorts={showPorts}
      idPrefix={idPrefix}
    >
      <ConstructionGhost width={footprint} depth={footprint} />
      <IsoPlatform tiers={${variantTiers}} footprint={size} />
      {/* TODO: draw ${title} here, composed from \`../primitives/\` only. */}
    </EntityRoot>
  );
}

// Attached AFTER the function, not inside it — a function declaration cannot carry statics in its
// own body, and every entity in this package does it here, in this order.
${name}.illusLayer = "structure" as const;
${name}.entityHeightUnits = ${camel}HeightUnits;
`;
}

/** The co-located contract test: the shared checklist, and nothing else until you add to it. */
export function renderTestSource(plan) {
  const { name, id, camel } = plan;
  return `// The D-IL12 checklist for \`${id}\`, executed. \`describeEntityContract\` asks every entity the same
// questions — five states, three footprints, exactly the declared ports, both a \`<title>\` and a
// \`<desc>\`, only \`--illus-*\` paint, no \`<path>\`, the fixed layer order, deterministic bytes.
//
// TODO: add what is specific to THIS drawing beneath it. The shared harness cannot know that your
// variants must stay the same height, that your accent moment belongs to one mark, or that your
// silhouette has to survive \`s\` — and those are exactly the things that went wrong in Phase 1.

import { describeEntityContract } from "./contract-support.js";
import { ${name}, ${camel}Meta } from "./${name}.js";

describeEntityContract(${name}, ${camel}Meta);
`;
}

/** Insert a line into an alphabetically-sorted run of lines matching `pattern`, or before `fallback`. */
function insertSorted(lines, line, pattern, fallbackIndex) {
  const indices = lines.map((value, index) => [value, index]).filter(([value]) => pattern.test(value));
  if (indices.length === 0) return fallbackIndex;
  for (const [value, index] of indices) {
    if (line.localeCompare(value) < 0) return index;
  }
  return indices[indices.length - 1][1] + 1;
}

/** The cast module, with the new member added in all three places it belongs. */
export function addToCastModule(source, plan) {
  const { name, camel, cast } = plan;
  const exportLine = `export * from "./${name}.js";`;
  const importLine = `import { ${name}, ${camel}Meta } from "./${name}.js";`;
  const memberLine = `  { meta: ${camel}Meta, component: ${name} },`;

  if (source.includes(exportLine)) {
    throw new Error(`cast-${cast}.ts already re-exports ./${name}.js`);
  }

  let lines = source.split("\n");

  const firstImport = lines.findIndex((line) => line.startsWith("import "));
  if (firstImport === -1) throw new Error(`cast-${cast}.ts has no import block to extend`);
  const exportAt = insertSorted(lines, exportLine, /^export \* from "\.\/[A-Z]/, firstImport);
  lines.splice(exportAt, 0, exportLine);

  const castTypeImport = lines.findIndex((line) => line.includes('from "./cast-member.js"'));
  if (castTypeImport === -1) throw new Error(`cast-${cast}.ts does not import IllustrationCastMember`);
  const importAt = insertSorted(lines, importLine, /^import \{ [A-Z][^}]*\} from "\.\/[A-Z]/, castTypeImport);
  lines.splice(importAt, 0, importLine);

  const arrayOpen = lines.findIndex((line) => line.includes(`${castArrayName(cast)}:`));
  if (arrayOpen === -1) throw new Error(`cast-${cast}.ts does not declare ${castArrayName(cast)}`);
  const arrayClose = lines.findIndex((line, index) => index > arrayOpen && line.trim() === "];");
  if (arrayClose === -1) throw new Error(`cast-${cast}.ts's ${castArrayName(cast)} array is unterminated`);
  lines.splice(arrayClose, 0, memberLine);

  return lines.join("\n");
}

/** The census beside the cast module, with the new id in sorted position. */
export function addToCensus(source, plan) {
  const { id, cast } = plan;
  const pattern = /(\.sort\(\),\n\s*\[\n)([\s\S]*?)(\n\s*\],)/;
  const match = pattern.exec(source);
  if (!match) throw new Error(`cast-${cast}.test.ts has no id census to extend`);

  const existing = [...match[2].matchAll(/"([^"]+)"/g)].map((entry) => entry[1]);
  if (existing.includes(id)) throw new Error(`cast-${cast}.test.ts already censuses "${id}"`);

  const indent = /^(\s*)"/.exec(match[2])?.[1] ?? "        ";
  const rendered = [...existing, id]
    .sort()
    .map((entry) => `${indent}"${entry}",`)
    .join("\n");
  return source.replace(pattern, `$1${rendered}$3`);
}

/** One dated line in the registry changelog — the growth record the VERSION deliberately is not. */
export function addToChangelog(source, plan) {
  const { id, title, cast, today } = plan;
  if (!source.includes(CHANGELOG_MARKER)) {
    throw new Error(
      `CHANGELOG.md is missing its append marker (${CHANGELOG_MARKER}). Restore it rather than ` +
        "letting this script guess where a line belongs.",
    );
  }
  const line = `- ${today} — \`${id}\` — ${title} (${cast} cast)`;
  return `${source.replace(/\n+$/, "")}\n${line}\n`;
}

// -- The transaction -------------------------------------------------------------------------------

/** Everything the scaffold will do, as data — so it can be checked, printed, or rolled back. */
export function planScaffold(options, existing) {
  const { name, cast, tier, entity, variants, since, today } = options;

  if (!/^[A-Z][A-Za-z0-9]*$/.test(name)) {
    throw new Error(
      `"${name}" is not PascalCase. A component is named like \`Owner\` or \`McpServer\` — the file, ` +
        "the exported component and the kebab-case registry id are all derived from it.",
    );
  }
  if (!Object.hasOwn(CAST_MODULES, cast)) {
    throw new Error(
      `"${cast}" is not a cast module. Pick one of: ${Object.keys(CAST_MODULES).join(", ")}. ` +
        "The cast modules are the seam that lets two work packages add entities without sharing a " +
        "file (WP 1.1); a fifth one is a plan decision, not a flag.",
    );
  }
  if (![1, 2, 3].includes(tier)) throw new Error(`tier must be 1, 2 or 3 — got ${tier}`);
  if (entity !== null && !/^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/.test(entity)) {
    throw new Error(`"${entity}" is not a snake_case entity binding`);
  }
  if (variants.length === 1) {
    throw new Error(
      "a component has either no variants or at least two — one named variant is a component with " +
        "a spare name (D-IL8).",
    );
  }
  for (const variant of variants) {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(variant)) {
      throw new Error(`"${variant}" is not a kebab-case variant name`);
    }
  }

  const id = kebabCase(name);
  const owner = existing.get(id);
  if (owner) {
    throw new Error(
      `the id "${id}" is already claimed by src/entities/${owner}. An id is the catalog's primary ` +
        "key (D-IL9) and a scene spec references it by value, so it is stable forever once shipped " +
        "— pick a different name.",
    );
  }

  return {
    name,
    id,
    camel: camelCase(name),
    title: titleFrom(name),
    cast,
    tier,
    entity,
    variants,
    since,
    today,
  };
}

/**
 * Write the five files, or none of them.
 *
 * The two NEW files are refused if they already exist (never overwritten); the three EXISTING files
 * are read, transformed in memory, and only then written. If any write throws, every file touched so
 * far is put back byte-for-byte and the new ones are deleted.
 */
export function applyScaffold(plan, paths) {
  const entityPath = join(paths.entities, `${plan.name}.tsx`);
  const testPath = join(paths.entities, `${plan.name}.test.tsx`);
  const castPath = join(paths.entities, `cast-${plan.cast}.ts`);
  const censusPath = join(paths.entities, `cast-${plan.cast}.test.ts`);
  const changelogPath = paths.changelog;

  for (const target of [entityPath, testPath]) {
    let exists = true;
    try {
      readFileSync(target);
    } catch {
      exists = false;
    }
    if (exists) throw new Error(`${target} already exists — refusing to overwrite it`);
  }

  const originals = new Map();
  for (const path of [castPath, censusPath, changelogPath]) {
    originals.set(path, readFileSync(path, "utf8"));
  }

  const writes = [
    [entityPath, renderEntitySource(plan)],
    [testPath, renderTestSource(plan)],
    [castPath, addToCastModule(originals.get(castPath), plan)],
    [censusPath, addToCensus(originals.get(censusPath), plan)],
    [changelogPath, addToChangelog(originals.get(changelogPath), plan)],
  ];

  const written = [];
  try {
    for (const [path, contents] of writes) {
      writeFileSync(path, contents);
      written.push(path);
    }
  } catch (error) {
    for (const path of written) {
      const original = originals.get(path);
      if (original === undefined) {
        try {
          unlinkSync(path);
        } catch {
          /* it was never created */
        }
      } else {
        writeFileSync(path, original);
      }
    }
    throw error;
  }

  return writes.map(([path]) => path);
}

// -- CLI -------------------------------------------------------------------------------------------

function readRegistryVersion() {
  const shared = join(PACKAGE_ROOT, "..", "shared", "src", "illustration-registry.ts");
  const source = readFileSync(shared, "utf8");
  const match = /ILLUSTRATION_REGISTRY_VERSION = "([^"]+)"/.exec(source);
  if (!match) throw new Error(`could not read ILLUSTRATION_REGISTRY_VERSION from ${shared}`);
  return match[1];
}

function main(argv) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      cast: { type: "string" },
      tier: { type: "string", default: "3" },
      entity: { type: "string" },
      variants: { type: "string", default: "" },
      "dry-run": { type: "boolean", default: false },
    },
  });

  const name = positionals[0];
  if (!name) {
    throw new Error(
      "usage: node scripts/new-component.mjs <Name> --cast <pilot|runtime|assets|orchestration> " +
        "[--tier 1|2|3] [--entity snake_case] [--variants a,b] [--dry-run]",
    );
  }

  const plan = planScaffold(
    {
      name,
      cast: values.cast ?? "",
      tier: Number(values.tier),
      entity: values.entity ?? null,
      variants: values.variants.split(",").map((v) => v.trim()).filter(Boolean),
      since: readRegistryVersion(),
      today: new Date().toISOString().slice(0, 10),
    },
    claimedIds(ENTITIES_DIR),
  );

  if (values["dry-run"]) {
    console.log(`would scaffold "${plan.id}" (${plan.name}) into the ${plan.cast} cast:`);
    console.log(`  src/entities/${plan.name}.tsx           (new)`);
    console.log(`  src/entities/${plan.name}.test.tsx      (new)`);
    console.log(`  src/entities/cast-${plan.cast}.ts       (+3 lines)`);
    console.log(`  src/entities/cast-${plan.cast}.test.ts  (+1 id)`);
    console.log("  CHANGELOG.md                            (+1 line)");
    return;
  }

  const written = applyScaffold(plan, { entities: ENTITIES_DIR, changelog: CHANGELOG_PATH });
  console.log(`scaffolded "${plan.id}" into the ${plan.cast} cast:`);
  for (const path of written) console.log(`  ${path.replace(`${PACKAGE_ROOT}/`, "")}`);
  console.log("");
  console.log("Next: draw it, then walk packages/illustrations/README.md's checklist.");
  console.log("It did NOT touch src/registry.ts or src/entities/index.ts, and never should.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(`new-component: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
