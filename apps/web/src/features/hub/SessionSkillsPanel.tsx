import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Progress,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Spinner,
  Text,
} from "@brand/ui";
import type {
  HubSessionSkillsView,
  HubSkillAttachmentInput,
  HubSkillInvocationMode,
  Skill,
  SkillVersion,
} from "@mcp-token-footprint/shared";
import { Plus, Sparkles, Trash2 } from "lucide-react";
import { getHubSessionSkills, listSkills, replaceHubSessionSkills } from "../../lib/api";
import { getErrorMessage } from "../../lib/errors";
import { formatNumber } from "../../lib/format";
import { IconButton } from "../../components/IconButton";
import { SegmentedBar } from "../../components/TokenViz";
import { listSkillVersions } from "../skills/skills-inspector-api";
import { AddHubSkillModal } from "./AddHubSkillModal";
import { notifyError } from "../../lib/notify";

const INVOCATION_LABEL: Record<HubSkillInvocationMode, string> = {
  model_invocable: "Model-invocable",
  name_only: "Name-only",
  user_only: "User-only (slash)",
};
const INVOCATION_MODES = Object.keys(INVOCATION_LABEL) as HubSkillInvocationMode[];

function toAttachmentInput(
  attachment: HubSessionSkillsView["attachments"][number],
): HubSkillAttachmentInput {
  return {
    skillId: attachment.skillId,
    versionMode: attachment.versionMode,
    ...(attachment.pinnedVersionId ? { pinnedVersionId: attachment.pinnedVersionId } : {}),
    invocationMode: attachment.invocationMode,
  };
}

/**
 * Assistant Hub (WP2.4, R-SK1…R-SK6/R-SK8) — the SESSION SETTINGS skill panel: attach/detach skills,
 * change a skill's invocation control inline, see the live L1 listing budget (R-SK1) and the R-SK5
 * session-true L1/L2/L3 usage per skill, and jump to a skill's registry inspector for the full
 * frontmatter superset (R-SK4) + version history (R-SK8). Skills are read + metered here, NEVER
 * executed (`.claude/rules/mcp-and-security.md`).
 */
