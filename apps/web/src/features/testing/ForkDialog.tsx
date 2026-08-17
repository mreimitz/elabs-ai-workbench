import { useEffect, useMemo, useState } from "react";
import type { RunPlanEstimate, RunStep } from "@mcp-token-footprint/shared";
import {
  Alert,
  AlertDescription,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Text,
  Textarea,
} from "@brand/ui";
import { GitFork } from "lucide-react";
import { estimateRunPlan, rerunRun } from "../../lib/api";
import { getErrorMessage } from "../../lib/errors";
import { formatNumber } from "../../lib/format";
import { SelectField } from "../../components/SelectField";

const WHOLE_RUN = "__whole__";

/** The parent run's forkable turn steps (the model-visible transcript points a fork can branch at). */
function forkableSteps(steps: RunStep[]): RunStep[] {
  return steps.filter(
    (s) => s.type === "llm_response" || s.type === "user_message" || s.type === "tool_result",
  );
}

function stepLabel(step: RunStep): string {
  const turn = step.turnIndex !== undefined ? `Turn ${step.turnIndex + 1} · ` : "";
  if (step.type === "user_message") return `${turn}User message`;
  if (step.type === "tool_result") return `${turn}Tool result · ${step.toolName ?? step.label}`;
  return `${turn}Assistant reply`;
}

/**
 * Observability (roadmap/observability/, WP3.3, D-OB18) — the "Open in Playground" fork dialog. Forks a
 * TERMINAL run into a NEW derived run: edit the final prompt / model / temperature / skill version, pick
 * a fork point (whole-run re-launch, or — capability-gated — AT a step so the conversation prefix is
 * reconstructed + seeded), preview the cost (`GET /api/estimate/run-plan`, ESTIMATE-FIRST), then launch
 * (`POST /api/runs/:id/rerun`) and navigate to the derived run. Every visible element is `@brand/*`.
 */
