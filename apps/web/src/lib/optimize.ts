// Rule-based optimization suggestions for a tool's startup footprint, with estimated token
// savings, plus a server-level rollup ("shape & health"). Savings are heuristic estimates meant
// to prioritize where to cut, not exact guarantees.

import type { ScanDetail, ToolScan } from "@mcp-token-footprint/shared";
import { parseParams, type ToolParam } from "./schema-params";

export type Suggestion = {
  id: string;
  label: string;
  savings: number;
  severity: "warn" | "info";
};

export function optimizeTool(tool: ToolScan, params: ToolParam[]): Suggestion[] {
  const out: Suggestion[] = [];

  if (!tool.description) {
    out.push({
      id: "no-desc",
      label: "Add a tool description so the model knows when to use it.",
      savings: 0,
      severity: "warn",
    });
  } else if (tool.descriptionTokens > 80) {
    out.push({
      id: "long-desc",
      label: "Shorten the tool description.",
      savings: Math.max(0, tool.descriptionTokens - 60),
      severity: "warn",
    });
  }

  for (const p of params) {
    if (p.flags.includes("large-enum") && p.enumValues) {
      const over = p.enumValues.length - 6;
      if (over > 0) {
        out.push({
          id: `enum-${p.name}`,
          label: `Shrink the \`${p.name}\` enum — ${p.enumValues.length} values listed inline.`,
          savings: Math.max(1, Math.round((p.tokens * over) / p.enumValues.length)),
          severity: "warn",
        });
      }
    }
    if (p.flags.includes("verbose")) {
      out.push({
        id: `verbose-${p.name}`,
        label: `Trim the \`${p.name}\` property description.`,
        savings: Math.max(1, Math.round(p.tokens * 0.4)),
        severity: "warn",
      });
    }
  }

  if (!tool.inputSchema) {
    out.push({
      id: "no-schema",
      label: "No input schema — document the tool's parameters.",
      savings: 0,
      severity: "info",
    });
  }
  if (tool.totalTokens > 1000) {
    out.push({
      id: "huge",
      label: "Tool exceeds 1000 tokens — consider splitting it.",
      savings: 0,
      severity: "info",
    });
  }

  return out.sort((a, b) => b.savings - a.savings);
}

export function recoverableTokens(tool: ToolScan): number {
  return optimizeTool(tool, parseParams(tool.inputSchema, tool.schemaTokens)).reduce(
    (a, s) => a + s.savings,
    0,
  );
}

/**
 * Estimated recoverable tokens attributable to a specific compatibility TEST on a tool — so the
 * token-saving estimate (the one genuinely useful bit of the old "Optimization" view) rides along on
 * the relevant test finding instead of living in a parallel system. 0 when a test has no size lever.
 */
export function toolTestSavings(testId: string, tool: ToolScan): number {
  const suggestions = optimizeTool(tool, parseParams(tool.inputSchema, tool.schemaTokens));
  const sum = (pred: (id: string) => boolean) =>
    suggestions.filter((s) => pred(s.id)).reduce((a, s) => a + s.savings, 0);
  switch (testId) {
    case "TOOL_DESCRIPTION_TOKEN_BUDGET":
    case "TOOL_DESCRIPTION_LENGTH":
      return sum((id) => id === "long-desc");
    case "TOOL_SCHEMA_ENUM_SIZE":
      return sum((id) => id.startsWith("enum-"));
    case "TOOL_DEFINITION_TOKENS":
      return sum(() => true); // the whole recoverable budget for an oversized definition
    default:
      return 0;
  }
}

export type Recommendation = {
  id: string;
  /** Imperative action — "what to do". */
  what: string;
  /** Evidence with numbers — "why". */
  why: string;
  /** The tool this targets, if any (drives the "Inspect" CTA). */
  toolName?: string;
  severity: "warn" | "info";
  /** Token impact used for ranking (not shown). */
  impact: number;
};

/**
 * Server-level, ranked, actionable findings for the Overview hero. Each is what + why with a
 * tool to inspect, so insight maps to action. Ranked by token impact, capped.
 */
