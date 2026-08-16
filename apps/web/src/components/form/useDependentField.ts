import { useMemo } from "react";

/**
 * A single prerequisite gating a dependent field: `met` says whether it's satisfied, `reason` is the
 * user-facing sentence to show WHILE it's unmet (S19: "dependent fields disabled-with-reason until
 * prerequisites"). Sentence-case, user-first copy — e.g. "Select a provider credential first".
 */
export interface FieldPrerequisite {
  met: boolean;
  reason: string;
}

export interface DependentFieldState {
  /** True while any prerequisite is unmet. */
  disabled: boolean;
  /** The first unmet prerequisite's reason, or `undefined` when everything is satisfied. */
  reason?: string;
  /**
   * Spread onto the gated control to make the disabled state real AND explained: `disabled`,
   * `aria-disabled`, and a `title` tooltip carrying the reason. (`aria-disabled` is included so an
   * element that can't take the native `disabled` attribute — e.g. a Radix trigger — still
   * announces the state.)
   */
  controlProps: {
    disabled: boolean;
    "aria-disabled": boolean;
    title: string | undefined;
  };
}

/**
 * Derive the disabled-with-reason state for a field that depends on one or more prerequisites.
 *
 * The S19 fix in miniature: the New-environment modal enables the Model combobox with no credential
 * selected. A field wired through this hook stays disabled — and *says why* — until its prerequisite
 * is set. Prerequisites are evaluated in order; the first unmet one wins, so list the most
 * fundamental first (pick a credential → then a model).
 *
 * @example
 * const model = useDependentField([{ met: !!credentialId, reason: "Select a provider credential first" }]);
 * <Select disabled={model.disabled} ... />
 * {model.reason && <Text variant="meta">{model.reason}</Text>}
 */
export function useDependentField(prerequisites: FieldPrerequisite[]): DependentFieldState {
  return useMemo(() => {
    const unmet = prerequisites.find((p) => !p.met);
    const disabled = unmet !== undefined;
    const reason = unmet?.reason;
    return {
      disabled,
      reason,
      controlProps: {
        disabled,
        "aria-disabled": disabled,
        title: reason,
      },
    };
  }, [prerequisites]);
}
