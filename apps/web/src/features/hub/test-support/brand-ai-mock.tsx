import {
  Children,
  cloneElement,
  createContext,
  forwardRef,
  isValidElement,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type ReactElement,
  type ReactNode,
} from "react";
import { Button } from "@elabs-ai/components-ui";

/**
 * A SHARED `@elabs-ai/components-ai` stub for the hub feature's test suites, mirroring the "stub every heavy
 * @elabs-ai/components-ai component the tree renders" posture every other suite that touches `@elabs-ai/components-ai` already
 * uses (`AssistantDock.test.tsx`, `RunConsole.test.tsx`, `AssistantView.test.tsx`) — jsdom never has
 * to load the real shiki/mermaid/streamdown dependency chain. Reused across `ConversationPane.test.tsx`,
 * `Composer.test.tsx`, `NewSessionDialog.test.tsx`, and `AssistantView.test.tsx` via
 * `vi.mock("@elabs-ai/components-ai", () => import("./test-support/brand-ai-mock"))` so the ~40-component surface
 * this feature composes isn't duplicated per file.
 *
 * A handful of stubs are NOT bare passthroughs because a test needs to observe their real behavior:
 *  - `ToolHeader` renders `state`/`toolName` as data attributes so a test can assert the R-UX1 state
 *    machine transitions (`getByTestId(...).dataset.state`).
 *  - `ApprovalCard`/`ApprovalCardRequest`/`ApprovalCardAccepted`/`ApprovalCardRejected` reproduce the
 *    REAL component's self-gating logic (null unless `approval` + a relevant `state`; `Request` only
 *    at `approval-requested`; `Accepted`/`Rejected` only once resolved) via a tiny local context, since
 *    that gating IS the thing WP1.3's approval-card composition needs verified.
 *  - `ModelSelector`/`ModelSelectorTrigger`/`ModelSelectorContent`/`ModelSelectorItem` are a minimal
 *    working command-palette (open/close + pick) so the per-message model override is exercisable.
 *  - `PromptInput` is a real `<form>` that calls `onSubmit({text})` on submit, so the composer's
 *    queue-while-running / Stop tests can drive it like a real user would.
 *  - `PromptInputProvider`/`usePromptInputController` (WP2.5) are a REAL minimal context (a `useState`-
 *    backed `{value, setInput, clear}`) mirroring the live library's actual controlled-textarea
 *    contract — `Composer.tsx`'s slash-command detection/insertion reads and writes through it, so the
 *    mock has to behave like the real one here, not just pass through.
 *  - `MessageBranch`/`MessageBranchContent`/`MessageBranchSelector`/`MessageBranchPrevious`/
 *    `MessageBranchNext`/`MessageBranchPage` (WP2.5) reproduce the real library's uncontrolled
 *    `defaultBranch` + Previous/Next/Page semantics via a tiny local context, since
 *    `ConversationPane.tsx`'s regenerate/sibling-switching tests need to actually flip between variants.
 *  - `PromptInputProvider`'s `attachments` (WP3.4) is now REAL, `useState`-backed state too (mirroring
 *    the `textInput` precedent above it): a hidden `<input type="file">` it renders converts picked
 *    `File`s into `{id, url: data:…, mediaType, filename}` entries (the real library's own `FileUIPart`
 *    shape) so `Composer.tsx`'s attachment chips / remove / upload-then-send flow is exercisable with
 *    `userEvent.upload(...)`, not just always-empty.
 */

const Pass = ({ children }: { children?: ReactNode }) => <div>{children}</div>;

// ── Shell / conversation ────────────────────────────────────────────────────────────────────────────

export const ChatShell = ({
  header,
  composer,
  aside,
  children,
}: {
  header?: ReactNode;
  composer?: ReactNode;
  aside?: ReactNode;
  children?: ReactNode;
}) => (
  <div>
    {header}
    {children}
    {composer}
    {aside}
  </div>
);
export const Conversation = Pass;
export const ConversationContent = Pass;
export const ConversationEmptyState = ({
  title,
  description,
}: {
  title?: string;
  description?: string;
}) => (
  <div>
    <h3>{title}</h3>
    <p>{description}</p>
  </div>
);
export const ConversationScrollButton = () => null;
export const Suggestions = Pass;
export const Suggestion = ({
  suggestion,
  onClick,
  disabled,
}: {
  suggestion: string;
  onClick?: (suggestion: string) => void;
  disabled?: boolean;
}) => (
  <Button size="sm" disabled={disabled} onClick={() => onClick?.(suggestion)}>
    {suggestion}
  </Button>
);

