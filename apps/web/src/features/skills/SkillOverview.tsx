import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type {
  SkillFileContent,
  SkillFileNode,
  SkillVersion,
  TriggerSurface,
} from "@mcp-token-footprint/shared";
import { deriveSkillSecuritySurface } from "@mcp-token-footprint/shared";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Descriptions,
  DescriptionsItem,
  MetricCard,
  ResizableHandle,
  ResizablePanel,
  StatePanel,
  Text,
  cn,
} from "@elabs-ai/components-ui";
import { MessageResponse } from "@elabs-ai/components-ai";
import {
  AlertTriangle,
  ArrowRight,
  FileText,
  Globe,
  Hash,
  Pencil,
  ScrollText,
  Terminal,
} from "lucide-react";
import { AdaptivePanelGroup } from "../../components/AdaptivePanelGroup";
import { SegmentedBar } from "../../components/TokenViz";
import { MD_TABLE_COMPONENTS } from "../testing/ChatMarkdown";
import { getErrorMessage } from "../../lib/errors";
import { formatBytes, formatNumber } from "../../lib/format";
import { SkillBindingsPanel } from "./SkillBindingsPanel";
import { getSkillFile, getSkillTriggers } from "./skills-inspector-api";

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

// The react-resizable-panels `autoSaveId` under which this tab's split (document | facts) persists,
// so a reader who drags the handle keeps that split next time — the same mechanism the run console
// and the Skill IDE use for theirs.
const SPLIT_AUTOSAVE_ID = "mcp-token-footprint.skill-overview.split";

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

// The security surface (scripts + their languages, network references, file/byte totals) is derived by
// `deriveSkillSecuritySurface` in `packages/shared` — the SAME pure function the workbench MCP
// server's `skills_security` tool calls (planning/Roadmap/RM-08-ci/mcp-server.md, D-MCP4: one derivation, several
// surfaces). It inspects, it never executes.

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
   * Skill IDE WP 6.1 — deep-link a `/command` entry point into its Design-tab flow. Absent ⇒ the
   * commands render as static rows (no dead control).
   */
  onOpenFlow?: (flowId: string) => void;
};

/**
 * Overview tab (WP 1.7): the rendered SKILL.md is the primary content and holds the LEFT column;
 * everything derived about the version stacks in a right-hand rail in reading order — parsed
 * frontmatter (`Descriptions`), the three-level token-footprint `MetricCard`s + a `SegmentedBar`,
 * the trigger surface, the server bindings, and the security strip (scripts / network refs /
 * file+byte totals). The SKILL.md body is fetched once per version via the read-only file route;
 * everything else derives from props.
 */
