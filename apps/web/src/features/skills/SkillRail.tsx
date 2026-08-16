import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { Skill, TriggerCollision } from "@mcp-token-footprint/shared";
import {
  Badge,
  Button,
  Card,
  cardVariants,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  EmptyState,
  Spinner,
  Text,
  cn,
} from "@brand/ui";
import { SearchInput } from "@brand/data";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  Download,
  Github,
  MoreHorizontal,
  Plus,
  RefreshCw,
  ShieldAlert,
  Trash2,
  Upload,
} from "lucide-react";
import { formatNumber } from "../../lib/format";
import { getErrorMessage } from "../../lib/errors";
import { getRegistryTriggerCollisions } from "./skills-inspector-api";
import { IconButton } from "../../components/IconButton";

/**
 * The secondary rail for the Skills view (mirrors `ServerRail`): a searchable list of registered
 * skills. Each row shows the display name, a source badge (GitHub / Upload), and the version count.
 * "Add skill" opens the wizard; a per-row menu offers Pull latest (GitHub only) + Delete. Purely
 * presentational — selection/mutation are lifted to `SkillsView`/`App`.
 *
 * D-UX2 (K7): the registry-wide trigger-collision status lives here, as an expandable footer under
 * the LIST (a cross-skill concern belongs with the whole registry, not inside a single skill's detail
 * pane). Collapsed it is a one-line status ("N skills · no collisions" / "N collisions"); expanded it
 * lists each collision with deep-links into the involved skills.
 */
