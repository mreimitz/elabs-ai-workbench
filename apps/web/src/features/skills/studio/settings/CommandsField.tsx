import { useState } from "react";
import { Badge, Button, Text, Tooltip, TooltipContent, TooltipTrigger } from "@elabs-ai/components-ui";
import { Pencil, Plus, Terminal, Trash2 } from "lucide-react";
import { IconButton } from "../../../../components/IconButton";
import { ConfirmDialog } from "../../../../components/dialogs";
import { CommandDialog } from "../../design/CommandDialog";
import type { StudioCommandEntry } from "../draft";

// ── Skill Studio (RM-30 WP 7.3, audit SI3) — the settings panel's COMMAND ENTRY POINTS field ──────
// A `/command` is not frontmatter: it is a section in the document, and the shared edit-op vocabulary
// already has `add_command` / `rename_command` / `delete_command` implemented end to end. So this
// field stages ops on the SAME draft the canvas does, rather than inventing a second way to write a
// command — the settings panel is one more way to reach the ops, not a second model of what a
// command is. The list itself is projected from the live graph (the projector is the authority).
//
// A command staged but not yet saved has no projected node id, so it cannot be renamed or deleted by
// id. The row says that out loud instead of offering a control that would 400.

export type CommandsFieldProps = {
  commands: StudioCommandEntry[];
  /** Existing `/command` tokens — the dialog refuses a duplicate before the server has to. */
  existingCommands: string[];
  onAdd: (input: { command: string; title?: string; body?: string }) => void;
  onRename: (nodeId: string, command: string) => void;
  onDelete: (nodeId: string) => void;
  /** A reason the field is read-only right now (an older version is open), or `null`. */
  blockedReason: string | null;
};

export function CommandsField({
  commands,
  existingCommands,
  onAdd,
  onRename,
  onDelete,
  blockedReason,
}: CommandsFieldProps) {
  const [addOpen, setAddOpen] = useState(false);
  const [renaming, setRenaming] = useState<StudioCommandEntry | null>(null);
  const [deleting, setDeleting] = useState<StudioCommandEntry | null>(null);
  const canManage = blockedReason === null;

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex flex-col gap-0.5">
        <Text variant="caption" tone="muted" className="font-medium">
          Command entry points
        </Text>
        <Text variant="meta" tone="muted" className="text-pretty">
          A <span className="font-mono">/command</span> the user types to enter this skill at a
          specific section. Changes are staged on the draft and save with everything else.
        </Text>
      </div>

      {commands.length === 0 ? (
        <Text variant="meta" tone="muted">
          No <span className="font-mono">/command</span> entry points — this skill triggers on
          keywords only.
        </Text>
      ) : (
        <ul className="flex flex-col gap-1">
          {commands.map((entry) => (
            <li
              key={entry.nodeId ?? `staged:${entry.command}`}
              className="flex min-w-0 items-center gap-1.5"
            >
              <Terminal className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
              <Badge variant="secondary" className="min-w-0 shrink-0 font-mono">
                {entry.command}
              </Badge>
              <Text variant="meta" tone="muted" className="min-w-0 flex-1 truncate">
                {entry.label}
              </Text>
              {entry.nodeId === null ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="inline-flex shrink-0">
                      <Badge variant="outline">New</Badge>
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>
                    Staged but not saved yet — save the draft before renaming or removing it.
                  </TooltipContent>
                </Tooltip>
              ) : (
                <>
                  <IconButton
                    variant="ghost"
                    size="icon-sm"
                    label={`Rename ${entry.command}`}
                    disabled={!canManage}
                    {...(blockedReason ? { disabledReason: blockedReason } : {})}
                    onClick={() => setRenaming(entry)}
                  >
                    <Pencil aria-hidden />
                  </IconButton>
                  <IconButton
                    variant="ghost"
                    size="icon-sm"
                    label={`Remove ${entry.command}`}
                    disabled={!canManage}
                    {...(blockedReason ? { disabledReason: blockedReason } : {})}
                    onClick={() => setDeleting(entry)}
                  >
                    <Trash2 aria-hidden />
                  </IconButton>
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="flex">
        <Button
          variant="outline"
          size="sm"
          disabled={!canManage}
          onClick={() => setAddOpen(true)}
          data-testid="settings-add-command"
        >
          <Plus aria-hidden />
          <span>Add command…</span>
        </Button>
      </div>

      <CommandDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        mode="add"
        existingCommands={existingCommands}
        onSubmit={({ command, title, body }) =>
          onAdd({ command, ...(title ? { title } : {}), ...(body ? { body } : {}) })
        }
      />

      <CommandDialog
        open={renaming !== null}
        onOpenChange={(open) => {
          if (!open) setRenaming(null);
        }}
        mode="rename"
        initialCommand={renaming?.command ?? ""}
        existingCommands={existingCommands.filter((token) => token !== renaming?.command)}
        onSubmit={({ command }) => {
          if (renaming?.nodeId) onRename(renaming.nodeId, command);
          setRenaming(null);
        }}
      />

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
        title={deleting ? `Remove ${deleting.command}?` : "Remove command"}
        description={
          deleting
            ? `Removes the “${deleting.command}” entry point and the flow it heads. Nothing is saved until you save the draft.`
            : undefined
        }
        confirmLabel="Remove command"
        tone="destructive"
        onConfirm={() => {
          if (deleting?.nodeId) onDelete(deleting.nodeId);
          setDeleting(null);
        }}
      />
    </div>
  );
}
