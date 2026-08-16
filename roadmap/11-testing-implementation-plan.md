# 11 Testing — Implementation Plan → moved

**This one-page plan has been expanded into a folder of per-work-package specs.**

➡️ **[`roadmap/testing/`](./testing/README.md)** is now the authoritative implementation
plan. Start at its `README.md` (the master plan + WP index + build order), then read
`conventions.md` (shared rules every spec assumes) and `references.md` (external sources + internal
cross-references), then open the individual `WP-*.md` files.

Structure:

```
roadmap/testing/
├── README.md            master plan: index, dependency graph, build order, API surface
├── conventions.md       repo patterns, contract-first flow, security boundary, definition of done
├── references.md        external docs + research sources + internal cross-ref map
├── phase-0-foundations/ WP 0.1–0.4  (charts, deps, shared contract, DB schema)
├── phase-1-run-engine/  WP 1.1–1.6  (credentials, MCP session, agent loop, accounting, guardrails, persistence)
├── phase-2-api/         WP 2.1–2.4  (scenario/test CRUD, SSE, providers, tests)
├── phase-3-web-ui/      WP 3.1–3.8  (nav, authoring, console, conversation, chart, inspector, replay, compare)
└── phase-4-hardening/   WP 4.1–4.4  (theming/a11y, export, config/docs/docker, e2e verification)
```

Companion docs: [`09-testing.md`](./09-testing.md) (scope) ·
[`10-testing-ui-concept.md`](./10-testing-ui-concept.md) (UI wireframes, referenced by the
Phase 3 specs).
