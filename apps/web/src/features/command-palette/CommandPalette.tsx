import { useCallback, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
  DialogDescription,
  DialogTitle,
} from "@elabs-ai/components-ui";
import {
  Folder,
  type LucideIcon,
  Monitor,
  Moon,
  PlayCircle,
  Plus,
  ScanLine,
  Server,
  Settings,
  Sparkles,
  Sun,
} from "lucide-react";
import type { Collection, ScanSummary, ServerConfig, Skill } from "@mcp-token-footprint/shared";
import {
  ASSISTANT_NAV_ITEMS,
  MCP_NAV_ITEMS,
  NAV_ITEMS,
  SETUP_NAV_ITEMS,
  SKILL_NAV_ITEMS,
  TESTING_NAV_ITEMS,
} from "../../components/AppShell";
import type { ThemePreference } from "../../lib/theme";
import { formatDateTime, formatNumber } from "../../lib/format";

/** How many of the most-recent scans to surface (the full history lives in the Scans view). */
const RECENT_SCAN_LIMIT = 8;

export type CommandPaletteProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Live app data the palette searches over (all small lists refreshed with everything else). */
  servers: ServerConfig[];
  scans: ScanSummary[];
  skills: Skill[];
  collections: Collection[];
  /** Theme controls, so "Switch theme" is a runnable command like anything else. */
  themePreference: ThemePreference;
  onThemePreferenceChange: (preference: ThemePreference) => void;
  /** App-owned create flows (the palette can only *trigger* them — it owns no wizard state). */
  onAddServer: () => void;
  onAddSkill: () => void;
};

/**
 * The ⌘K / Ctrl+K global command palette — one keyboard-first surface to jump to any page, any
 * server / skill / collection / recent scan, or run a top-level action, without leaving the keyboard.
 *
 * Built on `@elabs-ai/components-ui`'s cmdk-based `Command*` family (the design system's own command primitive):
 * `CommandDialog` is a modal `Dialog` wrapping a `Command` listbox, `CommandInput` is the search box,
 * and cmdk does the fuzzy filtering client-side over each item's `value` + `keywords`. Item `value`s
 * are stable, unique slugs (so cmdk never conflates two same-named entities) while every searchable
 * term lives in `keywords`; the visible label is free to be short.
 *
 * Navigation is self-contained (`useNavigate` — the palette is mounted inside the Router), so App
 * only wires it the data + the two create flows it can't own itself. Selecting anything closes the
 * palette first, then acts (`runCommand`), so a navigation never races the closing animation.
 */
