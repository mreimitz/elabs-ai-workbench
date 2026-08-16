/* GENERATED from packages/flow/src/templates-flow-workspace.stories.tsx by pnpm gen:templates — do not edit. */
/* Full-screen flow-workspace template (single source of truth: the Storybook story). */

/**
 * Flow workspace template — the canonical full-screen flow-workspace
 * composition (app-shell + branded React Flow canvas). This story is the
 * single source of truth: `pnpm gen:templates` derives the consumer template
 * source (`docs/playbooks/templates/flow-workspace.tsx`) from it.
 * Remember `import "@xyflow/react/dist/style.css"` is wired in Storybook preview.
 * Verify across all three themes with globals=theme:<slug>.
 */
import { useState } from "react";
import {
  Button,
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
  CanvasShell,
  FlowEdge,
  FlowMiniMap,
  FlowNode,
  Panel,
  ZoomControls,
  useEdgesState,
  useFlowLayout,
  useNodesState,
  type BrandFlowNode,
  type Edge,
} from "@brand/flow";
import { AppIcon } from "@brand/icons";

const nodeTypes = { brand: FlowNode };
const edgeTypes = { brand: FlowEdge };

/**
 * Auto-layout control. Rendered as a child of `CanvasShell` so `useFlowLayout`
 * resolves the flow context; it tidies the graph with dagre and fits the view.
 */
function LayoutControls() {
  const { layout } = useFlowLayout();
  return (
    <Panel position="top-right">
      <Button size="sm" variant="secondary" onClick={() => layout("LR")}>
        Auto layout
      </Button>
    </Panel>
  );
}

const initialNodes: BrandFlowNode[] = [
  {
    id: "ingest",
    type: "brand",
    position: { x: 60, y: 160 },
    data: { kind: "Source", title: "Ingest", subtitle: "Raw data in", tone: "accent" },
  },
  {
    id: "transform",
    type: "brand",
    position: { x: 320, y: 80 },
    data: { kind: "Process", title: "Transform", subtitle: "Normalize & enrich" },
  },
  {
    id: "validate",
    type: "brand",
    position: { x: 320, y: 240 },
    data: { kind: "Process", title: "Validate", subtitle: "Quality checks" },
  },
  {
    id: "publish",
    type: "brand",
    position: { x: 580, y: 160 },
    data: { kind: "Output", title: "Publish", subtitle: "Downstream sink", tone: "success" },
  },
];

const initialEdges: Edge[] = [
  { id: "e-ingest-transform", source: "ingest", target: "transform", type: "brand" },
  { id: "e-ingest-validate", source: "ingest", target: "validate", type: "brand" },
  { id: "e-transform-publish", source: "transform", target: "publish", type: "brand" },
  { id: "e-validate-publish", source: "validate", target: "publish", type: "brand" },
];

const nav = [
  { id: "canvas", label: "Canvas" },
  { id: "layers", label: "Layers" },
  { id: "home", label: "Home" },
  { id: "settings", label: "Settings" },
];

function FlowWorkspaceTemplate() {
  const [active, setActive] = useState("canvas");
  const [nodes, , onNodesChange] = useNodesState(initialNodes);
  const [edges, , onEdgesChange] = useEdgesState(initialEdges);

  return (
    <SidebarProvider>
      <Sidebar collapsible="offcanvas">
        <SidebarHeader className="px-3 py-2">
          <div className="flex items-center gap-2">
            <AppIcon height={20} aria-hidden />
            <span className="truncate font-semibold group-data-[collapsible=icon]:hidden">
              Flow
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
          <h1 className="text-body font-medium capitalize">{active}</h1>
        </header>
        <div className="h-[calc(100vh-3.5rem)]">
          <CanvasShell
            className="h-full w-full"
            helperLines
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
          >
            <LayoutControls />
            <ZoomControls />
            <FlowMiniMap />
          </CanvasShell>
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