// ── Message / user turn ─────────────────────────────────────────────────────────────────────────────

export const UserMessage = Pass;
export const AgentMessage = Pass;
export const MessageContent = Pass;
export const MessageResponse = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
export const Shimmer = ({ children }: { children?: ReactNode }) => <output>{children}</output>;

// ── ProducedAssetTree (WP3.4, D-AH12) — a minimal, real-enough tree so a test can assert content
//    and drive `onSelect`, without pulling in the real component's virtualization/DnD internals.

type MockContextAsset = { id: string; name: string; path?: string; type: string };

export const ProducedAssetTree = ({
  assets,
  onSelect,
}: {
  assets: MockContextAsset[];
  onSelect?: (asset: MockContextAsset) => void;
}) => (
  <ul data-testid="produced-asset-tree">
    {assets.map((asset) => (
      <li key={asset.id}>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          data-testid="produced-asset-item"
          onClick={() => onSelect?.(asset)}
        >
          {asset.name}
        </Button>
      </li>
    ))}
  </ul>
);

export const FileTreeIcon = Pass;
export const FileTreeName = Pass;
export const PRODUCED_ASSET_ICONS = {};

// ── Reasoning ────────────────────────────────────────────────────────────────────────────────────────

export const Reasoning = ({
  children,
  isStreaming,
}: {
  children?: ReactNode;
  isStreaming?: boolean;
}) => (
  <div data-testid="reasoning" data-streaming={isStreaming ? "true" : "false"}>
    {children}
  </div>
);
export const ReasoningTrigger = () => <div>Reasoning</div>;
export const ReasoningContent = Pass;

// ── Task widget (R-SES4) ────────────────────────────────────────────────────────────────────────────

export const Task = Pass;
export const TaskTrigger = ({ title }: { title?: string }) => <div>{title}</div>;
export const TaskContent = Pass;
export const TaskItem = ({ children, status }: { children?: ReactNode; status?: string }) => (
  <div data-testid="task-item" data-status={status}>
    {children}
  </div>
);

// ── Tool call (R-UX1) ───────────────────────────────────────────────────────────────────────────────

export const Tool = Pass;
export const ToolHeader = ({
  title,
  state,
  toolName,
  summary,
}: {
  title?: string;
  state?: string;
  toolName?: string;
  summary?: string;
}) => (
  <div data-testid="tool-header" data-state={state} data-tool-name={toolName}>
    {title}
    {summary ? ` — ${summary}` : ""}
  </div>
);
export const ToolContent = Pass;
export const ToolDetails = Pass;
export const ToolInput = ({ input }: { input: unknown }) => (
  <pre data-testid="tool-input">{JSON.stringify(input)}</pre>
);
export const ToolOutput = ({ output, errorText }: { output?: unknown; errorText?: string }) =>
  errorText ? (
    <pre data-testid="tool-error">{errorText}</pre>
  ) : (
    <pre data-testid="tool-output">{JSON.stringify(output)}</pre>
  );

// ── Approval card (R-UX1's approval leg) — reproduces the real self-gating logic ───────────────────

type ApprovalCtxValue = { state?: string; approval?: { approved?: boolean } };
const ApprovalContext = createContext<ApprovalCtxValue | null>(null);

export const ApprovalCard = ({
  state,
  approval,
  children,
}: {
  state?: string;
  approval?: { approved?: boolean };
  children?: ReactNode;
}) => {
  if (!approval || state === "input-streaming" || state === "input-available") return null;
  return (
    <ApprovalContext.Provider value={{ state, approval }}>
      <div data-testid="approval-card" data-state={state}>
        {children}
      </div>
    </ApprovalContext.Provider>
  );
};
export const ApprovalCardTitle = Pass;
export const ApprovalCardDescription = Pass;
export const ApprovalCardRequest = ({ children }: { children?: ReactNode }) => {
  const ctx = useContext(ApprovalContext);
  return ctx?.state === "approval-requested" ? <>{children}</> : null;
};
export const ApprovalCardAccepted = ({ children }: { children?: ReactNode }) => {
  const ctx = useContext(ApprovalContext);
  return ctx?.approval?.approved === true ? <>{children}</> : null;
};
export const ApprovalCardRejected = ({ children }: { children?: ReactNode }) => {
  const ctx = useContext(ApprovalContext);
  return ctx?.approval?.approved === false ? <>{children}</> : null;
};
export const ApprovalCardActions = Pass;
export const ApprovalCardApprove = ({
  children,
  ...props
}: { children?: ReactNode } & Record<string, unknown>) => (
  <button type="button" {...props}>
    {" "}
    {/* brand-ui-allow: test-only @elabs-ai/components-ai stub (mirrors AssistantDock.test.tsx) */}
    {children}
  </button>
);
export const ApprovalCardDeny = ({
  children,
  ...props
}: { children?: ReactNode } & Record<string, unknown>) => (
  <button type="button" {...props}>
    {" "}
    {/* brand-ui-allow: test-only @elabs-ai/components-ai stub (mirrors AssistantDock.test.tsx) */}
    {children}
  </button>
);

