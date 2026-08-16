import { useEffect, useMemo, useState } from "react";
import type {
  HubSkillAttachmentInput,
  HubSkillInvocationMode,
  Skill,
  SkillVersion,
} from "@mcp-token-footprint/shared";
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
  Text,
  Wizard,
  WizardStep,
  WizardSteps,
} from "@brand/ui";
import { ChevronRight, Sparkles } from "lucide-react";
import { formatNumber } from "../../lib/format";

const STEPS = [
  { id: "skill", title: "Select skill", description: "Pick a registered skill" },
  { id: "mode", title: "Version & invocation", description: "Choose the version + how it's invoked" },
] as const;

/** The sentinel value for the "Latest (tracks the current version)" radio option. */
const LATEST = "__latest__";

const INVOCATION_OPTIONS: Array<{ value: HubSkillInvocationMode; label: string; description: string }> = [
  {
    value: "model_invocable",
    label: "Model-invocable (default)",
    description: "Name + description appear in the assistant's skills catalog; it can load this skill itself via skills.load.",
  },
  {
    value: "name_only",
    label: "Name-only",
    description: "Only the name appears in the catalog (no description) — still loadable by the model, at a lower listing cost.",
  },
  {
    value: "user_only",
    label: "User-only (slash)",
    description: "Removed from the model's catalog entirely — reachable only via a /skill-name slash command you type.",
  },
];

/**
 * Assistant Hub (WP2.4, R-SK1…R-SK3/R-SK8) — attach one skill to a session. Mirrors the Testing
 * feature's `AddSkillModal` (same two-step Wizard shape: pick skill → version), swapping the eager
 * Switch for the R-SK3 invocation-mode choice (this app's session-level attachment always uses the
 * L1-catalog + on-demand `skills.load` mechanic — there is no "eager inline" toggle here).
 */
