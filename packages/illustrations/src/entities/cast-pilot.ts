// ==================================================================================================
// The pilot cast (WP 0.3) — the three entities that proved the vocabulary
// ==================================================================================================
// `mcp-server`, `skill` and `agent`, moved out of `registry.ts` unchanged by WP 1.1. Nothing about
// the three components moved with them; what moved is WHERE the catalog learns about them, so that
// there is exactly ONE way to be in the catalog rather than "the three inline ones and everybody
// else". A module that is only for the pilots would be a second mechanism by another name.
//
// Each cast module also re-exports its own entities, so `entities/index.ts` never lists a component
// either. That is the whole point of the seam: adding an entity touches its own file and its own
// cast module, and nothing else.

export * from "./Agent.js";
export * from "./McpServer.js";
export * from "./Skill.js";

import { Agent, agentMeta } from "./Agent.js";
import { McpServer, mcpServerMeta } from "./McpServer.js";
import { Skill, skillMeta } from "./Skill.js";
import type { IllustrationCastMember } from "./cast-member.js";

export const ILLUSTRATION_PILOT_CAST: readonly IllustrationCastMember[] = [
  { meta: mcpServerMeta, component: McpServer },
  { meta: skillMeta, component: Skill },
  { meta: agentMeta, component: Agent },
];