export function CommandPalette({
  open,
  onOpenChange,
  servers,
  scans,
  skills,
  collections,
  themePreference,
  onThemePreferenceChange,
  onAddServer,
  onAddSkill,
}: CommandPaletteProps) {
  const navigate = useNavigate();

  // Global ⌘K / Ctrl+K toggles the palette from anywhere. `preventDefault` reclaims the browser's own
  // ⌘K (focus-search) binding — the expected trade for a command palette. Mirrors the Assistant's ⌘J.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        onOpenChange(!open);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onOpenChange]);

  // Close first, then act — so navigation/state changes don't fight the dialog's exit transition.
  const runCommand = useCallback(
    (action: () => void) => {
      onOpenChange(false);
      action();
    },
    [onOpenChange],
  );

  const sortedServers = [...servers].sort((a, b) => a.name.localeCompare(b.name));
  const sortedSkills = [...skills].sort((a, b) => a.displayName.localeCompare(b.displayName));
  const sortedCollections = [...collections].sort((a, b) => a.name.localeCompare(b.name));
  const recentScans = [...scans]
    .sort((a, b) => Date.parse(b.scannedAt) - Date.parse(a.scannedAt))
    .slice(0, RECENT_SCAN_LIMIT);

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      {/* Radix a11y: the modal needs an accessible name + description. Both are visually hidden —
          the CommandInput is the real, visible affordance. */}
      <DialogTitle className="sr-only">Command palette</DialogTitle>
      <DialogDescription className="sr-only">
        Search for a page, server, skill, collection, or recent scan, or run a command.
      </DialogDescription>
      <CommandInput placeholder="Search or jump to…" />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>

        <CommandGroup heading="Actions">
          <PaletteItem
            value="action-add-server"
            keywords={["add", "new", "create", "server", "mcp", "connect"]}
            icon={Plus}
            label="Add MCP server"
            onSelect={() => runCommand(onAddServer)}
          />
          <PaletteItem
            value="action-add-skill"
            keywords={["add", "new", "create", "skill", "register", "upload", "import"]}
            icon={Plus}
            label="Add skill"
            onSelect={() => runCommand(onAddSkill)}
          />
          <PaletteItem
            value="action-new-run"
            keywords={["new", "run", "test", "start", "launch", "agent"]}
            icon={PlayCircle}
            label="New test run"
            // A-2 (toolbar-reach WP0.2) — open the real run launcher on the runs feed (`?launch=1`,
            // consumed by `RunsView`) rather than the bare `/testing/runs/new` route, which had no
            // zero-param entry and dead-ended on a "Run unavailable" ErrorState.
            onSelect={() => runCommand(() => navigate("/testing/runs?launch=1"))}
          />
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading="Go to">
          {NAV_DESTINATIONS.map((dest) => (
            <PaletteItem
              key={dest.path}
              value={`goto-${dest.path}`}
              keywords={[dest.label, ...(dest.keywords ?? [])]}
              icon={dest.icon}
              label={dest.label}
              onSelect={() => runCommand(() => navigate(dest.path))}
            />
          ))}
        </CommandGroup>

        {sortedServers.length > 0 ? (
          <>
            <CommandSeparator />
            <CommandGroup heading="MCP Servers">
              {sortedServers.map((server) => (
                <PaletteItem
                  key={server.id}
                  value={`server-${server.id}`}
                  keywords={[server.name, "server", "mcp", server.transport]}
                  icon={Server}
                  label={server.name}
                  meta={server.transport === "streamable_http" ? "HTTP" : "stdio"}
                  onSelect={() => runCommand(() => navigate(`/servers/${server.id}`))}
                />
              ))}
            </CommandGroup>
          </>
        ) : null}

        {sortedSkills.length > 0 ? (
          <>
            <CommandSeparator />
            <CommandGroup heading="Skills">
              {sortedSkills.map((skill) => (
                <PaletteItem
                  key={skill.id}
                  value={`skill-${skill.id}`}
                  keywords={[skill.displayName, skill.name, skill.slug, "skill"]}
                  icon={Sparkles}
                  label={skill.displayName}
                  meta={skill.versionCount > 0 ? `v${skill.versionCount}` : undefined}
                  onSelect={() => runCommand(() => navigate(`/skills/${skill.id}`))}
                />
              ))}
            </CommandGroup>
          </>
        ) : null}

        {sortedCollections.length > 0 ? (
          <>
            <CommandSeparator />
            <CommandGroup heading="Collections">
              {sortedCollections.map((collection) => (
                <PaletteItem
                  key={collection.id}
                  value={`collection-${collection.id}`}
                  keywords={[
                    collection.name,
                    "collection",
                    collection.isDefault ? "local default" : "",
                  ]}
                  icon={Folder}
                  label={collection.name}
                  meta={collection.isDefault ? "Local" : undefined}
                  onSelect={() =>
                    runCommand(() => navigate(`/testing/collections/${collection.id}`))
                  }
                />
              ))}
            </CommandGroup>
          </>
        ) : null}

        {recentScans.length > 0 ? (
          <>
            <CommandSeparator />
            <CommandGroup heading="Recent scans">
              {recentScans.map((scan) => (
                <PaletteItem
                  key={scan.id}
                  value={`scan-${scan.id}`}
                  keywords={[scan.serverName, "scan", "history"]}
                  icon={ScanLine}
                  label={scan.serverName}
                  meta={`${formatNumber(scan.totalTokens)} tok · ${formatDateTime(scan.scannedAt)}`}
                  onSelect={() => runCommand(() => navigate(`/scans/${scan.id}`))}
                />
              ))}
            </CommandGroup>
          </>
        ) : null}

        <CommandSeparator />

        <CommandGroup heading="Theme">
          {THEME_COMMANDS.map((choice) => (
            <PaletteItem
              key={choice.preference}
              value={`theme-${choice.preference}`}
              keywords={["theme", "appearance", ...choice.keywords]}
              icon={choice.icon}
              label={choice.label}
              meta={themePreference === choice.preference ? "Current" : undefined}
              onSelect={() =>
                runCommand(() => onThemePreferenceChange(choice.preference))
              }
            />
          ))}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}

