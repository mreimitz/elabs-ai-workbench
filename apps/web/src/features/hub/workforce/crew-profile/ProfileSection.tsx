import type { HubCrewColor } from "@mcp-token-footprint/shared";
import { Input, Label, Textarea } from "@elabs-ai/components-ui";
import { DialogSection } from "../../../../components/dialogs";
import { FieldRow } from "../../../../components/FieldRow";
import { IconPicker } from "../../agents/IconPicker";
import { CrewColorPicker } from "./CrewColorPicker";

/**
 * Assistant Hub UX WP2.4 (D-HUX6) — the crew profile modal's Profile section: name, description, an
 * avatar icon, and the color picker over the five `--chart-1…5` tokens (D-HUX8). The crew's IDENTITY
 * fields — everything else (Members/Topology/Budgets/Memory/Usage) hangs off this name in the rest of
 * the modal, mirroring how the agent profile's Profile section anchors that identity too.
 */
export function ProfileSection({
  crewId,
  name,
  description,
  color,
  icon,
  onNameChange,
  onDescriptionChange,
  onColorChange,
  onIconChange,
  nameError,
  disabled,
}: {
  crewId: string;
  name: string;
  description: string;
  color: HubCrewColor | null;
  icon: string;
  onNameChange: (next: string) => void;
  onDescriptionChange: (next: string) => void;
  onColorChange: (next: HubCrewColor | null) => void;
  onIconChange: (next: string) => void;
  nameError?: string;
  disabled?: boolean;
}) {
  return (
    <DialogSection title="Profile" description="The crew's identity — name, description, icon, and accent color.">
      <FieldRow id="crew-profile-name" label="Name" error={nameError}>
        <Input
          id="crew-profile-name"
          value={name}
          onChange={(event) => onNameChange(event.target.value)}
          placeholder="e.g. Research Team…"
          aria-invalid={!!nameError}
          autoComplete="off"
          disabled={disabled}
        />
      </FieldRow>

      <FieldRow id="crew-profile-description" label="Description">
        <Textarea
          id="crew-profile-description"
          value={description}
          onChange={(event) => onDescriptionChange(event.target.value)}
          placeholder="What this team is for…"
          rows={2}
          disabled={disabled}
        />
      </FieldRow>

      <FieldRow id="crew-profile-icon" label="Icon (optional)">
        <IconPicker
          id="crew-profile-icon"
          value={icon}
          onChange={onIconChange}
          previewId={crewId}
          disabled={disabled}
        />
      </FieldRow>

      <div className="flex flex-col gap-1.5">
        <Label>Crew color</Label>
        <CrewColorPicker value={color} onChange={onColorChange} disabled={disabled} />
      </div>
    </DialogSection>
  );
}
