import { useEffect, useMemo, useState } from "react";
import type {
  SkillFileContent,
  SkillFileNode,
  SkillVersion,
  TriggerSurface,
} from "@mcp-token-footprint/shared";
import {
  Badge,
  BentoGrid,
  BentoGridItem,
  Button,
  CardContent,
  CardHeader,
  CardTitle,
  Descriptions,
  DescriptionsItem,
  MetricCard,
  Spinner,
  StatePanel,
  TagInput,
  Text,
  cn,
  toast,
} from "@elabs-ai/components-ui";
import { MessageResponse } from "@elabs-ai/components-ai";
import {
  AlertTriangle,
  ArrowRight,
  FileText,
  Globe,
  Hash,
  Save,
  ScrollText,
  Terminal,
} from "lucide-react";
import { SegmentedBar } from "../../components/TokenViz";
import { ConfirmDialog } from "../../components/dialogs";
import { getErrorMessage } from "../../lib/errors";
import { formatBytes, formatNumber } from "../../lib/format";
import { SkillBindingsPanel } from "./SkillBindingsPanel";
import { getSkillFile, getSkillTriggers, postSkillEdits } from "./skills-inspector-api";
import { notifyError } from "../../lib/notify";

// O5 — document-scale prose for the rendered SKILL.md (the @elabs-ai/components-ai `MessageResponse` renderer emits
// real HTML tags). Unlike the chat renderer this PRESERVES heading hierarchy so the doc reads like a
// document, not a flat wall of text. Semantic tokens only; `!` beats MessageResponse's own prose root.
const SKILL_MD_PROSE = [
  "text-sm text-foreground",
  "[&_h1]:!mt-4 [&_h1]:!mb-2 [&_h1]:!text-lg [&_h1]:!font-semibold [&_h1]:!text-foreground [&_h1:first-child]:!mt-0",
  "[&_h2]:!mt-4 [&_h2]:!mb-2 [&_h2]:!text-base [&_h2]:!font-semibold [&_h2]:!text-foreground",
  "[&_h3]:!mt-3 [&_h3]:!mb-1.5 [&_h3]:!text-sm [&_h3]:!font-semibold [&_h3]:!text-foreground",
  "[&_h4]:!mt-3 [&_h4]:!mb-1 [&_h4]:!text-sm [&_h4]:!font-medium [&_h4]:!text-foreground",
  "[&_p]:!my-2 [&_p]:!leading-relaxed",
  "[&_ul]:!my-2 [&_ul]:!pl-5 [&_ul]:!list-disc [&_ol]:!my-2 [&_ol]:!pl-5 [&_ol]:!list-decimal [&_li]:!my-1",
  "[&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-xs",
  "[&_pre]:my-2 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-muted [&_pre]:p-3",
  "[&_a]:text-primary [&_a]:underline",
  "[&_strong]:font-semibold [&_strong]:text-foreground",
  "[&_table]:my-2",
].join(" ");

// Max characters shown for the frontmatter Description in its bento tile — keeps the Frontmatter
// tile a consistent height across skills; the full text remains available on hover (`title`).
const DESCRIPTION_PREVIEW_LIMIT = 200;

/**
 * Strip a leading YAML frontmatter block (`---\n…\n---`) from a SKILL.md body (K1). The frontmatter is
 * already rendered structurally in the "Frontmatter" side card, so the rendered SKILL.md shows only the
 * markdown body with real heading hierarchy — no flattened `name: … description: …` blob at the top.
 */
function stripFrontmatter(markdown: string): string {
  if (!markdown.startsWith("---")) return markdown;
  // Match a frontmatter fence at the very start: `---` line, body, closing `---` line.
  const match = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/.exec(markdown);
  if (!match) return markdown;
  return markdown.slice(match[0].length).replace(/^\s*\n/, "");
}