export function SkillRail(props: {
  skills: Skill[];
  selectedSkillId: string | null;
  /** Per-action busy predicate keyed by `action:entity` (e.g. `skill:pull:<id>`). */
  isBusy: (key: string) => boolean;
  onAddSkill: () => void;
  onSelectSkill: (skillId: string) => void;
  onPullSkill: (skillId: string) => void;
  onDeleteSkill: (skill: Skill) => void;
}) {
  const [search, setSearch] = useState("");

  const sortedSkills = useMemo(
    () =>
      [...props.skills].sort((left, right) => left.displayName.localeCompare(right.displayName)),
    [props.skills],
  );
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return sortedSkills;
    return sortedSkills.filter((skill) => {
      const haystack =
        `${skill.displayName} ${skill.name} ${skill.description ?? ""}`.toLowerCase();
      return haystack.includes(q);
    });
  }, [sortedSkills, search]);

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 p-3">
      <div className="flex shrink-0 items-center justify-between gap-2">
        <div className="flex min-w-0 flex-col">
          <Text className="font-semibold leading-tight">Skills</Text>
          <Text variant="meta" tone="muted" className="tabular-nums">
            {filtered.length !== props.skills.length
              ? `${filtered.length} of ${props.skills.length}`
              : `${props.skills.length} registered`}
          </Text>
        </div>
        <IconButton size="icon-sm" variant="outline" label="Add skill" onClick={props.onAddSkill}>
          <Plus aria-hidden />
        </IconButton>
      </div>

      {props.skills.length > 0 ? (
        <div className="shrink-0">
          <SearchInput
            value={search}
            onValueChange={setSearch}
            placeholder="Search skills…"
            aria-label="Search skills"
          />
        </div>
      ) : null}

      {sortedSkills.length === 0 ? (
        <EmptyState
          title="No skills"
          description="Register an Agent Skill from an upload or a GitHub repository."
          actions={
            <Button onClick={props.onAddSkill}>
              <Plus aria-hidden />
              <span>Add skill</span>
            </Button>
          }
        />
      ) : filtered.length === 0 ? (
        <Text variant="meta" tone="muted" className="px-1">
          No skills match “{search}”.
        </Text>
      ) : (
        <ul className="flex min-h-0 min-w-0 flex-1 flex-col gap-0.5 overflow-y-auto">
          {filtered.map((skill) => {
            const active = props.selectedSkillId === skill.id;
            const isGithub = skill.sourceType === "github";
            const pullBusy = props.isBusy(`skill:pull:${skill.id}`);
            const versionLabel = `${formatNumber(skill.versionCount)} ${
              skill.versionCount === 1 ? "version" : "versions"
            }`;
            return (
              <li
                key={skill.id}
                aria-current={active ? "true" : undefined}
                className={cn(
                  "group relative flex min-w-0 items-center rounded-md transition-colors",
                  "hover:bg-accent/60",
                  active && "bg-accent",
                )}
              >
                <Button
                  variant="ghost"
                  className={cn(
                    // The row text fills the whole width; the actions menu is absolutely positioned so
                    // it never steals horizontal space from the name (K5 — "width to spare" truncation).
                    "h-auto min-w-0 flex-1 flex-col items-stretch gap-0.5 rounded-md py-1.5 pe-8 text-left hover:bg-transparent",
                    active && "hover:bg-transparent",
                  )}
                  onClick={() => props.onSelectSkill(skill.id)}
                >
                  <Text
                    title={skill.displayName}
                    className={cn("min-w-0 truncate font-medium", active && "text-primary")}
                  >
                    {skill.displayName}
                  </Text>
                  {/* One-line meta: source · version count (K5). */}
                  <span className="flex min-w-0 items-center gap-1.5 truncate">
                    {isGithub ? (
                      <Github aria-hidden className="size-3 shrink-0 text-muted-foreground" />
                    ) : (
                      <Upload aria-hidden className="size-3 shrink-0 text-muted-foreground" />
                    )}
                    <Text variant="meta" tone="muted" as="span" className="shrink-0">
                      {isGithub ? "GitHub" : "Upload"}
                    </Text>
                    <span className="text-muted-foreground/40" aria-hidden>
                      ·
                    </span>
                    <Text variant="meta" tone="muted" as="span" className="shrink-0 tabular-nums">
                      {versionLabel}
                    </Text>
                  </span>
                </Button>

                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <IconButton
                      size="icon-sm"
                      variant="ghost"
                      className="absolute end-1 top-1/2 shrink-0 -translate-y-1/2 opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100 group-aria-[current=true]:opacity-100 data-[state=open]:opacity-100"
                      label={`More actions for ${skill.displayName}`}
                    >
                      <MoreHorizontal aria-hidden />
                    </IconButton>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {isGithub ? (
                      <>
                        <DropdownMenuItem
                          disabled={pullBusy}
                          onSelect={() => props.onPullSkill(skill.id)}
                        >
                          <Download aria-hidden />
                          <span>Pull latest</span>
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                      </>
                    ) : null}
                    <DropdownMenuItem
                      className="text-destructive focus:text-destructive"
                      onSelect={() => props.onDeleteSkill(skill)}
                    >
                      <Trash2 aria-hidden />
                      <span>Delete</span>
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </li>
            );
          })}
        </ul>
      )}

      {props.skills.length > 0 ? <TriggerCollisionsFooter skills={props.skills} /> : null}
    </div>
  );
}

/**
 * The registry-wide trigger-collision status footer (D-UX2 / K7). Reads the read-only
 * `GET /api/skills/trigger-collisions` report and scopes to the WHOLE registry (a cross-skill
 * concern, not a per-skill one). Collapsed it is a single status line; expanded it lists each
 * collision with deep-links into the involved skills. Refetches when the skill set changes.
 */
