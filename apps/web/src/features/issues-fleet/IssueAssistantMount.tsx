import { Sparkles } from "lucide-react";
import { Button, Tooltip, TooltipContent, TooltipTrigger } from "@brand/ui";
import { useAssistant } from "../assistant/assistant-context";
import type { FleetIssue } from "./issue-lib";
import { ISSUE_TRIAGE_STARTER_LABEL, buildIssueTriagePrompt } from "./issue-triage-prompt";

/**
 * "Analyze with Assistant" — the OWNER-INITIATED entry point to the WP5.4 issue loop (D-OB20). Clicking
 * it opens the assistant dock with a prefilled "Triage this issue" prompt carrying the issue's context
 * envelope (identity + cluster + fix targets + drafted fix + affected + linked runs — see
 * `buildIssueTriagePrompt`). The prompt is prefilled but NEVER auto-sent (`openAssistant({ prompt })`
 * only fills the composer), so nothing runs until the owner reads it and sends.
 *
 * The dock opens UNPINNED (SHARED-FREE — "issue" is not one of the frozen entity kinds), so the loop's
 * three action tools (`issues_update`/`tests_create_draft`/`runs_rerun`) work via their scope exemption,
 * all still approval-gated. Hidden entirely when the assistant isn't configured (`authConfigured`) — the
 * SAME gate `SkillInspector`'s "Fix with assistant" action uses, so a disabled dock never grows a dead button.
 */
export function IssueAssistantMount({ issue }: { issue: FleetIssue }) {
  const assistant = useAssistant();
  if (!assistant.authConfigured) return null;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          onClick={() => assistant.openAssistant({ prompt: buildIssueTriagePrompt(issue) })}
        >
          <Sparkles aria-hidden />
          <span>Analyze with assistant</span>
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        {ISSUE_TRIAGE_STARTER_LABEL}: draft a fix, add a regression test, and prove it with a re-run.
      </TooltipContent>
    </Tooltip>
  );
}
