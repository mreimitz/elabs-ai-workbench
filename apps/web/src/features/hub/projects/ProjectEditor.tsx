import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import type { HubProject } from "@mcp-token-footprint/shared";
import { HUB_PROJECT_NAME_MAX_LENGTH } from "@mcp-token-footprint/shared";
import {
  Badge,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Heading,
  Input,
  Spinner,
  Text,
  Textarea,
  cn,
} from "@elabs-ai/components-ui";
import { Folder, MoreHorizontal, Pencil, Save, Trash2, Undo2 } from "lucide-react";
import { ConfirmDialog } from "../../../components/dialogs";
import { IconButton } from "../../../components/IconButton";
import { getErrorMessage } from "../../../lib/errors";
import { ScopedMemoryList } from "../memory/ScopedMemoryList";
import { EditorSection } from "./EditorSection";
import { PinnedFilesEditor } from "./PinnedFilesEditor";
import { notifyError } from "../../../lib/notify";

export type ProjectFormValue = {
  name: string;
  description: string;
  instructions: string;
};

function formFromProject(project: HubProject | null): ProjectFormValue {
  return {
    name: project?.name ?? "",
    description: project?.description ?? "",
    instructions: project?.instructions ?? "",
  };
}

/** Trimmed view of the form for DIRTY comparison only (the textarea keeps what the user typed).
 *  WHY: saves go over the wire trimmed, so a whitespace-only edit would round-trip to a no-op —
 *  comparing trimmed values keeps Save honestly disabled for it, and lets the form settle back to
 *  clean after a save even though the untrimmed draft still sits in the textarea. */
function normalize(value: ProjectFormValue): ProjectFormValue {
  return {
    name: value.name.trim(),
    description: value.description.trim(),
    instructions: value.instructions.trim(),
  };
}

type ProjectFieldKey = "name";
type FieldErrors = Partial<Record<ProjectFieldKey, string>>;

function validate(value: ProjectFormValue): FieldErrors {
  const errors: FieldErrors = {};
  if (!value.name.trim()) errors.name = "Name is required.";
  else if (value.name.length > HUB_PROJECT_NAME_MAX_LENGTH) {
    errors.name = `Name must be ${HUB_PROJECT_NAME_MAX_LENGTH} characters or fewer.`;
  }
  return errors;
}

/** Date-only for the header meta line — `formatDateTime`'s time-of-day belongs in tables/audit
 *  trails; here it would push "Created · Updated · sessions" onto two lines for no added meaning. */
function formatDateOnly(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? "n/a"
    : new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(date);
}

/**
 * ui-wave U6 (owner feedback) — the project name as a click-to-edit heading, replacing the permanent
 * "Name" form input the owner called a dry form. Display mode is a real `<h2>` (+ pencil); edit mode
 * is a transient input that commits on Enter/blur and reverts on Escape. A commit that is empty or
 * unchanged silently reverts — inline rename must never park the form in an invalid "name required"
 * state the way a persistent input could. Commits land in the FORM (dirty → Save), not the API, so
 * rename rides the same save/discard/Cmd-S machinery as every other field.
 */
