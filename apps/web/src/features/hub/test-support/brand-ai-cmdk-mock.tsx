/**
 * A minimal `@elabs-ai/components-ai` stand-in for `HubModelPicker.cmdk.test.tsx`.
 *
 * WHAT THIS USED TO BE. Until brand-ui 4.1.0 this module was a ~85-line faithful `ModelSelector*`
 * stand-in whose whole purpose was to keep the **cmdk half real** while replacing the Dialog, so one
 * test could assert against cmdk's own selection model (two rows sharing a `value` are one row to
 * the arrow keys) without the general-purpose `brand-ai-mock.tsx` substituting its own filtering.
 *
 * WHY IT IS NOW FOUR LINES. 4.1.0 deleted the `ModelSelector*` family outright, and `HubModelPicker`
 * composes `CommandDialog` + `Command*` from `@elabs-ai/components-ui` directly. That package is not
 * mocked anywhere, so **every** picker test now runs against real cmdk and a real Radix `Dialog` —
 * the special arrangement this file existed to create is simply the default. All that is still
 * needed from `@elabs-ai/components-ai` is the provider logo, stubbed so jsdom never loads the rest
 * of that barrel (monaco/shiki/mermaid) to assert on keyboard navigation.
 *
 * The cmdk behaviour the sibling test locks is unchanged and still worth locking: cmdk resolves the
 * highlighted item with `querySelector('[cmdk-item][aria-selected="true"]')`, matching the FIRST
 * element whose `data-value` equals `state.value` — so a duplicate `value` is unreachable by
 * keyboard, and `keywords` cannot rescue it (cmdk writes only `value` into `data-value`).
 */
export const ModelProviderLogo = () => null;
