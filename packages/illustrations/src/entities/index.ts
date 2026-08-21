// The pilot cast (WP 0.3). Three entities, one file each, each exporting its component, its registry
// meta and its height function — the three things `registry.ts` and the gallery need. Phase 1 adds
// ~17 more against exactly this shape.

export { Agent, agentHeightUnits, agentMeta } from "./Agent.js";
export type { AgentProps } from "./Agent.js";
export {
  MCP_SERVER_VARIANTS,
  McpServer,
  mcpServerHeightUnits,
  mcpServerMeta,
} from "./McpServer.js";
export type { McpServerProps, McpServerVariant } from "./McpServer.js";
export { SKILL_VARIANTS, Skill, skillHeightUnits, skillMeta } from "./Skill.js";
export type { SkillProps, SkillVariant } from "./Skill.js";
export { entityViewBox } from "./entity-viewbox.js";
export type { EntityViewBox } from "./entity-viewbox.js";
export type { EntityComponentProps, IllustrationEntityComponent } from "./entity-props.js";
