// Assistant Hub (roadmap/assistant-hub/, WP2.4, D-AH7 · R-SK1…R-SK6/R-SK8) — skill ATTACHMENT
// resolution, the R-SK1 L1 listing-budget/demotion algorithm, and R-SK5 session-true usage. Composes
// over the Skills registry's `SkillRepository` (`apps/api/src/skills/repository.ts`) exactly like the
// Testing feature's `resolveAllowedSkills` (`apps/api/src/testing/scenario-service.ts`) — read-only,
// never executes anything (the app invariant). This module has NO knowledge of hub_events/hub_sessions;
// it is pure resolution + measurement, so it is trivially unit-testable with a stub reader/counter.
import type {
  HubResolvedSkillAttachment,
  HubSkillAttachment,
  HubSkillFrontmatterSuperset,
  HubSkillListing,
  HubSkillListingEntry,
  HubSkillSessionUsage,
  Skill,
  SkillFileContent,
  SkillFileNode,
  SkillVersion,
  HubEvent,
} from "@mcp-token-footprint/shared";
import { parse as parseYaml } from "yaml";
import type { TokenCounter } from "../token-counting/types.js";

/** The narrow read-only slice of `SkillRepository` this module needs — the SAME 4 methods
 *  `testing/skill-context.ts`'s `SkillFileReader` seam uses, so a real `SkillRepository` instance
 *  satisfies this structurally with no adapter. Kept as an interface so unit tests stub it. */
export type HubSkillReader = {
  getPublic(id: string): Skill;
  getVersion(versionId: string): SkillVersion;
  listFiles(versionId: string): SkillFileNode[];
  getFileContent(versionId: string, path: string): SkillFileContent;
};

/** The tool NAME the `skills.load` built-in registers under — shared here (not `builtins/skills.ts`)
 *  so {@link reconstructLoadedSkills} (used by both the built-in's dedupe check AND the read-only
 *  usage endpoint) has no import-direction dependency on the built-in module. */
export const SKILLS_LOAD_TOOL_NAME = "skills.load";

// ── Attachment resolution (mirrors `ScenarioService.resolveAllowedSkills`) ─────────────────────────

/**
 * Resolve ONE attachment to a concrete version + frontmatter superset + footprint. `latest` reads the
 * skill's `currentVersionId` AT CALL TIME (so a session tracking latest picks up a freshly pulled
 * version); `pinned` uses the fixed `pinnedVersionId`. A deleted skill/version, or a `latest` skill
 * with no version yet, resolves to `null` — never throws (mirrors `resolveAllowedSkills`'s "skip
 * gracefully" contract; an attachment is metadata, not a hard dependency).
 */
export function resolveHubSkillAttachment(
  reader: HubSkillReader,
  attachment: HubSkillAttachment,
): HubResolvedSkillAttachment | null {
  try {
    const skill = reader.getPublic(attachment.skillId);
    const versionId =
      attachment.versionMode === "pinned" ? attachment.pinnedVersionId : skill.currentVersionId;
    if (!versionId) return null;

    const version = reader.getVersion(versionId);
    if (version.skillId !== attachment.skillId) return null; // a pinned id for a foreign skill — ignore

    const files = reader.listFiles(versionId);
    const skillMdFile = files.find((f) => f.isSkillMd);
    const rawFrontmatter = skillMdFile ? readRawFrontmatter(reader, versionId, skillMdFile.path) : {};

    const resolved: HubResolvedSkillAttachment = {
      skillId: skill.id,
      versionMode: attachment.versionMode,
      invocationMode: attachment.invocationMode,
      skillName: skill.name,
      skillDescription: version.manifest.description || skill.description || "",
      versionId,
      versionLabel: version.versionLabel,
      isLatest: versionId === skill.currentVersionId,
      footprint: {
        tokenProfile: version.tokenProfile,
        l1MetadataTokens: version.l1MetadataTokens,
        l2BodyTokens: version.l2BodyTokens,
        l3ResourceTokens: version.l3ResourceTokens,
        totalTokens: version.totalTokens,
      },
      frontmatter: toFrontmatterSuperset(rawFrontmatter),
    };
    if (attachment.versionMode === "pinned" && attachment.pinnedVersionId) {
      resolved.pinnedVersionId = attachment.pinnedVersionId;
    }
    return resolved;
  } catch {
    return null;
  }
}

