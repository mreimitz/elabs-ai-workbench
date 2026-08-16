import {
  DEFAULT_LOOP_THRESHOLD,
  type SkillEditOp,
  type SkillFileNode,
  type SkillGraph,
  type SkillGraphEdge,
  type SkillGraphNode,
  type SkillManifest,
  type SkillStaticSuggestion,
  type SkillStaticSuggestionRule,
  type SkillSuggestion,
  type SkillSuggestionRule,
  type TraceAlignment,
  type TraceEvent,
  type TraceVerdict,
} from "@mcp-token-footprint/shared";
import { parse as parseYaml } from "yaml";
import { isSectionNode, validateEditOps } from "./edit-ops.js";
import { readSectionBody } from "./roundtrip.js";

/**
 * WP 5.2 — the deterministic fracture-verdict → suggested-edit engine (the feedback loop's ONLY
 * approved branch: D7's LLM-assisted branch is owner-gated and not implemented here — no model
 * calls, no network, no clock anywhere in this file). `buildSuggestions` is a PURE function of a
 * version's projected graph, its trace alignment, and the normalized event stream (needed only for
 * the one rule where the datum genuinely lives nowhere else — see {@link gateFailedSuggestion}) plus
 * the raw `SKILL.md` text (needed to compose a body-append op through the exact same section-body
 * span `applyEditOps` uses — see `roundtrip.ts`'s `readSectionBody`).
 *
 * ## Rules (one verdict may match more than one rule; a verdict with no matching rule yields NO
 * suggestion — inventing one would erode trust in the whole tracer)
 *
 * | rule | trigger (verdict STRUCTURE, not reason-string parsing) | ops |
 * | --- | --- | --- |
 * | `missing-breadcrumbs` | a `gatekeeper` node whose verdict `confidence` is `'inferred'` (no marker evidence anywhere) | `set_annotation` (pin the id, only if not already annotated) + `update_section_body` (current body + the WP 3.2 breadcrumb sentence) — advisory if the body already mentions `skillflow:gate=` (redundant) or the section text can't be located |
 * | `loop-detected` | a `fracture` on a `loop_guard` node, OR a `fracture` on any other node whose `nodeVisits` count exceeds the loop threshold (structural, never the reason string) | `update_section_body` appending a bounded-retry sentence on the governing section — advisory if no section can be resolved |
 * | `asset-never-visited` | an `asset` node verdict `'unvisited'` while its referencing section's verdict is `'ok'` | `[]` (advisory only — removing/tightening a reference is an authoring judgment call) |
 * | `gate-failed-consistently` | a `validation_gate` fracture whose evidence includes a `script_result` event (real exit-code evidence, not the tool-error degradation path) | `[]` (advisory only — SkillFlow won't guess whether the script or the expectation is wrong) |
 * | `marker-route-mismatch` | a `gatekeeper` fracture with `edgeId` set from marker evidence (the agent named a route matching no real outgoing edge) | `[]` (advisory only — the named route is provably bogus; there is no deterministic candidate replacement condition to write, and D5 never allows a guess) |
 *
 * Every suggestion whose `ops` is non-empty is validated with `validateEditOps` against the SAME
 * graph before being returned; a batch that fails validation is downgraded to advisory (`ops: []`,
 * the validation errors folded into the rationale) rather than ever being handed to a caller as
 * "safe to apply" — the no-corruption guarantee this WP promises.
 */
export type BuildSuggestionsOptions = {
  /** Mirrors `AlignOptions.loopThreshold` — must match what produced `alignment` (default 3). */
  loopThreshold?: number;
};

