import { Badge, Text, Tooltip, TooltipContent, TooltipTrigger } from "@elabs-ai/components-ui";
import { CircleDashed, Server, Tags, X } from "lucide-react";
import { IconButton } from "../../../components/IconButton";
import { ServerTypeStatusBadge } from "../../servers/ServerTypeStatusBadge";
import type { BindingChip } from "./binding-display";

// ── One definition of the bound-server / bound-type chip ──────────────────────────────────────────
// These two components existed THREE times — in the Tools palette, in `SkillBindingsPanel`, and (as
// of RM-30 WP 7.3) they would have been written a fourth time for the Studio's settings panel.
// `binding-display.ts` already owned the chip MODEL; this file now owns its rendering, so a change to
// how a binding reads happens once. Nothing about the markup changed in the merge.

/** One bound-server chip: the declared frontmatter name, its resolved tool count (or an honest "no
 *  tools yet" marker), and — when binding is available — the unbind ×. */
export function ServerChip({
  name,
  toolCount,
  canUnbind,
  onUnbind,
}: {
  name: string;
  /** Resolved tool count from the bound-tools read; null ⇒ unscanned or not a registered name. */
  toolCount: number | null;
  canUnbind: boolean;
  onUnbind: () => void;
}) {
  return (
    <li className="min-w-0">
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex min-w-0">
            <Badge variant="outline" className="max-w-full gap-1 pe-0.5">
              <Server className="size-3 shrink-0 text-muted-foreground" aria-hidden />
              <Text as="span" variant="meta" className="min-w-0 truncate font-mono" title={name}>
                {name}
              </Text>
              {toolCount === null ? (
                <CircleDashed className="size-3 shrink-0 text-muted-foreground" aria-hidden />
              ) : (
                <Text as="span" variant="meta" tone="muted" className="shrink-0 tabular-nums">
                  {toolCount}
                </Text>
              )}
              {canUnbind ? (
                <IconButton
                  variant="ghost"
                  size="icon"
                  className="size-4 shrink-0"
                  label={`Unbind server ${name}`}
                  onClick={onUnbind}
                >
                  <X aria-hidden />
                </IconButton>
              ) : null}
            </Badge>
          </span>
        </TooltipTrigger>
        <TooltipContent>
          {toolCount === null
            ? "No tools yet — the server has no completed scan, or no registered server matches this name."
            : `${toolCount} ${toolCount === 1 ? "tool" : "tools"} from the latest completed scan.`}
        </TooltipContent>
      </Tooltip>
    </li>
  );
}

/** One TYPE-bound chip: the declared type name (Tags glyph), the type's lifecycle status, and the
 *  resolved representative member — or an honest "no representative yet" state when no member has a
 *  completed scan. The representative is chosen by the API resolver (D-ST3); this chip only reports it. */
export function TypeChip({
  chip,
  canUnbind,
  onUnbind,
}: {
  chip: Extract<BindingChip, { kind: "type" }>;
  canUnbind: boolean;
  onUnbind: () => void;
}) {
  const label = chip.typeName ?? chip.name;
  const hasRep = chip.representativeId !== null;
  return (
    <li className="min-w-0">
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex min-w-0">
            <Badge variant="outline" className="max-w-full gap-1 pe-0.5">
              <Tags className="size-3 shrink-0 text-muted-foreground" aria-hidden />
              <Text as="span" variant="meta" className="min-w-0 truncate font-mono" title={label}>
                {label}
              </Text>
              <Text as="span" variant="meta" tone="muted" className="shrink-0">
                Type
              </Text>
              {chip.status ? <ServerTypeStatusBadge status={chip.status} /> : null}
              {hasRep && chip.toolCount !== null ? (
                <Text as="span" variant="meta" tone="muted" className="shrink-0 tabular-nums">
                  {chip.toolCount}
                </Text>
              ) : (
                <CircleDashed className="size-3 shrink-0 text-muted-foreground" aria-hidden />
              )}
              {canUnbind ? (
                <IconButton
                  variant="ghost"
                  size="icon"
                  className="size-4 shrink-0"
                  label={`Unbind server type ${label}`}
                  onClick={onUnbind}
                >
                  <X aria-hidden />
                </IconButton>
              ) : null}
            </Badge>
          </span>
        </TooltipTrigger>
        <TooltipContent>
          {hasRep
            ? `Server type — resolves to representative “${
                chip.representativeName ?? "a scanned member"
              }” (the member with the newest successful scan).${
                chip.toolCount !== null
                  ? ` ${chip.toolCount} ${chip.toolCount === 1 ? "tool" : "tools"} from its latest completed scan.`
                  : ""
              }`
            : "Server type — no representative yet: no member has a completed scan. Tools appear once a member is scanned."}
        </TooltipContent>
      </Tooltip>
    </li>
  );
}
