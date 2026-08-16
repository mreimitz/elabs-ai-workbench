// Assistant (WP 2.3) — the app-data WRITE tools (D-AS3): tests/environments/attachments/skill
// attachments/server config/collections/suites. Every tool here is WRITE-classified by the permission
// classifier (`permission-classifier.ts`) by the SAME fail-safe default WP 2.2's workspace tools rely
// on — nothing in this module is added to the read allowlist, so every call goes through the WP 2.1
// approval round-trip unless the thread has auto-accept ON. Every `*_delete` tool's BARE name is
// ALSO registered in `permission-classifier.ts`'s `EXPLICIT_DELETE_TOOLS` (belt-and-braces on top of
// the destructive-verb net) so it ALWAYS asks, even under auto-accept.
//
// THE CENTRAL RULE (secrets discipline, CLAUDE.md §7 / `.claude/rules/mcp-and-security.md`):
// `servers_update_config`'s zod schema below carries ONLY name/transport/command/args/url — it does
// NOT declare `env`, `headers`, or `auth` keys AT ALL, so submitting a secret through this tool is
// IMPOSSIBLE BY CONSTRUCTION (the Agent SDK builds a `z.object` from this raw shape and zod's default
// behavior strips unrecognized keys — even a confused/adversarial agent that tries to pass `env` gets
// it silently dropped before this handler ever sees it). Likewise `collections_modify` never declares
// a `pat` field, so a collection's GitHub PAT can never be set/rotated through the assistant either —
// both are owner-only, done through the app's own settings windows. See
// `apps/api/test/assistant-write-tools.test.ts`'s "no write-tool schema carries a secret" test, which
// walks every definition here and asserts none of its input-schema KEYS look secret-shaped.
//
// Every write here calls an EXISTING repository/service method — this module owns none of the create/
// update/delete SQL or validation, only the tool-shaped adapter + (for the few operations with no
// direct repository method, e.g. attach/detach ONE skill without restating a scenario's whole config)
// a read-modify-write built from already-exported read/update primitives.
import { tool } from "@anthropic-ai/claude-agent-sdk";
import {
  scenarioInputSchema,
  serverConfigUpdateSchema,
  skillVersionModeSchema,
  suiteInputSchema,
  testAttachmentInputSchema,
  testExpectationsSchema,
  testInputSchema,
} from "@mcp-token-footprint/shared";
import type {
  AllowedSkill,
  Collection,
  Scenario,
  ScenarioInput,
  Suite,
  Test,
  TestInput,
} from "@mcp-token-footprint/shared";
import { z } from "zod";
import type { CollectionRepository } from "../../collections/repository.js";
import type { ServerRepository } from "../../servers/repository.js";
import type { SkillRepository } from "../../skills/repository.js";
import type { ScenarioRepository } from "../../testing/scenario-repository.js";
import { assertSkillOverridesResolvable } from "../../testing/scenario-service.js";
import type { TestService } from "../../testing/test-service.js";
import type { SuiteRepository } from "../../suites/repository.js";
import { jsonResult, safeTool } from "./util.js";

/**
 * Every WP 2.3 write tool's bare name — exported so `tools/index.ts`'s spread point and the
 * inventory-sanity test (`assistant-tools.test.ts`) can assert the full registry without hardcoding
 * the strings twice (mirrors `ASSISTANT_WORKSPACE_TOOL_NAMES`/`ASSISTANT_UI_TOOL_NAMES`).
 */
export const ASSISTANT_WRITE_TOOL_NAMES = [
  "tests_create",
  "tests_update",
  "tests_delete",
  "expectations_set",
  "environments_create",
  "environments_update",
  "environments_delete",
  "attachments_manage",
  "environments_attach_skill",
  "environments_detach_skill",
  "servers_update_config",
  "collections_modify",
  "suites_create",
  "suites_update",
  "suites_delete",
] as const;

/**
 * The dependencies the write tools need. `tests` is `TestService` (NOT the bare `TestRepository` the
 * read toolset uses) because deleting a test and adding an attachment both touch the filesystem (blob
 * cleanup / blob write) — logic that lives in the service, not the repository; reusing it here (rather
 * than reimplementing fs handling against the repository directly) is the point. Every other field is
 * the SAME repository the read toolset already depends on (`ScenarioRepository`/`ServerRepository`/
 * `CollectionRepository`/`SkillRepository`), plus `SuiteRepository`, which the read toolset has no use
 * for today but the write tools need for `suites_*`.
 */
