FROM node:22-bookworm-slim AS base

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

RUN corepack enable

WORKDIR /app

FROM base AS deps

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ git ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json ./
COPY apps/web/package.json apps/web/package.json
COPY apps/api/package.json apps/api/package.json
COPY apps/cli/package.json apps/cli/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/illustrations/package.json packages/illustrations/package.json
# pnpm.patchedDependencies (root package.json) points at patches/node-pty@1.1.0.patch — a fix for
# an upstream node-pty packaging bug (published prebuilds ship spawn-helper without the executable
# bit, so PTY spawn fails at runtime with "posix_spawnp failed" even though install succeeds
# cleanly). Must be present before `pnpm install` or the frozen-lockfile install fails outright.
COPY patches ./patches

RUN pnpm install --frozen-lockfile

# Production-only dependency tree for the runtime image. Same manifests + native toolchain as
# `deps`, but installed with --prod so devDependencies are skipped. Because the web's build-time
# toolchain (vite, @vitejs/plugin-react, the @elabs-ai/components-* design system) now lives in
# apps/web/devDependencies, none of it is installed here — the web ships as a prebuilt static
# `dist`, so the runtime never needs it. This keeps `apps/*/dist` paths identical to the build
# stage (no WEB_DIST_PATH juggling) while dropping the heavy dev toolchain from the final image.
FROM base AS prod-deps

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ git ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json ./
COPY apps/web/package.json apps/web/package.json
COPY apps/api/package.json apps/api/package.json
COPY apps/cli/package.json apps/cli/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/illustrations/package.json packages/illustrations/package.json
# See the `deps` stage above for why patches/ must be copied before `pnpm install`.
COPY patches ./patches

RUN pnpm install --frozen-lockfile --prod

FROM deps AS build

# The web build bundles Monaco + Milkdown + Mermaid (@elabs-ai/components-editor / -charts) and is memory-hungry;
# the default V8 heap OOMs on constrained builders. Scoped to the build stage only — not carried
# into the runtime image. Mirrors the host gate's NODE_OPTIONS=--max-old-space-size=3400.
ENV NODE_OPTIONS=--max-old-space-size=3400

COPY . .
RUN pnpm build

FROM base AS runtime

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates git \
  && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
ENV PORT=8080
ENV HOST=0.0.0.0
ENV DATA_DIR=/data
ENV DATABASE_PATH=/data/app.sqlite

WORKDIR /app

# Production-only node_modules (from prod-deps) — the web dev toolchain / @elabs-ai/components-*
# packages are NOT shipped. The web is served from its prebuilt static dist below, which needs no
# node_modules.
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=prod-deps /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=prod-deps /app/packages/shared/node_modules ./packages/shared/node_modules
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/apps/web/dist ./apps/web/dist
COPY --from=build /app/packages/shared/dist ./packages/shared/dist
COPY package.json pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json

# Assistant (WP R1.2, D-AS20/D-AS21) — the bundled, READ-ONLY skill-authoring reference (a distilled
# skill-creator fallback + best-practices checklist; see apps/api/resources/skill-authoring/). Copied
# as ROOT, still USER root at this point in the build — deliberately NOT chown'd to node below, so
# the non-root `node` user that actually runs the app can READ it (via the Assistant's native
# Read/Glob/Grep tools, once it's in a skill-scoped session's additionalDirectories — see
# session-manager.ts's startSession) but cannot WRITE to it. The SDK's `additionalDirectories` option
# itself grants read+write with no read-only mode (verified against the pinned SDK's `.d.ts` — see
# session-driver.ts's doc on that field); this root-ownership + no-chown is what actually enforces
# "read-only" at the OS level. NOTE (dev-box caveat): this only holds inside the container — running
# the API directly on a dev machine (pnpm dev / tsx), the directory is owned by whatever local user
# runs the process, so it is normally writable there. Nothing in the app ever asks the agent to write
# here either way (it's outside the thread's workspace root / any exec path), so this is defense in
# depth, not the only guard.
COPY --from=build /app/apps/api/resources ./apps/api/resources

# Run as the unprivileged `node` user (already present in the base image) and give it ownership
# of the writable data volume (SQLite DB, generated secret key, attachment blobs, per-feature
# materialized workspaces). The Assistant Hub's per-session workspace tree
# (files.{list,read,write,edit}, output-cap spill, workspace snapshots) is created on demand at
# /data/hub/ws/<sessionId>/ — no separate mkdir needed here, it inherits this ownership the same way
# /data/assistant/ (the embedded Assistant dock's scratch dirs) already does. Retention for that tree
# is HUB_SESSION_RETENTION_DAYS (POST /api/maintenance/prune-hub; 0 = disabled) — see .env.example.
RUN mkdir -p /data && chown -R node:node /data

EXPOSE 8080

# Liveness/readiness against the existing health route. Uses Node's global fetch (Node 22),
# so no extra tooling is needed in the image.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:8080/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

USER node

CMD ["node", "apps/api/dist/index.js"]