function TriggerCollisionsFooter({ skills }: { skills: Skill[] }) {
  const navigate = useNavigate();
  const [collisions, setCollisions] = useState<TriggerCollision[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);

  const nameOf = useCallback(
    (skillId: string) => skills.find((skill) => skill.id === skillId)?.displayName ?? skillId,
    [skills],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setCollisions(await getRegistryTriggerCollisions());
    } catch (caught) {
      setError(getErrorMessage(caught, "Couldn’t check trigger collisions — try the refresh icon."));
    } finally {
      setLoading(false);
    }
  }, []);

  // Refetch whenever the set of skills changes (add/remove/reorder).
  const skillKey = skills.map((skill) => skill.id).join(",");
  useEffect(() => {
    void load();
  }, [load, skillKey]);

  const count = collisions?.length ?? 0;
  const hasCollisions = count > 0;
  const skillWord = skills.length === 1 ? "skill" : "skills";

  const statusLabel = error
    ? "Couldn’t check triggers"
    : collisions === null
      ? "Checking triggers…"
      : hasCollisions
        ? `${count} trigger ${count === 1 ? "collision" : "collisions"}`
        : `${skills.length} ${skillWord} · no collisions`;

  return (
    <Collapsible open={open} onOpenChange={setOpen} className={cn(cardVariants(), "shrink-0")}>
      <div className="flex items-center gap-1 pe-1">
        <CollapsibleTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="h-auto min-w-0 flex-1 justify-start gap-2 rounded-md px-2 py-1.5 text-left"
            aria-label="Trigger collisions"
          >
            {error ? (
              <AlertTriangle aria-hidden className="size-3.5 shrink-0 text-destructive" />
            ) : collisions === null ? (
              <Spinner className="size-3.5 shrink-0" />
            ) : hasCollisions ? (
              <ShieldAlert aria-hidden className="size-3.5 shrink-0 text-destructive" />
            ) : (
              <CheckCircle2 aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
            )}
            <Text variant="meta" tone="muted" as="span" className="min-w-0 flex-1 truncate">
              {statusLabel}
            </Text>
            {hasCollisions ? (
              <Badge variant="destructive" className="shrink-0 tabular-nums">
                {count}
              </Badge>
            ) : null}
            <ChevronDown
              aria-hidden
              className="size-4 shrink-0 text-muted-foreground transition-transform data-[state=open]:rotate-180 group-data-[state=open]:rotate-180"
            />
          </Button>
        </CollapsibleTrigger>
        <IconButton
          variant="ghost"
          size="icon-sm"
          className="shrink-0"
          onClick={() => void load()}
          disabled={loading}
          label="Re-check trigger collisions"
        >
          {loading ? <Spinner className="size-4" /> : <RefreshCw aria-hidden />}
        </IconButton>
      </div>
      <CollapsibleContent>
        <div className="border-t border-border p-2">
          {error ? (
            <Text variant="meta" tone="muted" className="break-words">
              {error}
            </Text>
          ) : collisions === null ? (
            <Text variant="meta" tone="muted">
              Checking the registry for shared triggers…
            </Text>
          ) : collisions.length === 0 ? (
            <Text variant="meta" tone="muted">
              No <span className="font-mono">/command</span> or keyword phrase is claimed by more
              than one skill.
            </Text>
          ) : (
            <ul className="flex max-h-56 flex-col gap-2 overflow-y-auto">
              {collisions.map((collision) => (
                <li key={`${collision.kind}:${collision.value}`}>
                  <Card className="flex flex-col gap-1 p-2">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <Badge variant={collision.kind === "command" ? "destructive" : "warning"}>
                        <AlertTriangle className="size-3" aria-hidden />
                        {collision.kind === "command" ? "Command" : "Keyword"}
                      </Badge>
                      <Text variant="meta" as="span" className="min-w-0 truncate font-mono">
                        {collision.value}
                      </Text>
                    </div>
                    <div className="flex flex-wrap items-center gap-x-1 gap-y-0.5">
                      <Text variant="meta" tone="muted" as="span">
                        claimed by
                      </Text>
                      {collision.skillIds.map((skillId, index) => (
                        <span key={skillId} className="flex items-center">
                          <Button
                            variant="link"
                            size="sm"
                            className="h-auto px-0"
                            onClick={() => navigate(`/skills/${skillId}`)}
                          >
                            {nameOf(skillId)}
                          </Button>
                          {index < collision.skillIds.length - 1 ? (
                            <span className="text-muted-foreground">,</span>
                          ) : null}
                        </span>
                      ))}
                    </div>
                  </Card>
                </li>
              ))}
            </ul>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
