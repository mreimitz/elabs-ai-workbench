"use client";
/**
 * Frame-level UI state for the tool/workspace shell: navigator (left) + inspector
 * (right) visibility, command-palette open, and FOCUS MODE (⌘.) — one keystroke
 * collapses both panes for nothing-but-content; one keystroke restores them. Focus
 * persists across launches; manually opening a pane exits focus.
 *
 * Generalized from a qLabs tool/workspace app's UI-state provider.
 */
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

interface UiStateValue {
  navigatorOpen: boolean;
  toggleNavigator: () => void;
  inspectorOpen: boolean;
  setInspectorOpen: (open: boolean) => void;
  toggleInspector: () => void;
  paletteOpen: boolean;
  setPaletteOpen: (open: boolean) => void;
  focusMode: boolean;
  toggleFocus: () => void;
}

const UiStateContext = createContext<UiStateValue | null>(null);
const NAV_KEY = "ui.navigator";
const FOCUS_KEY = "ui.focus"; // present while focus is ON; stores pane states to restore

function readFocusKey(): { nav: boolean; inspector: boolean } | null {
  try {
    const raw = localStorage.getItem(FOCUS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { nav?: boolean; inspector?: boolean };
    return { nav: parsed.nav ?? true, inspector: parsed.inspector ?? false };
  } catch {
    return null;
  }
}

export function UiStateProvider({ children }: { children: ReactNode }) {
  const bootFocus = useMemo(readFocusKey, []);
  const [focusMode, setFocusMode] = useState<boolean>(bootFocus !== null);
  const [navigatorOpen, setNavigatorOpen] = useState<boolean>(() => {
    if (bootFocus) return false;
    try {
      return localStorage.getItem(NAV_KEY) !== "closed";
    } catch {
      return true;
    }
  });
  const [inspectorOpen, setInspectorOpenState] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);

  const clearFocusFlag = useCallback(() => {
    setFocusMode(false);
    try {
      localStorage.removeItem(FOCUS_KEY);
    } catch {
      // ignore
    }
  }, []);

  const toggleNavigator = useCallback(() => {
    clearFocusFlag(); // a manual pane toggle is a deliberate change — it ends focus
    setNavigatorOpen((open) => {
      try {
        localStorage.setItem(NAV_KEY, open ? "closed" : "open");
      } catch {
        // ignore
      }
      return !open;
    });
  }, [clearFocusFlag]);

  const setInspectorOpen = useCallback(
    (open: boolean) => {
      if (open) clearFocusFlag();
      setInspectorOpenState(open);
    },
    [clearFocusFlag],
  );

  const toggleInspector = useCallback(() => {
    clearFocusFlag();
    setInspectorOpenState((o) => !o);
  }, [clearFocusFlag]);

  const toggleFocus = useCallback(() => {
    setFocusMode((on) => {
      if (on) {
        const saved = readFocusKey() ?? { nav: true, inspector: false };
        setNavigatorOpen(saved.nav);
        setInspectorOpenState(saved.inspector);
        try {
          localStorage.removeItem(FOCUS_KEY);
        } catch {
          // ignore
        }
        return false;
      }
      try {
        localStorage.setItem(
          FOCUS_KEY,
          JSON.stringify({ nav: navigatorOpen, inspector: inspectorOpen }),
        );
      } catch {
        // ignore
      }
      setNavigatorOpen(false);
      setInspectorOpenState(false);
      return true;
    });
  }, [navigatorOpen, inspectorOpen]);

  const value = useMemo(
    () => ({
      navigatorOpen,
      toggleNavigator,
      inspectorOpen,
      setInspectorOpen,
      toggleInspector,
      paletteOpen,
      setPaletteOpen,
      focusMode,
      toggleFocus,
    }),
    [
      navigatorOpen,
      toggleNavigator,
      inspectorOpen,
      setInspectorOpen,
      toggleInspector,
      paletteOpen,
      focusMode,
      toggleFocus,
    ],
  );

  return <UiStateContext.Provider value={value}>{children}</UiStateContext.Provider>;
}

export function useUiState(): UiStateValue {
  const ctx = useContext(UiStateContext);
  if (!ctx) throw new Error("useUiState must be used within <UiStateProvider>");
  return ctx;
}
