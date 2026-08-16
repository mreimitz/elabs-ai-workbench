import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@brand/ui";
import { createContext, isValidElement, cloneElement, useContext } from "react";
import type { ComponentProps, ReactElement, ReactNode } from "react";

/**
 * A **faithful** `@brand/ai` ModelSelector stand-in for the ONE test that must exercise REAL cmdk
 * (model-identity WP 4.1 / D-MI7).
 *
 * `@brand/ai`'s `ModelSelector*` family is a thin wrapper over `@brand/ui`'s `Command*` (which is a
 * thin wrapper over cmdk) plus a Radix `Dialog` for chrome. This module keeps the cmdk half REAL —
 * `ModelSelectorItem` **is** `CommandItem` — and replaces only the Dialog with a plain conditional,
 * so jsdom never has to load the rest of the `@brand/ai` barrel (xterm/monaco/shiki/mermaid) just to
 * assert on keyboard navigation.
 *
 * WHY IT EXISTS. The general-purpose `brand-ai-mock.tsx` re-implements filtering; it therefore
 * cannot prove anything about cmdk's OWN selection model — and that model is exactly where the
 * WP-3.1 carry-forward finding lives: cmdk resolves the highlighted item with
 * `querySelector('[cmdk-item][aria-selected="true"]')`, which matches the FIRST element whose
 * `data-value` equals `state.value`. Two items sharing a `value` are therefore one item to the
 * arrow keys and to Enter, and `keywords` cannot help (cmdk writes only `value` into `data-value`).
 * `HubModelPicker.cmdk.test.tsx` asserts against this real behaviour, not against a stub's opinion.
 */

type OpenCtx = { open: boolean; setOpen: (next: boolean) => void };
const OpenContext = createContext<OpenCtx>({ open: false, setOpen: () => {} });

export const ModelSelector = ({
  open,
  onOpenChange,
  children,
}: {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children?: ReactNode;
}) => (
  <OpenContext.Provider value={{ open: !!open, setOpen: (next) => onOpenChange?.(next) }}>
    {children}
  </OpenContext.Provider>
);

export const ModelSelectorTrigger = ({
  children,
  disabled,
}: {
  children?: ReactNode;
  disabled?: boolean;
  asChild?: boolean;
}) => {
  const ctx = useContext(OpenContext);
  return isValidElement(children)
    ? cloneElement(children as ReactElement<{ disabled?: boolean; onClick?: () => void }>, {
        disabled,
        onClick: () => {
          if (!disabled) ctx.setOpen(true);
        },
      })
    : null;
};

export const ModelSelectorContent = ({ children }: { children?: ReactNode; title?: ReactNode }) =>
  useContext(OpenContext).open ? (
    <div data-testid="model-selector-content">
      <Command label="Choose a model">{children}</Command>
    </div>
  ) : null;

export const ModelSelectorInput = (props: ComponentProps<typeof CommandInput>) => (
  <CommandInput aria-label="Search models" {...props} />
);
export const ModelSelectorList = CommandList;
export const ModelSelectorEmpty = CommandEmpty;
export const ModelSelectorGroup = CommandGroup;
/** The real thing — `value`, `keywords`, `disabled` and cmdk's selection model all intact. */
export const ModelSelectorItem = CommandItem;
export const ModelSelectorLogo = () => null;
export const ModelSelectorName = ({ children }: { children?: ReactNode }) => <span>{children}</span>;
