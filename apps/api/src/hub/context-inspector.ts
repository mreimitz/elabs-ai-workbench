// Assistant Hub (planning/Roadmap/RM-03-assistant-hub/, WP4.1, §1.8/§1.6, R-SES7) — the CONTEXT INSPECTOR: itemize a
// session's current context window by layer, using the app's OWN counters end to end (the dogfood
// discipline — no fabricated numbers, ever). Two complementary breakdowns:
//
//   1. `promptSections` — the §1.8 authored LAYER list (`hub/prompting`'s `HUB_PROMPT_SECTION_BUDGETS`
//      + `measureSections`), assembled with the session's REAL current injections (tool-list text,
//      the skills L1 catalog text, memory, project) so "tools"/"memory"/"project"/"genui" totals
//      include their actual injected bodies — not just the authored static frame `budgets.ts` bounds.
//
//   2. `tools`/`skills`/`memory`/`project`/`history` — RESOURCE-TYPE layers that don't reduce to prose:
//      the granted MCP tool definitions' protocol-level JSON-schema cost (eager-resident vs deferred,
//      `hub/tools/registry.ts`'s `resolveHubToolRegistry` — WP0.5's measured numbers, verbatim); each
//      attached skill's session-true L1/L2/L3 (`hub/skill-attachments.ts`'s `computeSessionSkillUsage`
//      — the SAME computation `GET .../skills` already exposes); the memory/project body measured on
//      its own (isolated from its section's static frame); the reconstructed conversation history.
//
// `memory`/`project`'s bodies are ALSO embedded inside `promptSections` (their real content IS the
// section, per `hub/prompting/budgets.ts`'s own doc) — `estimatedTotalTokens` therefore adds
// `promptSections` + `tools.residentTokens` + `skills.totalTokens` + `history.tokens` only: tool-
// definition JSON and skill L2/L3 bodies are NOT part of the system-prompt TEXT (they ride the
// request's other fields — the native `tools` array, or a `skills.load` tool RESULT already counted
// once it lands in `history`), so adding them is correct, not double-counting memory/project twice.
//
// This is a snapshot of what the NEXT turn would see (current memory/project/tool/skill state) — a
// PAST turn's exact assembled prompt is not persisted section-by-section (only its `promptVersion` +
// final `usage` are), so the caller (`hub/routes.ts`) also surfaces the last settled turn's REAL
// provider-reported `tokensIn` alongside this as an honest cross-check — this module never blends the
// two; `lastActualTokensIn` is read by the caller from the session's own event log, not computed here.
//
// v1 scope note: `tools`/`skills`' grant resolution is EXACT for a top-level `chat`/`research`/
// `mission` session — server-level MCP grants are, today, "every connected+scanned server" for every
// such session (`index.ts`'s `resolveHubMcpGrants`, mirrored by the caller's `mcpCatalogProvider`) —
// but only an APPROXIMATION for an `agent`-kind (mission member) session, whose real role-level grants
// (`hub_agents.tool_grants_json` via its mission's frozen plan) can differ. Flagged here + in the wire
// type's own doc; a later WP can thread the exact per-agent grant through if this proves confusing.

import type {
  HubContextInspector,
  HubContextToolItem,
  HubContextToolsLayer,
  HubToolGrants,
  NormalizedToolDefinition,
} from "@mcp-token-footprint/shared";
import { modelContextLimits } from "../data-pack/thresholds.js";
import type { TokenCounter } from "../token-counting/types.js";
import { buildSessionEffectiveMemory, type HubEffectiveMemory } from "./memory-resolver.js";
import {
  assembleSessionPrompt,
  measureSections,
} from "./prompting/index.js";
import type { HubRepository } from "./repository.js";
import {
  computeSessionSkillUsage,
  computeSkillListing,
  invocationOrderFromLoads,
  reconstructLoadedSkills,
  resolveHubSkillAttachments,
  type HubSkillReader,
} from "./skill-attachments.js";
import {
  DEFAULT_CHAT_BUILTIN_NAMES,
  resolveBuiltinGrants,
  resolveHubToolRegistry,
  type HubMcpServerCatalog,
  type HubToolLoadingPreference,
} from "./tools/index.js";
import {
  HUB_DEFAULT_PROJECT_CONTEXT_MAX_CHARS,
  reconstructMessages,
  resolveProjectContext,
  summarizeMemory,
  type HubAttachmentResolver,
} from "./turn-engine.js";

/** The granted-MCP-catalog snapshot a caller resolves (no live MCP session needed — this module only
 *  MEASURES definitions, it never calls a tool). `hub/routes.ts` builds this from the SAME
 *  `ServerRepository`/`ScanRepository` instances `index.ts`'s `resolveHubMcpGrants` uses, minus the
 *  live-session half (irrelevant here). */
export type HubContextMcpCatalogProvider = () => Promise<{
  grants: HubToolGrants;
  catalog: ReadonlyMap<string, HubMcpServerCatalog>;
}>;

