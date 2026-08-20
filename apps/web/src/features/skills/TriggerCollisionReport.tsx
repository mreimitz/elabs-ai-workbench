import { useCallback, useEffect, useState } from "react";
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
  Spinner,
  Text,
  cn,
} from "@elabs-ai/components-ui";
import { AlertTriangle, CheckCircle2, ChevronDown, RefreshCw, ShieldAlert } from "lucide-react";
import { getErrorMessage } from "../../lib/errors";
import { getRegistryTriggerCollisions } from "./skills-inspector-api";
import { IconButton } from "../../components/IconButton";

/**
 * The registry-wide trigger-collision report (D-UX2 / K7). Reads the read-only
 * `GET /api/skills/trigger-collisions` report and scopes to the WHOLE registry (a cross-skill
 * concern, not a per-skill one). Collapsed it is a single status line; expanded it lists each
 * collision with deep-links into the involved skills. Refetches when the skill set changes.
 *
 * RM-32 WP 2.2 moved it out of the deleted `SkillRail` and onto the skills OVERVIEW (as the browser's
 * `footer`), with its behaviour unchanged. It must not drift into a single skill's inspector — a
 * fleet-level concern belonging to one member of the fleet is exactly the defect D-UX2 fixed.
 */
export function TriggerCollisionReport({ skills }: { skills: Skill[] }) {
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
