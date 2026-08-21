/**
 * dialog-kit.guardrail.test.ts — design-remediation T2 guardrail (critique §"Consistency and
 * Standards": "A documented design system is bypassed by the code that documents it" — the four-tier
 * dialog kit in `components/dialogs/index.ts` was ignored by 10+ modals that hand-rolled the same
 * `size="lg|xl" className="flex max-h-[85vh] flex-col gap-0 p-0"` shell around a bare
 * `<DialogContent>`).
 *
 * Every dialog must go through the kit (`ConfirmDialog` / `FormDialog` / `WideDialog` /
 * `WorkbenchDialog`), which own the ONLY sanctioned `<DialogContent>` usages. A bare `<DialogContent>`
 * anywhere else is the anti-pattern this catches.
 *
 * ── RATCHET, not a blanket ban ──────────────────────────────────────────────────────────────────
 * ~30 modals outside the Servers/Skills cluster (hub / testing / scans / settings) still hand-roll
 * `<DialogContent>`; they are owned by other remediation tasks/waves and are NOT in scope here. A
 * blanket app-wide ban would fail the build dishonestly. Instead this asserts against an ALLOWLIST
 * that can only SHRINK: it is seeded with the files that hand-rolled `<DialogContent>` at the time
 * of this migration, MINUS the nine Servers/Skills dialogs this task moved onto the kit. As future
 * waves migrate more of these, they delete the corresponding allowlist entries — the list never
 * grows (a NEW bare `<DialogContent>` in a non-allowlisted file turns this RED), and the migrated
 * files can never regress back onto a bare shell.
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** The JSX open tag for a raw dialog surface (assembled so this guardrail file never self-matches). */
const BARE_DIALOG_CONTENT = `<${"DialogContent"}`;

/** The ONLY place a bare `<DialogContent>` is sanctioned — the kit tier components themselves. */
const KIT_DIR = "components/dialogs/";

/**
 * The Servers/Skills dialogs that task moved onto the kit — they must contain NO bare
 * `<DialogContent>` and must NOT appear on the allowlist below.
 *
 * It was nine. RM-30 WP 7.4 DELETED one of them — `workspace/SaveWorkspaceDialog.tsx`, the
 * Inspector Files tab's own version-creating save — because that tab is browse-only now and the
 * Studio's one draft owns the only save path. A deleted dialog cannot regress onto a bare shell, so
 * dropping the row is the honest bookkeeping; the ratchet on the remaining eight is unchanged, and
 * the file must NOT come back without coming back onto the kit.
 */
const MIGRATED_ONTO_KIT: readonly string[] = [
  "features/servers/ServerWizard.tsx",
  "features/servers/ManageServerTypesDialog.tsx",
  "features/skills/SkillWizard.tsx",
  "features/skills/ScaffoldFromServerWizard.tsx",
  "features/skills/GithubSourceDialog.tsx",
  "features/skills/PublishGithubDialog.tsx",
  "features/skills/PushGithubDialog.tsx",
  "features/skills/design/SaveVersionDialog.tsx",
];

/** Dialogs on that list that have since been DELETED — they must stay gone, not silently return. */
const DELETED_SINCE: readonly string[] = ["features/skills/workspace/SaveWorkspaceDialog.tsx"];

/**
 * Files that STILL hand-roll a bare `<DialogContent>` and are OUT OF SCOPE for this task (owned by
 * other remediation waves). A ratchet: entries may only be REMOVED (as later waves migrate them),
 * never added. `features/skills/design/BindServerDialog.tsx` stays here deliberately — it is a
 * parked-Design-tab picker with only a "Close" action (no primary), which no kit tier models
 * cleanly, so it was left for a later, dedicated pass rather than forced into `FormDialog`.
 */
