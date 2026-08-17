import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { ThemeProvider } from "@brand/tokens";
import { Toaster, TooltipProvider } from "@brand/ui";
// Wire Monaco's web workers (completions/diagnostics/folding) for the @brand/editor CodeEditor.
// Must be imported once, at the app entry, before any editor mounts.
//
// Kept eager here on purpose (code-splitting, research 03-web-review H1): this module imports ONLY
// the five Monaco `*.worker?worker` entry points (Vite bundles each as its own worker chunk) and a
// type — it does NOT pull the heavy `monaco-editor` module into the entry chunk. That weight comes
// from the `CodeEditor`/`DiffEditor` components, which now live behind the `React.lazy` route (and
// dock) boundaries in App.tsx, so they load only when an editor surface is actually opened. Moving
// this worker wiring to first-editor-mount is finicky (the `?worker` prebundle is fragile — see the
// repo notes) and would buy nothing for the entry chunk, so it stays where it reliably works.
import "@brand/editor/monaco-environment";
// @brand/flow's CanvasShell wraps React Flow (@xyflow/react) and its .d.ts REQUIRES consumers to
// import this stylesheet once at the app root (it drives the node/edge/viewport positioning classes
// the canvas relies on). The Design tab (features/skills/design/SkillDesignView.tsx) is its first
// consumer — see dependencies.md: "@brand/flow ... installed today with zero imports".
import "@xyflow/react/dist/style.css";
import { App } from "./App";
import { AssistantProvider } from "./features/assistant/assistant-context";
import {
  ALLOWED_THEMES,
  THEME_STORAGE_KEY,
  readThemePreference,
  resolveThemePreference,
} from "./lib/theme";
import "./styles/app.css";

// @brand/tokens ships three themes (qlik-bright, qlik-dark, blueprint), but this
// app exposes only the two shipped themes (plus a "System" preference that resolves to
// one of them). ThemeProvider has no allow-list prop and will re-apply any persisted
// theme on mount — including a previously selected `blueprint`. Before the provider
// mounts, resolve the app's PREFERENCE to a concrete allowed theme and write it into
// the provider's storage key, so the correct theme paints on first frame (no flash
// when "System" resolves to the opposite of the last-applied theme) and no disallowed
// theme (`blueprint`) can survive. Wrapped in try/catch because localStorage can throw
// (private mode / disabled storage). useThemePreference (mounted in App) then keeps the
// theme in sync with the OS while the preference is "System".
try {
  const resolved = resolveThemePreference(readThemePreference());
  const persisted = window.localStorage.getItem(THEME_STORAGE_KEY);
  if (persisted !== resolved && (ALLOWED_THEMES as readonly string[]).includes(resolved)) {
    window.localStorage.setItem(THEME_STORAGE_KEY, resolved);
  }
} catch {
  // localStorage unavailable — provider falls back to defaultTheme anyway.
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ThemeProvider defaultTheme="qlik-bright" defaultDensity="compact">
      <TooltipProvider delayDuration={200}>
        <BrowserRouter>
          {/* Mounted inside the router (it derives the current envelope from `useLocation`) and near
              the app root (owns the dock's open/close state — see `features/assistant/assistant-context.tsx`). */}
          <AssistantProvider>
            <App />
          </AssistantProvider>
        </BrowserRouter>
        {/* WP 0.2 / S13: offset the toast viewport below the 56px (`h-14`) app header bar so a
            real toast never overlaps the header's controls (the false-completion toast that used to
            land here is now gated at its source in RunConsole). */}
        {/* Interface Craft WP 3.1 (finding 5, D-IC7): `duration={4000}` is the finite default for
            successes/info toasts. Every error toast goes through `notifyError` (`lib/notify.ts`),
            which forces `duration: Infinity` per-call — overriding this default so errors (and the
            one action-bearing toast) stay until the operator dismisses them. */}
        {/* Interface Craft WP 4.3 FIX 2 (P1): `richColors` was DROPPED. Sonner's rich-colors palette
            is hardcoded and theme-agnostic — its error plate measured 4.35:1 in qlik-bright (below AA),
            and since D-IC7 errors now persist it was on screen longer. Instead the per-type toast plates
            are mapped onto the app's SEMANTIC token pairs, which WP 0.1 already tuned to clear AA (the
            `tokens-contrast.test.ts` gate). The vendored `@brand/ui` Toaster spreads `...props` AFTER its
            own `toastOptions`, so passing `toastOptions` REPLACES it wholesale — hence description/action/
            cancel are re-declared here. Color lives ONLY on the per-type keys (`success`/`error`/`warning`/
            `info`) + `default`, never on the shared `toast` base, so no two `bg-*` utilities ever compete
            on one element; the `group-[.toaster]:` variant (mirrors the vendored default) beats sonner's
            built-in `--normal-bg`. Description inherits the plate's own AA foreground (`text-current`)
            instead of `text-muted-foreground`, which would under-contrast on the colored plates. */}
        <Toaster
          closeButton
          position="top-right"
          offset={64}
          duration={4000}
          toastOptions={{
            classNames: {
              // Base (ALL toasts): structure only — the tone color lives in the per-type keys below.
              toast:
                "group toast group-[.toaster]:border group-[.toaster]:shadow-lg group-[.toaster]:rounded-md",
              description: "group-[.toast]:text-current",
              actionButton: "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground",
              cancelButton: "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
              // Neutral `toast(...)` → the original card surface.
              default: "group-[.toaster]:bg-card group-[.toaster]:text-card-foreground",
              // The four tones inherit the WP 0.1 AA-fixed on-fill semantic pairs.
              success:
                "group-[.toaster]:bg-success group-[.toaster]:text-success-foreground group-[.toaster]:border-success",
              error:
                "group-[.toaster]:bg-destructive group-[.toaster]:text-destructive-foreground group-[.toaster]:border-destructive",
              warning:
                "group-[.toaster]:bg-warning group-[.toaster]:text-warning-foreground group-[.toaster]:border-warning",
              info: "group-[.toaster]:bg-info group-[.toaster]:text-info-foreground group-[.toaster]:border-info",
            },
          }}
        />
      </TooltipProvider>
    </ThemeProvider>
  </React.StrictMode>,
);