/** Resolve a list of attachments, silently dropping any that don't resolve (see the single-attachment
 *  doc). Order is preserved for the entries that DO resolve. */
export function resolveHubSkillAttachments(
  reader: HubSkillReader,
  attachments: readonly HubSkillAttachment[],
): HubResolvedSkillAttachment[] {
  const out: HubResolvedSkillAttachment[] = [];
  for (const attachment of attachments) {
    const resolved = resolveHubSkillAttachment(reader, attachment);
    if (resolved) out.push(resolved);
  }
  return out;
}

// Read the raw YAML frontmatter block off a resolved SKILL.md (best-effort, never throws) — R-SK4's
// "surfaced, never silently dropped" needs fields (`when_to_use`, `context`, `agent`, `model`,
// `effort`, `paths`, arbitrary `metadata.*`) the registry's `SkillManifest` parser does not model
// (`apps/api/src/skills/manifest.ts` — see its module doc). Rather than extend that parser (a
// cross-domain change outside this WP's owned files), this module does its OWN light top-level
// frontmatter extraction using the same `yaml` package, purely for DISPLAY — it never feeds back into
// manifest validation/storage.
function readRawFrontmatter(
  reader: HubSkillReader,
  versionId: string,
  skillMdPath: string,
): Record<string, unknown> {
  try {
    const content = reader.getFileContent(versionId, skillMdPath);
    if (content.isBinary) return {};
    const normalized = content.text.replace(/\r\n/g, "\n").replace(/^﻿/, "");
    const match = normalized.match(/^---[ \t]*\n([\s\S]*?)\n---[ \t]*(?:\n|$)/);
    if (!match) return {};
    const parsed = parseYaml(match[1] ?? "");
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return {};
  } catch {
    return {};
  }
}

// Frontmatter keys the registry's `SkillManifest` (or this module's own superset fields) already
// surface elsewhere — excluded from `extra` so nothing is shown twice.
const KNOWN_FRONTMATTER_KEYS = new Set([
  "name",
  "description",
  "license",
  "compatibility",
  "metadata",
  "allowed-tools",
  "allowedTools",
  "servers",
  "when_to_use",
  "context",
  "agent",
  "model",
  "effort",
  "paths",
]);

function toFrontmatterSuperset(raw: Record<string, unknown>): HubSkillFrontmatterSuperset {
  const out: HubSkillFrontmatterSuperset = {};
  if (typeof raw.when_to_use === "string") out.whenToUse = raw.when_to_use;
  if (typeof raw.context === "string") out.context = raw.context;
  if (typeof raw.agent === "string") out.agent = raw.agent;
  if (typeof raw.model === "string") out.model = raw.model;
  if (typeof raw.effort === "string") out.effort = raw.effort;
  const paths = coerceStringList(raw.paths);
  if (paths) out.paths = paths;

  const metadata = raw.metadata;
  if (metadata && typeof metadata === "object" && !Array.isArray(metadata)) {
    const m = metadata as Record<string, unknown>;
    if (typeof m.version === "string") out.metadataVersion = m.version;
    if (typeof m.author === "string") out.metadataAuthor = m.author;
  }

  const extra: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (KNOWN_FRONTMATTER_KEYS.has(key)) continue;
    if (value === null || value === undefined) continue;
    extra[key] = typeof value === "string" ? value : safeStringify(value);
  }
  if (Object.keys(extra).length > 0) out.extra = extra;

  return out;
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function coerceStringList(value: unknown): string[] | undefined {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) {
    const strings = value.filter((v): v is string => typeof v === "string");
    return strings.length > 0 ? strings : undefined;
  }
  return undefined;
}

