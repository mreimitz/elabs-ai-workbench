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
  Pencil,
  ScrollText,
  Terminal,
} from "lucide-react";
import { SegmentedBar } from "../../components/TokenViz";
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
    <div className="flex flex-col gap-6">
      {/* Overview cards as a bento grid (2026-07-12): fixed-height tiles keep sizing uniform, and
          each tile's body scrolls (overflow-y-auto) so variable content never clips the fixed rows.

          NO `spotlight`, deliberately. The cursor-following glow used to be BentoGrid's default and
          arrived here for free; since v4 it is opt-in and the grid instead rests flat and lifts on
          hover. This is a dense operator surface (a skill's frontmatter, token footprint and
          security surface), so the flat resting state is the better read and the glow is not
          re-enabled. Add `spotlight` on the grid — or on a single BentoGridItem — to bring it back. */}
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
                    <span className="font-mono">keywords</span> list. Edit them in the Studio, where
                    they save with the rest of the skill as one new version.
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

        {/* Servers — READ-ONLY (RM-30 WP 7.3). The chips still report what the version binds and how
            each name resolved; binding is edited in the Studio's settings panel, on the one draft. */}
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
              readOnly
              editInStudioTo={`/skills/${skillId}/studio?rail=settings`}
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

    </div>
  );
}
