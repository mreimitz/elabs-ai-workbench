// Assistant Hub (WP0.5, §1.6) — the `files.{list,read,write,edit}` built-ins. Confined to the
// session's own workspace directory via `hub/workspace.ts` (path-traversal-guarded); content is
// read/written, NEVER executed (`.claude/rules/mcp-and-security.md`).
import type { HubToolAnnotations } from "@mcp-token-footprint/shared";
import { z } from "zod";
import {
  editWorkspaceTextFile,
  listWorkspaceTree,
  readWorkspaceTextFile,
  writeWorkspaceTextFile,
} from "../../workspace.js";
import type { HubBuiltinTool } from "../types.js";

const listInput = z.object({ path: z.string().optional() }).strict();
const readInput = z.object({ path: z.string().min(1) }).strict();
const writeInput = z.object({ path: z.string().min(1), content: z.string() }).strict();
const editInput = z
  .object({
    path: z.string().min(1),
    oldText: z.string().min(1),
    newText: z.string(),
    replaceAll: z.boolean().optional(),
  })
  .strict();

const READ_ONLY: HubToolAnnotations = { readOnlyHint: true, destructiveHint: false };
const WRITE: HubToolAnnotations = { readOnlyHint: false, destructiveHint: false, idempotentHint: true };
const EDIT: HubToolAnnotations = { readOnlyHint: false, destructiveHint: false, idempotentHint: false };

export const filesList: HubBuiltinTool = {
  name: "files.list",
  source: "builtin",
  description:
    "List files in your session workspace, optionally under a subdirectory. Workspace files are read/written, never executed.",
  inputSchema: listInput,
  annotations: READ_ONLY,
  async execute(input, ctx) {
    const { path: subPath } = listInput.parse(input);
    const entries = listWorkspaceTree(ctx.workspaceRoot, subPath ?? "");
    return { modelContent: { entries } };
  },
};

export const filesRead: HubBuiltinTool = {
  name: "files.read",
  source: "builtin",
  description: "Read a text file from your session workspace by its relative path.",
  inputSchema: readInput,
  annotations: READ_ONLY,
  async execute(input, ctx) {
    const { path: relPath } = readInput.parse(input);
    const content = readWorkspaceTextFile(ctx.workspaceRoot, relPath);
    return { modelContent: { path: relPath, content } };
  },
};

export const filesWrite: HubBuiltinTool = {
  name: "files.write",
  source: "builtin",
  description: "Create or overwrite a text file in your session workspace.",
  inputSchema: writeInput,
  annotations: WRITE,
  async execute(input, ctx) {
    const { path: relPath, content } = writeInput.parse(input);
    const result = writeWorkspaceTextFile(ctx.workspaceRoot, relPath, content);
    return {
      modelContent: result,
      artifact: { kind: "workspace_file", spillPath: result.path, mimeType: "text/plain" },
    };
  },
};

export const filesEdit: HubBuiltinTool = {
  name: "files.edit",
  source: "builtin",
  description:
    "Replace an exact, unique text span in an existing workspace file. Set replaceAll to replace every occurrence instead.",
  inputSchema: editInput,
  annotations: EDIT,
  async execute(input, ctx) {
    const { path: relPath, oldText, newText, replaceAll } = editInput.parse(input);
    const result = editWorkspaceTextFile(ctx.workspaceRoot, relPath, oldText, newText, replaceAll ?? false);
    return {
      modelContent: result,
      artifact: { kind: "workspace_file", spillPath: result.path, mimeType: "text/plain" },
    };
  },
};

export const WORKSPACE_BUILTINS: HubBuiltinTool[] = [filesList, filesRead, filesWrite, filesEdit];
