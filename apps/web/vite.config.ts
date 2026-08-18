import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // DEV-SERVER FIX (`pnpm dev` / the "Web: debug in Chrome" launch profile).
  //
  // `@elabs-ai/components-editor/monaco-environment` imports Monaco's workers with Vite's `?worker`
  // suffix (`monaco-editor/esm/vs/editor/editor.worker?worker`). That suffix is a VITE convention,
  // not a real path — but dependency pre-bundling runs in esbuild, which knows nothing about it and
  // tries to open a file literally named `editor.worker.js?worker`. It fails, pre-bundling aborts,
  // and the dev server serves NOTHING (the production build is unaffected: the `?worker` import is
  // handled by Vite itself, not esbuild).
  //
  // The fix is surgical: mark `?worker` specifiers external for the PRE-BUNDLE pass only, so esbuild
  // stops following them while every dependency still gets pre-bundled normally. Excluding the
  // editor package instead was tried and is worse — it drops its transitive CJS `debug` out of the
  // pre-bundle graph too, and the raw CJS file then has no ESM `default` export, so the editor
  // routes crash at runtime.
  optimizeDeps: {
    esbuildOptions: {
      plugins: [
        {
          name: "vite-worker-suffix-external",
          setup(build) {
            build.onResolve({ filter: /\?worker$/ }, (args) => ({ path: args.path, external: true }));
          },
        },
      ],
    },
  },
  // NOTE (code-splitting, research 03-web-review H1): no `build.rollupOptions.output.manualChunks`
  // here on purpose. The `React.lazy` route/dock boundaries in App.tsx already let Rollup split the
  // heavy libraries — Monaco (`@elabs-ai/components-editor`), Mermaid, `@elabs-ai/components-charts`/`@visx`, `@xyflow/react` —
  // into their own on-demand chunks with NOTHING heavy preloaded on first paint. A naive
  // `manualChunks` that pins those packages by name was tried and REGRESSED first paint: it dragged
  // shared transitive code into the named vendor chunks, which turned them into static dependencies
  // of the entry chunk (Vite then emitted `modulepreload` links for Monaco + charts + xyflow), so
  // the heavy libs loaded eagerly again. Rollup's automatic splitting off the lazy boundaries is the
  // cleaner result; leave it alone unless a measured win justifies otherwise.
  server: {
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8080",
        changeOrigin: true,
      },
    },
  },
  // `vite preview` does not reuse `server.proxy` — mirror it so the previewed build reaches the API
  // on :8080. (It used to be the ONLY verify path because dev's Monaco `?worker` pre-bundle broke;
  // the optimizeDeps plugin above fixes that, so `pnpm dev` is usable again and preview is now just
  // the way to verify a PRODUCTION bundle.)
  preview: {
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8080",
        changeOrigin: true,
      },
    },
  },
});
