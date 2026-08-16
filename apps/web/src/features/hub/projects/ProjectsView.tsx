import { Heading } from "@brand/ui";
import { PageShell } from "../../../components/PageShell";
import { ViewToolbar } from "../../../components/ViewToolbar";
import { ProjectLibraryPanel } from "./ProjectLibraryPanel";

/**
 * Assistant Hub UX WP3.3 (D-HUX1, §7.4; reframed ui-wave U6, owner feedback) — the Projects view at
 * `/assistant/projects`: the project library (name, description, standing instructions, pinned
 * files, sessions, memory) that groups sessions and every member session inherits from. Mounted on
 * `PageShell scroll="fill"` exactly like the workforce section (§7.3's `WorkforceView.tsx`) — this
 * view has no tabs (a project has no sibling entity the way roles/crews do), so the fixed header
 * sits directly above the panel's own rail + detail frame, whose two columns own their own scroll
 * (U6 swapped the old resizable `SplitPane` for the workforce-style fixed w-72 rail — see
 * `ProjectLibraryPanel`'s class doc for why).
 *
 * Replaces the pre-Wave-3 `h-[46rem]` fixed-height frame (D-HUX1 finding) — `App.tsx` already mounts
 * `/assistant/projects` `fullBleed` (WP0.2), so `PageShell` is the only scroll owner here.
 */
export function ProjectsView() {
  return (
    <PageShell
      width="full"
      scroll="fill"
      headerVariant="toolbar"
      header={
        <ViewToolbar info="Group sessions and pin standing instructions + reference files every member session inherits." />
      }
    >
      <Heading level={1} className="sr-only">
        Projects
      </Heading>
      <ProjectLibraryPanel />
    </PageShell>
  );
}