export function serverRecommendations(scan: ScanDetail | null, limit = 8): Recommendation[] {
  if (!scan || scan.tools.length === 0) return [];
  const total = scan.tools.reduce((a, t) => a + t.totalTokens, 0) || 1;
  const recs: Recommendation[] = [];

  for (const t of scan.tools) {
    const share = Math.round((t.totalTokens / total) * 100);
    const schemaShare = t.totalTokens > 0 ? Math.round((t.schemaTokens / t.totalTokens) * 100) : 0;

    if (!t.description) {
      recs.push({
        id: `desc-${t.id}`,
        what: `Add a description to ${t.toolName}`,
        why: "No description — the model can't tell when to use this tool.",
        toolName: t.toolName,
        severity: "warn",
        impact: t.totalTokens,
      });
    }
    if (t.schemaTokens > 800 || (schemaShare >= 70 && t.schemaTokens > 300)) {
      recs.push({
        id: `schema-${t.id}`,
        what: `Review the schema for ${t.toolName}`,
        why: `Schema is ${schemaShare}% of this tool's ${Math.round(t.totalTokens)} tokens.`,
        toolName: t.toolName,
        severity: "warn",
        impact: t.schemaTokens,
      });
    }
    if (t.totalTokens > 1000) {
      recs.push({
        id: `huge-${t.id}`,
        what: `Split or trim ${t.toolName}`,
        why: `${Math.round(t.totalTokens)} tokens (${share}% of the footprint) load every request.`,
        toolName: t.toolName,
        severity: "info",
        impact: t.totalTokens,
      });
    }
    const params = parseParams(t.inputSchema, t.schemaTokens);
    const bigEnum = params.find((p) => p.flags.includes("large-enum") && p.enumValues);
    if (bigEnum?.enumValues) {
      recs.push({
        id: `enum-${t.id}`,
        what: `Shrink the ${bigEnum.name} enum on ${t.toolName}`,
        why: `${bigEnum.enumValues.length} enum values are listed inline in the schema.`,
        toolName: t.toolName,
        severity: "warn",
        impact: bigEnum.tokens,
      });
    }
  }

  return recs.sort((a, b) => b.impact - a.impact).slice(0, limit);
}

/** A kind of finding, used to group the per-tool findings on the Overview. */
export type FindingKind = "oversized-schema" | "huge-tool" | "thin-description" | "large-enum";

export type GroupedFindingTool = {
  /** ToolScan id — drives the inspect handler. */
  id: string;
  toolName: string;
  /** Why this tool is in the group (numbers). */
  detail: string;
  /** Recoverable tokens attributable to this kind on this tool (0 when not estimable). */
  recoverable: number;
};

export type FindingGroup = {
  kind: FindingKind;
  /** Human label, e.g. "Oversized schemas". */
  label: string;
  /** Short hint shown under the label. */
  hint: string;
  severity: "warn" | "info";
  /** Number of offending tools. */
  count: number;
  /** Σ recoverable tokens across the group (estimate; 0 when not estimable). */
  recoverable: number;
  /** The offending tools, ranked by their own recoverable then token weight. */
  tools: GroupedFindingTool[];
};

const GROUP_META: Record<FindingKind, { label: string; hint: string; severity: "warn" | "info" }> =
  {
    "oversized-schema": {
      label: "Oversized schemas",
      hint: "Schema dominates the tool's token cost.",
      severity: "warn",
    },
    "huge-tool": {
      label: ">1000-token tools",
      hint: "Large definitions loaded every request.",
      severity: "info",
    },
    "thin-description": {
      label: "Thin / missing descriptions",
      hint: "The model can't tell when to use the tool.",
      severity: "warn",
    },
    "large-enum": {
      label: "Large enums",
      hint: "Many enum values listed inline in the schema.",
      severity: "warn",
    },
  };

const GROUP_ORDER: FindingKind[] = [
  "oversized-schema",
  "huge-tool",
  "thin-description",
  "large-enum",
];

/**
 * Bucket a scan's per-tool findings by KIND (oversized schemas, >1000-token tools, thin/missing
 * descriptions, large enums) with a count + Σ recoverable per group, each carrying the offending
 * tools for drill-down. Groups are returned ordered by Σ recoverable (most-recoverable first), so
 * the Overview can lead with the highest-value work. Additive: does not change existing helpers.
 */
