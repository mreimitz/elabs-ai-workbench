import type { Skill } from "@mcp-token-footprint/shared";
import type { EntityGroupBy } from "../../components/entity-browser";

/**
 * Grouping the registry by SOURCE (RM-32 D-OD6) — `sourceType` is the only real dimension a `Skill`
 * carries today (`upload` | `github`). A user-managed skill "type", mirroring the server-type entity,
 * would group the registry far better; that is an owner decision recorded as a follow-up on the
 * RM-32 ledger, not something assumed here.
 */
export const SKILL_SOURCE_LABELS: Record<Skill["sourceType"], string> = {
  github: "GitHub",
  upload: "Upload",
};

export function skillSourceGroupBy(): EntityGroupBy<Skill> {
  return {
    id: "source",
    label: "Source",
    // Unreachable in practice — every skill has a `sourceType` — but a group-by must answer for
    // every item, and an honest fallback beats a cast.
    fallbackLabel: "Other",
    groupOrder: ["github", "upload"],
    groupOf: (skill) => ({
      key: skill.sourceType,
      label: SKILL_SOURCE_LABELS[skill.sourceType],
    }),
  };
}

/** The searchable text for one skill — name, slug and description, matching the deleted rail. */
export function skillSearchText(skill: Skill): string {
  return `${skill.displayName} ${skill.name} ${skill.description ?? ""} ${skill.github?.repoUrl ?? ""}`;
}