export function buildSuggestions(
  skillMd: string,
  graph: SkillGraph,
  alignment: TraceAlignment,
  events: TraceEvent[],
  opts?: BuildSuggestionsOptions,
): SkillSuggestion[] {
  const loopThreshold = opts?.loopThreshold ?? DEFAULT_LOOP_THRESHOLD;
  const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));
  const suggestions: SkillSuggestion[] = [];

  for (const verdict of alignment.verdicts) {
    if (!verdict.nodeId) continue; // every WP 5.2 rule is node-keyed (no edge-only verdicts today)
    const node = nodesById.get(verdict.nodeId);
    if (!node) continue; // internal inconsistency guard — never invent a suggestion for a phantom id

    if (node.kind === "gatekeeper" && verdict.confidence === "inferred") {
      pushIfDefined(suggestions, missingBreadcrumbsSuggestion(node, verdict, skillMd, graph));
    }

    if (verdict.status === "fracture") {
      pushIfDefined(
        suggestions,
        loopDetectedSuggestion(node, verdict, skillMd, graph, alignment, loopThreshold),
      );

      if (node.kind === "validation_gate") {
        pushIfDefined(suggestions, gateFailedSuggestion(node, verdict, events));
      }

      if (node.kind === "gatekeeper" && verdict.edgeId) {
        pushIfDefined(suggestions, markerRouteMismatchSuggestion(node, verdict, graph));
      }
    }

    if (node.kind === "asset" && verdict.status === "unvisited") {
      pushIfDefined(suggestions, assetNeverVisitedSuggestion(node, verdict, graph, alignment));
    }
  }

  return suggestions;
}

function pushIfDefined(list: SkillSuggestion[], suggestion: SkillSuggestion | undefined): void {
  if (suggestion) list.push(suggestion);
}

/** Deterministic suggestion id — derived from the rule + the verdict's node/edge id, never random. */
function suggestionId(rule: SkillSuggestionRule, verdict: TraceVerdict): string {
  return `${rule}:${verdict.nodeId ?? verdict.edgeId ?? "unknown"}`;
}

/**
 * Validate a candidate op batch against the graph BEFORE handing it back (the no-corruption
 * guarantee): a non-empty batch that fails `validateEditOps` is downgraded to advisory-only, with
 * the validation errors folded into the rationale so the failure is never silent.
 */
function finalizeOps(
  graph: SkillGraph,
  ops: SkillEditOp[],
  rationale: string,
): { ops: SkillEditOp[]; rationale: string } {
  if (ops.length === 0) return { ops, rationale };
  const errors = validateEditOps(graph, ops);
  if (errors.length === 0) return { ops, rationale };
  return {
    ops: [],
    rationale: `${rationale} (Downgraded to advisory-only: the drafted ops failed validation against the current graph — ${errors.join(" ")})`,
  };
}

// --- Rule 1: missing-breadcrumbs -----------------------------------------------------------------

/** A hint that a section's prose already documents the marker syntax (never insert a duplicate). */
const MARKER_HINT = "skillflow:gate=";

function breadcrumbSentence(node: SkillGraphNode, graph: SkillGraph): string {
  const routes = graph.edges
    .filter((edge) => edge.from === node.id)
    .map((edge) => (edge.condition ? `${edge.id} (${edge.condition})` : edge.id));
  const routingTable = routes.length > 0 ? ` Routing table: ${routes.join("; ")}.` : "";
  return (
    `Right before you act on this decision, emit a single line of the form ` +
    `\`[skillflow:gate=${node.id} route=<the-branch-you-chose>]\` so the choice can be checked ` +
    `later — pick \`<the-branch-you-chose>\` from the routing table below; if you're unsure, still ` +
    `emit the gate id alone with no \`route=\`.${routingTable}`
  );
}

/**
 * Build the missing-breadcrumbs fix ops for a gatekeeper `node`: pin its id with `set_annotation`
 * (only when it isn't already annotated) and append the WP 3.2 breadcrumb instruction to its section
 * body through the SAME section-scanning rules `applyEditOps` uses (`readSectionBody`). Returns
 * `undefined` when the section text can't be located or the body already documents the marker (no
 * duplicate). ADDITIVE export (Skill IDE WP 4.1) so the quality engine's `gatekeeper-no-breadcrumb`
 * rule REUSES these ops rather than copying the sentence/marker logic — the two stay in lockstep.
 * Pure: no model calls, no I/O. The caller validates the batch with `validateEditOps`.
 */
