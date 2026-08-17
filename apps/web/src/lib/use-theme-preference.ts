import { useCallback, useEffect, useState } from "react";
import { useTheme } from "@elabs-ai/components-tokens";
import { readThemePreference, writeThemePreference, type ThemePreference } from "./theme";

/**
 * Bridges the app's theme *preference* (`light` | `dark` | `system`) onto `@elabs-ai/components-tokens`
 * `ThemeProvider`, which only understands concrete themes.
 *
 * - A concrete preference is applied directly via `setTheme`.
 * - `"system"` resolves to `dark`/`light` from `prefers-color-scheme` AND installs a
 *   `matchMedia` listener so an OS light/dark switch re-resolves live.
 *
 * Mount this ONCE at the app root (App) so the OS listener stays active regardless of the current
 * route; expose the returned `preference`/`setPreference` to the Settings theme picker.
 */
export function useThemePreference(): {
  preference: ThemePreference;
  setPreference: (preference: ThemePreference) => void;
} {
  const { setTheme } = useTheme();
  const [preference, setPreferenceState] = useState<ThemePreference>(() => readThemePreference());

  useEffect(() => {
    if (preference !== "system") {
      setTheme(preference);
      return;
    }
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => setTheme(media.matches ? "dark" : "light");
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [preference, setTheme]);

  const setPreference = useCallback((next: ThemePreference) => {
    writeThemePreference(next);
    setPreferenceState(next);
  }, []);

  return { preference, setPreference };
}
