import { useEffect, useMemo, useState } from "react";
import type {
  OAuthClientInput,
  OAuthStartResponse,
  ServerAuthInput,
  ServerAuthType,
  ServerConfig,
  ServerConfigInput,
  ServerConfigUpdate,
  ServerProbeRequest,
  ServerProbeResponse,
  ServerType,
  TransportType,
} from "@mcp-token-footprint/shared";
import {
  Alert,
  AlertDescription,
  Button,
  Descriptions,
  DescriptionsItem,
  Input,
  Label,
  RadioGroup,
  RadioGroupItem,
  Text,
  ToggleGroup,
  ToggleGroupItem,
  cn,
} from "@elabs-ai/components-ui";
import {
  ExternalLink,
  KeyRound,
  Link2,
  Pencil,
  Save,
  Search,
  Server,
  ShieldOff,
  Sparkles,
  Wifi,
} from "lucide-react";
import { getErrorMessage } from "../../lib/errors";
import { FieldRow } from "../../components/FieldRow";
import { SelectField } from "../../components/SelectField";
import { KeyValueEditor, ListEditor, type KeyValuePair } from "../../components/form";
import { WideDialog, type WideDialogSection } from "../../components/dialogs";
import { DiscardChangesDialog, useUnsavedChangesGuard } from "../../components/UnsavedChangesGuard";
import { RESEARCH_SERVER_PRESETS, type ResearchServerPreset } from "./researchServerPresets";
import { SERVER_TYPE_STATUS_LABELS } from "./serverTypeStatus";

// Sentinel for the "No type / Untyped" option — Radix Select forbids an empty-string item value, so
// null (untyped) maps to this and back. It can never collide with a real type id (a nanoid).
const UNTYPED_OPTION = "__untyped__";

type TestResult = { ok: boolean; tools: number; durationMs: number; errorMessage?: string };
type WizardStep = "connection" | "auth" | "review";

type FormState = {
  name: string;
  transport: TransportType;
  url: string;
  command: string;
  args: string[];
  env: KeyValuePair[];
  authType: ServerAuthType;
  bearerToken: string;
  apiKeyHeader: string;
  apiKey: string;
  oauthClientId: string;
  oauthClientSecret: string;
  customHeadersText: string;
  // Server type assignment (roadmap/server-types, D-ST5 — a label + status, never config/secrets).
  // `null` = Untyped. Sent on both create and update so the picker can assign OR clear a type.
  typeId: string | null;
};

const defaultForm: FormState = {
  name: "",
  transport: "streamable_http",
  url: "",
  command: "npx",
  // SV2: the example ships as PLACEHOLDER guidance (see the Args/Env fields), never as a real value —
  // so a distracted "Continue" can't register the example server.
  args: [],
  env: [],
  authType: "none",
  bearerToken: "",
  apiKeyHeader: "Authorization",
  apiKey: "",
  oauthClientId: "",
  oauthClientSecret: "",
  customHeadersText: "{}",
  typeId: null,
};

/** Per-field inline validation for the connection step (S14: no silent no-op; focus the first error). */
type ConnectionErrors = { url?: string; command?: string };