export function buildMissingBreadcrumbOps(
  skillMd: string,
  graph: SkillGraph,
  node: SkillGraphNode,
): SkillEditOp[] | undefined {
  const body = readSectionBody(skillMd, graph, node.id);
  if (body === undefined) return undefined; // can't locate the section's text — never guess
  if (body.includes(MARKER_HINT)) return undefined; // already documents the marker — no duplicate

  const ops: SkillEditOp[] = [];
  if (node.source !== "annotated") {
    ops.push({ op: "set_annotation", nodeId: node.id, kind: "gatekeeper", id: node.id });
  }
  const sentence = breadcrumbSentence(node, graph);
  const newBody = body.length > 0 ? `${body}\n\n${sentence}` : sentence;
  ops.push({ op: "update_section_body", nodeId: node.id, body: newBody });
  return ops;
}

function missingBreadcrumbsSuggestion(
  node: SkillGraphNode,
  verdict: TraceVerdict,
  skillMd: string,
  graph: SkillGraph,
): SkillSuggestion | undefined {
  const ops = buildMissingBreadcrumbOps(skillMd, graph, node);
  if (ops === undefined) return undefined; // section unlocatable or marker already documented

  const rationale =
    `Gatekeeper "${node.label}" (${node.id}) has no marker evidence in this trace — every verdict ` +
    `on it comes back 'inferred' (D7b: a silent gatekeeper is never fractured by inference alone, ` +
    `so misroutes here can't be proven). Pin its id with set_annotation (if not already annotated) ` +
    `and append the WP 3.2 breadcrumb instruction so future runs can be checked exactly.`;

  const { ops: finalOps, rationale: finalRationale } = finalizeOps(graph, ops, rationale);
  return {
    id: suggestionId("missing-breadcrumbs", verdict),
    verdictRef: { nodeId: node.id, status: verdict.status },
    rule: "missing-breadcrumbs",
    rationale: finalRationale,
    ops: finalOps,
  };
}

// --- Rule 2: loop-detected -------------------------------------------------------------------------

const RETRY_LANGUAGE_RE = /\brepeat\b|\bretr(?:y|ies)\b|at most \d+|\bloop\b/i;

/** The section (subroutine/gatekeeper) with an outgoing edge INTO `nodeId`, if any. */
function owningSectionOf(nodeId: string, graph: SkillGraph): SkillGraphNode | undefined {
  const inEdge = graph.edges.find((edge) => edge.to === nodeId);
  if (!inEdge) return undefined;
  const from = graph.nodes.find((candidate) => candidate.id === inEdge.from);
  return from && (from.kind === "subroutine" || from.kind === "gatekeeper") ? from : undefined;
}

