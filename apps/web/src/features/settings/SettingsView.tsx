import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type {
  AssistantAuthStatus,
  AssistantPruneResult,
  AvailableModel,
  DigestSchedule,
  DigestScheduleMode,
  DigestWindowKind,
  GithubAccountStatus,
  GithubDeviceStart,
  HealthPayload,
  JudgeSettings,
  MaintenanceResult,
  ModelPricingEntry,
  ModelPricingInput,
  ProviderCredential,
  ProviderCredentialInput,
  ProviderCredentialUpdate,
  ProviderKind,
  ResolvedJudgeSource,
  RunPruneResult,
  RunRetentionPolicy,
  ScanRetentionResult,
  TokenProfileId,
} from "@mcp-token-footprint/shared";
import {
  DIGEST_SCHEDULE_MODES,
  PROVIDER_KINDS,
  providerKindLabel,
  TOKEN_PROFILES,
} from "@mcp-token-footprint/shared";
import { THEME_META, useTheme } from "@elabs-ai/components-tokens";
import { getErrorMessage } from "../../lib/errors";
import { ConfirmDialog, FormDialog } from "../../components/dialogs";
import {
  DiscardChangesDialog,
  useUnsavedChangesGuard,
} from "../../components/UnsavedChangesGuard";
import { BoundedNumber, useDependentField } from "../../components/form";
import { IconButton } from "../../components/IconButton";
import { ClaudeSubscriptionAuthPanel } from "./ClaudeSubscriptionAuth";
import { THEME_PREFERENCE_ORDER, type ThemePreference } from "../../lib/theme";
import { useThemePreference } from "../../lib/use-theme-preference";
import { isKnownModel, modelsForKind } from "../testing/allow-list";
import {
  Alert,
  AlertDescription,
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Avatar,
  AvatarFallback,
  AvatarImage,
  Badge,
  Button,
  Combobox,
  Descriptions,
  DescriptionsItem,
  Dialog,
  DialogContent,
  DialogTitle,
  Heading,
  Input,
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  Label,
  NumberInput,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Separator,
  Spinner,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Text,
  Textarea,
  cn,
  toast,
} from "@elabs-ai/components-ui";
import {
  Bell,
  Bot,
  ClipboardCheck,
  Coins,
  Copy,
  Database,
  ExternalLink,
  Gavel,
  Github,
  HardDrive,
  Info,
  KeyRound,
  LogOut,
  MessageSquare,
  Pencil,
  Pin,
  Plus,
  Recycle,
  Search,
  Settings2,
  Sparkles,
  Timer,
  Trash2,
  X,
  type LucideIcon,
} from "lucide-react";
import {
  apiGet,
  apiPost,
  apiPut,
  createPricing,
  createProvider,
  deletePricing,
  deleteProvider,
  disconnectGithubAccount,
  generateDigest,
  getAssistantAuthStatus,
  getAssistantModels,
  getDigestSchedule,
  getGithubAccount,
  getJudgeSettings,
  listPricing,
  listProviderModels,
  listProviders,
  pollGithubDeviceFlow,
  updatePricing,
  putDigestSchedule,
  putJudgeSettings,
  setAssistantFallback,
  setGithubClientId,
  startGithubDeviceFlow,
  updateProvider,
} from "../../lib/api";
import { notifyError } from "../../lib/notify";

/* ─────────────────────────────────────────────────────────────────────────────────────────────
 * Settings — a structured, Claude-app-style MODAL (owner decision 2026-07-11, supersedes the
 * WP 1.2 "Settings as a first-class page" choice): a left rail with search + grouped section
 * nav, and one scrollable pane per section. `/settings/:section` stays a real, deep-linkable
 * URL — App.tsx renders this dialog OVER the last content view, so the user never leaves the
 * page they're on. Content mounts only while open (fetches run per open, not at app boot).
 * ──────────────────────────────────────────────────────────────────────────────────────────── */

const SETTINGS_SECTION_IDS = [
  "general",
  "testing",
  "providers",
  "pricing",
  "grading",
  "assistant",
  "github",
  "storage",
  "about",
] as const;
export type SettingsSectionId = (typeof SETTINGS_SECTION_IDS)[number];

export function isSettingsSectionId(value: string | null | undefined): value is SettingsSectionId {
  return value != null && (SETTINGS_SECTION_IDS as readonly string[]).includes(value);
}

type SectionDef = {
  id: SettingsSectionId;
  label: string;
  icon: LucideIcon;
  /** Rail-search terms beyond the label — the row labels/synonyms a user would type. */
  keywords: string[];
};

/** Grouped rail nav (the sub-menu structure). Order here is the rail order. */
const SECTION_GROUPS: { label: string; sections: SectionDef[] }[] = [
  {
    label: "App",
    sections: [
      {
        id: "general",
        label: "General",
        icon: Settings2,
        keywords: [
          "appearance",
          "density",
          "compact",
          "theme",
          "token profile",
          "tokenizer",
          "scanning",
          "defaults",
        ],
      },
      {
        id: "testing",
        label: "Testing",
        icon: Timer,
        keywords: [
          "run",
          "session",
          "timer",
          "stall",
          "wait budget",
          "wall cap",
          "duration",
          "concurrency",
          "subscription",
          "guardrail",
          "sessionclock",
        ],
      },
    ],
  },
  {
    label: "AI & providers",
    sections: [
      {
        id: "providers",
        label: "Providers",
        icon: KeyRound,
        keywords: [
          "credential",
          "api key",
          "anthropic",
          "openai",
          "google",
          "ollama",
          "base url",
          "model",
        ],
      },
      {
        id: "pricing",
        label: "Pricing",
        icon: Coins,
        keywords: [
          "cost",
          "price",
          "model pricing",
          "per token",
          "per 1m",
          "usd",
          "spend",
          "rate",
          "cache",
          "effective date",
        ],
      },
      {
        id: "grading",
        label: "Grading",
        icon: Gavel,
        keywords: ["judge", "grader", "rating", "llm", "cli", "quality", "benchmark"],
      },
      {
        id: "assistant",
        label: "Assistant",
        icon: Sparkles,
        keywords: [
          "claude",
          "sign in",
          "subscription",
          "oauth",
          "token",
          "fallback",
          "agent",
          "chat",
        ],
      },
      {
        id: "github",
        label: "GitHub",
        icon: Github,
        keywords: [
          "github",
          "sign in",
          "oauth",
          "device",
          "account",
          "pat",
          "token",
          "push",
          "pull request",
          "skills",
        ],
      },
    ],
  },
  {
    label: "System",
    sections: [
      {
        id: "storage",
        label: "Storage",
        icon: HardDrive,
        keywords: [
          "maintenance",
          "database",
          "sqlite",
          "vacuum",
          "checkpoint",
          "prune",
          "retention",
          "threads",
        ],
      },
      {
        id: "about",
        label: "About",
        icon: Info,
        keywords: [
          "version",
          "docker",
          "database path",
          "data directory",
          "runtime",
          "info",
          "health",
        ],
      },
    ],
  },
];

/* ─────────────────────────────────────────────────────────────────────────────────────────────
 * Explicit-save form registry (design-remediation T5, items 1 + 6).
 *
 * The three sections with hand-typed, save-required input — Grading (judge config), GitHub (OAuth
 * App client id), Storage (run-retention JSON policy) — used to silently DESTROY unsaved edits when
 * the operator switched section or closed the modal. Each such section now PUBLISHES its form to the
 * dialog via {@link useRegisterSettingsForm}. The dialog uses that to (a) intercept a section switch
 * or a close while `dirty` with a discard-guard prompt instead of losing the edit, and (b) render one
 * PERSISTENT footer action bar (Save · Discard · a saved/unsaved signal) — so the explicit-save
 * sections read structurally different from the immediate-apply ones (General), which publish nothing
 * and get no footer.
 * ──────────────────────────────────────────────────────────────────────────────────────────────── */

export type SettingsSectionForm = {
  /** Whether the section has edits not yet persisted. Drives the guard + the footer's Save/Discard. */
  dirty: boolean;
  /** Whether a save is currently in flight (footer buttons show busy / disable). */
  saving: boolean;
  /** Whether the current edit is savable (e.g. a required field is non-empty). */
  canSave: boolean;
  /** Persist the edit. */
  save: () => void;
  /** Revert the edit to the last-saved state (the footer's "Discard"). */
  reset: () => void;
  /** The footer Save button label (e.g. "Save default judge"). */
  saveLabel: string;
};

type SettingsFormRegistry = { register: (form: SettingsSectionForm | null) => void };
const SettingsFormContext = createContext<SettingsFormRegistry | null>(null);

/**
 * A settings SECTION publishes its explicit-save form to the enclosing dialog. Pass `null` while the
 * section is still loading (no footer / no guard until there's a real form). Republishes only when a
 * MEANINGFUL field changes (never on every render — that would loop the parent), while `save`/`reset`
 * always delegate to the section's LATEST closures via a ref (so the footer never fires a stale save).
 */
function useRegisterSettingsForm(form: SettingsSectionForm | null): void {
  const registry = useContext(SettingsFormContext);
  const register = registry?.register;
  const formRef = useRef(form);
  formRef.current = form;

  const present = form != null;
  const dirty = form?.dirty ?? false;
  const saving = form?.saving ?? false;
  const canSave = form?.canSave ?? false;
  const saveLabel = form?.saveLabel ?? "";

  // Stable wrappers so the registered object's identity only changes with the primitive fields
  // below — but the calls still reach the section's freshest state.
  const save = useCallback(() => formRef.current?.save(), []);
  const reset = useCallback(() => formRef.current?.reset(), []);

  useEffect(() => {
    if (!register) return;
    if (!present) {
      register(null);
      return;
    }
    register({ dirty, saving, canSave, save, reset, saveLabel });
    return () => register(null);
  }, [register, present, dirty, saving, canSave, saveLabel, save, reset]);
}

/** The dialog's persistent footer action bar — rendered only for a section that published a form. */
function SettingsFooterBar({ form }: { form: SettingsSectionForm }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border bg-muted/30 px-8 py-3">
      <Text variant="meta" tone="muted" aria-live="polite">
        {form.dirty ? "You have unsaved changes." : "All changes saved."}
      </Text>
      <div className="flex shrink-0 items-center gap-2">
        {form.dirty ? (
          <Button variant="ghost" onClick={form.reset} disabled={form.saving}>
            Discard
          </Button>
        ) : null}
        <Button onClick={form.save} disabled={form.saving || !form.dirty || !form.canSave}>
          {form.saving ? <Spinner className="size-4" /> : null}
          <span>{form.saveLabel}</span>
        </Button>
      </div>
    </div>
  );
}