export function AddHubSkillModal(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  skills: Skill[];
  skillVersions: Map<string, SkillVersion[]>;
  existingSkillIds: Set<string>;
  onAdd: (entry: HubSkillAttachmentInput) => void;
}) {
  const { open, onOpenChange, skills, skillVersions, existingSkillIds, onAdd } = props;
  const [step, setStep] = useState(0);
  const [skillId, setSkillId] = useState<string | null>(null);
  const [choice, setChoice] = useState<string>(LATEST);
  const [invocationMode, setInvocationMode] = useState<HubSkillInvocationMode>("model_invocable");

  const available = useMemo(
    () => skills.filter((skill) => !existingSkillIds.has(skill.id)),
    [skills, existingSkillIds],
  );

  useEffect(() => {
    if (!open) return;
    setStep(0);
    setSkillId(null);
    setChoice(LATEST);
    setInvocationMode("model_invocable");
  }, [open]);

  const chosenSkill = skillId ? (skills.find((skill) => skill.id === skillId) ?? null) : null;
  const versions = useMemo(() => {
    const list = skillId ? (skillVersions.get(skillId) ?? []) : [];
    return [...list].sort((left, right) => right.seq - left.seq);
  }, [skillId, skillVersions]);

  function chooseSkill(id: string) {
    setSkillId(id);
    setChoice(LATEST);
    setInvocationMode("model_invocable");
    setStep(1);
  }

  const previewVersion = useMemo(() => {
    if (choice !== LATEST) return versions.find((version) => version.id === choice);
    const currentId = chosenSkill?.currentVersionId;
    return currentId ? versions.find((version) => version.id === currentId) : undefined;
  }, [choice, versions, chosenSkill]);

  const canConfirm = skillId !== null && (choice === LATEST || versions.some((v) => v.id === choice));
  const disabledReason =
    step !== 1
      ? "Pick a skill to continue."
      : !canConfirm
        ? "Choose a version to add this skill."
        : null;

  function confirm() {
    if (!skillId) return;
    const entry: HubSkillAttachmentInput =
      choice === LATEST
        ? { skillId, versionMode: "latest", invocationMode }
        : { skillId, versionMode: "pinned", pinnedVersionId: choice, invocationMode };
    onAdd(entry);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg" className="flex max-h-[85vh] flex-col gap-0 p-0">
        <DialogHeader className="flex-none gap-1 border-b border-border p-4 pe-12">
          <DialogTitle>Attach skill to this session</DialogTitle>
          <DialogDescription>
            Pick a registered skill, track its latest version or pin a specific one, and choose how
            it's invoked.
          </DialogDescription>
        </DialogHeader>

        <Wizard steps={[...STEPS]} step={step} className="flex min-h-0 flex-1 flex-col gap-0">
          <div className="flex-none border-b border-border p-4">
            <WizardSteps />
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            <WizardStep step={0} className="flex flex-col gap-2 outline-none">
              {available.length === 0 ? (
                <StatePanel
                  kind="empty"
                  icon={<Sparkles aria-hidden />}
                  title={skills.length === 0 ? "No skills registered" : "All skills already attached"}
                  description={
                    skills.length === 0
                      ? "Register a skill under Skills, then return here to attach it to this session."
                      : "Every registered skill is already attached to this session."
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
                            <Sparkles className="size-4 shrink-0 text-muted-foreground" aria-hidden />
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

            <WizardStep step={1} className="flex flex-col gap-5 outline-none">
              <div className="flex items-center justify-between gap-3">
                <Label className="flex min-w-0 items-center gap-2">
                  <Sparkles className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="truncate">{chosenSkill?.displayName ?? "Skill"}</span>
                </Label>
                {previewVersion ? (
                  <Text variant="meta" tone="muted" className="shrink-0 tabular-nums">
                    L1 {formatNumber(previewVersion.l1MetadataTokens)} tok
                  </Text>
                ) : null}
              </div>

              <div className="flex flex-col gap-2">
                <Text variant="meta" tone="muted">
                  Version
                </Text>
                <RadioGroup value={choice} onValueChange={setChoice} className="flex flex-col gap-1">
                  <ScrollArea className="max-h-56 rounded-md border border-border">
                    <ul className="flex flex-col gap-1 p-2">
                      <li className="flex items-center justify-between gap-3">
                        <Label
                          htmlFor="hub-skill-version-latest"
                          className="flex min-w-0 items-center gap-2 font-normal"
                        >
                          <RadioGroupItem id="hub-skill-version-latest" value={LATEST} />
                          <span className="truncate">Latest — track the current version</span>
                        </Label>
                        {chosenSkill?.currentVersionId &&
                        previewVersionLabel(versions, chosenSkill.currentVersionId) ? (
                          <Badge variant="outline" className="shrink-0 tabular-nums">
                            {previewVersionLabel(versions, chosenSkill.currentVersionId)}
                          </Badge>
                        ) : null}
                      </li>
                      {versions.map((version) => {
                        const radioId = `hub-skill-version-${version.id}`;
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
              </div>

              <div className="flex flex-col gap-2">
                <Text variant="meta" tone="muted">
                  Invocation
                </Text>
                <RadioGroup
                  value={invocationMode}
                  onValueChange={(value) => setInvocationMode(value as HubSkillInvocationMode)}
                  className="flex flex-col gap-2"
                >
                  {INVOCATION_OPTIONS.map((option) => {
                    const radioId = `hub-skill-invocation-${option.value}`;
                    return (
                      <Label
                        key={option.value}
                        htmlFor={radioId}
                        className="flex items-start gap-2.5 rounded-md border border-border p-3 font-normal"
                      >
                        <RadioGroupItem id={radioId} value={option.value} className="mt-0.5 shrink-0" />
                        <span className="flex min-w-0 flex-col gap-0.5">
                          <span className="font-medium">{option.label}</span>
                          <Text variant="meta" tone="muted">
                            {option.description}
                          </Text>
                        </span>
                      </Label>
                    );
                  })}
                </RadioGroup>
              </div>
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
            Attach skill
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function previewVersionLabel(versions: SkillVersion[], versionId: string): string | undefined {
  return versions.find((version) => version.id === versionId)?.versionLabel;
}
