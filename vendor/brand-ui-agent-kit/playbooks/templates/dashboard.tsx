/* GENERATED from packages/charts/src/templates-dashboard.stories.tsx by pnpm gen:templates — do not edit. */
/* Full-screen dashboard template (single source of truth: the Storybook story). */

/**
 * Dashboard template — the canonical full-screen dashboard composition
 * (app-shell + MetricGrid + MetricCard). This story is the single source of
 * truth: `pnpm gen:templates` derives the consumer template source
 * (`docs/playbooks/templates/dashboard.tsx`) from it.
 * Verify across all three themes with globals=theme:<slug>.
 */
import { useState } from "react";
import {
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
  MetricCard,
} from "@brand/ui";
import { AppIcon } from "@brand/icons";
import { MetricGrid } from "@brand/charts";
import { BarChart3, Home, Settings, Users } from "lucide-react";

const nav = [
  { id: "overview", label: "Overview", icon: Home },
  { id: "analytics", label: "Analytics", icon: BarChart3 },
  { id: "users", label: "Users", icon: Users },
  { id: "settings", label: "Settings", icon: Settings },
];

const metrics = [
  {
    label: "Monthly Revenue",
    value: "$124,500",
    delta: "+8.2%",
    deltaDirection: "up" as const,
    description: "vs. prior month",
  },
  {
    label: "Active Users",
    value: "3,842",
    delta: "+3.1%",
    deltaDirection: "up" as const,
    description: "30-day active",
  },
  {
    label: "Avg. Session",
    value: "4m 32s",
    delta: "-0.4%",
    deltaDirection: "down" as const,
    positiveIsGood: false,
    description: "last 7 days",
  },
  {
    label: "Open Issues",
    value: "12",
    delta: "-25%",
    deltaDirection: "down" as const,
    positiveIsGood: false,
    description: "vs. last week",
  },
];

function DashboardTemplate() {
  const [active, setActive] = useState("overview");
  return (
    <SidebarProvider>
      <Sidebar collapsible="icon">
        <SidebarHeader className="px-3 py-2">
          <div className="flex items-center gap-2">
            <AppIcon height={20} aria-hidden />
            <span className="truncate font-semibold group-data-[collapsible=icon]:hidden">
              Analytics
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
                      <n.icon aria-hidden="true" />
                      <span>{n.label}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
      </Sidebar>
      <SidebarInset>
        <header className="flex h-14 items-center gap-2 border-b px-4">
          <SidebarTrigger />
          <h1 className="text-body font-medium capitalize">{active}</h1>
        </header>
        <main className="flex flex-col gap-6 p-6">
          <section aria-label="Key metrics">
            <MetricGrid columns={4}>
              {metrics.map((m) => (
                <MetricCard
                  key={m.label}
                  label={m.label}
                  value={m.value}
                  delta={m.delta}
                  deltaDirection={m.deltaDirection}
                  positiveIsGood={m.positiveIsGood ?? true}
                  description={m.description}
                />
              ))}
            </MetricGrid>
          </section>
          <section
            aria-label="Chart area"
            className="rounded-lg border bg-card p-4 text-body text-muted-foreground"
          >
            Add stat-card-area-01 or stat-card-line-01 blocks here.
          </section>
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}
