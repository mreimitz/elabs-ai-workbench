# Playbook — AI assistant

Chat-first surface rendering rich agent output: streaming markdown,
reasoning, tool calls, sources. Template source: `templates/ai-assistant.tsx` (generated from this Storybook story by `pnpm gen:templates`).

**Boundary first (D5):** brand-ui renders the conversation; it never owns the
model call. Your app brings the runtime (`useChat` from the Vercel AI SDK, or
your own). `@brand/ai` uses the `ai` package **types only**.

## Building blocks

| Layer      | Components                                                                                                                                                                                             | From                      |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------- |
| Shell      | `SidebarProvider`+`Sidebar` (history) · `ChatShell` (chat container)                                                                                                                                   | `@brand/ui` / `@brand/ai` |
| Transcript | `Conversation` + `ConversationContent` + `ConversationScrollButton` + `ConversationEmptyState`                                                                                                         | `@brand/ai`               |
| Message    | `Message from=…` + `MessageContent` + `MessageResponse` (streaming md)                                                                                                                                 | `@brand/ai`               |
| Parts      | `Reasoning`/`ReasoningTrigger`/`ReasoningContent` · `Tool`/`ToolHeader`/`ToolContent`/`ToolInput`/`ToolOutput` · `Sources`/`SourcesTrigger`/`SourcesContent`/`Source` · `InlineCitation` · `CodeBlock` | `@brand/ai`               |
| Composer   | `PromptInput` + `PromptInputBody` + `PromptInputTextarea` + `PromptInputFooter` + `PromptInputTools` + `PromptInputSubmit`                                                                             | `@brand/ai`               |
| Extras     | `Suggestion`/`Suggestions` (empty state) · `Shimmer` (first token)                                                                                                                                     | `@brand/ai`               |

## useChat wiring (the bridge)

```tsx
const { messages, sendMessage, status } = useChat(); // your app's runtime

<Conversation className="flex-1">
  <ConversationContent>
    {messages.map((m) => (
      <Message from={m.role} key={m.id}>
        <MessageContent>
          {m.parts.map((part, i) => {
            switch (part.type) {
              case "text":
                return <MessageResponse key={i}>{part.text}</MessageResponse>;
              case "reasoning":
                return (
                  <Reasoning key={i} isStreaming={status === "streaming"}>
                    <ReasoningTrigger />
                    <ReasoningContent>{part.text}</ReasoningContent>
                  </Reasoning>
                );
              case "source-url":
                return null; // collect; render once via <Sources> below
              default:
                if (part.type.startsWith("tool-"))
                  return (
                    <Tool key={i}>
                      <ToolHeader type={part.type} state={part.state} />
                      <ToolContent>
                        <ToolInput input={part.input} />
                        <ToolOutput output={part.output} errorText={part.errorText} />
                      </ToolContent>
                    </Tool>
                  );
                return null;
            }
          })}
        </MessageContent>
      </Message>
    ))}
  </ConversationContent>
  <ConversationScrollButton />
</Conversation>

<PromptInput onSubmit={(message) => message.text && sendMessage({ text: message.text })}>
  <PromptInputBody><PromptInputTextarea placeholder="Send a message…" /></PromptInputBody>
  <PromptInputFooter>
    <PromptInputTools />
    <PromptInputSubmit status={status} />
  </PromptInputFooter>
</PromptInput>
```

Three facts that prevent the common rewrites:

- **`PromptInput` is a form**, not a controlled textarea — handle `onSubmit`;
  don't hold the draft in your own state. Enter submits, Shift+Enter newlines.
- **`PromptInputSubmit status={status}`** renders spinner/stop affordances
  from the AI SDK status — no manual `isLoading` plumbing.
- **`MessageResponse` vs `MessageContent`:** `MessageContent` is the bubble;
  `MessageResponse` streams/renders markdown inside it.

## Empty state

```tsx
<ConversationEmptyState title="Start the conversation" description="Ask anything to begin.">
  {/* or render <Suggestions> with <Suggestion suggestion="…" onClick={(s) => sendMessage({ text: s })} /> */}
</ConversationEmptyState>
```

## Decisions you own

Which parts your agent emits (reasoning? tools? citations?) — render only
those · sidebar content (history, model selector) · suggested prompts ·
theme.

## Decisions already made — don't re-make

Message layout per role (`from` prop) · scroll behavior (`Conversation`
owns stick-to-bottom) · reasoning auto-open/auto-close while streaming ·
tool-state badges (`ToolHeader state`) · markdown + code highlighting
(`MessageResponse`, `CodeBlock`).

## Common mistakes

- Importing the AI SDK runtime inside a shared component — runtime stays in
  the app (`pnpm ai:types-only` gates this in-repo).
- Re-implementing the composer as a controlled `<textarea>` + button.
- Rendering one text blob when the runtime gives you `parts` — you lose
  reasoning/tools/sources.
- For agent-designed surfaces (the agent emits a _screen_, not a message):
  that's A2UI (WP-11, unshipped) — compose it yourself until then; don't
  default to `JSXPreview`. See `docs/DECISIONS.md` D2.
