"use client";
/**
 * A thin status bar docked at the bottom of the work surface (tool-shell signature).
 * Pass ambient state into `left` / `right`. Numbers get `tabular-nums` so they don't
 * jitter. Token-styled; reads in every theme.
 */
import type { ReactNode } from "react";

export function StatusBar({ left, right }: { left?: ReactNode; right?: ReactNode }) {
  return (
    <footer
      role="status"
      aria-live="polite"
      className="flex h-6 shrink-0 items-center justify-between border-t border-border bg-background px-3 text-meta text-muted-foreground"
    >
      <div className="flex min-w-0 items-center gap-3 truncate">{left}</div>
      <div className="flex items-center gap-3 tabular-nums">{right}</div>
    </footer>
  );
}