// Rough URL/network-reference detector for the security strip. This is a LIGHT client-side scan of
// text file bodies — it flags http(s) URLs and bare protocol-relative refs so the operator can spot
// external calls. It never executes anything (Phase 1 only inspects). Non-text files are skipped.
const NETWORK_REF = /\bhttps?:\/\/[^\s"'<>)]+/i;

type SecuritySurface = {
  scriptCount: number;
  scriptLangs: string[];
  networkRefs: boolean;
  fileCount: number;
  totalBytes: number;
};

/** Derive the security surface from the file list + a light scan of the SKILL.md body. */
function deriveSecurity(files: SkillFileNode[], skillMdBody: string): SecuritySurface {
  const scripts = files.filter((f) => f.kind === "script");
  const scriptLangs = Array.from(
    new Set(
      scripts.map((f) => {
        const ext = f.path.split(".").pop()?.toLowerCase() ?? "";
        return SCRIPT_LANG_LABELS[ext] ?? ext ?? "script";
      }),
    ),
  ).sort();
  return {
    scriptCount: scripts.length,
    scriptLangs,
    networkRefs: NETWORK_REF.test(skillMdBody),
    fileCount: files.length,
    totalBytes: files.reduce((sum, f) => sum + f.size, 0),
  };
}

const SCRIPT_LANG_LABELS: Record<string, string> = {
  py: "python",
  js: "javascript",
  ts: "typescript",
  sh: "shell",
  bash: "shell",
  rb: "ruby",
  go: "go",
};

export type SkillOverviewProps = {
  skillId: string;
  version: SkillVersion;
  files: SkillFileNode[];
  /**
   * Whether `version` is the skill's CURRENT (head) version — threaded from the inspector so the
   * Servers binding panel knows whether its chips are editable (bindings save from the head only).
   */
  isHeadVersion: boolean;
  /**
   * Skill IDE WP 6.1 — fired after a keyword edit in the Triggers panel lands a NEW immutable version
   * (via `set_keywords` through the edits route), so the inspector can refresh + select it.
   */
  onVersionSaved?: (newVersionId: string) => void;
  /**
   * Skill IDE WP 6.1 — deep-link a `/command` entry point into its Design-tab flow. Absent ⇒ the
   * commands render as static rows (no dead control).
   */
  onOpenFlow?: (flowId: string) => void;
};

/** Are two keyword lists identical in order + membership? (drives the Save-enabled state.) */
function sameKeywords(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((value, i) => value === b[i]);
}

/**
 * Overview tab (WP 1.7): the rendered SKILL.md is the primary content, alongside the parsed
 * frontmatter (`Descriptions`), the three-level token-footprint `MetricCard`s + a `SegmentedBar`,
 * and a security strip (scripts / network refs / file+byte totals). The SKILL.md body is fetched
 * once per version via the read-only file route; everything else derives from props.
 */
export function SkillOverview({
  skillId,
  version,
  files,
  isHeadVersion,
  onVersionSaved,
  onOpenFlow,
}: SkillOverviewProps) {
  const skillMdPath = useMemo(() => files.find((f) => f.isSkillMd)?.path, [files]);
  const [body, setBody] = useState<string | null>(null);
  const [bodyError, setBodyError] = useState<string | null>(null);

  // Skill IDE WP 6.1 — the trigger surface (description + keyword triggers + `/command` entry points),
  // fetched from the read-only projection route. `keywordDraft` is the chip editor's staged list; a
  // Save stages a single `set_keywords` op through the existing edits route (a new immutable version).
  const [triggers, setTriggers] = useState<TriggerSurface | null>(null);
  const [triggersError, setTriggersError] = useState<string | null>(null);
  const [keywordDraft, setKeywordDraft] = useState<string[]>([]);
  const [savingKeywords, setSavingKeywords] = useState(false);
  // K10 — saving keywords forks a new immutable version, so it is gated behind a confirm.
  const [confirmSaveKeywords, setConfirmSaveKeywords] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setTriggers(null);
    setTriggersError(null);
    getSkillTriggers(skillId, version.id)
      .then((surface: TriggerSurface) => {
        if (cancelled) return;
        setTriggers(surface);
        setKeywordDraft(surface.keywords);
      })
      .catch((error: unknown) => {
        if (!cancelled) setTriggersError(getErrorMessage(error, "Couldn’t load triggers"));
      });
    return () => {
      cancelled = true;
    };
  }, [skillId, version.id]);

  const keywordsDirty = triggers !== null && !sameKeywords(keywordDraft, triggers.keywords);

  async function saveKeywords() {
    if (savingKeywords) return;
    setSavingKeywords(true);
    try {
      const result = await postSkillEdits(skillId, version.id, {
        baseTreeSha: version.treeSha,
        ops: [{ op: "set_keywords", keywords: keywordDraft }],
        note: "Update trigger keywords",
      });
      if ("unchanged" in result) {
        toast.info("No change", { description: "The keyword set is already up to date." });
        return;
      }
      toast.success("Keywords saved", {
        description: `Saved as v${result.version.seq} — the trigger surface is updated.`,
      });
      onVersionSaved?.(result.version.id);
      setConfirmSaveKeywords(false);
    } catch (error) {
      notifyError("Couldn’t save keywords", {
        description: getErrorMessage(
          error,
          "The edit was rejected. Re-open the skill and try again.",
        ),
      });
    } finally {
      setSavingKeywords(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    if (!skillMdPath) {
      setBody("");
      setBodyError(null);
      return;
    }
    setBody(null);
    setBodyError(null);
    getSkillFile(skillId, version.id, skillMdPath)
      .then((content: SkillFileContent) => {
        if (cancelled) return;
        setBody(content.isBinary ? "" : content.text);
      })
      .catch((error: unknown) => {
        if (!cancelled) setBodyError(getErrorMessage(error, "Couldn’t load SKILL.md"));
      });
    return () => {
      cancelled = true;
    };
  }, [skillId, version.id, skillMdPath]);

  const security = useMemo(() => deriveSecurity(files, body ?? ""), [files, body]);
  // K1 — render only the markdown body (real heading hierarchy); the frontmatter lives in the side card.
  const renderedBody = useMemo(() => (body === null ? null : stripFrontmatter(body)), [body]);
  const manifest = version.manifest;

  // Clamp the frontmatter description to a fixed length so the Frontmatter tile is a consistent
  // height no matter how long a skill's description is (the full text stays on hover via `title`).
  const fullDescription = manifest.description ?? "";
  const clampedDescription =
    fullDescription.length > DESCRIPTION_PREVIEW_LIMIT
      ? `${fullDescription.slice(0, DESCRIPTION_PREVIEW_LIMIT).trimEnd()}…`
      : fullDescription || "—";

  return (
    <div className="flex flex-col gap-6">
      {/* Overview cards as a bento grid (2026-07-12): fixed-height tiles keep sizing uniform, and
          each tile's body scrolls (overflow-y-auto) so variable content never clips the fixed rows. */}
      <BentoGrid>
        <BentoGridItem size="lg" className="flex min-w-0 flex-col">
          <CardHeader className="flex-none flex-row items-center justify-between gap-2">
            <CardTitle>Frontmatter</CardTitle>
            <Badge variant={version.manifestValid ? "success" : "destructive"}>
              {version.manifestValid ? "valid" : "invalid"}
            </Badge>
          </CardHeader>
          <CardContent className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
            <Descriptions columns={1} layout="horizontal">
              <DescriptionsItem label="Name">{manifest.name || "—"}</DescriptionsItem>
              <DescriptionsItem label="Description">
                <span title={fullDescription || undefined}>{clampedDescription}</span>
              </DescriptionsItem>
              {manifest.license ? (
                <DescriptionsItem label="License">{manifest.license}</DescriptionsItem>
              ) : null}
              {manifest.compatibility ? (
                <DescriptionsItem label="Compatibility">{manifest.compatibility}</DescriptionsItem>
              ) : null}
              {manifest.allowedTools ? (
                <DescriptionsItem label="Allowed tools">
                  <Text variant="meta" className="font-mono break-words">
                    {manifest.allowedTools}
                  </Text>
                </DescriptionsItem>
              ) : null}
              {Object.entries(manifest.metadata ?? {}).map(([key, value]) => (
                <DescriptionsItem key={key} label={`metadata.${key}`}>
                  {value}
                </DescriptionsItem>
              ))}
            </Descriptions>
            {!version.manifestValid && version.manifestErrors.length > 0 ? (
              <ul className="flex flex-col gap-1">
                {version.manifestErrors.map((error) => (
                  <li key={error} className="flex items-start gap-1.5">
                    <AlertTriangle
                      className="mt-0.5 size-3.5 shrink-0 text-destructive"
                      aria-hidden
                    />
                    <Text variant="meta" tone="muted">
                      {error}
                    </Text>
                  </li>
                ))}
              </ul>
            ) : null}
          </CardContent>
        </BentoGridItem>

        <BentoGridItem size="lg" aria-label="Token footprint" className="flex min-w-0 flex-col">
          <CardHeader className="flex-none">
            <CardTitle>Token footprint</CardTitle>
          </CardHeader>
          <CardContent className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
            <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2">
            <MetricCard
              label="L1 · metadata"
              value={formatNumber(version.l1MetadataTokens)}
              description="name + description"
            />
            <MetricCard
              label="L2 · body"
              value={formatNumber(version.l2BodyTokens)}
              description="SKILL.md"
            />
            <MetricCard
              label="L3 · resources"
              value={formatNumber(version.l3ResourceTokens)}
              description="other text files"
            />
            <MetricCard
              label="Total"
              value={formatNumber(version.totalTokens)}
              description={version.tokenProfile}
              emphasis="headline"
            />
            </div>
            <SegmentedBar
              ariaLabel="Token footprint by level"
              segments={[
                { label: "L1 metadata", value: version.l1MetadataTokens },
                { label: "L2 body", value: version.l2BodyTokens },
                { label: "L3 resources", value: version.l3ResourceTokens },
              ]}
            />
          </CardContent>
        </BentoGridItem>

        <BentoGridItem size="lg" className="flex min-w-0 flex-col">
          <CardHeader className="flex-none">
            <CardTitle>Triggers</CardTitle>
          </CardHeader>
          <CardContent className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto">
            {triggersError ? (
              <StatePanel
                kind="error"
                title="Couldn’t load triggers — refresh the page to try again."
                description={triggersError}
              />
            ) : triggers === null ? (
              <StatePanel
                kind="loading"
                title="Loading triggers…"
                loadingLabel="Loading triggers…"
              />
            ) : (
              <>
                {/* Keyword triggers — a chip editor staging `set_keywords`. */}
                <section aria-label="Keyword triggers" className="flex flex-col gap-2">
                  <div className="flex items-center gap-1.5">
                    <Hash className="size-3.5 text-muted-foreground" aria-hidden />
                    <Text variant="meta" tone="muted">
                      Keyword triggers
                    </Text>
                  </div>
                  {/* O6 — "Save as new version" sits to the RIGHT of the keyword input. */}
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <TagInput
                        value={keywordDraft}
                        onValueChange={setKeywordDraft}
                        disabled={savingKeywords}
                        placeholder="Add a keyword phrase…"
                        aria-label="Keyword triggers"
                      />
                    </div>
                    <Button
                      size="sm"
                      className="shrink-0"
                      onClick={() => setConfirmSaveKeywords(true)}
                      disabled={!keywordsDirty || savingKeywords}
                    >
                      {savingKeywords ? <Spinner className="size-4" /> : <Save aria-hidden />}
                      <span>{savingKeywords ? "Saving…" : "Save as new version"}</span>
                    </Button>
                    {keywordsDirty ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="shrink-0"
                        onClick={() => setKeywordDraft(triggers.keywords)}
                        disabled={savingKeywords}
                      >
                        Reset
                      </Button>
                    ) : null}
                  </div>
                  <Text variant="meta" tone="muted">
                    Natural-language phrases that trigger this skill. Saving writes them into the
                    frontmatter <span className="font-mono">keywords</span> list as a new immutable
                    version.
                  </Text>
                </section>

                {/* Command entry points. */}
                <section aria-label="Command entry points" className="flex flex-col gap-2">
                  <div className="flex items-center gap-1.5">
                    <Terminal className="size-3.5 text-muted-foreground" aria-hidden />
                    <Text variant="meta" tone="muted">
                      Command entry points
                    </Text>
                  </div>
                  {triggers.commands.length === 0 ? (
                    <Text variant="meta" tone="muted">
                      No <span className="font-mono">/command</span> entry points — this skill
                      triggers on keywords only.
                    </Text>
                  ) : (
                    <ul className="flex flex-col gap-1">
                      {triggers.commands.map((command) => (
                        <li key={command.nodeId} className="flex items-center gap-2">
                          {onOpenFlow ? (
                            <Button
                              variant="link"
                              size="sm"
                              className="h-auto gap-1.5 px-0"
                              onClick={() => onOpenFlow(command.flowId)}
                            >
                              <span className="font-mono">{command.value}</span>
                              <ArrowRight className="size-3.5" aria-hidden />
                              <span className="text-muted-foreground">section</span>
                            </Button>
                          ) : (
                            <Badge variant="secondary" className="font-mono">
                              {command.value}
                            </Badge>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              </>
            )}
          </CardContent>
        </BentoGridItem>

        <BentoGridItem size="md" className="flex min-w-0 flex-col">
          <CardHeader className="flex-none">
            <CardTitle>Security surface</CardTitle>
          </CardHeader>
          <CardContent className="min-h-0 flex-1 overflow-y-auto">
            <Descriptions columns={1} layout="horizontal">
              <DescriptionsItem label="Scripts">
                <span className="flex items-center gap-1.5">
                  <Terminal className="size-3.5 text-muted-foreground" aria-hidden />
                  {security.scriptCount > 0 ? (
                    <Badge variant="warning">
                      {security.scriptCount} · {security.scriptLangs.join(", ") || "script"}
                    </Badge>
                  ) : (
                    <Badge variant="secondary">none</Badge>
                  )}
                </span>
              </DescriptionsItem>
              <DescriptionsItem label="Network refs">
                <span className="flex items-center gap-1.5">
                  <Globe className="size-3.5 text-muted-foreground" aria-hidden />
                  {security.networkRefs ? (
                    <Badge variant="warning">detected in SKILL.md</Badge>
                  ) : (
                    <Badge variant="secondary">none detected</Badge>
                  )}
                </span>
              </DescriptionsItem>
              <DescriptionsItem label="Files" numeric>
                <span className="flex items-center gap-1.5">
                  <FileText className="size-3.5 text-muted-foreground" aria-hidden />
                  <span className="tabular-nums">{formatNumber(security.fileCount)}</span>
                </span>
              </DescriptionsItem>
              <DescriptionsItem label="Total size" numeric>
                <span className="flex items-center gap-1.5">
                  <ScrollText className="size-3.5 text-muted-foreground" aria-hidden />
                  <span className="tabular-nums">{formatBytes(security.totalBytes)}</span>
                </span>
              </DescriptionsItem>
            </Descriptions>
          </CardContent>
        </BentoGridItem>

        {/* Servers — the skill↔server (and server-type) binding surface, reachable here now that the
            Design-tab Tools palette that used to host it is hidden (O2b). Overview has no editor draft,
            so it is never binding-blocked; `body` is the committed SKILL.md text (seed, no load flash). */}
        <BentoGridItem size="md" className="flex min-w-0 flex-col">
          <CardHeader className="flex-none">
            <CardTitle>Servers</CardTitle>
          </CardHeader>
          <CardContent className="min-h-0 flex-1 overflow-y-auto">
          <SkillBindingsPanel
            skillId={skillId}
            versionId={version.id}
            isHeadVersion={isHeadVersion}
            skillMdText={body}
            blockedReason={null}
            onVersionSaved={(id) => onVersionSaved?.(id)}
          />
          </CardContent>
        </BentoGridItem>
      </BentoGrid>

      {/* O5 — Rendered SKILL.md: the @elabs-ai/components-ai markdown renderer, a borderless SCROLLABLE box (no
          wrapping Card border). Full width below the two card rows. */}
      <section aria-label="SKILL.md" className="flex min-w-0 flex-col gap-2">
        <div className="flex items-center gap-1.5">
          <FileText className="size-3.5 text-muted-foreground" aria-hidden />
          <Text variant="meta" tone="muted">
            SKILL.md
          </Text>
        </div>
        {bodyError ? (
          <StatePanel
            kind="error"
            title="Couldn’t render SKILL.md — refresh the page to try again."
            description={bodyError}
          />
        ) : renderedBody === null ? (
          <StatePanel kind="loading" title="Rendering…" loadingLabel="Rendering SKILL.md…" />
        ) : !skillMdPath ? (
          <StatePanel
            kind="empty"
            title="No SKILL.md"
            description="This version has no SKILL.md file."
          />
        ) : renderedBody === "" ? (
          <StatePanel
            kind="empty"
            title="Frontmatter only"
            description="This SKILL.md has no body content beyond its frontmatter — see the Frontmatter card."
          />
        ) : (
          // Finding 9 / D-IC9 — this prose block had no measure cap and ran edge to edge; cap it at
          // ~68ch for readability. A skill author's own markdown table still renders at its natural
          // width (via `[&_table]` in SKILL_MD_PROSE) and can scroll independently of this cap —
          // capping the reading column doesn't touch the box's own `overflow-y-auto` scroll.
          <div
            className={cn(
              "max-h-[640px] min-w-0 max-w-[68ch] overflow-y-auto rounded-lg bg-muted/40 p-4",
              SKILL_MD_PROSE,
            )}
          >
            <MessageResponse>{renderedBody}</MessageResponse>
          </div>
        )}
      </section>

      {/* K10 — saving keywords forks a new immutable version; confirm the consequence first. */}
      <ConfirmDialog
        open={confirmSaveKeywords}
        onOpenChange={(open) => {
          if (!open && !savingKeywords) setConfirmSaveKeywords(false);
        }}
        title="Save keywords as a new version?"
        description="Skill versions are immutable. Saving these keyword triggers writes them into the frontmatter and creates a new version — the current version is left unchanged, so you can always roll back."
        confirmLabel="Save as new version"
        busy={savingKeywords}
        onConfirm={() => void saveKeywords()}
      />
    </div>
  );
}
