import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
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
  // `vite preview` (the verify path, since dev's Monaco ?worker prebundle breaks) does
  // not reuse `server.proxy` — mirror it so the previewed build reaches the API on :8080.
  preview: {
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8080",
        changeOrigin: true,
      },
    },
  },
});
