import {
  DEFAULT_SKILL_FLOW_ID,
  QUALITY_ENGINE_VERSION,
  QUALITY_SEVERITY_WEIGHTS,
  type QualityFinding,
  type QualityReport,
  type QualitySeverity,
  type SkillEditOp,
  type SkillFileNode,
  type SkillGraph,
  type SkillGraphNode,
  type SkillManifest,
} from "@mcp-token-footprint/shared";
import { isSectionNode, validateEditOps } from "./edit-ops.js";
import { readSectionBody } from "./roundtrip.js";
import { buildMissingBreadcrumbOps } from "./suggestions.js";

/**
 * Skill IDE WP 4.1 (I4) — the deterministic, versioned, scored skill-quality engine.
 *
 * PURE over `(manifest, files, graph, footprint)`: no model calls, no network, no filesystem, no
 * clock, and it NEVER executes skill content. The same input always yields a deep-equal report
 * (determinism is part of the acceptance). It only EMITS and shape-validates `fix` ops
 * (`validateEditOps`, landed in WP 1.1) — it never APPLIES them (that is WP 4.3, through the normal
 * edits route). A drafted `fix` that fails validation against the graph is dropped (the finding
 * stays, advisory) so a caller can never be handed an unsafe batch.
 *
 * ## Rules (each `ruleId` shares its name with a `docs/skill-authoring.md` heading anchor — the
 * Rule↔guide contract; {@link qualityGuideAnchor} derives the anchor, and the WP 4.1 test asserts
 * every emitted ruleId has a section there):
 *
 * | ruleId | severity | fires when | fix |
 * | --- | --- | --- | --- |
 * | `manifest-incomplete` | error / warning | description missing (error) or weak, <20 chars (warning) | — |
 * | `broken-ref` | error | a projector reference-resolution warning (excludes design-legitimate routing / cross-flow warnings) | — |
 * | `l1-budget` | warning | L1 metadata tokens over the ceiling | — |
 * | `l2-budget` | warning | L2 body tokens over the ceiling | — |
 * | `unused-asset` | info | a tree file that is the target of no asset node / gate script | — |
 * | `script-undocumented` | warning | a referenced script with no exit-code/verify language (an asset, not a gate) | append an expectation sentence |
 * | `gatekeeper-no-breadcrumb` | warning | a gatekeeper whose section documents no breadcrumb marker | reuse the SkillFlow missing-breadcrumbs ops |
 * | `orphan-section` | warning | a section node unreachable from any entry point or the main-flow head | — |
 * | `trigger-hygiene` | info | no keywords AND a generic description | — |
 * | `command-collision-internal` | error | two entry points share one trigger | — |
 *
 * Score: `clamp(100 - Σ QUALITY_SEVERITY_WEIGHTS[finding.severity], 0, 100)`, floored at 0 — see
 * {@link computeQualityScore} (the ONE place the formula lives; it consumes the shared weights so
 * the doc/tests derive the score from the same numbers). Stamped with `QUALITY_ENGINE_VERSION`
 * (never silently compare reports across engine versions).
 */

/** The full quality-rule catalog (I4). Each id is also a heading anchor in `docs/skill-authoring.md`. */
export const QUALITY_RULE_IDS = [
  "manifest-incomplete",
  "trigger-hygiene",
  "l1-budget",
  "l2-budget",
  "broken-ref",
  "unused-asset",
  "script-undocumented",
  "gatekeeper-no-breadcrumb",
  "orphan-section",
  "command-collision-internal",
] as const;

export type QualityRuleId = (typeof QUALITY_RULE_IDS)[number];

/** The canonical best-practices guide the findings cite. */
const GUIDE_DOC = "docs/skill-authoring.md";

/**
 * The `guideAnchor` a finding carries (Rule↔guide contract): `docs/skill-authoring.md#<ruleId>`.
 * Derived (not stored on the frozen `QualityFinding` shape) — the Quality tab (WP 4.3) links it and
 * the WP 4.1 test asserts each emitted ruleId resolves to a heading anchor in the guide.
 */
export function qualityGuideAnchor(ruleId: string): string {
  return `${GUIDE_DOC}#${ruleId}`;
}

/** The input the engine runs over — everything the route has already loaded/projected/counted. */
export type SkillQualityInput = {
  /** The version's raw `SKILL.md` text (drives the `fix` ops' section-body composition). */
  skillMd: string;
  /** The parsed (best-effort) manifest. */
  manifest: SkillManifest;
  /** The version's flat file list (from the skills repository). */
  files: SkillFileNode[];
  /** The projected graph (`projectSkillGraph`, v3). */
  graph: SkillGraph;
  /** L1/L2 token levels (`countLevels`) — only the L1/L2 subtotals are read. */
  footprint: { l1: number; l2: number };
  /** L1 metadata token ceiling (env `SKILL_QUALITY_L1_TOKEN_CEILING`, default 500). */
  l1Ceiling: number;
  /** L2 body token ceiling (env `SKILL_QUALITY_L2_TOKEN_CEILING`, default 5000). */
  l2Ceiling: number;
};