export type HubContextInspectorDeps = {
  repository: HubRepository;
  tokenCounter: TokenCounter;
  skillReader?: HubSkillReader;
  skillListingBudgetFraction: number;
  skillEntryMaxChars: number;
  toolLoadingDefault: HubToolLoadingPreference;
  toolSearchAutoFraction: number;
  projectContextMaxChars?: number;
  /** Absent (no registered/scanned MCP servers, or the caller didn't wire one) ⇒ the `tools` layer
   *  reports the built-ins only, `mcpResident`/`mcpDeferred` both empty — never fabricated. */
  mcpCatalogProvider?: HubContextMcpCatalogProvider;
};

const EMPTY_MCP_CATALOG = new Map<string, HubMcpServerCatalog>();

/**
 * The `GET /api/hub/sessions/:id/context` payload: the shared {@link HubContextInspector} with its
 * `effectiveMemory` field (WP1.5, D-HUX11 — the session's profile → project → crew → agent memory,
 * resolved most-specific-wins) narrowed from optional to REQUIRED — this builder always computes it,
 * unlike a hand-authored/cached `HubContextInspector` elsewhere that might predate it. `HubEffectiveMemory`
 * itself was promoted to `@mcp-token-footprint/shared` in WP2.7 (it lived LOCAL to `apps/api` under
 * WP1.5, when the shared wire was frozen for that WP) — the web now consumes it fully typed.
 */
export type HubSessionContextPayload = HubContextInspector & {
  effectiveMemory: HubEffectiveMemory;
};

