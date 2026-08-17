/**
 * dock-fade.guardrail.test.ts — pins the Assistant dock's transcript edge-fade override.
 *
 * WHAT IT GUARDS. `ChatShell variant="bare"` ships two built-in edge scrims implemented as COLOUR
 * gradients — `bg-gradient-to-{b,t} from-background to-transparent`. They dissolve correctly only
 * when the shell sits on `--background`. The dock sits on `--sidebar`, so upstream's scrims painted
 * a visible pale band across the top of the transcript and a second one above the composer. Upstream
 * also renders the composer as a `shrink-0` sibling BELOW the transcript, so the transcript's box
 * stopped dead above it and text could never pass behind it.
 *
 * ChatShell exposes no fade-colour or mask prop (verified with `brand-ui docs ChatShell`: the props
 * are children / composer / header / aside / variant / className), so the fix is a scoped CSS block
 * in `styles/app.css` that (1) kills the colour scrims, (2) masks the transcript to real
 * transparency, and (3) pulls the composer up over the faded tail.
 *
 * WHY A TEST. That block necessarily hooks upstream's internal class names. If a future release
 * renames them the CSS silently stops matching and the pale bands come back — invisible to
 * typecheck, unit tests and lint. This asserts the hooks still exist in the INSTALLED package, so
 * the failure is loud and lands at upgrade time rather than in someone's screenshot.
 *
 * It deliberately reads the shipped `dist`, not a copy of it: the point is to detect upstream drift.
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

const chatShellDist = readFileSync(require.resolve("@elabs-ai/components-ai"), "utf8");
const appCss = readFileSync(join(__dirname, "..", "styles", "app.css"), "utf8");
const dock = readFileSync(
  join(__dirname, "..", "features", "assistant", "AssistantDock.tsx"),
  "utf8",
);

/** The exact scrim class strings the app.css block selects on. */
const TOP_SCRIM = "pointer-events-none absolute inset-x-0 top-0 z-10 h-8 bg-gradient-to-b from-background to-transparent";
const BOTTOM_SCRIM = "pointer-events-none absolute inset-x-0 bottom-0 z-10 h-12 bg-gradient-to-t from-background to-transparent";

describe("GUARDRAIL — the Assistant dock's transcript edge fades", () => {
  it("upstream ChatShell still renders both bare-variant colour scrims we neutralize", () => {
    for (const [name, scrim] of [
      ["top", TOP_SCRIM],
      ["bottom", BOTTOM_SCRIM],
    ] as const) {
      expect(
        chatShellDist,
        `ChatShell's ${name} scrim class list changed. The app.css '.assistant-dock-shell' block ` +
          "selects it to kill the colour gradient; update BOTH together or the pale band returns.",
      ).toContain(scrim);
    }
  });

  it("upstream still renders the composer as a positioned sibling we can pull up (relative z-20)", () => {
    expect(
      chatShellDist,
      "ChatShell's bare composer wrapper is no longer `relative z-20 px-4 pb-4`. app.css pulls it up " +
        "by a negative margin and relies on it painting ABOVE the transcript.",
    ).toContain("relative z-20 px-4 pb-4");
  });

  it("the dock carries the styling hook the override is scoped to", () => {
    expect(dock, "AssistantDock must keep the `assistant-dock-shell` class on its ChatShell").toMatch(
      /assistant-dock-shell/,
    );
  });

  it("app.css neutralizes the colour scrims and masks the transcript to transparency", () => {
    const block = appCss.slice(appCss.indexOf(".assistant-dock-shell"));
    expect(block, "must stop the scrims painting").toMatch(/background:\s*none/);
    expect(block, "must fade to real transparency, not to a colour").toMatch(/mask-image:\s*linear-gradient/);
    expect(block, "must fade at BOTH edges").toMatch(/--dock-fade-top/);
    expect(block, "must fade at BOTH edges").toMatch(/--dock-fade-bottom/);
    expect(block, "must pull the composer over the faded tail").toMatch(/margin-top:\s*calc\(var\(--dock-fade-bottom\) \* -1\)/);
  });

  it("the transcript reserves room for the composer overlap, so the last message can clear it", () => {
    // app.css pulls the composer up over the transcript; without matching bottom padding on the
    // scroll content the final message would sit permanently underneath it.
    expect(
      dock,
      "ConversationContent must keep its bottom padding for the composer overlap",
    ).toMatch(/<ConversationContent className="[^"]*\bpb-14\b/);
  });
});
