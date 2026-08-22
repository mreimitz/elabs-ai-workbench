import { expect, test } from "@playwright/test";

// ==================================================================================================
// RM-37 WP 0.4 — the Content-Security-Policy, measured against the REAL built bundle
// ==================================================================================================
//
// A CSP is the one part of this work package that cannot be reasoned into correctness. `style-src
// 'unsafe-inline'` is in the policy because Radix positions every popover, tooltip, select and dialog
// by writing a `style` attribute and Monaco injects `<style>` elements at runtime — but "the design
// system needs it" is a claim until a browser says so. Equally, `script-src 'self'` and `connect-src
// 'self'` are only correct if nothing in the bundle actually reaches off-origin.
//
// So this walks the app in Chromium with the policy live and fails on any violation the page itself
// reports. It runs against the production build the Playwright `webServer` boots (`apps/api/dist`
// serving `apps/web/dist`), which is the only place the real chunk graph exists.
//
// It is deliberately a shallow walk of routes that render without a provider key: the point is CSP
// conformance of the shell, the design system and the lazily-loaded route chunks, not feature
// behaviour — `smoke.spec.ts` owns that.

const ROUTES = [
  "/",
  "/dashboard",
  "/servers",
  "/scans",
  "/skills",
  "/testing/runs",
  "/advisor",
  "/illustrations",
  "/settings/general",
];

test("the SPA renders under the live CSP with no policy violations", async ({ page }) => {
  const violations: string[] = [];

  // Two independent sources, because they catch different things: the page's own
  // `securitypolicyviolation` event sees what the renderer blocked, while the console message is what
  // survives if a violation happens before our listener is installed on a fresh document.
  await page.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (event) => {
      const detail = `${event.violatedDirective} blocked ${event.blockedURI || "(inline)"}`;
      (window as unknown as { __cspViolations?: string[] }).__cspViolations ??= [];
      (window as unknown as { __cspViolations: string[] }).__cspViolations.push(detail);
    });
  });
  page.on("console", (message) => {
    const text = message.text();
    if (text.includes("Content Security Policy") || text.includes("Refused to")) {
      violations.push(text);
    }
  });

  for (const route of ROUTES) {
    const response = await page.goto(route, { waitUntil: "domcontentloaded" });
    // The document response itself must carry the policy — a route that somehow served without it
    // would pass a violation check vacuously.
    if (route === "/") {
      const csp = response?.headers()["content-security-policy"] ?? "";
      expect(csp, "the SPA shell must be served with the policy").toContain(
        "frame-ancestors 'none'",
      );
      expect(response?.headers()["x-content-type-options"]).toBe("nosniff");
      expect(response?.headers()["x-frame-options"]).toBe("DENY");
      expect(response?.headers()["referrer-policy"]).toBe("no-referrer");
    }
    // Let the lazily-loaded route chunk mount and paint before reading violations.
    await page.waitForTimeout(1_500);
    const reported = await page.evaluate(
      () => (window as unknown as { __cspViolations?: string[] }).__cspViolations ?? [],
    );
    for (const entry of reported) violations.push(`${route}: ${entry}`);
  }

  expect(violations, `CSP violations while walking the app:\n${violations.join("\n")}`).toEqual([]);
});

test("the SPA can write through the API — the CSRF round trip works in a real browser", async ({
  page,
}) => {
  // The end-to-end proof that the cookie the API sets, the header the web client sends, and the
  // check the guard runs all agree. A mistake in any one of them 403s every write in production
  // while every unit test in the repo stays green, because each half is only ever tested alone.
  await page.goto("/dashboard");
  await page.waitForTimeout(1_000);

  const cookies = await page.context().cookies();
  expect(
    cookies.find((cookie) => cookie.name === "workbench_csrf"),
    "the API must set the CSRF cookie on a GET",
  ).toBeTruthy();

  // `PUT /api/features` is the smallest real write in the app: no provider key, no MCP server, no
  // migration — and it goes through the very `apiPut` wrapper every other write uses.
  const status = await page.evaluate(async () => {
    const current = await fetch("/api/features").then((r) => r.json());
    const match = /(?:^|;\s*)workbench_csrf=([^;]+)/.exec(document.cookie);
    const response = await fetch("/api/features", {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        ...(match?.[1] ? { "x-workbench-csrf": match[1] } : {}),
      },
      body: JSON.stringify({ assistant: current.flags.assistant }),
    });
    return response.status;
  });
  expect(status, "a same-origin write carrying the CSRF pair must be accepted").toBe(200);

  // …and the same write WITHOUT the header is refused, so the 200 above is not a vacuous pass.
  const refused = await page.evaluate(async () => {
    const response = await fetch("/api/features", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    return response.status;
  });
  expect(refused, "the same write without the CSRF header must be refused").toBe(403);
});