export function SettingsDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Radix `Dialog` close-focus hook. Settings opens from a URL/nav click with NO `DialogTrigger`,
   *  so Radix's default hands focus to `<body>` on close (verified: even the click-open→Escape flow
   *  stranded a keyboard user). The caller passes a handler that `preventDefault()`s Radix's default
   *  and restores focus to the opener — routing `onOpenChange` alone lost the race with Radix. */
  onCloseAutoFocus?: (event: Event) => void;
  /** Raw deep-link segment from `/settings/:section` — an unknown id falls back to General. */
  section?: string | null;
  onSectionChange: (id: SettingsSectionId) => void;
  defaultProfile: TokenProfileId;
  health: HealthPayload | null;
  onDefaultProfileChange: (profile: TokenProfileId) => void;
  /** Observability WP4.4 — navigate to a real app route (outside Settings), e.g. the watch-rules
   *  management view. Navigating away from `/settings/*` closes this modal on its own (App.tsx's
   *  `settingsMatch` goes null), so this never also needs to call `onOpenChange`. */
  onNavigateToRoute?: (path: string) => void;
  /**
   * D-5 (toolbar-reach WP 4.4) — optional. Lets a caller thread in the SAME lifted
   * `useThemePreference()` instance App.tsx already passes to `AppShell`/`CommandPalette`, so the
   * top-bar control and this dialog's General-pane mirror can never disagree. When omitted (as
   * today — `App.tsx`'s `<SettingsDialog>` call site is outside this WP's Domain), this dialog
   * falls back to its OWN instance of the hook: it still switches the live theme immediately and
   * reads the correct current preference on every fresh open (this dialog's content only mounts
   * while `open`), but a change made here won't retroactively refresh an already-mounted top-bar
   * icon until that control is itself driven again or the page reloads. Threading the real props
   * through from `App.tsx` (next to where it's already passed to `AppShell`/`CommandPalette`)
   * closes that last gap.
   */
  themePreference?: ThemePreference;
  onThemePreferenceChange?: (preference: ThemePreference) => void;
}) {
  const [query, setQuery] = useState("");
  const active: SettingsSectionId = isSettingsSectionId(props.section) ? props.section : "general";
  // Fallback instance — see the prop doc above.
  const ownThemePreference = useThemePreference();
  const themePreference = props.themePreference ?? ownThemePreference.preference;
  const onThemePreferenceChange = props.onThemePreferenceChange ?? ownThemePreference.setPreference;

  // A fresh open starts with a clean search (the query is per-visit, not persisted).
  useEffect(() => {
    if (!props.open) setQuery("");
  }, [props.open]);

  const normalized = query.trim().toLowerCase();
  const visibleGroups = useMemo(() => {
    if (!normalized) return SECTION_GROUPS;
    return SECTION_GROUPS.map((group) => ({
      ...group,
      sections: group.sections.filter(
        (section) =>
          section.label.toLowerCase().includes(normalized) ||
          section.keywords.some((keyword) => keyword.includes(normalized)),
      ),
    })).filter((group) => group.sections.length > 0);
  }, [normalized]);

  // ── Explicit-save form + unsaved-changes guard (design-remediation T5, items 1 + 6) ────────────
  // The active section publishes its save-required form here (null for immediate-apply sections).
  const [sectionForm, setSectionForm] = useState<SettingsSectionForm | null>(null);
  const formRegistry = useMemo<SettingsFormRegistry>(() => ({ register: setSectionForm }), []);
  const dirty = sectionForm?.dirty ?? false;

  // Guard the MODAL CLOSE: `useUnsavedChangesGuard` intercepts a user-initiated close (Escape, the X,
  // overlay click) when the active section is dirty and routes it to a discard confirm instead of
  // calling `props.onOpenChange(false)` outright (which would navigate away and destroy the edit).
  const closeGuard = useUnsavedChangesGuard(dirty, props.onOpenChange);
  // Guard the SECTION SWITCH: a dirty section switch is held here until the operator confirms.
  const [pendingSection, setPendingSection] = useState<SettingsSectionId | null>(null);

  function selectSection(id: SettingsSectionId) {
    if (id === active) {
      setQuery("");
      return;
    }
    // Never silently discard: prompt before leaving a dirty section (item 1).
    if (dirty) {
      setPendingSection(id);
      return;
    }
    setQuery("");
    props.onSectionChange(id);
  }

  function confirmSectionSwitch() {
    const id = pendingSection;
    setPendingSection(null);
    if (id) {
      setQuery("");
      props.onSectionChange(id);
    }
  }

  return (
    <>
      <Dialog open={props.open} onOpenChange={closeGuard.requestOpenChange}>
        {/* Stable balanced height (not content-driven) so switching sections never resizes the
            modal — the WideDialog sizing idiom. p-0/gap-0: the rail and pane own their padding. A
            second `auto` row hosts the persistent explicit-save footer (item 6). aria-modal is set
            explicitly so the modal semantics are unmistakable to assistive tech (item 6). */}
        <DialogContent
          aria-modal="true"
          aria-describedby={undefined}
          onCloseAutoFocus={props.onCloseAutoFocus}
          className="grid h-[min(85vh,780px)] grid-rows-[minmax(0,1fr)_auto] gap-0 overflow-hidden p-0 sm:max-w-[min(1080px,95vw)]"
        >
          {/* Radix requires a title; the pane headings carry the visible name (screenshot grammar). */}
          <DialogTitle className="sr-only">Settings</DialogTitle>
          <div className="grid min-h-0 grid-cols-[14rem_minmax(0,1fr)]">
            <nav
              aria-label="Settings sections"
              className="flex min-h-0 flex-col gap-4 overflow-y-auto border-e border-border bg-muted/30 p-3"
            >
              <InputGroup>
                <InputGroupAddon align="inline-start">
                  <Search className="size-4 text-muted-foreground" aria-hidden />
                </InputGroupAddon>
                <InputGroupInput
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search settings…"
                  aria-label="Search settings"
                  autoComplete="off"
                  spellCheck={false}
                />
                {/* item 6: a clear affordance on the field itself — the no-match state used to remove
                    all navigation with no way back. */}
                {query ? (
                  <InputGroupAddon align="inline-end">
                    <IconButton
                      variant="ghost"
                      size="icon"
                      className="size-6"
                      label="Clear search"
                      onClick={() => setQuery("")}
                    >
                      <X aria-hidden />
                    </IconButton>
                  </InputGroupAddon>
                ) : null}
              </InputGroup>
              {visibleGroups.length === 0 ? (
                <div className="flex flex-col items-start gap-2 px-2">
                  <Text variant="meta" tone="muted">
                    No settings match “{query.trim()}”.
                  </Text>
                  {/* item 6: a way back — the no-match state must never strand the operator. */}
                  <Button variant="outline" size="sm" onClick={() => setQuery("")}>
                    Clear search
                  </Button>
                </div>
              ) : (
                visibleGroups.map((group) => (
                  <div key={group.label} className="flex flex-col gap-0.5">
                    <Text variant="meta" tone="muted" className="px-3 pb-1 font-medium">
                      {group.label}
                    </Text>
                    {group.sections.map((section) => {
                      const isActive = section.id === active;
                      const Icon = section.icon;
                      return (
                        <Button
                          key={section.id}
                          type="button"
                          variant="ghost"
                          aria-current={isActive ? "true" : undefined}
                          className={cn(
                            "h-auto w-full justify-start gap-2 px-3 py-2 text-start font-normal",
                            isActive && "bg-accent font-medium text-accent-foreground",
                          )}
                          onClick={() => selectSection(section.id)}
                        >
                          <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                          <span className="min-w-0 truncate">{section.label}</span>
                        </Button>
                      );
                    })}
                  </div>
                ))
              )}
            </nav>

            <div className="min-h-0 overflow-y-auto">
              <SettingsFormContext.Provider value={formRegistry}>
                {active === "general" ? (
                  <GeneralSection
                    defaultProfile={props.defaultProfile}
                    onDefaultProfileChange={props.onDefaultProfileChange}
                    themePreference={themePreference}
                    onThemePreferenceChange={onThemePreferenceChange}
                  />
                ) : active === "testing" ? (
                  <TestingSection
                    onOpenWatchRules={() =>
                      props.onNavigateToRoute?.("/testing/observability/rules")
                    }
                    onOpenReviewRubrics={() =>
                      props.onNavigateToRoute?.("/testing/observability/review-rubrics")
                    }
                  />
                ) : active === "providers" ? (
                  <ProvidersSection />
                ) : active === "pricing" ? (
                  <PricingSection />
                ) : active === "grading" ? (
                  <GradingSection />
                ) : active === "assistant" ? (
                  <AssistantSection />
                ) : active === "github" ? (
                  <GithubSection />
                ) : active === "storage" ? (
                  <StorageSection />
                ) : (
                  <AboutSection health={props.health} />
                )}
              </SettingsFormContext.Provider>
            </div>
          </div>
          {/* Persistent explicit-save action bar — present only for a section that published a form
              (Grading / GitHub / Storage). Immediate-apply sections show nothing here (item 6). */}
          {sectionForm ? <SettingsFooterBar form={sectionForm} /> : null}
        </DialogContent>
      </Dialog>

      {/* Discard-guard prompts: one for closing the modal while dirty, one for switching section. */}
      <DiscardChangesDialog
        open={closeGuard.confirming}
        onConfirm={closeGuard.confirmDiscard}
        onCancel={closeGuard.cancelDiscard}
      />
      <DiscardChangesDialog
        open={pendingSection != null}
        onConfirm={confirmSectionSwitch}
        onCancel={() => setPendingSection(null)}
      />
    </>
  );
}

/* ─────────────────────────────────────────────────────────────────────────────────────────────
 * Pane grammar — the shared frame every section renders into (title · description · actions),
 * plus the row primitives: `SettingsRow` (label + help left, control right — the screenshot's
 * row grammar) stacked inside a divided `RowGroup`, and `SubHeading` for in-pane subsections.
 * ──────────────────────────────────────────────────────────────────────────────────────────── */

function SectionPane(props: {
  title: string;
  description?: ReactNode;
  /** Right-aligned header actions (kept clear of the dialog's close button via `pe-8`). */
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-5 px-8 py-6">
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2 pe-8">
        <div className="flex min-w-0 flex-col gap-1">
          <Heading level={2} size="title">
            {props.title}
          </Heading>
          {props.description ? (
            <Text tone="muted" className="text-pretty">
              {props.description}
            </Text>
          ) : null}
        </div>
        {props.actions ? (
          <div className="flex shrink-0 items-center gap-2">{props.actions}</div>
        ) : null}
      </div>
      {props.children}
    </section>
  );
}

/** One setting: label + muted help on the left, the control on the right. */
function SettingsRow(props: {
  label: ReactNode;
  description?: ReactNode;
  /** Wires the label to the control; omit for rows whose control carries its own label. */
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 py-3.5 first:pt-0 last:pb-0">
      <div className="flex min-w-0 max-w-md flex-col gap-0.5">
        {props.htmlFor ? (
          <Label htmlFor={props.htmlFor}>{props.label}</Label>
        ) : (
          <Text className="font-medium">{props.label}</Text>
        )}
        {props.description ? (
          <Text variant="meta" tone="muted">
            {props.description}
          </Text>
        ) : null}
      </div>
      <div className="flex min-w-0 shrink-0 items-center gap-2">{props.children}</div>
    </div>
  );
}

function RowGroup(props: { children: ReactNode }) {
  return <div className="flex flex-col divide-y divide-border">{props.children}</div>;
}