function loopDetectedSuggestion(
  node: SkillGraphNode,
  verdict: TraceVerdict,
  skillMd: string,
  graph: SkillGraph,
  alignment: TraceAlignment,
  loopThreshold: number,
): SkillSuggestion | undefined {
  const visits = alignment.nodeVisits[node.id] ?? 0;
  const isLoopFracture = node.kind === "loop_guard" || visits > loopThreshold;
  if (!isLoopFracture) return undefined;

  // Resolve the SECTION to append the sentence to: the loop guard's owning section, or — for a
  // bare over-visited node with no attached guard — the node itself (if it's already a section) or
  // ITS owning section (an over-visited accessory).
  const targetSection =
    node.kind === "loop_guard"
      ? owningSectionOf(node.id, graph)
      : isSectionNode(node)
        ? node
        : owningSectionOf(node.id, graph);

  const rationaleIntro =
    node.kind === "loop_guard"
      ? `Loop guard "${node.label}" (${node.id}) fired: its section was visited beyond the declared cap during this run.`
      : `"${node.label}" (${node.id}) was visited ${visits} time(s) — over the loop threshold of ${loopThreshold}, with no loop guard attached to catch it.`;

  if (!targetSection) {
    return {
      id: suggestionId("loop-detected", verdict),
      verdictRef: { nodeId: node.id, status: verdict.status },
      rule: "loop-detected",
      rationale: `${rationaleIntro} No heading-anchored section could be resolved to append a bounded-retry instruction to — review manually.`,
      ops: [],
    };
  }

  const body = readSectionBody(skillMd, graph, targetSection.id);
  if (body === undefined) {
    return {
      id: suggestionId("loop-detected", verdict),
      verdictRef: { nodeId: node.id, status: verdict.status },
      rule: "loop-detected",
      rationale: `${rationaleIntro} The governing section's text could not be located — review manually.`,
      ops: [],
    };
  }

  const hasExistingRetryLanguage = RETRY_LANGUAGE_RE.test(body);
  const guardMax = node.kind === "loop_guard" ? node.maxIterations : undefined;
  const n = guardMax !== undefined ? Math.max(1, guardMax - 1) : loopThreshold;
  const sentence = hasExistingRetryLanguage
    ? `Tighten the retry cap here: repeat at most ${n} times — this section was observed exceeding its declared bound during a real run.`
    : `Repeat at most ${n} times.`;

  if (body.includes(sentence)) return undefined; // already suggested/applied — idempotent

  const newBody = body.length > 0 ? `${body}\n\n${sentence}` : sentence;
  const ops: SkillEditOp[] = [
    { op: "update_section_body", nodeId: targetSection.id, body: newBody },
  ];
  const rationale = hasExistingRetryLanguage
    ? `${rationaleIntro} "${targetSection.label}" already declares retry language, so this tightens the cap rather than inventing a new one.`
    : `${rationaleIntro} Append a bounded-retry instruction to "${targetSection.label}" so the loop can't run away again.`;

  const { ops: finalOps, rationale: finalRationale } = finalizeOps(graph, ops, rationale);
  return {
    id: suggestionId("loop-detected", verdict),
    verdictRef: { nodeId: node.id, status: verdict.status },
    rule: "loop-detected",
    rationale: finalRationale,
    ops: finalOps,
  };
}

// --- Rule 3: asset-never-visited -------------------------------------------------------------------

function assetNeverVisitedSuggestion(
  node: SkillGraphNode,
  verdict: TraceVerdict,
  graph: SkillGraph,
  alignment: TraceAlignment,
): SkillSuggestion | undefined {
  const section = owningSectionOf(node.id, graph);
  if (!section) return undefined; // no resolvable referencing section — no rule applies
  const sectionVerdict = alignment.verdicts.find((v) => v.nodeId === section.id);
  if (sectionVerdict?.status !== "ok") return undefined; // only when the section itself DID run

  return {
    id: suggestionId("asset-never-visited", verdict),
    verdictRef: { nodeId: node.id, status: verdict.status },
    rule: "asset-never-visited",
    rationale:
      `Referenced file "${(node as Extract<SkillGraphNode, { kind: "asset" }>).path}" was never ` +
      `read in this run, even though "${section.label}" (its referencing section) ran to completion — ` +
      `consider removing the reference or making it load-bearing so it's actually exercised.`,
    ops: [],
  };
}

// --- Rule 4: gate-failed-consistently ---------------------------------------------------------------

function gateFailedSuggestion(
  node: SkillGraphNode,
  verdict: TraceVerdict,
  events: TraceEvent[],
): SkillSuggestion | undefined {
  const eventsByIdx = new Map(events.map((event) => [event.idx, event]));
  // Real exit-code evidence only — the tool-error degradation path (`bindToolErrorsToGate`) never
  // cites a `script_result` event, so this deliberately excludes it (we can't quote an exit code we
  // don't have).
  const scriptResult = verdict.evidence
    .map((idx) => eventsByIdx.get(idx))
    .find(
      (event): event is Extract<TraceEvent, { type: "script_result" }> =>
        event?.type === "script_result",
    );
  if (!scriptResult) return undefined;

  const script = (node as Extract<SkillGraphNode, { kind: "validation_gate" }>).script;
  return {
    id: suggestionId("gate-failed-consistently", verdict),
    verdictRef: { nodeId: node.id, status: verdict.status },
    rule: "gate-failed-consistently",
    rationale:
      `Script ${script} exited ${scriptResult.payload.exitCode} — fix the script or the expectation; ` +
      `SkillFlow won't guess which.`,
    ops: [],
  };
}