export function SessionSkillsPanel(props: {
  sessionId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { sessionId, open, onOpenChange } = props;
  const [view, setView] = useState<HubSessionSkillsView | null>(null);
  const [loading, setLoading] = useState(false);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [skillVersions, setSkillVersions] = useState<Map<string, SkillVersion[]>>(new Map());
  const [addOpen, setAddOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [skillsView, skillList] = await Promise.all([getHubSessionSkills(sessionId), listSkills()]);
      setView(skillsView);
      setSkills(skillList);
      // Per-skill versions — best-effort per skill (a 404'd skill just contributes no versions), the
      // SAME pattern the Testing feature's EnvironmentsView uses for its AddSkillModal.
      const versionEntries = await Promise.all(
        skillList.map(async (skill) => {
          try {
            return [skill.id, await listSkillVersions(skill.id)] as const;
          } catch {
            return null;
          }
        }),
      );
      setSkillVersions(
        new Map(versionEntries.filter((e): e is readonly [string, SkillVersion[]] => e !== null)),
      );
    } catch (error) {
      notifyError("Couldn’t load session skills", { description: getErrorMessage(error) });
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => {
    if (open) void refresh();
  }, [open, refresh]);

  const attachmentInputs = useMemo<HubSkillAttachmentInput[]>(
    () => (view?.attachments ?? []).map(toAttachmentInput),
    [view],
  );
  const existingSkillIds = useMemo(() => new Set(attachmentInputs.map((a) => a.skillId)), [attachmentInputs]);
  const usageBySkill = useMemo(() => new Map((view?.usage ?? []).map((u) => [u.skillId, u])), [view]);

  const applyAttachments = useCallback(
    async (next: HubSkillAttachmentInput[]) => {
      setBusy(true);
      try {
        const updated = await replaceHubSessionSkills(sessionId, next);
        setView(updated);
      } catch (error) {
        notifyError("Couldn’t update session skills", { description: getErrorMessage(error) });
      } finally {
        setBusy(false);
      }
    },
    [sessionId],
  );

  const handleAdd = useCallback(
    (entry: HubSkillAttachmentInput) => {
      void applyAttachments([...attachmentInputs, entry]);
    },
    [applyAttachments, attachmentInputs],
  );

  const handleRemove = useCallback(
    (skillId: string) => {
      void applyAttachments(attachmentInputs.filter((a) => a.skillId !== skillId));
    },
    [applyAttachments, attachmentInputs],
  );

  const handleInvocationChange = useCallback(
    (skillId: string, mode: HubSkillInvocationMode) => {
      void applyAttachments(
        attachmentInputs.map((a) => (a.skillId === skillId ? { ...a, invocationMode: mode } : a)),
      );
    },
    [applyAttachments, attachmentInputs],
  );

  const listingPercent =
    view && view.listing.budgetTokens > 0
      ? Math.min(100, Math.round((view.listing.usedTokens / view.listing.budgetTokens) * 100))
      : 0;

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent size="lg" className="flex max-h-[85vh] flex-col gap-0 p-0">
          <DialogHeader className="flex-none gap-1 border-b border-border p-4 pe-12">
            <DialogTitle>Session skills</DialogTitle>
            <DialogDescription>
              An attached skill contributes its name + description to this session's listing (L1,
              always-on) and loads its full content on demand via <code>skills.load</code> — read and
              metered, never executed.
            </DialogDescription>
          </DialogHeader>

          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
            {loading && !view ? (
              <div className="flex items-center justify-center py-12">
                <Spinner className="size-5" />
              </div>
            ) : view ? (
              <>
                {view.listing.budgetTokens > 0 ? (
                  <div className="flex flex-col gap-1.5 rounded-md border border-border bg-muted/30 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <Text variant="meta" tone="muted">
                        L1 listing budget
                      </Text>
                      <Text variant="meta" tone="muted" className="tabular-nums">
                        {formatNumber(view.listing.usedTokens)} / {formatNumber(view.listing.budgetTokens)}{" "}
                        tok
                      </Text>
                    </div>
                    <Progress value={listingPercent} aria-label="L1 skills listing budget used" />
                  </div>
                ) : null}

                {view.attachments.length === 0 ? (
                  <EmptyState
                    icon={<Sparkles aria-hidden />}
                    title="No skills attached"
                    description="Attach a skill to give this session name + description context, loadable on demand via skills.load."
                    actions={
                      <Button onClick={() => setAddOpen(true)}>
                        <Plus aria-hidden />
                        <span>Attach skill</span>
                      </Button>
                    }
                  />
                ) : (
                  <ul className="flex flex-col gap-2">
                    {view.attachments.map((attachment) => {
                      const usage = usageBySkill.get(attachment.skillId);
                      const listingEntry = view.listing.entries.find(
                        (entry) => entry.skillId === attachment.skillId,
                      );
                      const segments = usage
                        ? [
                            { label: "L1 listing", value: usage.l1Tokens },
                            { label: "L2 body", value: usage.l2Tokens },
                            { label: "L3 files", value: usage.l3Tokens },
                          ]
                        : [];
                      return (
                        <li
                          key={attachment.skillId}
                          className="flex flex-col gap-2 rounded-md border border-border bg-card p-3"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex min-w-0 flex-col gap-1">
                              <div className="flex min-w-0 items-center gap-2">
                                <Sparkles className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                                <Link
                                  to={`/skills/${attachment.skillId}`}
                                  className="truncate font-medium hover:underline"
                                  title={attachment.skillName}
                                >
                                  {attachment.skillName}
                                </Link>
                              </div>
                              <div className="flex flex-wrap items-center gap-1.5">
                                <Badge variant="secondary" className="tabular-nums">
                                  {attachment.versionMode === "latest" ? "Latest" : attachment.versionLabel}
                                </Badge>
                                {listingEntry?.demoted ? (
                                  <Badge variant="outline">auto-demoted to name-only</Badge>
                                ) : null}
                                {attachment.frontmatter.whenToUse ? (
                                  <Text variant="meta" tone="muted" className="min-w-0 truncate">
                                    {attachment.frontmatter.whenToUse}
                                  </Text>
                                ) : null}
                              </div>
                            </div>
                            <div className="flex shrink-0 items-center gap-2">
                              <Select
                                value={attachment.invocationMode}
                                onValueChange={(value) =>
                                  handleInvocationChange(attachment.skillId, value as HubSkillInvocationMode)
                                }
                                disabled={busy}
                              >
                                <SelectTrigger
                                  className="w-48"
                                  aria-label={`Invocation for ${attachment.skillName}`}
                                >
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {INVOCATION_MODES.map((mode) => (
                                    <SelectItem key={mode} value={mode}>
                                      {INVOCATION_LABEL[mode]}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                              <IconButton
                                variant="ghost"
                                size="sm"
                                label={`Remove ${attachment.skillName}`}
                                onClick={() => handleRemove(attachment.skillId)}
                                disabled={busy}
                              >
                                <Trash2 aria-hidden />
                              </IconButton>
                            </div>
                          </div>
                          {usage && usage.totalTokens > 0 ? (
                            <SegmentedBar
                              segments={segments}
                              ariaLabel={`${attachment.skillName} session token usage`}
                            />
                          ) : (
                            <Text variant="meta" tone="muted">
                              {formatNumber(usage?.l1Tokens ?? 0)} tok listed · not yet loaded this
                              session
                            </Text>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </>
            ) : null}
          </div>

          <DialogFooter className="flex-none border-t border-border p-4">
            {view && view.attachments.length > 0 ? (
              <Button variant="outline" onClick={() => setAddOpen(true)} disabled={busy}>
                <Plus aria-hidden />
                <span>Attach another</span>
              </Button>
            ) : null}
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AddHubSkillModal
        open={addOpen}
        onOpenChange={setAddOpen}
        skills={skills}
        skillVersions={skillVersions}
        existingSkillIds={existingSkillIds}
        onAdd={handleAdd}
      />
    </>
  );
}
