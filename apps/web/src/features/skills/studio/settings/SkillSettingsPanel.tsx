import { useCallback, useMemo } from "react";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Input,
  ScrollArea,
  TagInput,
  Text,
  Textarea,
} from "@elabs-ai/components-ui";
import { Info } from "lucide-react";
import { FieldRow } from "../../../../components/FieldRow";
import { useStudioDraft } from "../draft";
import { CommandsField } from "./CommandsField";
import { ServersField } from "./ServersField";

// ── Skill Studio (RM-30 WP 7.3, audit SI3/I3) — ONE settings panel ────────────────────────────────
// Every frontmatter concept a skill has — its name, its description, the servers it binds, the
// keywords that trigger it — plus its `/command` entry points, edited in one place, by a form, with
// the author never typing YAML. Before this the four lived in four places: name and description only
// in the raw document, keywords in a chip editor bolted onto the read-only Overview tab, servers in
// the Tools palette behind an immediate save, and commands behind a toolbar button on the canvas.
//
// Every field writes to the ONE Studio draft (`../draft.ts`), so:
//   • the Code view reflects a settings change immediately — it is literally the same text;
//   • there is ONE dirty flag and ONE "Save as vN" for all of them;
//   • nothing is persisted until that save, and the save produces ONE new immutable version.
//
// The two scalar fields read their value back out of the live document rather than holding a private
// copy. That is what makes the sync two-way for real: hand-edit `description:` in the Code pane and
// this field follows, because there is no second source of truth to drift.

export type SkillSettingsPanelProps = {
  skillId: string;
  versionId: string;
  /** True when the open version is the skill's head. An older version is authored read-only — a save
   *  from it would 409 against the moved head, so the panel says so instead of pretending. */
  isHeadVersion: boolean;
};

const NON_HEAD_REASON =
  "This is an older version — switch to the latest version to change its settings.";

export function SkillSettingsPanel({ skillId, versionId, isHeadVersion }: SkillSettingsPanelProps) {
  const draft = useStudioDraft();
  const { settings, stageSettingsEdit } = draft;
  const blockedReason = isHeadVersion ? null : NON_HEAD_REASON;

  const setName = useCallback(
    (value: string) => stageSettingsEdit({ field: "name", value }),
    [stageSettingsEdit],
  );
  const setDescription = useCallback(
    (value: string) => stageSettingsEdit({ field: "description", value }),
    [stageSettingsEdit],
  );

  // The chip editor hands back the WHOLE list; the draft speaks in add/remove of one value, which is
  // what keeps the splice byte-preserving. Diffing here is the translation between the two.
  const keywords = settings.keywords;
  const setKeywords = useCallback(
    (next: string[]) => {
      for (const value of next) {
        if (!keywords.includes(value)) stageSettingsEdit({ field: "keywords", action: "add", value });
      }
      for (const value of keywords) {
        if (!next.includes(value)) {
          stageSettingsEdit({ field: "keywords", action: "remove", value });
        }
      }
    },
    [keywords, stageSettingsEdit],
  );

  const bindServer = useCallback(
    (name: string) => stageSettingsEdit({ field: "servers", action: "bind", name }),
    [stageSettingsEdit],
  );
  const unbindServer = useCallback(
    (name: string) => stageSettingsEdit({ field: "servers", action: "unbind", name }),
    [stageSettingsEdit],
  );

  const addOp = draft.edit.addOp;
  const addCommand = useCallback(
    (input: { command: string; title?: string; body?: string }) =>
      addOp({ op: "add_command", ...input }),
    [addOp],
  );
  const renameCommand = useCallback(
    (nodeId: string, command: string) => addOp({ op: "rename_command", nodeId, command }),
    [addOp],
  );
  const deleteCommand = useCallback(
    (nodeId: string) => addOp({ op: "delete_command", nodeId }),
    [addOp],
  );

  const commandTokens = useMemo(
    () => draft.commands.map((entry) => entry.command),
    [draft.commands],
  );

  const readOnly = !isHeadVersion;

  return (
    <ScrollArea className="min-h-0 flex-1">
      <div className="flex flex-col gap-5 p-3" data-testid="studio-settings">
        {readOnly ? (
          <Alert variant="warning">
            <Info />
            <AlertTitle>Read-only</AlertTitle>
            <AlertDescription>{NON_HEAD_REASON}</AlertDescription>
          </Alert>
        ) : null}

        <FieldRow id="studio-settings-name" label="Name">
          <Input
            id="studio-settings-name"
            value={settings.name ?? ""}
            disabled={readOnly || !settings.nameEditable}
            spellCheck={false}
            autoComplete="off"
            placeholder="my-skill…"
            onChange={(event) => setName(event.target.value)}
          />
          <Text variant="meta" tone="muted" className="text-pretty">
            {settings.nameEditable
              ? "The skill’s own name in its frontmatter. Lowercase letters, digits and single hyphens; it should match the skill’s folder name."
              : "This skill’s name: is written in a YAML shape this editor won’t rewrite — edit it in the Code view."}
          </Text>
        </FieldRow>

        <FieldRow id="studio-settings-description" label="Description">
          <Textarea
            id="studio-settings-description"
            value={settings.description ?? ""}
            disabled={readOnly || !settings.descriptionEditable}
            rows={4}
            placeholder="What this skill does, and when a model should reach for it…"
            onChange={(event) => setDescription(event.target.value)}
          />
          <Text variant="meta" tone="muted" className="text-pretty">
            {settings.descriptionEditable
              ? "The one thing a model reads before deciding to load this skill — it is the whole of level 1."
              : "This skill’s description: is a block scalar or a list, which this editor won’t rewrite — edit it in the Code view."}
          </Text>
        </FieldRow>

        <ServersField
          skillId={skillId}
          versionId={versionId}
          declaredServers={settings.servers}
          onBind={bindServer}
          onUnbind={unbindServer}
          blockedReason={blockedReason}
        />

        <div className="flex min-w-0 flex-col gap-2">
          <div className="flex flex-col gap-0.5">
            <Text variant="caption" tone="muted" className="font-medium">
              Trigger keywords
            </Text>
            <Text variant="meta" tone="muted" className="text-pretty">
              Natural-language phrases that make a model reach for this skill. They are written to the
              frontmatter <span className="font-mono">keywords</span> list.
            </Text>
          </div>
          <TagInput
            value={keywords}
            onValueChange={setKeywords}
            disabled={readOnly}
            placeholder="Add a keyword phrase…"
            aria-label="Trigger keywords"
          />
        </div>

        <CommandsField
          commands={draft.commands}
          existingCommands={commandTokens}
          onAdd={addCommand}
          onRename={renameCommand}
          onDelete={deleteCommand}
          blockedReason={blockedReason}
        />
      </div>
    </ScrollArea>
  );
}
