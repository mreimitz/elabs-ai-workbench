// Resource "Read" + Prompt "Get" consoles — read-only siblings of ToolRunDialog. Each is a Dialog
// showing the live result (JSON) in a @elabs-ai/components-editor CodeEditor with an ok/error Badge, a copy
// button, and a full-width footer of token/byte/time KPIs computed from the result. They execute
// resources/read and prompts/get on the API (which owns the MCP connection). No destructive confirm
// — both are read-only operations.
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import type {
  PromptGetResult,
  ResourceReadResult,
  TokenProfileId,
} from "@mcp-token-footprint/shared";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  ResizableHandle,
  ResizablePanel,
  ScrollArea,
  Separator,
  StatePanel,
  Text,
} from "@elabs-ai/components-ui";
import { CodeEditor } from "@elabs-ai/components-editor";
import { Check, Copy, Download, KeyRound, Play } from "lucide-react";
import { useMcpAuth } from "../servers/McpAuthProvider";
import { AdaptivePanelGroup } from "../../components/AdaptivePanelGroup";
import { apiPost } from "../../lib/api";
import { getErrorMessage } from "../../lib/errors";
import { formatBytes, formatNumber } from "../../lib/format";
import { KpiStat } from "../../components/KpiStat";
import { READ_ONLY_OPTIONS } from "../../lib/monaco";

/** The request/response KPI row shared by both dialogs (only rendered once a result exists). */
function ResultKpis(props: {
  requestTokens: number;
  requestBytes: number;
  responseTokens: number;
  responseBytes: number;
  durationMs: number;
  isError: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
      <KpiStat
        label="Tokens sent"
        value={formatNumber(props.requestTokens)}
        sub={formatBytes(props.requestBytes)}
      />
      <KpiStat
        label="Tokens received"
        value={formatNumber(props.responseTokens)}
        sub={formatBytes(props.responseBytes)}
      />
      <KpiStat
        label="Round-trip"
        value={formatNumber(props.requestTokens + props.responseTokens)}
        sub="tokens"
      />
      <KpiStat
        label="Duration"
        value={`${formatNumber(props.durationMs)} ms`}
        sub={props.isError ? "error" : "ok"}
      />
    </div>
  );
}

/** A read-only JSON result viewer in a bordered CodeEditor (mirrors ToolPlayground's result pane). */
function ResultEditor({ value, ariaLabel }: { value: string; ariaLabel: string }) {
  return (
    <div className="min-h-0 flex-1 overflow-hidden rounded-md border border-border">
      <CodeEditor
        value={value || "(empty result)"}
        language="json"
        readOnly
        height="100%"
        ariaLabel={ariaLabel}
        options={READ_ONLY_OPTIONS}
      />
    </div>
  );
}

function useCopy(content: string) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  }
  return { copied, copy };
}

// ── Resource read ───────────────────────────────────────────────────────────────────────────────

/**
 * Read one MCP resource (`resources/read`) and show its contents + runtime token cost. Resources
 * take no arguments, so this auto-fetches on open (good UX for a read-only op) with a Re-read button.
 * State resets whenever the targeted `uri` changes.
 */
