// Tool "Run" content — the schema-generated parameters form (LEFT) + the live result (RIGHT) + a
// full-width footer with the run action and token/byte/time KPIs. Executes `tools/call` on the API
// (which owns the MCP connection); arguments are validated against the tool's input schema, and the
// runtime request/response token cost is read straight from the call result.
//
// This is the reusable body shared by two shells: the scans playground's full-screen `Dialog`
// (`features/scans/ToolPlayground.tsx`) and the Skill IDE's binding-resolved `Sheet`
// (`features/skills/design/ToolRunnerSheet.tsx`). It renders a fragment (a panel-group + a footer)
// so either shell can drop it into its own flex column. The component is pure presentation over the
// props it's handed — it never resolves a binding or fetches a scan itself (the caller does that and
// hands over the ready `params`/`annotations`).
import { Fragment, useEffect, useMemo, useState } from "react";
import type { TokenProfileId, ToolCallResult } from "@mcp-token-footprint/shared";
import {
  Alert,
  AlertDescription,
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertTitle,
  Badge,
  Button,
  buttonVariants,
  Input,
  Label,
  NumberInput,
  ResizableHandle,
  ResizablePanel,
  ScrollArea,
  Separator,
  StatePanel,
  Switch,
  Text,
  Textarea,
} from "@brand/ui";
import { CodeEditor } from "@brand/editor";
import { Check, Copy, Play } from "lucide-react";
import { AdaptivePanelGroup } from "./AdaptivePanelGroup";
import { SelectField } from "./SelectField";
import { KpiStat } from "./KpiStat";
import { READ_ONLY_OPTIONS } from "../lib/monaco";
import { useMcpAuth } from "../features/servers/McpAuthProvider";
import { apiPost } from "../lib/api";
import { getErrorMessage } from "../lib/errors";
import { sortParams, type ToolParam } from "../lib/schema-params";
import { formatBytes, formatNumber } from "../lib/format";

function isJsonField(p: ToolParam): boolean {
  return /^(array|object)/.test(p.typeLabel);
}
function isNumberField(p: ToolParam): boolean {
  return /^(number|integer)/.test(p.typeLabel);
}

/** The MCP behavior annotations that make a run a considered action — surfaced as a named confirm
 *  step when `confirmDestructive` is on (Skill IDE WP 8.5). Reads the same hints the scan detail's
 *  behavior badges do. */
function considerableFlags(annotations: unknown): string[] {
  if (!annotations || typeof annotations !== "object") return [];
  const a = annotations as Record<string, unknown>;
  const out: string[] = [];
  if (a.destructiveHint === true) out.push("destructive");
  if (a.openWorldHint === true) out.push("open-world");
  return out;
}

export type ToolRunnerProps = {
  serverId: string;
  toolName: string;
  params: ToolParam[];
  tokenProfile?: TokenProfileId;
  /**
   * The tool's scan annotations (Skill IDE WP 8.5). Only consulted when `confirmDestructive` is set:
   * a tool marked `destructiveHint`/`openWorldHint` then gets a confirmation step NAMING the
   * annotation before it runs. Omitted by the scans playground (no behavior change there).
   */
  annotations?: unknown;
  /**
   * Opt in to the destructive/open-world confirmation gate (Skill IDE WP 8.5). Default `false` so the
   * scans playground runs exactly as before; the Skill IDE runner sets it `true`. When `true` and the
   * tool's `annotations` mark it destructive/open-world, the run is held behind a named confirm.
   */
  confirmDestructive?: boolean;
};

/**
 * The tool-runner body. All run state (form values, field errors, busy/result/error, the copied flag)
 * lives here; the enclosing shell owns only open/close + the header. Renders a fragment so it slots
 * into a flex-column `Dialog`/`Sheet` content the same way.
 */
