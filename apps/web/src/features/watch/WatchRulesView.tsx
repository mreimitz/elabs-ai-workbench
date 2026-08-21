import { useCallback, useEffect, useState } from "react";
import {
  isWatchRulePaused,
  WATCH_PAUSE_PRESET_MINUTES,
  type WatchRule,
  type WatchRuleEvent,
} from "@mcp-token-footprint/shared";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Badge,
  Button,
  Card,
  CardContent,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  EmptyState,
  Heading,
  StatePanel,
  Switch,
  Text,
  buttonVariants,
  toast,
} from "@elabs-ai/components-ui";
import { Bell, BellOff, Copy, ListChecks, MoreHorizontal, Pause, Pencil, Play, Plus, Trash2 } from "lucide-react";
import { IconButton } from "../../components/IconButton";
import { PageShell } from "../../components/PageShell";
import { ViewToolbar } from "../../components/ViewToolbar";
import { deleteWatchRule, listWatchRuleEvents, listWatchRules, updateWatchRule } from "../../lib/api";
import { getErrorMessage } from "../../lib/errors";
import { formatRelativeTime } from "../../lib/format";
import { actionsSummary, deriveRuleFireStats, triggerLabel } from "./audit-derive";
import { RuleAuditDialog } from "./RuleAuditDialog";
import { RuleEditorDialog, type RuleEditorMode } from "./RuleEditorDialog";
import { notifyError } from "../../lib/notify";

/**
 * The watch-rules management surface (Observability WP4.4) — reached from Settings -> Testing's
 * "Watch rules" card. List (enabled toggle, trigger chip, last fired / fire count, edit/duplicate/
 * delete), the editor dialog (create/edit/duplicate), and a per-rule audit log.
 */
