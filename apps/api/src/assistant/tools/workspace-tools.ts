// Assistant (WP 2.2) — the skill-workspace edit-loop tools (D-AS13): `skills_open_workspace`
// materializes one skill version's files onto the real filesystem under the thread's workspace root so
// the agent can edit them with the SDK's NATIVE file tools (Read/Edit/Write/Glob/Grep — confined to cwd
// + `additionalDirectories`, see `session-manager.ts`'s `startSession` and `permission-classifier.ts`'s
// native-tool sets); `skills_commit_workspace` reads the (possibly agent-edited) tree back and imports
// it as a NEW immutable skill version via `SkillRepository.createVersion`, stamped with the shared
// `ASSISTANT_EDIT_SOURCE_REF`.
//
// Both are WRITE-classified by the permission classifier (neither name matches the delete-verb net), so
// BOTH always go through the WP 2.1 approval round-trip unless the thread has auto-accept ON — correct,
// since opening a workspace materializes real files and committing mints a new, permanent skill version:
// both are approvable actions, not silent side effects.
//
// Deliberately a SEPARATE module from `./index.ts` (shared with WP 3.1's `ui_*` tools) — included via
// ONE clearly-commented import + spread in `buildAssistantToolDefinitions` (see the "WP 2.2" hunk near
// the bottom of that file) so the two WPs' additions merge without touching each other's code.
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { ASSISTANT_EDIT_SOURCE_REF } from "@mcp-token-footprint/shared";
import { z } from "zod";
import { SkillDiffService } from "../../skills/diff-service.js";
import { countLevels, type SkillFootprintFile } from "../../skills/footprint.js";
import { parseSkillManifest } from "../../skills/manifest.js";
import { isBinary, type CreateVersionMeta, type SkillRepository } from "../../skills/repository.js";
import {
  materializeWorkspace,
  readWorkspaceTree,
  removeSkillWorkspace,
  skillWorkspaceDir,
} from "../workspace.js";
import { jsonResult, safeTool, truncateFields } from "./util.js";

/** Mirrors `tools/index.ts`'s list-pagination cap — the commit tool's diff payload truncates its
 *  (potentially large) `entries` array the same way `skills_diff` does. */
const DEFAULT_LIST_LIMIT = 50;

/**
 * Every WP 2.2 workspace tool's bare name — exported so a test (and `tools/index.ts`'s tool-inventory
 * sanity check) can assert `buildAssistantToolDefinitions`'s full registry without hardcoding the
 * strings twice.
 */
export const ASSISTANT_WORKSPACE_TOOL_NAMES = [
  "skills_open_workspace",
  "skills_commit_workspace",
] as const;

/**
 * The dependencies the workspace tools need: the skill repository, plus THIS SESSION's already-resolved
 * workspace root (an absolute path — see `tools/index.ts`'s `buildAssistantToolDefinitions`, which
 * derives it from `AssistantToolDeps.assistantDataDir` + the live `AssistantToolContext.threadId`).
 */
export interface WorkspaceToolDeps {
  skills: SkillRepository;
  /** This thread's workspace root — already `mkdir -p`'d by `session-manager.ts`'s `startSession`. */
  workspaceRoot: string;
}

