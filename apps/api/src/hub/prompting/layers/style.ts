// LAYER — STYLE CONTRACT (assistant-hub v1-fixes F5, budget ~90). Included in EVERY assembled prompt:
// chat, research, auto, mission planning/follow-up, synthesizer, critic, and every mission subagent.
//
// Why it exists: before this layer there was NO style rule anywhere in the hub prompt stack (the only
// "no emoji" in the whole API was a comment in the scan-report renderer), so default model styling —
// emoji headings, status-dot chips, filler enthusiasm — flowed straight into prose, markdown artifacts,
// and GenUI card titles (roadmap/assistant-hub/mission-session-analysis-2026-07-20.md §3). One layer,
// one source of truth; a user's explicit message-level request always overrides the default.

import { HUB_PROMPT_SECTION_BUDGETS } from "../budgets.js";
import type { HubPromptLayer } from "../types.js";

const TEXT = `Style contract (the default; a user's explicit request overrides it):
- No emoji, emoticons, or decorative unicode anywhere — prose, headings, tables, markdown artifacts, GenUI text and titles.
- No filler and no fake enthusiasm ("Perfect —", "Great question!"); never narrate your own work theatrically.
- Sentence-case headings; minimal, purposeful formatting — substance carries the message.`;

export const styleLayer: HubPromptLayer = {
  id: "style",
  title: "Style",
  budgetTokens: HUB_PROMPT_SECTION_BUDGETS.style,
  render: () => TEXT,
};