// ── Context gauge (R-SES7) ──────────────────────────────────────────────────────────────────────────

export const Context = ({
  usedTokens,
  maxTokens,
  children,
}: {
  usedTokens?: number;
  maxTokens?: number;
  children?: ReactNode;
}) => (
  <div data-testid="context-gauge" data-used={usedTokens} data-max={maxTokens}>
    {children}
  </div>
);
export const ContextTrigger = () => <div data-testid="context-trigger">context</div>;
export const ContextContent = Pass;
export const ContextContentHeader = () => <div data-testid="context-header" />;
export const ContextContentFooter = ({ children }: { children?: ReactNode }) => (
  <div data-testid="context-footer">{children}</div>
);

// ── Composer (`PromptInput*`) ───────────────────────────────────────────────────────────────────────

export const PromptInput = ({
  children,
  onSubmit,
}: {
  children?: ReactNode;
  onSubmit?: (message: { text: string }, event: React.FormEvent<HTMLFormElement>) => void;
}) => (
  <form
    onSubmit={(event) => {
      event.preventDefault();
      const textarea = event.currentTarget.querySelector("textarea");
      onSubmit?.({ text: textarea?.value ?? "" }, event);
    }}
  >
    {children}
  </form>
);
export const PromptInputBody = Pass;
export const PromptInputFooter = Pass;
export const PromptInputTools = Pass;
export const PromptInputTextarea = (props: Record<string, unknown>) => <textarea {...props} />; // brand-ui-allow: test-only @elabs-ai/components-ai stub (mirrors AssistantDock.test.tsx)
export const PromptInputButton = ({
  children,
  tooltip: _tooltip,
  ...props
}: { children?: ReactNode; tooltip?: unknown } & Record<string, unknown>) => (
  <button type="button" {...props}>
    {" "}
    {/* brand-ui-allow: test-only @elabs-ai/components-ai stub (mirrors AssistantDock.test.tsx) */}
    {children}
  </button>
);
// Forwards `disabled` + the rest props (aria-label, className) so the composer's empty-state Send
// affordance — the real library forwards both onto its button too — is assertable; form-level
// `fireEvent.submit` driving is unaffected by a disabled button either way. It also reproduces the real
// component's `onStop` behavior (owner-feedback merged Send↔Stop): while generating (submitted /
// streaming) AND an `onStop` is provided, the control becomes a `type="button"` that calls `onStop`
// instead of submitting the form — exactly what the real `PromptInputSubmit` does — so a test can click
// the morphed Stop and observe `onStop`, not an accidental send.
export const PromptInputSubmit = ({
  children,
  status,
  disabled,
  onStop,
  onClick,
  ...props
}: {
  children?: ReactNode;
  status?: "submitted" | "streaming" | "error";
  disabled?: boolean;
  onStop?: () => void;
  onClick?: (event: React.MouseEvent<HTMLButtonElement>) => void;
} & Record<string, unknown>) => {
  const isGenerating = status === "submitted" || status === "streaming";
  return (
    <button
      type={isGenerating && onStop ? "button" : "submit"}
      disabled={disabled || status === "submitted"}
      data-status={status ?? "ready"}
      onClick={(event) => {
        if (isGenerating && onStop) {
          event.preventDefault();
          onStop();
          return;
        }
        onClick?.(event);
      }}
      {...props}
    >
      {" "}
      {/* brand-ui-allow: test-only @elabs-ai/components-ai stub (mirrors AssistantDock.test.tsx) */}
      {children ?? "Send"}
    </button>
  );
};
export const PromptInputSelect = Pass;
export const PromptInputSelectContent = Pass;
export const PromptInputSelectItem = Pass;
export const PromptInputSelectTrigger = Pass;
export const PromptInputSelectValue = () => null;

