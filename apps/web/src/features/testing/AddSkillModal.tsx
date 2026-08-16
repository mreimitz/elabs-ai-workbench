import { useEffect, useMemo, useState } from "react";
import type { AllowedSkill, Skill, SkillVersion } from "@mcp-token-footprint/shared";
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Label,
  RadioGroup,
  RadioGroupItem,
  ScrollArea,
  StatePanel,
  Switch,
  Text,
  Wizard,
  WizardStep,
  WizardSteps,
} from "@brand/ui";
import { ChevronRight, Sparkles } from "lucide-react";
import { formatNumber } from "../../lib/format";

const STEPS = [
  { id: "skill", title: "Select skill", description: "Pick a registered skill" },
  { id: "version", title: "Version & mode", description: "Choose the version + eager toggle" },
] as const;

/** The sentinel value for the "Latest (tracks the current version)" radio option. */
const LATEST = "__latest__";

/**
 * Nested two-step Dialog opened from the Environment editor's right panel to append one
 * {@link AllowedSkill} to the environment. Mirrors {@link import("./AddServerModal").AddServerModal}:
 * step 1 picks a registered skill NOT already attached (no double-add); step 2 chooses `Latest`
 * (tracks the current version at run time) or a specific pinned version, plus the eager toggle. The
 * per-choice footprint (L1 always, +L2 when eager) is previewed so the attachment's cost is visible
 * before it lands. Radix manages the nested overlay/focus; the parent Dialog stays put.
 */
