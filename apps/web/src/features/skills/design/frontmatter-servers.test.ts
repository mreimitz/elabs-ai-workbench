import { describe, expect, test } from "vitest";
import {
  addFrontmatterServer,
  parseFrontmatterServers,
  removeFrontmatterServer,
} from "./frontmatter-servers";

// Behaviour lock for the bind-server text engine (Skill Studio WP 7.3a). The contract under test:
// read parity with the API's manifest parser (scalar | flow | block, trim/dedupe/drop-empties), and
// byte-preserving edits — every case asserts FULL strings, so any stray reformat of untouched
// content fails loudly.

const DOC = `---
name: my-skill
description: Does things.
keywords:
  - alpha
servers:
  - acme-cloud
  - files
license: MIT
---

# My skill

Body text.
`;

describe("parseFrontmatterServers", () => {
  test("no frontmatter at all → []", () => {
    expect(parseFrontmatterServers("# Just a body\n")).toEqual([]);
    expect(parseFrontmatterServers("")).toEqual([]);
  });

  test("unterminated fence → [] (not frontmatter, like the server parser)", () => {
    expect(parseFrontmatterServers("---\nservers:\n  - a\n")).toEqual([]);
  });

  test("frontmatter without a servers key → []", () => {
    expect(parseFrontmatterServers("---\nname: x\ndescription: y\n---\nBody\n")).toEqual([]);
  });

  test("block list → names in order", () => {
    expect(parseFrontmatterServers(DOC)).toEqual(["acme-cloud", "files"]);
  });

  test("block list tolerates quotes, blank lines, comments, and trailing comments", () => {
    const text = [
      "---",
      "servers:",
      '  - "quoted name"',
      "",
      "  - 'single ''quoted'''",
      "  # a comment between items",
      "  - plain # trailing comment",
      "other: key",
      "---",
      "Body",
    ].join("\n");
    expect(parseFrontmatterServers(text)).toEqual(["quoted name", "single 'quoted'", "plain"]);
  });

  test("flow list → names; empty flow → []", () => {
    expect(parseFrontmatterServers('---\nservers: [a, "b c", d]\n---\n')).toEqual([
      "a",
      "b c",
      "d",
    ]);
    expect(parseFrontmatterServers("---\nservers: []\n---\n")).toEqual([]);
  });

  test("scalar → single name (quoted or bare)", () => {
    expect(parseFrontmatterServers("---\nservers: solo\n---\n")).toEqual(["solo"]);
    expect(parseFrontmatterServers('---\nservers: "solo name"\n---\n')).toEqual(["solo name"]);
  });

  test("trims, drops empties, dedupes keeping first (server coerceStringList parity)", () => {
    const text = "---\nservers:\n  -   spaced  \n  - spaced\n  -\n  - other\n---\n";
    expect(parseFrontmatterServers(text)).toEqual(["spaced", "other"]);
  });

  test("a nested map under servers is opaque → []", () => {
    expect(parseFrontmatterServers("---\nservers:\n  foo: bar\n---\n")).toEqual([]);
  });

  test("CRLF documents parse identically", () => {
    const text = "---\r\nservers:\r\n  - a\r\n---\r\nBody\r\n";
    expect(parseFrontmatterServers(text)).toEqual(["a"]);
  });
});

