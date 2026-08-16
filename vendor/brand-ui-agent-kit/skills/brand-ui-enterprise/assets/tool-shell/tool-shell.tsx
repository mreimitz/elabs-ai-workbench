"use client";
/**
 * Archetype A — tool/workspace shell. Inset collapsible sidebar (navigator) + routed
 * content + status bar, an optional right inspector pane, a ⌘K command palette, and
 * focus mode (⌘.). Generalized from a qLabs tool/workspace app's app frame.
 *
 * Mount under <UiStateProvider> (ui-state.tsx). Provide your own `sidebar` — typically a
 * <Sidebar variant="inset" collapsible="icon"> with a collapsible <BrandLogo/> header
 * (see assets/app-shell.tsx §header for the lockup↔mark swap). Verify props with
 * `brand-ui docs`.
 *
 * Keyboard: ⌘K palette · ⌘\ navigator · ⌘I inspector · ⌘. focus mode.
 */
import { useEffect, type ReactNode } from "react";
import { SidebarInset, SidebarProvider } from "@brand/ui";
import { useUiState } from "./ui-state";
import { StatusBar } from "./status-bar";
import { CommandPalette, type PaletteCommand } from "./command-palette";

export function ToolShell({
  sidebar,
  inspector,
  commands,
  status,
  children,
}: {
  /** Your navigator, e.g. a <Sidebar variant="inset" collapsible="icon">…</Sidebar>. */
  sidebar: ReactNode;
  /** Right-pane content; shown when the inspector is open (⌘I). */
  inspector?: ReactNode;
  /** ⌘K palette entries. */
  commands: PaletteCommand[];
  /** Status-bar slots. */
  status?: { left?: ReactNode; right?: ReactNode };
  /** The main work surface. */
  children: ReactNode;
}) {
  const {
    navigatorOpen,
    toggleNavigator,
    inspectorOpen,
    toggleInspector,
    setPaletteOpen,
    toggleFocus,
  } = useUiState();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      if (e.key === "k") {
        e.preventDefault();
        setPaletteOpen(true);
      } else if (e.key === "\\") {
        e.preventDefault();
        toggleNavigator();
      } else if (e.key === "i" && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        toggleInspector();
      } else if (e.key === "." && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        toggleFocus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setPaletteOpen, toggleNavigator, toggleInspector, toggleFocus]);

  return (
    <SidebarProvider open={navigatorOpen} onOpenChange={toggleNavigator}>
      {sidebar}
      <SidebarInset className="flex h-[calc(100svh-1rem)] min-w-0 flex-col overflow-hidden">
        <div className="flex min-h-0 flex-1">
          <main className="min-w-0 flex-1 overflow-auto">{children}</main>
          {inspector && inspectorOpen ? (
            <aside
              aria-label="Inspector"
              className="hidden w-80 shrink-0 overflow-y-auto border-l border-border bg-sidebar lg:block"
            >
              {inspector}
            </aside>
          ) : null}
        </div>
        <StatusBar left={status?.left} right={status?.right} />
      </SidebarInset>
      <CommandPalette commands={commands} />
    </SidebarProvider>
  );
}
