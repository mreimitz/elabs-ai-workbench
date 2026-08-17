import {
  forwardRef,
  useCallback,
  useEffect,
  useId,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import type { HubAgentRole } from "@mcp-token-footprint/shared";
import { cn } from "@elabs-ai/components-ui";
import {
  PromptInputCommand,
  PromptInputCommandEmpty,
  PromptInputCommandGroup,
  PromptInputCommandItem,
  PromptInputCommandList,
} from "@elabs-ai/components-ai";
import { AtSign } from "lucide-react";
import { listHubAgentRoles } from "../../lib/api";
import { getErrorMessage } from "../../lib/errors";

// Assistant Hub (end-user UX pass) — the `@AgentName` mention composer input. OWNER-APPROVED exception to
// the brand-ui-only rule: the design system has no mention-capable rich input (its `PromptInput` is a
// plain `<textarea>`, which can't hold inline chips), so the editable surface is a bespoke
// `contenteditable`. Every VISIBLE part is still `@elabs-ai/components-*` + semantic tokens — the popup is the
// `PromptInputCommand*` cmdk family (mirroring `ComposerCommands.tsx`), the chip is a Badge-styled span.
// The contenteditable DOM is managed IMPERATIVELY (React renders it empty once and never re-renders its
// children); all content mutations are manual DOM ops so React never clobbers the caret/chips.

/** The chip label used inside the text a mention serializes to (e.g. `@Analyst`). */
export function mentionText(agent: Pick<HubAgentRole, "displayName" | "name">): string {
  return `@${agent.displayName ?? agent.name}`;
}

/**
 * PURE — detect a live `@query` at the caret. Given the text of the caret's text node up to the caret,
 * returns the query (chars after `@`) + the `@`'s index within that text, or null. Only fires when the
 * `@` is at the start or right after whitespace (so an email/`a@b` never triggers), and the query has no
 * whitespace/`@` (a space ends the mention). Exported for unit tests.
 */
export function detectMentionQuery(
  textBeforeCaret: string,
): { query: string; atIndex: number } | null {
  const match = /(^|\s)@([^\s@]*)$/.exec(textBeforeCaret);
  if (!match) return null;
  const query = match[2] ?? "";
  return { query, atIndex: textBeforeCaret.length - query.length - 1 };
}

/**
 * Combobox wiring (a11y — the `@` popup contract): reads the REAL DOM `id` of the currently-
 * highlighted popup option, POSITIONALLY (the Nth `[role="option"]` inside the popup container
 * matches `filtered[index]`, since options render in that same order every time). Real `@elabs-ai/components-ai`
 * (cmdk under the hood) generates its own opaque per-item `id` via `useId()`, and its `CommandItem`
 * spreads incoming props BEFORE its own hardcoded `id`/`role`/`aria-selected` (see the vendored cmdk
 * source, `cmdk/dist/index.mjs`, the `he` item factory) — so those three attributes can't be forced
 * from the outside, only read back off the committed DOM once it renders. Querying by `role="option"`
 * (rather than a cmdk-specific `[cmdk-item]` attribute) means this ALSO resolves correctly against
 * this file's own test-support mock (`PromptInputCommandItem` there is a passthrough `<button>`, so
 * the explicit `role`/`id` props this component sets on each item DO stick there) — the wiring is
 * exercised by a real test without touching the shared `@elabs-ai/components-ai` mock. Returns `undefined` (never a
 * dangling id) when there's no container, no options yet, or the index is out of range.
 */
export function resolveActiveOptionId(
  container: HTMLElement | null,
  index: number,
): string | undefined {
  if (!container || index < 0) return undefined;
  const options = container.querySelectorAll<HTMLElement>('[role="option"]');
  return options[index]?.id || undefined;
}

/**
 * PURE-ish (walks a real DOM subtree) — serialize the editor's content into the outgoing message: text
 * with each chip rendered inline as `@Name`, plus the deduped agent ids in document order. Exported for
 * unit tests (build a DOM subtree by hand and assert). A `<br>` becomes a newline.
 */
export function serializeMentionEditor(root: HTMLElement): {
  text: string;
  mentionedAgentIds: string[];
} {
  let text = "";
  const ids: string[] = [];
  const seen = new Set<string>();
  const walk = (node: Node): void => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === Node.TEXT_NODE) {
        text += child.textContent ?? "";
        continue;
      }
      if (child.nodeType !== Node.ELEMENT_NODE) continue;
      const el = child as HTMLElement;
      if (el.dataset.mentionChip === "true") {
        const id = el.dataset.agentId ?? "";
        const name = el.dataset.agentName ?? "";
        text += `@${name}`;
        if (id && !seen.has(id)) {
          seen.add(id);
          ids.push(id);
        }
        continue;
      }
      if (el.tagName === "BR") {
        text += "\n";
        continue;
      }
      // A browser-inserted block wrapper (paste / Shift+Enter → <div>/<p>) is a line boundary — emit a
      // newline before its content so multi-paragraph text keeps its structure.
      if ((el.tagName === "DIV" || el.tagName === "P") && text.length > 0 && !text.endsWith("\n")) {
        text += "\n";
      }
      walk(el); // recurse into the wrapper's text/chips
    }
  };
  walk(root);
  return { text, mentionedAgentIds: ids };
}

