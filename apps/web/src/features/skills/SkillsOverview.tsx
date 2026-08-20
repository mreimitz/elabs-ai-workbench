import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import type { Skill } from "@mcp-token-footprint/shared";
import {
  Badge,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  EmptyState,
  Heading,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Text,
} from "@elabs-ai/components-ui";
import { SearchInput } from "@elabs-ai/components-data";
import { Download, Github, MoreHorizontal, Plus, Sparkles, Trash2, Upload } from "lucide-react";
import { PageShell } from "../../components/PageShell";
import { ViewToolbar } from "../../components/ViewToolbar";
import { ResultCount } from "../../components/ResultCount";
import { IconButton } from "../../components/IconButton";
import {
  EntityBrowser,
  EntityCard,
  ViewModeToggle,
  useEntityBrowserState,
} from "../../components/entity-browser";
import { col } from "../../lib/table";
import { formatNumber, formatRelativeTime } from "../../lib/format";
import { TriggerCollisionReport } from "./TriggerCollisionReport";
import { SKILL_SOURCE_LABELS, skillSearchText, skillSourceGroupBy } from "./skill-groups";

/**
 * The Skills OVERVIEW (planning/Roadmap/RM-32-overview-detail, D-OD1) — the registry as a grouped
 * card grid (or table), replacing the 288px `SkillRail`. `/skills` renders this on a cold load
 * instead of redirecting to whichever skill sorted first; opening one drills into
 * `/skills/:skillId`, where the breadcrumb leaf switches skills.
 *
 * The registry-wide trigger-collision report comes along from the rail's footer (D-UX2 / K7): it is
 * a CROSS-skill concern, so the whole-registry page is its correct home — never a single skill's
 * inspector.
 */
