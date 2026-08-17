import { useEffect, useMemo, useState } from "react";
import type { ScanDetail } from "@mcp-token-footprint/shared";
import {
  Badge,
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Label,
  ScrollArea,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  StatePanel,
  Text,
} from "@elabs-ai/components-ui";
import { getCompatibilityModels, type CompatibilityModelOption } from "../../lib/api";
import { getErrorMessage } from "../../lib/errors";
import { formatNumber } from "../../lib/format";
import { CLIENT_OPTIONS } from "../compatibility/meta";
import { DETAIL_OPTIONS, type DetailLevel } from "./reportRender";

// The export-report configuration dialog: pick the vendors + models to evaluate (grouped by
// provider) and an optional host-client target, then generate. Mirrors the heatmap's default
// representative column set so an unconfigured report is already meaningful.

/** A sensible default column set — flagships across the runnable kinds + a small window for contrast.
 *  Mirrors the API's `DEFAULT_HEATMAP_MODELS`; intersected with the live roster on load. */
const DEFAULT_REPORT_MODELS = [
  "claude-opus-4-8",
  "gpt-5.5",
  "gemini-3.5-flash",
  "claude-haiku-4-5",
  "microsoft/phi-4",
];

const MODELS_STORAGE_KEY = "mcp-token-footprint.report.models";
const CLIENT_STORAGE_KEY = "mcp-token-footprint.report.client";
const DETAIL_STORAGE_KEY = "mcp-token-footprint.report.detail";
const FORMAT_STORAGE_KEY = "mcp-token-footprint.report.format";
const NO_CLIENT = "__none__";

/** Export format: PDF opens the print preview; Markdown downloads one complete document. */
export type ExportFormat = "pdf" | "markdown";

const FORMAT_OPTIONS: { value: ExportFormat; label: string }[] = [
  { value: "pdf", label: "PDF (print / save)" },
  { value: "markdown", label: "Markdown (single document)" },
];

function isDetailLevel(v: string | null): v is DetailLevel {
  return v === "all" || v === "medium" || v === "high" || v === "blocker";
}

const GROUP_LABEL: Record<string, string> = {
  saas: "Hosted (SaaS)",
  open_weight: "Open-weight (self-hosted)",
};
const GROUP_ORDER = ["saas", "open_weight"];

type ProviderRow = { providerId: string; providerName: string; models: CompatibilityModelOption[] };
type ModelGroup = { key: string; label: string; providers: ProviderRow[] };

function groupModels(models: CompatibilityModelOption[]): ModelGroup[] {
  const byGroup = new Map<string, Map<string, ProviderRow>>();
  for (const model of models) {
    const providers = byGroup.get(model.group) ?? new Map<string, ProviderRow>();
    const row = providers.get(model.providerId) ?? {
      providerId: model.providerId,
      providerName: model.providerName,
      models: [],
    };
    row.models.push(model);
    providers.set(model.providerId, row);
    byGroup.set(model.group, providers);
  }
  const rank = (g: string): number => (GROUP_ORDER.indexOf(g) === -1 ? 99 : GROUP_ORDER.indexOf(g));
  return [...byGroup.keys()]
    .sort((a, b) => rank(a) - rank(b))
    .map((key) => ({
      key,
      label: GROUP_LABEL[key] ?? key,
      providers: [...byGroup.get(key)!.values()],
    }));
}

