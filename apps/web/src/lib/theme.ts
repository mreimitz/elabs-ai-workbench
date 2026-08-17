import { BUILT_IN_THEMES, type BuiltInThemeName, DEFAULT_THEME } from "@elabs-ai/components-tokens";

/**
 * The themes this app exposes, in display order — the library's two reference themes.
 *
 * Typed against `BuiltInThemeName`, deliberately NOT `ThemeName`. Since v4 theming is an open
 * registry (ADR 0029) and `ThemeName` is just `string`, so `satisfies readonly ThemeName[]` would
 * be vacuous — it would accept a typo silently. `BuiltInThemeName` is the closed union of what the
 * package actually ships, so a slug that stops existing upstream becomes a compile error here.
 */
export const ALLOWED_THEMES = ["light", "dark"] as const satisfies readonly BuiltInThemeName[];

/** The theme this app falls back to (also `ThemeProvider`'s `defaultTheme`). */
export const DEFAULT_ALLOWED_THEME: BuiltInThemeName = DEFAULT_THEME as BuiltInThemeName;

/**
 * The localStorage key `ThemeProvider` (`@elabs-ai/components-tokens`) uses to persist the selected
 * theme — the provider's default `storageKey`, confirmed against the installed build. `main.tsx`
 * writes the app's resolved preference into it before the provider mounts, so the correct theme
 * paints on the first frame.
 *
 * A stale value here (e.g. a pre-v4 `qlik-bright`) is rejected by the provider on boot and the app
 * lands on `light`. That is expected and harmless — but this app also reads the key, so
 * `isAllowedTheme` below is what keeps a stale slug from being copied back into app state.
 */
export const THEME_STORAGE_KEY = "brand-ui-theme";

/** Narrow an active theme to the app's allowed set. */
export function isAllowedTheme(theme: string): theme is (typeof ALLOWED_THEMES)[number] {
  return (ALLOWED_THEMES as readonly string[]).includes(theme);
}

/**
 * The user's theme *preference*: one of the two allowed themes, or `"system"` — an OS-preference
 * follower that resolves to `dark` when the OS reports `prefers-color-scheme: dark`, else `light`.
 * `"system"` is NOT a brand theme; it never reaches `ThemeProvider`, which only ever sees a
 * resolved allowed theme.
 */
export type ThemePreference = (typeof ALLOWED_THEMES)[number] | "system";

/** localStorage key for the preference (distinct from `THEME_STORAGE_KEY`, which stores the resolved theme). */
export const THEME_PREFERENCE_STORAGE_KEY = "mcp-token-footprint.theme-preference";

/**
 * Every theme control in the app (the top-bar switcher AND the Settings mirror) maps over this one
 * ordered list, so the two can never drift. **"System" is listed FIRST** (audit ST2/S12: the
 * OS-follower is the leading choice, not a trailing dropdown afterthought), then the two concrete
 * themes in `ALLOWED_THEMES` order. Concrete-theme labels come from
 * `@elabs-ai/components-tokens` `BUILT_IN_THEME_META` at the call site.
 */
export const THEME_PREFERENCE_ORDER: readonly ThemePreference[] = [
  "system",
  ...ALLOWED_THEMES,
] as const;

function isThemePreference(value: string): value is ThemePreference {
  return value === "system" || isAllowedTheme(value);
}

/** The OS `prefers-color-scheme` mapped onto the app's two allowed themes. */
export function resolveSystemTheme(): (typeof ALLOWED_THEMES)[number] {
  const prefersDark =
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches;
  return prefersDark ? "dark" : "light";
}

/** A preference → the concrete allowed theme to apply. */
export function resolveThemePreference(
  preference: ThemePreference,
): (typeof ALLOWED_THEMES)[number] {
  return preference === "system" ? resolveSystemTheme() : preference;
}

/** Read the persisted preference, defaulting to the app default theme when unset/invalid. */
export function readThemePreference(): ThemePreference {
  try {
    const raw = window.localStorage.getItem(THEME_PREFERENCE_STORAGE_KEY);
    if (raw !== null && isThemePreference(raw)) return raw;
  } catch {
    // localStorage unavailable — fall through to the default.
  }
  return isAllowedTheme(DEFAULT_ALLOWED_THEME) ? DEFAULT_ALLOWED_THEME : ALLOWED_THEMES[0];
}

/** Persist the preference (best-effort; localStorage can throw in private mode). */
export function writeThemePreference(preference: ThemePreference): void {
  try {
    window.localStorage.setItem(THEME_PREFERENCE_STORAGE_KEY, preference);
  } catch {
    // ignore — the in-memory choice still applies for this session.
  }
}

/** Runtime guard: the app's allow-list must stay a subset of what the package actually ships. */
export const UNSHIPPED_ALLOWED_THEMES: readonly string[] = ALLOWED_THEMES.filter(
  (t) => !(BUILT_IN_THEMES as readonly string[]).includes(t),
);
