// Builds a `ScanComparison` from two scans (same-server over time OR two different servers) at
// the tool level. Pure given its inputs — reads no DB; the route loads the scans and hands them
// here. All deltas are B − A (the contract in packages/shared).

import type {
  ComparedPrompt,
  ComparedResource,
  ComparedTool,
  PromptMatch,
  PromptScan,
  ResourceMatch,
  ResourceScan,
  ScanCompareRef,
  ScanComparison,
  ScanDetail,
  ToolMatch,
  ToolScan,
} from "@mcp-token-footprint/shared";
import { stableStringify } from "../utils/json.js";
import { matchTools } from "./matching.js";

/** Project the subset of a `ToolScan` the diff needs. */
function toComparedTool(tool: ToolScan): ComparedTool {
  return {
    toolName: tool.toolName,
    totalTokens: tool.totalTokens,
    nameTokens: tool.nameTokens,
    descriptionTokens: tool.descriptionTokens,
    schemaTokens: tool.schemaTokens,
    annotationsTokens: tool.annotationsTokens,
    contributionPercent: tool.contributionPercent,
  };
}

/** Project the subset of a `ResourceScan` the diff needs (the wire `ComparedResource`). */
function toComparedResource(resource: ResourceScan): ComparedResource {
  return {
    kind: resource.kind,
    uri: resource.uri,
    name: resource.name,
    mimeType: resource.mimeType,
    totalTokens: resource.totalTokens,
    contributionPercent: resource.contributionPercent,
  };
}

/** Project the subset of a `PromptScan` the diff needs (the wire `ComparedPrompt`). */
function toComparedPrompt(prompt: PromptScan): ComparedPrompt {
  return {
    promptName: prompt.promptName,
    totalTokens: prompt.totalTokens,
    contributionPercent: prompt.contributionPercent,
  };
}

/** Build the lightweight per-side reference from a scan's summary fields. */
function toCompareRef(scan: ScanDetail): ScanCompareRef {
  return {
    scanId: scan.id,
    serverId: scan.serverId,
    serverName: scan.serverName,
    tokenProfile: scan.tokenProfile,
    scannedAt: scan.scannedAt,
    totalTools: scan.totalTools,
    totalTokens: scan.totalTokens,
  };
}

/**
 * `deltaPercent` = `base > 0 ? (delta / base) * 100 : 0`. Guards the divide-by-zero case where
 * the A side has zero tokens (a brand-new tool, or an empty scan).
 */
function percentDelta(delta: number, base: number): number {
  return base > 0 ? (delta / base) * 100 : 0;
}