export function ServerWizard(props: {
  open: boolean;
  server: ServerConfig | null;
  /** Server types (roadmap/server-types) offered by the optional "Type" picker. Defaults to none. */
  serverTypes?: ServerType[];
  onOpenChange: (open: boolean) => void;
  onCreateServer: (input: ServerConfigInput) => Promise<ServerConfig>;
  onUpdateServer: (id: string, input: ServerConfigUpdate) => Promise<ServerConfig>;
  onProbeServer: (input: ServerProbeRequest) => Promise<ServerProbeResponse>;
  onStartOAuth: (serverId: string, oauthClient?: OAuthClientInput) => Promise<OAuthStartResponse>;
  onTestServer: (id: string) => Promise<TestResult>;
  /**
   * Fired right before the dialog closes itself on a SUCCESSFUL outcome (server saved, OAuth
   * authorized, or post-login verify passed). The reauth gate uses this as the "sign-in confirmed"
   * signal so the original action can retry. A cancel / manual close does NOT fire it.
   */
  onComplete?: (serverId: string) => void;
  /**
   * P0 reauth (audit finding / T7). When an OAuth token expires mid-op, this same dialog is reused
   * to sign in again — but as `reason:"reauth"` it must NOT read as "your config is wrong". It
   * retitles to "Sign in again to {server}", explains the expired session + the interrupted action,
   * opens at the **auth** step (not step 1, the URL field) with the stored auth type preselected, and
   * collapses the connection fields behind an "Edit connection settings" disclosure. Absent ⇒ the
   * normal add/edit flow, unchanged.
   */
  reason?: "reauth";
  /** Reauth copy context (the provider + the interrupted action), threaded from `App.openReauth`. */
  reauthContext?: { provider?: string; action?: string };
}) {
  const isReauth = props.reason === "reauth";
  const [form, setForm] = useState<FormState>(defaultForm);
  const [step, setStep] = useState<WizardStep>(isReauth ? "auth" : "connection");
  // Reauth foregrounds sign-in: the connection fields start collapsed behind a disclosure (the user
  // came here to re-authenticate, not to re-type the URL). Always expanded in the normal flow.
  const [connectionExpanded, setConnectionExpanded] = useState(!isReauth);
  const [probe, setProbe] = useState<ServerProbeResponse | null>(null);
  const [savedServer, setSavedServer] = useState<ServerConfig | null>(null);
  const [oauthUrl, setOauthUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connErrors, setConnErrors] = useState<ConnectionErrors>({});
  // A snapshot of the form at open, for the dirty check.
  const [baseline, setBaseline] = useState<string>("");

  const editing = Boolean(props.server);
  const activeServer = savedServer ?? props.server;
  // P0 reauth copy — the server the user actually knows, the provider whose session expired, and the
  // interrupted action ("the scan you started"), threaded from `App.openReauth`. All default sanely so
  // the copy never renders a placeholder gap.
  const reauthServerName = props.server?.name ?? "this server";
  const reauthProviderLabel = props.reauthContext?.provider ?? reauthServerName;
  const reauthActionLabel = props.reauthContext?.action ?? "what you started";
  const callbackUrl = `${window.location.origin}/api/oauth/callback`;
  const steps = useMemo(
    () =>
      form.transport === "streamable_http"
        ? [
            { id: "connection", label: "Connection" },
            { id: "auth", label: "Authentication" },
            { id: "review", label: "Review" },
          ]
        : [
            { id: "connection", label: "Command" },
            { id: "review", label: "Review" },
          ],
    [form.transport],
  );

  // Type-picker options (roadmap/server-types WP 2.2): the "No type / Untyped" choice always leads,
  // then every server type with its lifecycle status inline in the label. Rendered even with zero
  // types so "No type" is always selectable.
  const typeOptions = useMemo(
    () => [
      { value: UNTYPED_OPTION, label: "No type (Untyped)" },
      ...(props.serverTypes ?? []).map((type) => ({
        value: type.id,
        label: `${type.name} · ${SERVER_TYPE_STATUS_LABELS[type.status]}`,
      })),
    ],
    [props.serverTypes],
  );

  useEffect(() => {
    if (!props.open) return;
    const next = props.server ? fromServer(props.server) : defaultForm;
    setForm(next);
    setBaseline(JSON.stringify(next));
    // Reauth opens at the AUTH step with the stored auth preselected (never forced back to step 1,
    // the URL field — the P0 fix). The normal add/edit flow still starts at Connection.
    setStep(isReauth ? "auth" : "connection");
    setConnectionExpanded(!isReauth);
    setProbe(null);
    setSavedServer(null);
    setOauthUrl(null);
    setBusy(null);
    setError(null);
    setConnErrors({});
  }, [props.open, props.server, isReauth]);

  /**
   * Validate the connection step BEFORE advancing (S14): a required field that's empty gets an inline
   * message and steals focus — the primary button never silently no-ops. HTTP needs a URL; stdio needs
   * a command.
   */
  function validateConnection(): boolean {
    const errs: ConnectionErrors = {};
    if (form.transport === "streamable_http") {
      const url = form.url.trim();
      if (!url) {
        errs.url = "Enter a server URL.";
      } else if (!isValidHttpUrl(url)) {
        // S14 / audit: catch a malformed URL HERE (mark the field invalid + inline error) instead of
        // probing it and surfacing a raw "Failed to fetch" with the field still reading valid.
        errs.url = "Enter a valid URL, e.g. https://example.com/mcp.";
      }
    } else if (!form.command.trim()) {
      errs.command = "Enter a command to run.";
    }
    setConnErrors(errs);
    const firstInvalid = errs.url ? "wizard-url" : errs.command ? "wizard-command" : null;
    if (firstInvalid) {
      document.getElementById(firstInvalid)?.focus();
      return false;
    }
    return true;
  }

  // Dirty = the user changed a field from the opened state. (Wizard progress — probe/step — isn't
  // "unsaved input".) A programmatic reauth open of an unchanged server stays not-dirty, so it closes
  // without a prompt.
  const dirty = JSON.stringify(form) !== baseline;
  const guard = useUnsavedChangesGuard(dirty, props.onOpenChange);

  async function runProbe(auth?: ServerAuthInput) {
    setBusy("probe");
    setError(null);
    try {
      const result = await props.onProbeServer({
        name: form.name.trim() || undefined,
        url: form.url.trim(),
        auth: auth ?? { type: "none" },
      });
      setProbe(result);
      if (result.ok) {
        setFormValue("authType", auth?.type ?? "none");
        setStep("review");
      } else if (result.authRequired) {
        setStep("auth");
      } else {
        setError(result.errorMessage ?? result.message);
      }
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function saveServer(authOverride?: ServerAuthInput) {
    const payload = buildPayload(form, authOverride);
    const existingServer = savedServer ?? props.server;
    if (existingServer) {
      const updated = await props.onUpdateServer(existingServer.id, payload);
      setSavedServer(updated);
      return updated;
    }
    const created = await props.onCreateServer(payload as ServerConfigInput);
    setSavedServer(created);
    return created;
  }

  /**
   * The single "this save is done" exit path — replaces the old direct
   * `onComplete?.(id); onOpenChange(false)` at all three completion sites (plain save, OAuth
   * already-authorized, OAuth post-login verify).
   */
  async function finishAfterSave(serverId: string) {
    props.onComplete?.(serverId);
    props.onOpenChange(false);
  }

  async function saveAndClose() {
    setBusy("save");
    setError(null);
    try {
      const saved = await saveServer(authInputFromForm(form));
      await finishAfterSave(saved.id);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function startOAuth() {
    setBusy("oauth");
    setError(null);
    try {
      if (form.oauthClientSecret.trim() && !form.oauthClientId.trim()) {
        setError("OAuth Client Secret requires an OAuth Client ID.");
        document.getElementById("wizard-oauth-id")?.focus();
        return;
      }
      const oauthAuth = authInputFromForm(form);
      const server = await saveServer(oauthAuth);
      const result = await props.onStartOAuth(server.id, oauthClientFromForm(form));
      if (result.status === "authorized") {
        await finishAfterSave(server.id);
        return;
      }
      if (!result.authorizationUrl) throw new Error("OAuth authorization URL was not returned");
      setOauthUrl(result.authorizationUrl);
      setStep("review");
      window.open(result.authorizationUrl, "_blank", "noopener,noreferrer");
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function verifyOAuth() {
    if (!activeServer) return;
    setBusy("oauth-test");
    setError(null);
    try {
      const result = await props.onTestServer(activeServer.id);
      if (!result.ok) {
        setError(result.errorMessage ?? "OAuth is not connected yet");
        return;
      }
      await finishAfterSave(activeServer.id);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  function setFormValue<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
    // Clear the matching inline error the moment the user edits the field (S14).
    if (key === "url" || key === "command") {
      const field = key as "url" | "command";
      setConnErrors((c) => (c[field] ? { ...c, [field]: undefined } : c));
    }
  }

  /**
   * R-MCP13 — the bundled research-server recipe: an explicit preset SELECTION prefills the
   * connection step (stdio transport, command/args, and the expected env variable NAME with an
   * EMPTY value — the owner still pastes their own key). Never auto-applied; the owner clicks one.
   */
  function applyResearchPreset(preset: ResearchServerPreset) {
    setForm((current) => ({
      ...current,
      name: preset.name,
      transport: "stdio",
      command: preset.command,
      args: preset.args,
      env: preset.envKeys.map((key) => ({ key, value: "" })),
    }));
    setConnErrors({});
    setProbe(null);
  }

  // The generic error banner — surfaced at the top of whichever step is active (the WideDialog rail
  // only mounts the active section, so it appears once, in context).
  const errorAlert = error ? (
    <Alert variant="destructive">
      <AlertDescription>{error}</AlertDescription>
    </Alert>
  ) : null;

  const connectionContent = (
    <div className="flex flex-col gap-4">
      {errorAlert}
      {/* R-MCP13 — research-server recipe: curated search/fetch presets, new servers only.
          Selecting one just prefills the connection fields below (stdio + command/args + the
          env var NAME) — no bundled key, no network call, nothing saved until "Continue". */}
      {!editing ? (
        <div className="flex flex-col gap-1.5">
          <Label className="flex items-center gap-1.5">
            <Search aria-hidden className="size-3.5" />
            Quick start: research servers
          </Label>
          <div className="flex flex-wrap gap-2">
            {RESEARCH_SERVER_PRESETS.map((preset) => (
              <Button
                key={preset.id}
                type="button"
                variant="outline"
                size="sm"
                className="h-auto flex-col items-start gap-0.5 py-2 text-left"
                onClick={() => applyResearchPreset(preset)}
              >
                <span className="font-medium">{preset.label}</span>
                <span className="text-caption font-normal text-muted-foreground">
                  {preset.description}
                </span>
              </Button>
            ))}
          </div>
          <Text variant="meta" tone="muted">
            Fills in a ready-to-run command below — paste your own API key in the Environment
            variables field (no key is bundled). Powers the Assistant's search-grounded research
            mode; see the app's user guide for the full recipe, or fill in the connection fields
            yourself.
          </Text>
        </div>
      ) : null}

      {/* P0 reauth: the connection fields start collapsed — the user came to sign in again, not to
          re-type the URL. A read-only summary + "Edit connection settings" reveals them on demand. */}
      {isReauth && !connectionExpanded ? (
        <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-muted/40 p-3">
          <div className="flex min-w-0 flex-col">
            <Text variant="meta" tone="muted">
              {form.transport === "streamable_http" ? "Server URL" : "Command"}
            </Text>
            <Text
              className="min-w-0 truncate font-mono text-body"
              title={form.transport === "streamable_http" ? form.url : form.command}
            >
              {(form.transport === "streamable_http" ? form.url : form.command) || "—"}
            </Text>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="shrink-0"
            onClick={() => setConnectionExpanded(true)}
          >
            <Pencil aria-hidden />
            <span>Edit connection settings</span>
          </Button>
        </div>
      ) : null}

      {connectionExpanded ? (
        <>
          <div className="flex flex-col gap-1.5">
            <Label>Transport</Label>
            <ToggleGroup
              type="single"
              variant="outline"
              value={form.transport}
              onValueChange={(value) => value && setFormValue("transport", value as TransportType)}
            >
              <ToggleGroupItem value="streamable_http">
                <Link2 aria-hidden />
                <span>URL</span>
              </ToggleGroupItem>
              <ToggleGroupItem value="stdio">
                <Server aria-hidden />
                <span>Local command</span>
              </ToggleGroupItem>
            </ToggleGroup>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <FieldRow id="wizard-name" label="Name">
              <Input
                id="wizard-name"
                value={form.name}
                // SV1: a stable example placeholder — never a live-derived value that suggests a
                // name already exists. When left blank we still derive one on save (resolvedName).
                placeholder="My MCP server"
                onChange={(event) => setFormValue("name", event.target.value)}
              />
            </FieldRow>
            {/* Optional type assignment (roadmap/server-types WP 2.2). Untyped by default; the
            option label carries the lifecycle status. Manage the list from the servers rail. */}
            <SelectField
              id="wizard-type"
              label="Type"
              value={form.typeId ?? UNTYPED_OPTION}
              options={typeOptions}
              onChange={(value) => setFormValue("typeId", value === UNTYPED_OPTION ? null : value)}
            />
            {form.transport === "streamable_http" ? (
              <FieldRow id="wizard-url" label="Server URL" wide required error={connErrors.url}>
                <Input
                  id="wizard-url"
                  type="url"
                  inputMode="url"
                  spellCheck={false}
                  autoComplete="off"
                  aria-invalid={Boolean(connErrors.url)}
                  value={form.url}
                  placeholder="https://example.com/mcp"
                  onChange={(event) => {
                    setFormValue("url", event.target.value);
                    setProbe(null);
                  }}
                />
              </FieldRow>
            ) : (
              <>
                <FieldRow id="wizard-command" label="Command" required error={connErrors.command}>
                  <Input
                    id="wizard-command"
                    spellCheck={false}
                    autoComplete="off"
                    aria-invalid={Boolean(connErrors.command)}
                    value={form.command}
                    onChange={(event) => setFormValue("command", event.target.value)}
                  />
                </FieldRow>
                {/* SV2: one arg per row (no hand-written JSON array with a leftover example). */}
                <FieldRow id="wizard-args" label="Arguments" wide>
                  <ListEditor
                    aria-label="Command arguments"
                    value={form.args}
                    onChange={(items) => setFormValue("args", items)}
                    placeholder="e.g. -y"
                    addLabel="Add argument"
                  />
                  <Text variant="meta" tone="muted">
                    One argument per row, e.g. <code className="font-mono">-y</code>{" "}
                    <code className="font-mono">@modelcontextprotocol/server-filesystem</code>.
                  </Text>
                </FieldRow>
                {/* SV2: key/value rows with masked secrets — no raw Env JSON. */}
                <FieldRow id="wizard-env" label="Environment variables" wide>
                  <KeyValueEditor
                    aria-label="Environment variables"
                    secret
                    value={form.env}
                    onChange={(pairs) => setFormValue("env", pairs)}
                    keyPlaceholder="API_KEY"
                    addLabel="Add variable"
                  />
                  {editing ? (
                    <Text variant="meta" tone="muted">
                      Stored secrets are never shown. Add a row only to set or replace a value.
                    </Text>
                  ) : null}
                </FieldRow>
              </>
            )}
          </div>
        </>
      ) : null}
    </div>
  );

  const authContent = (
    <div className="flex flex-col gap-4">
      {errorAlert}
      {probe ? (
        <Alert variant="warning">
          <AlertDescription>{probe.message}</AlertDescription>
        </Alert>
      ) : null}

      <RadioGroup
        aria-label="Authentication method"
        className="grid gap-2 sm:grid-cols-2"
        value={form.authType}
        onValueChange={(value) => value && setFormValue("authType", value as ServerAuthType)}
      >
        {AUTH_OPTIONS.map((option) => {
          const id = `wizard-auth-${option.value}`;
          const active = form.authType === option.value;
          return (
            <Label
              key={option.value}
              htmlFor={id}
              className={cn(
                "flex h-full cursor-pointer flex-col gap-1 rounded-md border p-3 text-left font-normal whitespace-normal",
                active ? "border-primary bg-primary/5" : "border-border",
              )}
            >
              <span className="flex items-center gap-2 font-medium">
                <RadioGroupItem id={id} value={option.value} />
                <option.icon aria-hidden />
                {option.label}
              </span>
              <span className="pl-6 text-caption text-muted-foreground">
                {option.value === "oauth" && probe?.oauthAvailable
                  ? "Discovery available"
                  : option.description}
              </span>
            </Label>
          );
        })}
      </RadioGroup>

      {form.authType === "bearer" ? (
        <div className="flex flex-col gap-3">
          <FieldRow id="wizard-bearer" label="Bearer token">
            <Input
              id="wizard-bearer"
              type="password"
              value={form.bearerToken}
              onChange={(event) => setFormValue("bearerToken", event.target.value)}
            />
          </FieldRow>
          <div>
            <Button
              variant="outline"
              onClick={() => void runProbe({ type: "bearer", token: form.bearerToken })}
              disabled={Boolean(busy) || !form.bearerToken.trim()}
            >
              Test token
            </Button>
          </div>
        </div>
      ) : null}

      {form.authType === "api_key" ? (
        <div className="flex flex-col gap-3">
          <div className="grid gap-4 sm:grid-cols-2">
            <FieldRow id="wizard-apikey-header" label="Header name">
              <Input
                id="wizard-apikey-header"
                value={form.apiKeyHeader}
                onChange={(event) => setFormValue("apiKeyHeader", event.target.value)}
              />
            </FieldRow>
            <FieldRow id="wizard-apikey" label="API key">
              <Input
                id="wizard-apikey"
                type="password"
                value={form.apiKey}
                onChange={(event) => setFormValue("apiKey", event.target.value)}
              />
            </FieldRow>
          </div>
          <div>
            <Button
              variant="outline"
              onClick={() =>
                void runProbe({
                  type: "api_key",
                  headerName: form.apiKeyHeader,
                  key: form.apiKey,
                })
              }
              disabled={Boolean(busy) || !form.apiKeyHeader.trim() || !form.apiKey.trim()}
            >
              Test API key
            </Button>
          </div>
        </div>
      ) : null}

      {form.authType === "oauth" ? (
        <div className="flex flex-col gap-3 rounded-md border border-border bg-muted/40 p-4">
          <Text variant="meta" tone="muted">
            OAuth opens the provider authorization page. Providers without dynamic registration need
            a pre-registered client.
          </Text>
          <div className="grid gap-4 sm:grid-cols-2">
            <FieldRow id="wizard-oauth-id" label="OAuth Client ID">
              <Input
                id="wizard-oauth-id"
                value={form.oauthClientId}
                onChange={(event) => setFormValue("oauthClientId", event.target.value)}
              />
            </FieldRow>
            <FieldRow id="wizard-oauth-secret" label="OAuth Client Secret">
              <Input
                id="wizard-oauth-secret"
                type="password"
                placeholder="Optional"
                value={form.oauthClientSecret}
                onChange={(event) => setFormValue("oauthClientSecret", event.target.value)}
              />
            </FieldRow>
            <FieldRow id="wizard-callback" label="Callback URL" wide>
              <Input id="wizard-callback" readOnly value={callbackUrl} />
            </FieldRow>
          </div>
          {/* The forward action ("Save and start OAuth") lives in the sticky footer with every other
              step's forward action — not a second button buried in this panel. */}
        </div>
      ) : null}

      {form.authType === "none" ? (
        <Text variant="meta" tone="muted" className="text-pretty">
          This server will be contacted without credentials. Continue to review and save.
        </Text>
      ) : null}
    </div>
  );

  const reviewContent = (
    <div className="flex flex-col gap-4">
      {errorAlert}
      {probe?.ok ? (
        <Alert variant="success">
          <AlertDescription>{probe.message}</AlertDescription>
        </Alert>
      ) : null}
      {oauthUrl ? (
        <Alert variant="info">
          <AlertDescription>
            OAuth started. If the browser did not open, use the authorization link below.
          </AlertDescription>
        </Alert>
      ) : null}
      {oauthUrl ? (
        <Button asChild variant="outline" className="w-fit">
          <a href={oauthUrl} target="_blank" rel="noreferrer">
            <ExternalLink aria-hidden />
            <span>Open authorization page</span>
          </a>
        </Button>
      ) : null}
      <Descriptions columns={1}>
        <DescriptionsItem label="Name">{resolvedName(form)}</DescriptionsItem>
        <DescriptionsItem label="Transport">{form.transport}</DescriptionsItem>
        <DescriptionsItem label="Endpoint">
          {form.transport === "streamable_http" ? form.url : form.command}
        </DescriptionsItem>
        <DescriptionsItem label="Authentication">
          {form.transport === "stdio"
            ? "Local command"
            : authSummaryText(form.authType, form.apiKeyHeader)}
        </DescriptionsItem>
      </Descriptions>
    </div>
  );

  // One WideDialog section per wizard step (the rail is the step indicator + backward nav).
  const sections: WideDialogSection[] = steps.map((s) => ({
    id: s.id,
    label: s.label,
    content:
      s.id === "connection" ? connectionContent : s.id === "auth" ? authContent : reviewContent,
  }));

  // Backward-only rail navigation: a linear wizard can't skip forward past an un-validated step, so
  // the rail only lets you jump to an EARLIER step (equivalent to the Back button). Never while busy
  // or on the post-save interstitial.
  const stepOrder = steps.map((s) => s.id);
  function handleSectionChange(id: string) {
    if (busy) return;
    const currentIndex = stepOrder.indexOf(step);
    const targetIndex = stepOrder.indexOf(id);
    if (targetIndex !== -1 && targetIndex < currentIndex) setStep(id as WizardStep);
  }

  const footer =
    (
      // Back grouped LEFT; Cancel + the step's forward/commit action grouped right (kit footer rule).
      <div className="flex w-full items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {step !== "connection" ? (
            <Button
              variant="outline"
              onClick={() =>
                setStep(
                  step === "review" && form.transport === "streamable_http" ? "auth" : "connection",
                )
              }
              disabled={Boolean(busy)}
            >
              Back
            </Button>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          {/* SV3: no "Delete server" here — deletion lives only in the registry row menu + confirm. */}
          <Button
            variant="outline"
            onClick={() => guard.requestOpenChange(false)}
            disabled={Boolean(busy)}
          >
            Cancel
          </Button>
          {step === "connection" && form.transport === "streamable_http" ? (
            // S14: enabled so an empty URL yields an inline error (never a silent no-op); the label
            // reads as the step's forward action.
            <Button
              onClick={() => validateConnection() && void runProbe({ type: "none" })}
              disabled={Boolean(busy)}
            >
              <Wifi aria-hidden />
              <span>{busy === "probe" ? "Testing…" : "Test & continue"}</span>
            </Button>
          ) : null}
          {step === "connection" && form.transport === "stdio" ? (
            <Button
              onClick={() => validateConnection() && setStep("review")}
              disabled={Boolean(busy)}
            >
              Continue
            </Button>
          ) : null}
          {/* Auth step forward action (T7): OAuth saves + starts the provider flow; every other
              method (incl. "None") continues to Review, where the server is saved. */}
          {step === "auth" ? (
            form.authType === "oauth" ? (
              <Button onClick={() => void startOAuth()} disabled={Boolean(busy)}>
                <ExternalLink aria-hidden />
                <span>{busy === "oauth" ? "Starting OAuth…" : "Save and start OAuth"}</span>
              </Button>
            ) : (
              <Button onClick={() => setStep("review")} disabled={Boolean(busy)}>
                Continue
              </Button>
            )
          ) : null}
          {step === "review" && form.authType !== "oauth" ? (
            <Button onClick={() => void saveAndClose()} disabled={Boolean(busy)}>
              <Save aria-hidden />
              <span>{busy === "save" ? "Saving…" : "Save server"}</span>
            </Button>
          ) : null}
          {step === "review" && form.authType === "oauth" && activeServer ? (
            <Button onClick={() => void verifyOAuth()} disabled={Boolean(busy)}>
              <Wifi aria-hidden />
              <span>{busy === "oauth-test" ? "Checking…" : "I completed login"}</span>
            </Button>
          ) : null}
        </div>
      </div>
    );

  return (
    <>
      <WideDialog
        open={props.open}
        onOpenChange={guard.requestOpenChange}
        title={
          isReauth
            ? `Sign in again to ${reauthServerName}`
            : editing
              ? "Edit MCP server"
              : "Add MCP server"
        }
        description={
          isReauth
            ? `Your ${reauthProviderLabel} session expired. Sign in to finish ${reauthActionLabel}.`
            : "Start with the server URL. Authentication is tested and configured only when the server asks for it."
        }
        sections={sections}
        activeSectionId={step}
        onActiveSectionChange={handleSectionChange}
        footer={footer}
      />
      <DiscardChangesDialog
        open={guard.confirming}
        onConfirm={guard.confirmDiscard}
        onCancel={guard.cancelDiscard}
      />
    </>
  );
}

const AUTH_OPTIONS: {
  value: ServerAuthType;
  label: string;
  description: string;
  icon: typeof KeyRound;
}[] = [
  { value: "none", label: "None", description: "Connect without credentials", icon: ShieldOff },
  { value: "bearer", label: "Bearer token", description: "Authorization header", icon: KeyRound },
  { value: "api_key", label: "API key", description: "Custom header name", icon: KeyRound },
  { value: "oauth", label: "OAuth", description: "Try provider login", icon: ExternalLink },
];

function fromServer(server: ServerConfig): FormState {
  return {
    ...defaultForm,
    name: server.name,
    transport: server.transport,
    url: server.url ?? "",
    command: server.command ?? "",
    args: server.args ?? [],
    // Env secrets are never returned by the API, so the editor starts empty — a row set/replaces one.
    env: [],
    authType: server.authType,
    apiKeyHeader: server.authHeaderName ?? "Authorization",
    // Prefill the stored OAuth client id so editing an oauth server "remembers" it (the secret is
    // never returned, so it stays blank — leaving it blank keeps the stored secret).
    oauthClientId: server.oauthClientId ?? "",
    // Pre-select the server's current type when editing (null = Untyped).
    typeId: server.typeId ?? null,
  };
}

function buildPayload(
  form: FormState,
  authOverride?: ServerAuthInput,
): ServerConfigInput | ServerConfigUpdate {
  if (form.transport === "stdio") {
    return {
      name: resolvedName(form),
      transport: "stdio",
      command: form.command.trim(),
      // Drop blank arg rows; build the env record from non-empty keys (last write wins).
      args: form.args.map((a) => a.trim()).filter((a) => a.length > 0),
      env: envRecord(form.env),
      // Type assignment travels on both create and update (null clears it — D-ST5).
      typeId: form.typeId,
    };
  }
  return {
    name: resolvedName(form),
    transport: "streamable_http",
    url: form.url.trim(),
    auth: authOverride ?? authInputFromForm(form),
    typeId: form.typeId,
  };
}

function authInputFromForm(form: FormState): ServerAuthInput {
  if (form.authType === "bearer") return { type: "bearer", token: form.bearerToken || undefined };
  if (form.authType === "api_key") {
    return {
      type: "api_key",
      headerName: form.apiKeyHeader.trim() || "Authorization",
      key: form.apiKey || undefined,
    };
  }
  if (form.authType === "oauth") return { type: "oauth", ...oauthClientFromForm(form) };
  if (form.authType === "custom_headers")
    return { type: "custom_headers", headers: parseJson(form.customHeadersText, {}) };
  return { type: "none" };
}

function oauthClientFromForm(form: FormState): OAuthClientInput | undefined {
  const clientId = form.oauthClientId.trim();
  const clientSecret = form.oauthClientSecret.trim();
  if (!clientId && !clientSecret) return undefined;
  return { clientId: clientId || undefined, clientSecret: clientSecret || undefined };
}

function resolvedName(form: FormState): string {
  return (
    form.name.trim() ||
    (form.transport === "streamable_http" ? defaultNameFromUrl(form.url) : form.command.trim()) ||
    "MCP server"
  );
}

function defaultNameFromUrl(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "MCP server";
  }
}

function authSummaryText(type: ServerAuthType, headerName: string): string {
  if (type === "none") return "No authentication";
  if (type === "bearer") return "Bearer token";
  if (type === "api_key") return `API key in ${headerName}`;
  if (type === "oauth") return "OAuth";
  return "Custom headers";
}

/** A streamable-HTTP MCP endpoint must parse as an absolute http(s) URL — the client-side guard that
 *  stops a malformed URL from being probed (and coming back as a raw "Failed to fetch"). */
function isValidHttpUrl(raw: string): boolean {
  try {
    const parsed = new URL(raw);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function parseJson<T>(text: string, fallback: T): T {
  if (!text.trim()) return fallback;
  return JSON.parse(text) as T;
}

/** Build the env record from key/value rows: skip blank keys, trim keys, last write wins. */
function envRecord(pairs: KeyValuePair[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const { key, value } of pairs) {
    const k = key.trim();
    if (k) out[k] = value;
  }
  return out;
}
