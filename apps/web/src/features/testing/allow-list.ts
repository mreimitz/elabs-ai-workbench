import type {
  AllowedServer,
  AllowedSkill,
  ProviderKind,
  ScanDetail,
  ServerConfig,
  Skill,
  SkillVersion,
} from "@mcp-token-footprint/shared";
import { MODEL_CONTEXT_LIMITS } from "@mcp-token-footprint/shared";
import type { RankedItem } from "../../components/TokenViz";

/**
 * Shared, framework-free helpers behind the redesigned Environment editor. The definition-token
 * footprint math used by the right-hand allow-list and the nested Add-server flow lives here once
 * (extracted from the retired `AllowListPicker`) so both surfaces stay in lock-step — this is the
 * app's core strength (static, pre-run token accounting) and must not drift between views.
 */

/** Tools selected for one allow-list entry, resolving `allowedTools: null` ⇒ all scanned tools. */
export function resolveAllowedToolNames(
  entry: AllowedServer,
  scan: ScanDetail | undefined,
): Set<string> {
  const allToolNames = scan?.tools.map((tool) => tool.toolName) ?? [];
  return new Set(entry.allowedTools ?? allToolNames);
}

/**
 * Canonicalize a tool selection for one server into an `AllowedServer`. Mirrors the old
 * `AllowListPicker.toggleTool` collapse: "exactly all scanned tools" ⇒ `allowedTools: null` so the
 * wire shape stays canonical. With no scan we can't enumerate tools, so we keep `null` (all-tools).
 */
export function canonicalizeSelection(
  serverId: string,
  selected: Set<string>,
  scan: ScanDetail | undefined,
): AllowedServer {
  const allToolNames = scan?.tools.map((tool) => tool.toolName) ?? [];
  if (allToolNames.length === 0) return { serverId, allowedTools: null };
  const nextTools = allToolNames.filter((name) => selected.has(name));
  const allowedTools = nextTools.length === allToolNames.length ? null : nextTools;
  return { serverId, allowedTools };
}

/** Sum the definition tokens of an entry's selected tools from its latest scan (0 with no scan). */
export function entryFootprint(
  entry: AllowedServer,
  scan: ScanDetail | undefined,
): { tokens: number; toolCount: number } {
  if (!scan) return { tokens: 0, toolCount: 0 };
  const allowed = resolveAllowedToolNames(entry, scan);
  const tools = scan.tools.filter((tool) => allowed.has(tool.toolName));
  return {
    tokens: tools.reduce((sum, tool) => sum + tool.totalTokens, 0),
    toolCount: tools.length,
  };
}

export type AllowListFootprint = {
  total: number;
  selectedToolCount: number;
  ranked: RankedItem[];
};

/**
 * Per-server contribution + grand total of the selected tools' definition tokens across the whole
 * allow-list — the live panel on the right of the editor. Identical math to the retired picker.
 */
export function computeFootprint(
  servers: ServerConfig[],
  value: AllowedServer[],
  latestScans: Map<string, ScanDetail>,
): AllowListFootprint {
  const byServerId = new Map<string, AllowedServer>();
  for (const entry of value) byServerId.set(entry.serverId, entry);

  const perServer: { id: string; label: string; value: number }[] = [];
  let total = 0;
  let selectedToolCount = 0;

  for (const server of servers) {
    const entry = byServerId.get(server.id);
    if (!entry) continue;
    const scan = latestScans.get(server.id);
    const { tokens, toolCount } = entryFootprint(entry, scan);
    selectedToolCount += toolCount;
    total += tokens;
    perServer.push({ id: server.id, label: server.name, value: tokens });
  }

  const denom = total || 1;
  const ranked: RankedItem[] = perServer
    .map((item) => ({ ...item, percent: (item.value / denom) * 100 }))
    .sort((left, right) => right.value - left.value);

  return { total, selectedToolCount, ranked };
}

// --- Skill attachments (Phase 2 — WP 2.3) -----------------------------------------------------
// The editor's "Allowed skills" panel mirrors the servers panel: each attachment shows a version
// chip + a per-skill footprint, and its tokens fold into the scenario's live footprint sum. The
// footprint follows the run engine exactly: L1 (name+description metadata) is ALWAYS resident; L2
// (the SKILL.md body) is added ONLY when the attachment is eager. This must stay in lock-step with
// `run-service`/`skill-context` so the pre-run estimate matches realized behavior.