export interface WriteToolDeps {
  tests: TestService;
  environments: ScenarioRepository;
  servers: ServerRepository;
  collections: CollectionRepository;
  suites: SuiteRepository;
  skills: SkillRepository;
}

// ── Small read-modify-write helpers ────────────────────────────────────────────────────────────────
// `TestInput`/`ScenarioInput` are Omit<Test|Scenario, id/createdAt/updatedAt/…> — a full-replace PUT
// shape. `tests_update`/`environments_update` take a caller-supplied full replacement (matching what
// the web editor forms already send); `expectations_set` and the skill attach/detach tools instead
// snapshot the CURRENT entity into this same input shape, mutate the one field they own, and write the
// whole thing back — so they change ONLY that field, never resetting anything else to a default.

function testInputFromExisting(test: Test): TestInput {
  return {
    name: test.name,
    userPrompt: test.userPrompt,
    systemPromptOverride: test.systemPromptOverride,
    addedProfiles: test.addedProfiles,
    assertions: test.assertions,
    expectations: test.expectations,
    category: test.category,
    difficulty: test.difficulty,
    tags: test.tags,
    // collectionId intentionally omitted — TestRepository.update preserves current membership when
    // it's absent from the input (see test-repository.ts); these helpers never move a test.
  };
}

function scenarioInputFromExisting(scenario: Scenario): ScenarioInput {
  return {
    name: scenario.name,
    providerId: scenario.providerId,
    model: scenario.model,
    params: scenario.params,
    systemPrompt: scenario.systemPrompt,
    allowedServers: scenario.allowedServers,
    allowedSkills: [...scenario.allowedSkills],
    defaultProfiles: scenario.defaultProfiles,
    guardrails: scenario.guardrails,
    toolLoadingMode: scenario.toolLoadingMode,
  };
}

// ── Compact result shapes ───────────────────────────────────────────────────────────────────────────
// A `*Link` field is included ONLY when the entity has a REAL, currently-deep-linkable app route
// (verified against `apps/web/src/App.tsx`'s `<Routes>` at WP 2.3 time: `/servers/:serverId`,
// `/testing/collections/:collectionId`, and `/testing/suites/:suiteId` are real; tests and
// Environments have NO per-item detail route today — only their list views — so `tests_*`/
// `environments_*` responses carry the bare id, never a fabricated link). This mirrors
// `workspace-tools.ts`'s `skillLink` discipline: never point the dock at a URL that doesn't resolve.

function compactTest(test: Test): Record<string, unknown> {
  return {
    testId: test.id,
    name: test.name,
    collectionId: test.collectionId ?? null,
    collectionLink: test.collectionId ? `/testing/collections/${test.collectionId}` : undefined,
    updatedAt: test.updatedAt,
  };
}

function compactEnvironment(scenario: Scenario): Record<string, unknown> {
  return {
    environmentId: scenario.id,
    name: scenario.name,
    providerId: scenario.providerId,
    model: scenario.model,
    allowedSkillsCount: scenario.allowedSkills.length,
    updatedAt: scenario.updatedAt,
  };
}

function compactSuite(suite: Suite): Record<string, unknown> {
  return {
    suiteId: suite.id,
    name: suite.name,
    testCount: suite.testIds.length,
    scenarioCount: suite.scenarioIds.length,
    suiteLink: `/testing/suites/${suite.id}`,
    updatedAt: suite.updatedAt,
  };
}

function compactCollection(collection: Collection, action: string): Record<string, unknown> {
  return {
    action,
    collectionId: collection.id,
    name: collection.name,
    collectionLink: `/testing/collections/${collection.id}`,
  };
}

/** Throw a clear, model-legible error (caught by `safeTool`) instead of silently proceeding with `undefined`. */
function requireArg<T>(value: T | undefined, field: string, action: string): T {
  if (value === undefined) {
    throw new Error(`"${field}" is required for collections_modify action "${action}".`);
  }
  return value;
}

