# brand-ui — composition patterns

Confirm exact props with `brand-ui docs <Component>`. These are the high-value
compositions; prefer them over bespoke markup.

> **Whole-screen recipes** (which blocks, in what order, wired how) live in
> `playbooks/` — one page per archetype: dashboard, data-app,
> ai-assistant, flow-workspace, settings, marketing. For a full screen, read
> the playbook before composing from the snippets below. To scaffold a
> brand-new app, use the `brand-ui-new-app` skill (`/new-app`).

## App shell (sidebar)

```tsx
import {
  SidebarProvider,
  Sidebar,
  SidebarInset,
  SidebarTrigger,
  SidebarHeader,
  SidebarContent,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
} from "@brand/ui";

<SidebarProvider>
  <Sidebar>
    <SidebarHeader>{/* logo / org switcher */}</SidebarHeader>
    <SidebarContent>
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton>Home</SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    </SidebarContent>
  </Sidebar>
  <SidebarInset>
    <header className="flex h-12 items-center gap-2 border-b px-4">
      <SidebarTrigger />
    </header>
    <main className="flex-1 p-4">{/* page content */}</main>
  </SidebarInset>
</SidebarProvider>;
```

For ready-made shells, add a registry block: `brand-ui search sidebar` →
`sidebar-02` (dashboard), `sidebar-04` (mail), `sidebar-05` (double-sided).

## Dashboard (KPIs + table)

```tsx
import { MetricGrid, MetricCard } from "@brand/charts";
import { DataTable, SearchInput, FacetFilter, ColumnPicker } from "@brand/data";

<div className="flex flex-col gap-6 p-4">
  <MetricGrid>
    <MetricCard label="Active users" value="24,512" delta={{ value: "12.4%", direction: "up" }} />
    {/* … */}
  </MetricGrid>
  <DataTable
    columns={columns}
    data={rows}
    toolbar={(table) => (
      <div className="flex items-center gap-2">
        <SearchInput table={table} placeholder="Filter…" />
        <FacetFilter table={table} column="env" title="Environment" />
        <ColumnPicker table={table} />
      </div>
    )}
  />
</div>;
```

`columns` are typed `ColumnDef<TData>`; render status cells with `Badge`.

## AI assistant (chat)

```tsx
import {
  ChatShell,
  Conversation,
  ConversationContent,
  Message,
  MessageContent,
  MessageResponse,
  Reasoning,
  ReasoningTrigger,
  ReasoningContent,
  Sources,
  SourcesTrigger,
  SourcesContent,
  Source,
  PromptInput,
  PromptInputBody,
  PromptInputTextarea,
  PromptInputFooter,
  PromptInputTools,
  PromptInputSubmit,
} from "@brand/ai";

<ChatShell
  header={<b>Ops Assistant</b>}
  aside={/* optional context rail */ null}
  composer={
    <PromptInput onSubmit={(m) => send(m.text)}>
      <PromptInputBody>
        <PromptInputTextarea placeholder="Ask…" />
      </PromptInputBody>
      <PromptInputFooter>
        <PromptInputTools />
        <PromptInputSubmit status={status} />
      </PromptInputFooter>
    </PromptInput>
  }
>
  <Conversation className="flex-1">
    <ConversationContent>
      {messages.map((m) => (
        <Message from={m.role} key={m.id}>
          <MessageContent>
            {m.reasoning && (
              <Reasoning>
                <ReasoningTrigger />
                <ReasoningContent>{m.reasoning}</ReasoningContent>
              </Reasoning>
            )}
            <MessageResponse>{m.text}</MessageResponse>
          </MessageContent>
        </Message>
      ))}
    </ConversationContent>
  </Conversation>
</ChatShell>;
```

Components are presentational — the app owns model calls (e.g. `useChat`).

## Flow canvas (pipeline)

```tsx
import "@xyflow/react/dist/style.css";
import { CanvasShell, FlowNode, FlowEdge, ZoomControls, InspectorPanel } from "@brand/flow";

<CanvasShell
  nodes={nodes}
  edges={edges}
  nodeTypes={{ brand: FlowNode }}
  edgeTypes={{ brand: FlowEdge }}
  onNodesChange={onNodesChange}
  onEdgesChange={onEdgesChange}
>
  <ZoomControls />
</CanvasShell>;
```

Nodes: `type: "brand"`, typed `data: FlowNodeData` (`title`, `subtitle`, `kind`,
`icon`, `tone`). Keep selection state in the app and feed `InspectorPanel`.

## Forms

Use `Form` (react-hook-form + zod) with labelled `Field`s; group inputs with
`InputGroup` + `InputGroupInput`/`InputGroupTextarea` (never raw `Input` inside an
`InputGroup`). Validation: `aria-invalid` on the control. Don't lay forms out with
`space-y-*` — use `flex flex-col gap-*`.
