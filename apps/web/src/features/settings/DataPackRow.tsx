import { useCallback, useEffect, useState } from "react";
import type { DataPackStatus } from "@mcp-token-footprint/shared";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Spinner,
  Text,
} from "@elabs-ai/components-ui";
import { Database, Loader2, ShieldAlert } from "lucide-react";
import { getDataPackStatus, refreshDataPackStatus } from "../../lib/api";
import { getErrorMessage } from "../../lib/errors";
import { formatDateTime } from "../../lib/format";
import { notifyError } from "../../lib/notify";
import { installPackValues } from "../../lib/pack-values";
import { InlineError } from "../../components/InlineError";

/* ─────────────────────────────────────────────────────────────────────────────────────────────
 * Reference data pack — planning/Roadmap/RM-38-reference-data-pack/ WP 3.2.
 *
 * The one place an operator can answer "what data is this install running, and is anything wrong
 * with it?" — the pack version, the day its facts were current, where it was loaded from, what the
 * last remote check did, and a **Check now** button.
 *
 * THE REFUSAL IS THE REASON THIS EXISTS, and it is deliberately not a footnote. A pack that was
 * published and REFUSED means something out there is serving data this build will not trust, and the
 * app is still on the version it had. That state has to read as a problem, in words, and it must
 * survive a later routine check — the RM-17 lesson, where an empty window returned `breached:false`
 * so the not-breached branch wrote `window_recover`, and a bench that went silent while a rule was
 * firing reported as "recovered". So the refusal has its own destructive `Alert` above everything
 * else, it is not cleared by a successful check (`apps/api/src/data-pack/state.ts` keeps it), and the
 * success path never renders in a shape a refusal could be mistaken for.
 *
 * The pack's `title` / `rationale` strings are free text this app renders verbatim elsewhere; nothing
 * here is composed from pack content — every sentence below is written in this file.
 * ──────────────────────────────────────────────────────────────────────────────────────────── */

const SOURCE_LABEL: Record<string, string> = {
  bundled: "shipped with this build",
  cache: "downloaded on a previous start",
  fetched: "downloaded by this process",
};

/** The last check, in plain words. Never phrased so a failure could read as a success. */
function checkSentence(status: DataPackStatus): string {
  const check = status.lastCheck;
  if (!check) {
    return status.checkConfigured
      ? "No check has completed since this app started."
      : "No update source is configured, so the app runs the data it shipped with.";
  }
  switch (check.status) {
    case "disabled":
      return "Update checks are switched off, so the app runs the data it shipped with.";
    case "unreachable":
      return "The last check could not reach the update source. Nothing changed — this is the normal outcome on a machine with no internet access.";
    case "up_to_date":
      return "The last check found nothing newer. The app is already running the published version.";
    case "refused":
      return "The last check found a published pack and REFUSED it. See below.";
    case "installed":
      return `The last check installed a newer pack${
        check.currentVersion ? `, replacing ${check.currentVersion}` : ""
      }.`;
    default:
      return check.detail;
  }
}

export function DataPackRow() {
  const [status, setStatus] = useState<DataPackStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const next = await getDataPackStatus();
      setStatus(next);
      // The same payload that answers this row also carries the VALUES the rest of the app renders,
      // so opening Settings re-hydrates the store for free. One read, one pack — the version above
      // and the values elsewhere can never come from two different packs.
      installPackValues(next.values);
    } catch (error) {
      setLoadError(getErrorMessage(error));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function checkNow() {
    setChecking(true);
    try {
      const next = await refreshDataPackStatus();
      setStatus(next);
      installPackValues(next.values);
    } catch (error) {
      notifyError("Couldn’t check for a new reference data pack.", {
        description: `${getErrorMessage(error)} The app keeps running the pack it already had.`,
      });
    } finally {
      setChecking(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-3">
        <Spinner className="size-4" aria-hidden />
        <Text tone="muted">Reading the reference data pack…</Text>
      </div>
    );
  }

  if (loadError !== null || status === null) {
    return (
      <InlineError
        title="Couldn’t read the reference data pack"
        detail={loadError ?? "The app returned no answer."}
        onRetry={() => void load()}
      />
    );
  }

  const refusal = status.lastRefusal;

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-muted/40 px-3 py-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <span className="flex min-w-0 items-start gap-2.5">
          <Database className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
          <span className="flex min-w-0 flex-col gap-1">
            <span className="flex flex-wrap items-center gap-2">
              <span className="font-medium">Reference data pack</span>
              <Badge variant="secondary" className="tabular-nums">
                {status.packVersion}
              </Badge>
            </span>
            <Text variant="meta" tone="muted" className="text-pretty">
              The model list, context windows, prices, compatibility tests, security rules and
              judgement thresholds this app runs on. Facts current as of{" "}
              <span className="tabular-nums">{status.asOf}</span>;{" "}
              {SOURCE_LABEL[status.source] ?? status.source};{" "}
              <span className="tabular-nums">{status.files}</span> files; security analyzer v
              <span className="tabular-nums">{status.analyzerVersion}</span>.
            </Text>
            <Text variant="meta" tone="muted" className="text-pretty">
              {checkSentence(status)}
              {status.lastCheckedAt ? ` Last checked ${formatDateTime(status.lastCheckedAt)}.` : ""}
            </Text>
          </span>
        </span>
        <Button variant="outline" size="sm" onClick={() => void checkNow()} disabled={checking}>
          {checking ? <Loader2 className="animate-spin" aria-hidden /> : null}
          <span>{checking ? "Checking…" : "Check now"}</span>
        </Button>
      </div>

      {refusal ? (
        <Alert variant="destructive">
          <ShieldAlert aria-hidden />
          <AlertTitle>
            A published pack could not be verified — this app is still using{" "}
            {status.source === "bundled" ? "the version it shipped with" : "the version it had"}
          </AlertTitle>
          <AlertDescription>
            <span className="flex flex-col gap-1">
              <span>
                {refusal.refusedVersion
                  ? `Version ${refusal.refusedVersion} was refused`
                  : "A pack was refused"}{" "}
                on {formatDateTime(refusal.at)} (
                {refusal.origin === "cache" ? "found in local storage" : "downloaded"}). Reason:{" "}
                <span className="font-mono">{refusal.reason}</span>.
              </span>
              <span>{refusal.detail}</span>
              <span>
                Nothing was applied. Every verdict this app produces is still computed against pack{" "}
                <span className="tabular-nums">{status.packVersion}</span>, and each exported report
                names that version.
              </span>
            </span>
          </AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}
