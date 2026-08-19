import {
  API_TOKEN_LABEL_MAX_LENGTH,
  API_TOKEN_PREFIX,
  API_TOKEN_SCOPE_META,
  API_TOKEN_SCOPES,
  type ApiToken,
  type ApiTokenScope,
} from "@mcp-token-footprint/shared";
import {
  Alert,
  AlertDescription,
  Button,
  Checkbox,
  CopyableValue,
  EmptyState,
  Heading,
  Input,
  Label,
  Text,
  toast,
} from "@elabs-ai/components-ui";
import { DataTable } from "@elabs-ai/components-data";
import { Info, KeyRound, Plus, Trash2, TriangleAlert } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useId, useState } from "react";
import { ConfirmDialog, FormDialog } from "../../components/dialogs";
import { IconButton } from "../../components/IconButton";
import { createApiToken, deleteApiToken, listApiTokens } from "../../lib/api";
import { getErrorMessage } from "../../lib/errors";
import { formatDateTime } from "../../lib/format";
import { notifyError } from "../../lib/notify";
import { col } from "../../lib/table";

/* ─────────────────────────────────────────────────────────────────────────────────────────────
 * Settings › API tokens — the credential a headless caller presents instead of a browser session.
 *
 * Who needs one: a CI job gating a change on footprint/quality deltas, the `mcpfp` CLI, or an
 * external agent dialling the workbench's own MCP mount. Nobody using the app in a browser on this
 * machine needs one — loopback stays open.
 *
 * **The one-time reveal is this pane's centre of gravity.** The API stores a SHA-256 digest, so the
 * plaintext exists exactly once, in the create response. Everything about the reveal step is built
 * around that: the secret is shown in its own dialog with an unmissable warning, closing that dialog
 * is the explicit acknowledgement, and it is never re-rendered afterwards (there is nothing left to
 * render — the app does not keep it). A lost token is replaced, not recovered.
 *
 * Immediate-apply, like Features: no explicit-save form is published, so no footer bar.
 * ──────────────────────────────────────────────────────────────────────────────────────────── */

