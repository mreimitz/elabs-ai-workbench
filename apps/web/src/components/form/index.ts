/**
 * Form primitive kit (WP 1.6 · S19/S11/S12). The reusable, typed, keyboard-operable inputs that
 * Phase 2 swaps in across the config surfaces. Compose these instead of hand-rolling numeric
 * steppers, JSON textareas, or dropdowns for ordered scales.
 */
export { BoundedNumber, type BoundedNumberProps } from "./BoundedNumber";
export { KeyValueEditor, type KeyValueEditorProps, type KeyValuePair } from "./KeyValueEditor";
export { ListEditor, type ListEditorProps } from "./ListEditor";
export {
  clampNumber,
  decimalsFromStep,
  normalizeNumber,
  roundToDecimals,
} from "./numeric";
export { SegmentedField, type SegmentedFieldProps, type SegmentedOption } from "./SegmentedField";
export { SliderNumber, type SliderNumberProps } from "./SliderNumber";
export { TagInput, type TagInputProps } from "./TagInput";
export {
  type DependentFieldState,
  type FieldPrerequisite,
  useDependentField,
} from "./useDependentField";
