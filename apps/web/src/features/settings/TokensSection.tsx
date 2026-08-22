import {
  API_TOKEN_DEFAULT_EXPIRY_DAYS,
  API_TOKEN_LABEL_MAX_LENGTH,
  API_TOKEN_PREFIX,
  API_TOKEN_SCOPE_META,
  API_TOKEN_SCOPES,
  type ApiToken,
  type ApiTokenScope,
  defaultApiTokenExpiry,
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
  RadioGroup,
  RadioGroupItem,
  Text,
  toast,
} from "@elabs-ai/components-ui";
import { DataTable } from "@elabs-ai/components-data";
import { Info, KeyRound, Plus, RefreshCw, Trash2, TriangleAlert } from "lucide-react";
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
  /** Distinct from `revoking`/`busy` above — rotate and revoke are two different destructive
   *  confirmations and must not share a dialog's open/busy state. */
  const [rotating, setRotating] = useState<ApiToken | null>(null);
  const [rotateBusy, setRotateBusy] = useState(false);

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

  /**
   * Rotate — mint a replacement and retire the old credential in one operator action, instead of
   * "create a new one, copy it somewhere, come back and remember to revoke the old one" (the step
   * that gets skipped, which is how a fleet ends up with three live tokens for one CI job).
   *
   * Order is the whole point: CREATE the replacement first, REVOKE the old one only once the new
   * one exists.
   *   - If create fails, nothing happens to the old token — the operator keeps a working credential
   *     and sees an error, not a gap in access.
   *   - If create succeeds but the follow-up revoke fails, the new secret is real and already
   *     usable — it is revealed unconditionally, and the revoke failure is surfaced as its own
   *     problem ("the old one is still live") rather than swallowed or made to look like the whole
   *     rotation failed.
   */
  async function rotate(token: ApiToken): Promise<void> {
    setRotateBusy(true);
    try {
      const created = await createApiToken({
        // Same name, same permissions — a rotation replaces the credential, not the identity an
        // operator recognises it by. (No `expiresAt` key: omitting it lets the API apply the same
        // 90-day default a fresh token gets, per `defaultApiTokenExpiry`.)
        label: token.label,
        scopes: token.scopes,
      });
      // The confirm dialog's job is done the moment the replacement exists; close it now rather
      // than holding it open through the revoke attempt below.
      setRotating(null);
      setRevealed({ label: created.token.label, secret: created.secret });
      try {
        await deleteApiToken(token.id);
        toast.success(`Rotated “${token.label}”`, {
          description: "The old token has been revoked. Anything still using it now gets a 401.",
        });
      } catch (revokeError) {
        // The new credential is real and already works — don't let a cleanup failure read as a
        // failed rotation. Say exactly what is and isn't true: the old token is still active.
        notifyError(`“${token.label}” (the old token) is still active.`, {
          description: `The replacement was created, but revoking the original failed: ${getErrorMessage(revokeError)}. Revoke it by hand once you’ve copied the new secret.`,
        });
      }
      await refresh();
    } catch (createError) {
      notifyError("Couldn’t create a replacement token.", {
        description: `${getErrorMessage(createError)} Nothing was revoked.`,
      });
    } finally {
      setRotateBusy(false);
    }
  }

  const columns = [
    // "Last used" leads — this is a security pane, and how recently a credential authenticated is
    // the risk signal an operator scans for first (a token unused for months is the one worth
    // asking about), ahead of what it's even called.
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
        <div className="flex justify-end gap-1">
          <IconButton
            label={`Rotate ${token.label}`}
            variant="ghost"
            size="icon-sm"
            onClick={() => setRotating(token)}
          >
            <RefreshCw aria-hidden />
          </IconButton>
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

      <ConfirmDialog
        open={rotating != null}
        onOpenChange={(open) => {
          if (!open) setRotating(null);
        }}
        title={rotating ? `Rotate “${rotating.label}”?` : ""}
        description="Mints a replacement with the same name and permissions, then revokes this one. Anything still using the old secret stops working, so copy the new one before you close the dialog it appears in."
        confirmLabel="Rotate token"
        tone="destructive"
        busy={rotateBusy}
        onConfirm={() => {
          if (rotating) void rotate(rotating);
        }}
      />
    </SectionFrame>
  );
}

/* ── Create ──────────────────────────────────────────────────────────────────────────────────── */

/** The three choices the "Expires" control offers — "Never" is a pick now, not an empty box. */
type ExpiryChoice = "default" | "custom" | "never";

function CreateTokenDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (label: string, secret: string) => Promise<void>;
}) {
  const labelId = useId();
  const expiresId = useId();
  const [label, setLabel] = useState("");
  const [scopes, setScopes] = useState<ApiTokenScope[]>(["read"]);
  const [expiryChoice, setExpiryChoice] = useState<ExpiryChoice>("default");
  /** The `<input type="date">` value for the "Custom date…" choice only. */
  const [customDate, setCustomDate] = useState("");
  /**
   * The instant "90 days (recommended)" resolves to, captured once when the dialog opens (see the
   * reset effect) — a lazy initial value here means it's never blank on the very first paint
   * either. Captured rather than recomputed at submit time so the date shown next to the option and
   * the date actually sent are the SAME value, not two calls to `new Date()` that happen to be a
   * few seconds apart.
   */
  const [defaultExpiresAt, setDefaultExpiresAt] = useState(
    () => defaultApiTokenExpiry(undefined, new Date()) ?? "",
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset every time the dialog opens, so a previous attempt never leaks into the next one.
  useEffect(() => {
    if (props.open) {
      setLabel("");
      setScopes(["read"]);
      setExpiryChoice("default");
      setCustomDate("");
      setDefaultExpiresAt(defaultApiTokenExpiry(undefined, new Date()) ?? "");
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

  /** What "Expires" resolves to on the wire, for the choice currently selected. */
  function resolveExpiresAt(): string | null {
    if (expiryChoice === "never") return null;
    if (expiryChoice === "custom") {
      // `<input type="date">` gives a bare `YYYY-MM-DD`; the wire wants a real instant. End of that
      // day UTC, so a token dated "today" is still usable for the rest of today.
      return customDate ? new Date(`${customDate}T23:59:59.999Z`).toISOString() : null;
    }
    // The exact instant shown next to "90 days (recommended)" — captured at open, not re-derived
    // here, so what the operator read and what gets sent can never drift apart.
    return defaultExpiresAt;
  }

  async function submit(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const created = await createApiToken({
        label: label.trim(),
        scopes,
        expiresAt: resolveExpiresAt(),
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
      // real, structural validity: a name, at least one permission, and — only for "Custom date…" —
      // an actual date (the other two choices are always complete the moment they're picked).
      submitDisabled={
        label.trim().length === 0 ||
        scopes.length === 0 ||
        (expiryChoice === "custom" && customDate.trim().length === 0)
      }
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

      <fieldset className="flex flex-col gap-2">
        <legend className="pb-2">
          <Text className="font-medium">Expires</Text>
        </legend>
        <RadioGroup
          aria-label="Expires"
          value={expiryChoice}
          onValueChange={(value) => value && setExpiryChoice(value as ExpiryChoice)}
          className="flex flex-col gap-3"
        >
          <ExpiryRadioOption
            value="default"
            label={`${API_TOKEN_DEFAULT_EXPIRY_DAYS} days (recommended)`}
            description={`Expires ${formatDateTime(defaultExpiresAt)}. Long enough for most CI jobs, short enough that a forgotten token doesn't outlive whatever it was for.`}
          />
          <ExpiryRadioOption
            value="custom"
            label="Custom date…"
            description="Pick the exact day it stops working."
          />
          <ExpiryRadioOption
            value="never"
            label="Never"
            description="Stays valid until you revoke it — still available, just a deliberate choice now."
          />
        </RadioGroup>
        {expiryChoice === "custom" ? (
          <div className="ps-7">
            <Input
              id={expiresId}
              name="expiresAt"
              type="date"
              value={customDate}
              autoComplete="off"
              className="w-fit"
              onChange={(event) => setCustomDate(event.target.value)}
            />
          </div>
        ) : null}
        <Text variant="meta" tone="muted" className="pt-1">
          You can revoke a token at any time, regardless of its expiry.
        </Text>
      </fieldset>

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

/** One row of the "Expires" `RadioGroup` — same label/description shape as `ScopeCheckbox`, a
 *  radio in place of a checkbox because the three choices are mutually exclusive. */
function ExpiryRadioOption(props: { value: ExpiryChoice; label: ReactNode; description: ReactNode }) {
  const id = useId();
  return (
    <div className="flex items-start gap-3">
      <RadioGroupItem id={id} value={props.value} className="mt-0.5" />
      <div className="flex min-w-0 flex-col gap-0.5">
        {/* The label shares the radio's hit target (`htmlFor`) — clicking the text selects it. */}
        <Label htmlFor={id} className="font-medium">
          {props.label}
        </Label>
        <Text variant="meta" tone="muted" className="text-pretty">
          {props.description}
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
