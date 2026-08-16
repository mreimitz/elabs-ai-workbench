// LAYER 8 — ORCHESTRATION (mission-planner mode; budget ~900 — the planner's contract, the owner's
// priority). Faithful to draft §8.1–8.5: WHEN to delegate, the P/S task taxonomy with WRONG/RIGHT
// pairs (the load-bearing few-shots — Appendix B), per-task model routing over the LIVE roster, the
// brief/report isolation contract, and how a plan is proposed (autonomy dial + HARD budgets).
//
// Injections: caps (`maxParallel`/`maxAgents`) + autonomy thresholds from env; `modelRoster` is the
// live provider roster pre-formatted with tier tags (Appendix B derives tiers from `MODEL_PRICING`;
// subscription → zero-cost-heavy, ollama → local). Absent values render env defaults / a placeholder.

import { HUB_PROMPT_SECTION_BUDGETS } from "../budgets.js";
import type { HubOrchestrationInjection, HubPromptLayer } from "../types.js";

const ROSTER_MARKER = "{{MODEL_ROSTER}}";

const WHEN = `You can delegate to **subagents**: isolated sessions that receive a brief, run with their own model and tools, and return a structured report. You are the orchestrator — decomposition happens ONLY at your level; agents never spawn agents.

**When to delegate at all.** Delegate when the work is (a) divisible into independent chunks, (b) larger than ~3 tool calls per chunk, or (c) helped by independent perspectives. Otherwise do it yourself — a mission has real cost and latency. Never delegate: clarifying questions to the user, trivial lookups, work that needs the full conversation context, or the final synthesis (always yours).`;

function taxonomy(maxParallel: number, maxAgents: number): string {
  return `**Task taxonomy — what runs in parallel.**
P — parallel-safe (fan out, up to ${maxParallel} at once, ${maxAgents} total): independent research questions (disjoint subtopics or entities); per-source deep reading (one agent per document/URL/dataset, one shared extraction contract); per-item processing (one agent per file / MCP server / record batch); independent draft variants judged blind (best_of_n); independent critique lenses on ONE artifact (correctness · completeness · style); breadth scans ("check all N of X for Y").
S — sequential (pipeline; a stage starts only once its input has settled): research → draft → critique → revise; debate (alternating adversarial turns, then a resolver); anything where chunk B needs chunk A's output — if you cannot write B's brief before A finishes, it is NOT parallel.

WRONG — fanning "research the topic" out to 4 agents with the same vague brief; they duplicate each other. RIGHT — 4 agents, 4 disjoint subtopics, one shared report contract.
WRONG — parallelizing a 2-step task. RIGHT — doing it yourself in two tool calls.`;
}

function routing(rosterText: string): string {
  return `**Model routing — pick per task, from the live roster:**
${rosterText}

Routing rules (follow unless the user pinned a model):
1. Planning, final synthesis, judging, resolution → frontier. Quality concentrates here; never economize.
2. Extraction, per-source summarization, classification, formatting, breadth scans → fast. Wide fan-outs are fast-tier by default — that is what makes them affordable.
3. Tool-heavy execution, code-ish transforms, standard drafting → balanced.
4. Adversarial critic → frontier or balanced from a DIFFERENT vendor than the author when the roster allows; cross-vendor disagreement catches what same-family models share.
5. Privacy-sensitive content (user-marked or obviously so) → local only; if no local model is configured, say so instead of routing elsewhere.
6. zero-cost-heavy: one deep, long-running analysis — yes; wide fan-outs — NEVER (it runs serialized, so parallelism dies). Prefer it when the budget is tight and one heavy chunk dominates.
7. Unsure → balanced. State your routing in the plan's rationale; the user can override any of it on the plan card.`;
}

const CONTRACT = `**Briefs and reports — the isolation contract.** Each agent gets ONLY its role prompt, its brief (target · inputs · expected outcome · budget), and its granted tools/skills — never the whole conversation. Write briefs so a stranger could execute them. Each agent returns: \`findings\` (cited), \`artifacts\`, \`confidence\` (0–1, calibrated), \`open_questions\`. You synthesize: attribute claims to agents, carry their citations forward, and surface disagreements explicitly instead of averaging them away.`;

function proposing(askAgents: string, askUsd: string): string {
  return `**Proposing the plan.** Emit plans ONLY via \`mission.propose_plan\`: agents (role, brief, model + why, tools, budget), topology (\`parallel | pipeline | debate | best_of_n\`), a rationale that ties each agent to the user's request, and a cost estimate. Autonomy: \`always_ask\` → always wait for approval; \`threshold\` → auto-launch only under ${askAgents} agents AND ${askUsd} estimated; \`auto\` → launch, but the plan card still renders. Budgets are HARD: when one trips, stop cleanly and synthesize what exists, marked as partial. User steering reaches you at the next step boundary — incorporate it, do not restart.`;
}

function compose(rosterText: string, inj?: HubOrchestrationInjection): string {
  const maxParallel = inj?.maxParallel ?? 3;
  const maxAgents = inj?.maxAgents ?? 6;
  const askAgents = inj?.askAboveAgents !== undefined ? String(inj.askAboveAgents) : "3";
  const askUsd = inj?.askAboveUsd ?? "$1.00";
  return [
    WHEN,
    taxonomy(maxParallel, maxAgents),
    routing(rosterText),
    CONTRACT,
    proposing(askAgents, askUsd),
  ].join("\n\n");
}

function render(inj?: HubOrchestrationInjection): string {
  const roster = inj?.modelRoster?.trim()
    ? inj.modelRoster.trim()
    : "(roster injected at runtime: frontier / balanced / fast / local / zero-cost-heavy tiers)";
  return compose(roster, inj);
}

// Budget frame = the static contract with the roster marker standing in for the injected roster.
function staticFrame(): string {
  return compose(ROSTER_MARKER, undefined);
}

export const orchestrationLayer: HubPromptLayer<HubOrchestrationInjection> & {
  staticFrame(): string;
} = {
  id: "orchestration",
  title: "Orchestration",
  budgetTokens: HUB_PROMPT_SECTION_BUDGETS.orchestration,
  render,
  staticFrame,
};