/**
 * Resolve an attachment to the concrete {@link SkillVersion} the run would use: `pinned` → the fixed
 * id; `latest` → the skill's `currentVersionId`. Returns `undefined` when the version can't be found
 * (e.g. a skill with no versions yet, or a pinned id that no longer exists) — the caller degrades to
 * a "no version" state rather than inventing a footprint.
 */
export function resolveSkillVersion(
  attachment: AllowedSkill,
  skill: Skill | undefined,
  versions: SkillVersion[] | undefined,
): SkillVersion | undefined {
  const list = versions ?? [];
  const versionId =
    attachment.versionMode === "pinned" ? attachment.pinnedVersionId : skill?.currentVersionId;
  if (!versionId) return undefined;
  return list.find((version) => version.id === versionId);
}

/** The always-on L1 + (eager-only) L2 token footprint of one resolved skill attachment. */
export function skillEntryFootprint(
  attachment: AllowedSkill,
  version: SkillVersion | undefined,
): { tokens: number; l1: number; l2: number } {
  if (!version) return { tokens: 0, l1: 0, l2: 0 };
  const l1 = version.l1MetadataTokens;
  const l2 = attachment.eager ? version.l2BodyTokens : 0;
  return { tokens: l1 + l2, l1, l2 };
}

export type SkillListFootprint = {
  total: number;
  attachedCount: number;
  ranked: RankedItem[];
};

/**
 * Per-skill contribution + grand total of the attached skills' always-on (L1 + eager L2) tokens —
 * the sibling of {@link computeFootprint} for the "Allowed skills" panel. Skills whose version can't
 * be resolved contribute 0 (and rank last) rather than being dropped, so the panel stays honest.
 */
export function computeSkillFootprint(
  attachments: AllowedSkill[],
  skillsById: Map<string, Skill>,
  versionsBySkillId: Map<string, SkillVersion[]>,
): SkillListFootprint {
  const perSkill: { id: string; label: string; value: number }[] = [];
  let total = 0;

  for (const attachment of attachments) {
    const skill = skillsById.get(attachment.skillId);
    const version = resolveSkillVersion(
      attachment,
      skill,
      versionsBySkillId.get(attachment.skillId),
    );
    const { tokens } = skillEntryFootprint(attachment, version);
    total += tokens;
    perSkill.push({
      id: attachment.skillId,
      label: skill?.displayName ?? attachment.skillId,
      value: tokens,
    });
  }

  const denom = total || 1;
  const ranked: RankedItem[] = perSkill
    .map((item) => ({ ...item, percent: (item.value / denom) * 100 }))
    .sort((left, right) => right.value - left.value);

  return { total, attachedCount: attachments.length, ranked };
}

/**
 * Known models from `MODEL_CONTEXT_LIMITS`, filtered to the provider `kind` via a model-id prefix
 * map. If no provider is selected (or nothing matches the kind) every known model is returned so the
 * Combobox is never empty. The engine accepts ANY model id — this is convenience, not a gate; an
 * arbitrary id is still reachable via the "custom model" affordance.
 */
export function modelsForKind(kind: ProviderKind | undefined): string[] {
  const all = Object.keys(MODEL_CONTEXT_LIMITS);
  if (!kind) return all;
  const matched = all.filter((model) => kindForModelId(model)?.has(kind));
  return matched.length > 0 ? matched : all;
}

/** Map a model-id prefix to the provider kinds it can run under. */
function kindForModelId(modelId: string): Set<ProviderKind> | undefined {
  if (modelId.startsWith("claude")) return new Set<ProviderKind>(["anthropic"]);
  if (modelId.startsWith("gpt") || modelId.startsWith("o3") || modelId.startsWith("o4")) {
    return new Set<ProviderKind>(["openai"]);
  }
  if (modelId.startsWith("gemini")) return new Set<ProviderKind>(["google"]);
  if (modelId.startsWith("llama") || modelId.startsWith("qwen") || modelId.startsWith("mistral")) {
    return new Set<ProviderKind>(["ollama", "openai_compatible"]);
  }
  return undefined;
}

/** True when the model id is one of the code-maintained known models. */
export function isKnownModel(modelId: string): boolean {
  return Object.prototype.hasOwnProperty.call(MODEL_CONTEXT_LIMITS, modelId);
}
