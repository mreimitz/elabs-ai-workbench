import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import type { Skill } from "@mcp-token-footprint/shared";
import { Badge, Text } from "@elabs-ai/components-ui";
import { Github, Upload } from "lucide-react";
import {
  BreadcrumbEntitySwitcher,
  type BreadcrumbSwitcherGroup,
} from "../../components/BreadcrumbEntitySwitcher";
import { formatNumber } from "../../lib/format";
import { SKILL_SOURCE_LABELS } from "./skill-groups";

/**
 * The skill inspector's breadcrumb leaf (RM-32 D-OD5): `Home › Skills › [my-skill ▾]`. Grouped by
 * source, exactly as the overview is, so the popover and the page it came from agree.
 */
export function SkillBreadcrumbSwitcher(props: {
  skills: Skill[];
  activeSkill: Skill | null;
  onCreate: () => void;
}) {
  const navigate = useNavigate();

  const groups = useMemo<BreadcrumbSwitcherGroup[]>(() => {
    const sorted = [...props.skills].sort((left, right) =>
      left.displayName.localeCompare(right.displayName),
    );
    const rowOf = (skill: Skill) => ({
      id: skill.id,
      label: skill.displayName,
      badge: <SourceBadge sourceType={skill.sourceType} />,
      meta: (
        <Text variant="meta" tone="muted" className="min-w-0 truncate tabular-nums">
          {formatNumber(skill.versionCount)}{" "}
          {skill.versionCount === 1 ? "version" : "versions"}
        </Text>
      ),
    });

    const result: BreadcrumbSwitcherGroup[] = [];
    for (const source of ["github", "upload"] as const) {
      const members = sorted.filter((skill) => skill.sourceType === source);
      if (members.length === 0) continue;
      result.push({ key: source, label: SKILL_SOURCE_LABELS[source], items: members.map(rowOf) });
    }
    // One source in use is not a grouping — render it flat rather than under a lone header.
    if (result.length === 1) {
      return [{ key: "all", label: "", items: sorted.map(rowOf) }];
    }
    return result;
  }, [props.skills]);

  return (
    <BreadcrumbEntitySwitcher
      groups={groups}
      activeId={props.activeSkill?.id ?? null}
      switchLabel="Switch skill"
      noun={["skill", "skills"]}
      onSelect={(id) => navigate(`/skills/${id}`)}
      onCreate={props.onCreate}
      createLabel="New skill"
      onViewAll={() => navigate("/skills")}
      {...(props.activeSkill ? { triggerLabel: props.activeSkill.displayName } : {})}
      {...(props.activeSkill
        ? { triggerBadge: <SourceBadge sourceType={props.activeSkill.sourceType} /> }
        : {})}
    />
  );
}

function SourceBadge({ sourceType }: { sourceType: Skill["sourceType"] }) {
  return (
    <Badge variant="outline" className="shrink-0 gap-1">
      {sourceType === "github" ? (
        <Github aria-hidden className="size-3" />
      ) : (
        <Upload aria-hidden className="size-3" />
      )}
      <span>{SKILL_SOURCE_LABELS[sourceType]}</span>
    </Badge>
  );
}