/** The label shown on a popup row + chip. */
const agentLabel = (agent: HubAgentRole): string => agent.displayName ?? agent.name;

/** Build a non-editable inline chip DOM node styled like a `@elabs-ai/components-ui` Badge (secondary variant), so a
 *  mention renders inline in the contenteditable. Token classes only (no raw colors). */
function createChipElement(agent: HubAgentRole): HTMLSpanElement {
  const chip = document.createElement("span");
  chip.contentEditable = "false";
  chip.dataset.mentionChip = "true";
  chip.dataset.agentId = agent.id;
  chip.dataset.agentName = agentLabel(agent);
  chip.className =
    "mx-0.5 inline-flex items-center gap-0.5 rounded bg-secondary px-1 py-px align-baseline font-medium text-secondary-foreground select-none";
  chip.textContent = mentionText(agent);
  return chip;
}

export type MentionEditorHandle = {
  serialize: () => { text: string; mentionedAgentIds: string[] };
  /** External REPLACE (a slash-command insert) — replaces content with plain text; any chips are dropped
   *  (slash is start-anchored on an ~empty input, so this only happens with no chips). */
  setPlainText: (text: string) => void;
  /** External APPEND (a voice transcript) — appends plain text at the end WITHOUT touching existing
   *  content, so mention chips (and their ids) are PRESERVED. */
  appendText: (text: string) => void;
  clear: () => void;
  focus: () => void;
  isEmpty: () => boolean;
};

export type MentionEditorProps = {
  /** Called on every user edit with the serialized plain text (for the parent's slash-command detection). */
  onChange: (serializedText: string) => void;
  /** Enter with no popup open — send. */
  onSubmit: () => void;
  /** The parent's slash-command popup is open — while it is, Arrow/Enter/Escape are delegated to the
   *  parent (`onSlashKeyDown`) so the existing `/` flow keeps working. */
  slashOpen?: boolean;
  onSlashKeyDown?: (event: React.KeyboardEvent) => void;
  placeholder?: string;
  disabled?: boolean;
  /** Test seam — inject the agent roster instead of fetching it (the real component self-fetches). */
  agentsForTest?: HubAgentRole[];
};

