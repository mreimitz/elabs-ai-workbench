import { useEffect, useState } from "react";
import type { ServerType, ServerTypeStatus } from "@mcp-token-footprint/shared";
import { Badge, Button, EmptyState, Input, Text, Textarea, toast } from "@elabs-ai/components-ui";
import { ArrowLeft, Pencil, Plus, Tags, Trash2 } from "lucide-react";
import { FieldRow } from "../../components/FieldRow";
import { IconButton } from "../../components/IconButton";
import { SelectField } from "../../components/SelectField";
import { ConfirmDialog, FormDialog } from "../../components/dialogs";
import { ApiError, createServerType, deleteServerType, updateServerType } from "../../lib/api";
import { getErrorMessage } from "../../lib/errors";
import { formatNumber } from "../../lib/format";
import { ServerTypeStatusBadge } from "./ServerTypeStatusBadge";
import { SERVER_TYPE_STATUS_LABELS, serverTypeStatusOptions } from "./serverTypeStatus";
import { notifyError } from "../../lib/notify";

// A type carries NO secrets and NO connection config (D-ST5) — it is a label + status. So this whole
// surface is plain CRUD over the redacted server-type wire; nothing here ever touches a server's
// config or credentials.

/** The manager's inner mode: the list, or the create/edit form (editing carries the row). */
type Mode = { kind: "list" } | { kind: "create" } | { kind: "edit"; type: ServerType };

const DEFAULT_STATUS: ServerTypeStatus = "production";

/**
 * Manage-types surface (planning/Roadmap/completed/RM-21-server-types WP 2.2): create / rename / restatus / edit-description /
 * delete server types, with member counts and a delete-DETACHES confirmation (D-ST4 — deleting a type
 * sets its members to Untyped, it never deletes servers).
 *
 * One self-contained `@elabs-ai/components-ui` `Dialog` that swaps between a list mode and a create/edit form mode
 * (mirroring `AcmeAnswersOfferDialog`'s single-dialog / multi-phase shape), plus a nested
 * `ConfirmDialog` for the destructive delete (the established AlertDialog-over-Dialog pattern). After
 * any successful create/update/delete it fires `onChanged` so the app refreshes BOTH its server-types
 * AND its servers (a delete re-types members to Untyped).
 */
