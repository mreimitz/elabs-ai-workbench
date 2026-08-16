import { useCallback, useEffect, useState } from "react";
import { getErrorMessage } from "./errors";

/**
 * A fetch's three distinguishable states — the fix for the `catch(() => setX(null))` swallow that
 * collapsed a genuine failure into a fake-empty. Consumers branch on `status` so "loading",
 * "couldn't load" and "loaded (possibly empty)" are never confused.
 */
export type Loadable<T> =
  | { status: "loading" }
  | { status: "error"; error: string }
  | { status: "data"; data: T };

/** Narrowing helper — the loaded value, or `undefined` while loading/errored. */
export function loadableData<T>(state: Loadable<T>): T | undefined {
  return state.status === "data" ? state.data : undefined;
}

/**
 * Run `load()` into a {@link Loadable} with a `reload()` retry affordance. A mounted/cancel guard
 * discards stale results so a fast re-key (or a retry) can't clobber the latest, and a network/500
 * lands in the `error` arm (not a silent `null`). Pass `enabled: false` to stay in `loading` without
 * fetching — e.g. before an id exists.
 *
 * `load` is intentionally NOT a dependency (it's typically an inline closure whose identity changes
 * every render); pass the values it closes over in `deps`, exactly like a `useEffect` dep array.
 */
export function useLoadable<T>(
  load: () => Promise<T>,
  deps: unknown[],
  opts?: { enabled?: boolean },
): { state: Loadable<T>; reload: () => void } {
  const enabled = opts?.enabled ?? true;
  const [state, setState] = useState<Loadable<T>>({ status: "loading" });
  const [nonce, setNonce] = useState(0);
  const reload = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    if (!enabled) {
      setState({ status: "loading" });
      return;
    }
    let active = true;
    setState({ status: "loading" });
    load()
      .then((data) => {
        if (active) setState({ status: "data", data });
      })
      .catch((error) => {
        if (active) setState({ status: "error", error: getErrorMessage(error) });
      });
    return () => {
      active = false;
    };
    // `load` excluded on purpose (see doc comment); re-run on the caller's deps + retry nonce.
  }, [...deps, nonce, enabled]);

  return { state, reload };
}