function ProjectTitle(props: { name: string; onCommit: (name: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(props.name);
  // Escape must win over the blur it causes — flag it so the blur handler reverts instead of
  // committing the abandoned draft.
  const cancelledRef = useRef(false);

  if (!editing) {
    return (
      <div className="flex min-w-0 items-center gap-1">
        <Heading level={2} size="title" className="min-w-0 truncate" title={props.name}>
          {props.name}
        </Heading>
        <IconButton
          type="button"
          variant="ghost"
          size="icon-sm"
          label="Rename project"
          className="shrink-0 text-muted-foreground"
          onClick={() => {
            setDraft(props.name);
            cancelledRef.current = false;
            setEditing(true);
          }}
        >
          <Pencil aria-hidden className="size-4" />
        </IconButton>
      </div>
    );
  }

  return (
    <Input
      aria-label="Project name"
      value={draft}
      // The input only exists because the user just clicked "rename" — focus is the expected state.
      autoFocus
      maxLength={HUB_PROJECT_NAME_MAX_LENGTH}
      autoComplete="off"
      className="h-9 w-full max-w-md font-semibold"
      onChange={(event) => setDraft(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          event.currentTarget.blur(); // one commit path (the blur handler), never two
        } else if (event.key === "Escape") {
          cancelledRef.current = true;
          event.currentTarget.blur();
        }
      }}
      onBlur={() => {
        setEditing(false);
        if (cancelledRef.current) {
          cancelledRef.current = false;
          return;
        }
        const trimmed = draft.trim();
        if (trimmed && trimmed !== props.name) props.onCommit(trimmed);
      }}
    />
  );
}

/**
 * ui-wave U6 (owner feedback) — the project detail pane, restructured from one flat form into a
 * proper entity view: an identity HEADER (click-to-edit name, status badge, "Created · Updated ·
 * N sessions" meta line, Save + a "…" overflow with Archive/Delete) over clear SECTION cards
 * (Description / Instructions / Pinned files / Memory). What every member session inherits
 * (instructions + pinned files, LAYER 6b — `hub/turn-engine.ts`) is unchanged; so are the API
 * contracts, the remount-on-selection convention (`key={selection}` at the call site) and the
 * dirty-guard report. Save is enabled only when something actually changed and also answers
 * Cmd/Ctrl+S. Pinned files persist immediately through their own sub-component and stay OUTSIDE
 * any form element on purpose: pre-U6 they sat inside the project `<form>`, so pressing Enter in
 * the pinned "Filename" field submitted the PROJECT save — one of the "not even working" paper
 * cuts this wave repairs (there is no `<form>` at all now; submit paths are explicit).
 */
export function ProjectEditor({
  project,
  saving,
  sessionCount,
  onSave,
  onDelete,
  onArchiveToggle,
  onDirtyChange,
}: {
  project: HubProject | null;
  saving: boolean;
  /** Top-level session count for the meta line; undefined while unknown (falls back to a plain
   *  "View sessions" link rather than a made-up number). */
  sessionCount?: number;
  onSave: (value: ProjectFormValue) => Promise<void>;
  onDelete?: () => Promise<void>;
  onArchiveToggle?: (archived: boolean) => Promise<void>;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const initial = useMemo(() => formFromProject(project), [project]);
  const [value, setValue] = useState<ProjectFormValue>(initial);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [archiveBusy, setArchiveBusy] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const dirty = useMemo(() => {
    const a = normalize(value);
    const b = normalize(initial);
    return (
      a.name !== b.name || a.description !== b.description || a.instructions !== b.instructions
    );
  }, [value, initial]);
  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);

  const submit = useCallback(async (): Promise<void> => {
    const nextErrors = validate(value);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      // Only the new-project draft renders this input; an existing project's rename can't commit an
      // invalid name in the first place (see ProjectTitle).
      document.getElementById("project-name")?.focus();
      return;
    }
    try {
      await onSave(value);
    } catch (error) {
      notifyError("Couldn’t save the project", { description: getErrorMessage(error) });
    }
  }, [value, onSave]);

  // Cmd/Ctrl+S — the muscle-memory twin of the header Save button. preventDefault fires even when
  // there is nothing to save: the browser's own "save page" dialog appearing mid-edit would read as
  // the app breaking.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "s") return;
      event.preventDefault();
      if (dirty && !saving) void submit();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [dirty, saving, submit]);

  const handleArchiveToggle = async (): Promise<void> => {
    if (!onArchiveToggle || !project) return;
    setArchiveBusy(true);
    try {
      await onArchiveToggle(!project.archivedAt);
    } catch (error) {
      notifyError("Couldn’t update the project", { description: getErrorMessage(error) });
    } finally {
      setArchiveBusy(false);
    }
  };

  const handleDelete = async (): Promise<void> => {
    if (!onDelete) return;
    setDeleteBusy(true);
    try {
      await onDelete();
      setDeleteOpen(false);
    } catch (error) {
      notifyError("Couldn’t delete the project", { description: getErrorMessage(error) });
    } finally {
      setDeleteBusy(false);
    }
  };

  const archived = !!project?.archivedAt;
  const sessionsLabel =
    sessionCount != null
      ? `${sessionCount} ${sessionCount === 1 ? "session" : "sessions"}`
      : "View sessions";

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col">
      {/* ── Identity header — fixed while the section cards below scroll ─────────────────────── */}
      <header className="flex shrink-0 flex-wrap items-start justify-between gap-3 border-b border-border px-6 py-4">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted">
            <Folder
              aria-hidden
              className={cn(
                "size-5",
                archived || !project ? "text-muted-foreground" : "text-primary",
              )}
            />
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              {project ? (
                <ProjectTitle
                  name={value.name}
                  onCommit={(name) => setValue((current) => ({ ...current, name }))}
                />
              ) : (
                <Input
                  id="project-name"
                  aria-label="Name"
                  value={value.name}
                  onChange={(event) => setValue({ ...value, name: event.target.value })}
                  onKeyDown={(event) => {
                    // No surrounding <form> (see the class doc), so Enter-to-create is wired here.
                    if (event.key === "Enter") {
                      event.preventDefault();
                      void submit();
                    }
                  }}
                  placeholder="e.g. Q3 Launch…"
                  maxLength={HUB_PROJECT_NAME_MAX_LENGTH}
                  aria-invalid={!!errors.name}
                  autoComplete="off"
                  className="h-9 w-full max-w-md font-semibold"
                />
              )}
              {project ? (
                <Badge variant={archived ? "outline" : "secondary"} className="shrink-0">
                  {archived ? "Archived" : "Active"}
                </Badge>
              ) : null}
            </div>
            {errors.name ? (
              <Text variant="meta" className="text-destructive" role="alert">
                {errors.name}
              </Text>
            ) : null}
            {project ? (
              <Text
                variant="caption"
                tone="muted"
                className="flex min-w-0 flex-wrap items-center gap-x-1.5"
              >
                <span className="whitespace-nowrap">
                  Created {formatDateOnly(project.createdAt)}
                </span>
                <span aria-hidden>·</span>
                <span className="whitespace-nowrap">
                  Updated {formatDateOnly(project.updatedAt)}
                </span>
                <span aria-hidden>·</span>
                {/* Deep link into the sessions table pre-filtered to this project — the exact
                    `?projectId=` param `sessions-url-state.ts` (WP2.8) reads. */}
                <Link
                  className="whitespace-nowrap text-primary hover:underline"
                  to={`/assistant/sessions?projectId=${encodeURIComponent(project.id)}`}
                >
                  {sessionsLabel}
                </Link>
              </Text>
            ) : (
              <Text variant="caption" tone="muted">
                New project — name it, then save to start pinning context.
              </Text>
            )}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <Button
            type="button"
            onClick={() => void submit()}
            disabled={saving || !dirty}
            aria-keyshortcuts="Control+S Meta+S"
            title="Save (Ctrl+S / Cmd+S)"
          >
            {saving ? (
              <Spinner className="size-4" aria-hidden />
            ) : (
              <Save aria-hidden className="size-4" />
            )}
            <span>{project ? "Save" : "Create project"}</span>
          </Button>
          {project ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <IconButton
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  label="Project actions"
                  disabled={deleteBusy}
                >
                  {archiveBusy ? (
                    <Spinner className="size-4" aria-hidden />
                  ) : (
                    <MoreHorizontal aria-hidden className="size-4" />
                  )}
                </IconButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  disabled={!dirty || saving}
                  onSelect={() => {
                    setValue(initial);
                    setErrors({});
                  }}
                >
                  <Undo2 aria-hidden />
                  <span>Discard changes</span>
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={saving || archiveBusy}
                  onSelect={() => void handleArchiveToggle()}
                >
                  <span>{archived ? "Unarchive" : "Archive"}</span>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="text-destructive focus:text-destructive"
                  onSelect={() => setDeleteOpen(true)}
                >
                  <Trash2 aria-hidden />
                  <span>Delete</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </div>
      </header>

      {/* ── Section cards — the pane's only scroll region ────────────────────────────────────── */}
      <div className="min-h-0 flex-1 overflow-y-auto p-6 [scrollbar-gutter:stable]">
        {/* Capped at a reading width — full-bleed textareas were part of the "dry form" feel. */}
        <div className="flex w-full max-w-3xl flex-col gap-4">
          <EditorSection
            title="Description"
            description="A short summary shown wherever this project is picked."
          >
            <Textarea
              id="project-description"
              aria-label="Description"
              value={value.description}
              onChange={(event) => setValue({ ...value, description: event.target.value })}
              placeholder="Add a short summary…"
              rows={2}
              // field-sizing-content autosizes with the text (capped); rows stays as the fallback
              // height for engines without field-sizing support.
              className="field-sizing-content max-h-48 min-h-16 resize-none"
            />
          </EditorSection>

          <EditorSection
            title="Instructions"
            description="Standing instructions every session in this project inherits — precedence over general preferences for this work."
          >
            <Textarea
              id="project-instructions"
              aria-label="Instructions"
              value={value.instructions}
              onChange={(event) => setValue({ ...value, instructions: event.target.value })}
              placeholder="e.g. tone, format, constraints, links to follow…"
              rows={6}
              className="field-sizing-content max-h-96 min-h-32 resize-none"
            />
          </EditorSection>

          {project ? (
            <>
              <PinnedFilesEditor projectId={project.id} />
              <EditorSection
                title="Memory"
                description="This project's own memory — precedence over global profile memory, shadowed only by a crew/agent scope (D-HUX11)."
              >
                <ScopedMemoryList scope="project" scopeId={project.id} />
              </EditorSection>
            </>
          ) : (
            <Text variant="caption" tone="muted">
              Create the project first, then pin files to it.
            </Text>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Delete this project?"
        description="This permanently removes it and its pinned files. Sessions grouped under it keep their history — they just lose the project pin."
        confirmLabel="Delete project"
        tone="destructive"
        busy={deleteBusy}
        onConfirm={() => void handleDelete()}
      />
    </div>
  );
}