export function TokensSection() {
  const [tokens, setTokens] = useState<ApiToken[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  /** The just-minted plaintext, shown once. `null` at every other moment — including after close. */
  const [revealed, setRevealed] = useState<{ label: string; secret: string } | null>(null);
  const [revoking, setRevoking] = useState<ApiToken | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const response = await listApiTokens();
      setTokens(response.tokens);
      setLoadError(null);
    } catch (error) {
      setTokens([]);
      setLoadError(getErrorMessage(error));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function revoke(token: ApiToken): Promise<void> {
    setBusy(true);
    try {
      await deleteApiToken(token.id);
      setRevoking(null);
      toast.success(`Revoked “${token.label}”`, {
        description: "Any caller still using it now gets a 401.",
      });
      await refresh();
    } catch (error) {
      notifyError("Couldn’t revoke that token.", { description: getErrorMessage(error) });
    } finally {
      setBusy(false);
    }
  }

  const columns = [
    col<ApiToken>({
      id: "label",
      header: "Label",
      value: (token) => token.label,
      cell: (token) => (
        <div className="flex min-w-0 flex-col gap-0.5">
          <Text className="truncate font-medium">{token.label}</Text>
          <Text variant="meta" tone="muted" className="tabular-nums">
            {API_TOKEN_PREFIX}
            {token.tokenPrefix}…
          </Text>
        </div>
      ),
    }),
    col<ApiToken>({
      id: "scopes",
      header: "Scopes",
      value: (token) => token.scopes.join(", "),
      cell: (token) => (
        <Text variant="meta" tone="muted" className="break-words">
          {token.scopes.map((scope) => API_TOKEN_SCOPE_META[scope].label).join(" · ")}
        </Text>
      ),
    }),
    col<ApiToken>({
      id: "lastUsed",
      header: "Last used",
      value: (token) => token.lastUsedAt ?? "",
      cell: (token) => (
        <Text variant="meta" tone="muted" className="tabular-nums">
          {token.lastUsedAt ? formatDateTime(token.lastUsedAt) : "Never"}
        </Text>
      ),
    }),
    col<ApiToken>({
      id: "expires",
      header: "Expires",
      value: (token) => token.expiresAt ?? "",
      cell: (token) => (
        <Text variant="meta" tone="muted" className="tabular-nums">
          {token.expiresAt ? formatDateTime(token.expiresAt) : "Never"}
        </Text>
      ),
    }),
    col<ApiToken>({
      id: "actions",
      header: "",
      value: () => "",
      cell: (token) => (
        <div className="flex justify-end">
          <IconButton
            label={`Revoke ${token.label}`}
            variant="ghost"
            size="icon-sm"
            onClick={() => setRevoking(token)}
          >
            <Trash2 aria-hidden />
          </IconButton>
        </div>
      ),
    }),
  ];

  return (
    <SectionFrame
      actions={
        <Button type="button" onClick={() => setCreating(true)}>
          <Plus aria-hidden />
          Create token
        </Button>
      }
    >
      <Alert>
        <Info aria-hidden />
        <AlertDescription>
          You only need a token when something outside this machine talks to the workbench. Requests
          from this computer keep working without one.
        </AlertDescription>
      </Alert>

      {loadError ? (
        <Alert variant="destructive">
          <TriangleAlert aria-hidden />
          <AlertDescription>{loadError}</AlertDescription>
        </Alert>
      ) : null}

      <DataTable
        columns={columns}
        data={tokens ?? []}
        loading={tokens === null}
        caption="Service tokens"
        emptyMessage={
          <EmptyState
            icon={<KeyRound aria-hidden />}
            title="No service tokens yet"
            description="Create one when a CI job, the command line, or an outside agent needs to reach this workbench."
            actions={
              <Button type="button" onClick={() => setCreating(true)}>
                <Plus aria-hidden />
                Create token
              </Button>
            }
          />
        }
      />

      <CreateTokenDialog
        open={creating}
        onOpenChange={setCreating}
        onCreated={async (label, secret) => {
          setCreating(false);
          setRevealed({ label, secret });
          await refresh();
        }}
      />

      <RevealTokenDialog reveal={revealed} onAcknowledge={() => setRevealed(null)} />

      <ConfirmDialog
        open={revoking != null}
        onOpenChange={(open) => {
          if (!open) setRevoking(null);
        }}
        title={revoking ? `Revoke “${revoking.label}”?` : ""}
        description="This takes effect immediately and cannot be undone. Anything still using this token stops working until you give it a new one."
        confirmLabel="Revoke token"
        tone="destructive"
        busy={busy}
        onConfirm={() => {
          if (revoking) void revoke(revoking);
        }}
      />
    </SectionFrame>
  );
}

/* ── Create ──────────────────────────────────────────────────────────────────────────────────── */

function CreateTokenDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (label: string, secret: string) => Promise<void>;
}) {
  const labelId = useId();
  const expiresId = useId();
  const [label, setLabel] = useState("");
  const [scopes, setScopes] = useState<ApiTokenScope[]>(["read"]);
  const [expiresAt, setExpiresAt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset every time the dialog opens, so a previous attempt never leaks into the next one.
  useEffect(() => {
    if (props.open) {
      setLabel("");
      setScopes(["read"]);
      setExpiresAt("");
      setError(null);
    }
  }, [props.open]);

  function toggleScope(scope: ApiTokenScope, checked: boolean): void {
    setScopes((current) =>
      checked
        ? API_TOKEN_SCOPES.filter((s) => s === scope || current.includes(s))
        : current.filter((s) => s !== scope),
    );
  }

  async function submit(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const created = await createApiToken({
        label: label.trim(),
        scopes,
        // `<input type="date">` gives a bare `YYYY-MM-DD`; the wire wants a real instant. End of that
        // day UTC, so a token dated "today" is still usable for the rest of today.
        expiresAt: expiresAt ? new Date(`${expiresAt}T23:59:59.999Z`).toISOString() : null,
      });
      await props.onCreated(created.token.label, created.secret);
    } catch (caught) {
      setError(getErrorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <FormDialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      title="Create a service token"
      description="Give it a name you'll recognise later, and only the permissions the caller actually needs."
      primaryLabel="Create token"
      busy={busy}
      // Submit stays enabled until the request starts (interaction-guidelines) — it is gated only by
      // real, structural validity: a name, and at least one permission.
      submitDisabled={label.trim().length === 0 || scopes.length === 0}
      onSubmit={() => void submit()}
    >
      <div className="flex flex-col gap-2">
        <Label htmlFor={labelId}>Name</Label>
        <Input
          id={labelId}
          name="label"
          value={label}
          maxLength={API_TOKEN_LABEL_MAX_LENGTH}
          autoComplete="off"
          spellCheck={false}
          placeholder="CI — footprint gate…"
          onChange={(event) => setLabel(event.target.value)}
        />
        <Text variant="meta" tone="muted">
          Shown in this list so you can tell your tokens apart.
        </Text>
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="pb-2">
          <Text className="font-medium">Permissions</Text>
        </legend>
        <div className="flex flex-col gap-3">
          {API_TOKEN_SCOPES.map((scope) => (
            <ScopeCheckbox
              key={scope}
              scope={scope}
              checked={scopes.includes(scope)}
              onCheckedChange={(checked) => toggleScope(scope, checked)}
            />
          ))}
        </div>
        <Text variant="meta" tone="muted" className="pt-1">
          No permission lets a token delete anything, or create or revoke other tokens.
        </Text>
      </fieldset>

      <div className="flex flex-col gap-2">
        <Label htmlFor={expiresId}>Expires (optional)</Label>
        <Input
          id={expiresId}
          name="expiresAt"
          type="date"
          value={expiresAt}
          className="w-fit"
          onChange={(event) => setExpiresAt(event.target.value)}
        />
        <Text variant="meta" tone="muted">
          Leave empty for a token that never expires. You can revoke it at any time either way.
        </Text>
      </div>

      {error ? (
        <Alert variant="destructive">
          <TriangleAlert aria-hidden />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
    </FormDialog>
  );
}

function ScopeCheckbox(props: {
  scope: ApiTokenScope;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  const id = useId();
  const meta = API_TOKEN_SCOPE_META[props.scope];
  return (
    <div className="flex items-start gap-3">
      <Checkbox
        id={id}
        className="mt-0.5"
        checked={props.checked}
        onCheckedChange={(checked) => props.onCheckedChange(checked === true)}
      />
      <div className="flex min-w-0 flex-col gap-0.5">
        {/* The label shares the checkbox's hit target (`htmlFor`) — clicking the text toggles it. */}
        <Label htmlFor={id} className="font-medium">
          {meta.label}
        </Label>
        <Text variant="meta" tone="muted" className="text-pretty">
          {meta.description}
        </Text>
      </div>
    </div>
  );
}

/* ── The one-time reveal ─────────────────────────────────────────────────────────────────────── */

/**
 * The secret, shown once. There is no "show it again" anywhere in the app because there is nothing
 * to show — the server keeps only a digest. Closing this dialog IS the acknowledgement, which is why
 * it has a single action labelled for that consequence rather than a Cancel/OK pair.
 */
function RevealTokenDialog(props: {
  reveal: { label: string; secret: string } | null;
  onAcknowledge: () => void;
}) {
  const { reveal } = props;
  return (
    <ConfirmDialog
      open={reveal != null}
      onOpenChange={(open) => {
        if (!open) props.onAcknowledge();
      }}
      title={reveal ? `“${reveal.label}” is ready` : ""}
      description="Copy it now — this is the only time it is shown."
      confirmLabel="I've copied it"
      cancelLabel="Close"
      onConfirm={props.onAcknowledge}
    >
      {reveal ? (
        <div className="flex flex-col gap-3">
          <Alert variant="destructive">
            <TriangleAlert aria-hidden />
            <AlertDescription>
              You will not see this token again. It is stored scrambled, so nobody — including this
              app — can recover it. If you lose it, revoke it and create another.
            </AlertDescription>
          </Alert>
          <CopyableValue
            value={reveal.secret}
            hint="Copy service token"
            className="w-full justify-start break-all text-start font-mono text-meta"
          >
            {reveal.secret}
          </CopyableValue>
          <Text variant="meta" tone="muted">
            Send it as an <code>Authorization: Bearer …</code> header.
          </Text>
        </div>
      ) : null}
    </ConfirmDialog>
  );
}

/** Local copy of the settings pane frame — `SettingsView`'s own `SectionPane` is module-private,
 *  and exporting it just for this pane would widen its API (the `FeaturesSection` precedent). */
function SectionFrame({ children, actions }: { children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="flex flex-col gap-5 px-8 py-6">
      <div className="flex flex-wrap items-start justify-between gap-3 pe-8">
        <div className="flex min-w-0 flex-col gap-1">
          <Heading level={2} size="title">
            API tokens
          </Heading>
          <Text tone="muted" className="text-pretty">
            Let a CI job, the command line, or an outside agent reach this workbench without a
            browser.
          </Text>
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}
