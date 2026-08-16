// Assistant Hub (WP0.5, §1.6) — the built-in tool catalog barrel.
import type { HubBuiltinTool } from "../types.js";
import { ARTIFACT_BUILTINS, artifactsCreate, artifactsRead, artifactsUpdate } from "./artifacts.js";
import { MEMORY_BUILTINS, memoryProposeSave } from "./memory.js";
import { MISSION_BUILTINS, missionProposePlan } from "./mission.js";
import { MISSION_READ_BUILTINS, missionList, missionReport } from "./mission-read.js";
import { reconstructTasks, TASK_BUILTINS, tasksCreate, tasksList, tasksUpdate } from "./tasks.js";
import { composeWebTools, WEB_BUILTINS, webFetch } from "./web.js";
import { filesEdit, filesList, filesRead, filesWrite, WORKSPACE_BUILTINS } from "./workspace.js";

/**
 * Every built-in the registry knows how to build via the STANDARD grant path (§1.6's full in-process
 * list). NOTE (hub-fixes WP5.1): the web built-ins are DELIBERATELY excluded here — `web.fetch` and the
 * provider-native `web.search` ride `HubToolGrants.builtins` but are composed by a dedicated seam
 * (`hub/session-service.ts` → `composeWebTools`), so they never enter `ALL_BUILTINS`/
 * `DEFAULT_CHAT_BUILTIN_NAMES` and are never granted silently (D-HF2). See `./web.ts`.
 */
export const ALL_BUILTINS: HubBuiltinTool[] = [
  ...WORKSPACE_BUILTINS,
  ...ARTIFACT_BUILTINS,
  ...MEMORY_BUILTINS,
  ...TASK_BUILTINS,
  ...MISSION_BUILTINS,
  // assistant-hub v1-fixes (F3) — the mission READ builtins. Default-granted (read-only, reconstructed
  // from the session's own events); `mission.propose_plan` stays specially-gated below.
  ...MISSION_READ_BUILTINS,
];

export const ALL_BUILTIN_NAMES: string[] = ALL_BUILTINS.map((tool) => tool.name);

/**
 * Every built-in EXCEPT the planner-only `mission.propose_plan` — the default grant for an ordinary
 * chat/research session (the `tools` prompt layer's "Built-ins (always present)" promise, LAYER 3 in
 * `hub/prompting/layers/tools.ts`). Mission mode / a planner role additionally grants
 * `mission.propose_plan` on top of this list. `HubToolGrants.builtins` is itself a generic, caller-
 * populated allowlist (empty = none, per the ABSENT-means-NONE convention `HubToolGrants` documents
 * for `servers`) — this constant is the convenience default a later WP (WP1.1's session-service) can
 * use to build a "grant every standard built-in" `HubToolGrants` without hand-listing tool names.
 */
export const DEFAULT_CHAT_BUILTIN_NAMES: string[] = ALL_BUILTINS.filter(
  (tool) => tool.name !== missionProposePlan.name,
).map((tool) => tool.name);

export {
  ARTIFACT_BUILTINS,
  MEMORY_BUILTINS,
  MISSION_BUILTINS,
  MISSION_READ_BUILTINS,
  TASK_BUILTINS,
  WEB_BUILTINS,
  WORKSPACE_BUILTINS,
  artifactsCreate,
  artifactsRead,
  artifactsUpdate,
  missionList,
  missionReport,
  composeWebTools,
  filesEdit,
  filesList,
  filesRead,
  filesWrite,
  memoryProposeSave,
  missionProposePlan,
  reconstructTasks,
  tasksCreate,
  tasksList,
  tasksUpdate,
  webFetch,
};