export async function buildHubContextInspector(
  deps: HubContextInspectorDeps,
  sessionId: string,
): Promise<HubSessionContextPayload> {
  const { repository, tokenCounter } = deps;
  const session = repository.getSession(sessionId); // 404s if unknown (HubRepository's own contract)
  const contextWindow = modelContextLimits()[session.model] ?? 0;
  const events = repository.listEvents(sessionId);

  // ── Memory (WP3.2/D-AH11) — the SAME body the turn engine injects + the Memory panel shows.
  const memoryRows = repository.listMemory({ status: "active" });
  const memoryText = summarizeMemory(memoryRows);
  const memoryTokens = memoryText ? await tokenCounter.countText(memoryText) : 0;

  // ── Project (WP3.1/D-AH11c) — the SAME resolver the turn engine calls.
  const projectContext = session.projectId
    ? resolveProjectContext(
        repository,
        session.projectId,
        deps.projectContextMaxChars ?? HUB_DEFAULT_PROJECT_CONTEXT_MAX_CHARS,
      )
    : undefined;
  const projectBody = projectContext?.projectInstructionsAndPinned;
  const projectTokens = projectBody ? await tokenCounter.countText(projectBody) : 0;

  // ── Tools (WP0.5, R-MCP2) — the REAL granted MCP catalog + the measured loading resolution.
  const mcpInputs = (await deps.mcpCatalogProvider?.()) ?? {
    grants: { servers: {}, builtins: DEFAULT_CHAT_BUILTIN_NAMES } as HubToolGrants,
    catalog: EMPTY_MCP_CATALOG,
  };
  const registry = await resolveHubToolRegistry({
    grants: mcpInputs.grants,
    mcpCatalog: mcpInputs.catalog,
    loadingPreference: deps.toolLoadingDefault,
    tokenCounter,
    contextWindow,
    autoFraction: deps.toolSearchAutoFraction,
  });
  const measureItem = async (t: {
    serverId: string;
    serverName?: string;
    exposedName: string;
    def: NormalizedToolDefinition;
  }): Promise<HubContextToolItem> => ({
    serverId: t.serverId,
    serverName: t.serverName ?? t.serverId,
    name: t.exposedName,
    tokens: (await tokenCounter.countToolDefinition(t.def)).totalTokens,
  });
  const resident = await Promise.all(registry.mcpResident.map(measureItem));
  const deferred = await Promise.all(registry.mcpDeferred.map(measureItem));
  const builtins = resolveBuiltinGrants(mcpInputs.grants).map((b) => ({ name: b.name }));
  const tools: HubContextToolsLayer = {
    mode: registry.loading.mode,
    totalTokens: registry.loading.totalTokens,
    residentTokens: registry.loading.residentTokens,
    savingsPercent: registry.loading.savingsPercent,
    resident,
    deferred,
    builtins,
  };

  // ── Skills (WP2.4, R-SK1/R-SK5) — the SAME computation `GET .../skills` already exposes.
  const attachments = repository.listSessionSkills(sessionId);
  const resolvedSkills = deps.skillReader
    ? resolveHubSkillAttachments(deps.skillReader, attachments)
    : [];
  const loaded = reconstructLoadedSkills(events);
  const { listing, listingText } = await computeSkillListing(resolvedSkills, {
    tokenCounter,
    contextWindow,
    budgetFraction: deps.skillListingBudgetFraction,
    entryMaxChars: deps.skillEntryMaxChars,
    invocationOrder: invocationOrderFromLoads(loaded),
  });
  const skillUsage = computeSessionSkillUsage(resolvedSkills, listing, loaded);
  const skillsTotalTokens = skillUsage.reduce((sum, s) => sum + s.totalTokens, 0);

  // ── History — the reconstructed conversation transcript, verbatim (the RAW window this session's
  //    events carry — not what a later compaction pass might trim it to).
  const resolveAttachment: HubAttachmentResolver = (fileId) => {
    try {
      const file = repository.getFile(fileId);
      return { filename: file.filename, mime: file.mime, content: repository.getFileContent(fileId) };
    } catch {
      return undefined;
    }
  };
  const messages = reconstructMessages(events, resolveAttachment);
  // Binary `file` parts carry a raw `Buffer` — stable-stringifying that verbatim would explode into a
  // huge `{"type":"Buffer","data":[…]}` byte array (nothing like what a provider actually receives).
  // Swap each Buffer for its base64 text first — closer to the real wire encoding, still a REAL
  // measurement of the attachment's byte cost, never a guess.
  const countableMessages = messages.map(sanitizeMessageForCounting);
  const historyTokens = countableMessages.length > 0 ? await tokenCounter.countJson(countableMessages) : 0;

  // ── §1.8 prompt sections — assembled with the SAME real injections a next turn would use. A
  //    `mission`-mode top-level session assembles its ordinary CHAT-turn prompt here (mirrors
  //    `HubSessionService.dispatchMessage`'s own `mission`→`chat` mapping — see `turn-engine.ts`'s
  //    module doc); the mission-planner/synthesizer/critic prompts are per-turn/per-role variants this
  //    forward-looking snapshot doesn't attempt to pick between.
  const promptMode = session.mode === "mission" ? "chat" : session.mode;
  const assembled = assembleSessionPrompt({
    mode: promptMode,
    session: {
      sessionTitle: session.title,
      mode: session.mode,
      modelId: session.model,
      ...(projectContext ? { projectName: projectContext.projectName } : {}),
      date: new Date().toISOString().slice(0, 10),
    },
    tools: {
      ...(registry.toolListText ? { toolListText: registry.toolListText } : {}),
      ...(listingText ? { skillsListText: listingText } : {}),
      loadingMode: registry.loading.mode,
    },
    ...(projectBody ? { project: { projectInstructionsAndPinned: projectBody } } : {}),
    ...(memoryText ? { memory: { memoryAndInstructions: memoryText } } : {}),
  });
  const promptSections = await measureSections(assembled.sections, tokenCounter);
  const promptTotalTokens = promptSections.reduce((sum, s) => sum + s.tokens, 0);

  // NOTE: memory/project bodies are already counted INSIDE `promptTotalTokens` above (their sections
  // embed the real injected text) — see the module doc's "double-counting" note. Not re-added below.
  const estimatedTotalTokens =
    promptTotalTokens + tools.residentTokens + skillsTotalTokens + historyTokens;

  const lastTurnDone = [...events].reverse().find((e) => e.type === "turn_done");
  const lastActualTokensIn =
    lastTurnDone?.type === "turn_done" ? lastTurnDone.usage?.tokensIn : undefined;

  // WP1.5 (D-HUX11) — the session's effective memory stack (profile → project → crew → agent,
  // most-specific-wins), tagged + ordered. Purely additive to the payload; NOT folded into the flat
  // `memory` layer above (which stays the turn engine's actual all-active injection). Synchronous —
  // `buildSessionEffectiveMemory` is repository reads only.
  const effectiveMemory = buildSessionEffectiveMemory(repository, sessionId);

  return {
    sessionId,
    model: session.model,
    contextWindow,
    promptSections,
    promptTotalTokens,
    tools,
    skills: { usage: skillUsage, totalTokens: skillsTotalTokens },
    memory: { tokens: memoryTokens, itemCount: memoryRows.length },
    project: projectContext
      ? {
          tokens: projectTokens,
          ...(session.projectId ? { projectId: session.projectId } : {}),
          projectName: projectContext.projectName,
        }
      : null,
    history: { tokens: historyTokens, messageCount: messages.length },
    estimatedTotalTokens,
    effectiveMemory,
    ...(lastActualTokensIn !== undefined ? { lastActualTokensIn } : {}),
  };
}

/** Deep-replace any `Buffer` `data` field (an AI-SDK `FilePart`) with its base64 string so
 *  `TokenCounter.countJson` measures something wire-shaped rather than a JSON byte-array explosion. */
function sanitizeMessageForCounting(message: unknown): unknown {
  if (Buffer.isBuffer(message)) return message.toString("base64");
  if (Array.isArray(message)) return message.map(sanitizeMessageForCounting);
  if (message && typeof message === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(message as Record<string, unknown>)) {
      out[key] = sanitizeMessageForCounting(value);
    }
    return out;
  }
  return message;
}
