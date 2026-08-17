import { useEffect, useState } from "react";
import type {
  ReviewRubric,
  ReviewRubricKeyDef,
  ReviewRubricKeyKind,
} from "@mcp-token-footprint/shared";
import {
  Button,
  Card,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Text,
  Textarea,
  toast,
} from "@elabs-ai/components-ui";
import { Plus, Trash2 } from "lucide-react";
import { FormDialog } from "../../components/dialogs/FormDialog";
import { DialogSection } from "../../components/dialogs/DialogSection";
import { FieldRow } from "../../components/FieldRow";
import { IconButton } from "../../components/IconButton";
import { DiscardChangesDialog, useUnsavedChangesGuard } from "../../components/UnsavedChangesGuard";
import { createReviewRubric, updateReviewRubric } from "../../lib/api";
import { getErrorMessage } from "../../lib/errors";
import { notifyError } from "../../lib/notify";

export type RubricEditorMode = "create" | "edit";

const KIND_LABELS: Record<ReviewRubricKeyKind, string> = {
  thumbs: "Thumbs up/down",
  scale5: "Scale 1–5",
  note: "Note only",
};

type DraftKey = ReviewRubricKeyDef & { rowId: string };

function newRowId(): string {
  return Math.random().toString(36).slice(2);
}

function emptyKey(): DraftKey {
  return { rowId: newRowId(), key: "", kind: "thumbs" };
}

function toDraftKeys(keys: ReviewRubricKeyDef[]): DraftKey[] {
  return keys.length > 0 ? keys.map((k) => ({ ...k, rowId: newRowId() })) : [emptyKey()];
}

/** Stable serialization of the editable fields (rowId excluded) for the dirty check. */
function serializeDraft(name: string, instructions: string, keys: DraftKey[]): string {
  return JSON.stringify({
    name,
    instructions,
    keys: keys.map(({ rowId: _rowId, ...rest }) => rest),
  });
}

/**
 * Create/edit a review rubric (Observability WP4.5, D-OB22) — a persisted, named checklist of keys
 * (each thumbs/scale5/note). Mirrors the `FormDialog` (Tier 2) list/manage pattern used across the app
 * (e.g. `WatchRulesView`'s `RuleEditorDialog`); the dynamic key rows compose `@elabs-ai/components-ui` primitives
 * directly (Input/Select/Textarea + Trash2/Plus), the SAME building blocks `ListEditor` uses, just for
 * a 3-field row instead of a bare string.
 */