export function SkillOverview({
  skillId,
  version,
  files,
  isHeadVersion,
  onOpenFlow,
}: SkillOverviewProps) {
  const skillMdPath = useMemo(() => files.find((f) => f.isSkillMd)?.path, [files]);
  const [body, setBody] = useState<string | null>(null);
  const [bodyError, setBodyError] = useState<string | null>(null);

  // The trigger surface (description + keyword triggers + `/command` entry points), from the
  // read-only projection route.
  //
  // RM-30 WP 7.3 — this is now READ-ONLY. It used to carry a chip editor plus a "Save as new
  // version" button, which was the last mutation left on the Inspector's Overview tab; the Inspector
  // is the read/analyze register (D-UX17) and every one of those concepts is now edited in the
  // Studio's settings panel, against one draft and one save. The editor is gone, not disabled: a
  // greyed-out control that never becomes usable is worse than none.
  const [triggers, setTriggers] = useState<TriggerSurface | null>(null);
  const [triggersError, setTriggersError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setTriggers(null);
    setTriggersError(null);
    getSkillTriggers(skillId, version.id)
      .then((surface: TriggerSurface) => {
        if (cancelled) return;
        setTriggers(surface);
      })
      .catch((error: unknown) => {
        if (!cancelled) setTriggersError(getErrorMessage(error, "Couldn’t load triggers"));
      });
    return () => {
      cancelled = true;
    };
  }, [skillId, version.id]);

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

  const security = useMemo(() => deriveSkillSecuritySurface(files, body ?? ""), [files, body]);
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
    // SPLIT VIEW with a real draggable splitter — the same `AdaptivePanelGroup` mechanism Scans and
    // the run console use, so the handle behaves the way it does elsewhere in the app and the
    // reader's chosen split persists (`autoSaveId`). The rendered SKILL.md is the PRIMARY content
    // and owns the left pane; every derived fact about the version (frontmatter, footprint,
    // triggers, servers, security) stacks in the right one, in that order. It replaces the previous
    // bento grid, which scattered five same-weight tiles above the document and buried the thing the
    // page is actually about.
    //
    // Each pane SCROLLS INDEPENDENTLY: the tab panel (`SkillInspector`'s `TabsContent`, `min-h-0
    // flex-1 overflow-y-auto`) is already a bounded flex child, so `h-full` gives the group a
    // definite height and each panel owns its own scroll inside it. Below the brand mobile
    // breakpoint `AdaptivePanelGroup` flips the split to vertical rather than leaving two slivers.
    <AdaptivePanelGroup autoSaveId={SPLIT_AUTOSAVE_ID} className="h-full min-h-0 items-stretch">
      <ResizablePanel defaultSize={50} minSize={25} className="flex min-h-0 min-w-0 flex-col">
        {/* O5 — the rendered SKILL.md. No "SKILL.md" caption above it: this is the Overview tab of a
            skill, the document IS the page, and a label naming the obvious cost a line of height on
            every skill. The file name still names itself in the Files tab, where it is a choice. */}
        <section
          aria-label="SKILL.md"
          className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden pr-3"
        >
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
            // prose-measure-allow: the reader sets this measure with the splitter (D-IC9's own
            // opt-out). A fixed `max-w-[NNch]` caps a prose column so it cannot run edge to edge in
            // a container nobody controls — but here the container IS the control: the pane is
            // draggable and its width persists, so the cap only ever meant "drag the handle, watch
            // nothing happen". The document fills its pane; narrowing it is one drag away.
            //
            // No surface of its own either (it used to sit on `bg-muted/40`): a tinted slab behind
            // the document made it read as an embedded widget rather than the page's own content,
            // and it is the page's own content. The vertical scroll lives here, so this pane scrolls
            // independently of the facts pane.
            //
            // `MD_TABLE_COMPONENTS` is not optional. Without it Streamdown renders a markdown table
            // as its OWN block — a dark strip of copy/download/fullscreen controls above a boxed
            // grid that matches nothing else on the page. Passing the app's shared map renders the
            // table as the app's `Table` with the app's toolbar, exactly as the shipped guide does.
            <div className={cn("min-h-0 min-w-0 flex-1 overflow-y-auto pr-1", SKILL_MD_PROSE)}>
              <MessageResponse components={MD_TABLE_COMPONENTS}>{renderedBody}</MessageResponse>
            </div>
          )}
        </section>
      </ResizablePanel>

      <ResizableHandle withHandle aria-label="Resize the SKILL.md and details panes" />

      {/* The facts pane: one card per derived fact, in the order an operator reads them — what the
          skill declares, what it costs, how it is reached, what it binds, what it exposes. The PANE
          scrolls, not the individual cards: a scrollbar inside every card was the nesting that made
          this page hard to read in the first place. Each card sizes to its own content. */}
      <ResizablePanel defaultSize={50} minSize={25} className="flex min-h-0 min-w-0 flex-col">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-4 overflow-y-auto pl-3 pr-1">
          <Card className="flex min-w-0 flex-col">
            <CardHeader className="flex-none flex-row items-center justify-between gap-2">
              <CardTitle>Frontmatter</CardTitle>
              <Badge variant={version.manifestValid ? "success" : "destructive"}>
                {version.manifestValid ? "valid" : "invalid"}
              </Badge>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <Descriptions columns={1} layout="horizontal">
                <DescriptionsItem label="Name">{manifest.name || "—"}</DescriptionsItem>
                <DescriptionsItem label="Description">
                  <span title={fullDescription || undefined}>{clampedDescription}</span>
                </DescriptionsItem>
                {manifest.license ? (
                  <DescriptionsItem label="License">{manifest.license}</DescriptionsItem>
                ) : null}
                {manifest.compatibility ? (
                  <DescriptionsItem label="Compatibility">
                    {manifest.compatibility}
                  </DescriptionsItem>
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
          </Card>

          <Card aria-label="Token footprint" className="flex min-w-0 flex-col">
            <CardHeader className="flex-none">
              <CardTitle>Token footprint</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
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
          </Card>

          <Card className="flex min-w-0 flex-col">
            <CardHeader className="flex-none">
              <CardTitle>Triggers</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-5">
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
                  {/* Keyword triggers — READ-ONLY (RM-30 WP 7.3). Editing lives in the Studio. */}
                  <section aria-label="Keyword triggers" className="flex flex-col gap-2">
                    <div className="flex items-center gap-1.5">
                      <Hash className="size-3.5 text-muted-foreground" aria-hidden />
                      <Text variant="meta" tone="muted">
                        Keyword triggers
                      </Text>
                    </div>
                    {triggers.keywords.length === 0 ? (
                      <Text variant="meta" tone="muted">
                        No keyword triggers — this skill is reached by a{" "}
                        <span className="font-mono">/command</span> or by name.
                      </Text>
                    ) : (
                      <ul className="flex flex-wrap gap-1">
                        {triggers.keywords.map((keyword) => (
                          <li key={keyword} className="min-w-0">
                            <Badge variant="secondary" className="max-w-full truncate">
                              {keyword}
                            </Badge>
                          </li>
                        ))}
                      </ul>
                    )}
                    <Text variant="meta" tone="muted">
                      Natural-language phrases that trigger this skill, from the frontmatter{" "}
                      <span className="font-mono">keywords</span> list. Edit them in the Studio,
                      where they save with the rest of the skill as one new version.
                    </Text>
                    <Button asChild variant="outline" size="sm" className="w-fit">
                      <Link to={`/skills/${skillId}/studio?rail=settings`}>
                        <Pencil aria-hidden />
                        <span>Edit in Studio</span>
                      </Link>
                    </Button>
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
          </Card>

          {/* Servers — READ-ONLY (RM-30 WP 7.3). The chips still report what the version binds and
              how each name resolved; binding is edited in the Studio's settings panel, on the one
              draft. */}
          <Card className="flex min-w-0 flex-col">
            <CardHeader className="flex-none">
              <CardTitle>Servers</CardTitle>
            </CardHeader>
            <CardContent>
              <SkillBindingsPanel
                skillId={skillId}
                versionId={version.id}
                isHeadVersion={isHeadVersion}
                skillMdText={body}
                blockedReason={null}
                readOnly
                editInStudioTo={`/skills/${skillId}/studio?rail=settings`}
                // Required by the panel's signature but unreachable in `readOnly` mode: this tab has
                // no save path at all any more, so a callback here would be dead wiring pretending
                // otherwise.
                onVersionSaved={() => {}}
              />
            </CardContent>
          </Card>

          <Card className="flex min-w-0 flex-col">
            <CardHeader className="flex-none">
              <CardTitle>Security surface</CardTitle>
            </CardHeader>
            <CardContent>
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
          </Card>
        </div>
      </ResizablePanel>
    </AdaptivePanelGroup>
  );
}
