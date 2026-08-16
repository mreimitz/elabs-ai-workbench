// The next-steps engine (audit §H7 — "the workspace's output"). Rule-based suggestions computed over
// the resolved comparison, each wired to an existing surface pre-filled. This is the seed of the
// roadmap's Advisor: evidence already sits next to the decision. Pure + React-free so every rule is
// unit-tested without rendering the cards.
//
// Each rule fires only when the comparison actually supports it (a deferred run that truly used fewer
// tokens; a tool that truly failed; a skill that was truly loaded-but-unused), so the workspace never
// invents advice. There is no guaranteed floor card — a clean comparison with nothing actionable to
// flag simply renders zero next steps. The comparison EXPORT is no longer one of these rules: the
// compare bar's `Export` split button (compare-redesign §3.1/S2) is the one canonical export action,
// so this engine never duplicates it (see `CompareBar.tsx`'s `ExportMenu`).

import type { RunSkill, RunStep, ToolLoadingMode } from "@mcp-token-footprint/shared";
import type { CompareData, WorkspaceRun } from "../compare-runs";
import type { SummaryRun } from "../summary-derive";

export type NextStepTone = "recommend" | "info" | "caution";

/** A card's action: an in-app deep link (pre-filled). Export is no longer a next-step action — see
 *  the module doc comment (S2: the bar's `Export` split button is the one canonical export action). */
export type NextStepAction = { kind: "link"; to: string; label: string };

export type NextStep = {
  /** Stable id (also the rule key) — used as the React key + evidence anchor. */
  id: string;
  tone: NextStepTone;
  title: string;
  body: string;
  action: NextStepAction;
};

export type NextStepsInput = {
  /** The resolved workspace runs (letter/baseline/scenario id). */
  workspaceRuns: WorkspaceRun[];
  /** The summary metrics per run (tokens, outcome, tool errors), letter-aligned to `workspaceRuns`. */
  summaryRuns: SummaryRun[];
  data: CompareData;
  stepsById: Map<string, RunStep[]>;
  skillsById: Map<string, RunSkill[]>;
};

type Joined = {
  ws: WorkspaceRun;
  sum: SummaryRun;
  loading: ToolLoadingMode | null;
  steps: RunStep[];
  skills: RunSkill[];
};

function join(input: NextStepsInput): Joined[] {
  const sumById = new Map(input.summaryRuns.map((s) => [s.id, s]));
  return input.workspaceRuns
    .map((ws) => {
      const sum = sumById.get(ws.id);
      if (!sum) return null;
      return {
        ws,
        sum,
        loading: input.data.scenariosById.get(ws.run.scenarioId)?.toolLoadingMode ?? null,
        steps: input.stepsById.get(ws.id) ?? [],
        skills: input.skillsById.get(ws.id) ?? [],
      } satisfies Joined;
    })
    .filter((j): j is Joined => j != null);
}

export function deriveNextSteps(input: NextStepsInput): NextStep[] {
  const joined = join(input);
  if (joined.length < 2) return [];
  const steps: NextStep[] = [];

  const deferred = deferredLoadingWin(joined);
  if (deferred) steps.push(deferred);

  const failing = failingTool(joined);
  if (failing) steps.push(failing);

  const unused = unusedSkill(joined);
  if (unused) steps.push(unused);

  const abnormal = allAbnormal(joined);
  if (abnormal) steps.push(abnormal);

  return steps;
}

/** R1 — a deferred-loading run beat an eager one on tokens with a clean outcome → make it the default. */
function deferredLoadingWin(joined: Joined[]): NextStep | null {
  const eager = joined.filter((j) => j.loading === "eager");
  const deferred = joined.filter((j) => j.loading === "deferred");
  if (eager.length === 0 || deferred.length === 0) return null;

  // The cheapest deferred run vs the priciest eager run (the clearest saving to argue).
  const bestDeferred = deferred.reduce((a, b) => (a.sum.totalTokens <= b.sum.totalTokens ? a : b));
  const worstEager = eager.reduce((a, b) => (a.sum.totalTokens >= b.sum.totalTokens ? a : b));
  const savings = worstEager.sum.totalTokens - bestDeferred.sum.totalTokens;
  if (savings <= 0) return null;
  // Only recommend when the deferred run didn't pay for the saving with a worse outcome.
  if (bestDeferred.sum.abnormal && !worstEager.sum.abnormal) return null;

  const sameOutcome = bestDeferred.sum.outcome === worstEager.sum.outcome;
  return {
    id: "deferred-loading-win",
    tone: "recommend",
    title: `Deferred loading saved ${formatInt(savings)} tokens`,
    body: `${bestDeferred.ws.letter} (${bestDeferred.ws.scenarioName}, deferred tools) used ${formatInt(savings)} fewer tokens than ${worstEager.ws.letter} (${worstEager.ws.scenarioName}, eager)${sameOutcome ? " with the same outcome" : ""} — consider making deferred the default for the eager environment.`,
    action: { kind: "link", to: "/testing/environments", label: "Open environment editor" },
  };
}

