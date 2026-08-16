/**
 * Qlik Answers reasoning structuring (Phase 5, D-QA11) — the PURE `parseReasoningSections` parser
 * MOVED to `packages/shared` (WP 6.2) so BOTH the API (emit-time derivation) and the web (LIVE,
 * client-side parse while a run streams) call the SAME function. This module is a thin re-export so
 * the existing importers (`qlik-answers-message.ts`, `qlik-answers-executor.ts`) and the API test
 * (`apps/api/test/qlik-answers-reasoning.test.ts`) keep working UNCHANGED. Behavior is byte-identical
 * — this was a MOVE, not a change. Full docs live at the shared module.
 */

export { parseReasoningSections } from "@mcp-token-footprint/shared";
