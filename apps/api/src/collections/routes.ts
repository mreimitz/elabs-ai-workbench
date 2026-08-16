import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { collectionInputSchema } from "@mcp-token-footprint/shared";
import type { CollectionGitSyncService } from "./git-sync.js";
import type { InsightBenchImporter } from "./insightbench-import.js";
import { isSafeRelativePath } from "./path-safety.js";
import type { CollectionService } from "./service.js";

/**
 * The per-file resolution body for `POST /api/collections/:id/resolve`. Kept LOCAL (not in
 * `packages/shared`) because it is a WP-4.2 request-only shape the web sync UI (WP 4.3) will adopt;
 * `SyncConflict`/`CollectionSyncResult` (the responses) already live in shared. `content` is required
 * only for the `edited` side; `take-local`/`take-remote` read the staged sides server-side.
 */
const resolveBodySchema = z.object({
  resolutions: z.array(
    z.object({
      // C-1 / security H1 — reject a traversal path at the boundary. `isSafeRelativePath` bars
      // absolute paths, backslashes, NUL, and any `..`/`.`/empty segment; the sync engine re-asserts
      // containment (and restricts to the merge's known conflict set) before any fs write/delete.
      path: z
        .string()
        .min(1)
        .refine(isSafeRelativePath, "Path must be a relative in-tree path (no `..`, absolute, or `\\`)."),
      resolution: z.enum(["take-local", "take-remote", "edited"]),
      content: z.string().optional(),
    }),
  ),
});

/**
 * Body for `POST /api/collections/import/insightbench` (WP 4.4, B13). The client reads the colleague's
 * `questions.json` and posts its content as `questions` (no multipart — that's an owner-gated dep).
 * `questions` stays loosely typed (array of app groups OR a single group / wrapper) because the file is
 * external and free-form; the importer defensively normalizes/validates it. `collectionId` (optional)
 * assigns the created tests + suite to that collection.
 */
const insightBenchImportBodySchema = z.object({
  collectionId: z.string().trim().min(1).optional(),
  questions: z.union([z.array(z.unknown()), z.record(z.unknown())]),
});

/**
 * Benchmarks collection routes (WP 4.1 CRUD + WP 4.2 two-way git sync, B10/B11). CRUD returns REDACTED
 * collections (never the PAT); the sync surface (`/sync`, `/status`, `/resolve`) drives the real-git
 * engine. Thin — validate with zod, delegate to the services. The sync engine NEVER returns or logs the
 * PAT and NEVER force-pushes.
 */
export async function registerCollectionRoutes(
  app: FastifyInstance,
  collections: CollectionService,
  sync: CollectionGitSyncService,
  insightBench: InsightBenchImporter,
) {
  app.get("/api/collections", async () => collections.list());

  app.get("/api/collections/:id", async (request) => {
    const { id } = request.params as { id: string };
    return collections.get(id);
  });

  app.post("/api/collections", async (request, reply) => {
    const input = collectionInputSchema.parse(request.body);
    const collection = collections.create(input);
    return reply.code(201).send(collection);
  });

  // --- one-way InsightBench import (WP 4.4, B13) ---
  // Convert a colleague's questions.json → this app's graded tests + ONE suite (optionally into a
  // collection). Import ONLY — there is deliberately no exporter; we never write his format back.
  app.post("/api/collections/import/insightbench", async (request, reply) => {
    const body = insightBenchImportBodySchema.parse(request.body);
    const result = insightBench.importQuestions(body);
    return reply.code(201).send(result);
  });

  app.put("/api/collections/:id", async (request) => {
    const { id } = request.params as { id: string };
    const input = collectionInputSchema.parse(request.body);
    return collections.update(id, input);
  });

  app.delete("/api/collections/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    collections.delete(id);
    return reply.code(204).send();
  });

  // --- membership: tests ---
  app.post("/api/collections/:id/tests/:testId", async (request) => {
    const { id, testId } = request.params as { id: string; testId: string };
    return collections.assignTest(id, testId);
  });

  app.delete("/api/collections/:id/tests/:testId", async (request, reply) => {
    const { testId } = request.params as { id: string; testId: string };
    collections.removeTest(testId);
    return reply.code(204).send();
  });

  // --- membership: suites ---
  app.post("/api/collections/:id/suites/:suiteId", async (request) => {
    const { id, suiteId } = request.params as { id: string; suiteId: string };
    return collections.assignSuite(id, suiteId);
  });

  app.delete("/api/collections/:id/suites/:suiteId", async (request, reply) => {
    const { suiteId } = request.params as { id: string; suiteId: string };
    collections.removeSuite(suiteId);
    return reply.code(204).send();
  });

  // --- two-way git sync (WP 4.2, B11) ---
  // Sync only runs on these explicit user actions. Every response is a CollectionSyncResult /
  // CollectionSyncState — never the PAT.
  app.post("/api/collections/:id/sync", async (request) => {
    const { id } = request.params as { id: string };
    return sync.sync(id);
  });

  app.get("/api/collections/:id/status", async (request) => {
    const { id } = request.params as { id: string };
    return sync.status(id);
  });

  app.post("/api/collections/:id/resolve", async (request) => {
    const { id } = request.params as { id: string };
    const body = resolveBodySchema.parse(request.body);
    return sync.resolve(id, body.resolutions);
  });
}
