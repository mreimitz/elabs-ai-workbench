import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import type { Skill } from "@mcp-token-footprint/shared";
import { Button, StatePanel } from "@elabs-ai/components-ui";
import { SkillInspector } from "./SkillInspector";
import { SkillBreadcrumbSwitcher } from "./SkillBreadcrumbSwitcher";
import { useSetBreadcrumbSlot } from "../../components/breadcrumb-slot";

/**
 * The Skills DETAIL route (`/skills/:skillId`) — the WP 1.7 `SkillInspector` for one skill, at the
 * full width of the window.
 *
 * RM-32 WP 2.2 changed two things here. The 288px `SkillRail` is gone: switching skills is the
 * breadcrumb-leaf popover this component contributes (D-OD5). And with the "redirect to the first
 * skill" effect deleted (D-OD1), an unresolved id now means exactly ONE thing — the URL names a skill
 * that isn't in the registry — so it says that rather than the old "select a skill" prompt, which
 * described a state this route can no longer be in. The registry itself lives on `SkillsOverview`.
 */
export function SkillsView(props: {
  skills: Skill[];
  selectedSkillId: string | null;
  onAddSkill: () => void;
}) {
  const navigate = useNavigate();
  const selectedSkill = props.skills.find((skill) => skill.id === props.selectedSkillId) ?? null;

  // Memoized per `breadcrumb-slot.tsx`'s contract — an unmemoized node re-fires the slot effect on
  // every render.
  const breadcrumbSwitcher = useMemo(
    () => (
      <SkillBreadcrumbSwitcher
        skills={props.skills}
        activeSkill={selectedSkill}
        onCreate={props.onAddSkill}
      />
    ),
    [props.skills, selectedSkill, props.onAddSkill],
  );
  useSetBreadcrumbSlot(breadcrumbSwitcher);

  if (!selectedSkill) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="w-full max-w-md">
          <StatePanel
            kind="error"
            title="Skill not found"
            description="This skill isn’t in the registry — it may have been deleted, or the address may be mistyped."
            actions={
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="outline" onClick={() => navigate("/skills")}>
                  All skills
                </Button>
                <Button onClick={props.onAddSkill}>Add skill</Button>
              </div>
            }
          />
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Keyed by skill id so switching skills fully remounts the inspector (fresh version/file state). */}
      <SkillInspector key={selectedSkill.id} skillId={selectedSkill.id} />
    </div>
  );
}