function readStoredModels(): string[] | null {
  try {
    const raw = window.localStorage.getItem(MODELS_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : null;
  } catch {
    return null;
  }
}

export function ServerReportDialog({
  open,
  scan,
  onOpenChange,
  onGenerate,
}: {
  open: boolean;
  scan: ScanDetail | null;
  onOpenChange: (open: boolean) => void;
  onGenerate: (opts: {
    scanId: string;
    modelIds: string[];
    client?: string;
    detail: DetailLevel;
    format: ExportFormat;
  }) => void;
}) {
  const [roster, setRoster] = useState<CompatibilityModelOption[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [client, setClient] = useState<string>(NO_CLIENT);
  const [detail, setDetail] = useState<DetailLevel>("all");
  const [format, setFormat] = useState<ExportFormat>("pdf");

  // Load the dataset roster once the dialog opens; seed the selection from the last choice (or the
  // default representative set), intersected with what the roster actually offers.
  useEffect(() => {
    if (!open) return;
    let active = true;
    setError(null);
    setRoster(null);
    getCompatibilityModels()
      .then(({ models }) => {
        if (!active) return;
        setRoster(models);
        const ids = new Set(models.map((m) => m.id));
        const stored = readStoredModels();
        const seed = (stored ?? DEFAULT_REPORT_MODELS).filter((id) => ids.has(id));
        setSelected(
          new Set(seed.length > 0 ? seed : DEFAULT_REPORT_MODELS.filter((id) => ids.has(id))),
        );
      })
      .catch(
        (cause: unknown) => active && setError(getErrorMessage(cause, "Couldn’t load models.")),
      );
    const storedClient = window.localStorage.getItem(CLIENT_STORAGE_KEY);
    setClient(storedClient && storedClient.length > 0 ? storedClient : NO_CLIENT);
    const storedDetail = window.localStorage.getItem(DETAIL_STORAGE_KEY);
    setDetail(isDetailLevel(storedDetail) ? storedDetail : "all");
    const storedFormat = window.localStorage.getItem(FORMAT_STORAGE_KEY);
    setFormat(storedFormat === "markdown" ? "markdown" : "pdf");
    return () => {
      active = false;
    };
  }, [open]);

  const groups = useMemo(() => (roster ? groupModels(roster) : []), [roster]);

  const toggleModel = (id: string, on: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const toggleProvider = (provider: ProviderRow, on: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const m of provider.models) {
        if (on) next.add(m.id);
        else next.delete(m.id);
      }
      return next;
    });
  };

  const generate = () => {
    if (!scan || selected.size === 0) return;
    const modelIds = roster
      ? roster.filter((m) => selected.has(m.id)).map((m) => m.id)
      : [...selected];
    // Best-effort persistence (localStorage can throw — Safari private mode / quota exceeded); a
    // failure here must never abort report generation itself.
    try {
      window.localStorage.setItem(MODELS_STORAGE_KEY, JSON.stringify(modelIds));
      window.localStorage.setItem(CLIENT_STORAGE_KEY, client === NO_CLIENT ? "" : client);
      window.localStorage.setItem(DETAIL_STORAGE_KEY, detail);
      window.localStorage.setItem(FORMAT_STORAGE_KEY, format);
    } catch {
      // ignore — the in-memory selection still drives this generation.
    }
    onGenerate({
      scanId: scan.id,
      modelIds,
      client: client === NO_CLIENT ? undefined : client,
      detail,
      format,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Export server report</DialogTitle>
          <DialogDescription>
            {scan
              ? `Choose the vendors and models to evaluate ${scan.serverName} against. Every test is run per model.`
              : "Choose the vendors and models to evaluate."}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          {/* Export format — PDF opens the print preview; Markdown downloads one complete document
              (every tool listed, colour replaced by bracket severity tags). */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="report-format">Format</Label>
            <Select value={format} onValueChange={(v) => setFormat(v as ExportFormat)}>
              <SelectTrigger id="report-format" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {FORMAT_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Text variant="meta" tone="muted">
              {format === "markdown"
                ? "Downloads a single .md file — complete and portable (lists every tool; no colour)."
                : "Opens a print-ready preview; save as PDF from the print dialog."}
            </Text>
          </div>

          {/* Detail filter — which findings get a full detail block (the rest stay in the ledger /
              tool summary). Above the host-client select per the report layout. */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="report-detail">Detailed tests</Label>
            <Select value={detail} onValueChange={(v) => setDetail(v as DetailLevel)}>
              <SelectTrigger id="report-detail" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DETAIL_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Text variant="meta" tone="muted">
              Findings below this severity stay in the ledger and tool summary — no detail page.
            </Text>
          </div>

          {/* Host-client target — enables the client-cap / timeout tests. */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="report-client">Host client (optional)</Label>
            <Select value={client} onValueChange={setClient}>
              <SelectTrigger id="report-client" className="w-full">
                <SelectValue placeholder="No specific client" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_CLIENT}>No specific client</SelectItem>
                {CLIENT_OPTIONS.map((c) => (
                  <SelectItem key={c.value} value={c.value}>
                    {c.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Vendors → models. */}
          <div className="flex items-center justify-between">
            <Label>Models</Label>
            <Text variant="meta" tone="muted" className="tabular-nums">
              {selected.size} selected
            </Text>
          </div>

          {error ? (
            <StatePanel
              kind="error"
              title="Couldn’t load models."
              description={`${error} Try again.`}
            />
          ) : !roster ? (
            <StatePanel kind="loading" title="Loading models…" loadingLabel="Loading models…" />
          ) : (
            <ScrollArea className="h-80 rounded-md border border-border">
              <div className="flex flex-col gap-5 p-3">
                {groups.map((group) => (
                  <section key={group.key} className="flex flex-col gap-3">
                    <Text
                      variant="meta"
                      tone="muted"
                      className="font-medium uppercase tracking-wide"
                    >
                      {group.label}
                    </Text>
                    {group.providers.map((provider) => {
                      const selCount = provider.models.filter((m) => selected.has(m.id)).length;
                      const all = selCount === provider.models.length;
                      const some = selCount > 0 && !all;
                      return (
                        <div key={provider.providerId} className="flex flex-col gap-2">
                          <label className="flex items-center gap-2">
                            <Checkbox
                              checked={all ? true : some ? "indeterminate" : false}
                              onCheckedChange={(v) => toggleProvider(provider, v === true)}
                              aria-label={`Select all ${provider.providerName} models`}
                            />
                            <Text as="span" className="font-medium">
                              {provider.providerName}
                            </Text>
                            <Text as="span" variant="meta" tone="muted" className="tabular-nums">
                              {selCount}/{provider.models.length}
                            </Text>
                          </label>
                          <div className="ml-6 flex flex-col gap-1.5">
                            {provider.models.map((model) => (
                              <label key={model.id} className="flex min-w-0 items-center gap-2">
                                <Checkbox
                                  checked={selected.has(model.id)}
                                  onCheckedChange={(v) => toggleModel(model.id, v === true)}
                                />
                                <Text as="span" className="truncate">
                                  {model.displayName}
                                </Text>
                                {model.contextWindow ? (
                                  <Text
                                    as="span"
                                    variant="meta"
                                    tone="muted"
                                    className="shrink-0 tabular-nums"
                                  >
                                    {formatNumber(model.contextWindow)} ctx
                                  </Text>
                                ) : (
                                  <Badge variant="secondary" className="shrink-0">
                                    no window
                                  </Badge>
                                )}
                              </label>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </section>
                ))}
              </div>
            </ScrollArea>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={!scan || selected.size === 0} onClick={generate}>
            {format === "markdown" ? "Download Markdown" : "Generate report"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
