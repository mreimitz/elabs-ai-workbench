import { useEffect, useMemo, useRef, useState } from "react";
import {
  PromptInputCommand,
  PromptInputCommandEmpty,
  PromptInputCommandGroup,
  PromptInputCommandItem,
  PromptInputCommandList,
} from "@elabs-ai/components-ai";
import {
  Badge,
  Button,
  cn,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Text,
} from "@elabs-ai/components-ui";
import type { PromptGetResult, ScanDetail, Skill } from "@mcp-token-footprint/shared";
import { BookOpen, MessageSquareText } from "lucide-react";
import { apiGet, apiPost, listServers, listSkills } from "../../lib/api";
import { getErrorMessage } from "../../lib/errors";

/**
 * Assistant Hub (WP2.5, §1.9 composer, R-MCP8 + R-SK3 "(slash)") — the slash-command catalog + its
 * floating list + the MCP-prompt argument dialog. `Composer.tsx` owns the open/highlight/keyboard state
 * (it already reads/writes the live textarea text via `usePromptInputController`); this module owns
 * WHAT the commands are and HOW they render/resolve.
 *
 * Two real, wired sources (both reuse EXISTING, already-shipped endpoints — no new API surface):
 *  - **Skills** — the Skills registry (`GET /api/skills`). Picking one inserts `/<slug> ` into the
 *    composer, ready for `args` (R-SK3's slash-invocation UX). The `$ARGUMENTS`-style RUNTIME
 *    substitution R-SK3 also describes needs the skill to be MATERIALIZED into the turn (WP0.5's
 *    tool registry / WP2.4's attachment mechanics — session-scoped skill attachment doesn't exist
 *    yet), so that part is a flagged gap, not silently faked here: this composer only provides the
 *    discoverable INSERTION affordance, matching `ConversationPane.tsx`'s `ElicitationPanel` precedent
 *    of building the honest affordance and flagging the transport gap in the module doc.
 *  - **MCP prompts** — every registered server's LATEST SCAN (`GET /api/servers/:id/latest-scan`,
 *    already used elsewhere, e.g. `EnvironmentsView.tsx`/`ToolRunnerSheet.tsx`) supplies the "scanned"
 *    half of R-MCP8's "scanned + live `prompts/list`" (no live re-probe here — a scan is the app's
 *    existing source of truth for a server's declared surface). Picking a no-arg prompt calls the
 *    EXISTING `POST /api/servers/:id/prompts/:name/get` (already used by `ResourcePromptRun.tsx`'s
 *    playground) and injects the resolved messages as the composer's text — R-MCP8's "result injected
 *    as user content", literally. A prompt with declared arguments opens {@link McpPromptArgsDialog}
 *    first (reusing `ResourcePromptRun.tsx`'s `parsePromptArgs`, the SAME string-arg parser the
 *    playground uses) and injects only after it resolves.
 *
 *  Deliberately does NOT import from `features/scans/ResourcePromptRun.tsx` even though it already
 *  exports an equivalent `parsePromptArgs` — that file also imports `@elabs-ai/components-editor` (Monaco/Milkdown)
 *  at module scope for its result viewer, and pulling that transitively into every hub test that
 *  renders the composer breaks under vitest/jsdom (`Unknown file extension ".css"` from Milkdown's
 *  prosemirror stylesheet — `@elabs-ai/components-editor` is only ever meant to load behind the `?worker` Vite
 *  prebundle wired in `main.tsx`, per `dependencies.md`). `parseMcpPromptArgs` below is a small,
 *  independent duplicate of the exact same ~15-line parse (both read the identical MCP
 *  `PromptArgument[]` wire shape), kept in sync by inspection rather than a shared import.
 *
 *  Deliberately NOT included in v1: crews/roles (no `/api/hub/agents` / `/api/hub/crews` library
 *  exists yet — that's WP2.1/2.2). Rather than ship dead disabled menu entries for a feature with no
 *  backing data at all, that category is simply absent until its WP lands.
 *
 *  Session MODE used to be in that same "omitted" bucket too — `hubSessionPatchSchema` only allowed
 *  title/model/autonomy, and `NewSessionDialog` owned mode selection once, at create, with no way to
 *  change it after. hub-fixes WP6.2 (RC7) made `mode` a real client-writable PATCH field, but it still
 *  isn't a SLASH command here: switching mode is a session-level toggle, not a text insertion, so it
 *  lives in the composer's own mode chip next to the model chip (`Composer.tsx`'s `SessionModeChip`),
 *  mirroring where the autonomy chip (`AutonomyModeSelect`) already lives — not in this catalog.
 */

