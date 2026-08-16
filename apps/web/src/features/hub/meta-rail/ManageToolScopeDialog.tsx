import { useEffect, useRef, useState } from "react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Spinner,
  Text,
  toast,
} from "@brand/ui";
import type { HubToolGrants } from "@mcp-token-footprint/shared";
import { updateHubSession } from "../../../lib/api";
import { getErrorMessage } from "../../../lib/errors";
import { SegmentedField } from "../../../components/form/SegmentedField";
import { ToolGrantPicker } from "../agents/ToolGrantPicker";

const EMPTY_TOOL_GRANTS: HubToolGrants = { servers: {}, builtins: [] };

export type ManageToolScopeDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sessionId: string;
  /** The session's CURRENTLY persisted scope — `null` ⇒ auto (every reachable server). Seeds the form
   *  once per open, mirroring `NewSessionDialog`'s own reset-per-open pattern. */
  initialScope: HubToolGrants | null;
  /** Fired after a successful PATCH, before the dialog closes — best-effort notification so the
   *  caller can refresh whatever it derives from the session's scope. The PATCH itself has already
   *  succeeded regardless of what this callback does. */
  onSaved?: () => void;
};

/**
 * Assistant Hub (hub-fixes WP1.2, RC3 — kills the "write-once" trap) — edit an EXISTING session's MCP
 * tool scope. Reuses `ToolGrantPicker` + the Auto/Scoped `SegmentedField` toggle verbatim from
 * `NewSessionDialog`'s "MCP & tools" tab (same picker, same copy) so create-time and edit-time scoping
 * look and behave identically — the only difference is this dialog PATCHes an existing session
 * (`PATCH /api/hub/sessions/:id` with the new additive `toolScope` field) instead of seeding a
 * `POST .../sessions` body.
 *
 * Self-contained like `SessionSkillsPanel`/`AddHubSkillModal`: it owns its own write (no parent-side
 * PATCH-then-restore dance) and reports success via `onSaved`, not by handing back the updated
 * session — the caller already knows the sessionId and can re-fetch whatever view it needs.
 */
export function ManageToolScopeDialog({
  open,
  onOpenChange,
  sessionId,
  initialScope,
  onSaved,
}: ManageToolScopeDialogProps) {
  const [access, setAccess] = useState<"auto" | "scoped">(initialScope ? "scoped" : "auto");
  const [scope, setScope] = useState<HubToolGrants>(initialScope ?? EMPTY_TOOL_GRANTS);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset to the session's current scope exactly once per open (mirrors `NewSessionDialog`'s
  // `openedRef` pattern) — a stale in-progress edit never leaks into the next time this opens.
  const openedRef = useRef(false);
  useEffect(() => {
    if (open && !openedRef.current) {
      openedRef.current = true;
      setAccess(initialScope ? "scoped" : "auto");
      setScope(initialScope ?? EMPTY_TOOL_GRANTS);
      setSaving(false);
      setError(null);
      return;
    }
    if (!open) openedRef.current = false;
  }, [open, initialScope]);

  const handleSave = async (): Promise<void> => {
    setSaving(true);
    setError(null);
    try {
      await updateHubSession(sessionId, { toolScope: access === "scoped" ? scope : null });
      toast.success(access === "scoped" ? "Tool scope updated" : "Tool scope reset to auto");
      onSaved?.();
      onOpenChange(false);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (saving ? undefined : onOpenChange(next))}>
      <DialogContent size="lg" className="flex max-h-[85vh] flex-col gap-0 p-0">
        <DialogHeader className="flex-none gap-1 border-b border-border p-4 pe-12">
          <DialogTitle>Manage tool scope</DialogTitle>
          <DialogDescription>
            Auto grants every reachable MCP server — the assistant searches for the right tools from
            your prompt. Scoped grants only the servers and tools you pick below; the assistant sees
            nothing else.
          </DialogDescription>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
          <SegmentedField
            id="hub-manage-tool-scope-access"
            label="MCP tools"
            value={access}
            onChange={(value) => setAccess(value as "auto" | "scoped")}
            disabled={saving}
            options={[
              { value: "auto", label: "Auto" },
              { value: "scoped", label: "Scoped" },
            ]}
            help={
              access === "auto"
                ? "Every reachable MCP server is available; the assistant searches for the right tools from your prompt."
                : "Grant only the servers and tools you pick below."
            }
          />
          {access === "scoped" ? (
            <ToolGrantPicker
              idPrefix="hub-manage-tool-scope"
              value={scope}
              onChange={setScope}
              disabled={saving}
            />
          ) : null}
        </div>

        <DialogFooter className="flex-none border-t border-border p-4">
          {error ? (
            <Text variant="caption" className="text-destructive" role="alert">
              {error}
            </Text>
          ) : null}
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button type="button" onClick={() => void handleSave()} disabled={saving}>
            {saving ? <Spinner className="size-4" aria-hidden /> : null}
            <span>Save</span>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
