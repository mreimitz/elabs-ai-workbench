/**
 * sidebar-ink.guardrail.test.ts — v4 migration guardrail.
 *
 * Text drawn on the sidebar rail must take its color from the **sidebar** token family
 * (`--sidebar-foreground` / `--sidebar-muted-foreground`), never the page's (`--foreground` /
 * `--muted-foreground`).
 *
 * WHY THIS EXISTS. Under the pre-v4 themes the light theme's rail was a light surface, so page ink
 * happened to read on it and the app's hand-written `SidebarHeader` / `SidebarFooter` text got away
 * with `@elabs-ai/components-ui` `Text`'s default tone. v4's light theme makes the rail a DARK navy
 * (`--sidebar: oklch(0.3 0.021 257)`) while `--foreground` stays a near-identical dark grey
 * (`oklch(0.3 0.021 257)`) — byte-identical, so the "AI Workbench" wordmark rendered **invisible**
 * against its own background. Caught by looking at the running app; typecheck and every unit test
 * were green with it broken.
 *
 * `Text`'s `tone` prop is `default | primary | muted`, all page-ink, so there is no variant to pass
 * — the token has to come through a className. That is sanctioned by `styling-and-tokens.md`
 * ("semantic, token-backed utilities only… `bg-sidebar`"): it binds the element to the correct
 * semantic token for the surface it sits on, which is exactly what every `SidebarMenuButton` in the
 * rail already does internally. It is NOT the "className recolors a component" anti-pattern.
 *
 * Structural assertion, in the house style of `active-nav-contrast.guardrail.test.ts`: jsdom has no
 * cascade or contrast engine, so this reads the source and checks the sidebar chrome blocks.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const appShell = readFileSync(join(__dirname, "..", "components", "AppShell.tsx"), "utf8");

/** The body of a `<SidebarHeader>` / `<SidebarFooter>` block — the app's own chrome on the rail. */
function chromeBlock(tag: "SidebarHeader" | "SidebarFooter"): string {
  const open = appShell.indexOf(`<${tag}>`);
  const close = appShell.indexOf(`</${tag}>`);
  expect(open, `AppShell must render a <${tag}>`).toBeGreaterThanOrEqual(0);
  expect(close, `AppShell must close its <${tag}>`).toBeGreaterThan(open);
  return appShell.slice(open, close);
}

const SIDEBAR_INK = /text-sidebar-(foreground|muted-foreground)/;

describe("GUARDRAIL — sidebar chrome uses SIDEBAR ink, not page ink", () => {
  it.each(["SidebarHeader", "SidebarFooter"] as const)(
    "%s renders every <Text> with a sidebar ink token",
    (tag) => {
      const block = chromeBlock(tag);
      const texts = [...block.matchAll(/<Text\b[\s\S]*?>/g)].map((m) => m[0]);
      expect(texts.length, `<${tag}> should render at least one <Text>`).toBeGreaterThan(0);
      for (const text of texts) {
        expect(
          text,
          `a <Text> in <${tag}> has no sidebar ink token, so it inherits PAGE ink. In the light ` +
            "theme the rail is dark navy and --foreground is a near-identical dark grey, which " +
            `renders it invisible. Add text-sidebar-foreground / -muted-foreground.\n\n${text}`,
        ).toMatch(SIDEBAR_INK);
      }
    },
  );

  it.each(["SidebarHeader", "SidebarFooter"] as const)(
    "%s never uses the PAGE muted tone/utility on the rail",
    (tag) => {
      const block = chromeBlock(tag);
      // `tone="muted"` resolves to --muted-foreground (page ink); on the rail it must be the
      // sidebar's own muted token instead. `text-muted-foreground` is the same mistake by class.
      expect(block, `<${tag}> must not use the page 'muted' tone on the sidebar surface`).not.toMatch(
        /tone="muted"/,
      );
      expect(
        block.replace(/text-sidebar-muted-foreground/g, ""),
        `<${tag}> must not use the page text-muted-foreground utility on the sidebar surface`,
      ).not.toMatch(/text-muted-foreground/);
    },
  );
});
