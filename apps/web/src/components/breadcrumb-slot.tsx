import { createContext, useContext, useEffect, type ReactNode } from "react";

/**
 * Breadcrumb slot — lets a routed page contribute ONE interactive trailing breadcrumb crumb that the
 * static route crumbs (built in `App.tsx`) can't express, because it needs live page state.
 *
 * The Assistant workspace uses it for the session switcher: `Home › Assistant › [Session ▾]`, where
 * the leaf is a live popover over the page's own session data (title, status, the full session list).
 * `App.tsx` has neither the session title nor the switcher, so the page pushes the node here and
 * `AppShell` renders it after the static crumbs.
 *
 * Ownership: `AppShell` holds the slot state and provides this context around its whole subtree (both
 * the TopNav that renders the slot AND the page `children` that set it). A page sets the node via
 * {@link useSetBreadcrumbSlot} (cleared automatically on unmount / route change). Memoize the node in
 * the caller so the effect doesn't re-fire every render.
 */
type BreadcrumbSlotContextValue = {
  slot: ReactNode;
  setSlot: (node: ReactNode) => void;
};

const BreadcrumbSlotContext = createContext<BreadcrumbSlotContextValue | null>(null);

export function BreadcrumbSlotProvider({
  value,
  children,
}: {
  value: BreadcrumbSlotContextValue;
  children: ReactNode;
}) {
  return <BreadcrumbSlotContext.Provider value={value}>{children}</BreadcrumbSlotContext.Provider>;
}

/** AppShell reads the current trailing crumb node (or `null` when no page has contributed one). */
export function useBreadcrumbSlot(): ReactNode {
  return useContext(BreadcrumbSlotContext)?.slot ?? null;
}

/** A page contributes an interactive trailing breadcrumb crumb; it's cleared on unmount. Pass a
 *  memoized node so this effect only re-runs when the node actually changes. */
export function useSetBreadcrumbSlot(node: ReactNode): void {
  const ctx = useContext(BreadcrumbSlotContext);
  const setSlot = ctx?.setSlot;
  useEffect(() => {
    if (!setSlot) return;
    setSlot(node);
    return () => setSlot(null);
  }, [setSlot, node]);
}