export function groupFindings(scan: ScanDetail | null): FindingGroup[] {
  if (!scan || scan.tools.length === 0) return [];
  const total = scan.tools.reduce((a, t) => a + t.totalTokens, 0) || 1;
  const buckets = new Map<FindingKind, GroupedFindingTool[]>();
  const push = (kind: FindingKind, tool: GroupedFindingTool) => {
    const list = buckets.get(kind) ?? [];
    list.push(tool);
    buckets.set(kind, list);
  };

  for (const t of scan.tools) {
    const params = parseParams(t.inputSchema, t.schemaTokens);
    const suggestions = optimizeTool(t, params);
    const savingsFor = (predicate: (id: string) => boolean) =>
      suggestions.filter((s) => predicate(s.id)).reduce((a, s) => a + s.savings, 0);

    const schemaShare = t.totalTokens > 0 ? Math.round((t.schemaTokens / t.totalTokens) * 100) : 0;
    const share = Math.round((t.totalTokens / total) * 100);

    if (t.schemaTokens > 800 || (schemaShare >= 70 && t.schemaTokens > 300)) {
      push("oversized-schema", {
        id: t.id,
        toolName: t.toolName,
        detail: `Schema is ${schemaShare}% of ${formatTok(t.totalTokens)} tokens.`,
        recoverable: savingsFor((id) => id.startsWith("enum-") || id.startsWith("verbose-")),
      });
    }
    if (t.totalTokens > 1000) {
      push("huge-tool", {
        id: t.id,
        toolName: t.toolName,
        detail: `${formatTok(t.totalTokens)} tokens · ${share}% of the footprint.`,
        recoverable: 0,
      });
    }
    if (!t.description) {
      push("thin-description", {
        id: t.id,
        toolName: t.toolName,
        detail: "No description provided.",
        recoverable: savingsFor((id) => id === "no-desc"),
      });
    } else if (t.descriptionTokens > 80) {
      push("thin-description", {
        id: t.id,
        toolName: t.toolName,
        detail: `Description is ${formatTok(t.descriptionTokens)} tokens — consider trimming.`,
        recoverable: savingsFor((id) => id === "long-desc"),
      });
    }
    const bigEnum = params.find((p) => p.flags.includes("large-enum") && p.enumValues);
    if (bigEnum?.enumValues) {
      push("large-enum", {
        id: t.id,
        toolName: t.toolName,
        detail: `${bigEnum.enumValues.length} values on \`${bigEnum.name}\`.`,
        recoverable: savingsFor((id) => id === `enum-${bigEnum.name}`),
      });
    }
  }

  const groups: FindingGroup[] = [];
  for (const kind of GROUP_ORDER) {
    const tools = buckets.get(kind);
    if (!tools || tools.length === 0) continue;
    tools.sort((a, b) => b.recoverable - a.recoverable || a.toolName.localeCompare(b.toolName));
    const meta = GROUP_META[kind];
    groups.push({
      kind,
      label: meta.label,
      hint: meta.hint,
      severity: meta.severity,
      count: tools.length,
      recoverable: tools.reduce((a, t) => a + t.recoverable, 0),
      tools,
    });
  }
  // Lead with the group that recovers the most; ties fall back to the most tools.
  return groups.sort((a, b) => b.recoverable - a.recoverable || b.count - a.count);
}

function formatTok(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

export type ServerHealth = {
  totalTokens: number;
  totalTools: number;
  avg: number;
  median: number;
  topShare: number;
  composition: { name: number; description: number; schema: number; annotations: number };
  recoverable: number;
  recoverablePercent: number;
  missingDescription: string[];
  oversizedSchema: string[];
  hugeTools: string[];
  largeEnumTools: string[];
};

function sum(
  tools: ToolScan[],
  key: keyof Pick<
    ToolScan,
    "nameTokens" | "descriptionTokens" | "schemaTokens" | "annotationsTokens"
  >,
) {
  return tools.reduce((a, t) => a + t[key], 0);
}

export function serverHealth(scan: ScanDetail | null): ServerHealth | null {
  if (!scan || scan.tools.length === 0) return null;
  const tools = scan.tools;
  const totalTokens = tools.reduce((a, t) => a + t.totalTokens, 0);
  const sortedDesc = [...tools].sort((a, b) => b.totalTokens - a.totalTokens);
  const top3 = sortedDesc.slice(0, 3).reduce((a, t) => a + t.totalTokens, 0);
  const sortedAsc = tools.map((t) => t.totalTokens).sort((a, b) => a - b);
  const median = sortedAsc[Math.floor((sortedAsc.length - 1) / 2)] ?? 0;

  let recoverable = 0;
  const missingDescription: string[] = [];
  const oversizedSchema: string[] = [];
  const hugeTools: string[] = [];
  const largeEnumTools: string[] = [];

  for (const t of tools) {
    const params = parseParams(t.inputSchema, t.schemaTokens);
    recoverable += optimizeTool(t, params).reduce((a, s) => a + s.savings, 0);
    if (!t.description) missingDescription.push(t.toolName);
    if (t.schemaTokens > 800) oversizedSchema.push(t.toolName);
    if (t.totalTokens > 1000) hugeTools.push(t.toolName);
    if (params.some((p) => p.flags.includes("large-enum"))) largeEnumTools.push(t.toolName);
  }

  return {
    totalTokens,
    totalTools: tools.length,
    avg: totalTokens / tools.length,
    median,
    topShare: totalTokens > 0 ? (top3 / totalTokens) * 100 : 0,
    composition: {
      name: sum(tools, "nameTokens"),
      description: sum(tools, "descriptionTokens"),
      schema: sum(tools, "schemaTokens"),
      annotations: sum(tools, "annotationsTokens"),
    },
    recoverable,
    recoverablePercent: totalTokens > 0 ? (recoverable / totalTokens) * 100 : 0,
    missingDescription,
    oversizedSchema,
    hugeTools,
    largeEnumTools,
  };
}
