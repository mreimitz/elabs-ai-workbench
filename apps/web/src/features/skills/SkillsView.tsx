import type { Skill } from "@mcp-token-footprint/shared";
import { Button, StatePanel } from "@brand/ui";
import { Plus, Sparkles } from "lucide-react";
import { SkillInspector } from "./SkillInspector";

/**
 * The Skills view body (UI plan §2): the main pane beside the `SkillRail` (which App renders as the
 * shell's secondary content). It renders the WP 1.7 `SkillInspector` for the selected skill, or an
 * empty state prompting the user to register one. The rail + all CRUD/toast wiring live in `App`, so
 * this component stays a thin selector-driven renderer.
 *
 * D-UX2 (K7): the registry-wide trigger-collision report moved OUT of this detail pane to the
 * skills-LIST footer (`SkillRail`) — a fleet-level concern belongs with the whole registry, not inside
 * a single skill's detail. D-UX1 (K6): "New skill from server" is no longer a standalone detail-header
 * button — it is the 4th source tile in the Add-skill modal (the list "+" is the single create entry).
 */
export function SkillsView(props: {
  skills: Skill[];
  selectedSkillId: string | null;
  onAddSkill: () => void;
}) {
  const selectedSkill = props.skills.find((skill) => skill.id === props.selectedSkillId) ?? null;

  if (props.skills.length === 0) {
    return (
      <StatePanel
        kind="empty"
        icon={<Sparkles aria-hidden />}
        title="No skills yet"
        description="Register an Agent Skill from an uploaded archive, a GitHub repository, a blank scaffold, or a scanned server's tool surface."
        actions={
          <Button onClick={props.onAddSkill}>
            <Plus aria-hidden />
            <span>Add skill</span>
          </Button>
        }
      />
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {selectedSkill ? (
        // Keyed by skill id so switching skills fully remounts the inspector (fresh version/file state).
        <SkillInspector key={selectedSkill.id} skillId={selectedSkill.id} />
      ) : (
        <StatePanel
          kind="empty"
          icon={<Sparkles aria-hidden />}
          title="Select a skill"
          description="Pick a skill from the list to inspect its manifest, files, and token footprint."
        />
      )}
    </div>
  );
}
