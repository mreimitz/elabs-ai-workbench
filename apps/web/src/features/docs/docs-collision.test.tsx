/**
 * docs-collision.test.tsx — RM-18 WP 1.2, acceptance item 4.
 *
 * `/docs/*` is the CLIENT ROUTE; the generated bundle is served from `/doc-content/`. Those two must
 * never be the same string, because the API serves `apps/web/dist` at prefix `/` with an SPA
 * not-found fallback — a static directory called `docs/` would be competing with the route for a URL
 * like `/docs/manifest.json`, and which one won would depend on plugin ordering.
 *
 * Asserted in BOTH directions:
 *   - the two constants differ, and the generator writes to the static one;
 *   - `/docs/manifest.json` really lands on the SPA's subject route and renders a not-found state —
 *     not JSON, not a blank page — proved by a render, not by reasoning about it.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { DOCS_ROUTE_BASE, DOC_CONTENT_BASE } from "./docs-manifest";

// The markdown renderer pulls shiki/mermaid into jsdom for no benefit here — the not-found path
// never reaches it. Same stubbing convention the other view tests use.
vi.mock("@elabs-ai/components-ai", () => ({
  MessageResponse: ({ children }: { children?: string }) => <div>{children}</div>,
}));

import { DocsSubjectView } from "./DocsSubjectView";

const repoRoot = join(__dirname, "..", "..", "..", "..", "..");

describe("the static bundle and the client route never collide", () => {
  it("uses two different names", () => {
    expect(DOC_CONTENT_BASE).toBe("/doc-content");
    expect(DOCS_ROUTE_BASE).toBe("/docs");
    expect(DOC_CONTENT_BASE).not.toBe(DOCS_ROUTE_BASE);
    expect(DOC_CONTENT_BASE.startsWith(`${DOCS_ROUTE_BASE}/`)).toBe(false);
  });

  it("the generator writes to the static name, and never to a `docs` directory in public/", () => {
    const source = readFileSync(join(repoRoot, "scripts", "build-docs-bundle.mjs"), "utf8");
    expect(source).toContain('join(repoRoot, "apps", "web", "public", "doc-content")');
    expect(source).not.toContain('join(repoRoot, "apps", "web", "public", "docs")');
  });

  it("`/docs/manifest.json` renders the SPA's not-found state, not a JSON file", async () => {
    // The manifest fetch succeeds; `manifest.json` is simply not a subject in it.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            schema: 1,
            subjects: [
              {
                id: "skills",
                tag: "DC-07",
                title: "Skills",
                description: "",
                documents: [{ id: "08-skills", title: "Skills", description: "", path: "skills/08-skills.md" }],
              },
            ],
            changelog: { id: "changelog", title: "Changelog", path: "changelog.md" },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      ),
    );

    render(
      <MemoryRouter initialEntries={["/docs/manifest.json"]}>
        <Routes>
          <Route path="/docs/:subject" element={<DocsSubjectView />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText("No such page in the guide")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to the guide" })).toHaveAttribute("href", "/docs");
    vi.unstubAllGlobals();
  });
});