export function ManageServerTypesDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  serverTypes: ServerType[];
  /** Refresh hook — the app's `refreshAll`, so both server types AND servers reload after a change. */
  onChanged: () => void | Promise<void>;
}) {
  const [mode, setMode] = useState<Mode>({ kind: "list" });
  const [name, setName] = useState("");
  const [status, setStatus] = useState<ServerTypeStatus>(DEFAULT_STATUS);
  const [description, setDescription] = useState("");
  const [nameError, setNameError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<ServerType | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Every fresh open lands on the list — no state carried over from a prior session of this dialog.
  useEffect(() => {
    if (!props.open) return;
    setMode({ kind: "list" });
    setPendingDelete(null);
  }, [props.open]);

  function openCreate() {
    setName("");
    setStatus(DEFAULT_STATUS);
    setDescription("");
    setNameError(null);
    setMode({ kind: "create" });
  }

  function openEdit(type: ServerType) {
    setName(type.name);
    setStatus(type.status);
    setDescription(type.description ?? "");
    setNameError(null);
    setMode({ kind: "edit", type });
  }

  function backToList() {
    setMode({ kind: "list" });
  }

  async function submitForm() {
    const trimmed = name.trim();
    if (!trimmed) {
      setNameError("Enter a name.");
      document.getElementById("server-type-name")?.focus();
      return;
    }
    setBusy(true);
    setNameError(null);
    try {
      if (mode.kind === "edit") {
        await updateServerType(mode.type.id, {
          name: trimmed,
          status,
          // `null` explicitly clears the description; a non-empty value sets it.
          description: description.trim() ? description.trim() : null,
        });
        toast.success("Server type updated", { description: trimmed });
      } else {
        await createServerType({
          name: trimmed,
          status,
          description: description.trim() || undefined,
        });
        toast.success("Server type created", { description: trimmed });
      }
      await props.onChanged();
      setMode({ kind: "list" });
    } catch (err) {
      // A duplicate name is an EXPECTED validation outcome — surface it inline on the field, never a
      // generic toast (S14). Anything else is unexpected → the toast region.
      if (err instanceof ApiError && err.status === 409) {
        setNameError("A type with this name already exists.");
        document.getElementById("server-type-name")?.focus();
      } else {
        notifyError("Couldn’t save the server type. Try again.", {
          description: getErrorMessage(err),
        });
      }
    } finally {
      setBusy(false);
    }
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      await deleteServerType(pendingDelete.id);
      toast.success("Server type deleted", {
        description:
          pendingDelete.memberCount > 0
            ? `${formatNumber(pendingDelete.memberCount)} server${
                pendingDelete.memberCount === 1 ? "" : "s"
              } set to Untyped.`
            : pendingDelete.name,
      });
      setPendingDelete(null);
      await props.onChanged();
    } catch (err) {
      notifyError("Couldn’t delete the server type. Try again.", {
        description: getErrorMessage(err),
      });
    } finally {
      setDeleting(false);
    }
  }

  const formHeading = mode.kind === "edit" ? `Edit ${mode.type.name}` : "New server type";

  return (
    <>
      {mode.kind === "list" ? (
        <FormDialog
          open={props.open}
          onOpenChange={props.onOpenChange}
          title="Manage server types"
          description="A type groups servers that share one tool surface, with a lifecycle status. It carries no secrets or connection config."
          cancelLabel="Close"
          primaryLabel="New type"
          onSubmit={openCreate}
        >
          {props.serverTypes.length === 0 ? (
            <EmptyState
              icon={<Tags aria-hidden />}
              title="No server types yet"
              description="Create a type to group servers that share one tool surface (e.g. a production fleet vs. a beta one)."
              actions={
                <Button onClick={openCreate}>
                  <Plus aria-hidden />
                  <span>Create the first type</span>
                </Button>
              }
            />
          ) : (
            <ul className="flex flex-col gap-2">
              {props.serverTypes.map((type) => (
                <li
                  key={type.id}
                  className="flex min-w-0 items-center gap-3 rounded-md border border-border bg-card p-3"
                >
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <Text className="min-w-0 truncate font-medium">{type.name}</Text>
                      <ServerTypeStatusBadge status={type.status} />
                      <Badge variant="secondary" className="shrink-0 tabular-nums">
                        {formatNumber(type.memberCount)}{" "}
                        {type.memberCount === 1 ? "server" : "servers"}
                      </Badge>
                    </div>
                    {type.description ? (
                      <Text variant="meta" tone="muted" className="min-w-0 truncate">
                        {type.description}
                      </Text>
                    ) : null}
                  </div>
                  <IconButton
                    size="icon-sm"
                    variant="ghost"
                    className="shrink-0"
                    label={`Edit ${type.name}`}
                    onClick={() => openEdit(type)}
                  >
                    <Pencil aria-hidden />
                  </IconButton>
                  <IconButton
                    size="icon-sm"
                    variant="ghost"
                    className="shrink-0 text-destructive"
                    label={`Delete ${type.name}`}
                    onClick={() => setPendingDelete(type)}
                  >
                    <Trash2 aria-hidden />
                  </IconButton>
                </li>
              ))}
            </ul>
          )}
        </FormDialog>
      ) : (
        <FormDialog
          open={props.open}
          onOpenChange={props.onOpenChange}
          title={formHeading}
          description="Name the type and set its lifecycle status. Assign servers to it from the add/edit server form."
          primaryLabel={mode.kind === "edit" ? "Save changes" : "Create type"}
          onSubmit={submitForm}
          busy={busy}
          // Back returns to the list (it does NOT close the dialog); grouped left per the kit rule.
          footerStart={
            <Button variant="outline" size="sm" onClick={backToList} disabled={busy}>
              <ArrowLeft aria-hidden />
              <span>Back</span>
            </Button>
          }
        >
          <FieldRow id="server-type-name" label="Name" error={nameError ?? undefined}>
            <Input
              id="server-type-name"
              value={name}
              autoComplete="off"
              spellCheck={false}
              aria-invalid={Boolean(nameError)}
              placeholder="e.g. Acme-SaaS…"
              onChange={(event) => {
                setName(event.target.value);
                if (nameError) setNameError(null);
              }}
            />
          </FieldRow>
          <SelectField
            id="server-type-status"
            label="Lifecycle status"
            value={status}
            options={serverTypeStatusOptions}
            onChange={(value) => setStatus(value as ServerTypeStatus)}
          />
          <FieldRow id="server-type-description" label="Description">
            <Textarea
              id="server-type-description"
              value={description}
              rows={3}
              placeholder="What these servers have in common (optional)…"
              onChange={(event) => setDescription(event.target.value)}
            />
          </FieldRow>
        </FormDialog>
      )}

      {/* D-ST4: deleting DETACHES members (sets them Untyped), never deletes servers — the confirm
          copy states the member count so the consequence is explicit (destructive-action rule). */}
      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
        tone="destructive"
        title={`Delete ${pendingDelete?.name ?? "type"}?`}
        description={
          pendingDelete && pendingDelete.memberCount > 0
            ? `${formatNumber(pendingDelete.memberCount)} server${
                pendingDelete.memberCount === 1 ? "" : "s"
              } currently use this type. Deleting it sets ${
                pendingDelete.memberCount === 1 ? "that server" : "those servers"
              } to Untyped — it never deletes the ${
                pendingDelete.memberCount === 1 ? "server" : "servers"
              }.`
            : "No servers use this type. Deleting it removes the label only."
        }
        confirmLabel="Delete type"
        busy={deleting}
        onConfirm={() => void confirmDelete()}
      >
        {pendingDelete ? (
          <div className="flex flex-wrap items-center gap-2">
            <Text className="font-medium">{pendingDelete.name}</Text>
            <ServerTypeStatusBadge status={pendingDelete.status} />
            <Text variant="meta" tone="muted">
              {SERVER_TYPE_STATUS_LABELS[pendingDelete.status]}
            </Text>
          </div>
        ) : null}
      </ConfirmDialog>
    </>
  );
}
