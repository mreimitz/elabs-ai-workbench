// Assistant Hub (roadmap/assistant-hub/, WP2.4, R-SK2/R-SK3) — the `skills.load` built-in: how a
// session-attached skill's L2 (SKILL.md body) or L3 (a referenced file) loads ON DEMAND, model-driven,
// **enum-constrained** (the model picks a name from the L1 catalog it was already shown — never a free
// string, never harness keyword matching). A fresh instance per turn (the enum is session-specific — the
// SAME "no static export" pattern `tool_search` uses, since the catalog changes per session/turn).
//
// SECURITY INVARIANT (mirrors `testing/skill-context.ts`'s disclosure tools): this NEVER executes skill
// content — it returns file text only. Path reads are guarded to files that actually exist in the
// resolved version (no traversal, no filesystem escape).
import type { HubResolvedSkillAttachment } from "@mcp-token-footprint/shared";
import { z } from "zod";
import {
  reconstructLoadedSkills,
  stripFrontmatterBlock,
  type HubSkillReader,
  type SkillLoadModelContent,
} from "../skill-attachments.js";
import type { HubBuiltinTool } from "./types.js";

/** R-SK2's "first 5K/skill, 25K combined" compaction-protection budgets (`HUB_SKILL_COMPACTION_
 *  TOKENS_PER_SKILL` / `_TOTAL`). Interpreted here as the load-time CEILING (not just a later
 *  eviction target — see the module doc on `skill-attachments.ts` companion tests): what actually
 *  enters context is capped at these budgets, so "protected within budget" is trivially true — a
 *  future compaction pass (WP3.3) never needs to partially evict a skill body. */
export type SkillLoadBudgets = { perSkillTokens: number; totalTokens: number };

export const DEFAULT_SKILL_LOAD_BUDGETS: SkillLoadBudgets = {
  perSkillTokens: 5000,
  totalTokens: 25000,
};

/**
 * Build `skills.load` over ONE turn's LOADABLE catalog (session-level `model_invocable`/`name_only`
 * attachments — `user_only` ones are never passed in here, R-SK3). Returns `undefined` when there's
 * nothing loadable (a zod enum needs >= 1 member — mirrors `createToolSearchBuiltin`'s "only built
 * when there's something to act on" contract; callers skip registering the tool entirely).
 */
export function createSkillsLoadBuiltin(
  loadable: readonly HubResolvedSkillAttachment[],
  reader: HubSkillReader,
  budgets: SkillLoadBudgets = DEFAULT_SKILL_LOAD_BUDGETS,
): HubBuiltinTool | undefined {
  const uniqueNames = Array.from(new Set(loadable.map((r) => r.skillName)));
  if (uniqueNames.length === 0) return undefined;
  const [first, ...rest] = uniqueNames;
  if (!first) return undefined;

  const inputSchema = z
    .object({
      skill: z.enum([first, ...rest]),
      path: z.string().trim().min(1).optional(),
    })
    .strict();

  const byName = new Map(loadable.map((r) => [r.skillName, r]));

  return {
    name: "skills.load",
    source: "builtin",
    description:
      'Load a skill\'s full content on demand: the SKILL.md body (L2 — omit `path`) or one referenced file (L3 — give a `path` from that skill\'s file list). Pick `skill` ONLY from a name in the skills catalog above; never invent one. Re-loading the same skill/path is deduped (near-zero cost) — loaded content persists and stays in your context, protected from later summarization up to a per-skill/session budget.',
    inputSchema,
    annotations: { readOnlyHint: true },
    async execute(input, ctx) {
      const { skill: skillName, path } = inputSchema.parse(input);
      const resolved = byName.get(skillName);
      if (!resolved) {
        return {
          modelContent: null,
          isError: true,
          errorText: `No attached skill named "${skillName}".`,
        };
      }
      const requestPath = path ?? "";

      // Dedupe + budget accounting from THIS session's own event history — recomputed fresh on every
      // call (mirrors `tasksUpdate`'s `reconstructTasks()` read) so it stays correct across multiple
      // `skills.load` calls within one turn, not just across turns.
      const loaded = reconstructLoadedSkills(ctx.repository.listEvents(ctx.sessionId));
      const already = loaded.find((r) => r.skillId === resolved.skillId && r.path === requestPath);
      if (already) {
        const dedupe: SkillLoadModelContent = {
          skillId: resolved.skillId,
          skillName: resolved.skillName,
          path: requestPath,
          tokens: 0,
          dedupe: true,
        };
        return { modelContent: dedupe };
      }

      const target =
        requestPath === ""
          ? loadSkillMdBody(reader, resolved)
          : loadReferencedFile(reader, resolved, requestPath);
      if ("error" in target) {
        return { modelContent: null, isError: true, errorText: target.error };
      }

      const perSkillUsed = sumTokens(loaded, (r) => r.skillId === resolved.skillId);
      const totalUsed = sumTokens(loaded, () => true);
      const remaining = Math.max(
        0,
        Math.min(budgets.perSkillTokens - perSkillUsed, budgets.totalTokens - totalUsed),
      );

      if (remaining <= 0) {
        const exhausted: SkillLoadModelContent = {
          skillId: resolved.skillId,
          skillName: resolved.skillName,
          path: requestPath,
          tokens: 0,
          content: `(Not loaded — the compaction-protection budget is exhausted: ${budgets.perSkillTokens} tokens/skill, ${budgets.totalTokens} tokens/session. Work with what is already loaded, or ask to detach an unused skill.)`,
        };
        return { modelContent: exhausted };
      }

      const fullTokens = await ctx.tokenCounter.countText(target.text);
      const overBudget = fullTokens > remaining;
      const body = overBudget ? truncateToBudget(target.text, remaining) : target.text;
      const tokens = overBudget ? await ctx.tokenCounter.countText(body) : fullTokens;

      const result: SkillLoadModelContent = {
        skillId: resolved.skillId,
        skillName: resolved.skillName,
        path: requestPath,
        tokens,
        content: overBudget ? `${body}\n\n_(truncated — compaction-protection budget reached)_` : body,
        ...(overBudget ? { truncated: true } : {}),
      };
      return {
        modelContent: result,
        artifact: {
          kind: "skill_content",
          data: { skillId: resolved.skillId, skillName: resolved.skillName, path: requestPath || "SKILL.md" },
        },
      };
    },
  };
}

