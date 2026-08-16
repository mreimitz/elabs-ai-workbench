# WP 5.1 — Model-data foundation (single source of truth)

**Status:** ✅ done 2026-06-21 (code-complete; gate green: typecheck + 119 tests + build).
**Depends:** none.

## Goal
Make the research dataset the single, maintainable source of truth for model facts, and derive the
run engine's context-window + pricing maps from it (kills the 3-way drift between
`MODEL_CONTEXT_LIMITS`, `MODEL_PRICING`, and the dataset).

## Deliverables
- `apps/api/src/compatibility/build.ts` — pure builder (port of `comparison/build_comparison.py`) +
  zod provider-entry validation + `deriveContextLimits`/`derivePricing`/`renderSharedGenerated`.
- `apps/api/src/compatibility/build-cli.ts` + root `pnpm build:model-data` — reads
  `research/token-context-comparison/data/**`, writes the bundled assets + the codegen'd shared slice.
- Bundled assets `apps/api/src/compatibility/data/{all-models,cross-cutting-limits,test-catalog}.json`
  + `apps/api/scripts/copy-data.mjs` (copies into `dist` so `node dist` resolves them).
- `packages/shared/src/model-data.generated.ts` (derived `GENERATED_MODEL_CONTEXT_LIMITS` +
  `GENERATED_MODEL_PRICING`), merged into `MODEL_CONTEXT_LIMITS` (constants.ts) and `MODEL_PRICING`
  (providers/pricing.ts) — dataset wins on overlap, legacy retained as fallback.
- `apps/api/src/compatibility/dataset.ts` — loader, model-id crosswalk (`MODEL_ID_ALIASES`),
  `ProviderKind → research provider_id` map, model refs.
- Shared results-only contract types (CompatibilityVerdict/Severity/Result/Cell/Heatmap/Evidence).

## Acceptance (met)
- Drift test (`compatibility-data.test.ts`) rebuilds in-memory and byte-compares the committed assets.
- 11 providers / 33 models; unique ids; loader resolves by id + alias from `src` and `dist`.
- **Spend-cap no-regression** proven: `estimateCost` is non-zero for both legacy (`gpt-4o`) and
  current-gen (`claude-opus-4-8`) ids; dataset wins on the one overlap (`gemini-2.5-pro`).

## References
- Plan: `~/.claude/plans/look-into-my-research-eventual-thompson.md`
- `research/token-context-comparison/{00-methodology,01-information-structure}.md`, `schema/model-entry.schema.json`
