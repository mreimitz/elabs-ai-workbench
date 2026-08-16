import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Button,
} from "@brand/ui";
import { ScopedMemoryList } from "./ScopedMemoryList";

/**
 * Assistant Hub UX WP2.7 (D-HUX11, §7.5) — the PROFILE memory manage dialog: global memory (facts about
 * the owner + standing instructions injected into EVERY conversation), reachable from the workspace
 * Context section's "Memory · manage" affordance and, per P3, the `/assistant/memory` redirect's final
 * landing spot (`/assistant?memory=profile` — the redirect itself is WP3.1's wiring; this dialog opening
 * off that same query param is `AssistantView`'s doing).
 *
 * A thin composition (mirrors `SessionSkillsPanel.tsx`'s plain `Dialog`/`DialogContent` browse-surface
 * shape — a live-persisting list dialog has no batch "Save" step, so none of the four named modal tiers
 * fit: `ConfirmDialog` has no fields, `FormDialog`/`WideDialog` assume one submit action, `WorkbenchDialog`
 * is a full-overlay working surface). All the actual list/CRUD behavior lives in `ScopedMemoryList`.
 */
export function ProfileMemoryDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg" className="flex max-h-[85vh] flex-col gap-0 p-0">
        <DialogHeader className="flex-none gap-1 border-b border-border p-4 pe-12">
          <DialogTitle>Profile memory</DialogTitle>
          <DialogDescription>
            Facts and standing instructions injected into every conversation — nothing here is hidden,
            and the assistant can only propose additions, never save them silently.
          </DialogDescription>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
          <ScopedMemoryList scope="profile" />
        </div>

        <DialogFooter className="flex-none border-t border-border p-4">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
