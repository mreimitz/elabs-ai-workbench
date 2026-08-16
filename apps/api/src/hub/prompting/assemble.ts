// Assistant Hub — the prompt ASSEMBLER (D-AH14 / execution-plan §1.8).
//
// Stitches the versioned LAYER modules into one system prompt in the §1.8 order:
//   identity → session context → tools → [GenUI] → citations → memory → project →
//   working-visibly → [orchestration] → mode addendum → [role template] → safety → self-check.
//
// Two entry points share the layers:
//   • `assembleSessionPrompt` — a top-level chat/research/mission session.
//   • `assembleRolePrompt`    — a mission SUBAGENT (role template replaces identity; §8.4 isolation).
//
// Conditional layers (kept out of the window when they carry no meaning — Appendix B, "chat turns
// stay lighter"):
//   • GenUI       — only when a compiled catalog is injected (the WP2.6 seam).
//   • memory      — only when memory content is provided.
//   • project     — only when the session is in a project.
//   • orchestration — only in `mission-planner` mode.
//
// The returned `sections[]` (in order) is what the context inspector itemizes (R-SES7); `text` is
// the string handed to the model. `promptVersion` = `HUB_PROMPT_VERSION`, stamped by the turn engine
// onto every settled `assistant_message`.

import { citationsLayer } from "./layers/citations.js";
import { genuiLayer } from "./layers/genui.js";
import { identityLayer } from "./layers/identity.js";
import { memoryLayer } from "./layers/memory.js";
import { modeAddendumLayer } from "./layers/mode-addenda.js";
import { orchestrationLayer } from "./layers/orchestration.js";
import { projectLayer } from "./layers/project.js";
import { roleTemplateLayer } from "./layers/role-template.js";
import { safetyLayer } from "./layers/safety.js";
import { selfCheckLayer } from "./layers/self-check.js";
import { sessionContextLayer } from "./layers/session-context.js";
import { styleLayer } from "./layers/style.js";
import { toolsLayer } from "./layers/tools.js";
import { workingVisiblyLayer } from "./layers/working-visibly.js";
import type {
  AssembledHubPrompt,
  HubPromptSection,
  HubRolePromptInput,
  HubSessionPromptInput,
} from "./types.js";
import { HUB_PROMPT_VERSION } from "./version.js";

function joinSections(sections: HubPromptSection[]): string {
  return sections.map((s) => `## ${s.title}\n\n${s.text}`).join("\n\n");
}

export function assembleSessionPrompt(input: HubSessionPromptInput): AssembledHubPrompt {
  const sections: HubPromptSection[] = [];
  const push = (s: HubPromptSection) => sections.push(s);

  push(
    toSection(
      identityLayer.id,
      identityLayer.title,
      identityLayer.render(),
      identityLayer.budgetTokens,
    ),
  );
  push(
    toSection(
      sessionContextLayer.id,
      sessionContextLayer.title,
      sessionContextLayer.render(input.session),
      sessionContextLayer.budgetTokens,
    ),
  );
  push(
    toSection(
      toolsLayer.id,
      toolsLayer.title,
      toolsLayer.render(input.tools),
      toolsLayer.budgetTokens,
    ),
  );

  // WP2.6 seam: advertise `present` only when a catalog is compiled in.
  if (input.genuiCatalog) {
    push(
      toSection(
        genuiLayer.id,
        genuiLayer.title,
        genuiLayer.render(input.genuiCatalog),
        genuiLayer.budgetTokens,
      ),
    );
  }

  push(
    toSection(
      citationsLayer.id,
      citationsLayer.title,
      citationsLayer.render(),
      citationsLayer.budgetTokens,
    ),
  );

  if (input.memory) {
    push(
      toSection(
        memoryLayer.id,
        memoryLayer.title,
        memoryLayer.render(input.memory),
        memoryLayer.budgetTokens,
      ),
    );
  }
  if (input.project) {
    push(
      toSection(
        projectLayer.id,
        projectLayer.title,
        projectLayer.render(input.project),
        projectLayer.budgetTokens,
      ),
    );
  }

  push(
    toSection(
      workingVisiblyLayer.id,
      workingVisiblyLayer.title,
      workingVisiblyLayer.render(),
      workingVisiblyLayer.budgetTokens,
    ),
  );

  // v1-fixes (F5) — the style contract rides EVERY session prompt, whatever the mode.
  push(toSection(styleLayer.id, styleLayer.title, styleLayer.render(), styleLayer.budgetTokens));

  // LAYER 8 only for the planning turn — synthesizer/critic carry only their addendum.
  if (input.mode === "mission-planner") {
    push(
      toSection(
        orchestrationLayer.id,
        orchestrationLayer.title,
        orchestrationLayer.render(input.orchestration),
        orchestrationLayer.budgetTokens,
      ),
    );
  }

  push(
    toSection(
      modeAddendumLayer.id,
      modeAddendumLayer.title,
      modeAddendumLayer.render(input.mode),
      modeAddendumLayer.budgetTokens,
    ),
  );

  push(
    toSection(safetyLayer.id, safetyLayer.title, safetyLayer.render(), safetyLayer.budgetTokens),
  );
  push(
    toSection(
      selfCheckLayer.id,
      selfCheckLayer.title,
      selfCheckLayer.render(),
      selfCheckLayer.budgetTokens,
    ),
  );

  return {
    promptVersion: HUB_PROMPT_VERSION,
    mode: input.mode,
    sections,
    text: joinSections(sections),
  };
}

