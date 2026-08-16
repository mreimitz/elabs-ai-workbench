import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import Fastify, { type FastifyInstance } from "fastify";
import { ASSISTANT_DEFAULT_MODEL_ROSTER } from "@mcp-token-footprint/shared";
import type { AssistantAuthService } from "../src/assistant/auth-service.js";
import { registerAssistantRoutes } from "../src/assistant/routes.js";

// Assistant (WP 1.2) — GET /api/assistant/models. `auth` is never exercised by this route, so a bare
// cast stub is enough (routes stay thin: this route only echoes back whatever `deps.models` resolved
// to at startup — the resolution itself is covered by assistant-env.test.ts).

const apps: FastifyInstance[] = [];

afterEach(async () => {
  for (const app of apps.splice(0)) await app.close();
});

function buildApp(): FastifyInstance {
  const app = Fastify();
  apps.push(app);
  return app;
}

test("GET /api/assistant/models returns exactly the configured roster", async () => {
  const app = buildApp();
  await registerAssistantRoutes(app, {
    auth: {} as AssistantAuthService,
    models: ["claude-opus-4-8", "claude-sonnet-4-5"],
  });

  const res = await app.inject({ method: "GET", url: "/api/assistant/models" });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), { models: ["claude-opus-4-8", "claude-sonnet-4-5"] });
});

test("GET /api/assistant/models round-trips the shared static default roster", async () => {
  const app = buildApp();
  await registerAssistantRoutes(app, {
    auth: {} as AssistantAuthService,
    models: [...ASSISTANT_DEFAULT_MODEL_ROSTER],
  });

  const res = await app.inject({ method: "GET", url: "/api/assistant/models" });
  assert.deepEqual(res.json().models, [...ASSISTANT_DEFAULT_MODEL_ROSTER]);
});

test("GET /api/assistant/models returns an empty list rather than erroring when none are configured", async () => {
  const app = buildApp();
  await registerAssistantRoutes(app, { auth: {} as AssistantAuthService, models: [] });

  const res = await app.inject({ method: "GET", url: "/api/assistant/models" });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), { models: [] });
});

test("GET /api/assistant/models prefers the LIVE resolver (same source as the provider dropdown) over the static roster", async () => {
  const app = buildApp();
  // When the live resolver is wired the dock MATCHES the picker; the static `models` is only a fallback.
  await registerAssistantRoutes(app, {
    auth: {} as AssistantAuthService,
    models: ["claude-opus-4-8", "claude-sonnet-4-5"], // stale static — must NOT win
    subscriptionModels: {
      resolve: async () => [
        { id: "claude-opus-4-8", displayName: "Opus 4.8" },
        { id: "claude-sonnet-5", displayName: "Sonnet 5" },
        { id: "claude-fable-5", displayName: "Fable 5" },
      ],
    },
  });

  const res = await app.inject({ method: "GET", url: "/api/assistant/models" });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), {
    models: ["claude-opus-4-8", "claude-sonnet-5", "claude-fable-5"],
  });
});
