import assert from "node:assert/strict";
import { test } from "node:test";
import type {
  NormalizedPromptDefinition,
  NormalizedResourceDefinition,
} from "@mcp-token-footprint/shared";
import { getTokenCounter } from "../src/token-counting/profiles.js";

// Definition-footprint token accounting for MCP resources/templates and prompts. Mirrors the
// tool-counting facets: each text facet is `countText`, arguments are `countJson`, rawBytes is the
// stable-JSON byte length, and the total is the SUM of the token facets (rawBytes is not a facet).
const counter = getTokenCounter("generic_o200k");

// ── countResourceDefinition ─────────────────────────────────────────────────────────────────────

test("countResourceDefinition (resource) sums uri/name/description/mimeType facets", async () => {
  const resource: NormalizedResourceDefinition = {
    kind: "resource",
    uri: "file:///workspace/readme.md",
    name: "Project README",
    description: "The top-level project readme document",
    mimeType: "text/markdown",
    raw: {
      uri: "file:///workspace/readme.md",
      name: "Project README",
      description: "The top-level project readme document",
      mimeType: "text/markdown",
    },
  };

  const breakdown = await counter.countResourceDefinition(resource);

  // Each facet is the standalone countText of its field.
  assert.equal(breakdown.uriTokens, await counter.countText(resource.uri));
  assert.equal(breakdown.nameTokens, await counter.countText(resource.name!));
  assert.equal(breakdown.descriptionTokens, await counter.countText(resource.description!));
  assert.equal(breakdown.mimeTypeTokens, await counter.countText(resource.mimeType!));

  // Total is the sum of the four token facets (NOT rawBytes).
  assert.equal(
    breakdown.totalTokens,
    breakdown.uriTokens +
      breakdown.nameTokens +
      breakdown.descriptionTokens +
      breakdown.mimeTypeTokens,
  );

  // rawBytes is the stable-JSON byte length and is strictly positive for a non-empty raw.
  assert.ok(breakdown.rawBytes > 0, "rawBytes reflects the serialized raw definition");
  // Each present facet contributes at least one token.
  assert.ok(breakdown.uriTokens > 0 && breakdown.nameTokens > 0 && breakdown.descriptionTokens > 0);
  assert.ok(breakdown.mimeTypeTokens > 0);
});

test("countResourceDefinition (template) counts the uriTemplate as the uri facet", async () => {
  const template: NormalizedResourceDefinition = {
    kind: "template",
    uri: "file:///workspace/{path}",
    name: "Workspace file",
    description: "Any file under the workspace by path",
    mimeType: "application/octet-stream",
    raw: { uriTemplate: "file:///workspace/{path}", name: "Workspace file" },
  };

  const breakdown = await counter.countResourceDefinition(template);

  assert.equal(breakdown.uriTokens, await counter.countText(template.uri));
  assert.equal(breakdown.nameTokens, await counter.countText(template.name!));
  assert.equal(breakdown.descriptionTokens, await counter.countText(template.description!));
  assert.equal(breakdown.mimeTypeTokens, await counter.countText(template.mimeType!));
  assert.equal(
    breakdown.totalTokens,
    breakdown.uriTokens +
      breakdown.nameTokens +
      breakdown.descriptionTokens +
      breakdown.mimeTypeTokens,
  );
  assert.ok(breakdown.rawBytes > 0);
});

test("countResourceDefinition zeroes absent name/description/mimeType facets", async () => {
  const resource: NormalizedResourceDefinition = {
    kind: "resource",
    uri: "mem://only-a-uri",
    raw: { uri: "mem://only-a-uri" },
  };

  const breakdown = await counter.countResourceDefinition(resource);

  assert.equal(breakdown.nameTokens, 0, "no name → 0 name tokens");
  assert.equal(breakdown.descriptionTokens, 0, "no description → 0 description tokens");
  assert.equal(breakdown.mimeTypeTokens, 0, "no mimeType → 0 mimeType tokens");
  assert.ok(breakdown.uriTokens > 0, "the uri still counts");
  assert.equal(breakdown.totalTokens, breakdown.uriTokens, "total is just the uri facet");
});

// ── countPromptDefinition ───────────────────────────────────────────────────────────────────────

test("countPromptDefinition sums name/description/arguments facets", async () => {
  const prompt: NormalizedPromptDefinition = {
    name: "summarize_document",
    description: "Summarize a document into a short paragraph",
    arguments: [
      { name: "document", description: "the document text", required: true },
      { name: "max_words", description: "word budget", required: false },
    ],
    raw: { name: "summarize_document", arguments: [] },
  };

  const breakdown = await counter.countPromptDefinition(prompt);

  assert.equal(breakdown.nameTokens, await counter.countText(prompt.name));
  assert.equal(breakdown.descriptionTokens, await counter.countText(prompt.description!));
  // Arguments are counted as JSON (countJson), not plain text.
  assert.equal(breakdown.argumentsTokens, await counter.countJson(prompt.arguments));
  assert.equal(
    breakdown.totalTokens,
    breakdown.nameTokens + breakdown.descriptionTokens + breakdown.argumentsTokens,
  );
  assert.ok(breakdown.rawBytes > 0, "rawBytes reflects the serialized raw definition");
  assert.ok(breakdown.argumentsTokens > 0, "a non-empty argument list contributes tokens");
});

test("countPromptDefinition zeroes absent description and arguments", async () => {
  const prompt: NormalizedPromptDefinition = {
    name: "ping",
    raw: { name: "ping" },
  };

  const breakdown = await counter.countPromptDefinition(prompt);

  assert.equal(breakdown.descriptionTokens, 0, "no description → 0 description tokens");
  assert.equal(breakdown.argumentsTokens, 0, "no arguments → 0 argument tokens");
  assert.ok(breakdown.nameTokens > 0, "the name still counts");
  assert.equal(breakdown.totalTokens, breakdown.nameTokens, "total is just the name facet");
});
