# Quality gates (definition of done)

A change is "done" only when these hold. The gate is:

```bash
pnpm typecheck && pnpm test && pnpm build && pnpm lint
```

| Gate | Command | Enforces |
| ---- | ------- | -------- |
| **Typecheck** | `pnpm typecheck` | Strict TS across all packages (`tsc --noEmit`), fully green. |
| **Test** | `pnpm test` | API tests (node test runner via `tsx`, in `apps/api/test/`) + web tests (vitest, ~97 files) pass. |
| **Build** | `pnpm build` | `shared` + `api` (tsc) and `web` (vite build) all build. |
| **Lint** | `pnpm lint` | **Biome** (`biome check`, `biome.json`) is clean. `pnpm format` applies the formatter. |

There is **no ESLint**; linting is **Biome**. **All four are run locally** — this repo has no
`ci.yml`; its only workflow is `.github/workflows/mcp-self-scan.yml`, the D-MCP5 dogfood gate
(`pnpm mcp:self-scan`), which asserts the workbench MCP server's own definition-token budget and is
*not* the quality gate. The `/quality` command runs the gate and reports honestly.

## Manual checklist

- [ ] Wire shapes changed in `packages/shared` first (types + zod), then API, then web.
- [ ] Visible UI uses the component library (`brand-ui`); no ad-hoc colored markup. New primitives
      added to the library, not the app (see `library-first.md`).
- [ ] No raw color literals in `.tsx` (the `check-tokens` hook is a nudge, not a guarantee).
- [ ] Renders correctly in **both** themes (`light`, `dark`) — verified by looking.
- [ ] MCP/connection/scan failures surface in the UI (toast/error boundary); no fake results.
- [ ] Secrets stay server-side and out of git (see `mcp-and-security.md`); only `.env.example`
      is committed.
- [ ] Accessibility: keyboard reachable, visible focus, labels/roles; no `div`-as-button.

## Reporting completion honestly

- **"Done"/"green" = what you actually ran**, not what you wrote. If you couldn't run a gate, say
  so in the headline, not a footnote.
- **Lead with what you did NOT verify.** Visual/UX/a11y claims must cite the **real running app**
  (e.g. http://localhost:8080/), never a mock or self-authored demo.
- **Verify every file path/link you cite resolves** before putting it in a summary.

## If a test/typecheck is failing

Fix forward. Don't paper over a failure by reimplementing a dependency locally or deleting the
failing test. If it's a real defect to track, note it clearly for the owner.
