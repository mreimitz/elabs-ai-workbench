import { Badge, Text } from "@brand/ui";
import { runChipLabel } from "../compare-runs";
import { RunLetterBadge } from "../RunLetterBadge";
import { skillSummary } from "./flow-derive";
import type { FlowLane } from "./flow-types";

/**
 * Skills lens summary (audit §H4) — per run, "was the skill worth its tokens": each loaded skill's
 * always-on footprint, whether it was eagerly inlined or disclosed on demand, how many times the run
 * actually opened it, and a plain "loaded but never used" flag when its tokens bought nothing. Renders
 * above the aligned lanes (which highlight the skill-disclosure steps) so the two read together.
 */
export function SkillsSummary({ lanes }: { lanes: FlowLane[] }) {
  const anySkills = lanes.some((lane) => lane.skills.length > 0);
  return (
    <div className="flex flex-col gap-2 rounded-md border border-border bg-muted/20 p-3">
      <Text variant="meta" className="font-semibold">
        Skills — worth their tokens?
      </Text>
      {!anySkills ? (
        <Text variant="caption" tone="muted">
          None of these runs loaded a skill — nothing to attribute. Attach a skill to the
          environment to compare its cost and use across runs.
        </Text>
      ) : (
        <div className="flex flex-col gap-2 sm:flex-row">
          {lanes.map((lane) => {
            const skills = skillSummary(lane);
            return (
              <div
                key={lane.letter}
                className="flex min-w-0 flex-1 flex-col gap-1.5 rounded border border-border bg-card p-2"
              >
                <div className="flex items-center gap-2">
                  <RunLetterBadge
                    letter={lane.letter}
                    color={lane.color}
                    baseline={lane.isBaseline}
                  />
                  <Text variant="caption" className="min-w-0 truncate font-medium">
                    {runChipLabel(lane.run)}
                  </Text>
                </div>
                {skills.length === 0 ? (
                  <Text variant="caption" tone="muted" className="italic">
                    No skills loaded
                  </Text>
                ) : (
                  skills.map((skill) => (
                    <div
                      key={skill.skillId}
                      className="flex flex-col gap-0.5 border-t border-border/60 pt-1.5 first:border-0 first:pt-0"
                    >
                      <div className="flex min-w-0 items-center gap-1.5">
                        <Text variant="caption" className="min-w-0 truncate font-medium">
                          {skill.name}
                        </Text>
                        <Badge variant="secondary">{skill.versionLabel}</Badge>
                        <Badge variant="outline">{skill.eager ? "eager" : "deferred"}</Badge>
                      </div>
                      <div className="flex flex-wrap items-center gap-1">
                        <Badge variant="secondary" className="tabular-nums">
                          {skill.footprintTokens.toLocaleString()} tok
                        </Badge>
                        <Badge variant="outline" className="tabular-nums">
                          {skill.disclosureReads} read{skill.disclosureReads === 1 ? "" : "s"}
                        </Badge>
                        {skill.unused ? (
                          <Badge variant="warning">loaded, never used</Badge>
                        ) : (
                          <Badge variant="success">used</Badge>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
