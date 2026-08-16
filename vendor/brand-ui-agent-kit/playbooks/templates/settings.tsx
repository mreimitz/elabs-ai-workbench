/* GENERATED from packages/ui/src/templates-settings.stories.tsx by pnpm gen:templates — do not edit. */
/* Full-screen settings template (single source of truth: the Storybook story). */

/**
 * Settings template — the canonical full-screen settings composition
 * (app-shell + Descriptions + Wizard). This story is the single source of
 * truth: `pnpm gen:templates` derives the consumer template source
 * (`docs/playbooks/templates/settings.tsx`) from it.
 * Verify across all three themes with globals=theme:<slug>.
 */
import { useState } from "react";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Descriptions,
  DescriptionsItem,
  Input,
  Label,
  Separator,
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
  Wizard,
  WizardNav,
  WizardStep,
  WizardSteps,
  type WizardStepMeta,
} from "@brand/ui";
import { Bell, Home, Shield, User } from "lucide-react";

const WIZARD_STEPS: WizardStepMeta[] = [
  { id: "profile", title: "Profile", description: "Your details" },
  { id: "notifications", title: "Notifications", description: "Alert prefs" },
  { id: "confirm", title: "Confirm", description: "Review & finish" },
];

const nav = [
  { id: "profile", label: "Profile", icon: User },
  { id: "notifications", label: "Notifications", icon: Bell },
  { id: "security", label: "Security", icon: Shield },
  { id: "home", label: "Home", icon: Home },
];

function ProfileView() {
  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Your profile</CardTitle>
          <CardDescription>Visible to other members of your workspace.</CardDescription>
        </CardHeader>
        <CardContent>
          <Descriptions columns={2} layout="vertical">
            <DescriptionsItem label="Full name">Alex Johnson</DescriptionsItem>
            <DescriptionsItem label="Email">alex@example.com</DescriptionsItem>
            <DescriptionsItem label="Role">Admin</DescriptionsItem>
            <DescriptionsItem label="Member since">Jan 2024</DescriptionsItem>
          </Descriptions>
        </CardContent>
      </Card>
      <Separator />
      <Card>
        <CardHeader>
          <CardTitle>Setup wizard</CardTitle>
          <CardDescription>
            Complete the steps below to finish configuring your account.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Wizard steps={WIZARD_STEPS} defaultStep={0} className="flex flex-col gap-6">
            <WizardSteps />
            <WizardStep step={0}>
              <div className="flex flex-col gap-4">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="display-name">Display name</Label>
                  <Input id="display-name" defaultValue="Alex Johnson" autoComplete="name" />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="job-title">Job title</Label>
                  <Input
                    id="job-title"
                    placeholder="e.g. Data Engineer"
                    autoComplete="organization-title"
                  />
                </div>
              </div>
            </WizardStep>
            <WizardStep step={1}>
              <div className="flex flex-col gap-4">
                <p className="text-body text-muted-foreground">
                  Choose which notifications you&apos;d like to receive.
                </p>
                <div className="flex flex-col gap-2 text-body">
                  {["Alerts & incidents", "Weekly digests", "Product updates"].map((item) => (
                    <label key={item} className="flex cursor-pointer items-center gap-2">
                      <input type="checkbox" defaultChecked className="accent-primary" />
                      <span>{item}</span>
                    </label>
                  ))}
                </div>
              </div>
            </WizardStep>
            <WizardStep step={2}>
              <div className="flex flex-col gap-3">
                <p className="text-body text-muted-foreground">
                  Your account is ready. Review your settings and click Finish.
                </p>
                <Descriptions layout="vertical">
                  <DescriptionsItem label="Display name">Alex Johnson</DescriptionsItem>
                  <DescriptionsItem label="Notifications">Alerts, Digests</DescriptionsItem>
                </Descriptions>
              </div>
            </WizardStep>
            <WizardNav finishLabel="Finish setup" />
          </Wizard>
        </CardContent>
      </Card>
    </div>
  );
}

function NotificationsView() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Notification preferences</CardTitle>
        <CardDescription>Control how and when you receive alerts.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 text-body">
        {[
          { label: "Alerts & incidents", checked: true },
          { label: "Weekly digest", checked: true },
          { label: "Product updates", checked: false },
          { label: "Marketing emails", checked: false },
        ].map((item) => (
          <label key={item.label} className="flex cursor-pointer items-center gap-2">
            <input type="checkbox" defaultChecked={item.checked} className="accent-primary" />
            <span>{item.label}</span>
          </label>
        ))}
        <div className="mt-2">
          <Button size="sm">Save preferences</Button>
        </div>
      </CardContent>
    </Card>
  );
}

function SecurityView() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Security</CardTitle>
        <CardDescription>Manage your password and two-factor authentication.</CardDescription>
      </CardHeader>
      <CardContent>
        <Descriptions layout="vertical">
          <DescriptionsItem label="Password">Last changed 3 months ago</DescriptionsItem>
          <DescriptionsItem label="Two-factor auth">Enabled (Authenticator app)</DescriptionsItem>
          <DescriptionsItem label="Active sessions" numeric>
            2
          </DescriptionsItem>
        </Descriptions>
        <div className="mt-4 flex gap-2">
          <Button variant="outline" size="sm">
            Change password
          </Button>
          <Button variant="outline" size="sm">
            Manage 2FA
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function SettingsTemplate() {
  const [active, setActive] = useState("profile");

  const views: Record<string, React.ReactNode> = {
    profile: <ProfileView />,
    notifications: <NotificationsView />,
    security: <SecurityView />,
    home: (
      <p className="text-body text-muted-foreground">
        Navigate to a settings section using the sidebar.
      </p>
    ),
  };

  return (
    <SidebarProvider>
      <Sidebar collapsible="icon">
        <SidebarHeader className="px-3 py-2 font-semibold">Settings</SidebarHeader>
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
        <main className="max-w-2xl p-6">{views[active]}</main>
      </SidebarInset>
    </SidebarProvider>
  );
}
