import {
  COLLECTION_FILE_FORMAT_VERSION,
  type Suite,
  type SuiteFile,
  type SuiteInput,
  type Test,
  type TestFile,
  type TestInput,
} from "@mcp-token-footprint/shared";

/**
 * DB-row ⇄ on-disk-file serializers for a Collection's members (WP 4.1, B12). These are pure and
 * standalone: the WP 4.2 git engine will materialize a working clone from `testToFile`/`suiteToFile`
 * and re-import remote files through `fileToTestInput`/`fileToSuiteInput`.
 *
 * INVARIANTS (planning/Roadmap/RM-07-benchmarks/conventions.md):
 *  - Exported files carry NO secrets and NO local-only references (no provider/server ids, no DB ids,
 *    no timestamps). `externalKey` is the ONLY identity that leaves the API.
 *  - Serialization is deterministic — recursively key-sorted, 2-space indent, trailing newline — so git
 *    diffs stay reviewable and golden files are byte-stable.
 *  - Attachments never sync: a test that had attachments serializes with an explicit
 *    `warnings: ["attachments-not-synced"]` marker (the bytes/paths themselves are omitted).
 */

/** The warning marker stamped on a test file whose source test carried (un-synced) attachments. */
export const ATTACHMENTS_NOT_SYNCED_WARNING = "attachments-not-synced";

/**
 * Deterministic canonical JSON for an on-disk file: keys sorted recursively, 2-space indent, trailing
 * newline. `undefined` object fields are dropped by `JSON.stringify` (so optional fields stay absent).
 */
export function serializeFile(value: unknown): string {
  return `${JSON.stringify(sortDeep(value), null, 2)}\n`;
}

/** A test → its on-disk file. Strips local id/timestamps/collection_id; carries only `externalKey`. */
export function testToFile(test: Test): TestFile {
  const externalKey = test.externalKey;
  if (!externalKey) {
    throw new Error("testToFile: test has no externalKey (not a collection member)");
  }

  const file: TestFile = {
    formatVersion: COLLECTION_FILE_FORMAT_VERSION,
    externalKey,
    name: test.name,
    userPrompt: test.userPrompt,
    tags: test.tags ?? [],
    addedProfiles: test.addedProfiles ?? [],
  };
  if (test.systemPromptOverride !== undefined)
    file.systemPromptOverride = test.systemPromptOverride;
  if (test.expectations !== undefined) file.expectations = test.expectations;
  if (test.category !== undefined) file.category = test.category;
  if (test.difficulty !== undefined) file.difficulty = test.difficulty;
  // Attachments are never written; if the source test had any, mark the omission explicitly.
  if (test.attachments && test.attachments.length > 0) {
    file.warnings = [ATTACHMENTS_NOT_SYNCED_WARNING];
  }
  return file;
}

/** A test file → a `TestInput` for local (re)creation. `externalKey` is adopted separately (WP 4.2). */
export function fileToTestInput(file: TestFile): TestInput {
  const input: TestInput = {
    name: file.name,
    userPrompt: file.userPrompt,
    addedProfiles: file.addedProfiles,
    tags: file.tags,
  };
  if (file.systemPromptOverride !== undefined)
    input.systemPromptOverride = file.systemPromptOverride;
  if (file.expectations !== undefined) input.expectations = file.expectations;
  if (file.category !== undefined) input.category = file.category;
  if (file.difficulty !== undefined) input.difficulty = file.difficulty;
  return input;
}

/**
 * A suite → its on-disk file. Member tests are referenced BY `externalKey` (ordered — the caller passes
 * the ordered list resolved from the suite's local test ids). Scenario binding is intentionally omitted
 * (local ids never leave; scenario NAMES could be added as informational `scenarioHints` by the caller).
 */
export function suiteToFile(suite: Suite, memberExternalKeys: string[]): SuiteFile {
  const externalKey = suite.externalKey;
  if (!externalKey) {
    throw new Error("suiteToFile: suite has no externalKey (not a collection member)");
  }

  const file: SuiteFile = {
    formatVersion: COLLECTION_FILE_FORMAT_VERSION,
    externalKey,
    name: suite.name,
    config: suite.config,
    testExternalKeys: memberExternalKeys,
  };
  if (suite.description !== undefined) file.description = suite.description;
  return file;
}

/**
 * A suite file → a `SuiteInput` for local (re)creation. Member `externalKey`s are resolved to LOCAL test
 * ids via `testIdByExternalKey` (unresolved refs are dropped — they'll bind once the referenced test is
 * imported); scenario binding is resolved locally (WP 4.2), so `scenarioIds` starts empty.
 */
export function fileToSuiteInput(
  file: SuiteFile,
  testIdByExternalKey: Map<string, string> = new Map(),
): SuiteInput {
  const testIds: string[] = [];
  for (const key of file.testExternalKeys) {
    const localId = testIdByExternalKey.get(key);
    if (localId) testIds.push(localId);
  }

  const input: SuiteInput = {
    name: file.name,
    config: file.config,
    testIds,
    scenarioIds: [],
  };
  if (file.description !== undefined) input.description = file.description;
  return input;
}

/**
 * Recursively rebuild a value with object keys sorted (arrays keep their order). Uses strict codepoint
 * ordering (NOT `localeCompare`) so the byte output is identical on every machine/locale — a hard
 * requirement for a git-diff-reviewable, byte-stable file format.
 */
function sortDeep(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sortDeep(item));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([key, item]) => [key, sortDeep(item)]),
    );
  }
  return value;
}
