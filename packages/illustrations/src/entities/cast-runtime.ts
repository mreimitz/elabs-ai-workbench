// ==================================================================================================
// The runtime cast (WP 1.1) — the rest of the agentic-loop cast
// ==================================================================================================
// The five entities that complete research 5's tier 1 alongside the three pilots: what the agent
// thinks with (`model`), who serves it (`provider`), what checks its work (`validator`), what the
// work IS (`run`), and what starts it (`prompt`).
//
// Every one of them lives in its own file next to this one and is listed here exactly once. That is
// the whole edit surface for a new component (WP 1.1 §1): `registry.ts` names no entity, and
// `entities/index.ts` names no entity — the cast modules re-export their own members.

export * from "./Model.js";
export * from "./Prompt.js";
export * from "./Provider.js";
export * from "./Run.js";
export * from "./Validator.js";

import { Model, modelMeta } from "./Model.js";
import { Prompt, promptMeta } from "./Prompt.js";
import { Provider, providerMeta } from "./Provider.js";
import { Run, runMeta } from "./Run.js";
import { Validator, validatorMeta } from "./Validator.js";
import type { IllustrationCastMember } from "./cast-member.js";

export const ILLUSTRATION_RUNTIME_CAST: readonly IllustrationCastMember[] = [
  { meta: modelMeta, component: Model },
  { meta: providerMeta, component: Provider },
  { meta: validatorMeta, component: Validator },
  { meta: runMeta, component: Run },
  { meta: promptMeta, component: Prompt },
];