// A description shorter than this many trimmed characters is "weak" for `manifest-incomplete`.
const WEAK_DESCRIPTION_CHARS = 20;
// A description shorter than this is "generic" for `trigger-hygiene` (too thin to route on).
const GENERIC_DESCRIPTION_CHARS = 40;
// Vague/marketing phrasing that makes a description generic regardless of length.
const GENERIC_DESCRIPTION_RE =
  /\b(powerful|helper|utility|assistant|helps you|helps? (?:with|to)|tool for|toolkit|handy|various|stuff|things|do stuff)\b/i;

/**
 * Run the quality engine over one skill version. Deterministic and pure — see the file header.
 * Rules run in a fixed order; within each rule, nodes/files are visited in their given (already
 * deterministic) order, so the findings list is stable for a given input.
 */
export function analyzeSkillQuality(input: SkillQualityInput): QualityReport {
  const findings: QualityFinding[] = [];

  manifestIncompleteRule(input, findings);
  triggerHygieneRule(input, findings);
  budgetRules(input, findings);
  brokenRefRule(input, findings);
  unusedAssetRule(input, findings);
  scriptUndocumentedRule(input, findings);
  gatekeeperNoBreadcrumbRule(input, findings);
  orphanSectionRule(input, findings);
  commandCollisionRule(input, findings);

  const ruleCounts: Record<string, number> = {};
  for (const finding of findings) {
    ruleCounts[finding.ruleId] = (ruleCounts[finding.ruleId] ?? 0) + 1;
  }

  return {
    findings,
    score: computeQualityScore(findings),
    ruleCounts,
    qualityEngineVersion: QUALITY_ENGINE_VERSION,
  };
}

/**
 * The quality score formula (the ONLY place it lives): `clamp(100 - Σ weight(severity), 0, 100)`,
 * an integer. Consumes `QUALITY_SEVERITY_WEIGHTS` (shared) so nothing re-hardcodes the numbers.
 */
export function computeQualityScore(findings: readonly QualityFinding[]): number {
  const penalty = findings.reduce((sum, f) => sum + QUALITY_SEVERITY_WEIGHTS[f.severity], 0);
  return Math.max(0, Math.min(100, 100 - penalty));
}

// --- Rule: manifest-incomplete -------------------------------------------------------------------

function manifestIncompleteRule(input: SkillQualityInput, out: QualityFinding[]): void {
  const description = input.manifest.description.trim();
  if (description.length === 0) {
    out.push(
      finding(
        "manifest-incomplete",
        "error",
        "SKILL.md has no description — the router has nothing to match on.",
      ),
    );
    return;
  }
  if (description.length < WEAK_DESCRIPTION_CHARS) {
    out.push(
      finding(
        "manifest-incomplete",
        "warning",
        `Description is only ${description.length} characters — too thin for the router to choose the skill reliably (aim for a specific "use when …" sentence).`,
      ),
    );
  }
}

// --- Rule: trigger-hygiene -----------------------------------------------------------------------

function triggerHygieneRule(input: SkillQualityInput, out: QualityFinding[]): void {
  const hasKeywords = input.graph.nodes.some(
    (node) => node.kind === "entry_point" && node.trigger.type === "keyword",
  );
  if (hasKeywords) return;
  if (!isGenericDescription(input.manifest.description)) return;
  out.push(
    finding(
      "trigger-hygiene",
      "info",
      "No frontmatter keywords and a generic description — the trigger surface is thin. Add `keywords:` for the phrases users type and make the description specific.",
    ),
  );
}

function isGenericDescription(description: string): boolean {
  const trimmed = description.trim();
  if (trimmed.length < GENERIC_DESCRIPTION_CHARS) return true;
  return GENERIC_DESCRIPTION_RE.test(trimmed);
}

// --- Rules: l1-budget / l2-budget ----------------------------------------------------------------

function budgetRules(input: SkillQualityInput, out: QualityFinding[]): void {
  if (input.footprint.l1 > input.l1Ceiling) {
    out.push(
      finding(
        "l1-budget",
        "warning",
        `L1 metadata is ${input.footprint.l1} tokens, over the ${input.l1Ceiling}-token ceiling — L1 is paid in every conversation the catalog loads into. Trim the description; move detail into the body.`,
      ),
    );
  }
  if (input.footprint.l2 > input.l2Ceiling) {
    out.push(
      finding(
        "l2-budget",
        "warning",
        `L2 body is ${input.footprint.l2} tokens, over the ${input.l2Ceiling}-token ceiling — split a section out into a reference/ file so it loads only on demand.`,
      ),
    );
  }
}

