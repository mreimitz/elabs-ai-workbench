---
description: Run the quality gate (typecheck + test + build) and report honestly
allowed-tools: Bash(pnpm typecheck), Bash(pnpm test), Bash(pnpm build)
---
Run the project's definition-of-done gate and report the result.

```bash
pnpm typecheck && pnpm test && pnpm build
```

Per @.claude/rules/quality-gates.md:
- There is **no** `pnpm lint` or `pnpm quality` script in this repo — do not call them.
- `pnpm test` runs the API tests (node test runner via tsx in `apps/api/test/`); `web` has no
  tests yet.
- Lead with what you actually ran and what failed; don't bury caveats. For a real failure, fix
  forward — don't delete the test or reimplement a dependency to make it pass.