// --- Rule 5: marker-route-mismatch ------------------------------------------------------------------

function markerRouteMismatchSuggestion(
  node: SkillGraphNode,
  verdict: TraceVerdict,
  graph: SkillGraph,
): SkillSuggestion | undefined {
  if (verdict.confidence !== "exact") return undefined; // must be backed by real marker evidence
  const bogusRoute = verdict.edgeId;
  if (!bogusRoute) return undefined;
  // The aligner only ever fractures a gatekeeper on marker mismatch when the named route matches NO
  // real outgoing edge — so `bogusRoute` never resolves here. Confirmed defensively rather than
  // assumed, since the whole point is to never guess a replacement condition.
  const matchesRealEdge = graph.edges.some(
    (edge: SkillGraphEdge) => edge.id === bogusRoute && edge.from === node.id,
  );
  if (matchesRealEdge) return undefined; // not the mismatch shape this rule covers

  const outgoing = graph.edges.filter((edge) => edge.from === node.id);
  const expected =
    outgoing.length > 0
      ? outgoing
          .map((edge) => (edge.condition ? `${edge.id} (${edge.condition})` : edge.id))
          .join(", ")
      : "(none)";

  return {
    id: suggestionId("marker-route-mismatch", verdict),
    verdictRef: { nodeId: node.id, edgeId: bogusRoute, status: verdict.status },
    rule: "marker-route-mismatch",
    rationale:
      `A breadcrumb named route "${bogusRoute}" at gatekeeper "${node.label}" (${node.id}), which ` +
      `matches none of its real outgoing edges (expected one of: ${expected}). The condition text ` +
      `may be stale, but SkillFlow can't infer the correct replacement deterministically — review ` +
      `the routing prose manually.`,
    ops: [],
  };
}

// =================================================================================================
// Skill IDE WP 4.2 — STATIC (trace-less) optimization suggestions
// =================================================================================================
//
// `buildStaticSuggestions` is a PURE function of a version's projected graph, its flat file tree, its
// raw `SKILL.md` text, its parsed manifest, and its L1/L2 token footprint (with the quality-engine
// ceilings). No model calls, no network, no clock, no filesystem — the same input always yields a
// deep-equal list. It never executes skill content and never APPLIES an op; it only EMITS + shape-
// validates `SkillEditOp[]` batches (`validateEditOps`), sharing that fix-op vocabulary with the
// quality engine and the trace suggestion engine (the "unified shape").
//
// It surfaces WITHOUT a run/alignment (the static route: `GET …/suggestions` with no `runId`), so its
// rules are keyed off the graph/tree/footprint rather than trace verdicts. Its rule vocabulary is the
// SEPARATE `SKILLFLOW_STATIC_SUGGESTION_RULES`, and each suggestion carries an optional `target`
// (section node / file path) instead of a trace `verdictRef`.
//
// | rule | trigger | ops |
// | --- | --- | --- |
// | `split-oversized-body` | L2 body over the quality ceiling | move the largest section's body to `reference/<slug>.md` — `add_file` + `update_section_body` (real ops, WP 3.1); advisory when no movable section body exists |
// | `dedupe-keywords` | frontmatter `keywords:` has case-insensitive duplicates | `set_keywords` with the deduped list (first-seen casing kept) |
// | `remove-unused-asset` | a bundled file referenced by no section / gate script | `[]` (advisory — removing a file is an authoring call) |
// | `tighten-description` | L1 metadata over the quality ceiling | `[]` (advisory — no single deterministic rewrite to draft) |
//
// No-corruption guarantee (same as the trace engine's `finalizeOps`): a rule whose drafted ops fail
// `validateEditOps` against the SAME graph/files is DOWNGRADED to advisory (`ops: []`, the errors
// folded into the rationale) rather than ever handed back as "safe to apply".

