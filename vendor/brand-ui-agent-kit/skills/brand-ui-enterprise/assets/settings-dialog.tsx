"use client";
/**
 * Settings as a modal (the baseline default — keeps the user on their work surface).
 * Grounded in a qLabs tool/workspace app's settings dialog.
 *
 * Controlled here via open/onOpenChange. For a deep-linkable, reload-surviving
 * variant (?settings=1) see the comment at the bottom.
 */
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Label,
  Separator,
} from "@brand/ui";
import { ThemeSwitcher } from "./theme-switcher";

export function SettingsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-md overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>Appearance and preferences for this device.</DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <section aria-label="Appearance" className="space-y-2">
            <Label className="text-muted-foreground">Theme</Label>
            <ThemeSwitcher />
          </section>
          <Separator />
          {/* Add sections here (Notifications, Account, …). Destructive actions go in
              an <AlertDialog/> with a named consequence — never destructive-on-click. */}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/*
 * Optional — deep-linkable settings (open via ?settings=1; shareable, survives reload).
 * With react-router:
 *
 *   import { useSearchParams } from "react-router";
 *   export function useSettingsDialog() {
 *     const [sp, setSp] = useSearchParams();
 *     return {
 *       open: sp.get("settings") === "1",
 *       setOpen: (o: boolean) =>
 *         setSp((prev) => {
 *           const next = new URLSearchParams(prev);
 *           if (o) next.set("settings", "1");
 *           else next.delete("settings");
 *           return next;
 *         }, { replace: true }),
 *     };
 *   }
 */
