import { Link } from "react-router-dom";
import type { SkillDiff } from "@mcp-token-footprint/shared";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle } from "@elabs-ai/components-ui";
import { ArrowRight, FileDiff } from "lucide-react";
import { DeltaStrip } from "../skills/SkillDiffView";
import type { AssistantTimelineToolCall } from "./use-assistant-stream";

export type AssistantDiffCardProps = {
  skillId: string;
  /** The new version's label (e.g. "v3"), shown as a badge next to the title when present. */
  versionLabel?: string;
  diff: SkillDiff;
};

/** True for a `skills_commit_workspace` tool call, prefixed or bare. `tool_call`/`tool_result` events
 *  carry the SDK's fully-qualified `mcp__assistant-app__<name>` form (see `AssistantEvent`'s producer,
 *  `session-manager.ts`'s `pump()`, which — unlike `permission_request`/`permission_decision` — does
 *  NOT strip the prefix), so a name match has to tolerate either shape. */
function isCommitWorkspaceTool(toolName: string): boolean {
  return toolName === "skills_commit_workspace" || toolName.endsWith("__skills_commit_workspace");
}

/**
 * A tool_result's `result` value, off the wire, is the MCP `CallToolResult` content-block array our
 * tools return (`[{type:"text", text: "<json>"}]` — what a real SDK session reports), but is left
 * loosely typed (`unknown`) end to end (see `use-assistant-stream.ts`), so this parses either that
 * shape or an already-parsed plain object (e.g. a simplified test double) without ever throwing.
 */
function parseToolResultJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    const first = value[0] as { type?: string; text?: string } | undefined;
    if (first?.type === "text" && typeof first.text === "string") {
      try {
        return JSON.parse(first.text);
      } catch {
        return null;
      }
    }
    return null;
  }
  if (value && typeof value === "object") return value;
  return null;
}

/**
 * WP 2.2 — extract this card's props from a settled `skills_commit_workspace` tool call, or `null` for
 * anything that isn't a successful, diff-bearing commit (a different tool, a still-running call, an
 * error result, or the `unchanged: true` dedup path — none of those have a diff to show, so they keep
 * the default `AssistantToolCallCard` JSON view only).
 */
export function extractCommitWorkspaceDiff(
  call: AssistantTimelineToolCall,
): AssistantDiffCardProps | null {
  if (!isCommitWorkspaceTool(call.toolName) || !call.result || call.result.isError) return null;
  const parsed = parseToolResultJson(call.result.value);
  if (!parsed || typeof parsed !== "object") return null;
  const value = parsed as Record<string, unknown>;
  if (value.unchanged !== false) return null; // unchanged / malformed — nothing to diff
  const { skillId, diff } = value;
  if (typeof skillId !== "string" || !diff || typeof diff !== "object") return null;
  const versionLabel = typeof value.versionLabel === "string" ? value.versionLabel : undefined;
  return { skillId, versionLabel, diff: diff as SkillDiff };
}

/**
 * WP 2.2 (D-AS13) — a compact card rendered inline in the Assistant dock when a
 * `skills_commit_workspace` tool result carries a diff payload (the commit actually minted a new
 * version — not the `unchanged: true` dedup path, which has nothing to show). Composed from the
 * EXISTING skills-diff building block (`DeltaStrip`, exported by `SkillDiffView.tsx` — the SAME
 * rollup-tile layout the Skill Diff tab renders) plus plain `@elabs-ai/components-ui` primitives; no bespoke
 * visualization. Links to the skill's inspector (`/skills/:id`), which opens on the CURRENT version by
 * default — i.e. the version this card is reporting.
 */
export function AssistantDiffCard({ skillId, versionLabel, diff }: AssistantDiffCardProps) {
  return (
    <Card className="w-full">
      <CardHeader className="flex-row items-center justify-between gap-2 space-y-0">
        <CardTitle className="flex min-w-0 items-center gap-2">
          <FileDiff className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <span className="min-w-0 truncate">Skill updated</span>
          {versionLabel ? (
            <Badge variant="outline" className="shrink-0 font-normal">
              {versionLabel}
            </Badge>
          ) : null}
        </CardTitle>
        <Button asChild variant="ghost" size="sm" className="shrink-0 gap-1">
          <Link to={`/skills/${skillId}`}>
            <span>View skill</span>
            <ArrowRight className="size-3.5" aria-hidden />
          </Link>
        </Button>
      </CardHeader>
      <CardContent>
        <DeltaStrip diff={diff} />
      </CardContent>
    </Card>
  );
}
