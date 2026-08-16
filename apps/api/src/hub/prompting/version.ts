// Assistant Hub — system-prompt architecture version (D-AH14 / execution-plan §1.8).
//
// Bumped whenever the ASSEMBLED prompt text or its layer order changes in a way that could shift
// model behavior. The turn engine (WP1.1) stamps this onto every settled `assistant_message`
// (`HubAssistantMessagePart.promptVersion` / the message's `promptVersion` field in the shared
// contract) so a run's transcript records exactly which prompt produced it — the same provenance
// discipline the app already applies to `counting_version` for token scans.
//
// Format: `hub-prompt-<major>.<minor>.<patch>`. Keep it grep-able and stable; a change here is a
// deliberate, reviewed event (Appendix B: the WRONG/RIGHT pairs and rule numbers are load-bearing).
// hub-prompt-1.1.0 — assistant-hub v1-fixes: +style contract layer (F5, every prompt incl. role
// prompts), +mission-followup mode addendum (F4), +GenUI plain-text-props rule (F5), tools layer's
// web-search freshness note (F6).
export const HUB_PROMPT_VERSION = "hub-prompt-1.1.0" as const;

export type HubPromptVersion = typeof HUB_PROMPT_VERSION;