/** Everything the static optimizer runs over — the same inputs the quality engine already loads. */
export type StaticSuggestionInput = {
  /** The version's raw `SKILL.md` text (drives section-body reads + raw-keyword parsing). */
  skillMd: string;
  /** The parsed (best-effort) manifest — drives `tighten-description`'s rationale. */
  manifest: SkillManifest;
  /** The projected graph (`projectSkillGraph`, v3). */
  graph: SkillGraph;
  /** The version's flat file list (from the skills repository) — for slug collisions + unused-asset. */
  files: SkillFileNode[];
  /** L1/L2 token subtotals (`countLevels`) — only these two are read. */
  footprint: { l1: number; l2: number };
  /** L1 metadata token ceiling (env `SKILL_QUALITY_L1_TOKEN_CEILING`, default 500). */
  l1Ceiling: number;
  /** L2 body token ceiling (env `SKILL_QUALITY_L2_TOKEN_CEILING`, default 5000). */
  l2Ceiling: number;
};

/**
 * Run the static optimizer over one skill version. Deterministic + pure — see the section header.
 * Rules run in a fixed order; within each rule, nodes/files are visited in their given (already
 * deterministic) order, so the suggestion list is stable for a given input.
 */
export function buildStaticSuggestions(input: StaticSuggestionInput): SkillStaticSuggestion[] {
  const suggestions: SkillStaticSuggestion[] = [];
  pushIfDefinedStatic(suggestions, splitOversizedBodySuggestion(input));
  pushIfDefinedStatic(suggestions, dedupeKeywordsSuggestion(input));
  suggestions.push(...removeUnusedAssetSuggestions(input));
  pushIfDefinedStatic(suggestions, tightenDescriptionSuggestion(input));
  return suggestions;
}

function pushIfDefinedStatic(
  list: SkillStaticSuggestion[],
  suggestion: SkillStaticSuggestion | undefined,
): void {
  if (suggestion) list.push(suggestion);
}

/**
 * Validate a candidate static op batch against the graph + file list BEFORE handing it back (the
 * no-corruption guarantee): a non-empty batch that fails `validateEditOps` is downgraded to
 * advisory-only, the validation errors folded into the rationale so the failure is never silent.
 * (Passing `files` lets the `add_file` collision check run — the trace engine's `finalizeOps` has no
 * file ops so it never needs them.)
 */
function finalizeStaticOps(
  graph: SkillGraph,
  files: SkillFileNode[],
  ops: SkillEditOp[],
  rationale: string,
): { ops: SkillEditOp[]; rationale: string } {
  if (ops.length === 0) return { ops, rationale };
  const errors = validateEditOps(graph, ops, files);
  if (errors.length === 0) return { ops, rationale };
  return {
    ops: [],
    rationale: `${rationale} (Downgraded to advisory-only: the drafted ops failed validation against the current graph — ${errors.join(" ")})`,
  };
}

// --- Rule: split-oversized-body ------------------------------------------------------------------