// ── R-SK3 — role-level skills: preload the FULL body into the agent brief ──────────────────────────
//
// The "subagent-skills pattern": unlike session-level attachment (L1 catalog + on-demand `skills.load`,
// above), a MISSION AGENT's role-level skills are always fully inlined up front — there is no catalog,
// no on-demand load, no user in the loop to slash-invoke a skill mid-run. `missions/orchestrator.ts`
// calls this to populate `HubRoleTemplateInjection.roleSkillsContent` from a planned agent's (bare)
// `skillIds`.

/**
 * Resolve each id to its LATEST version's L2 body (frontmatter stripped) and format one block per
 * skill. Never truncates/budgets (unlike `skills.load`) — a role brief is assembled once by the
 * orchestrator, not streamed on demand; the number of skills a role carries is the caller's own
 * budget. An id that doesn't resolve (deleted skill, no version yet, binary/missing SKILL.md) is
 * silently skipped — one bad skill id must never block a mission launch.
 */
export function formatRoleSkillsContent(reader: HubSkillReader, skillIds: readonly string[]): string {
  const blocks: string[] = [];
  for (const skillId of skillIds) {
    const resolved = resolveHubSkillAttachment(reader, {
      skillId,
      versionMode: "latest",
      invocationMode: "model_invocable",
    });
    if (!resolved) continue;
    try {
      const files = reader.listFiles(resolved.versionId);
      const skillMdFile = files.find((f) => f.isSkillMd);
      if (!skillMdFile) continue;
      const file = reader.getFileContent(resolved.versionId, skillMdFile.path);
      if (file.isBinary) continue;
      blocks.push(`### ${resolved.skillName}\n${stripFrontmatterBlock(file.text)}`);
    } catch {
      continue;
    }
  }
  return blocks.join("\n\n");
}

/** Strip a leading `---`-delimited YAML frontmatter block, returning the Markdown body after it (the
 *  SAME delimiter rule as `manifest.ts`'s `splitFrontmatter` and `readRawFrontmatter` above) — the L2
 *  body matches `SkillVersion.l2BodyTokens`'s own definition (post-frontmatter body). Exported so
 *  `tools/skills-load.ts`'s L2 (SKILL.md) load uses the SAME definition — a session's realized L2 read
 *  and a role's preloaded L2 body are measured identically. */
export function stripFrontmatterBlock(text: string): string {
  const normalized = text.replace(/\r\n/g, "\n").replace(/^﻿/, "");
  const match = normalized.match(/^---[ \t]*\n[\s\S]*?\n---[ \t]*(?:\n([\s\S]*))?$/);
  return match ? (match[1] ?? "").replace(/^\n/, "") : normalized;
}

// ── R-SK1 — the L1 listing budget + least-recently-invoked demotion ────────────────────────────────

export type SkillListingOptions = {
  tokenCounter: TokenCounter;
  /** The target model's context window (`MODEL_CONTEXT_LIMITS[modelId]`). */
  contextWindow: number;
  /** `HUB_SKILL_LISTING_BUDGET_FRACTION` (default 0.01 — 1% of the window). */
  budgetFraction: number;
  /** `HUB_SKILL_ENTRY_MAX_CHARS` (default 1536) — per-entry description truncation. */
  entryMaxChars?: number;
  /** Skill ids ordered LEAST-recently-invoked first (oldest → newest). A skill absent from this list
   *  has NEVER been invoked this session and demotes before every listed (invoked) skill — mirrors
   *  `reconstructLoadedSkills`' natural read order. */
  invocationOrder?: readonly string[];
};

export type SkillListingResult = {
  listing: HubSkillListing;
  /** The rendered catalog text injected into the prompt (§1.8 LAYER 3's skills sub-section) — `""`
   *  when every attachment is `user_only` or there are none (R-SK1: "zero skills → no catalog"). */
  listingText: string;
};

const DEFAULT_ENTRY_MAX_CHARS = 1536;

/**
 * Build the L1 catalog under its token budget (`floor(contextWindow * budgetFraction)`), demoting
 * `model_invocable` entries to name-only (least-recently-invoked first) until the rendered text fits
 * — or every demotable entry is exhausted (the budget is a target, never a hard drop: an over-budget
 * catalog of bare names still beats silently hiding a skill the session attached on purpose). A
 * manually `name_only` attachment is never "further" demoted (it's already at the floor); a
 * `user_only` attachment never enters the catalog at all (R-SK3).
 */
