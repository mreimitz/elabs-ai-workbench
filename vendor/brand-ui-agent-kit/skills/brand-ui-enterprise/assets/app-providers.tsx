"use client";
/**
 * Root providers for an enterprise brand-ui app (baseline root wiring).
 * Order: Theme -> Tooltip -> Sidebar -> app; <Toaster/> mounted once.
 * Generalized from qlabs-workbench app-providers + the brand-ui baseline.
 * Verified against @brand/* v1.0.0 source. NOTE: the ContextPanel family is in
 * @brand/ai (not @brand/ui) and is AI-oriented — add <ContextPanelProvider> from
 * @brand/ai only for AI workspaces; generic detail uses a right Sheet/Drawer.
 */
import "@brand/tokens/styles.css";
import { ThemeProvider } from "@brand/tokens";
import { SidebarProvider, Toaster, TooltipProvider } from "@brand/ui";
import type { ReactNode } from "react";

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider defaultTheme="qlik-bright">
      <TooltipProvider delayDuration={300}>
        {/* AI workspaces also wrap children in <ContextPanelProvider> from @brand/ai. */}
        <SidebarProvider>{children}</SidebarProvider>
      </TooltipProvider>
      <Toaster />
    </ThemeProvider>
  );
}