describe("addFrontmatterServer", () => {
  test("no frontmatter → creates the block ahead of the body", () => {
    const next = addFrontmatterServer("# Body only\n", "srv");
    expect(next).toBe("---\nservers:\n  - srv\n---\n# Body only\n");
    expect(parseFrontmatterServers(next)).toEqual(["srv"]);
  });

  test("empty document → creates just the block", () => {
    expect(addFrontmatterServer("", "srv")).toBe("---\nservers:\n  - srv\n---\n");
  });

  test("frontmatter without the key → key appended before the closing fence, other keys untouched", () => {
    const text = "---\nname: x\ndescription: y\n---\nBody\n";
    expect(addFrontmatterServer(text, "srv")).toBe(
      "---\nname: x\ndescription: y\nservers:\n  - srv\n---\nBody\n",
    );
  });

  test("existing block list → appended after the last item, other lines byte-identical", () => {
    expect(addFrontmatterServer(DOC, "new-server")).toBe(
      DOC.replace("  - files\n", "  - files\n  - new-server\n"),
    );
  });

  test("existing block list with 4-space indent → new item matches the indent", () => {
    const text = "---\nservers:\n    - a\n---\n";
    expect(addFrontmatterServer(text, "b")).toBe("---\nservers:\n    - a\n    - b\n---\n");
  });

  test("`servers:` key with no items yet → first item inserted under the key", () => {
    const text = "---\nservers:\nlicense: MIT\n---\n";
    expect(addFrontmatterServer(text, "a")).toBe("---\nservers:\n  - a\nlicense: MIT\n---\n");
  });

  test("duplicate add is an identity no-op (===)", () => {
    expect(addFrontmatterServer(DOC, "files")).toBe(DOC);
    expect(addFrontmatterServer(DOC, "  files  ")).toBe(DOC);
  });

  test("blank name is an identity no-op", () => {
    expect(addFrontmatterServer(DOC, "   ")).toBe(DOC);
  });

  test("flow list → spliced inside the brackets, style preserved", () => {
    expect(addFrontmatterServer("---\nservers: [a, b]\n---\n", "c")).toBe(
      "---\nservers: [a, b, c]\n---\n",
    );
    expect(addFrontmatterServer("---\nservers: [a,b]\n---\n", "c")).toBe(
      "---\nservers: [a,b,c]\n---\n",
    );
    expect(addFrontmatterServer("---\nservers: []\n---\n", "only")).toBe(
      "---\nservers: [only]\n---\n",
    );
  });

  test("scalar → normalized to a block list carrying both names (documented normalization)", () => {
    expect(addFrontmatterServer("---\nservers: old\n---\n", "new")).toBe(
      "---\nservers:\n  - old\n  - new\n---\n",
    );
  });

  test("names needing quotes are double-quoted and read back verbatim", () => {
    for (const name of ["with space", "true", "123", "a:b", "#lead", "-lead"]) {
      const next = addFrontmatterServer("---\nname: x\n---\n", name);
      expect(next).toContain(`- ${JSON.stringify(name)}`);
      expect(parseFrontmatterServers(next)).toEqual([name]);
    }
  });

  test("plain-safe names stay unquoted", () => {
    const next = addFrontmatterServer("---\nname: x\n---\n", "acme_cloud-2.dev/x");
    expect(next).toContain("- acme_cloud-2.dev/x\n");
  });

  test("opaque servers value (nested map) is never edited", () => {
    const text = "---\nservers:\n  foo: bar\n---\n";
    expect(addFrontmatterServer(text, "a")).toBe(text);
  });

  test("CRLF document → inserted line uses CRLF", () => {
    const text = "---\r\nservers:\r\n  - a\r\n---\r\nBody\r\n";
    expect(addFrontmatterServer(text, "b")).toBe(
      "---\r\nservers:\r\n  - a\r\n  - b\r\n---\r\nBody\r\n",
    );
  });

  test("BOM is kept ahead of a created block", () => {
    const next = addFrontmatterServer("﻿Body\n", "a");
    expect(next).toBe("﻿---\nservers:\n  - a\n---\nBody\n");
    expect(parseFrontmatterServers(next)).toEqual(["a"]);
  });
});

