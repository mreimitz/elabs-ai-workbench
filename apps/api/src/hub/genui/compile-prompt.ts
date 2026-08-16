// Assistant Hub (WP2.6, R-GUI1) — compile the shared `HUB_GENUI_CATALOG` into the LAYER-4 prompt catalog
// text. This is ONE of the three artifacts derived from the single registry (the others: the validator
// [shared `validateGenuiSpec`] + the JSON schema [`json-schema.ts`]) — regenerated together so the prompt
// the model reads and the validator that judges its output can never disagree.
//
// The doc-04 §4 playbook: compact one-line TYPED SIGNATURES grouped by purpose, with per-component notes
// and anti-patterns — NOT JSON Schema (a schema in the prompt is expensive + drifts; the real schema is
// the tool's input schema). The GenUI prompt LAYER (`hub/prompting/layers/genui.ts`) injects this verbatim
// at its `{{GENUI_CATALOG}}` marker.

import {
  HUB_GENUI_CATALOG,
  HUB_GENUI_SPEC_VERSION,
  type GenuiComponentGroup,
  type GenuiComponentSpec,
  type GenuiPropSpec,
} from "@mcp-token-footprint/shared";

const GROUP_TITLES: Record<GenuiComponentGroup, string> = {
  layout: "Layout (containers — may hold children)",
  content: "Content",
  data: "Data",
  chart: "Charts",
  media: "Media",
  input: "Input (round-trips to you)",
};

const GROUP_ORDER: GenuiComponentGroup[] = ["layout", "content", "data", "chart", "media", "input"];

/** A one-line typed signature body for a prop: `name` / `name?` (`kind`/enum values). */
function propSignature(name: string, spec: GenuiPropSpec): string {
  const opt = spec.required ? "" : "?";
  const type =
    spec.kind === "enum" ? (spec.enum ?? []).map((v) => `"${v}"`).join("|") : spec.kind;
  return `${name}${opt}: ${type}`;
}

function componentLine(spec: GenuiComponentSpec): string {
  const props = Object.entries(spec.props)
    .map(([name, p]) => propSignature(name, p))
    .join(", ");
  const childHint = spec.container
    ? ` + children${spec.allowedChildren ? ` (${spec.allowedChildren.join("|")})` : ""}`
    : "";
  const notes = spec.notes && spec.notes.length > 0 ? ` — ${spec.notes.join(" ")}` : "";
  const anti =
    spec.antipatterns && spec.antipatterns.length > 0 ? ` Avoid: ${spec.antipatterns.join(" ")}` : "";
  return `- \`${spec.id}\`(${props})${childHint} — ${spec.summary}${notes}${anti}`;
}

/**
 * The compiled catalog text + its version, ready for {@link HubGenuiCatalogInjection}. Components are
 * grouped by purpose; each is one line. `$type` = the component id; `$key` (optional) stabilizes list
 * identity for streaming; `props` carries the typed data.
 */
export function compileGenuiCatalogPrompt(): { catalogText: string; specVersion: string } {
  const byGroup = new Map<GenuiComponentGroup, GenuiComponentSpec[]>();
  for (const spec of HUB_GENUI_CATALOG) {
    const list = byGroup.get(spec.group) ?? [];
    list.push(spec);
    byGroup.set(spec.group, list);
  }
  const sections: string[] = [];
  for (const group of GROUP_ORDER) {
    const specs = byGroup.get(group);
    if (!specs || specs.length === 0) continue;
    sections.push(`**${GROUP_TITLES[group]}**\n${specs.map(componentLine).join("\n")}`);
  }
  const catalogText = sections.join("\n\n");
  return { catalogText, specVersion: HUB_GENUI_SPEC_VERSION };
}