export function ResourceReadDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  serverId: string;
  uri: string;
  tokenProfile?: TokenProfileId;
}) {
  const { open, onOpenChange, serverId, uri, tokenProfile } = props;
  const { requestReauth } = useMcpAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // SV5: an expired-auth read is a TERMINAL state INSIDE this modal — never an auto-opened edit
  // wizard. The user re-authenticates explicitly via the action button, then we retry the read.
  const [authExpired, setAuthExpired] = useState(false);
  const [reauthing, setReauthing] = useState(false);
  const [result, setResult] = useState<ResourceReadResult | null>(null);

  const resultContent = useMemo(
    () => (result ? JSON.stringify(result.contents ?? result.raw ?? null, null, 2) : ""),
    [result],
  );
  const { copied, copy } = useCopy(resultContent);

  // M4 — stale-response guard: a request token bumped on every `read()` call. Retargeting to a new
  // `uri`/`serverId` while a read is in flight (the auto-fetch effect below fires again) must not
  // let the OLDER response's `setResult`/`setError`/`setAuthExpired`/`setBusy(false)` land after the
  // newer request has already started — latest request always wins.
  const requestIdRef = useRef(0);

  async function read() {
    const requestId = ++requestIdRef.current;
    const url = `/api/servers/${serverId}/resources/read`;
    const body = { uri, tokenProfile };

    setBusy(true);
    setError(null);
    setAuthExpired(false);
    setResult(null);
    try {
      const res = await apiPost<ResourceReadResult>(url, body);
      if (requestId !== requestIdRef.current) return; // superseded by a newer read
      // SV5: expired auth stays in THIS modal as a terminal state with an explicit "Re-authenticate"
      // action — we do NOT silently open the edit wizard on top of the read.
      if (res.authRequired) {
        setAuthExpired(true);
        return;
      }
      setResult(res);
      if (res.isError)
        setError(res.errorMessage ?? "The server reported an error reading the resource.");
    } catch (err) {
      if (requestId !== requestIdRef.current) return; // superseded by a newer read
      setError(getErrorMessage(err, "The server didn’t return a reason."));
    } finally {
      if (requestId === requestIdRef.current) setBusy(false);
    }
  }

  // User-initiated: route re-authentication through the settings window (repo convention), then retry
  // the read on success. Failure/cancel leaves the terminal auth-expired state in place.
  async function reauthenticate() {
    setReauthing(true);
    try {
      const gate = await requestReauth(serverId);
      if (gate.ok) {
        setAuthExpired(false);
        await read();
      }
    } finally {
      setReauthing(false);
    }
  }

  // Auto-fetch on open; re-fetch (and reset) whenever the targeted uri changes while open.
  useEffect(() => {
    if (!open) return;
    void read();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, uri, serverId]);

  // Reset stale result/error when the dialog is closed or retargeted.
  useEffect(() => {
    if (!open) {
      setResult(null);
      setError(null);
      setAuthExpired(false);
      setReauthing(false);
      setBusy(false);
    }
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="full" className="flex flex-col gap-0 p-0">
        <DialogHeader className="flex-none gap-1 border-b border-border p-4 pe-12">
          <DialogTitle className="truncate font-mono text-base" title={uri}>
            {uri}
          </DialogTitle>
          <DialogDescription>
            Runs <code className="font-mono">resources/read</code> on the live server and measures
            request/response token cost.
          </DialogDescription>
        </DialogHeader>

        {/* RESULT — single column (resources take no arguments) */}
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex flex-none items-center justify-between gap-2 px-4 py-2.5">
            <div className="flex items-center gap-2">
              <Text variant="meta" tone="muted">
                Contents
              </Text>
              {result ? (
                <Badge variant={result.isError ? "destructive" : "success"}>
                  {result.isError ? "error" : "ok"}
                </Badge>
              ) : null}
            </div>
            {result ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void copy()}
                aria-label="Copy resource contents JSON"
              >
                {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
                <span>{copied ? "Copied" : "Copy"}</span>
              </Button>
            ) : null}
          </div>
          <div className="min-h-0 flex-1 px-4 pb-4">
            {busy ? (
              // ONE loading indicator (SV5): the StatePanel — the footer button no longer echoes it.
              <div className="grid h-full place-items-center">
                <StatePanel
                  kind="loading"
                  title="Reading resource…"
                  description="Fetching the contents and measuring token cost."
                />
              </div>
            ) : authExpired ? (
              // SV5 terminal state: authentication expired — recover in place, never a surprise wizard.
              <div className="grid h-full place-items-center">
                <StatePanel
                  kind="error"
                  title="Authentication expired"
                  description="This server needs to be re-authenticated before it can read resources."
                  actions={
                    <Button onClick={() => void reauthenticate()} disabled={reauthing}>
                      <KeyRound aria-hidden />
                      <span>{reauthing ? "Re-authenticating…" : "Re-authenticate"}</span>
                    </Button>
                  }
                />
              </div>
            ) : !result && !error ? (
              <div className="grid h-full place-items-center">
                <StatePanel
                  kind="empty"
                  title="No contents yet"
                  description="Read the resource to see its contents and token cost."
                />
              </div>
            ) : (
              <div className="flex h-full min-h-0 flex-col gap-3 duration-300 animate-in fade-in motion-reduce:animate-none">
                {error ? (
                  <Alert variant="destructive" className="flex-none">
                    <AlertTitle>Couldn’t read the resource. Select Re-read to try again.</AlertTitle>
                    <AlertDescription>{error}</AlertDescription>
                  </Alert>
                ) : null}
                {result ? (
                  <ResultEditor value={resultContent} ariaLabel="Resource contents JSON" />
                ) : null}
              </div>
            )}
          </div>
        </div>

        {/* FOOTER — re-read action (left) · result KPIs (right) */}
        <div className="flex flex-none flex-wrap items-center justify-between gap-x-6 gap-y-3 border-t border-border p-4">
          <Button onClick={() => void read()} disabled={busy || reauthing}>
            <Download aria-hidden />
            <span>{result || error || authExpired ? "Re-read" : "Read resource"}</span>
          </Button>
          {result ? (
            <ResultKpis
              requestTokens={result.requestTokens}
              requestBytes={result.requestBytes}
              responseTokens={result.responseTokens}
              responseBytes={result.responseBytes}
              durationMs={result.durationMs}
              isError={result.isError}
            />
          ) : (
            <Text variant="meta" tone="muted">
              Token &amp; byte cost appears here after a read.
            </Text>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Prompt get ──────────────────────────────────────────────────────────────────────────────────

/** A single declared prompt argument (all MCP prompt args are strings). */
type PromptArg = { name: string; description?: string; required?: boolean };

/** Parse a prompt's declared `arguments` (typed `unknown` on the wire) into a string-arg list. */
export function parsePromptArgs(raw: unknown): PromptArg[] {
  if (!Array.isArray(raw)) return [];
  const args: PromptArg[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const obj = entry as Record<string, unknown>;
    if (typeof obj.name !== "string" || obj.name.length === 0) continue;
    args.push({
      name: obj.name,
      description: typeof obj.description === "string" ? obj.description : undefined,
      required: obj.required === true,
    });
  }
  // Required first, stable within each group.
  return [...args.filter((a) => a.required), ...args.filter((a) => !a.required)];
}

/**
 * Get one MCP prompt (`prompts/get`) with its declared string arguments and show the resolved
 * messages + runtime token cost. Mirrors ToolRunDialog's split layout (args form left, result
 * right) with the same validate / focus-first-error / busy flow.
 */
export function PromptGetDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  serverId: string;
  promptName: string;
  args: unknown;
  tokenProfile?: TokenProfileId;
}) {
  const { open, onOpenChange, serverId, promptName, args, tokenProfile } = props;
  const { requestReauth } = useMcpAuth();
  const promptArgs = useMemo(() => parsePromptArgs(args), [args]);
  const firstOptionalName = useMemo(() => promptArgs.find((a) => !a.required)?.name, [promptArgs]);

  const [values, setValues] = useState<Record<string, string>>({});
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PromptGetResult | null>(null);

  // Fresh form whenever the targeted prompt changes.
  useEffect(() => {
    setValues({});
    setFieldErrors({});
    setError(null);
    setResult(null);
  }, [promptName]);

  const setValue = (name: string, value: string) => {
    setValues((current) => ({ ...current, [name]: value }));
    setFieldErrors((current) => (current[name] ? { ...current, [name]: "" } : current));
  };

  const resultContent = useMemo(
    () => (result ? JSON.stringify(result.messages ?? result.raw ?? null, null, 2) : ""),
    [result],
  );
  const { copied, copy } = useCopy(resultContent);

  function validate(): Record<string, string> {
    const errs: Record<string, string> = {};
    for (const a of promptArgs) {
      const v = values[a.name];
      if (a.required && (v === undefined || v === "")) errs[a.name] = "This field is required.";
    }
    return errs;
  }

  async function execute() {
    const errs = validate();
    setFieldErrors(errs);
    const firstInvalid = promptArgs.find((a) => errs[a.name]);
    if (firstInvalid) {
      document.getElementById(`prompt-arg-${firstInvalid.name}`)?.focus();
      return;
    }

    const argMap: Record<string, string> = {};
    for (const a of promptArgs) {
      const v = values[a.name];
      if (v === undefined || v === "") continue;
      argMap[a.name] = v;
    }

    const url = `/api/servers/${serverId}/prompts/${encodeURIComponent(promptName)}/get`;
    const body = { arguments: argMap, tokenProfile };

    setBusy(true);
    setError(null);
    setResult(null);
    try {
      let res = await apiPost<PromptGetResult>(url, body);
      // Reactive reauth: an expired OAuth token comes back as authRequired → modal, then retry once.
      if (res.authRequired) {
        const gate = await requestReauth(serverId);
        if (gate.ok) res = await apiPost<PromptGetResult>(url, body);
      }
      setResult(res);
      if (res.isError)
        setError(res.errorMessage ?? "The server reported an error getting the prompt.");
    } catch (err) {
      setError(getErrorMessage(err, "The server didn’t return a reason."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="full" className="flex flex-col gap-0 p-0">
        <DialogHeader className="flex-none gap-1 border-b border-border p-4 pe-12">
          <DialogTitle className="truncate font-mono text-base" title={promptName}>
            {promptName}
          </DialogTitle>
          <DialogDescription>
            Runs <code className="font-mono">prompts/get</code> on the live server and measures
            request/response token cost.
          </DialogDescription>
        </DialogHeader>

        <AdaptivePanelGroup className="min-h-0 flex-1">
          {/* LEFT — arguments form (all string) */}
          <ResizablePanel defaultSize={33} minSize={28} className="flex min-h-0 flex-col">
            <div className="flex flex-none items-center justify-between gap-2 px-4 py-2.5">
              <Text variant="meta" tone="muted">
                Arguments
              </Text>
              <Badge variant="secondary">{promptArgs.length}</Badge>
            </div>
            <ScrollArea className="min-h-0 flex-1">
              <form
                id="prompt-get-form"
                className="flex flex-col gap-3.5 px-4 pb-4"
                onSubmit={(event) => {
                  event.preventDefault();
                  void execute();
                }}
              >
                {promptArgs.length === 0 ? (
                  <Text tone="muted" className="text-sm">
                    This prompt takes no arguments.
                  </Text>
                ) : (
                  promptArgs.map((a) => {
                    const errorId = fieldErrors[a.name] ? `prompt-arg-${a.name}-error` : undefined;
                    return (
                      <Fragment key={a.name}>
                        {a.name === firstOptionalName ? (
                          <div className="flex items-center gap-3 pt-1">
                            <Text variant="meta" tone="muted">
                              Optional
                            </Text>
                            <Separator className="flex-1" />
                          </div>
                        ) : null}
                        <div className="flex min-w-0 flex-col gap-1.5">
                          <Label
                            htmlFor={`prompt-arg-${a.name}`}
                            className="flex flex-wrap items-center gap-2"
                          >
                            <span className="font-mono text-xs">{a.name}</span>
                            {a.required ? <Badge variant="secondary">required</Badge> : null}
                            <span className="text-xs text-muted-foreground">string</span>
                          </Label>
                          <Input
                            id={`prompt-arg-${a.name}`}
                            spellCheck={false}
                            aria-invalid={Boolean(fieldErrors[a.name])}
                            aria-describedby={errorId}
                            placeholder="Enter a value…"
                            value={values[a.name] ?? ""}
                            onChange={(e) => setValue(a.name, e.target.value)}
                          />
                          {fieldErrors[a.name] ? (
                            <Text
                              id={errorId}
                              role="alert"
                              className="text-xs text-destructive-text"
                            >
                              {fieldErrors[a.name]}
                            </Text>
                          ) : a.description ? (
                            <Text variant="meta" tone="muted" className="line-clamp-2">
                              {a.description}
                            </Text>
                          ) : null}
                        </div>
                      </Fragment>
                    );
                  })
                )}
              </form>
            </ScrollArea>
          </ResizablePanel>

          <ResizableHandle
            withHandle
            aria-label="Resize arguments and result panels"
            className="cursor-col-resize"
          />

          {/* RIGHT — result */}
          <ResizablePanel defaultSize={67} minSize={30} className="flex min-h-0 flex-col">
            <div className="flex flex-none items-center justify-between gap-2 px-4 py-2.5">
              <div className="flex items-center gap-2">
                <Text variant="meta" tone="muted">
                  Messages
                </Text>
                {result ? (
                  <Badge variant={result.isError ? "destructive" : "success"}>
                    {result.isError ? "error" : "ok"}
                  </Badge>
                ) : null}
              </div>
              {result ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => void copy()}
                  aria-label="Copy prompt messages JSON"
                >
                  {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
                  <span>{copied ? "Copied" : "Copy"}</span>
                </Button>
              ) : null}
            </div>
            <div className="min-h-0 flex-1 px-4 pb-4">
              {busy ? (
                <div className="grid h-full place-items-center">
                  <StatePanel
                    kind="loading"
                    title="Getting prompt…"
                    description="Resolving the prompt and measuring token cost."
                  />
                </div>
              ) : !result && !error ? (
                <div className="grid h-full place-items-center">
                  <StatePanel
                    kind="empty"
                    title="No messages yet"
                    description="Fill in the arguments and get the prompt to see its messages and token cost."
                  />
                </div>
              ) : (
                <div className="flex h-full min-h-0 flex-col gap-3 duration-300 animate-in fade-in motion-reduce:animate-none">
                  {error ? (
                    <Alert variant="destructive" className="flex-none">
                      <AlertTitle>Couldn’t get the prompt. Select Get prompt to try again.</AlertTitle>
                      <AlertDescription>{error}</AlertDescription>
                    </Alert>
                  ) : null}
                  {result?.description ? (
                    <Text variant="meta" tone="muted" className="flex-none">
                      {result.description}
                    </Text>
                  ) : null}
                  {result ? (
                    <ResultEditor value={resultContent} ariaLabel="Prompt messages JSON" />
                  ) : null}
                </div>
              )}
            </div>
          </ResizablePanel>
        </AdaptivePanelGroup>

        {/* FOOTER — get action (left) · result KPIs (right) */}
        <div className="flex flex-none flex-wrap items-center justify-between gap-x-6 gap-y-3 border-t border-border p-4">
          <Button type="submit" form="prompt-get-form" disabled={busy}>
            <Play aria-hidden />
            <span>{busy ? "Getting…" : "Get prompt"}</span>
          </Button>
          {result ? (
            <ResultKpis
              requestTokens={result.requestTokens}
              requestBytes={result.requestBytes}
              responseTokens={result.responseTokens}
              responseBytes={result.responseBytes}
              durationMs={result.durationMs}
              isError={result.isError}
            />
          ) : (
            <Text variant="meta" tone="muted">
              Token &amp; byte cost appears here after a get.
            </Text>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