export async function computeSkillListing(
  resolved: readonly HubResolvedSkillAttachment[],
  opts: SkillListingOptions,
): Promise<SkillListingResult> {
  const budgetTokens = Math.floor(opts.contextWindow * opts.budgetFraction);
  const entryMaxChars = opts.entryMaxChars ?? DEFAULT_ENTRY_MAX_CHARS;
  const contextWindow = opts.contextWindow;

  const visible = resolved.filter((r) => r.invocationMode !== "user_only");
  const excluded = resolved.filter((r) => r.invocationMode === "user_only");

  if (visible.length === 0) {
    const entries: HubSkillListingEntry[] = excluded.map((r) => ({
      skillId: r.skillId,
      name: r.skillName,
      state: "excluded",
      demoted: false,
      loadable: false,
      tokens: 0,
    }));
    return { listing: { entries, budgetTokens, usedTokens: 0, contextWindow }, listingText: "" };
  }

  const state = new Map<string, "full" | "name_only">(
    visible.map((r) => [r.skillId, r.invocationMode === "name_only" ? "name_only" : "full"]),
  );

  let text = renderListingText(visible, state, entryMaxChars);
  let tokens = await opts.tokenCounter.countText(text);
  const demoted = new Set<string>();

  for (const skillId of demotionCandidateOrder(visible, opts.invocationOrder)) {
    if (tokens <= budgetTokens) break;
    if (state.get(skillId) !== "full") continue; // already name_only — not a further demotion
    state.set(skillId, "name_only");
    demoted.add(skillId);
    text = renderListingText(visible, state, entryMaxChars);
    tokens = await opts.tokenCounter.countText(text);
  }

  // Per-entry token cost: each entry's OWN rendered line measured in isolation (R-SK5's per-skill L1
  // contribution) — not a proportional split of `tokens` above, which would smear join/newline
  // overhead across entries inconsistently.
  const entryTokens = new Map<string, number>();
  for (const r of visible) {
    const line = renderListingText([r], state, entryMaxChars);
    entryTokens.set(r.skillId, await opts.tokenCounter.countText(line));
  }

  const entries: HubSkillListingEntry[] = [
    ...visible.map((r) => ({
      skillId: r.skillId,
      name: r.skillName,
      state: state.get(r.skillId) ?? "full",
      demoted: demoted.has(r.skillId),
      loadable: true,
      tokens: entryTokens.get(r.skillId) ?? 0,
    })),
    ...excluded.map((r) => ({
      skillId: r.skillId,
      name: r.skillName,
      state: "excluded" as const,
      demoted: false,
      loadable: false,
      tokens: 0,
    })),
  ];

  return { listing: { entries, budgetTokens, usedTokens: tokens, contextWindow }, listingText: text };
}

function renderListingText(
  visible: readonly HubResolvedSkillAttachment[],
  state: ReadonlyMap<string, "full" | "name_only">,
  entryMaxChars: number,
): string {
  return visible
    .map((r) => {
      if (state.get(r.skillId) === "name_only") return `- ${r.skillName}`;
      return `- ${r.skillName}: ${truncateDescription(r.skillDescription, entryMaxChars)}`;
    })
    .join("\n");
}