export const MentionEditor = forwardRef<MentionEditorHandle, MentionEditorProps>(
  function MentionEditor(
    { onChange, onSubmit, slashOpen, onSlashKeyDown, placeholder, disabled, agentsForTest },
    ref,
  ) {
    const editorRef = useRef<HTMLDivElement | null>(null);
    const [agents, setAgents] = useState<HubAgentRole[]>(agentsForTest ?? []);
    const [loaded, setLoaded] = useState(agentsForTest !== undefined);
    const [loading, setLoading] = useState(false);
    const [empty, setEmpty] = useState(true);
    // Mention popup state.
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState("");
    const [highlighted, setHighlighted] = useState(0);
    // The popup is PORTALED to <body> (fixed-positioned above the editor) so it escapes the composer's
    // `overflow-hidden` InputGroup — otherwise it renders inside that clip and is invisible. `anchorRect`
    // is the editor's viewport box; the popup pins its BOTTOM just above the editor top and grows upward.
    const [anchorRect, setAnchorRect] = useState<{
      left: number;
      bottom: number;
      width: number;
    } | null>(null);
    // The caret text node + span [atIndex, endOffset] to replace when a mention is picked (captured on each
    // detection so a click-select — which would move focus — still knows what to replace).
    const rangeRef = useRef<{ node: Node; atIndex: number; endOffset: number } | null>(null);

    // Combobox contract (a11y): a stable id for the popup container (`aria-controls` on the textbox
    // below points at it) plus the currently-highlighted option's REAL DOM id (`aria-activedescendant`
    // — see `resolveActiveOptionId`'s doc for why that has to be read back off the DOM rather than
    // predicted). `popupRef` is the portaled popup's own root, so the query walks only ITS options.
    const listboxId = useId();
    const popupRef = useRef<HTMLDivElement | null>(null);
    const [activeOptionId, setActiveOptionId] = useState<string | undefined>(undefined);

    const filtered = useMemo(() => {
      const needle = query.trim().toLowerCase();
      return agents.filter((a) =>
        `${a.displayName ?? ""} ${a.name}`.toLowerCase().includes(needle),
      );
    }, [agents, query]);

    useEffect(() => {
      setHighlighted(0);
    }, [query, filtered.length]);

    // Keep `aria-activedescendant` (set on the textbox below) pointed at the REAL currently-
    // highlighted option — recomputed after every commit that could move the highlight or change
    // which options exist (open/close, arrow nav, filtered list). `useLayoutEffect` so it lands
    // before paint, matching the highlight's own visual change instead of trailing it a frame.
    // `anchorRect` is in the deps too: the popup only actually MOUNTS once it's measured (`open &&
    // anchorRect` below) — on the render where `open` first flips true, `anchorRect` is still `null`
    // (the measuring effect hasn't run yet), so `popupRef.current` is null; the measuring effect then
    // sets `anchorRect` and this must re-run on THAT render, not just on `open`/`highlighted`/`filtered`.
    useLayoutEffect(() => {
      if (!open || !anchorRect || filtered.length === 0) {
        setActiveOptionId(undefined);
        return;
      }
      setActiveOptionId(resolveActiveOptionId(popupRef.current, highlighted));
    }, [open, anchorRect, highlighted, filtered]);

    // Measure the editor to position the portaled popup; keep it in sync while open (scroll/resize).
    useEffect(() => {
      if (!open) {
        setAnchorRect(null);
        return;
      }
      const measure = () => {
        const root = editorRef.current;
        if (!root) return;
        const rect = root.getBoundingClientRect();
        setAnchorRect({
          left: rect.left,
          bottom: window.innerHeight - rect.top + 6,
          width: rect.width,
        });
      };
      measure();
      window.addEventListener("scroll", measure, true);
      window.addEventListener("resize", measure);
      return () => {
        window.removeEventListener("scroll", measure, true);
        window.removeEventListener("resize", measure);
      };
    }, [open]);

    // Lazy-load the roster on the first `@` (mirrors `useComposerCommandCatalog`). NOTE: `loading` must NOT
    // be in the deps — the effect sets it, which would re-run + cancel its own in-flight fetch (leaving the
    // popup stuck on "Loading agents…"). A ref makes the fetch fire exactly once regardless of re-opens.
    const rosterRequestedRef = useRef(false);
    useEffect(() => {
      if (!open || loaded || rosterRequestedRef.current) return;
      rosterRequestedRef.current = true;
      let cancelled = false;
      setLoading(true);
      (async () => {
        try {
          const list = await listHubAgentRoles();
          if (!cancelled) {
            setAgents(list);
            setLoaded(true);
          }
        } catch {
          // A roster fetch failure just yields an empty popup — never blocks typing.
          if (!cancelled) setLoaded(true);
        } finally {
          if (!cancelled) setLoading(false);
        }
      })();
      return () => {
        cancelled = true;
      };
    }, [open, loaded]);

    const syncEmpty = useCallback(() => {
      const root = editorRef.current;
      setEmpty(
        !root ||
          ((root.textContent ?? "").trim().length === 0 &&
            root.querySelector("[data-mention-chip]") === null),
      );
    }, []);

    const emitChange = useCallback(() => {
      const root = editorRef.current;
      onChange(root ? serializeMentionEditor(root).text : "");
      syncEmpty();
    }, [onChange, syncEmpty]);

    const closePopup = useCallback(() => {
      setOpen(false);
      setQuery("");
      rangeRef.current = null;
    }, []);

    // Detect an `@query` at the caret and (re)position the popup, or close it.
    const refreshMention = useCallback(() => {
      const root = editorRef.current;
      const selection = window.getSelection();
      if (!root || !selection || selection.rangeCount === 0 || !selection.isCollapsed) {
        closePopup();
        return;
      }
      const node = selection.focusNode;
      if (!node || node.nodeType !== Node.TEXT_NODE || !root.contains(node)) {
        closePopup();
        return;
      }
      const textBeforeCaret = (node.textContent ?? "").slice(0, selection.focusOffset);
      const hit = detectMentionQuery(textBeforeCaret);
      if (!hit) {
        closePopup();
        return;
      }
      rangeRef.current = { node, atIndex: hit.atIndex, endOffset: selection.focusOffset };
      setQuery(hit.query);
      setOpen(true);
    }, [closePopup]);

    const selectAgent = useCallback(
      (agent: HubAgentRole) => {
        const root = editorRef.current;
        const stored = rangeRef.current;
        if (!root || !stored) return;
        const range = document.createRange();
        try {
          range.setStart(stored.node, stored.atIndex);
          range.setEnd(stored.node, stored.endOffset);
        } catch {
          closePopup();
          return;
        }
        range.deleteContents();
        const chip = createChipElement(agent);
        range.insertNode(chip);
        const space = document.createTextNode(" ");
        chip.after(space);
        // Caret after the trailing space (cosmetic — guarded so a jsdom Selection quirk can't break insert).
        try {
          const selection = window.getSelection();
          if (selection) {
            const caret = document.createRange();
            caret.setStartAfter(space);
            caret.collapse(true);
            selection.removeAllRanges();
            selection.addRange(caret);
          }
        } catch {
          /* selection APIs are best-effort (jsdom) */
        }
        closePopup();
        root.focus();
        emitChange();
      },
      [closePopup, emitChange],
    );

    const removeChipBeforeCaret = useCallback((): boolean => {
      const root = editorRef.current;
      const selection = window.getSelection();
      if (!root || !selection || selection.rangeCount === 0 || !selection.isCollapsed) return false;
      const { focusNode, focusOffset } = selection;
      if (!focusNode) return false;
      let target: ChildNode | null = null;
      if (focusNode.nodeType === Node.TEXT_NODE && focusOffset === 0) {
        target = focusNode.previousSibling;
      } else if (focusNode === root) {
        target = root.childNodes[focusOffset - 1] ?? null;
      } else if (focusNode.nodeType === Node.ELEMENT_NODE) {
        const el = focusNode as HTMLElement;
        if (el.dataset.mentionChip === "true") target = el;
      }
      if (
        target &&
        target.nodeType === Node.ELEMENT_NODE &&
        (target as HTMLElement).dataset.mentionChip === "true"
      ) {
        target.remove();
        emitChange();
        return true;
      }
      return false;
    }, [emitChange]);

    const handleKeyDown = useCallback(
      (event: React.KeyboardEvent) => {
        if (event.key === "Backspace" && removeChipBeforeCaret()) {
          event.preventDefault();
          return;
        }
        // The `@` popup only CONSUMES a key when it can act on it. Escape always closes it. Arrow/Enter/Tab
        // are consumed ONLY when there are matches — so an unmatched `@token` (0 matches) does NOT swallow
        // Enter/Tab, and the key falls through to a normal send (or slash / newline).
        if (open && filtered.length > 0) {
          if (event.key === "Escape") {
            event.preventDefault();
            closePopup();
            return;
          }
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setHighlighted((i) => (i + 1) % filtered.length);
            return;
          }
          if (event.key === "ArrowUp") {
            event.preventDefault();
            setHighlighted((i) => (i - 1 + filtered.length) % filtered.length);
            return;
          }
          if ((event.key === "Enter" || event.key === "Tab") && !event.shiftKey) {
            event.preventDefault();
            const agent = filtered[highlighted] ?? filtered[0];
            if (agent) selectAgent(agent);
            return;
          }
        } else if (open && event.key === "Escape") {
          // 0 matches: Escape still dismisses the (empty) popup.
          event.preventDefault();
          closePopup();
          return;
        }
        if (slashOpen) {
          onSlashKeyDown?.(event);
          // If the slash handler consumed the key (e.g. select/nav/escape) it called preventDefault. If it
          // did NOT (no matching command), fall through so Enter still SENDS instead of inserting a newline.
          if (event.defaultPrevented) return;
        }
        if (event.key === "Enter" && !event.shiftKey) {
          event.preventDefault();
          onSubmit();
        }
      },
      [
        open,
        filtered,
        highlighted,
        slashOpen,
        onSlashKeyDown,
        onSubmit,
        removeChipBeforeCaret,
        selectAgent,
        closePopup,
      ],
    );

    useImperativeHandle(
      ref,
      () => ({
        serialize: () =>
          editorRef.current
            ? serializeMentionEditor(editorRef.current)
            : { text: "", mentionedAgentIds: [] },
        setPlainText: (value: string) => {
          const root = editorRef.current;
          if (!root) return;
          root.textContent = value;
          // Caret at end (cosmetic — guarded for jsdom).
          try {
            const selection = window.getSelection();
            if (selection && value.length > 0) {
              const range = document.createRange();
              range.selectNodeContents(root);
              range.collapse(false);
              selection.removeAllRanges();
              selection.addRange(range);
            }
          } catch {
            /* selection APIs are best-effort (jsdom) */
          }
          closePopup();
          emitChange();
        },
        appendText: (value: string) => {
          const root = editorRef.current;
          if (!root || value.length === 0) return;
          const current = root.textContent ?? "";
          const prefix = current.length > 0 && !/\s$/.test(current) ? " " : "";
          // Append a text node — existing chip spans (and their ids) are untouched.
          root.appendChild(document.createTextNode(prefix + value));
          try {
            const selection = window.getSelection();
            const range = document.createRange();
            range.selectNodeContents(root);
            range.collapse(false);
            selection?.removeAllRanges();
            selection?.addRange(range);
          } catch {
            /* selection APIs are best-effort (jsdom) */
          }
          closePopup();
          emitChange();
        },
        clear: () => {
          const root = editorRef.current;
          if (root) root.textContent = "";
          closePopup();
          emitChange();
        },
        focus: () => editorRef.current?.focus(),
        isEmpty: () => {
          const root = editorRef.current;
          return (
            !root ||
            ((root.textContent ?? "").trim().length === 0 &&
              root.querySelector("[data-mention-chip]") === null)
          );
        },
      }),
      [closePopup, emitChange],
    );

    return (
      // `w-full` so the editor takes its own row inside the InputGroup — the block-end footer addon
      // (`w-full order-last`) then wraps beneath it instead of being crowded onto the same line.
      <div className="relative w-full">
        {/* brand-ui-allow: owner-approved inline-mention input — the design system has no mention-capable
          rich editor (its PromptInput is a plain textarea, which cannot hold inline chips). */}
        <div
          ref={editorRef}
          // Full combobox contract (a11y — the `/`/`@` popup wiring): the editor is the combobox
          // input; `aria-expanded` covers EITHER popup this same field drives (the `@` mention list
          // rendered below, or the parent's `/` command list via `slashOpen`), while `aria-controls`/
          // `aria-activedescendant` can only reach the popup THIS component owns (the mention list —
          // the slash list's DOM lives in the parent's `ComposerCommands.tsx`, so it can't be wired
          // from here without that file also passing its own listbox/option ids down).
          role="combobox"
          aria-multiline="true"
          aria-label="Message"
          aria-autocomplete="list"
          aria-haspopup="listbox"
          aria-expanded={open || !!slashOpen}
          aria-controls={open ? listboxId : undefined}
          aria-activedescendant={open ? activeOptionId : undefined}
          // The InputGroup lights its focus ring off `[data-slot=input-group-control]:focus-visible`.
          data-slot="input-group-control"
          tabIndex={disabled ? -1 : 0}
          contentEditable={!disabled}
          suppressContentEditableWarning
          data-testid="mention-editor"
          spellCheck
          onInput={() => {
            emitChange();
            refreshMention();
          }}
          onKeyUp={(event) => {
            // Arrow/Home/End move the caret without an input event — re-detect so the popup tracks the caret.
            if (event.key.startsWith("Arrow") || event.key === "Home" || event.key === "End") {
              refreshMention();
            }
          }}
          onKeyDown={handleKeyDown}
          onBlur={closePopup}
          className={cn(
            // ui-wave U4 (owner feedback): px-4 pt-3 — the editor now sits directly on the composer's
            // single surface (no inner grey box), so its own padding IS the surface's text inset.
            "max-h-48 min-h-[2.5rem] w-full overflow-y-auto whitespace-pre-wrap break-words px-4 pb-2 pt-3 text-body outline-none",
            "focus-visible:outline-none",
            disabled && "pointer-events-none opacity-60",
          )}
        />
        {empty ? (
          <span
            aria-hidden
            // Mirrors the editor's px-4 pt-3 inset above so the placeholder sits exactly where typed
            // text will start. ui-wave U4 (owner feedback).
            className="pointer-events-none absolute left-4 top-3 text-body text-muted-foreground"
          >
            {placeholder}
          </span>
        ) : null}

        {open && anchorRect
          ? createPortal(
              <div
                ref={popupRef}
                id={listboxId}
                data-testid="mention-popup"
                style={{
                  position: "fixed",
                  left: anchorRect.left,
                  bottom: anchorRect.bottom,
                  width: anchorRect.width,
                }}
                className="z-50 max-h-64 overflow-hidden rounded-lg border border-border bg-popover text-popover-foreground shadow-md"
              >
                <PromptInputCommand shouldFilter={false} loop>
                  <PromptInputCommandList className="max-h-64">
                    {filtered.length === 0 ? (
                      <PromptInputCommandEmpty>
                        {loading
                          ? "Loading agents…"
                          : query
                            ? "No matching agents."
                            : "No saved agents yet — create one in Agents & Crews."}
                      </PromptInputCommandEmpty>
                    ) : null}
                    {filtered.length > 0 ? (
                      <PromptInputCommandGroup heading="Agents">
                        {filtered.map((agent, index) => (
                          <PromptInputCommandItem
                            key={agent.id}
                            value={agent.id}
                            // Real cmdk overrides `id`/`role`/`aria-selected` with its own (already-
                            // correct) values — see `resolveActiveOptionId`'s doc — so these three are
                            // for the test-support mock's benefit; harmless passthrough in production.
                            id={`${listboxId}-option-${index}`}
                            // biome-ignore lint/a11y/useSemanticElements: this is the ARIA 1.2 custom
                            // combobox/listbox pattern (WAI-ARIA Authoring Practices) — a native
                            // <option> only renders inside <select>/<datalist>, so a styled popup row
                            // must be `role="option"` on a real element, not a literal <option>.
                            role="option"
                            aria-selected={index === highlighted}
                            data-active={index === highlighted ? "true" : "false"}
                            className={cn(
                              "flex flex-col items-start gap-0.5 py-2",
                              index === highlighted && "bg-accent text-accent-foreground",
                            )}
                            // Keep focus in the editor so the stored replacement range stays valid on click.
                            onMouseDown={(event) => event.preventDefault()}
                            onMouseEnter={() => setHighlighted(index)}
                            onSelect={() => selectAgent(agent)}
                          >
                            <span className="flex items-center gap-1.5 text-caption">
                              <AtSign aria-hidden className="size-3 shrink-0" />
                              {agentLabel(agent)}
                            </span>
                            {agent.description ? (
                              <span className="line-clamp-1 ps-4.5 text-caption text-muted-foreground">
                                {agent.description}
                              </span>
                            ) : null}
                          </PromptInputCommandItem>
                        ))}
                      </PromptInputCommandGroup>
                    ) : null}
                  </PromptInputCommandList>
                </PromptInputCommand>
              </div>,
              document.body,
            )
          : null}
      </div>
    );
  },
);