function splitOversizedBodySuggestion(
  input: StaticSuggestionInput,
): SkillStaticSuggestion | undefined {
  const { skillMd, graph, files, footprint, l2Ceiling } = input;
  if (footprint.l2 <= l2Ceiling) return undefined; // body within budget — nothing to split

  // Pick the section with the LARGEST direct body (excluding child subsections, exactly what
  // `update_section_body` would replace) — the single biggest L2 reduction this op pair can make.
  // Deterministic: first occurrence in graph order wins a tie.
  let best: { node: SkillGraphNode; body: string } | undefined;
  for (const node of graph.nodes) {
    if (!isSectionNode(node)) continue;
    const body = readSectionBody(skillMd, graph, node.id);
    if (body === undefined || body.trim() === "") continue;
    if (!best || body.length > best.body.length) best = { node, body };
  }

  const overBy = footprint.l2 - l2Ceiling;
  if (!best) {
    // L2 is over budget but every section body is empty (all content lives in headings/subsections) —
    // nothing safe to auto-move, so surface the finding as advisory.
    return {
      id: "split-oversized-body:none",
      rule: "split-oversized-body",
      rationale:
        `The SKILL.md body is ${footprint.l2} tokens, ${overBy} over the ${l2Ceiling}-token ceiling ` +
        `(paid in full on every trigger), but no single section has a movable body to split out — ` +
        `restructure it into on-demand reference/ files manually.`,
      ops: [],
    };
  }

  const slug = slugifyLabel(best.node.label);
  const refPath = uniqueReferencePath(slug, files);
  const fileContent = `# ${best.node.label}\n\n${best.body}\n`;
  const pointer =
    `The full details for this step live in \`${refPath}\` — moved out of SKILL.md to keep the ` +
    `always-loaded body lean (it loads on demand instead of on every trigger).`;
  const ops: SkillEditOp[] = [
    { op: "add_file", path: refPath, content: fileContent },
    { op: "update_section_body", nodeId: best.node.id, body: pointer },
  ];
  const rationale =
    `The SKILL.md body is ${footprint.l2} tokens, ${overBy} over the ${l2Ceiling}-token ceiling — the ` +
    `whole body is paid on every trigger. "${best.node.label}" is its largest section; move its body ` +
    `to \`${refPath}\` (a reference file loaded only on demand) and leave a pointer behind.`;

  const { ops: finalOps, rationale: finalRationale } = finalizeStaticOps(
    graph,
    files,
    ops,
    rationale,
  );
  return {
    id: `split-oversized-body:${best.node.id}`,
    rule: "split-oversized-body",
    rationale: finalRationale,
    ops: finalOps,
    target: { nodeId: best.node.id, path: refPath },
  };
}

// --- Rule: dedupe-keywords -----------------------------------------------------------------------

function dedupeKeywordsSuggestion(input: StaticSuggestionInput): SkillStaticSuggestion | undefined {
  const { skillMd, graph } = input;
  const raw = rawFrontmatterKeywords(skillMd);
  if (!raw || raw.length === 0) return undefined; // no keyword trigger surface to dedupe

  // Case-insensitive dedupe, keeping the FIRST-seen original casing (the author's chosen form).
  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const keyword of raw) {
    const key = keyword.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(keyword);
  }
  const removed = raw.length - deduped.length;
  if (removed === 0) return undefined; // already unique — no rule applies

  const ops: SkillEditOp[] = [{ op: "set_keywords", keywords: deduped }];
  const rationale =
    `Frontmatter \`keywords:\` lists ${raw.length} entries but only ${deduped.length} are unique ` +
    `(case-insensitively) — ${removed} duplicate${removed === 1 ? " is" : "s are"} paid in L1 metadata ` +
    `on every conversation for no extra trigger coverage. Replace the set with the deduped list.`;

  const { ops: finalOps, rationale: finalRationale } = finalizeStaticOps(
    graph,
    input.files,
    ops,
    rationale,
  );
  return {
    id: "dedupe-keywords:keywords",
    rule: "dedupe-keywords",
    rationale: finalRationale,
    ops: finalOps,
  };
}

// --- Rule: remove-unused-asset (advisory) --------------------------------------------------------

