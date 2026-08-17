import { useCallback, useEffect, useState } from "react";
import type { WatchRule, WatchRuleEvent } from "@mcp-token-footprint/shared";
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  EmptyState,
  ScrollArea,
  Spinner,
  Text,
  toast,
} from "@elabs-ai/components-ui";
import { Send } from "lucide-react";
import { listWatchRuleEvents, testFireWatchRule } from "../../lib/api";
import { getErrorMessage } from "../../lib/errors";
import { formatDateTime } from "../../lib/format";
import { auditActionLabel } from "./audit-derive";
import { notifyError } from "../../lib/notify";

/**
 * A rule's append-only audit log (`watch_rule_events`) — what fired, on which run, and each
 * action's result (Observability WP4.4 "Audit tab"). Renders as a `Dialog` reached from a rule
 * row's "Audit" button. `webhook`-carrying rules get an inline "Send test webhook" affordance
 * (WP4.3's `POST /api/watch-rules/:id/test-fire`) so an operator can verify the endpoint without
 * leaving the list.
 */
export function RuleAuditDialog({
  open,
  onOpenChange,
  rule,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rule: WatchRule | null;
}) {
  const [events, setEvents] = useState<WatchRuleEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testFiring, setTestFiring] = useState(false);

  const load = useCallback(() => {
    if (!rule) return;
    setLoading(true);
    setError(null);
    listWatchRuleEvents(rule.id)
      .then(setEvents)
      .catch((err) =>
        setError(getErrorMessage(err, "Couldn’t load the audit log. Reopen this dialog to try again.")),
      )
      .finally(() => setLoading(false));
  }, [rule]);

  useEffect(() => {
    if (!open || !rule) return;
    setEvents([]);
    load();
  }, [open, rule, load]);

  const hasWebhook = rule?.actions.some((action) => action.type === "webhook") ?? false;

  async function sendTestFire() {
    if (!rule) return;
    setTestFiring(true);
    try {
      const result = await testFireWatchRule(rule.id);
      if (result.ok) {
        toast.success("Test webhook sent", { description: result.detail });
      } else {
        notifyError("Couldn’t send the test webhook. Try again.", { description: result.error });
      }
      load();
    } catch (err) {
      notifyError("Couldn’t send the test webhook. Try again.", {
        description: getErrorMessage(err),
      });
    } finally {
      setTestFiring(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[640px]">
        <DialogHeader>
          <DialogTitle>{rule ? `Audit — ${rule.name}` : "Audit"}</DialogTitle>
          <DialogDescription>Recent fires and action results for this rule.</DialogDescription>
        </DialogHeader>

        {hasWebhook ? (
          <div className="flex justify-end">
            <Button type="button" variant="outline" size="sm" onClick={() => void sendTestFire()} disabled={testFiring}>
              {testFiring ? <Spinner className="size-4" aria-hidden /> : <Send aria-hidden />}
              <span>Send test webhook</span>
            </Button>
          </div>
        ) : null}

        {loading ? (
          <div className="flex items-center gap-2 py-6">
            <Spinner className="size-4" />
            <Text variant="meta" tone="muted">
              Loading audit log…
            </Text>
          </div>
        ) : error ? (
          <Text variant="meta" className="text-destructive" role="alert">
            {error}
          </Text>
        ) : events.length === 0 ? (
          <EmptyState title="No activity yet" description="This rule hasn't fired or been tested yet." />
        ) : (
          <ScrollArea className="max-h-96">
            <ul className="flex flex-col gap-2 pe-3">
              {events.map((event) => (
                <li key={event.id} className="rounded-md border border-border p-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="flex items-center gap-2">
                      <Badge variant={event.result.ok ? "success" : "destructive"}>
                        {event.result.ok ? "ok" : "failed"}
                      </Badge>
                      <Text className="font-medium">{auditActionLabel(event.action)}</Text>
                    </span>
                    <Text variant="meta" tone="muted" className="tabular-nums">
                      {formatDateTime(event.at)}
                    </Text>
                  </div>
                  {event.runId ? (
                    <Text variant="meta" tone="muted" className="mt-1">
                      Run {event.runId}
                    </Text>
                  ) : null}
                  {event.result.detail ? (
                    <Text variant="meta" tone="muted" className="mt-1">
                      {event.result.detail}
                    </Text>
                  ) : null}
                  {event.result.error ? (
                    <Text variant="meta" className="mt-1 text-destructive">
                      {event.result.error}
                    </Text>
                  ) : null}
                </li>
              ))}
            </ul>
          </ScrollArea>
        )}
      </DialogContent>
    </Dialog>
  );
}