export function assembleRolePrompt(input: HubRolePromptInput): AssembledHubPrompt {
  const sections: HubPromptSection[] = [];
  const push = (s: HubPromptSection) => sections.push(s);

  // The role template REPLACES identity (§8.4): a subagent is a curated specialist, not the Assistant.
  push(
    toSection(
      roleTemplateLayer.id,
      roleTemplateLayer.title,
      roleTemplateLayer.render(input.role),
      roleTemplateLayer.budgetTokens,
    ),
  );

  if (input.session) {
    push(
      toSection(
        sessionContextLayer.id,
        sessionContextLayer.title,
        sessionContextLayer.render(input.session),
        sessionContextLayer.budgetTokens,
      ),
    );
  }

  push(
    toSection(
      toolsLayer.id,
      toolsLayer.title,
      toolsLayer.render(input.tools),
      toolsLayer.budgetTokens,
    ),
  );

  if (input.genuiCatalog) {
    push(
      toSection(
        genuiLayer.id,
        genuiLayer.title,
        genuiLayer.render(input.genuiCatalog),
        genuiLayer.budgetTokens,
      ),
    );
  }

  push(
    toSection(
      citationsLayer.id,
      citationsLayer.title,
      citationsLayer.render(),
      citationsLayer.budgetTokens,
    ),
  );

  // v1-fixes (F5) — subagents carry the same style contract (their prose lands in reports the
  // synthesizer quotes verbatim; slop injected here would survive synthesis).
  push(toSection(styleLayer.id, styleLayer.title, styleLayer.render(), styleLayer.budgetTokens));

  // An adversarial-critique agent overlays the critic lens (LAYER 9).
  if (input.lens === "critic") {
    push(
      toSection(
        modeAddendumLayer.id,
        modeAddendumLayer.title,
        modeAddendumLayer.render("critic"),
        modeAddendumLayer.budgetTokens,
      ),
    );
  }

  push(
    toSection(safetyLayer.id, safetyLayer.title, safetyLayer.render(), safetyLayer.budgetTokens),
  );
  push(
    toSection(
      selfCheckLayer.id,
      selfCheckLayer.title,
      selfCheckLayer.render(),
      selfCheckLayer.budgetTokens,
    ),
  );

  return {
    promptVersion: HUB_PROMPT_VERSION,
    mode: "role",
    sections,
    text: joinSections(sections),
  };
}

function toSection(
  id: HubPromptSection["id"],
  title: string,
  text: string,
  budgetTokens: number,
): HubPromptSection {
  return { id, title, text, budgetTokens };
}