export function RubricEditorDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: RubricEditorMode;
  rubric: ReviewRubric | null;
  onSaved: (rubric: ReviewRubric) => void;
}) {
  const { open, onOpenChange, mode, rubric, onSaved } = props;
  const [name, setName] = useState("");
  const [instructions, setInstructions] = useState("");
  const [keys, setKeys] = useState<DraftKey[]>([emptyKey()]);
  const [saving, setSaving] = useState(false);
  // A snapshot of the editable fields at open, for the dirty check (interaction-guidelines: warn
  // before discarding typed input — Escape/overlay/Cancel on a dirty rubric now confirms first).
  const [baseline, setBaseline] = useState("");

  useEffect(() => {
    if (!open) return;
    const nextName = rubric?.name ?? "";
    const nextInstructions = rubric?.instructions ?? "";
    const nextKeys = toDraftKeys(rubric?.keys ?? []);
    setName(nextName);
    setInstructions(nextInstructions);
    setKeys(nextKeys);
    setBaseline(serializeDraft(nextName, nextInstructions, nextKeys));
  }, [open, rubric]);

  const dirty = serializeDraft(name, instructions, keys) !== baseline;
  // A successful save closes via the prop `onOpenChange` DIRECTLY (bypasses the guard); a
  // user-initiated close (Escape, overlay, Cancel/X) routes through `requestOpenChange`.
  const guard = useUnsavedChangesGuard(dirty, onOpenChange);

  const updateKey = (rowId: string, patch: Partial<ReviewRubricKeyDef>) =>
    setKeys((current) => current.map((k) => (k.rowId === rowId ? { ...k, ...patch } : k)));
  const removeKey = (rowId: string) =>
    setKeys((current) => current.filter((k) => k.rowId !== rowId));
  const addKey = () => setKeys((current) => [...current, emptyKey()]);

  const trimmedName = name.trim();
  const cleanedKeys = keys
    .map((k) => ({ ...k, key: k.key.trim(), description: k.description?.trim() }))
    .filter((k) => k.key.length > 0);
  const submitDisabled = trimmedName.length === 0 || cleanedKeys.length === 0;

  async function submit() {
    setSaving(true);
    try {
      const payload = {
        name: trimmedName,
        instructions: instructions.trim().length > 0 ? instructions.trim() : undefined,
        keys: cleanedKeys.map(({ rowId: _rowId, ...rest }) => ({
          key: rest.key,
          kind: rest.kind,
          ...(rest.description && rest.description.length > 0
            ? { description: rest.description }
            : {}),
        })),
      };
      const saved =
        mode === "edit" && rubric
          ? await updateReviewRubric(rubric.id, payload)
          : await createReviewRubric(payload);
      toast.success(mode === "edit" ? `Updated "${saved.name}"` : `Created "${saved.name}"`);
      onOpenChange(false);
      onSaved(saved);
    } catch (error) {
      notifyError(
        mode === "edit"
          ? "Couldn’t update the rubric. Try again."
          : "Couldn’t create the rubric. Try again.",
        { description: getErrorMessage(error) },
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <FormDialog
        open={open}
        onOpenChange={guard.requestOpenChange}
        title={mode === "edit" ? "Edit rubric" : "New review rubric"}
        description="A checklist a reviewer walks for every run — each key becomes one question."
        primaryLabel={mode === "edit" ? "Save rubric" : "Create rubric"}
        busy={saving}
        submitDisabled={submitDisabled}
        onSubmit={() => void submit()}
      >
        <FieldRow id="rubric-name" label="Name">
          <Input
            id="rubric-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="e.g. Answer quality…"
            spellCheck={false}
            autoComplete="off"
            autoFocus
          />
        </FieldRow>

        <FieldRow id="rubric-instructions" label="Instructions (optional)">
          <Textarea
            id="rubric-instructions"
            value={instructions}
            onChange={(event) => setInstructions(event.target.value)}
            placeholder="What should a reviewer look for…"
            rows={2}
            spellCheck
          />
        </FieldRow>

        <DialogSection
          title="Keys"
          description="One row per question; each becomes a run_feedback key a reviewer answers."
          actions={
            <Button type="button" variant="outline" size="sm" onClick={addKey}>
              <Plus aria-hidden />
              <span>Add key</span>
            </Button>
          }
        >
          <ul className="flex flex-col gap-3">
            {keys.map((row, index) => (
              <li key={row.rowId}>
                <Card className="flex flex-col gap-2 p-3">
                  <div className="flex items-start gap-2">
                    <Input
                      value={row.key}
                      onChange={(event) => updateKey(row.rowId, { key: event.target.value })}
                      placeholder="key name, e.g. helpful…"
                      spellCheck={false}
                      autoComplete="off"
                      aria-label={`Key ${index + 1} name`}
                      className="min-w-0 flex-1"
                    />
                    <Select
                      value={row.kind}
                      onValueChange={(value) =>
                        updateKey(row.rowId, { kind: value as ReviewRubricKeyKind })
                      }
                    >
                      <SelectTrigger aria-label={`Key ${index + 1} kind`} className="w-44 shrink-0">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {(Object.keys(KIND_LABELS) as ReviewRubricKeyKind[]).map((kind) => (
                          <SelectItem key={kind} value={kind}>
                            {KIND_LABELS[kind]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <IconButton
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => removeKey(row.rowId)}
                      label={`Remove key ${index + 1}`}
                      className="shrink-0"
                    >
                      <Trash2 aria-hidden />
                    </IconButton>
                  </div>
                  <Input
                    value={row.description ?? ""}
                    onChange={(event) => updateKey(row.rowId, { description: event.target.value })}
                    placeholder="Description shown to the reviewer (optional)…"
                    spellCheck
                    autoComplete="off"
                    aria-label={`Key ${index + 1} description`}
                  />
                </Card>
              </li>
            ))}
          </ul>
          {cleanedKeys.length === 0 ? (
            <Text variant="meta" tone="muted" role="alert">
              At least one key with a name is required.
            </Text>
          ) : null}
        </DialogSection>
      </FormDialog>
      <DiscardChangesDialog
        open={guard.confirming}
        onConfirm={guard.confirmDiscard}
        onCancel={guard.cancelDiscard}
      />
    </>
  );
}
