import { useEffect, useState, type ReactNode } from "react";
import type { AvailableModel, QlikTenantProbe, ScenarioInput } from "@mcp-token-footprint/shared";
import { DEFAULT_TOKEN_PROFILE } from "@mcp-token-footprint/shared";
import { Alert, AlertDescription, Badge, Button, Checkbox, Input, Label, Text, toast } from "@brand/ui";
import { Sparkles } from "lucide-react";
import { FieldRow } from "../../components/FieldRow";
import { FormDialog } from "../../components/dialogs";
import { createProvider, createScenario, listProviderModels } from "../../lib/api";
import { getErrorMessage } from "../../lib/errors";
import { notifyError } from "../../lib/notify";

type Phase = "decide" | "apikey" | "assistants";

export type QlikAnswersOfferDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The saved MCP server the tenant assistants were discovered on. */
  serverId: string;
  serverName: string;
  /** The availability probe result (`answersAvailable` is assumed true by the time this is opened). */
  probe: QlikTenantProbe;
};

/**
 * Qlik Answers onboarding (WP 2.2) — the CONSENT-GATED "set up Qlik Answers" offer. Opened either
 * right after a new streamable-HTTP server's wizard save (`ServerWizard`'s "offer" step, when the
 * post-save probe reports `answersAvailable`) or, for a server registered before this feature, from
 * the "Answers available" CTA on the server-detail header (`ServersView`). Nothing is EVER created
 * without an explicit click at each stage:
 *
 *   decide → (accept) → [apikey if `probe.needsOwnKey`] → create the `qlik_answers` provider
 *     (linked-auth via `mcpServerId` when the server's own creds reach the tenant, else the entered
 *     API key) → `listProviderModels` the tenant's assistant roster → assistants (multi-select,
 *     default all) → (confirm) → one locked, empty `qlik_answers` environment per selected assistant
 *     (no MCP servers/skills — D-QA2's `answersMode: { transport: "stream" }`).
 *
 * Declining at any stage (the dialog's Cancel/close) creates nothing. Re-opening (a fresh `open`
 * transition) always restarts at "decide" — this dialog never assumes a prior run's state.
 */
