// ==================================================================================================
// The assets cast (WP 1.2) — what the app measures and carries
// ==================================================================================================
// The seven entities behind the numbers this app produces: the two halves of a server's advertised
// surface (`tool`, `resource`) and the form its prompts are stamped from (`prompt-template`); the
// artefacts around a run (`file`, `feedback-report`); the pass that takes the measurement (`scan`);
// and the column the measurement is read off (`token-meter`).
//
// WP 1.1 committed this module empty and already imported by `registry.ts`, so that WP 1.2 and
// WP 1.3 could run in parallel worktrees without sharing a file. Filling it is therefore the WHOLE
// structural edit: each entity lives in its own file next to this one, is `export *`-ed below so its
// component, meta and height function reach the package's public surface, and is listed once in the
// array. `registry.ts` names no entity and `entities/index.ts` names no entity, so neither changed.

export * from "./FeedbackReport.js";
export * from "./File.js";
export * from "./PromptTemplate.js";
export * from "./Resource.js";
export * from "./Scan.js";
export * from "./Tool.js";
export * from "./TokenMeter.js";

import { FeedbackReport, feedbackReportMeta } from "./FeedbackReport.js";
import { File, fileMeta } from "./File.js";
import { PromptTemplate, promptTemplateMeta } from "./PromptTemplate.js";
import { Resource, resourceMeta } from "./Resource.js";
import { Scan, scanMeta } from "./Scan.js";
import { TokenMeter, tokenMeterMeta } from "./TokenMeter.js";
import { Tool, toolMeta } from "./Tool.js";
import type { IllustrationCastMember } from "./cast-member.js";

export const ILLUSTRATION_ASSETS_CAST: readonly IllustrationCastMember[] = [
  { meta: toolMeta, component: Tool },
  { meta: resourceMeta, component: Resource },
  { meta: promptTemplateMeta, component: PromptTemplate },
  { meta: fileMeta, component: File },
  { meta: feedbackReportMeta, component: FeedbackReport },
  { meta: scanMeta, component: Scan },
  { meta: tokenMeterMeta, component: TokenMeter },
];