function truncateDescription(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 1))}…`;
}

/** Least-recently-invoked (or never-invoked) first. `invocationOrder` is oldest→newest; a skill absent
 *  from it (never invoked) ranks BEFORE every invoked skill (rank -1 < any listed index). */
function demotionCandidateOrder(
  visible: readonly HubResolvedSkillAttachment[],
  invocationOrder: readonly string[] | undefined,
): string[] {
  const rank = new Map<string, number>();
  (invocationOrder ?? []).forEach((skillId, index) => {
    if (!rank.has(skillId)) rank.set(skillId, index);
  });
  return visible
    .map((r) => r.skillId)
    .sort((a, b) => (rank.get(a) ?? -1) - (rank.get(b) ?? -1));
}

// ── R-SK2/R-SK5 — session-true realized L2/L3 loads, replayed from the event log ───────────────────
//
// Mirrors `builtins/tasks.ts`'s `reconstructTasks`: `skills.load` is persisted exactly like any other
// tool call (`tool_call` + `tool_result` events), so a session's loaded-skill-content state is fully
// derivable from `hub_events` alone (R-SES1) with no dedicated table.

export type LoadedSkillRecord = { skillId: string; path: string; tokens: number };

/** The `skills.load` built-in's `modelContent` shape (this module's own contract with itself — the
 *  built-in in `builtins/skills.ts` emits exactly this so replay can read it back safely). */
export type SkillLoadModelContent = {
  skillId: string;
  skillName: string;
  path: string;
  tokens: number;
  content?: string;
  truncated?: boolean;
  dedupe?: boolean;
};

export function reconstructLoadedSkills(events: readonly HubEvent[]): LoadedSkillRecord[] {
  const toolNameByCallId = new Map<string, string>();
  const records: LoadedSkillRecord[] = [];
  for (const event of events) {
    if (event.type === "tool_call") {
      toolNameByCallId.set(event.part.toolCallId, event.part.toolName);
      continue;
    }
    if (event.type !== "tool_result" || event.state !== "output-available") continue;
    if (toolNameByCallId.get(event.toolCallId) !== SKILLS_LOAD_TOOL_NAME) continue;
    const record = parseLoadedSkillRecord(event.modelContent);
    if (record) records.push(record);
  }
  return records;
}

function parseLoadedSkillRecord(value: unknown): LoadedSkillRecord | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (typeof v.skillId !== "string" || typeof v.path !== "string" || typeof v.tokens !== "number") {
    return null;
  }
  return { skillId: v.skillId, path: v.path, tokens: v.tokens };
}

/** The skill ids, oldest-invoked-first, derivable from the load records — the exact `invocationOrder`
 *  {@link computeSkillListing} wants. A skill loaded more than once keeps its FIRST invocation's rank
 *  (later re-invocations don't make it "fresher" for demotion purposes — R-SK1 cares whether it was
 *  EVER used, not how recently). */
export function invocationOrderFromLoads(loaded: readonly LoadedSkillRecord[]): string[] {
  const seen = new Set<string>();
  const order: string[] = [];
  for (const record of loaded) {
    if (seen.has(record.skillId)) continue;
    seen.add(record.skillId);
    order.push(record.skillId);
  }
  return order;
}

/**
 * R-SK5 — the session-true metering the context inspector itemizes: L1 (this session's CURRENT listing
 * state — 0 when excluded) + L2/L3 REALIZED this session (persisted, never re-estimated; L2 = the
 * SKILL.md body load, path `""`; L3 = any other loaded file). One row per resolved attachment, in the
 * same order as `resolved`.
 */
export function computeSessionSkillUsage(
  resolved: readonly HubResolvedSkillAttachment[],
  listing: HubSkillListing,
  loaded: readonly LoadedSkillRecord[],
): HubSkillSessionUsage[] {
  const listingBySkill = new Map(listing.entries.map((e) => [e.skillId, e]));
  const loadedBySkill = new Map<string, LoadedSkillRecord[]>();
  for (const record of loaded) {
    const list = loadedBySkill.get(record.skillId) ?? [];
    list.push(record);
    loadedBySkill.set(record.skillId, list);
  }

  return resolved.map((r) => {
    const entry = listingBySkill.get(r.skillId);
    const l1Tokens = entry?.tokens ?? 0;
    const records = loadedBySkill.get(r.skillId) ?? [];
    const l2Tokens = records.filter((rec) => rec.path === "").reduce((sum, rec) => sum + rec.tokens, 0);
    const l3Tokens = records.filter((rec) => rec.path !== "").reduce((sum, rec) => sum + rec.tokens, 0);
    return {
      skillId: r.skillId,
      name: r.skillName,
      l1Tokens,
      l2Tokens,
      l3Tokens,
      totalTokens: l1Tokens + l2Tokens + l3Tokens,
      invoked: records.length > 0,
      loadedPaths: records.map((rec) => (rec.path === "" ? "SKILL.md" : rec.path)),
    };
  });
}
