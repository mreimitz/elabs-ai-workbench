// Assistant Hub (WP0.5, §1.6, R-SES4) — the `tasks.{create,update,list}` built-ins: the live task
// widget's tool surface.
//
// DESIGN NOTE (read before touching this file): §1.3 deliberately has NO `hub_tasks` table — R-SES4
// says "Task state transitions are events." There is also no dedicated `task_*` member in the closed
// `HUB_EVENT_TYPES` union (WP0.1's contract). The resolution: a `tasks.create`/`tasks.update` call is
// persisted exactly like ANY OTHER tool call — an ordinary `tool_call` event (carrying the args as
// `part.args`) followed by a `tool_result` event (carrying the settled `HubTaskItem` as
// `modelContent`) — the GENERIC mechanism the turn engine (WP1.1) applies to every tool call, built-in
// or MCP. `reconstructTasks` below replays exactly that pair to answer "what are the tasks right now."
// This keeps the task widget fully within the R-SES1 event-sourcing invariant (a session's full state,
// including its task list, is reconstructible from `hub_events` alone) without WP0.5 inventing a new
// persistence path or a new event type it isn't authorized to add to the shared contract.
import { hubTaskItemSchema, hubTaskStatusSchema } from "@mcp-token-footprint/shared";
import type { HubEvent, HubTaskItem } from "@mcp-token-footprint/shared";
import { nanoid } from "nanoid";
import { z } from "zod";
import type { HubBuiltinTool } from "../types.js";

const createInput = z
  .object({
    title: z.string().trim().min(1),
    status: hubTaskStatusSchema.optional(),
    dependsOn: z.array(z.string()).optional(),
    note: z.string().optional(),
  })
  .strict();

const updateInput = z
  .object({
    id: z.string().min(1),
    title: z.string().trim().min(1).optional(),
    status: hubTaskStatusSchema.optional(),
    dependsOn: z.array(z.string()).optional(),
    note: z.string().optional(),
  })
  .strict();

const listInput = z.object({}).strict();

/**
 * Reconstruct the session's CURRENT task list by replaying its `tasks.create`/`tasks.update`
 * tool-call/tool-result event pairs, in `seq` order — see the module doc for why there's no table.
 * Only `output-available` results are folded (a denied/errored call never touched the list).
 * Defensive throughout: a malformed/foreign payload is skipped, never thrown — this reads a payload
 * shape this module doesn't fully control (the turn engine round-trips it through JSON persistence).
 */
export function reconstructTasks(events: readonly HubEvent[]): HubTaskItem[] {
  const toolNameByCallId = new Map<string, string>();
  const tasks = new Map<string, HubTaskItem>();
  const order: string[] = [];

  for (const event of events) {
    if (event.type === "tool_call") {
      toolNameByCallId.set(event.part.toolCallId, event.part.toolName);
      continue;
    }
    if (event.type !== "tool_result" || event.state !== "output-available") continue;
    const toolName = toolNameByCallId.get(event.toolCallId);
    if (toolName !== "tasks.create" && toolName !== "tasks.update") continue;
    const parsed = hubTaskItemSchema.safeParse(event.modelContent);
    if (!parsed.success) continue;
    const item = parsed.data;
    if (!tasks.has(item.id)) order.push(item.id);
    tasks.set(item.id, item);
  }

  return order.map((id) => tasks.get(id)).filter((item): item is HubTaskItem => item !== undefined);
}

export const tasksCreate: HubBuiltinTool = {
  name: "tasks.create",
  source: "builtin",
  description:
    "Add an item to your visible task list (status defaults to pending). Tracks REAL work only — " +
    "never create tasks that role-play agents or simulate parallel investigations; to actually run " +
    "agents, propose a mission.",
  inputSchema: createInput,
  annotations: { readOnlyHint: false, destructiveHint: false },
  async execute(input) {
    const { title, status, dependsOn, note } = createInput.parse(input);
    const item: HubTaskItem = {
      id: nanoid(),
      title,
      status: status ?? "pending",
      ...(dependsOn !== undefined ? { dependsOn } : {}),
      ...(note !== undefined ? { note } : {}),
    };
    return { modelContent: item, artifact: { kind: "task", data: item } };
  },
};

export const tasksUpdate: HubBuiltinTool = {
  name: "tasks.update",
  source: "builtin",
  description:
    "Patch an existing task by id (title/status/dependsOn/note — omit a field to keep it unchanged). Call tasks.list first if you don't know the id.",
  inputSchema: updateInput,
  annotations: { readOnlyHint: false, destructiveHint: false },
  async execute(input, ctx) {
    const { id, ...patch } = updateInput.parse(input);
    const current = reconstructTasks(ctx.repository.listEvents(ctx.sessionId)).find((t) => t.id === id);
    if (!current) {
      return {
        modelContent: null,
        isError: true,
        errorText: `No task with id "${id}" — call tasks.list first.`,
      };
    }
    const merged: HubTaskItem = {
      ...current,
      ...(patch.title !== undefined ? { title: patch.title } : {}),
      ...(patch.status !== undefined ? { status: patch.status } : {}),
      ...(patch.dependsOn !== undefined ? { dependsOn: patch.dependsOn } : {}),
      ...(patch.note !== undefined ? { note: patch.note } : {}),
    };
    return { modelContent: merged, artifact: { kind: "task", data: merged } };
  },
};

export const tasksList: HubBuiltinTool = {
  name: "tasks.list",
  source: "builtin",
  description: "List your current visible task list.",
  inputSchema: listInput,
  annotations: { readOnlyHint: true },
  async execute(_input, ctx) {
    const tasks = reconstructTasks(ctx.repository.listEvents(ctx.sessionId));
    return { modelContent: { tasks }, artifact: { kind: "task_list", data: tasks } };
  },
};

export const TASK_BUILTINS: HubBuiltinTool[] = [tasksCreate, tasksUpdate, tasksList];
