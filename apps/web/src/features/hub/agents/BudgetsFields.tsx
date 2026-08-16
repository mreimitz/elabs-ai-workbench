import type { HubBudgets } from "@mcp-token-footprint/shared";
import { BoundedNumber } from "../../../components/form/BoundedNumber";
import { FieldRow } from "../../../components/FieldRow";

/**
 * Assistant Hub (WP2.1, D-AH7/D-AH9) — the budgets sub-form shared by the role editor and a crew
 * member's per-member override block. `HubBudgets` fields are all optional hard caps (enforced
 * server-side regardless of the autonomy dial, WP2.3); the form-local shape swaps "absent" for
 * `null` so every field can ride `BoundedNumber`'s "empty = No limit" affordance (S12) uniformly.
 */
export type BudgetsFormValue = {
  maxTurns: number | null;
  maxTokens: number | null;
  maxToolCalls: number | null;
  maxCostUsd: number | null;
  maxDurationMs: number | null;
};

export const EMPTY_BUDGETS: BudgetsFormValue = {
  maxTurns: null,
  maxTokens: null,
  maxToolCalls: null,
  maxCostUsd: null,
  maxDurationMs: null,
};

export function budgetsFromWire(budgets?: HubBudgets | null): BudgetsFormValue {
  return {
    maxTurns: budgets?.maxTurns ?? null,
    maxTokens: budgets?.maxTokens ?? null,
    maxToolCalls: budgets?.maxToolCalls ?? null,
    maxCostUsd: budgets?.maxCostUsd ?? null,
    maxDurationMs: budgets?.maxDurationMs ?? null,
  };
}

/** `undefined` when every field is empty (no budgets set at all) — the caller decides whether that
 *  means "omit the field" (create) or "explicitly clear" (`budgets: null` on a patch). */
export function budgetsToWire(value: BudgetsFormValue): HubBudgets | undefined {
  const wire: HubBudgets = {};
  if (value.maxTurns !== null) wire.maxTurns = value.maxTurns;
  if (value.maxTokens !== null) wire.maxTokens = value.maxTokens;
  if (value.maxToolCalls !== null) wire.maxToolCalls = value.maxToolCalls;
  if (value.maxCostUsd !== null) wire.maxCostUsd = value.maxCostUsd;
  if (value.maxDurationMs !== null) wire.maxDurationMs = value.maxDurationMs;
  return Object.keys(wire).length > 0 ? wire : undefined;
}

export function BudgetsFields({
  idPrefix,
  value,
  onChange,
  disabled,
}: {
  idPrefix: string;
  value: BudgetsFormValue;
  onChange: (next: BudgetsFormValue) => void;
  disabled?: boolean;
}) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <FieldRow id={`${idPrefix}-max-turns`} label="Max turns">
        <BoundedNumber
          id={`${idPrefix}-max-turns`}
          value={value.maxTurns}
          onChange={(next) => onChange({ ...value, maxTurns: next })}
          min={1}
          step={1}
          disabled={disabled}
          aria-label="Max turns"
        />
      </FieldRow>
      <FieldRow id={`${idPrefix}-max-tokens`} label="Max tokens">
        <BoundedNumber
          id={`${idPrefix}-max-tokens`}
          value={value.maxTokens}
          onChange={(next) => onChange({ ...value, maxTokens: next })}
          min={0}
          step={1000}
          unit="tokens"
          disabled={disabled}
          aria-label="Max tokens"
        />
      </FieldRow>
      <FieldRow id={`${idPrefix}-max-tool-calls`} label="Max tool calls">
        <BoundedNumber
          id={`${idPrefix}-max-tool-calls`}
          value={value.maxToolCalls}
          onChange={(next) => onChange({ ...value, maxToolCalls: next })}
          min={0}
          step={1}
          disabled={disabled}
          aria-label="Max tool calls"
        />
      </FieldRow>
      <FieldRow id={`${idPrefix}-max-cost`} label="Max cost">
        <BoundedNumber
          id={`${idPrefix}-max-cost`}
          value={value.maxCostUsd}
          onChange={(next) => onChange({ ...value, maxCostUsd: next })}
          min={0}
          step={0.5}
          decimals={2}
          unit="$"
          disabled={disabled}
          aria-label="Max cost in dollars"
        />
      </FieldRow>
      <FieldRow id={`${idPrefix}-max-duration`} label="Max duration">
        <BoundedNumber
          id={`${idPrefix}-max-duration`}
          value={value.maxDurationMs}
          onChange={(next) => onChange({ ...value, maxDurationMs: next })}
          min={0}
          step={30_000}
          unit="ms"
          disabled={disabled}
          aria-label="Max duration in milliseconds"
        />
      </FieldRow>
    </div>
  );
}
