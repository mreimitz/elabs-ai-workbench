/* GENERATED from packages/ai/src/templates-ai-assistant.stories.tsx by pnpm gen:templates — do not edit. */
/* Full-screen ai-assistant template (single source of truth: the Storybook story). */

/**
 * AI assistant template — the canonical full-screen AI assistant composition
 * (app-shell + chat shell: Conversation + PromptInput). This story is the
 * single source of truth: `pnpm gen:templates` derives the consumer template
 * source (`docs/playbooks/templates/ai-assistant.tsx`) from it.
 * Verify across all three themes with globals=theme:<slug>.
 */
import { useState } from "react";
import { AppIcon } from "@brand/icons";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from "@brand/ui";
import {
  Composer,
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
  Message,
  MessageContent,
  MessageResponse,
} from "@brand/ai";
import { Bot, History, Home, Settings } from "lucide-react";

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
}

const nav = [
  { id: "chat", label: "Chat", icon: Bot },
  { id: "history", label: "History", icon: History },
  { id: "home", label: "Home", icon: Home },
  { id: "settings", label: "Settings", icon: Settings },
];

function AiAssistantTemplate() {
  const [active, setActive] = useState("chat");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [status, setStatus] = useState<"ready" | "submitted">("ready");

  function send(text: string) {
    setMessages((m) => [...m, { id: crypto.randomUUID(), role: "user", text }]);
    setStatus("submitted");
    const reply = "This is a placeholder response. Connect this to your model runtime.";
    setMessages((m) => [...m, { id: crypto.randomUUID(), role: "assistant", text: reply }]);
    setStatus("ready");
  }

  return (
    <SidebarProvider>
      <Sidebar collapsible="icon">
        <SidebarHeader className="px-3 py-2">
          <div className="flex items-center gap-2">
            <AppIcon height={20} aria-hidden />
            <span className="truncate font-semibold group-data-[collapsible=icon]:hidden">
              Assistant
            </span>
          </div>
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu>
                {nav.map((n) => (
                  <SidebarMenuItem key={n.id}>
                    <SidebarMenuButton
                      isActive={active === n.id}
                      tooltip={n.label}
                      onClick={() => setActive(n.id)}
                    >
                      <n.icon aria-hidden="true" />
                      <span>{n.label}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
      </Sidebar>
      <SidebarInset className="flex flex-col overflow-hidden">
        <header className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
          <SidebarTrigger />
          <h1 className="text-body font-medium">AI Assistant</h1>
        </header>
        <div className="flex flex-1 flex-col overflow-hidden">
          <Conversation className="flex-1">
            <ConversationContent>
              {messages.length === 0 ? (
                <ConversationEmptyState
                  title="Start the conversation"
                  description="Ask anything to begin."
                />
              ) : (
                messages.map((m) => (
                  <Message from={m.role} key={m.id}>
                    <MessageContent>
                      <MessageResponse>{m.text}</MessageResponse>
                    </MessageContent>
                  </Message>
                ))
              )}
            </ConversationContent>
            <ConversationScrollButton />
          </Conversation>
          <Composer
            placeholder="Send a message…"
            status={status === "submitted" ? "Generating…" : "Awaiting your input"}
            sendStatus={status}
            onSubmit={(message) => {
              const text = message.text?.trim();
              if (text) send(text);
            }}
          />
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