// ── Catalog ──────────────────────────────────────────────────────────────────────────────────────────

export type SkillCommandItem = {
  kind: "skill";
  id: string;
  slug: string;
  label: string;
  hint?: string;
};

/** A single declared MCP prompt argument (all MCP prompt args are strings on the wire). Mirrors
 *  `features/scans/ResourcePromptRun.tsx`'s local `PromptArg` — see the module doc for why this is an
 *  independent copy rather than a shared import. */
export type McpPromptArg = { name: string; description?: string; required?: boolean };

/** Parse a prompt's declared `arguments` (typed `unknown` on the wire) into a string-arg list,
 *  required-first. */
export function parseMcpPromptArgs(raw: unknown): McpPromptArg[] {
  if (!Array.isArray(raw)) return [];
  const args: McpPromptArg[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const obj = entry as Record<string, unknown>;
    if (typeof obj.name !== "string" || obj.name.length === 0) continue;
    args.push({
      name: obj.name,
      description: typeof obj.description === "string" ? obj.description : undefined,
      required: obj.required === true,
    });
  }
  return [...args.filter((a) => a.required), ...args.filter((a) => !a.required)];
}

export type McpPromptCommandItem = {
  kind: "prompt";
  id: string;
  serverId: string;
  serverName: string;
  promptName: string;
  label: string;
  hint?: string;
  args: McpPromptArg[];
};

export type ComposerCommandItem = SkillCommandItem | McpPromptCommandItem;

/** `/mcp__<server>__<prompt>` per R-MCP8's literal format — the server half is slugified so spaces/
 *  punctuation in a display name never break the slash token. */
export function slugifyServerName(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug.length > 0 ? slug : "server";
}

/** MCP prompt `messages` (typed `unknown` on the wire — an ordered list of `{role, content}`) reduced
 *  to plain text: every `type: "text"` content block, in order, joined by blank lines. Non-text content
 *  (images, embedded resources) is skipped rather than guessed at — this only ever injects text into a
 *  text composer. */
export function extractPromptMessageText(messages: unknown): string {
  if (!Array.isArray(messages)) return "";
  const parts: string[] = [];
  for (const message of messages) {
    if (!message || typeof message !== "object") continue;
    const content = (message as Record<string, unknown>).content;
    const blocks = Array.isArray(content) ? content : [content];
    for (const block of blocks) {
      if (!block || typeof block !== "object") continue;
      const record = block as Record<string, unknown>;
      if (record.type === "text" && typeof record.text === "string") parts.push(record.text);
    }
  }
  return parts.join("\n\n");
}

function buildSkillCommands(skills: Skill[]): SkillCommandItem[] {
  return skills
    .slice()
    .sort((a, b) => a.slug.localeCompare(b.slug))
    .map((skill) => ({
      kind: "skill" as const,
      id: `skill:${skill.id}`,
      slug: skill.slug,
      label: `/${skill.slug}`,
      ...(skill.description ? { hint: skill.description } : {}),
    }));
}

function buildPromptCommands(serverId: string, serverName: string, scan: ScanDetail): McpPromptCommandItem[] {
  const serverSlug = slugifyServerName(serverName);
  return scan.prompts.map((prompt) => ({
    kind: "prompt" as const,
    id: `prompt:${serverId}:${prompt.promptName}`,
    serverId,
    serverName,
    promptName: prompt.promptName,
    label: `/mcp__${serverSlug}__${prompt.promptName}`,
    ...(prompt.description ? { hint: prompt.description } : {}),
    args: parseMcpPromptArgs(prompt.arguments),
  }));
}

/**
 * Lazily loads the command catalog the FIRST time `enabled` goes true (the popover's first open), then
 * caches it for the component's lifetime — a fresh `/` keystroke never re-fans-out N scan fetches.
 * Every source degrades to "absent" on its own failure (a broken server's scan fetch never blanks the
 * whole menu) rather than surfacing a toast — this is a passive catalog load, not a user action.
 */