function SubHeading(props: { title: string; description?: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <Heading level={3} size="subtitle">
        {props.title}
      </Heading>
      {props.description ? (
        <Text variant="meta" tone="muted">
          {props.description}
        </Text>
      ) : null}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────────────────────────
 * General — per-device preferences. Controls apply immediately (ST1: contrast with the
 * explicit-save Grading section). Theme used to live SOLELY in the top bar (WP 6.7 / finding #8,
 * reconfirmed by the owner 2026-07-11, this pane only pointed at it) — **D-5 (owner, 2026-07-25)
 * SUPERSEDES that call**: "Settings hosts a pointer instead of a setting" (audit finding D-5) is a
 * real workflow dead end, so a real theme `Select` lives in this pane too (System · Qlik Bright ·
 * Qlik Dark), wired to the same theme preference the top-bar control drives. The top-bar shortcut
 * stays — two entry points, one preference (toolbar-reach WP 4.4).
 * ──────────────────────────────────────────────────────────────────────────────────────────── */

/** Human label for a theme preference — "System" plus the concrete theme labels from
 *  `@elabs-ai/components-tokens` `THEME_META`. Mirrors `AppShell.tsx`'s (unexported) `themePreferenceLabel` —
 *  both read the same `THEME_META` source, so the two entry points' wording can't diverge. */
function themePreferenceLabel(preference: ThemePreference): string {
  return preference === "system" ? "System" : (THEME_META[preference]?.label ?? preference);
}

function GeneralSection(props: {
  defaultProfile: TokenProfileId;
  onDefaultProfileChange: (profile: TokenProfileId) => void;
  themePreference: ThemePreference;
  onThemePreferenceChange: (preference: ThemePreference) => void;
}) {
  // Density lives in @elabs-ai/components-tokens' ThemeProvider, which owns the `data-density` attribute and
  // persists the choice. The app ships compact by default (see main.tsx); this is the opt-out.
  const { density, setDensity } = useTheme();

  return (
    <SectionPane
      title="General"
      description="Preferences for this device. Changes apply immediately — there is nothing to save."
    >
      <RowGroup>
        <SettingsRow
          htmlFor="app-theme"
          label="Theme"
          description="Also available from the top bar — System follows your OS."
        >
          <Select
            value={props.themePreference}
            onValueChange={(value) => props.onThemePreferenceChange(value as ThemePreference)}
          >
            <SelectTrigger id="app-theme" className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {THEME_PREFERENCE_ORDER.map((choice) => (
                <SelectItem key={choice} value={choice}>
                  {themePreferenceLabel(choice)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </SettingsRow>
        <SettingsRow
          htmlFor="app-density"
          label="Compact density"
          description="Tighter rows and type for denser tables and lists."
        >
          <Switch
            id="app-density"
            checked={density === "compact"}
            onCheckedChange={(checked) => setDensity(checked ? "compact" : "comfortable")}
            aria-label="Compact density"
          />
        </SettingsRow>
        <SettingsRow
          htmlFor="default-token-profile"
          label="Default token profile"
          description="Tokenizer used when scanning servers; applies to new scans."
        >
          <Select
            value={props.defaultProfile}
            onValueChange={(value) => props.onDefaultProfileChange(value as TokenProfileId)}
          >
            <SelectTrigger id="default-token-profile" className="w-56">
              <SelectValue placeholder="Select a profile" />
            </SelectTrigger>
            <SelectContent>
              {TOKEN_PROFILES.map((profile) => (
                <SelectItem key={profile} value={profile}>
                  {profile}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </SettingsRow>
      </RowGroup>
    </SectionPane>
  );
}

/* ─────────────────────────────────────────────────────────────────────────────────────────────
 * Testing — the global session-clock defaults every run's `SessionClock` uses (D-US3/D-US7) and the
 * app-wide Claude-subscription run concurrency cap (D-US6). Read-only today (WP3.4 backend gap, see
 * `roadmap/unified-sessions/STATUS.md`): the stall timeout and wait budget are fixed constants with
 * NO environment-variable override at all (`apps/api/src/testing/session-clock.ts`'s
 * `DEFAULT_STALL_MS`/`DEFAULT_WAIT_BUDGET_MS`, `session-capabilities.ts`'s
 * `ACME_ANSWERS_WAIT_BUDGET_MS`), and subscription concurrency IS an env var
 * (`SUBSCRIPTION_RUNS_MAX_CONCURRENCY`, `apps/api/src/config/env.ts`) but neither has a settings
 * read/write API serving it as data — this pane surfaces the known values as an informational
 * read-out, not editable fields. A per-environment override exists ONLY for the wall cap today (see
 * EnvironmentEditor's Guardrails section — "Max run duration").
 * ──────────────────────────────────────────────────────────────────────────────────────────── */

export function TestingSection(
  props: { onOpenWatchRules?: () => void; onOpenReviewRubrics?: () => void } = {},
) {
  return (
    <SectionPane
      title="Testing"
      description="Defaults every run's session clock uses, and how many Claude-subscription runs may execute at once."
    >
      {/* Observability WP4.4 (D-OB21) — the entry point into the routed watch-rules management view
          ("when a run matches a filter, run an action" — notify/pin/add-to-collection/promote-to-
          test/run-grader/webhook). Kept as a Settings card link (not a new top-level nav item) so
          Testing's nav stays at 4. */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-muted/40 p-3">
        <div className="flex flex-col gap-0.5">
          <Text className="font-medium">Watch rules</Text>
          <Text variant="meta" tone="muted">
            Automate what happens when a run matches a filter — notify, pin, promote to a test, or
            POST a webhook.
          </Text>
        </div>
        <Button variant="outline" size="sm" onClick={() => props.onOpenWatchRules?.()}>
          <Bell aria-hidden />
          <span>Manage rules</span>
        </Button>
      </div>

      {/* Observability WP4.5 (D-OB22) — review-rubric management for the review queue lite surface
          (a checklist a reviewer walks over a filtered set of runs; every answer lands as ordinary
          human feedback, source='human'). Same off-nav pattern as Watch rules above; the review
          SURFACE itself is reached from the runs feed's "Review these…" toolbar button. */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-muted/40 p-3">
        <div className="flex flex-col gap-0.5">
          <Text className="font-medium">Review rubrics</Text>
          <Text variant="meta" tone="muted">
            The checklists reviewers walk when hand-reviewing runs — thumbs, a 1–5 scale, or a note
            per key.
          </Text>
        </div>
        <Button variant="outline" size="sm" onClick={() => props.onOpenReviewRubrics?.()}>
          <ClipboardCheck aria-hidden />
          <span>Manage rubrics</span>
        </Button>
      </div>

      <DigestScheduleCard />

      <RowGroup>
        <SettingsRow
          label="Stall timeout"
          description="Stops a run when no events arrive for this long while it's running."
        >
          <Text className="tabular-nums font-medium">10 min</Text>
        </SettingsRow>
        <SettingsRow
          label="Wait budget"
          description="Stops an interactive run waiting on a follow-up beyond this long."
        >
          <Text className="tabular-nums font-medium">10 min</Text>
        </SettingsRow>
        <SettingsRow
          label="Wall cap"
          description="Hard run-duration ceiling. Off by default — set per environment (Guardrails → Max run duration)."
        >
          <Text className="font-medium">No cap by default</Text>
        </SettingsRow>
        <SettingsRow
          label="Subscription run concurrency"
          description="How many Claude-subscription runs may execute at once, app-wide — independent of the grading judge's own budget."
        >
          <Text className="tabular-nums font-medium">2</Text>
        </SettingsRow>
      </RowGroup>

      <Alert variant="info">
        <Info aria-hidden />
        <AlertDescription>
          Not editable here yet — the stall timeout and wait budget are fixed constants with no
          environment-variable override, and subscription concurrency is env-var-only (
          <code className="font-mono">SUBSCRIPTION_RUNS_MAX_CONCURRENCY</code>). Editable global
          defaults need a settings-persistence store (a follow-up backend work package); a
          per-environment wall-cap override already exists today (an environment's Guardrails → Max
          run duration).
        </AlertDescription>
      </Alert>
    </SectionPane>
  );
}

/* ─────────────────────────────────────────────────────────────────────────────────────────────
 * Digest report schedule (Observability WP5.5, D-OB22) — off | daily | weekly + the UTC trigger
 * hour, persisted via GET/PUT /api/reports/digest/schedule; a "Generate now" pair for on-demand
 * generation (delivered the same way as a scheduled one — a quiet notification deep-linking to the
 * routed digest view, `/reports/digest/:id`).
 * ──────────────────────────────────────────────────────────────────────────────────────────── */

const DIGEST_MODE_LABEL: Record<DigestScheduleMode, string> = {
  off: "Off",
  daily: "Daily",
  weekly: "Weekly",
};

function DigestScheduleCard() {
  const [schedule, setSchedule] = useState<DigestSchedule | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState<DigestWindowKind | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const result = await getDigestSchedule();
        if (!cancelled) setSchedule(result);
      } catch (error) {
        if (!cancelled) {
          setLoadError(
            getErrorMessage(error, "Couldn’t load the digest schedule. Reload the page to try again."),
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function save(next: DigestSchedule) {
    setSchedule(next); // optimistic — reverted below on failure
    setSaving(true);
    try {
      const saved = await putDigestSchedule(next);
      setSchedule(saved);
    } catch (error) {
      notifyError("Couldn’t save the digest schedule. Try again.", {
        description: getErrorMessage(error),
      });
    } finally {
      setSaving(false);
    }
  }

  async function handleGenerate(window: DigestWindowKind) {
    setGenerating(window);
    try {
      await generateDigest(window);
      toast.success(`${window === "daily" ? "Daily" : "Weekly"} digest generated`, {
        description: "Open it from the notification bell.",
      });
    } catch (error) {
      notifyError("Couldn’t generate the digest. Try again.", {
        description: getErrorMessage(error),
      });
    } finally {
      setGenerating(null);
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-muted/40 p-3">
      <div className="flex flex-col gap-0.5">
        <Text className="font-medium">Digest report</Text>
        <Text variant="meta" tone="muted">
          A "since your last visit" briefing — new/regressed issues, cost and error-rate movers,
          notable runs — delivered as a notification and a routed report.
        </Text>
      </div>

      {loadError ? (
        <Alert variant="destructive">
          <AlertDescription>{loadError}</AlertDescription>
        </Alert>
      ) : !schedule ? (
        <div className="h-9 animate-pulse rounded-md bg-muted motion-reduce:animate-none" />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="digest-schedule-mode" className="text-meta text-muted-foreground">
                Schedule
              </Label>
              <Select
                value={schedule.mode}
                onValueChange={(value) =>
                  void save({ ...schedule, mode: value as DigestScheduleMode })
                }
                disabled={saving}
              >
                <SelectTrigger id="digest-schedule-mode" className="w-36">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DIGEST_SCHEDULE_MODES.map((mode) => (
                    <SelectItem key={mode} value={mode}>
                      {DIGEST_MODE_LABEL[mode]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="digest-schedule-hour" className="text-meta text-muted-foreground">
                Trigger hour (UTC)
              </Label>
              <NumberInput
                id="digest-schedule-hour"
                className="w-24"
                value={schedule.hourUtc}
                min={0}
                max={23}
                clamp
                disabled={saving || schedule.mode === "off"}
                onValueChange={(value) => {
                  if (value === null) return;
                  void save({ ...schedule, hourUtc: value });
                }}
                aria-label="Digest trigger hour, UTC"
              />
            </div>
          </div>
          <Text variant="meta" tone="muted">
            A completed day/week's digest is generated this many hours past its close (gives the
            last runs time to land). A missed digest generates late, flagged, on next boot.
          </Text>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={generating !== null}
              onClick={() => void handleGenerate("daily")}
            >
              {generating === "daily" ? <Spinner className="size-4" /> : null} Generate daily now
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={generating !== null}
              onClick={() => void handleGenerate("weekly")}
            >
              {generating === "weekly" ? <Spinner className="size-4" /> : null} Generate weekly now
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────────────────────────
 * About — runtime details reported by the API. Read-only.
 * ──────────────────────────────────────────────────────────────────────────────────────────── */

function AboutSection(props: { health: HealthPayload | null }) {
  return (
    <SectionPane title="About" description="Runtime details reported by the API.">
      <Descriptions columns={2}>
        <DescriptionsItem label="App version">{props.health?.version ?? "n/a"}</DescriptionsItem>
        <DescriptionsItem label="Docker mode">
          {props.health?.dockerMode ? "true" : "false"}
        </DescriptionsItem>
        <DescriptionsItem label="Database path">
          {props.health?.databasePath ?? "n/a"}
        </DescriptionsItem>
        <DescriptionsItem label="Data directory">
          {props.health?.dataDirectory ?? "n/a"}
        </DescriptionsItem>
      </Descriptions>
    </SectionPane>
  );
}

/* ─────────────────────────────────────────────────────────────────────────────────────────────
 * Grading — the default judge (B3) used by the LLM output-quality graders. Stores REFERENCES
 * only — a provider-credential id + model — never key material. The API rejects an unpriced
 * model with a 400, surfaced inline. Explicit-save (unlike General).
 * ──────────────────────────────────────────────────────────────────────────────────────────── */

/**
 * A short label for the resolved rating source (Auto-Rating WP 2.3, AR3).
 *
 * D-MI5 (`roadmap/model-identity/`, WP 2.3): qualified to "Claude CLI **judge**". `claude_subscription`
 * — a run *provider* — now displays as "Anthropic CLI" (`PROVIDER_KIND_META`), while this is the
 * Auto-Rating judge provider (`CLAUDE_CLI_PROVIDER_ID`), a genuinely different thing. The word
 * "judge" is what keeps the two from reading as one provider.
 */
function resolvedSourceLabel(source: ResolvedJudgeSource, cliModel: string): string {
  if (source === "claude_cli") return `Claude CLI judge · ${cliModel}`;
  if (source === "provider") return "Provider judge";
  return "None";
}

function GradingSection() {
  const [providers, setProviders] = useState<ProviderCredential[]>([]);
  const [settings, setSettings] = useState<JudgeSettings>({
    providerCredentialId: null,
    model: null,
  });
  const [liveModels, setLiveModels] = useState<AvailableModel[] | null>(null);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  // Escape hatch identical to the environment editor: a free-text custom model id when the picker
  // can't offer the right one (offline/no-key roster fetch, or a self-hosted id). Priced-only still
  // applies — the API 400s an unpriced judge model regardless of how it was entered.
  const [customModel, setCustomModel] = useState(false);
  // Auto-Rating WP 2.3 (AR3) — the resolved judge source (CLI → provider → none) + the selectable
  // Claude-CLI judge model (from the assistant roster). `cliAvailable` is a server-side probe (a
  // Claude subscription is signed in); the token is never exposed.
  const [cliAvailable, setCliAvailable] = useState(false);
  const [cliModel, setCliModel] = useState<string>("");
  const [resolvedSource, setResolvedSource] = useState<ResolvedJudgeSource>("none");
  const [cliModelOptions, setCliModelOptions] = useState<string[]>([]);
  // The last-saved baseline (design-remediation T5, items 1/6) — so the dialog footer + guard know
  // when the judge form is dirty and what "Discard" reverts to. Set on load and after each save.
  const [savedSettings, setSavedSettings] = useState<JudgeSettings>({
    providerCredentialId: null,
    model: null,
  });
  const [savedCliModel, setSavedCliModel] = useState<string>("");

  // Load the provider list + the currently-configured judge + the assistant roster (for the CLI
  // model select) once per open. The roster is best-effort — a failure just leaves the current
  // model selectable.
  useEffect(() => {
    let active = true;
    setLoading(true);
    Promise.all([
      listProviders(),
      getJudgeSettings(),
      getAssistantModels().catch(() => ({ models: [] })),
    ])
      .then(([providerList, judge, roster]) => {
        if (!active) return;
        setProviders(providerList);
        setSettings(judge.settings);
        setSavedSettings(judge.settings);
        setCliAvailable(judge.cliAvailable);
        setCliModel(judge.cliModel);
        setSavedCliModel(judge.cliModel);
        setResolvedSource(judge.resolvedSource);
        setCliModelOptions(roster.models);
        // A saved id the curated list doesn't know is a custom id — open the field in custom mode so
        // it stays visible and editable rather than vanishing from a known-only Combobox.
        setCustomModel(judge.settings.model ? !isKnownModel(judge.settings.model) : false);
      })
      .catch((error) => {
        if (active)
          notifyError("Couldn’t load judge settings. Reload the page to try again.", {
            description: getErrorMessage(error),
          });
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  // Pull the selected credential's live model roster (the same list the environment editor shows).
  // On failure fall back to a typed model id + surface `modelsError` as an inline notice.
  useEffect(() => {
    if (!settings.providerCredentialId) {
      setLiveModels(null);
      setModelsError(null);
      setModelsLoading(false);
      return;
    }
    let ignore = false;
    setModelsLoading(true);
    setModelsError(null);
    listProviderModels(settings.providerCredentialId)
      .then((response) => {
        if (!ignore) setLiveModels(response.models);
      })
      .catch((error) => {
        if (ignore) return;
        setLiveModels(null);
        setModelsError(getErrorMessage(error, "Couldn’t load models from the provider."));
      })
      .finally(() => {
        if (!ignore) setModelsLoading(false);
      });
    return () => {
      ignore = true;
    };
  }, [settings.providerCredentialId]);

  const selectedProvider = useMemo(
    () => providers.find((provider) => provider.id === settings.providerCredentialId) ?? null,
    [providers, settings.providerCredentialId],
  );

  // S19: the model picker stays disabled — and says WHY — until a credential is chosen, exactly like
  // the environment editor's dependent Model field.
  const modelField = useDependentField([
    { met: Boolean(settings.providerCredentialId), reason: "Select a credential first…" },
  ]);

  // Options = the provider's LIVE roster when it loaded, else the curated known-models list filtered
  // to the credential's kind (offline fallback) — the same source the environment editor uses. Either
  // way append the saved model if missing so the trigger always shows the current selection.
  const modelOptions = useMemo(() => {
    const options = liveModels
      ? liveModels.map((model) => ({ value: model.id, label: model.displayName ?? model.id }))
      : modelsForKind(selectedProvider?.kind).map((model) => ({ value: model, label: model }));
    if (settings.model && !options.some((option) => option.value === settings.model)) {
      options.push({ value: settings.model, label: settings.model });
    }
    return options;
  }, [liveModels, selectedProvider, settings.model]);

  const PROVIDER_NONE = "none";

  async function save() {
    setSaving(true);
    setSaveError(null);
    try {
      const stored = await putJudgeSettings({
        providerCredentialId: settings.providerCredentialId,
        model: settings.model,
        // Persist the Claude-CLI judge model alongside the provider judge (a subscription — cost 0,
        // not pricing-guarded). Only send a real value.
        ...(cliModel.trim() ? { cliModel: cliModel.trim() } : {}),
      });
      setSettings(stored.settings);
      setSavedSettings(stored.settings);
      setCliAvailable(stored.cliAvailable);
      setCliModel(stored.cliModel);
      setSavedCliModel(stored.cliModel);
      setResolvedSource(stored.resolvedSource);
      toast.success("Default judge saved");
    } catch (error) {
      // The 400 for an unpriced model carries a specific message — surface it inline (not a toast).
      setSaveError(getErrorMessage(error, "Couldn’t save the default judge. Try again."));
    } finally {
      setSaving(false);
    }
  }

  // The CLI model select options — the assistant roster, plus the current selection if the roster
  // doesn't list it (so the trigger always shows what is saved).
  const cliModelSelectOptions = useMemo(() => {
    const options = [...cliModelOptions];
    if (cliModel && !options.includes(cliModel)) options.push(cliModel);
    return options;
  }, [cliModelOptions, cliModel]);

  // Dirty vs the last-saved baseline (design-remediation T5, items 1/6). Publishes the judge form to
  // the dialog so a dirty section switch / close prompts a discard guard and the footer owns Save.
  const dirty =
    JSON.stringify(settings) !== JSON.stringify(savedSettings) || cliModel !== savedCliModel;
  const resetForm = useCallback(() => {
    setSettings(savedSettings);
    setCliModel(savedCliModel);
    setCustomModel(savedSettings.model ? !isKnownModel(savedSettings.model) : false);
    setSaveError(null);
  }, [savedSettings, savedCliModel]);
  useRegisterSettingsForm(
    loading
      ? null
      : {
          dirty,
          saving,
          canSave: true,
          save: () => void save(),
          reset: resetForm,
          saveLabel: "Save default judge",
        },
  );

  return (
    <SectionPane
      title="Grading"
      description="Every LLM grader resolves one judge chain: the Claude CLI on your subscription (if signed in) → the configured provider judge → none. Stored as references only — never key material."
    >
      {loading ? (
        <div className="flex items-center gap-2">
          <Spinner className="size-4" />
          <Text variant="meta" tone="muted">
            Loading judge settings…
          </Text>
        </div>
      ) : (
        <>
          {saveError ? (
            <Alert variant="destructive">
              <AlertDescription>{saveError}</AlertDescription>
            </Alert>
          ) : null}

          {/* Auto-Rating WP 2.3 (AR3) — the resolved rating source + the Claude-CLI judge model. */}
          <div className="flex flex-col gap-3 rounded-lg border border-border bg-muted/40 p-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Bot className="size-4 text-muted-foreground" aria-hidden />
                <Text variant="meta" className="font-medium">
                  Rating source
                </Text>
              </div>
              <Badge variant={resolvedSource === "none" ? "secondary" : "default"}>
                {resolvedSourceLabel(resolvedSource, cliModel)}
              </Badge>
            </div>
            <Text variant="meta" tone="muted">
              {resolvedSource === "claude_cli"
                ? `Runs are rated by the Claude CLI on your subscription (${cliModel}) — real tokens, cost 0.`
                : resolvedSource === "provider"
                  ? "No Claude subscription is signed in — runs are rated by the configured provider judge below (estimated cost)."
                  : "No LLM judge available — deterministic facets still run; LLM facets are marked unevaluable. Sign in to Claude, or configure a provider judge below."}
            </Text>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="cli-judge-model">Claude CLI judge model</Label>
              <Select
                value={cliModel || undefined}
                onValueChange={setCliModel}
                disabled={cliModelSelectOptions.length === 0}
              >
                <SelectTrigger id="cli-judge-model" className="w-full sm:max-w-xs">
                  <SelectValue placeholder="Select a model…" />
                </SelectTrigger>
                <SelectContent>
                  {cliModelSelectOptions.map((model) => (
                    <SelectItem key={model} value={model}>
                      {model}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Text variant="meta" tone="muted">
                Used when a Claude subscription is signed in
                {cliAvailable ? "" : " (not signed in yet — sign in in the Assistant section)"}.
                Selectable from the assistant roster; the subscription judge is cost 0.
              </Text>
            </div>
          </div>

          <SubHeading
            title="Provider judge"
            description="The fallback judge when no Claude subscription is signed in. An unpriced model is rejected."
          />

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="judge-provider">Provider credential</Label>
              <Select
                value={settings.providerCredentialId ?? PROVIDER_NONE}
                onValueChange={(value) =>
                  setSettings((current) => ({
                    ...current,
                    providerCredentialId: value === PROVIDER_NONE ? null : value,
                    // Switching credential invalidates the model roster — clear the model.
                    model: value === PROVIDER_NONE ? null : current.model,
                  }))
                }
              >
                <SelectTrigger id="judge-provider" className="w-full">
                  <SelectValue placeholder="Select a credential…" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={PROVIDER_NONE}>None (grading judge off)</SelectItem>
                  {providers.map((provider) => (
                    <SelectItem key={provider.id} value={provider.id}>
                      {provider.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between gap-2">
                <Label htmlFor="judge-model">Model</Label>
                <Button
                  variant="link"
                  size="sm"
                  className="h-auto p-0"
                  disabled={!settings.providerCredentialId}
                  onClick={() => {
                    setCustomModel((on) => !on);
                    // Entering custom mode starts from a clean field (mirrors the env editor).
                    if (!customModel) setSettings((current) => ({ ...current, model: null }));
                  }}
                >
                  {customModel ? "Choose a known model" : "+ Custom model id"}
                </Button>
              </div>
              {customModel ? (
                <Input
                  id="judge-model"
                  value={settings.model ?? ""}
                  disabled={!settings.providerCredentialId}
                  placeholder="my-org/custom-model…"
                  spellCheck={false}
                  autoComplete="off"
                  onChange={(event) =>
                    setSettings((current) => ({
                      ...current,
                      model: event.target.value.trim() ? event.target.value : null,
                    }))
                  }
                />
              ) : modelField.disabled ? (
                // S19: disabled-with-reason until a credential is chosen (Combobox has no disabled
                // prop, so the gated state is a real disabled input carrying the reason).
                <Input
                  id="judge-model"
                  value=""
                  readOnly
                  disabled
                  placeholder={modelField.reason}
                  aria-disabled
                  title={modelField.reason}
                />
              ) : (
                <Combobox
                  options={modelOptions}
                  value={settings.model ?? ""}
                  onValueChange={(value) =>
                    setSettings((current) => ({ ...current, model: value }))
                  }
                  placeholder={modelsLoading ? "Loading models…" : "Select a model…"}
                  searchPlaceholder="Search models…"
                  emptyText="No models — use a custom id."
                />
              )}
              {/* Live-roster status (hidden in custom / gated mode), then the priced-only reminder. */}
              {!customModel && !modelField.disabled && modelsLoading ? (
                <Text variant="meta" tone="muted">
                  Loading models from the provider…
                </Text>
              ) : !customModel && !modelField.disabled && modelsError ? (
                <Text variant="meta" tone="muted">
                  {modelsError} — showing known models, or use a custom id.
                </Text>
              ) : (
                <Text variant="meta" tone="muted">
                  Priced models only — the judge cost ledger is kept separate from run cost.
                </Text>
              )}
            </div>
          </div>
          {/* ST1: this pane is explicit-save — the persistent dialog footer owns Save + Discard and
              shows the unsaved/saved state (design-remediation T5, item 6), so no inline Save here. */}
        </>
      )}
    </SectionPane>
  );
}

/* ─────────────────────────────────────────────────────────────────────────────────────────────
 * Providers — encrypted provider credentials (the Testing run engine's keys).
 * ──────────────────────────────────────────────────────────────────────────────────────────── */

// D-MI6 (`roadmap/model-identity/`, WP 2.3): the local `PROVIDER_KIND_LABELS` map that used to live
// here is deleted — provider-kind display names now come from the ONE registry in
// `packages/shared` (`PROVIDER_KIND_META` / `providerKindLabel`), so Settings, the Dashboard's
// testing filters, the Hub picker and the Environment views can no longer drift apart.
// `claude_subscription` therefore reads "Anthropic CLI" here (was "Claude (subscription)"); it is
// still a normal roster entry (no hidden surfaces) whose create form has no key field — see
// NO_API_KEY_KINDS below.

/** Kinds that talk to a local / self-hosted endpoint and therefore need a base URL. */
const BASE_URL_KINDS = new Set<ProviderKind>(["openai_compatible", "ollama"]);

/**
 * Kinds where the base URL has no sensible default and so is mandatory (unlike ollama/
 * openai_compatible, which fall back to a local default when left blank). Empty today — kept as the
 * one declaration point so a future kind with no default is a one-line change.
 */
const REQUIRED_BASE_URL_KINDS = new Set<ProviderKind>([]);

/**
 * Claude subscription (roadmap/claude-subscription/, WP 0.3, D-CS7) — this kind's ONLY auth is the
 * owner's signed-in Claude subscription (the same sign-in the Assistant dock uses), never a
 * `provider_credentials` API key. The create/edit form hides the key field entirely for these kinds
 * (not just makes it optional, unlike the BASE_URL_KINDS local providers) and shows the live
 * sign-in state instead — see the `claude_subscription`-kind branch in the form below.
 */
const NO_API_KEY_KINDS = new Set<ProviderKind>(["claude_subscription"]);

type ProviderFormState = {
  kind: ProviderKind;
  label: string;
  baseUrl: string;
  apiKey: string;
};

const EMPTY_PROVIDER_FORM: ProviderFormState = {
  kind: "anthropic",
  label: "",
  baseUrl: "",
  apiKey: "",
};

/**
 * Self-contained (fetches its own list). The API returns each credential REDACTED — `hasKey` only,
 * never the key — so after a save the key is never re-rendered; the form shows whether a key is
 * stored. The API-key field never blocks paste, sets `autocomplete="off"` + `spellCheck={false}`,
 * and uses `type="password"` (interaction-guidelines).
 */
export function ProvidersSection() {
  const [providers, setProviders] = useState<ProviderCredential[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<ProviderFormState>(EMPTY_PROVIDER_FORM);
  const [errors, setErrors] = useState<Partial<Record<keyof ProviderFormState, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<ProviderCredential | null>(null);
  // Claude subscription (WP 0.3, D-CS7) — the create form has no key field for this kind; instead
  // it reads the EXISTING Assistant sign-in status (the same sign-in the embedded dock uses, `GET
  // /api/assistant/auth/status`) so the owner sees an honest signed-in/not-signed-in state here too.
  const [assistantStatus, setAssistantStatus] = useState<AssistantAuthStatus | null>(null);
  const [assistantStatusLoading, setAssistantStatusLoading] = useState(true);

  const editing = useMemo(
    () => providers.find((provider) => provider.id === editingId) ?? null,
    [providers, editingId],
  );

  const refresh = useCallback(async () => {
    setLoading(true);
    setAssistantStatusLoading(true);
    try {
      const [nextProviders, nextAssistantStatus] = await Promise.all([
        listProviders(),
        getAssistantAuthStatus().catch(() => null),
      ]);
      setProviders(nextProviders);
      setAssistantStatus(nextAssistantStatus);
    } catch (error) {
      notifyError("Couldn’t load provider credentials. Reload the page to try again.", {
        description: getErrorMessage(error),
      });
    } finally {
      setLoading(false);
      setAssistantStatusLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  function openCreate() {
    setEditingId(null);
    setForm(EMPTY_PROVIDER_FORM);
    setErrors({});
    setFormError(null);
    setShowForm(true);
  }

  function openEdit(provider: ProviderCredential) {
    setEditingId(provider.id);
    // apiKey starts EMPTY on edit — the key is never returned; leaving it blank keeps the stored one.
    setForm({
      kind: provider.kind,
      label: provider.label,
      baseUrl: provider.baseUrl ?? "",
      apiKey: "",
    });
    setErrors({});
    setFormError(null);
    setShowForm(true);
  }

  function closeForm() {
    setShowForm(false);
    setEditingId(null);
    setForm(EMPTY_PROVIDER_FORM);
    setErrors({});
    setFormError(null);
  }

  function patch<K extends keyof ProviderFormState>(key: K, value: ProviderFormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function validate(): boolean {
    const next: Partial<Record<keyof ProviderFormState, string>> = {};
    if (!form.label.trim()) next.label = "Label is required";
    if (BASE_URL_KINDS.has(form.kind)) {
      const trimmedBaseUrl = form.baseUrl.trim();
      if (!trimmedBaseUrl) {
        if (REQUIRED_BASE_URL_KINDS.has(form.kind)) {
          next.baseUrl = "Base URL is required";
        }
      } else {
        try {
          new URL(trimmedBaseUrl);
        } catch {
          next.baseUrl = "Enter a valid URL";
        }
      }
    }
    // A brand-new credential needs a key up front (except local kinds, which may run keyless, and
    // claude_subscription, which is ALWAYS keyless — auth is the signed-in subscription, D-CS7).
    if (
      !editing &&
      !BASE_URL_KINDS.has(form.kind) &&
      !NO_API_KEY_KINDS.has(form.kind) &&
      !form.apiKey.trim()
    ) {
      next.apiKey = "API key is required";
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function submit() {
    if (!validate()) {
      setFormError("Fix the highlighted fields and try again.");
      return;
    }
    setFormError(null);
    setSaving(true);
    const baseUrl =
      BASE_URL_KINDS.has(form.kind) && form.baseUrl.trim() ? form.baseUrl.trim() : undefined;
    const key = form.apiKey.trim() ? form.apiKey.trim() : undefined;
    try {
      if (editing) {
        const update: ProviderCredentialUpdate = {
          kind: form.kind,
          label: form.label.trim(),
          baseUrl,
          // Omit apiKey to keep the stored key; send it only when the user typed a new one (rotation).
          ...(key ? { apiKey: key } : {}),
        };
        await updateProvider(editing.id, update);
        toast.success("Credential updated");
      } else {
        const input: ProviderCredentialInput = {
          kind: form.kind,
          label: form.label.trim(),
          baseUrl,
          apiKey: key,
        };
        await createProvider(input);
        toast.success("Credential saved");
      }
      closeForm();
      await refresh();
    } catch (error) {
      setFormError(getErrorMessage(error, "Couldn’t save the credential. Check the details and try again."));
    } finally {
      setSaving(false);
    }
  }

  async function performDelete() {
    if (!pendingDelete) return;
    const target = pendingDelete;
    setPendingDelete(null);
    try {
      await deleteProvider(target.id);
      toast.success("Credential deleted");
      if (editingId === target.id) closeForm();
      await refresh();
    } catch (error) {
      notifyError("Couldn’t delete the credential. Try again.", {
        description: getErrorMessage(error),
      });
    }
  }

  return (
    <SectionPane
      title="Providers"
      description="LLM provider API keys for the Testing run engine. Stored encrypted; the key is never returned by the API after saving."
      actions={
        !showForm ? (
          <Button size="sm" onClick={openCreate}>
            <Plus aria-hidden />
            <span>Add credential</span>
          </Button>
        ) : undefined
      }
    >
      {loading ? (
        <div className="flex items-center gap-2">
          <Spinner className="size-4" />
          <Text variant="meta" tone="muted">
            Loading credentials…
          </Text>
        </div>
      ) : providers.length === 0 && !showForm ? (
        <Text variant="meta" tone="muted">
          No provider credentials yet. Add one to run tests against a hosted or local model.
        </Text>
      ) : (
        <ul className="flex flex-col gap-2">
          {providers.map((provider) => {
            return (
              <li
                key={provider.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-muted/40 px-3 py-2"
              >
                <span className="flex min-w-0 items-center gap-2.5">
                  <KeyRound className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{provider.label}</span>
                    <span className="flex items-center gap-2">
                      <Text variant="meta" tone="muted">
                        {providerKindLabel(provider.kind)}
                        {provider.baseUrl ? ` · ${provider.baseUrl}` : ""}
                      </Text>
                    </span>
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  {provider.kind === "claude_subscription" ? (
                    // No key concept for this kind (D-CS7) — "no key" would misleadingly read as
                    // an error state, so this shows the real Claude sign-in state instead.
                    assistantStatus?.signedIn ? (
                      <Badge variant="success">signed in</Badge>
                    ) : (
                      <Badge variant="warning">not signed in</Badge>
                    )
                  ) : provider.hasKey ? (
                    <Badge variant="success">key stored</Badge>
                  ) : (
                    <Badge variant="warning">no key</Badge>
                  )}
                  <IconButton
                    variant="ghost"
                    size="sm"
                    label={`Edit ${provider.label}`}
                    onClick={() => openEdit(provider)}
                  >
                    <Pencil aria-hidden />
                  </IconButton>
                  <IconButton
                    variant="ghost"
                    size="sm"
                    label={`Delete ${provider.label}`}
                    onClick={() => setPendingDelete(provider)}
                  >
                    <Trash2 aria-hidden />
                  </IconButton>
                </span>
              </li>
            );
          })}
        </ul>
      )}

      <FormDialog
        open={showForm}
        onOpenChange={(open) => {
          if (!open) closeForm();
        }}
        title={editing ? `Edit ${editing.label}` : "New credential"}
        description={
          NO_API_KEY_KINDS.has(form.kind)
            ? "This kind has no API key — it runs on your signed-in Claude subscription. Manage that sign-in below."
            : editing
              ? "Update this credential. The stored key is never shown again — leave the key field blank to keep it."
              : "Add a provider credential for the Testing run engine. Stored encrypted; the key is never returned after saving."
        }
        primaryLabel={editing ? "Update credential" : "Save credential"}
        busy={saving}
        onSubmit={() => void submit()}
      >
        {formError ? (
          <Alert variant="destructive">
            <AlertDescription>{formError}</AlertDescription>
          </Alert>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="provider-kind">Provider kind</Label>
            <Select
              value={form.kind}
              onValueChange={(value) => patch("kind", value as ProviderKind)}
            >
              <SelectTrigger id="provider-kind" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PROVIDER_KINDS.map((kind) => (
                  <SelectItem key={kind} value={kind}>
                    {providerKindLabel(kind)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="provider-label">Label</Label>
            <Input
              id="provider-label"
              value={form.label}
              placeholder="Prod Anthropic…"
              aria-invalid={errors.label ? true : undefined}
              onChange={(event) => patch("label", event.target.value)}
            />
            {errors.label ? (
              <Text variant="meta" className="text-destructive" role="alert">
                {errors.label}
              </Text>
            ) : (
              <Text variant="meta" tone="muted">
                {NO_API_KEY_KINDS.has(form.kind)
                  ? "Name it after the Claude account it signs in with — the token itself carries no identity."
                  : "How this credential is listed across the app."}
              </Text>
            )}
          </div>

          {BASE_URL_KINDS.has(form.kind) ? (
            <div className="flex flex-col gap-1.5 sm:col-span-2">
              <Label htmlFor="provider-baseurl">Base URL</Label>
              <Input
                id="provider-baseurl"
                type="url"
                inputMode="url"
                value={form.baseUrl}
                placeholder="http://localhost:11434/v1…"
                spellCheck={false}
                autoComplete="off"
                aria-invalid={errors.baseUrl ? true : undefined}
                onChange={(event) => patch("baseUrl", event.target.value)}
              />
              {errors.baseUrl ? (
                <Text variant="meta" className="text-destructive" role="alert">
                  {errors.baseUrl}
                </Text>
              ) : null}
            </div>
          ) : null}

          {NO_API_KEY_KINDS.has(form.kind) ? (
            // Claude subscription (WP 0.3, D-CS7) — NO key/secret field for this kind; auth is the
            // owner's signed-in Claude subscription. The full sign-in surface is embedded here
            // (shared with Settings → Assistant) so the token can be signed in, re-signed in, and
            // RESET without leaving the credential you are editing.
            <div className="flex flex-col gap-2 sm:col-span-2">
              <Separator />
              <Text className="font-medium">Claude sign-in</Text>
              <ClaudeSubscriptionAuthPanel
                status={assistantStatus}
                loading={assistantStatusLoading}
                onStatusChange={setAssistantStatus}
                idPrefix="provider-claude"
                compact
              />
            </div>
          ) : (
            <div className="flex flex-col gap-1.5 sm:col-span-2">
              <Label htmlFor="provider-apikey">API key</Label>
              <Input
                id="provider-apikey"
                type="password"
                name="provider-api-key"
                value={form.apiKey}
                autoComplete="off"
                spellCheck={false}
                placeholder={editing?.hasKey ? "Leave blank to keep the stored key…" : "sk-…"}
                aria-invalid={errors.apiKey ? true : undefined}
                onChange={(event) => patch("apiKey", event.target.value)}
              />
              {errors.apiKey ? (
                <Text variant="meta" className="text-destructive" role="alert">
                  {errors.apiKey}
                </Text>
              ) : (
                <Text variant="meta" tone="muted">
                  {editing
                    ? editing.hasKey
                      ? "A key is stored. Type a new one only to rotate it."
                      : "No key stored yet."
                    : BASE_URL_KINDS.has(form.kind)
                      ? "Optional for local providers that run without a key."
                      : "Sent once and encrypted; never shown again."}
                </Text>
              )}
            </div>
          )}
        </div>
      </FormDialog>

      <AlertDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => !open && setPendingDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {pendingDelete?.label ?? "credential"}?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes the credential and its encrypted key. Environments using it
              will no longer run until repointed. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction asChild>
              <Button variant="destructive" onClick={() => void performDelete()}>
                Delete credential
              </Button>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SectionPane>
  );
}

/* ─────────────────────────────────────────────────────────────────────────────────────────────
 * Pricing — the DB-backed model pricing map (Observability WP2.6, D-OB22). USD per 1M tokens. The
 * code table seeds read-only `seed` rows; owners add/override with `user` rows (a newer user row
 * with a matching `modelMatch` wins). Editing a price affects NEW run costs only — a recorded run's
 * cost is never recomputed (the money-immutability invariant). An unpriced model still rejects a
 * cost-capped run (guardrail unchanged); this pane just moves WHERE the price lives.
 * ──────────────────────────────────────────────────────────────────────────────────────────── */

/** The far-past seed baseline instant (mirror of the API's `SEED_PRICING_EFFECTIVE_FROM`). */
const PRICING_SEED_EPOCH = "1970-01-01T00:00:00.000Z";

type PricingFormState = {
  provider: string;
  modelMatch: string;
  isRegex: boolean;
  inputPerMTok: string;
  outputPerMTok: string;
  cacheReadPerMTok: string;
  cacheWritePerMTok: string;
  /** `datetime-local` value ("" = effective now on save). */
  effectiveFrom: string;
};

const EMPTY_PRICING_FORM: PricingFormState = {
  provider: "",
  modelMatch: "",
  isRegex: false,
  inputPerMTok: "",
  outputPerMTok: "",
  cacheReadPerMTok: "",
  cacheWritePerMTok: "",
  effectiveFrom: "",
};

/** Format a USD-per-1M price compactly ("$2.5", "$0.075", "$0" for free/local). */
function formatPricePerM(value: number | undefined): string {
  if (value === undefined) return "—";
  return `$${value.toLocaleString(undefined, { maximumFractionDigits: 4 })}`;
}

/** An ISO instant as a `datetime-local` value (local tz, minute precision) for the edit form. */
function toDateTimeLocalValue(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Effective-date cell: seed rows are the "default" baseline; user rows show their local date. */
function formatEffective(entry: ModelPricingEntry): string {
  if (entry.source === "seed" || entry.effectiveFrom === PRICING_SEED_EPOCH) return "Default";
  const date = new Date(entry.effectiveFrom);
  return Number.isNaN(date.getTime()) ? entry.effectiveFrom : date.toLocaleString();
}

export function PricingSection() {
  const [entries, setEntries] = useState<ModelPricingEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<PricingFormState>(EMPTY_PRICING_FORM);
  const [errors, setErrors] = useState<Partial<Record<keyof PricingFormState, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<ModelPricingEntry | null>(null);
  const [deleting, setDeleting] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      setEntries(await listPricing());
    } catch (error) {
      setLoadError(getErrorMessage(error));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // User rows first (the editable ones), then seeds; each group keeps the API's stable ordering.
  const ordered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    const matches = (entry: ModelPricingEntry) =>
      !normalized ||
      entry.modelMatch.toLowerCase().includes(normalized) ||
      entry.provider.toLowerCase().includes(normalized);
    const filtered = entries.filter(matches);
    return [
      ...filtered.filter((entry) => entry.source === "user"),
      ...filtered.filter((entry) => entry.source === "seed"),
    ];
  }, [entries, query]);

  function patch<K extends keyof PricingFormState>(key: K, value: PricingFormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function openCreate() {
    setEditingId(null);
    setForm(EMPTY_PRICING_FORM);
    setErrors({});
    setFormError(null);
    setShowForm(true);
  }

  function openEdit(entry: ModelPricingEntry) {
    setEditingId(entry.id);
    setForm({
      provider: entry.provider,
      modelMatch: entry.modelMatch,
      isRegex: entry.isRegex,
      inputPerMTok: String(entry.inputPerMTok),
      outputPerMTok: String(entry.outputPerMTok),
      cacheReadPerMTok: entry.cacheReadPerMTok !== undefined ? String(entry.cacheReadPerMTok) : "",
      cacheWritePerMTok:
        entry.cacheWritePerMTok !== undefined ? String(entry.cacheWritePerMTok) : "",
      effectiveFrom:
        entry.effectiveFrom === PRICING_SEED_EPOCH ? "" : toDateTimeLocalValue(entry.effectiveFrom),
    });
    setErrors({});
    setFormError(null);
    setShowForm(true);
  }

  /** Duplicate any row (incl. a read-only seed) into a NEW user entry — the override path. Effective
   *  date is cleared so the copy is "effective now" and thus newer than the seed it overrides. */
  function openDuplicate(entry: ModelPricingEntry) {
    setEditingId(null);
    setForm({
      provider: entry.provider,
      modelMatch: entry.modelMatch,
      isRegex: entry.isRegex,
      inputPerMTok: String(entry.inputPerMTok),
      outputPerMTok: String(entry.outputPerMTok),
      cacheReadPerMTok: entry.cacheReadPerMTok !== undefined ? String(entry.cacheReadPerMTok) : "",
      cacheWritePerMTok:
        entry.cacheWritePerMTok !== undefined ? String(entry.cacheWritePerMTok) : "",
      effectiveFrom: "",
    });
    setErrors({});
    setFormError(null);
    setShowForm(true);
  }

  function validate(): boolean {
    const next: Partial<Record<keyof PricingFormState, string>> = {};
    if (!form.provider.trim()) next.provider = "Provider is required";
    if (!form.modelMatch.trim()) {
      next.modelMatch = "A model id or pattern is required";
    } else if (form.isRegex) {
      try {
        // eslint-disable-next-line no-new
        new RegExp(form.modelMatch);
      } catch {
        next.modelMatch = "Enter a valid regular expression";
      }
    }
    for (const key of ["inputPerMTok", "outputPerMTok"] as const) {
      const value = Number(form[key]);
      if (form[key].trim() === "" || !Number.isFinite(value) || value < 0) {
        next[key] = "Enter a non-negative price";
      }
    }
    for (const key of ["cacheReadPerMTok", "cacheWritePerMTok"] as const) {
      if (form[key].trim() !== "") {
        const value = Number(form[key]);
        if (!Number.isFinite(value) || value < 0) next[key] = "Enter a non-negative price";
      }
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function save() {
    if (!validate()) return;
    setSaving(true);
    setFormError(null);
    const optional = (value: string) => (value.trim() === "" ? undefined : Number(value));
    const input: ModelPricingInput = {
      provider: form.provider.trim(),
      modelMatch: form.modelMatch.trim(),
      isRegex: form.isRegex,
      inputPerMTok: Number(form.inputPerMTok),
      outputPerMTok: Number(form.outputPerMTok),
    };
    const cacheRead = optional(form.cacheReadPerMTok);
    if (cacheRead !== undefined) input.cacheReadPerMTok = cacheRead;
    const cacheWrite = optional(form.cacheWritePerMTok);
    if (cacheWrite !== undefined) input.cacheWritePerMTok = cacheWrite;
    if (form.effectiveFrom) input.effectiveFrom = new Date(form.effectiveFrom).toISOString();

    try {
      if (editingId) {
        await updatePricing(editingId, input);
        toast.success("Pricing updated");
      } else {
        await createPricing(input);
        toast.success("Pricing added");
      }
      setShowForm(false);
      setEditingId(null);
      setForm(EMPTY_PRICING_FORM);
      await refresh();
    } catch (error) {
      setFormError(getErrorMessage(error));
    } finally {
      setSaving(false);
    }
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      await deletePricing(pendingDelete.id);
      toast.success("Pricing entry deleted");
      setPendingDelete(null);
      await refresh();
    } catch (error) {
      notifyError("Couldn’t delete the pricing entry. Try again.", {
        description: getErrorMessage(error),
      });
    } finally {
      setDeleting(false);
    }
  }

  return (
    <SectionPane
      title="Pricing"
      description="Per-model prices (USD per 1M tokens) used for run cost and the spend-cap guardrail. Built-in rates are the seed; add a rate to override one. Editing a price changes future runs only — a recorded run keeps the cost it was computed with."
      actions={
        <Button onClick={openCreate} size="sm">
          <Plus aria-hidden />
          <span>Add price</span>
        </Button>
      }
    >
      <InputGroup className="max-w-sm">
        <InputGroupAddon align="inline-start">
          <Search className="size-4 text-muted-foreground" aria-hidden />
        </InputGroupAddon>
        <InputGroupInput
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Filter by model or provider…"
          aria-label="Filter pricing"
          autoComplete="off"
          spellCheck={false}
        />
      </InputGroup>

      {loadError ? (
        <Alert variant="destructive">
          <Info aria-hidden />
          <AlertDescription>{loadError}</AlertDescription>
        </Alert>
      ) : loading ? (
        <div className="flex items-center gap-2 py-8 text-muted-foreground">
          <Spinner className="size-4" aria-hidden />
          <Text tone="muted">Loading pricing…</Text>
        </div>
      ) : ordered.length === 0 ? (
        <Text tone="muted" className="py-8">
          No pricing entries match your filter.
        </Text>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Model match</TableHead>
                <TableHead>Provider</TableHead>
                <TableHead className="text-right">Input /1M</TableHead>
                <TableHead className="text-right">Output /1M</TableHead>
                <TableHead className="text-right">Cache read /1M</TableHead>
                <TableHead>Effective</TableHead>
                <TableHead>Source</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {ordered.map((entry) => (
                <TableRow key={entry.id}>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-caption break-all">{entry.modelMatch}</span>
                      {entry.isRegex ? (
                        <Badge variant="outline" className="shrink-0">
                          regex
                        </Badge>
                      ) : null}
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{entry.provider}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatPricePerM(entry.inputPerMTok)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatPricePerM(entry.outputPerMTok)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {formatPricePerM(entry.cacheReadPerMTok)}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{formatEffective(entry)}</TableCell>
                  <TableCell>
                    <Badge variant={entry.source === "user" ? "default" : "secondary"}>
                      {entry.source}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center justify-end gap-1">
                      <IconButton
                        variant="ghost"
                        size="icon"
                        onClick={() => openDuplicate(entry)}
                        label={`Duplicate pricing for ${entry.modelMatch}`}
                      >
                        <Copy aria-hidden />
                      </IconButton>
                      {entry.source === "user" ? (
                        <>
                          <IconButton
                            variant="ghost"
                            size="icon"
                            onClick={() => openEdit(entry)}
                            label={`Edit pricing for ${entry.modelMatch}`}
                          >
                            <Pencil aria-hidden />
                          </IconButton>
                          <IconButton
                            variant="ghost"
                            size="icon"
                            onClick={() => setPendingDelete(entry)}
                            label={`Delete pricing for ${entry.modelMatch}`}
                          >
                            <Trash2 aria-hidden />
                          </IconButton>
                        </>
                      ) : null}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <FormDialog
        open={showForm}
        onOpenChange={(open) => {
          if (!open && !saving) {
            setShowForm(false);
            setEditingId(null);
          }
        }}
        title={editingId ? "Edit pricing" : "Add pricing"}
        description="Prices are USD per 1M tokens. Leave a cache rate blank to derive it from the input rate."
        primaryLabel={editingId ? "Save pricing" : "Add pricing"}
        busy={saving}
        onSubmit={() => void save()}
      >
        {formError ? (
          <Alert variant="destructive">
            <Info aria-hidden />
            <AlertDescription>{formError}</AlertDescription>
          </Alert>
        ) : null}

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="pricing-model-match">Model match</Label>
          <Input
            id="pricing-model-match"
            value={form.modelMatch}
            onChange={(event) => patch("modelMatch", event.target.value)}
            placeholder={form.isRegex ? "^claude-.*" : "claude-sonnet-4"}
            autoComplete="off"
            spellCheck={false}
            aria-invalid={errors.modelMatch ? true : undefined}
          />
          {errors.modelMatch ? (
            <Text variant="meta" className="text-destructive" role="alert">
              {errors.modelMatch}
            </Text>
          ) : (
            <Text variant="meta" tone="muted">
              An exact model id, or a regular expression when “Match as regex” is on.
            </Text>
          )}
        </div>

        <div className="flex items-center justify-between gap-4">
          <Label htmlFor="pricing-is-regex" className="flex flex-col gap-0.5">
            <span>Match as regex</span>
            <Text variant="meta" tone="muted" className="font-normal">
              Apply this price to every model whose id matches the pattern.
            </Text>
          </Label>
          <Switch
            id="pricing-is-regex"
            checked={form.isRegex}
            onCheckedChange={(checked) => patch("isRegex", checked)}
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="pricing-provider">Provider</Label>
            <Input
              id="pricing-provider"
              value={form.provider}
              onChange={(event) => patch("provider", event.target.value)}
              placeholder="anthropic"
              autoComplete="off"
              spellCheck={false}
              aria-invalid={errors.provider ? true : undefined}
            />
            {errors.provider ? (
              <Text variant="meta" className="text-destructive" role="alert">
                {errors.provider}
              </Text>
            ) : null}
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="pricing-effective">Effective from</Label>
            <Input
              id="pricing-effective"
              type="datetime-local"
              value={form.effectiveFrom}
              onChange={(event) => patch("effectiveFrom", event.target.value)}
            />
            <Text variant="meta" tone="muted">
              Blank = effective now.
            </Text>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <PriceField
            id="pricing-input"
            label="Input /1M"
            value={form.inputPerMTok}
            error={errors.inputPerMTok}
            onChange={(value) => patch("inputPerMTok", value)}
          />
          <PriceField
            id="pricing-output"
            label="Output /1M"
            value={form.outputPerMTok}
            error={errors.outputPerMTok}
            onChange={(value) => patch("outputPerMTok", value)}
          />
          <PriceField
            id="pricing-cache-read"
            label="Cache read /1M (optional)"
            value={form.cacheReadPerMTok}
            error={errors.cacheReadPerMTok}
            onChange={(value) => patch("cacheReadPerMTok", value)}
          />
          <PriceField
            id="pricing-cache-write"
            label="Cache write /1M (optional)"
            value={form.cacheWritePerMTok}
            error={errors.cacheWritePerMTok}
            onChange={(value) => patch("cacheWritePerMTok", value)}
          />
        </div>
      </FormDialog>

      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open && !deleting) setPendingDelete(null);
        }}
        title="Delete pricing entry?"
        description={
          pendingDelete
            ? `Remove the price for “${pendingDelete.modelMatch}”. The built-in seed rate (if any) applies again. Recorded run costs are unaffected.`
            : ""
        }
        confirmLabel="Delete"
        tone="destructive"
        busy={deleting}
        onConfirm={() => void confirmDelete()}
      />
    </SectionPane>
  );
}

/** One numeric price field (USD per 1M tokens) with a `$` addon + inline error. */
function PriceField(props: {
  id: string;
  label: string;
  value: string;
  error?: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={props.id}>{props.label}</Label>
      <InputGroup>
        <InputGroupAddon align="inline-start">
          <span className="text-muted-foreground">$</span>
        </InputGroupAddon>
        <InputGroupInput
          id={props.id}
          type="number"
          inputMode="decimal"
          step="any"
          min="0"
          value={props.value}
          onChange={(event) => props.onChange(event.target.value)}
          placeholder="0.00"
          className="tabular-nums"
          aria-invalid={props.error ? true : undefined}
        />
      </InputGroup>
      {props.error ? (
        <Text variant="meta" className="text-destructive" role="alert">
          {props.error}
        </Text>
      ) : null}
    </div>
  );
}

// Sentinel Select value for "no fallback" — Radix Select items may not use an empty string value.
const ASSISTANT_FALLBACK_NONE = "__assistant_fallback_none__";

/* ─────────────────────────────────────────────────────────────────────────────────────────────
 * Assistant sign-in (WP 0.2) — "powered by your Claude subscription". Three ways to
 * authenticate: a PTY sign-in flow (start → open the URL → paste the code), a manual token
 * paste, and an optional API-key fallback pointing at an existing Anthropic provider
 * credential. The token is stored encrypted server-side and never returned — this pane only
 * ever shows redacted status.
 *
 * Exported for the co-located component test (`assistant-card.test.tsx`); it is composed into
 * `SettingsDialog` above and not used standalone in the app.
 * ──────────────────────────────────────────────────────────────────────────────────────────── */

export function AssistantSection() {
  const [status, setStatus] = useState<AssistantAuthStatus | null>(null);
  const [providers, setProviders] = useState<ProviderCredential[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingFallback, setSavingFallback] = useState(false);

  const anthropicProviders = useMemo(
    () => providers.filter((provider) => provider.kind === "anthropic"),
    [providers],
  );

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [nextStatus, nextProviders] = await Promise.all([
        getAssistantAuthStatus(),
        listProviders(),
      ]);
      setStatus(nextStatus);
      setProviders(nextProviders);
    } catch (error) {
      notifyError("Couldn’t load the assistant sign-in status. Reload the page to try again.", {
        description: getErrorMessage(error),
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function onFallbackChange(value: string) {
    setSavingFallback(true);
    try {
      setStatus(await setAssistantFallback(value === ASSISTANT_FALLBACK_NONE ? null : value));
      toast.success(value === ASSISTANT_FALLBACK_NONE ? "Fallback cleared" : "Fallback set");
    } catch (error) {
      notifyError("Couldn’t update the fallback. Try again.", {
        description: getErrorMessage(error),
      });
    } finally {
      setSavingFallback(false);
    }
  }

  const fallbackValue = status?.fallbackProviderCredentialId ?? ASSISTANT_FALLBACK_NONE;

  return (
    <SectionPane
      title="Assistant"
      description="Powered by your Claude subscription. Sign in with your Claude account to enable the in-app assistant. Your token is stored encrypted and never leaves this machine."
    >
      {/* The stored-token surface — status, sign-in, paste, and reset. Shared verbatim with the
          Providers section's `claude_subscription` credential modal so the two can never drift. */}
      <ClaudeSubscriptionAuthPanel
        status={status}
        loading={loading}
        onStatusChange={setStatus}
        idPrefix="assistant"
      />

      {status ? (
        <>
          <Separator />

          {/* API-key fallback (D-AS14) — assistant-only, so it stays here rather than in the panel. */}
          <div className="flex flex-col gap-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <Label htmlFor="assistant-fallback">API-key fallback</Label>
              {status.fallbackConfigured ? (
                <Badge variant="secondary">API-key fallback set</Badge>
              ) : null}
            </div>
            <Select
              value={fallbackValue}
              onValueChange={(value) => void onFallbackChange(value)}
              disabled={savingFallback || anthropicProviders.length === 0}
            >
              <SelectTrigger id="assistant-fallback" className="w-full">
                <SelectValue placeholder="No fallback" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ASSISTANT_FALLBACK_NONE}>No fallback</SelectItem>
                {anthropicProviders.map((provider) => (
                  <SelectItem key={provider.id} value={provider.id}>
                    {provider.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Text variant="meta" tone="muted">
              {anthropicProviders.length > 0
                ? "Used only when your subscription hits a limit — never silently, and never for a normal turn."
                : "Add an Anthropic provider credential in the Providers section to offer an API-key fallback."}
            </Text>
          </div>
        </>
      ) : null}
    </SectionPane>
  );
}

/* ─────────────────────────────────────────────────────────────────────────────────────────────
 * Storage — SQLite housekeeping (ST4). Puts the existing `POST /api/maintenance/*` endpoints
 * behind a UI so an operator can reclaim space and enforce retention without a shell. Every
 * action runs behind a ConfirmDialog (prune is destructive) and reports the API's own result
 * honestly — the returned message for checkpoint/vacuum, the real pruned/kept counts for prune.
 * ──────────────────────────────────────────────────────────────────────────────────────────── */

type MaintenanceAction = "checkpoint" | "vacuum" | "prune" | "prune-assistant" | "prune-runs";

/** ConfirmDialog copy per maintenance action — prune is destructive (it deletes scan/thread history). */
const MAINTENANCE_DIALOGS: Record<
  MaintenanceAction,
  { title: string; description: string; confirmLabel: string; tone: "default" | "destructive" }
> = {
  checkpoint: {
    title: "Checkpoint the write-ahead log?",
    description:
      "Flushes the SQLite write-ahead log (-wal) back into the main database file and truncates it. Fast and safe to run anytime.",
    confirmLabel: "Run checkpoint",
    tone: "default",
  },
  vacuum: {
    title: "Vacuum the database?",
    description:
      "Rewrites the whole database file to reclaim space freed by deleted scans and runs, and defragments it. Safe, but can take a moment on a large database.",
    confirmLabel: "Run vacuum",
    tone: "default",
  },
  prune: {
    title: "Prune old scans?",
    description:
      "Deletes older scans on every server, keeping only the newest per server. This permanently removes scan history and cannot be undone.",
    confirmLabel: "Prune scans",
    tone: "destructive",
  },
  "prune-assistant": {
    title: "Prune old assistant threads?",
    description:
      "Deletes assistant threads (and their message history) older than the retention window, plus orphaned skill-workspace/session files. This permanently removes chat history and cannot be undone.",
    confirmLabel: "Prune assistant data",
    tone: "destructive",
  },
  "prune-runs": {
    title: "Prune runs per the retention policy?",
    description:
      "Deletes runs matching the saved retention policy below (steps, events, grades, and search index entries included). Pinned runs are never affected. This permanently removes run history and cannot be undone.",
    confirmLabel: "Prune runs",
    tone: "destructive",
  },
};

/** One simple maintenance action row (icon · title · description · trigger button). */
function MaintenanceRow(props: {
  icon: typeof Database;
  title: string;
  description: string;
  actionLabel: string;
  onRun: () => void;
  disabled: boolean;
}) {
  const Icon = props.icon;
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-muted/40 px-3 py-2">
      <span className="flex min-w-0 items-center gap-2.5">
        <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <span className="min-w-0">
          <span className="block truncate font-medium">{props.title}</span>
          <Text variant="meta" tone="muted">
            {props.description}
          </Text>
        </span>
      </span>
      <Button variant="outline" size="sm" onClick={props.onRun} disabled={props.disabled}>
        {props.actionLabel}
      </Button>
    </li>
  );
}

/* ─────────────────────────────────────────────────────────────────────────────────────────────
 * GitHub — the app-wide GitHub account, signed in via the OAuth 2.0 DEVICE FLOW against an
 * owner-registered GitHub OAuth App (its client id is public configuration; the device flow uses
 * no client secret and needs no callback URL). The resulting access token lives ONLY in the API
 * (stored encrypted, never returned); skill GitHub operations use it as the LAST token fallback:
 * explicit dialog token → the skill's stored PAT → this account.
 * ──────────────────────────────────────────────────────────────────────────────────────────── */

function GithubSection() {
  const [account, setAccount] = useState<GithubAccountStatus | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [clientId, setClientId] = useState("");
  const [savingClientId, setSavingClientId] = useState(false);

  // Sign-in flow state: the started flow (code + link) while polling is in progress.
  const [flow, setFlow] = useState<GithubDeviceStart | null>(null);
  const [flowError, setFlowError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const status = await getGithubAccount();
      setAccount(status);
      setClientId((current) => current || status.clientId || "");
      setLoadError(null);
    } catch (err) {
      setLoadError(
        getErrorMessage(err, "Couldn’t load the GitHub account state. Reload the page to try again."),
      );
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Poll the in-flight device flow at GitHub's cadence until connected / a terminal failure.
  // Timeout-chained (not setInterval) so a `slow_down` bump applies to the NEXT wait; cancelled
  // by unmount or by the flow being cleared (sign-in finished, failed, or cancelled).
  useEffect(() => {
    if (!flow) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    let interval = flow.interval;

    const tick = async () => {
      if (cancelled) return;
      try {
        const result = await pollGithubDeviceFlow(flow.flowId);
        if (cancelled) return;
        if (result.status === "connected") {
          setFlow(null);
          setAccount(result.account);
          toast.success(`Signed in as ${result.account.login ?? "GitHub user"}`);
          return;
        }
        interval = result.interval;
        timer = setTimeout(() => void tick(), interval * 1000);
      } catch (err) {
        if (cancelled) return;
        setFlow(null);
        setFlowError(getErrorMessage(err, "Couldn’t sign in to GitHub. Try again."));
      }
    };

    timer = setTimeout(() => void tick(), interval * 1000);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [flow]);

  async function handleSaveClientId() {
    setSavingClientId(true);
    try {
      const status = await setGithubClientId(clientId.trim());
      setAccount(status);
      toast.success("Client ID saved");
    } catch (err) {
      notifyError("Couldn’t save the client ID. Try again.", {
        description: getErrorMessage(err),
      });
    } finally {
      setSavingClientId(false);
    }
  }

  async function handleSignIn() {
    setStarting(true);
    setFlowError(null);
    try {
      setFlow(await startGithubDeviceFlow());
    } catch (err) {
      setFlowError(getErrorMessage(err, "Couldn’t start the GitHub sign-in. Try again."));
    } finally {
      setStarting(false);
    }
  }

  async function handleSignOut() {
    setSigningOut(true);
    try {
      setAccount(await disconnectGithubAccount());
      toast.success("Signed out of GitHub");
    } catch (err) {
      notifyError("Couldn’t sign out of GitHub. Try again.", {
        description: getErrorMessage(err),
      });
    } finally {
      setSigningOut(false);
    }
  }

  const clientIdDirty = clientId.trim() !== (account?.clientId ?? "");

  // Publish the client-id form so a dirty section switch / close prompts a discard guard and the
  // dialog footer owns Save + Discard (design-remediation T5, items 1/6).
  useRegisterSettingsForm({
    dirty: clientIdDirty,
    saving: savingClientId,
    canSave: clientId.trim().length > 0,
    save: () => void handleSaveClientId(),
    reset: () => setClientId(account?.clientId ?? ""),
    saveLabel: "Save client ID",
  });

  return (
    <SectionPane
      title="GitHub"
      description="Sign in once and every skill GitHub operation (import, pull, push, pull requests, publish) can act as your account. A token typed in a dialog or stored on a skill still wins."
    >
      {loadError ? (
        <Alert variant="destructive">
          <AlertDescription>{loadError}</AlertDescription>
        </Alert>
      ) : null}

      {/* OAuth App client id — one-time public configuration for the device flow. */}
      <RowGroup>
        <SettingsRow
          htmlFor="github-client-id"
          label="OAuth App client ID"
          description={
            <>
              From a GitHub OAuth App you register once (Settings → Developer settings → OAuth Apps)
              with “Enable Device Flow” checked. Public configuration — no client secret is used.
            </>
          }
        >
          {/* Save + Discard live in the persistent dialog footer (design-remediation T5, item 6). */}
          <Input
            id="github-client-id"
            name="github-client-id"
            className="w-56"
            value={clientId}
            placeholder="Iv1.…"
            spellCheck={false}
            autoComplete="off"
            onChange={(event) => setClientId(event.target.value)}
          />
        </SettingsRow>

        {/* Account row — the signed-in identity, or the sign-in affordance. */}
        <SettingsRow
          label="Account"
          description={
            account?.connected
              ? "Skill GitHub operations without their own token run as this account."
              : "Not signed in — operations fall back to per-skill tokens only."
          }
        >
          {account?.connected ? (
            <>
              <Avatar className="size-7">
                {account.avatarUrl ? <AvatarImage src={account.avatarUrl} alt="" /> : null}
                <AvatarFallback>{(account.login ?? "?").slice(0, 2).toUpperCase()}</AvatarFallback>
              </Avatar>
              <div className="flex min-w-0 flex-col">
                <Text className="truncate font-medium">{account.login}</Text>
                {account.scopes && account.scopes.length > 0 ? (
                  <Text variant="meta" tone="muted" className="truncate">
                    {account.scopes.join(", ")}
                  </Text>
                ) : null}
              </div>
              <Button
                variant="outline"
                size="sm"
                disabled={signingOut}
                onClick={() => void handleSignOut()}
              >
                <LogOut aria-hidden className="size-4" /> Sign out
              </Button>
            </>
          ) : (
            <Button
              disabled={starting || !account?.clientIdConfigured || flow !== null}
              onClick={() => void handleSignIn()}
            >
              {starting ? <Spinner className="size-4" /> : <Github aria-hidden />}
              Sign in with GitHub
            </Button>
          )}
        </SettingsRow>
      </RowGroup>

      {flowError ? (
        <Alert variant="destructive">
          <AlertDescription>{flowError}</AlertDescription>
        </Alert>
      ) : null}

      {/* In-flight device flow: the code to confirm on github.com + the polling state. */}
      {flow ? (
        <div className="flex flex-col gap-3 rounded-md border border-border p-4">
          <Text>
            Enter this code at{" "}
            <a
              href={flow.verificationUri}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-primary underline underline-offset-2"
            >
              {flow.verificationUri.replace(/^https:\/\//, "")}
              <ExternalLink className="size-3.5" aria-hidden />
            </a>
          </Text>
          <div className="flex items-center gap-3">
            <Text className="select-all font-mono text-kpi font-semibold tracking-widest">
              {flow.userCode}
            </Text>
            <IconButton
              variant="ghost"
              size="icon"
              label="Copy code"
              onClick={() => {
                void navigator.clipboard.writeText(flow.userCode);
                toast.success("Code copied");
              }}
            >
              <Copy aria-hidden />
            </IconButton>
          </div>
          <div className="flex items-center gap-2">
            <Spinner className="size-4" />
            <Text variant="meta" tone="muted">
              Waiting for you to confirm on GitHub…
            </Text>
            <Button variant="ghost" size="sm" onClick={() => setFlow(null)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : null}
    </SectionPane>
  );
}

function StorageSection() {
  const [pending, setPending] = useState<MaintenanceAction | null>(null);
  const [busy, setBusy] = useState(false);
  // Optional override for the prune keep-count; `null` = use the server's configured retention.
  const [keep, setKeep] = useState<number | null>(null);
  // Optional override for the assistant prune's retention window (days); `null` = server default.
  const [assistantDays, setAssistantDays] = useState<number | null>(null);

  // Observability (WP1.6) — the run-retention prune policy: a minimal JSON-backed form (per-status
  // rules; pinned runs are never affected). Loaded once on mount; `PUT` persists it, `POST prune-runs`
  // applies it (no query-param override — the policy IS the configuration).
  const [retentionPolicyText, setRetentionPolicyText] = useState("");
  // Last-saved baseline + a loaded flag (design-remediation T5, items 1/6) so the dialog footer +
  // guard know when the JSON policy is dirty and what "Discard" reverts to.
  const [savedRetentionPolicyText, setSavedRetentionPolicyText] = useState("");
  const [policyLoaded, setPolicyLoaded] = useState(false);
  const [retentionPolicyError, setRetentionPolicyError] = useState<string | null>(null);
  const [retentionPolicyLoadError, setRetentionPolicyLoadError] = useState<string | null>(null);
  const [savingPolicy, setSavingPolicy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const policy = await apiGet<RunRetentionPolicy>("/api/maintenance/run-retention-policy");
        if (!cancelled) {
          const text = JSON.stringify(policy, null, 2);
          setRetentionPolicyText(text);
          setSavedRetentionPolicyText(text);
          setPolicyLoaded(true);
        }
      } catch (error) {
        if (!cancelled) {
          setRetentionPolicyLoadError(
            getErrorMessage(
              error,
              "Couldn’t load the run retention policy. Reload the page to try again.",
            ),
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function saveRetentionPolicy() {
    let parsed: unknown;
    try {
      parsed = JSON.parse(retentionPolicyText);
    } catch {
      setRetentionPolicyError("Not valid JSON.");
      return;
    }
    setRetentionPolicyError(null);
    setSavingPolicy(true);
    try {
      const saved = await apiPut<RunRetentionPolicy>(
        "/api/maintenance/run-retention-policy",
        parsed,
      );
      const text = JSON.stringify(saved, null, 2);
      setRetentionPolicyText(text);
      setSavedRetentionPolicyText(text);
      toast.success("Run retention policy saved");
    } catch (error) {
      setRetentionPolicyError(getErrorMessage(error, "Couldn’t save the policy. Try again."));
    } finally {
      setSavingPolicy(false);
    }
  }

  // Publish the retention-policy form (design-remediation T5, items 1/6) — a dirty section switch /
  // close prompts a discard guard and the dialog footer owns Save + Discard. Only once loaded (there's
  // no form to guard while the JSON is still fetching or failed to load).
  const retentionPolicyDirty = policyLoaded && retentionPolicyText !== savedRetentionPolicyText;
  const resetRetentionPolicy = useCallback(() => {
    setRetentionPolicyText(savedRetentionPolicyText);
    setRetentionPolicyError(null);
  }, [savedRetentionPolicyText]);
  useRegisterSettingsForm(
    policyLoaded
      ? {
          dirty: retentionPolicyDirty,
          saving: savingPolicy,
          canSave: retentionPolicyDirty,
          save: () => void saveRetentionPolicy(),
          reset: resetRetentionPolicy,
          saveLabel: "Save policy",
        }
      : null,
  );

  async function run(action: MaintenanceAction) {
    setBusy(true);
    try {
      if (action === "prune") {
        const query = keep !== null ? `?keep=${keep}` : "";
        const result = await apiPost<ScanRetentionResult>(
          `/api/maintenance/prune-scans${query}`,
          {},
        );
        const count = result.prunedScanIds.length;
        toast.success(
          count === 0
            ? result.keep === 0
              ? "Retention is disabled (keep = 0) — nothing was pruned."
              : `No scans to prune — every server is within ${result.keep} per server.`
            : `Pruned ${count} ${count === 1 ? "scan" : "scans"}, keeping ${result.keep} per server.`,
        );
      } else if (action === "prune-assistant") {
        const query = assistantDays !== null ? `?days=${assistantDays}` : "";
        const result = await apiPost<AssistantPruneResult>(
          `/api/maintenance/prune-assistant${query}`,
          {},
        );
        const count = result.prunedThreadIds.length;
        const swept =
          result.removedOrphanWorkspaceDirs +
          result.removedOrphanScratchDirs +
          result.removedStaleSessionDirs;
        toast.success(
          count === 0 && swept === 0
            ? result.retentionDays === 0
              ? "Retention is disabled (days = 0) — nothing was pruned."
              : `No threads older than ${result.retentionDays} days — nothing to prune.`
            : `Pruned ${count} ${count === 1 ? "thread" : "threads"}; swept ${swept} orphaned/stale ${swept === 1 ? "directory" : "directories"}.`,
        );
      } else if (action === "prune-runs") {
        const result = await apiPost<RunPruneResult>("/api/maintenance/prune-runs", {});
        const count = result.prunedRunIds.length;
        const hasAnyRule = Object.keys(result.policy.byStatus).length > 0;
        toast.success(
          count === 0
            ? hasAnyRule
              ? "No runs matched the saved policy — nothing to prune."
              : "The saved policy is empty (byStatus: {}) — pruning is off, nothing was pruned."
            : `Pruned ${count} ${count === 1 ? "run" : "runs"} (${result.deletedSteps} steps, ${result.deletedEvents} events removed). Pinned runs were never affected.`,
        );
      } else {
        const result = await apiPost<MaintenanceResult>(`/api/maintenance/${action}`, {});
        if (result.ok) toast.success(result.message);
        else notifyError(result.message);
      }
    } catch (error) {
      notifyError("Couldn’t complete the maintenance action. Try again.", {
        description: getErrorMessage(error),
      });
    } finally {
      setBusy(false);
      setPending(null);
    }
  }

  const dialog = pending ? MAINTENANCE_DIALOGS[pending] : null;

  return (
    <SectionPane
      title="Storage"
      description="Local SQLite housekeeping — these act on the database this app runs against."
    >
      <ul className="flex flex-col gap-2">
        <MaintenanceRow
          icon={Database}
          title="Checkpoint WAL"
          description="Flush the write-ahead log into the main database file."
          actionLabel="Checkpoint"
          onRun={() => setPending("checkpoint")}
          disabled={busy}
        />
        <MaintenanceRow
          icon={Recycle}
          title="Vacuum"
          description="Rewrite the database to reclaim space from deleted rows."
          actionLabel="Vacuum"
          onRun={() => setPending("vacuum")}
          disabled={busy}
        />
        <li className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-muted/40 px-3 py-2">
          <span className="flex min-w-0 items-center gap-2.5">
            <Trash2 className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            <span className="min-w-0">
              <span className="block truncate font-medium">Prune old scans</span>
              <Text variant="meta" tone="muted">
                Keep only the newest scans per server. Leave blank to use the configured retention.
              </Text>
            </span>
          </span>
          <span className="flex shrink-0 items-center gap-2">
            <div className="w-44">
              <BoundedNumber
                id="prune-keep"
                value={keep}
                onChange={setKeep}
                min={0}
                placeholder="Server default"
                aria-label="Scans to keep per server"
              />
            </div>
            <Button variant="outline" size="sm" onClick={() => setPending("prune")} disabled={busy}>
              Prune scans
            </Button>
          </span>
        </li>
        <li className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-muted/40 px-3 py-2">
          <span className="flex min-w-0 items-center gap-2.5">
            <MessageSquare className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            <span className="min-w-0">
              <span className="block truncate font-medium">Prune assistant threads</span>
              <Text variant="meta" tone="muted">
                Delete old chat threads, plus orphaned workspace/session files. Leave blank to use
                the configured retention.
              </Text>
            </span>
          </span>
          <span className="flex shrink-0 items-center gap-2">
            <div className="w-44">
              <BoundedNumber
                id="prune-assistant-days"
                value={assistantDays}
                onChange={setAssistantDays}
                min={0}
                placeholder="Server default"
                aria-label="Assistant thread retention in days"
              />
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPending("prune-assistant")}
              disabled={busy}
            >
              Prune assistant data
            </Button>
          </span>
        </li>
        <li className="flex flex-col gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2">
          <span className="flex min-w-0 items-start gap-2.5">
            <Pin className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
            <span className="min-w-0">
              <span className="block truncate font-medium">Run retention policy</span>
              <Text variant="meta" tone="muted">
                Per-status prune rules (JSON) — <code className="font-mono">olderThanDays</code>
                and/or <code className="font-mono">keepNewest</code> per terminal status. Pinned
                runs are never pruned. An empty <code className="font-mono">{"{ }"}</code> keeps
                pruning off.
              </Text>
            </span>
          </span>
          {retentionPolicyLoadError ? (
            <Alert variant="destructive">
              <AlertDescription>{retentionPolicyLoadError}</AlertDescription>
            </Alert>
          ) : (
            <>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="run-retention-policy" className="sr-only">
                  Run retention policy (JSON)
                </Label>
                <Textarea
                  id="run-retention-policy"
                  rows={6}
                  className="font-mono text-meta"
                  spellCheck={false}
                  value={retentionPolicyText}
                  placeholder={'{ "byStatus": { "completed": { "olderThanDays": 90 } } }'}
                  aria-invalid={retentionPolicyError ? true : undefined}
                  onChange={(e) => {
                    setRetentionPolicyText(e.target.value);
                    if (retentionPolicyError) setRetentionPolicyError(null);
                  }}
                />
                {retentionPolicyError ? (
                  <Text variant="meta" className="text-destructive">
                    {retentionPolicyError}
                  </Text>
                ) : null}
              </div>
              {/* Save + Discard for the policy edit live in the persistent dialog footer
                  (design-remediation T5, item 6). "Prune runs now" applies the SAVED policy and
                  stays here as an immediate action. When there are unsaved edits, a hint says so
                  (it prunes the SAVED policy, not what's typed). */}
              <div className="flex shrink-0 flex-col items-end gap-1">
                {retentionPolicyDirty ? (
                  <Text variant="meta" tone="muted">
                    Pruning uses the saved policy — save your edit above to apply it.
                  </Text>
                ) : null}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPending("prune-runs")}
                  disabled={busy}
                >
                  Prune runs now
                </Button>
              </div>
            </>
          )}
        </li>
      </ul>

      <ConfirmDialog
        open={pending !== null}
        onOpenChange={(open) => {
          if (!open && !busy) setPending(null);
        }}
        title={dialog?.title ?? ""}
        description={dialog?.description}
        confirmLabel={dialog?.confirmLabel ?? "Confirm"}
        tone={dialog?.tone}
        busy={busy}
        onConfirm={() => {
          if (pending) void run(pending);
        }}
      />
    </SectionPane>
  );
}