export function SkillsOverview(props: {
  skills: Skill[];
  /** Per-action busy predicate keyed by `action:entity` (e.g. `skill:pull:<id>`). */
  isBusy: (key: string) => boolean;
  onAddSkill: () => void;
  onPullSkill: (skillId: string) => void;
  onDeleteSkill: (skill: Skill) => void;
}) {
  const navigate = useNavigate();

  const sorted = useMemo(
    () => [...props.skills].sort((left, right) => left.displayName.localeCompare(right.displayName)),
    [props.skills],
  );

  const groupBys = useMemo(() => [skillSourceGroupBy()], []);
  const state = useEntityBrowserState<Skill>({ storageKey: "skills", groupBys });

  const columns = useMemo(
    () => [
      col<Skill>({ id: "name", header: "Name", value: (skill) => skill.displayName }),
      col<Skill>({
        id: "source",
        header: "Source",
        value: (skill) => SKILL_SOURCE_LABELS[skill.sourceType],
      }),
      col<Skill>({
        id: "versions",
        header: "Versions",
        numeric: true,
        value: (skill) => skill.versionCount,
      }),
      col<Skill>({ id: "description", header: "Description", value: (skill) => skill.description ?? "—" }),
      col<Skill>({
        id: "repo",
        header: "Repository",
        value: (skill) => (skill.github ? `${skill.github.repoUrl}#${skill.github.ref}` : "—"),
        cell: (skill) =>
          skill.github ? (
            <span className="block min-w-0 truncate font-mono" title={skill.github.repoUrl}>
              {skill.github.repoUrl}
            </span>
          ) : (
            "—"
          ),
      }),
      col<Skill>({
        id: "updated",
        header: "Updated",
        value: (skill) => skill.updatedAt,
        cell: (skill) => formatRelativeTime(skill.updatedAt),
      }),
    ],
    [],
  );

  return (
    <PageShell
      width="full"
      headerVariant="toolbar"
      header={
        <ViewToolbar
          info={
            props.skills.length > 0 ? (
              <p className="max-w-xs text-pretty">
                Every registered Agent Skill. Open one to read its manifest, measure its L1/L2/L3
                token footprint, inspect its files and compare versions.
              </p>
            ) : undefined
          }
          left={
            props.skills.length > 0 ? (
              <>
                <div className="w-56 min-w-[10rem]">
                  <SearchInput
                    value={state.search}
                    onValueChange={state.setSearch}
                    placeholder="Search skills…"
                    label="Search skills"
                  />
                </div>
                <Select value={state.groupById} onValueChange={state.setGroupById}>
                  <SelectTrigger aria-label="Group skills by" className="w-40">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {state.groupByOptions.map((option) => (
                      <SelectItem key={option.id} value={option.id}>
                        {option.label === "None" ? "No grouping" : `Group by ${option.label}`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </>
            ) : undefined
          }
          results={
            props.skills.length > 0 ? (
              <ResultCount>
                {props.skills.length} {props.skills.length === 1 ? "skill" : "skills"}
              </ResultCount>
            ) : undefined
          }
          actions={
            <>
              {props.skills.length > 0 ? (
                <ViewModeToggle value={state.viewMode} onChange={state.setViewMode} />
              ) : null}
              <Button onClick={props.onAddSkill}>
                <Plus aria-hidden />
                <span>Add skill</span>
              </Button>
            </>
          }
        />
      }
    >
      <Heading level={1} className="sr-only">
        Skills
      </Heading>

      <EntityBrowser<Skill>
        state={state}
        items={sorted}
        itemKey={(skill) => skill.id}
        searchText={skillSearchText}
        noun={["skill", "skills"]}
        columns={columns}
        onOpen={(skill) => navigate(`/skills/${skill.id}`)}
        rowLabel={(skill) => skill.displayName}
        footer={props.skills.length > 0 ? <TriggerCollisionReport skills={props.skills} /> : null}
        renderCard={(skill, hints) => (
          <SkillOverviewCard
            skill={skill}
            pullBusy={props.isBusy(`skill:pull:${skill.id}`)}
            virtualizeHint={hints.virtualizeHint}
            onOpen={() => navigate(`/skills/${skill.id}`)}
            onPull={() => props.onPullSkill(skill.id)}
            onDelete={() => props.onDeleteSkill(skill)}
          />
        )}
        empty={
          <EmptyState
            icon={<Sparkles aria-hidden />}
            title="No skills yet"
            description="Register an Agent Skill from an uploaded archive, a GitHub repository, a blank scaffold, or a scanned server’s tool surface."
            actions={
              <Button onClick={props.onAddSkill}>
                <Plus aria-hidden />
                <span>Add skill</span>
              </Button>
            }
          />
        }
      />
    </PageShell>
  );
}

function SkillOverviewCard(props: {
  skill: Skill;
  pullBusy: boolean;
  virtualizeHint: boolean;
  onOpen: () => void;
  onPull: () => void;
  onDelete: () => void;
}) {
  const { skill } = props;
  const isGithub = skill.sourceType === "github";
  const versionLabel = `${formatNumber(skill.versionCount)} ${
    skill.versionCount === 1 ? "version" : "versions"
  }`;

  return (
    <EntityCard
      title={skill.displayName}
      href={`/skills/${skill.id}`}
      onOpen={props.onOpen}
      virtualizeHint={props.virtualizeHint}
      badges={
        <>
          <Badge variant="outline" className="gap-1">
            {isGithub ? (
              <Github aria-hidden className="size-3" />
            ) : (
              <Upload aria-hidden className="size-3" />
            )}
            <span>{SKILL_SOURCE_LABELS[skill.sourceType]}</span>
          </Badge>
          <Text variant="meta" tone="muted" className="tabular-nums">
            {versionLabel}
          </Text>
        </>
      }
      {...(skill.description ? { description: skill.description } : {})}
      metrics={
        <Text variant="meta" tone="muted">
          Updated {formatRelativeTime(skill.updatedAt)}
        </Text>
      }
      {...(skill.github
        ? {
            meta: (
              <Text
                variant="meta"
                tone="muted"
                className="min-w-0 truncate font-mono"
                title={`${skill.github.repoUrl} @ ${skill.github.ref}`}
              >
                {skill.github.repoUrl} @ {skill.github.ref}
              </Text>
            ),
          }
        : {})}
      actions={
        <>
          {isGithub ? (
            <IconButton
              size="icon-sm"
              variant="ghost"
              label={`Pull latest for ${skill.displayName}`}
              disabled={props.pullBusy}
              disabledReason="A pull is already running for this skill."
              onClick={props.onPull}
            >
              <Download aria-hidden />
            </IconButton>
          ) : null}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <IconButton
                size="icon-sm"
                variant="ghost"
                label={`More actions for ${skill.displayName}`}
              >
                <MoreHorizontal aria-hidden />
              </IconButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {isGithub ? (
                <>
                  <DropdownMenuItem disabled={props.pullBusy} onSelect={props.onPull}>
                    <Download aria-hidden />
                    <span>Pull latest</span>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                </>
              ) : null}
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                onSelect={props.onDelete}
              >
                <Trash2 aria-hidden />
                <span>Delete</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </>
      }
    />
  );
}