export function QlikAnswersOfferDialog(props: QlikAnswersOfferDialogProps) {
  const { open, onOpenChange, serverId, serverName, probe } = props;
  const [phase, setPhase] = useState<Phase>("decide");
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [providerId, setProviderId] = useState<string | null>(null);
  const [assistants, setAssistants] = useState<AvailableModel[]>([]);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());

  // Every fresh open restarts the flow — no state carried over from a previous run (declined or
  // completed) of this same dialog instance.
  useEffect(() => {
    if (!open) return;
    setPhase("decide");
    setApiKey("");
    setBusy(null);
    setError(null);
    setProviderId(null);
    setAssistants([]);
    setSelected(new Set());
  }, [open]);

  function toggle(id: string, on: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  /** Create the provider (linked-auth or API-key, whichever `auth` carries) UNLESS one was already
   *  created this run (a retry after a roster-fetch failure reuses it — never a duplicate). */
  async function ensureProviderAndRoster(auth: { apiKey?: string; mcpServerId?: string }) {
    setBusy("provider");
    setError(null);
    try {
      let id = providerId;
      if (!id) {
        const provider = await createProvider({
          kind: "qlik_answers",
          label: `Qlik Answers — ${serverName}`,
          baseUrl: probe.origin,
          ...auth
        });
        id = provider.id;
        setProviderId(id);
      }
      const roster = await listProviderModels(id);
      setAssistants(roster.models);
      setSelected(new Set(roster.models.map((model) => model.id)));
      setPhase("assistants");
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  function acceptOffer() {
    if (probe.needsOwnKey) {
      setPhase("apikey");
      return;
    }
    void ensureProviderAndRoster({ mcpServerId: serverId });
  }

  function submitApiKey() {
    if (!apiKey.trim()) return;
    void ensureProviderAndRoster({ apiKey: apiKey.trim() });
  }

  async function confirmEnvironments() {
    if (!providerId || selected.size === 0) return;
    setBusy("create");
    setError(null);
    const chosen = assistants.filter((assistant) => selected.has(assistant.id));
    try {
      for (const assistant of chosen) {
        const input: ScenarioInput = {
          name: `Qlik Answers — ${assistant.displayName ?? assistant.id}`,
          providerId,
          model: assistant.id,
          params: {},
          systemPrompt: "",
          allowedServers: [],
          allowedSkills: [],
          defaultProfiles: [DEFAULT_TOKEN_PROFILE],
          guardrails: {},
          toolLoadingMode: "eager",
          answersMode: { transport: "stream" }
        };
        await createScenario(input);
      }
      toast.success(
        chosen.length === 1 ? "1 test environment created" : `${chosen.length} test environments created`,
        { description: "Find them under Testing → Environments." }
      );
      onOpenChange(false);
    } catch (err) {
      const message = getErrorMessage(err);
      setError(message);
      notifyError("Couldn’t set up Qlik Answers. Try again.", { description: message });
    } finally {
      setBusy(null);
    }
  }

  const allSelected = assistants.length > 0 && assistants.every((assistant) => selected.has(assistant.id));

  let title: string;
  let description: string;
  let primaryLabel: string;
  let submitDisabled = false;
  let onSubmit: () => void;
  let cancelLabel = "Not now";
  let body: ReactNode;

  if (phase === "apikey") {
    title = "Connect Qlik Answers";
    description = "This server's own credentials can't reach the tenant's assistants API.";
    primaryLabel = "Continue";
    submitDisabled = !apiKey.trim();
    onSubmit = submitApiKey;
    cancelLabel = "Cancel";
    body = (
      <FieldRow id="answers-offer-apikey" label="Qlik Answers API key">
        <Input
          id="answers-offer-apikey"
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={apiKey}
          placeholder="Paste the tenant API key…"
          onChange={(event) => setApiKey(event.target.value)}
        />
      </FieldRow>
    );
  } else if (phase === "assistants") {
    const count = selected.size;
    title = "Choose assistants";
    description = "Each selected assistant becomes its own locked test environment.";
    primaryLabel = count === 1 ? "Create 1 environment" : `Create ${count} environments`;
    submitDisabled = count === 0;
    onSubmit = () => void confirmEnvironments();
    cancelLabel = "Skip";
    body = (
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <Text variant="meta" tone="muted">
            No MCP servers or skills are attached — these environments run the assistant alone.
          </Text>
          <Badge variant="secondary" className="shrink-0 tabular-nums">
            {count} selected
          </Badge>
        </div>
        {assistants.length === 0 ? (
          <Alert variant="warning">
            <AlertDescription>This tenant returned no assistants.</AlertDescription>
          </Alert>
        ) : (
          <>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="w-fit"
              onClick={() =>
                setSelected(allSelected ? new Set() : new Set(assistants.map((assistant) => assistant.id)))
              }
            >
              {allSelected ? "Select none" : "Select all"}
            </Button>
            <div className="flex max-h-64 flex-col gap-0.5 overflow-y-auto rounded-md border border-border p-1.5">
              {assistants.map((assistant) => {
                const fieldId = `answers-offer-assistant-${assistant.id}`;
                return (
                  <Label
                    key={assistant.id}
                    htmlFor={fieldId}
                    className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 font-normal"
                  >
                    <Checkbox
                      id={fieldId}
                      checked={selected.has(assistant.id)}
                      onCheckedChange={(value) => toggle(assistant.id, value === true)}
                    />
                    <span className="min-w-0 truncate">{assistant.displayName ?? assistant.id}</span>
                  </Label>
                );
              })}
            </div>
          </>
        )}
      </div>
    );
  } else {
    const label = probe.assistantCount === 1 ? "assistant" : "assistants";
    title = "Set up Qlik Answers";
    description = `This server is on a Qlik Cloud tenant with ${probe.assistantCount} Qlik Answers ${label}.`;
    primaryLabel = `Set up ${label}`;
    onSubmit = acceptOffer;
    body = (
      <Alert variant="info">
        <Sparkles aria-hidden />
        <AlertDescription>
          Set {probe.assistantCount === 1 ? "it" : "them"} up as test targets? Each becomes its own locked
          environment — no MCP servers or skills attached. Running tests against it consumes the tenant's
          question quota.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
      primaryLabel={primaryLabel}
      cancelLabel={cancelLabel}
      busy={busy !== null}
      submitDisabled={submitDisabled}
      onSubmit={onSubmit}
    >
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {body}
    </FormDialog>
  );
}