function removeUnusedAssetSuggestions(input: StaticSuggestionInput): SkillStaticSuggestion[] {
  const referenced = referencedFilePaths(input.graph);
  const out: SkillStaticSuggestion[] = [];
  for (const file of input.files) {
    if (file.isSkillMd) continue; // SKILL.md is the body, not a referenceable asset
    if (referenced.has(file.path)) continue;
    out.push({
      id: `remove-unused-asset:${file.path}`,
      rule: "remove-unused-asset",
      rationale:
        `File "${file.path}" is bundled but referenced by no section or gate script — it costs ` +
        `registry bytes and reader attention for nothing. Remove it, or reference it so it's actually ` +
        `load-bearing. (Advisory: deleting a bundled file is an authoring judgment call.)`,
      ops: [],
      target: { path: file.path },
    });
  }
  return out;
}

// --- Rule: tighten-description (advisory) --------------------------------------------------------

function tightenDescriptionSuggestion(
  input: StaticSuggestionInput,
): SkillStaticSuggestion | undefined {
  const { manifest, footprint, l1Ceiling } = input;
  if (footprint.l1 <= l1Ceiling) return undefined; // metadata within budget

  const overBy = footprint.l1 - l1Ceiling;
  const descLen = manifest.description.trim().length;
  return {
    id: "tighten-description:description",
    rule: "tighten-description",
    rationale:
      `L1 metadata (name + description) is ${footprint.l1} tokens, ${overBy} over the ${l1Ceiling}-token ` +
      `ceiling — L1 is paid in every conversation the catalog loads into. The description ` +
      `(${descLen} characters) dominates it; tighten it to a specific "use when …" sentence and move ` +
      `detail into the body. (Advisory: there is no single deterministic rewrite to draft.)`,
    ops: [],
  };
}

// --- Static-rule helpers -------------------------------------------------------------------------

/** Every file path the graph points at: asset nodes' `path` + validation-gate nodes' `script`. */
function referencedFilePaths(graph: SkillGraph): Set<string> {
  const paths = new Set<string>();
  for (const node of graph.nodes) {
    if (node.kind === "asset") paths.add(node.path);
    else if (node.kind === "validation_gate") paths.add(node.script);
  }
  return paths;
}

/** Slugify a section label into a filesystem-safe basename (mirrors the projector's `slugify`). */
function slugifyLabel(value: string): string {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "section"
  );
}

/**
 * Build a `reference/<slug>.md` path that does NOT collide with any existing file (deterministic
 * `-2`, `-3`, … suffixing), so the drafted `add_file` op always validates.
 */
function uniqueReferencePath(slug: string, files: SkillFileNode[]): string {
  const existing = new Set(files.map((file) => file.path));
  let candidate = `reference/${slug}.md`;
  let n = 2;
  while (existing.has(candidate)) {
    candidate = `reference/${slug}-${n}.md`;
    n += 1;
  }
  return candidate;
}

/**
 * Parse the RAW frontmatter `keywords:` list (trimmed, empties dropped) in document order WITHOUT
 * deduping — so `dedupe-keywords` can see the literal duplicates the projector collapses for the
 * graph. Uses the same `yaml` parser as `manifest.ts`/`projector.ts`; never throws. Returns
 * `undefined` when there is no frontmatter / no `keywords:` key.
 */
function rawFrontmatterKeywords(skillMd: string): string[] | undefined {
  const normalized = skillMd.replace(/\r\n/g, "\n").replace(/^﻿/, "");
  const match = normalized.match(/^---[ \t]*\n([\s\S]*?)\n---[ \t]*(?:\n[\s\S]*)?$/);
  if (!match) return undefined;
  let parsed: unknown;
  try {
    parsed = parseYaml(match[1] ?? "");
  } catch {
    return undefined;
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
  const rawKeywords = (parsed as Record<string, unknown>).keywords;
  if (rawKeywords === undefined) return undefined;
  const collected: unknown[] =
    typeof rawKeywords === "string" ? [rawKeywords] : Array.isArray(rawKeywords) ? rawKeywords : [];
  const keywords: string[] = [];
  for (const entry of collected) {
    if (typeof entry !== "string") continue;
    const value = entry.trim();
    if (value !== "") keywords.push(value);
  }
  return keywords;
}
