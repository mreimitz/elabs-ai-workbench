import { createContext, useContext, useEffect, type ReactNode } from "react";

/**
 * Leaf-crumb override channel (run-console header redesign 2026-07-11). Some deep routes need a
 * breadcrumb leaf whose label comes from data only the route itself resolves (e.g. the run
 * console's `test · model` identity, joined from the run detail) — data `App.tsx`, which builds
 * the breadcrumbs, does not hold. Such a route publishes its resolved label here; `App.tsx`
 * consumes it when composing the crumbs and falls back to a static label while it is `null`
 * (loading, or the route never set one). The label auto-clears on unmount, so a route change can
 * never leak a stale leaf onto another page.
 */
const RouteCrumbContext = createContext<(label: string | null) => void>(() => {});

/** Publish `label` as the current route's breadcrumb leaf; clears itself on unmount. */
export function useRouteCrumb(label: string | null): void {
  const publish = useContext(RouteCrumbContext);
  useEffect(() => {
    publish(label);
    return () => publish(null);
  }, [label, publish]);
}

export function RouteCrumbProvider({
  onChange,
  children,
}: {
  /** Stable setter (React state setters qualify) receiving the current leaf label or `null`. */
  onChange: (label: string | null) => void;
  children: ReactNode;
}) {
  return <RouteCrumbContext.Provider value={onChange}>{children}</RouteCrumbContext.Provider>;
}