export function useComposerCommandCatalog(enabled: boolean): {
  items: ComposerCommandItem[];
  loading: boolean;
} {
  const [items, setItems] = useState<ComposerCommandItem[]>([]);
  const [loading, setLoading] = useState(false);
  const loadedRef = useRef(false);

  useEffect(() => {
    if (!enabled || loadedRef.current) return;
    loadedRef.current = true;
    let cancelled = false;
    setLoading(true);

    void (async () => {
      const [skills, servers] = await Promise.all([
        listSkills().catch(() => []),
        listServers().catch(() => []),
      ]);
      const scans = await Promise.all(
        servers.map((server) =>
          apiGet<ScanDetail>(`/api/servers/${server.id}/latest-scan`)
            .then((scan) => ({ server, scan }))
            .catch(() => null),
        ),
      );
      if (cancelled) return;
      const promptItems = scans
        .filter((entry): entry is { server: (typeof servers)[number]; scan: ScanDetail } => entry !== null)
        .flatMap((entry) => buildPromptCommands(entry.server.id, entry.server.name, entry.scan));
      setItems([...buildSkillCommands(skills), ...promptItems]);
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [enabled]);

  return { items, loading };
}

/** Case-insensitive substring match over the command's label/hint — pure so it's independently
 *  unit-testable and so `Composer.tsx` can derive the SAME filtered list its keyboard nav counts over. */
export function filterComposerCommands(items: ComposerCommandItem[], query: string): ComposerCommandItem[] {
  const q = query.trim().toLowerCase();
  if (q.length === 0) return items;
  return items.filter((item) => {
    const haystack =
      item.kind === "skill"
        ? `${item.slug} ${item.hint ?? ""}`
        : `${item.promptName} ${item.serverName} ${item.hint ?? ""}`;
    return haystack.toLowerCase().includes(q);
  });
}

// ── Floating list ────────────────────────────────────────────────────────────────────────────────────

function CommandRow({
  item,
  active,
  onHighlight,
  onSelect,
}: {
  item: ComposerCommandItem;
  active: boolean;
  onHighlight: () => void;
  onSelect: (item: ComposerCommandItem) => void;
}) {
  return (
    <PromptInputCommandItem
      value={item.id}
      data-active={active ? "true" : "false"}
      className={cn("flex flex-col items-start gap-0.5 py-2", active && "bg-accent text-accent-foreground")}
      onMouseEnter={onHighlight}
      onSelect={() => onSelect(item)}
    >
      <span className="flex items-center gap-1.5 font-mono text-caption">
        {item.kind === "skill" ? (
          <BookOpen aria-hidden className="size-3 shrink-0" />
        ) : (
          <MessageSquareText aria-hidden className="size-3 shrink-0" />
        )}
        {item.label}
      </span>
      {item.hint ? (
        <span className="line-clamp-1 ps-4.5 text-caption text-muted-foreground">{item.hint}</span>
      ) : null}
    </PromptInputCommandItem>
  );
}

/** The floating command panel — a plain absolutely-positioned block (NOT a `Popover`/portal) anchored
 *  by the caller's own `relative` wrapper, so it needs no measurement/positioning logic of its own and
 *  stays trivially testable (plain DOM, no portal). Keyboard nav (Arrow/Enter/Escape) is driven by the
 *  CALLER (`Composer.tsx`'s textarea `onKeyDown`) so the user never loses focus out of the main input —
 *  this list is pure presentation over `highlightedIndex`. */
export function ComposerCommandList({
  query,
  items,
  loading,
  highlightedIndex,
  onHighlight,
  onSelect,
}: {
  query: string;
  items: ComposerCommandItem[];
  loading: boolean;
  highlightedIndex: number;
  onHighlight: (index: number) => void;
  onSelect: (item: ComposerCommandItem) => void;
}) {
  const skillItems = useMemo(() => items.filter((i): i is SkillCommandItem => i.kind === "skill"), [items]);
  const promptItems = useMemo(
    () => items.filter((i): i is McpPromptCommandItem => i.kind === "prompt"),
    [items],
  );

  return (
    // Not a manually-authored ARIA widget: `PromptInputCommand`/`*List`/`*Item` are cmdk primitives
    // (via `@elabs-ai/components-ai`) that already own the correct listbox/option roles + aria-selected internally —
    // this wrapper is pure positioning, so it stays a plain `<div>` rather than a second, conflicting
    // set of roles layered on top.
    <div
      data-testid="composer-commands"
      className="absolute inset-x-0 bottom-full z-20 mb-1 max-h-64 overflow-hidden rounded-lg border border-border bg-popover text-popover-foreground shadow-md"
    >
      <PromptInputCommand shouldFilter={false} loop>
        <PromptInputCommandList className="max-h-64">
          {items.length === 0 ? (
            <PromptInputCommandEmpty>
              {loading
                ? "Loading commands…"
                : query
                  ? "No matching commands."
                  : "No skills or MCP prompts registered yet."}
            </PromptInputCommandEmpty>
          ) : null}
          {skillItems.length > 0 ? (
            <PromptInputCommandGroup heading="Skills">
              {skillItems.map((item) => (
                <CommandRow
                  key={item.id}
                  item={item}
                  active={items.indexOf(item) === highlightedIndex}
                  onHighlight={() => onHighlight(items.indexOf(item))}
                  onSelect={onSelect}
                />
              ))}
            </PromptInputCommandGroup>
          ) : null}
          {promptItems.length > 0 ? (
            <PromptInputCommandGroup heading="MCP prompts">
              {promptItems.map((item) => (
                <CommandRow
                  key={item.id}
                  item={item}
                  active={items.indexOf(item) === highlightedIndex}
                  onHighlight={() => onHighlight(items.indexOf(item))}
                  onSelect={onSelect}
                />
              ))}
            </PromptInputCommandGroup>
          ) : null}
        </PromptInputCommandList>
      </PromptInputCommand>
    </div>
  );
}

// ── MCP prompt argument dialog ──────────────────────────────────────────────────────────────────────

/** Runs `prompts/get` for one MCP prompt (the EXISTING `POST /api/servers/:id/prompts/:name/get`) and
 *  returns the resolved text — shared by the no-arg fast path and this dialog's submit. */
export async function resolvePromptText(
  item: McpPromptCommandItem,
  args: Record<string, string>,
): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  try {
    const result = await apiPost<PromptGetResult>(
      `/api/servers/${item.serverId}/prompts/${encodeURIComponent(item.promptName)}/get`,
      { arguments: args },
    );
    if (result.isError) {
      return { ok: false, error: result.errorMessage ?? "The server reported an error getting the prompt." };
    }
    const text = extractPromptMessageText(result.messages) || result.description || "";
    return { ok: true, text };
  } catch (error) {
    return { ok: false, error: getErrorMessage(error) };
  }
}

/** Argument-collecting form for an MCP prompt with declared `arguments` (R-MCP8's "argument form from
 *  the prompt definition") — the same string-only shape `ResourcePromptRun.tsx`'s `PromptGetDialog` uses,
 *  required-first validation, focus-first-error on submit. */
export function McpPromptArgsDialog({
  item,
  open,
  onOpenChange,
  onResolved,
}: {
  item: McpPromptCommandItem | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called with the FULLY RESOLVED text once `prompts/get` succeeds; the dialog closes itself first. */
  onResolved: (text: string) => void;
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setValues({});
    setErrors({});
    setBusy(false);
  }, [item?.id]);

  if (!item) return null;

  const setValue = (name: string, value: string) => {
    setValues((current) => ({ ...current, [name]: value }));
    setErrors((current) => (current[name] ? { ...current, [name]: "" } : current));
  };

  async function submit() {
    if (!item) return;
    const nextErrors: Record<string, string> = {};
    for (const arg of item.args) {
      if (arg.required && !values[arg.name]) nextErrors[arg.name] = "This field is required.";
    }
    setErrors(nextErrors);
    const firstInvalid = item.args.find((arg) => nextErrors[arg.name]);
    if (firstInvalid) {
      document.getElementById(`composer-prompt-arg-${firstInvalid.name}`)?.focus();
      return;
    }
    setBusy(true);
    const resolved = await resolvePromptText(item, values);
    setBusy(false);
    if (!resolved.ok) {
      setErrors({ _root: resolved.error });
      return;
    }
    onOpenChange(false);
    onResolved(resolved.text);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle className="font-mono">{item.label}</DialogTitle>
          <DialogDescription>
            Fill in the prompt&rsquo;s arguments — the resolved text is inserted into your message.
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          {item.args.map((arg) => {
            const fieldId = `composer-prompt-arg-${arg.name}`;
            const errorId = errors[arg.name] ? `${fieldId}-error` : undefined;
            return (
              <div key={arg.name} className="flex min-w-0 flex-col gap-1.5">
                <Label htmlFor={fieldId} className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-caption">{arg.name}</span>
                  {arg.required ? <Badge variant="secondary">required</Badge> : null}
                </Label>
                <Input
                  id={fieldId}
                  spellCheck={false}
                  aria-describedby={errorId}
                  value={values[arg.name] ?? ""}
                  onChange={(event) => setValue(arg.name, event.target.value)}
                />
                {errors[arg.name] ? (
                  <Text id={errorId} role="alert" className="text-caption text-destructive-text">
                    {errors[arg.name]}
                  </Text>
                ) : arg.description ? (
                  <Text tone="muted" className="line-clamp-2 text-caption">
                    {arg.description}
                  </Text>
                ) : null}
              </div>
            );
          })}
          {errors._root ? (
            <Text role="alert" className="text-caption text-destructive-text">
              {errors._root}
            </Text>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? "Getting prompt…" : "Insert"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
