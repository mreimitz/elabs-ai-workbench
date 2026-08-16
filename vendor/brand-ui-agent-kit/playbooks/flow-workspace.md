# Playbook — Flow workspace (node-and-edge canvas)

Visual pipeline/workflow editor: branded React Flow canvas, typed nodes,
selection-driven inspector. Template source: `templates/flow-workspace.tsx` (generated from this Storybook story by `pnpm gen:templates`).

**Which canvas?** App canvases use `@brand/flow`'s `CanvasShell`. The
`Canvas` in `@brand/ai` is for agent/chat visualizations (see #183). If
you're building a workspace, you want `@brand/flow`.

## Building blocks

| Layer     | Components                                                          | From                        |
| --------- | ------------------------------------------------------------------- | --------------------------- |
| Shell     | `SidebarProvider` + `Sidebar` (saved items) + `SidebarInset`        | `@brand/ui`                 |
| Canvas    | `CanvasShell` (token-driven RF surface) + `ZoomControls` + `Legend` | `@brand/flow`               |
| Graph     | `FlowNode` (via `nodeTypes`) + `FlowEdge` (via `edgeTypes`)         | `@brand/flow`               |
| Inspector | `InspectorPanel` + `Input`/`Select`/`Switch` fields                 | `@brand/flow` / `@brand/ui` |
| State     | `useNodesState` + `useEdgesState` + `addEdge` (re-exported)         | `@brand/flow`               |

One-time setup: `import "@xyflow/react/dist/style.css"` at the app root.

## Wiring diagram

```
const nodeTypes = { brand: FlowNode };   // register ONCE, module scope
const edgeTypes = { brand: FlowEdge };
const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
const selected = nodes.find((n) => n.selected);

flex row (h-full)
├── CanvasShell {nodes edges nodeTypes edgeTypes
│                onNodesChange onEdgesChange
│                onConnect={(c) => setEdges((e) => addEdge({ ...c, type: "brand" }, e))}}
│   └── ZoomControls · Legend
└── InspectorPanel hasSelection={!!selected} selectionKey={selected?.id}
    └── type-specific fields editing selected.data
```

Selection needs no extra wiring: React Flow sets `node.selected`;
`onNodesChange` keeps it in your state; derive `selected` from `nodes`.
`selectionKey` makes the panel replay its fade per node.

## Node taxonomy

Each node: `{ id, type: "brand", position, data }` with
`data: { kind?, title, subtitle?, tone? }`,
`tone ∈ default | accent | success | warning | destructive`.

Pick **one tone per category** and keep it stable — e.g. sources `accent`,
transforms `default`, destinations `success`, invalid `destructive` — and
mirror it in a `Legend` on the canvas. Custom node types beyond that: add a
second entry to `nodeTypes` with your own component composed from `FlowNode`'s
conventions, not a restyled raw RF node.

## Inspector editing

```tsx
function updateSelected(patch: Partial<FlowNodeData>) {
  setNodes((ns) => ns.map((n) => (n.selected ? { ...n, data: { ...n.data, ...patch } } : n)));
}
<InspectorPanel title="Node properties" hasSelection={!!selected} selectionKey={selected?.id}>
  <Label htmlFor="node-name">Name</Label>
  <Input
    id="node-name"
    value={selected?.data.title ?? ""}
    onChange={(e) => updateSelected({ title: e.target.value })}
  />
</InspectorPanel>;
```

## Decisions you own

Node categories + tone mapping · inspector fields per node type · editable
vs. read-only (`nodesDraggable={false} nodesConnectable={false}`) · theme
(blueprint suits this archetype; verify grid layering on a real screen).

## Decisions already made — don't re-make

Canvas background/grid (CanvasShell, token-driven) · node/edge visuals
(`FlowNode`/`FlowEdge` variants) · zoom UI (`ZoomControls`) · inspector
frame + empty state (`InspectorPanel`).

## Common mistakes

- Defining `nodeTypes` inside the component body — React Flow re-mounts every
  node each render; keep it module-scope.
- Forgetting `type: "brand"` on nodes/edges — you silently get unstyled RF
  defaults.
- Reaching for `@brand/ai`'s Canvas for an app workspace.
- Syncing selection into separate state with `useEffect` — derive it from
  `nodes` instead.
