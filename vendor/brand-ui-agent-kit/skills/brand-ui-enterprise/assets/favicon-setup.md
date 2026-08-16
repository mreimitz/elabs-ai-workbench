# Favicon → Qlik mark

The browser-tab favicon should match the in-app Qlik app icon (the `mark`). This is
an app-level asset step, not a component.

## 1 · Provide the mark

Export the Qlik mark (the glyph `BrandLogo variant="mark"` renders) as an SVG, or drop
it at `public/favicon.svg`.

## 2 · Reference it in `index.html` `<head>`

```html
<link rel="icon" type="image/svg+xml" href="/favicon.svg" />
<!-- optional raster fallback for older browsers -->
<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png" />
```

## 3 · (Optional) theme-aware tab icon

To make the tab icon track light/dark, swap the `href` when the theme mode changes,
using the same `matchMedia("(prefers-color-scheme: dark)")` signal the ThemeSwitcher
uses. A single mark is perfectly fine — keep it simple.