export function ForkDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  runId: string;
  testId: string;
  scenarioId: string;
  /** Capability-gated (`supportsMidRunFork`): when false, only a whole-run re-launch is offered. */
  supportsMidRun: boolean;
  /** The parent run's steps — the fork-point selector's options (mid-run only). */
  steps: RunStep[];
  /** Opened FROM a specific step ("Fork from here") → pre-select that fork point. */
  initialFromStepId?: string;
  /** The original opener prompt, pre-filled into the editable prompt field. */
  defaultPrompt?: string;
  /** The environment's current model, shown as the placeholder for the (optional) model override. */
  currentModel?: string;
  onLaunched: (newRunId: string) => void;
}) {
  const {
    open,
    onOpenChange,
    runId,
    testId,
    scenarioId,
    supportsMidRun,
    steps,
    initialFromStepId,
    defaultPrompt,
    currentModel,
    onLaunched,
  } = props;

  const [prompt, setPrompt] = useState(defaultPrompt ?? "");
  const [model, setModel] = useState("");
  const [temperature, setTemperature] = useState("");
  const [skillVersionId, setSkillVersionId] = useState("");
  const [fromStepId, setFromStepId] = useState<string>(initialFromStepId ?? WHOLE_RUN);
  const [estimate, setEstimate] = useState<RunPlanEstimate | null>(null);
  const [launching, setLaunching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const stepOptions = useMemo(() => {
    const options = [{ value: WHOLE_RUN, label: "Re-run the whole conversation" }];
    for (const step of forkableSteps(steps)) {
      options.push({ value: step.id, label: `Fork after: ${stepLabel(step)}` });
    }
    return options;
  }, [steps]);

  // Reset the form + fetch the cost preview each time the dialog opens (ESTIMATE-FIRST, D-OB18).
  useEffect(() => {
    if (!open) return;
    setPrompt(defaultPrompt ?? "");
    setModel("");
    setTemperature("");
    setSkillVersionId("");
    setFromStepId(supportsMidRun ? (initialFromStepId ?? WHOLE_RUN) : WHOLE_RUN);
    setError(null);
    setEstimate(null);
    let active = true;
    estimateRunPlan([testId], [scenarioId], 1)
      .then((result) => {
        if (active) setEstimate(result);
      })
      .catch(() => {
        // A preview failure is non-fatal — the fork can still launch; just no band is shown.
        if (active) setEstimate(null);
      });
    return () => {
      active = false;
    };
  }, [open, defaultPrompt, supportsMidRun, initialFromStepId, testId, scenarioId]);

  const launch = async () => {
    setError(null);
    const temperatureNum = temperature.trim() === "" ? undefined : Number(temperature);
    if (temperatureNum !== undefined && (Number.isNaN(temperatureNum) || temperatureNum < 0)) {
      setError("Temperature must be a number ≥ 0.");
      return;
    }
    const overrides: Record<string, unknown> = {};
    if (prompt.trim() !== "") overrides.prompt = prompt.trim();
    if (model.trim() !== "") overrides.model = model.trim();
    if (temperatureNum !== undefined) overrides.temperature = temperatureNum;
    if (skillVersionId.trim() !== "") overrides.skillVersionId = skillVersionId.trim();

    setLaunching(true);
    try {
      const response = await rerunRun(runId, {
        ...(fromStepId !== WHOLE_RUN ? { fromStepId } : {}),
        ...(Object.keys(overrides).length > 0 ? { overrides } : {}),
      });
      onOpenChange(false);
      onLaunched(response.runId);
    } catch (cause) {
      setError(`Couldn’t launch the fork. ${getErrorMessage(cause)} Try again.`);
    } finally {
      setLaunching(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <GitFork className="size-4" aria-hidden />
            Fork this run
          </DialogTitle>
          <DialogDescription>
            Re-run with changes into a new, separately-graded run. The original is untouched, and the
            new run links back to it.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          {supportsMidRun ? (
            <SelectField
              id="fork-point"
              label="Fork point"
              value={fromStepId}
              options={stepOptions}
              onChange={setFromStepId}
            />
          ) : (
            <Text variant="caption" className="text-muted-foreground">
              This run's backend supports a whole-run re-run only — a fork point isn't available.
            </Text>
          )}

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="fork-prompt">Prompt</Label>
            <Textarea
              id="fork-prompt"
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              rows={3}
              placeholder="Leave blank to reuse the original prompt…"
              spellCheck={false}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="fork-model">Model</Label>
              <Input
                id="fork-model"
                value={model}
                onChange={(event) => setModel(event.target.value)}
                placeholder={currentModel ?? "Inherit"}
                autoComplete="off"
                spellCheck={false}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="fork-temperature">Temperature</Label>
              <Input
                id="fork-temperature"
                type="number"
                inputMode="decimal"
                min={0}
                max={2}
                step={0.1}
                value={temperature}
                onChange={(event) => setTemperature(event.target.value)}
                placeholder="Inherit"
                autoComplete="off"
              />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="fork-skill-version">Skill version (optional)</Label>
            <Input
              id="fork-skill-version"
              value={skillVersionId}
              onChange={(event) => setSkillVersionId(event.target.value)}
              placeholder="Pin a skill version id, or leave blank"
              autoComplete="off"
              spellCheck={false}
            />
          </div>

          {estimate ? (
            <div className="rounded-md border border-border bg-muted/40 p-3 text-caption">
              <Text variant="meta" className="text-muted-foreground uppercase tracking-wide">
                Estimated cost (1 run)
              </Text>
              <div className="mt-1 flex items-center gap-4 tabular-nums">
                <span>~{formatNumber(estimate.tokens.mid)} tokens</span>
                <span>~${estimate.costUsd.mid.toFixed(4)}</span>
              </div>
            </div>
          ) : null}

          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={launching}>
            Cancel
          </Button>
          <Button onClick={launch} disabled={launching}>
            {launching ? "Launching…" : "Launch fork"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