// --- Rule: broken-ref ----------------------------------------------------------------------------

function brokenRefRule(input: SkillQualityInput, out: QualityFinding[]): void {
  for (const warning of input.graph.warnings) {
    if (!isBrokenRefWarning(warning)) continue;
    out.push(finding("broken-ref", "error", warning));
  }
}

/**
 * Which projector warnings are genuine broken references (promoted to errors). NOT every projector
 * warning is one: two categories are design-legitimate and appear in well-formed skills, so they
 * are NOT promoted — a `gatekeeper … branch targets are not resolvable` routing artifact (emitted
 * for any branching section) and a `cross-flow reference` (a deliberate `see /other` link). Every
 * other projector warning — an annotation naming an unresolvable script, a malformed annotation, an
 * empty/heading-less document — is a real reference failure.
 */
function isBrokenRefWarning(warning: string): boolean {
  if (warning.includes("branch targets are not resolvable")) return false;
  if (warning.startsWith("cross-flow reference")) return false;
  return true;
}

// --- Rule: unused-asset --------------------------------------------------------------------------

function unusedAssetRule(input: SkillQualityInput, out: QualityFinding[]): void {
  const referenced = referencedFilePaths(input.graph);
  for (const file of input.files) {
    if (file.isSkillMd) continue; // SKILL.md is the body, not a referenceable asset
    if (referenced.has(file.path)) continue;
    out.push(
      finding(
        "unused-asset",
        "info",
        `File "${file.path}" is bundled but referenced by no section — delete it or reference it (dead files cost registry bytes and reader attention).`,
      ),
    );
  }
}

/** Every file path the graph points at: asset nodes' `path` + validation-gate nodes' `script`. */
function referencedFilePaths(graph: SkillGraph): Set<string> {
  const paths = new Set<string>();
  for (const node of graph.nodes) {
    if (node.kind === "asset") paths.add(node.path);
    else if (node.kind === "validation_gate") paths.add(node.script);
  }
  return paths;
}

// --- Rule: script-undocumented -------------------------------------------------------------------

function scriptUndocumentedRule(input: SkillQualityInput, out: QualityFinding[]): void {
  // A referenced script the projector left as an ASSET (not a validation_gate) is one whose section
  // carried no exit-code/verify language — its contract is undocumented. (An unreferenced script is
  // `unused-asset`; a documented one is a validation_gate.)
  for (const node of input.graph.nodes) {
    if (node.kind !== "asset" || node.fileKind !== "script") continue;
    const section = referencingSection(input.graph, node.id);
    const fix = section
      ? scriptExpectationFix(input.skillMd, input.graph, section, node.path)
      : undefined;
    out.push(
      finding(
        "script-undocumented",
        "warning",
        `Script "${node.path}" is referenced without an exit-code/verification contract — state what a successful run looks like and a manual fallback for runtimes that cannot execute scripts.`,
        node.anchor,
        fix,
      ),
    );
  }
}

/** Draft an `update_section_body` op appending an expectation sentence; drop it if it can't validate. */
function scriptExpectationFix(
  skillMd: string,
  graph: SkillGraph,
  section: SkillGraphNode,
  scriptPath: string,
): SkillEditOp[] | undefined {
  const body = readSectionBody(skillMd, graph, section.id);
  if (body === undefined) return undefined;
  const sentence =
    `After running \`${scriptPath}\`, verify it exits 0 before continuing; on a non-zero exit, read stderr and fix the cause. ` +
    "If the runtime cannot execute scripts, perform this check manually.";
  if (body.includes(sentence)) return undefined; // idempotent — already appended
  const newBody = body.length > 0 ? `${body}\n\n${sentence}` : sentence;
  const ops: SkillEditOp[] = [{ op: "update_section_body", nodeId: section.id, body: newBody }];
  return validateEditOps(graph, ops).length === 0 ? ops : undefined;
}

// --- Rule: gatekeeper-no-breadcrumb --------------------------------------------------------------