export function WatchRulesView() {
  const [rules, setRules] = useState<WatchRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [fireStats, setFireStats] = useState<Record<string, { fireCount: number; lastFiredAt: string | null }>>(
    {},
  );

  const [editorOpen, setEditorOpen] = useState(false);
  const [editorMode, setEditorMode] = useState<RuleEditorMode>("create");
  const [editorRule, setEditorRule] = useState<WatchRule | null>(null);

  const [auditRule, setAuditRule] = useState<WatchRule | null>(null);
  const [auditOpen, setAuditOpen] = useState(false);

  const [pendingDelete, setPendingDelete] = useState<WatchRule | null>(null);

  const load = useCallback(async (isActive: () => boolean = () => true) => {
    setLoading(true);
    try {
      const list = await listWatchRules();
      if (!isActive()) return;
      setRules(list);
      // Best-effort per-rule audit fetch for the list's "last fired"/"fire count" glance — bounded
      // by the rule count (rules are a hand-authored, small set; no pagination needed here).
      const entries = await Promise.all(
        list.map(async (rule): Promise<[string, WatchRuleEvent[]]> => {
          try {
            return [rule.id, await listWatchRuleEvents(rule.id)];
          } catch {
            return [rule.id, []];
          }
        }),
      );
      if (!isActive()) return;
      const stats: Record<string, { fireCount: number; lastFiredAt: string | null }> = {};
      for (const [id, events] of entries) stats[id] = deriveRuleFireStats(events);
      setFireStats(stats);
    } catch (error) {
      if (isActive())
        notifyError("Couldn’t load watch rules. Reload the page to try again.", {
          description: getErrorMessage(error),
        });
    } finally {
      if (isActive()) setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    void load(() => active);
    return () => {
      active = false;
    };
  }, [load]);

  function openCreate() {
    setEditorMode("create");
    setEditorRule(null);
    setEditorOpen(true);
  }

  function openEdit(rule: WatchRule) {
    setEditorMode("edit");
    setEditorRule(rule);
    setEditorOpen(true);
  }

  function openDuplicate(rule: WatchRule) {
    setEditorMode("duplicate");
    setEditorRule(rule);
    setEditorOpen(true);
  }

  function openAudit(rule: WatchRule) {
    setAuditRule(rule);
    setAuditOpen(true);
  }

  async function toggleEnabled(rule: WatchRule, enabled: boolean) {
    // Optimistic — a small list, an instant toggle feel matters more than a round-trip stall.
    setRules((current) => current.map((r) => (r.id === rule.id ? { ...r, enabled } : r)));
    try {
      await updateWatchRule(rule.id, { enabled });
    } catch (error) {
      setRules((current) => current.map((r) => (r.id === rule.id ? { ...r, enabled: rule.enabled } : r)));
      notifyError("Couldn’t update the rule. Try again.", {
        description: getErrorMessage(error),
      });
    }
  }

  /**
   * AM-OB10 — pause ("stop telling me until <time>") is NOT disable ("I don't want this rule"). A
   * paused rule keeps evaluating and keeps recording its state; only the actions are suppressed, so
   * it never comes back armed and blind. `minutes === null` resumes.
   */
  async function setPause(rule: WatchRule, minutes: number | null) {
    const pausedUntil =
      minutes === null ? null : new Date(Date.now() + minutes * 60_000).toISOString();
    const previous = rule.pausedUntil;
    setRules((current) =>
      current.map((r) =>
        r.id === rule.id
          ? { ...r, ...(pausedUntil === null ? { pausedUntil: undefined } : { pausedUntil }) }
          : r,
      ),
    );
    try {
      await updateWatchRule(rule.id, { pausedUntil });
      toast.success(minutes === null ? "Rule resumed" : "Rule paused", { description: rule.name });
    } catch (error) {
      setRules((current) =>
        current.map((r) =>
          r.id === rule.id
            ? { ...r, ...(previous === undefined ? { pausedUntil: undefined } : { pausedUntil: previous }) }
            : r,
        ),
      );
      notifyError("Couldn’t update the rule. Try again.", {
        description: getErrorMessage(error),
      });
    }
  }

  async function performDelete() {
    if (!pendingDelete) return;
    const target = pendingDelete;
    setPendingDelete(null);
    try {
      await deleteWatchRule(target.id);
      toast.success("Rule deleted");
      await load();
    } catch (error) {
      notifyError("Couldn’t delete the rule. Try again.", {
        description: getErrorMessage(error),
      });
    }
  }

  return (
    <PageShell
      headerVariant="toolbar"
      width="full"
      header={
        <ViewToolbar
          info={
            <p className="max-w-xs text-pretty">
              When a run matches a filter, run one or more actions — notify, pin, add to a
              collection, promote to a draft test, run an extra grader, or POST a webhook.
            </p>
          }
          actions={
            <Button onClick={openCreate}>
              <Plus aria-hidden />
              <span>New rule</span>
            </Button>
          }
        />
      }
    >
      <Heading level={1} className="sr-only">
        Watch rules
      </Heading>

      {loading ? (
        <StatePanel kind="loading" title="Loading rules…" loadingLabel="Loading rules…" />
      ) : rules.length === 0 ? (
        <EmptyState
          icon={<Bell aria-hidden />}
          title="No watch rules yet"
          description="Create a rule to get notified, promote failing runs to tests, or ping a webhook automatically."
          actions={
            <Button onClick={openCreate}>
              <Plus aria-hidden />
              <span>New rule</span>
            </Button>
          }
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {rules.map((rule) => (
            <li key={rule.id}>
              <RuleRow
                rule={rule}
                stats={fireStats[rule.id]}
                onToggleEnabled={(enabled) => void toggleEnabled(rule, enabled)}
                onEdit={() => openEdit(rule)}
                onDuplicate={() => openDuplicate(rule)}
                onAudit={() => openAudit(rule)}
                onDelete={() => setPendingDelete(rule)}
                onSetPause={(minutes) => void setPause(rule, minutes)}
              />
            </li>
          ))}
        </ul>
      )}

      <RuleEditorDialog
        open={editorOpen}
        onOpenChange={setEditorOpen}
        mode={editorMode}
        rule={editorRule}
        onSaved={() => void load()}
      />

      <RuleAuditDialog open={auditOpen} onOpenChange={setAuditOpen} rule={auditRule} />

      <AlertDialog open={pendingDelete !== null} onOpenChange={(open) => !open && setPendingDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {pendingDelete?.name ?? "rule"}?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the rule and its audit log. It never affects runs it already acted on.
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className={buttonVariants({ variant: "destructive" })}
              onClick={() => void performDelete()}
            >
              Delete rule
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PageShell>
  );
}

/** AM-OB10 — the pause durations offered in the row menu ("stop telling me until…"). */
const PAUSE_PRESET_LABELS: Record<number, string> = {
  60: "Pause for 1 hour",
  240: "Pause for 4 hours",
  1440: "Pause for 24 hours",
};

function RuleRow({
  rule,
  stats,
  onToggleEnabled,
  onEdit,
  onDuplicate,
  onAudit,
  onDelete,
  onSetPause,
}: {
  rule: WatchRule;
  stats: { fireCount: number; lastFiredAt: string | null } | undefined;
  onToggleEnabled: (enabled: boolean) => void;
  onEdit: () => void;
  onDuplicate: () => void;
  onAudit: () => void;
  onDelete: () => void;
  /** `null` resumes; a number pauses for that many minutes. */
  onSetPause: (minutes: number | null) => void;
}) {
  const paused = isWatchRulePaused(rule, Date.now());
  return (
    <Card>
      <CardContent className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <Switch
            checked={rule.enabled}
            onCheckedChange={onToggleEnabled}
            aria-label={rule.enabled ? `Disable ${rule.name}` : `Enable ${rule.name}`}
          />
          <div className="flex min-w-0 flex-col gap-1">
            <div className="flex flex-wrap items-center gap-2">
              <Text className="min-w-0 truncate font-medium">{rule.name}</Text>
              <Badge variant="secondary">{triggerLabel(rule.trigger)}</Badge>
              {!rule.enabled ? <Badge variant="outline">disabled</Badge> : null}
              {/* AM-OB10 — visibly DISTINCT from "disabled": the rule is still on and still
                  evaluating, it just isn't telling you about it until the stated time. */}
              {paused && rule.enabled ? (
                <Badge variant="outline">
                  <BellOff aria-hidden />
                  <span>
                    paused · resumes {rule.pausedUntil ? formatRelativeTime(rule.pausedUntil) : "soon"}
                  </span>
                </Badge>
              ) : null}
            </div>
            <Text variant="meta" tone="muted" className="min-w-0 truncate">
              {actionsSummary(rule.actions)}
            </Text>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <Text variant="meta" tone="muted" className="tabular-nums">
            {stats
              ? stats.lastFiredAt
                ? `Fired ${stats.fireCount}× · last ${formatRelativeTime(stats.lastFiredAt)}`
                : "Never fired"
              : "…"}
          </Text>
          <Button variant="outline" size="sm" onClick={onAudit}>
            <ListChecks aria-hidden />
            <span>Audit</span>
          </Button>
          <Button variant="outline" size="sm" onClick={onEdit}>
            <Pencil aria-hidden />
            <span>Edit</span>
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <IconButton variant="ghost" size="icon-sm" label={`More actions for ${rule.name}`}>
                <MoreHorizontal aria-hidden />
              </IconButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {paused ? (
                <DropdownMenuItem onSelect={() => onSetPause(null)}>
                  <Play aria-hidden />
                  <span>Resume now</span>
                </DropdownMenuItem>
              ) : (
                WATCH_PAUSE_PRESET_MINUTES.map((minutes) => (
                  <DropdownMenuItem key={minutes} onSelect={() => onSetPause(minutes)}>
                    <Pause aria-hidden />
                    <span>{PAUSE_PRESET_LABELS[minutes] ?? `Pause for ${minutes} min`}</span>
                  </DropdownMenuItem>
                ))
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={onDuplicate}>
                <Copy aria-hidden />
                <span>Duplicate</span>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={onDelete}>
                <Trash2 aria-hidden />
                <span>Delete</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </CardContent>
    </Card>
  );
}