describe("removeFrontmatterServer", () => {
  test("one of several block items → only that line removed", () => {
    expect(removeFrontmatterServer(DOC, "acme-cloud")).toBe(DOC.replace("  - acme-cloud\n", ""));
    expect(removeFrontmatterServer(DOC, "files")).toBe(DOC.replace("  - files\n", ""));
  });

  test("last block item → the servers key is dropped cleanly, other keys intact", () => {
    const text = "---\nname: x\nservers:\n  - only\nlicense: MIT\n---\nBody\n";
    expect(removeFrontmatterServer(text, "only")).toBe("---\nname: x\nlicense: MIT\n---\nBody\n");
  });

  test("absent name is an identity no-op (===)", () => {
    expect(removeFrontmatterServer(DOC, "nope")).toBe(DOC);
    expect(removeFrontmatterServer("no frontmatter", "a")).toBe("no frontmatter");
  });

  test("quoted block item is matched by its parsed value", () => {
    const text = '---\nservers:\n  - "with space"\n  - b\n---\n';
    expect(removeFrontmatterServer(text, "with space")).toBe("---\nservers:\n  - b\n---\n");
  });

  test("flow list: middle, first, and last element removals splice exactly one segment + comma", () => {
    expect(removeFrontmatterServer("---\nservers: [a, b, c]\n---\n", "b")).toBe(
      "---\nservers: [a, c]\n---\n",
    );
    expect(removeFrontmatterServer("---\nservers: [a, b]\n---\n", "b")).toBe(
      "---\nservers: [a]\n---\n",
    );
    expect(removeFrontmatterServer("---\nservers: [a, b]\n---\n", "a")).toBe(
      "---\nservers: [ b]\n---\n",
    );
  });

  test("only flow element → the key line is dropped", () => {
    const text = "---\nname: x\nservers: [only]\n---\n";
    expect(removeFrontmatterServer(text, "only")).toBe("---\nname: x\n---\n");
  });

  test("scalar equal to the name → the key line is dropped", () => {
    const text = "---\nname: x\nservers: solo\n---\n";
    expect(removeFrontmatterServer(text, "solo")).toBe("---\nname: x\n---\n");
  });

  test("removing the only key of a servers-only block drops the whole block", () => {
    expect(removeFrontmatterServer("---\nservers:\n  - a\n---\nBody\n", "a")).toBe("Body\n");
  });

  test("blocks still holding other blank/comment lines are NOT dropped", () => {
    const text = "---\n\nservers:\n  - a\n---\nBody\n";
    expect(removeFrontmatterServer(text, "a")).toBe("---\n\n---\nBody\n");
  });

  test("duplicate declarations are all removed", () => {
    const text = "---\nservers:\n  - a\n  - b\n  - a\n---\n";
    expect(removeFrontmatterServer(text, "a")).toBe("---\nservers:\n  - b\n---\n");
  });

  test("CRLF document → removal keeps CRLF everywhere else", () => {
    const text = "---\r\nservers:\r\n  - a\r\n  - b\r\n---\r\nBody\r\n";
    expect(removeFrontmatterServer(text, "a")).toBe("---\r\nservers:\r\n  - b\r\n---\r\nBody\r\n");
  });
});

describe("round-trip stability (add then remove yields the original text)", () => {
  const CASES: [string, string][] = [
    ["block list", DOC],
    ["no servers key", "---\nname: x\ndescription: y\n---\nBody\n"],
    ["flow list", "---\nname: x\nservers: [a, b]\n---\nBody\n"],
    ["no frontmatter at all", "# Body only\n\nText.\n"],
    ["empty document", ""],
    ["CRLF block list", "---\r\nname: x\r\nservers:\r\n  - a\r\n---\r\nBody\r\n"],
    ["quoted existing items", '---\nservers:\n  - "keep me"\n---\n'],
    ["4-space indent", "---\nservers:\n    - a\n---\n"],
  ];

  test.each(CASES)("%s", (_label, original) => {
    const added = addFrontmatterServer(original, "round-trip-server");
    expect(parseFrontmatterServers(added)).toContain("round-trip-server");
    expect(removeFrontmatterServer(added, "round-trip-server")).toBe(original);
  });

  test("unrelated keys, comments, and formatting survive an add+remove byte-for-byte", () => {
    const gnarly = [
      "---",
      "name: my-skill",
      "# a comment",
      "description: >-",
      "  folded text",
      "keywords:",
      "  - k1",
      "servers:",
      "  - existing",
      "metadata:",
      "  team: core",
      "---",
      "",
      "Body `code`.",
      "",
    ].join("\n");
    const added = addFrontmatterServer(gnarly, "tmp");
    expect(added).toBe(gnarly.replace("  - existing\n", "  - existing\n  - tmp\n"));
    expect(removeFrontmatterServer(added, "tmp")).toBe(gnarly);
  });
});
