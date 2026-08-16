import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// Vitest harness for apps/web (#18). jsdom + React Testing Library. Kept deliberately light: tests
// target LOGIC (the SSE state machine, loadable/format/mapper helpers) with only a couple of
// component smoke tests, and heavy `@brand/*` editor/chart modules are mocked in the tests that
// don't need them (see the per-test `vi.mock`s) so Monaco/Milkdown never enter the jsdom bundle.
export default defineConfig({
  plugins: [react()],
  // `@xyflow/react` publishes its canvas STORE through React context. A custom React Flow node in
  // `apps/web/src` (the mission graph's `MissionAgentNode`) imports `@xyflow/react` directly, while
  // `@brand/flow`'s `CanvasShell` provides the store from its own import — under jsdom vitest can
  // otherwise load two module instances (two contexts), so a node's `Handle` can't find the provider
  // ("no ReactFlowProvider"). Dedupe to a single instance, matching the production build.
  resolve: { dedupe: ["@xyflow/react"] },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    // Inline `@brand/flow` so vite transforms it (rather than externalizing it): its `@xyflow/react`
    // import then goes through vite's resolver + the `dedupe` above, sharing ONE xyflow instance with
    // the app-src custom node (`MissionAgentNode`). Without this, `@brand/flow`'s `CanvasShell` store
    // and the node's `Handle` load separate xyflow copies under jsdom → "no ReactFlowProvider".
    server: { deps: { inline: ["@brand/flow"] } },
    include: ["src/**/*.test.{ts,tsx}"],
    css: false,
    coverage: {
      provider: "v8",
      reporter: ["text", "text-summary"],
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["src/**/*.test.{ts,tsx}", "src/main.tsx", "src/**/*.d.ts"],
      // Deliberately LOW initial floor that currently passes — a ratchet target, not an aspiration.
      // CI must not go red on coverage; raise these as web coverage grows.
      thresholds: {
        statements: 2,
        branches: 2,
        functions: 2,
        lines: 2,
      },
    },
  },
});
