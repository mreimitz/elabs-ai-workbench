"use client";
/**
 * Theme switcher — System / Qlik Bright / Qlik Dark (the baseline default).
 * Grounded in a qLabs tool/workspace app's theme switcher.
 *
 * PREFER the library `<ThemeSwitcher />` from @brand/ui: its `themes` defaults to the
 * Qlik light/dark pair and `showSystem` defaults to true, so it ALREADY renders exactly
 * System / Qlik Bright / Qlik Dark (whole-screen animated, reduced-motion safe). This
 * curated Select is an OPTIONAL alternative when you want explicit text labels instead
 * of the icon toggle. (Verified against @brand/* v1.0.0 source.)
 */
import { THEME_META, useTheme, type ThemeName } from "@brand/tokens";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@brand/ui";
import { useEffect, useState } from "react";

const MODE_KEY = "ui.themeMode";
const LIGHT: ThemeName = "qlik-bright";
const DARK: ThemeName = "qlik-dark";
type ThemeMode = "qlik-bright" | "qlik-dark" | "system";

function storedMode(): ThemeMode {
  try {
    const v = localStorage.getItem(MODE_KEY);
    return v === "qlik-dark" || v === "system" ? v : "qlik-bright";
  } catch {
    return "qlik-bright";
  }
}
function systemTheme(): ThemeName {
  return typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches
    ? DARK
    : LIGHT;
}

export function ThemeSwitcher() {
  const { setTheme } = useTheme();
  const [mode, setMode] = useState<ThemeMode>(storedMode);

  // Apply the mode; in System, follow OS appearance changes live.
  useEffect(() => {
    if (mode !== "system") {
      setTheme(mode);
      return;
    }
    setTheme(systemTheme());
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => setTheme(systemTheme());
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [mode, setTheme]);

  const choose = (next: ThemeMode) => {
    setMode(next);
    try {
      localStorage.setItem(MODE_KEY, next);
    } catch {
      // ignore
    }
  };

  return (
    <Select value={mode} onValueChange={(v) => choose(v as ThemeMode)}>
      <SelectTrigger size="sm" className="w-[150px]" aria-label="Appearance">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="qlik-bright">{THEME_META[LIGHT].label}</SelectItem>
        <SelectItem value="qlik-dark">{THEME_META[DARK].label}</SelectItem>
        <SelectItem value="system">System</SelectItem>
      </SelectContent>
    </Select>
  );
}