export function ToolRunner({
  serverId,
  toolName,
  params,
  tokenProfile,
  annotations,
  confirmDestructive = false,
}: ToolRunnerProps) {
  const { requestReauth } = useMcpAuth();
  // Render the form required-first, then optional (stable within each group).
  const sortedParams = useMemo(() => sortParams(params), [params]);
  const firstOptionalName = useMemo(
    () => sortedParams.find((p) => !p.required)?.name,
    [sortedParams],
  );
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ToolCallResult | null>(null);
  const [copied, setCopied] = useState(false);
  // WP 8.5 — the named-confirm gate for a destructive/open-world tool (only when opted in).
  const [confirmOpen, setConfirmOpen] = useState(false);

  const considered = useMemo(
    () => (confirmDestructive ? considerableFlags(annotations) : []),
    [confirmDestructive, annotations],
  );
  const needsConfirm = considered.length > 0;

  // Fresh form whenever the targeted tool changes.
  useEffect(() => {
    setValues({});
    setFieldErrors({});
    setError(null);
    setResult(null);
    setConfirmOpen(false);
  }, [toolName]);

  const setValue = (name: string, value: unknown) => {
    setValues((current) => ({ ...current, [name]: value }));
    setFieldErrors((current) => (current[name] ? { ...current, [name]: "" } : current));
  };

  const resultContent = useMemo(
    () =>
      result
        ? JSON.stringify(result.structuredContent ?? result.content ?? result.raw ?? null, null, 2)
        : "",
    [result],
  );

  async function copyResult() {
    try {
      await navigator.clipboard.writeText(resultContent);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  }

  function validate(): Record<string, string> {
    const errs: Record<string, string> = {};
    for (const p of params) {
      const v = values[p.name];
      const empty = v === undefined || v === null || v === "";
      if (empty) {
        if (p.required) errs[p.name] = "This field is required.";
        continue;
      }
      if (isJsonField(p)) {
        try {
          JSON.parse(String(v));
        } catch {
          errs[p.name] = "Must be valid JSON.";
        }
      }
    }
    return errs;
  }

  /** Validate; on success either open the named confirm (destructive/open-world + opted in) or run. */
  function requestRun() {
    const errs = validate();
    setFieldErrors(errs);
    const firstInvalid = sortedParams.find((p) => errs[p.name]);
    if (firstInvalid) {
      document.getElementById(`run-${firstInvalid.name}`)?.focus();
      return;
    }
    if (needsConfirm) {
      setConfirmOpen(true);
      return;
    }
    void execute();
  }

  async function execute() {
    // The form is already validated by `requestRun` before we get here; re-derive the args.
    const args: Record<string, unknown> = {};
    for (const p of params) {
      const v = values[p.name];
      if (v === undefined || v === null || v === "") continue;
      args[p.name] = isJsonField(p) ? JSON.parse(String(v)) : v;
    }

    const callUrl = `/api/servers/${serverId}/tools/${encodeURIComponent(toolName)}/call`;
    const body = { arguments: args, tokenProfile };

    setBusy(true);
    setError(null);
    setResult(null);
    try {
      let res = await apiPost<ToolCallResult>(callUrl, body);
      // Reactive reauth: an expired OAuth token comes back as authRequired → open the reauth modal,
      // then retry the call once after the user signs in.
      if (res.authRequired) {
        const gate = await requestReauth(serverId);
        if (gate.ok) res = await apiPost<ToolCallResult>(callUrl, body);
      }
      setResult(res);
      if (res.isError) {
        setError(
          res.errorMessage ? `${res.errorMessage} Try again.` : "The tool didn’t return a result. Try again.",
        );
      }
    } catch (err) {
      setError(getErrorMessage(err, "Try again."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <AdaptivePanelGroup className="min-h-0 flex-1">
        {/* LEFT — parameters form */}
        <ResizablePanel defaultSize={33} minSize={28} className="flex min-h-0 flex-col">
          <div className="flex flex-none items-center justify-between gap-2 px-4 py-2.5">
            <Text variant="meta" tone="muted">
              Parameters
            </Text>
            <Badge variant="secondary">{params.length}</Badge>
          </div>
          <ScrollArea className="min-h-0 flex-1">
            <form
              id="tool-run-form"
              className="flex flex-col gap-3.5 px-4 pb-4"
              onSubmit={(event) => {
                event.preventDefault();
                requestRun();
              }}
            >
              {sortedParams.length === 0 ? (
                <Text tone="muted" className="text-sm">
                  This tool takes no parameters.
                </Text>
              ) : (
                sortedParams.map((p) => {
                  const errorId = fieldErrors[p.name] ? `run-${p.name}-error` : undefined;
                  return (
                    <Fragment key={p.name}>
                      {/* Subtle subhead/divider where the required group ends and optional begins. */}
                      {p.name === firstOptionalName ? (
                        <div className="flex items-center gap-3 pt-1">
                          <Text variant="meta" tone="muted">
                            Optional
                          </Text>
                          <Separator className="flex-1" />
                        </div>
                      ) : null}
                      <div className="flex min-w-0 flex-col gap-1.5">
                        <Label
                          htmlFor={`run-${p.name}`}
                          className="flex flex-wrap items-center gap-2"
                        >
                          <span className="font-mono text-xs">{p.name}</span>
                          {p.required ? <Badge variant="secondary">required</Badge> : null}
                          <span className="text-xs text-muted-foreground">{p.typeLabel}</span>
                        </Label>
                        {p.enumValues ? (
                          <SelectField
                            id={`run-${p.name}`}
                            label=""
                            value={String(values[p.name] ?? "")}
                            placeholder="Select…"
                            options={p.enumValues.map((v) => ({ value: v, label: v }))}
                            onChange={(v) => setValue(p.name, v)}
                          />
                        ) : p.typeLabel === "boolean" ? (
                          <div className="flex items-center gap-2">
                            <Switch
                              id={`run-${p.name}`}
                              checked={Boolean(values[p.name])}
                              onCheckedChange={(checked) => setValue(p.name, checked)}
                            />
                            <Text variant="meta" tone="muted">
                              {values[p.name] ? "true" : "false"}
                            </Text>
                          </div>
                        ) : isNumberField(p) ? (
                          <NumberInput
                            id={`run-${p.name}`}
                            value={(values[p.name] as number | null | undefined) ?? null}
                            onValueChange={(n) => setValue(p.name, n)}
                          />
                        ) : isJsonField(p) ? (
                          <Textarea
                            id={`run-${p.name}`}
                            rows={3}
                            spellCheck={false}
                            aria-invalid={Boolean(fieldErrors[p.name])}
                            aria-describedby={errorId}
                            placeholder={p.typeLabel.startsWith("array") ? "[…]" : "{…}"}
                            value={String(values[p.name] ?? "")}
                            onChange={(e) => setValue(p.name, e.target.value)}
                          />
                        ) : (
                          <Input
                            id={`run-${p.name}`}
                            spellCheck={false}
                            aria-invalid={Boolean(fieldErrors[p.name])}
                            aria-describedby={errorId}
                            placeholder="Enter a value…"
                            value={String(values[p.name] ?? "")}
                            onChange={(e) => setValue(p.name, e.target.value)}
                          />
                        )}
                        {fieldErrors[p.name] ? (
                          <Text id={errorId} role="alert" className="text-xs text-destructive-text">
                            {fieldErrors[p.name]}
                          </Text>
                        ) : p.description ? (
                          <Text variant="meta" tone="muted" className="line-clamp-2">
                            {p.description}
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

        {/* Draggable resizer: @brand/ui's handle ships no resting cursor (reads as inert),
            so add the col-resize affordance here. Pointer drag handling comes from
            react-resizable-panels; this is the missing visual cue, not new behavior. */}
        <ResizableHandle
          withHandle
          aria-label="Resize parameters and result panels"
          className="cursor-col-resize"
        />

        {/* RIGHT — result, fills the panel down to the footer */}
        <ResizablePanel defaultSize={67} minSize={30} className="flex min-h-0 flex-col">
          <div className="flex flex-none items-center justify-between gap-2 px-4 py-2.5">
            <div className="flex items-center gap-2">
              <Text variant="meta" tone="muted">
                Result
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
                onClick={() => void copyResult()}
                aria-label="Copy result JSON"
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
                  title="Running tool…"
                  description="Calling the server and measuring token cost."
                />
              </div>
            ) : !result && !error ? (
              <div className="grid h-full place-items-center">
                <StatePanel
                  kind="empty"
                  title="No result yet"
                  description="Fill in the parameters and run the tool to see its output and token cost."
                />
              </div>
            ) : (
              <div className="flex h-full min-h-0 flex-col gap-3 duration-300 animate-in fade-in motion-reduce:animate-none">
                {error ? (
                  <Alert variant="destructive" className="flex-none">
                    <AlertTitle>Couldn’t run the tool.</AlertTitle>
                    <AlertDescription>{error}</AlertDescription>
                  </Alert>
                ) : null}
                {/* SV6: render the error state alone — never the error banner PLUS a code viewer
                    showing `null`. The token/byte KPIs (footer) still report the failed call. */}
                {result && !error ? (
                  <div className="min-h-0 flex-1 overflow-hidden rounded-md border border-border">
                    <CodeEditor
                      value={resultContent || "(empty result)"}
                      language="json"
                      readOnly
                      height="100%"
                      ariaLabel="Tool result JSON"
                      options={READ_ONLY_OPTIONS}
                    />
                  </div>
                ) : null}
              </div>
            )}
          </div>
        </ResizablePanel>
      </AdaptivePanelGroup>

      {/* FOOTER — one full-width bar: result KPIs (left) · run action (right).
          SV6: the primary sits bottom-RIGHT like every other dialog in the app. The KPI side always
          occupies its half so the footer reads balanced even before a result. */}
      <div className="flex flex-none flex-wrap items-center justify-between gap-x-6 gap-y-3 border-t border-border p-4">
        {result ? (
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
            <KpiStat
              label="Tokens sent"
              value={formatNumber(result.requestTokens)}
              sub={formatBytes(result.requestBytes)}
            />
            <KpiStat
              label="Tokens received"
              value={formatNumber(result.responseTokens)}
              sub={formatBytes(result.responseBytes)}
            />
            <KpiStat
              label="Round-trip"
              value={formatNumber(result.requestTokens + result.responseTokens)}
              sub="tokens"
            />
            <KpiStat
              label="Duration"
              value={`${formatNumber(result.durationMs)} ms`}
              sub={result.isError ? "error" : "ok"}
            />
          </div>
        ) : (
          <Text variant="meta" tone="muted">
            Token &amp; byte cost appears here after a run.
          </Text>
        )}
        <div className="ms-auto flex items-center gap-3">
          <Button type="submit" form="tool-run-form" disabled={busy}>
            <Play aria-hidden />
            <span>{busy ? "Running…" : "Run tool"}</span>
          </Button>
        </div>
      </div>

      {/* WP 8.5 — destructive/open-world confirm: strictly user-initiated, names the annotation, and
          is the only path to `execute()` for a considered tool. */}
      {needsConfirm ? (
        <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Run this {considered.join(" · ")} tool?</AlertDialogTitle>
              <AlertDialogDescription>
                <span className="font-mono">{toolName}</span> is annotated{" "}
                <strong>{considered.join(" and ")}</strong> by its server. Running it calls the live
                server for real — it may modify or query state outside this tool. Continue only if
                you intend to.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                className={buttonVariants({ variant: "destructive" })}
                onClick={() => {
                  setConfirmOpen(false);
                  void execute();
                }}
              >
                <Play aria-hidden /> Run anyway
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      ) : null}
    </>
  );
}