/** One palette row: an icon + label on the left, an optional muted meta chip on the right. */
function PaletteItem({
  value,
  keywords,
  icon: Icon,
  label,
  meta,
  onSelect,
}: {
  value: string;
  keywords: string[];
  icon: LucideIcon;
  label: string;
  meta?: string;
  onSelect: () => void;
}) {
  return (
    <CommandItem
      value={value}
      // cmdk matches the search against value + keywords (not the rendered label, since `value` is a
      // slug), so every human term the user might type lives here. Empty strings are harmless.
      keywords={keywords.filter(Boolean)}
      onSelect={onSelect}
      className="gap-2"
    >
      <Icon aria-hidden className="size-4 shrink-0" />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {meta ? <CommandShortcut className="tabular-nums">{meta}</CommandShortcut> : null}
    </CommandItem>
  );
}

type NavDestination = { path: string; label: string; icon: LucideIcon; keywords?: string[] };

/**
 * Fuzzy-search keywords per destination path — the terms the visible label doesn't carry. Kept as a
 * small augmentation map (NOT inlined into the shared nav arrays) so the palette can enrich each
 * derived destination without the nav definition needing to know about search. A path with no entry
 * simply carries no extra keywords; the label itself is always searchable.
 */
const NAV_KEYWORDS: Record<string, string[]> = {
  "/dashboard": ["home", "overview"],
  "/assistant": ["chat", "agent", "workspace", "hub"],
  "/assistant/sessions": ["history", "conversations", "threads"],
  "/assistant/agents": ["crews", "roles", "workforce", "org chart"],
  "/assistant/projects": ["workspace", "pinned context"],
  "/assistant/audit": ["log", "timeline", "activity"],
  "/servers": ["mcp", "connections"],
  "/scans": ["history", "tokens", "footprint"],
  "/compare/scans": ["diff", "delta"],
  "/skills": ["registry", "agent skills"],
  "/testing/collections": ["tests", "suites"],
  "/testing/runs": ["results", "sessions"],
  "/testing/compatibility": ["heatmap", "matrix", "models", "limits"],
  "/testing/environments": ["scenarios", "setup"],
  "/settings": ["preferences", "config"],
};

/** Settings is a real, reachable destination that lives in the shell FOOTER, not in a nav group — so
 *  it is appended explicitly after the nav-derived list (it is the one destination not in an array). */
const SETTINGS_DESTINATION: NavDestination = {
  path: "/settings",
  label: "Settings",
  icon: Settings,
  keywords: NAV_KEYWORDS["/settings"],
};

/** The nav groups exported by `AppShell`, in sidebar order. The Assistant group carries a nested
 *  `children` entry (Sessions) which the derivation flattens in place. */
const NAV_GROUPS = [
  NAV_ITEMS,
  ASSISTANT_NAV_ITEMS,
  MCP_NAV_ITEMS,
  SKILL_NAV_ITEMS,
  TESTING_NAV_ITEMS,
  SETUP_NAV_ITEMS,
];

/** One AppShell nav item (structural — `NavItem` isn't exported; derive its shape from the arrays). */
type NavArrayItem = (typeof NAV_ITEMS)[number];

/**
 * Every reachable top-level destination, DERIVED from AppShell's exported nav arrays (children — only
 * Assistant → Sessions today — flattened in place) plus Settings from the shell footer. Each item's
 * icon + label come straight from the nav definition, so a nav change flows into the palette
 * automatically and the two can never drift; the `palette-nav-parity` guardrail asserts that invariant.
 * Exported so the guardrail can check palette ⊇ nav without rendering the component.
 */
export function buildNavDestinations(): NavDestination[] {
  const out: NavDestination[] = [];
  const visit = (item: NavArrayItem): void => {
    out.push({
      path: item.path,
      label: item.label,
      icon: item.icon,
      keywords: NAV_KEYWORDS[item.path],
    });
    for (const child of item.children ?? []) visit(child);
  };
  for (const group of NAV_GROUPS) for (const item of group) visit(item);
  out.push(SETTINGS_DESTINATION);
  return out;
}

/** The rendered "Go to" list — computed once from the exported nav arrays (static at module load). */
const NAV_DESTINATIONS: NavDestination[] = buildNavDestinations();

type ThemeCommand = {
  preference: ThemePreference;
  label: string;
  icon: LucideIcon;
  keywords: string[];
};

/** The three theme preferences as runnable commands (System first — matches THEME_PREFERENCE_ORDER). */
const THEME_COMMANDS: ThemeCommand[] = [
  { preference: "system", label: "Use system theme", icon: Monitor, keywords: ["system", "auto", "os"] },
  { preference: "light", label: "Switch to Light theme", icon: Sun, keywords: ["light", "bright", "day"] },
  { preference: "dark", label: "Switch to Dark theme", icon: Moon, keywords: ["dark", "night"] },
];