/** R2 — a tool that errored (in one or more runs) → open the server's tools to test it. */
function failingTool(joined: Joined[]): NextStep | null {
  const byTool = new Map<string, { serverId: string | null; runs: Set<string> }>();
  for (const j of joined) {
    for (const step of j.steps) {
      const failed =
        (step.type === "tool_call" || step.type === "tool_result") && step.status === "error";
      if (!failed || !step.toolName) continue;
      const entry = byTool.get(step.toolName) ?? {
        serverId: step.serverId ?? null,
        runs: new Set(),
      };
      if (!entry.serverId && step.serverId) entry.serverId = step.serverId;
      entry.runs.add(j.ws.id);
      byTool.set(step.toolName, entry);
    }
  }
  if (byTool.size === 0) return null;

  // The tool that failed in the most runs (a consistent failure is the strongest signal).
  const [toolName, entry] = [...byTool.entries()].sort(
    (a, b) => b[1].runs.size - a[1].runs.size,
  )[0]!;
  const runCount = entry.runs.size;
  const to = entry.serverId ? `/servers/${entry.serverId}` : "/servers";
  return {
    id: "failing-tool",
    tone: "caution",
    title: `${toolName} failed ${runCount === joined.length ? "in every run" : `in ${runCount} of ${joined.length} runs`}`,
    body: `The tool ${toolName} returned an error during ${runCount === joined.length ? "both" : "these"} runs. Open it in the tool playground to reproduce the call and inspect the failure with the exact arguments.`,
    action: { kind: "link", to, label: "Test in playground" },
  };
}

/** R3 — a non-eager skill was loaded but never disclosed (0 reads) yet paid its always-on cost. */
function unusedSkill(joined: Joined[]): NextStep | null {
  type Cand = { skillId: string; name: string; alwaysOn: number };
  let best: Cand | null = null;
  for (const j of joined) {
    for (const skill of j.skills) {
      if (skill.eager) continue; // eager skills are inlined on purpose — 0 reads is expected
      if (skill.disclosureReads > 0) continue;
      const alwaysOn = skill.footprint?.l1MetadataTokens ?? 0;
      if (alwaysOn <= 0) continue;
      if (!best || alwaysOn > best.alwaysOn) {
        best = { skillId: skill.skillId, name: skill.name, alwaysOn };
      }
    }
  }
  if (!best) return null;
  return {
    id: "unused-skill",
    tone: "info",
    title: `${best.name} loaded but never used`,
    body: `The skill "${best.name}" was attached and cost ${formatInt(best.alwaysOn)} always-on tokens per run, but the model never opened it (0 disclosure reads). Review its triggers in the SkillFlow trace, or detach it.`,
    action: { kind: "link", to: `/skills/${best.skillId}`, label: "Open SkillFlow trace" },
  };
}

/** R5 — every run ended abnormally → the run config, not the setup, is the thing to fix. */
function allAbnormal(joined: Joined[]): NextStep | null {
  if (!joined.every((j) => j.sum.abnormal)) return null;
  return {
    id: "all-abnormal",
    tone: "caution",
    title: "Every run ended abnormally",
    body: `All ${joined.length} runs stopped abnormally (${joined.map((j) => `${j.ws.letter} ${j.sum.statusLabel.toLowerCase()}`).join(", ")}). Raise the guardrail or tighten the prompt before comparing efficiency — the deltas reflect where each run stopped.`,
    action: { kind: "link", to: "/testing/environments", label: "Open environment editor" },
  };
}

function formatInt(n: number): string {
  return new Intl.NumberFormat().format(Math.round(n));
}