export function AddSkillModal(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  skills: Skill[];
  skillVersions: Map<string, SkillVersion[]>;
  existing: AllowedSkill[];
  onAdd: (entry: AllowedSkill) => void;
}) {
  const { open, onOpenChange, skills, skillVersions, existing, onAdd } = props;
  const [step, setStep] = useState(0);
  const [skillId, setSkillId] = useState<string | null>(null);
  // The selected version id, or `LATEST` for run-time latest tracking.
  const [choice, setChoice] = useState<string>(LATEST);
  const [eager, setEager] = useState(false);

  // Skills still available to attach (not already on the environment).
  const available = useMemo(() => {
    const used = new Set(existing.map((entry) => entry.skillId));
    return skills.filter((skill) => !used.has(skill.id));
  }, [skills, existing]);

  // Reset the flow whenever the modal opens.
  useEffect(() => {
    if (!open) return;
    setStep(0);
    setSkillId(null);
    setChoice(LATEST);
    setEager(false);
  }, [open]);

  const chosenSkill = skillId ? (skills.find((skill) => skill.id === skillId) ?? null) : null;
  // Newest version first (highest seq), so the version list reads top-down like a changelog.
  const versions = useMemo(() => {
    const list = skillId ? (skillVersions.get(skillId) ?? []) : [];
    return [...list].sort((left, right) => right.seq - left.seq);
  }, [skillId, skillVersions]);

  function chooseSkill(id: string) {
    setSkillId(id);
    setChoice(LATEST);
    setEager(false);
    setStep(1);
  }

  // The version whose footprint the preview reflects: the pinned pick, or (for latest) the skill's
  // current version resolved from the loaded list.
  const previewVersion = useMemo(() => {
    if (choice !== LATEST) return versions.find((version) => version.id === choice);
    const currentId = chosenSkill?.currentVersionId;
    return currentId ? versions.find((version) => version.id === currentId) : undefined;
  }, [choice, versions, chosenSkill]);

  const previewTokens = previewVersion
    ? previewVersion.l1MetadataTokens + (eager ? previewVersion.l2BodyTokens : 0)
    : 0;

  const canConfirm =
    skillId !== null && (choice === LATEST || versions.some((v) => v.id === choice));
  // Why the confirm action is disabled — surfaced inline next to the button (interaction-guidelines:
  // don't leave a silently-disabled control).
  const disabledReason =
    step !== 1
      ? "Pick a skill to continue."
      : !canConfirm
        ? "Choose a version to add this skill."
        : null;

  function confirm() {
    if (!skillId) return;
    const entry: AllowedSkill =
      choice === LATEST
        ? { skillId, versionMode: "latest", eager }
        : { skillId, versionMode: "pinned", pinnedVersionId: choice, eager };
    onAdd(entry);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg" className="flex max-h-[85vh] flex-col gap-0 p-0">
        <DialogHeader className="flex-none gap-1 border-b border-border p-4 pe-12">
          <DialogTitle>Add skill to environment</DialogTitle>
          <DialogDescription>
            Pick a registered skill, then track its latest version or pin a specific one — and
            choose whether to eagerly inline its SKILL.md body.
          </DialogDescription>
        </DialogHeader>

        <Wizard steps={[...STEPS]} step={step} className="flex min-h-0 flex-1 flex-col gap-0">
          <div className="flex-none border-b border-border p-4">
            <WizardSteps />
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            {/* Step 1 — Select skill */}
            <WizardStep step={0} className="flex flex-col gap-2 outline-none">
              {available.length === 0 ? (
                <StatePanel
                  kind="empty"
                  icon={<Sparkles aria-hidden />}
                  title={skills.length === 0 ? "No skills registered" : "All skills already added"}
                  description={
                    skills.length === 0
                      ? "Register a skill under Skills, then return here to attach it to this environment."
                      : "Every registered skill is already attached to this environment."
                  }
                />
              ) : (
                <ul className="flex flex-col gap-2">
                  {available.map((skill) => {
                    const count = skillVersions.get(skill.id)?.length ?? skill.versionCount;
                    return (
                      <li key={skill.id} className="min-w-0">
                        <Button
                          variant="outline"
                          className="h-auto w-full justify-between gap-3 px-3 py-2.5"
                          onClick={() => chooseSkill(skill.id)}
                        >
                          <span className="flex min-w-0 items-center gap-2">
                            <Sparkles
                              className="size-4 shrink-0 text-muted-foreground"
                              aria-hidden
                            />
                            <span className="truncate">{skill.displayName}</span>
                          </span>
                          <span className="flex shrink-0 items-center gap-2">
                            <Badge variant="secondary" className="tabular-nums">
                              {count} {count === 1 ? "version" : "versions"}
                            </Badge>
                            <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
                          </span>
                        </Button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </WizardStep>

            {/* Step 2 — Version & mode */}
            <WizardStep step={1} className="flex flex-col gap-4 outline-none">
              <div className="flex items-center justify-between gap-3">
                <Label className="flex min-w-0 items-center gap-2">
                  <Sparkles className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="truncate">{chosenSkill?.displayName ?? "Skill"}</span>
                </Label>
                <Text variant="meta" tone="muted" className="shrink-0 tabular-nums">
                  {formatNumber(previewTokens)} tok {eager ? "(L1 + L2)" : "(L1)"}
                </Text>
              </div>

              <RadioGroup value={choice} onValueChange={setChoice} className="flex flex-col gap-1">
                <ScrollArea className="max-h-72 rounded-md border border-border">
                  <ul className="flex flex-col gap-1 p-2">
                    <li className="flex items-center justify-between gap-3">
                      <Label
                        htmlFor="skill-version-latest"
                        className="flex min-w-0 items-center gap-2 font-normal"
                      >
                        <RadioGroupItem id="skill-version-latest" value={LATEST} />
                        <span className="truncate">
                          Latest — track the current version at run time
                        </span>
                      </Label>
                      {chosenSkill?.currentVersionId &&
                      previewVersionLabel(versions, chosenSkill.currentVersionId) ? (
                        <Badge variant="outline" className="shrink-0 tabular-nums">
                          {previewVersionLabel(versions, chosenSkill.currentVersionId)}
                        </Badge>
                      ) : null}
                    </li>
                    {versions.map((version) => {
                      const radioId = `skill-version-${version.id}`;
                      return (
                        <li key={version.id} className="flex items-center justify-between gap-3">
                          <Label
                            htmlFor={radioId}
                            className="flex min-w-0 items-center gap-2 font-normal"
                          >
                            <RadioGroupItem id={radioId} value={version.id} />
                            <span className="truncate">{version.versionLabel}</span>
                          </Label>
                          <Text variant="meta" tone="muted" className="shrink-0 tabular-nums">
                            L1 {formatNumber(version.l1MetadataTokens)} · L2{" "}
                            {formatNumber(version.l2BodyTokens)}
                          </Text>
                        </li>
                      );
                    })}
                  </ul>
                </ScrollArea>
              </RadioGroup>

              <Label
                htmlFor="skill-eager"
                className="flex items-start justify-between gap-3 font-normal"
              >
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="font-medium">
                    Eager — inline the full SKILL.md body up front
                  </span>
                  <Text variant="meta" tone="muted">
                    Off by default (the faithful model: L1 always-on, L2/L3 read on demand). Turning
                    it on adds the L2 body to the resident context — a deliberate worst-case
                    comparison.
                  </Text>
                </span>
                <Switch
                  id="skill-eager"
                  checked={eager}
                  onCheckedChange={setEager}
                  className="mt-0.5 shrink-0"
                />
              </Label>
            </WizardStep>
          </div>
        </Wizard>

        <DialogFooter className="flex-none border-t border-border p-4">
          {disabledReason ? (
            <Text variant="meta" tone="muted" className="me-auto self-center text-pretty">
              {disabledReason}
            </Text>
          ) : null}
          {step === 1 ? (
            <Button variant="outline" onClick={() => setStep(0)}>
              Back
            </Button>
          ) : null}
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={confirm} disabled={step !== 1 || !canConfirm}>
            Add skill
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** The version label for an id, when it's present in the loaded list (else undefined). */
function previewVersionLabel(versions: SkillVersion[], versionId: string): string | undefined {
  return versions.find((version) => version.id === versionId)?.versionLabel;
}