// ── PromptInputProvider / usePromptInputController (WP2.5 — real, not a passthrough) ───────────────
// The live library only makes `PromptInputTextarea` a CONTROLLED input when a provider is present
// (`value`/`onChange` flow through this context); `Composer.tsx` relies on that same context to read
// the live text for slash-command detection and to write it back on command insertion. This stub
// reproduces just that contract with a plain `useState`.

type PromptInputTextState = { value: string; setInput: (v: string) => void; clear: () => void };
type MockAttachmentData = {
  id: string;
  type: "file";
  mediaType: string;
  filename?: string;
  url: string;
};
type PromptInputAttachmentsState = {
  files: MockAttachmentData[];
  add: (files: File[] | FileList) => void;
  remove: (id: string) => void;
  clear: () => void;
  openFileDialog: () => void;
  fileInputRef: { current: HTMLInputElement | null };
};
type PromptInputControllerState = {
  textInput: PromptInputTextState;
  attachments: PromptInputAttachmentsState;
  __registerFileInput: () => void;
};
const PromptInputControllerContext = createContext<PromptInputControllerState | null>(null);

let attachmentIdCounter = 0;

export const PromptInputProvider = ({
  children,
  initialInput = "",
}: {
  children?: ReactNode;
  initialInput?: string;
}) => {
  const [value, setValue] = useState(initialInput);
  const [files, setFiles] = useState<MockAttachmentData[]>([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const add = useCallback((picked: File[] | FileList) => {
    // `FileReader.readAsDataURL` (not `Blob.arrayBuffer()`, which this jsdom version doesn't
    // implement) — also mirrors what a real browser-side attachment picker does either way.
    for (const file of Array.from(picked)) {
      const reader = new FileReader();
      reader.onload = () => {
        const url = typeof reader.result === "string" ? reader.result : "";
        const entry: MockAttachmentData = {
          id: `att-${(attachmentIdCounter += 1)}`,
          type: "file",
          mediaType: file.type || "application/octet-stream",
          filename: file.name,
          url,
        };
        setFiles((prev) => [...prev, entry]);
      };
      reader.readAsDataURL(file);
    }
  }, []);
  const remove = useCallback(
    (id: string) => setFiles((prev) => prev.filter((f) => f.id !== id)),
    [],
  );
  const clear = useCallback(() => setFiles([]), []);
  const openFileDialog = useCallback(() => fileInputRef.current?.click(), []);

  const ctx = useMemo<PromptInputControllerState>(
    () => ({
      textInput: { value, setInput: setValue, clear: () => setValue("") },
      attachments: { files, add, remove, clear, openFileDialog, fileInputRef },
      __registerFileInput: () => undefined,
    }),
    [value, files, add, remove, clear, openFileDialog],
  );

  return (
    <PromptInputControllerContext.Provider value={ctx}>
      <input
        ref={fileInputRef}
        type="file"
        multiple
        data-testid="composer-attachment-input"
        style={{ display: "none" }}
        onChange={(event) => {
          if (event.target.files) add(event.target.files);
          event.target.value = "";
        }}
      />{" "}
      {/* brand-ui-allow: test-only @elabs-ai/components-ai stub — mirrors PromptInput's own internal hidden file input */}
      {children}
    </PromptInputControllerContext.Provider>
  );
};

export const usePromptInputController = () => {
  const ctx = useContext(PromptInputControllerContext);
  if (!ctx) {
    throw new Error(
      "Wrap your component inside <PromptInputProvider> to use usePromptInputController().",
    );
  }
  return ctx;
};

// ── Attachments (WP3.4) — a minimal working chip list over the REAL attachments state above ─────────

const AttachmentDataContext = createContext<{
  data: MockAttachmentData;
  onRemove?: () => void;
} | null>(null);

export const Attachments = ({
  children,
  ...props
}: { children?: ReactNode } & Record<string, unknown>) => <div {...props}>{children}</div>;
export const Attachment = ({
  data,
  onRemove,
  children,
  ...props
}: {
  data: MockAttachmentData;
  onRemove?: () => void;
  children?: ReactNode;
} & Record<string, unknown>) => (
  <div data-testid="attachment-chip" {...props}>
    <AttachmentDataContext.Provider value={{ data, onRemove }}>
      {children}
    </AttachmentDataContext.Provider>
  </div>
);
export const AttachmentPreview = () => null;
export const AttachmentInfo = () => {
  const ctx = useContext(AttachmentDataContext);
  return <span>{ctx?.data.filename}</span>;
};
export const AttachmentRemove = ({ label }: { label?: string }) => {
  const ctx = useContext(AttachmentDataContext);
  return (
    <Button
      type="button"
      size="icon-sm"
      variant="ghost"
      aria-label={label ?? "Remove attachment"}
      onClick={() => ctx?.onRemove?.()}
    >
      ×
    </Button>
  );
};

// ── PromptInputCommand* (WP2.5 slash menu) — plain passthrough; `Composer.tsx` drives keyboard nav
// itself (the textarea's own `onKeyDown`), so the mock doesn't need cmdk's real filter/nav behavior.

export const PromptInputCommand = Pass;
export const PromptInputCommandList = Pass;
export const PromptInputCommandGroup = ({
  heading,
  children,
}: {
  heading?: ReactNode;
  children?: ReactNode;
}) => (
  <div>
    <div>{heading}</div>
    {children}
  </div>
);
export const PromptInputCommandEmpty = ({ children }: { children?: ReactNode }) => (
  <div data-testid="command-empty">{children}</div>
);
export const PromptInputCommandInput = (props: Record<string, unknown>) => <input {...props} />; // brand-ui-allow: test-only @elabs-ai/components-ai stub (mirrors AssistantDock.test.tsx)
export const PromptInputCommandItem = ({
  children,
  onSelect,
  value,
  ...props
}: { children?: ReactNode; onSelect?: (value: string) => void; value?: string } & Record<
  string,
  unknown
>) => (
  <button type="button" onClick={() => onSelect?.(value ?? "")} {...props}>
    {" "}
    {/* brand-ui-allow: test-only @elabs-ai/components-ai stub */}
    {children}
  </button>
);
export const PromptInputCommandSeparator = () => <hr />; // brand-ui-allow: test-only @elabs-ai/components-ai stub

// ── SpeechInput (WP2.5 voice input) — a plain button; clicking it simulates ONE final transcript so a
// test can drive "dictate → text appended" without any Web Speech API/MediaRecorder in jsdom.

export const SpeechInput = ({
  onTranscriptionChange,
  ...props
}: { onTranscriptionChange?: (text: string) => void } & Record<string, unknown>) => (
  <button type="button" onClick={() => onTranscriptionChange?.("mock transcript")} {...props}>
    {" "}
    {/* brand-ui-allow: test-only @elabs-ai/components-ai stub */}
    Voice input
  </button>
);

// ── Message actions + branch/variant switching (WP2.5 regenerate) ──────────────────────────────────

export const MessageActions = Pass;
export const MessageAction = ({
  children,
  label,
  tooltip,
  ...props
}: { children?: ReactNode; label?: string; tooltip?: string } & Record<string, unknown>) => (
  <button type="button" aria-label={label || tooltip} {...props}>
    {" "}
    {/* brand-ui-allow: test-only @elabs-ai/components-ai stub */}
    {children}
  </button>
);

type MessageBranchCtxValue = {
  currentBranch: number;
  totalBranches: number;
  goToNext: () => void;
  goToPrevious: () => void;
  registerBranchCount: (count: number) => void;
};
const MessageBranchContext = createContext<MessageBranchCtxValue | null>(null);
const useMessageBranchCtx = (): MessageBranchCtxValue => {
  const ctx = useContext(MessageBranchContext);
  if (!ctx) throw new Error("MessageBranch components must be used within MessageBranch");
  return ctx;
};

/** Reproduces the real library's UNCONTROLLED `defaultBranch` (read once at mount) — production code
 *  jumps to a specific sibling by remounting via `key`, exactly as it would against the real component. */
export const MessageBranch = ({
  children,
  defaultBranch = 0,
}: {
  children?: ReactNode;
  defaultBranch?: number;
  onBranchChange?: (index: number) => void;
}) => {
  const [currentBranch, setCurrentBranch] = useState(defaultBranch);
  const [totalBranches, setTotalBranches] = useState(0);
  const goToNext = () => setCurrentBranch((i) => (i < totalBranches - 1 ? i + 1 : 0));
  const goToPrevious = () => setCurrentBranch((i) => (i > 0 ? i - 1 : totalBranches - 1));
  const ctx = useMemo<MessageBranchCtxValue>(
    () => ({
      currentBranch,
      totalBranches,
      goToNext,
      goToPrevious,
      registerBranchCount: setTotalBranches,
    }),
    [currentBranch, totalBranches],
  );
  return <MessageBranchContext.Provider value={ctx}>{children}</MessageBranchContext.Provider>;
};

export const MessageBranchContent = ({ children }: { children?: ReactNode }) => {
  const { currentBranch, registerBranchCount } = useMessageBranchCtx();
  const branches = Children.toArray(children);
  useEffect(() => {
    registerBranchCount(branches.length);
    // Only the COUNT matters for this stub's nav math — re-registering on every render is harmless
    // (same number) but re-running on every children identity change would be noisy for no benefit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branches.length]);
  return <div data-testid="message-branch-content">{branches[currentBranch] ?? null}</div>;
};

export const MessageBranchSelector = ({ children }: { children?: ReactNode }) => {
  const { totalBranches } = useMessageBranchCtx();
  return totalBranches <= 1 ? null : <div data-testid="message-branch-selector">{children}</div>;
};
export const MessageBranchPrevious = (props: Record<string, unknown>) => {
  const { goToPrevious } = useMessageBranchCtx();
  return (
    <button type="button" aria-label="Previous branch" onClick={goToPrevious} {...props} /> // brand-ui-allow: test-only @elabs-ai/components-ai stub
  );
};
export const MessageBranchNext = (props: Record<string, unknown>) => {
  const { goToNext } = useMessageBranchCtx();
  return (
    <button type="button" aria-label="Next branch" onClick={goToNext} {...props} /> // brand-ui-allow: test-only @elabs-ai/components-ai stub
  );
};
export const MessageBranchPage = () => {
  const { currentBranch, totalBranches } = useMessageBranchCtx();
  return (
    <span data-testid="message-branch-page">
      {currentBranch + 1} of {totalBranches}
    </span>
  );
};

// ── ModelSelector (R-SES10 per-message override · D-MI7 HubModelPicker) ─────────────────────────────
//
// model-identity WP 4.1: this stub used to be open/close + click-to-pick ONLY — `ModelSelectorList`
// and `ModelSelectorEmpty` were bare `Pass`es and `ModelSelectorItem` dropped `keywords`, `disabled`
// and `aria-*`. That is why the D-MI7 search gap went unnoticed for so long: no test COULD observe
// that `Composer.tsx` passed no `keywords`, because the mock never filtered anything.
//
// It now reproduces the parts of cmdk's contract the picker depends on:
//   • a controlled search box whose query filters items on `value + keywords` (the same two inputs
//     cmdk's default `commandScore(value + " " + keywords.join(" "), search)` consumes — substring
//     rather than fuzzy, which is stricter and therefore a safe stand-in for an assertion),
//   • `ModelSelectorEmpty` rendering only while nothing matches,
//   • `disabled` items that render (visible!) but cannot be activated, with their `aria-*` intact.
//
// It is deliberately NOT a cmdk re-implementation: keyboard highlight/`data-value` selection is
// cmdk's own and is locked against the REAL library in `HubModelPicker.cmdk.test.tsx`.

type ModelSelectorCtxValue = {
  open: boolean;
  setOpen: (open: boolean) => void;
  query: string;
  setQuery: (next: string) => void;
  setMatch: (id: string, matched: boolean) => void;
  matchCount: number;
};
const ModelSelectorContext = createContext<ModelSelectorCtxValue | null>(null);

export const ModelSelector = ({
  open,
  onOpenChange,
  children,
}: {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children?: ReactNode;
}) => {
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<Record<string, boolean>>({});
  const setMatch = useCallback((id: string, matched: boolean) => {
    setMatches((current) =>
      current[id] === matched ? current : { ...current, [id]: matched },
    );
  }, []);
  const matchCount = Object.values(matches).filter(Boolean).length;
  const value = useMemo(
    () => ({
      open: !!open,
      setOpen: (next: boolean) => onOpenChange?.(next),
      query,
      setQuery,
      setMatch,
      matchCount,
    }),
    [open, onOpenChange, query, setMatch, matchCount],
  );
  return <ModelSelectorContext.Provider value={value}>{children}</ModelSelectorContext.Provider>;
};
export const ModelSelectorTrigger = ({
  children,
  disabled,
}: {
  children?: ReactNode;
  disabled?: boolean;
  asChild?: boolean;
}) => {
  const ctx = useContext(ModelSelectorContext);
  if (isValidElement(children)) {
    return cloneElement(children as ReactElement<{ onClick?: () => void; disabled?: boolean }>, {
      onClick: () => {
        if (!disabled) ctx?.setOpen(true);
      },
    });
  }
  return (
    <button type="button" disabled={disabled} onClick={() => ctx?.setOpen(true)}> {/* brand-ui-allow: test-only @elabs-ai/components-ai stub (mirrors AssistantDock.test.tsx) */}
      {children}
    </button>
  );
};
export const ModelSelectorContent = ({ children }: { children?: ReactNode; title?: ReactNode }) => {
  const ctx = useContext(ModelSelectorContext);
  return ctx?.open ? <div data-testid="model-selector-content">{children}</div> : null;
};
export const ModelSelectorInput = ({
  placeholder,
  ...props
}: { placeholder?: string } & Record<string, unknown>) => {
  const ctx = useContext(ModelSelectorContext);
  return (
    // brand-ui-allow: test-only @elabs-ai/components-ai stub (mirrors AssistantDock.test.tsx)
    <input
      {...props}
      aria-label="Search models"
      placeholder={placeholder}
      value={ctx?.query ?? ""}
      onChange={(event) => ctx?.setQuery(event.target.value)}
    />
  );
};
export const ModelSelectorList = Pass;
/** cmdk renders `Empty` only while NOTHING matches the current query — so must the stub. */
export const ModelSelectorEmpty = ({ children }: { children?: ReactNode }) => {
  const ctx = useContext(ModelSelectorContext);
  return ctx && ctx.matchCount === 0 ? <div>{children}</div> : null;
};
export const ModelSelectorGroup = ({
  heading,
  children,
}: {
  heading?: ReactNode;
  children?: ReactNode;
}) => (
  <div>
    <div>{heading}</div>
    {children}
  </div>
);
export const ModelSelectorItem = ({
  children,
  onSelect,
  value,
  keywords,
  disabled,
  ...rest
}: {
  children?: ReactNode;
  onSelect?: (value: string) => void;
  value?: string;
  keywords?: string[];
  disabled?: boolean;
} & Record<string, unknown>) => {
  const ctx = useContext(ModelSelectorContext);
  const id = useId();
  const needle = (ctx?.query ?? "").trim().toLowerCase();
  // The same haystack cmdk scores: the item's `value` PLUS its keywords.
  const haystack = [value ?? "", ...(keywords ?? [])].join(" ").toLowerCase();
  const matched = needle === "" || haystack.includes(needle);
  const setMatch = ctx?.setMatch;
  useEffect(() => {
    setMatch?.(id, matched);
    return () => setMatch?.(id, false);
  }, [setMatch, id, matched]);
  if (!matched) return null;
  return (
    // brand-ui-allow: test-only @elabs-ai/components-ai stub (mirrors AssistantDock.test.tsx)
    <button
      type="button"
      // Deliberately still a plain `button` (not cmdk's real `role="option"`): every existing hub
      // suite queries these rows with `getByRole("button", …)`, and role fidelity is locked against
      // the REAL library in `HubModelPicker.cmdk.test.tsx` instead.
      aria-disabled={disabled ? true : undefined}
      disabled={disabled}
      onClick={() => {
        if (!disabled) onSelect?.(value ?? "");
      }}
      {...rest}
    >
      {children}
    </button>
  );
};
export const ModelSelectorLogo = () => null;
export const ModelSelectorName = Pass;

// ── Artifact canvas (WP1.6, R-UX13) ─────────────────────────────────────────────────────────────────

export const Artifact = Pass;
export const ArtifactHeader = Pass;
export const ArtifactTitle = ({
  children,
  className,
}: { children?: ReactNode; className?: string }) => <p className={className}>{children}</p>;
export const ArtifactDescription = Pass;
export const ArtifactActions = Pass;
// `forwardRef` so Radix's `DropdownMenuTrigger asChild` (a REAL, unmocked `@elabs-ai/components-ui` component in
// every test that renders the export menu) can compose its own click/aria handlers onto this stub
// exactly as it would the real `ArtifactAction` (a `Button` under the hood, which also forwards refs).
// Typed against real `ButtonHTMLAttributes` (not a `Record<string, unknown>` catch-all) so the runtime
// props Radix's `Slot` clones onto it (onClick, aria-expanded, aria-haspopup, id, …) forward cleanly.
export const ArtifactAction = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & { label?: string; tooltip?: string; icon?: unknown }
>(function ArtifactAction({ label, tooltip, icon: _icon, children, ...rest }, ref) {
  return (
    <button ref={ref} type="button" aria-label={label || tooltip} {...rest}>
      {" "}
      {/* brand-ui-allow: test-only @elabs-ai/components-ai stub, mirrors AssistantDock.test.tsx */}
      {children}
    </button>
  );
});
export const ArtifactClose = ({
  onClick,
  children,
}: {
  onClick?: () => void;
  children?: ReactNode;
}) => (
  <button type="button" onClick={onClick} aria-label="Close">
    {" "}
    {/* brand-ui-allow: test-only @elabs-ai/components-ai stub, mirrors AssistantDock.test.tsx */}
    {children ?? "Close"}
  </button>
);
export const ArtifactContent = Pass;

/** Renders its markdown/fenced-block SOURCE verbatim (no shiki/streamdown) — tests assert on the raw
 *  string, which is enough to prove the canvas picked the right content for the right artifact/version.
 *  ui-wave U2 — the Streamdown `controls` config is surfaced as a data attribute so a test can assert
 *  the raw table-fullscreen control was switched off (jsdom can't render the real Streamdown toolbar). */
export const MarkdownView = ({
  children,
  controls,
}: {
  children?: ReactNode;
  controls?: unknown;
}) => (
  <div
    data-testid="markdown-view"
    {...(controls !== undefined ? { "data-controls": JSON.stringify(controls) } : {})}
  >
    {children}
  </div>
);

export const WebPreview = Pass;
export const WebPreviewBody = ({ srcDoc }: { srcDoc?: string }) => (
  <div data-testid="web-preview-body">{srcDoc}</div>
);

// ── Missions (WP1.7) — plan card + board + queue ──────────────────────────────────────────────────
// `Plan` is a Collapsible under the hood (defaultOpen keeps content visible); the stub just renders
// children so tests see the plan/board content without driving a disclosure. `Agent*`/`Queue*` are
// passthrough shells; `AgentHeader` surfaces name+model as text (a test asserts the model chip shows).

export const Plan = ({
  children,
  isStreaming: _isStreaming,
  defaultOpen: _defaultOpen,
  ...props
}: {
  children?: ReactNode;
  isStreaming?: boolean;
  defaultOpen?: boolean;
} & Record<string, unknown>) => (
  <section data-testid="mission-plan" {...props}>
    {children}
  </section>
);
export const PlanHeader = Pass;
export const PlanTitle = ({ children }: { children?: ReactNode }) => <h3>{children}</h3>;
export const PlanDescription = ({ children }: { children?: ReactNode }) => <p>{children}</p>;
export const PlanContent = Pass;
export const PlanFooter = Pass;
export const PlanTrigger = Pass;
export const PlanAction = Pass;

export const Agent = ({ children }: { children?: ReactNode }) => (
  <div data-testid="mission-agent">{children}</div>
);
export const AgentHeader = ({ name, model }: { name?: string; model?: string }) => (
  <div data-testid="agent-header">
    <span>{name}</span>
    {model ? <span data-testid="agent-model">{model}</span> : null}
  </div>
);
export const AgentContent = Pass;
export const AgentInstructions = ({ children }: { children?: ReactNode }) => <div>{children}</div>;

export const Queue = ({ children }: { children?: ReactNode }) => (
  <div data-testid="mission-queue">{children}</div>
);
export const QueueList = Pass;
export const QueueSection = Pass;
export const QueueSectionLabel = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
export const QueueSectionContent = Pass;
export const QueueItem = ({ children }: { children?: ReactNode }) => (
  <div data-testid="queue-item">{children}</div>
);
export const QueueItemContent = ({ children }: { children?: ReactNode }) => <span>{children}</span>;
export const QueueItemIndicator = () => <span aria-hidden />;
export const QueueItemDescription = ({ children }: { children?: ReactNode }) => (
  <div>{children}</div>
);

// ── Persona (WP2.1, D-AH7 "Persona in cards/boards") ────────────────────────────────────────────────
// The real `Persona` is a Rive/WebGL2 animated glyph (`@rive-app/react-webgl2`) that fetches a remote
// `.riv` asset — jsdom has neither WebGL2 nor network access, so every test renders this stand-in
// instead. `state`/`variant` surface as data attributes so a test can assert which was requested
// without needing the real animation.
export const Persona = ({
  state,
  variant,
  className,
}: {
  state?: string;
  variant?: string;
  className?: string;
}) => <div data-testid="persona" data-state={state} data-variant={variant} className={className} />;
