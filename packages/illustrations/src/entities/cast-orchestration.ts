// ==================================================================================================
// The orchestration cast (WP 1.3) — DELIBERATELY EMPTY, and deliberately committed
// ==================================================================================================
// The sibling of `cast-assets.ts`, for WP 1.3's orchestration and accounting entities, and here for
// exactly the same reason: an empty module that already exists and is already imported is what lets
// WP 1.2 and WP 1.3 run in parallel worktrees without touching one shared file.
//
// See `cast-assets.ts` for the three-step recipe to fill it.

import type { IllustrationCastMember } from "./cast-member.js";

export const ILLUSTRATION_ORCHESTRATION_CAST: readonly IllustrationCastMember[] = [];
