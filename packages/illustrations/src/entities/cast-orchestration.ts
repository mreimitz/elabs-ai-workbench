// ==================================================================================================
// The orchestration cast (WP 1.3) — how work is grouped, driven, compared and stored
// ==================================================================================================
// Research 5's tiers 2 and 3, as far as this work package takes them: what holds runs (`suite`),
// where tests live (`collection`), what makes them run by themselves (`orchestrator`), how two of
// anything are weighed against each other (`diff-compare`), what a run happens inside
// (`environment`), where all of it ends up (`database`), what is kept sealed (`credentials-vault`),
// and the companion that operates the app on the owner's behalf (`assistant`).
//
// Every one of them lives in its own file next to this one and is listed here exactly once. That is
// the whole edit surface for a new component (WP 1.1 §1): `registry.ts` names no entity, and
// `entities/index.ts` names no entity — the cast modules re-export their own members. This module
// was committed EMPTY by WP 1.1 precisely so that filling it in a parallel worktree could not
// collide with WP 1.2 filling `cast-assets.ts`.

export * from "./Assistant.js";
export * from "./Collection.js";
export * from "./CredentialsVault.js";
export * from "./Database.js";
export * from "./DiffCompare.js";
export * from "./Environment.js";
export * from "./Orchestrator.js";
export * from "./Suite.js";

import { Assistant, assistantMeta } from "./Assistant.js";
import { Collection, collectionMeta } from "./Collection.js";
import { CredentialsVault, credentialsVaultMeta } from "./CredentialsVault.js";
import { Database, databaseMeta } from "./Database.js";
import { DiffCompare, diffCompareMeta } from "./DiffCompare.js";
import { Environment, environmentMeta } from "./Environment.js";
import { Orchestrator, orchestratorMeta } from "./Orchestrator.js";
import { Suite, suiteMeta } from "./Suite.js";
import type { IllustrationCastMember } from "./cast-member.js";

export const ILLUSTRATION_ORCHESTRATION_CAST: readonly IllustrationCastMember[] = [
  { meta: suiteMeta, component: Suite },
  { meta: collectionMeta, component: Collection },
  { meta: orchestratorMeta, component: Orchestrator },
  { meta: diffCompareMeta, component: DiffCompare },
  { meta: environmentMeta, component: Environment },
  { meta: databaseMeta, component: Database },
  { meta: credentialsVaultMeta, component: CredentialsVault },
  { meta: assistantMeta, component: Assistant },
];