function gatekeeperNoBreadcrumbRule(input: SkillQualityInput, out: QualityFinding[]): void {
  for (const node of input.graph.nodes) {
    if (node.kind !== "gatekeeper") continue;
    // Reuse the SkillFlow missing-breadcrumbs ops (IMPORT, not copy). It returns `undefined` when the
    // body already documents the marker OR its section text can't be located — in both cases there is
    // nothing to safely flag (mirrors the suggestion engine's "never guess"), so skip.
    const ops = buildMissingBreadcrumbOps(input.skillMd, input.graph, node);
    if (ops === undefined) continue;
    const fix = validateEditOps(input.graph, ops).length === 0 ? ops : undefined;
    out.push(
      finding(
        "gatekeeper-no-breadcrumb",
        "warning",
        `Gatekeeper "${node.label}" documents no breadcrumb marker — its branches can't be verified from a run. Instruct the agent to emit \`[skillflow:gate=${node.id} route=…]\` at the decision.`,
        node.anchor,
        fix,
      ),
    );
  }
}

// --- Rule: orphan-section ------------------------------------------------------------------------

function orphanSectionRule(input: SkillQualityInput, out: QualityFinding[]): void {
  const { graph } = input;
  const sectionNodes = graph.nodes.filter(isSectionNode);
  if (sectionNodes.length === 0) return;

  // Roots: every entry point + the first section node on the main flow (the body head). A skill with
  // no commands/keywords still has a main head, so a marker-less skill never flags every section.
  const roots = new Set<string>();
  for (const node of graph.nodes) {
    if (node.kind === "entry_point") roots.add(node.id);
  }
  const mainHead = graph.nodes.find(
    (node) => flowOf(node) === DEFAULT_SKILL_FLOW_ID && isSectionNode(node),
  );
  if (mainHead) roots.add(mainHead.id);

  const adjacency = new Map<string, string[]>();
  for (const edge of graph.edges) {
    const list = adjacency.get(edge.from) ?? [];
    list.push(edge.to);
    adjacency.set(edge.from, list);
  }

  const reachable = new Set<string>();
  const stack = [...roots];
  while (stack.length > 0) {
    const id = stack.pop() as string;
    if (reachable.has(id)) continue;
    reachable.add(id);
    for (const next of adjacency.get(id) ?? []) stack.push(next);
  }

  for (const node of sectionNodes) {
    if (reachable.has(node.id)) continue;
    out.push(
      finding(
        "orphan-section",
        "warning",
        `Section "${node.label}" is unreachable from any entry point or the main-flow head — no flow leads to it, so it's dead weight the agent may still read. Link it explicitly or move it to a reference/ file.`,
        node.anchor,
      ),
    );
  }
}

// --- Rule: command-collision-internal ------------------------------------------------------------

function commandCollisionRule(input: SkillQualityInput, out: QualityFinding[]): void {
  // Group entry points by their trigger (type + value); any group of ≥ 2 is a collision inside this
  // one skill (two entry points fighting for the same invocation). Frontmatter keywords are already
  // deduped by the projector, so in practice this catches duplicate `/command` headings.
  const byTrigger = new Map<string, SkillGraphNode[]>();
  for (const node of input.graph.nodes) {
    if (node.kind !== "entry_point") continue;
    const key = `${node.trigger.type}:${node.trigger.value}`;
    const list = byTrigger.get(key) ?? [];
    list.push(node);
    byTrigger.set(key, list);
  }
  for (const [key, nodes] of byTrigger) {
    if (nodes.length < 2) continue;
    const value = key.slice(key.indexOf(":") + 1);
    const labels = nodes.map((n) => `"${n.label}"`).join(", ");
    out.push(
      finding(
        "command-collision-internal",
        "error",
        `Trigger "${value}" is claimed by ${nodes.length} entry points (${labels}) — only one can win; give each a distinct trigger.`,
        nodes[0]?.anchor,
      ),
    );
  }
}

// --- Small helpers -------------------------------------------------------------------------------

/** Build a finding; `anchor`/`fix` are attached only when present (keeps the JSON minimal). */
function finding(
  ruleId: QualityRuleId,
  severity: QualitySeverity,
  message: string,
  anchor?: QualityFinding["anchor"],
  fix?: SkillEditOp[],
): QualityFinding {
  const result: QualityFinding = { ruleId, severity, message };
  if (anchor) result.anchor = anchor;
  if (fix && fix.length > 0) result.fix = fix;
  return result;
}

/** The section node with an outgoing edge INTO `nodeId` (an accessory's referencing section). */
function referencingSection(graph: SkillGraph, nodeId: string): SkillGraphNode | undefined {
  const inEdge = graph.edges.find((edge) => edge.to === nodeId);
  if (!inEdge) return undefined;
  const from = graph.nodes.find((node) => node.id === inEdge.from);
  return from && isSectionNode(from) ? from : undefined;
}

/** A node's flow, defaulting an absent `flowId` to the main flow (additive-field back-compat). */
function flowOf(node: SkillGraphNode): string {
  return node.flowId ?? DEFAULT_SKILL_FLOW_ID;
}