function sumTokens(
  loaded: readonly { skillId: string; tokens: number }[],
  predicate: (r: { skillId: string; tokens: number }) => boolean,
): number {
  return loaded.filter(predicate).reduce((sum, r) => sum + r.tokens, 0);
}

function loadSkillMdBody(
  reader: HubSkillReader,
  resolved: HubResolvedSkillAttachment,
): { text: string } | { error: string } {
  const files = reader.listFiles(resolved.versionId);
  const skillMd = files.find((f) => f.isSkillMd);
  if (!skillMd) return { error: `Skill "${resolved.skillName}" has no SKILL.md in this version.` };
  const file = reader.getFileContent(resolved.versionId, skillMd.path);
  if (file.isBinary) return { error: `SKILL.md for "${resolved.skillName}" is binary — cannot load.` };
  return { text: stripFrontmatterBlock(file.text) };
}

function loadReferencedFile(
  reader: HubSkillReader,
  resolved: HubResolvedSkillAttachment,
  rawPath: string,
): { text: string } | { error: string } {
  if (!isSafeRelativePath(rawPath)) {
    return {
      error: `Invalid path "${rawPath}" (must be a relative file within the skill, no traversal).`,
    };
  }
  const files = reader.listFiles(resolved.versionId);
  const known = files.some((f) => f.path === rawPath);
  if (!known) {
    return { error: `File "${rawPath}" is not part of skill "${resolved.skillName}".` };
  }
  const file = reader.getFileContent(resolved.versionId, rawPath);
  if (file.isBinary) {
    return { error: `File "${rawPath}" is binary — this tool reads text only.` };
  }
  return { text: file.text };
}

/** A path is safe iff relative, non-empty, traversal-free (mirrors `skill-context.ts`'s
 *  `isSafeRelativePath` — the existence check above is the second guard). */
function isSafeRelativePath(path: string): boolean {
  if (!path) return false;
  if (path.startsWith("/") || path.includes("\\") || path.includes("\0")) return false;
  const segments = path.split("/");
  return segments.every((segment) => segment !== "" && segment !== "." && segment !== "..");
}

/** A rough chars-per-token starting cut (4:1) — the caller re-measures the ACTUAL truncated text's
 *  tokens afterward, so this only needs to land safely under budget, not hit it exactly. */
function truncateToBudget(text: string, remainingTokens: number): string {
  const approxChars = Math.max(0, remainingTokens * 4);
  return text.slice(0, approxChars);
}
