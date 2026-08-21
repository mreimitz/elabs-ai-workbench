// ==================================================================================================
// The assets cast (WP 1.2) — DELIBERATELY EMPTY, and deliberately committed
// ==================================================================================================
// WP 1.2 fills this with the tier-2 asset entities. It exists NOW, empty and exported and wired into
// `registry.ts`, for one reason: WP 1.2 and WP 1.3 are meant to run in parallel worktrees, and a
// module each of them CREATES is the same merge conflict as a shared array, moved one file over.
// An empty module that is already imported is what makes the two branches genuinely independent.
//
// Filling it means adding the entity file next to this one, `export *`-ing it below, and pushing one
// cast member into the array. Nothing else in the package is touched — `registry.ts` names no
// entity, and `entities/index.ts` names no entity either.

import type { IllustrationCastMember } from "./cast-member.js";

export const ILLUSTRATION_ASSETS_CAST: readonly IllustrationCastMember[] = [];