export function buildWorkspaceToolDefinitions(deps: WorkspaceToolDeps) {
  return [
    tool(
      "skills_open_workspace",
      "Materialize one skill version's files onto a real, editable workspace directory so you can " +
        "read/edit them with your native file tools (Read/Edit/Write/Glob/Grep). Defaults to the " +
        "skill's CURRENT version when versionId is omitted. The response's workspacePath is the " +
        "ABSOLUTE directory to point your file tools at. CAUTION: re-opening a skill already open in " +
        "this workspace REPLACES its files with a fresh copy of the requested version, discarding any " +
        "uncommitted edits. Call skills_commit_workspace when you're done editing to save the changes " +
        "as a new skill version.",
      {
        skillId: z.string().min(1),
        versionId: z
          .string()
          .min(1)
          .optional()
          .describe("Defaults to the skill's current version."),
      },
      async (args) =>
        safeTool(() => {
          const skill = deps.skills.getPublic(args.skillId); // 404 if unknown
          const versionId = args.versionId ?? skill.currentVersionId;
          if (!versionId) {
            throw new Error(`Skill "${args.skillId}" has no versions to open.`);
          }
          const version = deps.skills.getVersion(versionId); // 404 if unknown
          if (version.skillId !== args.skillId) {
            throw new Error("That version does not belong to this skill.");
          }
          const files = deps.skills.getVersionFiles(versionId);
          const tree = materializeWorkspace(deps.workspaceRoot, args.skillId, files);
          return jsonResult({
            skillId: args.skillId,
            versionId,
            versionLabel: version.versionLabel,
            workspacePath: skillWorkspaceDir(deps.workspaceRoot, args.skillId),
            files: tree,
            fileCount: tree.length,
          });
        }),
    ),

    tool(
      "skills_commit_workspace",
      "Save the CURRENT contents of an open skill workspace — including any edits you made with " +
        "Read/Edit/Write/Glob/Grep — as a new, immutable skill version. Call skills_open_workspace " +
        "first. A tree byte-identical to the skill's current version makes NO new version " +
        "(`unchanged: true`) — that is not an error, it just means nothing changed.",
      {
        skillId: z.string().min(1),
        note: z.string().max(2000).optional().describe("A short note recorded on the new version."),
      },
      async (args) =>
        safeTool(async () => {
          const skill = deps.skills.getPublic(args.skillId); // 404 if unknown
          const fromVersionId = skill.currentVersionId;
          const tokenProfile = fromVersionId
            ? deps.skills.getVersion(fromVersionId).tokenProfile
            : undefined;

          const tree = readWorkspaceTree(deps.workspaceRoot, args.skillId); // 400 if empty/never opened
          const skillMdFile = tree.find((file) => file.path === "SKILL.md");
          const parsed = parseSkillManifest(skillMdFile ? skillMdFile.bytes.toString("utf8") : "");

          const footprintFiles: SkillFootprintFile[] = tree.map((file) =>
            isBinary(file.bytes)
              ? { path: file.path, isBinary: true }
              : { path: file.path, isBinary: false, text: file.bytes.toString("utf8") },
          );
          const levels = await countLevels(
            footprintFiles,
            parsed.manifest,
            parsed.body,
            tokenProfile,
          );
          const byPath = new Map<string, number>();
          for (const file of levels.files) byPath.set(file.path, file.tokenTotal);

          const meta: CreateVersionMeta = {
            sourceKind: "upload",
            importedFrom: "upload",
            sourceRef: ASSISTANT_EDIT_SOURCE_REF,
            manifest: parsed.manifest,
            manifestValid: parsed.valid,
            manifestErrors: parsed.errors,
            tokenProfile: levels.tokenProfile,
            note: args.note,
            footprint: { l1: levels.l1, l2: levels.l2, l3: levels.l3, total: levels.total, byPath },
          };
          const result = deps.skills.createVersion(args.skillId, tree, meta);

          if (result.unchanged) {
            // Dedup path (D-AS13): the workspace's tree matches the current version exactly. No new
            // version, so nothing to clean up — the workspace stays open in case the agent isn't done.
            return jsonResult({
              unchanged: true,
              skillId: args.skillId,
              versionId: result.version.id,
              message:
                "No changes to commit — the workspace tree matches the current skill version.",
            });
          }

          // A new version was minted — the workspace's job is done; free it (D-AS13 lifecycle: "removed
          // on commit"). The thread's OTHER open skill workspaces (if any) are untouched.
          removeSkillWorkspace(deps.workspaceRoot, args.skillId);

          const diff = fromVersionId
            ? truncateFields(
                new SkillDiffService(deps.skills).diffVersions(fromVersionId, result.version.id),
                ["entries"],
                DEFAULT_LIST_LIMIT,
              )
            : undefined;

          return jsonResult({
            unchanged: false,
            skillId: args.skillId,
            versionId: result.version.id,
            versionLabel: result.version.versionLabel,
            skillLink: `/skills/${args.skillId}`,
            ...(diff ? { diff } : {}),
          });
        }),
    ),
  ];
}