export function buildComparison(a: ScanDetail, b: ScanDetail, threshold: number): ScanComparison {
  // Token counts are only subtractable when both scans are on the same scale: same token profile AND
  // same counting version. Otherwise a "delta" would conflate tokenizer/method differences with real
  // surface change, so every token delta below is SUPPRESSED to 0 and flagged non-comparable. Server/
  // tool matching (which pairs by name/description, not counts) is unaffected.
  const sameProfile = a.tokenProfile === b.tokenProfile;
  const deltasComparable = sameProfile && a.countingVersion === b.countingVersion;
  /** Zero out a token delta when the two scans' counts are not on a comparable scale. */
  const delta = (value: number): number => (deltasComparable ? value : 0);

  // Carry both the ToolScan (for matching by name/description) and its projected ComparedTool,
  // plus the raw definition fields (inputSchema/annotations) each matched pair needs for its
  // definition delta. These matcher-only fields are stripped back off before returning.
  const aTools = a.tools.map((tool) => ({
    ...toComparedTool(tool),
    description: tool.description,
    inputSchema: tool.inputSchema,
    annotations: tool.annotations,
  }));
  const bTools = b.tools.map((tool) => ({
    ...toComparedTool(tool),
    description: tool.description,
    inputSchema: tool.inputSchema,
    annotations: tool.annotations,
  }));

  const { matched, onlyInA, onlyInB } = matchTools(aTools, bTools, threshold);

  // Strip the matcher-only fields (description/inputSchema/annotations) back off; the contract's
  // ComparedTool omits them, so none may leak onto the wire.
  const strip = ({
    description: _description,
    inputSchema: _inputSchema,
    annotations: _annotations,
    ...rest
  }: (typeof aTools)[number]): ComparedTool => rest;

  // Canonicalize before comparing: undefined collapses to "" so undefined↔undefined is unchanged
  // while undefined↔value is a change; everything else compares its stable JSON serialization.
  const canon = (v: unknown) => (v === undefined ? "" : stableStringify(v));

  const matchedOut: ToolMatch[] = matched.map((pair) => {
    const compA = strip(pair.a);
    const compB = strip(pair.b);
    const deltaTokens = compB.totalTokens - compA.totalTokens;
    const definitionDelta = {
      descriptionChanged: (pair.a.description ?? "").trim() !== (pair.b.description ?? "").trim(),
      schemaChanged: canon(pair.a.inputSchema) !== canon(pair.b.inputSchema),
      annotationsChanged: canon(pair.a.annotations) !== canon(pair.b.annotations),
    };
    return {
      a: compA,
      b: compB,
      basis: pair.basis,
      similarity: pair.similarity,
      deltaTokens: delta(deltaTokens),
      deltaPercent: delta(percentDelta(deltaTokens, compA.totalTokens)),
      definitionDelta,
    };
  });

  // --- Resources (incl. templates) ----------------------------------------------------------
  // Mirror the tool diff. A resource's URI is its identity, so it rides the matcher as `toolName`
  // (exact same uri matches across scans; cross-server falls to fuzzy over name+description). The
  // matcher-only `toolName`/`description` keys are stripped back off before returning the wire
  // ComparedResource.
  const toResourceMatchInput = (resource: ResourceScan) => ({
    ...toComparedResource(resource),
    toolName: resource.uri,
    description: [resource.name, resource.description].filter(Boolean).join(" "),
  });
  const aRes = a.resources.map(toResourceMatchInput);
  const bRes = b.resources.map(toResourceMatchInput);

  const resourceResult = matchTools(aRes, bRes, threshold);

  const stripResource = ({
    toolName: _toolName,
    description: _description,
    ...rest
  }: (typeof aRes)[number]): ComparedResource => rest;

  const resourceMatched: ResourceMatch[] = resourceResult.matched.map((pair) => {
    const compA = stripResource(pair.a);
    const compB = stripResource(pair.b);
    const deltaTokens = compB.totalTokens - compA.totalTokens;
    return {
      a: compA,
      b: compB,
      basis: pair.basis,
      similarity: pair.similarity,
      deltaTokens: delta(deltaTokens),
      deltaPercent: delta(percentDelta(deltaTokens, compA.totalTokens)),
    };
  });

  // --- Prompts -------------------------------------------------------------------------------
  // Same shape: a prompt's name is its identity (matcher `toolName`), its declared description
  // feeds the fuzzy signal. Strip the matcher-only keys back off before returning.
  const toPromptMatchInput = (prompt: PromptScan) => ({
    ...toComparedPrompt(prompt),
    toolName: prompt.promptName,
    description: prompt.description,
  });
  const aPrompts = a.prompts.map(toPromptMatchInput);
  const bPrompts = b.prompts.map(toPromptMatchInput);

  const promptResult = matchTools(aPrompts, bPrompts, threshold);

  const stripPrompt = ({
    toolName: _toolName,
    description: _description,
    ...rest
  }: (typeof aPrompts)[number]): ComparedPrompt => rest;

  const promptMatched: PromptMatch[] = promptResult.matched.map((pair) => {
    const compA = stripPrompt(pair.a);
    const compB = stripPrompt(pair.b);
    const deltaTokens = compB.totalTokens - compA.totalTokens;
    return {
      a: compA,
      b: compB,
      basis: pair.basis,
      similarity: pair.similarity,
      deltaTokens: delta(deltaTokens),
      deltaPercent: delta(percentDelta(deltaTokens, compA.totalTokens)),
    };
  });

  const totalsDeltaTokens = b.totalTokens - a.totalTokens;

  return {
    a: toCompareRef(a),
    b: toCompareRef(b),
    sameServer: a.serverId === b.serverId,
    sameProfile,
    deltasComparable,
    totalsDeltaTokens: delta(totalsDeltaTokens),
    totalsDeltaPercent: delta(percentDelta(totalsDeltaTokens, a.totalTokens)),
    threshold,
    matched: matchedOut,
    onlyInA: onlyInA.map(strip),
    onlyInB: onlyInB.map(strip),
    counts: {
      matched: matchedOut.length,
      onlyInA: onlyInA.length,
      onlyInB: onlyInB.length,
    },
    resourceMatched,
    resourceOnlyInA: resourceResult.onlyInA.map(stripResource),
    resourceOnlyInB: resourceResult.onlyInB.map(stripResource),
    resourceCounts: {
      matched: resourceMatched.length,
      onlyInA: resourceResult.onlyInA.length,
      onlyInB: resourceResult.onlyInB.length,
    },
    promptMatched,
    promptOnlyInA: promptResult.onlyInA.map(stripPrompt),
    promptOnlyInB: promptResult.onlyInB.map(stripPrompt),
    promptCounts: {
      matched: promptMatched.length,
      onlyInA: promptResult.onlyInA.length,
      onlyInB: promptResult.onlyInB.length,
    },
  };
}