export function buildWriteToolDefinitions(deps: WriteToolDeps) {
  return [
    // ── Tests ────────────────────────────────────────────────────────────────────────────────────
    tool(
      "tests_create",
      "Create a new test: a reusable prompt + optional grading expectations (Benchmarks), " +
        "validation-gate assertions, category/difficulty/tags, and (optionally) which Benchmarks " +
        'collection it belongs to — omit collectionId to default to the local "Local" collection.',
      { ...testInputSchema.shape },
      async (args) => safeTool(() => jsonResult(compactTest(deps.tests.create(args)))),
    ),

    tool(
      "tests_update",
      "Update a test. FULL REPLACE of its editable fields — provide the complete desired state; an " +
        "omitted optional field (assertions, expectations, category, difficulty) is CLEARED, and " +
        "tags defaults to []. Prefer expectations_set when you only want to change the grading " +
        "expectations block without touching anything else. Provide collectionId to move the test to " +
        "a different collection; omit it to keep its current membership.",
      { testId: z.string().min(1), ...testInputSchema.shape },
      async (args) =>
        safeTool(() => {
          const { testId, ...input } = args;
          return jsonResult(compactTest(deps.tests.update(testId, input)));
        }),
    ),

    tool(
      "tests_delete",
      "Permanently delete a test and its attachments (blob files removed from disk too). CASCADES: " +
        "every run recorded against this test is deleted along with it. This cannot be undone — " +
        "always asks for approval regardless of auto-accept.",
      { testId: z.string().min(1) },
      async (args) =>
        safeTool(() => {
          deps.tests.delete(args.testId);
          return jsonResult({ testId: args.testId, deleted: true });
        }),
    ),

    tool(
      "expectations_set",
      "Set (replace) a test's grading-expectations block (expectedInsight/expectedValue/" +
        "referenceLogic/answerable/rubricOverride — used by the Benchmarks output-quality graders). " +
        "Only `expectations` changes; every other field of the test (prompt, assertions, tags, " +
        "category, …) is preserved exactly. Pass {} to clear the whole block.",
      { testId: z.string().min(1), expectations: testExpectationsSchema },
      async (args) =>
        safeTool(() => {
          const current = deps.tests.get(args.testId); // 404 if unknown
          const input = testInputFromExisting(current);
          input.expectations = args.expectations;
          const updated = deps.tests.update(args.testId, input);
          return jsonResult({ ...compactTest(updated), expectations: updated.expectations });
        }),
    ),

    tool(
      "attachments_manage",
      "Add an attachment (file/image/text) to a test as a small base64-encoded blob, counted toward " +
        'the test\'s token footprint when included in a run. `action` is currently ALWAYS "add" — ' +
        "the app has no attachment-removal endpoint yet; an attachment is only removed by deleting " +
        "the whole test (tests_delete).",
      {
        testId: z.string().min(1),
        action: z.literal("add"),
        ...testAttachmentInputSchema.shape,
      },
      async (args) =>
        safeTool(() => {
          const attachment = deps.tests.addAttachment(args.testId, {
            kind: args.kind,
            name: args.name,
            contentBase64: args.contentBase64,
          });
          return jsonResult({ testId: args.testId, attachment });
        }),
    ),

    // ── Environments (wire/DB entity: scenario — see the read tools' banner in ./index.ts) ────────
    tool(
      "environments_create",
      "Create a new Environment (provider + model + params + system prompt + guardrails + allowed " +
        'servers/tools + attached skills — internally a "scenario"). Fields default the same way ' +
        "the Environment editor form does when omitted.",
      // `scenarioInputSchema` is a `.superRefine`-wrapped `ZodEffects`, which has no `.shape` of its
      // own — `innerType()` (public zod API) recovers the underlying `ZodObject`'s raw shape. The
      // superRefine's own checks (model/providerId non-empty) are redundant with the per-field
      // `.trim().min(1)` already on those fields, so nothing is lost by bypassing the wrapper here.
      { ...scenarioInputSchema.innerType().shape },
      async (args) =>
        safeTool(() => jsonResult(compactEnvironment(deps.environments.create(args)))),
    ),

    tool(
      "environments_update",
      "Update an Environment. FULL REPLACE — provide the complete desired config; an omitted " +
        "optional field resets to its default (notably: omitting allowedSkills CLEARS every skill " +
        "attachment). Prefer environments_attach_skill / environments_detach_skill to add or remove " +
        "a single skill without restating the whole config.",
      { environmentId: z.string().min(1), ...scenarioInputSchema.innerType().shape },
      async (args) =>
        safeTool(() => {
          const { environmentId, ...input } = args;
          return jsonResult(compactEnvironment(deps.environments.update(environmentId, input)));
        }),
    ),

    tool(
      "environments_delete",
      "Permanently delete an Environment. CASCADES: every run recorded against it is deleted along " +
        "with it. This cannot be undone — always asks for approval regardless of auto-accept.",
      { environmentId: z.string().min(1) },
      async (args) =>
        safeTool(() => {
          deps.environments.delete(args.environmentId);
          return jsonResult({ environmentId: args.environmentId, deleted: true });
        }),
    ),

    tool(
      "environments_attach_skill",
      "Attach a skill to an Environment, tracking either its `latest` version (re-resolved at each " +
        "run) or a `pinned` fixed version id. Re-attaching an already-attached skill re-pins/updates " +
        "it in place — existing OTHER attachments are untouched. `eager` (default false) inlines the " +
        "skill's full SKILL.md body into the run's system prompt up front, in addition to the " +
        "always-on L1 listing.",
      {
        environmentId: z.string().min(1),
        skillId: z.string().min(1),
        versionMode: skillVersionModeSchema,
        pinnedVersionId: z
          .string()
          .min(1)
          .optional()
          .describe('Required when versionMode is "pinned".'),
        eager: z.boolean().optional(),
      },
      async (args) =>
        safeTool(() => {
          if (args.versionMode === "pinned" && !args.pinnedVersionId) {
            throw new Error('pinnedVersionId is required when versionMode is "pinned".');
          }
          // Reuse the SAME resolvability check the suite-variant skill-override path uses (WP 5.1,
          // scenario-service.ts) — throws a clear 400 if the skill (or its pinned version) doesn't
          // exist, BEFORE this mutates the scenario.
          assertSkillOverridesResolvable(deps.skills, {
            attach: [
              {
                skillId: args.skillId,
                versionId:
                  args.versionMode === "pinned" ? (args.pinnedVersionId as string) : "latest",
              },
            ],
          });
          const scenario = deps.environments.get(args.environmentId); // 404 if unknown
          const input = scenarioInputFromExisting(scenario);
          const entry: AllowedSkill =
            args.versionMode === "pinned"
              ? {
                  skillId: args.skillId,
                  versionMode: "pinned",
                  pinnedVersionId: args.pinnedVersionId as string,
                  eager: args.eager ?? false,
                }
              : { skillId: args.skillId, versionMode: "latest", eager: args.eager ?? false };
          const idx = input.allowedSkills.findIndex((s) => s.skillId === args.skillId);
          if (idx >= 0) input.allowedSkills[idx] = entry;
          else input.allowedSkills.push(entry);
          const updated = deps.environments.update(args.environmentId, input);
          return jsonResult({
            environmentId: updated.id,
            skillId: args.skillId,
            versionMode: args.versionMode,
            allowedSkillsCount: updated.allowedSkills.length,
          });
        }),
    ),

    tool(
      "environments_detach_skill",
      "Detach a skill from an Environment (its attachments list only — the skill itself and its " +
        "versions are untouched, and it can be re-attached any time). A skill that wasn't attached " +
        "is a harmless no-op (`wasAttached: false`).",
      { environmentId: z.string().min(1), skillId: z.string().min(1) },
      async (args) =>
        safeTool(() => {
          const scenario = deps.environments.get(args.environmentId); // 404 if unknown
          const wasAttached = scenario.allowedSkills.some((s) => s.skillId === args.skillId);
          const input = scenarioInputFromExisting(scenario);
          input.allowedSkills = input.allowedSkills.filter((s) => s.skillId !== args.skillId);
          const updated = deps.environments.update(args.environmentId, input);
          return jsonResult({
            environmentId: updated.id,
            skillId: args.skillId,
            wasAttached,
            allowedSkillsCount: updated.allowedSkills.length,
          });
        }),
    ),

    // ── Servers — NON-SECRET config only (see the module banner) ───────────────────────────────────
    tool(
      "servers_update_config",
      "Update an MCP server's NON-SECRET config only: name, transport, command/args (stdio) or url " +
        "(streamable HTTP). Partial update — an omitted field keeps its current value. This tool's " +
        "schema has NO env/headers/auth field, so it is IMPOSSIBLE to set, change, or even see a " +
        "secret (API key, bearer token, custom header value, OAuth client secret) through it — use " +
        "the Server settings window in the app UI for that.",
      {
        serverId: z.string().min(1),
        name: serverConfigUpdateSchema.shape.name,
        transport: serverConfigUpdateSchema.shape.transport,
        command: serverConfigUpdateSchema.shape.command,
        args: serverConfigUpdateSchema.shape.args,
        url: serverConfigUpdateSchema.shape.url,
      },
      async (args) =>
        safeTool(() => {
          const { serverId, ...update } = args;
          const updated = deps.servers.update(serverId, update);
          return jsonResult({
            serverId: updated.id,
            name: updated.name,
            transport: updated.transport,
            serverLink: `/servers/${updated.id}`,
          });
        }),
    ),

    // ── Collections ──────────────────────────────────────────────────────────────────────────────
    tool(
      "collections_modify",
      'Modify a Benchmarks collection: rename or rebind its GitHub repo (action "update_metadata" ' +
        "— NEVER accepts a PAT; rotate one via the Collection settings window in the app UI), or " +
        'manage test/suite membership ("assign_test"/"remove_test"/"assign_suite"/' +
        '"remove_suite" — reversible; the moved test/suite is never deleted, only re-homed). ' +
        "Rebinding requires repoUrl + repoPath + branch TOGETHER, or omit all three to keep the " +
        'current binding. The reserved default "Local" collection can never be renamed, rebound, ' +
        "or deleted.",
      {
        action: z.enum([
          "update_metadata",
          "assign_test",
          "remove_test",
          "assign_suite",
          "remove_suite",
        ]),
        collectionId: z
          .string()
          .min(1)
          .optional()
          .describe("Required for update_metadata / assign_test / assign_suite."),
        testId: z.string().min(1).optional().describe("Required for assign_test / remove_test."),
        suiteId: z.string().min(1).optional().describe("Required for assign_suite / remove_suite."),
        name: z
          .string()
          .trim()
          .min(1)
          .optional()
          .describe("update_metadata only; omit to keep the current name."),
        repoUrl: z.string().trim().url().optional(),
        repoPath: z.string().optional(),
        branch: z.string().trim().min(1).optional(),
      },
      async (args) =>
        safeTool(() => {
          switch (args.action) {
            case "update_metadata": {
              const collectionId = requireArg(args.collectionId, "collectionId", args.action);
              const current = deps.collections.get(collectionId); // 404 if unknown
              const updated = deps.collections.update(collectionId, {
                name: args.name ?? current.name,
                repoUrl: args.repoUrl,
                repoPath: args.repoPath,
                branch: args.branch,
                // pat intentionally never set — omitting it preserves whatever is currently stored.
              });
              return jsonResult(compactCollection(updated, args.action));
            }
            case "assign_test": {
              const collectionId = requireArg(args.collectionId, "collectionId", args.action);
              const testId = requireArg(args.testId, "testId", args.action);
              deps.collections.assignTest(collectionId, testId);
              return jsonResult({
                ...compactCollection(deps.collections.get(collectionId), args.action),
                testId,
              });
            }
            case "remove_test": {
              const testId = requireArg(args.testId, "testId", args.action);
              deps.collections.removeTest(testId);
              return jsonResult({ action: args.action, testId });
            }
            case "assign_suite": {
              const collectionId = requireArg(args.collectionId, "collectionId", args.action);
              const suiteId = requireArg(args.suiteId, "suiteId", args.action);
              deps.collections.assignSuite(collectionId, suiteId);
              return jsonResult({
                ...compactCollection(deps.collections.get(collectionId), args.action),
                suiteId,
              });
            }
            case "remove_suite": {
              const suiteId = requireArg(args.suiteId, "suiteId", args.action);
              deps.collections.removeSuite(suiteId);
              return jsonResult({ action: args.action, suiteId });
            }
            default: {
              const exhaustive: never = args.action;
              throw new Error(`Unknown collections_modify action "${exhaustive}".`);
            }
          }
        }),
    ),

    // ── Suites (Benchmarks) ──────────────────────────────────────────────────────────────────────
    tool(
      "suites_create",
      "Create a Benchmarks suite: a saved test × environment × repetition matrix with its own " +
        "execution config (repetitions/concurrency/cost cap/judge override/skill-effect variants).",
      { ...suiteInputSchema.shape },
      async (args) => safeTool(() => jsonResult(compactSuite(deps.suites.create(args)))),
    ),

    tool(
      "suites_update",
      "Update a suite. FULL REPLACE — provide the complete desired name/config/testIds/scenarioIds " +
        "(all required by the underlying schema, so an incomplete payload fails validation rather " +
        "than silently clearing membership). Provide collectionId to move the suite to a different " +
        "collection; omit it to keep its current membership.",
      { suiteId: z.string().min(1), ...suiteInputSchema.shape },
      async (args) =>
        safeTool(() => {
          const { suiteId, ...input } = args;
          return jsonResult(compactSuite(deps.suites.update(suiteId, input)));
        }),
    ),

    tool(
      "suites_delete",
      "Permanently delete a suite. CASCADES: its saved membership and every suite run (mass-run " +
        "history) recorded against it are deleted along with it — the underlying test runs " +
        "themselves are NOT deleted. This cannot be undone — always asks for approval regardless of " +
        "auto-accept.",
      { suiteId: z.string().min(1) },
      async (args) =>
        safeTool(() => {
          deps.suites.delete(args.suiteId);
          return jsonResult({ suiteId: args.suiteId, deleted: true });
        }),
    ),
  ];
}