const ALLOWLIST: ReadonlySet<string> = new Set([
  "features/hub/AddHubSkillModal.tsx",
  "features/hub/ArtifactCanvas.tsx",
  "features/hub/ComposerCommands.tsx",
  "features/hub/HubPinnedFileDialog.tsx",
  "features/hub/MissionExpandDialog.tsx",
  "features/hub/MissionPlanCard.tsx",
  "features/hub/SessionSkillsPanel.tsx",
  "features/hub/memory/ProfileMemoryDialog.tsx",
  "features/hub/meta-rail/ManageToolScopeDialog.tsx",
  "features/hub/workforce/crew-profile/CrewProfileModal.tsx",
  "features/reports/ServerReportDialog.tsx",
  "features/scans/ResourcePromptRun.tsx",
  "features/scans/ToolDetailPanel.tsx",
  "features/scans/ToolPlayground.tsx",
  "features/settings/SettingsView.tsx",
  "features/skills/design/BindServerDialog.tsx",
  "features/skills/design/CommandDialog.tsx",
  "features/skills/design/UnifiedEditor.tsx",
  "features/skills/workspace/WorkspaceDialogs.tsx",
  "features/testing/AddServerModal.tsx",
  "features/testing/AddSkillModal.tsx",
  "features/testing/ExpandableTable.tsx",
  "features/testing/ForkDialog.tsx",
  "features/testing/collections/CollectionEditor.tsx",
  "features/testing/collections/CollectionsView.tsx",
  "features/testing/collections/ImportInsightBenchDialog.tsx",
  "features/testing/run-launcher/RunLauncher.tsx",
  "features/testing/runs/RunSavedViews.tsx",
  "features/testing/suites/SuiteEditor.tsx",
  "features/watch/RuleAuditDialog.tsx",
]);

/** Every `.tsx` under `src` (posix-relative to `src`), skipping test files. */
function collectTsxFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectTsxFiles(full, acc);
    } else if (entry.isFile() && entry.name.endsWith(".tsx") && !/\.test\.tsx$/.test(entry.name)) {
      acc.push(path.relative(SRC_ROOT, full).split(path.sep).join("/"));
    }
  }
  return acc;
}

const allTsx = collectTsxFiles(SRC_ROOT);
const bareDialogFiles = allTsx.filter(
  (rel) => !rel.startsWith(KIT_DIR) && readFileSync(path.join(SRC_ROOT, rel), "utf8").includes(BARE_DIALOG_CONTENT),
);

describe("GUARDRAIL — every dialog goes through the kit (bare <DialogContent> is ratcheted)", () => {
  it("no file outside components/dialogs/ uses a bare <DialogContent> unless it is on the shrinking allowlist", () => {
    const offenders = bareDialogFiles.filter((rel) => !ALLOWLIST.has(rel));
    expect(
      offenders,
      `these files hand-roll a bare <DialogContent> but aren't on the allowlist — route them through ` +
        `components/dialogs/ (ConfirmDialog / FormDialog / WideDialog / WorkbenchDialog):\n  ${offenders.join(
          "\n  ",
        )}`,
    ).toEqual([]);
  });

  it("every migrated Servers/Skills dialog is NOT on the allowlist and hand-rolls no bare <DialogContent>", () => {
    for (const rel of MIGRATED_ONTO_KIT) {
      expect(ALLOWLIST.has(rel), `${rel} was migrated onto the kit — it must not be on the allowlist`).toBe(
        false,
      );
      const onDisk = allTsx.includes(rel);
      expect(onDisk, `${rel} should exist`).toBe(true);
      expect(
        bareDialogFiles.includes(rel),
        `${rel} was migrated onto the kit — it must not contain a bare <DialogContent>`,
      ).toBe(false);
    }
  });

  it("a dialog deleted by a later work package has not silently come back", () => {
    for (const rel of DELETED_SINCE) {
      expect(
        allTsx.includes(rel),
        `${rel} was deleted (RM-30 WP 7.4 — the Inspector's Files tab is browse-only and the Studio ` +
          `owns the only save path). If it is genuinely needed again, put it back on the kit and on ` +
          `MIGRATED_ONTO_KIT, not here.`,
      ).toBe(false);
    }
  });
});
