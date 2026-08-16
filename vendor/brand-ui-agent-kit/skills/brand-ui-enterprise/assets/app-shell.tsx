"use client";
/**
 * Enterprise-admin app shell (archetype B): collapsible icon sidebar with the
 * collapsible Qlik app icon + TopNav (breadcrumb + theme switcher + settings) + main,
 * with an optional secondary rail and room for the right-side ContextPanel.
 *
 * Grounded in mcp-token-footprint AppShell + qlabs-workbench sidebar/theme/settings.
 * Verify props with `brand-ui docs` (Sidebar, TopNav, ContextPanel, …). For archetype
 * A (tool/workspace) add a status bar, navigator/inspector panes, and a ⌘K palette.
 */
import { useState, type ReactNode } from "react";
import { AppIcon } from "@brand/icons";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  Button,
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
  TopNav,
} from "@brand/ui";
import { Settings, type LucideIcon } from "lucide-react";
import { ThemeSwitcher } from "./theme-switcher";
import { SettingsDialog } from "./settings-dialog";

export type NavItem = { key: string; label: string; icon: LucideIcon };

export function AppShell({
  title,
  navItems,
  activeKey,
  onNavigate,
  secondary,
  children,
}: {
  title: string;
  navItems: NavItem[];
  activeKey: string;
  onNavigate: (key: string) => void;
  /** Optional per-view master/list rail (the "secondary nav" type). */
  secondary?: ReactNode;
  children: ReactNode;
}) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const active = navItems.find((n) => n.key === activeKey);

  return (
    <SidebarProvider>
      <Sidebar collapsible="icon">
        <SidebarHeader>
          {/* The standard app icon: full lockup, morphs to the Q mark on collapse. */}
          <div className="flex items-center gap-2 px-2 py-1.5">
            <AppIcon height={20} aria-hidden />
            <span className="truncate font-semibold group-data-[collapsible=icon]:hidden">
              {title}
            </span>
          </div>
        </SidebarHeader>

        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu>
                {navItems.map((item) => {
                  const Icon = item.icon;
                  return (
                    <SidebarMenuItem key={item.key}>
                      <SidebarMenuButton
                        isActive={item.key === activeKey}
                        tooltip={item.label}
                        onClick={() => onNavigate(item.key)}
                      >
                        <Icon aria-hidden />
                        <span>{item.label}</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>

        <SidebarFooter>{/* AccountMenu / org switcher */}</SidebarFooter>
      </Sidebar>

      <SidebarInset>
        <TopNav
          className="h-14 border-b border-border px-3"
          start={
            <div className="flex items-center gap-2">
              <SidebarTrigger />
              <Breadcrumb>
                <BreadcrumbList>
                  <BreadcrumbItem>
                    <BreadcrumbPage>{active?.label ?? title}</BreadcrumbPage>
                  </BreadcrumbItem>
                </BreadcrumbList>
              </Breadcrumb>
            </div>
          }
          end={
            <div className="flex items-center gap-2">
              <ThemeSwitcher />
              <Button
                variant="ghost"
                size="icon"
                aria-label="Settings"
                onClick={() => setSettingsOpen(true)}
              >
                <Settings aria-hidden />
              </Button>
            </div>
          }
        />

        {secondary ? (
          <div className="flex min-h-0 flex-1">
            <aside className="hidden w-72 shrink-0 overflow-y-auto border-r border-border bg-sidebar md:block">
              {secondary}
            </aside>
            <main className="min-w-0 flex-1 overflow-y-auto p-6">{children}</main>
          </div>
        ) : (
          <main className="min-h-0 flex-1 overflow-y-auto p-6">{children}</main>
        )}
      </SidebarInset>

      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
      {/* Right-side detail panel: generic → a right <Sheet/> or <Drawer/> (@brand/ui,
          side="right") or an inspector <aside>. For an AI workspace use the ContextPanel
          family from @brand/ai (ContextPanelProvider + <ContextPanel/>). */}
    </SidebarProvider>
  );
}
