// ==================================================================================================
// Test support — render a primitive to static SVG markup and ask questions about it
// ==================================================================================================
// The package's components are pure functions of their props that return SVG, so the honest way to
// test them is to render them and read the markup. `renderToStaticMarkup` needs no DOM, no jsdom and
// no test renderer; `react-dom` is a DEV dependency of this package for exactly this reason and for
// the preview builder — `react` stays a peer, and nothing here reaches a shipped bundle (D-IL3).

import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";

/** The rendered markup of an element, exactly as a browser would receive it. */
export function render(element: ReactElement): string {
  return renderToStaticMarkup(element);
}

/**
 * The values of one attribute, in document order. Enough to answer "in what order were the layers
 * painted" and "which face tokens did this solid use" without a DOM parser.
 */
export function attributeValues(markup: string, attribute: string): string[] {
  const pattern = new RegExp(`${attribute}="([^"]*)"`, "g");
  return [...markup.matchAll(pattern)].map((match) => match[1] as string);
}

/** Every `var(--illus-*)` token the markup reads, in document order, duplicates kept. */
export function tokensUsed(markup: string): string[] {
  return [...markup.matchAll(/var\((--illus-[a-z0-9-]+)\)/g)].map((match) => match[1] as string);
}

/**
 * A paint value that D-IL5 permits: an `--illus-*` token, `none`, or a reference to a paint server
 * this package defined itself (the paper grid's pattern). Anything else is a literal.
 */
export function isAllowedPaint(value: string): boolean {
  return value === "none" || value.startsWith("var(--illus-") || value.startsWith("url(#illus-");
}

/**
 * Every colour-valued declaration in the markup, whether it came from a `style` attribute or a
 * presentation attribute. Used to assert the D-IL5 invariant on RENDERED output rather than on
 * source text: a component could import a token correctly and still paint a literal.
 */
export function paintValues(markup: string): string[] {
  const values: string[] = [];
  for (const match of markup.matchAll(/(?:^|[;"\s])(fill|stroke)\s*[:=]\s*"?([^;"]+)/g)) {
    const value = (match[2] as string).trim();
    if (value !== "") values.push(value);
  }
  return values;
}
