# 06 Docker Plan

## Target

One Docker container runs the API, serves the built frontend, stores SQLite data, and executes MCP scans.

## Runtime

- Node.js 22
- pnpm via corepack during build
- API listening on `0.0.0.0:8080`
- SQLite path `/data/app.sqlite`
- one exposed port: `8080`

## Persistence

Docker Compose mounts a named volume to `/data`.

## Build Flow

1. Install workspace dependencies.
2. Build shared package.
3. Build brand UI adapter.
4. Build web app.
5. Build API.
6. Runtime image starts `apps/api/dist/index.js`.

## MCP Process Support

The container includes Node and `npx` through npm. It also includes `git` and CA certificates for common package download and HTTP transport needs.
