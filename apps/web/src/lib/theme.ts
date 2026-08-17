import type { ThemeName } from "@elabs-ai/components-tokens";

/**
 * The themes this app exposes, in display order.
 *
 * `@elabs-ai/components-tokens` v1.9.0 still ships three themes (`THEMES = ["light",
 * "dark", "blueprint"]`, with `light`/`dark` on the canonical Acme
 * palette), but this app
 * intentionally restricts the UI to the two Acme themes — `blueprint` must not be
 * selectable anywhere. Typed against `ThemeName` so it stays in sync if upstream
 * renames a theme.
 */
export const ALLOWED_THEMES = ["light", "dark"] as const satisfies readonly ThemeName[];

/** The theme this app falls back to (also `ThemeProvider`'s `defaultTheme`). */
export const DEFAULT_ALLOWED_THEME: ThemeName = "light";

/**
 * The localStorage key `ThemeProvider` (`@elabs-ai/components-tokens`) uses to persist the
 * selected theme. This is the provider's default `storageKey` (confirmed in the
 * vendored `@elabs-ai/components-tokens` build); we read it in `main.tsx` to coerce any
 * previously persisted disallowed theme (e.g. `blueprint`) before the provider
 * mounts and re-applies it.
 */
export const THEME_STORAGE_KEY = "brand-ui-theme";

/** Narrow an active theme to the app's allowed set. */
export function isAllowedTheme(theme: string): theme is (typeof ALLOWED_THEMES)[number] {
  return (ALLOWED_THEMES as readonly string[]).includes(theme);
}

/**
 * The user's theme *preference*: one of the two allowed themes, or `"system"` — an OS-preference
 * follower that resolves to `dark` when the OS reports `prefers-color-scheme: dark`, else
 * `light`. `"system"` is NOT a brand theme; it never reaches `ThemeProvider`, which only ever
 * sees a resolved allowed theme. (Note: `blueprint` and other brand themes remain filtered out.)
 */
export type ThemePreference = (typeof ALLOWED_THEMES)[number] | "system";

/** localStorage key for the preference (distinct from `THEME_STORAGE_KEY`, which stores the resolved theme). */
export const THEME_PREFERENCE_STORAGE_KEY = "mcp-token-footprint.theme-preference";

/**
 * Every theme control in the app (the top-bar switcher AND the Settings mirror) maps over this one
 * ordered list, so the two can never drift. **"System" is listed FIRST** (audit ST2/S12: the
 * OS-follower is the leading choice, not a trailing dropdown afterthought), then the two concrete
 * Acme themes in `ALLOWED_THEMES` order. `blueprint` is intentionally absent — the app never offers
 * it. Concrete-theme labels come from `@elabs-ai/components-tokens` `THEME_META` at the call site.
 */
export const THEME_PREFERENCE_ORDER: readonly ThemePreference[] = [
  "system",
  ...ALLOWED_THEMES,
] as const;

function isThemePreference(value: string): value is ThemePreference {
  return value === "system" || isAllowedTheme(value);
}

/** The OS `prefers-color-scheme` mapped onto the app's two allowed themes. */
export function resolveSystemTheme(): ThemeName {
  const prefersDark =
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches;
  return prefersDark ? "dark" : DEFAULT_ALLOWED_THEME;
}

/** A preference → the concrete allowed theme to apply. */
export function resolveThemePreference(preference: ThemePreference): ThemeName {
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
  // ALLOWED_THEMES[0] (not DEFAULT_ALLOWED_THEME, which is widened to ThemeName incl. `blueprint`)
  // so the literal type stays within ThemePreference.
  return ALLOWED_THEMES[0];
}

/** Persist the preference (best-effort; localStorage can throw in private mode). */
export function writeThemePreference(preference: ThemePreference): void {
  try {
    window.localStorage.setItem(THEME_PREFERENCE_STORAGE_KEY, preference);
  } catch {
    // ignore — the in-memory choice still applies for this session.
  }
}
